import {
  brand,
  type AgentId,
  type AgentVersion,
  type EpochMillis,
  type MessageId,
  type RequestRunId,
  type SessionId,
  type SubjectId,
  type TenantId,
} from '@nextagent/agent-common';
import type { ContextAssembly, ContextAssemblyOptions, ContextAssemblyRequest, ContextEnginePort } from '@nextagent/agent-contracts/context';
import type { SandboxExecutionRequest, SandboxExecutionResult } from '@nextagent/agent-contracts/gateway';
import { createObservationEvent, type ObservabilityObservationEvent, type TrustedOwnerScope } from '../linking/observation.js';

export interface ObservationAcceptor {
  acceptObservation: (event: ObservabilityObservationEvent) => void;
}

export interface RuntimeExecutionStateObservationInput {
  readonly tenantId: TenantId;
  readonly subjectId: SubjectId;
  readonly agentId: AgentId;
  readonly agentVersion: AgentVersion;
  readonly sessionId: SessionId;
  readonly runId: RequestRunId;
  readonly requestId: MessageId;
  readonly transition: 'ENTERED' | 'LEFT';
  readonly occurredAt: EpochMillis;
  readonly activeCount: number;
  readonly queueDurationMs?: number;
}

export function runtimeExecutionStateObservation(input: RuntimeExecutionStateObservationInput): ObservabilityObservationEvent {
  if (!Number.isSafeInteger(input.activeCount) || input.activeCount < 0) {
    throw new Error('Runtime execution active count must be a non-negative safe integer.');
  }
  if (input.queueDurationMs !== undefined && (!Number.isFinite(input.queueDurationMs) || input.queueDurationMs < 0)) {
    throw new Error('Runtime execution queue duration must be finite and non-negative.');
  }
  return createObservationEvent({
    boundary: 'request_lifecycle',
    operation: input.transition === 'ENTERED' ? 'REQUEST_EXECUTION_STARTED' : 'REQUEST_EXECUTION_ENDED',
    outcome: 'success',
    ownerScope: {
      tenantId: input.tenantId,
      subjectId: input.subjectId,
      agentId: input.agentId,
      agentVersion: input.agentVersion,
    },
    occurredAt: input.occurredAt,
    ...(input.transition === 'ENTERED' && input.queueDurationMs !== undefined ? { durationMs: input.queueDurationMs } : {}),
    safeSummary: input.transition === 'ENTERED' ? 'Request entered execution.' : 'Request left execution.',
    stableRefs: {
      sessionId: input.sessionId,
      requestRunId: input.runId,
      requestId: input.requestId,
    },
    diagnosticSnapshot: {
      tenantId: input.tenantId,
      subjectId: input.subjectId,
      agentId: input.agentId,
      agentVersion: input.agentVersion,
      sessionId: input.sessionId,
      requestRunId: input.runId,
      diagnosticCandidates: [{ key: 'activeCount', value: input.activeCount, classification: 'LOW_CARDINALITY', cardinality: 'LOW' }],
    },
  });
}

export function createObservedContextEngine<T extends ContextEnginePort>(inner: T, acceptor: ObservationAcceptor): T {
  return {
    ...inner,
    async assemble(request: ContextAssemblyRequest, options: ContextAssemblyOptions | undefined, signal: AbortSignal): Promise<ContextAssembly> {
      const startedAt = performance.now();
      try {
        const result = await inner.assemble(request, options, signal);
        acceptSafely(acceptor, contextObservation(request, result, 'success', durationMs(startedAt)));
        return result;
      } catch (error) {
        acceptSafely(acceptor, contextFailureObservation(request, error, durationMs(startedAt)));
        throw error;
      }
    },
    render: (assembly: ContextAssembly) => inner.render(assembly),
  } as T;
}

export interface ObservableSandboxGateway {
  execute: (request: SandboxExecutionRequest, signal?: AbortSignal) => Promise<SandboxExecutionResult>;
  executeWithStdoutChunks?: (
    request: SandboxExecutionRequest,
    options: { readonly onStdoutChunk: (chunk: string) => void },
    signal?: AbortSignal,
  ) => Promise<SandboxExecutionResult>;
  startBackground?: unknown;
  killBackground?: unknown;
}

