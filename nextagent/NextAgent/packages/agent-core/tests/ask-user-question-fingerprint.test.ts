import { DefaultAgent } from '@nextagent/agent-core';
import { brand, type JsonObject, type MessageId } from '@nextagent/agent-common';
import type { AgentAssembly, AgentAssemblyRegistry } from '@nextagent/agent-contracts/agent-assembly';
import type { CapabilityCatalog, CapabilityInvocationPort } from '@nextagent/agent-contracts/capability';
import type { ContextAssembly, ContextEnginePort, RenderedModelInput } from '@nextagent/agent-contracts/context';
import type { ModelInvocationRequest, ModelInvocationService, ModelStreamDelta } from '@nextagent/agent-contracts/model';
import type { AgentRunStatePort, RequestContext, RequestRun, RunTimelineEvent } from '@nextagent/agent-contracts/runtime';
import { describe, expect, it, vi } from 'vitest';

import { modelEventStreamFixture } from '../../../tests/helpers/model-stream-fixture.js';

const TENANT = brand<string, 'TenantId'>('tenant-ask-fingerprint');
const SUBJECT = brand<string, 'SubjectId'>('subject-ask-fingerprint');
const AGENT = brand<string, 'AgentId'>('agent-ask-fingerprint');
const AGENT_V = brand<string, 'AgentVersion'>('v1');
const SESSION = brand<string, 'SessionId'>('session-ask-fingerprint');
const REQUEST_ID = brand<string, 'MessageId'>('request-ask-fingerprint');
const RUN_ID = brand<string, 'RequestRunId'>('run-ask-fingerprint');

function makeRun(): RequestRun {
  return {
    sessionId: SESSION,
    requestId: REQUEST_ID,
    runId: RUN_ID,
    agentId: AGENT,
    agentVersion: AGENT_V,
    agentAssemblyRef: 'agent-ask-fingerprint:v1',
    attempt: 1,
    status: 'EXECUTING',
    version: 1,
    terminalCommitState: 'NOT_STARTED',
    createdAt: brand<number, 'EpochMillis'>(1),
    updatedAt: brand<number, 'EpochMillis'>(1),
  } as RequestRun;
}

function makeContext(): RequestContext {
  return {
    sessionId: SESSION,
    requestId: REQUEST_ID,
    runId: RUN_ID,
    agentTurnIndex: 0,
    requestContextId: brand<string, 'RequestContextId'>('rc-ask-fingerprint'),
    agentId: AGENT,
    agentVersion: AGENT_V,
    agentAssemblyRef: 'agent-ask-fingerprint:v1',
    nextLifecycleStage: 'BEFORE_MODEL_INVOKE',
    toolCallStates: [],
    flowVariables: {},
    identityContext: { tenantId: TENANT, subjectId: SUBJECT, displayName: 'agent test' },
    locale: brand<string, 'RequestLocale'>('en-US'),
  } as RequestContext;
}

function makeAssembly(): ContextAssembly {
  return {
    request: {
      sessionId: SESSION,
      requestId: REQUEST_ID,
      requestContextId: brand<string, 'RequestContextId'>('rc-ask-fingerprint'),
      identityContext: { tenantId: TENANT, subjectId: SUBJECT, displayName: 'agent test' },
      agentId: AGENT,
      agentVersion: AGENT_V,
      runId: RUN_ID,
      stepId: 'step-1',
      locale: brand<string, 'RequestLocale'>('en-US'),
      purpose: 'test',
    },
    systemPrompt: { sections: [] },
    selectedMessageRefs: [],
    visibleCapabilities: [],
    modelConfiguration: {
      modelId: 'test-model',
      contextWindowTokens: 128_000,
      temperature: 0.55,
      maxOutputTokens: 4_096,
      topP: 1,
      toolChoice: 'AUTO' as const,
      defaultTimeoutMs: 30_000,
      defaultMaxRetries: 2,
    },
    modelOptions: { maxOutputTokens: 4_096 },
    modelSelectionReason: 'test',
  };
}

