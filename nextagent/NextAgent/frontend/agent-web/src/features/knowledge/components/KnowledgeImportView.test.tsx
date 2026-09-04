import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PiuContext } from '../../../features/chat/context/PiuContext.tsx';
import { KnowledgeImportPage, KnowledgeImportView } from './KnowledgeImportView.tsx';

vi.mock('../../../app/AppProviders.tsx', () => ({
  useAppHostContext: () => ({ hostTheme: 'lightday' }),
}));

describe('KnowledgeImportView', () => {
  const originalPrel = window.Prel;

  beforeEach(() => {
    window.Prel = undefined;
  });

  afterEach(() => {
    window.Prel = originalPrel;
    cleanup();
  });

  it('renders the PIU placeholder without throwing when Prel is unavailable', () => {
    render(
      <PiuContext.Provider value={{ piu: null, site: { locale: 'zh-cn', theme: 'lightday' } }}>
        <KnowledgeImportView />
      </PiuContext.Provider>,
    );

    expect(screen.getByTestId('piu-renderer-placeholder')).toBeTruthy();
    expect(screen.queryByTestId('page-layout-header')).toBeNull();
  });

  it('always renders regardless of any feature probe state', () => {
    render(
      <PiuContext.Provider value={{ piu: null, site: { locale: 'zh-cn', theme: 'lightday' } }}>
        <KnowledgeImportView />
      </PiuContext.Provider>,
    );

    // KnowledgeImportView has no feature probe gate
    expect(screen.getByTestId('piu-renderer-placeholder')).toBeTruthy();
  });

  it('wraps page content with exactly one knowledge import header', () => {
    render(
      <PiuContext.Provider value={{ piu: null, site: { locale: 'zh-cn', theme: 'lightday' } }}>
        <KnowledgeImportPage />
      </PiuContext.Provider>,
    );

    expect(screen.getAllByRole('heading', { name: '知识导入', level: 1 })).toHaveLength(1);
    expect(screen.getAllByTestId('page-layout-header')).toHaveLength(1);
    expect(screen.getByTestId('piu-renderer-placeholder')).toBeTruthy();
  });
});
