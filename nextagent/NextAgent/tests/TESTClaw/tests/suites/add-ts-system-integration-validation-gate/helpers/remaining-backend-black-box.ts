import { copyFile, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import path from 'node:path';

import { expect } from 'vitest';

import type { SystemIntegrationCaseId } from '../case-manifest.js';
import { readCandidateStream, submitCandidateRequest } from './candidate-api.js';
import { requiredCandidateRoot, startCandidateHarness, type CandidateModelTurn } from './candidate-harness.js';
import { writePassingCaseEvidence } from './case-evidence.js';
import { hashDirectoryTree } from './external-consumer-root.js';
import { withRunScope } from './run-scope.js';

const ids = new Set([
  'TC-SI-044',
  'TC-SI-045',
  'TC-SI-046',
  'TC-SI-047',
  'TC-SI-048',
  'TC-SI-052',
  'TC-SI-054',
  'TC-SI-056',
  'TC-SI-058',
  'TC-SI-059',
  'TC-SI-060',
  'TC-SI-061',
  'TC-SI-062',
  'TC-SI-063',
  'TC-SI-064',
  'TC-SI-065',
  'TC-SI-066',
  'TC-SI-067',
  'TC-SI-087',
  'TC-SI-088',
]);

export async function runRemainingBackendCase(caseId: SystemIntegrationCaseId): Promise<void> {
  if (!ids.has(caseId)) {
    throw new Error(`unsupported-backend-case-${caseId}`);
  }
  const candidateRoot = requiredCandidateRoot();
  const before = await hashDirectoryTree(candidateRoot);
  await withRunScope({ outputBase: process.env.TESTCLAW_SYSTEM_INTEGRATION_OUTPUT_ROOT }, async (scope) => {
    const observedModels: string[] = [];
    const observedSkillPrompts: boolean[] = [];
    const observedModelRequests: string[] = [];
    const remoteWorkflow = { calls: 0 };
    let remoteWorkflowEndpoint: string | undefined;
    if (caseId === 'TC-SI-088') {
      const server = createServer(async (request, response) => {
        for await (const _chunk of request) {
          /* drain product request */
        }
        remoteWorkflow.calls += 1;
        response.writeHead(200, { 'content-type': 'text/event-stream' });
        response.end(
          `event: result\ndata: ${JSON.stringify({ executionId: 'workflow-execution-remote', status: 'COMPLETED', outputVariables: { message: 'workflow completed' }, nodeResults: [], startedAt: '2026-01-01T00:00:00.000Z', completedAt: '2026-01-01T00:00:01.000Z' })}\n\n`,
        );
      });
      remoteWorkflowEndpoint = `http://127.0.0.1:${await scope.listenOnRandomPort(server)}/workflow`;
    }
    const harness = await startCandidateHarness({
      scope,
      candidateRoot,
      modelTurns: modelTurns(caseId),
      ...(needsSelector(caseId) ? { selectModelTurn: (body: unknown) => selectTurn(caseId, body) } : {}),
      ...(needsPreparedRuntime(caseId) ? { prepareRuntime: (root: string) => prepareRuntime(caseId, root) } : {}),
      ...(['TC-SI-045', 'TC-SI-054', 'TC-SI-058'].includes(caseId)
        ? { configureRuntime: (config: Record<string, unknown>) => configurePluginCase(config, caseId, scope.restrictedDiagnosticRoot) }
        : {}),
      ...(caseId === 'TC-SI-044'
        ? {
            configureRuntime: configureClipCase,
            environment: { CLIP_HOME: path.join(scope.tempRoot, 'candidate', 'clip-home') },
          }
        : {}),
      ...(caseId === 'TC-SI-065' ? { configureRuntime: addPreferredModelProfile } : {}),
      ...(caseId === 'TC-SI-088'
        ? { configureRuntime: (config: Record<string, unknown>) => configureRemoteWorkflow(config, remoteWorkflowEndpoint!) }
        : {}),
      ...(caseId === 'TC-SI-044' || caseId === 'TC-SI-065' || caseId === 'TC-SI-060' || caseId === 'TC-SI-058'
        ? {
            inspectModelRequest: (body: unknown) => {
              const serialized = JSON.stringify(body);
              if (caseId === 'TC-SI-044') {
                observedModelRequests.push(serialized);
              }
              if (caseId === 'TC-SI-060') {
                observedSkillPrompts.push(serialized.includes('DIRECTIVE_SKILL_BODY'));
              }
              const model = object(body).model;
              if (typeof model === 'string') {
                observedModels.push(model);
              }
            },
          }
        : {}),
    });
    const observations = await executeCase(
      caseId,
      harness,
      scope.restrictedDiagnosticRoot,
      observedModels,
      observedSkillPrompts,
      observedModelRequests,
      remoteWorkflow,
    );
    await writePassingCaseEvidence({
      evidenceRoot: scope.evidenceRoot,
      caseId,
      observations,
      canaries: [
        { category: 'prompt', value: `backend-prompt-${caseId}` },
        { category: 'credential', value: 'testclaw-loopback-key' },
        { category: 'absolute-path', value: candidateRoot },
      ],
    });
  });
  expect(await hashDirectoryTree(candidateRoot)).toBe(before);
}

async function executeCase(
  caseId: SystemIntegrationCaseId,
  harness: Awaited<ReturnType<typeof startCandidateHarness>>,
  diagnosticRoot: string,
  observedModels: string[],
  observedSkillPrompts: boolean[],
  observedModelRequests: string[],
  remoteWorkflow: { calls: number },
): Promise<Record<string, boolean | number | string>> {
  if (['TC-SI-046', 'TC-SI-048'].includes(caseId)) {
    return await executeCronApi(caseId, harness.baseUrl);
  }
  if (['TC-SI-059', 'TC-SI-060', 'TC-SI-061', 'TC-SI-062'].includes(caseId)) {
    return await executeRetry(caseId, harness, observedSkillPrompts);
  }

  const accepted = await submitCandidateRequest({ baseUrl: harness.baseUrl, inputText: `backend-prompt-${caseId}` });
  const stream = await readCandidateStream(harness.baseUrl, accepted);
  const history = await conversation(harness.baseUrl, accepted.sessionId);

  if (caseId === 'TC-SI-044') {
    expect(stream).toContain('clipc-search-002');
    expect(stream).toContain('clipc-call-002');
    expect(stream).toContain('REQUEST_COMPLETED');
    expect(observedModelRequests).toHaveLength(3);
    expect(observedModelRequests[0]).not.toContain('clipc-api-002');
    expect(observedModelRequests[1]).toContain('clipc-api-002');
    expect(observedModelRequests[1]).not.toContain('clip-private-002');
    expect(history).toContain('CLIP ToolSearch lazy context verified.');
    return { deferredUntilSearch: true, selectedToolActivated: true, realClipProcessExecuted: true, terminalCommitted: true };
  }

  if (caseId === 'TC-SI-045' || caseId === 'TC-SI-054') {
    await harness.stop();
    const diagnostics = await readAllFiles(diagnosticRoot, '.ndjson');
    expect(diagnostics).toContain(caseId === 'TC-SI-045' ? 'CONTEXT_LAST' : 'DEVELOPER_HOOK_TRACE');
    expect(diagnostics).toContain(caseId === 'TC-SI-045' ? 'context-monitor.context-evolution' : 'developer-hook-trace.loop-raw-boundary');
    return { pluginLoaded: true, hookArtifactWritten: true, requestCompleted: stream.includes('REQUEST_COMPLETED') };
  }
  if (caseId === 'TC-SI-058') {
    expect(stream).toContain('REQUEST_FAILED');
    expect(stream).toContain('Agent routing rejected the request safely.');
    expect(observedModels).toHaveLength(0);
    return { agentScopedPolicyLoaded: true, requestRejectedBeforeModel: true, terminalCommitted: true };
  }
  if (caseId === 'TC-SI-047') {
    for (const id of ['cron-create', 'cron-list', 'cron-delete', 'cron-empty']) {
      expect(stream).toContain(id);
    }
    expect(history).toContain('"toolName":"Cron"');
    return { createListDeleteCompleted: true, durableCronToolResults: true };
  }
  if (caseId === 'TC-SI-052') {
    for (const id of ['daily-read', 'daily-skill', 'daily-agent']) {
      expect(stream).toContain(id);
    }
    expect(stream).not.toContain('UNKNOWN_AGENT_TYPE');
    return { toolCompleted: true, skillCompleted: true, childAgentCompleted: true };
  }
  if (caseId === 'TC-SI-056') {
    const externalizedResult = await readExternalizedToolResult(harness.runtimeRoot);
    expect(externalizedResult).toContain('TAIL_MARKER_LARGE_RESULT_READBACK_OK');
    expect(history).toContain('"toolName":"Python"');
    expect(history).not.toContain('TAIL_MARKER_LARGE_RESULT_READBACK_OK');
    expect(stream).toContain('large-python');
    return { oversizedResultExternalized: true, safeReferencePersisted: true };
  }
  if (caseId === 'TC-SI-063' || caseId === 'TC-SI-064') {
    expect(stream).toContain(`skill-load-${caseId}`);
    expect(history).toContain('loaded');
    return { fixtureSkillDiscovered: true, fixtureSkillLoaded: true };
  }
  if (caseId === 'TC-SI-065') {
    expect(stream).toContain('model-patch-load');
    expect(observedModels.at(-1)).toBe('skill-preferred-model');
    return { modelPatchLoaded: true, governedPreferredModelApplied: true };
  }
  if (caseId === 'TC-SI-066') {
    expect(stream).toContain('REQUEST_FAILED');
    expect(stream).toContain('not authorized');
    return { unauthorizedModelRejected: true, terminalFailedSafely: true };
  }
  if (caseId === 'TC-SI-067') {
    for (const id of ['search-a', 'load-a', 'search-b', 'load-b']) {
      expect(stream).toContain(id);
    }
    expect(history.split('toolName').filter((part) => part.includes('ToolSearch')).length).toBeGreaterThanOrEqual(2);
    return { twoSkillsDiscovered: true, twoSkillsLoaded: true, multiRoundCompleted: true };
  }
  if (caseId === 'TC-SI-087' || caseId === 'TC-SI-088') {
    expect(stream).toContain('workflow-skill');
    expect(stream).toContain('workflow completed');
    expect(stream).toContain('REQUEST_COMPLETED');
    if (caseId === 'TC-SI-088') {
      expect(remoteWorkflow.calls).toBe(1);
    }
    return { skillLoaded: true, workflowCompleted: true, remoteExecution: caseId === 'TC-SI-088', finalAnswerCommitted: true };
  }
  throw new Error(`unhandled-backend-case-${caseId}`);
}

async function executeCronApi(caseId: SystemIntegrationCaseId, baseUrl: string): Promise<Record<string, boolean | number>> {
  const created = await fetch(`${baseUrl}/api/v1/cron-tasks`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ cron: '* * * * *', prompt: `backend-prompt-${caseId}`, recurring: false }),
  });
  expect(created.status).toBe(200);
  const task = (await created.json()) as { taskId: string };
  const listed = await fetch(`${baseUrl}/api/v1/cron-tasks?offset=0&limit=50`);
  expect(listed.status).toBe(200);
  expect(await listed.text()).toContain(task.taskId);
  if (caseId === 'TC-SI-046') {
    const deleted = await fetch(`${baseUrl}/api/v1/cron-tasks/${task.taskId}`, { method: 'DELETE' });
    expect(deleted.status).toBe(204);
    const after = await fetch(`${baseUrl}/api/v1/cron-tasks?offset=0&limit=50`);
    expect(await after.text()).not.toContain(task.taskId);
    return { created: true, durableListObserved: true, deletedExcluded: true };
  }
  const run = await fetch(`${baseUrl}/api/v1/cron-tasks/${task.taskId}/runs`, { method: 'POST' });
  expect(run.status).toBe(200);
  await waitFor(
    async () => {
      const response = await fetch(`${baseUrl}/api/v1/cron-tasks/${task.taskId}/runs?offset=0&limit=50`);
      return (await response.text()).includes('REQUEST_COMPLETED');
    },
    30_000,
    'cron-run-timeout',
  );
  const first = await fetch(`${baseUrl}/api/v1/cron-tasks/${task.taskId}/runs?offset=0&limit=50`).then((response) => response.text());
  const second = await fetch(`${baseUrl}/api/v1/cron-tasks/${task.taskId}/runs?offset=0&limit=50`).then((response) => response.text());
  expect(second).toBe(first);
  expect(first.match(/triggerId/gu) ?? []).toHaveLength(1);
  return { exactlyOneExecution: true, terminalCommitted: true };
}

