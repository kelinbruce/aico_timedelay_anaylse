import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_HARNESSBENCH_COMMIT,
  DEFAULT_HARNESSBENCH_REMOTE,
  createRunManifest,
  loadProfile,
  loadDiagnosticProfile,
  selectDiagnosticTasks,
  validateTaskSupport,
} from '../preflight.mjs';

describe('HarnessBench preflight', () => {
  it('rejects unknown profile fields and invalid trusted references', async () => {
    const root = await mkdtemp(join(tmpdir(), 'nextagent-harnessbench-profile-'));
    const path = join(root, 'profile.json');
    await writeFile(
      path,
      JSON.stringify({
        profileId: 'full-suite',
        upstreamUrl: DEFAULT_HARNESSBENCH_REMOTE,
        upstreamCommit: DEFAULT_HARNESSBENCH_COMMIT,
        taskSupport: { '001-file': 'execute' },
        modelId: 'model',
        providerBaseUrlRef: 'https://provider.example/v1',
        credentialRef: 'env:HARNESSBENCH_API_KEY',
        graderModelId: 'grader-model',
        graderProviderBaseUrlRef: 'env:HARNESSBENCH_GRADER_PROVIDER_BASE_URL',
        graderCredentialRef: 'env:HARNESSBENCH_GRADER_API_KEY',
        taskTimeoutSeconds: 1200,
        terminalTimeoutSeconds: 1080,
        extra: true,
      }),
    );

    await expect(loadProfile(path)).rejects.toThrow(/unknown field/u);
  });

  it('requires an exact catalog mapping and a reason for unsupported tasks', () => {
    expect(() => validateTaskSupport({ a: 'execute' }, ['a', 'b'])).toThrow(/missing task/u);
    expect(() => validateTaskSupport({ a: 'execute', b: 'execute', c: 'execute' }, ['a', 'b'])).toThrow(/extra task/u);
    expect(() => validateTaskSupport({ a: 'execute', b: { status: 'unsupported', reason: '' } }, ['a', 'b'])).toThrow(/reason/u);
  });

  it('creates an immutable manifest using every catalog task exactly once', () => {
    const manifest = createRunManifest({
      profile: {
        profileId: 'full-suite',
        upstreamUrl: DEFAULT_HARNESSBENCH_REMOTE,
        upstreamCommit: DEFAULT_HARNESSBENCH_COMMIT,
        taskSupport: { a: 'execute', b: { status: 'unsupported', reason: 'missing product capability' } },
        modelId: 'model',
        providerBaseUrlRef: 'env:HARNESSBENCH_PROVIDER_BASE_URL',
        credentialRef: 'env:HARNESSBENCH_API_KEY',
        graderModelId: 'grader-model',
        graderProviderBaseUrlRef: 'env:HARNESSBENCH_GRADER_PROVIDER_BASE_URL',
        graderCredentialRef: 'env:HARNESSBENCH_GRADER_API_KEY',
        taskTimeoutSeconds: 1200,
        terminalTimeoutSeconds: 1080,
      },
      catalog: ['a', 'b'],
      nextAgentCommit: 'a'.repeat(40),
      nextAgentDirty: false,
      runId: 'run-1',
      startedAt: '2026-08-04T00:00:00.000Z',
    });

    expect(manifest.benchmarkTaskCount).toBe(2);
    expect(manifest.tasks.map((task) => task.taskId)).toEqual(['a', 'b']);
    expect(Object.isFrozen(manifest)).toBe(true);
    expect(Object.isFrozen(manifest.tasks)).toBe(true);
    expect(manifest.graderModelId).toBe('grader-model');
    expect(manifest).toMatchObject({ taskTimeoutSeconds: 1200, terminalTimeoutSeconds: 1080, resultCollectionGraceSeconds: 120 });
  });

  it('rejects profiles that do not reserve exactly 120 seconds for result collection', async () => {
    const root = await mkdtemp(join(tmpdir(), 'nextagent-harnessbench-budget-'));
    const path = join(root, 'profile.json');
    const profile = {
      profileId: 'full-suite',
      upstreamUrl: DEFAULT_HARNESSBENCH_REMOTE,
      upstreamCommit: DEFAULT_HARNESSBENCH_COMMIT,
      taskSupport: { '001-file': 'execute' },
      modelId: 'model',
      providerBaseUrlRef: 'env:HARNESSBENCH_PROVIDER_BASE_URL',
      credentialRef: 'env:HARNESSBENCH_API_KEY',
      graderModelId: 'grader-model',
      graderProviderBaseUrlRef: 'env:HARNESSBENCH_GRADER_PROVIDER_BASE_URL',
      graderCredentialRef: 'env:HARNESSBENCH_GRADER_API_KEY',
      taskTimeoutSeconds: 1200,
      terminalTimeoutSeconds: 1200,
    };
    await writeFile(path, JSON.stringify(profile));

    await expect(loadProfile(path)).rejects.toThrow(/120 seconds/u);
  });

  it('accepts only non-scoring diagnostic profiles with unique catalog task ids', async () => {
    const root = await mkdtemp(join(tmpdir(), 'nextagent-harnessbench-diagnostic-'));
    const path = join(root, 'terminal-failure-regression.json');
    await writeFile(path, JSON.stringify({ profileId: 'terminal-failure-regression', nonScoring: true, taskIds: ['a', 'b'] }));
    const profile = await loadDiagnosticProfile(path);
    expect(selectDiagnosticTasks(profile, ['a', 'b', 'c'])).toEqual(['a', 'b']);
    expect(() => selectDiagnosticTasks({ ...profile, taskIds: ['a', 'a'] }, ['a'])).toThrow(/duplicate/u);
    expect(() => selectDiagnosticTasks({ ...profile, taskIds: ['missing'] }, ['a'])).toThrow(/unknown/u);
  });

  it('keeps the timeout budget regression profile fixed to the 08-14 failure set', async () => {
    const fullProfile = await loadProfile(resolve('tests/harnessbench/profiles/full-suite.json'));
    const profile = await loadDiagnosticProfile(resolve('tests/harnessbench/profiles/timeout-budget-regression.json'));
    expect(fullProfile).toMatchObject({ taskTimeoutSeconds: 1800, terminalTimeoutSeconds: 1680 });
    expect(profile).toEqual({
      profileId: 'timeout-budget-regression',
      nonScoring: true,
      taskIds: [
        '021-batch-rename-transform',
        '037-policy-clause-retrieval',
        '040-test-coverage-fill',
        '041-frontend-state-bug',
        '042-api-schema-migration',
        '078-local-api-cursor-retry-ledger',
        '086-sql-migration-preflight-rollback',
        '087-cli-parser-bug-tests',
        '095-policy-version-conflict-resolution',
      ],
    });
  });

  it('keeps the timeout budget p0 regression profile fixed to the 08-20 timed-out failure set', async () => {
    const profile = await loadDiagnosticProfile(resolve('tests/harnessbench/profiles/timeout-budget-p0-regression.json'));
    expect(profile).toEqual({
      profileId: 'timeout-budget-p0-regression',
      nonScoring: true,
      taskIds: [
        '021-batch-rename-transform',
        '042-api-schema-migration',
        '077-archive-manifest-defense',
        '086-sql-migration-preflight-rollback',
        '092-schema-drift-audit',
      ],
    });
  });

  it('selects only the fixed reasoning-only output exhaustion tasks as non-scoring', async () => {
    const catalog = JSON.parse(await readFile(resolve('tests/harnessbench/fixtures/task-catalog.json'), 'utf8')) as string[];
    const profile = await loadDiagnosticProfile(resolve('tests/harnessbench/profiles/reasoning-only-output-exhaustion-regression.json'));
    expect(profile).toEqual({
      profileId: 'reasoning-only-output-exhaustion-regression',
      nonScoring: true,
      taskIds: ['021-batch-rename-transform', '037-policy-clause-retrieval'],
    });
    expect(selectDiagnosticTasks(profile, catalog)).toEqual(['021-batch-rename-transform', '037-policy-clause-retrieval']);
  });
});
