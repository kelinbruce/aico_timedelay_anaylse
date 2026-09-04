import { cp, readFile, writeFile } from 'node:fs/promises';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { createServer as createTcpServer } from 'node:net';
import path from 'node:path';

import { expect } from 'vitest';

import type { SystemIntegrationCaseId } from '../case-manifest.js';
import { writePassingCaseEvidence } from './case-evidence.js';
import { runExternalConsumerScript } from './external-consumer-process.js';
import { externalNextAgentArtifactsRoot, hashDirectoryTree } from './external-consumer-root.js';
import { requiredCandidateRoot } from './candidate-harness.js';
import { withRunScope } from './run-scope.js';

const supported = new Set<SystemIntegrationCaseId>(['TC-SI-115', 'TC-SI-116', 'TC-SI-118']);

export async function runRemoteRuntimeCase(caseId: SystemIntegrationCaseId): Promise<void> {
  if (!supported.has(caseId)) {
    throw new Error(`unsupported-remote-runtime-case-${caseId}`);
  }
  const candidateRoot = requiredCandidateRoot();
  const externalPackagesRoot = requiredExternalPackagesRoot();
  const candidateHash = await hashDirectoryTree(candidateRoot);
  const artifactsRoot = externalNextAgentArtifactsRoot(externalPackagesRoot);
  const externalHash = await hashDirectoryTree(artifactsRoot);

  await withRunScope({ outputBase: process.env.TESTCLAW_SYSTEM_INTEGRATION_OUTPUT_ROOT }, async (scope) => {
    const isolatedCandidate = path.join(scope.tempRoot, 'remote-candidate');
    await cp(candidateRoot, isolatedCandidate, { recursive: true });
    const runtimePort = await findAvailablePort();
    const observations = { modelCalls: 0, ragCalls: 0, sandboxCalls: 0, canceledRemoteCalls: 0, activeCancel: false };
    const modelServer = createServer((request, response) => {
      void handleModel(caseId, request, response, observations);
    });
    const gatewayServer = createServer((request, response) => {
      void handleGateway(request, response, observations);
    });
    const modelPort = await scope.listenOnRandomPort(modelServer);
    const gatewayPort = await scope.listenOnRandomPort(gatewayServer);
    await configureRemoteCandidate(isolatedCandidate, scope.tempRoot, runtimePort, modelPort, caseId);

    const source = await readFile(new URL('../e2e/backend/fixtures/TC-SI-115-118-consumer.mjs', import.meta.url), 'utf8');
    const execution = await runExternalConsumerScript({
      externalPackagesRoot,
      tempBase: scope.tempRoot,
      source,
      environment: {
        NEXTAGENT_REMOTE_SANDBOX_ENDPOINT: `http://127.0.0.1:${gatewayPort}/sandbox`,
        NEXTAGENT_REMOTE_RAG_RETRIEVAL_ENDPOINT: `http://127.0.0.1:${gatewayPort}/rag`,
        NEXTAGENT_CONFIG_DIR: path.join(isolatedCandidate, 'config'),
        OPENAI_API_KEY: 'testclaw-loopback-key',
        TESTCLAW_CANDIDATE_ROOT: isolatedCandidate,
        TESTCLAW_CASE_ID: caseId,
        TESTCLAW_MODEL_CONTROL_URL: `http://127.0.0.1:${modelPort}/control`,
        TESTCLAW_RUNTIME_BASE_URL: `http://127.0.0.1:${runtimePort}`,
      },
      registerChild: scope.registerChild,
    });
    expect(execution.code, safeConsumerFailure(execution.stdout, execution.stderr)).toBe(0);
    expect(execution.stderr).not.toContain('REMOTE_RAW_CANARY');
    expect(execution.stderr).not.toContain(candidateRoot);
    if (execution.stderr.length > 0) {
      expect(execution.stderr).toMatch(/^AI SDK Warning: System messages in the prompt or messages fields/iu);
    }
    const result = JSON.parse(execution.stdout) as Record<string, unknown>;
    expect(result.caseId).toBe(caseId);
    expect(result.passed).toBe(true);
    expect(observations.modelCalls).toBeGreaterThan(0);
    if (caseId === 'TC-SI-116') {
      expect(observations.ragCalls).toBe(1);
      expect(observations.sandboxCalls).toBe(1);
    }
    if (caseId === 'TC-SI-118') {
      expect(observations.canceledRemoteCalls).toBeGreaterThanOrEqual(1);
    }

    await writePassingCaseEvidence({
      evidenceRoot: scope.evidenceRoot,
      caseId,
      observations: {
        candidateRemoteProcessStarted: true,
        httpAndSseObserved: true,
        uniqueSafeTerminalObserved: true,
        historyConsistent: true,
        ...(caseId === 'TC-SI-116' ? { remoteRagObserved: true, remoteSandboxObserved: true } : {}),
        ...(caseId === 'TC-SI-118' ? { invalidFailureTimeoutCancelCovered: true, cancellationPropagated: true } : {}),
      },
      canaries: [
        { category: 'credential', value: 'testclaw-loopback-key' },
        { category: 'remote-exception', value: 'REMOTE_RAW_CANARY' },
        { category: 'absolute-path', value: candidateRoot },
      ],
    });
  });

  expect(await hashDirectoryTree(candidateRoot)).toBe(candidateHash);
  expect(await hashDirectoryTree(artifactsRoot)).toBe(externalHash);
}

