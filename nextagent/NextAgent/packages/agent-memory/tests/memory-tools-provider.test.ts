import {
  addMemoryCapabilityId,
  createMemoryToolDefinitions,
  createMemoryToolsProvider,
  createLongTermMemoryToolPort,
  getMemoryDetailCapabilityId,
  memoryToolsProvider,
  memoryToolsProviderId,
  projectMemoryToolsRegistration,
  searchMemoryCapabilityId,
  type LongTermMemoryToolPort,
  type LongTermMemoryToolSearchQuery,
} from '@nextagent/agent-memory';
import type { MemoryContentByCategory } from '../src/memory-data.js';
import { brand, type JsonObject, type SafeError } from '@nextagent/agent-common';
import { Ajv } from 'ajv/dist/ajv.js';
import type {
  GuardrailGatewayPort,
  LongTermMemoryRecord,
  LongTermMemoryRetrieverGateway,
  LongTermMemoryStoreGateway,
  SaveLongTermMemoryRequest,
  SearchItemPage,
  VersionedWriteOptions,
} from '@nextagent/agent-contracts/gateway';
import type { CapabilityInvocationResult, ToolExecuteOptions, ToolExecutableDiscovery } from '@nextagent/agent-contracts/capability';
import { describe, expect, it, vi } from 'vitest';

const ajv = new Ajv({ strict: false, allErrors: true });

