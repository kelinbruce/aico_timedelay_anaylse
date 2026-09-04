import { brand } from '@nextagent/agent-common';
import type { AgentPresentationLocales } from '@nextagent/agent-contracts/agent-assembly';
import { CapabilityLocalesSchema } from '@nextagent/agent-contracts/capability';
import { Ajv } from 'ajv/dist/ajv.js';
import type {
  AgentHookActivation,
  AgentPolicyActivation,
  AgentRoutingConfig,
  AgentRoutingPolicyRule,
  AgentRuntimeSettings,
} from '@nextagent/agent-contracts/agent-assembly';
import type { AgentCapabilityBindingDefinition, AgentDefinition, AgentDefinitionResource, WorkspaceFilesDefinition } from './agent-definition.js';

const allowedTopLevel = new Set([
  'agentId',
  'agentType',
  'agentVersion',
  'displayName',
  'locales',
  'description',
  'workspaceDir',
  'workspaceFiles',
  'modelIds',
  'defaultModelId',
  'capabilityBindings',
  'policies',
  'hooks',
  'userInvocable',
  'agentInvocation',
  'runtimeSettings',
  'routing',
  'resources',
]);

const allowedRuntimeSettings = new Set(['defaultLanguage', 'maxTurns', 'maxToolCallsPerTurn', 'maxContextMessages', 'requestTimeoutMs']);
const validateCapabilityLocales = new Ajv({ strict: false, allErrors: true }).compile(CapabilityLocalesSchema);

export function parseAgentDefinition(input: unknown): AgentDefinition {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    throw new Error('AgentDefinition must be an object.');
  }
  const candidate = input as Record<string, unknown>;
  assertAllowedKeys(candidate, allowedTopLevel, 'AgentDefinition');
  const runtimeSettings = parseRuntimeSettings(candidate['runtimeSettings']);
  const routing = parseRouting(candidate['routing']);
  return {
    agentId: brand<string, 'AgentId'>(readString(candidate, 'agentId')),
    agentType: parseAgentType(candidate['agentType']),
    agentVersion: brand<string, 'AgentVersion'>(readString(candidate, 'agentVersion')),
    displayName: readString(candidate, 'displayName'),
    ...(candidate['locales'] === undefined ? {} : { locales: parseCapabilityLocales(candidate['locales']) }),
    description: readString(candidate, 'description'),
    ...(candidate['workspaceDir'] === undefined ? {} : { workspaceDir: readString(candidate, 'workspaceDir') }),
    ...(candidate['workspaceFiles'] === undefined ? {} : { workspaceFiles: parseWorkspaceFiles(candidate['workspaceFiles']) }),
    ...(candidate['modelIds'] === undefined ? {} : { modelIds: readStringArray(candidate, 'modelIds') }),
    ...(candidate['defaultModelId'] === undefined ? {} : { defaultModelId: readOptionalString(candidate, 'defaultModelId') }),
    capabilityBindings: readCapabilityBindings(candidate['capabilityBindings']),
    policies: readPolicies(candidate['policies']),
    hooks: readHooks(candidate['hooks']),
    ...(candidate['userInvocable'] === undefined ? {} : { userInvocable: readBoolean(candidate, 'userInvocable') }),
    ...(candidate['agentInvocation'] === undefined ? {} : { agentInvocation: readOneOf(candidate, 'agentInvocation', ['NONE', 'BOUND', 'PARENT']) }),
    runtimeSettings,
    ...(routing === undefined ? {} : { routing }),
    resources: readResources(candidate['resources']),
  };
}

function parseCapabilityLocales(value: unknown): AgentPresentationLocales {
  if (validateCapabilityLocales(value) !== true) {
    throw new Error('AgentDefinition.locales must be a valid Capability locales object.');
  }
  return value as AgentPresentationLocales;
}

