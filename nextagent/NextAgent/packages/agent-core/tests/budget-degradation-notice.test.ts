import { modelEventStreamFixture } from '../../../tests/helpers/model-stream-fixture.js';
import { DefaultAgent } from '@nextagent/agent-core';
import {
  AgentError,
  bindRuntimeLoggerProvider,
  brand,
  type JsonObject,
  type MessageId,
  type RuntimeLoggerProviderBinding,
} from '@nextagent/agent-common';
import type { AgentAssembly, AgentAssemblyRegistry } from '@nextagent/agent-contracts/agent-assembly';
import type { CapabilityCatalog, CapabilityInvocationPort } from '@nextagent/agent-contracts/capability';
import type {
  ContextAssembly,
  ContextAssemblyRequest,
  ContextBudgetEvidence,
  ContextCompactionPlan,
  AttachmentDegradationEvidence,
  ContextCompressionEvidence,
  ContextEnginePort,
  ContextRoleEvidence,
  RenderedModelInput,
} from '@nextagent/agent-contracts/context';
import type { ModelFinalResult, ModelInvocationRequest, ModelInvocationService, ModelStreamDelta } from '@nextagent/agent-contracts/model';
import type {
  AgentRunStatePort,
  LifecycleHookInvocationPort,
  RequestContext,
  RequestRun,
  RunTimelineEvent,
} from '@nextagent/agent-contracts/runtime';
import { afterEach, describe, expect, it, vi } from 'vitest';

let loggerBinding: RuntimeLoggerProviderBinding | undefined;
afterEach(() => loggerBinding?.unbind());

// =============================================================================
// Fixture helpers
// =============================================================================

const TENANT = brand<string, 'TenantId'>('tenant-budget-agent');
const SUBJECT = brand<string, 'SubjectId'>('subject-budget-agent');
const AGENT = brand<string, 'AgentId'>('agent-budget-agent');
const AGENT_V = brand<string, 'AgentVersion'>('v1');
const SESSION = brand<string, 'SessionId'>('session-budget-agent');
const REQUEST_ID = brand<string, 'MessageId'>('request-budget-agent');
const RUN_ID = brand<string, 'RequestRunId'>('run-budget-agent');
const STEP_ID = 'step-1';

function makeRun(): RequestRun {
  return {
    sessionId: SESSION,
    requestId: REQUEST_ID,
    runId: RUN_ID,
    agentId: AGENT,
    agentVersion: AGENT_V,
    agentAssemblyRef: 'agent-budget-agent:v1',
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
    requestContextId: brand<string, 'RequestContextId'>('rc-budget-agent'),
    agentId: AGENT,
    agentVersion: AGENT_V,
    agentAssemblyRef: 'agent-budget-agent:v1',
    nextLifecycleStage: 'BEFORE_MODEL_INVOKE',
    toolCallStates: [],
    flowVariables: {},
    identityContext: { tenantId: TENANT, subjectId: SUBJECT, displayName: 'agent test' },
    locale: brand<string, 'RequestLocale'>('en-US'),
  } as RequestContext;
}

