import {
  AgentError,
  brand,
  type AgentId,
  type AgentVersion,
  type JsonObject,
  type MessageId,
  type RequestContextId,
  type RequestLocale,
  type RequestRunId,
  type SessionId,
} from '@nextagent/agent-common';
import type { CapabilityDescriptor, CapabilityInvocationPort, CapabilityInvocationResult } from '@nextagent/agent-contracts/capability';
import type { AgentRunStatePort, RequestContext, RequestRun, RunTimelineEvent } from '@nextagent/agent-contracts/runtime';
import { describe, expect, it, vi } from 'vitest';

import { executeToolCallsInOrder, type RequestLocalCapabilityState, type ToolLoopDependencies } from '../src/tools/tool-loop.js';

describe('agent loop final capability failure disposition', () => {
  it('feeds an output-invalid result to the model on first occurrence without terminating', async () => {
    const appended: SessionMessageDraftLike[] = [];
    const events: RunTimelineEvent[] = [];
    let invocations = 0;
    const depsValue = deps({
      invoke: async () => {
        invocations += 1;
        return outputInvalidResult();
      },
    });

    await executeToolCallsInOrder(
      depsValue,
      input({
        runState: stubRunState(appended, events),
        toolCalls: [{ toolCallId: 'call-output-invalid', toolName: 'ReadA', arguments: {} }],
      }),
    );

    expect(invocations).toBe(1);
    expect(events.filter((event) => event.type === 'CAPABILITY_COMPLETED')).toEqual([
      expect.objectContaining({
        inlinePayload: expect.objectContaining({
          status: 'FAILED',
          safeErrorCode: 'CAPABILITY_OUTPUT_INVALID',
          safeErrorCategory: 'VALIDATION',
        }),
      }),
    ]);
    const payload = capabilityResultPayload(appended, 'ReadA');
    expect(payload).toMatchObject({
      status: 'FAILED',
      safeError: {
        code: 'CAPABILITY_OUTPUT_INVALID',
        category: 'VALIDATION',
        retryable: false,
        errorMessage: expect.stringContaining('Do not repeat the same call unchanged'),
      },
    });
  });

  it('normalizes an invalid invocation result safety-net failure and returns it to the model', async () => {
    const appended: SessionMessageDraftLike[] = [];
    const events: RunTimelineEvent[] = [];
    const depsValue = deps({
      invoke: async () =>
        ({
          status: 'SUCCEEDED',
          structuredPayload: { unsafeProviderValue: 'must-not-project' },
          generatedMessages: [{ role: 'SYSTEM', content: 'must-not-project' }],
          artifactRefs: [],
        }) as unknown as CapabilityInvocationResult,
    });

    await executeToolCallsInOrder(
      depsValue,
      input({
        runState: stubRunState(appended, events),
        toolCalls: [{ toolCallId: 'call-invalid-result', toolName: 'ReadA', arguments: {} }],
      }),
    );

    const payload = capabilityResultPayload(appended, 'ReadA');
    expect(payload).toMatchObject({
      status: 'FAILED',
      result: {},
      safeError: {
        code: 'CAPABILITY_GENERATED_MESSAGE_INVALID',
        category: 'VALIDATION',
        retryable: false,
        errorMessage: expect.stringContaining('cannot be delivered safely'),
      },
    });
    expect(events.filter((event) => event.type === 'CAPABILITY_COMPLETED')).toHaveLength(1);
    expect(JSON.stringify({ appended, events })).not.toContain('must-not-project');
  });

  it.each([
    {
      name: 'unknown status',
      result: { status: 'UNKNOWN' },
    },
    {
      name: 'successful result with safe error',
      result: {
        status: 'SUCCEEDED',
        safeError: { code: 'BROKEN_RESULT', message: 'must-not-project', category: 'INTERNAL', retryable: false },
      },
    },
    {
      name: 'failed result without safe error',
      result: { status: 'FAILED' },
    },
    {
      name: 'timed-out result with non-timeout category',
      result: {
        status: 'TIMED_OUT',
        safeError: { code: 'BROKEN_RESULT', message: 'must-not-project', category: 'UNAVAILABLE', retryable: true },
      },
    },
    {
      name: 'non-timeout result with timeout category',
      result: {
        status: 'FAILED',
        safeError: { code: 'BROKEN_RESULT', message: 'must-not-project', category: 'TIMEOUT', retryable: true },
      },
    },
    {
      name: 'non-failed result with canceled category',
      result: {
        status: 'DEGRADED',
        safeError: { code: 'BROKEN_RESULT', message: 'must-not-project', category: 'CANCELED', retryable: false },
      },
    },
    {
      name: 'malformed safe error',
      result: {
        status: 'FAILED',
        safeError: { code: 'BROKEN_RESULT', category: 'INTERNAL', retryable: false },
      },
    },
  ])('normalizes $name before applying result extensions', async ({ result }) => {
    const appended: SessionMessageDraftLike[] = [];
    const events: RunTimelineEvent[] = [];
    const requestLocalState: RequestLocalCapabilityState = { generatedMessages: [] };
    const depsValue = deps({
      invoke: async () =>
        ({
          ...result,
          structuredPayload: { unsafeProviderValue: 'must-not-project' },
          generatedMessages: [{ role: 'USER', content: 'must-not-apply' }],
          artifactRefs: [],
        }) as unknown as CapabilityInvocationResult,
    });

    await executeToolCallsInOrder(
      depsValue,
      input({
        runState: stubRunState(appended, events),
        toolCalls: [{ toolCallId: 'call-invalid-envelope', toolName: 'ReadA', arguments: {} }],
        requestLocalState,
      }),
    );

    expect(capabilityResultPayload(appended, 'ReadA')).toMatchObject({
      status: 'FAILED',
      result: {},
      safeError: {
        code: 'CAPABILITY_RESULT_INVALID',
        category: 'VALIDATION',
        retryable: false,
        errorMessage: expect.stringContaining('cannot be delivered safely'),
      },
    });
    expect(requestLocalState).toEqual({ generatedMessages: [] });
    expect(events.filter((event) => event.type === 'CAPABILITY_COMPLETED')).toHaveLength(1);
    expect(JSON.stringify({ appended, events, requestLocalState })).not.toContain('must-not-project');
    expect(JSON.stringify({ appended, events, requestLocalState })).not.toContain('must-not-apply');
  });

  it('returns an unauthorized capability model patch as an ordinary authorization failure', async () => {
    const appended: SessionMessageDraftLike[] = [];
    const events: RunTimelineEvent[] = [];
    const requestLocalState: RequestLocalCapabilityState = { generatedMessages: [] };
    const depsValue = deps({
      invoke: async () => ({
        status: 'SUCCEEDED',
        structuredPayload: { ok: true },
        generatedMessages: [{ role: 'USER', content: 'must-not-apply' }],
        contextPatch: { modelId: 'unauthorized-model' },
        artifactRefs: [],
      }),
    });

    await executeToolCallsInOrder(
      depsValue,
      input({
        runState: stubRunState(appended, events),
        toolCalls: [{ toolCallId: 'call-model-patch-denied', toolName: 'ReadA', arguments: {} }],
        requestLocalState,
      }),
    );

    expect(capabilityResultPayload(appended, 'ReadA')).toMatchObject({
      status: 'FAILED',
      result: {},
      safeError: {
        code: 'CAPABILITY_MODEL_PATCH_DENIED',
        category: 'AUTHORIZATION',
        retryable: false,
        errorMessage: expect.stringContaining('Continue with the current model'),
      },
    });
    expect(requestLocalState).toEqual({ generatedMessages: [] });
    expect(events.filter((event) => event.type === 'CAPABILITY_COMPLETED')).toHaveLength(1);
    expect(JSON.stringify({ appended, events })).not.toContain('must-not-apply');
  });

  it('keeps cancellation terminal while validating an allowed-tools result extension', async () => {
    const appended: SessionMessageDraftLike[] = [];
    const events: RunTimelineEvent[] = [];
    const requestLocalState: RequestLocalCapabilityState = { generatedMessages: [] };
    const controller = new AbortController();
    const capabilityCatalog = catalog();
    const depsValue = deps({
      capabilityCatalog: {
        ...capabilityCatalog,
        async listAvailable() {
          controller.abort();
          return [];
        },
      },
      invoke: async () => ({
        status: 'SUCCEEDED',
        structuredPayload: { unsafeProviderValue: 'must-not-project' },
        generatedMessages: [{ role: 'USER', content: 'must-not-apply' }],
        contextPatch: { allowedTools: [brand<string, 'CapabilityId'>('ReadA')] },
        artifactRefs: [],
      }),
    });

    await expect(
      executeToolCallsInOrder(
        depsValue,
        input({
          runState: stubRunState(appended, events),
          signal: controller.signal,
          toolCalls: [{ toolCallId: 'call-context-patch-canceled', toolName: 'ReadA', arguments: {} }],
          requestLocalState,
        }),
      ),
    ).rejects.toMatchObject({ code: 'ABORTED', category: 'CANCELED' });

    expect(appended.filter((message) => message.role === 'CAPABILITY_RESULT')).toEqual([]);
    expect(requestLocalState).toEqual({ generatedMessages: [] });
    expect(events.filter((event) => event.type === 'CAPABILITY_COMPLETED')).toEqual([
      expect.objectContaining({
        inlinePayload: expect.objectContaining({
          status: 'FAILED',
          safeErrorCode: 'ABORTED',
          safeErrorCategory: 'CANCELED',
        }),
      }),
    ]);
    expect(JSON.stringify({ appended, events, requestLocalState })).not.toContain('must-not-project');
    expect(JSON.stringify({ appended, events, requestLocalState })).not.toContain('must-not-apply');
  });

  it('feeds every identical output-invalid failure to the model without a local repeated-failure stop', async () => {
    const appended: SessionMessageDraftLike[] = [];
    const events: RunTimelineEvent[] = [];
    const depsValue = deps({
      invoke: async () => outputInvalidResult(),
    });
    const requestLocalState: RequestLocalCapabilityState = { generatedMessages: [] };

    await executeToolCallsInOrder(
      depsValue,
      input({
        runState: stubRunState(appended, events),
        toolCalls: [{ toolCallId: 'call-output-1', toolName: 'ReadA', arguments: {} }],
        requestLocalState,
      }),
    );
    await executeToolCallsInOrder(
      depsValue,
      input({
        runState: stubRunState(appended, events),
        toolCalls: [{ toolCallId: 'call-output-2', toolName: 'ReadA', arguments: {} }],
        requestLocalState,
      }),
    );
    await executeToolCallsInOrder(
      depsValue,
      input({
        runState: stubRunState(appended, events),
        toolCalls: [{ toolCallId: 'call-output-3', toolName: 'ReadA', arguments: {} }],
        requestLocalState,
      }),
    );

    const repeated = appended.filter((item) => item.role === 'CAPABILITY_RESULT');
    expect(repeated).toHaveLength(3);
    const last = JSON.parse(repeated[2]!.content as string) as { payload: { safeError: { errorMessage: string } } };
    expect(last.payload.safeError.errorMessage).toContain('Do not repeat the same call unchanged');
    expect(events.filter((event) => event.type === 'DEGRADATION_NOTICE' && event.inlinePayload['code'] === 'CAPABILITY_REPEATED_FAILURE')).toEqual(
      [],
    );
  });

  it('feeds failures with different arguments without emitting repeated-failure control', async () => {
    const appended: SessionMessageDraftLike[] = [];
    const events: RunTimelineEvent[] = [];
    let call = 0;
    const depsValue = deps({
      invoke: async () => {
        call += 1;
        if (call === 1) {
          return failedResult('CAPABILITY_INPUT_INVALID', 'Input invalid first.');
        }
        return failedResult('CAPABILITY_INPUT_INVALID', 'Input invalid second.');
      },
    });
    const requestLocalState: RequestLocalCapabilityState = { generatedMessages: [] };

    await executeToolCallsInOrder(
      depsValue,
      input({ runState: stubRunState(appended, events), toolCalls: [{ toolCallId: 'call-a', toolName: 'ReadA', arguments: {} }], requestLocalState }),
    );
    await executeToolCallsInOrder(
      depsValue,
      input({
        runState: stubRunState(appended, events),
        toolCalls: [{ toolCallId: 'call-b', toolName: 'ReadA', arguments: { value: 2 } }],
        requestLocalState,
      }),
    );

    expect(events.filter((event) => event.type === 'DEGRADATION_NOTICE' && event.inlinePayload['code'] === 'CAPABILITY_REPEATED_FAILURE')).toEqual(
      [],
    );
  });

  it('feeds repeated calls with different final error codes to the model', async () => {
    const appended: SessionMessageDraftLike[] = [];
    const events: RunTimelineEvent[] = [];
    let call = 0;
    const depsValue = deps({
      invoke: async () => {
        call += 1;
        return call === 1
          ? failedResult('CAPABILITY_INPUT_INVALID', 'First code.')
          : failedResult('CAPABILITY_NOT_FOUND', 'Second code.', 'NOT_FOUND');
      },
    });
    const requestLocalState: RequestLocalCapabilityState = { generatedMessages: [] };

    await executeToolCallsInOrder(
      depsValue,
      input({ runState: stubRunState(appended, events), toolCalls: [{ toolCallId: 'call-a', toolName: 'ReadA', arguments: {} }], requestLocalState }),
    );
    await executeToolCallsInOrder(
      depsValue,
      input({
        runState: stubRunState(appended, events),
        toolCalls: [{ toolCallId: 'call-b', toolName: 'ReadA', arguments: {} }],
        requestLocalState,
      }),
    );
    expect(appended.filter((item) => item.role === 'CAPABILITY_RESULT')).toHaveLength(2);
    expect(events.filter((event) => event.type === 'DEGRADATION_NOTICE' && event.inlinePayload['code'] === 'CAPABILITY_REPEATED_FAILURE')).toEqual(
      [],
    );
  });

  it('feeds repeated calls with FAILED then TIMED_OUT final status to the model', async () => {
    const appended: SessionMessageDraftLike[] = [];
    const events: RunTimelineEvent[] = [];
    let call = 0;
    const depsValue = deps({
      invoke: async () => {
        call += 1;
        if (call === 1) {
          return failedResult('CAPABILITY_EXECUTION_FAILED', 'Failed.', 'UNAVAILABLE');
        }
        return {
          status: 'TIMED_OUT',
          structuredPayload: {},
          generatedMessages: [],
          artifactRefs: [],
          safeError: { code: 'CAPABILITY_EXECUTION_FAILED', message: 'Timed out.', category: 'TIMEOUT' as const, retryable: false },
        };
      },
    });
    const requestLocalState: RequestLocalCapabilityState = { generatedMessages: [] };

    await executeToolCallsInOrder(
      depsValue,
      input({ runState: stubRunState(appended, events), toolCalls: [{ toolCallId: 'call-a', toolName: 'ReadA', arguments: {} }], requestLocalState }),
    );
    await executeToolCallsInOrder(
      depsValue,
      input({
        runState: stubRunState(appended, events),
        toolCalls: [{ toolCallId: 'call-b', toolName: 'ReadA', arguments: {} }],
        requestLocalState,
      }),
    );
    expect(appended.filter((item) => item.role === 'CAPABILITY_RESULT')).toHaveLength(2);
    expect(events.filter((event) => event.type === 'DEGRADATION_NOTICE' && event.inlinePayload['code'] === 'CAPABILITY_REPEATED_FAILURE')).toEqual(
      [],
    );
  });

  it('keeps repeated DEGRADED results model-visible without treating them as terminal failures', async () => {
    const appended: SessionMessageDraftLike[] = [];
    const events: RunTimelineEvent[] = [];
    let call = 0;
    const depsValue = deps({
      invoke: async () => {
        call += 1;
        return {
          status: 'DEGRADED',
          structuredPayload: { partial: call },
          generatedMessages: [],
          artifactRefs: [],
          safeError: { code: 'PARTIAL_RESULT', message: `Degraded ${call}.`, category: 'UNAVAILABLE', retryable: false },
        };
      },
    });
    const requestLocalState: RequestLocalCapabilityState = { generatedMessages: [] };

    await executeToolCallsInOrder(
      depsValue,
      input({ runState: stubRunState(appended, events), toolCalls: [{ toolCallId: 'call-a', toolName: 'ReadA', arguments: {} }], requestLocalState }),
    );
    await executeToolCallsInOrder(
      depsValue,
      input({
        runState: stubRunState(appended, events),
        toolCalls: [{ toolCallId: 'call-b', toolName: 'ReadA', arguments: {} }],
        requestLocalState,
      }),
    );
    expect(appended.filter((item) => item.role === 'CAPABILITY_RESULT')).toHaveLength(2);
    expect(events.filter((event) => event.type === 'DEGRADATION_NOTICE' && event.inlinePayload['code'] === 'CAPABILITY_REPEATED_FAILURE')).toEqual(
      [],
    );
  });

  it('feeds repeated failures when the safe error message changes', async () => {
    const appended: SessionMessageDraftLike[] = [];
    const events: RunTimelineEvent[] = [];
    let call = 0;
    const depsValue = deps({
      invoke: async () => {
        call += 1;
        return failedResult('CAPABILITY_INPUT_INVALID', `Message ${call}.`);
      },
    });
    const requestLocalState: RequestLocalCapabilityState = { generatedMessages: [] };

    await executeToolCallsInOrder(
      depsValue,
      input({ runState: stubRunState(appended, events), toolCalls: [{ toolCallId: 'call-a', toolName: 'ReadA', arguments: {} }], requestLocalState }),
    );
    await executeToolCallsInOrder(
      depsValue,
      input({
        runState: stubRunState(appended, events),
        toolCalls: [{ toolCallId: 'call-b', toolName: 'ReadA', arguments: {} }],
        requestLocalState,
      }),
    );
    expect(appended.filter((item) => item.role === 'CAPABILITY_RESULT')).toHaveLength(2);
    expect(events.filter((event) => event.type === 'DEGRADATION_NOTICE' && event.inlinePayload['code'] === 'CAPABILITY_REPEATED_FAILURE')).toEqual(
      [],
    );
  });

  it('feeds repeated failures when the safe structured payload changes', async () => {
    const appended: SessionMessageDraftLike[] = [];
    const events: RunTimelineEvent[] = [];
    let call = 0;
    const depsValue = deps({
      invoke: async () => {
        call += 1;
        return {
          status: 'FAILED',
          structuredPayload: { data: call },
          generatedMessages: [],
          artifactRefs: [],
          safeError: { code: 'CAPABILITY_INPUT_INVALID', message: 'Failed.', category: 'VALIDATION', retryable: false },
        };
      },
    });
    const requestLocalState: RequestLocalCapabilityState = { generatedMessages: [] };

    await executeToolCallsInOrder(
      depsValue,
      input({ runState: stubRunState(appended, events), toolCalls: [{ toolCallId: 'call-a', toolName: 'ReadA', arguments: {} }], requestLocalState }),
    );
    await executeToolCallsInOrder(
      depsValue,
      input({
        runState: stubRunState(appended, events),
        toolCalls: [{ toolCallId: 'call-b', toolName: 'ReadA', arguments: {} }],
        requestLocalState,
      }),
    );
    expect(appended.filter((item) => item.role === 'CAPABILITY_RESULT')).toHaveLength(2);
    expect(events.filter((event) => event.type === 'DEGRADATION_NOTICE' && event.inlinePayload['code'] === 'CAPABILITY_REPEATED_FAILURE')).toEqual(
      [],
    );
  });

  it('feeds an INTERNAL failure to the model on first occurrence without terminating', async () => {
    const appended: SessionMessageDraftLike[] = [];
    const events: RunTimelineEvent[] = [];
    let invocations = 0;
    const depsValue = deps({
      invoke: async () => {
        invocations += 1;
        return failedResult('CAPABILITY_EXECUTION_FAILED', 'Execution failed safely.', 'INTERNAL');
      },
    });

    await executeToolCallsInOrder(
      depsValue,
      input({ runState: stubRunState(appended, events), toolCalls: [{ toolCallId: 'call-internal', toolName: 'ReadA', arguments: {} }] }),
    );

    expect(invocations).toBe(1);
    expect(events.filter((event) => event.type === 'CAPABILITY_COMPLETED')).toHaveLength(1);
    const payload = capabilityResultPayload(appended, 'ReadA');
    expect(payload).toMatchObject({
      status: 'FAILED',
      safeError: { code: 'CAPABILITY_EXECUTION_FAILED', category: 'INTERNAL' },
    });
  });

  it('feeds every non-canceled invocation boundary rejection to the model', async () => {
    const appended: SessionMessageDraftLike[] = [];
    const events: RunTimelineEvent[] = [];
    let invocations = 0;
    const depsValue = deps({
      invoke: async () => {
        invocations += 1;
        throw new AgentError({
          code: 'CAPABILITY_BOUNDARY_REJECTED',
          message:
            'The capability invocation boundary rejected after dispatch. Choose another capability, provide a safe response without this operation, or end and report the failure.',
          category: 'INTERNAL',
          retryable: false,
        });
      },
    });
    const requestLocalState: RequestLocalCapabilityState = { generatedMessages: [] };

    await executeToolCallsInOrder(
      depsValue,
      input({
        runState: stubRunState(appended, events),
        toolCalls: [{ toolCallId: 'call-boundary-1', toolName: 'ReadA', arguments: {} }],
        requestLocalState,
      }),
    );
    await executeToolCallsInOrder(
      depsValue,
      input({
        runState: stubRunState(appended, events),
        toolCalls: [{ toolCallId: 'call-boundary-2', toolName: 'ReadA', arguments: {} }],
        requestLocalState,
      }),
    );

    expect(invocations).toBe(2);
    expect(appended.filter((item) => item.role === 'CAPABILITY_RESULT')).toHaveLength(2);
    expect(capabilityResultPayload(appended, 'ReadA')).toMatchObject({
      status: 'FAILED',
      safeError: { code: 'CAPABILITY_BOUNDARY_REJECTED', category: 'INTERNAL' },
    });
    expect(events.filter((event) => event.type === 'DEGRADATION_NOTICE' && event.inlinePayload['code'] === 'CAPABILITY_REPEATED_FAILURE')).toEqual(
      [],
    );
  });

  it('feeds an Agent capability INTERNAL failure to the model on first occurrence without terminating', async () => {
    const appended: SessionMessageDraftLike[] = [];
    const events: RunTimelineEvent[] = [];
    let invocations = 0;
    const depsValue = deps({
      invoke: async () => {
        invocations += 1;
        return failedResult('EXECUTION_FAILED', 'Subagent execution failed safely.', 'INTERNAL');
      },
    });

    await executeToolCallsInOrder(
      depsValue,
      input({
        runState: stubRunState(appended, events),
        toolCalls: [{ toolCallId: 'call-agent', toolName: 'Agent', arguments: { agentId: 'sub', prompt: 'x' } }],
      }),
    );

    expect(invocations).toBe(1);
    expect(events.filter((event) => event.type === 'CAPABILITY_COMPLETED')).toHaveLength(1);
    const payload = capabilityResultPayload(appended, 'Agent');
    expect(payload).toMatchObject({
      status: 'FAILED',
      safeError: { code: 'EXECUTION_FAILED', category: 'INTERNAL' },
    });
  });

  it('treats an AUTHORIZATION safe error with pending-input hints as a normal model-visible failure', async () => {
    const appended: SessionMessageDraftLike[] = [];
    const events: RunTimelineEvent[] = [];
    let invocations = 0;
    const depsValue = deps({
      invoke: async () => {
        invocations += 1;
        return {
          ...failedResult(
            'CAPABILITY_PATH_REJECTED',
            'The requested path is outside the authorized workspace. Choose a path inside the workspace or continue without this write.',
            'AUTHORIZATION',
            false,
          ),
          safeError: {
            code: 'CAPABILITY_PATH_REJECTED',
            message: 'The requested path is outside the authorized workspace. Choose a path inside the workspace or continue without this write.',
            category: 'AUTHORIZATION',
            retryable: false,
            safeDetails: { pendingInputKind: 'AUTHORIZATION' },
          },
        };
      },
    });

    await executeToolCallsInOrder(
      depsValue,
      input({
        runState: stubRunState(appended, events),
        toolCalls: [{ toolCallId: 'call-auth', toolName: 'Write', arguments: { file_path: 'x', content: 'x' } }],
      }),
    );

    expect(invocations).toBe(1);
    expect(events.filter((event) => event.type === 'CAPABILITY_COMPLETED')).toHaveLength(1);
    const payload = capabilityResultPayload(appended, 'Write');
    expect(payload).toMatchObject({
      status: 'FAILED',
      safeError: {
        code: 'CAPABILITY_PATH_REJECTED',
        category: 'AUTHORIZATION',
        safeDetails: { pendingInputKind: 'AUTHORIZATION' },
      },
    });
  });

  it('feeds a CAPABILITY_RESULT_UNKNOWN failure to the model on first occurrence and requires independent verification', async () => {
    const appended: SessionMessageDraftLike[] = [];
    const events: RunTimelineEvent[] = [];
    let invocations = 0;
    const depsValue = deps({
      invoke: async () => {
        invocations += 1;
        return {
          status: 'TIMED_OUT',
          structuredPayload: {},
          generatedMessages: [],
          artifactRefs: [],
          safeError: {
            code: 'CAPABILITY_RESULT_UNKNOWN',
            message: 'Result unknown; verify with an independent query.',
            category: 'TIMEOUT',
            retryable: false,
          },
        };
      },
    });

    await executeToolCallsInOrder(
      depsValue,
      input({
        runState: stubRunState(appended, events),
        toolCalls: [{ toolCallId: 'call-unknown', toolName: 'Cron', arguments: { action: 'create', prompt: 'x', cron: '0 0 * * *' } }],
      }),
    );

    expect(invocations).toBe(1);
    const payload = capabilityResultPayload(appended, 'Cron');
    expect(JSON.stringify(payload)).toContain('independent query');
  });

  it('projects safe failure evidence once for an ApiCall direct-path final failure without a model loop', async () => {
    const appended: SessionMessageDraftLike[] = [];
    const events: RunTimelineEvent[] = [];
    const depsValue = deps({
      invoke: async () =>
        failedResult(
          'API_CALL_FAILED',
          'The API call failed after dispatch and no safe response was available. Do not automatically repeat this non-idempotent call. If the integration exposes an independent read or status operation, use it to verify remote state; otherwise stop and report the failure.',
          'UNAVAILABLE',
        ),
    });
    const requestLocalState: RequestLocalCapabilityState = { generatedMessages: [] };

    await executeToolCallsInOrder(
      depsValue,
      input({
        runState: stubRunState(appended, events),
        toolCalls: [{ toolCallId: 'call-api', toolName: 'ApiCall', arguments: {} }],
        requestLocalState,
      }),
    );

    const payload = capabilityResultPayload(appended, 'ApiCall');
    expect(payload).toMatchObject({
      status: 'FAILED',
      safeError: {
        code: 'API_CALL_FAILED',
        category: 'UNAVAILABLE',
        errorMessage:
          'The API call failed after dispatch and no safe response was available. Do not automatically repeat this non-idempotent call. If the integration exposes an independent read or status operation, use it to verify remote state; otherwise stop and report the failure.',
      },
    });
  });
});

