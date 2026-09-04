import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { expect } from 'vitest';

import type { SystemIntegrationCaseId } from '../case-manifest.js';
import { readCandidateStream, submitCandidateRequest } from './candidate-api.js';
import { requiredCandidateRoot, startCandidateHarness, type CandidateModelTurn } from './candidate-harness.js';
import { writePassingCaseEvidence } from './case-evidence.js';
import { hashDirectoryTree } from './external-consumer-root.js';
import { withRunScope } from './run-scope.js';

const supported = new Set(['TC-SI-018', 'TC-SI-020', 'TC-SI-021', 'TC-SI-031', 'TC-SI-036', 'TC-SI-037', 'TC-SI-038', 'TC-SI-040', 'TC-SI-041']);

export async function runRemainingFixedCase(caseId: SystemIntegrationCaseId): Promise<void> {
  if (!supported.has(caseId)) {
    throw new Error(`unsupported-fixed-case-${caseId}`);
  }
  const candidateRoot = requiredCandidateRoot();
  const before = await hashDirectoryTree(candidateRoot);
  await withRunScope({ outputBase: process.env.TESTCLAW_SYSTEM_INTEGRATION_OUTPUT_ROOT }, async (scope) => {
    const harness = await startCandidateHarness({
      scope,
      candidateRoot,
      modelTurns: turns(caseId),
      ...(caseId === 'TC-SI-037' ? { selectModelTurn: selectMemoryTurn } : {}),
      ...(caseId === 'TC-SI-020' ? { prepareRuntime: disableRead } : {}),
      ...(caseId === 'TC-SI-038' ? { prepareRuntime: addDeferredSkill } : {}),
      ...(caseId === 'TC-SI-040' ? { prepareRuntime: addWorkflowRecipe } : {}),
    });
    const observations = await execute(caseId, harness, scope.restrictedDiagnosticRoot);
    await writePassingCaseEvidence({
      evidenceRoot: scope.evidenceRoot,
      caseId,
      observations,
      canaries: [
        { category: 'prompt', value: `fixed-prompt-${caseId}` },
        { category: 'credential', value: 'testclaw-loopback-key' },
        { category: 'absolute-path', value: candidateRoot },
      ],
    });
  });
  expect(await hashDirectoryTree(candidateRoot)).toBe(before);
}

async function execute(
  caseId: SystemIntegrationCaseId,
  harness: Awaited<ReturnType<typeof startCandidateHarness>>,
  restrictedDiagnosticRoot: string,
): Promise<Record<string, boolean | number | string>> {
  if (caseId === 'TC-SI-021') {
    return await verifyImmutableConversation(harness.baseUrl);
  }
  if (caseId === 'TC-SI-031') {
    return await verifyUncertainRecovery(harness);
  }
  if (caseId === 'TC-SI-041') {
    return await verifyConversationShare(harness.baseUrl);
  }

  const accepted = await submitCandidateRequest({ baseUrl: harness.baseUrl, inputText: `fixed-prompt-${caseId}` });
  const stream = await readCandidateStream(harness.baseUrl, accepted);
  const conversation = await readConversationRaw(harness.baseUrl, accepted.sessionId);
  if (caseId === 'TC-SI-018') {
    expect(stream).toContain('large-content-tail-marker');
    expect(conversation).toContain('large-content-tail-marker');
    return { largeContentStreamed: true, lazyHistoryReadback: true };
  }
  if (caseId === 'TC-SI-020') {
    expect(stream).toContain('REQUEST_FAILED');
    expect(stream).not.toContain('CAPABILITY_STARTED');
    expect(stream).not.toContain('CAPABILITY_COMPLETED');
    return { disabledCapabilityRejected: true, noCapabilityCompletion: true };
  }
  if (caseId === 'TC-SI-036') {
    expect(stream).toContain('REQUEST_COMPLETED');
    const logCount = await countFiles(restrictedDiagnosticRoot, '.jsonl');
    expect(logCount).toBeGreaterThan(0);
    return { extensionHookPathCompleted: true, governedDiagnosticArtifact: true };
  }
  if (caseId === 'TC-SI-037') {
    expect(stream).toContain('add_memory');
    const second = await submitCandidateRequest({ baseUrl: harness.baseUrl, sessionId: accepted.sessionId, inputText: 'recall BGP peer' });
    const secondStream = await readCandidateStream(harness.baseUrl, second);
    expect(secondStream).toContain('search_memory');
    expect(await readConversationRaw(harness.baseUrl, accepted.sessionId)).toContain('memory-recalled');
    return { memoryStored: true, laterRequestRecalled: true };
  }
  if (caseId === 'TC-SI-038') {
    expect(stream).toContain('ToolSearch');
    expect(stream).toContain('Skill');
    expect(conversation).toContain('status');
    expect(conversation).toContain('loaded');
    return { deferredSkillDiscovered: true, targetedSkillLoaded: true };
  }
  if (caseId === 'TC-SI-040') {
    expect(stream).toContain('workflow-finished');
    expect(stream).toContain('REQUEST_COMPLETED');
    expect(conversation).toContain('workflow-finished');
    return { workflowResolved: true, workflowExecuted: true };
  }
  throw new Error(`unhandled-fixed-case-${caseId}`);
}

