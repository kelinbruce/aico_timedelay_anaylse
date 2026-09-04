import { createSqliteGatewayStores } from '@nextagent/agent-platform-gateway-local';
import { bindRuntimeLoggerProvider, brand, type RuntimeLoggerProviderBinding } from '@nextagent/agent-common';
import { mkdtempSync, rmSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type {
  ConversationAnnotationRecord,
  ConversationAnnotationSentiment,
  ConversationFavoriteTurnSummary,
} from '@nextagent/agent-contracts/gateway';
import type {
  ConversationShareRecord,
  ReplaceTodoStateRequest,
  ConversationShareStoreGateway,
  RequestAttachmentRecord,
  RequestRunRecord,
} from '@nextagent/agent-contracts/gateway';
import type {
  AgentId,
  AttachmentId,
  EpochMillis,
  IdempotencyKey,
  MessageId,
  RequestRunId,
  SafeError,
  SessionId,
  SubjectId,
  TenantId,
} from '@nextagent/agent-common';

function makeRecord(overrides: Partial<ConversationAnnotationRecord> = {}): ConversationAnnotationRecord {
  return {
    tenantId: 'T1' as TenantId,
    subjectId: 'U1' as SubjectId,
    agentId: 'A1' as AgentId,
    annotationId: `ann-${Math.random().toString(36).slice(2)}`,
    sessionId: 'S1' as SessionId,
    requestRunId: 'R1' as RequestRunId,
    createdAt: brand<number, 'EpochMillis'>(0),
    updatedAt: brand<number, 'EpochMillis'>(0),
    ...overrides,
  };
}

function expectAnnotation(value?: ConversationAnnotationRecord | SafeError): ConversationAnnotationRecord {
  expect(value).toBeDefined();
  expect(typeof value === 'object' && value !== null && 'annotationId' in value).toBe(true);
  return value as ConversationAnnotationRecord;
}

function expectAnnotationList(value: readonly ConversationAnnotationRecord[] | SafeError): readonly ConversationAnnotationRecord[] {
  expect(Array.isArray(value)).toBe(true);
  return value as readonly ConversationAnnotationRecord[];
}

function expectFavoriteList(value: readonly ConversationFavoriteTurnSummary[] | SafeError): readonly ConversationFavoriteTurnSummary[] {
  expect(Array.isArray(value)).toBe(true);
  return value as readonly ConversationFavoriteTurnSummary[];
}

function makeShareRecord(overrides: Partial<ConversationShareRecord> = {}): ConversationShareRecord {
  return {
    tenantId: 'T1' as TenantId,
    subjectId: 'U1' as SubjectId,
    agentId: 'A1' as AgentId,
    shareId: '',
    sessionId: 'S1' as SessionId,
    runIds: ['R1' as RequestRunId],
    originUrl: 'https://10.0.0.1:3000',
    allowedOps: null,
    expiresAt: null,
    createdAt: brand<number, 'EpochMillis'>(0),
    ...overrides,
  };
}

function expectShare(value?: ConversationShareRecord | SafeError): ConversationShareRecord {
  expect(value).toBeDefined();
  expect(typeof value === 'object' && value !== null && 'shareId' in value).toBe(true);
  return value as ConversationShareRecord;
}

function makeRequestRunRecord(runId: string, sessionId: string, createdAt: number, overrides: Partial<RequestRunRecord> = {}): RequestRunRecord {
  return {
    tenantId: 'T1' as TenantId,
    subjectId: 'U1' as SubjectId,
    agentId: 'A1' as AgentId,
    runId: runId as RequestRunId,
    sessionId: sessionId as SessionId,
    requestId: brand<string, 'MessageId'>(`request-${runId}`),
    agentVersion: brand<string, 'AgentVersion'>('v1'),
    agentAssemblyRef: 'A1:v1',
    attempt: 1,
    status: 'COMPLETED',
    version: 1,
    terminalCommitState: 'COMMITTED',
    createdAt: brand<number, 'EpochMillis'>(createdAt),
    updatedAt: brand<number, 'EpochMillis'>(createdAt),
    ...overrides,
  };
}

describe('todo state gateway', () => {
  let dir: string;
  let store: ReturnType<typeof createSqliteGatewayStores>;
  let logs: unknown[];
  let loggerBinding: RuntimeLoggerProviderBinding;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'todo-state-test-'));
    logs = [];
    loggerBinding = bindRuntimeLoggerProvider({ getLogger: () => testLogger(logs) });
    store = createSqliteGatewayStores({ sqliteFile: join(dir, 'test.db') });
  });

  afterEach(() => {
    store.close?.();
    loggerBinding.unbind();
    rmSync(dir, { recursive: true, force: true });
  });

  it('appends one revision per TodoWrite call and keeps the latest current projection across instances', async () => {
    const first = { content: 'Inspect AMF alarm', activeForm: 'Inspecting AMF alarm', status: 'in_progress' as const };
    const second = { content: 'Check UPF route', activeForm: 'Checking UPF route', status: 'pending' as const };

    const firstResult = await store.todoStateStore.replaceTodoState(todoRequest({ todos: [first], requestId: 'REQ1', runId: 'RUN1' }));
    expect(firstResult).toMatchObject({ oldTodos: [], newTodos: [first], revision: { revisionSeq: 1, todos: [first] } });

    const secondResult = await store.todoStateStore.replaceTodoState(todoRequest({ todos: [first, second], requestId: 'REQ2', runId: 'RUN2' }));
    expect(secondResult).toMatchObject({
      oldTodos: [first],
      newTodos: [first, second],
      revision: { revisionSeq: 2, requestId: 'REQ2', requestRunId: 'RUN2' },
    });

    const secondInstance = createSqliteGatewayStores({ sqliteFile: join(dir, 'test.db') });
    try {
      await expect(secondInstance.todoStateStore.loadCurrentTodoState(todoScope())).resolves.toMatchObject({
        revisionSeq: 2,
        todos: [first, second],
      });
      await expect(secondInstance.todoStateStore.listTodoStateRevisions(todoScope())).resolves.toMatchObject([
        { revisionSeq: 1, todos: [first], requestId: 'REQ1', requestRunId: 'RUN1' },
        { revisionSeq: 2, todos: [first, second], requestId: 'REQ2', requestRunId: 'RUN2' },
      ]);
    } finally {
      secondInstance.close?.();
    }
  });

  it('returns the first TodoWrite revision for repeated invocation coordinates without duplicate side effects', async () => {
    const first = { content: 'Inspect AMF alarm', activeForm: 'Inspecting AMF alarm', status: 'in_progress' as const };
    const duplicatePayload = { content: 'Different replay payload', activeForm: 'Replaying different payload', status: 'pending' as const };
    const next = { content: 'Check UPF route', activeForm: 'Checking UPF route', status: 'pending' as const };

    const firstResult = await store.todoStateStore.replaceTodoState(
      todoRequest({
        todos: [first],
        requestId: 'REQ-IDEM',
        runId: 'RUN-IDEM',
        contextId: 'CTX-IDEM',
        toolCallId: 'tool-idem',
      }),
    );
    const duplicateResult = await store.todoStateStore.replaceTodoState(
      todoRequest({
        todos: [duplicatePayload],
        requestId: 'REQ-IDEM',
        runId: 'RUN-IDEM',
        contextId: 'CTX-IDEM',
        toolCallId: 'tool-idem',
      }),
    );
    const nextResult = await store.todoStateStore.replaceTodoState(
      todoRequest({
        todos: [first, next],
        requestId: 'REQ-IDEM-2',
        runId: 'RUN-IDEM-2',
        contextId: 'CTX-IDEM-2',
        toolCallId: 'tool-idem-2',
      }),
    );

    expect(duplicateResult).toMatchObject({
      oldTodos: [],
      newTodos: [first],
      revision: { revisionSeq: firstResult.revision.revisionSeq, todos: [first] },
    });
    expect(nextResult).toMatchObject({ oldTodos: [first], newTodos: [first, next], revision: { revisionSeq: 2 } });
    await expect(store.todoStateStore.listTodoStateRevisions(todoScope())).resolves.toMatchObject([
      { revisionSeq: 1, todos: [first] },
      { revisionSeq: 2, todos: [first, next] },
    ]);
  });

  it('copies SQLite blobs to opaque refs and materializes readable execution files', async () => {
    const sourcePath = join(dir, 'source.md');
    const targetPath = join(dir, 'execution', 'attachments', 'attachment-1', 'source.md');
    const sourceBytes = Buffer.alloc(256 * 1024, 'a');
    await writeFile(sourcePath, sourceBytes);
    const sourceRef = await store.blobs.storeBlob({
      tenantId: 'T1' as TenantId,
      subjectId: 'U1' as SubjectId,
      purpose: 'ATTACHMENT',
      blobRef: brand<string, 'BlobRef'>('tmp-upload'),
      localFilePath: sourcePath,
      idempotencyKey: 'blob-upload' as IdempotencyKey,
    });
    const copied = await store.blobs.copyBlob({ sourceBlob: sourceRef, destinationBlob: 'formal-coordinate' });

    expect(copied.blobRef).toMatch(/^blob-/);
    expect(copied.blobRef).not.toBe(targetPath);
    await expect(
      store.blobs.materializeBlob({ tenantId: 'T1' as TenantId, subjectId: 'U1' as SubjectId, blobRef: copied.blobRef, localFilePath: targetPath }),
    ).resolves.toBe(true);
    await expect(readFile(targetPath)).resolves.toEqual(sourceBytes);
  });

  it('lists attachments by session with owner/agent/session scope', async () => {
    const base = {
      tenantId: 'T1' as TenantId,
      subjectId: 'U1' as SubjectId,
      agentId: 'A1' as AgentId,
      fileName: 'source.md',
      mediaType: 'MARKDOWN',
      sizeBytes: 10,
      storageRef: 'blob-session-1',
      validationStatus: 'ACCEPTED',
      availabilityStatus: 'AVAILABLE',
    } as const;
    const rec = (
      overrides: Partial<RequestAttachmentRecord> & {
        readonly attachmentId: AttachmentId;
        readonly sessionId: SessionId;
        readonly requestId: MessageId;
        readonly createdAt: EpochMillis;
      },
    ): RequestAttachmentRecord => ({ ...base, ...overrides }) as RequestAttachmentRecord;

    await store.attachments.saveAttachment(
      rec({ attachmentId: 'att-s1-a' as AttachmentId, sessionId: 'S1' as SessionId, requestId: 'REQ-1' as MessageId, createdAt: 1 as EpochMillis }),
    );
    await store.attachments.saveAttachment(
      rec({ attachmentId: 'att-s1-b' as AttachmentId, sessionId: 'S1' as SessionId, requestId: 'REQ-2' as MessageId, createdAt: 2 as EpochMillis }),
    );
    await store.attachments.saveAttachment(
      rec({ attachmentId: 'att-s2-a' as AttachmentId, sessionId: 'S2' as SessionId, requestId: 'REQ-3' as MessageId, createdAt: 3 as EpochMillis }),
    );
    await store.attachments.saveAttachment(
      rec({
        attachmentId: 'att-other-agent' as AttachmentId,
        sessionId: 'S1' as SessionId,
        requestId: 'REQ-4' as MessageId,
        createdAt: 4 as EpochMillis,
        agentId: 'A2' as AgentId,
      }),
    );

    const s1 = await store.attachments.listAttachmentsBySession({
      tenantId: 'T1' as TenantId,
      subjectId: 'U1' as SubjectId,
      agentId: 'A1' as AgentId,
      sessionId: 'S1' as SessionId,
    });
    expect(s1.map((r) => r.attachmentId)).toEqual(['att-s1-a' as AttachmentId, 'att-s1-b' as AttachmentId]);

    const s2 = await store.attachments.listAttachmentsBySession({
      tenantId: 'T1' as TenantId,
      subjectId: 'U1' as SubjectId,
      agentId: 'A1' as AgentId,
      sessionId: 'S2' as SessionId,
    });
    expect(s2.map((r) => r.attachmentId)).toEqual(['att-s2-a' as AttachmentId]);

    const otherAgent = await store.attachments.listAttachmentsBySession({
      tenantId: 'T1' as TenantId,
      subjectId: 'U1' as SubjectId,
      agentId: 'A2' as AgentId,
      sessionId: 'S1' as SessionId,
    });
    expect(otherAgent.map((r) => r.attachmentId)).toEqual(['att-other-agent' as AttachmentId]);
  });

  it('records clear revisions while deleting current state and isolating agent scope', async () => {
    const todo = { content: 'Inspect NSSF slice', activeForm: 'Inspecting NSSF slice', status: 'pending' as const };
    await store.todoStateStore.replaceTodoState(
      todoRequest({ todos: [todo], requestId: 'REQ-CLEAR-1', runId: 'RUN-CLEAR-1', contextId: 'CTX-CLEAR-1', toolCallId: 'tool-clear-1' }),
    );
    await store.todoStateStore.replaceTodoState(
      todoRequest({
        todos: [{ ...todo, content: 'Other agent todo' }],
        agentId: 'A2',
        requestId: 'REQ-CLEAR-A2',
        runId: 'RUN-CLEAR-A2',
        contextId: 'CTX-CLEAR-A2',
        toolCallId: 'tool-clear-a2',
      }),
    );

    const clear = await store.todoStateStore.replaceTodoState(
      todoRequest({ todos: [], requestId: 'REQ-CLEAR-2', runId: 'RUN-CLEAR-2', contextId: 'CTX-CLEAR-2', toolCallId: 'tool-clear-2' }),
    );
    expect(clear).toMatchObject({ oldTodos: [todo], newTodos: [], revision: { revisionSeq: 2, todos: [] } });
    await expect(store.todoStateStore.loadCurrentTodoState(todoScope())).resolves.toBeUndefined();
    await expect(store.todoStateStore.loadCurrentTodoState(todoScope({ agentId: 'A2' }))).resolves.toMatchObject({
      revisionSeq: 1,
      todos: [{ ...todo, content: 'Other agent todo' }],
    });
    await expect(store.todoStateStore.listTodoStateRevisions(todoScope())).resolves.toMatchObject([
      { revisionSeq: 1, todos: [todo] },
      { revisionSeq: 2, todos: [] },
    ]);
  });

  it('logs low-cardinality gateway diagnostics without todo content', async () => {
    const todo = { content: 'Do not log this AMF detail', activeForm: 'Do not log active form', status: 'pending' as const };

    await store.todoStateStore.replaceTodoState(
      todoRequest({ todos: [todo], requestId: 'REQ-LOG-1', runId: 'RUN-LOG-1', contextId: 'CTX-LOG-1', toolCallId: 'tool-log-1' }),
    );
    await store.todoStateStore.replaceTodoState(
      todoRequest({ todos: [], requestId: 'REQ-LOG-2', runId: 'RUN-LOG-2', contextId: 'CTX-LOG-2', toolCallId: 'tool-log-2' }),
    );

    expect(logs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          event: 'todo.gateway.replace.completed',
          revisionSeq: 1,
          oldItemCount: 0,
          newItemCount: 1,
          currentProjectionAction: 'upserted',
        }),
        expect.objectContaining({
          event: 'todo.gateway.replace.completed',
          revisionSeq: 2,
          oldItemCount: 1,
          newItemCount: 0,
          currentProjectionAction: 'deleted',
        }),
      ]),
    );
    const serializedLogs = JSON.stringify(logs);
    expect(serializedLogs).not.toContain(todo.content);
    expect(serializedLogs).not.toContain(todo.activeForm);
  });
});

