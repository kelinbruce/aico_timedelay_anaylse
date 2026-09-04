import { modelEventStreamFixture } from '../../../tests/helpers/model-stream-fixture.js';
import { brand, type JsonObject } from '@nextagent/agent-common';
import {
  RecipeDefinitionSchema,
  type RecipeDefinition,
  type WorkflowExecutionEvent,
  type WorkflowExecutionRequest,
} from '@nextagent/agent-contracts/core';
import type { CapabilityInvocationPort, CapabilityInvocationRequest, CapabilityInvocationResult } from '@nextagent/agent-contracts/capability';
import type { ModelInferenceOptions, ModelInvocationRequest, ModelInvocationService } from '@nextagent/agent-contracts/model';
import { Ajv } from 'ajv/dist/ajv.js';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  createWorkflowExecutionService,
  createWorkflowNodeCatalog,
  createRecipeCapabilityProvider,
  listRecipeCapabilityDescriptors,
  WorkflowRecipeDefinitionSource,
} from '../src/index.js';

// ---------------------------------------------------------------------------
// Blackbox goal
// ---------------------------------------------------------------------------
// Verifies the externally observable recipe contract after the
// refine-ts-workflow-recipe-v2-contracts changes:
//   1. recipe schema accepts Chinese recipeName / domain / scene and lang=zh.
//   2. recipe time fields are integer seconds (delay_time, join_timeout,
//      node timeout, retry delay, runtime timeout, poll_*).
//   3. numeric/boolean node inputs accept string-quoted values ("10", "true")
//      and coerce them, EXCEPT model_params which is passed through untouched.
//   4. END nodes do not require a `next` field (1.0 DSL convention).
//   5. composite end-to-end recipe compiles and executes.
// Asserts on observable results (elapsed time, captured model inference options,
// output variables) rather than private code paths. The sub-recipe
// recipe_result binding is covered separately in workflow-interaction-nodes.
// ---------------------------------------------------------------------------

const ajv = new Ajv({ allErrors: true, strict: false });
const validateRecipe = ajv.compile(RecipeDefinitionSchema);

// END nodes carry no outgoing branches; per 1.0 DSL they omit `next`.
function endNode(): RecipeDefinition['flowGraph']['nodes'][string] {
  return { type: 'END' };
}

// ---------------------------------------------------------------------------
// Schema blackbox: Chinese classification + seconds + END without next
// ---------------------------------------------------------------------------

