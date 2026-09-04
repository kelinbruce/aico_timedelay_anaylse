import { modelEventStreamFixture } from '../../../tests/helpers/model-stream-fixture.js';
import { brand, type JsonObject, type JsonValue } from '@nextagent/agent-common';
import type {
  CapabilityInvocationPort,
  CapabilityInvocationRequest,
  CapabilityInvocationResult,
  RuntimeCapabilityResolver,
} from '@nextagent/agent-contracts/capability';
import type { CapabilityDescriptor } from '@nextagent/agent-contracts/capability';
import type { RecipeDefinition, WorkflowExecutionEvent, WorkflowExecutionRequest } from '@nextagent/agent-contracts/core';
import type { ModelFinalResult, ModelInvocationRequest, ModelInvocationService, ModelStreamDelta } from '@nextagent/agent-contracts/model';
import type { ExecutionCorrelationPort } from '@nextagent/agent-contracts/observability';
import { describe, expect, it, vi } from 'vitest';
import { createWorkflowExecutionService, createWorkflowNodeCatalog } from '../src/index.js';

describe('workflow capability nodes', () => {
  it('uses the workflow node scope without synthesizing a nested capability lifecycle', async () => {
    const activeKinds: string[] = [];
    const executionCorrelation: ExecutionCorrelationPort = {
      async withIncomingCarrier(_carrier, operation) {
        return operation();
      },
      async withExecutionRef(ref, operation) {
        activeKinds.push(ref.kind);
        try {
          return await operation();
        } finally {
          activeKinds.pop();
        }
      },
      outboundHeaders(input = {}) {
        return input;
      },
    };
    const capabilityInvocation = capabilityPort(async () => {
      expect(activeKinds).toEqual(['WORKFLOW_NODE']);
      return succeeded({ status: 'ok' });
    });
    const service = createService({
      recipe: recipe({
        start: node('START', { api: {} }),
        api: node(
          'RESTFUL',
          { end: {} },
          {
            inputs: { api_name: 'weather_query' },
          },
        ),
        end: node('END'),
      }),
      executionCorrelation,
      nodeCatalog: createWorkflowNodeCatalog({
        capabilityInvocation,
      }),
    });

    await service.execute(baseRequest(), new AbortController().signal);
  });

  it('resolves secret references for restful nodes before invocation', async () => {
    const capabilityInvocation = capabilityPort(async (request) => {
      expect(request.capabilityId).toBe('weather_query');
      expect(request.arguments).toEqual({
        request_header: { Authorization: 'Bearer workflow-secret' },
        city: 'Shanghai',
      });
      return succeeded({ status: 'ok' });
    });
    const service = createService({
      recipe: recipe({
        start: node('START', { api: {} }),
        api: node(
          'RESTFUL',
          { end: {} },
          {
            inputs: {
              api_name: 'weather_query',
              request_header: { Authorization: 'env:WF_TOKEN' },
              city: '${city}',
            },
            outputs: { elementVariables: '${api_response}' },
          },
        ),
        end: node('END'),
      }),
      nodeCatalog: createWorkflowNodeCatalog({
        capabilityInvocation,
        resolveSecretReference: async (reference) => {
          expect(reference).toBe('env:WF_TOKEN');
          return 'Bearer workflow-secret';
        },
      }),
    });

    const result = await service.execute(withInput({ city: 'Shanghai' }), new AbortController().signal);

    expect(result.status).toBe('COMPLETED');
    expect(result.outputVariables).toMatchObject({
      elementVariables: {
        status: 'ok',
        _trace: { capabilityId: 'weather_query', nodeId: 'api', retryCount: 0 },
      },
    });
  });

  it('passes model as a business parameter to the capability args', async () => {
    const capabilityInvocation = capabilityPort(async (request) => {
      expect(request.capabilityId).toBe('chat_completions');
      expect(request.arguments).toEqual({
        model: 'deepseek-v3',
        messages: [{ role: 'user', content: 'hello' }],
        max_tokens: 10000,
      });
      return succeeded({ status: 'ok' });
    });
    const service = createService({
      recipe: recipe({
        start: node('START', { api: {} }),
        api: node(
          'RESTFUL',
          { end: {} },
          {
            inputs: {
              api_name: 'chat_completions',
              model: 'deepseek-v3',
              messages: [{ role: 'user', content: 'hello' }],
              max_tokens: 10000,
            },
            outputs: { elementVariables: '${api_response}' },
          },
        ),
        end: node('END'),
      }),
      nodeCatalog: createWorkflowNodeCatalog({ capabilityInvocation }),
    });

    const result = await service.execute(withInput({}), new AbortController().signal);

    expect(result.status).toBe('COMPLETED');
  });

  it('strips modelGroup from capability args but keeps model for param extract', async () => {
    const capabilityInvocation = capabilityPort(async (request) => {
      expect(request.capabilityId).toBe('chat_completions');
      expect(request.arguments.model).toBe('deepseek-v3');
      expect(request.arguments).not.toHaveProperty('modelGroup');
      return succeeded({ status: 'ok' });
    });
    const service = createService({
      recipe: recipe({
        start: node('START', { api: {} }),
        api: node(
          'RESTFUL',
          { end: {} },
          {
            inputs: {
              api_name: 'chat_completions',
              model: 'deepseek-v3',
              modelGroup: 'reasoning',
              messages: [{ role: 'user', content: 'hello' }],
            },
            outputs: { elementVariables: '${api_response}' },
          },
        ),
        end: node('END'),
      }),
      nodeCatalog: createWorkflowNodeCatalog({ capabilityInvocation }),
    });

    const result = await service.execute(withInput({}), new AbortController().signal);

    expect(result.status).toBe('COMPLETED');
  });

  it('redacts resolved secret values from restful safe output', async () => {
    const capabilityInvocation = capabilityPort(async () =>
      succeeded({
        status: 'ok',
        echoed_header: 'Bearer workflow-secret',
      }),
    );
    const service = createService({
      recipe: recipe({
        start: node('START', { api: {} }),
        api: node(
          'RESTFUL',
          { end: {} },
          {
            inputs: {
              api_name: 'weather_query',
              request_header: { Authorization: 'env:WF_TOKEN' },
            },
            outputs: { elementVariables: '${api_response}' },
          },
        ),
        end: node('END'),
      }),
      nodeCatalog: createWorkflowNodeCatalog({
        capabilityInvocation,
        resolveSecretReference: async () => 'Bearer workflow-secret',
      }),
    });

    const result = await service.execute(baseRequest(), new AbortController().signal);

    expect(result.status).toBe('COMPLETED');
    expect(result.outputVariables).toMatchObject({
      elementVariables: {
        status: 'ok',
        echoed_header: '[REDACTED]',
        _trace: { capabilityId: 'weather_query', nodeId: 'api', retryCount: 0 },
      },
    });
  });

  it('executes the demo recipe restful branch and maps llm_completion', async () => {
    const capabilityInvocation = capabilityPort(async (request) => {
      expect(request.capabilityId).toBe('weather_query');
      return succeeded({
        '0': 'sunny',
        result: 'sunny',
        description: 'sunny weather for field work',
      });
    });
    const modelRequests: ModelInvocationRequest[] = [];
    const model: ModelInvocationService = {
      async complete(request) {
        modelRequests.push(request);
        return { content: 'Weather is sunny, travel is suitable.' };
      },
      stream: modelEventStreamFixture(async function* (request) {
        modelRequests.push(request);
        yield { content: 'Weather is sunny, travel is suitable.', finishReason: 'stop' };
      }),
    };
    const service = createService({
      recipe: {
        recipeName: 'demo_recipe',
        version: '1.1.0',
        displayName: 'demo_recipe',
        flowGraph: {
          nodes: {
            start_node: node('START', { ext_api: { condition: '' } }),
            ext_api: node(
              'RESTFUL',
              {
                last_llm: { condition: '${elementVariables[0] == "sunny"}' },
                end_node: { condition: '${elementVariables[0] != "sunny"}' },
              },
              {
                inputs: { api_name: 'weather_query' },
                outputs: { elementVariables: '${api_response}' },
              },
            ),
            last_llm: node(
              'LLM_ROUTER',
              { end_node: { condition: '' } },
              {
                inputs: {
                  llm_type: 'NetGPT',
                  prompt_template: 'Use weather status ${elementVariables} and user question ${input_question} to give travel advice.',
                },
                outputs: { result: '${llm_completion}' },
              },
            ),
            end_node: node('END'),
          },
        },
      },
      nodeCatalog: createWorkflowNodeCatalog({
        capabilityInvocation,
        modelInvocation: model,
        resolveModelInvocationConfig: async () => ({
          modelId: 'deterministic-test-model',
          contextWindowTokens: 128_000,
          inferenceOptions: {},
          timeoutMs: 30_000,
          maxRetries: 2,
        }),
      }),
    });

    const result = await service.execute(
      {
        ...baseRequest(),
        recipeName: 'demo_recipe',
        recipeVersion: '1.1.0',
        inputVariables: { input_question: 'Can I travel?' },
      },
      new AbortController().signal,
    );

    expect(result.status).toBe('COMPLETED');
    expect(result.nodeResults.map((item) => item.nodeId)).toEqual(['start_node', 'ext_api', 'last_llm', 'end_node']);
    expect(result.outputVariables).toMatchObject({
      elementVariables: { '0': 'sunny', result: 'sunny' },
      result: 'Weather is sunny, travel is suitable.',
    });
    expect(modelRequests[0]?.messages[0]?.content[0]).toMatchObject({
      type: 'text',
      text: expect.stringContaining('Can I travel?'),
    });
  });
  it('fails restful nodes when secret references cannot be resolved safely', async () => {
    const capabilityInvocation = capabilityPort(async () => succeeded({ status: 'unexpected' }));
    const service = createService({
      recipe: recipe({
        start: node('START', { api: {} }),
        api: node(
          'RESTFUL',
          { end: {} },
          {
            inputs: {
              api_name: 'weather_query',
              request_header: { Authorization: 'env:WF_TOKEN' },
            },
            outputs: { elementVariables: '${api_response}' },
          },
        ),
        end: node('END'),
      }),
      nodeCatalog: createWorkflowNodeCatalog({ capabilityInvocation }),
    });

    const result = await service.execute(baseRequest(), new AbortController().signal);

    expect(result.status).toBe('FAILED');
    expect(result.nodeResults.find((item) => item.nodeId === 'api')).toMatchObject({
      status: 'NODE_FAILED',
      safeError: {
        code: 'WORKFLOW_SECRET_RESOLUTION_UNAVAILABLE',
        category: 'UNAVAILABLE',
        retryable: false,
      },
    });
    expect(capabilityInvocation.invoke).not.toHaveBeenCalled();
  });

  it('routes python nodes through the governed Python capability', async () => {
    const capabilityInvocation = capabilityPort(async (request) => {
      expect(request.capabilityId).toBe('Python');
      expect(request.arguments).toEqual({
        code: "print('ok')",
        preamble: 'extra_param="NE-1"',
        args: [],
      });
      return succeeded({ exit_code: 0, stdout: 'ok', stderr: '', timed_out: false });
    });
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
      nodeCatalog: createWorkflowNodeCatalog({ capabilityInvocation }),
    });

    const result = await service.execute(withInput({ neId: 'NE-1' }), new AbortController().signal);

    expect(result.status).toBe('COMPLETED');
    expect(result.outputVariables).toMatchObject({
      result: 'ok',
    });
  });

  it('injects None for undefined Python input variables (Fix #9)', async () => {
    const capabilityInvocation = capabilityPort(async (request) => {
      expect(request.capabilityId).toBe('Python');
      expect(request.arguments).toEqual({
        code: "print('ok')",
        preamble: 'missing_var=None',
        args: [],
      });
      return succeeded({ exit_code: 0, stdout: 'ok', stderr: '', timed_out: false });
    });
    const service = createService({
      recipe: recipe({
        start: node('START', { python: {} }),
        python: node(
          'PYTHON',
          { end: {} },
          {
            inputs: { script: "print('ok')", missing_var: '${nonexistent}' },
            outputs: { result: '${python_result}' },
          },
        ),
        end: node('END'),
      }),
      nodeCatalog: createWorkflowNodeCatalog({ capabilityInvocation }),
    });

    const result = await service.execute(withInput({}), new AbortController().signal);

    expect(result.status).toBe('COMPLETED');
  });

  it('surfaces safe sandbox denial errors from the governed Python capability', async () => {
    const capabilityInvocation = capabilityPort(async () => ({
      status: 'FAILED',
      structuredPayload: {},
      generatedMessages: [],
      artifactRefs: [],
      safeError: {
        code: 'SANDBOX_DENIED',
        message: 'Sandbox denied the workflow script.',
        category: 'AUTHORIZATION',
        retryable: false,
        safeDetails: { reasonCode: 'SANDBOX_DENIED' },
      },
    }));
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
      nodeCatalog: createWorkflowNodeCatalog({ capabilityInvocation }),
    });

    const result = await service.execute(baseRequest(), new AbortController().signal);

    expect(result.status).toBe('FAILED');
    expect(result.nodeResults.find((item) => item.nodeId === 'python')).toMatchObject({
      status: 'NODE_FAILED',
      safeError: {
        code: 'SANDBOX_DENIED',
        category: 'AUTHORIZATION',
        retryable: false,
      },
    });
  });

  it('expands JSON object stdout fields into python_result for variable projection', async () => {
    const capabilityInvocation = capabilityPort(async (request, _signal, runtimeContext) => {
      expect(request.capabilityId).toBe('Python');
      expect(runtimeContext?.emitPolicyApplied).toBeDefined();
      return succeeded({
        exit_code: 0,
        stdout: JSON.stringify({ alarm_count: 3, site_list: ['NE-1', 'NE-2'] }),
        stderr: '',
        timed_out: false,
      });
    });
    const service = createService({
      recipe: recipe({
        start: node('START', { python: {} }),
        python: node(
          'PYTHON',
          { end: {} },
          {
            inputs: { script: 'print(json.dumps({}))' },
            outputs: {
              alarm_count: '${python_result.alarm_count}',
              site_list: '${python_result.site_list}',
            },
          },
        ),
        end: node('END'),
      }),
      nodeCatalog: createWorkflowNodeCatalog({ capabilityInvocation }),
    });

    const result = await service.execute(withInput({}), new AbortController().signal);

    expect(result.status).toBe('COMPLETED');
    expect(result.outputVariables).toMatchObject({
      alarm_count: 3,
      site_list: ['NE-1', 'NE-2'],
    });
  });

  it('does not expand non-JSON stdout and preserves reserved keys', async () => {
    const capabilityInvocation = capabilityPort(async () => {
      return succeeded({
        exit_code: 0,
        stdout: 'plain text output',
        stderr: '',
        timed_out: false,
      });
    });
    const service = createService({
      recipe: recipe({
        start: node('START', { python: {} }),
        python: node(
          'PYTHON',
          { end: {} },
          {
            inputs: { script: "print('plain')" },
            outputs: { result: '${python_result}' },
          },
        ),
        end: node('END'),
      }),
      nodeCatalog: createWorkflowNodeCatalog({ capabilityInvocation }),
    });

    const result = await service.execute(withInput({}), new AbortController().signal);

    expect(result.status).toBe('COMPLETED');
    expect(result.outputVariables).toMatchObject({
      result: 'plain text output',
    });
  });

  it('injects parameters as type-mapped Python literals in normal mode', async () => {
    const capabilityInvocation = capabilityPort(async (request) => {
      expect(request.capabilityId).toBe('Python');
      expect(request.arguments).toEqual({
        code: "print('done')",
        preamble: [
          'null_val=None',
          'true_val=True',
          'false_val=False',
          'int_val=42',
          'float_val=3.14',
          'num_str=42',
          'str_val="hello"',
          'obj_val={"k": "v"}',
          'arr_val=[1, 2]',
        ].join('\n'),
        args: [],
      });
      return succeeded({ exit_code: 0, stdout: 'done', stderr: '', timed_out: false });
    });
    const service = createService({
      recipe: recipe({
        start: node('START', { python: {} }),
        python: node(
          'PYTHON',
          { end: {} },
          {
            inputs: {
              script: "print('done')",
              null_val: null,
              true_val: true,
              false_val: false,
              int_val: 42,
              float_val: 3.14,
              num_str: '42',
              str_val: 'hello',
              obj_val: { k: 'v' },
              arr_val: [1, 2],
            },
            outputs: { result: '${python_result}' },
          },
        ),
        end: node('END'),
      }),
      nodeCatalog: createWorkflowNodeCatalog({ capabilityInvocation }),
    });

    const result = await service.execute(withInput({}), new AbortController().signal);

    expect(result.status).toBe('COMPLETED');
    expect(result.outputVariables).toMatchObject({ result: 'done' });
  });

  it('injects nested booleans and nulls as Python literals in normal mode', async () => {
    const capabilityInvocation = capabilityPort(async (request) => {
      expect(request.capabilityId).toBe('Python');
      expect(request.arguments).toEqual({
        code: "print('ok')",
        preamble: [
          'mixed_obj={"kpi": None, "energy": False, "configure": True, "name": "test"}',
          'nested_arr=[True, False, None, 42]',
          'deep_obj={"outer": {"inner": False, "val": None}}',
        ].join('\n'),
        args: [],
      });
      return succeeded({ exit_code: 0, stdout: 'ok', stderr: '', timed_out: false });
    });
    const service = createService({
      recipe: recipe({
        start: node('START', { python: {} }),
        python: node(
          'PYTHON',
          { end: {} },
          {
            inputs: {
              script: "print('ok')",
              mixed_obj: { kpi: null, energy: false, configure: true, name: 'test' },
              nested_arr: [true, false, null, 42],
              deep_obj: { outer: { inner: false, val: null } },
            },
            outputs: { result: '${python_result}' },
          },
        ),
        end: node('END'),
      }),
      nodeCatalog: createWorkflowNodeCatalog({ capabilityInvocation }),
    });

    const result = await service.execute(withInput({}), new AbortController().signal);

    expect(result.status).toBe('COMPLETED');
    expect(result.outputVariables).toMatchObject({ result: 'ok' });
  });

  it('preserves string content containing null/true/false in normal mode', async () => {
    const capabilityInvocation = capabilityPort(async (request) => {
      expect(request.capabilityId).toBe('Python');
      expect(request.arguments).toEqual({
        code: "print('ok')",
        preamble: [
          'str_null="this is null text"',
          'str_bool="value is true here"',
          'obj_with_str={"msg": "null is not None here", "flag": "true"}',
        ].join('\n'),
        args: [],
      });
      return succeeded({ exit_code: 0, stdout: 'ok', stderr: '', timed_out: false });
    });
    const service = createService({
      recipe: recipe({
        start: node('START', { python: {} }),
        python: node(
          'PYTHON',
          { end: {} },
          {
            inputs: {
              script: "print('ok')",
              str_null: 'this is null text',
              str_bool: 'value is true here',
              obj_with_str: { msg: 'null is not None here', flag: 'true' },
            },
            outputs: { result: '${python_result}' },
          },
        ),
        end: node('END'),
      }),
      nodeCatalog: createWorkflowNodeCatalog({ capabilityInvocation }),
    });

    const result = await service.execute(withInput({}), new AbortController().signal);

    expect(result.status).toBe('COMPLETED');
    expect(result.outputVariables).toMatchObject({ result: 'ok' });
  });

  it('resolves numeric print output as parsed number (spec normal mode scenario)', async () => {
    const capabilityInvocation = capabilityPort(async (request) => {
      expect(request.capabilityId).toBe('Python');
      expect(request.arguments).toEqual({
        code: 'print(x)',
        preamble: 'x=10',
        args: [],
      });
      return succeeded({ exit_code: 0, stdout: '10', stderr: '', timed_out: false });
    });
    const service = createService({
      recipe: recipe({
        start: node('START', { python: {} }),
        python: node(
          'PYTHON',
          { end: {} },
          {
            inputs: { script: 'print(x)', x: 10 },
            outputs: { result: '${python_result}' },
          },
        ),
        end: node('END'),
      }),
      nodeCatalog: createWorkflowNodeCatalog({ capabilityInvocation }),
    });

    const result = await service.execute(withInput({}), new AbortController().signal);

    expect(result.status).toBe('COMPLETED');
    expect(result.outputVariables).toMatchObject({ result: 10 });
  });

  it('injects parameters as JSON string mode when param_to_json_str is true', async () => {
    const capabilityInvocation = capabilityPort(async (request) => {
      expect(request.capabilityId).toBe('Python');
      expect(request.arguments).toEqual({
        code: "print('ok')",
        preamble: ["x=r'''{\"k\":\"v\"}'''", "n=r'''42'''"].join('\n'),
        args: [],
      });
      return succeeded({ exit_code: 0, stdout: 'ok', stderr: '', timed_out: false });
    });
    const service = createService({
      recipe: recipe({
        start: node('START', { python: {} }),
        python: node(
          'PYTHON',
          { end: {} },
          {
            inputs: {
              script: "print('ok')",
              param_to_json_str: true,
              x: { k: 'v' },
              n: 42,
            },
            outputs: { result: '${python_result}' },
          },
        ),
        end: node('END'),
      }),
      nodeCatalog: createWorkflowNodeCatalog({ capabilityInvocation }),
    });

    const result = await service.execute(withInput({}), new AbortController().signal);

    expect(result.status).toBe('COMPLETED');
    expect(result.outputVariables).toMatchObject({ result: 'ok' });
  });

  it('injects nested booleans and nulls as JSON strings in json_str mode', async () => {
    const capabilityInvocation = capabilityPort(async (request) => {
      expect(request.capabilityId).toBe('Python');
      expect(request.arguments).toEqual({
        code: "print('ok')",
        preamble: [
          'mixed_obj=r\'\'\'{"kpi":null,"energy":false,"configure":true,"name":"test"}\'\'\'',
          "nested_arr=r'''[true,false,null,42]'''",
          'deep_obj=r\'\'\'{"outer":{"inner":false,"val":null}}\'\'\'',
        ].join('\n'),
        args: [],
      });
      return succeeded({ exit_code: 0, stdout: 'ok', stderr: '', timed_out: false });
    });
    const service = createService({
      recipe: recipe({
        start: node('START', { python: {} }),
        python: node(
          'PYTHON',
          { end: {} },
          {
            inputs: {
              script: "print('ok')",
              param_to_json_str: true,
              mixed_obj: { kpi: null, energy: false, configure: true, name: 'test' },
              nested_arr: [true, false, null, 42],
              deep_obj: { outer: { inner: false, val: null } },
            },
            outputs: { result: '${python_result}' },
          },
        ),
        end: node('END'),
      }),
      nodeCatalog: createWorkflowNodeCatalog({ capabilityInvocation }),
    });

    const result = await service.execute(withInput({}), new AbortController().signal);

    expect(result.status).toBe('COMPLETED');
    expect(result.outputVariables).toMatchObject({ result: 'ok' });
  });

  it('skips script and param_to_json_str keys from variable injection', async () => {
    const capabilityInvocation = capabilityPort(async (request) => {
      expect(request.capabilityId).toBe('Python');
      expect(request.arguments).toEqual({
        code: "print('ok')",
        preamble: 'real_var=10',
        args: [],
      });
      return succeeded({ exit_code: 0, stdout: 'ok', stderr: '', timed_out: false });
    });
    const service = createService({
      recipe: recipe({
        start: node('START', { python: {} }),
        python: node(
          'PYTHON',
          { end: {} },
          {
            inputs: {
              script: "print('ok')",
              param_to_json_str: false,
              real_var: 10,
            },
            outputs: { result: '${python_result}' },
          },
        ),
        end: node('END'),
      }),
      nodeCatalog: createWorkflowNodeCatalog({ capabilityInvocation }),
    });

    const result = await service.execute(withInput({}), new AbortController().signal);

    expect(result.status).toBe('COMPLETED');
  });

  it('resolves single JSON object print as parsed object', async () => {
    const capabilityInvocation = capabilityPort(async () => {
      return succeeded({
        exit_code: 0,
        stdout: '{"a":1}',
        stderr: '',
        timed_out: false,
      });
    });
    const service = createService({
      recipe: recipe({
        start: node('START', { python: {} }),
        python: node(
          'PYTHON',
          { end: {} },
          {
            inputs: { script: "print(json.dumps({'a':1}))" },
            outputs: { result: '${python_result}' },
          },
        ),
        end: node('END'),
      }),
      nodeCatalog: createWorkflowNodeCatalog({ capabilityInvocation }),
    });

    const result = await service.execute(withInput({}), new AbortController().signal);

    expect(result.status).toBe('COMPLETED');
    expect(result.outputVariables).toMatchObject({ result: { a: 1 } });
  });

  it('resolves multiple print outputs as a list', async () => {
    const capabilityInvocation = capabilityPort(async () => {
      return succeeded({
        exit_code: 0,
        stdout: '{"x":1}\nok',
        stderr: '',
        timed_out: false,
      });
    });
    const service = createService({
      recipe: recipe({
        start: node('START', { python: {} }),
        python: node(
          'PYTHON',
          { end: {} },
          {
            inputs: { script: "print('a'); print('b')" },
            outputs: { result: '${python_result}' },
          },
        ),
        end: node('END'),
      }),
      nodeCatalog: createWorkflowNodeCatalog({ capabilityInvocation }),
    });

    const result = await service.execute(withInput({}), new AbortController().signal);

    expect(result.status).toBe('COMPLETED');
    expect(result.outputVariables).toMatchObject({ result: [{ x: 1 }, 'ok'] });
  });

  it('resolves no print output as null', async () => {
    const capabilityInvocation = capabilityPort(async () => {
      return succeeded({
        exit_code: 0,
        stdout: '',
        stderr: '',
        timed_out: false,
      });
    });
    const service = createService({
      recipe: recipe({
        start: node('START', { python: {} }),
        python: node(
          'PYTHON',
          { end: {} },
          {
            inputs: { script: 'x = 1' },
            outputs: { result: '${python_result}' },
          },
        ),
        end: node('END'),
      }),
      nodeCatalog: createWorkflowNodeCatalog({ capabilityInvocation }),
    });

    const result = await service.execute(withInput({}), new AbortController().signal);

    expect(result.status).toBe('COMPLETED');
    expect(result.outputVariables).toMatchObject({ result: null });
  });

  it('excludes execution metadata from python_result', async () => {
    const capabilityInvocation = capabilityPort(async () => {
      return succeeded({
        exit_code: 0,
        stdout: 'hello',
        stderr: '',
        timed_out: false,
      });
    });
    const service = createService({
      recipe: recipe({
        start: node('START', { python: {} }),
        python: node(
          'PYTHON',
          { end: {} },
          {
            inputs: { script: "print('hello')" },
            outputs: { result: '${python_result}' },
          },
        ),
        end: node('END'),
      }),
      nodeCatalog: createWorkflowNodeCatalog({ capabilityInvocation }),
    });

    const result = await service.execute(withInput({}), new AbortController().signal);

    expect(result.status).toBe('COMPLETED');
    const py = result.outputVariables!.result as JsonObject;
    expect(py).toBe('hello');
    expect(py['exit_code']).toBeUndefined();
    expect(py['stderr']).toBeUndefined();
    expect(py['timed_out']).toBeUndefined();
    expect(py['_trace']).toBeUndefined();
  });

  it('keeps agent scope stable and invokes the governed Agent capability', async () => {
    const capabilityInvocation = capabilityPort(async (request, _signal, runtimeContext) => {
      expect(request.capabilityId).toBe('Agent');
      expect(request.agentId).toBe('agent-workflow');
      expect(request.identityContext.tenantId).toBe('tenant-workflow');
      expect(request.arguments).toEqual({
        agentId: 'ops-agent',
        prompt: 'Target recipe: triage-flow\n\nInvestigate alarm correlation',
      });
      expect(runtimeContext?.capabilityResolver).toBeDefined();
      return succeeded({ status: 'completed', result: { text: 'delegated' } });
    });
    const runtimeCapabilityResolver: RuntimeCapabilityResolver = {
      async resolveCapability() {
        return undefined;
      },
    };
    const service = createService({
      recipe: recipe({
        start: node('START', { agent: {} }),
        agent: node(
          'AGENT',
          { end: {} },
          {
            inputs: {
              agent_name: 'ops-agent',
              recipe_name: 'triage-flow',
              input_question: '${question}',
            },
            outputs: { delegated: '${agent_result}' },
          },
        ),
        end: node('END'),
      }),
      nodeCatalog: createWorkflowNodeCatalog({
        capabilityInvocation,
        runtimeCapabilityResolver: () => runtimeCapabilityResolver,
      }),
    });

    const result = await service.execute(withInput({ question: 'Investigate alarm correlation' }), new AbortController().signal);

    expect(result.status).toBe('COMPLETED');
    expect(result.outputVariables).toMatchObject({
      delegated: {
        status: 'completed',
        result: { text: 'delegated' },
        _trace: { capabilityId: 'Agent', nodeId: 'agent', retryCount: 0 },
      },
    });
  });

  it('selects a bounded tool candidate without invoking side effects', async () => {
    const capabilityInvocation = capabilityPort(async () => {
      throw new Error('tool-choice must not execute capabilities');
    });
    const modelRequests: ModelInvocationRequest[] = [];
    const model: ModelInvocationService = {
      async complete(request) {
        modelRequests.push(request);
        return {
          content: '',
          toolCalls: [
            {
              toolCallId: 'call-weather',
              toolName: 'weather_query',
              arguments: { city: 'Shanghai' },
            },
          ],
        };
      },
      stream: modelEventStreamFixture(async function* () {
        yield { content: '', finishReason: 'stop' };
      }),
    };
    const service = createService({
      recipe: recipe({
        start: node('START', { choose: {} }),
        choose: node(
          'TOOL_CHOICE',
          { end: {} },
          {
            inputs: {
              taskDescription: '查询天气',
              candidateTools: [
                {
                  capabilityId: 'weather_query',
                  description: 'Weather API',
                  inputSchema: { type: 'object', properties: { city: { type: 'string' } } },
                },
                {
                  capabilityId: 'alarm_query',
                  description: 'Alarm API',
                  inputSchema: { type: 'object', properties: { neId: { type: 'string' } } },
                },
              ],
            },
            outputs: { choice: '${tool_choice_result}' },
          },
        ),
        end: node('END'),
      }),
      nodeCatalog: createWorkflowNodeCatalog({
        capabilityInvocation,
        modelInvocation: model,
        resolveModelInvocationConfig: async () => ({
          modelId: 'deterministic-test-model',
          contextWindowTokens: 128_000,
          inferenceOptions: {},
          timeoutMs: 30_000,
          maxRetries: 2,
        }),
      }),
    });

    const result = await service.execute(baseRequest(), new AbortController().signal);

    expect(result.status).toBe('COMPLETED');
    expect(modelRequests).toHaveLength(1);
    expect(result.outputVariables).toEqual({
      choice: {
        selectedToolId: 'weather_query',
        mappedArguments: { city: 'Shanghai' },
      },
    });
  });
  it('polls a long-task restful API and collects results in order', async () => {
    const responses = [
      succeeded({ state: 'running', request_id: 'req-1' }),
      succeeded({ state: 'running', request_id: 'req-1' }),
      succeeded({ state: 'done', request_id: 'req-1', result: { ok: true } }),
    ];
    const capabilityInvocation = capabilityPort(async () => responses.shift() ?? succeeded({ state: 'done' }));
    const service = createService({
      recipe: recipe({
        start: node('START', { poll: {} }),
        poll: node(
          'RESTFUL',
          { end: {} },
          {
            inputs: {
              api_name: 'long_diag',
              is_long_api: true,
              poll_max_times: 3,
              poll_interval: 0,
            },
            outputs: { elementVariables: '${poll_results}' },
          },
        ),
        end: node('END'),
      }),
      nodeCatalog: createWorkflowNodeCatalog({ capabilityInvocation }),
    });

    const result = await service.execute(baseRequest(), new AbortController().signal);

    expect(result.status).toBe('COMPLETED');
    const pollResults = result.outputVariables.elementVariables as unknown[];
    expect(pollResults).toHaveLength(3);
    expect((pollResults[0] as { state: string }).state).toBe('running');
    expect((pollResults[2] as { result: { ok: boolean } }).result.ok).toBe(true);
  });

  it('terminates long-task polling on API error by default', async () => {
    const capabilityInvocation = capabilityPort(async () => failed('WORKFLOW_CAPABILITY_FAILED', 'boom'));
    const service = createService({
      recipe: recipe({
        start: node('START', { poll: {} }),
        poll: node(
          'RESTFUL',
          { end: {} },
          {
            inputs: {
              api_name: 'long_diag',
              is_long_api: true,
              poll_max_times: 3,
              poll_interval: 0,
            },
          },
        ),
        end: node('END'),
      }),
      nodeCatalog: createWorkflowNodeCatalog({ capabilityInvocation }),
    });

    const result = await service.execute(baseRequest(), new AbortController().signal);

    expect(result.status).toBe('FAILED');
    expect(result.nodeResults.find((item) => item.nodeId === 'poll')?.safeError?.code).toBe('WORKFLOW_CAPABILITY_FAILED');
  });

  it('skips poll errors and continues when on_poll_error is skip', async () => {
    const responses = [
      succeeded({ state: 'running' }),
      failed('WORKFLOW_CAPABILITY_FAILED', 'transient'),
      succeeded({ state: 'done', result: { ok: true } }),
    ];
    const capabilityInvocation = capabilityPort(async () => responses.shift() ?? succeeded({ state: 'done' }));
    const service = createService({
      recipe: recipe({
        start: node('START', { poll: {} }),
        poll: node(
          'RESTFUL',
          { end: {} },
          {
            inputs: {
              api_name: 'long_diag',
              is_long_api: true,
              poll_max_times: 3,
              poll_interval: 0,
              on_poll_error: 'skip',
            },
            outputs: { elementVariables: '${poll_results}' },
          },
        ),
        end: node('END'),
      }),
      nodeCatalog: createWorkflowNodeCatalog({ capabilityInvocation }),
    });

    const result = await service.execute(baseRequest(), new AbortController().signal);

    expect(result.status).toBe('COMPLETED');
    const pollResults = result.outputVariables.elementVariables as unknown[];
    expect(pollResults).toHaveLength(3);
    const failedEntry = pollResults[1] as { poll_failed: boolean; code: string };
    expect(failedEntry.poll_failed).toBe(true);
    expect(failedEntry.code).toBe('WORKFLOW_CAPABILITY_FAILED');
  });

  it('stops polling when poll_timeout deadline is reached', async () => {
    const capabilityInvocation = capabilityPort(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
      return succeeded({ state: 'running' });
    });
    const service = createService({
      recipe: recipe({
        start: node('START', { poll: {} }),
        poll: node(
          'RESTFUL',
          { end: {} },
          {
            inputs: {
              api_name: 'long_diag',
              is_long_api: true,
              poll_max_times: 100,
              poll_interval: 0,
              poll_timeout: 1,
            },
            outputs: { elementVariables: '${poll_results}' },
          },
        ),
        end: node('END'),
      }),
      nodeCatalog: createWorkflowNodeCatalog({ capabilityInvocation }),
    });

    const result = await service.execute(baseRequest(), new AbortController().signal);

    expect(result.status).toBe('COMPLETED');
    const pollResults = result.outputVariables.elementVariables as unknown[];
    expect(pollResults.length).toBeLessThan(100);
    expect(pollResults.length).toBeGreaterThan(0);
  });

  it('aborts long-task polling immediately when AbortSignal fires', async () => {
    const controller = new AbortController();
    let calls = 0;
    const capabilityInvocation = capabilityPort(async () => {
      calls += 1;
      if (calls === 1) {
        controller.abort();
        return succeeded({ state: 'running' });
      }
      return succeeded({ state: 'done' });
    });
    const service = createService({
      recipe: recipe({
        start: node('START', { poll: {} }),
        poll: node(
          'RESTFUL',
          { end: {} },
          {
            inputs: {
              api_name: 'long_diag',
              is_long_api: true,
              poll_max_times: 5,
              poll_interval: 0,
            },
          },
        ),
        end: node('END'),
      }),
      nodeCatalog: createWorkflowNodeCatalog({ capabilityInvocation }),
    });

    const result = await service.execute(baseRequest(), controller.signal);

    expect(result.status).toBe('INTERRUPTED');
    expect(calls).toBe(1);
  });

  it('fails when long-task polling deadline expires before any result', async () => {
    const capabilityInvocation = capabilityPort(async () => {
      await new Promise((resolve) => setTimeout(resolve, 1200));
      return succeeded({ state: 'running' });
    });
    const service = createService({
      recipe: recipe({
        start: node('START', { poll: {} }),
        poll: node(
          'RESTFUL',
          { end: {} },
          {
            inputs: {
              api_name: 'long_diag',
              is_long_api: true,
              poll_max_times: 3,
              poll_interval: 0,
              poll_timeout: 1,
            },
          },
        ),
        end: node('END'),
      }),
      nodeCatalog: createWorkflowNodeCatalog({ capabilityInvocation }),
    });

    const result = await service.execute(baseRequest(), new AbortController().signal);

    expect(result.status).toBe('FAILED');
    expect(result.nodeResults.find((item) => item.nodeId === 'poll')?.safeError?.code).toBe('WORKFLOW_RESTFUL_POLL_NO_RESULTS');
  });

  it('propagates child agent failure through the failure priority chain', async () => {
    const capabilityInvocation = capabilityPort(async () => failed('WORKFLOW_AGENT_FAILED', 'child agent crashed'));
    const service = createService({
      recipe: recipe({
        start: node('START', { agent: {} }),
        agent: node(
          'AGENT',
          { end: {} },
          {
            inputs: { agent_name: 'ops-agent', input_question: '${question}' },
          },
        ),
        end: node('END'),
      }),
      nodeCatalog: createWorkflowNodeCatalog({ capabilityInvocation }),
    });

    const result = await service.execute(withInput({ question: 'Investigate' }), new AbortController().signal);

    expect(result.status).toBe('FAILED');
    expect(result.nodeResults.find((item) => item.nodeId === 'agent')?.safeError?.code).toBe('WORKFLOW_AGENT_FAILED');
  });

  it('executes restful batch in serial mode with append merge', async () => {
    const invoked = vi.fn(async (request: CapabilityInvocationRequest) => {
      const element = request.arguments.element as { ne_id: string };
      return succeeded({ ne_id: element.ne_id, status: 'checked' });
    });
    const capabilityInvocation: CapabilityInvocationPort = { invoke: invoked };
    const service = createService({
      recipe: recipe({
        start: node('START', { api: {} }),
        api: node(
          'RESTFUL',
          { end: {} },
          {
            inputs: {
              api_name: 'alarm_query',
            },
            batchConfig: {
              batchInputDataItem: [{ ne_id: 'NE-1' }, { ne_id: 'NE-2' }, { ne_id: 'NE-3' }] as unknown as readonly JsonValue[],
              batchElementVariable: 'element',
            },
            outputs: { results: '${batch_results}', last: '${api_response}' },
          },
        ),
        end: node('END'),
      }),
      nodeCatalog: createWorkflowNodeCatalog({ capabilityInvocation }),
    });

    const result = await service.execute(baseRequest(), new AbortController().signal);

    expect(result.status).toBe('COMPLETED');
    expect(invoked).toHaveBeenCalledTimes(3);
    const batchResults = result.outputVariables.results as unknown[];
    expect(batchResults).toHaveLength(3);
    expect((batchResults[0] as { ne_id: string }).ne_id).toBe('NE-1');
    expect((batchResults[2] as { ne_id: string }).ne_id).toBe('NE-3');
    const apiResponse = result.outputVariables.last as { ne_id: string };
    expect(apiResponse.ne_id).toBe('NE-3');
  });

  it('executes restful batch in parallel mode with limited concurrency', async () => {
    let activeCalls = 0;
    let maxConcurrent = 0;
    const invoked = vi.fn(async (request: CapabilityInvocationRequest) => {
      activeCalls++;
      maxConcurrent = Math.max(maxConcurrent, activeCalls);
      await new Promise((resolve) => setTimeout(resolve, 10));
      activeCalls--;
      const element = request.arguments.element as { ne_id: string };
      return succeeded({ ne_id: element.ne_id, status: 'checked' });
    });
    const capabilityInvocation: CapabilityInvocationPort = { invoke: invoked };
    const service = createService({
      recipe: recipe({
        start: node('START', { api: {} }),
        api: node(
          'RESTFUL',
          { end: {} },
          {
            inputs: {
              api_name: 'alarm_query',
            },
            batchConfig: {
              batchInputDataItem: Array.from({ length: 6 }, (_, i) => ({ ne_id: `NE-${i + 1}` })) as unknown as readonly JsonValue[],
              batchElementVariable: 'element',
              batchSize: 2,
              batchMode: 'parallel',
              batchParallelism: 2,
            },
            outputs: { results: '${batch_results}' },
          },
        ),
        end: node('END'),
      }),
      nodeCatalog: createWorkflowNodeCatalog({ capabilityInvocation }),
    });

    const result = await service.execute(baseRequest(), new AbortController().signal);

    expect(result.status).toBe('COMPLETED');
    expect(invoked).toHaveBeenCalledTimes(6);
    expect(maxConcurrent).toBeLessThanOrEqual(2);
    const batchResults = result.outputVariables.results as unknown[];
    expect(batchResults).toHaveLength(6);
  });

  it('parallel batchParallelism controls element-level concurrency even when items fit in one batch', async () => {
    let activeCalls = 0;
    let maxConcurrent = 0;
    const invoked = vi.fn(async (request: CapabilityInvocationRequest) => {
      activeCalls++;
      maxConcurrent = Math.max(maxConcurrent, activeCalls);
      await new Promise((resolve) => setTimeout(resolve, 10));
      activeCalls--;
      const element = request.arguments.element as { ne_id: string };
      return succeeded({ ne_id: element.ne_id, status: 'checked' });
    });
    const capabilityInvocation: CapabilityInvocationPort = { invoke: invoked };
    const service = createService({
      recipe: recipe({
        start: node('START', { api: {} }),
        api: node(
          'RESTFUL',
          { end: {} },
          {
            inputs: {
              api_name: 'alarm_query',
            },
            batchConfig: {
              batchInputDataItem: Array.from({ length: 4 }, (_, i) => ({ ne_id: `NE-${i + 1}` })),
              batchElementVariable: 'element',
              batchSize: 10,
              batchMode: 'parallel',
              batchParallelism: 2,
            },
            outputs: { results: '${batch_results}' },
          },
        ),
        end: node('END'),
      }),
      nodeCatalog: createWorkflowNodeCatalog({ capabilityInvocation }),
    });

    const result = await service.execute(baseRequest(), new AbortController().signal);

    expect(result.status).toBe('COMPLETED');
    expect(invoked).toHaveBeenCalledTimes(4);
    expect(maxConcurrent).toBe(2);
    const batchResults = result.outputVariables.results as unknown[];
    expect(batchResults).toHaveLength(4);
  });

  it('aborts parallel batch on failure without starting remaining elements', async () => {
    let callCount = 0;
    const invoked = vi.fn(async (request: CapabilityInvocationRequest) => {
      callCount++;
      if (callCount === 1) {
        return failed('ALARM_QUERY_FAILED', 'timeout');
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
      const element = request.arguments.element as { ne_id: string };
      return succeeded({ ne_id: element.ne_id, status: 'ok' });
    });
    const capabilityInvocation: CapabilityInvocationPort = { invoke: invoked };
    const service = createService({
      recipe: recipe({
        start: node('START', { api: {} }),
        api: node(
          'RESTFUL',
          { end: {} },
          {
            inputs: {
              api_name: 'alarm_query',
            },
            batchConfig: {
              batchInputDataItem: [{ ne_id: 'NE-1' }, { ne_id: 'NE-2' }, { ne_id: 'NE-3' }, { ne_id: 'NE-4' }, { ne_id: 'NE-5' }],
              batchElementVariable: 'element',
              batchSize: 10,
              batchMode: 'parallel',
              batchParallelism: 2,
              batchFailStrategy: 'abort',
            },
            outputs: { results: '${batch_results}', failures: '${failed_items}', last: '${api_response}' },
          },
        ),
        end: node('END'),
      }),
      nodeCatalog: createWorkflowNodeCatalog({ capabilityInvocation }),
    });

    const result = await service.execute(baseRequest(), new AbortController().signal);

    expect(result.status).toBe('FAILED');
    const failedItems = result.outputVariables.failures as unknown[];
    expect(failedItems).toHaveLength(1);
    const apiNode = result.nodeResults.find((item) => item.nodeId === 'api');
    expect(apiNode?.status).toBe('NODE_FAILED');
    expect(callCount).toBeLessThanOrEqual(2);
  });

  it('continues batch on failure when failStrategy is continue', async () => {
    const responses = [
      succeeded({ ne_id: 'NE-1', status: 'ok' }),
      failed('ALARM_QUERY_FAILED', 'timeout'),
      succeeded({ ne_id: 'NE-3', status: 'ok' }),
    ];
    const capabilityInvocation = capabilityPort(async () => responses.shift() ?? succeeded({}));
    const service = createService({
      recipe: recipe({
        start: node('START', { api: {} }),
        api: node(
          'RESTFUL',
          { end: {} },
          {
            inputs: {
              api_name: 'alarm_query',
            },
            batchConfig: {
              batchInputDataItem: [{ ne_id: 'NE-1' }, { ne_id: 'NE-2' }, { ne_id: 'NE-3' }] as unknown as readonly JsonValue[],
              batchElementVariable: 'element',
              batchFailStrategy: 'continue',
            },
            outputs: { results: '${batch_results}', failures: '${failed_items}' },
          },
        ),
        end: node('END'),
      }),
      nodeCatalog: createWorkflowNodeCatalog({ capabilityInvocation }),
    });

    const result = await service.execute(baseRequest(), new AbortController().signal);

    expect(result.status).toBe('COMPLETED');
    const batchResults = result.outputVariables.results as unknown[];
    expect(batchResults).toHaveLength(2);
    const failedItems = result.outputVariables.failures as unknown[];
    expect(failedItems).toHaveLength(1);
    expect((failedItems[0] as { error: { code: string } }).error.code).toBe('ALARM_QUERY_FAILED');
  });

  it('aborts batch on failure when failStrategy is abort', async () => {
    const responses = [
      succeeded({ ne_id: 'NE-1', status: 'ok' }),
      failed('ALARM_QUERY_FAILED', 'timeout'),
      succeeded({ ne_id: 'NE-3', status: 'should-not-reach' }),
    ];
    const invoked = capabilityPort(async () => responses.shift() ?? succeeded({}));
    const service = createService({
      recipe: recipe({
        start: node('START', { api: {} }),
        api: node(
          'RESTFUL',
          { end: {} },
          {
            inputs: {
              api_name: 'alarm_query',
            },
            batchConfig: {
              batchInputDataItem: [{ ne_id: 'NE-1' }, { ne_id: 'NE-2' }, { ne_id: 'NE-3' }] as unknown as readonly JsonValue[],
              batchElementVariable: 'element',
              batchFailStrategy: 'abort',
            },
            outputs: { results: '${batch_results}', failures: '${failed_items}', last: '${api_response}' },
          },
        ),
        end: node('END'),
      }),
      nodeCatalog: createWorkflowNodeCatalog({ capabilityInvocation: invoked }),
    });

    const result = await service.execute(baseRequest(), new AbortController().signal);

    expect(result.status).toBe('FAILED');
    const batchResults = result.outputVariables.results as unknown[];
    expect(batchResults).toHaveLength(1);
    const failedItems = result.outputVariables.failures as unknown[];
    expect(failedItems).toHaveLength(1);
  });

  it('aborts in-flight requests when failStrategy is abort and parallelism is high', async () => {
    // Simulate real HTTP latency: each request takes ~50ms. With
    // parallelism=20 and 25 items, 20 requests are in-flight simultaneously.
    // The first failure should abort the batch controller, cancelling the
    // remaining in-flight requests rather than waiting for them to complete.
    let earlyReturnCount = 0;
    const capabilityInvocation = capabilityPort(async (request: CapabilityInvocationRequest, signal: AbortSignal) => {
      const neId = (request.arguments.element as { ne_id: string }).ne_id;
      // NE-2 fails quickly; all others take 50ms.
      if (neId === 'NE-2') {
        return failed('ALARM_QUERY_FAILED', 'timeout');
      }
      // Simulate latency; return early with a cancelled result if the signal aborts.
      if (signal.aborted) {
        earlyReturnCount++;
        return failed('WORKFLOW_INTERRUPTED', 'aborted');
      }
      await new Promise<void>((resolve) => {
        const timer = setTimeout(() => resolve(), 50);
        signal.addEventListener(
          'abort',
          () => {
            clearTimeout(timer);
            resolve();
          },
          { once: true },
        );
      });
      if (signal.aborted) {
        earlyReturnCount++;
        return failed('WORKFLOW_INTERRUPTED', 'aborted');
      }
      return succeeded({ ne_id: neId, status: 'ok' });
    });
    const service = createService({
      recipe: recipe({
        start: node('START', { api: {} }),
        api: node(
          'RESTFUL',
          { end: {} },
          {
            inputs: {
              api_name: 'alarm_query',
            },
            batchConfig: {
              batchInputDataItem: Array.from({ length: 25 }, (_, i) => ({ ne_id: `NE-${i + 1}` })) as unknown as readonly JsonValue[],
              batchElementVariable: 'element',
              batchMode: 'parallel',
              batchParallelism: 20,
              batchFailStrategy: 'abort',
            },
            outputs: { results: '${batch_results}', failures: '${failed_items}' },
          },
        ),
        end: node('END'),
      }),
      nodeCatalog: createWorkflowNodeCatalog({ capabilityInvocation }),
    });

    const result = await service.execute(baseRequest(), new AbortController().signal);

    // Batch abort should mark the node as failed.
    expect(result.status).toBe('FAILED');
    // Only the real failure (NE-2) should be recorded; collateral abort
    // cancellations must not inflate the failed list.
    const failedItems = result.outputVariables.failures as unknown[];
    expect(failedItems).toHaveLength(1);
    // In-flight requests should return early (aborted) rather than wait full 50ms.
    expect(earlyReturnCount).toBeGreaterThan(0);
  });

  it('merges batch results as map when batchResultMerge is map', async () => {
    const capabilityInvocation = capabilityPort(async (request: CapabilityInvocationRequest) => {
      const element = request.arguments.element as { key: string; ne_id: string };
      return succeeded({ ne_id: element.ne_id, status: 'checked' });
    });
    const service = createService({
      recipe: recipe({
        start: node('START', { api: {} }),
        api: node(
          'RESTFUL',
          { end: {} },
          {
            inputs: {
              api_name: 'alarm_query',
            },
            batchConfig: {
              batchInputDataItem: [
                { key: 'site-a', ne_id: 'NE-1' },
                { key: 'site-b', ne_id: 'NE-2' },
              ] as unknown as readonly JsonValue[],
              batchElementVariable: 'element',
              batchResultMerge: 'map',
            },
            outputs: { results: '${batch_results}' },
          },
        ),
        end: node('END'),
      }),
      nodeCatalog: createWorkflowNodeCatalog({ capabilityInvocation }),
    });

    const result = await service.execute(baseRequest(), new AbortController().signal);

    expect(result.status).toBe('COMPLETED');
    const batchResults = result.outputVariables.results as Record<string, unknown>;
    expect(batchResults['site-a']).toMatchObject({ ne_id: 'NE-1' });
    expect(batchResults['site-b']).toMatchObject({ ne_id: 'NE-2' });
  });
  it('rejects batch when batchInputDataItem is not an array', async () => {
    const capabilityInvocation = capabilityPort(async () => succeeded({ status: 'ok' }));
    const service = createService({
      recipe: recipe({
        start: node('START', { api: {} }),
        api: node(
          'RESTFUL',
          { end: {} },
          {
            inputs: { api_name: 'alarm_query' },
            batchConfig: {
              batchInputDataItem: 'not-an-array' as unknown as readonly JsonValue[],
            },
            outputs: { results: '${batch_results}' },
          },
        ),
        end: node('END'),
      }),
      nodeCatalog: createWorkflowNodeCatalog({ capabilityInvocation }),
    });

    const result = await service.execute(baseRequest(), new AbortController().signal);

    expect(result.status).toBe('FAILED');
    expect(result.nodeResults.find((item) => item.nodeId === 'api')?.safeError?.code).toBe('WORKFLOW_BATCH_INPUT_INVALID');
  });

  it('does not produce batch_results in single-call mode', async () => {
    const capabilityInvocation = capabilityPort(async () => succeeded({ status: 'ok' }));
    const service = createService({
      recipe: recipe({
        start: node('START', { api: {} }),
        api: node(
          'RESTFUL',
          { end: {} },
          {
            inputs: { api_name: 'alarm_query' },
            outputs: { response: '${api_response}' },
          },
        ),
        end: node('END'),
      }),
      nodeCatalog: createWorkflowNodeCatalog({ capabilityInvocation }),
    });

    const result = await service.execute(baseRequest(), new AbortController().signal);

    expect(result.status).toBe('COMPLETED');
    expect(result.outputVariables).toMatchObject({ response: { status: 'ok' } });
    expect(result.outputVariables).not.toHaveProperty('batch_results');
    expect(result.outputVariables).not.toHaveProperty('failed_items');
  });

  it('executes restful SSE streaming, aggregates the CLIP result, and reports per-event deltas', async () => {
    const streamedDeltas: WorkflowExecutionEvent[] = [];
    const capabilityInvocation = capabilityPort(async (request, _signal, runtimeContext) => {
      expect(request.capabilityId).toBe('alarm_stream');
      expect(request.arguments).toEqual({ region: 'north' });
      await runtimeContext?.emitResultDelta?.({ structuredPayload: { event: 'alarm.raised', data: { ne: 'NE-1' } } });
      await runtimeContext?.emitResultDelta?.({ structuredPayload: { event: 'alarm.cleared', data: { ne: 'NE-1' } } });
      return succeeded({
        events: [
          { event: 'alarm.raised', data: { ne: 'NE-1' } },
          { event: 'alarm.cleared', data: { ne: 'NE-1' } },
        ],
        completion: { type: 'clip.subscribe.completed', reason: 'eof', event_count: 2 },
      });
    });
    const service = createService({
      recipe: recipe({
        start: node('START', { api: {} }),
        api: node(
          'RESTFUL',
          { end: {} },
          {
            inputs: { api_name: 'alarm_stream', stream_type: 'sse', region: 'north' },
            outputs: { elementVariables: '${api_response}' },
          },
        ),
        end: node('END'),
      }),
      nodeCatalog: createWorkflowNodeCatalog({ capabilityInvocation }),
    });

    const result = await service.execute(baseRequest(), new AbortController().signal, {
      emitEvent: (event) => {
        if (event.eventType === 'NODE_OUTPUT_DELTA') {
          streamedDeltas.push(event);
        }
      },
    });

    expect(result.status).toBe('COMPLETED');
    expect(streamedDeltas).toHaveLength(2);
    expect(streamedDeltas[0]?.visibleDelta).toEqual({
      channel: 'DSL',
      content: `${JSON.stringify({ event: 'alarm.raised', data: { ne: 'NE-1' } })}\n`,
      level: 'DETAIL',
    });
    expect(streamedDeltas[1]?.visibleDelta?.content).toBe(`${JSON.stringify({ event: 'alarm.cleared', data: { ne: 'NE-1' } })}\n`);
    expect(result.outputVariables.elementVariables).toMatchObject({
      events: [{ event: 'alarm.raised' }, { event: 'alarm.cleared' }],
      completion: { type: 'clip.subscribe.completed', reason: 'eof', event_count: 2 },
    });
  });

  it('strips stream_type from restful SSE capability arguments', async () => {
    let invocationArgs: JsonObject | undefined;
    const capabilityInvocation = capabilityPort(async (request) => {
      invocationArgs = request.arguments;
      return succeeded({ events: [], completion: { type: 'clip.subscribe.completed', reason: 'eof', event_count: 0 } });
    });
    const service = createService({
      recipe: recipe({
        start: node('START', { api: {} }),
        api: node(
          'RESTFUL',
          { end: {} },
          {
            inputs: { api_name: 'alarm_stream', stream_type: 'sse', region: 'north' },
            outputs: { response: '${api_response}' },
          },
        ),
        end: node('END'),
      }),
      nodeCatalog: createWorkflowNodeCatalog({ capabilityInvocation }),
    });

    const result = await service.execute(baseRequest(), new AbortController().signal);

    expect(result.status).toBe('COMPLETED');
    expect(invocationArgs).toEqual({ region: 'north' });
    expect(invocationArgs).not.toHaveProperty('stream_type');
    expect(invocationArgs).not.toHaveProperty('api_name');
  });

  it('aggregates restful SSE result when the capability provides no emitResultDelta', async () => {
    const streamedDeltas: WorkflowExecutionEvent[] = [];
    const capabilityInvocation = capabilityPort(async () =>
      succeeded({
        events: [{ event: 'alarm.raised', data: { ne: 'NE-1' } }],
        completion: { type: 'clip.subscribe.completed', reason: 'eof', event_count: 1 },
      }),
    );
    const service = createService({
      recipe: recipe({
        start: node('START', { api: {} }),
        api: node(
          'RESTFUL',
          { end: {} },
          {
            inputs: { api_name: 'alarm_stream', stream_type: 'sse', region: 'north' },
            outputs: { response: '${api_response}' },
          },
        ),
        end: node('END'),
      }),
      nodeCatalog: createWorkflowNodeCatalog({ capabilityInvocation }),
    });

    const result = await service.execute(baseRequest(), new AbortController().signal, {
      emitEvent: (event) => {
        if (event.eventType === 'NODE_OUTPUT_DELTA') {
          streamedDeltas.push(event);
        }
      },
    });

    expect(result.status).toBe('COMPLETED');
    // No per-event DSL streaming occurred; the engine synthesizes a single
    // CONTENT fallback delta from the aggregated output variables (ANSWER
    // because the api node is the recipe answer node).
    expect(streamedDeltas).toHaveLength(1);
    expect(streamedDeltas[0]?.visibleDelta?.channel).toBe('CONTENT');
    expect(streamedDeltas[0]?.visibleDelta?.level).toBe('ANSWER');
    expect(result.outputVariables.response).toMatchObject({
      events: [{ event: 'alarm.raised' }],
      completion: { type: 'clip.subscribe.completed', reason: 'eof', event_count: 1 },
    });
  });

  it('rejects restful SSE combined with batchInputDataItem', async () => {
    const capabilityInvocation = capabilityPort(async () => succeeded({ status: 'ok' }));
    const service = createService({
      recipe: recipe({
        start: node('START', { api: {} }),
        api: node(
          'RESTFUL',
          { end: {} },
          {
            inputs: { api_name: 'alarm_stream', stream_type: 'sse' },
            batchConfig: { batchInputDataItem: [{ ne_id: 'NE-1' }] },
            outputs: { response: '${api_response}' },
          },
        ),
        end: node('END'),
      }),
      nodeCatalog: createWorkflowNodeCatalog({ capabilityInvocation }),
    });

    const result = await service.execute(baseRequest(), new AbortController().signal);

    expect(result.status).toBe('FAILED');
    expect(result.nodeResults.find((item) => item.nodeId === 'api')?.safeError).toMatchObject({
      code: 'WORKFLOW_NODE_INPUT_INVALID',
      safeDetails: { field: 'stream_type + batchInputDataItem' },
    });
    expect(capabilityInvocation.invoke).not.toHaveBeenCalled();
  });

  it('rejects restful SSE combined with is_long_api', async () => {
    const capabilityInvocation = capabilityPort(async () => succeeded({ status: 'ok' }));
    const service = createService({
      recipe: recipe({
        start: node('START', { api: {} }),
        api: node(
          'RESTFUL',
          { end: {} },
          {
            inputs: { api_name: 'alarm_stream', stream_type: 'sse', is_long_api: true },
            outputs: { response: '${api_response}' },
          },
        ),
        end: node('END'),
      }),
      nodeCatalog: createWorkflowNodeCatalog({ capabilityInvocation }),
    });

    const result = await service.execute(baseRequest(), new AbortController().signal);

    expect(result.status).toBe('FAILED');
    expect(result.nodeResults.find((item) => item.nodeId === 'api')?.safeError).toMatchObject({
      code: 'WORKFLOW_NODE_INPUT_INVALID',
      safeDetails: { field: 'stream_type + is_long_api' },
    });
    expect(capabilityInvocation.invoke).not.toHaveBeenCalled();
  });

  it('rejects restful stream_type with an unknown value', async () => {
    const capabilityInvocation = capabilityPort(async () => succeeded({ status: 'ok' }));
    const service = createService({
      recipe: recipe({
        start: node('START', { api: {} }),
        api: node(
          'RESTFUL',
          { end: {} },
          {
            inputs: { api_name: 'alarm_stream', stream_type: 'websocket' },
            outputs: { response: '${api_response}' },
          },
        ),
        end: node('END'),
      }),
      nodeCatalog: createWorkflowNodeCatalog({ capabilityInvocation }),
    });

    const result = await service.execute(baseRequest(), new AbortController().signal);

    expect(result.status).toBe('FAILED');
    expect(result.nodeResults.find((item) => item.nodeId === 'api')?.safeError).toMatchObject({
      code: 'WORKFLOW_NODE_INPUT_INVALID',
      safeDetails: { field: 'stream_type' },
    });
    expect(capabilityInvocation.invoke).not.toHaveBeenCalled();
  });

  it('keeps existing restful execution modes when stream_type is absent or empty', async () => {
    const capabilityInvocation = capabilityPort(async () => succeeded({ status: 'ok' }));
    const service = createService({
      recipe: recipe({
        start: node('START', { api: {} }),
        api: node(
          'RESTFUL',
          { end: {} },
          {
            inputs: { api_name: 'weather_query', stream_type: '' },
            outputs: { response: '${api_response}' },
          },
        ),
        end: node('END'),
      }),
      nodeCatalog: createWorkflowNodeCatalog({ capabilityInvocation }),
    });

    const result = await service.execute(baseRequest(), new AbortController().signal);

    expect(result.status).toBe('COMPLETED');
    expect(result.outputVariables.response).toMatchObject({ status: 'ok' });
  });

  it('resolves 1.0 alias intervals to poll_interval', async () => {
    const responses = [succeeded({ state: 'running' }), succeeded({ state: 'done', result: { ok: true } })];
    const capabilityInvocation = capabilityPort(async () => responses.shift() ?? succeeded({ state: 'done' }));
    const service = createService({
      recipe: recipe({
        start: node('START', { poll: {} }),
        poll: node(
          'RESTFUL',
          { end: {} },
          {
            inputs: {
              api_name: 'long_diag',
              is_long_api: true,
              poll_max_times: 2,
              intervals: '1',
            },
            outputs: { elementVariables: '${poll_results}' },
          },
        ),
        end: node('END'),
      }),
      nodeCatalog: createWorkflowNodeCatalog({ capabilityInvocation }),
    });

    const result = await service.execute(baseRequest(), new AbortController().signal);

    expect(result.status).toBe('COMPLETED');
    const pollResults = result.outputVariables.elementVariables as unknown[];
    expect(pollResults).toHaveLength(2);
  });

  it('resolves 1.0 alias overtime to poll_timeout', async () => {
    const capabilityInvocation = capabilityPort(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
      return succeeded({ state: 'running' });
    });
    const service = createService({
      recipe: recipe({
        start: node('START', { poll: {} }),
        poll: node(
          'RESTFUL',
          { end: {} },
          {
            inputs: {
              api_name: 'long_diag',
              is_long_api: true,
              poll_max_times: 100,
              poll_interval: 0,
              overtime: '1',
            },
            outputs: { elementVariables: '${poll_results}' },
          },
        ),
        end: node('END'),
      }),
      nodeCatalog: createWorkflowNodeCatalog({ capabilityInvocation }),
    });

    const result = await service.execute(baseRequest(), new AbortController().signal);

    expect(result.status).toBe('COMPLETED');
    const pollResults = result.outputVariables.elementVariables as unknown[];
    expect(pollResults.length).toBeLessThan(100);
    expect(pollResults.length).toBeGreaterThan(0);
  });

  it('prefers TS field names over 1.0 aliases when both present', async () => {
    const invoked = vi.fn(async () => succeeded({ state: 'done' }));
    const capabilityInvocation = capabilityPort(invoked);
    const service = createService({
      recipe: recipe({
        start: node('START', { poll: {} }),
        poll: node(
          'RESTFUL',
          { end: {} },
          {
            inputs: {
              api_name: 'long_diag',
              is_long_api: true,
              poll_max_times: 1,
              poll_interval: '0',
              intervals: '999',
            },
            outputs: { elementVariables: '${poll_results}' },
          },
        ),
        end: node('END'),
      }),
      nodeCatalog: createWorkflowNodeCatalog({ capabilityInvocation }),
    });

    const result = await service.execute(baseRequest(), new AbortController().signal);

    expect(result.status).toBe('COMPLETED');
    // If intervals (999s) was used, the test would timeout; poll_interval (0s) should be used
    expect(result.outputVariables.elementVariables).toBeDefined();
  });

  it('does not replay the Capability when legacy retry_times is set', async () => {
    const capturedMaxRetries: Array<number | undefined> = [];
    const capabilityInvocation = capabilityPort(async (request) => {
      capturedMaxRetries.push(request.maxRetries);
      return failed('TRANSIENT_ERROR', 'temporary');
    });
    const service = createService({
      recipe: recipe({
        start: node('START', { api: {} }),
        api: node(
          'RESTFUL',
          { end: {} },
          {
            inputs: {
              api_name: 'flaky_api',
              retry_times: '2',
              retry_wait_time: '0',
            },
            outputs: { response: '${api_response}' },
          },
        ),
        end: node('END'),
      }),
      nodeCatalog: createWorkflowNodeCatalog({ capabilityInvocation }),
    });

    const result = await service.execute(baseRequest(), new AbortController().signal);

    expect(result.status).toBe('FAILED');
    expect(capabilityInvocation.invoke).toHaveBeenCalledTimes(1);
    expect(capturedMaxRetries).toEqual([undefined]);
    expect(result.nodeResults.find((item) => item.nodeId === 'api')?.safeError?.code).toBe('TRANSIENT_ERROR');
  });

  it('rises the final Capability failure without a second local invocation when retry_times exhausted', async () => {
    const capabilityInvocation = capabilityPort(async () => failed('PERSISTENT_ERROR', 'always fails'));
    const service = createService({
      recipe: recipe({
        start: node('START', { api: {} }),
        api: node(
          'RESTFUL',
          { end: {} },
          {
            inputs: {
              api_name: 'broken_api',
              retry_times: '2',
              retry_wait_time: '0',
            },
          },
        ),
        end: node('END'),
      }),
      nodeCatalog: createWorkflowNodeCatalog({ capabilityInvocation }),
    });

    const result = await service.execute(baseRequest(), new AbortController().signal);

    expect(result.status).toBe('FAILED');
    expect(capabilityInvocation.invoke).toHaveBeenCalledTimes(1);
    expect(result.nodeResults.find((item) => item.nodeId === 'api')?.safeError?.code).toBe('PERSISTENT_ERROR');
  });

  it('does not retry when retry_times is 0 or absent', async () => {
    const capabilityInvocation = capabilityPort(async () => failed('NO_RETRY', 'fail once'));
    const service = createService({
      recipe: recipe({
        start: node('START', { api: {} }),
        api: node(
          'RESTFUL',
          { end: {} },
          {
            inputs: { api_name: 'no_retry_api' },
          },
        ),
        end: node('END'),
      }),
      nodeCatalog: createWorkflowNodeCatalog({ capabilityInvocation }),
    });

    const result = await service.execute(baseRequest(), new AbortController().signal);

    expect(result.status).toBe('FAILED');
    expect(capabilityInvocation.invoke).toHaveBeenCalledTimes(1);
  });

  it('does not retry the node when a Capability final failure is returned', async () => {
    const capabilityInvocation = capabilityPort(async () => failed('FINAL_CAPABILITY_FAILURE', 'final'));
    const service = createService({
      recipe: recipe({
        start: node('START', { api: {} }),
        api: node(
          'RESTFUL',
          { end: {} },
          {
            inputs: { api_name: 'final_failure_api' },
          },
        ),
        end: node('END'),
      }),
      nodeCatalog: createWorkflowNodeCatalog({ capabilityInvocation }),
    });

    const result = await service.execute(baseRequest(), new AbortController().signal);

    expect(result.status).toBe('FAILED');
    expect(capabilityInvocation.invoke).toHaveBeenCalledTimes(1);
    expect(result.nodeResults.find((item) => item.nodeId === 'api')?.retryCount).toBe(0);
    expect(result.nodeResults.find((item) => item.nodeId === 'api')?.safeError?.code).toBe('FINAL_CAPABILITY_FAILURE');
  });

  it('passes the configured node retry count to each logical Capability invocation', async () => {
    const capturedMaxRetries: Array<number | undefined> = [];
    const capabilityInvocation = capabilityPort(async (request) => {
      capturedMaxRetries.push(request.maxRetries);
      return succeeded({ status: 'ok' });
    });
    const service = createService({
      recipe: recipe({
        start: node('START', { api: {} }),
        api: node(
          'RESTFUL',
          { end: {} },
          {
            inputs: { api_name: 'configured_retry_api' },
            retry: { maxAttempts: 0 },
          },
        ),
        end: node('END'),
      }),
      nodeCatalog: createWorkflowNodeCatalog({ capabilityInvocation }),
    });

    const result = await service.execute(baseRequest(), new AbortController().signal);

    expect(result.status).toBe('COMPLETED');
    expect(capturedMaxRetries).toEqual([0]);
  });

  it('passes the Recipe default retry count when the Capability node has no override', async () => {
    const capturedMaxRetries: Array<number | undefined> = [];
    const capabilityInvocation = capabilityPort(async (request) => {
      capturedMaxRetries.push(request.maxRetries);
      return succeeded({ status: 'ok' });
    });
    const definition = recipe({
      start: node('START', { api: {} }),
      api: node('RESTFUL', { end: {} }, { inputs: { api_name: 'default_retry_api' } }),
      end: node('END'),
    });
    const service = createService({
      recipe: { ...definition, runtime: { defaultRetry: { maxAttempts: 1 } } },
      nodeCatalog: createWorkflowNodeCatalog({ capabilityInvocation }),
    });

    const result = await service.execute(baseRequest(), new AbortController().signal);

    expect(result.status).toBe('COMPLETED');
    expect(capturedMaxRetries).toEqual([1]);
  });

  it('omits maxRetries when the node has no retry configuration so the Capability default applies', async () => {
    const capabilityInvocation = capabilityPort(async (request) => {
      expect(request.maxRetries).toBeUndefined();
      return succeeded({ status: 'ok' });
    });
    const service = createService({
      recipe: recipe({
        start: node('START', { api: {} }),
        api: node('RESTFUL', { end: {} }, { inputs: { api_name: 'default_retry_api' } }),
        end: node('END'),
      }),
      nodeCatalog: createWorkflowNodeCatalog({ capabilityInvocation }),
    });

    const result = await service.execute(baseRequest(), new AbortController().signal);

    expect(result.status).toBe('COMPLETED');
    expect(capabilityInvocation.invoke).toHaveBeenCalledTimes(1);
  });

  it('does not retry on SUCCEEDED results', async () => {
    const invoked = vi.fn(async () => succeeded({ status: 'ok' }));
    const capabilityInvocation: CapabilityInvocationPort = { invoke: invoked };
    const service = createService({
      recipe: recipe({
        start: node('START', { api: {} }),
        api: node(
          'RESTFUL',
          { end: {} },
          {
            inputs: {
              api_name: 'stable_api',
              retry_times: '3',
            },
            outputs: { response: '${api_response}' },
          },
        ),
        end: node('END'),
      }),
      nodeCatalog: createWorkflowNodeCatalog({ capabilityInvocation }),
    });

    const result = await service.execute(baseRequest(), new AbortController().signal);

    expect(result.status).toBe('COMPLETED');
    expect(invoked).toHaveBeenCalledTimes(1);
  });

  it('extracts missing parameters via fm_extract_parameter and merges into API call', async () => {
    let capturedArgs: JsonObject | undefined;
    const capabilityInvocation = capabilityPort(async (request) => {
      capturedArgs = request.arguments;
      return succeeded({ status: 'ok' });
    });
    const modelRequests: ModelInvocationRequest[] = [];
    const model: ModelInvocationService = {
      async complete(request) {
        modelRequests.push(request);
        return { content: '{"extractedParams": {"city": "Beijing"}}' };
      },
      stream: modelEventStreamFixture(async function* (): AsyncIterable<ModelFinalResult> {
        yield { content: '{"extractedParams": {"city": "Beijing"}}' };
      }),
    };
    const runtimeCapabilityResolver: RuntimeCapabilityResolver = {
      async resolveCapability() {
        return descriptorWithSchema({
          type: 'object',
          properties: {
            city: { type: 'string' },
          },
          required: ['city'],
        });
      },
    };
    const service = createService({
      recipe: recipe({
        start: node('START', { api: {} }),
        api: node(
          'RESTFUL',
          { end: {} },
          {
            inputs: {
              api_name: 'weather_query',
              fm_extract_parameter: true,
            },
            outputs: { response: '${api_response}' },
          },
        ),
        end: node('END'),
      }),
      nodeCatalog: createWorkflowNodeCatalog({
        capabilityInvocation,
        modelInvocation: model,
        resolveModelInvocationConfig: async () => workflowModelConfig(),
        runtimeCapabilityResolver: () => runtimeCapabilityResolver,
      }),
    });

    const result = await service.execute(withInput({ input_question: 'What is the weather?' }), new AbortController().signal);

    expect(result.status).toBe('COMPLETED');
    expect(modelRequests).toHaveLength(1);
    expect(capturedArgs).toMatchObject({ city: 'Beijing' });
  });

  it('converts time parameters from NLP text to timestamp on non-extract path', async () => {
    let capturedArgs: JsonObject | undefined;
    const capabilityInvocation = capabilityPort(async (request) => {
      capturedArgs = request.arguments;
      return succeeded({ status: 'ok' });
    });
    const runtimeCapabilityResolver: RuntimeCapabilityResolver = {
      async resolveCapability() {
        return descriptorWithSchema({
          type: 'object',
          properties: {
            query_time: {
              type: 'integer',
              isTimeParam: true,
              timeType: 'timestamp',
              paramDataType: 'integer',
            },
          },
          required: ['query_time'],
        });
      },
    };
    const service = createService({
      recipe: recipe({
        start: node('START', { api: {} }),
        api: node(
          'RESTFUL',
          { end: {} },
          {
            inputs: {
              api_name: 'time_query',
              query_time: 'yesterday',
            },
            outputs: { response: '${api_response}' },
          },
        ),
        end: node('END'),
      }),
      nodeCatalog: createWorkflowNodeCatalog({
        capabilityInvocation,
        runtimeCapabilityResolver: () => runtimeCapabilityResolver,
      }),
    });

    const result = await service.execute(baseRequest(), new AbortController().signal);

    expect(result.status).toBe('COMPLETED');
    expect(capturedArgs).toBeDefined();
    expect(typeof capturedArgs!.query_time).toBe('number');
    expect(capturedArgs!.query_time).not.toBe('yesterday');
  });

  it('pauses workflow with pending input when open_reflection is true and model returns NEED_MORE_KEY', async () => {
    const capabilityInvocation = capabilityPort(async () => succeeded({ status: 'ok' }));
    const model: ModelInvocationService = {
      async complete() {
        return { content: '{"NEED_MORE_KEY": "Which city do you want weather for?"}' };
      },
      stream: modelEventStreamFixture(async function* (): AsyncIterable<ModelFinalResult> {
        yield { content: '{"NEED_MORE_KEY": "Which city?"}' };
      }),
    };
    const runtimeCapabilityResolver: RuntimeCapabilityResolver = {
      async resolveCapability() {
        return descriptorWithSchema({
          type: 'object',
          properties: { city: { type: 'string' } },
          required: ['city'],
        });
      },
    };
    const service = createService({
      recipe: recipe({
        start: node('START', { api: {} }),
        api: node(
          'RESTFUL',
          { end: {} },
          {
            inputs: { api_name: 'weather_query', fm_extract_parameter: true, open_reflection: true },
          },
        ),
        end: node('END'),
      }),
      nodeCatalog: createWorkflowNodeCatalog({
        capabilityInvocation,
        modelInvocation: model,
        resolveModelInvocationConfig: async () => workflowModelConfig(),
        runtimeCapabilityResolver: () => runtimeCapabilityResolver,
      }),
    });
    const activations: Array<WorkflowExecutionRequest['resumeState']> = [];
    const result = await service.execute(withInput({ input_question: 'Weather?' }), new AbortController().signal, undefined, {
      requestPendingInput: vi.fn(async (request) => {
        activations.push(request.resumeState);
        return { id: 'pending-param-reflect', sessionId: baseRequest().sessionId, kind: request.kind, questions: request.questions };
      }),
    });
    expect(result.status).toBe('WAITING');
    expect(result.pendingInput).toMatchObject({ id: 'pending-param-reflect', kind: 'QUESTION' });
    const reflectionQuestions = result.pendingInput?.questions as ReadonlyArray<{ prompt: string }> | undefined;
    expect(reflectionQuestions?.[0]?.prompt).toBe('Which city do you want weather for?');
    expect(result.nodeResults.find((item) => item.nodeId === 'api')?.status).toBe('NODE_WAITING');
  });

  it('resumes after reflection: user answer flows into extraction and API call succeeds', async () => {
    const invocations: JsonObject[] = [];
    const capabilityInvocation = capabilityPort(async (req) => {
      if (req.capabilityId !== 'PROMPT_SPLICING_FOR_PARAMETER_EXTRACTION') {
        invocations.push(req.arguments ?? {});
      }
      return succeeded({ status: 'ok', city: 'Beijing' });
    });
    let callCount = 0;
    const model: ModelInvocationService = {
      async complete() {
        callCount += 1;
        if (callCount === 1) {
          return { content: '{"NEED_MORE_KEY": "Which city do you want weather for?"}' };
        }
        return { content: '{"extractedParams": {"city": "Beijing"}}' };
      },
      stream: modelEventStreamFixture(async function* (): AsyncIterable<ModelFinalResult> {
        yield { content: '{"city":"Beijing"}' };
      }),
    };
    const runtimeCapabilityResolver: RuntimeCapabilityResolver = {
      async resolveCapability() {
        return descriptorWithSchema({ type: 'object', properties: { city: { type: 'string' } }, required: ['city'] });
      },
    };
    const service = createService({
      recipe: recipe({
        start: node('START', { api: {} }),
        api: node(
          'RESTFUL',
          { end: {} },
          {
            inputs: { api_name: 'weather_query', fm_extract_parameter: true, open_reflection: true },
            outputs: { response: '${api_response}' },
          },
        ),
        end: node('END'),
      }),
      nodeCatalog: createWorkflowNodeCatalog({
        capabilityInvocation,
        modelInvocation: model,
        resolveModelInvocationConfig: async () => workflowModelConfig(),
        runtimeCapabilityResolver: () => runtimeCapabilityResolver,
      }),
    });
    const activations: Array<WorkflowExecutionRequest['resumeState']> = [];
    const first = await service.execute(withInput({ input_question: 'Weather?' }), new AbortController().signal, undefined, {
      requestPendingInput: vi.fn(async (request) => {
        activations.push(request.resumeState);
        return { id: 'pending-param-reflect', sessionId: baseRequest().sessionId, kind: request.kind, questions: request.questions };
      }),
    });
    expect(first.status).toBe('WAITING');
    const resumed = await service.execute(
      {
        ...withInput({ input_question: 'Weather?' }),
        resumeState: { ...activations[0]!, pendingInputId: 'pending-param-reflect', answers: [['Beijing']], pendingAnswerSummary: 'Beijing' },
      },
      new AbortController().signal,
    );
    expect(resumed.status).toBe('COMPLETED');
    expect(invocations.length).toBe(1);
    expect(invocations[0]?.city).toBe('Beijing');
  });

  it('extracts params on long-task polling path when fm_extract_parameter is true', async () => {
    const invocations: JsonObject[] = [];
    const capabilityInvocation = capabilityPort(async (req) => {
      if (req.capabilityId !== 'PROMPT_SPLICING_FOR_PARAMETER_EXTRACTION') {
        invocations.push(req.arguments ?? {});
      }
      return succeeded({ status: 'ok' });
    });
    const model: ModelInvocationService = {
      async complete() {
        return { content: '{"extractedParams": {"city": "Shanghai"}}' };
      },
      stream: modelEventStreamFixture(async function* (): AsyncIterable<ModelFinalResult> {
        yield { content: '{"city":"Shanghai"}' };
      }),
    };
    const runtimeCapabilityResolver: RuntimeCapabilityResolver = {
      async resolveCapability() {
        return descriptorWithSchema({ type: 'object', properties: { city: { type: 'string' } }, required: ['city'] });
      },
    };
    const service = createService({
      recipe: recipe({
        start: node('START', { api: {} }),
        api: node(
          'RESTFUL',
          { end: {} },
          {
            inputs: { api_name: 'weather_query', fm_extract_parameter: true, is_long_api: true, poll_max_times: 2, poll_interval: 0 },
          },
        ),
        end: node('END'),
      }),
      nodeCatalog: createWorkflowNodeCatalog({
        capabilityInvocation,
        modelInvocation: model,
        resolveModelInvocationConfig: async () => workflowModelConfig(),
        runtimeCapabilityResolver: () => runtimeCapabilityResolver,
      }),
    });
    const result = await service.execute(withInput({ input_question: 'Weather?' }), new AbortController().signal);
    expect(result.status).toBe('COMPLETED');
    expect(invocations.length).toBe(2);
    expect(invocations[0]?.city).toBe('Shanghai');
  });

  it('extracts params on batch path when fm_extract_parameter is true', async () => {
    const invocations: JsonObject[] = [];
    const capabilityInvocation = capabilityPort(async (req) => {
      if (req.capabilityId !== 'PROMPT_SPLICING_FOR_PARAMETER_EXTRACTION') {
        invocations.push(req.arguments ?? {});
      }
      return succeeded({ status: 'ok' });
    });
    const model: ModelInvocationService = {
      async complete() {
        return { content: '{"extractedParams": {"city": "Shenzhen"}}' };
      },
      stream: modelEventStreamFixture(async function* (): AsyncIterable<ModelFinalResult> {
        yield { content: '{"city":"Shenzhen"}' };
      }),
    };
    const runtimeCapabilityResolver: RuntimeCapabilityResolver = {
      async resolveCapability() {
        return descriptorWithSchema({ type: 'object', properties: { city: { type: 'string' } }, required: ['city'] });
      },
    };
    const service = createService({
      recipe: recipe({
        start: node('START', { api: {} }),
        api: node(
          'RESTFUL',
          { end: {} },
          {
            inputs: { api_name: 'weather_query', fm_extract_parameter: true },
            batchConfig: {
              batchInputDataItem: [{ element: 'a' }, { element: 'b' }],
              batchElementVariable: 'element',
              batchMode: 'serial',
              batchFailStrategy: 'continue',
            },
          },
        ),
        end: node('END'),
      }),
      nodeCatalog: createWorkflowNodeCatalog({
        capabilityInvocation,
        modelInvocation: model,
        resolveModelInvocationConfig: async () => workflowModelConfig(),
        runtimeCapabilityResolver: () => runtimeCapabilityResolver,
      }),
    });
    const result = await service.execute(withInput({ input_question: 'Weather?' }), new AbortController().signal);
    expect(result.status).toBe('COMPLETED');
    expect(invocations.length).toBe(2);
    expect(invocations[0]?.city).toBe('Shenzhen');
    expect((invocations[0]?.element as { element: string })?.element).toBe('a');
  });
});

