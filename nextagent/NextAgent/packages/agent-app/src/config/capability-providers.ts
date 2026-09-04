import { isHttpUrl, type CapabilityProviderKind, type JsonObject, type SecretReference } from '@nextagent/agent-common';
import type { CapabilityProviderConfig } from '@nextagent/agent-contracts/capability';

/**
 * User-facing configuration types. These are the fields the operator writes
 * in `nextAgent.system.capability-providers` (the value is a flat array of
 * provider entries — there is no `providers` intermediate wrapper). Field
 * names are short and intuitive; the resolver maps them to the canonical
 * internal `CapabilityProviderConfig` shape defined by `capability-catalog`.
 */

export type CapabilityProviderUserType = 'mcp-server' | 'agent-registry' | 'skill-hub' | 'custom';

export interface CapabilityProviderUserConfig {
  readonly id: string;
  // `type` is intentionally a raw string (not the closed set) so unknown
  // values can flow through to the resolver, which owns closed-set
  // validation and surfaces UNSUPPORTED_PROVIDER_TYPE as a safe diagnostic.
  readonly type: string;
  readonly path?: string;
  readonly gatewayId?: string;
  readonly url?: string;
  readonly credential?: SecretReference;
  readonly installDir?: string;
  readonly adapter?: string;
  readonly config?: JsonObject;
}

export type CapabilityProvidersConfig = readonly CapabilityProviderUserConfig[];

export type CapabilityProviderDiagnosticReasonCode =
  | 'DUPLICATE_PROVIDER_ID'
  | 'UNSUPPORTED_PROVIDER_TYPE'
  | 'MISSING_REQUIRED_FIELD'
  | 'INVALID_CREDENTIAL_REFERENCE'
  | 'INVALID_PATH'
  | 'INVALID_URL'
  | 'FORBIDDEN_PROVIDER_FIELD'
  | 'CUSTOM_ADAPTER_UNREGISTERED'
  | 'PROVIDER_ADAPTER_UNREGISTERED';

export interface CapabilityProviderDiagnostic {
  readonly reasonCode: CapabilityProviderDiagnosticReasonCode;
  readonly severity: 'ERROR';
  readonly message: string;
  readonly providerId?: string;
}

export interface ResolvedCapabilityProviders {
  readonly providers: readonly CapabilityProviderConfig[];
  readonly diagnostics: readonly CapabilityProviderDiagnostic[];
}

export interface ResolveCapabilityProvidersOptions {
  readonly registeredCustomAdapterTypes?: ReadonlySet<string>;
  readonly isCredentialReferenceResolvable?: (reference: SecretReference) => boolean;
  readonly isUrlResolvable?: (url: string) => boolean;
  readonly isProviderAdapterRegistered?: (providerKind: CapabilityProviderKind, providerType?: string) => boolean;
  readonly resolveLocalDirectoryPath?: (path: string) => string;
}

export class CapabilityProviderConfigurationError extends Error {
  readonly providerId?: string;
  readonly reasonCode?: string;

  constructor(message: string, options: { providerId?: string; reasonCode?: string } = {}) {
    super(message);
    this.name = 'CapabilityProviderConfigurationError';
    if (options.providerId !== undefined) {
      this.providerId = options.providerId;
    }
    if (options.reasonCode !== undefined) {
      this.reasonCode = options.reasonCode;
    }
  }
}

const PROVIDER_TYPES: ReadonlySet<CapabilityProviderUserType> = new Set(['mcp-server', 'agent-registry', 'skill-hub', 'custom']);

const TYPE_TO_KIND: Readonly<Record<CapabilityProviderUserType, CapabilityProviderKind>> = {
  'mcp-server': 'MCP_SERVER',
  'agent-registry': 'AGENT_REGISTRY',
  'skill-hub': 'SKILL_HUB',
  custom: 'CUSTOM',
};

const DISCOVERY_MODE_BY_TYPE: Readonly<Record<CapabilityProviderUserType, 'EAGER' | 'SEARCH'>> = {
  'mcp-server': 'SEARCH',
  'agent-registry': 'EAGER',
  'skill-hub': 'SEARCH',
  custom: 'EAGER',
};

const CREDENTIAL_KINDS: ReadonlySet<CapabilityProviderUserType> = new Set(['mcp-server', 'agent-registry']);

const URL_REQUIRED_TYPES: ReadonlySet<CapabilityProviderUserType> = new Set(['mcp-server', 'agent-registry']);

const SECRET_REFERENCE_PATTERN = /^(env|file):/u;

