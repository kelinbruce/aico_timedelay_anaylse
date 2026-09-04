import { DefaultAgent } from '@nextagent/agent-core';
import { brand, type JsonObject } from '@nextagent/agent-common';
import type { AgentAssembly, AgentAssemblyRegistry } from '@nextagent/agent-contracts/agent-assembly';
import type { CapabilityCatalog, CapabilityInvocationPort, CapabilityInvocationResult } from '@nextagent/agent-contracts/capability';
import type { AgentRunStatePort, RequestContext, RequestRun } from '@nextagent/agent-contracts/runtime';
import type { ContextEnginePort } from '@nextagent/agent-contracts/context';
import type { ModelInvocationService } from '@nextagent/agent-contracts/model';
import { describe, expect, it, vi } from 'vitest';

function assembly(): AgentAssembly {
  return {
    agentId: brand<string, 'AgentId'>('default-agent'),
    agentType: brand<string, 'AgentType'>('default'),
    agentVersion: brand<string, 'AgentVersion'>('v1'),
    agentAssemblyRef: 'default-agent:v1',
    displayName: 'Default Agent',
    description: 'Test agent',
    workspacePolicy: {
      schemaVersion: 'nextagent.agent-workspace-policy.v1',
      isolationMode: 'subject',
      roots: [
        { kind: 'workspace', logicalPath: 'workspace', access: 'readWrite' },
        { kind: 'systemResources', logicalPath: '.nextagent', access: 'read' },
        { kind: 'temp', logicalPath: 'temp', access: 'readWrite' },
      ],
    },
    modelIds: ['test-model'],
    capabilityBindings: [],
    userInvocable: true,
    agentInvocation: 'NONE',
    runtimeSettings: { requestTimeoutMs: 30_000 },
  };
}

function collectEmittedEvents() {
  const events: Array<{ type: string; inlinePayload: Record<string, unknown> }> = [];
  const capabilityTerminalAnswers: string[] = [];
  const runState: AgentRunStatePort = {
    async emitEvent(_run, _context, event) {
      events.push(event as { type: string; inlinePayload: Record<string, unknown> });
    },
    async appendMessage() {
      return brand<string, 'MessageId'>('msg');
    },
    async setCapabilityTerminalAnswer(_run, _context, answer) {
      capabilityTerminalAnswers.push(answer.content);
    },
    async saveCheckpoint() {},
    async requestPendingInput() {
      throw new Error('not expected');
    },
  };
  return { capabilityTerminalAnswers, events, runState };
}

function run(): RequestRun {
  return {
    runId: brand<string, 'RequestRunId'>('run-1'),
    sessionId: brand<string, 'SessionId'>('session-1'),
    requestId: brand<string, 'MessageId'>('request-1'),
    agentId: brand<string, 'AgentId'>('default-agent'),
    agentVersion: brand<string, 'AgentVersion'>('v1'),
    agentAssemblyRef: 'default-agent:v1',
    attempt: 1,
    status: 'EXECUTING',
    version: 1,
    terminalCommitState: 'NOT_STARTED',
    createdAt: brand<number, 'EpochMillis'>(1),
    updatedAt: brand<number, 'EpochMillis'>(1),
  };
}

function context(flowVariables: JsonObject = {}): RequestContext {
  return {
    requestContextId: brand<string, 'RequestContextId'>('context-1'),
    sessionId: brand<string, 'SessionId'>('session-1'),
    requestId: brand<string, 'MessageId'>('request-1'),
    runId: brand<string, 'RequestRunId'>('run-1'),
    agentTurnIndex: 0,
    identityContext: {
      tenantId: brand<string, 'TenantId'>('tenant-1'),
      subjectId: brand<string, 'SubjectId'>('subject-1'),
      displayName: 'tester',
    },
    locale: brand<string, 'RequestLocale'>('zh-CN'),
    agentId: brand<string, 'AgentId'>('default-agent'),
    agentVersion: brand<string, 'AgentVersion'>('v1'),
    agentAssemblyRef: 'default-agent:v1',
    nextLifecycleStage: 'BEFORE_MODEL_INVOKE',
    toolCallStates: [],
    flowVariables,
  };
}

function makeInvokeResult(payload: unknown): CapabilityInvocationResult {
  return {
    status: 'SUCCEEDED',
    structuredPayload: payload as never,
    generatedMessages: [],
    artifactRefs: [],
  };
}

