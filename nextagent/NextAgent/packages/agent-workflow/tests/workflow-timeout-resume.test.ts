import type { JsonObject } from '@nextagent/agent-common';
import type { WorkflowExecutionRequest, WorkflowExecutionResumeState } from '@nextagent/agent-contracts/core';
import { describe, expect, it, vi } from 'vitest';
import { createService, recipe, node, baseRequest } from './test-helpers.js';

describe('workflow pending input timeout resume', () => {
  it('throws WORKFLOW_NODE_TIMEOUT when interrupt node pending input times out and resumes without answers', async () => {
    const activations: WorkflowExecutionResumeState[] = [];
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
          id: 'pending-interrupt-timeout',
          sessionId: baseRequest().sessionId,
          kind: request.kind,
          questions: request.questions,
        };
      }),
    });

    expect(first.status).toBe('WAITING');

    // Simulate timeout resume: answers is NOT set (undefined).
    // This is what runtime's attachWorkflowPendingTimeoutResume produces.
    const resumed = await service.execute(
      {
        ...baseRequest(),
        resumeState: {
          ...activations[0]!,
          pendingInputId: 'pending-interrupt-timeout',
        } as unknown as JsonObject,
      },
      new AbortController().signal,
    );

    expect(resumed.status).toBe('FAILED');
    expect(resumed.nodeResults.find((item) => item.nodeId === 'pause')).toMatchObject({
      status: 'NODE_FAILED',
      safeError: {
        code: 'WORKFLOW_NODE_TIMEOUT',
        category: 'TIMEOUT',
      },
    });
  });

  it('does not create a new pending input when interrupt node times out and resumes without answers', async () => {
    const activations: WorkflowExecutionResumeState[] = [];
    const requestPendingInput = vi.fn(async (request) => {
      activations.push(request.resumeState);
      return {
        id: 'pending-interrupt-no-recreate',
        sessionId: baseRequest().sessionId,
        kind: request.kind,
        questions: request.questions,
      } as const;
    });

    const service = createService({
      recipe: recipe({
        start: node('START', { pause: {} }),
        pause: {
          type: 'INTERRUPT',
          inputs: { prompt: 'External pause' },
          next: { end: {} },
        },
        end: node('END'),
      }),
    });

    const first = await service.execute(baseRequest(), new AbortController().signal, undefined, {
      requestPendingInput,
    });
    expect(first.status).toBe('WAITING');
    expect(requestPendingInput).toHaveBeenCalledTimes(1);

    // Timeout resume -- no answers field set.
    const resumed = await service.execute(
      {
        ...baseRequest(),
        resumeState: {
          ...activations[0]!,
          pendingInputId: 'pending-interrupt-no-recreate',
        } as unknown as JsonObject,
      },
      new AbortController().signal,
    );

    expect(resumed.status).toBe('FAILED');
    // requestPendingInput MUST NOT be called again during timeout resume.
    expect(requestPendingInput).toHaveBeenCalledTimes(1);
  });

  it('throws WORKFLOW_NODE_TIMEOUT when user-check node pending input times out and resumes without answers', async () => {
    const activations: WorkflowExecutionResumeState[] = [];
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
          id: 'pending-user-check-timeout',
          sessionId: baseRequest().sessionId,
          kind: request.kind,
          questions: request.questions,
        };
      }),
    });

    expect(first.status).toBe('WAITING');

    // Timeout resume -- answers is NOT set (undefined).
    const resumed = await service.execute(
      {
        ...baseRequest(),
        resumeState: {
          ...activations[0]!,
          pendingInputId: 'pending-user-check-timeout',
        } as unknown as JsonObject,
      },
      new AbortController().signal,
    );

    expect(resumed.status).toBe('FAILED');
    expect(resumed.nodeResults.find((item) => item.nodeId === 'askUser')).toMatchObject({
      status: 'NODE_FAILED',
      safeError: {
        code: 'WORKFLOW_NODE_TIMEOUT',
        category: 'TIMEOUT',
      },
    });
  });

  it('routes to exception branch when user-check timeout matches error.category == TIMEOUT', async () => {
    const activations: WorkflowExecutionResumeState[] = [];
    const handlerCalls: string[] = [];
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
          exception: {
            recover: { condition: "${error.category == 'TIMEOUT'}" },
          },
        },
        recover: {
          type: 'DISPLAY',
          outputs: { content: 'Timeout recovered -- proceeding with safe defaults' },
          next: { end: {} },
        },
        end: node('END'),
      }),
      nodeCatalog: {
        handlers: {
          DISPLAY: async (context) => {
            handlerCalls.push(context.nodeId);
            return { outputVariables: { recovered: true } };
          },
        },
      },
    });

    const first = await service.execute(baseRequest(), new AbortController().signal, undefined, {
      requestPendingInput: vi.fn(async (request) => {
        activations.push(request.resumeState);
        return {
          id: 'pending-user-check-exception',
          sessionId: baseRequest().sessionId,
          kind: request.kind,
          questions: request.questions,
        };
      }),
    });

    expect(first.status).toBe('WAITING');

    // Timeout resume -- answers is NOT set (undefined).
    const timeoutResumeRequest: WorkflowExecutionRequest = {
      ...baseRequest(),
      resumeState: {
        ...activations[0]!,
        pendingInputId: 'pending-user-check-exception',
      } as unknown as JsonObject,
    };
    const resumed = await service.execute(timeoutResumeRequest, new AbortController().signal);

    expect(resumed.status).toBe('COMPLETED');
    expect(handlerCalls).toContain('recover');
    expect(resumed.outputVariables).toMatchObject({ recovered: true });
  });
});