function readPolicies(input: unknown): readonly AgentPolicyActivation[] {
  if (input === undefined) {
    return [];
  }
  if (!Array.isArray(input)) {
    throw new Error('AgentDefinition.policies must be an array.');
  }
  return input.map((item) => {
    if (typeof item !== 'object' || item === null || Array.isArray(item)) {
      throw new Error('AgentDefinition.policies entries must be objects.');
    }
    const candidate = item as Record<string, unknown>;
    assertAllowedKeys(candidate, new Set(['policyPointId', 'pluginId', 'policyId', 'enabled', 'timeoutMs', 'config']), 'AgentDefinition.policies');
    const activation: {
      policyPointId: string;
      pluginId: string;
      policyId: string;
      enabled?: boolean;
      timeoutMs?: number;
      config?: AgentPolicyActivation['config'];
    } = {
      policyPointId: readString(candidate, 'policyPointId'),
      pluginId: readString(candidate, 'pluginId'),
      policyId: readString(candidate, 'policyId'),
    };
    if (candidate['enabled'] !== undefined) {
      activation.enabled = readBoolean(candidate, 'enabled');
    }
    if (candidate['timeoutMs'] !== undefined) {
      activation.timeoutMs = readPositiveNumber(candidate, 'timeoutMs');
    }
    if (candidate['config'] !== undefined) {
      activation.config = readJsonObject(candidate['config'], 'AgentDefinition.policies.config');
    }
    return activation as AgentPolicyActivation;
  });
}

function readHooks(input: unknown): readonly AgentHookActivation[] {
  if (input === undefined) {
    return [];
  }
  if (!Array.isArray(input)) {
    throw new Error('AgentDefinition.hooks must be an array.');
  }
  return input.map((item) => {
    if (typeof item !== 'object' || item === null || Array.isArray(item)) {
      throw new Error('AgentDefinition.hooks entries must be objects.');
    }
    const candidate = item as Record<string, unknown>;
    assertAllowedKeys(candidate, new Set(['hookId', 'enabled', 'disabled', 'stages', 'order', 'timeoutMs', 'config']), 'AgentDefinition.hooks');
    const hook: {
      hookId: string;
      enabled?: boolean;
      disabled?: boolean;
      stages?: AgentHookActivation['stages'];
      order?: AgentHookActivation['order'];
      timeoutMs?: number;
      config?: AgentHookActivation['config'];
    } = { hookId: readString(candidate, 'hookId') };
    if (candidate['enabled'] !== undefined) {
      hook.enabled = readBoolean(candidate, 'enabled');
    }
    if (candidate['disabled'] !== undefined) {
      hook.disabled = readBoolean(candidate, 'disabled');
    }
    if (candidate['stages'] !== undefined) {
      hook.stages = readStringArray(candidate, 'stages') as AgentHookActivation['stages'];
    }
    if (candidate['order'] !== undefined) {
      hook.order = readHookOrder(candidate['order']);
    }
    if (candidate['timeoutMs'] !== undefined) {
      hook.timeoutMs = readPositiveNumber(candidate, 'timeoutMs');
    }
    if (candidate['config'] !== undefined) {
      hook.config = readJsonObject(candidate['config'], 'AgentDefinition.hooks.config');
    }
    return hook as AgentHookActivation;
  });
}

function readHookOrder(input: unknown): AgentHookActivation['order'] {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    throw new Error('AgentDefinition.hooks.order must be an object.');
  }
  const candidate = input as Record<string, unknown>;
  assertAllowedKeys(candidate, new Set(['priority', 'before', 'after']), 'AgentDefinition.hooks.order');
  return {
    ...(candidate['priority'] === undefined ? {} : { priority: readInteger(candidate, 'priority') }),
    ...(candidate['before'] === undefined ? {} : { before: readStringOrStringArray(candidate['before'], 'before') }),
    ...(candidate['after'] === undefined ? {} : { after: readStringOrStringArray(candidate['after'], 'after') }),
  };
}

function readStringOrStringArray(value: unknown, key: string): string | readonly string[] {
  if (typeof value === 'string' && value.length > 0) {
    return value;
  }
  if (Array.isArray(value) && value.length > 0 && value.every((item) => typeof item === 'string' && item.length > 0)) {
    return value as readonly string[];
  }
  throw new Error(`AgentDefinition.hooks.order.${key} must be a non-empty string or string array.`);
}

function readJsonObject(value: unknown, label: string) {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
  return value as AgentHookActivation['config'];
}

