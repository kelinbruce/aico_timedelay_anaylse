import { brand, type AgentErrorCategory, type SafeError, workflowNodeTypes } from '@nextagent/agent-common';
import type { AgentAssembly } from '@nextagent/agent-contracts/agent-assembly';
import {
  ControlPolicySchema,
  FlowGraphSchema,
  InputDefSchema,
  RecipeDefinitionSchema,
  RetryPolicySchema,
  RuntimeConfigSchema,
  WorkflowExecutionEventSchema,
  WorkflowExecutionResultSchema,
  type WorkflowExecutionObserver,
  type WorkflowExecutionRequest,
  type WorkflowExecutionResult,
  type WorkflowExecutionService,
} from '@nextagent/agent-contracts/core';
import { Ajv } from 'ajv/dist/ajv.js';
import { describe, expect, it } from 'vitest';

describe('workflow engine contracts', () => {
  const ajv = new Ajv({ allErrors: true });
  const validateRecipe = ajv.compile(RecipeDefinitionSchema);
  const validateFlowGraph = ajv.compile(FlowGraphSchema);
  const validateEvent = ajv.compile(WorkflowExecutionEventSchema);
  const validateResult = ajv.compile(WorkflowExecutionResultSchema);

  it('validates the minimal recipe definition and single graph shape', () => {
    const recipe = {
      recipeName: 'ran-alarm-diagnosis',
      version: 'v1',
      displayName: 'RAN Alarm Diagnosis',
      description: 'Diagnose telecom alarm storms.',
      flowGraph: {
        nodes: {
          start: {
            type: 'START',
            next: {
              diagnose: {},
            },
          },
          diagnose: {
            type: 'LLM',
            description: 'Analyze KPI and alarm context.',
            inputs: { source: 'context' },
            outputs: { summary: true },
            outputParser: { mode: 'json' },
            timeout: 30,
            retryPolicy: { maxAttempts: 2 },
            onError: { action: 'fail' },
            next: {
              done: {
                condition: 'summary_ready',
              },
            },
          },
          done: {
            type: 'END',
            next: {},
          },
        },
      },
      priority: 10,
      inputSchema: { type: 'object' },
      outputSchema: { type: 'object' },
    };

    expect(validateRecipe(recipe)).toBe(true);
    expect(validateFlowGraph(recipe.flowGraph)).toBe(true);
    expect(workflowNodeTypes).toContain(recipe.flowGraph.nodes.start.type);
  });

  it('accepts array batch input and rejects object batch input', () => {
    const recipe = {
      recipeName: 'batch-contract',
      version: 'v1',
      displayName: 'Batch contract',
      flowGraph: {
        nodes: {
          start: { type: 'START', next: { api: {} } },
          api: {
            type: 'RESTFUL',
            inputs: { api_name: 'alarm_query' },
            batchConfig: {
              batchInputDataItem: [{ ne_id: 'NE-1' }, { ne_id: 'NE-2' }],
            },
            next: { end: {} },
          },
          end: { type: 'END', next: {} },
        },
      },
    };

    expect(validateRecipe(recipe)).toBe(true);
    expect(
      validateRecipe({
        ...recipe,
        flowGraph: {
          nodes: {
            ...recipe.flowGraph.nodes,
            api: {
              ...recipe.flowGraph.nodes.api,
              batchConfig: { batchInputDataItem: { ne_id: 'NE-1' } },
            },
          },
        },
      }),
    ).toBe(false);
  });

  it('rejects parallel graph structures outside the frozen workflow DSL', () => {
    const invalidRecipe = {
      recipeName: 'ran-alarm-diagnosis',
      version: 'v1',
      displayName: 'RAN Alarm Diagnosis',
      flowGraph: {
        nodes: {
          start: {
            type: 'START',
            next: {},
          },
        },
        edges: [],
      },
    };

    expect(validateRecipe(invalidRecipe)).toBe(false);
    expect(validateRecipe.errors?.some((error) => error.params.additionalProperty === 'edges')).toBe(true);
  });

  it('keeps workflow execution service asynchronous and cancellation-aware', async () => {
    const request: WorkflowExecutionRequest = {
      recipeName: 'ran-alarm-diagnosis',
      recipeVersion: 'v1',
      inputVariables: { cellId: '460-00-12345' },
      identityContext: {
        tenantId: brand<string, 'TenantId'>('tenant-workflow'),
        subjectId: brand<string, 'SubjectId'>('subject-workflow'),
        displayName: 'Workflow Operator',
      },
      agentId: brand<string, 'AgentId'>('workflow-agent'),
      agentVersion: brand<string, 'AgentVersion'>('v1'),
      sessionId: brand<string, 'SessionId'>('session-workflow'),
      requestId: brand<string, 'MessageId'>('request-workflow'),
      runId: brand<string, 'RequestRunId'>('run-workflow'),
      requestContextId: brand<string, 'RequestContextId'>('context-workflow'),
    };
    const result: WorkflowExecutionResult = {
      executionId: 'execution-workflow',
      status: 'COMPLETED',
      outputVariables: { diagnosis: 'RRC failure surge' },
      nodeResults: [
        {
          nodeId: 'diagnose',
          nodeType: 'LLM',
          status: 'NODE_COMPLETED',
          retryCount: 0,
          startedAt: new Date('2026-06-23T00:00:00.000Z'),
          completedAt: new Date('2026-06-23T00:00:01.000Z'),
          output: { diagnosis: 'RRC failure surge' },
        },
      ],
      startedAt: new Date('2026-06-23T00:00:00.000Z'),
      completedAt: new Date('2026-06-23T00:00:01.000Z'),
    };
    let capturedSignal: AbortSignal | undefined;
    const service: WorkflowExecutionService = {
      async execute(nextRequest, signal, observer): Promise<WorkflowExecutionResult> {
        capturedSignal = signal;
        expect(nextRequest).toBe(request);
        observer?.emitEvent({
          executionId: 'execution-workflow',
          nodeId: 'diagnose',
          nodeType: 'LLM',
          eventType: 'NODE_OUTPUT_DELTA',
          visibleDelta: { channel: 'CONTENT', content: 'partial diagnosis' },
          retryCount: 0,
          startedAt: new Date('2026-06-23T00:00:00.000Z'),
        });
        return result;
      },
    };
    const controller = new AbortController();
    const observedEvents: unknown[] = [];
    const observer: WorkflowExecutionObserver = {
      emitEvent(event) {
        observedEvents.push(event);
      },
    };

    await expect(service.execute(request, controller.signal, observer)).resolves.toEqual(result);
    expect(capturedSignal).toBe(controller.signal);
    expect(observedEvents).toContainEqual(
      expect.objectContaining({
        eventType: 'NODE_OUTPUT_DELTA',
        visibleDelta: {
          channel: 'CONTENT',
          content: 'partial diagnosis',
        },
      }),
    );
  });

  it('rejects unsafe workflow execution event fields outside the public contract', () => {
    const safeError: SafeError = {
      code: 'WORKFLOW_NODE_FAILED',
      message: 'Node execution failed safely.',
      category: 'INTERNAL' satisfies AgentErrorCategory,
      retryable: false,
    };
    const event = {
      executionId: 'execution-workflow',
      nodeId: 'diagnose',
      nodeType: 'LLM',
      eventType: 'NODE_FAILED',
      diagnostic: {
        reasonCode: 'WORKFLOW_EXCLUSIVE_GATEWAY_FALLBACK_SELECTED',
        selectedBranchId: 'fallback',
        conditionIndex: 0,
      },
      safeError,
      retryCount: 1,
      startedAt: '2026-06-23T00:00:00.000Z',
      completedAt: '2026-06-23T00:00:01.000Z',
    };
    const invalidEvent = {
      ...event,
      prompt: 'raw prompt',
      rawModelOutput: 'raw model output',
      path: 'C:\\secret.txt',
    };

    expect(validateEvent(event)).toBe(true);
    expect(validateEvent(invalidEvent)).toBe(false);
    expect(validateEvent.errors?.map((error) => error.params.additionalProperty)).toEqual(
      expect.arrayContaining(['prompt', 'rawModelOutput', 'path']),
    );
  });

  it('accepts bounded optional local execution correlation fields', () => {
    const event = {
      executionId: 'execution-workflow',
      nodeExecutionId: 'node-execution-1',
      predecessorNodeExecutionIds: ['node-execution-0'],
      nodeId: 'diagnose',
      nodeType: 'LLM',
      eventType: 'NODE_STARTED',
      retryCount: 0,
      startedAt: '2026-06-23T00:00:00.000Z',
    };

    expect(validateEvent(event)).toBe(true);
    expect(
      validateEvent({
        ...event,
        nodeExecutionId: 'a'.repeat(129),
      }),
    ).toBe(false);
    expect(
      validateEvent({
        ...event,
        predecessorNodeExecutionIds: Array.from({ length: 129 }, (_, index) => `node-${index}`),
      }),
    ).toBe(false);
  });

  it('keeps recipe bindings optional on AgentAssembly', () => {
    const assemblyWithoutRecipes: AgentAssembly = {
      agentId: brand<string, 'AgentId'>('default-agent'),
      agentType: brand<string, 'AgentType'>('telecom-ops'),
      agentVersion: brand<string, 'AgentVersion'>('v1'),
      agentAssemblyRef: 'default-agent:v1',
      displayName: 'Default Agent',
      description: 'Telecom operations agent.',
      workspacePolicy: {
        schemaVersion: 'nextagent.agent-workspace-policy.v1',
        isolationMode: 'subject',
        roots: [
          { kind: 'workspace', logicalPath: 'workspace', access: 'readWrite' },
          { kind: 'systemResources', logicalPath: '.nextagent', access: 'read' },
          { kind: 'temp', logicalPath: 'temp', access: 'readWrite' },
        ],
      },
      modelIds: ['openai-main'],
      capabilityBindings: [],
      userInvocable: true,
      agentInvocation: 'BOUND',
      runtimeSettings: {},
    };
    const assemblyWithRecipes: AgentAssembly = {
      ...assemblyWithoutRecipes,
      recipeIds: ['ran-alarm-diagnosis', 'ran-capacity-triage'],
    };

    expect(Object.hasOwn(assemblyWithoutRecipes, 'recipeIds')).toBe(false);
    expect(assemblyWithRecipes.recipeIds).toEqual(['ran-alarm-diagnosis', 'ran-capacity-triage']);
  });

  it('accepts bounded workflow diagnostics while rejecting free-form diagnostic payload', () => {
    const safeDiagnosticEvent = {
      executionId: 'execution-workflow',
      nodeId: 'route',
      nodeType: 'CONDITION',
      eventType: 'NODE_COMPLETED',
      diagnostic: {
        reasonCode: 'WORKFLOW_EXCLUSIVE_GATEWAY_FALLBACK_SELECTED',
        selectedBranchId: 'fallback',
        conditionIndex: 0,
      },
      retryCount: 0,
      startedAt: '2026-06-23T00:00:00.000Z',
      completedAt: '2026-06-23T00:00:01.000Z',
    };
    const unsafeDiagnosticEvent = {
      ...safeDiagnosticEvent,
      diagnostic: {
        ...safeDiagnosticEvent.diagnostic,
        prompt: 'raw prompt',
      },
    };

    expect(validateEvent(safeDiagnosticEvent)).toBe(true);
    expect(validateEvent(unsafeDiagnosticEvent)).toBe(false);
  });

  it('accepts safe visible deltas while rejecting unsafe fields on workflow output events', () => {
    const safeDeltaEvent = {
      executionId: 'execution-workflow',
      nodeId: 'diagnose',
      nodeType: 'LLM',
      eventType: 'NODE_OUTPUT_DELTA',
      visibleDelta: {
        channel: 'CONTENT',
        content: 'partial diagnosis',
      },
      retryCount: 0,
      startedAt: '2026-06-23T00:00:00.000Z',
    };
    const unsafeDeltaEvent = {
      ...safeDeltaEvent,
      visibleDelta: {
        ...safeDeltaEvent.visibleDelta,
        prompt: 'raw prompt',
      },
    };

    expect(validateEvent(safeDeltaEvent)).toBe(true);
    expect(validateEvent(unsafeDeltaEvent)).toBe(false);
  });

  it('accepts visible delta content up to 150000 characters and rejects excess', () => {
    const baseEvent = {
      executionId: 'execution-workflow',
      nodeId: 'diagnose',
      nodeType: 'LLM',
      eventType: 'NODE_OUTPUT_DELTA' as const,
      retryCount: 0,
      startedAt: '2026-06-23T00:00:00.000Z',
    };
    const atLimit = {
      ...baseEvent,
      visibleDelta: { channel: 'CONTENT', content: 'a'.repeat(150_000) },
    };
    const overLimit = {
      ...baseEvent,
      visibleDelta: { channel: 'CONTENT', content: 'a'.repeat(150_001) },
    };

    expect(validateEvent(atLimit)).toBe(true);
    expect(validateEvent(overLimit)).toBe(false);
  });

  it('keeps interaction node DSL fields outside frozen core schemas while preserving recipe_name usage', () => {
    const recipe = {
      recipeName: 'sub-recipe-parent',
      version: 'v1',
      displayName: 'Sub Recipe Parent',
      flowGraph: {
        nodes: {
          start: {
            type: 'START',
            next: {
              nested: {},
            },
          },
          nested: {
            type: 'SUBFLOW',
            inputs: {
              recipe_name: 'sub-recipe-child',
              inputMapping: {
                ticketId: '${ticketId}',
              },
              outputMapping: {
                childSummary: '${outputs.summary}',
              },
            },
            next: {
              done: {},
            },
          },
          done: {
            type: 'END',
            next: {},
          },
        },
      },
    };

    expect(validateRecipe(recipe)).toBe(true);
    expect(JSON.stringify(recipe)).toContain('"recipe_name"');
    expect(JSON.stringify(recipe)).not.toContain('"recipeName":"sub-recipe-child"');
  });

  it('accepts waiting workflow results through runtime-owned pending input summaries only', () => {
    const waitingResult = {
      executionId: 'execution-waiting',
      status: 'WAITING',
      outputVariables: {},
      nodeResults: [],
      startedAt: '2026-06-23T00:00:00.000Z',
      completedAt: '2026-06-23T00:00:01.000Z',
      pendingInput: {
        id: 'pending-workflow',
        sessionId: 'session-workflow',
        kind: 'QUESTION',
        questions: [],
        timeoutAt: 1_719_187_200_000,
      },
    };
    const unsafeWaitingResult = {
      ...waitingResult,
      pendingInput: {
        ...waitingResult.pendingInput,
        producerRef: {
          owner: 'workflow',
        },
        policyDecision: 'approve',
      },
    };

    expect(validateResult(waitingResult)).toBe(true);
    expect(validateResult(unsafeWaitingResult)).toBe(false);
    expect(validateResult.errors?.map((error) => error.params.additionalProperty)).toEqual(expect.arrayContaining(['producerRef', 'policyDecision']));
  });

  it('accepts knowledge node DSL shapes while preserving recipe_name and opaque evidence fields outside core contracts', () => {
    const recipe = {
      recipeName: 'knowledge-family',
      version: 'v1',
      displayName: 'Knowledge Family',
      flowGraph: {
        nodes: {
          start: {
            type: 'START',
            next: {
              search: {},
            },
          },
          search: {
            type: 'KNOWLEDGE_SEARCH',
            outputs: {
              knowledge_search_result: '${knowledge_search_result}',
            },
            inputs: {
              rag_index: [{ index_name: 'ran-kb' }],
              query: '${input_question}',
              rank_topN: '2',
            },
            next: {
              answer: {},
            },
          },
          answer: {
            type: 'KNOWLEDGE_QA',
            inputs: {
              rag_index: [{ index_name: 'ran-kb' }],
              query: '${input_question}',
            },
            next: {
              chooseRecipe: {},
            },
          },
          chooseRecipe: {
            type: 'RECIPE_CHOICE',
            inputs: {
              candidateRecipes: [{ recipe_name: 'child-recipe' }],
            },
            outputs: {
              recipe_name: '${recipe_name}',
            },
            next: {
              end: {},
            },
          },
          end: {
            type: 'END',
            next: {},
          },
        },
      },
    };

    expect(validateRecipe(recipe)).toBe(true);
    expect(JSON.stringify(recipe)).toContain('"recipe_name"');
    expect(JSON.stringify(recipe)).not.toContain('"recipeId"');
    expect(JSON.stringify(recipe)).not.toContain('"sourceDocuments"');
  });
  it('validates recipe with v2 runtime config and controlPolicy', () => {
    const recipe = {
      recipeName: 'alarm-diagnosis-v2',
      version: '2.0.0',
      displayName: 'Alarm Diagnosis V2',
      flowGraph: {
        nodes: {
          start: { type: 'START', next: { analyze: {} } },
          analyze: { type: 'LLM_ROUTER', next: { end: {} } },
          end: { type: 'END', next: {} },
        },
      },
      runtime: {
        timeout: 3600,
        incremental: true,
        persistence: { checkpoint: true },
        defaultRetry: { maxAttempts: 2, backoff: 'fixed', delay: 3 },
        controlPolicy: {
          cancel: { rollbackNode: { analyze: { condition: '' } } },
          cancelTimeout: 30,
        },
      },
    };

    expect(validateRecipe(recipe)).toBe(true);
  });

  it('validates recipe with v2 inputs contract and metadata', () => {
    const recipe = {
      recipeName: 'alarm-diagnosis-v2-inputs',
      version: '2.0.0',
      displayName: 'Alarm Diagnosis V2 Inputs',
      flowGraph: {
        nodes: {
          start: { type: 'START', next: { end: {} } },
          end: { type: 'END', next: {} },
        },
      },
      inputs: {
        input_question: { type: 'string', required: true, description: 'User question' },
        alarm_ids: { type: 'array', required: false, default: [] },
      },
      metadata: { recipe_ne_version: '1.0', recipe_ne_type: 'alarm' },
      presentation: { recommends: { enabled: true, topN: 5 } },
    };

    expect(validateRecipe(recipe)).toBe(true);
  });

  it('validates node with v2 dependsOn, retry, timeout and presentation', () => {
    const recipe = {
      recipeName: 'alarm-diagnosis-v2-nodes',
      version: '2.0.0',
      displayName: 'Alarm Diagnosis V2 Nodes',
      flowGraph: {
        nodes: {
          start: { type: 'START', next: { fetch_a: {}, fetch_b: {} } },
          fetch_a: { type: 'RESTFUL', next: { merge: {} } },
          fetch_b: { type: 'RESTFUL', next: { merge: {} } },
          merge: {
            type: 'LLM_ROUTER',
            dependsOn: ['fetch_a', 'fetch_b'],
            retry: { maxAttempts: 3, backoff: 'exponential', delay: 2 },
            timeout: 30,
            presentation: { outputParser: { type: 'TEXT' }, tag: 'ANSWER' },
            next: { end: {} },
          },
          end: { type: 'END', next: {} },
        },
      },
    };

    expect(validateRecipe(recipe)).toBe(true);
  });

  it('validates node with exception alongside next', () => {
    const recipe = {
      recipeName: 'alarm-diagnosis-v2-exception',
      version: '2.0.0',
      displayName: 'Alarm Diagnosis V2 Exception',
      flowGraph: {
        nodes: {
          start: { type: 'START', next: { risky: {} } },
          risky: {
            type: 'RESTFUL',
            exception: { fallback: { condition: 'true' } },
            next: { end: {} },
          },
          fallback: { type: 'DISPLAY', next: { end: {} } },
          end: { type: 'END', next: {} },
        },
      },
    };

    expect(validateRecipe(recipe)).toBe(true);
  });

  it('validates standalone RetryPolicy, ControlPolicy, InputDef and RuntimeConfig schemas', () => {
    const validateRetry = ajv.compile(RetryPolicySchema);
    const validateControlPolicy = ajv.compile(ControlPolicySchema);
    const validateInputDef = ajv.compile(InputDefSchema);
    const validateRuntime = ajv.compile(RuntimeConfigSchema);

    expect(validateRetry({ maxAttempts: 3, backoff: 'exponential', delay: 2 })).toBe(true);
    expect(validateRetry({ maxAttempts: 0 })).toBe(true);
    expect(validateRetry({ backoff: 'invalid' })).toBe(false);

    expect(
      validateControlPolicy({
        cancel: { rollbackNode: { 'node-a': { condition: '' } } },
        cancelTimeout: 10,
      }),
    ).toBe(true);
    expect(validateControlPolicy({ cancel: { rollbackNode: { 'node-a': {} } } })).toBe(true);
    expect(validateControlPolicy({})).toBe(true);
    expect(validateControlPolicy({ cancel: { strategy: 'STOP' } })).toBe(false);

    expect(validateInputDef({ type: 'string', required: true })).toBe(true);
    expect(validateInputDef({ type: 'number', default: 0 })).toBe(true);
    expect(validateInputDef({ type: 'invalid' })).toBe(false);

    expect(validateRuntime({ timeout: 60000, incremental: true, persistence: { checkpoint: true } })).toBe(true);
    expect(validateRuntime({ defaultRetry: { maxAttempts: 2 } })).toBe(true);
    expect(validateRuntime({ profile: 'taskflow' })).toBe(false);
  });

  it('keeps deprecated v1 fields accepted in recipe for backward compatibility', () => {
    const recipe = {
      recipeName: 'alarm-diagnosis-v1-compat',
      version: '1.0.0',
      displayName: 'Alarm Diagnosis V1 Compat',
      flowGraph: {
        nodes: {
          start: { type: 'START', next: { api: {} } },
          api: {
            type: 'RESTFUL',
            outputParser: { mode: 'json' },
            timeout: 30,
            retryPolicy: { maxAttempts: 2 },
            onError: { action: 'fail' },
            next: { end: {} },
          },
          end: { type: 'END', next: {} },
        },
      },
      priority: 10,
      inputSchema: { type: 'object' },
      outputSchema: { type: 'object' },
    };

    expect(validateRecipe(recipe)).toBe(true);
  });
});

