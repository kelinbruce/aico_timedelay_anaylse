import type { CapabilityId, JsonObject } from '@nextagent/agent-common';
import type {
  CapabilityLocales,
  CapabilityDescriptor,
  CapabilityProviderIdentity,
  ExecutableTool as ContractExecutableTool,
  ToolExecutableDiscovery,
} from '@nextagent/agent-contracts/capability';

import { validateJsonSchema, validateJsonSchemaOk } from '../invocation/schema-validation.js';
import { CapabilityConfigurationError } from '../provider-config.js';
import type { Tool, ToolDefinition, ToolDependencies, ToolMetadata } from './tool-spi.js';

export interface ToolConfig {
  readonly safeDescriptionOverride?: string;
  readonly config?: JsonObject;
}

export interface ToolCatalogConfig {
  readonly tools?: Readonly<Record<string, ToolConfig>>;
  readonly planningToolCallingMode?: PlanningToolCallingMode;
}

export type PlanningToolCallingMode = 'todo-write' | 'task-tools';

export interface ExecutableTool extends ContractExecutableTool {
  readonly metadata: ToolMetadata;
  readonly tool: Tool;
  readonly deps?: ToolDependencies;
}

export interface ToolCatalog extends ToolExecutableDiscovery {
  readonly provider: CapabilityProviderIdentity;
  readonly discoveryMode: 'EAGER';
  listAll: (signal: AbortSignal) => Promise<readonly CapabilityDescriptor[]>;
  resolveExecutable: (capabilityId: CapabilityId) => ExecutableTool | undefined;
}

export interface ToolCatalogInput {
  readonly provider: CapabilityProviderIdentity;
  readonly tools: readonly ToolDefinition[];
  readonly config?: ToolCatalogConfig;
  readonly dependencies?: ToolDependencies;
}

const allowedDependencyNames = new Set([
  'approval',
  'sandbox',
  'workspaceFiles',
  'skillSources',
  'ragRetrieval',
  'subagentExecution',
  'todoState',
  'workflowExecution',
  'cronTasks',
  'apiCallPort',
  'parameterExtraction',
]);
export const toolDescriptionMaxLength = 512;
const capabilityLocaleTagPattern = /^[a-zA-Z]{2,8}(?:-[a-zA-Z0-9]{1,8})*$/u;

export class BuiltinToolCatalog implements ToolCatalog {
  readonly discoveryMode = 'EAGER' as const;
  private readonly descriptors: readonly CapabilityDescriptor[];
  private readonly executables: ReadonlyMap<string, ExecutableTool>;

  constructor(input: ToolCatalogInput) {
    this.provider = input.provider;
    assertKnownToolConfig(input.tools, input.config);
    const registeredTools = selectPlanningToolDefinitions(input.tools, input.config?.planningToolCallingMode ?? 'todo-write');
    assertUniqueToolNames(input.provider, registeredTools);
    const executableEntries: Array<[string, ExecutableTool]> = [];
    const descriptors: CapabilityDescriptor[] = [];
    for (const definition of registeredTools) {
      const configured = configureTool(input.provider, definition, input.config?.tools?.[definition.metadata.name], input.dependencies);
      descriptors.push(configured.descriptor);
      if (configured.executable !== undefined) {
        executableEntries.push([toolKey(input.provider, definition.metadata.name), configured.executable]);
      }
    }
    this.descriptors = descriptors;
    this.executables = new Map(executableEntries);
  }

  readonly provider: CapabilityProviderIdentity;

  async listAll(_signal: AbortSignal): Promise<readonly CapabilityDescriptor[]> {
    return this.descriptors;
  }

  resolveExecutable(capabilityId: CapabilityId): ExecutableTool | undefined {
    return this.executables.get(toolKey(this.provider, capabilityId));
  }
}

export function createToolCatalog(input: ToolCatalogInput): ToolCatalog {
  return new BuiltinToolCatalog(input);
}

function configureTool(
  provider: CapabilityProviderIdentity,
  definition: ToolDefinition,
  config?: ToolConfig,
  dependencies?: ToolDependencies,
): { readonly descriptor: CapabilityDescriptor; readonly executable?: ExecutableTool } {
  const metadata = definition.metadata;
  assertMetadataShape(metadata);
  const description = readSafeDescription(metadata.description, config?.safeDescriptionOverride);
  const unavailable = (reason: string): { readonly descriptor: CapabilityDescriptor } => ({
    descriptor: projectDescriptor(provider, metadata, description, 'UNAVAILABLE', reason),
  });
  if (!hasRequiredDependencies(metadata, dependencies)) {
    return unavailable('TOOL_DEPENDENCY_MISSING');
  }
  const toolConfig = config?.config ?? {};
  if (!isConfigValid(metadata, toolConfig)) {
    return unavailable('TOOL_CONFIG_INVALID');
  }
  try {
    const configuredTool = definition.tool.configure === undefined ? definition.tool : definition.tool.configure(toolConfig, dependencies);
    return {
      descriptor: projectDescriptor(provider, metadata, description, 'AVAILABLE'),
      executable: { metadata, tool: configuredTool, ...(dependencies === undefined ? {} : { deps: dependencies }) },
    };
  } catch {
    return unavailable('TOOL_CONFIG_INVALID');
  }
}

