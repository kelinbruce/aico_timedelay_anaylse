import {
  qualify,
  readConfigValidationEvidence,
  releaseCheckCommands,
  runReleaseQualification,
  type ReleaseQualificationInput,
} from '@nextagent/agent-app/testing';
import { mkdirSync, writeFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const evaluatedAt = '2026-06-03T00:00:00.000Z';

describe('local runtime release qualification', () => {
  it('returns QUALIFIED when all gates, health, smoke, and baseline pass', () => {
    expect(qualify('candidate-1', validInput())).toEqual({
      candidateId: 'candidate-1',
      qualificationStatus: 'QUALIFIED',
      blockingReasons: [],
      declaredDegradations: [],
      evidenceRefs: [
        'candidate-manifest.json',
        'run/layout-check.json',
        'run/config-validation-evidence.json',
        'run/startup-proof.json',
        'run/health-readiness-proof.json',
        'gate-contract',
        'gate-architecture',
        'gate-security',
        'gate-resilience',
        'health',
        'smoke',
        'baseline',
      ],
      evaluatedAt,
    });
  });

  it('returns QUALIFIED_WITH_DECLARED_DEGRADATIONS only for approved degradations', () => {
    const verdict = qualify('candidate-1', {
      ...validInput(),
      configValidationEvidence: {
        candidateId: 'candidate-1',
        readinessState: 'DEGRADED_READY',
        safeIssues: [],
        declaredDegradations: ['capacity baseline accepted for first telecom field trial'],
        evaluatedAt,
        evidenceRefs: ['run/config-validation-evidence.json'],
      },
      declaredDegradations: ['capacity baseline accepted for first telecom field trial'],
    });
    expect(verdict.qualificationStatus).toBe('QUALIFIED_WITH_DECLARED_DEGRADATIONS');
    expect(verdict.declaredDegradations).toEqual(['capacity baseline accepted for first telecom field trial']);

    const undeclared = qualify('candidate-1', {
      ...validInput(),
      configValidationEvidence: {
        candidateId: 'candidate-1',
        readinessState: 'DEGRADED_READY',
        safeIssues: [],
        declaredDegradations: ['model provider degraded'],
        evaluatedAt,
        evidenceRefs: ['run/config-validation-evidence.json'],
      },
    });
    expect(undeclared.qualificationStatus).toBe('BLOCKED');
    expect(undeclared.blockingReasons).toEqual(['blocking-defect: undeclared degradation: model provider degraded']);
  });

  it('aggregates all hard gate failures and keeps later stages untrusted', () => {
    const verdict = qualify('candidate-1', {
      ...validInput(),
      hardGateResults: [
        check('contract'),
        check('architecture', 'FAILED', 'architecture import violation'),
        check('security', 'FAILED', 'security leak'),
        check('resilience'),
      ],
    });
    expect(verdict.qualificationStatus).toBe('BLOCKED');
    expect(verdict.blockingReasons).toEqual([
      'blocking-defect: architecture gate failed: architecture import violation',
      'blocking-defect: security gate failed: security leak',
    ]);
    expect(verdict.evidenceRefs).toContain('gate-security');
  });

  it('blocks package config and health failures', () => {
    expect(
      qualify('candidate-1', {
        ...validInput(),
        configValidationEvidence: {
          candidateId: 'candidate-1',
          readinessState: 'BLOCKED',
          safeIssues: ['blocked'],
          declaredDegradations: [],
          evaluatedAt,
          evidenceRefs: ['run/config-validation-evidence.json'],
        },
      }).blockingReasons,
    ).toEqual(['blocking-defect: package configuration is blocked']);
    expect(
      qualify('candidate-1', { ...validInput(), healthProof: { ...validInput().healthProof, primaryStatus: 'FAILED', safeReason: 'not-ready' } })
        .blockingReasons,
    ).toEqual(['blocking-defect: primary health failed: not-ready']);
    expect(
      qualify('candidate-1', {
        ...validInput(),
        healthProof: {
          ...validInput().healthProof,
          deepStatus: 'UNAVAILABLE',
          criticalDependencyStatuses: ['UNAVAILABLE'],
          safeReason: 'model provider unavailable',
        },
      }).blockingReasons,
    ).toEqual(['blocking-defect: critical dependency health unavailable: model provider unavailable']);
  });

  it('blocks smoke and capacity non-passed results', () => {
    expect(qualify('candidate-1', { ...validInput(), smokeResult: check('product-journey', 'TIMEOUT', 'smoke timeout') }).blockingReasons).toEqual([
      'blocking-defect: product journey timeout: smoke timeout',
    ]);
    expect(
      qualify('candidate-1', { ...validInput(), capacityResult: check('capacity', 'MISSING', 'capacity baseline missing') }).blockingReasons,
    ).toEqual(['blocking-defect: capacity baseline missing: capacity baseline missing']);
  });

  it('sanitizes diagnostics conservatively instead of leaking raw details', () => {
    const verdict = qualify('candidate-1', {
      ...validInput(),
      hardGateResults: [
        check('contract'),
        check('architecture'),
        check('security', 'FAILED', 'raw C:\\secret\\provider.log token-secret-value at stack frame'),
        check('resilience'),
      ],
    });
    expect(verdict.qualificationStatus).toBe('BLOCKED');
    expect(verdict.blockingReasons[0]).not.toContain('C:\\secret\\provider.log');
    expect(verdict.blockingReasons[0]).not.toContain('token-secret-value');
    expect(verdict.blockingReasons[0]).toContain('<local-path>');
    expect(verdict.blockingReasons[0]).toContain('<redacted>');
  });

  it('resolves only the actual candidate config validation evidence ref', async () => {
    const candidateRoot = await mkdtemp(join(tmpdir(), 'nextagent-release-config-evidence-'));
    try {
      mkdirSync(join(candidateRoot, 'run'), { recursive: true });
      writeFileSync(
        join(candidateRoot, 'run', 'config-validation-evidence.json'),
        JSON.stringify({
          candidateId: 'candidate-1',
          readinessState: 'READY',
          safeIssues: [],
          declaredDegradations: [],
          evaluatedAt,
          evidenceRefs: ['run/config-validation-evidence.json'],
        }),
        'utf8',
      );
      writeFileSync(
        join(candidateRoot, 'run', 'wrong-candidate.json'),
        JSON.stringify({
          candidateId: 'candidate-2',
          readinessState: 'READY',
          safeIssues: [],
          declaredDegradations: [],
          evaluatedAt,
          evidenceRefs: ['run/wrong-candidate.json'],
        }),
        'utf8',
      );
      writeFileSync(
        join(candidateRoot, 'run', 'alternate-config-shape.json'),
        JSON.stringify({ candidateId: 'candidate-1', status: 'READY' }),
        'utf8',
      );

      expect(readConfigValidationEvidence(candidateRoot, 'run/config-validation-evidence.json', 'candidate-1')).toEqual({
        candidateId: 'candidate-1',
        readinessState: 'READY',
        safeIssues: [],
        declaredDegradations: [],
        evaluatedAt,
        evidenceRefs: ['run/config-validation-evidence.json'],
      });
      expect(() => readConfigValidationEvidence(candidateRoot, 'run/wrong-candidate.json', 'candidate-1')).toThrow(/candidate identity/u);
      expect(() => readConfigValidationEvidence(candidateRoot, 'run/alternate-config-shape.json', 'candidate-1')).toThrow(/readinessState/u);
    } finally {
      await rm(candidateRoot, { recursive: true, force: true });
    }
  });
  it('invokes fixed commands and builds the verdict from command reports', async () => {
    const fixtureRoot = await mkdtemp(join(tmpdir(), 'nextagent-release-orchestrator-'));
    try {
      const candidateRoot = join(fixtureRoot, 'candidate');
      const scopeFile = join(fixtureRoot, 'scope.txt');
      mkdirSync(join(candidateRoot, 'run'), { recursive: true });
      writeFileSync(join(candidateRoot, 'candidate-manifest.json'), JSON.stringify({ candidateId: 'candidate-1' }), 'utf8');
      writeFileSync(
        join(candidateRoot, 'run', 'config-validation-evidence.json'),
        JSON.stringify({
          candidateId: 'candidate-1',
          readinessState: 'READY',
          safeIssues: [],
          declaredDegradations: [],
          evaluatedAt,
          evidenceRefs: ['run/config-validation-evidence.json'],
        }),
        'utf8',
      );
      writeFileSync(scopeFile, 'first local backend release', 'utf8');
      writeReleaseFixturePackage(fixtureRoot, false);

      const result = runReleaseQualification({ candidateRoot, scopeFile, cwd: fixtureRoot, timeoutMs: 30_000 });

      expect(result.qualificationStatus).toBe('QUALIFIED');
      expect(result.evidenceRefs).toEqual(
        expect.arrayContaining([
          'contract-evidence',
          'architecture-evidence',
          'security-evidence',
          'resilience-evidence',
          'health-evidence',
          'product-journey-evidence',
          'capacity-evidence',
        ]),
      );
    } finally {
      await rm(fixtureRoot, { recursive: true, force: true });
    }
  }, 60_000);

  it('fails closed when release-package command omits required package outputs', async () => {
    const fixtureRoot = await mkdtemp(join(tmpdir(), 'nextagent-release-missing-package-output-'));
    try {
      const candidateRoot = join(fixtureRoot, 'candidate');
      const scopeFile = join(fixtureRoot, 'scope.txt');
      mkdirSync(join(candidateRoot, 'run'), { recursive: true });
      writeFileSync(join(candidateRoot, 'candidate-manifest.json'), JSON.stringify({ candidateId: 'candidate-1' }), 'utf8');
      writeFileSync(scopeFile, 'first local backend release', 'utf8');
      writeReleaseFixturePackage(fixtureRoot, true);

      const result = runReleaseQualification({ candidateRoot, scopeFile, cwd: fixtureRoot, timeoutMs: 30_000 });

      expect(result.qualificationStatus).toBe('BLOCKED');
      expect(result.blockingReasons).toEqual(['blocking-defect: release-package required package evidence is missing']);
      expect(result.evidenceRefs).toEqual(
        expect.arrayContaining(['contract-evidence', 'architecture-evidence', 'security-evidence', 'resilience-evidence']),
      );
    } finally {
      await rm(fixtureRoot, { recursive: true, force: true });
    }
  }, 60_000);
  it('freezes the fixed command inventory', () => {
    expect(releaseCheckCommands.map((command) => [command.checkId, command.args.join(' ')])).toEqual([
      ['contract', 'run test:contract'],
      ['architecture', 'run lint:architecture'],
      ['security', 'run test:gate:security'],
      ['resilience', 'run test:gate:resilience'],
      ['release-package', 'run test:e2e:release-package'],
      ['product-journey', 'run test:e2e:product-journey'],
      ['capacity', 'run test:gate:capacity'],
    ]);
  });
});

function writeReleaseFixturePackage(root: string, omitPackageOutputs: boolean): void {
  const scriptPath = join(root, 'release-fixture-check.mjs');
  writeFileSync(
    join(root, 'package.json'),
    JSON.stringify(
      {
        type: 'module',
        scripts: {
          'test:contract': `node ${JSON.stringify(scriptPath)} contract`,
          'lint:architecture': `node ${JSON.stringify(scriptPath)} architecture`,
          'test:gate:security': `node ${JSON.stringify(scriptPath)} security`,
          'test:gate:resilience': `node ${JSON.stringify(scriptPath)} resilience`,
          'test:e2e:release-package': `node ${JSON.stringify(scriptPath)} release-package ${omitPackageOutputs ? 'omit' : 'write'}`,
          'test:e2e:product-journey': `node ${JSON.stringify(scriptPath)} product-journey`,
          'test:gate:capacity': `node ${JSON.stringify(scriptPath)} capacity`,
        },
      },
      null,
      2,
    ),
    'utf8',
  );
  writeFileSync(
    scriptPath,
    `import { writeFileSync } from "node:fs";\nimport { join } from "node:path";\nconst checkId = process.argv[2];\nconst mode = process.argv[3];\nconst reportDir = process.env.NEXTAGENT_RELEASE_CHECK_DIR;\nif (!reportDir) { process.exit(2); }\nwriteFileSync(join(reportDir, checkId + ".json"), JSON.stringify({ checkId, safeReason: checkId + " passed", evidenceRefs: [checkId + "-evidence"] }), "utf8");\nif (checkId === "release-package" && mode !== "omit") {\n  writeFileSync(join(reportDir, "package-candidate-evidence.json"), JSON.stringify({ candidateId: "candidate-1", packageProfile: "backend-only", manifestRef: "candidate-manifest.json", layoutCheckRef: "run/layout-check.json", configValidationEvidenceRef: "run/config-validation-evidence.json", startupProofRef: "run/startup-proof.json", healthReadinessProofRef: "run/health-readiness-proof.json", evidenceRefs: ["candidate-manifest.json", "run/layout-check.json", "run/config-validation-evidence.json", "run/startup-proof.json", "run/health-readiness-proof.json"] }), "utf8");\n  writeFileSync(join(reportDir, "health-proof.json"), JSON.stringify({ primaryStatus: "PASSED", deepStatus: "PASSED", criticalDependencyStatuses: [], evidenceRefs: ["health-evidence"] }), "utf8");\n}\n`,
    'utf8',
  );
}
function validInput(): ReleaseQualificationInput {
  return {
    releaseScopeStatement: 'first local backend release',
    packageEvidence: {
      candidateId: 'candidate-1',
      packageProfile: 'backend-only',
      manifestRef: 'candidate-manifest.json',
      layoutCheckRef: 'run/layout-check.json',
      configValidationEvidenceRef: 'run/config-validation-evidence.json',
      startupProofRef: 'run/startup-proof.json',
      healthReadinessProofRef: 'run/health-readiness-proof.json',
      evidenceRefs: [
        'candidate-manifest.json',
        'run/layout-check.json',
        'run/config-validation-evidence.json',
        'run/startup-proof.json',
        'run/health-readiness-proof.json',
      ],
    },
    configValidationEvidence: {
      candidateId: 'candidate-1',
      readinessState: 'READY',
      safeIssues: [],
      declaredDegradations: [],
      evaluatedAt,
      evidenceRefs: ['run/config-validation-evidence.json'],
    },
    hardGateResults: [check('contract'), check('architecture'), check('security'), check('resilience')],
    healthProof: { primaryStatus: 'PASSED', deepStatus: 'PASSED', criticalDependencyStatuses: [], evidenceRefs: ['health'] },
    smokeResult: check('product-journey', 'PASSED', undefined, 'smoke'),
    capacityResult: check('capacity', 'PASSED', undefined, 'baseline'),
    evaluatedAt,
  };
}

function check(
  checkId: 'contract' | 'architecture' | 'security' | 'resilience' | 'product-journey' | 'capacity',
  status: 'PASSED' | 'FAILED' | 'MISSING' | 'TIMEOUT' | 'UNAVAILABLE' = 'PASSED',
  safeReason?: string,
  evidenceRef = `gate-${checkId}`,
) {
  return safeReason === undefined ? { checkId, status, evidenceRefs: [evidenceRef] } : { checkId, status, safeReason, evidenceRefs: [evidenceRef] };
}
