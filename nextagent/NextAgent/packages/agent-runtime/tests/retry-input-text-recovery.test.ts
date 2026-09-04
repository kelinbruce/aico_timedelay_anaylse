import {
  AgentError,
  brand,
  type AgentId,
  type AgentType,
  type AgentVersion,
  type EpochMillis,
  type IdempotencyKey,
  type RequestLocale,
  type SessionId,
  type TenantId,
  type TimelineSequence,
} from '@nextagent/agent-common';
import type { AgentAssembly, AgentAssemblyRegistry } from '@nextagent/agent-contracts/agent-assembly';
import type { CapabilityCatalog } from '@nextagent/agent-contracts/capability';
import type {
  ActiveContextStoreGateway,
  CheckpointRecord,
  CheckpointStoreGateway,
  RequestRunRecord,
  RequestRunStoreGateway,
  RunTimelineEventRecord,
  RunTimelineEventStoreGateway,
  SessionMessageRecord,
  SessionMessageStoreGateway,
} from '@nextagent/agent-contracts/gateway';
import type {
  Agent,
  AgentConstructor,
  AgentExecutionOutcome,
  RequestContext,
  RequestRun,
  RoutingConstraints,
  SubmitRequestCommand,
} from '@nextagent/agent-contracts/runtime';
import type { EditLatestRequestCommand } from '@nextagent/agent-contracts/runtime';
import type { UserSession, UserSessionPort } from '@nextagent/agent-contracts/session';
import { RequestLifecycleCoordinator } from '@nextagent/agent-runtime';
import { describe, expect, it, vi } from 'vitest';

const tenantId = brand<string, 'TenantId'>('tenant-retry-input-recovery');
const subjectId = brand<string, 'SubjectId'>('subject-retry-input-recovery');
const agentId = brand<string, 'AgentId'>('agent-retry-input-recovery');
const agentVersion = brand<string, 'AgentVersion'>('v1');
const sessionId = brand<string, 'SessionId'>('session-retry-input-recovery');

