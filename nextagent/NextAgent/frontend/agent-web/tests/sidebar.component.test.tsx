// @vitest-environment jsdom
import { act, cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, useNavigate } from 'react-router-dom';
import { Sidebar } from '../src/features/sidebar/components/Sidebar.tsx';
import { AppProviders } from '../src/app/AppProviders.tsx';
import { SessionHistorySearchControls } from '../src/features/sidebar/components/SessionHistorySearchControls.tsx';
import { SIDEBAR_SESSION_LIST_EXPANDED_STORAGE_KEY } from '../src/state/sessionListPreference.ts';
import { sessionService } from '../src/services/sessionService.ts';
import { RECENT_SESSION_LIMIT, SESSION_HISTORY_PAGE_LIMIT, useSessionStore } from '../src/state/sessionStore.ts';
import i18n, { LOCALE_PREFERENCE_STORAGE_KEY } from '../src/i18n/index.ts';
import type { SessionHistoryEntry } from '../src/state/contracts.ts';
import { THEME_PREFERENCE_STORAGE_KEY } from '../src/config/themePreference.ts';
import { runtimeConfig } from '../src/config/runtimeConfig.ts';
import { renderWithAppProviders as render } from './renderWithAppProviders.tsx';

const NEW_SESSION_LABEL = '\u65b0\u5efa\u4f1a\u8bdd';
const RECENT_SESSIONS_LABEL = '\u5386\u53f2\u4f1a\u8bdd';
const RENAME_LABEL = '\u91cd\u547d\u540d';
const MORE_SESSION_ACTIONS_LABEL = '\u66f4\u591a\u4f1a\u8bdd\u64cd\u4f5c';
const EXPAND_LABEL = /\u5c55\u5f00/;
const COLLAPSE_LABEL = /\u6536\u8d77/;
const LOAD_MORE_LABEL = '\u67e5\u770b\u66f4\u591a\u4f1a\u8bdd';
const EXPAND_SIDEBAR_LABEL = '\u5c55\u5f00\u4fa7\u8fb9\u680f';
const COLLAPSE_SIDEBAR_LABEL = '\u6298\u53e0\u4fa7\u8fb9\u680f';
const SIGN_OUT_LABEL = '\u9000\u51fa\u767b\u5f55';
const SEARCH_HISTORY_LABEL = '\u641c\u7d22\u5386\u53f2';
const CRON_TASKS_LABEL = '\u5b9a\u65f6\u4efb\u52a1';
const FAVORITES_LABEL = '\u6536\u85cf\u5217\u8868';
const MEMORY_MANAGEMENT_LABEL = '\u8bb0\u5fc6\u7ba1\u7406';
const SETTINGS_LABEL = '\u8bbe\u7f6e';
const HELP_LABEL = '\u5e2e\u52a9';
const LANGUAGE_LABEL = '\u8bed\u8a00';
const THEME_LABEL = '\u4e3b\u9898';
const THEME_DARK_LABEL = '\u6df1\u8272';
const noopOpenHelp = () => {};

function formatExpectedDateTime(value: number): string {
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(new Date(value));
}

const mockSessions: SessionHistoryEntry[] = [
  {
    sessionId: 'session-1',
    displayTitle: 'Session One',
    lastActivityAt: '2026-04-29T02:20:00.000Z',
  },
  {
    sessionId: 'session-2',
    displayTitle: 'Session Two',
    lastActivityAt: '2026-04-28T02:20:00.000Z',
  },
];

function createMockSessions(count: number): SessionHistoryEntry[] {
  return Array.from({ length: count }, (_, index) => ({
    sessionId: `session-${index + 1}`,
    displayTitle: `Session ${index + 1}`,
    lastActivityAt: `2026-04-${String(29 - index).padStart(2, '0')}T02:20:00.000Z`,
  }));
}

vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>();
  return {
    ...actual,
    useNavigate: vi.fn(),
  };
});

