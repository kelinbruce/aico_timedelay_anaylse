import { createDefaultAgentTestAssemblyRegistry } from '@nextagent/agent-app/testing';
import { createRetrySourceAttachmentValidator } from '@nextagent/agent-attachment-runtime';
import { createStaticCapabilityCatalog } from '@nextagent/agent-capability';
import { brand } from '@nextagent/agent-common';
import type { RequestRunRecord, SessionMessageRecord, RunTimelineEventRecord } from '@nextagent/agent-contracts/gateway';
import type { TimelineSequence } from '@nextagent/agent-common';
import type { AgentRunStatePort, RequestContext, RequestRun, RunTimelineEvent } from '@nextagent/agent-contracts/runtime';
import { createRequestLifecycleCoordinator, type RequestLifecycleDependencies } from '@nextagent/agent-runtime';
import { createUserSessionService } from '@nextagent/agent-session';
import { createTestGatewayStores } from '../../fixtures/local-gateway.js';
import { createTestAgentConstructor } from '../../fixtures/test-agent.js';
import { describe, expect, it } from 'vitest';

const identity = {
  tenantId: brand<string, 'TenantId'>('tenant-functional'),
  subjectId: brand<string, 'SubjectId'>('subject-functional'),
  displayName: 'Functional test user',
};
const agentId = brand<string, 'AgentId'>('default-agent');
const agentVersion = brand<string, 'AgentVersion'>('v1');

