import { AgentError, brand, deepFreeze, isHttpUrl, isPathInside, type JsonObject, type SecretReference } from '@nextagent/agent-common';
import type { ModelProfile, ModelProviderId, ModelProviderProfile, ReasoningTextMode, ThinkingOptions } from '@nextagent/agent-contracts/model';
import type { CapabilityResultPresentationLevel, CapabilityResultPresentationPolicy } from '@nextagent/agent-channel-common';
import { Type } from '@sinclair/typebox';
import { validateMemoryConfig as validateMemoryOwnerConfig } from '@nextagent/agent-memory';
import { Ajv } from 'ajv/dist/ajv.js';
import { isAbsolute, resolve } from 'node:path';
import type { AppConfigEvaluation, ConfigDiagnostic, ConfigReadinessState, DeploymentMode } from './config-artifacts.js';
import type {
  DefaultSystemConfig,
  GatewayAdapterKind,
  GatewayConfig,
  GatewaySelectionEntry,
  GatewaySelectionSnapshot,
  LocalGatewayConfig,
  MemoryConfig,
  HighFrequencyQuestionConfig,
  ModelProfileValidationEvidence,
  RawCapabilityProviderUserConfig,
  RawDefaultSystemConfig,
  RawMemoryConfig,
  RawPluginSystemConfigEntry,
} from './component-config.js';
import type { AppCredentialResolver } from './env.js';
import { createRuntimePaths } from './paths.js';
import type { CapabilityProvidersConfig, CapabilityProviderUserConfig } from './capability-providers.js';

const nonEmpty = Type.String({ minLength: 1 });
const ragIndexName = Type.String({ minLength: 1, maxLength: 128, pattern: '^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$' });

const capabilityProviderSchema = Type.Object(
  {
    id: nonEmpty,
    // type is intentionally a non-empty string: the resolver owns the closed-set
    // check and emits UNSUPPORTED_PROVIDER_TYPE as a safe diagnostic for unknown
    // values (including BUNDLED / builtin / anything outside the kebab-case set).
    type: nonEmpty,
    path: Type.Optional(nonEmpty),
    gatewayId: Type.Optional(nonEmpty),
    url: Type.Optional(nonEmpty),
    credential: Type.Optional(Type.String({ pattern: '^(env|file):.+' })),
    installDir: Type.Optional(nonEmpty),
    adapter: Type.Optional(nonEmpty),
    config: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
  },
  { additionalProperties: false },
);

const capabilityProvidersSchema = Type.Array(capabilityProviderSchema);

const pluginSystemEntrySchema = Type.Object(
  {
    pluginId: Type.String({ minLength: 1, maxLength: 128, pattern: '^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$' }),
    path: Type.String({
      minLength: 1,
      maxLength: 256,
      pattern: '^(?![A-Za-z][A-Za-z0-9+.-]*:)(?!.*\\.\\.)(?!/)(?!\\\\)(?!.*[?*{}$|&;<>])(?!.*\\.(?:zip|tar|tgz|gz|js|mjs|cjs)$).+',
    }),
    required: Type.Optional(Type.Boolean()),
  },
  { additionalProperties: false },
);

const pluginSystemSchema = Type.Array(pluginSystemEntrySchema, { maxItems: 8 });

const capabilityResultPresentationLevelSchema = Type.Union([Type.Literal('STATUS_ONLY'), Type.Literal('SUMMARY'), Type.Literal('DETAIL')]);

const capabilityResultPresentationSchema = Type.Object(
  {
    'default-level': Type.Optional(capabilityResultPresentationLevelSchema),
    rules: Type.Optional(
      Type.Array(
        Type.Object(
          {
            'capability-id': Type.String({ minLength: 1, maxLength: 128 }),
            level: capabilityResultPresentationLevelSchema,
          },
          { additionalProperties: false },
        ),
        { maxItems: 256 },
      ),
    ),
  },
  { additionalProperties: false },
);

const memorySearchSchema = Type.Object(
  {
    'default-limit': Type.Optional(Type.Integer()),
    'min-confidence': Type.Optional(Type.Number()),
  },
  { additionalProperties: false },
);

const memoryExtractionSchema = Type.Object(
  {
    enabled: Type.Optional(Type.Boolean()),
    strategy: Type.Optional(Type.Union([Type.Literal('RULE_FIRST'), Type.Literal('LLM_ONLY')])),
    crossSessionSchedule: Type.Optional(nonEmpty),
    maxCycleTrajectories: Type.Optional(Type.Integer()),
    maxCandidates: Type.Optional(Type.Integer()),
    timeoutMs: Type.Optional(Type.Integer()),
    lookbackDays: Type.Optional(Type.Integer()),
  },
  { additionalProperties: false },
);

const memoryAgingSchema = Type.Object(
  {
    enabled: Type.Optional(Type.Boolean()),
    schedule: Type.Optional(nonEmpty),
    decayStaleDays: Type.Optional(Type.Integer()),
    archiveRetentionDays: Type.Optional(Type.Integer()),
    decayFactor: Type.Optional(Type.Number()),
    batchLimit: Type.Optional(Type.Integer()),
    timeoutMs: Type.Optional(Type.Integer()),
    reviveConfidenceBoost: Type.Optional(Type.Number()),
  },
  { additionalProperties: false },
);

const memoryConfigSchema = Type.Object(
  {
    enabled: Type.Optional(Type.Boolean()),
    search: Type.Optional(memorySearchSchema),
    extraction: Type.Optional(memoryExtractionSchema),
    aging: Type.Optional(memoryAgingSchema),
  },
  { additionalProperties: false },
);