function parseWorkspaceFiles(input: unknown): WorkspaceFilesDefinition {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    throw new Error('AgentDefinition.workspaceFiles must be an object.');
  }
  const candidate = input as Record<string, unknown>;
  assertAllowedKeys(
    candidate,
    new Set([
      'readDirectories',
      'writeDirectories',
      'readAllowedExtensions',
      'readDeniedExtensions',
      'writeAllowedExtensions',
      'writeDeniedExtensions',
      'maxTextBytes',
    ]),
    'AgentDefinition.workspaceFiles',
  );
  return {
    ...(candidate['readDirectories'] === undefined ? {} : { readDirectories: readDirectoryArray(candidate, 'readDirectories') }),
    ...(candidate['writeDirectories'] === undefined ? {} : { writeDirectories: readDirectoryArray(candidate, 'writeDirectories') }),
    ...(candidate['readAllowedExtensions'] === undefined ? {} : { readAllowedExtensions: readExtensionArray(candidate, 'readAllowedExtensions') }),
    ...(candidate['readDeniedExtensions'] === undefined ? {} : { readDeniedExtensions: readExtensionArray(candidate, 'readDeniedExtensions') }),
    ...(candidate['writeAllowedExtensions'] === undefined ? {} : { writeAllowedExtensions: readExtensionArray(candidate, 'writeAllowedExtensions') }),
    ...(candidate['writeDeniedExtensions'] === undefined ? {} : { writeDeniedExtensions: readExtensionArray(candidate, 'writeDeniedExtensions') }),
    ...(candidate['maxTextBytes'] === undefined ? {} : { maxTextBytes: readWorkspaceFileSize(candidate['maxTextBytes']) }),
  };
}

function readDirectoryArray(candidate: Record<string, unknown>, key: string): readonly string[] {
  const value = candidate[key];
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string' || item.length === 0)) {
    throw new Error(`AgentDefinition.workspaceFiles.${key} must be a string array.`);
  }
  return value as string[];
}

function readExtensionArray(candidate: Record<string, unknown>, key: string): readonly string[] {
  const value = candidate[key];
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string' || !/^\.[a-z0-9]+$/u.test(item))) {
    throw new Error(`AgentDefinition.workspaceFiles.${key} must contain lowercase extensions such as .json.`);
  }
  if (new Set(value).size !== value.length) {
    throw new Error(`AgentDefinition.workspaceFiles.${key} must not contain duplicate extensions.`);
  }
  return value as string[];
}

function readWorkspaceFileSize(value: unknown): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > 256_000) {
    throw new Error('AgentDefinition.workspaceFiles.maxTextBytes must be an integer from 1 through 256000.');
  }
  return value;
}

function parseRuntimeSettings(input: unknown): AgentRuntimeSettings {
  if (input === undefined) {
    return { maxTurns: 50, maxToolCallsPerTurn: 30 };
  }
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    throw new Error('AgentDefinition.runtimeSettings must be an object.');
  }
  const candidate = input as Record<string, unknown>;
  assertAllowedKeys(candidate, allowedRuntimeSettings, 'AgentDefinition.runtimeSettings');
  return {
    ...(candidate['defaultLanguage'] === undefined ? {} : { defaultLanguage: readOptionalString(candidate, 'defaultLanguage') }),
    maxTurns: candidate['maxTurns'] === undefined ? 50 : readPositiveSafeInteger(candidate, 'maxTurns'),
    maxToolCallsPerTurn: candidate['maxToolCallsPerTurn'] === undefined ? 30 : readBoundedPositiveSafeInteger(candidate, 'maxToolCallsPerTurn', 100),
    ...(candidate['maxContextMessages'] === undefined ? {} : { maxContextMessages: readPositiveNumber(candidate, 'maxContextMessages') }),
    ...(candidate['requestTimeoutMs'] === undefined ? {} : { requestTimeoutMs: readPositiveNumber(candidate, 'requestTimeoutMs') }),
  };
}

function parseRouting(input: unknown): AgentRoutingConfig | undefined {
  if (input === undefined) {
    return undefined;
  }
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    throw new Error('AgentDefinition.routing must be an object.');
  }
  const candidate = input as Record<string, unknown>;
  assertAllowedKeys(candidate, new Set(['mode', 'policy']), 'AgentDefinition.routing');
  const policy = parseRoutingPolicy(candidate['policy']);
  return {
    ...(candidate['mode'] === undefined ? {} : { mode: readOneOf(candidate, 'mode', ['default', 'policy']) }),
    ...(policy === undefined ? {} : { policy }),
  };
}

