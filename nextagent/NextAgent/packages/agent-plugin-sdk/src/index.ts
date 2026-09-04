import { type CapabilityId, type JsonObject } from '@nextagent/agent-common';
import type { AgentRoutingDecision, AgentRoutingPolicyExecutable, AgentRoutingPolicyResult } from '@nextagent/agent-contracts/core';
import type { AgentAssemblyRegistry } from '@nextagent/agent-contracts/agent-assembly';
import type { ModelSelectionService, PromptTemplateResolverPort } from '@nextagent/agent-contracts/context';
import type { ModelInvocationService } from '@nextagent/agent-contracts/model';
import type {
  CapabilityDescriptor,
  CapabilityInvocationRequest,
  CapabilityInvocationResult,
  CapabilityInvocationRuntimeContext,
  CapabilityProvider,
  CapabilityProviderIdentity,
  DefineToolInput,
  DefineToolProviderInput,
  ToolDefinition,
  ToolExecuteOptions,
  ToolDependencies,
  ToolMetadata,
  ToolObservabilityDefinition,
  Tool,
} from '@nextagent/agent-contracts/capability';
import type {
  AgentPolicyDefinition,
  AgentPolicyPointId,
  HookInput,
  HookResult,
  LifecycleHook,
  RoutingConstraints,
} from '@nextagent/agent-contracts/runtime';

export type {
  CapabilityProvider,
  CapabilityProviderIdentity,
  DefineToolInput,
  DefineToolProviderInput,
  ToolDefinition,
  ToolExecuteOptions,
  ToolDependencies,
  ToolMetadata,
  ToolObservabilityDefinition,
  Tool,
  LifecycleHook,
  HookInput,
  HookResult,
  AgentRoutingDecision,
  AgentRoutingPolicyExecutable,
  AgentRoutingPolicyResult,
  RoutingConstraints,
};

export const pluginToolProviderType = 'nextagent-plugin-tool';
const capabilityLocaleTagPattern = /^[a-zA-Z]{2,8}(?:-[a-zA-Z0-9]{1,8})*$/u;

export type PluginApiVersion = '1.0' | '1.1' | '1.2';

export const LATEST_PLUGIN_API_VERSION: PluginApiVersion = '1.2';
export const SUPPORTED_PLUGIN_API_VERSIONS: readonly PluginApiVersion[] = Object.freeze(['1.0', '1.1', '1.2']);
export const ROOT_PLUGIN_API_VERSION: PluginApiVersion = '1.0';

export interface NextAgentPlugin {
  readonly apiVersion?: PluginApiVersion;
  readonly pluginId: string;
  readonly version: string;
  readonly providers?: readonly CapabilityProvider[];
  readonly policies?: readonly PluginPolicy[];
  readonly hooks?: readonly LifecycleHook[];
}

export type DeveloperDiagnosticArtifactDropReason = 'INVALID_RECORD' | 'RECORD_TOO_LARGE' | 'QUEUE_OVERLOADED' | 'OUTPUT_UNAVAILABLE';

export interface DeveloperDiagnosticArtifactInput {
  readonly artifactType: string;
  readonly sessionId?: string;
  readonly requestId?: string;
  readonly runId?: string;
  readonly agentId?: string;
  readonly agentVersion?: string;
  readonly agentAssemblyRef?: string;
  readonly hookInvocationId?: string;
  readonly payload: unknown;
}

export type DeveloperDiagnosticArtifactEmitResult =
  { readonly status: 'ACCEPTED' } | { readonly status: 'DROPPED'; readonly reasonCode: DeveloperDiagnosticArtifactDropReason };

export interface DeveloperDiagnosticArtifactSink {
  emit: (input: DeveloperDiagnosticArtifactInput) => Promise<DeveloperDiagnosticArtifactEmitResult>;
}

export const noopDeveloperDiagnosticArtifactSink: DeveloperDiagnosticArtifactSink = Object.freeze({
  async emit(): Promise<DeveloperDiagnosticArtifactEmitResult> {
    return { status: 'DROPPED', reasonCode: 'OUTPUT_UNAVAILABLE' };
  },
});

export interface PluginFactoryHostV1 {
  readonly externals: HostExternalRegistry;
}

export interface PluginFactoryHostV1_1 extends PluginFactoryHostV1 {
  readonly developerDiagnostics: DeveloperDiagnosticArtifactSink;
}

