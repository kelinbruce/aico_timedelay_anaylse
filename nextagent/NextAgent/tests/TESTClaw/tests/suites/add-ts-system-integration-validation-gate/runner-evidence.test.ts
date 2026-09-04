import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { SYSTEM_INTEGRATION_CASES } from './case-manifest.js';
import { linkPassingCaseEvidence } from './helpers/runner-evidence.js';

const cleanupRoots: string[] = [];

afterEach(async () => {
  await Promise.all(cleanupRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('system integration runner evidence', () => {
  it('links each passing result to its output-root-relative case evidence', async () => {
    const evidenceRoot = await mkdtemp(path.join(tmpdir(), 'testclaw-runner-evidence-'));
    cleanupRoots.push(evidenceRoot);
    const definition = SYSTEM_INTEGRATION_CASES[0];
    const caseRoot = path.join(evidenceRoot, 'case-run', 'cases');
    await mkdir(caseRoot, { recursive: true });
    await writeFile(
      path.join(caseRoot, `${definition.caseId}.json`),
      JSON.stringify({ schemaVersion: 1, caseId: definition.caseId, result: 'PASSED' }),
      'utf8',
    );

    const linked = await linkPassingCaseEvidence({
      evidenceRoot,
      definitions: [definition],
      executionResults: [passingResult(definition.executionRef)],
    });

    expect(linked.executionResults[0]).toMatchObject({
      result: 'PASSED',
      evidenceRefs: [`case-run/cases/${definition.caseId}.json`],
    });
    expect(linked.artifacts).toHaveLength(1);
  });

  it('fails a passing result when its case evidence is missing', async () => {
    const evidenceRoot = await mkdtemp(path.join(tmpdir(), 'testclaw-runner-evidence-'));
    cleanupRoots.push(evidenceRoot);
    const definition = SYSTEM_INTEGRATION_CASES[0];
    const linked = await linkPassingCaseEvidence({
      evidenceRoot,
      definitions: [definition],
      executionResults: [passingResult(definition.executionRef)],
    });

    expect(linked.executionResults[0]).toMatchObject({
      result: 'FAILED',
      failurePhase: 'evidence',
      evidenceRefs: ['reason:case-evidence-missing'],
    });
  });
});

function passingResult(executionRef: string) {
  return {
    executionRef,
    result: 'PASSED' as const,
    failurePhase: null,
    evidenceRefs: ['runner:passed'],
  };
}
