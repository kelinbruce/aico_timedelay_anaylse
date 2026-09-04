// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { MutableRefObject, ReactNode } from 'react';
import type { Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { HostSiteContext } from '../src/app/hostTypes.ts';
import type { Prel, PIU } from '../src/host/prel.ts';
import type { ChatComposerBridge } from '../src/pages/ChatPage.tsx';
import type { ChatNavigationAdapter } from '../src/features/chat/chatNavigation.ts';

const PACKAGE_VERSION = '9.9.9-test';

interface AttachedHandlers {
  readonly $stateChange: Record<string, (newValue: unknown, oldValue: unknown) => void>;
  readonly loadAIAgent: (payload?: unknown) => void;
  readonly displayAIAgent: (payload?: unknown) => void;
  readonly minimizeAIAgent: () => void;
  readonly switchLocale: (payload?: unknown) => void;
  readonly switchTheme: (payload?: unknown) => void;
  readonly sendQuestionToLui: (payload?: unknown) => void;
  readonly renderKnowledge: (payload?: unknown) => void;
  readonly handleHistoricalChatReplay: (payload?: unknown) => void;
  readonly updatePanelLayout: (payload?: unknown) => void;
}

interface FakeRoot {
  readonly render: ReturnType<typeof vi.fn>;
  readonly unmount: ReturnType<typeof vi.fn>;
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.resetModules();
  vi.doUnmock('../src/app/AppProviders.tsx');
  vi.doUnmock('../src/app/ChatWorkspace.tsx');
  vi.doUnmock('../src/app/NonLocalAuth.tsx');
  vi.doUnmock('../src/entries/renderRoot.tsx');
  vi.doUnmock('../src/pages/ChatPage.tsx');
  vi.doUnmock('../src/piu/AIAgentPiuRuntime.tsx');
  vi.doUnmock('../src/features/composer/components/CommandHelpModal.tsx');
  vi.doUnmock('../src/features/favorites/components/FavoriteTurnsPanel.tsx');
  vi.doUnmock('../src/features/session-activity/SessionActivityConnectionController.tsx');
  vi.doUnmock('@ant-design/icons');
  vi.doUnmock('antd');
  document.body.replaceChildren();
  sessionStorage.clear();
  delete window.Prel;
  vi.doUnmock('../src/services/cronTaskService.ts');
});