function projectDescriptor(
  provider: CapabilityProviderIdentity,
  metadata: ToolMetadata,
  description: string,
  availabilityStatus: CapabilityDescriptor['availabilityStatus'],
  availabilityReason?: string,
): CapabilityDescriptor {
  return {
    capabilityId: metadata.name,
    kind: 'TOOL',
    provider,
    version: '1',
    displayName: metadata.displayName ?? metadata.name,
    ...(metadata.locales === undefined ? {} : { locales: metadata.locales }),
    description,
    modelInvocable: true,
    availabilityStatus,
    ...(availabilityReason === undefined ? {} : { availabilityReason }),
    ...(metadata.disclosurePolicy === undefined ? {} : { disclosurePolicy: metadata.disclosurePolicy }),
    inputSchema: metadata.inputSchema,
    outputSchema: metadata.outputSchema,
    replayPolicy: metadata.replayPolicy ?? 'NON_IDEMPOTENT',
  };
}

function assertKnownToolConfig(tools: readonly ToolDefinition[], config?: ToolCatalogConfig): void {
  const toolNames = new Set(tools.map((tool) => tool.metadata.name));
  for (const configuredName of Object.keys(config?.tools ?? {})) {
    if (!toolNames.has(configuredName as CapabilityId)) {
      throw new CapabilityConfigurationError('Unknown builtin Tool configuration.');
    }
  }
}

function selectPlanningToolDefinitions(tools: readonly ToolDefinition[], mode: PlanningToolCallingMode): readonly ToolDefinition[] {
  return tools.filter((tool) => {
    const name = String(tool.metadata.name);
    if (mode === 'todo-write') {
      return !isTaskSeriesToolName(name);
    }
    return name !== 'TodoWrite';
  });
}

function isTaskSeriesToolName(name: string): boolean {
  return /^Task[A-Z]/u.test(name);
}

function assertUniqueToolNames(provider: CapabilityProviderIdentity, tools: readonly ToolDefinition[]): void {
  const names = new Set<string>();
  for (const definition of tools) {
    if (names.has(definition.metadata.name)) {
      throw new CapabilityConfigurationError(`Duplicate Tool name for provider ${provider.providerId}.`);
    }
    names.add(definition.metadata.name);
  }
}

function assertMetadataShape(metadata: ToolMetadata): void {
  if (metadata.description.trim().length === 0 || !isJsonSchema(metadata.inputSchema) || !isJsonSchema(metadata.outputSchema)) {
    throw new CapabilityConfigurationError('Invalid Tool metadata.');
  }
  if (metadata.configSchema !== undefined && !isJsonSchema(metadata.configSchema)) {
    throw new CapabilityConfigurationError('Invalid Tool config schema.');
  }
  if ((metadata.requiredDependencies ?? []).some((dependency) => !allowedDependencyNames.has(dependency))) {
    throw new CapabilityConfigurationError('Unsupported Tool dependency.');
  }
  if (metadata.displayName !== undefined && !isValidDisplayName(metadata.displayName)) {
    throw new CapabilityConfigurationError('Invalid Tool displayName.');
  }
  if (metadata.locales !== undefined && !isValidCapabilityLocales(metadata.locales)) {
    throw new CapabilityConfigurationError('Invalid Tool locales.');
  }
}

function isValidDisplayName(value: string): boolean {
  const trimmed = value.trim();
  return trimmed.length > 0 && Array.from(trimmed).length <= 256 && !/[\u0000-\u001f\u007f-\u009f]/u.test(trimmed);
}

function isValidCapabilityLocales(value: CapabilityLocales): boolean {
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isClosedRecord(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  return isRecord(value) && Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}

function isJsonSchema(schema: JsonObject): boolean {
  try {
    validateJsonSchema(schema, undefined);
    return true;
  } catch {
    return false;
  }
}

function readSafeDescription(defaultDescription: string, override?: string): string {
  const candidate = override?.trim();
  return candidate === undefined || candidate.length === 0 ? defaultDescription : candidate.slice(0, toolDescriptionMaxLength);
}

function hasRequiredDependencies(metadata: ToolMetadata, dependencies?: ToolDependencies): boolean {
  return (metadata.requiredDependencies ?? []).every((dependency) => dependencies?.[dependency] !== undefined);
}

function isConfigValid(metadata: ToolMetadata, config: JsonObject): boolean {
  if (metadata.configSchema === undefined) {
    return Object.keys(config).length === 0;
  }
  return validateJsonSchemaOk(metadata.configSchema, config);
}

function toolKey(provider: CapabilityProviderIdentity, capabilityId: CapabilityId): string {
  return `${provider.providerId}:${capabilityId}`;
}

export function validateJson(schema: JsonObject, value: JsonObject): boolean {
  return validateJsonSchemaOk(schema, value);
}
