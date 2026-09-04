import { AgentError, brand } from '@nextagent/agent-common';
import type { RequestRunRecord, RequestRunStoreGateway, TerminalCommitRequest, TerminalCommitStatus } from '@nextagent/agent-contracts/gateway';
import type { LargeContentExternalizerPort, RequestContext, RequestRun, SubmitRequestCommand } from '@nextagent/agent-contracts/runtime';
import { describe, expect, it, vi } from 'vitest';
import { commitTerminalOutcomeWithHookResultSnapshot } from '../src/terminal/terminal-commit.js';

const terminalEventLimitBytes = 49_000;
const remoteEventFieldLimitBytes = 50_000;

describe('terminal Message-first capacity', () => {
  it('fails closed before the provider when raw 50,001-character content bypasses producer guards', async () => {
    const harness = makeHarness();

    const liveEvent = await commitTerminalOutcomeWithHookResultSnapshot(
      { requestRunStore: harness.requestRunStore },
      harness.hooks,
      harness.command,
      harness.run,
      harness.context,
      'x'.repeat(50_001),
      'COMPLETED',
      { hookResultSnapshot: { hookResults: [] } },
    );

    expect(harness.commits[0]?.terminalStatus).toBe('FAILED');
    expect(harness.commits[0]?.terminalMessage.content).toBe('Request failed safely: TERMINAL_MESSAGE_LIMIT_EXCEEDED');
    expect(liveEvent?.type).toBe('REQUEST_FAILED');
  });

  it('materializes an oversized Capability terminal answer with the real terminal Message id', async () => {
    const content = 'x'.repeat(50_001);
    const replacement = {
      kind: 'PERSISTED_PREVIEW',
      reason: 'CAPABILITY_RESULT_TOO_LARGE',
      contentRef: { refId: 'tool-results/result.txt', refType: 'CAPABILITY_RESULT' },
      originalSize: content.length,
    };
    const externalize = vi.fn<LargeContentExternalizerPort['externalize']>(async (draft) => ({
      ...draft,
      content: 'bounded preview\nFile path: tool-results/result.txt',
      metadata: { ...(draft.metadata ?? {}), replacement },
    }));
    const harness = makeHarness();

    const liveEvent = await commitTerminalOutcomeWithHookResultSnapshot(
      { requestRunStore: harness.requestRunStore, largeContentExternalizer: { externalize } },
      harness.hooks,
      harness.command,
      harness.run,
      harness.context,
      content,
      'COMPLETED',
      { capabilityTerminalAnswer: true, hookResultSnapshot: { hookResults: [] } },
    );

    expect(externalize).toHaveBeenCalledOnce();
    expect(externalize).toHaveBeenCalledWith(
      expect.objectContaining({ role: 'CAPABILITY_RESULT', content, contentType: 'PLAIN_TEXT' }),
      expect.objectContaining({ messageId: 'assistant-1', runId: harness.run.runId }),
    );
    expect(harness.commits[0]?.terminalMessage).toMatchObject({
      messageId: 'assistant-1',
      content: 'bounded preview\nFile path: tool-results/result.txt',
      metadata: { replacement },
    });
    expect(liveEvent?.inlinePayload.content).toBe('bounded preview\nFile path: tool-results/result.txt');
  });

  it.each(['COMPLETED', 'FAILED', 'CANCELED', 'SUPERSEDED'] as const)(
    'keeps the 50,000-character %s answer in Message while the persisted Event stays body-free and bounded',
    async (status) => {
      const content = 'x'.repeat(50_000);
      const harness = makeHarness();

      const liveEvent = await commitTerminalOutcomeWithHookResultSnapshot(
        { requestRunStore: harness.requestRunStore },
        harness.hooks,
        harness.command,
        harness.run,
        harness.context,
        content,
        status,
        { hookResultSnapshot: { hookResults: [] } },
      );

      const request = harness.commits[0];
      expect(request).toBeDefined();
      expect(request?.terminalMessage.content).toBe(content);
      expect(request?.terminalEvent.inlinePayload).not.toHaveProperty('content');
      expect(request?.terminalEvent.inlinePayload.terminalMessageId).toBe(request?.terminalMessage.messageId);
      expect(serializedBytes(request?.terminalEvent.inlinePayload ?? {})).toBeLessThanOrEqual(terminalEventLimitBytes);
      expect(liveEvent?.inlinePayload.content).toBe(content);
      expect(liveEvent?.inlinePayload).not.toHaveProperty('truncated');
    },
  );

  it('replaces an oversized complete Hook snapshot with its explicit unavailable representation', async () => {
    const harness = makeHarness();
    const resultSummary = { value: '界'.repeat(16_300) };

    await commitTerminalOutcomeWithHookResultSnapshot(
      { requestRunStore: harness.requestRunStore },
      harness.hooks,
      harness.command,
      harness.run,
      harness.context,
      'complete answer',
      'COMPLETED',
      {
        hookResultSnapshot: {
          hookResults: [
            {
              hookInvocationId: 'hook-invocation-1',
              hookId: 'hook-1',
              stage: 'AFTER_AGENT_TERMINAL',
              status: 'SUCCEEDED',
              failureMode: 'CONTINUE',
              resultSummary,
            },
          ],
        },
      },
    );

    const payload = harness.commits[0]?.terminalEvent.inlinePayload;
    expect(payload).toMatchObject({ hookResultsErrorCode: 'HOOK_RESULTS_LIMIT_EXCEEDED' });
    expect(payload).not.toHaveProperty('hookResults');
    expect(serializedBytes(payload ?? {})).toBeLessThanOrEqual(terminalEventLimitBytes);
  });

  it('fails before the provider when the required terminal Event shell exceeds the limit', async () => {
    const harness = makeHarness({ taskEventId: 'e'.repeat(60_000) });

    await expect(
      commitTerminalOutcomeWithHookResultSnapshot(
        { requestRunStore: harness.requestRunStore },
        harness.hooks,
        harness.command,
        harness.run,
        harness.context,
        'complete answer',
        'COMPLETED',
        { hookResultSnapshot: { hookResultsErrorCode: 'HOOK_RESULTS_UNAVAILABLE' } },
      ),
    ).rejects.toMatchObject({ code: 'TERMINAL_EVENT_PAYLOAD_LIMIT_EXCEEDED' });
    expect(harness.requestRunStore.commitTerminal).not.toHaveBeenCalled();
  });

  it('accepts the exact UTF-8 Event boundary and rejects the next byte', async () => {
    const probe = makeHarness({ taskEventId: 'x' });
    await commitTerminalOutcomeWithHookResultSnapshot(
      { requestRunStore: probe.requestRunStore },
      probe.hooks,
      probe.command,
      probe.run,
      probe.context,
      'complete answer',
      'COMPLETED',
      { hookResultSnapshot: { hookResults: [] } },
    );
    const probeBytes = serializedBytes(probe.commits[0]?.terminalEvent.inlinePayload ?? {});
    const exactTaskEventId = 'x'.repeat(1 + terminalEventLimitBytes - probeBytes);
    const exact = makeHarness({ taskEventId: exactTaskEventId });

    await commitTerminalOutcomeWithHookResultSnapshot(
      { requestRunStore: exact.requestRunStore },
      exact.hooks,
      exact.command,
      exact.run,
      exact.context,
      'complete answer',
      'COMPLETED',
      { hookResultSnapshot: { hookResults: [] } },
    );

    expect(serializedBytes(exact.commits[0]?.terminalEvent.inlinePayload ?? {})).toBe(terminalEventLimitBytes);
    const overflow = makeHarness({ taskEventId: `${exactTaskEventId}x` });
    await expect(
      commitTerminalOutcomeWithHookResultSnapshot(
        { requestRunStore: overflow.requestRunStore },
        overflow.hooks,
        overflow.command,
        overflow.run,
        overflow.context,
        'complete answer',
        'COMPLETED',
        { hookResultSnapshot: { hookResults: [] } },
      ),
    ).rejects.toMatchObject({ code: 'TERMINAL_EVENT_PAYLOAD_LIMIT_EXCEEDED' });
    expect(overflow.requestRunStore.commitTerminal).not.toHaveBeenCalled();
  });

  it('does not return a second live terminal for an idempotent replay', async () => {
    const harness = makeHarness({ commitStatus: 'ALREADY_COMMITTED' });

    await expect(
      commitTerminalOutcomeWithHookResultSnapshot(
        { requestRunStore: harness.requestRunStore },
        harness.hooks,
        harness.command,
        harness.run,
        harness.context,
        'complete answer',
        'COMPLETED',
        { hookResultSnapshot: { hookResults: [] } },
      ),
    ).resolves.toBeUndefined();
  });

  it.each(['VERSION_CONFLICT', 'NOT_FOUND'] as const)('propagates terminal commit %s after recording the failed commit state', async (status) => {
    const harness = makeHarness({ commitStatus: status });

    await expect(
      commitTerminalOutcomeWithHookResultSnapshot(
        { requestRunStore: harness.requestRunStore },
        harness.hooks,
        harness.command,
        harness.run,
        harness.context,
        'complete answer',
        'COMPLETED',
        { hookResultSnapshot: { hookResults: [] } },
      ),
    ).rejects.toMatchObject({ code: `TERMINAL_COMMIT_${status}` });
    expect(harness.savedRuns.at(-1)).toMatchObject({ status: 'FAILED', terminalCommitState: 'FAILED' });
  });
});