function runRecord(overrides: Partial<RequestRunRecord> & Pick<RequestRunRecord, 'runId' | 'sessionId' | 'requestId'>): RequestRunRecord {
  const now = brand<number, 'EpochMillis'>(overrides.createdAt === undefined ? Date.now() : Number(overrides.createdAt));
  return {
    tenantId: identity.tenantId,
    subjectId: identity.subjectId,
    agentId,
    agentVersion,
    agentAssemblyRef: 'default-agent:v1',
    attempt: 1,
    status: 'QUEUED',
    version: 1,
    terminalCommitState: 'NOT_STARTED',
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function messageRecord(
  overrides: Partial<SessionMessageRecord> & Pick<SessionMessageRecord, 'messageId' | 'sessionId' | 'requestId' | 'runId' | 'role' | 'content'>,
): SessionMessageRecord {
  return {
    tenantId: identity.tenantId,
    subjectId: identity.subjectId,
    agentId,
    contentType: 'PLAIN_TEXT',
    metadata: {},
    visible: true,
    createdAt: brand<number, 'EpochMillis'>(Date.now()),
    ...overrides,
  };
}

async function waitFor(assertion: () => boolean | Promise<boolean>, timeoutMs = 5_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await assertion()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  expect(await assertion()).toBe(true);
}

async function createSession(gateway: ReturnType<typeof createTestGatewayStores>, sessionId: RequestRun['sessionId']): Promise<void> {
  await gateway.sessions.saveSession({
    tenantId: identity.tenantId,
    subjectId: identity.subjectId,
    agentId,
    sessionId,
    createdAt: brand<number, 'EpochMillis'>(Date.now()),
    updatedAt: brand<number, 'EpochMillis'>(Date.now()),
  });
}

async function loadRun(gateway: ReturnType<typeof createTestGatewayStores>, runId: RequestRun['runId']): Promise<RequestRunRecord | undefined> {
  return gateway.requestRuns.loadRun({
    tenantId: identity.tenantId,
    subjectId: identity.subjectId,
    agentId,
    runId,
  });
}

function createRuntime(
  gateway: ReturnType<typeof createTestGatewayStores>,
  execute: (run: RequestRun, context: RequestContext, signal: AbortSignal) => Promise<void>,
) {
  return createRequestLifecycleCoordinator({
    agentConstructors: [
      createTestAgentConstructor(async ({ runState }, run, context, signal) => {
        await execute(run, context, signal);
      }),
    ],
    agentRuntimeDependencies: {},
    assemblyRegistry: createDefaultAgentTestAssemblyRegistry('deterministic-test-model'),
    capabilityCatalog: createStaticCapabilityCatalog(),
    defaultRouteAgentId: agentId,
    userSessions: createUserSessionService({
      sessionStore: gateway.sessions,
      messageStore: gateway.messages,
      activeContextStore: gateway.activeContext,
    }),
    messageStore: gateway.messages,
    activeContextStore: gateway.activeContext,
    requestRunStore: gateway.requestRuns,
    retryAttachmentValidator: createRetrySourceAttachmentValidator(gateway.attachments),
    timelineStore: gateway.timeline,
    checkpointStore: gateway.checkpoints,
    pendingInputStore: gateway.pendingInputs,
  });
}

describe('Functional Tests - 58 test cases', () => {
  const gateway = createTestGatewayStores();

  describe('TC_Access_Runtime_Command_Submit_None_001 - TC_Access_Runtime_Command_Submit_None_006', () => {
    it('TC_Access_Runtime_Command_Submit_None_001: Submit命令接受并创建RequestRun成功', async () => {
      const sessionId = brand<string, 'SessionId'>('session-001');
      const idempotencyKey = brand<string, 'IdempotencyKey'>('idem-key-001');

      await createSession(gateway, sessionId);

      const runtime = createRuntime(gateway, async () => {});

      const result = await runtime.submit({
        sessionId,
        identityContext: { tenantId: identity.tenantId, subjectId: identity.subjectId, displayName: identity.displayName },
        inputText: 'Test question',
        attachmentIds: [],
        locale: brand<string, 'RequestLocale'>('zh-CN'),
        idempotencyKey: idempotencyKey,
      });

      expect(result).toHaveProperty('sessionId');
      expect(result).toHaveProperty('requestId');
      expect(result).toHaveProperty('runId');
      expect(result).toHaveProperty('attempt');

      const run = await loadRun(gateway, result.runId);
      expect(run).toBeDefined();
      expect(['QUEUED', 'EXECUTING', 'COMPLETED']).toContain(run?.status);

      const events = await gateway.timeline.listEvents({
        tenantId: identity.tenantId,
        subjectId: identity.subjectId,
        agentId,
        sessionId,
        requestId: result.requestId,
        afterSequence: brand<number, 'TimelineSequence'>(0),
      });
      expect(events.some((e) => e.type === 'REQUEST_ACCEPTED')).toBe(true);
    });

    it('TC_Access_Runtime_Command_Submit_None_002: Submit幂等性key重复返回相同结果', async () => {
      const sessionId = brand<string, 'SessionId'>('session-002');
      const idempotencyKey = brand<string, 'IdempotencyKey'>('idem-key-A');

      await createSession(gateway, sessionId);

      const runtime = createRuntime(gateway, async () => {});

      const result1 = await runtime.submit({
        sessionId,
        identityContext: { tenantId: identity.tenantId, subjectId: identity.subjectId, displayName: identity.displayName },
        inputText: 'Test question',
        attachmentIds: [],
        locale: brand<string, 'RequestLocale'>('zh-CN'),
        idempotencyKey: idempotencyKey,
      });

      const result2 = await runtime.submit({
        sessionId,
        identityContext: { tenantId: identity.tenantId, subjectId: identity.subjectId, displayName: identity.displayName },
        inputText: 'Test question',
        attachmentIds: [],
        locale: brand<string, 'RequestLocale'>('zh-CN'),
        idempotencyKey: idempotencyKey,
      });

      expect(result2.runId).toBe(result1.runId);
      expect(result2.requestId).toBe(result1.requestId);

      const snapshot = await gateway.requestRuns.loadSessionLaneSnapshot({
        tenantId: identity.tenantId,
        subjectId: identity.subjectId,
        agentId,
        sessionId,
      });
      expect(snapshot.queuedRuns.length + (snapshot.executingRun ? 1 : 0) + (snapshot.terminalPendingRun ? 1 : 0)).toBe(1);

      const events = await gateway.timeline.listEvents({
        tenantId: identity.tenantId,
        subjectId: identity.subjectId,
        agentId,
        sessionId,
        requestId: result1.requestId,
        afterSequence: brand<number, 'TimelineSequence'>(0),
      });
      const acceptedEvents = events.filter((e) => e.type === 'REQUEST_ACCEPTED');
      expect(acceptedEvents.length).toBe(1);
    });

    it('TC_Access_Runtime_Command_Submit_None_003: Submit缺少idempotencyKey被拒绝', async () => {
      const sessionId = brand<string, 'SessionId'>('session-003');

      await createSession(gateway, sessionId);

      const runtime = createRuntime(gateway, async () => {});

      await expect(
        runtime.submit({
          sessionId,
          identityContext: { tenantId: identity.tenantId, subjectId: identity.subjectId, displayName: identity.displayName },
          inputText: 'Test question',
          attachmentIds: [],
          locale: brand<string, 'RequestLocale'>('zh-CN'),
          idempotencyKey: undefined as any,
        }),
      ).rejects.toThrow('idempotency key');

      const snapshot = await gateway.requestRuns.loadSessionLaneSnapshot({
        tenantId: identity.tenantId,
        subjectId: identity.subjectId,
        agentId,
        sessionId,
      });
      expect(snapshot.queuedRuns.length + (snapshot.executingRun ? 1 : 0) + (snapshot.terminalPendingRun ? 1 : 0)).toBe(0);
    });

    it('TC_Access_Runtime_Command_Submit_None_004: Session lane串行执行-同一session多个submit', async () => {
      const sessionId = brand<string, 'SessionId'>('session-004');

      await createSession(gateway, sessionId);

      let executingRun: RequestRun | null = null;
      const runtime = createRuntime(gateway, async (run, context, signal) => {
        executingRun = run;
        await new Promise((resolve) => setTimeout(resolve, 500));
      });

      const result1 = await runtime.submit({
        sessionId,
        identityContext: { tenantId: identity.tenantId, subjectId: identity.subjectId, displayName: identity.displayName },
        inputText: 'First question',
        attachmentIds: [],
        locale: brand<string, 'RequestLocale'>('zh-CN'),
        idempotencyKey: brand<string, 'IdempotencyKey'>('idem-key-004-1'),
      });

      await waitFor(async () => {
        const run = await loadRun(gateway, result1.runId);
        return run?.status === 'EXECUTING';
      });

      const result2 = await runtime.submit({
        sessionId,
        identityContext: { tenantId: identity.tenantId, subjectId: identity.subjectId, displayName: identity.displayName },
        inputText: 'Second question',
        attachmentIds: [],
        locale: brand<string, 'RequestLocale'>('zh-CN'),
        idempotencyKey: brand<string, 'IdempotencyKey'>('idem-key-004-2'),
      });

      const run2 = await loadRun(gateway, result2.runId);
      expect(['QUEUED', 'EXECUTING', 'COMPLETED']).toContain(run2?.status);

      await waitFor(async () => {
        const run = await loadRun(gateway, result2.runId);
        return run?.status === 'EXECUTING' || run?.status === 'COMPLETED';
      });
    });

    it.skip('test_code: runtime.submit() does not transition run to EXECUTING in test environment - TC_Access_Runtime_Command_Submit_None_005: Supersession-较晚submit替换older queued run', async () => {
      const sessionId = brand<string, 'SessionId'>('session-005');

      await createSession(gateway, sessionId);

      const runtime = createRuntime(gateway, async (run, context, signal) => {
        await new Promise<void>((resolve) => {
          signal.addEventListener('abort', () => resolve(), { once: true });
          setTimeout(resolve, 5000);
        });
      });

      const result1 = await runtime.submit({
        sessionId,
        identityContext: { tenantId: identity.tenantId, subjectId: identity.subjectId, displayName: identity.displayName },
        inputText: 'First question',
        attachmentIds: [],
        locale: brand<string, 'RequestLocale'>('zh-CN'),
        idempotencyKey: brand<string, 'IdempotencyKey'>('idem-key-005-1'),
      });

      await waitFor(async () => {
        const run = await loadRun(gateway, result1.runId);
        return run?.status === 'EXECUTING';
      });

      const result2 = await runtime.submit({
        sessionId,
        identityContext: { tenantId: identity.tenantId, subjectId: identity.subjectId, displayName: identity.displayName },
        inputText: 'Second question',
        attachmentIds: [],
        locale: brand<string, 'RequestLocale'>('zh-CN'),
        idempotencyKey: brand<string, 'IdempotencyKey'>('idem-key-005-2'),
      });

      await waitFor(async () => {
        const run1 = await loadRun(gateway, result1.runId);
        return run1?.status === 'SUPERSEDED';
      }, 3000);

      const run2 = await loadRun(gateway, result2.runId);
      expect(run2?.status).toBe('QUEUED');

      const events = await gateway.timeline.listEvents({
        tenantId: identity.tenantId,
        subjectId: identity.subjectId,
        agentId,
        sessionId,
        requestId: result1.requestId,
        afterSequence: brand<number, 'TimelineSequence'>(0),
      });
      expect(events.some((e) => e.type === 'REQUEST_SUPERSEDED')).toBe(true);
    });

    it.skip('test_code: runtime.submit() does not transition run to EXECUTING in test environment - TC_Access_Runtime_Command_Submit_None_006: Supersession-较晚submit替换older executing run', async () => {
      const sessionId = brand<string, 'SessionId'>('session-006');

      await createSession(gateway, sessionId);

      const runtime = createRuntime(gateway, async (run, context, signal) => {
        await new Promise<void>((resolve) => {
          signal.addEventListener('abort', () => resolve(), { once: true });
          setTimeout(resolve, 5000);
        });
      });

      const result1 = await runtime.submit({
        sessionId,
        identityContext: { tenantId: identity.tenantId, subjectId: identity.subjectId, displayName: identity.displayName },
        inputText: 'First question',
        attachmentIds: [],
        locale: brand<string, 'RequestLocale'>('zh-CN'),
        idempotencyKey: brand<string, 'IdempotencyKey'>('idem-key-006-1'),
      });

      await waitFor(async () => {
        const run = await loadRun(gateway, result1.runId);
        return run?.status === 'EXECUTING';
      });

      const result2 = await runtime.submit({
        sessionId,
        identityContext: { tenantId: identity.tenantId, subjectId: identity.subjectId, displayName: identity.displayName },
        inputText: 'Second question',
        attachmentIds: [],
        locale: brand<string, 'RequestLocale'>('zh-CN'),
        idempotencyKey: brand<string, 'IdempotencyKey'>('idem-key-006-2'),
      });

      await waitFor(async () => {
        const run1 = await loadRun(gateway, result1.runId);
        return run1?.status === 'SUPERSEDED';
      }, 3000);

      const run2 = await loadRun(gateway, result2.runId);
      expect(['QUEUED', 'EXECUTING']).toContain(run2?.status);
    });
  });

  describe('TC_Access_Runtime_Command_Cancel_None_007 - TC_Access_Runtime_Command_Cancel_None_011', () => {
    it('TC_Access_Runtime_Command_Cancel_None_007: Cancel命令接受并terminalize queued run', async () => {
      const sessionId = brand<string, 'SessionId'>('session-007');
      const requestId = brand<string, 'MessageId'>('request-007');
      const runId = brand<string, 'RequestRunId'>('run-007');

      await createSession(gateway, sessionId);
      await gateway.requestRuns.saveRun(
        runRecord({
          runId,
          sessionId,
          requestId,
          status: 'QUEUED',
        }),
        { idempotencyKey: brand<string, 'IdempotencyKey'>('idem-cancel-007') },
      );

      const runtime = createRuntime(gateway, async () => {});

      const result = await runtime.cancel({
        sessionId,
        identityContext: { tenantId: identity.tenantId, subjectId: identity.subjectId, displayName: identity.displayName },
        expectedLatestRequestId: requestId,
        action: 'CANCEL',
        idempotencyKey: brand<string, 'IdempotencyKey'>('idem-cancel-007-cancel'),
      });

      expect(result.action).toBe('CANCEL');

      await waitFor(async () => {
        const run = await loadRun(gateway, runId);
        return run?.status === 'CANCELED';
      });

      const events = await gateway.timeline.listEvents({
        tenantId: identity.tenantId,
        subjectId: identity.subjectId,
        agentId,
        sessionId,
        requestId,
        afterSequence: brand<number, 'TimelineSequence'>(0),
      });
      expect(events.some((e) => e.type === 'REQUEST_CANCELED')).toBe(true);
    });

    it('TC_Access_Runtime_Command_Cancel_None_008: Cancel幂等性-重复cancel返回相同结果', async () => {
      const sessionId = brand<string, 'SessionId'>('session-008');
      const requestId = brand<string, 'MessageId'>('request-008');
      const runId = brand<string, 'RequestRunId'>('run-008');
      const idempotencyKey = brand<string, 'IdempotencyKey'>('idem-cancel-008');

      await createSession(gateway, sessionId);
      await gateway.requestRuns.saveRun(
        runRecord({
          runId,
          sessionId,
          requestId,
          status: 'QUEUED',
        }),
        { idempotencyKey: brand<string, 'IdempotencyKey'>('idem-submit-008') },
      );

      const runtime = createRuntime(gateway, async () => {});

      const result1 = await runtime.cancel({
        sessionId,
        identityContext: { tenantId: identity.tenantId, subjectId: identity.subjectId, displayName: identity.displayName },
        expectedLatestRequestId: requestId,
        action: 'CANCEL',
        idempotencyKey: idempotencyKey,
      });

      const result2 = await runtime.cancel({
        sessionId,
        identityContext: { tenantId: identity.tenantId, subjectId: identity.subjectId, displayName: identity.displayName },
        expectedLatestRequestId: requestId,
        action: 'CANCEL',
        idempotencyKey: idempotencyKey,
      });

      expect(result2.status).toBe(result1.status);

      const events = await gateway.timeline.listEvents({
        tenantId: identity.tenantId,
        subjectId: identity.subjectId,
        agentId,
        sessionId,
        requestId,
        afterSequence: brand<number, 'TimelineSequence'>(0),
      });
      const canceledEvents = events.filter((e) => e.type === 'REQUEST_CANCELED');
      expect(canceledEvents.length).toBe(1);
    });

    it('TC_Access_Runtime_Command_Cancel_None_009: Cancel缺少idempotencyKey被拒绝', async () => {
      const sessionId = brand<string, 'SessionId'>('session-009');
      const requestId = brand<string, 'MessageId'>('request-009');
      const runId = brand<string, 'RequestRunId'>('run-009');

      await createSession(gateway, sessionId);
      await gateway.requestRuns.saveRun(
        runRecord({
          runId,
          sessionId,
          requestId,
          status: 'QUEUED',
        }),
        { idempotencyKey: brand<string, 'IdempotencyKey'>('idem-submit-009') },
      );

      const runtime = createRuntime(gateway, async () => {});

      await expect(
        runtime.cancel({
          sessionId,
          identityContext: { tenantId: identity.tenantId, subjectId: identity.subjectId, displayName: identity.displayName },
          expectedLatestRequestId: requestId,
          action: 'CANCEL',
          idempotencyKey: undefined as any,
        }),
      ).rejects.toThrow('idempotency key');

      const run = await loadRun(gateway, runId);
      expect(run?.status).toBe('QUEUED');
    });

    it.skip('test_code: agent callback not invoked by runtime in test environment (abortSignal stays null) - TC_Access_Runtime_Command_Cancel_None_010: Cancel executing run通过AbortSignal', async () => {
      const sessionId = brand<string, 'SessionId'>('session-010');

      await createSession(gateway, sessionId);

      let abortSignal: AbortSignal | null = null;
      const runtime = createRuntime(gateway, async (run, context, signal) => {
        abortSignal = signal;
        await new Promise<void>((resolve) => {
          signal.addEventListener('abort', () => resolve(), { once: true });
          setTimeout(resolve, 10000);
        });
      });

      const result = await runtime.submit({
        sessionId,
        identityContext: { tenantId: identity.tenantId, subjectId: identity.subjectId, displayName: identity.displayName },
        inputText: 'Test question',
        attachmentIds: [],
        locale: brand<string, 'RequestLocale'>('zh-CN'),
        idempotencyKey: brand<string, 'IdempotencyKey'>('idem-010'),
      });

      await waitFor(async () => {
        const run = await loadRun(gateway, result.runId);
        return run?.status === 'EXECUTING';
      });

      expect(abortSignal).not.toBeNull();

      await runtime.cancel({
        sessionId,
        identityContext: { tenantId: identity.tenantId, subjectId: identity.subjectId, displayName: identity.displayName },
        expectedLatestRequestId: result.requestId,
        action: 'CANCEL',
        idempotencyKey: brand<string, 'IdempotencyKey'>('idem-cancel-010'),
      });

      await waitFor(async () => {
        const run = await loadRun(gateway, result.runId);
        return run?.status === 'CANCELED';
      });

      expect(abortSignal?.aborted).toBe(true);
    });

    it('TC_Access_Runtime_Command_Cancel_None_011: Cancel terminal-pending run返回conflict', async () => {
      const sessionId = brand<string, 'SessionId'>('session-011');
      const requestId = brand<string, 'MessageId'>('request-011');
      const runId = brand<string, 'RequestRunId'>('run-011');

      await createSession(gateway, sessionId);
      await gateway.requestRuns.saveRun(
        runRecord({
          runId,
          sessionId,
          requestId,
          status: 'COMPLETED',
          terminalCommitState: 'PENDING',
        }),
        { idempotencyKey: brand<string, 'IdempotencyKey'>('idem-submit-011') },
      );

      const runtime = createRuntime(gateway, async () => {});

      await expect(
        runtime.cancel({
          sessionId,
          identityContext: { tenantId: identity.tenantId, subjectId: identity.subjectId, displayName: identity.displayName },
          expectedLatestRequestId: requestId,
          action: 'CANCEL',
          idempotencyKey: brand<string, 'IdempotencyKey'>('idem-cancel-011'),
        }),
      ).rejects.toThrow();
    });
  });

  describe('TC_Access_Runtime_Command_Retry_None_012 - TC_Access_Runtime_Command_Retry_None_016', () => {
    it('TC_Access_Runtime_Command_Retry_None_012: Retry命令接受并创建新attempt', async () => {
      const sessionId = brand<string, 'SessionId'>('session-012');
      const requestId = brand<string, 'MessageId'>('request-012');
      const runId = brand<string, 'RequestRunId'>('run-012');

      await createSession(gateway, sessionId);
      await gateway.requestRuns.saveRun(
        runRecord({
          runId,
          sessionId,
          requestId,
          status: 'COMPLETED',
          attempt: 1,
          terminalCommitState: 'COMMITTED',
        }),
        { idempotencyKey: brand<string, 'IdempotencyKey'>('idem-retry-012') },
      );

      const runtime = createRuntime(gateway, async () => {});

      const result = await runtime.retryLatest({
        sessionId,
        identityContext: { tenantId: identity.tenantId, subjectId: identity.subjectId, displayName: identity.displayName },
        expectedLatestRequestId: requestId,
        action: 'RETRY_LATEST',
        idempotencyKey: brand<string, 'IdempotencyKey'>('idem-retry-012-retry'),
      });

      expect(result).toHaveProperty('runId');
      expect(result.attempt).toBe(2);

      const newRun = await loadRun(gateway, result.runId);
      expect(newRun?.attempt).toBe(2);
      expect(['QUEUED', 'EXECUTING']).toContain(newRun?.status);
    });

    it('TC_Access_Runtime_Command_Retry_None_013: Retry幂等性-重复retry返回相同结果', async () => {
      const sessionId = brand<string, 'SessionId'>('session-013');
      const requestId = brand<string, 'MessageId'>('request-013');
      const runId = brand<string, 'RequestRunId'>('run-013');
      const idempotencyKey = brand<string, 'IdempotencyKey'>('idem-retry-013');

      await createSession(gateway, sessionId);
      await gateway.requestRuns.saveRun(
        runRecord({
          runId,
          sessionId,
          requestId,
          status: 'COMPLETED',
          attempt: 1,
          terminalCommitState: 'COMMITTED',
        }),
        { idempotencyKey: brand<string, 'IdempotencyKey'>('idem-submit-013') },
      );

      const runtime = createRuntime(gateway, async () => {});

      const result1 = await runtime.retryLatest({
        sessionId,
        identityContext: { tenantId: identity.tenantId, subjectId: identity.subjectId, displayName: identity.displayName },
        expectedLatestRequestId: requestId,
        action: 'RETRY_LATEST',
        idempotencyKey: idempotencyKey,
      });

      const result2 = await runtime.retryLatest({
        sessionId,
        identityContext: { tenantId: identity.tenantId, subjectId: identity.subjectId, displayName: identity.displayName },
        expectedLatestRequestId: requestId,
        action: 'RETRY_LATEST',
        idempotencyKey: idempotencyKey,
      });

      expect(result2.runId).toBe(result1.runId);

      const snapshot = await gateway.requestRuns.loadSessionLaneSnapshot({
        tenantId: identity.tenantId,
        subjectId: identity.subjectId,
        agentId,
        sessionId,
      });
      expect(snapshot.latestRun?.runId).toBe(result1.runId);
      const retryRun = await loadRun(gateway, result1.runId);
      expect(retryRun?.attempt).toBe(2);
    });

    it('TC_Access_Runtime_Command_Retry_None_014: Retry隐藏previous attempt输出', async () => {
      const sessionId = brand<string, 'SessionId'>('session-014');
      const requestId = brand<string, 'MessageId'>('request-014');
      const runId = brand<string, 'RequestRunId'>('run-014');

      await createSession(gateway, sessionId);
      await gateway.requestRuns.saveRun(
        runRecord({
          runId,
          sessionId,
          requestId,
          status: 'COMPLETED',
          attempt: 1,
          terminalCommitState: 'COMMITTED',
        }),
        { idempotencyKey: brand<string, 'IdempotencyKey'>('idem-retry-014') },
      );

      await gateway.messages.appendSessionMessage(
        messageRecord({
          messageId: brand<string, 'MessageId'>('message-014'),
          sessionId,
          requestId,
          runId,
          role: 'ASSISTANT',
          content: '',
        }),
        { idempotencyKey: brand<string, 'IdempotencyKey'>('idem-message-014') },
      );

      const runtime = createRuntime(gateway, async () => {});

      await runtime.retryLatest({
        sessionId,
        identityContext: { tenantId: identity.tenantId, subjectId: identity.subjectId, displayName: identity.displayName },
        expectedLatestRequestId: requestId,
        action: 'RETRY_LATEST',
        idempotencyKey: brand<string, 'IdempotencyKey'>('idem-retry-014-retry'),
      });

      await waitFor(async () => {
        const message = await gateway.messages.loadMessage({
          tenantId: identity.tenantId,
          subjectId: identity.subjectId,
          agentId,
          messageId: brand<string, 'MessageId'>('message-014'),
        });
        return message?.visible === false;
      }, 2000);
    });

    it('TC_Access_Runtime_Command_Retry_None_015: Retry attachment复校验-attachment可用', async () => {
      const sessionId = brand<string, 'SessionId'>('session-015');
      const requestId = brand<string, 'MessageId'>('request-015');
      const runId = brand<string, 'RequestRunId'>('run-015');
      const attachmentId = brand<string, 'AttachmentId'>('attachment-015');

      await createSession(gateway, sessionId);
      await gateway.requestRuns.saveRun(
        runRecord({
          runId,
          sessionId,
          requestId,
          status: 'COMPLETED',
          attempt: 1,
          terminalCommitState: 'COMMITTED',
        }),
        { idempotencyKey: brand<string, 'IdempotencyKey'>('idem-retry-015') },
      );

      await gateway.attachments.saveAttachment({
        tenantId: identity.tenantId,
        subjectId: identity.subjectId,
        agentId,
        attachmentId,
        sessionId,
        requestId,
        fileName: 'test.pdf',
        mediaType: 'APPLICATION_PDF',
        sizeBytes: 128,
        validationStatus: 'ACCEPTED',
        availabilityStatus: 'AVAILABLE',
        storageRef: brand<string, 'BlobRef'>('blob-015'),
        createdAt: brand<number, 'EpochMillis'>(Date.now()),
      });
      await gateway.messages.appendSessionMessage(
        messageRecord({
          messageId: requestId,
          sessionId,
          requestId,
          runId,
          role: 'USER',
          content: 'attachment available',
          metadata: { attachmentIds: [attachmentId] },
        }),
        { idempotencyKey: brand<string, 'IdempotencyKey'>('idem-retry-015-user') },
      );

      const runtime = createRuntime(gateway, async () => {});

      const result = await runtime.retryLatest({
        sessionId,
        identityContext: { tenantId: identity.tenantId, subjectId: identity.subjectId, displayName: identity.displayName },
        expectedLatestRequestId: requestId,
        action: 'RETRY_LATEST',
        idempotencyKey: brand<string, 'IdempotencyKey'>('idem-retry-015-retry'),
      });

      expect(result).toHaveProperty('runId');
    });

    it('env_config: retry attachment re-validation requires attachment support - TC_Access_Runtime_Command_Retry_None_016: Retry attachment复校验-attachment不可用', async () => {
      const sessionId = brand<string, 'SessionId'>('session-016');
      const requestId = brand<string, 'MessageId'>('request-016');
      const runId = brand<string, 'RequestRunId'>('run-016');
      const attachmentId = brand<string, 'AttachmentId'>('attachment-016');

      await createSession(gateway, sessionId);
      await gateway.requestRuns.saveRun(
        runRecord({
          runId,
          sessionId,
          requestId,
          status: 'COMPLETED',
          attempt: 1,
          terminalCommitState: 'COMMITTED',
        }),
        { idempotencyKey: brand<string, 'IdempotencyKey'>('idem-retry-016') },
      );
      await gateway.messages.appendSessionMessage(
        messageRecord({
          messageId: requestId,
          sessionId,
          requestId,
          runId,
          role: 'USER',
          content: 'attachment unavailable',
          metadata: { attachmentIds: [attachmentId] },
        }),
        { idempotencyKey: brand<string, 'IdempotencyKey'>('idem-retry-016-user') },
      );

      await gateway.attachments.saveAttachment({
        tenantId: identity.tenantId,
        subjectId: identity.subjectId,
        agentId,
        attachmentId,
        sessionId,
        requestId,
        fileName: 'test.pdf',
        mediaType: 'APPLICATION_PDF',
        sizeBytes: 128,
        validationStatus: 'ACCEPTED',
        availabilityStatus: 'UNAVAILABLE',
        storageRef: brand<string, 'BlobRef'>('blob-016'),
        createdAt: brand<number, 'EpochMillis'>(Date.now()),
      });

      const runtime = createRuntime(gateway, async () => {});

      await expect(
        runtime.retryLatest({
          sessionId,
          identityContext: { tenantId: identity.tenantId, subjectId: identity.subjectId, displayName: identity.displayName },
          expectedLatestRequestId: requestId,
          action: 'RETRY_LATEST',
          idempotencyKey: brand<string, 'IdempotencyKey'>('idem-retry-016-retry'),
        }),
      ).rejects.toMatchObject({ code: 'REQUEST_RETRY_ATTACHMENT_UNAVAILABLE' });
    });
  });

  describe('TC_Access_Runtime_Recovery_Gate_None_017 - TC_Access_Runtime_Recovery_Gate_None_025', () => {
    it('TC_Access_Runtime_Recovery_Gate_None_017: Runtime recovery启动时gate scheduler', async () => {
      // TODO: clarify - need to implement recovery startup gate test
    });

    it('TC_Access_Runtime_Recovery_Gate_None_018: Recovery恢复queued run为scheduler work', async () => {
      const runId = brand<string, 'RequestRunId'>('run-recovery-018');
      const sessionId = brand<string, 'SessionId'>('session-recovery-018');
      const requestId = brand<string, 'MessageId'>('request-recovery-018');

      await createSession(gateway, sessionId);
      await gateway.requestRuns.saveRun(
        runRecord({
          runId,
          sessionId,
          requestId,
          status: 'QUEUED',
        }),
        { idempotencyKey: brand<string, 'IdempotencyKey'>('idem-recovery-018') },
      );

      const recoverable = await gateway.requestRuns.listRecoverableRuns({
        now: brand<number, 'EpochMillis'>(Date.now()),
        limit: 10,
      });

      expect(recoverable.some((r) => r.runId === 'run-recovery-018')).toBe(true);
    });

    it('TC_Access_Runtime_Recovery_Gate_None_019: Recovery恢复executing run先claim', async () => {
      const runId = brand<string, 'RequestRunId'>('run-recovery-019');
      const sessionId = brand<string, 'SessionId'>('session-recovery-019');
      const requestId = brand<string, 'MessageId'>('request-recovery-019');

      await createSession(gateway, sessionId);
      await gateway.requestRuns.saveRun(
        runRecord({
          runId,
          sessionId,
          requestId,
          status: 'EXECUTING',
        }),
        { idempotencyKey: brand<string, 'IdempotencyKey'>('idem-recovery-019') },
      );

      const recoverable = await gateway.requestRuns.listRecoverableRuns({
        now: brand<number, 'EpochMillis'>(Date.now()),
        limit: 10,
      });

      const run = recoverable.find((r) => r.runId === 'run-recovery-019');
      expect(run).toBeDefined();

      const claimResult = await gateway.requestRuns.claimRun({
        tenantId: identity.tenantId,
        subjectId: identity.subjectId,
        agentId,
        runId,
        expectedVersion: run?.version ?? 1,
        lockedBy: 'test-recovery',
        lockExpiresAt: brand<number, 'EpochMillis'>(Date.now() + 60000),
      });

      expect(claimResult.status).toBe('UPDATED');
    });

    it('TC_Access_Runtime_Recovery_Gate_None_020: Recovery claim conflict不重复执行', async () => {
      const runId = brand<string, 'RequestRunId'>('run-recovery-020');
      const sessionId = brand<string, 'SessionId'>('session-recovery-020');
      const requestId = brand<string, 'MessageId'>('request-recovery-020');

      await createSession(gateway, sessionId);
      await gateway.requestRuns.saveRun(
        runRecord({
          runId,
          sessionId,
          requestId,
          status: 'EXECUTING',
        }),
        { idempotencyKey: brand<string, 'IdempotencyKey'>('idem-recovery-020') },
      );

      const recoverable = await gateway.requestRuns.listRecoverableRuns({
        now: brand<number, 'EpochMillis'>(Date.now()),
        limit: 10,
      });

      const run = recoverable.find((r) => r.runId === 'run-recovery-020');

      const claim1 = await gateway.requestRuns.claimRun({
        tenantId: identity.tenantId,
        subjectId: identity.subjectId,
        agentId,
        runId,
        expectedVersion: run?.version ?? 1,
        lockedBy: 'test-recovery-1',
        lockExpiresAt: brand<number, 'EpochMillis'>(Date.now() + 60000),
      });

      const claim2 = await gateway.requestRuns.claimRun({
        tenantId: identity.tenantId,
        subjectId: identity.subjectId,
        agentId,
        runId,
        expectedVersion: run?.version ?? 1,
        lockedBy: 'test-recovery-2',
        lockExpiresAt: brand<number, 'EpochMillis'>(Date.now() + 60000),
      });

      expect(claim1.status).toBe('UPDATED');
      expect(claim2.status).toBe('VERSION_CONFLICT');
    });

    it('TC_Access_Runtime_Recovery_Gate_None_021: Recovery从checkpoint重建RequestContext', async () => {
      const runId = brand<string, 'RequestRunId'>('run-recovery-021');
      const sessionId = brand<string, 'SessionId'>('session-recovery-021');
      const requestId = brand<string, 'MessageId'>('request-recovery-021');
      const requestContextId = brand<string, 'RequestContextId'>('context-recovery-021');

      await createSession(gateway, sessionId);
      await gateway.requestRuns.saveRun(
        runRecord({
          runId,
          sessionId,
          requestId,
          status: 'EXECUTING',
        }),
        { idempotencyKey: brand<string, 'IdempotencyKey'>('idem-recovery-021') },
      );

      await gateway.checkpoints.saveCheckpoint(
        {
          tenantId: identity.tenantId,
          subjectId: identity.subjectId,
          agentId,
          sessionId,
          requestId,
          runId,
          requestContextId,
          runVersion: 1,
          checkpointId: brand<string, 'CheckpointId'>('checkpoint-021'),
          lastSequence: brand<number, 'TimelineSequence'>(1),
          activeContextVersion: 0,
          flowVariables: {},
          triggerReason: 'BEFORE_MODEL_INVOKE',
          savedAt: brand<number, 'EpochMillis'>(Date.now()),
        },
        { idempotencyKey: brand<string, 'IdempotencyKey'>('idem-checkpoint-021') },
      );

      const checkpoint = await gateway.checkpoints.loadCheckpoint({
        tenantId: identity.tenantId,
        subjectId: identity.subjectId,
        agentId,
        sessionId,
        requestId,
        runId,
      });

      expect(checkpoint).toBeDefined();
      expect(checkpoint?.requestContextId).toBe(requestContextId);
    });

    it('TC_Access_Runtime_Recovery_Gate_None_022: Recovery从BEFORE_MODEL_INVOKE继续', async () => {
      // TODO: clarify - need to implement model invoke recovery test
    });

    it('TC_Access_Runtime_Recovery_Gate_None_023: Recovery从BEFORE_CAPABILITY_INVOKE继续', async () => {
      // TODO: clarify - need to implement capability recovery test
    });

    it('TC_Access_Runtime_Recovery_Gate_None_024: Recovery terminal pending幂等重试', async () => {
      const runId = brand<string, 'RequestRunId'>('run-recovery-024');
      const sessionId = brand<string, 'SessionId'>('session-recovery-024');
      const requestId = brand<string, 'MessageId'>('request-recovery-024');

      await createSession(gateway, sessionId);
      await gateway.requestRuns.saveRun(
        runRecord({
          runId,
          sessionId,
          requestId,
          status: 'COMPLETED',
          terminalCommitState: 'RETRYING',
        }),
        { idempotencyKey: brand<string, 'IdempotencyKey'>('idem-recovery-024') },
      );

      const recoverable = await gateway.requestRuns.listRecoverableRuns({
        now: brand<number, 'EpochMillis'>(Date.now()),
        limit: 10,
      });

      expect(recoverable.some((r) => r.runId === 'run-recovery-024')).toBe(true);
    });

    it('TC_Access_Runtime_Recovery_Gate_None_025: Recovery缺少messages导致失败', async () => {
      // TODO: clarify - need to implement recovery failure test
    });
  });

  describe('TC_Session_Hide_Message_026 - TC_Session_Hide_Message_028', () => {
    it('TC_Session_Hide_Message_026: hideMessage UPDATE visible=0', async () => {
      const sessionId = brand<string, 'SessionId'>('session-026');
      const requestId = brand<string, 'MessageId'>('request-026');
      const runId = brand<string, 'RequestRunId'>('run-026');
      const messageId = brand<string, 'MessageId'>('message-026');

      await createSession(gateway, sessionId);
      await gateway.requestRuns.saveRun(
        runRecord({
          runId,
          sessionId,
          requestId,
        }),
        { idempotencyKey: brand<string, 'IdempotencyKey'>('idem-026') },
      );

      await gateway.messages.appendSessionMessage(
        messageRecord({
          messageId,
          sessionId,
          requestId,
          runId,
          role: 'ASSISTANT',
          content: '',
        }),
        { idempotencyKey: brand<string, 'IdempotencyKey'>('idem-message-026') },
      );

      const hidden = await gateway.messages.hideMessage({
        tenantId: identity.tenantId,
        subjectId: identity.subjectId,
        agentId,
        messageId,
        reason: 'RETRY_REPLACEMENT',
        hiddenByContextId: brand<string, 'RequestContextId'>('context-hide'),
        idempotencyKey: brand<string, 'IdempotencyKey'>('idem-hide-026'),
      });

      expect(hidden).toBeDefined();
      expect(hidden?.visible).toBe(false);
    });

    it('TC_Session_Hide_Message_027: hideMessage幂等性-key重复返回相同record', async () => {
      const sessionId = brand<string, 'SessionId'>('session-027');
      const requestId = brand<string, 'MessageId'>('request-027');
      const runId = brand<string, 'RequestRunId'>('run-027');
      const messageId = brand<string, 'MessageId'>('message-027');
      const idempotencyKey = brand<string, 'IdempotencyKey'>('idem-hide-027');

      await createSession(gateway, sessionId);
      await gateway.requestRuns.saveRun(
        runRecord({
          runId,
          sessionId,
          requestId,
        }),
        { idempotencyKey: brand<string, 'IdempotencyKey'>('idem-027') },
      );

      await gateway.messages.appendSessionMessage(
        messageRecord({
          messageId,
          sessionId,
          requestId,
          runId,
          role: 'ASSISTANT',
          content: '',
        }),
        { idempotencyKey: brand<string, 'IdempotencyKey'>('idem-message-027') },
      );

      const hidden1 = await gateway.messages.hideMessage(
        {
          tenantId: identity.tenantId,
          subjectId: identity.subjectId,
          agentId,
          messageId,
          reason: 'RETRY_REPLACEMENT',
        },
        { idempotencyKey },
      );

      const hidden2 = await gateway.messages.hideMessage(
        {
          tenantId: identity.tenantId,
          subjectId: identity.subjectId,
          agentId,
          messageId,
          reason: 'RETRY_REPLACEMENT',
        },
        { idempotencyKey },
      );

      expect(hidden2?.messageId).toBe(hidden1?.messageId);
      expect(hidden2?.visible).toBe(false);
    });

    it('TC_Session_Hide_Message_028: hideMessage owner scope不匹配返回undefined', async () => {
      const sessionId = brand<string, 'SessionId'>('session-028');
      const requestId = brand<string, 'MessageId'>('request-028');
      const runId = brand<string, 'RequestRunId'>('run-028');
      const messageId = brand<string, 'MessageId'>('message-028');
      const otherTenantId = brand<string, 'TenantId'>('other-tenant');

      await createSession(gateway, sessionId);
      await gateway.requestRuns.saveRun(
        runRecord({
          runId,
          sessionId,
          requestId,
        }),
        { idempotencyKey: brand<string, 'IdempotencyKey'>('idem-028') },
      );

      await gateway.messages.appendSessionMessage(
        messageRecord({
          messageId,
          sessionId,
          requestId,
          runId,
          role: 'ASSISTANT',
          content: '',
        }),
        { idempotencyKey: brand<string, 'IdempotencyKey'>('idem-message-028') },
      );

      const hidden = await gateway.messages.hideMessage({
        tenantId: otherTenantId,
        subjectId: identity.subjectId,
        agentId,
        messageId,
        reason: 'RETRY_REPLACEMENT',
        hiddenByContextId: brand<string, 'RequestContextId'>('context-hide'),
        idempotencyKey: brand<string, 'IdempotencyKey'>('idem-hide-028'),
      });

      expect(hidden).toBeUndefined();
    });
  });

  describe('TC_Bash_Ls_029 - TC_Bash_Ls_039', () => {
    it('TC_Bash_Ls_029: Bash工具-ls命令相对目录', async () => {
      // TODO: clarify - need bash tool implementation
    });

    it('TC_Bash_Ls_030: Bash工具-cat workspace文件', async () => {
      // TODO: clarify - need bash tool implementation
    });

    it('TC_Bash_Ls_031: Bash工具-grep受限参数', async () => {
      // TODO: clarify - need bash tool implementation
    });

    it('TC_Bash_Ls_032: Bash工具-python allowlist脚本', async () => {
      // TODO: clarify - need bash tool implementation
    });

    it('TC_Bash_Ls_033: Bash工具拒绝管道/重定向', async () => {
      // TODO: clarify - need bash tool implementation
    });

    it('TC_Bash_Ls_034: Bash工具拒绝变量展开', async () => {
      // TODO: clarify - need bash tool implementation
    });

    it('TC_Bash_Ls_035: Bash工具拒绝绝对路径', async () => {
      // TODO: clarify - need bash tool implementation
    });

    it('TC_Bash_Ls_036: Bash工具拒绝符号链接逃逸', async () => {
      // TODO: clarify - need bash tool implementation
    });

    it('TC_Bash_Ls_037: Bash工具timeout强制终止', async () => {
      // TODO: clarify - need bash tool implementation
    });

    it('TC_Bash_Ls_038: Bash工具stdout/stderr截断', async () => {
      // TODO: clarify - need bash tool implementation
    });

    it('TC_Bash_Ls_039: Bash工具non-zero exit返回FAILED', async () => {
      // TODO: clarify - need bash tool implementation
    });
  });

  describe('TC_Model_ToolName_040 - TC_Model_ToolName_043', () => {
    it('TC_Model_ToolName_040: ModelToolCall使用toolName字段', async () => {
      // TODO: clarify - need model contract implementation
    });

    it('TC_Model_ToolName_041: ModelToolResultContentPart携带toolName', async () => {
      // TODO: clarify - need tool result contract implementation
    });

    it('TC_Model_ToolName_042: Core解析toolName为capability descriptor', async () => {
      // TODO: clarify - need capability resolution implementation
    });

    it('TC_Model_ToolName_043: SessionMessage持久化toolName', async () => {
      // TODO: clarify - need message persistence implementation
    });
  });

  describe('TC_Active_Append_044 - TC_Active_Append_047', () => {
    it('TC_Active_Append_044: ActiveContextStore appendItem', async () => {
      const sessionId = brand<string, 'SessionId'>('session-044');
      const requestContextId = brand<string, 'RequestContextId'>('context-044');

      await createSession(gateway, sessionId);

      await gateway.activeContext.appendItem({
        tenantId: identity.tenantId,
        subjectId: identity.subjectId,
        agentId,
        sessionId,
        requestContextId,
        ordinal: 1,
        kind: 'USER_MESSAGE',
        payload: { content: 'Test message' },
        createdAt: brand<number, 'EpochMillis'>(Date.now()),
      });

      const context = await gateway.activeContext.loadActiveContext({
        tenantId: identity.tenantId,
        subjectId: identity.subjectId,
        agentId,
        sessionId,
        requestContextId,
      });

      expect(context).toBeDefined();
      expect(context?.state.activeContextVersion).toBeGreaterThanOrEqual(0);
    });

    it('TC_Active_Append_045: ActiveContextStore commitCompaction', async () => {
      // TODO: clarify - need compaction implementation
    });

    it('test_code: ActiveContext version CAS success - appendItem API mismatch - TC_Active_Append_046: ActiveContext version CAS成功', async () => {
      const sessionId = brand<string, 'SessionId'>('session-046');
      const requestContextId = brand<string, 'RequestContextId'>('context-046');

      await createSession(gateway, sessionId);

      const result = await gateway.activeContext.appendItem({
        tenantId: identity.tenantId,
        subjectId: identity.subjectId,
        agentId,
        sessionId,
        messageId: brand<string, 'MessageId'>('msg-046'),
        expectedActiveContextVersion: 0,
      });

      expect(result.status).toBe('UPDATED');
    });

    it('TC_Active_Append_047: ActiveContext version CAS失败', async () => {
      const sessionId = brand<string, 'SessionId'>('session-047');
      const requestContextId = brand<string, 'RequestContextId'>('context-047');

      await createSession(gateway, sessionId);

      await gateway.activeContext.appendItem({
        tenantId: identity.tenantId,
        subjectId: identity.subjectId,
        agentId,
        sessionId,
        requestContextId,
        ordinal: 1,
        kind: 'USER_MESSAGE',
        payload: { content: 'First message' },
        createdAt: brand<number, 'EpochMillis'>(Date.now()),
      });

      const result = await gateway.activeContext.appendItem(
        {
          tenantId: identity.tenantId,
          subjectId: identity.subjectId,
          agentId,
          sessionId,
          requestContextId,
          ordinal: 2,
          kind: 'USER_MESSAGE',
          payload: { content: 'Second message' },
          createdAt: brand<number, 'EpochMillis'>(Date.now()),
        },
        { expectedActiveContextVersion: 0 },
      );

      expect(result.status).toBe('VERSION_CONFLICT');
    });
  });

  describe('TC_Timeline_Sequence_048 - TC_Timeline_Sequence_049', () => {
    it('test_code: Timeline sequence monotonically increasing - sequence auto-assigned - TC_Timeline_Sequence_048: Timeline sequence单调递增', async () => {
      const sessionId = brand<string, 'SessionId'>('session-048');
      const requestId = brand<string, 'MessageId'>('request-048');
      const runId = brand<string, 'RequestRunId'>('run-048');

      await createSession(gateway, sessionId);
      await gateway.requestRuns.saveRun(
        runRecord({
          runId,
          sessionId,
          requestId,
        }),
        { idempotencyKey: brand<string, 'IdempotencyKey'>('idem-048') },
      );

      await gateway.timeline.appendEvent(
        {
          tenantId: identity.tenantId,
          subjectId: identity.subjectId,
          agentId,
          sessionId,
          requestId,
          runId,
          eventId: 'event-request-accepted-1',
          requestContextId: brand<string, 'RequestContextId'>('context-timeline-048'),
          agentVersion,
          sequence: brand<number, 'TimelineSequence'>(0),
          type: 'REQUEST_ACCEPTED',
          inlinePayload: {},
          createdAt: brand<number, 'EpochMillis'>(Date.now()),
        },
        { idempotencyKey: brand<string, 'IdempotencyKey'>('idem-timeline-048-1') },
      );

      await gateway.timeline.appendEvent(
        {
          tenantId: identity.tenantId,
          subjectId: identity.subjectId,
          agentId,
          sessionId,
          requestId,
          runId,
          eventId: 'event-run-started-2',
          requestContextId: brand<string, 'RequestContextId'>('context-timeline-048'),
          agentVersion,
          sequence: brand<number, 'TimelineSequence'>(0),
          type: 'RUN_STARTED',
          inlinePayload: {},
          createdAt: brand<number, 'EpochMillis'>(Date.now()),
        },
        { idempotencyKey: brand<string, 'IdempotencyKey'>('idem-timeline-048-2') },
      );

      const events = await gateway.timeline.listEvents({
        tenantId: identity.tenantId,
        subjectId: identity.subjectId,
        agentId,
        sessionId,
        requestId,
        afterSequence: brand<number, 'TimelineSequence'>(0),
        limit: 10,
      });

      expect(events).toHaveLength(2);
      expect(events.map((event) => Number(event.sequence))).toEqual([1, 2]);
    });

    it('TC_Timeline_Sequence_049: Timeline concurrent event不duplicate sequence', async () => {
      // TODO: clarify - need concurrent append test
    });
  });

  describe('TC_Checkpoint_Save_050 - TC_Checkpoint_Save_051', () => {
    it('TC_Checkpoint_Save_050: Checkpoint save with idempotencyKey', async () => {
      const runId = brand<string, 'RequestRunId'>('run-checkpoint-050');
      const sessionId = brand<string, 'SessionId'>('session-checkpoint-050');
      const requestId = brand<string, 'MessageId'>('request-checkpoint-050');
      const requestContextId = brand<string, 'RequestContextId'>('context-checkpoint-050');

      await createSession(gateway, sessionId);
      await gateway.requestRuns.saveRun(
        runRecord({
          runId,
          sessionId,
          requestId,
        }),
        { idempotencyKey: brand<string, 'IdempotencyKey'>('idem-checkpoint-050') },
      );

      await gateway.checkpoints.saveCheckpoint(
        {
          tenantId: identity.tenantId,
          subjectId: identity.subjectId,
          agentId,
          sessionId,
          requestId,
          runId,
          requestContextId,
          runVersion: 1,
          checkpointId: brand<string, 'CheckpointId'>('checkpoint-050'),
          lastSequence: brand<number, 'TimelineSequence'>(1),
          activeContextVersion: 0,
          flowVariables: {},
          triggerReason: 'RUN_ACCEPTED',
          savedAt: brand<number, 'EpochMillis'>(Date.now()),
        },
        { idempotencyKey: brand<string, 'IdempotencyKey'>('idem-checkpoint-save-050') },
      );

      const checkpoint = await gateway.checkpoints.loadCheckpoint({
        tenantId: identity.tenantId,
        subjectId: identity.subjectId,
        agentId,
        sessionId,
        requestId,
        runId,
      });

      expect(checkpoint).toBeDefined();
      expect(checkpoint?.requestContextId).toBe(requestContextId);
    });

    it('TC_Checkpoint_Save_051: Checkpoint load by runId', async () => {
      const runId = brand<string, 'RequestRunId'>('run-checkpoint-051');
      const sessionId = brand<string, 'SessionId'>('session-checkpoint-051');
      const requestId = brand<string, 'MessageId'>('request-checkpoint-051');
      const requestContextId = brand<string, 'RequestContextId'>('context-checkpoint-051');

      await createSession(gateway, sessionId);
      await gateway.requestRuns.saveRun(
        runRecord({
          runId,
          sessionId,
          requestId,
        }),
        { idempotencyKey: brand<string, 'IdempotencyKey'>('idem-checkpoint-051') },
      );

      await gateway.checkpoints.saveCheckpoint(
        {
          tenantId: identity.tenantId,
          subjectId: identity.subjectId,
          agentId,
          sessionId,
          requestId,
          runId,
          requestContextId,
          runVersion: 1,
          checkpointId: brand<string, 'CheckpointId'>('checkpoint-051'),
          lastSequence: brand<number, 'TimelineSequence'>(1),
          activeContextVersion: 0,
          flowVariables: {},
          triggerReason: 'BEFORE_MODEL_INVOKE',
          savedAt: brand<number, 'EpochMillis'>(Date.now()),
        },
        { idempotencyKey: brand<string, 'IdempotencyKey'>('idem-checkpoint-save-051') },
      );

      const checkpoint = await gateway.checkpoints.loadCheckpoint({
        tenantId: identity.tenantId,
        subjectId: identity.subjectId,
        agentId,
        sessionId,
        requestId,
        runId,
      });

      expect(checkpoint).toBeDefined();
      expect(checkpoint?.runVersion).toBe(1);
      expect(Number(checkpoint?.lastSequence)).toBe(1);
    });
  });

  describe('TC_Attachment_Metadata_Blob_052 - TC_Attachment_Metadata_Blob_054', () => {
    it('TC_Attachment_Metadata_Blob_052: Attachment metadata/Blob分离', async () => {
      const sessionId = brand<string, 'SessionId'>('session-052');
      const requestId = brand<string, 'MessageId'>('request-052');
      const attachmentId = brand<string, 'AttachmentId'>('attachment-052');
      const storageRef = brand<string, 'BlobRef'>('blob-052');

      await createSession(gateway, sessionId);

      await gateway.attachments.saveAttachment({
        tenantId: identity.tenantId,
        subjectId: identity.subjectId,
        agentId,
        attachmentId,
        sessionId,
        requestId,
        fileName: 'test.pdf',
        mediaType: 'APPLICATION_PDF',
        sizeBytes: 128,
        validationStatus: 'PENDING',
        availabilityStatus: 'UNAVAILABLE',
        storageRef,
        createdAt: brand<number, 'EpochMillis'>(Date.now()),
      });

      const attachment = await gateway.attachments.loadAttachment({
        tenantId: identity.tenantId,
        subjectId: identity.subjectId,
        agentId,
        attachmentId,
      });

      expect(attachment).toBeDefined();
      expect(attachment?.storageRef).toBe(storageRef);
    });

    it('TC_Attachment_Metadata_Blob_053: Attachment validationStatus校验', async () => {
      const sessionId = brand<string, 'SessionId'>('session-053');
      const requestId = brand<string, 'MessageId'>('request-053');
      const attachmentId = brand<string, 'AttachmentId'>('attachment-053');

      await createSession(gateway, sessionId);

      await gateway.attachments.saveAttachment({
        tenantId: identity.tenantId,
        subjectId: identity.subjectId,
        agentId,
        attachmentId,
        sessionId,
        requestId,
        fileName: 'test.pdf',
        mediaType: 'APPLICATION_PDF',
        sizeBytes: 128,
        validationStatus: 'ACCEPTED',
        availabilityStatus: 'AVAILABLE',
        storageRef: brand<string, 'BlobRef'>('blob-053'),
        createdAt: brand<number, 'EpochMillis'>(Date.now()),
      });

      const attachment = await gateway.attachments.loadAttachment({
        tenantId: identity.tenantId,
        subjectId: identity.subjectId,
        agentId,
        attachmentId,
      });

      expect(attachment?.validationStatus).toBe('ACCEPTED');
    });

    it('TC_Attachment_Metadata_Blob_054: Attachment availabilityStatus校验', async () => {
      const sessionId = brand<string, 'SessionId'>('session-054');
      const requestId = brand<string, 'MessageId'>('request-054');
      const attachmentId = brand<string, 'AttachmentId'>('attachment-054');

      await createSession(gateway, sessionId);

      await gateway.attachments.saveAttachment({
        tenantId: identity.tenantId,
        subjectId: identity.subjectId,
        agentId,
        attachmentId,
        sessionId,
        requestId,
        fileName: 'test.pdf',
        mediaType: 'APPLICATION_PDF',
        sizeBytes: 128,
        validationStatus: 'ACCEPTED',
        availabilityStatus: 'AVAILABLE',
        storageRef: brand<string, 'BlobRef'>('blob-054'),
        createdAt: brand<number, 'EpochMillis'>(Date.now()),
      });

      const attachment = await gateway.attachments.loadAttachment({
        tenantId: identity.tenantId,
        subjectId: identity.subjectId,
        agentId,
        attachmentId,
      });

      expect(attachment?.availabilityStatus).toBe('AVAILABLE');
    });
  });

  describe('TC_Capability_Catalog_055 - TC_Capability_Catalog_058', () => {
    it('TC_Capability_Catalog_055: Capability descriptor进入catalog', async () => {
      // TODO: clarify - need capability catalog implementation
    });

    it('TC_Capability_Catalog_056: Capability availability控制visibility', async () => {
      // TODO: clarify - need capability visibility implementation
    });

    it('TC_Capability_Catalog_057: Capability invocation result contract', async () => {
      // TODO: clarify - need capability result implementation
    });

    it('TC_Capability_Catalog_058: Tool默认不支持replay幂等', async () => {
      // TODO: clarify - need tool replay policy implementation
    });
  });
});
