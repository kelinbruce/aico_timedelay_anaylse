import { createTestModelSelectionService } from './test-model-selection-helpers.js';
import { DefaultContextEngine } from '@nextagent/agent-context-engine';
import { AgentError, brand, type JsonObject, type MessageId } from '@nextagent/agent-common';
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
import { describe, expect, it } from 'vitest';

// =============================================================================
// Fixture helpers
// =============================================================================

const TENANT = brand<string, 'TenantId'>('tenant-history');
const SUBJECT = brand<string, 'SubjectId'>('subject-history');
const AGENT = brand<string, 'AgentId'>('agent-history');
const AGENT_V = brand<string, 'AgentVersion'>('v1');
const SESSION = brand<string, 'SessionId'>('session-history');

function msgId(name: string): MessageId {
  return brand<string, 'MessageId'>(name);
}

function runId(name = 'run-1') {
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
    runId: runId(opts.runId ?? 'run-1'),
    role: opts.role,
    content: opts.content ?? '',
    contentType: 'PLAIN_TEXT',
    metadata: opts.metadata ?? {},
    visible: opts.visible ?? true,
    createdAt: brand<number, 'EpochMillis'>(1),
  };
}

function userMsg(messageId: string, requestId = messageId, content = 'hi'): SessionMessageRecord {
  return record({ messageId, requestId, role: 'USER', content });
}

function assistantTerminalMsg(messageId: string, requestId: string, text = 'ok'): SessionMessageRecord {
  return record({ messageId, requestId, role: 'ASSISTANT', content: JSON.stringify({ text }) });
}

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
      toolCalls: toolCalls.map((tc) => ({
        toolCallId: tc.toolCallId,
        toolName: tc.toolName,
        arguments: {},
      })),
    }),
    metadata: { kind: 'ASSISTANT_TOOL_USE' },
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

function hiddenByVisibilityMsg(messageId: string, requestId: string): SessionMessageRecord {
  return record({ messageId, requestId, role: 'USER', content: 'shh', visible: false });
}

function hiddenWithVisibilityReason(record: SessionMessageRecord, reason: string): SessionMessageRecord {
  return {
    ...record,
    visible: false,
    metadata: {
      ...record.metadata,
      visibility: {
        reason,
        hiddenByContextId: 'rc-retry',
      },
    },
  };
}

function retryReplaced(record: SessionMessageRecord): SessionMessageRecord {
  return hiddenWithVisibilityReason(record, 'RETRY_REPLACED');
}

function withoutRunId(record: SessionMessageRecord): SessionMessageRecord {
  const { runId: _runId, ...recordWithoutRunId } = record;
  return recordWithoutRunId;
}

function replacementUserMsg(messageId: string, requestId: string): SessionMessageRecord {
  return record({
    messageId,
    requestId,
    role: 'USER',
    content: 'shh',
    metadata: {
      replacement: {
        kind: 'INLINE',
        reason: 'frozen',
        contentRef: null,
        originalSize: 3,
        previewSize: 3,
        lineage: { sourceMessageId: null, sourceRunId: null, sourceInvocationId: null, stepId: null },
      },
    },
  });
}

// Input-guard-blocked round: visible=true (conversation returns it for page
// rendering) but modelVisibility.excluded=true (context assembly excludes it).
function modelVisibilityExcludedUserMsg(messageId: string, requestId: string): SessionMessageRecord {
  return record({
    messageId,
    requestId,
    role: 'USER',
    content: 'blocked question',
    visible: true,
    metadata: { guardPhase: 'INPUT_GUARD', modelVisibility: { excluded: true, reason: 'GUARD_BLOCKED' } },
  });
}

