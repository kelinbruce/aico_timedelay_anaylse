import type { SafeError } from '@nextagent/agent-common';
import {
  listFrequentHistoryQuestionsRequestSchema,
  listFrequentHistoryQuestionsResultSchema,
  recommendSimilarPresetQuestionsRequestSchema,
  recommendSimilarPresetQuestionsResultSchema,
  type FrequentHistoryQuestion,
  type ListFrequentHistoryQuestionsRequest,
  type ListFrequentHistoryQuestionsResult,
  type PresetQuestionRecommendation,
  type QuestionRecommendationGateway,
  type RecommendSimilarPresetQuestionsRequest,
  type RecommendSimilarPresetQuestionsResult,
} from '@nextagent/agent-contracts/gateway';
import { Ajv } from 'ajv/dist/ajv.js';
import type { ValidateFunction } from 'ajv';

const ajv = new Ajv({ allErrors: true, strict: false });

const validateFrequentRequest = ajv.compile(listFrequentHistoryQuestionsRequestSchema);
const validateFrequentResult = ajv.compile(listFrequentHistoryQuestionsResultSchema);
const validateSimilarRequest = ajv.compile(recommendSimilarPresetQuestionsRequestSchema);
const validateSimilarResult = ajv.compile(recommendSimilarPresetQuestionsResultSchema);
const validateFrequentProviderResult = ajv.compile({
  type: 'object',
  properties: {
    questions: {
      type: 'array',
      items: {
        type: 'object',
        required: ['value', 'count'],
        properties: {
          value: { type: 'string', minLength: 1 },
          count: { type: 'integer', minimum: 0, maximum: 2_147_483_647 },
        },
      },
    },
  },
});
const validateSimilarProviderResult = ajv.compile({
  type: 'object',
  properties: {
    data: {
      type: 'array',
      items: {
        type: 'object',
        required: ['questionId', 'content'],
        properties: {
          questionId: { type: 'string', minLength: 1 },
          content: { type: 'string', minLength: 1 },
        },
      },
    },
  },
});

export interface ReferenceRemoteQuestionRecommendationClient {
  listFrequentHistoryQuestions: (request: unknown, headers: Record<string, string>, signal?: AbortSignal) => Promise<unknown>;
  recommendSimilarPresetQuestions: (request: unknown, signal?: AbortSignal) => Promise<unknown>;
}

function safeError(code: string, category: SafeError['category'], message: string, retryable: boolean): SafeError {
  return { code, message, category, retryable };
}

function isSafeError(value: unknown): value is SafeError {
  return typeof value === 'object' && value !== null && 'code' in value && 'category' in value && 'retryable' in value;
}

function validateRequest(validator: ValidateFunction, request: unknown, code: string): SafeError | undefined {
  if (!validator(request)) {
    return safeError(code, 'VALIDATION', 'Canonical request validation failed.', false);
  }
  return undefined;
}

function invalidProviderResult(): SafeError {
  return safeError('QUESTION_RECOMMENDATION_INVALID_PROVIDER_RESULT', 'UNAVAILABLE', 'Provider response cannot be mapped to canonical result.', true);
}

function isCanceled(signal?: AbortSignal): boolean {
  return signal?.aborted === true;
}

interface TruncatedQuestions {
  readonly questions: readonly unknown[];
}

function validateAndTruncateResult(
  validator: ValidateFunction,
  result: TruncatedQuestions,
  limit: number,
  code: string,
): TruncatedQuestions | SafeError {
  const truncated: TruncatedQuestions = { questions: result.questions.slice(0, limit) };
  if (!validator(truncated)) {
    return safeError(code, 'UNAVAILABLE', 'Provider response cannot be mapped to canonical result.', true);
  }
  return truncated;
}

