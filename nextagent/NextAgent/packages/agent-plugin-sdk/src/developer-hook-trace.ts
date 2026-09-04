import { existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { LifecycleStage } from '@nextagent/agent-common';
import type { HookInput, HookResult, LifecycleHook } from '@nextagent/agent-contracts/runtime';
import type { DeveloperDiagnosticArtifactSink, NextAgentPlugin } from './index.js';

export const developerHookTracePluginId = 'developer-hook-trace';
export const developerHookTraceHookId = 'developer-hook-trace.loop-raw-boundary';

export type DeveloperHookTraceStage =
  'BEFORE_PLANNING' | 'BEFORE_MODEL_INVOKE' | 'AFTER_MODEL_RESULT' | 'BEFORE_CAPABILITY_INVOKE' | 'AFTER_CAPABILITY_RESULT' | 'BEFORE_AGENT_TERMINAL';

export interface DeveloperHookTraceLogEntry {
  readonly event: 'DEVELOPER_HOOK_TRACE';
  readonly hookId: typeof developerHookTraceHookId;
  readonly stage: DeveloperHookTraceStage;
  readonly printedAt: string;
  readonly sessionId?: string;
  readonly requestId?: string;
  readonly runId?: string;
  readonly agentId: string;
  readonly agentVersion: string;
  readonly agentAssemblyRef?: string;
  readonly hookInvocationId?: string;
  readonly idempotencyKey?: string;
  readonly stepId?: string;
  readonly modelId?: string;
  readonly toolCallId?: string;
  readonly capabilityId?: string;
  readonly capabilityInvocationId?: string;
  readonly boundary: unknown;
}

export interface DeveloperHookTracePluginOptions {
  readonly enabled?: boolean;
  readonly developerDiagnostics: DeveloperDiagnosticArtifactSink;
}

export interface DeveloperHookTracePluginArtifactOptions {
  readonly targetDirectory: string;
  readonly overwrite?: boolean;
}

export interface DeveloperHookTracePluginArtifactResult {
  readonly pluginId: typeof developerHookTracePluginId;
  readonly files: readonly ['plugin.json', 'index.js'];
}

const supportedStages: readonly DeveloperHookTraceStage[] = Object.freeze([
  'BEFORE_PLANNING',
  'BEFORE_MODEL_INVOKE',
  'AFTER_MODEL_RESULT',
  'BEFORE_CAPABILITY_INVOKE',
  'AFTER_CAPABILITY_RESULT',
  'BEFORE_AGENT_TERMINAL',
]);

export function createDeveloperHookTracePlugin(options: DeveloperHookTracePluginOptions): NextAgentPlugin {
  const hook: LifecycleHook<readonly DeveloperHookTraceStage[]> = Object.freeze({
    hookId: developerHookTraceHookId,
    kind: 'CUSTOM',
    supportedStages,
    effects: Object.freeze(['OBSERVE'] as const),
    failureMode: 'CONTINUE',
    async execute<S extends DeveloperHookTraceStage>(input: HookInput<S>): Promise<HookResult<S>> {
      if (options.enabled !== false) {
        try {
          const payload = toDeveloperHookTraceLogEntry(input);
          await options.developerDiagnostics.emit({
            artifactType: developerHookTracePluginId,
            ...(payload.sessionId === undefined ? {} : { sessionId: payload.sessionId }),
            ...(payload.requestId === undefined ? {} : { requestId: payload.requestId }),
            ...(payload.runId === undefined ? {} : { runId: payload.runId }),
            agentId: payload.agentId,
            agentVersion: payload.agentVersion,
            ...(payload.agentAssemblyRef === undefined ? {} : { agentAssemblyRef: payload.agentAssemblyRef }),
            ...(payload.hookInvocationId === undefined ? {} : { hookInvocationId: payload.hookInvocationId }),
            payload,
          });
        } catch {
          // Observe-only developer diagnostics must not affect the protected operation.
        }
      }
      return passHookResult();
    },
  });
  return Object.freeze({
    apiVersion: '1.1',
    pluginId: developerHookTracePluginId,
    version: '1.0.0',
    hooks: Object.freeze([hook]),
  });
}

export function createDeveloperHookTracePluginArtifact(options: DeveloperHookTracePluginArtifactOptions): DeveloperHookTracePluginArtifactResult {
  const targetDirectory = resolve(options.targetDirectory);
  if (existsSync(targetDirectory) && !statSync(targetDirectory).isDirectory()) {
    throw new Error('Developer hook trace plugin artifact target must be a directory.');
  }
  mkdirSync(targetDirectory, { recursive: true });
  const files = Object.freeze(['plugin.json', 'index.js'] as const);
  for (const file of files) {
    if (existsSync(resolve(targetDirectory, file)) && options.overwrite !== true) {
      throw new Error('Developer hook trace plugin artifact file already exists.');
    }
  }
  writeFileSync(resolve(targetDirectory, 'plugin.json'), pluginManifest(), 'utf8');
  writeFileSync(resolve(targetDirectory, 'index.js'), pluginBundle(), 'utf8');
  return Object.freeze({ pluginId: developerHookTracePluginId, files });
}

function toDeveloperHookTraceLogEntry(input: HookInput<LifecycleStage>): DeveloperHookTraceLogEntry {
  if (!isDeveloperHookTraceStage(input.stage)) {
    throw new Error('Unsupported developer hook trace stage.');
  }
  return {
    event: 'DEVELOPER_HOOK_TRACE',
    hookId: developerHookTraceHookId,
    stage: input.stage,
    printedAt: new Date().toISOString(),
    ...(input.sessionId === undefined ? {} : { sessionId: String(input.sessionId) }),
    ...(input.requestId === undefined ? {} : { requestId: String(input.requestId) }),
    ...(input.requestRunId === undefined ? {} : { runId: String(input.requestRunId) }),
    agentId: String(input.agentId),
    agentVersion: String(input.agentVersion),
    ...(input.agentAssemblyRef === undefined ? {} : { agentAssemblyRef: input.agentAssemblyRef }),
    ...(input.hookInvocationId === undefined ? {} : { hookInvocationId: input.hookInvocationId }),
    ...(input.idempotencyKey === undefined ? {} : { idempotencyKey: input.idempotencyKey }),
    ...developerTraceBoundaryCoordinates(input),
    boundary: input.boundary,
  };
}

function developerTraceBoundaryCoordinates(input: HookInput<LifecycleStage>): Record<string, string> {
  const boundary: object = input.boundary;
  if (input.stage === 'BEFORE_MODEL_INVOKE' || input.stage === 'AFTER_MODEL_RESULT') {
    return { ...optionalBoundaryCoordinate(boundary, 'stepId'), ...optionalBoundaryCoordinate(boundary, 'modelId') };
  }
  if (input.stage === 'BEFORE_CAPABILITY_INVOKE') {
    return { ...optionalBoundaryCoordinate(boundary, 'toolCallId'), ...optionalBoundaryCoordinate(boundary, 'capabilityId') };
  }
  if (input.stage === 'AFTER_CAPABILITY_RESULT') {
    return { ...optionalBoundaryCoordinate(boundary, 'capabilityInvocationId'), ...optionalBoundaryCoordinate(boundary, 'capabilityId') };
  }
  return {};
}

function optionalBoundaryCoordinate(boundary: object, key: string): Record<string, string> {
  const value = Reflect.get(boundary, key);
  return typeof value === 'string' ? { [key]: value } : {};
}

function passHookResult<S extends LifecycleStage>(): HookResult<S> {
  return { outcome: 'PASS' };
}

function isDeveloperHookTraceStage(stage: LifecycleStage): stage is DeveloperHookTraceStage {
  return (supportedStages as readonly LifecycleStage[]).includes(stage);
}

function pluginManifest(): string {
  return `${JSON.stringify(
    {
      pluginId: developerHookTracePluginId,
      version: '1.0.0',
      apiVersion: '1.1',
      main: './index.js',
      artifactType: 'esm-bundle',
      hostExternals: [],
    },
    null,
    2,
  )}\n`;
}

function pluginBundle(): string {
  return `const pluginId = ${JSON.stringify(developerHookTracePluginId)};
const hookId = ${JSON.stringify(developerHookTraceHookId)};
const supportedStages = Object.freeze(${JSON.stringify(supportedStages)});

function createPlugin(host) {
  const createExecutable = (enabled) => Object.freeze({
    async execute(input) {
      if (enabled !== false) {
        try {
          const payload = toEntry(input);
          await host.developerDiagnostics.emit({
            artifactType: pluginId,
            ...(payload.sessionId === undefined ? {} : { sessionId: payload.sessionId }),
            ...(payload.requestId === undefined ? {} : { requestId: payload.requestId }),
            ...(payload.runId === undefined ? {} : { runId: payload.runId }),
            agentId: payload.agentId,
            agentVersion: payload.agentVersion,
            ...(payload.agentAssemblyRef === undefined ? {} : { agentAssemblyRef: payload.agentAssemblyRef }),
            ...(payload.hookInvocationId === undefined ? {} : { hookInvocationId: payload.hookInvocationId }),
            payload
          });
        } catch {}
      }
      return { outcome: "PASS" };
    }
  });
  const defaultExecutable = createExecutable(true);
  const hook = Object.freeze({
    hookId,
    kind: "CUSTOM",
    supportedStages,
    effects: Object.freeze(["OBSERVE"]),
    failureMode: "CONTINUE",
    configSchema: Object.freeze({
      type: "object",
      additionalProperties: false,
      properties: { enabled: { type: "boolean" } }
    }),
    configure(config) { return createExecutable(config.enabled === undefined ? true : Boolean(config.enabled)); },
    execute(input) { return defaultExecutable.execute(input); }
  });
  return Object.freeze({ apiVersion: "1.1", pluginId, version: "1.0.0", hooks: Object.freeze([hook]) });
}

function toEntry(input) {
  const boundary = input.boundary;
  const coordinates = {};
  if (input.stage === "BEFORE_MODEL_INVOKE" || input.stage === "AFTER_MODEL_RESULT") {
    if (typeof boundary.stepId === "string") coordinates.stepId = boundary.stepId;
    if (typeof boundary.modelId === "string") coordinates.modelId = boundary.modelId;
  } else if (input.stage === "BEFORE_CAPABILITY_INVOKE") {
    if (typeof boundary.toolCallId === "string") coordinates.toolCallId = boundary.toolCallId;
    if (typeof boundary.capabilityId === "string") coordinates.capabilityId = boundary.capabilityId;
  } else if (input.stage === "AFTER_CAPABILITY_RESULT") {
    if (typeof boundary.capabilityInvocationId === "string") coordinates.capabilityInvocationId = boundary.capabilityInvocationId;
    if (typeof boundary.capabilityId === "string") coordinates.capabilityId = boundary.capabilityId;
  }
  return {
    event: "DEVELOPER_HOOK_TRACE", hookId, stage: input.stage, printedAt: new Date().toISOString(),
    ...(input.sessionId === undefined ? {} : { sessionId: String(input.sessionId) }),
    ...(input.requestId === undefined ? {} : { requestId: String(input.requestId) }),
    ...(input.requestRunId === undefined ? {} : { runId: String(input.requestRunId) }),
    agentId: String(input.agentId), agentVersion: String(input.agentVersion),
    ...(input.agentAssemblyRef === undefined ? {} : { agentAssemblyRef: input.agentAssemblyRef }),
    ...(input.hookInvocationId === undefined ? {} : { hookInvocationId: input.hookInvocationId }),
    ...(input.idempotencyKey === undefined ? {} : { idempotencyKey: input.idempotencyKey }),
    ...coordinates, boundary
  };
}

export default createPlugin;
`;
}