function todoScope(overrides: { readonly agentId?: string } = {}) {
  return {
    tenantId: 'T1' as TenantId,
    subjectId: 'U1' as SubjectId,
    agentId: (overrides.agentId ?? 'A1') as AgentId,
    sessionId: 'S1' as SessionId,
  };
}

function todoRequest(overrides: {
  readonly todos: ReadonlyArray<{ readonly content: string; readonly activeForm: string; readonly status: 'pending' | 'in_progress' | 'completed' }>;
  readonly agentId?: string;
  readonly requestId?: string;
  readonly runId?: string;
  readonly contextId?: string;
  readonly toolCallId?: string;
}): ReplaceTodoStateRequest {
  return {
    ...todoScope(overrides.agentId === undefined ? {} : { agentId: overrides.agentId }),
    requestId: brand<string, 'MessageId'>(overrides.requestId ?? 'REQ'),
    requestRunId: brand<string, 'RequestRunId'>(overrides.runId ?? 'RUN'),
    requestContextId: brand<string, 'RequestContextId'>(overrides.contextId ?? 'CTX'),
    toolCallId: brand<string, 'ToolCallId'>(overrides.toolCallId ?? 'tool-todo'),
    todos: overrides.todos,
  };
}

function testLogger(logs: unknown[]) {
  return {
    debug(obj: unknown) {
      logs.push(obj);
    },
    info(obj: unknown) {
      logs.push(obj);
    },
    warn(obj: unknown) {
      logs.push(obj);
    },
    error(obj: unknown) {
      logs.push(obj);
    },
  };
}

