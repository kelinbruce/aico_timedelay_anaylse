import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { expect } from 'vitest';

import type { SystemIntegrationCaseId } from '../case-manifest.js';
import { parseCandidateSseEvents, readCandidateConversation, readCandidateStream, submitCandidateRequest } from './candidate-api.js';
import { requiredCandidateRoot, startCandidateHarness, type CandidateModelTurn } from './candidate-harness.js';
import { writePassingCaseEvidence } from './case-evidence.js';
import { hashDirectoryTree } from './external-consumer-root.js';
import { withRunScope } from './run-scope.js';

export async function runCapabilityCase(caseId: SystemIntegrationCaseId): Promise<void> {
  const candidateRoot = requiredCandidateRoot();
  const hashBefore = await hashDirectoryTree(candidateRoot);
  await withRunScope({ outputBase: process.env.TESTCLAW_SYSTEM_INTEGRATION_OUTPUT_ROOT }, async (scope) => {
    const observedToolResultProjections: string[] = [];
    const harness = await startCandidateHarness({
      scope,
      candidateRoot,
      modelTurns: turnsFor(caseId),
      ...(caseId === 'TC-SI-085' ? { prepareRuntime: addDeferredSkill } : {}),
      ...(caseId === 'TC-SI-086' ? { prepareRuntime: disableReadTool } : {}),
      ...(caseId === 'TC-SI-085' || caseId === 'TC-SI-086' ? { configureRuntime: enableToolSearchDisclosure } : {}),
      ...(caseId === 'TC-SI-085'
        ? { inspectModelRequest: (body: unknown) => observedToolResultProjections.push(toolResultProjection(body, 'tool-search-safe')) }
        : {}),
    });
    const accepted = await submitCandidateRequest({ baseUrl: harness.baseUrl, inputText: `capability-prompt-${caseId}` });
    const observations =
      caseId === 'TC-SI-039' || caseId === 'TC-SI-053'
        ? await completePendingInput(harness.baseUrl, accepted.sessionId, accepted.runId)
        : await verifyCompletedCapabilityCase(caseId, harness.baseUrl, harness.runtimeRoot, accepted, observedToolResultProjections);
    await writePassingCaseEvidence({
      evidenceRoot: scope.evidenceRoot,
      caseId,
      observations,
      canaries: [
        { category: 'prompt', value: `capability-prompt-${caseId}` },
        { category: 'model-output', value: `capability-final-${caseId}` },
        { category: 'credential', value: 'testclaw-loopback-key' },
        { category: 'absolute-path', value: candidateRoot },
      ],
    });
  });
  expect(await hashDirectoryTree(candidateRoot)).toBe(hashBefore);
}