export interface PluginRuntimeServices {
  readonly agentAssemblies: AgentAssemblyRegistry;
  readonly capabilityCatalog: import('@nextagent/agent-contracts/capability').CapabilityCatalog;
  readonly capabilityInvocation: import('@nextagent/agent-contracts/capability').CapabilityInvocationPort;
  readonly modelSelection: ModelSelectionService;
  readonly modelInvocation: ModelInvocationService;
  readonly promptTemplates: PromptTemplateResolverPort;
}

export interface PluginFactoryHostV1_2 extends PluginFactoryHostV1_1 {
  readonly runtime: PluginRuntimeServices;
}

export type PluginFactoryHost = PluginFactoryHostV1 | PluginFactoryHostV1_1 | PluginFactoryHostV1_2;

export type NextAgentPluginFactory = (host: PluginFactoryHost) => NextAgentPlugin | Promise<NextAgentPlugin>;

export type HostExternalId = 'typebox' | 'ajv';

export interface HostExternalInventoryEntry {
  readonly id: HostExternalId;
  readonly packageName: '@sinclair/typebox' | 'ajv';
  readonly version: string;
  readonly status: 'OPEN';
}

export interface HostExternalRegistry {
  readonly typebox?: unknown;
  readonly ajv?: unknown;
}

export const HOST_EXTERNAL_INVENTORY: readonly HostExternalInventoryEntry[] = Object.freeze([
  Object.freeze({ id: 'typebox', packageName: '@sinclair/typebox', version: '0.34.49', status: 'OPEN' }),
  Object.freeze({ id: 'ajv', packageName: 'ajv', version: '8.18.0', status: 'OPEN' }),
]);

export type ReservedPolicyPointId = 'restrictedOperationPolicy' | 'modelSelectionPolicy' | 'modelFallbackPolicy' | 'contextWindowPolicy';

export type OpenPolicyPointId = AgentPolicyPointId | ReservedPolicyPointId;

export interface OpenPolicyInventoryEntry {
  readonly policyPointId: OpenPolicyPointId;
  readonly status: 'OPEN' | 'RESERVED';
  readonly owner: string;
}

export const OPEN_POLICY_INVENTORY: readonly OpenPolicyInventoryEntry[] = Object.freeze([
  Object.freeze({ policyPointId: 'agentRoutingPolicy', status: 'OPEN', owner: 'agent-core' }),
  Object.freeze({ policyPointId: 'restrictedOperationPolicy', status: 'RESERVED', owner: 'agent-runtime' }),
  Object.freeze({ policyPointId: 'modelSelectionPolicy', status: 'RESERVED', owner: 'agent-core/agent-model' }),
  Object.freeze({ policyPointId: 'modelFallbackPolicy', status: 'RESERVED', owner: 'agent-model' }),
  Object.freeze({ policyPointId: 'contextWindowPolicy', status: 'RESERVED', owner: 'agent-context-engine' }),
]);

export type PluginPolicyExecutable = unknown;

export type PluginPolicy<TPolicyPointId extends AgentPolicyPointId = AgentPolicyPointId> = AgentPolicyDefinition<TPolicyPointId>;

export type AgentRoutingPolicy = PluginPolicy<'agentRoutingPolicy'> & AgentRoutingPolicyExecutable;

export interface PluginMetadata {
  readonly apiVersion: PluginApiVersion;
  readonly pluginId: string;
  readonly version: string;
  readonly providerIds: readonly string[];
  readonly policyIds: readonly string[];
  readonly hookIds: readonly string[];
}

export function definePlugin(plugin: NextAgentPlugin): NextAgentPlugin {
  const materialized: NextAgentPlugin = {
    apiVersion: plugin.apiVersion ?? ROOT_PLUGIN_API_VERSION,
    pluginId: plugin.pluginId,
    version: plugin.version,
  };
  if (plugin.providers !== undefined) {
    (materialized as { providers?: readonly CapabilityProvider[] }).providers = Object.freeze([...plugin.providers]);
  }
  if (plugin.policies !== undefined) {
    (materialized as { policies?: readonly PluginPolicy[] }).policies = Object.freeze([...plugin.policies]);
  }
  if (plugin.hooks !== undefined) {
    (materialized as { hooks?: readonly LifecycleHook[] }).hooks = Object.freeze([...plugin.hooks]);
  }
  return Object.freeze(materialized);
}

