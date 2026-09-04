import { brand, type CapabilityId } from '@nextagent/agent-common';
import type { CapabilityDescriptor, RuntimeCapabilityResolver } from '@nextagent/agent-contracts/capability';
import type { SkillAcquisitionOutcomeCode, SkillAcquisitionResult } from './skill-acquisition-contract.js';

const queryMaxLength = 256;

export interface SkillAcquisitionRequest {
  readonly providerId?: string;
  readonly requestedCapabilityId?: string;
  readonly query?: string;
}

export interface SkillAcquisitionServiceOptions {
  readonly resolver?: RuntimeCapabilityResolver | undefined;
  readonly signal?: AbortSignal;
}

export class SkillAcquisitionService {
  private readonly resolver?: RuntimeCapabilityResolver | undefined;
  private readonly signal: AbortSignal;
  private readonly attempts = new Map<string, SkillAcquisitionResult>();

  constructor(options: SkillAcquisitionServiceOptions) {
    this.resolver = options.resolver;
    this.signal = options.signal ?? new AbortController().signal;
  }

  async acquire(request: SkillAcquisitionRequest): Promise<SkillAcquisitionResult> {
    const normalized = normalizeRequest(request);
    if (normalized === undefined) {
      return result(
        'REJECTED',
        'Skill acquisition validation failed before search. Supply an exact Skill capability id or a bounded query, then call acquire_skill again.',
      );
    }
    if (this.signal.aborted) {
      return result('UNAVAILABLE', 'Skill acquisition was aborted.');
    }
    if (this.resolver === undefined) {
      return result(
        'UNAVAILABLE',
        'Skill acquisition could not start because the governed resolver is unavailable. Use an already available Skill or capability, or continue without acquisition.',
      );
    }

    const attemptKey = acquisitionAttemptKey(normalized);
    const cached = this.attempts.get(attemptKey);
    if (cached !== undefined) {
      return cached;
    }

    const acquired = await this.tryAcquire(normalized).catch(() =>
      result(
        'UNAVAILABLE',
        'Skill acquisition failed while querying the governed Skill registry. Use an already available Skill or capability, try again later, or continue without acquisition.',
      ),
    );
    this.attempts.set(attemptKey, acquired);
    return acquired;
  }

  private async tryAcquire(request: NormalizedSkillAcquisitionRequest): Promise<SkillAcquisitionResult> {
    const descriptor =
      request.requestedCapabilityId !== undefined ? await this.resolveRequestedSkill(request) : await this.searchRequestedSkill(request);
    if (descriptor === undefined) {
      return result(
        'NOT_FOUND',
        'The requested Skill was not found in the governed registry. Broaden the query, select another available Skill, or continue without acquisition.',
      );
    }
    if (descriptor.provider.providerKind !== 'SKILL_HUB') {
      return result(
        'REJECTED',
        'The requested Skill is not managed by SkillHub and cannot be acquired through this tool. Load it with Skill if already available, or choose another capability.',
      );
    }
    if (descriptor.availabilityStatus !== 'AVAILABLE' || descriptor.modelInvocable !== true || descriptor.disclosurePolicy?.mode === 'HIDDEN') {
      return result(
        'UNAUTHORIZED',
        'The requested Skill is not allowed for this Agent in the current governed scope. Choose an already allowed Skill or capability, or continue without acquisition.',
      );
    }
    return result('ACQUIRED_REQUIRES_REPLAN', 'Skill acquired; rebuild the capability snapshot before use.', descriptor);
  }

  private async resolveRequestedSkill(request: NormalizedSkillAcquisitionRequest): Promise<CapabilityDescriptor | undefined> {
    if (request.requestedCapabilityId === undefined) {
      return undefined;
    }
    const descriptor = await this.resolver?.resolveCapability(
      {
        kind: 'SKILL',
        capabilityId: brand<string, 'CapabilityId'>(request.requestedCapabilityId),
        ...(request.providerId === undefined ? {} : { providerId: request.providerId }),
      },
      this.signal,
    );
    return descriptor === undefined || descriptor.kind !== 'SKILL' ? undefined : descriptor;
  }