describe('AIAgentPIU runtime contract', () => {
  it('registers Prel handlers before rendering any PIU UI', async () => {
    const runtime = await loadRegisteredPiu();

    expect(runtime.prel.ready).toHaveBeenCalledTimes(1);
    expect(runtime.prel.start).toHaveBeenCalledWith('AICOPIU', PACKAGE_VERSION, ['session', 'user', 'locale', 'theme'], expect.any(Function));
    expect(runtime.piu.attach).toHaveBeenCalledTimes(1);
    expect(Object.keys(runtime.getHandlers()).sort()).toEqual([
      '$stateChange',
      'displayAIAgent',
      'handleHistoricalChatReplay',
      'loadAIAgent',
      'minimizeAIAgent',
      'renderKnowledge',
      'sendQuestionToLui',
      'switchLocale',
      'switchTheme',
      'updatePanelLayout',
    ]);
    expect(runtime.renderRootMock).not.toHaveBeenCalled();
  });

  it('loads AIAgent into the requested container and keeps only one active root', async () => {
    const runtime = await loadRegisteredPiu();
    const firstContainer = appendContainer('first-agent-container');
    const secondContainer = appendContainer('second-agent-container');
    const handlers = runtime.getHandlers();

    handlers.loadAIAgent({ containerId: firstContainer.id, mode: 'ignored' });
    await flushPromises();

    expect(runtime.renderRootMock).toHaveBeenCalledTimes(1);
    expect(runtime.renderRootMock).toHaveBeenLastCalledWith(firstContainer, expect.anything(), expect.any(Object));

    handlers.loadAIAgent({ containerId: firstContainer.id });
    await flushPromises();

    expect(runtime.renderRootMock).toHaveBeenCalledTimes(1);
    expect(runtime.roots[0]?.render).toHaveBeenCalledTimes(1);

    firstContainer.append(document.createElement('span'));
    handlers.loadAIAgent({ containerId: secondContainer.id });
    await flushPromises();

    expect(runtime.roots[0]?.unmount).toHaveBeenCalledTimes(1);
    expect(firstContainer.childElementCount).toBe(0);
    expect(runtime.renderRootMock).toHaveBeenCalledTimes(2);
    expect(runtime.renderRootMock).toHaveBeenLastCalledWith(secondContainer, expect.anything(), expect.any(Object));
  });

  it('ignores legacy capability business names while fully replacing collaborative AICOConfig state', async () => {
    const runtime = await loadRegisteredPiu();
    appendContainer('agent-container');
    const handlers = runtime.getHandlers();
    const { aicoConfigStore } = await import('../src/aico-config/AICOConfigStore.ts');

    handlers.loadAIAgent({
      containerId: 'agent-container',
      name: 'First agent',
      welcome: 'First welcome',
      capabilityBusinessNames: [{ kind: 'TOOL', id: 'networkDiagnostic', names: { 'zh-CN': '旧网络诊断' } }],
    });
    await flushPromises();
    aicoConfigStore.setActivePanelOperator({ piuName: 'panel', piuVersion: '1', renderFunc: 'render' });

    handlers.loadAIAgent({
      containerId: 'agent-container',
      capabilityBusinessNames: [{ kind: 'TOOL', id: 'networkDiagnostic', names: { 'zh-CN': '新网络诊断' } }],
    });
    await flushPromises();

    expect(aicoConfigStore.getSnapshot()).toMatchObject({
      config: {
        containerId: 'agent-container',
      },
      panelType: 'CONVERSATION_PANEL',
      activePanelOperatorData: null,
    });
    expect(aicoConfigStore.getSnapshot().config?.name).toBeUndefined();
    expect(aicoConfigStore.getSnapshot().config?.welcome).toBeUndefined();
    expect(aicoConfigStore.getSnapshot().config).not.toHaveProperty('capabilityBusinessNames');
  });
  it('fails soft for invalid load and display handler payloads', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const runtime = await loadRegisteredPiu();
    const handlers = runtime.getHandlers();
    const { aiAgentPiuRuntimeStore } = await import('../src/piu/runtimeStore.ts');

    handlers.loadAIAgent({});
    handlers.loadAIAgent({ containerId: 'missing-agent-container' });
    handlers.displayAIAgent(null);
    await flushPromises();

    expect(runtime.renderRootMock).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith('[AICOPIU] loadAIAgent requires containerId.');
    expect(warn).toHaveBeenCalledWith("[AICOPIU] Container 'missing-agent-container' was not found.");
    expect(warn).toHaveBeenCalledWith('[AICOPIU] displayAIAgent requires a display state payload.');
    expect(aiAgentPiuRuntimeStore.getSnapshot().display).toEqual({ showEntrance: true, showPanel: false, minimized: false });
  });

  it('normalizes display state and routes locale, theme, and question handlers through PIU state', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const runtime = await loadRegisteredPiu();
    const handlers = runtime.getHandlers();
    const { aiAgentPiuRuntimeStore } = await import('../src/piu/runtimeStore.ts');

    handlers.displayAIAgent({ showEntrance: false, showPanel: true });
    expect(aiAgentPiuRuntimeStore.getSnapshot().display).toEqual({ showEntrance: false, showPanel: true, minimized: false });

    handlers.switchLocale('en-us');
    expect(aiAgentPiuRuntimeStore.getSnapshot().site.locale).toBe('en-us');

    handlers.switchLocale('en');
    expect(aiAgentPiuRuntimeStore.getSnapshot().site.locale).toBe('en-us');
    expect(warn).toHaveBeenCalledWith("[AICOPIU] Unsupported locale. Expected 'zh-cn' or 'en-us'.");

    handlers.switchTheme('evening');
    expect(aiAgentPiuRuntimeStore.getSnapshot().site.theme).toBe('evening');

    handlers.switchTheme('dark');
    expect(aiAgentPiuRuntimeStore.getSnapshot().site.theme).toBe('evening');
    expect(warn).toHaveBeenCalledWith("[AICOPIU] Unsupported theme. Expected 'lightday' or 'evening'.");

    handlers.sendQuestionToLui({ question: 'cell alarm query' });
    expect(aiAgentPiuRuntimeStore.getSnapshot().display).toEqual({ showEntrance: true, showPanel: true, minimized: false });
    expect(aiAgentPiuRuntimeStore.getSnapshot().pendingQuestion).toMatchObject({
      question: 'cell alarm query',
      isSend: false,
    });
  });

  it('drains pending questions after the composer bridge becomes ready', async () => {
    const runtime = await loadPiuRuntimeComponent();
    const sendQuestion = vi.fn().mockResolvedValue(true);

    runtime.aiAgentPiuRuntimeStore.queueQuestion({ question: 'cell alarm query', isSend: true });
    render(<runtime.AIAgentPiuRuntime />);

    expect(sendQuestion).not.toHaveBeenCalled();

    const bridgeRef = runtime.getBridgeRef();
    expect(bridgeRef).toBeDefined();
    bridgeRef.current = { sendQuestion };

    await waitFor(() => expect(sendQuestion).toHaveBeenCalledTimes(1));

    expect(sendQuestion).toHaveBeenCalledWith(
      expect.objectContaining({
        question: 'cell alarm query',
        isSend: true,
      }),
    );

    await waitFor(() => expect(runtime.aiAgentPiuRuntimeStore.getSnapshot().pendingQuestion).toBeNull());
  });

  it('uses PIU runtime state and sessionStorage for collaborative session navigation', async () => {
    const { AI_AGENT_PIU_ACTIVE_SESSION_STORAGE_KEY } = await import('../src/piu/activeSessionStorage.ts');
    sessionStorage.setItem(AI_AGENT_PIU_ACTIVE_SESSION_STORAGE_KEY, 'session-stored');
    const runtime = await loadPiuRuntimeComponent();
    const initialPathname = window.location.pathname;

    render(<runtime.AIAgentPiuRuntime />);

    expect(runtime.getNavigation().sessionId).toBe('session-stored');
    expect(runtime.aiAgentPiuRuntimeStore.getSnapshot().activeSessionId).toBe('session-stored');

    act(() => {
      runtime.getNavigation().openSession('session-picked');
    });

    expect(sessionStorage.getItem(AI_AGENT_PIU_ACTIVE_SESSION_STORAGE_KEY)).toBe('session-picked');
    expect(runtime.aiAgentPiuRuntimeStore.getSnapshot().activeSessionId).toBe('session-picked');
    expect(runtime.aiAgentPiuRuntimeStore.getSnapshot().activeSessionTitle).toBeNull();
    expect(window.location.pathname).toBe(initialPathname);

    act(() => {
      runtime.getNavigation().openNewSession();
    });

    expect(sessionStorage.getItem(AI_AGENT_PIU_ACTIVE_SESSION_STORAGE_KEY)).toBeNull();
    expect(runtime.aiAgentPiuRuntimeStore.getSnapshot().activeSessionId).toBeNull();
    expect(runtime.aiAgentPiuRuntimeStore.getSnapshot().activeSessionTitle).toBeNull();
    expect(window.location.pathname).toBe(initialPathname);
  });

  it('keeps the expand panel boundary at the base width while a wider PIU panel overlays it', async () => {
    const runtime = await loadPiuRuntimeComponent();
    const { expandPanelStore } = await import('../src/features/expand-panel/ExpandPanelStore.ts');
    runtime.aiAgentPiuRuntimeStore.openPanel();
    act(() => {
      expandPanelStore.getState().setView(<div data-testid="expand-panel-view" />);
      expandPanelStore.getState().open();
    });

    render(<runtime.AIAgentPiuRuntime />);

    const region = screen.getByTestId('ai-agent-expand-panel-region');
    expect(region.style.right).toBe('484px');

    act(() => {
      runtime.aiAgentPiuRuntimeStore.resizeDocked(684);
    });

    expect(screen.getByTestId('ai-agent-piu-panel').style.width).toBe('684px');
    expect(region.style.right).toBe('484px');

    runtime.aiAgentPiuRuntimeStore.setDockedMinWidth(400);
    act(() => {
      runtime.aiAgentPiuRuntimeStore.resizeDocked(400);
    });

    expect(screen.getByTestId('ai-agent-piu-panel').style.width).toBe('400px');
    expect(region.style.right).toBe('400px');
  });

  it('opens favorites in the shared left expand panel without changing the current URL', async () => {
    const runtime = await loadPiuRuntimeComponent();
    runtime.aiAgentPiuRuntimeStore.openSession('session-current', 'Current session');
    runtime.aiAgentPiuRuntimeStore.openPanel();
    const initialHref = window.location.href;

    render(<runtime.AIAgentPiuRuntime />);

    fireEvent.click(screen.getByRole('button', { name: '收藏列表' }));

    expect(screen.getByTestId('ai-agent-expand-panel-region')).toBeTruthy();
    expect(screen.getByTestId('favorite-turns-panel')).toBeTruthy();
    expect(screen.queryByTestId('piu-favorites-modal')).toBeNull();
    expect(screen.getByTestId('favorite-turns-panel').closest('[data-testid="expand-panel-container"]')).toBeTruthy();
    expect(runtime.aiAgentPiuRuntimeStore.getSnapshot().activeSessionId).toBe('session-current');
    expect(window.location.href).toBe(initialHref);
    expect(screen.getByTestId('chat-page-core').getAttribute('data-surface-visible')).toBe('true');

    fireEvent.click(screen.getByTestId('expand-panel-close-button'));

    expect(screen.queryByTestId('ai-agent-expand-panel-region')).toBeNull();
    expect(runtime.aiAgentPiuRuntimeStore.getSnapshot().activeSessionId).toBe('session-current');
    expect(window.location.href).toBe(initialHref);
    expect(screen.getByTestId('chat-page-core').getAttribute('data-surface-visible')).toBe('true');

    fireEvent.click(screen.getByRole('button', { name: '收藏列表' }));
    fireEvent.click(screen.getByRole('button', { name: '打开收藏会话' }));

    expect(screen.queryByTestId('ai-agent-expand-panel-region')).toBeNull();
    expect(runtime.aiAgentPiuRuntimeStore.getSnapshot().activeSessionId).toBe('session-favorite');
    expect(window.location.href).toBe(initialHref);
  });

  it.each([
    ['zh-CN', 'lightday', '收藏列表', '记忆管理', '投诉历史', '定时任务', 'light'],
    ['zh-CN', 'evening', '收藏列表', '记忆管理', '投诉历史', '定时任务', 'dark'],
    ['en-US', 'lightday', 'Favorites List', 'Memory Management', 'Complaint History', 'Scheduled tasks', 'light'],
    ['en-US', 'evening', 'Favorites List', 'Memory Management', 'Complaint History', 'Scheduled tasks', 'dark'],
  ] as const)(
    'preserves collaborative menu order and shared identities for %s/%s',
    async (language, theme, favoritesName, memoryName, complaintName, cronName, iconTheme) => {
      const runtime = await loadPiuRuntimeComponent();
      const [{ aicoConfigStore }, { useComplaintFeatureStore }, { default: runtimeI18n }] = await Promise.all([
        import('../src/aico-config/AICOConfigStore.ts'),
        import('../src/state/complaintFeatureStore.ts'),
        import('../src/i18n/index.ts'),
      ]);
      aicoConfigStore.setConfig({
        operators: [
          {
            enName: 'custom-inner',
            zhName: '协作式专有入口',
            position: 'INNER',
            type: 'PANEL',
            lightIcon: '/custom-light.svg',
            darkIcon: '/custom-dark.svg',
            data: { piuName: 'CustomPIU', piuVersion: '1.0.0', renderFunc: 'render' },
          },
        ],
      });
      useComplaintFeatureStore.setState({ enabled: true, status: 'ready' });
      await runtimeI18n.changeLanguage(language);
      runtime.aiAgentPiuRuntimeStore.switchTheme(theme);
      runtime.aiAgentPiuRuntimeStore.openPanel();

      render(<runtime.AIAgentPiuRuntime />);

      const moreMenu = screen.getByTestId('piu-more-menu').parentElement;
      expect(moreMenu).not.toBeNull();
      expect(
        within(moreMenu as HTMLElement)
          .getAllByTestId(/^piu-menu-item-/)
          .map((item) => item.getAttribute('data-testid')),
      ).toEqual([
        'piu-menu-item-custom-inner',
        'piu-menu-item-favorites',
        'piu-menu-item-memory',
        'piu-menu-item-knowledge-import',
        'piu-menu-item-complaint',
        'piu-menu-item-cron-tasks',
        'piu-menu-item-toggle-dock-float',
      ]);
      const expectedEntries = [
        ['favorites', favoritesName, `favorites-${iconTheme}.svg`],
        ['memory', memoryName, `memory-${iconTheme}.svg`],
        ['complaint', complaintName, `complaint-${iconTheme}.svg`],
        ['cron-tasks', cronName, `cron-${iconTheme}.svg`],
      ] as const;
      for (const [key, name, iconFile] of expectedEntries) {
        const item = screen.getByTestId(`piu-menu-item-${key}`);
        expect(item.textContent).toContain(name);
        const icon = item.querySelector('img');
        expect(icon?.getAttribute('src')).toContain(iconFile);
        expect(icon?.getAttribute('alt')).toBe('');
        expect(icon?.getAttribute('aria-hidden')).toBe('true');
        expect(icon?.style.width).toBe('16px');
        expect(icon?.style.height).toBe('16px');
      }
    },
  );

  it('hides portal ability gated entries when their switches are false', async () => {
    const runtime = await loadPiuRuntimeComponent();
    runtime.runtimeConfig.portalAbilityConfig = {
      suggestedQuestionsEnabled: true,
      cronTasksEnabled: false,
      longTermMemoryManagementEnabled: false,
      knowledgeImportEnabled: false,
      fullProcessEnabled: true,
    };
    runtime.aiAgentPiuRuntimeStore.openPanel();

    render(<runtime.AIAgentPiuRuntime />);

    expect(screen.queryByTestId('piu-menu-item-cron-tasks')).toBeNull();
    expect(screen.queryByTestId('piu-menu-item-memory')).toBeNull();
    expect(screen.queryByTestId('piu-menu-item-knowledge-import')).toBeNull();
    expect(screen.getByTestId('piu-menu-item-favorites')).toBeTruthy();
    expect(screen.getByTestId('piu-menu-item-toggle-dock-float')).toBeTruthy();
  });

  it('opens complaint history in the shared panel with one page header', async () => {
    const runtime = await loadPiuRuntimeComponent();
    const [{ useComplaintFeatureStore }, { default: runtimeI18n }] = await Promise.all([
      import('../src/state/complaintFeatureStore.ts'),
      import('../src/i18n/index.ts'),
    ]);
    useComplaintFeatureStore.setState({ enabled: true, status: 'ready' });
    await runtimeI18n.changeLanguage('zh-CN');
    runtime.aiAgentPiuRuntimeStore.openPanel();

    render(<runtime.AIAgentPiuRuntime />);
    fireEvent.click(screen.getByRole('button', { name: '投诉历史' }));

    expect(screen.getByTestId('ai-agent-expand-panel-region')).toBeTruthy();
    expect(screen.getAllByRole('heading', { name: '投诉历史', level: 1 })).toHaveLength(1);
    expect(screen.getAllByTestId('page-layout-header')).toHaveLength(1);
  });

  it('opens cron tasks in expand panel and returns to composer on create-from-session', async () => {
    vi.doMock('../src/services/cronTaskService.ts', () => ({
      cronTaskService: {
        listCronTasks: vi.fn().mockResolvedValue({ tasks: [], total: 0 }),
        createCronTask: vi.fn(),
        updateCronTask: vi.fn(),
        deleteCronTask: vi.fn(),
        executeCronTask: vi.fn(),
        listCronTaskExecutions: vi.fn(),
      },
    }));
    const runtime = await loadPiuRuntimeComponent();
    runtime.aiAgentPiuRuntimeStore.openPanel();
    sessionStorage.clear();

    render(<runtime.AIAgentPiuRuntime />);

    fireEvent.click(screen.getByRole('button', { name: '定时任务' }));

    await waitFor(() => {
      expect(screen.getByTestId('cron-task-dashboard-page')).toBeTruthy();
    });
    expect(screen.getAllByTestId('page-layout-header')).toHaveLength(1);
    expect(screen.getAllByTestId('page-layout-scroll-viewport')).toHaveLength(1);

    fireEvent.click(screen.getByText('通过会话创建'));

    await waitFor(() => {
      expect(screen.queryByTestId('ai-agent-expand-panel-region')).toBeNull();
    });
    expect(runtime.aiAgentPiuRuntimeStore.getSnapshot().activeSessionId).toBeNull();
    expect(sessionStorage.getItem('draft-__new__')).toBeTruthy();
  });

  it('passes a clicked history title as display-only navigation state', async () => {
    const runtime = await loadPiuRuntimeComponent();
    const { useSessionStore } = await import('../src/state/sessionStore.ts');
    useSessionStore.setState({
      sessions: [{ sessionId: 'session-picked', displayTitle: 'Picked history title', lastActivityAt: '2026-06-29T12:00:00.000Z' }],
      hasMore: false,
      historyOffset: 1,
    });
    runtime.aiAgentPiuRuntimeStore.openPanel();

    render(<runtime.AIAgentPiuRuntime />);

    fireEvent.click(screen.getByRole('button', { name: 'Picked history title' }));

    await waitFor(() => expect(runtime.getNavigation().sessionId).toBe('session-picked'));
    expect(runtime.getNavigation().sessionTitle).toBe('Picked history title');
    expect(runtime.aiAgentPiuRuntimeStore.getSnapshot().activeSessionTitle).toBe('Picked history title');
  });

  it('clears a restored collaborative session when loading that session fails', async () => {
    const { AI_AGENT_PIU_ACTIVE_SESSION_STORAGE_KEY } = await import('../src/piu/activeSessionStorage.ts');
    sessionStorage.setItem(AI_AGENT_PIU_ACTIVE_SESSION_STORAGE_KEY, 'session-stored');
    const runtime = await loadPiuRuntimeComponent();

    render(<runtime.AIAgentPiuRuntime />);

    act(() => {
      runtime.getNavigation().onSessionLoadFailure?.('session-stored');
    });

    expect(sessionStorage.getItem(AI_AGENT_PIU_ACTIVE_SESSION_STORAGE_KEY)).toBeNull();
    expect(runtime.aiAgentPiuRuntimeStore.getSnapshot().activeSessionId).toBeNull();
  });

  it('keeps history search controls from starting a panel drag', async () => {
    const runtime = await loadPiuRuntimeComponent();
    runtime.aiAgentPiuRuntimeStore.openPanel();

    render(<runtime.AIAgentPiuRuntime />);

    expect(runtime.aiAgentPiuRuntimeStore.getSnapshot().layout.kind).toBe('docked');

    fireEvent.pointerDown(screen.getByRole('textbox', { name: '搜索历史' }), { button: 0, clientX: 120, clientY: 120 });

    expect(runtime.aiAgentPiuRuntimeStore.getSnapshot().layout.kind).toBe('docked');

    fireEvent.pointerDown(screen.getByLabelText('创建时间范围'), { button: 0, clientX: 160, clientY: 120 });

    expect(runtime.aiAgentPiuRuntimeStore.getSnapshot().layout.kind).toBe('docked');
  });

  it('keeps PIU history at ten by default and expands the visible window for search', async () => {
    const runtime = await loadPiuRuntimeComponent();
    const { useSessionStore } = await import('../src/state/sessionStore.ts');
    const sessions = Array.from({ length: 20 }, (_, index) => ({
      sessionId: `session-piu-${index + 1}`,
      displayTitle: `PIU Session ${index + 1}`,
      lastActivityAt: '2026-06-29T12:00:00.000Z',
    }));
    useSessionStore.setState({
      sessions,
      hasMore: false,
      historyOffset: sessions.length,
      historySearchQuery: {},
    });
    runtime.aiAgentPiuRuntimeStore.openPanel();

    render(<runtime.AIAgentPiuRuntime />);

    expect(screen.getByText('PIU Session 10')).toBeTruthy();
    expect(screen.queryByText('PIU Session 11')).toBeNull();

    act(() => {
      useSessionStore.setState({ historySearchQuery: { q: 'alarm' } });
    });

    await waitFor(() => {
      expect(screen.getByText('PIU Session 20')).toBeTruthy();
    });
    expect(runtime.aiAgentPiuRuntimeStore.getSnapshot().layout.kind).toBe('docked');
  });

  it('opens PIU history as recent sessions instead of reusing stale search filters', async () => {
    const runtime = await loadPiuRuntimeComponent();
    const { PIU_HISTORY_INITIAL_LIMIT, useSessionStore } = await import('../src/state/sessionStore.ts');
    const loadSessions = vi.fn().mockResolvedValue(undefined);
    useSessionStore.setState({
      historySearchQuery: { q: 'stale search' },
      loadSessions,
    });
    runtime.aiAgentPiuRuntimeStore.openPanel();

    render(<runtime.AIAgentPiuRuntime />);

    fireEvent.click(screen.getByTestId('ai-agent-piu-history-trigger'));

    await waitFor(() => {
      expect(loadSessions).toHaveBeenCalledWith({
        limit: PIU_HISTORY_INITIAL_LIMIT,
        query: {},
      });
    });
  });

  it('aggregates activity outside the visible conversation surface without clearing it when History opens', async () => {
    const runtime = await loadPiuRuntimeComponent();
    const { useSessionActivityStore } = await import('../src/state/sessionActivityStore.ts');
    const activity = {
      sessionId: 'session-attention',
      status: 'UNREAD_RESULT' as const,
      activityId: 'activity-attention',
    };
    useSessionActivityStore.setState({
      entriesBySessionId: { 'session-attention': activity },
    });
    runtime.aiAgentPiuRuntimeStore.openPanel();

    render(<runtime.AIAgentPiuRuntime />);

    expect(screen.getByTestId('ai-agent-piu-history-activity-dot')).toBeTruthy();
    fireEvent.click(screen.getByTestId('ai-agent-piu-history-trigger'));
    expect(screen.getByTestId('ai-agent-piu-history-activity-dot')).toBeTruthy();
    expect(useSessionActivityStore.getState().entriesBySessionId['session-attention']).toEqual(activity);

    act(() => {
      runtime.aiAgentPiuRuntimeStore.openSession('session-attention', 'Attention session');
    });
    await waitFor(() => {
      expect(screen.queryByTestId('ai-agent-piu-history-activity-dot')).toBeNull();
    });

    act(() => {
      runtime.aiAgentPiuRuntimeStore.closePanel();
    });
    await waitFor(() => {
      expect(screen.getByTestId('ai-agent-piu-history-activity-dot')).toBeTruthy();
    });
  });

  it('mounts one activity controller and forwards PIU visibility to the shared ChatPageCore', async () => {
    const runtime = await loadPiuRuntimeComponent();
    runtime.aiAgentPiuRuntimeStore.openPanel();

    render(<runtime.AIAgentPiuRuntime />);

    expect(screen.getAllByTestId('session-activity-controller')).toHaveLength(1);
    expect(screen.getByTestId('chat-page-core').getAttribute('data-surface-visible')).toBe('true');

    act(() => {
      runtime.aiAgentPiuRuntimeStore.minimize();
    });
    await waitFor(() => {
      expect(screen.getByTestId('chat-page-core').getAttribute('data-surface-visible')).toBe('false');
    });

    act(() => {
      runtime.aiAgentPiuRuntimeStore.closePanel();
    });
    await waitFor(() => {
      expect(screen.getByTestId('chat-page-core').getAttribute('data-surface-visible')).toBe('false');
    });
  });

  it('wires PIU help actions to a real help modal', async () => {
    const runtime = await loadPiuRuntimeComponent();
    runtime.aiAgentPiuRuntimeStore.openPanel();

    render(<runtime.AIAgentPiuRuntime />);

    fireEvent.click(screen.getByTestId('chat-page-open-help'));

    expect(screen.getByTestId('command-help-modal')).toBeTruthy();
  });

  it('minimizeAIAgent handler triggers minimized state without affecting display', async () => {
    const runtime = await loadRegisteredPiu();
    const { aiAgentPiuRuntimeStore } = await import('../src/piu/runtimeStore.ts');
    const handlers = runtime.getHandlers();

    aiAgentPiuRuntimeStore.openPanel();
    expect(aiAgentPiuRuntimeStore.getSnapshot().display.showPanel).toBe(true);

    handlers.minimizeAIAgent();
    expect(aiAgentPiuRuntimeStore.getSnapshot().display.minimized).toBe(true);
    expect(aiAgentPiuRuntimeStore.getSnapshot().display.showEntrance).toBe(true);
    expect(aiAgentPiuRuntimeStore.getSnapshot().display.showPanel).toBe(true);
  });

  it('minimizeAIAgent is a no-op when panel is hidden', async () => {
    const runtime = await loadRegisteredPiu();
    const { aiAgentPiuRuntimeStore } = await import('../src/piu/runtimeStore.ts');
    const handlers = runtime.getHandlers();

    aiAgentPiuRuntimeStore.display({ showEntrance: true, showPanel: false });
    handlers.minimizeAIAgent();
    expect(aiAgentPiuRuntimeStore.getSnapshot().display.minimized).toBe(false);
    expect(aiAgentPiuRuntimeStore.getSnapshot().display.showPanel).toBe(false);
  });

  it('CustomEvent with minimized true triggers minimization', async () => {
    await loadRegisteredPiu();
    const { aiAgentPiuRuntimeStore } = await import('../src/piu/runtimeStore.ts');
    aiAgentPiuRuntimeStore.openPanel();

    window.dispatchEvent(new CustomEvent('nextagent:piu-display-change', { detail: { minimized: true } }));
    expect(aiAgentPiuRuntimeStore.getSnapshot().display.minimized).toBe(true);
  });

  it('CustomEvent with minimized false is ignored', async () => {
    await loadRegisteredPiu();
    const { aiAgentPiuRuntimeStore } = await import('../src/piu/runtimeStore.ts');
    aiAgentPiuRuntimeStore.openPanel();
    aiAgentPiuRuntimeStore.minimize();
    expect(aiAgentPiuRuntimeStore.getSnapshot().display.minimized).toBe(true);

    window.dispatchEvent(new CustomEvent('nextagent:piu-display-change', { detail: { minimized: false } }));
    expect(aiAgentPiuRuntimeStore.getSnapshot().display.minimized).toBe(true);
  });

  it('CustomEvent without detail is ignored', async () => {
    await loadRegisteredPiu();
    const { aiAgentPiuRuntimeStore } = await import('../src/piu/runtimeStore.ts');
    aiAgentPiuRuntimeStore.openPanel();

    window.dispatchEvent(new CustomEvent('nextagent:piu-display-change'));
    expect(aiAgentPiuRuntimeStore.getSnapshot().display.minimized).toBe(false);
  });

  it('displayAIAgent does not restore from minimized', async () => {
    const runtime = await loadRegisteredPiu();
    const { aiAgentPiuRuntimeStore } = await import('../src/piu/runtimeStore.ts');
    const handlers = runtime.getHandlers();

    aiAgentPiuRuntimeStore.openPanel();
    aiAgentPiuRuntimeStore.minimize();
    expect(aiAgentPiuRuntimeStore.getSnapshot().display.minimized).toBe(true);

    handlers.displayAIAgent({ showEntrance: true, showPanel: true });
    expect(aiAgentPiuRuntimeStore.getSnapshot().display.minimized).toBe(true);
  });

  it('minimized panel renders MinimizedInputBox and hides header/body', async () => {
    const runtime = await loadPiuRuntimeComponent();
    runtime.aiAgentPiuRuntimeStore.openPanel();
    runtime.aiAgentPiuRuntimeStore.minimize();

    render(<runtime.AIAgentPiuRuntime />);

    const input = screen.getByTestId('ai-agent-piu-minimized-input');
    expect(input).toBeTruthy();
    expect(input.tagName).toBe('TEXTAREA');
    expect((input as HTMLTextAreaElement).value).toBe('');

    const panel = screen.getByTestId('ai-agent-piu-panel');
    expect(panel.className).toContain('minimized');

    expect(screen.getByTestId('chat-page-core')).toBeTruthy();
  });

  it('focus on MinimizedInputBox restores panel', async () => {
    const runtime = await loadPiuRuntimeComponent();
    runtime.aiAgentPiuRuntimeStore.openPanel();
    runtime.aiAgentPiuRuntimeStore.minimize();

    render(<runtime.AIAgentPiuRuntime />);

    const input = screen.getByTestId('ai-agent-piu-minimized-input');
    fireEvent.focus(input);

    expect(runtime.aiAgentPiuRuntimeStore.getSnapshot().display.minimized).toBe(false);
    expect(screen.queryByTestId('ai-agent-piu-minimized-input')).toBeNull();
  });

  it('expandPanel is closed on minimize and does not reopen on restore', async () => {
    const runtime = await loadPiuRuntimeComponent();
    const { expandPanelStore } = await import('../src/features/expand-panel/ExpandPanelStore.ts');
    runtime.aiAgentPiuRuntimeStore.openPanel();
    expandPanelStore.getState().open();
    expect(expandPanelStore.getState().isOpen).toBe(true);

    runtime.aiAgentPiuRuntimeStore.minimize();
    expect(expandPanelStore.getState().isOpen).toBe(false);

    runtime.aiAgentPiuRuntimeStore.restoreFromMinimized();
    expect(expandPanelStore.getState().isOpen).toBe(false);
  });

  it('ChatPageCore stays mounted during minimization', async () => {
    const runtime = await loadPiuRuntimeComponent();
    runtime.aiAgentPiuRuntimeStore.openPanel();

    const { rerender } = render(<runtime.AIAgentPiuRuntime />);
    expect(screen.getByTestId('chat-page-core')).toBeTruthy();

    runtime.aiAgentPiuRuntimeStore.minimize();
    rerender(<runtime.AIAgentPiuRuntime />);
    expect(screen.getByTestId('chat-page-core')).toBeTruthy();

    runtime.aiAgentPiuRuntimeStore.restoreFromMinimized();
    rerender(<runtime.AIAgentPiuRuntime />);
    expect(screen.getByTestId('chat-page-core')).toBeTruthy();
  });
});

