import { createTestModelSelectionService } from './test-model-selection-helpers.js';
import { DefaultContextEngine } from '@nextagent/agent-context-engine';
import { brand, type JsonObject, type MessageId } from '@nextagent/agent-common';
import type { AgentAssembly, AgentAssemblyRegistry } from '@nextagent/agent-contracts/agent-assembly';
import type { CapabilityCatalog } from '@nextagent/agent-contracts/capability';
import type { ContextAssemblyRequest } from '@nextagent/agent-contracts/context';
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
// Regression: a directed-Skill body persisted as a page-hidden
// USER(SKILL_CONTENT) message must stay in model context in place across a
// later round (history-selection gates must not drop it), and must NOT drift to
// the last position. See plans/composed-greeting-scroll.md.
// =============================================================================

const TENANT = brand<string, 'TenantId'>('tenant-skill-content');
const SUBJECT = brand<string, 'SubjectId'>('subject-skill-content');
const AGENT = brand<string, 'AgentId'>('agent-skill-content');
const AGENT_V = brand<string, 'AgentVersion'>('v1');
const SESSION = brand<string, 'SessionId'>('session-skill-content');

function msgId(name: string): MessageId {
  return brand<string, 'MessageId'>(name);
}
function runId(name: string) {
  return brand<string, 'RequestRunId'>(name);
}

interface RecordOptions {
  readonly messageId: string;
  readonly requestId: string;
  readonly role: 'USER' | 'ASSISTANT' | 'CAPABILITY_RESULT' | 'SUMMARY';
  readonly runId?: string;
  readonly content: string;
  readonly metadata?: JsonObject;
  readonly visible?: boolean;
  readonly createdAt?: number;
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
    content: opts.content,
    contentType: 'PLAIN_TEXT',
    metadata: opts.metadata ?? {},
    visible: opts.visible ?? true,
    createdAt: brand<number, 'EpochMillis'>(opts.createdAt ?? 1),
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
    agentAssemblyRef: 'agent-skill-content:v1',
    displayName: 'Skill-content regression agent',
    description: 'skill-content regression agent',
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
}

function makeEngine(messages: readonly SessionMessageRecord[], activeContext: ActiveContextViewRecord): DefaultContextEngine {
  const messagesMap = new Map<string, SessionMessageRecord>();
  for (const r of messages) {
    messagesMap.set(r.messageId, r);
  }
  const messageStore: SessionMessageStoreGateway = {
    async loadMessage(req) {
      return messagesMap.get(req.messageId);
    },
    async loadMessages(req) {
      const out: SessionMessageRecord[] = [];
      for (const id of req.messageIds) {
        const rec = messagesMap.get(id);
        if (rec !== undefined) {
          out.push(rec);
        }
      }
      return out;
    },
    async appendSessionMessage() {
      throw new Error('not used');
    },
    async listConversationPreview() {
      throw new Error('not used');
    },
    async listMessages() {
      throw new Error('not used');
    },
    async listCurrentRequestMessages() {
      throw new Error('not used');
    },
    async hideMessage() {
      throw new Error('not used');
    },
    async hideRequestMessages() {
      throw new Error('not used');
    },
  };
  const activeContextStore: ActiveContextStoreGateway = {
    async loadActiveContext() {
      return activeContext;
    },
    async appendItem() {
      throw new Error('not used');
    },
    async commitCompaction() {
      throw new Error('not used');
    },
    async updateMetadata() {
      return { status: 'UPDATED' as const };
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
    modelSelectionService: createTestModelSelectionService(),
  });
}

function request(currentRequestId: string): ContextAssemblyRequest {
  return {
    sessionId: SESSION,
    requestId: msgId(currentRequestId),
    requestContextId: brand<string, 'RequestContextId'>('rc-skill-content'),
    identityContext: { tenantId: TENANT, subjectId: SUBJECT, displayName: 'skill-content tester' },
    agentId: AGENT,
    agentVersion: AGENT_V,
    runId: runId('run-current'),
    stepId: 'turn-1',
    locale: brand<string, 'RequestLocale'>('zh-CN'),
    purpose: 'SYSTEM_PROMPT',
  };
}

