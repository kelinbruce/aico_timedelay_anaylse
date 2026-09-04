import { createMetricsInfrastructure, createTraceProjector } from '@nextagent/agent-observability';
import { DataPointType, type ResourceMetrics } from '@opentelemetry/sdk-metrics';
import { NodeTracerProvider } from '@opentelemetry/sdk-trace-node';
import { trace } from '@opentelemetry/api';
import { createOperationalLogWriter as createOperationalLogWriterBase } from '@nextagent/agent-log';
import { bindRuntimeLoggerProvider } from '@nextagent/agent-common';
import type { ModelInvocationService } from '@nextagent/agent-contracts/model';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createNextAgentTestApp, readCapturedAuditRecords } from '../src/testing.js';
import { createNextAgentFastifyServer } from '../src/server/fastify.js';

function createOperationalLogWriter(
  policy: Parameters<typeof createOperationalLogWriterBase>[0],
  options: Parameters<typeof createOperationalLogWriterBase>[1] = { serviceVersion: 'agent-test-1.0.0' },
) {
  return createOperationalLogWriterBase(policy, options);
}

describe('operational logging composition', () => {
  it('uses one app-owned writer for runtime diagnostics and observation-derived trajectory', async () => {
    const workspaceDir = mkdtempSync(join(tmpdir(), 'nextagent-single-operational-writer-'));
    const logDirectory = join(workspaceDir, 'logs');
    const writer = await createOperationalLogWriter({
      level: 'debug',
      console: { enabled: false },
      file: {
        enabled: true,
        directory: logDirectory,
        name: 'nextagent-operational.log.jsonl',
        maxFileSizeMiB: 100,
        retentionDays: 7,
        maxArchiveFiles: 10,
      },
    });
    writer.getLogger({ component: 'agent-test-owner' }).info({ event: 'test.direct', safeReasonCode: 'DIRECT_WITH_EVENT' });
    const app = createNextAgentTestApp({
      workspaceDir,
      modelSteps: [{ content: 'ok' }],
      operationalLogWriter: writer,
    });
    try {
      const session = await app.server.inject({ method: 'POST', url: '/api/v1/sessions', payload: {} });
      const accepted = await app.server.inject({
        method: 'POST',
        url: '/api/v1/requests',
        payload: {
          inputText: 'diagnose the network',
          idempotencyKey: 'single-operational-writer',
          sessionId: session.json<{ sessionId: string }>().sessionId,
        },
      });
      const body = accepted.json<{ sessionId: string; runId: string }>();
      await app.server.inject({ method: 'GET', url: `/api/v1/sessions/${body.sessionId}/stream?lastSeenSequence=0&runId=${body.runId}` });
      await writer.flush(2_000);

      const ownedFiles = readdirSync(logDirectory).filter((name) => name.startsWith('nextagent-operational.log.'));
      expect(ownedFiles).toHaveLength(1);
      expect(writer.activeIdentity()?.file).toBe(join(logDirectory, ownedFiles[0]!));
      const entries = readFileSync(join(logDirectory, ownedFiles[0]!), 'utf8')
        .trimEnd()
        .split('\n')
        .map((line) => JSON.parse(line) as Record<string, unknown>);
      expect(entries).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            surface: 'runtime_diagnostic',
            component: 'agent-test-owner',
            event: 'test.direct',
            safeReasonCode: 'DIRECT_WITH_EVENT',
          }),
          expect.objectContaining({ surface: 'runtime_diagnostic', component: 'agent-app', event: 'app.config.accepted' }),
          expect.objectContaining({ surface: 'observation_derived', component: 'agent-observability', event: expect.any(String) }),
        ]),
      );
      const physical = JSON.stringify(entries);
      expect(physical).not.toContain('metric.sample');
      expect(physical).not.toContain('request_outcome_total');
      expect(physical).not.toContain('schemaVersion');
      expect(readCapturedAuditRecords(app).length).toBeGreaterThan(0);
    } finally {
      await app.close();
      rmSync(workspaceDir, { recursive: true, force: true });
    }
  });

  it.each([
    { name: 'one model and no capability', withCapability: false },
    { name: 'two models and one capability', withCapability: true },
  ])('keeps the default-info request trajectory useful for $name', async ({ withCapability }) => {
    const workspaceDir = mkdtempSync(join(tmpdir(), 'nextagent-request-skeleton-'));
    const logDirectory = join(workspaceDir, 'logs');
    const writer = await createOperationalLogWriter({
      level: 'info',
      console: { enabled: false },
      file: {
        enabled: true,
        directory: logDirectory,
        name: 'nextagent-operational.log.jsonl',
        maxFileSizeMiB: 100,
        retentionDays: 7,
        maxArchiveFiles: 10,
      },
    });
    const traceProvider = withCapability ? new NodeTracerProvider() : undefined;
    traceProvider?.register();
    const app = createNextAgentTestApp({
      workspaceDir: process.cwd(),
      operationalLogWriter: writer,
      modelSteps: [],
      model: requestSkeletonModel(withCapability),
      ...(withCapability ? { traceProjector: createTraceProjector() } : {}),
    });
    try {
      const response = await app.server.inject({
        method: 'POST',
        url: '/api/v1/requests',
        payload: { inputText: 'check request skeleton', idempotencyKey: `request-skeleton-${withCapability ? 'capability' : 'model'}` },
      });
      expect(response.statusCode).toBe(200);
      await app.runtime.waitForIdle({ timeoutMs: 5_000 });

      const entries = await waitForCatalogEntries(writer, withCapability ? 14 : 7);
      expect(entries.filter((entry) => entry.msg === 'request completed')).toHaveLength(1);
      expect(entries.filter((entry) => entry.event === 'request.accepted')).toHaveLength(1);
      expect(entries.filter((entry) => entry.event === 'request.completed')).toHaveLength(1);
      expect(entries.filter((entry) => entry.event === 'context.assembly.completed')).toHaveLength(withCapability ? 2 : 1);
      expect(entries.filter((entry) => entry.event === 'model.stream.first_visible_content')).toHaveLength(1);
      expect(entries.filter((entry) => String(entry.event).startsWith('model.invocation.'))).toHaveLength(withCapability ? 4 : 2);
      expect(entries.filter((entry) => entry.event === 'model.payload.input_captured')).toHaveLength(withCapability ? 2 : 1);
      expect(entries.filter((entry) => entry.event === 'model.payload.output_captured')).toHaveLength(withCapability ? 2 : 1);
      expect(entries.filter((entry) => String(entry.event).startsWith('capability.'))).toHaveLength(withCapability ? 2 : 0);
      const modelStarted = entries.find((entry) => entry.event === 'model.invocation.started');
      expect(modelStarted).toMatchObject({
        surface: 'observation_derived',
        stepId: 'turn-1',
        details: expect.objectContaining({
          disclosedCapabilityNames: expect.arrayContaining(['Read']),
          disclosedCapabilityNamesTruncated: 'false',
        }),
      });
      const modelInputEntry = entries.find((entry) => entry.event === 'model.payload.input_captured');
      expect(modelInputEntry).toMatchObject({
        surface: 'runtime_diagnostic',
        stepId: 'turn-1',
        modelInput: { messages: expect.any(Array) },
      });
      expect(Object.keys(modelInputEntry?.modelInput as Record<string, unknown>)).toEqual(['messages']);
      const modelTerminals = entries.filter((entry) => entry.event === 'model.invocation.completed');
      expect(modelTerminals).toHaveLength(withCapability ? 2 : 1);
      expect(modelTerminals).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            durationMs: expect.any(Number),
            firstContentLatencyMs: expect.any(Number),
            usage: { inputTokens: 4, outputTokens: 3, totalTokens: 7 },
          }),
        ]),
      );
      for (const terminal of modelTerminals) {
        expect(terminal.firstContentLatencyMs as number).toBeLessThanOrEqual(terminal.durationMs as number);
      }
      if (withCapability) {
        expect(modelTerminals).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              usage: { inputTokens: 3, outputTokens: 2, totalTokens: 5 },
            }),
          ]),
        );
      }
      for (const output of entries.filter((entry) => entry.event === 'model.payload.output_captured')) {
        expect(output).not.toHaveProperty('durationMs');
        expect(output).not.toHaveProperty('firstContentLatencyMs');
      }
      if (withCapability) {
        const terminal = entries.find((entry) => entry.event === 'request.completed');
        expect(terminal).toMatchObject({
          component: 'agent-observability',
          serviceVersion: 'agent-test-1.0.0',
          status: 'SUCCEEDED',
          usage: { inputTokens: 7, outputTokens: 5, totalTokens: 12 },
          toolCallCount: 1,
          traceId: expect.stringMatching(/^[0-9a-f]{32}$/u),
          spanId: expect.stringMatching(/^[0-9a-f]{16}$/u),
        });
        expect(terminal).not.toHaveProperty('summaryStatus');
        expect(terminal).not.toHaveProperty('msg');
        const lifecycleEntries = entries.filter(
          (entry) =>
            entry.event === 'request.accepted' ||
            entry.event === 'request.completed' ||
            entry.event === 'tool.call.failed' ||
            String(entry.event).startsWith('model.invocation.') ||
            String(entry.event).startsWith('model.payload.'),
        );
        expect(new Set(lifecycleEntries.map((entry) => entry.traceId))).toEqual(new Set([terminal?.traceId]));
        expect(entries.find((entry) => entry.event === 'tool.call.failed')).toMatchObject({
          traceId: terminal?.traceId,
          stepId: 'turn-1',
          toolInput: { file_path: 'package.json', offset: 0, limit: 1 },
          toolOutput: expect.objectContaining({ status: 'FAILED' }),
        });
        expect(
          entries.find(
            (entry) =>
              entry.event === 'model.invocation.completed' && (entry.details as Record<string, unknown> | undefined)?.resolvedToolNames !== undefined,
          ),
        ).toMatchObject({
          details: expect.objectContaining({ resolvedToolNames: ['Read'] }),
        });
        expect(entries.find((entry) => entry.event === 'capability.failed')).toMatchObject({
          details: expect.objectContaining({
            validatedArgumentNames: expect.arrayContaining(['file_path']),
            argumentProjectionStatus: 'PROJECTED',
          }),
        });
      }
    } finally {
      await app.close();
      if (traceProvider !== undefined) {
        await traceProvider.shutdown();
        trace.disable();
      }
      rmSync(workspaceDir, { recursive: true, force: true });
    }
  });

  it('writes Tool input and output at normal detail through centralized credential and token redaction', async () => {
    const workspaceDir = mkdtempSync(join(tmpdir(), 'nextagent-raw-tool-input-'));
    const logDirectory = join(workspaceDir, 'logs');
    const writer = await createOperationalLogWriter({
      level: 'info',
      console: { enabled: false },
      file: {
        enabled: true,
        directory: logDirectory,
        name: 'nextagent-operational.log.jsonl',
        maxFileSizeMiB: 100,
        retentionDays: 7,
        maxArchiveFiles: 10,
      },
    });
    const app = createNextAgentTestApp({
      workspaceDir,
      diagnosticDetail: 'normal',
      operationalLogWriter: writer,
      sandboxGateway: {
        async execute(request) {
          return {
            executionId: request.executionId,
            stdout: 'raw output marker sk-raw-tool-output-secret',
            stderr: '',
            exitCode: 0,
            stdoutTruncated: false,
            stderrTruncated: false,
            timedOut: false,
            durationMs: 1,
          };
        },
        isExecutionReady() {
          return true;
        },
      },
      modelSteps: [
        {
          toolCalls: [
            { toolCallId: 'tool-bash-raw-input', toolName: 'Bash', arguments: { command: 'echo raw input marker sk-raw-tool-input-secret' } },
          ],
        },
        { content: 'done' },
      ],
    });
    try {
      const response = await app.server.inject({
        method: 'POST',
        url: '/api/v1/requests',
        payload: { inputText: 'run python', idempotencyKey: 'raw-tool-input-logging' },
      });
      expect(response.statusCode).toBe(200);
      const body = response.json<{ sessionId: string; runId: string }>();
      await app.server.inject({
        method: 'GET',
        url: `/api/v1/sessions/${body.sessionId}/stream?lastSeenSequence=0&runId=${body.runId}`,
      });
      await app.runtime.waitForIdle({ timeoutMs: 5_000 });
      await writer.flush(2_000);

      const activeFile = writer.activeIdentity()?.file;
      if (activeFile === undefined) {
        throw new Error('active operational log unavailable');
      }
      const entries = readFileSync(activeFile, 'utf8')
        .trimEnd()
        .split('\n')
        .map((line) => JSON.parse(line) as Record<string, unknown>);
      const captured = entries.find((entry) => entry.event === 'tool.payload.captured');
      expect(captured).toMatchObject({
        level: 'info',
        surface: 'runtime_diagnostic',
        event: 'tool.payload.captured',
        toolCallId: 'tool-bash-raw-input',
        toolInput: {
          command: 'echo raw input marker <redacted:credential>',
        },
        toolOutput: {
          status: 'SUCCEEDED',
          structuredPayload: expect.objectContaining({
            stdout: 'raw output marker <redacted:credential>',
            exitCode: 0,
          }),
        },
      });
      expect(JSON.stringify(entries)).not.toContain('sk-raw-tool-input-secret');
      expect(JSON.stringify(entries)).not.toContain('sk-raw-tool-output-secret');
    } finally {
      await app.close();
      rmSync(workspaceDir, { recursive: true, force: true });
    }
  });

  it('emits one Fastify native final access record for success, ordinary 4xx, and mapped errors', async () => {
    const workspaceDir = mkdtempSync(join(tmpdir(), 'nextagent-access-positioning-'));
    const logDirectory = join(workspaceDir, 'logs');
    const writer = await createOperationalLogWriter({
      level: 'info',
      console: { enabled: false },
      file: {
        enabled: true,
        directory: logDirectory,
        name: 'nextagent-operational.log.jsonl',
        maxFileSizeMiB: 100,
        retentionDays: 7,
        maxArchiveFiles: 10,
      },
    });
    const app = createNextAgentTestApp({
      workspaceDir: process.cwd(),
      modelSteps: [{ content: 'unused' }],
      operationalLogWriter: writer,
    });
    try {
      const success = await app.server.inject({ method: 'GET', url: '/api/v1/sessions', headers: { 'x-request-id': 'forged-http-request' } });
      const notFound = await app.server.inject({ method: 'GET', url: '/missing' });
      const invalid = await app.server.inject({ method: 'POST', url: '/api/v1/requests', payload: { inputText: 123 } });
      expect([success.statusCode, notFound.statusCode, invalid.statusCode]).toEqual([200, 404, 400]);

      await writer.flush(2_000);
      const activeFile = writer.activeIdentity()?.file;
      if (activeFile === undefined) {
        throw new Error('active operational log unavailable');
      }
      const entries = readFileSync(activeFile, 'utf8')
        .trimEnd()
        .split('\n')
        .map((line) => JSON.parse(line) as Record<string, unknown>);
      const outcomes = entries.filter((entry) => entry.msg === 'request completed' || entry.msg === 'request errored');
      const incoming = entries.filter((entry) => entry.msg === 'incoming request');
      expect(outcomes).toHaveLength(3);
      expect(incoming).toEqual([]);
      expect(outcomes.every((entry) => entry.msg === 'request completed' && entry.level === 'info')).toBe(true);
      expect(outcomes).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            reqId: expect.any(String),
            res: { statusCode: 200 },
            responseTime: expect.any(Number),
          }),
        ]),
      );
      expect(outcomes.map((entry) => (entry.res as { statusCode: number }).statusCode)).toEqual([200, 404, 400]);
      expect(outcomes.map((entry) => entry.req)).toEqual([
        { method: 'GET', url: '/api/v1/sessions' },
        { method: 'GET', url: 'unmatched' },
        { method: 'POST', url: '/api/v1/requests' },
      ]);
      expect(outcomes.every((entry) => entry.requestId === undefined)).toBe(true);
      expect(outcomes.every((entry) => entry.event === undefined)).toBe(true);
      expect(JSON.stringify(outcomes)).not.toContain('forged-http-request');
      expect(JSON.stringify(entries)).not.toContain('http.request.');
    } finally {
      await app.close();
      rmSync(workspaceDir, { recursive: true, force: true });
    }
  });

  it('routes Fastify-native diagnostics through the safe adapter without duplicating access outcomes', async () => {
    const workspaceDir = mkdtempSync(join(tmpdir(), 'nextagent-fastify-native-logging-'));
    const logDirectory = join(workspaceDir, 'logs');
    const writer = await createOperationalLogWriter({
      level: 'info',
      console: { enabled: false },
      file: {
        enabled: true,
        directory: logDirectory,
        name: 'nextagent-operational.log.jsonl',
        maxFileSizeMiB: 100,
        retentionDays: 7,
        maxArchiveFiles: 10,
      },
    });
    const loggerBinding = bindRuntimeLoggerProvider(writer);
    const getServerAccessLogger = writer.getServerAccessLogger;
    if (getServerAccessLogger === undefined) {
      throw new Error('server access logger unavailable');
    }
    const server = createNextAgentFastifyServer(getServerAccessLogger({ component: 'agent-channel-web', source: 'fastify' }));
    server.get('/native-warning', async (request) => {
      request.log.warn(
        {
          req: request,
          headers: { authorization: 'Bearer fastify-secret-canary' },
          url: '/native-warning?token=fastify-secret-canary',
        },
        'raw fastify warning fastify-secret-canary',
      );
      return { ok: true };
    });
    server.get(
      '/response-hook-failure',
      {
        onResponse: async () => {
          throw new Error('response hook fastify-secret-canary C:\\private\\operator.txt');
        },
      },
      async () => ({ ok: true }),
    );
    try {
      const success = await server.inject({
        method: 'GET',
        url: '/native-warning',
        headers: { 'x-request-id': 'forged-fastify-request-id' },
      });
      const failed = await server.inject({ method: 'GET', url: '/response-hook-failure' });
      expect([success.statusCode, failed.statusCode]).toEqual([200, 200]);

      await writer.flush(2_000);
      const activeFile = writer.activeIdentity()?.file;
      if (activeFile === undefined) {
        throw new Error('active operational log unavailable');
      }
      const entries = readFileSync(activeFile, 'utf8')
        .trimEnd()
        .split('\n')
        .map((line) => JSON.parse(line) as Record<string, unknown>);
      const access = entries.filter((entry) => entry.msg === 'request completed' || entry.msg === 'request errored');
      const incoming = entries.filter((entry) => entry.msg === 'incoming request');
      expect(access).toHaveLength(2);
      expect(incoming).toEqual([]);
      expect(access.map((entry) => entry.msg)).toEqual(['request completed', 'request errored']);
      expect(access.every((entry) => typeof entry.reqId === 'string')).toBe(true);
      expect(access.map((entry) => entry.req)).toEqual([
        { method: 'GET', url: '/native-warning' },
        { method: 'GET', url: '/response-hook-failure' },
      ]);
      expect(access.every((entry) => entry.event === undefined)).toBe(true);
      expect(entries).toContainEqual(
        expect.objectContaining({
          level: 'warn',
          event: 'server.framework.degraded',
          failureStage: 'FASTIFY_INTERNAL',
          safeReasonCode: 'FASTIFY_INTERNAL_DEGRADED',
        }),
      );
      expect(access[1]).toEqual(
        expect.objectContaining({
          level: 'error',
          safeReasonCode: 'FASTIFY_REQUEST_ERROR',
          safeErrorCategory: 'INTERNAL',
          exceptionType: 'Error',
          exceptionFingerprint: expect.any(String),
          res: { statusCode: 200 },
          responseTime: expect.any(Number),
        }),
      );
      const physical = JSON.stringify(entries);
      expect(physical).not.toContain('fastify-secret-canary');
      expect(physical).not.toContain('forged-fastify-request-id');
      expect(physical).not.toContain('native-warning?token');
      expect(physical).not.toContain('private\\operator.txt');
    } finally {
      await server.close();
      await writer.close(2_000);
      loggerBinding.unbind();
      rmSync(workspaceDir, { recursive: true, force: true });
    }
  });

  it('exports the official HTTP server duration metric exactly once per network request', async () => {
    const exports: ResourceMetrics[] = [];
    const metrics = createMetricsInfrastructure({
      exporter: {
        export(resourceMetrics, callback) {
          exports.push(resourceMetrics);
          callback({ code: 0 });
        },
        forceFlush: async () => undefined,
        shutdown: async () => undefined,
      },
      serviceName: 'nextagent',
      serviceVersion: '1.0.0',
      deploymentMode: 'LOCAL',
    });
    const server = createNextAgentFastifyServer();
    server.get('/metrics/:id', async () => ({ ok: true }));
    try {
      await server.listen({ host: '127.0.0.1', port: 0 });
      const address = server.server.address();
      if (address === null || typeof address === 'string') {
        throw new Error('server address unavailable');
      }
      const response = await fetch(`http://127.0.0.1:${address.port}/metrics/metric-secret-canary?token=metric-secret-canary`, {
        headers: { 'x-request-id': 'forged-metric-request-id', authorization: 'Bearer metric-secret-canary' },
      });
      await response.text();
      await metrics.forceFlush();

      const exportedMetrics = exports.flatMap((resource) => resource.scopeMetrics.flatMap((scope) => scope.metrics));
      const httpMetric = exportedMetrics.find((metric) => metric.descriptor.name === 'http.server.request.duration');
      expect(httpMetric?.descriptor.unit).toBe('s');
      expect(httpMetric?.dataPointType).toBe(DataPointType.HISTOGRAM);
      expect(httpMetric?.dataPoints).toHaveLength(1);
      expect((httpMetric?.dataPoints[0]?.value as { count?: number } | undefined)?.count).toBe(1);
      expect(httpMetric?.dataPoints[0]?.attributes).toMatchObject({
        'http.request.method': 'GET',
        'http.response.status_code': 200,
      });
      expect(JSON.stringify(httpMetric)).not.toContain('metric-secret-canary');
      expect(JSON.stringify(httpMetric)).not.toContain('forged-metric-request-id');
      expect(
        exportedMetrics.some((metric) => metric.descriptor.name === 'web_request_total' || metric.descriptor.name === 'web_request_duration_seconds'),
      ).toBe(false);
    } finally {
      await server.close();
      await metrics.shutdown();
    }
  });
});

