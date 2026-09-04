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
import type { TraceableSummaryDraft, TraceableSummaryGenerationPort } from '@nextagent/agent-contracts/context';
import { describe, expect, it } from 'vitest';
import { createTestModelSelectionService } from './test-model-selection-helpers.js';

// End-to-end compression test: real budget policy + small context window

const TENANT = brand<string, 'TenantId'>('tenant-e2e');
const SUBJECT = brand<string, 'SubjectId'>('subject-e2e');
const AGENT = brand<string, 'AgentId'>('agent-e2e');
const AGENT_V = brand<string, 'AgentVersion'>('v1');
const SESSION = brand<string, 'SessionId'>('session-e2e');

function msgId(name: string): MessageId {
  return brand<string, 'MessageId'>(name);
}

function makeMessage(role: string, messageId: string, content: string, requestId: string): SessionMessageRecord {
  return {
    tenantId: TENANT,
    subjectId: SUBJECT,
    agentId: AGENT,
    messageId: msgId(messageId),
    sessionId: SESSION,
    requestId: msgId(requestId),
    role: role as SessionMessageRecord['role'],
    content,
    contentType: 'PLAIN_TEXT',
    metadata: {},
    visible: true,
    createdAt: brand<number, 'EpochMillis'>(1),
  };
}

