import assert from 'node:assert/strict';
import { createHmac, randomUUID } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { createServer as createModelServer } from 'node:http';
import { createServer as createTcpServer } from 'node:net';
import path from 'node:path';

import { createNextAgentAppAsync } from '@nextagent/agent-app';
import {
  createLocalBackgroundTaskStore,
  createLocalCronTaskScheduler,
  createLocalGatewayProvider,
  createLocalRagKnowledgeGovernance,
  createLocalScheduledMaintenanceGateway,
  createRestrictedLocalSandboxGateway,
  createSqliteCronTaskGateway,
  createSqliteLongTermMemoryGatewayProvider,
  createSqliteWorkingMemoryGatewayProvider,
} from '@nextagent/agent-platform-gateway-local';
import { createRemoteGatewayProvider } from '@nextagent/agent-platform-gateway-remote';

const root = process.env.TESTCLAW_CANDIDATE_ROOT;
assert.equal(typeof root, 'string');
process.chdir(root);
const configFile = path.join(root, 'config', 'default-system.yaml');
const config = JSON.parse(await readFile(configFile, 'utf8'));
const port = await reservePort();
config.channel.port = port;
config.gateway.gateways = config.gateway.gateways.map((entry) =>
  entry.gatewayKind === 'cron-tasks' ? { gatewayId: 'remote-cron', gatewayKind: 'cron-tasks', deploymentMode: 'REMOTE' } : entry,
);
await writeFile(configFile, `${JSON.stringify(config, null, 2)}\n`, 'utf8');

const modelServer = createModelServer(async (request, response) => {
  for await (const _chunk of request) {
    /* drain */
  }
  response.writeHead(200, { 'content-type': 'text/event-stream' });
  const chunk = { id: 'cron-model', object: 'chat.completion.chunk', created: 1, model: 'testclaw-loopback-model' };
  response.write(
    `data: ${JSON.stringify({ ...chunk, choices: [{ index: 0, delta: { role: 'assistant', content: 'Remote Cron execution completed.' }, finish_reason: null }] })}\n\n`,
  );
  response.write(`data: ${JSON.stringify({ ...chunk, choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] })}\n\n`);
  response.end('data: [DONE]\n\n');
});
const modelPort = await listen(modelServer);
process.env.OPENAI_API_KEY = 'testclaw-loopback-key';
process.env.OPENAI_BASE_URL = `http://127.0.0.1:${modelPort}/v1`;
process.env.OPENAI_MODEL_NAME = 'testclaw-loopback-model';
process.env.NEXTAGENT_TEST_CRON_CALLBACK = 'cron-callback-secret';

const remoteCron = createSqliteCronTaskGateway(path.join(root, 'data', 'remote-cron.sqlite'));
const remoteProvider = createRemoteGatewayProvider({
  providerId: 'remote-cron-testclaw',
  supportedAdapterKinds: ['cron-tasks'],
  bindings: { cronTasks: remoteCron },
});
const callbackPath = '/__testclaw/cron-callback';
const app = await createNextAgentAppAsync({
  configFile,
  gatewayProviders: [
    createSqliteWorkingMemoryGatewayProvider(),
    createSqliteLongTermMemoryGatewayProvider(),
    createLocalGatewayProvider(),
    remoteProvider,
  ],
  backgroundTaskStoreFactory: createLocalBackgroundTaskStore,
  cronTaskGatewayFactory: createSqliteCronTaskGateway,
  cronTaskSchedulerFactory: createLocalCronTaskScheduler,
  sandboxGatewayFactory: createRestrictedLocalSandboxGateway,
  scheduledMaintenanceGatewayFactory: createLocalScheduledMaintenanceGateway,
  ragRetrievalFactory: createLocalRagKnowledgeGovernance,
  cronTriggerCallbackCredentialRef: 'env:NEXTAGENT_TEST_CRON_CALLBACK',
  cronTriggerCallbackRegistration({ server, handler }) {
    server.post(callbackPath, async (request, reply) => {
      try {
        return await handler.handle(request.body, new AbortController().signal);
      } catch {
        reply.code(400);
        return { error: { code: 'CRON_CALLBACK_REJECTED', message: 'Cron callback was rejected safely.' } };
      }
    });
  },
});

try {
  await app.start();
  const now = Date.now();
  const taskId = `task-${randomUUID()}`;
  const triggerId = `trigger-${randomUUID()}`;
  const scope = { tenantId: 'local-tenant', subjectId: 'local-subject', agentId: 'default-agent' };
  await remoteCron.createTask({
    ...scope,
    taskId,
    cron: '* * * * *',
    prompt: 'Inspect AMF registration failures.',
    recurring: false,
    status: 'ACTIVE',
    nextRunAt: now,
    version: 1,
    createdAt: now,
    updatedAt: now,
  });
  await remoteCron.claimCronTrigger({ ...scope, taskId, triggerId, scheduledAt: now, claimedAt: now + 1 });
  const unsigned = { taskId, triggerId, issuedAt: Date.now(), nonce: `nonce-${randomUUID()}` };
  const signature = createHmac('sha256', 'cron-callback-secret')
    .update(['NEXTAGENT_CRON_TRIGGER_V1', taskId, triggerId, String(unsigned.issuedAt), unsigned.nonce].join('\n'))
    .digest('base64url');
  const callback = { ...unsigned, authentication: { algorithm: 'HMAC-SHA256', signature } };
  const send = () =>
    fetch(`http://127.0.0.1:${port}${callbackPath}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(callback),
    }).then(async (response) => ({ status: response.status, body: await response.json() }));
  const [first, concurrent] = await Promise.all([send(), send()]);
  assert.equal(first.status, 200);
  assert.equal(concurrent.status, 200);
  assert.equal(first.body.requestRunId, concurrent.body.requestRunId);
  const replay = await send();
  assert.equal(replay.body.status, 'ALREADY_DELIVERED');
  assert.equal(replay.body.requestRunId, first.body.requestRunId);
  await waitFor(async () => {
    const run = await app.gateway.requestRuns.loadRun({ ...scope, runId: first.body.requestRunId });
    return run?.status === 'COMPLETED' && run.terminalCommitState === 'COMMITTED';
  });
  process.stdout.write(
    `${JSON.stringify({ signedCallbackAccepted: true, concurrentDeliveryCoalesced: true, replayCoalesced: true, terminalCommitted: true })}\n`,
  );
} finally {
  await app.close();
  await new Promise((resolve) => modelServer.close(resolve));
}

async function reservePort() {
  const server = createTcpServer();
  const port = await listen(server);
  await new Promise((resolve) => server.close(resolve));
  return port;
}

async function listen(server) {
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  return server.address().port;
}

async function waitFor(check) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('cron-terminal-timeout');
}
