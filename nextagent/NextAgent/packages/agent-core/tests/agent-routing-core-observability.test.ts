import { modelEventStreamFixture } from '../../../tests/helpers/model-stream-fixture.js';
import { DefaultAgent } from '@nextagent/agent-core';
import { bindRuntimeLoggerProvider, brand, type RuntimeLoggerProviderBinding } from '@nextagent/agent-common';
import type { AgentAssembly, AgentAssemblyRegistry } from '@nextagent/agent-contracts/agent-assembly';
import type { CapabilityCatalog, CapabilityInvocationPort } from '@nextagent/agent-contracts/capability';
import type { ContextAssembly, ContextEnginePort } from '@nextagent/agent-contracts/context';
import type { ModelInvocationService, ModelStreamDelta } from '@nextagent/agent-contracts/model';
import type { AgentRunStatePort, RequestContext, RequestRun, RunTimelineEvent } from '@nextagent/agent-contracts/runtime';
import { afterEach, describe, expect, it, vi } from 'vitest';

let loggerBinding: RuntimeLoggerProviderBinding | undefined;
afterEach(() => loggerBinding?.unbind());

describe('agent routing core observability', () => {
  it('emits safe routing evidence without projecting routing internals into user-visible messages', async () => {
    const harness = makeHarness();

    await harness.agent.execute(harness.run, harness.context, new AbortController().signal);

    const policyEvent = harness.runState.events.find((event) => event.type === 'POLICY_APPLIED');
    expect(policyEvent).toBeDefined();
    expect(policyEvent?.inlinePayload).toMatchObject({
      policyDomain: 'ROUTING',
      outcome: 'selected',
      reasonCode: 'DEFAULT_MODEL_DRIVEN_LOOP',
    });
    expect(Object.keys(policyEvent?.inlinePayload ?? {})).not.toContain('rawPrompt');
    expect(Object.keys(policyEvent?.inlinePayload ?? {})).not.toContain('routingConstraints');
    expect(harness.appendedMessages).toEqual([]);
  });

  it('logs when a model loop round returns no tool calls', async () => {
    const harness = makeHarness();

    await harness.agent.execute(harness.run, harness.context, new AbortController().signal);

    const noToolCallsLog = harness.runtimeLogs.find((entry) => (entry as { readonly event?: string }).event === 'tool.loop.no_tool_calls') as
      Record<string, unknown> | undefined;
    expect(noToolCallsLog).toMatchObject({
      event: 'tool.loop.no_tool_calls',
      agentId: harness.run.agentId,
      sessionId: harness.run.sessionId,
      requestId: harness.run.requestId,
      runId: harness.run.runId,
      round: 0,
      toolCallCount: 0,
      modelOutputCharCount: 2,
    });
    expect(noToolCallsLog).not.toHaveProperty('content');
    expect(noToolCallsLog).not.toHaveProperty('finalContent');
  });

  it('emits the model trajectory without a duplicate direct first-content log', async () => {
    const harness = makeHarness();

    await harness.agent.execute(harness.run, harness.context, new AbortController().signal);

    expect(harness.runtimeLogs).not.toContainEqual(expect.objectContaining({ event: 'model.call.first_content' }));
    const started = harness.runState.events.find((event) => event.type === 'MODEL_INVOCATION_STARTED');
    expect(started?.inlinePayload).toMatchObject({
      stepId: 'turn-1',
      messageCountBucket: '0',
      timeoutMsBucket: '5001-30000',
      maxOutputTokensBucket: '1-1024',
      disclosedCapabilityNames: ['Read'],
      disclosedCapabilityNamesTruncated: 'false',
    });
    expect(started?.inlinePayload).not.toHaveProperty('content');
  });
});

function makeHarness() {
  const run = makeRun();
  const context = makeContext(run);
  const assembly = makeAssembly(run);
  const contextEngine: ContextEnginePort = {
    assemble: vi.fn(async (request) => makeContextAssembly(request)),
    render: vi.fn(async (renderAssembly) => ({
      requestContextId: renderAssembly.request.requestContextId,
      messages: [],
      tools: [{ capabilityId: 'Read', name: 'Read', inputSchema: {} }],
      modelConfiguration: {
        modelId: 'test-model',
        contextWindowTokens: 128_000,
        temperature: 0.55,
        maxOutputTokens: 512,
        topP: 1,
        toolChoice: 'AUTO' as const,
        defaultTimeoutMs: 30_000,
        defaultMaxRetries: 2,
      },
      modelOptions: { maxOutputTokens: 512 },
      providerOptions: {},
    })),
  };
  const runState = makeRunState();
  const runtimeLogs: object[] = [];
  loggerBinding = bindRuntimeLoggerProvider({ getLogger: () => captureRuntimeLogger(runtimeLogs) });
  return {
    run,
    context,
    appendedMessages: runState.appendedMessages,
    runState,
    runtimeLogs,
    agent: new DefaultAgent({
      contextEngine,
      model: makeModel(),
      capabilityCatalog: makeCapabilityCatalog(),
      capabilityInvocation: makeCapabilityInvocation(),
      assemblyRegistry: makeAssemblyRegistry(assembly),
      runState,
    }),
  };
}

