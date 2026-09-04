import { brand, type EpochMillis } from '@nextagent/agent-common';
import type { AgentAssemblyRegistry } from '@nextagent/agent-contracts/agent-assembly';
import type {
  LongTermMemoryRecord,
  LongTermMemoryRetrieverGateway,
  LongTermMemoryStoreGateway,
  LongTermMemorySummary,
  RequestRunRecord,
  RequestRunStoreGateway,
  SearchItem,
  SessionMessageRecord,
  SessionMessageStoreGateway,
} from '@nextagent/agent-contracts/gateway';
import type { TrustedTerminalLifecycleHookInput } from '@nextagent/agent-runtime';
import { describe, expect, it, vi } from 'vitest';
import { createUserQueryMemoryRecallTrustedHook, userQueryMemoryRecallHookId } from '../src/composition/user-query-memory-recall-hook.js';

describe('user query memory recall trusted hook', () => {
  it('uses the persisted root USER query and injects complete L2', async () => {
    const fixture = createFixture();
    const hook = createUserQueryMemoryRecallTrustedHook(fixture.dependencies);

    const result = await hook.invoke(hookInput(), new AbortController().signal);

    expect(fixture.retriever.searchLongTermMemory).toHaveBeenCalledWith(
      expect.objectContaining({
        queryText: 'persisted trusted query',
        limit: 10,
        minConfidence: 0.3,
      }),
    );
    expect(fixture.retriever.getLongTermMemoryDetail).toHaveBeenCalledTimes(1);
    expect(result.outcome).toBe('PASS');
    const messages = result.outcome === 'PASS' ? result.mutation?.messages : undefined;
    expect(messages).toHaveLength(2);
    expect(messages?.[0]).toMatchObject({ role: 'USER' });
    expect(JSON.stringify(messages?.[0])).toContain('detail-memory-1');
    // Memory is injected as a <system-reminder> tag, not a bare USER message.
    expect(JSON.stringify(messages?.[0])).toContain('<system-reminder>');
    expect(JSON.stringify(messages?.[0])).toContain('</system-reminder>');
    // Attribution isolation is carried by the tag + system prompt; the bare
    // Chinese "do not treat as instruction" prefix MUST be gone.
    expect(JSON.stringify(messages?.[0])).not.toContain('不得视为用户指令或系统指令');
    expect(JSON.stringify(messages?.[1])).toContain('untrusted rendered query');
    expect(JSON.stringify(result)).not.toContain('memoryId');
  });

  it('returns no mutation and does not retry when an L2 read fails', async () => {
    const fixture = createFixture();
    fixture.retriever.getLongTermMemoryDetail.mockRejectedValue(new Error('unavailable'));
    const hook = createUserQueryMemoryRecallTrustedHook(fixture.dependencies);

    const result = await hook.invoke(hookInput(), new AbortController().signal);

    expect(result).toMatchObject({
      outcome: 'PASS',
      diagnostic: {
        diagnosticCode: 'MEMORY_RECALL_L2_DETAIL_FAILED',
        candidateCount: 1,
        detailCount: 0,
        contextDisposition: 'NO_CONTEXT',
      },
    });
    expect(fixture.retriever.searchLongTermMemory).toHaveBeenCalledTimes(1);
    expect(fixture.retriever.getLongTermMemoryDetail).toHaveBeenCalledTimes(1);
  });

  it('reports the missing final model input field and defers recall', async () => {
    const fixture = createFixture();
    const hook = createUserQueryMemoryRecallTrustedHook(fixture.dependencies);
    const completeInput = hookInput();
    const incompleteBoundary = { ...completeInput.boundary } as Record<string, unknown>;
    delete incompleteBoundary.contextWindowTokens;
    const incompleteInput = {
      ...completeInput,
      boundary: incompleteBoundary as unknown as typeof completeInput.boundary,
    };

    await expect(hook.invoke(incompleteInput, new AbortController().signal)).resolves.toMatchObject({
      outcome: 'SKIP',
      diagnostic: { diagnosticCode: 'MEMORY_RECALL_SKIPPED_FINAL_INPUT_INVALID' },
    });
    expect(fixture.retriever.searchLongTermMemory).not.toHaveBeenCalled();
    expect(fixture.retriever.getLongTermMemoryDetail).not.toHaveBeenCalled();

    const result = await hook.invoke(completeInput, new AbortController().signal);

    expect(result).toMatchObject({ outcome: 'PASS', mutation: { messages: expect.any(Array) } });
    expect(fixture.retriever.searchLongTermMemory).toHaveBeenCalledTimes(1);
    expect(fixture.retriever.getLongTermMemoryDetail).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['missing messages', 'messages', undefined, 'MEMORY_RECALL_SKIPPED_FINAL_INPUT_INVALID'],
    ['invalid tools', 'tools', undefined, 'MEMORY_RECALL_SKIPPED_FINAL_INPUT_INVALID'],
    ['missing model user message', 'messages', [], 'MEMORY_RECALL_SKIPPED_FINAL_INPUT_INVALID'],
  ] as const)('reports %s before claiming an attempt', async (_name, key, value, diagnosticCode) => {
    const fixture = createFixture();
    const hook = createUserQueryMemoryRecallTrustedHook(fixture.dependencies);
    const baseInput = hookInput();

    const boundary = { ...baseInput.boundary } as Record<string, unknown>;
    if (value === undefined) {
      delete boundary[key];
    } else {
      boundary[key] = value;
    }
    const result = await hook.invoke({ ...baseInput, boundary: boundary as unknown as typeof baseInput.boundary }, new AbortController().signal);

    expect(result).toMatchObject({ outcome: 'SKIP', diagnostic: { diagnosticCode } });
    expect(fixture.retriever.searchLongTermMemory).not.toHaveBeenCalled();
  });

  it('degrades an oversized L2 message to the complete L1 result', async () => {
    const fixture = createFixture();
    fixture.retriever.getLongTermMemoryDetail.mockResolvedValue(memoryRecord({ content: 'x'.repeat(2_000) }));
    const baseInput = hookInput();
    const input = {
      ...baseInput,
      boundary: { ...baseInput.boundary, contextWindowTokens: 220, maxOutputTokens: 20 },
    };
    const hook = createUserQueryMemoryRecallTrustedHook(fixture.dependencies);

    const result = await hook.invoke(input, new AbortController().signal);

    expect(JSON.stringify(result)).toContain('l1-memory-1');
    expect(JSON.stringify(result)).not.toContain('x'.repeat(100));
  });

  it('completes with no context when the complete L1 result also exceeds the final budget', async () => {
    const fixture = createFixture();
    const baseInput = hookInput();
    const input = {
      ...baseInput,
      boundary: { ...baseInput.boundary, contextWindowTokens: 30, maxOutputTokens: 20 },
    };
    const hook = createUserQueryMemoryRecallTrustedHook(fixture.dependencies);

    const result = await hook.invoke(input, new AbortController().signal);

    expect(result).toMatchObject({
      outcome: 'PASS',
      diagnostic: {
        diagnosticCode: 'MEMORY_RECALL_NO_CONTEXT_BUDGET_EXCEEDED',
        candidateCount: 1,
        detailCount: 1,
        contextDisposition: 'NO_CONTEXT',
      },
    });
  });

  it('skips fallback and later model rounds', async () => {
    const fixture = createFixture();
    const hook = createUserQueryMemoryRecallTrustedHook(fixture.dependencies);
    const baseInput = hookInput();
    await hook.invoke(baseInput, new AbortController().signal);
    for (const [stageOccurrenceKey, stepId, diagnosticCode] of [
      ['turn-1:fallback-openai:BEFORE_MODEL_INVOKE', 'turn-1', 'MEMORY_RECALL_SKIPPED_ALREADY_ATTEMPTED'],
      ['turn-2:default-openai:BEFORE_MODEL_INVOKE', 'turn-2', 'MEMORY_RECALL_SKIPPED_NOT_INITIAL_MODEL'],
    ] as const) {
      const input = {
        ...baseInput,
        coordinates: {
          ...baseInput.coordinates,
          stageOccurrenceKey,
        },
        boundary: { ...baseInput.boundary, stepId },
      };
      await expect(hook.invoke(input, new AbortController().signal)).resolves.toMatchObject({
        outcome: 'SKIP',
        diagnostic: { diagnosticCode },
      });
    }

    expect(fixture.retriever.searchLongTermMemory).toHaveBeenCalledTimes(1);
  });

  it('reports retry and memory binding eligibility failures', async () => {
    for (const [variant, expectedCode] of [
      ['retry', 'MEMORY_RECALL_SKIPPED_RUN_INELIGIBLE'],
      ['missing-binding', 'MEMORY_RECALL_SKIPPED_BINDINGS_MISSING'],
      ['wrong-provider', 'MEMORY_RECALL_SKIPPED_BINDINGS_MISSING'],
    ] as const) {
      const fixture = createFixture();
      const input = hookInput();
      if (variant === 'retry') {
        fixture.requestRuns.loadRun.mockResolvedValue(runRecord({ attempt: 2, retryOfRunId: 'R0' as never }));
      } else if (variant === 'missing-binding') {
        fixture.assemblyRegistry.require.mockResolvedValue(assembly(['search_memory']));
      } else {
        fixture.assemblyRegistry.require.mockResolvedValue({
          ...assembly(['search_memory', 'get_memory_detail']),
          capabilityBindings: [
            { capabilityId: 'search_memory', capabilityType: 'TOOL', providerId: 'other-provider', enabled: true },
            { capabilityId: 'get_memory_detail', capabilityType: 'TOOL', providerId: 'other-provider', enabled: true },
          ],
        });
      }
      const hook = createUserQueryMemoryRecallTrustedHook(fixture.dependencies);

      await expect(hook.invoke(input, new AbortController().signal)).resolves.toMatchObject({
        outcome: 'SKIP',
        diagnostic: { diagnosticCode: expectedCode },
      });
      expect(fixture.retriever.searchLongTermMemory).not.toHaveBeenCalled();
    }
  });

  it('reports request-run and root-message lookup failures without recalling', async () => {
    for (const [variant, expectedCode] of [
      ['run', 'MEMORY_RECALL_SKIPPED_RUN_LOAD_FAILED'],
      ['message', 'MEMORY_RECALL_SKIPPED_ROOT_MESSAGE_LOAD_FAILED'],
    ] as const) {
      const fixture = createFixture();
      if (variant === 'run') {
        fixture.requestRuns.loadRun.mockRejectedValue(new Error('run store unavailable'));
      } else {
        fixture.messages.loadMessage.mockRejectedValue(new Error('message store unavailable'));
      }
      const hook = createUserQueryMemoryRecallTrustedHook(fixture.dependencies);

      await expect(hook.invoke(hookInput(), new AbortController().signal)).resolves.toMatchObject({
        outcome: 'SKIP',
        diagnostic: { diagnosticCode: expectedCode },
      });
      expect(fixture.retriever.searchLongTermMemory).not.toHaveBeenCalled();
    }
  });

  it('injects both the broad-recall L2 message and the user characteristics message on the first turn', async () => {
    const fixture = createFixture();
    fixture.longTermMemoryStore.listLongTermMemory.mockResolvedValue({
      items: [characteristicsSummary('trait-1')],
      total: 1,
      offset: 0,
      limit: 10,
    });
    const hook = createUserQueryMemoryRecallTrustedHook(fixture.dependencies);

    const result = await hook.invoke(hookInput(), new AbortController().signal);

    expect(fixture.longTermMemoryStore.listLongTermMemory).toHaveBeenCalledWith(
      expect.objectContaining({ memoryType: 'USER_CHARACTERISTICS', state: 'ACTIVE', limit: 10, offset: 0 }),
    );
    expect(result.outcome).toBe('PASS');
    const messages = result.outcome === 'PASS' ? result.mutation?.messages : undefined;
    expect(messages).toHaveLength(3);
    expect(JSON.stringify(messages?.[0])).toContain('detail-memory-1');
    expect(JSON.stringify(messages?.[1])).toContain('偏好-trait-1');
    expect(JSON.stringify(messages?.[2])).toContain('untrusted rendered query');
    expect(JSON.stringify(result)).toContain('MEMORY_RECALL_CHARACTERISTICS_ADMITTED');
  });

  it('injects the characteristics message alone when the broad recall returns no match', async () => {
    const fixture = createFixture();
    fixture.retriever.searchLongTermMemory.mockResolvedValue({ items: [], total: 0, offset: 0, limit: 10 });
    fixture.longTermMemoryStore.listLongTermMemory.mockResolvedValue({
      items: [characteristicsSummary('trait-1')],
      total: 1,
      offset: 0,
      limit: 10,
    });
    const hook = createUserQueryMemoryRecallTrustedHook(fixture.dependencies);

    const result = await hook.invoke(hookInput(), new AbortController().signal);

    expect(result.outcome).toBe('PASS');
    const messages = result.outcome === 'PASS' ? result.mutation?.messages : undefined;
    expect(messages).toHaveLength(2);
    expect(JSON.stringify(messages?.[0])).toContain('偏好-trait-1');
    expect(JSON.stringify(messages?.[1])).toContain('untrusted rendered query');
    expect(JSON.stringify(result)).toContain('MEMORY_RECALL_CHARACTERISTICS_ADMITTED');
  });

  it('injects the broad-recall L2 message alone when characteristics listing fails', async () => {
    const fixture = createFixture();
    fixture.longTermMemoryStore.listLongTermMemory.mockRejectedValue(new Error('store unavailable'));
    const hook = createUserQueryMemoryRecallTrustedHook(fixture.dependencies);

    const result = await hook.invoke(hookInput(), new AbortController().signal);

    expect(result.outcome).toBe('PASS');
    const messages = result.outcome === 'PASS' ? result.mutation?.messages : undefined;
    expect(messages).toHaveLength(2);
    expect(JSON.stringify(messages?.[0])).toContain('detail-memory-1');
    expect(JSON.stringify(result)).toContain('MEMORY_RECALL_CHARACTERISTICS_LIST_FAILED');
  });

  it('injects the characteristics message alone when the broad recall L2 detail fails and there is no L1 budget', async () => {
    const fixture = createFixture();
    fixture.retriever.getLongTermMemoryDetail.mockRejectedValue(new Error('detail unavailable'));
    fixture.longTermMemoryStore.listLongTermMemory.mockResolvedValue({
      items: [characteristicsSummary('trait-1')],
      total: 1,
      offset: 0,
      limit: 10,
    });
    const hook = createUserQueryMemoryRecallTrustedHook(fixture.dependencies);

    const result = await hook.invoke(hookInput(), new AbortController().signal);

    expect(result.outcome).toBe('PASS');
    const messages = result.outcome === 'PASS' ? result.mutation?.messages : undefined;
    expect(messages).toHaveLength(2);
    expect(JSON.stringify(messages?.[0])).toContain('偏好-trait-1');
    expect(JSON.stringify(result)).toContain('MEMORY_RECALL_CHARACTERISTICS_ADMITTED');
  });
});

