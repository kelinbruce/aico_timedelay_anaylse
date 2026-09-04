import { AgentError, bindRuntimeLoggerProvider, brand, type RuntimeLoggerProviderBinding } from '@nextagent/agent-common';
import type { AgentAssembly, AgentAssemblyRegistry } from '@nextagent/agent-contracts/agent-assembly';
import type { RequestAccepted, RuntimeCommandPort, RuntimeSessionPort } from '@nextagent/agent-contracts/runtime';
import type { SessionMessage, SessionMessagePage } from '@nextagent/agent-contracts/session';
import { createRuntimeSubagentExecutionPort } from '@nextagent/agent-runtime';
import { afterEach, describe, expect, it, vi } from 'vitest';

const targetAgentId = brand<string, 'AgentId'>('target-agent');
const targetAgentVersion = brand<string, 'AgentVersion'>('v1');
const parentSessionId = brand<string, 'SessionId'>('parent-session');
const parentRunId = brand<string, 'RequestRunId'>('parent-run');
const parentRequestId = brand<string, 'MessageId'>('parent-request');
const childSessionId = brand<string, 'SessionId'>('child-session');
const childRequestId = brand<string, 'MessageId'>('child-request');
const childRunId = brand<string, 'RequestRunId'>('child-run');
const locale = brand<string, 'RequestLocale'>('zh-CN');
const idempotencyKey = brand<string, 'IdempotencyKey'>('idem-subagent');

let loggerBinding: RuntimeLoggerProviderBinding | undefined;

describe('RuntimeSubagentExecutionPort', () => {
  it('recovers terminal text from messages when stream breaks after terminal commit', async () => {
    const runtime = runtimeFixture({
      streamEvents: async function* () {
        throw new Error('stream disconnected');
      },
      getActiveRun: vi.fn(async () => undefined),
      getRequestSummary: vi.fn(async () => undefined),
      listMessages: vi.fn(async () =>
        messagesPage([sessionMessage('message-user', 'USER', 'prompt', 1), sessionMessage('message-assistant', 'ASSISTANT', 'terminal answer', 2)]),
      ),
    });
    const result = await createRuntimeSubagentExecutionPort({ assemblyRegistry: assemblyRegistryFixture(), runtime }).executeSubagent(
      requestFixture(),
      new AbortController().signal,
    );

    expect(result).toMatchObject({
      status: 'COMPLETED',
      terminalText: 'terminal answer',
      childSessionId,
      childRunId,
    });
    expect(runtime.getActiveRun).toHaveBeenCalledWith({ identityContext: requestFixture().identityContext, sessionId: childSessionId });
    expect(runtime.listMessages).toHaveBeenCalledWith(expect.objectContaining({ sessionId: childSessionId, requestId: childRequestId }));
  });

  it('distinguishes empty terminal messages from missing terminal messages during recovery', async () => {
    const runtime = runtimeFixture({
      streamEvents: async function* () {
        throw new Error('stream disconnected');
      },
      getActiveRun: vi.fn(async () => undefined),
      listMessages: vi.fn(async () => messagesPage([])),
    });
    const result = await createRuntimeSubagentExecutionPort({ assemblyRegistry: assemblyRegistryFixture(), runtime }).executeSubagent(
      requestFixture(),
      new AbortController().signal,
    );

    expect(result).toMatchObject({
      status: 'FAILED',
      terminalText: '',
      childSessionId,
      childRunId,
      safeError: { code: 'SUBAGENT_TERMINAL_MESSAGES_EMPTY' },
    });
  });

  it('distinguishes missing terminal messages from an empty terminal message page during recovery', async () => {
    const runtime = runtimeFixture({
      streamEvents: async function* () {
        throw new Error('stream disconnected');
      },
      getActiveRun: vi.fn(async () => undefined),
      listMessages: vi.fn(async () => {
        throw new AgentError({ code: 'MESSAGES_NOT_FOUND', message: 'messages not found', category: 'NOT_FOUND' });
      }),
    });
    const result = await createRuntimeSubagentExecutionPort({ assemblyRegistry: assemblyRegistryFixture(), runtime }).executeSubagent(
      requestFixture(),
      new AbortController().signal,
    );

    expect(result).toMatchObject({
      status: 'FAILED',
      terminalText: '',
      childSessionId,
      childRunId,
      safeError: { code: 'SUBAGENT_TERMINAL_MESSAGES_NOT_FOUND', category: 'NOT_FOUND' },
    });
  });

  it('keeps child ids when terminal text extraction fails after submit acceptance', async () => {
    const runtime = runtimeFixture({
      streamEvents: async function* () {
        yield {
          type: 'REQUEST_COMPLETED',
          eventId: 'event-completed',
          sequence: brand<number, 'TimelineSequence'>(1),
          occurredAt: brand<number, 'EpochMillis'>(1),
          inlinePayload: {},
        };
      },
      listMessages: vi.fn(async () => {
        throw new AgentError({ code: 'TERMINAL_MESSAGES_UNAVAILABLE', message: 'messages unavailable', category: 'UNAVAILABLE', retryable: true });
      }),
    });
    const result = await createRuntimeSubagentExecutionPort({ assemblyRegistry: assemblyRegistryFixture(), runtime }).executeSubagent(
      requestFixture(),
      new AbortController().signal,
    );

    expect(result).toMatchObject({
      status: 'FAILED',
      terminalText: '',
      childSessionId,
      childRunId,
      safeError: { code: 'TERMINAL_MESSAGES_UNAVAILABLE' },
    });
  });

  it('logs parent-to-child correlation fields on submit and settle', async () => {
    const logs: unknown[] = [];
    loggerBinding = bindRuntimeLoggerProvider({ getLogger: () => testLogger(logs) });
    const runtime = runtimeFixture({
      streamEvents: async function* () {
        yield {
          type: 'REQUEST_COMPLETED',
          eventId: 'event-completed',
          sequence: brand<number, 'TimelineSequence'>(1),
          occurredAt: brand<number, 'EpochMillis'>(1),
          inlinePayload: {},
        };
      },
    });
    await createRuntimeSubagentExecutionPort({ assemblyRegistry: assemblyRegistryFixture(), runtime }).executeSubagent(
      requestFixture(),
      new AbortController().signal,
    );

    const submitted = logs.find((log) => (log as { readonly event?: string }).event === 'runtime.subagent.submitted');
    expect(submitted).toEqual(
      expect.objectContaining({
        event: 'runtime.subagent.submitted',
        parentSessionId,
        parentRunId,
        parentRequestId,
        parentToolCallId: 'tool-call',
        childSessionId,
        childRunId,
        targetAgentId,
        idempotencyKey,
      }),
    );

    const settled = logs.find((log) => (log as { readonly event?: string }).event === 'runtime.subagent.settled');
    expect(settled).toEqual(
      expect.objectContaining({
        event: 'runtime.subagent.settled',
        status: 'COMPLETED',
        parentSessionId,
        childSessionId,
        childRunId,
      }),
    );
  });

  it('logs exception with parent-to-child correlation when executeSubagent throws', async () => {
    const logs: unknown[] = [];
    loggerBinding = bindRuntimeLoggerProvider({ getLogger: () => testLogger(logs) });
    const runtime = runtimeFixture({
      submit: vi.fn(async () => {
        throw new Error('submit failed');
      }),
    });
    await createRuntimeSubagentExecutionPort({ assemblyRegistry: assemblyRegistryFixture(), runtime }).executeSubagent(
      requestFixture(),
      new AbortController().signal,
    );

    const captured = logs.find((log) => (log as { readonly event?: string }).event === 'runtime.subagent.exception_captured');
    expect(captured).toEqual(
      expect.objectContaining({
        event: 'runtime.subagent.exception_captured',
        status: 'FAILED',
        parentSessionId,
        parentRunId,
        parentToolCallId: 'tool-call',
        safeErrorCode: 'SUBAGENT_EXECUTION_FAILED',
      }),
    );
  });
});

