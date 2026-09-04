import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { load as parseYaml } from 'js-yaml';
import { createAppCredentialResolver, type AppCredentialResolver } from './env.js';
import { evaluateDefaultSystemConfig, evaluateMemoryConfigSourceUnavailable, requireReadyDefaultSystemConfig } from './validation.js';
import type { DefaultSystemConfig } from './component-config.js';
import type { DefaultSystemConfigEvaluation } from './validation.js';

const getConfigDir = (): string => {
  if (process.env.NEXTAGENT_CONFIG_DIR) {
    return process.env.NEXTAGENT_CONFIG_DIR;
  }
  return resolve(process.cwd(), 'packages', 'agent-app', 'config');
};

export const builtInDefaultSystemConfigPath = resolve(getConfigDir(), 'default-system.yaml');

export interface LoadDefaultSystemConfigOptions {
  readonly cwd?: string;
  readonly configFile?: string;
  readonly credentialResolver?: AppCredentialResolver;
  readonly loggingProfile?: 'development' | 'local' | 'test';
}

export function resolveDefaultSystemConfig(options: LoadDefaultSystemConfigOptions = {}): DefaultSystemConfig {
  return requireReadyDefaultSystemConfig(evaluateDefaultSystemConfigSource(options));
}

export function evaluateDefaultSystemConfigSource(options: LoadDefaultSystemConfigOptions = {}): DefaultSystemConfigEvaluation {
  const userConfigFile = options.configFile;
  const cwd = options.cwd ?? process.cwd();
  const credentialResolver = options.credentialResolver ?? createAppCredentialResolver();
  const resolveEnv = credentialResolver.resolveEnv ?? ((name: string) => process.env[name]);
  let sourceConfig: unknown;
  try {
    const defaultContent = readFileSync(builtInDefaultSystemConfigPath, 'utf8');
    const builtInConfig = parseBuiltInConfig(defaultContent);
    sourceConfig =
      userConfigFile === undefined
        ? builtInConfig
        : mergeConfigOverlay(
            builtInConfig,
            resolveConfigEnvRefs(parseBuiltInConfig(readFileSync(userConfigFile, 'utf8')), resolveEnv, { omitUnresolvedRagIndexes: true }),
          );
  } catch {
    return evaluateMemoryConfigSourceUnavailable();
  }

  const configRoot = userConfigFile === undefined ? (process.env.NEXTAGENT_CONFIG_DIR ?? cwd) : dirname(resolve(userConfigFile));
  return evaluateDefaultSystemConfig(applyChannelEnvOverrides(resolveConfigEnvRefs(sourceConfig, resolveEnv), resolveEnv), configRoot, {
    credentialResolver,
    loggingProfile: options.loggingProfile ?? 'local',
  });
}

export function applyChannelEnvOverrides(input: unknown, resolveEnv: (name: string) => string | undefined): unknown {
  if (!isPlainObject(input) || !isPlainObject(input.channel)) {
    return input;
  }
  const host = resolveEnv('NEXTAGENT_CHANNEL_HOST');
  const portText = resolveEnv('NEXTAGENT_CHANNEL_PORT');
  if (host === undefined && portText === undefined) {
    return input;
  }
  const port = portText !== undefined && /^[1-9][0-9]{0,4}$/u.test(portText) && Number(portText) <= 65_535 ? Number(portText) : portText;
  return {
    ...input,
    channel: {
      ...input.channel,
      ...(host === undefined ? {} : { host }),
      ...(portText === undefined ? {} : { port }),
    },
  };
}

export function parseBuiltInConfig(content: string): unknown {
  try {
    return JSON.parse(content);
  } catch {
    return parseYaml(content);
  }
}

function mergeConfigOverlay(base: unknown, overlay: unknown): unknown {
  if (!isPlainObject(base) || !isPlainObject(overlay)) {
    return overlay;
  }
  const merged: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(overlay)) {
    const baseValue = merged[key];
    merged[key] = isPlainObject(baseValue) && isPlainObject(value) ? mergeConfigOverlay(baseValue, value) : value;
  }
  return merged;
}

function resolveConfigEnvRefs(
  input: unknown,
  resolveEnv: (name: string) => string | undefined,
  options: { readonly omitUnresolvedRagIndexes?: boolean } = {},
): unknown {
  if (!isPlainObject(input)) {
    return input;
  }
  const rag = isPlainObject(input.rag) ? input.rag : undefined;
  const ragWithoutIndexes = rag === undefined ? undefined : omitKey(rag, 'indexes');
  const ragIndexes = rag === undefined ? undefined : resolveRagIndexesEnvRef(rag.indexes, resolveEnv);
  return {
    ...input,
    ...(rag === undefined
      ? {}
      : {
          rag: {
            ...ragWithoutIndexes,
            ...(ragIndexes === undefined && options.omitUnresolvedRagIndexes === true ? {} : { indexes: ragIndexes }),
          },
        }),
    ...(Array.isArray(input.modelProfiles)
      ? {
          modelProfiles: input.modelProfiles.map((profile) => {
            if (!isPlainObject(profile)) {
              return profile;
            }
            return resolveModelProfileEnvRefs(profile, resolveEnv);
          }),
        }
      : {}),
  };
}

export function resolveModelProfileEnvRefs(
  profile: Record<string, unknown>,
  resolveEnv: (name: string) => string | undefined,
): Record<string, unknown> {
  const baseUrl = resolveEnvRef(profile.baseUrl, resolveEnv);
  return {
    ...profile,
    baseUrl,
    ...(Array.isArray(profile.models)
      ? {
          models: profile.models.map((model) =>
            isPlainObject(model) ? { ...model, modelId: resolveModelIdRef(model.modelId, resolveEnv, profile.providerId, baseUrl) } : model,
          ),
        }
      : {}),
  };
}

function resolveModelIdRef(value: unknown, resolveEnv: (name: string) => string | undefined, providerId: unknown, baseUrl: unknown): unknown {
  const resolved = resolveEnvRef(value, resolveEnv);
  return value === 'env:OPENAI_MODEL_NAME' && resolved === value && providerId === 'openai-compatible' && baseUrl === undefined
    ? 'default-model'
    : resolved;
}

function resolveRagIndexesEnvRef(value: unknown, resolveEnv: (name: string) => string | undefined): unknown {
  if (typeof value !== 'string' || !value.startsWith('env:')) {
    return value;
  }
  const resolved = resolveEnv(value.slice('env:'.length));
  if (resolved === undefined || resolved.trim().length === 0) {
    return undefined;
  }
  const parsed = parseJsonStringArray(resolved);
  if (parsed !== undefined) {
    return parsed;
  }
  return resolved
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

function parseJsonStringArray(value: string): readonly string[] | undefined {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) && parsed.every((entry) => typeof entry === 'string') ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function resolveEnvRef(value: unknown, resolveEnv: (name: string) => string | undefined): unknown {
  if (typeof value !== 'string' || !value.startsWith('env:')) {
    return value;
  }
  const resolved = resolveEnv(value.slice('env:'.length));
  return resolved !== undefined && resolved.length > 0 ? resolved : value;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function omitKey(value: Record<string, unknown>, key: string): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [entryKey, entryValue] of Object.entries(value)) {
    if (entryKey !== key) {
      result[entryKey] = entryValue;
    }
  }
  return result;
}
