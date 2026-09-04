import { readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { isPathInside, type JsonObject } from '@nextagent/agent-common';
import type { CapabilityProvider } from '@nextagent/agent-contracts/capability';
import type { LifecycleHook } from '@nextagent/agent-contracts/runtime';
import type {
  DeveloperDiagnosticArtifactEmitResult,
  DeveloperDiagnosticArtifactInput,
  DeveloperDiagnosticArtifactSink,
  HostExternalId,
  NextAgentPlugin,
  NextAgentPluginFactory,
  PluginApiVersion,
  PluginPolicy,
  PluginRuntimeServices,
} from '@nextagent/agent-plugin-sdk';
import {
  HOST_EXTERNAL_INVENTORY,
  OPEN_POLICY_INVENTORY,
  ROOT_PLUGIN_API_VERSION,
  SUPPORTED_PLUGIN_API_VERSIONS,
  noopDeveloperDiagnosticArtifactSink,
  pluginToolProviderType,
} from '@nextagent/agent-plugin-sdk';
import { Type } from '@sinclair/typebox';
import { Ajv } from 'ajv';
import type { PluginSystemConfigEntry } from '../config/component-config.js';

export interface PluginRegistrySnapshot {
  readonly plugins: readonly LoadedPluginSummary[];
  readonly providers: readonly CapabilityProvider[];
  readonly policies: readonly LoadedPluginPolicy[];
  readonly hooks: readonly LifecycleHook[];
  readonly diagnostics: readonly PluginDiagnostic[];
}

export interface LoadedPluginSummary {
  readonly pluginId: string;
  readonly version: string;
}

export interface LoadedPluginPolicy {
  readonly pluginId: string;
  readonly policy: PluginPolicy;
}

export interface PluginDiagnostic {
  readonly severity: 'INFO' | 'WARNING' | 'ERROR';
  readonly reasonCode: string;
  readonly pluginId?: string;
  readonly providerId?: string;
  readonly capabilityId?: string;
  readonly policyId?: string;
  readonly policyPointId?: string;
  readonly hookId?: string;
  readonly agentId?: string;
  readonly agentVersion?: string;
  readonly agentAssemblyRef?: string;
  readonly outcome?: 'accepted' | 'rejected' | 'degraded';
  readonly summary: string;
}

export interface PluginLoaderHostServices {
  developerDiagnosticsForPlugin: (pluginId: string) => DeveloperDiagnosticArtifactSink;
  readonly runtime?: PluginRuntimeServices;
}

interface PluginManifest {
  readonly pluginId: string;
  readonly version: string;
  readonly apiVersion?: string;
  readonly main: string;
  readonly artifactType: 'esm-bundle';
  readonly hostExternals?: ReadonlyArray<{ readonly id: HostExternalId; readonly versionRange: string }>;
}

const manifestSchema: JsonObject = {
  type: 'object',
  additionalProperties: false,
  required: ['pluginId', 'version', 'main', 'artifactType'],
  properties: {
    pluginId: { type: 'string', minLength: 1, maxLength: 128, pattern: '^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$' },
    version: { type: 'string', minLength: 1, maxLength: 128 },
    apiVersion: { type: 'string', minLength: 3, maxLength: 16, pattern: '^\\d+\\.\\d+$' },
    main: { type: 'string', minLength: 1, maxLength: 256 },
    artifactType: { const: 'esm-bundle' },
    hostExternals: {
      type: 'array',
      maxItems: 2,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'versionRange'],
        properties: {
          id: { enum: HOST_EXTERNAL_INVENTORY.map((entry) => entry.id) },
          versionRange: { type: 'string', minLength: 1, maxLength: 64 },
        },
      },
    },
  },
};

