import { brand, type AgentId, type AgentVersion, type EpochMillis, type SubjectId, type TenantId } from '@nextagent/agent-common';
import type { SafeError } from '@nextagent/agent-common';
import type { AgentAssembly, AgentAssemblyRegistry } from '@nextagent/agent-contracts/agent-assembly';
import type { UserQuestionActivityRecord, UserQuestionActivityStoreGateway } from '@nextagent/agent-contracts/gateway';
import type { ConversationAnnotationStoreGateway } from '@nextagent/agent-contracts/gateway';
import type { RuntimeConversationAnnotationPort, ConversationFavoriteTurnPage } from '@nextagent/agent-contracts/runtime';
import { createFrequentQuestionService, computeQuestionHash, type CategoryQuestionCatalogPort } from '@nextagent/agent-session';
import { describe, expect, it, vi } from 'vitest';

const AGENT_ID = brand<string, 'AgentId'>('default-agent');
const TENANT_ID = brand<string, 'TenantId'>('T1');
const SUBJECT_ID = brand<string, 'SubjectId'>('U1');

function makeActivityRecord(overrides: Partial<UserQuestionActivityRecord> = {}): UserQuestionActivityRecord {
  const now = brand<number, 'EpochMillis'>(Date.now());
  return {
    tenantId: TENANT_ID,
    subjectId: SUBJECT_ID,
    agentId: AGENT_ID,
    questionHash: '',
    questionText: '',
    locale: 'zh-CN',
    isPinned: false,
    pinnedAt: null,
    askFrequency: 0,
    lastAskedAt: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function makeAssemblyRegistry(): AgentAssemblyRegistry {
  return {
    active: vi.fn(
      async () =>
        ({
          agentId: AGENT_ID,
          agentVersion: brand<string, 'AgentVersion'>('1.0.0'),
          agentAssemblyRef: 'ref',
          capabilityBindings: [],
        }) as unknown as AgentAssembly,
    ),
  } as unknown as AgentAssemblyRegistry;
}

function makeDiscovery(catalog: unknown): CategoryQuestionCatalogPort {
  return {
    loadCatalog: vi.fn(async () => catalog),
  } as unknown as CategoryQuestionCatalogPort;
}

function makeActivityStore(highFreq: readonly UserQuestionActivityRecord[] = []): UserQuestionActivityStoreGateway {
  return {
    upsertActivity: vi.fn(async (r) => r),
    listHighFrequency: vi.fn(async () => highFreq),
  };
}

function makeAnnotationStore(): ConversationAnnotationStoreGateway {
  return {
    saveAnnotation: vi.fn(),
    deleteAnnotationsByRun: vi.fn(),
    listFavoriteTurns: vi.fn(async () => []),
    listQuestionFavoriteTurns: vi.fn(async () => []),
    listSessionAnnotations: vi.fn(async () => []),
  } as unknown as ConversationAnnotationStoreGateway;
}

function makeAnnotations(pinnedTexts: readonly string[] = []): RuntimeConversationAnnotationPort {
  const page: ConversationFavoriteTurnPage = {
    entries: pinnedTexts.map((text, i) => ({
      sessionId: brand<string, 'SessionId'>('S1'),
      requestRunId: brand<string, 'RequestRunId'>(`R${i}`),
      rootMessageId: brand<string, 'MessageId'>(`M${i}`),
      questionPreview: text,
      questionTruncated: false,
      sessionTitle: 'Untitled session',
      sessionUpdatedAt: brand<number, 'EpochMillis'>(0),
      favoritedAt: brand<number, 'EpochMillis'>(100),
    })),
    offset: 0,
    limit: 100,
    hasMore: false,
  };
  return {
    upsertAnnotation: vi.fn(),
    listFavoriteTurns: vi.fn(),
    listQuestionFavoriteTurns: vi.fn(async () => page),
    listSessionAnnotations: vi.fn(),
  } as unknown as RuntimeConversationAnnotationPort;
}

function makeService(
  pinned: readonly UserQuestionActivityRecord[] = [],
  highFreq: readonly UserQuestionActivityRecord[] = [],
  catalog: unknown = undefined,
) {
  return createFrequentQuestionService({
    categoryCatalog: makeDiscovery(catalog),
    assemblyRegistry: makeAssemblyRegistry(),
    annotations: makeAnnotations(pinned.map((r) => r.questionText)),
    activityStore: makeActivityStore(highFreq),
    frequencyThreshold: 8,
    deploymentMode: 'LOCAL',
  });
}

describe('QuestionAssociationService', () => {
  it('returns empty list when no data sources match keyword', async () => {
    const service = makeService();
    const result = await service.listQuestionAssociations!({
      tenantId: TENANT_ID,
      subjectId: SUBJECT_ID,
      agentId: AGENT_ID,
      keyword: 'nomatch',
    });
    expect(result.questions).toHaveLength(0);
  });

  it('filters by case-insensitive substring', async () => {
    const pinned = [makeActivityRecord({ questionHash: 'h1', questionText: 'Check Alarm Rules', isPinned: true })];
    const service = makeService(pinned, []);
    const result = await service.listQuestionAssociations!({
      tenantId: TENANT_ID,
      subjectId: SUBJECT_ID,
      agentId: AGENT_ID,
      keyword: 'alarm',
    });
    expect(result.questions).toHaveLength(1);
    expect(result.questions[0]!.text).toBe('Check Alarm Rules');
    expect(result.questions[0]!.source).toBe('pinned');
  });

  it('orders: pinned -> high-frequency -> static', async () => {
    const catalog = {
      agentId: AGENT_ID,
      locale: 'zh',
      categories: [
        {
          name: 'cat1',
          mode: 'direct',
          questions: [{ text: '告警推荐', fixed: true, hash: 'h-static' }],
          subCategories: [],
        },
      ],
    };
    const pinned = [makeActivityRecord({ questionHash: 'h-pinned', questionText: '告警收藏', isPinned: true })];
    const highFreq = [makeActivityRecord({ questionHash: 'h-freq', questionText: '告警高频', askFrequency: 10 })];
    const service = makeService(pinned, highFreq, catalog);
    const result = await service.listQuestionAssociations!({
      tenantId: TENANT_ID,
      subjectId: SUBJECT_ID,
      agentId: AGENT_ID,
      keyword: '告警',
    });
    expect(result.questions.map((q) => ({ text: q.text, source: q.source }))).toEqual([
      { text: '告警收藏', source: 'pinned' },
      { text: '告警高频', source: 'high-frequency' },
      { text: '告警推荐', source: 'static' },
    ]);
  });

  it('deduplicates by hash with highest priority source', async () => {
    const catalog = {
      agentId: AGENT_ID,
      locale: 'zh',
      categories: [
        {
          name: 'cat1',
          mode: 'direct',
          questions: [{ text: 'shared-q', fixed: true, hash: computeQuestionHash('shared-q') }],
          subCategories: [],
        },
      ],
    };
    const pinned = [makeActivityRecord({ questionHash: 'h-shared', questionText: 'shared-q', isPinned: true })];
    const highFreq = [makeActivityRecord({ questionHash: 'h-shared', questionText: 'shared-q', askFrequency: 10 })];
    const service = makeService(pinned, highFreq, catalog);
    const result = await service.listQuestionAssociations!({
      tenantId: TENANT_ID,
      subjectId: SUBJECT_ID,
      agentId: AGENT_ID,
      keyword: 'shared',
    });
    expect(result.questions).toHaveLength(1);
    expect(result.questions[0]!.source).toBe('pinned');
  });

  it('static with high-frequency duplicate keeps high-frequency source', async () => {
    const catalog = {
      agentId: AGENT_ID,
      locale: 'zh',
      categories: [
        {
          name: 'cat1',
          mode: 'direct',
          questions: [{ text: 'dup-q', fixed: true, hash: computeQuestionHash('dup-q') }],
          subCategories: [],
        },
      ],
    };
    const highFreq = [makeActivityRecord({ questionHash: 'h-dup', questionText: 'dup-q', askFrequency: 10 })];
    const service = makeService([], highFreq, catalog);
    const result = await service.listQuestionAssociations!({
      tenantId: TENANT_ID,
      subjectId: SUBJECT_ID,
      agentId: AGENT_ID,
      keyword: 'dup',
    });
    expect(result.questions).toHaveLength(1);
    expect(result.questions[0]!.source).toBe('high-frequency');
  });

  it('applies cap cascade: 10 pinned + 5 freq + 5 static = 20', async () => {
    const pinned = Array.from({ length: 15 }, (_, i) => makeActivityRecord({ questionHash: `hp${i}`, questionText: `match-p${i}`, isPinned: true }));
    const highFreq = Array.from({ length: 10 }, (_, i) =>
      makeActivityRecord({ questionHash: `hf${i}`, questionText: `match-f${i}`, askFrequency: 10 }),
    );
    const catalog = {
      agentId: AGENT_ID,
      locale: 'zh',
      categories: [
        {
          name: 'cat1',
          mode: 'direct',
          questions: Array.from({ length: 10 }, (_, i) => ({ text: `match-s${i}`, fixed: true, hash: `hs${i}` })),
          subCategories: [],
        },
      ],
    };
    const service = makeService(pinned, highFreq, catalog);
    const result = await service.listQuestionAssociations!({
      tenantId: TENANT_ID,
      subjectId: SUBJECT_ID,
      agentId: AGENT_ID,
      keyword: 'match',
    });
    expect(result.questions).toHaveLength(20);
    const pinnedCount = result.questions.filter((q) => q.source === 'pinned').length;
    const freqCount = result.questions.filter((q) => q.source === 'high-frequency').length;
    const staticCount = result.questions.filter((q) => q.source === 'static').length;
    expect(pinnedCount).toBe(10);
    expect(freqCount).toBe(5);
    expect(staticCount).toBe(5);
  });

  it('backfills remaining slots when pinned is short', async () => {
    const pinned = Array.from({ length: 3 }, (_, i) => makeActivityRecord({ questionHash: `hp${i}`, questionText: `match-p${i}`, isPinned: true }));
    const highFreq = Array.from({ length: 10 }, (_, i) =>
      makeActivityRecord({ questionHash: `hf${i}`, questionText: `match-f${i}`, askFrequency: 10 }),
    );
    const catalog = {
      agentId: AGENT_ID,
      locale: 'zh',
      categories: [
        {
          name: 'cat1',
          mode: 'direct',
          questions: Array.from({ length: 30 }, (_, i) => ({ text: `match-s${i}`, fixed: true, hash: `hs${i}` })),
          subCategories: [],
        },
      ],
    };
    const service = makeService(pinned, highFreq, catalog);
    const result = await service.listQuestionAssociations!({
      tenantId: TENANT_ID,
      subjectId: SUBJECT_ID,
      agentId: AGENT_ID,
      keyword: 'match',
    });
    expect(result.questions).toHaveLength(20);
    const pinnedCount = result.questions.filter((q) => q.source === 'pinned').length;
    const freqCount = result.questions.filter((q) => q.source === 'high-frequency').length;
    const staticCount = result.questions.filter((q) => q.source === 'static').length;
    expect(pinnedCount).toBe(3);
    // 5 from initial cap + 5 backfill = 10
    expect(freqCount).toBe(10);
    // 5 from initial cap + 2 backfill = 7
    expect(staticCount).toBe(7);
  });

  it('does not pad when total matches < 20', async () => {
    const pinned = [makeActivityRecord({ questionHash: 'h1', questionText: 'match1', isPinned: true })];
    const service = makeService(pinned, []);
    const result = await service.listQuestionAssociations!({
      tenantId: TENANT_ID,
      subjectId: SUBJECT_ID,
      agentId: AGENT_ID,
      keyword: 'match',
    });
    expect(result.questions).toHaveLength(1);
  });

  it('degrades SafeError to empty array for pinned and high-freq', async () => {
    const safeError: SafeError = { code: 'STORE_UNAVAILABLE', message: 'store unavailable', category: 'UNAVAILABLE' as const, retryable: false };
    const activityStore: UserQuestionActivityStoreGateway = {
      upsertActivity: vi.fn(),
      listHighFrequency: vi.fn(async () => safeError),
    };
    const catalog = {
      agentId: AGENT_ID,
      locale: 'zh',
      categories: [
        {
          name: 'cat1',
          mode: 'direct',
          questions: [{ text: 'match-static', fixed: true, hash: 'h-static' }],
          subCategories: [],
        },
      ],
    };
    const service = createFrequentQuestionService({
      categoryCatalog: makeDiscovery(catalog),
      assemblyRegistry: makeAssemblyRegistry(),
      annotations: makeAnnotations([]),
      activityStore,
      frequencyThreshold: 8,
      deploymentMode: 'LOCAL',
    });
    const result = await service.listQuestionAssociations!({
      tenantId: TENANT_ID,
      subjectId: SUBJECT_ID,
      agentId: AGENT_ID,
      keyword: 'match',
    });
    expect(result.questions).toHaveLength(1);
    expect(result.questions[0]!.source).toBe('static');
  });

  it('does not filter pinned and high-frequency by locale', async () => {
    const pinned = [makeActivityRecord({ questionHash: 'h1', questionText: 'match-pinned', isPinned: true, locale: 'en-US' })];
    const service = makeService(pinned, []);
    const result = await service.listQuestionAssociations!({
      tenantId: TENANT_ID,
      subjectId: SUBJECT_ID,
      agentId: AGENT_ID,
      keyword: 'match',
      locale: 'zh-CN',
    });
    expect(result.questions).toHaveLength(1);
    expect(result.questions[0]!.source).toBe('pinned');
  });
  it('returns full canonical locale, not path-normalized language code', async () => {
    const service = makeService();
    const result = await service.listQuestionAssociations!({
      tenantId: TENANT_ID,
      subjectId: SUBJECT_ID,
      agentId: AGENT_ID,
      keyword: 'nomatch',
      locale: 'zh-CN',
    });
    expect(result.locale).toBe('zh-CN');
  });
  it('defaults locale to zh-CN when omitted', async () => {
    const service = makeService();
    const result = await service.listQuestionAssociations!({
      tenantId: TENANT_ID,
      subjectId: SUBJECT_ID,
      agentId: AGENT_ID,
      keyword: 'nomatch',
    });
    expect(result.locale).toBe('zh-CN');
  });
});
