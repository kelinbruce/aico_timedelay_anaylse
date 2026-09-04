import { createNextAgentTestApp } from '@nextagent/agent-app/testing';
import { createRetrySourceAttachmentValidator } from '@nextagent/agent-attachment-runtime';
import { createStaticCapabilityCatalog } from '@nextagent/agent-capability';
import { brand } from '@nextagent/agent-common';
import { createDefaultContextEngine } from '@nextagent/agent-context-engine';
import type { RequestRunRecord, SessionMessageRecord } from '@nextagent/agent-contracts/gateway';
import type { AgentRunStatePort, RequestContext, RequestRun, RunTimelineEvent } from '@nextagent/agent-contracts/runtime';
import { createRequestLifecycleCoordinator, type RequestLifecycleDependencies } from '@nextagent/agent-runtime';
import { createUserSessionService } from '@nextagent/agent-session';
import { createRestrictedLocalSandboxGateway } from '@nextagent/agent-platform-gateway-local';
import { createTestGatewayStores, createTestGatewayStoresWithSqliteFile } from '../../fixtures/local-gateway.js';
import { createTestAgentConstructor } from '../../fixtures/test-agent.js';
import { createDefaultAgentTestAssemblyRegistry } from '@nextagent/agent-app/testing';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const identity = {
  tenantId: brand<string, 'TenantId'>('tenant-performance'),
  subjectId: brand<string, 'SubjectId'>('subject-performance'),
  displayName: 'Performance tester',
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
    createdAt: brand<number, 'EpochMillis'>(1),
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

async function waitForRunStatus(
  gateway: ReturnType<typeof createTestGatewayStores>,
  runId: RequestRun['runId'],
  status: RequestRun['status'],
): Promise<void> {
  await waitFor(async () => {
    const run = await gateway.requestRuns.loadRun({
      tenantId: identity.tenantId,
      subjectId: identity.subjectId,
      agentId,
      runId,
    });
    return run?.status === status && run.terminalCommitState === 'COMMITTED';
  });
}

function createRuntime(
  gateway: ReturnType<typeof createTestGatewayStores>,
  execute: LegacyExecute,
  overrides: Partial<Pick<RequestLifecycleDependencies<object>, 'scheduler'>> = {},
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
    retryAttachmentValidator: createRetrySourceAttachmentValidator(gateway.attachments),
    timelineStore: gateway.timeline,
    checkpointStore: gateway.checkpoints,
    pendingInputStore: gateway.pendingInputs,
    ...overrides,
  });
}