describe('handleHistoricalChatReplay handler', () => {
  it('registers handleHistoricalChatReplay in collaborative PIU', async () => {
    const runtime = await loadRegisteredPiu();
    expect(runtime.getHandlers().handleHistoricalChatReplay).toBeDefined();
    expect(typeof runtime.getHandlers().handleHistoricalChatReplay).toBe('function');
  });

  it('opens panel and stores replay entry on valid payload', async () => {
    const runtime = await loadRegisteredPiu();
    const { aiAgentPiuRuntimeStore } = await import('../src/piu/runtimeStore.ts');
    const { historicalChatReplayStore } = await import('../src/piu/historicalChatReplayStore.ts');
    historicalChatReplayStore.getState().clearAllReplays();

    aiAgentPiuRuntimeStore.display({ showEntrance: true, showPanel: false, minimized: false });
    expect(aiAgentPiuRuntimeStore.getSnapshot().display.showPanel).toBe(false);

    runtime.getHandlers().handleHistoricalChatReplay({
      piuName: 'chart-piu',
      piuVersion: '1.0.0',
      method: 'renderChart',
      chatId: 'chat-A',
      data: { type: 'bar' },
    });

    expect(aiAgentPiuRuntimeStore.getSnapshot().display.showPanel).toBe(true);
    expect(aiAgentPiuRuntimeStore.getSnapshot().display.minimized).toBe(false);
    expect(historicalChatReplayStore.getState().entries.size).toBe(1);
    expect(historicalChatReplayStore.getState().entries.get('chat-A')?.piuName).toBe('chart-piu');
  });

  it('restores from minimized state before replay', async () => {
    const runtime = await loadRegisteredPiu();
    const { aiAgentPiuRuntimeStore } = await import('../src/piu/runtimeStore.ts');
    const { historicalChatReplayStore } = await import('../src/piu/historicalChatReplayStore.ts');
    historicalChatReplayStore.getState().clearAllReplays();

    aiAgentPiuRuntimeStore.openPanel();
    aiAgentPiuRuntimeStore.minimize();
    expect(aiAgentPiuRuntimeStore.getSnapshot().display.minimized).toBe(true);

    runtime.getHandlers().handleHistoricalChatReplay({
      piuName: 'chart-piu',
      piuVersion: '1.0.0',
      method: 'renderChart',
      chatId: 'chat-min',
      data: {},
    });

    expect(aiAgentPiuRuntimeStore.getSnapshot().display.minimized).toBe(false);
    expect(historicalChatReplayStore.getState().entries.has('chat-min')).toBe(true);
  });

  it('warns and returns when piuName is missing', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const runtime = await loadRegisteredPiu();
    const { historicalChatReplayStore } = await import('../src/piu/historicalChatReplayStore.ts');
    historicalChatReplayStore.getState().clearAllReplays();

    runtime.getHandlers().handleHistoricalChatReplay({
      piuVersion: '1.0.0',
      method: 'renderChart',
      chatId: 'chat-A',
      data: {},
    });

    expect(warn).toHaveBeenCalled();
    expect(historicalChatReplayStore.getState().entries.size).toBe(0);
  });

  it('warns and returns when chatId is missing', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const runtime = await loadRegisteredPiu();
    const { historicalChatReplayStore } = await import('../src/piu/historicalChatReplayStore.ts');
    historicalChatReplayStore.getState().clearAllReplays();

    runtime.getHandlers().handleHistoricalChatReplay({
      piuName: 'chart-piu',
      piuVersion: '1.0.0',
      method: 'renderChart',
      data: {},
    });

    expect(warn).toHaveBeenCalled();
    expect(historicalChatReplayStore.getState().entries.size).toBe(0);
  });

  it('preserves string data in store entry', async () => {
    const runtime = await loadRegisteredPiu();
    const { aiAgentPiuRuntimeStore } = await import('../src/piu/runtimeStore.ts');
    const { historicalChatReplayStore } = await import('../src/piu/historicalChatReplayStore.ts');
    historicalChatReplayStore.getState().clearAllReplays();
    aiAgentPiuRuntimeStore.openPanel();

    runtime.getHandlers().handleHistoricalChatReplay({
      piuName: 'chart-piu',
      piuVersion: '1.0.0',
      method: 'renderChart',
      chatId: 'chat-str',
      data: 'some string',
    });

    expect(historicalChatReplayStore.getState().entries.get('chat-str')?.data).toBe('some string');
  });

  it('preserves array data in store entry', async () => {
    const runtime = await loadRegisteredPiu();
    const { aiAgentPiuRuntimeStore } = await import('../src/piu/runtimeStore.ts');
    const { historicalChatReplayStore } = await import('../src/piu/historicalChatReplayStore.ts');
    historicalChatReplayStore.getState().clearAllReplays();
    aiAgentPiuRuntimeStore.openPanel();

    runtime.getHandlers().handleHistoricalChatReplay({
      piuName: 'chart-piu',
      piuVersion: '1.0.0',
      method: 'renderChart',
      chatId: 'chat-arr',
      data: [1, 2, 3],
    });

    expect(historicalChatReplayStore.getState().entries.get('chat-arr')?.data).toEqual([1, 2, 3]);
  });

  it('preserves null data in store entry', async () => {
    const runtime = await loadRegisteredPiu();
    const { aiAgentPiuRuntimeStore } = await import('../src/piu/runtimeStore.ts');
    const { historicalChatReplayStore } = await import('../src/piu/historicalChatReplayStore.ts');
    historicalChatReplayStore.getState().clearAllReplays();
    aiAgentPiuRuntimeStore.openPanel();

    runtime.getHandlers().handleHistoricalChatReplay({
      piuName: 'chart-piu',
      piuVersion: '1.0.0',
      method: 'renderChart',
      chatId: 'chat-null',
      data: null,
    });

    expect(historicalChatReplayStore.getState().entries.get('chat-null')?.data).toBeNull();
  });

  it('preserves plain object data', async () => {
    const runtime = await loadRegisteredPiu();
    const { aiAgentPiuRuntimeStore } = await import('../src/piu/runtimeStore.ts');
    const { historicalChatReplayStore } = await import('../src/piu/historicalChatReplayStore.ts');
    historicalChatReplayStore.getState().clearAllReplays();
    aiAgentPiuRuntimeStore.openPanel();

    runtime.getHandlers().handleHistoricalChatReplay({
      piuName: 'chart-piu',
      piuVersion: '1.0.0',
      method: 'renderChart',
      chatId: 'chat-obj',
      data: { chartType: 'bar', values: [1, 2, 3] },
    });

    expect(historicalChatReplayStore.getState().entries.get('chat-obj')?.data).toEqual({
      chartType: 'bar',
      values: [1, 2, 3],
    });
  });

  it('collects sibling fields into extraPayload', async () => {
    const runtime = await loadRegisteredPiu();
    const { aiAgentPiuRuntimeStore } = await import('../src/piu/runtimeStore.ts');
    const { historicalChatReplayStore } = await import('../src/piu/historicalChatReplayStore.ts');
    historicalChatReplayStore.getState().clearAllReplays();
    aiAgentPiuRuntimeStore.openPanel();

    runtime.getHandlers().handleHistoricalChatReplay({
      piuName: 'chart-piu',
      piuVersion: '1.0.0',
      method: 'renderChart',
      chatId: 'chat-sibling',
      isHistory: true,
      data: { type: 'bar' },
    });

    const entry = historicalChatReplayStore.getState().entries.get('chat-sibling');
    expect(entry?.extraPayload).toEqual({ chatId: 'chat-sibling', isHistory: true });
  });

  it('deduplicates by chatId', async () => {
    const runtime = await loadRegisteredPiu();
    const { aiAgentPiuRuntimeStore } = await import('../src/piu/runtimeStore.ts');
    const { historicalChatReplayStore } = await import('../src/piu/historicalChatReplayStore.ts');
    historicalChatReplayStore.getState().clearAllReplays();
    aiAgentPiuRuntimeStore.openPanel();

    runtime.getHandlers().handleHistoricalChatReplay({
      piuName: 'chart-piu',
      piuVersion: '1.0.0',
      method: 'renderChart',
      chatId: 'chat-dup',
      data: { type: 'bar' },
    });
    runtime.getHandlers().handleHistoricalChatReplay({
      piuName: 'chart-piu',
      piuVersion: '1.0.0',
      method: 'renderChart',
      chatId: 'chat-dup',
      data: { type: 'line' },
    });

    expect(historicalChatReplayStore.getState().entries.size).toBe(1);
    expect(historicalChatReplayStore.getState().entries.get('chat-dup')?.data).toEqual({ type: 'bar' });
  });

  it('clears active session before replay without clearing existing replay entries', async () => {
    const runtime = await loadRegisteredPiu();
    const { aiAgentPiuRuntimeStore } = await import('../src/piu/runtimeStore.ts');
    const { historicalChatReplayStore } = await import('../src/piu/historicalChatReplayStore.ts');
    historicalChatReplayStore.getState().clearAllReplays();
    aiAgentPiuRuntimeStore.openPanel();

    aiAgentPiuRuntimeStore.openSession('session-existing');
    expect(aiAgentPiuRuntimeStore.getSnapshot().activeSessionId).toBe('session-existing');

    runtime.getHandlers().handleHistoricalChatReplay({
      piuName: 'chart-piu',
      piuVersion: '1.0.0',
      method: 'renderChart',
      chatId: 'chat-A',
      data: {},
    });

    expect(aiAgentPiuRuntimeStore.getSnapshot().activeSessionId).toBeNull();
    expect(historicalChatReplayStore.getState().entries.has('chat-A')).toBe(true);
  });
});

