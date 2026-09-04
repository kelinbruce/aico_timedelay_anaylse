import { statSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

export interface PortalAbilityConfig {
  readonly suggestedQuestionsEnabled: boolean;
  readonly askUserQuestionTimeoutMs: number;
  readonly cronTasksEnabled: boolean;
  readonly longTermMemoryManagementEnabled: boolean;
  readonly knowledgeImportEnabled: boolean;
  readonly fullProcessEnabled: boolean;
}

export interface PortalAbilityConfigSourceLocator {
  locate: (input: {
    readonly agentId: string;
  }) => Promise<
    | { readonly status: 'found'; readonly agentPackageRoot: string }
    | { readonly status: 'not-configured' | 'not-found' | 'unavailable' | 'invalid'; readonly safeCode: string }
  >;
}

export interface PortalAbilityConfigProvider {
  get: () => Promise<PortalAbilityConfig>;
}

export interface PortalAbilityConfigProviderOptions {
  readonly sourceLocator: PortalAbilityConfigSourceLocator;
  readonly activeAgentId: string;
}

const DEFAULT_SUGGESTED_QUESTIONS_ENABLED = true;
const DEFAULT_ASK_USER_QUESTION_TIMEOUT_MINUTES = 30;
const DEFAULT_ENTRY_ABILITY_ENABLED = true;
const MIN_ASK_USER_QUESTION_TIMEOUT_MINUTES = 1;
const MAX_ASK_USER_QUESTION_TIMEOUT_MINUTES = 24 * 60;

export function defaultPortalAbilityConfig(): PortalAbilityConfig {
  return {
    suggestedQuestionsEnabled: DEFAULT_SUGGESTED_QUESTIONS_ENABLED,
    askUserQuestionTimeoutMs: DEFAULT_ASK_USER_QUESTION_TIMEOUT_MINUTES * 60 * 1000,
    cronTasksEnabled: DEFAULT_ENTRY_ABILITY_ENABLED,
    longTermMemoryManagementEnabled: DEFAULT_ENTRY_ABILITY_ENABLED,
    knowledgeImportEnabled: DEFAULT_ENTRY_ABILITY_ENABLED,
    fullProcessEnabled: DEFAULT_ENTRY_ABILITY_ENABLED,
  };
}

export function parsePortalAbilityConfig(value: unknown): PortalAbilityConfig {
  const defaults = defaultPortalAbilityConfig();
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return defaults;
  }

  const raw = value as Record<string, unknown>;
  const suggestedQuestionsEnabled = raw['suggested-questions-enabled'];
  const askUserQuestionTimeMinutes = raw['ask-user-question-time-minutes'];
  const cronTasksEnabled = raw['cron-tasks-enabled'];
  const longTermMemoryManagementEnabled = raw['long-term-memory-management-enabled'];
  const knowledgeImportEnabled = raw['knowledge-import-enabled'];
  const fullProcessEnabled = raw['full-process-enabled'];
  const minutes =
    typeof askUserQuestionTimeMinutes === 'number' &&
    Number.isSafeInteger(askUserQuestionTimeMinutes) &&
    askUserQuestionTimeMinutes >= MIN_ASK_USER_QUESTION_TIMEOUT_MINUTES &&
    askUserQuestionTimeMinutes <= MAX_ASK_USER_QUESTION_TIMEOUT_MINUTES
      ? askUserQuestionTimeMinutes
      : DEFAULT_ASK_USER_QUESTION_TIMEOUT_MINUTES;

  return {
    suggestedQuestionsEnabled: typeof suggestedQuestionsEnabled === 'boolean' ? suggestedQuestionsEnabled : DEFAULT_SUGGESTED_QUESTIONS_ENABLED,
    askUserQuestionTimeoutMs: minutes * 60 * 1000,
    cronTasksEnabled: parseEntryAbilityEnabled(cronTasksEnabled),
    longTermMemoryManagementEnabled: parseEntryAbilityEnabled(longTermMemoryManagementEnabled),
    knowledgeImportEnabled: parseEntryAbilityEnabled(knowledgeImportEnabled),
    fullProcessEnabled: parseEntryAbilityEnabled(fullProcessEnabled),
  };
}

function parseEntryAbilityEnabled(value: unknown): boolean {
  return value === false ? false : DEFAULT_ENTRY_ABILITY_ENABLED;
}

export function createLocalPortalAbilityConfigProvider(options: PortalAbilityConfigProviderOptions): PortalAbilityConfigProvider {
  return new LocalPortalAbilityConfigProvider(options);
}

export function createRemotePortalAbilityConfigProvider(options: PortalAbilityConfigProviderOptions): PortalAbilityConfigProvider {
  return new RemotePortalAbilityConfigProvider(options);
}

class LocalPortalAbilityConfigProvider implements PortalAbilityConfigProvider {
  private cached?: Promise<PortalAbilityConfig>;

  constructor(private readonly options: PortalAbilityConfigProviderOptions) {}

  async get(): Promise<PortalAbilityConfig> {
    this.cached ??= this.loadOnce();
    return this.cached;
  }

  private async loadOnce(): Promise<PortalAbilityConfig> {
    try {
      const located = await this.options.sourceLocator.locate({ agentId: this.options.activeAgentId });
      if (located.status !== 'found') {
        return defaultPortalAbilityConfig();
      }
      return (await loadPortalAbilityConfigFromFile(join(located.agentPackageRoot, 'config', 'config.json'))) ?? defaultPortalAbilityConfig();
    } catch {
      return defaultPortalAbilityConfig();
    }
  }
}

class RemotePortalAbilityConfigProvider implements PortalAbilityConfigProvider {
  private cachedFingerprint?: string | undefined;
  private cachedConfig?: PortalAbilityConfig | undefined;

  constructor(private readonly options: PortalAbilityConfigProviderOptions) {}

  async get(): Promise<PortalAbilityConfig> {
    const located = await this.options.sourceLocator.locate({ agentId: this.options.activeAgentId });
    if (located.status !== 'found') {
      this.cachedFingerprint = undefined;
      this.cachedConfig = undefined;
      return defaultPortalAbilityConfig();
    }

    const configPath = join(located.agentPackageRoot, 'config', 'config.json');
    const fingerprint = computeConfigFingerprint(configPath);
    if (fingerprint === undefined) {
      this.cachedFingerprint = undefined;
      this.cachedConfig = undefined;
      return defaultPortalAbilityConfig();
    }

    if (fingerprint === this.cachedFingerprint && this.cachedConfig !== undefined) {
      return this.cachedConfig;
    }

    try {
      const config = (await loadPortalAbilityConfigFromFile(configPath)) ?? defaultPortalAbilityConfig();
      this.cachedFingerprint = fingerprint;
      this.cachedConfig = config;
      return config;
    } catch {
      this.cachedFingerprint = undefined;
      this.cachedConfig = undefined;
      return defaultPortalAbilityConfig();
    }
  }
}

async function loadPortalAbilityConfigFromFile(configPath: string): Promise<PortalAbilityConfig | undefined> {
  let raw: string;
  try {
    raw = await readFile(configPath, 'utf-8');
  } catch {
    return undefined;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return undefined;
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return undefined;
  }

  return parsePortalAbilityConfig((parsed as Record<string, unknown>)['portal-ability-config']);
}

function computeConfigFingerprint(configPath: string): string | undefined {
  try {
    const stat = statSync(configPath);
    return `${configPath}:${stat.size}:${stat.mtimeMs}`;
  } catch {
    return undefined;
  }
}