function makeRendered(): RenderedModelInput {
  return {
    requestContextId: brand<string, 'RequestContextId'>('rc-ask-fingerprint'),
    messages: [],
    tools: [],
    modelConfiguration: {
      modelId: 'test-model',
      contextWindowTokens: 128_000,
      temperature: 0.55,
      maxOutputTokens: 4_096,
      topP: 1,
      toolChoice: 'AUTO' as const,
      defaultTimeoutMs: 30_000,
      defaultMaxRetries: 2,
    },
    modelOptions: { maxOutputTokens: 4_096 },
    providerOptions: {},
  };
}

function makeAssemblyRegistry(maxTurns = 5): AgentAssemblyRegistry {
  const assembly: AgentAssembly = {
    agentId: AGENT,
    agentType: brand<string, 'AgentType'>('default'),
    agentVersion: AGENT_V,
    agentAssemblyRef: 'agent-ask-fingerprint:v1',
    displayName: 'Test',
    description: 'Test',
    workspacePolicy: {
      schemaVersion: 'nextagent.agent-workspace-policy.v1',
      isolationMode: 'subject',
      roots: [
        { kind: 'workspace', logicalPath: 'workspace', access: 'readWrite' },
        { kind: 'systemResources', logicalPath: '.nextagent', access: 'read' },
        { kind: 'temp', logicalPath: 'temp', access: 'readWrite' },
      ],
    },
    modelIds: ['default'],
    capabilityBindings: [],
    userInvocable: true,
    agentInvocation: 'BOUND',
    runtimeSettings: { maxTurns, maxToolCallsPerTurn: 30, maxContextMessages: 50 },
  };
  return {
    active: async () => assembly,
    require: async () => assembly,
  };
}

function makeAskUserQuestionCatalog(): CapabilityCatalog {
  return {
    listAvailable: async () => [],
    resolve: async () => ({
      capabilityId: brand<string, 'CapabilityId'>('AskUserQuestion'),
      name: 'AskUserQuestion',
      displayName: 'AskUserQuestion',
      description: 'Ask the user a question',
      kind: 'TOOL',
      provider: { providerId: 'builtin-tools', providerKind: 'BUNDLED' },
      availabilityStatus: 'AVAILABLE',
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        required: ['questions'],
        properties: {
          questions: {
            type: 'array',
            minItems: 1,
            maxItems: 3,
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['prompt'],
              properties: {
                prompt: { type: 'string', minLength: 1, maxLength: 500 },
                options: { type: 'array' },
                multiple: { type: 'boolean' },
                custom: { type: 'boolean' },
              },
            },
          },
        },
      },
    }),
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

function makeRunState(): AgentRunStatePort & {
  readonly events: RunTimelineEvent[];
  readonly messages: Array<{ role: string; content: string | JsonObject }>;
} {
  const events: RunTimelineEvent[] = [];
  const messages: Array<{ role: string; content: string | JsonObject }> = [];
  return {
    events,
    messages,
    setCapabilityTerminalAnswer: vi.fn(async () => undefined),
    emitEvent: vi.fn(async (_run, _context, event) => {
      events.push(event);
    }),
    appendMessage: vi.fn(async (_run, _context, draft) => {
      messages.push({ role: draft.role, content: draft.content });
      return brand<string, 'MessageId'>(`message-${messages.length}`);
    }),
    saveCheckpoint: vi.fn(async () => undefined),
    requestPendingInput: vi.fn(async () => {
      throw new Error('pending input not used');
    }),
  };
}

function makeModel(eventBatches: ModelStreamDelta[][]): ModelInvocationService {
  let batchIndex = 0;
  return {
    complete: async () => {
      throw new Error('not used');
    },
    stream: modelEventStreamFixture(async function* (_request: ModelInvocationRequest, _signal: AbortSignal) {
      const batch = eventBatches[batchIndex] ?? [{ content: 'done', finishReason: 'stop' } as ModelStreamDelta];
      batchIndex += 1;
      for (const event of batch) {
        yield event;
      }
    }),
  };
}

interface MakeAgentOptions {
  readonly modelEvents: ModelStreamDelta[][];
  readonly capabilityInvocation?: CapabilityInvocationPort;
  readonly maxTurns?: number;
}

