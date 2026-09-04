import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { cp, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { expect } from 'vitest';

import type { SystemIntegrationCaseId } from '../case-manifest.js';
import { readCandidateConversation, readCandidateStream, submitCandidateRequest } from './candidate-api.js';
import { requiredCandidateRoot, startCandidateHarness } from './candidate-harness.js';
import { writePassingCaseEvidence } from './case-evidence.js';
import { hashDirectoryTree } from './external-consumer-root.js';
import { withRunScope } from './run-scope.js';

export async function runRuntimePackageCase(caseId: SystemIntegrationCaseId): Promise<void> {
  const candidateRoot = requiredCandidateRoot();
  const candidateHashBefore = await hashDirectoryTree(candidateRoot);
  await withRunScope({ outputBase: process.env.TESTCLAW_SYSTEM_INTEGRATION_OUTPUT_ROOT }, async (scope) => {
    const observations =
      caseId === 'TC-SI-032'
        ? await verifyInvalidConfigFailsClosed(candidateRoot, scope.tempRoot)
        : await verifyRunningPackageCase(caseId, candidateRoot, scope);
    await writePassingCaseEvidence({
      evidenceRoot: scope.evidenceRoot,
      caseId,
      observations,
      canaries: [
        { category: 'prompt', value: `runtime-package-${caseId}` },
        { category: 'model-output', value: 'runtime package verified' },
        { category: 'credential', value: 'testclaw-loopback-key' },
        { category: 'absolute-path', value: candidateRoot },
      ],
    });
  });
  expect(await hashDirectoryTree(candidateRoot)).toBe(candidateHashBefore);
}

async function verifyRunningPackageCase(
  caseId: SystemIntegrationCaseId,
  candidateRoot: string,
  scope: Parameters<typeof startCandidateHarness>[0]['scope'],
): Promise<Readonly<Record<string, boolean | number | string>>> {
  const harness = await startCandidateHarness({ scope, candidateRoot, modelAnswer: 'runtime package verified' });
  if (caseId === 'TC-SI-030') {
    const first = await submitCandidateRequest({ baseUrl: harness.baseUrl, inputText: `runtime-package-${caseId}` });
    expect(await readCandidateStream(harness.baseUrl, first)).toContain('event: REQUEST_COMPLETED');
    await harness.restart();
    const restored = await readCandidateConversation(harness.baseUrl, first.sessionId);
    expect(restored.map((item) => item.role)).toEqual(['USER', 'ASSISTANT']);
    const second = await submitCandidateRequest({
      baseUrl: harness.baseUrl,
      inputText: 'runtime-package-after-restart',
      sessionId: first.sessionId,
    });
    expect(await readCandidateStream(harness.baseUrl, second)).toContain('event: REQUEST_COMPLETED');
    const finalHistory = await readCandidateConversation(harness.baseUrl, first.sessionId);
    expect(finalHistory.map((item) => item.role)).toEqual(['USER', 'ASSISTANT', 'USER', 'ASSISTANT']);
    return { processRestarted: true, historyRecovered: true, serviceContinued: true };
  }

  const health = await fetch(`${harness.baseUrl}/health`);
  const deepHealth = await fetch(`${harness.baseUrl}/health/deep`);
  expect(health.status).toBe(200);
  expect(deepHealth.status).toBe(200);
  const requiredProofs = ['run/config-validation-evidence.json', 'run/startup-proof.json', 'run/health-readiness-proof.json'];
  for (const proof of requiredProofs) {
    expect(isObject(JSON.parse(await readFile(path.join(harness.runtimeRoot, proof), 'utf8')))).toBe(true);
  }

  if (caseId === 'TC-SI-033') {
    return { primaryHealthPassed: true, deepHealthPassed: true, startupProofsPresent: requiredProofs.length };
  }
  if (caseId !== 'TC-SI-035') {
    throw new Error(`unsupported-runtime-package-case-${caseId}`);
  }

  const manifest = readObject(JSON.parse(await readFile(path.join(harness.runtimeRoot, 'candidate-manifest.json'), 'utf8')));
  const moduleRef = readDeploymentModuleRef(manifest);
  const packageModule = (await import(pathToFileURL(path.join(harness.runtimeRoot, ...moduleRef.split('/'))).href)) as {
    createPackageCandidateEvidence?: (packageRoot: string) => unknown;
  };
  expect(typeof packageModule.createPackageCandidateEvidence).toBe('function');
  const evidence = packageModule.createPackageCandidateEvidence?.(harness.runtimeRoot);
  expect(isObject(evidence)).toBe(true);
  const refs = readStringArray(manifest.evidenceRefs);
  expect(refs).toHaveLength(4);
  for (const ref of refs) {
    expect(path.isAbsolute(ref)).toBe(false);
    expect(ref.split(/[\\/]/u)).not.toContain('..');
    expect(isObject(JSON.parse(await readFile(path.join(harness.runtimeRoot, ...ref.split('/')), 'utf8')))).toBe(true);
  }
  return { manifestValidated: true, declaredEvidenceResolved: refs.length, layoutEvidenceGenerated: true };
}

async function verifyInvalidConfigFailsClosed(candidateRoot: string, tempRoot: string): Promise<Readonly<Record<string, boolean | number | string>>> {
  const runtimeRoot = path.join(tempRoot, 'invalid-candidate');
  await cp(candidateRoot, runtimeRoot, { recursive: true, errorOnExist: true, force: false });
  const configPath = path.join(runtimeRoot, 'config', 'default-system.yaml');
  const config = readObject(JSON.parse(await readFile(configPath, 'utf8')));
  const channel = readObject(config.channel);
  channel.port = 70_000;
  await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
  const child = spawn(process.execPath, [path.join(runtimeRoot, 'bin', 'nextagent-start')], {
    cwd: runtimeRoot,
    env: {
      ...process.env,
      NEXTAGENT_CONFIG_DIR: path.join(runtimeRoot, 'config'),
      OPENAI_API_KEY: `invalid-config-${randomUUID()}`,
      OPENAI_BASE_URL: 'http://127.0.0.1:1/v1',
      OPENAI_MODEL_NAME: 'unused',
    },
    stdio: ['ignore', 'ignore', 'ignore'],
    windowsHide: true,
  });
  const exitCode = await new Promise<number | null>((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', resolve);
  });
  expect(exitCode).not.toBe(0);
  const startupProof = readObject(JSON.parse(await readFile(path.join(runtimeRoot, 'run', 'startup-proof.json'), 'utf8')));
  const configEvidence = readObject(JSON.parse(await readFile(path.join(runtimeRoot, 'run', 'config-validation-evidence.json'), 'utf8')));
  expect(startupProof.started).toBe(false);
  expect(configEvidence.readinessState).toBe('BLOCKED');
  return { invalidConfigRejected: true, processFailedClosed: true, blockedEvidenceWritten: true };
}

function readDeploymentModuleRef(manifest: Record<string, unknown>): string {
  const refs = readObject(manifest.deploymentEntrypointRefs);
  const local = readObject(refs.LOCAL);
  if (typeof local.module !== 'string') {
    throw new Error('candidate-local-module-ref-missing');
  }
  return local.module;
}

function readStringArray(value: unknown): readonly string[] {
  if (!Array.isArray(value) || !value.every((entry) => typeof entry === 'string')) {
    throw new Error('string-array-invalid');
  }
  return value;
}

function readObject(value: unknown): Record<string, unknown> {
  if (!isObject(value)) {
    throw new Error('object-invalid');
  }
  return value;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
