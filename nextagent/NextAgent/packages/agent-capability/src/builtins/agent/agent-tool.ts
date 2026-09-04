import { brand, deriveCapabilityInvocationIdempotencyKey, truncateUtf8, type JsonObject, type SafeError } from '@nextagent/agent-common';
import type { CapabilityInvocationResult, SubagentExecutionResult } from '@nextagent/agent-contracts/capability';

import { defineTool, type ToolExecuteOptions } from '../../tools/tool-spi.js';
import { agentToolInputSchema, agentToolOutputSchema, agentToolPromptMaxBytes, agentToolResultTextMaxBytes } from './agent-schemas.js';

export const agentToolCapabilityId = brand<string, 'CapabilityId'>('Agent');

export const agentToolDefinition = defineTool({
  name: agentToolCapabilityId,
  description:
    'Delegate one concrete, bounded, self-contained sub-task to an exact governed Agent capability id listed under Available agents, then wait for its safe terminal result text. ' +
    'The delegated Agent starts fresh and does not inherit parent conversation context, so include every required fact and exact file path in `prompt`. ' +
    'Do not use Agent to create a persistent work item that must be listed, queried later by status, read by incremental output, updated, or stopped; use the Task tools for managed Task lifecycle. ' +
    'Do not use Agent to read a specific file path, find files by name, or grep code when Read, Glob, or Grep already fit directly. ' +
    'It cannot invoke itself. Only `status: completed` carries a successful result; timeout, cancellation, unavailable Agent, and child failure remain incomplete or failed.',
  inputSchema: agentToolInputSchema,
  outputSchema: agentToolOutputSchema,
  disclosurePolicy: { mode: 'EAGER' },
  requiredDependencies: ['subagentExecution'],
  replayPolicy: 'NON_IDEMPOTENT',
  returnsCapabilityResult: true,
  async execute(input, options) {
    return executeAgentTool(input, options);
  },
});

async function executeAgentTool(input: JsonObject, options?: ToolExecuteOptions): Promise<CapabilityInvocationResult> {
  if (options?.signal?.aborted) {
    return failed('ABORTED', 'Agent tool invocation was aborted.', 'CANCELED');
  }
  const validation = validateInput(input);
  if (validation !== undefined) {
    return validation;
  }
  const context = options?.context;
  const subagentExecution = options?.deps?.subagentExecution;
  if (context === undefined || subagentExecution === undefined) {
    return failed(
      'EXECUTION_FAILED',
      'Agent delegation could not start because its governed execution boundary or trusted context is unavailable. Use another available capability, complete the task without delegation, or stop and report the unavailable boundary.',
      'UNAVAILABLE',
    );
  }
  const agentId = input.agentId as string;
  const prompt = input.prompt as string;
  if (agentId === context.agentId) {
    return failed(
      'SELF_INVOCATION_REJECTED',
      'The current Agent cannot delegate to itself, so no child execution started. Choose a different available Agent or complete the subtask directly.',
      'VALIDATION',
    );
  }
  const descriptor = await context.capabilityResolver?.resolveCapability(
    { kind: 'AGENT', capabilityId: brand<string, 'CapabilityId'>(agentId) },
    options?.signal ?? new AbortController().signal,
  );
  if (
    descriptor === undefined ||
    descriptor.kind !== 'AGENT' ||
    descriptor.availabilityStatus !== 'AVAILABLE' ||
    descriptor.modelInvocable !== true
  ) {
    return failed(
      'AGENT_NOT_AVAILABLE',
      'The requested Agent is not available in the current governed scope, so delegation did not start. Choose an Agent id currently listed as available, use another capability, or complete the subtask directly.',
      'UNAVAILABLE',
    );
  }
  const result = await subagentExecution.executeSubagent(
    {
      targetAgentId: brand<string, 'AgentId'>(agentId),
      ...(descriptor.version === undefined ? {} : { targetAgentVersion: brand<string, 'AgentVersion'>(descriptor.version) }),
      targetProviderKind: descriptor.provider.providerKind,
      prompt,
      parentSessionId: context.sessionId,
      parentRunId: context.runId,
      parentRequestId: context.requestId,
      parentToolCallId: context.toolCallId,
      identityContext: context.identityContext,
      locale: context.locale ?? brand<string, 'RequestLocale'>('zh-CN'),
      idempotencyKey: deriveCapabilityInvocationIdempotencyKey(context.runId, context.toolCallId),
    },
    options?.signal ?? new AbortController().signal,
  );
  return mapSubagentResult(agentId, result);
}