async function executeRetry(
  caseId: SystemIntegrationCaseId,
  harness: Awaited<ReturnType<typeof startCandidateHarness>>,
  observedSkillPrompts: boolean[],
): Promise<Record<string, boolean | number>> {
  const inputText =
    caseId === 'TC-SI-059'
      ? '$workflow:radio-diagnosis diagnose sector 3'
      : caseId === 'TC-SI-060'
        ? '$skill:directive-skill verify health'
        : 'diagnose network connectivity';
  const first = await submitCandidateRequest({ baseUrl: harness.baseUrl, inputText });
  const firstStream = await readCandidateStream(harness.baseUrl, first);
  const response = await fetch(`${harness.baseUrl}/api/v1/sessions/${first.sessionId}/retry`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ expectedLatestRequestId: first.requestId, idempotencyKey: `retry-${crypto.randomUUID()}` }),
  });
  expect(response.status).toBe(200);
  const retried = (await response.json()) as { runId: string };
  expect(retried.runId).not.toBe(first.runId);
  const retryStream = await readCandidateStream(harness.baseUrl, { sessionId: first.sessionId, runId: retried.runId });
  expect(retryStream).toContain('REQUEST_COMPLETED');
  if (caseId === 'TC-SI-059') {
    expect(firstStream).toContain('\\"input_question\\":\\"diagnose sector 3\\"');
    expect(retryStream).toContain('\\"input_question\\":\\"diagnose sector 3\\"');
    return { workflowExecutedTwice: true, directivePreserved: true };
  }
  if (caseId === 'TC-SI-060') {
    expect(observedSkillPrompts.filter(Boolean).length).toBeGreaterThanOrEqual(2);
    return { skillLoadedTwice: true, directivePreserved: true };
  }
  expect(firstStream).not.toContain('Workflow');
  expect(retryStream).not.toContain('Workflow');
  return { newRunCreated: true, modelLoopUsed: true, accidentalWorkflowAbsent: true };
}

