import { apiClient } from './apiClient.ts';

export type QuestionAssociationSource = 'pinned' | 'high-frequency' | 'recommended' | 'static';

export interface QuestionAssociationEntry {
  readonly text: string;
  readonly source: QuestionAssociationSource;
}

export interface QuestionAssociationResult {
  readonly locale: string;
  readonly questions: readonly QuestionAssociationEntry[];
}

export function queryQuestionAssociations(keyword: string, locale: string, signal?: AbortSignal): Promise<QuestionAssociationResult> {
  return apiClient.get<QuestionAssociationResult>(
    `/api/v1/question-association?keyword=${encodeURIComponent(keyword)}&locale=${encodeURIComponent(locale)}`,
    signal ? { signal } : {},
  );
}