describe('Sidebar component', () => {
  beforeEach(() => {
    runtimeConfig.portalAbilityConfig = {
      suggestedQuestionsEnabled: true,
      cronTasksEnabled: true,
      longTermMemoryManagementEnabled: true,
      knowledgeImportEnabled: true,
      fullProcessEnabled: true,
    };
    (useNavigate as ReturnType<typeof vi.fn>).mockReturnValue(vi.fn());
    useSessionStore.setState({
      sessions: mockSessions,
      hasMore: false,
      activeSessionId: null,
      isLoadingHistory: false,
      isOpeningSession: false,
      historyError: null,
      historyOffset: mockSessions.length,
      historyWindowLimit: RECENT_SESSION_LIMIT,
      historySearchQuery: {},
    });
    vi.spyOn(sessionService, 'listSessions').mockResolvedValue({
      entries: mockSessions,
      offset: 0,
      limit: RECENT_SESSION_LIMIT,
      hasMore: false,
    });
  });

  afterEach(async () => {
    runtimeConfig.portalAbilityConfig = {
      suggestedQuestionsEnabled: true,
      cronTasksEnabled: true,
      longTermMemoryManagementEnabled: true,
      knowledgeImportEnabled: true,
      fullProcessEnabled: true,
    };
    cleanup();
    document.body.innerHTML = '';
    localStorage.clear();
    sessionStorage.clear();
    await i18n.changeLanguage('zh-CN');
    vi.restoreAllMocks();
  });

  it('renders new session and recent sessions in the sidebar', () => {
    render(
      <MemoryRouter>
        <Sidebar onOpenHelp={noopOpenHelp} />
      </MemoryRouter>,
    );

    screen.getByText(NEW_SESSION_LABEL);
    screen.getByText(RECENT_SESSIONS_LABEL);
    screen.getByText('Session One');
  });

  it('starts collapsed when the viewport is 720px wide or narrower', () => {
    vi.spyOn(window, 'matchMedia').mockImplementation(
      (query) =>
        ({
          matches: query === '(max-width: 720px)',
          media: query,
          onchange: null,
          addEventListener: vi.fn(),
          removeEventListener: vi.fn(),
          addListener: vi.fn(),
          removeListener: vi.fn(),
          dispatchEvent: vi.fn(),
        }) as MediaQueryList,
    );

    render(
      <MemoryRouter>
        <Sidebar onOpenHelp={noopOpenHelp} />
      </MemoryRouter>,
    );

    expect(screen.getByRole('navigation').style.width).toBe('48px');
    expect(screen.getByRole('button', { name: EXPAND_SIDEBAR_LABEL })).toBeTruthy();
  });

  it('does not issue an empty search request after initial history load', async () => {
    vi.useFakeTimers();
    try {
      render(
        <MemoryRouter>
          <Sidebar onOpenHelp={noopOpenHelp} />
        </MemoryRouter>,
      );

      expect(sessionService.listSessions).toHaveBeenCalledTimes(1);

      await act(async () => {
        vi.advanceTimersByTime(250);
        await Promise.resolve();
      });

      expect(sessionService.listSessions).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('shows the selected created time range down to seconds', () => {
    const createdFrom = new Date(2026, 3, 1, 1, 2, 3).getTime();
    const createdTo = new Date(2026, 3, 2, 13, 4, 5).getTime();
    render(<SessionHistorySearchControls query={{ createdFrom, createdTo }} onQueryChange={vi.fn()} />);

    expect(screen.getByTestId('session-history-created-from').textContent).toBe(`起: ${formatExpectedDateTime(createdFrom)}`);
    expect(screen.getByTestId('session-history-created-to').textContent).toBe(`止: ${formatExpectedDateTime(createdTo)}`);
  });

  it('fills the height provided by the host shell instead of forcing viewport height', () => {
    render(
      <MemoryRouter>
        <Sidebar onOpenHelp={noopOpenHelp} />
      </MemoryRouter>,
    );

    expect(screen.getByRole('navigation').style.height).toBe('100%');
  });

  it('shows a platform shortcut hint for new session', () => {
    render(
      <MemoryRouter>
        <Sidebar onOpenHelp={noopOpenHelp} />
      </MemoryRouter>,
    );

    expect(screen.getByTestId('sidebar-new-session-shortcut').textContent).toMatch(/K$/);
  });

  it('keeps the new session shortcut at normal weight on the root route', () => {
    render(
      <MemoryRouter initialEntries={['/']}>
        <Sidebar onOpenHelp={noopOpenHelp} />
      </MemoryRouter>,
    );

    expect(screen.getByTestId('sidebar-new-session-shortcut').style.fontWeight).toBe('400');
    expect(screen.getByText(NEW_SESSION_LABEL).closest('button')?.style.fontWeight).toBe('400');
  });

  it('opens language settings while keeping Help available', () => {
    render(
      <MemoryRouter>
        <Sidebar onOpenHelp={noopOpenHelp} />
      </MemoryRouter>,
    );

    const settings = screen.getByText(SETTINGS_LABEL).closest('button');
    const help = screen.getByText(HELP_LABEL).closest('button');
    expect(settings?.disabled).toBe(false);
    expect(help?.disabled).toBe(false);
    fireEvent.click(settings!);
    expect(screen.getByText(LANGUAGE_LABEL)).toBeTruthy();
    expect(screen.getByRole('combobox')).toBeTruthy();
  });

  it('updates the theme preference from settings', () => {
    const onThemePreferenceChange = vi.fn();
    render(
      <MemoryRouter>
        <Sidebar onOpenHelp={noopOpenHelp} themePreference="system" onThemePreferenceChange={onThemePreferenceChange} />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByText(SETTINGS_LABEL));
    expect(screen.getByText(THEME_LABEL)).toBeTruthy();
    fireEvent.click(screen.getByText(THEME_DARK_LABEL));

    expect(onThemePreferenceChange).toHaveBeenCalledWith('dark');
    expect(screen.queryByRole('button', { name: 'OK' })).toBeNull();
  });

  it('applies the language preference from settings immediately', async () => {
    render(
      <MemoryRouter>
        <Sidebar onOpenHelp={noopOpenHelp} />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByText(SETTINGS_LABEL));
    fireEvent.mouseDown(screen.getByRole('combobox'));
    fireEvent.click(await screen.findByText('English'));

    await waitFor(() => {
      expect(localStorage.getItem(LOCALE_PREFERENCE_STORAGE_KEY)).toBe('en-US');
    });
    expect(screen.getByText('Language')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'OK' })).toBeNull();
  });

  it('opens command help from the Help button', () => {
    const onOpenHelp = vi.fn();

    render(
      <MemoryRouter>
        <Sidebar onOpenHelp={onOpenHelp} />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByText(HELP_LABEL));
    expect(onOpenHelp).toHaveBeenCalledTimes(1);
  });

  it('navigates to / when new session is clicked', () => {
    const navigate = vi.fn();
    (useNavigate as ReturnType<typeof vi.fn>).mockReturnValue(navigate);

    render(
      <MemoryRouter>
        <Sidebar onOpenHelp={noopOpenHelp} />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByText(NEW_SESSION_LABEL));
    expect(navigate).toHaveBeenCalledWith('/');
  });

  it('shows inline search controls below the recent sessions header', () => {
    render(
      <MemoryRouter>
        <Sidebar onOpenHelp={noopOpenHelp} />
      </MemoryRouter>,
    );

    screen.getByRole('textbox', { name: SEARCH_HISTORY_LABEL });
    screen.getByText(RECENT_SESSIONS_LABEL);
  });

  it('renders recent sessions as a secondary heading only while the sidebar is expanded', () => {
    render(
      <MemoryRouter>
        <Sidebar onOpenHelp={noopOpenHelp} />
      </MemoryRouter>,
    );

    screen.getByRole('region', { name: RECENT_SESSIONS_LABEL });
    const heading = screen.getByText(RECENT_SESSIONS_LABEL);
    expect(heading.textContent).toBe(RECENT_SESSIONS_LABEL);
    expect(heading.style.fontSize).toBe('14px');
    expect(heading.style.fontWeight).toBe('400');
    expect(heading.style.lineHeight).toBe('32px');
    expect(heading.style.color).toBe('var(--color-text-secondary)');
    fireEvent.click(screen.getByRole('button', { name: COLLAPSE_SIDEBAR_LABEL }));

    expect(screen.queryByRole('region', { name: RECENT_SESSIONS_LABEL })).toBeNull();
    expect(screen.queryByText(RECENT_SESSIONS_LABEL)).toBeNull();
  });

  it('navigates to cron task dashboard from the sidebar entry below new session', () => {
    const navigate = vi.fn();
    (useNavigate as ReturnType<typeof vi.fn>).mockReturnValue(navigate);

    render(
      <MemoryRouter>
        <Sidebar onOpenHelp={noopOpenHelp} />
      </MemoryRouter>,
    );

    const newSessionButton = screen.getByText(NEW_SESSION_LABEL).closest('button');
    const cronButton = screen.getByText(CRON_TASKS_LABEL).closest('button');
    expect(newSessionButton?.nextElementSibling).toBe(cronButton);

    fireEvent.click(cronButton!);

    expect(navigate).toHaveBeenCalledWith('/cron-tasks');
  });

  it('marks cron task dashboard entry as active on the cron route', () => {
    render(
      <MemoryRouter initialEntries={['/cron-tasks']}>
        <Sidebar onOpenHelp={noopOpenHelp} />
      </MemoryRouter>,
    );

    expect(screen.getByText(CRON_TASKS_LABEL).closest('button')?.getAttribute('aria-current')).toBe('page');
  });

  it('uses shared page names and decorative themed icons without adding local-only entries', async () => {
    render(
      <MemoryRouter>
        <Sidebar onOpenHelp={noopOpenHelp} />
      </MemoryRouter>,
      { site: { locale: 'zh-cn', theme: 'lightday' } },
    );

    for (const [name, iconFile] of [
      ['定时任务', 'cron-light.svg'],
      ['收藏列表', 'favorites-light.svg'],
    ] as const) {
      const button = screen.getByRole('button', { name });
      const icon = button.querySelector('img');
      expect(icon?.getAttribute('src')).toContain(iconFile);
      expect(icon?.getAttribute('alt')).toBe('');
      expect(icon?.getAttribute('aria-hidden')).toBe('true');
      expect(icon?.style.width).toBe('20px');
      expect(icon?.style.height).toBe('20px');
    }
    expect(screen.queryByRole('button', { name: '记忆管理' })).toBeNull();
    expect(screen.queryByRole('button', { name: '投诉历史' })).toBeNull();

    cleanup();
    await i18n.changeLanguage('en-US');
    localStorage.setItem(THEME_PREFERENCE_STORAGE_KEY, 'dark');
    render(
      <MemoryRouter>
        <Sidebar onOpenHelp={noopOpenHelp} />
      </MemoryRouter>,
      { site: { locale: 'en-us', theme: 'evening' } },
    );

    expect(screen.getByRole('button', { name: 'Scheduled tasks' }).querySelector('img')?.getAttribute('src')).toContain('cron-dark.svg');
    expect(screen.getByRole('button', { name: 'Favorites List' }).querySelector('img')?.getAttribute('src')).toContain('favorites-dark.svg');
  });

  it('shows portal ability gated entries by default in immersive mode', () => {
    render(
      <AppProviders mode="immersive" site={{ user: { ops: ['AICOService.View'] } }}>
        <MemoryRouter>
          <Sidebar onOpenHelp={noopOpenHelp} showLocalControls={false} />
        </MemoryRouter>
      </AppProviders>,
    );

    expect(screen.getByRole('button', { name: CRON_TASKS_LABEL })).toBeTruthy();
    expect(screen.getByRole('button', { name: MEMORY_MANAGEMENT_LABEL })).toBeTruthy();
    expect(screen.getByRole('button', { name: '知识导入' })).toBeTruthy();
  });

  it('hides portal ability gated entries when their switches are false', () => {
    runtimeConfig.portalAbilityConfig = {
      suggestedQuestionsEnabled: true,
      cronTasksEnabled: false,
      longTermMemoryManagementEnabled: false,
      knowledgeImportEnabled: false,
      fullProcessEnabled: true,
    };

    render(
      <AppProviders mode="immersive" site={{ user: { ops: ['AICOService.View'] } }}>
        <MemoryRouter>
          <Sidebar onOpenHelp={noopOpenHelp} showLocalControls={false} />
        </MemoryRouter>
      </AppProviders>,
    );

    expect(screen.queryByRole('button', { name: CRON_TASKS_LABEL })).toBeNull();
    expect(screen.queryByRole('button', { name: MEMORY_MANAGEMENT_LABEL })).toBeNull();
    expect(screen.queryByRole('button', { name: '知识导入' })).toBeNull();
  });

  it('shows inline search controls in immersive sidebar mode', () => {
    render(
      <AppProviders mode="immersive" site={{ user: { ops: ['AICOService.View'] } }}>
        <MemoryRouter>
          <Sidebar onOpenHelp={noopOpenHelp} showLocalControls={false} />
        </MemoryRouter>
      </AppProviders>,
    );

    screen.getByRole('textbox', { name: SEARCH_HISTORY_LABEL });
  });

  it('selects memory through the shell callback and preserves collapsed state', () => {
    const navigate = vi.fn();
    const onSelectMemoryManagement = vi.fn();
    (useNavigate as ReturnType<typeof vi.fn>).mockReturnValue(navigate);

    render(
      <AppProviders mode="immersive" site={{ user: { ops: ['AICOService.View'] } }}>
        <MemoryRouter>
          <Sidebar onOpenHelp={noopOpenHelp} showLocalControls={false} onSelectMemoryManagement={onSelectMemoryManagement} memoryManagementActive />
        </MemoryRouter>
      </AppProviders>,
    );

    fireEvent.click(screen.getByRole('button', { name: COLLAPSE_SIDEBAR_LABEL }));
    const memoryButton = screen.getByRole('button', { name: MEMORY_MANAGEMENT_LABEL });
    fireEvent.click(memoryButton);

    expect(onSelectMemoryManagement).toHaveBeenCalledTimes(1);
    expect(navigate).not.toHaveBeenCalledWith('/memory');
    expect(memoryButton.getAttribute('aria-current')).toBe('page');
    expect(memoryButton.style.color).toBe('var(--color-text-tooltip)');
    expect(screen.getByRole('button', { name: EXPAND_SIDEBAR_LABEL })).toBeTruthy();
  });

  it('emits independent content selections without navigating or cross-clearing state', () => {
    const navigate = vi.fn();
    (useNavigate as ReturnType<typeof vi.fn>).mockReturnValue(navigate);

    function ControlledSidebar() {
      const [activeView, setActiveView] = useState<'favorites' | 'memory'>('memory');
      return (
        <Sidebar
          onOpenHelp={noopOpenHelp}
          showLocalControls={false}
          onSelectFavorites={() => setActiveView('favorites')}
          favoritesActive={activeView === 'favorites'}
          onSelectMemoryManagement={() => setActiveView('memory')}
          memoryManagementActive={activeView === 'memory'}
        />
      );
    }

    render(
      <AppProviders mode="immersive" site={{ user: { ops: ['AICOService.View'] } }}>
        <MemoryRouter>
          <ControlledSidebar />
        </MemoryRouter>
      </AppProviders>,
    );

    const favoritesButton = screen.getByRole('button', { name: FAVORITES_LABEL });
    fireEvent.click(favoritesButton);
    expect(favoritesButton.getAttribute('aria-current')).toBe('page');
    expect(screen.getByRole('button', { name: MEMORY_MANAGEMENT_LABEL }).getAttribute('aria-current')).toBeNull();

    const memoryButton = screen.getByRole('button', { name: MEMORY_MANAGEMENT_LABEL });
    fireEvent.click(memoryButton);

    expect(favoritesButton.getAttribute('aria-current')).toBeNull();
    expect(memoryButton.getAttribute('aria-current')).toBe('page');
    expect(navigate).not.toHaveBeenCalled();
  });

  it('keeps the current route when selecting favorites', () => {
    const navigate = vi.fn();
    const onSelectFavorites = vi.fn();
    (useNavigate as ReturnType<typeof vi.fn>).mockReturnValue(navigate);

    render(
      <MemoryRouter>
        <Sidebar onOpenHelp={noopOpenHelp} onSelectFavorites={onSelectFavorites} />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole('button', { name: FAVORITES_LABEL }));

    expect(onSelectFavorites).toHaveBeenCalledTimes(1);
    expect(navigate).not.toHaveBeenCalled();
  });

  it('restores conversation before navigating to a session', () => {
    const navigate = vi.fn();
    const onSelectConversation = vi.fn();
    (useNavigate as ReturnType<typeof vi.fn>).mockReturnValue(navigate);

    render(
      <MemoryRouter>
        <Sidebar onOpenHelp={noopOpenHelp} onSelectConversation={onSelectConversation} />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByTestId('sidebar-session-item-session-1'));

    expect(onSelectConversation).toHaveBeenCalledTimes(1);
    expect(navigate).toHaveBeenCalledWith('/session/session-1');
  });

  it('filters sidebar sessions when typing in the inline search input', async () => {
    const searchResult: SessionHistoryEntry = {
      sessionId: 'session-search',
      displayTitle: 'Search Result',
      lastActivityAt: '2026-04-27T02:20:00.000Z',
    };
    vi.mocked(sessionService.listSessions)
      .mockResolvedValueOnce({
        entries: mockSessions,
        offset: 0,
        limit: RECENT_SESSION_LIMIT,
        hasMore: false,
      })
      .mockResolvedValueOnce({
        entries: [searchResult],
        offset: 0,
        limit: SESSION_HISTORY_PAGE_LIMIT,
        hasMore: false,
      });

    render(
      <MemoryRouter>
        <Sidebar onOpenHelp={noopOpenHelp} />
      </MemoryRouter>,
    );

    const searchInput = screen.getByRole('textbox', { name: SEARCH_HISTORY_LABEL });
    fireEvent.change(searchInput, { target: { value: '\u544a\u8b66' } });

    await waitFor(() => {
      expect(screen.getByTestId('sidebar-session-item-session-search')).toBeTruthy();
    });
    expect(sessionService.listSessions).toHaveBeenLastCalledWith({
      offset: 0,
      limit: SESSION_HISTORY_PAGE_LIMIT,
      q: '\u544a\u8b66',
    });
  });

  it('navigates to the selected session when a session row is clicked', () => {
    const navigate = vi.fn();
    (useNavigate as ReturnType<typeof vi.fn>).mockReturnValue(navigate);

    render(
      <MemoryRouter>
        <Sidebar onOpenHelp={noopOpenHelp} />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByTestId('sidebar-session-item-session-1'));
    expect(navigate).toHaveBeenCalledWith('/session/session-1');
  });

  it('uses Ctrl+K to open a new session from another session', () => {
    const navigate = vi.fn();
    (useNavigate as ReturnType<typeof vi.fn>).mockReturnValue(navigate);

    render(
      <MemoryRouter initialEntries={['/session/session-1']}>
        <Sidebar onOpenHelp={noopOpenHelp} />
      </MemoryRouter>,
    );

    fireEvent.keyDown(window, { key: 'k', ctrlKey: true });
    expect(navigate).toHaveBeenCalledWith('/');
  });

  it('focuses the composer instead of navigating when already on the new session page', () => {
    const textarea = document.createElement('textarea');
    textarea.setAttribute('data-testid', 'message-textarea');
    document.body.appendChild(textarea);

    const navigate = vi.fn();
    (useNavigate as ReturnType<typeof vi.fn>).mockReturnValue(navigate);

    render(
      <MemoryRouter initialEntries={['/']}>
        <Sidebar onOpenHelp={noopOpenHelp} />
      </MemoryRouter>,
    );

    fireEvent.keyDown(window, { key: 'k', ctrlKey: true });

    expect(document.activeElement).toBe(textarea);
    expect(navigate).not.toHaveBeenCalled();
  });

  it('has a collapse toggle button', () => {
    render(
      <MemoryRouter>
        <Sidebar onOpenHelp={noopOpenHelp} />
      </MemoryRouter>,
    );

    screen.getByRole('button', { name: COLLAPSE_SIDEBAR_LABEL });
  });

  it('collapse toggle is clickable', () => {
    const navigate = vi.fn();
    (useNavigate as ReturnType<typeof vi.fn>).mockReturnValue(navigate);

    render(
      <MemoryRouter>
        <Sidebar onOpenHelp={noopOpenHelp} />
      </MemoryRouter>,
    );

    const toggle = screen.getByRole('button', { name: COLLAPSE_SIDEBAR_LABEL });
    fireEvent.click(toggle);
    screen.getByRole('button', { name: EXPAND_SIDEBAR_LABEL });
  });

  it('shows a history session panel with unique active state and closes on outside click', () => {
    render(
      <MemoryRouter>
        <Sidebar onOpenHelp={noopOpenHelp} favoritesActive />
      </MemoryRouter>,
    );

    expect(screen.queryByRole('button', { name: RECENT_SESSIONS_LABEL })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: COLLAPSE_SIDEBAR_LABEL }));

    const favorites = screen.getByRole('button', { name: FAVORITES_LABEL });
    const history = screen.getByRole('button', { name: RECENT_SESSIONS_LABEL });
    const historyWrapper = screen.getByTestId('sidebar-history-toggle').parentElement as HTMLElement;
    const divider = historyWrapper.querySelector<HTMLElement>('[data-testid="sidebar-history-divider"]');
    expect(historyWrapper.contains(history)).toBe(true);
    expect(history.compareDocumentPosition(favorites) & Node.DOCUMENT_POSITION_PRECEDING).toBeTruthy();
    expect(divider?.style.position).toBe('absolute');
    expect(divider?.style.width).toBe('20px');
    expect(divider?.style.height).toBe('1px');
    expect(divider?.style.border).toContain('1px solid rgb(233, 233, 233)');
    const historyIcon = history.querySelector('img');
    expect(historyIcon?.getAttribute('src')).toContain('history-light.svg');
    expect(historyIcon?.getAttribute('alt')).toBe('');
    expect(historyIcon?.getAttribute('aria-hidden')).toBe('true');
    expect(favorites.getAttribute('aria-current')).toBe('page');

    fireEvent.click(history);

    const panel = screen.getByTestId('sidebar-history-panel');
    expect(panel.className).toContain('sidebar-history-panel');
    expect(panel.style.getPropertyValue('--sidebar-history-panel-left')).toBe('8px');
    expect(panel.style.getPropertyValue('--sidebar-history-panel-top')).toBe('8px');
    const title = panel.querySelector<HTMLElement>('[data-testid="sidebar-history-panel-title"]');
    expect(title?.textContent).toBe(RECENT_SESSIONS_LABEL);
    expect(title?.className).toContain('sidebar-history-panel-title');
    expect(panel.querySelector('[data-testid="sidebar-session-list-scroll"]')).toBeTruthy();
    const search = panel.querySelector<HTMLInputElement>('input');
    expect(search?.className).toContain('sidebar-history-panel-search-input');
    expect(panel.querySelector('[aria-label="按创建时间筛选"]')).toBeNull();
    expect(panel.querySelector('[data-testid="sidebar-history-panel-content"]')).toBeNull();
    const row = screen.getByTestId('sidebar-history-row-session-1');
    const deleteButton = row.querySelector<HTMLButtonElement>('button[aria-label="删除"]');
    expect(row.className).toContain('sidebar-history-panel-row');
    expect(deleteButton?.className).toContain('sidebar-history-panel-delete');
    fireEvent.mouseEnter(row);
    expect(row.className).toContain('sidebar-history-panel-row--hovered');
    expect(favorites.getAttribute('aria-current')).toBeNull();
    expect(history.getAttribute('aria-current')).toBe('page');

    fireEvent.mouseDown(document.body);
    expect(screen.queryByTestId('sidebar-history-panel')).toBeNull();
  });

  it('loads more history sessions when the panel scroll wheel reaches the bottom', async () => {
    const nextEntry: SessionHistoryEntry = {
      sessionId: 'session-extra',
      displayTitle: 'Session Extra',
      lastActivityAt: '2026-04-26T02:20:00.000Z',
    };
    useSessionStore.setState({
      sessions: mockSessions,
      hasMore: true,
      isLoadingHistory: false,
      historyError: null,
      historyOffset: mockSessions.length,
      historyWindowLimit: SESSION_HISTORY_PAGE_LIMIT,
      historySearchQuery: {},
    });
    vi.mocked(sessionService.listSessions)
      .mockResolvedValueOnce({
        entries: mockSessions,
        offset: 0,
        limit: RECENT_SESSION_LIMIT,
        hasMore: true,
      })
      .mockResolvedValueOnce({
        entries: mockSessions,
        offset: 0,
        limit: SESSION_HISTORY_PAGE_LIMIT,
        hasMore: true,
      })
      .mockResolvedValueOnce({
        entries: [nextEntry],
        offset: mockSessions.length,
        limit: SESSION_HISTORY_PAGE_LIMIT,
        hasMore: false,
      });

    render(
      <MemoryRouter>
        <Sidebar onOpenHelp={noopOpenHelp} />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole('button', { name: COLLAPSE_SIDEBAR_LABEL }));
    fireEvent.click(screen.getByRole('button', { name: RECENT_SESSIONS_LABEL }));
    await waitFor(() => {
      expect(screen.getByText('Session One')).toBeTruthy();
    });

    fireEvent.wheel(screen.getByTestId('sidebar-session-list-scroll'), { deltaY: 100 });

    await waitFor(() => {
      expect(screen.getByText('Session Extra')).toBeTruthy();
    });
  });

  it('matches sign-out nav button hover style and height', () => {
    render(
      <MemoryRouter>
        <Sidebar onOpenHelp={noopOpenHelp} onLogout={vi.fn()} />
      </MemoryRouter>,
    );

    const signOut = screen.getByRole('button', { name: SIGN_OUT_LABEL });
    const toggle = screen.getByRole('button', { name: COLLAPSE_SIDEBAR_LABEL });
    const signOutIcon = signOut.querySelector<HTMLElement>('.ant-btn-icon > span');
    const toggleIcon = toggle.querySelector<HTMLElement>('.ant-btn-icon > span');

    fireEvent.mouseEnter(toggle);
    fireEvent.mouseEnter(signOut);

    expect(toggle.style.height).toBe(signOut.style.height);
    expect(toggle.style.backgroundColor).toBe(signOut.style.backgroundColor);
    expect(toggle.style.borderStyle).toBe(signOut.style.borderStyle);
    expect(toggle.style.borderRadius).toBe(signOut.style.borderRadius);
    expect(toggle.style.justifyContent).toBe(signOut.style.justifyContent);
    expect(toggle.style.padding).toBe(signOut.style.padding);
    expect(toggleIcon?.style.width).toBe(signOutIcon?.style.width);
    expect(toggleIcon?.style.height).toBe(signOutIcon?.style.height);
    expect(toggleIcon?.style.fontSize).toBe(signOutIcon?.style.fontSize);
  });

  it('does not mark new session as active when current path is /', () => {
    render(
      <MemoryRouter initialEntries={['/']}>
        <Sidebar onOpenHelp={noopOpenHelp} />
      </MemoryRouter>,
    );

    const chatButton = screen.getByText(NEW_SESSION_LABEL).closest('button');
    expect(chatButton?.getAttribute('aria-current')).toBeNull();
  });

  it('highlights the active session row without replacing time by actions', () => {
    useSessionStore.setState({ activeSessionId: 'session-1' });
    render(
      <MemoryRouter initialEntries={['/session/session-1']}>
        <Sidebar onOpenHelp={noopOpenHelp} />
      </MemoryRouter>,
    );

    const sessionRow = screen.getByTestId('sidebar-session-item-session-1');
    const newSessionButton = screen.getByText(NEW_SESSION_LABEL).closest('button');
    expect(sessionRow.getAttribute('aria-current')).toBe('page');
    expect(newSessionButton?.getAttribute('aria-current')).toBeNull();
    expect(screen.queryByRole('button', { name: new RegExp(MORE_SESSION_ACTIONS_LABEL) })).toBeNull();
  });

  it('shows session actions only when a session row is hovered', () => {
    render(
      <MemoryRouter>
        <Sidebar onOpenHelp={noopOpenHelp} />
      </MemoryRouter>,
    );

    expect(screen.queryByRole('button', { name: new RegExp(MORE_SESSION_ACTIONS_LABEL) })).toBeNull();
    fireEvent.mouseEnter(screen.getByTestId('sidebar-session-item-session-1'));
    expect(screen.getByRole('button', { name: new RegExp(MORE_SESSION_ACTIONS_LABEL) })).toBeTruthy();
  });

  it('shows ten recent sessions by default and expands or collapses by text links', () => {
    const sessions = createMockSessions(12);
    useSessionStore.setState({
      sessions,
      hasMore: false,
      historyOffset: sessions.length,
    });
    vi.spyOn(sessionService, 'listSessions').mockResolvedValue({
      entries: sessions,
      offset: 0,
      limit: RECENT_SESSION_LIMIT,
      hasMore: false,
    });

    render(
      <MemoryRouter>
        <Sidebar onOpenHelp={noopOpenHelp} />
      </MemoryRouter>,
    );

    expect(screen.getByText('Session 10')).toBeTruthy();
    expect(screen.queryByText('Session 11')).toBeNull();

    const expandControl = screen.getByRole('button', { name: EXPAND_LABEL });
    expect(expandControl.classList.contains('sidebar-session-list-toggle')).toBe(true);

    fireEvent.click(expandControl);
    expect(sessionStorage.getItem(SIDEBAR_SESSION_LIST_EXPANDED_STORAGE_KEY)).toBe('true');
    expect(useSessionStore.getState().historyWindowLimit).toBe(SESSION_HISTORY_PAGE_LIMIT);
    expect(screen.getByText('Session 11')).toBeTruthy();
    expect(screen.getByTestId('sidebar-session-item-session-1').style.flexShrink).toBe('0');
    const scrollViewport = screen.getByTestId('sidebar-session-list-scroll');
    expect(scrollViewport.classList.contains('nextagent-themed-scrollbar')).toBe(true);
    expect(scrollViewport.style.flex).toBe('0 1 auto');
    const collapseControl = screen.getByRole('button', { name: COLLAPSE_LABEL });
    expect(collapseControl.classList.contains('sidebar-session-list-toggle')).toBe(true);

    fireEvent.click(collapseControl);
    expect(sessionStorage.getItem(SIDEBAR_SESSION_LIST_EXPANDED_STORAGE_KEY)).toBe('false');
    expect(useSessionStore.getState().historyWindowLimit).toBe(RECENT_SESSION_LIMIT);
    expect(screen.queryByText('Session 11')).toBeNull();
  });

  it('restores expanded sessions from sessionStorage and uses the expanded initial page size', async () => {
    const sessions = createMockSessions(12);
    sessionStorage.setItem(SIDEBAR_SESSION_LIST_EXPANDED_STORAGE_KEY, 'true');
    useSessionStore.setState({
      sessions,
      hasMore: false,
      historyOffset: sessions.length,
    });
    vi.mocked(sessionService.listSessions).mockResolvedValue({
      entries: sessions,
      offset: 0,
      limit: SESSION_HISTORY_PAGE_LIMIT,
      hasMore: false,
    });

    render(
      <MemoryRouter>
        <Sidebar onOpenHelp={noopOpenHelp} />
      </MemoryRouter>,
    );

    expect(screen.getByText('Session 6')).toBeTruthy();
    expect(screen.getByRole('button', { name: COLLAPSE_LABEL })).toBeTruthy();
    await waitFor(() => {
      expect(sessionService.listSessions).toHaveBeenCalledWith({
        offset: 0,
        limit: SESSION_HISTORY_PAGE_LIMIT,
      });
    });
  });

  it('shows load more as a lightweight session-list action when more history exists', async () => {
    const sessions = createMockSessions(12);
    useSessionStore.setState({
      sessions,
      hasMore: true,
      historyOffset: sessions.length,
    });
    vi.spyOn(sessionService, 'listSessions').mockResolvedValue({
      entries: sessions,
      offset: 0,
      limit: RECENT_SESSION_LIMIT,
      hasMore: true,
    });

    render(
      <MemoryRouter>
        <Sidebar onOpenHelp={noopOpenHelp} />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(useSessionStore.getState().isLoadingHistory).toBe(false);
    });

    fireEvent.click(screen.getByRole('button', { name: EXPAND_LABEL }));

    const loadMoreControl = screen.getByRole('button', { name: LOAD_MORE_LABEL });
    expect(loadMoreControl.classList.contains('sidebar-session-list-load-more')).toBe(true);
    expect(loadMoreControl.classList.contains('sidebar-session-list-toggle')).toBe(false);
    expect(screen.getByRole('button', { name: COLLAPSE_LABEL }).classList.contains('sidebar-session-list-toggle')).toBe(true);
  });

  it('keeps sidebar recent sessions independent from stale history search query state', async () => {
    const sessions = createMockSessions(12);
    useSessionStore.setState({
      sessions,
      hasMore: true,
      historyOffset: sessions.length,
      historyWindowLimit: RECENT_SESSION_LIMIT,
      historySearchQuery: {
        createdFrom: Date.UTC(2026, 3, 1),
        createdTo: Date.UTC(2026, 3, 30),
      },
    });
    vi.mocked(sessionService.listSessions).mockResolvedValue({
      entries: sessions,
      offset: 0,
      limit: SESSION_HISTORY_PAGE_LIMIT,
      hasMore: true,
    });

    render(
      <MemoryRouter>
        <Sidebar onOpenHelp={noopOpenHelp} />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(useSessionStore.getState().isLoadingHistory).toBe(false);
    });

    expect(screen.getByText('Session 10')).toBeTruthy();
    expect(screen.queryByText('Session 11')).toBeNull();
    const scrollViewport = screen.getByTestId('sidebar-session-list-scroll');
    expect(scrollViewport.style.overflowY).toBe('visible');

    await waitFor(() => {
      expect(sessionService.listSessions).toHaveBeenCalledWith({
        offset: 0,
        limit: RECENT_SESSION_LIMIT,
      });
    });
  });

  it('loads and opens the next session when Ctrl+] moves beyond the visible list', async () => {
    const sessions = createMockSessions(11);
    const navigate = vi.fn();
    (useNavigate as ReturnType<typeof vi.fn>).mockReturnValue(navigate);
    useSessionStore.setState({
      sessions: sessions.slice(0, RECENT_SESSION_LIMIT),
      hasMore: true,
      activeSessionId: 'session-10',
      historyOffset: RECENT_SESSION_LIMIT,
      historyWindowLimit: RECENT_SESSION_LIMIT,
    });
    vi.spyOn(sessionService, 'listSessions')
      .mockResolvedValueOnce({
        entries: sessions.slice(0, RECENT_SESSION_LIMIT),
        offset: 0,
        limit: RECENT_SESSION_LIMIT,
        hasMore: true,
      })
      .mockResolvedValueOnce({
        entries: [sessions[10]!],
        offset: RECENT_SESSION_LIMIT,
        limit: 20,
        hasMore: false,
      });

    render(
      <MemoryRouter initialEntries={['/session/session-10']}>
        <Sidebar onOpenHelp={noopOpenHelp} />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(useSessionStore.getState().isLoadingHistory).toBe(false);
    });

    fireEvent.keyDown(window, { key: ']', ctrlKey: true });

    await waitFor(() => {
      expect(navigate).toHaveBeenCalledWith('/session/session-11');
    });
    expect(sessionService.listSessions).toHaveBeenLastCalledWith({
      offset: RECENT_SESSION_LIMIT,
      limit: 20,
    });
    expect(useSessionStore.getState().historyWindowLimit).toBeGreaterThanOrEqual(SESSION_HISTORY_PAGE_LIMIT);
    expect(screen.getByText('Session 11')).toBeTruthy();
    expect(screen.getByText(COLLAPSE_LABEL)).toBeTruthy();
  });

  it('shows brand icon and NextAgent text when expanded', () => {
    render(
      <MemoryRouter>
        <Sidebar onOpenHelp={noopOpenHelp} />
      </MemoryRouter>,
    );

    const brandIcon = screen.getByTestId('sidebar-brand-icon');
    expect(brandIcon.tagName).toBe('IMG');
    expect(brandIcon.getAttribute('src')).toBe('/src/assets/logo.svg');
    expect(screen.getByTestId('sidebar-brand-text')).toBeTruthy();
    expect(screen.getByText('NextAgent')).toBeTruthy();
    const textEl = screen.getByTestId('sidebar-brand-text');
    expect(textEl.style.fontWeight).toBe('700');
    expect(textEl.getAttribute('translate')).toBe('no');
    expect(textEl.classList.contains('notranslate')).toBe(true);
  });

  it('hides NextAgent text when collapsed, icon remains', () => {
    render(
      <MemoryRouter>
        <Sidebar onOpenHelp={noopOpenHelp} />
      </MemoryRouter>,
    );

    const toggle = screen.getByRole('button', { name: COLLAPSE_SIDEBAR_LABEL });
    fireEvent.click(toggle);

    expect(screen.getByTestId('sidebar-brand-icon')).toBeTruthy();
    expect(screen.queryByTestId('sidebar-brand-text')).toBeNull();
  });
  it('adds sidebar-nav-button-collapsed class to nav buttons when collapsed so icons center', () => {
    render(
      <MemoryRouter>
        <Sidebar onOpenHelp={noopOpenHelp} />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole('button', { name: COLLAPSE_SIDEBAR_LABEL }));

    const navButton = screen.getByRole('button', { name: NEW_SESSION_LABEL }).closest('button');
    expect(navButton?.className).toContain('sidebar-nav-button-collapsed');
  });

  it('keeps nav buttons borderless and without collapsed class when expanded', () => {
    render(
      <MemoryRouter>
        <Sidebar onOpenHelp={noopOpenHelp} />
      </MemoryRouter>,
    );

    const navButton = screen.getByRole('button', { name: NEW_SESSION_LABEL }).closest('button');
    expect(navButton?.className).not.toContain('sidebar-nav-button-collapsed');
    expect(navButton?.style.borderStyle).toBe('none');
  });
});