function makeAgent(opts: MakeAgentOptions): {
  readonly agent: DefaultAgent;
  readonly runState: AgentRunStatePort & {
    readonly events: RunTimelineEvent[];
    readonly messages: Array<{ role: string; content: string | JsonObject }>;
  };
} {
  const contextEngine: ContextEnginePort = {
    assemble: vi.fn(async () => makeAssembly()),
    render: vi.fn(async () => makeRendered()),
  };
  const model = makeModel(opts.modelEvents);
  const runState = makeRunState();
  const agent = new DefaultAgent({
    contextEngine,
    model,
    capabilityCatalog: makeAskUserQuestionCatalog(),
    capabilityInvocation: opts.capabilityInvocation ?? makeCapabilityInvocation(),
    assemblyRegistry: makeAssemblyRegistry(opts.maxTurns),
    runState,
  });
  return { agent, runState };
}

const invalidAskUserQuestionToolCall: ModelStreamDelta = {
  content: '',
  finishReason: 'tool-calls',
  toolCalls: [
    {
      toolCallId: 'ask-invalid-1',
      toolName: 'AskUserQuestion',
      arguments: { questions: [{ prompt: 'x', header: 'x' }] },
    },
  ],
} as unknown as ModelStreamDelta;

const sameInvalidAskUserQuestionToolCall: ModelStreamDelta = {
  content: '',
  finishReason: 'tool-calls',
  toolCalls: [
    {
      toolCallId: 'ask-invalid-2',
      toolName: 'AskUserQuestion',
      arguments: { questions: [{ prompt: 'x', header: 'x' }] },
    },
  ],
} as unknown as ModelStreamDelta;

const thirdInvalidAskUserQuestionToolCall: ModelStreamDelta = {
  content: '',
  finishReason: 'tool-calls',
  toolCalls: [
    {
      toolCallId: 'ask-invalid-3',
      toolName: 'AskUserQuestion',
      arguments: { questions: [{ prompt: 'x', header: 'x' }] },
    },
  ],
} as unknown as ModelStreamDelta;

describe('AskUserQuestion repeated failure disposition', () => {
  it('feeds every identical correctable failure to the model and then allows a normal answer', async () => {
    const { agent, runState } = makeAgent({
      modelEvents: [
        [invalidAskUserQuestionToolCall],
        [sameInvalidAskUserQuestionToolCall],
        [thirdInvalidAskUserQuestionToolCall],
        [{ content: 'I cannot ask that question, so I will answer without it.', finishReason: 'stop' } as ModelStreamDelta],
      ],
    });

    await expect(agent.execute(makeRun(), makeContext(), new AbortController().signal)).resolves.toMatchObject({ status: 'COMPLETED' });

    const notices = runState.events.filter(
      (e) => e.type === 'DEGRADATION_NOTICE' && (e.inlinePayload as Record<string, unknown>)['code'] === 'ASK_USER_QUESTION_INPUT_INVALID',
    );
    expect(notices).toHaveLength(3);
    expect(runState.messages.filter((message) => message.role === 'CAPABILITY_RESULT')).toHaveLength(3);
    expect(
      runState.events.filter(
        (e) => e.type === 'DEGRADATION_NOTICE' && (e.inlinePayload as Record<string, unknown>)['code'] === 'CAPABILITY_REPEATED_FAILURE',
      ),
    ).toEqual([]);
  });

  it('uses the global tool-round limit instead of a repeated-error threshold', async () => {
    const { agent, runState } = makeAgent({
      modelEvents: [[invalidAskUserQuestionToolCall], [sameInvalidAskUserQuestionToolCall]],
      maxTurns: 2,
    });

    await expect(agent.execute(makeRun(), makeContext(), new AbortController().signal)).resolves.toMatchObject({ status: 'COMPLETED' });

    expect(runState.messages.filter((message) => message.role === 'CAPABILITY_RESULT')).toHaveLength(2);
    expect(
      runState.events.filter(
        (event) => event.type === 'DEGRADATION_NOTICE' && (event.inlinePayload as Record<string, unknown>)['code'] === 'TOOL_ROUND_LIMIT_EXCEEDED',
      ),
    ).toHaveLength(1);
    expect(
      runState.events.filter(
        (event) => event.type === 'DEGRADATION_NOTICE' && (event.inlinePayload as Record<string, unknown>)['code'] === 'CAPABILITY_REPEATED_FAILURE',
      ),
    ).toEqual([]);
  });
});