describe('recipe classification fields', () => {
  const ajv2 = new Ajv({ allErrors: true });
  const validate = ajv2.compile(RecipeDefinitionSchema);

  const baseRecipe = {
    recipeName: 'ran-alarm-diagnosis',
    version: 'v1',
    displayName: 'RAN Alarm Diagnosis',
    flowGraph: { nodes: { start: { type: 'START', next: {} } } },
  };

  it('accepts recipe without domain/scene/lang fields (all optional)', () => {
    const valid = validate(baseRecipe);
    expect(valid).toBe(true);
  });

  it('accepts recipe with domain, scene and lang populated', () => {
    const valid = validate({ ...baseRecipe, domain: 'fault-diagnosis', scene: 'alarm-location', lang: 'zh' });
    expect(valid).toBe(true);
  });

  it('accepts free-text domain and scene with Chinese and special characters', () => {
    const valid = validate({ ...baseRecipe, domain: '鏁呴殰璇婃柇!', scene: '鍛婅瀹氫綅 v2' });
    expect(valid).toBe(true);
  });

  it('rejects domain exceeding 512 characters', () => {
    const valid = validate({ ...baseRecipe, domain: 'a'.repeat(513) });
    expect(valid).toBe(false);
  });

  it('accepts domain at exactly 512 characters', () => {
    const valid = validate({ ...baseRecipe, domain: 'a'.repeat(512) });
    expect(valid).toBe(true);
  });

  it('rejects invalid lang value not in zh|en enum', () => {
    const valid = validate({ ...baseRecipe, lang: 'fr' });
    expect(valid).toBe(false);
  });

  it('does not allow agentName field due to additionalProperties false', () => {
    const valid = validate({ ...baseRecipe, agentName: 'default-agent' });
    expect(valid).toBe(false);
  });

  it('accepts free-form recipeName with spaces and unicode', () => {
    const valid = validate({ ...baseRecipe, recipeName: '鍛婅璇婃柇 v2' });
    expect(valid).toBe(true);
  });

  it('rejects recipeName exceeding 255 characters', () => {
    const valid = validate({ ...baseRecipe, recipeName: 'a'.repeat(256) });
    expect(valid).toBe(false);
  });

  it('accepts recipeName at exactly 255 characters', () => {
    const valid = validate({ ...baseRecipe, recipeName: 'a'.repeat(255) });
    expect(valid).toBe(true);
  });
});
