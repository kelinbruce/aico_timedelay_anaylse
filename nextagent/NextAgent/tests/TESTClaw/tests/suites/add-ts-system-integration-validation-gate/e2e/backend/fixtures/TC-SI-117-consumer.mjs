import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { createServer as createHttpServer } from 'node:http';
import { createServer as createTcpServer } from 'node:net';
import path from 'node:path';

import { createNextAgentAppAsync } from '@nextagent/agent-app';
import { createFetchSkillHubRemoteGatewayFactory } from '@nextagent/agent-platform-gateway-remote';
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

const root = process.env.TESTCLAW_CANDIDATE_ROOT;
assert.equal(typeof root, 'string');
process.chdir(root);
const configFile = path.join(root, 'config', 'default-system.yaml');
const config = JSON.parse(await readFile(configFile, 'utf8'));
config.channel.port = await reservePort();
config.nextAgent.system['capability-providers'] = [
  { id: 'hub-loopback', type: 'skill-hub', gatewayId: 'skillhub-loopback', installDir: 'skillhub-managed' },
];
await writeFile(configFile, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
const agentFile = path.join(root, 'agents', 'default-agent', 'agent.yaml');
const agent = JSON.parse(await readFile(agentFile, 'utf8'));
agent.capabilityBindings.push(
  { capabilityId: 'ran-qos-skill', capabilityType: 'SKILL', providerId: 'hub-loopback', enabled: true },
  { capabilityId: 'acquire_skill', capabilityType: 'TOOL', providerId: 'hub-loopback', enabled: true },
);
await writeFile(agentFile, `${JSON.stringify(agent, null, 2)}\n`, 'utf8');

const skillBody = 'SKILL_BODY_ONLY_CANARY Diagnose RAN QoS using the governed runbook.';
const skillPackage = zipPackage([
  {
    path: 'SKILL.md',
    content: [
      '---',
      'name: ran-qos-skill',
      'description: Diagnose RAN QoS degradation.',
      'context: inline',
      'user-invocable: true',
      'model-invocable: true',
      'metadata:',
      '  version: 1.0.0',
      '  zh-name: 无线质量诊断',
      '  en-name: RAN QoS Diagnostics',
      '---',
      skillBody,
    ].join('\n'),
  },
  { path: 'references/runbook.md', content: 'Check PRB utilization and handover failures.\n' },
]);
const packageHash = createHash('sha256').update(skillPackage).digest('hex');
let searchCalls = 0;
let packageCalls = 0;
const skillHubServer = createHttpServer(async (request, response) => {
  const body = await readJson(request);
  if (request.url === '/skills/search') {
    searchCalls += 1;
    const requested = body?.requestedCapabilityId;
    const candidates =
      requested === 'ran-qos-skill'
        ? [
            {
              skillId: 'ran-qos-skill',
              packageRef: 'pkg-ran-qos-v1',
              packageVersion: '1.0.0',
              packageHash,
              agentId: 'default-agent',
              agentVersion: 'v1',
              agentAssemblyRef: 'default-agent:v1',
            },
          ]
        : [];
    return respondJson(response, { candidates });
  }
  if (request.url === '/skills/package') {
    packageCalls += 1;
    return respondJson(response, { packageBytesBase64: skillPackage.toString('base64'), packageVersion: '1.0.0', packageHash });
  }
  response.writeHead(404).end();
});
const skillHubPort = await listen(skillHubServer);

const modelRequests = [];
let modelTurn = 0;
const modelServer = createHttpServer(async (request, response) => {
  const body = await readJson(request);
  modelRequests.push(body);
  const turns = [
    {
      toolCalls: [
        {
          toolCallId: 'acquire-ran-qos',
          toolName: 'acquire_skill',
          arguments: { requested_capability_id: 'ran-qos-skill', provider_id: 'hub-loopback' },
        },
      ],
    },
    { toolCalls: [{ toolCallId: 'load-ran-qos', toolName: 'Skill', arguments: { name: 'ran-qos-skill', args: { symptom: 'handover failures' } } }] },
    { content: 'RAN QoS Skill executed.' },
  ];
  writeModelTurn(response, turns[Math.min(modelTurn++, turns.length - 1)]);
});
const modelPort = await listen(modelServer);
process.env.OPENAI_API_KEY = 'testclaw-loopback-key';
process.env.OPENAI_BASE_URL = `http://127.0.0.1:${modelPort}/v1`;
process.env.OPENAI_MODEL_NAME = 'testclaw-loopback-model';

const skillHubEndpoint = `http://127.0.0.1:${skillHubPort}`;
const app = await createNextAgentAppAsync({
  configFile,
  gatewayProviders: [createSqliteWorkingMemoryGatewayProvider(), createSqliteLongTermMemoryGatewayProvider(), createLocalGatewayProvider()],
  backgroundTaskStoreFactory: createLocalBackgroundTaskStore,
  cronTaskGatewayFactory: createSqliteCronTaskGateway,
  cronTaskSchedulerFactory: createLocalCronTaskScheduler,
  sandboxGatewayFactory: createRestrictedLocalSandboxGateway,
  scheduledMaintenanceGatewayFactory: createLocalScheduledMaintenanceGateway,
  ragRetrievalFactory: createLocalRagKnowledgeGovernance,
  skillHubAccessFactory(providerConfig, executionCorrelation) {
    return createFetchSkillHubRemoteGatewayFactory({ executionCorrelation }).create({
      gatewayId: providerConfig.options.gatewayId,
      endpoint: skillHubEndpoint,
    });
  },
});

try {
  await app.start();
  const accepted = await fetch(`http://127.0.0.1:${config.channel.port}/api/v1/requests`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ inputText: 'Diagnose RAN QoS degradation.', idempotencyKey: `tc-si-117-${randomUUID()}` }),
  });
  assert.equal(accepted.status, 200);
  const ids = await accepted.json();
  const stream = await fetch(
    `http://127.0.0.1:${config.channel.port}/api/v1/sessions/${ids.sessionId}/stream?lastSeenSequence=0&runId=${ids.runId}`,
  ).then((response) => response.text());
  assert.equal(stream.includes('REQUEST_COMPLETED'), true);
  assert.equal(modelRequests.length, 3);
  const requestTexts = modelRequests.map((request) => JSON.stringify(request));
  assert.equal(requestTexts[0].includes(skillBody), false);
  assert.equal(requestTexts[1].includes(skillBody), false);
  const loadedMessage = modelRequests[2].messages.find((message) => JSON.stringify(message).includes(skillBody));
  assert.ok(loadedMessage);
  assert.equal(JSON.stringify(loadedMessage).includes('.nextagent/skills/'), true);
  assert.equal(JSON.stringify(loadedMessage).includes('name: ran-qos-skill'), false);
  const catalogResponse = await fetch(`http://127.0.0.1:${config.channel.port}/api/v1/skills?keyword=ran-qos-skill`);
  assert.equal(catalogResponse.status, 200);
  const catalog = await catalogResponse.json();
  const entry = catalog.skills.find((skill) => skill.capabilityId === 'ran-qos-skill');
  assert.ok(entry);
  assert.equal(entry.sourceMetadata['zh-name'], '无线质量诊断');
  assert.equal(entry.sourceMetadata['en-name'], 'RAN QoS Diagnostics');
  assert.equal(entry.sourceMetadata['zh-name'] ?? entry.sourceMetadata['en-name'] ?? entry.displayName, '无线质量诊断');
  const workspaceFiles = await filesBelow(path.join(root, 'workspaces'));
  const projectedSkillFiles = workspaceFiles.filter((file) => file.includes('/.nextagent/skills/'));
  assert.equal(
    projectedSkillFiles.some((file) => file.endsWith('references/runbook.md')),
    true,
  );
  assert.equal(
    projectedSkillFiles.some((file) => file.endsWith('SKILL.md')),
    false,
  );
  assert.equal(searchCalls > 0 && packageCalls > 0, true);
  process.stdout.write(
    `${JSON.stringify({ acquiredOverHttp: true, localizedCatalogVisible: true, resourceProjected: true, skillBodyLoadedOnlyBySkill: true, terminalCommitted: true })}\n`,
  );
} finally {
  await app.close();
  await Promise.all([new Promise((resolve) => modelServer.close(resolve)), new Promise((resolve) => skillHubServer.close(resolve))]);
}