describe('memory tools provider', () => {
  it('exposes memory tools as one provider-owned contribution', async () => {
    const contribution = createMemoryToolsProvider(fakePort());
    expect(contribution.discovery.listAll).toBeDefined();
    const descriptors = await contribution.discovery.listAll!(new AbortController().signal);

    expect(contribution.identity).toEqual(memoryToolsProvider);
    expect(contribution.discovery.provider).toEqual(memoryToolsProvider);
    expect(descriptors.map((descriptor) => descriptor.capabilityId).sort()).toEqual(['add_memory', 'get_memory_detail', 'search_memory']);
    expect(descriptors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          capabilityId: 'search_memory',
          displayName: 'Search long-term memory',
          locales: {
            language: {
              'zh-CN': { displayName: '检索长期记忆' },
              'en-US': { displayName: 'Search long-term memory' },
            },
          },
        }),
      ]),
    );
  });

  it('keeps the memory provider fact without exposing tools when disabled', async () => {
    const contribution = createMemoryToolsProvider(fakePort(), { enabled: false });
    expect(contribution.identity).toEqual(memoryToolsProvider);
    expect(contribution.discovery.provider).toEqual(memoryToolsProvider);
    await expect(contribution.discovery.listAll!(new AbortController().signal)).resolves.toEqual([]);
    expect((contribution.discovery as ToolExecutableDiscovery).resolveExecutable(searchMemoryCapabilityId)).toBeUndefined();
  });

  it('projects memory opt-in and description overrides from provider-owned bindings', () => {
    const projection = projectMemoryToolsRegistration({
      registered: true,
      assembly: {
        capabilityBindings: [
          {
            capabilityId: searchMemoryCapabilityId,
            capabilityType: 'TOOL',
            providerId: memoryToolsProviderId,
            enabled: true,
            description: 'Search only relevant entries.',
          },
          { capabilityId: getMemoryDetailCapabilityId, capabilityType: 'TOOL', providerId: memoryToolsProviderId, enabled: true },
          { capabilityId: addMemoryCapabilityId, capabilityType: 'TOOL', providerId: memoryToolsProviderId, enabled: true },
          {
            capabilityId: brand<string, 'CapabilityId'>('Read'),
            capabilityType: 'TOOL',
            providerId: 'builtin-tools',
            enabled: true,
            description: 'ignored',
          },
        ],
      },
    });

    expect(projection.optedIn).toBe(true);
    expect(projection.config.tools?.search_memory).toEqual({ safeDescriptionOverride: 'Search only relevant entries.' });
    expect(projection.descriptionDiagnostics.map((item) => item.issueCode)).toEqual([
      'MEMORY_DESCRIPTION_OVERRIDE_APPLIED',
      'MEMORY_DESCRIPTION_OVERRIDE_REJECTED',
    ]);
  });

  it('defines only the first-version model-facing memory tools with strict schemas', async () => {
    const contribution = createMemoryToolsProvider(fakePort());
    const descriptors = await contribution.discovery.listAll!(new AbortController().signal);

    expect(descriptors.map((descriptor) => descriptor.capabilityId).sort()).toEqual(['add_memory', 'get_memory_detail', 'search_memory']);
    expect(descriptors).toEqual([
      expect.objectContaining({
        capabilityId: 'search_memory',
        provider: memoryToolsProvider,
        modelInvocable: true,
        availabilityStatus: 'AVAILABLE',
      }),
      expect.objectContaining({
        capabilityId: 'get_memory_detail',
        provider: memoryToolsProvider,
        modelInvocable: true,
        availabilityStatus: 'AVAILABLE',
      }),
      expect.objectContaining({ capabilityId: 'add_memory', provider: memoryToolsProvider, modelInvocable: true, availabilityStatus: 'AVAILABLE' }),
    ]);
    for (const descriptor of descriptors) {
      expect(descriptor.inputSchema).toMatchObject({ additionalProperties: false });
    }
    const searchDescriptor = descriptors.find((descriptor) => descriptor.capabilityId === 'search_memory');
    expect(searchDescriptor?.description).toContain('without categoryFilter');
    expect(searchDescriptor?.description).toContain('Do not fan out');
    expect(JSON.stringify(searchDescriptor?.inputSchema)).toContain('Omit when the memory category is uncertain');
    expect(JSON.stringify(searchDescriptor?.inputSchema)).toContain('do not issue parallel searches over categories');
    expect(JSON.stringify(descriptors)).not.toContain('update_memory');
    expect(JSON.stringify(descriptors)).not.toContain('forget_memory');
    expect(JSON.stringify(descriptors)).not.toContain('get_user_context');
  });

  it('rejects owner, agent scope, and knowledge source fields through exported capability JSON Schema validation', async () => {
    const port = fakePort();
    const attempts = [
      ['search_memory', { queryText: 'BGP', tenantId: 'evil' }],
      ['get_memory_detail', { longTermMemoryIds: ['ltm-owned'], agentId: 'evil' }],
      [
        'add_memory',
        {
          category: 'FACTUAL',
          content: { category: 'FACTUAL', subject: 'BGP', claim: 'Peer is 10.0.0.1' },
          subjectId: 'evil',
        },
      ],
      [
        'add_memory',
        {
          category: 'FACTUAL',
          content: { category: 'FACTUAL', subject: 'BGP', claim: 'Peer is 10.0.0.1' },
          knowledgeSourceType: 'CONFIGURED',
        },
      ],
    ] as const;

    for (const [capabilityId, args] of attempts) {
      const result = await invoke(port, capabilityId, args);
      expect(result).toMatchObject({
        status: 'FAILED',
        safeError: { code: 'CAPABILITY_INPUT_INVALID', category: 'VALIDATION' },
      });
    }
    expect(port.searchLongTermMemory).not.toHaveBeenCalled();
    expect(port.getLongTermMemoryDetail).not.toHaveBeenCalled();
    expect(port.saveLongTermMemory).not.toHaveBeenCalled();
  });

  it('ignores purpose-scoped search hints unless the category is USER_CHARACTERISTICS', async () => {
    const port = fakePort();

    const result = await invoke(port, 'search_memory', {
      queryText: 'preference',
      categoryFilter: 'PROCEDURAL',
      purpose: 'PERSONALIZATION',
    });

    expect(port.searchLongTermMemory).toHaveBeenCalledWith(
      expect.objectContaining({
        queryText: 'preference',
        memoryType: 'PROCEDURAL',
      }),
      expect.any(AbortSignal),
    );
    expect(port.searchLongTermMemory.mock.calls[0]?.[0]).not.toHaveProperty('purpose');
    expect(result).toMatchObject({
      status: 'SUCCEEDED',
      structuredPayload: {
        entries: [],
        totalCount: 0,
      },
    });
  });

  it('injects trusted scope into search_memory and returns L1 projection only', async () => {
    const port = fakePort({
      search: {
        items: [
          {
            summary: memorySummary('ltm-search', 'PROCEDURAL', 'BGP troubleshooting flow'),
            score: 0.9,
            relevanceScore: 0.9,
          },
        ],
        total: 1,
        limit: 5,
        offset: 0,
      },
    });

    const result = await invoke(port, 'search_memory', { queryText: 'BGP', categoryFilter: 'PROCEDURAL', limit: 5 });

    expect(port.searchLongTermMemory).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: 'tenant-memory',
        subjectId: 'subject-memory',
        agentId: 'agent-memory',
        queryText: 'BGP',
        memoryType: 'PROCEDURAL',
        minConfidence: 0.3,
        limit: 5,
        offset: 0,
      }),
      expect.any(AbortSignal),
    );
    expect(result).toMatchObject({
      status: 'SUCCEEDED',
      structuredPayload: {
        entries: [expect.objectContaining({ longTermMemoryId: 'ltm-search', briefIndex: 'BGP troubleshooting flow' })],
        totalCount: 1,
        limit: 5,
        offset: 0,
      },
    });
    expect(JSON.stringify(result)).not.toContain('steps');
  });

  it('returns per-entry L2 detail results and masks not-found or not-owned entries', async () => {
    const owned = memoryRecord({ longTermMemoryId: 'ltm-owned', content: { category: 'FACTUAL', subject: 'BGP', claim: 'Peer is 10.0.0.1' } });
    const port = fakePort({
      detail(id) {
        return id === 'ltm-owned' ? owned : safeError('LTM_ENTRY_NOT_FOUND', 'NOT_FOUND', false);
      },
    });

    const result = await invoke(port, 'get_memory_detail', { longTermMemoryIds: ['ltm-owned', 'ltm-missing'] });

    expect(result).toMatchObject({
      status: 'SUCCEEDED',
      structuredPayload: {
        results: [
          { longTermMemoryId: 'ltm-owned', entry: expect.objectContaining({ content: expect.objectContaining({ claim: 'Peer is 10.0.0.1' }) }) },
          {
            longTermMemoryId: 'ltm-missing',
            error: expect.objectContaining({ code: 'LTM_ENTRY_NOT_FOUND', message: expect.stringContaining('search_memory') }),
          },
        ],
      },
    });
    const payload = (result as CapabilityInvocationResult).structuredPayload;
    const ownedEntry = (payload['results'] as Array<{ readonly entry?: JsonObject }>)[0]?.entry;
    expect(ownedEntry).not.toHaveProperty('sourceTrace');
    expect(ownedEntry).not.toHaveProperty('source');
    expect((result as CapabilityInvocationResult).metadata).toEqual({
      sourceTrace: [
        {
          longTermMemoryId: 'ltm-owned',
          source: { sessionId: 'session-memory' },
        },
      ],
    });

    const definition = createMemoryToolDefinitions(port).find((item) => item.metadata.name === getMemoryDetailCapabilityId);
    expect(definition?.metadata.outputSchema).toBeDefined();
    const validateOutput = ajv.compile(definition!.metadata.outputSchema!);
    expect(validateOutput(payload)).toBe(true);
    const payloadWithSourceTrace = JSON.parse(JSON.stringify(payload)) as {
      results: Array<{ entry?: Record<string, unknown> }>;
    };
    const unsafeEntry = payloadWithSourceTrace.results[0]?.entry;
    expect(unsafeEntry).toBeDefined();
    unsafeEntry!.sourceTrace = { runId: 'source-run' };
    expect(validateOutput(payloadWithSourceTrace)).toBe(false);
  });

  it('preserves global detail failures instead of rewriting them as item not-found', async () => {
    const authorization = safeError('LTM_SCOPE_DENIED', 'AUTHORIZATION', false, 'Memory access is outside the current trusted scope.');
    const port = fakePort({ detail: () => authorization });

    const result = await invoke(port, 'get_memory_detail', { longTermMemoryIds: ['ltm-denied'] });

    expect(result).toMatchObject({
      status: 'FAILED',
      structuredPayload: {},
      safeError: {
        code: 'LTM_SCOPE_DENIED',
        message: 'Memory access is outside the current trusted scope.',
        category: 'AUTHORIZATION',
        retryable: false,
      },
    });
  });

  it('returns LTM_DISABLED when stale bindings reach a disabled memory core', async () => {
    const disabled = safeError('LTM_DISABLED', 'UNAVAILABLE', false, 'Long-term memory is disabled. Continue without it.');
    const port = fakePort({
      search: disabled,
      detail: () => disabled,
      save: disabled,
    });

    for (const [capabilityId, args] of [
      ['search_memory', { queryText: 'BGP' }],
      ['get_memory_detail', { longTermMemoryIds: ['ltm-disabled'] }],
      [
        'add_memory',
        {
          category: 'FACTUAL',
          content: { category: 'FACTUAL', subject: 'BGP', claim: 'Peer is 10.0.0.1' },
        },
      ],
    ] as const) {
      const result = await invoke(port, capabilityId, args);
      expect(result).toMatchObject({
        status: 'FAILED',
        safeError: {
          code: 'LTM_DISABLED',
          message: 'Long-term memory is disabled. Continue without it.',
          category: 'UNAVAILABLE',
          retryable: false,
        },
      });
    }
  });

  it('returns storage unavailable SafeError without leaking raw memory details', async () => {
    const unavailable = safeError(
      'LTM_STORAGE_UNAVAILABLE',
      'UNAVAILABLE',
      true,
      'Long-term memory storage is temporarily unavailable. Try again later.',
    );
    const port = fakePort({ search: unavailable });

    const result = await invoke(port, 'search_memory', { queryText: 'BGP' });

    expect(result).toMatchObject({
      status: 'FAILED',
      safeError: {
        code: 'LTM_STORAGE_UNAVAILABLE',
        message: 'Long-term memory storage is temporarily unavailable. Try again later.',
        category: 'UNAVAILABLE',
        retryable: true,
      },
      structuredPayload: {},
    });
    expect(JSON.stringify(result)).not.toContain('content');
  });

  it('allows oversized search and detail payloads to flow to the unified capacity boundary', async () => {
    const searchPort = fakePort({
      search: {
        items: Array.from({ length: 100 }, (_, index) => ({
          summary: memorySummary(`ltm-${index}`, 'FACTUAL', 'x'.repeat(500), 100 + index),
          score: 0.9,
          relevanceScore: 0.9,
        })),
        total: 100,
        limit: 100,
        offset: 0,
      },
    });
    const detailPort = fakePort({
      detail: () =>
        memoryRecord({
          longTermMemoryId: 'ltm-huge',
          content: { category: 'FACTUAL', subject: 'BGP', claim: 'x'.repeat(25_000) },
        }),
    });
    const sourceHeavyDetailPort = fakePort({
      detail: () =>
        memoryRecord({
          longTermMemoryId: 'ltm-source-heavy',
          content: { category: 'FACTUAL', subject: 'BGP', claim: 'small payload' },
          source: JSON.stringify({
            sessionId: 'session-source-heavy',
            refs: Array.from({ length: 600 }, (_, index) => ({
              sessionId: `session-source-${index}-${'x'.repeat(40)}`,
              runId: `run-source-${index}`,
            })),
          }),
        }),
    });

    const searchResult = await invoke(searchPort, 'search_memory', { queryText: 'large', limit: 100 });
    const detailResult = await invoke(detailPort, 'get_memory_detail', { longTermMemoryIds: ['ltm-huge'] });
    const sourceHeavyDetailResult = await invoke(sourceHeavyDetailPort, 'get_memory_detail', {
      longTermMemoryIds: ['ltm-source-heavy'],
    });

    for (const result of [searchResult, detailResult, sourceHeavyDetailResult]) {
      expect(result).toMatchObject({ status: 'SUCCEEDED' });
    }
    expect(JSON.stringify([searchResult, detailResult, sourceHeavyDetailResult])).not.toContain('MEMORY_TOOL_RESULT_TOO_LARGE');
    expect((sourceHeavyDetailResult as CapabilityInvocationResult).metadata).toHaveProperty('sourceTrace');
  });

  it('times out slow memory operations and aborts the downstream tool port signal', async () => {
    let downstreamSignal: AbortSignal | undefined;
    const port = fakePort({
      search: (_query, signal) => {
        downstreamSignal = signal;
        return new Promise<SearchItemPage>(() => undefined);
      },
    });

    const result = await invoke(port, 'search_memory', { queryText: 'slow' }, 5);

    expect(result).toMatchObject({
      status: 'TIMED_OUT',
      safeError: { code: 'MEMORY_TOOL_TIMEOUT', category: 'TIMEOUT', retryable: true },
    });
    expect(downstreamSignal?.aborted).toBe(true);
  });

  it('writes add_memory through save only, converts USER_CHARACTERISTICS string content, and returns active creation outcome', async () => {
    const port = fakePort();

    const result = await invoke(port, 'add_memory', {
      category: 'USER_CHARACTERISTICS',
      content: 'prefers compact tables',
      briefIndex: 'x'.repeat(120),
    });

    expect(port.searchLongTermMemory).not.toHaveBeenCalled();
    expect(port.getLongTermMemoryDetail).not.toHaveBeenCalled();
    expect(port.saveLongTermMemory).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: 'tenant-memory',
        subjectId: 'subject-memory',
        agentId: 'agent-memory',
        memoryType: 'USER_CHARACTERISTICS',
        knowledgeSourceType: 'LEARNED',
        content: JSON.stringify({ category: 'USER_CHARACTERISTICS', traits: ['prefers compact tables'], purpose: ['GENERAL'] }),
        confidence: 0.5,
        briefIndex: 'x'.repeat(100),
      }),
      expect.objectContaining({ idempotencyKey: expect.stringContaining('run-memory') }),
      expect.any(AbortSignal),
    );
    expect(result).toMatchObject({
      status: 'SUCCEEDED',
      structuredPayload: {
        longTermMemoryId: 'ltm-saved',
        state: 'ACTIVE',
        briefIndexTruncated: true,
        outcome: 'CREATED_ACTIVE',
        nextAction: 'ACKNOWLEDGE_USER_DO_NOT_CALL_ADD_MEMORY_AGAIN',
      },
    });
  });

  it('writes add_memory through the app-composed knowledge admission coordinator', async () => {
    const guarded = guardedToolPort({ isLegal: true });

    const result = await invoke(guarded.port, 'add_memory', {
      category: 'FACTUAL',
      content: 'BGP peer 10.0.0.1 is approved.',
      briefIndex: 'Approved BGP peer',
    });

    expect(result).toMatchObject({
      status: 'SUCCEEDED',
      structuredPayload: { outcome: 'CREATED_ACTIVE' },
    });
    expect(guarded.checkKnowledge).toHaveBeenCalledWith(expect.objectContaining({ isPrivacy: true }), expect.any(AbortSignal));
    expect(guarded.saveLongTermMemory).toHaveBeenCalledOnce();
  });

  it.each([
    {
      name: 'blocked',
      guardResult: { isLegal: false } as const,
      code: 'LTM_CONTENT_GUARD_BLOCKED',
      category: 'POLICY_DENIED',
      retryable: false,
    },
    {
      name: 'unavailable',
      guardResult: {
        code: 'GUARDRAIL_KNOWLEDGE_UNAVAILABLE',
        message: 'Knowledge security check is temporarily unavailable.',
        category: 'UNAVAILABLE',
        retryable: true,
        safeDetails: { detail: 'PROVIDER_DETAIL_CANARY' },
      } as SafeError,
      code: 'LTM_CONTENT_GUARD_UNAVAILABLE',
      category: 'UNAVAILABLE',
      retryable: true,
    },
    {
      name: 'canceled',
      guardResult: {
        code: 'GUARDRAIL_KNOWLEDGE_CANCELED',
        message: 'Knowledge security check was canceled.',
        category: 'CANCELED',
        retryable: false,
      } as SafeError,
      code: 'LTM_CONTENT_GUARD_CANCELED',
      category: 'CANCELED',
      retryable: false,
    },
  ])('projects a safe $name knowledge-admission failure without writing', async ({ guardResult, code, category, retryable }) => {
    const guarded = guardedToolPort(guardResult);
    const contentCanary = 'MEMORY_CONTENT_CANARY';

    const result = await invoke(guarded.port, 'add_memory', {
      category: 'FACTUAL',
      content: contentCanary,
      briefIndex: 'Guarded memory',
    });

    expect(result).toMatchObject({
      status: 'FAILED',
      safeError: { code, category, retryable },
    });
    expect(guarded.saveLongTermMemory).not.toHaveBeenCalled();
    expect(JSON.stringify(result)).not.toContain(contentCanary);
    expect(JSON.stringify(result)).not.toContain('PROVIDER_DETAIL_CANARY');
  });

  it('accepts structured FACTUAL content without repeating category inside content', async () => {
    const port = fakePort();

    const result = await invoke(port, 'add_memory', {
      category: 'FACTUAL',
      content: {
        subject: 'Northern site area',
        claim: 'Northern site area maps to Chiang Mai and Chiang Rai.',
      },
      briefIndex: 'Northern site area maps to Chiang Mai and Chiang Rai.',
    });

    expect(port.saveLongTermMemory).toHaveBeenCalledWith(
      expect.objectContaining({
        memoryType: 'FACTUAL',
        content: JSON.stringify({
          category: 'FACTUAL',
          subject: 'Northern site area',
          claim: 'Northern site area maps to Chiang Mai and Chiang Rai.',
        }),
        briefIndex: 'Northern site area maps to Chiang Mai and Chiang Rai.',
      }),
      expect.any(Object),
      expect.any(AbortSignal),
    );
    expect(result).toMatchObject({
      status: 'SUCCEEDED',
      structuredPayload: {
        outcome: 'CREATED_ACTIVE',
        nextAction: 'ACKNOWLEDGE_USER_DO_NOT_CALL_ADD_MEMORY_AGAIN',
      },
    });
  });

  it('sanitizes compatible FACTUAL alias content before saving', async () => {
    const port = fakePort();

    const result = await invoke(port, 'add_memory', {
      category: 'FACTUAL',
      content: {
        value: 'Northern site area maps to Chiang Mai and Chiang Rai.',
        unsafeExtra: 'must not be persisted',
      },
    });

    expect(port.saveLongTermMemory).toHaveBeenCalledWith(
      expect.objectContaining({
        memoryType: 'FACTUAL',
        content: JSON.stringify({
          category: 'FACTUAL',
          subject: 'Northern site area maps to Chiang Mai and Chiang Rai.',
          claim: 'Northern site area maps to Chiang Mai and Chiang Rai.',
        }),
        briefIndex: 'Northern site area maps to Chiang Mai and Chiang Rai.',
      }),
      expect.any(Object),
      expect.any(AbortSignal),
    );
    expect(result).toMatchObject({
      status: 'SUCCEEDED',
      structuredPayload: { outcome: 'CREATED_ACTIVE' },
    });
  });

  it('accepts FACTUAL string content and derives a minimal structured fact', async () => {
    const port = fakePort();

    const result = await invoke(port, 'add_memory', { category: 'FACTUAL', content: 'Northern site area maps to Chiang Mai and Chiang Rai.' });

    expect(port.saveLongTermMemory).toHaveBeenCalledWith(
      expect.objectContaining({
        memoryType: 'FACTUAL',
        content: JSON.stringify({
          category: 'FACTUAL',
          subject: 'Northern site area maps to Chiang Mai and Chiang Rai.',
          claim: 'Northern site area maps to Chiang Mai and Chiang Rai.',
        }),
        briefIndex: 'Northern site area maps to Chiang Mai and Chiang Rai.',
      }),
      expect.any(Object),
      expect.any(AbortSignal),
    );
    expect(result).toMatchObject({
      status: 'SUCCEEDED',
      structuredPayload: { outcome: 'CREATED_ACTIVE' },
    });
  });

  it('accepts PROCEDURAL string content and stores procedureText without steps', async () => {
    const port = fakePort();

    const result = await invoke(port, 'add_memory', {
      category: 'PROCEDURAL',
      briefIndex: '黑盒验证-切换失败排查流程-73395',
      content: '第一，确认链路质量；第二，核对邻区配置；第三，复测切换成功率；第四，记录异常告警。',
    });

    expect(port.saveLongTermMemory).toHaveBeenCalledWith(
      expect.objectContaining({
        memoryType: 'PROCEDURAL',
        content: JSON.stringify({
          category: 'PROCEDURAL',
          procedureName: '黑盒验证-切换失败排查流程-73395',
          procedureText: '第一，确认链路质量；第二，核对邻区配置；第三，复测切换成功率；第四，记录异常告警。',
        }),
        briefIndex: '黑盒验证-切换失败排查流程-73395',
      }),
      expect.any(Object),
      expect.any(AbortSignal),
    );
    expect(JSON.stringify(port.saveLongTermMemory.mock.calls[0]?.[0])).not.toContain('steps');
    expect(result).toMatchObject({
      status: 'SUCCEEDED',
      structuredPayload: { outcome: 'CREATED_ACTIVE' },
    });
  });

  it('accepts PROCEDURAL JSON-string content and normalizes to procedureText', async () => {
    const port = fakePort();

    const result = await invoke(port, 'add_memory', {
      category: 'PROCEDURAL',
      content: JSON.stringify({
        procedureName: '黑盒验证-切换失败排查流程-73395',
        procedureText: '先确认链路质量，再核对邻区配置，最后复测切换成功率。',
      }),
    });

    expect(port.saveLongTermMemory).toHaveBeenCalledWith(
      expect.objectContaining({
        memoryType: 'PROCEDURAL',
        content: JSON.stringify({
          category: 'PROCEDURAL',
          procedureName: '黑盒验证-切换失败排查流程-73395',
          procedureText: '先确认链路质量，再核对邻区配置，最后复测切换成功率。',
        }),
        briefIndex: '黑盒验证-切换失败排查流程-73395: 先确认链路质量，再核对邻区配置，最后复测切换成功率。',
      }),
      expect.any(Object),
      expect.any(AbortSignal),
    );
    expect(result).toMatchObject({
      status: 'SUCCEEDED',
      structuredPayload: { outcome: 'CREATED_ACTIVE' },
    });
  });

  it('returns explicit safe details for non-FACTUAL string content instead of generic schema failure', async () => {
    const port = fakePort();

    const result = await invoke(port, 'add_memory', { category: 'CONCEPTUAL', content: 'not structured' });

    expect(result).toMatchObject({
      status: 'FAILED',
      safeError: {
        code: 'MEMORY_TOOL_WRITE_INVALID',
        category: 'VALIDATION',
        safeDetails: {
          reasonCode: 'CONCEPTUAL_CONTENT_REQUIRES_STRUCTURED_OBJECT',
          expectedFields: ['category', 'concept', 'definition'],
        },
      },
    });
    expect(port.saveLongTermMemory).not.toHaveBeenCalled();
  });

  it('returns explicit safe details when add_memory execution receives category/content mismatch', async () => {
    const port = fakePort();

    const result = await executeAddMemoryDirectly(port, {
      category: 'FACTUAL',
      content: { category: 'CONCEPTUAL', concept: 'site alias', definition: 'Northern site alias.' },
    });

    expect(result).toMatchObject({
      status: 'FAILED',
      safeError: {
        code: 'MEMORY_TOOL_WRITE_INVALID',
        category: 'VALIDATION',
        safeDetails: {
          reasonCode: 'MEMORY_CONTENT_CATEGORY_MISMATCH',
          expectedCategory: 'FACTUAL',
          actualCategory: 'CONCEPTUAL',
        },
      },
    });
    expect(port.saveLongTermMemory).not.toHaveBeenCalled();
  });
});

