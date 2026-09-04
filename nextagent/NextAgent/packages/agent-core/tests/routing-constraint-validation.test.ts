import { modelEventStreamFixture } from '../../../tests/helpers/model-stream-fixture.js';
import { DefaultAgent } from '@nextagent/agent-core';
import { brand } from '@nextagent/agent-common';
import type { AgentAssembly, AgentAssemblyRegistry } from '@nextagent/agent-contracts/agent-assembly';
import type { CapabilityCatalog, CapabilityInvocationPort } from '@nextagent/agent-contracts/capability';
import type { ContextAssembly, ContextEnginePort } from '@nextagent/agent-contracts/context';
import type { ModelInvocationService, ModelStreamDelta } from '@nextagent/agent-contracts/model';
import { RoutingConstraintsSchema, type AgentRunStatePort, type RequestContext, type RequestRun } from '@nextagent/agent-contracts/runtime';
import { Ajv } from 'ajv/dist/ajv.js';
import { describe, expect, it, vi } from 'vitest';

describe('routing constraint validation', () => {
  it('rejects an invalid targetSkill at the schema boundary before core governance', () => {
    const validate = new Ajv({ allErrors: true }).compile(RoutingConstraintsSchema);

    expect(
      validate({
        targetSkill: 'alarm diagnosis with spaces',
      }),
    ).toBe(false);
  });

  it('rejects an unsupported executionMode at the schema boundary before core governance', () => {
    const validate = new Ajv({ allErrors: true }).compile(RoutingConstraintsSchema);

    expect(
      validate({
        executionMode: 'subagent-only',
      }),
    ).toBe(false);
  });

  it('rejects a locale constraint that is incompatible with the trusted request locale', async () => {
    const harness = makeHarness({
      context: {
        routingConstraints: {
          locale: 'en-US',
        },
      },
    });

    await expect(harness.agent.execute(makeRun(), harness.context, new AbortController().signal)).rejects.toMatchObject({
      code: 'ROUTING_CONSTRAINT_LOCALE_INCOMPATIBLE',
    });
    expect(harness.model.stream).not.toHaveBeenCalled();
  });
});

function makeRun(): RequestRun {
  return {
    runId: brand<string, 'RequestRunId'>('run-routing-constraint-validation'),
    sessionId: brand<string, 'SessionId'>('session-routing-constraint-validation'),
    requestId: brand<string, 'MessageId'>('request-routing-constraint-validation'),
    agentId: brand<string, 'AgentId'>('agent-routing-constraint-validation'),
    agentVersion: brand<string, 'AgentVersion'>('v1'),
    agentAssemblyRef: 'agent-routing-constraint-validation:v1',
    attempt: 1,
    status: 'EXECUTING',
    version: 1,
    terminalCommitState: 'NOT_STARTED',
    createdAt: brand<number, 'EpochMillis'>(1),
    updatedAt: brand<number, 'EpochMillis'>(1),
  };
}

function makeHarness(overrides: { context?: Partial<RequestContext> } = {}) {
  const run = makeRun();
  const assembly = makeAssembly(run.agentId, run.agentVersion);
  const context: RequestContext = {
    requestContextId: brand<string, 'RequestContextId'>('context-routing-constraint-validation'),
    sessionId: run.sessionId,
    requestId: run.requestId,
    runId: run.runId,
    agentTurnIndex: 0,
    identityContext: {
      tenantId: brand<string, 'TenantId'>('tenant-routing-constraint-validation'),
      subjectId: brand<string, 'SubjectId'>('subject-routing-constraint-validation'),
      displayName: 'Routing Constraint Validation',
    },
    locale: brand<string, 'RequestLocale'>('zh-CN'),
    agentId: run.agentId,
    agentVersion: run.agentVersion,
    agentAssemblyRef: run.agentAssemblyRef,
    nextLifecycleStage: 'BEFORE_MODEL_INVOKE',
    toolCallStates: [],
    flowVariables: {},
    ...overrides.context,
  };
  const assemblyRegistry: AgentAssemblyRegistry = {
    active: vi.fn(async () => assembly),
    require: vi.fn(async () => assembly),
  };
  const capabilityCatalog: CapabilityCatalog = {
    listAvailable: vi.fn(async () => []),
    resolve: vi.fn(async () => undefined),
  };
  const contextEngine: ContextEnginePort = {
    assemble: vi.fn(async () => makeContextAssembly(context)),
    render: vi.fn(async () => ({
      requestContextId: context.requestContextId,
      messages: [],
      tools: [],
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
  const model = {
    complete: vi.fn(async () => {
      throw new Error('not used');
    }),
    stream: vi.fn(
      modelEventStreamFixture(async function* (): AsyncIterable<ModelStreamDelta> {
        yield { content: 'ok', finishReason: 'stop' } as ModelStreamDelta;
      }),
    ),
  } satisfies ModelInvocationService;
  const capabilityInvocation = {
    invoke: vi.fn(async () => ({
      status: 'SUCCEEDED' as const,
      structuredPayload: {},
      generatedMessages: [],
      artifactRefs: [],
    })),
  } satisfies CapabilityInvocationPort;
  const runState: AgentRunStatePort = {
    setCapabilityTerminalAnswer: vi.fn(async () => undefined),
    emitEvent: vi.fn(async () => undefined),
    appendMessage: vi.fn(async () => brand<string, 'MessageId'>('message-routing-constraint-validation')),
    saveCheckpoint: vi.fn(async () => undefined),
    requestPendingInput: vi.fn(async () => {
      throw new Error('not used');
    }),
  };

  return {
    context,
    model,
    capabilityInvocation,
    agent: new DefaultAgent({
      contextEngine,
      model,
      capabilityCatalog,
      capabilityInvocation,
      assemblyRegistry,
      runState,
    }),
  };
}

function makeAssembly(agentId: RequestRun['agentId'], agentVersion: RequestRun['agentVersion']): AgentAssembly {
  return {
    agentId,
    agentType: brand<string, 'AgentType'>('default'),
    agentVersion,
    agentAssemblyRef: `${agentId}:${agentVersion}`,
    displayName: 'Routing Constraint Validation Agent',
    description: 'Test',
    workspacePolicy: { schemaVersion: '1', isolationMode: 'subject', roots: [] },
    modelIds: ['default'],
    capabilityBindings: [],
    userInvocable: true,
    agentInvocation: 'BOUND',
    runtimeSettings: { maxTurns: 1, maxToolCallsPerTurn: 30 },
  };
}

function makeContextAssembly(context: RequestContext): ContextAssembly {
  return {
    request: {
      sessionId: context.sessionId,
      requestId: context.requestId,
      requestContextId: context.requestContextId,
      identityContext: context.identityContext,
      agentId: context.agentId,
      agentVersion: context.agentVersion,
      runId: context.runId,
      stepId: 'turn-1',
      locale: context.locale,
      purpose: 'minimal-question-answer',
    },
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
