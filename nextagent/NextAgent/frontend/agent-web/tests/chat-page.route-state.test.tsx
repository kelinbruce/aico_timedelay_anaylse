// @vitest-environment jsdom
import { useState } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { message as antdMessage } from 'antd';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';

const scheduleTestAnimationFrame = window.setTimeout.bind(window);
const cancelTestAnimationFrame = window.clearTimeout.bind(window);

const streamHookState = vi.hoisted(() => ({
  latestParams: null as {
    canOpenStream?: boolean;
    hasInFlightRequest?: boolean;
    acceptedRun?: { requestId: string; runId: string; status: string } | null;
    activeRun?: { requestId: string; runId: string; status: string } | null;
    isExecuting?: boolean;
    onSessionLiveTailOpen?: () => void;
    onTerminal?: (envelope: any) => void;
    onUserInputRequired?: (envelope: StreamEnvelope) => void;
    onUserInputResolved?: (envelope: StreamEnvelope) => void;
    sessionId?: string;
  } | null,
}));

const projectionBuildState = vi.hoisted(() => ({
  historyCalls: 0,
  settledCalls: 0,
}));

const selectionResolveState = vi.hoisted(() => ({
  reportCalls: 0,
  shareCalls: 0,
}));

vi.mock('../src/features/chat/hooks/useStreamConnection.ts', () => ({
  useStreamConnection: (params: unknown) => {
    streamHookState.latestParams = params as {
      canOpenStream?: boolean;
      hasInFlightRequest?: boolean;
      acceptedRun?: { requestId: string; runId: string; status: string } | null;
      activeRun?: { requestId: string; runId: string; status: string } | null;
      isExecuting?: boolean;
      onSessionLiveTailOpen?: () => void;
      onTerminal?: (envelope: any) => void;
      onUserInputRequired?: (envelope: StreamEnvelope) => void;
      onUserInputResolved?: (envelope: StreamEnvelope) => void;
      sessionId?: string;
    };
    return { isStreaming: false };
  },
}));

vi.mock('../src/features/chat/view-model/buildSessionProjection.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/features/chat/view-model/buildSessionProjection.ts')>();
  return {
    ...actual,
    buildSessionHistoryProjection: (input: Parameters<typeof actual.buildSessionHistoryProjection>[0]) => {
      projectionBuildState.historyCalls += 1;
      return actual.buildSessionHistoryProjection(input);
    },
    buildSessionSettledProjection: (input: Parameters<typeof actual.buildSessionSettledProjection>[0]) => {
      projectionBuildState.settledCalls += 1;
      return actual.buildSessionSettledProjection(input);
    },
  };
});

vi.mock('../src/features/chat/presentation/reportSelection.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/features/chat/presentation/reportSelection.ts')>();
  return {
    ...actual,
    resolveReportableRequestId: (block: Parameters<typeof actual.resolveReportableRequestId>[0]) => {
      selectionResolveState.reportCalls += 1;
      return actual.resolveReportableRequestId(block);
    },
  };
});

vi.mock('../src/features/chat/presentation/shareSelection.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/features/chat/presentation/shareSelection.ts')>();
  return {
    ...actual,
    resolveShareableRunId: (block: Parameters<typeof actual.resolveShareableRunId>[0]) => {
      selectionResolveState.shareCalls += 1;
      return actual.resolveShareableRunId(block);
    },
  };
});

vi.mock('../src/services/sessionService.ts', () => ({
  sessionService: {
    listSessions: vi.fn().mockResolvedValue({
      entries: [],
      offset: 0,
      limit: 50,
      hasMore: false,
    }),
    loadConversation: vi.fn().mockResolvedValue({
      sessionId: 'session-1',
      items: [],
      nextCursor: null,
    }),
    loadConversationPreview: vi.fn().mockResolvedValue({
      sessionId: 'session-1',
      totalMarkers: 0,
      offset: 0,
      limit: 100,
      markers: [],
    }),
    loadRunEvents: vi.fn().mockResolvedValue({
      events: [],
      availability: 'AVAILABLE',
    }),
    createSession: vi.fn(),
    forkSessionFromMessage: vi.fn(),
    forkSessionFromRequest: vi.fn(),
    renameSession: vi.fn(),
  },
}));

vi.mock('../src/services/backgroundTaskService.ts', () => ({
  backgroundTaskService: {
    listTasks: vi.fn().mockResolvedValue([]),
    readOutput: vi.fn(),
    killTask: vi.fn(),
  },
}));

vi.mock('../src/services/sessionActivityService.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/services/sessionActivityService.ts')>();
  return {
    ...actual,
    sessionActivityService: {
      consume: vi.fn().mockResolvedValue(undefined),
    },
  };
});

vi.mock('../src/features/run-graph/X6FlowDiagram.tsx', () => ({
  X6FlowDiagram: ({ viewState }: any) => (
    <div data-testid="mock-chat-x6-flow">{viewState.nodes.map((node: any) => `${node.title}:${node.summary}`).join('|')}</div>
  ),
}));

import { ChatPage, ChatPageCore } from '../src/pages/ChatPage.tsx';
import { CommandHelpModal } from '../src/features/composer/components/CommandHelpModal.tsx';
import { __resetTurnBlockTestState } from '../src/features/chat/components/TurnBlock.tsx';
import { sessionService } from '../src/services/sessionService.ts';
import { sessionActivityService } from '../src/services/sessionActivityService.ts';
import { useSessionActivityStore } from '../src/state/sessionActivityStore.ts';
import { useConversationStore, type LiveBucketsByRoot, type LiveEnvelopeBucket } from '../src/state/conversationStore.ts';
import { getEnvelopeAttemptId, getEnvelopeRootMessageId } from '../src/features/chat/utils/streamingHelpers.ts';
import type { ConversationPreviewMarker, SessionConversationMessage, SessionHistoryEntry, StreamEnvelope } from '../src/state/contracts.ts';
import { useRequestStore } from '../src/state/requestStore.ts';
import { RECENT_SESSION_LIMIT, SESSION_HISTORY_PAGE_LIMIT, useSessionStore } from '../src/state/sessionStore.ts';
import { useUserInputStore } from '../src/state/userInputStore.ts';
import { requestService } from '../src/services/requestService.ts';
import { setLocalePreference } from '../src/i18n/index.ts';
import { SIDEBAR_SESSION_LIST_EXPANDED_STORAGE_KEY } from '../src/state/sessionListPreference.ts';
import { AppProviders } from '../src/app/AppProviders.tsx';
import { expandPanelStore } from '../src/features/expand-panel/ExpandPanelStore.ts';
import { runtimeConfig } from '../src/config/runtimeConfig.ts';

function makeLiveBuckets(envelopes: readonly StreamEnvelope[]): LiveBucketsByRoot {
  const buckets: Record<string, LiveEnvelopeBucket> = {};
  for (const envelope of envelopes) {
    const rootMessageId = getEnvelopeRootMessageId(envelope);
    const attemptId = getEnvelopeAttemptId(envelope);
    const existing = buckets[rootMessageId];
    buckets[rootMessageId] =
      existing?.attemptId === attemptId
        ? { ...existing, envelopes: [...existing.envelopes, envelope] }
        : {
            rootMessageId,
            attemptId,
            firstSeenOrdinal: Object.keys(buckets).length,
            envelopes: [envelope],
            nextCompactionAt: 500,
          };
  }
  return buckets;
}

if (!(window as { matchMedia?: typeof window.matchMedia }).matchMedia) {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
}

if (!(globalThis as { ResizeObserver?: unknown }).ResizeObserver) {
  class MockResizeObserver {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  }
  (globalThis as unknown as { ResizeObserver?: typeof MockResizeObserver }).ResizeObserver = MockResizeObserver;
}

function ChatPageTestHarness({
  isConversationSurfaceVisible = true,
}: {
  readonly isConversationSurfaceVisible?: boolean;
} = {}) {
  const [isCommandHelpOpen, setIsCommandHelpOpen] = useState(false);
  const location = useLocation();
  const openCommandHelp = () => setIsCommandHelpOpen(true);
  const closeCommandHelp = () => setIsCommandHelpOpen(false);

  return (
    <>
      <output data-testid="route-location">{`${location.pathname}${location.search}`}</output>
      <Routes>
        <Route path="/" element={<ChatPage onOpenHelp={openCommandHelp} isConversationSurfaceVisible={isConversationSurfaceVisible} />} />
        <Route
          path="/session/:sessionId"
          element={<ChatPage onOpenHelp={openCommandHelp} isConversationSurfaceVisible={isConversationSurfaceVisible} />}
        />
      </Routes>
      <CommandHelpModal open={isCommandHelpOpen} onClose={closeCommandHelp} />
    </>
  );
}

function renderChatPage(route = '/session/session-1', isConversationSurfaceVisible = true) {
  return render(
    <AppProviders mode="local">
      <MemoryRouter initialEntries={[route]}>
        <ChatPageTestHarness isConversationSurfaceVisible={isConversationSurfaceVisible} />
      </MemoryRouter>
    </AppProviders>,
  );
}

async function clickLatestOverflowForkAction(): Promise<void> {
  await act(async () => {
    fireEvent.click(await screen.findByTestId('btn-more-actions'));
    const overflowForkActions = await screen.findAllByTestId('btn-fork-ai');
    fireEvent.click(overflowForkActions[overflowForkActions.length - 1]!);
  });
}

function ChatPageCoreSessionSwitchHarness() {
  const [sessionId, setSessionId] = useState<string | null>('session-a');
  return (
    <AppProviders mode="local">
      <button type="button" data-testid="switch-session-a" onClick={() => setSessionId('session-a')}>
        Session A
      </button>
      <button type="button" data-testid="switch-session-b" onClick={() => setSessionId('session-b')}>
        Session B
      </button>
      <button type="button" data-testid="open-new-session" onClick={() => setSessionId(null)}>
        New Session
      </button>
      <ChatPageCore
        onOpenHelp={() => {}}
        navigation={{
          sessionId,
          openSession: (nextSessionId) => setSessionId(nextSessionId),
          openNewSession: () => setSessionId(null),
        }}
      />
    </AppProviders>
  );
}

function renderChatPageCoreWithNavigation(navigation: Parameters<typeof ChatPageCore>[0]['navigation']) {
  return render(
    <AppProviders mode="local">
      <ChatPageCore onOpenHelp={() => {}} navigation={navigation} />
    </AppProviders>,
  );
}

function mockScrollableViewport(
  viewport: HTMLDivElement & {
    scrollHeight: number;
    clientHeight: number;
    scrollTop: number;
    scrollTo: typeof HTMLElement.prototype.scrollTo;
  },
  options?: {
    scrollHeight?: number;
    clientHeight?: number;
    scrollTop?: number;
  },
) {
  const scrollHeight = options?.scrollHeight ?? 1000;
  const clientHeight = options?.clientHeight ?? 400;
  const scrollTop = options?.scrollTop ?? scrollHeight - clientHeight;

  Object.defineProperty(viewport, 'scrollHeight', { value: scrollHeight, writable: true, configurable: true });
  Object.defineProperty(viewport, 'clientHeight', { value: clientHeight, configurable: true });
  Object.defineProperty(viewport, 'scrollTop', { value: scrollTop, writable: true, configurable: true });
  viewport.scrollTo = vi.fn((...args: [ScrollToOptions] | [number, number]) => {
    const [firstArg, secondArg] = args;
    if (typeof firstArg === 'number') {
      viewport.scrollTop = secondArg ?? viewport.scrollTop;
      return;
    }
    if (typeof firstArg?.top === 'number') {
      viewport.scrollTop = firstArg.top;
    }
  }) as typeof viewport.scrollTo;
}

function makeDomRect(x: number, y: number, width: number, height: number): DOMRect {
  return {
    x,
    y,
    top: y,
    left: x,
    bottom: y + height,
    right: x + width,
    width,
    height,
    toJSON: () => ({}),
  } as DOMRect;
}

function mockTurnBlockLayoutWithinViewport(
  viewport: HTMLDivElement & {
    clientHeight: number;
    scrollTop: number;
  },
  rootMessageId: string,
  targetOffsetTop: number,
  targetHeight = 0,
): () => void {
  const originalGetBoundingClientRect = HTMLElement.prototype.getBoundingClientRect;
  const spy = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    if (this === viewport) {
      return makeDomRect(0, 0, 400, viewport.clientHeight);
    }
    if (this.dataset.testid === 'turn-block' && this.dataset.rootMessageId === rootMessageId) {
      return makeDomRect(0, targetOffsetTop - viewport.scrollTop, 400, targetHeight);
    }
    return originalGetBoundingClientRect.call(this);
  });
  return () => {
    spy.mockRestore();
  };
}

async function flushAnimationFrame(): Promise<void> {
  await act(async () => {
    await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));
  });
}

async function flushAnimationFrames(count: number): Promise<void> {
  for (let index = 0; index < count; index += 1) {
    await flushAnimationFrame();
  }
}

function mockConversationPreviewRailClientHeight(clientHeight: number): void {
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', {
    configurable: true,
    get() {
      return this.getAttribute?.('data-testid') === 'conversation-preview-rail' ? clientHeight : 0;
    },
  });
}

function makePreviewMarker(markerNumber: number): ConversationPreviewMarker {
  return {
    messageId: `preview-marker-${markerNumber}`,
    requestId: `request-preview-marker-${markerNumber}`,
    createdAt: new Date(Date.UTC(2026, 3, 19, 10, 0, markerNumber)).toISOString(),
    previewText: `preview marker ${markerNumber}`,
    previewTruncated: false,
    answerPreviewText: `answer marker ${markerNumber}`,
    answerPreviewTruncated: false,
  };
}