const defaultSystemSchema = Type.Object(
  {
    deployment: Type.Object(
      {
        mode: Type.Union([Type.Literal('LOCAL'), Type.Literal('REMOTE')]),
        deploymentEntrypointRefs: Type.Optional(
          Type.Object(
            {
              LOCAL: Type.Optional(
                Type.Object(
                  {
                    module: nonEmpty,
                    exportName: nonEmpty,
                  },
                  { additionalProperties: false },
                ),
              ),
              REMOTE: Type.Optional(
                Type.Object(
                  {
                    module: nonEmpty,
                    exportName: nonEmpty,
                  },
                  { additionalProperties: false },
                ),
              ),
            },
            { additionalProperties: false },
          ),
        ),
      },
      { additionalProperties: false },
    ),
    paths: Type.Object(
      {
        workspaceRoot: nonEmpty,
        logDirectory: Type.Optional(nonEmpty),
        skillRoot: Type.Optional(nonEmpty),
        agentRoot: Type.Optional(nonEmpty),
      },
      { additionalProperties: false },
    ),
    observability: Type.Optional(
      Type.Object(
        {
          logging: Type.Optional(
            Type.Object(
              {
                diagnosticDetail: Type.Optional(Type.Union([Type.Literal('normal'), Type.Literal('debug')])),
                level: Type.Optional(Type.Union([Type.Literal('error'), Type.Literal('warn'), Type.Literal('info'), Type.Literal('debug')])),
                console: Type.Optional(Type.Object({ enabled: Type.Optional(Type.Boolean()) }, { additionalProperties: false })),
                file: Type.Optional(
                  Type.Object(
                    {
                      enabled: Type.Optional(Type.Boolean()),
                      directory: Type.Optional(Type.String({ minLength: 1, maxLength: 512 })),
                      name: Type.Optional(
                        Type.String({ pattern: '^(?!nextagent-audit(?:\\.|$))[A-Za-z0-9][A-Za-z0-9._-]*\\.jsonl$', maxLength: 128 }),
                      ),
                      rotation: Type.Optional(
                        Type.Object({ maxFileSizeMiB: Type.Optional(Type.Integer({ minimum: 1, maximum: 30 })) }, { additionalProperties: false }),
                      ),
                      retentionDays: Type.Optional(Type.Integer({ minimum: 7 })),
                      maxArchiveFiles: Type.Optional(Type.Integer({ minimum: 1, maximum: 10 })),
                    },
                    { additionalProperties: false },
                  ),
                ),
              },
              { additionalProperties: false },
            ),
          ),
          tracing: Type.Optional(
            Type.Object(
              {
                enabled: Type.Optional(Type.Boolean()),
                endpoint: Type.Optional(Type.String({ pattern: '^(env|file):.+' })),
                authPkRef: Type.Optional(Type.String({ pattern: '^(env|file):.+' })),
                authSkRef: Type.Optional(Type.String({ pattern: '^(env|file):.+' })),
                serviceName: Type.Optional(Type.String({ minLength: 1, maxLength: 128 })),
              },
              { additionalProperties: false },
            ),
          ),
        },
        { additionalProperties: false },
      ),
    ),
    auth: Type.Object(
      {
        mode: Type.Literal('local'),
        localIdentity: Type.Object(
          {
            tenantId: nonEmpty,
            subjectId: nonEmpty,
            displayName: Type.Optional(nonEmpty),
          },
          { additionalProperties: false },
        ),
        localAuth: Type.Optional(
          Type.Object(
            {
              enabled: Type.Boolean(),
              credentialRef: Type.Optional(Type.String({ pattern: '^(env|file):.+' })),
              cookieTtlMs: Type.Optional(Type.Number({ minimum: 60000, maximum: 86400000 })),
            },
            { additionalProperties: false },
          ),
        ),
      },
      { additionalProperties: false },
    ),
    channel: Type.Object(
      {
        transport: Type.Literal('fastify'),
        host: Type.Optional(nonEmpty),
        port: Type.Optional(Type.Number({ minimum: 1, maximum: 65535 })),
        udsPath: Type.Optional(nonEmpty),
        // Public path prefix P prepended in front of the fixed API segment
        // `/api/v1` for all NextAgent Web APIs. Pages/assets stay at root.
        // Must start with `/`, no trailing slash (except the single `/`
        // meaning "no prefix"), no `..`, no `//`, safe path chars only.
        // Defaults to `/` (no prefix), preserving /api/v1/... deployments.
        routePrefix: Type.Optional(Type.String({ pattern: '^/[A-Za-z0-9/_-]*$', maxLength: 64 })),
      },
      { additionalProperties: false },
    ),
    taskCallback: Type.Optional(
      Type.Object(
        {
          allowedOrigins: Type.Optional(Type.Array(Type.String({ minLength: 1, maxLength: 2048 }), { maxItems: 100 })),
          socketPath: Type.Optional(nonEmpty),
          timeoutMs: Type.Optional(Type.Integer({ minimum: 100, maximum: 120_000 })),
          maxRetries: Type.Optional(Type.Integer({ minimum: 1, maximum: 10 })),
          tlsInsecure: Type.Optional(Type.Boolean()),
        },
        { additionalProperties: false },
      ),
    ),
    hostedAgent: Type.Object(
      {
        activeAgentId: nonEmpty,
      },
      { additionalProperties: false },
    ),
    modelProfiles: Type.Array(Type.Unknown(), { minItems: 1 }),
    gateway: Type.Optional(
      Type.Object(
        {
          gateways: Type.Array(
            Type.Object(
              {
                gatewayId: nonEmpty,
                gatewayKind: Type.Union([
                  Type.Literal('working-memory'),
                  Type.Literal('long-term-memory'),
                  Type.Literal('sqlite'),
                  Type.Literal('sandbox'),
                  Type.Literal('scheduled-maintenance'),
                  Type.Literal('cron-tasks'),
                  Type.Literal('rag-knowledge'),
                  Type.Literal('skillhub'),
                  Type.Literal('workflow-execution'),
                  Type.Literal('user-query'),
                  Type.Literal('guardrail'),
                  Type.Literal('watermark'),
                  Type.Literal('api-call'),
                ]),
                deploymentMode: Type.Union([Type.Literal('LOCAL'), Type.Literal('REMOTE')]),
                sqliteFileRef: Type.Optional(Type.Literal('paths.sqliteFile')),
                endpoint: Type.Optional(Type.String({ pattern: '^https?://.+' })),
              },
              { additionalProperties: false },
            ),
            { minItems: 1 },
          ),
        },
        { additionalProperties: false },
      ),
    ),
    rag: Type.Optional(
      Type.Object(
        {
          indexes: Type.Array(ragIndexName, { minItems: 1, maxItems: 5, uniqueItems: true }),
        },
        { additionalProperties: false },
      ),
    ),
    noopBoundaries: Type.Object(
      {
        lifecycleHook: Type.Literal('noop'),
        checkpoint: Type.Literal('noop'),
        audit: Type.Literal('noop'),
      },
      { additionalProperties: false },
    ),
    workflowTrace: Type.Optional(
      Type.Object(
        {
          enabled: Type.Boolean(),
        },
        { additionalProperties: false },
      ),
    ),
    sandbox: Type.Optional(
      Type.Object(
        {
          allowedApis: Type.Optional(Type.Array(nonEmpty, { uniqueItems: true })),
          allowedExecutables: Type.Optional(Type.Array(nonEmpty, { uniqueItems: true })),
          clipcExecutableDirectoryEnv: Type.Optional(nonEmpty),
          clipPathRef: Type.Optional(nonEmpty),
          deniedExecutables: Type.Optional(Type.Array(nonEmpty, { uniqueItems: true })),
          enabled: Type.Optional(Type.Boolean()),
        },
        { additionalProperties: false },
      ),
    ),
    nextAgent: Type.Optional(
      Type.Object(
        {
          system: Type.Optional(
            Type.Object(
              {
                'capability-providers': Type.Optional(capabilityProvidersSchema),
                plugins: Type.Optional(pluginSystemSchema),
                'capability-disclosure': Type.Optional(
                  Type.Object(
                    {
                      'tool-disclosure-mode': Type.Optional(Type.Union([Type.Literal('list'), Type.Literal('tool-search')])),
                      'skill-disclosure-mode': Type.Optional(Type.Union([Type.Literal('list'), Type.Literal('tool-search')])),
                      'clipc-disclosure-mode': Type.Optional(Type.Union([Type.Literal('list'), Type.Literal('tool-search')])),
                    },
                    { additionalProperties: false },
                  ),
                ),
                'capability-result-presentation': Type.Optional(capabilityResultPresentationSchema),
                'planning-tool-calling-mode': Type.Optional(Type.Union([Type.Literal('todo-write'), Type.Literal('task-tools')])),
              },
              { additionalProperties: false },
            ),
          ),
          memory: Type.Optional(memoryConfigSchema),
          highFrequencyQuestion: Type.Optional(
            Type.Object(
              {
                frequencyThreshold: Type.Optional(Type.Integer({ minimum: 0, maximum: 1000 })),
              },
              { additionalProperties: false },
            ),
          ),
        },
        { additionalProperties: false },
      ),
    ),
  },
  { additionalProperties: false },
);

const ajv = new Ajv({ allErrors: true });
const validateDefaultSystem = ajv.compile(defaultSystemSchema);
const supportedModelProviderIds = new Set<ModelProviderId>(['openai-compatible', 'model-gateway']);
const allowedProviderProfileKeys = new Set(['providerId', 'baseUrl', 'credentialRef', 'models']);
const allowedModelProfileKeys = new Set([
  'modelId',
  'displayName',
  'contextWindowTokens',
  'fallbackEligible',
  'temperature',
  'maxOutputTokens',
  'topP',
  'topK',
  'presencePenalty',
  'frequencyPenalty',
  'thinking',
  'providerOptions',
  'reasoningTextMode',
  'timeoutMs',
  'maxRetries',
]);

export interface DefaultSystemConfigValidationOptions {
  readonly credentialResolver: Pick<AppCredentialResolver, 'validate'>;
  readonly loggingProfile?: 'development' | 'local' | 'test';
}

export interface DefaultSystemConfigEvaluation {
  readonly status: ConfigReadinessState;
  readonly evidenceInput: AppConfigEvaluation;
  readonly config?: DefaultSystemConfig;
}

export function validateDefaultSystemConfig(input: unknown, baseDir: string, options: DefaultSystemConfigValidationOptions): DefaultSystemConfig {
  const result = evaluateDefaultSystemConfig(input, baseDir, options);
  return requireReadyDefaultSystemConfig(result);
}

export function requireReadyDefaultSystemConfig(result: DefaultSystemConfigEvaluation): DefaultSystemConfig {
  if (result.status === 'BLOCKED' || result.config === undefined) {
    throw new AgentError({
      code: 'APP_CONFIG_BLOCKED',
      message: 'App configuration is blocked before ready.',
      category: 'VALIDATION',
      retryable: false,
      safeDetails: {
        issues: result.evidenceInput.diagnostics.map((entry) => entry.safeMessage),
      },
    });
  }
  return result.config;
}

export function evaluateMemoryConfigSourceUnavailable(): DefaultSystemConfigEvaluation {
  const evaluatedAt = new Date().toISOString();
  return blocked(evaluatedAt, [memoryInvalid('MEMORY_CONFIG_SOURCE_UNAVAILABLE', 'nextAgent.memory', 'Memory configuration source is unavailable.')]);
}