function activeContextView(messageIds: readonly string[], version = 1): ActiveContextViewRecord {
  const state: ActiveContextStateRecord = {
    tenantId: TENANT,
    subjectId: SUBJECT,
    agentId: AGENT,
    sessionId: SESSION,
    activeContextVersion: version,
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
    agentAssemblyRef: 'agent-e2e:v1',
    displayName: 'e2e compression',
    description: 'e2e compression',
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

describe('End-to-end compression with real budget policy', () => {
  it('triggers compression with a small context window and multiple prior turns', async () => {
    // Create 3 complete prior turns with LONG content to exceed the small budget
    const longContent = 'x'.repeat(8000);
    const turn1 = [
      makeMessage('USER', 'u1', 'question about AI history in great detail', 'turn-1'),
      makeMessage('ASSISTANT', 'a1', longContent, 'turn-1'),
    ];
    const turn2 = [
      makeMessage('USER', 'u2', 'question about machine learning applications', 'turn-2'),
      makeMessage('ASSISTANT', 'a2', longContent, 'turn-2'),
    ];
    const turn3 = [
      makeMessage('USER', 'u3', 'question about neural network architectures', 'turn-3'),
      makeMessage('ASSISTANT', 'a3', longContent, 'turn-3'),
    ];
    const current = makeMessage('USER', 'current-req', 'latest question about transformers', 'current-req');

    const allMessages = [...turn1, ...turn2, ...turn3, current];
    const messagesMap = new Map<string, SessionMessageRecord>();
    for (const r of allMessages) {
      messagesMap.set(r.messageId, r);
    }

    const commitCalls: Array<{ summaryMessage: SessionMessageRecord; retainedTail: readonly MessageId[] }> = [];
    const activeContextStore: ActiveContextStoreGateway = {
      async loadActiveContext() {
        return activeContextView(['u1', 'a1', 'u2', 'a2', 'u3', 'a3', 'current-req'], 5);
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
        return req.messageIds.map((id) => messagesMap.get(id)!).filter(Boolean);
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
    const assemblyRegistry: AgentAssemblyRegistry = {
      async active() {
        return makeAssembly();
      },
      async require() {
        return makeAssembly();
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

    const summaryGenerator: TraceableSummaryGenerationPort = {
      async generate(req): Promise<TraceableSummaryDraft> {
        // Verify the generator receives the covered prefix messages
        expect(req.coveredMessages.length).toBeGreaterThan(0);
        expect(req.purpose).toBe('SUMMARY_GENERATION');
        return {
          content: 'E2E summary: discussed AI history, ML applications, and neural networks',
          sourceReferences: [...req.coveredMessageRefs],
          historyLookupLinkage: [...req.retainedTailMessageRefs],
          rehydrationHints: [],
          generationMode: 'normal',
          promptTemplateVersion: 'compact-summary/v1',
          inputUnitEstimate: 500,
          outputUnitEstimate: 50,
        };
      },
    };

    const commitCompaction = async (request: {
      readonly ownerScope: { readonly tenantId: string; readonly subjectId: string };
      readonly agentId: string;
      readonly sessionId: string;
      readonly expectedActiveContextVersion: number;
      readonly summaryMessage: SessionMessageRecord;
      readonly retainedTailMessageIds: readonly MessageId[];
      readonly idempotencyKey: string;
    }): Promise<VersionedUpdateResult<ActiveContextViewRecord>> => {
      commitCalls.push({
        summaryMessage: request.summaryMessage,
        retainedTail: request.retainedTailMessageIds,
      });
      return {
        status: 'UPDATED',
        record: activeContextView(['summary-msg', 'u3', 'a3', 'current-req'], 6),
      };
    };

    // KEY: compression is now triggered by the proactive auto-compact
    // threshold (conversation tokens >= availableInputUnits - 13_000), not
    // by budget omission. Size the window just above the 13_000 headroom so
    // the threshold is low and the real estimator crosses it with long
    // prior-turn content.
    // availableInput = contextWindow - maxOutput = 15_256 - 256 = 15_000
    // threshold = 15_000 - 13_000 = 2_000
    // 3 assistant turns × "x".repeat(8000) = 24_000 chars × 0.25 ≈ 6_000
    // tokens → 6_000 >= 2_000 → compression triggers.
    const engine = new DefaultContextEngine({
      activeContextStore,
      messageStore,
      assemblyRegistry,
      capabilityCatalog,
      modelSelectionService: createTestModelSelectionService({
        contextWindowTokens: 15_256,
        maxOutputTokens: 256,
      }),
      budgetPolicy: new DefaultProportionalBudgetPolicy(),
      tokenEstimator: createDefaultTokenEstimator(),
      summaryGenerator,
      commitCompaction,
      idFactory: (prefix) => `${prefix}-e2e`,
      clock: () => brand<number, 'EpochMillis'>(1),
    });

    const request = {
      sessionId: SESSION,
      requestId: msgId('current-req'),
      requestContextId: brand<string, 'RequestContextId'>('rc-e2e'),
      identityContext: { tenantId: TENANT, subjectId: SUBJECT, displayName: 'e2e' },
      agentId: AGENT,
      agentVersion: AGENT_V,
      runId: brand<string, 'RequestRunId'>('run-e2e'),
      stepId: 'step-e2e',
      locale: brand<string, 'RequestLocale'>('en-US'),
      purpose: 'test-e2e',
    };

    const result = await engine.assemble(request, undefined, new AbortController().signal);

    // US-004 Acceptance Criteria verification:

    // 1. Compression was triggered (proactive threshold crossed)
    expect(result.compressionEvidence).toBeDefined();
    expect(result.compressionEvidence!.strategy).toBe('PREFIX_COMPACT_RECENT_TAIL');

    // 2. commitCompaction was called (SUMMARY message created)
    expect(commitCalls.length).toBe(1);
    const summaryMsg = commitCalls[0]!.summaryMessage;

    // 3. SUMMARY message has correct role and metadata
    expect(summaryMsg.role).toBe('SUMMARY');
    expect(summaryMsg.metadata['kind']).toBe('CONTEXT_COMPRESSION_SUMMARY');
    expect(summaryMsg.metadata['strategy']).toBe('PREFIX_COMPACT_RECENT_TAIL');

    // 4. Summary content is correct
    expect(summaryMsg.content).toContain('E2E summary');

    // 5. Covered messages removed from active context (only retained tail + current remain)
    expect(result.selectedMessageRefs).toContain(msgId('current-req'));
    // The last turn (turn-3) should be in the retained tail
    expect(result.selectedMessageRefs).toContain(msgId('u3'));
    expect(result.selectedMessageRefs).toContain(msgId('a3'));
    // Turn-1 and turn-2 should NOT be in selected refs (covered by summary)
    expect(result.selectedMessageRefs).not.toContain(msgId('u1'));
    expect(result.selectedMessageRefs).not.toContain(msgId('a1'));

    // 6. Compression evidence has correct version tracking
    expect(result.compressionEvidence!.sourceActiveContextVersion).toBe(5);
    expect(result.compressionEvidence!.targetActiveContextVersion).toBe(6);
    expect(result.compressionEvidence!.edgeLabel).toBe('CONTEXT_COMPACTED_EVIDENCE');
    expect(result.compressionEvidence!.coveredMessageRefCount).toBeGreaterThan(0);
    expect(result.compressionEvidence!.retainedTailRefCount).toBeGreaterThan(0);
  });
});
