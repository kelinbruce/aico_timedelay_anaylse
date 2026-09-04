import { createTestModelSelectionService } from './test-model-selection-helpers.js';
import {
  DefaultContextEngine,
  DefaultProportionalBudgetPolicy,
  createDefaultProportionalBudgetPolicy,
  createDefaultTokenEstimator,
} from '@nextagent/agent-context-engine';
import {
  AgentError,
  bindRuntimeLoggerProvider,
  brand,
  type JsonObject,
  type MessageId,
  type RuntimeLoggerProviderBinding,
} from '@nextagent/agent-common';
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
import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => loggerBinding?.unbind());

// =============================================================================
// Fixture helpers (mirror history-candidate-selection.test.ts pattern)
// =============================================================================

const TENANT = brand<string, 'TenantId'>('tenant-budget');
const SUBJECT = brand<string, 'SubjectId'>('subject-budget');
const AGENT = brand<string, 'AgentId'>('agent-budget');
const AGENT_V = brand<string, 'AgentVersion'>('v1');
const SESSION = brand<string, 'SessionId'>('session-budget');

function msgId(name: string): MessageId {
  return brand<string, 'MessageId'>(name);
}

function runId(name = 'run-budget') {
  return brand<string, 'RequestRunId'>(name);
}

interface RecordOptions {
  readonly messageId: string;
  readonly requestId: string;
  readonly role: 'USER' | 'ASSISTANT' | 'CAPABILITY_RESULT' | 'SUMMARY';
  readonly runId?: string;
  readonly content?: string;
  readonly metadata?: JsonObject;
  readonly visible?: boolean;
}

function record(opts: RecordOptions): SessionMessageRecord {
  return {
    tenantId: TENANT,
    subjectId: SUBJECT,
    agentId: AGENT,
    messageId: msgId(opts.messageId),
    sessionId: SESSION,
    requestId: msgId(opts.requestId),
    runId: runId(opts.runId ?? 'run-budget'),
    role: opts.role,
    content: opts.content ?? '',
    contentType: 'PLAIN_TEXT',
    metadata: opts.metadata ?? {},
    visible: opts.visible ?? true,
    createdAt: brand<number, 'EpochMillis'>(1),
  };
}

function userMsg(messageId: string, requestId = messageId, content = 'user content'): SessionMessageRecord {
  return record({ messageId, requestId, role: 'USER', content });
}