export function evaluateDefaultSystemConfig(
  input: unknown,
  baseDir: string,
  options: DefaultSystemConfigValidationOptions,
): DefaultSystemConfigEvaluation {
  const evaluatedAt = new Date().toISOString();
  const issues: ConfigDiagnostic[] = [];
  const ownershipIssue = findOwnershipIssue(input);
  if (ownershipIssue !== undefined) {
    return blocked(evaluatedAt, [ownershipIssue]);
  }
  const memoryConfigIssue = findMemoryConfigIssue(input);
  if (memoryConfigIssue !== undefined) {
    return blocked(evaluatedAt, [memoryConfigIssue]);
  }
  if (!validateDefaultSystem(input)) {
    return blocked(evaluatedAt, [
      issue('APP_CONFIG_SCHEMA_INVALID', 'app', 'default-system', 'Default system configuration failed schema validation.', true),
    ]);
  }

  const raw = input as RawDefaultSystemConfig;
  const allowedApis = normalizeAllowedApis(raw.sandbox?.allowedApis);
  if (allowedApis === undefined) {
    return blocked(evaluatedAt, [
      issue('APP_CONFIG_SANDBOX_ALLOWED_APIS_INVALID', 'app', 'sandbox.allowedApis', 'Sandbox allowed API prefixes are invalid.', true),
    ]);
  }
  const capabilityResultPresentationIssue = validateCapabilityResultPresentationConfig(raw);
  if (capabilityResultPresentationIssue !== undefined) {
    return blocked(evaluatedAt, [capabilityResultPresentationIssue]);
  }
  const tracingIssue = validateTracingConfig(raw);
  if (tracingIssue !== undefined) {
    return blocked(evaluatedAt, [tracingIssue]);
  }
  const localAuthIssue = validateLocalAuthConfig(raw, options.credentialResolver.validate);
  if (localAuthIssue !== undefined) {
    return blocked(evaluatedAt, [localAuthIssue]);
  }

  const gatewayConfig = raw.gateway ?? DEFAULT_LOCAL_GATEWAY_CONFIG;
  const gatewaySection = validateGatewaySection(gatewayConfig, evaluatedAt);
  issues.push(...gatewaySection.issues);
  if (gatewaySection.primaryGateway === undefined || gatewaySection.issues.some((entry) => entry.affectsReadiness)) {
    return blocked(evaluatedAt, issues);
  }
  const selectedGateway = gatewaySection.primaryGateway;

  const profileValidation = validateModelProfiles(raw.modelProfiles, options.credentialResolver.validate);
  if (profileValidation.status === 'blocked') {
    return blocked(evaluatedAt, profileValidation.issues);
  }
  issues.push(...profileValidation.issues);

  let config: DefaultSystemConfig;
  try {
    config = createConfig(
      raw,
      allowedApis,
      profileValidation.profiles,
      profileValidation.evidence,
      selectedGateway,
      gatewaySection.selectionSnapshot,
      baseDir,
      options.loggingProfile ?? 'local',
      evaluatedAt,
      issues.some((entry) => !entry.affectsReadiness) ? 'DEGRADED_READY' : 'READY',
      issues,
    );
  } catch {
    return blocked(evaluatedAt, [issue('APP_CONFIG_PATH_INVALID', 'paths', 'paths', 'Runtime path configuration is invalid.', true)]);
  }
  return { status: config.configEvaluation.readinessState, evidenceInput: config.configEvaluation, config };
}

function validateCapabilityResultPresentationConfig(raw: RawDefaultSystemConfig): ConfigDiagnostic | undefined {
  const rules = raw.nextAgent?.system?.['capability-result-presentation']?.rules ?? [];
  const seen = new Set<string>();
  for (const rule of rules) {
    if (seen.has(rule['capability-id'])) {
      return issue(
        'APP_CONFIG_CAPABILITY_RESULT_PRESENTATION_DUPLICATE',
        'app',
        'nextAgent.system.capability-result-presentation.rules',
        'Capability result presentation rules contain a duplicate capability id.',
        true,
      );
    }
    seen.add(rule['capability-id']);
  }
  return undefined;
}

function createConfig(
  raw: RawDefaultSystemConfig,
  allowedApis: readonly string[],
  acceptedProfiles: readonly ModelProviderProfile[],
  modelProfileValidationEvidence: readonly ModelProfileValidationEvidence[],
  selectedGateway: LocalGatewayConfig,
  gatewaySelection: GatewaySelectionSnapshot,
  baseDir: string,
  loggingProfile: 'development' | 'local' | 'test',
  evaluatedAt: string,
  readiness: Exclude<ConfigReadinessState, 'BLOCKED'>,
  issues: readonly ConfigDiagnostic[],
): DefaultSystemConfig {
  const paths = createRuntimePaths(baseDir, raw.paths);
  const loggingDirectory = resolveLoggingDirectory(raw.observability?.logging?.file?.directory, paths.logDirectory);
  const loggingDefaults = loggingSinkDefaults(loggingProfile);
  const localAuth = raw.auth.localAuth;
  const configEvaluation: AppConfigEvaluation = Object.freeze({
    readinessState: readiness,
    diagnostics: Object.freeze([...issues]),
    evaluatedAt,
  });
  return {
    deployment: raw.deployment,
    activeAgentId: brand<string, 'AgentId'>(raw.hostedAgent.activeAgentId),
    paths,
    observability: {
      logging: {
        diagnosticDetail: raw.observability?.logging?.diagnosticDetail ?? 'normal',
        level: raw.observability?.logging?.level ?? 'info',
        console: {
          enabled: raw.observability?.logging?.console?.enabled ?? loggingDefaults.console,
        },
        file: {
          enabled: raw.observability?.logging?.file?.enabled ?? loggingDefaults.file,
          directory: loggingDirectory,
          name: raw.observability?.logging?.file?.name ?? 'nextagent-operational.log.jsonl',
          rotation: {
            maxFileSizeMiB: raw.observability?.logging?.file?.rotation?.maxFileSizeMiB ?? 30,
          },
          retentionDays: raw.observability?.logging?.file?.retentionDays ?? 7,
          maxArchiveFiles: raw.observability?.logging?.file?.maxArchiveFiles ?? 10,
        },
      },
      ...(raw.observability?.tracing !== undefined
        ? {
            tracing: {
              enabled: raw.observability.tracing.enabled ?? exporterConfigComplete(raw.observability.tracing),
              ...(raw.observability.tracing.endpoint === undefined
                ? {}
                : {
                    endpoint: brand<`env:${string}` | `file:${string}`, 'SecretReference'>(
                      raw.observability.tracing.endpoint as `env:${string}` | `file:${string}`,
                    ),
                  }),
              ...(raw.observability.tracing.authPkRef === undefined
                ? {}
                : {
                    authPkRef: brand<`env:${string}` | `file:${string}`, 'SecretReference'>(
                      raw.observability.tracing.authPkRef as `env:${string}` | `file:${string}`,
                    ),
                  }),
              ...(raw.observability.tracing.authSkRef === undefined
                ? {}
                : {
                    authSkRef: brand<`env:${string}` | `file:${string}`, 'SecretReference'>(
                      raw.observability.tracing.authSkRef as `env:${string}` | `file:${string}`,
                    ),
                  }),
              ...(raw.observability.tracing.serviceName === undefined ? {} : { serviceName: raw.observability.tracing.serviceName }),
            },
          }
        : {}),
    },
    capabilityDisclosure: {
      toolDisclosureMode: raw.nextAgent?.system?.['capability-disclosure']?.['tool-disclosure-mode'] ?? 'list',
      skillDisclosureMode: raw.nextAgent?.system?.['capability-disclosure']?.['skill-disclosure-mode'] ?? 'list',
      clipcDisclosureMode: raw.nextAgent?.system?.['capability-disclosure']?.['clipc-disclosure-mode'] ?? 'list',
    },
    capabilityResultPresentationPolicy: normalizeCapabilityResultPresentationPolicy(raw),
    planningToolCallingMode: raw.nextAgent?.system?.['planning-tool-calling-mode'] ?? 'todo-write',
    auth: {
      mode: raw.auth.mode,
      localIdentity: raw.auth.localIdentity,
      ...(localAuth === undefined
        ? {}
        : {
            localAuth: {
              enabled: localAuth.enabled,
              ...(localAuth.credentialRef === undefined
                ? {}
                : {
                    credentialRef: brand<`env:${string}` | `file:${string}`, 'SecretReference'>(
                      localAuth.credentialRef as `env:${string}` | `file:${string}`,
                    ),
                  }),
              ...(localAuth.cookieTtlMs === undefined ? {} : { cookieTtlMs: localAuth.cookieTtlMs }),
            },
          }),
    },
    channel: { ...raw.channel, routePrefix: raw.channel.routePrefix ?? '/' },
    taskCallback: normalizeTaskCallbackConfig(raw),
    hostedAgent: { activeAgentId: brand<string, 'AgentId'>(raw.hostedAgent.activeAgentId) },
    modelProfiles: Object.freeze([...acceptedProfiles]),
    userCapabilityProviders: normalizeCapabilityProvidersConfig(raw.nextAgent?.system?.['capability-providers']),
    pluginSystem: { plugins: normalizePluginSystemConfig(raw.nextAgent?.system?.plugins) },
    gateway: selectedGateway,
    gatewaySelection,
    rag: {
      indexes: Object.freeze([...(raw.rag?.indexes ?? ['local'])]),
    },
    sandbox: {
      allowedApis,
      ...(raw.sandbox?.allowedExecutables === undefined ? {} : { allowedExecutables: raw.sandbox.allowedExecutables }),
      clipcExecutableDirectoryEnv: raw.sandbox?.clipcExecutableDirectoryEnv ?? 'CLIP_HOME',
      clipPathRef: raw.sandbox?.clipPathRef ?? 'clipc',
      deniedExecutables: raw.sandbox?.deniedExecutables ?? [],
      enabled: raw.sandbox?.enabled ?? true,
    },
    memory: normalizeMemoryConfig(raw),
    highFrequencyQuestion: normalizeHighFrequencyQuestionConfig(raw),
    modelProfileValidationEvidence: Object.freeze(modelProfileValidationEvidence.map((item) => Object.freeze({ ...item }))),
    noopBoundaries: raw.noopBoundaries,
    ...(raw.workflowTrace === undefined ? {} : { workflowTrace: { enabled: raw.workflowTrace.enabled } }),
    configEvaluation,
  };
}