describe('createLongTermMemoryToolPort — USER_CHARACTERISTICS keyword-miss fallback', () => {
  type Summary = ReturnType<typeof memorySummary>;
  function realPort({
    searchItems,
    listItems,
  }: {
    readonly searchItems: ReadonlyArray<{ readonly summary: Summary; readonly score: number; readonly relevanceScore: number }>;
    readonly listItems: readonly Summary[];
  }) {
    const searchLongTermMemory = vi.fn<LongTermMemoryRetrieverGateway['searchLongTermMemory']>(async () => ({
      items: searchItems as SearchItemPage['items'],
      total: searchItems.length,
      limit: 20,
      offset: 0,
    }));
    const listLongTermMemory = vi.fn<LongTermMemoryStoreGateway['listLongTermMemory']>(async () => ({
      items: listItems,
      total: listItems.length,
      limit: 20,
      offset: 0,
    }));
    const store = {
      getLongTermMemory: vi.fn(async () => safeError('LTM_ENTRY_NOT_FOUND', 'NOT_FOUND', false)),
      saveLongTermMemory: vi.fn(async () => {
        throw new Error('unused');
      }),
      manualSaveLongTermMemory: vi.fn(async () => {
        throw new Error('unused');
      }),
      deleteLongTermMemory: vi.fn(async (request: { readonly memoryId: string }) => ({ memoryId: request.memoryId })),
      listLongTermMemory,
      mutateLongTermMemory: vi.fn(async () => ({ status: 'NOT_FOUND' as const })),
    } as unknown as LongTermMemoryStoreGateway;
    const retriever = {
      searchLongTermMemory,
      getLongTermMemoryDetail: vi.fn(async () => {
        throw new Error('unused');
      }),
    } as unknown as LongTermMemoryRetrieverGateway;
    return {
      port: createLongTermMemoryToolPort({ longTermMemoryStore: store, longTermMemoryRetriever: retriever }),
      searchLongTermMemory,
      listLongTermMemory,
    };
  }

  const scope = {
    tenantId: brand<string, 'TenantId'>('tenant-memory'),
    subjectId: brand<string, 'SubjectId'>('subject-memory'),
    agentId: brand<string, 'AgentId'>('agent-memory'),
  };
  const ucSummary = memorySummary('ltm-miaow', 'USER_CHARACTERISTICS', 'prefers cat suffix');
  const factualSummary = memorySummary('ltm-fact', 'FACTUAL', 'A市 = Chicago');

  it('falls back to listing USER_CHARACTERISTICS when a keyword search matches nothing', async () => {
    const { port, searchLongTermMemory, listLongTermMemory } = realPort({ searchItems: [], listItems: [ucSummary] });
    const result = await port.searchLongTermMemory({
      ...scope,
      queryText: 'preferences',
      memoryType: 'USER_CHARACTERISTICS',
      minConfidence: 0.3,
      limit: 20,
      offset: 0,
    });
    expect(searchLongTermMemory).toHaveBeenCalledTimes(1);
    expect(listLongTermMemory).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({
      items: [expect.objectContaining({ summary: expect.objectContaining({ briefIndex: 'prefers cat suffix' }) })],
      total: 1,
    });
  });

  it('does not fall back when the USER_CHARACTERISTICS keyword search has matches', async () => {
    const { port, listLongTermMemory } = realPort({
      searchItems: [{ summary: ucSummary, score: 0.9, relevanceScore: 0.9 }],
      listItems: [ucSummary],
    });
    const result = await port.searchLongTermMemory({
      ...scope,
      queryText: 'cat',
      memoryType: 'USER_CHARACTERISTICS',
      minConfidence: 0.3,
      limit: 20,
      offset: 0,
    });
    expect(listLongTermMemory).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      items: [expect.objectContaining({ summary: expect.objectContaining({ briefIndex: 'prefers cat suffix' }) })],
      total: 1,
    });
  });

  it('does not fall back for non-USER_CHARACTERISTICS keyword misses', async () => {
    const { port, listLongTermMemory } = realPort({ searchItems: [], listItems: [factualSummary] });
    const result = await port.searchLongTermMemory({
      ...scope,
      queryText: 'nothing',
      memoryType: 'FACTUAL',
      minConfidence: 0.3,
      limit: 20,
      offset: 0,
    });
    expect(listLongTermMemory).not.toHaveBeenCalled();
    expect(result).toMatchObject({ items: [], total: 0 });
  });

  it('lists USER_CHARACTERISTICS directly when queryText is empty', async () => {
    const { port, searchLongTermMemory, listLongTermMemory } = realPort({
      searchItems: [{ summary: ucSummary, score: 0.9, relevanceScore: 0.9 }],
      listItems: [ucSummary],
    });
    const result = await port.searchLongTermMemory({
      ...scope,
      queryText: '',
      memoryType: 'USER_CHARACTERISTICS',
      minConfidence: 0.3,
      limit: 20,
      offset: 0,
    });
    expect(searchLongTermMemory).not.toHaveBeenCalled();
    expect(listLongTermMemory).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ total: 1 });
  });
});