const ajv = new Ajv({ allErrors: true });
const validateManifest = ajv.compile(manifestSchema);
const hostExternalsById = new Map(HOST_EXTERNAL_INVENTORY.map((entry) => [entry.id, entry] as const));
const openPolicyIds = new Set(OPEN_POLICY_INVENTORY.filter((entry) => entry.status === 'OPEN').map((entry) => entry.policyPointId));
const reservedPolicyIds = new Set(OPEN_POLICY_INVENTORY.filter((entry) => entry.status === 'RESERVED').map((entry) => entry.policyPointId));

class PluginLoadError extends Error {
  constructor(
    readonly safeReasonCode: string,
    readonly safeSummary: string,
  ) {
    super(safeSummary);
    this.name = 'PluginLoadError';
  }
}

export function emptyPluginRegistrySnapshot(): PluginRegistrySnapshot {
  return Object.freeze({ plugins: [], providers: [], policies: [], hooks: [], diagnostics: [] });
}

export async function loadPluginRegistrySnapshot(
  entries: readonly PluginSystemConfigEntry[],
  configRoot: string,
  hostServices?: PluginLoaderHostServices,
): Promise<PluginRegistrySnapshot> {
  if (entries.length === 0) {
    return emptyPluginRegistrySnapshot();
  }
  if (entries.length > 8) {
    throw new Error('Plugin config declares more than 8 plugins.');
  }
  const diagnostics: PluginDiagnostic[] = [];
  const plugins: LoadedPluginSummary[] = [];
  const providers: CapabilityProvider[] = [];
  const policies: LoadedPluginPolicy[] = [];
  const hooks: LifecycleHook[] = [];
  const pluginIds = new Set<string>();
  const providerIds = new Set<string>();
  const policyKeys = new Set<string>();
  const hookIds = new Set<string>();

  for (const entry of entries) {
    try {
      if (pluginIds.has(entry.pluginId)) {
        throw new Error('Duplicate plugin id.');
      }
      pluginIds.add(entry.pluginId);
      appendLoadedPlugin(
        await loadOnePluginAsync(entry, configRoot, providerIds, policyKeys, hookIds, hostServices),
        plugins,
        providers,
        policies,
        hooks,
      );
    } catch (error) {
      diagnostics.push(safeDiagnostic('ERROR', 'PLUGIN_LOAD_REJECTED', entry.pluginId, error));
      if (entry.required) {
        throw new Error('Required plugin failed startup validation.');
      }
    }
  }

  return deepFreeze({ plugins, providers, policies, hooks, diagnostics });
}

export function loadPluginRegistrySnapshotSync(
  entries: readonly PluginSystemConfigEntry[],
  configRoot: string,
  hostServices?: PluginLoaderHostServices,
): PluginRegistrySnapshot {
  if (entries.length === 0) {
    return emptyPluginRegistrySnapshot();
  }
  if (entries.length > 8) {
    throw new Error('Plugin config declares more than 8 plugins.');
  }
  const diagnostics: PluginDiagnostic[] = [];
  const plugins: LoadedPluginSummary[] = [];
  const providers: CapabilityProvider[] = [];
  const policies: LoadedPluginPolicy[] = [];
  const hooks: LifecycleHook[] = [];
  const pluginIds = new Set<string>();
  const providerIds = new Set<string>();
  const policyKeys = new Set<string>();
  const hookIds = new Set<string>();

  for (const entry of entries) {
    try {
      if (pluginIds.has(entry.pluginId)) {
        throw new Error('Duplicate plugin id.');
      }
      pluginIds.add(entry.pluginId);
      appendLoadedPlugin(loadOnePlugin(entry, configRoot, providerIds, policyKeys, hookIds, hostServices), plugins, providers, policies, hooks);
    } catch (error) {
      diagnostics.push(safeDiagnostic('ERROR', 'PLUGIN_LOAD_REJECTED', entry.pluginId, error));
      if (entry.required) {
        throw new Error('Required plugin failed startup validation.');
      }
    }
  }

  return deepFreeze({ plugins, providers, policies, hooks, diagnostics });
}