function normalizeAllowedApis(values?: readonly string[]): readonly string[] | undefined {
  const normalized: string[] = [];
  const seen = new Set<string>();
  for (const value of values ?? []) {
    let parsed: URL;
    try {
      parsed = new URL(value);
    } catch {
      return undefined;
    }
    if (
      (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') ||
      parsed.username.length > 0 ||
      parsed.password.length > 0 ||
      value.includes('?') ||
      value.includes('#') ||
      !parsed.pathname.endsWith('/')
    ) {
      return undefined;
    }
    const canonical = parsed.href;
    if (seen.has(canonical)) {
      return undefined;
    }
    seen.add(canonical);
    normalized.push(canonical);
  }
  return Object.freeze(normalized);
}

function normalizeCapabilityResultPresentationPolicy(raw: RawDefaultSystemConfig): CapabilityResultPresentationPolicy {
  const presentation = raw.nextAgent?.system?.['capability-result-presentation'];
  const levels = new Map<string, CapabilityResultPresentationLevel>(builtInCapabilityResultPresentationLevels);
  for (const rule of presentation?.rules ?? []) {
    levels.set(rule['capability-id'], rule.level);
  }
  return Object.freeze({
    defaultLevel: presentation?.['default-level'] ?? 'SUMMARY',
    levelByCapabilityId: new ImmutableReadonlyMap([...levels.entries()]),
  });
}

const builtInCapabilityResultPresentationLevels = [
  ['Rag', 'DETAIL'],
  ['Skill', 'STATUS_ONLY'],
  ['Agent', 'STATUS_ONLY'],
  ['ApiCall', 'STATUS_ONLY'],
  ['search_memory', 'STATUS_ONLY'],
  ['get_memory_detail', 'STATUS_ONLY'],
  ['add_memory', 'STATUS_ONLY'],
  ['acquire_skill', 'STATUS_ONLY'],
  ['AskUserQuestion', 'DETAIL'],
  ['TodoWrite', 'DETAIL'],
  ['Cron', 'DETAIL'],
  ['Read', 'SUMMARY'],
  ['Write', 'SUMMARY'],
  ['Edit', 'SUMMARY'],
  ['Glob', 'SUMMARY'],
  ['Grep', 'SUMMARY'],
  ['Bash', 'DETAIL'],
  ['Python', 'DETAIL'],
  ['ToolSearch', 'SUMMARY'],
  ['Workflow', 'SUMMARY'],
] as const satisfies ReadonlyArray<readonly [string, CapabilityResultPresentationLevel]>;

class ImmutableReadonlyMap<K, V> implements ReadonlyMap<K, V> {
  readonly #values: ReadonlyMap<K, V>;

  public constructor(entries: ReadonlyArray<readonly [K, V]>) {
    this.#values = new Map(entries);
    Object.freeze(this);
  }

  public get size(): number {
    return this.#values.size;
  }

  public entries(): MapIterator<[K, V]> {
    return this.#values.entries();
  }

  public forEach(callbackfn: (value: V, key: K, map: ReadonlyMap<K, V>) => void, thisArg?: unknown): void {
    this.#values.forEach((value, key) => callbackfn.call(thisArg, value, key, this));
  }

  public get(key: K): V | undefined {
    return this.#values.get(key);
  }

  public has(key: K): boolean {
    return this.#values.has(key);
  }

  public keys(): MapIterator<K> {
    return this.#values.keys();
  }

  public values(): MapIterator<V> {
    return this.#values.values();
  }

  public [Symbol.iterator](): MapIterator<[K, V]> {
    return this.entries();
  }

  public readonly [Symbol.toStringTag] = 'ImmutableReadonlyMap';
}

function loggingSinkDefaults(profile: 'development' | 'local' | 'test'): { readonly console: boolean; readonly file: boolean } {
  if (profile === 'development') {
    return { console: true, file: false };
  }
  if (profile === 'test') {
    return { console: false, file: false };
  }
  return { console: false, file: true };
}

function resolveLoggingDirectory(configuredDirectory: string | undefined, logDirectory: string): string {
  if (configuredDirectory === undefined) {
    return logDirectory;
  }
  const directory = isAbsolute(configuredDirectory) ? resolve(configuredDirectory) : resolve(logDirectory, configuredDirectory);
  if (!isPathInside(logDirectory, directory)) {
    throw new TypeError('Runtime logging directory must stay within the trusted log directory.');
  }
  return directory;
}

function normalizePluginSystemConfig(
  raw?: readonly RawPluginSystemConfigEntry[],
): ReadonlyArray<{ readonly pluginId: string; readonly path: string; readonly required: boolean }> {
  if (raw === undefined) {
    return Object.freeze([]);
  }
  const seen = new Set<string>();
  const result = raw.map((entry) => {
    if (entry.pluginId === undefined || entry.path === undefined) {
      throw new AgentError({
        code: 'APP_CONFIG_INVALID',
        message: 'Plugin system config entries require pluginId and path.',
        category: 'VALIDATION',
        retryable: false,
      });
    }
    if (seen.has(entry.pluginId)) {
      throw new AgentError({
        code: 'APP_CONFIG_INVALID',
        message: 'Duplicate plugin system config id.',
        category: 'VALIDATION',
        retryable: false,
      });
    }
    seen.add(entry.pluginId);
    return Object.freeze({
      pluginId: entry.pluginId,
      path: entry.path,
      required: entry.required ?? true,
    });
  });
  return Object.freeze(result);
}

function normalizeMemoryConfig(raw: RawDefaultSystemConfig): MemoryConfig {
  const result = validateMemoryOwnerConfig(raw.nextAgent?.memory);
  if (result.status === 'invalid') {
    throw new AgentError({
      code: 'APP_CONFIG_MEMORY_INVALID',
      message: 'Memory configuration is invalid.',
      category: 'VALIDATION',
      retryable: false,
    });
  }
  return result.config;
}

function normalizeHighFrequencyQuestionConfig(raw: RawDefaultSystemConfig): HighFrequencyQuestionConfig {
  const config = raw.nextAgent?.highFrequencyQuestion;
  return {
    frequencyThreshold: config?.frequencyThreshold ?? 8,
  };
}

function normalizeTaskCallbackConfig(raw: RawDefaultSystemConfig): DefaultSystemConfig['taskCallback'] {
  const allowedOrigins = (raw.taskCallback?.allowedOrigins ?? []).map((origin) => {
    try {
      const parsed = new URL(origin);
      if (
        parsed.origin !== origin ||
        (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') ||
        parsed.username.length > 0 ||
        parsed.password.length > 0
      ) {
        throw new Error('origin only');
      }
      return parsed.origin;
    } catch {
      throw new AgentError({
        code: 'APP_CONFIG_TASK_CALLBACK_INVALID',
        message: 'Task callback configuration is invalid.',
        category: 'VALIDATION',
        retryable: false,
      });
    }
  });
  return {
    allowedOrigins: Object.freeze(allowedOrigins),
    ...(raw.taskCallback?.socketPath === undefined ? {} : { socketPath: raw.taskCallback.socketPath }),
    timeoutMs: raw.taskCallback?.timeoutMs ?? 30_000,
    maxRetries: raw.taskCallback?.maxRetries ?? 3,
    ...(raw.taskCallback?.tlsInsecure === true ? { tlsInsecure: true } : {}),
  };
}

function validateTracingConfig(_raw: RawDefaultSystemConfig): ConfigDiagnostic | undefined {
  return undefined;
}

function exporterConfigComplete(tracing: NonNullable<NonNullable<RawDefaultSystemConfig['observability']>['tracing']>): boolean {
  return tracing.endpoint !== undefined;
}

function validateLocalAuthConfig(raw: RawDefaultSystemConfig, validateSecret: AppCredentialResolver['validate']): ConfigDiagnostic | undefined {
  const localAuth = raw.auth.localAuth;
  if (localAuth?.enabled !== true) {
    return undefined;
  }
  if (localAuth.credentialRef === undefined) {
    return issue(
      'APP_CONFIG_LOCAL_AUTH_SECRET_REQUIRED',
      'auth',
      'auth.localAuth.credentialRef',
      'Local auth credential reference is required when local auth is enabled.',
      true,
    );
  }
  if (localAuth.cookieTtlMs === undefined) {
    return issue(
      'APP_CONFIG_LOCAL_AUTH_COOKIE_TTL_REQUIRED',
      'auth',
      'auth.localAuth.cookieTtlMs',
      'Local auth cookie TTL is required when local auth is enabled.',
      true,
    );
  }
  const secret = validateSecret(localAuth.credentialRef);
  if (!secret.valid) {
    return issue(
      secret.issueCode ?? 'APP_CONFIG_SECRET_REF_UNAVAILABLE',
      'auth',
      'auth.localAuth.credentialRef',
      'Local auth credential reference must be resolvable before ready.',
      true,
    );
  }
  return undefined;
}

const REGISTERED_GATEWAY_ADAPTERS: ReadonlySet<GatewayAdapterKind> = new Set<GatewayAdapterKind>([
  'working-memory',
  'long-term-memory',
  'sqlite',
  'sandbox',
  'scheduled-maintenance',
  'cron-tasks',
  'rag-knowledge',
  'skillhub',
  'workflow-execution',
  'user-query',
  'guardrail',
  'watermark',
  'api-call',
]);

// Default local gateway applied when the source configuration omits the
// gateway section entirely. This keeps single-process local deployments
// working without an explicit gateway entry.
const DEFAULT_LOCAL_GATEWAY_CONFIG: GatewayConfig = {
  gateways: [
    { gatewayId: 'local-working-memory', gatewayKind: 'working-memory', deploymentMode: 'LOCAL' },
    { gatewayId: 'local-long-term-memory', gatewayKind: 'long-term-memory', deploymentMode: 'LOCAL' },
    { gatewayId: 'local-sqlite', gatewayKind: 'sqlite', deploymentMode: 'LOCAL', sqliteFileRef: 'paths.sqliteFile' },
    { gatewayId: 'local-cron', gatewayKind: 'cron-tasks', deploymentMode: 'LOCAL', sqliteFileRef: 'paths.sqliteFile' },
    { gatewayId: 'local-rag', gatewayKind: 'rag-knowledge', deploymentMode: 'LOCAL' },
    { gatewayId: 'local-workflow', gatewayKind: 'workflow-execution', deploymentMode: 'LOCAL' },
    { gatewayId: 'local-api-call', gatewayKind: 'api-call', deploymentMode: 'LOCAL' },
    { gatewayId: 'local-user-query', gatewayKind: 'user-query', deploymentMode: 'LOCAL' },
  ],
};

interface GatewaySectionValidation {
  readonly primaryGateway?: LocalGatewayConfig | undefined;
  readonly selectionSnapshot: GatewaySelectionSnapshot;
  readonly issues: readonly ConfigDiagnostic[];
}

// Validates the gateway section following the deterministic rule order from the
// gateway-configuration spec: structure (schema) -> gatewayId uniqueness ->
// adapter registration -> adapter-kind uniqueness -> selected entries.
// Produces the frozen selection snapshot and a diagnostics contribution that
// merges into the app-level config validation result.
function validateGatewaySection(gatewayConfig: GatewayConfig, evaluatedAt: string): GatewaySectionValidation {
  const issues: ConfigDiagnostic[] = [];
  const selectionEntries: GatewaySelectionEntry[] = [];
  const seenGatewayIds = new Set<string>();
  const seenAdapterKinds = new Set<GatewayAdapterKind>();
  let primaryGateway: LocalGatewayConfig | undefined;

  for (const gateway of gatewayConfig.gateways) {
    const { gatewayId, gatewayKind } = gateway;
    const adapterKind = gatewayKind as GatewayAdapterKind;

    // rule 3: gatewayId must be unique within the gateway source set
    if (seenGatewayIds.has(gatewayId)) {
      issues.push(
        gatewayIssue(
          'APP_CONFIG_GATEWAY_DUPLICATE_ID',
          `gateway.gateways.${gatewayId}.gatewayId`,
          'Gateway identifier must be unique within the gateway source set.',
          true,
        ),
      );
      continue;
    }
    seenGatewayIds.add(gatewayId);

    // rule 4: adapter kind must be registered for the current product
    if (!REGISTERED_GATEWAY_ADAPTERS.has(adapterKind)) {
      issues.push(
        gatewayIssue(
          'APP_CONFIG_GATEWAY_ADAPTER_UNREGISTERED',
          `gateway.gateways.${gatewayId}.gatewayKind`,
          'Gateway adapter kind is not registered for the current product.',
          true,
        ),
      );
    }

    // rule 5: each adapter kind may appear at most once in the source set
    if (seenAdapterKinds.has(adapterKind)) {
      issues.push(
        gatewayIssue(
          'APP_CONFIG_GATEWAY_DUPLICATE_ADAPTER_KIND',
          `gateway.gateways.${gatewayId}.gatewayKind`,
          'Each gateway adapter kind may appear at most once in the gateway source set.',
          true,
        ),
      );
      continue;
    }
    seenAdapterKinds.add(adapterKind);

    // rule 6: each configured entry enters the enabled selection snapshot; the
    // concrete injected provider decides whether that deploymentMode supports
    // the adapter kind during app composition.
    selectionEntries.push({
      gatewayId,
      adapterKind,
      deploymentMode: gateway.deploymentMode,
      selectionState: 'enabled',
      ...(gateway.endpoint === undefined ? {} : { endpoint: gateway.endpoint }),
    });
    primaryGateway ??= gateway;
  }

  // at least one selected entry is required for startup.
  if (primaryGateway === undefined) {
    issues.push(
      gatewayIssue('APP_CONFIG_GATEWAY_UNAVAILABLE', 'gateway.gateways', 'At least one selected gateway entry is required for startup.', true),
    );
  }

  const selectionSnapshot: GatewaySelectionSnapshot = Object.freeze({
    entries: Object.freeze(selectionEntries),
    validatedAt: evaluatedAt,
    readinessState: issues.some((entry) => entry.affectsReadiness) ? 'BLOCKED' : 'READY',
    diagnosticRef: 'gateway',
  });

  return { primaryGateway, selectionSnapshot, issues };
}

function gatewayIssue(issueCode: string, fieldRef: string, safeMessage: string, affectsReadiness: boolean): ConfigDiagnostic {
  return {
    issueCode,
    severity: affectsReadiness ? 'ERROR' : 'WARNING',
    scope: 'gateway',
    fieldRef,
    safeMessage,
    affectsReadiness,
  };
}

function normalizeCapabilityProvidersConfig(raw?: readonly RawCapabilityProviderUserConfig[]): CapabilityProvidersConfig {
  const providers = raw ?? [];
  return providers.map<CapabilityProviderUserConfig>((provider) => {
    // The schema only requires `type` to be a non-empty string; closed-set
    // validation is owned by the resolver so unknown values surface as a
    // safe UNSUPPORTED_PROVIDER_TYPE diagnostic instead of throwing here.
    const entry: CapabilityProviderUserConfig = {
      id: requireNonEmptyString(provider.id, 'id'),
      type: provider.type as string,
      ...(provider.path === undefined ? {} : { path: provider.path }),
      ...(provider.gatewayId === undefined ? {} : { gatewayId: provider.gatewayId }),
      ...(provider.url === undefined ? {} : { url: provider.url }),
      ...(provider.credential === undefined ? {} : { credential: brandSecretReference(provider.credential) }),
      ...(provider.installDir === undefined ? {} : { installDir: provider.installDir }),
      ...(provider.adapter === undefined ? {} : { adapter: provider.adapter }),
      ...(provider.config === undefined || provider.config === null || typeof provider.config !== 'object' || Array.isArray(provider.config)
        ? {}
        : { config: provider.config as JsonObject }),
    };
    return entry;
  });
}

function brandSecretReference(value: string): SecretReference {
  if (value.startsWith('env:') || value.startsWith('file:')) {
    return brand<`env:${string}` | `file:${string}`, 'SecretReference'>(value as `env:${string}` | `file:${string}`);
  }
  throw new Error(`Capability provider credential must be an env: or file: reference.`);
}

function requireNonEmptyString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`Capability provider ${label} must be a non-empty string.`);
  }
  return value;
}

