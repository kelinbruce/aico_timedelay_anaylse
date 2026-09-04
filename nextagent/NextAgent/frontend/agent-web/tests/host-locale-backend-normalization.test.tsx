// @vitest-environment jsdom
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HighFrequencyQuestions } from '../src/features/high-frequency-questions/components/HighFrequencyQuestions.tsx';
import { CategoryQuestions, __resetCategoryQuestionCacheForTests } from '../src/features/category-questions/components/CategoryQuestions.tsx';
import { MessageInput } from '../src/features/composer/components/MessageInput.tsx';
import { queryFrequentQuestions } from '../src/services/frequentQuestionService.ts';
import { queryCategoryQuestions } from '../src/services/categoryQuestionService.ts';
import { queryQuestionAssociations } from '../src/services/questionAssociationService.ts';
import { renderWithAppProviders } from './renderWithAppProviders.tsx';

vi.mock('../src/services/frequentQuestionService.ts', () => ({
  queryFrequentQuestions: vi.fn().mockResolvedValue({ locale: 'zh-CN', questions: [] }),
}));

vi.mock('../src/services/categoryQuestionService.ts', () => ({
  queryCategoryQuestions: vi.fn().mockResolvedValue({ locale: 'zh-CN', categories: [] }),
}));

vi.mock('../src/services/questionAssociationService.ts', () => ({
  queryQuestionAssociations: vi.fn().mockResolvedValue({ locale: 'zh-CN', questions: [] }),
}));

const mockQueryFrequentQuestions = vi.mocked(queryFrequentQuestions);
const mockQueryCategoryQuestions = vi.mocked(queryCategoryQuestions);
const mockQueryQuestionAssociations = vi.mocked(queryQuestionAssociations);

beforeEach(() => {
  __resetCategoryQuestionCacheForTests();
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('host locale normalization for backend question APIs', () => {
  it('requests frequent questions with backend locale zh-CN when host locale is zh-cn', async () => {
    renderWithAppProviders(<HighFrequencyQuestions />, { site: { locale: 'zh-cn' } });

    await waitFor(() => {
      expect(mockQueryFrequentQuestions).toHaveBeenCalledWith('zh-CN');
    });
  });

  it('requests category questions with backend locale zh-CN when host locale is zh-cn', async () => {
    renderWithAppProviders(<CategoryQuestions />, { site: { locale: 'zh-cn' } });

    await waitFor(() => {
      expect(mockQueryCategoryQuestions).toHaveBeenCalledWith('zh-CN');
    });
  });

  it('requests question associations with backend locale zh-CN when host locale is zh-cn', async () => {
    renderWithAppProviders(<MessageInput />, { site: { locale: 'zh-cn' } });

    fireEvent.change(screen.getByTestId('message-textarea'), { target: { value: 'ni' } });

    await waitFor(
      () => {
        expect(mockQueryQuestionAssociations).toHaveBeenCalledWith('ni', 'zh-CN', expect.any(AbortSignal));
      },
      { timeout: 3000 },
    );
  });

  it('requests frequent questions with backend locale en-US when host locale is en-us', async () => {
    renderWithAppProviders(<HighFrequencyQuestions />, { site: { locale: 'en-us' } });

    await waitFor(() => {
      expect(mockQueryFrequentQuestions).toHaveBeenCalledWith('en-US');
    });
  });
});