describe('historical chat replay clear triggers', () => {
  it('closePanel clears replay entries', async () => {
    const runtime = await loadRegisteredPiu();
    const { aiAgentPiuRuntimeStore } = await import('../src/piu/runtimeStore.ts');
    const { historicalChatReplayStore } = await import('../src/piu/historicalChatReplayStore.ts');
    aiAgentPiuRuntimeStore.openPanel();

    runtime.getHandlers().handleHistoricalChatReplay({
      piuName: 'chart-piu',
      piuVersion: '1.0.0',
      method: 'renderChart',
      chatId: 'chat-clear',
      data: {},
    });
    expect(historicalChatReplayStore.getState().entries.size).toBe(1);

    aiAgentPiuRuntimeStore.closePanel();
    expect(historicalChatReplayStore.getState().entries.size).toBe(0);
  });

  it('openSession clears replay entries', async () => {
    const runtime = await loadRegisteredPiu();
    const { aiAgentPiuRuntimeStore } = await import('../src/piu/runtimeStore.ts');
    const { historicalChatReplayStore } = await import('../src/piu/historicalChatReplayStore.ts');
    aiAgentPiuRuntimeStore.openPanel();

    runtime.getHandlers().handleHistoricalChatReplay({
      piuName: 'chart-piu',
      piuVersion: '1.0.0',
      method: 'renderChart',
      chatId: 'chat-session',
      data: {},
    });
    expect(historicalChatReplayStore.getState().entries.size).toBe(1);

    aiAgentPiuRuntimeStore.openSession('session-123');
    expect(historicalChatReplayStore.getState().entries.size).toBe(0);
  });

  it('openNewSession clears replay entries', async () => {
    const runtime = await loadRegisteredPiu();
    const { aiAgentPiuRuntimeStore } = await import('../src/piu/runtimeStore.ts');
    const { historicalChatReplayStore } = await import('../src/piu/historicalChatReplayStore.ts');
    aiAgentPiuRuntimeStore.openPanel();

    runtime.getHandlers().handleHistoricalChatReplay({
      piuName: 'chart-piu',
      piuVersion: '1.0.0',
      method: 'renderChart',
      chatId: 'chat-new',
      data: {},
    });
    expect(historicalChatReplayStore.getState().entries.size).toBe(1);

    aiAgentPiuRuntimeStore.openNewSession();
    expect(historicalChatReplayStore.getState().entries.size).toBe(0);
  });

  it('minimize does not clear replay entries', async () => {
    const runtime = await loadRegisteredPiu();
    const { aiAgentPiuRuntimeStore } = await import('../src/piu/runtimeStore.ts');
    const { historicalChatReplayStore } = await import('../src/piu/historicalChatReplayStore.ts');
    aiAgentPiuRuntimeStore.openPanel();

    runtime.getHandlers().handleHistoricalChatReplay({
      piuName: 'chart-piu',
      piuVersion: '1.0.0',
      method: 'renderChart',
      chatId: 'chat-min-persist',
      data: {},
    });
    expect(historicalChatReplayStore.getState().entries.size).toBe(1);

    aiAgentPiuRuntimeStore.minimize();
    expect(historicalChatReplayStore.getState().entries.size).toBe(1);
  });
});

describe('handleHistoricalChatReplay scoped to collaborative PIU only', () => {
  it('immersive entry does not register handleHistoricalChatReplay', async () => {
    vi.resetModules();
    const root = document.createElement('div');
    root.id = 'root';
    document.body.append(root);
    let attachedHandlers: Record<string, unknown> = {};
    vi.doMock('../src/entries/renderRoot.tsx', () => ({
      renderRoot: vi.fn(async (_container: HTMLElement, node: ReactNode) => {
        const fakeRoot: Root = { render: vi.fn(), unmount: vi.fn() } as unknown as Root;
        render(node, { container: _container });
        return fakeRoot;
      }),
      requireRootElement: () => root,
    }));
    vi.doMock('../src/app/ImmersiveApp.tsx', () => ({
      ImmersiveApp: () => <div data-testid="immersive-app" />,
    }));
    vi.stubGlobal('__NEXTAGENT_PACKAGE_VERSION__', PACKAGE_VERSION);
    window.Prel = {
      ready: (callback: () => void) => callback(),
      autoLoad: vi.fn(async () => undefined),
      start: vi.fn((_name: string, _version: string, _deps: readonly string[], callback: (piu: PIU, site: HostSiteContext) => void) => {
        callback(
          {
            id: 'ai-agent-piu',
            name: 'AFWebsitePIU',
            version: PACKAGE_VERSION,
            config: {},
            deps: {},
            isBrowser: true,
            revs: { 'febs.regs': '1', 'febs.server': '1' },
            attach: (_piu: PIU, handlers: Record<string, unknown>) => {
              attachedHandlers = handlers;
            },
            emit: vi.fn(),
          },
          { locale: 'zh-cn', theme: 'lightday' },
        );
      }),
    };

    await import('../src/entries/immersive.tsx');

    expect(Object.keys(attachedHandlers)).not.toContain('handleHistoricalChatReplay');
  });
});