function validateModelProfiles(
  rawProfiles: readonly unknown[],
  validateSecret: AppCredentialResolver['validate'],
):
  | {
      readonly status: 'ready';
      readonly profiles: readonly ModelProviderProfile[];
      readonly evidence: readonly ModelProfileValidationEvidence[];
      readonly issues: readonly ConfigDiagnostic[];
    }
  | { readonly status: 'blocked'; readonly issues: readonly ConfigDiagnostic[] } {
  const providerIds = new Set<string>();
  const modelIds = new Set<string>();
  const profiles: ModelProviderProfile[] = [];
  const evidence: ModelProfileValidationEvidence[] = [];
  const issues: ConfigDiagnostic[] = [];
  const degradedCandidates: Array<{
    readonly providerId: string;
    readonly modelIds: readonly string[];
    readonly code: string;
    readonly message: string;
  }> = [];

  for (const rawProvider of rawProfiles) {
    const result = parseModelProviderProfile(rawProvider, validateSecret);
    if (result.status === 'invalid') {
      return {
        status: 'blocked',
        issues: [issue(result.code, 'modelProfiles', `modelProfiles.${result.identity}.${result.field}`, result.message, true)],
      };
    }
    if (providerIds.has(result.providerId)) {
      return {
        status: 'blocked',
        issues: [
          issue(
            'APP_CONFIG_DUPLICATE_MODEL_PROVIDER',
            'modelProfiles',
            `modelProfiles.${result.providerId}`,
            'Model provider ids must be unique.',
            true,
          ),
        ],
      };
    }
    providerIds.add(result.providerId);
    for (const model of result.models) {
      if (modelIds.has(model.modelId)) {
        return {
          status: 'blocked',
          issues: [
            issue('APP_CONFIG_DUPLICATE_MODEL_ID', 'modelProfiles', `modelProfiles.${model.modelId}`, 'Model ids must be globally unique.', true),
          ],
        };
      }
      modelIds.add(model.modelId);
    }
    if (result.status === 'credential-invalid') {
      degradedCandidates.push({
        providerId: result.providerId,
        modelIds: result.models.map((model) => model.modelId),
        code: result.code,
        message: result.message,
      });
      continue;
    }
    profiles.push(result.profile);
  }

  const hasViablePrimary = profiles.some((provider) => provider.models.some((model) => !model.fallbackEligible));
  if (degradedCandidates.length > 0 && !hasViablePrimary) {
    return {
      status: 'blocked',
      issues: [
        issue(
          'APP_CONFIG_MODEL_CREDENTIAL_INVALID',
          'modelProfiles',
          'modelProfiles',
          'Invalid model credential cannot be degraded without a viable primary model.',
          true,
        ),
      ],
    };
  }
  for (const candidate of degradedCandidates) {
    for (const modelId of candidate.modelIds) {
      issues.push(issue(candidate.code, 'modelProfiles', `modelProfiles.${candidate.providerId}.${modelId}.credentialRef`, candidate.message, false));
      evidence.push({ modelId, code: candidate.code, message: candidate.message });
    }
  }
  for (const provider of profiles) {
    if (provider.providerId !== 'openai-compatible' || provider.baseUrl !== undefined) {
      continue;
    }
    for (const model of provider.models) {
      const message = 'OpenAI-compatible model provider is not configured.';
      issues.push(
        issue('APP_CONFIG_MODEL_PROVIDER_NOT_CONFIGURED', 'modelProfiles', `modelProfiles.${provider.providerId}.${model.modelId}`, message, false),
      );
      evidence.push({ modelId: model.modelId, code: 'APP_CONFIG_MODEL_PROVIDER_NOT_CONFIGURED', message });
    }
  }
  if (profiles.length === 0) {
    return {
      status: 'blocked',
      issues: [...issues, issue('APP_CONFIG_NO_VIABLE_MODEL', 'modelProfiles', 'modelProfiles', 'At least one viable model must remain.', true)],
    };
  }
  return { status: 'ready', profiles: Object.freeze([...profiles]), evidence: Object.freeze([...evidence]), issues };
}