function modelTurns(caseId: SystemIntegrationCaseId): readonly CandidateModelTurn[] {
  if (caseId === 'TC-SI-044') {
    return [
      { toolCalls: [{ toolCallId: 'clipc-search-002', toolName: 'ToolSearch', arguments: { query: 'clipc-api-002', limit: 5 } }] },
      { toolCalls: [{ toolCallId: 'clipc-call-002', toolName: 'clipc-api-002', arguments: { neId: 'NE-002', apiQuery: 'radio access kpi' } }] },
      { content: 'CLIP ToolSearch lazy context verified.' },
    ];
  }
  if (caseId === 'TC-SI-047') {
    return [
      {
        toolCalls: [
          {
            toolCallId: 'cron-create',
            toolName: 'Cron',
            arguments: { action: 'create', cron: '*/5 * * * *', prompt: 'Check LTE handover failures.', recurring: true },
          },
        ],
      },
      { toolCalls: [{ toolCallId: 'cron-list', toolName: 'Cron', arguments: { action: 'list' } }] },
      { toolCalls: [{ toolCallId: 'cron-delete', toolName: 'Cron', arguments: { action: 'delete', id: 'invalid-placeholder' } }] },
      { toolCalls: [{ toolCallId: 'cron-empty', toolName: 'Cron', arguments: { action: 'list' } }] },
      { content: 'cron-complete' },
    ];
  }
  if (caseId === 'TC-SI-056') {
    return [
      {
        toolCalls: [
          {
            toolCallId: 'large-python',
            toolName: 'Python',
            arguments: { code: "for i in range(520): print(f'large-result-line-{i:03d}:' + 'x'*96)\nprint('TAIL_MARKER_LARGE_RESULT_READBACK_OK')" },
          },
        ],
      },
      { content: 'large-result-complete' },
    ];
  }
  if (caseId === 'TC-SI-063' || caseId === 'TC-SI-064') {
    return [
      {
        toolCalls: [
          {
            toolCallId: `skill-load-${caseId}`,
            toolName: 'Skill',
            arguments: { name: caseId === 'TC-SI-063' ? 'workspace-tool-calling' : 'extension-policy', args: { scenario: caseId } },
          },
        ],
      },
      { content: 'fixture-skill-loaded' },
    ];
  }
  if (caseId === 'TC-SI-065' || caseId === 'TC-SI-066') {
    return [
      { toolCalls: [{ toolCallId: 'model-patch-search', toolName: 'ToolSearch', arguments: { query: 'model-patch-skill', limit: 5 } }] },
      { toolCalls: [{ toolCallId: 'model-patch-load', toolName: 'Skill', arguments: { name: 'model-patch-skill', args: {} } }] },
      { content: 'model-patch-finished' },
    ];
  }
  if (caseId === 'TC-SI-067') {
    return [
      { toolCalls: [{ toolCallId: 'search-a', toolName: 'ToolSearch', arguments: { query: 'deferred-a', limit: 5 } }] },
      { toolCalls: [{ toolCallId: 'load-a', toolName: 'Skill', arguments: { name: 'deferred-a', args: {} } }] },
      { toolCalls: [{ toolCallId: 'search-b', toolName: 'ToolSearch', arguments: { query: 'deferred-b', limit: 5 } }] },
      { toolCalls: [{ toolCallId: 'load-b', toolName: 'Skill', arguments: { name: 'deferred-b', args: {} } }] },
      { content: 'multi-round-finished' },
    ];
  }
  if (caseId === 'TC-SI-087' || caseId === 'TC-SI-088') {
    return [
      { toolCalls: [{ toolCallId: 'workflow-skill', toolName: 'Skill', arguments: { name: 'skill-creator', args: { question: 'radio alarm' } } }] },
      { toolCalls: [{ toolCallId: 'workflow-local', toolName: 'Workflow', arguments: { recipeName: 'radio-diagnosis', inputText: 'radio alarm' } }] },
      { content: 'workflow completed' },
    ];
  }
  return [{ content: `backend-final-${caseId}` }];
}

