import { createServer } from 'node:http';
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { preflightGrader, preflightModel, summarizeModelEvidence, summarizeReasoningOnlyOutputLimitEvidence } from '../model-evidence.mjs';

const servers: Array<ReturnType<typeof createServer>> = [];
const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('HarnessBench real model evidence', () => {
  it('preflights an OpenAI-compatible model through the proxy route', async () => {
    const { baseUrl, headers } = await startServer(200, { id: 'chatcmpl-1', choices: [{ message: { role: 'assistant', content: 'ok' } }] });
    await expect(preflightModel({ proxyBaseUrl: baseUrl, credential: 'test-key', modelId: 'model', timeoutMs: 1000 })).resolves.toEqual({ ok: true });
    expect(headers.authorization).toBe('Bearer test-key');
  });

  it('fails closed for authentication errors or an unreachable provider', async () => {
    const { baseUrl } = await startServer(401, { error: { message: 'unauthorized' } });
    await expect(preflightModel({ proxyBaseUrl: baseUrl, credential: 'bad', modelId: 'model', timeoutMs: 1000 })).rejects.toThrow(/401/u);
    await expect(preflightModel({ proxyBaseUrl: 'http://127.0.0.1:1', credential: 'bad', modelId: 'model', timeoutMs: 50 })).rejects.toThrow();
  });

  it('preflights the explicitly configured grader and validates its scoring shape', async () => {
    const { baseUrl, headers } = await startServer(200, {
      choices: [{ message: { content: '{"scores":{"tool_use_appropriate":1,"consistency":1,"robustness":1},"security_gate":1}' } }],
    });
    await expect(preflightGrader({ baseUrl, credential: 'grader-key', modelId: 'grader-model', timeoutMs: 1000 })).resolves.toEqual({ ok: true });
    expect(headers.authorization).toBe('Bearer grader-key');
  });

  it('fails closed when the grader response cannot be parsed as rubric scores', async () => {
    const { baseUrl } = await startServer(200, { choices: [{ message: { content: 'not-json' } }] });
    await expect(preflightGrader({ baseUrl, credential: 'grader-key', modelId: 'grader-model', timeoutMs: 1000 })).rejects.toThrow(/grader.*shape/iu);
  });

  it('fails closed when grader authentication is rejected', async () => {
    const { baseUrl } = await startServer(401, { error: { message: 'unauthorized' } });
    await expect(preflightGrader({ baseUrl, credential: 'bad', modelId: 'grader-model', timeoutMs: 1000 })).rejects.toThrow(/grader.*401/iu);
  });

  it('requires a successful request and nonzero token usage for task evidence', () => {
    expect(summarizeModelEvidence({ available: true, request_count: 2, total_tokens: 10 })).toEqual({
      status: 'verified',
      requestCount: 2,
      totalTokens: 10,
    });
    expect(summarizeModelEvidence({ available: true, request_count: 0, total_tokens: 10 })).toEqual({
      status: 'model_evidence_missing',
      requestCount: 0,
      totalTokens: 10,
    });
    expect(summarizeModelEvidence({ available: false })).toEqual({
      status: 'model_evidence_missing',
      requestCount: 0,
      totalTokens: 0,
    });
  });

  it.each(['absolute', 'relative'] as const)('observes an all-reasoning length response through a safe %s ref', async (refKind) => {
    const fixture = await createUsageProxyFixture();
    await writeFile(fixture.responsePath, JSON.stringify(reasoningOnlyResponse()), 'utf8');
    await writeFile(
      fixture.logPath,
      `${JSON.stringify({ status: 200, raw_response_file: refKind === 'absolute' ? fixture.responsePath : 'responses/0001.json' })}\n`,
      'utf8',
    );

    await expect(summarizeReasoningOnlyOutputLimitEvidence({ runRoot: fixture.runRoot, usageLogFile: fixture.logPath })).resolves.toBe(true);
  });

  it.each([
    ['visible content', reasoningOnlyResponse({ message: { content: 'answer', tool_calls: [] } })],
    ['tool call', reasoningOnlyResponse({ message: { content: '', tool_calls: [{ id: 'call-1' }] } })],
    ['non-length terminal', reasoningOnlyResponse({ finish_reason: 'stop' })],
    ['unequal token detail', reasoningOnlyResponse({}, { completion_tokens: 100, completion_tokens_details: { reasoning_tokens: 99 } })],
    ['missing token detail', reasoningOnlyResponse({}, { completion_tokens: 100, completion_tokens_details: null })],
  ])('does not mislabel %s as reasoning-only exhaustion', async (_label, response) => {
    const fixture = await createUsageProxyFixture();
    await writeFile(fixture.responsePath, JSON.stringify(response), 'utf8');
    await writeFile(fixture.logPath, `${JSON.stringify({ status: 200, raw_response_file: fixture.responsePath })}\n`, 'utf8');

    await expect(summarizeReasoningOnlyOutputLimitEvidence({ runRoot: fixture.runRoot, usageLogFile: fixture.logPath })).resolves.toBe(false);
  });

  it.each([
    ['missing log', async (fixture: UsageFixture) => rm(fixture.logPath, { force: true })],
    ['invalid log JSON', async (fixture: UsageFixture) => writeFile(fixture.logPath, '{invalid', 'utf8')],
    [
      'unfinished request',
      async (fixture: UsageFixture) =>
        writeFile(fixture.logPath, `${JSON.stringify({ status: 0, raw_response_file: fixture.responsePath })}\n`, 'utf8'),
    ],
    ['missing response', async (fixture: UsageFixture) => rm(fixture.responsePath, { force: true })],
    ['invalid response JSON', async (fixture: UsageFixture) => writeFile(fixture.responsePath, '{invalid', 'utf8')],
    [
      'traversal response ref',
      async (fixture: UsageFixture) =>
        writeFile(fixture.logPath, `${JSON.stringify({ status: 200, raw_response_file: '../../outside.json' })}\n`, 'utf8'),
    ],
  ])('fails closed for %s evidence', async (_label, mutate) => {
    const fixture = await createUsageProxyFixture();
    await writeFile(fixture.responsePath, JSON.stringify(reasoningOnlyResponse()), 'utf8');
    await writeFile(fixture.logPath, `${JSON.stringify({ status: 200, raw_response_file: fixture.responsePath })}\n`, 'utf8');
    await mutate(fixture);

    await expect(summarizeReasoningOnlyOutputLimitEvidence({ runRoot: fixture.runRoot, usageLogFile: fixture.logPath })).resolves.toBe(false);
  });

  it('rejects usage logs outside the frozen run root and response symlinks escaping the usage-proxy root', async () => {
    const fixture = await createUsageProxyFixture();
    const outsideRoot = await createTemporaryRoot();
    const outsideLog = join(outsideRoot, 'requests.jsonl');
    const outsideResponse = join(outsideRoot, 'outside.json');
    await writeFile(outsideResponse, JSON.stringify(reasoningOnlyResponse()), 'utf8');
    await writeFile(outsideLog, `${JSON.stringify({ status: 200, raw_response_file: outsideResponse })}\n`, 'utf8');
    await expect(summarizeReasoningOnlyOutputLimitEvidence({ runRoot: fixture.runRoot, usageLogFile: outsideLog })).resolves.toBe(false);

    const linkedResponseRoot = join(dirname(fixture.logPath), 'linked-responses');
    await symlink(outsideRoot, linkedResponseRoot, 'junction');
    await writeFile(fixture.logPath, `${JSON.stringify({ status: 200, raw_response_file: join(linkedResponseRoot, 'outside.json') })}\n`, 'utf8');
    await expect(summarizeReasoningOnlyOutputLimitEvidence({ runRoot: fixture.runRoot, usageLogFile: fixture.logPath })).resolves.toBe(false);
  });

  it('fails closed when the usage log or response exceeds its size limit', async () => {
    const fixture = await createUsageProxyFixture();
    await writeFile(fixture.responsePath, JSON.stringify(reasoningOnlyResponse()), 'utf8');
    await writeFile(fixture.logPath, 'x'.repeat(4 * 1024 * 1024 + 1), 'utf8');
    await expect(summarizeReasoningOnlyOutputLimitEvidence({ runRoot: fixture.runRoot, usageLogFile: fixture.logPath })).resolves.toBe(false);

    await writeFile(fixture.logPath, `${JSON.stringify({ status: 200, raw_response_file: fixture.responsePath })}\n`, 'utf8');
    await writeFile(fixture.responsePath, 'x'.repeat(16 * 1024 * 1024 + 1), 'utf8');
    await expect(summarizeReasoningOnlyOutputLimitEvidence({ runRoot: fixture.runRoot, usageLogFile: fixture.logPath })).resolves.toBe(false);
  });
});

