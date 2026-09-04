import { createTestModelSelectionService } from './test-model-selection-helpers.js';
import { DefaultContextEngine } from '@nextagent/agent-context-engine';
import { AgentError, brand, type JsonObject, type MessageId } from '@nextagent/agent-common';
import { createAttachmentCleanupRuntime } from '@nextagent/agent-attachment-runtime';
import type { BlobStoreGateway } from '@nextagent/agent-contracts/gateway';
import type { AgentAssembly, AgentAssemblyRegistry } from '@nextagent/agent-contracts/agent-assembly';
import type { CapabilityCatalog } from '@nextagent/agent-contracts/capability';
import type {
  ActiveContextItemRecord,
  ActiveContextStateRecord,
  ActiveContextStoreGateway,
  ActiveContextViewRecord,
  AttachmentStoreGateway,
  RequestAttachmentRecord,
  SessionMessageRecord,
  SessionMessageStoreGateway,
} from '@nextagent/agent-contracts/gateway';
import { describe, expect, it } from 'vitest';

const TENANT = brand<string, 'TenantId'>('tenant-attachment-context');
const SUBJECT = brand<string, 'SubjectId'>('subject-attachment-context');
const AGENT = brand<string, 'AgentId'>('agent-attachment-context');
const AGENT_V = brand<string, 'AgentVersion'>('v1');
const SESSION = brand<string, 'SessionId'>('session-attachment-context');

function msgId(name: string): MessageId {
  return brand<string, 'MessageId'>(name);
}

function userMsg(messageId: string, requestId = messageId, content = 'request'): SessionMessageRecord {
  return {
    tenantId: TENANT,
    subjectId: SUBJECT,
    agentId: AGENT,
    messageId: msgId(messageId),
    sessionId: SESSION,
    requestId: msgId(requestId),
    runId: brand<string, 'RequestRunId'>('run-attachment-context'),
    role: 'USER',
    content,
    contentType: 'PLAIN_TEXT',
    metadata: { attachmentIds: [brand<string, 'AttachmentId'>('attachment-markdown')] } satisfies JsonObject,
    visible: true,
    createdAt: brand<number, 'EpochMillis'>(1),
  };
}

function activeContextView(messageIds: readonly string[]): ActiveContextViewRecord {
  const state: ActiveContextStateRecord = {
    tenantId: TENANT,
    subjectId: SUBJECT,
    agentId: AGENT,
    sessionId: SESSION,
    activeContextVersion: 1,
    updatedAt: brand<number, 'EpochMillis'>(1),
  };
  const items: readonly ActiveContextItemRecord[] = messageIds.map((id, ordinal) => ({
    tenantId: TENANT,
    subjectId: SUBJECT,
    agentId: AGENT,
    sessionId: SESSION,
    ordinal,
    messageId: msgId(id),
  }));
  return { state, items };
}

function makeAssembly(): AgentAssembly {
  return {
    agentId: AGENT,
    agentType: brand<string, 'AgentType'>('default'),
    agentVersion: AGENT_V,
    agentAssemblyRef: 'agent-attachment-context:v1',
    displayName: 'Attachment context test agent',
    description: 'attachment request context flow test agent',
    workspacePolicy: {
      schemaVersion: 'nextagent.agent-workspace-policy.v1',
      isolationMode: 'subject',
      roots: [],
    },
    modelIds: ['default'],
    capabilityBindings: [],
    userInvocable: true,
    agentInvocation: 'BOUND',
    runtimeSettings: { maxContextMessages: 20 },
  };
}

function makeEngine(opts: {
  readonly attachmentStore: AttachmentStoreGateway;
  readonly messages?: readonly SessionMessageRecord[];
  readonly activeContextMessageIds?: readonly string[];
}): DefaultContextEngine {
  const messagesMap = new Map<string, SessionMessageRecord>();
  for (const message of opts.messages ?? []) {
    messagesMap.set(message.messageId, message);
  }
  const activeContextStore: ActiveContextStoreGateway = {
    async loadActiveContext() {
      return activeContextView(opts.activeContextMessageIds ?? ['current-request']);
    },
    async updateMetadata() {
      return { status: 'UPDATED', record: activeContextView(opts.activeContextMessageIds ?? ['current-request']) };
    },
    async appendItem() {
      throw new Error('unused');
    },
    async commitCompaction() {
      throw new Error('unused');
    },
  };
  const messageStore: SessionMessageStoreGateway = {
    async loadMessage(request) {
      return messagesMap.get(request.messageId);
    },
    async loadMessages(request) {
      return request.messageIds.flatMap((messageId) => {
        const record = messagesMap.get(messageId);
        return record === undefined ? [] : [record];
      });
    },
    async appendSessionMessage() {
      throw new Error('unused');
    },
    async listConversationPreview() {
      throw new Error('unused');
    },
    async listMessages() {
      throw new Error('unused');
    },
    async listCurrentRequestMessages() {
      throw new Error('unused');
    },
    async hideMessage() {
      throw new Error('unused');
    },
    async hideRequestMessages() {
      throw new Error('unused');
    },
  };
  const assemblyRegistry: AgentAssemblyRegistry = {
    async active() {
      return makeAssembly();
    },
    async require() {
      return makeAssembly();
    },
  };
  const capabilityCatalog: CapabilityCatalog = {
    async listAvailable() {
      return [];
    },
    async resolve() {
      return undefined;
    },
  };
  return new DefaultContextEngine({
    activeContextStore,
    messageStore,
    attachmentStore: opts.attachmentStore,
    assemblyRegistry,
    capabilityCatalog,
    modelSelectionService: createTestModelSelectionService(),
  });
}

