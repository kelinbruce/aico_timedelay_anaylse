import { TRANSPORT_KINDS, type TransportKind } from '../state/contracts.ts';

const DEFAULT_BACKEND_BASE_URL = '';
// Public path prefix P prepended in front of the fixed API segment `/api/v1`.
// Empty string (default) means no prefix → API at /api/v1/..., pages at /.
// Set to /svcA for multi-instance isolation (API at /svcA/api/v1/...).
const DEFAULT_PATH_PREFIX = '';
const DEFAULT_TRANSPORT_KIND: TransportKind = 'SSE';
const RUNTIME_BOOTSTRAP_PATH = '/api/v1/runtime/bootstrap';

function normalizeText(value?: string): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function parseTransportKind(value?: string): TransportKind | null {
  const normalized = normalizeText(value)?.toUpperCase();
  if (normalized && TRANSPORT_KINDS.includes(normalized as TransportKind)) {
    return normalized as TransportKind;
  }
  return null;
}

export function resolveTransportKind(value: string | undefined, isDev = import.meta.env.DEV): TransportKind {
  const resolved = parseTransportKind(value);
  if (resolved) {
    return resolved;
  }
  if (normalizeText(value) && isDev) {
    throw new Error(`Unsupported VITE_TRANSPORT_KIND: ${value}`);
  }
  return DEFAULT_TRANSPORT_KIND;
}

function resolveBackendBaseUrl(value?: string): string {
  const normalized = normalizeText(value);
  if (!normalized) {
    return DEFAULT_BACKEND_BASE_URL;
  }
  return normalized.replace(/\/+$/, '');
}

// Public path prefix P. Must be empty (no prefix), a single `/` (no prefix),
// or an absolute path starting with `/` using safe chars and no trailing slash.
const PATH_PREFIX_PATTERN = /^(?:|\/|\/[A-Za-z0-9/_-]+)$/;
function resolvePathPrefix(value?: string): string {
  const normalized = normalizeText(value);
  if (!normalized) {
    return DEFAULT_PATH_PREFIX;
  }
  // `/` and empty both mean "no prefix"; normalize to empty.
  const stripped = normalized === '/' ? '' : normalized.replace(/\/+$/, '');
  if (!PATH_PREFIX_PATTERN.test(stripped)) {
    throw new Error(`Unsupported VITE_API_URL_PREFIX: ${value}`);
  }
  return stripped;
}

export interface ChatUploadFileConfig {
  readonly chatUploadFileType: readonly string[];
  readonly chatUploadMaxFileNumber: number;
  readonly chatUploadMaxFileSize: number;
  readonly uploadFileIdleExpireTime: number;
  readonly uploadFileMaxExpireTime: number;
}

export interface PortalAbilityConfig {
  readonly suggestedQuestionsEnabled: boolean;
  readonly cronTasksEnabled: boolean;
  readonly longTermMemoryManagementEnabled: boolean;
  readonly knowledgeImportEnabled: boolean;
  readonly fullProcessEnabled: boolean;
}

export interface RuntimeConfig {
  backendBaseUrl: string;
  // Public path prefix P (empty = no prefix). Prepended in front of /api/v1.
  apiPrefix: string;
  transportKind: TransportKind;
  portalAbilityConfig: PortalAbilityConfig;
  chatUploadFileConfig?: ChatUploadFileConfig;
}

interface RuntimeBootstrapResponse {
  readonly transportKind: TransportKind;
  readonly portalAbilityConfig: PortalAbilityConfig;
  readonly chatUploadFileConfig?: ChatUploadFileConfig;
}

export function resolveRuntimeConfig(env: ImportMetaEnv = import.meta.env): RuntimeConfig {
  // P is fixed at build time via import.meta.env.VITE_API_URL_PREFIX (e.g. /svcA).
  // Empty/`/` = no prefix → API at /api/v1/... . Only API calls under /api/v1
  // get P prepended; page/asset paths are not prefixed.
  return {
    backendBaseUrl: resolveBackendBaseUrl(env.VITE_BACKEND_BASE_URL),
    apiPrefix: resolvePathPrefix(env.VITE_API_URL_PREFIX),
    transportKind: resolveTransportKind(env.VITE_TRANSPORT_KIND, env.DEV === true),
    portalAbilityConfig: parsePortalAbilityConfig(undefined),
  };
}

export const runtimeConfig = resolveRuntimeConfig();

export function resolveRuntimeBootstrap(value: unknown): RuntimeBootstrapResponse {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Runtime bootstrap config is invalid.');
  }
  const transportKind = (value as { readonly transportKind?: unknown }).transportKind;
  if (!TRANSPORT_KINDS.includes(transportKind as TransportKind)) {
    throw new Error('Runtime bootstrap transportKind is invalid.');
  }
  const raw = value as { readonly transportKind?: unknown; readonly chatUploadFileConfig?: unknown; readonly portalAbilityConfig?: unknown };
  const chatUploadFileConfig = parseChatUploadFileConfig(raw.chatUploadFileConfig);
  return {
    transportKind: transportKind as TransportKind,
    portalAbilityConfig: parsePortalAbilityConfig(raw.portalAbilityConfig),
    ...(chatUploadFileConfig === undefined ? {} : { chatUploadFileConfig }),
  };
}