describe('request_runs batch gateway', () => {
  let dir: string;
  let store: ReturnType<typeof createSqliteGatewayStores>;

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'request-runs-batch-test-'));
    store = createSqliteGatewayStores({ sqliteFile: join(dir, 'test.db') });
    await store.requestRuns.saveRun(makeRequestRunRecord('R1', 'S1', 100), {});
    await store.requestRuns.saveRun(makeRequestRunRecord('R2', 'S2', 200), {});
    await store.requestRuns.saveRun(makeRequestRunRecord('R3', 'S1', 200), {});
    await store.requestRuns.saveRun(
      makeRequestRunRecord('R1', 'S1', 300, {
        tenantId: 'T2' as TenantId,
        subjectId: 'U2' as SubjectId,
        agentId: 'A2' as AgentId,
      }),
      {},
    );
  });

  afterEach(() => {
    store.close?.();
    rmSync(dir, { recursive: true, force: true });
  });

  it('filters by sessionIds, runIds, and their intersection without duplicate records', async () => {
    const bySessions = await store.requestRuns.listRuns({
      tenantId: 'T1' as TenantId,
      subjectId: 'U1' as SubjectId,
      agentId: 'A1' as AgentId,
      sessionIds: ['S1' as SessionId, 'S2' as SessionId],
      offset: 0,
      limit: 100,
    });
    expect(bySessions.items.map((run) => run.runId)).toEqual(['R3', 'R2', 'R1']);
    expect(bySessions).toMatchObject({ offset: 0, limit: 100, hasMore: false });

    const byRuns = await store.requestRuns.listRuns({
      tenantId: 'T1' as TenantId,
      subjectId: 'U1' as SubjectId,
      agentId: 'A1' as AgentId,
      runIds: ['R1' as RequestRunId, 'R3' as RequestRunId, 'R3' as RequestRunId],
      offset: 0,
      limit: 100,
    });
    expect(byRuns.items.map((run) => run.runId)).toEqual(['R3', 'R1']);

    const intersection = await store.requestRuns.listRuns({
      tenantId: 'T1' as TenantId,
      subjectId: 'U1' as SubjectId,
      agentId: 'A1' as AgentId,
      sessionIds: ['S1' as SessionId],
      runIds: ['R2' as RequestRunId, 'R3' as RequestRunId],
      offset: 0,
      limit: 100,
    });
    expect(intersection.items.map((run) => run.runId)).toEqual(['R3']);
  });

  it('uses stable descending pagination and reports hasMore', async () => {
    const firstPage = await store.requestRuns.listRuns({
      tenantId: 'T1' as TenantId,
      subjectId: 'U1' as SubjectId,
      agentId: 'A1' as AgentId,
      sessionIds: ['S1' as SessionId, 'S2' as SessionId],
      offset: 0,
      limit: 1,
    });
    expect(firstPage.items.map((run) => run.runId)).toEqual(['R3']);
    expect(firstPage.hasMore).toBe(true);

    const secondPage = await store.requestRuns.listRuns({
      tenantId: 'T1' as TenantId,
      subjectId: 'U1' as SubjectId,
      agentId: 'A1' as AgentId,
      sessionIds: ['S1' as SessionId, 'S2' as SessionId],
      offset: 1,
      limit: 1,
    });
    expect(secondPage.items.map((run) => run.runId)).toEqual(['R2']);
    expect(secondPage.hasMore).toBe(true);

    const lastPage = await store.requestRuns.listRuns({
      tenantId: 'T1' as TenantId,
      subjectId: 'U1' as SubjectId,
      agentId: 'A1' as AgentId,
      sessionIds: ['S1' as SessionId, 'S2' as SessionId],
      offset: 2,
      limit: 1,
    });
    expect(lastPage.items.map((run) => run.runId)).toEqual(['R1']);
    expect(lastPage.hasMore).toBe(false);
  });

  it('isolates owner and agent scope even when a runId is shared', async () => {
    const page = await store.requestRuns.listRuns({
      tenantId: 'T1' as TenantId,
      subjectId: 'U1' as SubjectId,
      agentId: 'A1' as AgentId,
      runIds: ['R1' as RequestRunId],
      offset: 0,
      limit: 100,
    });
    expect(page.items).toHaveLength(1);
    expect(page.items[0]).toMatchObject({ tenantId: 'T1', subjectId: 'U1', agentId: 'A1', runId: 'R1' });
  });

  it.each([
    { offset: 0, limit: 100 },
    { sessionIds: [], offset: 0, limit: 100 },
    { runIds: [], offset: 0, limit: 100 },
    { sessionIds: 'S1' as never, offset: 0, limit: 100 },
    { runIds: 'R1' as never, offset: 0, limit: 100 },
    { runIds: ['R1' as RequestRunId], offset: -1, limit: 100 },
    { runIds: ['R1' as RequestRunId], offset: 1.5, limit: 100 },
    { runIds: ['R1' as RequestRunId], offset: 0, limit: 0 },
    { runIds: ['R1' as RequestRunId], offset: 0, limit: 101 },
  ])('rejects an invalid bounded query %#', async (query) => {
    await expect(
      store.requestRuns.listRuns({
        tenantId: 'T1' as TenantId,
        subjectId: 'U1' as SubjectId,
        agentId: 'A1' as AgentId,
        ...query,
      }),
    ).rejects.toMatchObject({ code: 'REQUEST_RUN_QUERY_INVALID', category: 'VALIDATION', retryable: false });
  });
});