describe('minimize capability is scoped to collaborative PIU only', () => {
  it('immersive entry does not register minimizeAIAgent', async () => {
    vi.resetModules();
    const root = document.createElement('div');
    root.id = 'root';
    document.body.append(root);

    let attachedHandlers: Record<string, unknown> = {};
    vi.doMock('../src/entries/renderRoot.tsx', () => ({
      renderRoot: vi.fn(async (_container: HTMLElement, node: ReactNode) => {
        const fakeRoot: Root = { render: vi.fn(), unmount: vi.fn() } as unknown as Root;
        render(node, { container: _container });
        return fakeRoot;
      }),
      requireRootElement: () => root,
    }));
    vi.doMock('../src/app/ImmersiveApp.tsx', () => ({
      ImmersiveApp: () => <div data-testid="immersive-app" />,
    }));
    vi.stubGlobal('__NEXTAGENT_PACKAGE_VERSION__', PACKAGE_VERSION);
    window.Prel = {
      ready: (callback: () => void) => callback(),
      autoLoad: vi.fn(async () => undefined),
      start: vi.fn((_name: string, _version: string, _deps: readonly string[], callback: (piu: PIU, site: HostSiteContext) => void) => {
        callback(
          {
            id: 'ai-agent-piu',
            name: 'AFWebsitePIU',
            version: PACKAGE_VERSION,
            config: {},
            deps: {},
            isBrowser: true,
            revs: { 'febs.regs': '1', 'febs.server': '1' },
            attach: (_piu: PIU, handlers: Record<string, unknown>) => {
              attachedHandlers = handlers;
            },
            emit: vi.fn(),
          },
          { locale: 'zh-cn', theme: 'lightday' },
        );
      }),
    };

    await import('../src/entries/immersive.tsx');

    expect(Object.keys(attachedHandlers)).not.toContain('minimizeAIAgent');
    expect(Object.keys(attachedHandlers)).not.toContain('renderKnowledge');

    window.dispatchEvent(new CustomEvent('nextagent:piu-display-change', { detail: { minimized: true } }));

    const { aiAgentPiuRuntimeStore } = await import('../src/piu/runtimeStore.ts');
    expect(aiAgentPiuRuntimeStore.getSnapshot().display.minimized).toBe(false);
  });

  it('local entry does not register minimizeAIAgent', async () => {
    vi.resetModules();
    const root = document.createElement('div');
    root.id = 'root';
    document.body.append(root);

    vi.doMock('../src/entries/renderRoot.tsx', () => ({
      renderRoot: vi.fn(async (_container: HTMLElement, node: ReactNode) => {
        const fakeRoot: Root = { render: vi.fn(), unmount: vi.fn() } as unknown as Root;
        render(node, { container: _container });
        return fakeRoot;
      }),
      requireRootElement: () => root,
    }));
    vi.doMock('../src/App.tsx', () => ({
      App: () => <div data-testid="local-app" />,
    }));
    vi.stubGlobal('__NEXTAGENT_PACKAGE_VERSION__', PACKAGE_VERSION);

    await import('../src/entries/local.tsx');

    window.dispatchEvent(new CustomEvent('nextagent:piu-display-change', { detail: { minimized: true } }));

    const { aiAgentPiuRuntimeStore } = await import('../src/piu/runtimeStore.ts');
    expect(aiAgentPiuRuntimeStore.getSnapshot().display.minimized).toBe(false);
  });
});

describe('renderKnowledge capability is scoped to collaborative PIU only', () => {
  it('registers renderKnowledge handler in PIU', async () => {
    const runtime = await loadRegisteredPiu();
    expect(runtime.getHandlers().renderKnowledge).toBeDefined();
  });

  it('creates independent root on first renderKnowledge call', async () => {
    const runtime = await loadRegisteredPiu();
    const container = appendContainer('knowledge-container');
    const handlers = runtime.getHandlers();

    handlers.renderKnowledge({ containerId: 'knowledge-container', data: [] });
    await flushPromises();

    expect(runtime.renderRootMock).toHaveBeenCalledTimes(1);
    expect(runtime.renderRootMock).toHaveBeenLastCalledWith(container, expect.anything(), expect.any(Object));
  });

  it('reuses root for same containerId on renderKnowledge', async () => {
    const runtime = await loadRegisteredPiu();
    appendContainer('knowledge-container');
    const handlers = runtime.getHandlers();

    handlers.renderKnowledge({ containerId: 'knowledge-container', data: [] });
    await flushPromises();

    handlers.renderKnowledge({ containerId: 'knowledge-container', data: [{ source: 's', title: 't', knowledge: 'k' }] });
    await flushPromises();

    expect(runtime.renderRootMock).toHaveBeenCalledTimes(1);
    expect(runtime.roots[0]?.render).toHaveBeenCalledTimes(1);
  });

  it('unmounts old knowledge root for new containerId', async () => {
    const runtime = await loadRegisteredPiu();
    appendContainer('knowledge-container-1');
    appendContainer('knowledge-container-2');
    const handlers = runtime.getHandlers();

    handlers.renderKnowledge({ containerId: 'knowledge-container-1', data: [] });
    await flushPromises();

    handlers.renderKnowledge({ containerId: 'knowledge-container-2', data: [] });
    await flushPromises();

    expect(runtime.roots[0]?.unmount).toHaveBeenCalledTimes(1);
    expect(runtime.renderRootMock).toHaveBeenCalledTimes(2);
  });

  it('warns and returns when containerId is missing', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const runtime = await loadRegisteredPiu();
    const handlers = runtime.getHandlers();

    handlers.renderKnowledge({ data: [] });
    await flushPromises();

    expect(warn).toHaveBeenCalledWith('[AICOPIU] renderKnowledge requires containerId.');
    expect(runtime.renderRootMock).not.toHaveBeenCalled();
  });

  it('renderKnowledge does not affect loadAIAgent root', async () => {
    const runtime = await loadRegisteredPiu();
    appendContainer('agent-container');
    appendContainer('knowledge-container');
    const handlers = runtime.getHandlers();

    handlers.loadAIAgent({ containerId: 'agent-container' });
    await flushPromises();

    expect(runtime.renderRootMock).toHaveBeenCalledTimes(1);

    handlers.renderKnowledge({ containerId: 'knowledge-container', data: [] });
    await flushPromises();

    expect(runtime.roots[0]?.unmount).not.toHaveBeenCalled();
    expect(runtime.renderRootMock).toHaveBeenCalledTimes(2);
  });

  it('propagates host theme switches to the knowledge view', async () => {
    vi.resetModules();
    const prelude = createPrelHarness();
    document.documentElement.removeAttribute('data-theme');

    vi.doMock('../src/entries/renderRoot.tsx', () => ({
      renderRoot: vi.fn(async (container: HTMLElement, node: ReactNode) => {
        const fakeRoot: Root = { render: vi.fn(), unmount: vi.fn() } as unknown as Root;
        render(node, { container });
        return fakeRoot;
      }),
    }));
    vi.doMock('../src/piu/AIAgentPiuRuntime.tsx', () => ({
      AIAgentPiuRuntime: () => null,
    }));
    vi.doMock('../src/app/AppProviders.tsx', async () => {
      const { createContext, useEffect } = await import('react');
      return {
        AppHostContext: createContext(null),
        AppProviders: ({ site, children }: { readonly site?: { readonly theme?: string }; readonly children?: ReactNode }) => {
          useEffect(() => {
            if (site?.theme) {
              document.documentElement.setAttribute('data-theme', site.theme);
            }
          }, [site?.theme]);
          return children;
        },
      };
    });
    vi.doMock('../src/features/knowledge/KnowledgeSourceList.tsx', () => ({
      KnowledgeSourceList: () => null,
    }));

    const { registerAIAgentPIU } = await import('../src/piu/registerAIAgentPIU.tsx');
    registerAIAgentPIU();

    const handlers = prelude.getHandlers();
    appendContainer('knowledge-theme-container');

    handlers.renderKnowledge({ containerId: 'knowledge-theme-container', data: [] });
    await flushPromises();

    expect(document.documentElement.getAttribute('data-theme')).toBe('lightday');

    await act(async () => {
      handlers.switchTheme('evening');
    });

    expect(document.documentElement.getAttribute('data-theme')).toBe('evening');
  });
});
describe('PIU drag/resize uses pointer capture to survive iframe overlays', () => {
  let pointerCaptureSpies: {
    readonly setPointerCapture: ReturnType<typeof vi.fn>;
    readonly releasePointerCapture: ReturnType<typeof vi.fn>;
    readonly restore: () => void;
  } | null = null;
  let originalInnerHeight: number;

  beforeEach(() => {
    originalInnerHeight = window.innerHeight;
    Object.defineProperty(window, 'innerHeight', { value: 1080, configurable: true, writable: true });
  });

  afterEach(() => {
    pointerCaptureSpies?.restore();
    pointerCaptureSpies = null;
    delete (window as { innerHeight?: number }).innerHeight;
  });

  function stubPointerCapture(): void {
    const setPointerCapture = vi.fn();
    const releasePointerCapture = vi.fn();
    const originalSetDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'setPointerCapture');
    const originalReleaseDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'releasePointerCapture');
    Object.defineProperty(HTMLElement.prototype, 'setPointerCapture', { value: setPointerCapture, configurable: true, writable: true });
    Object.defineProperty(HTMLElement.prototype, 'releasePointerCapture', { value: releasePointerCapture, configurable: true, writable: true });
    pointerCaptureSpies = {
      setPointerCapture,
      releasePointerCapture,
      restore: () => {
        if (originalSetDescriptor) {
          Object.defineProperty(HTMLElement.prototype, 'setPointerCapture', originalSetDescriptor);
        } else {
          delete (HTMLElement.prototype as { setPointerCapture?: unknown }).setPointerCapture;
        }
        if (originalReleaseDescriptor) {
          Object.defineProperty(HTMLElement.prototype, 'releasePointerCapture', originalReleaseDescriptor);
        } else {
          delete (HTMLElement.prototype as { releasePointerCapture?: unknown }).releasePointerCapture;
        }
      },
    };
  }

  it('captures pointer on docked resize handle so dragging survives iframe overlays', async () => {
    stubPointerCapture();
    const runtime = await loadPiuRuntimeComponent();
    runtime.aiAgentPiuRuntimeStore.openPanel();
    runtime.aiAgentPiuRuntimeStore.setDocked(484, 'right');

    render(<runtime.AIAgentPiuRuntime />);

    expect((runtime.aiAgentPiuRuntimeStore.getSnapshot().layout as { width: number }).width).toBe(484);

    const handle = screen.getByTestId('ai-agent-piu-docked-resize');
    fireEvent.pointerDown(handle, { button: 0, clientX: 100, clientY: 100 });

    expect(pointerCaptureSpies?.setPointerCapture).toHaveBeenCalledTimes(1);

    fireEvent.pointerMove(document.body, { clientX: 80, clientY: 100 });

    expect((runtime.aiAgentPiuRuntimeStore.getSnapshot().layout as { width: number }).width).toBeGreaterThan(484);

    fireEvent.pointerUp(document.body, { clientX: 80, clientY: 100 });

    expect(pointerCaptureSpies?.releasePointerCapture).toHaveBeenCalledTimes(1);

    const widthAfterRelease = (runtime.aiAgentPiuRuntimeStore.getSnapshot().layout as { width: number }).width;
    fireEvent.pointerMove(document.body, { clientX: 60, clientY: 100 });
    expect((runtime.aiAgentPiuRuntimeStore.getSnapshot().layout as { width: number }).width).toBe(widthAfterRelease);
  });

  it('captures pointer on floating resize handle so dragging survives iframe overlays', async () => {
    stubPointerCapture();
    const runtime = await loadPiuRuntimeComponent();
    runtime.aiAgentPiuRuntimeStore.openPanel();
    runtime.aiAgentPiuRuntimeStore.enterFloating();

    render(<runtime.AIAgentPiuRuntime />);

    const layout = runtime.aiAgentPiuRuntimeStore.getSnapshot().layout;
    expect(layout.kind).toBe('floating');
    const initialWidth = (layout as { width: number }).width;

    const handle = screen.getByTestId('ai-agent-piu-floating-resize-right');
    fireEvent.pointerDown(handle, { button: 0, clientX: 100, clientY: 100 });

    expect(pointerCaptureSpies?.setPointerCapture).toHaveBeenCalledTimes(1);

    fireEvent.pointerMove(document.body, { clientX: 120, clientY: 100 });

    expect((runtime.aiAgentPiuRuntimeStore.getSnapshot().layout as { width: number }).width).toBeGreaterThan(initialWidth);

    fireEvent.pointerUp(document.body, { clientX: 120, clientY: 100 });

    expect(pointerCaptureSpies?.releasePointerCapture).toHaveBeenCalledTimes(1);

    const widthAfterRelease = (runtime.aiAgentPiuRuntimeStore.getSnapshot().layout as { width: number }).width;
    fireEvent.pointerMove(document.body, { clientX: 160, clientY: 100 });
    expect((runtime.aiAgentPiuRuntimeStore.getSnapshot().layout as { width: number }).width).toBe(widthAfterRelease);
  });

  it('captures pointer on panel header drag so moving survives iframe overlays', async () => {
    stubPointerCapture();
    const runtime = await loadPiuRuntimeComponent();
    runtime.aiAgentPiuRuntimeStore.openPanel();

    render(<runtime.AIAgentPiuRuntime />);

    expect(runtime.aiAgentPiuRuntimeStore.getSnapshot().layout.kind).toBe('docked');

    const header = document.querySelector('.ai-agent-piu-panel-header') as HTMLElement;
    expect(header).toBeTruthy();
    fireEvent.pointerDown(header, { button: 0, clientX: 100, clientY: 100 });

    expect(runtime.aiAgentPiuRuntimeStore.getSnapshot().layout.kind).toBe('floating');
    expect(pointerCaptureSpies?.setPointerCapture).toHaveBeenCalledTimes(1);

    const initialLayout = runtime.aiAgentPiuRuntimeStore.getSnapshot().layout as { x: number; y: number };
    fireEvent.pointerMove(document.body, { clientX: 120, clientY: 120 });

    const movedLayout = runtime.aiAgentPiuRuntimeStore.getSnapshot().layout as { x: number; y: number };
    expect(movedLayout.x).toBeGreaterThan(initialLayout.x);
    expect(movedLayout.y).toBeGreaterThan(initialLayout.y);

    fireEvent.pointerUp(document.body, { clientX: 120, clientY: 120 });

    expect(pointerCaptureSpies?.releasePointerCapture).toHaveBeenCalledTimes(1);

    const posAfterRelease = runtime.aiAgentPiuRuntimeStore.getSnapshot().layout as { x: number; y: number };
    fireEvent.pointerMove(document.body, { clientX: 160, clientY: 160 });
    const posAfterSecondMove = runtime.aiAgentPiuRuntimeStore.getSnapshot().layout as { x: number; y: number };
    expect(posAfterSecondMove.x).toBe(posAfterRelease.x);
    expect(posAfterSecondMove.y).toBe(posAfterRelease.y);
  });
});