const SKILL_BODY = '<skill_content name="telecom-domain-qa">Use telecom evidence.</skill_content>';

describe('directed-Skill body persistence across rounds', () => {
  it('keeps the page-hidden USER(SKILL_CONTENT) message in model context, in place, and out of the last position', async () => {
    // Prior round = the skill-loading turn (after the model answered):
    //   USER(question) -> ASSISTANT(Skill tool-use, visible:false) ->
    //   TOOL(Skill result) -> USER(<skill_content>, visible:false, kind=SKILL_CONTENT) ->
    //   ASSISTANT(terminal answer)
    const skillToolCallId = 'directed-skill:telecom-domain-qa';
    const messages: readonly SessionMessageRecord[] = [
      record({ messageId: 'prior-user', requestId: 'prior-req', role: 'USER', content: 'Diagnose the alarm.', createdAt: 1 }),
      record({
        messageId: 'prior-skill-use',
        requestId: 'prior-req',
        role: 'ASSISTANT',
        content: JSON.stringify({
          toolCalls: [{ toolCallId: skillToolCallId, toolName: 'Skill', arguments: { name: 'telecom-domain-qa' } }],
        }),
        metadata: { kind: 'ASSISTANT_TOOL_USE' },
        visible: false,
        createdAt: 2,
      }),
      record({
        messageId: 'prior-skill-result',
        requestId: 'prior-req',
        role: 'CAPABILITY_RESULT',
        content: JSON.stringify({
          toolCallId: skillToolCallId,
          toolName: 'Skill',
          payload: { name: 'telecom-domain-qa', status: 'loaded' },
        }),
        createdAt: 3,
      }),
      record({
        messageId: 'prior-skill-content',
        requestId: 'prior-req',
        role: 'USER',
        content: SKILL_BODY,
        metadata: { modelVisibility: { included: true, reason: 'SKILL_BODY' }, skillName: 'telecom-domain-qa' },
        visible: false,
        createdAt: 4,
      }),
      record({
        messageId: 'prior-terminal',
        requestId: 'prior-req',
        role: 'ASSISTANT',
        content: JSON.stringify({ content: 'Alarm diagnosed using telecom evidence.' }),
        createdAt: 5,
      }),
      // Current round: a fresh user question.
      record({ messageId: 'current-req', requestId: 'current-req', role: 'USER', content: 'Run the diagnostic script.', createdAt: 6 }),
    ];

    const engine = makeEngine(
      messages,
      activeContextView(['prior-user', 'prior-skill-use', 'prior-skill-result', 'prior-skill-content', 'prior-terminal', 'current-req'], 7),
    );

    const assembly = await engine.assemble(request('current-req'), undefined, new AbortController().signal);

    // The page-hidden SKILL_CONTENT message survives history selection (not
    // dropped as a hidden replacement / incomplete prior turn).
    expect(assembly.selectedMessageRefs).toContain(msgId('prior-skill-content'));

    // Drive the real render path: engine.render batch-resolves selectedMessageRefs
    // via the message store (exercising isModelVisibleMessage) and runs the
    // DefaultModelInputRenderer (exercising placeGeneratedMessages dedupe).
    const rendered = await engine.render(assembly);

    const roles = rendered.messages.map((message) => message.role);
    expect(roles).toEqual(['SYSTEM', 'USER', 'ASSISTANT', 'TOOL', 'USER', 'ASSISTANT', 'USER']);

    // The skill body sits right after the Skill tool-result (index 4), before
    // the prior terminal assistant answer, and the current-round user question
    // is the LAST message — the body is NOT last.
    expect(rendered.messages[4]?.content).toEqual([{ type: 'text', text: SKILL_BODY }]);
    expect(rendered.messages.at(-1)?.content).toEqual([{ type: 'text', text: 'Run the diagnostic script.' }]);

    // No duplicate reconstruction from the tool-result body.
    const skillBodyOccurrences = rendered.messages.filter((message) =>
      message.content.some((part) => part.type === 'text' && part.text === SKILL_BODY),
    );
    expect(skillBodyOccurrences).toHaveLength(1);
  });
});