export function definePluginFactory(factory: NextAgentPluginFactory): NextAgentPluginFactory {
  return factory;
}

export function defineCapabilityProvider(provider: CapabilityProvider): CapabilityProvider {
  return Object.freeze({ ...provider });
}

export function defineTool<TInput extends JsonObject = JsonObject, TOutput extends JsonObject = JsonObject, TConfig extends JsonObject = JsonObject>(
  definition: DefineToolInput<TInput, TOutput, TConfig>,
): ToolDefinition<TInput, TOutput, TConfig> {
  return {
    metadata: {
      name: definition.name,
      ...(definition.displayName === undefined ? {} : { displayName: definition.displayName }),
      ...(definition.locales === undefined ? {} : { locales: definition.locales }),
      description: definition.description,
      inputSchema: definition.inputSchema,
      outputSchema: definition.outputSchema,
      ...(definition.configSchema === undefined ? {} : { configSchema: definition.configSchema }),
      ...(definition.requiredDependencies === undefined ? {} : { requiredDependencies: definition.requiredDependencies }),
      ...(definition.replayPolicy === undefined ? {} : { replayPolicy: definition.replayPolicy }),
      ...(definition.disclosurePolicy === undefined ? {} : { disclosurePolicy: definition.disclosurePolicy }),
      ...(definition.returnsCapabilityResult === undefined ? {} : { returnsCapabilityResult: definition.returnsCapabilityResult }),
      ...(definition.observability === undefined ? {} : { observability: definition.observability }),
    },
    tool: {
      ...(definition.configure === undefined ? {} : { configure: definition.configure }),
      execute: definition.execute,
    },
  };
}

export function defineToolProvider(input: DefineToolProviderInput): CapabilityProvider {
  const identity: CapabilityProviderIdentity = {
    providerId: input.providerId,
    providerKind: 'CUSTOM',
    providerType: input.providerType ?? pluginToolProviderType,
  };
  const providerDescription = input.description?.trim();
  const tools = Object.freeze([...input.tools]);
  const descriptors = Object.freeze(tools.map((tool) => toolDescriptor(identity, tool)));
  return Object.freeze({
    identity,
    discovery: {
      provider: identity,
      discoveryMode: 'EAGER' as const,
      ...(providerDescription === undefined || providerDescription.length === 0 ? {} : { description: providerDescription }),
      async listAll() {
        return descriptors;
      },
      async resolve(capabilityId: CapabilityId) {
        return descriptors.find((descriptor) => descriptor.capabilityId === capabilityId);
      },
    },
    executor: {
      capabilityKinds: ['TOOL' as const],
      async invoke(
        descriptor: CapabilityDescriptor,
        request: CapabilityInvocationRequest,
        signal: AbortSignal,
        runtimeContext?: CapabilityInvocationRuntimeContext,
      ) {
        const definition = tools.find((tool) => tool.metadata.name === descriptor.capabilityId);
        if (definition === undefined) {
          return failedResult('PLUGIN_TOOL_NOT_FOUND', 'Plugin Tool is not available.');
        }
        const deps = requestDeps(runtimeContext);
        const options: ToolExecuteOptions = {
          signal,
          ...(deps === undefined ? {} : { deps }),
        };
        const output = await definition.tool.execute(request.arguments, options);
        return isCapabilityInvocationResult(output) ? output : successResult(output);
      },
    },
  });
}

export function defineAgentRoutingPolicy(policy: AgentRoutingPolicy): AgentRoutingPolicy {
  if (policy.policyPointId !== 'agentRoutingPolicy') {
    throw new Error('Only agentRoutingPolicy is open for plugin implementation.');
  }
  return Object.freeze({ ...policy });
}

export function defineLifecycleHook<TStages extends ReadonlyArray<import('@nextagent/agent-common').LifecycleStage>>(
  hook: LifecycleHook<TStages>,
): LifecycleHook<TStages> {
  return Object.freeze({ ...hook });
}

export function getPluginMetadata(plugin: NextAgentPlugin): PluginMetadata {
  return Object.freeze({
    apiVersion: plugin.apiVersion ?? ROOT_PLUGIN_API_VERSION,
    pluginId: plugin.pluginId,
    version: plugin.version,
    providerIds: Object.freeze((plugin.providers ?? []).map((provider) => provider.identity.providerId)),
    policyIds: Object.freeze((plugin.policies ?? []).map((policy) => policy.policyId)),
    hookIds: Object.freeze((plugin.hooks ?? []).map((hook) => hook.hookId)),
  });
}

