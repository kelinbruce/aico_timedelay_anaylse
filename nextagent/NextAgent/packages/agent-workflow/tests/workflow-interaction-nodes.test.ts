import { brand, type JsonObject } from '@nextagent/agent-common';
import type { RecipeDefinition, WorkflowExecutionEvent, WorkflowExecutionRequest, WorkflowExecutionResult } from '@nextagent/agent-contracts/core';
import { describe, expect, it, vi } from 'vitest';
import { createWorkflowNodeCatalog, type WorkflowNodeCatalog } from '../src/index.js';
import { createService, recipe, node, baseRequest } from './test-helpers.js';

describe('workflow interaction nodes', () => {
  it('projects safe display-content nodes and continues immediately', async () => {
    const observedEvents: WorkflowExecutionEvent[] = [];
    const service = createService({
      recipe: recipe({
        start: node('START', { show: {} }),
        show: {
          type: 'DISPLAY',
          outputs: { content: 'maintenance window starts at 02:00' },
          next: { end: {} },
        },
        end: node('END'),
      }),
      emitEvent: async (event) => {
        observedEvents.push(event);
      },
    });

    const result = await service.execute(baseRequest(), new AbortController().signal);

    expect(result.status).toBe('COMPLETED');
    expect(observedEvents).toContainEqual(
      expect.objectContaining({
        nodeId: 'show',
        eventType: 'NODE_OUTPUT_DELTA',
        visibleDelta: {
          channel: 'CONTENT',
          content: 'maintenance window starts at 02:00',
          level: 'ANSWER',
        },
      }),
    );
    expect(result.outputVariables).toMatchObject({
      display_content: 'maintenance window starts at 02:00',
    });
  });

  it('waits on user-check nodes and resumes with the selected answer', async () => {
    const activations: Array<WorkflowExecutionRequest['resumeState']> = [];
    const service = createService({
      recipe: recipe({
        start: node('START', { askUser: {} }),
        askUser: {
          type: 'USER_CHECK',
          inputs: {
            question: 'Select an option',
            action_type: 'choice',
            options: [{ label: 'Approve', value: 'approve' }],
          },
          next: { end: {} },
        },
        end: node('END'),
      }),
    });

    const first = await service.execute(baseRequest(), new AbortController().signal, undefined, {
      requestPendingInput: vi.fn(async (request) => {
        activations.push(request.resumeState);
        return {
          id: 'pending-user-check',
          sessionId: baseRequest().sessionId,
          kind: request.kind,
          questions: request.questions,
        };
      }),
    });

    expect(first.status).toBe('WAITING');
    expect(first.pendingInput).toMatchObject({
      id: 'pending-user-check',
      kind: 'QUESTION',
    });
    expect(first.nodeResults.find((item) => item.nodeId === 'askUser')?.status).toBe('NODE_WAITING');

    const resumed = await service.execute(
      {
        ...baseRequest(),
        resumeState: {
          ...activations[0]!,
          pendingInputId: 'pending-user-check',
          answers: [['approve']],
          pendingAnswerSummary: 'approve',
        },
      },
      new AbortController().signal,
    );

    expect(resumed.status).toBe('COMPLETED');
    expect(resumed.outputVariables).toMatchObject({
      user_check_result: 'approve',
      selectedOption: 'approve',
      answer_values: ['approve'],
    });
    expect(resumed.nodeResults.find((item) => item.nodeId === 'askUser')?.status).toBe('NODE_COMPLETED');
  });

  it.each([
    ['CONFIRMATION', 'approve', 'approved'],
    ['CONFIRMATION', 'reject', 'rejected'],
    ['AUTHORIZATION', 'approve', 'approved'],
    ['AUTHORIZATION', 'deny', 'rejected'],
  ] as const)('waits before resolving %s branches and resumes through the %s path', async (kind, answer, expectedNodeId) => {
    const activations: Array<WorkflowExecutionRequest['resumeState']> = [];
    const rejectedValue = kind === 'CONFIRMATION' ? 'reject' : 'deny';
    const service = createService({
      recipe: recipe({
        start: node('START', { check: {} }),
        check: {
          type: 'USER_CHECK',
          inputs: {
            kind,
            question: 'Approve this operation?',
          },
          outputs: {
            result: '${user_check_result}',
          },
          next: {
            approved: { condition: '${result == "approve"}' },
            rejected: { condition: `\${result == "${rejectedValue}"}` },
          },
        },
        approved: node('END'),
        rejected: node('END'),
      }),
    });

    const first = await service.execute(baseRequest(), new AbortController().signal, undefined, {
      requestPendingInput: vi.fn(async (request) => {
        activations.push(request.resumeState);
        return {
          id: `pending-${kind.toLowerCase()}`,
          sessionId: baseRequest().sessionId,
          kind: request.kind,
          questions: request.questions,
        };
      }),
    });

    expect(first.status).toBe('WAITING');
    expect(first.pendingInput).toMatchObject({ kind });
    expect(first.nodeResults.find((item) => item.nodeId === 'check')?.status).toBe('NODE_WAITING');

    const resumed = await service.execute(
      {
        ...baseRequest(),
        resumeState: {
          ...activations[0]!,
          pendingInputId: `pending-${kind.toLowerCase()}`,
          answers: [[answer]],
          pendingAnswerSummary: answer,
        },
      },
      new AbortController().signal,
    );

    expect(resumed.status).toBe('COMPLETED');
    expect(resumed.outputVariables).toMatchObject({ result: answer });
    expect(resumed.outputVariables).not.toHaveProperty('user_check_result');
    expect(resumed.nodeResults.some((item) => item.nodeId === expectedNodeId)).toBe(true);
  });

  it('waits on interrupt nodes and resumes only after an external answer arrives', async () => {
    const activations: Array<WorkflowExecutionRequest['resumeState']> = [];
    const service = createService({
      recipe: recipe({
        start: node('START', { pause: {} }),
        pause: {
          type: 'INTERRUPT',
          inputs: { prompt: 'Resume from external gateway' },
          next: { end: {} },
        },
        end: node('END'),
      }),
    });

    const first = await service.execute(baseRequest(), new AbortController().signal, undefined, {
      requestPendingInput: vi.fn(async (request) => {
        activations.push(request.resumeState);
        return {
          id: 'pending-interrupt',
          sessionId: baseRequest().sessionId,
          kind: request.kind,
          questions: request.questions,
        };
      }),
    });

    expect(first.status).toBe('WAITING');
    expect(first.nodeResults.find((item) => item.nodeId === 'pause')?.status).toBe('NODE_WAITING');

    const resumed = await service.execute(
      {
        ...baseRequest(),
        resumeState: {
          ...activations[0]!,
          pendingInputId: 'pending-interrupt',
          answers: [['resume']],
          pendingAnswerSummary: 'resume',
        },
      },
      new AbortController().signal,
    );

    expect(resumed.status).toBe('COMPLETED');
    expect(resumed.outputVariables).toMatchObject({
      resumed: true,
    });
    expect(resumed.nodeResults.find((item) => item.nodeId === 'pause')?.status).toBe('NODE_COMPLETED');
  });

  it('waits on user-check input mode and captures user_check_input', async () => {
    const activations: Array<WorkflowExecutionRequest['resumeState']> = [];
    const service = createService({
      recipe: recipe({
        start: node('START', { askUser: {} }),
        askUser: {
          type: 'USER_CHECK',
          inputs: {
            question: 'Enter a value',
            action_type: 'input',
          },
          next: { end: {} },
        },
        end: node('END'),
      }),
    });

    const first = await service.execute(baseRequest(), new AbortController().signal, undefined, {
      requestPendingInput: vi.fn(async (request) => {
        activations.push(request.resumeState);
        return {
          id: 'pending-input',
          sessionId: baseRequest().sessionId,
          kind: request.kind,
          questions: request.questions,
        };
      }),
    });

    expect(first.status).toBe('WAITING');
    expect(first.pendingInput?.kind).toBe('QUESTION');

    const resumed = await service.execute(
      {
        ...baseRequest(),
        resumeState: {
          ...activations[0]!,
          pendingInputId: 'pending-input',
          answers: [['manual-entry']],
          pendingAnswerSummary: 'manual-entry',
        },
      },
      new AbortController().signal,
    );

    expect(resumed.status).toBe('COMPLETED');
    expect(resumed.outputVariables).toMatchObject({
      user_check_input: 'manual-entry',
      answer_values: ['manual-entry'],
    });
    expect(resumed.outputVariables).not.toHaveProperty('user_check_result');
  });

  it('waits on user-check confirm mode and captures the confirmed value', async () => {
    const activations: Array<WorkflowExecutionRequest['resumeState']> = [];
    const service = createService({
      recipe: recipe({
        start: node('START', { askUser: {} }),
        askUser: {
          type: 'USER_CHECK',
          inputs: {
            question: 'Proceed with the workflow?',
            action_type: 'confirm',
          },
          next: { end: {} },
        },
        end: node('END'),
      }),
    });

    const first = await service.execute(baseRequest(), new AbortController().signal, undefined, {
      requestPendingInput: vi.fn(async (request) => {
        activations.push(request.resumeState);
        return {
          id: 'pending-confirm',
          sessionId: baseRequest().sessionId,
          kind: request.kind,
          questions: request.questions,
        };
      }),
    });

    expect(first.status).toBe('WAITING');

    const resumed = await service.execute(
      {
        ...baseRequest(),
        resumeState: {
          ...activations[0]!,
          pendingInputId: 'pending-confirm',
          answers: [['true']],
          pendingAnswerSummary: 'true',
        },
      },
      new AbortController().signal,
    );

    expect(resumed.status).toBe('COMPLETED');
    expect(resumed.outputVariables).toMatchObject({
      user_check_result: 'true',
      selectedOption: 'true',
      answer_values: ['true'],
    });
  });

  it('timeout is failure not fallback when user does not respond in time', async () => {
    const activations: Array<WorkflowExecutionRequest['resumeState']> = [];
    const service = createService({
      recipe: recipe({
        start: node('START', { askUser: {} }),
        askUser: {
          type: 'USER_CHECK',
          timeout: 1,
          inputs: {
            question: 'Select an option',
            action_type: 'choice',
            options: [{ label: 'Approve', value: 'approve' }],
          },
          next: { end: {} },
        },
        end: node('END'),
      }),
    });

    const first = await service.execute(baseRequest(), new AbortController().signal, undefined, {
      requestPendingInput: vi.fn(async (request) => {
        activations.push(request.resumeState);
        return {
          id: 'pending-timeout',
          sessionId: baseRequest().sessionId,
          kind: request.kind,
          questions: request.questions,
        };
      }),
    });

    expect(first.status).toBe('WAITING');

    const resumed = await service.execute(
      {
        ...baseRequest(),
        resumeState: {
          ...activations[0]!,
          pendingInputId: 'pending-timeout',
          answers: [[]],
        },
      },
      new AbortController().signal,
    );

    expect(resumed.status).toBe('FAILED');
    expect(resumed.outputVariables).not.toHaveProperty('timed_out');
    expect(resumed.outputVariables).not.toHaveProperty('user_check_result');
  });

  it('accepts string-quoted multiple in user-check inputs', async () => {
    const service = createService({
      recipe: recipe({
        start: node('START', { askUser: {} }),
        askUser: {
          type: 'USER_CHECK',
          timeout: 1,
          inputs: {
            question: 'Select an option',
            action_type: 'choice',
            options: [{ label: 'Approve', value: 'approve' }],
            multiple: 'true',
          },
          next: { end: {} },
        },
        end: node('END'),
      }),
    });

    const first = await service.execute(baseRequest(), new AbortController().signal, undefined, {
      requestPendingInput: vi.fn(async (request) => {
        return {
          id: 'pending-multiple-str',
          sessionId: baseRequest().sessionId,
          kind: request.kind,
          questions: request.questions,
        };
      }),
    });

    expect(first.status).toBe('WAITING');
    expect(first.pendingInput).toMatchObject({
      questions: [{ multiple: true }],
    });
  });

  it('rejects user-check choice mode without options', async () => {
    const service = createService({
      recipe: recipe({
        start: node('START', { askUser: {} }),
        askUser: {
          type: 'USER_CHECK',
          inputs: {
            question: 'Select an option',
            action_type: 'choice',
          },
          next: { end: {} },
        },
        end: node('END'),
      }),
    });

    const result = await service.execute(baseRequest(), new AbortController().signal, undefined, {
      requestPendingInput: vi.fn(async () => ({
        id: 'should-not-reach',
        sessionId: baseRequest().sessionId,
        kind: 'QUESTION' as const,
        questions: [],
      })),
    });

    expect(result.status).toBe('FAILED');
    expect(result.nodeResults.find((item) => item.nodeId === 'askUser')).toMatchObject({
      status: 'NODE_FAILED' as const,
      safeError: {
        code: 'WORKFLOW_NODE_INPUT_INVALID',
        category: 'VALIDATION',
      },
    });
  });

  it('rejects unsafe display-content HTML payloads', async () => {
    const service = createService({
      recipe: recipe({
        start: node('START', { show: {} }),
        show: {
          type: 'DISPLAY',
          outputs: { content: '<script>alert(1)</script>' },
          next: { end: {} },
        },
        end: node('END'),
      }),
    });

    const result = await service.execute(baseRequest(), new AbortController().signal);

    expect(result.status).toBe('FAILED');
    expect(result.nodeResults.find((item) => item.nodeId === 'show')).toMatchObject({
      status: 'NODE_FAILED' as const,
      safeError: {
        code: 'WORKFLOW_DISPLAY_CONTENT_UNSAFE',
        category: 'VALIDATION',
      },
    });
  });

  it('allows plain-text angle-bracket tokens like <Finished> in display content', async () => {
    const service = createService({
      recipe: recipe({
        start: node('START', { show: {} }),
        show: {
          type: 'DISPLAY',
          outputs: { content: '您当前的问题不在系统支持范围内<Finished>' },
          next: { end: {} },
        },
        end: node('END'),
      }),
    });

    const result = await service.execute(baseRequest(), new AbortController().signal);

    expect(result.status).toBe('COMPLETED');
  });

  it('rejects known HTML tags in non-HTML display content', async () => {
    const service = createService({
      recipe: recipe({
        start: node('START', { show: {} }),
        show: {
          type: 'DISPLAY',
          outputs: { content: '<div>malicious</div>' },
          next: { end: {} },
        },
        end: node('END'),
      }),
    });

    const result = await service.execute(baseRequest(), new AbortController().signal);

    expect(result.status).toBe('FAILED');
    expect(result.nodeResults.find((item) => item.nodeId === 'show')).toMatchObject({
      status: 'NODE_FAILED' as const,
      safeError: {
        code: 'WORKFLOW_DISPLAY_CONTENT_UNSAFE',
        category: 'VALIDATION',
      },
    });
  });

  it('waits for delay nodes and exposes the completed delay summary', async () => {
    const service = createService({
      recipe: recipe({
        start: node('START', { wait: {} }),
        wait: {
          type: 'DELAY',
          inputs: { delay_time: '1' },
          next: { end: {} },
        },
        end: node('END'),
      }),
    });

    const startedAt = Date.now();
    const result = await service.execute(baseRequest(), new AbortController().signal);

    expect(Date.now() - startedAt).toBeGreaterThanOrEqual(1000);
    expect(result.status).toBe('COMPLETED');
    expect(result.outputVariables).toMatchObject({
      delayed: true,
      delay_ms: 1000,
    });
  });

  it('evaluates guardrail-check nodes through the lifecycle hook boundary', async () => {
    const invoked = vi.fn(async () => ({
      decision: 'REJECT' as const,
      safeReason: 'TERM_BLOCKED',
    }));
    const service = createService({
      recipe: recipe({
        start: node('START', { verify: {} }),
        verify: {
          type: 'GUARDRAIL',
          inputs: {
            policyId: 'telecom-content-policy',
            content: 'show subscriber secret',
          },
          next: { end: {} },
        },
        end: node('END'),
      }),
      nodeCatalog: createWorkflowNodeCatalog({
        evaluateGuardrail: invoked,
      }),
    });

    const result = await service.execute(baseRequest(), new AbortController().signal);

    expect(result.status).toBe('COMPLETED');
    expect(invoked).toHaveBeenCalledWith(
      expect.objectContaining({
        policyId: 'telecom-content-policy',
        workflowNodeId: 'verify',
        content: 'show subscriber secret',
      }),
      expect.any(AbortSignal),
    );
    expect(result.outputVariables).toMatchObject({
      result: 'block',
      reason: 'TERM_BLOCKED',
    });
  });

  it('executes sub-recipe nodes with explicit input and output mappings only', async () => {
    const childRecipe = recipe({
      start: node('START', { end: {} }),
      end: {
        type: 'END',
        outputs: {
          finalMessage: '${inputText}',
        },
        next: {},
      },
    });
    const executeSubRecipe = vi.fn(async (request: WorkflowExecutionRequest) => ({
      executionId: 'child-execution-1',
      status: 'COMPLETED' as const,
      outputVariables: {
        finalMessage: `${String(request.inputVariables.inputText)}-checked`,
      },
      nodeResults: [],
      startedAt: new Date('2026-06-24T00:00:00.000Z'),
      completedAt: new Date('2026-06-24T00:00:00.000Z'),
    }));
    const service = createService({
      recipe: recipe({
        start: node('START', { callChild: {} }),
        callChild: {
          type: 'SUBFLOW',
          inputs: {
            recipe_name: 'child-flow',
            inputMapping: {
              inputText: '${ticketId}',
            },
            outputMapping: {
              childMessage: '${outputs.finalMessage}',
            },
          },
          next: { end: {} },
        },
        end: node('END'),
      }),
      nodeCatalog: createWorkflowNodeCatalog({
        resolveRecipeDefinition: () => childRecipe,
        executeSubRecipe,
      }),
    });

    const result = await service.execute(
      {
        ...baseRequest(),
        inputVariables: {
          ticketId: 'ran-incident-42',
        },
      },
      new AbortController().signal,
    );

    expect(result.status).toBe('COMPLETED');
    expect(executeSubRecipe).toHaveBeenCalledWith(
      expect.objectContaining({
        recipeName: 'workflow-test',
        recipeVersion: 'v1',
        inputVariables: {
          inputText: 'ran-incident-42',
        },
        executionMetadata: {
          subRecipeDepth: 1,
        },
      }),
      expect.any(AbortSignal),
      undefined,
    );
    expect(result.outputVariables).toMatchObject({
      childMessage: 'ran-incident-42-checked',
      sub_recipe_result: {
        recipe_name: 'workflow-test',
        executionId: 'child-execution-1',
        status: 'COMPLETED',
      },
    });
    expect(result.outputVariables).not.toHaveProperty('finalMessage');
  });

  it('completes sub-recipe when optional outputMapping is omitted', async () => {
    const childRecipe = recipe({
      start: node('START', { end: {} }),
      end: {
        type: 'END',
        outputs: {
          finalMessage: '${inputText}',
        },
        next: {},
      },
    });
    const executeSubRecipe = vi.fn(async (request: WorkflowExecutionRequest) => ({
      executionId: 'child-execution-no-output-mapping',
      status: 'COMPLETED' as const,
      outputVariables: {
        finalMessage: `${String(request.inputVariables.inputText)}-checked`,
      },
      nodeResults: [],
      startedAt: new Date('2026-06-24T00:00:00.000Z'),
      completedAt: new Date('2026-06-24T00:00:00.000Z'),
    }));
    const service = createService({
      recipe: recipe({
        start: node('START', { callChild: {} }),
        callChild: {
          type: 'SUBFLOW',
          inputs: {
            recipe_name: 'child-flow',
            inputMapping: {
              inputText: '${ticketId}',
            },
          },
          next: { end: {} },
        },
        end: node('END'),
      }),
      nodeCatalog: createWorkflowNodeCatalog({
        resolveRecipeDefinition: () => childRecipe,
        executeSubRecipe,
      }),
    });

    const result = await service.execute(
      {
        ...baseRequest(),
        inputVariables: {
          ticketId: 'ran-incident-42',
        },
      },
      new AbortController().signal,
    );

    expect(result.status).toBe('COMPLETED');
    expect(executeSubRecipe).toHaveBeenCalledWith(
      expect.objectContaining({
        inputVariables: {
          inputText: 'ran-incident-42',
        },
        executionMetadata: {
          subRecipeDepth: 1,
        },
      }),
      expect.any(AbortSignal),
      undefined,
    );
    expect(result.outputVariables).toMatchObject({
      sub_recipe_result: {
        recipe_name: 'workflow-test',
        executionId: 'child-execution-no-output-mapping',
        status: 'COMPLETED',
      },
    });
    expect(result.outputVariables).not.toHaveProperty('finalMessage');
    expect(result.outputVariables).not.toHaveProperty('childMessage');
  });

  it('completes sub-recipe when inputMapping is omitted (1.0 compat)', async () => {
    const childRecipe = recipe({
      start: node('START', { end: {} }),
      end: {
        type: 'END',
        outputs: {
          finalMessage: '${inputText}',
        },
        next: {},
      },
    });
    const executeSubRecipe = vi.fn(async () => ({
      executionId: 'child-execution-no-input-mapping',
      status: 'COMPLETED' as const,
      outputVariables: {},
      nodeResults: [],
      startedAt: new Date('2026-06-24T00:00:00.000Z'),
      completedAt: new Date('2026-06-24T00:00:00.000Z'),
    }));
    const service = createService({
      recipe: recipe({
        start: node('START', { callChild: {} }),
        callChild: {
          type: 'SUBFLOW',
          inputs: {
            recipe_name: 'child-flow',
          },
          next: { end: {} },
        },
        end: node('END'),
      }),
      nodeCatalog: createWorkflowNodeCatalog({
        resolveRecipeDefinition: () => childRecipe,
        executeSubRecipe,
      }),
    });

    const result = await service.execute(baseRequest(), new AbortController().signal);

    expect(result.status).toBe('COMPLETED');
    expect(executeSubRecipe).toHaveBeenCalledWith(
      expect.objectContaining({
        inputVariables: {},
      }),
      expect.any(AbortSignal),
      undefined,
    );
  });

  it('completes sub-recipe with minimal 1.0 node (no inputMapping, no outputMapping, no outputs)', async () => {
    const childRecipe = recipe({
      start: node('START', { end: {} }),
      end: node('END'),
    });
    const executeSubRecipe = vi.fn(async () => ({
      executionId: 'child-exec-minimal',
      status: 'COMPLETED' as const,
      outputVariables: {},
      nodeResults: [],
      startedAt: new Date('2026-06-24T00:00:00.000Z'),
      completedAt: new Date('2026-06-24T00:00:00.000Z'),
    }));
    const service = createService({
      recipe: recipe({
        start: node('START', { callChild: {} }),
        callChild: {
          type: 'SUBFLOW',
          inputs: {
            recipe_name: 'child-flow',
          },
          next: { end: {} },
        },
        end: node('END'),
      }),
      nodeCatalog: createWorkflowNodeCatalog({
        resolveRecipeDefinition: () => childRecipe,
        executeSubRecipe,
      }),
    });

    const result = await service.execute(baseRequest(), new AbortController().signal);

    expect(result.status).toBe('COMPLETED');
    expect(executeSubRecipe).toHaveBeenCalledWith(
      expect.objectContaining({
        inputVariables: {},
      }),
      expect.any(AbortSignal),
      undefined,
    );
    expect(result.outputVariables).toHaveProperty('sub_recipe_result');
    expect(result.outputVariables).toHaveProperty('recipe_result');
    expect(result.outputVariables).toHaveProperty('node_record_info');
  });

  it('fails sub-recipe when outputMapping is an explicit non-object value', async () => {
    const childRecipe = recipe({
      start: node('START', { end: {} }),
      end: {
        type: 'END',
        outputs: { finalMessage: '${inputText}' },
        next: {},
      },
    });
    const executeSubRecipe = vi.fn(async () => {
      throw new Error('sub-recipe should not start with invalid outputMapping');
    });
    const service = createService({
      recipe: recipe({
        start: node('START', { callChild: {} }),
        callChild: {
          type: 'SUBFLOW',
          inputs: {
            recipe_name: 'child-flow',
            inputMapping: {},
            outputMapping: null,
          },
          next: { end: {} },
        },
        end: node('END'),
      }),
      nodeCatalog: createWorkflowNodeCatalog({
        resolveRecipeDefinition: () => childRecipe,
        executeSubRecipe,
      }),
    });

    const result = await service.execute(baseRequest(), new AbortController().signal);

    expect(result.status).toBe('FAILED');
    expect(executeSubRecipe).not.toHaveBeenCalled();
    const failedNode = result.nodeResults.find((n) => n.nodeId === 'callChild');
    expect(failedNode).toBeDefined();
    expect(failedNode?.status).toBe('NODE_FAILED');
  });

  it('fails the fourth nested sub-recipe level safely', async () => {
    const executeSubRecipe = vi.fn(async () => {
      throw new Error('nested execution should not start');
    });
    const service = createService({
      recipe: recipe({
        start: node('START', { callChild: {} }),
        callChild: {
          type: 'SUBFLOW',
          inputs: {
            recipe_name: 'child-flow',
            inputMapping: {},
            outputMapping: {},
          },
          next: { end: {} },
        },
        end: node('END'),
      }),
      nodeCatalog: createWorkflowNodeCatalog({
        resolveRecipeDefinition: () =>
          recipe({
            start: node('START', { end: {} }),
            end: node('END'),
          }),
        executeSubRecipe,
      }),
    });

    const result = await service.execute(
      {
        ...baseRequest(),
        executionMetadata: {
          subRecipeDepth: 3,
        },
      },
      new AbortController().signal,
    );

    expect(result.status).toBe('FAILED');
    expect(executeSubRecipe).not.toHaveBeenCalled();
    expect(result.nodeResults.find((item) => item.nodeId === 'callChild')).toMatchObject({
      status: 'NODE_FAILED' as const,
      safeError: {
        code: 'WORKFLOW_SUB_RECIPE_DEPTH_EXCEEDED',
        category: 'VALIDATION',
      },
    });
  });

  it('evaluates guardrail-check using guardrailType and guardrailParams', async () => {
    const invoked = vi.fn(async () => ({
      decision: 'PASS' as const,
      safeReason: 'CONTENT_SAFE',
    }));
    const service = createService({
      recipe: recipe({
        start: node('START', { verify: {} }),
        verify: {
          type: 'GUARDRAIL',
          inputs: {
            guardrailType: 'QUESTION',
            guardrailParams: { maxLength: 500 },
            content: 'How do I configure BGP on NE-1?',
          },
          next: { end: {} },
        },
        end: node('END'),
      }),
      nodeCatalog: createWorkflowNodeCatalog({
        evaluateGuardrail: invoked,
      }),
    });

    const result = await service.execute(baseRequest(), new AbortController().signal);

    expect(result.status).toBe('COMPLETED');
    expect(invoked).toHaveBeenCalledWith(
      expect.objectContaining({
        policyId: 'guardrail:question',
        guardrailType: 'QUESTION',
        guardrailParams: { maxLength: 500 },
      }),
      expect.any(AbortSignal),
    );
  });

  it('reports diagnostic info when dynamic recipe_name resolves to undefined', async () => {
    const service = createService({
      recipe: recipe({
        start: node('START', { callChild: {} }),
        callChild: {
          type: 'SUBFLOW',
          inputs: {
            recipe_name: '${input_question}',
            inputMapping: {},
            outputMapping: {},
          },
          next: { end: {} },
        },
        end: node('END'),
      }),
      nodeCatalog: createWorkflowNodeCatalog({
        resolveRecipeDefinition: () => recipe({ start: node('START', { end: {} }), end: node('END') }),
        executeSubRecipe: vi.fn(),
      }),
    });

    const result = await service.execute(baseRequest(), new AbortController().signal);

    expect(result.status).toBe('FAILED');
    const nodeResult = result.nodeResults.find((item) => item.nodeId === 'callChild');
    expect(nodeResult?.safeError?.safeDetails).toMatchObject({
      field: 'recipe_name',
      recipeNameTemplate: '${input_question}',
      resolvedType: 'undefined',
    });
    expect(Array.isArray(nodeResult?.safeError?.safeDetails?.availableVariableKeys)).toBe(true);
  });

  it('exposes answer node output via recipe_result binding', async () => {
    const childRecipe = recipe({
      start: node('START', { display: {} }),
      display: {
        type: 'DISPLAY',
        outputs: { finalMessage: '${inputText}' },
        next: { end: {} },
      },
      end: node('END'),
    });
    const executeSubRecipe = vi.fn(async (): Promise<WorkflowExecutionResult> => ({
      executionId: 'child-execution-2',
      status: 'COMPLETED' as const,
      outputVariables: { finalMessage: 'child-output-value' },
      nodeResults: [
        {
          nodeId: 'display',
          nodeType: 'DISPLAY' as const,
          status: 'NODE_COMPLETED' as const,
          output: { finalMessage: 'child-output-value' },
          retryCount: 0,
          startedAt: new Date('2026-06-24T00:00:00.000Z'),
          completedAt: new Date('2026-06-24T00:00:00.000Z'),
        },
      ],
      startedAt: new Date('2026-06-24T00:00:00.000Z'),
      completedAt: new Date('2026-06-24T00:00:00.000Z'),
    }));
    const service = createService({
      recipe: recipe({
        start: node('START', { callChild: {} }),
        callChild: {
          type: 'SUBFLOW',
          inputs: {
            recipe_name: 'child-flow',
            inputMapping: {},
            outputMapping: {},
          },
          outputs: { sub_result: '${recipe_result}' },
          next: { end: {} },
        },
        end: node('END'),
      }),
      nodeCatalog: createWorkflowNodeCatalog({
        resolveRecipeDefinition: () => childRecipe,
        executeSubRecipe,
      }),
    });

    const result = await service.execute(baseRequest(), new AbortController().signal);

    expect(result.status).toBe('COMPLETED');
    expect(result.outputVariables).toMatchObject({
      sub_result: { finalMessage: 'child-output-value' },
    });
  });

  it('returns empty recipe_result when answer node has no output', async () => {
    const childRecipe = recipe({
      start: node('START', { display: {} }),
      display: {
        type: 'DISPLAY',
        outputs: { finalMessage: '${inputText}' },
        next: { end: {} },
      },
      end: node('END'),
    });
    const executeSubRecipe = vi.fn(async (): Promise<WorkflowExecutionResult> => ({
      executionId: 'child-execution-empty',
      status: 'COMPLETED' as const,
      outputVariables: { finalMessage: 'child-output-value' },
      nodeResults: [
        {
          nodeId: 'display',
          nodeType: 'DISPLAY' as const,
          status: 'NODE_COMPLETED' as const,
          retryCount: 0,
          startedAt: new Date('2026-06-24T00:00:00.000Z'),
          completedAt: new Date('2026-06-24T00:00:00.000Z'),
        },
      ],
      startedAt: new Date('2026-06-24T00:00:00.000Z'),
      completedAt: new Date('2026-06-24T00:00:00.000Z'),
    }));
    const service = createService({
      recipe: recipe({
        start: node('START', { callChild: {} }),
        callChild: {
          type: 'SUBFLOW',
          inputs: {
            recipe_name: 'child-flow',
            inputMapping: {},
            outputMapping: {},
          },
          outputs: { sub_result: '${recipe_result}' },
          next: { end: {} },
        },
        end: node('END'),
      }),
      nodeCatalog: createWorkflowNodeCatalog({
        resolveRecipeDefinition: () => childRecipe,
        executeSubRecipe,
      }),
    });

    const result = await service.execute(baseRequest(), new AbortController().signal);

    expect(result.status).toBe('COMPLETED');
    expect(result.outputVariables).toMatchObject({
      sub_result: {},
    });
  });

  it('exposes middle-node output via explicit outputMapping while recipe_result stays on answer node', async () => {
    const childRecipe = recipe({
      start: node('START', { display_a: {} }),
      display_a: {
        type: 'DISPLAY',
        outputs: { mid_var: 'middle-value' },
        next: { display_b: {} },
      },
      display_b: {
        type: 'DISPLAY',
        outputs: { finalMessage: '${inputText}' },
        next: { end: {} },
      },
      end: node('END'),
    });
    const executeSubRecipe = vi.fn(async (): Promise<WorkflowExecutionResult> => ({
      executionId: 'child-execution-mid',
      status: 'COMPLETED' as const,
      outputVariables: { mid_var: 'middle-value', finalMessage: 'answer-value' },
      nodeResults: [
        {
          nodeId: 'display_a',
          nodeType: 'DISPLAY' as const,
          status: 'NODE_COMPLETED' as const,
          output: { mid_var: 'middle-value' },
          retryCount: 0,
          startedAt: new Date('2026-06-24T00:00:00.000Z'),
          completedAt: new Date('2026-06-24T00:00:00.000Z'),
        },
        {
          nodeId: 'display_b',
          nodeType: 'DISPLAY' as const,
          status: 'NODE_COMPLETED' as const,
          output: { finalMessage: 'answer-value' },
          retryCount: 0,
          startedAt: new Date('2026-06-24T00:00:00.000Z'),
          completedAt: new Date('2026-06-24T00:00:00.000Z'),
        },
      ],
      startedAt: new Date('2026-06-24T00:00:00.000Z'),
      completedAt: new Date('2026-06-24T00:00:00.000Z'),
    }));
    const service = createService({
      recipe: recipe({
        start: node('START', { callChild: {} }),
        callChild: {
          type: 'SUBFLOW',
          inputs: {
            recipe_name: 'child-flow',
            inputMapping: {},
            outputMapping: { mid_result: '${outputs.mid_var}' },
          },
          outputs: {
            sub_result: '${recipe_result}',
            mid_result: '${mid_result}',
          },
          next: { end: {} },
        },
        end: node('END'),
      }),
      nodeCatalog: createWorkflowNodeCatalog({
        resolveRecipeDefinition: () => childRecipe,
        executeSubRecipe,
      }),
    });

    const result = await service.execute(baseRequest(), new AbortController().signal);

    expect(result.status).toBe('COMPLETED');
    expect(result.outputVariables).toMatchObject({
      sub_result: { finalMessage: 'answer-value' },
      mid_result: 'middle-value',
    });
  });

  it('returns empty recipe_result when child recipe has no END node', async () => {
    const childRecipe: RecipeDefinition = {
      recipeName: 'child-flow',
      version: 'v1',
      displayName: 'Child flow',
      flowGraph: {
        nodes: {
          display: {
            type: 'DISPLAY',
            outputs: { finalMessage: '${inputText}' },
            next: {},
          },
        },
      },
    };
    const executeSubRecipe = vi.fn(async (): Promise<WorkflowExecutionResult> => ({
      executionId: 'child-execution-no-end',
      status: 'COMPLETED' as const,
      outputVariables: { finalMessage: 'child-output-value' },
      nodeResults: [
        {
          nodeId: 'display',
          nodeType: 'DISPLAY' as const,
          status: 'NODE_COMPLETED' as const,
          output: { finalMessage: 'child-output-value' },
          retryCount: 0,
          startedAt: new Date('2026-06-24T00:00:00.000Z'),
          completedAt: new Date('2026-06-24T00:00:00.000Z'),
        },
      ],
      startedAt: new Date('2026-06-24T00:00:00.000Z'),
      completedAt: new Date('2026-06-24T00:00:00.000Z'),
    }));
    const service = createService({
      recipe: recipe({
        start: node('START', { callChild: {} }),
        callChild: {
          type: 'SUBFLOW',
          inputs: {
            recipe_name: 'child-flow',
            inputMapping: {},
            outputMapping: {},
          },
          outputs: { sub_result: '${recipe_result}' },
          next: { end: {} },
        },
        end: node('END'),
      }),
      nodeCatalog: createWorkflowNodeCatalog({
        resolveRecipeDefinition: () => childRecipe,
        executeSubRecipe,
      }),
    });

    const result = await service.execute(baseRequest(), new AbortController().signal);

    expect(result.status).toBe('COMPLETED');
    expect(result.outputVariables).toMatchObject({
      sub_result: {},
    });
  });

  it('binds recipe_result to the post-join summary node, not the pre-fork init node', async () => {
    // Black-box regression: a child recipe with a fork/join must bind recipe_result
    // to the END-adjacent summary node (DSL "最后一个节点输�?), not to the node
    // before the parallel fork. START-forward resolution would stop at the fork
    // and return init; END-reverse resolution returns summary.
    const childRecipe = recipe({
      start: node('START', { init: {} }),
      init: {
        type: 'DISPLAY',
        outputs: { smsg: 'init continue' },
        next: { fork: {} },
      },
      fork: {
        type: 'PARALLEL',
        next: { branch_a: {}, branch_b: {} },
      },
      branch_a: {
        type: 'DISPLAY',
        outputs: { smsg: 'branch_a continue' },
        next: { join_node: {} },
      },
      branch_b: {
        type: 'DISPLAY',
        outputs: { smsg: 'branch_b continue' },
        next: { join_node: {} },
      },
      join_node: {
        type: 'DISPLAY',
        outputs: { smsg2: 'node join' },
        next: { summary: {} },
      },
      summary: {
        type: 'DISPLAY',
        outputs: { smsg_end: 'summary end' },
        next: { end: {} },
      },
      end: node('END'),
    });
    const executeSubRecipe = vi.fn(async (): Promise<WorkflowExecutionResult> => ({
      executionId: 'child-execution-fork-join',
      status: 'COMPLETED' as const,
      outputVariables: {
        smsg: 'init continue',
        smsg2: 'node join',
        smsg_end: 'summary end',
      },
      nodeResults: [
        {
          nodeId: 'init',
          nodeType: 'DISPLAY' as const,
          status: 'NODE_COMPLETED' as const,
          output: { smsg: 'init continue' },
          retryCount: 0,
          startedAt: new Date('2026-06-24T00:00:00.000Z'),
          completedAt: new Date('2026-06-24T00:00:00.000Z'),
        },
        {
          nodeId: 'fork',
          nodeType: 'PARALLEL' as const,
          status: 'NODE_COMPLETED' as const,
          retryCount: 0,
          startedAt: new Date('2026-06-24T00:00:00.000Z'),
          completedAt: new Date('2026-06-24T00:00:00.000Z'),
        },
        {
          nodeId: 'branch_a',
          nodeType: 'DISPLAY' as const,
          status: 'NODE_COMPLETED' as const,
          output: { smsg: 'branch_a continue' },
          retryCount: 0,
          startedAt: new Date('2026-06-24T00:00:00.000Z'),
          completedAt: new Date('2026-06-24T00:00:00.000Z'),
        },
        {
          nodeId: 'branch_b',
          nodeType: 'DISPLAY' as const,
          status: 'NODE_COMPLETED' as const,
          output: { smsg: 'branch_b continue' },
          retryCount: 0,
          startedAt: new Date('2026-06-24T00:00:00.000Z'),
          completedAt: new Date('2026-06-24T00:00:00.000Z'),
        },
        {
          nodeId: 'join_node',
          nodeType: 'DISPLAY' as const,
          status: 'NODE_COMPLETED' as const,
          output: { smsg2: 'node join' },
          retryCount: 0,
          startedAt: new Date('2026-06-24T00:00:00.000Z'),
          completedAt: new Date('2026-06-24T00:00:00.000Z'),
        },
        {
          nodeId: 'summary',
          nodeType: 'DISPLAY' as const,
          status: 'NODE_COMPLETED' as const,
          output: { smsg_end: 'summary end' },
          retryCount: 0,
          startedAt: new Date('2026-06-24T00:00:00.000Z'),
          completedAt: new Date('2026-06-24T00:00:00.000Z'),
        },
      ],
      startedAt: new Date('2026-06-24T00:00:00.000Z'),
      completedAt: new Date('2026-06-24T00:00:00.000Z'),
    }));
    const service = createService({
      recipe: recipe({
        start: node('START', { callChild: {} }),
        callChild: {
          type: 'SUBFLOW',
          inputs: {
            recipe_name: 'child-flow',
            inputMapping: {},
            outputMapping: {},
          },
          outputs: { sub_result: '${recipe_result}' },
          next: { end: {} },
        },
        end: node('END'),
      }),
      nodeCatalog: createWorkflowNodeCatalog({
        resolveRecipeDefinition: () => childRecipe,
        executeSubRecipe,
      }),
    });

    const result = await service.execute(baseRequest(), new AbortController().signal);

    expect(result.status).toBe('COMPLETED');
    expect(result.outputVariables).toMatchObject({
      sub_result: { smsg_end: 'summary end' },
    });
    expect(result.outputVariables).not.toHaveProperty('sub_result', { smsg: 'init continue' });
  });

  it('returns empty recipe_result when fork-join attaches directly to END with no summary node', async () => {
    // END's predecessor is a PARALLEL gateway with multiple predecessors; the
    // single-predecessor reverse walk cannot proceed, so answer node is undefined.
    const childRecipe = recipe({
      start: node('START', { fork: {} }),
      fork: {
        type: 'PARALLEL',
        next: { branch_a: {}, branch_b: {} },
      },
      branch_a: {
        type: 'DISPLAY',
        outputs: { smsg: 'branch_a continue' },
        next: { end: {} },
      },
      branch_b: {
        type: 'DISPLAY',
        outputs: { smsg: 'branch_b continue' },
        next: { end: {} },
      },
      end: node('END'),
    });
    const executeSubRecipe = vi.fn(async (): Promise<WorkflowExecutionResult> => ({
      executionId: 'child-execution-fork-at-end',
      status: 'COMPLETED' as const,
      outputVariables: { smsg: 'branch_a continue' },
      nodeResults: [
        {
          nodeId: 'branch_a',
          nodeType: 'DISPLAY' as const,
          status: 'NODE_COMPLETED' as const,
          output: { smsg: 'branch_a continue' },
          retryCount: 0,
          startedAt: new Date('2026-06-24T00:00:00.000Z'),
          completedAt: new Date('2026-06-24T00:00:00.000Z'),
        },
        {
          nodeId: 'branch_b',
          nodeType: 'DISPLAY' as const,
          status: 'NODE_COMPLETED' as const,
          output: { smsg: 'branch_b continue' },
          retryCount: 0,
          startedAt: new Date('2026-06-24T00:00:00.000Z'),
          completedAt: new Date('2026-06-24T00:00:00.000Z'),
        },
      ],
      startedAt: new Date('2026-06-24T00:00:00.000Z'),
      completedAt: new Date('2026-06-24T00:00:00.000Z'),
    }));
    const service = createService({
      recipe: recipe({
        start: node('START', { callChild: {} }),
        callChild: {
          type: 'SUBFLOW',
          inputs: {
            recipe_name: 'child-flow',
            inputMapping: {},
            outputMapping: {},
          },
          outputs: { sub_result: '${recipe_result}' },
          next: { end: {} },
        },
        end: node('END'),
      }),
      nodeCatalog: createWorkflowNodeCatalog({
        resolveRecipeDefinition: () => childRecipe,
        executeSubRecipe,
      }),
    });

    const result = await service.execute(baseRequest(), new AbortController().signal);

    expect(result.status).toBe('COMPLETED');
    expect(result.outputVariables).toMatchObject({
      sub_result: {},
    });
  });

  it('forwards observer to executeSubRecipe and registers recipe on observer', async () => {
    const childRecipe = recipe({
      start: node('START', { end: {} }),
      end: node('END'),
    });
    const executeSubRecipe = vi.fn(async () => ({
      executionId: 'child-execution-3',
      status: 'COMPLETED' as const,
      outputVariables: {},
      nodeResults: [],
      startedAt: new Date('2026-06-24T00:00:00.000Z'),
      completedAt: new Date('2026-06-24T00:00:00.000Z'),
    }));
    const service = createService({
      recipe: recipe({
        start: node('START', { callChild: {} }),
        callChild: {
          type: 'SUBFLOW',
          inputs: {
            recipe_name: 'child-flow',
            inputMapping: {},
            outputMapping: {},
          },
          next: { end: {} },
        },
        end: node('END'),
      }),
      nodeCatalog: createWorkflowNodeCatalog({
        resolveRecipeDefinition: () => childRecipe,
        executeSubRecipe,
      }),
    });

    const registerExecutionRecipe = vi.fn();
    const observer = { registerExecutionRecipe, emitEvent: vi.fn() };

    const result = await service.execute(baseRequest(), new AbortController().signal, observer);

    expect(result.status).toBe('COMPLETED');
    expect(registerExecutionRecipe).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ recipeName: 'workflow-test' }));
    expect(executeSubRecipe).toHaveBeenCalledWith(expect.objectContaining({ recipeName: 'workflow-test' }), expect.any(AbortSignal), observer);
  });
  it('builds node_record_info from child node results', async () => {
    const childRecipe = recipe({
      start: node('START', { callApi: {} }),
      callApi: {
        type: 'RESTFUL',
        description: 'Fetch incident details',
        inputs: { api_name: 'get-incident' },
        next: { end: {} },
      },
      end: node('END'),
    });
    const executeSubRecipe = vi.fn(async (): Promise<WorkflowExecutionResult> => ({
      executionId: 'child-execution-nri',
      status: 'COMPLETED' as const,
      outputVariables: {},
      nodeResults: [
        {
          nodeId: 'start',
          nodeType: 'START' as const,
          status: 'NODE_COMPLETED' as const,
          output: {},
          retryCount: 0,
          startedAt: new Date('2026-06-24T00:00:00.000Z'),
          completedAt: new Date('2026-06-24T00:00:00.000Z'),
        },
        {
          nodeId: 'callApi',
          nodeType: 'RESTFUL' as const,
          status: 'NODE_COMPLETED' as const,
          output: {
            api_name: 'get-incident',
            api_response: { incidentId: 'INC-001' },
            api_resp_define: { fields: [{ name: 'incidentId' }] },
          },
          retryCount: 0,
          startedAt: new Date('2026-06-24T00:00:00.000Z'),
          completedAt: new Date('2026-06-24T00:00:00.000Z'),
        },
      ],
      startedAt: new Date('2026-06-24T00:00:00.000Z'),
      completedAt: new Date('2026-06-24T00:00:00.000Z'),
    }));
    const service = createService({
      recipe: recipe({
        start: node('START', { callChild: {} }),
        callChild: {
          type: 'SUBFLOW',
          inputs: {
            recipe_name: 'child-flow',
            inputMapping: {},
            outputMapping: {},
          },
          outputs: { records: '${node_record_info}' },
          next: { end: {} },
        },
        end: node('END'),
      }),
      nodeCatalog: createWorkflowNodeCatalog({
        resolveRecipeDefinition: () => childRecipe,
        executeSubRecipe,
      }),
    });
    const result = await service.execute(baseRequest(), new AbortController().signal);
    expect(result.status).toBe('COMPLETED');
    const records = result.outputVariables.records as readonly JsonObject[];
    expect(records).toHaveLength(2);
    expect(records[0]).toMatchObject({
      name: 'start',
      type: 'START',
      inputs: {},
      outputs: {},
    });
    expect(records[1]).toMatchObject({
      name: 'callApi',
      type: 'RESTFUL',
      description: 'Fetch incident details',
    });
    expect((records[1] as Record<string, unknown>).inputs).toEqual({ api_name: 'get-incident' });
    expect((records[1] as Record<string, unknown>).outputs).toEqual({
      api_response: { incidentId: 'INC-001' },
    });
    expect((records[1] as Record<string, unknown>).outputDefine).toEqual({
      fields: [{ name: 'incidentId' }],
    });
  });

  it('filters recipe_result from node_record_info by default', async () => {
    const childRecipe = recipe({
      start: node('START', { end: {} }),
      end: node('END'),
    });
    const executeSubRecipe = vi.fn(async (): Promise<WorkflowExecutionResult> => ({
      executionId: 'child-filter',
      status: 'COMPLETED' as const,
      outputVariables: {},
      nodeResults: [
        {
          nodeId: 'start',
          nodeType: 'START' as const,
          status: 'NODE_COMPLETED' as const,
          output: { recipe_result: { answer: '42' } },
          retryCount: 0,
          startedAt: new Date('2026-06-24T00:00:00.000Z'),
          completedAt: new Date('2026-06-24T00:00:00.000Z'),
        },
      ],
      startedAt: new Date('2026-06-24T00:00:00.000Z'),
      completedAt: new Date('2026-06-24T00:00:00.000Z'),
    }));
    const service = createService({
      recipe: recipe({
        start: node('START', { callChild: {} }),
        callChild: {
          type: 'SUBFLOW',
          inputs: { recipe_name: 'child-flow', inputMapping: {}, outputMapping: {} },
          outputs: { records: '${node_record_info}' },
          next: { end: {} },
        },
        end: node('END'),
      }),
      nodeCatalog: createWorkflowNodeCatalog({
        resolveRecipeDefinition: () => childRecipe,
        executeSubRecipe,
      }),
    });
    const result = await service.execute(baseRequest(), new AbortController().signal);
    const records = result.outputVariables.records as readonly JsonObject[];
    expect((records[0] as Record<string, unknown>).outputs).toEqual({});
  });

  it('includes recipe_result when is_node_record_with_recipe_result is true', async () => {
    const childRecipe = recipe({
      start: node('START', { end: {} }),
      end: node('END'),
    });
    const executeSubRecipe = vi.fn(async (): Promise<WorkflowExecutionResult> => ({
      executionId: 'child-include',
      status: 'COMPLETED' as const,
      outputVariables: {},
      nodeResults: [
        {
          nodeId: 'start',
          nodeType: 'START' as const,
          status: 'NODE_COMPLETED' as const,
          output: { recipe_result: { answer: '42' } },
          retryCount: 0,
          startedAt: new Date('2026-06-24T00:00:00.000Z'),
          completedAt: new Date('2026-06-24T00:00:00.000Z'),
        },
      ],
      startedAt: new Date('2026-06-24T00:00:00.000Z'),
      completedAt: new Date('2026-06-24T00:00:00.000Z'),
    }));
    const service = createService({
      recipe: recipe({
        start: node('START', { callChild: {} }),
        callChild: {
          type: 'SUBFLOW',
          inputs: {
            recipe_name: 'child-flow',
            inputMapping: {},
            outputMapping: {},
            is_node_record_with_recipe_result: true,
          },
          outputs: { records: '${node_record_info}' },
          next: { end: {} },
        },
        end: node('END'),
      }),
      nodeCatalog: createWorkflowNodeCatalog({
        resolveRecipeDefinition: () => childRecipe,
        executeSubRecipe,
      }),
    });
    const result = await service.execute(baseRequest(), new AbortController().signal);
    const records = result.outputVariables.records as readonly JsonObject[];
    expect((records[0] as Record<string, unknown>).outputs).toEqual({
      recipe_result: { answer: '42' },
    });
  });

  it('includes recipe_result when scene is MAE-CN', async () => {
    const childRecipe = recipe({
      start: node('START', { end: {} }),
      end: node('END'),
    });
    const executeSubRecipe = vi.fn(async (): Promise<WorkflowExecutionResult> => ({
      executionId: 'child-scene',
      status: 'COMPLETED' as const,
      outputVariables: {},
      nodeResults: [
        {
          nodeId: 'start',
          nodeType: 'START' as const,
          status: 'NODE_COMPLETED' as const,
          output: { recipe_result: { answer: '42' } },
          retryCount: 0,
          startedAt: new Date('2026-06-24T00:00:00.000Z'),
          completedAt: new Date('2026-06-24T00:00:00.000Z'),
        },
      ],
      startedAt: new Date('2026-06-24T00:00:00.000Z'),
      completedAt: new Date('2026-06-24T00:00:00.000Z'),
    }));
    const service = createService({
      recipe: recipe({
        start: node('START', { callChild: {} }),
        callChild: {
          type: 'SUBFLOW',
          inputs: { recipe_name: 'child-flow', inputMapping: {}, outputMapping: {} },
          outputs: { records: '${node_record_info}' },
          next: { end: {} },
        },
        end: node('END'),
      }),
      nodeCatalog: createWorkflowNodeCatalog({
        resolveRecipeDefinition: () => childRecipe,
        executeSubRecipe,
        scene: 'MAE-CN',
      }),
    });
    const result = await service.execute(baseRequest(), new AbortController().signal);
    const records = result.outputVariables.records as readonly JsonObject[];
    expect((records[0] as Record<string, unknown>).outputs).toEqual({
      recipe_result: { answer: '42' },
    });
  });

  it('handles node result with undefined output', async () => {
    const childRecipe = recipe({
      start: node('START', { end: {} }),
      end: node('END'),
    });
    const executeSubRecipe = vi.fn(async (): Promise<WorkflowExecutionResult> => ({
      executionId: 'child-empty',
      status: 'COMPLETED' as const,
      outputVariables: {},
      nodeResults: [
        {
          nodeId: 'start',
          nodeType: 'START' as const,
          status: 'NODE_COMPLETED' as const,
          retryCount: 0,
          startedAt: new Date('2026-06-24T00:00:00.000Z'),
          completedAt: new Date('2026-06-24T00:00:00.000Z'),
        },
      ],
      startedAt: new Date('2026-06-24T00:00:00.000Z'),
      completedAt: new Date('2026-06-24T00:00:00.000Z'),
    }));
    const service = createService({
      recipe: recipe({
        start: node('START', { callChild: {} }),
        callChild: {
          type: 'SUBFLOW',
          inputs: { recipe_name: 'child-flow', inputMapping: {}, outputMapping: {} },
          outputs: { records: '${node_record_info}' },
          next: { end: {} },
        },
        end: node('END'),
      }),
      nodeCatalog: createWorkflowNodeCatalog({
        resolveRecipeDefinition: () => childRecipe,
        executeSubRecipe,
      }),
    });
    const result = await service.execute(baseRequest(), new AbortController().signal);
    const records = result.outputVariables.records as readonly JsonObject[];
    expect((records[0] as Record<string, unknown>).inputs).toEqual({});
    expect((records[0] as Record<string, unknown>).outputs).toEqual({});
  });

  it('kind defaults to QUESTION when kind is not provided', async () => {
    const service = createService({
      recipe: recipe({
        start: node('START', { askUser: {} }),
        askUser: {
          type: 'USER_CHECK',
          timeout: 1,
          inputs: {
            question: 'Select an option',
            action_type: 'choice',
            options: [{ label: 'Approve', value: 'approve' }],
          },
          next: { end: {} },
        },
        end: node('END'),
      }),
    });

    const first = await service.execute(baseRequest(), new AbortController().signal, undefined, {
      requestPendingInput: vi.fn(async (request) => {
        return {
          id: 'pending-default-kind',
          sessionId: baseRequest().sessionId,
          kind: request.kind,
          questions: request.questions,
        };
      }),
    });

    expect(first.status).toBe('WAITING');
    expect(first.pendingInput?.kind).toBe('QUESTION');
  });

  it('CONFIRMATION auto-constructs approve/reject options', async () => {
    const service = createService({
      recipe: recipe({
        start: node('START', { askUser: {} }),
        askUser: {
          type: 'USER_CHECK',
          timeout: 1,
          inputs: {
            kind: 'CONFIRMATION',
            tips: 'Confirm reset operation',
          },
          next: { end: {} },
        },
        end: node('END'),
      }),
    });

    const first = await service.execute(baseRequest(), new AbortController().signal, undefined, {
      requestPendingInput: vi.fn(async (request) => {
        return {
          id: 'pending-confirmation',
          sessionId: baseRequest().sessionId,
          kind: request.kind,
          questions: request.questions,
        };
      }),
    });

    expect(first.status).toBe('WAITING');
    expect(first.pendingInput?.kind).toBe('CONFIRMATION');
    expect(first.pendingInput).toMatchObject({
      questions: [
        {
          options: [
            { label: 'approve', value: 'approve' },
            { label: 'reject', value: 'reject' },
          ],
        },
      ],
    });
  });

  it('AUTHORIZATION auto-constructs approve/deny options', async () => {
    const service = createService({
      recipe: recipe({
        start: node('START', { askUser: {} }),
        askUser: {
          type: 'USER_CHECK',
          timeout: 1,
          inputs: {
            kind: 'AUTHORIZATION',
            tips: 'Authorize config change',
          },
          next: { end: {} },
        },
        end: node('END'),
      }),
    });

    const first = await service.execute(baseRequest(), new AbortController().signal, undefined, {
      requestPendingInput: vi.fn(async (request) => {
        return {
          id: 'pending-authorization',
          sessionId: baseRequest().sessionId,
          kind: request.kind,
          questions: request.questions,
        };
      }),
    });

    expect(first.status).toBe('WAITING');
    expect(first.pendingInput?.kind).toBe('AUTHORIZATION');
    expect(first.pendingInput).toMatchObject({
      questions: [
        {
          options: [
            { label: 'approve', value: 'approve' },
            { label: 'deny', value: 'deny' },
          ],
        },
      ],
    });
  });

  it('HUMAN_HANDOFF notifies via emitOutputDelta and exits with COMPLETED', async () => {
    const observedEvents: WorkflowExecutionEvent[] = [];
    const service = createService({
      recipe: recipe({
        start: node('START', { askUser: {} }),
        askUser: {
          type: 'USER_CHECK',
          inputs: {
            kind: 'HUMAN_HANDOFF',
            tips: 'Task cannot continue: manual intervention required',
          },
          next: { end: {} },
        },
        end: node('END'),
      }),
      emitEvent: async (event) => {
        observedEvents.push(event);
      },
    });

    const result = await service.execute(baseRequest(), new AbortController().signal);

    expect(result.status).toBe('COMPLETED');
    expect(
      observedEvents.some(
        (e) =>
          e.nodeId === 'askUser' &&
          e.eventType === 'NODE_OUTPUT_DELTA' &&
          (e.visibleDelta as any)?.channel === 'CONTENT' &&
          (e.visibleDelta as any)?.content === 'Task cannot continue: manual intervention required',
      ),
    ).toBe(true);
    expect(result.nodeResults.find((item) => item.nodeId === 'askUser')?.status).toBe('NODE_COMPLETED');
  });

  it('HUMAN_HANDOFF does not create pending input', async () => {
    const service = createService({
      recipe: recipe({
        start: node('START', { askUser: {} }),
        askUser: {
          type: 'USER_CHECK',
          inputs: {
            kind: 'HUMAN_HANDOFF',
            tips: 'Exiting',
          },
          next: { end: {} },
        },
        end: node('END'),
      }),
    });

    const requestPendingInput = vi.fn(async (request: any) => ({
      id: 'should-not-be-called',
      sessionId: baseRequest().sessionId,
      kind: request.kind,
      questions: request.questions,
    }));

    const result = await service.execute(baseRequest(), new AbortController().signal, undefined, {
      requestPendingInput,
    });

    expect(result.status).toBe('COMPLETED');
    expect(requestPendingInput).not.toHaveBeenCalled();
  });

  it('multiple input fields produce structured user_check_result', async () => {
    const activations: Array<WorkflowExecutionRequest['resumeState']> = [];
    const service = createService({
      recipe: recipe({
        start: node('START', { askUser: {} }),
        askUser: {
          type: 'USER_CHECK',
          timeout: 1,
          inputs: {
            kind: 'QUESTION',
            action_type: 'input',
            tips: 'Please provide the following info',
            fields: [
              { name: 'cell_id', description: 'Cell ID' },
              { name: 'alarm_code', description: 'Alarm Code' },
            ],
          },
          outputs: {
            result: '${user_check_result}',
          },
          next: { end: {} },
        },
        end: node('END'),
      }),
    });

    const first = await service.execute(baseRequest(), new AbortController().signal, undefined, {
      requestPendingInput: vi.fn(async (request) => {
        activations.push(request.resumeState);
        return {
          id: 'pending-fields',
          sessionId: baseRequest().sessionId,
          kind: request.kind,
          questions: request.questions,
        };
      }),
    });

    expect(first.status).toBe('WAITING');
    expect(first.pendingInput?.questions).toHaveLength(2);
    expect(first.pendingInput).toMatchObject({
      questions: [{ prompt: 'Cell ID' }, { prompt: 'Alarm Code' }],
    });

    const resumed = await service.execute(
      {
        ...baseRequest(),
        resumeState: {
          ...activations[0]!,
          pendingInputId: 'pending-fields',
          answers: [['NB123456'], ['ALM-001']],
        },
      },
      new AbortController().signal,
    );

    expect(resumed.status).toBe('COMPLETED');
    expect(resumed.outputVariables).toMatchObject({
      result: { cell_id: 'NB123456', alarm_code: 'ALM-001' },
    });
  });
});
