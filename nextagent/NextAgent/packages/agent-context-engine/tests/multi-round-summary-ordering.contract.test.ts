import { DefaultContextEngine, DefaultProportionalBudgetPolicy, createDefaultTokenEstimator } from '@nextagent/agent-context-engine';
import { brand, type EpochMillis, type MessageId } from '@nextagent/agent-common';
import type { AgentAssembly, AgentAssemblyRegistry } from '@nextagent/agent-contracts/agent-assembly';
import type { CapabilityCatalog } from '@nextagent/agent-contracts/capability';
import type {
  ActiveContextItemRecord,
  ActiveContextStateRecord,
  ActiveContextStoreGateway,
  ActiveContextViewRecord,
  SessionMessageRecord,
  SessionMessageStoreGateway,
  VersionedUpdateResult,
} from '@nextagent/agent-contracts/gateway';
import type { TraceableSummaryDraft, TraceableSummaryGenerationPort, TraceableSummaryGenerationRequest } from '@nextagent/agent-contracts/context';
import { describe, expect, it } from 'vitest';

/**
 * Reproduction harness for the multi-round auto-summary ordering / loss bug.
 *
 * The active-context store double FAITHFULLY mirrors the SQLite gateway's
 * `commitCompaction` semantics (replace all items with
 * [summary, ...retainedTail], bump version, persist the summary message) and
 * `appendItem` (append at the tail, bump version). This lets us drive many
 * turns and observe where the SUMMARY message lands across successive
 * compactions — the scenario the single-shot orchestrator tests do not cover.
 *
 * Convention (matches the real runtime + the existing orchestrator tests):
 * a turn's root user message has `messageId === requestId`, and the current
 * request anchor is that same id.
 */

const TENANT = brand<string, 'TenantId'>('t');
const SUBJECT = brand<string, 'SubjectId'>('s');
const AGENT = brand<string, 'AgentId'>('a');
const AGENT_V = brand<string, 'AgentVersion'>('v1');
const SESSION = brand<string, 'SessionId'>('sess');

function msgId(name: string): MessageId {
  return brand<string, 'MessageId'>(name);
}

/** User/assistant pair for a turn; requestId === the user messageId. */
function turn(userMessageId: string, userContent: string, assistantContent: string): SessionMessageRecord[] {
  return [
    {
      tenantId: TENANT,
      subjectId: SUBJECT,
      agentId: AGENT,
      messageId: msgId(userMessageId),
      sessionId: SESSION,
      requestId: msgId(userMessageId),
      role: 'USER',
      content: userContent,
      contentType: 'PLAIN_TEXT',
      metadata: {},
      visible: true,
      createdAt: brand<number, 'EpochMillis'>(1),
    },
    {
      tenantId: TENANT,
      subjectId: SUBJECT,
      agentId: AGENT,
      messageId: msgId(`${userMessageId}-a`),
      sessionId: SESSION,
      requestId: msgId(userMessageId),
      role: 'ASSISTANT',
      content: assistantContent,
      contentType: 'PLAIN_TEXT',
      metadata: {},
      visible: true,
      createdAt: brand<number, 'EpochMillis'>(1),
    },
  ];
}

function assembly(): AgentAssembly {
  return {
    agentId: AGENT,
    agentType: brand<string, 'AgentType'>('default'),
    agentVersion: AGENT_V,
    agentAssemblyRef: 'a:v1',
    displayName: 'multi-round',
    description: 'multi-round',
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
    runtimeSettings: { maxTurns: 1, maxToolCallsPerTurn: 30, maxContextMessages: 50 },
  };
}

interface StoreState {
  items: MessageId[];
  version: number;
  metadata: Record<string, unknown>;
  messages: Map<string, SessionMessageRecord>;
}

function viewOf(state: StoreState): ActiveContextViewRecord {
  const stateRec: ActiveContextStateRecord = {
    tenantId: TENANT,
    subjectId: SUBJECT,
    agentId: AGENT,
    sessionId: SESSION,
    activeContextVersion: state.version,
    updatedAt: brand<number, 'EpochMillis'>(1),
  };
  const items: readonly ActiveContextItemRecord[] = state.items.map((id, ordinal) => ({
    tenantId: TENANT,
    subjectId: SUBJECT,
    agentId: AGENT,
    sessionId: SESSION,
    ordinal,
    messageId: id,
  }));
  return { state: stateRec, items };
}

interface Captured {
  covered: MessageId[];
  summaryCounter: number;
}

