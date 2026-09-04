import { type SafeError } from '@nextagent/agent-common';
import type { CapabilityInvocationResult } from '@nextagent/agent-contracts/capability';

/**
 * Package-private marker that the engine uses to distinguish a final
 * Capability failure from an ordinary node exception. It is never exported
 * from the package public API and never enters agent-contracts. The engine
 * uses it to skip Workflow node retry and to evaluate the explicit exception
 * only after the governed boundary has returned the final result.
 */
export class CapabilityNodeExecutionError extends Error {
  readonly safeError: SafeError;
  readonly nodeId: string;
  readonly nodeType: string;
  readonly capabilityId: string;

  constructor(result: CapabilityInvocationResult, node: { readonly id: string; readonly type: string; readonly capabilityId: string }) {
    super('Workflow capability node failed safely.');
    this.name = 'CapabilityNodeExecutionError';
    this.safeError = normalizedSafeError(result);
    this.nodeId = node.id;
    this.nodeType = node.type;
    this.capabilityId = node.capabilityId;
  }
}

export function isCapabilityNodeExecutionError(error: unknown): error is CapabilityNodeExecutionError {
  return error instanceof CapabilityNodeExecutionError;
}

function normalizedSafeError(result: CapabilityInvocationResult): SafeError {
  const safeError = result.safeError;
  if (safeError !== undefined && safeError !== null) {
    return safeError;
  }
  return {
    code: 'WORKFLOW_CAPABILITY_FAILED',
    message: 'Workflow capability node failed without a safe error.',
    category: 'INTERNAL',
    retryable: false,
  };
}
