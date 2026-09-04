import { createDefaultAgentTestAssemblyRegistry, createNextAgentTestApp } from '@nextagent/agent-platform-gateway-local/testing';
import { createAttachmentCleanupRuntime } from '@nextagent/agent-attachment-runtime';
import { createRetrySourceAttachmentValidator } from '@nextagent/agent-attachment-runtime';
import { createStaticCapabilityCatalog } from '@nextagent/agent-capability';
import { brand } from '@nextagent/agent-common';
import { createDefaultContextEngine } from '@nextagent/agent-context-engine';
import type { RequestAttachmentRecord, RequestRunRecord, SessionMessageRecord } from '@nextagent/agent-contracts/gateway';
import type { AgentRunStatePort, RequestContext, RequestRun, RunTimelineEvent } from '@nextagent/agent-contracts/runtime';
import { createRequestLifecycleCoordinator, type RequestLifecycleDependencies } from '@nextagent/agent-runtime';
import { createUserSessionService } from '@nextagent/agent-session';
import { createTestGatewayStores } from '../fixtures/local-gateway.js';
import { createTestAgentConstructor } from '../fixtures/test-agent.js';
import { describe, expect, it } from 'vitest';
import { createTestModelSelectionService } from '../../packages/agent-context-engine/tests/test-model-selection-helpers.js';

const identity = {
  tenantId: brand<string, 'TenantId'>('tenant-retry-command'),
  subjectId: brand<string, 'SubjectId'>('subject-retry-command'),
  displayName: 'Retry command tester',
};
const agentId = brand<string, 'AgentId'>('default-agent');
const agentVersion = brand<string, 'AgentVersion'>('v1');

function runRecord(overrides: Partial<RequestRunRecord> & Pick<RequestRunRecord, 'runId' | 'sessionId' | 'requestId'>): RequestRunRecord {
  const now = brand<number, 'EpochMillis'>(overrides.createdAt === undefined ? 1 : Number(overrides.createdAt));
  return {
    tenantId: identity.tenantId,
    subjectId: identity.subjectId,
    agentId,
    agentVersion,
    agentAssemblyRef: 'default-agent:v1',
    attempt: 1,
    status: 'COMPLETED',
    version: 3,
    terminalCommitState: 'COMMITTED',
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
    createdAt: brand<number, 'EpochMillis'>(1),
    ...overrides,
  };
}

function attachmentRecord(
  overrides: Partial<RequestAttachmentRecord> & Pick<RequestAttachmentRecord, 'attachmentId' | 'sessionId' | 'requestId'>,
): RequestAttachmentRecord {
  return {
    tenantId: identity.tenantId,
    subjectId: identity.subjectId,
    agentId,
    fileName: 'source.pdf',
    mediaType: 'PDF',
    sizeBytes: 1,
    validationStatus: 'ACCEPTED',
    availabilityStatus: 'AVAILABLE',
    storageRef: brand<string, 'BlobRef'>(`blob-${overrides.attachmentId}`),
    createdAt: brand<number, 'EpochMillis'>(1),
    ...overrides,
  };
}