function makeAssembly(
  overrides: {
    budgetPlan?: ContextCompactionPlan;
    compressionEvidence?: ContextCompressionEvidence;
    attachmentDegradationEvidence?: readonly AttachmentDegradationEvidence[];
  } = {},
): ContextAssembly {
  return {
    request: {
      sessionId: SESSION,
      requestId: REQUEST_ID,
      requestContextId: brand<string, 'RequestContextId'>('rc-budget-agent'),
      identityContext: { tenantId: TENANT, subjectId: SUBJECT, displayName: 'agent test' },
      agentId: AGENT,
      agentVersion: AGENT_V,
      runId: RUN_ID,
      stepId: STEP_ID,
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
    ...(overrides.attachmentDegradationEvidence === undefined
      ? {}
      : {
          attachmentDegradationEvidence: overrides.attachmentDegradationEvidence,
        }),
    ...(overrides.budgetPlan === undefined
      ? {}
      : {
          budgetPlan: overrides.budgetPlan,
          budgetEvidence: [] as readonly ContextBudgetEvidence[],
          budgetRoleEvidence: [] as readonly ContextRoleEvidence[],
        }),
    ...(overrides.compressionEvidence === undefined
      ? {}
      : {
          compressionEvidence: overrides.compressionEvidence,
        }),
  };
}

function makeAssemblyWithBudgetPlan(plan: ContextCompactionPlan): ContextAssembly {
  return makeAssembly({ budgetPlan: plan });
}

function makePlan(overrides: Partial<ContextCompactionPlan> = {}): ContextCompactionPlan {
  return {
    decision: 'continue',
    reasonCode: 'WITHIN_BUDGET',
    compressionMode: 'none',
    degradationMode: [],
    pipelineStageStoppedAt: 'agent-context-engine.budget-decision-gate',
    estimatedFinalInputUnits: 100,
    omittedContextTypes: [],
    ...overrides,
  };
}

function makeRendered(): RenderedModelInput {
  return {
    requestContextId: brand<string, 'RequestContextId'>('rc-budget-agent'),
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

function makeAssemblyRegistry(maxTurns = 1, maxToolCallsPerTurn = 30): AgentAssemblyRegistry {
  const assembly: AgentAssembly = {
    agentId: AGENT,
    agentType: brand<string, 'AgentType'>('default'),
    agentVersion: AGENT_V,
    agentAssemblyRef: 'agent-budget-agent:v1',
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
    runtimeSettings: { maxTurns, maxToolCallsPerTurn, maxContextMessages: 50 },
  };
  return {
    active: async () => assembly,
    require: async () => assembly,
  };
}

function makeCapabilityCatalog(): CapabilityCatalog {
  return {
    listAvailable: async () => [],
    resolve: async () => ({
      capabilityId: brand<string, 'CapabilityId'>('Read'),
      name: 'Read',
      displayName: 'Read',
      description: 'test',
      kind: 'TOOL',
      provider: { providerId: 'builtin-tools', providerKind: 'BUNDLED' },
      availabilityStatus: 'AVAILABLE',
      inputSchema: {},
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

function makeRunState(): AgentRunStatePort & { readonly events: RunTimelineEvent[]; readonly capabilityTerminalAnswers: string[] } {
  const events: RunTimelineEvent[] = [];
  const capabilityTerminalAnswers: string[] = [];
  return {
    events,
    capabilityTerminalAnswers,
    emitEvent: vi.fn(async (_run, _context, event) => {
      events.push(event);
    }),
    appendMessage: vi.fn(async () => brand<string, 'MessageId'>('ignored')),
    setCapabilityTerminalAnswer: vi.fn(async (_run, _context, answer) => {
      capabilityTerminalAnswers.push(answer.content);
    }),
    saveCheckpoint: vi.fn(async () => undefined),
    requestPendingInput: vi.fn(async () => {
      throw new Error('pending input not used');
    }),
  };
}

function makeModel(events: ModelStreamDelta[]): ModelInvocationService {
  return {
    complete: async () => {
      throw new Error('not used in these tests');
    },
    stream: modelEventStreamFixture(async function* (_request, _signal) {
      for (const event of events) {
        yield event;
      }
    }),
  };
}

interface MakeAgentOptions {
  readonly assembly?: ContextAssembly;
  readonly assemblyError?: Error;
  readonly modelEvents?: ModelStreamDelta[];
  readonly runtimeLogEntries?: unknown[];
  readonly fallbackModelId?: string;
  readonly model?: ModelInvocationService;
  readonly rendered?: RenderedModelInput;
  readonly lifecycleHook?: LifecycleHookInvocationPort;
  readonly capabilityInvocation?: CapabilityInvocationPort;
  readonly maxTurns?: number;
  readonly maxToolCallsPerTurn?: number;
}

function makeAgent(opts: MakeAgentOptions = {}): {
  readonly agent: DefaultAgent;
  readonly runState: AgentRunStatePort & { readonly events: RunTimelineEvent[]; readonly capabilityTerminalAnswers: string[] };
  readonly modelEvents: ModelStreamDelta[];
} {
  const contextEngine: ContextEnginePort = {
    assemble: opts.assemblyError
      ? vi.fn(async () => {
          throw opts.assemblyError;
        })
      : vi.fn(async (_request, options) => {
          const assembly = opts.assembly ?? makeAssembly();
          if (options?.mode !== 'FALLBACK') {
            return assembly;
          }
          if (opts.fallbackModelId === undefined || options.attemptedModelIds?.includes(opts.fallbackModelId)) {
            throw new AgentError({
              code: 'FALLBACK_EXHAUSTED',
              message: 'No fallback model remains.',
              category: 'UNAVAILABLE',
              retryable: false,
            });
          }
          return {
            ...assembly,
            modelConfiguration: {
              ...assembly.modelConfiguration,
              modelId: opts.fallbackModelId,
            },
          };
        }),
    render: vi.fn(async (assembly) => {
      const rendered = opts.rendered ?? makeRendered();
      return {
        ...rendered,
        modelConfiguration: assembly.modelConfiguration,
      };
    }),
  };
  const modelEvents = opts.modelEvents ?? [
    // Default: model returns a valid terminal result so tests can focus on budget notice behavior.
    { content: 'budget notice terminal', finishReason: 'stop' } as ModelStreamDelta,
  ];
  const model = opts.model ?? makeModel(modelEvents);
  const runState = makeRunState();
  if (opts.runtimeLogEntries !== undefined) {
    bindRuntimeLogger(opts.runtimeLogEntries);
  }
  const agent = new DefaultAgent({
    contextEngine,
    model,
    capabilityCatalog: makeCapabilityCatalog(),
    capabilityInvocation: opts.capabilityInvocation ?? makeCapabilityInvocation(),
    assemblyRegistry: makeAssemblyRegistry(opts.maxTurns, opts.maxToolCallsPerTurn),
    ...(opts.lifecycleHook === undefined ? {} : { lifecycleHook: opts.lifecycleHook }),
    runState,
  });
  return { agent, runState, modelEvents };
}

function bindRuntimeLogger(entries: unknown[]): void {
  const captureFailure = (fields: object): void => {
    const { err, ...safeFields } = fields as Record<string, unknown>;
    entries.push({ ...safeFields, ...(err === undefined ? {} : { caught: err }) });
  };
  const logger = {
    info(obj: object) {
      entries.push(obj);
    },
    warn: captureFailure,
    error: captureFailure,
    debug(obj: object) {
      entries.push(obj);
    },
  };
  loggerBinding?.unbind();
  loggerBinding = bindRuntimeLoggerProvider({ getLogger: () => logger });
}

// =============================================================================
// §6.1 — budgetPlan → DEGRADATION_NOTICE projection
// =============================================================================

describe('DefaultAgent.render() — budgetPlan → DEGRADATION_NOTICE projection (§6.1)', () => {
  it('emits NO DEGRADATION_NOTICE when budgetPlan is undefined (backward compat)', async () => {
    const { agent, runState } = makeAgent({ assembly: makeAssembly() });
    await agent.execute(makeRun(), makeContext(), new AbortController().signal);
    const notices = runState.events.filter((e) => e.type === 'DEGRADATION_NOTICE');
    expect(notices).toEqual([]);
  });

  it("emits NO DEGRADATION_NOTICE when budgetPlan.decision is 'continue' (happy path)", async () => {
    const { agent, runState } = makeAgent({
      assembly: makeAssemblyWithBudgetPlan(makePlan({ decision: 'continue', reasonCode: 'WITHIN_BUDGET' })),
    });
    await agent.execute(makeRun(), makeContext(), new AbortController().signal);
    const notices = runState.events.filter((e) => e.type === 'DEGRADATION_NOTICE');
    expect(notices).toEqual([]);
  });

  it("emits 1 DEGRADATION_NOTICE when budgetPlan.decision is 'compact_degrade'", async () => {
    const { agent, runState } = makeAgent({
      assembly: makeAssemblyWithBudgetPlan(
        makePlan({
          decision: 'compact_degrade',
          reasonCode: 'HISTORY_OMITTED_TO_BUDGET',
          omittedContextTypes: ['prior_active_history'],
        }),
      ),
    });
    await agent.execute(makeRun(), makeContext(), new AbortController().signal);
    const notices = runState.events.filter((e) => e.type === 'DEGRADATION_NOTICE');
    expect(notices.length).toBe(1);
    const payload = notices[0]!.inlinePayload as Record<string, unknown>;
    expect(payload.code).toBe('HISTORY_OMITTED_TO_BUDGET');
    expect(payload.decision).toBe('compact_degrade');
    expect(payload.omittedContextTypes).toEqual(['prior_active_history']);
  });

  it('emits CONTEXT_COMPACTED instead of DEGRADATION_NOTICE when compression succeeded', async () => {
    const compressionEvidence: ContextCompressionEvidence = {
      sessionId: SESSION,
      requestId: REQUEST_ID,
      runId: RUN_ID,
      stepId: STEP_ID,
      sourceActiveContextVersion: 5,
      targetActiveContextVersion: 6,
      summaryMessageId: brand<string, 'MessageId'>('summary-1'),
      strategy: 'PREFIX_COMPACT_RECENT_TAIL',
      coveredMessageRefCount: 18,
      retainedTailRefCount: 6,
      safeReason: 'CONTEXT_COMPRESSION_SUMMARY',
      edgeLabel: 'CONTEXT_COMPACTED_EVIDENCE',
    };
    const { agent, runState } = makeAgent({
      assembly: makeAssembly({
        budgetPlan: makePlan({
          decision: 'compact_degrade',
          reasonCode: 'HISTORY_OMITTED_TO_BUDGET',
          omittedContextTypes: ['prior_active_history'],
        }),
        compressionEvidence,
      }),
    });
    await agent.execute(makeRun(), makeContext(), new AbortController().signal);
    const degradationNotices = runState.events.filter((e) => e.type === 'DEGRADATION_NOTICE');
    expect(degradationNotices.length).toBe(0);
    const compactedEvents = runState.events.filter((e) => e.type === 'CONTEXT_COMPACTED');
    expect(compactedEvents.length).toBe(1);
    const payload = compactedEvents[0]!.inlinePayload as Record<string, unknown>;
    expect(payload.decision).toBe('compact_degrade');
    expect(payload.code).toBe('HISTORY_OMITTED_TO_BUDGET');
  });

  it("emits CONTEXT_COMPACTED when compression succeeded even if budgetPlan.decision is 'pre_send_check_required' (real DefaultProportionalBudgetPolicy path)", async () => {
    // The real deployed policy returns `pre_send_check_required` (NOT
    // `compact_degrade`) when the compression threshold crosses. The prior
    // emission condition excluded that decision, so CONTEXT_COMPACTED was
    // silently swallowed on real runs and the frontend never saw compression.
    const compressionEvidence: ContextCompressionEvidence = {
      sessionId: SESSION,
      requestId: REQUEST_ID,
      runId: RUN_ID,
      stepId: STEP_ID,
      sourceActiveContextVersion: 5,
      targetActiveContextVersion: 6,
      summaryMessageId: brand<string, 'MessageId'>('summary-real'),
      strategy: 'PREFIX_COMPACT_RECENT_TAIL',
      coveredMessageRefCount: 18,
      retainedTailRefCount: 6,
      safeReason: 'CONTEXT_COMPRESSION_SUMMARY',
      edgeLabel: 'CONTEXT_COMPACTED_EVIDENCE',
    };
    const { agent, runState } = makeAgent({
      assembly: makeAssembly({
        budgetPlan: makePlan({
          decision: 'pre_send_check_required',
          reasonCode: 'PRE_SEND_CHECK_REQUIRED',
          degradationMode: ['PRE_SEND_CHECK_REQUIRED'],
        }),
        compressionEvidence,
      }),
    });
    await agent.execute(makeRun(), makeContext(), new AbortController().signal);
    const compactedEvents = runState.events.filter((e) => e.type === 'CONTEXT_COMPACTED');
    expect(compactedEvents.length, 'CONTEXT_COMPACTED must fire on real-policy compression').toBe(1);
    // No DEGRADATION_NOTICE — pre_send_check_required stays suppressed.
    expect(runState.events.filter((e) => e.type === 'DEGRADATION_NOTICE').length).toBe(0);
    // The payload carries the fields the stream-envelope projection copies
    // (summaryMessageId / contextVersion / safeSummary), so the frontend
    // envelope is non-empty instead of a content-less event.
    const payload = compactedEvents[0]!.inlinePayload as Record<string, unknown>;
    expect(payload.summaryMessageId).toBe('summary-real');
    expect(payload.contextVersion).toBe(6);
    expect(payload.safeSummary).toBe('CONTEXT_COMPRESSION_SUMMARY');
  });

  it("does NOT emit DEGRADATION_NOTICE when budgetPlan.decision is 'pre_send_check_required' (internal pre-flight check)", async () => {
    const { agent, runState } = makeAgent({
      assembly: makeAssemblyWithBudgetPlan(
        makePlan({
          decision: 'pre_send_check_required',
          reasonCode: 'PRE_SEND_CHECK_REQUIRED',
          degradationMode: ['PRE_SEND_CHECK_REQUIRED'],
        }),
      ),
    });
    await agent.execute(makeRun(), makeContext(), new AbortController().signal);
    const notices = runState.events.filter((e) => e.type === 'DEGRADATION_NOTICE');
    expect(notices.length).toBe(0);
  });

  it('emits 1 DEGRADATION_NOTICE with code MINIMUM_SAFE_CONTEXT_EXCEEDS_BUDGET when assemble() throws CONTEXT_INSUFFICIENT_BUDGET, then re-throws', async () => {
    const insufficientError = new AgentError({
      code: 'CONTEXT_INSUFFICIENT_BUDGET',
      message: 'Context assembly cannot proceed: MINIMUM_SAFE_CONTEXT_EXCEEDS_BUDGET.',
      category: 'VALIDATION',
      retryable: false,
      safeDetails: {
        reasonCode: 'MINIMUM_SAFE_CONTEXT_EXCEEDS_BUDGET',
        pipelineStageStoppedAt: 'agent-context-engine.budget-decision-gate.minimum-safe-context-protection',
        estimatedFinalInputUnits: 200,
        omittedContextTypes: ['current_request'],
      },
    });
    const { agent, runState } = makeAgent({ assemblyError: insufficientError });
    await expect(agent.execute(makeRun(), makeContext(), new AbortController().signal)).rejects.toBe(insufficientError);
    const notices = runState.events.filter((e) => e.type === 'DEGRADATION_NOTICE');
    expect(notices.length).toBe(1);
    const payload = notices[0]!.inlinePayload as Record<string, unknown>;
    expect(payload.code).toBe('MINIMUM_SAFE_CONTEXT_EXCEEDS_BUDGET');
    expect(payload.decision).toBe('explicit_failure');
  });

  it('does not duplicate context assembly failure into a core-owned runtime log', async () => {
    const runtimeLogEntries: unknown[] = [];
    const assemblyError = new Error('raw context failure at C:\\secret\\prompt.txt');
    const { agent } = makeAgent({ assemblyError, runtimeLogEntries });

    await expect(agent.execute(makeRun(), makeContext(), new AbortController().signal)).rejects.toBe(assemblyError);

    expect(runtimeLogEntries).toEqual([]);
  });

  it('records Model payload failure once at the invocation boundary before propagation', async () => {
    const runtimeLogEntries: unknown[] = [];
    const failure = new Error('model stream failed at /tmp/model.err');
    const model = {
      complete: async () => {
        throw new Error('not used in this test');
      },
      stream: modelEventStreamFixture(async function* () {
        throw failure;
      }),
    } satisfies ModelInvocationService;
    bindRuntimeLogger(runtimeLogEntries);
    const agent = new DefaultAgent({
      contextEngine: {
        assemble: vi.fn(async () => makeAssembly()),
        render: vi.fn(async () => makeRendered()),
      },
      model,
      capabilityCatalog: makeCapabilityCatalog(),
      capabilityInvocation: makeCapabilityInvocation(),
      assemblyRegistry: makeAssemblyRegistry(),
      runState: makeRunState(),
    });

    await expect(agent.execute(makeRun(), makeContext(), new AbortController().signal)).rejects.toBe(failure);

    expect(runtimeLogEntries).toEqual([
      expect.objectContaining({ event: 'model.payload.input_captured', stepId: 'turn-1' }),
      expect.objectContaining({ event: 'model.payload.failed', stepId: 'turn-1', caught: failure }),
    ]);
  });

  it("re-throws OTHER errors WITHOUT emitting a DEGRADATION_NOTICE (don't masquerade as budget failure)", async () => {
    const otherError = new Error('context engine broken');
    const { agent, runState } = makeAgent({ assemblyError: otherError });
    await expect(agent.execute(makeRun(), makeContext(), new AbortController().signal)).rejects.toBe(otherError);
    const notices = runState.events.filter((e) => e.type === 'DEGRADATION_NOTICE');
    expect(notices).toEqual([]);
  });

  it('DEGRADATION_NOTICE payload NEVER includes the raw budgetEvidence array (only the safe plan summary)', async () => {
    const { agent, runState } = makeAgent({
      assembly: makeAssemblyWithBudgetPlan(
        makePlan({
          decision: 'compact_degrade',
          reasonCode: 'HISTORY_OMITTED_TO_BUDGET',
        }),
      ),
    });
    await agent.execute(makeRun(), makeContext(), new AbortController().signal);
    const notice = runState.events.find((e) => e.type === 'DEGRADATION_NOTICE');
    expect(notice).toBeDefined();
    const serialized = JSON.stringify(notice!.inlinePayload);
    // The payload MUST NOT carry the budgetEvidence safeIdentifier (high-cardinality)
    expect(serialized).not.toContain('safeIdentifier');
    expect(serialized).not.toContain('owningBoundary');
    expect(serialized).not.toContain('budgetEvidence');
  });

  it('emits safe attachment degradation notice details when context assembly carries degradation evidence', async () => {
    const { agent, runState } = makeAgent({
      assembly: makeAssembly({
        attachmentDegradationEvidence: [
          {
            safeReasonCode: 'ATTACHMENT_LATEST_OPTIONAL_DEGRADED',
            projectionKind: 'metadata-only',
            readable: true,
            reason: 'attachment requires explicit degradation',
          },
        ],
      }),
    });

    await agent.execute(makeRun(), makeContext(), new AbortController().signal);

    const notice = runState.events.find((e) => e.type === 'DEGRADATION_NOTICE');
    expect(notice).toBeDefined();
    expect(JSON.stringify(notice?.inlinePayload)).toContain('ATTACHMENT_LATEST_OPTIONAL_DEGRADED');
    expect(JSON.stringify(notice?.inlinePayload)).not.toContain('BlobRef');
  });
});

describe('DefaultAgent.executeRun() — Tool call prefix admission', () => {
  it('ignores an omitted suffix when validating a non-agentic ApiCall batch', async () => {
    const capabilityInvocation: CapabilityInvocationPort = {
      invoke: vi
        .fn()
        .mockResolvedValueOnce({
          status: 'SUCCEEDED' as const,
          structuredPayload: { apiCommand: { name: 'lookup' } },
          generatedMessages: [],
          artifactRefs: [],
          metadata: { nonAgenticApiCall: true },
        })
        .mockResolvedValueOnce({
          status: 'SUCCEEDED' as const,
          structuredPayload: { status: 'ok' },
          generatedMessages: [],
          artifactRefs: [],
        }),
    };
    const { agent, runState } = makeAgent({
      capabilityInvocation,
      maxToolCallsPerTurn: 1,
      modelEvents: [
        {
          content: '',
          finishReason: 'tool-calls',
          toolCalls: [
            { toolCallId: 'admitted-api-source', toolName: 'Read', arguments: {} },
            { toolCallId: 'omitted-suffix', toolName: 'Read', arguments: {} },
          ],
        } as ModelStreamDelta,
      ],
    });

    await expect(agent.execute(makeRun(), makeContext(), new AbortController().signal)).resolves.toMatchObject({ status: 'COMPLETED' });
    expect(capabilityInvocation.invoke).toHaveBeenCalledTimes(2);
    expect(capabilityInvocation.invoke).not.toHaveBeenCalledWith(
      expect.objectContaining({ invocationId: 'omitted-suffix' }),
      expect.anything(),
      expect.anything(),
    );
    expect(runState.capabilityTerminalAnswers).toEqual([JSON.stringify({ status: 'ok' })]);
    expect(runState.events.filter((event) => event.type === 'LLM_CONTENT_DELTA' && event.inlinePayload.final === true)).toEqual([]);
  });
});

// =============================================================================
// §5.2 — output-window safety (no silent truncation)
// =============================================================================

describe('DefaultAgent.executeRun() — output-window safety (§5.2)', () => {
  it('allows terminal model content at the 50000-character boundary', async () => {
    const boundaryContent = 'x'.repeat(50_000);
    const { agent, runState } = makeAgent({
      modelEvents: [{ content: boundaryContent, finishReason: 'stop' } as ModelStreamDelta],
    });

    await agent.execute(makeRun(), makeContext(), new AbortController().signal);

    const finalEvent = runState.events.find(
      (event) => event.type === 'LLM_CONTENT_DELTA' && (event.inlinePayload as { final?: boolean }).final === true,
    );
    expect((finalEvent?.inlinePayload as { content?: string }).content).toHaveLength(50_000);
    expect(runState.events).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'DEGRADATION_NOTICE',
          inlinePayload: expect.objectContaining({ code: 'MODEL_TEXT_LIMIT_EXCEEDED' }),
        }),
      ]),
    );
  });

  it('preserves a bounded marked prefix when final-only model content exceeds the visible limit', async () => {
    const oversized = `retained-prefix-${'x'.repeat(50_000)}-discarded-tail`;
    const { agent, runState } = makeAgent({
      modelEvents: [{ content: oversized, finishReason: 'stop' } as ModelStreamDelta],
    });

    await agent.execute(makeRun(), makeContext(), new AbortController().signal);

    const notices = runState.events.filter(
      (e) => e.type === 'DEGRADATION_NOTICE' && (e.inlinePayload as { code?: string }).code === 'MODEL_TEXT_LIMIT_EXCEEDED',
    );
    expect(notices).toHaveLength(1);
    const finalEvent = runState.events.find(
      (event) => event.type === 'LLM_CONTENT_DELTA' && (event.inlinePayload as { final?: boolean }).final === true,
    );
    const content = (finalEvent?.inlinePayload as { content?: string }).content ?? '';
    expect(content).toHaveLength(50_000);
    expect(content).toMatch(/^retained-prefix-/u);
    expect(content.endsWith('[Model output truncated at the 50000-character safety limit.]')).toBe(true);
    expect(content).not.toContain('discarded-tail');
  });

  it('stops an oversized stream without fallback or executing a later tool call', async () => {
    const oversized = `stream-prefix-${'x'.repeat(50_000)}-discarded-tail`;
    const toolCall = {
      toolCallId: 'call-after-limit',
      toolName: 'Read',
      arguments: { file_path: 'package.json' },
    };
    const requests: ModelInvocationRequest[] = [];
    const model = makeQueuedModel([[{ content: oversized }, { content: oversized, finishReason: 'stop', toolCalls: [toolCall] }]], requests);
    const capabilityInvocation = makeCapabilityInvocation();
    const { agent, runState } = makeAgent({
      model,
      capabilityInvocation,
      fallbackModelId: 'fallback-model',
    });

    await agent.execute(makeRun(), makeContext(), new AbortController().signal);

    expect(requests).toHaveLength(1);
    expect(capabilityInvocation.invoke).not.toHaveBeenCalled();
    expect(
      runState.events.filter(
        (event) => event.type === 'DEGRADATION_NOTICE' && (event.inlinePayload as { code?: string }).code === 'MODEL_TEXT_LIMIT_EXCEEDED',
      ),
    ).toHaveLength(1);
    const finalEvent = runState.events.find(
      (event) => event.type === 'LLM_CONTENT_DELTA' && (event.inlinePayload as { final?: boolean }).final === true,
    );
    const content = (finalEvent?.inlinePayload as { content?: string }).content ?? '';
    expect(content).toHaveLength(50_000);
    expect(content).toContain('stream-prefix-');
    expect(content).toContain('[Model output truncated at the 50000-character safety limit.]');
    expect(content).not.toContain('discarded-tail');
  });

  it('runs one model-only finalizing turn, preserves descriptors, and discards model and terminal-hook tool calls', async () => {
    const requests: ModelInvocationRequest[] = [];
    const normalCall = { toolCallId: 'normal-call', toolName: 'Read', arguments: {} };
    const finalCall = { toolCallId: 'final-call', toolName: 'Read', arguments: {} };
    const hookCall = { toolCallId: 'hook-call', toolName: 'Read', arguments: {} };
    const model = makeQueuedModel(
      [
        [{ content: '', finishReason: 'tool-calls', toolCalls: [normalCall] }],
        [{ content: 'verified final summary', finishReason: 'stop', toolCalls: [finalCall] }],
      ],
      requests,
    );
    const capabilityInvocation = makeCapabilityInvocation();
    const lifecycleHook: LifecycleHookInvocationPort = {
      invoke: vi.fn(async (request) => ({
        status: 'CONTINUE' as const,
        boundary:
          request.stage === 'BEFORE_AGENT_TERMINAL' ? ({ ...request.boundary, toolCalls: [hookCall] } as typeof request.boundary) : request.boundary,
      })),
    };
    const { agent, runState } = makeAgent({
      model,
      capabilityInvocation,
      lifecycleHook,
      rendered: {
        ...makeRendered(),
        tools: [{ capabilityId: 'Read', name: 'Read', inputSchema: {} }],
      },
    });

    await agent.execute(makeRun(), makeContext(), new AbortController().signal);

    expect(requests).toHaveLength(2);
    expect(requests[1]).toMatchObject({ toolChoice: 'NONE', tools: [{ name: 'Read' }] });
    expect(capabilityInvocation.invoke).toHaveBeenCalledTimes(1);
    expect(runState.events).toContainEqual(
      expect.objectContaining({ type: 'DEGRADATION_NOTICE', inlinePayload: expect.objectContaining({ code: 'TOOL_ROUND_LIMIT_EXCEEDED' }) }),
    );
    expect(runState.events).toContainEqual(
      expect.objectContaining({
        type: 'LLM_CONTENT_DELTA',
        inlinePayload: expect.objectContaining({ final: true, content: 'verified final summary' }),
      }),
    );
    expect(JSON.stringify(runState.events)).not.toContain('final-call');
    expect(JSON.stringify(runState.events)).not.toContain('hook-call');
  });

  it.each([
    {
      name: 'tool calls only',
      result: { content: '', finishReason: 'tool-calls', toolCalls: [{ toolCallId: 'only-final-call', toolName: 'Read', arguments: {} }] },
    },
    { name: 'empty text', result: { content: '', finishReason: 'stop' } },
  ])('fails safely when the finalizing turn returns $name and never starts a second finalizing turn', async ({ result }) => {
    const requests: ModelInvocationRequest[] = [];
    const capabilityInvocation = makeCapabilityInvocation();
    const model = makeQueuedModel(
      [
        [{ content: '', finishReason: 'tool-calls', toolCalls: [{ toolCallId: 'normal-call', toolName: 'Read', arguments: {} }] }],
        [result as ModelFinalResult],
        [{ content: 'must not run', finishReason: 'stop' }],
      ],
      requests,
    );
    const { agent } = makeAgent({ model, capabilityInvocation });

    await expect(agent.execute(makeRun(), makeContext(), new AbortController().signal)).rejects.toMatchObject({
      code: 'TOOL_ROUND_LIMIT_EXCEEDED',
    });
    expect(requests).toHaveLength(2);
    expect(capabilityInvocation.invoke).toHaveBeenCalledTimes(1);
  });

  it('preserves a finalizing model SafeError and never starts another model turn', async () => {
    const requests: ModelInvocationRequest[] = [];
    const safeError = { code: 'FINAL_SUMMARY_FAILED', message: 'summary unavailable', category: 'UNAVAILABLE' as const, retryable: true };
    const model = makeQueuedModel(
      [
        [{ content: '', finishReason: 'tool-calls', toolCalls: [{ toolCallId: 'normal-call', toolName: 'Read', arguments: {} }] }],
        [{ content: '', finishReason: 'error', safeError }],
        [{ content: 'must not run', finishReason: 'stop' }],
      ],
      requests,
    );
    const { agent } = makeAgent({ model, fallbackModelId: 'fallback-model' });

    await expect(agent.execute(makeRun(), makeContext(), new AbortController().signal)).rejects.toMatchObject({ code: safeError.code });
    expect(requests).toHaveLength(2);
  });

  it('keeps cancellation authoritative during finalizing and starts no later turn', async () => {
    const requests: ModelInvocationRequest[] = [];
    const controller = new AbortController();
    const model: ModelInvocationService = {
      complete: async () => {
        throw new Error('not used');
      },
      stream: modelEventStreamFixture(async function* (request, signal) {
        requests.push(request);
        if (requests.length === 1) {
          yield { content: '', finishReason: 'tool-calls', toolCalls: [{ toolCallId: 'normal-call', toolName: 'Read', arguments: {} }] };
          return;
        }
        controller.abort(new Error('cancel finalizing'));
        signal.throwIfAborted();
      }),
    };
    const { agent } = makeAgent({ model });

    await expect(agent.execute(makeRun(), makeContext(), controller.signal)).rejects.toThrow('cancel finalizing');
    expect(requests).toHaveLength(2);
  });

  it("the model's final error (safeError) is projected as a DEGRADATION_NOTICE before the error is re-thrown", async () => {
    const safeError = { code: 'MODEL_REFUSAL', message: 'refused', category: 'INTERNAL' as const, retryable: false };
    const finalResult: ModelFinalResult = { content: '', finishReason: 'error', safeError };
    const { agent, runState } = makeAgent({
      modelEvents: [finalResult as unknown as ModelStreamDelta],
    });
    await expect(agent.execute(makeRun(), makeContext(), new AbortController().signal)).rejects.toMatchObject({
      code: 'MODEL_REFUSAL',
    });
    const notices = runState.events.filter((e) => e.type === 'DEGRADATION_NOTICE' && (e.inlinePayload as { code?: string }).code === 'MODEL_REFUSAL');
    expect(notices.length).toBeGreaterThanOrEqual(1);
  });

  it('a final result with normal content + stop finishReason emits NO DEGRADATION_NOTICE (happy path)', async () => {
    const finalResult: ModelFinalResult = { content: 'hello world', finishReason: 'stop' };
    const { agent, runState } = makeAgent({
      modelEvents: [finalResult as unknown as ModelStreamDelta],
    });
    await agent.execute(makeRun(), makeContext(), new AbortController().signal);
    const notices = runState.events.filter((e) => e.type === 'DEGRADATION_NOTICE');
    expect(notices).toEqual([]);
  });
});

// =============================================================================
// MODEL_EMPTY_OUTPUT guard — empty content + no tool calls + stop
// =============================================================================

describe('DefaultAgent.executeRun() — MODEL_EMPTY_OUTPUT guard', () => {
  it('persists final-only reasoning before the model invocation terminal event', async () => {
    const model = makeQueuedModel([[{ content: 'answer', reasoning: 'final-only reasoning', finishReason: 'stop' }]], []);
    const { agent, runState } = makeAgent({ model });

    await agent.execute(makeRun(), makeContext(), new AbortController().signal);

    const completedThinking = runState.events.filter(
      (event) =>
        event.type === 'LLM_THINKING_DELTA' &&
        event.persistence === 'PERSISTED' &&
        (event.inlinePayload as { completed?: boolean }).completed === true,
    );
    expect(completedThinking).toHaveLength(1);
    expect(completedThinking[0]?.inlinePayload).toMatchObject({
      reasoning: 'final-only reasoning',
      completed: true,
    });
    expect(runState.events.indexOf(completedThinking[0]!)).toBeLessThan(
      runState.events.findIndex((event) => event.type === 'MODEL_INVOCATION_COMPLETED'),
    );
  });

  it('persists the canonical final reasoning instead of the streamed draft', async () => {
    const model = makeQueuedModel(
      [[{ reasoning: 'streamed draft' }, { content: 'answer', reasoning: 'canonical final reasoning', finishReason: 'stop' }]],
      [],
    );
    const { agent, runState } = makeAgent({ model });

    await agent.execute(makeRun(), makeContext(), new AbortController().signal);

    const completedThinking = runState.events.filter(
      (event) =>
        event.type === 'LLM_THINKING_DELTA' &&
        event.persistence === 'PERSISTED' &&
        (event.inlinePayload as { completed?: boolean }).completed === true,
    );
    expect(completedThinking).toHaveLength(1);
    expect(completedThinking[0]?.inlinePayload).toMatchObject({
      reasoning: 'canonical final reasoning',
      completed: true,
    });
    expect(completedThinking[0]?.inlinePayload).not.toMatchObject({ reasoning: 'streamed draft' });
  });

  it('corrects a reasoning-only stop exactly once before completing with visible content', async () => {
    const requests: ModelInvocationRequest[] = [];
    const model = makeQueuedModel(
      [
        [{ reasoning: 'internal analysis' }, { content: '', reasoning: 'internal analysis', finishReason: 'stop' }],
        [{ content: 'corrected answer', finishReason: 'stop' }],
      ],
      requests,
    );
    const { agent, runState } = makeAgent({ model });

    await agent.execute(makeRun(), makeContext(), new AbortController().signal);

    expect(requests).toHaveLength(2);
    expect(requests[0]?.modelId).toBe('test-model');
    expect(requests[1]?.modelId).toBe('test-model');
    expect(requests[1]?.messages.slice(-1)).toEqual([
      {
        role: 'USER',
        content: [
          {
            type: 'text',
            text: 'The previous response ended after internal reasoning without user-visible content or a tool call. Return either a concise user-visible answer or one necessary tool call now. Do not repeat internal reasoning or describe what you plan to do.',
          },
        ],
      },
    ]);
    expect(JSON.stringify(requests[1]?.messages)).not.toContain('internal analysis');
    const finalDelta = runState.events.find(
      (event) => event.type === 'LLM_CONTENT_DELTA' && (event.inlinePayload as { final?: boolean }).final === true,
    );
    expect(finalDelta?.inlinePayload).toMatchObject({ content: 'corrected answer' });
  });

  it('preserves the correction message when a corrected response needs a larger output budget', async () => {
    const requests: ModelInvocationRequest[] = [];
    const model = makeQueuedModel(
      [
        [{ content: '', reasoning: 'internal analysis', finishReason: 'stop' }],
        [{ content: 'partial corrected answer', finishReason: 'length', incompleteOutputReason: 'output-limit', usage: { inputTokens: 1_000 } }],
        [{ content: 'complete corrected answer', finishReason: 'stop' }],
      ],
      requests,
    );
    const { agent, runState } = makeAgent({ model });

    await agent.execute(makeRun(), makeContext(), new AbortController().signal);

    expect(requests).toHaveLength(3);
    expect(requests[2]?.messages).toEqual(requests[1]?.messages);
    expect(requests[2]?.maxOutputTokens).toBeGreaterThan(requests[1]?.maxOutputTokens ?? 0);
    const finalDelta = runState.events.find(
      (event) => event.type === 'LLM_CONTENT_DELTA' && (event.inlinePayload as { final?: boolean }).final === true,
    );
    expect(finalDelta?.inlinePayload).toMatchObject({ content: 'complete corrected answer' });
  });

  it('falls back only after one corrective invocation also returns reasoning-only', async () => {
    const requests: ModelInvocationRequest[] = [];
    const model = makeQueuedModel(
      [
        [{ reasoning: 'first analysis' }, { content: '', reasoning: 'first analysis', finishReason: 'stop' }],
        [{ reasoning: 'second analysis' }, { content: '', reasoning: 'second analysis', finishReason: 'stop' }],
        [{ content: 'fallback answer', finishReason: 'stop' }],
      ],
      requests,
    );
    const { agent } = makeAgent({ model, fallbackModelId: 'fallback-model' });

    await agent.execute(makeRun(), makeContext(), new AbortController().signal);

    expect(requests.map((request) => request.modelId)).toEqual(['test-model', 'test-model', 'fallback-model']);
    expect(
      requests.filter((request) => JSON.stringify(request.messages).includes('The previous response ended after internal reasoning')),
    ).toHaveLength(1);
  });

  it('does not give a reasoning-only fallback route a second corrective invocation', async () => {
    const requests: ModelInvocationRequest[] = [];
    const reasoningOnly = (reasoning: string): ModelStreamDelta[] => [
      { reasoning },
      {
        content: '',
        reasoning,
        finishReason: 'length',
        incompleteOutputReason: 'output-limit',
        usage: { inputTokens: 1_000, outputTokens: 2_048, totalTokens: 3_048 },
      } as ModelFinalResult,
    ];
    const model = makeQueuedModel(
      [reasoningOnly('primary analysis'), reasoningOnly('corrective analysis'), reasoningOnly('fallback analysis')],
      requests,
    );
    const { agent } = makeAgent({ model, fallbackModelId: 'fallback-model' });

    await expect(agent.execute(makeRun(), makeContext(), new AbortController().signal)).rejects.toMatchObject({
      code: 'MODEL_EMPTY_OUTPUT',
    });

    expect(requests.map((request) => request.modelId)).toEqual(['test-model', 'test-model', 'fallback-model']);
    expect(requests.map((request) => request.maxOutputTokens)).toEqual([4_096, 4_096, 4_096]);
    expect(
      requests.filter((request) => JSON.stringify(request.messages).includes('The previous response ended after internal reasoning')),
    ).toHaveLength(1);
  });

  it('does not correct a reasoning-only continuation after visible output was confirmed', async () => {
    const requests: ModelInvocationRequest[] = [];
    const model = makeQueuedModel(
      [
        [{ content: 'confirmed prefix', finishReason: 'length', incompleteOutputReason: 'output-limit', usage: { inputTokens: 127_000 } }],
        [{ reasoning: 'continuation analysis' }, { content: '', reasoning: 'continuation analysis', finishReason: 'stop' }],
      ],
      requests,
    );
    const { agent, runState } = makeAgent({ model });

    await agent.execute(makeRun(), makeContext(), new AbortController().signal);

    expect(requests).toHaveLength(2);
    expect(requests.some((request) => JSON.stringify(request.messages).includes('The previous response ended after internal reasoning'))).toBe(false);
    const finalDelta = runState.events.find(
      (event) => event.type === 'LLM_CONTENT_DELTA' && (event.inlinePayload as { final?: boolean }).final === true,
    );
    expect(finalDelta?.inlinePayload).toMatchObject({ content: 'confirmed prefix' });
  });

  it('throws MODEL_EMPTY_OUTPUT when the model returns empty content with no tool calls and no fallback route', async () => {
    const { agent, runState } = makeAgent({
      modelEvents: [{ content: '', finishReason: 'stop' } as ModelStreamDelta],
    });
    await expect(agent.execute(makeRun(), makeContext(), new AbortController().signal)).rejects.toMatchObject({
      code: 'MODEL_EMPTY_OUTPUT',
    });
    const notices = runState.events.filter(
      (e) => e.type === 'DEGRADATION_NOTICE' && (e.inlinePayload as { code?: string }).code === 'MODEL_EMPTY_OUTPUT',
    );
    expect(notices.length).toBeGreaterThanOrEqual(1);
  });

  it('does not trigger when the model returns non-empty content', async () => {
    const { agent, runState } = makeAgent({
      modelEvents: [{ content: 'hello world', finishReason: 'stop' } as ModelStreamDelta],
    });
    await agent.execute(makeRun(), makeContext(), new AbortController().signal);
    const notices = runState.events.filter(
      (e) => e.type === 'DEGRADATION_NOTICE' && (e.inlinePayload as { code?: string }).code === 'MODEL_EMPTY_OUTPUT',
    );
    expect(notices).toEqual([]);
  });

  it('does not trigger when the model returns tool calls (enters tool loop path)', async () => {
    // The model returns a tool call — the empty-content guard must not fire
    // because toolCalls.length > 0 takes a different branch.
    const toolCall = { toolCallId: 'call-1', toolName: 'Read', arguments: { file_path: 'package.json', offset: 0, limit: 1 } };
    const { agent, runState } = makeAgent({
      modelEvents: [
        { content: '', finishReason: 'tool-calls', toolCalls: [toolCall] } as ModelStreamDelta,
        { content: 'done', finishReason: 'stop' } as ModelStreamDelta,
      ],
    });
    await agent.execute(makeRun(), makeContext(), new AbortController().signal);
    const notices = runState.events.filter(
      (e) => e.type === 'DEGRADATION_NOTICE' && (e.inlinePayload as { code?: string }).code === 'MODEL_EMPTY_OUTPUT',
    );
    expect(notices).toEqual([]);
  });

  it('does not correct reasoning that accompanies a tool call', async () => {
    const requests: ModelInvocationRequest[] = [];
    const toolCall = { toolCallId: 'call-reasoning-tool', toolName: 'Read', arguments: { file_path: 'package.json', offset: 0, limit: 1 } };
    const model = makeQueuedModel(
      [
        [{ reasoning: 'tool analysis' }, { content: '', reasoning: 'tool analysis', finishReason: 'tool-calls', toolCalls: [toolCall] }],
        [{ content: 'final summary', finishReason: 'stop' }],
      ],
      requests,
    );
    const { agent } = makeAgent({ model });

    await expect(agent.execute(makeRun(), makeContext(), new AbortController().signal)).resolves.toMatchObject({ status: 'COMPLETED' });

    expect(requests).toHaveLength(2);
    expect(requests.some((request) => JSON.stringify(request.messages).includes('The previous response ended after internal reasoning'))).toBe(false);
  });

  it('falls back to an alternate model when the first returns empty content', async () => {
    // First call: empty content → MODEL_EMPTY_OUTPUT synthesized → fallback.
    // Second call (fallback model): non-empty content → normal completion.
    const step1: ModelStreamDelta[] = [{ content: '', finishReason: 'stop' } as ModelStreamDelta];
    const step2: ModelStreamDelta[] = [{ content: 'fallback answer', finishReason: 'stop' } as ModelStreamDelta];
    let callIndex = 0;
    const multiStepModel: ModelInvocationService = {
      complete: async () => {
        throw new Error('not used');
      },
      stream: modelEventStreamFixture(async function* (_request, _signal) {
        const events = callIndex === 0 ? step1 : step2;
        callIndex += 1;
        for (const event of events) {
          yield event;
        }
      }),
    };
    const contextEngine: ContextEnginePort = {
      assemble: vi.fn(async (_request, options) => {
        const assembly = makeAssembly();
        return options?.mode === 'FALLBACK'
          ? {
              ...assembly,
              modelConfiguration: {
                ...assembly.modelConfiguration,
                modelId: 'fallback-model',
              },
            }
          : assembly;
      }),
      render: vi.fn(async (assembly) => ({
        ...makeRendered(),
        modelConfiguration: assembly.modelConfiguration,
      })),
    };
    const runState = makeRunState();
    const agent = new DefaultAgent({
      contextEngine,
      model: multiStepModel,
      capabilityCatalog: makeCapabilityCatalog(),
      capabilityInvocation: makeCapabilityInvocation(),
      assemblyRegistry: makeAssemblyRegistry(),
      runState,
    });

    await agent.execute(makeRun(), makeContext(), new AbortController().signal);

    // The fallback model produced visible content, so the run should complete
    // without throwing MODEL_EMPTY_OUTPUT.
    const finalDelta = runState.events.find((e) => e.type === 'LLM_CONTENT_DELTA' && (e.inlinePayload as { final?: boolean }).final === true);
    expect(finalDelta).toBeDefined();
    expect((finalDelta!.inlinePayload as { content: string }).content).toBe('fallback answer');
  });
});

describe('DefaultAgent.executeRun() — output token limit recovery', () => {
  it('does not correct a reasoning-only length terminal without incomplete-output evidence', async () => {
    const requests: ModelInvocationRequest[] = [];
    const model = makeQueuedModel([[{ content: '', reasoning: 'provider reasoning', finishReason: 'length' }]], requests);
    const { agent } = makeAgent({ model });

    await expect(agent.execute(makeRun(), makeContext(), new AbortController().signal)).rejects.toMatchObject({
      code: 'MODEL_EMPTY_OUTPUT',
    });
    expect(requests).toHaveLength(1);
  });

  it('does not recover from finishReason length without incomplete-output evidence', async () => {
    const requests: ModelInvocationRequest[] = [];
    const model = makeQueuedModel([[{ content: 'provider result', finishReason: 'length' }]], requests);
    const { agent, runState } = makeAgent({ model, assembly: makeRecoveryAssembly(), rendered: makeRecoveryRendered() });

    await agent.execute(makeRun(), makeContext(), new AbortController().signal);

    expect(requests).toHaveLength(1);
    const finalEvent = runState.events.find(
      (event) => event.type === 'LLM_CONTENT_DELTA' && (event.inlinePayload as { final?: boolean }).final === true,
    );
    expect((finalEvent?.inlinePayload as { content?: string }).content).toBe('provider result');
  });

  it('corrects the first reasoning-only output-limit at the original budget before escalation', async () => {
    const requests: ModelInvocationRequest[] = [];
    const emptyLength = {
      content: '',
      reasoning: 'saturated internal reasoning',
      finishReason: 'length' as const,
      incompleteOutputReason: 'output-limit' as const,
      usage: { inputTokens: 1_000, outputTokens: 16_384, totalTokens: 17_384 },
    };
    const model = makeQueuedModel([[emptyLength], [{ content: 'corrected answer', finishReason: 'stop' }]], requests);
    const { agent, runState } = makeAgent({
      model,
      assembly: makeRecoveryAssembly(16_384),
      rendered: makeRecoveryRendered(16_384),
    });

    await agent.execute(makeRun(), makeContext(), new AbortController().signal);

    expect(requests).toHaveLength(2);
    expect(requests.map((request) => request.maxOutputTokens)).toEqual([16_384, 16_384]);
    expect(requests[1]?.messages.slice(-1)).toEqual([
      {
        role: 'USER',
        content: [
          {
            type: 'text',
            text: 'The previous response ended after internal reasoning without user-visible content or a tool call. Return either a concise user-visible answer or one necessary tool call now. Do not repeat internal reasoning or describe what you plan to do.',
          },
        ],
      },
    ]);
    expect(JSON.stringify(requests[1]?.messages)).not.toContain('saturated internal reasoning');
    const finalDelta = runState.events.find(
      (event) => event.type === 'LLM_CONTENT_DELTA' && (event.inlinePayload as { final?: boolean }).final === true,
    );
    expect(finalDelta?.inlinePayload).toMatchObject({ content: 'corrected answer' });
  });

  it('falls back without escalation or continuation when the correction also exhausts on reasoning only', async () => {
    const requests: ModelInvocationRequest[] = [];
    const emptyLength = {
      content: '',
      reasoning: 'saturated internal reasoning',
      finishReason: 'length' as const,
      incompleteOutputReason: 'output-limit' as const,
      usage: { inputTokens: 1_000, outputTokens: 16_384, totalTokens: 17_384 },
    };
    const model = makeQueuedModel([[emptyLength], [{ ...emptyLength }], [{ content: 'fallback answer', finishReason: 'stop' }]], requests);
    const { agent, runState } = makeAgent({
      model,
      fallbackModelId: 'fallback-model',
      assembly: makeRecoveryAssembly(16_384),
      rendered: makeRecoveryRendered(16_384),
    });

    await agent.execute(makeRun(), makeContext(), new AbortController().signal);

    expect(requests.map((request) => request.modelId)).toEqual(['test-model', 'test-model', 'fallback-model']);
    expect(requests.slice(0, 2).map((request) => request.maxOutputTokens)).toEqual([16_384, 16_384]);
    const correctionText =
      'The previous response ended after internal reasoning without user-visible content or a tool call. Return either a concise user-visible answer or one necessary tool call now. Do not repeat internal reasoning or describe what you plan to do.';
    const correctionMessageCounts = requests.map(
      (request) =>
        request.messages.filter(
          (message) =>
            message.role === 'USER' &&
            message.content.length === 1 &&
            message.content[0]?.type === 'text' &&
            (message.content[0] as { text?: string }).text === correctionText,
        ).length,
    );
    expect(correctionMessageCounts).toEqual([0, 1, 0]);
    const finalDelta = runState.events.find(
      (event) => event.type === 'LLM_CONTENT_DELTA' && (event.inlinePayload as { final?: boolean }).final === true,
    );
    expect(finalDelta?.inlinePayload).toMatchObject({ content: 'fallback answer' });
  });

  it('fails a finalizing turn when its correction also exhausts on reasoning only', async () => {
    const requests: ModelInvocationRequest[] = [];
    const capabilityInvocation = makeCapabilityInvocation();
    const toolCall = { toolCallId: 'call-before-finalizing', toolName: 'Read', arguments: { file_path: 'package.json' } };
    const emptyLength = {
      content: '',
      reasoning: 'finalizing analysis',
      finishReason: 'length' as const,
      incompleteOutputReason: 'output-limit' as const,
      usage: { inputTokens: 1_000, outputTokens: 16_384, totalTokens: 17_384 },
    };
    const model = makeQueuedModel([[{ content: '', finishReason: 'tool-calls', toolCalls: [toolCall] }], [emptyLength], [emptyLength]], requests);
    const runState = makeRunState();
    const agent = new DefaultAgent({
      contextEngine: {
        assemble: vi.fn(async () => makeRecoveryAssembly(16_384)),
        render: vi.fn(async () => makeRecoveryRendered(16_384)),
      },
      model,
      capabilityCatalog: makeCapabilityCatalog(),
      capabilityInvocation,
      assemblyRegistry: makeAssemblyRegistry(1),
      runState,
    });

    await expect(agent.execute(makeRun(), makeContext(), new AbortController().signal)).rejects.toMatchObject({
      code: 'MODEL_EMPTY_OUTPUT',
    });
    expect(requests.map((request) => request.maxOutputTokens)).toEqual([16_384, 16_384, 16_384]);
    expect(capabilityInvocation.invoke).toHaveBeenCalledTimes(1);
  });

  it('regenerates a truncated tool call once and then executes only the complete call', async () => {
    const requests: ModelInvocationRequest[] = [];
    const completeCall = { toolCallId: 'call-complete', toolName: 'Read', arguments: { file_path: 'package.json' } };
    const model = makeQueuedModel(
      [
        [{ content: '', finishReason: 'tool-calls', incompleteOutputReason: 'truncated-tool-call' }],
        [{ content: '', finishReason: 'tool-calls', toolCalls: [completeCall] }],
        [{ content: 'done', finishReason: 'stop' }],
      ],
      requests,
    );
    const capabilityInvocation = makeCapabilityInvocation();
    const runState = makeRunState();
    const agent = new DefaultAgent({
      contextEngine: { assemble: vi.fn(async () => makeRecoveryAssembly()), render: vi.fn(async () => makeRecoveryRendered()) },
      model,
      capabilityCatalog: makeCapabilityCatalog(),
      capabilityInvocation,
      assemblyRegistry: makeAssemblyRegistry(2),
      runState,
    });

    await agent.execute(makeRun(), makeContext(), new AbortController().signal);

    expect(requests).toHaveLength(3);
    expect(requests[1]?.maxOutputTokens).toBe(16_384);
    expect(capabilityInvocation.invoke).toHaveBeenCalledTimes(1);
  });

  it('fails without continuation or tool execution when regenerated tool arguments remain truncated', async () => {
    const requests: ModelInvocationRequest[] = [];
    const incomplete = { content: '', finishReason: 'stop' as const, incompleteOutputReason: 'truncated-tool-call' as const };
    const model = makeQueuedModel([[incomplete], [incomplete]], requests);
    const capabilityInvocation = makeCapabilityInvocation();
    const runState = makeRunState();
    const agent = new DefaultAgent({
      contextEngine: { assemble: vi.fn(async () => makeRecoveryAssembly()), render: vi.fn(async () => makeRecoveryRendered()) },
      model,
      capabilityCatalog: makeCapabilityCatalog(),
      capabilityInvocation,
      assemblyRegistry: makeAssemblyRegistry(),
      runState,
    });

    await expect(agent.execute(makeRun(), makeContext(), new AbortController().signal)).rejects.toMatchObject({
      code: 'MODEL_OUTPUT_TOKEN_RECOVERY_UNSAFE_TOOL_CALL',
    });
    expect(requests).toHaveLength(2);
    expect(capabilityInvocation.invoke).not.toHaveBeenCalled();
  });

  it('fails without continuation when truncated tool-call regeneration changes to output-limit', async () => {
    const requests: ModelInvocationRequest[] = [];
    const model = makeQueuedModel(
      [
        [{ content: '', finishReason: 'tool-calls', incompleteOutputReason: 'truncated-tool-call' }],
        [{ content: 'still incomplete', finishReason: 'length', incompleteOutputReason: 'output-limit' }],
      ],
      requests,
    );
    const capabilityInvocation = makeCapabilityInvocation();
    const runState = makeRunState();
    const agent = new DefaultAgent({
      contextEngine: { assemble: vi.fn(async () => makeRecoveryAssembly()), render: vi.fn(async () => makeRecoveryRendered()) },
      model,
      capabilityCatalog: makeCapabilityCatalog(),
      capabilityInvocation,
      assemblyRegistry: makeAssemblyRegistry(),
      runState,
    });

    await expect(agent.execute(makeRun(), makeContext(), new AbortController().signal)).rejects.toMatchObject({
      code: 'MODEL_OUTPUT_TOKEN_RECOVERY_UNSAFE_TOOL_CALL',
    });
    expect(requests).toHaveLength(2);
    expect(capabilityInvocation.invoke).not.toHaveBeenCalled();
  });

  it('fails when output-limit regeneration changes to a truncated tool call', async () => {
    const requests: ModelInvocationRequest[] = [];
    const model = makeQueuedModel(
      [
        [{ content: 'partial', finishReason: 'length', incompleteOutputReason: 'output-limit' }],
        [{ content: '', finishReason: 'tool-calls', incompleteOutputReason: 'truncated-tool-call' }],
      ],
      requests,
    );
    const capabilityInvocation = makeCapabilityInvocation();
    const runState = makeRunState();
    const agent = new DefaultAgent({
      contextEngine: { assemble: vi.fn(async () => makeRecoveryAssembly()), render: vi.fn(async () => makeRecoveryRendered()) },
      model,
      capabilityCatalog: makeCapabilityCatalog(),
      capabilityInvocation,
      assemblyRegistry: makeAssemblyRegistry(),
      runState,
    });

    await expect(agent.execute(makeRun(), makeContext(), new AbortController().signal)).rejects.toMatchObject({
      code: 'MODEL_OUTPUT_TOKEN_RECOVERY_UNSAFE_TOOL_CALL',
    });
    expect(requests).toHaveLength(2);
    expect(capabilityInvocation.invoke).not.toHaveBeenCalled();
  });

  it('retries the same request once with an 8x output budget and replaces the truncated stream candidate', async () => {
    const requests: ModelInvocationRequest[] = [];
    const model = makeQueuedModel(
      [
        [
          { content: 'discarded partial' },
          {
            content: 'discarded partial',
            finishReason: 'length',
            incompleteOutputReason: 'output-limit',
            usage: { inputTokens: 1_000, outputTokens: 2_048 },
          },
        ],
        [{ content: 'complete answer' }, { content: 'complete answer', finishReason: 'stop' }],
      ],
      requests,
    );
    const { agent, runState } = makeAgent({
      model,
      assembly: makeRecoveryAssembly(),
      rendered: makeRecoveryRendered(),
    });

    await agent.execute(makeRun(), makeContext(), new AbortController().signal);

    expect(requests).toHaveLength(2);
    expect(requests[0]?.maxOutputTokens).toBe(2_048);
    expect(requests[1]?.maxOutputTokens).toBe(16_384);
    expect(requests[1]).toEqual({
      ...requests[0],
      maxOutputTokens: 16_384,
    });
    const finalEvent = runState.events.find(
      (event) => event.type === 'LLM_CONTENT_DELTA' && (event.inlinePayload as { final?: boolean }).final === true,
    );
    expect((finalEvent?.inlinePayload as { content?: string }).content).toBe('complete answer');
  });

  it('continues a still-truncated elevated response request-locally and commits one combined answer', async () => {
    const requests: ModelInvocationRequest[] = [];
    const hookStages: string[] = [];
    const lifecycleHook: LifecycleHookInvocationPort = {
      invoke: vi.fn(async (request) => {
        hookStages.push(request.stage);
        return { status: 'CONTINUE' as const, boundary: request.boundary };
      }),
    };
    const model = makeQueuedModel(
      [
        [{ content: 'initial partial', finishReason: 'length', incompleteOutputReason: 'output-limit', usage: { inputTokens: 1_000 } }],
        [{ content: 'confirmed prefix ', finishReason: 'length', incompleteOutputReason: 'output-limit', usage: { inputTokens: 1_000 } }],
        [{ content: 'continued suffix', finishReason: 'stop' }],
      ],
      requests,
    );
    const { agent, runState } = makeAgent({
      model,
      assembly: makeRecoveryAssembly(),
      rendered: makeRecoveryRendered(),
      lifecycleHook,
    });

    await agent.execute(makeRun(), makeContext(), new AbortController().signal);

    expect(requests).toHaveLength(3);
    expect(requests[2]?.messages.slice(-2)).toEqual([
      { role: 'ASSISTANT', content: [{ type: 'text', text: 'confirmed prefix ' }] },
      {
        role: 'USER',
        content: [
          {
            type: 'text',
            text: 'Continue directly from the preceding assistant output. Do not apologize, repeat, or summarize content already produced. If the remaining answer is long, divide it into smaller complete sections.',
          },
        ],
      },
    ]);
    expect(requests[2]?.maxOutputTokens).toBe(16_384);
    const finalEvents = runState.events.filter(
      (event) => event.type === 'LLM_CONTENT_DELTA' && (event.inlinePayload as { final?: boolean }).final === true,
    );
    expect(finalEvents).toHaveLength(1);
    expect((finalEvents[0]?.inlinePayload as { content?: string }).content).toBe('confirmed prefix continued suffix');
    expect(runState.appendMessage).not.toHaveBeenCalled();
    expect(hookStages.filter((stage) => stage === 'BEFORE_MODEL_INVOKE')).toHaveLength(0);
    expect(hookStages.filter((stage) => stage === 'AFTER_MODEL_RESULT')).toHaveLength(0);
  });

  it('commits only the continued terminal round after a completed tool round', async () => {
    const requests: ModelInvocationRequest[] = [];
    const toolCall = { toolCallId: 'call-before-continuation', toolName: 'Read', arguments: { file_path: 'package.json' } };
    const model = makeQueuedModel(
      [
        [{ content: 'tool-round-explanation', finishReason: 'tool-calls', toolCalls: [toolCall] }],
        [{ content: 'discarded partial', finishReason: 'length', incompleteOutputReason: 'output-limit', usage: { inputTokens: 1_000 } }],
        [{ content: 'confirmed prefix ', finishReason: 'length', incompleteOutputReason: 'output-limit', usage: { inputTokens: 1_000 } }],
        [{ content: 'continued suffix', finishReason: 'stop' }],
      ],
      requests,
    );
    const { agent, runState } = makeAgent({
      model,
      assembly: makeRecoveryAssembly(),
      rendered: makeRecoveryRendered(),
      maxTurns: 2,
    });

    await agent.execute(makeRun(), makeContext(), new AbortController().signal);

    const finalEvent = runState.events.find(
      (event) => event.type === 'LLM_CONTENT_DELTA' && (event.inlinePayload as { final?: boolean }).final === true,
    );
    expect((finalEvent?.inlinePayload as { content?: string }).content).toBe('confirmed prefix continued suffix');
    expect((finalEvent?.inlinePayload as { content?: string }).content).not.toContain('tool-round-explanation');
  });

  it('fails explicitly after three continuation attempts remain truncated', async () => {
    const requests: ModelInvocationRequest[] = [];
    const lengthResult = (content: string): ModelFinalResult => ({
      content,
      finishReason: 'length',
      incompleteOutputReason: 'output-limit',
      usage: { inputTokens: 1_000 },
    });
    const model = makeQueuedModel(
      [[lengthResult('initial')], [lengthResult('segment-0')], [lengthResult('segment-1')], [lengthResult('segment-2')], [lengthResult('segment-3')]],
      requests,
    );
    const { agent, runState } = makeAgent({
      model,
      assembly: makeRecoveryAssembly(),
      rendered: makeRecoveryRendered(),
    });

    await expect(agent.execute(makeRun(), makeContext(), new AbortController().signal)).rejects.toMatchObject({
      code: 'MODEL_OUTPUT_TOKEN_RECOVERY_EXHAUSTED',
      retryable: false,
    });

    expect(requests).toHaveLength(5);
    expect(runState.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'DEGRADATION_NOTICE',
          inlinePayload: { code: 'MODEL_OUTPUT_TOKEN_RECOVERY_EXHAUSTED' },
        }),
      ]),
    );
  });

  it('can complete on the third and final continuation attempt', async () => {
    const requests: ModelInvocationRequest[] = [];
    const model = makeQueuedModel(
      [
        [{ content: 'discarded', finishReason: 'length', incompleteOutputReason: 'output-limit' }],
        [{ content: 'segment-0 ', finishReason: 'length', incompleteOutputReason: 'output-limit' }],
        [{ content: 'segment-1 ', finishReason: 'length', incompleteOutputReason: 'output-limit' }],
        [{ content: 'segment-2 ', finishReason: 'length', incompleteOutputReason: 'output-limit' }],
        [{ content: 'segment-3', finishReason: 'stop' }],
      ],
      requests,
    );
    const { agent, runState } = makeAgent({
      model,
      assembly: makeRecoveryAssembly(),
      rendered: makeRecoveryRendered(),
    });

    await agent.execute(makeRun(), makeContext(), new AbortController().signal);

    expect(requests).toHaveLength(5);
    expect(requests[4]?.messages.slice(-6).map((message) => message.role)).toEqual(['ASSISTANT', 'USER', 'ASSISTANT', 'USER', 'ASSISTANT', 'USER']);
    const finalEvent = runState.events.find(
      (event) => event.type === 'LLM_CONTENT_DELTA' && (event.inlinePayload as { final?: boolean }).final === true,
    );
    expect((finalEvent?.inlinePayload as { content?: string }).content).toBe('segment-0 segment-1 segment-2 segment-3');
  });

  it('never executes tool calls returned from an incomplete recovery response', async () => {
    const requests: ModelInvocationRequest[] = [];
    const toolCall = { toolCallId: 'call-incomplete', toolName: 'Read', arguments: { file_path: 'package.json' } };
    const model = makeQueuedModel(
      [
        [{ content: 'partial', finishReason: 'length', incompleteOutputReason: 'output-limit', toolCalls: [toolCall] }],
        [{ content: 'still partial', finishReason: 'length', incompleteOutputReason: 'output-limit', toolCalls: [toolCall] }],
      ],
      requests,
    );
    const capabilityInvocation = makeCapabilityInvocation();
    const runState = makeRunState();
    const agent = new DefaultAgent({
      contextEngine: {
        assemble: vi.fn(async () => makeRecoveryAssembly()),
        render: vi.fn(async () => makeRecoveryRendered()),
      },
      model,
      capabilityCatalog: makeCapabilityCatalog(),
      capabilityInvocation,
      assemblyRegistry: makeAssemblyRegistry(),
      runState,
    });

    await expect(agent.execute(makeRun(), makeContext(), new AbortController().signal)).rejects.toMatchObject({
      code: 'MODEL_OUTPUT_TOKEN_RECOVERY_UNSAFE_TOOL_CALL',
    });
    expect(capabilityInvocation.invoke).not.toHaveBeenCalled();
    expect(requests).toHaveLength(2);
  });

  it('executes complete tool calls when the provider reports a stop finish reason', async () => {
    const requests: ModelInvocationRequest[] = [];
    const toolCall = { toolCallId: 'call-stop', toolName: 'Read', arguments: { file_path: 'package.json' } };
    const model = makeQueuedModel(
      [[{ content: '', finishReason: 'stop', toolCalls: [toolCall] }], [{ content: 'done', finishReason: 'stop' }]],
      requests,
    );
    const capabilityInvocation = makeCapabilityInvocation();
    const runState = makeRunState();
    const agent = new DefaultAgent({
      contextEngine: {
        assemble: vi.fn(async () => makeRecoveryAssembly()),
        render: vi.fn(async () => makeRecoveryRendered()),
      },
      model,
      capabilityCatalog: makeCapabilityCatalog(),
      capabilityInvocation,
      assemblyRegistry: makeAssemblyRegistry(2),
      runState,
    });

    await agent.execute(makeRun(), makeContext(), new AbortController().signal);

    expect(capabilityInvocation.invoke).toHaveBeenCalledTimes(1);
    expect(requests).toHaveLength(2);
  });

  it('rejects tool calls introduced by a continuation even after a stop finish reason', async () => {
    const requests: ModelInvocationRequest[] = [];
    const toolCall = { toolCallId: 'call-continuation', toolName: 'Read', arguments: { file_path: 'package.json' } };
    const model = makeQueuedModel(
      [
        [{ content: 'discarded', finishReason: 'length', incompleteOutputReason: 'output-limit' }],
        [{ content: 'confirmed', finishReason: 'length', incompleteOutputReason: 'output-limit' }],
        [{ content: '', finishReason: 'stop', toolCalls: [toolCall] }],
      ],
      requests,
    );
    const capabilityInvocation = makeCapabilityInvocation();
    const runState = makeRunState();
    const agent = new DefaultAgent({
      contextEngine: {
        assemble: vi.fn(async () => makeRecoveryAssembly()),
        render: vi.fn(async () => makeRecoveryRendered()),
      },
      model,
      capabilityCatalog: makeCapabilityCatalog(),
      capabilityInvocation,
      assemblyRegistry: makeAssemblyRegistry(),
      runState,
    });

    await expect(agent.execute(makeRun(), makeContext(), new AbortController().signal)).rejects.toMatchObject({
      code: 'MODEL_OUTPUT_TOKEN_RECOVERY_UNSAFE_TOOL_CALL',
    });
    expect(capabilityInvocation.invoke).not.toHaveBeenCalled();
  });

  it('does not switch fallback routes after a recovery attempt has emitted visible output', async () => {
    const requests: ModelInvocationRequest[] = [];
    const model = makeQueuedModel(
      [
        [{ content: 'discarded', finishReason: 'length', incompleteOutputReason: 'output-limit' }],
        [
          { content: 'visible retry' },
          {
            content: 'visible retry',
            finishReason: 'error',
            safeError: { code: 'MODEL_TEMPORARY_FAILURE', message: 'temporary', category: 'UNAVAILABLE', retryable: true },
          },
        ],
      ],
      requests,
    );
    const { agent } = makeAgent({
      model,
      assembly: makeRecoveryAssembly(),
      rendered: makeRecoveryRendered(),
    });

    await expect(agent.execute(makeRun(), makeContext(), new AbortController().signal)).rejects.toMatchObject({
      code: 'MODEL_TEMPORARY_FAILURE',
    });
    expect(requests).toHaveLength(2);
  });

  it('propagates cancellation to the recovery invocation and starts no later continuation', async () => {
    const requests: ModelInvocationRequest[] = [];
    const controller = new AbortController();
    const model: ModelInvocationService = {
      complete: async () => {
        throw new Error('not used');
      },
      stream: modelEventStreamFixture(async function* (request, signal) {
        requests.push(request);
        if (requests.length === 1) {
          yield { content: 'discarded', finishReason: 'length', incompleteOutputReason: 'output-limit' };
          return;
        }
        controller.abort(new Error('cancel recovery'));
        signal.throwIfAborted();
      }),
    };
    const { agent } = makeAgent({
      model,
      assembly: makeRecoveryAssembly(),
      rendered: makeRecoveryRendered(),
    });

    await expect(agent.execute(makeRun(), makeContext(), controller.signal)).rejects.toThrow('cancel recovery');
    expect(requests).toHaveLength(2);
  });
});

function makeRecoveryAssembly(maxOutputTokens = 2_048): ContextAssembly {
  return {
    ...makeAssembly({ budgetPlan: makePlan({ estimatedFinalInputUnits: 1_000 }) }),
    modelOptions: { maxOutputTokens },
  };
}

function makeRecoveryRendered(maxOutputTokens = 2_048): RenderedModelInput {
  return {
    ...makeRendered(),
    modelOptions: { maxOutputTokens },
  };
}

function makeQueuedModel(
  steps: ReadonlyArray<ReadonlyArray<ModelStreamDelta | ModelFinalResult>>,
  requests: ModelInvocationRequest[],
): ModelInvocationService {
  let callIndex = 0;
  return {
    complete: async () => {
      throw new Error('not used in these tests');
    },
    stream: modelEventStreamFixture(async function* (request) {
      requests.push(request);
      const events = steps[callIndex];
      callIndex += 1;
      if (events === undefined) {
        throw new Error('unexpected model invocation');
      }
      for (const event of events) {
        yield event;
      }
    }),
  };
}