const requestCatalogEvents = new Set([
  'request.accepted',
  'request.completed',
  'request.failed',
  'model.invocation.started',
  'model.invocation.completed',
  'model.invocation.failed',
  'model.payload.input_captured',
  'model.payload.output_captured',
  'model.payload.failed',
  'model.stream.first_visible_content',
  'context.assembly.completed',
  'policy.allowed',
  'hook.completed',
  'sandbox.execution.completed',
  'capability.started',
  'capability.completed',
  'capability.failed',
  'capability.denied',
  'tool.call.failed',
  'tool.payload.captured',
]);

function requestSkeletonModel(withCapability: boolean): ModelInvocationService {
  let invocation = 0;
  return {
    async complete() {
      return { content: 'skeleton complete', usage: { inputTokens: 4, outputTokens: 3, totalTokens: 7 } };
    },
    async stream(_request, _signal, onDelta) {
      invocation += 1;
      if (withCapability && invocation === 1) {
        return {
          content: '',
          finishReason: 'tool-calls',
          toolCalls: [{ toolCallId: 'tool-read-skeleton', toolName: 'Read', arguments: { file_path: 'package.json', offset: 0, limit: 1 } }],
          usage: { inputTokens: 3, outputTokens: 2, totalTokens: 5 },
        };
      }
      await onDelta({ content: 'skeleton ' });
      return {
        content: 'complete',
        finishReason: 'stop',
        usage: { inputTokens: 4, outputTokens: 3, totalTokens: 7 },
      };
    },
  };
}

async function waitForCatalogEntries(
  writer: Awaited<ReturnType<typeof createOperationalLogWriter>>,
  expected: number,
): Promise<Array<Record<string, unknown>>> {
  const deadline = Date.now() + 2_000;
  let latest: Array<Record<string, unknown>> = [];
  do {
    await writer.flush(500);
    const file = writer.activeIdentity()?.file;
    if (file !== undefined) {
      const entries = readFileSync(file, 'utf8')
        .split(/\r?\n/u)
        .filter((line) => line.length > 0)
        .map((line) => JSON.parse(line) as Record<string, unknown>)
        .filter(
          (entry) =>
            entry.msg === 'request completed' ||
            entry.msg === 'request errored' ||
            (typeof entry.event === 'string' && requestCatalogEvents.has(entry.event)),
        );
      latest = entries;
      if (entries.length >= expected) {
        return entries;
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  } while (Date.now() < deadline);
  return latest;
}