function createAgent(runState: AgentRunStatePort, invoke: CapabilityInvocationPort['invoke']) {
  const catalog: CapabilityCatalog = {
    async listAvailable() {
      return [];
    },
    async resolve() {
      throw new Error('not expected');
    },
  };
  const assemblyRegistry: AgentAssemblyRegistry = {
    async active() {
      return assembly();
    },
    async require() {
      return assembly();
    },
  };
  const contextEngine = {
    assemble: vi.fn().mockResolvedValue({ messages: [], systemPrompt: '' }),
  } as unknown as ContextEnginePort;
  const model = {
    invoke: vi.fn().mockResolvedValue({ content: '', toolCalls: [], finishReason: 'STOP', usage: { promptTokens: 0, completionTokens: 0 } }),
  } as unknown as ModelInvocationService;

  const agent = new DefaultAgent({
    contextEngine,
    model,
    capabilityCatalog: catalog,
    capabilityInvocation: { invoke },
    assemblyRegistry,
    runState,
  });

  // Mock private methods to bypass routing and attachment resolution
  const proto = Object.getPrototypeOf(agent) as Record<string, (...args: never[]) => unknown>;
  vi.spyOn(proto, 'resolveAttachmentRefs').mockResolvedValue(undefined);
  vi.spyOn(proto, 'resolveAttachmentPaths').mockResolvedValue(undefined);
  vi.spyOn(proto, 'decideRouting').mockResolvedValue({
    kind: 'MODEL_DRIVEN_LOOP',
    safeReason: 'MODEL_DRIVEN_LOOP',
  });
  vi.spyOn(proto, 'translateRoutingDecision').mockResolvedValue(assembly());

  return agent;
}