export function createObservedSandboxGateway<T extends ObservableSandboxGateway>(
  inner: T,
  input: {
    readonly ownerScope: TrustedOwnerScope;
    readonly acceptor: ObservationAcceptor;
  },
): T {
  const observed = Object.create(Object.getPrototypeOf(inner)) as T & Record<string, unknown>;
  Object.assign(observed, inner);
  observed.execute = (request, signal) => observeSandboxInvocation(inner.execute.bind(inner), request, signal, input);
  if (inner.executeWithStdoutChunks !== undefined) {
    observed.executeWithStdoutChunks = (request, options, signal) =>
      observeSandboxInvocation(
        (candidate, candidateSignal) => inner.executeWithStdoutChunks!(candidate, options, candidateSignal),
        request,
        signal,
        input,
      );
  }
  const background = inner as T & { startBackground?: (...args: never[]) => unknown; killBackground?: (...args: never[]) => unknown };
  if (typeof background.startBackground === 'function') {
    observed.startBackground = background.startBackground.bind(inner);
  }
  if (typeof background.killBackground === 'function') {
    observed.killBackground = background.killBackground.bind(inner);
  }
  return observed;
}

async function observeSandboxInvocation(
  invoke: (request: SandboxExecutionRequest, signal?: AbortSignal) => Promise<SandboxExecutionResult>,
  request: SandboxExecutionRequest,
  signal: AbortSignal | undefined,
  input: { readonly ownerScope: TrustedOwnerScope; readonly acceptor: ObservationAcceptor },
): Promise<SandboxExecutionResult> {
  const startedAt = performance.now();
  acceptSafely(input.acceptor, sandboxObservation(input.ownerScope, request, 'SANDBOX_EXECUTION_STARTED', 'success', 0));
  try {
    const result = await invoke(request, signal);
    const terminal = sandboxTerminal(result);
    acceptSafely(
      input.acceptor,
      sandboxObservation(input.ownerScope, request, terminal.operation, terminal.outcome, durationMs(startedAt), result.safeError),
    );
    return result;
  } catch (error) {
    const safe = safeError(error, 'SANDBOX_EXECUTION_FAILED');
    acceptSafely(
      input.acceptor,
      sandboxObservation(
        input.ownerScope,
        request,
        safe.category === 'AUTHORIZATION' || safe.category === 'POLICY_DENIED'
          ? 'SANDBOX_EXECUTION_DENIED'
          : safe.category === 'TIMEOUT'
            ? 'SANDBOX_EXECUTION_TIMED_OUT'
            : 'SANDBOX_EXECUTION_FAILED',
        safe.category === 'AUTHORIZATION' || safe.category === 'POLICY_DENIED'
          ? 'denied'
          : safe.category === 'TIMEOUT'
            ? 'timeout'
            : safe.category === 'CANCELED'
              ? 'canceled'
              : 'failure',
        durationMs(startedAt),
        safe,
      ),
    );
    throw error;
  }
}

function contextObservation(
  request: ContextAssemblyRequest,
  assembly: ContextAssembly,
  outcome: 'success',
  elapsed: number,
): ObservabilityObservationEvent {
  const plan = assembly.budgetPlan;
  return createObservationEvent({
    boundary: 'system',
    operation: 'CONTEXT_ASSEMBLY_COMPLETED',
    outcome,
    ownerScope: ownerScopeFromContext(request),
    occurredAt: now(),
    durationMs: elapsed,
    safeSummary: 'Context assembly completed.',
    ...(plan?.reasonCode === undefined ? {} : { safeReasonCode: plan.reasonCode }),
    stableRefs: contextRefs(request),
    diagnosticSnapshot: {
      tenantId: request.identityContext.tenantId,
      subjectId: request.identityContext.subjectId,
      agentId: request.agentId,
      agentVersion: request.agentVersion,
      sessionId: request.sessionId,
      requestRunId: request.runId,
      requestContextId: request.requestContextId,
      diagnosticCandidates: [
        ...(plan === undefined
          ? []
          : [
              low('decision', plan.decision),
              low('reasonCode', plan.reasonCode),
              low('compressionMode', plan.compressionMode),
              low('evidenceCount', assembly.budgetEvidence?.length ?? 0),
              low('roleEvidenceCount', assembly.budgetRoleEvidence?.length ?? 0),
              low('degradationModeCount', plan.degradationMode.length),
              low('omittedContextTypesCount', plan.omittedContextTypes.length),
              low('estimatedFinalInputUnits', plan.estimatedFinalInputUnits),
              low('pipelineStageStoppedAt', plan.pipelineStageStoppedAt),
            ]),
      ],
    },
  });
}

