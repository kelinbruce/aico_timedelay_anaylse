import { brand, type AgentId, type AgentVersion, type SubjectId, type TenantId } from '@nextagent/agent-common';
import type { AgentAssembly, AgentAssemblyRegistry } from '@nextagent/agent-contracts/agent-assembly';
import type {
  UserQuestionActivityRecord,
  UserQuestionActivityStoreGateway,
  ConversationAnnotationStoreGateway,
} from '@nextagent/agent-contracts/gateway';
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

describe('FrequentQuestionService', () => {
  it('returns empty list when catalog and DB are empty', async () => {
    const service = createFrequentQuestionService({
      categoryCatalog: makeDiscovery(undefined),
      assemblyRegistry: makeAssemblyRegistry(),
      annotations: makeAnnotations([]),
      activityStore: makeActivityStore(),
      frequencyThreshold: 8,
      deploymentMode: 'LOCAL',
    });
    const result = await service.listFrequentQuestions({
      tenantId: TENANT_ID,
      subjectId: SUBJECT_ID,
      agentId: AGENT_ID,
    });
    expect(result.questions).toHaveLength(0);
  });

  it('orders: fixed -> pinned -> high-freq -> non-fixed', async () => {
    const catalog = {
      agentId: AGENT_ID,
      locale: 'zh',
      categories: [
        {
          name: 'cat1',
          mode: 'direct',
          questions: [
            { text: 'fixed-q', fixed: true, hash: 'h-fixed' },
            { text: 'non-fixed-q', fixed: false, hash: 'h-nonfixed' },
          ],
          subCategories: [],
        },
      ],
    };
    const highFreq = [makeActivityRecord({ questionHash: 'h-highfreq', questionText: 'highfreq-q', askFrequency: 10 })];
    const service = createFrequentQuestionService({
      categoryCatalog: makeDiscovery(catalog),
      assemblyRegistry: makeAssemblyRegistry(),
      annotations: makeAnnotations(['pinned-q']),
      activityStore: makeActivityStore(highFreq),
      frequencyThreshold: 8,
      deploymentMode: 'LOCAL',
    });
    const result = await service.listFrequentQuestions({
      tenantId: TENANT_ID,
      subjectId: SUBJECT_ID,
      agentId: AGENT_ID,
    });
    expect(result.questions.map((q) => q.text)).toEqual(['fixed-q', 'pinned-q', 'highfreq-q', 'non-fixed-q']);
  });

  it('deduplicates by question_hash', async () => {
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
    const service = createFrequentQuestionService({
      categoryCatalog: makeDiscovery(catalog),
      assemblyRegistry: makeAssemblyRegistry(),
      annotations: makeAnnotations(['shared-q']),
      activityStore: makeActivityStore(),
      frequencyThreshold: 8,
      deploymentMode: 'LOCAL',
    });
    const result = await service.listFrequentQuestions({
      tenantId: TENANT_ID,
      subjectId: SUBJECT_ID,
      agentId: AGENT_ID,
    });
    expect(result.questions).toHaveLength(1);
    expect(result.questions[0]!.text).toBe('shared-q');
  });

  it('returns only pinned when catalog is empty', async () => {
    const service = createFrequentQuestionService({
      categoryCatalog: makeDiscovery(undefined),
      assemblyRegistry: makeAssemblyRegistry(),
      annotations: makeAnnotations(['p1', 'p2']),
      activityStore: makeActivityStore(),
      frequencyThreshold: 8,
      deploymentMode: 'LOCAL',
    });
    const result = await service.listFrequentQuestions({
      tenantId: TENANT_ID,
      subjectId: SUBJECT_ID,
      agentId: AGENT_ID,
    });
    expect(result.questions).toHaveLength(2);
  });
  it('returns full canonical locale, not path-normalized language code', async () => {
    const service = createFrequentQuestionService({
      categoryCatalog: makeDiscovery(undefined),
      assemblyRegistry: makeAssemblyRegistry(),
      annotations: makeAnnotations([]),
      activityStore: makeActivityStore(),
      frequencyThreshold: 8,
      deploymentMode: 'LOCAL',
    });
    const result = await service.listFrequentQuestions({
      tenantId: TENANT_ID,
      subjectId: SUBJECT_ID,
      agentId: AGENT_ID,
      locale: 'zh-CN',
    });
    expect(result.locale).toBe('zh-CN');
  });
});