describe('panelPosition controls panel positioning', () => {
  it('applies panelPosition.top to render root', async () => {
    const runtime = await loadRegisteredPiu();
    appendContainer('pp-container');
    const handlers = runtime.getHandlers();
    const { aiAgentPiuRuntimeStore } = await import('../src/piu/runtimeStore.ts');

    handlers.loadAIAgent({
      containerId: 'pp-container',
      panelPosition: { top: 0, bottom: 0, left: 0 },
    });
    await flushPromises();

    expect(runtime.renderRootMock).toHaveBeenCalledTimes(1);
    // The store should have dockSide set to 'left' because panelPosition.left is defined
    const snapshot = aiAgentPiuRuntimeStore.getSnapshot();
    expect(snapshot.layout.kind).toBe('docked');
    if (snapshot.layout.kind === 'docked') {
      expect(snapshot.layout.side).toBe('left');
    }
  });
});

describe('controls toggles header controls and interactions', () => {
  it('hides close button when controls.close is false', async () => {
    const runtime = await loadRegisteredPiu();
    appendContainer('controls-container');
    const handlers = runtime.getHandlers();

    handlers.loadAIAgent({
      containerId: 'controls-container',
      controls: { close: false },
    });
    await flushPromises();

    const { aicoConfigStore } = await import('../src/aico-config/AICOConfigStore.ts');
    expect(aicoConfigStore.getSnapshot().config?.controls?.close).toBe(false);
  });

  it('hides maximize button when controls.maximize is false', async () => {
    const runtime = await loadRegisteredPiu();
    appendContainer('maximize-container');
    const handlers = runtime.getHandlers();

    handlers.loadAIAgent({
      containerId: 'maximize-container',
      controls: { maximize: false },
    });
    await flushPromises();

    const { aicoConfigStore } = await import('../src/aico-config/AICOConfigStore.ts');
    expect(aicoConfigStore.getSnapshot().config?.controls?.maximize).toBe(false);
  });

  it('hides dockFloat menu item when controls.dockFloat is false', async () => {
    const runtime = await loadRegisteredPiu();
    appendContainer('dockfloat-container');
    const handlers = runtime.getHandlers();

    handlers.loadAIAgent({
      containerId: 'dockfloat-container',
      controls: { dockFloat: false },
    });
    await flushPromises();

    const { aicoConfigStore } = await import('../src/aico-config/AICOConfigStore.ts');
    expect(aicoConfigStore.getSnapshot().config?.controls?.dockFloat).toBe(false);
  });

  it('disables drag when controls.drag is false', async () => {
    const runtime = await loadRegisteredPiu();
    appendContainer('drag-container');
    const handlers = runtime.getHandlers();

    handlers.loadAIAgent({
      containerId: 'drag-container',
      controls: { drag: false },
    });
    await flushPromises();

    const { aicoConfigStore } = await import('../src/aico-config/AICOConfigStore.ts');
    expect(aicoConfigStore.getSnapshot().config?.controls?.drag).toBe(false);
  });

  it('disables resize when controls.resize is false', async () => {
    const runtime = await loadRegisteredPiu();
    appendContainer('resize-container');
    const handlers = runtime.getHandlers();

    handlers.loadAIAgent({
      containerId: 'resize-container',
      controls: { resize: false },
    });
    await flushPromises();

    const { aicoConfigStore } = await import('../src/aico-config/AICOConfigStore.ts');
    expect(aicoConfigStore.getSnapshot().config?.controls?.resize).toBe(false);
  });
});

describe('controls rendering hides UI elements', () => {
  it('hides close button when controls.close is false', async () => {
    const runtime = await loadPiuRuntimeComponent();
    const { aicoConfigStore } = await import('../src/aico-config/AICOConfigStore.ts');
    aicoConfigStore.setConfig({ controls: { close: false } });
    runtime.aiAgentPiuRuntimeStore.openPanel();

    render(<runtime.AIAgentPiuRuntime />);

    expect(screen.queryByLabelText('Close')).toBeNull();
  });

  it('hides maximize button when controls.maximize is false', async () => {
    const runtime = await loadPiuRuntimeComponent();
    const { aicoConfigStore } = await import('../src/aico-config/AICOConfigStore.ts');
    aicoConfigStore.setConfig({ controls: { maximize: false } });
    runtime.aiAgentPiuRuntimeStore.openPanel();

    render(<runtime.AIAgentPiuRuntime />);

    expect(screen.queryByLabelText('fullscreen mode')).toBeNull();
    expect(screen.queryByLabelText('sidebar mode')).toBeNull();
  });

  it('hides dockFloat menu item when controls.dockFloat is false', async () => {
    const runtime = await loadPiuRuntimeComponent();
    const { aicoConfigStore } = await import('../src/aico-config/AICOConfigStore.ts');
    aicoConfigStore.setConfig({ controls: { dockFloat: false } });
    runtime.aiAgentPiuRuntimeStore.openPanel();

    render(<runtime.AIAgentPiuRuntime />);

    const moreMenu = screen.getByTestId('piu-more-menu').parentElement;
    const items = within(moreMenu as HTMLElement)
      .getAllByTestId(/^piu-menu-item-/)
      .map((item) => item.getAttribute('data-testid'));
    expect(items).not.toContain('piu-menu-item-toggle-dock-float');
  });

  it('does not render resize handle when controls.resize is false', async () => {
    const runtime = await loadPiuRuntimeComponent();
    const { aicoConfigStore } = await import('../src/aico-config/AICOConfigStore.ts');
    aicoConfigStore.setConfig({ controls: { resize: false } });
    runtime.aiAgentPiuRuntimeStore.openPanel();
    runtime.aiAgentPiuRuntimeStore.setDocked(484, 'right');

    render(<runtime.AIAgentPiuRuntime />);

    expect(screen.queryByTestId('ai-agent-piu-docked-resize')).toBeNull();
  });
});

describe('closeBehavior controls close button action', () => {
  it('closeButton triggers minimize when closeBehavior is minimize', async () => {
    const runtime = await loadRegisteredPiu();
    appendContainer('cb-container');
    const handlers = runtime.getHandlers();
    const { aiAgentPiuRuntimeStore } = await import('../src/piu/runtimeStore.ts');

    handlers.loadAIAgent({
      containerId: 'cb-container',
      closeBehavior: 'minimize',
    });
    await flushPromises();

    aiAgentPiuRuntimeStore.openPanel();
    expect(aiAgentPiuRuntimeStore.getSnapshot().display.showPanel).toBe(true);

    aiAgentPiuRuntimeStore.closePanel();
    expect(aiAgentPiuRuntimeStore.getSnapshot().display.minimized).toBe(true);
    expect(aiAgentPiuRuntimeStore.getSnapshot().display.showPanel).toBe(true);
  });

  it('closeButton hides panel when closeBehavior is hide (default)', async () => {
    const runtime = await loadRegisteredPiu();
    appendContainer('cb-hide-container');
    const handlers = runtime.getHandlers();
    const { aiAgentPiuRuntimeStore } = await import('../src/piu/runtimeStore.ts');

    handlers.loadAIAgent({
      containerId: 'cb-hide-container',
    });
    await flushPromises();

    aiAgentPiuRuntimeStore.openPanel();
    expect(aiAgentPiuRuntimeStore.getSnapshot().display.showPanel).toBe(true);

    aiAgentPiuRuntimeStore.closePanel();
    expect(aiAgentPiuRuntimeStore.getSnapshot().display.showPanel).toBe(false);
  });

  it('resets closeBehavior on subsequent loadAIAgent without closeBehavior', async () => {
    const runtime = await loadRegisteredPiu();
    appendContainer('cb-reset-container');
    const handlers = runtime.getHandlers();
    const { aiAgentPiuRuntimeStore } = await import('../src/piu/runtimeStore.ts');

    handlers.loadAIAgent({
      containerId: 'cb-reset-container',
      closeBehavior: 'minimize',
    });
    await flushPromises();

    handlers.loadAIAgent({
      containerId: 'cb-reset-container',
    });
    await flushPromises();

    aiAgentPiuRuntimeStore.openPanel();
    aiAgentPiuRuntimeStore.closePanel();
    expect(aiAgentPiuRuntimeStore.getSnapshot().display.showPanel).toBe(false);
  });
});

describe('initialDisplayState controls initial panel state', () => {
  it('applies initial minimized state with closeBehavior minimize', async () => {
    const runtime = await loadRegisteredPiu();
    appendContainer('ids-container');
    const handlers = runtime.getHandlers();
    const { aiAgentPiuRuntimeStore } = await import('../src/piu/runtimeStore.ts');

    handlers.loadAIAgent({
      containerId: 'ids-container',
      closeBehavior: 'minimize',
      initialDisplayState: { showEntrance: false, showPanel: true, minimized: true },
    });
    await flushPromises();

    const display = aiAgentPiuRuntimeStore.getSnapshot().display;
    expect(display.showEntrance).toBe(false);
    expect(display.showPanel).toBe(true);
    expect(display.minimized).toBe(true);
  });

  it('uses default display state when initialDisplayState is absent', async () => {
    const runtime = await loadRegisteredPiu();
    appendContainer('ids-default-container');
    const handlers = runtime.getHandlers();
    const { aiAgentPiuRuntimeStore } = await import('../src/piu/runtimeStore.ts');

    handlers.loadAIAgent({
      containerId: 'ids-default-container',
    });
    await flushPromises();

    const display = aiAgentPiuRuntimeStore.getSnapshot().display;
    expect(display).toEqual({ showEntrance: true, showPanel: false, minimized: false });
  });
});