function createFixture() {
  const assemblyRegistry = {
    require: vi.fn(async () => assembly(['search_memory', 'get_memory_detail'])),
  } as unknown as AgentAssemblyRegistry & { readonly require: ReturnType<typeof vi.fn> };
  const requestRuns = {
    loadRun: vi.fn(async () => runRecord()),
  } as unknown as RequestRunStoreGateway & { readonly loadRun: ReturnType<typeof vi.fn> };
  const messages = {
    loadMessage: vi.fn(async () => rootMessage()),
  } as unknown as SessionMessageStoreGateway & { readonly loadMessage: ReturnType<typeof vi.fn> };
  const item = searchItem();
  const retriever = {
    searchLongTermMemory: vi.fn<LongTermMemoryRetrieverGateway['searchLongTermMemory']>(async (query) => ({
      items: [item],
      total: 1,
      offset: query.offset,
      limit: query.limit,
    })),
    getLongTermMemoryDetail: vi.fn<LongTermMemoryRetrieverGateway['getLongTermMemoryDetail']>(async () => memoryRecord()),
  };
  const longTermMemoryStore = {
    listLongTermMemory: vi.fn<LongTermMemoryStoreGateway['listLongTermMemory']>(async () => ({
      items: [],
      total: 0,
      offset: 0,
      limit: 10,
    })),
  } as unknown as LongTermMemoryStoreGateway & { readonly listLongTermMemory: ReturnType<typeof vi.fn> };
  return {
    assemblyRegistry,
    requestRuns,
    messages,
    retriever,
    longTermMemoryStore,
    dependencies: {
      assemblyRegistry,
      requestRuns,
      messages,
      longTermMemoryRetriever: retriever,
      longTermMemoryStore,
    },
  };
}

