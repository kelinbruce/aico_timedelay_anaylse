import { AgentError, brand, type AgentType, type IdentityContext } from '@nextagent/agent-common';
import type { AgentAssemblyRegistry } from '@nextagent/agent-contracts/agent-assembly';
import type { CapabilityCatalog } from '@nextagent/agent-contracts/capability';
import type {
  ActiveContextStoreGateway,
  CheckpointStoreGateway,
  RequestRunStoreGateway,
  RunTimelineEventStoreGateway,
  SessionMessageStoreGateway,
} from '@nextagent/agent-contracts/gateway';
import type { SessionMessage, UserSession, UserSessionPort } from '@nextagent/agent-contracts/session';
import type { AgentConstructor } from '@nextagent/agent-contracts/runtime';
import { RequestLifecycleCoordinator, type RequestLifecycleDependencies } from '@nextagent/agent-runtime';
import { describe, expect, it, vi } from 'vitest';

const identityContext: IdentityContext = {
  tenantId: brand<string, 'TenantId'>('tenant-process'),
  subjectId: brand<string, 'SubjectId'>('subject-process'),
  displayName: 'Process tester',
};
const agentId = brand<string, 'AgentId'>('agent-process');
const sessionId = brand<string, 'SessionId'>('session-process');
const requestId = brand<string, 'MessageId'>('request-process');
const runId = brand<string, 'RequestRunId'>('run-process');

describe('RuntimeSessionPort.resolveProcessMessages', () => {
  it('returns only requested domain messages from the trusted session, request, and run', async () => {
    const requestedAssistant = message('assistant-tool-use', { visible: false });
    const requestedResult = message('capability-result', { role: 'CAPABILITY_RESULT' });
    const unrequested = message('unrequested');
    const wrongRequest = message('wrong-request', { requestId: brand<string, 'MessageId'>('request-other') });
    const wrongRun = message('wrong-run', { runId: brand<string, 'RequestRunId'>('run-other') });
    const wrongSession = message('wrong-session', { sessionId: brand<string, 'SessionId'>('session-other') });
    const harness = makeHarness([requestedAssistant, requestedResult, unrequested, wrongRequest, wrongRun, wrongSession]);

    const resolved = await harness.coordinator.resolveProcessMessages({
      identityContext,
      sessionId,
      requestId,
      runId,
      messageIds: [requestedAssistant.messageId, requestedResult.messageId, requestedAssistant.messageId],
    });

    expect(resolved).toEqual([requestedAssistant, requestedResult]);
    expect(resolved[0]).not.toHaveProperty('tenantId');
    expect(resolved[0]).not.toHaveProperty('subjectId');
    expect(resolved[0]).not.toHaveProperty('agentId');
    expect(harness.listCurrentRequestMessages).toHaveBeenCalledWith(
      expect.objectContaining({
        identityContext,
        agentId,
        sessionId,
        requestId,
        runId,
        includeHidden: true,
        offset: 0,
        limit: 1_000,
      }),
    );
  });

  it('omits missing references and rejects mismatched owner or session scope', async () => {
    const target = message('target');
    const harness = makeHarness([target]);

    await expect(
      harness.coordinator.resolveProcessMessages({
        identityContext,
        sessionId,
        requestId,
        runId,
        messageIds: [brand<string, 'MessageId'>('missing')],
      }),
    ).resolves.toEqual([]);
    await expect(
      harness.coordinator.resolveProcessMessages({
        identityContext: {
          tenantId: brand<string, 'TenantId'>('tenant-other'),
          subjectId: identityContext.subjectId,
          displayName: 'Other owner',
        },
        sessionId,
        requestId,
        runId,
        messageIds: [target.messageId],
      }),
    ).rejects.toMatchObject({ code: 'SESSION_NOT_FOUND' });
    await expect(
      harness.coordinator.resolveProcessMessages({
        identityContext,
        sessionId: brand<string, 'SessionId'>('session-other'),
        requestId,
        runId,
        messageIds: [target.messageId],
      }),
    ).rejects.toMatchObject({ code: 'SESSION_NOT_FOUND' });
  });

  it('accepts one to one thousand references, deduplicates them, and rejects invalid bounds', async () => {
    const target = message('target');
    const harness = makeHarness([target]);
    const thousand = [target.messageId, ...Array.from({ length: 999 }, (_, index) => brand<string, 'MessageId'>(`missing-${index}`))];

    await expect(
      harness.coordinator.resolveProcessMessages({
        identityContext,
        sessionId,
        requestId,
        runId,
        messageIds: [target.messageId, target.messageId],
      }),
    ).resolves.toEqual([target]);
    await expect(
      harness.coordinator.resolveProcessMessages({
        identityContext,
        sessionId,
        requestId,
        runId,
        messageIds: thousand,
      }),
    ).resolves.toEqual([target]);
    await expect(
      harness.coordinator.resolveProcessMessages({
        identityContext,
        sessionId,
        requestId,
        runId,
        messageIds: [],
      }),
    ).rejects.toMatchObject({ code: 'PROCESS_MESSAGE_REFERENCES_INVALID' });
    await expect(
      harness.coordinator.resolveProcessMessages({
        identityContext,
        sessionId,
        requestId,
        runId,
        messageIds: [...thousand, brand<string, 'MessageId'>('missing-1000')],
      }),
    ).rejects.toMatchObject({ code: 'PROCESS_MESSAGE_REFERENCES_INVALID' });
  });

  it('returns a complete bounded run candidate set for legacy process association', async () => {
    const assistant = message('assistant-tool-use', {
      visible: false,
      metadata: { kind: 'ASSISTANT_TOOL_USE' },
    });
    const result = message('capability-result', {
      role: 'CAPABILITY_RESULT',
      metadata: { kind: 'CAPABILITY_RESULT' },
    });
    const harness = makeHarness([assistant, result]);

    await expect(
      harness.coordinator.resolveProcessMessages({
        identityContext,
        sessionId,
        requestId,
        runId,
        messageIds: [],
        includeLegacyCandidates: true,
      }),
    ).resolves.toEqual([assistant, result]);
  });

  it('fails closed when a legacy candidate set exceeds the bounded page', async () => {
    const harness = makeHarness(Array.from({ length: 1_001 }, (_, index) => message(`legacy-${index}`)));

    await expect(
      harness.coordinator.resolveProcessMessages({
        identityContext,
        sessionId,
        requestId,
        runId,
        messageIds: [],
        includeLegacyCandidates: true,
      }),
    ).rejects.toMatchObject({ code: 'PROCESS_MESSAGE_LEGACY_CANDIDATES_EXCEEDED' });
    expect(harness.listCurrentRequestMessages).toHaveBeenCalledOnce();
  });

  it('continues bounded pagination until the requested message is found', async () => {
    const target = message('target');
    const harness = makeHarness([...Array.from({ length: 1_000 }, (_, index) => message(`irrelevant-${index}`)), target]);

    await expect(
      harness.coordinator.resolveProcessMessages({
        identityContext,
        sessionId,
        requestId,
        runId,
        messageIds: [target.messageId],
      }),
    ).resolves.toEqual([target]);
    expect(harness.listCurrentRequestMessages).toHaveBeenNthCalledWith(2, expect.objectContaining({ offset: 1_000, limit: 1_000 }));
  });

  it('honors optional cancellation without mutating session state', async () => {
    const harness = makeHarness([message('target')]);
    const controller = new AbortController();
    controller.abort(new Error('cancel process association'));

    await expect(
      harness.coordinator.resolveProcessMessages({
        identityContext,
        sessionId,
        requestId,
        runId,
        messageIds: [brand<string, 'MessageId'>('target')],
        signal: controller.signal,
      }),
    ).rejects.toThrow('cancel process association');
    expect(harness.requireSession).not.toHaveBeenCalled();
    await expect(harness.coordinator.requireSession({ identityContext, sessionId })).resolves.toMatchObject({ sessionId });
  });
});