function parseRoutingPolicy(input: unknown): AgentRoutingConfig['policy'] | undefined {
  if (input === undefined) {
    return undefined;
  }
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    throw new Error('AgentDefinition.routing.policy must be an object.');
  }
  const candidate = input as Record<string, unknown>;
  assertAllowedKeys(candidate, new Set(['method', 'rules']), 'AgentDefinition.routing.policy');
  return {
    method: readOneOf(candidate, 'method', ['policy:intent-recognition']),
    ...(candidate['rules'] === undefined ? {} : { rules: parseRoutingRules(candidate['rules']) }),
  };
}

function parseRoutingRules(input: unknown): readonly AgentRoutingPolicyRule[] {
  if (!Array.isArray(input)) {
    throw new Error('AgentDefinition.routing.policy.rules must be an array.');
  }
  return input.map((item) => parseRoutingRule(item));
}

function parseRoutingRule(input: unknown): AgentRoutingPolicyRule {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    throw new Error('AgentDefinition.routing.policy.rules entries must be objects.');
  }
  const candidate = input as Record<string, unknown>;
  assertAllowedKeys(candidate, new Set(['reg', 'target']), 'AgentDefinition.routing.policy.rules');
  const reg = readNonEmptyValueString(candidate['reg'], 'AgentDefinition.routing.policy.rules.reg');
  assertValidRegex(reg);
  return {
    reg,
    target: parseRoutingRuleTarget(candidate['target']),
  };
}

function parseRoutingRuleTarget(input: unknown): AgentRoutingPolicyRule['target'] {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    throw new Error('AgentDefinition.routing.policy.rules.target must be an object.');
  }
  const candidate = input as Record<string, unknown>;
  assertAllowedKeys(candidate, new Set(['kind', 'name']), 'AgentDefinition.routing.policy.rules.target');
  return {
    kind: readOneOf(candidate, 'kind', ['SKILL', 'WORKFLOW']),
    name: readSafeRoutingTargetName(candidate['name']),
  };
}

function assertValidRegex(source: string): void {
  try {
    void new RegExp(source);
  } catch {
    throw new Error('AgentDefinition.routing.policy.rules.reg must be a valid ECMAScript regex.');
  }
  if (hasNestedQuantifier(source)) {
    throw new Error('AgentDefinition.routing.policy.rules.reg must not use nested quantifiers.');
  }
}

function hasNestedQuantifier(source: string): boolean {
  return /\((?:\?:|\?=|\?!|\?<=|\?<!)?[^()]{0,128}(?:[+*]|\{\d+(?:,\d*)?\})[^()]{0,128}\)\s*(?:[+*?]|\{\d+(?:,\d*)?\})/u.test(source);
}

function readSafeRoutingTargetName(value: unknown): string {
  const name = readNonEmptyValueString(value, 'AgentDefinition.routing.policy.rules.target.name');
  if (!/^[A-Za-z0-9._:-]+$/u.test(name)) {
    throw new Error('AgentDefinition.routing.policy.rules.target.name is unsupported.');
  }
  return name;
}

function readNonEmptyValueString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`${label} is required.`);
  }
  return value;
}

function readCapabilityBindings(input: unknown): readonly AgentCapabilityBindingDefinition[] {
  if (!Array.isArray(input)) {
    throw new Error('AgentDefinition.capabilityBindings is required.');
  }
  return input.map((item) => {
    if (typeof item !== 'object' || item === null || Array.isArray(item)) {
      throw new Error('AgentDefinition.capabilityBindings entries must be objects.');
    }
    const candidate = item as Record<string, unknown>;
    assertAllowedKeys(
      candidate,
      new Set(['capabilityId', 'capabilityType', 'providerId', 'enabled', 'description']),
      'AgentDefinition.capabilityBindings',
    );
    return {
      capabilityId: brand<string, 'CapabilityId'>(readString(candidate, 'capabilityId')),
      capabilityType: readOneOf(candidate, 'capabilityType', ['TOOL', 'SKILL', 'AGENT', 'WORKFLOW']),
      providerId: readString(candidate, 'providerId'),
      enabled: readOptionalBoolean(candidate, 'enabled', true),
      ...(candidate['description'] === undefined ? {} : { description: readCapabilityBindingDescription(candidate['description']) }),
    };
  });
}

