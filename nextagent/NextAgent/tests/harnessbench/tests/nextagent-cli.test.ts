import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, symlink, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { stageLocalRuntimePackage } from '@nextagent/agent-app/local-runtime-package';
import { describe, expect, it } from 'vitest';
import {
  executeHarnessTask,
  harnessCandidateKey,
  loadHarnessSessionState,
  registerProxyRoute,
  terminalReasonCode,
  waitForTerminal,
} from '../nextagent-cli.mjs';
import { copyRegularTree, parseTerminalSse, replaceRegularTree, resolveContainedPath } from '../workspace-bridge.mjs';

describe('HarnessBench NextAgent workspace bridge', () => {
  it('copies regular files in both directions without allowing path escape', async () => {
    const source = await mkdtemp(join(tmpdir(), 'nextagent-harness-source-'));
    const target = await mkdtemp(join(tmpdir(), 'nextagent-harness-target-'));
    await mkdir(join(source, 'in'), { recursive: true });
    await writeFile(join(source, 'in', 'input.txt'), 'hello', 'utf8');

    await copyRegularTree(source, target);
    expect(await readFile(join(target, 'in', 'input.txt'), 'utf8')).toBe('hello');
    expect(() => resolveContainedPath(source, '../escape.txt')).toThrow(/escapes/u);
    expect(() => resolveContainedPath(source, join(source, 'absolute.txt'))).toThrow(/relative/u);
  });

  it('rejects symbolic links or junctions instead of following them', async () => {
    const source = await mkdtemp(join(tmpdir(), 'nextagent-harness-link-'));
    const target = await mkdtemp(join(tmpdir(), 'nextagent-harness-link-target-'));
    await writeFile(join(source, 'real.txt'), 'secret', 'utf8');
    try {
      await symlink(join(source, 'real.txt'), join(source, 'linked.txt'), 'file');
    } catch {
      return;
    }
    await expect(copyRegularTree(source, target)).rejects.toThrow(/symbolic link|junction/u);
  });

  it('mirrors the final execution tree so deleted files do not survive in the HarnessBench workspace', async () => {
    const source = await mkdtemp(join(tmpdir(), 'nextagent-harness-final-'));
    const target = await mkdtemp(join(tmpdir(), 'nextagent-harness-existing-'));
    await writeFile(join(source, 'answer.txt'), 'final', 'utf8');
    await writeFile(join(target, 'deleted-by-agent.txt'), 'stale', 'utf8');

    await replaceRegularTree(source, target);

    expect(await readFile(join(target, 'answer.txt'), 'utf8')).toBe('final');
    await expect(readFile(join(target, 'deleted-by-agent.txt'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(replaceRegularTree(source, join(source, 'nested'))).rejects.toThrow(/must not overlap/u);
  });

  it('recognizes successful and failed terminal SSE events', () => {
    expect(parseTerminalSse('event: RUN_COMPLETED\ndata: {"status":"COMPLETED"}\n\n')).toEqual({ status: 'completed' });
    expect(parseTerminalSse('event: RUN_FAILED\ndata: {"payload":{"status":"FAILED","code":"SANDBOX_UNAVAILABLE"}}\n\n')).toEqual({
      status: 'failed',
      reasonCode: 'SANDBOX_UNAVAILABLE',
    });
    expect(parseTerminalSse('event: TEXT_DELTA\ndata: {"delta":"working"}\n\n')).toBeUndefined();
  });

  it('uses closed fallback reason codes for terminal statuses', () => {
    expect(terminalReasonCode('failed')).toBe('TERMINAL_FAILED');
    expect(terminalReasonCode('timed_out')).toBe('TASK_TIMED_OUT');
    expect(terminalReasonCode('canceled')).toBe('REQUEST_CANCELED');
    expect(terminalReasonCode('invalid')).toBe('UNKNOWN');
  });

  it('registers the trusted provider route when the proxy directory is not created yet', async () => {
    const root = await mkdtemp(join(tmpdir(), 'nextagent-harness-routes-'));
    const routePath = join(root, 'nested', 'routes.json');
    await registerProxyRoute(routePath, 'https://provider.example/v1');
    expect(JSON.parse(await readFile(routePath, 'utf8'))).toMatchObject({
      '/nextagent/model': { upstream: 'https://provider.example/v1', framework: 'nextagent' },
    });
  });

  it('cancels the accepted request when terminal streaming exceeds the task timeout', async () => {
    let cancelCount = 0;
    const server = createServer((request, response) => {
      if (request.method === 'POST' && request.url?.endsWith('/cancel') === true) {
        cancelCount += 1;
        response.writeHead(200).end();
        return;
      }
      response.writeHead(200, { 'content-type': 'text/event-stream' });
      response.write('event: TEXT_DELTA\ndata: {"delta":"working"}\n\n');
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (typeof address !== 'object' || address === null) {
      throw new Error('No bridge server address.');
    }
    try {
      await expect(waitForTerminal(`http://127.0.0.1:${address.port}`, 'session-1', { runId: 'run-1', requestId: 'request-1' }, 50)).resolves.toEqual(
        { status: 'timed_out' },
      );
      expect(cancelCount).toBe(1);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it('resumes a non-terminal idle-close stream from the highest accepted sequence', async () => {
    const streamUrls: string[] = [];
    const server = createServer((request, response) => {
      streamUrls.push(request.url ?? '');
      response.writeHead(200, { 'content-type': 'text/event-stream' });
      if (streamUrls.length === 1) {
        response.end('event: TEXT_DELTA\ndata: {"sequence":7,"delta":"working"}\n\n');
        return;
      }
      response.end('event: RUN_COMPLETED\ndata: {"sequence":8,"status":"COMPLETED"}\n\n');
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (typeof address !== 'object' || address === null) {
      throw new Error('No stream server address.');
    }
    try {
      await expect(
        waitForTerminal(`http://127.0.0.1:${address.port}`, 'session-1', { runId: 'run-1', requestId: 'request-1' }, 1_000),
      ).resolves.toEqual({ status: 'completed' });
      expect(streamUrls).toHaveLength(2);
      expect(streamUrls[0]).toContain('lastSeenSequence=0');
      expect(streamUrls[1]).toContain('lastSeenSequence=7');
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it('classifies a non-success stream response without retaining its body', async () => {
    const server = createServer((_request, response) => {
      response.writeHead(503, { 'content-type': 'text/plain' });
      response.end('private upstream response');
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (typeof address !== 'object' || address === null) {
      throw new Error('No stream server address.');
    }
    try {
      await expect(
        waitForTerminal(`http://127.0.0.1:${address.port}`, 'session-1', { runId: 'run-1', requestId: 'request-1' }, 1_000),
      ).rejects.toMatchObject({ failurePhase: 'stream_wait', failureReasonCode: 'STREAM_HTTP_FAILED' });
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it('classifies a successful stream that closes before a terminal event', async () => {
    const server = createServer((_request, response) => {
      response.writeHead(200, { 'content-type': 'text/event-stream' });
      response.end('event: TEXT_DELTA\ndata: {"delta":"working"}\n\n');
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (typeof address !== 'object' || address === null) {
      throw new Error('No stream server address.');
    }
    try {
      await expect(
        waitForTerminal(`http://127.0.0.1:${address.port}`, 'session-1', { runId: 'run-1', requestId: 'request-1' }, 1_000),
      ).rejects.toMatchObject({ failurePhase: 'stream_wait', failureReasonCode: 'STREAM_CLOSED_WITHOUT_TERMINAL' });
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it('classifies a stream transport failure without retaining the exception', async () => {
    const server = createServer((_request, response) => {
      response.writeHead(200, { 'content-type': 'text/event-stream' });
      response.flushHeaders();
      response.socket?.destroy();
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (typeof address !== 'object' || address === null) {
      throw new Error('No stream server address.');
    }
    try {
      const failure = waitForTerminal(`http://127.0.0.1:${address.port}`, 'session-1', { runId: 'run-1', requestId: 'request-1' }, 1_000);
      await expect(failure).rejects.toMatchObject({ failurePhase: 'stream_wait', failureReasonCode: 'STREAM_TRANSPORT_FAILED' });
      await expect(failure).rejects.not.toHaveProperty('cause');
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it('derives collision-resistant candidate keys from the complete upstream session id', () => {
    expect(harnessCandidateKey('session/a')).not.toBe(harnessCandidateKey('session\\a'));
    expect(harnessCandidateKey('session/a')).toBe(harnessCandidateKey('session/a'));
    expect(harnessCandidateKey('session/a')).toMatch(/^session-a-[a-f0-9]{16}$/u);
  });

  it.each([
    ['malformed JSON', '{'],
    ['unknown schema version', JSON.stringify({ schemaVersion: 2, upstreamSessionHash: '0'.repeat(64), nextAgentSessionId: 'session-1' })],
    ['upstream hash mismatch', JSON.stringify({ schemaVersion: 1, upstreamSessionHash: '0'.repeat(64), nextAgentSessionId: 'session-1' })],
    [
      'unsafe NextAgent session id',
      JSON.stringify({ schemaVersion: 1, upstreamSessionHash: sessionHash('session-1'), nextAgentSessionId: '../other-session' }),
    ],
    [
      'Windows-reserved session id',
      JSON.stringify({ schemaVersion: 1, upstreamSessionHash: sessionHash('session-1'), nextAgentSessionId: 'session:other' }),
    ],
  ])('rejects %s in persisted HarnessBench session state', async (_caseName, content) => {
    const candidateRoot = await mkdtemp(join(tmpdir(), 'nextagent-harness-invalid-state-'));
    await writeFile(join(candidateRoot, '.harnessbench-session.json'), content, 'utf8');

    await expect(loadHarnessSessionState(candidateRoot, 'session-1')).rejects.toMatchObject({
      failurePhase: 'candidate_prepare',
      failureReasonCode: 'SESSION_STATE_INVALID',
    });
  });

  it('reuses one persisted NextAgent session across HarnessBench rounds and isolates another upstream session', async () => {
    const fixture = await createCandidateFixture('nextagent-harness-multiround-');
    const prompts: string[] = [];
    let requestCount = 0;
    const server = createServer(async (request, response) => {
      let body = '';
      for await (const chunk of request) {
        body += chunk.toString();
      }
      requestCount += 1;
      prompts.push(body);
      response.writeHead(200, { 'content-type': 'text/event-stream' });
      response.end(
        sse([
          {
            id: `response-${requestCount}`,
            model: 'deterministic-model',
            choices: [{ index: 0, delta: { content: requestCount === 1 ? 'Remembered alpha.' : 'Recalled alpha.' }, finish_reason: 'stop' }],
            usage: { prompt_tokens: 10, completion_tokens: 2, total_tokens: 12 },
          },
          '[DONE]',
        ]),
      );
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (typeof address !== 'object' || address === null) {
      throw new Error('No model server address.');
    }
    try {
      await writeFile(fixture.promptFile, 'Remember the marker alpha for the next round.', 'utf8');
      const first = await executeHarnessTask(candidateOptions(fixture, address.port, 'session-1'));
      await writeFile(fixture.promptFile, 'What marker did I ask you to remember?', 'utf8');
      const second = await executeHarnessTask(candidateOptions(fixture, address.port, 'session-1'));
      const isolated = await executeHarnessTask(candidateOptions(fixture, address.port, 'session-2'));

      expect(second.sessionId).toBe(first.sessionId);
      expect(isolated.sessionId).not.toBe(first.sessionId);
      expect(prompts[1]).toContain('Remember the marker alpha for the next round.');
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  }, 30_000);

  it('executes a deterministic model tool call through the real local runtime HTTP/SSE path', async () => {
    const root = await mkdtemp(join(tmpdir(), 'nextagent-harness-product-path-'));
    const template = join(root, 'template');
    const workspace = join(root, 'workspace');
    const runRoot = join(root, 'run');
    const routesFile = join(root, 'proxy', 'routes.json');
    await mkdir(join(root, 'proxy'), { recursive: true });
    await mkdir(join(workspace, 'in'), { recursive: true });
    await writeFile(join(workspace, 'in', 'input.txt'), 'input', 'utf8');
    const promptFile = join(root, 'prompt.txt');
    await writeFile(promptFile, 'Create workspace/out/answer.txt with the exact text verified.', 'utf8');
    stageLocalRuntimePackage({
      packageRoot: template,
      candidateId: 'harnessbench-product-path',
      version: '1.0.0',
      buildTime: '2026-08-04T00:00:00.000Z',
      packageProfile: 'backend-only',
      configSampleContent: JSON.stringify(minimalConfig()),
    });
    const packagedDefaultAgentRoot = join(template, 'agents', 'default-agent');
    await mkdir(packagedDefaultAgentRoot, { recursive: true });
    await writeFile(
      join(packagedDefaultAgentRoot, 'agent.yaml'),
      JSON.stringify({
        agentId: 'default-agent',
        agentVersion: 'v1',
        displayName: 'Packaged default agent',
        description: 'Must not leak into the isolated HarnessBench candidate.',
        capabilityBindings: [],
        runtimeSettings: { defaultLanguage: 'en-US', maxTurns: 1, maxToolCallsPerTurn: 30, requestTimeoutMs: 1_000 },
        resources: [],
      }),
      'utf8',
    );
    let requestCount = 0;
    const server = createServer(async (request, response) => {
      requestCount += 1;
      for await (const _chunk of request) {
        /* drain request */
      }
      response.writeHead(200, { 'content-type': 'text/event-stream' });
      if (requestCount === 1) {
        response.end(
          sse([
            {
              id: 'tool-response',
              model: 'deterministic-model',
              choices: [
                {
                  index: 0,
                  delta: {
                    tool_calls: [
                      {
                        index: 0,
                        id: 'write-1',
                        type: 'function',
                        function: { name: 'Write', arguments: '{"file_path":"workspace/out/answer.txt","content":"verified"}' },
                      },
                    ],
                  },
                  finish_reason: 'tool_calls',
                },
              ],
              usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
            },
            '[DONE]',
          ]),
        );
      } else {
        response.end(
          sse([
            {
              id: 'final-response',
              model: 'deterministic-model',
              choices: [{ index: 0, delta: { content: 'Done.' }, finish_reason: 'stop' }],
              usage: { prompt_tokens: 10, completion_tokens: 2, total_tokens: 12 },
            },
            '[DONE]',
          ]),
        );
      }
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (typeof address !== 'object' || address === null) {
      throw new Error('No model server address.');
    }
    try {
      await expect(
        executeHarnessTask({
          candidateTemplate: template,
          runRoot,
          workspace,
          promptFile,
          sessionId: 'session-1',
          modelId: 'deterministic-model',
          proxyUrl: `http://127.0.0.1:${address.port}`,
          routesFile,
          providerBaseUrl: 'https://provider.invalid/v1',
          credential: 'test-only',
          timeoutMs: 15_000,
        }),
      ).resolves.toMatchObject({ terminalStatus: 'completed' });
      expect(await readFile(join(workspace, 'out', 'answer.txt'), 'utf8')).toBe('verified');
      expect(requestCount).toBeGreaterThanOrEqual(2);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  }, 30_000);
});

function minimalConfig() {
  return {
    deployment: { mode: 'LOCAL' },
    paths: { workspaceRoot: 'workspaces' },
    auth: { mode: 'local', localIdentity: { tenantId: 'tenant', subjectId: 'subject', displayName: 'test' } },
    channel: { transport: 'fastify', host: '127.0.0.1', port: 3000 },
    hostedAgent: { activeAgentId: 'harnessbench-agent' },
    modelProfiles: [
      {
        providerId: 'openai-compatible',
        baseUrl: 'https://provider.invalid/v1',
        credentialRef: 'env:OPENAI_API_KEY',
        models: [{ modelId: 'model', contextWindowTokens: 128000, fallbackEligible: false }],
      },
    ],
    gateway: {
      gateways: [
        { gatewayId: 'local-working-memory', gatewayKind: 'working-memory', deploymentMode: 'LOCAL' },
        { gatewayId: 'local-long-term-memory', gatewayKind: 'long-term-memory', deploymentMode: 'LOCAL' },
        { gatewayId: 'local-sqlite', gatewayKind: 'sqlite', deploymentMode: 'LOCAL', sqliteFileRef: 'paths.sqliteFile' },
        { gatewayId: 'local-rag', gatewayKind: 'rag-knowledge', deploymentMode: 'LOCAL' },
      ],
    },
    noopBoundaries: { lifecycleHook: 'noop', checkpoint: 'noop', audit: 'noop' },
  };
}

async function createCandidateFixture(prefix: string) {
  const root = await mkdtemp(join(tmpdir(), prefix));
  const template = join(root, 'template');
  const workspace = join(root, 'workspace');
  const runRoot = join(root, 'run');
  const routesFile = join(root, 'proxy', 'routes.json');
  const promptFile = join(root, 'prompt.txt');
  await mkdir(join(root, 'proxy'), { recursive: true });
  await mkdir(workspace, { recursive: true });
  stageLocalRuntimePackage({
    packageRoot: template,
    candidateId: 'harnessbench-multiround',
    version: '1.0.0',
    buildTime: '2026-08-04T00:00:00.000Z',
    packageProfile: 'backend-only',
    configSampleContent: JSON.stringify(minimalConfig()),
  });
  return { template, workspace, runRoot, routesFile, promptFile };
}

function candidateOptions(fixture: Awaited<ReturnType<typeof createCandidateFixture>>, proxyPort: number, sessionId: string) {
  return {
    candidateTemplate: fixture.template,
    runRoot: fixture.runRoot,
    workspace: fixture.workspace,
    promptFile: fixture.promptFile,
    sessionId,
    modelId: 'deterministic-model',
    proxyUrl: `http://127.0.0.1:${proxyPort}`,
    routesFile: fixture.routesFile,
    providerBaseUrl: 'https://provider.invalid/v1',
    credential: 'test-only',
    timeoutMs: 15_000,
  };
}

function sse(events: ReadonlyArray<Record<string, unknown> | string>) {
  return events.map((event) => `data: ${typeof event === 'string' ? event : JSON.stringify(event)}\n\n`).join('');
}

function sessionHash(value: string) {
  return createHash('sha256').update(value).digest('hex');
}