function makeHarness(messages: readonly SessionMessage[]) {
  const session: UserSession = {
    tenantId: identityContext.tenantId,
    subjectId: identityContext.subjectId,
    agentId,
    sessionId,
    title: 'Process session',
    createdAt: brand<number, 'EpochMillis'>(1),
    updatedAt: brand<number, 'EpochMillis'>(1),
    hasInFlightRequest: false,
  };
  const requireSession = vi.fn<UserSessionPort['requireSession']>(async (query) => {
    if (
      query.identityContext.tenantId !== session.tenantId ||
      query.identityContext.subjectId !== session.subjectId ||
      query.agentId !== session.agentId ||
      query.sessionId !== session.sessionId
    ) {
      throw new AgentError({
        code: 'SESSION_NOT_FOUND',
        message: 'Session was not found.',
        category: 'NOT_FOUND',
        retryable: false,
      });
    }
    return session;
  });
  const listCurrentRequestMessages = vi.fn<UserSessionPort['listCurrentRequestMessages']>(async (query) => {
    const scoped = messages.filter((item) => item.sessionId === query.sessionId && item.requestId === query.requestId && item.runId === query.runId);
    const items = scoped.slice(query.offset, query.offset + query.limit);
    return {
      items,
      limit: query.limit,
      hasMore: query.offset + items.length < scoped.length,
    };
  });
  const userSessions: UserSessionPort = {
    async createSession() {
      return session;
    },
    requireSession,
    async listSessions() {
      return { entries: [session], offset: 0, limit: 20, hasMore: false };
    },
    async deleteSession() {},
    async listMessages() {
      return { items: [], limit: 20, hasMore: false };
    },
    async listConversationPreview() {
      return { sessionId, totalMarkers: 0, offset: 0, limit: 100, markers: [] };
    },
    listCurrentRequestMessages,
    async generateTitle() {
      return false;
    },
    async updateTitle() {
      return session;
    },
  };
  const dependencies = {
    defaultRouteAgentId: agentId,
    agentConstructors: [
      class ProcessResolverTestAgent {
        static getType(): AgentType {
          return brand<string, 'AgentType'>('DEFAULT') as AgentType;
        }
      } as unknown as AgentConstructor,
    ],
    agentRuntimeDependencies: {},
    assemblyRegistry: {} as AgentAssemblyRegistry,
    capabilityCatalog: {} as CapabilityCatalog,
    userSessions,
    messageStore: {} as SessionMessageStoreGateway,
    activeContextStore: {} as ActiveContextStoreGateway,
    requestRunStore: {} as RequestRunStoreGateway,
    timelineStore: {} as RunTimelineEventStoreGateway,
    checkpointStore: {} as CheckpointStoreGateway,
  } satisfies RequestLifecycleDependencies;
  return {
    coordinator: new RequestLifecycleCoordinator(dependencies),
    requireSession,
    listCurrentRequestMessages,
  };
}

function message(messageId: string, overrides: Partial<SessionMessage> = {}): SessionMessage {
  return {
    messageId: brand<string, 'MessageId'>(messageId),
    sessionId,
    requestId,
    runId,
    role: 'ASSISTANT',
    content: `content:${messageId}`,
    contentType: 'PLAIN_TEXT',
    metadata: {},
    sequence: 1,
    visible: true,
    createdAt: brand<number, 'EpochMillis'>(1),
    ...overrides,
  };
}