async function invoke(port: LongTermMemoryToolPort, capabilityId: string, args: JsonObject, timeoutMs = 30_000) {
  const contribution = createMemoryToolsProvider(port);
  const descriptor = (await contribution.discovery.listAll!(new AbortController().signal)).find((item) => item.capabilityId === capabilityId);
  expect(descriptor).toBeDefined();
  if (descriptor?.inputSchema === undefined || !ajv.compile(descriptor.inputSchema)(args)) {
    return failedCapabilityInputValidation();
  }
  const executable = (contribution.discovery as ToolExecutableDiscovery).resolveExecutable(brand<string, 'CapabilityId'>(capabilityId));
  expect(executable).toBeDefined();
  const tool = executable!.tool as {
    execute: (input: JsonObject, options?: ToolExecuteOptions) => Promise<JsonObject | CapabilityInvocationResult>;
  };
  return tool.execute(args, toolOptions(timeoutMs));
}

async function executeAddMemoryDirectly(port: LongTermMemoryToolPort, args: JsonObject) {
  const definition = createMemoryToolDefinitions(port).find((item) => item.metadata.name === addMemoryCapabilityId);
  expect(definition).toBeDefined();
  return definition!.tool.execute(args, toolOptions());
}

function failedCapabilityInputValidation(): CapabilityInvocationResult {
  return {
    status: 'FAILED',
    structuredPayload: {},
    generatedMessages: [],
    artifactRefs: [],
    safeError: {
      code: 'CAPABILITY_INPUT_INVALID',
      message: 'Capability input failed validation.',
      category: 'VALIDATION',
      retryable: false,
    },
  };
}