describe('conversation_annotations gateway', () => {
  let dir: string;
  let store: ReturnType<typeof createSqliteGatewayStores>;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'ann-test-'));
    store = createSqliteGatewayStores({ sqliteFile: join(dir, 'test.db') });
  });

  afterEach(() => {
    store.close?.();
    rmSync(dir, { recursive: true, force: true });
  });

  describe('cross scope isolation', () => {
    it('returns empty for different subject, tenant, or agent', async () => {
      await store.conversationAnnotations.saveAnnotation(makeRecord({ sentiment: 'UP' }), {});

      const byDiffSubject = await store.conversationAnnotations.listSessionAnnotations({
        tenantId: 'T1' as TenantId,
        subjectId: 'U2' as SubjectId,
        agentId: 'A1' as AgentId,
        sessionId: 'S1' as SessionId,
      });
      const byDiffTenant = await store.conversationAnnotations.listSessionAnnotations({
        tenantId: 'T2' as TenantId,
        subjectId: 'U1' as SubjectId,
        agentId: 'A1' as AgentId,
        sessionId: 'S1' as SessionId,
      });
      const byDiffAgent = await store.conversationAnnotations.listSessionAnnotations({
        tenantId: 'T1' as TenantId,
        subjectId: 'U1' as SubjectId,
        agentId: 'A2' as AgentId,
        sessionId: 'S1' as SessionId,
      });

      for (const result of [byDiffSubject, byDiffTenant, byDiffAgent]) {
        expect(Array.isArray(result)).toBe(true);
        expect(result as unknown[]).toHaveLength(0);
      }
    });

    it('returns empty favorites for different scope', async () => {
      await store.conversationAnnotations.saveAnnotation(makeRecord({ sentiment: null, isFavorited: true, annotationId: 'ann-fav' }), {});
      const result = await store.conversationAnnotations.listFavoriteTurns({
        tenantId: 'T1' as TenantId,
        subjectId: 'U2' as SubjectId,
        agentId: 'A1' as AgentId,
        limit: 10,
        offset: 0,
      });
      expect(Array.isArray(result)).toBe(true);
      expect(result as unknown[]).toHaveLength(0);
    });

    it('isolates question favorites by tenant, subject, and agent', async () => {
      await store.conversationAnnotations.saveAnnotation(makeRecord({ isQuestionFavorited: true, annotationId: 'ann-question-scope' }), {});

      const own = expectAnnotationList(
        await store.conversationAnnotations.listSessionAnnotations({
          tenantId: 'T1' as TenantId,
          subjectId: 'U1' as SubjectId,
          agentId: 'A1' as AgentId,
          sessionId: 'S1' as SessionId,
        }),
      );
      expect(own).toHaveLength(1);
      expect(own[0]!.isQuestionFavorited).toBe(true);

      for (const scope of [
        { tenantId: 'T1' as TenantId, subjectId: 'U2' as SubjectId, agentId: 'A1' as AgentId },
        { tenantId: 'T2' as TenantId, subjectId: 'U1' as SubjectId, agentId: 'A1' as AgentId },
        { tenantId: 'T1' as TenantId, subjectId: 'U1' as SubjectId, agentId: 'A2' as AgentId },
      ]) {
        const result = expectAnnotationList(
          await store.conversationAnnotations.listSessionAnnotations({
            ...scope,
            sessionId: 'S1' as SessionId,
          }),
        );
        expect(result).toHaveLength(0);
      }
    });
  });

  describe('upsert behavior', () => {
    it('round-trips a question favorite independently from answer favorite', async () => {
      const saved = expectAnnotation(
        await store.conversationAnnotations.saveAnnotation(makeRecord({ isQuestionFavorited: true, annotationId: 'ann-question' }), {}),
      );

      expect(saved.isFavorited).toBe(false);
      expect(saved.isQuestionFavorited).toBe(true);
      const listed = expectAnnotationList(
        await store.conversationAnnotations.listSessionAnnotations({
          tenantId: 'T1' as TenantId,
          subjectId: 'U1' as SubjectId,
          agentId: 'A1' as AgentId,
          sessionId: 'S1' as SessionId,
        }),
      );
      expect(listed).toMatchObject([
        {
          annotationId: 'ann-question',
          isFavorited: false,
          isQuestionFavorited: true,
        },
      ]);
    });

    it('preserves question favorite across partial updates and answer favorite toggles', async () => {
      await store.conversationAnnotations.saveAnnotation(
        makeRecord({ isFavorited: true, isQuestionFavorited: true, annotationId: 'ann-both-favorites' }),
        {},
      );
      const withSentiment = expectAnnotation(await store.conversationAnnotations.saveAnnotation(makeRecord({ sentiment: 'UP' }), {}));
      expect(withSentiment).toMatchObject({
        sentiment: 'UP',
        isFavorited: true,
        isQuestionFavorited: true,
      });

      const answerFavoriteRemoved = expectAnnotation(
        await store.conversationAnnotations.saveAnnotation(makeRecord({ sentiment: null, isFavorited: false }), {}),
      );
      expect(answerFavoriteRemoved).toMatchObject({
        sentiment: null,
        isFavorited: false,
        isQuestionFavorited: true,
      });
    });

    it('deletes the row when the final question favorite is removed', async () => {
      const saved = await store.conversationAnnotations.saveAnnotation(
        makeRecord({ isQuestionFavorited: true, annotationId: 'ann-final-question' }),
        {},
      );
      expectAnnotation(saved);

      await expect(store.conversationAnnotations.saveAnnotation(makeRecord({ isQuestionFavorited: false }), {})).resolves.toBeUndefined();
      const listed = expectAnnotationList(
        await store.conversationAnnotations.listSessionAnnotations({
          tenantId: 'T1' as TenantId,
          subjectId: 'U1' as SubjectId,
          agentId: 'A1' as AgentId,
          sessionId: 'S1' as SessionId,
        }),
      );
      expect(listed).toHaveLength(0);
    });

    it('UP to DOWN is a field update, isFavorited unchanged', async () => {
      await store.conversationAnnotations.saveAnnotation(makeRecord({ sentiment: 'UP', isFavorited: true, annotationId: 'ann-1' }), {});
      const updated = await store.conversationAnnotations.saveAnnotation(makeRecord({ sentiment: 'DOWN' }), {});
      expect(updated).toBeDefined();
      const ann = expectAnnotation(updated);
      expect(ann.sentiment).toBe('DOWN');
      expect(ann.isFavorited).toBe(true);
      expect(ann.annotationId).toBe('ann-1');
    });

    it('setting isFavorited does not affect sentiment', async () => {
      await store.conversationAnnotations.saveAnnotation(makeRecord({ sentiment: 'UP', isFavorited: false, annotationId: 'ann-2' }), {});
      const updated = await store.conversationAnnotations.saveAnnotation(makeRecord({ isFavorited: true }), {});
      const updAnn = expectAnnotation(updated);
      expect(updAnn.sentiment).toBe('UP');
      expect(updAnn.isFavorited).toBe(true);
    });

    it('sentiment=null + isFavorited=false deletes the row', async () => {
      await store.conversationAnnotations.saveAnnotation(makeRecord({ sentiment: 'UP', isFavorited: false, annotationId: 'ann-3' }), {});
      const result = await store.conversationAnnotations.saveAnnotation(makeRecord({ sentiment: null, isFavorited: false }), {});
      expect(result).toBeUndefined();

      const list = await store.conversationAnnotations.listSessionAnnotations({
        tenantId: 'T1' as TenantId,
        subjectId: 'U1' as SubjectId,
        agentId: 'A1' as AgentId,
        sessionId: 'S1' as SessionId,
      });
      expect(list as unknown[]).toHaveLength(0);
    });

    it('sentiment=null + isFavorited=true keeps the row', async () => {
      await store.conversationAnnotations.saveAnnotation(makeRecord({ sentiment: 'UP', isFavorited: true, annotationId: 'ann-4' }), {});
      const updated = await store.conversationAnnotations.saveAnnotation(makeRecord({ sentiment: null }), {});
      expect(updated).toBeDefined();
      const updAnn2 = expectAnnotation(updated);
      expect(updAnn2.sentiment).toBeNull();
      expect(updAnn2.isFavorited).toBe(true);
    });

    it('isFavorited=false + sentiment=UP keeps the row', async () => {
      await store.conversationAnnotations.saveAnnotation(makeRecord({ sentiment: 'UP', isFavorited: true, annotationId: 'ann-5' }), {});
      const updated = await store.conversationAnnotations.saveAnnotation(makeRecord({ isFavorited: false }), {});
      expect(updated).toBeDefined();
      const updAnn3 = expectAnnotation(updated);
      expect(updAnn3.sentiment).toBe('UP');
      expect(updAnn3.isFavorited).toBe(false);
    });

    it('createdAt stays first-action time, updatedAt advances', async () => {
      const first = await store.conversationAnnotations.saveAnnotation(
        makeRecord({ sentiment: 'UP', isFavorited: false, annotationId: 'ann-6' }),
        {},
      );
      const firstAnn = expectAnnotation(first);
      const firstCreatedAt = firstAnn.createdAt;
      const second = await store.conversationAnnotations.saveAnnotation(makeRecord({ isFavorited: true }), {});
      const secondAnn = expectAnnotation(second);
      expect(secondAnn.createdAt).toBe(firstCreatedAt);
      expect(secondAnn.updatedAt).toBeGreaterThanOrEqual(firstCreatedAt);
    });

    it('comment upsert: set, clear (null), and leave unchanged (undefined)', async () => {
      // Set comment
      await store.conversationAnnotations.saveAnnotation(makeRecord({ sentiment: 'UP', comment: null, annotationId: 'ann-7' }), {});
      const withComment = await store.conversationAnnotations.saveAnnotation(makeRecord({ comment: 'too slow' }), {});
      expect(expectAnnotation(withComment).comment).toBe('too slow');

      // Leave unchanged (comment not provided)
      const unchanged = await store.conversationAnnotations.saveAnnotation(makeRecord({ isFavorited: true }), {});
      expect(expectAnnotation(unchanged).comment).toBe('too slow');

      // Clear comment
      const cleared = await store.conversationAnnotations.saveAnnotation(makeRecord({ comment: null }), {});
      expect(expectAnnotation(cleared).comment).toBeNull();
    });

    it('sentiment=null + isFavorited=false + comment=text deletes row (comment does not prevent deletion)', async () => {
      await store.conversationAnnotations.saveAnnotation(
        makeRecord({ sentiment: 'UP', isFavorited: true, comment: 'good', annotationId: 'ann-8' }),
        {},
      );
      const result = await store.conversationAnnotations.saveAnnotation(makeRecord({ sentiment: null, isFavorited: false, comment: 'text' }), {});
      expect(result).toBeUndefined();
    });
  });

  describe('idempotent', () => {
    it('repeated saveAnnotation with same idempotencyKey returns same annotationId', async () => {
      const key = 'idem-1' as IdempotencyKey;
      const first = await store.conversationAnnotations.saveAnnotation(makeRecord({ sentiment: 'UP', annotationId: 'ann-idem' }), {
        idempotencyKey: key,
      });
      const second = await store.conversationAnnotations.saveAnnotation(makeRecord({ sentiment: 'UP', annotationId: 'ann-different' }), {
        idempotencyKey: key,
      });
      const firstAnn2 = expectAnnotation(first);
      const secondAnn2 = expectAnnotation(second);
      expect(secondAnn2.annotationId).toBe(firstAnn2.annotationId);
      expect(secondAnn2.annotationId).toBe('ann-idem');
    });
  });

  describe('listFavoriteTurns', () => {
    it('excludes pure question favorites while retaining answer favorites', async () => {
      await store.conversationAnnotations.saveAnnotation(
        makeRecord({
          requestRunId: 'R-question-favorite' as RequestRunId,
          isQuestionFavorited: true,
          annotationId: 'question-favorite',
        }),
        {},
      );
      await store.conversationAnnotations.saveAnnotation(
        makeRecord({
          requestRunId: 'R-answer-favorite' as RequestRunId,
          isFavorited: true,
          isQuestionFavorited: false,
          annotationId: 'answer-favorite',
        }),
        {},
      );

      const annotations = expectAnnotationList(
        await store.conversationAnnotations.listSessionAnnotations({
          tenantId: 'T1' as TenantId,
          subjectId: 'U1' as SubjectId,
          agentId: 'A1' as AgentId,
          sessionId: 'S1' as SessionId,
        }),
      );
      expect(annotations).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            requestRunId: 'R-question-favorite',
            isQuestionFavorited: true,
          }),
        ]),
      );

      const favorites = expectFavoriteList(
        await store.conversationAnnotations.listFavoriteTurns({
          tenantId: 'T1' as TenantId,
          subjectId: 'U1' as SubjectId,
          agentId: 'A1' as AgentId,
          limit: 10,
          offset: 0,
        }),
      );
      expect(favorites).toHaveLength(1);
      expect(favorites[0]!.requestRunId).toBe('R-answer-favorite');
    });

    it('returns favorited turns with question preview', async () => {
      await store.messages.appendSessionMessage(
        {
          tenantId: 'T1' as TenantId,
          subjectId: 'U1' as SubjectId,
          agentId: 'A1' as AgentId,
          messageId: 'M1' as MessageId,
          sessionId: 'S1' as SessionId,
          requestId: 'M1' as MessageId,
          runId: 'R1' as RequestRunId,
          role: 'USER',
          content: 'How to reset router?',
          contentType: 'PLAIN_TEXT',
          metadata: {},
          visible: true,
          createdAt: brand<number, 'EpochMillis'>(100),
        },
        {},
      );
      await store.messages.appendSessionMessage(
        {
          tenantId: 'T1' as TenantId,
          subjectId: 'U1' as SubjectId,
          agentId: 'A1' as AgentId,
          messageId: 'M2' as MessageId,
          sessionId: 'S1' as SessionId,
          requestId: 'M2' as MessageId,
          runId: 'R2' as RequestRunId,
          role: 'USER',
          content: 'Check signal strength',
          contentType: 'PLAIN_TEXT',
          metadata: {},
          visible: true,
          createdAt: brand<number, 'EpochMillis'>(200),
        },
        {},
      );
      await store.conversationAnnotations.saveAnnotation(
        makeRecord({ sentiment: null, isFavorited: true, requestRunId: 'R1' as RequestRunId, annotationId: 'f1' }),
        {},
      );
      await store.conversationAnnotations.saveAnnotation(
        makeRecord({ sentiment: null, isFavorited: true, requestRunId: 'R2' as RequestRunId, annotationId: 'f2' }),
        {},
      );
      await store.conversationAnnotations.saveAnnotation(
        makeRecord({ sentiment: 'UP', isFavorited: false, requestRunId: 'R3' as RequestRunId, annotationId: 'f3' }),
        {},
      );

      const result = await store.conversationAnnotations.listFavoriteTurns({
        tenantId: 'T1' as TenantId,
        subjectId: 'U1' as SubjectId,
        agentId: 'A1' as AgentId,
        limit: 10,
        offset: 0,
      });
      expect(Array.isArray(result)).toBe(true);
      const favorites = expectFavoriteList(result);
      expect(favorites).toHaveLength(2);
      expect(favorites[0]!.favoritedAt).toBeGreaterThanOrEqual(favorites[1]!.favoritedAt);
      const byRun = new Map(favorites.map((favorite) => [favorite.requestRunId, favorite]));
      expect(byRun.get('R1' as RequestRunId)).toMatchObject({
        sessionId: 'S1',
        rootMessageId: 'M1',
        questionPreview: 'How to reset router?',
        questionTruncated: false,
      });
      expect(byRun.get('R2' as RequestRunId)).toMatchObject({
        sessionId: 'S1',
        rootMessageId: 'M2',
        questionPreview: 'Check signal strength',
        questionTruncated: false,
      });
    });

    it('returns sessionTitle and sessionUpdatedAt via LEFT JOIN sessions', async () => {
      await store.sessions.saveSession({
        tenantId: 'T1' as TenantId,
        subjectId: 'U1' as SubjectId,
        agentId: 'A1' as AgentId,
        sessionId: 'S1' as SessionId,
        title: 'Router diagnostics',
        createdAt: brand<number, 'EpochMillis'>(100),
        updatedAt: brand<number, 'EpochMillis'>(200),
      });
      await store.conversationAnnotations.saveAnnotation(
        makeRecord({ isFavorited: true, requestRunId: 'R1' as RequestRunId, annotationId: 'f-session' }),
        {},
      );

      const favorites = expectFavoriteList(
        await store.conversationAnnotations.listFavoriteTurns({
          tenantId: 'T1' as TenantId,
          subjectId: 'U1' as SubjectId,
          agentId: 'A1' as AgentId,
          limit: 10,
          offset: 0,
        }),
      );
      expect(favorites).toHaveLength(1);
      expect(favorites[0]!.sessionTitle).toBe('Router diagnostics');
      expect(favorites[0]!.sessionUpdatedAt).toBe(brand<number, 'EpochMillis'>(200));
    });

    it('returns undefined sessionTitle and 0 sessionUpdatedAt when session row missing', async () => {
      await store.conversationAnnotations.saveAnnotation(
        makeRecord({ isFavorited: true, requestRunId: 'R1' as RequestRunId, annotationId: 'f-orphan' }),
        {},
      );

      const favorites = expectFavoriteList(
        await store.conversationAnnotations.listFavoriteTurns({
          tenantId: 'T1' as TenantId,
          subjectId: 'U1' as SubjectId,
          agentId: 'A1' as AgentId,
          limit: 10,
          offset: 0,
        }),
      );
      expect(favorites).toHaveLength(1);
      expect(favorites[0]!.sessionTitle).toBeUndefined();
      expect(favorites[0]!.sessionUpdatedAt).toBe(brand<number, 'EpochMillis'>(0));
    });

    it('projects a retried favorite through the canonical request user message', async () => {
      await store.requestRuns.saveRun(makeRequestRunRecord('R-source', 'S1', 100, { requestId: 'M1' as MessageId }), {});
      await store.requestRuns.saveRun(
        makeRequestRunRecord('R-retry', 'S1', 200, {
          requestId: 'M1' as MessageId,
          attempt: 2,
          retryOfRunId: 'R-source' as RequestRunId,
        }),
        {},
      );
      await store.messages.appendSessionMessage(
        {
          tenantId: 'T1' as TenantId,
          subjectId: 'U1' as SubjectId,
          agentId: 'A1' as AgentId,
          messageId: 'M1' as MessageId,
          sessionId: 'S1' as SessionId,
          requestId: 'M1' as MessageId,
          runId: 'R-source' as RequestRunId,
          role: 'USER',
          content: 'canonical retry question',
          contentType: 'PLAIN_TEXT',
          metadata: {},
          visible: true,
          createdAt: brand<number, 'EpochMillis'>(100),
        },
        {},
      );
      await store.messages.appendSessionMessage(
        {
          tenantId: 'T1' as TenantId,
          subjectId: 'U1' as SubjectId,
          agentId: 'A1' as AgentId,
          messageId: 'M-generated' as MessageId,
          sessionId: 'S1' as SessionId,
          requestId: 'M1' as MessageId,
          runId: 'R-retry' as RequestRunId,
          role: 'USER',
          content: 'generated retry message',
          contentType: 'PLAIN_TEXT',
          metadata: {},
          visible: true,
          createdAt: brand<number, 'EpochMillis'>(200),
        },
        {},
      );
      await store.conversationAnnotations.saveAnnotation(
        makeRecord({ isFavorited: true, requestRunId: 'R-retry' as RequestRunId, annotationId: 'retry-favorite' }),
        {},
      );

      const favorites = expectFavoriteList(
        await store.conversationAnnotations.listFavoriteTurns({
          tenantId: 'T1' as TenantId,
          subjectId: 'U1' as SubjectId,
          agentId: 'A1' as AgentId,
          limit: 10,
          offset: 0,
        }),
      );

      expect(favorites).toHaveLength(1);
      expect(favorites[0]).toMatchObject({
        requestRunId: 'R-retry',
        rootMessageId: 'M1',
        questionPreview: 'canonical retry question',
      });
    });

    it('projects each fork-inherited answer favorite once from the canonical user message', async () => {
      await store.messages.appendSessionMessage(
        {
          tenantId: 'T1' as TenantId,
          subjectId: 'U1' as SubjectId,
          agentId: 'A1' as AgentId,
          messageId: 'F-request' as MessageId,
          sessionId: 'S1' as SessionId,
          requestId: 'F-request' as MessageId,
          runId: 'F-source-run' as RequestRunId,
          role: 'USER',
          content: 'canonical fork question',
          contentType: 'PLAIN_TEXT',
          metadata: {},
          visible: true,
          createdAt: brand<number, 'EpochMillis'>(100),
        },
        {},
      );
      await store.messages.appendSessionMessage(
        {
          tenantId: 'T1' as TenantId,
          subjectId: 'U1' as SubjectId,
          agentId: 'A1' as AgentId,
          messageId: 'F-answer' as MessageId,
          sessionId: 'S1' as SessionId,
          requestId: 'F-request' as MessageId,
          runId: 'F-run' as RequestRunId,
          role: 'ASSISTANT',
          content: 'fork answer',
          contentType: 'PLAIN_TEXT',
          metadata: {},
          visible: true,
          createdAt: brand<number, 'EpochMillis'>(200),
        },
        {},
      );
      const diagnostic = new DatabaseSync(join(dir, 'test.db'));
      try {
        diagnostic
          .prepare(
            `INSERT INTO fork_process_snapshot_statuses(
              tenant_id, subject_id, agent_id, session_id, request_id, run_id, status
            ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
          )
          .run('T1', 'U1', 'A1', 'S1', 'F-request', 'F-run', 'AVAILABLE');
      } finally {
        diagnostic.close();
      }
      await store.conversationAnnotations.saveAnnotation(
        makeRecord({
          isFavorited: true,
          requestRunId: 'F-run' as RequestRunId,
          annotationId: 'fork-question-favorite',
        }),
        {},
      );

      const favorites = expectFavoriteList(
        await store.conversationAnnotations.listFavoriteTurns({
          tenantId: 'T1' as TenantId,
          subjectId: 'U1' as SubjectId,
          agentId: 'A1' as AgentId,
          limit: 10,
          offset: 0,
        }),
      );

      expect(favorites).toHaveLength(1);
      expect(favorites[0]).toMatchObject({
        requestRunId: 'F-run',
        rootMessageId: 'F-request',
        questionPreview: 'canonical fork question',
      });
    });
  });

  describe('schema compatibility', () => {
    it('migrates an existing annotation table and enforces the question favorite check', async () => {
      const sqliteFile = join(dir, 'legacy.db');
      const legacy = new DatabaseSync(sqliteFile);
      legacy.exec(`
        CREATE TABLE conversation_annotations (
          tenant_id TEXT NOT NULL,
          subject_id TEXT NOT NULL,
          agent_id TEXT NOT NULL,
          annotation_id TEXT NOT NULL,
          session_id TEXT NOT NULL,
          request_run_id TEXT NOT NULL,
          sentiment TEXT,
          is_favorited INTEGER NOT NULL DEFAULT 0,
          comment TEXT,
          idempotency_key TEXT,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL,
          PRIMARY KEY (tenant_id, subject_id, agent_id, annotation_id)
        );
        INSERT INTO conversation_annotations (
          tenant_id, subject_id, agent_id, annotation_id, session_id, request_run_id,
          sentiment, is_favorited, comment, idempotency_key, created_at, updated_at
        ) VALUES (
          'T1', 'U1', 'A1', 'legacy-ann', 'S1', 'R1',
          'UP', 0, NULL, NULL, 1, 1
        );
      `);
      legacy.close();

      const migrated = createSqliteGatewayStores({ sqliteFile });
      try {
        const existing = expectAnnotationList(
          await migrated.conversationAnnotations.listSessionAnnotations({
            tenantId: 'T1' as TenantId,
            subjectId: 'U1' as SubjectId,
            agentId: 'A1' as AgentId,
            sessionId: 'S1' as SessionId,
          }),
        );
        expect(existing).toMatchObject([
          {
            annotationId: 'legacy-ann',
            isQuestionFavorited: false,
          },
        ]);

        const updated = expectAnnotation(await migrated.conversationAnnotations.saveAnnotation(makeRecord({ isQuestionFavorited: true }), {}));
        expect(updated.isQuestionFavorited).toBe(true);
      } finally {
        migrated.close?.();
      }

      const reopened = createSqliteGatewayStores({ sqliteFile });
      reopened.close?.();
      const diagnostic = new DatabaseSync(sqliteFile);
      try {
        const columns = diagnostic.prepare('PRAGMA table_info(conversation_annotations)').all() as Array<{ readonly name: string }>;
        expect(columns.map((column) => column.name)).toContain('question_favorite');
        expect(() =>
          diagnostic.prepare("UPDATE conversation_annotations SET question_favorite = 2 WHERE annotation_id = 'legacy-ann'").run(),
        ).toThrow();
      } finally {
        diagnostic.close();
      }
    });
  });

  describe('deleteAnnotationsByRun', () => {
    it('deletes annotations for a specific run', async () => {
      await store.conversationAnnotations.saveAnnotation(
        makeRecord({ sentiment: 'UP', isFavorited: true, requestRunId: 'R-del' as RequestRunId, annotationId: 'd1' }),
        {},
      );
      await store.conversationAnnotations.saveAnnotation(
        makeRecord({ sentiment: 'UP', requestRunId: 'R-keep' as RequestRunId, annotationId: 'd2' }),
        {},
      );

      await store.conversationAnnotations.deleteAnnotationsByRun({
        tenantId: 'T1' as TenantId,
        subjectId: 'U1' as SubjectId,
        agentId: 'A1' as AgentId,
        requestRunId: 'R-del' as RequestRunId,
      });

      const list = await store.conversationAnnotations.listSessionAnnotations({
        tenantId: 'T1' as TenantId,
        subjectId: 'U1' as SubjectId,
        agentId: 'A1' as AgentId,
        sessionId: 'S1' as SessionId,
      });
      const listAnn = expectAnnotationList(list);
      expect(listAnn).toHaveLength(1);
      expect(listAnn[0]!.requestRunId).toBe('R-keep' as RequestRunId);
    });

    it('is idempotent when run has no annotations', async () => {
      await store.conversationAnnotations.deleteAnnotationsByRun({
        tenantId: 'T1' as TenantId,
        subjectId: 'U1' as SubjectId,
        agentId: 'A1' as AgentId,
        requestRunId: 'R-none' as RequestRunId,
      });
      // Should not throw
    });
  });

  describe('favorite count limit', () => {
    async function seedFavorites(count: number, startIdx = 1): Promise<void> {
      for (let i = 0; i < count; i += 1) {
        const idx = startIdx + i;
        await store.conversationAnnotations.saveAnnotation(
          makeRecord({ isFavorited: true, requestRunId: `R-fl-${idx}` as RequestRunId, annotationId: `ann-fl-${idx}` }),
          {},
        );
      }
    }

    async function countFavorites(): Promise<number> {
      const list = expectFavoriteList(
        await store.conversationAnnotations.listFavoriteTurns({
          tenantId: 'T1' as TenantId,
          subjectId: 'U1' as SubjectId,
          agentId: 'A1' as AgentId,
          limit: 200,
          offset: 0,
        }),
      );
      return list.length;
    }

    it('accepts the 100th favorite in a scope', async () => {
      await seedFavorites(99);
      const result = await store.conversationAnnotations.saveAnnotation(
        makeRecord({ isFavorited: true, requestRunId: 'R-fl-100' as RequestRunId, annotationId: 'ann-fl-100' }),
        {},
      );
      expectAnnotation(result);
      expect(await countFavorites()).toBe(100);
    });

    it('rejects the 101st favorite with FAVORITE_LIMIT_EXCEEDED and no side effect', async () => {
      await seedFavorites(100);
      const result = await store.conversationAnnotations.saveAnnotation(
        makeRecord({ isFavorited: true, requestRunId: 'R-fl-101' as RequestRunId, annotationId: 'ann-fl-101' }),
        {},
      );
      expect(result).toMatchObject({ code: 'FAVORITE_LIMIT_EXCEEDED', category: 'VALIDATION', retryable: false });
      expect(await countFavorites()).toBe(100);
    });

    it('allows unfavorite at the limit', async () => {
      await seedFavorites(100);
      const result = await store.conversationAnnotations.saveAnnotation(
        makeRecord({ isFavorited: false, requestRunId: 'R-fl-1' as RequestRunId, sentiment: 'UP', annotationId: 'ann-fl-1' }),
        {},
      );
      expectAnnotation(result);
      expect(await countFavorites()).toBe(99);
    });

    it('allows re-favoriting an already-favorited row at the limit (true to true)', async () => {
      await seedFavorites(100);
      const result = await store.conversationAnnotations.saveAnnotation(
        makeRecord({ isFavorited: true, requestRunId: 'R-fl-1' as RequestRunId, annotationId: 'ann-fl-1' }),
        {},
      );
      expectAnnotation(result);
      expect(await countFavorites()).toBe(100);
    });

    it('allows sentiment-only update on a favorited row at the limit', async () => {
      await seedFavorites(100);
      const result = await store.conversationAnnotations.saveAnnotation(
        makeRecord({ sentiment: 'DOWN', requestRunId: 'R-fl-1' as RequestRunId, annotationId: 'ann-fl-1' }),
        {},
      );
      const ann = expectAnnotation(result);
      expect(ann.sentiment).toBe('DOWN');
      expect(ann.isFavorited).toBe(true);
      expect(await countFavorites()).toBe(100);
    });

    it('shares the limit across agent scope (per-user quota)', async () => {
      await seedFavorites(100);
      const result = await store.conversationAnnotations.saveAnnotation(
        makeRecord({ isFavorited: true, requestRunId: 'R-fl-A2' as RequestRunId, annotationId: 'ann-fl-A2', agentId: 'A2' as AgentId }),
        {},
      );
      expect(result).toMatchObject({ code: 'FAVORITE_LIMIT_EXCEEDED', category: 'VALIDATION', retryable: false });
    });

    it('releases quota after supersede cleanup', async () => {
      await seedFavorites(100);
      await store.conversationAnnotations.deleteAnnotationsByRun({
        tenantId: 'T1' as TenantId,
        subjectId: 'U1' as SubjectId,
        agentId: 'A1' as AgentId,
        requestRunId: 'R-fl-1' as RequestRunId,
      });
      expect(await countFavorites()).toBe(99);
      const result = await store.conversationAnnotations.saveAnnotation(
        makeRecord({ isFavorited: true, requestRunId: 'R-fl-new' as RequestRunId, annotationId: 'ann-fl-new' }),
        {},
      );
      expectAnnotation(result);
      expect(await countFavorites()).toBe(100);
    });

    it('idempotent replay of an accepted favorite is not rejected at the limit', async () => {
      const key = 'idem-fav-limit' as IdempotencyKey;
      const first = expectAnnotation(
        await store.conversationAnnotations.saveAnnotation(
          makeRecord({ isFavorited: true, requestRunId: 'R-fl-replay' as RequestRunId, annotationId: 'ann-fl-replay' }),
          { idempotencyKey: key },
        ),
      );
      await seedFavorites(99, 2);
      expect(await countFavorites()).toBe(100);
      const replay = await store.conversationAnnotations.saveAnnotation(
        makeRecord({ isFavorited: true, requestRunId: 'R-fl-replay' as RequestRunId, annotationId: 'ann-fl-replay' }),
        { idempotencyKey: key },
      );
      expectAnnotation(replay);
      expect((replay as ConversationAnnotationRecord).annotationId).toBe(first.annotationId);
      expect(await countFavorites()).toBe(100);
    });
  });
});

describe('conversation_shares gateway', () => {
  let dir: string;
  let store: ReturnType<typeof createSqliteGatewayStores>;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'share-test-'));
    store = createSqliteGatewayStores({ sqliteFile: join(dir, 'test.db') });
  });

  afterEach(() => {
    store.close?.();
    rmSync(dir, { recursive: true, force: true });
  });

  describe('createShare', () => {
    it('generates an unpredictable shareId of at least 22 characters', async () => {
      const result = expectShare(await store.conversationShares.createShare(makeShareRecord(), {}));
      expect(result.shareId.length).toBeGreaterThanOrEqual(22);

      const result2 = expectShare(await store.conversationShares.createShare(makeShareRecord(), {}));
      expect(result2.shareId).not.toBe(result.shareId);
    });

    it('stores frozen runIds snapshot', async () => {
      const result = expectShare(
        await store.conversationShares.createShare(makeShareRecord({ runIds: ['R1' as RequestRunId, 'R2' as RequestRunId] }), {}),
      );
      expect(result.runIds).toEqual(['R1', 'R2']);

      const loaded = expectShare(await store.conversationShares.loadShare({ shareId: result.shareId }));
      expect(loaded.runIds).toEqual(['R1', 'R2']);
    });

    it('stores allowedOps and expiresAt', async () => {
      const expiresAt = brand<number, 'EpochMillis'>(Date.now() + 7 * 24 * 60 * 60 * 1000);
      const result = expectShare(
        await store.conversationShares.createShare(makeShareRecord({ allowedOps: ['net:read', 'diag:run'], expiresAt }), {}),
      );
      expect(result.allowedOps).toEqual(['net:read', 'diag:run']);
      expect(result.expiresAt).toBe(expiresAt);
    });

    it('stores null allowedOps and null expiresAt for public permanent share', async () => {
      const result = expectShare(await store.conversationShares.createShare(makeShareRecord(), {}));
      expect(result.allowedOps).toBeNull();
      expect(result.expiresAt).toBeNull();
    });
  });

  describe('loadShare', () => {
    it('loads share by shareId globally without scope', async () => {
      const created = expectShare(await store.conversationShares.createShare(makeShareRecord(), {}));
      const loaded = expectShare(await store.conversationShares.loadShare({ shareId: created.shareId }));
      expect(loaded.shareId).toBe(created.shareId);
      expect(loaded.sessionId).toBe('S1' as SessionId);
      expect(loaded.originUrl).toBe('https://10.0.0.1:3000');
    });

    it('returns undefined for non-existent shareId', async () => {
      const result = await store.conversationShares.loadShare({ shareId: 'nonexistent' });
      expect(result).toBeUndefined();
    });
  });

  describe('idempotency', () => {
    it('returns first result on duplicate idempotencyKey without duplicate side effect', async () => {
      const key = 'idem-1' as IdempotencyKey;
      const first = expectShare(await store.conversationShares.createShare(makeShareRecord(), { idempotencyKey: key }));
      const second = expectShare(await store.conversationShares.createShare(makeShareRecord(), { idempotencyKey: key }));
      expect(second.shareId).toBe(first.shareId);

      // Only one row should exist for this idempotency key
      const loaded = expectShare(await store.conversationShares.loadShare({ shareId: first.shareId }));
      expect(loaded.shareId).toBe(first.shareId);
    });
  });

  describe('deleteSharesBySession', () => {
    it('deletes shares for the specified scope and session', async () => {
      const share1 = expectShare(await store.conversationShares.createShare(makeShareRecord({ sessionId: 'S1' as SessionId }), {}));
      const share2 = expectShare(await store.conversationShares.createShare(makeShareRecord({ sessionId: 'S2' as SessionId }), {}));

      await store.conversationShares.deleteSharesBySession({
        tenantId: 'T1' as TenantId,
        subjectId: 'U1' as SubjectId,
        agentId: 'A1' as AgentId,
        sessionId: 'S1' as SessionId,
      });

      const after1 = await store.conversationShares.loadShare({ shareId: share1.shareId });
      const after2 = await store.conversationShares.loadShare({ shareId: share2.shareId });
      expect(after1).toBeUndefined();
      expect(after2).toBeDefined();
    });

    it('only deletes shares within the same scope', async () => {
      const share1 = expectShare(
        await store.conversationShares.createShare(
          makeShareRecord({ tenantId: 'T1' as TenantId, subjectId: 'U1' as SubjectId, sessionId: 'S1' as SessionId }),
          {},
        ),
      );
      const share2 = expectShare(
        await store.conversationShares.createShare(
          makeShareRecord({ tenantId: 'T2' as TenantId, subjectId: 'U1' as SubjectId, sessionId: 'S1' as SessionId }),
          {},
        ),
      );

      await store.conversationShares.deleteSharesBySession({
        tenantId: 'T1' as TenantId,
        subjectId: 'U1' as SubjectId,
        agentId: 'A1' as AgentId,
        sessionId: 'S1' as SessionId,
      });

      const after1 = await store.conversationShares.loadShare({ shareId: share1.shareId });
      const after2 = await store.conversationShares.loadShare({ shareId: share2.shareId });
      expect(after1).toBeUndefined();
      expect(after2).toBeDefined();
    });
  });
});