function modelVisibilityExcludedRefusalMsg(messageId: string, requestId: string): SessionMessageRecord {
  return record({
    messageId,
    requestId,
    role: 'ASSISTANT',
    content: 'blocked refusal',
    visible: true,
    metadata: {
      guardPhase: 'INPUT_GUARD',
      guardReason: 'INPUT_VIOLATION',
      modelVisibility: { excluded: true, reason: 'GUARD_BLOCKED' },
    },
  });
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

interface EngineOptions {
  readonly messages?: readonly SessionMessageRecord[];
  readonly activeContext?: ActiveContextViewRecord;
  readonly activeContextError?: unknown;
  readonly loadMessageError?: (messageId: string) => unknown;
  readonly maxContextMessages?: number;
  readonly onLoadActiveContextCall?: () => void;
  readonly onListMessagesCall?: () => void;
}

function makeAssembly(maxContextMessages: number): AgentAssembly {
  return {
    agentId: AGENT,
    agentType: brand<string, 'AgentType'>('default'),
    agentVersion: AGENT_V,
    agentAssemblyRef: 'agent-history:v1',
    displayName: 'History test agent',
    description: 'history-selection test agent',
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

function makeEngine(opts: EngineOptions = {}): DefaultContextEngine {
  const messagesMap = new Map<string, SessionMessageRecord>();
  for (const r of opts.messages ?? []) {
    messagesMap.set(r.messageId, r);
  }
  const activeContextStore: ActiveContextStoreGateway = {
    async loadActiveContext() {
      opts.onLoadActiveContextCall?.();
      if (opts.activeContextError !== undefined) {
        throw opts.activeContextError;
      }
      if (opts.activeContext !== undefined) {
        return opts.activeContext;
      }
      // Default empty-session signal: NOT_FOUND-coded AgentError so the engine
      // treats it as an empty active context rather than a hard failure.
      throw new AgentError({
        code: 'NOT_FOUND',
        message: 'no active context for this test session',
        category: 'NOT_FOUND',
        retryable: false,
      });
    },
    async appendItem() {
      throw new Error('history selection MUST NOT call appendItem');
    },
    async commitCompaction() {
      throw new Error('history selection MUST NOT call commitCompaction');
    },
    async updateMetadata() {
      return { status: 'UPDATED' as const };
    },
  };
  const messageStore: SessionMessageStoreGateway = {
    async loadMessage(req) {
      if (opts.loadMessageError) {
        const err = opts.loadMessageError(req.messageId);
        if (err !== undefined) {
          throw err;
        }
      }
      return messagesMap.get(req.messageId);
    },
    async loadMessages(req) {
      const out: SessionMessageRecord[] = [];
      for (const id of req.messageIds) {
        if (opts.loadMessageError) {
          const err = opts.loadMessageError(id);
          if (err !== undefined) {
            throw err;
          }
        }
        const record = messagesMap.get(id);
        if (record !== undefined) {
          out.push(record);
        }
      }
      return out;
    },
    async appendSessionMessage() {
      throw new Error('history selection MUST NOT call appendSessionMessage');
    },
    async listConversationPreview() {
      throw new Error('history selection MUST NOT call listConversationPreview');
    },
    async listMessages() {
      opts.onListMessagesCall?.();
      throw new Error('history selection MUST NOT call listMessages — active context is the only authority');
    },
    async listCurrentRequestMessages() {
      throw new Error('history selection MUST NOT call listCurrentRequestMessages — active context is the only authority');
    },
    async hideMessage() {
      throw new Error('history selection MUST NOT call hideMessage');
    },
    async hideRequestMessages() {
      throw new Error('history selection MUST NOT call hideRequestMessages');
    },
  };
  const assembly = makeAssembly(opts.maxContextMessages ?? 50);
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
    modelSelectionService: createTestModelSelectionService(),
  });
}

function request(currentRequestId = 'current-req') {
  return {
    sessionId: SESSION,
    requestId: msgId(currentRequestId),
    requestContextId: brand<string, 'RequestContextId'>('rc-history'),
    identityContext: { tenantId: TENANT, subjectId: SUBJECT, displayName: 'history tester' },
    agentId: AGENT,
    agentVersion: AGENT_V,
    runId: runId(),
    stepId: 'step-1',
    locale: brand<string, 'RequestLocale'>('en-US'),
    purpose: 'test',
  };
}

// =============================================================================
// Tests — anchored to openspec/specs/context-engine/spec.md scenarios from
// the add-ts-context-history-selection delta (R1 S1–S4, R2 S5, R3 S6–S10,
// R4 S11, R5 S12–S13, R6 S14).
// =============================================================================

describe('DefaultContextEngine — history candidate selection', () => {
  // ---- R1: Context Engine owns model-visible history selection ----
  describe('R1 — Context Engine owns model-visible history selection', () => {
    // S1
    it('does not accept caller-provided history or message refs (contract)', async () => {
      const current = userMsg('current-req');
      const engine = makeEngine({
        messages: [current],
        activeContext: activeContextView(['current-req'], 7),
      });
      // ContextAssemblyRequest in @nextagent/agent-contracts/context has no
      // selectedMessageRefs / messageRefs / historyRefs field at the type
      // level. The only caller-supplied patch surface is capabilityContextPatch
      // (allowedTools / deniedTools / modelId / modelOptions) — none of which
      // can preselect history. Assembly draws its refs strictly from
      // ActiveContextView.
      const result = await engine.assemble(request(), undefined, new AbortController().signal);
      expect(result.selectedMessageRefs).toEqual([msgId('current-req')]);
    });

    // S2
    it('fails explicitly when the current request message cannot be loaded', async () => {
      const engine = makeEngine({
        activeContext: activeContextView(['current-req']),
        loadMessageError: (id) => (id === 'current-req' ? new Error('blob storage down') : undefined),
      });
      await expect(engine.assemble(request(), undefined, new AbortController().signal)).rejects.toMatchObject({
        code: 'CONTEXT_HISTORY_MESSAGE_UNRESOLVABLE',
      });
    });

    // S3
    it('emits prior turn records first then current-request records (chronological order)', async () => {
      const priorUser = userMsg('prior-user', 'prior-req');
      const priorAss = assistantTerminalMsg('prior-ass', 'prior-req');
      const current = userMsg('current-req');
      const engine = makeEngine({
        messages: [priorUser, priorAss, current],
        activeContext: activeContextView(['prior-user', 'prior-ass', 'current-req']),
      });
      const result = await engine.assemble(request(), undefined, new AbortController().signal);
      // Chronological conversation order: prior turn first, current at the end.
      // The "current request comes first" of spec S3 is about RESOLUTION
      // order (current resolved before prior) and BUDGET PRIORITY (prior is
      // trimmed before current), NOT about array position — the model needs
      // chronological order to interpret the conversation correctly.
      expect(result.selectedMessageRefs).toEqual([msgId('prior-user'), msgId('prior-ass'), msgId('current-req')]);
      expect(result.selectedMessageRefs[result.selectedMessageRefs.length - 1]).toBe(msgId('current-req'));
    });

    // S3 — multi-turn scenario (Gap 2 regression guard)
    it('preserves chronological order across multiple prior turns and the current request', async () => {
      const t1User = userMsg('t1-u', 't1-req', '明天天气怎么样');
      const t1Ass = assistantTerminalMsg('t1-a', 't1-req', '明天晴');
      const t2User = userMsg('t2-u', 't2-req', '那后天呢');
      const t2Ass = assistantTerminalMsg('t2-a', 't2-req', '后天阴');
      const current = userMsg('current-req', 'current-req', '那大后天呢');
      const engine = makeEngine({
        messages: [t1User, t1Ass, t2User, t2Ass, current],
        activeContext: activeContextView(['t1-u', 't1-a', 't2-u', 't2-a', 'current-req']),
      });
      const result = await engine.assemble(request(), undefined, new AbortController().signal);
      expect(result.selectedMessageRefs).toEqual([msgId('t1-u'), msgId('t1-a'), msgId('t2-u'), msgId('t2-a'), msgId('current-req')]);
    });

    // S4
    it('returns current-request records as the only candidates when no prior conversation is in active context', async () => {
      const current = userMsg('current-req');
      const engine = makeEngine({
        messages: [current],
        activeContext: activeContextView(['current-req']),
      });
      const result = await engine.assemble(request(), undefined, new AbortController().signal);
      expect(result.selectedMessageRefs).toEqual([msgId('current-req')]);
    });
  });

  // ---- R2: ActiveContextView is the model-visible history authority ----
  describe('R2 — ActiveContextView is the model-visible history authority', () => {
    // S5
    it('does not scan the full session — listMessages / listCurrentRequestMessages are never called', async () => {
      let listCalled = false;
      const priorUser = userMsg('prior-user', 'prior-req');
      const priorAss = assistantTerminalMsg('prior-ass', 'prior-req');
      const current = userMsg('current-req');
      const engine = makeEngine({
        messages: [priorUser, priorAss, current],
        activeContext: activeContextView(['prior-user', 'prior-ass', 'current-req']),
        onListMessagesCall: () => {
          listCalled = true;
        },
      });
      const result = await engine.assemble(request(), undefined, new AbortController().signal);
      // The fake throws if list*Messages is called — a passing assemble proves the
      // selector reads only the snapshot items.
      expect(listCalled).toBe(false);
      expect(result.selectedMessageRefs.length).toBeGreaterThan(0);
    });

    it('never sees messages that exist in the store but are outside the active-context snapshot', async () => {
      const current = userMsg('current-req');
      const orphan = userMsg('orphan', 'orphan-req'); // exists in messageStore but NOT in active context
      const engine = makeEngine({
        messages: [current, orphan],
        activeContext: activeContextView(['current-req']),
      });
      const result = await engine.assemble(request(), undefined, new AbortController().signal);
      expect(result.selectedMessageRefs).toEqual([msgId('current-req')]);
      expect(result.selectedMessageRefs).not.toContain(msgId('orphan'));
    });
  });

  // ---- R3: Prior conversation preserves valid conversation boundaries ----
  describe('R3 — Prior conversation preserves valid conversation boundaries', () => {
    // S6
    it('excludes a prior turn that lacks a terminal assistant response', async () => {
      // Prior turn = USER only (no terminal assistant)
      const priorUser = userMsg('prior-user', 'prior-req');
      const current = userMsg('current-req');
      const engine = makeEngine({
        messages: [priorUser, current],
        activeContext: activeContextView(['prior-user', 'current-req']),
      });
      const result = await engine.assemble(request(), undefined, new AbortController().signal);
      expect(result.selectedMessageRefs).toEqual([msgId('current-req')]);
    });

    // S7 (visibility flag)
    it('excludes a prior turn whose USER message is visible=false', async () => {
      const hiddenUser = hiddenByVisibilityMsg('prior-user', 'prior-req');
      const priorAss = assistantTerminalMsg('prior-ass', 'prior-req');
      const current = userMsg('current-req');
      const engine = makeEngine({
        messages: [hiddenUser, priorAss, current],
        activeContext: activeContextView(['prior-user', 'prior-ass', 'current-req']),
      });
      const result = await engine.assemble(request(), undefined, new AbortController().signal);
      expect(result.selectedMessageRefs).toEqual([msgId('current-req')]);
    });

    // S7 (replacement metadata)
    it('excludes a prior turn whose USER message carries metadata.replacement.kind', async () => {
      const replacedUser = replacementUserMsg('prior-user', 'prior-req');
      const priorAss = assistantTerminalMsg('prior-ass', 'prior-req');
      const current = userMsg('current-req');
      const engine = makeEngine({
        messages: [replacedUser, priorAss, current],
        activeContext: activeContextView(['prior-user', 'prior-ass', 'current-req']),
      });
      const result = await engine.assemble(request(), undefined, new AbortController().signal);
      expect(result.selectedMessageRefs).toEqual([msgId('current-req')]);
    });

    // Input-guard-blocked round: visible=true (page can render it) but
    // modelVisibility.excluded=true keeps it out of the model context.
    it('excludes a prior input-guard-blocked round whose messages carry modelVisibility.excluded despite visible=true', async () => {
      const blockedUser = modelVisibilityExcludedUserMsg('prior-user', 'prior-req');
      const blockedRefusal = modelVisibilityExcludedRefusalMsg('prior-ass', 'prior-req');
      const current = userMsg('current-req');
      const engine = makeEngine({
        messages: [blockedUser, blockedRefusal, current],
        activeContext: activeContextView(['prior-user', 'prior-ass', 'current-req']),
      });
      const result = await engine.assemble(request(), undefined, new AbortController().signal);
      // The blocked round is excluded from model context; only the current request remains.
      expect(result.selectedMessageRefs).toEqual([msgId('current-req')]);
    });

    // S8
    it('retains a complete prior tool turn verbatim (USER → ASSISTANT tool_use → CAPABILITY_RESULT → terminal ASSISTANT)', async () => {
      const priorUser = userMsg('p-user', 'p-req');
      const priorToolUse = assistantToolUseMsg('p-tool-use', 'p-req', [{ toolCallId: 'tc1', toolName: 'Bash' }]);
      const priorResult = capabilityResultMsg('p-result', 'p-req', 'tc1');
      const priorTerminal = assistantTerminalMsg('p-terminal', 'p-req');
      const current = userMsg('current-req');
      const engine = makeEngine({
        messages: [priorUser, priorToolUse, priorResult, priorTerminal, current],
        activeContext: activeContextView(['p-user', 'p-tool-use', 'p-result', 'p-terminal', 'current-req']),
      });
      const result = await engine.assemble(request(), undefined, new AbortController().signal);
      expect(result.selectedMessageRefs).toEqual([
        msgId('p-user'),
        msgId('p-tool-use'),
        msgId('p-result'),
        msgId('p-terminal'),
        msgId('current-req'),
      ]);
    });

    // S9
    it('retains a complete pure-text prior turn (USER → terminal ASSISTANT without tool calls)', async () => {
      const priorUser = userMsg('p-user', 'p-req');
      const priorTerminal = assistantTerminalMsg('p-terminal', 'p-req');
      const current = userMsg('current-req');
      const engine = makeEngine({
        messages: [priorUser, priorTerminal, current],
        activeContext: activeContextView(['p-user', 'p-terminal', 'current-req']),
      });
      const result = await engine.assemble(request(), undefined, new AbortController().signal);
      expect(result.selectedMessageRefs).toEqual([msgId('p-user'), msgId('p-terminal'), msgId('current-req')]);
    });

    it('retains the latest visible pure-text retry attempt', async () => {
      const priorUser = userMsg('p-user', 'p-req', 'original question');
      const replacedTerminal = retryReplaced(assistantTerminalMsg('p-old-terminal', 'p-req', 'old answer'));
      const latestTerminal = {
        ...assistantTerminalMsg('p-latest-terminal', 'p-req', 'latest answer'),
        runId: runId('run-2'),
      };
      const current = userMsg('current-req', 'current-req', 'follow-up');
      const engine = makeEngine({
        messages: [priorUser, replacedTerminal, latestTerminal, current],
        activeContext: activeContextView(['p-user', 'p-old-terminal', 'p-latest-terminal', 'current-req']),
      });

      const result = await engine.assemble(request(), undefined, new AbortController().signal);

      expect(result.selectedMessageRefs).toEqual([msgId('p-user'), msgId('p-latest-terminal'), msgId('current-req')]);
    });

    it('retains only the latest complete tool retry attempt', async () => {
      const priorUser = userMsg('p-user', 'p-req');
      const oldToolUse = {
        ...assistantToolUseMsg('p-old-tool-use', 'p-req', [{ toolCallId: 'tc-old', toolName: 'Bash' }]),
        visible: false,
      };
      const oldResult = retryReplaced(capabilityResultMsg('p-old-result', 'p-req', 'tc-old'));
      const oldTerminal = retryReplaced(assistantTerminalMsg('p-old-terminal', 'p-req'));
      const latestToolUse = {
        ...assistantToolUseMsg('p-latest-tool-use', 'p-req', [{ toolCallId: 'tc-latest', toolName: 'Bash' }]),
        runId: runId('run-2'),
        visible: false,
      };
      const latestResult = {
        ...capabilityResultMsg('p-latest-result', 'p-req', 'tc-latest'),
        runId: runId('run-2'),
      };
      const latestTerminal = {
        ...assistantTerminalMsg('p-latest-terminal', 'p-req'),
        runId: runId('run-2'),
      };
      const current = userMsg('current-req');
      const messages = [priorUser, oldToolUse, oldResult, oldTerminal, latestToolUse, latestResult, latestTerminal, current];
      const engine = makeEngine({
        messages,
        activeContext: activeContextView(messages.map((message) => message.messageId)),
      });

      const result = await engine.assemble(request(), undefined, new AbortController().signal);

      expect(result.selectedMessageRefs).toEqual([
        msgId('p-user'),
        msgId('p-latest-tool-use'),
        msgId('p-latest-result'),
        msgId('p-latest-terminal'),
        msgId('current-req'),
      ]);
    });

    it('excludes every replaced output across consecutive retry attempts', async () => {
      const priorUser = userMsg('p-user', 'p-req');
      const firstToolUse = {
        ...assistantToolUseMsg('p-first-tool-use', 'p-req', [{ toolCallId: 'tc-first', toolName: 'Bash' }]),
        visible: false,
      };
      const firstResult = retryReplaced(capabilityResultMsg('p-first-result', 'p-req', 'tc-first'));
      const firstTerminal = retryReplaced(assistantTerminalMsg('p-first-terminal', 'p-req', 'first answer'));
      const secondToolUse = {
        ...assistantToolUseMsg('p-second-tool-use', 'p-req', [{ toolCallId: 'tc-second', toolName: 'Bash' }]),
        runId: runId('run-2'),
        visible: false,
      };
      const secondResult = retryReplaced({
        ...capabilityResultMsg('p-second-result', 'p-req', 'tc-second'),
        runId: runId('run-2'),
      });
      const secondTerminal = retryReplaced({
        ...assistantTerminalMsg('p-second-terminal', 'p-req', 'second answer'),
        runId: runId('run-2'),
      });
      const latestToolUse = {
        ...assistantToolUseMsg('p-latest-tool-use', 'p-req', [{ toolCallId: 'tc-latest', toolName: 'Bash' }]),
        runId: runId('run-3'),
        visible: false,
      };
      const latestResult = {
        ...capabilityResultMsg('p-latest-result', 'p-req', 'tc-latest'),
        runId: runId('run-3'),
      };
      const latestTerminal = {
        ...assistantTerminalMsg('p-latest-terminal', 'p-req', 'latest answer'),
        runId: runId('run-3'),
      };
      const current = userMsg('current-req');
      const messages = [
        priorUser,
        firstToolUse,
        firstResult,
        firstTerminal,
        secondToolUse,
        secondResult,
        secondTerminal,
        latestToolUse,
        latestResult,
        latestTerminal,
        current,
      ];
      const engine = makeEngine({
        messages,
        activeContext: activeContextView(messages.map((message) => message.messageId)),
      });

      const result = await engine.assemble(request(), undefined, new AbortController().signal);

      expect(result.selectedMessageRefs).toEqual([
        msgId('p-user'),
        msgId('p-latest-tool-use'),
        msgId('p-latest-result'),
        msgId('p-latest-terminal'),
        msgId('current-req'),
      ]);
    });

    it('does not expand a retry marker that lacks a run id', async () => {
      const priorUser = userMsg('p-user', 'p-req');
      const unscopedMarker = withoutRunId(retryReplaced(assistantTerminalMsg('p-old-terminal', 'p-req')));
      const unscopedLatestTerminal = withoutRunId(assistantTerminalMsg('p-latest-terminal', 'p-req', 'latest answer'));
      const current = userMsg('current-req');
      const messages = [priorUser, unscopedMarker, unscopedLatestTerminal, current];
      const engine = makeEngine({
        messages,
        activeContext: activeContextView(messages.map((message) => message.messageId)),
      });

      const result = await engine.assemble(request(), undefined, new AbortController().signal);

      expect(result.selectedMessageRefs).toEqual([msgId('p-user'), msgId('p-latest-terminal'), msgId('current-req')]);
    });

    it('does not infer a replaced run without a retry marker', async () => {
      const priorUser = userMsg('p-user', 'p-req');
      const oldToolUse = {
        ...assistantToolUseMsg('p-old-tool-use', 'p-req', [{ toolCallId: 'tc-old', toolName: 'Bash' }]),
        visible: false,
      };
      const hiddenOldResult = {
        ...capabilityResultMsg('p-old-result', 'p-req', 'tc-old'),
        visible: false,
      };
      const latestTerminal = {
        ...assistantTerminalMsg('p-latest-terminal', 'p-req', 'latest answer'),
        runId: runId('run-2'),
      };
      const current = userMsg('current-req');
      const messages = [priorUser, oldToolUse, hiddenOldResult, latestTerminal, current];
      const engine = makeEngine({
        messages,
        activeContext: activeContextView(messages.map((message) => message.messageId)),
      });

      const result = await engine.assemble(request(), undefined, new AbortController().signal);

      expect(result.selectedMessageRefs).toEqual([msgId('current-req')]);
    });

    it('fails closed when the latest retry attempt lacks a capability result', async () => {
      const priorUser = userMsg('p-user', 'p-req');
      const oldTerminal = retryReplaced(assistantTerminalMsg('p-old-terminal', 'p-req'));
      const latestToolUse = assistantToolUseMsg('p-latest-tool-use', 'p-req', [{ toolCallId: 'tc-latest', toolName: 'Bash' }]);
      const latestTerminal = assistantTerminalMsg('p-latest-terminal', 'p-req');
      const current = userMsg('current-req');
      const messages = [priorUser, oldTerminal, latestToolUse, latestTerminal, current];
      const engine = makeEngine({
        messages,
        activeContext: activeContextView(messages.map((message) => message.messageId)),
      });

      const result = await engine.assemble(request(), undefined, new AbortController().signal);

      expect(result.selectedMessageRefs).toEqual([msgId('current-req')]);
    });

    it('fails closed when the latest retry attempt lacks a terminal assistant response', async () => {
      const priorUser = userMsg('p-user', 'p-req');
      const oldTerminal = retryReplaced(assistantTerminalMsg('p-old-terminal', 'p-req'));
      const latestToolUse = assistantToolUseMsg('p-latest-tool-use', 'p-req', [{ toolCallId: 'tc-latest', toolName: 'Bash' }]);
      const latestResult = capabilityResultMsg('p-latest-result', 'p-req', 'tc-latest');
      const current = userMsg('current-req');
      const messages = [priorUser, oldTerminal, latestToolUse, latestResult, current];
      const engine = makeEngine({
        messages,
        activeContext: activeContextView(messages.map((message) => message.messageId)),
      });

      const result = await engine.assemble(request(), undefined, new AbortController().signal);

      expect(result.selectedMessageRefs).toEqual([msgId('current-req')]);
    });

    it('fails closed for a hidden non-retry replacement reason', async () => {
      const priorUser = userMsg('p-user', 'p-req');
      const editedTerminal = hiddenWithVisibilityReason(assistantTerminalMsg('p-edited-terminal', 'p-req'), 'EDIT_REPLACED');
      const latestTerminal = assistantTerminalMsg('p-latest-terminal', 'p-req');
      const current = userMsg('current-req');
      const messages = [priorUser, editedTerminal, latestTerminal, current];
      const engine = makeEngine({
        messages,
        activeContext: activeContextView(messages.map((message) => message.messageId)),
      });

      const result = await engine.assemble(request(), undefined, new AbortController().signal);

      expect(result.selectedMessageRefs).toEqual([msgId('current-req')]);
    });

    it('preserves an in-flight tool use without a visibility reason when its protocol is complete', async () => {
      const priorUser = userMsg('p-user', 'p-req');
      const toolUse = {
        ...assistantToolUseMsg('p-tool-use', 'p-req', [{ toolCallId: 'tc1', toolName: 'Bash' }]),
        visible: false,
      };
      const resultMessage = capabilityResultMsg('p-result', 'p-req', 'tc1');
      const terminal = assistantTerminalMsg('p-terminal', 'p-req');
      const current = userMsg('current-req');
      const messages = [priorUser, toolUse, resultMessage, terminal, current];
      const engine = makeEngine({
        messages,
        activeContext: activeContextView(messages.map((message) => message.messageId)),
      });

      const result = await engine.assemble(request(), undefined, new AbortController().signal);

      expect(result.selectedMessageRefs).toEqual(messages.map((message) => message.messageId));
    });

    // S10 — pending: tool_use without matching capability_result
    it('excludes a prior turn whose tool_use lacks a matching capability_result', async () => {
      const priorUser = userMsg('p-user', 'p-req');
      const priorToolUse = assistantToolUseMsg('p-tool-use', 'p-req', [{ toolCallId: 'tc1', toolName: 'Bash' }]);
      // No CAPABILITY_RESULT for tc1
      const priorTerminal = assistantTerminalMsg('p-terminal', 'p-req');
      const current = userMsg('current-req');
      const engine = makeEngine({
        messages: [priorUser, priorToolUse, priorTerminal, current],
        activeContext: activeContextView(['p-user', 'p-tool-use', 'p-terminal', 'current-req']),
      });
      const result = await engine.assemble(request(), undefined, new AbortController().signal);
      expect(result.selectedMessageRefs).toEqual([msgId('current-req')]);
    });

    // S10 — orphan: tool_use trailing without terminal at all
    it('excludes a prior turn that ends with an unmatched tool_use (no terminal assistant)', async () => {
      const priorUser = userMsg('p-user', 'p-req');
      const priorToolUse = assistantToolUseMsg('p-tool-use', 'p-req', [{ toolCallId: 'tc1', toolName: 'Bash' }]);
      const current = userMsg('current-req');
      const engine = makeEngine({
        messages: [priorUser, priorToolUse, current],
        activeContext: activeContextView(['p-user', 'p-tool-use', 'current-req']),
      });
      const result = await engine.assemble(request(), undefined, new AbortController().signal);
      expect(result.selectedMessageRefs).toEqual([msgId('current-req')]);
    });

    // Bonus protocol test: capability_result whose toolCallId doesn't match — orphan result
    it('excludes a prior turn whose capability_result toolCallId does not match a prior tool_use', async () => {
      const priorUser = userMsg('p-user', 'p-req');
      const priorToolUse = assistantToolUseMsg('p-tool-use', 'p-req', [{ toolCallId: 'tc1', toolName: 'Bash' }]);
      // Result claims to be for tc999, not tc1 → mismatch
      const priorResult = capabilityResultMsg('p-result', 'p-req', 'tc999');
      const priorTerminal = assistantTerminalMsg('p-terminal', 'p-req');
      const current = userMsg('current-req');
      const engine = makeEngine({
        messages: [priorUser, priorToolUse, priorResult, priorTerminal, current],
        activeContext: activeContextView(['p-user', 'p-tool-use', 'p-result', 'p-terminal', 'current-req']),
      });
      const result = await engine.assemble(request(), undefined, new AbortController().signal);
      expect(result.selectedMessageRefs).toEqual([msgId('current-req')]);
    });
  });

  // ---- R4: candidate selection vs final selection ----
  describe('R4 — History candidate selection is separate from final context selection', () => {
    // S11
    it('retains every valid prior turn as a candidate (high maxContextMessages keeps all)', async () => {
      const messages: SessionMessageRecord[] = [];
      const ids: string[] = [];
      // 5 complete pure-text prior turns × 2 messages each + current = 11 refs.
      for (let i = 1; i <= 5; i += 1) {
        const u = `p${i}-u`;
        const a = `p${i}-a`;
        messages.push(userMsg(u, `p${i}-req`));
        messages.push(assistantTerminalMsg(a, `p${i}-req`));
        ids.push(u, a);
      }
      messages.push(userMsg('current-req'));
      ids.push('current-req');
      const engine = makeEngine({
        messages,
        activeContext: activeContextView(ids),
        maxContextMessages: 100,
      });
      const result = await engine.assemble(request(), undefined, new AbortController().signal);
      expect(result.selectedMessageRefs.length).toBe(11);
      // Current request is the LAST ref (chronological order), prior turns at the front.
      expect(result.selectedMessageRefs[result.selectedMessageRefs.length - 1]).toBe(msgId('current-req'));
      expect(result.selectedMessageRefs[0]).toBe(msgId('p1-u'));
    });
  });

  // ---- R5: single-snapshot anchor ----
  describe('R5 — Selected refs carry an active-context version anchor', () => {
    // S12 + S13 — refs come from one snapshot read; anchor is observable
    it('calls loadActiveContext exactly once per assemble and draws all refs from that snapshot', async () => {
      let loadCount = 0;
      const current = userMsg('current-req');
      const priorUser = userMsg('p-user', 'p-req');
      const priorAss = assistantTerminalMsg('p-ass', 'p-req');
      const snapshot = activeContextView(['p-user', 'p-ass', 'current-req'], 42);
      const engine = makeEngine({
        messages: [current, priorUser, priorAss],
        activeContext: snapshot,
        onLoadActiveContextCall: () => {
          loadCount += 1;
        },
      });
      const result = await engine.assemble(request(), undefined, new AbortController().signal);
      expect(loadCount).toBe(1);
      expect(result.selectedMessageRefs).toEqual([msgId('p-user'), msgId('p-ass'), msgId('current-req')]);
    });
  });

  // ---- R6: explicit failure on unresolvable refs ----
  describe('R6 — Unresolvable active context references fail explicitly', () => {
    // S14 a — loadActiveContext infrastructure failure (non-NOT_FOUND)
    it('throws CONTEXT_ACTIVE_VIEW_UNRESOLVABLE when loadActiveContext fails with a non-NOT_FOUND error', async () => {
      const engine = makeEngine({
        activeContextError: new Error('infrastructure down'),
      });
      await expect(engine.assemble(request(), undefined, new AbortController().signal)).rejects.toMatchObject({
        code: 'CONTEXT_ACTIVE_VIEW_UNRESOLVABLE',
      });
    });

    // S14 a — sibling: NOT_FOUND must be treated as legitimate empty
    it('treats a NOT_FOUND-coded loadActiveContext failure as an empty active context (no assembly failure)', async () => {
      const engine = makeEngine({
        activeContextError: new AgentError({
          code: 'NOT_FOUND',
          message: 'no active context',
          category: 'NOT_FOUND',
          retryable: false,
        }),
      });
      const result = await engine.assemble(request(), undefined, new AbortController().signal);
      // Empty active context → empty selection; the request still produces a valid ContextAssembly.
      expect(result.selectedMessageRefs).toEqual([]);
    });

    // S14 b — message ref unresolvable: returns undefined from store
    it('throws CONTEXT_HISTORY_MESSAGE_UNRESOLVABLE when an active-context ref resolves to undefined in the store', async () => {
      const current = userMsg('current-req');
      const engine = makeEngine({
        messages: [current], // "p-missing" intentionally absent
        activeContext: activeContextView(['p-missing', 'current-req']),
      });
      await expect(engine.assemble(request(), undefined, new AbortController().signal)).rejects.toMatchObject({
        code: 'CONTEXT_HISTORY_MESSAGE_UNRESOLVABLE',
      });
    });

    // S14 b — message ref unresolvable: store throws
    it('throws CONTEXT_HISTORY_MESSAGE_UNRESOLVABLE when loadMessage throws for any active-context ref', async () => {
      const current = userMsg('current-req');
      const engine = makeEngine({
        messages: [current],
        activeContext: activeContextView(['p-bad', 'current-req']),
        loadMessageError: (id) => (id === 'p-bad' ? new Error('transient db error') : undefined),
      });
      await expect(engine.assemble(request(), undefined, new AbortController().signal)).rejects.toMatchObject({
        code: 'CONTEXT_HISTORY_MESSAGE_UNRESOLVABLE',
      });
    });

    // Gap 3 — active context non-empty but the current request id is not present
    it('throws CONTEXT_CURRENT_REQUEST_UNRESOLVABLE when active context has items but the current request id is missing', async () => {
      // Active context contains a complete prior turn but the runtime has
      // not appended the current request id yet. Per spec "Current request
      // cannot be silently dropped", assembly must fail explicitly rather
      // than returning a degraded current-request-less result.
      const priorUser = userMsg('p-user', 'p-req');
      const priorTerminal = assistantTerminalMsg('p-terminal', 'p-req');
      const engine = makeEngine({
        messages: [priorUser, priorTerminal],
        activeContext: activeContextView(['p-user', 'p-terminal']),
      });
      await expect(engine.assemble(request(), undefined, new AbortController().signal)).rejects.toMatchObject({
        code: 'CONTEXT_CURRENT_REQUEST_UNRESOLVABLE',
      });
    });
  });

  // ---- Render-stage "no silent skip" (spec R5 successor) ----
  describe('Render — selected refs without silent omission', () => {
    // After the R5 spec was simplified (per-ref activeContextVersion anchor
    // dropped as over-engineering), the surviving render-side rule is: if
    // a selected ref's message cannot be loaded or is no longer model-
    // visible at render time, render MUST throw rather than silently skip.
    // These two tests guard that rule.

    it("throws CONTEXT_RENDER_MESSAGE_UNRESOLVABLE when a selected ref's message has been deleted from the store between assemble and render", async () => {
      // Set up a stateful messageStore that returns the current request
      // during assemble, then returns undefined (simulating concurrent
      // delete or store eviction) when render asks for the same ref again.
      const current = userMsg('current-req');
      let loadCallCount = 0;
      const engine = new DefaultContextEngine({
        activeContextStore: {
          async loadActiveContext() {
            return activeContextView(['current-req']);
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
            loadCallCount += 1;
            // First load (during selectHistoryCandidates) returns the
            // record; subsequent load (during render) returns undefined
            // to simulate "message gone between assemble and render".
            if (req.messageId === 'current-req' && loadCallCount > 1) {
              return undefined;
            }
            if (req.messageId === 'current-req') {
              return current;
            }
            return undefined;
          },
          async loadMessages(req) {
            // Both assemble and render now resolve refs via a single batch
            // `loadMessages` call. Mirror the prior per-ref "message gone
            // between assemble and render" simulation: the first batch call
            // (assemble) returns the current request record; subsequent batch
            // calls (render) return an empty page so the engine throws
            // CONTEXT_RENDER_MESSAGE_UNRESOLVABLE.
            loadCallCount += 1;
            if (loadCallCount > 1) {
              return [];
            }
            return req.messageIds.flatMap((id) => (id === 'current-req' ? [current] : []));
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
        assemblyRegistry: {
          async active() {
            return makeAssembly(50);
          },
          async require() {
            return makeAssembly(50);
          },
        },
        capabilityCatalog: {
          async listAvailable() {
            return [];
          },
          async resolve() {
            return undefined;
          },
        },
        modelSelectionService: createTestModelSelectionService({ modelId: 'test-model', contextWindowTokens: 128_000 }),
      });
      const assembly = await engine.assemble(request(), undefined, new AbortController().signal);
      // assemble succeeded; render now resolves the same ref but store
      // returns undefined → must throw explicitly, not produce an empty
      // user message.
      await expect(engine.render(assembly)).rejects.toMatchObject({
        code: 'CONTEXT_RENDER_MESSAGE_UNRESOLVABLE',
      });
    });

    it("throws CONTEXT_RENDER_MESSAGE_UNRESOLVABLE when a selected ref's message is not model-visible at render time", async () => {
      // Set up a stateful messageStore that returns a visible record
      // during selectHistoryCandidates (so the record passes selection's
      // isProtocolRequiredForCurrentRequest filter), then returns an
      // invisible variant of the same record at render time (simulating
      // a hideMessage call landing between assemble and render).
      const currentVisible = userMsg('current-req');
      const currentHidden: SessionMessageRecord = { ...currentVisible, visible: false };
      let loadCallCount = 0;
      const engine = new DefaultContextEngine({
        activeContextStore: {
          async loadActiveContext() {
            return activeContextView(['current-req']);
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
            loadCallCount += 1;
            if (req.messageId === 'current-req') {
              return loadCallCount > 1 ? currentHidden : currentVisible;
            }
            return undefined;
          },
          async loadMessages(req) {
            // The new render path uses a single batch `loadMessages`
            // call. Returning the hidden variant of the current
            // request mirrors the "hidden between assemble and
            // render" simulation, so the engine throws
            // CONTEXT_RENDER_MESSAGE_UNRESOLVABLE.
            return req.messageIds
              .map((id) => (id === 'current-req' ? currentHidden : undefined))
              .filter((record): record is SessionMessageRecord => record !== undefined);
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
        assemblyRegistry: {
          async active() {
            return makeAssembly(50);
          },
          async require() {
            return makeAssembly(50);
          },
        },
        capabilityCatalog: {
          async listAvailable() {
            return [];
          },
          async resolve() {
            return undefined;
          },
        },
        modelSelectionService: createTestModelSelectionService({ modelId: 'test-model', contextWindowTokens: 128_000 }),
      });
      const assembly = await engine.assemble(request(), undefined, new AbortController().signal);
      await expect(engine.render(assembly)).rejects.toMatchObject({
        code: 'CONTEXT_RENDER_MESSAGE_UNRESOLVABLE',
      });
    });
  });

  describe('Render — cumulative historical RAG micro-compact', () => {
    function threeRoundHistory(): readonly SessionMessageRecord[] {
      return [
        userMsg('user-1', 'req-1'),
        assistantToolUseMsg('tool-use-1', 'req-1', [{ toolCallId: 'rag-call-1', toolName: 'Rag' }]),
        capabilityResultMsg('rag-result-1', 'req-1', 'rag-call-1', 'Rag'),
        assistantTerminalMsg('assistant-1', 'req-1'),
        userMsg('user-2', 'req-2'),
        assistantToolUseMsg('tool-use-2', 'req-2', [{ toolCallId: 'rag-call-2', toolName: 'Rag' }]),
        capabilityResultMsg('rag-result-2', 'req-2', 'rag-call-2', 'Rag'),
        assistantTerminalMsg('assistant-2', 'req-2'),
        userMsg('current-req', 'current-req'),
        assistantToolUseMsg('current-tool-use', 'current-req', [{ toolCallId: 'rag-call-current', toolName: 'Rag' }]),
        capabilityResultMsg('current-rag-result', 'current-req', 'rag-call-current', 'Rag'),
      ];
    }

    it('recomputes every earlier Rag replacement on round three without persisted state', async () => {
      const firstLoad = threeRoundHistory();
      const active = activeContextView(firstLoad.map((message) => message.messageId));
      const assembly = await makeEngine({ messages: firstLoad, activeContext: active }).assemble(request(), undefined, new AbortController().signal);

      const rendered = await makeEngine({ messages: threeRoundHistory(), activeContext: active }).render(assembly);
      const ragOutputs = rendered.messages
        .flatMap((message) => message.content)
        .flatMap((part) => (part.type === 'tool-result' && part.toolName === 'Rag' ? [part.output] : []));

      expect(ragOutputs).toEqual([
        { compacted: expect.stringContaining('compacted-rag-result') },
        { compacted: expect.stringContaining('compacted-rag-result') },
        { ok: true },
      ]);
    });
  });

  // ---- loadMessages chunking guard (GET URL overflow defense) ----
  // The remote loadMessages implementation encodes ids as GET query
  // parameters; a long multi-turn session accumulates more refs than a
  // single URL can carry before Step 3 summary compression shrinks the set,
  // so loadOwnerMessages chunks the id list into bounded slices. These
  // tests lock that behavior: every request stays under the chunk size, the
  // full ref set is still resolved, and a thrown chunk still surfaces as
  // CONTEXT_HISTORY_MESSAGE_UNRESOLVABLE.
  describe('loadMessages chunking', () => {
    const CHUNK_SIZE = 50;

    function makeChunkingEngine(opts: {
      readonly messages: readonly SessionMessageRecord[];
      readonly activeContext: ActiveContextViewRecord;
      readonly loadMessagesErrorOnChunk?: (chunkIndex: number) => unknown;
    }): { readonly engine: DefaultContextEngine; readonly loadMessagesCalls: MessageId[][] } {
      const messagesMap = new Map<string, SessionMessageRecord>();
      for (const r of opts.messages) {
        messagesMap.set(r.messageId, r);
      }
      const loadMessagesCalls: MessageId[][] = [];
      let chunkIndex = 0;
      const messageStore: SessionMessageStoreGateway = {
        async loadMessage(req) {
          return messagesMap.get(req.messageId);
        },
        async loadMessages(req) {
          const index = chunkIndex++;
          loadMessagesCalls.push([...req.messageIds]);
          if (opts.loadMessagesErrorOnChunk?.(index) !== undefined) {
            throw opts.loadMessagesErrorOnChunk(index);
          }
          return req.messageIds.flatMap((id) => {
            const record = messagesMap.get(id);
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
      };
      const engine = new DefaultContextEngine({
        activeContextStore: {
          async loadActiveContext() {
            return opts.activeContext;
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
        messageStore,
        assemblyRegistry: {
          async active() {
            return makeAssembly(100);
          },
          async require() {
            return makeAssembly(100);
          },
        },
        capabilityCatalog: {
          async listAvailable() {
            return [];
          },
          async resolve() {
            return undefined;
          },
        },
        modelSelectionService: createTestModelSelectionService({ modelId: 'test-model', contextWindowTokens: 128_000 }),
      });
      return { engine, loadMessagesCalls };
    }

    it('issues a single loadMessages call when ref count is below the chunk size', async () => {
      // 20 turns × 2 messages = 40 refs, below the 50-id chunk size → one chunk.
      const records: SessionMessageRecord[] = [];
      for (let i = 0; i < 20; i++) {
        records.push(userMsg(`u-${i}`, `r-${i}`));
        records.push(assistantTerminalMsg(`a-${i}`, `r-${i}`));
      }
      const ids = records.map((r) => r.messageId as string);
      const { engine, loadMessagesCalls } = makeChunkingEngine({
        messages: records,
        activeContext: activeContextView(ids),
      });
      const result = await engine.assemble(request('u-0'), undefined, new AbortController().signal);
      // Single batch call, no chunking.
      expect(loadMessagesCalls).toHaveLength(1);
      expect(loadMessagesCalls[0]).toHaveLength(ids.length);
      // All refs resolved (current request u-0 plus 19 prior turns).
      expect(result.selectedMessageRefs.length).toBeGreaterThan(0);
    });

    it('issues a single loadMessages call when ref count equals the chunk size', async () => {
      // Exactly 50 refs == chunk size boundary → still one chunk (no split).
      const records: SessionMessageRecord[] = [];
      for (let i = 0; i < 25; i++) {
        records.push(userMsg(`u-${i}`, `r-${i}`));
        records.push(assistantTerminalMsg(`a-${i}`, `r-${i}`));
      }
      const ids = records.map((r) => r.messageId as string);
      const { engine, loadMessagesCalls } = makeChunkingEngine({
        messages: records,
        activeContext: activeContextView(ids),
      });
      await engine.assemble(request('u-0'), undefined, new AbortController().signal);
      expect(loadMessagesCalls).toHaveLength(1);
      expect(loadMessagesCalls[0]).toHaveLength(CHUNK_SIZE);
    });

    it('chunks the id list into bounded slices when refs exceed the chunk size', async () => {
      // 120 refs → ceil(120/50) = 3 chunks.
      const records: SessionMessageRecord[] = [];
      for (let i = 0; i < 60; i++) {
        records.push(userMsg(`u-${i}`, `r-${i}`));
        records.push(assistantTerminalMsg(`a-${i}`, `r-${i}`));
      }
      const ids = records.map((r) => r.messageId as string);
      const { engine, loadMessagesCalls } = makeChunkingEngine({
        messages: records,
        activeContext: activeContextView(ids),
      });
      await engine.assemble(request('u-0'), undefined, new AbortController().signal);
      // 120 ids split into 3 chunks of 50 + 50 + 20.
      expect(loadMessagesCalls).toHaveLength(3);
      expect(loadMessagesCalls[0]).toHaveLength(50);
      expect(loadMessagesCalls[1]).toHaveLength(50);
      expect(loadMessagesCalls[2]).toHaveLength(20);
      // No chunk may exceed the bound.
      for (const call of loadMessagesCalls) {
        expect(call.length).toBeLessThanOrEqual(CHUNK_SIZE);
      }
      // Every input id appears in exactly one chunk (no drops, no dups).
      const flat = loadMessagesCalls.flat();
      expect(flat).toHaveLength(120);
      expect(new Set(flat).size).toBe(120);
    });

    it('wraps a thrown chunk as CONTEXT_HISTORY_MESSAGE_UNRESOLVABLE and preserves the cause', async () => {
      const records: SessionMessageRecord[] = [];
      for (let i = 0; i < 60; i++) {
        records.push(userMsg(`u-${i}`, `r-${i}`));
        records.push(assistantTerminalMsg(`a-${i}`, `r-${i}`));
      }
      const ids = records.map((r) => r.messageId as string);
      const { engine } = makeChunkingEngine({
        messages: records,
        activeContext: activeContextView(ids),
        loadMessagesErrorOnChunk: () => new Error('remote 400 / url too long'),
      });
      await expect(engine.assemble(request('u-0'), undefined, new AbortController().signal)).rejects.toMatchObject({
        code: 'CONTEXT_HISTORY_MESSAGE_UNRESOLVABLE',
      });
    });

    it('chunks render-time loadMessages and wraps a failed chunk as CONTEXT_RENDER_MESSAGE_UNRESOLVABLE', async () => {
      // render() resolves selectedMessageRefs via the same GET-bounded
      // loadMessages path as assemble; a long multi-turn session accumulates
      // more refs than one URL can carry, so render must chunk too. A failed
      // render chunk surfaces as CONTEXT_RENDER_MESSAGE_UNRESOLVABLE (the
      // render-stage code), distinct from the history-stage code.
      const records: SessionMessageRecord[] = [];
      for (let i = 0; i < 60; i++) {
        records.push(userMsg(`u-${i}`, `r-${i}`));
        records.push(assistantTerminalMsg(`a-${i}`, `r-${i}`));
      }
      const ids = records.map((r) => r.messageId as string);
      // assemble issues 3 chunks (indices 0,1,2) and succeeds; render then
      // issues 3 more chunks (indices 3,4,5). Fail the first render chunk
      // (index 3) to verify the render-stage error code.
      const { engine } = makeChunkingEngine({
        messages: records,
        activeContext: activeContextView(ids),
        loadMessagesErrorOnChunk: (index) => (index === 3 ? new Error('render-time remote 400 / url too long') : undefined),
      });
      const assembly = await engine.assemble(request('u-0'), undefined, new AbortController().signal);
      await expect(engine.render(assembly)).rejects.toMatchObject({
        code: 'CONTEXT_RENDER_MESSAGE_UNRESOLVABLE',
      });
    });
  });
});