function makeEngine(state: StoreState, captured: Captured) {
  const activeContextStore: ActiveContextStoreGateway = {
    async loadActiveContext() {
      return viewOf(state);
    },
    async appendItem(request) {
      if (!state.items.includes(request.messageId)) {
        state.items.push(request.messageId);
        state.version += 1;
      }
      return { status: 'UPDATED' as const, record: viewOf(state) };
    },
    async commitCompaction(request) {
      // FAITHFUL mirror of sqlite-gateway-core.commitCompaction.
      state.messages.set(request.summaryMessage.messageId, request.summaryMessage);
      state.items = [request.summaryMessage.messageId, ...request.retainedTailMessageIds];
      state.version += 1;
      return { status: 'UPDATED' as const, record: viewOf(state) };
    },
    async updateMetadata(request) {
      if (state.version === request.expectedActiveContextVersion) {
        state.metadata = request.metadata as Record<string, unknown>;
      }
      return { status: 'UPDATED' as const, record: viewOf(state) };
    },
  };
  const messageStore: SessionMessageStoreGateway = {
    async loadMessage(req) {
      return state.messages.get(req.messageId);
    },
    async loadMessages(req) {
      const out: SessionMessageRecord[] = [];
      for (const id of req.messageIds) {
        const r = state.messages.get(id);
        if (r !== undefined) {
          out.push(r);
        }
      }
      return out;
    },
    async appendSessionMessage() {
      throw new Error('unused');
    },
    async listConversationPreview() {
      throw new Error('unused');
    },
    async listMessages() {
      throw new Error('unused');
    },
    async listCurrentRequestMessages() {
      throw new Error('unused');
    },
    async hideMessage() {
      throw new Error('unused');
    },
    async hideRequestMessages() {
      throw new Error('unused');
    },
  };
  const summaryGenerator: TraceableSummaryGenerationPort = {
    async generate(req: TraceableSummaryGenerationRequest): Promise<TraceableSummaryDraft> {
      captured.covered = [...req.coveredMessageRefs];
      captured.summaryCounter += 1;
      // Mimic the real LLM behavior observed in #531: when handed an empty
      // covered range it STILL emits a non-empty "No prior conversation"
      // pseudo-summary (so the `draft.content` empty check does NOT catch it).
      // The empty-covered guard must prevent this generator from ever being
      // called with an empty covered range.
      const content =
        req.coveredMessageRefs.length === 0
          ? 'No prior conversation turns were provided. The session context is currently empty.'
          : `summary-${captured.summaryCounter} covering ${req.coveredMessageRefs.length} messages`;
      return {
        content,
        sourceReferences: [...req.coveredMessageRefs],
        historyLookupLinkage: [...req.retainedTailMessageRefs],
        rehydrationHints: [],
        generationMode: 'normal',
        promptTemplateVersion: 'compact-summary/v1',
        inputUnitEstimate: 300,
        outputUnitEstimate: 50,
      };
    },
  };
  const engine = new DefaultContextEngine({
    activeContextStore,
    messageStore,
    assemblyRegistry: { active: async () => assembly(), require: async () => assembly() },
    capabilityCatalog: { listAvailable: async () => [], resolve: async () => undefined },
    modelSelectionService: {
      async select() {
        return {
          status: 'SELECTED' as const,
          configuration: {
            modelId: 'default',
            contextWindowTokens: 15_256,
            temperature: 0,
            maxOutputTokens: 256,
            topP: 1,
            toolChoice: 'AUTO' as const,
            defaultTimeoutMs: 30_000,
            defaultMaxRetries: 0,
          },
          reason: 'AGENT_DEFAULT' as const,
        };
      },
    },
    budgetPolicy: new DefaultProportionalBudgetPolicy(),
    tokenEstimator: createDefaultTokenEstimator(),
    summaryGenerator,
    commitCompaction: (request) =>
      activeContextStore.commitCompaction({
        tenantId: brand(request.ownerScope.tenantId),
        subjectId: brand(request.ownerScope.subjectId),
        agentId: brand(request.agentId),
        sessionId: brand(request.sessionId),
        expectedActiveContextVersion: request.expectedActiveContextVersion,
        summaryMessage: request.summaryMessage,
        retainedTailMessageIds: request.retainedTailMessageIds,
        idempotencyKey: request.idempotencyKey,
      }) as Promise<VersionedUpdateResult<ActiveContextViewRecord>>,
    idFactory: (prefix) => `${prefix}-${captured.summaryCounter}`,
    clock: () => brand<number, 'EpochMillis'>(1),
  });
  return engine;
}

