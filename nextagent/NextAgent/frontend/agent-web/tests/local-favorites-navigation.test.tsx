// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createContext, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from '../src/App.tsx';

vi.mock('../src/app/AppProviders.tsx', () => ({
  AppHostContext: createContext(null),
  AppProviders: ({ children }: { readonly children: ReactNode }) => children,
  useAppHostContext: () => ({
    themePreference: 'system',
    setLocalThemePreference: vi.fn(),
  }),
}));

vi.mock('../src/features/auth/useUserOps.ts', () => ({
  useUserOps: () => null,
}));

vi.mock('../src/features/sidebar/components/Sidebar.tsx', () => ({
  Sidebar: function MockSidebar({
    onOpenHelp,
    onSelectConversation,
    onSelectFavorites,
    favoritesActive,
  }: {
    readonly onOpenHelp: () => void;
    readonly onSelectConversation?: () => void;
    readonly onSelectFavorites?: () => void;
    readonly favoritesActive?: boolean;
  }) {
    const navigate = useNavigate();
    return (
      <nav data-testid="local-sidebar" data-favorites-active={String(favoritesActive ?? false)}>
        <button type="button" onClick={onSelectFavorites}>
          Open favorites
        </button>
        <button
          type="button"
          onClick={() => {
            onSelectConversation?.();
            navigate('/');
          }}
        >
          New session
        </button>
        <button
          type="button"
          onClick={() => {
            onSelectConversation?.();
            navigate('/session/session-2');
          }}
        >
          Open session
        </button>
        <button type="button" onClick={() => navigate('/session/session-3')}>
          Change route
        </button>
        <button type="button" onClick={onOpenHelp}>
          Open help
        </button>
      </nav>
    );
  },
}));

vi.mock('../src/features/favorites/components/FavoriteTurnsPanel.tsx', () => ({
  FavoriteTurnsPanel: ({ onOpenFavorite }: { readonly onOpenFavorite: (sessionId: string, rootMessageId: string) => void }) => (
    <section data-testid="favorite-turns-panel">
      <button type="button" onClick={() => onOpenFavorite('session-1', 'message-1')}>
        Open favorite turn
      </button>
    </section>
  ),
}));

vi.mock('../src/app/ChatWorkspace.tsx', () => ({
  ChatWorkspace: () => <main data-testid="chat-workspace" />,
}));

vi.mock('../src/pages/SharedConversationPage.tsx', () => ({
  SharedConversationPage: () => <main data-testid="shared-page" />,
}));

vi.mock('../src/features/composer/components/CommandHelpModal.tsx', () => ({
  CommandHelpModal: ({ open }: { readonly open: boolean }) => (open ? <div data-testid="command-help-modal" /> : null),
}));

afterEach(() => {
  cleanup();
  window.history.pushState({}, '', '/#/');
});

function renderApp(hash = '#/') {
  window.history.pushState({}, '', `/${hash}`);
  return render(<App />);
}

describe('local favorites navigation', () => {
  it('shows favorites at its dedicated URL and keeps repeated selection idempotent', () => {
    renderApp();

    fireEvent.click(screen.getByRole('button', { name: 'Open favorites' }));

    expect(screen.getByTestId('local-sidebar')).toBeTruthy();
    expect(screen.getByTestId('local-sidebar').dataset.favoritesActive).toBe('true');
    expect(screen.getByTestId('favorite-turns-panel')).toBeTruthy();
    expect(screen.getByTestId('favorite-turns-panel').parentElement).toBe(screen.getByTestId('local-main-content'));
    expect(screen.queryByTestId('chat-workspace')).toBeNull();
    expect(window.location.hash).toBe('#/favorites');

    fireEvent.click(screen.getByRole('button', { name: 'Open favorites' }));
    expect(screen.getByTestId('favorite-turns-panel')).toBeTruthy();
    expect(window.location.hash).toBe('#/favorites');
  });

  it('restores favorites when its URL is opened directly', () => {
    renderApp('#/favorites');

    expect(screen.getByTestId('favorite-turns-panel')).toBeTruthy();
    expect(screen.getByTestId('local-sidebar').dataset.favoritesActive).toBe('true');
  });

  it('keeps favorites active while opening temporary help', () => {
    renderApp();
    fireEvent.click(screen.getByRole('button', { name: 'Open favorites' }));
    fireEvent.click(screen.getByRole('button', { name: 'Open help' }));

    expect(screen.getByTestId('command-help-modal')).toBeTruthy();
    expect(screen.getByTestId('favorite-turns-panel')).toBeTruthy();
    expect(screen.getByTestId('local-sidebar').dataset.favoritesActive).toBe('true');
  });

  it.each(['New session', 'Open session'])('returns to conversation when %s is selected', (label) => {
    renderApp();
    fireEvent.click(screen.getByRole('button', { name: 'Open favorites' }));
    fireEvent.click(screen.getByRole('button', { name: label }));

    expect(screen.getByTestId('chat-workspace')).toBeTruthy();
    expect(screen.queryByTestId('favorite-turns-panel')).toBeNull();
  });

  it('opens a favorite turn in conversation and resets favorites on route changes', async () => {
    renderApp();
    fireEvent.click(screen.getByRole('button', { name: 'Open favorites' }));
    fireEvent.click(screen.getByRole('button', { name: 'Open favorite turn' }));

    await waitFor(() => {
      expect(window.location.hash).toBe('#/session/session-1?messageId=message-1');
      expect(screen.getByTestId('chat-workspace')).toBeTruthy();
    });

    fireEvent.click(screen.getByRole('button', { name: 'Open favorites' }));
    fireEvent.click(screen.getByRole('button', { name: 'Change route' }));
    await waitFor(() => {
      expect(screen.getByTestId('chat-workspace')).toBeTruthy();
    });
  });

  it('restores favorites and conversation through browser history', async () => {
    renderApp();
    fireEvent.click(screen.getByRole('button', { name: 'Open favorites' }));
    fireEvent.click(screen.getByRole('button', { name: 'New session' }));

    window.history.back();
    await waitFor(() => {
      expect(window.location.hash).toBe('#/favorites');
      expect(screen.getByTestId('favorite-turns-panel')).toBeTruthy();
    });

    window.history.forward();
    await waitFor(() => {
      expect(window.location.hash).toBe('#/');
      expect(screen.getByTestId('chat-workspace')).toBeTruthy();
    });
  });
});