type ProviderProfileParseResult =
  | {
      readonly status: 'valid';
      readonly providerId: ModelProviderId;
      readonly models: readonly ModelProfile[];
      readonly profile: ModelProviderProfile;
    }
  | {
      readonly status: 'credential-invalid';
      readonly providerId: ModelProviderId;
      readonly models: readonly ModelProfile[];
      readonly code: string;
      readonly message: string;
    }
  | { readonly status: 'invalid'; readonly identity: string; readonly code: string; readonly field: string; readonly message: string };

function parseModelProviderProfile(rawProvider: unknown, validateSecret: AppCredentialResolver['validate']): ProviderProfileParseResult {
  if (!isObject(rawProvider)) {
    return invalidProvider('unknown-provider', 'APP_CONFIG_MODEL_PROVIDER_INVALID', 'provider', 'Model provider profile must be an object.');
  }
  const identity = typeof rawProvider.providerId === 'string' && rawProvider.providerId.length > 0 ? rawProvider.providerId : 'unknown-provider';
  for (const key of Object.keys(rawProvider)) {
    if (!allowedProviderProfileKeys.has(key)) {
      return invalidProvider(identity, 'APP_CONFIG_MODEL_PROVIDER_UNKNOWN_FIELD', key, 'Unknown model provider field.');
    }
  }
  if (typeof rawProvider.providerId !== 'string' || !supportedModelProviderIds.has(rawProvider.providerId as ModelProviderId)) {
    return invalidProvider(identity, 'APP_CONFIG_MODEL_PROVIDER_UNSUPPORTED', 'providerId', 'Model providerId is unsupported.');
  }
  const providerId = rawProvider.providerId as ModelProviderId;
  if (!Array.isArray(rawProvider.models) || rawProvider.models.length === 0) {
    return invalidProvider(providerId, 'APP_CONFIG_MODEL_LIST_INVALID', 'models', 'Model provider models must be a non-empty array.');
  }
  if (
    providerId === 'openai-compatible' &&
    rawProvider.baseUrl !== undefined &&
    (typeof rawProvider.baseUrl !== 'string' || !isHttpUrl(rawProvider.baseUrl))
  ) {
    return invalidProvider(
      providerId,
      'APP_CONFIG_MODEL_BASE_URL_INVALID',
      'baseUrl',
      'OpenAI-compatible provider requires an http or https baseUrl.',
    );
  }
  if (providerId === 'model-gateway' && rawProvider.baseUrl !== undefined) {
    return invalidProvider(providerId, 'APP_CONFIG_MODEL_GATEWAY_BASE_URL_FORBIDDEN', 'baseUrl', 'Model Gateway provider does not accept baseUrl.');
  }
  const models: ModelProfile[] = [];
  for (const rawModel of rawProvider.models) {
    const parsed = parseModelProfile(rawModel, providerId);
    if (parsed.status === 'invalid') {
      return parsed;
    }
    models.push(parsed.profile);
  }
  if (rawProvider.credentialRef !== undefined) {
    if (typeof rawProvider.credentialRef !== 'string' || !isSecretReference(rawProvider.credentialRef)) {
      if (models.every((model) => model.fallbackEligible)) {
        return {
          status: 'credential-invalid',
          providerId,
          models,
          code: 'APP_CONFIG_SECRET_REF_INVALID',
          message: 'Model provider credential reference is invalid.',
        };
      }
      return invalidProvider(providerId, 'APP_CONFIG_SECRET_REF_INVALID', 'credentialRef', 'Model provider credential reference is invalid.');
    }
    const secret = validateSecret(rawProvider.credentialRef);
    if (!secret.valid) {
      return invalidProvider(
        providerId,
        secret.issueCode ?? 'APP_CONFIG_SECRET_REF_UNAVAILABLE',
        'credentialRef',
        'Model provider credential reference is unavailable.',
      );
    }
  }
  const profile: ModelProviderProfile = deepFreeze({
    providerId,
    ...(typeof rawProvider.baseUrl === 'string' ? { baseUrl: rawProvider.baseUrl } : {}),
    ...(rawProvider.credentialRef === undefined
      ? {}
      : {
          credentialRef: brand<`env:${string}` | `file:${string}`, 'SecretReference'>(
            rawProvider.credentialRef as `env:${string}` | `file:${string}`,
          ),
        }),
    models: Object.freeze(models),
  });
  return { status: 'valid', providerId, models, profile };
}