describe('minimizedStyle overrides minimized panel style', () => {
  it('stores minimizedStyle in config', async () => {
    const runtime = await loadRegisteredPiu();
    appendContainer('ms-container');
    const handlers = runtime.getHandlers();

    handlers.loadAIAgent({
      containerId: 'ms-container',
      minimizedStyle: { left: 56, right: 'auto', bottom: 16, width: 320, borderRadius: 8 },
    });
    await flushPromises();

    const { aicoConfigStore } = await import('../src/aico-config/AICOConfigStore.ts');
    expect(aicoConfigStore.getSnapshot().config?.minimizedStyle).toEqual({
      left: 56,
      right: 'auto',
      bottom: 16,
      width: 320,
      borderRadius: 8,
    });
  });
});

describe('displayAIAgent preserves current values for absent fields', () => {
  it('preserves showEntrance when only showPanel is provided', async () => {
    const runtime = await loadRegisteredPiu();
    appendContainer('da-container');
    const handlers = runtime.getHandlers();
    const { aiAgentPiuRuntimeStore } = await import('../src/piu/runtimeStore.ts');

    handlers.loadAIAgent({
      containerId: 'da-container',
      closeBehavior: 'minimize',
      initialDisplayState: { showEntrance: false, showPanel: true },
    });
    await flushPromises();

    handlers.displayAIAgent({ showPanel: false });
    const display = aiAgentPiuRuntimeStore.getSnapshot().display;
    expect(display.showEntrance).toBe(false);
    expect(display.showPanel).toBe(false);
  });

  it('preserves showPanel when only showEntrance is provided', async () => {
    const runtime = await loadRegisteredPiu();
    appendContainer('da2-container');
    const handlers = runtime.getHandlers();
    const { aiAgentPiuRuntimeStore } = await import('../src/piu/runtimeStore.ts');

    handlers.loadAIAgent({
      containerId: 'da2-container',
      closeBehavior: 'minimize',
      initialDisplayState: { showEntrance: false, showPanel: true },
    });
    await flushPromises();

    handlers.displayAIAgent({ showEntrance: true });
    const display = aiAgentPiuRuntimeStore.getSnapshot().display;
    expect(display.showEntrance).toBe(true);
    expect(display.showPanel).toBe(true);
  });

  it('no change when empty payload is provided', async () => {
    const runtime = await loadRegisteredPiu();
    appendContainer('da3-container');
    const handlers = runtime.getHandlers();
    const { aiAgentPiuRuntimeStore } = await import('../src/piu/runtimeStore.ts');

    handlers.loadAIAgent({
      containerId: 'da3-container',
      closeBehavior: 'minimize',
      initialDisplayState: { showEntrance: false, showPanel: true },
    });
    await flushPromises();

    handlers.displayAIAgent({});
    const display = aiAgentPiuRuntimeStore.getSnapshot().display;
    expect(display.showEntrance).toBe(false);
    expect(display.showPanel).toBe(true);
  });
});

describe('expand panel width fallback and restore', () => {
  it('uses minWidth as expandPanelPiuWidth when provided', async () => {
    const runtime = await loadPiuRuntimeComponent();
    const { aicoConfigStore } = await import('../src/aico-config/AICOConfigStore.ts');
    const { expandPanelStore } = await import('../src/features/expand-panel/ExpandPanelStore.ts');

    aicoConfigStore.setConfig({
      modalSize: { width: 800, minWidth: 400 },
    });
    runtime.aiAgentPiuRuntimeStore.openPanel();
    runtime.aiAgentPiuRuntimeStore.setDockedMinWidth(400);
    runtime.aiAgentPiuRuntimeStore.setDocked(800);

    await act(async () => {
      expandPanelStore.getState().setView(<div data-testid="expand-panel-view" />);
      expandPanelStore.getState().open();
    });

    render(<runtime.AIAgentPiuRuntime />);
    await act(async () => {});

    const panel = screen.getByTestId('ai-agent-piu-panel');
    expect(panel.style.width).toBe('400px');

    const region = screen.getByTestId('ai-agent-expand-panel-region');
    expect(region.style.right).toBe('400px');
  });

  it('falls back to width when minWidth is not provided', async () => {
    const runtime = await loadPiuRuntimeComponent();
    const { aicoConfigStore } = await import('../src/aico-config/AICOConfigStore.ts');
    const { expandPanelStore } = await import('../src/features/expand-panel/ExpandPanelStore.ts');

    aicoConfigStore.setConfig({
      modalSize: { width: 600 },
    });
    runtime.aiAgentPiuRuntimeStore.openPanel();
    runtime.aiAgentPiuRuntimeStore.setDocked(600);

    await act(async () => {
      expandPanelStore.getState().setView(<div data-testid="expand-panel-view" />);
      expandPanelStore.getState().open();
    });

    render(<runtime.AIAgentPiuRuntime />);
    await act(async () => {});

    const panel = screen.getByTestId('ai-agent-piu-panel');
    expect(panel.style.width).toBe('600px');
  });

  it('restores panel width to modalSize.width when expand panel closes', async () => {
    const runtime = await loadPiuRuntimeComponent();
    const { aicoConfigStore } = await import('../src/aico-config/AICOConfigStore.ts');
    const { expandPanelStore } = await import('../src/features/expand-panel/ExpandPanelStore.ts');

    aicoConfigStore.setConfig({
      modalSize: { width: 800, minWidth: 400 },
    });
    runtime.aiAgentPiuRuntimeStore.openPanel();
    runtime.aiAgentPiuRuntimeStore.setDockedMinWidth(400);
    runtime.aiAgentPiuRuntimeStore.setDocked(800);

    await act(async () => {
      expandPanelStore.getState().setView(<div data-testid="expand-panel-view" />);
      expandPanelStore.getState().open();
    });

    render(<runtime.AIAgentPiuRuntime />);
    await act(async () => {});

    // Expand panel open: panel shrinks to minWidth
    expect(screen.getByTestId('ai-agent-piu-panel').style.width).toBe('400px');

    // Close expand panel
    await act(async () => {
      expandPanelStore.getState().close();
    });

    // Panel restores to full width
    expect(screen.getByTestId('ai-agent-piu-panel').style.width).toBe('800px');
  });

  it('restores to DOCKED_DEFAULT_WIDTH when modalSize.width is not set', async () => {
    const runtime = await loadPiuRuntimeComponent();
    const { aicoConfigStore } = await import('../src/aico-config/AICOConfigStore.ts');
    const { expandPanelStore } = await import('../src/features/expand-panel/ExpandPanelStore.ts');

    aicoConfigStore.setConfig({});
    runtime.aiAgentPiuRuntimeStore.openPanel();

    await act(async () => {
      expandPanelStore.getState().setView(<div data-testid="expand-panel-view" />);
      expandPanelStore.getState().open();
    });

    render(<runtime.AIAgentPiuRuntime />);
    await act(async () => {});

    // Expand panel open: panel is at default 484
    expect(screen.getByTestId('ai-agent-piu-panel').style.width).toBe('484px');

    // Close expand panel
    await act(async () => {
      expandPanelStore.getState().close();
    });

    // Panel restores to default 484
    expect(screen.getByTestId('ai-agent-piu-panel').style.width).toBe('484px');
  });
});

describe('expand panel offset with panelPosition', () => {
  it('adds panelPosition.left offset to expand panel right side', async () => {
    const runtime = await loadPiuRuntimeComponent();
    const { aicoConfigStore } = await import('../src/aico-config/AICOConfigStore.ts');
    const { expandPanelStore } = await import('../src/features/expand-panel/ExpandPanelStore.ts');

    aicoConfigStore.setConfig({
      panelPosition: { top: 0, bottom: 0, left: 56 },
      modalSize: { width: 484, minWidth: 484 },
    });
    runtime.aiAgentPiuRuntimeStore.openPanel();
    runtime.aiAgentPiuRuntimeStore.setDockedMinWidth(484);
    runtime.aiAgentPiuRuntimeStore.setDocked(484);

    await act(async () => {
      expandPanelStore.getState().setView(<div data-testid="expand-panel-view" />);
      expandPanelStore.getState().open();
    });

    render(<runtime.AIAgentPiuRuntime />);
    await act(async () => {});

    const region = screen.getByTestId('ai-agent-expand-panel-region');
    // Panel on left with left: 56, width: 484 -> expand panel left = 484 + 56 = 540
    expect(region.style.left).toBe('540px');
    expect(region.style.right).toBe('0px');
  });

  it('adds panelPosition.right offset to expand panel left side', async () => {
    const runtime = await loadPiuRuntimeComponent();
    const { aicoConfigStore } = await import('../src/aico-config/AICOConfigStore.ts');
    const { expandPanelStore } = await import('../src/features/expand-panel/ExpandPanelStore.ts');

    aicoConfigStore.setConfig({
      panelPosition: { top: 0, bottom: 0, right: 56 },
      modalSize: { width: 484, minWidth: 484 },
    });
    runtime.aiAgentPiuRuntimeStore.openPanel();
    runtime.aiAgentPiuRuntimeStore.setDockedMinWidth(484);
    runtime.aiAgentPiuRuntimeStore.setDocked(484);

    await act(async () => {
      expandPanelStore.getState().setView(<div data-testid="expand-panel-view" />);
      expandPanelStore.getState().open();
    });

    render(<runtime.AIAgentPiuRuntime />);
    await act(async () => {});

    const region = screen.getByTestId('ai-agent-expand-panel-region');
    // Panel on right with right: 56, width: 484 -> expand panel right = 484 + 56 = 540
    expect(region.style.left).toBe('0px');
    expect(region.style.right).toBe('540px');
  });
});

describe('expand panel cleanup on panel close', () => {
  it('closes expand panel and dispatches clear event when displayAIAgent hides panel', async () => {
    const runtime = await loadPiuRuntimeComponent();
    const { aicoConfigStore } = await import('../src/aico-config/AICOConfigStore.ts');
    const { expandPanelStore } = await import('../src/features/expand-panel/ExpandPanelStore.ts');

    aicoConfigStore.setConfig({ closeBehavior: 'hide' });
    runtime.aiAgentPiuRuntimeStore.openPanel();

    await act(async () => {
      expandPanelStore.getState().setView(<div data-testid="expand-panel-view" />);
      expandPanelStore.getState().open();
    });
    expect(expandPanelStore.getState().isOpen).toBe(true);

    runtime.aiAgentPiuRuntimeStore.display({ showPanel: false });

    expect(expandPanelStore.getState().isOpen).toBe(false);
  });

  it('closes expand panel on minimize via closePanel', async () => {
    const runtime = await loadPiuRuntimeComponent();
    const { aicoConfigStore } = await import('../src/aico-config/AICOConfigStore.ts');
    const { expandPanelStore } = await import('../src/features/expand-panel/ExpandPanelStore.ts');

    aicoConfigStore.setConfig({ closeBehavior: 'minimize' });
    runtime.aiAgentPiuRuntimeStore.setCloseBehavior('minimize');
    runtime.aiAgentPiuRuntimeStore.openPanel();

    await act(async () => {
      expandPanelStore.getState().setView(<div data-testid="expand-panel-view" />);
      expandPanelStore.getState().open();
    });
    expect(expandPanelStore.getState().isOpen).toBe(true);

    runtime.aiAgentPiuRuntimeStore.closePanel();

    expect(expandPanelStore.getState().isOpen).toBe(false);
  });
});

