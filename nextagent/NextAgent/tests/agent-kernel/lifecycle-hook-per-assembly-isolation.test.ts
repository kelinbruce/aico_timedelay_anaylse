import { createNextAgentTestApp } from '@nextagent/agent-platform-gateway-local/testing';
import { brand } from '@nextagent/agent-common';
import { defineLifecycleHook } from '@nextagent/agent-runtime';
import type { HookBoundaryByStage, LifecycleHookInvocationRequest } from '@nextagent/agent-contracts/runtime';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import { apps, closeLifecycleHookApps, identity } from './lifecycle-hook-test-helpers.js';

afterEach(async () => {
  await closeLifecycleHookApps();
});

describe('lifecycle hook per-assembly executable isolation', () => {
  it('materializes per-assembly configured executables for all discovered assemblies', async () => {
    const tempWorkspace = join(tmpdir(), `nextagent-hook-isolation-${Date.now()}`);
    const agentsRoot = join(tempWorkspace, 'agents');
    const secondaryAgentDir = join(agentsRoot, 'secondary-agent');
    mkdirSync(secondaryAgentDir, { recursive: true });
    writeFileSync(
      join(secondaryAgentDir, 'agent.yaml'),
      JSON.stringify({
        agentId: 'secondary-agent',
        agentVersion: 'v1',
        displayName: 'Secondary Agent',
        description: 'Secondary agent for hook config isolation test',
        modelIds: ['deterministic-test-model'],
        capabilityBindings: [],
        userInvocable: true,
        runtimeSettings: { defaultLanguage: 'zh-CN', maxTurns: 3, maxToolCallsPerTurn: 30, requestTimeoutMs: 30000 },
        resources: [],
        hooks: [{ hookId: 'custom.terminal-prefix', enabled: true, config: { prefix: 'secondary:' } }],
      }),
    );

    const seenPrefixes: string[] = [];

    const terminalHook = defineLifecycleHook({
      hookId: 'custom.terminal-prefix',
      kind: 'CUSTOM',
      supportedStages: ['BEFORE_AGENT_TERMINAL'] as const,
      effects: ['TRANSFORM'] as const,
      failureMode: 'FAIL',
      configSchema: {
        type: 'object',
        additionalProperties: false,
        properties: { prefix: { type: 'string' } },
      },
      configure(config) {
        const prefix = typeof config['prefix'] === 'string' ? config['prefix'] : 'fallback';
        return {
          execute(input) {
            seenPrefixes.push(prefix);
            return {
              outcome: 'PASS',
              mutation: { finalContent: `${prefix}${input.boundary.finalContent}` },
            };
          },
        };
      },
      execute(input) {
        seenPrefixes.push('fallback');
        return { outcome: 'PASS', mutation: { finalContent: input.boundary.finalContent } };
      },
    });

    try {
      const app = createNextAgentTestApp({
        workspaceDir: tempWorkspace,
        modelSteps: [{ content: 'isolation test' }],
        identity,
        lifecycleHooks: [terminalHook],
        hooks: [{ hookId: 'custom.terminal-prefix', enabled: true, config: { prefix: 'default-agent:' } }],
      });
      apps.push(app);

      const port = app.runtime.lifecycleHookInvocationPort();

      const assemblyDefault = await app.assemblyRegistry.require(brand<string, 'AgentId'>('default-agent'), brand<string, 'AgentVersion'>('v1'));
      const assemblySecondary = await app.assemblyRegistry.require(brand<string, 'AgentId'>('secondary-agent'), brand<string, 'AgentVersion'>('v1'));

      const boundary: HookBoundaryByStage['BEFORE_AGENT_TERMINAL'] = {
        finalContent: 'content',
        toolCalls: [],
        safeTerminalSummary: 'content',
      };

      const resultDefault = await port.invoke({
        stage: 'BEFORE_AGENT_TERMINAL',
        coordinates: {
          agentId: assemblyDefault.agentId,
          agentVersion: assemblyDefault.agentVersion,
          agentAssemblyRef: assemblyDefault.agentAssemblyRef,
          stageOccurrenceKey: 'test:default',
        },
        ownerScope: { tenantId: identity.tenantId, subjectId: identity.subjectId },
        boundary,
      });

      const resultSecondary = await port.invoke({
        stage: 'BEFORE_AGENT_TERMINAL',
        coordinates: {
          agentId: assemblySecondary.agentId,
          agentVersion: assemblySecondary.agentVersion,
          agentAssemblyRef: assemblySecondary.agentAssemblyRef,
          stageOccurrenceKey: 'test:secondary',
        },
        ownerScope: { tenantId: identity.tenantId, subjectId: identity.subjectId },
        boundary,
      });

      expect(resultDefault.status).toBe('CONTINUE');
      expect(resultSecondary.status).toBe('CONTINUE');

      if (resultDefault.status === 'CONTINUE' && resultSecondary.status === 'CONTINUE') {
        expect(resultDefault.boundary.finalContent).toBe('default-agent:content');
        expect(resultSecondary.boundary.finalContent).toBe('secondary:content');
        expect(seenPrefixes).toEqual(['default-agent:', 'secondary:']);
      }
    } finally {
      rmSync(tempWorkspace, { recursive: true, force: true });
    }
  });
});
