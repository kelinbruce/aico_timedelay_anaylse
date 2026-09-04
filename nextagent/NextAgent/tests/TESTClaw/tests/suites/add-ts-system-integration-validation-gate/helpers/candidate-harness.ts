import { spawn } from 'node:child_process';
import { createServer, type IncomingHttpHeaders, type IncomingMessage, type ServerResponse } from 'node:http';
import { cp, readFile, writeFile } from 'node:fs/promises';
import { createServer as createTcpServer } from 'node:net';
import path from 'node:path';

import type { SystemIntegrationRunScope } from './run-scope.js';

export interface CandidateHarness {
  readonly baseUrl: string;
  readonly runtimeRoot: string;
  readonly modelInvocationCount: () => number;
  readonly restart: () => Promise<void>;
  readonly stop: () => Promise<void>;
}

export interface CandidateModelTurn {
  readonly content?: string;
  readonly reasoning?: string;
  readonly toolCalls?: readonly {
    readonly toolCallId: string;
    readonly toolName: string;
    readonly arguments: Readonly<Record<string, unknown>>;
  }[];
  readonly failure?: {
    readonly statusCode: number;
    readonly body: string;
  };
  readonly delayMs?: number;
}

export function requiredCandidateRoot(): string {
  const value = process.env.NEXTAGENT_PACKAGE_ROOT;
  if (value === undefined || value.trim().length === 0) {
    throw new Error('candidate-root-unavailable');
  }
  return path.resolve(value);
}

