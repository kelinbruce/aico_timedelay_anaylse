import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { LifecycleStage } from '@nextagent/agent-common';
import type { HookInput } from '@nextagent/agent-contracts/runtime';
import { describe, expect, it, vi } from 'vitest';
import type { DeveloperDiagnosticArtifactInput, DeveloperDiagnosticArtifactSink } from '../src/index.js';
import {
  contextMonitorHookId,
  contextMonitorPluginId,
  createContextMonitorPlugin,
  createContextMonitorPluginArtifact,
} from '../src/context-monitor.js';

function makeInput(stage: LifecycleStage, boundary: Record<string, unknown>): HookInput<LifecycleStage> {
  return {
    hookId: contextMonitorHookId,
    sessionId: 'session-1' as never,
    requestId: 'request-1' as never,
    requestRunId: 'run-1' as never,
    agentId: 'agent-dev' as never,
    agentVersion: 'v1' as never,
    agentAssemblyRef: 'agent-dev:v1',
    stage,
    boundary,
  } as unknown as HookInput<LifecycleStage>;
}

function capture() {
  const records: DeveloperDiagnosticArtifactInput[] = [];
  const sink: DeveloperDiagnosticArtifactSink = {
    async emit(input) {
      records.push(input);
      return { status: 'ACCEPTED' };
    },
  };
  return { records, sink };
}

describe('context-monitor plugin', () => {
  it('emits one compaction and one terminal artifact while preserving raw context semantics', async () => {
    const { records, sink } = capture();
    const plugin = createContextMonitorPlugin({ developerDiagnostics: sink });
    const hook = plugin.hooks?.[0]!;
    const before = [{ role: 'USER', content: 'old' }];
    const after = [{ role: 'SUMMARY', content: 'summary' }];

    expect(plugin.apiVersion).toBe('1.1');
    await hook.execute(makeInput('BEFORE_MODEL_INVOKE', { messages: before }));
    await hook.execute(makeInput('AFTER_CONTEXT_COMPACT', { content: 'summary' }));
    await hook.execute(makeInput('BEFORE_MODEL_INVOKE', { messages: after }));
    await hook.execute(makeInput('AFTER_MODEL_RESULT', { content: 'answer', toolCalls: [] }));
    await hook.execute(makeInput('BEFORE_AGENT_TERMINAL', { finalContent: 'answer' }));

    expect(records).toEqual([
      expect.objectContaining({
        artifactType: 'context-evolution.compaction',
        sessionId: 'session-1',
        payload: expect.objectContaining({
          event: 'CONTEXT_COMPACT',
          pre: before,
          post: after,
          summary: 'summary',
          seq: 1,
        }),
      }),
      expect.objectContaining({
        artifactType: 'context-evolution.terminal',
        sessionId: 'session-1',
        payload: expect.objectContaining({
          event: 'CONTEXT_LAST',
          messages: after,
          answer: { content: 'answer', toolCalls: [] },
        }),
      }),
    ]);
  });

  it('does not emit for ordinary turns and keeps disabled/failure paths observe-only', async () => {
    const { records, sink } = capture();
    const hook = createContextMonitorPlugin({ developerDiagnostics: sink }).hooks?.[0]!;
    await hook.execute(makeInput('BEFORE_MODEL_INVOKE', { messages: [] }));
    await hook.execute(makeInput('AFTER_MODEL_RESULT', { content: 'answer' }));
    expect(records).toEqual([]);

    const disabledEmit = vi.fn(async () => ({ status: 'ACCEPTED' as const }));
    const disabled = createContextMonitorPlugin({
      enabled: false,
      developerDiagnostics: { emit: disabledEmit },
    });
    await expect(disabled.hooks?.[0]?.execute(makeInput('BEFORE_AGENT_TERMINAL', {}))).resolves.toEqual({ outcome: 'PASS' });
    expect(disabledEmit).not.toHaveBeenCalled();

    const failing = createContextMonitorPlugin({
      developerDiagnostics: {
        async emit() {
          throw new Error('unavailable');
        },
      },
    });
    await expect(failing.hooks?.[0]?.execute(makeInput('BEFORE_AGENT_TERMINAL', {}))).resolves.toEqual({ outcome: 'PASS' });
  });

  it('creates an API 1.1 factory artifact without direct file output or path configuration', async () => {
    const targetDirectory = join(mkdtempSync(join(tmpdir(), 'nextagent-context-artifact-')), 'plugin');
    expect(createContextMonitorPluginArtifact({ targetDirectory })).toEqual({
      pluginId: contextMonitorPluginId,
      files: ['plugin.json', 'index.js'],
    });
    expect(JSON.parse(readFileSync(join(targetDirectory, 'plugin.json'), 'utf8'))).toMatchObject({
      pluginId: contextMonitorPluginId,
      apiVersion: '1.1',
    });
    const source = readFileSync(join(targetDirectory, 'index.js'), 'utf8');
    expect(source).not.toContain('getBuiltinModule');
    expect(source).not.toContain('logDirectory');
    expect(source).not.toContain('logFile');

    const emit = vi.fn(async () => ({ status: 'ACCEPTED' as const }));
    const mod = (await import(`${pathToFileURL(join(targetDirectory, 'index.js')).href}?t=${Date.now()}`)) as {
      readonly default: (host: { readonly developerDiagnostics: DeveloperDiagnosticArtifactSink }) => ReturnType<typeof createContextMonitorPlugin>;
    };
    const plugin = mod.default({ developerDiagnostics: { emit }, externals: {} } as never);
    await plugin.hooks?.[0]?.execute(makeInput('BEFORE_AGENT_TERMINAL', {}));
    expect(emit).toHaveBeenCalledWith(
      expect.objectContaining({
        artifactType: 'context-evolution.terminal',
        payload: expect.objectContaining({ event: 'CONTEXT_LAST' }),
      }),
    );
  });
});
