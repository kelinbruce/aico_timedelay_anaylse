import {
  AgentError,
  brand,
  getLogger,
  truncateUtf8,
  type JsonObject,
  type MessageId,
  type RequestRunId,
  type SafeError,
  type SessionId,
} from '@nextagent/agent-common';
import type { AgentAssemblyRegistry } from '@nextagent/agent-contracts/agent-assembly';
import type { SubagentExecutionPort, SubagentExecutionRequest, SubagentExecutionResult } from '@nextagent/agent-contracts/capability';
import type { RequestControlCommand, RuntimeCommandPort, RequestAccepted, RuntimeSessionPort } from '@nextagent/agent-contracts/runtime';

const defaultSubagentTimeoutMs = 120_000;
const maxTerminalTextBytes = 100_000;

const logger = getLogger({ component: 'agent-runtime', source: 'subagent-execution-port' });

interface TerminalWaitResult {
  readonly status: SubagentExecutionResult['status'];
  readonly terminalText?: string;
  readonly safeError?: SafeError;
}

type TerminalTextRecovery =
  | { readonly status: 'FOUND'; readonly text: string }
  | { readonly status: 'NO_ASSISTANT_MESSAGE' }
  | { readonly status: 'NO_MESSAGES' }
  | { readonly status: 'NOT_FOUND'; readonly safeError: SafeError };

export interface RuntimeSubagentExecutionPortDependencies {
  readonly assemblyRegistry: AgentAssemblyRegistry;
  readonly runtime: RuntimeCommandPort & RuntimeSessionPort;
}

export function createRuntimeSubagentExecutionPort(deps: RuntimeSubagentExecutionPortDependencies): SubagentExecutionPort {
  return new RuntimeSubagentExecutionPort(deps);
}

export function createDeferredSubagentExecutionPort(resolvePort: () => SubagentExecutionPort | undefined): SubagentExecutionPort {
  return {
    async executeSubagent(request, signal) {
      const port = resolvePort();
      if (port === undefined) {
        return {
          status: 'FAILED',
          terminalText: '',
          safeError: safeError('SUBAGENT_EXECUTION_UNAVAILABLE', 'Subagent execution boundary is unavailable.', 'UNAVAILABLE'),
        };
      }
      return port.executeSubagent(request, signal);
    },
  };
}

class RuntimeSubagentExecutionPort implements SubagentExecutionPort {
  constructor(private readonly deps: RuntimeSubagentExecutionPortDependencies) {}

  async executeSubagent(request: SubagentExecutionRequest, signal: AbortSignal): Promise<SubagentExecutionResult> {
    if (request.targetProviderKind !== 'BUNDLED' && request.targetProviderKind !== 'LOCAL_DIRECTORY') {
      return failed('REMOTE_AGENT_EXECUTION_UNSUPPORTED', 'Remote agent execution is not yet supported.');
    }
    let accepted: RequestAccepted | undefined;
    try {
      const assembly =
        request.targetAgentVersion === undefined
          ? await this.deps.assemblyRegistry.active(request.targetAgentId)
          : await this.deps.assemblyRegistry.require(request.targetAgentId, request.targetAgentVersion);
      const timeoutMs = assembly.runtimeSettings.requestTimeoutMs ?? defaultSubagentTimeoutMs;
      accepted = await this.deps.runtime.submit({
        agentId: request.targetAgentId,
        agentVersion: assembly.agentVersion,
        identityContext: request.identityContext,
        inputText: request.prompt,
        attachmentIds: [],
        locale: request.locale,
        parentSessionId: request.parentSessionId,
        parentRunId: request.parentRunId,
        parentRequestId: request.parentRequestId,
        priority: 'LOW',
        idempotencyKey: request.idempotencyKey,
      });
      logger.info({
        event: 'runtime.subagent.submitted',
        ...subagentCorrelationFields(request, accepted.sessionId, accepted.runId, accepted.requestId),
        timeoutMs,
      });
      const waitResult = await this.waitForTerminal(request, accepted.sessionId, accepted.requestId, accepted.runId, timeoutMs, signal);
      const terminalText =
        waitResult.status === 'CANCELED' || waitResult.status === 'TIMED_OUT'
          ? ''
          : (waitResult.terminalText ?? (await this.terminalText(request, accepted.sessionId, accepted.requestId)));
      const result: SubagentExecutionResult = {
        status: waitResult.status,
        terminalText,
        childSessionId: accepted.sessionId,
        childRunId: accepted.runId,
        ...(waitResult.status === 'FAILED'
          ? { safeError: waitResult.safeError ?? safeError('SUBAGENT_EXECUTION_FAILED', 'Subagent execution failed safely.', 'INTERNAL') }
          : {}),
      };
      logSubagentSettled(request, result, accepted);
      return result;
    } catch (error) {
      const result: SubagentExecutionResult = {
        status: signal.aborted ? 'CANCELED' : 'FAILED',
        terminalText: '',
        ...(accepted === undefined ? {} : { childSessionId: accepted.sessionId, childRunId: accepted.runId }),
        safeError: normalizeSafeError(error),
      };
      logger.error({
        err: error,
        event: 'runtime.subagent.exception_captured',
        ...subagentCorrelationFields(request, accepted?.sessionId, accepted?.runId, accepted?.requestId),
        status: result.status,
        safeErrorCode: result.safeError!.code,
        safeErrorCategory: result.safeError!.category,
      });
      return result;
    }
  }