async function waitFor(assertion: () => boolean | Promise<boolean>, timeoutMs = 1_000): Promise<void> {
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
    createdAt: brand<number, 'EpochMillis'>(1),
    updatedAt: brand<number, 'EpochMillis'>(1),
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
  execute: LegacyExecute,
  overrides: Partial<RequestLifecycleDependencies<object>> = {},
) {
  return createRequestLifecycleCoordinator({
    agentConstructors: [
      createTestAgentConstructor(async ({ runState }, run, context, signal) => {
        await execute(run, context, toLegacyTimeline(runState, run, context), runState, signal);
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
    timelineStore: gateway.timeline,
    checkpointStore: gateway.checkpoints,
    retryAttachmentValidator: createRetrySourceAttachmentValidator(gateway.attachments),
    ...overrides,
  });
}

type LegacyExecute = (
  run: RequestRun,
  context: RequestContext,
  timeline: { emit: (event: RunTimelineEvent) => Promise<void> },
  messages: Pick<AgentRunStatePort, 'appendMessage'>,
  signal: AbortSignal,
) => Promise<void>;

function toLegacyTimeline(runState: AgentRunStatePort, run: RequestRun, context: RequestContext) {
  return {
    emit(event: RunTimelineEvent): Promise<void> {
      return runState.emitEvent(run, context, event);
    },
  };
}

describe('request retry', () => {
  it('rejects invalid, missing, stale, active and terminal-pending retry targets safely', async () => {
    const gateway = createTestGatewayStores();
    const sessionId = brand<string, 'SessionId'>('session-retry-negative');
    await createSession(gateway, sessionId);
    const runtime = createRuntime(gateway, async () => {});

    await expect(
      runtime.retryLatest({
        sessionId,
        identityContext: identity,
        expectedLatestRequestId: brand<string, 'MessageId'>('request-missing-key'),
        action: 'RETRY_LATEST',
      } as unknown as Parameters<typeof runtime.retryLatest>[0]),
    ).rejects.toMatchObject({ code: 'REQUEST_RETRY_IDEMPOTENCY_REQUIRED' });
    await expect(
      runtime.retryLatest({
        sessionId,
        identityContext: identity,
        expectedLatestRequestId: brand<string, 'MessageId'>('request-not-found'),
        action: 'RETRY_LATEST',
        idempotencyKey: brand<string, 'IdempotencyKey'>(' '),
      }),
    ).rejects.toMatchObject({ code: 'REQUEST_RETRY_IDEMPOTENCY_REQUIRED' });
    await expect(
      runtime.retryLatest({
        sessionId,
        identityContext: identity,
        expectedLatestRequestId: brand<string, 'MessageId'>('request-not-found'),
        action: 'RETRY_LATEST',
        idempotencyKey: brand<string, 'IdempotencyKey'>('idem-retry-not-found'),
      }),
    ).rejects.toMatchObject({ code: 'REQUEST_RETRY_NOT_FOUND' });

    const older = runRecord({
      runId: brand<string, 'RequestRunId'>('run-retry-older'),
      sessionId,
      requestId: brand<string, 'MessageId'>('request-retry-older'),
      createdAt: brand<number, 'EpochMillis'>(1),
    });
    const newer = runRecord({
      runId: brand<string, 'RequestRunId'>('run-retry-newer-active'),
      sessionId,
      requestId: brand<string, 'MessageId'>('request-retry-newer-active'),
      status: 'QUEUED',
      terminalCommitState: 'NOT_STARTED',
      createdAt: brand<number, 'EpochMillis'>(2),
    });
    await gateway.requestRuns.saveRun(older, {});
    await gateway.requestRuns.saveRun(newer, {});
    await expect(
      runtime.retryLatest({
        sessionId,
        identityContext: identity,
        expectedLatestRequestId: older.requestId,
        action: 'RETRY_LATEST',
        idempotencyKey: brand<string, 'IdempotencyKey'>('idem-retry-stale'),
      }),
    ).rejects.toMatchObject({ code: 'REQUEST_RETRY_NOT_LATEST' });
    await expect(
      runtime.retryLatest({
        sessionId,
        identityContext: identity,
        expectedLatestRequestId: newer.requestId,
        action: 'RETRY_LATEST',
        idempotencyKey: brand<string, 'IdempotencyKey'>('idem-retry-active'),
      }),
    ).rejects.toMatchObject({ code: 'REQUEST_RETRY_NOT_TERMINAL' });
    await expect(
      runtime.retryLatest({
        sessionId,
        identityContext: {
          tenantId: brand<string, 'TenantId'>('tenant-other'),
          subjectId: identity.subjectId,
          displayName: 'Other tenant',
        },
        expectedLatestRequestId: newer.requestId,
        action: 'RETRY_LATEST',
        idempotencyKey: brand<string, 'IdempotencyKey'>('idem-retry-owner-mismatch'),
      }),
    ).rejects.toMatchObject({ code: 'SESSION_NOT_FOUND' });

    await gateway.requestRuns.saveRun(
      runRecord({
        runId: brand<string, 'RequestRunId'>('run-retry-terminal-pending'),
        sessionId,
        requestId: brand<string, 'MessageId'>('request-retry-terminal-pending'),
        status: 'FAILED',
        terminalCommitState: 'PENDING',
        createdAt: brand<number, 'EpochMillis'>(3),
      }),
      {},
    );
    await expect(
      runtime.retryLatest({
        sessionId,
        identityContext: identity,
        expectedLatestRequestId: brand<string, 'MessageId'>('request-retry-terminal-pending'),
        action: 'RETRY_LATEST',
        idempotencyKey: brand<string, 'IdempotencyKey'>('idem-retry-terminal-pending'),
      }),
    ).rejects.toMatchObject({ code: 'REQUEST_RETRY_TERMINAL_PENDING' });
  });

  it('creates a durable same-request retry attempt and hides the replaced non-user result', async () => {
    const gateway = createTestGatewayStores();
    const sessionId = brand<string, 'SessionId'>('session-retry-lineage');
    const requestId = brand<string, 'MessageId'>('request-retry-lineage');
    const sourceRunId = brand<string, 'RequestRunId'>('run-retry-source');
    const releases = new Map<string, () => void>();
    await createSession(gateway, sessionId);
    await gateway.requestRuns.saveRun(runRecord({ runId: sourceRunId, sessionId, requestId }), {});
    await gateway.messages.appendSessionMessage(
      messageRecord({
        messageId: requestId,
        sessionId,
        requestId,
        runId: sourceRunId,
        role: 'USER',
        content: 'original input',
      }),
      { idempotencyKey: brand<string, 'IdempotencyKey'>('idem-retry-user-message') },
    );
    await gateway.messages.appendSessionMessage(
      messageRecord({
        messageId: brand<string, 'MessageId'>('assistant-retry-source'),
        sessionId,
        requestId,
        runId: sourceRunId,
        role: 'ASSISTANT',
        content: 'old answer',
        createdAt: brand<number, 'EpochMillis'>(2),
      }),
      { idempotencyKey: brand<string, 'IdempotencyKey'>('idem-retry-assistant-message') },
    );
    const runtime = createRuntime(gateway, async (run, _context, timeline) => {
      await new Promise<void>((resolve) => releases.set(run.runId, resolve));
      await timeline.emit({ type: 'LLM_CONTENT_DELTA', inlinePayload: { content: `retry ${run.attempt}` } });
    });

    const accepted = await runtime.retryLatest({
      sessionId,
      identityContext: identity,
      expectedLatestRequestId: requestId,
      action: 'RETRY_LATEST',
      idempotencyKey: brand<string, 'IdempotencyKey'>('idem-retry-lineage'),
    });
    const retryRun = await loadRun(gateway, accepted.runId);
    const visibleSourceMessages = await gateway.messages.listCurrentRequestMessages({
      tenantId: identity.tenantId,
      subjectId: identity.subjectId,
      agentId,
      sessionId,
      requestId,
      runId: sourceRunId,
      includeHidden: false,
      offset: 0,
      limit: 10,
    });
    const hiddenSourceMessages = await gateway.messages.listCurrentRequestMessages({
      tenantId: identity.tenantId,
      subjectId: identity.subjectId,
      agentId,
      sessionId,
      requestId,
      runId: sourceRunId,
      includeHidden: true,
      offset: 0,
      limit: 10,
    });
    const replay = await runtime.retryLatest({
      sessionId,
      identityContext: identity,
      expectedLatestRequestId: requestId,
      action: 'RETRY_LATEST',
      idempotencyKey: brand<string, 'IdempotencyKey'>('idem-retry-lineage'),
    });
    await expect(
      runtime.retryLatest({
        sessionId,
        identityContext: identity,
        expectedLatestRequestId: brand<string, 'MessageId'>('request-other'),
        action: 'RETRY_LATEST',
        idempotencyKey: brand<string, 'IdempotencyKey'>('idem-retry-lineage'),
      }),
    ).rejects.toMatchObject({ code: 'REQUEST_RETRY_IDEMPOTENCY_CONFLICT' });
    await expect(
      runtime.retryLatest({
        sessionId,
        identityContext: identity,
        expectedLatestRequestId: requestId,
        action: 'RETRY_LATEST',
        idempotencyKey: brand<string, 'IdempotencyKey'>('idem-retry-active-second'),
      }),
    ).rejects.toMatchObject({ code: 'REQUEST_RETRY_NOT_TERMINAL' });

    expect(accepted.requestId).toBe(requestId);
    expect(retryRun?.runId).not.toBe(sourceRunId);
    expect(retryRun?.attempt).toBe(2);
    expect(retryRun?.retryOfRunId).toBe(sourceRunId);
    expect(retryRun?.agentVersion).toBe(agentVersion);
    expect(retryRun?.status === 'QUEUED' || retryRun?.status === 'EXECUTING').toBe(true);
    expect(replay).toEqual(accepted);
    expect(visibleSourceMessages.items.map((message) => message.role)).toEqual(['USER']);
    expect(hiddenSourceMessages.items.map((message) => [message.role, message.visible])).toEqual([
      ['USER', true],
      ['ASSISTANT', false],
    ]);

    releases.get(accepted.runId)?.();
    await waitFor(async () => {
      const run = await loadRun(gateway, accepted.runId);
      return run?.status === 'COMPLETED' && run.terminalCommitState === 'COMMITTED';
    });
    const next = await runtime.retryLatest({
      sessionId,
      identityContext: identity,
      expectedLatestRequestId: requestId,
      action: 'RETRY_LATEST',
      idempotencyKey: brand<string, 'IdempotencyKey'>('idem-retry-lineage-3'),
    });
    const thirdRun = await loadRun(gateway, next.runId);
    expect(thirdRun?.attempt).toBe(3);
    expect(thirdRun?.retryOfRunId).toBe(accepted.runId);
    await waitFor(() => releases.has(next.runId));
    releases.get(next.runId)?.();
    await waitFor(async () => {
      const run = await loadRun(gateway, next.runId);
      return run?.status === 'COMPLETED' && run.terminalCommitState === 'COMMITTED';
    });
  });

  it('fails retry latest when the persisted root attachment is unavailable at admission time', async () => {
    const gateway = createTestGatewayStores();
    const sessionId = brand<string, 'SessionId'>('session-retry-attachment-reread');
    const requestId = brand<string, 'MessageId'>('request-retry-attachment-reread');
    const sourceRunId = brand<string, 'RequestRunId'>('run-retry-attachment-reread');
    const attachmentId = brand<string, 'AttachmentId'>('attachment-retry-reread');
    await createSession(gateway, sessionId);
    await gateway.requestRuns.saveRun(runRecord({ runId: sourceRunId, sessionId, requestId }), {});
    await gateway.messages.appendSessionMessage(
      messageRecord({
        messageId: requestId,
        sessionId,
        requestId,
        runId: sourceRunId,
        role: 'USER',
        content: 'root attachment request',
        metadata: { attachmentIds: [attachmentId] },
      }),
      { idempotencyKey: brand<string, 'IdempotencyKey'>('idem-retry-attachment-reread-user') },
    );
    await gateway.attachments.saveAttachment(
      attachmentRecord({
        attachmentId,
        sessionId,
        requestId,
        runId: sourceRunId,
        availabilityStatus: 'UNAVAILABLE',
      }),
    );
    const runtime = createRuntime(gateway, async () => {});

    await expect(
      runtime.retryLatest({
        sessionId,
        identityContext: identity,
        expectedLatestRequestId: requestId,
        action: 'RETRY_LATEST',
        idempotencyKey: brand<string, 'IdempotencyKey'>('idem-retry-attachment-reread'),
      }),
    ).rejects.toMatchObject({
      code: 'REQUEST_RETRY_ATTACHMENT_UNAVAILABLE',
    });
  });

  it('replays accepted retry outcome from durable facts after runtime restart', async () => {
    const gateway = createTestGatewayStores();
    const sessionId = brand<string, 'SessionId'>('session-retry-idem-restart');
    const requestId = brand<string, 'MessageId'>('request-retry-idem-restart');
    const sourceRunId = brand<string, 'RequestRunId'>('run-retry-idem-restart-source');
    await createSession(gateway, sessionId);
    await gateway.requestRuns.saveRun(runRecord({ runId: sourceRunId, sessionId, requestId }), {});
    await gateway.messages.appendSessionMessage(
      messageRecord({
        messageId: requestId,
        sessionId,
        requestId,
        runId: sourceRunId,
        role: 'USER',
        content: 'original input',
      }),
      { idempotencyKey: brand<string, 'IdempotencyKey'>('idem-retry-restart-user') },
    );
    await gateway.messages.appendSessionMessage(
      messageRecord({
        messageId: brand<string, 'MessageId'>('assistant-retry-restart-source'),
        sessionId,
        requestId,
        runId: sourceRunId,
        role: 'ASSISTANT',
        content: 'old answer',
        createdAt: brand<number, 'EpochMillis'>(2),
      }),
      { idempotencyKey: brand<string, 'IdempotencyKey'>('idem-retry-restart-assistant') },
    );
    const firstRuntime = createRuntime(gateway, async () => {});

    const accepted = await firstRuntime.retryLatest({
      sessionId,
      identityContext: identity,
      expectedLatestRequestId: requestId,
      action: 'RETRY_LATEST',
      idempotencyKey: brand<string, 'IdempotencyKey'>('idem-retry-restart'),
    });
    const restartedRuntime = createRuntime(gateway, async () => {});
    const replay = await restartedRuntime.retryLatest({
      sessionId,
      identityContext: identity,
      expectedLatestRequestId: requestId,
      action: 'RETRY_LATEST',
      idempotencyKey: brand<string, 'IdempotencyKey'>('idem-retry-restart'),
    });
    await expect(
      restartedRuntime.retryLatest({
        sessionId,
        identityContext: identity,
        expectedLatestRequestId: brand<string, 'MessageId'>('request-retry-restart-other'),
        action: 'RETRY_LATEST',
        idempotencyKey: brand<string, 'IdempotencyKey'>('idem-retry-restart'),
      }),
    ).rejects.toMatchObject({ code: 'REQUEST_RETRY_IDEMPOTENCY_CONFLICT' });

    expect(replay).toEqual(accepted);
  });

  it('revalidates source attachments before creating retry work', async () => {
    const gateway = createTestGatewayStores();
    const sessionId = brand<string, 'SessionId'>('session-retry-attachments');
    const requestId = brand<string, 'MessageId'>('request-retry-attachments');
    const sourceRunId = brand<string, 'RequestRunId'>('run-retry-attachments-source');
    const attachmentId = brand<string, 'AttachmentId'>('attachment-retry-source');
    await createSession(gateway, sessionId);
    await gateway.requestRuns.saveRun(runRecord({ runId: sourceRunId, sessionId, requestId }), {});
    await gateway.messages.appendSessionMessage(
      messageRecord({
        messageId: requestId,
        sessionId,
        requestId,
        runId: sourceRunId,
        role: 'USER',
        content: 'original input with attachment',
        metadata: { attachmentIds: [attachmentId] },
      }),
      { idempotencyKey: brand<string, 'IdempotencyKey'>('idem-retry-attachment-user') },
    );
    await gateway.messages.appendSessionMessage(
      messageRecord({
        messageId: brand<string, 'MessageId'>('assistant-retry-attachment-source'),
        sessionId,
        requestId,
        runId: sourceRunId,
        role: 'ASSISTANT',
        content: 'old answer',
        createdAt: brand<number, 'EpochMillis'>(2),
      }),
      { idempotencyKey: brand<string, 'IdempotencyKey'>('idem-retry-attachment-assistant') },
    );
    await gateway.attachments.saveAttachment(attachmentRecord({ attachmentId, sessionId, requestId, runId: sourceRunId }));
    const runtime = createRuntime(gateway, async () => {});

    const accepted = await runtime.retryLatest({
      sessionId,
      identityContext: identity,
      expectedLatestRequestId: requestId,
      action: 'RETRY_LATEST',
      idempotencyKey: brand<string, 'IdempotencyKey'>('idem-retry-attachment-ok'),
    });
    const acceptedRun = await loadRun(gateway, accepted.runId);
    expect(acceptedRun?.retryOfRunId).toBe(sourceRunId);

    const failedSessionId = brand<string, 'SessionId'>('session-retry-attachment-failed');
    const failedRequestId = brand<string, 'MessageId'>('request-retry-attachment-failed');
    const failedRunId = brand<string, 'RequestRunId'>('run-retry-attachment-failed');
    const failedAttachmentId = brand<string, 'AttachmentId'>('attachment-retry-missing');
    await createSession(gateway, failedSessionId);
    await gateway.requestRuns.saveRun(
      runRecord({ runId: failedRunId, sessionId: failedSessionId, requestId: failedRequestId, createdAt: brand<number, 'EpochMillis'>(20) }),
      {},
    );
    await gateway.messages.appendSessionMessage(
      messageRecord({
        messageId: failedRequestId,
        sessionId: failedSessionId,
        requestId: failedRequestId,
        runId: failedRunId,
        role: 'USER',
        content: 'attachment unavailable',
        metadata: { attachmentIds: [failedAttachmentId] },
        createdAt: brand<number, 'EpochMillis'>(20),
      }),
      { idempotencyKey: brand<string, 'IdempotencyKey'>('idem-retry-attachment-failed-user') },
    );
    await gateway.messages.appendSessionMessage(
      messageRecord({
        messageId: brand<string, 'MessageId'>('assistant-retry-attachment-failed'),
        sessionId: failedSessionId,
        requestId: failedRequestId,
        runId: failedRunId,
        role: 'ASSISTANT',
        content: 'old answer remains visible',
        createdAt: brand<number, 'EpochMillis'>(21),
      }),
      { idempotencyKey: brand<string, 'IdempotencyKey'>('idem-retry-attachment-failed-assistant') },
    );

    await expect(
      runtime.retryLatest({
        sessionId: failedSessionId,
        identityContext: identity,
        expectedLatestRequestId: failedRequestId,
        action: 'RETRY_LATEST',
        idempotencyKey: brand<string, 'IdempotencyKey'>('idem-retry-attachment-failed'),
      }),
    ).rejects.toMatchObject({ code: 'REQUEST_RETRY_ATTACHMENT_UNAVAILABLE' });

    const unsafeSessionId = brand<string, 'SessionId'>('session-retry-attachment-unsafe');
    const unsafeRequestId = brand<string, 'MessageId'>('request-retry-attachment-unsafe');
    const unsafeRunId = brand<string, 'RequestRunId'>('run-retry-attachment-unsafe');
    const unsafeAttachmentId = brand<string, 'AttachmentId'>('attachment-retry-unsafe');
    await createSession(gateway, unsafeSessionId);
    await gateway.requestRuns.saveRun(
      runRecord({ runId: unsafeRunId, sessionId: unsafeSessionId, requestId: unsafeRequestId, createdAt: brand<number, 'EpochMillis'>(30) }),
      {},
    );
    await gateway.messages.appendSessionMessage(
      messageRecord({
        messageId: unsafeRequestId,
        sessionId: unsafeSessionId,
        requestId: unsafeRequestId,
        runId: unsafeRunId,
        role: 'USER',
        content: 'attachment unavailable',
        metadata: { attachmentIds: [unsafeAttachmentId] },
        createdAt: brand<number, 'EpochMillis'>(30),
      }),
      { idempotencyKey: brand<string, 'IdempotencyKey'>('idem-retry-attachment-unsafe-user') },
    );
    await gateway.attachments.saveAttachment(
      attachmentRecord({
        attachmentId: unsafeAttachmentId,
        sessionId: unsafeSessionId,
        requestId: unsafeRequestId,
        runId: unsafeRunId,
        availabilityStatus: 'UNAVAILABLE',
      }),
    );
    await expect(
      runtime.retryLatest({
        sessionId: unsafeSessionId,
        identityContext: identity,
        expectedLatestRequestId: unsafeRequestId,
        action: 'RETRY_LATEST',
        idempotencyKey: brand<string, 'IdempotencyKey'>('idem-retry-attachment-unsafe'),
      }),
    ).rejects.toMatchObject({ code: 'REQUEST_RETRY_ATTACHMENT_UNAVAILABLE' });

    const failedSnapshot = await gateway.requestRuns.loadSessionLaneSnapshot({
      tenantId: identity.tenantId,
      subjectId: identity.subjectId,
      agentId,
      sessionId: failedSessionId,
    });
    const failedVisibleMessages = await gateway.messages.listCurrentRequestMessages({
      tenantId: identity.tenantId,
      subjectId: identity.subjectId,
      agentId,
      sessionId: failedSessionId,
      requestId: failedRequestId,
      runId: failedRunId,
      includeHidden: false,
      offset: 0,
      limit: 10,
    });
    expect(failedSnapshot.latestRun?.runId).toBe(failedRunId);
    expect(failedVisibleMessages.items.map((message) => message.role)).toEqual(['USER', 'ASSISTANT']);
  });

  it('reads cleanup-converged unavailable attachments from authoritative storage before retry', async () => {
    const gateway = createTestGatewayStores();
    const sessionId = brand<string, 'SessionId'>('session-retry-cleanup-converged');
    const requestId = brand<string, 'MessageId'>('request-retry-cleanup-converged');
    const sourceRunId = brand<string, 'RequestRunId'>('run-retry-cleanup-converged');
    const attachmentId = brand<string, 'AttachmentId'>('attachment-retry-cleanup');
    await createSession(gateway, sessionId);
    await gateway.requestRuns.saveRun(runRecord({ runId: sourceRunId, sessionId, requestId }), {});
    await gateway.messages.appendSessionMessage(
      messageRecord({
        messageId: requestId,
        sessionId,
        requestId,
        runId: sourceRunId,
        role: 'USER',
        content: 'original input with attachment',
        metadata: { attachmentIds: [attachmentId] },
      }),
      { idempotencyKey: brand<string, 'IdempotencyKey'>('idem-retry-cleanup-user') },
    );
    const cleanupRuntime = createAttachmentCleanupRuntime({
      attachmentStore: gateway.attachments,
      blobStore: gateway.blobs,
    });
    await gateway.attachments.saveAttachment(attachmentRecord({ attachmentId, sessionId, requestId, runId: sourceRunId }));
    await cleanupRuntime.cleanup({
      identityContext: identity,
      agentId,
      reasonCode: 'EXPLICIT_UNAVAILABLE',
      attachmentIds: [attachmentId],
    });
    const runtime = createRuntime(gateway, async () => {});

    await expect(
      runtime.retryLatest({
        sessionId,
        identityContext: identity,
        expectedLatestRequestId: requestId,
        action: 'RETRY_LATEST',
        idempotencyKey: brand<string, 'IdempotencyKey'>('idem-retry-cleanup'),
      }),
    ).rejects.toMatchObject({
      code: 'REQUEST_RETRY_ATTACHMENT_UNAVAILABLE',
    });
    await expect(
      gateway.attachments.loadAttachment({
        tenantId: identity.tenantId,
        subjectId: identity.subjectId,
        agentId,
        attachmentId,
      }),
    ).resolves.toMatchObject({
      availabilityStatus: 'UNAVAILABLE',
    });
  });

  it('terminalizes retry work on scheduler failure without hiding the previous attempt', async () => {
    const gateway = createTestGatewayStores();
    const sessionId = brand<string, 'SessionId'>('session-retry-queue-failure');
    const requestId = brand<string, 'MessageId'>('request-retry-queue-failure');
    const sourceRunId = brand<string, 'RequestRunId'>('run-retry-queue-failure-source');
    await createSession(gateway, sessionId);
    await gateway.requestRuns.saveRun(runRecord({ runId: sourceRunId, sessionId, requestId }), {});
    await gateway.messages.appendSessionMessage(
      messageRecord({
        messageId: requestId,
        sessionId,
        requestId,
        runId: sourceRunId,
        role: 'USER',
        content: 'original input',
      }),
      { idempotencyKey: brand<string, 'IdempotencyKey'>('idem-retry-queue-user') },
    );
    await gateway.messages.appendSessionMessage(
      messageRecord({
        messageId: brand<string, 'MessageId'>('assistant-retry-queue-source'),
        sessionId,
        requestId,
        runId: sourceRunId,
        role: 'ASSISTANT',
        content: 'old answer remains',
        createdAt: brand<number, 'EpochMillis'>(2),
      }),
      { idempotencyKey: brand<string, 'IdempotencyKey'>('idem-retry-queue-assistant') },
    );
    const runtime = createRuntime(gateway, async () => {});
    (runtime as unknown as { enqueueWork: (work: unknown) => void }).enqueueWork = () => {
      throw new Error('scheduler capacity detail');
    };

    const command = {
      sessionId,
      identityContext: identity,
      expectedLatestRequestId: requestId,
      action: 'RETRY_LATEST' as const,
      idempotencyKey: brand<string, 'IdempotencyKey'>('idem-retry-queue-failure'),
    };
    await expect(runtime.retryLatest(command)).rejects.toMatchObject({ code: 'REQUEST_RETRY_QUEUE_UNAVAILABLE' });
    await expect(runtime.retryLatest(command)).rejects.toMatchObject({ code: 'REQUEST_RETRY_QUEUE_UNAVAILABLE' });
    const snapshot = await gateway.requestRuns.loadSessionLaneSnapshot({
      tenantId: identity.tenantId,
      subjectId: identity.subjectId,
      agentId,
      sessionId,
    });
    const sourceMessages = await gateway.messages.listCurrentRequestMessages({
      tenantId: identity.tenantId,
      subjectId: identity.subjectId,
      agentId,
      sessionId,
      requestId,
      runId: sourceRunId,
      includeHidden: false,
      offset: 0,
      limit: 10,
    });
    const events = await gateway.timeline.listEvents({
      tenantId: identity.tenantId,
      subjectId: identity.subjectId,
      agentId,
      sessionId,
      afterSequence: brand<number, 'TimelineSequence'>(0),
      limit: 1000,
    });

    expect(snapshot.latestRun?.runId).not.toBe(sourceRunId);
    expect(snapshot.latestRun?.status).toBe('FAILED');
    expect(snapshot.latestRun?.terminalCommitState).toBe('COMMITTED');
    expect(events.filter((event) => event.runId === snapshot.latestRun?.runId).map((event) => event.type)).not.toContain('REQUEST_ACCEPTED');
    expect(sourceMessages.items.map((message) => message.role)).toEqual(['USER', 'ASSISTANT']);
  });

  it('keeps accepted retry work when visibility replacement is temporarily unavailable', async () => {
    const gateway = createTestGatewayStores();
    const sessionId = brand<string, 'SessionId'>('session-retry-visibility-unavailable');
    const requestId = brand<string, 'MessageId'>('request-retry-visibility-unavailable');
    const sourceRunId = brand<string, 'RequestRunId'>('run-retry-visibility-source');
    await createSession(gateway, sessionId);
    await gateway.requestRuns.saveRun(runRecord({ runId: sourceRunId, sessionId, requestId }), {});
    await gateway.messages.appendSessionMessage(
      messageRecord({
        messageId: requestId,
        sessionId,
        requestId,
        runId: sourceRunId,
        role: 'USER',
        content: 'original input',
      }),
      { idempotencyKey: brand<string, 'IdempotencyKey'>('idem-retry-visibility-user') },
    );
    await gateway.messages.appendSessionMessage(
      messageRecord({
        messageId: brand<string, 'MessageId'>('assistant-retry-visibility-source'),
        sessionId,
        requestId,
        runId: sourceRunId,
        role: 'ASSISTANT',
        content: 'old answer',
        createdAt: brand<number, 'EpochMillis'>(2),
      }),
      { idempotencyKey: brand<string, 'IdempotencyKey'>('idem-retry-visibility-assistant') },
    );
    const hideMessage = gateway.messages.hideMessage.bind(gateway.messages);
    (gateway.messages as unknown as { hideMessage: typeof gateway.messages.hideMessage }).hideMessage = async () => {
      throw new Error('adapter-private hidden-message detail');
    };
    const runtime = createRuntime(gateway, async () => {});
    const command = {
      sessionId,
      identityContext: identity,
      expectedLatestRequestId: requestId,
      action: 'RETRY_LATEST' as const,
      idempotencyKey: brand<string, 'IdempotencyKey'>('idem-retry-visibility-unavailable'),
    };

    const accepted = await runtime.retryLatest(command);
    const retryRun = await loadRun(gateway, accepted.runId);
    const sourceMessages = await gateway.messages.listCurrentRequestMessages({
      tenantId: identity.tenantId,
      subjectId: identity.subjectId,
      agentId,
      sessionId,
      requestId,
      runId: sourceRunId,
      includeHidden: false,
      offset: 0,
      limit: 10,
    });
    (gateway.messages as unknown as { hideMessage: typeof gateway.messages.hideMessage }).hideMessage = hideMessage;
    const replay = await runtime.retryLatest(command);
    const recoveredVisibleMessages = await gateway.messages.listCurrentRequestMessages({
      tenantId: identity.tenantId,
      subjectId: identity.subjectId,
      agentId,
      sessionId,
      requestId,
      runId: sourceRunId,
      includeHidden: false,
      offset: 0,
      limit: 10,
    });
    const events = await gateway.timeline.listEvents({
      tenantId: identity.tenantId,
      subjectId: identity.subjectId,
      agentId,
      sessionId,
      runId: accepted.runId,
      afterSequence: brand<number, 'TimelineSequence'>(0),
      limit: 1000,
    });

    expect(retryRun?.retryOfRunId).toBe(sourceRunId);
    expect(replay).toEqual(accepted);
    expect(sourceMessages.items.map((message) => message.role)).toEqual(['USER', 'ASSISTANT']);
    expect(recoveredVisibleMessages.items.map((message) => message.role)).toEqual(['USER']);
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'DEGRADATION_NOTICE', inlinePayload: { code: 'REQUEST_RETRY_VISIBILITY_UNAVAILABLE' } }),
      ]),
    );
    expect(JSON.stringify(events)).not.toContain('adapter-private');
  });

  it('preserves the latest retry answer after runtime leaves the replaced tool use without a marker', async () => {
    const gateway = createTestGatewayStores();
    const sessionId = brand<string, 'SessionId'>('session-retry-tool-context');
    const requestId = brand<string, 'MessageId'>('request-retry-tool-context');
    const sourceRunId = brand<string, 'RequestRunId'>('run-retry-tool-context-source');
    const sourceToolUseId = brand<string, 'MessageId'>('assistant-tool-retry-tool-context-source');
    const sourceResultId = brand<string, 'MessageId'>('capability-result-retry-tool-context-source');
    const sourceTerminalId = brand<string, 'MessageId'>('assistant-retry-tool-context-source');
    await createSession(gateway, sessionId);
    await gateway.requestRuns.saveRun(runRecord({ runId: sourceRunId, sessionId, requestId }), {});
    const sourceMessages = [
      messageRecord({
        messageId: requestId,
        sessionId,
        requestId,
        runId: sourceRunId,
        role: 'USER',
        content: 'root input',
      }),
      messageRecord({
        messageId: sourceToolUseId,
        sessionId,
        requestId,
        runId: sourceRunId,
        role: 'ASSISTANT',
        content: JSON.stringify({ toolCalls: [{ toolCallId: 'tc-source', toolName: 'Bash', arguments: {} }] }),
        metadata: { kind: 'ASSISTANT_TOOL_USE', toolCallIds: ['tc-source'] },
        visible: false,
        createdAt: brand<number, 'EpochMillis'>(2),
      }),
      messageRecord({
        messageId: sourceResultId,
        sessionId,
        requestId,
        runId: sourceRunId,
        role: 'CAPABILITY_RESULT',
        content: JSON.stringify({ toolCallId: 'tc-source', toolName: 'Bash', payload: { ok: true } }),
        metadata: { kind: 'CAPABILITY_RESULT', toolCallId: 'tc-source', toolName: 'Bash' },
        createdAt: brand<number, 'EpochMillis'>(3),
      }),
      messageRecord({
        messageId: sourceTerminalId,
        sessionId,
        requestId,
        runId: sourceRunId,
        role: 'ASSISTANT',
        content: 'old answer',
        createdAt: brand<number, 'EpochMillis'>(4),
      }),
    ];
    for (let index = 0; index < sourceMessages.length; index += 1) {
      const message = sourceMessages[index]!;
      await gateway.messages.appendSessionMessage(message, {
        idempotencyKey: brand<string, 'IdempotencyKey'>(`idem-retry-tool-context-message-${index}`),
      });
      await gateway.activeContext.appendItem({
        tenantId: identity.tenantId,
        subjectId: identity.subjectId,
        agentId,
        sessionId,
        messageId: message.messageId,
        expectedActiveContextVersion: index,
      });
    }
    const runtime = createRuntime(gateway, async (_run, _context, timeline) => {
      await timeline.emit({ type: 'LLM_CONTENT_DELTA', inlinePayload: { content: 'latest answer' } });
    });

    const accepted = await runtime.retryLatest({
      sessionId,
      identityContext: identity,
      expectedLatestRequestId: requestId,
      action: 'RETRY_LATEST',
      idempotencyKey: brand<string, 'IdempotencyKey'>('idem-retry-tool-context'),
    });
    await waitFor(async () => {
      const run = await loadRun(gateway, accepted.runId);
      return run?.status === 'COMPLETED' && run.terminalCommitState === 'COMMITTED';
    });

    const persistedSource = await gateway.messages.listCurrentRequestMessages({
      tenantId: identity.tenantId,
      subjectId: identity.subjectId,
      agentId,
      sessionId,
      requestId,
      runId: sourceRunId,
      includeHidden: true,
      offset: 0,
      limit: 10,
    });
    const persistedToolUse = persistedSource.items.find((message) => message.messageId === sourceToolUseId);
    const persistedResult = persistedSource.items.find((message) => message.messageId === sourceResultId);
    const persistedTerminal = persistedSource.items.find((message) => message.messageId === sourceTerminalId);
    expect(persistedToolUse).toMatchObject({ visible: false, metadata: { kind: 'ASSISTANT_TOOL_USE' } });
    expect(persistedToolUse?.metadata['visibility']).toBeUndefined();
    expect(persistedResult?.metadata['visibility']).toMatchObject({ reason: 'RETRY_REPLACED' });
    expect(persistedTerminal?.metadata['visibility']).toMatchObject({ reason: 'RETRY_REPLACED' });

    const retryMessages = await gateway.messages.listCurrentRequestMessages({
      tenantId: identity.tenantId,
      subjectId: identity.subjectId,
      agentId,
      sessionId,
      requestId,
      runId: accepted.runId,
      includeHidden: true,
      offset: 0,
      limit: 10,
    });
    const latestTerminal = retryMessages.items.find((message) => message.role === 'ASSISTANT' && message.metadata['kind'] !== 'ASSISTANT_TOOL_USE');
    expect(latestTerminal).toBeDefined();

    const followUpId = brand<string, 'MessageId'>('request-retry-tool-context-follow-up');
    const followUpRunId = brand<string, 'RequestRunId'>('run-retry-tool-context-follow-up');
    await gateway.messages.appendSessionMessage(
      messageRecord({
        messageId: followUpId,
        sessionId,
        requestId: followUpId,
        runId: followUpRunId,
        role: 'USER',
        content: 'repeat the previous answer',
        createdAt: brand<number, 'EpochMillis'>(10),
      }),
      { idempotencyKey: brand<string, 'IdempotencyKey'>('idem-retry-tool-context-follow-up') },
    );
    const activeContext = await gateway.activeContext.loadActiveContext({
      tenantId: identity.tenantId,
      subjectId: identity.subjectId,
      agentId,
      sessionId,
    });
    await gateway.activeContext.appendItem({
      tenantId: identity.tenantId,
      subjectId: identity.subjectId,
      agentId,
      sessionId,
      messageId: followUpId,
      expectedActiveContextVersion: activeContext.state.activeContextVersion,
    });
    const contextEngine = createDefaultContextEngine({
      activeContextStore: gateway.activeContext,
      messageStore: gateway.messages,
      assemblyRegistry: createDefaultAgentTestAssemblyRegistry('deterministic-test-model'),
      capabilityCatalog: {
        async listAvailable() {
          return [];
        },
        async resolve() {
          return undefined;
        },
      },
      modelSelectionService: createTestModelSelectionService({ modelId: 'deterministic' }),
    });

    const assembly = await contextEngine.assemble(
      {
        sessionId,
        requestId: followUpId,
        requestContextId: brand<string, 'RequestContextId'>('context-retry-tool-context-follow-up'),
        identityContext: identity,
        agentId,
        agentVersion,
        runId: followUpRunId,
        stepId: 'turn-1',
        locale: brand<string, 'RequestLocale'>('zh-CN'),
        purpose: 'retry-tool-context-follow-up',
      },
      undefined,
      new AbortController().signal,
    );

    expect(assembly.selectedMessageRefs).toEqual([requestId, latestTerminal!.messageId, followUpId]);
  });

  it('excludes replaced attempt output from retry context assembly candidates', async () => {
    const gateway = createTestGatewayStores();
    const sessionId = brand<string, 'SessionId'>('session-retry-context');
    const requestId = brand<string, 'MessageId'>('request-retry-context');
    const sourceRunId = brand<string, 'RequestRunId'>('run-retry-context-source');
    const retryRunId = brand<string, 'RequestRunId'>('run-retry-context-next');
    await createSession(gateway, sessionId);
    await gateway.messages.appendSessionMessage(
      messageRecord({
        messageId: requestId,
        sessionId,
        requestId,
        runId: sourceRunId,
        role: 'USER',
        content: 'root input',
      }),
      { idempotencyKey: brand<string, 'IdempotencyKey'>('idem-retry-context-user') },
    );
    const assistantMessageId = brand<string, 'MessageId'>('assistant-retry-context-source');
    await gateway.messages.appendSessionMessage(
      messageRecord({
        messageId: assistantMessageId,
        sessionId,
        requestId,
        runId: sourceRunId,
        role: 'ASSISTANT',
        content: 'old answer',
        createdAt: brand<number, 'EpochMillis'>(2),
      }),
      { idempotencyKey: brand<string, 'IdempotencyKey'>('idem-retry-context-assistant') },
    );
    await gateway.messages.hideMessage({
      tenantId: identity.tenantId,
      subjectId: identity.subjectId,
      agentId,
      messageId: assistantMessageId,
      reason: 'RETRY_REPLACED',
      hiddenByContextId: brand<string, 'RequestContextId'>('context-retry-context-hide'),
      idempotencyKey: brand<string, 'IdempotencyKey'>('idem-retry-context-hide'),
    });
    const contextEngine = createDefaultContextEngine({
      activeContextStore: gateway.activeContext,
      messageStore: gateway.messages,
      assemblyRegistry: createDefaultAgentTestAssemblyRegistry('deterministic-test-model'),
      capabilityCatalog: {
        async listAvailable() {
          return [];
        },
        async resolve() {
          return undefined;
        },
      },
      modelSelectionService: createTestModelSelectionService({ modelId: 'deterministic' }),
    });

    const assembly = await contextEngine.assemble(
      {
        sessionId,
        requestId,
        requestContextId: brand<string, 'RequestContextId'>('context-retry-context'),
        identityContext: identity,
        agentId,
        agentVersion,
        runId: retryRunId,
        stepId: 'turn-1',
        locale: brand<string, 'RequestLocale'>('zh-CN'),
        purpose: 'retry-context',
      },
      undefined,
      new AbortController().signal,
    );

    expect(assembly.selectedMessageRefs).toEqual([requestId]);
  });

  it('exposes retry through the Web channel without projecting terminal completion', async () => {
    const app = createNextAgentTestApp({ workspaceDir: process.cwd(), modelSteps: [{ content: 'retry ok' }], identity });
    const created = await app.server.inject({ method: 'POST', url: '/api/v1/sessions', payload: {} });
    const sessionId = brand<string, 'SessionId'>(created.json<{ sessionId: string }>().sessionId);
    const requestId = brand<string, 'MessageId'>('request-web-retry');
    const runId = brand<string, 'RequestRunId'>('run-web-retry-source');
    await app.gateway.requestRuns.saveRun(runRecord({ sessionId, requestId, runId }), {});
    await app.gateway.timeline.appendEvent({
      tenantId: identity.tenantId,
      subjectId: identity.subjectId,
      agentId,
      agentVersion,
      eventId: 'event-web-retry-source',
      sessionId,
      requestId,
      runId,
      requestContextId: brand<string, 'RequestContextId'>('context-web-retry-source'),
      sequence: brand<number, 'TimelineSequence'>(0),
      type: 'REQUEST_COMPLETED',
      inlinePayload: { content: 'source attempt terminal' },
      createdAt: brand<number, 'EpochMillis'>(1),
    });

    const response = await app.server.inject({
      method: 'POST',
      url: `/api/v1/sessions/${sessionId}/retry`,
      payload: {
        expectedLatestRequestId: requestId,
        idempotencyKey: 'idem-web-retry',
      },
    });

    const body = response.json<{ requestId: string; runId: string; attempt: number }>();
    expect(response.statusCode).toBe(200);
    expect(body.requestId).toBe(requestId);
    expect(body.attempt).toBe(2);
    await waitFor(async () => {
      const run = await app.gateway.requestRuns.loadRun({
        tenantId: identity.tenantId,
        subjectId: identity.subjectId,
        agentId,
        runId: brand<string, 'RequestRunId'>(body.runId),
      });
      return run?.status === 'COMPLETED' && run.terminalCommitState === 'COMMITTED';
    });
    await expect(
      app.runtime.listEvents({
        identityContext: identity,
        sessionId,
        runId,
        afterSequence: brand<number, 'TimelineSequence'>(0),
        limit: 100,
      }),
    ).resolves.toMatchObject({
      availability: 'AVAILABLE',
      events: [{ eventId: 'event-web-retry-source', inlinePayload: { content: 'source attempt terminal' } }],
    });
    await expect(
      app.runtime.listEvents({
        identityContext: identity,
        sessionId,
        runId: brand<string, 'RequestRunId'>(body.runId),
        afterSequence: brand<number, 'TimelineSequence'>(0),
        limit: 100,
      }),
    ).resolves.toMatchObject({ availability: 'AVAILABLE', events: expect.any(Array) });
  });
});
