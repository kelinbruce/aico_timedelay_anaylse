import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetComplaintFeatureStoreForTesting, useComplaintFeatureStore } from '../../../state/complaintFeatureStore.ts';
import i18n from '../../../i18n/index.ts';

const testState = vi.hoisted(() => ({
  mode: 'immersive' as 'local' | 'immersive',
  themeMode: 'light' as 'light' | 'dark',
}));

vi.mock('../../../app/AppProviders.tsx', () => ({
  useAppHostContext: () => ({ mode: testState.mode, themeMode: testState.themeMode }),
}));
vi.mock('../../../features/auth/useUserOps.ts', () => ({
  useUserOps: () => null,
}));
vi.mock('../../../aico-config/useAICOConfig.ts', () => ({
  useAICOConfig: () => null,
}));
vi.mock('../../../aico-config/OperatorsArea.tsx', () => ({
  OperatorsArea: () => null,
}));
vi.mock('../../../aico-config/iconUtils.ts', () => ({
  useIconWithFallback: () => ({ src: '/logo.svg', onError: vi.fn() }),
}));
vi.mock('../../../features/auth/AuthGate.tsx', () => ({
  AuthGate: ({ children }: { children: React.ReactNode }) => children,
}));
vi.mock('../../../state/sessionStore.ts', () => {
  const sessionState = {
    sessions: [],
    activeSessionId: null,
    hasMore: false,
    isLoadingHistory: false,
    historyError: null,
    historySearchQuery: {},
    loadSessions: vi.fn(async () => undefined),
    loadMoreSessions: vi.fn(async () => undefined),
    renameSession: vi.fn(async () => undefined),
    deleteSession: vi.fn(async () => undefined),
    setHistoryWindowLimit: vi.fn(),
  };
  const useSessionStore = Object.assign((selector: (state: typeof sessionState) => unknown) => selector(sessionState), {
    getState: () => sessionState,
  });
  return {
    RECENT_SESSION_LIMIT: 10,
    SESSION_HISTORY_PAGE_LIMIT: 50,
    hasSessionHistorySearchQuery: () => false,
    useSessionStore,
  };
});
vi.mock('../../../state/conversationStore.ts', () => {
  const state = { clearConversation: vi.fn() };
  return {
    useConversationStore: (selector: (value: typeof state) => unknown) => selector(state),
  };
});
vi.mock('../../../services/annotationService.ts', () => ({
  FAVORITES_UPDATED_EVENT: 'favorites-updated',
  annotationService: {
    listFavoriteTurns: vi.fn(async () => ({ entries: [], hasMore: false })),
    deleteFavoriteTurn: vi.fn(async () => undefined),
  },
}));
vi.mock('./SessionHistoryEntryRow.tsx', () => ({
  SessionHistoryEntryRow: () => null,
}));
vi.mock('./SessionHistorySearchDialog.tsx', () => ({
  SessionHistorySearchDialog: () => null,
}));
vi.mock('./SessionHistorySearchControls.tsx', () => ({
  SessionHistorySearchControls: () => null,
}));
vi.mock('./SessionRenameModal.tsx', () => ({
  SessionRenameModal: () => null,
}));
vi.mock('./SessionDeleteConfirmModal.tsx', () => ({
  SessionDeleteConfirmModal: () => null,
}));

import { Sidebar } from './Sidebar.tsx';

function renderSidebar(onSelectComplaintHistory = vi.fn()) {
  render(
    <MemoryRouter>
      <Sidebar onOpenHelp={vi.fn()} onSelectComplaintHistory={onSelectComplaintHistory} />
    </MemoryRouter>,
  );
  return onSelectComplaintHistory;
}

function renderFavoritesSidebar(onSelectFavorites = vi.fn()) {
  render(
    <MemoryRouter>
      <Sidebar onOpenHelp={vi.fn()} onSelectFavorites={onSelectFavorites} />
    </MemoryRouter>,
  );
  return onSelectFavorites;
}

describe('Sidebar complaint history entry', () => {
  beforeEach(() => {
    testState.mode = 'immersive';
    testState.themeMode = 'light';
    resetComplaintFeatureStoreForTesting();
  });

  afterEach(async () => {
    cleanup();
    resetComplaintFeatureStoreForTesting();
    await i18n.changeLanguage('zh-CN');
  });

  it('does not render in local mode', () => {
    testState.mode = 'local';
    useComplaintFeatureStore.setState({ enabled: true, status: 'ready' });
    renderSidebar();

    expect(screen.queryByRole('button', { name: /Complaint history|投诉历史/ })).toBeNull();
  });

  it('does not render before the complaint probe is enabled', () => {
    renderSidebar();

    expect(screen.queryByRole('button', { name: /Complaint history|投诉历史/ })).toBeNull();
  });

  it('renders in immersive mode and selects complaint history', () => {
    useComplaintFeatureStore.setState({ enabled: true, status: 'ready' });
    const onSelectComplaintHistory = renderSidebar();

    fireEvent.click(screen.getByRole('button', { name: /Complaint history|投诉历史/ }));
    expect(onSelectComplaintHistory).toHaveBeenCalledOnce();
    const icon = screen.getByRole('button', { name: '投诉历史' }).querySelector('img');
    expect(icon).not.toBeNull();
    expect(icon?.getAttribute('src')).toContain('complaint-light.svg');
    expect(icon?.getAttribute('alt')).toBe('');
    expect(icon?.getAttribute('aria-hidden')).toBe('true');
    expect(icon?.style.width).toBe('20px');
    expect(icon?.style.height).toBe('20px');
  });

  it('uses the same English page name and dark complaint icon', async () => {
    testState.themeMode = 'dark';
    useComplaintFeatureStore.setState({ enabled: true, status: 'ready' });
    await i18n.changeLanguage('en-US');

    renderSidebar();

    const button = screen.getByRole('button', { name: 'Complaint History' });
    expect(button.textContent).toContain('Complaint History');
    const icon = button.querySelector('img');
    expect(icon).not.toBeNull();
    expect(icon?.getAttribute('src')).toContain('complaint-dark.svg');
  });

  it('keeps the sidebar collapsed when selecting favorites', async () => {
    await i18n.changeLanguage('en-US');
    const onSelectFavorites = renderFavoritesSidebar();

    fireEvent.click(screen.getByRole('button', { name: 'Collapse sidebar' }));
    const favoritesButton = screen.getByRole('button', { name: 'Favorites List' });
    expect(favoritesButton.className).toContain('sidebar-nav-button-collapsed');

    fireEvent.click(favoritesButton);

    expect(onSelectFavorites).toHaveBeenCalledOnce();
    expect(screen.getByRole('button', { name: 'Favorites List' }).className).toContain('sidebar-nav-button-collapsed');
  });
});
