import { randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';

import { expect } from 'vitest';

import type { SystemIntegrationCaseId } from '../case-manifest.js';
import { createCandidateSession, readCandidateStream, submitCandidateRequest } from './candidate-api.js';
import { requiredCandidateRoot, startCandidateHarness } from './candidate-harness.js';
import { writePassingCaseEvidence } from './case-evidence.js';
import { hashDirectoryTree } from './external-consumer-root.js';
import { withRunScope } from './run-scope.js';

export async function runSecurityCase(caseId: SystemIntegrationCaseId): Promise<void> {
  const candidateRoot = requiredCandidateRoot();
  const candidateHashBefore = await hashDirectoryTree(candidateRoot);
  await withRunScope({ outputBase: process.env.TESTCLAW_SYSTEM_INTEGRATION_OUTPUT_ROOT }, async (scope) => {
    const observations = await executeSecurityCase(caseId, candidateRoot, scope);
    await writePassingCaseEvidence({
      evidenceRoot: scope.evidenceRoot,
      caseId,
      observations,
      canaries: [
        { category: 'prompt', value: `security-prompt-${caseId}` },
        { category: 'credential', value: `sk-testclaw-${caseId}` },
        { category: 'attachment-body', value: `attachment-canary-${caseId}` },
        { category: 'absolute-path', value: candidateRoot },
      ],
    });
  });
  expect(await hashDirectoryTree(candidateRoot)).toBe(candidateHashBefore);
}

async function executeSecurityCase(
  caseId: SystemIntegrationCaseId,
  candidateRoot: string,
  scope: Parameters<typeof startCandidateHarness>[0]['scope'],
): Promise<Readonly<Record<string, boolean | number | string>>> {
  if (caseId === 'TC-SI-024') {
    const harness = await startCandidateHarness({
      scope,
      candidateRoot,
      modelAnswer: 'must not execute',
    });
    const unauthorized = await fetch(`${harness.baseUrl}/api/v1/stream-task`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        taskMessages: [{ text: `security-prompt-${caseId}` }],
        idempotencyKey: `tc-si-024-${randomUUID()}`,
      }),
    });
    expect(unauthorized.status).toBe(401);
    const unauthorizedBody: unknown = await unauthorized.json();
    expect(JSON.stringify(unauthorizedBody)).toContain('IDENTITY_RESOLUTION_FAILED');
    expect(JSON.stringify(unauthorizedBody)).not.toMatch(/sessionId|taskId|runId/u);
    expect(harness.modelInvocationCount()).toBe(0);
    return { unauthenticatedRejected: true, coordinatesNotIssued: true, providerNotInvoked: true, userDataCreated: false };
  }

  if (caseId === 'TC-SI-025') {
    const harness = await startCandidateHarness({ scope, candidateRoot, modelAnswer: 'must not execute' });
    const sessionId = await createCandidateSession(harness.baseUrl);
    const formData = new FormData();
    formData.append('tempRunId', randomUUID());
    formData.append('file', new Blob([`attachment-canary-${caseId}`], { type: 'application/octet-stream' }), 'unsafe-payload.exe');
    const response = await fetch(`${harness.baseUrl}/api/v1/sessions/${sessionId}/files/upload`, {
      method: 'POST',
      body: formData,
    });
    expect(response.status).toBe(400);
    const body = await response.text();
    expect(body).not.toContain(`attachment-canary-${caseId}`);
    expect(body).not.toContain(candidateRoot);
    expect(harness.modelInvocationCount()).toBe(0);
    return { unsupportedAttachmentRejected: true, attachmentBodyNotLeaked: true, providerNotInvoked: true };
  }

  if (caseId === 'TC-SI-028') {
    const promptCanary = `security-prompt-${caseId} sk-testclaw-${caseId}`;
    const harness = await startCandidateHarness({
      scope,
      candidateRoot,
      modelAnswer: 'audit safety completed',
      environment: { NODE_ENV: 'production' },
    });
    const accepted = await submitCandidateRequest({ baseUrl: harness.baseUrl, inputText: promptCanary });
    expect(await readCandidateStream(harness.baseUrl, accepted)).toContain('event: REQUEST_COMPLETED');
    await harness.stop();
    const operationalLogs = await findOperationalLogs(scope.tempRoot);
    expect(operationalLogs).toHaveLength(1);
    const logPath = operationalLogs[0]!;
    expect(path.relative(scope.restrictedDiagnosticRoot, logPath).split(path.sep)).not.toContain('..');
    const log = await readFile(logPath, 'utf8');
    const lines = log.split(/\r?\n/u).filter((line) => line.length > 0);
    expect(lines.length).toBeGreaterThan(0);
    expect(lines.every((line) => isObject(JSON.parse(line)))).toBe(true);
    expect(log).not.toContain(promptCanary);
    expect(log).not.toContain(`sk-testclaw-${caseId}`);
    expect(log).not.toContain(candidateRoot);
    return { operationalLogParsed: true, rawPromptAbsent: true, credentialAbsent: true, absolutePathAbsent: true };
  }

  throw new Error(`unsupported-security-case-${caseId}`);
}

async function findOperationalLogs(root: string): Promise<readonly string[]> {
  const entries = await readdir(root, { recursive: true, withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && entry.name.includes('operational') && entry.name.includes('.jsonl'))
    .map((entry) => path.join(entry.parentPath, entry.name));
}

function readObject(value: unknown): Record<string, unknown> {
  if (!isObject(value)) {
    throw new Error('security-object-invalid');
  }
  return value;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