async function configureRemoteCandidate(
  candidateRoot: string,
  _tempRoot: string,
  runtimePort: number,
  modelPort: number,
  caseId: SystemIntegrationCaseId,
): Promise<void> {
  const configPath = path.join(candidateRoot, 'config', 'default-system.yaml');
  const config = JSON.parse(await readFile(configPath, 'utf8')) as Record<string, unknown>;
  const deployment = object(config.deployment);
  deployment.mode = 'REMOTE';
  deployment.deploymentEntrypointRefs = { REMOTE: { module: '@nextagent/agent-remote-deployment', exportName: 'startRemoteRuntimePackage' } };
  const channel = object(config.channel);
  channel.host = '127.0.0.1';
  channel.port = runtimePort;
  const paths = object(config.paths);
  paths.workspaceRoot = 'workspaces';
  paths.logDirectory = 'logs';
  const providers = config.modelProfiles as Array<Record<string, unknown>>;
  const provider = providers.find((entry) => entry.providerId === 'openai-compatible');
  if (provider === undefined) {
    throw new Error('remote-openai-compatible-provider-missing');
  }
  provider.baseUrl = `http://127.0.0.1:${modelPort}/v1`;
  provider.credentialRef = 'env:OPENAI_API_KEY';
  const models = provider.models as Array<Record<string, unknown>>;
  if (!Array.isArray(models) || models.length === 0) {
    throw new Error('remote-model-profile-missing');
  }
  models[0].modelId = 'testclaw-remote-model';
  models[0].timeoutMs = caseId === 'TC-SI-118' ? 1_000 : 30_000;
  const gateway = object(config.gateway);
  gateway.gateways = [
    { gatewayId: 'local-working-memory', gatewayKind: 'working-memory', deploymentMode: 'LOCAL' },
    { gatewayId: 'local-long-term-memory', gatewayKind: 'long-term-memory', deploymentMode: 'LOCAL' },
    { gatewayId: 'local-sqlite', gatewayKind: 'sqlite', deploymentMode: 'LOCAL', sqliteFileRef: 'paths.sqliteFile' },
    { gatewayId: 'remote-sandbox', gatewayKind: 'sandbox', deploymentMode: 'REMOTE' },
    { gatewayId: 'remote-rag', gatewayKind: 'rag-knowledge', deploymentMode: 'REMOTE' },
  ];
  await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
}

async function handleModel(
  caseId: SystemIntegrationCaseId,
  request: IncomingMessage,
  response: ServerResponse,
  observations: { modelCalls: number; canceledRemoteCalls: number; activeCancel: boolean },
): Promise<void> {
  if (request.method === 'GET' && request.url === '/control') {
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ activeCancel: observations.activeCancel }));
    return;
  }
  const body = await readJson(request);
  observations.modelCalls += 1;
  const serialized = JSON.stringify(body);
  if (caseId === 'TC-SI-118') {
    if (serialized.includes('remote-invalid')) {
      response.writeHead(200, { 'content-type': 'text/event-stream' });
      response.end('data: {"invalid":true}\n\ndata: [DONE]\n\n');
      return;
    }
    if (serialized.includes('remote-failure')) {
      response.writeHead(503, { 'content-type': 'application/json' });
      response.end('{"error":{"message":"REMOTE_RAW_CANARY"}}');
      return;
    }
    if (serialized.includes('remote-timeout') || serialized.includes('remote-cancel')) {
      if (serialized.includes('remote-cancel')) {
        observations.activeCancel = true;
      }
      let completed = false;
      response.once('close', () => {
        if (!completed && serialized.includes('remote-cancel')) {
          observations.canceledRemoteCalls += 1;
        }
      });
      await delay(2_000);
      if (response.destroyed) {
        return;
      }
      writeModelTurn(response, { content: 'late-remote-output' });
      completed = true;
      return;
    }
  }
  if (caseId === 'TC-SI-116') {
    if (!serialized.includes('remote-rag-call')) {
      writeModelTurn(response, {
        toolCalls: [{ id: 'remote-rag-call', name: 'Rag', arguments: { query: 'RAN handover degradation', indexes: ['ran-kb'], topK: 2 } }],
      });
      return;
    }
    if (!serialized.includes('remote-bash-call')) {
      writeModelTurn(response, { toolCalls: [{ id: 'remote-bash-call', name: 'Bash', arguments: { command: 'echo ran-diagnostic' } }] });
      return;
    }
    writeModelTurn(response, { content: 'remote telecom diagnosis completed' });
    return;
  }
  writeModelTurn(response, { content: 'remote deployment model output' });
}