describe('retry input text recovery', () => {
  it('recovers effective inputText and structured workflow target on retry', async () => {
    const captured: RequestContext[] = [];
    const harness = makeHarness(captured);
    const coordinator = new RequestLifecycleCoordinator(harness.deps);
    const originalInputText = '$workflow:push-gate diagnose RAN alarms in sector 3';
    const submitCommand: SubmitRequestCommand = {
      sessionId,
      identityContext: { tenantId, subjectId, displayName: 'Retry Input' },
      inputText: originalInputText,
      attachmentIds: [],
      locale: brand<string, 'RequestLocale'>('zh-CN'),
      idempotencyKey: brand<string, 'IdempotencyKey'>('idem-retry-input-submit'),
    };

    const accepted = await coordinator.submit(submitCommand);
    await coordinator.waitForIdle({ timeoutMs: 5_000 });

    await coordinator.retryLatest({
      sessionId,
      identityContext: submitCommand.identityContext,
      expectedLatestRequestId: accepted.requestId,
      action: 'RETRY_LATEST',
      idempotencyKey: brand<string, 'IdempotencyKey'>('idem-retry-input-retry'),
    });
    await coordinator.waitForIdle({ timeoutMs: 5_000 });

    expect(captured).toHaveLength(2);
    expect(captured[1]?.acceptedInputText).toBe('diagnose RAN alarms in sector 3');
    expect(captured[1]?.flowVariables.input_question).toBe('diagnose RAN alarms in sector 3');
    expect(captured[1]?.routingConstraints).toEqual({ targetRecipe: 'push-gate' });
    expect(harness.messageRecords.get(accepted.requestId)).toMatchObject({
      content: 'diagnose RAN alarms in sector 3',
      metadata: { routingConstraints: { targetRecipe: 'push-gate' } },
    });
  });

  it('recovers effective inputText and structured skill target on retry', async () => {
    const captured: RequestContext[] = [];
    const harness = makeHarness(captured);
    const coordinator = new RequestLifecycleCoordinator(harness.deps);
    const originalInputText = '$skill:alarm-diagnosis check BSC reachability';
    const submitCommand: SubmitRequestCommand = {
      sessionId,
      identityContext: { tenantId, subjectId, displayName: 'Retry Skill' },
      inputText: originalInputText,
      attachmentIds: [],
      locale: brand<string, 'RequestLocale'>('zh-CN'),
      idempotencyKey: brand<string, 'IdempotencyKey'>('idem-retry-skill-submit'),
    };

    const accepted = await coordinator.submit(submitCommand);
    await coordinator.waitForIdle({ timeoutMs: 5_000 });

    await coordinator.retryLatest({
      sessionId,
      identityContext: submitCommand.identityContext,
      expectedLatestRequestId: accepted.requestId,
      action: 'RETRY_LATEST',
      idempotencyKey: brand<string, 'IdempotencyKey'>('idem-retry-skill-retry'),
    });
    await coordinator.waitForIdle({ timeoutMs: 5_000 });

    expect(captured).toHaveLength(2);
    expect(captured[1]?.acceptedInputText).toBe('check BSC reachability');
    expect(captured[1]?.flowVariables.input_question).toBe('check BSC reachability');
    expect(captured[1]?.routingConstraints).toEqual({ targetSkill: 'alarm-diagnosis' });
    expect(harness.messageRecords.get(accepted.requestId)).toMatchObject({
      content: 'check BSC reachability',
      metadata: { routingConstraints: { targetSkill: 'alarm-diagnosis' } },
    });
  });

  it('fails retry closed when persisted routing constraints are invalid', async () => {
    const captured: RequestContext[] = [];
    const harness = makeHarness(captured);
    const coordinator = new RequestLifecycleCoordinator(harness.deps);
    const accepted = await coordinator.submit({
      sessionId,
      identityContext: { tenantId, subjectId, displayName: 'Retry Invalid Routing' },
      inputText: '$skill:alarm-diagnosis check BSC reachability',
      attachmentIds: [],
      locale: brand<string, 'RequestLocale'>('zh-CN'),
      idempotencyKey: brand<string, 'IdempotencyKey'>('idem-retry-invalid-routing-submit'),
    });
    await coordinator.waitForIdle({ timeoutMs: 5_000 });
    const rootMessage = harness.messageRecords.get(accepted.requestId);
    expect(rootMessage).toBeDefined();
    harness.messageRecords.set(accepted.requestId, {
      ...rootMessage!,
      metadata: { ...rootMessage!.metadata, routingConstraints: { targetSkill: '../unsafe' } },
    });

    await expect(
      coordinator.retryLatest({
        sessionId,
        identityContext: { tenantId, subjectId, displayName: 'Retry Invalid Routing' },
        expectedLatestRequestId: accepted.requestId,
        action: 'RETRY_LATEST',
        idempotencyKey: brand<string, 'IdempotencyKey'>('idem-retry-invalid-routing-retry'),
      }),
    ).rejects.toMatchObject({ code: 'REQUEST_ROUTING_FACTS_INVALID' });
  });

  it('reuses persisted attachment IDs on retry through storage-independent availability validation', async () => {
    const captured: RequestContext[] = [];
    const validateRetrySourceAttachments = vi.fn(async () => ({ status: 'VALID' as const }));
    const harness = makeHarness(captured, { retryAttachmentValidator: { validateRetrySourceAttachments } });
    const coordinator = new RequestLifecycleCoordinator(harness.deps);
    const attachmentId = brand<string, 'AttachmentId'>('attachment-retry-1');
    const accepted = await coordinator.submit({
      sessionId,
      identityContext: { tenantId, subjectId, displayName: 'Retry Attachment' },
      inputText: 'diagnose attached report',
      attachmentIds: [attachmentId],
      locale: brand<string, 'RequestLocale'>('zh-CN'),
      idempotencyKey: brand<string, 'IdempotencyKey'>('idem-retry-attachment-submit'),
    });
    await coordinator.waitForIdle({ timeoutMs: 5_000 });

    await coordinator.retryLatest({
      sessionId,
      identityContext: { tenantId, subjectId, displayName: 'Retry Attachment' },
      expectedLatestRequestId: accepted.requestId,
      action: 'RETRY_LATEST',
      idempotencyKey: brand<string, 'IdempotencyKey'>('idem-retry-attachment-retry'),
    });
    await coordinator.waitForIdle({ timeoutMs: 5_000 });

    expect(harness.messageRecords.get(accepted.requestId)?.metadata.attachmentIds).toEqual([attachmentId]);
    expect(validateRetrySourceAttachments).toHaveBeenCalledTimes(2);
    expect(validateRetrySourceAttachments).toHaveBeenLastCalledWith(
      expect.objectContaining({
        source: expect.objectContaining({ runId: accepted.runId }),
        attachmentIds: [attachmentId],
      }),
    );
  });

  it('falls back to empty inputText when root message is unavailable', async () => {
    const captured: RequestContext[] = [];
    const harness = makeHarness(captured);
    const coordinator = new RequestLifecycleCoordinator(harness.deps);
    const submitCommand: SubmitRequestCommand = {
      sessionId,
      identityContext: { tenantId, subjectId, displayName: 'Retry Missing' },
      inputText: 'diagnose retry with missing root message',
      attachmentIds: [],
      locale: brand<string, 'RequestLocale'>('zh-CN'),
      idempotencyKey: brand<string, 'IdempotencyKey'>('idem-retry-missing-submit'),
    };

    const accepted = await coordinator.submit(submitCommand);
    await coordinator.waitForIdle({ timeoutMs: 5_000 });

    // Simulate root message loss (e.g. gateway corruption)
    harness.messageRecords.clear();

    await coordinator.retryLatest({
      sessionId,
      identityContext: submitCommand.identityContext,
      expectedLatestRequestId: accepted.requestId,
      action: 'RETRY_LATEST',
      idempotencyKey: brand<string, 'IdempotencyKey'>('idem-retry-missing-retry'),
    });
    await coordinator.waitForIdle({ timeoutMs: 5_000 });

    expect(captured).toHaveLength(2);
    expect(captured[1]?.acceptedInputText).toBe('');
    expect(captured[1]?.flowVariables.input_question).toBe('');
  });

  it('projects edited skill directive into effective input and routing constraints', async () => {
    const captured: RequestContext[] = [];
    const harness = makeHarness(captured);
    const coordinator = new RequestLifecycleCoordinator(harness.deps);
    const submitCommand: SubmitRequestCommand = {
      sessionId,
      identityContext: { tenantId, subjectId, displayName: 'Edit Skill' },
      inputText: '$skill:alarm-diagnosis check BSC reachability',
      attachmentIds: [],
      locale: brand<string, 'RequestLocale'>('zh-CN'),
      idempotencyKey: brand<string, 'IdempotencyKey'>('idem-edit-skill-submit'),
    };

    const accepted = await coordinator.submit(submitCommand);
    await coordinator.waitForIdle({ timeoutMs: 5_000 });

    const editedText = '$skill:alarm-diagnosis check RNC reachability instead';
    const editCommand: EditLatestRequestCommand = {
      sessionId,
      identityContext: submitCommand.identityContext,
      expectedLatestRequestId: accepted.requestId,
      editedInputText: editedText,
      attachmentIds: [],
      idempotencyKey: brand<string, 'IdempotencyKey'>('idem-edit-skill-edit'),
    };

    await coordinator.editLatest(editCommand);
    await coordinator.waitForIdle({ timeoutMs: 5_000 });

    expect(captured).toHaveLength(2);
    expect(captured[1]?.acceptedInputText).toBe('check RNC reachability instead');
    expect(captured[1]?.flowVariables.input_question).toBe('check RNC reachability instead');
    expect(captured[1]?.routingConstraints).toEqual({ targetSkill: 'alarm-diagnosis' });
  });

  it('projects edited workflow directive into effective input and routing constraints', async () => {
    const captured: RequestContext[] = [];
    const harness = makeHarness(captured);
    const coordinator = new RequestLifecycleCoordinator(harness.deps);
    const submitCommand: SubmitRequestCommand = {
      sessionId,
      identityContext: { tenantId, subjectId, displayName: 'Edit Workflow' },
      inputText: '$workflow:push-gate diagnose RAN alarms',
      attachmentIds: [],
      locale: brand<string, 'RequestLocale'>('zh-CN'),
      idempotencyKey: brand<string, 'IdempotencyKey'>('idem-edit-wf-submit'),
    };

    const accepted = await coordinator.submit(submitCommand);
    await coordinator.waitForIdle({ timeoutMs: 5_000 });

    const editedText = '$workflow:push-gate diagnose transport alarms instead';
    const editCommand: EditLatestRequestCommand = {
      sessionId,
      identityContext: submitCommand.identityContext,
      expectedLatestRequestId: accepted.requestId,
      editedInputText: editedText,
      attachmentIds: [],
      idempotencyKey: brand<string, 'IdempotencyKey'>('idem-edit-wf-edit'),
    };

    await coordinator.editLatest(editCommand);
    await coordinator.waitForIdle({ timeoutMs: 5_000 });

    expect(captured).toHaveLength(2);
    expect(captured[1]?.acceptedInputText).toBe('diagnose transport alarms instead');
    expect(captured[1]?.flowVariables.input_question).toBe('diagnose transport alarms instead');
    expect(captured[1]?.routingConstraints).toEqual({ targetRecipe: 'push-gate' });
  });

  it('durably hides every source-request message after edit acceptance', async () => {
    const captured: RequestContext[] = [];
    const harness = makeHarness(captured);
    const coordinator = new RequestLifecycleCoordinator(harness.deps);
    const submitCommand: SubmitRequestCommand = {
      sessionId,
      identityContext: { tenantId, subjectId, displayName: 'Edit Visibility' },
      inputText: 'original question',
      attachmentIds: [],
      locale: brand<string, 'RequestLocale'>('zh-CN'),
      idempotencyKey: brand<string, 'IdempotencyKey'>('idem-edit-visibility-submit'),
    };
    const original = await coordinator.submit(submitCommand);
    await coordinator.waitForIdle({ timeoutMs: 5_000 });

    const edited = await coordinator.editLatest({
      sessionId,
      identityContext: submitCommand.identityContext,
      expectedLatestRequestId: original.requestId,
      editedInputText: 'edited question',
      attachmentIds: [],
      idempotencyKey: brand<string, 'IdempotencyKey'>('idem-edit-visibility-edit'),
    });
    await coordinator.waitForIdle({ timeoutMs: 5_000 });

    const sourceMessages = [...harness.messageRecords.values()].filter((record) => record.requestId === original.requestId);
    expect(sourceMessages.length).toBeGreaterThanOrEqual(2);
    expect(sourceMessages.every((record) => !record.visible)).toBe(true);
    expect(sourceMessages.map((record) => record.metadata.visibility)).toEqual(
      sourceMessages.map(() => expect.objectContaining({ reason: 'EDIT_REPLACED' })),
    );
    expect([...harness.messageRecords.values()].find((record) => record.requestId === edited.requestId && record.role === 'USER')).toMatchObject({
      visible: true,
      content: 'edited question',
    });
  });

  it('repairs edit visibility on an equivalent idempotent replay without creating another request', async () => {
    const captured: RequestContext[] = [];
    const harness = makeHarness(captured, { failEditVisibilityOnce: true });
    const coordinator = new RequestLifecycleCoordinator(harness.deps);
    const submitCommand: SubmitRequestCommand = {
      sessionId,
      identityContext: { tenantId, subjectId, displayName: 'Edit Visibility Repair' },
      inputText: 'original repair question',
      attachmentIds: [],
      locale: brand<string, 'RequestLocale'>('zh-CN'),
      idempotencyKey: brand<string, 'IdempotencyKey'>('idem-edit-visibility-repair-submit'),
    };
    const original = await coordinator.submit(submitCommand);
    await coordinator.waitForIdle({ timeoutMs: 5_000 });
    const editCommand: EditLatestRequestCommand = {
      sessionId,
      identityContext: submitCommand.identityContext,
      expectedLatestRequestId: original.requestId,
      editedInputText: 'repaired edit question',
      attachmentIds: [],
      idempotencyKey: brand<string, 'IdempotencyKey'>('idem-edit-visibility-repair-edit'),
    };

    await expect(coordinator.editLatest(editCommand)).rejects.toThrow('edit visibility unavailable');
    await coordinator.waitForIdle({ timeoutMs: 5_000 });
    const replay = await coordinator.editLatest(editCommand);

    expect(harness.hideRequestMessages).toHaveBeenCalledTimes(2);
    expect([...harness.messageRecords.values()].filter((record) => record.requestId === original.requestId)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          visible: false,
          metadata: expect.objectContaining({ visibility: expect.objectContaining({ reason: 'EDIT_REPLACED' }) }),
        }),
      ]),
    );
    expect(replay.requestId).toBe([...harness.runRecords.values()].at(-1)?.requestId);
    expect(captured).toHaveLength(2);
  });

  it('does not hide source messages when a fresh edit fails the latest-target preflight', async () => {
    const captured: RequestContext[] = [];
    const harness = makeHarness(captured);
    const coordinator = new RequestLifecycleCoordinator(harness.deps);
    const submitCommand: SubmitRequestCommand = {
      sessionId,
      identityContext: { tenantId, subjectId, displayName: 'Edit Preflight' },
      inputText: 'keep this question visible',
      attachmentIds: [],
      locale: brand<string, 'RequestLocale'>('zh-CN'),
      idempotencyKey: brand<string, 'IdempotencyKey'>('idem-edit-preflight-submit'),
    };
    const original = await coordinator.submit(submitCommand);
    await coordinator.waitForIdle({ timeoutMs: 5_000 });

    await expect(
      coordinator.editLatest({
        sessionId,
        identityContext: submitCommand.identityContext,
        expectedLatestRequestId: brand<string, 'MessageId'>('stale-request'),
        editedInputText: 'must not be accepted',
        attachmentIds: [],
        idempotencyKey: brand<string, 'IdempotencyKey'>('idem-edit-preflight-edit'),
      }),
    ).rejects.toMatchObject({ code: 'EDIT_LATEST_NOT_LATEST' });

    expect(harness.hideRequestMessages).not.toHaveBeenCalled();
    expect([...harness.messageRecords.values()].filter((record) => record.requestId === original.requestId).every((record) => record.visible)).toBe(
      true,
    );
  });
});

