import { collectModelStream, modelEventStreamFixture } from '../../../tests/helpers/model-stream-fixture.js';
import {
  createReferenceRemoteModelGatewayProvider,
  createReferenceRemoteCronTaskGateway,
  createReferenceRemoteRagRetrievalGateway,
  createReferenceRemoteWorkflowRagGateway,
  createHttpWorkflowRagClient,
  createReferenceRemoteSandboxGateway,
  createReferenceRemoteScheduledMaintenanceGateway,
  createRemoteGatewayProvider,
  type RemoteGatewayReferenceBindings,
} from '../src/index.js';
import { brand } from '@nextagent/agent-common';
import type {
  ClaimCronTriggerRequest,
  CronTaskRecord,
  GatewayProviderCreateInput,
  RagRetrievalRequest,
  SandboxExecutionRequest,
  ScheduledMaintenanceJob,
} from '@nextagent/agent-contracts/gateway';
import type { ModelInvocationRequest } from '@nextagent/agent-contracts/model';
import { describe, expect, it, vi } from 'vitest';

describe('remote gateway provider reference', () => {
  it('creates selected remote bindings from explicit reference bindings', async () => {
    const sandbox = {
      async execute(request) {
        return {
          executionId: request.executionId,
          exitCode: 0,
          stdout: '',
          stderr: '',
          stdoutTruncated: false,
          stderrTruncated: false,
          timedOut: false,
          durationMs: 0,
        };
      },
    } satisfies NonNullable<RemoteGatewayReferenceBindings['sandbox']>;
    const ragRetrieval = {
      async retrieve() {
        return { status: 'UNAVAILABLE', results: [], diagnostics: { reason: 'PROVIDER_UNAVAILABLE' } };
      },
    } satisfies NonNullable<RemoteGatewayReferenceBindings['ragRetrieval']>;
    const scheduledMaintenance = {
      register() {},
      start() {},
      async stop() {},
      async runOnce() {
        return { status: 'SKIPPED', safeReasonCode: 'REMOTE_REFERENCE_NOOP' };
      },
    } satisfies NonNullable<RemoteGatewayReferenceBindings['scheduledMaintenance']>;
    const provider = createRemoteGatewayProvider({
      bindings: { sandbox, ragRetrieval, scheduledMaintenance },
    });

    const bindings = await provider.create(createInput(['sandbox', 'rag-knowledge', 'scheduled-maintenance', 'skillhub']));

    expect(provider.supportedAdapterKinds).toContain('working-memory');
    expect(provider.supportedAdapterKinds).toContain('long-term-memory');
    expect(bindings.readiness.state).toBe('READY');
    expect(bindings.sandbox).toBe(sandbox);
    expect(bindings.ragRetrieval).toBe(ragRetrieval);
    expect(bindings.scheduledMaintenance).toBe(scheduledMaintenance);
  });

  it('does not create unselected remote bindings as side effects', async () => {
    const provider = createRemoteGatewayProvider({
      bindings: {
        sandbox: {
          async execute(request) {
            return {
              executionId: request.executionId,
              exitCode: 0,
              stdout: '',
              stderr: '',
              stdoutTruncated: false,
              stderrTruncated: false,
              timedOut: false,
              durationMs: 0,
            };
          },
        },
      },
    });

    const bindings = await provider.create(createInput(['sandbox']));

    expect(bindings.readiness.state).toBe('READY');
    expect(bindings.sandbox).toBeDefined();
    expect(bindings.workingMemory).toBeUndefined();
    expect(bindings.longTermMemory).toBeUndefined();
    expect(bindings.sqliteStores).toBeUndefined();
    expect(bindings.ragRetrieval).toBeUndefined();
    expect(bindings.scheduledMaintenance).toBeUndefined();
  });

  it('blocks selected remote adapters when the reference binding is missing', async () => {
    const provider = createRemoteGatewayProvider({ bindings: {} });

    const bindings = await provider.create(createInput(['rag-knowledge']));

    expect(bindings.readiness).toEqual({
      state: 'BLOCKED',
      evidenceRef: 'gateway-provider:remote-gateway:ragRetrieval',
      safeMessage: 'Remote gateway provider bindings are not ready.',
    });
  });

  it('passes selected entries to a binding factory for vendor implementation replacement', async () => {
    const selectedEntries: unknown[] = [];
    const provider = createRemoteGatewayProvider({
      bindings: (input) => {
        selectedEntries.push(...input.selectedEntries);
        return {
          ragRetrieval: {
            async retrieve() {
              return { status: 'UNAVAILABLE', results: [], diagnostics: { reason: 'PROVIDER_UNAVAILABLE' } };
            },
          },
        };
      },
    });

    const bindings = await provider.create(createInput(['rag-knowledge']));

    expect(bindings.readiness.state).toBe('READY');
    expect(selectedEntries).toEqual([{ gatewayId: 'remote-rag-knowledge', adapterKind: 'rag-knowledge', deploymentMode: 'REMOTE' }]);
  });

  it('adapts a vendor sandbox client to the stable sandbox gateway port', async () => {
    const forwarded: unknown[] = [];
    const gateway = createReferenceRemoteSandboxGateway({
      async execute(request, signal) {
        forwarded.push(request, signal);
        return {
          executionId: request.executionId,
          exitCode: 0,
          stdout: 'ok',
          stderr: '',
          stdoutTruncated: false,
          stderrTruncated: false,
          timedOut: false,
          durationMs: 1,
        };
      },
    });
    const request = { executionId: 'exec-1' } as SandboxExecutionRequest;
    const signal = new AbortController().signal;

    const result = await gateway.execute(request, signal);

    expect(result.stdout).toBe('ok');
    expect(forwarded).toEqual([request, signal]);
  });

  it('adapts a vendor RAG client to the stable RAG retrieval port', async () => {
    const forwarded: unknown[] = [];
    const gateway = createReferenceRemoteRagRetrievalGateway({
      async retrieve(request, signal) {
        forwarded.push(request, signal);
        return { status: 'OK', results: [{ content: 'answer', source: 'kb/doc.md' }] };
      },
    });
    const request = { query: 'q' } as RagRetrievalRequest;
    const signal = new AbortController().signal;

    const result = await gateway.retrieve(request, signal);

    expect(result.status).toBe('OK');
    expect(forwarded).toEqual([request, signal]);
  });

  it('adapts a vendor scheduled maintenance client to the stable maintenance port', async () => {
    const forwarded: unknown[] = [];
    const gateway = createReferenceRemoteScheduledMaintenanceGateway({
      register(job) {
        forwarded.push('register', job);
      },
      start() {
        forwarded.push('start');
      },
      async stop() {
        forwarded.push('stop');
      },
      async runOnce(jobId, signal, now) {
        forwarded.push('runOnce', jobId, signal, now);
        return { status: 'COMPLETED', cleanedCount: 1 };
      },
    });
    const job = { jobId: 'job-1' } as ScheduledMaintenanceJob;
    const signal = new AbortController().signal;
    const now = new Date('2026-01-01T00:00:00Z');

    gateway.register(job);
    gateway.start();
    const result = await gateway.runOnce('job-1', signal, now);
    await gateway.stop();

    expect(result).toEqual({ status: 'COMPLETED', cleanedCount: 1 });
    expect(forwarded).toEqual(['register', job, 'start', 'runOnce', 'job-1', signal, now, 'stop']);
  });

  it('adapts a vendor Cron client to the stable Cron task gateway port', async () => {
    const forwarded: unknown[] = [];
    const task = cronTask('task-1');
    const gateway = createReferenceRemoteCronTaskGateway({
      async createTask(record, options, signal) {
        forwarded.push('createTask', record, options, signal);
        return record;
      },
      async loadTask(request, signal) {
        forwarded.push('loadTask', request, signal);
        return task;
      },
      async loadTaskForAgent(request, signal) {
        forwarded.push('loadTaskForAgent', request, signal);
        return task;
      },
      async listTasks(request, signal) {
        forwarded.push('listTasks', request, signal);
        return [task];
      },
      async listTasksForAgent(request, signal) {
        forwarded.push('listTasksForAgent', request, signal);
        return [task];
      },
      async countTasksForAgent(request, signal) {
        forwarded.push('countTasksForAgent', request, signal);
        return 1;
      },
      async countActiveTasksForAgent(request, signal) {
        forwarded.push('countActiveTasksForAgent', request, signal);
        return 2;
      },
      async updateTask(record, options, signal) {
        forwarded.push('updateTask', record, options, signal);
        return record;
      },
      async deleteTask(request, options, signal) {
        forwarded.push('deleteTask', request, options, signal);
        return { ...task, status: 'DELETED' };
      },
      async listDueTasks(request, signal) {
        forwarded.push('listDueTasks', request, signal);
        return [task];
      },
      async listClaimedTriggers(request, signal) {
        forwarded.push('listClaimedTriggers', request, signal);
        return [];
      },
      async loadTriggerDelivery(request, signal) {
        forwarded.push('loadTriggerDelivery', request, signal);
        return undefined;
      },
      async loadTrigger(request, signal) {
        forwarded.push('loadTrigger', request, signal);
        return undefined;
      },
      async listTriggersForTask(request, signal) {
        forwarded.push('listTriggersForTask', request, signal);
        return [];
      },
      async countTriggersForTask(request, signal) {
        forwarded.push('countTriggersForTask', request, signal);
        return 1;
      },
      async claimCronTrigger(request, signal) {
        forwarded.push('claimCronTrigger', request, signal);
        return {
          status: 'CLAIMED',
          task,
          trigger: {
            tenantId: task.tenantId,
            subjectId: task.subjectId,
            agentId: task.agentId,
            taskId: task.taskId,
            triggerId: request.triggerId,
            scheduledAt: request.scheduledAt,
            status: 'CLAIMED',
            createdAt: request.claimedAt,
            updatedAt: request.claimedAt,
          },
        };
      },
      async bindCronTriggerRun(request, signal) {
        forwarded.push('bindCronTriggerRun', request, signal);
        return { status: 'BOUND' };
      },
    });
    const signal = new AbortController().signal;
    const executionSessionId = brand<string, 'SessionId'>('session-cron-exec');
    const lookup = { tenantId: task.tenantId, subjectId: task.subjectId, agentId: task.agentId, taskId: task.taskId };
    const claim: ClaimCronTriggerRequest = {
      tenantId: task.tenantId,
      subjectId: task.subjectId,
      agentId: task.agentId,
      taskId: task.taskId,
      scheduledAt: task.nextRunAt,
      triggerId: 'trigger-1',
      claimedAt: brand<number, 'EpochMillis'>(1_700_000_000_100),
    };

    await gateway.createTask(task, { idempotencyKey: brand<string, 'IdempotencyKey'>('cron-task-1') }, signal);
    await gateway.loadTask(lookup, signal);
    await gateway.loadTaskForAgent({ tenantId: task.tenantId, subjectId: task.subjectId, agentId: task.agentId, taskId: task.taskId }, signal);
    await gateway.listTasks({ tenantId: task.tenantId, subjectId: task.subjectId, agentId: task.agentId }, signal);
    await gateway.listTasksForAgent({ tenantId: task.tenantId, subjectId: task.subjectId, agentId: task.agentId }, signal);
    await expect(gateway.countTasksForAgent({ tenantId: task.tenantId, subjectId: task.subjectId, agentId: task.agentId }, signal)).resolves.toBe(1);
    await expect(
      gateway.countActiveTasksForAgent!({ tenantId: task.tenantId, subjectId: task.subjectId, agentId: task.agentId }, signal),
    ).resolves.toBe(2);
    await gateway.updateTask({ ...task, prompt: 'updated' }, { expectedVersion: 1 }, signal);
    await gateway.deleteTask(lookup, { expectedVersion: 1, idempotencyKey: brand<string, 'IdempotencyKey'>('delete-1') }, signal);
    await gateway.listDueTasks({ dueAtOrBefore: task.nextRunAt, limit: 10 }, signal);
    await gateway.listClaimedTriggers({ limit: 10 }, signal);
    await gateway.loadTriggerDelivery({ taskId: task.taskId, triggerId: 'trigger-1' }, signal);
    await gateway.loadTrigger(
      { tenantId: task.tenantId, subjectId: task.subjectId, agentId: task.agentId, taskId: task.taskId, triggerId: 'trigger-1' },
      signal,
    );
    await gateway.listTriggersForTask({ tenantId: task.tenantId, subjectId: task.subjectId, agentId: task.agentId, taskId: task.taskId }, signal);
    await expect(
      gateway.countTriggersForTask({ tenantId: task.tenantId, subjectId: task.subjectId, agentId: task.agentId, taskId: task.taskId }, signal),
    ).resolves.toBe(1);
    const claimed = await gateway.claimCronTrigger(claim, signal);
    await gateway.bindCronTriggerRun(
      {
        tenantId: task.tenantId,
        subjectId: task.subjectId,
        agentId: task.agentId,
        sessionId: executionSessionId,
        taskId: task.taskId,
        triggerId: 'trigger-1',
        requestRunId: brand<string, 'RequestRunId'>('run-1'),
        acceptedAt: brand<number, 'EpochMillis'>(1_700_000_000_200),
      },
      signal,
    );

    expect(claimed.status).toBe('CLAIMED');
    expect(claimed.trigger?.sessionId).toBeUndefined();
    expect(forwarded.map((entry) => (typeof entry === 'string' ? entry : undefined)).filter(Boolean)).toEqual([
      'createTask',
      'loadTask',
      'loadTaskForAgent',
      'listTasks',
      'listTasksForAgent',
      'countTasksForAgent',
      'countActiveTasksForAgent',
      'updateTask',
      'deleteTask',
      'listDueTasks',
      'listClaimedTriggers',
      'loadTriggerDelivery',
      'loadTrigger',
      'listTriggersForTask',
      'countTriggersForTask',
      'claimCronTrigger',
      'bindCronTriggerRun',
    ]);
  });

  it('rejects malformed vendor Cron responses before returning gateway facts', async () => {
    const gateway = createReferenceRemoteCronTaskGateway({
      async createTask() {
        return { taskId: 'task-1', status: 'BROKEN' } as never;
      },
      async loadTask() {
        return undefined;
      },
      async loadTaskForAgent() {
        return undefined;
      },
      async listTasks() {
        return [];
      },
      async listTasksForAgent() {
        return [];
      },
      async countTasksForAgent() {
        return -1;
      },
      async countActiveTasksForAgent() {
        return -1;
      },
      async updateTask() {
        return { taskId: 'task-1', status: 'BROKEN' } as never;
      },
      async deleteTask() {
        return undefined;
      },
      async listDueTasks() {
        return [];
      },
      async listClaimedTriggers() {
        return [{ task: cronTask('task-1'), trigger: { status: 'BROKEN' } }] as never;
      },
      async loadTriggerDelivery() {
        return { task: cronTask('task-1'), trigger: { status: 'BROKEN' } } as never;
      },
      async loadTrigger() {
        return undefined;
      },
      async listTriggersForTask() {
        return [{ status: 'BROKEN' }] as never;
      },
      async countTriggersForTask() {
        return -1;
      },
      async claimCronTrigger() {
        return { status: 'BROKEN' } as never;
      },
      async bindCronTriggerRun() {
        return { status: 'BROKEN' } as never;
      },
    });
    const task = cronTask('task-1');

    await expect(gateway.createTask(task)).rejects.toThrow('Remote Cron gateway returned an invalid response.');
    await expect(gateway.updateTask(task)).rejects.toThrow('Remote Cron gateway returned an invalid response.');
    await expect(gateway.countTasksForAgent({ tenantId: task.tenantId, subjectId: task.subjectId, agentId: task.agentId })).rejects.toThrow(
      'Remote Cron gateway returned an invalid response.',
    );
    await expect(gateway.countActiveTasksForAgent!({ tenantId: task.tenantId, subjectId: task.subjectId, agentId: task.agentId })).rejects.toThrow(
      'Remote Cron gateway returned an invalid response.',
    );
    await expect(gateway.listClaimedTriggers({ limit: 1 })).rejects.toThrow('Remote Cron gateway returned an invalid response.');
    await expect(gateway.loadTriggerDelivery({ taskId: 'task-1', triggerId: 'trigger-1' })).rejects.toThrow(
      'Remote Cron gateway returned an invalid response.',
    );
    await expect(
      gateway.listTriggersForTask({ tenantId: task.tenantId, subjectId: task.subjectId, agentId: task.agentId, taskId: task.taskId }),
    ).rejects.toThrow('Remote Cron gateway returned an invalid response.');
    await expect(
      gateway.countTriggersForTask({ tenantId: task.tenantId, subjectId: task.subjectId, agentId: task.agentId, taskId: task.taskId }),
    ).rejects.toThrow('Remote Cron gateway returned an invalid response.');
    await expect(
      gateway.claimCronTrigger({
        tenantId: task.tenantId,
        subjectId: task.subjectId,
        agentId: task.agentId,
        taskId: task.taskId,
        scheduledAt: task.nextRunAt,
        triggerId: 'trigger-1',
        claimedAt: brand<number, 'EpochMillis'>(1_700_000_000_100),
      }),
    ).rejects.toThrow('Remote Cron gateway returned an invalid response.');
    await expect(
      gateway.bindCronTriggerRun({
        tenantId: task.tenantId,
        subjectId: task.subjectId,
        agentId: task.agentId,
        sessionId: brand<string, 'SessionId'>('session-cron-exec'),
        taskId: task.taskId,
        triggerId: 'trigger-1',
        requestRunId: brand<string, 'RequestRunId'>('run-1'),
        acceptedAt: brand<number, 'EpochMillis'>(1_700_000_000_200),
      }),
    ).rejects.toThrow('Remote Cron gateway returned an invalid response.');
  });

  it('creates a MODEL_GATEWAY provider that adapts a vendor model gateway client', async () => {
    const forwarded: unknown[] = [];
    const provider = createReferenceRemoteModelGatewayProvider({
      providerId: 'vendor-model-gateway',
      client: {
        async complete(request, signal) {
          forwarded.push('complete', request, signal);
          return { content: 'complete ok', providerResponseId: request.modelId };
        },
        stream: modelEventStreamFixture(async function* (request, signal) {
          forwarded.push('stream', request, signal);
          yield { content: 'stream ok' };
          yield { content: 'final ok', finishReason: 'stop' };
        }),
      },
    });
    const service = provider.createModelService();
    const request = {
      ...modelRequest(),
      toolChoice: 'NONE' as const,
      tools: [{ capabilityId: 'Read', name: 'Read', inputSchema: {} }],
    };
    const signal = new AbortController().signal;

    const complete = await service.complete(request, signal);
    const stream = await collectModelStream(service, request, signal);

    expect(provider).toMatchObject({ providerId: 'vendor-model-gateway' });
    expect(complete).toEqual({ content: 'complete ok', providerResponseId: 'gateway-model' });
    expect(stream).toEqual([{ content: 'stream ok' }, { content: 'final ok', finishReason: 'stop' }]);
    expect(forwarded).toEqual(['complete', request, signal, 'stream', request, signal]);
  });

  it('fails safely when a remote model stream returns an invalid terminal result', async () => {
    const provider = createReferenceRemoteModelGatewayProvider({
      client: {
        async complete() {
          return { content: 'complete-only result' };
        },
        async stream() {
          return undefined as never;
        },
      },
    });
    const events = await collectModelStream(provider.createModelService(), modelRequest(), new AbortController().signal);

    expect(events).toEqual([
      expect.objectContaining({
        safeError: expect.objectContaining({
          code: 'MODEL_GATEWAY_UNAVAILABLE',
          category: 'UNAVAILABLE',
        }),
      }),
    ]);
  });

  it('normalizes remote model gateway failures without leaking raw provider details', async () => {
    const provider = createReferenceRemoteModelGatewayProvider({
      client: {
        async complete() {
          throw new Error('token=secret C:/vendor/model-gateway.ts');
        },
        stream: modelEventStreamFixture(async function* () {
          yield { finishReason: 'stop' } as never;
        }),
      },
    });
    const service = provider.createModelService();

    const complete = await service.complete(modelRequest(), new AbortController().signal);
    const stream = await collectModelStream(service, modelRequest(), new AbortController().signal);

    expect(complete).toEqual({
      content: '',
      safeError: {
        code: 'MODEL_GATEWAY_UNAVAILABLE',
        message: 'Remote model gateway is unavailable.',
        category: 'UNAVAILABLE',
        retryable: true,
      },
    });
    expect(stream).toEqual([complete]);
    expect(JSON.stringify([complete, stream])).not.toContain('secret');
    expect(JSON.stringify([complete, stream])).not.toContain('model-gateway.ts');
  });

  it('rejects nested closed-schema violations from a remote model gateway', async () => {
    const provider = createReferenceRemoteModelGatewayProvider({
      client: {
        async complete() {
          return {
            content: 'invalid',
            usage: { inputTokens: 1, unknown: 2 },
          } as never;
        },
        async stream(_request, _signal, onDelta) {
          await onDelta({
            toolCall: {
              toolCallId: 'call-1',
              toolName: 'Read',
              arguments: {},
              unknown: true,
            },
          } as never);
          return { content: 'unused', finishReason: 'stop' };
        },
      },
    });
    const service = provider.createModelService();

    const complete = await service.complete(modelRequest(), new AbortController().signal);
    const stream = await collectModelStream(service, modelRequest(), new AbortController().signal);

    expect(complete).toMatchObject({
      safeError: { code: 'MODEL_GATEWAY_UNAVAILABLE', category: 'UNAVAILABLE' },
    });
    expect(stream).toEqual([complete]);
  });

  it('adapts a vendor workflow RAG client and passes through per-index params', async () => {
    const forwarded: unknown[] = [];
    const gateway = createReferenceRemoteWorkflowRagGateway({
      async retrieve(request, signal) {
        forwarded.push(request, signal);
        return { status: 'OK', recommends: [{ id: 'kb/doc.md', title: 'doc.md', knowledge: 'answer', rankHint: '1' }] };
      },
    });
    const request = {
      tenantId: brand<string, 'TenantId'>('t'),
      subjectId: brand<string, 'SubjectId'>('s'),
      agentId: brand<string, 'AgentId'>('a'),
      agentVersion: brand<string, 'AgentVersion'>('v1'),
      knowledgeScope: { scopeKind: 'AGENT_WORKSPACE' as const, logicalRoot: 'workspace' as const },
      query: 'RRC failure',
      indexes: [{ indexName: 'ran-kb', indexType: 'KNOWLEDGE' as const, vsTopN: 5, esTopN: 3, filters: { region: 'east' } }],
      options: { topK: 3 },
    };
    const signal = new AbortController().signal;

    const result = await gateway.retrieve(request, signal);

    expect(result.status).toBe('OK');
    expect(forwarded).toEqual([request, signal]);
  });

  it('HTTP client rejects malformed workflow RAG responses', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(
      async () =>
        ({
          ok: true,
          json: async () => ({ status: 'BROKEN' }),
        }) as never,
    );
    try {
      const client = createHttpWorkflowRagClient('http://test-endpoint');
      const request = {
        tenantId: brand<string, 'TenantId'>('t'),
        subjectId: brand<string, 'SubjectId'>('s'),
        agentId: brand<string, 'AgentId'>('a'),
        agentVersion: brand<string, 'AgentVersion'>('v1'),
        knowledgeScope: { scopeKind: 'AGENT_WORKSPACE' as const, logicalRoot: 'workspace' as const },
        query: 'test',
        indexes: [{ indexName: 'idx', indexType: 'KNOWLEDGE' as const }],
        options: { topK: 1 },
      };

      await expect(client.retrieve(request)).rejects.toThrow('Remote workflow RAG returned an invalid response.');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('HTTP client maps WorkflowRagRetrievalRequest to platform ragIndexes wire format', async () => {
    const originalFetch = globalThis.fetch;
    const capturedBodies: unknown[] = [];
    globalThis.fetch = vi.fn(async (_input: URL | RequestInfo, init?: RequestInit) => {
      capturedBodies.push(JSON.parse(init?.body as string));
      return {
        ok: true,
        json: async () => ({
          status: 'OK',
          recommends: [{ id: 'kb/doc.md', title: 'doc.md', knowledge: 'answer', vsScore: 0.9 }],
        }),
      } as never;
    });
    try {
      const client = createHttpWorkflowRagClient('http://test-endpoint');
      const request = {
        tenantId: brand<string, 'TenantId'>('t'),
        subjectId: brand<string, 'SubjectId'>('s'),
        agentId: brand<string, 'AgentId'>('a'),
        agentVersion: brand<string, 'AgentVersion'>('v1'),
        knowledgeScope: { scopeKind: 'AGENT_WORKSPACE' as const, logicalRoot: 'workspace' as const },
        query: 'RRC failure',
        indexes: [
          { indexName: 'ran-kb', indexType: 'KNOWLEDGE' as const, vsTopN: 5, esTopN: 3, filters: { region: 'east' } },
          { indexName: 'api-catalog', indexType: 'API' as const },
        ],
        options: { topK: 3 },
      };

      const result = await client.retrieve(request);

      expect(result.status).toBe('OK');
      expect(capturedBodies).toHaveLength(1);
      const body = capturedBodies[0] as Record<string, unknown>;
      expect(body.query).toBe('RRC failure');
      expect(body.ragIndexes).toBeDefined();
      expect(body.indexes).toBeUndefined();
      const ragIndexes = body.ragIndexes as ReadonlyArray<Record<string, unknown>>;
      expect(ragIndexes).toHaveLength(2);
      expect(ragIndexes[0]).toEqual({ ragIndex: 'ran-kb', indexType: 'KNOWLEDGE', vsTopN: 5, esTopN: 3, filters: { region: 'east' } });
      expect(ragIndexes[1]).toEqual({ ragIndex: 'api-catalog', indexType: 'API' });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('HTTP workflow RAG propagates the active execution trace headers', async () => {
    const originalFetch = globalThis.fetch;
    const capturedHeaders: HeadersInit[] = [];
    globalThis.fetch = vi.fn(async (_input: URL | RequestInfo, init?: RequestInit) => {
      capturedHeaders.push(init?.headers ?? {});
      return {
        ok: true,
        json: async () => ({ status: 'OK', recommends: [] }),
      } as never;
    });
    try {
      const client = createHttpWorkflowRagClient('http://test-endpoint', {
        async withIncomingCarrier(_carrier, operation) {
          return operation();
        },
        async withExecutionRef(_ref, operation) {
          return operation();
        },
        outboundHeaders(input = {}) {
          return {
            ...input,
            traceparent: '00-11111111111111111111111111111111-2222222222222222-01',
            'x-task-event-id': 'task-01',
          };
        },
      });

      await client.retrieve({
        tenantId: brand<string, 'TenantId'>('t'),
        subjectId: brand<string, 'SubjectId'>('s'),
        agentId: brand<string, 'AgentId'>('a'),
        agentVersion: brand<string, 'AgentVersion'>('v1'),
        knowledgeScope: { scopeKind: 'AGENT_WORKSPACE', logicalRoot: 'workspace' },
        query: 'RRC failure',
        indexes: [{ indexName: 'ran-kb', indexType: 'KNOWLEDGE' }],
        options: { topK: 1 },
      });

      expect(capturedHeaders[0]).toMatchObject({
        traceparent: '00-11111111111111111111111111111111-2222222222222222-01',
        'x-task-event-id': 'task-01',
      });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('yields workflowRagRetrieval when rag-knowledge is selected with binding', async () => {
    const workflowRag = {
      async retrieve(): Promise<{ status: 'OK'; recommends: readonly [] }> {
        return { status: 'OK', recommends: [] };
      },
    } satisfies NonNullable<RemoteGatewayReferenceBindings['workflowRagRetrieval']>;
    const provider = createRemoteGatewayProvider({
      bindings: {
        ragRetrieval: {
          async retrieve() {
            return { status: 'UNAVAILABLE', results: [], diagnostics: { reason: 'PROVIDER_UNAVAILABLE' } };
          },
        },
        workflowRagRetrieval: workflowRag,
      },
    });

    const bindings = await provider.create(createInput(['rag-knowledge']));

    expect(bindings.readiness.state).toBe('READY');
    expect(bindings.workflowRagRetrieval).toBe(workflowRag);
  });
});

function createInput(adapterKinds: ReadonlyArray<GatewayProviderCreateInput['selectedEntries'][number]['adapterKind']>): GatewayProviderCreateInput {
  return {
    selectedEntries: adapterKinds.map((adapterKind) => ({
      gatewayId: `remote-${adapterKind}`,
      adapterKind,
      deploymentMode: 'REMOTE',
    })),
    runtime: {
      paths: {
        workingMemorySqliteFile: 'remote-working-memory.sqlite',
        longTermMemorySqliteFile: 'remote-long-term-memory.sqlite',
        sqliteFile: 'remote.sqlite',
        workspaceRoot: '.',
        logDirectory: '.nextagent/logs',
        runtimeWorkspaceRoot: '.nextagent/runtime',
      },
      sandbox: {
        enabled: true,
        deniedExecutables: [],
      },
    },
  };
}

function modelRequest(): ModelInvocationRequest {
  return {
    invocationScope: {
      tenantId: brand<string, 'TenantId'>('tenant-1'),
      subjectId: brand<string, 'SubjectId'>('subject-1'),
      agentId: brand<string, 'AgentId'>('agent-1'),
      agentVersion: brand<string, 'AgentVersion'>('v1'),
      agentAssemblyRef: 'agent-1:v1',
      operationId: 'turn-1',
      sessionId: brand<string, 'SessionId'>('session-1'),
      requestId: brand<string, 'MessageId'>('request-1'),
      runId: brand<string, 'RequestRunId'>('run-1'),
    },
    modelId: 'gateway-model',
    messages: [{ role: 'USER', content: [{ type: 'text', text: 'hello' }] }],
    tools: [],
    timeoutMs: 30_000,
  };
}

function cronTask(taskId: string): CronTaskRecord {
  return {
    tenantId: brand<string, 'TenantId'>('tenant-1'),
    subjectId: brand<string, 'SubjectId'>('subject-1'),
    agentId: brand<string, 'AgentId'>('agent-1'),
    taskId,
    cron: '* * * * *',
    prompt: 'check alarm',
    recurring: true,
    status: 'ACTIVE',
    nextRunAt: brand<number, 'EpochMillis'>(1_700_000_000_000),
    version: 1,
    createdAt: brand<number, 'EpochMillis'>(1_699_999_999_000),
    updatedAt: brand<number, 'EpochMillis'>(1_699_999_999_000),
  };
}