function makeHarness(options: { readonly taskEventId?: string; readonly commitStatus?: TerminalCommitStatus } = {}): {
  readonly requestRunStore: RequestRunStoreGateway;
  readonly hooks: Parameters<typeof commitTerminalOutcomeWithHookResultSnapshot>[1];
  readonly command: SubmitRequestCommand;
  readonly run: RequestRun;
  readonly context: RequestContext;
  readonly commits: TerminalCommitRequest[];
  readonly savedRuns: RequestRunRecord[];
} {
  const tenantId = brand<string, 'TenantId'>('tenant-1');
  const subjectId = brand<string, 'SubjectId'>('subject-1');
  const agentId = brand<string, 'AgentId'>('agent-1');
  const agentVersion = brand<string, 'AgentVersion'>('v1');
  const sessionId = brand<string, 'SessionId'>('session-1');
  const requestId = brand<string, 'MessageId'>('request-1');
  const runId = brand<string, 'RequestRunId'>('run-1');
  const identityContext = { tenantId, subjectId, displayName: 'Terminal capacity test' };
  const command: SubmitRequestCommand = {
    sessionId,
    identityContext,
    inputText: 'produce a long answer',
    attachmentIds: [],
    locale: brand<string, 'RequestLocale'>('zh-CN'),
    idempotencyKey: brand<string, 'IdempotencyKey'>('submit-1'),
  };
  const run: RequestRun = {
    runId,
    sessionId,
    requestId,
    agentId,
    agentVersion,
    agentAssemblyRef: 'agent-1:v1',
    attempt: 1,
    status: 'EXECUTING',
    version: 1,
    terminalCommitState: 'NOT_STARTED',
    createdAt: brand<number, 'EpochMillis'>(1),
    updatedAt: brand<number, 'EpochMillis'>(1),
  };
  const context: RequestContext = {
    requestContextId: brand<string, 'RequestContextId'>('context-1'),
    sessionId,
    requestId,
    runId,
    identityContext,
    locale: brand<string, 'RequestLocale'>('zh-CN'),
    agentId,
    agentVersion,
    agentAssemblyRef: 'agent-1:v1',
    agentTurnIndex: 0,
    nextLifecycleStage: 'BEFORE_AGENT_TERMINAL',
    toolCallStates: [],
    flowVariables: {},
    ...(options.taskEventId === undefined ? {} : { propagationAttributes: { taskEventId: brand<string, 'TaskEventId'>(options.taskEventId) } }),
  };
  const commits: TerminalCommitRequest[] = [];
  const savedRuns: RequestRunRecord[] = [];
  let savedRun: RequestRunRecord | undefined;
  const commitTerminal = vi.fn(async (request: TerminalCommitRequest) => {
    commits.push(request);
    if (serializedBytes(request.terminalEvent.inlinePayload) >= remoteEventFieldLimitBytes) {
      throw new AgentError({
        code: 'REMOTE_TERMINAL_EVENT_PAYLOAD_REJECTED',
        message: 'Remote terminal Event field exceeded its capacity.',
        category: 'VALIDATION',
        retryable: false,
      });
    }
    const status = options.commitStatus ?? 'COMMITTED';
    return status === 'COMMITTED' ? { status, terminalEvent: request.terminalEvent } : { status };
  });
  const requestRunStore: RequestRunStoreGateway = {
    saveRun: vi.fn(async (record) => {
      savedRun = record;
      savedRuns.push(record);
      return { status: 'UPDATED' as const, record };
    }),
    loadRun: vi.fn(async () => savedRun),
    listRuns: vi.fn(async (request) => ({ items: [], offset: request.offset, limit: request.limit, hasMore: false })),
    loadSessionLaneSnapshot: vi.fn(async (request) => ({ ...request, queuedRuns: [] })),
    loadRunByIdempotencyKey: vi.fn(async () => ({ status: 'NOT_FOUND' as const })),
    claimRun: vi.fn(async () => ({ status: 'VERSION_CONFLICT' as const })),
    listRecoverableRuns: vi.fn(async () => []),
    commitTerminal,
  };
  return {
    requestRunStore,
    command,
    run,
    context,
    commits,
    savedRuns,
    hooks: {
      now: () => brand<number, 'EpochMillis'>(10),
      id: (prefix) => `${prefix}-1`,
      emitCanonical: vi.fn(async () => undefined),
      saveCheckpoint: vi.fn(async () => undefined),
    },
  };
}

function serializedBytes(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value), 'utf8');
}
