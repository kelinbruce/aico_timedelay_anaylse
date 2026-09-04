import { DefaultContextEngine } from '@nextagent/agent-context-engine';
import { AgentError, brand, type MessageId } from '@nextagent/agent-common';
import type { AgentAssembly, AgentAssemblyRegistry } from '@nextagent/agent-contracts/agent-assembly';
import type { CapabilityCatalog, CapabilityDescriptor } from '@nextagent/agent-contracts/capability';
import type {
  ActiveContextItemRecord,
  ActiveContextStateRecord,
  ActiveContextStoreGateway,
  ActiveContextViewRecord,
  SessionMessageRecord,
  SessionMessageStoreGateway,
} from '@nextagent/agent-contracts/gateway';
import { describe, expect, it } from 'vitest';
import { createTestModelSelectionService } from './test-model-selection-helpers.js';

// =============================================================================
// Integration: the memory guidance section is wired into the request path so
// that it renders iff the gating capability is visible to the model for the
// accepted Agent. Verifies the assemble-context -> assembler seam, which the
// assembler-level prompt-shaping tests do not cover.
// =============================================================================

const TENANT = brand<string, 'TenantId'>('tenant-memory');
const SUBJECT = brand<string, 'SubjectId'>('subject-memory');
const AGENT = brand<string, 'AgentId'>('agent-memory');
const AGENT_V = brand<string, 'AgentVersion'>('v1');
const SESSION = brand<string, 'SessionId'>('session-memory');
const GATING_CAPABILITY_ID = 'memory-search-gating-test';

function makeAssembly(): AgentAssembly {
  return {
    agentId: AGENT,
    agentType: brand<string, 'AgentType'>('default'),
    agentVersion: AGENT_V,
    agentAssemblyRef: 'agent-memory:v1',
    displayName: 'Memory gate test agent',
    description: 'Memory guidance integration test agent',
    workspacePolicy: {
      schemaVersion: 'nextagent.agent-workspace-policy.v1',
      isolationMode: 'subject',
      roots: [{ kind: 'workspace', logicalPath: 'workspace', access: 'readWrite' }],
    },
    modelIds: ['default'],
    capabilityBindings: [],
    userInvocable: true,
    agentInvocation: 'BOUND',
    runtimeSettings: { maxContextMessages: 50 },
  };
}

function gatingCapability(): CapabilityDescriptor {
  return {
    capabilityId: brand<string, 'CapabilityId'>(GATING_CAPABILITY_ID),
    kind: 'TOOL',
    provider: { providerId: 'memory-tools', providerKind: 'BUNDLED' },
    displayName: 'Memory search',
    description: 'Search long-term memory.',
    modelInvocable: true,
    availabilityStatus: 'AVAILABLE',
  };
}

function makeEngine(capabilities: readonly CapabilityDescriptor[]): DefaultContextEngine {
  const currentMessage: SessionMessageRecord = {
    tenantId: TENANT,
    subjectId: SUBJECT,
    agentId: AGENT,
    sessionId: SESSION,
    messageId: brand<string, 'MessageId'>('current-req'),
    requestId: brand<string, 'MessageId'>('current-req'),
    role: 'USER',
    content: 'hello',
    contentType: 'PLAIN_TEXT',
    metadata: {},
    visible: true,
    createdAt: brand<number, 'EpochMillis'>(1),
  };
  const messages = new Map<string, SessionMessageRecord>([[currentMessage.messageId, currentMessage]]);
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
      return capabilities;
    },
    async resolve() {
      return undefined;
    },
  };
  const activeContextStore: ActiveContextStoreGateway = {
    async loadActiveContext() {
      const state: ActiveContextStateRecord = {
        tenantId: TENANT,
        subjectId: SUBJECT,
        agentId: AGENT,
        sessionId: SESSION,
        activeContextVersion: 1,
        updatedAt: brand<number, 'EpochMillis'>(1),
      };
      const items: readonly ActiveContextItemRecord[] = [
        {
          tenantId: TENANT,
          subjectId: SUBJECT,
          agentId: AGENT,
          sessionId: SESSION,
          ordinal: 0,
          messageId: brand<string, 'MessageId'>('current-req'),
        },
      ];
      return { state, items } satisfies ActiveContextViewRecord;
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
      return messages.get(req.messageId);
    },
    async loadMessages(req) {
      return req.messageIds.map((id) => messages.get(id)).filter((m): m is SessionMessageRecord => m !== undefined);
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
      return { items: [], limit: 100, hasMore: false };
    },
    async hideMessage() {
      throw new Error('unused');
    },
    async hideRequestMessages() {
      throw new Error('unused');
    },
  };
  return new DefaultContextEngine({
    activeContextStore,
    messageStore,
    assemblyRegistry,
    capabilityCatalog,
    modelSelectionService: createTestModelSelectionService({ maxOutputTokens: 1_000 }),
    memoryToolCapabilityId: GATING_CAPABILITY_ID,
  });
}

function request() {
  return {
    sessionId: SESSION,
    requestId: brand<string, 'MessageId'>('current-req'),
    requestContextId: brand<string, 'RequestContextId'>('rc-memory'),
    identityContext: { tenantId: TENANT, subjectId: SUBJECT, displayName: 'memory tester' },
    agentId: AGENT,
    agentVersion: AGENT_V,
    runId: brand<string, 'RequestRunId'>('run-memory'),
    stepId: 'step-1',
    locale: brand<string, 'RequestLocale'>('en-US'),
    purpose: 'test',
  };
}

describe('DefaultContextEngine — memory guidance section gating', () => {
  it('renders the memory section when the gating capability is visible to the model', async () => {
    const engine = makeEngine([gatingCapability()]);
    const result = await engine.assemble(request(), undefined, new AbortController().signal);

    const memorySection = result.systemPrompt.sections.find((section) => section.sectionId === 'memory');
    expect(memorySection).toBeDefined();
    expect(memorySection!.content).toContain('# Long-term memory');
  });

  it('omits the memory section when the gating capability is not visible', async () => {
    const engine = makeEngine([]);
    const result = await engine.assemble(request(), undefined, new AbortController().signal);

    const memorySection = result.systemPrompt.sections.find((section) => section.sectionId === 'memory');
    expect(memorySection).toBeUndefined();
  });
});
