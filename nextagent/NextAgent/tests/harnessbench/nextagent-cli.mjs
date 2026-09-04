import { createHash, randomUUID } from 'node:crypto';
import { cp, mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createExecutionWorkspaceResolver } from '@nextagent/agent-runtime';
import { startLocalRuntimePackage, stopLocalRuntimePackage } from '@nextagent/agent-app/local-runtime-package';
import { HARNESSBENCH_MODEL_MAX_OUTPUT_TOKENS, HARNESSBENCH_MODEL_TIMEOUT_MS } from './evaluation-config.mjs';
import { copyRegularTree, latestTimelineSequenceSse, parseTerminalSse, replaceRegularTree } from './workspace-bridge.mjs';

const moduleRoot = dirname(fileURLToPath(import.meta.url));
const harnessSessionStateFile = '.harnessbench-session.json';
const harnessSessionStateSchemaVersion = 1;
const runtimeSubscriberIdleTimeoutMs = 300_000;
// The backend-only public entrypoint owns this trusted local identity.
const identity = { tenantId: 'tenant-1', subjectId: 'subject-1' };
const workspacePolicy = {
  schemaVersion: 'nextagent.agent-workspace-policy.v1',
  isolationMode: 'subject',
  roots: [
    { kind: 'workspace', logicalPath: 'workspace', access: 'readWrite' },
    { kind: 'systemResources', logicalPath: '.nextagent', access: 'read' },
    { kind: 'temp', logicalPath: 'temp', access: 'readWrite' },
    { kind: 'generatedSkills', logicalPath: 'generated-skills', access: 'readWrite' },
  ],
};

export async function executeHarnessTask(options) {
  const candidateTemplate = requireTrustedPath(options.candidateTemplate, 'candidate template');
  const harnessWorkspace = requireTrustedPath(options.workspace, 'HarnessBench workspace');
  const promptFile = requireTrustedPath(options.promptFile, 'prompt file');
  const candidateRoot = resolve(options.runRoot, 'candidates', harnessCandidateKey(options.sessionId));
  const initialWorkspaceSnapshot = await snapshotRegularTree(harnessWorkspace);
  let failurePhase = 'candidate_prepare';
  const persistedSession = await loadHarnessSessionState(candidateRoot, options.sessionId);
  if (persistedSession === undefined) {
    await rm(candidateRoot, { recursive: true, force: true });
    await mkdir(dirname(candidateRoot), { recursive: true });
    await cp(candidateTemplate, candidateRoot, { recursive: true, verbatimSymlinks: true });
  }

  const port = await reserveFreePort();
  await installCandidateConfig(candidateRoot, port, options.modelId);
  await registerProxyRoute(options.routesFile, options.providerBaseUrl);
  const previousEnv = captureEnv([
    'NEXTAGENT_MODEL_BASE_URL',
    'NEXTAGENT_MODEL_API_KEY',
    'OPENAI_MODEL_NAME',
    'NEXTAGENT_CONFIG_DIR',
    'HARNESSBENCH_PROVIDER_BASE_URL',
    'HARNESSBENCH_API_KEY',
    'RUBRIC_BASE_URL',
    'RUBRIC_API_KEY',
    'RUBRIC_MODEL',
  ]);
  delete process.env.HARNESSBENCH_PROVIDER_BASE_URL;
  delete process.env.HARNESSBENCH_API_KEY;
  delete process.env.RUBRIC_BASE_URL;
  delete process.env.RUBRIC_API_KEY;
  delete process.env.RUBRIC_MODEL;
  process.env.NEXTAGENT_MODEL_BASE_URL = `${options.proxyUrl.replace(/\/$/u, '')}/nextagent/model`;
  process.env.NEXTAGENT_MODEL_API_KEY = options.credential;
  process.env.OPENAI_MODEL_NAME = options.modelId;
  process.env.NEXTAGENT_CONFIG_DIR = resolve(candidateRoot, 'config');

  const baseUrl = `http://127.0.0.1:${port}`;
  let workspaceRoot;
  try {
    await startLocalRuntimePackage(candidateRoot);
    failurePhase = 'session_create';
    const session = persistedSession ?? (await createHarnessSession(baseUrl));
    workspaceRoot = createExecutionWorkspaceResolver()
      .resolve({
        runtimeWorkspaceRoot: resolve(candidateRoot, 'workspaces', 'execution'),
        workspacePolicy,
        agentId: 'harnessbench-agent',
        tenantId: identity.tenantId,
        subjectId: identity.subjectId,
        sessionId: session.sessionId,
        runId: 'pre-submit',
        deploymentMode: 'LOCAL',
      })
      .roots.find((root) => root.kind === 'workspace')?.physicalPath;
    if (workspaceRoot === undefined) throw new Error('NextAgent execution workspace was not resolved.');
    if (persistedSession === undefined) await writeHarnessSessionState(candidateRoot, options.sessionId, session.sessionId);
    await copyRegularTree(harnessWorkspace, workspaceRoot);

    const rawPrompt = await readFile(promptFile, 'utf8');
    const prompt = sanitizePromptWorkspace(rawPrompt, harnessWorkspace);
    failurePhase = 'request_submit';
    const acceptedResponse = await fetch(`${baseUrl}/api/v1/sessions/${session.sessionId}/requests`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ inputText: prompt, idempotencyKey: `harnessbench-${randomUUID()}` }),
    });
    if (!acceptedResponse.ok) throw new Error(`NextAgent request submission failed with HTTP ${acceptedResponse.status}.`);
    const accepted = await acceptedResponse.json();
    failurePhase = 'stream_wait';
    const terminal = await waitForTerminal(baseUrl, session.sessionId, accepted, options.timeoutMs);
    failurePhase = 'workspace_export';
    await replaceRegularTree(workspaceRoot, harnessWorkspace);
    const workspaceOutcomeObserved = initialWorkspaceSnapshot !== (await snapshotRegularTree(harnessWorkspace));
    if (terminal.status !== 'completed') {
      throw harnessTaskFailure('terminal', terminal.reasonCode ?? terminalReasonCode(terminal.status), workspaceOutcomeObserved);
    }
    return {
      sessionId: session.sessionId,
      runId: accepted.runId,
      requestId: accepted.requestId,
      terminalStatus: terminal.status,
      workspaceOutcomeObserved,
    };
  } catch (error) {
    if (error?.name === 'HarnessTaskFailure') throw error;
    throw harnessTaskFailure(failurePhase, failureReasonCode(failurePhase, error), false, error);
  } finally {
    if (workspaceRoot !== undefined) await replaceRegularTree(workspaceRoot, harnessWorkspace).catch(() => undefined);
    await stopLocalRuntimePackage(candidateRoot).catch(() => undefined);
    restoreEnv(previousEnv);
  }
}