function appendLoadedPlugin(
  loaded: { readonly plugin: NextAgentPlugin },
  plugins: LoadedPluginSummary[],
  providers: CapabilityProvider[],
  policies: LoadedPluginPolicy[],
  hooks: LifecycleHook[],
): void {
  plugins.push({ pluginId: loaded.plugin.pluginId, version: loaded.plugin.version });
  providers.push(...(loaded.plugin.providers ?? []));
  policies.push(...(loaded.plugin.policies ?? []).map((policy) => ({ pluginId: loaded.plugin.pluginId, policy })));
  hooks.push(...(loaded.plugin.hooks ?? []));
}

function loadPluginBundle(entry: PluginSystemConfigEntry, configRoot: string): { readonly manifest: PluginManifest; readonly source: string } {
  const pluginDir = resolve(configRoot, entry.path);
  if (!isPathInside(resolve(configRoot), pluginDir) || !isDirectory(pluginDir)) {
    throw new PluginLoadError('PLUGIN_DIRECTORY_INVALID', 'Plugin directory is outside config root or missing.');
  }
  const manifest = readManifest(resolve(pluginDir, 'plugin.json'));
  if (manifest.pluginId !== entry.pluginId) {
    throw new PluginLoadError('PLUGIN_ID_MISMATCH', 'Plugin id mismatch.');
  }
  const mainPath = resolve(pluginDir, manifest.main);
  if (!isPathInside(pluginDir, mainPath) || !mainPath.endsWith('.js') || !isFile(mainPath)) {
    throw new PluginLoadError('PLUGIN_MAIN_INVALID', 'Plugin main bundle is invalid.');
  }
  const source = readFileSync(mainPath, 'utf8');
  scanBundleImports(source);
  return { manifest, source };
}

function loadOnePlugin(
  entry: PluginSystemConfigEntry,
  configRoot: string,
  providerIds: Set<string>,
  policyKeys: Set<string>,
  hookIds: Set<string>,
  hostServices?: PluginLoaderHostServices,
): { readonly plugin: NextAgentPlugin } {
  const { manifest, source } = loadPluginBundle(entry, configRoot);
  const exported = evaluateBundleDefaultExport(source);
  const plugin = materializePlugin(exported, manifest, hostServices);
  validatePluginShape(plugin, manifest, providerIds, policyKeys, hookIds);
  return { plugin };
}

async function loadOnePluginAsync(
  entry: PluginSystemConfigEntry,
  configRoot: string,
  providerIds: Set<string>,
  policyKeys: Set<string>,
  hookIds: Set<string>,
  hostServices?: PluginLoaderHostServices,
): Promise<{ readonly plugin: NextAgentPlugin }> {
  const { manifest, source } = loadPluginBundle(entry, configRoot);
  const exported = evaluateBundleDefaultExport(source);
  const plugin = await materializePluginAsync(exported, manifest, hostServices);
  validatePluginShape(plugin, manifest, providerIds, policyKeys, hookIds);
  return { plugin };
}

function readManifest(path: string): PluginManifest {
  let manifest: unknown;
  try {
    manifest = JSON.parse(readFileSync(path, 'utf8')) as unknown;
  } catch {
    throw new PluginLoadError('PLUGIN_MANIFEST_INVALID', 'Plugin manifest is invalid.');
  }
  if (!validateManifest(manifest)) {
    throw new PluginLoadError('PLUGIN_MANIFEST_INVALID', 'Plugin manifest is invalid.');
  }
  const typed = manifest as PluginManifest;
  if (typed.apiVersion !== undefined && !isSupportedPluginApiVersion(typed.apiVersion)) {
    throw new PluginLoadError('PLUGIN_API_VERSION_UNSUPPORTED', 'Plugin API version is unsupported.');
  }
  return typed;
}

