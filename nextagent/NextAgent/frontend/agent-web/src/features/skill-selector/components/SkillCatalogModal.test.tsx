import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import i18n from '../../../i18n/index.ts';
import { SkillCatalogModal } from './SkillCatalogModal.tsx';
import { SKILL_SEARCH_KEYWORD_MAX_LENGTH } from '../../../constants/inputLimits.ts';

const mockGet = vi.fn();
vi.mock('../../../services/apiClient.ts', () => ({
  apiClient: {
    get: (...args: unknown[]) => mockGet(...args),
  },
}));

beforeEach(() => {
  mockGet.mockReset();
});

afterEach(() => {
  cleanup();
  void i18n.changeLanguage('zh-CN');
});

describe('SkillCatalogModal i18n', () => {
  it('renders the modal description in English when locale is en-US', async () => {
    await i18n.changeLanguage('en-US');
    mockGet.mockResolvedValueOnce({ skills: [], total: 0 });

    render(
      <SkillCatalogModal
        anchorRect={{ top: 0, left: 0, right: 200, bottom: 40, width: 200, height: 40, x: 0, y: 0, toJSON: () => ({}) } as DOMRect}
        onClose={vi.fn()}
      />,
    );

    const modal = await screen.findByTestId('skill-catalog-modal');
    expect(modal.textContent).toMatch(/You can choose from the following skills/);
    expect(modal.textContent).not.toMatch(/你可以选择以下/);
  });
});

describe('SkillCatalogModal search input length guard', () => {
  it('enforces maxLength on the search input', async () => {
    mockGet.mockResolvedValue({ skills: [], total: 0 });

    render(
      <SkillCatalogModal
        anchorRect={{ top: 0, left: 0, right: 200, bottom: 40, width: 200, height: 40, x: 0, y: 0, toJSON: () => ({}) } as DOMRect}
        onClose={vi.fn()}
      />,
    );

    const input = (await screen.findByTestId('skill-modal-search')) as HTMLInputElement;
    expect(input.maxLength).toBe(SKILL_SEARCH_KEYWORD_MAX_LENGTH);
  });
});
