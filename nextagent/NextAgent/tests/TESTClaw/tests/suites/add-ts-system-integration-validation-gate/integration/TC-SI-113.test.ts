import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { writePassingCaseEvidence } from '../helpers/case-evidence.js';
import { runExternalConsumerScript } from '../helpers/external-consumer-process.js';
import { externalNextAgentArtifactsRoot, hashDirectoryTree } from '../helpers/external-consumer-root.js';
import { withRunScope } from '../helpers/run-scope.js';

interface ObservedRemoteRequest {
  readonly pathname: string;
  readonly mode: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: unknown;
}

describe('TC-SI-113 remote gateways loopback', () => {
  it('validates remote protocols, trusted context, cancellation and safe failures through packed public exports', async () => {
    const externalPackagesRoot = requiredExternalPackagesRoot();
    const artifactsRoot = externalNextAgentArtifactsRoot(externalPackagesRoot);
    const inputHashBefore = await hashDirectoryTree(artifactsRoot);

    await withRunScope(
      {
        outputBase: process.env.TESTCLAW_SYSTEM_INTEGRATION_OUTPUT_ROOT,
      },
      async (scope) => {
        const observed: ObservedRemoteRequest[] = [];
        const server = createServer((request, response) => {
          void handleRemoteRequest(request, response, observed);
        });
        const port = await scope.listenOnRandomPort(server);
        const source = await readFile(new URL('./fixtures/TC-SI-113-consumer.mjs', import.meta.url), 'utf8');
        const execution = await runExternalConsumerScript({
          externalPackagesRoot,
          tempBase: scope.tempRoot,
          source,
          environment: {
            TESTCLAW_LOOPBACK_BASE_URL: `http://127.0.0.1:${port}`,
          },
          registerChild: scope.registerChild,
        });

        if (execution.code !== 0) {
          throw new Error(`external-consumer-failed:${safeFailedStage(execution.stdout)}`);
        }
        expect(execution.stderr).toBe('');
        expect(JSON.parse(execution.stdout)).toEqual({
          cancellationObserved: true,
          questionRecommendationValidated: true,
          ragValidated: true,
          safeFailureMapped: true,
          sandboxValidated: true,
          workflowInputSeparated: true,
          workflowRagValidated: true,
        });

        assertTrustedScopeAndCorrelation(observed);
        assertWorkflowInputSeparation(observed);
        assertFailureAndCancellationRequests(observed);

        await writePassingCaseEvidence({
          evidenceRoot: scope.evidenceRoot,
          caseId: 'TC-SI-113',
          observations: {
            cancellationPropagated: true,
            invalidSchemaRejected: true,
            loopbackProtocolsReached: 5,
            safeFailureMapped: true,
            trustedScopeAndCorrelationPropagated: true,
            workflowInputSeparated: true,
          },
          canaries: [{ value: 'remote-canary', category: 'remote-exception' }],
        });
      },
    );

    expect(await hashDirectoryTree(artifactsRoot)).toBe(inputHashBefore);
  }, 60_000);
});

async function handleRemoteRequest(request: IncomingMessage, response: ServerResponse, observed: ObservedRemoteRequest[]): Promise<void> {
  try {
    const parsedUrl = new URL(request.url ?? '/', 'http://loopback.invalid');
    const body = await readRequestJson(request);
    const mode = parsedUrl.searchParams.get('mode') ?? 'normal';
    observed.push({
      pathname: parsedUrl.pathname,
      mode,
      headers: selectedHeaders(request),
      body,
    });

    if (parsedUrl.pathname === '/sandbox') {
      respondSandbox(response, mode, body);
      return;
    }
    if (parsedUrl.pathname === '/rag') {
      respondRag(response, mode);
      return;
    }
    if (parsedUrl.pathname === '/workflow-rag') {
      respondWorkflowRag(response, mode);
      return;
    }
    if (parsedUrl.pathname === '/questions/frequent') {
      await respondQuestion(response, mode, { questions: [{ value: 'recent alarm', count: 3 }] });
      return;
    }
    if (parsedUrl.pathname === '/questions/similar') {
      await respondQuestion(response, mode, { data: [{ questionId: 'preset-1', content: 'inspect radio cells' }] });
      return;
    }
    if (parsedUrl.pathname.endsWith('/workflow/execute')) {
      await respondWorkflow(response, parsedUrl.pathname);
      return;
    }
    respondText(response, 404, 'not-found');
  } catch {
    respondText(response, 500, 'loopback-handler-failed');
  }
}