async function verifyImmutableConversation(baseUrl: string): Promise<Record<string, boolean>> {
  const accepted = await submitCandidateRequest({ baseUrl, inputText: 'fixed-prompt-TC-SI-021' });
  await readCandidateStream(baseUrl, accepted);
  const before = await readConversationRaw(baseUrl, accepted.sessionId);
  for (const method of ['PUT', 'PATCH', 'DELETE']) {
    const response = await fetch(`${baseUrl}/api/v1/sessions/${accepted.sessionId}/conversation`, { method });
    expect([400, 404, 405]).toContain(response.status);
  }
  expect(await readConversationRaw(baseUrl, accepted.sessionId)).toBe(before);
  return { factsImmutable: true, mutationRoutesRejected: true };
}

async function verifyUncertainRecovery(harness: Awaited<ReturnType<typeof startCandidateHarness>>): Promise<Record<string, boolean | number>> {
  const accepted = await submitCandidateRequest({ baseUrl: harness.baseUrl, inputText: 'fixed-prompt-TC-SI-031' });
  await waitForFile(harness.runtimeRoot, 'recovery-side-effect.txt');
  await harness.stop();
  await harness.restart();
  const content = await readWorkspaceFile(harness.runtimeRoot, 'recovery-side-effect.txt');
  expect(content.trim().split(/\r?\n/u)).toHaveLength(1);
  const replay = await readCandidateStream(harness.baseUrl, accepted);
  expect(replay.match(/event: CAPABILITY_STARTED/gu) ?? []).toHaveLength(1);
  return {
    sideEffectCount: 1,
    nonIdempotentCapabilityNotReplayed: true,
    recoveryTerminalObserved: /event: REQUEST_(?:COMPLETED|FAILED|CANCELED)/u.test(replay),
  };
}

async function verifyConversationShare(baseUrl: string): Promise<Record<string, boolean>> {
  const accepted = await submitCandidateRequest({ baseUrl, inputText: 'fixed-prompt-TC-SI-041' });
  await readCandidateStream(baseUrl, accepted);
  const created = await fetch(`${baseUrl}/api/v1/sessions/${accepted.sessionId}/shares`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ runIds: [accepted.runId], originUrl: baseUrl, expiresIn: 'permanent', allowedOps: null }),
  });
  expect(created.status).toBe(200);
  const share = (await created.json()) as { shareId: string };
  const shared = await fetch(`${baseUrl}/api/v1/shares/${share.shareId}/conversation`);
  expect(shared.status).toBe(200);
  const body = await shared.text();
  expect(body).toContain('fixed-prompt-TC-SI-041');
  expect(body).toContain('fixed-final-TC-SI-041');
  return { shareCreated: true, scopedConversationRead: true };
}

function turns(caseId: SystemIntegrationCaseId): readonly CandidateModelTurn[] {
  if (caseId === 'TC-SI-018') {
    return [{ content: `${'bounded-analysis '.repeat(2_000)}large-content-tail-marker` }];
  }
  if (caseId === 'TC-SI-020') {
    return [{ toolCalls: [{ toolCallId: 'disabled-read', toolName: 'Read', arguments: { file_path: 'missing.txt' } }] }];
  }
  if (caseId === 'TC-SI-031') {
    return [
      {
        toolCalls: [
          {
            toolCallId: 'uncertain-bash',
            toolName: 'Bash',
            arguments: { command: 'powershell -NoProfile -Command "Add-Content recovery-side-effect.txt executed"' },
          },
        ],
      },
      { content: 'must-not-commit-before-stop', delayMs: 30_000 },
    ];
  }
  if (caseId === 'TC-SI-037') {
    return [
      {
        toolCalls: [
          {
            toolCallId: 'memory-add',
            toolName: 'add_memory',
            arguments: {
              category: 'FACTUAL',
              content: { category: 'FACTUAL', subject: 'BGP peer', claim: '10.0.0.1' },
              briefIndex: 'BGP peer: 10.0.0.1',
              confidence: 0.7,
            },
          },
        ],
      },
      { content: 'memory-stored' },
      { toolCalls: [{ toolCallId: 'memory-search', toolName: 'search_memory', arguments: { queryText: 'BGP peer', limit: 5 } }] },
      { content: 'memory-recalled' },
    ];
  }
  if (caseId === 'TC-SI-038') {
    return [
      { toolCalls: [{ toolCallId: 'child-search', toolName: 'ToolSearch', arguments: { query: 'child-routing-skill', limit: 5 } }] },
      { toolCalls: [{ toolCallId: 'child-load', toolName: 'Skill', arguments: { name: 'child-routing-skill', args: { task: 'diagnose' } } }] },
      { content: 'child-skill-loaded' },
    ];
  }
  if (caseId === 'TC-SI-040') {
    return [
      {
        toolCalls: [{ toolCallId: 'workflow-run', toolName: 'Workflow', arguments: { recipeName: 'radio-diagnosis', inputText: 'diagnose radio' } }],
      },
      { content: 'workflow-finished' },
    ];
  }
  return [{ content: `fixed-final-${caseId}` }];
}