function validateInput(input: JsonObject): CapabilityInvocationResult | undefined {
  if (typeof input.agentId !== 'string' || input.agentId.length === 0) {
    return failed(
      'INVALID_INPUT',
      'Agent validation failed before delegation: agentId must be a non-empty string. Supply an available Agent id and call again.',
      'VALIDATION',
    );
  }
  if (typeof input.prompt !== 'string' || input.prompt.length === 0) {
    return failed(
      'INVALID_INPUT',
      'Agent validation failed before delegation: prompt must be a non-empty string. Supply a self-contained subtask prompt and call again.',
      'VALIDATION',
    );
  }
  for (const key of Object.keys(input)) {
    if (key !== 'agentId' && key !== 'prompt') {
      return failed(
        'INVALID_INPUT',
        'Agent validation failed before delegation: input supports only agentId and prompt. Remove unsupported fields and call again.',
        'VALIDATION',
      );
    }
  }
  if (Buffer.byteLength(input.prompt, 'utf8') > agentToolPromptMaxBytes) {
    return failed(
      'INVALID_INPUT',
      `Agent validation failed before delegation: prompt must not exceed ${agentToolPromptMaxBytes} UTF-8 bytes. Shorten the prompt and call again.`,
      'VALIDATION',
    );
  }
  return undefined;
}

function mapSubagentResult(agentId: string, result: SubagentExecutionResult): CapabilityInvocationResult {
  if (result.status === 'COMPLETED') {
    if (result.safeError !== undefined) {
      return invalidChildResult();
    }
    return {
      status: 'SUCCEEDED',
      structuredPayload: {
        agentId,
        status: 'completed',
        result: { text: truncateUtf8(result.terminalText, agentToolResultTextMaxBytes) },
      },
      generatedMessages: [],
      artifactRefs: [],
    };
  }
  if (result.status === 'TIMED_OUT') {
    if (result.safeError !== undefined && result.safeError.category !== 'TIMEOUT') {
      return invalidChildResult();
    }
    return terminalFailure(
      'TIMED_OUT',
      result.safeError ?? {
        code: 'TIMEOUT',
        message:
          'The delegated Agent timed out before producing a complete result. Do not repeat the same delegation unchanged; narrow the subtask, use another capability, or stop and report the timeout.',
        category: 'TIMEOUT',
        retryable: false,
      },
    );
  }
  if (result.status === 'CANCELED') {
    const canceledSafeError = result.safeError?.category === 'CANCELED' ? result.safeError : undefined;
    return terminalFailure(
      'FAILED',
      canceledSafeError ?? { code: 'ABORTED', message: 'Subagent execution was aborted.', category: 'CANCELED', retryable: false },
    );
  }
  const safeError = result.safeError ?? {
    code: 'EXECUTION_FAILED',
    message:
      'The delegated Agent failed at its governed execution boundary without a usable terminal result. Use another capability, complete the task without delegation, or stop and report the child execution failure.',
    category: 'INTERNAL',
    retryable: false,
  };
  return terminalFailure(safeError.category === 'TIMEOUT' ? 'TIMED_OUT' : 'FAILED', safeError);
}

function invalidChildResult(): CapabilityInvocationResult {
  return failed('AGENT_CHILD_RESULT_INVALID', 'Subagent returned an invalid terminal result. Stop this delegation and report the error.', 'INTERNAL');
}

function failed(code: string, message: string, category: SafeError['category'], safeError?: SafeError): CapabilityInvocationResult {
  return {
    status: 'FAILED',
    structuredPayload: {},
    generatedMessages: [],
    artifactRefs: [],
    safeError: safeError ?? { code, message, category, retryable: false },
  };
}

function terminalFailure(status: 'FAILED' | 'TIMED_OUT', safeError: SafeError): CapabilityInvocationResult {
  return {
    status,
    structuredPayload: {},
    generatedMessages: [],
    artifactRefs: [],
    safeError,
  };
}