function respondSandbox(response: ServerResponse, mode: string, body: unknown): void {
  if (mode === 'invalid-json') {
    respondText(response, 200, '{');
    return;
  }
  if (mode === 'http-failure') {
    respondText(response, 503, 'remote-canary');
    return;
  }
  const executionId = isRecord(body) && typeof body.executionId === 'string' ? body.executionId : 'sandbox-loopback';
  const result: Record<string, unknown> = {
    executionId,
    exitCode: 0,
    stdout: 'sandbox-ok',
    stderr: '',
    stdoutTruncated: false,
    stderrTruncated: false,
    timedOut: false,
    durationMs: 1,
  };
  if (mode === 'extra') {
    result.adapterPrivate = 'remote-canary';
  }
  if (mode === 'missing') {
    delete result.durationMs;
  }
  respondJson(response, 200, result);
}

function respondRag(response: ServerResponse, mode: string): void {
  const result: Record<string, unknown> = {
    status: 'OK',
    results: [{ content: 'radio diagnosis', source: 'knowledge/radio.md', score: 0.9 }],
  };
  if (mode === 'extra') {
    result.adapterPrivate = 'remote-canary';
  }
  if (mode === 'missing') {
    delete result.results;
  }
  respondJson(response, 200, result);
}

function respondWorkflowRag(response: ServerResponse, mode: string): void {
  const result: Record<string, unknown> = {
    status: 'OK',
    recommends: [{ id: 'radio-doc', title: 'Radio guide', knowledge: 'safe summary' }],
  };
  if (mode === 'extra') {
    result.adapterPrivate = 'remote-canary';
  }
  respondJson(response, 200, result);
}

async function respondQuestion(response: ServerResponse, mode: string, validBody: unknown): Promise<void> {
  if (mode === 'delay') {
    await delay(500);
    if (response.destroyed) {
      return;
    }
  }
  if (mode === 'http-failure') {
    respondText(response, 503, 'remote-canary');
    return;
  }
  respondJson(response, 200, mode === 'invalid' ? { questions: [{ value: 'missing-count' }] } : validBody);
}

async function respondWorkflow(response: ServerResponse, pathname: string): Promise<void> {
  if (pathname.startsWith('/failure/')) {
    respondText(response, 503, 'remote-canary');
    return;
  }
  if (pathname.startsWith('/delay/')) {
    await delay(500);
    if (response.destroyed) {
      return;
    }
  }
  const result = pathname.startsWith('/invalid/')
    ? { executionId: 'execution-loopback', status: 'BROKEN' }
    : {
        executionId: 'execution-loopback',
        status: 'COMPLETED',
        outputVariables: { outcome: 'ok' },
        nodeResults: [],
        startedAt: '2026-07-31T00:00:00.000Z',
        completedAt: '2026-07-31T00:00:01.000Z',
      };
  response.writeHead(200, { 'content-type': 'text/event-stream' });
  if (!pathname.startsWith('/invalid/')) {
    response.write(
      `event: event\ndata: ${JSON.stringify({
        executionId: 'execution-loopback',
        nodeId: 'start',
        nodeType: 'START',
        eventType: 'NODE_STARTED',
        retryCount: 0,
        startedAt: '2026-07-31T00:00:00.000Z',
      })}\n\n`,
    );
  }
  response.end(`event: result\ndata: ${JSON.stringify(result)}\n\n`);
}