function hookInput(): TrustedTerminalLifecycleHookInput & {
  coordinates: TrustedTerminalLifecycleHookInput['coordinates'] & { stageOccurrenceKey: string };
} {
  return {
    hookId: userQueryMemoryRecallHookId,
    coordinates: {
      sessionId: 'S1' as never,
      requestId: 'Q1' as never,
      requestRunId: 'R1' as never,
      agentId: 'A1' as never,
      agentVersion: 'v1' as never,
      agentAssemblyRef: 'assembly-1',
      stageOccurrenceKey: 'turn-1:default-openai:BEFORE_MODEL_INVOKE',
    },
    ownerScope: { tenantId: 'T1' as never, subjectId: 'U1' as never },
    boundary: {
      stepId: 'turn-1',
      modelId: 'default-openai',
      contextWindowTokens: 10_000,
      toolCount: 0,
      safeModelRequestSummary: 'messages=1,tools=0',
      messages: [{ role: 'USER', content: [{ type: 'text', text: 'untrusted rendered query' }] }],
      tools: [],
      maxOutputTokens: 100,
      providerOptions: {},
      timeoutMs: 1000,
    },
  };
}

function assembly(capabilityIds: readonly string[]): Awaited<ReturnType<AgentAssemblyRegistry['require']>> {
  return {
    agentId: 'A1',
    agentVersion: 'v1',
    agentAssemblyRef: 'assembly-1',
    capabilityBindings: capabilityIds.map((capabilityId) => ({ capabilityId, capabilityType: 'TOOL', providerId: 'memory-tools', enabled: true })),
  } as unknown as Awaited<ReturnType<AgentAssemblyRegistry['require']>>;
}