function makeRequest(currentRequestId: string) {
  return {
    sessionId: SESSION,
    requestId: msgId(currentRequestId),
    requestContextId: brand<string, 'RequestContextId'>('rc'),
    identityContext: { tenantId: TENANT, subjectId: SUBJECT, displayName: 'x' },
    agentId: AGENT,
    agentVersion: AGENT_V,
    runId: brand<string, 'RequestRunId'>(`run-${currentRequestId}`),
    stepId: 'step',
    locale: brand<string, 'RequestLocale'>('en-US'),
    purpose: 'test',
  };
}

function append(state: StoreState, record: SessionMessageRecord) {
  state.messages.set(record.messageId, record);
  if (!state.items.includes(record.messageId)) {
    state.items.push(record.messageId);
    state.version += 1;
  }
}

const LONG = 'x'.repeat(3000); // ~750 tokens/assistant

describe('multi-round auto-summary ordering', () => {
  it('folds the prior SUMMARY into each new summary (no cumulative history loss) and keeps it at the front', async () => {
    const state: StoreState = { items: [], version: 0, metadata: {}, messages: new Map() };
    const captured: Captured = { covered: [], summaryCounter: 0 };
    const engine = makeEngine(state, captured);

    // Seed 3 complete long prior turns + the current (turn-4) user message.
    for (const r of turn('u1', 'q1', LONG)) {
      append(state, r);
    }
    for (const r of turn('u2', 'q2', LONG)) {
      append(state, r);
    }
    for (const r of turn('u3', 'q3', LONG)) {
      append(state, r);
    }
    append(state, {
      tenantId: TENANT,
      subjectId: SUBJECT,
      agentId: AGENT,
      messageId: msgId('u4'),
      sessionId: SESSION,
      requestId: msgId('u4'),
      role: 'USER',
      content: 'current question 4',
      contentType: 'PLAIN_TEXT',
      metadata: {},
      visible: true,
      createdAt: brand<number, 'EpochMillis'>(1),
    });

    // Turn 4 — 1st compaction. Summary leads the assembled context.
    let result = await engine.assemble(makeRequest('u4'), undefined, new AbortController().signal);
    expect(result.compressionEvidence).toBeDefined();
    const summary1 = result.compressionEvidence!.summaryMessageId;
    expect(result.selectedMessageRefs[0]).toBe(summary1);

    // Turn 4 completes; turn 5 begins.
    append(state, {
      tenantId: TENANT,
      subjectId: SUBJECT,
      agentId: AGENT,
      messageId: msgId('u4-a'),
      sessionId: SESSION,
      requestId: msgId('u4'),
      role: 'ASSISTANT',
      content: LONG,
      contentType: 'PLAIN_TEXT',
      metadata: {},
      visible: true,
      createdAt: brand<number, 'EpochMillis'>(1),
    });
    append(state, {
      tenantId: TENANT,
      subjectId: SUBJECT,
      agentId: AGENT,
      messageId: msgId('u5'),
      sessionId: SESSION,
      requestId: msgId('u5'),
      role: 'USER',
      content: 'current question 5',
      contentType: 'PLAIN_TEXT',
      metadata: {},
      visible: true,
      createdAt: brand<number, 'EpochMillis'>(1),
    });

    // Turn 5 — 2nd compaction. The prior summary-1 MUST be folded into the
    // new summary (covered), not silently dropped/deleted.
    result = await engine.assemble(makeRequest('u5'), undefined, new AbortController().signal);
    expect(result.compressionEvidence).toBeDefined();
    expect(captured.covered, 'prior SUMMARY must be re-summarized (folded), not lost').toContain(summary1);
    // The new summary still leads the assembled context (right after the system prompt).
    expect(result.selectedMessageRefs[0]).toBe(result.compressionEvidence!.summaryMessageId);
  });

  it('#531 same-run re-entry: compresses at most once per run, no pseudo-summary, SUMMARY stays before the current USER', async () => {
    const state: StoreState = { items: [], version: 0, metadata: {}, messages: new Map() };
    const captured: Captured = { covered: [], summaryCounter: 0 };
    const engine = makeEngine(state, captured);

    // Seed 2 complete long prior turns + the current (u4) user message.
    for (const r of turn('u1', 'q1', LONG)) {
      append(state, r);
    }
    for (const r of turn('u2', 'q2', LONG)) {
      append(state, r);
    }
    append(state, {
      tenantId: TENANT,
      subjectId: SUBJECT,
      agentId: AGENT,
      messageId: msgId('u4'),
      sessionId: SESSION,
      requestId: msgId('u4'),
      role: 'USER',
      content: 'current question 4',
      contentType: 'PLAIN_TEXT',
      metadata: {},
      visible: true,
      createdAt: brand<number, 'EpochMillis'>(1),
    });

    // 1st assemble within run "run-u4" — prior turns exist, compaction fires.
    const result1 = await engine.assemble(makeRequest('u4'), undefined, new AbortController().signal);
    expect(result1.compressionEvidence).toBeDefined();
    const summary1 = result1.compressionEvidence!.summaryMessageId;
    expect(captured.summaryCounter).toBe(1);
    // SUMMARY leads, current USER comes after (no old SUMMARY after USER).
    const refs1 = result1.selectedMessageRefs;
    expect(refs1[0]).toBe(summary1);
    const user4Idx = refs1.indexOf(msgId('u4'));
    expect(user4Idx).toBeGreaterThan(0);

    // Simulate a tool iteration within the SAME run: a large tool result
    // (same requestId = u4) balloons the context. Same runId re-enters
    // assemble() — this is exactly the #531 compact-2/compact-3 cascade.
    append(state, {
      tenantId: TENANT,
      subjectId: SUBJECT,
      agentId: AGENT,
      messageId: msgId('u4-tool'),
      sessionId: SESSION,
      requestId: msgId('u4'),
      role: 'ASSISTANT',
      content: JSON.stringify({ toolCalls: [{ toolCallId: 'tc1', toolName: 'rag', arguments: {} }] }),
      contentType: 'PLAIN_TEXT',
      metadata: { kind: 'ASSISTANT_TOOL_USE' },
      visible: true,
      createdAt: brand<number, 'EpochMillis'>(1),
    });
    append(state, {
      tenantId: TENANT,
      subjectId: SUBJECT,
      agentId: AGENT,
      messageId: msgId('u4-tool-result'),
      sessionId: SESSION,
      requestId: msgId('u4'),
      role: 'CAPABILITY_RESULT',
      content: JSON.stringify({ toolCallId: 'tc1', toolName: 'rag', payload: { result: LONG } }),
      contentType: 'PLAIN_TEXT',
      metadata: {},
      visible: true,
      createdAt: brand<number, 'EpochMillis'>(1),
    });

    // 2nd assemble within the SAME run. Must NOT compress again (run-level
    // dedup), must NOT inject a "No prior conversation" pseudo-summary, and
    // the SUMMARY must still lead ahead of the current USER.
    const result2 = await engine.assemble(makeRequest('u4'), undefined, new AbortController().signal);
    expect(result2.compressionEvidence, 'same run must not compress a second time').toBeUndefined();
    expect(captured.summaryCounter, 'generator must not be called again for the same run').toBe(1);

    const refs2 = result2.selectedMessageRefs;
    expect(refs2[0]).toBe(summary1);
    const user4Idx2 = refs2.indexOf(msgId('u4'));
    expect(user4Idx2, 'current USER must come AFTER the leading SUMMARY').toBeGreaterThan(0);
    // No pseudo-summary message persisted.
    const persistedSummaries = [...state.messages.values()].filter((m) => m.role === 'SUMMARY');
    expect(persistedSummaries.length).toBe(1);
    expect(persistedSummaries[0]!.content).not.toContain('No prior conversation');
  });

  it('#531 empty-covered guard: a run with no prior turns never produces a pseudo-summary even when the threshold is crossed', async () => {
    const state: StoreState = { items: [], version: 0, metadata: {}, messages: new Map() };
    const captured: Captured = { covered: [], summaryCounter: 0 };
    const engine = makeEngine(state, captured);

    // Single huge current user message, NO prior turns. The default system
    // prompt alone already crosses the small-window auto-compact threshold, so
    // the threshold trigger WOULD fire — but there is nothing to compress.
    const huge = 'x'.repeat(20_000);
    append(state, {
      tenantId: TENANT,
      subjectId: SUBJECT,
      agentId: AGENT,
      messageId: msgId('big'),
      sessionId: SESSION,
      requestId: msgId('big'),
      role: 'USER',
      content: huge,
      contentType: 'PLAIN_TEXT',
      metadata: {},
      visible: true,
      createdAt: brand<number, 'EpochMillis'>(1),
    });

    const result = await engine.assemble(makeRequest('big'), undefined, new AbortController().signal);
    // Empty-covered guard must skip compression entirely.
    expect(result.compressionEvidence).toBeUndefined();
    expect(captured.summaryCounter, 'generator must not be called on empty covered range').toBe(0);
    // The current request is still assembled verbatim; no summary injected.
    expect(result.selectedMessageRefs).toEqual([msgId('big')]);
    expect([...state.messages.values()].some((m) => m.role === 'SUMMARY')).toBe(false);
  });
});