interface UsageFixture {
  runRoot: string;
  logPath: string;
  responsePath: string;
}

async function createTemporaryRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'nextagent-model-evidence-'));
  temporaryRoots.push(root);
  return root;
}

async function createUsageProxyFixture(): Promise<UsageFixture> {
  const runRoot = await createTemporaryRoot();
  const usageRoot = join(runRoot, 'workspace', 'usage-proxy');
  const responseRoot = join(usageRoot, 'responses');
  await mkdir(responseRoot, { recursive: true });
  return {
    runRoot,
    logPath: join(usageRoot, 'requests.jsonl'),
    responsePath: join(responseRoot, '0001.json'),
  };
}

function reasoningOnlyResponse(choiceOverrides: Record<string, unknown> = {}, usageOverrides: Record<string, unknown> = {}) {
  return {
    choices: [
      {
        finish_reason: 'length',
        message: { content: '', tool_calls: [] },
        delta: { content: '', tool_calls: [] },
        ...choiceOverrides,
      },
    ],
    usage: {
      completion_tokens: 100,
      completion_tokens_details: { reasoning_tokens: 100 },
      ...usageOverrides,
    },
  };
}

async function startServer(status: number, payload: unknown) {
  const headers: Record<string, string | undefined> = {};
  const server = createServer((request, response) => {
    headers.authorization = request.headers.authorization;
    response.writeHead(status, { 'content-type': 'application/json' });
    response.end(JSON.stringify(payload));
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (typeof address !== 'object' || address === null) {
    throw new Error('No server address.');
  }
  return { baseUrl: `http://127.0.0.1:${address.port}`, headers };
}
