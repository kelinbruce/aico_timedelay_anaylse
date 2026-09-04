import { evaluateRecoveryToolReplayGuard } from '@nextagent/agent-runtime';
import { brand } from '@nextagent/agent-common';
import type { CheckpointRecord, SessionMessageRecord } from '@nextagent/agent-contracts/gateway';
import type { RequestContext, RequestRun, ToolCallState } from '@nextagent/agent-contracts/runtime';
import { describe, expect, it } from 'vitest';

const tenantId = brand<string, 'TenantId'>('tenant-1');
const subjectId = brand<string, 'SubjectId'>('subject-1');
const agentId = brand<string, 'AgentId'>('default-agent');
const agentVersion = brand<string, 'AgentVersion'>('v1');
const sessionId = brand<string, 'SessionId'>('session-recovery-guard');
const requestId = brand<string, 'MessageId'>('request-recovery-guard');
const runId = brand<string, 'RequestRunId'>('run-recovery-guard');
const requestContextId = brand<string, 'RequestContextId'>('ctx-recovery-guard');
const toolCallId = 'tool-recovery-1';
const capabilityId = brand<string, 'CapabilityId'>('Read');

describe('runtime recovery capability replay guard', () => {
  it('ignores public assistant content when reconstructing recovery replay decisions', async () => {
    const state = toolState();
    const message = assistantToolUseMessage([state]);
    const outcome = await evaluateRecoveryToolReplayGuard({
      run: runRecord(),
      context: requestContext({ toolCallStates: [state] }),
      checkpoint: checkpointRecord('CAPABILITY_BEFORE_CALL'),
      assistantToolUseMessage: {
        ...message,
        content: JSON.stringify({
          content: 'Public progress update that must not affect replay.',
          toolCalls: [{ toolCallId: state.toolCallId, capabilityId: state.capabilityId, arguments: state.arguments }],
        }),
      },
      currentRequestMessages: [],
      resolveDescriptor: () => descriptor('IDEMPOTENT'),
      resolveStableIdempotencyKey: () => brand<string, 'IdempotencyKey'>('stable-content-compatible-key'),
    });

    expect(outcome.status).toBe('READY');
    expect(outcome.decisions).toEqual([
      {
        kind: 'REPLAY_ALLOWED',
        toolCallId,
        capabilityId,
        arguments: { path: 'secret-argument-must-not-enter-errors' },
        idempotencyKey: brand<string, 'IdempotencyKey'>('stable-content-compatible-key'),
      },
    ]);
  });

  it('reuses a persisted capability result instead of resolving or replaying the tool', async () => {
    let descriptorLookups = 0;
    const outcome = await evaluateRecoveryToolReplayGuard({
      run: runRecord(),
      context: requestContext({ toolCallStates: [toolState()] }),
      checkpoint: checkpointRecord('CAPABILITY_BEFORE_CALL'),
      assistantToolUseMessage: assistantToolUseMessage([toolState()]),
      currentRequestMessages: [capabilityResultMessage(toolCallId, { ok: true })],
      resolveDescriptor: () => {
        descriptorLookups += 1;
        return undefined;
      },
      resolveStableIdempotencyKey: () => undefined,
    });

    expect(outcome.status).toBe('READY');
    expect(outcome.decisions).toEqual([
      {
        kind: 'REUSE_RESULT',
        toolCallId,
        capabilityId,
        resultMessageId: brand<string, 'MessageId'>(`result-${toolCallId}`),
        resultPayload: { ok: true },
      },
    ]);
    expect(descriptorLookups).toBe(0);
  });

  it('allows the main flow to re-evaluate recovered replay candidates once descriptor and stable key are available', async () => {
    const cases = [
      { name: 'idempotent descriptor', replayPolicy: 'IDEMPOTENT' as const, stableKey: brand<string, 'IdempotencyKey'>('stable-tool-replay-key') },
      {
        name: 'non-idempotent descriptor',
        replayPolicy: 'NON_IDEMPOTENT' as const,
        stableKey: brand<string, 'IdempotencyKey'>('stable-non-idempotent-key'),
      },
      { name: 'missing replay policy', replayPolicy: undefined, stableKey: brand<string, 'IdempotencyKey'>('stable-missing-policy-key') },
    ] as const;

    for (const item of cases) {
      const outcome = await evaluateRecoveryToolReplayGuard({
        run: runRecord(),
        context: requestContext({ toolCallStates: [toolState()] }),
        checkpoint: checkpointRecord('CAPABILITY_BEFORE_CALL'),
        assistantToolUseMessage: assistantToolUseMessage([toolState()]),
        currentRequestMessages: [],
        resolveDescriptor: () => descriptor(item.replayPolicy),
        resolveStableIdempotencyKey: () => item.stableKey,
      });

      expect(outcome.status, item.name).toBe('READY');
      expect(outcome.decisions).toEqual([
        {
          kind: 'REPLAY_ALLOWED',
          toolCallId,
          capabilityId,
          arguments: { path: 'secret-argument-must-not-enter-errors' },
          idempotencyKey: item.stableKey,
        },
      ]);
    }
  });

  it('fails closed for replay choices missing reconstruction prerequisites without leaking raw arguments or idempotency keys', async () => {
    const cases = [
      {
        name: 'missing descriptor',
        descriptor: undefined,
        stableKey: brand<string, 'IdempotencyKey'>('raw-key-missing-descriptor'),
        code: 'RECOVERY_CAPABILITY_DESCRIPTOR_UNAVAILABLE',
      },
      {
        name: 'missing stable key',
        descriptor: descriptor('IDEMPOTENT'),
        stableKey: undefined,
        code: 'RECOVERY_IDEMPOTENCY_KEY_UNAVAILABLE',
      },
    ] as const;

    for (const item of cases) {
      const outcome = await evaluateRecoveryToolReplayGuard({
        run: runRecord(),
        context: requestContext({ toolCallStates: [toolState()] }),
        checkpoint: checkpointRecord('CAPABILITY_BEFORE_CALL'),
        assistantToolUseMessage: assistantToolUseMessage([toolState()]),
        currentRequestMessages: [],
        resolveDescriptor: () => item.descriptor,
        resolveStableIdempotencyKey: () => item.stableKey,
      });

      expect(outcome.status, item.name).toBe('RECOVERY_FAILED');
      if (outcome.status === 'RECOVERY_FAILED') {
        const safeError = JSON.stringify(outcome.safeError);
        expect(outcome.safeError.code).toBe(item.code);
        expect(safeError).not.toContain('secret-argument');
        expect(safeError).not.toContain('raw-key');
      }
    }
  });

  it('requires a stable reconstruction key before replaying recovered TodoWrite calls', async () => {
    const todoCall = toolState({
      capabilityId: brand<string, 'CapabilityId'>('TodoWrite'),
      arguments: { todos: [{ content: 'SECRET_TODO_CONTENT', activeForm: 'SECRET_ACTIVE_FORM', status: 'pending' }] },
    });

    const outcome = await evaluateRecoveryToolReplayGuard({
      run: runRecord(),
      context: requestContext({ toolCallStates: [todoCall] }),
      checkpoint: checkpointRecord('CAPABILITY_BEFORE_CALL'),
      assistantToolUseMessage: assistantToolUseMessage([todoCall]),
      currentRequestMessages: [],
      resolveDescriptor: () => descriptor('IDEMPOTENT'),
      resolveStableIdempotencyKey: () => undefined,
    });

    expect(outcome.status).toBe('RECOVERY_FAILED');
    if (outcome.status === 'RECOVERY_FAILED') {
      const safeError = JSON.stringify(outcome.safeError);
      expect(outcome.safeError.code).toBe('RECOVERY_IDEMPOTENCY_KEY_UNAVAILABLE');
      expect(safeError).toContain('TodoWrite');
      expect(safeError).not.toContain('SECRET_TODO_CONTENT');
      expect(safeError).not.toContain('SECRET_ACTIVE_FORM');
    }
  });

  it('fails inconsistent durable facts instead of calling the tool to patch missing results', async () => {
    const afterReturnOutcome = await evaluateRecoveryToolReplayGuard({
      run: runRecord(),
      context: requestContext({ toolCallStates: [toolState()] }),
      checkpoint: checkpointRecord('CAPABILITY_AFTER_RETURN'),
      assistantToolUseMessage: assistantToolUseMessage([toolState()]),
      currentRequestMessages: [],
      resolveDescriptor: () => descriptor('IDEMPOTENT'),
      resolveStableIdempotencyKey: () => brand<string, 'IdempotencyKey'>('stable-after-return-key'),
    });
    const mismatchedMessageOutcome = await evaluateRecoveryToolReplayGuard({
      run: runRecord(),
      context: requestContext({ toolCallStates: [toolState()] }),
      checkpoint: checkpointRecord('CAPABILITY_BEFORE_CALL'),
      assistantToolUseMessage: assistantToolUseMessage([toolState()], { runId: brand<string, 'RequestRunId'>('other-run') }),
      currentRequestMessages: [],
      resolveDescriptor: () => descriptor('IDEMPOTENT'),
      resolveStableIdempotencyKey: () => brand<string, 'IdempotencyKey'>('stable-mismatch-key'),
    });

    for (const outcome of [afterReturnOutcome, mismatchedMessageOutcome]) {
      expect(outcome.status).toBe('RECOVERY_FAILED');
      if (outcome.status === 'RECOVERY_FAILED') {
        expect(outcome.safeError.code).toBe('RECOVERY_CAPABILITY_RESULT_INCONSISTENT');
      }
    }
  });

  it('reconciles a mixed tool batch and preserves completed results while forwarding pending replay candidates', async () => {
    const completedTool = toolState({ toolCallId: 'tool-completed', capabilityId: brand<string, 'CapabilityId'>('read-completed') });
    const pendingTool = toolState({ toolCallId: 'tool-pending', capabilityId: brand<string, 'CapabilityId'>('read-pending') });

    const outcome = await evaluateRecoveryToolReplayGuard({
      run: runRecord(),
      context: requestContext({ toolCallStates: [completedTool, pendingTool] }),
      checkpoint: checkpointRecord('CAPABILITY_BEFORE_CALL'),
      assistantToolUseMessage: assistantToolUseMessage([completedTool, pendingTool]),
      currentRequestMessages: [capabilityResultMessage('tool-completed', { already: 'done' })],
      resolveDescriptor: (toolCall) => (toolCall.toolCallId === 'tool-pending' ? descriptor('NON_IDEMPOTENT') : descriptor('IDEMPOTENT')),
      resolveStableIdempotencyKey: (toolCall) => brand<string, 'IdempotencyKey'>(`stable-${toolCall.toolCallId}`),
    });

    expect(outcome.status).toBe('READY');
    expect(outcome.decisions).toHaveLength(2);
    expect(outcome.decisions[0]).toMatchObject({ kind: 'REUSE_RESULT', toolCallId: 'tool-completed' });
    expect(outcome.decisions[1]).toMatchObject({ kind: 'REPLAY_ALLOWED', toolCallId: 'tool-pending', capabilityId: pendingTool.capabilityId });
  });
});