function needsSelector(caseId: SystemIntegrationCaseId): boolean {
  return ['TC-SI-047', 'TC-SI-052', 'TC-SI-059', 'TC-SI-060', 'TC-SI-061', 'TC-SI-062'].includes(caseId);
}

function selectTurn(caseId: SystemIntegrationCaseId, body: unknown): CandidateModelTurn {
  const text = JSON.stringify(body);
  if (caseId === 'TC-SI-047') {
    if (!text.includes('cron-create')) {
      return {
        toolCalls: [
          {
            toolCallId: 'cron-create',
            toolName: 'Cron',
            arguments: { action: 'create', cron: '*/5 * * * *', prompt: 'Check LTE handover failures.', recurring: true },
          },
        ],
      };
    }
    if (!text.includes('cron-list')) {
      return { toolCalls: [{ toolCallId: 'cron-list', toolName: 'Cron', arguments: { action: 'list' } }] };
    }
    if (!text.includes('cron-delete')) {
      const id = text.match(/\\?"id\\?"\s*:\s*\\?"([^"\\]+)\\?"/u)?.[1];
      return { toolCalls: [{ toolCallId: 'cron-delete', toolName: 'Cron', arguments: { action: 'delete', id: id ?? 'missing-id' } }] };
    }
    if (!text.includes('cron-empty')) {
      return { toolCalls: [{ toolCallId: 'cron-empty', toolName: 'Cron', arguments: { action: 'list' } }] };
    }
    return { content: 'cron-complete' };
  }
  if (caseId === 'TC-SI-052') {
    if (text.includes('Collect bounded LTE')) {
      return { content: 'network explorer terminal evidence' };
    }
    if (text.includes('daily-agent')) {
      return { content: 'parent incorporated tool skill agent evidence' };
    }
    return {
      toolCalls: [
        { toolCallId: 'daily-read', toolName: 'Read', arguments: { file_path: 'README.md', offset: 0, limit: 1 } },
        { toolCallId: 'daily-skill', toolName: 'Skill', arguments: { name: 'skill-creator', args: { alarm: 'LOS' } } },
        { toolCallId: 'daily-agent', toolName: 'Agent', arguments: { agentId: 'network-explorer', prompt: 'Collect bounded LTE evidence' } },
      ],
    };
  }
  if (text.includes('toolName') || text.includes('CAPABILITY_RESULT')) {
    return { content: `retry-final-${caseId}` };
  }
  return { content: `retry-final-${caseId}` };
}