function assertTrustedScopeAndCorrelation(observed: readonly ObservedRemoteRequest[]): void {
  const sandbox = findObserved(observed, '/sandbox', 'normal');
  expect(sandbox.body).toMatchObject({ tenantId: 'tenant-loopback', subjectId: 'subject-loopback', requestRunId: 'run-loopback' });

  const rag = findObserved(observed, '/rag', 'normal');
  expect(rag.body).toMatchObject({
    tenantId: 'tenant-loopback',
    subjectId: 'subject-loopback',
    agentId: 'agent-loopback',
    agentVersion: 'v1',
  });

  const workflowRag = findObserved(observed, '/workflow-rag', 'normal');
  expect(workflowRag.headers).toMatchObject({
    traceparent: '00-11111111111111111111111111111111-2222222222222222-01',
    'x-task-event-id': 'task-loopback',
  });
  expect(workflowRag.body).toMatchObject({
    query: 'normal',
    ragIndexes: [{ ragIndex: 'ran-kb', indexType: 'KNOWLEDGE', vsTopN: 2, filters: { region: 'east' } }],
  });
  expect(workflowRag.body).not.toHaveProperty('tenantId');
  expect(workflowRag.body).not.toHaveProperty('indexes');

  const frequent = findObserved(observed, '/questions/frequent', 'normal');
  expect(frequent.headers).toMatchObject({ 'system-language': 'zh-CN' });
  expect(frequent.body).toMatchObject({ tenantId: 'tenant-loopback', userId: 'subject-loopback', agentId: 'agent-loopback' });
}

function assertWorkflowInputSeparation(observed: readonly ObservedRemoteRequest[]): void {
  const workflow = findObserved(observed, '/workflow/execute', 'normal');
  expect(workflow.body).toMatchObject({
    inputText: 'diagnose radio degradation',
    inputVariables: { region: 'east', severity: 2 },
  });
  expect(isRecord(workflow.body) && workflow.body.inputVariables).not.toHaveProperty('inputText');
  expect(isRecord(workflow.body) && workflow.body.inputVariables).not.toHaveProperty('input_question');
}

function assertFailureAndCancellationRequests(observed: readonly ObservedRemoteRequest[]): void {
  expect(observed).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ pathname: '/sandbox', mode: 'extra' }),
      expect.objectContaining({ pathname: '/sandbox', mode: 'missing' }),
      expect.objectContaining({ pathname: '/sandbox', mode: 'invalid-json' }),
      expect.objectContaining({ pathname: '/sandbox', mode: 'http-failure' }),
      expect.objectContaining({ pathname: '/rag', mode: 'extra' }),
      expect.objectContaining({ pathname: '/rag', mode: 'missing' }),
      expect.objectContaining({ pathname: '/questions/similar', mode: 'delay' }),
      expect.objectContaining({ pathname: '/failure/workflow/execute' }),
      expect.objectContaining({ pathname: '/delay/workflow/execute' }),
    ]),
  );
}

async function readRequestJson(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const content = Buffer.concat(chunks).toString('utf8');
  return content.length === 0 ? undefined : (JSON.parse(content) as unknown);
}

function selectedHeaders(request: IncomingMessage): Readonly<Record<string, string>> {
  return Object.freeze(
    Object.fromEntries(
      ['system-language', 'traceparent', 'x-task-event-id']
        .map((name) => [name, request.headers[name]])
        .filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
    ),
  );
}

function respondJson(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { 'content-type': 'application/json' });
  response.end(JSON.stringify(body));
}

function respondText(response: ServerResponse, status: number, body: string): void {
  response.writeHead(status, { 'content-type': 'text/plain' });
  response.end(body);
}

function findObserved(observed: readonly ObservedRemoteRequest[], pathname: string, mode: string): ObservedRemoteRequest {
  const found = observed.find((entry) => entry.pathname === pathname && entry.mode === mode);
  if (found === undefined) {
    throw new Error('expected-loopback-request-missing');
  }
  return found;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function requiredExternalPackagesRoot(): string {
  const value = process.env.NEXTAGENT_EXTERNAL_PACKAGES_ROOT;
  if (value === undefined || value.trim().length === 0) {
    throw new Error('external-packages-root-unavailable');
  }
  return path.resolve(value);
}

function safeFailedStage(stdout: string): string {
  try {
    const parsed = JSON.parse(stdout) as unknown;
    return isRecord(parsed) && typeof parsed.failedStage === 'string' && /^[a-z-]+$/u.test(parsed.failedStage) ? parsed.failedStage : 'unknown';
  } catch {
    return 'unknown';
  }
}
