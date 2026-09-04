import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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
  AuthGate: ({ children }: { children: React.ReactNode }) => <>{children}</>,
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

function renderSidebar(onSelectKnowledgeImport = vi.fn()) {
  render(
    <MemoryRouter>
      <Sidebar onOpenHelp={vi.fn()} onSelectKnowledgeImport={onSelectKnowledgeImport} />
    </MemoryRouter>,
  );
  return onSelectKnowledgeImport;
}

describe('Sidebar knowledge import entry', () => {
  beforeEach(() => {
    testState.mode = 'immersive';
    testState.themeMode = 'light';
  });

  afterEach(async () => {
    cleanup();
    await i18n.changeLanguage('zh-CN');
  });

  it('does not render in local mode', () => {
    testState.mode = 'local';
    renderSidebar();

    expect(screen.queryByRole('button', { name: /Knowledge Import|知识导入/ })).toBeNull();
  });

  it('renders in immersive mode and selects knowledge import', () => {
    const onSelectKnowledgeImport = renderSidebar();

    fireEvent.click(screen.getByRole('button', { name: /Knowledge Import|知识导入/ }));
    expect(onSelectKnowledgeImport).toHaveBeenCalledOnce();
    const icon = screen.getByRole('button', { name: '知识导入' }).querySelector('img');
    expect(icon).not.toBeNull();
    expect(icon?.getAttribute('src')).toContain('knowledge-light.svg');
    expect(icon?.getAttribute('alt')).toBe('');
    expect(icon?.getAttribute('aria-hidden')).toBe('true');
    expect(icon?.style.width).toBe('20px');
    expect(icon?.style.height).toBe('20px');
  });

  it('uses the same English page name and dark memory icon', async () => {
    testState.themeMode = 'dark';
    await i18n.changeLanguage('en-US');

    renderSidebar();

    const button = screen.getByRole('button', { name: 'Knowledge Import' });
    expect(button.textContent).toContain('Knowledge Import');
    const icon = button.querySelector('img');
    expect(icon).not.toBeNull();
    expect(icon?.getAttribute('src')).toContain('knowledge-dark.svg');
  });

  it('places the entry after memory management and before complaint history', () => {
    renderSidebar();

    const allButtons = screen.getAllByRole('button');
    const memoryIndex = allButtons.findIndex((btn) => btn.getAttribute('aria-label') === '记忆管理');
    const knowledgeIndex = allButtons.findIndex((btn) => btn.getAttribute('aria-label') === '知识导入');

    expect(memoryIndex).toBeGreaterThan(-1);
    expect(knowledgeIndex).toBeGreaterThan(-1);
    expect(knowledgeIndex).toBeGreaterThan(memoryIndex);
  });
});