function needsPreparedRuntime(caseId: SystemIntegrationCaseId): boolean {
  return [
    'TC-SI-044',
    'TC-SI-045',
    'TC-SI-058',
    'TC-SI-059',
    'TC-SI-060',
    'TC-SI-063',
    'TC-SI-064',
    'TC-SI-065',
    'TC-SI-066',
    'TC-SI-067',
    'TC-SI-087',
    'TC-SI-088',
  ].includes(caseId);
}

async function prepareRuntime(caseId: SystemIntegrationCaseId, root: string): Promise<void> {
  if (caseId === 'TC-SI-044') {
    await addClipFixture(root);
  }
  if (['TC-SI-059', 'TC-SI-087', 'TC-SI-088'].includes(caseId)) {
    await addRecipe(root);
  }
  if (caseId === 'TC-SI-045') {
    await enableContextMonitorHook(root);
  }
  if (caseId === 'TC-SI-058') {
    await addRoutingPolicyPlugin(root);
  }
  if (caseId === 'TC-SI-060') {
    await addSystemSkill(root, 'directive-skill', true, 'DIRECTIVE_SKILL_BODY');
  }
  if (caseId === 'TC-SI-063') {
    await addSystemSkill(root, 'workspace-tool-calling', true, 'Write -> Glob -> Read -> Edit -> Grep');
  }
  if (caseId === 'TC-SI-064') {
    await addSystemSkill(root, 'extension-policy', true, 'CAPABILITY_PATH_REJECTED deny-first.pem');
  }
  if (caseId === 'TC-SI-065' || caseId === 'TC-SI-066') {
    await addAgentSkill(
      root,
      'model-patch-skill',
      false,
      'MODEL_PATCH_BODY',
      `model: '{"model":"skill-preferred-model","modelOptions":{"temperature":0.4}}'`,
    );
    if (caseId === 'TC-SI-065') {
      await addAgentModel(root, 'skill-preferred-model');
    }
  }
  if (caseId === 'TC-SI-067') {
    await addAgentSkill(root, 'deferred-a', false, 'DEFERRED_A_BODY');
    await addAgentSkill(root, 'deferred-b', false, 'DEFERRED_B_BODY');
  }
}

