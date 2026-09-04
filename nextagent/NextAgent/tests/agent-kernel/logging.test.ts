import { createNextAgentTestApp } from '@nextagent/agent-platform-gateway-local/testing';
import { brand, type RuntimeLogger, type RuntimeLogLevel } from '@nextagent/agent-common';
import { createOperationalLogWriter as createOperationalLogWriterBase } from '@nextagent/agent-log';
import type { ModelInvocationService } from '@nextagent/agent-contracts/model';
import {
  createObservationEvent,
  createStructuredLogProjector,
  timelineObservationFromRecord,
  toStructuredLogEntry,
} from '@nextagent/agent-observability';
import { createDeveloperHookTracePlugin, developerHookTraceHookId } from '@nextagent/agent-plugin-sdk/developer-hook-trace';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

function createOperationalLogWriter(
  policy: Parameters<typeof createOperationalLogWriterBase>[0],
  options: Parameters<typeof createOperationalLogWriterBase>[1] = { serviceVersion: 'agent-test-1.0.0' },
) {
  return createOperationalLogWriterBase(policy, options);
}

describe('agent app request logging', () => {
  it('correlates developer trace, canonical model failure, and Web projection for one run', async () => {
    const workspaceDir = mkdtempSync(join(tmpdir(), 'nextagent-model-diagnostic-correlation-'));
    const writer = await createOperationalLogWriter({
      level: 'debug',
      console: { enabled: false },
      file: {
        enabled: true,
        directory: join(workspaceDir, 'logs'),
        name: 'nextagent-operational.log.jsonl',
        maxFileSizeMiB: 100,
        retentionDays: 7,
        maxArchiveFiles: 10,
      },
    });
    const traceEntries: Array<Record<string, unknown>> = [];
    const observationEntries: unknown[] = [];
    const tracePlugin = createDeveloperHookTracePlugin({
      developerDiagnostics: {
        async emit(input) {
          traceEntries.push(input.payload as Record<string, unknown>);
          return { status: 'ACCEPTED' };
        },
      },
    });
    const model: ModelInvocationService = {
      async complete() {
        return {
          content: '',
          safeError: {
            code: 'MODEL_AUTHENTICATION_FAILED',
            message: 'Model authentication failed safely.',
            category: 'AUTHORIZATION',
            retryable: false,
          },
        };
      },
      async stream(request, signal, onDelta) {
        void request;
        void signal;
        void onDelta;
        return this.complete(request, signal);
      },
    };
    const app = createNextAgentTestApp({
      workspaceDir,
      modelSteps: [],
      model,
      operationalLogWriter: writer,
      observationLogger: captureObservationLogger(observationEntries),
      lifecycleHooks: tracePlugin.hooks ?? [],
      hooks: [{ hookId: developerHookTraceHookId, enabled: true }],
    });
    try {
      const accepted = await app.server.inject({
        method: 'POST',
        url: '/api/v1/requests',
        payload: { inputText: 'raw-developer-input-canary', idempotencyKey: 'model-diagnostic-correlation' },
      });
      expect(accepted.statusCode).toBe(200);
      const body = accepted.json<{ sessionId: string; runId: string }>();
      await app.runtime.waitForIdle({ timeoutMs: 5_000 });
      const stream = await app.server.inject({
        method: 'GET',
        url: `/api/v1/sessions/${body.sessionId}/stream?lastSeenSequence=0&runId=${body.runId}`,
      });
      await writer.flush(2_000);

      const logFile = writer.activeIdentity()?.file;
      if (logFile === undefined) {
        throw new Error('operational log unavailable');
      }
      const physicalEntries = readFileSync(logFile, 'utf8')
        .trimEnd()
        .split('\n')
        .map((line) => JSON.parse(line) as Record<string, unknown>);
      expect(traceEntries).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            stage: 'BEFORE_MODEL_INVOKE',
            runId: body.runId,
            stepId: 'turn-1',
          }),
        ]),
      );
      expect(traceEntries).not.toEqual(expect.arrayContaining([expect.objectContaining({ stage: 'AFTER_MODEL_RESULT', runId: body.runId })]));
      expect(observationEntries).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            event: 'model.security.failed',
            runId: body.runId,
            stepId: 'turn-1',
            safeReasonCode: 'MODEL_AUTHENTICATION_FAILED',
          }),
        ]),
      );
      expect(stream.body).toContain('MODEL_AUTHENTICATION_FAILED');
    } finally {
      await app.close();
      rmSync(workspaceDir, { recursive: true, force: true });
    }
  });

  it('correlates developer trace, capability exception diagnostic, canonical failure, and Web projection for one run', async () => {
    const workspaceDir = mkdtempSync(join(tmpdir(), 'nextagent-capability-diagnostic-correlation-'));
    const writer = await createOperationalLogWriter({
      level: 'debug',
      console: { enabled: false },
      file: {
        enabled: true,
        directory: join(workspaceDir, 'logs'),
        name: 'nextagent-operational.log.jsonl',
        maxFileSizeMiB: 100,
        retentionDays: 7,
        maxArchiveFiles: 10,
      },
    });
    const traceEntries: Array<Record<string, unknown>> = [];
    const observationEntries: unknown[] = [];
    const tracePlugin = createDeveloperHookTracePlugin({
      developerDiagnostics: {
        async emit(input) {
          traceEntries.push(input.payload as Record<string, unknown>);
          return { status: 'ACCEPTED' };
        },
      },
    });
    const app = createNextAgentTestApp({
      workspaceDir,
      modelSteps: [
        {
          toolCalls: [
            {
              toolCallId: 'tool-python-failure',
              toolName: 'Python',
              arguments: { code: "print('capability-input-canary')" },
            },
          ],
        },
        { content: 'continued after safe capability failure' },
      ],
      sandboxGateway: {
        async execute() {
          throw new Error('capability-exception-canary token=credential-canary /tmp/private-canary');
        },
        isExecutionReady() {
          return true;
        },
      },
      operationalLogWriter: writer,
      observationLogger: captureObservationLogger(observationEntries),
      lifecycleHooks: tracePlugin.hooks ?? [],
      hooks: [{ hookId: developerHookTraceHookId, enabled: true }],
    });
    try {
      const accepted = await app.server.inject({
        method: 'POST',
        url: '/api/v1/requests',
        payload: { inputText: 'run failing capability', idempotencyKey: 'capability-diagnostic-correlation' },
      });
      expect(accepted.statusCode).toBe(200);
      const body = accepted.json<{ sessionId: string; runId: string }>();
      await app.runtime.waitForIdle({ timeoutMs: 5_000 });
      const stream = await app.server.inject({
        method: 'GET',
        url: `/api/v1/sessions/${body.sessionId}/stream?lastSeenSequence=0&runId=${body.runId}`,
      });
      await writer.flush(2_000);

      const logFile = writer.activeIdentity()?.file;
      if (logFile === undefined) {
        throw new Error('operational log unavailable');
      }
      const physicalEntries = readFileSync(logFile, 'utf8')
        .trimEnd()
        .split('\n')
        .map((line) => JSON.parse(line) as Record<string, unknown>);
      const capabilityFailures = physicalEntries.filter((entry) => entry.event === 'capability.execution.exception_captured');
      expect(capabilityFailures).toHaveLength(1);
      expect(capabilityFailures[0]).toMatchObject({
        runId: body.runId,
        stepId: 'turn-1',
        toolCallId: 'tool-python-failure',
        capabilityId: 'Python',
        safeErrorCode: 'CAPABILITY_EXECUTION_FAILED',
      });
      expect(traceEntries).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            stage: 'BEFORE_CAPABILITY_INVOKE',
            runId: body.runId,
            toolCallId: 'tool-python-failure',
            capabilityId: 'Python',
          }),
        ]),
      );
      expect(traceEntries).not.toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            stage: 'AFTER_CAPABILITY_RESULT',
            runId: body.runId,
            capabilityId: 'Python',
          }),
        ]),
      );
      expect(observationEntries).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            event: 'capability.failed',
            runId: body.runId,
            capabilityInvocationId: 'tool-python-failure',
            safeReasonCode: 'CAPABILITY_EXECUTION_FAILED',
          }),
        ]),
      );
      expect(stream.body).toContain('CAPABILITY_EXECUTION_FAILED');
      expect(stream.body).not.toContain('capability-exception-canary');
      expect(stream.body).not.toContain('credential-canary');
      expect(stream.body).not.toContain('private-canary');
    } finally {
      await app.close();
      rmSync(workspaceDir, { recursive: true, force: true });
    }
  });

  it('maps runtime terminal lifecycle observations to structured request logs', () => {
    const entries: unknown[] = [];
    const projector = createStructuredLogProjector(captureObservationLogger(entries));

    expect(
      projector.project(
        createObservationEvent({
          boundary: 'request_lifecycle',
          operation: 'TERMINAL_COMMITTED',
          outcome: 'success',
          ownerScope: {
            tenantId: brand<string, 'TenantId'>('tenant-log'),
            subjectId: brand<string, 'SubjectId'>('subject-log'),
            agentId: brand<string, 'AgentId'>('default-agent'),
            agentVersion: brand<string, 'AgentVersion'>('v1'),
          },
          occurredAt: brand<number, 'EpochMillis'>(1),
          stableRefs: { requestRunId: 'run-log' },
        }),
      ),
    ).toEqual({ surface: 'LOG', outcome: 'emitted' });

    expect(entries).toEqual([expect.objectContaining({ event: 'request.completed', occurredAt: '1970-01-01T00:00:00.001Z' })]);
  });

  it('maps runtime command rejection observations to bounded request logs', () => {
    const entries: unknown[] = [];
    const projector = createStructuredLogProjector(captureObservationLogger(entries));

    expect(
      projector.project(
        createObservationEvent({
          boundary: 'request_lifecycle',
          operation: 'REQUEST_REJECTED',
          outcome: 'failure',
          ownerScope: {
            tenantId: brand<string, 'TenantId'>('tenant-log'),
            subjectId: brand<string, 'SubjectId'>('subject-log'),
            agentId: brand<string, 'AgentId'>('default-agent'),
            agentVersion: brand<string, 'AgentVersion'>('v1'),
          },
          occurredAt: brand<number, 'EpochMillis'>(2),
          safeReasonCode: 'SUBMIT_IDEMPOTENCY_REQUIRED',
          stableRefs: { sessionId: 'session-log' },
        }),
      ),
    ).toEqual({ surface: 'LOG', outcome: 'emitted' });

    expect(entries).toEqual([expect.objectContaining({ event: 'request.rejected', level: 'error' })]);
  });

  it('maps model wrapper and persisted capability observations to bounded diagnostic logs', () => {
    const entries: unknown[] = [];
    const projector = createStructuredLogProjector(captureObservationLogger(entries));
    const owner = { tenantId: brand<string, 'TenantId'>('tenant-log'), subjectId: brand<string, 'SubjectId'>('subject-log') };
    const agentVersion = brand<string, 'AgentVersion'>('v1');

    const model = createObservationEvent({
      boundary: 'model_invocation',
      operation: 'MODEL_INVOCATION_COMPLETED',
      outcome: 'success',
      ownerScope: {
        ...owner,
        agentId: brand<string, 'AgentId'>('default-agent'),
        agentVersion,
      },
      occurredAt: brand<number, 'EpochMillis'>(2),
      durationMs: 12,
      stableRefs: { requestRunId: 'run-log', requestId: 'request-log' },
      diagnosticSnapshot: {
        ...owner,
        agentId: brand<string, 'AgentId'>('default-agent'),
        agentVersion,
        requestRunId: brand<string, 'RequestRunId'>('run-log'),
        diagnosticCandidates: [
          { key: 'providerKind', value: 'OPENAI', classification: 'LOW_CARDINALITY', cardinality: 'LOW' },
          { key: 'stepId', value: 'turn-1', classification: 'LOW_CARDINALITY', cardinality: 'LOW' },
          { key: 'modelId', value: 'deterministic', classification: 'LOW_CARDINALITY', cardinality: 'LOW' },
          { key: 'timeoutMs', value: 1000, classification: 'LOW_CARDINALITY', cardinality: 'LOW' },
          { key: 'maxOutputTokens', value: 512, classification: 'LOW_CARDINALITY', cardinality: 'LOW' },
          { key: 'messageCount', value: 3, classification: 'LOW_CARDINALITY', cardinality: 'LOW' },
          { key: 'toolCount', value: 1, classification: 'LOW_CARDINALITY', cardinality: 'LOW' },
        ],
      },
    });
    const capability = timelineObservationFromRecord({
      ...owner,
      agentId: brand<string, 'AgentId'>('default-agent'),
      agentVersion,
      eventId: 'event-capability-log',
      sessionId: brand<string, 'SessionId'>('session-log'),
      runId: brand<string, 'RequestRunId'>('run-log'),
      requestId: brand<string, 'MessageId'>('request-log'),
      requestContextId: brand<string, 'RequestContextId'>('context-log'),
      type: 'CAPABILITY_COMPLETED',
      inlinePayload: { status: 'SUCCEEDED', toolCallId: 'tool-1', capabilityId: 'Read', result: { secret: 'raw tool output' } },
      createdAt: brand<number, 'EpochMillis'>(3),
    });

    expect(capability).toBeDefined();
    expect(projector.project(model)).toEqual({ surface: 'LOG', outcome: 'emitted' });
    expect(projector.project(capability!)).toEqual({ surface: 'LOG', outcome: 'emitted' });

    expect(entries).toEqual([
      expect.objectContaining({
        event: 'model.invocation.completed',
        details: expect.objectContaining({
          timeoutMs: 1000,
          maxOutputTokens: 512,
          messageCount: 3,
          toolCount: 1,
        }),
      }),
      expect.objectContaining({ event: 'capability.completed' }),
    ]);
    expect(JSON.stringify(entries)).not.toMatch(/providerKind|modelId/u);
    expect(JSON.stringify(entries)).not.toMatch(/raw model output|raw tool output|secret|result/i);
  });

  it('maps persisted policy observations to bounded system diagnostics', () => {
    const entries: unknown[] = [];
    const projector = createStructuredLogProjector(captureObservationLogger(entries));
    const policy = timelineObservationFromRecord({
      tenantId: brand<string, 'TenantId'>('tenant-log'),
      subjectId: brand<string, 'SubjectId'>('subject-log'),
      agentId: brand<string, 'AgentId'>('default-agent'),
      agentVersion: brand<string, 'AgentVersion'>('v1'),
      eventId: 'event-policy-log',
      sessionId: brand<string, 'SessionId'>('session-log'),
      runId: brand<string, 'RequestRunId'>('run-log'),
      requestId: brand<string, 'MessageId'>('request-log'),
      requestContextId: brand<string, 'RequestContextId'>('context-log'),
      type: 'POLICY_APPLIED',
      inlinePayload: {
        operationKind: 'SANDBOX_EXECUTION',
        operationId: 'python:python',
        outcome: 'POLICY_FAILED',
        reasonCode: 'RISK_POLICY_EVALUATION_FAILED',
        riskLevel: 'CRITICAL',
        toolArgs: { secret: 'must-not-read' },
      },
      createdAt: brand<number, 'EpochMillis'>(4),
    });

    expect(policy).toBeDefined();
    expect(projector.project(policy!)).toEqual({ surface: 'LOG', outcome: 'emitted' });
    expect(entries).toEqual([
      expect.objectContaining({
        event: 'policy.failed',
        safeReasonCode: 'RISK_POLICY_EVALUATION_FAILED',
        details: expect.objectContaining({
          operationKind: 'SANDBOX_EXECUTION',
        }),
      }),
    ]);
    expect(JSON.stringify(entries)).not.toMatch(/must-not-read|toolArgs|secret/i);
  });

  it('maps internal lifecycle and health observations to bounded structured log events', () => {
    const entries: unknown[] = [];
    const projector = createStructuredLogProjector(captureObservationLogger(entries));
    const ownerScope = {
      tenantId: brand<string, 'TenantId'>('tenant-log'),
      subjectId: brand<string, 'SubjectId'>('subject-log'),
      agentId: brand<string, 'AgentId'>('default-agent'),
      agentVersion: brand<string, 'AgentVersion'>('v1'),
    };

    const observations = [
      createObservationEvent({
        boundary: 'system',
        operation: 'RUN_DISPATCHED',
        outcome: 'success',
        ownerScope,
        occurredAt: brand<number, 'EpochMillis'>(4),
        stableRefs: { sessionId: 'session-log', requestRunId: 'run-log' },
      }),
      createObservationEvent({
        boundary: 'system',
        operation: 'RECOVERY_SCAN_COMPLETED',
        outcome: 'success',
        ownerScope,
        occurredAt: brand<number, 'EpochMillis'>(5),
        stableRefs: {},
        diagnosticSnapshot: {
          ...ownerScope,
          diagnosticCandidates: [{ key: 'scanned', value: 2, classification: 'LOW_CARDINALITY', cardinality: 'LOW' }],
        },
      }),
      createObservationEvent({
        boundary: 'health_probe',
        operation: 'HEALTH_EVALUATED',
        outcome: 'degraded',
        ownerScope,
        occurredAt: brand<number, 'EpochMillis'>(6),
        safeReasonCode: 'DEGRADED',
        stableRefs: {},
      }),
      createObservationEvent({
        boundary: 'system',
        operation: 'APP_SHUTDOWN',
        outcome: 'success',
        ownerScope,
        occurredAt: brand<number, 'EpochMillis'>(7),
        safeReasonCode: 'APP_SHUTDOWN',
        stableRefs: {},
      }),
    ];

    expect(projector.project(observations[0]!)).toEqual({ surface: 'LOG', outcome: 'emitted' });
    expect(projector.project(observations[1]!)).toEqual({ surface: 'LOG', outcome: 'emitted' });
    expect(projector.project(observations[2]!)).toEqual({ surface: 'LOG', outcome: 'skipped_not_covered' });
    expect(projector.project(observations[3]!)).toEqual({ surface: 'LOG', outcome: 'emitted' });

    expect(entries).toEqual([
      expect.objectContaining({ event: 'run.dispatched' }),
      expect.objectContaining({ event: 'recovery.scan.completed' }),
      expect.objectContaining({ event: 'app.shutdown' }),
    ]);
  });

  it('keeps HTTP outcomes out of the observation-derived structured log transport', async () => {
    const entries: unknown[] = [];
    const app = createNextAgentTestApp({
      workspaceDir: process.cwd(),
      modelSteps: [{ content: 'ok' }],
      observationLogger: captureObservationLogger(entries),
    });
    try {
      const response = await app.server.inject({ method: 'GET', url: '/api/v1/sessions' });
      expect(response.statusCode).toBe(200);

      expect(entries.some((entry) => (entry as { readonly operation?: string }).operation?.startsWith('HTTP_') === true)).toBe(false);
      expect(JSON.stringify(entries)).not.toContain('prompt');
      expect(JSON.stringify(entries)).not.toContain('modelOutput');
    } finally {
      await app.close();
    }
  });

  it('writes a content-free canonical failure log for failed runs', async () => {
    const entries: unknown[] = [];
    const model: ModelInvocationService = {
      async complete() {
        return {
          content: '',
          safeError: {
            code: 'MODEL_INVOCATION_FAILED',
            message: 'Model invocation failed safely.',
            category: 'INTERNAL',
            retryable: false,
          },
        };
      },
      async stream(request, signal, onDelta) {
        void onDelta;
        return this.complete(request, signal);
      },
    };
    const app = createNextAgentTestApp({
      workspaceDir: process.cwd(),
      modelSteps: [],
      model,
      observationLogger: captureObservationLogger(entries),
    });
    try {
      const response = await app.server.inject({
        method: 'POST',
        url: '/api/v1/requests',
        payload: { inputText: 'try denied read', idempotencyKey: 'idem-safe-error-terminal-log' },
      });

      expect(response.statusCode).toBe(200);
      await waitForLogEntry(entries, (entry) => {
        return (entry as { readonly event?: string }).event === 'request.failed';
      });

      expect(entries).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            event: 'request.failed',
            level: 'error',
            safeReasonCode: 'TERMINAL_FAILED',
            details: expect.objectContaining({ terminalStatus: 'FAILED' }),
          }),
        ]),
      );
      expect(JSON.stringify(entries)).not.toMatch(/try denied read|terminalContent/u);
    } finally {
      await app.close();
    }
  });

  it('keeps successful health probes and app-owned shutdown diagnostics out of observation-derived logs', async () => {
    const entries: unknown[] = [];
    const app = createNextAgentTestApp({
      workspaceDir: process.cwd(),
      modelSteps: [{ content: 'ok' }],
      observationLogger: captureObservationLogger(entries),
    });
    try {
      const primary = await app.server.inject({ method: 'GET', url: '/health' });
      const deep = await app.server.inject({ method: 'GET', url: '/health/deep' });

      expect(primary.statusCode).toBe(200);
      expect(deep.statusCode).toBe(200);
    } finally {
      await app.close();
      expect(entries.some((entry) => ['HEALTH_PROBE_RESULT', 'APP_SHUTDOWN'].includes(String((entry as { readonly event?: unknown }).event)))).toBe(
        false,
      );
    }
  });

  it('adds only sanitized diagnostic detail in debug redaction mode', () => {
    const owner = {
      tenantId: brand<string, 'TenantId'>('tenant-log'),
      subjectId: brand<string, 'SubjectId'>('subject-log'),
      agentId: brand<string, 'AgentId'>('default-agent'),
      agentVersion: brand<string, 'AgentVersion'>('v1'),
    };
    const observation = createObservationEvent({
      boundary: 'model_invocation',
      operation: 'MODEL_INVOCATION_COMPLETED',
      outcome: 'success',
      ownerScope: owner,
      occurredAt: brand<number, 'EpochMillis'>(8),
      stableRefs: { requestRunId: 'run-log', requestId: 'request-log' },
      diagnosticSnapshot: {
        ...owner,
        requestRunId: brand<string, 'RequestRunId'>('run-log'),
        diagnosticCandidates: [
          { key: 'providerKind', value: 'OPENAI', classification: 'LOW_CARDINALITY', cardinality: 'LOW' },
          { key: 'timeoutMs', value: 1000, classification: 'LOW_CARDINALITY', cardinality: 'LOW' },
          { key: 'requestRunId', value: 'run-log', classification: 'HIGH_CARDINALITY', cardinality: 'HIGH' },
        ],
      },
    });
    const entry = toStructuredLogEntry('model.invocation.completed', observation, { diagnosticDetail: 'debug' });

    expect(entry.occurredAt).toBe('1970-01-01T00:00:00.008Z');
    expect(entry).toMatchObject({
      diagnostic: {
        candidates: ['timeoutMs=1000 [LOW_CARDINALITY/LOW]'],
      },
    });
    expect(JSON.stringify(entry)).not.toContain('providerKind');
    expect(JSON.stringify(entry)).not.toContain('requestRunId=run-log');
    expect(JSON.stringify(entry)).not.toMatch(/rawPrompt|stack|path|secret|credential|token/i);
  });
});

function captureObservationLogger(entries: unknown[]): RuntimeLogger {
  const capture =
    (level: RuntimeLogLevel) =>
    (fields: object): void => {
      entries.push({ ...fields, level });
    };
  return {
    debug: capture('debug'),
    info: capture('info'),
    warn: capture('warn'),
    error: capture('error'),
  };
}

async function waitForLogEntry(entries: readonly unknown[], predicate: (entry: unknown) => boolean): Promise<void> {
  const deadline = Date.now() + 2000;
  while (Date.now() < deadline) {
    if (entries.some(predicate)) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('Timed out waiting for structured log entry.');
}