export function resolveCapabilityProviders(
  input: CapabilityProvidersConfig | undefined,
  options: ResolveCapabilityProvidersOptions = {},
): ResolvedCapabilityProviders {
  const userEntries = input ?? [];
  const diagnostics: CapabilityProviderDiagnostic[] = [];
  const resolved: CapabilityProviderConfig[] = [];

  const seenIds = new Set<string>();
  for (const entry of userEntries) {
    const providerId = entry.id;
    if (typeof providerId !== 'string' || providerId.trim().length === 0) {
      diagnostics.push({
        reasonCode: 'MISSING_REQUIRED_FIELD',
        severity: 'ERROR',
        message: 'Provider id must be a non-empty string.',
        ...(providerId === undefined ? {} : { providerId: String(providerId) }),
      });
      continue;
    }
    if (seenIds.has(providerId)) {
      diagnostics.push({
        reasonCode: 'DUPLICATE_PROVIDER_ID',
        severity: 'ERROR',
        message: `Duplicate capability provider id: ${providerId}.`,
        providerId,
      });
      continue;
    }
    seenIds.add(providerId);

    if (!PROVIDER_TYPES.has(entry.type as CapabilityProviderUserType)) {
      diagnostics.push({
        reasonCode: 'UNSUPPORTED_PROVIDER_TYPE',
        severity: 'ERROR',
        message: 'Provider type is not supported.',
        providerId,
      });
      continue;
    }

    try {
      const config = buildCapabilityProviderConfig(entry, entry.type as CapabilityProviderUserType, options);
      resolved.push(config);
    } catch (error) {
      if (error instanceof CapabilityProviderConfigurationError) {
        diagnostics.push({
          reasonCode: (error.reasonCode as CapabilityProviderDiagnosticReasonCode | undefined) ?? 'MISSING_REQUIRED_FIELD',
          severity: 'ERROR',
          message: error.message,
          providerId,
        });
      } else {
        throw error;
      }
    }
  }

  return {
    providers: Object.freeze([...resolved]),
    diagnostics: Object.freeze([...diagnostics]),
  };
}

function buildCapabilityProviderConfig(
  entry: CapabilityProviderUserConfig,
  type: CapabilityProviderUserType,
  options: ResolveCapabilityProvidersOptions,
): CapabilityProviderConfig {
  const providerId = entry.id;
  const providerKind = TYPE_TO_KIND[type];
  const discoveryMode = DISCOVERY_MODE_BY_TYPE[type];

  validateCredential(entry, type, providerId, options);

  if (type === 'custom') {
    const adapter = entry.adapter;
    if (typeof adapter !== 'string' || adapter.trim().length === 0) {
      throw new CapabilityProviderConfigurationError('Custom provider requires a non-empty adapter.', {
        providerId,
        reasonCode: 'MISSING_REQUIRED_FIELD',
      });
    }
    if (options.registeredCustomAdapterTypes !== undefined && !options.registeredCustomAdapterTypes.has(adapter)) {
      throw new CapabilityProviderConfigurationError('Custom provider adapter is not registered.', {
        providerId,
        reasonCode: 'CUSTOM_ADAPTER_UNREGISTERED',
      });
    }
    if (
      options.isProviderAdapterRegistered !== undefined &&
      !safePredicate(() => options.isProviderAdapterRegistered?.(providerKind, adapter) === true)
    ) {
      throw new CapabilityProviderConfigurationError('Custom provider adapter is not registered.', {
        providerId,
        reasonCode: 'CUSTOM_ADAPTER_UNREGISTERED',
      });
    }
    return {
      provider: { providerId, providerKind, providerType: adapter },
      discoveryMode,
      options: { customOptions: entry.config ?? {} },
    };
  }

  if (URL_REQUIRED_TYPES.has(type)) {
    const url = entry.url;
    if (typeof url !== 'string' || url.trim().length === 0) {
      throw new CapabilityProviderConfigurationError(`${type} provider requires a url.`, { providerId, reasonCode: 'MISSING_REQUIRED_FIELD' });
    }
    if (!isHttpUrl(url)) {
      throw new CapabilityProviderConfigurationError(`${type} provider url is not a valid http(s) URL.`, { providerId, reasonCode: 'INVALID_URL' });
    }
    if (options.isUrlResolvable !== undefined && !safePredicate(() => options.isUrlResolvable?.(url) === true)) {
      throw new CapabilityProviderConfigurationError(`${type} provider url is not resolvable.`, { providerId, reasonCode: 'INVALID_URL' });
    }
  }

  if (type === 'mcp-server') {
    const url = entry.url ?? '';
    if (options.isProviderAdapterRegistered !== undefined && !safePredicate(() => options.isProviderAdapterRegistered?.(providerKind) === true)) {
      throw new CapabilityProviderConfigurationError('MCP server provider adapter is not registered.', {
        providerId,
        reasonCode: 'PROVIDER_ADAPTER_UNREGISTERED',
      });
    }
    const baseOptions: { endpoint: string; credentialRef?: SecretReference } = { endpoint: url };
    if (entry.credential !== undefined) {
      baseOptions.credentialRef = entry.credential;
    }
    return {
      provider: { providerId, providerKind },
      discoveryMode,
      options: baseOptions,
    };
  }

  if (type === 'agent-registry') {
    const url = entry.url ?? '';
    if (options.isProviderAdapterRegistered !== undefined && !safePredicate(() => options.isProviderAdapterRegistered?.(providerKind) === true)) {
      throw new CapabilityProviderConfigurationError('Agent registry provider adapter is not registered.', {
        providerId,
        reasonCode: 'PROVIDER_ADAPTER_UNREGISTERED',
      });
    }
    const baseOptions: { registryRef: string; credentialRef?: SecretReference } = { registryRef: url };
    if (entry.credential !== undefined) {
      baseOptions.credentialRef = entry.credential;
    }
    return {
      provider: { providerId, providerKind },
      discoveryMode,
      options: baseOptions,
    };
  }

  // type === "skill-hub"
  if (type === 'skill-hub') {
    rejectForbiddenSkillHubServiceFields(entry, providerId);
    const gatewayId = entry.gatewayId;
    if (typeof gatewayId !== 'string' || gatewayId.trim().length === 0) {
      throw new CapabilityProviderConfigurationError('Skill-hub provider requires gatewayId.', { providerId, reasonCode: 'MISSING_REQUIRED_FIELD' });
    }
    const installDir = entry.installDir;
    if (typeof installDir !== 'string' || installDir.trim().length === 0) {
      throw new CapabilityProviderConfigurationError('Skill-hub provider requires installDir.', { providerId, reasonCode: 'MISSING_REQUIRED_FIELD' });
    }
    const resolvedInstallDir = options.resolveLocalDirectoryPath !== undefined ? options.resolveLocalDirectoryPath(installDir) : installDir;
    if (options.isProviderAdapterRegistered !== undefined && !safePredicate(() => options.isProviderAdapterRegistered?.(providerKind) === true)) {
      throw new CapabilityProviderConfigurationError('Skill-hub provider adapter is not registered.', {
        providerId,
        reasonCode: 'PROVIDER_ADAPTER_UNREGISTERED',
      });
    }
    const baseOptions: { gatewayId: string; managedInstallRef: string } = {
      gatewayId,
      managedInstallRef: resolvedInstallDir,
    };
    return {
      provider: { providerId, providerKind },
      discoveryMode,
      options: baseOptions,
    };
  }

  throw new CapabilityProviderConfigurationError('Provider type is not supported.', { providerId, reasonCode: 'UNSUPPORTED_PROVIDER_TYPE' });
}

