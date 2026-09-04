import {
  brand,
  type AgentId,
  type AgentVersion,
  type ArtifactId,
  type AttachmentId,
  type BlobRef,
  type CheckpointId,
  type CheckpointTriggerReason,
  type EpochMillis,
  type IdempotencyKey,
  type IdentityContext,
  type JsonObject,
  type MessageContentType,
  type MessageId,
  type PendingInputKind,
  type PendingInputId,
  type RequestContextId,
  type RequestRunId,
  type RunStatus,
  type SafeError,
  type SessionId,
  type TenantId,
  type TerminalCommitState,
  type TimelineEventType,
  type TimelineSequence,
} from '@nextagent/agent-common';
import type { CapabilityInvocationRequest, CapabilityInvocationResult } from '@nextagent/agent-contracts/capability';
import type { ModelStreamDelta, ModelFinalResult } from '@nextagent/agent-contracts/model';
import type {
  ActiveContextLookupRequest,
  ActiveContextViewRecord,
  AppendActiveContextItemRequest,
  BlobStoreGateway,
  CheckpointRecord,
  CheckpointStoreGateway,
  LoadCheckpointRequest,
  LoadBlobRequest,
  StoreBlobRequest,
  SessionLookupRequest,
  SessionMessageDraft,
  SessionMessageRecord,
  SessionMessageStoreGateway,
  SessionRecord,
  SessionStoreGateway,
  TerminalCommitRequest,
  TerminalCommitRecordResult,
  VersionedUpdateResult,
  VersionedWriteOptions,
} from '@nextagent/agent-contracts/gateway';
import type {
  Agent,
  AgentRunStatePort,
  CheckpointPayload,
  RequestContext,
  RequestControlCommand,
  RequestRun,
  RuntimeCommandPort,
  SubmitRequestCommand,
  RunTimelineEvent,
} from '@nextagent/agent-contracts/runtime';
import { createIdentityFixture, createSafeErrorFixture } from '@nextagent/agent-test-kit';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { PACKAGE_ROOT } from '../../helpers/package-root.js';
import { describe, expect, it } from 'vitest';