function outputInvalidResult(): CapabilityInvocationResult {
  return {
    status: 'FAILED',
    structuredPayload: {},
    generatedMessages: [],
    artifactRefs: [],
    safeError: {
      code: 'CAPABILITY_OUTPUT_INVALID',
      message:
        'Capability output did not satisfy its declared contract. Do not repeat the same call unchanged. Reduce or revise the request, or choose another capability.',
      category: 'VALIDATION',
      retryable: false,
    },
  };
}

function failedResult(
  code: string,
  message: string,
  category: 'VALIDATION' | 'INTERNAL' | 'UNAVAILABLE' | 'AUTHORIZATION' | 'POLICY_DENIED' | 'NOT_FOUND' | 'CONFLICT' = 'VALIDATION',
  retryable = false,
): CapabilityInvocationResult {
  return {
    status: 'FAILED',
    structuredPayload: {},
    generatedMessages: [],
    artifactRefs: [],
    safeError: { code, message, category, retryable },
  };
}

function deps(overrides: {
  readonly invoke: CapabilityInvocationPort['invoke'];
  readonly capabilityCatalog?: ToolLoopDependencies['capabilityCatalog'];
}): ToolLoopDependencies {
  return {
    capabilityCatalog: overrides.capabilityCatalog ?? catalog(),
    capabilityInvocation: { invoke: vi.fn(overrides.invoke) },
    assemblyRegistry: {
      async active() {
        return assembly();
      },
      async require() {
        return assembly();
      },
    },
  };
}

