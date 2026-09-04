// @vitest-environment jsdom
import { cleanup, fireEvent, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { Sidebar } from '../src/features/sidebar/components/Sidebar.tsx';
import { RECENT_SESSION_LIMIT, useSessionStore } from '../src/state/sessionStore.ts';
import { sessionService } from '../src/services/sessionService.ts';
import i18n from '../src/i18n/index.ts';
import { renderWithAppProviders as render } from './renderWithAppProviders.tsx';

const FAVORITES_LABEL = '收藏列表';
const noopOpenHelp = () => {};
const mockSessions = [
  {
    sessionId: 'session-1',
    displayTitle: 'Session One',
    lastActivityAt: '2026-04-29T02:20:00.000Z',
  },
];

describe('Sidebar favorites entry', () => {
  beforeEach(() => {
    useSessionStore.setState({
      sessions: mockSessions,
      hasMore: false,
      activeSessionId: null,
      isLoadingHistory: false,
      isOpeningSession: false,
      historyError: null,
      historyOffset: mockSessions.length,
      historyWindowLimit: RECENT_SESSION_LIMIT,
    });
    vi.spyOn(sessionService, 'listSessions').mockResolvedValue({
      entries: mockSessions,
      offset: 0,
      limit: RECENT_SESSION_LIMIT,
      hasMore: false,
    });
  });

  afterEach(async () => {
    cleanup();
    document.body.innerHTML = '';
    localStorage.clear();
    sessionStorage.clear();
    await i18n.changeLanguage('zh-CN');
    vi.restoreAllMocks();
  });

  it('only emits the favorites selection intent and keeps recent sessions visible', () => {
    const onSelectFavorites = vi.fn();

    render(
      <MemoryRouter>
        <Sidebar onOpenHelp={noopOpenHelp} onSelectFavorites={onSelectFavorites} />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole('button', { name: FAVORITES_LABEL }));

    expect(onSelectFavorites).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('sidebar-session-list')).toBeTruthy();
    expect(screen.getByTestId('sidebar-session-item-session-1')).toBeTruthy();
    expect(screen.queryByTestId('sidebar-favorites-list')).toBeNull();
  });

  it('renders active feedback from the controlled shell state', () => {
    render(
      <MemoryRouter>
        <Sidebar onOpenHelp={noopOpenHelp} favoritesActive />
      </MemoryRouter>,
    );

    const favoritesButton = screen.getByRole('button', { name: FAVORITES_LABEL });
    expect(favoritesButton.getAttribute('aria-current')).toBe('page');
    expect(favoritesButton.style.color).toBe('var(--color-primary)');
  });

  it('does not change active feedback when the current favorites entry is selected again', () => {
    const onSelectFavorites = vi.fn();

    render(
      <MemoryRouter>
        <Sidebar onOpenHelp={noopOpenHelp} favoritesActive onSelectFavorites={onSelectFavorites} />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole('button', { name: FAVORITES_LABEL }));

    expect(onSelectFavorites).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: FAVORITES_LABEL }).getAttribute('aria-current')).toBe('page');
    expect(screen.getByTestId('sidebar-session-list')).toBeTruthy();
  });
});
