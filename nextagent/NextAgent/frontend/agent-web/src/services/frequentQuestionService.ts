import { apiClient } from './apiClient.ts';

export interface FrequentQuestionEntry {
  readonly text: string;
}

export interface FrequentQuestionResult {
  readonly locale: string;
  readonly questions: readonly FrequentQuestionEntry[];
}

export function queryFrequentQuestions(locale: string): Promise<FrequentQuestionResult> {
  return apiClient.get<FrequentQuestionResult>(`/api/v1/frequent-questions?locale=${encodeURIComponent(locale)}`);
}