function characteristicsSummary(traitId: string): LongTermMemorySummary {
  return {
    memoryId: brand<string, 'LongTermMemoryId'>(traitId),
    memoryType: 'USER_CHARACTERISTICS',
    knowledgeSourceType: 'LEARNED',
    state: 'ACTIVE',
    briefIndex: `偏好-${traitId}`,
    content: `trait-${traitId}`,
    labels: [],
    confidence: 0.9,
    isPinned: false,
    accessCount: 0,
    createTime: epoch(1),
    updateTime: epoch(1),
    version: 1,
  } as unknown as LongTermMemorySummary;
}

function runRecord(overrides: Partial<RequestRunRecord> = {}): RequestRunRecord {
  return {
    tenantId: 'T1',
    subjectId: 'U1',
    agentId: 'A1',
    runId: 'R1',
    sessionId: 'S1',
    requestId: 'Q1',
    agentVersion: 'v1',
    agentAssemblyRef: 'assembly-1',
    attempt: 1,
    status: 'EXECUTING',
    version: 1,
    terminalCommitState: 'NOT_STARTED',
    createdAt: epoch(1),
    updatedAt: epoch(1),
    ...overrides,
  } as RequestRunRecord;
}

function rootMessage(): SessionMessageRecord {
  return {
    tenantId: 'T1',
    subjectId: 'U1',
    agentId: 'A1',
    messageId: 'Q1',
    sessionId: 'S1',
    requestId: 'Q1',
    runId: 'R1',
    role: 'USER',
    content: 'persisted trusted query',
    contentType: 'TEXT',
    metadata: {},
    visible: true,
    createdAt: epoch(1),
  } as unknown as SessionMessageRecord;
}

