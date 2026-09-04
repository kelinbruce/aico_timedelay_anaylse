import { brand } from '@nextagent/agent-common';
import type { RecipeDefinition, WorkflowExecutionResult } from '@nextagent/agent-contracts/core';
import { describe, expect, it } from 'vitest';

import { projectWorkflowExecutionResult } from '../src/agent/workflow-result-projector.js';

describe('workflow result projector', () => {
  it('prefers user-visible workflow text fields for terminal content', () => {
    const projection = projectWorkflowExecutionResult(recipe(), {
      executionId: 'workflow-execution-1',
      status: 'COMPLETED',
      outputVariables: { summary: 'summary text', message: 'workflow completed' },
      nodeResults: [],
      startedAt: new Date('2026-06-23T00:00:00.000Z'),
      completedAt: new Date('2026-06-23T00:00:01.000Z'),
    });

    expect(projection).toEqual({
      terminalContent: 'workflow completed',
    });
  });

  it('falls back to the latest safe error for failed workflows', () => {
    const projection = projectWorkflowExecutionResult(recipe(), {
      executionId: 'workflow-execution-1',
      status: 'FAILED',
      outputVariables: {},
      nodeResults: [nodeFailure('first failure', 'FIRST_FAILURE'), nodeFailure('latest failure', 'LATEST_FAILURE')],
      startedAt: new Date('2026-06-23T00:00:00.000Z'),
      completedAt: new Date('2026-06-23T00:00:01.000Z'),
    });

    expect(projection.terminalContent).toBe('latest failure');
    expect(projection.terminalError).toMatchObject({
      code: 'LATEST_FAILURE',
      message: 'latest failure',
      category: 'INTERNAL',
      retryable: false,
    });
  });

  it('uses the workflow output text when an interrupted workflow provides one', () => {
    const projection = projectWorkflowExecutionResult(recipe(), {
      executionId: 'workflow-execution-1',
      status: 'INTERRUPTED',
      outputVariables: { result: 'workflow interrupted for operator review' },
      nodeResults: [],
      startedAt: new Date('2026-06-23T00:00:00.000Z'),
      completedAt: new Date('2026-06-23T00:00:01.000Z'),
    });

    expect(projection.terminalContent).toBe('workflow interrupted for operator review');
    expect(projection.terminalError).toMatchObject({
      code: 'WORKFLOW_EXECUTION_INTERRUPTED',
      message: 'Workflow "RAN Alarm Diagnosis" was interrupted safely.',
      category: 'CANCELED',
      retryable: false,
    });
  });

  it('serializes outputVariables as JSON fallback when no known text field exists', () => {
    const projection = projectWorkflowExecutionResult(recipe(), {
      executionId: 'workflow-execution-1',
      status: 'COMPLETED',
      outputVariables: { recipe_name: 'troubleshoot-signal', recall_result: [{ ref: 'doc-1' }] },
      nodeResults: [],
      startedAt: new Date('2026-06-23T00:00:00.000Z'),
      completedAt: new Date('2026-06-23T00:00:01.000Z'),
    });

    expect(projection.terminalContent).toBe(JSON.stringify({ recipe_name: 'troubleshoot-signal', recall_result: [{ ref: 'doc-1' }] }));
    expect(projection.terminalError).toBeUndefined();
  });

  it('serializes api-choice outputVariables as JSON fallback', () => {
    const projection = projectWorkflowExecutionResult(recipe(), {
      executionId: 'workflow-execution-1',
      status: 'COMPLETED',
      outputVariables: { apiName: 'query_incident', mappedParams: { incidentId: 'INC-7' } },
      nodeResults: [],
      startedAt: new Date('2026-06-23T00:00:00.000Z'),
      completedAt: new Date('2026-06-23T00:00:01.000Z'),
    });

    expect(projection.terminalContent).toBe(JSON.stringify({ apiName: 'query_incident', mappedParams: { incidentId: 'INC-7' } }));
    expect(projection.terminalError).toBeUndefined();
  });

  it('serializes knowledge-search outputVariables as JSON fallback', () => {
    const projection = projectWorkflowExecutionResult(recipe(), {
      executionId: 'workflow-execution-1',
      status: 'COMPLETED',
      outputVariables: { knowledge_search_result: ['doc excerpt one', 'doc excerpt two'], recall_result: [{ id: 'doc-1' }] },
      nodeResults: [],
      startedAt: new Date('2026-06-23T00:00:00.000Z'),
      completedAt: new Date('2026-06-23T00:00:01.000Z'),
    });

    expect(projection.terminalContent).toBe(
      JSON.stringify({ knowledge_search_result: ['doc excerpt one', 'doc excerpt two'], recall_result: [{ id: 'doc-1' }] }),
    );
    expect(projection.terminalError).toBeUndefined();
  });

  it('returns empty terminalContent when outputVariables is empty', () => {
    const projection = projectWorkflowExecutionResult(recipe(), {
      executionId: 'workflow-execution-1',
      status: 'COMPLETED',
      outputVariables: {},
      nodeResults: [],
      startedAt: new Date('2026-06-23T00:00:00.000Z'),
      completedAt: new Date('2026-06-23T00:00:01.000Z'),
    });

    expect(projection.terminalContent).toBe('');
    expect(projection.terminalError).toBeUndefined();
  });

  it('truncates JSON fallback that exceeds the character limit', () => {
    const longValue = 'x'.repeat(20_000);
    const projection = projectWorkflowExecutionResult(recipe(), {
      executionId: 'workflow-execution-1',
      status: 'COMPLETED',
      outputVariables: { knowledge_search_result: longValue },
      nodeResults: [],
      startedAt: new Date('2026-06-23T00:00:00.000Z'),
      completedAt: new Date('2026-06-23T00:00:01.000Z'),
    });

    expect(projection.terminalContent.length).toBe(16_384 + 3);
    expect(projection.terminalContent.endsWith('...')).toBe(true);
    expect(projection.terminalError).toBeUndefined();
  });

  it('skips CANCELED safeErrors from collateral branch abort and uses the real failure', () => {
    const projection = projectWorkflowExecutionResult(recipe(), {
      executionId: 'workflow-execution-1',
      status: 'FAILED',
      outputVariables: {},
      nodeResults: [
        nodeFailure('Connection refused.', 'CAPABILITY_EXECUTION_FAILED'),
        {
          nodeId: brand('delay-1'),
          nodeType: 'DELAY',
          status: 'NODE_FAILED',
          safeError: { code: 'WORKFLOW_INTERRUPTED', message: 'Interrupted.', category: 'CANCELED', retryable: false },
          retryCount: 0,
          startedAt: new Date('2026-06-23T00:00:00.000Z'),
          completedAt: new Date('2026-06-23T00:00:01.000Z'),
        },
      ],
      startedAt: new Date('2026-06-23T00:00:00.000Z'),
      completedAt: new Date('2026-06-23T00:00:01.000Z'),
    });

    expect(projection.terminalError?.category).toBe('INTERNAL');
    expect(projection.terminalError?.code).toBe('CAPABILITY_EXECUTION_FAILED');
  });

  it('preserves CANCELED category for INTERRUPTED status even when CANCELED safeError is present', () => {
    const projection = projectWorkflowExecutionResult(recipe(), {
      executionId: 'workflow-execution-1',
      status: 'INTERRUPTED',
      outputVariables: { result: 'workflow interrupted' },
      nodeResults: [
        {
          nodeId: brand('delay-1'),
          nodeType: 'DELAY',
          status: 'NODE_FAILED',
          safeError: { code: 'WORKFLOW_INTERRUPTED', message: 'Interrupted.', category: 'CANCELED', retryable: false },
          retryCount: 0,
          startedAt: new Date('2026-06-23T00:00:00.000Z'),
          completedAt: new Date('2026-06-23T00:00:01.000Z'),
        },
      ],
      startedAt: new Date('2026-06-23T00:00:00.000Z'),
      completedAt: new Date('2026-06-23T00:00:01.000Z'),
    });
  });

  it('falls back to most recent CANCELED safeError and forces INTERNAL when all failed nodes are CANCELED', () => {
    const projection = projectWorkflowExecutionResult(recipe(), {
      executionId: 'workflow-execution-1',
      status: 'FAILED',
      outputVariables: {},
      nodeResults: [
        {
          nodeId: brand('delay-1'),
          nodeType: 'DELAY',
          status: 'NODE_FAILED',
          safeError: { code: 'WORKFLOW_INTERRUPTED', message: 'First interrupt.', category: 'CANCELED', retryable: false },
          retryCount: 0,
          startedAt: new Date('2026-06-23T00:00:00.000Z'),
          completedAt: new Date('2026-06-23T00:00:01.000Z'),
        },
        {
          nodeId: brand('delay-2'),
          nodeType: 'DELAY',
          status: 'NODE_FAILED',
          safeError: { code: 'WORKFLOW_INTERRUPTED', message: 'Second interrupt.', category: 'CANCELED', retryable: false },
          retryCount: 0,
          startedAt: new Date('2026-06-23T00:00:00.000Z'),
          completedAt: new Date('2026-06-23T00:00:02.000Z'),
        },
      ],
      startedAt: new Date('2026-06-23T00:00:00.000Z'),
      completedAt: new Date('2026-06-23T00:00:02.000Z'),
    });

    expect(projection.terminalError?.category).toBe('INTERNAL');
    expect(projection.terminalError?.code).toBe('WORKFLOW_INTERRUPTED');
    expect(projection.terminalError?.message).toBe('Second interrupt.');
  });
});

function recipe(): RecipeDefinition {
  return {
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
    },
  };
}

function nodeFailure(message: string, code: string): WorkflowExecutionResult['nodeResults'][number] {
  return {
    nodeId: brand<string, 'WorkflowNodeId'>(`node-${code.toLowerCase()}`),
    nodeType: 'TOOL',
    status: 'NODE_FAILED',
    safeError: {
      code,
      message,
      category: 'INTERNAL',
      retryable: false,
    },
    retryCount: 0,
    startedAt: new Date('2026-06-23T00:00:00.000Z'),
    completedAt: new Date('2026-06-23T00:00:01.000Z'),
  };
}
