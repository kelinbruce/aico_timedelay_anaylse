import { existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { LifecycleStage } from '@nextagent/agent-common';
import type { HookInput, HookResult, LifecycleHook } from '@nextagent/agent-contracts/runtime';
import type { DeveloperDiagnosticArtifactSink, NextAgentPlugin } from './index.js';

export const contextMonitorPluginId = 'context-monitor';
export const contextMonitorHookId = 'context-monitor.context-evolution';

export type ContextMonitorStage =
  'BEFORE_MODEL_INVOKE' | 'AFTER_MODEL_RESULT' | 'AFTER_CONTEXT_COMPACT' | 'BEFORE_CONTEXT_COMPACT' | 'BEFORE_AGENT_TERMINAL';

export interface ContextMonitorCompactRecord {
  readonly event: 'CONTEXT_COMPACT';
  readonly hookId: typeof contextMonitorHookId;
  readonly stage: 'AFTER_CONTEXT_COMPACT';
  readonly sessionId?: string;
  readonly requestId?: string;
  readonly runId?: string;
  readonly agentId: string;
  readonly agentVersion: string;
  readonly seq: number;
  readonly pre: readonly unknown[];
  readonly post: readonly unknown[];
  readonly summary?: string;
}

export interface ContextMonitorLastRecord {
  readonly event: 'CONTEXT_LAST';
  readonly hookId: typeof contextMonitorHookId;
  readonly stage: 'BEFORE_AGENT_TERMINAL';
  readonly sessionId?: string;
  readonly requestId?: string;
  readonly runId?: string;
  readonly agentId: string;
  readonly agentVersion: string;
  readonly messages: readonly unknown[];
  readonly answer?: { readonly content?: string; readonly toolCalls?: readonly unknown[] };
}

export type ContextMonitorRecord = ContextMonitorCompactRecord | ContextMonitorLastRecord;

export interface ContextMonitorPluginOptions {
  readonly enabled?: boolean;
  readonly developerDiagnostics: DeveloperDiagnosticArtifactSink;
}

export interface ContextMonitorPluginArtifactOptions {
  readonly targetDirectory: string;
  readonly overwrite?: boolean;
}

export interface ContextMonitorPluginArtifactResult {
  readonly pluginId: typeof contextMonitorPluginId;
  readonly files: readonly ['plugin.json', 'index.js'];
}

const supportedStages: readonly ContextMonitorStage[] = Object.freeze([
  'BEFORE_MODEL_INVOKE',
  'AFTER_MODEL_RESULT',
  'AFTER_CONTEXT_COMPACT',
  'BEFORE_CONTEXT_COMPACT',
  'BEFORE_AGENT_TERMINAL',
]);

interface SessionState {
  latestMessages: readonly unknown[];
  latestAnswer: { readonly content?: string; readonly toolCalls?: readonly unknown[] };
  readonly pendingCompactions: Array<{ readonly pre: readonly unknown[]; readonly summary?: string }>;
  compactSeq: number;
}

interface Coordinates {
  readonly sessionId?: string;
  readonly requestId?: string;
  readonly runId?: string;
  readonly agentId: string;
  readonly agentVersion: string;
}

export function createContextMonitorPlugin(options: ContextMonitorPluginOptions): NextAgentPlugin {
  const sessions = new Map<string, SessionState>();
  const hook: LifecycleHook<readonly ContextMonitorStage[]> = Object.freeze({
    hookId: contextMonitorHookId,
    kind: 'CUSTOM',
    supportedStages,
    effects: Object.freeze(['OBSERVE'] as const),
    failureMode: 'CONTINUE',
    async execute<S extends LifecycleStage>(input: HookInput<S>): Promise<HookResult<S>> {
      if (options.enabled !== false) {
        try {
          await dispatch(options.developerDiagnostics, sessions, input);
        } catch {
          // Observe-only developer diagnostics must not affect the protected operation.
        }
      }
      return { outcome: 'PASS' };
    },
  });
  return Object.freeze({
    apiVersion: '1.1',
    pluginId: contextMonitorPluginId,
    version: '1.0.0',
    hooks: Object.freeze([hook]),
  });
}

async function dispatch(sink: DeveloperDiagnosticArtifactSink, sessions: Map<string, SessionState>, input: HookInput<LifecycleStage>): Promise<void> {
  const coords = coordinatesOf(input);
  if (coords === undefined) {
    return;
  }
  const state = sessionState(sessions, coords.sessionId);
  const boundary = input.boundary as unknown;

  if (input.stage === 'BEFORE_MODEL_INVOKE') {
    const messages = (boundary as { readonly messages?: readonly unknown[] }).messages ?? [];
    const pending = state.pendingCompactions.splice(0);
    for (const item of pending) {
      state.compactSeq += 1;
      await emitRecord(sink, 'context-evolution.compaction', coords, {
        event: 'CONTEXT_COMPACT',
        hookId: contextMonitorHookId,
        stage: 'AFTER_CONTEXT_COMPACT',
        ...optionalCoordinates(coords),
        agentId: coords.agentId,
        agentVersion: coords.agentVersion,
        seq: state.compactSeq,
        pre: item.pre,
        post: messages,
        ...(item.summary === undefined ? {} : { summary: item.summary }),
      });
    }
    state.latestMessages = messages;
    return;
  }
  if (input.stage === 'AFTER_MODEL_RESULT') {
    const result = boundary as { readonly content?: string; readonly toolCalls?: readonly unknown[] };
    state.latestAnswer = {
      ...(result.content === undefined ? {} : { content: result.content }),
      ...(result.toolCalls === undefined ? {} : { toolCalls: result.toolCalls }),
    };
    return;
  }
  if (input.stage === 'AFTER_CONTEXT_COMPACT') {
    const summary = (boundary as { readonly content?: string }).content;
    state.pendingCompactions.push({
      pre: state.latestMessages,
      ...(summary === undefined ? {} : { summary }),
    });
    return;
  }
  if (input.stage === 'BEFORE_AGENT_TERMINAL') {
    await emitRecord(sink, 'context-evolution.terminal', coords, {
      event: 'CONTEXT_LAST',
      hookId: contextMonitorHookId,
      stage: 'BEFORE_AGENT_TERMINAL',
      ...optionalCoordinates(coords),
      agentId: coords.agentId,
      agentVersion: coords.agentVersion,
      messages: state.latestMessages,
      ...(Object.keys(state.latestAnswer).length === 0 ? {} : { answer: state.latestAnswer }),
    });
  }
}

async function emitRecord(
  sink: DeveloperDiagnosticArtifactSink,
  artifactType: 'context-evolution.compaction' | 'context-evolution.terminal',
  coords: Coordinates,
  payload: ContextMonitorRecord,
): Promise<void> {
  await sink.emit({ artifactType, ...optionalCoordinates(coords), agentId: coords.agentId, agentVersion: coords.agentVersion, payload });
}

function optionalCoordinates(coords: Coordinates) {
  return {
    ...(coords.sessionId === undefined ? {} : { sessionId: coords.sessionId }),
    ...(coords.requestId === undefined ? {} : { requestId: coords.requestId }),
    ...(coords.runId === undefined ? {} : { runId: coords.runId }),
  };
}

function sessionState(sessions: Map<string, SessionState>, sessionId?: string): SessionState {
  const key = sessionId ?? '';
  let state = sessions.get(key);
  if (state === undefined) {
    state = { latestMessages: [], latestAnswer: {}, pendingCompactions: [], compactSeq: 0 };
    sessions.set(key, state);
  }
  return state;
}

function coordinatesOf(input: HookInput<LifecycleStage>): Coordinates | undefined {
  if (typeof input.agentId !== 'string' || typeof input.agentVersion !== 'string') {
    return undefined;
  }
  return {
    ...(input.sessionId === undefined ? {} : { sessionId: String(input.sessionId) }),
    ...(input.requestId === undefined ? {} : { requestId: String(input.requestId) }),
    ...(input.requestRunId === undefined ? {} : { runId: String(input.requestRunId) }),
    agentId: input.agentId,
    agentVersion: input.agentVersion,
  };
}

export function createContextMonitorPluginArtifact(options: ContextMonitorPluginArtifactOptions): ContextMonitorPluginArtifactResult {
  const targetDirectory = resolve(options.targetDirectory);
  if (existsSync(targetDirectory) && !statSync(targetDirectory).isDirectory()) {
    throw new Error('Context monitor plugin artifact target must be a directory.');
  }
  mkdirSync(targetDirectory, { recursive: true });
  const files = Object.freeze(['plugin.json', 'index.js'] as const);
  for (const file of files) {
    if (existsSync(resolve(targetDirectory, file)) && options.overwrite !== true) {
      throw new Error('Context monitor plugin artifact file already exists.');
    }
  }
  writeFileSync(resolve(targetDirectory, 'plugin.json'), pluginManifest(), 'utf8');
  writeFileSync(resolve(targetDirectory, 'index.js'), pluginBundle(), 'utf8');
  return Object.freeze({ pluginId: contextMonitorPluginId, files });
}

function pluginManifest(): string {
  return `${JSON.stringify(
    {
      pluginId: contextMonitorPluginId,
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
  return `const pluginId = ${JSON.stringify(contextMonitorPluginId)};
const hookId = ${JSON.stringify(contextMonitorHookId)};
const supportedStages = Object.freeze(${JSON.stringify(supportedStages)});

function createPlugin(host) {
  const sessions = new Map();
  const createExecutable = (enabled) => Object.freeze({
    async execute(input) {
      if (enabled !== false) {
        try { await dispatch(host.developerDiagnostics, sessions, input); } catch {}
      }
      return { outcome: "PASS" };
    }
  });
  const defaultExecutable = createExecutable(true);
  const hook = Object.freeze({
    hookId, kind: "CUSTOM", supportedStages, effects: Object.freeze(["OBSERVE"]), failureMode: "CONTINUE",
    configSchema: Object.freeze({
      type: "object", additionalProperties: false, properties: { enabled: { type: "boolean" } }
    }),
    configure(config) { return createExecutable(config.enabled === undefined ? true : Boolean(config.enabled)); },
    execute(input) { return defaultExecutable.execute(input); }
  });
  return Object.freeze({ apiVersion: "1.1", pluginId, version: "1.0.0", hooks: Object.freeze([hook]) });
}

async function dispatch(sink, sessions, input) {
  const sessionId = input.sessionId === undefined ? undefined : String(input.sessionId);
  const coords = {
    sessionId,
    requestId: input.requestId === undefined ? undefined : String(input.requestId),
    runId: input.requestRunId === undefined ? undefined : String(input.requestRunId),
    agentId: String(input.agentId),
    agentVersion: String(input.agentVersion)
  };
  let state = sessions.get(sessionId || "");
  if (state === undefined) {
    state = { latestMessages: [], latestAnswer: {}, pendingCompactions: [], compactSeq: 0 };
    sessions.set(sessionId || "", state);
  }
  const boundary = input.boundary;
  if (input.stage === "BEFORE_MODEL_INVOKE") {
    const messages = boundary.messages === undefined ? [] : boundary.messages;
    for (const item of state.pendingCompactions.splice(0)) {
      state.compactSeq += 1;
      await emit(sink, "context-evolution.compaction", coords, {
        event: "CONTEXT_COMPACT", hookId, stage: "AFTER_CONTEXT_COMPACT",
        ...present(coords), seq: state.compactSeq, pre: item.pre, post: messages,
        ...(item.summary === undefined ? {} : { summary: item.summary })
      });
    }
    state.latestMessages = messages;
  } else if (input.stage === "AFTER_MODEL_RESULT") {
    state.latestAnswer = {
      ...(boundary.content === undefined ? {} : { content: boundary.content }),
      ...(boundary.toolCalls === undefined ? {} : { toolCalls: boundary.toolCalls })
    };
  } else if (input.stage === "AFTER_CONTEXT_COMPACT") {
    state.pendingCompactions.push({
      pre: state.latestMessages,
      ...(boundary.content === undefined ? {} : { summary: boundary.content })
    });
  } else if (input.stage === "BEFORE_AGENT_TERMINAL") {
    await emit(sink, "context-evolution.terminal", coords, {
      event: "CONTEXT_LAST", hookId, stage: "BEFORE_AGENT_TERMINAL",
      ...present(coords), messages: state.latestMessages,
      ...(Object.keys(state.latestAnswer).length === 0 ? {} : { answer: state.latestAnswer })
    });
  }
}

function present(coords) {
  return {
    ...(coords.sessionId === undefined ? {} : { sessionId: coords.sessionId }),
    ...(coords.requestId === undefined ? {} : { requestId: coords.requestId }),
    ...(coords.runId === undefined ? {} : { runId: coords.runId }),
    agentId: coords.agentId, agentVersion: coords.agentVersion
  };
}
function emit(sink, artifactType, coords, payload) {
  return sink.emit({ artifactType, ...present(coords), payload });
}

export default createPlugin;
`;
}