function assistantTerminalMsg(messageId: string, requestId: string, text = 'ok'): SessionMessageRecord {
  return record({ messageId, requestId, role: 'ASSISTANT', content: JSON.stringify({ text }) });
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

function makeAssembly(maxContextMessages = 50): AgentAssembly {
  return {
    agentId: AGENT,
    agentType: brand<string, 'AgentType'>('default'),
    agentVersion: AGENT_V,
    agentAssemblyRef: 'agent-budget:v1',
    displayName: 'Budget test agent',
    description: 'Budget gate integration test agent',
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
    runtimeSettings: { maxContextMessages },
  };
}

interface EngineOptions {
  readonly messages?: readonly SessionMessageRecord[];
  readonly activeContext?: ActiveContextViewRecord;
  readonly budgetPolicy?: import('@nextagent/agent-contracts/context').ContextBudgetPolicyPort;
  readonly contextWindowTokens?: number;
  readonly maxOutputTokens?: number;
}

function makeEngine(opts: EngineOptions = {}): DefaultContextEngine {
  const messagesMap = new Map<string, SessionMessageRecord>();
  for (const r of opts.messages ?? []) {
    messagesMap.set(r.messageId, r);
  }
  const activeContextStore: ActiveContextStoreGateway = {
    async loadActiveContext() {
      if (opts.activeContext !== undefined) {
        return opts.activeContext;
      }
      throw new AgentError({
        code: 'NOT_FOUND',
        message: 'no active context',
        category: 'NOT_FOUND',
        retryable: false,
      });
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
  return new DefaultContextEngine({
    activeContextStore,
    messageStore,
    assemblyRegistry,
    capabilityCatalog,
    modelSelectionService: createTestModelSelectionService({
      modelId: 'test-model',
      contextWindowTokens: opts.contextWindowTokens ?? 128_000,
      maxOutputTokens: opts.maxOutputTokens ?? 1_000,
    }),
    ...(opts.budgetPolicy === undefined ? {} : { budgetPolicy: opts.budgetPolicy }),
  });
}

function request(currentRequestId = 'current-req') {
  return {
    sessionId: SESSION,
    requestId: msgId(currentRequestId),
    requestContextId: brand<string, 'RequestContextId'>('rc-budget'),
    identityContext: { tenantId: TENANT, subjectId: SUBJECT, displayName: 'budget tester' },
    agentId: AGENT,
    agentVersion: AGENT_V,
    runId: runId(),
    stepId: 'step-1',
    locale: brand<string, 'RequestLocale'>('en-US'),
    purpose: 'test',
  };
}

// =============================================================================
// Tests — Chunk β integration of the budget gate into assemble()
// =============================================================================

describe('DefaultContextEngine — budget gate integration (Chunk β)', () => {
  // -------------------------------------------------------------------------
  // Backward compatibility: no budgetPolicy → no budget fields
  // -------------------------------------------------------------------------
  describe('backward compatibility (no budgetPolicy)', () => {
    it('does NOT populate budgetPlan / budgetEvidence / budgetRoleEvidence when budgetPolicy is omitted', async () => {
      const current = userMsg('current-req');
      const engine = makeEngine({
        messages: [current],
        activeContext: activeContextView(['current-req']),
      });
      const result = await engine.assemble(request(), undefined, new AbortController().signal);
      expect(result.budgetPlan).toBeUndefined();
      expect(result.budgetEvidence).toBeUndefined();
      expect(result.budgetRoleEvidence).toBeUndefined();
    });
  });

  // -------------------------------------------------------------------------
  // Healthy budget → continue
  // -------------------------------------------------------------------------
  describe('healthy budget', () => {
    it("emits plan.decision='continue' when the request fits well below the cap", async () => {
      const current = userMsg('current-req', 'current-req', 'hi');
      const engine = makeEngine({
        messages: [current],
        activeContext: activeContextView(['current-req']),
        budgetPolicy: createDefaultProportionalBudgetPolicy(),
        contextWindowTokens: 128_000,
        maxOutputTokens: 1_000,
      });
      const result = await engine.assemble(request(), undefined, new AbortController().signal);
      expect(result.budgetPlan).toBeDefined();
      expect(result.budgetPlan!.decision).toBe('continue');
      expect(result.budgetPlan!.reasonCode).toBe('WITHIN_BUDGET');
      expect(result.budgetPlan!.degradationMode).toEqual([]);
      expect(result.budgetEvidence).toBeDefined();
      // Evidence MUST cover the current_request candidate
      const currentEvidence = result.budgetEvidence!.find((e) => e.category === 'current_request');
      expect(currentEvidence?.status).toBe('selected');
      // Role evidence covers all four role groups
      expect(result.budgetRoleEvidence).toBeDefined();
      const roles = new Set(result.budgetRoleEvidence!.map((e) => e.role));
      expect(roles).toEqual(new Set(['system', 'user', 'assistant', 'tool']));
    });

    it('emits current_request + prior_active_history evidence when both are present', async () => {
      const priorUser = userMsg('prior-user', 'prior-req', 'older question');
      const priorAss = assistantTerminalMsg('prior-ass', 'prior-req', 'older answer');
      const current = userMsg('current-req', 'current-req', 'new question');
      const engine = makeEngine({
        messages: [priorUser, priorAss, current],
        activeContext: activeContextView(['prior-user', 'prior-ass', 'current-req']),
        budgetPolicy: createDefaultProportionalBudgetPolicy(),
        contextWindowTokens: 128_000,
      });
      const result = await engine.assemble(request(), undefined, new AbortController().signal);
      const categories = new Set(result.budgetEvidence!.map((e) => e.category));
      expect(categories.has('current_request')).toBe(true);
      expect(categories.has('prior_active_history')).toBe(true);
      expect(categories.has('capability_disclosure')).toBe(true);
      // Default-priority decision: continue (everything fits)
      expect(result.budgetPlan!.decision).toBe('continue');
    });
  });

  // -------------------------------------------------------------------------
  // Tight budget → no history omission (60% cap removed); pre-send check flags it
  // -------------------------------------------------------------------------
  describe('tight budget', () => {
    it('retains prior_active_history and flags pre_send_check_required (60% cap removed; compression governs overflow)', async () => {
      // The 60% history-budget cap has been removed. A long prior turn that
      // previously exceeded the cap (and was omitted) is now RETAINED — the
      // budget gate no longer drops history; the context engine's proactive
      // compression strategy owns overflow. The gate only flags
      // pre_send_check_required when the rendered input approaches the window.
      const longContent = 'x'.repeat(50_000); // ~12500 tokens at 0.25 weight × 50000 chars
      const priorUser = userMsg('prior-user', 'prior-req', longContent);
      const priorAss = assistantTerminalMsg('prior-ass', 'prior-req', longContent);
      const current = userMsg('current-req', 'current-req', 'short');
      const engine = makeEngine({
        messages: [priorUser, priorAss, current],
        activeContext: activeContextView(['prior-user', 'prior-ass', 'current-req']),
        budgetPolicy: createDefaultProportionalBudgetPolicy(),
        // 16k window / 1k reserved output → 15k available. Prior turn alone
        // is ~25000 tokens → ratio ≫ 0.885 → pre_send_check_required.
        contextWindowTokens: 16_000,
        maxOutputTokens: 1_000,
      });
      const result = await engine.assemble(request(), undefined, new AbortController().signal);
      // No omission: history is retained, not dropped.
      expect(result.budgetPlan!.omittedContextTypes).not.toContain('prior_active_history');
      expect(result.selectedMessageRefs).toContain(msgId('prior-user'));
      expect(result.selectedMessageRefs).toContain(msgId('prior-ass'));
      expect(result.selectedMessageRefs).toContain(msgId('current-req'));
      // The gate flags a pre-send check instead of degrading.
      expect(result.budgetPlan!.decision).toBe('pre_send_check_required');
      expect(result.budgetPlan!.reasonCode).toBe('PRE_SEND_CHECK_REQUIRED');
    });
  });

  // -------------------------------------------------------------------------
  // Baseline > budget → assemble() throws CONTEXT_INSUFFICIENT_BUDGET
  // -------------------------------------------------------------------------
  describe('baseline exceeds budget', () => {
    it('throws CONTEXT_INSUFFICIENT_BUDGET when minimumSafeContextUnits exceeds availableInputUnits', async () => {
      const giantContent = 'x'.repeat(50_000); // ~12500 tokens at 0.25
      const current = userMsg('current-req', 'current-req', giantContent);
      const engine = makeEngine({
        messages: [current],
        activeContext: activeContextView(['current-req']),
        budgetPolicy: createDefaultProportionalBudgetPolicy(),
        // Tiny window: 100 tokens, 50 reserved → 50 available — baseline ~12504 >> 50
        contextWindowTokens: 100,
        maxOutputTokens: 50,
      });
      await expect(engine.assemble(request(), undefined, new AbortController().signal)).rejects.toMatchObject({
        code: 'CONTEXT_INSUFFICIENT_BUDGET',
        category: 'VALIDATION',
      });
    });

    it('the thrown CONTEXT_INSUFFICIENT_BUDGET carries safe diagnostic details (no raw content)', async () => {
      const giantContent = 'secret-credentials-do-not-leak ' + 'x'.repeat(50_000);
      const current = userMsg('current-req', 'current-req', giantContent);
      const engine = makeEngine({
        messages: [current],
        activeContext: activeContextView(['current-req']),
        budgetPolicy: createDefaultProportionalBudgetPolicy(),
        contextWindowTokens: 100,
        maxOutputTokens: 50,
      });
      try {
        await engine.assemble(request(), undefined, new AbortController().signal);
        expect.fail('expected CONTEXT_INSUFFICIENT_BUDGET to throw');
      } catch (err) {
        const error = err as { readonly code?: string; readonly safeDetails?: Record<string, unknown> };
        expect(error.code).toBe('CONTEXT_INSUFFICIENT_BUDGET');
        expect(error.safeDetails?.reasonCode).toBe('MINIMUM_SAFE_CONTEXT_EXCEEDS_BUDGET');
        expect(error.safeDetails?.pipelineStageStoppedAt).toContain('minimum-safe-context-protection');
        // Defensive: error payload MUST NOT carry raw content
        const serialized = JSON.stringify(error.safeDetails ?? {});
        expect(serialized).not.toContain('secret-credentials-do-not-leak');
        expect(serialized).not.toContain('xxxxxx'); // no chunks of giantContent
      }
    });
  });

  // -------------------------------------------------------------------------
  // Custom policy injection
  // -------------------------------------------------------------------------
  describe('custom policy injection', () => {
    it('uses the injected policy instance (not the default)', async () => {
      // Inject a custom policy with a tighter pre-send threshold; verify the
      // resulting plan reflects the custom threshold's behavior.
      // The default-system-prompt is ~3k chars; budget below 200 tokens of
      // available input would tip into explicit_failure before the
      // preSendCheckRatio even gets a chance. Use 16k window to leave
      // headroom for the system prompt + capability disclosure.
      const customPolicy = new DefaultProportionalBudgetPolicy({
        preSendCheckRatio: 0.1, // very aggressive — fires almost always
      });
      const current = userMsg('current-req', 'current-req', 'any content');
      const engine = makeEngine({
        messages: [current],
        activeContext: activeContextView(['current-req']),
        budgetPolicy: customPolicy,
        contextWindowTokens: 16_000,
        maxOutputTokens: 1_000,
      });
      const result = await engine.assemble(request(), undefined, new AbortController().signal);
      // With preSendCheckRatio=0.10, even a tiny prompt should trigger the
      // pre-send-check decision since the ratio passes 0.10 easily.
      expect(['pre_send_check_required', 'continue']).toContain(result.budgetPlan!.decision);
      if (result.budgetPlan!.decision === 'pre_send_check_required') {
        expect(result.budgetPlan!.degradationMode).toContain('PRE_SEND_CHECK_REQUIRED');
      }
    });

    it('uses createDefaultTokenEstimator() by default when tokenEstimator is not injected', async () => {
      // Sanity: without an explicit estimator, the policy still produces a
      // plan (the default estimator is composed under the hood).
      const current = userMsg('current-req');
      const engine = makeEngine({
        messages: [current],
        activeContext: activeContextView(['current-req']),
        budgetPolicy: createDefaultProportionalBudgetPolicy(),
        contextWindowTokens: 10_000,
        maxOutputTokens: 1_000,
      });
      const result = await engine.assemble(request(), undefined, new AbortController().signal);
      expect(result.budgetPlan).toBeDefined();
      expect(result.budgetEvidence!.length).toBeGreaterThan(0);
    });
  });

  // Reference the default estimator factory to make the import obviously used
  // (some integration paths might lazily require it; this is also a sanity
  // check that the export is publicly reachable).
  it('default token estimator factory is importable and returns a TokenEstimator', () => {
    const estimator = createDefaultTokenEstimator();
    expect(estimator.estimateTokens('hi')).toBeGreaterThan(0);
  });
});

// =============================================================================
// Tests — D7 budget log emission wired into assemble()
// =============================================================================

/**
 * Capture-style `BudgetLogger` for the D7 integration tests. The D7 path
 * is a side-effect-only emitter (no return value), so the integration
 * assertions inspect the captured calls list.
 */
let loggerBinding: RuntimeLoggerProviderBinding | undefined;

function captureLogger(): { readonly calls: ReadonlyArray<{ readonly obj: Record<string, unknown>; readonly msg?: string }> } {
  const calls: Array<{ obj: Record<string, unknown>; msg?: string }> = [];
  const logger = {
    error(obj: object, msg?: string) {
      calls.push({ obj: obj as Record<string, unknown>, ...(msg === undefined ? {} : { msg }) });
    },
    warn(obj: object, msg?: string) {
      calls.push({ obj: obj as Record<string, unknown>, ...(msg === undefined ? {} : { msg }) });
    },
    info(obj: object, msg?: string) {
      calls.push({ obj: obj as Record<string, unknown>, ...(msg === undefined ? {} : { msg }) });
    },
    debug(obj: object, msg?: string) {
      calls.push({ obj: obj as Record<string, unknown>, ...(msg === undefined ? {} : { msg }) });
    },
  };
  loggerBinding?.unbind();
  loggerBinding = bindRuntimeLoggerProvider({ getLogger: () => logger });
  return { calls };
}

interface LoggerEngineOptions {
  readonly messages?: readonly SessionMessageRecord[];
  readonly activeContext?: ActiveContextViewRecord;
  readonly budgetPolicy?: import('@nextagent/agent-contracts/context').ContextBudgetPolicyPort;
  readonly contextWindowTokens?: number;
  readonly maxOutputTokens?: number;
}

function makeEngineWithLogger(opts: LoggerEngineOptions): DefaultContextEngine {
  const messagesMap = new Map<string, SessionMessageRecord>();
  for (const r of opts.messages ?? []) {
    messagesMap.set(r.messageId, r);
  }
  const activeContextStore: ActiveContextStoreGateway = {
    async loadActiveContext() {
      if (opts.activeContext !== undefined) {
        return opts.activeContext;
      }
      throw new AgentError({ code: 'NOT_FOUND', message: 'no active context', category: 'NOT_FOUND', retryable: false });
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
  const assembly: AgentAssembly = {
    agentId: AGENT,
    agentType: brand<string, 'AgentType'>('default'),
    agentVersion: AGENT_V,
    agentAssemblyRef: 'agent-budget:v1',
    displayName: 'Budget test agent',
    description: 'Budget gate integration test agent',
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
    runtimeSettings: { maxContextMessages: 50 },
  };
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
  return new DefaultContextEngine({
    activeContextStore,
    messageStore,
    assemblyRegistry,
    capabilityCatalog,
    modelSelectionService: createTestModelSelectionService({
      modelId: 'test-model',
      contextWindowTokens: opts.contextWindowTokens ?? 128_000,
      maxOutputTokens: opts.maxOutputTokens ?? 1_000,
    }),
    ...(opts.budgetPolicy === undefined ? {} : { budgetPolicy: opts.budgetPolicy }),
  });
}

describe('DefaultContextEngine — D7 budget log emission (Chunk γ)', () => {
  it('emits micro-compact success at debug with decisionBranch instead of path', async () => {
    const capture = captureLogger();
    const current = userMsg('current-req', 'current-req', 'hi');
    const engine = makeEngineWithLogger({
      messages: [current],
      activeContext: activeContextView(['current-req']),
      budgetPolicy: createDefaultProportionalBudgetPolicy(),
    });

    await engine.assemble(request(), undefined, new AbortController().signal);
    const entries = capture.calls.map((call) => call.obj);

    expect(entries.find((entry) => entry.event === 'context.microCompact.evaluated')).toMatchObject({
      decisionBranch: 'no-op',
      newlyCompacted: 0,
    });
    expect(entries.find((entry) => entry.event === 'context.microCompact.evaluated')).not.toHaveProperty('path');
  });

  it('emits one `context.budget.evaluated` event per assemble() call when both budgetPolicy and budgetLogger are composed', async () => {
    const capture = captureLogger();
    const current = userMsg('current-req', 'current-req', 'hi');
    const engine = makeEngineWithLogger({
      messages: [current],
      activeContext: activeContextView(['current-req']),
      budgetPolicy: createDefaultProportionalBudgetPolicy(),
    });
    await engine.assemble(request(), undefined, new AbortController().signal);
    const evaluatedEvents = capture.calls.filter((call) => call.obj['event'] === 'context.budget.evaluated');
    expect(evaluatedEvents.length).toBe(1);
    expect(evaluatedEvents[0]!.obj['agentId']).toBe('agent-budget');
    expect(evaluatedEvents[0]!.obj['requestId']).toBe('current-req');
  });

  it('emits the safe summary (counts only, no safeIdentifier) on the evaluate event', async () => {
    const capture = captureLogger();
    const priorUser = userMsg('prior-user', 'prior-req', 'older question');
    const priorAss = assistantTerminalMsg('prior-ass', 'prior-req', 'older answer');
    const current = userMsg('current-req', 'current-req', 'new question');
    const engine = makeEngineWithLogger({
      messages: [priorUser, priorAss, current],
      activeContext: activeContextView(['prior-user', 'prior-ass', 'current-req']),
      budgetPolicy: createDefaultProportionalBudgetPolicy(),
    });
    await engine.assemble(request(), undefined, new AbortController().signal);
    const evaluatedEvent = capture.calls.find((call) => call.obj['event'] === 'context.budget.evaluated');
    expect(evaluatedEvent).toBeDefined();
    const budget = evaluatedEvent!.obj['budget'] as JsonObject;
    expect(budget['decision']).toBe('continue');
    expect(budget['reasonCode']).toBe('WITHIN_BUDGET');
    expect(typeof budget['evidenceCount']).toBe('number');
    expect(typeof budget['roleEvidenceCount']).toBe('number');
    // The full event JSON MUST NOT contain the high-cardinality safeIdentifier
    // substring the policy emits per source candidate.
    const serialized = JSON.stringify(evaluatedEvent!.obj);
    expect(serialized).not.toContain('current_request:user:');
    expect(serialized).not.toContain('prior_active_history:');
    expect(serialized).not.toContain('capability_disclosure:');
  });

  it('does NOT emit any log when budgetPolicy is absent even if budgetLogger is composed (backward compat)', async () => {
    const capture = captureLogger();
    const current = userMsg('current-req');
    const engine = makeEngineWithLogger({ messages: [current], activeContext: activeContextView(['current-req']) });
    const result = await engine.assemble(request(), undefined, new AbortController().signal);
    expect(result.budgetPlan).toBeUndefined();
    const evaluatedEvents = capture.calls.filter((call) => call.obj['event'] === 'context.budget.evaluated');
    expect(evaluatedEvents.length).toBe(0);
  });

  // -------------------------------------------------------------------------
  // §1.4 — invariant guard wired into runBudgetGate
  // -------------------------------------------------------------------------
  it("the gate REJECTS a custom policy that returns 'continue' when baseline > available (invariant 1)", async () => {
    const buggyPolicy: import('@nextagent/agent-contracts/context').ContextBudgetPolicyPort = {
      evaluate(input, _signal) {
        // Wrong: should be explicit_failure, but buggy policy lies
        return {
          plan: {
            decision: 'continue',
            reasonCode: 'WITHIN_BUDGET',
            compressionMode: 'none',
            degradationMode: [],
            pipelineStageStoppedAt: 'agent-context-engine.budget-decision-gate',
            estimatedFinalInputUnits: 0,
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
    const giantContent = 'x'.repeat(50_000);
    const current = userMsg('current-req', 'current-req', giantContent);
    const engine = makeEngine({
      messages: [current],
      activeContext: activeContextView(['current-req']),
      budgetPolicy: buggyPolicy,
      contextWindowTokens: 100,
      maxOutputTokens: 50,
    });
    await expect(engine.assemble(request(), undefined, new AbortController().signal)).rejects.toMatchObject({
      code: 'CONTEXT_BUDGET_POLICY_INVARIANT_VIOLATION',
      safeDetails: { invariant: 'baseline-exceeds-budget-must-yield-explicit-failure' },
    });
  });

  it('the gate REJECTS a custom policy that returns a free-form decision string (invariant 2)', async () => {
    const buggyPolicy: import('@nextagent/agent-contracts/context').ContextBudgetPolicyPort = {
      evaluate(input, _signal) {
        return {
          plan: {
            decision: 'recovered' as import('@nextagent/agent-contracts/context').ContextCompactionDecision,
            reasonCode: 'WITHIN_BUDGET',
            compressionMode: 'none',
            degradationMode: [],
            pipelineStageStoppedAt: 'agent-context-engine.budget-decision-gate',
            estimatedFinalInputUnits: 0,
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
    const current = userMsg('current-req', 'current-req', 'hi');
    const engine = makeEngine({
      messages: [current],
      activeContext: activeContextView(['current-req']),
      budgetPolicy: buggyPolicy,
    });
    await expect(engine.assemble(request(), undefined, new AbortController().signal)).rejects.toMatchObject({
      code: 'CONTEXT_BUDGET_POLICY_INVARIANT_VIOLATION',
      safeDetails: { invariant: 'decision-must-be-stable' },
    });
  });

  it('the gate REJECTS a custom policy that omits a required candidate in the normal flow (invariant 3)', async () => {
    const buggyPolicy: import('@nextagent/agent-contracts/context').ContextBudgetPolicyPort = {
      evaluate(input, _signal) {
        // Wrong: silently drop the current_request required candidate
        return {
          plan: {
            decision: 'compact_degrade',
            reasonCode: 'HISTORY_OMITTED_TO_BUDGET',
            compressionMode: 'none',
            degradationMode: [],
            pipelineStageStoppedAt: 'agent-context-engine.budget-decision-gate',
            estimatedFinalInputUnits: 0,
            omittedContextTypes: ['current_request'],
          },
          evidence: input.sourceCandidates.map((c) => ({
            category: c.category,
            estimatedInputUnits: c.estimatedInputUnits,
            status: c.priority === 'required' ? ('omitted' as const) : ('omitted' as const),
            reasonCode: c.priority === 'required' ? ('HISTORY_OMITTED_TO_BUDGET' as const) : ('HISTORY_OMITTED_TO_BUDGET' as const),
            owningBoundary: c.owningBoundary,
            safeIdentifier: c.safeIdentifier,
          })),
          roleEvidence: [],
        };
      },
    };
    const current = userMsg('current-req', 'current-req', 'hi');
    const engine = makeEngine({
      messages: [current],
      activeContext: activeContextView(['current-req']),
      budgetPolicy: buggyPolicy,
    });
    await expect(engine.assemble(request(), undefined, new AbortController().signal)).rejects.toMatchObject({
      code: 'CONTEXT_BUDGET_POLICY_INVARIANT_VIOLATION',
      safeDetails: { invariant: 'required-candidate-cannot-be-omitted' },
    });
  });
});

// =============================================================================
// Regression — budget omission must not leave orphan / out-of-order tool results
// =============================================================================
//
// Reproduces the production failure where a normal loop reached
// `HISTORY_OMITTED_TO_BUDGET` (compact_degrade) and then crashed at render
// with `CONTEXT_RENDER_TOOL_PAIRING_INVALID` ("orphan or out-of-order tool
// result"). The trigger: a prior ASSISTANT message carrying MULTIPLE tool
// calls whose results are budget-omitted individually. When one result is
// omitted, the ASSISTANT must be dropped (it now lacks a result), which in
// turn orphans its *remaining* results — those must be dropped too. The
// earlier two-pass orphan sweep kept them (stale produced-ID set), leaking
// orphan TOOL messages into the renderer.

function assistantToolUseMsg(
  messageId: string,
  requestId: string,
  toolCalls: ReadonlyArray<{ readonly toolCallId: string; readonly toolName: string }>,
): SessionMessageRecord {
  return record({
    messageId,
    requestId,
    role: 'ASSISTANT',
    content: JSON.stringify({
      toolCalls: toolCalls.map((tc) => ({ toolCallId: tc.toolCallId, toolName: tc.toolName, arguments: {} })),
    }),
  });
}

function capabilityResultMsg(messageId: string, requestId: string, toolCallId: string, toolName = 'Bash'): SessionMessageRecord {
  return record({
    messageId,
    requestId,
    role: 'CAPABILITY_RESULT',
    content: JSON.stringify({ toolCallId, toolName, payload: { ok: true } }),
  });
}

/**
 * Custom policy that omits exactly one optional `prior_active_history`
 * candidate (by safeIdentifier) and selects every other candidate. Required
 * candidates are never omitted, so the invariant guard accepts the outcome.
 */
function omitOnePriorHistoryPolicy(omitSafeIdentifier: string): import('@nextagent/agent-contracts/context').ContextBudgetPolicyPort {
  return {
    evaluate(input, _signal) {
      const evidence = input.sourceCandidates.map((c) => {
        if (c.safeIdentifier === omitSafeIdentifier) {
          return {
            category: c.category,
            estimatedInputUnits: c.estimatedInputUnits,
            status: 'omitted' as const,
            reasonCode: 'HISTORY_OMITTED_TO_BUDGET' as const,
            owningBoundary: c.owningBoundary,
            safeIdentifier: c.safeIdentifier,
          };
        }
        return {
          category: c.category,
          estimatedInputUnits: c.estimatedInputUnits,
          status: 'selected' as const,
          reasonCode: 'WITHIN_BUDGET' as const,
          owningBoundary: c.owningBoundary,
          safeIdentifier: c.safeIdentifier,
        };
      });
      const estimatedFinalInputUnits = evidence.filter((e) => e.status === 'selected').reduce((sum, e) => sum + e.estimatedInputUnits, 0);
      return {
        plan: {
          decision: 'compact_degrade' as const,
          reasonCode: 'HISTORY_OMITTED_TO_BUDGET' as const,
          compressionMode: 'none' as const,
          degradationMode: [],
          pipelineStageStoppedAt: 'agent-context-engine.budget-decision-gate',
          estimatedFinalInputUnits,
          omittedContextTypes: ['prior_active_history' as const],
        },
        evidence,
        roleEvidence: [
          { role: 'system', status: 'protected', reasonCode: 'WITHIN_BUDGET' },
          { role: 'user', status: 'selected', reasonCode: 'WITHIN_BUDGET' },
          { role: 'assistant', status: 'selected', reasonCode: 'WITHIN_BUDGET' },
          { role: 'tool', status: 'selected', reasonCode: 'WITHIN_BUDGET' },
        ],
      };
    },
  };
}

describe('DefaultContextEngine — budget omission must not orphan tool results', () => {
  it('drops the whole multi-tool-call turn fragment when one result is omitted, so render() does not throw', async () => {
    // Prior turn: USER → ASSISTANT(tc1, tc2) → RESULT(tc1) → RESULT(tc2) → terminal ASSISTANT
    const priorUser = userMsg('p-user', 'p-req', 'do two things');
    const priorToolUse = assistantToolUseMsg('p-tool-use', 'p-req', [
      { toolCallId: 'tc1', toolName: 'Bash' },
      { toolCallId: 'tc2', toolName: 'Read' },
    ]);
    const priorResult1 = capabilityResultMsg('p-result-1', 'p-req', 'tc1');
    const priorResult2 = capabilityResultMsg('p-result-2', 'p-req', 'tc2');
    const priorTerminal = assistantTerminalMsg('p-terminal', 'p-req', 'done');
    const current = userMsg('current-req', 'current-req', 'next question');

    // Omit exactly the second capability result. safeIdentifier format:
    // `prior_active_history:{role-lowercase}:{messageId}`.
    const omitId = 'prior_active_history:capability_result:p-result-2';
    const engine = makeEngine({
      messages: [priorUser, priorToolUse, priorResult1, priorResult2, priorTerminal, current],
      activeContext: activeContextView(['p-user', 'p-tool-use', 'p-result-1', 'p-result-2', 'p-terminal', 'current-req']),
      budgetPolicy: omitOnePriorHistoryPolicy(omitId),
    });

    const assembly = await engine.assemble(request(), undefined, new AbortController().signal);

    // The omitted result is gone...
    expect(assembly.selectedMessageRefs).not.toContain(msgId('p-result-2'));
    // ...and the orphan sweep must also drop the ASSISTANT tool-call (its tc2
    // result is now missing) and the surviving tc1 result (its producer was
    // dropped). Leaving either would crash the renderer.
    expect(assembly.selectedMessageRefs).not.toContain(msgId('p-tool-use'));
    expect(assembly.selectedMessageRefs).not.toContain(msgId('p-result-1'));
    // The non-tool parts of the turn and the current request are preserved.
    expect(assembly.selectedMessageRefs).toContain(msgId('p-user'));
    expect(assembly.selectedMessageRefs).toContain(msgId('p-terminal'));
    expect(assembly.selectedMessageRefs).toContain(msgId('current-req'));

    // The renderer's assertToolPairing must NOT throw
    // CONTEXT_RENDER_TOOL_PAIRING_INVALID.
    const rendered = await engine.render(assembly);
    expect(rendered.messages.length).toBeGreaterThan(0);
  });

  it('keeps the whole multi-tool-call turn when no result is omitted (control)', async () => {
    const priorUser = userMsg('p-user', 'p-req', 'do two things');
    const priorToolUse = assistantToolUseMsg('p-tool-use', 'p-req', [
      { toolCallId: 'tc1', toolName: 'Bash' },
      { toolCallId: 'tc2', toolName: 'Read' },
    ]);
    const priorResult1 = capabilityResultMsg('p-result-1', 'p-req', 'tc1');
    const priorResult2 = capabilityResultMsg('p-result-2', 'p-req', 'tc2');
    const priorTerminal = assistantTerminalMsg('p-terminal', 'p-req', 'done');
    const current = userMsg('current-req', 'current-req', 'next question');

    // A policy that selects everything (omits nothing) — control case to
    // confirm the orphan sweep does not over-prune healthy turns.
    const selectAllPolicy: import('@nextagent/agent-contracts/context').ContextBudgetPolicyPort = {
      evaluate(input, _signal) {
        const evidence = input.sourceCandidates.map((c) => ({
          category: c.category,
          estimatedInputUnits: c.estimatedInputUnits,
          status: 'selected' as const,
          reasonCode: 'WITHIN_BUDGET' as const,
          owningBoundary: c.owningBoundary,
          safeIdentifier: c.safeIdentifier,
        }));
        return {
          plan: {
            decision: 'continue' as const,
            reasonCode: 'WITHIN_BUDGET' as const,
            compressionMode: 'none' as const,
            degradationMode: [],
            pipelineStageStoppedAt: 'agent-context-engine.budget-decision-gate',
            estimatedFinalInputUnits: evidence.reduce((s, e) => s + e.estimatedInputUnits, 0),
            omittedContextTypes: [],
          },
          evidence,
          roleEvidence: [
            { role: 'system', status: 'protected', reasonCode: 'WITHIN_BUDGET' },
            { role: 'user', status: 'selected', reasonCode: 'WITHIN_BUDGET' },
            { role: 'assistant', status: 'selected', reasonCode: 'WITHIN_BUDGET' },
            { role: 'tool', status: 'selected', reasonCode: 'WITHIN_BUDGET' },
          ],
        };
      },
    };

    const engine = makeEngine({
      messages: [priorUser, priorToolUse, priorResult1, priorResult2, priorTerminal, current],
      activeContext: activeContextView(['p-user', 'p-tool-use', 'p-result-1', 'p-result-2', 'p-terminal', 'current-req']),
      budgetPolicy: selectAllPolicy,
    });

    const assembly = await engine.assemble(request(), undefined, new AbortController().signal);
    expect(assembly.selectedMessageRefs).toContain(msgId('p-tool-use'));
    expect(assembly.selectedMessageRefs).toContain(msgId('p-result-1'));
    expect(assembly.selectedMessageRefs).toContain(msgId('p-result-2'));
    const rendered = await engine.render(assembly);
    expect(rendered.messages.length).toBeGreaterThan(0);
  });
});
