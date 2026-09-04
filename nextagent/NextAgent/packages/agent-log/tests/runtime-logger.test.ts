import { mkdtempSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import { AgentError, runWithRuntimeLogCorrelation } from '@nextagent/agent-common';
import { createOperationalLogWriter as createOperationalLogWriterBase, type OperationalRuntimeLoggingPolicy } from '../src/index.js';
import { createOperationalLogWriterWithDependencies, type ConsoleDestination, type OperationalWriterDependencies } from '../src/testing.js';
import type { LocalFileAppendResult, LocalFileMaintenanceEvent, LocalFileRollHandle, LocalFileRollPolicy } from '@nextagent/agent-local-file-roll';

function createOperationalLogWriter(
  policy: Parameters<typeof createOperationalLogWriterBase>[0],
  options: Parameters<typeof createOperationalLogWriterBase>[1] = { serviceVersion: 'agent-test-1.0.0' },
) {
  return createOperationalLogWriterBase(policy, options);
}

describe('operational runtime logger', () => {
  it('gives every error a low-cardinality classification and omits messages from stable events', async () => {
    const harness = fakeDestinations();
    const writer = await createOperationalLogWriterWithDependencies(filePolicy(process.cwd()), { serviceVersion: '1.2.3' }, harness.dependencies);
    const logger = writer.getLogger({ component: 'agent-runtime' });
    logger.error({ event: 'runtime.unclassified.failed', err: new Error('root cause') }, 'duplicate failure message');
    logger.error({ event: 'runtime.classified.failed', safeErrorCode: 'KNOWN_FAILURE' }, 'duplicate classified message');
    logger.info({ event: 'runtime.completed', message: 'caller message' }, 'duplicate completion message');

    const entries = harness.file.lines.map((line) => JSON.parse(line) as Record<string, unknown>);
    expect(entries.find((entry) => entry.event === 'runtime.unclassified.failed')).toMatchObject({
      safeReasonCode: 'UNCLASSIFIED_RUNTIME_ERROR',
      rawExceptionData: expect.objectContaining({ message: 'root cause' }),
    });
    expect(entries.find((entry) => entry.event === 'runtime.classified.failed')).toMatchObject({ safeErrorCode: 'KNOWN_FAILURE' });
    for (const entry of entries.filter((candidate) => String(candidate.event).startsWith('runtime.'))) {
      expect(entry).not.toHaveProperty('msg');
      expect(entry).not.toHaveProperty('message');
    }
    await writer.close(100);
  });

  it('accepts trace correlation only from runtime scope or observation projector surface', async () => {
    const harness = fakeDestinations();
    const writer = await createOperationalLogWriterWithDependencies(filePolicy(process.cwd()), { serviceVersion: '1.2.3' }, harness.dependencies);
    const runtime = writer.getLogger({ component: 'agent-runtime' });
    const observation = writer.getObservationLogger({ component: 'agent-observability' });
    runtime.info({ event: 'runtime.trace.spoofed', traceId: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', spanId: 'bbbbbbbbbbbbbbbb' });
    runWithRuntimeLogCorrelation({ traceId: '11111111111111111111111111111111', spanId: '2222222222222222' }, () =>
      runtime.info({ event: 'runtime.trace.correlated', traceId: 'spoofed', spanId: 'spoofed' }),
    );
    observation.info({
      event: 'request.accepted',
      traceId: '33333333333333333333333333333333',
      spanId: '4444444444444444',
    });

    const entries = harness.file.lines.map((line) => JSON.parse(line) as Record<string, unknown>);
    expect(entries.find((entry) => entry.event === 'runtime.trace.spoofed')).not.toEqual(
      expect.objectContaining({ traceId: expect.anything(), spanId: expect.anything() }),
    );
    expect(entries.find((entry) => entry.event === 'runtime.trace.correlated')).toMatchObject({
      traceId: '11111111111111111111111111111111',
      spanId: '2222222222222222',
    });
    expect(entries.find((entry) => entry.event === 'request.accepted')).toMatchObject({
      traceId: '33333333333333333333333333333333',
      spanId: '4444444444444444',
    });
    await writer.close(100);
  });

  it('writes both surfaces through one physical envelope and owns reserved fields', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'nextagent-log-envelope-'));
    const writer = await createOperationalLogWriter(filePolicy(directory), { serviceVersion: '1.2.3' });
    const logger = writer.getLogger({ component: 'agent-runtime', source: 'request-runner' });

    logger.info({
      event: 'runtime.test',
      timestamp: 'caller',
      level: 'caller',
      surface: 'caller',
      component: 'caller',
      source: 'caller',
      serviceVersion: 'caller',
      requestId: 'request-1',
      tenantId: 'tenant-private',
      subjectId: 'subject-private',
      requestContextId: 'context-private',
      stepId: 'step-private',
      ownerScope: { tenantId: 'tenant-private' },
      correlation: { requestRunId: 'run-private' },
    });
    writer.getObservationLogger({ component: 'agent-observability', source: 'timeline' }).warn({
      event: 'request.failed',
      surface: 'caller',
      component: 'caller',
      source: 'caller',
      serviceVersion: 'caller',
      requestId: 'request-2',
      token: 'observation-secret-canary',
      path: 'C:\\private\\observation.json',
    });
    await writer.flush(2_000);
    const active = writer.activeIdentity();
    await writer.close(2_000);

    const entries = readFileSync(active!.file, 'utf8')
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as Record<string, unknown>);
    expect(entries).toHaveLength(3);
    expect(entries).toEqual(
      expect.arrayContaining([expect.objectContaining({ event: 'logging.transport.ready', level: 'info', component: 'agent-log' })]),
    );
    const direct = entries.find((entry) => entry.requestId === 'request-1');
    expect(direct).toMatchObject({
      event: 'runtime.test',
      level: 'info',
      surface: 'runtime_diagnostic',
      component: 'agent-runtime',
      source: 'request-runner',
      serviceVersion: '1.2.3',
      requestId: 'request-1',
    });
    expect(direct?.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/u);
    expect(direct).not.toHaveProperty('tenantId');
    expect(direct).not.toHaveProperty('subjectId');
    expect(direct).not.toHaveProperty('requestContextId');
    expect(direct).not.toHaveProperty('stepId');
    expect(direct).not.toHaveProperty('ownerScope');
    expect(direct).not.toHaveProperty('correlation');
    const observation = entries.find((entry) => entry.event === 'request.failed');
    expect(observation).toMatchObject({
      level: 'warn',
      surface: 'observation_derived',
      component: 'agent-observability',
      source: 'timeline',
      serviceVersion: '1.2.3',
      requestId: 'request-2',
      token: '<redacted:credential>',
      path: '<omitted:policy>',
    });
    expect(JSON.stringify(observation)).not.toMatch(/observation-secret-canary|C:\\private/u);
  });

  it('keeps the approved execution exception diagnostics in the local runtime file', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'nextagent-log-raw-exception-'));
    const writer = await createOperationalLogWriter(filePolicy(directory));
    writer.getLogger({ component: 'agent-runtime' }).error({
      event: 'request.execution.exception_captured',
      rawExceptionData: {
        name: 'Error',
        message: 'sandbox failure at C:\\sandbox\\run.ts',
        stack: 'Error: sandbox failure at C:\\sandbox\\run.ts',
        cause: { message: 'request to https://sandbox.example.test/run failed', token: 'must-redact' },
        prompt: 'must-redact',
      },
    });
    await writer.flush(2_000);
    const active = writer.activeIdentity();
    await writer.close(2_000);

    const entries = readFileSync(active!.file, 'utf8')
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as Record<string, unknown>);
    expect(entries.find((entry) => entry.event === 'request.execution.exception_captured')).toMatchObject({
      rawExceptionData: {
        name: 'Error',
        message: 'sandbox failure at C:\\sandbox\\run.ts',
        stack: 'Error: sandbox failure at C:\\sandbox\\run.ts',
        cause: { message: 'request to https://sandbox.example.test/run failed', token: '<redacted:credential>' },
        prompt: 'must-redact',
      },
    });
  });

  it('keeps long runtime exception messages useful within the bounded diagnostic budget', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'nextagent-log-long-raw-exception-'));
    const writer = await createOperationalLogWriter(filePolicy(directory));
    const longDetail = 'retryable failure detail '.repeat(30);
    writer.getLogger({ component: 'agent-runtime' }).error({
      event: 'request.execution.exception_captured',
      rawExceptionData: {
        name: 'Error',
        message: `sandbox failed because ${longDetail}token=sk-log-runtime-exception-secret`,
        cause: { message: `child process reported ${longDetail}` },
      },
    });
    await writer.flush(2_000);
    const active = writer.activeIdentity();
    await writer.close(2_000);

    const entries = readFileSync(active!.file, 'utf8')
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as Record<string, unknown>);
    const entry = entries.find((item) => item.event === 'request.execution.exception_captured') as
      { rawExceptionData?: { message?: string; cause?: { message?: string } } } | undefined;
    expect(entry?.rawExceptionData?.message).toContain('sandbox failed because retryable failure detail retryable failure detail');
    expect(entry?.rawExceptionData?.message?.length).toBeGreaterThan(96);
    expect(entry?.rawExceptionData?.cause?.message).toContain('child process reported retryable failure detail');
    expect(JSON.stringify(entry)).not.toContain('sk-log-runtime-exception-secret');
  });

  it('filters by threshold and drops an observation without a trusted event', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'nextagent-log-level-'));
    const writer = await createOperationalLogWriter(filePolicy(directory, { level: 'info' }));

    writer.getLogger({ component: 'agent-app' }).debug({ event: 'debug.child' });
    writer.getObservationLogger({ component: 'agent-observability' }).info({});
    writer.getLogger({ component: 'agent-app' }).error({ event: 'app.failed' });
    await writer.flush(2_000);
    const active = writer.activeIdentity();
    await writer.close(2_000);

    const lines = readFileSync(active!.file, 'utf8').trim().split('\n');
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0]!)).toMatchObject({ event: 'logging.transport.ready', level: 'info' });
    expect(JSON.parse(lines[1]!)).toMatchObject({ event: 'app.failed', level: 'error' });
  });

  it('allows only the trusted framework logger to emit a native eventless access record', async () => {
    const harness = fakeDestinations();
    const writer = await createOperationalLogWriterWithDependencies(filePolicy(process.cwd()), {}, harness.dependencies);
    const getServerAccessLogger = writer.getServerAccessLogger;
    if (getServerAccessLogger === undefined) {
      throw new Error('server access logger unavailable');
    }

    writer
      .getLogger({ component: 'agent-channel-web', source: 'fastify' })
      .info({ serverRequestId: 'req-ordinary', res: { statusCode: 200 }, responseTime: 1.25 }, 'request completed');
    const nativeLogger = getServerAccessLogger({ component: 'agent-channel-web', source: 'fastify' });
    expect(nativeLogger.version).toBe('10.3.1');
    const requestLogger = nativeLogger.child({ reqId: 'req-native' });
    requestLogger.info(
      {
        req: {
          method: 'GET',
          url: '/raw?token=access-secret-canary',
          headers: { authorization: 'Bearer access-secret-canary' },
          routeOptions: { url: '/api/v1/sessions/:sessionId' },
        },
      },
      'incoming request',
    );
    requestLogger.child({ req: { method: 'GET', routeOptions: { url: '/api/v1/sessions/:sessionId' } } }).info(
      {
        res: { statusCode: 204 },
        responseTime: 1.5,
        headers: { authorization: 'Bearer access-secret-canary' },
        url: '/raw?token=access-secret-canary',
      },
      'request completed',
    );
    nativeLogger.child({ reqId: 'req-wrong-level' }).warn({ res: { statusCode: 200 }, responseTime: 1.5 }, 'request completed');

    const entries = harness.file.lines.map((line) => JSON.parse(line) as Record<string, unknown>);
    const access = entries.filter((entry) => entry.msg === 'request completed');
    const incoming = entries.filter((entry) => entry.msg === 'incoming request');
    expect(incoming).toEqual([]);
    expect(access).toEqual([
      expect.objectContaining({
        level: 'info',
        surface: 'runtime_diagnostic',
        component: 'agent-channel-web',
        source: 'fastify',
        reqId: 'req-native',
        req: { method: 'GET', url: '/api/v1/sessions/:sessionId' },
        res: { statusCode: 204 },
        responseTime: 1.5,
        msg: 'request completed',
      }),
    ]);
    expect(access[0]).not.toHaveProperty('event');
    expect(JSON.stringify([incoming, access])).not.toMatch(/access-secret-canary|authorization|raw\?/u);
    await writer.close(100);
  });

  it.each([
    ['error', 1],
    ['warn', 2],
    ['info', 3],
    ['debug', 4],
  ] as const)('routes the four levels at %s threshold', async (level, expectedLines) => {
    const harness = fakeDestinations();
    const writer = await createOperationalLogWriterWithDependencies(filePolicy(process.cwd(), { level }), {}, harness.dependencies);
    const logger = writer.getLogger({ component: 'agent-runtime' });

    logger.error({ event: 'error' });
    logger.warn({ event: 'warn' });
    logger.info({ event: 'info' });
    logger.debug({ event: 'debug' });

    expect(harness.file.lines).toHaveLength(expectedLines + (level === 'info' || level === 'debug' ? 1 : 0));
    await writer.close(100);
  });

  it('redacts forbidden content and substitutes an oversized entry', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'nextagent-log-redaction-'));
    const writer = await createOperationalLogWriter(filePolicy(directory));
    const logger = writer.getLogger({ component: 'agent-core' });

    logger.info({ event: 'redaction.test', token: 'secret-canary', safeCode: 'ok' });
    logger.warn({ event: 'oversize.test', ...Object.fromEntries(Array.from({ length: 32 }, (_, index) => [`field${index}`, 'x'.repeat(1_024)])) });
    await writer.flush(2_000);
    const active = writer.activeIdentity();
    await writer.close(2_000);

    const text = readFileSync(active!.file, 'utf8');
    expect(text).not.toContain('secret-canary');
    expect(text).not.toContain('abcdefghijklmnop');
    expect(text).not.toContain('x'.repeat(2_000));
    expect(text).toContain('entry_too_large');
  });

  it('preserves bounded raw Tool payload while narrowly redacting credential and authentication token values', async () => {
    const harness = fakeDestinations();
    const writer = await createOperationalLogWriterWithDependencies(filePolicy(process.cwd()), {}, harness.dependencies);
    const logger = writer.getLogger({ component: 'agent-core' });

    logger.error({
      event: 'tool.call.failed',
      toolInput: {
        command: 'python scripts/check.py --config C:\\workspace\\agent\\config.yaml',
        quotedCommand: 'curl "https://example.test/check?appsecret=dummy-secret&mode=check"',
        quotedAssignment: 'password="quoted-secret"; mode=check',
        file_path: 'C:\\workspace\\agent\\config.yaml',
        pattern: 'interface failure',
        token: 'sk-sensitive-token-12345',
        accessToken: 'access-token-secret',
        refresh_token: 'refresh-token-secret',
        tokenValue: 'explicit-token-secret',
        prompt: 'inspect the raw result',
        credential: 'tool-credential-secret',
        credentialValue: 'explicit-credential-secret',
        password: 'tool-password-secret',
        apiKey: 'tool-api-key-secret',
        credentialRef: 'vault:tool-primary',
        credentialStatus: 'missing',
        secretStatus: 'unavailable',
        inputTokens: 1_536,
        maxTokens: 4_096,
        tokenCount: 3,
        tokenLength: 17,
        tokenizationIssue: 'token count mismatch at tokenizer boundary',
        ordinaryIssue: 'disk-abcdefghijk failed while parsing Bearer token metadata',
        nested: { authorization: 'Bearer abcdefghijklmnop' },
      },
      toolOutput: {
        content: 'raw output token=sk-output-token-12345',
        path: 'C:\\workspace\\agent\\result.json',
        credential: 'tool-output-credential',
        credentialRef: 'vault:tool-output',
        outputTokens: 512,
        totalTokens: 2_048,
        tokenCount: 4,
        tokenizationStatus: 'token stream mismatch',
        oversized: 'x'.repeat(2_048),
      },
    });

    const entry = JSON.parse(harness.file.lines.find((line) => line.includes('tool.call.failed'))!) as Record<string, unknown>;
    expect(entry).toMatchObject({
      toolInput: {
        command: 'python scripts/check.py --config C:\\workspace\\agent\\config.yaml',
        quotedCommand: 'curl "https://example.test/check?appsecret=<redacted:credential>&mode=check"',
        quotedAssignment: 'password="<redacted:credential>"; mode=check',
        file_path: 'C:\\workspace\\agent\\config.yaml',
        pattern: 'interface failure',
        token: '<redacted:credential>',
        accessToken: '<redacted:credential>',
        refresh_token: '<redacted:credential>',
        tokenValue: '<redacted:credential>',
        prompt: 'inspect the raw result',
        credential: '<redacted:credential>',
        credentialValue: '<redacted:credential>',
        password: '<redacted:credential>',
        apiKey: '<redacted:credential>',
        credentialRef: 'vault:tool-primary',
        credentialStatus: 'missing',
        secretStatus: 'unavailable',
        inputTokens: 1_536,
        maxTokens: 4_096,
        tokenCount: 3,
        tokenLength: 17,
        tokenizationIssue: 'token count mismatch at tokenizer boundary',
        ordinaryIssue: 'disk-abcdefghijk failed while parsing Bearer token metadata',
        nested: { authorization: '<redacted:credential>' },
      },
      toolOutput: {
        content: 'raw output token=<redacted:credential>',
        path: 'C:\\workspace\\agent\\result.json',
        credential: '<redacted:credential>',
        credentialRef: 'vault:tool-output',
        outputTokens: 512,
        totalTokens: 2_048,
        tokenCount: 4,
        tokenizationStatus: 'token stream mismatch',
        oversized: 'x'.repeat(2_048),
      },
    });
    expect(JSON.stringify(entry)).not.toContain('sk-sensitive-token-12345');
    expect(JSON.stringify(entry)).not.toContain('access-token-secret');
    expect(JSON.stringify(entry)).not.toContain('refresh-token-secret');
    expect(JSON.stringify(entry)).not.toContain('explicit-token-secret');
    expect(JSON.stringify(entry)).not.toContain('tool-credential-secret');
    expect(JSON.stringify(entry)).not.toContain('explicit-credential-secret');
    expect(JSON.stringify(entry)).not.toContain('tool-password-secret');
    expect(JSON.stringify(entry)).not.toContain('tool-api-key-secret');
    expect(JSON.stringify(entry)).not.toContain('sk-output-token-12345');
    expect(JSON.stringify(entry)).not.toContain('tool-output-credential');
    expect(JSON.stringify(entry)).not.toContain('Bearer abcdefghijklmnop');
    await writer.close(100);
  });

  it('rejects raw Tool payload fields from the observation-derived surface', async () => {
    const harness = fakeDestinations();
    const writer = await createOperationalLogWriterWithDependencies(filePolicy(process.cwd()), {}, harness.dependencies);
    const logger = writer.getObservationLogger({ component: 'agent-observability' });

    logger.info({
      event: 'capability.completed',
      toolInput: { token: 'sk-observation-input-secret' },
      toolOutput: { content: 'raw observation output secret' },
    });

    const entry = JSON.parse(harness.file.lines.find((line) => line.includes('capability.completed'))!) as Record<string, unknown>;
    expect(entry).toMatchObject({
      surface: 'observation_derived',
      toolInput: '<omitted:policy>',
      toolOutput: '<omitted:policy>',
    });
    expect(JSON.stringify(entry)).not.toContain('sk-observation-input-secret');
    expect(JSON.stringify(entry)).not.toContain('raw observation output secret');
    await writer.close(100);
  });

  it('keeps local Model payloads bounded, removes SYSTEM messages, and rejects them from observations', async () => {
    const harness = fakeDestinations();
    const writer = await createOperationalLogWriterWithDependencies(filePolicy(process.cwd()), {}, harness.dependencies);
    writer.getLogger({ component: 'agent-core' }).info({
      event: 'model.payload.input_captured',
      stepId: 'model:1',
      modelInput: {
        modelId: 'test-model',
        tools: [{ name: 'Read', description: 'Read a file', inputSchema: { type: 'object' } }],
        messages: [
          { role: 'SYSTEM', content: [{ type: 'text', text: 'system secret' }] },
          { role: 'USER', content: [{ type: 'text', text: 'diagnose cell outage at C:\\network\\alarm.log' }] },
          {
            role: 'ASSISTANT',
            content: [
              {
                type: 'tool-call',
                toolCall: {
                  toolCallId: 'call-1',
                  toolName: 'Read',
                  arguments: { file_path: 'C:\\network\\alarm.log', nested: { site: { cell: 'cell-1' } } },
                },
              },
            ],
          },
          {
            role: 'TOOL',
            content: [{ type: 'tool-result', toolCallId: 'call-1', toolName: 'Read', output: { status: 'FAILED', cause: 'transport link down' } }],
          },
        ],
        providerOptions: { credentialRef: 'vault:model-primary', accessToken: 'model-access-secret', tokenCount: 12 },
      },
    });
    writer.getLogger({ component: 'agent-core' }).info({
      event: 'model.payload.output_captured',
      stepId: 'model:1',
      modelOutput: {
        content: 'Root cause is transport link loss.',
        reasoning: 'must be omitted',
        finishReason: 'stop',
        usage: { inputTokens: 12, outputTokens: 8 },
      },
    });
    writer.getObservationLogger({ component: 'agent-observability' }).info({
      event: 'model.invocation.completed',
      modelInput: { messages: [{ role: 'USER', content: 'observation input secret' }] },
      modelOutput: { content: 'observation output secret' },
    });

    const entries = harness.file.lines.map((line) => JSON.parse(line) as Record<string, unknown>);
    expect(entries.find((entry) => entry.event === 'model.payload.input_captured')).toMatchObject({
      stepId: 'model:1',
      modelInput: {
        messages: [
          { role: 'USER', content: [{ type: 'text', text: 'diagnose cell outage at C:\\network\\alarm.log' }] },
          {
            role: 'ASSISTANT',
            content: [
              {
                type: 'tool-call',
                toolCall: {
                  toolCallId: 'call-1',
                  toolName: 'Read',
                  arguments: { file_path: 'C:\\network\\alarm.log', nested: { safeReasonCode: 'value_truncated' } },
                },
              },
            ],
          },
          {
            role: 'TOOL',
            content: [{ type: 'tool-result', toolCallId: 'call-1', toolName: 'Read', output: { status: 'FAILED', cause: 'transport link down' } }],
          },
        ],
      },
    });
    expect(Object.keys(entries.find((entry) => entry.event === 'model.payload.input_captured')?.modelInput as Record<string, unknown>)).toEqual([
      'messages',
    ]);
    expect(entries.find((entry) => entry.event === 'model.payload.output_captured')).toMatchObject({
      stepId: 'model:1',
      modelOutput: { content: 'Root cause is transport link loss.', finishReason: 'stop', usage: { inputTokens: 12, outputTokens: 8 } },
    });
    expect(entries.find((entry) => entry.event === 'model.payload.output_captured')).not.toHaveProperty('modelOutput.reasoning');
    expect(entries.find((entry) => entry.event === 'model.invocation.completed')).toMatchObject({
      modelInput: '<omitted:policy>',
      modelOutput: '<omitted:policy>',
    });
    expect(JSON.stringify(entries)).not.toMatch(
      /system secret|Read a file|vault:model-primary|must be omitted|observation input secret|observation output secret|model-access-secret/u,
    );
    await writer.close(100);
  });

  it('automatically derives local raw exception data and preserves trusted Tool payload steps', async () => {
    const harness = fakeDestinations();
    const writer = await createOperationalLogWriterWithDependencies(filePolicy(process.cwd()), {}, harness.dependencies);
    const cause = Object.assign(new Error('sandbox command failed at C:\\sandbox\\run.cmd'), {
      credentialRef: 'vault:sandbox',
      accessToken: 'sandbox-access-secret',
    });
    const failure = new TypeError('question association handler is not a function');
    failure.cause = cause;
    const logger = writer.getLogger({ component: 'agent-channel-web' });

    logger.error({ event: 'server.framework.failed', err: failure, serverRequestId: 'server-1' });
    logger.info({ event: 'tool.payload.captured', stepId: 'tool:1', toolCallId: 'call-1', toolInput: { command: 'echo failed' } });
    logger.error({ event: 'tool.call.failed', stepId: 'tool:1', toolCallId: 'call-1', safeErrorCode: 'TOOL_FAILED' });
    logger.error({ event: 'tool.call.result_invalid', stepId: 'tool:1', toolCallId: 'call-1', safeErrorCode: 'TOOL_RESULT_INVALID' });
    logger.warn({ event: 'tool.loop.repeated_failure', stepId: 'tool:1', toolCallId: 'call-1', safeErrorCode: 'REPEATED_FAILURE' });

    const entries = harness.file.lines.map((line) => JSON.parse(line) as Record<string, unknown>);
    expect(entries.find((entry) => entry.event === 'server.framework.failed')).toMatchObject({
      serverRequestId: 'server-1',
      rawExceptionData: {
        name: 'TypeError',
        message: 'question association handler is not a function',
        cause: {
          message: 'sandbox command failed at C:\\sandbox\\run.cmd',
        },
      },
    });
    expect(entries.find((entry) => entry.event === 'server.framework.failed')).toMatchObject({
      rawExceptionData: { cause: { credentialRef: 'vault:sandbox', accessToken: '<redacted:credential>' } },
    });
    expect(entries.find((entry) => entry.event === 'tool.payload.captured')).toMatchObject({ stepId: 'tool:1', toolCallId: 'call-1' });
    expect(entries.find((entry) => entry.event === 'tool.call.failed')).toMatchObject({ stepId: 'tool:1', toolCallId: 'call-1' });
    expect(entries.find((entry) => entry.event === 'tool.call.result_invalid')).toMatchObject({ stepId: 'tool:1', toolCallId: 'call-1' });
    expect(entries.find((entry) => entry.event === 'tool.loop.repeated_failure')).toMatchObject({ stepId: 'tool:1', toolCallId: 'call-1' });
    expect(JSON.stringify(entries)).not.toContain('sandbox-access-secret');
    await writer.close(100);
  });

  it('preserves safe error summaries while applying centralized string redaction', async () => {
    const harness = fakeDestinations();
    const writer = await createOperationalLogWriterWithDependencies(filePolicy(process.cwd()), {}, harness.dependencies);
    const logger = writer.getLogger({ component: 'agent-core' });

    logger.error({
      event: 'tool.call.failed',
      safeErrorCode: 'SANDBOX_UNAVAILABLE',
      safeErrorSummary: 'Sandbox unavailable at C:\\workspace\\agent with token=sk-safe-summary-secret',
    });

    const entry = JSON.parse(harness.file.lines.find((line) => line.includes('tool.call.failed'))!) as Record<string, unknown>;
    expect(entry).toMatchObject({
      safeErrorSummary: 'Sandbox unavailable at <omitted:policy> with token=<redacted:credential>',
    });
    expect(JSON.stringify(entry)).not.toContain('C:\\workspace\\agent');
    expect(JSON.stringify(entry)).not.toContain('sk-safe-summary-secret');
    await writer.close(100);
  });

  it('preserves approved token counts without weakening adjacent redaction', async () => {
    const harness = fakeDestinations();
    const writer = await createOperationalLogWriterWithDependencies(filePolicy(process.cwd()), {}, harness.dependencies);
    const logger = writer.getLogger({ component: 'agent-channel-web' });

    logger.info({
      event: 'model.usage.recorded',
      usage: { inputTokens: 12, outputTokens: 7, totalTokens: 19 },
      accessToken: 'secret-token-canary',
      path: 'C:\\private\\route.txt',
    });
    logger.info({
      event: 'model.usage.invalid',
      usage: { inputTokens: -1, outputTokens: 1.5, totalTokens: '19' },
    });

    const entries = harness.file.lines.map((line) => JSON.parse(line) as Record<string, unknown>);
    expect(entries.find((entry) => entry.event === 'model.usage.recorded')).toMatchObject({
      usage: { inputTokens: 12, outputTokens: 7, totalTokens: 19 },
      accessToken: '<redacted:credential>',
      path: '<omitted:policy>',
    });
    expect(entries.find((entry) => entry.event === 'model.usage.invalid')).toMatchObject({
      usage: {},
    });
    expect(JSON.stringify(entries)).not.toMatch(/secret-token-canary|C:\\private/u);
    await writer.close(100);
  });

  it('applies exact field policy, typed markers, and approved value validators', async () => {
    const harness = fakeDestinations();
    const writer = await createOperationalLogWriterWithDependencies(filePolicy(process.cwd()), {}, harness.dependencies);
    const logger = writer.getLogger({ component: 'agent-observability' });
    const safeNames = Array.from({ length: 20 }, (_, index) => `tool-${index}`);

    logger.info({
      event: 'redaction.exact_policy',
      tokenLength: 128,
      contentLength: 256,
      pathPolicyStatus: 'ALLOWED',
      commandExitCode: -1,
      durationMs: 1.5,
      inputTokens: 12,
      tokenizerLength: 64,
      tokenCount: 32,
      contentDigest: 'sha256-safe',
      pathologyStatus: 'healthy',
      commandMode: 'read-only',
      content: 'raw-content-canary',
      path: '/private/path-canary',
      command: 'rm-canary',
      accessToken: 'credential-canary',
      refresh_token: 'credential-canary',
      service_api_key: 'credential-canary',
      prompt: 'raw-prompt-canary',
      disclosedCapabilityNames: safeNames,
      disclosedCapabilityNamesTruncated: 'false',
      generatedMessageKinds: ['USER', 'USER_META'],
      contextPatchFields: ['allowedTools', 'modelId'],
      argumentProjectionStatus: 'PROJECTED',
      resultProjectionStatus: 'NOT_PRODUCED',
      toolResultStatus: 'ROUTE_OK',
      reasonCode: 'NO_ALARM',
    });
    logger.info({
      event: 'redaction.invalid_approved',
      tokenLength: '128',
      pathPolicyStatus: 'not-safe',
      commandExitCode: 2 ** 40,
      argumentProjectionStatus: 'UNKNOWN',
      disclosedCapabilityNames: ['safe', 'bad name'],
      generatedMessageKinds: ['USER_META', 'USER'],
      contextPatchFields: ['modelId', 'allowedTools'],
    });

    const entries = harness.file.lines.map((line) => JSON.parse(line) as Record<string, unknown>);
    const exact = entries.find((entry) => entry.event === 'redaction.exact_policy');
    expect(exact).toMatchObject({
      tokenLength: 128,
      contentLength: 256,
      pathPolicyStatus: 'ALLOWED',
      commandExitCode: -1,
      durationMs: 1.5,
      inputTokens: 12,
      tokenizerLength: 64,
      tokenCount: 32,
      contentDigest: 'sha256-safe',
      pathologyStatus: 'healthy',
      commandMode: 'read-only',
      content: '<omitted:policy>',
      path: '<omitted:policy>',
      command: '<omitted:policy>',
      accessToken: '<redacted:credential>',
      refresh_token: '<redacted:credential>',
      service_api_key: '<redacted:credential>',
      prompt: '<omitted:policy>',
      disclosedCapabilityNames: safeNames,
      disclosedCapabilityNamesTruncated: 'false',
      generatedMessageKinds: ['USER', 'USER_META'],
      contextPatchFields: ['allowedTools', 'modelId'],
      argumentProjectionStatus: 'PROJECTED',
      resultProjectionStatus: 'NOT_PRODUCED',
      toolResultStatus: 'ROUTE_OK',
      reasonCode: 'NO_ALARM',
    });
    const invalid = entries.find((entry) => entry.event === 'redaction.invalid_approved');
    expect(invalid).not.toHaveProperty('tokenLength');
    expect(invalid).not.toHaveProperty('pathPolicyStatus');
    expect(invalid).not.toHaveProperty('commandExitCode');
    expect(invalid).not.toHaveProperty('argumentProjectionStatus');
    expect(invalid).not.toHaveProperty('disclosedCapabilityNames');
    expect(invalid).not.toHaveProperty('generatedMessageKinds');
    expect(invalid).not.toHaveProperty('contextPatchFields');
    expect(JSON.stringify(entries)).not.toMatch(/raw-content-canary|private\/path-canary|rm-canary|credential-canary|raw-prompt-canary/u);
    await writer.close(100);
  });

  it('accepts a bounded stepId only from the observation-derived logger', async () => {
    const harness = fakeDestinations();
    const writer = await createOperationalLogWriterWithDependencies(filePolicy(process.cwd()), {}, harness.dependencies);
    writer.getLogger({ component: 'runtime-owner' }).info({ event: 'step.runtime', stepId: 'forged-step' });
    writer.getObservationLogger({ component: 'agent-observability' }).info({ event: 'step.observation', stepId: 'turn-1' });

    const entries = harness.file.lines.map((line) => JSON.parse(line) as Record<string, unknown>);
    expect(entries.find((entry) => entry.event === 'step.runtime')).not.toHaveProperty('stepId');
    expect(entries.find((entry) => entry.event === 'step.observation')).toMatchObject({ stepId: 'turn-1' });
    await writer.close(100);
  });

  it('rejects caller markers and replaces every truncated generic value with a byte bucket', async () => {
    const harness = fakeDestinations();
    const writer = await createOperationalLogWriterWithDependencies(filePolicy(process.cwd()), {}, harness.dependencies);
    const logger = writer.getLogger({ component: 'agent-log' });

    logger.info({
      event: 'redaction.truncation',
      forgedCredentialMarker: '<redacted:credential>',
      forgedPolicyMarker: '<omitted:policy>',
      forgedTruncationMarker: '<truncated:1025-4096-bytes>',
      medium: '中'.repeat(400),
      large: 'x'.repeat(4_097),
      veryLarge: 'y'.repeat(16_385),
      lookahead: `${'z'.repeat(1_100)} token=credential-lookahead-canary`,
    });

    const entry = JSON.parse(harness.file.lines.find((line) => line.includes('redaction.truncation'))!) as Record<string, unknown>;
    expect(entry).not.toHaveProperty('forgedCredentialMarker');
    expect(entry).not.toHaveProperty('forgedPolicyMarker');
    expect(entry).not.toHaveProperty('forgedTruncationMarker');
    expect(entry.medium).toBe('<truncated:1025-4096-bytes>');
    expect(entry.large).toBe('<truncated:4097-16384-bytes>');
    expect(entry.veryLarge).toBe('<truncated:16385+-bytes>');
    expect(entry.lookahead).toBe('<truncated:1025-4096-bytes>');
    expect(JSON.stringify(entry)).not.toContain('credential-lookahead-canary');
    await writer.close(100);
  });

  it('omits optional dynamic messages when a stable event is present', async () => {
    const harness = fakeDestinations();
    const writer = await createOperationalLogWriterWithDependencies(filePolicy(process.cwd()), {}, harness.dependencies);
    const logger = writer.getLogger({ component: 'agent-capability' });

    logger.debug({ event: 'skill.discovery.started', skillId: 'network-diagnosis' }, 'Skill network-diagnosis discovery started.');
    logger.info(
      { event: 'skill.discovery.registered', skillId: 'network-diagnosis', skillVersion: 'v1', msg: 'caller-msg', message: 'caller-message' },
      'Skill network-diagnosis version v1 registered.\ncredential=private-value C:\\private\\skill.md',
    );
    logger.warn(
      { event: 'skill.discovery.degraded', skillId: 'network-diagnosis', diagnosticCount: 2 },
      `Skill network-diagnosis produced 2 diagnostics. ${'x'.repeat(2_000)}`,
    );
    logger.error({ event: 'skill.discovery.failed', skillId: 'network-diagnosis' }, 'Skill network-diagnosis discovery failed.');
    (logger.info as unknown as (fields: object, msg: unknown) => void)(
      { event: 'skill.discovery.invalid_message', skillId: 'network-diagnosis' },
      { raw: 'invalid-message-canary' },
    );

    const entries = harness.file.lines.map((line) => JSON.parse(line) as Record<string, unknown>);
    for (const entry of entries.filter((candidate) => String(candidate.event).startsWith('skill.discovery.'))) {
      expect(entry).not.toHaveProperty('msg');
      expect(entry).not.toHaveProperty('message');
    }
    expect(JSON.stringify(entries)).not.toMatch(/private-value|C:\\private|caller-msg|caller-message|invalid-message-canary/u);
    await writer.close(100);
  });

  it('projects safe fingerprints alongside bounded local raw root-cause evidence', async () => {
    const harness = fakeDestinations();
    const writer = await createOperationalLogWriterWithDependencies(
      filePolicy(process.cwd()),
      { serviceVersion: '1.2.3+build.4' },
      harness.dependencies,
    );
    const cause = new Error('cause credential=secret-cause');
    cause.stack = [
      'Error: cause credential=secret-cause',
      '    at loadConfig (file:///D:/private/NextAgent/packages/agent-app/src/create-app.ts:640:9)',
      '    at provider (/opt/vendor/node_modules/provider-sdk/index.js:4:2)',
    ].join('\n');
    const exception = new TypeError('token=secret-top-level');
    exception.stack = [
      'TypeError: token=secret-top-level',
      '    at executeTool (D:\\private\\NextAgent\\packages\\agent-core\\src\\tools\\tool-loop.ts:581:7)',
      '    at runTool (D:\\private\\NextAgent\\packages\\agent-core\\dist\\tool-loop.js:600:8)',
      '    at first (D:\\private\\NextAgent\\packages\\agent-runtime\\src\\submit.ts:10:1)',
      '    at second (D:\\private\\NextAgent\\packages\\agent-runtime\\src\\submit.ts:11:1)',
      '    at third (D:\\private\\NextAgent\\packages\\agent-runtime\\src\\submit.ts:12:1)',
      '    at ignoredSixth (D:\\private\\NextAgent\\packages\\agent-runtime\\src\\submit.ts:13:1)',
      '    at provider (/opt/vendor/node_modules/provider-sdk/index.js:4:2)',
    ].join('\n');
    Object.defineProperty(exception, 'cause', { value: cause });

    const logger = writer.getLogger({ component: 'agent-core' });
    logger.error({
      err: exception,
      event: 'tool.call.exception_captured',
      failureStage: 'CAPABILITY_INVOKE',
      serviceVersion: 'caller',
      exceptionType: 'caller',
      exceptionFingerprint: 'caller',
      exceptionFrames: ['caller'],
    });
    logger.error({ err: exception, event: 'tool.call.exception_captured', failureStage: 'CAPABILITY_INVOKE' });

    const entries = harness.file.lines.map((line) => JSON.parse(line) as Record<string, unknown>);
    const captured = entries.filter((entry) => entry.event === 'tool.call.exception_captured');
    expect(captured).toHaveLength(2);
    expect(captured[0]).toMatchObject({
      serviceVersion: '1.2.3+build.4',
      failureStage: 'CAPABILITY_INVOKE',
      exceptionType: 'TypeError',
      exceptionFingerprint: expect.stringMatching(/^[a-f0-9]{24}$/u),
      exceptionFrames: [
        'executeTool@agent-core#tool-loop.ts:581:7',
        'runTool@agent-core#tool-loop.js:600:8',
        'first@agent-runtime#submit.ts:10:1',
        'second@agent-runtime#submit.ts:11:1',
        'third@agent-runtime#submit.ts:12:1',
      ],
      exceptionCause: expect.objectContaining({
        exceptionType: 'Error',
        exceptionFingerprint: expect.stringMatching(/^[a-f0-9]{24}$/u),
      }),
      exceptionChainTruncated: true,
    });
    expect(captured[1]?.exceptionFingerprint).toBe(captured[0]?.exceptionFingerprint);
    expect(captured[0]).toMatchObject({
      rawExceptionData: {
        message: 'token=<redacted:credential>',
        cause: { message: 'cause credential=<redacted:credential>' },
      },
    });
    expect(JSON.stringify(captured)).toMatch(/D:\\|\/opt\/|provider-sdk|ignoredSixth/u);
    expect(JSON.stringify(captured)).not.toMatch(/secret-top-level|secret-cause|caller/u);
    await writer.close(100);
  });

  it('omits unowned safe frames while retaining bounded local Error and non-Error values', async () => {
    const harness = fakeDestinations();
    const writer = await createOperationalLogWriterWithDependencies(filePolicy(process.cwd()), {}, harness.dependencies);
    const external = new Error('provider-body-canary');
    external.name = 'CredentialLeakCanary';
    external.stack = 'Error: provider-body-canary\n    at provider (/opt/vendor/provider-sdk/index.js:4:2)';
    const logger = writer.getLogger({ component: 'agent-model' });

    logger.error({ err: external, event: 'model.invocation.exception_captured', failureStage: 'MODEL_STREAM' });
    logger.error({ err: 'raw-error-canary', event: 'model.invocation.exception_captured', failureStage: 'MODEL_STREAM' });

    const entries = harness.file.lines.map((line) => JSON.parse(line) as Record<string, unknown>);
    expect(entries[1]).toMatchObject({ exceptionType: 'Error', exceptionFingerprint: expect.stringMatching(/^[a-f0-9]{24}$/u) });
    expect(entries[1]).not.toHaveProperty('exceptionFrames');
    expect(entries[2]).toMatchObject({ exceptionType: 'NonErrorThrow' });
    expect(entries[1]).toMatchObject({
      rawExceptionData: {
        name: 'CredentialLeakCanary',
        message: 'provider-body-canary',
        stack: expect.stringContaining('/opt/vendor/provider-sdk/index.js:4:2'),
      },
    });
    expect(entries[2]).toMatchObject({ rawExceptionData: { value: 'raw-error-canary' } });
    await writer.close(100);
  });

  it('centrally classifies failures without duplicating event semantics as fallback reasons', async () => {
    const harness = fakeDestinations();
    const writer = await createOperationalLogWriterWithDependencies(filePolicy(process.cwd()), {}, harness.dependencies);
    const logger = writer.getLogger({ component: 'agent-runtime' });
    const known = new AgentError({
      code: 'CAPABILITY_UNAVAILABLE',
      message: 'provider body must stay private',
      category: 'UNAVAILABLE',
      retryable: true,
    });
    const internal = new AgentError({
      code: 'RUNTIME_INTERNAL',
      message: 'internal body must stay private',
      category: 'INTERNAL',
      retryable: false,
    });
    internal.stack = 'AgentError: internal body\n    at dispatch (D:\\trusted\\NextAgent\\packages\\agent-runtime\\src\\submit.ts:44:2)';
    const plain = new Error('plain body must stay private');
    plain.stack = 'Error: private\n    at runWorker (D:\\trusted\\NextAgent\\packages\\agent-runtime\\src\\worker.ts:12:3)';
    const canceled = Object.assign(new Error('abort body must stay private'), { name: 'AbortError' });
    const addressInUse = Object.assign(new Error('listen path and token must stay private'), { code: 'EADDRINUSE' });
    addressInUse.stack =
      'Error: private\n    at listen (D:\\trusted\\NextAgent\\packages\\agent-app\\src\\composition\\app-lifecycle-composition.ts:160:5)';

    logger.error({ err: known, event: 'model.invocation.exception_captured', failureStage: 'MODEL_STREAM' });
    logger.warn({ err: known, event: 'capability.invocation.failed', failureStage: 'CAPABILITY_INVOKE' });
    logger.error({ err: internal, event: 'runtime.dispatch.failed', failureStage: 'SCHEDULER_DISPATCH' });
    logger.error({ err: plain, event: 'runtime.worker.failed', failureStage: 'WORKER_EXECUTION' });
    logger.warn({ err: canceled, event: 'runtime.dispatch.canceled', failureStage: 'SCHEDULER_DISPATCH' });
    logger.error({ err: { raw: 'non-error body' }, event: 'runtime.dispatch.failed', safeReasonCode: 'DISPATCH_PROTOCOL_INVALID' });
    logger.error(
      { err: addressInUse, event: 'app.server.listen.failed', failureStage: 'SERVER_LISTEN', fallbackReasonCode: 'LEGACY_REASON_MUST_BE_DROPPED' },
      'Server listen failed in tcp mode.',
    );

    const entries = harness.file.lines.map((line) => JSON.parse(line) as Record<string, unknown>);
    expect(entries.filter((entry) => entry.event === 'model.invocation.exception_captured')).toEqual([]);
    expect(entries.find((entry) => entry.event === 'capability.invocation.failed')).toMatchObject({
      safeReasonCode: 'CAPABILITY_UNAVAILABLE',
      safeErrorCategory: 'UNAVAILABLE',
      retryable: true,
    });
    expect(entries.find((entry) => entry.event === 'capability.invocation.failed')).not.toHaveProperty('exceptionFingerprint');
    expect(entries.find((entry) => entry.event === 'runtime.dispatch.failed' && entry.safeReasonCode === 'RUNTIME_INTERNAL')).toMatchObject({
      safeErrorCategory: 'INTERNAL',
      exceptionType: 'AgentError',
      exceptionFingerprint: expect.stringMatching(/^[a-f0-9]{24}$/u),
      exceptionFrames: ['dispatch@agent-runtime#submit.ts:44:2'],
    });
    const plainEntry = entries.find((entry) => entry.event === 'runtime.worker.failed');
    expect(plainEntry).toMatchObject({
      failureStage: 'WORKER_EXECUTION',
      safeErrorCategory: 'INTERNAL',
      exceptionType: 'Error',
      exceptionFingerprint: expect.stringMatching(/^[a-f0-9]{24}$/u),
    });
    expect(plainEntry).toHaveProperty('safeReasonCode', 'UNCLASSIFIED_RUNTIME_ERROR');
    expect(entries.find((entry) => entry.event === 'runtime.dispatch.canceled')).toMatchObject({
      safeErrorCategory: 'CANCELED',
      retryable: false,
    });
    expect(entries.find((entry) => entry.event === 'runtime.dispatch.canceled')).not.toHaveProperty('exceptionFingerprint');
    expect(entries.find((entry) => entry.event === 'runtime.dispatch.canceled')).not.toHaveProperty('safeReasonCode');
    expect(entries.find((entry) => entry.event === 'runtime.dispatch.failed' && entry.exceptionType === 'NonErrorThrow')).toMatchObject({
      safeReasonCode: 'DISPATCH_PROTOCOL_INVALID',
      safeErrorCategory: 'INTERNAL',
      retryable: false,
    });
    expect(entries.find((entry) => entry.event === 'app.server.listen.failed')).toMatchObject({
      safeReasonCode: 'ADDRESS_IN_USE',
      exceptionCode: 'EADDRINUSE',
      exceptionType: 'Error',
      exceptionFrames: ['listen@agent-app#app-lifecycle-composition.ts:160:5'],
    });
    expect(entries.find((entry) => entry.event === 'app.server.listen.failed')).not.toHaveProperty('msg');
    expect(entries.find((entry) => entry.event === 'app.server.listen.failed')).not.toHaveProperty('fallbackReasonCode');
    expect(JSON.stringify(entries)).toMatch(/provider body|internal body|plain body|abort body|non-error body|listen path and token/u);
    expect(JSON.stringify(entries)).not.toContain('LEGACY_REASON_MUST_BE_DROPPED');
    await writer.close(100);
  });

  it('preserves the diagnostic entry when Error metadata accessors fail', async () => {
    const harness = fakeDestinations();
    const writer = await createOperationalLogWriterWithDependencies(filePolicy(process.cwd()), {}, harness.dependencies);
    const exception = new Error('metadata-getter-canary');
    Object.defineProperties(exception, {
      name: {
        get: () => {
          throw new Error('name-getter-canary');
        },
      },
      code: {
        get: () => {
          throw new Error('code-getter-canary');
        },
      },
      stack: {
        get: () => {
          throw new Error('stack-getter-canary');
        },
      },
      cause: {
        get: () => {
          throw new Error('cause-getter-canary');
        },
      },
    });

    expect(() =>
      writer
        .getLogger({ component: 'agent-core' })
        .error({ err: exception, event: 'tool.call.exception_captured', failureStage: 'CAPABILITY_INVOKE' }),
    ).not.toThrow();

    const entries = harness.file.lines.map((line) => JSON.parse(line) as Record<string, unknown>);
    expect(entries[1]).toMatchObject({
      event: 'tool.call.exception_captured',
      failureStage: 'CAPABILITY_INVOKE',
      exceptionType: 'Error',
      exceptionFingerprint: expect.stringMatching(/^[a-f0-9]{24}$/u),
      exceptionChainTruncated: true,
    });
    expect(entries[1]).toMatchObject({ rawExceptionData: { name: 'Error', message: 'metadata-getter-canary' } });
    expect(JSON.stringify(entries)).not.toMatch(/name-getter-canary|code-getter-canary|stack-getter-canary|cause-getter-canary/u);
    await writer.close(100);
  });

  it('bounds nested and cyclic cause chains without exposing messages or non-Error cause values', async () => {
    const harness = fakeDestinations();
    const writer = await createOperationalLogWriterWithDependencies(filePolicy(process.cwd()), {}, harness.dependencies);
    const fifth = new Error('fifth-secret');
    const fourth = new Error('fourth-secret', { cause: fifth });
    const third = new Error('third-secret', { cause: fourth });
    const second = new Error('second-secret', { cause: third });
    const first = new Error('first-secret', { cause: second });
    const cyclic = new Error('cycle-secret');
    Object.defineProperty(cyclic, 'cause', { value: cyclic });
    const nonErrorCause = new Error('non-error-cause-secret', { cause: { token: 'secret-value' } });
    const logger = writer.getLogger({ component: 'agent-runtime' });

    logger.error({ err: first, event: 'request.execution.exception_captured', failureStage: 'REQUEST_EXECUTION' });
    logger.error({ err: cyclic, event: 'request.execution.exception_captured', failureStage: 'REQUEST_EXECUTION' });
    logger.error({ err: nonErrorCause, event: 'request.execution.exception_captured', failureStage: 'REQUEST_EXECUTION' });

    const entries = harness.file.lines.slice(1).map((line) => JSON.parse(line) as Record<string, unknown>);
    const firstEntry = entries[0]!;
    expect(firstEntry).toMatchObject({
      exceptionChainTruncated: true,
      exceptionCause: { exceptionCause: { exceptionCause: { exceptionType: 'Error' } } },
    });
    expect(entries[1]).toMatchObject({ exceptionChainTruncated: true });
    expect(entries[2]).toMatchObject({ exceptionCause: { exceptionType: 'NonErrorThrow' } });
    expect(entries[2]).not.toHaveProperty('exceptionChainTruncated');
    expect(JSON.stringify(entries)).toMatch(/first-secret|second-secret|third-secret|fourth-secret|cycle-secret|non-error-cause-secret/u);
    expect(JSON.stringify(entries)).not.toContain('secret-value');
    await writer.close(100);
  });

  it('bounds stack inspection before fingerprinting an oversized provider exception', async () => {
    const harness = fakeDestinations();
    const writer = await createOperationalLogWriterWithDependencies(filePolicy(process.cwd()), {}, harness.dependencies);
    const exception = new Error('oversized-stack-canary');
    exception.stack = [
      'Error: oversized-stack-canary',
      '    at invoke (D:\\trusted\\NextAgent\\packages\\agent-model\\src\\invoke.ts:12:4)',
      '    at provider (/opt/vendor/provider-sdk/index.js:1:1)'.repeat(100_000),
    ].join('\n');

    writer
      .getLogger({ component: 'agent-model' })
      .error({ err: exception, event: 'model.invocation.exception_captured', failureStage: 'MODEL_STREAM' });

    const entry = JSON.parse(harness.file.lines[1]!) as Record<string, unknown>;
    expect(entry).toMatchObject({
      exceptionFingerprint: expect.stringMatching(/^[a-f0-9]{24}$/u),
      exceptionFrames: ['invoke@agent-model#invoke.ts:12:4'],
    });
    expect(entry).toMatchObject({
      rawExceptionData: {
        message: 'oversized-stack-canary',
        stack: expect.stringContaining('/opt/vendor/provider-sdk/index.js:1:1'),
      },
    });
    expect(String((entry.rawExceptionData as Record<string, unknown>).stack).length).toBeLessThanOrEqual(16 * 1_024);
    await writer.close(100);
  });

  it('bounds fields, depth, cycles, and caller failures without throwing', async () => {
    const harness = fakeDestinations();
    const writer = await createOperationalLogWriterWithDependencies(filePolicy(process.cwd()), {}, harness.dependencies);
    const logger = writer.getLogger({ component: 'agent-core' });
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    const throwing = Object.defineProperty({}, 'unsafe', {
      enumerable: true,
      get: () => {
        throw new Error('forbidden-getter-canary');
      },
    });
    const throwingEvent = Object.defineProperty({}, 'event', {
      enumerable: true,
      get: () => {
        throw new Error('event-getter-canary');
      },
    });
    const partialFailure = Object.defineProperty({ event: 'partial-sanitization.test', err: new Error('caught-canary') }, 'unsafe', {
      enumerable: true,
      get: () => {
        throw new Error('optional-getter-canary');
      },
    });

    expect(() => logger.info({ event: 'bounded.test', cyclic, nested: { a: { b: { c: { d: { e: { f: 'too-deep' } } } } } } })).not.toThrow();
    expect(() => logger.error(throwing)).not.toThrow();
    expect(() => logger.error({ err: new Error('caught-canary'), fields: throwingEvent })).not.toThrow();
    expect(() => logger.error(partialFailure)).not.toThrow();

    expect(harness.file.lines).toHaveLength(3);
    const entry = JSON.parse(harness.file.lines[1]!) as Record<string, unknown>;
    expect(entry).not.toHaveProperty('msg');
    expect(JSON.stringify(entry)).toContain('value_truncated');
    expect(JSON.stringify(harness.file.lines)).not.toContain('forbidden-getter-canary');
    expect(JSON.stringify(harness.file.lines)).not.toContain('event-getter-canary');
    expect(JSON.parse(harness.file.lines[2]!)).toMatchObject({
      event: 'partial-sanitization.test',
      exceptionType: 'Error',
    });
    expect(JSON.parse(harness.file.lines[2]!)).not.toHaveProperty('unsafe');
    expect(JSON.stringify(harness.file.lines)).not.toContain('optional-getter-canary');
    await writer.close(100);
  });

  it('supports disabled output without creating a file', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'nextagent-log-disabled-'));
    const writer = await createOperationalLogWriter(
      filePolicy(directory, {
        console: { enabled: false },
        file: { ...filePolicy(directory).file, enabled: false },
      }),
    );

    expect(() => writer.getLogger({ component: 'agent-app' }).info({ event: 'ignored' })).not.toThrow();
    expect(writer.activeIdentity()).toBeUndefined();
    await writer.close(100);
    expect(readdirSync(directory)).toEqual([]);
  });

  it.each([
    ['console-only', true, false, 1, 0],
    ['file-only', false, true, 0, 1],
    ['both', true, true, 1, 1],
    ['disabled', false, false, 0, 0],
  ] as const)('supports %s with independent fixed-size async destinations', async (_name, consoleEnabled, fileEnabled, consoleLines, fileLines) => {
    const harness = fakeDestinations();
    const policy = filePolicy(process.cwd(), {
      console: { enabled: consoleEnabled },
      file: { ...filePolicy(process.cwd()).file, enabled: fileEnabled },
    });
    const writer = await createOperationalLogWriterWithDependencies(policy, {}, harness.dependencies);

    writer.getLogger({ component: 'agent-app' }).info({ event: 'app.ready' });

    expect(harness.console.lines).toHaveLength(consoleLines + (consoleEnabled ? 1 : 0));
    expect(harness.file.lines).toHaveLength(fileLines + (fileEnabled ? 1 : 0));
    if (consoleEnabled) {
      expect(harness.consoleOptions).toEqual({ dest: 1, sync: false, maxLength: 4 * 1024 * 1024 });
    }
    if (fileEnabled) {
      expect(harness.filePolicy?.bufferCapacityBytes).toBe(4 * 1024 * 1024);
      expect(harness.filePolicy?.maxArchiveFiles).toBe(10);
    }
    await writer.close(100);
  });

  it('isolates a saturated file sink, reports bounded transitions, and never copies its payload', async () => {
    const harness = fakeDestinations([
      { status: 'accepted' },
      { status: 'dropped', reason: 'buffer_full' },
      { status: 'dropped', reason: 'buffer_full' },
      { status: 'accepted' },
    ]);
    const emergency: unknown[] = [];
    const writer = await createOperationalLogWriterWithDependencies(
      filePolicy(process.cwd(), { console: { enabled: true } }),
      {
        emergencyReporter: (evidence) => {
          emergency.push(evidence);
        },
      },
      harness.dependencies,
    );

    const logger = writer.getLogger({ component: 'agent-runtime' });
    const startedAt = performance.now();
    logger.warn({ event: 'runtime.private', payload: 'forbidden-drop-canary' });
    logger.warn({ event: 'runtime.private', payload: 'forbidden-drop-canary' });
    logger.warn({ event: 'runtime.private' });
    expect(performance.now() - startedAt).toBeLessThan(50);
    await new Promise((resolvePromise) => setImmediate(resolvePromise));

    expect(harness.console.lines).toHaveLength(4);
    expect(emergency).toEqual([
      { event: 'logging.transport.overloaded', sink: 'file', droppedCountBucket: '1' },
      { event: 'logging.transport.recovered', sink: 'file', droppedCountBucket: '2' },
    ]);
    expect(JSON.stringify(emergency)).not.toContain('forbidden-drop-canary');
    await writer.close(100);
  });

  it('records bounded archive maintenance failure and recovery milestones without file evidence', async () => {
    const harness = fakeDestinations();
    const writer = await createOperationalLogWriterWithDependencies(filePolicy(process.cwd()), {}, harness.dependencies);

    harness.emitMaintenance({ operation: 'archive', outcome: 'failed', affectedCount: 2 });
    harness.emitMaintenance({ operation: 'archive', outcome: 'failed', affectedCount: 3 });
    harness.emitMaintenance({ operation: 'archive', outcome: 'completed', affectedCount: 1 });

    const entries = harness.file.lines.map((line) => JSON.parse(line) as Record<string, unknown>);
    expect(entries.filter((entry) => entry.event === 'logging.archive.failed')).toEqual([
      expect.objectContaining({ level: 'warn', affectedCountBucket: '2', safeReasonCode: 'LOG_MAINTENANCE_FAILED' }),
    ]);
    expect(entries.filter((entry) => entry.event === 'logging.archive.completed')).toEqual([
      expect.objectContaining({ level: 'debug', affectedCountBucket: '1' }),
    ]);
    expect(JSON.stringify(entries)).not.toMatch(/[A-Za-z]:\\|\/tmp\/|source-canary|archive-name-canary/iu);
    await writer.close(100);
  });

  it('bounds slow console flush and close without waiting for destination callbacks', async () => {
    vi.useFakeTimers();
    try {
      const harness = fakeDestinations();
      const emergency: unknown[] = [];
      vi.spyOn(harness.console, 'flush').mockImplementation(() => {});
      vi.spyOn(harness.console, 'end').mockImplementation(() => {});
      const writer = await createOperationalLogWriterWithDependencies(
        filePolicy(process.cwd(), {
          console: { enabled: true },
          file: { ...filePolicy(process.cwd()).file, enabled: false },
        }),
        {
          emergencyReporter: (evidence) => {
            emergency.push(evidence);
          },
        },
        harness.dependencies,
      );

      const flushing = writer.flush(25);
      await vi.advanceTimersByTimeAsync(25);
      await expect(flushing).resolves.toBeUndefined();
      const closing = writer.close(25);
      await vi.advanceTimersByTimeAsync(25);
      await expect(closing).resolves.toBeUndefined();
      await vi.runAllTicks();
      expect(emergency).toEqual([
        { event: 'logging.flush.failed', sink: 'console' },
        { event: 'logging.close.failed', sink: 'console' },
      ]);
    } finally {
      vi.useRealTimers();
    }
  });
});