describe('default-agent streaming terminal suppression', () => {
  it('suppresses terminal LLM_CONTENT_DELTA when all streaming chunks are structured', async () => {
    const { capabilityTerminalAnswers, events, runState } = collectEmittedEvents();
    const deltas: readonly unknown[] = [
      { eventType: 'ANSWER', messageType: 'TEXT', content: 'chunk-1' },
      { eventType: 'ANSWER', messageType: 'TEXT', content: 'chunk-2' },
      { eventType: 'ANSWER', messageType: 'TEXT', content: 'chunk-3' },
    ];
    const invoke = vi.fn<CapabilityInvocationPort['invoke']>(async (_req, _signal, runtimeContext) => {
      for (const delta of deltas) {
        await runtimeContext?.emitResultDelta?.({ structuredPayload: delta as JsonObject });
      }
      return makeInvokeResult({ result: deltas.map((d) => JSON.stringify(d)).join('') });
    });

    const agent = createAgent(runState, invoke);
    const ctx = context({
      nonAgenticApiCall: { apiCommand: { name: 'test-api' } },
    });
    await agent.execute(run(), ctx, new AbortController().signal);

    const structured = events.filter((e) => e.type === 'TOOL_STRUCTURED_DELTA');
    expect(structured).toHaveLength(3);
    expect(structured.every((e) => e.inlinePayload.streaming === true)).toBe(true);

    expect(events.filter((e) => e.type === 'LLM_CONTENT_DELTA' && e.inlinePayload.final === true)).toEqual([]);
    expect(capabilityTerminalAnswers).toEqual(['​']);
    const completed = events.filter((e) => e.type === 'CAPABILITY_COMPLETED');
    expect(completed).toHaveLength(1);
  });

  it('suppresses terminal LLM_CONTENT_DELTA for mixed chunks when any structured data exists', async () => {
    const { capabilityTerminalAnswers, events, runState } = collectEmittedEvents();
    const deltas: readonly unknown[] = [
      { eventType: 'ANSWER', messageType: 'TEXT', content: 'structured-1' },
      { nonStructured: true, data: 'residue-1' },
      { eventType: 'ANSWER', messageType: 'TEXT', content: 'structured-2' },
    ];
    const invoke = vi.fn<CapabilityInvocationPort['invoke']>(async (_req, _signal, runtimeContext) => {
      for (const delta of deltas) {
        await runtimeContext?.emitResultDelta?.({ structuredPayload: delta as JsonObject });
      }
      return makeInvokeResult({ result: 'aggregated' });
    });

    const agent = createAgent(runState, invoke);
    const ctx = context({
      nonAgenticApiCall: { apiCommand: { name: 'test-api' } },
    });
    await agent.execute(run(), ctx, new AbortController().signal);

    const structured = events.filter((e) => e.type === 'TOOL_STRUCTURED_DELTA');
    expect(structured).toHaveLength(2);

    expect(events.filter((e) => e.type === 'LLM_CONTENT_DELTA' && e.inlinePayload.final === true)).toEqual([]);
    expect(capabilityTerminalAnswers).toEqual(['​']);

    const completed = events.filter((e) => e.type === 'CAPABILITY_COMPLETED');
    expect(completed).toHaveLength(1);
  });

  it('skips terminal CAPABILITY_RESULT_DELTA for streaming results', async () => {
    const { capabilityTerminalAnswers, events, runState } = collectEmittedEvents();
    const deltas: readonly unknown[] = [{ eventType: 'ANSWER', messageType: 'TEXT', content: 'chunk-1' }];
    const invoke = vi.fn<CapabilityInvocationPort['invoke']>(async (_req, _signal, runtimeContext) => {
      for (const delta of deltas) {
        await runtimeContext?.emitResultDelta?.({ structuredPayload: delta as JsonObject });
      }
      return makeInvokeResult({ result: 'aggregated' });
    });

    const agent = createAgent(runState, invoke);
    const ctx = context({
      nonAgenticApiCall: { apiCommand: { name: 'test-api' } },
    });
    await agent.execute(run(), ctx, new AbortController().signal);

    // Per-chunk CAPABILITY_RESULT_DELTA should not exist for structured chunks
    // (structured chunks emit TOOL_STRUCTURED_DELTA instead)
    // Terminal CAPABILITY_RESULT_DELTA should be skipped for streaming
    const resultDeltas = events.filter((e) => e.type === 'CAPABILITY_RESULT_DELTA');
    expect(resultDeltas).toHaveLength(0);

    const completed = events.filter((e) => e.type === 'CAPABILITY_COMPLETED');
    expect(completed).toHaveLength(1);
    expect(capabilityTerminalAnswers).toEqual(['​']);
  });

  it('suppresses terminal content for non-streaming PIU returned in apiResult.structuredPayload', async () => {
    const { capabilityTerminalAnswers, events, runState } = collectEmittedEvents();
    // PIU returned only as the final apiResult (non-streaming): emitResultDelta is never invoked.
    const piu = {
      messageType: 'PIU',
      eventType: 'ANSWER',
      content: {
        piuName: 'mae_icn_sidebar_signal',
        piuVersion: '1.0.0',
        data: JSON.stringify({ message: '', taskId: 'f26e5f7eaed748e6a2f73f1dcd646a1c' }),
        method: 'IcnSendOpenToSignalRobot',
        uuid: null,
      },
    };
    const invoke = vi.fn<CapabilityInvocationPort['invoke']>(async (_req, _signal, _runtimeContext) => {
      // Deliberately do NOT call emitResultDelta: this is the non-streaming path.
      return makeInvokeResult(piu);
    });

    const agent = createAgent(runState, invoke);
    const ctx = context({
      nonAgenticApiCall: { apiCommand: { name: 'test-api' } },
    });
    await agent.execute(run(), ctx, new AbortController().signal);

    const structured = events.filter((e) => e.type === 'TOOL_STRUCTURED_DELTA');
    // The PIU is identified as a structured delta even without streaming.
    expect(structured).toHaveLength(1);
    expect(structured[0]!.inlinePayload.toolEventType).toBe('ANSWER');
    expect(structured[0]!.inlinePayload.toolMessageType).toBe('PIU');

    expect(events.filter((e) => e.type === 'LLM_CONTENT_DELTA' && e.inlinePayload.final === true)).toEqual([]);
    expect(capabilityTerminalAnswers).toEqual(['​']);
  });

  it('hands a non-streaming plain ApiCall payload to Runtime without a final LLM delta', async () => {
    const { capabilityTerminalAnswers, events, runState } = collectEmittedEvents();
    const invoke = vi.fn<CapabilityInvocationPort['invoke']>(async () => makeInvokeResult({ status: 'ok' }));
    const agent = createAgent(runState, invoke);

    await agent.execute(run(), context({ nonAgenticApiCall: { apiCommand: { name: 'test-api' } } }), new AbortController().signal);

    expect(capabilityTerminalAnswers).toEqual([JSON.stringify({ status: 'ok' })]);
    expect(events.filter((event) => event.type === 'LLM_CONTENT_DELTA' && event.inlinePayload.final === true)).toEqual([]);
  });
});