function readResources(input: unknown): readonly AgentDefinitionResource[] {
  if (input === undefined) {
    return [];
  }
  if (!Array.isArray(input)) {
    throw new Error('AgentDefinition.resources must be an array.');
  }
  return input.map((item) => {
    if (typeof item !== 'object' || item === null || Array.isArray(item)) {
      throw new Error('AgentDefinition.resources entries must be objects.');
    }
    const candidate = item as Record<string, unknown>;
    assertAllowedKeys(candidate, new Set(['resourceId', 'kind', 'path']), 'AgentDefinition.resources');
    return {
      resourceId: readString(candidate, 'resourceId'),
      kind: readOneOf(candidate, 'kind', ['WORKSPACE_FILE', 'CAPABILITY']),
      path: readString(candidate, 'path'),
    };
  });
}

function readString(candidate: Record<string, unknown>, key: string): string {
  const value = candidate[key];
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`AgentDefinition.${key} is required.`);
  }
  return value;
}

function parseAgentType(value: unknown) {
  if (value === undefined) {
    return brand<string, 'AgentType'>('default');
  }
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error('AgentDefinition.agentType must be a non-empty string.');
  }
  return brand<string, 'AgentType'>(value);
}

function readOptionalString(candidate: Record<string, unknown>, key: string): string {
  const value = candidate[key];
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`AgentDefinition.runtimeSettings.${key} must be a non-empty string.`);
  }
  return value;
}

function readStringArray(candidate: Record<string, unknown>, key: string): readonly string[] {
  const value = candidate[key];
  if (!Array.isArray(value) || value.length === 0 || value.some((item) => typeof item !== 'string' || item.length === 0)) {
    throw new Error(`AgentDefinition.${key} must be a non-empty string array.`);
  }
  return value as string[];
}

function readBoolean(candidate: Record<string, unknown>, key: string): boolean {
  const value = candidate[key];
  if (typeof value !== 'boolean') {
    throw new Error(`AgentDefinition.${key} must be boolean.`);
  }
  return value;
}

function readOptionalBoolean(candidate: Record<string, unknown>, key: string, defaultValue: boolean): boolean {
  const value = candidate[key];
  if (value === undefined) {
    return defaultValue;
  }
  if (typeof value !== 'boolean') {
    throw new Error(`AgentDefinition.${key} must be boolean.`);
  }
  return value;
}

function readCapabilityBindingDescription(value: unknown): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error('AgentDefinition.capabilityBindings.description must be a non-empty string.');
  }
  return value;
}

function readPositiveNumber(candidate: Record<string, unknown>, key: string): number {
  const value = candidate[key];
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 1) {
    throw new Error(`AgentDefinition.runtimeSettings.${key} must be a positive number.`);
  }
  return value;
}

function readPositiveSafeInteger(candidate: Record<string, unknown>, key: string): number {
  const value = candidate[key];
  if (!Number.isSafeInteger(value) || (value as number) < 1) {
    throw new Error(`AgentDefinition.runtimeSettings.${key} must be a positive safe integer.`);
  }
  return value as number;
}

function readBoundedPositiveSafeInteger(candidate: Record<string, unknown>, key: string, maximum: number): number {
  const value = readPositiveSafeInteger(candidate, key);
  if (value > maximum) {
    throw new Error(`AgentDefinition.runtimeSettings.${key} must be at most ${maximum}.`);
  }
  return value;
}

function readInteger(candidate: Record<string, unknown>, key: string): number {
  const value = candidate[key];
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    throw new Error(`AgentDefinition.${key} must be an integer.`);
  }
  return value;
}

function readOneOf<TLiteral extends string>(candidate: Record<string, unknown>, key: string, expected: readonly TLiteral[]): TLiteral {
  const value = candidate[key];
  if (typeof value !== 'string' || !(expected as readonly string[]).includes(value)) {
    throw new Error(`AgentDefinition.${key} is unsupported.`);
  }
  return value as TLiteral;
}

function assertAllowedKeys(candidate: Record<string, unknown>, allowed: ReadonlySet<string>, label: string): void {
  for (const key of Object.keys(candidate)) {
    if (!allowed.has(key)) {
      throw new Error(`${label} must not contain ${key}.`);
    }
  }
}