function toolOptions(timeoutMs = 30_000): ToolExecuteOptions {
  return {
    context: {
      identityContext: {
        tenantId: brand<string, 'TenantId'>('tenant-memory'),
        subjectId: brand<string, 'SubjectId'>('subject-memory'),
        displayName: 'Memory tester',
      },
      agentId: brand<string, 'AgentId'>('agent-memory'),
      agentVersion: brand<string, 'AgentVersion'>('v1'),
      sessionId: brand<string, 'SessionId'>('session-memory'),
      requestId: brand<string, 'MessageId'>('request-memory'),
      runId: brand<string, 'RequestRunId'>('run-memory'),
      requestContextId: brand<string, 'RequestContextId'>('context-memory'),
      stepId: 'turn-1',
      toolCallId: 'tool-memory',
      timeoutMs,
    },
    signal: new AbortController().signal,
  };
}

type SearchBehavior =
  | SearchItemPage
  | SafeError
  | ((query: LongTermMemoryToolSearchQuery, signal?: AbortSignal) => Promise<SearchItemPage | SafeError> | SearchItemPage | SafeError);

function fakePort(
  options: {
    readonly search?: SearchBehavior;
    readonly detail?: (id: string) => LongTermMemoryRecord | SafeError;
    readonly save?: LongTermMemoryRecord | SafeError;
  } = {},
): LongTermMemoryToolPort & {
  readonly searchLongTermMemory: ReturnType<typeof vi.fn>;
  readonly getLongTermMemoryDetail: ReturnType<typeof vi.fn>;
  readonly saveLongTermMemory: ReturnType<typeof vi.fn>;
} {
  const saved =
    options.save ??
    memoryRecord({
      longTermMemoryId: 'ltm-saved',
      content: { category: 'USER_CHARACTERISTICS', traits: ['prefers compact tables'], purpose: ['GENERAL'] },
    });
  return {
    searchLongTermMemory: vi.fn(async (query: LongTermMemoryToolSearchQuery, signal?: AbortSignal) =>
      typeof options.search === 'function'
        ? options.search(query, signal)
        : (options.search ?? { items: [], total: 0, limit: query.limit ?? 20, offset: query.offset ?? 0 }),
    ),
    getLongTermMemoryDetail: vi.fn(
      async (input: { readonly memoryId: string }) => options.detail?.(input.memoryId) ?? safeError('LTM_ENTRY_NOT_FOUND', 'NOT_FOUND', false),
    ),
    saveLongTermMemory: vi.fn(async (_request: SaveLongTermMemoryRequest, _options?: VersionedWriteOptions) => saved),
  };
}