function runRecord(): RequestRun {
  return {
    runId,
    sessionId,
    requestId,
    agentId,
    agentVersion,
    agentAssemblyRef: 'assembly-default',
    attempt: 1,
    status: 'EXECUTING',
    version: 1,
    terminalCommitState: 'NOT_STARTED',
    createdAt: brand<number, 'EpochMillis'>(1),
    updatedAt: brand<number, 'EpochMillis'>(2),
  };
}

function requestContext(overrides: Partial<RequestContext> = {}): RequestContext {
  return {
    requestContextId,
    sessionId,
    requestId,
    runId,
    identityContext: { tenantId, subjectId, displayName: 'Local tester' },
    locale: brand<string, 'RequestLocale'>('zh-CN'),
    agentId,
    agentVersion,
    agentAssemblyRef: 'assembly-default',
    nextLifecycleStage: 'BEFORE_CAPABILITY_INVOKE',
    currentToolBatchMessageId: brand<string, 'MessageId'>('assistant-tool-use'),
    toolCallStates: [],
    flowVariables: {},
    ...overrides,
    agentTurnIndex: overrides.agentTurnIndex ?? 0,
  };
}

function checkpointRecord(triggerReason: CheckpointRecord['triggerReason']): CheckpointRecord {
  return {
    tenantId,
    subjectId,
    agentId,
    checkpointId: brand<string, 'CheckpointId'>(`checkpoint-${triggerReason}`),
    sessionId,
    requestId,
    runId,
    requestContextId,
    runVersion: 1,
    agentTurnIndex: 0,
    triggerReason,
    lastSequence: brand<number, 'TimelineSequence'>(10),
    activeContextVersion: 1,
    flowVariables: {},
    savedAt: brand<number, 'EpochMillis'>(10),
  };
}