async function handleGateway(
  request: IncomingMessage,
  response: ServerResponse,
  observations: { ragCalls: number; sandboxCalls: number },
): Promise<void> {
  await readJson(request);
  const pathname = new URL(request.url ?? '/', 'http://loopback.invalid').pathname;
  if (pathname === '/rag') {
    observations.ragCalls += 1;
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(
      JSON.stringify({ status: 'OK', results: [{ content: 'RAN handover threshold evidence', source: 'ran-kb/handover.md', score: 0.94 }] }),
    );
    return;
  }
  if (pathname === '/sandbox') {
    observations.sandboxCalls += 1;
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(
      JSON.stringify({
        executionId: 'remote-sandbox-execution',
        exitCode: 0,
        stdout: 'ran-diagnostic\n',
        stderr: '',
        stdoutTruncated: false,
        stderrTruncated: false,
        timedOut: false,
        durationMs: 2,
      }),
    );
    return;
  }
  response.writeHead(404);
  response.end();
}

function writeModelTurn(
  response: ServerResponse,
  turn: { content?: string; toolCalls?: readonly { id: string; name: string; arguments: unknown }[] },
): void {
  response.writeHead(200, { 'cache-control': 'no-cache', connection: 'close', 'content-type': 'text/event-stream' });
  const base = { id: 'testclaw-remote-response', object: 'chat.completion.chunk', created: 1, model: 'testclaw-remote-model' };
  response.write(
    `data: ${JSON.stringify({ ...base, choices: [{ index: 0, delta: { role: 'assistant', ...(turn.content === undefined ? {} : { content: turn.content }), ...(turn.toolCalls === undefined ? {} : { tool_calls: turn.toolCalls.map((call, index) => ({ index, id: call.id, type: 'function', function: { name: call.name, arguments: JSON.stringify(call.arguments) } })) }) }, finish_reason: null }] })}\n\n`,
  );
  response.write(
    `data: ${JSON.stringify({ ...base, choices: [{ index: 0, delta: {}, finish_reason: turn.toolCalls === undefined ? 'stop' : 'tool_calls' }] })}\n\n`,
  );
  response.end('data: [DONE]\n\n');
}

async function readJson(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const content = Buffer.concat(chunks).toString('utf8');
  try {
    return content.length === 0 ? undefined : JSON.parse(content);
  } catch {
    return undefined;
  }
}

async function findAvailablePort(): Promise<number> {
  const server = createTcpServer();
  const port = await new Promise<number>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (address === null || typeof address === 'string') {
        reject(new Error('remote-runtime-port-unavailable'));
      } else {
        resolve(address.port);
      }
    });
  });
  await new Promise<void>((resolve, reject) => server.close((error) => (error === undefined ? resolve() : reject(error))));
  return port;
}

function requiredExternalPackagesRoot(): string {
  const value = process.env.NEXTAGENT_EXTERNAL_PACKAGES_ROOT;
  if (value === undefined || value.trim().length === 0) {
    throw new Error('external-packages-root-unavailable');
  }
  return path.resolve(value);
}

function safeConsumerFailure(stdout: string, stderr: string): string {
  if (stdout.trim().length > 0) {
    return stdout.trim().slice(0, 200);
  }
  if (stderr.trim().length === 0) {
    return 'remote-consumer-failed';
  }
  return stderr
    .trim()
    .replace(/[A-Za-z]:\\[^\r\n)]+/gu, '<path>')
    .replace(/testclaw-loopback-key/gu, '<credential>')
    .slice(0, 600);
}

function object(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('expected-object');
  }
  return value as Record<string, unknown>;
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