describe('recipe blackbox - schema', () => {
  it('accepts optional localized display names without changing the required stable display name', () => {
    const recipe = {
      recipeName: 'localized-workflow',
      version: 'v1',
      displayName: 'Alarm recovery',
      locales: {
        language: {
          'zh-CN': { displayName: '告警恢复' },
          'en-US': { displayName: 'Alarm recovery' },
        },
      },
      flowGraph: {
        nodes: {
          start: { type: 'START', next: { end: {} } },
          end: { type: 'END' },
        },
      },
    };

    expect(validateRecipe(recipe)).toBe(true);
  });

  it('accepts a recipe with Chinese recipeName/domain/scene and lang=zh', () => {
    const recipe: RecipeDefinition = {
      type: 'recipe',
      recipeName: '告警诊断流程',
      version: 'v1.1.0',
      displayName: '告警诊断流程',
      description: '网络告警定位',
      domain: '故障诊断',
      scene: '告警定位 v2',
      lang: 'zh',
      flowGraph: {
        nodes: {
          start: { type: 'START', next: { delay: {} } },
          delay: {
            type: 'DELAY',
            description: '等待1秒',
            inputs: { delay_time: '1' },
            next: { end: {} },
          },
          end: endNode(),
        },
      },
    };

    expect(validateRecipe(recipe)).toBe(true);
  });

  it('accepts integer-second node timeout, retry delay and runtime timeout', () => {
    const recipe: RecipeDefinition = {
      recipeName: 'timeout-seconds-recipe',
      version: 'v1',
      displayName: 'Timeout seconds',
      flowGraph: {
        nodes: {
          start: { type: 'START', next: { ask: {} } },
          ask: {
            type: 'LLM_ROUTER',
            timeout: 2,
            retry: { maxAttempts: 2, delay: 1 },
            inputs: { prompt: 'ok' },
            outputs: { raw: '${llm_completion}' },
            next: { end: {} },
          },
          end: endNode(),
        },
      },
      runtime: { timeout: 3 },
    };

    expect(validateRecipe(recipe)).toBe(true);
  });

  it('accepts an END node without a next field', () => {
    const recipe = {
      recipeName: 'end-without-next',
      version: 'v1',
      displayName: 'End without next',
      flowGraph: {
        nodes: {
          start: { type: 'START', next: { end: {} } },
          end: { type: 'END' },
        },
      },
    };

    expect(validateRecipe(recipe)).toBe(true);
  });

  it('rejects a fractional retry delay (seconds must be integers)', () => {
    const recipe = {
      recipeName: 'fractional-delay',
      version: 'v1',
      displayName: 'Fractional',
      flowGraph: {
        nodes: {
          start: { type: 'START', next: { ask: {} } },
          ask: {
            type: 'LLM_ROUTER',
            retry: { maxAttempts: 1, delay: 1.5 },
            inputs: { prompt: 'ok' },
            next: { end: {} },
          },
          end: { type: 'END' },
        },
      },
    };

    expect(validateRecipe(recipe)).toBe(false);
  });

  it('rejects lang values outside the zh|en enum', () => {
    const recipe = {
      recipeName: 'bad-lang',
      version: 'v1',
      displayName: 'Bad lang',
      lang: 'fr',
      flowGraph: {
        nodes: {
          start: { type: 'START', next: { end: {} } },
          end: { type: 'END' },
        },
      },
    };

    expect(validateRecipe(recipe)).toBe(false);
  });

  it('accepts a 255-char recipeName (1.0 spec upper bound)', () => {
    const recipe = {
      recipeName: 'a'.repeat(255),
      version: 'v1',
      displayName: 'Max name',
      flowGraph: {
        nodes: {
          start: { type: 'START', next: { end: {} } },
          end: { type: 'END' },
        },
      },
    };

    expect(validateRecipe(recipe)).toBe(true);
  });

  it('rejects a recipeName exceeding 255 characters', () => {
    const recipe = {
      recipeName: 'a'.repeat(256),
      version: 'v1',
      displayName: 'Over name',
      flowGraph: {
        nodes: {
          start: { type: 'START', next: { end: {} } },
          end: { type: 'END' },
        },
      },
    };

    expect(validateRecipe(recipe)).toBe(false);
  });
});

