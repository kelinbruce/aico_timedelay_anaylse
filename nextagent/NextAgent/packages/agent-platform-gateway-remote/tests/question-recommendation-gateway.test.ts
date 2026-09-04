import { brand, type SafeError } from '@nextagent/agent-common';
import type { ListFrequentHistoryQuestionsRequest, RecommendSimilarPresetQuestionsRequest } from '@nextagent/agent-contracts/gateway';
import { createReferenceRemoteQuestionRecommendationGateway, type ReferenceRemoteQuestionRecommendationClient } from '../src/index.js';
import { describe, expect, it, vi } from 'vitest';

function frequentRequest(overrides: Partial<ListFrequentHistoryQuestionsRequest> = {}): ListFrequentHistoryQuestionsRequest {
  return {
    tenantId: brand<string, 'TenantId'>('tenant-1'),
    subjectId: brand<string, 'SubjectId'>('subject-1'),
    agentId: brand<string, 'AgentId'>('agent-1'),
    limit: 2,
    locale: 'zh-CN' as never,
    ...overrides,
  };
}

function similarRequest(overrides: Partial<RecommendSimilarPresetQuestionsRequest> = {}): RecommendSimilarPresetQuestionsRequest {
  return {
    tenantId: brand<string, 'TenantId'>('tenant-1'),
    subjectId: brand<string, 'SubjectId'>('subject-1'),
    agentId: brand<string, 'AgentId'>('agent-1'),
    query: '告警关联分析',
    limit: 2,
    ...overrides,
  };
}

function client(overrides: Partial<ReferenceRemoteQuestionRecommendationClient> = {}): ReferenceRemoteQuestionRecommendationClient {
  return {
    async listFrequentHistoryQuestions() {
      return {};
    },
    async recommendSimilarPresetQuestions() {
      return {};
    },
    ...overrides,
  };
}

function expectSafeError(result: unknown, code: string): void {
  expect(result).toMatchObject({
    code,
    category: expect.any(String),
    retryable: expect.any(Boolean),
  } satisfies Partial<SafeError>);
}

describe('reference remote question recommendation gateway', () => {
  it('maps provider responses, propagates scope headers and truncates to the canonical limit', async () => {
    const frequentCall = vi.fn(async () => ({
      questions: [
        { value: '问题一', count: 9 },
        { value: '问题二', count: 8 },
        { value: '问题三', count: 7 },
      ],
    }));
    const similarCall = vi.fn(async () => ({
      data: [
        { questionId: 'q-1', content: '相似问题一' },
        { questionId: 'q-2', content: '相似问题二' },
        { questionId: 'q-3', content: '相似问题三' },
      ],
    }));
    const gateway = createReferenceRemoteQuestionRecommendationGateway(
      client({
        listFrequentHistoryQuestions: frequentCall,
        recommendSimilarPresetQuestions: similarCall,
      }),
    );
    const signal = new AbortController().signal;

    await expect(gateway.listFrequentHistoryQuestions(frequentRequest(), signal)).resolves.toEqual({
      questions: [
        { content: '问题一', frequency: 9 },
        { content: '问题二', frequency: 8 },
      ],
    });
    await expect(gateway.recommendSimilarPresetQuestions(similarRequest(), signal)).resolves.toEqual({
      questions: [
        { questionId: 'q-1', content: '相似问题一' },
        { questionId: 'q-2', content: '相似问题二' },
      ],
    });
    expect(frequentCall).toHaveBeenCalledWith(
      {
        tenantId: 'tenant-1',
        userId: 'subject-1',
        agentId: 'agent-1',
        searchCriteria: { questionTopN: 2 },
        portraitType: ['QUESTION'],
      },
      { 'system-language': 'zh-CN' },
      signal,
    );
    expect(similarCall).toHaveBeenCalledWith(
      {
        query: '告警关联分析',
        topn: 2,
      },
      signal,
    );
  });

  it('normalizes omitted provider collections to empty canonical results', async () => {
    const gateway = createReferenceRemoteQuestionRecommendationGateway(client());

    await expect(gateway.listFrequentHistoryQuestions(frequentRequest())).resolves.toEqual({
      questions: [],
    });
    await expect(gateway.recommendSimilarPresetQuestions(similarRequest())).resolves.toEqual({
      questions: [],
    });
  });

  it.each([
    ['frequent non-array', { questions: {} }, 'frequent'],
    ['frequent invalid item', { questions: [{ value: '问题', count: '9' }] }, 'frequent'],
    ['similar non-array', { data: {} }, 'similar'],
    ['similar invalid item', { data: [{ questionId: '', content: '问题' }] }, 'similar'],
  ] as const)('returns a safe error for malformed provider result: %s', async (_name, raw, method) => {
    const gateway = createReferenceRemoteQuestionRecommendationGateway(
      client({
        async listFrequentHistoryQuestions() {
          return raw;
        },
        async recommendSimilarPresetQuestions() {
          return raw;
        },
      }),
    );

    const result =
      method === 'frequent'
        ? await gateway.listFrequentHistoryQuestions(frequentRequest())
        : await gateway.recommendSimilarPresetQuestions(similarRequest());

    expectSafeError(result, 'QUESTION_RECOMMENDATION_INVALID_PROVIDER_RESULT');
  });

  it('rejects invalid canonical input before invoking the provider', async () => {
    const frequentCall = vi.fn();
    const gateway = createReferenceRemoteQuestionRecommendationGateway(
      client({
        listFrequentHistoryQuestions: frequentCall,
      }),
    );

    const result = await gateway.listFrequentHistoryQuestions({
      ...frequentRequest(),
      limit: 0,
    });

    expectSafeError(result, 'QUESTION_RECOMMENDATION_INVALID_INPUT');
    expect(frequentCall).not.toHaveBeenCalled();
  });

  it('propagates cancellation and maps provider failures without raw detail', async () => {
    const provider = vi.fn(async () => {
      throw new Error('token=secret https://provider.internal/questions');
    });
    const gateway = createReferenceRemoteQuestionRecommendationGateway(
      client({
        listFrequentHistoryQuestions: provider,
      }),
    );
    const controller = new AbortController();
    controller.abort();

    const canceled = await gateway.listFrequentHistoryQuestions(frequentRequest(), controller.signal);
    expectSafeError(canceled, 'QUESTION_RECOMMENDATION_CANCELED');
    expect(provider).not.toHaveBeenCalled();

    const unavailable = await gateway.listFrequentHistoryQuestions(frequentRequest());
    expectSafeError(unavailable, 'QUESTION_RECOMMENDATION_UNAVAILABLE');
    expect(JSON.stringify(unavailable)).not.toContain('secret');
    expect(JSON.stringify(unavailable)).not.toContain('provider.internal');
  });

  it('returns canceled when either provider call is aborted in flight', async () => {
    const frequentController = new AbortController();
    const similarController = new AbortController();
    const gateway = createReferenceRemoteQuestionRecommendationGateway({
      async listFrequentHistoryQuestions() {
        frequentController.abort();
        return { questions: [{ value: 'ignored', count: 1 }] };
      },
      async recommendSimilarPresetQuestions() {
        similarController.abort();
        return { data: [{ questionId: 'ignored', content: 'ignored' }] };
      },
    });

    const frequent = await gateway.listFrequentHistoryQuestions(frequentRequest(), frequentController.signal);
    const similar = await gateway.recommendSimilarPresetQuestions(similarRequest(), similarController.signal);

    expectSafeError(frequent, 'QUESTION_RECOMMENDATION_CANCELED');
    expectSafeError(similar, 'QUESTION_RECOMMENDATION_CANCELED');
  });
});