export function createReferenceRemoteQuestionRecommendationGateway(
  client: ReferenceRemoteQuestionRecommendationClient,
): QuestionRecommendationGateway {
  return {
    async listFrequentHistoryQuestions(
      request: ListFrequentHistoryQuestionsRequest,
      signal?: AbortSignal,
    ): Promise<ListFrequentHistoryQuestionsResult | SafeError> {
      if (isCanceled(signal)) {
        return safeError('QUESTION_RECOMMENDATION_CANCELED', 'CANCELED', 'Request was canceled.', false);
      }
      const requestError = validateRequest(validateFrequentRequest, request, 'QUESTION_RECOMMENDATION_INVALID_INPUT');
      if (requestError !== undefined) {
        return requestError;
      }

      const providerBody: Record<string, unknown> = {
        tenantId: request.tenantId,
        userId: request.subjectId,
        agentId: request.agentId,
        searchCriteria: { questionTopN: request.limit },
        portraitType: ['QUESTION'],
      };
      const headers: Record<string, string> = {};
      if (request.locale !== undefined) {
        headers['system-language'] = request.locale;
      }

      let raw: unknown;
      try {
        raw = await client.listFrequentHistoryQuestions(providerBody, headers, signal);
      } catch {
        if (isCanceled(signal)) {
          return safeError('QUESTION_RECOMMENDATION_CANCELED', 'CANCELED', 'Request was canceled.', false);
        }
        return safeError('QUESTION_RECOMMENDATION_UNAVAILABLE', 'UNAVAILABLE', 'Provider is unavailable.', true);
      }

      if (isCanceled(signal)) {
        return safeError('QUESTION_RECOMMENDATION_CANCELED', 'CANCELED', 'Request was canceled.', false);
      }
      if (!validateFrequentProviderResult(raw)) {
        return invalidProviderResult();
      }
      const providerResult = raw as { questions?: Array<{ value: string; count: number }> };
      const questions: FrequentHistoryQuestion[] = (providerResult.questions ?? []).map((item) => ({
        content: item.value,
        frequency: item.count,
      }));
      const canonical: ListFrequentHistoryQuestionsResult = { questions };

      const validated = validateAndTruncateResult(
        validateFrequentResult,
        canonical,
        request.limit,
        'QUESTION_RECOMMENDATION_INVALID_PROVIDER_RESULT',
      );
      return isSafeError(validated) ? validated : (validated as unknown as ListFrequentHistoryQuestionsResult);
    },

    async recommendSimilarPresetQuestions(
      request: RecommendSimilarPresetQuestionsRequest,
      signal?: AbortSignal,
    ): Promise<RecommendSimilarPresetQuestionsResult | SafeError> {
      if (isCanceled(signal)) {
        return safeError('QUESTION_RECOMMENDATION_CANCELED', 'CANCELED', 'Request was canceled.', false);
      }
      const requestError = validateRequest(validateSimilarRequest, request, 'QUESTION_RECOMMENDATION_INVALID_INPUT');
      if (requestError !== undefined) {
        return requestError;
      }

      const providerBody: Record<string, unknown> = {
        query: request.query,
        topn: request.limit,
      };
      for (const [key, value] of Object.entries({
        locale: request.locale,
        product: request.product,
        domain: request.domain,
        scene: request.scene,
      })) {
        if (value !== undefined) {
          providerBody[key] = value;
        }
      }

      let raw: unknown;
      try {
        raw = await client.recommendSimilarPresetQuestions(providerBody, signal);
      } catch {
        if (isCanceled(signal)) {
          return safeError('QUESTION_RECOMMENDATION_CANCELED', 'CANCELED', 'Request was canceled.', false);
        }
        return safeError('QUESTION_RECOMMENDATION_UNAVAILABLE', 'UNAVAILABLE', 'Provider is unavailable.', true);
      }

      if (isCanceled(signal)) {
        return safeError('QUESTION_RECOMMENDATION_CANCELED', 'CANCELED', 'Request was canceled.', false);
      }
      if (!validateSimilarProviderResult(raw)) {
        return invalidProviderResult();
      }
      const providerResult = raw as { data?: Array<{ questionId: string; content: string }> };
      const questions: PresetQuestionRecommendation[] = (providerResult.data ?? []).map((item) => ({
        questionId: item.questionId,
        content: item.content,
      }));
      const canonical: RecommendSimilarPresetQuestionsResult = { questions };

      const validated = validateAndTruncateResult(validateSimilarResult, canonical, request.limit, 'QUESTION_RECOMMENDATION_INVALID_PROVIDER_RESULT');
      return isSafeError(validated) ? validated : (validated as unknown as RecommendSimilarPresetQuestionsResult);
    },
  };
}