function guardedToolPort(guardResult: Awaited<ReturnType<GuardrailGatewayPort['checkKnowledge']>>): {
  readonly port: LongTermMemoryToolPort;
  readonly checkKnowledge: ReturnType<typeof vi.fn<GuardrailGatewayPort['checkKnowledge']>>;
  readonly saveLongTermMemory: ReturnType<typeof vi.fn<LongTermMemoryStoreGateway['saveLongTermMemory']>>;
} {
  const savedRecord = memoryRecord({
    longTermMemoryId: 'ltm-guarded',
    content: { category: 'FACTUAL', subject: 'BGP', claim: 'Approved peer.' },
  });
  const saveLongTermMemory = vi.fn<LongTermMemoryStoreGateway['saveLongTermMemory']>(async () => savedRecord);
  const store: LongTermMemoryStoreGateway = {
    getLongTermMemory: vi.fn(async () => savedRecord),
    saveLongTermMemory,
    batchCreateLongTermMemory: vi.fn(async () => ({ successCount: 1, failCount: 0, memoryIds: [savedRecord.memoryId] })),
    manualSaveLongTermMemory: vi.fn(async () => savedRecord),
    deleteLongTermMemory: vi.fn(async (request) => ({ memoryId: request.memoryId })),
    listLongTermMemory: vi.fn(async () => ({ items: [], total: 0, limit: 20, offset: 0 })),
    mutateLongTermMemory: vi.fn(async () => ({ status: 'NOT_FOUND' as const })),
  };
  const retriever: LongTermMemoryRetrieverGateway = {
    searchLongTermMemory: vi.fn(async () => ({ items: [], total: 0, limit: 20, offset: 0 })),
    getLongTermMemoryDetail: vi.fn(async () => savedRecord),
  };
  const checkKnowledge = vi.fn<GuardrailGatewayPort['checkKnowledge']>(async () => guardResult);
  const guardrail: GuardrailGatewayPort = {
    checkQuestion: vi.fn(async () => ({ isLegal: true, refusalMessage: '' })),
    checkAnswer: vi.fn(async () => ({ isLegal: true, refusalMessage: '' })),
    checkNl2Python: vi.fn(async () => ({ status: true, errorMsg: [] })),
    checkKnowledge,
  };
  return {
    port: createLongTermMemoryToolPort({ longTermMemoryStore: store, longTermMemoryRetriever: retriever }, { guardrail }),
    checkKnowledge,
    saveLongTermMemory,
  };
}

