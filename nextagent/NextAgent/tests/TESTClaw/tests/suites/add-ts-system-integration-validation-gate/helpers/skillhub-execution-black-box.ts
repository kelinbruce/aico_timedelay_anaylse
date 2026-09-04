import { cp, readFile } from 'node:fs/promises';
import path from 'node:path';

import { expect } from 'vitest';

import { requiredCandidateRoot } from './candidate-harness.js';
import { writePassingCaseEvidence } from './case-evidence.js';
import { runExternalConsumerScript } from './external-consumer-process.js';
import { externalNextAgentArtifactsRoot, hashDirectoryTree } from './external-consumer-root.js';
import { withRunScope } from './run-scope.js';

export async function runSkillHubExecutionCase(): Promise<void> {
  const candidateRoot = requiredCandidateRoot();
  const externalPackagesRoot = requiredExternalPackagesRoot();
  const candidateBefore = await hashDirectoryTree(candidateRoot);
  const artifactsRoot = externalNextAgentArtifactsRoot(externalPackagesRoot);
  const externalBefore = await hashDirectoryTree(artifactsRoot);
  await withRunScope({ outputBase: process.env.TESTCLAW_SYSTEM_INTEGRATION_OUTPUT_ROOT }, async (scope) => {
    const runtimeRoot = path.join(scope.tempRoot, 'candidate');
    await cp(candidateRoot, runtimeRoot, { recursive: true, errorOnExist: true, force: false });
    const source = await readFile(new URL('../e2e/backend/fixtures/TC-SI-117-consumer.mjs', import.meta.url), 'utf8');
    const result = await runExternalConsumerScript({
      externalPackagesRoot,
      tempBase: scope.tempRoot,
      source,
      environment: { TESTCLAW_CANDIDATE_ROOT: runtimeRoot, NEXTAGENT_CONFIG_DIR: path.join(runtimeRoot, 'config') },
      registerChild: scope.registerChild,
    });
    if (result.code !== 0) {
      throw new Error(`skillhub-consumer-failed:${result.stderr.trim() || result.stdout.trim() || 'no-diagnostic'}`);
    }
    expect(unexpectedStderr(result.stderr)).toBe('');
    const observations = JSON.parse(result.stdout.trim()) as Record<string, boolean>;
    expect(observations).toMatchObject({
      acquiredOverHttp: true,
      localizedCatalogVisible: true,
      resourceProjected: true,
      skillBodyLoadedOnlyBySkill: true,
      terminalCommitted: true,
    });
    await writePassingCaseEvidence({
      evidenceRoot: scope.evidenceRoot,
      caseId: 'TC-SI-117',
      observations,
      canaries: [
        { category: 'skill-body', value: 'SKILL_BODY_ONLY_CANARY' },
        { category: 'absolute-path', value: candidateRoot },
      ],
    });
  });
  expect(await hashDirectoryTree(candidateRoot)).toBe(candidateBefore);
  expect(await hashDirectoryTree(artifactsRoot)).toBe(externalBefore);
}

function unexpectedStderr(stderr: string): string {
  const knownWarning =
    'AI SDK Warning: System messages in the prompt or messages fields can be a security risk because they may enable prompt injection attacks. Use the system option instead when possible. Set allowSystemInMessages to true to suppress this warning, or false to throw an error.';
  return stderr
    .split(/\r?\n/u)
    .filter((line) => line.trim().length > 0 && line.trim() !== knownWarning)
    .join('\n');
}

function requiredExternalPackagesRoot(): string {
  const value = process.env.NEXTAGENT_EXTERNAL_PACKAGES_ROOT;
  if (value === undefined || value.trim().length === 0) {
    throw new Error('external-packages-root-unavailable');
  }
  return path.resolve(value);
}