function filePolicy(directory: string, overrides: Partial<OperationalRuntimeLoggingPolicy> = {}): OperationalRuntimeLoggingPolicy {
  return {
    level: 'debug',
    console: { enabled: false },
    file: {
      enabled: true,
      directory,
      name: 'nextagent-operational.log.jsonl',
      maxFileSizeMiB: 1,
      retentionDays: 7,
      maxArchiveFiles: 10,
    },
    ...overrides,
  };
}

class FakeConsoleDestination extends EventEmitter implements ConsoleDestination {
  readonly lines: string[] = [];

  write(line: string): boolean {
    this.lines.push(line);
    return true;
  }

  flush(callback: (error?: Error) => void): void {
    callback();
  }

  end(): void {
    this.emit('close');
  }
}

function fakeDestinations(results: LocalFileAppendResult[] = []): {
  readonly dependencies: OperationalWriterDependencies;
  readonly console: FakeConsoleDestination;
  readonly file: { readonly lines: string[] };
  readonly consoleOptions?: { readonly dest: 1; readonly sync: false; readonly maxLength: number };
  readonly filePolicy?: LocalFileRollPolicy;
  emitMaintenance: (event: LocalFileMaintenanceEvent) => void;
} {
  const console = new FakeConsoleDestination();
  const file = { lines: [] as string[] };
  const state: {
    consoleOptions?: { readonly dest: 1; readonly sync: false; readonly maxLength: number };
    filePolicy?: LocalFileRollPolicy;
    maintenanceListener?: Parameters<LocalFileRollHandle['setMaintenanceEventListener']>[0];
  } = {};
  const fileHandle: LocalFileRollHandle = {
    appendLine(line) {
      file.lines.push(line);
      return results.shift() ?? { status: 'accepted' };
    },
    activeIdentity: () => ({ file: 'C:\\trusted\\nextagent-operational.log.1.jsonl' }),
    setMaintenanceEventListener(listener) {
      state.maintenanceListener = listener;
    },
    async flush() {},
    async close() {},
  };
  const dependencies: OperationalWriterDependencies = {
    createFileRoll: async (policy) => {
      state.filePolicy = policy;
      return fileHandle;
    },
    createConsoleDestination: (options) => {
      state.consoleOptions = options;
      return console;
    },
  };
  const harness = {
    dependencies,
    console,
    file,
    emitMaintenance: (event: LocalFileMaintenanceEvent) => state.maintenanceListener?.(event),
  };
  return Object.defineProperties(harness, {
    consoleOptions: { get: () => state.consoleOptions },
    filePolicy: { get: () => state.filePolicy },
  }) as typeof harness & {
    readonly consoleOptions?: { readonly dest: 1; readonly sync: false; readonly maxLength: number };
    readonly filePolicy?: LocalFileRollPolicy;
  };
}