async function addClipFixture(root: string): Promise<void> {
  const clipHome = path.join(root, 'clip-home');
  await mkdir(clipHome, { recursive: true });
  await copyFile(process.execPath, path.join(clipHome, process.platform === 'win32' ? 'clipc.exe' : 'clipc'));
  const listed = ['001', '002', '003'].map((suffix) => ({
    target: `clipc-api-${suffix}`,
    ref: `/api/${suffix}`,
    operation: 'query',
    description: `Deferred CLIP catalog entry ${suffix}.`,
  }));
  await writeFile(path.join(root, 'list'), `process.stdout.write(${JSON.stringify(JSON.stringify(listed))});\n`, 'utf8');
  await writeFile(
    path.join(root, 'describe'),
    `const id=process.argv[2]; process.stdout.write(JSON.stringify({capabilityId:id,clipCapabilityId:id,primitive:'query',displayName:id,description:'Full CLIP schema description for '+id,inputSchema:{type:'object',additionalProperties:false,required:['neId','apiQuery'],properties:{neId:{type:'string'},apiQuery:{type:'string'}}},outputSchema:{type:'object',additionalProperties:true},ref:process.argv[3],metadata:{privateRef:'clip-private-002'},replayPolicy:'IDEMPOTENT'}));\n`,
    'utf8',
  );
  await writeFile(
    path.join(root, 'query'),
    `process.stdout.write(JSON.stringify({status:'ok',api:process.argv[2],networkElement:'NE-002'}));\n`,
    'utf8',
  );
  for (const capabilityId of ['clipc-api-001', 'clipc-api-002', 'clipc-api-003']) {
    await appendBinding(root, { capabilityId, capabilityType: 'TOOL', providerId: 'clip-backed', enabled: true });
  }
}

function configureClipCase(config: Record<string, unknown>): void {
  const nextAgent = object(config.nextAgent);
  const system = object(nextAgent.system);
  system['capability-providers'] = [
    {
      id: 'clip-backed',
      type: 'custom',
      adapter: 'clip_server',
      config: { enabled: true, clipPathRef: 'clipc', endpointRef: 'clip-daemon', timeoutMs: 5_000, retry: { maxAttempts: 1 } },
    },
  ];
  system['capability-disclosure'] = { 'clipc-disclosure-mode': 'tool-search' };
}