function scanBundleImports(source: string): void {
  const ws = String.raw`(?:\s|\/\*[\s\S]*?\*\/|\/\/[^\r\n]*(?:\r?\n|$))*`;
  const importPattern = new RegExp(
    String.raw`\bimport${ws}(?:\(${ws}["'][^"']+["']${ws}\)|(?:[^"'\x60;]+from${ws})?["'][^"']+["'])|\bexport${ws}[^"'\x60;]+from${ws}["'][^"']+["']`,
    'u',
  );
  if (importPattern.test(source)) {
    throw new PluginLoadError('PLUGIN_BUNDLE_IMPORT_SPECIFIER', 'Plugin bundle contains runtime import specifier.');
  }
}

function evaluateBundleDefaultExport(source: string): unknown {
  const exports = new Map<string, string>();
  const withoutSourceMap = source.replace(/\r?\n\/\/# sourceMappingURL=.*$/u, '');
  const exportListPattern = /\bexport\s*\{([^}]*)\}\s*;?/gu;
  let moduleBody = withoutSourceMap.replace(exportListPattern, (_statement, exportList: string) => {
    for (const rawEntry of exportList.split(',')) {
      const entry = rawEntry.trim();
      if (entry.length === 0) {
        continue;
      }
      const match = /^([A-Za-z_$][\w$]*)(?:\s+as\s+([A-Za-z_$][\w$]*|default))?$/u.exec(entry);
      if (match === null) {
        throw new PluginLoadError('PLUGIN_EXPORT_INVALID', 'Plugin default export is invalid.');
      }
      const localName = match[1];
      if (localName === undefined) {
        throw new PluginLoadError('PLUGIN_EXPORT_INVALID', 'Plugin default export is invalid.');
      }
      exports.set(match[2] ?? localName, localName);
    }
    return '';
  });

  let returnExpression = exports.get('default');
  if (returnExpression === undefined) {
    if (!/\bexport\s+default\b/u.test(moduleBody)) {
      throw new PluginLoadError('PLUGIN_EXPORT_INVALID', 'Plugin default export is invalid.');
    }
    moduleBody = moduleBody.replace(/\bexport\s+default\b/u, 'const __nextagentPluginDefaultExport =');
    returnExpression = '__nextagentPluginDefaultExport';
  }
  if (/\bexport\s+(?:\*|\{|const\b|let\b|var\b|function\b|class\b|default\b)/u.test(moduleBody)) {
    throw new PluginLoadError('PLUGIN_EXPORT_INVALID', 'Plugin default export is invalid.');
  }

  try {
    return Function(`"use strict";\n${moduleBody}\n;return ${returnExpression};`)() as unknown;
  } catch {
    throw new PluginLoadError('PLUGIN_EXPORT_INVALID', 'Plugin default export is invalid.');
  }
}

function materializePlugin(exported: unknown, manifest: PluginManifest, hostServices?: PluginLoaderHostServices): NextAgentPlugin {
  const requiresFactory = (manifest.hostExternals?.length ?? 0) > 0 || manifest.apiVersion === '1.1' || manifest.apiVersion === '1.2';
  if (requiresFactory) {
    if (typeof exported !== 'function') {
      throw new PluginLoadError('PLUGIN_FACTORY_REQUIRED', 'Plugin with host externals must export a factory.');
    }
    for (const external of manifest.hostExternals ?? []) {
      const inventoryEntry = hostExternalsById.get(external.id);
      if (inventoryEntry === undefined) {
        throw new PluginLoadError('PLUGIN_HOST_EXTERNAL_CLOSED', 'Host external is not open.');
      }
      if (!isVersionRangeCompatible(external.versionRange, inventoryEntry.version)) {
        throw new PluginLoadError('PLUGIN_HOST_EXTERNAL_VERSION_INCOMPATIBLE', 'Host external version is incompatible.');
      }
    }
    const plugin = (exported as NextAgentPluginFactory)(createFactoryHost(manifest, hostServices));
    if (isPromiseLike(plugin)) {
      throw new PluginLoadError('PLUGIN_FACTORY_ASYNC_UNSUPPORTED', 'Plugin factory must materialize synchronously.');
    }
    return plugin;
  }
  if (typeof exported === 'function') {
    throw new PluginLoadError('PLUGIN_HOST_EXTERNAL_DECLARATION_REQUIRED', 'Plugin factory requires hostExternals declaration.');
  }
  if (
    typeof exported === 'object' &&
    exported !== null &&
    ((exported as { readonly apiVersion?: unknown }).apiVersion === '1.1' || (exported as { readonly apiVersion?: unknown }).apiVersion === '1.2')
  ) {
    throw new PluginLoadError('PLUGIN_FACTORY_REQUIRED', 'Plugin API 1.1 or later must use an explicit factory manifest.');
  }
  return exported as NextAgentPlugin;
}

async function materializePluginAsync(
  exported: unknown,
  manifest: PluginManifest,
  hostServices?: PluginLoaderHostServices,
): Promise<NextAgentPlugin> {
  const requiresFactory = (manifest.hostExternals?.length ?? 0) > 0 || manifest.apiVersion === '1.1' || manifest.apiVersion === '1.2';
  if (!requiresFactory) {
    return materializePlugin(exported, manifest, hostServices);
  }
  if (typeof exported !== 'function') {
    throw new PluginLoadError('PLUGIN_FACTORY_REQUIRED', 'Plugin with host externals must export a factory.');
  }
  for (const external of manifest.hostExternals ?? []) {
    const inventoryEntry = hostExternalsById.get(external.id);
    if (inventoryEntry === undefined) {
      throw new PluginLoadError('PLUGIN_HOST_EXTERNAL_CLOSED', 'Host external is not open.');
    }
    if (!isVersionRangeCompatible(external.versionRange, inventoryEntry.version)) {
      throw new PluginLoadError('PLUGIN_HOST_EXTERNAL_VERSION_INCOMPATIBLE', 'Host external version is incompatible.');
    }
  }
  return await (exported as NextAgentPluginFactory)(createFactoryHost(manifest, hostServices));
}

function createFactoryHost(manifest: PluginManifest, hostServices?: PluginLoaderHostServices) {
  const externals = createHostExternalRegistry((manifest.hostExternals ?? []).map((external) => external.id));
  if (manifest.apiVersion !== '1.1' && manifest.apiVersion !== '1.2') {
    return Object.freeze({ externals });
  }
  const sink = hostServices?.developerDiagnosticsForPlugin(manifest.pluginId) ?? noopDeveloperDiagnosticArtifactSink;
  const hostV1_1 = {
    externals,
    developerDiagnostics: bindDeveloperDiagnosticSink(sink),
  };
  if (manifest.apiVersion === '1.1') {
    return Object.freeze(hostV1_1);
  }
  if (hostServices?.runtime === undefined) {
    throw new PluginLoadError('PLUGIN_RUNTIME_SERVICES_UNAVAILABLE', 'Plugin runtime services are unavailable.');
  }
  return Object.freeze({ ...hostV1_1, runtime: hostServices.runtime });
}

function bindDeveloperDiagnosticSink(sink: DeveloperDiagnosticArtifactSink): DeveloperDiagnosticArtifactSink {
  const allowedKeys = new Set([
    'artifactType',
    'sessionId',
    'requestId',
    'runId',
    'agentId',
    'agentVersion',
    'agentAssemblyRef',
    'hookInvocationId',
    'payload',
  ]);
  return Object.freeze({
    async emit(input: DeveloperDiagnosticArtifactInput): Promise<DeveloperDiagnosticArtifactEmitResult> {
      try {
        if (input === null || typeof input !== 'object' || Object.keys(input).some((key) => !allowedKeys.has(key))) {
          return { status: 'DROPPED', reasonCode: 'INVALID_RECORD' };
        }
        return await sink.emit(input);
      } catch {
        return { status: 'DROPPED', reasonCode: 'OUTPUT_UNAVAILABLE' };
      }
    },
  });
}

function createHostExternalRegistry(ids: readonly HostExternalId[]) {
  const requested = new Set(ids);
  const registry = Object.freeze({
    ...(requested.has('typebox') ? { typebox: Object.freeze({ Type }) } : {}),
    ...(requested.has('ajv') ? { ajv: Object.freeze({ Ajv }) } : {}),
  });
  return Object.freeze(
    new Proxy(registry, {
      get(target, property, receiver) {
        if (property === 'typebox' || property === 'ajv') {
          if (!requested.has(property)) {
            throw new PluginLoadError('PLUGIN_HOST_EXTERNAL_NOT_DECLARED', 'Host external was not declared.');
          }
        }
        return Reflect.get(target, property, receiver);
      },
    }),
  );
}

function validatePluginShape(
  plugin: NextAgentPlugin,
  manifest: PluginManifest,
  providerIds: Set<string>,
  policyKeys: Set<string>,
  hookIds: Set<string>,
): void {
  if (!isObject(plugin) || plugin.pluginId !== manifest.pluginId || plugin.version !== manifest.version) {
    throw new PluginLoadError('PLUGIN_EXPORT_INVALID', 'Plugin export identity is invalid.');
  }
  validatePluginApiVersion(plugin, manifest);
  if ((plugin.providers ?? []).length > 4) {
    throw new PluginLoadError('PLUGIN_PROVIDER_LIMIT_EXCEEDED', 'Plugin declares more than 4 providers.');
  }
  for (const provider of plugin.providers ?? []) {
    const providerId = provider.identity.providerId;
    if (
      provider.identity.providerKind !== 'CUSTOM' ||
      provider.identity.providerType !== pluginToolProviderType ||
      !safeId(providerId) ||
      providerIds.has(providerId) ||
      providerId === 'memory-tools'
    ) {
      throw new PluginLoadError('PLUGIN_PROVIDER_INVALID', 'Plugin provider identity is invalid.');
    }
    providerIds.add(providerId);
  }
  for (const policy of plugin.policies ?? []) {
    if (!openPolicyIds.has(policy.policyPointId)) {
      if (reservedPolicyIds.has(policy.policyPointId)) {
        throw new PluginLoadError('PLUGIN_POLICY_RESERVED', 'Plugin policy point is reserved.');
      }
      throw new PluginLoadError('PLUGIN_POLICY_CLOSED', 'Plugin policy point is closed.');
    }
    const key = `${policy.policyPointId}\0${policy.policyId}`;
    if (!safeId(policy.policyId) || policyKeys.has(key)) {
      throw new PluginLoadError('PLUGIN_POLICY_INVALID', 'Plugin policy identity is invalid.');
    }
    validateOpenPolicyShape(policy);
    if (
      policy.configSchema !== undefined &&
      (typeof policy.configSchema !== 'object' || policy.configSchema === null || Array.isArray(policy.configSchema))
    ) {
      throw new PluginLoadError('PLUGIN_POLICY_INVALID', 'Plugin policy config schema is invalid.');
    }
    policyKeys.add(key);
  }
  for (const hook of plugin.hooks ?? []) {
    if (!safeId(hook.hookId) || hookIds.has(hook.hookId)) {
      throw new PluginLoadError('PLUGIN_HOOK_INVALID', 'Plugin hook identity is invalid.');
    }
    hookIds.add(hook.hookId);
  }
}

function validateOpenPolicyShape(policy: PluginPolicy): void {
  if (policy.configure !== undefined && typeof policy.configure !== 'function') {
    throw new PluginLoadError('PLUGIN_POLICY_INVALID', 'Plugin policy executable is invalid.');
  }
  if (policy.policyPointId === 'agentRoutingPolicy' && typeof (policy as { readonly decide?: unknown }).decide !== 'function') {
    throw new PluginLoadError('PLUGIN_POLICY_INVALID', 'Plugin routing policy executable is invalid.');
  }
}

function validatePluginApiVersion(plugin: NextAgentPlugin, manifest: PluginManifest): void {
  const exportedApiVersion = (plugin as { readonly apiVersion?: unknown }).apiVersion;
  if (exportedApiVersion !== undefined && typeof exportedApiVersion !== 'string') {
    throw new PluginLoadError('PLUGIN_API_VERSION_UNSUPPORTED', 'Plugin API version is unsupported.');
  }
  if (exportedApiVersion !== undefined && !isSupportedPluginApiVersion(exportedApiVersion)) {
    throw new PluginLoadError('PLUGIN_API_VERSION_UNSUPPORTED', 'Plugin API version is unsupported.');
  }
  if (manifest.apiVersion !== undefined && exportedApiVersion !== undefined && manifest.apiVersion !== exportedApiVersion) {
    throw new PluginLoadError('PLUGIN_API_VERSION_MISMATCH', 'Plugin API version does not match manifest.');
  }
  const effectiveApiVersion = manifest.apiVersion ?? exportedApiVersion ?? ROOT_PLUGIN_API_VERSION;
  if (!isSupportedPluginApiVersion(effectiveApiVersion)) {
    throw new PluginLoadError('PLUGIN_API_VERSION_UNSUPPORTED', 'Plugin API version is unsupported.');
  }
}

function safeId(value: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(value);
}

function isVersionRangeCompatible(range: string, version: string): boolean {
  const normalized = range.trim();
  if (normalized === '*' || normalized === version) {
    return true;
  }
  if (!normalized.startsWith('^')) {
    return false;
  }
  const lower = parseVersion(normalized.slice(1));
  const current = parseVersion(version);
  if (lower === undefined || current === undefined || compareVersion(current, lower) < 0) {
    return false;
  }
  if (lower.major > 0) {
    return current.major === lower.major;
  }
  if (lower.minor > 0) {
    return current.major === 0 && current.minor === lower.minor;
  }
  return current.major === 0 && current.minor === 0 && current.patch === lower.patch;
}

function parseVersion(value: string): { readonly major: number; readonly minor: number; readonly patch: number } | undefined {
  const match = /^(\d+)\.(\d+)\.(\d+)$/u.exec(value.trim());
  if (match === null) {
    return undefined;
  }
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
  };
}

