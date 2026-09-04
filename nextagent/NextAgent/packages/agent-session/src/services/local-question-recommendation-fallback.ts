import type {
  FrequentHistoryQuestion,
  ListFrequentHistoryQuestionsRequest,
  ListFrequentHistoryQuestionsResult,
  PresetQuestionRecommendation,
  QuestionRecommendationGateway,
  RecommendSimilarPresetQuestionsRequest,
  RecommendSimilarPresetQuestionsResult,
  UserQuestionActivityStoreGateway,
} from '@nextagent/agent-contracts/gateway';
import type { SafeError } from '@nextagent/agent-common';

export interface LocalQuestionRecommendationFallbackOptions {
  readonly activityStore: UserQuestionActivityStoreGateway;
  readonly frequencyThreshold: number;
}

function isSafeError(value: unknown): value is SafeError {
  return typeof value === 'object' && value !== null && 'code' in value && 'category' in value && 'retryable' in value;
}

export function createLocalQuestionRecommendationFallback(options: LocalQuestionRecommendationFallbackOptions): QuestionRecommendationGateway {
  const { activityStore, frequencyThreshold: threshold } = options;
  return {
    async listFrequentHistoryQuestions(request: ListFrequentHistoryQuestionsRequest): Promise<ListFrequentHistoryQuestionsResult | SafeError> {
      const records = await activityStore.listHighFrequency({
        tenantId: request.tenantId,
        subjectId: request.subjectId,
        agentId: request.agentId,
        threshold,
      });
      if (isSafeError(records)) {
        return records;
      }
      const questions: readonly FrequentHistoryQuestion[] = records
        .slice(0, request.limit)
        .map((record) => ({ content: record.questionText, frequency: record.askFrequency }));
      return { questions };
    },

    async recommendSimilarPresetQuestions(
      _request: RecommendSimilarPresetQuestionsRequest,
    ): Promise<RecommendSimilarPresetQuestionsResult | SafeError> {
      return { questions: [] as readonly PresetQuestionRecommendation[] };
    },
  };
}