async function verifyCompletedCapabilityCase(
  caseId: SystemIntegrationCaseId,
  baseUrl: string,
  runtimeRoot: string,
  accepted: { readonly sessionId: string; readonly runId: string },
  observedToolResultProjections: readonly string[],
): Promise<Readonly<Record<string, boolean | number | string>>> {
  const stream = await readCandidateStream(baseUrl, accepted);
  expect(stream).toContain('event: REQUEST_COMPLETED');
  const events = parseCandidateSseEvents(stream);
  const completedCount = events.filter((event) => event.eventType === 'CAPABILITY_COMPLETED').length;
  const history = await readCandidateConversationWithCapabilities(baseUrl, accepted.sessionId);

  if (caseId === 'TC-SI-019') {
    expect(completedCount).toBe(1);
    expect(history).toContain('"toolName":"Write"');
    expect(history).toContain('capability-final-TC-SI-019');
    expect(await readWorkspaceFile(runtimeRoot, 'loop-output.txt')).toBe('loop-completed');
    return { toolLoopCompleted: true, capabilityResultPersisted: true, finalAnswerPersisted: true };
  }
  if (caseId === 'TC-SI-026') {
    expect(stream).toContain('sandbox-bypass-call');
    expect(await readWorkspaceFile(runtimeRoot, 'sandbox-bypass.txt')).toContain('sandbox-bypass-created');
    expect(await fileExists(path.join(runtimeRoot, 'sandbox-bypass.txt'))).toBe(false);
    return { dynamicExecutionGoverned: true, workspaceConfinementVerified: true, packageRootBypassAbsent: true };
  }
  if (caseId === 'TC-SI-055') {
    expect(completedCount).toBe(3);
    expect(await readWorkspaceFile(runtimeRoot, 'edit-grep.txt')).toContain('Severity=critical');
    expect(stream).toContain('edit-grep-grep');
    return { writeExecuted: true, editExecuted: true, grepExecuted: true };
  }
  if (caseId === 'TC-SI-085') {
    expect(stream).toContain('tool-search-safe');
    expect(observedToolResultProjections).toHaveLength(2);
    expect(observedToolResultProjections[0]).not.toContain('deferred-network-check');
    expect(observedToolResultProjections[1]).toContain('deferred-network-check');
    for (const projection of [history, observedToolResultProjections[1]!]) {
      expect(projection).not.toContain('DEFERRED_SKILL_BODY_CANARY');
      expect(projection).not.toContain('inputSchema');
      expect(projection).not.toContain('outputSchema');
      expect(projection).not.toContain('providerId');
    }
    return { safeMetadataReturned: true, schemasHidden: true, providerIdentityHidden: true };
  }
  if (caseId === 'TC-SI-086') {
    expect(stream).toContain('tool-search-disabled');
    expect(history).not.toContain('"capability_id":"Read"');
    return { disabledToolHidden: true, disabledToolNotInvoked: true };
  }
  if (caseId === 'TC-SI-089') {
    expect(completedCount).toBe(5);
    expect(await readWorkspaceFile(runtimeRoot, 'diagnostics/site-a/alarm.txt')).toContain('Severity=critical');
    for (const id of ['workspace-write', 'workspace-glob', 'workspace-read', 'workspace-edit', 'workspace-grep']) {
      expect(stream).toContain(id);
    }
    return { workspaceToolCount: completedCount, finalFileVerified: true };
  }
  if (caseId === 'TC-SI-090') {
    expect(completedCount).toBe(1);
    expect(await readWorkspaceFile(runtimeRoot, 'write-product.txt')).toBe('write-product-verified');
    return { writeCapabilityCompleted: true, workspaceFileCreated: true };
  }
  throw new Error(`unsupported-completed-capability-case-${caseId}`);
}

async function completePendingInput(baseUrl: string, sessionId: string, runId: string): Promise<Readonly<Record<string, boolean | number | string>>> {
  let pendingInputId: string | undefined;
  const pendingEvent = await readSseUntilEvent(
    `${baseUrl}/api/v1/sessions/${sessionId}/stream?lastSeenSequence=0&runId=${runId}`,
    'USER_INPUT_REQUIRED',
  );
  pendingInputId = findStringProperty(pendingEvent, 'pendingInputId');
  expect(pendingInputId).toBeDefined();
  const answer = await fetch(`${baseUrl}/api/v1/sessions/${sessionId}/pending-inputs/${pendingInputId}/answer`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ answers: [['north']] }),
  });
  expect(answer.status).toBe(200);
  let stream = '';
  await waitFor(
    async () => {
      stream = await readCandidateStream(baseUrl, { sessionId, runId });
      return stream.includes('event: REQUEST_COMPLETED');
    },
    30_000,
    'pending-input-completion-timeout',
  );
  expect(stream).toContain('event: USER_INPUT_REQUIRED');
  expect(stream).toContain('event: USER_INPUT_RECEIVED');
  return { pendingInputObserved: true, answerAccepted: true, resumedToCompleted: true };
}