function createService(input: {
  readonly recipe: RecipeDefinition;
  readonly nodeCatalog: ReturnType<typeof createWorkflowNodeCatalog>;
  readonly executionCorrelation?: ExecutionCorrelationPort;
}) {
  return createWorkflowExecutionService({
    resolveRecipeDefinition: () => input.recipe,
    nodeCatalog: input.nodeCatalog,
    ...(input.executionCorrelation === undefined ? {} : { executionCorrelation: input.executionCorrelation }),
  });
}

function workflowModelConfig() {
  return {
    modelId: 'test-model',
    contextWindowTokens: 8192,
    inferenceOptions: {},
    timeoutMs: 30_000,
    maxRetries: 0,
  };
}

function capabilityPort(
  invoke: (
    request: CapabilityInvocationRequest,
    signal: AbortSignal,
    runtimeContext: Parameters<CapabilityInvocationPort['invoke']>[2],
  ) => Promise<CapabilityInvocationResult>,
): CapabilityInvocationPort {
  return {
    invoke: vi.fn(invoke),
  };
}

function succeeded(structuredPayload: JsonObject): CapabilityInvocationResult {
  return {
    status: 'SUCCEEDED',
    structuredPayload,
    generatedMessages: [],
    artifactRefs: [],
  };
}

function failed(code: string, message: string): CapabilityInvocationResult {
  return {
    status: 'FAILED',
    structuredPayload: {},
    generatedMessages: [],
    artifactRefs: [],
    safeError: {
      code,
      message,
      category: 'INTERNAL',
      retryable: false,
      safeDetails: { reasonCode: code },
    },
  };
}