function compareVersion(
  left: { readonly major: number; readonly minor: number; readonly patch: number },
  right: { readonly major: number; readonly minor: number; readonly patch: number },
): number {
  return left.major - right.major || left.minor - right.minor || left.patch - right.patch;
}

function isSupportedPluginApiVersion(value: string): value is PluginApiVersion {
  return (SUPPORTED_PLUGIN_API_VERSIONS as readonly string[]).includes(value);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object';
}

function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
  return isObject(value) && typeof value['then'] === 'function';
}

function safeDiagnostic(severity: PluginDiagnostic['severity'], reasonCode: string, pluginId: string, error: unknown): PluginDiagnostic {
  const safeError = error instanceof PluginLoadError ? error : undefined;
  return {
    severity,
    reasonCode: safeError?.safeReasonCode ?? reasonCode,
    pluginId,
    outcome: 'rejected',
    summary: safeError?.safeSummary ?? 'Plugin validation failed.',
  };
}

function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

function isFile(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

function deepFreeze(snapshot: {
  readonly plugins: readonly LoadedPluginSummary[];
  readonly providers: readonly CapabilityProvider[];
  readonly policies: readonly LoadedPluginPolicy[];
  readonly hooks: readonly LifecycleHook[];
  readonly diagnostics: readonly PluginDiagnostic[];
}): PluginRegistrySnapshot {
  return Object.freeze({
    plugins: Object.freeze([...snapshot.plugins]),
    providers: Object.freeze([...snapshot.providers]),
    policies: Object.freeze([...snapshot.policies]),
    hooks: Object.freeze([...snapshot.hooks]),
    diagnostics: Object.freeze([...snapshot.diagnostics]),
  });
}