function turnsFor(caseId: SystemIntegrationCaseId): readonly CandidateModelTurn[] {
  const final = { content: `capability-final-${caseId}` };
  if (caseId === 'TC-SI-019') {
    return [
      {
        toolCalls: [{ toolCallId: 'complete-loop-write', toolName: 'Write', arguments: { file_path: 'loop-output.txt', content: 'loop-completed' } }],
      },
      final,
    ];
  }
  if (caseId === 'TC-SI-026') {
    return [
      {
        toolCalls: [
          {
            toolCallId: 'sandbox-bypass-call',
            toolName: 'Bash',
            arguments: { command: 'powershell -NoProfile -Command "Set-Content sandbox-bypass.txt sandbox-bypass-created"' },
          },
        ],
      },
      final,
    ];
  }
  if (caseId === 'TC-SI-039' || caseId === 'TC-SI-053') {
    return [
      {
        toolCalls: [
          {
            toolCallId: `pending-${caseId}`,
            toolName: 'AskUserQuestion',
            arguments: {
              questions: [
                {
                  prompt: 'Which region?',
                  options: [
                    { value: 'north', label: 'North' },
                    { value: 'south', label: 'South' },
                  ],
                },
              ],
            },
          },
        ],
      },
      final,
    ];
  }
  if (caseId === 'TC-SI-055') {
    return [
      {
        toolCalls: [
          {
            toolCallId: 'edit-grep-write',
            toolName: 'Write',
            arguments: { file_path: 'edit-grep.txt', content: 'Severity=minor\n' },
          },
        ],
      },
      {
        toolCalls: [
          {
            toolCallId: 'edit-grep-edit',
            toolName: 'Edit',
            arguments: { file_path: 'edit-grep.txt', old_string: 'Severity=minor', new_string: 'Severity=critical' },
          },
          {
            toolCallId: 'edit-grep-grep',
            toolName: 'Grep',
            arguments: { pattern: 'Severity=critical', path: '.', output_mode: 'content' },
          },
        ],
      },
      final,
    ];
  }
  if (caseId === 'TC-SI-085' || caseId === 'TC-SI-086') {
    return [
      {
        toolCalls: [
          {
            toolCallId: caseId === 'TC-SI-085' ? 'tool-search-safe' : 'tool-search-disabled',
            toolName: 'ToolSearch',
            arguments: { query: caseId === 'TC-SI-085' ? 'deferred-network-check' : 'Read', limit: 10 },
          },
        ],
      },
      final,
    ];
  }
  if (caseId === 'TC-SI-089') {
    return [
      {
        toolCalls: [
          {
            toolCallId: 'workspace-write',
            toolName: 'Write',
            arguments: { file_path: 'diagnostics/site-a/alarm.txt', content: 'Severity=minor\n' },
          },
        ],
      },
      {
        toolCalls: [
          { toolCallId: 'workspace-glob', toolName: 'Glob', arguments: { pattern: 'diagnostics/**/*.txt' } },
          {
            toolCallId: 'workspace-read',
            toolName: 'Read',
            arguments: { file_path: 'diagnostics/site-a/alarm.txt', offset: 0, limit: 10 },
          },
        ],
      },
      {
        toolCalls: [
          {
            toolCallId: 'workspace-edit',
            toolName: 'Edit',
            arguments: {
              file_path: 'diagnostics/site-a/alarm.txt',
              old_string: 'Severity=minor',
              new_string: 'Severity=critical',
            },
          },
          {
            toolCallId: 'workspace-grep',
            toolName: 'Grep',
            arguments: { pattern: 'Severity=critical', path: 'diagnostics', output_mode: 'content' },
          },
        ],
      },
      final,
    ];
  }
  if (caseId === 'TC-SI-090') {
    return [
      {
        toolCalls: [
          {
            toolCallId: 'write-product',
            toolName: 'Write',
            arguments: { file_path: 'write-product.txt', content: 'write-product-verified' },
          },
        ],
      },
      final,
    ];
  }
  throw new Error(`unsupported-capability-case-${caseId}`);
}

async function disableReadTool(runtimeRoot: string): Promise<void> {
  await setReadToolBinding(runtimeRoot, false);
}

async function addDeferredSkill(runtimeRoot: string): Promise<void> {
  const skillRoot = path.join(runtimeRoot, 'agents', 'default-agent', 'skills', 'deferred-network-check');
  await mkdir(skillRoot, { recursive: true });
  await writeFile(
    path.join(skillRoot, 'SKILL.md'),
    [
      '---',
      'name: deferred-network-check',
      'description: Search-safe telecom network diagnostic metadata.',
      'context: inline',
      'user-invocable: true',
      'model-invocable: false',
      'metadata:',
      '  version: "1.0.0"',
      '  domain: telecom-network',
      '---',
      '',
      '# Deferred Network Check',
      '',
      'DEFERRED_SKILL_BODY_CANARY',
      '',
    ].join('\n'),
    'utf8',
  );
  const agentPath = path.join(runtimeRoot, 'agents', 'default-agent', 'agent.yaml');
  const agent = readObject(JSON.parse(await readFile(agentPath, 'utf8')));
  const bindings = Array.isArray(agent.capabilityBindings) ? agent.capabilityBindings : [];
  agent.capabilityBindings = [
    ...bindings,
    {
      capabilityId: 'deferred-network-check',
      capabilityType: 'SKILL',
      providerId: 'local-skills-agent-owned',
      enabled: true,
    },
  ];
  await writeFile(agentPath, `${JSON.stringify(agent, null, 2)}\n`, 'utf8');
}