function assistantToolUseMessage(toolCalls: readonly ToolCallState[], overrides: Partial<SessionMessageRecord> = {}): SessionMessageRecord {
  return messageRecord({
    messageId: brand<string, 'MessageId'>('assistant-tool-use'),
    role: 'ASSISTANT',
    content: JSON.stringify({
      toolCalls: toolCalls.map((toolCall) => ({
        toolCallId: toolCall.toolCallId,
        capabilityId: toolCall.capabilityId,
        arguments: toolCall.arguments,
      })),
    }),
    metadata: { kind: 'ASSISTANT_TOOL_USE', toolCallIds: toolCalls.map((toolCall) => toolCall.toolCallId) },
    ...overrides,
  });
}

function capabilityResultMessage(toolCallIdValue: string, payload: Record<string, unknown>): SessionMessageRecord {
  return messageRecord({
    messageId: brand<string, 'MessageId'>(`result-${toolCallIdValue}`),
    role: 'CAPABILITY_RESULT',
    content: JSON.stringify({ toolCallId: toolCallIdValue, payload }),
    metadata: { kind: 'CAPABILITY_RESULT', toolCallId: toolCallIdValue },
  });
}

function messageRecord(overrides: Partial<SessionMessageRecord>): SessionMessageRecord {
  return {
    tenantId,
    subjectId,
    agentId,
    messageId: brand<string, 'MessageId'>('message-default'),
    sessionId,
    requestId,
    runId,
    role: 'ASSISTANT',
    content: '{}',
    contentType: 'PLAIN_TEXT',
    metadata: {},
    visible: true,
    createdAt: brand<number, 'EpochMillis'>(5),
    ...overrides,
  };
}

function toolState(overrides: Partial<ToolCallState> = {}): ToolCallState {
  return {
    toolCallId,
    capabilityId,
    arguments: { path: 'secret-argument-must-not-enter-errors' },
    status: 'PENDING',
    ...overrides,
  };
}

function descriptor(replayPolicy?: 'IDEMPOTENT' | 'NON_IDEMPOTENT') {
  return {
    capabilityId,
    kind: 'TOOL',
    provider: { providerId: 'test-provider', providerKind: 'BUNDLED' },
    displayName: 'Read',
    safeDescription: 'Test descriptor.',
    modelInvocable: true,
    availabilityStatus: 'AVAILABLE',
    ...(replayPolicy === undefined ? {} : { replayPolicy }),
  };
}
