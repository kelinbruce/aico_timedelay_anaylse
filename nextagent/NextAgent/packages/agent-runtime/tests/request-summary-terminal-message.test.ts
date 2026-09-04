import { brand, type AgentType, type IdentityContext } from '@nextagent/agent-common';
import type { AgentAssemblyRegistry } from '@nextagent/agent-contracts/agent-assembly';
import type { CapabilityCatalog } from '@nextagent/agent-contracts/capability';
import type {
  ActiveContextStoreGateway,
  CheckpointStoreGateway,
  RequestRunRecord,
  RequestRunStoreGateway,
  RunTimelineEventRecord,
  RunTimelineEventStoreGateway,
  SessionMessageRecord,
  SessionMessageStoreGateway,
} from '@nextagent/agent-contracts/gateway';
import type { AgentConstructor } from '@nextagent/agent-contracts/runtime';
import type { UserSession, UserSessionPort } from '@nextagent/agent-contracts/session';
import { RequestLifecycleCoordinator, type RequestLifecycleDependencies } from '@nextagent/agent-runtime';
import { describe, expect, it, vi } from 'vitest';

const identityContext: IdentityContext = {
  tenantId: brand<string, 'TenantId'>('tenant-summary'),
  subjectId: brand<string, 'SubjectId'>('subject-summary'),
  displayName: 'Summary tester',
};
const agentId = brand<string, 'AgentId'>('agent-summary');
const agentVersion = brand<string, 'AgentVersion'>('v1');
const sessionId = brand<string, 'SessionId'>('session-summary');
const requestId = brand<string, 'MessageId'>('request-summary');
const runId = brand<string, 'RequestRunId'>('run-summary');
const terminalMessageId = brand<string, 'MessageId'>('terminal-message-summary');

describe('Runtime request summary terminal Message association', () => {
  it('returns the committed terminal preview/ref without exposing runId or reading Event/workspace bodies', async () => {
    const content = '<persisted-content>\nFile path: tool-results/summary-result.txt\nPreview: bounded request summary';
    const harness = makeHarness(
      terminalMessage({
        content,
        metadata: {
          eventType: 'REQUEST_COMPLETED',
          status: 'COMPLETED',
          replacement: { contentRef: { refId: 'tool-results/summary-result.txt', refType: 'CAPABILITY_RESULT' } },
        },
      }),
    );

    const summary = await harness.coordinator.getRequestSummary({ identityContext, sessionId, requestId });

    expect(summary).toMatchObject({
      sessionId,
      requestId,
      status: 'COMPLETED',
      terminalResult: { content, contentType: 'MARKDOWN' },
    });
    expect(summary).not.toHaveProperty('runId');
    expect(harness.loadMessage).toHaveBeenCalledWith({
      tenantId: identityContext.tenantId,
      subjectId: identityContext.subjectId,
      agentId,
      messageId: terminalMessageId,
    });
    expect(JSON.stringify(summary)).not.toContain('legacy Event body');
  });

  it.each([
    ['missing Message', undefined],
    ['hidden Message', terminalMessage({ visible: false })],
    ['wrong role', terminalMessage({ role: 'USER' })],
    ['wrong run', terminalMessage({ runId: brand<string, 'RequestRunId'>('run-other') })],
    ['wrong metadata', terminalMessage({ metadata: { eventType: 'REQUEST_FAILED', status: 'FAILED' } })],
  ])('omits terminalResult for %s and never falls back to Event content', async (_label, message) => {
    const harness = makeHarness(message);

    const summary = await harness.coordinator.getRequestSummary({ identityContext, sessionId, requestId });

    expect(summary).not.toHaveProperty('terminalResult');
    expect(JSON.stringify(summary)).not.toContain('legacy Event body');
  });

  it('omits terminalResult when the terminal Event type conflicts with the persisted run status', async () => {
    const harness = makeHarness(terminalMessage({ metadata: { eventType: 'REQUEST_FAILED', status: 'COMPLETED' } }), 'REQUEST_FAILED');

    const summary = await harness.coordinator.getRequestSummary({ identityContext, sessionId, requestId });

    expect(summary).not.toHaveProperty('terminalResult');
  });

  it.each([
    ['empty code', '', 'MODEL_PROVIDER_ERROR'],
    ['whitespace code', '   ', 'MODEL_PROVIDER_ERROR'],
    ['empty category', 'MODEL_PROVIDER_ERROR', ''],
    ['whitespace category', 'MODEL_PROVIDER_ERROR', '   '],
  ])('omits safeError when the terminal Event contains %s', async (_label, code, category) => {
    const content = 'provider failed';
    const harness = makeHarness(
      terminalMessage({
        content,
        metadata: { eventType: 'REQUEST_FAILED', status: 'FAILED' },
      }),
      'REQUEST_FAILED',
      { terminalMessageId, code, category, retryable: true },
      'FAILED',
    );

    const summary = await harness.coordinator.getRequestSummary({ identityContext, sessionId, requestId });

    expect(summary).toMatchObject({
      terminalResult: { content, contentType: 'MARKDOWN' },
    });
    expect(summary?.terminalResult).not.toHaveProperty('safeError');
  });
});

