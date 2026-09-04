import type { CapabilityProviderIdentity, CapabilityProviderConfig } from '@nextagent/agent-contracts/capability';

export class CapabilityConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CapabilityConfigurationError';
  }
}

export interface NormalizedCapabilityProviderConfig extends CapabilityProviderConfig {}

export interface NormalizeCapabilityProviderConfigsOptions {
  readonly occupiedProviders?: readonly CapabilityProviderIdentity[];
}

export function normalizeCapabilityProviderConfigs(
  configs: readonly CapabilityProviderConfig[] | unknown,
  options: NormalizeCapabilityProviderConfigsOptions = {},
): readonly NormalizedCapabilityProviderConfig[] {
  if (!Array.isArray(configs)) {
    return [];
  }
  const occupiedProviders = Array.isArray(options.occupiedProviders)
    ? options.occupiedProviders.filter(
        (provider): provider is CapabilityProviderIdentity => provider !== undefined && provider !== null && typeof provider.providerId === 'string',
      )
    : [];
  const providerIds = new Set<string>(occupiedProviders.map((provider) => provider.providerId));
  return configs.map((config) => {
    const provider = config.provider;
    if (provider.providerId.trim().length === 0) {
      throw new CapabilityConfigurationError('Capability provider id must be non-empty.');
    }
    if (provider.providerKind === 'BUNDLED') {
      throw new CapabilityConfigurationError('BUNDLED capability providers are registered by agent-capability.');
    }
    if (providerIds.has(provider.providerId)) {
      throw new CapabilityConfigurationError('Duplicate capability provider id.');
    }
    providerIds.add(provider.providerId);
    if (config.discoveryMode !== 'EAGER' && config.discoveryMode !== 'SEARCH') {
      throw new CapabilityConfigurationError('Unsupported capability discovery mode.');
    }
    validateOptions(config);
    return config;
  });
}

function validateOptions(config: CapabilityProviderConfig): void {
  const options = config.options as unknown as Record<string, unknown>;
  switch (config.provider.providerKind) {
    case 'LOCAL_DIRECTORY':
      throw new CapabilityConfigurationError('LOCAL_DIRECTORY capability providers are registered by trusted local capability sources.');
    case 'SKILL_HUB':
      requireString(options.gatewayId, 'SKILL_HUB capability provider requires gatewayId.');
      requireString(options.managedInstallRef, 'SKILL_HUB capability provider requires managedInstallRef.');
      break;
    case 'MCP_SERVER':
      requireString(options.endpoint, 'MCP_SERVER capability provider requires endpoint.');
      validateCredentialRef(options.credentialRef);
      if (options.timeoutMs !== undefined && (!Number.isInteger(options.timeoutMs) || Number(options.timeoutMs) <= 0)) {
        throw new CapabilityConfigurationError('MCP_SERVER capability provider timeoutMs must be a positive integer.');
      }
      break;
    case 'AGENT_REGISTRY':
      requireString(options.registryRef, 'AGENT_REGISTRY capability provider requires registryRef.');
      validateCredentialRef(options.credentialRef);
      break;
    case 'CUSTOM':
      requireString(config.provider.providerType, 'CUSTOM capability provider requires providerType.');
      if (!isJsonObject(options.customOptions)) {
        throw new CapabilityConfigurationError('CUSTOM capability provider requires customOptions.');
      }
      break;
    default:
      throw new CapabilityConfigurationError('Unsupported capability provider kind.');
  }
}

function requireString(value: unknown, message: string): void {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new CapabilityConfigurationError(message);
  }
}

function validateCredentialRef(value: unknown): void {
  if (value !== undefined && (typeof value !== 'string' || (!value.startsWith('env:') && !value.startsWith('file:')))) {
    throw new CapabilityConfigurationError('Capability provider credentialRef must be a reference.');
  }
}

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