function searchItem(): SearchItem {
  return {
    summary: {
      memoryId: brand<string, 'LongTermMemoryId'>('memory-1'),
      memoryType: 'FACTUAL',
      knowledgeSourceType: 'LEARNED',
      state: 'ACTIVE',
      briefIndex: 'summary-memory-1',
      content: 'l1-memory-1',
      labels: [],
      confidence: 0.9,
      isPinned: false,
      accessCount: 0,
      createTime: epoch(1),
      updateTime: epoch(1),
      version: 1,
    },
    score: 0.9,
    relevanceScore: 0.9,
  };
}

function memoryRecord(overrides: Partial<LongTermMemoryRecord> = {}): LongTermMemoryRecord {
  return {
    tenantId: 'T1',
    subjectId: 'U1',
    agentId: 'A1',
    memoryId: brand<string, 'LongTermMemoryId'>('memory-1'),
    memoryInstance: 'default',
    memoryType: 'FACTUAL',
    knowledgeSourceType: 'LEARNED',
    sharingState: 'PRIVATE',
    state: 'ACTIVE',
    briefIndex: 'summary-memory-1',
    content: 'detail-memory-1',
    labels: [],
    confidence: 0.9,
    version: 1,
    accessCount: 0,
    recallCount: 0,
    extractionCount: 0,
    archivedAt: epoch(0),
    archiveReason: '',
    isPinned: false,
    source: 'test',
    createTime: epoch(1),
    updateTime: epoch(1),
    ...overrides,
  } as unknown as LongTermMemoryRecord;
}

function epoch(value: number): EpochMillis {
  return brand<number, 'EpochMillis'>(value);
}
