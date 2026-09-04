import { brand, type JsonObject } from '@nextagent/agent-common';
import type { CapabilityInvocationPort, CapabilityInvocationResult, WorkflowSandboxExecutionInput } from '@nextagent/agent-contracts/capability';
import type { WorkflowSandboxExecutionPort } from '@nextagent/agent-capability';
import type { RecipeDefinition, WorkflowExecutionRequest } from '@nextagent/agent-contracts/core';
import { describe, expect, it, vi } from 'vitest';
import { createWorkflowExecutionService, createWorkflowNodeCatalog } from '../src/index.js';

describe('workflow python sandbox execution', () => {
  it('uses sandboxExecution port instead of capabilityInvocation when available', async () => {
    const invoke = vi.fn(async () => ({
      status: 'SUCCEEDED' as const,
      structuredPayload: {},
      generatedMessages: [],
      artifactRefs: [],
    }));
    const capabilityInvocation: CapabilityInvocationPort = { invoke };
    const runPython = vi.fn(async () => ({
      exit_code: 0,
      stdout: 'ok',
      stderr: '',
      timed_out: false,
    }));
    const sandboxExecution: WorkflowSandboxExecutionPort = { runPython };
    const service = createService({
      recipe: recipe({
        start: node('START', { python: {} }),
        python: node(
          'PYTHON',
          { end: {} },
          {
            inputs: { script: "print('ok')", extra_param: '${neId}' },
            outputs: { result: '${python_result}' },
          },
        ),
        end: node('END'),
      }),
      nodeCatalog: createWorkflowNodeCatalog({ capabilityInvocation, sandboxExecution }),
    });

    const result = await service.execute(withInput({ neId: 'NE-1' }), new AbortController().signal);

    expect(result.status).toBe('COMPLETED');
    expect(result.outputVariables).toMatchObject({ result: 'ok' });
    expect(runPython).toHaveBeenCalledTimes(1);
    expect(invoke).not.toHaveBeenCalled();
  });

  it('does not trigger nl2py guardrail through sandboxExecution path', async () => {
    const invoke = vi.fn(async () => ({
      status: 'FAILED' as const,
      structuredPayload: {},
      generatedMessages: [],
      artifactRefs: [],
      safeError: { code: 'NL2PY_GUARD_BLOCKED', message: 'blocked', category: 'VALIDATION' as const, retryable: false },
    }));
    const capabilityInvocation: CapabilityInvocationPort = { invoke };
    const runPython = vi.fn(async () => ({
      exit_code: 0,
      stdout: 'result_data',
      stderr: '',
      timed_out: false,
    }));
    const sandboxExecution: WorkflowSandboxExecutionPort = { runPython };
    const service = createService({
      recipe: recipe({
        start: node('START', { python: {} }),
        python: node(
          'PYTHON',
          { end: {} },
          {
            inputs: { script: 'import os' },
            outputs: { result: '${python_result}' },
          },
        ),
        end: node('END'),
      }),
      nodeCatalog: createWorkflowNodeCatalog({ capabilityInvocation, sandboxExecution }),
    });

    const result = await service.execute(withInput({}), new AbortController().signal);

    expect(result.status).toBe('COMPLETED');
    expect(runPython).toHaveBeenCalledTimes(1);
    expect(invoke).not.toHaveBeenCalled();
  });

  it('injects variable declarations as preamble in sandboxExecution path', async () => {
    const invoke = vi.fn();
    const capabilityInvocation: CapabilityInvocationPort = { invoke };
    const runPython = vi.fn(async (_input: WorkflowSandboxExecutionInput) => ({
      exit_code: 0,
      stdout: '42',
      stderr: '',
      timed_out: false,
    }));
    const sandboxExecution: WorkflowSandboxExecutionPort = { runPython };
    const service = createService({
      recipe: recipe({
        start: node('START', { python: {} }),
        python: node(
          'PYTHON',
          { end: {} },
          {
            inputs: { script: 'print(x)', x: '${val}' },
            outputs: { result: '${python_result}' },
          },
        ),
        end: node('END'),
      }),
      nodeCatalog: createWorkflowNodeCatalog({ capabilityInvocation, sandboxExecution }),
    });

    const result = await service.execute(withInput({ val: 42 }), new AbortController().signal);

    expect(result.status).toBe('COMPLETED');
    expect(result.outputVariables).toMatchObject({ result: 42 });
    expect(runPython).toHaveBeenCalledTimes(1);
    const callArg = runPython.mock.calls[0]![0] as unknown as JsonObject;
    expect(callArg['code']).toContain('x=42');
    expect(callArg['code']).toContain('print(x)');
  });

  it('falls back to capabilityInvocation when sandboxExecution is not provided', async () => {
    const invoke = vi.fn(async () => ({
      status: 'SUCCEEDED' as const,
      structuredPayload: { exit_code: 0, stdout: 'fallback_ok', stderr: '', timed_out: false },
      generatedMessages: [],
      artifactRefs: [],
    }));
    const capabilityInvocation: CapabilityInvocationPort = { invoke };
    const service = createService({
      recipe: recipe({
        start: node('START', { python: {} }),
        python: node(
          'PYTHON',
          { end: {} },
          {
            inputs: { script: "print('ok')" },
            outputs: { result: '${python_result}' },
          },
        ),
        end: node('END'),
      }),
      nodeCatalog: createWorkflowNodeCatalog({ capabilityInvocation }),
    });

    const result = await service.execute(withInput({}), new AbortController().signal);

    expect(result.status).toBe('COMPLETED');
    expect(result.outputVariables).toMatchObject({ result: 'fallback_ok' });
    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it('surfaces sandbox denial errors from sandboxExecution path', async () => {
    const invoke = vi.fn();
    const capabilityInvocation: CapabilityInvocationPort = { invoke };
    const runPython = vi.fn(async () => {
      throw new Error('Sandbox denied');
    });
    const sandboxExecution: WorkflowSandboxExecutionPort = { runPython };
    const service = createService({
      recipe: recipe({
        start: node('START', { python: {} }),
        python: node(
          'PYTHON',
          { end: {} },
          {
            inputs: { script: 'import os' },
            outputs: { result: '${python_result}' },
          },
        ),
        end: node('END'),
      }),
      nodeCatalog: createWorkflowNodeCatalog({ capabilityInvocation, sandboxExecution }),
    });

    const result = await service.execute(withInput({}), new AbortController().signal);

    expect(result.status).toBe('FAILED');
    expect(invoke).not.toHaveBeenCalled();
  });
});

function createService(input: { readonly recipe: RecipeDefinition; readonly nodeCatalog: ReturnType<typeof createWorkflowNodeCatalog> }) {
  return createWorkflowExecutionService({
    resolveRecipeDefinition: () => input.recipe,
    nodeCatalog: input.nodeCatalog,
  });
}

function withInput(inputVariables: JsonObject): WorkflowExecutionRequest {
  return { ...baseRequest(), inputVariables };
}

function baseRequest(): WorkflowExecutionRequest {
  return {
    recipeName: 'workflow-python-sandbox-test',
    recipeVersion: 'v1',
    inputVariables: {},
    identityContext: {
      tenantId: brand<string, 'TenantId'>('tenant-python-sandbox'),
      subjectId: brand<string, 'SubjectId'>('subject-python-sandbox'),
      displayName: 'Python sandbox tester',
    },
    agentId: brand<string, 'AgentId'>('agent-python-sandbox'),
    agentVersion: brand<string, 'AgentVersion'>('v1'),
    sessionId: brand<string, 'SessionId'>('session-python-sandbox'),
    requestId: brand<string, 'MessageId'>('request-python-sandbox'),
    runId: brand<string, 'RequestRunId'>('run-python-sandbox'),
    requestContextId: brand<string, 'RequestContextId'>('context-python-sandbox'),
  };
}

function recipe(nodes: RecipeDefinition['flowGraph']['nodes']): RecipeDefinition {
  return {
    recipeName: 'workflow-python-sandbox-test',
    version: 'v1',
    displayName: 'Workflow python sandbox test',
    flowGraph: { nodes },
  };
}

function node(
  type: RecipeDefinition['flowGraph']['nodes'][string]['type'],
  next: Record<string, { readonly condition?: string }> = {},
  extras: Partial<Pick<RecipeDefinition['flowGraph']['nodes'][string], 'inputs' | 'outputs'>> = {},
) {
  return {
    type,
    next,
    ...(extras.inputs === undefined ? {} : { inputs: extras.inputs }),
    ...(extras.outputs === undefined ? {} : { outputs: extras.outputs }),
  };
}