export function harnessCandidateKey(sessionId) {
  const value = String(sessionId);
  const prefix = value.replace(/[^A-Za-z0-9._-]/gu, '-').slice(0, 32) || 'session';
  return `${prefix}-${sessionHash(value).slice(0, 16)}`;
}

export async function loadHarnessSessionState(candidateRoot, upstreamSessionId) {
  const path = resolve(candidateRoot, harnessSessionStateFile);
  let parsed;
  try {
    parsed = JSON.parse(await readFile(path, 'utf8'));
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return undefined;
    throw harnessTaskFailure('candidate_prepare', 'SESSION_STATE_INVALID', false, error);
  }
  if (
    parsed?.schemaVersion !== harnessSessionStateSchemaVersion ||
    parsed?.upstreamSessionHash !== sessionHash(String(upstreamSessionId)) ||
    !isSafeSessionId(parsed?.nextAgentSessionId)
  ) {
    throw harnessTaskFailure('candidate_prepare', 'SESSION_STATE_INVALID', false);
  }
  return { sessionId: parsed.nextAgentSessionId };
}

async function createHarnessSession(baseUrl) {
  const sessionResponse = await fetch(`${baseUrl}/api/v1/sessions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ locale: 'en-US' }),
  });
  if (!sessionResponse.ok) throw new Error(`NextAgent session creation failed with HTTP ${sessionResponse.status}.`);
  const session = await sessionResponse.json();
  if (!isSafeSessionId(session?.sessionId)) throw new Error('NextAgent session creation returned an invalid session id.');
  return { sessionId: session.sessionId };
}

async function writeHarnessSessionState(candidateRoot, upstreamSessionId, nextAgentSessionId) {
  const target = resolve(candidateRoot, harnessSessionStateFile);
  const temporary = resolve(candidateRoot, `${harnessSessionStateFile}.${randomUUID()}.tmp`);
  const state = {
    schemaVersion: harnessSessionStateSchemaVersion,
    upstreamSessionHash: sessionHash(String(upstreamSessionId)),
    nextAgentSessionId,
  };
  try {
    await writeFile(temporary, `${JSON.stringify(state)}\n`, { encoding: 'utf8', flag: 'wx' });
    await rename(temporary, target);
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
}

function sessionHash(value) {
  return createHash('sha256').update(value).digest('hex');
}

function isSafeSessionId(value) {
  return typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/u.test(value);
}

function harnessTaskFailure(failurePhase, failureReasonCodeValue, workspaceOutcomeObserved, cause) {
  const error = new Error('HarnessBench NextAgent task failed.', cause === undefined ? undefined : { cause });
  error.name = 'HarnessTaskFailure';
  error.failurePhase = failurePhase;
  error.failureReasonCode = failureReasonCodeValue;
  error.workspaceOutcomeObserved = workspaceOutcomeObserved;
  return error;
}

function failureReasonCode(phase, error) {
  const message = error instanceof Error ? error.message : '';
  const embedded = message.match(/\b[A-Z][A-Z0-9_]{2,127}\b/u)?.[0];
  if (embedded !== undefined) return embedded;
  return (
    {
      candidate_prepare: 'CANDIDATE_PREPARE_FAILED',
      session_create: 'SESSION_CREATE_FAILED',
      request_submit: 'REQUEST_SUBMIT_FAILED',
      stream_wait: 'STREAM_WAIT_FAILED',
      workspace_export: 'WORKSPACE_EXPORT_FAILED',
    }[phase] ?? 'UNKNOWN'
  );
}

export function terminalReasonCode(status) {
  if (status === 'failed') return 'TERMINAL_FAILED';
  if (status === 'timed_out') return 'TASK_TIMED_OUT';
  if (status === 'canceled') return 'REQUEST_CANCELED';
  return 'UNKNOWN';
}

export async function waitForTerminal(baseUrl, sessionId, accepted, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const maxStreamConnections = Math.ceil(timeoutMs / runtimeSubscriberIdleTimeoutMs) + 1;
  let lastSeenSequence = 0;
  let resumable = false;
  try {
    for (let connection = 0; connection < maxStreamConnections; connection += 1) {
      const response = await fetch(`${baseUrl}/api/v1/sessions/${sessionId}/stream?lastSeenSequence=${lastSeenSequence}&runId=${accepted.runId}`, {
        signal: controller.signal,
      });
      if (!response.ok) throw harnessTaskFailure('stream_wait', 'STREAM_HTTP_FAILED', false);
      const body = await response.text();
      const terminal = parseTerminalSse(body);
      if (terminal !== undefined) return terminal;
      const observedSequence = latestTimelineSequenceSse(body);
      if (observedSequence !== undefined) {
        lastSeenSequence = Math.max(lastSeenSequence, observedSequence);
        resumable = true;
      }
      if (!resumable || connection === maxStreamConnections - 1) {
        throw harnessTaskFailure('stream_wait', 'STREAM_CLOSED_WITHOUT_TERMINAL', false);
      }
    }
    throw harnessTaskFailure('stream_wait', 'STREAM_CLOSED_WITHOUT_TERMINAL', false);
  } catch (error) {
    if (error?.name === 'HarnessTaskFailure') throw error;
    if (!controller.signal.aborted) throw harnessTaskFailure('stream_wait', 'STREAM_TRANSPORT_FAILED', false);
    await fetch(`${baseUrl}/api/v1/sessions/${sessionId}/cancel`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ expectedLatestRequestId: accepted.requestId, idempotencyKey: `harnessbench-cancel-${randomUUID()}` }),
    }).catch(() => undefined);
    return { status: 'timed_out' };
  } finally {
    clearTimeout(timer);
  }
}

export function buildHarnessCandidateConfig({ port, modelId }) {
  return {
    deployment: { mode: 'LOCAL' },
    paths: { workspaceRoot: 'workspaces', logDirectory: 'logs', agentRoot: 'agents', skillRoot: 'skills' },
    auth: {
      mode: 'local',
      localIdentity: { tenantId: identity.tenantId, subjectId: identity.subjectId, displayName: 'HarnessBench evaluator' },
      localAuth: { enabled: false },
    },
    channel: { transport: 'fastify', host: '127.0.0.1', port },
    hostedAgent: { activeAgentId: 'harnessbench-agent' },
    modelProfiles: [
      {
        providerId: 'openai-compatible',
        baseUrl: 'env:NEXTAGENT_MODEL_BASE_URL',
        credentialRef: 'env:NEXTAGENT_MODEL_API_KEY',
        models: [
          {
            modelId: 'env:OPENAI_MODEL_NAME',
            displayName: modelId,
            contextWindowTokens: 128000,
            fallbackEligible: false,
            temperature: 0.2,
            maxOutputTokens: HARNESSBENCH_MODEL_MAX_OUTPUT_TOKENS,
            timeoutMs: HARNESSBENCH_MODEL_TIMEOUT_MS,
          },
        ],
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
    sandbox: { enabled: false, deniedExecutables: [] },
    noopBoundaries: { lifecycleHook: 'noop', checkpoint: 'noop', audit: 'noop' },
  };
}

async function installCandidateConfig(candidateRoot, port, modelId) {
  const config = buildHarnessCandidateConfig({ port, modelId });
  const agentRoot = resolve(candidateRoot, 'agents', 'harnessbench-agent');
  await rm(resolve(candidateRoot, 'agents'), { recursive: true, force: true });
  await mkdir(agentRoot, { recursive: true });
  await writeFile(resolve(candidateRoot, 'config', 'default-system.yaml'), `${JSON.stringify(config, null, 2)}\n`, 'utf8');
  await cp(resolve(moduleRoot, 'fixtures', 'harnessbench-agent.yaml'), resolve(agentRoot, 'agent.yaml'));
}

export function registerProxyRoute(routesFile, providerBaseUrl) {
  if (typeof routesFile !== 'string' || routesFile.length === 0) throw new Error('HarnessBench proxy routes file is required.');
  const upstream = new URL(providerBaseUrl);
  if (upstream.protocol !== 'https:') throw new Error('HarnessBench provider upstream must use HTTPS.');
  const routes = { '/nextagent/model': { upstream: upstream.toString().replace(/\/$/u, ''), framework: 'nextagent', provider: 'openai-compatible' } };
  return mkdir(dirname(routesFile), { recursive: true }).then(() => writeFile(routesFile, `${JSON.stringify(routes, null, 2)}\n`, 'utf8'));
}

function sanitizePromptWorkspace(prompt, harnessWorkspace) {
  return prompt.split(harnessWorkspace).join('workspace').split(harnessWorkspace.replaceAll('\\', '/')).join('workspace');
}

function requireTrustedPath(value, label) {
  if (typeof value !== 'string' || value.length === 0) throw new Error(`${label} is required.`);
  return resolve(value);
}

function captureEnv(names) {
  return Object.fromEntries(names.map((name) => [name, process.env[name]]));
}

function restoreEnv(snapshot) {
  for (const [name, value] of Object.entries(snapshot)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
}

async function reserveFreePort() {
  return await new Promise((resolvePort, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      server.close((error) => {
        if (error !== undefined) reject(error);
        else if (typeof address === 'object' && address !== null) resolvePort(address.port);
        else reject(new Error('Unable to reserve a local port.'));
      });
    });
  });
}

async function snapshotRegularTree(root) {
  const rows = [];
  await appendSnapshotRows(resolve(root), resolve(root), rows);
  return createHash('sha256').update(rows.join('\n')).digest('hex');
}

async function appendSnapshotRows(root, directory, rows) {
  for (const entry of (await readdir(directory, { withFileTypes: true })).sort((left, right) => left.name.localeCompare(right.name))) {
    const path = resolve(directory, entry.name);
    const name = path.slice(root.length + 1).replaceAll('\\', '/');
    if (entry.isDirectory()) await appendSnapshotRows(root, path, rows);
    else if (entry.isFile())
      rows.push(
        `${name}:${createHash('sha256')
          .update(await readFile(path))
          .digest('hex')}`,
      );
  }
}

function parseArgs(args) {
  const options = {};
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index];
    const value = args[index + 1];
    if (key === undefined || value === undefined || !key.startsWith('--')) throw new Error('nextagent-cli arguments must be --key value pairs.');
    options[key.slice(2)] = value;
  }
  return {
    candidateTemplate: options['candidate-template'] ?? process.env.HARNESSBENCH_NEXTAGENT_CANDIDATE_TEMPLATE,
    runRoot: options['run-root'] ?? process.env.HARNESSBENCH_NEXTAGENT_RUN_ROOT,
    workspace: options.workspace ?? process.env.HARNESSBENCH_WORKSPACE,
    promptFile: options['prompt-file'] ?? process.env.HARNESSBENCH_PROMPT_FILE,
    sessionId: options['session-id'] ?? process.env.HARNESSBENCH_SESSION_ID,
    modelId: options['model-id'] ?? process.env.HARNESSBENCH_MODEL_ID,
    proxyUrl: process.env.HARNESSBENCH_LLM_PROXY_URL,
    routesFile: process.env.HARNESSBENCH_LLM_PROXY_ROUTES,
    providerBaseUrl: process.env.HARNESSBENCH_PROVIDER_BASE_URL,
    credential: process.env.HARNESSBENCH_API_KEY,
    timeoutMs: Number.parseInt(options['timeout-ms'] ?? '600000', 10),
  };
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const result = await executeHarnessTask(parseArgs(process.argv.slice(2)));
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } catch (error) {
    process.stdout.write(
      `${JSON.stringify({
        ok: false,
        failurePhase: error?.failurePhase ?? 'candidate_prepare',
        failureReasonCode: error?.failureReasonCode ?? 'UNKNOWN',
        workspaceOutcomeObserved: error?.workspaceOutcomeObserved === true,
      })}\n`,
    );
    process.exitCode = 1;
  }
}