  private async waitForTerminal(
    request: SubagentExecutionRequest,
    childSessionId: SessionId,
    childRequestId: MessageId,
    childRunId: RequestRunId,
    timeoutMs: number,
    signal: AbortSignal,
  ): Promise<TerminalWaitResult> {
    let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
    const timeoutController = new AbortController();
    const streamController = new AbortController();
    const abort = () => streamController.abort();
    let lastSeenSequence = brand<number, 'TimelineSequence'>(0);
    signal.addEventListener('abort', abort, { once: true });
    timeoutHandle = setTimeout(() => {
      timeoutController.abort();
      streamController.abort();
    }, timeoutMs);
    try {
      while (true) {
        if (signal.aborted) {
          await this.cancelChild(request, childSessionId, childRequestId);
          return { status: 'CANCELED' };
        }
        if (timeoutController.signal.aborted) {
          await this.cancelChild(request, childSessionId, childRequestId);
          return { status: 'TIMED_OUT' };
        }
        try {
          for await (const event of this.deps.runtime.streamEvents({
            identityContext: request.identityContext,
            sessionId: childSessionId,
            requestId: childRequestId,
            runId: childRunId,
            lastSeenSequence,
            signal: streamController.signal,
          })) {
            if (event.sequence !== undefined) {
              lastSeenSequence = event.sequence;
            }
            if (event.type === 'REQUEST_COMPLETED') {
              return { status: 'COMPLETED' };
            }
            if (event.type === 'REQUEST_FAILED') {
              return { status: 'FAILED' };
            }
            if (event.type === 'REQUEST_CANCELED') {
              return { status: 'CANCELED' };
            }
          }
        } catch {
          if (signal.aborted) {
            await this.cancelChild(request, childSessionId, childRequestId);
            return { status: 'CANCELED' };
          }
          if (timeoutController.signal.aborted) {
            await this.cancelChild(request, childSessionId, childRequestId);
            return { status: 'TIMED_OUT' };
          }
          const active = await this.deps.runtime.getActiveRun({
            identityContext: request.identityContext,
            sessionId: childSessionId,
          });
          if (active === undefined) {
            return this.recoverInactiveRunTerminal(request, childSessionId, childRequestId);
          }
        }
      }
    } finally {
      if (timeoutHandle !== undefined) {
        clearTimeout(timeoutHandle);
      }
      signal.removeEventListener('abort', abort);
    }
  }

  private async cancelChild(request: SubagentExecutionRequest, childSessionId: SessionId, childRequestId: MessageId): Promise<void> {
    const command: RequestControlCommand = {
      sessionId: childSessionId,
      identityContext: request.identityContext,
      expectedLatestRequestId: childRequestId,
      action: 'CANCEL',
      idempotencyKey: brand<string, 'IdempotencyKey'>(`${request.idempotencyKey}:cancel`),
    };
    await this.deps.runtime.cancel(command).catch(() => undefined);
  }

  private async terminalText(request: SubagentExecutionRequest, childSessionId: SessionId, childRequestId: MessageId): Promise<string> {
    const recovery = await this.recoverTerminalText(request, childSessionId, childRequestId);
    if (recovery.status === 'FOUND') {
      return recovery.text;
    }
    if (recovery.status === 'NO_ASSISTANT_MESSAGE' || recovery.status === 'NO_MESSAGES') {
      return '';
    }
    throw new AgentError({
      code: recovery.safeError.code,
      message: recovery.safeError.message,
      category: recovery.safeError.category,
      retryable: recovery.safeError.retryable,
      ...(recovery.safeError.safeDetails === undefined ? {} : { safeDetails: recovery.safeError.safeDetails }),
    });
  }