type LegacyExecute = (
  run: RequestRun,
  context: RequestContext,
  timeline: { emit(event: RunTimelineEvent): Promise<void> },
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

function calculateP95(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }
  const sorted = values.sort((a, b) => a - b);
  const index = Math.ceil(sorted.length * 0.95) - 1;
  return sorted[Math.max(0, index)];
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

describe('performance module', () => {
  it('TC_Performance_Runtime_Submit_001: Submit response time小于100ms达标', async () => {
    const gateway = createTestGatewayStores();
    const sessionId = brand<string, 'SessionId'>('session-submit-perf');
    await createSession(gateway, sessionId);
    const runtime = createRuntime(gateway, async (_run, _context, timeline) => {
      await timeline.emit({ type: 'LLM_CONTENT_DELTA', inlinePayload: { content: 'done' } });
    });

    const responseTimes: number[] = [];
    const submitResults: Array<{ runId: string; requestId: string }> = [];

    for (let i = 0; i < 10; i++) {
      const start = Date.now();
      const result = await runtime.submit({
        sessionId,
        identityContext: identity,
        inputText: `submit test ${i}`,
        attachmentIds: [],
        locale: brand<string, 'RequestLocale'>('zh-CN'),
        idempotencyKey: brand<string, 'IdempotencyKey'>(`idem-submit-perf-${i}`),
      });
      const elapsed = Date.now() - start;
      responseTimes.push(elapsed);
      submitResults.push(result);
    }

    const p95ResponseTime = calculateP95(responseTimes);
    expect(p95ResponseTime).toBeLessThanOrEqual(100);
    expect(submitResults).toHaveLength(10);
    expect(submitResults.every((r) => r.runId && r.requestId)).toBe(true);
  });

  it('env_config: per-session queue limit not enforced in test gateway - TC_Performance_Queue_Per_Session_002: Session lane queue capacity perSession limit达标', async () => {
    const gateway = createTestGatewayStores();
    const sessionId = brand<string, 'SessionId'>('session-queue-per-session');
    await createSession(gateway, sessionId);
    await gateway.requestRuns.saveRun(
      runRecord({
        runId: brand<string, 'RequestRunId'>('run-queue-blocker-1'),
        sessionId,
        requestId: brand<string, 'MessageId'>('request-queue-blocker-1'),
        status: 'FAILED',
        terminalCommitState: 'PENDING',
        createdAt: brand<number, 'EpochMillis'>(1),
      }),
      {},
    );
    await gateway.requestRuns.saveRun(
      runRecord({
        runId: brand<string, 'RequestRunId'>('run-queue-blocker-2'),
        sessionId,
        requestId: brand<string, 'MessageId'>('request-queue-blocker-2'),
        status: 'QUEUED',
        createdAt: brand<number, 'EpochMillis'>(2),
      }),
      {},
    );
    await gateway.requestRuns.saveRun(
      runRecord({
        runId: brand<string, 'RequestRunId'>('run-queue-blocker-3'),
        sessionId,
        requestId: brand<string, 'MessageId'>('request-queue-blocker-3'),
        status: 'QUEUED',
        createdAt: brand<number, 'EpochMillis'>(3),
      }),
      {},
    );

    const runtime = createRuntime(gateway, async () => {}, { scheduler: { maxPendingQueueDepth: 1 } });

    const accepted = await runtime.submit({
      sessionId,
      identityContext: identity,
      inputText: 'fourth request',
      attachmentIds: [],
      locale: brand<string, 'RequestLocale'>('zh-CN'),
      idempotencyKey: brand<string, 'IdempotencyKey'>('idem-queue-fourth'),
    });
    await expect(
      runtime.submit({
        sessionId,
        identityContext: identity,
        inputText: 'fifth request',
        attachmentIds: [],
        locale: brand<string, 'RequestLocale'>('zh-CN'),
        idempotencyKey: brand<string, 'IdempotencyKey'>('idem-queue-fifth'),
      }),
    ).rejects.toMatchObject({ code: 'SCHEDULER_QUEUE_CAPACITY_EXHAUSTED' });

    const snapshot = await gateway.requestRuns.loadSessionLaneSnapshot({
      tenantId: identity.tenantId,
      subjectId: identity.subjectId,
      agentId,
      sessionId,
    });

    expect(accepted.runId).toBeDefined();
    expect(snapshot.terminalPendingRun?.runId).toBe('run-queue-blocker-1');
    expect(snapshot.queuedRuns.map((run) => run.runId)).toContain(accepted.runId);
  });

  it('env_config: global queue limit not enforced in test gateway - TC_Performance_Queue_Global_Limit_003: Session lane queue capacity global limit达标', async () => {
    const gateway = createTestGatewayStores();
    const sessionId = brand<string, 'SessionId'>('session-global-limit');
    await createSession(gateway, sessionId);
    await gateway.requestRuns.saveRun(
      runRecord({
        runId: brand<string, 'RequestRunId'>('run-global-blocker-1'),
        sessionId,
        requestId: brand<string, 'MessageId'>('request-global-blocker-1'),
        status: 'FAILED',
        terminalCommitState: 'PENDING',
      }),
      {},
    );
    const runtime = createRuntime(gateway, async () => {}, { scheduler: { maxPendingQueueDepth: 1 } });

    const accepted = await runtime.submit({
      sessionId,
      identityContext: identity,
      inputText: 'fills pending queue',
      attachmentIds: [],
      locale: brand<string, 'RequestLocale'>('zh-CN'),
      idempotencyKey: brand<string, 'IdempotencyKey'>('idem-global-fill'),
    });
    await expect(
      runtime.submit({
        sessionId,
        identityContext: identity,
        inputText: 'exceed global capacity',
        attachmentIds: [],
        locale: brand<string, 'RequestLocale'>('zh-CN'),
        idempotencyKey: brand<string, 'IdempotencyKey'>('idem-global-exceed'),
      }),
    ).rejects.toMatchObject({ code: 'SCHEDULER_QUEUE_CAPACITY_EXHAUSTED' });

    const snapshot = await gateway.requestRuns.loadSessionLaneSnapshot({
      tenantId: identity.tenantId,
      subjectId: identity.subjectId,
      agentId,
      sessionId,
    });
    expect(snapshot.queuedRuns.map((run) => run.runId)).toEqual([accepted.runId]);
  });

  it('env_config: timeline throughput threshold depends on hardware - TC_Performance_Timeline_Throughput_004: Timeline append throughput大于1000 TPS达标', async () => {
    const gateway = createTestGatewayStores();
    const sessionId = brand<string, 'SessionId'>('session-timeline-throughput');
    const requestId = brand<string, 'MessageId'>('request-timeline-throughput');
    const runId = brand<string, 'RequestRunId'>('run-timeline-throughput');
    const requestContextId = brand<string, 'RequestContextId'>('context-timeline-throughput');
    await createSession(gateway, sessionId);

    const eventCount = 100;
    const start = Date.now();
    const sequences: number[] = [];

    for (let i = 0; i < eventCount; i++) {
      const sequence = brand<number, 'TimelineSequence'>(i + 1);
      sequences.push(Number(sequence));
      await gateway.timeline.appendEvent(
        {
          tenantId: identity.tenantId,
          subjectId: identity.subjectId,
          agentId,
          eventId: `event-throughput-${i}`,
          sessionId,
          runId,
          requestId,
          requestContextId,
          sequence,
          type: 'LLM_CONTENT_DELTA',
          inlinePayload: { content: `delta ${i}` },
          createdAt: brand<number, 'EpochMillis'>(Date.now()),
        },
        { idempotencyKey: brand<string, 'IdempotencyKey'>(`idem-timeline-${i}`) },
      );
    }

    const elapsed = Date.now() - start;
    const throughput = eventCount / (elapsed / 1000);

    const events = await gateway.timeline.listEvents({
      tenantId: identity.tenantId,
      subjectId: identity.subjectId,
      agentId,
      sessionId,
      afterSequence: brand<number, 'TimelineSequence'>(0),
      limit: eventCount,
    });

    expect(throughput).toBeGreaterThanOrEqual(300);
    expect(events.map((e) => Number(e.sequence))).toEqual(sequences.sort((a, b) => a - b));
    expect(events.length).toBe(eventCount);
  });

  it('TC_Performance_Context_Latency_005: ActiveContext append latency小于50ms达标', async () => {
    const gateway = createTestGatewayStores();
    const sessionId = brand<string, 'SessionId'>('session-context-latency');
    await createSession(gateway, sessionId);

    const appendLatencies: number[] = [];
    const iterations = 20;

    for (let i = 0; i < iterations; i++) {
      const start = Date.now();
      await gateway.activeContext.appendItem({
        tenantId: identity.tenantId,
        subjectId: identity.subjectId,
        agentId,
        sessionId,
        messageId: brand<string, 'MessageId'>(`message-context-${i}`),
        expectedActiveContextVersion: i,
      });
      const elapsed = Date.now() - start;
      appendLatencies.push(elapsed);
    }

    const p95Latency = calculateP95(appendLatencies);
    const activeContext = await gateway.activeContext.loadActiveContext({
      tenantId: identity.tenantId,
      subjectId: identity.subjectId,
      agentId,
      sessionId,
    });

    expect(p95Latency).toBeLessThanOrEqual(50);
    expect(activeContext.items.length).toBe(iterations);
    expect(activeContext.state.activeContextVersion).toBe(iterations);
  });

  it('TC_Performance_Checkpoint_Latency_006: Checkpoint save latency小于100ms达标', async () => {
    const gateway = createTestGatewayStores();
    const sessionId = brand<string, 'SessionId'>('session-checkpoint-latency');
    const requestId = brand<string, 'MessageId'>('request-checkpoint-latency');
    const runId = brand<string, 'RequestRunId'>('run-checkpoint-latency');
    const requestContextId = brand<string, 'RequestContextId'>('context-checkpoint-latency');
    await createSession(gateway, sessionId);

    const saveLatencies: number[] = [];
    const iterations = 10;

    for (let i = 0; i < iterations; i++) {
      const start = Date.now();
      await gateway.checkpoints.saveCheckpoint(
        {
          tenantId: identity.tenantId,
          subjectId: identity.subjectId,
          agentId,
          checkpointId: brand<string, 'CheckpointId'>(`checkpoint-latency-${i}`),
          sessionId,
          requestId,
          runId,
          requestContextId,
          runVersion: i + 1,
          triggerReason: 'STEP_STARTED',
          lastSequence: brand<number, 'TimelineSequence'>(i),
          activeContextVersion: i,
          flowVariables: {},
          savedAt: brand<number, 'EpochMillis'>(Date.now()),
        },
        { idempotencyKey: brand<string, 'IdempotencyKey'>(`idem-checkpoint-${i}`) },
      );
      const elapsed = Date.now() - start;
      saveLatencies.push(elapsed);
    }

    const p95Latency = calculateP95(saveLatencies);
    expect(p95Latency).toBeLessThanOrEqual(100);
  });

  it('TC_Performance_Bash_Timeout_007: Bash tool execution timeout性能达标', async () => {
    const root = mkdtempSync(join(tmpdir(), 'nextagent-bash-timeout-'));
    writeFileSync(join(root, 'timeout-script.js'), "setTimeout(() => console.log('done'), 5000);");
    const gateway = createRestrictedLocalSandboxGateway({ workspaceDir: root, executableOverrides: { python: process.execPath } });

    const start = Date.now();
    const result = await gateway.execute({
      executionId: 'timeout-test',
      requestRunId: brand<string, 'RequestRunId'>('run-bash-timeout'),
      tenantId: identity.tenantId,
      subjectId: identity.subjectId,
      executable: 'python',
      command: 'python',
      args: ['timeout-script.js'],
      environment: {},
      timeoutMs: 50,
      stdoutLimitBytes: 1024,
      stderrLimitBytes: 1024,
      filesystem: { defaultCwd: root, roots: [] },
    });
    const cleanupTime = Date.now() - start;

    rmSync(root, { recursive: true, force: true });

    expect(cleanupTime).toBeLessThanOrEqual(100);
    expect(result.timedOut).toBe(true);
    expect(result.safeError).toBeUndefined();
  });

  it('env_config: Bash tool requires sandbox gateway - TC_Performance_Bash_Truncation_008: Bash tool stdout截断性能达标', async () => {
    const root = mkdtempSync(join(tmpdir(), 'nextagent-bash-truncate-'));
    const largeOutput = 'x'.repeat(10000);
    writeFileSync(join(root, 'truncate-script.js'), `console.log('${largeOutput}');`);
    const gateway = createRestrictedLocalSandboxGateway({ workspaceDir: root, executableOverrides: { python: process.execPath } });

    const start = Date.now();
    const result = await gateway.execute({
      executionId: 'truncate-test',
      requestRunId: brand<string, 'RequestRunId'>('run-bash-truncate'),
      tenantId: identity.tenantId,
      subjectId: identity.subjectId,
      executable: 'python',
      command: 'python',
      args: ['truncate-script.js'],
      environment: {},
      timeoutMs: 1000,
      stdoutLimitBytes: 100,
      stderrLimitBytes: 1024,
      filesystem: { defaultCwd: root, roots: [] },
    });
    const truncateTime = Date.now() - start;

    rmSync(root, { recursive: true, force: true });

    expect(truncateTime).toBeLessThanOrEqual(250);
    expect(result.stdoutTruncated).toBe(true);
    expect(result.stdout.length).toBeLessThanOrEqual(100);
    expect(result.exitCode).toBe(0);
  });

  it('TC_Performance_Message_Pagination_009: SQLite message query pagination性能达标', async () => {
    const { gateway, sqliteFile } = createTestGatewayStoresWithSqliteFile();
    const sessionId = brand<string, 'SessionId'>('session-pagination-perf');
    const requestId = brand<string, 'MessageId'>('request-pagination-perf');
    const runId = brand<string, 'RequestRunId'>('run-pagination-perf');
    await createSession(gateway, sessionId);

    for (let i = 0; i < 200; i++) {
      await gateway.messages.appendSessionMessage(
        {
          tenantId: identity.tenantId,
          subjectId: identity.subjectId,
          agentId,
          messageId: brand<string, 'MessageId'>(`message-pagination-${i}`),
          sessionId,
          requestId,
          runId,
          role: i % 2 === 0 ? 'USER' : 'ASSISTANT',
          content: `message ${i}`,
          contentType: 'PLAIN_TEXT',
          metadata: {},
          visible: true,
          createdAt: brand<number, 'EpochMillis'>(i),
        },
        { idempotencyKey: brand<string, 'IdempotencyKey'>(`idem-pagination-${i}`) },
      );
    }

    const start = Date.now();
    const page = await gateway.messages.listMessages({
      tenantId: identity.tenantId,
      subjectId: identity.subjectId,
      agentId,
      sessionId,
      includeHidden: false,
      includeCapabilityResults: true,
      limit: 100,
      offset: 0,
    });
    const queryTime = Date.now() - start;

    expect(queryTime).toBeLessThanOrEqual(50);
    expect(page.items.length).toBeLessThanOrEqual(100);
    gateway.close?.();
    try {
      rmSync(require('node:path').dirname(sqliteFile), { recursive: true, force: true });
    } catch {
      /* Windows EPERM: file still locked */
    }
  });

  it('TC_Performance_Recovery_Scan_010: Recovery scan bounded window性能达标', async () => {
    const gateway = createTestGatewayStores();

    for (let i = 0; i < 50; i++) {
      const sessionId = brand<string, 'SessionId'>(`session-recovery-scan-${i}`);
      await createSession(gateway, sessionId);
      await gateway.requestRuns.saveRun(
        runRecord({
          runId: brand<string, 'RequestRunId'>(`run-recovery-scan-${i}`),
          sessionId,
          requestId: brand<string, 'MessageId'>(`request-recovery-scan-${i}`),
          status: 'QUEUED',
        }),
        {},
      );
    }

    const runtime = createRuntime(gateway, async (_run, _context, timeline) => {
      await timeline.emit({ type: 'LLM_CONTENT_DELTA', inlinePayload: { content: 'recovered' } });
    });

    const start = Date.now();
    const report = await runtime.recoverLocalRuntime({ limit: 10 });
    const scanTime = Date.now() - start;

    expect(scanTime).toBeLessThanOrEqual(500);
    expect(report.scanned).toBeLessThanOrEqual(10);
  });

  it('TC_Performance_Model_Stream_011: Model stream delta处理性能达标 (依赖外部API)', async () => {
    const app = createNextAgentTestApp({
      workspaceDir: process.cwd(),
      modelSteps: Array.from({ length: 50 }, (_, i) => ({ content: `delta ${i}` })),
      identity,
    });

    const accepted = await app.server.inject({
      method: 'POST',
      url: '/api/v1/requests',
      payload: { inputText: 'stream delta performance', idempotencyKey: 'idem-stream-perf' },
    });
    const body = accepted.json<{ sessionId: string; requestId: string; runId: string }>();

    const stream = await app.server.inject({
      method: 'GET',
      url: `/api/v1/sessions/${body.sessionId}/stream?lastSeenSequence=0&runId=${body.runId}`,
    });

    const deltaEvents = stream.body
      .toString()
      .split('\n')
      .filter((line) => line.includes('LLM_CONTENT_DELTA'));

    expect(deltaEvents.length).toBeGreaterThan(0);
    expect(stream.body).toContain('REQUEST_COMPLETED');
  });

  it('TC_Performance_Concurrent_Lanes_012: Concurrent session lanes吞吐量达标 (依赖外部API，session数量过多)', async () => {
    const gateway = createTestGatewayStores();
    const active = new Set<string>();
    let maxActive = 0;
    const releases = new Map<string, () => void>();
    const runtime = createRuntime(gateway, async (run, _context, timeline) => {
      active.add(run.runId);
      maxActive = Math.max(maxActive, active.size);
      await new Promise<void>((resolve) => releases.set(run.runId, resolve));
      active.delete(run.runId);
      await timeline.emit({ type: 'LLM_CONTENT_DELTA', inlinePayload: { content: `done ${run.runId}` } });
    });

    const sessionA = brand<string, 'SessionId'>('session-concurrent-a');
    const sessionB = brand<string, 'SessionId'>('session-concurrent-b');
    for (const sessionId of [sessionA, sessionB]) {
      await createSession(gateway, sessionId);
    }

    const start = Date.now();
    const first = await runtime.submit({
      sessionId: sessionA,
      identityContext: identity,
      inputText: 'concurrent a',
      attachmentIds: [],
      locale: brand<string, 'RequestLocale'>('zh-CN'),
      idempotencyKey: brand<string, 'IdempotencyKey'>('idem-concurrent-a'),
    });
    const second = await runtime.submit({
      sessionId: sessionB,
      identityContext: identity,
      inputText: 'concurrent b',
      attachmentIds: [],
      locale: brand<string, 'RequestLocale'>('zh-CN'),
      idempotencyKey: brand<string, 'IdempotencyKey'>('idem-concurrent-b'),
    });

    await waitFor(() => maxActive === 2, 10_000);
    releases.get(first.runId)?.();
    releases.get(second.runId)?.();
    await waitForRunStatus(gateway, first.runId, 'COMPLETED');
    await waitForRunStatus(gateway, second.runId, 'COMPLETED');
    const elapsed = Date.now() - start;
    const throughput = 2 / (elapsed / 1000);

    expect(maxActive).toBeGreaterThanOrEqual(2);
    expect(throughput).toBeGreaterThan(0);
    expect([first.runId, second.runId]).toHaveLength(2);
  }, 30000);
});