function input(overrides: {
  readonly runState: AgentRunStatePort;
  readonly signal?: AbortSignal;
  readonly toolCalls: NonNullable<Parameters<typeof executeToolCallsInOrder>[1]['toolCalls']>;
  readonly requestLocalState?: RequestLocalCapabilityState;
}): Parameters<typeof executeToolCallsInOrder>[1] {
  return {
    run: run(),
    context: context(),
    runState: overrides.runState,
    signal: overrides.signal ?? new AbortController().signal,
    round: 0,
    toolCalls: overrides.toolCalls,
    requestLocalState: overrides.requestLocalState ?? { generatedMessages: [] },
  };
}

function catalog(): CapabilityInvocationDeps['capabilityCatalog'] {
  return {
    async listAvailable() {
      return [];
    },
    async resolve() {
      return descriptor();
    },
  };
}

interface CapabilityInvocationDeps {
  readonly capabilityCatalog: ToolLoopDependencies['capabilityCatalog'];
}

function descriptor(): CapabilityDescriptor {
  return {
    capabilityId: brand<string, 'CapabilityId'>('ReadA'),
    kind: 'TOOL',
    provider: { providerId: 'builtin-tools', providerKind: 'BUNDLED' },
    displayName: 'ReadA',
    description: 'ReadA',
    availabilityStatus: 'AVAILABLE',
    replayPolicy: 'IDEMPOTENT',
  };
}