function rejectForbiddenSkillHubServiceFields(entry: CapabilityProviderUserConfig, providerId: string): void {
  const item = entry as unknown as Record<string, unknown>;
  const forbiddenFields = [
    'url',
    'credential',
    'endpoint',
    'credentialRef',
    'token',
    'tenantId',
    'subjectId',
    'rawRemotePayload',
    'providerPrivateLoadingKey',
  ];
  if (forbiddenFields.some((field) => item[field] !== undefined)) {
    throw new CapabilityProviderConfigurationError('Skill-hub provider must reference a gateway instead of direct service access fields.', {
      providerId,
      reasonCode: 'FORBIDDEN_PROVIDER_FIELD',
    });
  }
}

function validateCredential(
  entry: CapabilityProviderUserConfig,
  type: CapabilityProviderUserType,
  providerId: string,
  options: ResolveCapabilityProvidersOptions,
): void {
  if (entry.credential === undefined) {
    return;
  }
  if (!CREDENTIAL_KINDS.has(type)) {
    throw new CapabilityProviderConfigurationError(`${type} provider does not accept credential.`, {
      providerId,
      reasonCode: 'INVALID_CREDENTIAL_REFERENCE',
    });
  }
  if (!SECRET_REFERENCE_PATTERN.test(entry.credential)) {
    throw new CapabilityProviderConfigurationError('Provider credential must use an env: or file: reference.', {
      providerId,
      reasonCode: 'INVALID_CREDENTIAL_REFERENCE',
    });
  }
  if (
    options.isCredentialReferenceResolvable !== undefined &&
    !safePredicate(() => options.isCredentialReferenceResolvable?.(entry.credential as SecretReference) === true)
  ) {
    throw new CapabilityProviderConfigurationError('Provider credential reference is not resolvable.', {
      providerId,
      reasonCode: 'INVALID_CREDENTIAL_REFERENCE',
    });
  }
}

function safePredicate(predicate: () => boolean): boolean {
  try {
    return predicate();
  } catch {
    return false;
  }
}
