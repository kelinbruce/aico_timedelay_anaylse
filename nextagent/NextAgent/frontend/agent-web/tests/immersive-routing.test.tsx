// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createContext, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ImmersiveApp } from '../src/app/ImmersiveApp.tsx';
import type { HostSiteContext } from '../src/app/hostTypes.ts';
import i18n from '../src/i18n/index.ts';
import { runtimeConfig } from '../src/config/runtimeConfig.ts';
import { resetComplaintFeatureStoreForTesting, useComplaintFeatureStore } from '../src/state/complaintFeatureStore.ts';

let hostTheme: 'lightday' | 'evening' = 'lightday';

vi.mock('../src/app/AppProviders.tsx', () => ({
  AppHostContext: createContext(null),
  AppProviders: ({ children }: { readonly children: ReactNode }) => children,
  useAppHostContext: () => ({ mode: 'immersive', site, hostTheme }),
}));

vi.mock('../src/app/NonLocalAuth.tsx', () => ({
  useNonLocalAuthRedirect: () => undefined,
}));

vi.mock('../src/features/sidebar/components/Sidebar.tsx', () => ({
  Sidebar: function MockSidebar({
    onSelectMemoryManagement,
    onSelectComplaintHistory,
    onSelectConversation,
    onSelectFavorites,
    memoryManagementActive,
    complaintHistoryActive,
    favoritesActive,
  }: {
    readonly onSelectMemoryManagement?: () => void;
    readonly onSelectComplaintHistory?: () => void;
    readonly onSelectConversation?: () => void;
    readonly onSelectFavorites?: () => void;
    readonly memoryManagementActive?: boolean;
    readonly complaintHistoryActive?: boolean;
    readonly favoritesActive?: boolean;
  }) {
    const navigate = useNavigate();
    return (
      <nav
        data-testid="immersive-sidebar"
        data-memory-active={String(memoryManagementActive ?? false)}
        data-complaint-active={String(complaintHistoryActive ?? false)}
        data-favorites-active={String(favoritesActive ?? false)}
      >
        <button type="button" onClick={onSelectMemoryManagement}>
          Open memory
        </button>
        <button type="button" onClick={onSelectComplaintHistory}>
          Open complaints
        </button>
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
          Open conversation
        </button>
        <button type="button" onClick={() => navigate('/session/session-2')}>
          Navigate session
        </button>
        <button type="button" onClick={() => navigate(-1)}>
          Navigate back
        </button>
        <button type="button" onClick={() => navigate(1)}>
          Navigate forward
        </button>
      </nav>
    );
  },
}));

vi.mock('../src/app/ChatWorkspace.tsx', () => ({
  ChatWorkspace: ({ onOpenHelp }: { readonly onOpenHelp: () => void }) => (
    <main data-testid="chat-workspace">
      <button type="button" data-testid="chat-workspace-open-help" onClick={onOpenHelp}>
        Open help
      </button>
    </main>
  ),
}));

vi.mock('../src/pages/SharedConversationPage.tsx', () => ({
  SharedConversationPage: () => <main data-testid="shared-page" />,
}));

vi.mock('../src/pages/MemoryManagePage.tsx', () => ({
  MemoryManagePage: () => <section data-testid="memory-manage-page" />,
}));

vi.mock('../src/features/favorites/components/FavoriteTurnsPanel.tsx', () => ({
  FavoriteTurnsPanel: ({ onOpenFavorite }: { readonly onOpenFavorite: (sessionId: string, rootMessageId: string) => void }) => (
    <section data-testid="favorite-turns-panel">
      <button type="button" onClick={() => onOpenFavorite('favorite-session', 'favorite-message')}>
        Open favorite turn
      </button>
    </section>
  ),
}));

vi.mock('../src/features/complaint/components/ComplaintHistoryView.tsx', () => ({
  ComplaintHistoryView: () => <section data-testid="complaint-history-view" />,
  ComplaintHistoryPage: () => (
    <section data-testid="complaint-history-view">
      <h1>投诉历史</h1>
    </section>
  ),
}));

let operatorPosition: 'LEFT' | 'RIGHT' = 'LEFT';

vi.mock('../src/aico-config/useAICOConfig.ts', () => ({
  useAICOConfigSnapshot: () => ({
    config: {
      name: 'NextAgent',
      layoutConfig: { operatorPosition },
    },
  }),
}));

