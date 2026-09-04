// @vitest-environment jsdom
import { cleanup, fireEvent, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WelcomeState } from '../src/features/welcome/components/WelcomeState.tsx';
import i18n from '../src/i18n/index.ts';
import { renderWithAppProviders } from './renderWithAppProviders.tsx';

describe('WelcomeState component', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('zh-CN');
  });

  afterEach(() => {
    cleanup();
  });

  it('renders brand logo, name and welcome description', () => {
    renderWithAppProviders(<WelcomeState />, { withRouter: true });

    const mainTitle = screen.getByTestId('welcome-title-main');
    const subTitle = screen.getByTestId('welcome-title-sub');
    const brandIcon = screen.getByTestId('welcome-brand-icon');

    expect(mainTitle.textContent).toBe('NextAgent');
    expect(mainTitle.getAttribute('translate')).toBe('no');
    expect(mainTitle.classList.contains('notranslate')).toBe(true);
    expect(mainTitle.classList.contains('logoName')).toBe(true);
    expect(brandIcon.tagName).toBe('IMG');
    expect(brandIcon.getAttribute('src')).toContain('logo.svg');
    expect(subTitle.textContent).toBe(i18n.t('welcome.subtitle'));
    expect(subTitle.classList.contains('guideWelcome')).toBe(true);
  });

  it('renders high-frequency questions without icons', () => {
    renderWithAppProviders(<WelcomeState />, { withRouter: true });

    const items = screen.getAllByTestId('high-frequency-question-item');
    expect(items).toHaveLength(4);
    for (const item of items) {
      expect(item.tagName).toBe('BUTTON');
      expect(item.querySelector('svg, img')).toBeNull();
    }

    expect(items.map((item) => item.textContent?.trim())).toEqual([
      i18n.t('welcome.suggestions.analyzeLatency'),
      i18n.t('welcome.suggestions.checkCompliance'),
      i18n.t('welcome.suggestions.trafficReport'),
      i18n.t('welcome.suggestions.diagnoseIssues'),
    ]);
  });

  it('calls onSuggestionClick with the question text when a question is clicked', () => {
    const onSuggestionClick = vi.fn();
    renderWithAppProviders(<WelcomeState onSuggestionClick={onSuggestionClick} />, { withRouter: true });

    const items = screen.getAllByTestId('high-frequency-question-item');
    expect(items).toHaveLength(4);
    fireEvent.click(items[0]!);
    expect(onSuggestionClick).toHaveBeenCalledWith(i18n.t('welcome.suggestions.analyzeLatency'));
  });
});
