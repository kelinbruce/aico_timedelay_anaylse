import type { TokenEstimator } from '@nextagent/agent-contracts/context';
import type { ModelMessage, ModelMessageRole, ModelToolDescriptor } from '@nextagent/agent-contracts/model';
import { createDefaultTokenEstimator } from './default-token-estimator.js';

export type RenderedContextSupplementDisposition = 'L2_CONTEXT' | 'L1_CONTEXT' | 'CHARACTERISTICS_CONTEXT' | 'NO_CONTEXT';

export type RenderedContextSupplementKind = 'L2' | 'L1' | 'CHARACTERISTICS';

export interface RenderedContextSupplement {
  readonly kind: RenderedContextSupplementKind;
  readonly message: ModelMessage;
  /**
   * Supplements sharing an exclusive group are mutually exclusive: only the
   * first one that fits the budget is admitted, and the rest of the group is
   * skipped. Omit to admit a supplement independently of others.
   */
  readonly exclusiveGroup?: string;
}

export interface RenderedContextSupplementAdmissionInput {
  readonly messages: readonly ModelMessage[];
  readonly tools: readonly ModelToolDescriptor[];
  readonly contextWindowTokens: number;
  readonly reservedOutputTokens?: number;
  readonly supplements: readonly RenderedContextSupplement[];
}

export type RenderedContextSupplementAdmissionResult =
  | { readonly disposition: Exclude<RenderedContextSupplementDisposition, 'NO_CONTEXT'>; readonly messages: readonly ModelMessage[] }
  | { readonly disposition: 'NO_CONTEXT' };

const kindDisposition: Record<RenderedContextSupplementKind, Exclude<RenderedContextSupplementDisposition, 'NO_CONTEXT'>> = {
  L2: 'L2_CONTEXT',
  L1: 'L1_CONTEXT',
  CHARACTERISTICS: 'CHARACTERISTICS_CONTEXT',
};

const dispositionRank: Record<Exclude<RenderedContextSupplementDisposition, 'NO_CONTEXT'>, number> = {
  L2_CONTEXT: 3,
  L1_CONTEXT: 2,
  CHARACTERISTICS_CONTEXT: 1,
};

export class RenderedContextSupplementAdmission {
  constructor(private readonly estimator: TokenEstimator = createDefaultTokenEstimator()) {}

  admit(input: RenderedContextSupplementAdmissionInput): RenderedContextSupplementAdmissionResult {
    const inputBudget = Math.max(0, input.contextWindowTokens - (input.reservedOutputTokens ?? 0));
    let remaining = inputBudget - estimateMessages(input.messages, this.estimator) - estimateTools(input.tools, this.estimator);

    const admitted: ModelMessage[] = [];
    const admittedGroups = new Set<string>();
    let highestDisposition: Exclude<RenderedContextSupplementDisposition, 'NO_CONTEXT'> | undefined;
    for (const supplement of input.supplements) {
      const group = supplement.exclusiveGroup;
      if (group !== undefined && admittedGroups.has(group)) {
        continue;
      }
      const units = estimateMessage(supplement.message, this.estimator);
      if (units > remaining) {
        continue;
      }
      admitted.push(supplement.message);
      remaining -= units;
      if (group !== undefined) {
        admittedGroups.add(group);
      }
      const disposition = kindDisposition[supplement.kind];
      if (highestDisposition === undefined || dispositionRank[disposition] > dispositionRank[highestDisposition]) {
        highestDisposition = disposition;
      }
    }

    if (highestDisposition === undefined || admitted.length === 0) {
      return { disposition: 'NO_CONTEXT' };
    }
    return { disposition: highestDisposition, messages: admitted };
  }
}

function estimateMessages(messages: readonly ModelMessage[], estimator: TokenEstimator): number {
  return messages.reduce((total, message) => total + estimateMessage(message, estimator), 0);
}

function estimateMessage(message: ModelMessage, estimator: TokenEstimator): number {
  const role = modelRoleToEstimatorRole(message.role);
  const content = message.content.map((part) => (part.type === 'text' ? part.text : JSON.stringify(part))).join('\n');
  return estimator.estimateMessageTokens(role, content);
}

function estimateTools(tools: readonly ModelToolDescriptor[], estimator: TokenEstimator): number {
  return estimator.estimateTokensBatch(tools.map((tool) => JSON.stringify(tool)));
}

function modelRoleToEstimatorRole(role: ModelMessageRole): 'system' | 'user' | 'assistant' | 'tool' {
  return role.toLowerCase() as 'system' | 'user' | 'assistant' | 'tool';
}