async function setReadToolBinding(runtimeRoot: string, enabled: boolean): Promise<void> {
  const agentPath = path.join(runtimeRoot, 'agents', 'default-agent', 'agent.yaml');
  const agent = readObject(JSON.parse(await readFile(agentPath, 'utf8')));
  const bindings = Array.isArray(agent.capabilityBindings) ? agent.capabilityBindings : [];
  agent.capabilityBindings = [...bindings, { capabilityId: 'Read', capabilityType: 'TOOL', providerId: 'builtin-tools', enabled }];
  await writeFile(agentPath, `${JSON.stringify(agent, null, 2)}\n`, 'utf8');
}

function enableToolSearchDisclosure(config: Record<string, unknown>): void {
  const nextAgent = readObject(config.nextAgent);
  const system = readObject(nextAgent.system);
  system['capability-disclosure'] = { 'tool-disclosure-mode': 'tool-search' };
}

async function readCandidateConversationWithCapabilities(baseUrl: string, sessionId: string): Promise<string> {
  const response = await fetch(`${baseUrl}/api/v1/sessions/${sessionId}/conversation?limit=50&includeCapabilityResults=true`);
  expect(response.status).toBe(200);
  return await response.text();
}

async function readWorkspaceFile(runtimeRoot: string, suffix: string): Promise<string> {
  const files = await findWorkspaceFiles(runtimeRoot, suffix);
  expect(files).toHaveLength(1);
  return await readFile(files[0]!, 'utf8');
}

async function findWorkspaceFiles(runtimeRoot: string, suffix: string): Promise<readonly string[]> {
  const workspaceRoot = path.join(runtimeRoot, 'workspaces');
  const entries = await readdir(workspaceRoot, { recursive: true, withFileTypes: true }).catch(() => []);
  return entries
    .filter((entry) => entry.isFile() && path.join(entry.parentPath, entry.name).replaceAll('\\', '/').endsWith(suffix.replaceAll('\\', '/')))
    .map((entry) => path.join(entry.parentPath, entry.name));
}

async function readSseUntilEvent(url: string, eventType: string): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30_000);
  try {
    const response = await fetch(url, { signal: controller.signal });
    expect(response.status).toBe(200);
    const reader = response.body?.getReader();
    if (reader === undefined) {
      throw new Error('pending-stream-body-missing');
    }
    const decoder = new TextDecoder();
    let buffer = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      buffer += decoder.decode(value, { stream: true });
      const frames = buffer.split(/\r?\n\r?\n/u);
      buffer = frames.pop() ?? '';
      for (const frame of frames) {
        if (!frame.includes(`event: ${eventType}`)) {
          continue;
        }
        const data = frame.split(/\r?\n/u).find((line) => line.startsWith('data: '));
        if (data !== undefined) {
          await reader.cancel();
          return JSON.parse(data.slice('data: '.length)) as unknown;
        }
      }
    }
  } finally {
    clearTimeout(timer);
    controller.abort();
  }
  throw new Error(`stream-event-${eventType}-missing`);
}

async function fileExists(filePath: string): Promise<boolean> {
  return await readFile(filePath).then(
    () => true,
    () => false,
  );
}

function findStringProperty(value: unknown, key: string): string | undefined {
  if (Array.isArray(value)) {
    for (const entry of value) {
      const found = findStringProperty(entry, key);
      if (found !== undefined) {
        return found;
      }
    }
    return undefined;
  }
  if (!isObject(value)) {
    return undefined;
  }
  if (typeof value[key] === 'string') {
    return value[key] as string;
  }
  for (const entry of Object.values(value)) {
    const found = findStringProperty(entry, key);
    if (found !== undefined) {
      return found;
    }
  }
  return undefined;
}

async function waitFor(condition: () => boolean | Promise<boolean>, timeoutMs: number, code: string): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await condition()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(code);
}

function readObject(value: unknown): Record<string, unknown> {
  if (!isObject(value)) {
    throw new Error('capability-object-invalid');
  }
  return value;
}

function toolResultProjection(body: unknown, toolCallId: string): string {
  const messages = readObject(body).messages;
  if (!Array.isArray(messages)) {
    return '[]';
  }
  return JSON.stringify(messages.filter((message) => isObject(message) && message.role === 'tool' && message.tool_call_id === toolCallId));
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