function memoryRecord(input: {
  readonly longTermMemoryId: string;
  readonly content: MemoryContentByCategory;
  readonly source?: string;
}): LongTermMemoryRecord {
  return {
    tenantId: brand<string, 'TenantId'>('tenant-memory'),
    subjectId: brand<string, 'SubjectId'>('subject-memory'),
    agentId: brand<string, 'AgentId'>('agent-memory'),
    memoryId: brand<string, 'LongTermMemoryId'>(input.longTermMemoryId),
    memoryInstance: 'default',
    version: 1,
    memoryType: input.content.category,
    knowledgeSourceType: 'CONFIGURED',
    sharingState: 'PRIVATE',
    confidence: 0.8,
    state: 'ACTIVE',
    labels: ['network'],
    briefIndex: 'memory brief',
    content: JSON.stringify(input.content),
    source: input.source ?? JSON.stringify({ sessionId: brand<string, 'SessionId'>('session-memory') }),
    accessCount: 0,
    recallCount: 0,
    extractionCount: 0,
    archivedAt: brand<number, 'EpochMillis'>(0),
    archiveReason: '',
    isPinned: false,
    createTime: brand<number, 'EpochMillis'>(100),
    updateTime: brand<number, 'EpochMillis'>(100),
  };
}

function memorySummary(
  memoryId: string,
  memoryType: LongTermMemoryRecord['memoryType'],
  briefIndex: string,
  createTime = 100,
): SearchItemPage['items'][number]['summary'] {
  return {
    memoryId: brand<string, 'LongTermMemoryId'>(memoryId),
    memoryType,
    knowledgeSourceType: 'LEARNED',
    state: 'ACTIVE',
    briefIndex,
    content: JSON.stringify({ category: memoryType }),
    labels: ['network'],
    confidence: 0.8,
    isPinned: false,
    accessCount: 0,
    createTime: brand<number, 'EpochMillis'>(createTime),
    updateTime: brand<number, 'EpochMillis'>(createTime),
    version: 1,
  };
}

function safeError(code: string, category: SafeError['category'], retryable: boolean, message = `${code} safe error.`): SafeError {
  return { code, category, retryable, message };
}