interface SessionMessageDraftLike {
  readonly role: string;
  readonly content: string | JsonObject;
}

function stubRunState(appended: SessionMessageDraftLike[], events: RunTimelineEvent[]): AgentRunStatePort {
  return {
    async setCapabilityTerminalAnswer(): Promise<void> {},
    async emitEvent(_run, _context, event) {
      events.push(event as RunTimelineEvent);
    },
    async appendMessage(_run, _context, draft) {
      appended.push({ role: draft.role, content: draft.content });
      return brand<string, 'MessageId'>(`message-${appended.length}`);
    },
    async saveCheckpoint() {},
    async requestPendingInput() {
      throw new Error('pending input not used');
    },
  };
}

function capabilityResultPayload(appended: SessionMessageDraftLike[], toolName: string): JsonObject {
  const message = appended.find((item) => item.role === 'CAPABILITY_RESULT' && String(item.content).includes(toolName));
  expect(message).toBeDefined();
  const parsed = JSON.parse(String(message?.content)) as { payload: JsonObject };
  return parsed.payload;
}

function run(): RequestRun {
  return {
    runId: brand<string, 'RequestRunId'>('run-agent-characterization'),
    sessionId: brand<string, 'SessionId'>('session-agent-characterization'),
    requestId: brand<string, 'MessageId'>('request-agent-characterization'),
    agentId: brand<string, 'AgentId'>('agent-agent-characterization'),
    agentVersion: brand<string, 'AgentVersion'>('v1'),
    agentAssemblyRef: 'agent-agent-characterization:v1',
    attempt: 1,
    status: 'EXECUTING',
    version: 1,
    terminalCommitState: 'NOT_STARTED',
    createdAt: brand<number, 'EpochMillis'>(1),
    updatedAt: brand<number, 'EpochMillis'>(1),
  };
}