function makePreviewPage(totalMarkers: number, offset: number, count = Math.max(0, Math.min(100, totalMarkers - offset))) {
  return {
    sessionId: 'session-1',
    totalMarkers,
    offset,
    limit: 100,
    markers: Array.from({ length: count }, (_, index) => makePreviewMarker(offset + index + 1)),
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function makeHistoryUserMessage(messageId: string, sequence = 1, sessionId = 'session-1'): SessionConversationMessage {
  return {
    messageId,
    sessionId,
    requestContextId: null,
    rootMessageId: messageId,
    role: 'USER',
    sequence,
    content: messageId,
    contentType: 'PLAIN_TEXT',
    metadata: {},
    createdAt: '2026-04-19T10:00:00.000Z',
    visible: true,
  };
}

function makeHistoryAssistantMessage(messageId: string, rootMessageId: string, sequence = 2, sessionId = 'session-1'): SessionConversationMessage {
  return {
    messageId,
    sessionId,
    requestContextId: rootMessageId,
    rootMessageId,
    role: 'ASSISTANT',
    sequence,
    content: messageId,
    contentType: 'MARKDOWN',
    metadata: {},
    createdAt: '2026-04-19T10:00:01.000Z',
    visible: true,
  };
}

function seedSessionWithHistory(messageId = 'loaded-message') {
  useSessionStore.setState({
    sessions: [
      {
        sessionId: 'session-1',
        displayTitle: 'Session 1',
        lastActivityAt: '2026-04-19T10:00:00.000Z',
      },
    ],
    activeSessionId: 'session-1',
  });
  useConversationStore.setState({
    historyMessagesBySession: {
      'session-1': [makeHistoryUserMessage(messageId)],
    },
    conversationLoadStateBySession: { 'session-1': 'ready' },
  });
}

function seedPresentedTerminalActivity({
  activityId = 'activity-session-1',
  runId = 'run-session-1',
  loadState = 'ready',
}: {
  readonly activityId?: string;
  readonly runId?: string;
  readonly loadState?: 'loading' | 'ready' | 'failed';
} = {}) {
  useSessionStore.setState({
    sessions: [
      {
        sessionId: 'session-1',
        displayTitle: 'Session 1',
        lastActivityAt: '2026-04-19T10:00:00.000Z',
      },
    ],
    activeSessionId: 'session-1',
  });
  useConversationStore.setState({
    historyMessagesBySession: {
      'session-1': [
        makeHistoryUserMessage('root-session-1'),
        {
          ...makeHistoryAssistantMessage('assistant-session-1', 'root-session-1'),
          runId,
          metadata: {
            status: 'COMPLETED',
            runId,
          },
        },
      ],
    },
    conversationLoadStateBySession: { 'session-1': loadState },
  });
  useSessionActivityStore.setState({
    entriesBySessionId: {
      'session-1': {
        sessionId: 'session-1',
        status: 'UNREAD_RESULT',
        activityId,
      },
    },
  });
}

function makeGraphEnvelope(
  rootMessageId: string,
  sequence: number,
  eventType: StreamEnvelope['eventType'],
  payload: Record<string, any> = {},
): StreamEnvelope {
  return {
    eventId: `${rootMessageId}-${sequence}-${eventType}`,
    sessionId: 'session-1',
    requestId: rootMessageId,
    runId: `run-${rootMessageId}`,
    rootMessageId,
    requestContextId: `context-${rootMessageId}`,
    sequence,
    eventType,
    timelineEventRef: null,
    transportHints: ['SSE'],
    payload: {
      rootMessageId,
      ...payload,
    },
    createdAt: `2026-04-20T12:00:${String(sequence).padStart(2, '0')}.000Z`,
  } as StreamEnvelope;
}

function makeLiveTextEnvelope(rootMessageId: string, sequence: number, role: 'USER' | 'ASSISTANT', content: string): StreamEnvelope {
  return {
    eventId: `${rootMessageId}-${sequence}-${role}`,
    sessionId: 'session-1',
    requestId: rootMessageId,
    runId: `run-${rootMessageId}`,
    rootMessageId,
    requestContextId: `context-${rootMessageId}`,
    sequence,
    eventType: role === 'USER' ? 'REQUEST_ACCEPTED' : 'LLM_CONTENT_DELTA',
    timelineEventRef: null,
    transportHints: ['SSE'],
    payload: {
      role,
      content,
      rootMessageId,
      ...(role === 'ASSISTANT' ? { metadata: { accumulated: true } } : {}),
    },
    createdAt: `2026-04-20T13:00:${String(sequence).padStart(2, '0')}.000Z`,
  } as StreamEnvelope;
}

describe('ChatPage route state', () => {
  let requestAnimationFrameSpy: { mockRestore: () => void };
  let cancelAnimationFrameSpy: { mockRestore: () => void };

  beforeEach(() => {
    runtimeConfig.chatUploadFileConfig = {
      chatUploadFileType: ['*.md'],
      chatUploadMaxFileNumber: 10,
      chatUploadMaxFileSize: 10,
      uploadFileIdleExpireTime: 5,
      uploadFileMaxExpireTime: 30,
    };
    requestAnimationFrameSpy = vi
      .spyOn(window, 'requestAnimationFrame')
      .mockImplementation((callback) => scheduleTestAnimationFrame(() => callback(window.performance.now()), 0));
    cancelAnimationFrameSpy = vi.spyOn(window, 'cancelAnimationFrame').mockImplementation((handle) => {
      cancelTestAnimationFrame(handle);
    });
    streamHookState.latestParams = null;
    projectionBuildState.historyCalls = 0;
    selectionResolveState.reportCalls = 0;
    selectionResolveState.shareCalls = 0;
    sessionStorage.clear();
    vi.mocked(sessionService.listSessions).mockReset();
    vi.mocked(sessionService.loadConversation).mockReset();
    vi.mocked(sessionService.loadConversationPreview).mockReset();
    vi.mocked(sessionService.loadRunEvents).mockReset();
    vi.mocked(sessionService.createSession).mockReset();
    vi.mocked(sessionService.forkSessionFromMessage).mockReset();
    vi.mocked(sessionService.forkSessionFromRequest).mockReset();
    vi.mocked(sessionService.renameSession).mockReset();
    vi.mocked(sessionActivityService.consume).mockReset();
    vi.mocked(sessionActivityService.consume).mockResolvedValue(undefined);
    vi.mocked(sessionService.listSessions).mockResolvedValue({
      entries: [],
      offset: 0,
      limit: 50,
      hasMore: false,
    });
    vi.mocked(sessionService.loadConversation).mockResolvedValue({
      sessionId: 'session-1',
      items: [],
      nextCursor: null,
    });
    vi.mocked(sessionService.loadConversationPreview).mockResolvedValue({
      sessionId: 'session-1',
      totalMarkers: 0,
      offset: 0,
      limit: 100,
      markers: [],
    });
    vi.mocked(sessionService.loadRunEvents).mockResolvedValue({
      events: [],
      availability: 'AVAILABLE',
    });
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
      configurable: true,
      writable: true,
      value: vi.fn(),
    });
    Object.defineProperty(HTMLElement.prototype, 'clientHeight', {
      configurable: true,
      value: 0,
    });
    Object.defineProperty(HTMLElement.prototype, 'scrollHeight', {
      configurable: true,
      value: 0,
    });
    Object.defineProperty(window, 'innerWidth', {
      configurable: true,
      writable: true,
      value: 1280,
    });

    useSessionStore.setState({
      sessions: [],
      hasMore: false,
      activeSessionId: null,
      isLoadingHistory: false,
      isOpeningSession: false,
      historyError: null,
      historyOffset: 0,
      historyWindowLimit: RECENT_SESSION_LIMIT,
    });
    useSessionActivityStore.setState({
      entriesBySessionId: {},
      connectionGeneration: 0,
    });
    useConversationStore.setState({
      historyEnvelopesBySession: {},
      activeLiveBySession: {},
      settledLiveBySession: {},
      nextLiveOrdinalBySession: {},
      historyMessagesBySession: {},
      processHistoryBySession: {},
      displayProcessRunByRootBySession: {},
      processHistoryLoadVersionBySession: {},
      forkNoticeBySession: {},
      conversationLoadStateBySession: { 'session-1': 'ready' },
      conversationPageInfoBySession: {},
      conversationPreviewBySession: {},
      conversationViewBySession: {},
      runtimeBySession: {},
      isStreaming: false,
      conversationError: null,
      sessionAccessOrder: [],
    });
    useRequestStore.setState({
      isSubmittingRequest: false,
      activeRequestRootMessageId: null,
      activeRequestSessionId: null,
      requestStatus: 'idle',
      lastIdempotencyKey: null,
      submitError: null,
      cancelError: null,
      retryError: null,
      retryLimitNotice: null,
      editError: null,
      lastSubmittedInput: '',
      lastSubmittedAttachments: [],
      uploadError: null,
      draftBeforeEdit: null,
      pendingRequest: null,
    });
    useUserInputStore.getState().clear();
  });

  afterEach(() => {
    expandPanelStore.getState().close();
    cleanup();
    vi.useRealTimers();
    vi.clearAllMocks();
    requestAnimationFrameSpy.mockRestore();
    cancelAnimationFrameSpy.mockRestore();
    __resetTurnBlockTestState();
  });

  it('does not rescan settled selection eligibility across a long history during an ordinary live update', async () => {
    const historyMessages = Array.from({ length: 100 }, (_, index) => {
      const rootMessageId = `history-${index}`;
      return [makeHistoryUserMessage(rootMessageId, index * 2 + 1), makeHistoryAssistantMessage(`answer-${index}`, rootMessageId, index * 2 + 2)];
    }).flat();
    vi.mocked(sessionService.loadConversation).mockResolvedValue({
      sessionId: 'session-1',
      items: historyMessages,
      nextCursor: null,
    });
    useSessionStore.setState({
      sessions: [
        {
          sessionId: 'session-1',
          displayTitle: 'Long session',
          lastActivityAt: '2026-04-20T13:00:00.000Z',
        },
      ],
      activeSessionId: 'session-1',
    });

    renderChatPage();
    expect(await screen.findByText('history-99')).toBeTruthy();

    act(() => {
      useConversationStore
        .getState()
        .appendEnvelopes('session-1', [
          makeLiveTextEnvelope('live-root', 1, 'USER', 'live question'),
          makeLiveTextEnvelope('live-root', 2, 'ASSISTANT', 'live answer'),
        ]);
    });
    expect(await screen.findByText('live answer')).toBeTruthy();
    await flushAnimationFrames(3);
    selectionResolveState.reportCalls = 0;
    selectionResolveState.shareCalls = 0;

    act(() => {
      useConversationStore.getState().appendEnvelopes('session-1', [makeLiveTextEnvelope('live-root', 3, 'ASSISTANT', 'live answer continued')]);
    });

    expect(await screen.findByText('live answer continued')).toBeTruthy();
    expect(selectionResolveState.reportCalls).toBeLessThan(10);
    expect(selectionResolveState.shareCalls).toBeLessThan(10);
  });

  it('does not resynchronize an unchanged active root on each live snapshot', async () => {
    const setRuntimeStateSpy = vi.spyOn(useConversationStore.getState(), 'setRuntimeState');
    try {
      renderChatPage();
      act(() => {
        useConversationStore
          .getState()
          .appendEnvelopes('session-1', [
            makeLiveTextEnvelope('live-root', 1, 'USER', 'live question'),
            makeLiveTextEnvelope('live-root', 2, 'ASSISTANT', 'live answer'),
          ]);
      });
      expect(await screen.findByText('live answer')).toBeTruthy();
      await flushAnimationFrames(3);
      setRuntimeStateSpy.mockClear();

      act(() => {
        useConversationStore.getState().appendEnvelopes('session-1', [makeLiveTextEnvelope('live-root', 3, 'ASSISTANT', 'live answer continued')]);
      });

      expect(await screen.findByText('live answer continued')).toBeTruthy();
      expect(setRuntimeStateSpy).not.toHaveBeenCalled();
    } finally {
      setRuntimeStateSpy.mockRestore();
    }
  });

  it('loads a favorite route around the target turn instead of the latest conversation window', async () => {
    const loadConversationMock = vi.mocked(sessionService.loadConversation);
    const anchoredConversation = deferred<Awaited<ReturnType<typeof sessionService.loadConversation>>>();
    loadConversationMock.mockImplementation((query) =>
      query.anchorMessageId === 'favorite-root'
        ? anchoredConversation.promise
        : Promise.resolve({
            sessionId: 'session-1',
            items: [makeHistoryUserMessage('latest-root')],
            nextCursor: null,
          }),
    );

    renderChatPage('/session/session-1?messageId=favorite-root');
    const scrollViewport = screen.getByTestId('right-pane-scroll-viewport') as HTMLDivElement & {
      scrollHeight: number;
      clientHeight: number;
      scrollTop: number;
      scrollTo: typeof HTMLElement.prototype.scrollTo;
    };
    mockScrollableViewport(scrollViewport, { scrollHeight: 1000, clientHeight: 400, scrollTop: 600 });
    const restoreTurnLayout = mockTurnBlockLayoutWithinViewport(scrollViewport, 'favorite-root', 240);

    try {
      await waitFor(() => {
        expect(loadConversationMock).toHaveBeenCalledWith(
          expect.objectContaining({
            sessionId: 'session-1',
            anchorMessageId: 'favorite-root',
          }),
        );
        expect(streamHookState.latestParams?.sessionId).toBe('session-1');
      });
      await act(async () => {
        streamHookState.latestParams?.onSessionLiveTailOpen?.();
        await Promise.resolve();
      });
      expect(loadConversationMock.mock.calls.some(([query]) => query.anchorMessageId === undefined)).toBe(false);

      anchoredConversation.resolve({
        sessionId: 'session-1',
        items: [
          makeHistoryUserMessage('favorite-root', 1),
          makeHistoryAssistantMessage('favorite-answer', 'favorite-root', 2),
          makeHistoryUserMessage('latest-root', 3),
          makeHistoryAssistantMessage('latest-answer', 'latest-root', 4),
        ],
        nextCursor: null,
      });
      expect(await screen.findByText('favorite-root')).toBeTruthy();
      expect(screen.getByTestId('route-location').textContent).toBe('/session/session-1?messageId=favorite-root');
      await flushAnimationFrames(35);
      expect(scrollViewport.scrollTop).toBe(216);
      expect(screen.getByTestId('route-location').textContent).toBe('/session/session-1');
    } finally {
      restoreTurnLayout();
    }
  });

  it('clears a stale favorite route after the anchored conversation fails to load', async () => {
    const loadConversationMock = vi.mocked(sessionService.loadConversation);
    loadConversationMock.mockRejectedValueOnce(new Error('raw backend detail'));

    renderChatPage('/session/session-1?messageId=missing-favorite-root');

    await waitFor(() => {
      expect(loadConversationMock).toHaveBeenCalledWith(
        expect.objectContaining({
          sessionId: 'session-1',
          anchorMessageId: 'missing-favorite-root',
        }),
      );
      expect(screen.getByTestId('route-location').textContent).toBe('/session/session-1');
    });
    expect(screen.queryByText('raw backend detail')).toBeNull();
  });

  it('keeps the historical projection stable after the live layer becomes active', async () => {
    seedSessionWithHistory('history-root');
    const historicalEnvelopes = [
      makeGraphEnvelope('history-root', 1, 'REQUEST_ACCEPTED', {
        content: 'historical question',
        role: 'USER',
        messageId: 'history-root',
      }),
      makeGraphEnvelope('history-root', 2, 'LLM_CONTENT_DELTA', {
        content: 'historical answer',
        role: 'ASSISTANT',
      }),
      makeGraphEnvelope('history-root', 3, 'REQUEST_COMPLETED'),
    ];
    useConversationStore.setState({
      historyEnvelopesBySession: { 'session-1': historicalEnvelopes },
    });
    renderChatPage();

    await screen.findByText('historical answer');
    const callsBeforeLive = projectionBuildState.historyCalls;
    const settledCallsBeforeLive = projectionBuildState.settledCalls;
    const acceptedEnvelope = makeGraphEnvelope('history-root', 4, 'REQUEST_ACCEPTED', {
      content: 'live question',
      role: 'USER',
      messageId: 'history-root',
    });

    act(() => {
      useConversationStore.setState({
        activeLiveBySession: { 'session-1': makeLiveBuckets([acceptedEnvelope]) },
      });
    });
    await screen.findByText('live question');
    const callsAfterFirstLiveEnvelope = projectionBuildState.historyCalls;
    expect(callsAfterFirstLiveEnvelope).toBe(callsBeforeLive);
    expect(projectionBuildState.settledCalls).toBe(settledCallsBeforeLive);
    const settledCallsAfterFirstLiveEnvelope = projectionBuildState.settledCalls;

    act(() => {
      useConversationStore.setState({
        activeLiveBySession: {
          'session-1': makeLiveBuckets([
            acceptedEnvelope,
            makeGraphEnvelope('history-root', 5, 'LLM_CONTENT_DELTA', {
              content: 'live answer',
              role: 'ASSISTANT',
            }),
          ]),
        },
      });
    });

    await screen.findByText('live answer');
    expect(projectionBuildState.historyCalls).toBe(callsAfterFirstLiveEnvelope);
    expect(projectionBuildState.settledCalls).toBe(settledCallsAfterFirstLiveEnvelope);
  });

  it('uses the collaborative navigation title instead of rewriting it from the shared history window', () => {
    useSessionStore.setState({
      sessions: [
        {
          sessionId: 'session-picked',
          displayTitle: 'Shared list title',
          lastActivityAt: '2026-06-29T12:00:00.000Z',
        },
      ],
      activeSessionId: 'session-picked',
    });

    renderChatPageCoreWithNavigation({
      sessionId: 'session-picked',
      sessionTitle: 'Clicked history title',
      openSession: () => {},
      openNewSession: () => {},
    });

    expect(screen.getByTestId('right-pane-title').textContent).toBe('Clicked history title');
  });

  it('does not fall back to welcome after the route changes to a session while a request is executing', async () => {
    useRequestStore.setState({
      requestStatus: 'accepted',
      activeRequestRootMessageId: 'run-1',
    });
    useConversationStore.setState({
      historyEnvelopesBySession: {
        'session-1': [
          {
            eventId: 'temp-run-1',
            sessionId: 'session-1',
            requestId: 'run-1',
            sequence: 0,
            eventType: 'REQUEST_ACCEPTED',
            timelineEventRef: null,
            transportHints: ['local-optimistic'],
            payload: {
              content: 'test',
              role: 'USER',
              messageId: 'run-1',
              rootMessageId: 'run-1',
            },
            createdAt: '2026-04-16T07:34:43.000Z',
          },
        ],
      },
      conversationLoadStateBySession: {},
    });

    renderChatPage();

    await waitFor(() => {
      expect(streamHookState.latestParams?.sessionId).toBe('session-1');
    });
    expect(streamHookState.latestParams?.canOpenStream).toBe(true);
    expect(screen.queryByTestId('welcome-state-root')).toBeNull();
    expect(screen.getByTestId('btn-stop')).toBeTruthy();
    expect(screen.getByTestId('message-textarea')).toBeTruthy();
  });

  it('does not show stop while submit is waiting for an accepted request id', async () => {
    useRequestStore.setState({
      requestStatus: 'submitting',
      activeRequestRootMessageId: null,
    });
    useConversationStore.setState({
      historyEnvelopesBySession: {
        'session-1': [
          {
            eventId: 'temp-run-1',
            sessionId: 'session-1',
            requestId: 'client-submit',
            sequence: 0,
            eventType: 'REQUEST_ACCEPTED',
            timelineEventRef: null,
            transportHints: ['local-optimistic'],
            payload: {
              content: 'test',
              role: 'USER',
              messageId: 'client-submit',
              rootMessageId: 'client-submit',
            },
            createdAt: '2026-04-16T07:34:43.000Z',
          },
        ],
      },
      conversationLoadStateBySession: {},
    });

    renderChatPage();

    await waitFor(() => {
      expect(streamHookState.latestParams?.sessionId).toBe('session-1');
    });
    expect(screen.queryByTestId('welcome-state-root')).toBeNull();
    expect(screen.queryByTestId('btn-stop')).toBeNull();
    expect(screen.getByTestId('btn-send')).toBeTruthy();
  });

  it('does not expose a pre-HTTP stream candidate as a stop target', async () => {
    useRequestStore.setState({
      requestStatus: 'accepted',
      activeRequestRootMessageId: 'candidate-root',
      activeRequestSessionId: 'session-1',
      pendingRequest: {
        kind: 'submit',
        sessionId: 'session-1',
        idempotencyKey: 'submit-idempotency-key',
        startedAtMs: Date.now(),
        optimisticRequestId: 'client-submit',
        acceptedRootMessageId: 'candidate-root',
        acceptedRunId: 'candidate-run',
        acceptedRequestContextId: 'candidate-context',
        httpIdentityConfirmed: false,
      },
    });

    renderChatPage();

    await waitFor(() => {
      expect(streamHookState.latestParams?.sessionId).toBe('session-1');
    });
    expect(screen.queryByTestId('btn-stop')).toBeNull();
    expect(streamHookState.latestParams?.acceptedRun).toBeNull();
  });

  it('replaces the composer with an approval response and submits the correlated input request', async () => {
    const submitInputSpy = vi.spyOn(requestService, 'submitUserInputResponse').mockResolvedValueOnce(undefined);
    useSessionStore.setState({
      sessions: [
        {
          sessionId: 'session-1',
          displayTitle: 'Session 1',
          lastActivityAt: '2026-04-19T10:00:00.000Z',
        },
      ],
      activeSessionId: 'session-1',
    });

    renderChatPage();

    await waitFor(() => {
      expect(streamHookState.latestParams?.onUserInputRequired).toBeTypeOf('function');
      expect(screen.getByTestId('message-textarea')).toBeTruthy();
    });

    act(() => {
      streamHookState.latestParams?.onUserInputRequired?.({
        eventId: 'evt-input-required',
        sessionId: 'session-1',
        requestId: 'req-1',
        sequence: 8,
        eventType: 'USER_INPUT_REQUIRED',
        timelineEventRef: null,
        transportHints: ['SSE'],
        payload: {
          inputRequestId: 'input-approval-1',
          inputKind: 'APPROVAL',
          prompt: '是否批准删除生产环境防火墙规则？',
          riskLevel: 'CRITICAL',
          options: [
            { id: 'approve', label: '批准' },
            { id: 'reject', label: '拒绝' },
          ],
        },
        createdAt: '2026-04-19T10:00:05.000Z',
      });
    });

    expect(screen.getByTestId('respond-input-approval')).toBeTruthy();
    expect(screen.getByTestId('respond-risk-level').textContent).toContain('严重风险');
    expect(screen.queryByTestId('message-textarea')).toBeNull();

    await act(async () => {
      fireEvent.click(screen.getByTestId('respond-option-approve'));
    });

    await waitFor(() => {
      expect(submitInputSpy).toHaveBeenCalledWith('session-1', 'input-approval-1', { answers: [['approve']] });
    });
    await waitFor(() => {
      expect(screen.queryByTestId('respond-input')).toBeNull();
      expect(screen.getByTestId('message-textarea')).toBeTruthy();
    });

    submitInputSpy.mockRestore();
  });

  it('renders canonical CONFIRMATION controls and restores the composer after submit', async () => {
    const submitInputSpy = vi.spyOn(requestService, 'submitUserInputResponse').mockResolvedValueOnce(undefined);
    useSessionStore.setState({
      sessions: [
        {
          sessionId: 'session-1',
          displayTitle: 'Session 1',
          lastActivityAt: '2026-04-19T10:00:00.000Z',
        },
      ],
      activeSessionId: 'session-1',
    });

    renderChatPage();

    await waitFor(() => {
      expect(streamHookState.latestParams?.onUserInputRequired).toBeTypeOf('function');
    });

    act(() => {
      streamHookState.latestParams?.onUserInputRequired?.({
        eventId: 'evt-confirmation-required',
        sessionId: 'session-1',
        requestId: 'req-1',
        sequence: 8,
        eventType: 'USER_INPUT_REQUIRED',
        timelineEventRef: null,
        transportHints: ['SSE'],
        payload: {
          pendingInputId: 'pending-confirm-1',
          kind: 'CONFIRMATION',
          questions: [
            {
              prompt: '是否继续执行诊断？',
              options: [
                { value: 'reject', label: '拒绝' },
                { value: 'approve', label: '确认' },
              ],
            },
          ],
        },
        createdAt: '2026-04-19T10:00:05.000Z',
      });
    });

    expect(screen.getByTestId('respond-input-confirmation')).toBeTruthy();
    expect(screen.queryByTestId('message-textarea')).toBeNull();
    expect(screen.getByTestId('respond-option-reject').textContent).toContain('拒绝');
    expect(screen.getByTestId('respond-option-approve').textContent).toContain('确认');

    await act(async () => {
      fireEvent.click(screen.getByTestId('respond-option-approve'));
    });

    await waitFor(() => {
      expect(submitInputSpy).toHaveBeenCalledWith('session-1', 'pending-confirm-1', { answers: [['approve']] });
    });
    await waitFor(() => {
      expect(screen.queryByTestId('respond-input')).toBeNull();
      expect(screen.getByTestId('message-textarea')).toBeTruthy();
    });

    submitInputSpy.mockRestore();
  });

  it('cancels a restored pending input using the pending request id and returns to the composer after resolution', async () => {
    const cancelSpy = vi.spyOn(requestService, 'cancelRequest').mockResolvedValueOnce({
      sessionId: 'session-1',
      targetRequestId: 'req-1',
      action: 'CANCEL_LATEST',
      idempotencyKey: 'cancel-key',
    });
    useSessionStore.setState({
      sessions: [
        {
          sessionId: 'session-1',
          displayTitle: 'Session 1',
          lastActivityAt: '2026-04-19T10:00:00.000Z',
        },
      ],
      activeSessionId: 'session-1',
    });
    useRequestStore.setState({
      activeRequestRootMessageId: null,
      pendingRequest: null,
    });

    renderChatPage();

    await waitFor(() => {
      expect(streamHookState.latestParams?.onUserInputRequired).toBeTypeOf('function');
    });

    act(() => {
      streamHookState.latestParams?.onUserInputRequired?.({
        eventId: 'evt-input-required',
        sessionId: 'session-1',
        requestId: 'req-1',
        sequence: 8,
        eventType: 'USER_INPUT_REQUIRED',
        timelineEventRef: null,
        transportHints: ['SSE'],
        payload: {
          inputRequestId: 'input-question-1',
          inputKind: 'QUESTION',
          prompt: 'Which cell should be checked?',
        },
        createdAt: '2026-04-19T10:00:05.000Z',
      });
    });

    expect(screen.getByTestId('respond-input-question')).toBeTruthy();
    expect(screen.queryByTestId('message-textarea')).toBeNull();

    await act(async () => {
      fireEvent.click(screen.getByTestId('btn-cancel-response'));
    });

    await waitFor(() => {
      expect(cancelSpy).toHaveBeenCalledWith('session-1', 'req-1', expect.any(String));
    });
    expect(screen.getByTestId('respond-input-question')).toBeTruthy();
    expect(screen.queryByTestId('message-textarea')).toBeNull();

    act(() => {
      streamHookState.latestParams?.onUserInputResolved?.({
        eventId: 'evt-input-canceled',
        sessionId: 'session-1',
        requestId: 'req-1',
        sequence: 9,
        eventType: 'USER_INPUT_CANCELED',
        timelineEventRef: null,
        transportHints: ['SSE'],
        payload: {
          inputRequestId: 'input-question-1',
        },
        createdAt: '2026-04-19T10:00:06.000Z',
      });
    });

    await waitFor(() => {
      expect(screen.queryByTestId('respond-input')).toBeNull();
      expect(screen.getByTestId('message-textarea')).toBeTruthy();
    });

    cancelSpy.mockRestore();
  });

  it('accepts NextAgent pending input payloads from the stream', async () => {
    useSessionStore.setState({
      sessions: [
        {
          sessionId: 'session-1',
          displayTitle: 'Session 1',
          lastActivityAt: Date.parse('2026-04-19T10:00:00.000Z'),
        },
      ],
      activeSessionId: 'session-1',
    });

    renderChatPage();

    await waitFor(() => {
      expect(streamHookState.latestParams?.onUserInputRequired).toBeTypeOf('function');
    });

    const timeoutAt = Date.parse('2026-04-19T10:02:00.000Z');
    act(() => {
      streamHookState.latestParams?.onUserInputRequired?.({
        eventId: 'evt-nextagent-input-required',
        sessionId: 'session-1',
        requestId: 'req-1',
        sequence: 8,
        eventType: 'USER_INPUT_REQUIRED',
        timelineEventRef: null,
        transportHints: ['SSE'],
        payload: {
          pendingInputId: 'pending-auth-1',
          kind: 'AUTHORIZATION',
          questions: [
            {
              prompt: 'Allow sandbox execution?',
            },
          ],
          timeoutAt,
        },
        createdAt: Date.parse('2026-04-19T10:00:05.000Z'),
      });
    });

    expect(screen.getByTestId('respond-input-authorization')).toBeTruthy();
    expect(screen.getByTestId('respond-input-header').textContent).toContain('Allow sandbox execution?');
    expect(screen.getByTestId('respond-input-header').textContent).toContain('剩余时间');
    expect(useUserInputStore.getState().activeInput).toMatchObject({
      inputRequestId: 'pending-auth-1',
      inputKind: 'AUTHORIZATION',
      prompt: 'Allow sandbox execution?',
      expiresAt: timeoutAt,
    });
  });

  it('keeps an expired pending input active until canonical timeout resolves it', async () => {
    const submitInputSpy = vi.spyOn(requestService, 'submitUserInputResponse').mockResolvedValue(undefined);
    const cancelSpy = vi.spyOn(requestService, 'cancelRequest').mockResolvedValue({
      sessionId: 'session-1',
      targetRequestId: 'req-1',
      action: 'CANCEL_LATEST',
      idempotencyKey: 'cancel-key',
    });
    useSessionStore.setState({
      sessions: [
        {
          sessionId: 'session-1',
          displayTitle: 'Session 1',
          lastActivityAt: '2026-04-19T10:00:00.000Z',
        },
      ],
      activeSessionId: 'session-1',
    });

    renderChatPage();

    await waitFor(() => {
      expect(streamHookState.latestParams?.onUserInputRequired).toBeTypeOf('function');
    });

    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-19T10:00:01.000Z'));
    const timeoutAt = Date.parse('2026-04-19T10:00:01.000Z');

    act(() => {
      streamHookState.latestParams?.onUserInputRequired?.({
        eventId: 'evt-input-required',
        sessionId: 'session-1',
        requestId: 'req-1',
        sequence: 8,
        eventType: 'USER_INPUT_REQUIRED',
        timelineEventRef: null,
        transportHints: ['SSE'],
        payload: {
          inputRequestId: 'input-confirm-1',
          inputKind: 'CONFIRMATION',
          prompt: '是否继续执行诊断？',
          timeoutAt,
        },
        createdAt: '2026-04-19T10:00:00.000Z',
      });
    });

    expect(screen.getByTestId('respond-input-confirmation')).toBeTruthy();
    expect(screen.queryByTestId('message-textarea')).toBeNull();
    expect(useUserInputStore.getState().activeInput).toMatchObject({
      inputRequestId: 'input-confirm-1',
      expiresAt: timeoutAt,
    });

    expect(screen.getByTestId('respond-input-confirmation')).toBeTruthy();
    expect(screen.queryByTestId('message-textarea')).toBeNull();
    expect(useUserInputStore.getState().activeInput?.inputRequestId).toBe('input-confirm-1');
    expect(submitInputSpy).not.toHaveBeenCalled();
    expect(cancelSpy).not.toHaveBeenCalled();

    act(() => {
      streamHookState.latestParams?.onUserInputResolved?.({
        eventId: 'evt-input-timeout',
        sessionId: 'session-1',
        requestId: 'req-1',
        sequence: 9,
        eventType: 'USER_INPUT_TIMEOUT',
        timelineEventRef: null,
        transportHints: ['SSE'],
        payload: {
          inputRequestId: 'input-confirm-1',
        },
        createdAt: '2026-04-19T10:00:01.000Z',
      });
    });

    expect(useUserInputStore.getState().activeInput).toBeNull();
    expect(screen.queryByTestId('respond-input')).toBeNull();
    expect(screen.getByTestId('message-textarea')).toBeTruthy();

    submitInputSpy.mockRestore();
    cancelSpy.mockRestore();
  });

  it('restores the normal composer when canonical timeout is replayed after switching back', async () => {
    const submitInputSpy = vi.spyOn(requestService, 'submitUserInputResponse').mockResolvedValue(undefined);
    const cancelSpy = vi.spyOn(requestService, 'cancelRequest').mockResolvedValue({
      sessionId: 'session-a',
      targetRequestId: 'req-a',
      action: 'CANCEL_LATEST',
      idempotencyKey: 'cancel-key',
    });
    useSessionStore.setState({
      sessions: [
        {
          sessionId: 'session-a',
          displayTitle: 'Session A',
          lastActivityAt: '2026-04-19T10:00:00.000Z',
        },
        {
          sessionId: 'session-b',
          displayTitle: 'Session B',
          lastActivityAt: '2026-04-19T10:01:00.000Z',
        },
      ],
      activeSessionId: 'session-a',
    });
    useConversationStore.setState({
      conversationLoadStateBySession: {
        'session-a': 'ready',
        'session-b': 'ready',
      },
    });

    render(<ChatPageCoreSessionSwitchHarness />);
    await waitFor(() => {
      expect(streamHookState.latestParams?.sessionId).toBe('session-a');
    });
    act(() => {
      streamHookState.latestParams?.onUserInputRequired?.({
        eventId: 'evt-input-required-a',
        sessionId: 'session-a',
        requestId: 'req-a',
        sequence: 8,
        eventType: 'USER_INPUT_REQUIRED',
        timelineEventRef: null,
        transportHints: ['SSE'],
        payload: {
          inputRequestId: 'input-a',
          inputKind: 'QUESTION',
          prompt: '需要补充信息吗？',
          timeoutAt: Date.parse('2026-04-19T10:00:01.000Z'),
        },
        createdAt: '2026-04-19T10:00:00.000Z',
      });
    });
    expect(screen.getByTestId('respond-input')).toBeTruthy();

    fireEvent.click(screen.getByTestId('switch-session-b'));
    await waitFor(() => {
      expect(streamHookState.latestParams?.sessionId).toBe('session-b');
      expect(screen.getByTestId('message-textarea')).toBeTruthy();
    });
    useSessionActivityStore.setState({
      entriesBySessionId: {
        'session-a': {
          sessionId: 'session-a',
          status: 'UNREAD_FAILURE',
          activityId: 'activity-timeout-a',
        },
      },
    });

    fireEvent.click(screen.getByTestId('switch-session-a'));
    await waitFor(() => {
      expect(streamHookState.latestParams?.sessionId).toBe('session-a');
    });
    act(() => {
      streamHookState.latestParams?.onUserInputRequired?.({
        eventId: 'evt-input-required-a-replay',
        sessionId: 'session-a',
        requestId: 'req-a',
        sequence: 8,
        eventType: 'USER_INPUT_REQUIRED',
        timelineEventRef: null,
        transportHints: ['SSE'],
        payload: {
          inputRequestId: 'input-a',
          inputKind: 'QUESTION',
          prompt: '需要补充信息吗？',
          timeoutAt: Date.parse('2026-04-19T10:00:01.000Z'),
        },
        createdAt: '2026-04-19T10:00:00.000Z',
      });
    });
    expect(screen.getByTestId('respond-input')).toBeTruthy();

    act(() => {
      streamHookState.latestParams?.onUserInputResolved?.({
        eventId: 'evt-input-timeout-a',
        sessionId: 'session-a',
        requestId: 'req-a',
        sequence: 9,
        eventType: 'USER_INPUT_TIMEOUT',
        timelineEventRef: null,
        transportHints: ['SSE'],
        payload: {
          inputRequestId: 'input-a',
        },
        createdAt: '2026-04-19T10:00:01.000Z',
      });
    });

    expect(useUserInputStore.getState().activeInput).toBeNull();
    expect(screen.queryByTestId('respond-input')).toBeNull();
    expect(screen.getByTestId('message-textarea')).toBeTruthy();
    expect(submitInputSpy).not.toHaveBeenCalled();
    expect(cancelSpy).not.toHaveBeenCalled();
  });

  it('keeps the session stream open for an ended session after refresh', async () => {
    useSessionStore.setState({
      sessions: [
        {
          sessionId: 'session-1',
          displayTitle: 'Session 1',
          lastActivityAt: '2026-04-19T10:00:00.000Z',
        },
      ],
      activeSessionId: 'session-1',
    });

    renderChatPage();

    await waitFor(() => {
      expect(streamHookState.latestParams?.sessionId).toBe('session-1');
    });
    expect(streamHookState.latestParams?.canOpenStream).toBe(true);
  });

  it('does not fabricate completed execution details for older history turns without terminal status metadata', async () => {
    const historyItems: SessionConversationMessage[] = [
      {
        messageId: 'msg-user-1',
        sessionId: 'session-1',
        requestContextId: null,
        rootMessageId: 'msg-user-1',
        role: 'USER',
        sequence: 1,
        content: 'older question',
        contentType: 'PLAIN_TEXT',
        metadata: {},
        createdAt: '2026-04-19T10:00:00.000Z',
        visible: true,
      },
      {
        messageId: 'msg-tool-1',
        sessionId: 'session-1',
        requestContextId: 'msg-user-1',
        rootMessageId: 'msg-user-1',
        role: 'CAPABILITY_RESULT',
        sequence: 2,
        content: 'older tool result',
        contentType: 'PLAIN_TEXT',
        metadata: { toolCallId: 'tool-1', toolName: 'diagnose' },
        createdAt: '2026-04-19T10:00:01.000Z',
        visible: true,
      },
      {
        messageId: 'msg-assistant-1',
        sessionId: 'session-1',
        requestContextId: 'msg-user-1',
        rootMessageId: 'msg-user-1',
        role: 'ASSISTANT',
        sequence: 3,
        content: 'older answer',
        contentType: 'MARKDOWN',
        metadata: {},
        createdAt: '2026-04-19T10:00:02.000Z',
        visible: true,
      },
      {
        messageId: 'msg-user-2',
        sessionId: 'session-1',
        requestContextId: null,
        rootMessageId: 'msg-user-2',
        role: 'USER',
        sequence: 4,
        content: 'latest question',
        contentType: 'PLAIN_TEXT',
        metadata: {},
        createdAt: '2026-04-19T10:00:03.000Z',
        visible: true,
      },
      {
        messageId: 'msg-assistant-2',
        sessionId: 'session-1',
        requestContextId: 'msg-user-2',
        rootMessageId: 'msg-user-2',
        role: 'ASSISTANT',
        sequence: 5,
        content: 'latest answer',
        contentType: 'MARKDOWN',
        metadata: {},
        createdAt: '2026-04-19T10:00:04.000Z',
        visible: true,
      },
    ];
    vi.mocked(sessionService.loadConversation).mockResolvedValueOnce({
      sessionId: 'session-1',
      items: historyItems,
      nextCursor: null,
    });
    vi.mocked(sessionService.listSessions).mockResolvedValueOnce({
      entries: [
        {
          sessionId: 'session-1',
          displayTitle: 'Session 1',
          lastActivityAt: '2026-04-19T10:00:04.000Z',
        },
      ],
      offset: 0,
      limit: 50,
      hasMore: false,
    });
    useSessionStore.setState({
      sessions: [
        {
          sessionId: 'session-1',
          displayTitle: 'Session 1',
          lastActivityAt: '2026-04-19T10:00:00.000Z',
        },
      ],
      activeSessionId: 'session-1',
    });
    useConversationStore.setState({
      historyEnvelopesBySession: { 'session-1': [] },
      activeLiveBySession: { 'session-1': {} },
      historyMessagesBySession: {
        'session-1': historyItems,
      },
      conversationLoadStateBySession: { 'session-1': 'ready' },
    });

    renderChatPage();

    await waitFor(() => {
      const olderTurn = document.querySelector('[data-root-message-id="msg-user-1"]');
      const summary = olderTurn?.querySelector('[data-testid="turn-process-summary-text"]');
      expect(summary?.textContent).toBe('NextAgent正在执行中...');
    });
  });

  it('does not reuse a persisted session-level live cursor when reopening the session stream', async () => {
    sessionStorage.setItem('chat-last-live-sequence:session-1', '23');
    useSessionStore.setState({
      sessions: [
        {
          sessionId: 'session-1',
          displayTitle: 'Session 1',
          lastActivityAt: '2026-04-19T10:00:00.000Z',
        },
      ],
      activeSessionId: 'session-1',
    });

    renderChatPage();

    await waitFor(() => {
      expect(streamHookState.latestParams?.sessionId).toBe('session-1');
    });
    expect(streamHookState.latestParams).not.toHaveProperty('activeRequestId');
    expect(streamHookState.latestParams).not.toHaveProperty('activeRequestStartedAtMs');
  });

  it('ignores a legacy persisted stream cursor when reopening the session page', async () => {
    sessionStorage.setItem('chat-stream-cursor:session-1', '17');
    const inFlightSession: SessionHistoryEntry = {
      sessionId: 'session-1',
      displayTitle: 'Session 1',
      lastActivityAt: '2026-04-19T10:00:01.000Z',
    };
    const historyItems: SessionConversationMessage[] = [
      {
        messageId: 'root-1',
        sessionId: 'session-1',
        requestContextId: null,
        rootMessageId: 'root-1',
        role: 'USER',
        sequence: 1,
        content: 'Question',
        contentType: 'PLAIN_TEXT',
        metadata: {},
        createdAt: '2026-04-19T10:00:00.000Z',
        visible: true,
      },
      {
        messageId: 'answer-1',
        sessionId: 'session-1',
        requestContextId: 'root-1',
        rootMessageId: 'root-1',
        role: 'ASSISTANT',
        sequence: 2,
        content: 'Partial answer',
        contentType: 'PLAIN_TEXT',
        metadata: {},
        createdAt: '2026-04-19T10:00:01.000Z',
        visible: true,
      },
    ];
    vi.mocked(sessionService.listSessions).mockResolvedValueOnce({
      entries: [inFlightSession],
      offset: 0,
      limit: 50,
      hasMore: false,
    });
    vi.mocked(sessionService.loadConversation).mockResolvedValueOnce({
      sessionId: 'session-1',
      items: historyItems,
      nextCursor: null,
    });
    useSessionStore.setState({
      sessions: [inFlightSession],
      activeSessionId: 'session-1',
    });
    useConversationStore.setState({
      historyMessagesBySession: {
        'session-1': historyItems,
      },
      conversationLoadStateBySession: { 'session-1': 'ready' },
    });

    renderChatPage();

    await waitFor(() => {
      expect(streamHookState.latestParams?.sessionId).toBe('session-1');
    });
    expect(streamHookState.latestParams).not.toHaveProperty('activeRequestId');
    expect(streamHookState.latestParams).not.toHaveProperty('shouldReplayStream');
    expect(streamHookState.latestParams).not.toHaveProperty('activeRequestStartedAtMs');
  });

  it('creates a session before submitting when sending from the root route', async () => {
    let resolveSession!: (value: Awaited<ReturnType<typeof sessionService.createSession>>) => void;
    const createSessionPromise = new Promise<Awaited<ReturnType<typeof sessionService.createSession>>>((resolve) => {
      resolveSession = resolve;
    });
    vi.mocked(sessionService.createSession).mockReturnValueOnce(createSessionPromise);
    const requestState = useRequestStore.getState();
    const submitSpy = vi.spyOn(requestState, 'submitRequestWithAttachments').mockResolvedValue(undefined);

    renderChatPage('/');
    expect(sessionService.createSession).not.toHaveBeenCalled();

    fireEvent.change(screen.getByTestId('message-textarea'), {
      target: { value: 'hello from root' },
    });

    fireEvent.click(screen.getByTestId('btn-send'));

    await waitFor(() => {
      expect(sessionService.createSession).toHaveBeenCalledTimes(1);
    });
    expect(sessionService.createSession).toHaveBeenCalledWith(
      expect.objectContaining({
        locale: expect.any(String),
        idempotencyKey: expect.any(String),
      }),
    );
    expect(submitSpy).not.toHaveBeenCalled();

    await act(async () => {
      resolveSession({
        sessionId: 'session-new',
        displayTitle: 'New session',
        lastActivityAt: Date.now(),
      });
      await createSessionPromise;
    });

    await waitFor(() => {
      expect(submitSpy).toHaveBeenCalledWith('hello from root', [], [], undefined);
    });
    expect(useSessionStore.getState().activeSessionId).toBe('session-new');
    submitSpy.mockRestore();
  });

  it('keeps the root draft when session creation fails and does not submit', async () => {
    vi.mocked(sessionService.createSession).mockRejectedValueOnce(new Error('session creation failed'));
    const requestState = useRequestStore.getState();
    const submitSpy = vi.spyOn(requestState, 'submitRequestWithAttachments').mockResolvedValue(undefined);

    renderChatPage('/');

    const textarea = screen.getByTestId('message-textarea') as HTMLTextAreaElement;
    fireEvent.change(textarea, {
      target: { value: 'keep this root draft' },
    });
    fireEvent.click(screen.getByTestId('btn-send'));

    await waitFor(() => {
      expect(sessionService.createSession).toHaveBeenCalledTimes(1);
    });
    await waitFor(() => {
      expect((screen.getByTestId('btn-send') as HTMLButtonElement).disabled).toBe(false);
      expect((screen.getByTestId('message-textarea') as HTMLTextAreaElement).value).toBe('keep this root draft');
    });
    expect(submitSpy).not.toHaveBeenCalled();
    expect(useSessionStore.getState().activeSessionId).toBeNull();
    submitSpy.mockRestore();
  });

  it('submits in an existing session without creating another session', async () => {
    useSessionStore.setState({
      sessions: [
        {
          sessionId: 'session-1',
          displayTitle: 'Session 1',
          lastActivityAt: '2026-04-19T10:00:00.000Z',
        },
      ],
      activeSessionId: 'session-1',
    });
    const requestState = useRequestStore.getState();
    const submitSpy = vi.spyOn(requestState, 'submitRequestWithAttachments').mockResolvedValue(undefined);

    renderChatPage('/session/session-1');

    fireEvent.change(screen.getByTestId('message-textarea'), {
      target: { value: 'continue existing session' },
    });
    fireEvent.click(screen.getByTestId('btn-send'));

    await waitFor(() => {
      expect(submitSpy).toHaveBeenCalledWith('continue existing session', [], [], undefined);
    });
    expect(sessionService.createSession).not.toHaveBeenCalled();
    submitSpy.mockRestore();
  });

  it('forks from a persisted assistant response and opens the child session', async () => {
    const historyItems = [makeHistoryUserMessage('root-1'), makeHistoryAssistantMessage('assistant-1', 'root-1')];
    vi.mocked(sessionService.loadConversation).mockResolvedValue({
      sessionId: 'session-1',
      items: historyItems,
      nextCursor: null,
    });
    vi.mocked(sessionService.forkSessionFromMessage).mockResolvedValueOnce({
      sessionId: 'child-session',
      displayTitle: 'Session 1',
      lastActivityAt: '2026-04-19T10:00:02.000Z',
    });
    useSessionStore.setState({
      sessions: [
        {
          sessionId: 'session-1',
          displayTitle: 'Session 1',
          lastActivityAt: '2026-04-19T10:00:00.000Z',
        },
      ],
      activeSessionId: 'session-1',
    });
    useConversationStore.setState({
      historyMessagesBySession: { 'session-1': historyItems },
      conversationLoadStateBySession: { 'session-1': 'ready' },
    });

    renderChatPage();

    await act(async () => {
      fireEvent.click(await screen.findByTestId('btn-more-actions'));
      fireEvent.click(await screen.findByTestId('btn-fork-ai'));
    });

    await waitFor(() => {
      expect(sessionService.forkSessionFromMessage).toHaveBeenCalledWith({
        sessionId: 'session-1',
        messageId: 'assistant-1',
        idempotencyKey: expect.any(String),
      });
    });
    expect(useSessionStore.getState().activeSessionId).toBe('child-session');
    await waitFor(() => {
      expect(sessionService.loadConversation).toHaveBeenCalledWith(
        expect.objectContaining({
          sessionId: 'child-session',
        }),
      );
    });
  });

  it('keeps persisted assistant fork available while a new request is in flight', async () => {
    const historyItems = [makeHistoryUserMessage('root-1'), makeHistoryAssistantMessage('assistant-1', 'root-1')];
    vi.mocked(sessionService.loadConversation).mockResolvedValue({
      sessionId: 'session-1',
      items: historyItems,
      nextCursor: null,
    });
    vi.mocked(sessionService.forkSessionFromMessage).mockResolvedValueOnce({
      sessionId: 'child-session',
      displayTitle: 'Session 1',
      lastActivityAt: '2026-04-19T10:00:02.000Z',
    });
    useSessionStore.setState({
      sessions: [
        {
          sessionId: 'session-1',
          displayTitle: 'Session 1',
          lastActivityAt: '2026-04-19T10:00:00.000Z',
        },
      ],
      activeSessionId: 'session-1',
    });
    useConversationStore.setState({
      historyMessagesBySession: { 'session-1': historyItems },
      conversationLoadStateBySession: { 'session-1': 'ready' },
    });
    useRequestStore.setState({
      requestStatus: 'accepted',
      activeRequestRootMessageId: 'root-in-flight',
      pendingRequest: {
        kind: 'submit',
        sessionId: 'session-1',
        idempotencyKey: 'submit-key',
        startedAtMs: Date.now(),
        optimisticRequestId: 'root-in-flight',
        acceptedRootMessageId: 'root-in-flight',
        acceptedRunId: 'run-in-flight',
      },
    });

    renderChatPage();

    await act(async () => {
      fireEvent.click(await screen.findByTestId('btn-more-actions'));
      fireEvent.click(await screen.findByTestId('btn-fork-ai'));
    });

    await waitFor(() => {
      expect(sessionService.forkSessionFromMessage).toHaveBeenCalledWith({
        sessionId: 'session-1',
        messageId: 'assistant-1',
        idempotencyKey: expect.any(String),
      });
    });
  });

  it('forks from a completed live assistant response through the request fork route', async () => {
    const rootMessageId = 'live-root-1';
    const liveEnvelopes = [
      makeGraphEnvelope(rootMessageId, 1, 'REQUEST_ACCEPTED', {
        role: 'USER',
        content: 'live question',
        messageId: rootMessageId,
        rootMessageId,
      }),
      makeGraphEnvelope(rootMessageId, 2, 'LLM_CONTENT_DELTA', {
        content: 'live answer',
      }),
      makeGraphEnvelope(rootMessageId, 3, 'REQUEST_COMPLETED', {
        content: 'live answer',
      }),
    ];
    vi.mocked(sessionService.forkSessionFromRequest).mockResolvedValueOnce({
      sessionId: 'child-session-live',
      displayTitle: 'Session 1',
      lastActivityAt: '2026-04-19T10:00:03.000Z',
    });
    useSessionStore.setState({
      sessions: [
        {
          sessionId: 'session-1',
          displayTitle: 'Session 1',
          lastActivityAt: '2026-04-19T10:00:00.000Z',
        },
      ],
      activeSessionId: 'session-1',
    });
    useConversationStore.setState({
      historyEnvelopesBySession: { 'session-1': liveEnvelopes },
      conversationLoadStateBySession: { 'session-1': 'ready' },
    });

    renderChatPage();

    await clickLatestOverflowForkAction();

    await waitFor(() => {
      expect(sessionService.forkSessionFromRequest).toHaveBeenCalledWith({
        sessionId: 'session-1',
        requestId: rootMessageId,
        idempotencyKey: expect.any(String),
      });
    });
    expect(sessionService.forkSessionFromMessage).not.toHaveBeenCalled();
    expect(useSessionStore.getState().activeSessionId).toBe('child-session-live');
  });

  it('keeps the current session when fork creation fails', async () => {
    const historyItems = [makeHistoryUserMessage('root-1'), makeHistoryAssistantMessage('assistant-1', 'root-1')];
    vi.mocked(sessionService.loadConversation).mockResolvedValue({
      sessionId: 'session-1',
      items: historyItems,
      nextCursor: null,
    });
    vi.mocked(sessionService.forkSessionFromMessage).mockRejectedValueOnce(new Error('Fork source message not found'));
    useSessionStore.setState({
      sessions: [
        {
          sessionId: 'session-1',
          displayTitle: 'Session 1',
          lastActivityAt: '2026-04-19T10:00:00.000Z',
        },
      ],
      activeSessionId: 'session-1',
    });
    useConversationStore.setState({
      historyMessagesBySession: { 'session-1': historyItems },
      conversationLoadStateBySession: { 'session-1': 'ready' },
    });

    renderChatPage();

    await act(async () => {
      fireEvent.click(await screen.findByTestId('btn-more-actions'));
      fireEvent.click(await screen.findByTestId('btn-fork-ai'));
    });

    await waitFor(() => {
      expect(sessionService.forkSessionFromMessage).toHaveBeenCalled();
    });
    expect(useSessionStore.getState().activeSessionId).toBe('session-1');
    await waitFor(() => {
      expect((screen.getByTestId('btn-more-actions') as HTMLButtonElement).disabled).toBe(false);
    });
  });

  it('shows a fork notice on child sessions and lets the user open the source session', async () => {
    vi.mocked(sessionService.loadConversation).mockImplementation((request) =>
      Promise.resolve({
        sessionId: request.sessionId,
        items: [],
        nextCursor: null,
        ...(request.sessionId === 'child-session'
          ? {
              forkNotice: {
                sourceSessionId: 'session-1',
                sourceSessionTitle: 'Source session',
              },
            }
          : {}),
      }),
    );
    useSessionStore.setState({
      sessions: [
        {
          sessionId: 'child-session',
          displayTitle: 'Session 1',
          lastActivityAt: '2026-04-19T10:00:00.000Z',
        },
      ],
      activeSessionId: 'child-session',
    });
    useConversationStore.setState({
      historyMessagesBySession: {
        'child-session': [
          makeHistoryUserMessage('root-1', 1, 'child-session'),
          makeHistoryAssistantMessage('assistant-1', 'root-1', 2, 'child-session'),
        ],
      },
      forkNoticeBySession: {
        'child-session': {
          sourceSessionId: 'session-1',
          sourceSessionTitle: 'Source session',
        },
      },
      conversationLoadStateBySession: { 'child-session': 'ready' },
    });

    renderChatPage('/session/child-session');

    const notice = await screen.findByTestId('fork-notice');
    const sourceButton = await screen.findByTestId('fork-notice-source');
    expect(notice.textContent).toBe('由 Source session 派生');
    expect(sourceButton.textContent).toBe('Source session');

    await act(async () => {
      fireEvent.click(sourceButton);
    });

    await waitFor(() => {
      expect(streamHookState.latestParams?.sessionId).toBe('session-1');
    });
  });

  it('hides a cached fork notice once the child session has a live user message', async () => {
    const liveUserEnvelope: StreamEnvelope = {
      eventId: 'live-user-1',
      sessionId: 'child-session',
      requestId: 'request-live-1',
      runId: 'run-live-1',
      rootMessageId: 'request-live-1',
      requestContextId: 'request-live-1',
      sequence: 1,
      eventType: 'REQUEST_ACCEPTED',
      timelineEventRef: null,
      transportHints: ['local-optimistic'],
      payload: {
        role: 'USER',
        content: 'new child message',
        messageId: 'request-live-1',
        rootMessageId: 'request-live-1',
        requestContextId: 'request-live-1',
      },
      createdAt: '2026-04-19T10:00:03.000Z',
    };
    useSessionStore.setState({
      sessions: [
        {
          sessionId: 'child-session',
          displayTitle: 'Session 1',
          lastActivityAt: '2026-04-19T10:00:00.000Z',
        },
      ],
      activeSessionId: 'child-session',
    });
    useConversationStore.setState({
      historyMessagesBySession: {
        'child-session': [
          makeHistoryUserMessage('root-1', 1, 'child-session'),
          makeHistoryAssistantMessage('assistant-1', 'root-1', 2, 'child-session'),
        ],
      },
      historyEnvelopesBySession: {
        'child-session': [liveUserEnvelope],
      },
      activeLiveBySession: {
        'child-session': makeLiveBuckets([liveUserEnvelope]),
      },
      forkNoticeBySession: {
        'child-session': {
          sourceSessionId: 'session-1',
          sourceSessionTitle: 'Source session',
        },
      },
      conversationLoadStateBySession: { 'child-session': 'ready' },
    });

    renderChatPage('/session/child-session');

    expect(screen.queryByTestId('fork-notice')).toBeNull();
  });

  it('refreshes the conversation preview after a submitted request is accepted', async () => {
    const loadPreviewMock = vi.mocked(sessionService.loadConversationPreview);
    const requestState = useRequestStore.getState();
    const submitSpy = vi.spyOn(requestState, 'submitRequestWithAttachments').mockResolvedValue(undefined);
    useSessionStore.setState({
      sessions: [
        {
          sessionId: 'session-1',
          displayTitle: 'Session 1',
          lastActivityAt: '2026-04-19T10:00:00.000Z',
        },
      ],
      activeSessionId: 'session-1',
    });

    renderChatPage();

    await waitFor(() => {
      expect(loadPreviewMock).toHaveBeenCalledWith('session-1', { limit: 100 });
    });
    loadPreviewMock.mockClear();

    fireEvent.change(screen.getByTestId('message-textarea'), {
      target: { value: 'refresh preview after submit' },
    });

    await act(async () => {
      fireEvent.click(screen.getByTestId('btn-send'));
    });

    await waitFor(() => {
      expect(submitSpy).toHaveBeenCalledWith('refresh preview after submit', [], [], undefined);
    });
    expect(loadPreviewMock).toHaveBeenCalledWith('session-1', { offset: 0, limit: 100 });
    submitSpy.mockRestore();
  });

  it('bounds the conversation preview rail and keeps overflow inside the preview area', async () => {
    const totalMarkers = 220;
    vi.mocked(sessionService.loadConversationPreview).mockResolvedValueOnce(makePreviewPage(totalMarkers, 0));
    seedSessionWithHistory('preview-marker-1');

    renderChatPage();

    const rail = await screen.findByTestId('conversation-preview-rail');
    expect(rail.classList.contains('conversation-preview-scrollbar-hidden')).toBe(true);
    expect(rail.style.maxHeight).toBe('50%');
    expect(rail.style.overflowY).toBe('auto');
    expect(rail.style.overflowX).toBe('hidden');
    expect(rail.style.overscrollBehavior).toBe('contain');
    expect(rail.style.transform).toBe('translateY(-50%)');
    const renderedMarkerCount = rail.querySelectorAll('button[aria-label]').length;
    expect(renderedMarkerCount).toBeGreaterThan(0);
    expect(renderedMarkerCount).toBeLessThan(totalMarkers);
    expect(rail.querySelector('div')?.style.height).toBe(`${totalMarkers * 12}px`);
  });

  it('aligns the initial latest preview rail viewport to the final marker', async () => {
    const totalMarkers = 350;
    const railHeight = 120;
    const loadPreviewMock = vi.mocked(sessionService.loadConversationPreview);
    mockConversationPreviewRailClientHeight(railHeight);
    loadPreviewMock.mockImplementation(async (_sessionId, options) => {
      const offset =
        typeof options === 'object' && options !== null && 'offset' in options && options.offset !== undefined ? options.offset : totalMarkers - 100;
      return makePreviewPage(totalMarkers, offset);
    });
    seedSessionWithHistory('preview-marker-350');

    renderChatPage();

    const rail = await screen.findByTestId('conversation-preview-rail');
    await waitFor(() => {
      expect(loadPreviewMock.mock.calls[0]).toEqual(['session-1', { limit: 100 }]);
    });
    await waitFor(() => {
      expect(rail.scrollTop).toBe(totalMarkers * 12 - railHeight);
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(loadPreviewMock.mock.calls).not.toContainEqual(['session-1', { offset: 300, limit: 100 }]);
    expect(screen.getByRole('button', { name: 'preview marker 350' })).toBeTruthy();
  });

  it('centers the preview hover card with the selected marker when the viewport has room', async () => {
    const totalMarkers = 20;
    const railHeight = 120;
    const loadPreviewMock = vi.mocked(sessionService.loadConversationPreview);
    mockConversationPreviewRailClientHeight(railHeight);
    loadPreviewMock.mockResolvedValueOnce(makePreviewPage(totalMarkers, 0));
    seedSessionWithHistory('preview-marker-16');

    renderChatPage();

    const rail = await screen.findByTestId('conversation-preview-rail');
    await waitFor(() => {
      expect(rail.scrollTop).toBe(totalMarkers * 12 - railHeight);
    });

    const marker = screen.getByRole('button', { name: 'preview marker 16' });
    fireEvent.mouseEnter(marker.parentElement ?? marker);

    await screen.findByText('answer marker 16');
    const card = await screen.findByTestId('conversation-preview-hover-card');
    expect(card.style.top).toBe('calc(50% + 10px)');
    expect(card.style.transform).toBe('translateY(-50%)');
    expect(rail.contains(card)).toBe(false);
    expect(sessionService.loadRunEvents).not.toHaveBeenCalled();
  });

  it('centers the preview hover card with the top marker after scrolling to the top', async () => {
    const totalMarkers = 100;
    const railHeight = 120;
    const loadPreviewMock = vi.mocked(sessionService.loadConversationPreview);
    mockConversationPreviewRailClientHeight(railHeight);
    loadPreviewMock.mockResolvedValueOnce(makePreviewPage(totalMarkers, 0));
    seedSessionWithHistory('preview-marker-1');

    renderChatPage();

    const rail = await screen.findByTestId('conversation-preview-rail');
    await waitFor(() => {
      expect(rail.scrollTop).toBe(totalMarkers * 12 - railHeight);
    });

    rail.scrollTop = 0;
    fireEvent.scroll(rail);
    await flushAnimationFrame();

    const topMarker = await screen.findByRole('button', { name: 'preview marker 1' });
    fireEvent.mouseEnter(topMarker.parentElement ?? topMarker);

    await screen.findByText('answer marker 1');
    const card = await screen.findByTestId('conversation-preview-hover-card');
    expect(card.style.top).toBe('calc(50% - 50px)');
    expect(card.style.transform).toBe('translateY(-50%)');
    expect(rail.contains(card)).toBe(false);
  }, 10_000);

  it('centers the preview hover card with the bottom marker', async () => {
    const totalMarkers = 350;
    const railHeight = 120;
    const loadPreviewMock = vi.mocked(sessionService.loadConversationPreview);
    mockConversationPreviewRailClientHeight(railHeight);
    loadPreviewMock.mockImplementation(async (_sessionId, options) => {
      const offset =
        typeof options === 'object' && options !== null && 'offset' in options && options.offset !== undefined ? options.offset : totalMarkers - 100;
      return makePreviewPage(totalMarkers, offset);
    });
    seedSessionWithHistory('preview-marker-350');

    renderChatPage();

    const rail = await screen.findByTestId('conversation-preview-rail');
    await waitFor(() => {
      expect(rail.scrollTop).toBe(totalMarkers * 12 - railHeight);
    });

    const bottomMarker = screen.getByRole('button', { name: 'preview marker 350' });
    fireEvent.mouseEnter(bottomMarker.parentElement ?? bottomMarker);

    await screen.findByText('answer marker 350');
    const card = await screen.findByTestId('conversation-preview-hover-card');
    expect(card.style.top).toBe('calc(50% + 58px)');
    expect(card.style.transform).toBe('translateY(-50%)');
    expect(rail.contains(card)).toBe(false);
  }, 20_000);

  it('renders the preview hover card outside the scroll rail when only a few markers exist', async () => {
    const loadPreviewMock = vi.mocked(sessionService.loadConversationPreview);
    mockConversationPreviewRailClientHeight(20);
    loadPreviewMock.mockResolvedValueOnce(makePreviewPage(1, 0, 1));
    seedSessionWithHistory('preview-marker-1');

    renderChatPage();

    const rail = await screen.findByTestId('conversation-preview-rail');
    const marker = await screen.findByRole('button', { name: 'preview marker 1' });
    fireEvent.mouseEnter(marker.parentElement ?? marker);

    const card = await screen.findByTestId('conversation-preview-hover-card');
    expect(card.textContent).toContain('answer marker 1');
    expect(rail.contains(card)).toBe(false);
    expect(card.style.maxHeight).toBe('96px');
    expect(card.style.top).toBe('50%');
    expect(card.style.transform).toBe('translateY(-50%)');
    expect(card.style.zIndex).toBe('13');
    expect(Number(card.style.zIndex)).toBeLessThan(1000);
  });

  it('keeps loaded preview marker content when tail refresh updates the marker total', async () => {
    const loadPreviewMock = vi.mocked(sessionService.loadConversationPreview);
    loadPreviewMock.mockResolvedValueOnce(makePreviewPage(100, 0));

    await act(async () => {
      await useConversationStore.getState().loadConversationPreview('session-1', { limit: 100 });
    });
    expect(useConversationStore.getState().conversationPreviewBySession['session-1']?.markersByIndex[99]?.answerPreviewText).toBe(
      'answer marker 100',
    );

    loadPreviewMock.mockResolvedValueOnce(makePreviewPage(101, 100, 1));
    await act(async () => {
      await useConversationStore.getState().loadConversationPreview('session-1', { offset: 100, limit: 100 });
    });

    const preview = useConversationStore.getState().conversationPreviewBySession['session-1'];
    expect(preview?.markersByIndex[99]?.answerPreviewText).toBe('answer marker 100');
    expect(preview?.markersByIndex[100]?.answerPreviewText).toBe('answer marker 101');
  });

  it('loads only the current and adjacent preview windows after a fast preview rail jump', async () => {
    const totalMarkers = 1000;
    const loadPreviewMock = vi.mocked(sessionService.loadConversationPreview);
    loadPreviewMock.mockImplementation(async (_sessionId, options) => {
      const offset = typeof options === 'object' && options !== null && 'offset' in options ? (options.offset ?? 0) : 0;
      return makePreviewPage(totalMarkers, offset);
    });
    seedSessionWithHistory('preview-marker-1');

    renderChatPage();

    const rail = await screen.findByTestId('conversation-preview-rail');
    await waitFor(() => {
      expect(loadPreviewMock).toHaveBeenCalledWith('session-1', { limit: 100 });
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    loadPreviewMock.mockClear();

    Object.defineProperty(rail, 'clientHeight', { value: 120, configurable: true });
    Object.defineProperty(rail, 'scrollTop', { value: 6000, writable: true, configurable: true });

    await act(async () => {
      fireEvent.scroll(rail);
      await Promise.resolve();
    });

    await waitFor(() => {
      const requestedOffsets = loadPreviewMock.mock.calls
        .map(([, options]) => (typeof options === 'object' && options !== null && 'offset' in options ? (options.offset ?? 0) : 0))
        .sort((left, right) => left - right);
      expect(requestedOffsets).toEqual([400, 500]);
    });

    loadPreviewMock.mockClear();
    await act(async () => {
      fireEvent.scroll(rail);
      await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));
    });
    expect(loadPreviewMock).not.toHaveBeenCalled();
  });

  it('navigates from a marker in the initial latest preview window', async () => {
    const loadPreviewMock = vi.mocked(sessionService.loadConversationPreview);
    const loadConversationMock = vi.mocked(sessionService.loadConversation);
    loadPreviewMock.mockImplementation(async (_sessionId, options) => {
      const offset = typeof options === 'object' && options !== null && 'offset' in options && options.offset !== undefined ? options.offset : 120;
      return makePreviewPage(220, offset);
    });
    seedSessionWithHistory('loaded-message');

    renderChatPage();

    const loadedMarker = await screen.findByRole('button', { name: 'preview marker 220' });
    loadConversationMock.mockClear();
    loadConversationMock.mockResolvedValue({
      sessionId: 'session-1',
      items: [makeHistoryUserMessage('preview-marker-220')],
      nextCursor: null,
    });

    await act(async () => {
      fireEvent.click(loadedMarker);
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(loadConversationMock).toHaveBeenCalledWith(
        expect.objectContaining({
          sessionId: 'session-1',
          anchorMessageId: 'preview-marker-220',
        }),
      );
    });
  }, 10_000);

  it('lets only the latest rapid preview navigation publish process-history demand', async () => {
    const originalSetExplicitTarget = useConversationStore.getState().setExplicitProcessHistoryTarget;
    const setExplicitTarget = vi.fn(originalSetExplicitTarget);
    useConversationStore.setState({ setExplicitProcessHistoryTarget: setExplicitTarget });
    vi.mocked(sessionService.loadConversationPreview).mockResolvedValue(makePreviewPage(3, 0));
    const first = deferred<Awaited<ReturnType<typeof sessionService.loadConversation>>>();
    const second = deferred<Awaited<ReturnType<typeof sessionService.loadConversation>>>();
    vi.mocked(sessionService.loadConversation).mockImplementation((query) => {
      if (query.anchorMessageId === 'preview-marker-1') {
        return first.promise;
      }
      if (query.anchorMessageId === 'preview-marker-2') {
        return second.promise;
      }
      if (query.anchorMessageId === 'preview-marker-3') {
        return Promise.resolve({
          sessionId: 'session-1',
          items: [
            makeHistoryUserMessage('preview-marker-3'),
            {
              ...makeHistoryAssistantMessage('answer-preview-marker-3', 'preview-marker-3'),
              requestId: 'request-preview-marker-3',
              runId: 'run-preview-marker-3',
            },
          ],
          nextCursor: null,
        });
      }
      return Promise.resolve({
        sessionId: 'session-1',
        items: [makeHistoryUserMessage('loaded-message')],
        nextCursor: null,
      });
    });
    seedSessionWithHistory('loaded-message');

    try {
      renderChatPage();
      fireEvent.click(await screen.findByRole('button', { name: 'preview marker 1' }));
      fireEvent.click(await screen.findByRole('button', { name: 'preview marker 2' }));
      fireEvent.click(await screen.findByRole('button', { name: 'preview marker 3' }));

      await waitFor(() => {
        expect(setExplicitTarget).toHaveBeenCalledWith('session-1', 'preview', expect.objectContaining({ runId: 'run-preview-marker-3' }));
      });

      second.resolve({
        sessionId: 'session-1',
        items: [
          makeHistoryUserMessage('preview-marker-2'),
          {
            ...makeHistoryAssistantMessage('answer-preview-marker-2', 'preview-marker-2'),
            requestId: 'request-preview-marker-2',
            runId: 'run-preview-marker-2',
          },
        ],
        nextCursor: null,
      });
      first.resolve({
        sessionId: 'session-1',
        items: [
          makeHistoryUserMessage('preview-marker-1'),
          {
            ...makeHistoryAssistantMessage('answer-preview-marker-1', 'preview-marker-1'),
            requestId: 'request-preview-marker-1',
            runId: 'run-preview-marker-1',
          },
        ],
        nextCursor: null,
      });
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });

      const publishedRunIds = setExplicitTarget.mock.calls.flatMap(([, , target]) => (target ? [target.runId] : []));
      expect(publishedRunIds).toEqual(['run-preview-marker-3']);
      expect(screen.getByTestId('turn-block').getAttribute('data-root-message-id')).toBe('preview-marker-3');
    } finally {
      useConversationStore.setState({
        setExplicitProcessHistoryTarget: originalSetExplicitTarget,
      });
    }
  });

  it('lets only the latest placeholder preview navigation continue when windows resolve in reverse order', async () => {
    mockConversationPreviewRailClientHeight(1_400);
    const firstWindow = deferred<ReturnType<typeof makePreviewPage>>();
    const secondWindow = deferred<ReturnType<typeof makePreviewPage>>();
    let navigationPhase = false;
    const loadPreviewMock = vi.mocked(sessionService.loadConversationPreview);
    loadPreviewMock.mockImplementation(async (_sessionId, options) => {
      const offset = typeof options === 'object' && options !== null && 'offset' in options ? options.offset : undefined;
      if (!navigationPhase) {
        return offset === undefined ? makePreviewPage(102, 100, 0) : makePreviewPage(102, offset ?? 0, 0);
      }
      if (offset === 0) {
        return firstWindow.promise;
      }
      if (offset === 100) {
        return secondWindow.promise;
      }
      return makePreviewPage(102, offset ?? 100);
    });
    const loadConversationMock = vi.mocked(sessionService.loadConversation);
    seedSessionWithHistory('loaded-message');

    renderChatPage();
    await screen.findByTestId('conversation-preview-rail');
    const firstPlaceholder = screen.getByLabelText('Conversation preview marker 2');
    const secondPlaceholder = screen.getByLabelText('Conversation preview marker 102');
    await waitFor(() => {
      expect(loadPreviewMock).toHaveBeenCalledWith('session-1', { offset: 0, limit: 100 });
      expect(loadPreviewMock).toHaveBeenCalledWith('session-1', { offset: 100, limit: 100 });
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    navigationPhase = true;
    loadConversationMock.mockClear();

    fireEvent.click(firstPlaceholder);
    fireEvent.click(secondPlaceholder);
    secondWindow.resolve(makePreviewPage(102, 100, 2));
    await waitFor(() => {
      expect(loadConversationMock).toHaveBeenCalledWith(
        expect.objectContaining({
          sessionId: 'session-1',
          anchorMessageId: 'preview-marker-102',
        }),
      );
    });

    firstWindow.resolve(makePreviewPage(102, 0));
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(loadConversationMock.mock.calls.map(([query]) => query.anchorMessageId)).toEqual(['preview-marker-102']);
  });

  it('keeps the live-tail-open snapshot refresh for recent conversations', async () => {
    const originalLoadConversation = useConversationStore.getState().loadConversation;
    const loadConversationSpy = vi.fn().mockResolvedValue(true);
    seedSessionWithHistory('latest-root');
    useConversationStore.setState({ loadConversation: loadConversationSpy });

    try {
      renderChatPage();

      await waitFor(() => {
        expect(streamHookState.latestParams?.sessionId).toBe('session-1');
      });
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });

      loadConversationSpy.mockClear();
      await act(async () => {
        streamHookState.latestParams?.onSessionLiveTailOpen?.();
        await Promise.resolve();
      });

      expect(loadConversationSpy).toHaveBeenCalledWith('session-1', expect.objectContaining({ background: true, merge: false }));
    } finally {
      useConversationStore.setState({ loadConversation: originalLoadConversation });
    }
  });

  it('does not refresh the latest snapshot when live tail opens while anchored from a preview marker', async () => {
    const originalLoadConversation = useConversationStore.getState().loadConversation;
    const loadConversationSpy = vi.fn().mockResolvedValue(true);
    seedSessionWithHistory('preview-marker-1');
    useConversationStore.setState({
      loadConversation: loadConversationSpy,
      conversationViewBySession: {
        'session-1': {
          mode: 'anchored',
          activeAnchorMessageId: 'preview-marker-1',
          newMessagesWhileAnchored: false,
        },
      },
    });

    try {
      renderChatPage();

      await waitFor(() => {
        expect(streamHookState.latestParams?.sessionId).toBe('session-1');
      });
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });

      loadConversationSpy.mockClear();
      await act(async () => {
        streamHookState.latestParams?.onSessionLiveTailOpen?.();
        await Promise.resolve();
      });

      expect(loadConversationSpy).not.toHaveBeenCalled();
      expect(useConversationStore.getState().conversationViewBySession['session-1']?.mode).toBe('anchored');
    } finally {
      useConversationStore.setState({ loadConversation: originalLoadConversation });
    }
  });

  it('scrolls to a preloaded old preview marker on the first click', async () => {
    const totalMarkers = 220;
    const railHeight = 120;
    const loadPreviewMock = vi.mocked(sessionService.loadConversationPreview);
    const loadConversationMock = vi.mocked(sessionService.loadConversation);
    mockConversationPreviewRailClientHeight(railHeight);
    loadPreviewMock.mockImplementation(async (_sessionId, options) => {
      const offset =
        typeof options === 'object' && options !== null && 'offset' in options && options.offset !== undefined ? options.offset : totalMarkers - 100;
      return makePreviewPage(totalMarkers, offset);
    });
    loadConversationMock.mockResolvedValue({
      sessionId: 'session-1',
      items: [makeHistoryUserMessage('preview-marker-220')],
      nextCursor: null,
    });
    seedSessionWithHistory('preview-marker-220');

    renderChatPage();

    const rail = await screen.findByTestId('conversation-preview-rail');
    await waitFor(() => {
      expect(loadPreviewMock).toHaveBeenCalledWith('session-1', { limit: 100 });
    });
    Object.defineProperty(rail, 'scrollTop', { value: 0, writable: true, configurable: true });

    await act(async () => {
      fireEvent.scroll(rail);
      await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));
    });

    await waitFor(() => {
      expect(loadPreviewMock).toHaveBeenCalledWith('session-1', { offset: 0, limit: 100 });
    });
    const oldMarker = await screen.findByRole('button', { name: 'preview marker 1' });
    const scrollViewport = (await screen.findByTestId('right-pane-scroll-viewport')) as HTMLDivElement & {
      scrollHeight: number;
      clientHeight: number;
      scrollTop: number;
      scrollTo: typeof HTMLElement.prototype.scrollTo;
    };
    mockScrollableViewport(scrollViewport, { scrollHeight: 1000, clientHeight: 120, scrollTop: 600 });
    loadConversationMock.mockClear();
    loadConversationMock.mockResolvedValue({
      sessionId: 'session-1',
      items: [
        {
          messageId: 'persisted-preview-marker-1',
          sessionId: 'session-1',
          requestId: 'preview-marker-1',
          requestContextId: 'preview-marker-1',
          rootMessageId: 'root-preview-marker-1',
          role: 'USER',
          sequence: 1,
          content: 'preview-marker-1',
          contentType: 'PLAIN_TEXT',
          metadata: {},
          createdAt: '2026-04-19T10:00:00.000Z',
          visible: true,
        },
      ],
      nextCursor: null,
    });

    await act(async () => {
      fireEvent.click(oldMarker);
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(loadConversationMock).toHaveBeenCalledWith(
        expect.objectContaining({
          sessionId: 'session-1',
          anchorMessageId: 'preview-marker-1',
        }),
      );
    });
    await waitFor(() => {
      expect(screen.getByTestId('turn-block').getAttribute('data-root-message-id')).toBe('root-preview-marker-1');
    });
    const restoreTurnLayout = mockTurnBlockLayoutWithinViewport(scrollViewport, 'root-preview-marker-1', 600);
    try {
      await flushAnimationFrames(35);
      expect(scrollViewport.scrollTo).toHaveBeenCalledWith({ top: 576, behavior: 'auto' });
      expect(scrollViewport.scrollTop).toBe(576);
    } finally {
      restoreTurnLayout();
    }
  }, 10_000);

  it('does not show a bottom button when a preloaded preview target fits in the viewport', async () => {
    vi.mocked(sessionService.loadConversation).mockResolvedValue({
      sessionId: 'session-1',
      items: [makeHistoryUserMessage('preview-marker-1')],
      nextCursor: null,
      newerCursor: null,
    });
    vi.mocked(sessionService.loadConversationPreview).mockResolvedValue({
      sessionId: 'session-1',
      totalMarkers: 1,
      offset: 0,
      limit: 100,
      markers: [makePreviewMarker(1)],
    });
    seedSessionWithHistory('preview-marker-1');

    renderChatPage();

    const scrollViewport = (await screen.findByTestId('right-pane-scroll-viewport')) as HTMLDivElement & {
      scrollHeight: number;
      clientHeight: number;
      scrollTop: number;
      scrollTo: typeof HTMLElement.prototype.scrollTo;
    };
    mockScrollableViewport(scrollViewport, { scrollHeight: 300, clientHeight: 400, scrollTop: 0 });

    fireEvent.click(await screen.findByRole('button', { name: 'preview marker 1' }));
    await flushAnimationFrame();

    expect(useConversationStore.getState().conversationViewBySession['session-1']?.mode ?? 'recent').toBe('recent');
    expect(screen.queryByTestId('chat-scroll-to-bottom-floating')).toBeNull();
  });

  it('does not auto-load newer pages after a preview marker jump until the user scrolls down', async () => {
    const totalMarkers = 220;
    const railHeight = 120;
    const loadPreviewMock = vi.mocked(sessionService.loadConversationPreview);
    const loadConversationMock = vi.mocked(sessionService.loadConversation);
    const originalLoadNewerConversation = useConversationStore.getState().loadNewerConversation;
    const loadNewerConversationSpy = vi.fn().mockResolvedValue(true);
    mockConversationPreviewRailClientHeight(railHeight);
    loadPreviewMock.mockImplementation(async (_sessionId, options) => {
      const offset =
        typeof options === 'object' && options !== null && 'offset' in options && options.offset !== undefined ? options.offset : totalMarkers - 100;
      return makePreviewPage(totalMarkers, offset);
    });
    seedSessionWithHistory('preview-marker-220');
    useConversationStore.setState({ loadNewerConversation: loadNewerConversationSpy });

    let restoreTurnLayout: (() => void) | null = null;
    try {
      renderChatPage();

      const rail = await screen.findByTestId('conversation-preview-rail');
      await waitFor(() => {
        expect(loadPreviewMock).toHaveBeenCalledWith('session-1', { limit: 100 });
      });
      Object.defineProperty(rail, 'scrollTop', { value: 0, writable: true, configurable: true });

      await act(async () => {
        fireEvent.scroll(rail);
      });
      await flushAnimationFrame();
      await waitFor(() => {
        expect(loadPreviewMock).toHaveBeenCalledWith('session-1', { offset: 0, limit: 100 });
      });

      const oldMarker = await screen.findByRole('button', { name: 'preview marker 1' });
      const scrollViewport = (await screen.findByTestId('right-pane-scroll-viewport')) as HTMLDivElement & {
        scrollHeight: number;
        clientHeight: number;
        scrollTop: number;
        scrollTo: typeof HTMLElement.prototype.scrollTo;
      };
      mockScrollableViewport(scrollViewport, { scrollHeight: 680, clientHeight: 120, scrollTop: 600 });
      loadConversationMock.mockClear();
      loadConversationMock.mockResolvedValue({
        sessionId: 'session-1',
        items: [makeHistoryUserMessage('preview-marker-1')],
        nextCursor: null,
        newerCursor: 'newer-cursor-1',
      });

      await act(async () => {
        fireEvent.click(oldMarker);
        await Promise.resolve();
      });
      await waitFor(() => {
        expect(useConversationStore.getState().conversationViewBySession['session-1']?.mode).toBe('anchored');
      });
      await waitFor(() => {
        expect(streamHookState.latestParams?.canOpenStream).toBe(false);
      });
      await waitFor(() => {
        expect(screen.getByTestId('turn-block').getAttribute('data-root-message-id')).toBe('preview-marker-1');
      });
      restoreTurnLayout = mockTurnBlockLayoutWithinViewport(scrollViewport, 'preview-marker-1', 600);
      await flushAnimationFrames(35);

      fireEvent.scroll(scrollViewport);
      await flushAnimationFrame();
      expect(loadNewerConversationSpy).not.toHaveBeenCalled();

      scrollViewport.scrollTop += 20;
      fireEvent.scroll(scrollViewport);
      await flushAnimationFrame();
      expect(loadNewerConversationSpy).not.toHaveBeenCalled();

      fireEvent.wheel(scrollViewport, { deltaY: 30 });
      scrollViewport.scrollTop += 20;
      fireEvent.scroll(scrollViewport);
      await waitFor(() => {
        expect(loadNewerConversationSpy).toHaveBeenCalledWith('session-1');
      });
    } finally {
      restoreTurnLayout?.();
      useConversationStore.setState({ loadNewerConversation: originalLoadNewerConversation });
    }
  }, 10_000);

  it.each([
    ['with newer pages', 'newer-cursor-1'],
    ['after newer pages are exhausted', null],
  ])('keeps the anchored history view when sending %s', async (_scenario, newerCursor) => {
    const loadConversationMock = vi.mocked(sessionService.loadConversation);
    const submitRequestSpy = vi.spyOn(requestService, 'submitRequest').mockResolvedValue({
      sessionId: 'session-1',
      requestId: 'req-anchored-submit',
      runId: 'run-anchored-submit',
      attempt: 1,
    });
    loadConversationMock.mockResolvedValue({
      sessionId: 'session-1',
      items: [makeHistoryUserMessage('latest-before-submit')],
      nextCursor: null,
    });
    seedSessionWithHistory('anchor-root');
    useConversationStore.getState().setEnvelopes('session-1', [
      {
        eventId: 'anchor-root-user',
        sessionId: 'session-1',
        requestId: 'anchor-root',
        sequence: 1,
        timelineEventRef: null,
        transportHints: ['history-load'],
        createdAt: '2026-04-19T10:00:00.000Z',
        eventType: 'REQUEST_ACCEPTED',
        payload: {
          content: 'anchor-root',
          role: 'USER',
          messageId: 'anchor-root',
          rootMessageId: 'anchor-root',
        },
      },
    ]);
    useConversationStore.setState({
      conversationPageInfoBySession: {
        'session-1': {
          nextCursor: null,
          newerCursor,
          isLoadingOlder: false,
          isLoadingNewer: false,
          olderLoadError: null,
          newerLoadError: null,
          hasLoadedOlder: false,
        },
      },
      conversationViewBySession: {
        'session-1': {
          mode: 'anchored',
          activeAnchorMessageId: 'anchor-root',
          newMessagesWhileAnchored: false,
        },
      },
    });

    try {
      renderChatPage();

      await waitFor(() => {
        expect(streamHookState.latestParams?.canOpenStream).toBe(false);
      });
      expect(screen.getByText('anchor-root')).toBeTruthy();
      expect(screen.queryByTestId('btn-more-menu')).toBeNull();

      const scrollViewport = (await screen.findByTestId('right-pane-scroll-viewport')) as HTMLDivElement & {
        scrollHeight: number;
        clientHeight: number;
        scrollTop: number;
        scrollTo: typeof HTMLElement.prototype.scrollTo;
      };
      mockScrollableViewport(scrollViewport, { scrollHeight: 1000, clientHeight: 400, scrollTop: 520 });

      fireEvent.change(screen.getByTestId('message-textarea'), {
        target: { value: 'anchored submit should show locally' },
      });

      await act(async () => {
        fireEvent.click(screen.getByTestId('btn-send'));
        await Promise.resolve();
      });

      await waitFor(() => {
        expect(submitRequestSpy).toHaveBeenCalledWith('session-1', expect.objectContaining({ inputText: 'anchored submit should show locally' }));
      });
      await waitFor(() => {
        expect(streamHookState.latestParams?.canOpenStream).toBe(true);
      });
      expect(screen.getByText('anchor-root')).toBeTruthy();
      if (newerCursor) {
        expect(screen.queryByText('anchored submit should show locally')).toBeNull();
      }
      expect(useConversationStore.getState().conversationViewBySession['session-1']).toEqual({
        mode: 'anchored',
        activeAnchorMessageId: 'anchor-root',
        newMessagesWhileAnchored: Boolean(newerCursor),
      });
      await flushAnimationFrames(20);
      expect(scrollViewport.scrollTop).toBe(520);
    } finally {
      submitRequestSpy.mockRestore();
    }
  });

  it('renders a newly submitted message immediately in recent conversation mode', async () => {
    const submitRequestSpy = vi.spyOn(requestService, 'submitRequest').mockResolvedValue({
      sessionId: 'session-1',
      requestId: 'req-recent-submit',
      runId: 'run-recent-submit',
      attempt: 1,
    });
    seedSessionWithHistory('latest-root');

    try {
      renderChatPage();

      fireEvent.change(screen.getByTestId('message-textarea'), {
        target: { value: 'recent submit should render locally' },
      });

      await act(async () => {
        fireEvent.click(screen.getByTestId('btn-send'));
        await Promise.resolve();
      });

      await waitFor(() => {
        expect(submitRequestSpy).toHaveBeenCalledWith('session-1', expect.objectContaining({ inputText: 'recent submit should render locally' }));
      });
      expect(screen.getByText('recent submit should render locally')).toBeTruthy();
      expect(useConversationStore.getState().conversationViewBySession['session-1']?.mode ?? 'recent').toBe('recent');
    } finally {
      submitRequestSpy.mockRestore();
    }
  });

  it('creates a session and submits attachments together with the message on the root route', async () => {
    vi.mocked(sessionService.createSession).mockResolvedValueOnce({
      sessionId: 'session-upload',
      displayTitle: 'New session',
      lastActivityAt: Date.now(),
    });
    const file = new File(['report'], 'report.md', { type: 'text/markdown', lastModified: 1 });
    const stageAttachmentSpy = vi.spyOn(requestService, 'stageAttachment').mockResolvedValue({
      tempRunId: 'temp-run',
      fileName: file.name,
      sizeBytes: file.size,
    });
    const requestState = useRequestStore.getState();
    const submitSpy = vi.spyOn(requestState, 'submitRequestWithAttachments').mockResolvedValue(undefined);

    const { container } = renderChatPage('/');
    const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement;

    await act(async () => {
      fireEvent.change(fileInput, { target: { files: [file] } });
    });

    await waitFor(() => {
      expect(sessionService.createSession).toHaveBeenCalledTimes(1);
    });

    fireEvent.change(screen.getByTestId('message-textarea'), {
      target: { value: 'hello with attachment' },
    });

    await act(async () => {
      fireEvent.click(screen.getByTestId('btn-send'));
    });

    await waitFor(() => {
      expect(submitSpy).toHaveBeenCalledTimes(1);
    });

    expect(stageAttachmentSpy).toHaveBeenCalledWith('session-upload', expect.any(String), file, expect.any(Function));
    expect(submitSpy).toHaveBeenCalledWith(
      'hello with attachment',
      [{ tempRunId: 'temp-run', fileName: 'report.md' }],
      [{ fileName: 'report.md', mediaType: 'MARKDOWN', sizeBytes: file.size }],
      undefined,
    );
    stageAttachmentSpy.mockRestore();
    submitSpy.mockRestore();
  });

  it('reopens the stream for a refreshed session that still has an in-flight request', async () => {
    vi.mocked(sessionService.listSessions).mockResolvedValueOnce({
      entries: [
        {
          sessionId: 'session-1',
          displayTitle: 'Session 1',
          lastActivityAt: '2026-04-19T10:00:00.000Z',
        },
      ],
      offset: 0,
      limit: 50,
      hasMore: false,
    });
    useSessionStore.setState({
      sessions: [
        {
          sessionId: 'session-1',
          displayTitle: 'Session 1',
          lastActivityAt: '2026-04-19T10:00:00.000Z',
        },
      ],
      activeSessionId: 'session-1',
    });

    renderChatPage();

    await waitFor(() => {
      expect(streamHookState.latestParams?.sessionId).toBe('session-1');
    });
    expect(streamHookState.latestParams?.canOpenStream).toBe(true);
  });

  it('does not reuse the previous completed run status for a newly executing turn', async () => {
    useSessionStore.setState({
      sessions: [
        {
          sessionId: 'session-1',
          displayTitle: 'Session 1',
          lastActivityAt: '2026-04-16T08:14:57.400Z',
        },
      ],
      activeSessionId: 'session-1',
    });
    useConversationStore.setState({
      historyEnvelopesBySession: {
        'session-1': [
          {
            eventId: 'temp-run-2',
            sessionId: 'session-1',
            requestId: 'run-2',
            sequence: 0,
            eventType: 'REQUEST_ACCEPTED',
            timelineEventRef: null,
            transportHints: ['local-optimistic'],
            payload: {
              content: 'new request',
              role: 'USER',
              messageId: 'run-2',
              rootMessageId: 'run-2',
            },
            createdAt: '2026-04-16T08:15:01.000Z',
          },
        ],
      },
      conversationLoadStateBySession: { 'session-1': 'ready' },
    });
    useRequestStore.setState({
      requestStatus: 'accepted',
      activeRequestRootMessageId: 'run-2',
    });

    renderChatPage();

    await waitFor(() => {
      expect(screen.getByTestId('turn-process-summary-text').textContent).toBe('NextAgent正在执行中...');
    });
  });

  it('does not show the floating scroll-to-bottom button while the welcome state is visible', async () => {
    renderChatPage('/');

    await waitFor(() => {
      expect(screen.getByTestId('welcome-state-root')).toBeTruthy();
    });

    const scrollViewport = await screen.findByTestId('right-pane-scroll-viewport');
    fireEvent.wheel(scrollViewport, { deltaY: -40 });

    expect(screen.queryByTestId('chat-scroll-to-bottom-floating')).toBeNull();
  });

  it('keeps a recent non-following reading position when submitting a new message', async () => {
    const submitRequestSpy = vi.spyOn(requestService, 'submitRequest').mockResolvedValue({
      sessionId: 'session-1',
      requestId: 'req-non-following-submit',
      runId: 'run-non-following-submit',
      attempt: 1,
    });
    seedSessionWithHistory('latest-root');

    try {
      renderChatPage();
      const scrollViewport = (await screen.findByTestId('right-pane-scroll-viewport')) as HTMLDivElement & {
        scrollHeight: number;
        clientHeight: number;
        scrollTop: number;
        scrollTo: typeof HTMLElement.prototype.scrollTo;
      };
      mockScrollableViewport(scrollViewport, { scrollHeight: 1000, clientHeight: 400, scrollTop: 480 });
      fireEvent.wheel(scrollViewport, { deltaY: -30 });
      fireEvent.scroll(scrollViewport);
      await flushAnimationFrame();

      fireEvent.change(screen.getByTestId('message-textarea'), {
        target: { value: 'submit without leaving history' },
      });
      fireEvent.click(screen.getByTestId('btn-send'));
      await waitFor(() => expect(submitRequestSpy).toHaveBeenCalledTimes(1));
      await flushAnimationFrames(20);

      expect(scrollViewport.scrollTop).toBe(480);
      expect(screen.getByTestId('chat-scroll-to-bottom-floating')).toBeTruthy();
    } finally {
      submitRequestSpy.mockRestore();
    }
  });

  it('does not return to bottom when the user scrolls up while a recent submit is awaiting acceptance', async () => {
    let resolveSubmit!: (value: { sessionId: string; requestId: string; runId: string; attempt: number }) => void;
    const submitRequestSpy = vi.spyOn(requestService, 'submitRequest').mockReturnValue(
      new Promise((resolve) => {
        resolveSubmit = resolve;
      }),
    );
    seedSessionWithHistory('latest-root');

    try {
      renderChatPage();
      const scrollViewport = (await screen.findByTestId('right-pane-scroll-viewport')) as HTMLDivElement & {
        scrollHeight: number;
        clientHeight: number;
        scrollTop: number;
        scrollTo: typeof HTMLElement.prototype.scrollTo;
      };
      mockScrollableViewport(scrollViewport, { scrollHeight: 1000, clientHeight: 400, scrollTop: 600 });
      fireEvent.scroll(scrollViewport);

      fireEvent.change(screen.getByTestId('message-textarea'), {
        target: { value: 'wait before following' },
      });
      fireEvent.click(screen.getByTestId('btn-send'));
      await waitFor(() => expect(submitRequestSpy).toHaveBeenCalledTimes(1));

      fireEvent.wheel(scrollViewport, { deltaY: -30 });
      scrollViewport.scrollTop = 480;
      fireEvent.scroll(scrollViewport);
      await flushAnimationFrame();

      await act(async () => {
        resolveSubmit({
          sessionId: 'session-1',
          requestId: 'req-late-accept',
          runId: 'run-late-accept',
          attempt: 1,
        });
        await Promise.resolve();
      });
      await flushAnimationFrames(20);

      expect(scrollViewport.scrollTop).toBe(480);
      expect(screen.getByTestId('chat-scroll-to-bottom-floating')).toBeTruthy();
    } finally {
      submitRequestSpy.mockRestore();
    }
  });

  it('does not show the floating scroll-to-bottom button when short content is already at the physical bottom', async () => {
    seedSessionWithHistory('short-message');
    renderChatPage();

    const scrollViewport = (await screen.findByTestId('right-pane-scroll-viewport')) as HTMLDivElement & {
      scrollHeight: number;
      clientHeight: number;
      scrollTop: number;
      scrollTo: typeof HTMLElement.prototype.scrollTo;
    };
    mockScrollableViewport(scrollViewport, { scrollHeight: 300, clientHeight: 400, scrollTop: 0 });

    fireEvent.wheel(scrollViewport, { deltaY: -40 });

    expect(screen.queryByTestId('chat-scroll-to-bottom-floating')).toBeNull();
  });

  it('shows edit and retry icons for the latest completed-looking turn even when the snapshot lacks terminal envelopes', async () => {
    useSessionStore.setState({
      sessions: [
        {
          sessionId: 'session-1',
          displayTitle: 'Session 1',
          lastActivityAt: '2026-04-16T08:14:57.400Z',
        },
      ],
    });
    useConversationStore.setState({
      historyEnvelopesBySession: {
        'session-1': [
          {
            eventId: 'user-1',
            sessionId: 'session-1',
            requestId: 'req-1',
            sequence: 1,
            eventType: 'REQUEST_ACCEPTED',
            timelineEventRef: null,
            transportHints: ['local-optimistic'],
            payload: {
              content: 'test question',
              role: 'USER',
              messageId: 'req-1',
              rootMessageId: 'req-1',
            },
            createdAt: '2026-04-16T08:14:57.000Z',
          },
          {
            eventId: 'assistant-1',
            sessionId: 'session-1',
            requestId: 'req-1',
            sequence: 2,
            eventType: 'LLM_CONTENT_DELTA',
            timelineEventRef: null,
            transportHints: ['SSE'],
            payload: {
              content: 'assistant reply',
              rootMessageId: 'req-1',
            },
            createdAt: '2026-04-16T08:14:57.100Z',
          },
        ],
      },
      conversationLoadStateBySession: { 'session-1': 'ready' },
    });

    renderChatPage();

    const userRegion = await screen.findByTestId('user-content-region');
    const assistantRegion = await screen.findByTestId('assistant-content-region');

    fireEvent.mouseEnter(userRegion);
    fireEvent.mouseEnter(assistantRegion);

    await waitFor(() => {
      expect(screen.getByTestId('btn-edit-user')).toBeTruthy();
      expect(screen.getByTestId('btn-retry-ai')).toBeTruthy();
    });
  });

  it('shows a bottom retry button after the latest turn fails', async () => {
    useSessionStore.setState({
      sessions: [
        {
          sessionId: 'session-1',
          displayTitle: 'Session 1',
          lastActivityAt: '2026-04-16T08:14:57.400Z',
        },
      ],
    });
    useConversationStore.setState({
      historyEnvelopesBySession: {
        'session-1': [
          {
            eventId: 'user-1',
            sessionId: 'session-1',
            requestId: 'req-1',
            sequence: 1,
            eventType: 'REQUEST_ACCEPTED',
            timelineEventRef: null,
            transportHints: ['local-optimistic'],
            payload: {
              content: 'failed question',
              role: 'USER',
              messageId: 'req-1',
              rootMessageId: 'req-1',
            },
            createdAt: '2026-04-16T08:14:57.000Z',
          },
          {
            eventId: 'failed-1',
            sessionId: 'session-1',
            requestId: 'req-1',
            sequence: 2,
            eventType: 'REQUEST_FAILED',
            timelineEventRef: null,
            transportHints: ['SSE'],
            payload: {
              content: 'Request failed safely: MODEL_PROVIDER_ERROR',
              rootMessageId: 'req-1',
            },
            createdAt: '2026-04-16T08:14:57.100Z',
          },
        ],
      },
      conversationLoadStateBySession: { 'session-1': 'ready' },
    });

    renderChatPage();

    await waitFor(() => {
      expect(screen.getByTestId('btn-retry-latest')).toBeTruthy();
    });
  });

  it('hydrates the composer with the latest user content when edit starts', async () => {
    useSessionStore.setState({
      sessions: [
        {
          sessionId: 'session-1',
          displayTitle: 'Session 1',
          lastActivityAt: '2026-04-16T08:14:57.400Z',
        },
      ],
    });
    useConversationStore.setState({
      historyEnvelopesBySession: {
        'session-1': [
          {
            eventId: 'user-1',
            sessionId: 'session-1',
            requestId: 'req-1',
            sequence: 1,
            eventType: 'REQUEST_ACCEPTED',
            timelineEventRef: null,
            transportHints: ['local-optimistic'],
            payload: {
              content: 'edit this question',
              role: 'USER',
              messageId: 'req-1',
              rootMessageId: 'req-1',
            },
            createdAt: '2026-04-16T08:14:57.000Z',
          },
          {
            eventId: 'assistant-1',
            sessionId: 'session-1',
            requestId: 'req-1',
            sequence: 2,
            eventType: 'LLM_CONTENT_DELTA',
            timelineEventRef: null,
            transportHints: ['SSE'],
            payload: {
              content: 'assistant reply',
              rootMessageId: 'req-1',
            },
            createdAt: '2026-04-16T08:14:57.100Z',
          },
        ],
      },
      conversationLoadStateBySession: { 'session-1': 'ready' },
    });

    renderChatPage();

    const userRegion = await screen.findByTestId('user-content-region');
    fireEvent.mouseEnter(userRegion);
    fireEvent.click(await screen.findByTestId('btn-edit-user'));

    await waitFor(() => {
      expect((screen.getByTestId('message-textarea') as HTMLTextAreaElement).value).toBe('edit this question');
    });
    expect(screen.getByTestId('edit-mode-hint')).toBeTruthy();
  });

  it('opens the help modal from the slash command', async () => {
    renderChatPage();

    const textarea = await screen.findByTestId('message-textarea');
    fireEvent.change(textarea, { target: { value: '/help' } });
    fireEvent.keyDown(textarea, { key: 'Enter' });
    fireEvent.keyDown(textarea, { key: 'Enter' });

    await waitFor(() => {
      expect(screen.getByTestId('command-help-modal')).toBeTruthy();
    });
    expect(screen.getByText('快捷键与命令')).toBeTruthy();
    expect(screen.getByText('全局快捷键')).toBeTruthy();
    expect(screen.getByText('输入框快捷键')).toBeTruthy();
    expect(screen.getAllByText('打开快捷键与命令帮助').length).toBeGreaterThan(0);
    expect(screen.getByText('在输入框中换行')).toBeTruthy();
  });

  it('opens the help modal from the global shortcut', async () => {
    renderChatPage();

    fireEvent.keyDown(window, { key: '/', ctrlKey: true });

    await waitFor(() => {
      expect(screen.getByTestId('command-help-modal')).toBeTruthy();
    });
    expect(screen.getByText('快捷键与命令')).toBeTruthy();
  });

  it('opens the help modal with localized shortcut descriptions in English', async () => {
    await setLocalePreference('en-US');
    try {
      renderChatPage();

      const textarea = await screen.findByTestId('message-textarea');
      fireEvent.change(textarea, { target: { value: '/help' } });
      fireEvent.keyDown(textarea, { key: 'Enter' });
      fireEvent.keyDown(textarea, { key: 'Enter' });

      await waitFor(() => {
        expect(screen.getByTestId('command-help-modal')).toBeTruthy();
      });
      expect(screen.getByText('Shortcuts and commands')).toBeTruthy();
      expect(screen.getByText('Global shortcuts')).toBeTruthy();
      expect(screen.getByText('Input shortcuts')).toBeTruthy();
      expect(screen.getAllByText('Open shortcut and command help').length).toBeGreaterThan(0);
      expect(screen.getByText('Insert a new line in the input')).toBeTruthy();
      expect(screen.queryByText('Select previous session')).toBeNull();
    } finally {
      await setLocalePreference('zh-CN');
    }
  });

  it('enters edit mode from the /edit slash command', async () => {
    useSessionStore.setState({
      sessions: [
        {
          sessionId: 'session-1',
          displayTitle: 'Session 1',
          lastActivityAt: '2026-04-16T08:14:57.400Z',
        },
      ],
    });
    useConversationStore.setState({
      historyEnvelopesBySession: {
        'session-1': [
          {
            eventId: 'user-1',
            sessionId: 'session-1',
            requestId: 'req-1',
            sequence: 1,
            eventType: 'REQUEST_ACCEPTED',
            timelineEventRef: null,
            transportHints: ['local-optimistic'],
            payload: {
              content: 'edit this question',
              role: 'USER',
              messageId: 'req-1',
              rootMessageId: 'req-1',
            },
            createdAt: '2026-04-16T08:14:57.000Z',
          },
          {
            eventId: 'assistant-1',
            sessionId: 'session-1',
            requestId: 'req-1',
            sequence: 2,
            eventType: 'LLM_CONTENT_DELTA',
            timelineEventRef: null,
            transportHints: ['SSE'],
            payload: {
              content: 'assistant reply',
              rootMessageId: 'req-1',
            },
            createdAt: '2026-04-16T08:14:57.100Z',
          },
        ],
      },
      conversationLoadStateBySession: { 'session-1': 'ready' },
    });

    renderChatPage();

    const textarea = await screen.findByTestId('message-textarea');
    fireEvent.change(textarea, { target: { value: '/edit' } });
    fireEvent.keyDown(textarea, { key: 'Enter' });
    fireEvent.keyDown(textarea, { key: 'Enter' });

    await waitFor(() => {
      expect((screen.getByTestId('message-textarea') as HTMLTextAreaElement).value).toBe('edit this question');
    });
    expect(screen.getByTestId('edit-mode-hint')).toBeTruthy();
  });

  it('does not restore /edit into the composer after a slash-edit submit succeeds', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          sessionId: 'session-1',
          requestId: 'run-2',
          runId: 'run-2',
          attempt: 1,
        }),
    });
    useSessionStore.setState({
      sessions: [
        {
          sessionId: 'session-1',
          displayTitle: 'Session 1',
          lastActivityAt: '2026-04-16T08:14:57.400Z',
        },
      ],
    });
    useConversationStore.setState({
      historyEnvelopesBySession: {
        'session-1': [
          {
            eventId: 'user-1',
            sessionId: 'session-1',
            requestId: 'req-1',
            sequence: 1,
            eventType: 'REQUEST_ACCEPTED',
            timelineEventRef: null,
            transportHints: ['local-optimistic'],
            payload: {
              content: 'edit this question',
              role: 'USER',
              messageId: 'req-1',
              rootMessageId: 'req-1',
            },
            createdAt: '2026-04-16T08:14:57.000Z',
          },
          {
            eventId: 'assistant-1',
            sessionId: 'session-1',
            requestId: 'req-1',
            sequence: 2,
            eventType: 'LLM_CONTENT_DELTA',
            timelineEventRef: null,
            transportHints: ['SSE'],
            payload: {
              content: 'assistant reply',
              rootMessageId: 'req-1',
            },
            createdAt: '2026-04-16T08:14:57.100Z',
          },
        ],
      },
      conversationLoadStateBySession: { 'session-1': 'ready' },
    });

    renderChatPage();

    const textarea = await screen.findByTestId('message-textarea');
    fireEvent.change(textarea, { target: { value: '/edit' } });
    fireEvent.keyDown(textarea, { key: 'Enter' });
    fireEvent.keyDown(textarea, { key: 'Enter' });

    await waitFor(() => {
      expect((screen.getByTestId('message-textarea') as HTMLTextAreaElement).value).toBe('edit this question');
    });

    fireEvent.change(screen.getByTestId('message-textarea'), {
      target: { value: 'edited question' },
    });

    await act(async () => {
      fireEvent.click(screen.getByTestId('btn-confirm-edit'));
    });

    await waitFor(() => {
      expect(screen.getByTestId('edit-submit-notice')).toBeTruthy();
    });

    expect((screen.getByTestId('message-textarea') as HTMLTextAreaElement).value).toBe('');
  });

  it('does not trigger an immediate background conversation reload when retry starts', async () => {
    let resolveRetry: (() => void) | undefined;
    const retryResponse = new Promise<Response>((resolve) => {
      resolveRetry = () =>
        resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              sessionId: 'session-1',
              requestId: 'req-1',
              runId: 'run-retry-1',
              attempt: 2,
            }),
        } as Response);
    });
    global.fetch = vi.fn().mockReturnValue(retryResponse);
    useSessionStore.setState({
      sessions: [
        {
          sessionId: 'session-1',
          displayTitle: 'Session 1',
          lastActivityAt: '2026-04-16T08:14:57.400Z',
        },
      ],
    });
    useConversationStore.setState({
      historyEnvelopesBySession: {
        'session-1': [
          {
            eventId: 'user-1',
            sessionId: 'session-1',
            requestId: 'req-1',
            sequence: 1,
            eventType: 'REQUEST_ACCEPTED',
            timelineEventRef: null,
            transportHints: ['local-optimistic'],
            payload: {
              content: 'test question',
              role: 'USER',
              messageId: 'req-1',
              rootMessageId: 'req-1',
            },
            createdAt: '2026-04-16T08:14:57.000Z',
          },
          {
            eventId: 'assistant-1',
            sessionId: 'session-1',
            requestId: 'req-1',
            sequence: 2,
            eventType: 'LLM_CONTENT_DELTA',
            timelineEventRef: null,
            transportHints: ['SSE'],
            payload: {
              content: 'assistant reply',
              rootMessageId: 'req-1',
            },
            createdAt: '2026-04-16T08:14:57.100Z',
          },
        ],
      },
      conversationLoadStateBySession: { 'session-1': 'ready' },
    });

    renderChatPage();

    const assistantRegion = await screen.findByTestId('assistant-content-region');
    fireEvent.mouseEnter(assistantRegion);

    await act(async () => {
      fireEvent.click(screen.getByTestId('btn-retry-ai'));
    });

    expect(screen.queryByTestId('assistant-content-region')).toBeNull();
    expect(screen.queryByTestId('btn-retry-ai')).toBeNull();
    expect(screen.queryByTestId('btn-stop')).toBeNull();
    expect(screen.queryByText('Retry latest request')).toBeNull();

    await act(async () => {
      resolveRetry?.();
      await retryResponse;
    });

    await waitFor(() => {
      expect(screen.queryByTestId('assistant-content-region')).toBeNull();
    });
  });

  it('clears the previous assistant reply and shows the edit notice after edit submit', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          sessionId: 'session-1',
          requestId: 'run-2',
          runId: 'run-2',
          attempt: 1,
        }),
    });
    useSessionStore.setState({
      sessions: [
        {
          sessionId: 'session-1',
          displayTitle: 'Session 1',
          lastActivityAt: '2026-04-16T08:14:57.400Z',
        },
      ],
    });
    useConversationStore.setState({
      historyEnvelopesBySession: {
        'session-1': [
          {
            eventId: 'user-1',
            sessionId: 'session-1',
            requestId: 'req-1',
            sequence: 1,
            eventType: 'REQUEST_ACCEPTED',
            timelineEventRef: null,
            transportHints: ['local-optimistic'],
            payload: {
              content: 'edit this question',
              role: 'USER',
              messageId: 'req-1',
              rootMessageId: 'req-1',
            },
            createdAt: '2026-04-16T08:14:57.000Z',
          },
          {
            eventId: 'assistant-1',
            sessionId: 'session-1',
            requestId: 'req-1',
            sequence: 2,
            eventType: 'LLM_CONTENT_DELTA',
            timelineEventRef: null,
            transportHints: ['SSE'],
            payload: {
              content: 'assistant reply',
              rootMessageId: 'req-1',
            },
            createdAt: '2026-04-16T08:14:57.100Z',
          },
        ],
      },
      conversationLoadStateBySession: { 'session-1': 'ready' },
    });

    renderChatPage();

    const scrollViewport = (await screen.findByTestId('right-pane-scroll-viewport')) as HTMLDivElement & {
      scrollHeight: number;
      clientHeight: number;
      scrollTop: number;
      scrollTo: typeof HTMLElement.prototype.scrollTo;
    };
    mockScrollableViewport(scrollViewport, { scrollHeight: 1000, clientHeight: 400, scrollTop: 600 });
    fireEvent.scroll(scrollViewport);
    fireEvent.wheel(scrollViewport, { deltaY: -30 });
    scrollViewport.scrollTop = 480;
    fireEvent.scroll(scrollViewport);
    await flushAnimationFrame();

    const userRegion = await screen.findByTestId('user-content-region');
    fireEvent.mouseEnter(userRegion);
    fireEvent.click(await screen.findByTestId('btn-edit-user'));
    fireEvent.change(screen.getByTestId('message-textarea'), {
      target: { value: 'edited question' },
    });

    await act(async () => {
      fireEvent.click(screen.getByTestId('btn-confirm-edit'));
    });

    await waitFor(() => {
      expect(screen.queryByTestId('assistant-content-region')).toBeNull();
    });
    expect(screen.getByTestId('edit-submit-notice')).toBeTruthy();
    expect(screen.getByText('edited question')).toBeTruthy();
    await flushAnimationFrames(20);
    expect(scrollViewport.scrollTop).toBe(480);
  });

  it('keeps the edited text and allows Escape to exit when edit submit hits a conflict', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 409,
      statusText: 'Conflict',
      json: () => Promise.resolve({ error: 'edit target moved' }),
    });
    useSessionStore.setState({
      sessions: [
        {
          sessionId: 'session-1',
          displayTitle: 'Session 1',
          lastActivityAt: '2026-04-16T08:14:57.400Z',
        },
      ],
    });
    useConversationStore.setState({
      historyEnvelopesBySession: {
        'session-1': [
          {
            eventId: 'user-1',
            sessionId: 'session-1',
            requestId: 'req-1',
            sequence: 1,
            eventType: 'REQUEST_ACCEPTED',
            timelineEventRef: null,
            transportHints: ['local-optimistic'],
            payload: {
              content: 'edit this question',
              role: 'USER',
              messageId: 'req-1',
              rootMessageId: 'req-1',
            },
            createdAt: '2026-04-16T08:14:57.000Z',
          },
          {
            eventId: 'assistant-1',
            sessionId: 'session-1',
            requestId: 'req-1',
            sequence: 2,
            eventType: 'LLM_CONTENT_DELTA',
            timelineEventRef: null,
            transportHints: ['SSE'],
            payload: {
              content: 'assistant reply',
              rootMessageId: 'req-1',
            },
            createdAt: '2026-04-16T08:14:57.100Z',
          },
        ],
      },
      conversationLoadStateBySession: { 'session-1': 'ready' },
    });

    renderChatPage();

    const userRegion = await screen.findByTestId('user-content-region');
    fireEvent.mouseEnter(userRegion);
    fireEvent.click(await screen.findByTestId('btn-edit-user'));

    const textarea = screen.getByTestId('message-textarea') as HTMLTextAreaElement;
    fireEvent.change(textarea, {
      target: { value: 'edited question' },
    });

    await act(async () => {
      fireEvent.click(screen.getByTestId('btn-confirm-edit'));
    });

    await waitFor(() => {
      expect(useRequestStore.getState().editError?.message ?? '').toContain('最新一条');
    });

    expect(screen.getByTestId('edit-mode-hint')).toBeTruthy();
    expect(textarea.value).toBe('edited question');

    fireEvent.keyDown(textarea, { key: 'Escape' });

    await waitFor(() => {
      expect(screen.queryByTestId('edit-mode-hint')).toBeNull();
    });
    expect((screen.getByTestId('message-textarea') as HTMLTextAreaElement).value).toBe('');
  });

  it('keeps slash-edit text on failure and Escape exits without restoring /edit', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 409,
      statusText: 'Conflict',
      json: () => Promise.resolve({ error: 'edit target moved' }),
    });
    useSessionStore.setState({
      sessions: [
        {
          sessionId: 'session-1',
          displayTitle: 'Session 1',
          lastActivityAt: '2026-04-16T08:14:57.400Z',
        },
      ],
    });
    useConversationStore.setState({
      historyEnvelopesBySession: {
        'session-1': [
          {
            eventId: 'user-1',
            sessionId: 'session-1',
            requestId: 'req-1',
            sequence: 1,
            eventType: 'REQUEST_ACCEPTED',
            timelineEventRef: null,
            transportHints: ['local-optimistic'],
            payload: {
              content: 'edit this question',
              role: 'USER',
              messageId: 'req-1',
              rootMessageId: 'req-1',
            },
            createdAt: '2026-04-16T08:14:57.000Z',
          },
          {
            eventId: 'assistant-1',
            sessionId: 'session-1',
            requestId: 'req-1',
            sequence: 2,
            eventType: 'LLM_CONTENT_DELTA',
            timelineEventRef: null,
            transportHints: ['SSE'],
            payload: {
              content: 'assistant reply',
              rootMessageId: 'req-1',
            },
            createdAt: '2026-04-16T08:14:57.100Z',
          },
        ],
      },
      conversationLoadStateBySession: { 'session-1': 'ready' },
    });

    renderChatPage();

    const textarea = await screen.findByTestId('message-textarea');
    fireEvent.change(textarea, { target: { value: '/edit' } });
    fireEvent.keyDown(textarea, { key: 'Enter' });
    fireEvent.keyDown(textarea, { key: 'Enter' });

    await waitFor(() => {
      expect((screen.getByTestId('message-textarea') as HTMLTextAreaElement).value).toBe('edit this question');
    });

    fireEvent.change(screen.getByTestId('message-textarea'), {
      target: { value: 'edited question' },
    });

    await act(async () => {
      fireEvent.click(screen.getByTestId('btn-confirm-edit'));
    });

    await waitFor(() => {
      expect(useRequestStore.getState().editError?.message ?? '').toContain('最新一条');
    });

    const editTextarea = screen.getByTestId('message-textarea') as HTMLTextAreaElement;
    expect(screen.getByTestId('edit-mode-hint')).toBeTruthy();
    expect(editTextarea.value).toBe('edited question');

    fireEvent.keyDown(editTextarea, { key: 'Escape' });

    await waitFor(() => {
      expect(screen.queryByTestId('edit-mode-hint')).toBeNull();
    });
    expect((screen.getByTestId('message-textarea') as HTMLTextAreaElement).value).toBe('');
  });

  it('returns the composer to the normal send state after a terminal stream event', async () => {
    useRequestStore.setState({
      requestStatus: 'accepted',
      activeRequestRootMessageId: 'run-1',
    });

    renderChatPage();

    await waitFor(() => {
      expect(screen.getByTestId('btn-stop')).toBeTruthy();
    });

    await act(async () => {
      streamHookState.latestParams?.onTerminal?.({
        eventId: 'evt-terminal',
        sessionId: 'session-1',
        requestId: 'run-1',
        sequence: 2,
        eventType: 'REQUEST_COMPLETED',
        timelineEventRef: null,
        transportHints: [],
        payload: {},
        createdAt: '2026-04-16T06:44:13.000Z',
      });
    });

    await waitFor(() => {
      expect(screen.getByTestId('btn-send')).toBeTruthy();
    });
    expect(screen.queryByTestId('btn-stop')).toBeNull();
    expect(useRequestStore.getState().requestStatus).toBe('idle');
  });

  it('returns the composer to send state when terminal matches the active run id', async () => {
    useRequestStore.setState({
      requestStatus: 'accepted',
      activeRequestRootMessageId: 'run-1',
      isSubmittingRequest: true,
    });
    useConversationStore.setState({
      conversationLoadStateBySession: { 'session-1': 'ready' },
      runtimeBySession: {
        'session-1': {
          activeRootMessageId: null,
          activeRun: {
            requestId: 'request-root-1',
            runId: 'run-1',
            status: 'EXECUTING',
          },
          continuityPhase: 'idle',
          continuityMessage: null,
        },
      },
    });

    renderChatPage();

    await waitFor(() => {
      expect(screen.getByTestId('btn-stop')).toBeTruthy();
    });

    await act(async () => {
      streamHookState.latestParams?.onTerminal?.({
        eventId: 'evt-terminal-run-id',
        sessionId: 'session-1',
        requestId: 'request-root-1',
        runId: 'run-1',
        requestContextId: 'context-1',
        sequence: 1370,
        eventType: 'REQUEST_COMPLETED',
        timelineEventRef: null,
        transportHints: [],
        payload: {
          rootMessageId: 'request-root-1',
          runId: 'run-1',
          requestContextId: 'context-1',
          status: 'COMPLETED',
        },
        createdAt: '2026-04-16T06:44:13.000Z',
      });
    });

    await waitFor(() => {
      expect(screen.getByTestId('btn-send')).toBeTruthy();
    });
    expect(screen.queryByTestId('btn-stop')).toBeNull();
    expect(useRequestStore.getState().requestStatus).toBe('idle');
    expect(useConversationStore.getState().runtimeBySession['session-1']?.activeRun).toBeNull();
  });

  it('does not carry the current composer input into another session when switching sessions', async () => {
    useSessionStore.setState({
      sessions: [
        {
          sessionId: 'session-a',
          displayTitle: 'Session A',
          lastActivityAt: '2026-04-19T10:00:00.000Z',
        },
        {
          sessionId: 'session-b',
          displayTitle: 'Session B',
          lastActivityAt: '2026-04-19T10:01:00.000Z',
        },
      ],
      activeSessionId: 'session-a',
    });
    useConversationStore.setState({
      conversationLoadStateBySession: {
        'session-a': 'ready',
        'session-b': 'ready',
      },
    });

    render(<ChatPageCoreSessionSwitchHarness />);

    const textarea = (await screen.findByTestId('message-textarea')) as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: 'draft for session A' } });

    await waitFor(() => {
      expect(sessionStorage.getItem('draft-session-a')).toBe('draft for session A');
    });

    fireEvent.click(screen.getByTestId('switch-session-b'));

    await waitFor(() => {
      expect((screen.getByTestId('message-textarea') as HTMLTextAreaElement).value).toBe('');
    });
    expect(sessionStorage.getItem('draft-session-b')).toBeNull();

    fireEvent.click(screen.getByTestId('switch-session-a'));

    await waitFor(() => {
      expect((screen.getByTestId('message-textarea') as HTMLTextAreaElement).value).toBe('draft for session A');
    });
  });

  it('does not apply a running request from the previous session to the new-session route', async () => {
    useSessionStore.setState({
      sessions: [
        {
          sessionId: 'session-a',
          displayTitle: 'Session A',
          lastActivityAt: '2026-04-19T10:00:00.000Z',
        },
        {
          sessionId: 'session-b',
          displayTitle: 'Session B',
          lastActivityAt: '2026-04-19T10:01:00.000Z',
        },
      ],
      activeSessionId: 'session-a',
    });
    useConversationStore.setState({
      conversationLoadStateBySession: {
        'session-a': 'ready',
        'session-b': 'ready',
      },
      runtimeBySession: {
        'session-a': {
          activeRootMessageId: 'root-a',
          activeRun: {
            requestId: 'root-a',
            runId: 'run-a',
            status: 'EXECUTING',
          },
          continuityPhase: 'idle',
          continuityMessage: null,
        },
      },
    });
    useRequestStore.setState({
      requestStatus: 'accepted',
      activeRequestRootMessageId: 'root-a',
      pendingRequest: {
        kind: 'submit',
        sessionId: 'session-a',
        idempotencyKey: 'submit-session-a',
        startedAtMs: Date.now(),
        optimisticRequestId: 'optimistic-a',
        acceptedRootMessageId: 'root-a',
        acceptedRunId: 'run-a',
      },
    });

    render(<ChatPageCoreSessionSwitchHarness />);

    await waitFor(() => {
      expect(streamHookState.latestParams).toEqual(
        expect.objectContaining({
          sessionId: 'session-a',
          canOpenStream: true,
          isExecuting: true,
          acceptedRun: expect.objectContaining({
            requestId: 'root-a',
            runId: 'run-a',
          }),
        }),
      );
    });
    expect(screen.queryByTestId('chat-stream-status-strip')).toBeNull();

    fireEvent.click(screen.getByTestId('open-new-session'));

    await waitFor(() => {
      expect(streamHookState.latestParams).toEqual(
        expect.objectContaining({
          sessionId: undefined,
          canOpenStream: false,
          isExecuting: true,
          acceptedRun: null,
        }),
      );
    });
    expect(screen.queryByTestId('chat-stream-status-strip')).toBeNull();

    fireEvent.click(screen.getByTestId('switch-session-a'));

    await waitFor(() => {
      expect(streamHookState.latestParams).toEqual(
        expect.objectContaining({
          sessionId: 'session-a',
          canOpenStream: true,
          isExecuting: true,
          acceptedRun: expect.objectContaining({
            requestId: 'root-a',
            runId: 'run-a',
          }),
        }),
      );
    });
    expect(screen.queryByTestId('chat-stream-status-strip')).toBeNull();
  });

  it('shows the stop button only on the session that owns the running request', async () => {
    vi.mocked(sessionService.loadConversation).mockImplementation((request) =>
      Promise.resolve({
        sessionId: request.sessionId,
        items: [],
        nextCursor: null,
        ...(request.sessionId === 'session-a' ? { activeRun: { requestId: 'run-a', runId: 'run-a', status: 'EXECUTING' } } : {}),
      }),
    );
    useSessionStore.setState({
      sessions: [
        {
          sessionId: 'session-a',
          displayTitle: 'Session A',
          lastActivityAt: '2026-04-19T10:00:00.000Z',
        },
        {
          sessionId: 'session-b',
          displayTitle: 'Session B',
          lastActivityAt: '2026-04-19T10:01:00.000Z',
        },
      ],
      activeSessionId: 'session-a',
    });
    useConversationStore.setState({
      conversationLoadStateBySession: {
        'session-a': 'ready',
        'session-b': 'ready',
      },
    });
    useRequestStore.setState({
      requestStatus: 'accepted',
      activeRequestRootMessageId: 'run-a',
      activeRequestSessionId: 'session-a',
    });

    render(<ChatPageCoreSessionSwitchHarness />);

    await waitFor(() => {
      expect(screen.getByTestId('btn-stop')).toBeTruthy();
    });

    fireEvent.click(screen.getByTestId('switch-session-b'));

    await waitFor(() => {
      expect(screen.getByTestId('btn-send')).toBeTruthy();
    });
    expect(screen.queryByTestId('btn-stop')).toBeNull();
    expect(useRequestStore.getState().requestStatus).toBe('accepted');

    fireEvent.click(screen.getByTestId('switch-session-a'));

    await waitFor(() => {
      expect(screen.getByTestId('btn-stop')).toBeTruthy();
    });
    expect(useRequestStore.getState().requestStatus).toBe('accepted');
    expect(useRequestStore.getState().activeRequestSessionId).toBe('session-a');
  });

  it('settles the stale tracked request when the viewed session has no activeRun', async () => {
    useSessionStore.setState({
      sessions: [
        {
          sessionId: 'session-a',
          displayTitle: 'Session A',
          lastActivityAt: '2026-04-19T10:00:00.000Z',
        },
      ],
      activeSessionId: 'session-a',
    });
    useConversationStore.setState({
      conversationLoadStateBySession: {
        'session-a': 'ready',
      },
      runtimeBySession: {
        'session-a': {
          activeRootMessageId: 'run-a',
          activeRun: {
            requestId: 'run-a',
            runId: 'run-a',
            status: 'EXECUTING',
          },
          continuityPhase: 'idle',
          continuityMessage: null,
        },
      },
    });
    useRequestStore.setState({
      requestStatus: 'accepted',
      activeRequestRootMessageId: 'run-a',
      activeRequestSessionId: 'session-a',
    });

    render(<ChatPageCoreSessionSwitchHarness />);

    await waitFor(() => {
      expect(screen.getByTestId('btn-send')).toBeTruthy();
    });
    expect(screen.queryByTestId('btn-stop')).toBeNull();
    expect(useRequestStore.getState().requestStatus).toBe('idle');
    expect(useRequestStore.getState().activeRequestSessionId).toBeNull();
  });

  it('ignores replayed historical terminal events when there is no active request', async () => {
    const loadSessionsSpy = vi.fn().mockResolvedValue(undefined);
    const loadConversationSpy = vi.fn().mockResolvedValue(true);

    useSessionStore.setState({
      loadSessions: loadSessionsSpy,
    });
    useConversationStore.setState({
      loadConversation: loadConversationSpy,
    });

    renderChatPage();

    await waitFor(() => {
      expect(streamHookState.latestParams?.sessionId).toBe('session-1');
    });
    await waitFor(() => {
      expect(loadSessionsSpy).toHaveBeenCalledTimes(1);
    });
    loadSessionsSpy.mockClear();
    loadConversationSpy.mockClear();

    await act(async () => {
      streamHookState.latestParams?.onTerminal?.({
        eventId: 'evt-terminal-history',
        sessionId: 'session-1',
        requestId: 'run-history',
        sequence: 8,
        eventType: 'REQUEST_COMPLETED',
        timelineEventRef: null,
        transportHints: ['replayable'],
        payload: {},
        createdAt: '2026-04-18T04:26:13.000Z',
      });
    });

    expect(loadSessionsSpy).not.toHaveBeenCalled();
    expect(loadConversationSpy).not.toHaveBeenCalled();
    expect(useRequestStore.getState().requestStatus).toBe('idle');
  });

  it('uses the restored expanded session-list limit when refreshing sessions on mount', async () => {
    const loadSessionsSpy = vi.fn().mockResolvedValue(undefined);
    sessionStorage.setItem(SIDEBAR_SESSION_LIST_EXPANDED_STORAGE_KEY, 'true');
    useSessionStore.setState({
      loadSessions: loadSessionsSpy,
    });

    renderChatPage();

    await waitFor(() => {
      expect(loadSessionsSpy).toHaveBeenCalledWith({
        limit: SESSION_HISTORY_PAGE_LIMIT,
        query: {},
      });
    });
    expect(useSessionStore.getState().historyWindowLimit).toBe(SESSION_HISTORY_PAGE_LIMIT);
  });

  it('settles a terminal event for an in-flight session without refreshing conversation history', async () => {
    const loadSessionsSpy = vi.fn().mockResolvedValue(undefined);
    const loadConversationSpy = vi.fn().mockResolvedValue(false);
    const loadPreviewMock = vi.mocked(sessionService.loadConversationPreview);

    useSessionStore.setState({
      sessions: [
        {
          sessionId: 'session-1',
          displayTitle: 'Session 1',
          lastActivityAt: '2026-04-19T10:00:01.000Z',
        },
      ],
      activeSessionId: 'session-1',
      loadSessions: loadSessionsSpy,
    });
    useConversationStore.setState({
      conversationLoadStateBySession: { 'session-1': 'ready' },
      loadConversation: loadConversationSpy,
      runtimeBySession: {
        'session-1': {
          activeRootMessageId: null,
          activeRun: {
            requestId: 'run-live',
            runId: 'run-live',
            status: 'EXECUTING',
          },
          continuityPhase: 'idle',
          continuityMessage: null,
        },
      },
    });

    renderChatPage();

    await waitFor(() => {
      expect(streamHookState.latestParams?.sessionId).toBe('session-1');
    });
    await waitFor(() => {
      expect(loadSessionsSpy).toHaveBeenCalledTimes(1);
    });
    await waitFor(() => {
      expect(loadPreviewMock).toHaveBeenCalledWith('session-1', { limit: 100 });
    });

    loadSessionsSpy.mockClear();
    loadConversationSpy.mockClear();
    loadPreviewMock.mockClear();
    vi.useFakeTimers();

    await act(async () => {
      streamHookState.latestParams?.onTerminal?.({
        eventId: 'evt-terminal-live',
        sessionId: 'session-1',
        requestId: 'run-live',
        sequence: 18,
        eventType: 'REQUEST_COMPLETED',
        timelineEventRef: null,
        transportHints: ['SSE'],
        payload: {
          rootMessageId: 'root-live',
        },
        createdAt: '2026-04-18T04:26:13.000Z',
      });
    });

    expect(loadSessionsSpy).toHaveBeenCalledTimes(1);
    expect(loadConversationSpy).not.toHaveBeenCalled();

    await act(async () => {
      vi.advanceTimersByTime(250);
      await Promise.resolve();
    });

    expect(loadConversationSpy).not.toHaveBeenCalled();
    expect(loadPreviewMock).not.toHaveBeenCalled();
    expect(useRequestStore.getState().requestStatus).toBe('idle');
  });

  it('does not refresh conversation history after terminal stream convergence', async () => {
    const loadSessionsSpy = vi.fn().mockResolvedValue(undefined);
    const loadConversationSpy = vi.fn().mockResolvedValue(false);

    useSessionStore.setState({
      loadSessions: loadSessionsSpy,
    });
    useConversationStore.setState({
      historyEnvelopesBySession: {
        'session-1': [
          {
            eventId: 'user-root-1',
            sessionId: 'session-1',
            requestId: 'root-1',
            sequence: 1,
            eventType: 'REQUEST_ACCEPTED',
            timelineEventRef: null,
            transportHints: [],
            payload: {
              content: 'retry this request',
              role: 'USER',
              messageId: 'root-1',
              rootMessageId: 'root-1',
            },
            createdAt: '2026-04-18T04:26:11.000Z',
          },
          {
            eventId: 'assistant-run-2',
            sessionId: 'session-1',
            requestId: 'run-2',
            sequence: 2,
            eventType: 'LLM_CONTENT_DELTA',
            timelineEventRef: null,
            transportHints: ['SSE'],
            payload: {
              content: 'partial answer',
              rootMessageId: 'root-1',
            },
            createdAt: '2026-04-18T04:26:12.000Z',
          },
        ],
      },
      conversationLoadStateBySession: { 'session-1': 'ready' },
      loadConversation: loadConversationSpy,
    });
    useRequestStore.setState({
      requestStatus: 'accepted',
      activeRequestRootMessageId: 'run-2',
    });

    renderChatPage();

    await waitFor(() => {
      expect(streamHookState.latestParams?.sessionId).toBe('session-1');
    });
    await waitFor(() => {
      expect(loadSessionsSpy).toHaveBeenCalledTimes(1);
    });
    loadSessionsSpy.mockClear();
    loadConversationSpy.mockClear();
    vi.useFakeTimers();

    await act(async () => {
      streamHookState.latestParams?.onTerminal?.({
        eventId: 'evt-terminal-active',
        sessionId: 'session-1',
        requestId: 'run-2',
        sequence: 3,
        eventType: 'REQUEST_COMPLETED',
        timelineEventRef: null,
        transportHints: [],
        payload: {},
        createdAt: '2026-04-18T04:26:13.000Z',
      });
    });

    expect(loadSessionsSpy).toHaveBeenCalledTimes(1);
    expect(loadConversationSpy).not.toHaveBeenCalled();

    await act(async () => {
      vi.advanceTimersByTime(250);
      await Promise.resolve();
    });

    expect(loadConversationSpy).not.toHaveBeenCalled();

    await act(async () => {
      vi.advanceTimersByTime(2_000);
      await Promise.resolve();
    });

    expect(loadConversationSpy).not.toHaveBeenCalled();
  });

  it('keeps an accepted request active without refreshing during stream silence', async () => {
    const loadSessionsSpy = vi.fn().mockResolvedValue(undefined);
    const loadConversationSpy = vi.fn().mockResolvedValue(false);
    const localEnvelope: StreamEnvelope = {
      eventId: 'temp-run-1',
      sessionId: 'session-1',
      requestId: 'run-1',
      sequence: 0,
      eventType: 'REQUEST_ACCEPTED',
      timelineEventRef: null,
      transportHints: ['local-optimistic'],
      payload: {
        content: 'hello',
        text: 'hello',
        contentType: 'PLAIN_TEXT',
        metadata: { accumulated: true },
        role: 'USER',
        messageId: 'run-1',
        rootMessageId: 'run-1',
      },
      createdAt: '2026-04-26T02:50:00.000Z',
    };

    useSessionStore.setState({
      activeSessionId: 'session-1',
      loadSessions: loadSessionsSpy,
    });
    useConversationStore.setState({
      activeLiveBySession: { 'session-1': makeLiveBuckets([localEnvelope]) },
      historyEnvelopesBySession: {},
      conversationLoadStateBySession: { 'session-1': 'ready' },
      loadConversation: loadConversationSpy,
    });
    useRequestStore.setState({
      requestStatus: 'accepted',
      activeRequestRootMessageId: 'run-1',
      activeRequestSessionId: 'session-1',
      pendingRequest: {
        kind: 'submit',
        sessionId: 'session-1',
        idempotencyKey: 'submit-key',
        startedAtMs: Date.now(),
        acceptedRootMessageId: 'run-1',
        acceptedRunId: 'run-1',
      },
    });

    vi.useFakeTimers();
    renderChatPage();

    expect(streamHookState.latestParams?.sessionId).toBe('session-1');
    loadSessionsSpy.mockClear();
    loadConversationSpy.mockClear();

    await act(async () => {
      vi.advanceTimersByTime(60_000);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(useRequestStore.getState().requestStatus).toBe('accepted');
    expect(useRequestStore.getState().activeRequestRootMessageId).toBe('run-1');
    expect(useRequestStore.getState().submitError).toBeNull();
    expect(screen.queryByTestId('chat-stream-status-strip')).toBeNull();
    expect(loadSessionsSpy).not.toHaveBeenCalled();
    expect(loadConversationSpy).not.toHaveBeenCalled();
  });

  it('does not switch the message list to skeletons when only session history is refreshing', async () => {
    useSessionStore.setState({
      isLoadingHistory: true,
    });
    useConversationStore.setState({
      historyEnvelopesBySession: {
        'session-1': [
          {
            eventId: 'user-1',
            sessionId: 'session-1',
            requestId: 'req-1',
            sequence: 1,
            eventType: 'REQUEST_ACCEPTED',
            timelineEventRef: null,
            transportHints: ['local-optimistic'],
            payload: {
              content: 'test',
              role: 'USER',
              messageId: 'req-1',
              rootMessageId: 'req-1',
            },
            createdAt: '2026-04-16T08:14:57.000Z',
          },
          {
            eventId: 'assistant-1',
            sessionId: 'session-1',
            requestId: 'req-1',
            sequence: 2,
            eventType: 'LLM_CONTENT_DELTA',
            timelineEventRef: null,
            transportHints: ['SSE'],
            payload: {
              content: 'reply received',
            },
            createdAt: '2026-04-16T08:14:57.100Z',
          },
        ],
      },
      conversationLoadStateBySession: { 'session-1': 'ready' },
    });

    renderChatPage();

    await waitFor(() => {
      expect(screen.getByTestId('turn-block')).toBeTruthy();
    });
    expect(screen.queryByTestId('turn-block-skeleton')).toBeNull();
  });

  it('uses the terminal canceled envelope for the latest turn when the session list has no run status', async () => {
    useSessionStore.setState({
      sessions: [
        {
          sessionId: 'session-1',
          displayTitle: 'Session 1',
          lastActivityAt: '2026-04-16T08:14:57.200Z',
        },
      ],
    });
    useConversationStore.setState({
      historyEnvelopesBySession: {
        'session-1': [
          {
            eventId: 'user-1',
            sessionId: 'session-1',
            requestId: 'req-1',
            sequence: 1,
            eventType: 'REQUEST_ACCEPTED',
            timelineEventRef: null,
            transportHints: [],
            payload: {
              content: 'test',
              role: 'USER',
              messageId: 'req-1',
              rootMessageId: 'req-1',
            },
            createdAt: '2026-04-16T08:14:57.000Z',
          },
          {
            eventId: 'assistant-1',
            sessionId: 'session-1',
            requestId: 'req-1',
            sequence: 2,
            eventType: 'LLM_CONTENT_DELTA',
            timelineEventRef: null,
            transportHints: [],
            payload: {
              content: 'partial result',
              rootMessageId: 'req-1',
            },
            createdAt: '2026-04-16T08:14:57.100Z',
          },
          {
            eventId: 'terminal-1',
            sessionId: 'session-1',
            requestId: 'req-1',
            sequence: 3,
            eventType: 'REQUEST_CANCELED',
            timelineEventRef: null,
            transportHints: [],
            payload: {
              rootMessageId: 'req-1',
              content: 'Request canceled by user.',
            },
            createdAt: '2026-04-16T08:14:57.200Z',
          },
        ],
      },
      conversationLoadStateBySession: { 'session-1': 'ready' },
    });

    renderChatPage();

    await waitFor(() => {
      expect(screen.getByTestId('turn-canceled-notice').getAttribute('data-canceled-partial')).toBe('true');
    });
    expect(screen.getByTestId('turn-process-summary-text').textContent).toContain('\u60a8\u5df2\u53d6\u6d88');
    expect(screen.queryByTestId('turn-answer-pending')).toBeNull();
    expect(screen.queryByTestId('turn-process-panel')).toBeNull();
  });

  it('keeps the composer inside the unified dock without a session selector', async () => {
    renderChatPage();

    const dock = await screen.findByTestId('chat-composer-dock');
    expect(dock).toBeTruthy();
    expect(screen.queryByTestId('composer-session-select')).toBeNull();
    expect(screen.getByTestId('btn-send')).toBeTruthy();
    expect(screen.queryByTestId('chat-composer-frost-gap')).toBeNull();
    expect(screen.queryByTestId('chat-composer-frost-bottom')).toBeNull();
  });

  it('opens the selected turn full-process graph in a closeable side region and returns focus', async () => {
    const removeEventListenerSpy = vi.spyOn(window, 'removeEventListener');
    try {
      Object.defineProperty(window, 'innerWidth', {
        configurable: true,
        writable: true,
        value: 1440,
      });
      useConversationStore.setState({
        historyEnvelopesBySession: {
          'session-1': [
            makeGraphEnvelope('root-graph', 1, 'REQUEST_ACCEPTED', {
              content: 'graph question',
              role: 'USER',
              messageId: 'root-graph',
            }),
            makeGraphEnvelope('root-graph', 2, 'LLM_THINKING_DELTA', { delta: 'private thinking' }),
            makeGraphEnvelope('root-graph', 3, 'CAPABILITY_STARTED', {
              toolCallId: 'tool-1',
              toolName: 'diagnose',
            }),
            makeGraphEnvelope('root-graph', 4, 'LLM_CONTENT_DELTA', { content: 'partial answer' }),
          ],
        },
        conversationLoadStateBySession: { 'session-1': 'ready' },
      });

      renderChatPage();

      const fullProcessButton = await screen.findByTestId('turn-process-timeline-button');
      fireEvent.click(fullProcessButton);

      expect(screen.getByTestId('turn-run-graph-side-region')).toBeTruthy();
      expect((await screen.findByTestId('turn-run-graph-summary-list')).textContent).toContain('diagnose');
      expect((await screen.findByTestId('mock-chat-x6-flow')).textContent).toContain('diagnose');

      const resizeHandle = screen.getByTestId('turn-run-graph-resize-handle');
      resizeHandle.focus();
      expect(document.activeElement).toBe(resizeHandle);
      fireEvent.keyDown(resizeHandle, { key: 'ArrowLeft' });
      await waitFor(() => {
        expect(resizeHandle.getAttribute('aria-valuenow')).toBe('632');
      });
      fireEvent.keyDown(resizeHandle, { key: 'End' });
      await waitFor(() => {
        expect(resizeHandle.getAttribute('aria-valuenow')).toBe('868');
      });
      fireEvent.keyDown(resizeHandle, { key: 'Home' });
      await waitFor(() => {
        expect(resizeHandle.getAttribute('aria-valuenow')).toBe('360');
      });

      fireEvent.pointerDown(screen.getByTestId('turn-run-graph-resize-handle'), { clientX: 500 });
      fireEvent.pointerMove(window, { clientX: 320 });
      fireEvent.click(screen.getByTestId('turn-run-graph-close'));

      await waitFor(() => {
        expect(screen.queryByTestId('turn-run-graph-side-region')).toBeNull();
        expect(document.activeElement).toBe(fullProcessButton);
      });
      expect(removeEventListenerSpy).toHaveBeenCalledWith('pointermove', expect.any(Function));
      expect(removeEventListenerSpy).toHaveBeenCalledWith('pointerup', expect.any(Function));
      expect(removeEventListenerSpy).toHaveBeenCalledWith('pointercancel', expect.any(Function));
      expect(removeEventListenerSpy).toHaveBeenCalledWith('blur', expect.any(Function));
    } finally {
      removeEventListenerSpy.mockRestore();
    }
  });

  it('switches the side graph to another selected AI turn', async () => {
    const graphEnvelopes = [
      makeGraphEnvelope('root-one', 1, 'REQUEST_ACCEPTED', {
        content: 'first question',
        role: 'USER',
        messageId: 'root-one',
      }),
      makeGraphEnvelope('root-one', 2, 'CAPABILITY_STARTED', { toolCallId: 'tool-1', toolName: 'firstTool' }),
      makeGraphEnvelope('root-two', 3, 'REQUEST_ACCEPTED', {
        content: 'second question',
        role: 'USER',
        messageId: 'root-two',
      }),
      makeGraphEnvelope('root-two', 4, 'CAPABILITY_STARTED', { toolCallId: 'tool-2', toolName: 'secondTool' }),
    ];
    useConversationStore.setState({
      historyEnvelopesBySession: {
        'session-1': graphEnvelopes,
      },
      activeLiveBySession: {
        'session-1': makeLiveBuckets(graphEnvelopes),
      },
      conversationLoadStateBySession: { 'session-1': 'ready' },
    });

    renderChatPage();

    const buttons = await screen.findAllByTestId('turn-process-timeline-button');
    fireEvent.click(buttons[0]!);
    expect((await screen.findByTestId('turn-run-graph-summary-list')).textContent).toContain('firstTool');
    fireEvent.click(buttons[1]!);
    await waitFor(() => {
      expect(screen.getByTestId('turn-run-graph-summary-list').textContent).toContain('secondTool');
      expect(screen.getByTestId('turn-run-graph-summary-list').textContent).not.toContain('firstTool');
    });
  });

  it('uses the Drawer fallback when the split minimum widths cannot fit', async () => {
    Object.defineProperty(window, 'innerWidth', {
      configurable: true,
      writable: true,
      value: 700,
    });
    useConversationStore.setState({
      historyEnvelopesBySession: {
        'session-1': [
          makeGraphEnvelope('root-drawer', 1, 'REQUEST_ACCEPTED', {
            content: 'drawer question',
            role: 'USER',
            messageId: 'root-drawer',
          }),
          makeGraphEnvelope('root-drawer', 2, 'CAPABILITY_STARTED', { toolCallId: 'tool-1', toolName: 'drawerTool' }),
        ],
      },
      conversationLoadStateBySession: { 'session-1': 'ready' },
    });

    renderChatPage();

    fireEvent.click(await screen.findByTestId('turn-process-timeline-button'));

    expect(screen.getByRole('dialog', { name: /单轮运行详情流程图|Turn run detail graph/ })).toBeTruthy();
    expect(await screen.findByTestId('turn-run-graph-panel')).toBeTruthy();
    expect(screen.queryByTestId('turn-run-graph-side-region')).toBeNull();
    expect(screen.getByTestId('turn-run-graph-summary-list').textContent).toContain('drawerTool');
  });

  it('keeps assistant content streaming in the conversation while the graph is open', async () => {
    const initialEnvelopes = [
      makeGraphEnvelope('root-streaming-graph', 1, 'REQUEST_ACCEPTED', {
        content: 'stream question',
        role: 'USER',
        messageId: 'root-streaming-graph',
      }),
      makeGraphEnvelope('root-streaming-graph', 2, 'CAPABILITY_STARTED', {
        toolCallId: 'tool-1',
        toolName: 'streamTool',
      }),
      makeGraphEnvelope('root-streaming-graph', 3, 'LLM_CONTENT_DELTA', { content: 'first' }),
    ];
    useConversationStore.setState({
      historyEnvelopesBySession: { 'session-1': initialEnvelopes },
      activeLiveBySession: { 'session-1': makeLiveBuckets(initialEnvelopes) },
      conversationLoadStateBySession: { 'session-1': 'ready' },
    });

    renderChatPage();

    fireEvent.click(await screen.findByTestId('turn-process-timeline-button'));
    expect(screen.getByText('first')).toBeTruthy();

    await act(async () => {
      useConversationStore.setState({
        historyEnvelopesBySession: {
          'session-1': [...initialEnvelopes, makeGraphEnvelope('root-streaming-graph', 4, 'LLM_CONTENT_DELTA', { content: 'first second' })],
        },
        activeLiveBySession: {
          'session-1': makeLiveBuckets([
            ...initialEnvelopes,
            makeGraphEnvelope('root-streaming-graph', 4, 'LLM_CONTENT_DELTA', { content: 'first second' }),
          ]),
        },
      });
    });

    await waitFor(() => {
      expect(screen.getByTestId('assistant-content-region').textContent).toContain('first second');
    });
    expect(await screen.findByTestId('turn-run-graph-panel')).toBeTruthy();
  });

  it('shows a light stream status strip only when the connection is recovering', async () => {
    vi.useFakeTimers();
    useConversationStore.setState({
      runtimeBySession: {
        'session-1': {
          activeRootMessageId: null,
          activeRun: null,
          continuityPhase: 'reconnecting',
          continuityMessage: 'reconnecting',
        },
      },
    });

    renderChatPage();

    expect(screen.queryByTestId('chat-stream-status-strip')).toBeNull();

    await act(async () => {
      vi.advanceTimersByTime(801);
    });

    expect(screen.getByTestId('chat-stream-status-strip')).toBeTruthy();
  });

  it('suppresses transient reconnecting strips that recover before the display delay', async () => {
    vi.useFakeTimers();
    useConversationStore.setState({
      runtimeBySession: {
        'session-1': {
          activeRootMessageId: null,
          activeRun: null,
          continuityPhase: 'reconnecting',
          continuityMessage: 'reconnecting',
        },
      },
    });

    renderChatPage();

    expect(screen.queryByTestId('chat-stream-status-strip')).toBeNull();

    await act(async () => {
      vi.advanceTimersByTime(400);
      useConversationStore.getState().setStreamConnectionState('session-1', {
        phase: 'connected',
        message: null,
      });
    });

    await act(async () => {
      vi.advanceTimersByTime(800);
    });

    expect(screen.queryByTestId('chat-stream-status-strip')).toBeNull();
  });

  it('uses contrasting warning colors when the stream connection is disconnected', async () => {
    useConversationStore.setState({
      runtimeBySession: {
        'session-1': {
          activeRootMessageId: null,
          activeRun: null,
          continuityPhase: 'disconnected',
          continuityMessage: '实时连接暂未恢复，请刷新当前会话。',
        },
      },
    });

    renderChatPage();

    const strip = await screen.findByTestId('chat-stream-status-strip');
    expect(strip.style.background).toBe('var(--color-status-warning-bg)');
    expect(strip.style.color).toBe('var(--color-status-warning-text)');
    expect(strip.style.background).not.toBe(strip.style.color);
  });

  it('removes the stream status strip when the connection state is restored', async () => {
    useConversationStore.setState({
      runtimeBySession: {
        'session-1': {
          activeRootMessageId: null,
          activeRun: null,
          continuityPhase: 'disconnected',
          continuityMessage: '实时连接暂未恢复，请刷新当前会话。',
        },
      },
    });

    renderChatPage();

    expect(await screen.findByTestId('chat-stream-status-strip')).toBeTruthy();

    act(() => {
      useConversationStore.getState().setStreamConnectionState('session-1', {
        phase: 'connected',
        message: null,
      });
    });

    await waitFor(() => {
      expect(screen.queryByTestId('chat-stream-status-strip')).toBeNull();
    });
  });

  it('leaves bottom-following mode when the user scrolls upward and shows the centered jump-to-latest button', async () => {
    useConversationStore.setState({
      historyEnvelopesBySession: {
        'session-1': [
          {
            eventId: 'user-1',
            sessionId: 'session-1',
            requestId: 'req-1',
            sequence: 1,
            eventType: 'REQUEST_ACCEPTED',
            timelineEventRef: null,
            transportHints: ['local-optimistic'],
            payload: {
              content: 'test',
              role: 'USER',
              messageId: 'req-1',
              rootMessageId: 'req-1',
            },
            createdAt: '2026-04-16T08:14:57.000Z',
          },
          {
            eventId: 'assistant-1',
            sessionId: 'session-1',
            requestId: 'req-1',
            sequence: 2,
            eventType: 'LLM_CONTENT_DELTA',
            timelineEventRef: null,
            transportHints: ['SSE'],
            payload: {
              content: 'reply received',
            },
            createdAt: '2026-04-16T08:14:57.100Z',
          },
        ],
      },
      conversationLoadStateBySession: { 'session-1': 'ready' },
    });

    renderChatPage();

    const scrollViewport = (await screen.findByTestId('right-pane-scroll-viewport')) as HTMLDivElement & {
      scrollHeight: number;
      clientHeight: number;
      scrollTop: number;
      scrollTo: typeof HTMLElement.prototype.scrollTo;
    };
    mockScrollableViewport(scrollViewport);
    fireEvent.scroll(scrollViewport);
    scrollViewport.scrollTop = 540;
    fireEvent.wheel(scrollViewport, { deltaY: -30 });
    fireEvent.scroll(scrollViewport);
    await flushAnimationFrame();

    await waitFor(() => {
      expect(screen.getByTestId('chat-scroll-to-bottom-floating')).toBeTruthy();
    });
  }, 10_000);

  it('shows the centered jump-to-latest button when the user drags the scrollbar upward', async () => {
    useConversationStore.setState({
      historyEnvelopesBySession: {
        'session-1': [
          {
            eventId: 'user-1',
            sessionId: 'session-1',
            requestId: 'req-1',
            sequence: 1,
            eventType: 'REQUEST_ACCEPTED',
            timelineEventRef: null,
            transportHints: ['local-optimistic'],
            payload: {
              content: 'test',
              role: 'USER',
              messageId: 'req-1',
              rootMessageId: 'req-1',
            },
            createdAt: '2026-04-16T08:14:57.000Z',
          },
          {
            eventId: 'assistant-1',
            sessionId: 'session-1',
            requestId: 'req-1',
            sequence: 2,
            eventType: 'LLM_CONTENT_DELTA',
            timelineEventRef: null,
            transportHints: ['SSE'],
            payload: {
              content: 'reply received',
            },
            createdAt: '2026-04-16T08:14:57.100Z',
          },
        ],
      },
      conversationLoadStateBySession: { 'session-1': 'ready' },
    });

    renderChatPage();

    const scrollViewport = (await screen.findByTestId('right-pane-scroll-viewport')) as HTMLDivElement & {
      scrollHeight: number;
      clientHeight: number;
      scrollTop: number;
      scrollTo: typeof HTMLElement.prototype.scrollTo;
    };
    mockScrollableViewport(scrollViewport);
    fireEvent.scroll(scrollViewport);
    scrollViewport.scrollTop = 520;
    fireEvent.scroll(scrollViewport);
    await flushAnimationFrame();

    await waitFor(() => {
      expect(screen.getByTestId('chat-scroll-to-bottom-floating')).toBeTruthy();
    });
  });

  it('loads newer anchored messages while a request is submitting', async () => {
    const originalLoadNewerConversation = useConversationStore.getState().loadNewerConversation;
    const loadNewerConversationSpy = vi.fn().mockResolvedValue(true);
    useRequestStore.setState({ requestStatus: 'submitting' });
    useConversationStore.setState({
      historyEnvelopesBySession: {
        'session-1': [
          makeGraphEnvelope('anchor-root', 1, 'REQUEST_ACCEPTED', {
            content: 'anchor question',
            role: 'USER',
            messageId: 'anchor-root',
          }),
        ],
      },
      conversationLoadStateBySession: { 'session-1': 'ready' },
      conversationPageInfoBySession: {
        'session-1': {
          nextCursor: null,
          newerCursor: 'newer-cursor-1',
          isLoadingOlder: false,
          isLoadingNewer: false,
          olderLoadError: null,
          newerLoadError: null,
          hasLoadedOlder: false,
        },
      },
      conversationViewBySession: {
        'session-1': {
          mode: 'anchored',
          activeAnchorMessageId: 'anchor-root',
          newMessagesWhileAnchored: false,
        },
      },
      loadNewerConversation: loadNewerConversationSpy,
    });

    try {
      renderChatPage();

      const scrollViewport = (await screen.findByTestId('right-pane-scroll-viewport')) as HTMLDivElement & {
        scrollHeight: number;
        clientHeight: number;
        scrollTop: number;
        scrollTo: typeof HTMLElement.prototype.scrollTo;
      };
      mockScrollableViewport(scrollViewport, { scrollHeight: 1000, clientHeight: 400, scrollTop: 520 });
      fireEvent.wheel(scrollViewport, { deltaY: 40 });

      await waitFor(() => {
        expect(loadNewerConversationSpy).toHaveBeenCalledWith('session-1');
      });
    } finally {
      useConversationStore.setState({ loadNewerConversation: originalLoadNewerConversation });
    }
  });

  it('loads older messages while a request is accepted', async () => {
    const originalLoadOlderConversation = useConversationStore.getState().loadOlderConversation;
    const loadOlderConversationSpy = vi.fn().mockResolvedValue(true);
    useConversationStore.setState({
      historyEnvelopesBySession: {
        'session-1': [
          makeGraphEnvelope('older-root', 1, 'REQUEST_ACCEPTED', {
            content: 'older question',
            role: 'USER',
            messageId: 'older-root',
          }),
        ],
      },
      conversationLoadStateBySession: { 'session-1': 'ready' },
      conversationPageInfoBySession: {
        'session-1': {
          nextCursor: 'older-cursor-1',
          newerCursor: null,
          isLoadingOlder: false,
          isLoadingNewer: false,
          olderLoadError: null,
          newerLoadError: null,
          hasLoadedOlder: false,
        },
      },
      loadOlderConversation: loadOlderConversationSpy,
    });
    useRequestStore.setState({
      requestStatus: 'accepted',
      activeRequestRootMessageId: 'active-root',
    });

    try {
      renderChatPage();
      const scrollViewport = (await screen.findByTestId('right-pane-scroll-viewport')) as HTMLDivElement & {
        scrollHeight: number;
        clientHeight: number;
        scrollTop: number;
        scrollTo: typeof HTMLElement.prototype.scrollTo;
      };
      mockScrollableViewport(scrollViewport, { scrollHeight: 1200, clientHeight: 400, scrollTop: 240 });
      fireEvent.scroll(scrollViewport);
      scrollViewport.scrollTop = 96;
      fireEvent.scroll(scrollViewport);

      await waitFor(() => expect(loadOlderConversationSpy).toHaveBeenCalledWith('session-1'));
    } finally {
      useConversationStore.setState({ loadOlderConversation: originalLoadOlderConversation });
    }
  });

  it('keeps older pagination status visible while a request is executing', async () => {
    useConversationStore.setState({
      historyEnvelopesBySession: {
        'session-1': [
          makeGraphEnvelope('older-root', 1, 'REQUEST_ACCEPTED', {
            content: 'older question',
            role: 'USER',
            messageId: 'older-root',
          }),
        ],
      },
      conversationLoadStateBySession: { 'session-1': 'ready' },
      conversationPageInfoBySession: {
        'session-1': {
          nextCursor: 'older-cursor-1',
          newerCursor: null,
          isLoadingOlder: true,
          isLoadingNewer: false,
          olderLoadError: null,
          newerLoadError: null,
          hasLoadedOlder: false,
        },
      },
    });
    useRequestStore.setState({
      requestStatus: 'accepted',
      activeRequestRootMessageId: 'active-root',
    });

    renderChatPage();

    expect(await screen.findByTestId('history-boundary-status')).toBeTruthy();
  });

  it('keeps the final anchored page until deliberate downward input reaches the physical bottom', async () => {
    const originalLoadNewerConversation = useConversationStore.getState().loadNewerConversation;
    const loadNewerConversationSpy = vi.fn(async (sessionId: string) => {
      useConversationStore.getState().setConversationPageInfo(sessionId, { newerCursor: null });
      return true;
    });
    useConversationStore.setState({
      historyEnvelopesBySession: {
        'session-1': [
          makeGraphEnvelope('anchor-root', 1, 'REQUEST_ACCEPTED', {
            content: 'anchor question',
            role: 'USER',
            messageId: 'anchor-root',
          }),
        ],
      },
      conversationLoadStateBySession: { 'session-1': 'ready' },
      conversationPageInfoBySession: {
        'session-1': {
          nextCursor: null,
          newerCursor: 'newer-cursor-1',
          isLoadingOlder: false,
          isLoadingNewer: false,
          olderLoadError: null,
          newerLoadError: null,
          hasLoadedOlder: false,
        },
      },
      conversationViewBySession: {
        'session-1': {
          mode: 'anchored',
          activeAnchorMessageId: 'anchor-root',
          newMessagesWhileAnchored: false,
        },
      },
      loadNewerConversation: loadNewerConversationSpy,
    });

    try {
      renderChatPage();
      const scrollViewport = (await screen.findByTestId('right-pane-scroll-viewport')) as HTMLDivElement & {
        scrollHeight: number;
        clientHeight: number;
        scrollTop: number;
        scrollTo: typeof HTMLElement.prototype.scrollTo;
      };
      mockScrollableViewport(scrollViewport, { scrollHeight: 1000, clientHeight: 400, scrollTop: 520 });
      vi.mocked(sessionService.loadConversation).mockClear();
      fireEvent.scroll(scrollViewport);
      fireEvent.wheel(scrollViewport, { deltaY: 40 });

      await waitFor(() => expect(loadNewerConversationSpy).toHaveBeenCalledTimes(1));
      expect(useConversationStore.getState().conversationViewBySession['session-1']?.mode).toBe('anchored');

      fireEvent.pointerDown(screen.getByText('anchor question'), { pointerType: 'mouse' });
      scrollViewport.scrollTop = 600;
      fireEvent.scroll(scrollViewport);
      await flushAnimationFrame();
      expect(useConversationStore.getState().conversationViewBySession['session-1']?.mode).toBe('anchored');

      fireEvent.wheel(scrollViewport, { deltaY: 40 });
      await waitFor(() => {
        expect(useConversationStore.getState().conversationViewBySession['session-1']?.mode).toBe('recent');
      });
      expect(screen.queryByTestId('chat-scroll-to-bottom-floating')).toBeNull();
      expect(sessionService.loadConversation).not.toHaveBeenCalled();
    } finally {
      useConversationStore.setState({ loadNewerConversation: originalLoadNewerConversation });
    }
  });

  it('loads newer anchored messages from keyboard downward navigation', async () => {
    const originalLoadNewerConversation = useConversationStore.getState().loadNewerConversation;
    const loadNewerConversationSpy = vi.fn().mockResolvedValue(true);
    useRequestStore.setState({ requestStatus: 'submitting' });
    useConversationStore.setState({
      historyEnvelopesBySession: {
        'session-1': [
          makeGraphEnvelope('anchor-root', 1, 'REQUEST_ACCEPTED', {
            content: 'anchor question',
            role: 'USER',
            messageId: 'anchor-root',
          }),
        ],
      },
      conversationLoadStateBySession: { 'session-1': 'ready' },
      conversationPageInfoBySession: {
        'session-1': {
          nextCursor: null,
          newerCursor: 'newer-cursor-1',
          isLoadingOlder: false,
          isLoadingNewer: false,
          olderLoadError: null,
          newerLoadError: null,
          hasLoadedOlder: false,
        },
      },
      conversationViewBySession: {
        'session-1': {
          mode: 'anchored',
          activeAnchorMessageId: 'anchor-root',
          newMessagesWhileAnchored: false,
        },
      },
      loadNewerConversation: loadNewerConversationSpy,
    });

    try {
      renderChatPage();
      const scrollViewport = (await screen.findByTestId('right-pane-scroll-viewport')) as HTMLDivElement & {
        scrollHeight: number;
        clientHeight: number;
        scrollTop: number;
        scrollTo: typeof HTMLElement.prototype.scrollTo;
      };
      mockScrollableViewport(scrollViewport, { scrollHeight: 1000, clientHeight: 400, scrollTop: 520 });

      fireEvent.keyDown(scrollViewport, { key: 'PageDown' });

      await waitFor(() => expect(loadNewerConversationSpy).toHaveBeenCalledWith('session-1'));
    } finally {
      useConversationStore.setState({ loadNewerConversation: originalLoadNewerConversation });
    }
  });

  it.each([
    ['scrollbar', 'mouse'],
    ['touch', 'touch'],
  ])('loads newer anchored messages from %s downward movement', async (_label, pointerType) => {
    const originalLoadNewerConversation = useConversationStore.getState().loadNewerConversation;
    const loadNewerConversationSpy = vi.fn(async (sessionId: string) => {
      useConversationStore.getState().setConversationPageInfo(sessionId, {
        newerCursor: loadNewerConversationSpy.mock.calls.length === 1 ? 'newer-cursor-2' : 'newer-cursor-3',
      });
      return true;
    });
    useConversationStore.setState({
      historyEnvelopesBySession: {
        'session-1': [
          makeGraphEnvelope('anchor-root', 1, 'REQUEST_ACCEPTED', {
            content: 'anchor question',
            role: 'USER',
            messageId: 'anchor-root',
          }),
        ],
      },
      conversationLoadStateBySession: { 'session-1': 'ready' },
      conversationPageInfoBySession: {
        'session-1': {
          nextCursor: null,
          newerCursor: 'newer-cursor-1',
          isLoadingOlder: false,
          isLoadingNewer: false,
          olderLoadError: null,
          newerLoadError: null,
          hasLoadedOlder: false,
        },
      },
      conversationViewBySession: {
        'session-1': {
          mode: 'anchored',
          activeAnchorMessageId: 'anchor-root',
          newMessagesWhileAnchored: false,
        },
      },
      loadNewerConversation: loadNewerConversationSpy,
    });

    try {
      renderChatPage();
      const scrollViewport = (await screen.findByTestId('right-pane-scroll-viewport')) as HTMLDivElement & {
        scrollHeight: number;
        clientHeight: number;
        scrollTop: number;
        scrollTo: typeof HTMLElement.prototype.scrollTo;
      };
      mockScrollableViewport(scrollViewport, { scrollHeight: 2000, clientHeight: 400, scrollTop: 1500 });
      fireEvent.scroll(scrollViewport);
      fireEvent.pointerDown(scrollViewport, { pointerType });
      scrollViewport.scrollTop = 1520;
      fireEvent.scroll(scrollViewport);

      await waitFor(() => expect(loadNewerConversationSpy).toHaveBeenCalledWith('session-1'));
      Object.defineProperty(scrollViewport, 'scrollHeight', { value: 2500, writable: true, configurable: true });
      scrollViewport.scrollTop = 2000;
      fireEvent.scroll(scrollViewport);
      await waitFor(() => expect(loadNewerConversationSpy).toHaveBeenCalledTimes(2));
    } finally {
      useConversationStore.setState({ loadNewerConversation: originalLoadNewerConversation });
    }
  });

  it('releases the newer anchored load lock for the next deliberate downward scroll', async () => {
    const originalLoadNewerConversation = useConversationStore.getState().loadNewerConversation;
    const loadNewerConversationSpy = vi.fn(async (sessionId: string) => {
      const nextCursor = loadNewerConversationSpy.mock.calls.length === 1 ? 'newer-cursor-2' : 'newer-cursor-3';
      useConversationStore.getState().setConversationPageInfo(sessionId, { newerCursor: nextCursor });
      return true;
    });
    useConversationStore.setState({
      historyEnvelopesBySession: {
        'session-1': [
          makeGraphEnvelope('anchor-root', 1, 'REQUEST_ACCEPTED', {
            content: 'anchor question',
            role: 'USER',
            messageId: 'anchor-root',
          }),
        ],
      },
      conversationLoadStateBySession: { 'session-1': 'ready' },
      conversationPageInfoBySession: {
        'session-1': {
          nextCursor: null,
          newerCursor: 'newer-cursor-1',
          isLoadingOlder: false,
          isLoadingNewer: false,
          olderLoadError: null,
          newerLoadError: null,
          hasLoadedOlder: false,
        },
      },
      conversationViewBySession: {
        'session-1': {
          mode: 'anchored',
          activeAnchorMessageId: 'anchor-root',
          newMessagesWhileAnchored: false,
        },
      },
      loadNewerConversation: loadNewerConversationSpy,
    });

    try {
      renderChatPage();

      const scrollViewport = (await screen.findByTestId('right-pane-scroll-viewport')) as HTMLDivElement & {
        scrollHeight: number;
        clientHeight: number;
        scrollTop: number;
        scrollTo: typeof HTMLElement.prototype.scrollTo;
      };
      mockScrollableViewport(scrollViewport, { scrollHeight: 1000, clientHeight: 400, scrollTop: 520 });
      const fireWheelAt = (deltaY: number, timeStamp: number) => {
        const event = new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY });
        Object.defineProperty(event, 'timeStamp', { value: timeStamp });
        fireEvent(scrollViewport, event);
      };

      fireWheelAt(80, 1_000);
      await waitFor(() => {
        expect(loadNewerConversationSpy).toHaveBeenCalledTimes(1);
      });
      await act(async () => Promise.resolve());

      for (let index = 0; index < 3; index += 1) {
        scrollViewport.scrollTop += 12;
        fireEvent.scroll(scrollViewport);
        await flushAnimationFrame();
      }
      expect(loadNewerConversationSpy).toHaveBeenCalledTimes(1);

      fireWheelAt(900, 1_400);
      await waitFor(() => {
        expect(loadNewerConversationSpy).toHaveBeenCalledTimes(2);
      });
      expect(loadNewerConversationSpy).toHaveBeenCalledTimes(2);
    } finally {
      useConversationStore.setState({ loadNewerConversation: originalLoadNewerConversation });
    }
  });

  it('does not reload the conversation snapshot again when the user only scrolls upward', async () => {
    const loadConversationMock = vi.mocked(sessionService.loadConversation);
    useConversationStore.setState({
      historyEnvelopesBySession: {
        'session-1': [
          {
            eventId: 'user-1',
            sessionId: 'session-1',
            requestId: 'req-1',
            sequence: 1,
            eventType: 'REQUEST_ACCEPTED',
            timelineEventRef: null,
            transportHints: ['local-optimistic'],
            payload: {
              content: 'test',
              role: 'USER',
              messageId: 'req-1',
              rootMessageId: 'req-1',
            },
            createdAt: '2026-04-16T08:14:57.000Z',
          },
          {
            eventId: 'assistant-1',
            sessionId: 'session-1',
            requestId: 'req-1',
            sequence: 2,
            eventType: 'LLM_CONTENT_DELTA',
            timelineEventRef: null,
            transportHints: ['SSE'],
            payload: {
              content: 'reply received',
            },
            createdAt: '2026-04-16T08:14:57.100Z',
          },
        ],
      },
      conversationLoadStateBySession: { 'session-1': 'ready' },
    });

    renderChatPage();
    loadConversationMock.mockClear();

    const scrollViewport = (await screen.findByTestId('right-pane-scroll-viewport')) as HTMLDivElement & {
      scrollHeight: number;
      clientHeight: number;
      scrollTop: number;
      scrollTo: typeof HTMLElement.prototype.scrollTo;
    };
    mockScrollableViewport(scrollViewport);

    await act(async () => {
      fireEvent.scroll(scrollViewport);
      scrollViewport.scrollTop = 540;
      fireEvent.wheel(scrollViewport, { deltaY: -30 });
      fireEvent.scroll(scrollViewport);
      await Promise.resolve();
    });

    expect(loadConversationMock).not.toHaveBeenCalled();
  });

  it('does not re-enter bottom-following mode on a second light upward scroll while still near the bottom', async () => {
    useConversationStore.setState({
      historyEnvelopesBySession: {
        'session-1': [
          {
            eventId: 'user-1',
            sessionId: 'session-1',
            requestId: 'req-1',
            sequence: 1,
            eventType: 'REQUEST_ACCEPTED',
            timelineEventRef: null,
            transportHints: ['local-optimistic'],
            payload: {
              content: 'test',
              role: 'USER',
              messageId: 'req-1',
              rootMessageId: 'req-1',
            },
            createdAt: '2026-04-16T08:14:57.000Z',
          },
          {
            eventId: 'assistant-1',
            sessionId: 'session-1',
            requestId: 'req-1',
            sequence: 2,
            eventType: 'LLM_CONTENT_DELTA',
            timelineEventRef: null,
            transportHints: ['SSE'],
            payload: {
              content: 'reply received',
            },
            createdAt: '2026-04-16T08:14:57.100Z',
          },
        ],
      },
      conversationLoadStateBySession: { 'session-1': 'ready' },
    });

    renderChatPage();

    const scrollViewport = (await screen.findByTestId('right-pane-scroll-viewport')) as HTMLDivElement & {
      scrollHeight: number;
      clientHeight: number;
      scrollTop: number;
    };

    mockScrollableViewport(scrollViewport);
    fireEvent.scroll(scrollViewport);

    fireEvent.wheel(scrollViewport, { deltaY: -20 });
    scrollViewport.scrollTop = 570;
    fireEvent.scroll(scrollViewport);
    await flushAnimationFrame();

    expect(screen.getByTestId('chat-scroll-to-bottom-floating')).toBeTruthy();

    fireEvent.wheel(scrollViewport, { deltaY: -20 });
    scrollViewport.scrollTop = 540;
    fireEvent.scroll(scrollViewport);
    await flushAnimationFrame();

    expect(screen.getByTestId('chat-scroll-to-bottom-floating')).toBeTruthy();

    scrollViewport.scrollTop = 600;
    fireEvent.scroll(scrollViewport);
    await flushAnimationFrame();

    expect(screen.queryByTestId('chat-scroll-to-bottom-floating')).toBeNull();
  });

  it('keeps following new stream envelopes after the user clicks the centered jump-to-latest button', async () => {
    const initialEnvelopes: StreamEnvelope[] = [
      {
        eventId: 'user-1',
        sessionId: 'session-1',
        requestId: 'req-1',
        sequence: 1,
        eventType: 'REQUEST_ACCEPTED',
        timelineEventRef: null,
        transportHints: ['local-optimistic'],
        payload: {
          content: 'test',
          role: 'USER',
          messageId: 'req-1',
          rootMessageId: 'req-1',
        },
        createdAt: '2026-04-16T08:14:57.000Z',
      },
      {
        eventId: 'assistant-1',
        sessionId: 'session-1',
        requestId: 'req-1',
        sequence: 2,
        eventType: 'LLM_CONTENT_DELTA',
        timelineEventRef: null,
        transportHints: ['SSE'],
        payload: {
          content: 'first reply',
        },
        createdAt: '2026-04-16T08:14:57.100Z',
      },
    ];

    useConversationStore.setState({
      historyEnvelopesBySession: {
        'session-1': initialEnvelopes,
      },
      conversationLoadStateBySession: { 'session-1': 'ready' },
    });

    const originalRequestAnimationFrame = globalThis.requestAnimationFrame;
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    });

    renderChatPage();

    const scrollViewport = (await screen.findByTestId('right-pane-scroll-viewport')) as HTMLDivElement & {
      scrollHeight: number;
      clientHeight: number;
      scrollTop: number;
    };

    mockScrollableViewport(scrollViewport);
    fireEvent.scroll(scrollViewport);

    scrollViewport.scrollTop = 540;
    fireEvent.wheel(scrollViewport, { deltaY: -30 });
    fireEvent.scroll(scrollViewport);
    await flushAnimationFrame();
    fireEvent.click(screen.getByTestId('chat-scroll-to-bottom-floating'));

    expect(screen.queryByTestId('chat-scroll-to-bottom-floating')).toBeNull();
    expect(scrollViewport.scrollTop).toBe(1000);

    Object.defineProperty(scrollViewport, 'scrollHeight', { value: 1160, writable: true, configurable: true });

    await act(async () => {
      useConversationStore.setState({
        historyEnvelopesBySession: {
          'session-1': [
            ...initialEnvelopes,
            {
              eventId: 'assistant-2',
              sessionId: 'session-1',
              requestId: 'req-1',
              sequence: 3,
              eventType: 'LLM_CONTENT_DELTA',
              timelineEventRef: null,
              transportHints: ['SSE'],
              payload: {
                content: 'second reply',
              },
              createdAt: '2026-04-16T08:14:57.200Z',
            },
          ],
        },
      });
    });

    expect(scrollViewport.scrollTop).toBe(1160);
    globalThis.requestAnimationFrame = originalRequestAnimationFrame;
  });

  it('preserves the reading anchor when process details are manually toggled away from the bottom', async () => {
    const originalGetBoundingClientRect = HTMLElement.prototype.getBoundingClientRect;
    const originalRequestAnimationFrame = globalThis.requestAnimationFrame;
    let summaryCallCount = 0;

    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    });

    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      if (this.dataset.testid === 'turn-process-summary') {
        summaryCallCount += 1;
        return {
          x: 0,
          y: summaryCallCount === 1 ? 200 : 164,
          top: summaryCallCount === 1 ? 200 : 164,
          left: 0,
          bottom: summaryCallCount === 1 ? 220 : 184,
          right: 200,
          width: 200,
          height: 20,
          toJSON: () => ({}),
        } as DOMRect;
      }
      return originalGetBoundingClientRect.call(this);
    });

    useConversationStore.setState({
      historyEnvelopesBySession: {
        'session-1': [
          {
            eventId: 'user-1',
            sessionId: 'session-1',
            requestId: 'req-1',
            sequence: 1,
            eventType: 'REQUEST_ACCEPTED',
            timelineEventRef: null,
            transportHints: ['local-optimistic'],
            payload: {
              content: 'test',
              role: 'USER',
              messageId: 'req-1',
              rootMessageId: 'req-1',
            },
            createdAt: '2026-04-16T08:14:57.000Z',
          },
          {
            eventId: 'thinking-1',
            sessionId: 'session-1',
            requestId: 'req-1',
            sequence: 2,
            eventType: 'LLM_THINKING_DELTA',
            timelineEventRef: null,
            transportHints: ['SSE'],
            payload: {
              content: 'building answer...',
            },
            createdAt: '2026-04-16T08:14:57.050Z',
          },
        ],
      },
      conversationLoadStateBySession: { 'session-1': 'ready' },
    });

    renderChatPage();

    const scrollViewport = (await screen.findByTestId('right-pane-scroll-viewport')) as HTMLDivElement & {
      scrollHeight: number;
      clientHeight: number;
      scrollTop: number;
      scrollTo: typeof HTMLElement.prototype.scrollTo;
    };
    mockScrollableViewport(scrollViewport);
    fireEvent.scroll(scrollViewport);
    scrollViewport.scrollTop = 250;
    fireEvent.scroll(scrollViewport);
    await flushAnimationFrame();
    fireEvent.click(screen.getByTestId('turn-process-toggle'));

    expect(scrollViewport.scrollTop).toBe(214);

    HTMLElement.prototype.getBoundingClientRect = originalGetBoundingClientRect;
    globalThis.requestAnimationFrame = originalRequestAnimationFrame;
  });

  it('keeps a newly sent optimistic turn after older canceled history in the rendered order', async () => {
    useSessionStore.setState({
      sessions: [
        {
          sessionId: 'session-1',
          displayTitle: 'Session 1',
          lastActivityAt: '2026-04-16T08:14:57.400Z',
        },
      ],
    });
    useConversationStore.setState({
      historyEnvelopesBySession: {
        'session-1': [
          {
            eventId: 'old-user',
            sessionId: 'session-1',
            requestId: 'req-old',
            sequence: 10,
            eventType: 'REQUEST_ACCEPTED',
            timelineEventRef: null,
            transportHints: [],
            payload: {
              content: 'old question',
              role: 'USER',
              messageId: 'req-old',
              rootMessageId: 'req-old',
            },
            createdAt: '2026-04-16T08:14:57.000Z',
          },
          {
            eventId: 'old-partial',
            sessionId: 'session-1',
            requestId: 'req-old',
            sequence: 11,
            eventType: 'LLM_CONTENT_DELTA',
            timelineEventRef: null,
            transportHints: [],
            payload: {
              content: 'partial before cancel',
              rootMessageId: 'req-old',
            },
            createdAt: '2026-04-16T08:14:57.100Z',
          },
          {
            eventId: 'old-cancel',
            sessionId: 'session-1',
            requestId: 'req-old',
            sequence: 12,
            eventType: 'REQUEST_CANCELED',
            timelineEventRef: null,
            transportHints: [],
            payload: {},
            createdAt: '2026-04-16T08:14:57.200Z',
          },
          {
            eventId: 'new-user',
            sessionId: 'session-1',
            requestId: 'req-new',
            sequence: 0,
            eventType: 'REQUEST_ACCEPTED',
            timelineEventRef: null,
            transportHints: ['local-optimistic'],
            payload: {
              content: 'new question',
              role: 'USER',
              messageId: 'req-new',
              rootMessageId: 'req-new',
            },
            createdAt: '2026-04-16T08:14:57.300Z',
          },
        ],
      },
      conversationLoadStateBySession: { 'session-1': 'ready' },
    });

    renderChatPage();

    await waitFor(() => {
      expect(screen.getAllByTestId('turn-block')).toHaveLength(2);
    });

    const renderedTurns = screen.getAllByTestId('turn-block');
    expect(renderedTurns[0]?.getAttribute('data-root-message-id')).toBe('req-old');
    expect(renderedTurns[1]?.getAttribute('data-root-message-id')).toBe('req-new');
  });
  it('surfaces the retry limit notice as a warning message and clears it', async () => {
    const warningSpy = vi.spyOn(antdMessage, 'warning');
    useRequestStore.setState({
      retryLimitNotice: {
        level: 'warning',
        message: '当前系统仅支持最多5次的重试',
      },
    });

    renderChatPage();

    await waitFor(() => {
      expect(warningSpy).toHaveBeenCalledWith('当前系统仅支持最多5次的重试');
    });
    expect(useRequestStore.getState().retryLimitNotice).toBeNull();
    warningSpy.mockRestore();
  });

  it('lets the PIU conversation pane fill the host panel while the shared expand panel is open', () => {
    expandPanelStore.getState().setView(<div data-testid="expand-panel-view" />);
    expandPanelStore.getState().open();

    render(
      <AppProviders mode="piu">
        <ChatPageCore
          onOpenHelp={() => {}}
          navigation={{
            sessionId: null,
            openSession: () => {},
            openNewSession: () => {},
          }}
        />
      </AppProviders>,
    );

    const conversationPane = screen.getByTestId('chat-conversation-pane');
    expect(conversationPane.style.flex).toBe('1 1 auto');
    expect(conversationPane.style.minWidth).toBe('0px');
    expect(screen.queryByTestId('expand-panel-region')).toBeNull();
  });

  it('keeps the local conversation pane at the base width while the expand panel is open', () => {
    expandPanelStore.getState().setView(<div data-testid="expand-panel-view" />);
    expandPanelStore.getState().open();

    render(
      <AppProviders mode="local">
        <ChatPageCore
          onOpenHelp={() => {}}
          navigation={{
            sessionId: null,
            openSession: () => {},
            openNewSession: () => {},
          }}
        />
      </AppProviders>,
    );

    const conversationPane = screen.getByTestId('chat-conversation-pane');
    expect(conversationPane.style.flex).toBe('0 0 484px');
    expect(conversationPane.style.minWidth).toBe('484px');
    expect(screen.getByTestId('expand-panel-region')).toBeTruthy();
  });

  it('does not center content when replay content is present even without an active session', () => {
    render(
      <AppProviders mode="local">
        <ChatPageCore
          onOpenHelp={() => {}}
          navigation={{
            sessionId: null,
            openSession: () => {},
            openNewSession: () => {},
          }}
          aboveMessagesSlot={<div data-testid="replay-content">replay</div>}
        />
      </AppProviders>,
    );
    const contentColumn = screen.getByTestId('right-pane-content-column');
    expect(contentColumn.className).not.toContain('right-pane-content-column--centered');
  });

  it('auto-scrolls to bottom when replay content appears', async () => {
    const originalRequestAnimationFrame = globalThis.requestAnimationFrame;
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    });

    try {
      const { rerender } = render(
        <AppProviders mode="local">
          <ChatPageCore
            onOpenHelp={() => {}}
            navigation={{
              sessionId: null,
              openSession: () => {},
              openNewSession: () => {},
            }}
          />
        </AppProviders>,
      );

      const scrollViewport = (await screen.findByTestId('right-pane-scroll-viewport')) as HTMLDivElement & {
        scrollHeight: number;
        clientHeight: number;
        scrollTop: number;
        scrollTo: typeof HTMLElement.prototype.scrollTo;
      };
      mockScrollableViewport(scrollViewport, { scrollHeight: 1000, clientHeight: 400, scrollTop: 0 });

      rerender(
        <AppProviders mode="local">
          <ChatPageCore
            onOpenHelp={() => {}}
            navigation={{
              sessionId: null,
              openSession: () => {},
              openNewSession: () => {},
            }}
            aboveMessagesSlot={<div data-testid="replay-content">replay</div>}
          />
        </AppProviders>,
      );

      expect(scrollViewport.scrollTop).toBe(1000);
    } finally {
      globalThis.requestAnimationFrame = originalRequestAnimationFrame;
    }
  });
});
