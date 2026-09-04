import {
  brand,
  type AgentId,
  type AgentVersion,
  type AttachmentId,
  type IdempotencyKey,
  type IdentityContext,
  type MessageId,
  type PendingInputId,
  type RequestLocale,
  type RequestRunId,
  type SessionId,
} from '@nextagent/agent-common';
import type { ObservabilityContext } from '../linking/context.js';
import { createObservationEvent, type ObservabilityObservationEvent, type TrustedOwnerScope } from '../linking/observation.js';

/*
 * Local structural views of the runtime command contract. agent-observability is
 * forbidden to import agent-contracts/runtime, so these views stay in this file.
 * With property-style signatures, parameter types are checked contravariantly,
 * so each view must be a structural subtype of the canonical command: branded
 * owner-scope vocabulary comes from agent-common and required fields mirror the
 * canonical commands.
 */
export interface ObservableReserveSubmitCommand {
  readonly sessionId: SessionId;
  readonly identityContext: IdentityContext;
  readonly action: 'SUBMIT_REQUEST' | 'EDIT_LATEST_REQUEST';
  readonly inputText: string;
  readonly idempotencyKey: IdempotencyKey;
  readonly attachmentIntakePresent: boolean;
}

export interface ObservableSubmitRequestCommand {
  readonly sessionId?: SessionId;
  readonly identityContext: IdentityContext;
  readonly inputText: string;
  readonly attachmentIds: readonly AttachmentId[];
  readonly locale: RequestLocale;
  readonly idempotencyKey: IdempotencyKey;
}

export interface ObservableRequestControlCommand {
  readonly sessionId: SessionId;
  readonly identityContext: IdentityContext;
  readonly expectedLatestRequestId: MessageId;
  readonly action: 'CANCEL' | 'RETRY_LATEST';
  readonly idempotencyKey: IdempotencyKey;
}

export interface ObservableEditLatestRequestCommand {
  readonly sessionId: SessionId;
  readonly identityContext: IdentityContext;
  readonly expectedLatestRequestId: MessageId;
  readonly editedInputText: string;
  readonly attachmentIds: readonly AttachmentId[];
  readonly idempotencyKey: IdempotencyKey;
}

export interface ObservableAnswerPendingInputCommand {
  readonly identityContext: IdentityContext;
  readonly idempotencyKey: IdempotencyKey;
  readonly answer: {
    readonly sessionId: SessionId;
    readonly pendingInputId: PendingInputId;
    readonly answers: ReadonlyArray<readonly string[]>;
  };
}

export interface ObservableHideRunMessagesCommand {
  readonly identityContext: IdentityContext;
  readonly agentId: AgentId;
  readonly sessionId: SessionId;
  readonly requestId: MessageId;
  readonly runId: RequestRunId;
  readonly reason: 'GUARD_BLOCKED';
}

export interface ObservableRuntimeCommandPort {
  reserveSubmit?: (command: ObservableReserveSubmitCommand) => Promise<unknown>;
  submit: (command: ObservableSubmitRequestCommand) => Promise<unknown>;
  cancel: (command: ObservableRequestControlCommand) => Promise<unknown>;
  retryLatest: (command: ObservableRequestControlCommand) => Promise<unknown>;
  editLatest: (command: ObservableEditLatestRequestCommand) => Promise<unknown>;
  answerPendingInput: (command: ObservableAnswerPendingInputCommand) => Promise<unknown>;
  hideRunMessages?: (command: ObservableHideRunMessagesCommand) => Promise<void>;
}

export interface ObservedRuntimeCommandPortOptions {
  readonly defaultRouteAgentScope: {
    readonly agentId: AgentId;
    readonly agentVersion: AgentVersion;
  };
  readonly acceptObservation: (event: ObservabilityObservationEvent) => void;
  readonly now?: () => number;
}