describe('updatePanelLayout handler', () => {
  it('updates panelPosition without unmounting', async () => {
    const runtime = await loadRegisteredPiu();
    appendContainer('upl-container');
    const handlers = runtime.getHandlers();

    handlers.loadAIAgent({
      containerId: 'upl-container',
      panelPosition: { top: 0, right: 0 },
    });
    await flushPromises();

    expect(runtime.renderRootMock).toHaveBeenCalledTimes(1);

    handlers.updatePanelLayout({
      panelPosition: { top: 0, right: 200 },
    });

    // Should NOT call renderRoot again (no unmount/remount)
    expect(runtime.renderRootMock).toHaveBeenCalledTimes(1);

    const { aicoConfigStore } = await import('../src/aico-config/AICOConfigStore.ts');
    expect(aicoConfigStore.getSnapshot().config?.panelPosition?.right).toBe(200);
  });

  it('updates modalSize width', async () => {
    const runtime = await loadRegisteredPiu();
    appendContainer('upl-ms-container');
    const handlers = runtime.getHandlers();

    handlers.loadAIAgent({
      containerId: 'upl-ms-container',
      modalSize: { width: 484 },
    });
    await flushPromises();

    handlers.updatePanelLayout({
      modalSize: { width: 600 },
    });

    const { aicoConfigStore } = await import('../src/aico-config/AICOConfigStore.ts');
    expect(aicoConfigStore.getSnapshot().config?.modalSize?.width).toBe(600);
  });

  it('updates minimizedStyle', async () => {
    const runtime = await loadRegisteredPiu();
    appendContainer('upl-mst-container');
    const handlers = runtime.getHandlers();

    handlers.loadAIAgent({
      containerId: 'upl-mst-container',
      minimizedStyle: { left: 56 },
    });
    await flushPromises();

    handlers.updatePanelLayout({
      minimizedStyle: { left: 200, right: 'auto' },
    });

    const { aicoConfigStore } = await import('../src/aico-config/AICOConfigStore.ts');
    expect(aicoConfigStore.getSnapshot().config?.minimizedStyle?.left).toBe(200);
    expect(aicoConfigStore.getSnapshot().config?.minimizedStyle?.right).toBe('auto');
  });

  it('ignores unsupported fields', async () => {
    const runtime = await loadRegisteredPiu();
    appendContainer('upl-ignore-container');
    const handlers = runtime.getHandlers();

    handlers.loadAIAgent({
      containerId: 'upl-ignore-container',
      controls: { close: false },
    });
    await flushPromises();

    handlers.updatePanelLayout({
      containerId: 'new-id',
      controls: { close: true },
    });

    const { aicoConfigStore } = await import('../src/aico-config/AICOConfigStore.ts');
    expect(aicoConfigStore.getSnapshot().config?.controls?.close).toBe(false);
    expect(aicoConfigStore.getSnapshot().config?.containerId).toBe('upl-ignore-container');
  });

  it('warns when loadAIAgent has not been called', async () => {
    const runtime = await loadRegisteredPiu();
    const handlers = runtime.getHandlers();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    handlers.updatePanelLayout({ panelPosition: { top: 0 } });

    expect(warn).toHaveBeenCalledWith('[AICOPIU] updatePanelLayout requires loadAIAgent to be called first.');
    warn.mockRestore();
  });
});

async function loadRegisteredPiu() {
  vi.resetModules();
  const prelude = createPrelHarness();
  const roots: FakeRoot[] = [];
  const renderRootMock = vi.fn(async () => {
    const root: FakeRoot = {
      render: vi.fn(),
      unmount: vi.fn(),
    };
    roots.push(root);
    return root as unknown as Root;
  });

  vi.doMock('../src/entries/renderRoot.tsx', () => ({
    renderRoot: renderRootMock,
  }));
  vi.doMock('../src/piu/AIAgentPiuRuntime.tsx', () => ({
    AIAgentPiuRuntime: () => null,
  }));
  vi.doMock('../src/app/AppProviders.tsx', async () => {
    const { createContext } = await import('react');
    return {
      AppHostContext: createContext(null),
      AppProviders: ({ children }: { readonly children: ReactNode }) => children,
      useAppHostContext: () => ({ hostTheme: 'lightday', themeMode: 'light', mode: 'collaborative' }),
    };
  });
  vi.doMock('../src/features/knowledge/KnowledgeSourceList.tsx', () => ({
    KnowledgeSourceList: () => null,
  }));

  const { registerAIAgentPIU } = await import('../src/piu/registerAIAgentPIU.tsx');
  registerAIAgentPIU();

  return {
    ...prelude,
    renderRootMock,
    roots,
  };
}

async function loadPiuRuntimeComponent() {
  vi.resetModules();
  vi.doUnmock('../src/piu/AIAgentPiuRuntime.tsx');
  vi.doUnmock('../src/entries/renderRoot.tsx');
  let bridgeRef: MutableRefObject<ChatComposerBridge | null> | undefined;
  let navigation: ChatNavigationAdapter | undefined;

  vi.doMock('../src/app/AppProviders.tsx', async () => {
    const { createContext } = await import('react');
    return {
      AppHostContext: createContext(null),
      AppProviders: ({ children }: { readonly children: ReactNode }) => children,
      useAppHostContext: () => ({ hostTheme: 'lightday', themeMode: 'light', mode: 'collaborative' }),
    };
  });
  vi.doMock('../src/app/NonLocalAuth.tsx', () => ({
    useNonLocalAuthRedirect: () => undefined,
  }));
  vi.doMock('../src/features/session-activity/SessionActivityConnectionController.tsx', () => ({
    SessionActivityConnectionController: () => <div data-testid="session-activity-controller" />,
  }));
  vi.doMock('@ant-design/icons', () => {
    function Icon() {
      return <span aria-hidden="true" />;
    }
    return {
      CalendarOutlined: Icon,
      CloseCircleFilled: Icon,
      CloseOutlined: Icon,
      ColumnWidthOutlined: Icon,
      CompressOutlined: Icon,
      DatabaseOutlined: Icon,
      EllipsisOutlined: Icon,
      ExpandOutlined: Icon,
      HistoryOutlined: Icon,
      MessageOutlined: Icon,
      PlusOutlined: Icon,
      PushpinOutlined: Icon,
      SearchOutlined: Icon,
      WarningOutlined: Icon,
      DeleteOutlined: Icon,
    };
  });
  vi.doMock('antd', () => ({
    Button: ({
      children,
      icon,
      type: _variant,
      size: _size,
      shape: _shape,
      ...props
    }: {
      readonly children?: ReactNode;
      readonly icon?: ReactNode;
      readonly type?: string;
      readonly size?: string;
      readonly shape?: string;
      readonly [key: string]: unknown;
    }) => (
      <button {...props} type="button">
        {icon}
        {children}
      </button>
    ),
    Input: ({ suffix, size: _size, ...props }: { readonly suffix?: ReactNode; readonly size?: string; readonly [key: string]: unknown }) => (
      <label>
        <input {...props} />
        {suffix}
      </label>
    ),
    DatePicker: {
      RangePicker: ({ open: _open }: { readonly open?: boolean }) => (
        <div data-testid="mock-range-picker">
          <input aria-label="创建时间范围" />
        </div>
      ),
    },
    Dropdown: ({
      children,
      menu,
    }: {
      readonly children?: ReactNode;
      readonly menu?: {
        readonly items?: ReadonlyArray<{
          readonly key?: string;
          readonly label?: ReactNode;
          readonly icon?: ReactNode;
          readonly onClick?: () => void;
        } | null>;
      };
    }) => (
      <div>
        {children}
        <div>
          {menu?.items?.map((item) =>
            item ? (
              <button key={item.key} type="button" data-testid={`piu-menu-item-${String(item.key)}`} onClick={item.onClick}>
                {item.icon}
                {item.label}
              </button>
            ) : null,
          )}
        </div>
      </div>
    ),
    Popover: ({
      children,
      content,
      trigger: _trigger,
      placement: _placement,
      zIndex: _zIndex,
      open: _open,
      destroyOnHidden: _destroyOnHidden,
      onOpenChange,
      ...props
    }: {
      readonly children?: ReactNode;
      readonly content?: ReactNode;
      readonly trigger?: string;
      readonly placement?: string;
      readonly zIndex?: number;
      readonly open?: boolean;
      readonly destroyOnHidden?: boolean;
      readonly onOpenChange?: (open: boolean) => void;
      readonly [key: string]: unknown;
    }) => (
      <div {...props}>
        <span onClick={() => onOpenChange?.(true)}>{children}</span>
        {content}
      </div>
    ),
    Tooltip: ({ children }: { readonly children?: ReactNode }) => children,
    Typography: {
      Text: ({ children, type: _type, ...props }: { readonly children?: ReactNode; readonly type?: string }) => <span {...props}>{children}</span>,
    },
    Modal: ({
      children,
      open,
      rootClassName,
      getContainer: _getContainer,
      destroyOnHidden: _destroyOnHidden,
      footer: _footer,
      closable: _closable,
      ...props
    }: {
      readonly children?: ReactNode;
      readonly open?: boolean;
      readonly rootClassName?: string;
      readonly getContainer?: boolean | (() => HTMLElement);
      readonly destroyOnHidden?: boolean;
      readonly footer?: ReactNode;
      readonly closable?: boolean;
      readonly [key: string]: unknown;
    }) =>
      open ? (
        <div className={rootClassName} {...props}>
          {children}
        </div>
      ) : null,
  }));
  vi.doMock('../src/features/favorites/components/FavoriteTurnsPanel.tsx', () => ({
    FavoriteTurnsPanel: ({ onOpenFavorite }: { readonly onOpenFavorite: (sessionId: string, rootMessageId: string) => void }) => (
      <div data-testid="favorite-turns-panel">
        <button type="button" aria-label="打开收藏会话" onClick={() => onOpenFavorite('session-favorite', 'root-favorite')} />
      </div>
    ),
  }));
  vi.doMock('../src/features/composer/components/CommandHelpModal.tsx', () => ({
    CommandHelpModal: ({ open }: { readonly open: boolean }) => (open ? <div data-testid="command-help-modal" /> : null),
  }));
  vi.doMock('../src/pages/ChatPage.tsx', () => ({
    ChatPageCore: ({
      composerBridgeRef,
      navigation: nextNavigation,
      onOpenHelp,
      isConversationSurfaceVisible,
      headerSlot,
      aboveMessagesSlot,
    }: {
      readonly composerBridgeRef?: MutableRefObject<ChatComposerBridge | null>;
      readonly navigation: ChatNavigationAdapter;
      readonly onOpenHelp: () => void;
      readonly isConversationSurfaceVisible?: boolean;
      readonly headerSlot?: ReactNode;
      readonly aboveMessagesSlot?: ReactNode;
    }) => {
      bridgeRef = composerBridgeRef;
      navigation = nextNavigation;
      return (
        <div data-testid="chat-page-core" data-surface-visible={String(isConversationSurfaceVisible)}>
          {headerSlot}
          {aboveMessagesSlot}
          <button type="button" data-testid="chat-page-open-help" onClick={onOpenHelp}>
            Open help
          </button>
        </div>
      );
    },
  }));

  const [{ AIAgentPiuRuntime }, { aiAgentPiuRuntimeStore }, { runtimeConfig }] = await Promise.all([
    import('../src/piu/AIAgentPiuRuntime.tsx'),
    import('../src/piu/runtimeStore.ts'),
    import('../src/config/runtimeConfig.ts'),
  ]);

  return {
    AIAgentPiuRuntime,
    aiAgentPiuRuntimeStore,
    runtimeConfig,
    getBridgeRef: () => {
      if (!bridgeRef) {
        throw new Error('Composer bridge ref was not captured.');
      }
      return bridgeRef;
    },
    getNavigation: () => {
      if (!navigation) {
        throw new Error('Chat navigation was not captured.');
      }
      return navigation;
    },
  };
}

function createPrelHarness() {
  let handlers: AttachedHandlers | null = null;
  const piu: PIU = {
    id: 'ai-agent-piu',
    name: 'AICOPIU',
    version: PACKAGE_VERSION,
    config: {},
    deps: {},
    isBrowser: true,
    revs: { 'febs.regs': '1', 'febs.server': '1' },
    attach: vi.fn((_piu: PIU, attachedHandlers: Record<string, unknown>) => {
      handlers = attachedHandlers as unknown as AttachedHandlers;
    }),
    emit: vi.fn(),
  };
  const prel: Prel = {
    ready: vi.fn((callback: () => void) => callback()),
    autoLoad: vi.fn(async () => undefined) as unknown as Prel['autoLoad'],
    start: vi.fn((_name, _version, _deps, callback) => {
      callback(piu, { locale: 'en-us', theme: 'lightday' });
    }),
  };

  vi.stubGlobal('__NEXTAGENT_PACKAGE_VERSION__', PACKAGE_VERSION);
  window.Prel = prel;

  return {
    prel,
    piu,
    getHandlers: () => {
      if (!handlers) {
        throw new Error('PIU handlers were not attached.');
      }
      return handlers;
    },
  };
}

function appendContainer(id: string): HTMLElement {
  const container = document.createElement('div');
  container.id = id;
  document.body.append(container);
  return container;
}

async function flushPromises(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}
