import { brand } from '@nextagent/agent-common';
import {
  listFrequentHistoryQuestionsRequestSchema,
  listFrequentHistoryQuestionsResultSchema,
  recommendSimilarPresetQuestionsRequestSchema,
  recommendSimilarPresetQuestionsResultSchema,
  type ListFrequentHistoryQuestionsRequest,
  type QuestionRecommendationGateway,
  type RecommendSimilarPresetQuestionsRequest,
  type WorkingMemoryGatewayBindings,
} from '@nextagent/agent-contracts/gateway';
import { Ajv } from 'ajv/dist/ajv.js';
import { describe, expect, it } from 'vitest';

const frequentRequest = {
  tenantId: brand<string, 'TenantId'>('tenant-1'),
  subjectId: brand<string, 'SubjectId'>('subject-1'),
  agentId: brand<string, 'AgentId'>('agent-1'),
  limit: 5,
  locale: brand<string, 'RequestLocale'>('zh-CN'),
} satisfies ListFrequentHistoryQuestionsRequest;

const similarRequest = {
  tenantId: brand<string, 'TenantId'>('tenant-1'),
  subjectId: brand<string, 'SubjectId'>('subject-1'),
  agentId: brand<string, 'AgentId'>('agent-1'),
  query: '如何处理 UPF 会话建立超时？',
  limit: 10,
  locale: brand<string, 'RequestLocale'>('zh-CN'),
  product: '5G-Core',
  domain: 'packet-core',
  scene: 'fault-diagnosis',
} satisfies RecommendSimilarPresetQuestionsRequest;

const gateway = {
  async listFrequentHistoryQuestions() {
    return { questions: [] };
  },
  async recommendSimilarPresetQuestions() {
    return { questions: [] };
  },
} satisfies QuestionRecommendationGateway;

const configuredBinding = {
  questionRecommendations: gateway,
} satisfies Pick<WorkingMemoryGatewayBindings, 'questionRecommendations'>;

const unconfiguredBinding = {} satisfies Pick<WorkingMemoryGatewayBindings, 'questionRecommendations'>;

describe('question recommendation gateway contract', () => {
  const ajv = new Ajv({ allErrors: true });

  it('exposes the gateway only as an optional Working Memory binding', () => {
    expect(configuredBinding.questionRecommendations).toBe(gateway);
    expect('questionRecommendations' in unconfiguredBinding).toBe(false);
  });

  it('validates frequent history question request boundaries', () => {
    const validate = ajv.compile(listFrequentHistoryQuestionsRequestSchema);

    expect(validate(frequentRequest)).toBe(true);
    expect(validate({ ...frequentRequest, limit: 1, locale: 'z' })).toBe(true);
    expect(validate({ ...frequentRequest, limit: 10, locale: 'x'.repeat(10) })).toBe(true);
    expect(
      validate({
        tenantId: frequentRequest.tenantId,
        subjectId: frequentRequest.subjectId,
        agentId: frequentRequest.agentId,
        limit: frequentRequest.limit,
      }),
    ).toBe(true);

    for (const invalid of [
      { ...frequentRequest, tenantId: '' },
      { ...frequentRequest, subjectId: '' },
      { ...frequentRequest, agentId: '' },
      { ...frequentRequest, limit: 0 },
      { ...frequentRequest, limit: 11 },
      { ...frequentRequest, limit: 1.5 },
      { ...frequentRequest, locale: '' },
      { ...frequentRequest, locale: 'x'.repeat(11) },
      { ...frequentRequest, portraitType: ['QUESTION'] },
    ]) {
      expect(validate(invalid), JSON.stringify(invalid)).toBe(false);
    }
  });

  it('validates frequent history question success results', () => {
    const validate = ajv.compile(listFrequentHistoryQuestionsResultSchema);
    const validItem = { content: '如何处理 UPF 会话建立超时？', frequency: 0 };

    expect(validate({ questions: [] })).toBe(true);
    expect(validate({ questions: [validItem, { ...validItem, frequency: 2_147_483_647 }] })).toBe(true);
    expect(validate({ questions: Array.from({ length: 10 }, () => validItem) })).toBe(true);

    for (const invalid of [
      {},
      { questions: undefined },
      { questions: [{ ...validItem, content: '' }] },
      { questions: [{ ...validItem, frequency: -1 }] },
      { questions: [{ ...validItem, frequency: 1.5 }] },
      { questions: [{ ...validItem, frequency: 2_147_483_648 }] },
      { questions: Array.from({ length: 11 }, () => validItem) },
      { questions: [{ ...validItem, count: 1 }] },
    ]) {
      expect(validate(invalid), JSON.stringify(invalid)).toBe(false);
    }
  });

  it('validates similar preset question request boundaries', () => {
    const validate = ajv.compile(recommendSimilarPresetQuestionsRequestSchema);

    expect(validate(similarRequest)).toBe(true);
    expect(
      validate({
        tenantId: similarRequest.tenantId,
        subjectId: similarRequest.subjectId,
        agentId: similarRequest.agentId,
        query: 'x',
        limit: 1,
      }),
    ).toBe(true);
    expect(
      validate({
        ...similarRequest,
        query: 'x'.repeat(512),
        limit: 20,
        locale: 'x'.repeat(10),
        product: 'x'.repeat(64),
        domain: 'x'.repeat(128),
        scene: 'x'.repeat(128),
      }),
    ).toBe(true);

    for (const invalid of [
      { ...similarRequest, query: '' },
      { ...similarRequest, query: 'x'.repeat(513) },
      { ...similarRequest, limit: 0 },
      { ...similarRequest, limit: 21 },
      { ...similarRequest, limit: 1.5 },
      { ...similarRequest, locale: '' },
      { ...similarRequest, product: 'UPF core' },
      { ...similarRequest, product: 'x'.repeat(65) },
      { ...similarRequest, domain: '' },
      { ...similarRequest, scene: 'x'.repeat(129) },
      { ...similarRequest, topn: 10 },
    ]) {
      expect(validate(invalid), JSON.stringify(invalid)).toBe(false);
    }
  });

  it('validates similar preset question success results', () => {
    const validate = ajv.compile(recommendSimilarPresetQuestionsResultSchema);
    const validItem = { questionId: 'question-1', content: '如何检查 UPF 路由？' };

    expect(validate({ questions: [] })).toBe(true);
    expect(validate({ questions: Array.from({ length: 20 }, () => validItem) })).toBe(true);

    for (const invalid of [
      {},
      { questions: undefined },
      { questions: [{ ...validItem, questionId: '' }] },
      { questions: [{ ...validItem, content: '' }] },
      { questions: Array.from({ length: 21 }, () => validItem) },
      { questions: [{ ...validItem, agentName: 'agent-1' }] },
      { questions: [], errorCode: '0' },
    ]) {
      expect(validate(invalid), JSON.stringify(invalid)).toBe(false);
    }
  });
});
