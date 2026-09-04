import { readFile } from 'node:fs/promises';
import { statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Effective (post-validation) file upload configuration.
 * `hofsBucketName` is an internal storage-selection input; it does not change
 * the staged upload protocol.
 */
export interface ChatUploadFileConfig {
  readonly hofsBucketName?: string;
  readonly chatUploadFileType: readonly string[];
  readonly chatUploadMaxFileNumber: number;
  readonly chatUploadMaxFileSize: number;
  readonly uploadFileIdleExpireTime: number;
  readonly uploadFileMaxExpireTime: number;
}

/**
 * Port for locating agent package root directories.
 * Mirrors the AgentPackageSourceLocator shape from agent-capability
 * without taking a direct dependency on that package.
 */
export interface ChatUploadConfigSourceLocator {
  locate: (input: {
    readonly agentId: string;
  }) => Promise<
    | { readonly status: 'found'; readonly agentPackageRoot: string }
    | { readonly status: 'not-configured' | 'not-found' | 'unavailable' | 'invalid'; readonly safeCode: string }
  >;
}

export interface ChatUploadConfigLoader {
  load: (agentId: string) => Promise<ChatUploadFileConfig>;
}

// System hard limits
const SYSTEM_MAX_FILE_NUMBER = 200;
const SYSTEM_MAX_FILE_SIZE_MB = 500;
const SYSTEM_USER_TMP_QUOTA_MB = 1024;

// Defaults
const DEFAULT_MAX_FILE_NUMBER = 10;
const DEFAULT_MAX_FILE_SIZE_MB = 10;
const DEFAULT_IDLE_EXPIRE_MIN = 5;
const DEFAULT_MAX_EXPIRE_MIN = 30;
// No-config fallback is markdown-only (D1): the platform has no built-in
// parsing capability beyond markdown, so telecom/Office extensions take
// effect only when explicitly listed in `chat-upload-file-type`. ".markdown"
// is part of the markdown-only default per spec.
const DEFAULT_FILE_TYPES: readonly string[] = ['*.md', '*.markdown'];

export function createChatUploadConfigLoader(sourceLocator: ChatUploadConfigSourceLocator): ChatUploadConfigLoader {
  return new DefaultChatUploadConfigLoader(sourceLocator);
}

class DefaultChatUploadConfigLoader implements ChatUploadConfigLoader {
  constructor(private readonly sourceLocator: ChatUploadConfigSourceLocator) {}

  async load(agentId: string): Promise<ChatUploadFileConfig> {
    const located = await this.sourceLocator.locate({ agentId });
    if (located.status !== 'found') {
      return defaultChatUploadFileConfig();
    }
    return loadConfigFromFile(join(located.agentPackageRoot, 'config', 'config.json'));
  }
}

/**
 * Load and validate config from the given JSON path.
 * Returns the validated config when present and well-formed; otherwise returns
 * `undefined` so callers can decide whether to fallback to defaults.
 */
async function loadConfigFromFileStrict(configPath: string): Promise<ChatUploadFileConfig | undefined> {
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
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return undefined;
  }
  const configBlock = (parsed as Record<string, unknown>)['chat-upload-file-config'];
  if (typeof configBlock !== 'object' || configBlock === null || Array.isArray(configBlock)) {
    return undefined;
  }
  return validateConfig(configBlock as Record<string, unknown>);
}

async function loadConfigFromFile(configPath: string): Promise<ChatUploadFileConfig> {
  const config = await loadConfigFromFileStrict(configPath);
  return config ?? defaultChatUploadFileConfig();
}

function validateConfig(raw: Record<string, unknown>): ChatUploadFileConfig {
  const hofsBucketName = parseString(raw['hofs-bucket-name']);

  const chatUploadFileType = parseFileTypeArray(raw['chat-upload-file-type']);
  const chatUploadMaxFileNumber = parseNumber(raw['chat-upload-max-file-number'], DEFAULT_MAX_FILE_NUMBER, SYSTEM_MAX_FILE_NUMBER);
  const chatUploadMaxFileSize = parseNumber(raw['chat-upload-max-file-size'], DEFAULT_MAX_FILE_SIZE_MB, SYSTEM_MAX_FILE_SIZE_MB);
  const uploadFileIdleExpireTime = parseNumber(raw['upload-file-idle-expire-time'], DEFAULT_IDLE_EXPIRE_MIN);
  let uploadFileMaxExpireTime = parseNumber(raw['upload-file-max-expire-time'], DEFAULT_MAX_EXPIRE_MIN);

  if (uploadFileMaxExpireTime < uploadFileIdleExpireTime) {
    uploadFileMaxExpireTime = uploadFileIdleExpireTime;
  }

  return {
    hofsBucketName,
    chatUploadFileType,
    chatUploadMaxFileNumber,
    chatUploadMaxFileSize,
    uploadFileIdleExpireTime,
    uploadFileMaxExpireTime,
  };
}