function parsePortalAbilityConfig(value: unknown): PortalAbilityConfig {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return {
      suggestedQuestionsEnabled: true,
      cronTasksEnabled: true,
      longTermMemoryManagementEnabled: true,
      knowledgeImportEnabled: true,
      fullProcessEnabled: true,
    };
  }
  const raw = value as Record<string, unknown>;
  return {
    suggestedQuestionsEnabled: parseBooleanConfig(raw.suggestedQuestionsEnabled),
    cronTasksEnabled: parseBooleanConfig(raw.cronTasksEnabled),
    longTermMemoryManagementEnabled: parseBooleanConfig(raw.longTermMemoryManagementEnabled),
    knowledgeImportEnabled: parseBooleanConfig(raw.knowledgeImportEnabled),
    fullProcessEnabled: parseBooleanConfig(raw.fullProcessEnabled),
  };
}

function parseBooleanConfig(value: unknown): boolean {
  return value === false ? false : true;
}

function parseChatUploadFileConfig(value: unknown): ChatUploadFileConfig | undefined {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }
  const raw = value as Record<string, unknown>;
  const chatUploadFileType = Array.isArray(raw.chatUploadFileType)
    ? raw.chatUploadFileType.filter((v): v is string => typeof v === 'string' && v.length > 0)
    : ['*.md', '*.markdown'];
  const chatUploadMaxFileNumber = typeof raw.chatUploadMaxFileNumber === 'number' ? raw.chatUploadMaxFileNumber : 10;
  const chatUploadMaxFileSize = typeof raw.chatUploadMaxFileSize === 'number' ? raw.chatUploadMaxFileSize : 10;
  const uploadFileIdleExpireTime = typeof raw.uploadFileIdleExpireTime === 'number' ? raw.uploadFileIdleExpireTime : 5;
  const uploadFileMaxExpireTime = typeof raw.uploadFileMaxExpireTime === 'number' ? raw.uploadFileMaxExpireTime : 30;
  return { chatUploadFileType, chatUploadMaxFileNumber, chatUploadMaxFileSize, uploadFileIdleExpireTime, uploadFileMaxExpireTime };
}

export async function loadRuntimeConfig(
  options: {
    readonly env?: ImportMetaEnv;
    readonly fetcher?: typeof fetch;
  } = {},
): Promise<RuntimeConfig> {
  const env = options.env ?? import.meta.env;
  const fetcher = options.fetcher ?? fetch;
  const staticConfig = resolveRuntimeConfig(env);
  // P is fixed at build time (import.meta.env.VITE_API_URL_PREFIX); no runtime
  // override file. Bootstrap is fetched under ${P}/api/v1/runtime/bootstrap.
  const bootstrapUrl = buildApiUrl(RUNTIME_BOOTSTRAP_PATH, staticConfig);

  try {
    const response = await fetcher(bootstrapUrl, {
      credentials: 'include',
      headers: { Accept: 'application/json' },
    });
    if (!response.ok) {
      throw new Error(`Runtime bootstrap failed: HTTP ${response.status}`);
    }
    const bootstrap = resolveRuntimeBootstrap(await response.json());
    return assignRuntimeConfig({
      backendBaseUrl: staticConfig.backendBaseUrl,
      apiPrefix: staticConfig.apiPrefix,
      transportKind: bootstrap.transportKind,
      portalAbilityConfig: bootstrap.portalAbilityConfig,
      ...(bootstrap.chatUploadFileConfig === undefined ? {} : { chatUploadFileConfig: bootstrap.chatUploadFileConfig }),
    });
  } catch (error) {
    if (env.DEV === true) {
      return assignRuntimeConfig(staticConfig);
    }
    throw error;
  }
}

function assignRuntimeConfig(nextConfig: RuntimeConfig): RuntimeConfig {
  runtimeConfig.backendBaseUrl = nextConfig.backendBaseUrl;
  runtimeConfig.apiPrefix = nextConfig.apiPrefix;
  runtimeConfig.transportKind = nextConfig.transportKind;
  runtimeConfig.portalAbilityConfig = nextConfig.portalAbilityConfig;
  if (nextConfig.chatUploadFileConfig !== undefined) {
    runtimeConfig.chatUploadFileConfig = nextConfig.chatUploadFileConfig;
  }
  return runtimeConfig;
}

export function buildApiUrl(path: string, config: Pick<RuntimeConfig, 'backendBaseUrl' | 'apiPrefix'> = runtimeConfig): string {
  const dangerousProtocols = /^(javascript|data|vbscript):/i;
  if (dangerousProtocols.test(path)) {
    return '/';
  }
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  // Prepend the public path prefix P only in front of the canonical
  // `/api/v1` segment. Service code keeps passing `/api/v1/...`; P is prepended
  // here so a single config retroutes every call without touching callers.
  // P empty → no change (existing /api/v1/... behavior). Non-/api/v1 paths
  // (e.g. `/rest/...` external service calls) are NOT prefixed.
  const prefix = config.apiPrefix ?? '';
  const shouldPrefix = prefix !== '' && normalizedPath.startsWith('/api/v1');
  const rewrittenPath = shouldPrefix ? `${prefix}${normalizedPath}` : normalizedPath;
  if (!config.backendBaseUrl) {
    return rewrittenPath;
  }
  return `${config.backendBaseUrl}${rewrittenPath}`;
}