function makeHarness(
  captured: RequestContext[],
  overrides: {
    readonly retryAttachmentValidator?: {
      validateRetrySourceAttachments: (request: {
        readonly attachmentIds: ReadonlyArray<import('@nextagent/agent-common').AttachmentId>;
      }) => Promise<{ readonly status: 'VALID' | 'UNAVAILABLE' }>;
    };
    readonly failEditVisibilityOnce?: boolean;
  } = {},
) {
  const assembly = makeAssembly();
  const session: UserSession = {
    tenantId,
    subjectId,
    agentId: assembly.agentId,
    sessionId,
    title: 'Retry Input Recovery Session',
    createdAt: brand<number, 'EpochMillis'>(1),
    updatedAt: brand<number, 'EpochMillis'>(1),
    hasInFlightRequest: false,
  };
  const runRecords = new Map<string, RequestRunRecord>();
  const idempotencyRecords = new Map<string, RequestRunRecord>();
  const timelineEvents: RunTimelineEventRecord[] = [];
  const messageRecords = new Map<string, SessionMessageRecord>();
  const checkpoints = new Map<string, CheckpointRecord>();

  const requestRunStore: RequestRunStoreGateway = {
    async saveRun(record, options) {
      const existing = runRecords.get(record.runId);
      if (options.expectedVersion !== undefined) {
        if (existing === undefined || existing.version !== options.expectedVersion) {
          return { status: 'VERSION_CONFLICT' as const };
        }
      } else if (existing !== undefined) {
        return { status: 'UPDATED' as const, record: existing };
      }
      runRecords.set(record.runId, record);
      if (options.idempotencyKey !== undefined) {
        idempotencyRecords.set(`${record.sessionId}:${options.idempotencyKey}:${options.idempotencySemantic ?? ''}`, record);
      }
      return { status: 'UPDATED' as const, record };
    },
    async loadRun(request) {
      return runRecords.get(request.runId);
    },
    async listRuns(request) {
      return { items: [], offset: request.offset, limit: request.limit, hasMore: false };
    },
    async loadSessionLaneSnapshot(request) {
      const records = [...runRecords.values()].filter((record) => record.sessionId === request.sessionId && record.agentId === request.agentId);
      const latestRun = records.at(-1);
      return {
        tenantId: request.tenantId,
        subjectId: request.subjectId,
        agentId: request.agentId,
        sessionId: request.sessionId,
        ...(latestRun === undefined ? {} : { latestRequestId: latestRun.requestId, latestRun }),
        queuedRuns: records.filter((record) => record.status === 'QUEUED'),
      };
    },
    async loadRunByIdempotencyKey(request) {
      const record = idempotencyRecords.get(`${request.sessionId}:${request.idempotencyKey}:${request.idempotencySemantic}`);
      return record === undefined ? { status: 'NOT_FOUND' as const } : { status: 'FOUND' as const, record };
    },
    async claimRun() {
      return { status: 'VERSION_CONFLICT' as const };
    },
    async listRecoverableRuns() {
      return [];
    },
    async commitTerminal(request) {
      const existing = runRecords.get(request.runId);
      if (existing === undefined || existing.version !== request.expectedVersion) {
        return { status: 'VERSION_CONFLICT' as const };
      }
      const committed: RequestRunRecord = {
        ...existing,
        status: request.terminalStatus,
        terminalCommitState: 'COMMITTED',
        version: existing.version + 1,
        updatedAt: request.terminalEvent.createdAt,
      };
      runRecords.set(request.runId, committed);
      messageRecords.set(request.terminalMessage.messageId, request.terminalMessage);
      timelineEvents.push(request.terminalEvent);
      return { status: 'COMMITTED' as const, terminalEvent: request.terminalEvent };
    },
  };

  let editVisibilityFailuresRemaining = overrides.failEditVisibilityOnce ? 1 : 0;
  const hideRequestMessages = vi.fn(
    async (request: {
      readonly tenantId: TenantId;
      readonly subjectId: typeof subjectId;
      readonly agentId: AgentId;
      readonly sessionId: SessionId;
      readonly requestId: import('@nextagent/agent-common').MessageId;
      readonly reason: 'EDIT_REPLACED';
      readonly hiddenByContextId: import('@nextagent/agent-common').RequestContextId;
    }) => {
      if (editVisibilityFailuresRemaining > 0) {
        editVisibilityFailuresRemaining -= 1;
        throw new AgentError({
          code: 'EDIT_VISIBILITY_UNAVAILABLE',
          message: 'edit visibility unavailable',
          category: 'UNAVAILABLE',
          retryable: true,
        });
      }
      let hiddenCount = 0;
      for (const [messageId, record] of messageRecords) {
        if (
          record.tenantId !== request.tenantId ||
          record.subjectId !== request.subjectId ||
          record.agentId !== request.agentId ||
          record.sessionId !== request.sessionId ||
          record.requestId !== request.requestId ||
          !record.visible
        ) {
          continue;
        }
        messageRecords.set(messageId, {
          ...record,
          visible: false,
          metadata: {
            ...record.metadata,
            visibility: { reason: request.reason, hiddenByContextId: request.hiddenByContextId },
          },
        });
        hiddenCount += 1;
      }
      return hiddenCount;
    },
  );
  const messageStore = {
    async appendSessionMessage(record) {
      messageRecords.set(record.messageId, record);
      return record;
    },
    async loadMessage(request) {
      return messageRecords.get(request.messageId);
    },
    async listSessionMessages() {
      return { items: [], limit: 20, hasMore: false };
    },
    async loadMessages() {
      return [];
    },
    async listConversationPreview() {
      return { sessionId: session.sessionId, totalMarkers: 0, offset: 0, limit: 100, markers: [] };
    },
    async listMessages() {
      return { items: [], limit: 20, hasMore: false };
    },
    async listCurrentRequestMessages(request) {
      return {
        items: [...messageRecords.values()].filter((record) => record.sessionId === request.sessionId && record.requestId === request.requestId),
        offset: request.offset,
        limit: request.limit,
        hasMore: false,
      };
    },
    async hideMessage() {
      return undefined;
    },
    hideRequestMessages,
  } as SessionMessageStoreGateway & { readonly hideRequestMessages: typeof hideRequestMessages };

  const timelineStore: RunTimelineEventStoreGateway = {
    async appendEvent(record) {
      const persisted = { ...record, sequence: brand<number, 'TimelineSequence'>(timelineEvents.length + 1) };
      timelineEvents.push(persisted);
      return persisted;
    },
    async listEvents(request) {
      return timelineEvents.filter((record) => record.sessionId === request.sessionId && Number(record.sequence) > Number(request.afterSequence));
    },
  };

  const checkpointStore: CheckpointStoreGateway = {
    async saveCheckpoint(record) {
      checkpoints.set(record.runId, record);
      return record;
    },
    async loadCheckpoint(request) {
      return checkpoints.get(request.runId);
    },
  } as CheckpointStoreGateway;

  const activeContextStore: ActiveContextStoreGateway = {
    async loadActiveContext() {
      return {
        state: { tenantId, subjectId, agentId: assembly.agentId, sessionId, activeContextVersion: 0, updatedAt: brand<number, 'EpochMillis'>(1) },
        items: [],
      };
    },
    async appendItem() {
      throw new AgentError({ code: 'NOT_USED', message: 'not used', category: 'INTERNAL', retryable: false });
    },
    async replaceActiveContext() {
      throw new AgentError({ code: 'NOT_USED', message: 'not used', category: 'INTERNAL', retryable: false });
    },
    async commitCompaction() {
      throw new AgentError({ code: 'NOT_USED', message: 'not used', category: 'INTERNAL', retryable: false });
    },
    async updateMetadata() {
      return { status: 'UPDATED' as const };
    },
  } as ActiveContextStoreGateway;

  const userSessions: UserSessionPort = {
    async createSession() {
      return session;
    },
    async requireSession() {
      return session;
    },
    async listSessions() {
      return { entries: [session], offset: 0, limit: 20, hasMore: false };
    },
    async deleteSession() {
      return undefined;
    },
    async listMessages() {
      return { items: [], limit: 20, hasMore: false };
    },
    async listConversationPreview() {
      return { sessionId: session.sessionId, totalMarkers: 0, offset: 0, limit: 100, markers: [] };
    },
    async listCurrentRequestMessages() {
      return { items: [], limit: 20, hasMore: false };
    },
    async generateTitle() {
      return false;
    },
    async updateTitle() {
      return session;
    },
  };

  return {
    runRecords,
    messageRecords,
    hideRequestMessages,
    deps: {
      defaultRouteAgentId: assembly.agentId,
      acceptedInputProjector: projectDirectiveInputForRuntimeTest,
      agentConstructors: [makeAgentConstructor(captured) as AgentConstructor<{ captured: RequestContext[] }>],
      agentRuntimeDependencies: { captured },
      assemblyRegistry: {
        async active() {
          return assembly;
        },
        async require() {
          return assembly;
        },
      } as AgentAssemblyRegistry,
      requestRunStore,
      messageStore,
      timelineStore,
      checkpointStore,
      activeContextStore,
      userSessions,
      capabilityCatalog: {} as CapabilityCatalog,
      ...(overrides.retryAttachmentValidator === undefined ? {} : { retryAttachmentValidator: overrides.retryAttachmentValidator }),
      internalObserver: () => undefined,
    },
  };
}