function contextFailureObservation(request: ContextAssemblyRequest, error: unknown, elapsed: number): ObservabilityObservationEvent {
  const safe = safeError(error);
  return createObservationEvent({
    boundary: 'system',
    operation: 'CONTEXT_ASSEMBLY_FAILED',
    outcome: safe.category === 'TIMEOUT' ? 'timeout' : safe.category === 'CANCELED' ? 'canceled' : 'failure',
    ownerScope: ownerScopeFromContext(request),
    occurredAt: now(),
    durationMs: elapsed,
    safeSummary: 'Context assembly failed safely.',
    safeReasonCode: safe.code,
    stableRefs: contextRefs(request),
    diagnosticSnapshot: {
      tenantId: request.identityContext.tenantId,
      subjectId: request.identityContext.subjectId,
      agentId: request.agentId,
      agentVersion: request.agentVersion,
      sessionId: request.sessionId,
      requestRunId: request.runId,
      requestContextId: request.requestContextId,
      diagnosticCandidates: [low('safeErrorCategory', safe.category)],
    },
  });
}

function sandboxObservation(
  ownerScope: TrustedOwnerScope,
  request: SandboxExecutionRequest,
  operation: string,
  outcome: ObservabilityObservationEvent['outcome'],
  elapsed: number,
  error?: { readonly code: string; readonly category: string },
): ObservabilityObservationEvent {
  const safeErrorCode = error?.code === 'UNEXPECTED_ERROR' && operation === 'SANDBOX_EXECUTION_FAILED' ? 'SANDBOX_EXECUTION_FAILED' : error?.code;
  return createObservationEvent({
    boundary: 'gateway_call',
    operation,
    outcome,
    ownerScope: {
      tenantId: request.tenantId,
      subjectId: request.subjectId,
      agentId: ownerScope.agentId,
      agentVersion: ownerScope.agentVersion,
    },
    occurredAt: now(),
    durationMs: elapsed,
    safeSummary: outcome === 'success' ? 'Sandbox execution stage completed.' : 'Sandbox execution stage failed safely.',
    ...(safeErrorCode === undefined ? {} : { safeReasonCode: safeErrorCode }),
    stableRefs: { requestRunId: request.requestRunId },
    diagnosticSnapshot: {
      tenantId: request.tenantId,
      subjectId: request.subjectId,
      agentId: ownerScope.agentId,
      agentVersion: ownerScope.agentVersion,
      requestRunId: request.requestRunId,
      diagnosticCandidates: [
        low('executableKind', request.executable),
        low('executionId', request.executionId),
        ...(error === undefined ? [] : [low('safeErrorCategory', error.category)]),
      ],
    },
  });
}

function sandboxTerminal(result: SandboxExecutionResult): { readonly operation: string; readonly outcome: ObservabilityObservationEvent['outcome'] } {
  if (result.timedOut || result.safeError?.category === 'TIMEOUT') {
    return { operation: 'SANDBOX_EXECUTION_TIMED_OUT', outcome: 'timeout' };
  }
  if (result.safeError?.category === 'AUTHORIZATION' || result.safeError?.category === 'POLICY_DENIED') {
    return { operation: 'SANDBOX_EXECUTION_DENIED', outcome: 'denied' };
  }
  if (result.safeError !== undefined || (result.exitCode !== undefined && result.exitCode !== 0)) {
    return { operation: 'SANDBOX_EXECUTION_FAILED', outcome: 'failure' };
  }
  return { operation: 'SANDBOX_EXECUTION_COMPLETED', outcome: 'success' };
}

function ownerScopeFromContext(request: ContextAssemblyRequest): TrustedOwnerScope {
  return {
    tenantId: request.identityContext.tenantId,
    subjectId: request.identityContext.subjectId,
    agentId: request.agentId,
    agentVersion: request.agentVersion,
  };
}

function contextRefs(request: ContextAssemblyRequest) {
  return { sessionId: request.sessionId, requestRunId: request.runId, requestContextId: request.requestContextId, requestId: request.requestId };
}

function safeError(error: unknown, fallbackCode = 'UNEXPECTED_ERROR'): { readonly code: string; readonly category: string } {
  if (error !== null && typeof error === 'object') {
    const candidate = error as { readonly code?: unknown; readonly category?: unknown };
    if (typeof candidate.code === 'string' && typeof candidate.category === 'string') {
      return { code: candidate.code === 'UNEXPECTED_ERROR' ? fallbackCode : candidate.code, category: candidate.category };
    }
  }
  return { code: fallbackCode, category: 'INTERNAL' };
}

function low(key: string, value: string | number | boolean) {
  return { key, value, classification: 'LOW_CARDINALITY' as const, cardinality: 'LOW' as const };
}

function acceptSafely(acceptor: ObservationAcceptor, event: ObservabilityObservationEvent): void {
  try {
    acceptor.acceptObservation(event);
  } catch {
    /* advisory */
  }
}

function durationMs(startedAt: number): number {
  return Math.max(0, Math.round(performance.now() - startedAt));
}
function now(): EpochMillis {
  return brand<number, 'EpochMillis'>(Date.now());
}