function context(): RequestContext {
  return {
    requestContextId: brand<string, 'RequestContextId'>('context-agent-characterization'),
    sessionId: brand<string, 'SessionId'>('session-agent-characterization'),
    requestId: brand<string, 'MessageId'>('request-agent-characterization'),
    runId: brand<string, 'RequestRunId'>('run-agent-characterization'),
    agentTurnIndex: 0,
    identityContext: {
      tenantId: brand<string, 'TenantId'>('tenant-agent-characterization'),
      subjectId: brand<string, 'SubjectId'>('subject-agent-characterization'),
      displayName: 'Agent Characterization',
    },
    locale: brand<string, 'RequestLocale'>('zh-CN'),
    agentId: brand<string, 'AgentId'>('agent-agent-characterization'),
    agentVersion: brand<string, 'AgentVersion'>('v1'),
    agentAssemblyRef: 'agent-agent-characterization:v1',
    nextLifecycleStage: 'BEFORE_MODEL_INVOKE',
    toolCallStates: [],
    flowVariables: {},
  };
}

function assembly() {
  return {
    agentId: brand<string, 'AgentId'>('agent-agent-characterization'),
    agentType: brand<string, 'AgentType'>('default'),
    agentVersion: brand<string, 'AgentVersion'>('v1'),
    agentAssemblyRef: 'agent-agent-characterization:v1',
    displayName: 'Characterization Agent',
    description: 'Test',
    workspacePolicy: { schemaVersion: '1', isolationMode: 'subject' as const, roots: [] },
    modelIds: ['default'],
    capabilityBindings: [],
    userInvocable: true,
    agentInvocation: 'BOUND' as const,
    runtimeSettings: { maxTurns: 1, maxToolCallsPerTurn: 30 },
  };
}
