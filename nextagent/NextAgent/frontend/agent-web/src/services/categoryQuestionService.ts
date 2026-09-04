import { apiClient } from './apiClient.ts';
import type { CategoryQuestionResult } from '../state/contracts.ts';

export function queryCategoryQuestions(locale: string): Promise<CategoryQuestionResult> {
  return apiClient.get<CategoryQuestionResult>(`/api/v1/category-questions?locale=${encodeURIComponent(locale)}`);
}