describe('attachment request context flow', () => {
  it('treats current request Markdown attachment as critical and exposes safe attachment evidence', async () => {
    const attachment: RequestAttachmentRecord = {
      tenantId: TENANT,
      subjectId: SUBJECT,
      agentId: AGENT,
      attachmentId: brand<string, 'AttachmentId'>('attachment-markdown'),
      sessionId: SESSION,
      requestId: msgId('current-request'),
      runId: brand<string, 'RequestRunId'>('run-attachment-context'),
      fileName: 'field-notes.md',
      mediaType: 'MARKDOWN',
      sizeBytes: 42,
      validationStatus: 'ACCEPTED',
      availabilityStatus: 'AVAILABLE',
      storageRef: brand<string, 'BlobRef'>('blob-attachment-context'),
      createdAt: brand<number, 'EpochMillis'>(1),
    };
    const engine = makeEngine({
      messages: [userMsg('current-request')],
      attachmentStore: {
        async saveAttachment() {
          return attachment;
        },
        async loadAttachment() {
          return attachment;
        },
        async listAttachmentsByRequestId() {
          return [attachment];
        },
        async listAttachmentsByRunId() {
          return [attachment];
        },
        async listAttachmentsBySession() {
          return [attachment];
        },
        async updateAttachmentStatus() {
          return attachment;
        },
      },
    });

    const assembly = await engine.assemble(
      {
        sessionId: SESSION,
        requestId: msgId('current-request'),
        requestContextId: brand<string, 'RequestContextId'>('rc-attachment-context'),
        identityContext: { tenantId: TENANT, subjectId: SUBJECT, displayName: 'attachment tester' },
        agentId: AGENT,
        agentVersion: AGENT_V,
        runId: brand<string, 'RequestRunId'>('run-attachment-context'),
        stepId: 'turn-1',
        locale: brand<string, 'RequestLocale'>('zh-CN'),
        purpose: 'attachment-test',
      },
      undefined,
      new AbortController().signal,
    );

    expect(assembly.attachmentEvidence?.map((item) => item.decision)).toContain('latest-request-critical');
    expect(JSON.stringify(assembly)).not.toContain('BlobRef');
    expect(JSON.stringify(assembly)).not.toContain('blob-attachment-context');
  });

  it('projects current request Markdown attachment content into model-visible input', async () => {
    const attachment: RequestAttachmentRecord = {
      tenantId: TENANT,
      subjectId: SUBJECT,
      agentId: AGENT,
      attachmentId: brand<string, 'AttachmentId'>('attachment-markdown'),
      sessionId: SESSION,
      requestId: msgId('current-request'),
      runId: brand<string, 'RequestRunId'>('run-attachment-context'),
      fileName: 'field-notes.md',
      mediaType: 'MARKDOWN',
      sizeBytes: 24,
      validationStatus: 'ACCEPTED',
      availabilityStatus: 'AVAILABLE',
      storageRef: brand<string, 'BlobRef'>('blob-attachment-context'),
      createdAt: brand<number, 'EpochMillis'>(1),
    };
    const blobStore: BlobStoreGateway = {
      async loadBlob(request) {
        expect(request.blobRef).toBe(attachment.storageRef);
        return new TextEncoder().encode('# attachment\ncontent\n');
      },
      async storeBlob() {
        throw new Error('unused');
      },
      async materializeBlob() {
        return false;
      },
      async blobExists() {
        return true;
      },
      async deleteBlob() {
        return false;
      },
      async copyBlob() {
        return { blobRef: 'copy-blob' as never, etag: 'copy-etag', lastModified: 0 as never };
      },
      async getBlobMetadata() {
        return undefined;
      },
      async listBlobs() {
        return { blobs: [], truncated: false };
      },
    };
    const engine = new DefaultContextEngine({
      activeContextStore: {
        async loadActiveContext() {
          return activeContextView(['current-request']);
        },
        async updateMetadata() {
          return { status: 'UPDATED' as const, record: activeContextView(['current-request']) };
        },
        async appendItem() {
          throw new Error('unused');
        },
        async commitCompaction() {
          throw new Error('unused');
        },
      },
      messageStore: {
        async loadMessage(request) {
          return request.messageId === msgId('current-request') ? userMsg('current-request') : undefined;
        },
        async loadMessages() {
          return [userMsg('current-request')];
        },
        async appendSessionMessage() {
          throw new Error('unused');
        },
        async listConversationPreview() {
          throw new Error('unused');
        },
        async listMessages() {
          throw new Error('unused');
        },
        async listCurrentRequestMessages() {
          throw new Error('unused');
        },
        async hideMessage() {
          throw new Error('unused');
        },
        async hideRequestMessages() {
          throw new Error('unused');
        },
      },
      attachmentStore: {
        async saveAttachment() {
          return attachment;
        },
        async loadAttachment() {
          return attachment;
        },
        async listAttachmentsByRequestId() {
          return [attachment];
        },
        async listAttachmentsByRunId() {
          return [attachment];
        },
        async listAttachmentsBySession() {
          return [attachment];
        },
        async updateAttachmentStatus() {
          return attachment;
        },
      },
      blobStore,
      assemblyRegistry: {
        async active() {
          return makeAssembly();
        },
        async require() {
          return makeAssembly();
        },
      },
      capabilityCatalog: {
        async listAvailable() {
          return [];
        },
        async resolve() {
          return undefined;
        },
      },
      modelSelectionService: createTestModelSelectionService({ modelId: 'test-model', contextWindowTokens: 128_000 }),
    });

    const assembly = await engine.assemble(
      {
        sessionId: SESSION,
        requestId: msgId('current-request'),
        requestContextId: brand<string, 'RequestContextId'>('rc-attachment-context'),
        identityContext: { tenantId: TENANT, subjectId: SUBJECT, displayName: 'attachment tester' },
        agentId: AGENT,
        agentVersion: AGENT_V,
        runId: brand<string, 'RequestRunId'>('run-attachment-context'),
        stepId: 'turn-1',
        locale: brand<string, 'RequestLocale'>('zh-CN'),
        purpose: 'attachment-test',
      },
      undefined,
      new AbortController().signal,
    );

    const rendered = await engine.render(assembly);
    const renderedText = JSON.stringify(rendered);
    expect(renderedText).toContain('field-notes.md');
    expect(renderedText).toContain('MARKDOWN');
    expect(renderedText).not.toContain('# attachment');
    expect(renderedText).not.toContain('BlobRef');
  });

  it('fails explicitly when a critical current-request attachment is unavailable', async () => {
    const attachment: RequestAttachmentRecord = {
      tenantId: TENANT,
      subjectId: SUBJECT,
      agentId: AGENT,
      attachmentId: brand<string, 'AttachmentId'>('attachment-markdown'),
      sessionId: SESSION,
      requestId: msgId('current-request'),
      runId: brand<string, 'RequestRunId'>('run-attachment-context'),
      fileName: 'field-notes.md',
      mediaType: 'MARKDOWN',
      sizeBytes: 42,
      validationStatus: 'ACCEPTED',
      availabilityStatus: 'UNAVAILABLE',
      storageRef: brand<string, 'BlobRef'>('blob-attachment-context'),
      createdAt: brand<number, 'EpochMillis'>(1),
    };
    const engine = makeEngine({
      messages: [userMsg('current-request')],
      attachmentStore: {
        async saveAttachment() {
          return attachment;
        },
        async loadAttachment() {
          return attachment;
        },
        async listAttachmentsByRequestId() {
          return [attachment];
        },
        async listAttachmentsByRunId() {
          return [attachment];
        },
        async listAttachmentsBySession() {
          return [attachment];
        },
        async updateAttachmentStatus() {
          return attachment;
        },
      },
    });

    await expect(
      engine.assemble(
        {
          sessionId: SESSION,
          requestId: msgId('current-request'),
          requestContextId: brand<string, 'RequestContextId'>('rc-attachment-context'),
          identityContext: { tenantId: TENANT, subjectId: SUBJECT, displayName: 'attachment tester' },
          agentId: AGENT,
          agentVersion: AGENT_V,
          runId: brand<string, 'RequestRunId'>('run-attachment-context'),
          stepId: 'turn-1',
          locale: brand<string, 'RequestLocale'>('zh-CN'),
          purpose: 'attachment-test',
        },
        undefined,
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({
      code: 'CONTEXT_INSUFFICIENT_BUDGET',
    });
  });

  it('reads a cleanup-converged unavailable attachment fact and fails explicitly', async () => {
    let attachment: RequestAttachmentRecord = {
      tenantId: TENANT,
      subjectId: SUBJECT,
      agentId: AGENT,
      attachmentId: brand<string, 'AttachmentId'>('attachment-cleanup'),
      sessionId: SESSION,
      requestId: msgId('current-request'),
      runId: brand<string, 'RequestRunId'>('run-attachment-context'),
      fileName: 'field-notes.md',
      mediaType: 'MARKDOWN',
      sizeBytes: 42,
      validationStatus: 'ACCEPTED',
      availabilityStatus: 'AVAILABLE',
      storageRef: brand<string, 'BlobRef'>('blob-attachment-cleanup'),
      createdAt: brand<number, 'EpochMillis'>(1),
    };
    const attachmentStore = {
      async saveAttachment(record: RequestAttachmentRecord) {
        attachment = record;
        return attachment;
      },
      async loadAttachment() {
        return attachment;
      },
      async listAttachmentsByRequestId() {
        return [attachment];
      },
      async listAttachmentsByRunId() {
        return [attachment];
      },
      async listAttachmentsBySession() {
        return [attachment];
      },
      async updateAttachmentStatus(request: {
        readonly attachmentId: RequestAttachmentRecord['attachmentId'];
        readonly validationStatus: RequestAttachmentRecord['validationStatus'];
        readonly availabilityStatus: RequestAttachmentRecord['availabilityStatus'];
      }) {
        attachment = {
          ...attachment,
          validationStatus: request.validationStatus,
          availabilityStatus: request.availabilityStatus,
        };
        return attachment;
      },
    } satisfies AttachmentStoreGateway;
    const cleanupRuntime = createAttachmentCleanupRuntime({
      attachmentStore,
      blobStore: {
        async storeBlob() {
          return attachment.storageRef;
        },
        async loadBlob() {
          return new Uint8Array();
        },
        async materializeBlob() {
          return false;
        },
        async blobExists() {
          return true;
        },
        async deleteBlob() {
          return true;
        },
        async copyBlob() {
          return { blobRef: 'copy-blob' as never, etag: 'copy-etag', lastModified: 0 as never };
        },
        async getBlobMetadata() {
          return undefined;
        },
        async listBlobs() {
          return { blobs: [], truncated: false };
        },
      },
    });
    await cleanupRuntime.cleanup({
      identityContext: { tenantId: TENANT, subjectId: SUBJECT, displayName: 'cleanup tester' },
      agentId: AGENT,
      reasonCode: 'EXPLICIT_UNAVAILABLE',
      attachmentIds: [attachment.attachmentId],
    });
    const engine = makeEngine({
      messages: [userMsg('current-request')],
      attachmentStore,
    });

    await expect(
      engine.assemble(
        {
          sessionId: SESSION,
          requestId: msgId('current-request'),
          requestContextId: brand<string, 'RequestContextId'>('rc-attachment-context'),
          identityContext: { tenantId: TENANT, subjectId: SUBJECT, displayName: 'attachment tester' },
          agentId: AGENT,
          agentVersion: AGENT_V,
          runId: brand<string, 'RequestRunId'>('run-attachment-context'),
          stepId: 'turn-1',
          locale: brand<string, 'RequestLocale'>('zh-CN'),
          purpose: 'attachment-test',
        },
        undefined,
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({
      code: 'CONTEXT_INSUFFICIENT_BUDGET',
      safeDetails: { reasonCode: 'ATTACHMENT_LATEST_REQUIRED_FAILED' },
    });
    expect(attachment.availabilityStatus).toBe('UNAVAILABLE');
  });

  it('degrades historical attachment read failures with bounded evidence instead of failing closed', async () => {
    const historicalAttachment: RequestAttachmentRecord = {
      tenantId: TENANT,
      subjectId: SUBJECT,
      agentId: AGENT,
      attachmentId: brand<string, 'AttachmentId'>('attachment-history'),
      sessionId: SESSION,
      requestId: msgId('prior-request'),
      runId: brand<string, 'RequestRunId'>('run-attachment-context'),
      fileName: 'history.pdf',
      mediaType: 'PDF',
      sizeBytes: 900,
      validationStatus: 'ACCEPTED',
      availabilityStatus: 'AVAILABLE',
      storageRef: brand<string, 'BlobRef'>('blob-history'),
      createdAt: brand<number, 'EpochMillis'>(1),
    };
    const priorRequestId = msgId('prior-request');
    const engine = makeEngine({
      messages: [
        {
          ...userMsg('current-request'),
          metadata: {},
        },
        {
          tenantId: TENANT,
          subjectId: SUBJECT,
          agentId: AGENT,
          messageId: msgId('prior-user'),
          sessionId: SESSION,
          requestId: priorRequestId,
          runId: brand<string, 'RequestRunId'>('run-attachment-context'),
          role: 'USER',
          content: 'prior request',
          contentType: 'PLAIN_TEXT',
          // Mirror rootUserMessageMetadata (agent-runtime/lifecycle/submit.ts):
          // a turn that uploaded attachments stamps its USER message metadata
          // with attachmentIds. The metadata-gated attachment read in
          // collectAttachmentEvidence skips turns without this key, so the
          // fixture must mark attachment-bearing turns just as production does.
          metadata: { attachmentIds: [brand<string, 'AttachmentId'>('attachment-history')] },
          visible: true,
          createdAt: brand<number, 'EpochMillis'>(1),
        },
        {
          tenantId: TENANT,
          subjectId: SUBJECT,
          agentId: AGENT,
          messageId: msgId('prior-assistant'),
          sessionId: SESSION,
          requestId: priorRequestId,
          runId: brand<string, 'RequestRunId'>('run-attachment-context'),
          role: 'ASSISTANT',
          content: JSON.stringify({ text: 'ok' }),
          contentType: 'PLAIN_TEXT',
          metadata: {},
          visible: true,
          createdAt: brand<number, 'EpochMillis'>(2),
        },
      ],
      activeContextMessageIds: ['prior-user', 'prior-assistant', 'current-request'],
      attachmentStore: {
        async saveAttachment() {
          return historicalAttachment;
        },
        async loadAttachment() {
          return historicalAttachment;
        },
        async listAttachmentsByRequestId(request) {
          if (request.requestId === priorRequestId) {
            throw new Error('historical attachment store unavailable');
          }
          return [];
        },
        async listAttachmentsByRunId() {
          return [];
        },
        async listAttachmentsBySession() {
          return [];
        },
        async updateAttachmentStatus() {
          return historicalAttachment;
        },
      },
    });

    const assembly = await engine.assemble(
      {
        sessionId: SESSION,
        requestId: msgId('current-request'),
        requestContextId: brand<string, 'RequestContextId'>('rc-attachment-context'),
        identityContext: { tenantId: TENANT, subjectId: SUBJECT, displayName: 'attachment tester' },
        agentId: AGENT,
        agentVersion: AGENT_V,
        runId: brand<string, 'RequestRunId'>('run-attachment-context'),
        stepId: 'turn-1',
        locale: brand<string, 'RequestLocale'>('zh-CN'),
        purpose: 'attachment-test',
      },
      undefined,
      new AbortController().signal,
    );

    expect(assembly.attachmentDegradationEvidence?.map((item) => item.safeReasonCode)).toContain('ATTACHMENT_HISTORICAL_DEGRADED');
    expect(JSON.stringify(assembly)).not.toContain('BlobRef');
    expect(JSON.stringify(assembly)).not.toContain('blob-history');
  });

  it('exposes a readable modelPath for available historical attachments without degrading', async () => {
    const historicalAttachment: RequestAttachmentRecord = {
      tenantId: TENANT,
      subjectId: SUBJECT,
      agentId: AGENT,
      attachmentId: brand<string, 'AttachmentId'>('attachment-history-readable'),
      sessionId: SESSION,
      requestId: msgId('prior-request-readable'),
      runId: brand<string, 'RequestRunId'>('run-attachment-context'),
      fileName: 'history.md',
      mediaType: 'MARKDOWN',
      sizeBytes: 900,
      validationStatus: 'ACCEPTED',
      availabilityStatus: 'AVAILABLE',
      storageRef: brand<string, 'BlobRef'>('blob-history-readable'),
      createdAt: brand<number, 'EpochMillis'>(1),
    };
    const priorRequestId = msgId('prior-request-readable');
    const engine = makeEngine({
      messages: [
        {
          ...userMsg('current-request'),
          metadata: {},
        },
        {
          tenantId: TENANT,
          subjectId: SUBJECT,
          agentId: AGENT,
          messageId: msgId('prior-user-readable'),
          sessionId: SESSION,
          requestId: priorRequestId,
          runId: brand<string, 'RequestRunId'>('run-attachment-context'),
          role: 'USER',
          content: 'prior request',
          contentType: 'PLAIN_TEXT',
          // Mirror rootUserMessageMetadata (agent-runtime/lifecycle/submit.ts):
          // a turn that uploaded attachments stamps its USER message metadata
          // with attachmentIds. The metadata-gated attachment read in
          // collectAttachmentEvidence skips turns without this key, so the
          // fixture must mark attachment-bearing turns just as production does.
          metadata: { attachmentIds: [brand<string, 'AttachmentId'>('attachment-history-readable')] },
          visible: true,
          createdAt: brand<number, 'EpochMillis'>(1),
        },
        {
          tenantId: TENANT,
          subjectId: SUBJECT,
          agentId: AGENT,
          messageId: msgId('prior-assistant-readable'),
          sessionId: SESSION,
          requestId: priorRequestId,
          runId: brand<string, 'RequestRunId'>('run-attachment-context'),
          role: 'ASSISTANT',
          content: JSON.stringify({ text: 'ok' }),
          contentType: 'PLAIN_TEXT',
          metadata: {},
          visible: true,
          createdAt: brand<number, 'EpochMillis'>(2),
        },
      ],
      activeContextMessageIds: ['prior-user-readable', 'prior-assistant-readable', 'current-request'],
      attachmentStore: {
        async saveAttachment() {
          return historicalAttachment;
        },
        async loadAttachment() {
          return historicalAttachment;
        },
        async listAttachmentsByRequestId(request) {
          return request.requestId === priorRequestId ? [historicalAttachment] : [];
        },
        async listAttachmentsByRunId() {
          return [];
        },
        async listAttachmentsBySession() {
          return [historicalAttachment];
        },
        async updateAttachmentStatus() {
          return historicalAttachment;
        },
      },
    });

    const assembly = await engine.assemble(
      {
        sessionId: SESSION,
        requestId: msgId('current-request'),
        requestContextId: brand<string, 'RequestContextId'>('rc-attachment-context'),
        identityContext: { tenantId: TENANT, subjectId: SUBJECT, displayName: 'attachment tester' },
        agentId: AGENT,
        agentVersion: AGENT_V,
        runId: brand<string, 'RequestRunId'>('run-attachment-context'),
        stepId: 'turn-1',
        locale: brand<string, 'RequestLocale'>('zh-CN'),
        purpose: 'attachment-test',
      },
      undefined,
      new AbortController().signal,
    );

    const historicalEvidence = assembly.attachmentEvidence?.find((e) => e.attachmentId === historicalAttachment.attachmentId);
    expect(historicalEvidence?.modelPath).toBe('temp/attachments/attachment-history-readable/history.md');
    expect(assembly.attachmentDegradationEvidence?.map((item) => item.safeReasonCode)).not.toContain('ATTACHMENT_HISTORICAL_DEGRADED');
    expect(JSON.stringify(assembly)).not.toContain('blob-history-readable');
  });

  it('degrades unavailable historical attachments to metadata-only without a modelPath', async () => {
    const unavailableHistoricalAttachment: RequestAttachmentRecord = {
      tenantId: TENANT,
      subjectId: SUBJECT,
      agentId: AGENT,
      attachmentId: brand<string, 'AttachmentId'>('attachment-history-unavailable'),
      sessionId: SESSION,
      requestId: msgId('prior-request-unavailable'),
      runId: brand<string, 'RequestRunId'>('run-attachment-context'),
      fileName: 'history-unavailable.md',
      mediaType: 'MARKDOWN',
      sizeBytes: 900,
      validationStatus: 'ACCEPTED',
      availabilityStatus: 'UNAVAILABLE',
      storageRef: brand<string, 'BlobRef'>('blob-history-unavailable'),
      createdAt: brand<number, 'EpochMillis'>(1),
    };
    const priorRequestId = msgId('prior-request-unavailable');
    const engine = makeEngine({
      messages: [
        {
          ...userMsg('current-request'),
          metadata: {},
        },
        {
          tenantId: TENANT,
          subjectId: SUBJECT,
          agentId: AGENT,
          messageId: msgId('prior-user-unavailable'),
          sessionId: SESSION,
          requestId: priorRequestId,
          runId: brand<string, 'RequestRunId'>('run-attachment-context'),
          role: 'USER',
          content: 'prior request',
          contentType: 'PLAIN_TEXT',
          // Mirror rootUserMessageMetadata (agent-runtime/lifecycle/submit.ts):
          // a turn that uploaded attachments stamps its USER message metadata
          // with attachmentIds. The metadata-gated attachment read in
          // collectAttachmentEvidence skips turns without this key, so the
          // fixture must mark attachment-bearing turns just as production does.
          metadata: { attachmentIds: [brand<string, 'AttachmentId'>('attachment-history-unavailable')] },
          visible: true,
          createdAt: brand<number, 'EpochMillis'>(1),
        },
        {
          tenantId: TENANT,
          subjectId: SUBJECT,
          agentId: AGENT,
          messageId: msgId('prior-assistant-unavailable'),
          sessionId: SESSION,
          requestId: priorRequestId,
          runId: brand<string, 'RequestRunId'>('run-attachment-context'),
          role: 'ASSISTANT',
          content: JSON.stringify({ text: 'ok' }),
          contentType: 'PLAIN_TEXT',
          metadata: {},
          visible: true,
          createdAt: brand<number, 'EpochMillis'>(2),
        },
      ],
      activeContextMessageIds: ['prior-user-unavailable', 'prior-assistant-unavailable', 'current-request'],
      attachmentStore: {
        async saveAttachment() {
          return unavailableHistoricalAttachment;
        },
        async loadAttachment() {
          return unavailableHistoricalAttachment;
        },
        async listAttachmentsByRequestId(request) {
          return request.requestId === priorRequestId ? [unavailableHistoricalAttachment] : [];
        },
        async listAttachmentsByRunId() {
          return [];
        },
        async listAttachmentsBySession() {
          return [unavailableHistoricalAttachment];
        },
        async updateAttachmentStatus() {
          return unavailableHistoricalAttachment;
        },
      },
    });

    const assembly = await engine.assemble(
      {
        sessionId: SESSION,
        requestId: msgId('current-request'),
        requestContextId: brand<string, 'RequestContextId'>('rc-attachment-context'),
        identityContext: { tenantId: TENANT, subjectId: SUBJECT, displayName: 'attachment tester' },
        agentId: AGENT,
        agentVersion: AGENT_V,
        runId: brand<string, 'RequestRunId'>('run-attachment-context'),
        stepId: 'turn-1',
        locale: brand<string, 'RequestLocale'>('zh-CN'),
        purpose: 'attachment-test',
      },
      undefined,
      new AbortController().signal,
    );

    const historicalEvidence = assembly.attachmentEvidence?.find((e) => e.attachmentId === unavailableHistoricalAttachment.attachmentId);
    expect(historicalEvidence?.modelPath).toBeUndefined();
    expect(assembly.attachmentDegradationEvidence?.map((item) => item.safeReasonCode)).toContain('ATTACHMENT_HISTORICAL_DEGRADED');
    expect(JSON.stringify(assembly)).not.toContain('blob-history-unavailable');
  });

  it('keeps non-Markdown current-request attachments as metadata-only evidence', async () => {
    const attachment: RequestAttachmentRecord = {
      tenantId: TENANT,
      subjectId: SUBJECT,
      agentId: AGENT,
      attachmentId: brand<string, 'AttachmentId'>('attachment-pdf'),
      sessionId: SESSION,
      requestId: msgId('current-request'),
      runId: brand<string, 'RequestRunId'>('run-attachment-context'),
      fileName: 'report.pdf',
      mediaType: 'PDF',
      sizeBytes: 2048,
      validationStatus: 'ACCEPTED',
      availabilityStatus: 'AVAILABLE',
      storageRef: brand<string, 'BlobRef'>('blob-pdf'),
      createdAt: brand<number, 'EpochMillis'>(1),
    };
    const engine = makeEngine({
      messages: [
        {
          ...userMsg('current-request'),
          metadata: { attachmentIds: [attachment.attachmentId] } satisfies JsonObject,
        },
      ],
      attachmentStore: {
        async saveAttachment() {
          return attachment;
        },
        async loadAttachment() {
          return attachment;
        },
        async listAttachmentsByRequestId() {
          return [attachment];
        },
        async listAttachmentsByRunId() {
          return [attachment];
        },
        async listAttachmentsBySession() {
          return [attachment];
        },
        async updateAttachmentStatus() {
          return attachment;
        },
      },
    });

    const assembly = await engine.assemble(
      {
        sessionId: SESSION,
        requestId: msgId('current-request'),
        requestContextId: brand<string, 'RequestContextId'>('rc-attachment-context'),
        identityContext: { tenantId: TENANT, subjectId: SUBJECT, displayName: 'attachment tester' },
        agentId: AGENT,
        agentVersion: AGENT_V,
        runId: brand<string, 'RequestRunId'>('run-attachment-context'),
        stepId: 'turn-1',
        locale: brand<string, 'RequestLocale'>('zh-CN'),
        purpose: 'attachment-test',
      },
      undefined,
      new AbortController().signal,
    );

    expect(assembly.attachmentContentBlocks).toEqual([]);
    expect(assembly.attachmentEvidence?.[0]).toMatchObject({ fileName: 'report.pdf', mediaType: 'PDF', sizeBytes: 2048 });
    expect(JSON.stringify(assembly)).not.toContain('blob-pdf');
  });

  it('degrades current-request attachments only when an equivalent controlled replacement is retained', async () => {
    const attachment: RequestAttachmentRecord = {
      tenantId: TENANT,
      subjectId: SUBJECT,
      agentId: AGENT,
      attachmentId: brand<string, 'AttachmentId'>('attachment-pdf'),
      sessionId: SESSION,
      requestId: msgId('current-request'),
      runId: brand<string, 'RequestRunId'>('run-attachment-context'),
      fileName: 'report.pdf',
      mediaType: 'PDF',
      sizeBytes: 2048,
      validationStatus: 'ACCEPTED',
      availabilityStatus: 'AVAILABLE',
      storageRef: brand<string, 'BlobRef'>('blob-pdf'),
      createdAt: brand<number, 'EpochMillis'>(1),
    };
    const engine = makeEngine({
      messages: [
        {
          ...userMsg('current-request'),
          metadata: {
            attachmentIds: [attachment.attachmentId],
            replacement: {
              kind: 'PERSISTED_PREVIEW',
              reason: 'controlled-markdown-retained',
              originalSize: 2048,
              previewSize: 128,
              contentRef: null,
              attachmentId: attachment.attachmentId,
            },
          } satisfies JsonObject,
        },
      ],
      attachmentStore: {
        async saveAttachment() {
          return attachment;
        },
        async loadAttachment() {
          return attachment;
        },
        async listAttachmentsByRequestId() {
          return [attachment];
        },
        async listAttachmentsByRunId() {
          return [attachment];
        },
        async listAttachmentsBySession() {
          return [attachment];
        },
        async updateAttachmentStatus() {
          return attachment;
        },
      },
    });

    const assembly = await engine.assemble(
      {
        sessionId: SESSION,
        requestId: msgId('current-request'),
        requestContextId: brand<string, 'RequestContextId'>('rc-attachment-context'),
        identityContext: { tenantId: TENANT, subjectId: SUBJECT, displayName: 'attachment tester' },
        agentId: AGENT,
        agentVersion: AGENT_V,
        runId: brand<string, 'RequestRunId'>('run-attachment-context'),
        stepId: 'turn-1',
        locale: brand<string, 'RequestLocale'>('zh-CN'),
        purpose: 'attachment-test',
      },
      undefined,
      new AbortController().signal,
    );

    expect(assembly.attachmentEvidence?.map((item) => item.decision)).toContain('latest-request-optional');
    expect(assembly.attachmentDegradationEvidence).toEqual([
      expect.objectContaining({
        safeReasonCode: 'ATTACHMENT_LATEST_OPTIONAL_DEGRADED',
        projectionKind: 'controlled-markdown',
      }),
    ]);
    expect(JSON.stringify(assembly)).not.toContain('blob-pdf');
  });

  it('skips attachment reads for plain-text prior turns (metadata-gated, no N+1)', async () => {
    // A multi-turn session where NO turn uploaded attachments. Every prior
    // USER message carries metadata without `attachmentIds` (matching
    // rootUserMessageMetadata, which omits the key when attachmentIds is
    // empty). collectAttachmentEvidence must issue a single
    // listAttachmentsByRequestId for the current request and ZERO for prior
    // turns — collapsing the former N-queries-per-N-turns fan-out that drove
    // NAIE Memory 429. A spy on listAttachmentsByRequestId locks this.
    const listAttachmentsCalls: string[] = [];
    const attachmentStore: AttachmentStoreGateway = {
      async saveAttachment() {
        throw new Error('unused');
      },
      async loadAttachment() {
        return undefined;
      },
      async listAttachmentsByRequestId(request) {
        listAttachmentsCalls.push(request.requestId as string);
        return [];
      },
      async listAttachmentsByRunId() {
        return [];
      },
      async listAttachmentsBySession() {
        return [];
      },
      async updateAttachmentStatus() {
        return undefined;
      },
    };
    const priorTurns: SessionMessageRecord[] = [];
    for (let i = 0; i < 5; i++) {
      const requestId = msgId(`prior-req-${i}`);
      priorTurns.push(
        {
          tenantId: TENANT,
          subjectId: SUBJECT,
          agentId: AGENT,
          messageId: msgId(`prior-user-${i}`),
          sessionId: SESSION,
          requestId,
          runId: brand<string, 'RequestRunId'>('run-attachment-context'),
          role: 'USER',
          content: `prior request ${i}`,
          contentType: 'PLAIN_TEXT',
          metadata: {},
          visible: true,
          createdAt: brand<number, 'EpochMillis'>(i),
        },
        {
          tenantId: TENANT,
          subjectId: SUBJECT,
          agentId: AGENT,
          messageId: msgId(`prior-assistant-${i}`),
          sessionId: SESSION,
          requestId,
          runId: brand<string, 'RequestRunId'>('run-attachment-context'),
          role: 'ASSISTANT',
          content: JSON.stringify({ text: 'ok' }),
          contentType: 'PLAIN_TEXT',
          metadata: {},
          visible: true,
          createdAt: brand<number, 'EpochMillis'>(i + 1),
        },
      );
    }
    const engine = makeEngine({
      attachmentStore,
      messages: [...priorTurns, { ...userMsg('current-request'), metadata: {} }],
      activeContextMessageIds: [
        'prior-user-0',
        'prior-assistant-0',
        'prior-user-1',
        'prior-assistant-1',
        'prior-user-2',
        'prior-assistant-2',
        'prior-user-3',
        'prior-assistant-3',
        'prior-user-4',
        'prior-assistant-4',
        'current-request',
      ],
    });

    const assembly = await engine.assemble(
      {
        sessionId: SESSION,
        requestId: msgId('current-request'),
        requestContextId: brand<string, 'RequestContextId'>('rc-attachment-context'),
        identityContext: { tenantId: TENANT, subjectId: SUBJECT, displayName: 'attachment tester' },
        agentId: AGENT,
        agentVersion: AGENT_V,
        runId: brand<string, 'RequestRunId'>('run-attachment-context'),
        stepId: 'turn-1',
        locale: brand<string, 'RequestLocale'>('zh-CN'),
        purpose: 'attachment-test',
      },
      undefined,
      new AbortController().signal,
    );

    // Only the current request was queried — the 5 plain-text prior turns
    // were skipped by the metadata gate (no attachmentIds → no gateway call).
    expect(listAttachmentsCalls).toEqual([msgId('current-request') as string]);
    // No attachment evidence produced (no attachments exist).
    expect(assembly.attachmentEvidence).toEqual([]);
    expect(assembly.attachmentDegradationEvidence).toEqual([]);
  });
});