function captureRuntimeLogger(entries: object[]) {
  const capture = (fields: object): void => {
    entries.push(fields);
  };
  return { error: capture, warn: capture, info: capture, debug: capture };
}

function makeRun(): RequestRun {
  return {
    runId: brand<string, 'RequestRunId'>('run-routing-core-observability'),
    sessionId: brand<string, 'SessionId'>('session-routing-core-observability'),
    requestId: brand<string, 'MessageId'>('request-routing-core-observability'),
    agentId: brand<string, 'AgentId'>('agent-routing-core-observability'),
    agentVersion: brand<string, 'AgentVersion'>('v1'),
    agentAssemblyRef: 'agent-routing-core-observability:v1',
    attempt: 1,
    status: 'EXECUTING',
    version: 1,
    terminalCommitState: 'NOT_STARTED',
    createdAt: brand<number, 'EpochMillis'>(1),
    updatedAt: brand<number, 'EpochMillis'>(1),
  };
}

function makeContext(run: RequestRun): RequestContext {
  return {
    requestContextId: brand<string, 'RequestContextId'>('context-routing-core-observability'),
    sessionId: run.sessionId,
    requestId: run.requestId,
    runId: run.runId,
    agentTurnIndex: 0,
    identityContext: {
      tenantId: brand<string, 'TenantId'>('tenant-routing-core-observability'),
      subjectId: brand<string, 'SubjectId'>('subject-routing-core-observability'),
      displayName: 'Routing Core Observability',
    },
    locale: brand<string, 'RequestLocale'>('zh-CN'),
    agentId: run.agentId,
    agentVersion: run.agentVersion,
    agentAssemblyRef: run.agentAssemblyRef,
    nextLifecycleStage: 'BEFORE_MODEL_INVOKE',
    toolCallStates: [],
    flowVariables: {},
  };
}

function makeAssembly(run: RequestRun): AgentAssembly {
  return {
    agentId: run.agentId,
    agentType: brand<string, 'AgentType'>('default'),
    agentVersion: run.agentVersion,
    agentAssemblyRef: run.agentAssemblyRef,
    displayName: 'Routing Core Observability Agent',
    description: 'Test',
    workspacePolicy: { schemaVersion: '1', isolationMode: 'subject', roots: [] },
    modelIds: ['default'],
    capabilityBindings: [],
    userInvocable: true,
    agentInvocation: 'BOUND',
    runtimeSettings: { maxTurns: 1, maxToolCallsPerTurn: 30 },
  };
}

function makeContextAssembly(request: ContextAssembly['request']): ContextAssembly {
  return {
    request,
    systemPrompt: { sections: [] },
    selectedMessageRefs: [],
    visibleCapabilities: [],
    modelConfiguration: {
      modelId: 'test-model',
      contextWindowTokens: 128_000,
      temperature: 0.55,
      maxOutputTokens: 512,
      topP: 1,
      toolChoice: 'AUTO' as const,
      defaultTimeoutMs: 30_000,
      defaultMaxRetries: 2,
    },
    modelOptions: { maxOutputTokens: 512 },
    modelSelectionReason: 'test',
  };
}

function makeAssemblyRegistry(assembly: AgentAssembly): AgentAssemblyRegistry {
  return {
    active: vi.fn(async () => assembly),
    require: vi.fn(async () => assembly),
  };
}

function makeCapabilityCatalog(): CapabilityCatalog {
  return {
    listAvailable: vi.fn(async () => []),
    resolve: vi.fn(async () => undefined),
  };
}

function makeCapabilityInvocation(): CapabilityInvocationPort {
  return {
    invoke: vi.fn(async () => ({
      status: 'SUCCEEDED' as const,
      structuredPayload: {},
      generatedMessages: [],
      artifactRefs: [],
    })),
  };
}

function makeModel(): ModelInvocationService {
  return {
    complete: vi.fn(async () => {
      throw new Error('not used');
    }),
    stream: vi.fn(
      modelEventStreamFixture(async function* (): AsyncIterable<ModelStreamDelta> {
        yield { content: 'ok', finishReason: 'stop' } as ModelStreamDelta;
      }),
    ),
  };
}

function makeRunState(): AgentRunStatePort & { readonly events: RunTimelineEvent[]; readonly appendedMessages: unknown[] } {
  const events: RunTimelineEvent[] = [];
  const appendedMessages: unknown[] = [];
  return {
    events,
    appendedMessages,
    setCapabilityTerminalAnswer: vi.fn(async () => undefined),
    emitEvent: vi.fn(async (_run, _context, event) => {
      events.push(event);
    }),
    appendMessage: vi.fn(async (_run, _context, message) => {
      appendedMessages.push(message);
      return brand<string, 'MessageId'>('message-routing-core-observability');
    }),
    saveCheckpoint: vi.fn(async () => undefined),
    requestPendingInput: vi.fn(async () => {
      throw new Error('not used');
    }),
  };
}
