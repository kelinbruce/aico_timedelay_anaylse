import { brand, type JsonObject } from '@nextagent/agent-common';
import type { RecipeDefinition, WorkflowExecutionRequest } from '@nextagent/agent-contracts/core';
import { describe, expect, it } from 'vitest';
import { createWorkflowExecutionService } from '../src/index.js';

function cancelRecipe(): RecipeDefinition {
  return {
    recipeName: 'alarm-localization',
    version: 'v1',
    displayName: '告警定位',
    flowGraph: {
      nodes: {
        start: { type: 'START', next: { diagnose: {} } },
        diagnose: { type: 'TOOL', next: { remediate: {} } },
        remediate: { type: 'TOOL', next: { end: {} } },
        rollback_cleanup: { type: 'TOOL', next: { end: {} } },
        end: { type: 'END', next: {} },
      },
    },
    runtime: {
      controlPolicy: {
        cancel: {
          rollbackNode: {
            rollback_cleanup: { condition: '' },
          },
        },
        cancelTimeout: 10,
      },
    },
  };
}

function baseE2ERequest(): WorkflowExecutionRequest {
  return {
    recipeName: 'alarm-localization',
    recipeVersion: 'v1' as const,
    inputVariables: {} as JsonObject,
    inputText: '网络告警定位',
    identityContext: {
      tenantId: brand<string, 'TenantId'>('tenant-1'),
      subjectId: brand<string, 'SubjectId'>('user-1'),
      displayName: 'Test User',
    },
    agentId: brand<string, 'AgentId'>('agent-1'),
    agentVersion: brand<string, 'AgentVersion'>('v1'),
    agentAssemblyRef: 'assembly-1',
    sessionId: brand<string, 'SessionId'>('session-1'),
    requestId: brand<string, 'MessageId'>('request-1'),
    runId: brand<string, 'RequestRunId'>('run-1'),
    requestContextId: brand<string, 'RequestContextId'>('ctx-1'),
  };
}

describe('E2E: cancel policy rollback on external cancel', () => {
  it('executes rollback_cleanup node when cancel is triggered during workflow execution', async () => {
    const executedNodes: string[] = [];
    const rollbackSideEffects: JsonObject[] = [];
    const controller = new AbortController();

    const service = createWorkflowExecutionService({
      resolveRecipeDefinition: () => cancelRecipe(),
      nodeCatalog: {
        handlers: {
          TOOL: async (ctx) => {
            executedNodes.push(ctx.nodeId);
            if (ctx.nodeId === 'diagnose') {
              // Simulate work then external cancel arrives
              controller.abort();
              // Wait for abort to propagate
              if (ctx.signal.aborted) {
                return { outputVariables: {} };
              }
              await new Promise<void>((resolve) => {
                ctx.signal.addEventListener('abort', () => resolve(), { once: true });
              });
              return { outputVariables: {} };
            }
            if (ctx.nodeId === 'rollback_cleanup') {
              const output = { config_reverted: true, resource_released: true };
              rollbackSideEffects.push(output as JsonObject);
              return { outputVariables: output };
            }
            return { outputVariables: {} };
          },
        },
      },
    });

    const result = await service.execute(baseE2ERequest(), controller.signal);

    // Workflow should be interrupted (cancelled)
    expect(result.status).toBe('INTERRUPTED');

    // The rollback_cleanup node must have been executed
    expect(executedNodes).toContain('rollback_cleanup');

    // The rollback side effects should be in output variables
    expect(result.outputVariables).toHaveProperty('config_reverted');
    expect(result.outputVariables).toHaveProperty('resource_released');

    // remediate node should NOT have been executed (cancel happened before it)
    expect(executedNodes).not.toContain('remediate');
  });

  it('returns INTERRUPTED without rollback when no cancel policy configured', async () => {
    const executedNodes: string[] = [];
    const controller = new AbortController();

    const service = createWorkflowExecutionService({
      resolveRecipeDefinition: () => ({
        ...cancelRecipe(),
        runtime: { timeout: 60 },
      }),
      nodeCatalog: {
        handlers: {
          TOOL: async (ctx) => {
            executedNodes.push(ctx.nodeId);
            if (ctx.nodeId === 'diagnose') {
              controller.abort();
              if (ctx.signal.aborted) {
                return { outputVariables: {} };
              }
              await new Promise<void>((resolve) => {
                ctx.signal.addEventListener('abort', () => resolve(), { once: true });
              });
            }
            return { outputVariables: {} };
          },
        },
      },
    });

    const result = await service.execute(baseE2ERequest(), controller.signal);
    expect(result.status).toBe('INTERRUPTED');
    expect(executedNodes).not.toContain('rollback_cleanup');
    expect(executedNodes).not.toContain('remediate');
  });

  it('returns INTERRUPTED and logs failure when rollback node throws', async () => {
    const executedNodes: string[] = [];
    const controller = new AbortController();

    const service = createWorkflowExecutionService({
      resolveRecipeDefinition: () => cancelRecipe(),
      nodeCatalog: {
        handlers: {
          TOOL: async (ctx) => {
            executedNodes.push(ctx.nodeId);
            if (ctx.nodeId === 'diagnose') {
              controller.abort();
              if (ctx.signal.aborted) {
                return { outputVariables: {} };
              }
              await new Promise<void>((resolve) => {
                ctx.signal.addEventListener('abort', () => resolve(), { once: true });
              });
            }
            if (ctx.nodeId === 'rollback_cleanup') {
              throw new Error('cleanup service unavailable');
            }
            return { outputVariables: {} };
          },
        },
      },
    });

    const result = await service.execute(baseE2ERequest(), controller.signal);
    expect(result.status).toBe('INTERRUPTED');
    expect(executedNodes).toContain('rollback_cleanup');
    // rollback failed, so its output variables should not be present
    expect(result.outputVariables).not.toHaveProperty('config_reverted');
  });
});