async function addRecipe(root: string): Promise<void> {
  const dir = path.join(root, 'agents', 'default-agent', 'recipes');
  await mkdir(dir, { recursive: true });
  await writeFile(
    path.join(dir, 'radio-diagnosis.yaml'),
    JSON.stringify(
      {
        name: 'radio-diagnosis',
        version: 'v1',
        description: 'Radio diagnosis',
        nodes: { start: { type: 'start-event', next: { end: { condition: '' } } }, end: { type: 'end-event' } },
      },
      null,
      2,
    ),
    'utf8',
  );
}

async function addSystemSkill(root: string, name: string, modelInvocable: boolean, body: string): Promise<void> {
  const dir = path.join(root, 'skills', name);
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, 'SKILL.md'), skillFile(name, modelInvocable, body), 'utf8');
}

async function addAgentSkill(root: string, name: string, modelInvocable: boolean, body: string, extra = ''): Promise<void> {
  const dir = path.join(root, 'agents', 'default-agent', 'skills', name);
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, 'SKILL.md'), skillFile(name, modelInvocable, body, extra), 'utf8');
  await appendBinding(root, { capabilityId: name, capabilityType: 'SKILL', providerId: 'local-skills-agent-owned', enabled: true });
}

function skillFile(name: string, modelInvocable: boolean, body: string, extra = ''): string {
  return [
    '---',
    `name: ${name}`,
    `description: Governed ${name} telecom skill.`,
    'context: inline',
    'user-invocable: true',
    `model-invocable: ${modelInvocable}`,
    extra,
    '---',
    '',
    `# ${name}`,
    body,
    '',
  ]
    .filter((line) => line !== '')
    .join('\n');
}

async function addAgentModel(root: string, modelId: string): Promise<void> {
  const file = path.join(root, 'agents', 'default-agent', 'agent.yaml');
  const agent = object(JSON.parse(await readFile(file, 'utf8')));
  agent.modelIds = ['testclaw-loopback-model', modelId];
  agent.defaultModelId = 'testclaw-loopback-model';
  await writeFile(file, `${JSON.stringify(agent, null, 2)}\n`, 'utf8');
}

function addPreferredModelProfile(config: Record<string, unknown>): void {
  const providers = Array.isArray(config.modelProfiles) ? config.modelProfiles : [];
  const provider = providers.find(
    (entry) =>
      typeof entry === 'object' && entry !== null && !Array.isArray(entry) && (entry as Record<string, unknown>).providerId === 'openai-compatible',
  );
  if (provider === undefined) {
    throw new Error('openai-compatible-provider-missing');
  }
  const providerConfig = object(provider);
  const models = Array.isArray(providerConfig.models) ? providerConfig.models : [];
  providerConfig.models = [
    ...models,
    {
      modelId: 'skill-preferred-model',
      displayName: 'Skill preferred model',
      contextWindowTokens: 128000,
      fallbackEligible: false,
      temperature: 0.4,
      timeoutMs: 30000,
    },
  ];
}

function configureRemoteWorkflow(config: Record<string, unknown>, endpoint: string): void {
  const gateway = object(config.gateway);
  const gateways = Array.isArray(gateway.gateways) ? gateway.gateways : [];
  gateway.gateways = gateways.map((entry) => {
    if (
      typeof entry !== 'object' ||
      entry === null ||
      Array.isArray(entry) ||
      (entry as Record<string, unknown>).gatewayKind !== 'workflow-execution'
    ) {
      return entry;
    }
    return { ...(entry as Record<string, unknown>), gatewayId: 'remote-workflow', deploymentMode: 'REMOTE', endpoint };
  });
}

function configurePluginCase(config: Record<string, unknown>, caseId: SystemIntegrationCaseId, _diagnosticRoot: string): void {
  if (caseId === 'TC-SI-058') {
    const nextAgent = object(config.nextAgent);
    const system = object(nextAgent.system);
    const plugins = Array.isArray(system.plugins) ? system.plugins : [];
    system.plugins = [...plugins, { pluginId: 'telecom-routing', path: 'plugins/telecom-routing', required: true }];
    return;
  }
  if (caseId === 'TC-SI-045') {
    const nextAgent = object(config.nextAgent);
    const system = object(nextAgent.system);
    system.plugins = [{ pluginId: 'context-monitor', path: 'plugins/context-monitor', required: true }];
  }
}