function projectDirectiveInputForRuntimeTest(
  inputText: string,
  routingConstraints?: RoutingConstraints,
): { readonly inputText: string; readonly routingConstraints?: RoutingConstraints } {
  const matches = [...inputText.matchAll(/\$(skill|workflow):(\S*)/gu)];
  if (matches.length === 0) {
    return { inputText, ...(routingConstraints === undefined ? {} : { routingConstraints }) };
  }
  const firstKind = matches[0]?.[1];
  const firstName = matches[0]?.[2];
  if (firstName === undefined || !/^[A-Za-z0-9._-]+$/u.test(firstName) || matches.some((match) => match[1] !== firstKind || match[2] !== firstName)) {
    return { inputText, ...(routingConstraints === undefined ? {} : { routingConstraints }) };
  }
  const projected = { ...routingConstraints };
  if (firstKind === 'skill') {
    delete projected.targetRecipe;
    projected.targetSkill = firstName;
  } else {
    delete projected.targetSkill;
    projected.targetRecipe = firstName;
  }
  const projectedInputText = inputText.replace(/\$(skill|workflow):(\S*)/gu, '').trim();
  if (projectedInputText.length === 0) {
    throw new AgentError({
      code: 'CAPABILITY_DIRECTIVE_EFFECTIVE_QUESTION_EMPTY',
      message: 'Capability directive stripped the effective user question to empty.',
      category: 'VALIDATION',
      retryable: false,
      safeDetails: { reasonCode: 'CAPABILITY_DIRECTIVE_EFFECTIVE_QUESTION_EMPTY' },
    });
  }
  return {
    inputText: projectedInputText,
    routingConstraints: projected,
  };
}

function makeAssembly(): AgentAssembly {
  return {
    agentId,
    agentVersion,
    agentAssemblyRef: 'agent-retry-input-recovery@v1',
    agentType: brand<string, 'AgentType'>('DEFAULT') as AgentType,
    title: 'Retry Input Recovery',
    displayName: 'Retry Input Recovery',
    description: 'runtime test assembly',
    capabilityBindings: [],
    prompts: [],
    recipes: [],
    hooks: [],
    runtimeSettings: {},
    workspacePolicy: { mode: 'DEFAULT' },
    modelIds: [],
    userInvocable: false,
    agentInvocation: { enabled: false },
  } as unknown as AgentAssembly;
}

function makeAgentConstructor(captured: RequestContext[]): AgentConstructor {
  return class TestAgent implements Agent {
    static getType(): AgentType {
      return brand<string, 'AgentType'>('DEFAULT') as AgentType;
    }

    async execute(_run: RequestRun, context: RequestContext): Promise<AgentExecutionOutcome> {
      captured.push(context);
      return { status: 'COMPLETED' };
    }
  };
}