function makeHarness(
  message: SessionMessageRecord | undefined,
  terminalEventType: RunTimelineEventRecord['type'] = 'REQUEST_COMPLETED',
  inlinePayload: RunTimelineEventRecord['inlinePayload'] = {
    terminalMessageId,
    content: 'legacy Event body',
  },
  runStatus: RequestRunRecord['status'] = 'COMPLETED',
): {
  readonly coordinator: RequestLifecycleCoordinator;
  readonly loadMessage: ReturnType<typeof vi.fn<SessionMessageStoreGateway['loadMessage']>>;
} {
  const session: UserSession = {
    tenantId: identityContext.tenantId,
    subjectId: identityContext.subjectId,
    agentId,
    sessionId,
    title: 'Summary session',
    createdAt: brand<number, 'EpochMillis'>(1),
    updatedAt: brand<number, 'EpochMillis'>(1),
    hasInFlightRequest: false,
  };
  const run: RequestRunRecord = {
    tenantId: identityContext.tenantId,
    subjectId: identityContext.subjectId,
    agentId,
    agentVersion,
    agentAssemblyRef: 'agent-summary:v1',
    sessionId,
    requestId,
    runId,
    attempt: 1,
    status: runStatus,
    version: 2,
    terminalCommitState: 'COMMITTED',
    createdAt: brand<number, 'EpochMillis'>(1),
    updatedAt: brand<number, 'EpochMillis'>(2),
  };
  const terminalEvent: RunTimelineEventRecord = {
    tenantId: identityContext.tenantId,
    subjectId: identityContext.subjectId,
    agentId,
    agentVersion,
    eventId: 'terminal-event-summary',
    sessionId,
    requestId,
    runId,
    requestContextId: brand<string, 'RequestContextId'>('context-summary'),
    sequence: brand<number, 'TimelineSequence'>(1),
    type: terminalEventType,
    inlinePayload,
    createdAt: brand<number, 'EpochMillis'>(2),
  };
  const userSessions: UserSessionPort = {
    createSession: vi.fn(async () => session),
    requireSession: vi.fn(async () => session),
    listSessions: vi.fn(async () => ({ entries: [session], offset: 0, limit: 20, hasMore: false })),
    deleteSession: vi.fn(async () => undefined),
    listMessages: vi.fn(async () => ({ items: [], limit: 20, hasMore: false })),
    listConversationPreview: vi.fn(async () => ({ sessionId, totalMarkers: 0, offset: 0, limit: 100, markers: [] })),
    listCurrentRequestMessages: vi.fn(async () => ({ items: [], limit: 20, hasMore: false })),
    generateTitle: vi.fn(async () => false),
    updateTitle: vi.fn(async () => session),
  };
  const requestRunStore = {
    loadSessionLaneSnapshot: vi.fn(async () => ({
      tenantId: identityContext.tenantId,
      subjectId: identityContext.subjectId,
      agentId,
      sessionId,
      latestRequestId: requestId,
      latestRun: run,
      queuedRuns: [],
    })),
  } as unknown as RequestRunStoreGateway;
  const timelineStore = {
    listEvents: vi.fn(async () => [terminalEvent]),
  } as unknown as RunTimelineEventStoreGateway;
  const loadMessage = vi.fn<SessionMessageStoreGateway['loadMessage']>(async () => message);
  const messageStore = { loadMessage } as unknown as SessionMessageStoreGateway;
  const dependencies = {
    defaultRouteAgentId: agentId,
    agentConstructors: [
      class SummaryTestAgent {
        static getType(): AgentType {
          return brand<string, 'AgentType'>('DEFAULT') as AgentType;
        }
      } as unknown as AgentConstructor,
    ],
    agentRuntimeDependencies: {},
    assemblyRegistry: {} as AgentAssemblyRegistry,
    capabilityCatalog: {} as CapabilityCatalog,
    userSessions,
    messageStore,
    activeContextStore: {} as ActiveContextStoreGateway,
    requestRunStore,
    timelineStore,
    checkpointStore: {} as CheckpointStoreGateway,
  } satisfies RequestLifecycleDependencies;
  return { coordinator: new RequestLifecycleCoordinator(dependencies), loadMessage };
}

function terminalMessage(overrides: Partial<SessionMessageRecord> = {}): SessionMessageRecord {
  return {
    tenantId: identityContext.tenantId,
    subjectId: identityContext.subjectId,
    agentId,
    messageId: terminalMessageId,
    sessionId,
    requestId,
    runId,
    role: 'ASSISTANT',
    content: 'complete answer',
    contentType: 'MARKDOWN',
    metadata: { eventType: 'REQUEST_COMPLETED', status: 'COMPLETED' },
    visible: true,
    createdAt: brand<number, 'EpochMillis'>(2),
    ...overrides,
  };
}