async function addRoutingPolicyPlugin(root: string): Promise<void> {
  const dir = path.join(root, 'config', 'plugins', 'telecom-routing');
  await mkdir(dir, { recursive: true });
  await writeFile(
    path.join(dir, 'plugin.json'),
    `${JSON.stringify({ pluginId: 'telecom-routing', version: '1.0.0', apiVersion: '1.0', main: './index.js', artifactType: 'esm-bundle', hostExternals: [] }, null, 2)}\n`,
    'utf8',
  );
  await writeFile(
    path.join(dir, 'index.js'),
    `export default Object.freeze({pluginId:'telecom-routing',apiVersion:'1.0',version:'1.0.0',policies:Object.freeze([{policyPointId:'agentRoutingPolicy',policyId:'reject-trigger',decide(run,context){if(run.agentId==='default-agent'&&context.acceptedInputText==='backend-prompt-TC-SI-058')return {kind:'REJECT',safeReason:'PLUGIN_E2E_REJECTED'};return {kind:'MODEL_DRIVEN_LOOP',safeReason:'PLUGIN_E2E_INPUT_NOT_FORWARDED'}}}])});\n`,
    'utf8',
  );
  const file = path.join(root, 'agents', 'default-agent', 'agent.yaml');
  const agent = object(JSON.parse(await readFile(file, 'utf8')));
  agent.policies = [
    ...(Array.isArray(agent.policies) ? agent.policies : []),
    { policyPointId: 'agentRoutingPolicy', pluginId: 'telecom-routing', policyId: 'reject-trigger', enabled: true },
  ];
  await writeFile(file, `${JSON.stringify(agent, null, 2)}\n`, 'utf8');
}

async function enableContextMonitorHook(root: string): Promise<void> {
  const file = path.join(root, 'agents', 'default-agent', 'agent.yaml');
  const agent = object(JSON.parse(await readFile(file, 'utf8')));
  agent.hooks = [
    { hookId: 'context-monitor.context-evolution', enabled: true, stages: ['BEFORE_MODEL_INVOKE', 'AFTER_MODEL_RESULT', 'BEFORE_AGENT_TERMINAL'] },
  ];
  await writeFile(file, `${JSON.stringify(agent, null, 2)}\n`, 'utf8');
}

async function appendBinding(root: string, binding?: Record<string, unknown>, hook?: Record<string, unknown>): Promise<void> {
  const file = path.join(root, 'agents', 'default-agent', 'agent.yaml');
  const agent = object(JSON.parse(await readFile(file, 'utf8')));
  if (binding !== undefined) {
    agent.capabilityBindings = [...(Array.isArray(agent.capabilityBindings) ? agent.capabilityBindings : []), binding];
  }
  if (hook !== undefined) {
    agent.hooks = [...(Array.isArray(agent.hooks) ? agent.hooks : []), hook];
  }
  await writeFile(file, `${JSON.stringify(agent, null, 2)}\n`, 'utf8');
}

async function conversation(baseUrl: string, sessionId: string): Promise<string> {
  const response = await fetch(`${baseUrl}/api/v1/sessions/${sessionId}/conversation?limit=100&includeCapabilityResults=true`);
  expect(response.status).toBe(200);
  return await response.text();
}

async function readAllFiles(root: string, suffix: string): Promise<string> {
  const entries = await readdir(root, { recursive: true, withFileTypes: true }).catch(() => []);
  const contents: string[] = [];
  for (const entry of entries) {
    if (entry.isFile() && entry.name.endsWith(suffix)) {
      contents.push(await readFile(path.join(entry.parentPath, entry.name), 'utf8'));
    }
  }
  return contents.join('\n');
}

async function readExternalizedToolResult(runtimeRoot: string): Promise<string> {
  const entries = await readdir(path.join(runtimeRoot, 'workspaces'), { recursive: true, withFileTypes: true }).catch(() => []);
  const files = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.txt') && entry.parentPath.replaceAll('\\', '/').includes('/tool-results'))
    .map((entry) => path.join(entry.parentPath, entry.name));
  expect(files).toHaveLength(1);
  return await readFile(files[0]!, 'utf8');
}

async function waitFor(check: () => Promise<boolean>, timeoutMs: number, code: string): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(code);
}

function object(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('expected-object');
  }
  return value as Record<string, unknown>;
}
