import { createTestModelSelectionService } from './test-model-selection-helpers.js';
import { DefaultContextEngine } from '@nextagent/agent-context-engine';
import { brand, type EpochMillis, type IdempotencyKey, type MessageId } from '@nextagent/agent-common';
import type { AgentAssembly, AgentAssemblyRegistry } from '@nextagent/agent-contracts/agent-assembly';
import type { CapabilityCatalog } from '@nextagent/agent-contracts/capability';
import type {
  ActiveContextItemRecord,
  ActiveContextStateRecord,
  ActiveContextStoreGateway,
  ActiveContextViewRecord,
  SessionMessageRecord,
  SessionMessageStoreGateway,
} from '@nextagent/agent-contracts/gateway';
import type {
  ContextBudgetPolicyPort,
  ContextCompactionPlan,
  TraceableSummaryDraft,
  TraceableSummaryGenerationPort,
  TraceableSummaryGenerationRequest,
} from '@nextagent/agent-contracts/context';
import type { SessionMessage } from '@nextagent/agent-contracts/session';
import { describe, expect, it, vi } from 'vitest';

// =============================================================================
// Fixture helpers
// =============================================================================

const TENANT = brand<string, 'TenantId'>('tenant-comp');
const SUBJECT = brand<string, 'SubjectId'>('subject-comp');
const AGENT = brand<string, 'AgentId'>('agent-comp');
const AGENT_V = brand<string, 'AgentVersion'>('v1');
const SESSION = brand<string, 'SessionId'>('session-comp');

function msgId(name: string): MessageId {
  return brand<string, 'MessageId'>(name);
}

function runId(name: string) {
  return brand<string, 'RequestRunId'>(name);
}

function userMessage(messageId: string, content: string, requestId = messageId): SessionMessage {
  return {
    messageId: msgId(messageId),
    sessionId: SESSION,
    requestId: msgId(requestId),
    role: 'USER',
    content,
    contentType: 'PLAIN_TEXT',
    metadata: {},
    sequence: 0,
    visible: true,
    createdAt: brand<number, 'EpochMillis'>(1),
  };
}

function assistantMessage(messageId: string, content: string, requestId = messageId): SessionMessage {
  return {
    messageId: msgId(messageId),
    sessionId: SESSION,
    requestId: msgId(requestId),
    role: 'ASSISTANT',
    content,
    contentType: 'PLAIN_TEXT',
    metadata: {},
    sequence: 0,
    visible: true,
    createdAt: brand<number, 'EpochMillis'>(1),
  };
}

function assistantToolUse(messageId: string, requestId: string, toolName: string, toolCallId: string): SessionMessage {
  return {
    messageId: msgId(messageId),
    sessionId: SESSION,
    requestId: msgId(requestId),
    role: 'ASSISTANT',
    content: JSON.stringify({ toolCalls: [{ toolCallId, toolName, arguments: {} }] }),
    contentType: 'PLAIN_TEXT',
    metadata: {},
    sequence: 0,
    visible: true,
    createdAt: brand<number, 'EpochMillis'>(1),
  };
}

function toolResultMessage(messageId: string, toolCallId: string, requestId: string): SessionMessage {
  return {
    messageId: msgId(messageId),
    sessionId: SESSION,
    requestId: msgId(requestId),
    role: 'CAPABILITY_RESULT',
    content: JSON.stringify({ toolCallId, toolName: 'noop', payload: { result: 'ok' } }),
    contentType: 'PLAIN_TEXT',
    metadata: {},
    sequence: 0,
    visible: true,
    createdAt: brand<number, 'EpochMillis'>(1),
  };
}

function sessionRecordFromMessage(message: SessionMessage): SessionMessageRecord {
  return {
    tenantId: TENANT,
    subjectId: SUBJECT,
    agentId: AGENT,
    messageId: message.messageId,
    sessionId: SESSION,
    requestId: message.requestId,
    ...(message.runId === undefined ? {} : { runId: message.runId }),
    role: message.role,
    content: message.content,
    contentType: message.contentType,
    metadata: message.metadata,
    visible: message.visible,
    createdAt: message.createdAt,
  };
}

function activeContextView(messageIds: readonly string[], activeContextVersion = 1): ActiveContextViewRecord {
  const state: ActiveContextStateRecord = {
    tenantId: TENANT,
    subjectId: SUBJECT,
    agentId: AGENT,
    sessionId: SESSION,
    activeContextVersion,
    updatedAt: brand<number, 'EpochMillis'>(1),
  };
  const items: readonly ActiveContextItemRecord[] = messageIds.map((id, ordinal) => ({
    tenantId: TENANT,
    subjectId: SUBJECT,
    agentId: AGENT,
    sessionId: SESSION,
    ordinal,
    messageId: msgId(id),
  }));
  return { state, items };
}