describe('recipe blackbox - capability descriptor presentation', () => {
  it('projects Recipe displayName and locales while keeping recipeName as Workflow identity', () => {
    const agentsRoot = mkdtempSync(join(tmpdir(), 'nextagent-workflow-locales-'));
    const agentId = brand<string, 'AgentId'>('localized-agent');
    const recipeDirectory = join(agentsRoot, agentId, 'recipes');
    mkdirSync(recipeDirectory, { recursive: true });
    writeFileSync(
      join(recipeDirectory, 'alarm-recovery.yaml'),
      [
        'recipeName: alarm-recovery',
        'version: v1',
        'displayName: Alarm recovery',
        'locales:',
        '  language:',
        '    zh-CN:',
        '      displayName: 告警恢复',
        '    en-US:',
        '      displayName: Alarm recovery',
        'flowGraph:',
        '  nodes:',
        '    start:',
        '      type: START',
        '      next:',
        '        end: {}',
        '    end:',
        '      type: END',
      ].join('\n'),
      'utf8',
    );

    try {
      const descriptors = listRecipeCapabilityDescriptors(new WorkflowRecipeDefinitionSource({ agentsRoot }), agentId);

      expect(descriptors).toHaveLength(1);
      expect(descriptors[0]).toMatchObject({
        capabilityId: 'alarm-recovery',
        kind: 'WORKFLOW',
        displayName: 'Alarm recovery',
        locales: {
          language: {
            'zh-CN': { displayName: '告警恢复' },
            'en-US': { displayName: 'Alarm recovery' },
          },
        },
      });
    } finally {
      rmSync(agentsRoot, { recursive: true, force: true });
    }
  });

  it('skips a Recipe with invalid localized display names', () => {
    const agentsRoot = mkdtempSync(join(tmpdir(), 'nextagent-workflow-invalid-locales-'));
    const agentId = brand<string, 'AgentId'>('localized-agent');
    const recipeDirectory = join(agentsRoot, agentId, 'recipes');
    mkdirSync(recipeDirectory, { recursive: true });
    writeFileSync(
      join(recipeDirectory, 'invalid.yaml'),
      [
        'recipeName: invalid-locales',
        'version: v1',
        'displayName: Invalid locales',
        'locales:',
        '  language:',
        '    en-US:',
        '      displayName: "   "',
        'flowGraph:',
        '  nodes:',
        '    start:',
        '      type: START',
        '      next:',
        '        end: {}',
        '    end:',
        '      type: END',
      ].join('\n'),
      'utf8',
    );

    try {
      const source = new WorkflowRecipeDefinitionSource({ agentsRoot });

      expect(source.list(agentId)).toEqual([]);
      expect(listRecipeCapabilityDescriptors(source, agentId)).toEqual([]);
    } finally {
      rmSync(agentsRoot, { recursive: true, force: true });
    }
  });

  it('current Recipe discovery skips one invalid file and returns valid siblings', async () => {
    const agentsRoot = mkdtempSync(join(tmpdir(), 'nextagent-workflow-current-isolation-'));
    const agentId = brand<string, 'AgentId'>('current-recipe-agent');
    const recipeDirectory = join(agentsRoot, agentId, 'recipes');
    mkdirSync(recipeDirectory, { recursive: true });
    writeFileSync(
      join(recipeDirectory, 'healthy.yaml'),
      ['recipeName: healthy-recipe', 'version: v1', 'displayName: Healthy recipe'].join('\n'),
      'utf8',
    );
    writeFileSync(join(recipeDirectory, 'invalid.yaml'), 'recipeName: [not-valid-yaml', 'utf8');

    try {
      const provider = createRecipeCapabilityProvider(new WorkflowRecipeDefinitionSource({ agentsRoot }));
      const listCurrent = provider.discovery.listCurrent;
      if (listCurrent === undefined) {
        throw new Error('Expected Recipe capability provider to expose listCurrent.');
      }

      await expect(
        listCurrent(
          {
            tenantId: brand<string, 'TenantId'>('tenant-workflow-current'),
            subjectId: brand<string, 'SubjectId'>('subject-workflow-current'),
            agentId,
            agentVersion: brand<string, 'AgentVersion'>('v1'),
            agentAssemblyRef: `${agentId}:v1`,
            sessionId: brand<string, 'SessionId'>('session-workflow-current'),
          },
          new AbortController().signal,
        ),
      ).resolves.toEqual([expect.objectContaining({ capabilityId: 'healthy-recipe', displayName: 'Healthy recipe' })]);
    } finally {
      rmSync(agentsRoot, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// Execution blackbox helpers
// ---------------------------------------------------------------------------

function baseRequest(): WorkflowExecutionRequest {
  return {
    recipeName: 'workflow-test',
    recipeVersion: 'v1',
    inputVariables: {},
    identityContext: {
      tenantId: brand<string, 'TenantId'>('tenant-workflow'),
      subjectId: brand<string, 'SubjectId'>('subject-workflow'),
      displayName: 'Workflow tester',
    },
    agentId: brand<string, 'AgentId'>('agent-workflow'),
    agentVersion: brand<string, 'AgentVersion'>('v1'),
    sessionId: brand<string, 'SessionId'>('session-workflow'),
    requestId: brand<string, 'MessageId'>('request-workflow'),
    runId: brand<string, 'RequestRunId'>('run-workflow'),
    requestContextId: brand<string, 'RequestContextId'>('context-workflow'),
  };
}

function recipe(nodes: RecipeDefinition['flowGraph']['nodes']): RecipeDefinition {
  return {
    recipeName: 'workflow-test',
    version: 'v1',
    displayName: 'Workflow test',
    flowGraph: { nodes },
  };
}

function node(
  type: RecipeDefinition['flowGraph']['nodes'][string]['type'],
  next: Record<string, { readonly condition?: string }> = {},
  extras: Partial<{
    readonly timeout: number;
    readonly retry: JsonObject;
    readonly inputs: JsonObject;
    readonly outputs: JsonObject;
  }> = {},
): RecipeDefinition['flowGraph']['nodes'][string] {
  return {
    type,
    next,
    ...(extras.timeout === undefined ? {} : { timeout: extras.timeout }),
    ...(extras.retry === undefined ? {} : { retry: extras.retry }),
    ...(extras.inputs === undefined ? {} : { inputs: extras.inputs }),
    ...(extras.outputs === undefined ? {} : { outputs: extras.outputs }),
  };
}

function captureModel(captured: ModelInvocationRequest[], response: { readonly content: string }): ModelInvocationService {
  return {
    async complete(request) {
      captured.push(request);
      return { content: response.content };
    },
    stream: modelEventStreamFixture(async function* (request) {
      captured.push(request);
      yield { content: response.content, finishReason: 'stop' };
    }),
  };
}

function capabilityPort(
  invoke: (request: CapabilityInvocationRequest, signal: AbortSignal) => Promise<CapabilityInvocationResult>,
): CapabilityInvocationPort {
  return { invoke: vi.fn(invoke) };
}

function succeeded(structuredPayload: JsonObject): CapabilityInvocationResult {
  return {
    status: 'SUCCEEDED',
    structuredPayload,
    generatedMessages: [],
    artifactRefs: [],
  };
}

function createService(input: {
  readonly recipe: RecipeDefinition;
  readonly modelInvocation?: ModelInvocationService;
  readonly capabilityInvocation?: CapabilityInvocationPort;
  readonly nodeCatalog?: { readonly handlers: Record<string, (context: never) => Promise<unknown>> };
  readonly emitEvent?: (event: WorkflowExecutionEvent) => void | Promise<void>;
}) {
  const modelCatalog = createWorkflowNodeCatalog({
    ...(input.modelInvocation === undefined ? {} : { modelInvocation: input.modelInvocation }),
    ...(input.capabilityInvocation === undefined ? {} : { capabilityInvocation: input.capabilityInvocation }),
    resolveModelInvocationConfig: async () => ({
      modelId: 'deterministic-test-model',
      contextWindowTokens: 8192,
      inferenceOptions: {} as ModelInferenceOptions,
      timeoutMs: 30_000,
      maxRetries: 2,
    }),
  });

  return createWorkflowExecutionService({
    resolveRecipeDefinition: () => input.recipe,
    nodeCatalog: {
      handlers: Object.freeze({
        ...modelCatalog.handlers,
        ...(input.nodeCatalog?.handlers ?? {}),
      }),
    },
    ...(input.emitEvent === undefined ? {} : { emitEvent: input.emitEvent }),
  });
}

// Minimal stub handler for parallel-gateway branches, mirroring how the
// engine tests use TOOL/SKILL stub handlers to emit an output variable.
function branchHandler(outputKey: string, outputValue: string) {
  return async () => ({ outputVariables: { [outputKey]: outputValue } as JsonObject });
}

// ---------------------------------------------------------------------------
// Execution blackbox: delay_time seconds (string-quoted)
// ---------------------------------------------------------------------------

describe('recipe blackbox - delay_time is integer seconds', () => {
  it('waits ~1000ms for delay_time: "1"', async () => {
    const service = createService({
      recipe: recipe({
        start: node('START', { wait: {} }),
        wait: node('DELAY', { end: {} }, { inputs: { delay_time: '1' }, outputs: { delay_ms: '${delay_ms}' } }),
        end: endNode(),
      }),
    });

    const startedAt = Date.now();
    const result = await service.execute(baseRequest(), new AbortController().signal);

    expect(Date.now() - startedAt).toBeGreaterThanOrEqual(1000);
    expect(Date.now() - startedAt).toBeLessThan(2500);
    expect(result.status).toBe('COMPLETED');
    expect(result.outputVariables).toMatchObject({ delay_ms: 1000 });
  });

  it('rejects a fractional delay_time as an invalid node input', async () => {
    const service = createService({
      recipe: recipe({
        start: node('START', { wait: {} }),
        wait: node('DELAY', { end: {} }, { inputs: { delay_time: '1.5' } }),
        end: endNode(),
      }),
    });

    const result = await service.execute(baseRequest(), new AbortController().signal);

    expect(result.status).toBe('FAILED');
  });
});

// ---------------------------------------------------------------------------
// Execution blackbox: parallel gateway join_timeout seconds (string-quoted)
// ---------------------------------------------------------------------------

describe('recipe blackbox - join_timeout is integer seconds', () => {
  it('joins branches successfully with string-quoted join_timeout: "2"', async () => {
    const service = createService({
      recipe: recipe({
        start: node('START', { fork: {} }),
        fork: node(
          'PARALLEL',
          { branchA: {}, branchB: {} },
          {
            inputs: { join_node: 'join', join_timeout: '2' },
          },
        ),
        branchA: node('TOOL', { join: {} }),
        branchB: node('TOOL', { join: {} }),
        join: node('DISPLAY', { end: {} }, { inputs: { content: 'joined' } }),
        end: endNode(),
      }),
      nodeCatalog: {
        handlers: {
          TOOL: branchHandler('branchResult', 'ok'),
        },
      },
    });

    const result = await service.execute(baseRequest(), new AbortController().signal);

    expect(result.status).toBe('COMPLETED');
  });

  it('ignores a fractional join_timeout (treated as no timeout)', async () => {
    const service = createService({
      recipe: recipe({
        start: node('START', { fork: {} }),
        fork: node(
          'PARALLEL',
          { branchA: {}, branchB: {} },
          {
            inputs: { join_node: 'join', join_timeout: '1.5' },
          },
        ),
        branchA: node('TOOL', { join: {} }),
        branchB: node('TOOL', { join: {} }),
        join: node('DISPLAY', { end: {} }, { inputs: { content: 'joined' } }),
        end: endNode(),
      }),
      nodeCatalog: {
        handlers: {
          TOOL: branchHandler('branchResult', 'ok'),
        },
      },
    });

    const result = await service.execute(baseRequest(), new AbortController().signal);

    expect(result.status).toBe('COMPLETED');
  });
});

// ---------------------------------------------------------------------------
// Execution blackbox: invalid string model_params are not coerced
// ---------------------------------------------------------------------------

describe('recipe blackbox - canonical model_params remain typed', () => {
  it('does not project string temperature and max_tokens as inference options', async () => {
    const requests: ModelInvocationRequest[] = [];
    const service = createService({
      recipe: recipe({
        start: node('START', { ask: {} }),
        ask: node(
          'LLM_ROUTER',
          { end: {} },
          {
            inputs: {
              prompt: 'Diagnose the alarm.',
              model_params: { temperature: '0.8', max_tokens: '1024' },
            },
            outputs: { raw: '${llm_completion}' },
          },
        ),
        end: endNode(),
      }),
      modelInvocation: captureModel(requests, { content: 'stable' }),
    });

    const result = await service.execute(baseRequest(), new AbortController().signal);

    expect(result.status).toBe('COMPLETED');
    expect(requests).toHaveLength(1);
    expect(requests[0]).not.toHaveProperty('temperature');
    expect(requests[0]).not.toHaveProperty('maxOutputTokens');
  });

  it('does not convert string enable_thinking into thinking (strict boolean gate)', async () => {
    const requests: ModelInvocationRequest[] = [];
    const service = createService({
      recipe: recipe({
        start: node('START', { ask: {} }),
        ask: node(
          'LLM_ROUTER',
          { end: {} },
          {
            inputs: {
              prompt: 'ok',
              model_params: { enable_thinking: 'true' },
            },
            outputs: { raw: '${llm_completion}' },
          },
        ),
        end: endNode(),
      }),
      modelInvocation: captureModel(requests, { content: 'done' }),
    });

    await service.execute(baseRequest(), new AbortController().signal);

    expect(requests[0]?.thinking).toBeUndefined();
  });

  it('still maps a boolean enable_thinking to thinking (control case)', async () => {
    const requests: ModelInvocationRequest[] = [];
    const service = createService({
      recipe: recipe({
        start: node('START', { ask: {} }),
        ask: node(
          'LLM_ROUTER',
          { end: {} },
          {
            inputs: {
              prompt: 'ok',
              model_params: { enable_thinking: true },
            },
            outputs: { raw: '${llm_completion}' },
          },
        ),
        end: endNode(),
      }),
      modelInvocation: captureModel(requests, { content: 'done' }),
    });

    await service.execute(baseRequest(), new AbortController().signal);

    expect(requests[0]?.thinking).toMatchObject({ depth: 'HIGH' });
  });
});

// ---------------------------------------------------------------------------
// Execution blackbox: restful long-task polling accepts string booleans/numbers
// ---------------------------------------------------------------------------

describe('recipe blackbox - restful is_long_api string coercion', () => {
  it('enters long-task polling when is_long_api: "true" with string poll_* seconds', async () => {
    const invoke = vi.fn(async (): Promise<CapabilityInvocationResult> => succeeded({ status: 'DONE', task_id: 'task-1' }));
    const service = createService({
      recipe: recipe({
        start: node('START', { call: {} }),
        call: node(
          'RESTFUL',
          { end: {} },
          {
            inputs: {
              api_name: 'long-task',
              is_long_api: 'true',
              poll_max_times: '1',
              poll_interval: '1',
              poll_timeout: '2',
            },
            outputs: { poll_results: '${poll_results}' },
          },
        ),
        end: endNode(),
      }),
      capabilityInvocation: capabilityPort(invoke),
    });

    const result = await service.execute(baseRequest(), new AbortController().signal);

    expect(result.status).toBe('COMPLETED');
    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it('takes the direct path when is_long_api: "false" (string)', async () => {
    const invoke = vi.fn(async (): Promise<CapabilityInvocationResult> => succeeded({ status: 'OK' }));
    const service = createService({
      recipe: recipe({
        start: node('START', { call: {} }),
        call: node(
          'RESTFUL',
          { end: {} },
          {
            inputs: { api_name: 'direct-call', is_long_api: 'false' },
            outputs: { result: '${result}' },
          },
        ),
        end: endNode(),
      }),
      capabilityInvocation: capabilityPort(invoke),
    });

    const result = await service.execute(baseRequest(), new AbortController().signal);

    expect(result.status).toBe('COMPLETED');
    expect(invoke).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// Execution blackbox: end-to-end composite recipe
// ---------------------------------------------------------------------------

describe('recipe blackbox - composite recipe covers all modified points', () => {
  it('executes a recipe with Chinese metadata, seconds, string coercion and model_params passthrough', async () => {
    const requests: ModelInvocationRequest[] = [];
    const restfulInvoke = vi.fn(async (): Promise<CapabilityInvocationResult> => succeeded({ status: 'OK', ne: 'NE-1' }));

    const composite: RecipeDefinition = {
      type: 'recipe',
      recipeName: '告警诊断流程',
      version: 'v1.1.0',
      displayName: '告警诊断流程',
      description: '网络告警定位',
      domain: '故障诊断',
      scene: '告警定位 v2',
      lang: 'zh',
      runtime: { timeout: 5 },
      flowGraph: {
        nodes: {
          start: { type: 'START', next: { delay: {} } },
          delay: {
            type: 'DELAY',
            description: '等待1秒',
            inputs: { delay_time: '1' },
            outputs: { delay_ms: '${delay_ms}' },
            next: { fork: {} },
          },
          fork: {
            type: 'PARALLEL',
            description: '并行网关',
            inputs: { join_node: 'join', join_timeout: '3' },
            next: { branchA: {}, branchB: {} },
          },
          branchA: {
            type: 'TOOL',
            description: '分支A',
            next: { join: {} },
          },
          branchB: {
            type: 'RESTFUL',
            description: '分支B查询',
            timeout: 2,
            retry: { maxAttempts: 1, delay: 1 },
            inputs: { api_name: 'ne-status', is_long_api: 'false' },
            outputs: { result: '${result}' },
            next: { join: {} },
          },
          join: {
            type: 'DISPLAY',
            description: '汇聚节点',
            inputs: { content: 'joined' },
            next: { ask: {} },
          },
          ask: {
            type: 'LLM_ROUTER',
            description: '模型分析',
            inputs: {
              prompt: '分析告警根因',
              model_params: { temperature: '0.7', max_tokens: '512' },
            },
            outputs: { raw: '${llm_completion}' },
            next: { end: {} },
          },
          end: { type: 'END' },
        },
      },
    };

    // Schema blackbox: the composite must compile.
    expect(validateRecipe(composite)).toBe(true);

    const service = createService({
      recipe: composite,
      modelInvocation: captureModel(requests, { content: '光缆中断' }),
      capabilityInvocation: capabilityPort(restfulInvoke),
      nodeCatalog: {
        handlers: {
          TOOL: branchHandler('branchResult', 'branchA-ok'),
        },
      },
    });

    const startedAt = Date.now();
    const result = await service.execute({ ...baseRequest(), recipeVersion: 'v1.1.0' }, new AbortController().signal);
    const elapsed = Date.now() - startedAt;

    expect(result.status).toBe('COMPLETED');
    expect(elapsed).toBeGreaterThanOrEqual(1000);
    expect(result.outputVariables).toMatchObject({ delay_ms: 1000 });
    expect(restfulInvoke).toHaveBeenCalledTimes(1);
    expect(requests).toHaveLength(1);
    expect(requests[0]).not.toHaveProperty('temperature');
    expect(requests[0]).not.toHaveProperty('maxOutputTokens');
  });
});