function writeModelTurn(response, turn) {
  const base = { id: 'skillhub-model', object: 'chat.completion.chunk', created: 1, model: 'testclaw-loopback-model' };
  response.writeHead(200, { 'content-type': 'text/event-stream' });
  if (turn.content)
    response.write(
      `data: ${JSON.stringify({ ...base, choices: [{ index: 0, delta: { role: 'assistant', content: turn.content }, finish_reason: null }] })}\n\n`,
    );
  if (turn.toolCalls)
    response.write(
      `data: ${JSON.stringify({ ...base, choices: [{ index: 0, delta: { role: 'assistant', tool_calls: turn.toolCalls.map((call, index) => ({ index, id: call.toolCallId, type: 'function', function: { name: call.toolName, arguments: JSON.stringify(call.arguments) } })) }, finish_reason: null }] })}\n\n`,
    );
  response.write(
    `data: ${JSON.stringify({ ...base, choices: [{ index: 0, delta: {}, finish_reason: turn.toolCalls ? 'tool_calls' : 'stop' }] })}\n\n`,
  );
  response.end('data: [DONE]\n\n');
}

function zipPackage(entries) {
  const local = [];
  const central = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.path);
    const content = Buffer.from(entry.content);
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50, 0);
    header.writeUInt16LE(20, 4);
    header.writeUInt32LE(content.length, 18);
    header.writeUInt32LE(content.length, 22);
    header.writeUInt16LE(name.length, 26);
    local.push(header, name, content);
    const directory = Buffer.alloc(46);
    directory.writeUInt32LE(0x02014b50, 0);
    directory.writeUInt16LE(20, 4);
    directory.writeUInt16LE(20, 6);
    directory.writeUInt32LE(content.length, 20);
    directory.writeUInt32LE(content.length, 24);
    directory.writeUInt16LE(name.length, 28);
    directory.writeUInt32LE(offset, 42);
    central.push(directory, name);
    offset += header.length + name.length + content.length;
  }
  const centralBytes = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralBytes.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, centralBytes, end]);
}

async function readJson(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  const text = Buffer.concat(chunks).toString('utf8');
  return text ? JSON.parse(text) : undefined;
}
function respondJson(response, body) {
  response.writeHead(200, { 'content-type': 'application/json' });
  response.end(JSON.stringify(body));
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
async function filesBelow(root) {
  const entries = await readdir(root, { recursive: true, withFileTypes: true }).catch(() => []);
  return entries.filter((entry) => entry.isFile()).map((entry) => path.join(entry.parentPath, entry.name).replaceAll('\\', '/'));
}