function makeAssembly(): AgentAssembly {
  return {
    agentId: AGENT,
    agentType: brand<string, 'AgentType'>('default'),
    agentVersion: AGENT_V,
    agentAssemblyRef: 'agent-comp:v1',
    displayName: 'compression test',
    description: 'compression test',
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

interface EngineFixture {
  readonly engine: DefaultContextEngine;
  readonly runState: AgentRunStatePort & { readonly events: Array<{ type: string; payload: JsonObject }> };
  readonly commitCalls: Array<{ expectedVersion: number; summaryMessage: SessionMessageRecord; retainedTail: readonly MessageId[] }>;
}

function makeFixture(opts: {
  readonly messages: readonly SessionMessageRecord[];
  readonly active?: ActiveContextViewRecord;
  readonly summaryGenerator?: TraceableSummaryGenerationPort;
  readonly policy?: ContextBudgetPolicyPort;
  readonly commitResult: VersionedUpdateResult<ActiveContextViewRecord> | 'version_conflict' | 'persistence_failed';
  readonly summaryMessageContent?: string;
  readonly contextWindowTokens?: number;
  readonly maxOutputTokens?: number;
}): EngineFixture {
  const messagesMap = new Map<string, SessionMessageRecord>();
  for (const r of opts.messages) {
    messagesMap.set(r.messageId, r);
  }
  const activeContextStore: ActiveContextStoreGateway = {
    async loadActiveContext() {
      return opts.active ?? activeContextView([], 1);
    },
    async appendItem() {
      throw new Error('unused');
    },
    async commitCompaction() {
      throw new Error('unused');
    },
    async updateMetadata() {
      return { status: 'UPDATED' as const };
    },
  };
  const messageStore: SessionMessageStoreGateway = {
    async loadMessage(req) {
      return messagesMap.get(req.messageId);
    },
    async loadMessages(req) {
      const out: SessionMessageRecord[] = [];
      for (const id of req.messageIds) {
        const record = messagesMap.get(id);
        if (record !== undefined) {
          out.push(record);
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
  const assembly = makeAssembly();
  const assemblyRegistry: AgentAssemblyRegistry = {
    async active() {
      return assembly;
    },
    async require() {
      return assembly;
    },
  };
  const capabilityCatalog: CapabilityCatalog = {
    async listAvailable() {
      return [];
    },
    async resolve() {
      return undefined;
    },
  };
  const summaryGenerator: TraceableSummaryGenerationPort = opts.summaryGenerator ?? {
    async generate(): Promise<TraceableSummaryDraft> {
      return {
        content: opts.summaryMessageContent ?? 'the prior history summary',
        sourceReferences: [],
        historyLookupLinkage: [],
        rehydrationHints: [],
        generationMode: 'normal',
        promptTemplateVersion: 'compact-summary/v1',
        inputUnitEstimate: 100,
        outputUnitEstimate: 50,
      };
    },
  };
  const commitCalls: Array<{ expectedVersion: number; summaryMessage: SessionMessageRecord; retainedTail: readonly MessageId[] }> = [];
  const events: Array<{ type: string; payload: JsonObject }> = [];
  const runState: AgentRunStatePort & { readonly events: Array<{ type: string; payload: JsonObject }> } = {
    events,
    setCapabilityTerminalAnswer: vi.fn(async () => undefined),
    emitEvent: vi.fn(async (_run, _context, event) => {
      events.push({ type: event.type, payload: event.inlinePayload as JsonObject });
    }),
    appendMessage: vi.fn(async () => brand<string, 'MessageId'>('unused')),
    saveCheckpoint: vi.fn(async () => undefined),
    requestPendingInput: vi.fn(async () => {
      throw new Error('not used');
    }),
  };
  const commitCompaction = async (request: {
    expectedActiveContextVersion: number;
    summaryMessage: SessionMessageRecord;
    retainedTailMessageIds: readonly MessageId[];
  }): Promise<VersionedUpdateResult<ActiveContextViewRecord>> => {
    commitCalls.push({
      expectedVersion: request.expectedActiveContextVersion,
      summaryMessage: request.summaryMessage,
      retainedTail: request.retainedTailMessageIds,
    });
    if (opts.commitResult === 'version_conflict') {
      return { status: 'VERSION_CONFLICT' };
    }
    if (opts.commitResult === 'persistence_failed') {
      return { status: 'NOT_FOUND' };
    }
    return opts.commitResult;
  };
  const idFactory = (prefix: string): string => `${prefix}-${commitCalls.length}`;
  const clock = (): EpochMillis => brand<number, 'EpochMillis'>(1);
  const engine = new DefaultContextEngine({
    activeContextStore,
    messageStore,
    assemblyRegistry,
    capabilityCatalog,
    modelSelectionService: createTestModelSelectionService({
      modelId: 'test-model',
      contextWindowTokens: opts.contextWindowTokens ?? 128_000,
      maxOutputTokens: opts.maxOutputTokens ?? 4_000,
    }),
    summaryGenerator,
    commitCompaction: commitCompaction as never,
    idFactory,
    clock,
    ...(opts.policy === undefined ? {} : { budgetPolicy: opts.policy }),
  });
  return { engine, runState, commitCalls };
}

function makeRequest(currentRequestId = 'current-req', flowVariables?: Readonly<Record<string, string>>) {
  return {
    sessionId: SESSION,
    requestId: msgId(currentRequestId),
    requestContextId: brand<string, 'RequestContextId'>('rc-comp'),
    identityContext: { tenantId: TENANT, subjectId: SUBJECT, displayName: 'comp test' },
    agentId: AGENT,
    agentVersion: AGENT_V,
    runId: runId('run-comp'),
    stepId: 'step-comp',
    locale: brand<string, 'RequestLocale'>('en-US'),
    purpose: 'test-comp',
    ...(flowVariables === undefined ? {} : { flowVariables }),
  };
}

/**
 * Mock budget policy for compression-orchestration tests.
 *
 * `omitPriorHistory` (default true) marks optional `prior_active_history`
 * candidates as omitted so `budgetPlan.omittedContextTypes` carries the
 * category (the budget gate still degrades independently of the trigger).
 *
 * `totalEvidenceUnits` controls `estimatedConversationInputUnits` (the sum
 * the proactive auto-compact threshold compares against
 * `availableInputUnits - 13_000`). When provided, the whole total is
 * assigned to the first candidate's evidence and the rest get 0, giving a
 * deterministic sum regardless of how many candidates `buildSourceCandidates`
 * produced. This lets tests drive the threshold precisely without depending
 * on the real token estimator. Required-priority candidates always stay
 * `selected` (invariant 3).
 */
function makeThresholdPolicy(opts: { omitPriorHistory?: boolean; totalEvidenceUnits?: number } = {}): ContextBudgetPolicyPort {
  const omit = opts.omitPriorHistory ?? true;
  return {
    evaluate(input) {
      const plan: ContextCompactionPlan = {
        decision: omit ? 'compact_degrade' : 'continue',
        reasonCode: omit ? 'HISTORY_OMITTED_TO_BUDGET' : 'WITHIN_BUDGET',
        compressionMode: 'none',
        degradationMode: [],
        pipelineStageStoppedAt: 'agent-context-engine.budget-decision-gate',
        estimatedFinalInputUnits: input.minimumSafeContextUnits + 1000,
        omittedContextTypes: omit ? ['prior_active_history'] : [],
      };
      return {
        plan,
        evidence: input.sourceCandidates.map((c, i) => ({
          category: c.category,
          estimatedInputUnits: opts.totalEvidenceUnits === undefined ? c.estimatedInputUnits : i === 0 ? opts.totalEvidenceUnits : 0,
          status: !omit || c.priority === 'required' ? 'selected' : 'omitted',
          reasonCode: !omit || c.priority === 'required' ? 'WITHIN_BUDGET' : 'HISTORY_OMITTED_TO_BUDGET',
          owningBoundary: c.owningBoundary,
          safeIdentifier: c.safeIdentifier,
        })),
        roleEvidence: [],
      };
    },
  };
}

// =============================================================================
// Tests
// =============================================================================

describe('DefaultContextEngine — summary compression orchestration (§4)', () => {
  it('attempts compression when budget plan would drop prior_active_history, commits, and exposes compressionEvidence', async () => {
    // Pair each USER with its ASSISTANT under the SAME requestId so
    // selectHistoryCandidates groups them into complete visible turns
    // (USER → terminal ASSISTANT without open tool use). The current
    // request's messageId MUST equal the requestId because
    // selectHistoryCandidates anchors on the message with the same id
    // as the request.
    const u1 = userMessage('u1', 'old question 1', 'turn-1');
    const a1 = assistantMessage('a1', 'old answer 1', 'turn-1');
    const u2 = userMessage('u2', 'old question 2', 'turn-2');
    const a2 = assistantMessage('a2', 'old answer 2', 'turn-2');
    const current = userMessage('current-turn', 'the latest question', 'current-turn');
    const activeVersion = 7;
    const newVersion = 8;
    const { engine, runState, commitCalls } = makeFixture({
      messages: [
        sessionRecordFromMessage(u1),
        sessionRecordFromMessage(a1),
        sessionRecordFromMessage(u2),
        sessionRecordFromMessage(a2),
        sessionRecordFromMessage(current),
      ],
      active: activeContextView(['u1', 'a1', 'u2', 'a2', 'current-turn'], activeVersion),
      policy: makeThresholdPolicy({ totalEvidenceUnits: 120_000 }),
      commitResult: {
        status: 'UPDATED',
        record: activeContextView(['new-summary', 'current'], newVersion),
      },
      summaryMessageContent: 'summary of the 4 prior turns',
    });
    const result = await engine.assemble(makeRequest('current-turn'), undefined, new AbortController().signal);
    expect(commitCalls.length).toBe(1);
    expect(commitCalls[0]!.expectedVersion).toBe(activeVersion);
    expect(commitCalls[0]!.summaryMessage.role).toBe('SUMMARY');
    expect(commitCalls[0]!.summaryMessage.content).toBe('summary of the 4 prior turns');
    expect(commitCalls[0]!.summaryMessage.metadata['kind']).toBe('CONTEXT_COMPRESSION_SUMMARY');
    expect(commitCalls[0]!.summaryMessage.metadata['strategy']).toBe('PREFIX_COMPACT_RECENT_TAIL');
    expect(result.compressionEvidence).toBeDefined();
    expect(result.compressionEvidence!.sourceActiveContextVersion).toBe(activeVersion);
    expect(result.compressionEvidence!.targetActiveContextVersion).toBe(newVersion);
    expect(result.compressionEvidence!.strategy).toBe('PREFIX_COMPACT_RECENT_TAIL');
    expect(result.compressionEvidence!.edgeLabel).toBe('CONTEXT_COMPACTED_EVIDENCE');
    expect(result.compressionEvidence!.coveredMessageRefCount).toBe(2);
    expect(result.compressionEvidence!.retainedTailRefCount).toBe(2);
    // Summary message + retained tail (last complete turn) + current request should
    // be in selectedMessageRefs; covered prefix is dropped.
    expect(result.selectedMessageRefs).toEqual([msgId('summary-0'), msgId('u2'), msgId('a2'), msgId('current-turn')]);
    // The CONTEXT_COMPACTED checkpoint emission lives in
    // agent-core's default-agent.ts:render() (it forwards the
    // engine-produced evidence to runState.saveCheckpoint via the
    // existing triggerReason). That is covered by the
    // budget-degradation-notice integration test in agent-core.
  });

  it('falls back to omission path with SUMMARY_GENERATOR_UNCONFIGURED when no summary generator is composed', async () => {
    const u1 = userMessage('u1', 'x', 'turn-1');
    const a1 = assistantMessage('a1', 'y', 'turn-1');
    const current = userMessage('current', 'z');
    const fixture = makeFixture({
      messages: [sessionRecordFromMessage(u1), sessionRecordFromMessage(a1), sessionRecordFromMessage(current)],
      active: activeContextView(['u1', 'a1', 'current'], 1),
      policy: makeThresholdPolicy({ totalEvidenceUnits: 120_000 }),
      commitResult: { status: 'UPDATED', record: activeContextView(['current'], 2) },
    });
    // Replace the engine with one that has no summaryGenerator at all.
    const engine = new DefaultContextEngine({
      activeContextStore: {
        async loadActiveContext() {
          return activeContextView(['u1', 'a1', 'current'], 1);
        },
        async appendItem() {
          throw new Error('unused');
        },
        async commitCompaction() {
          throw new Error('unused');
        },
        async updateMetadata() {
          return { status: 'UPDATED' as const };
        },
      },
      messageStore: {
        async loadMessage(req) {
          return {
            tenantId: TENANT,
            subjectId: SUBJECT,
            agentId: AGENT,
            messageId: req.messageId,
            sessionId: SESSION,
            requestId: msgId('r'),
            role: 'USER',
            content: 'x',
            contentType: 'PLAIN_TEXT',
            metadata: {},
            visible: true,
            createdAt: brand<number, 'EpochMillis'>(1),
          };
        },
        async loadMessages(req) {
          // History selection now batch-loads via loadMessages; mirror the
          // per-ref loadMessage stub so assemble resolves every active-context
          // ref (the prior `return []` only worked when assemble used loadMessage).
          return req.messageIds.map((id) => ({
            tenantId: TENANT,
            subjectId: SUBJECT,
            agentId: AGENT,
            messageId: id,
            sessionId: SESSION,
            requestId: msgId('r'),
            role: 'USER',
            content: 'x',
            contentType: 'PLAIN_TEXT',
            metadata: {},
            visible: true,
            createdAt: brand<number, 'EpochMillis'>(1),
          }));
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
      },
      assemblyRegistry: { active: async () => makeAssembly(), require: async () => makeAssembly() },
      capabilityCatalog: { listAvailable: async () => [], resolve: async () => undefined },
      modelSelectionService: createTestModelSelectionService({ modelId: 'test-model', contextWindowTokens: 128_000, maxOutputTokens: 4_000 }),
      budgetPolicy: makeThresholdPolicy({ totalEvidenceUnits: 120_000 }),
    });
    const result = await engine.assemble(makeRequest('current'), undefined, new AbortController().signal);
    expect(result.compressionEvidence).toBeUndefined();
    expect(result.budgetPlan?.omittedContextTypes).toContain('prior_active_history');
    // The fixture's commit hook should NOT be called
    expect(fixture.commitCalls.length).toBe(0);
  });

  it('falls back with ACTIVE_CONTEXT_VERSION_CONFLICT when commit returns VERSION_CONFLICT', async () => {
    const u1 = userMessage('u1', 'x', 'turn-1');
    const a1 = assistantMessage('a1', 'y', 'turn-1');
    const current = userMessage('current', 'z');
    const { engine } = makeFixture({
      messages: [sessionRecordFromMessage(u1), sessionRecordFromMessage(a1), sessionRecordFromMessage(current)],
      active: activeContextView(['u1', 'a1', 'current'], 1),
      policy: makeThresholdPolicy({ totalEvidenceUnits: 120_000 }),
      commitResult: 'version_conflict',
    });
    const result = await engine.assemble(makeRequest('current'), undefined, new AbortController().signal);
    expect(result.compressionEvidence).toBeUndefined();
    expect(result.budgetPlan?.omittedContextTypes).toContain('prior_active_history');
  });

  it('falls back with SUMMARY_GENERATION_FAILED when the summary generator throws', async () => {
    const u1 = userMessage('u1', 'x', 'turn-1');
    const a1 = assistantMessage('a1', 'y', 'turn-1');
    const current = userMessage('current', 'z');
    const summaryGenerator: TraceableSummaryGenerationPort = {
      async generate(_request: TraceableSummaryGenerationRequest): Promise<TraceableSummaryDraft> {
        throw new Error('model broken');
      },
    };
    const { engine, runState } = makeFixture({
      messages: [sessionRecordFromMessage(u1), sessionRecordFromMessage(a1), sessionRecordFromMessage(current)],
      active: activeContextView(['u1', 'a1', 'current'], 1),
      summaryGenerator,
      policy: makeThresholdPolicy({ totalEvidenceUnits: 120_000 }),
      commitResult: { status: 'UPDATED', record: activeContextView(['current'], 2) },
    });
    const result = await engine.assemble(makeRequest('current'), undefined, new AbortController().signal);
    expect(result.compressionEvidence).toBeUndefined();
    expect(result.budgetPlan?.omittedContextTypes).toContain('prior_active_history');
    // No checkpoint should be written because no compression succeeded
    expect(runState.events.find((e) => e.type === 'CHECKPOINT_TRIGGER')).toBeUndefined();
  });

  it('falls back with SUMMARY_DRAFT_INVALID when the summary generator returns empty content', async () => {
    const u1 = userMessage('u1', 'x', 'turn-1');
    const a1 = assistantMessage('a1', 'y', 'turn-1');
    const current = userMessage('current', 'z');
    const summaryGenerator: TraceableSummaryGenerationPort = {
      async generate(): Promise<TraceableSummaryDraft> {
        return {
          content: '   ',
          sourceReferences: [],
          historyLookupLinkage: [],
          rehydrationHints: [],
          generationMode: 'normal',
          promptTemplateVersion: 'compact-summary/v1',
          inputUnitEstimate: 0,
          outputUnitEstimate: 0,
        };
      },
    };
    const { engine } = makeFixture({
      messages: [sessionRecordFromMessage(u1), sessionRecordFromMessage(a1), sessionRecordFromMessage(current)],
      active: activeContextView(['u1', 'a1', 'current'], 1),
      summaryGenerator,
      policy: makeThresholdPolicy({ totalEvidenceUnits: 120_000 }),
      commitResult: { status: 'UPDATED', record: activeContextView(['current'], 2) },
    });
    const result = await engine.assemble(makeRequest('current'), undefined, new AbortController().signal);
    expect(result.compressionEvidence).toBeUndefined();
    expect(result.budgetPlan?.omittedContextTypes).toContain('prior_active_history');
  });

  it('does NOT attempt compression when budget plan does NOT omit prior history (happy path)', async () => {
    const u1 = userMessage('u1', 'x');
    const current = userMessage('current', 'z');
    const happyPolicy: ContextBudgetPolicyPort = {
      evaluate(input) {
        return {
          plan: {
            decision: 'continue',
            reasonCode: 'WITHIN_BUDGET',
            compressionMode: 'none',
            degradationMode: [],
            pipelineStageStoppedAt: 'agent-context-engine.budget-decision-gate',
            estimatedFinalInputUnits: input.minimumSafeContextUnits,
            omittedContextTypes: [],
          },
          evidence: input.sourceCandidates.map((c) => ({
            category: c.category,
            estimatedInputUnits: c.estimatedInputUnits,
            status: 'selected' as const,
            reasonCode: 'WITHIN_BUDGET' as const,
            owningBoundary: c.owningBoundary,
            safeIdentifier: c.safeIdentifier,
          })),
          roleEvidence: [],
        };
      },
    };
    const { engine, commitCalls, runState } = makeFixture({
      messages: [sessionRecordFromMessage(u1), sessionRecordFromMessage(current)],
      active: activeContextView(['u1', 'current'], 1),
      policy: happyPolicy,
      commitResult: { status: 'UPDATED', record: activeContextView(['current'], 2) },
    });
    const result = await engine.assemble(makeRequest('current'), undefined, new AbortController().signal);
    expect(commitCalls.length).toBe(0);
    expect(result.compressionEvidence).toBeUndefined();
    expect(result.budgetPlan?.decision).toBe('continue');
    expect(runState.events.find((e) => e.type === 'CHECKPOINT_TRIGGER')).toBeUndefined();
  });

  it('summary draft NEVER leaks the raw draft.content to the safe payload (only the truncated DTO is exposed)', async () => {
    const u1 = userMessage('u1', 'x', 'turn-1');
    const a1 = assistantMessage('a1', 'y', 'turn-1');
    const current = userMessage('current', 'z');
    const longDraft = 'very long summary that should NOT appear in the evidence payload (raw coverage is not allowed)'.repeat(20);
    const summaryGenerator: TraceableSummaryGenerationPort = {
      async generate(): Promise<TraceableSummaryDraft> {
        return {
          content: longDraft,
          sourceReferences: [],
          historyLookupLinkage: [],
          rehydrationHints: [],
          generationMode: 'normal',
          promptTemplateVersion: 'compact-summary/v1',
          inputUnitEstimate: 0,
          outputUnitEstimate: longDraft.length,
        };
      },
    };
    const { engine, runState } = makeFixture({
      messages: [sessionRecordFromMessage(u1), sessionRecordFromMessage(a1), sessionRecordFromMessage(current)],
      active: activeContextView(['u1', 'a1', 'current'], 1),
      summaryGenerator,
      policy: makeThresholdPolicy({ totalEvidenceUnits: 120_000 }),
      commitResult: { status: 'UPDATED', record: activeContextView(['new-summary', 'current'], 2) },
    });
    const result = await engine.assemble(makeRequest('current'), undefined, new AbortController().signal);
    expect(result.compressionEvidence).toBeDefined();
    const serialized = JSON.stringify(result.compressionEvidence);
    // The evidence payload MUST NOT carry the raw draft content
    expect(serialized).not.toContain('very long summary');
    expect(serialized).not.toContain('raw coverage');
  });

  it('skips compression when commitCompaction is not composed, falls back to budget omission', async () => {
    const u1 = userMessage('u1', 'x', 'turn-1');
    const a1 = assistantMessage('a1', 'y', 'turn-1');
    const current = userMessage('current', 'z', 'current');
    // Create engine WITHOUT commitCompaction — compression should be
    // skipped even though summaryGenerator and budget policy both
    // indicate compression is needed.
    const engine = new DefaultContextEngine({
      activeContextStore: {
        async loadActiveContext() {
          return activeContextView(['u1', 'a1', 'current'], 1);
        },
        async appendItem() {
          throw new Error('unused');
        },
        async commitCompaction() {
          throw new Error('unused');
        },
        async updateMetadata() {
          return { status: 'UPDATED' as const };
        },
      },
      messageStore: {
        async loadMessage(req) {
          const map = new Map<string, SessionMessageRecord>([
            ['u1', sessionRecordFromMessage(u1)],
            ['a1', sessionRecordFromMessage(a1)],
            ['current', sessionRecordFromMessage(current)],
          ]);
          return map.get(req.messageId);
        },
        async loadMessages(req) {
          // History selection now batch-loads via loadMessages; mirror the
          // per-ref loadMessage map so assemble resolves every active-context
          // ref (the prior `return []` only worked when assemble used loadMessage).
          const map = new Map<string, SessionMessageRecord>([
            ['u1', sessionRecordFromMessage(u1)],
            ['a1', sessionRecordFromMessage(a1)],
            ['current', sessionRecordFromMessage(current)],
          ]);
          return req.messageIds.flatMap((id) => {
            const record = map.get(id);
            return record === undefined ? [] : [record];
          });
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
      },
      assemblyRegistry: { active: async () => makeAssembly(), require: async () => makeAssembly() },
      capabilityCatalog: { listAvailable: async () => [], resolve: async () => undefined },
      modelSelectionService: createTestModelSelectionService({ modelId: 'test-model', contextWindowTokens: 128_000, maxOutputTokens: 4_000 }),
      summaryGenerator: {
        async generate(): Promise<TraceableSummaryDraft> {
          return {
            content: 'should not be called',
            sourceReferences: [],
            historyLookupLinkage: [],
            rehydrationHints: [],
            generationMode: 'normal',
            promptTemplateVersion: 'compact-summary/v1',
            inputUnitEstimate: 0,
            outputUnitEstimate: 0,
          };
        },
      },
      // no commitCompaction — compression skipped
      budgetPolicy: makeThresholdPolicy({ totalEvidenceUnits: 120_000 }),
    });
    const result = await engine.assemble(makeRequest('current'), undefined, new AbortController().signal);
    expect(result.compressionEvidence).toBeUndefined();
    expect(result.budgetPlan?.omittedContextTypes).toContain('prior_active_history');
  });

  it('falls back with ACTIVE_CONTEXT_PERSISTENCE_FAILED when commit returns non-UPDATED status', async () => {
    const u1 = userMessage('u1', 'x', 'turn-1');
    const a1 = assistantMessage('a1', 'y', 'turn-1');
    const current = userMessage('current', 'z', 'current');
    const { engine } = makeFixture({
      messages: [sessionRecordFromMessage(u1), sessionRecordFromMessage(a1), sessionRecordFromMessage(current)],
      active: activeContextView(['u1', 'a1', 'current'], 1),
      policy: makeThresholdPolicy({ totalEvidenceUnits: 120_000 }),
      commitResult: 'persistence_failed',
    });
    const result = await engine.assemble(makeRequest('current'), undefined, new AbortController().signal);
    expect(result.compressionEvidence).toBeUndefined();
    expect(result.budgetPlan?.omittedContextTypes).toContain('prior_active_history');
  });

  it('compression splits prior turns: covers prefix, retains last turn as tail', async () => {
    const u1 = userMessage('u1', 'question about routing', 'turn-1');
    const a1 = assistantMessage('a1', 'routing answer 1', 'turn-1');
    const u2 = userMessage('u2', 'question about latency', 'turn-2');
    const a2 = assistantMessage('a2', 'latency answer 2', 'turn-2');
    const u3 = userMessage('u3', 'question about alarms', 'turn-3');
    const a3 = assistantMessage('a3', 'alarm answer 3', 'turn-3');
    const current = userMessage('current', 'latest question', 'current');
    let capturedCovered: readonly SessionMessage[] = [];
    let capturedRetainedTail: readonly SessionMessage[] = [];
    let capturedFlowVariables: Readonly<Record<string, string>> | undefined;
    const summaryGenerator: TraceableSummaryGenerationPort = {
      async generate(req: TraceableSummaryGenerationRequest): Promise<TraceableSummaryDraft> {
        capturedCovered = req.coveredMessages;
        capturedFlowVariables = req.flowVariables;
        capturedRetainedTail = req.retainedTailMessageRefs.map(
          (id) =>
            req.coveredMessages.find((m) => m.messageId === id) ?? {
              messageId: id,
              sessionId: SESSION,
              requestId: msgId('unknown'),
              role: 'USER' as const,
              content: '',
              contentType: 'PLAIN_TEXT',
              metadata: {},
              sequence: 0,
              visible: true,
              createdAt: brand<number, 'EpochMillis'>(1),
            },
        );
        return {
          content: 'summary of turns 1 and 2',
          sourceReferences: [...req.coveredMessageRefs],
          historyLookupLinkage: [...req.retainedTailMessageRefs],
          rehydrationHints: [],
          generationMode: 'normal',
          promptTemplateVersion: 'compact-summary/v1',
          inputUnitEstimate: 100,
          outputUnitEstimate: 50,
        };
      },
    };
    const { engine, commitCalls } = makeFixture({
      messages: [
        sessionRecordFromMessage(u1),
        sessionRecordFromMessage(a1),
        sessionRecordFromMessage(u2),
        sessionRecordFromMessage(a2),
        sessionRecordFromMessage(u3),
        sessionRecordFromMessage(a3),
        sessionRecordFromMessage(current),
      ],
      active: activeContextView(['u1', 'a1', 'u2', 'a2', 'u3', 'a3', 'current'], 1),
      summaryGenerator,
      policy: makeThresholdPolicy({ totalEvidenceUnits: 120_000 }),
      commitResult: { status: 'UPDATED', record: activeContextView(['summary', 'u3', 'a3', 'current'], 2) },
    });
    const result = await engine.assemble(
      makeRequest('current', { networkEnvironment: 'lab', operationLevel: 'PRODUCTION' }),
      undefined,
      new AbortController().signal,
    );

    // Covered = turns 1+2 (4 messages), retained = turn 3 (2 messages)
    expect(capturedCovered.map((m) => m.messageId)).toEqual([msgId('u1'), msgId('a1'), msgId('u2'), msgId('a2')]);
    expect(capturedFlowVariables).toEqual({
      networkEnvironment: 'lab',
      operationLevel: 'PRODUCTION',
    });
    expect(result.compressionEvidence).toBeDefined();
    expect(result.compressionEvidence!.coveredMessageRefCount).toBe(4);
    expect(result.compressionEvidence!.retainedTailRefCount).toBe(2);

    // Commit should include the summary
    expect(commitCalls.length).toBe(1);
    expect(commitCalls[0]!.summaryMessage.role).toBe('SUMMARY');
    expect(commitCalls[0]!.retainedTail).toEqual([msgId('u3'), msgId('a3'), msgId('current')]);

    // selectedMessageRefs = summary + retained tail + current request
    expect(result.selectedMessageRefs).toEqual([msgId('summary-0'), msgId('u3'), msgId('a3'), msgId('current')]);
  });

  it('with only one prior turn, all messages are covered and retained tail is empty', async () => {
    const u1 = userMessage('u1', 'only question', 'turn-1');
    const a1 = assistantMessage('a1', 'only answer', 'turn-1');
    const current = userMessage('current', 'new question', 'current');
    let capturedCoveredCount = 0;
    let capturedRetainedCount = -1;
    let capturedFlowVariables: Readonly<Record<string, string>> | undefined;
    const summaryGenerator: TraceableSummaryGenerationPort = {
      async generate(req: TraceableSummaryGenerationRequest): Promise<TraceableSummaryDraft> {
        capturedCoveredCount = req.coveredMessages.length;
        capturedRetainedCount = req.retainedTailMessageRefs.length;
        capturedFlowVariables = req.flowVariables;
        return {
          content: 'summary of the only turn',
          sourceReferences: [...req.coveredMessageRefs],
          historyLookupLinkage: [...req.retainedTailMessageRefs],
          rehydrationHints: [],
          generationMode: 'normal',
          promptTemplateVersion: 'compact-summary/v1',
          inputUnitEstimate: 50,
          outputUnitEstimate: 25,
        };
      },
    };
    const { engine, commitCalls } = makeFixture({
      messages: [sessionRecordFromMessage(u1), sessionRecordFromMessage(a1), sessionRecordFromMessage(current)],
      active: activeContextView(['u1', 'a1', 'current'], 1),
      summaryGenerator,
      policy: makeThresholdPolicy({ totalEvidenceUnits: 120_000 }),
      commitResult: { status: 'UPDATED', record: activeContextView(['summary', 'current'], 2) },
    });
    const result = await engine.assemble(makeRequest('current'), undefined, new AbortController().signal);

    // Only one turn → all covered, no retained tail
    expect(capturedCoveredCount).toBe(2);
    expect(capturedRetainedCount).toBe(0);
    expect(capturedFlowVariables).toEqual({});
    expect(result.compressionEvidence).toBeDefined();
    expect(result.compressionEvidence!.coveredMessageRefCount).toBe(2);
    expect(result.compressionEvidence!.retainedTailRefCount).toBe(0);
    expect(commitCalls[0]!.retainedTail).toEqual([msgId('current')]);

    // selectedMessageRefs = summary + current (no retained tail)
    expect(result.selectedMessageRefs).toEqual([msgId('summary-0'), msgId('current')]);
  });
});

// =============================================================================
// Proactive auto-compact threshold (tune-auto-compact-threshold)
// =============================================================================
//
// Summary compression now has a SINGLE trigger: the conversation token count
// reaching `availableInputUnits - 13_000` (≈ 92% of the effective window).
// The previous reactive "prior_active_history omitted" trigger is gone. These
// tests pin the threshold arithmetic precisely: `availableInputUnits` is
// `contextWindowTokens - maxOutputTokens` and `estimatedConversationInputUnits`
// is the sum of budget-gate evidence units (driven here via
// `makeThresholdPolicy({ totalEvidenceUnits })`).

describe('DefaultContextEngine — proactive auto-compact threshold', () => {
  function twoTurnFixture(opts: {
    readonly contextWindowTokens: number;
    readonly maxOutputTokens: number;
    readonly totalEvidenceUnits: number;
    readonly omitPriorHistory?: boolean;
    readonly commitResult?: VersionedUpdateResult<ActiveContextViewRecord> | 'version_conflict' | 'persistence_failed';
  }) {
    const u1 = userMessage('u1', 'old question', 'turn-1');
    const a1 = assistantMessage('a1', 'old answer', 'turn-1');
    const current = userMessage('current', 'latest question', 'current');
    return makeFixture({
      messages: [sessionRecordFromMessage(u1), sessionRecordFromMessage(a1), sessionRecordFromMessage(current)],
      active: activeContextView(['u1', 'a1', 'current'], 1),
      policy: makeThresholdPolicy({
        totalEvidenceUnits: opts.totalEvidenceUnits,
        omitPriorHistory: opts.omitPriorHistory ?? true,
      }),
      commitResult: opts.commitResult ?? { status: 'UPDATED', record: activeContextView(['summary', 'current'], 2) },
      contextWindowTokens: opts.contextWindowTokens,
      maxOutputTokens: opts.maxOutputTokens,
    });
  }

  it('triggers compression when conversation tokens reach availableInputUnits - 13_000', async () => {
    // availableInputUnits = 104_000 - 4_000 = 100_000; threshold = 87_000;
    // 88_000 >= 87_000 → fires.
    const { engine, commitCalls } = twoTurnFixture({
      contextWindowTokens: 104_000,
      maxOutputTokens: 4_000,
      totalEvidenceUnits: 88_000,
    });
    const result = await engine.assemble(makeRequest('current'), undefined, new AbortController().signal);
    expect(result.compressionEvidence).toBeDefined();
    expect(commitCalls.length).toBe(1);
    expect(result.compressionEvidence!.strategy).toBe('PREFIX_COMPACT_RECENT_TAIL');
  });

  it('does NOT trigger below the threshold even when prior_active_history is omitted', async () => {
    // threshold = 87_000; 80_000 < 87_000 → no fire. The budget gate still
    // omits prior_active_history (omitPriorHistory defaults true), proving
    // omission no longer drives compression.
    const { engine, commitCalls } = twoTurnFixture({
      contextWindowTokens: 104_000,
      maxOutputTokens: 4_000,
      totalEvidenceUnits: 80_000,
    });
    const result = await engine.assemble(makeRequest('current'), undefined, new AbortController().signal);
    expect(result.compressionEvidence).toBeUndefined();
    expect(commitCalls.length).toBe(0);
    expect(result.budgetPlan?.omittedContextTypes).toContain('prior_active_history');
  });

  it('does NOT trigger on a small window (availableInputUnits <= 13_000 guard)', async () => {
    // availableInputUnits = 16_000 - 4_000 = 12_000 <= 13_000 headroom → the
    // small-window guard blocks the trigger even though 20_000 would cross
    // a naive `12_000 - 13_000` threshold.
    const { engine, commitCalls } = twoTurnFixture({
      contextWindowTokens: 16_000,
      maxOutputTokens: 4_000,
      totalEvidenceUnits: 20_000,
    });
    const result = await engine.assemble(makeRequest('current'), undefined, new AbortController().signal);
    expect(result.compressionEvidence).toBeUndefined();
    expect(commitCalls.length).toBe(0);
  });

  it('falls back to budget-degraded result (no fake success) when commit returns VERSION_CONFLICT', async () => {
    // threshold = 87_000; 120_000 >= 87_000 → fires, but commit conflicts →
    // compressionEvidence undefined, budget-degraded result preserved.
    const { engine, commitCalls } = twoTurnFixture({
      contextWindowTokens: 104_000,
      maxOutputTokens: 4_000,
      totalEvidenceUnits: 120_000,
      commitResult: 'version_conflict',
    });
    const result = await engine.assemble(makeRequest('current'), undefined, new AbortController().signal);
    expect(result.compressionEvidence).toBeUndefined();
    expect(result.budgetPlan?.omittedContextTypes).toContain('prior_active_history');
    // commit was attempted (threshold fired) but the result is not faked
    expect(commitCalls.length).toBe(1);
  });
});

// =============================================================================
// Render negative tests (κ.5 §5)
// =============================================================================

describe('DefaultContextEngine.render() does NOT call summary generator or compress (§5)', () => {
  it('render() does not invoke the summary generator', async () => {
    const u1 = userMessage('current', 'x', 'current');
    const a1 = assistantMessage('a1', 'y', 'current');
    const summaryGenerator: TraceableSummaryGenerationPort = {
      generate: vi.fn(async (): Promise<TraceableSummaryDraft> => ({
        content: 'should never be called from render',
        sourceReferences: [],
        historyLookupLinkage: [],
        rehydrationHints: [],
        generationMode: 'normal',
        promptTemplateVersion: 'compact-summary/v1',
        inputUnitEstimate: 0,
        outputUnitEstimate: 0,
      })),
    };
    const { engine } = makeFixture({
      messages: [sessionRecordFromMessage(u1), sessionRecordFromMessage(a1)],
      active: activeContextView(['current', 'a1'], 1),
      summaryGenerator,
      commitResult: { status: 'UPDATED', record: activeContextView(['current', 'a1'], 1) },
    });
    const result = await engine.assemble(makeRequest('current'), undefined, new AbortController().signal);
    await engine.render(result);
    // Summary generator must NOT be called during render; assemble
    // (which calls it once) is fine.
    const calls = (summaryGenerator.generate as ReturnType<typeof vi.fn>).mock.calls.length;
    expect(calls).toBe(0);
  });
});

// Minimal JsonObject re-export to satisfy strict type checks in the
// AgentRunStatePort mock.
type JsonObject = import('@nextagent/agent-common').JsonObject;
type AgentRunStatePort = import('@nextagent/agent-contracts/runtime').AgentRunStatePort;
type VersionedUpdateResult<T> = import('@nextagent/agent-contracts/gateway').VersionedUpdateResult<T>;
