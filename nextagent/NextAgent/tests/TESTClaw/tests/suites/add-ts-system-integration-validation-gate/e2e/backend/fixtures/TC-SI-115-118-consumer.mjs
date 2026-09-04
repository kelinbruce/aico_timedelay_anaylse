import assert from 'node:assert/strict';

import { createRemoteNextAgentApp, startRemoteRuntimePackage, stopRemoteRuntimePackage } from '@nextagent/agent-remote-deployment';
import {
  checkLocalRuntimePackageLayout,
  readLocalRuntimePackageManifest,
  validateLocalRuntimePackageConfigSample,
} from '@nextagent/agent-app/local-runtime-package';

const caseId = process.env.TESTCLAW_CASE_ID;
const candidateRoot = process.env.TESTCLAW_CANDIDATE_ROOT;
const baseUrl = process.env.TESTCLAW_RUNTIME_BASE_URL;
const modelControlUrl = process.env.TESTCLAW_MODEL_CONTROL_URL;
assert.equal(typeof caseId, 'string');
assert.equal(typeof candidateRoot, 'string');
assert.equal(typeof baseUrl, 'string');
assert.equal(typeof modelControlUrl, 'string');

async function submit(inputText) {
  const response = await fetch(`${baseUrl}/api/v1/requests`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ inputText, idempotencyKey: `testclaw-${caseId}-${crypto.randomUUID()}` }),
  });
  assert.equal(response.status, 200);
  return await response.json();
}

async function stream(accepted) {
  const response = await fetch(`${baseUrl}/api/v1/sessions/${accepted.sessionId}/stream?lastSeenSequence=0&runId=${accepted.runId}`);
  assert.equal(response.status, 200);
  return await response.text();
}

async function history(sessionId) {
  const response = await fetch(`${baseUrl}/api/v1/sessions/${sessionId}/conversation?limit=100&includeCapabilityResults=true`);
  assert.equal(response.status, 200);
  return await response.text();
}

function terminalCount(body) {
  return (body.match(/event: REQUEST_(?:COMPLETED|FAILED|CANCELED)/gu) ?? []).length;
}

async function mainline() {
  const accepted = await submit('remote-mainline');
  const events = await stream(accepted);
  const conversation = await history(accepted.sessionId);
  assert.equal(terminalCount(events), 1);
  assert.match(events, /REQUEST_COMPLETED/u);
  assert.match(events, /remote deployment model output/u);
  assert.match(conversation, /remote deployment model output/u);
}

async function telecomDiagnosis() {
  const accepted = await submit('remote-telecom-diagnosis');
  const events = await stream(accepted);
  const conversation = await history(accepted.sessionId);
  assert.equal(terminalCount(events), 1);
  assert.match(events, /REQUEST_COMPLETED/u);
  assert.match(events, /remote-rag-call/u);
  assert.match(events, /remote-bash-call/u);
  assert.match(conversation, /remote telecom diagnosis completed/u);
  assert.equal(conversation.includes('RAN handover threshold evidence'), false);
  assert.equal(conversation.includes('ran-diagnostic'), false);
}

async function failureMatrix() {
  for (const mode of ['remote-invalid', 'remote-failure', 'remote-timeout']) {
    const accepted = await submit(mode);
    const events = await stream(accepted);
    const conversation = await history(accepted.sessionId);
    assert.equal(terminalCount(events), 1);
    assert.match(events, /REQUEST_FAILED/u);
    assert.equal(events.includes('REMOTE_RAW_CANARY'), false);
    assert.equal(conversation.includes('REMOTE_RAW_CANARY'), false);
  }

  const canceled = await submit('remote-cancel');
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const state = await fetch(modelControlUrl).then((response) => response.json());
    if (state.activeCancel === true) break;
    await new Promise((resolve) => setTimeout(resolve, 10));
    if (attempt === 99) throw new Error('remote-cancel-invocation-not-started');
  }
  const cancelResponse = await fetch(`${baseUrl}/api/v1/sessions/${canceled.sessionId}/cancel`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ expectedLatestRequestId: canceled.requestId, idempotencyKey: `testclaw-cancel-${crypto.randomUUID()}` }),
  });
  assert.equal(cancelResponse.status, 200);
  const canceledEvents = await stream(canceled);
  const canceledHistory = await history(canceled.sessionId);
  assert.equal(terminalCount(canceledEvents), 1);
  assert.match(canceledEvents, /REQUEST_CANCELED/u);
  assert.equal(canceledEvents.includes('REMOTE_RAW_CANARY'), false);
  assert.equal(canceledHistory.includes('REMOTE_RAW_CANARY'), false);
}

const manifest = readLocalRuntimePackageManifest(candidateRoot);
const configRef = manifest.configSampleRefs[0];
try {
  const validationApp = createRemoteNextAgentApp({
    configFile: `${candidateRoot}/${configRef}`,
    remoteGatewayClients: {
      sandbox: {
        async execute(request) {
          return {
            executionId: request.executionId,
            stdout: '',
            stderr: '',
            stdoutTruncated: false,
            stderrTruncated: false,
            timedOut: false,
            durationMs: 0,
          };
        },
      },
      ragRetrieval: {
        async retrieve() {
          return { status: 'UNAVAILABLE', results: [], diagnostics: { reason: 'PROVIDER_UNAVAILABLE' } };
        },
      },
    },
  });
  await validationApp.close();
} catch (error) {
  const details = error && typeof error === 'object' ? JSON.stringify(error) : String(error);
  throw new Error(`remote-config:${details}`);
}
const diagnostics = [
  ...checkLocalRuntimePackageLayout(candidateRoot, manifest),
  ...validateLocalRuntimePackageConfigSample(candidateRoot, configRef),
];
if (diagnostics.length > 0) throw new Error(`remote-preflight:${diagnostics.map((entry) => `${entry.code}:${entry.message}`).join(',')}`);
await startRemoteRuntimePackage(candidateRoot);
try {
  if (caseId === 'TC-SI-115') await mainline();
  else if (caseId === 'TC-SI-116') await telecomDiagnosis();
  else if (caseId === 'TC-SI-118') await failureMatrix();
  else throw new Error('unsupported-case');
  process.stdout.write(`${JSON.stringify({ caseId, passed: true })}\n`);
} catch {
  process.stdout.write(`${JSON.stringify({ caseId, passed: false })}\n`);
  process.exitCode = 1;
} finally {
  await stopRemoteRuntimePackage(candidateRoot);
}