export function createObservedRuntimeCommandPort<T extends ObservableRuntimeCommandPort>(inner: T, options: ObservedRuntimeCommandPortOptions): T {
  return {
    ...inner,
    ...(inner.reserveSubmit === undefined
      ? {}
      : {
          async reserveSubmit(command: ObservableReserveSubmitCommand) {
            return observeRuntimeCommand('RESERVE_SUBMIT_REJECTED', command, options, () => inner.reserveSubmit!(command));
          },
        }),
    async submit(command) {
      return observeRuntimeCommand('REQUEST_REJECTED', command, options, () => inner.submit(command));
    },
    async cancel(command) {
      return observeRuntimeCommand('REQUEST_CONTROL_REJECTED', command, options, () => inner.cancel(command));
    },
    async retryLatest(command) {
      return observeRuntimeCommand('REQUEST_REJECTED', command, options, () => inner.retryLatest(command));
    },
    async editLatest(command) {
      return observeRuntimeCommand('REQUEST_REJECTED', command, options, () => inner.editLatest(command));
    },
    async answerPendingInput(command) {
      return observeRuntimeCommand('PENDING_INPUT_REJECTED', command, options, () => inner.answerPendingInput(command));
    },
    ...(inner.hideRunMessages === undefined ? {} : { hideRunMessages: inner.hideRunMessages.bind(inner) }),
  };
}

async function observeRuntimeCommand<T>(
  operation: string,
  command:
    | ObservableReserveSubmitCommand
    | ObservableSubmitRequestCommand
    | ObservableRequestControlCommand
    | ObservableEditLatestRequestCommand
    | ObservableAnswerPendingInputCommand,
  options: ObservedRuntimeCommandPortOptions,
  invoke: () => Promise<T>,
): Promise<T> {
  const startedAt = performance.now();
  try {
    return await invoke();
  } catch (error) {
    acceptRuntimeCommandObservation(options, runtimeCommandRejectedObservation(operation, command, error, startedAt, options));
    throw error;
  }
}

function runtimeCommandRejectedObservation(
  operation: string,
  command:
    | ObservableReserveSubmitCommand
    | ObservableSubmitRequestCommand
    | ObservableRequestControlCommand
    | ObservableEditLatestRequestCommand
    | ObservableAnswerPendingInputCommand,
  error: unknown,
  startedAt: number,
  options: ObservedRuntimeCommandPortOptions,
): ObservabilityObservationEvent {
  const safe = safeError(error);
  const sessionId = 'answer' in command ? command.answer.sessionId : command.sessionId;
  const stableSessionId = sessionId ?? 'new-session';
  const ownerScope: TrustedOwnerScope = {
    tenantId: command.identityContext.tenantId,
    subjectId: command.identityContext.subjectId,
    agentId: options.defaultRouteAgentScope.agentId,
    agentVersion: options.defaultRouteAgentScope.agentVersion,
  };
  const diagnosticSnapshot: ObservabilityContext = {
    tenantId: ownerScope.tenantId,
    subjectId: ownerScope.subjectId,
    agentId: ownerScope.agentId,
    agentVersion: ownerScope.agentVersion,
    ...(sessionId === undefined ? {} : { sessionId: brand<string, 'SessionId'>(sessionId) }),
    diagnosticCandidates: [
      { key: 'command', value: operation, classification: 'LOW_CARDINALITY', cardinality: 'LOW' },
      { key: 'safeErrorCategory', value: safe.category, classification: 'LOW_CARDINALITY', cardinality: 'LOW' },
      ...('action' in command
        ? [{ key: 'action', value: command.action, classification: 'LOW_CARDINALITY' as const, cardinality: 'LOW' as const }]
        : []),
    ],
  };
  return createObservationEvent({
    boundary: 'request_lifecycle',
    operation,
    outcome: safe.category === 'AUTHORIZATION' ? 'denied' : 'failure',
    ownerScope,
    occurredAt: brand<number, 'EpochMillis'>((options.now ?? Date.now)()),
    durationMs: Math.max(0, Math.round(performance.now() - startedAt)),
    safeSummary: 'Runtime command rejected safely.',
    safeReasonCode: safe.code,
    stableRefs: {
      ...(sessionId === undefined ? {} : { sessionId }),
      auditEventId: `audit:${operation}:${ownerScope.tenantId}:${ownerScope.subjectId}:${stableSessionId}:${command.idempotencyKey}`,
    },
    diagnosticSnapshot,
  });
}

function acceptRuntimeCommandObservation(options: ObservedRuntimeCommandPortOptions, event: ObservabilityObservationEvent): void {
  try {
    options.acceptObservation(event);
  } catch {
    // Observation handoff must not affect runtime command semantics.
  }
}

function safeError(error: unknown): { readonly code: string; readonly category: string } {
  if (error !== null && typeof error === 'object') {
    const candidate = error as { readonly code?: unknown; readonly category?: unknown };
    if (typeof candidate.code === 'string' && typeof candidate.category === 'string') {
      return { code: candidate.code, category: candidate.category };
    }
  }
  return { code: 'RUNTIME_COMMAND_REJECTED', category: 'INTERNAL' };
}
