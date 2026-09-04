import { mkdirSync, mkdtempSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const statSyncMock = vi.hoisted(() => vi.fn());

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  statSyncMock.mockImplementation(actual.statSync);
  return { ...actual, statSync: statSyncMock };
});

import {
  createLocalPortalAbilityConfigProvider,
  createRemotePortalAbilityConfigProvider,
  parsePortalAbilityConfig,
  type PortalAbilityConfigSourceLocator,
} from '../src/config/portal-ability-config.js';

const DEFAULT_TIMEOUT_MS = 30 * 60 * 1000;
const DEFAULT_ENTRY_GATES = {
  cronTasksEnabled: true,
  longTermMemoryManagementEnabled: true,
  knowledgeImportEnabled: true,
  fullProcessEnabled: true,
};

describe('portal ability configuration', () => {
  beforeEach(() => {
    statSyncMock.mockClear();
  });

  it('uses safe defaults when the config block or fields are missing', () => {
    expect(parsePortalAbilityConfig(undefined)).toEqual({
      suggestedQuestionsEnabled: true,
      askUserQuestionTimeoutMs: DEFAULT_TIMEOUT_MS,
      ...DEFAULT_ENTRY_GATES,
    });
    expect(parsePortalAbilityConfig({})).toEqual({
      suggestedQuestionsEnabled: true,
      askUserQuestionTimeoutMs: DEFAULT_TIMEOUT_MS,
      ...DEFAULT_ENTRY_GATES,
    });
  });

  it('rejects invalid values by falling back rather than clamping', () => {
    expect(parsePortalAbilityConfig({ 'suggested-questions-enabled': 'false', 'ask-user-question-time-minutes': 15 })).toEqual({
      suggestedQuestionsEnabled: true,
      askUserQuestionTimeoutMs: 15 * 60 * 1000,
      ...DEFAULT_ENTRY_GATES,
    });

    for (const minutes of [0, -1, 1441, 1.5, '30', null]) {
      expect(parsePortalAbilityConfig({ 'ask-user-question-time-minutes': minutes })).toEqual({
        suggestedQuestionsEnabled: true,
        askUserQuestionTimeoutMs: DEFAULT_TIMEOUT_MS,
        ...DEFAULT_ENTRY_GATES,
      });
    }
  });

  it('accepts the inclusive timeout boundaries', () => {
    expect(parsePortalAbilityConfig({ 'ask-user-question-time-minutes': 1 })).toMatchObject({ askUserQuestionTimeoutMs: 60_000 });
    expect(parsePortalAbilityConfig({ 'ask-user-question-time-minutes': 1440 })).toMatchObject({
      askUserQuestionTimeoutMs: 24 * 60 * 60 * 1000,
    });
  });

  it('ignores unknown fields while preserving known fields', () => {
    expect(
      parsePortalAbilityConfig({
        'suggested-questions-enabled': false,
        'ask-user-question-time-minutes': 60,
        'another-ability': { enabled: false },
      }),
    ).toEqual({
      suggestedQuestionsEnabled: false,
      askUserQuestionTimeoutMs: 60 * 60 * 1000,
      ...DEFAULT_ENTRY_GATES,
    });
  });

  it('parses portal ability entry gates independently with safe defaults', () => {
    expect(
      parsePortalAbilityConfig({
        'cron-tasks-enabled': false,
        'long-term-memory-management-enabled': true,
        'knowledge-import-enabled': false,
        'full-process-enabled': false,
      }),
    ).toEqual({
      suggestedQuestionsEnabled: true,
      askUserQuestionTimeoutMs: DEFAULT_TIMEOUT_MS,
      cronTasksEnabled: false,
      longTermMemoryManagementEnabled: true,
      knowledgeImportEnabled: false,
      fullProcessEnabled: false,
    });

    expect(
      parsePortalAbilityConfig({
        'cron-tasks-enabled': 'false',
        'long-term-memory-management-enabled': null,
        'knowledge-import-enabled': false,
        'full-process-enabled': 'false',
      }),
    ).toEqual({
      suggestedQuestionsEnabled: true,
      askUserQuestionTimeoutMs: DEFAULT_TIMEOUT_MS,
      cronTasksEnabled: true,
      longTermMemoryManagementEnabled: true,
      knowledgeImportEnabled: false,
      fullProcessEnabled: true,
    });
  });

  it('does not hot reload LOCAL configuration after the first read', async () => {
    const { agentRoot, locator, cleanup } = makeAgentDir({
      'suggested-questions-enabled': false,
      'ask-user-question-time-minutes': 60,
    });
    try {
      const provider = createLocalPortalAbilityConfigProvider({ sourceLocator: locator, activeAgentId: 'default-agent' });
      await expect(provider.get()).resolves.toEqual({
        suggestedQuestionsEnabled: false,
        askUserQuestionTimeoutMs: 60 * 60 * 1000,
        ...DEFAULT_ENTRY_GATES,
      });

      writeConfig(agentRoot, {
        'suggested-questions-enabled': true,
        'ask-user-question-time-minutes': 1,
      });
      touch(join(agentRoot, 'config', 'config.json'));

      await expect(provider.get()).resolves.toEqual({
        suggestedQuestionsEnabled: false,
        askUserQuestionTimeoutMs: 60 * 60 * 1000,
        ...DEFAULT_ENTRY_GATES,
      });
    } finally {
      cleanup();
    }
  });

  it('does not check fingerprints in LOCAL mode', async () => {
    const { locator, cleanup } = makeAgentDir({ 'suggested-questions-enabled': false });
    try {
      const provider = createLocalPortalAbilityConfigProvider({ sourceLocator: locator, activeAgentId: 'default-agent' });
      await provider.get();
      expect(statSyncMock).not.toHaveBeenCalled();
    } finally {
      cleanup();
    }
  });

  it('reloads REMOTE configuration when the file fingerprint changes', async () => {
    const { agentRoot, locator, cleanup } = makeAgentDir({ 'suggested-questions-enabled': false, 'ask-user-question-time-minutes': 60 });
    try {
      const provider = createRemotePortalAbilityConfigProvider({ sourceLocator: locator, activeAgentId: 'default-agent' });
      await expect(provider.get()).resolves.toEqual({
        suggestedQuestionsEnabled: false,
        askUserQuestionTimeoutMs: 60 * 60 * 1000,
        ...DEFAULT_ENTRY_GATES,
      });

      const configPath = join(agentRoot, 'config', 'config.json');
      writeConfig(agentRoot, { 'suggested-questions-enabled': true, 'ask-user-question-time-minutes': 1 });
      touch(configPath);
      expect(statSync(configPath).mtimeMs).toBeGreaterThan(0);

      await expect(provider.get()).resolves.toEqual({
        suggestedQuestionsEnabled: true,
        askUserQuestionTimeoutMs: 60_000,
        ...DEFAULT_ENTRY_GATES,
      });
    } finally {
      cleanup();
    }
  });

  it('returns safe defaults when REMOTE config is missing or invalid', async () => {
    const { agentRoot, locator, cleanup } = makeAgentDir({ 'suggested-questions-enabled': false, 'ask-user-question-time-minutes': 60 });
    try {
      const provider = createRemotePortalAbilityConfigProvider({ sourceLocator: locator, activeAgentId: 'default-agent' });
      await expect(provider.get()).resolves.toEqual({
        suggestedQuestionsEnabled: false,
        askUserQuestionTimeoutMs: 60 * 60 * 1000,
        ...DEFAULT_ENTRY_GATES,
      });

      rmSync(join(agentRoot, 'config', 'config.json'));
      await expect(provider.get()).resolves.toEqual({
        suggestedQuestionsEnabled: true,
        askUserQuestionTimeoutMs: DEFAULT_TIMEOUT_MS,
        ...DEFAULT_ENTRY_GATES,
      });

      writeFileSync(join(agentRoot, 'config', 'config.json'), '{invalid-json');
      touch(join(agentRoot, 'config', 'config.json'));
      await expect(provider.get()).resolves.toEqual({
        suggestedQuestionsEnabled: true,
        askUserQuestionTimeoutMs: DEFAULT_TIMEOUT_MS,
        ...DEFAULT_ENTRY_GATES,
      });
    } finally {
      cleanup();
    }
  });
});

function makeAgentDir(config: Record<string, unknown> | null): {
  readonly agentRoot: string;
  readonly locator: PortalAbilityConfigSourceLocator;
  readonly cleanup: () => void;
} {
  const root = mkdtempSync(join(tmpdir(), 'nextagent-portal-config-'));
  const agentRoot = join(root, 'default-agent');
  mkdirSync(join(agentRoot, 'config'), { recursive: true });
  if (config !== null) {
    writeConfig(agentRoot, config);
  }
  return {
    agentRoot,
    locator: {
      async locate(input) {
        expect(input.agentId).toBe('default-agent');
        return { status: 'found', agentPackageRoot: agentRoot };
      },
    },
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  };
}

function writeConfig(agentRoot: string, config: Record<string, unknown>): void {
  writeFileSync(join(agentRoot, 'config', 'config.json'), `${JSON.stringify({ 'portal-ability-config': config }, null, 2)}\n`);
}

function touch(path: string): void {
  const now = new Date(Date.now() + 10_000);
  utimesSync(path, now, now);
}