type ModelProfileParseResult =
  | { readonly status: 'valid'; readonly profile: ModelProfile }
  | { readonly status: 'invalid'; readonly identity: string; readonly code: string; readonly field: string; readonly message: string };

function parseModelProfile(rawProfile: unknown, providerId: ModelProviderId): ModelProfileParseResult {
  if (!isObject(rawProfile)) {
    return invalidProvider(providerId, 'APP_CONFIG_MODEL_PROFILE_INVALID', 'model', 'Model profile must be an object.');
  }
  const identity = typeof rawProfile.modelId === 'string' && rawProfile.modelId.length > 0 ? rawProfile.modelId : providerId;
  for (const key of Object.keys(rawProfile)) {
    if (!allowedModelProfileKeys.has(key)) {
      return invalidProvider(identity, 'APP_CONFIG_MODEL_PROFILE_UNKNOWN_FIELD', key, 'Unknown model profile field.');
    }
  }
  if (!isModelIdentity(rawProfile.modelId)) {
    return invalidProvider(identity, 'APP_CONFIG_MODEL_ID_INVALID', 'modelId', 'Model id must be a non-empty safe string.');
  }
  if (rawProfile.displayName !== undefined && !isModelIdentity(rawProfile.displayName)) {
    return invalidProvider(identity, 'APP_CONFIG_MODEL_DISPLAY_NAME_INVALID', 'displayName', 'Model displayName must be a non-empty safe string.');
  }
  if (typeof rawProfile.fallbackEligible !== 'boolean') {
    return invalidProvider(identity, 'APP_CONFIG_MODEL_FALLBACK_INVALID', 'fallbackEligible', 'Model fallbackEligible must be boolean.');
  }
  if (providerId === 'openai-compatible' && !isPositiveSafeInteger(rawProfile.contextWindowTokens)) {
    return invalidProvider(
      identity,
      'APP_CONFIG_MODEL_CONTEXT_WINDOW_INVALID',
      'contextWindowTokens',
      'OpenAI-compatible model requires a positive context window.',
    );
  }
  if (providerId === 'model-gateway' && rawProfile.contextWindowTokens !== undefined) {
    return invalidProvider(
      identity,
      'APP_CONFIG_MODEL_GATEWAY_CONTEXT_WINDOW_FORBIDDEN',
      'contextWindowTokens',
      'Model Gateway context window is resolved lazily.',
    );
  }
  const numericIssue = validateModelNumericFields(rawProfile);
  if (numericIssue !== undefined) {
    return invalidProvider(identity, numericIssue.code, numericIssue.field, numericIssue.message);
  }
  if (rawProfile.thinking !== undefined && !isThinkingOptions(rawProfile.thinking)) {
    return invalidProvider(identity, 'APP_CONFIG_MODEL_THINKING_INVALID', 'thinking', 'Model thinking options are invalid.');
  }
  if (rawProfile.reasoningTextMode !== undefined && !isReasoningTextMode(rawProfile.reasoningTextMode)) {
    return invalidProvider(identity, 'APP_CONFIG_MODEL_REASONING_TEXT_MODE_INVALID', 'reasoningTextMode', 'Model reasoning text mode is invalid.');
  }
  if (providerId !== 'openai-compatible' && rawProfile.reasoningTextMode !== undefined) {
    return invalidProvider(
      identity,
      'APP_CONFIG_MODEL_GATEWAY_REASONING_TEXT_MODE_FORBIDDEN',
      'reasoningTextMode',
      'Model Gateway does not support reasoning text mode.',
    );
  }
  if (rawProfile.providerOptions !== undefined && !isJsonObject(rawProfile.providerOptions)) {
    return invalidProvider(identity, 'APP_CONFIG_MODEL_PROVIDER_OPTIONS_INVALID', 'providerOptions', 'Model providerOptions must be a JSON object.');
  }
  const contextWindowTokens = optionalNumber(rawProfile.contextWindowTokens);
  const temperature = optionalNumber(rawProfile.temperature);
  const maxOutputTokens = optionalNumber(rawProfile.maxOutputTokens);
  const topP = optionalNumber(rawProfile.topP);
  const topK = optionalNumber(rawProfile.topK);
  const presencePenalty = optionalNumber(rawProfile.presencePenalty);
  const frequencyPenalty = optionalNumber(rawProfile.frequencyPenalty);
  const timeoutMs = optionalNumber(rawProfile.timeoutMs);
  const maxRetries = optionalNumber(rawProfile.maxRetries);
  const thinking = isThinkingOptions(rawProfile.thinking) ? rawProfile.thinking : undefined;
  const reasoningTextMode = isReasoningTextMode(rawProfile.reasoningTextMode) ? rawProfile.reasoningTextMode : undefined;
  const providerOptions = isJsonObject(rawProfile.providerOptions) ? rawProfile.providerOptions : undefined;
  const profile: ModelProfile = deepFreeze({
    modelId: rawProfile.modelId,
    fallbackEligible: rawProfile.fallbackEligible,
    ...(typeof rawProfile.displayName === 'string' ? { displayName: rawProfile.displayName } : {}),
    ...(contextWindowTokens === undefined ? {} : { contextWindowTokens }),
    ...(temperature === undefined ? {} : { temperature }),
    ...(maxOutputTokens === undefined ? {} : { maxOutputTokens }),
    ...(topP === undefined ? {} : { topP }),
    ...(topK === undefined ? {} : { topK }),
    ...(presencePenalty === undefined ? {} : { presencePenalty }),
    ...(frequencyPenalty === undefined ? {} : { frequencyPenalty }),
    ...(thinking === undefined ? {} : { thinking }),
    ...(reasoningTextMode === undefined ? {} : { reasoningTextMode }),
    ...(providerOptions === undefined ? {} : { providerOptions }),
    ...(timeoutMs === undefined ? {} : { timeoutMs }),
    ...(maxRetries === undefined ? {} : { maxRetries }),
  });
  return { status: 'valid', profile };
}

function optionalNumber(value: unknown): number | undefined {
  return typeof value === 'number' ? value : undefined;
}

function invalidProvider(identity: string, code: string, field: string, message: string): Extract<ProviderProfileParseResult, { status: 'invalid' }> {
  return { status: 'invalid', identity, code, field, message };
}

function validateModelNumericFields(
  raw: Readonly<Record<string, unknown>>,
): { readonly code: string; readonly field: string; readonly message: string } | undefined {
  const bounded: ReadonlyArray<readonly [keyof ModelProfile, number, number]> = [
    ['temperature', 0, 2],
    ['topP', 0, 1],
    ['presencePenalty', -2, 2],
    ['frequencyPenalty', -2, 2],
  ];
  for (const [field, minimum, maximum] of bounded) {
    const value = raw[field];
    if (value !== undefined && (typeof value !== 'number' || !Number.isFinite(value) || value < minimum || value > maximum)) {
      return { code: 'APP_CONFIG_MODEL_INFERENCE_OPTION_INVALID', field, message: `Model ${field} is outside its allowed range.` };
    }
  }
  for (const field of ['maxOutputTokens', 'topK', 'timeoutMs'] as const) {
    const value = raw[field];
    if (value !== undefined && !isPositiveSafeInteger(value)) {
      return { code: 'APP_CONFIG_MODEL_INFERENCE_OPTION_INVALID', field, message: `Model ${field} must be a positive safe integer.` };
    }
  }
  if (raw.maxRetries !== undefined && (!Number.isSafeInteger(raw.maxRetries) || Number(raw.maxRetries) < 0)) {
    return {
      code: 'APP_CONFIG_MODEL_INFERENCE_OPTION_INVALID',
      field: 'maxRetries',
      message: 'Model maxRetries must be a non-negative safe integer.',
    };
  }
  return undefined;
}

function isPositiveSafeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

function isThinkingOptions(value: unknown): value is ThinkingOptions {
  return (
    isObject(value) &&
    Object.keys(value).length === 1 &&
    (value.depth === 'OFF' || value.depth === 'LOW' || value.depth === 'MEDIUM' || value.depth === 'HIGH')
  );
}

function isReasoningTextMode(value: unknown): value is ReasoningTextMode {
  return value === 'EXPLICIT_THINK_TAG' || value === 'IMPLICIT_OPEN_THINK_TAG';
}

function isModelIdentity(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value === value.trim() &&
    [...value].length >= 1 &&
    [...value].length <= 256 &&
    !/[\u0000-\u001F\u007F-\u009F]/u.test(value)
  );
}

function blocked(evaluatedAt: string, issues: readonly ConfigDiagnostic[]): DefaultSystemConfigEvaluation {
  return {
    status: 'BLOCKED',
    evidenceInput: {
      readinessState: 'BLOCKED',
      diagnostics: issues,
      evaluatedAt,
    },
  };
}

function issue(
  issueCode: string,
  scope: ConfigDiagnostic['scope'],
  fieldRef: string,
  safeMessage: string,
  affectsReadiness: boolean,
  configurationStatus?: ConfigDiagnostic['configurationStatus'],
): ConfigDiagnostic {
  return {
    issueCode,
    severity: affectsReadiness ? 'ERROR' : 'WARNING',
    scope,
    fieldRef,
    safeMessage,
    affectsReadiness,
    ...(configurationStatus === undefined ? {} : { configurationStatus }),
  };
}

function isSecretReference(value: string): value is `env:${string}` | `file:${string}` {
  return /^(env|file):.+/u.test(value);
}

function findOwnershipIssue(raw: unknown): ConfigDiagnostic | undefined {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return undefined;
  }
  const value = raw as JsonObject;
  if ('frameworkRuntime' in value || 'runtimeKnobs' in value) {
    return issue(
      'APP_CONFIG_FRAMEWORK_OWNERSHIP_VIOLATION',
      'framework',
      'frameworkRuntime',
      'Framework runtime configuration is not owned by app composition.',
      true,
    );
  }
  if ('agentPackage' in value) {
    return issue(
      'APP_CONFIG_AGENT_OWNERSHIP_VIOLATION',
      'agent',
      'agentPackage',
      'Agent package configuration must not override app composition.',
      true,
    );
  }
  return undefined;
}

const allowedNextAgentKeys = new Set(['system', 'memory', 'highFrequencyQuestion']);
const allowedMemoryKeys = new Set(['enabled', 'search', 'extraction', 'aging']);
const allowedMemorySearchKeys = new Set(['default-limit', 'min-confidence']);
const allowedMemoryExtractionKeys = new Set([
  'enabled',
  'strategy',
  'crossSessionSchedule',
  'maxCycleTrajectories',
  'maxCandidates',
  'timeoutMs',
  'lookbackDays',
]);
const allowedMemoryAgingKeys = new Set([
  'enabled',
  'schedule',
  'decayStaleDays',
  'archiveRetentionDays',
  'decayFactor',
  'batchLimit',
  'timeoutMs',
  'reviveConfidenceBoost',
]);
const memoryOwnerOverrideKeys = new Set(['tenantId', 'subjectId', 'owner', 'userId']);

function findMemoryConfigIssue(raw: unknown): ConfigDiagnostic | undefined {
  if (!isObject(raw)) {
    return undefined;
  }
  const nextAgent = raw['nextAgent'];
  if (nextAgent === undefined) {
    return undefined;
  }
  if (!isObject(nextAgent)) {
    return undefined;
  }
  const siblingIssue = findUndefinedField(nextAgent, allowedNextAgentKeys, 'nextAgent');
  if (siblingIssue !== undefined) {
    return memoryFieldUndefined(siblingIssue);
  }
  const memory = nextAgent['memory'];
  if (memory === undefined) {
    return undefined;
  }
  if (!isObject(memory)) {
    return memoryInvalid('MEMORY_CONFIG_INVALID', 'nextAgent.memory', 'Memory configuration must be an object.');
  }
  const ownerIssue = findMemoryOwnerOverride(memory, 'nextAgent.memory');
  if (ownerIssue !== undefined) {
    return ownerIssue;
  }
  const memoryFieldIssue = findUndefinedField(memory, allowedMemoryKeys, 'nextAgent.memory');
  if (memoryFieldIssue !== undefined) {
    return memoryFieldUndefined(memoryFieldIssue);
  }
  const nestedMemoryFieldIssue = findNestedMemoryFieldIssue(memory);
  if (nestedMemoryFieldIssue !== undefined) {
    return nestedMemoryFieldIssue;
  }
  const ownerValidation = validateMemoryOwnerConfig(memory as RawMemoryConfig);
  return ownerValidation.status === 'invalid'
    ? memoryInvalid(ownerValidation.issue.issueCode, ownerValidation.issue.fieldRef, ownerValidation.issue.safeMessage)
    : undefined;
}

function findNestedMemoryFieldIssue(memory: Record<string, unknown>): ConfigDiagnostic | undefined {
  const search = memory.search;
  if (isObject(search)) {
    const searchFieldIssue = findUndefinedField(search, allowedMemorySearchKeys, 'nextAgent.memory.search');
    if (searchFieldIssue !== undefined) {
      return memoryFieldUndefined(searchFieldIssue);
    }
  }
  const extraction = memory.extraction;
  if (isObject(extraction)) {
    const extractionFieldIssue = findUndefinedField(extraction, allowedMemoryExtractionKeys, 'nextAgent.memory.extraction');
    if (extractionFieldIssue !== undefined) {
      return memoryFieldUndefined(extractionFieldIssue);
    }
  }
  const aging = memory.aging;
  if (isObject(aging)) {
    const agingFieldIssue = findUndefinedField(aging, allowedMemoryAgingKeys, 'nextAgent.memory.aging');
    if (agingFieldIssue !== undefined) {
      return memoryFieldUndefined(agingFieldIssue);
    }
  }
  return undefined;
}

function findMemoryOwnerOverride(value: Record<string, unknown>, path: string): ConfigDiagnostic | undefined {
  for (const [key, item] of Object.entries(value)) {
    const fieldRef = `${path}.${key}`;
    if (memoryOwnerOverrideKeys.has(key)) {
      return memoryInvalid('MEMORY_CONFIG_OWNER_OVERRIDE_FORBIDDEN', fieldRef, 'Memory configuration must not override owner or identity scope.');
    }
    if (isObject(item)) {
      const nested = findMemoryOwnerOverride(item, fieldRef);
      if (nested !== undefined) {
        return nested;
      }
    }
  }
  return undefined;
}

function findUndefinedField(value: Record<string, unknown>, allowed: ReadonlySet<string>, path: string): string | undefined {
  for (const [key, item] of Object.entries(value)) {
    if (!allowed.has(key)) {
      return undefinedFieldRef(`${path}.${key}`, item);
    }
  }
  return undefined;
}

function undefinedFieldRef(path: string, value: unknown): string {
  if (!isObject(value)) {
    return path;
  }
  const firstNested = Object.keys(value)[0];
  return firstNested === undefined ? path : undefinedFieldRef(`${path}.${firstNested}`, value[firstNested]);
}

function memoryFieldUndefined(fieldRef: string): ConfigDiagnostic {
  return memoryInvalid('MEMORY_CONFIG_FIELD_UNDEFINED', fieldRef, 'Memory configuration field is not defined by an active OpenSpec change.');
}

function memoryInvalid(issueCode: string, fieldRef: string, safeMessage: string): ConfigDiagnostic {
  return issue(issueCode, 'memory', fieldRef, safeMessage, true, 'INVALID');
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isJsonObject(value: unknown): value is JsonObject {
  return isObject(value);
}
