import { readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { applyEvidenceScan, scanExportedEvidence, summarizeRestrictedDiagnostic, type EvidenceCanary } from './helpers/evidence-safety.js';
import { SYSTEM_INTEGRATION_CASES } from './case-manifest.js';
import { buildSystemIntegrationReport } from './helpers/report.js';
import { createRunScope } from './helpers/run-scope.js';

const canaries: readonly EvidenceCanary[] = [
  { category: 'credential', value: 'credential-canary-73c8' },
  { category: 'prompt', value: 'prompt-canary-40bd' },
  { category: 'model-output', value: 'model-output-canary-a195' },
  { category: 'attachment-body', value: 'attachment-canary-812e' },
  { category: 'skill-body', value: 'skill-body-canary-7fd1' },
  { category: 'absolute-path', value: 'C:\\candidate\\private\\file.txt' },
  { category: 'provider-secret', value: 'provider-secret-canary-3ce1' },
  { category: 'remote-exception', value: 'remote-exception-canary-f010' },
  { category: 'adapter-private-dto', value: 'adapter-private-dto-canary-c63b' },
  { category: 'sensitive-canary', value: 'generic-sensitive-canary-f8da' },
];

describe('exported evidence safety', () => {
  it('fails every forbidden category without copying raw content into the result', () => {
    const scan = scanExportedEvidence({
      canaries,
      artifacts: canaries.map((canary, index) => ({
        caseId: `TC-SI-${String(index + 1).padStart(3, '0')}`,
        surface: (['stdout', 'stderr', 'evidence', 'report'] as const)[index % 4],
        content: `prefix ${canary.value} suffix`,
      })),
    });

    expect(scan.safe).toBe(false);
    expect(scan.violations).toHaveLength(canaries.length);
    expect(scan.violations.map((entry) => entry.reasonCode)).toEqual(canaries.map((canary) => `exported-evidence:${canary.category}`));
    const serialized = JSON.stringify(scan);
    for (const canary of canaries) {
      expect(serialized).not.toContain(canary.value);
    }
  });

  it('allows stable diagnostic content only in the restricted root and removes it on cleanup', async () => {
    const restrictedContent = ['toolInput=diagnostic-command', 'rawExceptionData=controlled-stack', 'path=C:\\candidate\\sandbox\\task'].join('\n');
    const scope = await createRunScope();
    const diagnosticFile = path.join(scope.restrictedDiagnosticRoot, 'runtime.log');
    await writeFile(diagnosticFile, restrictedContent, 'utf8');
    const restricted = summarizeRestrictedDiagnostic(await readFile(diagnosticFile, 'utf8'));

    expect(restricted).toMatchObject({
      result: 'PASSED',
      reasonCode: 'restricted-diagnostic-inspected',
    });
    expect(JSON.stringify(restricted)).not.toContain(restrictedContent);

    const exported = scanExportedEvidence({
      canaries: [{ category: 'remote-exception', value: 'controlled-stack' }],
      artifacts: [
        {
          caseId: 'TC-SI-001',
          surface: 'stdout',
          content: restrictedContent,
        },
      ],
    });
    expect(exported.safe).toBe(false);
    expect(JSON.stringify(exported)).not.toContain('controlled-stack');

    await scope.cleanup();
    await expect(stat(scope.restrictedDiagnosticRoot)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('detects built-in absolute-path and credential patterns without exporting matches', () => {
    const scan = scanExportedEvidence({
      canaries: [],
      artifacts: [
        {
          caseId: 'TC-SI-001',
          surface: 'stderr',
          content: 'Authorization: Bearer abcdefghijklmnop at C:\\private\\agent\\runtime.log',
        },
      ],
    });

    expect(scan.safe).toBe(false);
    expect(scan.violations.map((entry) => entry.reasonCode)).toEqual(['exported-evidence:credential', 'exported-evidence:absolute-path']);
    expect(JSON.stringify(scan)).not.toContain('abcdefghijklmnop');
    expect(JSON.stringify(scan)).not.toContain('C:\\private');
  });

  it('overrides the affected case and total verdict without copying the forbidden value', () => {
    const forbidden = 'prompt-canary-final-report-9ed2';
    const scan = scanExportedEvidence({
      canaries: [{ category: 'prompt', value: forbidden }],
      artifacts: [
        {
          caseId: 'TC-SI-001',
          surface: 'report',
          content: forbidden,
        },
      ],
    });
    const results = applyEvidenceScan(
      SYSTEM_INTEGRATION_CASES,
      SYSTEM_INTEGRATION_CASES.map((definition) => ({
        executionRef: definition.executionRef,
        result: 'PASSED' as const,
        failurePhase: null,
        evidenceRefs: ['evidence:passed'],
      })),
      scan,
    );
    const report = buildSystemIntegrationReport({
      runId: 'run-evidence-failure',
      definitions: SYSTEM_INTEGRATION_CASES,
      executionResults: results,
    });

    expect(report.status).toBe('FAILED');
    expect(report.cases[0]).toMatchObject({
      result: 'FAILED',
      failurePhase: 'evidence',
    });
    expect(JSON.stringify(report)).not.toContain(forbidden);
  });
});
