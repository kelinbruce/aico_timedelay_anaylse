import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { loadProfile, validateTaskSupport } from '../preflight.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

describe('HarnessBench full-suite profile', () => {
  it('maps the fixed 106-task catalog without silent exclusion', async () => {
    const catalog = JSON.parse(await readFile(resolve(root, 'fixtures/task-catalog.json'), 'utf8')) as string[];
    const profile = await loadProfile(resolve(root, 'profiles/full-suite.json'));

    expect(catalog).toHaveLength(106);
    expect(new Set(catalog).size).toBe(106);
    expect(() => validateTaskSupport(profile.taskSupport, catalog)).not.toThrow();
    expect(Object.keys(profile.taskSupport)).toHaveLength(106);
    expect(profile).toMatchObject({
      graderModelId: expect.any(String),
      graderProviderBaseUrlRef: expect.stringMatching(/^env:/u),
      graderCredentialRef: expect.stringMatching(/^env:/u),
    });
  });

  it('keeps all committed regression profiles fixed and non-scoring', async () => {
    const catalog = JSON.parse(await readFile(resolve(root, 'fixtures/task-catalog.json'), 'utf8')) as string[];
    for (const name of [
      'grading-regression',
      'terminal-failure-regression',
      'sandbox-regression',
      'infrastructure-regression',
      'failure-recovery-regression',
      'stream-failure-regression',
      'reasoning-only-output-exhaustion-regression',
    ]) {
      const profile = JSON.parse(await readFile(resolve(root, 'profiles', `${name}.json`), 'utf8')) as { nonScoring: boolean; taskIds: string[] };
      expect(profile.nonScoring).toBe(true);
      expect(profile.taskIds.length).toBeGreaterThan(0);
      expect(new Set(profile.taskIds).size).toBe(profile.taskIds.length);
      expect(profile.taskIds.every((taskId) => catalog.includes(taskId))).toBe(true);
    }
  });

  it('fixes the reasoning-only output exhaustion profile to tasks 021 and 037', async () => {
    const profile = JSON.parse(await readFile(resolve(root, 'profiles/reasoning-only-output-exhaustion-regression.json'), 'utf8')) as {
      profileId: string;
      nonScoring: boolean;
      taskIds: string[];
    };

    expect(profile).toEqual({
      profileId: 'reasoning-only-output-exhaustion-regression',
      nonScoring: true,
      taskIds: ['021-batch-rename-transform', '037-policy-clause-retrieval'],
    });
  });

  it('fixes the failure recovery profile to the remaining representative task set', async () => {
    const profile = JSON.parse(await readFile(resolve(root, 'profiles/failure-recovery-regression.json'), 'utf8')) as {
      profileId: string;
      nonScoring: boolean;
      taskIds: string[];
    };

    expect(profile).toEqual({
      profileId: 'failure-recovery-regression',
      nonScoring: true,
      taskIds: [
        '007-session-memory',
        '078-local-api-cursor-retry-ledger',
        '081-local-html-dom-form-extract',
        '088-api-contract-mock-client-compat',
        '091-financial-close-reconciliation',
      ],
    });
  });

  it('fixes the stream failure profile to the August 17 failure set', async () => {
    const profile = JSON.parse(await readFile(resolve(root, 'profiles/stream-failure-regression.json'), 'utf8')) as {
      profileId: string;
      nonScoring: boolean;
      taskIds: string[];
    };

    expect(profile).toEqual({
      profileId: 'stream-failure-regression',
      nonScoring: true,
      taskIds: [
        '037-policy-clause-retrieval',
        '041-frontend-state-bug',
        '042-api-schema-migration',
        '050-multitable-join-analysis',
        '077-archive-manifest-defense',
        '078-local-api-cursor-retry-ledger',
        '079-smallfile-batch-reject-ledger',
        '103-policy-update-replan-diff',
      ],
    });
  });
});
