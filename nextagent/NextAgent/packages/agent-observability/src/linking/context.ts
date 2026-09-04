import type {
  AgentId,
  AgentVersion,
  CapabilityInvocationId,
  IdentityContext,
  MessageId,
  RequestContextId,
  RequestRunId,
  SessionId,
  SubjectId,
  TenantId,
} from '@nextagent/agent-common';
import { AsyncLocalStorage } from 'node:async_hooks';

export type DiagnosticCandidateClassification = 'SAFE' | 'LOW_CARDINALITY' | 'HIGH_CARDINALITY' | 'SENSITIVE';
export type DiagnosticCandidateCardinality = 'LOW' | 'HIGH';

export interface DiagnosticCandidate {
  readonly key: string;
  readonly value: string | number | boolean | readonly string[];
  readonly classification: DiagnosticCandidateClassification;
  readonly cardinality: DiagnosticCandidateCardinality;
}

export interface ObservabilityContext {
  readonly tenantId?: TenantId;
  readonly subjectId?: SubjectId;
  readonly agentId?: AgentId;
  readonly agentVersion?: AgentVersion;
  readonly sessionId?: SessionId;
  readonly requestRunId?: RequestRunId;
  readonly requestContextId?: RequestContextId;
  readonly messageId?: MessageId;
  readonly timelineEventId?: string;
  readonly capabilityInvocationId?: CapabilityInvocationId;
  readonly diagnosticCandidates?: readonly DiagnosticCandidate[];
}

const storage = new AsyncLocalStorage<ObservabilityContext>();

export function createRequestDiagnosticContext(identity: IdentityContext): ObservabilityContext {
  return {
    tenantId: identity.tenantId,
    subjectId: identity.subjectId,
  };
}
export function runWithObservabilityContext<T>(context: ObservabilityContext, callback: () => T): T {
  return storage.run(context, callback);
}

export function bindDiagnosticContext<T>(patch: Partial<ObservabilityContext> | undefined, callback: () => T): T {
  const current = storage.getStore();
  if (patch === undefined || Object.keys(patch).length === 0) {
    return current === undefined ? callback() : storage.run(current, callback);
  }
  const merged = mergeContext(current, patch);
  return storage.run(merged, callback);
}

export function currentObservabilityContext(): ObservabilityContext | undefined {
  return storage.getStore();
}

export function snapshotDiagnosticContextForEvent(): ObservabilityContext | undefined {
  const current = storage.getStore();
  if (current === undefined) {
    return undefined;
  }
  return {
    ...current,
    ...(current.diagnosticCandidates === undefined ? {} : { diagnosticCandidates: [...current.diagnosticCandidates] }),
  };
}

function mergeContext(current: ObservabilityContext | undefined, patch: Partial<ObservabilityContext>): ObservabilityContext {
  if (current === undefined) {
    return { ...patch };
  }
  return {
    ...patch,
    ...current,
    diagnosticCandidates: [...(current.diagnosticCandidates ?? []), ...(patch.diagnosticCandidates ?? [])],
  };
}