afterEach(() => {
  if (loggerBinding !== undefined) {
    loggerBinding.unbind();
    loggerBinding = undefined;
  }
});

function requestFixture() {
  return {
    targetAgentId,
    targetAgentVersion,
    targetProviderKind: 'BUNDLED' as const,
    prompt: 'delegate this',
    parentSessionId,
    parentRunId,
    parentRequestId,
    parentToolCallId: 'tool-call',
    identityContext: {
      tenantId: brand<string, 'TenantId'>('tenant-subagent'),
      subjectId: brand<string, 'SubjectId'>('subject-subagent'),
      displayName: 'Subagent tester',
    },
    locale,
    idempotencyKey,
  };
}

function runtimeFixture(overrides: Partial<RuntimeCommandPort & RuntimeSessionPort> = {}): RuntimeCommandPort & RuntimeSessionPort {
  const accepted: RequestAccepted = { sessionId: childSessionId, requestId: childRequestId, runId: childRunId, attempt: 1 };
  return {
    submit: vi.fn(async () => accepted),
    cancel: vi.fn(async () => undefined),
    retryLatest: vi.fn(async () => accepted),
    editLatest: vi.fn(async () => accepted),
    createSession: vi.fn(),
    requireSession: vi.fn(),
    listSessions: vi.fn(),
    listMessages: vi.fn(async () => messagesPage([])),
    updateTitle: vi.fn(),
    streamEvents: async function* () {},
    getActiveRun: vi.fn(async () => undefined),
    ...overrides,
  } as unknown as RuntimeCommandPort & RuntimeSessionPort;
}

function messagesPage(items: readonly SessionMessage[]): SessionMessagePage {
  return { items, limit: 100, hasMore: false };
}

function sessionMessage(messageId: string, role: SessionMessage['role'], content: string, sequence: number): SessionMessage {
  return {
    messageId: brand<string, 'MessageId'>(messageId),
    sessionId: childSessionId,
    requestId: childRequestId,
    runId: childRunId,
    role,
    content,
    contentType: 'PLAIN_TEXT',
    metadata: {},
    sequence,
    visible: true,
    createdAt: brand<number, 'EpochMillis'>(sequence),
  };
}

function assemblyRegistryFixture(): AgentAssemblyRegistry {
  const assembly: AgentAssembly = {
    agentId: targetAgentId,
    agentType: brand<string, 'AgentType'>('test-agent'),
    agentVersion: targetAgentVersion,
    agentAssemblyRef: 'target-agent:v1',
    displayName: 'Target Agent',
    description: 'Target test agent',
    workspacePolicy: { schemaVersion: '1', isolationMode: 'subject', roots: [] },
    modelIds: ['default-model'],
    capabilityBindings: [],
    userInvocable: true,
    agentInvocation: 'BOUND',
    runtimeSettings: { requestTimeoutMs: 30_000 },
  };
  return {
    active: vi.fn(async () => assembly),
    require: vi.fn(async () => assembly),
  };
}

function testLogger(logs: unknown[]) {
  const captureFailure = (fields: object): void => {
    const { err, ...safeFields } = fields as Record<string, unknown>;
    logs.push({ ...safeFields, ...(err === undefined ? {} : { caught: err }) });
  };
  return {
    debug() {},
    info(obj: unknown) {
      logs.push(obj);
    },
    warn: captureFailure,
    error: captureFailure,
  };
}