describe('Contract Module', () => {
  it('TC_Contract_SessionStore_001 - SessionStoreGateway契约loadSession验证成功', async () => {
    const identity = createIdentityFixture();
    const agentId = brand<string, 'AgentId'>('agent-session-store');
    const sessionId = brand<string, 'SessionId'>('session-contract-001');
    const now = brand<number, 'EpochMillis'>(100);
    const lookupRequest: SessionLookupRequest = {
      tenantId: identity.tenantId,
      subjectId: identity.subjectId,
      agentId,
      sessionId,
    };
    const sessionRecord: SessionRecord = {
      tenantId: identity.tenantId,
      subjectId: identity.subjectId,
      agentId,
      sessionId,
      title: 'Contract Session',
      createdAt: now,
      updatedAt: now,
    };
    const sessionStore: SessionStoreGateway = {
      async loadSession(request) {
        expect(request.tenantId).toBe(identity.tenantId);
        expect(request.subjectId).toBe(identity.subjectId);
        expect(request.agentId).toBe(agentId);
        return sessionRecord;
      },
      async listSessions() {
        return { entries: [], offset: 0, limit: 10, hasMore: false };
      },
      async saveSession(record) {
        return record;
      },
    };

    const result = await sessionStore.loadSession(lookupRequest);

    expect(result?.tenantId).toBe(identity.tenantId);
    expect(result?.subjectId).toBe(identity.subjectId);
    expect(result?.agentId).toBe(agentId);
    expect(result?.sessionId).toBe(sessionId);
    expect(result?.title).toBe('Contract Session');
    expect(sessionStore.loadSession).toBeTypeOf('function');
  });

  it('TC_Contract_Session_Message_002 - SessionMessageStoreGateway契约appendSessionMessage验证成功', async () => {
    const identity = createIdentityFixture();
    const agentId = brand<string, 'AgentId'>('agent-session-message');
    const sessionId = brand<string, 'SessionId'>('session-contract-002');
    const requestId = brand<string, 'MessageId'>('request-contract-002');
    const runId = brand<string, 'RequestRunId'>('run-contract-002');
    const messageId = brand<string, 'MessageId'>('message-contract-002');
    const now = brand<number, 'EpochMillis'>(100);
    const idempotencyKey = brand<string, 'IdempotencyKey'>('idem-session-message-002');
    const messageRecord: SessionMessageRecord = {
      tenantId: identity.tenantId,
      subjectId: identity.subjectId,
      agentId,
      messageId,
      sessionId,
      requestId,
      runId,
      role: 'ASSISTANT',
      content: 'Contract message content',
      contentType: 'PLAIN_TEXT',
      metadata: { source: 'contract-test' },
      visible: true,
      createdAt: now,
    };
    const appendedRecords: SessionMessageRecord[] = [];
    const sessionMessageStore: SessionMessageStoreGateway = {
      async appendSessionMessage(record, options) {
        expect(options?.idempotencyKey).toBe(idempotencyKey);
        appendedRecords.push(record);
        return record;
      },
      async loadMessage() {
        return undefined;
      },
      async loadMessages() {
        return [];
      },
      async listConversationPreview() {
        return { sessionId, totalMarkers: 0, offset: 0, limit: 100, markers: [] };
      },
      async listMessages() {
        return { items: [], limit: 20, hasMore: false };
      },
      async listCurrentRequestMessages() {
        return { items: [], limit: 20, hasMore: false };
      },
      async hideMessage() {
        return undefined;
      },
    };

    const result = await sessionMessageStore.appendSessionMessage(messageRecord, { idempotencyKey });

    expect(result.messageId).toBe(messageId);
    expect(result.sessionId).toBe(sessionId);
    expect(result.requestId).toBe(requestId);
    expect(result.runId).toBe(runId);
    expect(result.role).toBe('ASSISTANT');
    expect(result.content).toBe('Contract message content');
    expect(appendedRecords).toHaveLength(1);
    expect(sessionMessageStore.appendSessionMessage).toBeTypeOf('function');
  });

  it('TC_Contract_Active_Context_003 - ActiveContextStoreGateway契约version CAS验证成功', async () => {
    const identity = createIdentityFixture();
    const agentId = brand<string, 'AgentId'>('agent-active-context');
    const sessionId = brand<string, 'SessionId'>('session-contract-003');
    const messageId = brand<string, 'MessageId'>('message-contract-003');
    const now = brand<number, 'EpochMillis'>(100);
    const appendRequest: AppendActiveContextItemRequest = {
      tenantId: identity.tenantId,
      subjectId: identity.subjectId,
      agentId,
      sessionId,
      messageId,
      expectedActiveContextVersion: 2,
    };
    const successResult: VersionedUpdateResult<ActiveContextViewRecord> = {
      status: 'UPDATED',
      record: {
        state: {
          tenantId: identity.tenantId,
          subjectId: identity.subjectId,
          agentId,
          sessionId,
          activeContextVersion: 3,
          updatedAt: now,
        },
        items: [{ tenantId: identity.tenantId, subjectId: identity.subjectId, agentId, sessionId, ordinal: 1, messageId }],
      },
    };
    const conflictResult: VersionedUpdateResult<ActiveContextViewRecord> = {
      status: 'VERSION_CONFLICT',
    };
    const activeContextStore = {
      async loadActiveContext(): Promise<ActiveContextViewRecord> {
        return successResult.record!;
      },
      async appendItem(request): Promise<VersionedUpdateResult<ActiveContextViewRecord>> {
        if (request.expectedActiveContextVersion === 2) {
          return successResult;
        }
        return conflictResult;
      },
      async commitCompaction(): Promise<VersionedUpdateResult<ActiveContextViewRecord>> {
        return successResult;
      },
    };

    const casSuccess = await activeContextStore.appendItem(appendRequest);
    const casConflict = await activeContextStore.appendItem({
      ...appendRequest,
      expectedActiveContextVersion: 99,
    });

    expect(casSuccess.status).toBe('UPDATED');
    expect(casSuccess.record?.state.activeContextVersion).toBe(3);
    expect(casConflict.status).toBe('VERSION_CONFLICT');
    expect(activeContextStore.appendItem).toBeTypeOf('function');
  });

  it('TC_Contract_Checkpoint_004 - CheckpointStoreGateway契约idempotencyKey验证成功', async () => {
    const identity = createIdentityFixture();
    const agentId = brand<string, 'AgentId'>('agent-checkpoint');
    const sessionId = brand<string, 'SessionId'>('session-contract-004');
    const requestId = brand<string, 'MessageId'>('request-contract-004');
    const runId = brand<string, 'RequestRunId'>('run-contract-004');
    const requestContextId = brand<string, 'RequestContextId'>('context-contract-004');
    const checkpointId = brand<string, 'CheckpointId'>('checkpoint-contract-004');
    const now = brand<number, 'EpochMillis'>(100);
    const idempotencyKey = brand<string, 'IdempotencyKey'>('idem-checkpoint-004');
    const checkpointRecord: CheckpointRecord = {
      tenantId: identity.tenantId,
      subjectId: identity.subjectId,
      agentId,
      checkpointId,
      sessionId,
      requestId,
      runId,
      requestContextId,
      runVersion: 1,
      triggerReason: 'CAPABILITY_BEFORE_CALL',
      lastSequence: brand<number, 'TimelineSequence'>(10),
      activeContextVersion: 1,
      flowVariables: {},
      savedAt: now,
    };
    const savedRecords: CheckpointRecord[] = [];
    const checkpointStore: CheckpointStoreGateway = {
      async saveCheckpoint(record, options) {
        expect(options.idempotencyKey).toBe(idempotencyKey);
        savedRecords.push(record);
        return record;
      },
      async loadCheckpoint(): Promise<CheckpointRecord | undefined> {
        return savedRecords[0];
      },
    };

    const firstSave = await checkpointStore.saveCheckpoint(checkpointRecord, { idempotencyKey });
    const secondSave = await checkpointStore.saveCheckpoint(checkpointRecord, { idempotencyKey });
    const loadRequest: LoadCheckpointRequest = {
      tenantId: identity.tenantId,
      subjectId: identity.subjectId,
      agentId,
      sessionId,
      requestId,
      runId,
    };
    const loaded = await checkpointStore.loadCheckpoint(loadRequest);

    expect(firstSave.checkpointId).toBe(checkpointId);
    expect(secondSave.checkpointId).toBe(checkpointId);
    expect(savedRecords).toHaveLength(2);
    expect(loaded?.checkpointId).toBe(checkpointId);
    expect(checkpointStore.saveCheckpoint).toBeTypeOf('function');
  });

  it('TC_Contract_Blob_Ref_005 - BlobStoreGateway契约BlobRef opaque验证成功', async () => {
    const identity = createIdentityFixture();
    const blobRef = brand<string, 'BlobRef'>('blob-contract-005');
    const storeRequest: StoreBlobRequest = {
      tenantId: identity.tenantId,
      subjectId: identity.subjectId,
      purpose: 'CAPABILITY_RESULT',
      bytes: new Uint8Array([1, 2, 3, 4, 5]),
      idempotencyKey: brand<string, 'IdempotencyKey'>('idem-blob-005'),
    };
    const loadRequest: LoadBlobRequest = {
      tenantId: identity.tenantId,
      subjectId: identity.subjectId,
      blobRef,
    };
    const blobStore: BlobStoreGateway = {
      async storeBlob(request) {
        expect(request.bytes.length).toBe(5);
        return blobRef;
      },
      async loadBlob(request) {
        expect(request.blobRef).toBe(blobRef);
        return new Uint8Array([1, 2, 3, 4, 5]);
      },
      async blobExists(request) {
        return request.blobRef === blobRef;
      },
      async deleteBlob(request) {
        return request.blobRef === blobRef;
      },
    };

    const storedRef = await blobStore.storeBlob(storeRequest);
    const loadedBlob = await blobStore.loadBlob(loadRequest);
    const exists = await blobStore.blobExists(loadRequest);

    expect(typeof storedRef).toBe('string');
    expect(storedRef).toBe(blobRef);
    expect(storedRef).not.toContain('/');
    expect(storedRef).not.toContain('path');
    expect(loadedBlob).toBeDefined();
    expect(exists).toBe(true);
    expect(blobStore.storeBlob).toBeTypeOf('function');
  });

  it('TC_Contract_Terminal_Composite_006 - RequestRunStoreGateway契约terminal commit composite验证成功', async () => {
    const identity = createIdentityFixture();
    const agentId = brand<string, 'AgentId'>('agent-terminal-commit');
    const sessionId = brand<string, 'SessionId'>('session-contract-006');
    const requestId = brand<string, 'MessageId'>('request-contract-006');
    const runId = brand<string, 'RequestRunId'>('run-contract-006');
    const requestContextId = brand<string, 'RequestContextId'>('context-contract-006');
    const now = brand<number, 'EpochMillis'>(100);
    const idempotencyKey = brand<string, 'IdempotencyKey'>('idem-terminal-006');
    const terminalMessage: SessionMessageRecord = {
      tenantId: identity.tenantId,
      subjectId: identity.subjectId,
      agentId,
      messageId: requestId,
      sessionId,
      requestId,
      runId,
      role: 'ASSISTANT',
      content: 'Terminal message',
      contentType: 'PLAIN_TEXT',
      metadata: {},
      visible: true,
      createdAt: now,
    };
    const terminalEvent = {
      tenantId: identity.tenantId,
      subjectId: identity.subjectId,
      agentId,
      eventId: 'event-terminal-006',
      sessionId,
      runId,
      requestId,
      requestContextId,
      sequence: brand<number, 'TimelineSequence'>(100),
      type: 'REQUEST_COMPLETED' as TimelineEventType,
      inlinePayload: {},
      createdAt: now,
    };
    const terminalRequest: TerminalCommitRequest = {
      tenantId: identity.tenantId,
      subjectId: identity.subjectId,
      agentId,
      runId,
      expectedVersion: 1,
      terminalStatus: 'COMPLETED',
      terminalMessage,
      terminalEvent,
      idempotencyKey,
    };
    const committedResult: TerminalCommitRecordResult = {
      status: 'COMMITTED',
      terminalEvent,
    };
    const alreadyCommittedResult: TerminalCommitRecordResult = {
      status: 'ALREADY_COMMITTED',
    };
    const requestRunStore = {
      async saveRun() {
        return { status: 'UPDATED', record: {} };
      },
      async loadRun() {
        return undefined;
      },
      async loadSessionLaneSnapshot() {
        return { sessionId, agentId, queuedRuns: [] };
      },
      async loadRunByIdempotencyKey() {
        return { status: 'NOT_FOUND' };
      },
      async claimRun() {
        return { status: 'VERSION_CONFLICT' };
      },
      async listRecoverableRuns() {
        return [];
      },
      async commitTerminal(request): Promise<TerminalCommitRecordResult> {
        expect(request.runId).toBe(runId);
        expect(request.terminalMessage).toBe(terminalMessage);
        expect(request.terminalEvent).toBe(terminalEvent);
        expect(request.idempotencyKey).toBe(idempotencyKey);
        return committedResult;
      },
    };

    const firstCommit = await requestRunStore.commitTerminal(terminalRequest);
    const secondCommitResult: TerminalCommitRecordResult = { status: 'ALREADY_COMMITTED' };

    expect(firstCommit.status).toBe('COMMITTED');
    expect(firstCommit.terminalEvent?.type).toBe('REQUEST_COMPLETED');
    expect(secondCommitResult.status).toBe('ALREADY_COMMITTED');
    expect(requestRunStore.commitTerminal).toBeTypeOf('function');
  });

  it('TC_Contract_Gateway_Record_007 - Gateway Record不引用上层DO验证成功', async () => {
    const gatewaySource = await readFile(
      join(PACKAGE_ROOT, 'node_modules', '@nextagent', 'agent-contracts', 'dist', 'gateway', 'index.d.ts'),
      'utf8',
    );
    const sessionSource = await readFile(
      join(PACKAGE_ROOT, 'node_modules', '@nextagent', 'agent-contracts', 'dist', 'session', 'index.d.ts'),
      'utf8',
    );

    expect(gatewaySource).toContain('interface SessionRecord');
    expect(gatewaySource).toContain('interface SessionMessageRecord');
    expect(gatewaySource).toContain('interface RequestRunRecord');
    expect(gatewaySource).not.toContain('interface RequestContext');
    expect(gatewaySource).not.toContain('from "../runtime"');
    expect(gatewaySource).toContain('from "@nextagent/agent-common"');
    expect(sessionSource).toContain('interface SessionMessage');
    expect(sessionSource).toContain('interface UserSession');
  });

  it('TC_Contract_Model_Stream_008 - ModelGatewayPort契约stream normalization验证成功', async () => {
    const deltaContent: ModelStreamDelta = {
      content: 'Normalized delta content',
    };
    const deltaReasoning: ModelStreamDelta = {
      reasoning: 'Thinking content',
    };
    const deltaToolCall: ModelStreamDelta = {
      toolCall: {
        toolCallId: 'tool-stream-008',
        toolName: 'Read',
        arguments: { file_path: 'test.txt' },
      },
    };
    const deltaError: ModelStreamDelta = {
      safeError: createSafeErrorFixture(),
    };
    const finalResult: ModelFinalResult = {
      content: 'Final normalized content',
      finishReason: 'stop',
      usage: { inputTokens: 100, outputTokens: 50, totalTokens: 150 },
    };

    expect(deltaContent.content).toBe('Normalized delta content');
    expect(deltaReasoning.reasoning).toBe('Thinking content');
    expect(deltaToolCall.toolCall?.toolCallId).toBe('tool-stream-008');
    expect(deltaError.safeError?.code).toBe('TEST_SAFE_ERROR');
    expect(finalResult.finishReason).toBe('stop');
    expect(finalResult.usage?.totalTokens).toBe(150);
    expect(finalResult.safeError).toBeUndefined();
  });

  it('TC_Contract_Capability_Invoke_009 - CapabilityInvocationPort契约invocation request/result验证成功', async () => {
    const identity = createIdentityFixture();
    const agentId = brand<string, 'AgentId'>('agent-capability-invoke');
    const sessionId = brand<string, 'SessionId'>('session-contract-009');
    const requestId = brand<string, 'MessageId'>('request-contract-009');
    const runId = brand<string, 'RequestRunId'>('run-contract-009');
    const requestContextId = brand<string, 'RequestContextId'>('context-contract-009');
    const capabilityId = brand<string, 'CapabilityId'>('capability-contract-009');
    const invocationRequest: CapabilityInvocationRequest = {
      invocationId: 'invoke-contract-009',
      capabilityId,
      toolCallId: 'tool-call-009',
      arguments: { query: 'test' },
      sessionId,
      requestId,
      runId,
      requestContextId,
      stepId: 'step-009',
      identityContext: identity,
      agentId,
      agentVersion: brand<string, 'AgentVersion'>('v1'),
      timeoutMs: 5000,
    };
    const invocationResult: CapabilityInvocationResult = {
      status: 'SUCCEEDED',
      structuredPayload: { result: 'capability output' },
      generatedMessages: [],
      artifactRefs: [],
      metadata: { executionTime: 100 },
    };

    expect(invocationRequest.invocationId).toBe('invoke-contract-009');
    expect(invocationRequest.capabilityId).toBe(capabilityId);
    expect(invocationRequest.toolCallId).toBe('tool-call-009');
    expect(invocationRequest.timeoutMs).toBe(5000);
    expect(invocationRequest.identityContext.tenantId).toBe(identity.tenantId);
    expect(invocationResult.status).toBe('SUCCEEDED');
    expect(invocationResult.structuredPayload).toEqual({ result: 'capability output' });
    expect(invocationResult.artifactRefs).toHaveLength(0);
    expect(invocationResult.safeError).toBeUndefined();
  });

  it('TC_Contract_Runtime_Command_010 - RuntimeCommandPort契约command semantic验证成功', async () => {
    const identity = createIdentityFixture();
    const sessionId = brand<string, 'SessionId'>('session-contract-010');
    const idempotencyKey = brand<string, 'IdempotencyKey'>('idem-command-010');
    const submitCommand: SubmitRequestCommand = {
      sessionId,
      identityContext: identity,
      inputText: 'Contract command test',
      attachmentIds: [],
      locale: brand<string, 'RequestLocale'>('zh-CN'),
      idempotencyKey,
    };
    const cancelCommand: RequestControlCommand = {
      sessionId,
      identityContext: identity,
      expectedLatestRequestId: brand<string, 'MessageId'>('request-latest-010'),
      action: 'CANCEL',
      idempotencyKey,
    };
    const retryCommand: RequestControlCommand = {
      sessionId,
      identityContext: identity,
      expectedLatestRequestId: brand<string, 'MessageId'>('request-latest-010'),
      action: 'RETRY_LATEST',
      idempotencyKey: brand<string, 'IdempotencyKey'>('idem-retry-010'),
    };
    const runtimeCommandPort: RuntimeCommandPort = {
      async submit(command) {
        expect(command.sessionId).toBe(sessionId);
        expect(command.identityContext.tenantId).toBe(identity.tenantId);
        expect(command.idempotencyKey).toBe(idempotencyKey);
        return {
          sessionId,
          requestId: brand<string, 'MessageId'>('request-accepted-010'),
          runId: brand<string, 'RequestRunId'>('run-accepted-010'),
          attempt: 1,
        };
      },
      async cancel(command) {
        expect(command.action).toBe('CANCEL');
        return {
          sessionId,
          targetRequestId: command.expectedLatestRequestId,
          action: 'CANCEL',
          idempotencyKey: command.idempotencyKey,
        };
      },
      async retryLatest(command) {
        expect(command.action).toBe('RETRY_LATEST');
        return {
          sessionId,
          requestId: brand<string, 'MessageId'>('request-retry-010'),
          runId: brand<string, 'RequestRunId'>('run-retry-010'),
          attempt: 2,
        };
      },
      async editLatest() {
        return {
          sessionId,
          requestId: brand<string, 'MessageId'>('request-edit-010'),
          runId: brand<string, 'RequestRunId'>('run-edit-010'),
          attempt: 1,
        };
      },
      async answerPendingInput() {
        return {
          sessionId,
          pendingInputId: brand<string, 'PendingInputId'>('pending-010'),
          status: 'RECEIVED',
        };
      },
    };

    const submitResult = await runtimeCommandPort.submit(submitCommand);
    const cancelResult = await runtimeCommandPort.cancel(cancelCommand);
    const retryResult = await runtimeCommandPort.retryLatest(retryCommand);

    expect(submitResult.sessionId).toBe(sessionId);
    expect(submitResult.attempt).toBe(1);
    expect(cancelResult.action).toBe('CANCEL');
    expect(cancelResult.idempotencyKey).toBe(idempotencyKey);
    expect(retryResult.attempt).toBe(2);
    expect(runtimeCommandPort.submit).toBeTypeOf('function');
    expect(runtimeCommandPort.cancel).toBeTypeOf('function');
    expect(runtimeCommandPort.retryLatest).toBeTypeOf('function');
  });

  it('TC_Contract_Agent_State_011 - AgentRunStatePort契约run state write验证成功', async () => {
    const identity = createIdentityFixture();
    const agentId = brand<string, 'AgentId'>('agent-state-011');
    const sessionId = brand<string, 'SessionId'>('session-contract-011');
    const requestId = brand<string, 'MessageId'>('request-contract-011');
    const runId = brand<string, 'RequestRunId'>('run-contract-011');
    const requestContextId = brand<string, 'RequestContextId'>('context-contract-011');
    const now = brand<number, 'EpochMillis'>(100);
    const run: RequestRun = {
      runId,
      sessionId,
      requestId,
      agentId,
      agentVersion: brand<string, 'AgentVersion'>('v1'),
      agentAssemblyRef: 'agent-state-011:v1',
      attempt: 1,
      status: 'EXECUTING',
      version: 1,
      terminalCommitState: 'NOT_STARTED',
      createdAt: now,
      updatedAt: now,
    };
    const context: RequestContext = {
      requestContextId,
      sessionId,
      requestId,
      runId,
      identityContext: identity,
      locale: brand<string, 'RequestLocale'>('zh-CN'),
      agentId,
      agentVersion: brand<string, 'AgentVersion'>('v1'),
      agentAssemblyRef: 'agent-state-011:v1',
      nextLifecycleStage: 'BEFORE_MODEL_INVOKE',
      toolCallStates: [],
      flowVariables: {},
    };
    const emittedEvents: unknown[] = [];
    const appendedMessages: unknown[] = [];
    const checkpointReasons: string[] = [];
    const runStatePort: AgentRunStatePort = {
      async emitEvent(portRun, portContext, event) {
        expect(portRun.runId).toBe(runId);
        expect(portContext.requestContextId).toBe(requestContextId);
        expect(portRun.agentId).toBe(agentId);
        expect(portContext.identityContext.tenantId).toBe(identity.tenantId);
        emittedEvents.push({ run: portRun, context: portContext, event });
      },
      async appendMessage(portRun, portContext, draft) {
        expect(portRun.runId).toBe(runId);
        expect(portContext.sessionId).toBe(sessionId);
        appendedMessages.push({ run: portRun, context: portContext, draft });
        return brand<string, 'MessageId'>('message-state-011');
      },
      async saveCheckpoint(portRun, portContext, triggerReason) {
        expect(portRun.runId).toBe(runId);
        expect(portContext.requestContextId).toBe(requestContextId);
        checkpointReasons.push(triggerReason);
      },
      async requestPendingInput() {
        throw new Error('not used');
      },
    };
    const timelineEvent: RunTimelineEvent = {
      type: 'LLM_CONTENT_DELTA',
      inlinePayload: { chunk: 'state test' },
    };
    const messageDraft: SessionMessageDraft = {
      role: 'ASSISTANT',
      content: 'State test message',
      contentType: 'PLAIN_TEXT',
      visible: true,
      idempotencyKey: brand<string, 'IdempotencyKey'>('idem-state-011'),
    };

    await runStatePort.emitEvent(run, context, timelineEvent);
    await runStatePort.appendMessage(run, context, messageDraft);
    await runStatePort.saveCheckpoint(run, context, 'CAPABILITY_BEFORE_CALL');

    expect(emittedEvents).toHaveLength(1);
    expect(appendedMessages).toHaveLength(1);
    expect(checkpointReasons).toEqual(['CAPABILITY_BEFORE_CALL']);
    expect(emittedEvents[0]).toMatchObject({ event: timelineEvent });
    expect(runStatePort.emitEvent).toBeTypeOf('function');
    expect(runStatePort.appendMessage).toBeTypeOf('function');
    expect(runStatePort.saveCheckpoint).toBeTypeOf('function');
    expect(runStatePort.requestPendingInput).toBeTypeOf('function');
  });
});