function toolDescriptor(provider: CapabilityProviderIdentity, definition: ToolDefinition): CapabilityDescriptor {
  assertToolPresentationMetadata(definition.metadata);
  const metadata = toolDescriptorMetadata(definition);
  return Object.freeze({
    capabilityId: definition.metadata.name,
    kind: 'TOOL',
    provider,
    displayName: definition.metadata.displayName ?? definition.metadata.name,
    ...(definition.metadata.locales === undefined ? {} : { locales: definition.metadata.locales }),
    description: definition.metadata.description,
    modelInvocable: true,
    availabilityStatus: 'AVAILABLE',
    inputSchema: definition.metadata.inputSchema,
    outputSchema: definition.metadata.outputSchema,
    ...(metadata === undefined ? {} : { metadata }),
    ...(definition.metadata.disclosurePolicy === undefined ? {} : { disclosurePolicy: definition.metadata.disclosurePolicy }),
    ...(definition.metadata.replayPolicy === undefined ? {} : { replayPolicy: definition.metadata.replayPolicy }),
  });
}

function assertToolPresentationMetadata(metadata: ToolMetadata): void {
  if (metadata.displayName !== undefined && !isValidDisplayName(metadata.displayName)) {
    throw new Error('Plugin Tool displayName is invalid.');
  }
  if (metadata.locales !== undefined && !isValidCapabilityLocales(metadata.locales)) {
    throw new Error('Plugin Tool locales are invalid.');
  }
}

function isValidCapabilityLocales(value: NonNullable<ToolMetadata['locales']>): boolean {
  if (!isClosedRecord(value, ['language']) || !isRecord(value.language)) {
    return false;
  }
  const entries = Object.entries(value.language);
  return (
    entries.length > 0 &&
    entries.every(
      ([locale, content]) =>
        locale.length >= 2 &&
        locale.length <= 35 &&
        capabilityLocaleTagPattern.test(locale) &&
        isClosedRecord(content, ['displayName']) &&
        typeof content.displayName === 'string' &&
        isValidDisplayName(content.displayName),
    )
  );
}

function isValidDisplayName(value: string): boolean {
  const trimmed = value.trim();
  return trimmed.length > 0 && Array.from(trimmed).length <= 256 && !/[\u0000-\u001f\u007f-\u009f]/u.test(trimmed);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isClosedRecord(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  return isRecord(value) && Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}

function toolDescriptorMetadata(definition: ToolDefinition): JsonObject | undefined {
  const metadata: Record<string, unknown> = {};
  if (definition.metadata.configSchema !== undefined) {
    metadata.configSchema = definition.metadata.configSchema;
  }
  if (definition.metadata.requiredDependencies !== undefined) {
    metadata.requiredDependencies = [...definition.metadata.requiredDependencies];
  }
  return Object.keys(metadata).length === 0 ? undefined : (metadata as JsonObject);
}

function requestDeps(runtimeContext: unknown): ToolDependencies | undefined {
  if (runtimeContext === null || typeof runtimeContext !== 'object' || !('toolDependencies' in runtimeContext)) {
    return undefined;
  }
  const candidate = (runtimeContext as { readonly toolDependencies?: ToolDependencies }).toolDependencies;
  return candidate;
}

function successResult(structuredPayload: JsonObject): CapabilityInvocationResult {
  return {
    status: 'SUCCEEDED',
    structuredPayload,
    generatedMessages: [],
    artifactRefs: [],
  };
}

function failedResult(code: string, message: string): CapabilityInvocationResult {
  return {
    status: 'FAILED',
    structuredPayload: { code },
    generatedMessages: [],
    artifactRefs: [],
    safeError: {
      code,
      message,
      category: 'NOT_FOUND',
      retryable: false,
    },
  };
}

function isCapabilityInvocationResult(value: JsonObject | CapabilityInvocationResult): value is CapabilityInvocationResult {
  return typeof value.status === 'string' && Array.isArray(value.generatedMessages) && Array.isArray(value.artifactRefs);
}

export { WorkflowTraceCollector, createTimingWrappedService, createWorkflowTraceCoordinates, type WorkflowTraceCoordinates } from './workflow-trace-collector.js';