  private async recoverInactiveRunTerminal(
    request: SubagentExecutionRequest,
    childSessionId: SessionId,
    childRequestId: MessageId,
  ): Promise<TerminalWaitResult> {
    const recovery = await this.recoverTerminalText(request, childSessionId, childRequestId);
    if (recovery.status === 'FOUND') {
      return { status: 'COMPLETED', terminalText: recovery.text };
    }
    if (recovery.status === 'NO_ASSISTANT_MESSAGE') {
      return { status: 'COMPLETED', terminalText: '' };
    }
    if (recovery.status === 'NO_MESSAGES') {
      return {
        status: 'FAILED',
        safeError: safeError('SUBAGENT_TERMINAL_MESSAGES_EMPTY', 'Subagent terminal messages were empty after the run became inactive.', 'INTERNAL'),
      };
    }
    return { status: 'FAILED', safeError: recovery.safeError };
  }

  private async recoverTerminalText(
    request: SubagentExecutionRequest,
    childSessionId: SessionId,
    childRequestId: MessageId,
  ): Promise<TerminalTextRecovery> {
    const page = await this.deps.runtime
      .listMessages({
        identityContext: request.identityContext,
        sessionId: childSessionId,
        requestId: childRequestId,
        includeCapabilityResults: false,
        limit: 100,
      })
      .catch((error: unknown) => {
        if (error instanceof AgentError && error.category === 'NOT_FOUND') {
          return undefined;
        }
        throw error;
      });
    if (page === undefined) {
      return {
        status: 'NOT_FOUND',
        safeError: safeError(
          'SUBAGENT_TERMINAL_MESSAGES_NOT_FOUND',
          'Subagent terminal messages were not found after the run became inactive.',
          'NOT_FOUND',
        ),
      };
    }
    if (page.items.length === 0) {
      return { status: 'NO_MESSAGES' };
    }
    const assistant = [...page.items].reverse().find((message) => message.role === 'ASSISTANT');
    if (assistant === undefined) {
      return { status: 'NO_ASSISTANT_MESSAGE' };
    }
    return { status: 'FOUND', text: truncateUtf8(assistant.content, maxTerminalTextBytes) };
  }
}

function failed(code: string, message: string): SubagentExecutionResult {
  return {
    status: 'FAILED',
    terminalText: '',
    safeError: safeError(code, message, 'UNAVAILABLE'),
  };
}

function safeError(code: string, message: string, category: SafeError['category']): SafeError {
  return { code, message, category, retryable: false };
}

function normalizeSafeError(error: unknown): SafeError {
  if (error instanceof AgentError) {
    return {
      code: error.code,
      message: error.message,
      category: error.category,
      retryable: error.retryable,
      ...(error.safeDetails === undefined ? {} : { safeDetails: error.safeDetails }),
    };
  }
  return safeError('SUBAGENT_EXECUTION_FAILED', 'Subagent execution failed safely.', 'INTERNAL');
}

function subagentCorrelationFields(
  request: SubagentExecutionRequest,
  childSessionId?: SessionId,
  childRunId?: RequestRunId,
  childRequestId?: MessageId,
): JsonObject {
  return {
    tenantId: request.identityContext.tenantId,
    subjectId: request.identityContext.subjectId,
    targetAgentId: request.targetAgentId,
    parentSessionId: request.parentSessionId,
    parentRunId: request.parentRunId,
    parentRequestId: request.parentRequestId,
    parentToolCallId: request.parentToolCallId,
    idempotencyKey: request.idempotencyKey,
    ...(childSessionId === undefined ? {} : { childSessionId }),
    ...(childRunId === undefined ? {} : { childRunId }),
    ...(childRequestId === undefined ? {} : { childRequestId }),
  };
}

function logSubagentSettled(request: SubagentExecutionRequest, result: SubagentExecutionResult, accepted: RequestAccepted): void {
  const fields = subagentCorrelationFields(request, accepted.sessionId, accepted.runId, accepted.requestId);
  if (result.status === 'COMPLETED') {
    logger.info({ event: 'runtime.subagent.settled', ...fields, status: result.status });
  } else {
    logger.warn({
      event: 'runtime.subagent.settled',
      ...fields,
      status: result.status,
      ...(result.safeError === undefined ? {} : { safeErrorCode: result.safeError.code, safeErrorCategory: result.safeError.category }),
    });
  }
}