  private async searchRequestedSkill(request: NormalizedSkillAcquisitionRequest): Promise<CapabilityDescriptor | undefined> {
    const descriptors = (await this.resolver?.listCapabilities?.({ kind: 'SKILL', modelInvocable: true }, this.signal)) ?? [];
    return descriptors
      .filter(
        (descriptor) => descriptor.kind === 'SKILL' && (request.providerId === undefined || descriptor.provider.providerId === request.providerId),
      )
      .filter((descriptor) => descriptor.availabilityStatus === 'AVAILABLE' && descriptor.disclosurePolicy?.mode !== 'HIDDEN')
      .filter((descriptor) => matchesQuery(descriptor, request.query))
      .sort(
        (left, right) =>
          relevanceScore(right, request.query) - relevanceScore(left, request.query) || left.capabilityId.localeCompare(right.capabilityId, 'en'),
      )[0];
  }
}

interface NormalizedSkillAcquisitionRequest {
  readonly providerId?: string;
  readonly requestedCapabilityId?: string;
  readonly query: string;
}

function normalizeRequest(request: SkillAcquisitionRequest): NormalizedSkillAcquisitionRequest | undefined {
  const providerId = safeOptionalIdentifier(request.providerId, 128);
  if (request.providerId !== undefined && providerId === undefined) {
    return undefined;
  }
  const requestedCapabilityId = safeOptionalIdentifier(request.requestedCapabilityId, 128);
  if (request.requestedCapabilityId !== undefined && requestedCapabilityId === undefined) {
    return undefined;
  }
  const query = typeof request.query === 'string' ? request.query.trim() : '';
  if (requestedCapabilityId === undefined && (query.length === 0 || query.length > queryMaxLength)) {
    return undefined;
  }
  if (query.length > queryMaxLength) {
    return undefined;
  }
  return {
    ...(providerId === undefined ? {} : { providerId }),
    ...(requestedCapabilityId === undefined ? {} : { requestedCapabilityId }),
    query: query.length === 0 ? (requestedCapabilityId ?? '') : query,
  };
}

function safeOptionalIdentifier(value: string | undefined, maxLength: number): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  const trimmed = value.trim();
  return /^[A-Za-z0-9._:-]+$/u.test(trimmed) && trimmed.length > 0 && trimmed.length <= maxLength ? trimmed : undefined;
}

function acquisitionAttemptKey(request: NormalizedSkillAcquisitionRequest): string {
  return [request.providerId ?? '*', request.requestedCapabilityId ?? '*', request.query.toLowerCase()].join('\0');
}

function matchesQuery(descriptor: CapabilityDescriptor, query: string): boolean {
  const haystack =
    `${descriptor.capabilityId} ${descriptor.displayName} ${descriptor.description} ${descriptor.disclosurePolicy?.searchHint ?? ''}`.toLowerCase();
  return query
    .toLowerCase()
    .split(/\s+/u)
    .filter((term) => term.length > 0)
    .every((term) => haystack.includes(term));
}

function relevanceScore(descriptor: CapabilityDescriptor, query: string): number {
  const exact = query.toLowerCase();
  const id = descriptor.capabilityId.toLowerCase();
  const name = descriptor.displayName.toLowerCase();
  if (id === exact) {
    return 100;
  }
  if (name === exact) {
    return 90;
  }
  return query
    .toLowerCase()
    .split(/\s+/u)
    .reduce((score, term) => {
      if (id.includes(term)) {
        return score + 20;
      }
      if (name.includes(term)) {
        return score + 15;
      }
      if (descriptor.description.toLowerCase().includes(term)) {
        return score + 5;
      }
      return score;
    }, 0);
}

function result(outcomeCode: SkillAcquisitionOutcomeCode, message: string, descriptor?: CapabilityDescriptor): SkillAcquisitionResult {
  return {
    outcomeCode,
    requiresReplan: outcomeCode === 'ACQUIRED_REQUIRES_REPLAN',
    ...(descriptor === undefined
      ? {}
      : {
          providerKind: descriptor.provider.providerKind,
          providerId: descriptor.provider.providerId,
          skillId: descriptor.capabilityId,
        }),
    message,
  };
}
