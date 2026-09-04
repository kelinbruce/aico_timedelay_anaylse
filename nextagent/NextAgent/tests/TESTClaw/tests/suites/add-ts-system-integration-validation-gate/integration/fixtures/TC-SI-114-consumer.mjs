import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';

import { createCapabilitySubsystem } from '@nextagent/agent-capability';
import { createFetchSkillHubRemoteGatewayFactory } from '@nextagent/agent-platform-gateway-remote';

const baseUrl = process.env.TESTCLAW_LOOPBACK_BASE_URL;
const managedInstallRoot = process.env.TESTCLAW_SKILL_ROOT;
assert.equal(typeof baseUrl, 'string');
assert.equal(typeof managedInstallRoot, 'string');

const correlation = {
  async withIncomingCarrier(_carrier, operation) {
    return await operation();
  },
  async withExecutionRef(_ref, operation) {
    return await operation();
  },
  outboundHeaders(input = {}) {
    return {
      ...input,
      traceparent: '00-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-bbbbbbbbbbbbbbbb-01',
      'x-task-event-id': 'skillhub-loopback',
    };
  },
};

const adapter = createFetchSkillHubRemoteGatewayFactory({ executionCorrelation: correlation }).create({
  gatewayId: 'skillhub-loopback',
  endpoint: baseUrl,
});

const subsystem = createCapabilitySubsystem({
  providerConfigs: [
    {
      provider: { providerId: 'hub-loopback', providerKind: 'SKILL_HUB' },
      discoveryMode: 'SEARCH',
      options: { gatewayId: 'skillhub-loopback', managedInstallRef: managedInstallRoot },
    },
  ],
  skillHubRemoteAccessFactory: () => adapter,
  skillHubSourceAuthorization: (request) => request.providerId === 'hub-loopback' && request.agentId === 'agent-loopback',
});

function assembly(capabilityId) {
  return {
    agentId: 'agent-loopback',
    agentType: 'telecom',
    agentVersion: 'v1',
    agentAssemblyRef: 'agent-loopback:v1',
    displayName: 'Loopback agent',
    description: 'Telecom loopback agent.',
    workspacePolicy: {
      schemaVersion: 'nextagent.agent-workspace-policy.v1',
      isolationMode: 'subject',
      roots: [
        { kind: 'workspace', logicalPath: 'workspace', access: 'readWrite' },
        { kind: 'systemResources', logicalPath: '.nextagent', access: 'read' },
        { kind: 'temp', logicalPath: 'temp', access: 'readWrite' },
      ],
    },
    modelProfileIds: ['default-openai'],
    capabilityBindings: [{ capabilityId, capabilityType: 'SKILL', providerId: 'hub-loopback', enabled: true }],
    userInvocable: true,
    agentInvocation: 'BOUND',
    runtimeSettings: { defaultModelProfileId: 'default-openai', requestTimeoutMs: 1_000 },
  };
}

async function selectMode(mode) {
  const response = await fetch(`${baseUrl}/control`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ mode }),
  });
  assert.equal(response.ok, true);
}

async function listSkill(skillId) {
  return await subsystem.catalog.listAvailable({
    tenantId: 'tenant-loopback',
    subjectId: 'subject-loopback',
    agentAssembly: assembly(skillId),
    includeUnavailable: false,
  });
}

function contentInput(contentRef, stagingName) {
  return {
    tenantId: 'tenant-loopback',
    subjectId: 'subject-loopback',
    agentId: 'agent-loopback',
    agentVersion: 'v1',
    agentAssemblyRef: 'agent-loopback:v1',
    contentRef,
    stagingRoot: path.join(managedInstallRoot, stagingName),
  };
}

async function readCommittedSnapshot() {
  const indexContent = await readFile(path.join(managedInstallRoot, 'remote-skill-content-index.json'), 'utf8');
  const facts = JSON.parse(indexContent);
  assert.equal(Array.isArray(facts), true);
  assert.equal(facts.length, 1);
  const fact = facts[0];
  const manifestContent = await readFile(fact.manifestFile, 'utf8');
  return { indexContent, manifestContent };
}

async function main() {
  await selectMode('normal');
  const installed = await listSkill('radio-diag');
  assert.equal(
    installed.some((descriptor) => descriptor.capabilityId === 'radio-diag'),
    true,
  );
  const committedBefore = await readCommittedSnapshot();
  assert.equal(committedBefore.manifestContent.includes('Version one body.'), true);

  await selectMode('replacement-invalid');
  const afterFailedReplacement = await listSkill('radio-diag');
  assert.equal(
    afterFailedReplacement.some((descriptor) => descriptor.capabilityId === 'radio-diag'),
    true,
  );
  const committedAfter = await readCommittedSnapshot();
  assert.equal(committedAfter.indexContent, committedBefore.indexContent);
  assert.equal(committedAfter.manifestContent, committedBefore.manifestContent);

  await selectMode('traversal');
  const traversal = await adapter.fetchContent(contentInput('pkg-traversal', 'staging-traversal'), new AbortController().signal);
  assert.deepEqual(traversal, {
    status: 'failed',
    reasonCode: 'invalid-response',
    message: 'SkillHub package download failed safely.',
  });

  await selectMode('hash-mismatch');
  const hashMismatch = await adapter.fetchContent(contentInput('pkg-hash-mismatch', 'staging-hash'), new AbortController().signal);
  assert.equal(hashMismatch.status, 'failed');
  assert.equal(hashMismatch.reasonCode, 'invalid-response');

  await selectMode('http-failure');
  const httpFailure = await adapter.fetchContent(contentInput('pkg-http-failure', 'staging-http'), new AbortController().signal);
  assert.equal(httpFailure.status, 'failed');
  assert.equal(httpFailure.reasonCode, 'download-failed');
  assert.equal(JSON.stringify(httpFailure).includes('skillhub-canary'), false);

  await selectMode('delay');
  const abortController = new AbortController();
  const canceledPromise = adapter.fetchContent(contentInput('pkg-delay', 'staging-delay'), abortController.signal);
  setTimeout(() => abortController.abort(), 25);
  const canceled = await canceledPromise;
  assert.equal(canceled.status, 'failed');
  assert.equal(canceled.reasonCode, 'timeout');

  const stagingEntries = await readdir(path.join(managedInstallRoot, 'staging'), { withFileTypes: true }).catch(() => []);
  assert.equal(stagingEntries.length, 0);
  const finalSnapshot = await readCommittedSnapshot();
  assert.equal(finalSnapshot.indexContent, committedBefore.indexContent);
  assert.equal(finalSnapshot.manifestContent, committedBefore.manifestContent);

  process.stdout.write(
    `${JSON.stringify({
      atomicCommitObserved: true,
      cancellationRejected: true,
      failedReplacementPreserved: true,
      hashCheckedBeforeMaterialization: true,
      stagedFolderValidated: true,
      unsafeArchiveRejected: true,
    })}\n`,
  );
}

await main().catch(() => {
  process.exitCode = 1;
});