function selectMemoryTurn(body: unknown): CandidateModelTurn {
  const serialized = JSON.stringify(body);
  if (serialized.includes('recall BGP peer')) {
    return serialized.includes('memory-search')
      ? { content: 'memory-recalled' }
      : { toolCalls: [{ toolCallId: 'memory-search', toolName: 'search_memory', arguments: { queryText: 'BGP peer', limit: 5 } }] };
  }
  if (serialized.includes('fixed-prompt-TC-SI-037')) {
    return serialized.includes('memory-add')
      ? { content: 'memory-stored' }
      : {
          toolCalls: [
            {
              toolCallId: 'memory-add',
              toolName: 'add_memory',
              arguments: {
                category: 'FACTUAL',
                content: { category: 'FACTUAL', subject: 'BGP peer', claim: '10.0.0.1' },
                briefIndex: 'BGP peer: 10.0.0.1',
                confidence: 0.7,
              },
            },
          ],
        };
  }
  return { content: 'memory-session-title' };
}

async function disableRead(runtimeRoot: string): Promise<void> {
  await appendBinding(runtimeRoot, { capabilityId: 'Read', capabilityType: 'TOOL', providerId: 'builtin-tools', enabled: false });
}

async function addDeferredSkill(runtimeRoot: string): Promise<void> {
  const root = path.join(runtimeRoot, 'agents', 'default-agent', 'skills', 'child-routing-skill');
  await mkdir(root, { recursive: true });
  await writeFile(
    path.join(root, 'SKILL.md'),
    [
      '---',
      'name: child-routing-skill',
      'description: Diagnose child radio routing.',
      'context: inline',
      'user-invocable: true',
      'model-invocable: false',
      '---',
      '',
      'CHILD_SKILL_BODY_MARKER',
    ].join('\n'),
    'utf8',
  );
  await appendBinding(runtimeRoot, {
    capabilityId: 'child-routing-skill',
    capabilityType: 'SKILL',
    providerId: 'local-skills-agent-owned',
    enabled: true,
  });
}

async function addWorkflowRecipe(runtimeRoot: string): Promise<void> {
  const root = path.join(runtimeRoot, 'agents', 'default-agent', 'recipes');
  await mkdir(root, { recursive: true });
  await writeFile(
    path.join(root, 'radio-diagnosis.yaml'),
    JSON.stringify(
      {
        name: 'radio-diagnosis',
        version: 'v1',
        description: 'Radio diagnosis.',
        nodes: { start: { type: 'start-event', next: { end: { condition: '' } } }, end: { type: 'end-event' } },
      },
      null,
      2,
    ),
    'utf8',
  );
}

async function appendBinding(runtimeRoot: string, binding: Record<string, unknown>): Promise<void> {
  const file = path.join(runtimeRoot, 'agents', 'default-agent', 'agent.yaml');
  const agent = JSON.parse(await readFile(file, 'utf8')) as Record<string, unknown>;
  agent.capabilityBindings = [...(Array.isArray(agent.capabilityBindings) ? agent.capabilityBindings : []), binding];
  await writeFile(file, `${JSON.stringify(agent, null, 2)}\n`, 'utf8');
}

async function readConversationRaw(baseUrl: string, sessionId: string): Promise<string> {
  const response = await fetch(`${baseUrl}/api/v1/sessions/${sessionId}/conversation?limit=100&includeCapabilityResults=true`);
  expect(response.status).toBe(200);
  return await response.text();
}

async function waitForFile(runtimeRoot: string, suffix: string): Promise<void> {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    if ((await findFiles(runtimeRoot, suffix)).length === 1) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error('recovery-side-effect-timeout');
}

async function readWorkspaceFile(runtimeRoot: string, suffix: string): Promise<string> {
  const files = await findFiles(path.join(runtimeRoot, 'workspaces'), suffix);
  expect(files).toHaveLength(1);
  return await readFile(files[0]!, 'utf8');
}

async function findFiles(root: string, suffix: string): Promise<string[]> {
  const entries = await readdir(root, { recursive: true, withFileTypes: true }).catch(() => []);
  return entries.filter((entry) => entry.isFile() && entry.name.endsWith(suffix)).map((entry) => path.join(entry.parentPath, entry.name));
}

async function countFiles(root: string, suffix: string): Promise<number> {
  return (await findFiles(root, suffix)).length;
}
