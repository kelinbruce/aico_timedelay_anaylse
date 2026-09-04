import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { type JsonObject } from '@nextagent/agent-common';
import { RecipeDefinitionSchema, type RecipeDefinition } from '@nextagent/agent-contracts/core';
import { Ajv } from 'ajv/dist/ajv.js';
import { load as parseYaml } from 'js-yaml';
import { brand } from '@nextagent/agent-common';
import { describe, expect, it } from 'vitest';
import { createWorkflowExecutionService } from '../src/index.js';

const ajv = new Ajv({ allErrors: true, strict: false });
const validateRecipe = ajv.compile(RecipeDefinitionSchema);

function loadDemoRecipe(): RecipeDefinition {
  const yamlText = readFileSync(resolve(__dirname, 'fixtures/alarm-localization-cancel-demo.yaml'), 'utf-8');
  const parsed = parseYaml(yamlText) as unknown;
  const valid = validateRecipe(parsed);
  if (!valid) {
    throw new Error(`Recipe schema validation failed: ${JSON.stringify(validateRecipe.errors)}`);
  }
  return parsed as RecipeDefinition;
}

function baseRequest(): Parameters<ReturnType<typeof createWorkflowExecutionService>['execute']>[0] {
  return {
    recipeName: 'alarm-localization-cancel-demo',
    recipeVersion: 'v1',
    inputVariables: {} as JsonObject,
    inputText: 'ALM-2026-0725-001',
    identityContext: { tenantId: brand('tenant-1'), subjectId: brand('user-1'), displayName: 'test' },
    agentId: brand('agent-1'),
    agentVersion: brand<string, 'AgentVersion'>('v1'),
    agentAssemblyRef: brand('assembly-1'),
    sessionId: brand('session-1'),
    requestId: brand('request-1'),
    runId: brand('run-1'),
    requestContextId: brand('ctx-1'),
  };
}

describe('alarm-localization-cancel-demo recipe', () => {
  it('passes schema validation with cancel policy configured', () => {
    const recipe = loadDemoRecipe();
    expect(recipe.recipeName).toBe('alarm-localization-cancel-demo');
    expect(recipe.runtime?.controlPolicy).toBeDefined();
    expect(recipe.runtime?.controlPolicy?.cancel?.rollbackNode).toBeDefined();
    expect(recipe.runtime?.controlPolicy?.cancel?.rollbackNode!.rollback_cleanup).toBeDefined();
    expect(recipe.runtime?.controlPolicy?.cancelTimeout).toBe(30);
  });

  it('contains rollback_cleanup node in flowGraph linked to end', () => {
    const recipe = loadDemoRecipe();
    const rollbackNode = recipe.flowGraph.nodes.rollback_cleanup;
    expect(rollbackNode).toBeDefined();
    expect(rollbackNode?.type).toBe('TOOL');
    expect(rollbackNode?.next).toEqual({ end: { condition: '' } });
  });

  it('executes rollback_cleanup when cancel triggered during apply_remediation', async () => {
    const executedNodes: string[] = [];
    const controller = new AbortController();
    const recipe = loadDemoRecipe();

    const service = createWorkflowExecutionService({
      resolveRecipeDefinition: () => recipe,
      nodeCatalog: {
        handlers: {
          TOOL: async (ctx) => {
            executedNodes.push(ctx.nodeId);
            if (ctx.nodeId === 'apply_remediation') {
              controller.abort();
              await new Promise<void>((resolve) => {
                if (ctx.signal.aborted) {
                  resolve();
                  return;
                }
                ctx.signal.addEventListener('abort', () => resolve(), { once: true });
              });
            }
            if (ctx.nodeId === 'rollback_cleanup') {
              return {
                outputVariables: { config_reverted: true, resource_released: true, cleanup_report: 'config rolled back, resources released' },
              };
            }
            return { outputVariables: {} };
          },
        },
      },
    });

    const result = await service.execute(baseRequest(), controller.signal);

    expect(result.status).toBe('INTERRUPTED');
    expect(executedNodes).toContain('fetch_alarm');
    expect(executedNodes).toContain('diagnose');
    expect(executedNodes).toContain('apply_remediation');
    expect(executedNodes).toContain('rollback_cleanup');
    expect(executedNodes).not.toContain('verify');
    expect(executedNodes).not.toContain('summarize');
    expect(result.outputVariables).toHaveProperty('config_reverted');
    expect(result.outputVariables).toHaveProperty('resource_released');
  });

  it('returns INTERRUPTED without rollback when no cancel policy configured', async () => {
    const executedNodes: string[] = [];
    const controller = new AbortController();
    const recipe = loadDemoRecipe();
    const recipeWithoutCancel: RecipeDefinition = {
      ...recipe,
      runtime: { timeout: 120 },
    };

    const service = createWorkflowExecutionService({
      resolveRecipeDefinition: () => recipeWithoutCancel,
      nodeCatalog: {
        handlers: {
          TOOL: async (ctx) => {
            executedNodes.push(ctx.nodeId);
            if (ctx.nodeId === 'apply_remediation') {
              controller.abort();
              await new Promise<void>((resolve) => {
                if (ctx.signal.aborted) {
                  resolve();
                  return;
                }
                ctx.signal.addEventListener('abort', () => resolve(), { once: true });
              });
            }
            return { outputVariables: {} };
          },
        },
      },
    });

    const result = await service.execute(baseRequest(), controller.signal);
    expect(result.status).toBe('INTERRUPTED');
    expect(executedNodes).not.toContain('rollback_cleanup');
    expect(executedNodes).not.toContain('verify');
  });

  it('rollback failure logs and returns INTERRUPTED without rollback output', async () => {
    const executedNodes: string[] = [];
    const controller = new AbortController();
    const recipe = loadDemoRecipe();

    const service = createWorkflowExecutionService({
      resolveRecipeDefinition: () => recipe,
      nodeCatalog: {
        handlers: {
          TOOL: async (ctx) => {
            executedNodes.push(ctx.nodeId);
            if (ctx.nodeId === 'apply_remediation') {
              controller.abort();
              await new Promise<void>((resolve) => {
                if (ctx.signal.aborted) {
                  resolve();
                  return;
                }
                ctx.signal.addEventListener('abort', () => resolve(), { once: true });
              });
            }
            if (ctx.nodeId === 'rollback_cleanup') {
              throw new Error('rollback service unavailable');
            }
            return { outputVariables: {} };
          },
        },
      },
    });

    const result = await service.execute(baseRequest(), controller.signal);
    expect(result.status).toBe('INTERRUPTED');
    expect(executedNodes).toContain('rollback_cleanup');
    expect(result.outputVariables).not.toHaveProperty('config_reverted');
  });
});