export function defaultChatUploadFileConfig(): ChatUploadFileConfig {
  return {
    hofsBucketName: '',
    chatUploadFileType: DEFAULT_FILE_TYPES,
    chatUploadMaxFileNumber: DEFAULT_MAX_FILE_NUMBER,
    chatUploadMaxFileSize: DEFAULT_MAX_FILE_SIZE_MB,
    uploadFileIdleExpireTime: DEFAULT_IDLE_EXPIRE_MIN,
    uploadFileMaxExpireTime: DEFAULT_MAX_EXPIRE_MIN,
  };
}

function parseString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function parseNumber(value: unknown, defaultValue: number, maxCap?: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    return defaultValue;
  }
  const intValue = Math.trunc(value);
  if (maxCap !== undefined && intValue > maxCap) {
    return maxCap;
  }
  return intValue;
}

function parseFileTypeArray(value: unknown): readonly string[] {
  if (!Array.isArray(value) || value.length === 0) {
    return DEFAULT_FILE_TYPES;
  }
  const result = value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0);
  return result.length === 0 ? DEFAULT_FILE_TYPES : result;
}

export { SYSTEM_MAX_FILE_NUMBER, SYSTEM_MAX_FILE_SIZE_MB, SYSTEM_USER_TMP_QUOTA_MB };

/**
 * Provider that returns the current effective ChatUploadFileConfig at request
 * time, using file fingerprint (statSync size + mtimeMs) to detect config
 * file changes and reload when needed. Returns undefined when the config file
 * does not exist, signaling that file upload is not configured.
 */
export interface ChatUploadConfigProvider {
  get: () => Promise<ChatUploadFileConfig | undefined>;
}

export interface ChatUploadConfigProviderOptions {
  readonly sourceLocator: ChatUploadConfigSourceLocator;
  readonly activeAgentId: string;
  readonly loadFromFile?: (configPath: string) => Promise<ChatUploadFileConfig>;
}

export function createLocalChatUploadConfigProvider(options: ChatUploadConfigProviderOptions): ChatUploadConfigProvider {
  return new LocalChatUploadConfigProvider(options);
}

export function createRemoteChatUploadConfigProvider(options: ChatUploadConfigProviderOptions): ChatUploadConfigProvider {
  return new RemoteChatUploadConfigProvider(options);
}

/**
 * Backward-compatible alias for callers that expect the original remote
 * fingerprint-based provider.
 */
export const createChatUploadConfigProvider = createRemoteChatUploadConfigProvider;

class LocalChatUploadConfigProvider implements ChatUploadConfigProvider {
  private cached?: Promise<ChatUploadFileConfig>;

  constructor(private readonly options: ChatUploadConfigProviderOptions) {}

  async get(): Promise<ChatUploadFileConfig> {
    if (this.cached === undefined) {
      this.cached = this.loadOnce();
    }
    return this.cached;
  }

  private async loadOnce(): Promise<ChatUploadFileConfig> {
    const located = await this.options.sourceLocator.locate({ agentId: this.options.activeAgentId });
    if (located.status !== 'found') {
      return defaultChatUploadFileConfig();
    }
    const configPath = join(located.agentPackageRoot, 'config', 'config.json');
    try {
      return await (this.options.loadFromFile ?? loadConfigFromFile)(configPath);
    } catch {
      return defaultChatUploadFileConfig();
    }
  }
}

class RemoteChatUploadConfigProvider implements ChatUploadConfigProvider {
  private cachedFingerprint?: string | undefined;
  private cachedConfig?: ChatUploadFileConfig | undefined;

  constructor(private readonly options: ChatUploadConfigProviderOptions) {}

  async get(): Promise<ChatUploadFileConfig | undefined> {
    const located = await this.options.sourceLocator.locate({ agentId: this.options.activeAgentId });
    if (located.status !== 'found') {
      this.cachedFingerprint = undefined;
      this.cachedConfig = undefined;
      return undefined;
    }

    const configPath = join(located.agentPackageRoot, 'config', 'config.json');
    const fingerprint = computeConfigFingerprint(configPath);

    if (fingerprint === undefined) {
      this.cachedFingerprint = undefined;
      this.cachedConfig = undefined;
      return undefined;
    }

    if (fingerprint === this.cachedFingerprint && this.cachedConfig !== undefined) {
      return this.cachedConfig;
    }

    try {
      const config = await (this.options.loadFromFile ?? loadConfigFromFileStrict)(configPath);
      this.cachedFingerprint = fingerprint;
      this.cachedConfig = config;
      return config;
    } catch {
      return undefined;
    }
  }
}

function computeConfigFingerprint(configPath: string): string | undefined {
  try {
    const stat = statSync(configPath);
    return `${configPath}:${stat.size}:${stat.mtimeMs}`;
  } catch {
    return undefined;
  }
}