function withInput(inputVariables: JsonObject): WorkflowExecutionRequest {
  return { ...baseRequest(), inputVariables };
}

function baseRequest(): WorkflowExecutionRequest {
  return {
    recipeName: 'workflow-capability-test',
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
    recipeName: 'workflow-capability-test',
    version: 'v1',
    displayName: 'Workflow capability test',
    flowGraph: { nodes },
  };
}

function node(
  type: RecipeDefinition['flowGraph']['nodes'][string]['type'],
  next: Record<string, { readonly condition?: string }> = {},
  extras: Partial<Pick<RecipeDefinition['flowGraph']['nodes'][string], 'inputs' | 'outputs' | 'batchConfig' | 'retry'>> = {},
) {
  return {
    type,
    next,
    ...(extras.inputs === undefined ? {} : { inputs: extras.inputs }),
    ...(extras.outputs === undefined ? {} : { outputs: extras.outputs }),
    ...(extras.batchConfig === undefined ? {} : { batchConfig: extras.batchConfig }),
    ...(extras.retry === undefined ? {} : { retry: extras.retry }),
  };
}

function descriptorWithSchema(inputSchema: JsonObject): CapabilityDescriptor {
  return {
    capabilityId: brand<string, 'CapabilityId'>('test_api'),
    kind: 'TOOL',
    provider: { providerId: 'test', providerKind: 'BUNDLED' },
    displayName: 'Test API',
    description: 'Test API',
    availabilityStatus: 'AVAILABLE',
    inputSchema,
  };
}