vi.mock('../src/features/composer/components/CommandHelpModal.tsx', () => ({
  CommandHelpModal: ({ open }: { readonly open: boolean }) => (open ? <div data-testid="command-help-modal" /> : null),
}));

const site: HostSiteContext = {
  locale: 'zh-cn',
  theme: 'lightday',
};

beforeEach(() => {
  hostTheme = 'lightday';
  runtimeConfig.portalAbilityConfig = {
    suggestedQuestionsEnabled: true,
    cronTasksEnabled: true,
    longTermMemoryManagementEnabled: true,
    knowledgeImportEnabled: true,
    fullProcessEnabled: true,
  };
  resetComplaintFeatureStoreForTesting();
});

afterEach(async () => {
  cleanup();
  runtimeConfig.portalAbilityConfig = {
    suggestedQuestionsEnabled: true,
    cronTasksEnabled: true,
    longTermMemoryManagementEnabled: true,
    knowledgeImportEnabled: true,
    fullProcessEnabled: true,
  };
  operatorPosition = 'LEFT';
  window.history.pushState({}, '', '/#/');
  resetComplaintFeatureStoreForTesting();
  await i18n.changeLanguage('zh-CN');
});

describe('immersive routing', () => {
  it.each([
    'http://127.0.0.1:5173/immersive/#/',
    'http://127.0.0.1:5173/immersive/#/session/session-1',
    'http://127.0.0.1:5173/immersive.html#/',
    'http://127.0.0.1:5173/immersive.html#/session/session-1',
  ])('renders the immersive shell for %s', (url) => {
    const nextUrl = new URL(url);
    window.history.pushState({}, '', `${nextUrl.pathname}${nextUrl.hash}`);

    render(<ImmersiveApp site={site} />);

    expect(screen.getByTestId('immersive-shell')).toBeTruthy();
    expect(screen.getByTestId('immersive-sidebar')).toBeTruthy();
    expect(screen.getByTestId('chat-workspace')).toBeTruthy();
  });

  it('wires immersive help actions to a real help modal', () => {
    render(<ImmersiveApp site={site} />);

    fireEvent.click(screen.getByTestId('chat-workspace-open-help'));

    expect(screen.getByTestId('command-help-modal')).toBeTruthy();
  });

  it('switches only the LEFT shell content and gives memory a dedicated route', () => {
    window.history.pushState({}, '', '/immersive/#/session/session-1');

    render(<ImmersiveApp site={site} />);
    fireEvent.click(screen.getByRole('button', { name: 'Open memory' }));

    expect(screen.getByTestId('immersive-sidebar')).toBeTruthy();
    expect(screen.getByTestId('memory-manage-page')).toBeTruthy();
    expect(screen.queryByTestId('chat-workspace')).toBeNull();
    expect(screen.getByTestId('immersive-sidebar').dataset.memoryActive).toBe('true');
    expect(window.location.hash).toBe('#/memory');

    fireEvent.click(screen.getByRole('button', { name: 'Open conversation' }));
    expect(screen.getByTestId('chat-workspace')).toBeTruthy();
  });

  it('shows LEFT favorites in the main content while keeping the sidebar mounted', () => {
    render(<ImmersiveApp site={site} />);
    fireEvent.click(screen.getByRole('button', { name: 'Open favorites' }));

    expect(screen.getByTestId('immersive-sidebar')).toBeTruthy();
    expect(screen.getByTestId('immersive-sidebar').dataset.favoritesActive).toBe('true');
    expect(screen.getByTestId('favorite-turns-panel')).toBeTruthy();
    expect(screen.getByTestId('favorite-turns-panel').parentElement).toBe(screen.getByTestId('immersive-main-content'));
    expect(screen.queryByTestId('chat-workspace')).toBeNull();
    expect(window.location.hash).toBe('#/favorites');

    fireEvent.click(screen.getByRole('button', { name: 'Open favorites' }));
    expect(screen.getByTestId('favorite-turns-panel')).toBeTruthy();
    expect(window.location.hash).toBe('#/favorites');
  });

  it.each(['LEFT', 'RIGHT'] as const)('leaves %s favorites through host navigation', async (position) => {
    operatorPosition = position;
    window.history.pushState({}, '', '/immersive/#/session/session-source');
    render(<ImmersiveApp site={site} />);

    const entryName = position === 'LEFT' ? 'Open favorites' : '收藏列表';
    fireEvent.click(screen.getByRole('button', { name: entryName }));
    fireEvent.click(screen.getByRole('button', { name: position === 'LEFT' ? 'Open conversation' : '新建会话' }));

    await waitFor(() => {
      expect(window.location.hash).toBe('#/');
      expect(screen.getByTestId('chat-workspace')).toBeTruthy();
    });
  });

  it('keeps LEFT main-content selections mutually exclusive and opens favorite turns in conversation', async () => {
    render(<ImmersiveApp site={site} />);
    fireEvent.click(screen.getByRole('button', { name: 'Open favorites' }));
    fireEvent.click(screen.getByRole('button', { name: 'Open memory' }));

    expect(screen.getByTestId('memory-manage-page')).toBeTruthy();
    expect(window.location.hash).toBe('#/memory');
    expect(screen.queryByTestId('favorite-turns-panel')).toBeNull();
    expect(screen.getByTestId('immersive-sidebar').dataset.memoryActive).toBe('true');
    expect(screen.getByTestId('immersive-sidebar').dataset.favoritesActive).toBe('false');

    fireEvent.click(screen.getByRole('button', { name: 'Open complaints' }));
    expect(screen.getByTestId('complaint-history-view')).toBeTruthy();
    expect(window.location.hash).toBe('#/complaint-history');
    expect(screen.queryByTestId('memory-manage-page')).toBeNull();
    expect(screen.getByTestId('immersive-sidebar').dataset.complaintActive).toBe('true');

    fireEvent.click(screen.getByRole('button', { name: 'Open favorites' }));
    fireEvent.click(screen.getByRole('button', { name: 'Open favorite turn' }));
    await waitFor(() => {
      expect(window.location.hash).toBe('#/session/favorite-session?messageId=favorite-message');
      expect(screen.getByTestId('chat-workspace')).toBeTruthy();
    });
  });

  it('hides portal ability gated RIGHT header entries when their switches are false', () => {
    operatorPosition = 'RIGHT';
    runtimeConfig.portalAbilityConfig = {
      suggestedQuestionsEnabled: true,
      cronTasksEnabled: true,
      longTermMemoryManagementEnabled: false,
      knowledgeImportEnabled: false,
      fullProcessEnabled: true,
    };
    window.history.pushState({}, '', '/immersive/#/session/session-1');

    render(<ImmersiveApp site={site} />);

    expect(screen.getByTestId('immersive-top-bar')).toBeTruthy();
    expect(screen.queryByRole('button', { name: '记忆管理' })).toBeNull();
    expect(screen.queryByRole('button', { name: '知识导入' })).toBeNull();
  });

  it('keeps the RIGHT header mounted while memory content is active', () => {
    operatorPosition = 'RIGHT';
    window.history.pushState({}, '', '/immersive/#/session/session-1');

    render(<ImmersiveApp site={site} />);
    fireEvent.click(screen.getByRole('button', { name: '记忆管理' }));
    fireEvent.click(screen.getByRole('button', { name: '记忆管理' }));

    expect(screen.getByTestId('immersive-top-bar')).toBeTruthy();
    expect(screen.getByTestId('memory-manage-page')).toBeTruthy();
    expect(screen.getByRole('button', { name: '记忆管理' }).getAttribute('aria-pressed')).toBe('true');
    expect(window.location.hash).toBe('#/memory');
  });

  it('keeps RIGHT favorites selected when the current entry is clicked repeatedly', () => {
    operatorPosition = 'RIGHT';

    render(<ImmersiveApp site={site} />);
    const favoritesButton = screen.getByRole('button', { name: '收藏列表' });
    fireEvent.click(favoritesButton);
    fireEvent.click(favoritesButton);

    expect(screen.getByTestId('favorite-turns-panel')).toBeTruthy();
    expect(screen.getByRole('button', { name: '收藏列表' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.queryByTestId('chat-workspace')).toBeNull();
    expect(window.location.hash).toBe('#/favorites');
  });

  it('keeps RIGHT history selected when clicked repeatedly', () => {
    operatorPosition = 'RIGHT';

    render(<ImmersiveApp site={site} />);
    fireEvent.click(screen.getByRole('button', { name: '历史会话' }));
    fireEvent.click(screen.getByRole('button', { name: '历史会话' }));

    expect(screen.getByRole('button', { name: '历史会话' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.queryByTestId('chat-workspace')).toBeNull();
  });

  it('restores routed main content on browser back and forward navigation', async () => {
    render(<ImmersiveApp site={site} />);
    fireEvent.click(screen.getByRole('button', { name: 'Open favorites' }));
    fireEvent.click(screen.getByRole('button', { name: 'Open memory' }));
    expect(screen.getByTestId('memory-manage-page')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Navigate back' }));

    await waitFor(() => {
      expect(window.location.hash).toBe('#/favorites');
      expect(screen.getByTestId('favorite-turns-panel')).toBeTruthy();
    });

    fireEvent.click(screen.getByRole('button', { name: 'Navigate forward' }));

    await waitFor(() => {
      expect(window.location.hash).toBe('#/memory');
      expect(screen.getByTestId('memory-manage-page')).toBeTruthy();
    });
  });

  it.each([
    ['/immersive/#/favorites', 'favorite-turns-panel', 'favoritesActive'],
    ['/immersive/#/memory', 'memory-manage-page', 'memoryActive'],
  ] as const)('restores the LEFT view when %s is opened directly', (url, testId, activeKey) => {
    window.history.pushState({}, '', url);

    render(<ImmersiveApp site={site} />);

    expect(screen.getByTestId('immersive-shell')).toBeTruthy();
    expect(screen.getByTestId(testId)).toBeTruthy();
    expect(screen.getByTestId('immersive-sidebar').dataset[activeKey]).toBe('true');
    expect(screen.queryByTestId('chat-workspace')).toBeNull();
  });

  it.each([
    ['/immersive/#/favorites', 'favorite-turns-panel', '收藏列表'],
    ['/immersive/#/memory', 'memory-manage-page', '记忆管理'],
  ] as const)('restores the RIGHT view when %s is opened directly', (url, testId, buttonName) => {
    operatorPosition = 'RIGHT';
    window.history.pushState({}, '', url);

    render(<ImmersiveApp site={site} />);

    expect(screen.getByTestId(testId)).toBeTruthy();
    expect(screen.getByRole('button', { name: buttonName }).getAttribute('aria-pressed')).toBe('true');
  });

  it.each([
    ['zh-CN', 'lightday', '新建会话', '收藏列表', '记忆管理', '投诉历史', 'light'],
    ['zh-CN', 'evening', '新建会话', '收藏列表', '记忆管理', '投诉历史', 'dark'],
    ['en-US', 'lightday', 'New Session', 'Favorites List', 'Memory Management', 'Complaint History', 'light'],
    ['en-US', 'evening', 'New Session', 'Favorites List', 'Memory Management', 'Complaint History', 'dark'],
  ] as const)(
    'uses shared RIGHT navigation identities for %s/%s',
    async (language, theme, newSessionName, favoritesName, memoryName, complaintName, iconTheme) => {
      operatorPosition = 'RIGHT';
      hostTheme = theme;
      useComplaintFeatureStore.setState({ enabled: true, status: 'ready' });
      await i18n.changeLanguage(language);

      render(<ImmersiveApp site={{ ...site, locale: language === 'zh-CN' ? 'zh-cn' : 'en-us', theme }} />);

      const newSessionButton = screen.getByRole('button', { name: newSessionName });
      const newSessionIcon = newSessionButton.querySelector('img');
      expect(newSessionIcon).not.toBeNull();
      expect(newSessionIcon?.getAttribute('src')).toContain(`new-session-${iconTheme}.svg`);
      expect(newSessionIcon?.getAttribute('alt')).toBe('');
      expect(newSessionIcon?.getAttribute('aria-hidden')).toBe('true');
      expect(newSessionIcon?.style.width).toBe('20px');
      expect(newSessionIcon?.style.height).toBe('20px');

      const expectedEntries = [
        [favoritesName, `favorites-${iconTheme}.svg`],
        [memoryName, `memory-${iconTheme}.svg`],
        [complaintName, `complaint-${iconTheme}.svg`],
      ] as const;
      for (const [name, iconFile] of expectedEntries) {
        const button = screen.getByRole('button', { name });
        const icon = button.querySelector('img');
        expect(icon).not.toBeNull();
        expect(icon?.getAttribute('src')).toContain(iconFile);
        expect(icon?.getAttribute('alt')).toBe('');
        expect(icon?.getAttribute('aria-hidden')).toBe('true');
        expect(icon?.style.width).toBe('16px');
        expect(icon?.style.height).toBe('16px');
      }
      expect(screen.queryByRole('button', { name: language === 'zh-CN' ? '定时任务' : 'Scheduled tasks' })).toBeNull();
    },
  );
});