export async function startCandidateHarness(input: {
  readonly scope: SystemIntegrationRunScope;
  readonly candidateRoot: string;
  readonly modelAnswer?: string | ((body: unknown) => string);
  readonly modelTurns?: readonly CandidateModelTurn[];
  readonly selectModelTurn?: (body: unknown, invocationIndex: number) => CandidateModelTurn;
  readonly modelChunks?: readonly {
    readonly content?: string;
    readonly reasoning?: string;
  }[];
  readonly modelFailure?: {
    readonly statusCode: number;
    readonly body: string;
  };
  readonly modelResponseDelayMs?: number;
  readonly inspectModelRequest?: (body: unknown, headers: IncomingHttpHeaders) => void;
  readonly configureRuntime?: (config: Record<string, unknown>) => void;
  readonly environment?: Readonly<Record<string, string>>;
  readonly prepareRuntime?: (runtimeRoot: string) => Promise<void>;
}): Promise<CandidateHarness> {
  const runtimeRoot = path.join(input.scope.tempRoot, 'candidate');
  await cp(path.resolve(input.candidateRoot), runtimeRoot, {
    recursive: true,
    errorOnExist: true,
    force: false,
  });
  await input.prepareRuntime?.(runtimeRoot);

  let modelInvocationCount = 0;
  const modelServer = createServer((request, response) => {
    void handleModelRequest(
      request,
      response,
      input.modelAnswer,
      input.modelTurns,
      input.selectModelTurn,
      input.modelChunks,
      input.modelResponseDelayMs ?? 0,
      input.modelFailure,
      () => modelInvocationCount++,
      input.inspectModelRequest,
    ).catch(() => {
      response.destroy();
    });
  });
  const modelPort = await input.scope.listenOnRandomPort(modelServer);
  const candidatePort = await findAvailablePort();
  await configureRuntimeCopy(runtimeRoot, candidatePort, input.scope.restrictedDiagnosticRoot, input.configureRuntime);

  const baseUrl = `http://127.0.0.1:${candidatePort}`;
  const candidateEnvironment = {
    ...process.env,
    NEXTAGENT_CONFIG_DIR: path.join(runtimeRoot, 'config'),
    OPENAI_API_KEY: 'testclaw-loopback-key',
    OPENAI_BASE_URL: `http://127.0.0.1:${modelPort}/v1`,
    OPENAI_MODEL_NAME: 'testclaw-loopback-model',
    ...input.environment,
  };
  let child = launchCandidate();
  await waitForCandidate(baseUrl, child.process, child.hasSpawnFailed, 60_000);

  async function stop(): Promise<void> {
    if (child.process.exitCode !== null || child.process.signalCode !== null) {
      return;
    }
    const exited = new Promise<void>((resolve) => {
      child.process.once('exit', () => resolve());
    });
    child.process.kill();
    await Promise.race([exited, delay(10_000)]);
  }

  async function restart(): Promise<void> {
    await stop();
    child = launchCandidate();
    await waitForCandidate(baseUrl, child.process, child.hasSpawnFailed, 60_000);
  }

  function launchCandidate(): { readonly process: ReturnType<typeof spawn>; readonly hasSpawnFailed: () => boolean } {
    const candidateProcess = spawn(process.execPath, [path.join(runtimeRoot, 'bin', 'nextagent-start')], {
      cwd: runtimeRoot,
      env: candidateEnvironment,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    let spawnFailed = false;
    candidateProcess.once('error', () => {
      spawnFailed = true;
    });
    input.scope.registerChild(candidateProcess);
    drainProcessOutput(candidateProcess.stdout);
    drainProcessOutput(candidateProcess.stderr);
    return { process: candidateProcess, hasSpawnFailed: () => spawnFailed };
  }

  return Object.freeze({
    baseUrl,
    runtimeRoot,
    modelInvocationCount: () => modelInvocationCount,
    restart,
    stop,
  });
}

async function configureRuntimeCopy(
  runtimeRoot: string,
  port: number,
  restrictedDiagnosticRoot: string,
  configureRuntime: ((config: Record<string, unknown>) => void) | undefined,
): Promise<void> {
  const configPath = path.join(runtimeRoot, 'config', 'default-system.yaml');
  const parsed: unknown = JSON.parse(await readFile(configPath, 'utf8'));
  if (!isObject(parsed) || !isObject(parsed.channel)) {
    throw new Error('candidate-config-channel-invalid');
  }
  parsed.channel.host = '127.0.0.1';
  parsed.channel.port = port;
  if (!isObject(parsed.paths)) {
    throw new Error('candidate-config-paths-invalid');
  }
  parsed.paths.logDirectory = restrictedDiagnosticRoot;
  if (isObject(parsed.observability) && isObject(parsed.observability.logging) && isObject(parsed.observability.logging.file)) {
    parsed.observability.logging.file.directory = restrictedDiagnosticRoot;
  }
  configureRuntime?.(parsed);
  await writeFile(configPath, `${JSON.stringify(parsed, null, 2)}\n`, 'utf8');
}

async function handleModelRequest(
  request: IncomingMessage,
  response: ServerResponse,
  modelAnswer: string | ((body: unknown) => string) | undefined,
  modelTurns: readonly CandidateModelTurn[] | undefined,
  selectModelTurn: ((body: unknown, invocationIndex: number) => CandidateModelTurn) | undefined,
  modelChunks: readonly { readonly content?: string; readonly reasoning?: string }[] | undefined,
  responseDelayMs: number,
  modelFailure: { readonly statusCode: number; readonly body: string } | undefined,
  recordInvocation: () => number,
  inspectRequest?: (body: unknown, headers: IncomingHttpHeaders) => void,
): Promise<void> {
  const requestBody = await consumeRequest(request, inspectRequest, typeof modelAnswer === 'function' || selectModelTurn !== undefined);
  if (request.method !== 'POST' || request.url !== '/v1/chat/completions') {
    response.writeHead(404, { 'content-type': 'application/json' });
    response.end('{"error":{"message":"not-found"}}');
    return;
  }

  const invocationIndex = recordInvocation();
  const turn = selectModelTurn?.(requestBody, invocationIndex) ?? modelTurns?.[Math.min(invocationIndex, modelTurns.length - 1)];
  const effectiveDelayMs = turn?.delayMs ?? responseDelayMs;
  if (effectiveDelayMs > 0) {
    await delay(effectiveDelayMs);
  }
  const effectiveFailure = turn?.failure ?? modelFailure;
  if (effectiveFailure !== undefined) {
    response.writeHead(effectiveFailure.statusCode, {
      connection: 'close',
      'content-type': 'application/json',
    });
    response.end(effectiveFailure.body);
    return;
  }
  response.writeHead(200, {
    'cache-control': 'no-cache',
    connection: 'close',
    'content-type': 'text/event-stream',
  });
  const chunkBase = {
    id: 'testclaw-response',
    object: 'chat.completion.chunk',
    created: 1,
    model: 'testclaw-loopback-model',
  };
  const deltas =
    turn === undefined
      ? (modelChunks ?? [
          {
            content: typeof modelAnswer === 'function' ? modelAnswer(requestBody) : (modelAnswer ?? ''),
          },
        ])
      : [{ content: turn.content, reasoning: turn.reasoning }];
  for (const delta of deltas) {
    response.write(
      `data: ${JSON.stringify({
        ...chunkBase,
        choices: [
          {
            index: 0,
            delta: {
              role: 'assistant',
              ...(delta.content === undefined ? {} : { content: delta.content }),
              ...(delta.reasoning === undefined ? {} : { reasoning_content: delta.reasoning }),
            },
            finish_reason: null,
          },
        ],
      })}\n\n`,
    );
  }
  if (turn?.toolCalls !== undefined) {
    response.write(
      `data: ${JSON.stringify({
        ...chunkBase,
        choices: [
          {
            index: 0,
            delta: {
              role: 'assistant',
              tool_calls: turn.toolCalls.map((toolCall, index) => ({
                index,
                id: toolCall.toolCallId,
                type: 'function',
                function: {
                  name: toolCall.toolName,
                  arguments: JSON.stringify(toolCall.arguments),
                },
              })),
            },
            finish_reason: null,
          },
        ],
      })}\n\n`,
    );
  }
  response.write(
    `data: ${JSON.stringify({
      ...chunkBase,
      choices: [
        {
          index: 0,
          delta: {},
          finish_reason: turn?.toolCalls === undefined ? 'stop' : 'tool_calls',
        },
      ],
    })}\n\n`,
  );
  response.end('data: [DONE]\n\n');
}

async function consumeRequest(
  request: IncomingMessage,
  inspectRequest: ((body: unknown, headers: IncomingHttpHeaders) => void) | undefined,
  retainBody: boolean,
): Promise<unknown> {
  if (inspectRequest === undefined && !retainBody) {
    for await (const _chunk of request) {
      // Drain the public HTTP request without retaining prompt or credential data.
    }
    return undefined;
  }

  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  try {
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
    inspectRequest?.(body, request.headers);
    return body;
  } catch {
    inspectRequest?.(undefined, request.headers);
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
        reject(new Error('candidate-random-port-unavailable'));
        return;
      }
      resolve(address.port);
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error === undefined ? resolve() : reject(error)));
  });
  return port;
}

async function waitForCandidate(baseUrl: string, child: ReturnType<typeof spawn>, hasSpawnFailed: () => boolean, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (hasSpawnFailed() || child.exitCode !== null || child.signalCode !== null) {
      throw new Error('candidate-process-exited-before-readiness');
    }
    try {
      const response = await fetch(`${baseUrl}/health`, {
        signal: AbortSignal.timeout(1_000),
      });
      if (response.ok) {
        return;
      }
    } catch {
      // Startup is still in progress; retry until the bounded deadline.
    }
    await delay(100);
  }
  throw new Error('candidate-readiness-timeout');
}

function drainProcessOutput(stream: NodeJS.ReadableStream | null): void {
  stream?.on('data', () => undefined);
}

async function delay(milliseconds: number): Promise<void> {
  await new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, milliseconds);
    timer.unref();
  });
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
