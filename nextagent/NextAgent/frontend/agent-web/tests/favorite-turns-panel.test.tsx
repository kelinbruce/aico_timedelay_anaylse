// @vitest-environment jsdom
import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { message } from 'antd';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithAppProviders as render } from './renderWithAppProviders.tsx';
import { FavoriteTurnsPanel } from '../src/features/favorites/components/FavoriteTurnsPanel.tsx';
import i18n from '../src/i18n/index.ts';
import type { FavoriteTurnEntry, FavoriteTurnPage } from '../src/services/annotationService.ts';
import type {
  NonCapabilityStreamEnvelope,
  SessionConversationMessage,
  SessionConversationPage,
  SessionRunEventHistoryPage,
} from '../src/state/contracts.ts';

const favoritesUpdatedEvent = vi.hoisted(() => 'nextagent:favorites-updated');
const listFavoriteTurnsMock = vi.hoisted(() => vi.fn());
const upsertAnnotationMock = vi.hoisted(() => vi.fn());
const loadConversationMock = vi.hoisted(() => vi.fn());
const loadRunEventsMock = vi.hoisted(() => vi.fn());
const useUserOpsMock = vi.hoisted(() => vi.fn());
vi.mock('../src/services/annotationService.ts', () => ({
  FAVORITES_UPDATED_EVENT: favoritesUpdatedEvent,
  annotationService: {
    listFavoriteTurns: listFavoriteTurnsMock,
    upsertAnnotation: upsertAnnotationMock,
  },
}));

vi.mock('../src/services/sessionService.ts', () => ({
  sessionService: {
    loadConversation: loadConversationMock,
    loadRunEvents: loadRunEventsMock,
  },
}));

vi.mock('../src/features/auth/useUserOps.ts', () => ({
  useUserOps: useUserOpsMock,
}));

function favorite(index: number, overrides: Partial<FavoriteTurnEntry> = {}): FavoriteTurnEntry {
  return {
    sessionId: `session-${index}`,
    requestRunId: `run-${index}`,
    rootMessageId: `message-${index}`,
    questionPreview: `Favorite question ${index}`,
    questionTruncated: false,
    sessionTitle: `Session ${index}`,
    sessionUpdatedAt: Date.UTC(2026, 6, index),
    favoritedAt: Date.UTC(2026, 6, index),
    ...overrides,
  };
}

function page(entries: readonly FavoriteTurnEntry[], hasMore = false): FavoriteTurnPage {
  return { entries, offset: 0, limit: 20, hasMore };
}

function conversationMessage(
  entry: FavoriteTurnEntry,
  role: 'USER' | 'ASSISTANT' | 'SUMMARY',
  content: string,
  sequence: number,
): SessionConversationMessage {
  return {
    messageId: `${entry.rootMessageId}-${role.toLowerCase()}-${sequence}`,
    sessionId: entry.sessionId,
    requestId: entry.requestRunId,
    rootMessageId: entry.rootMessageId,
    role,
    sequence,
    content,
    contentType: 'PLAIN_TEXT',
    metadata: {},
    createdAt: Date.UTC(2026, 6, 29, 6, 10, sequence),
    visible: true,
  };
}

function conversationPage(entry: FavoriteTurnEntry, items?: readonly SessionConversationMessage[]): SessionConversationPage {
  return {
    sessionId: entry.sessionId,
    items: items ?? [
      conversationMessage(entry, 'USER', entry.questionPreview, 1),
      conversationMessage(entry, 'ASSISTANT', `Answer for ${entry.questionPreview}`, 2),
    ],
    nextCursor: null,
    newerCursor: null,
  };
}

function runEvent(
  entry: FavoriteTurnEntry,
  eventId: string,
  sequence: number,
  eventType: NonCapabilityStreamEnvelope['eventType'],
  payload: NonCapabilityStreamEnvelope['payload'],
): NonCapabilityStreamEnvelope {
  return {
    eventId,
    sessionId: entry.sessionId,
    requestId: entry.requestRunId,
    runId: entry.requestRunId,
    rootMessageId: entry.rootMessageId,
    sequence,
    eventType,
    timelineEventRef: `timeline-${eventId}`,
    transportHints: ['history-load'],
    payload,
    createdAt: `2026-07-29T06:10:${String(sequence).padStart(2, '0')}.000Z`,
  };
}

function runEventsPage(
  entry: FavoriteTurnEntry,
  options: { readonly userContent?: string; readonly answerContent?: string } = {},
): SessionRunEventHistoryPage {
  return {
    availability: 'AVAILABLE',
    events: [
      runEvent(entry, `user-${entry.requestRunId}`, 1, 'USER_INPUT_RECEIVED', {
        role: 'USER',
        content: options.userContent ?? entry.questionPreview,
        messageId: entry.rootMessageId,
      }),
      runEvent(entry, `answer-${entry.requestRunId}`, 2, 'LLM_CONTENT_DELTA', {
        role: 'ASSISTANT',
        content: options.answerContent ?? `Answer for ${entry.questionPreview}`,
      }),
      runEvent(entry, `complete-${entry.requestRunId}`, 3, 'REQUEST_COMPLETED', {}),
    ],
  };
}

function renderPanel(
  options: {
    readonly onOpenFavorite?: (sessionId: string, rootMessageId: string) => void;
  } = {},
) {
  return render(<FavoriteTurnsPanel onOpenFavorite={options.onOpenFavorite ?? vi.fn()} />);
}

async function expandFavorite(title: string): Promise<void> {
  fireEvent.click(await screen.findByRole('button', { name: title }));
}

describe('FavoriteTurnsPanel', () => {
  beforeEach(() => {
    listFavoriteTurnsMock.mockReset();
    upsertAnnotationMock.mockReset();
    loadConversationMock.mockReset();
    loadRunEventsMock.mockReset();
    useUserOpsMock.mockReset();
    useUserOpsMock.mockReturnValue(null);
  });

  afterEach(async () => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    await i18n.changeLanguage('zh-CN');
  });

  it('uses the unified contained header and layout-owned scroll while keeping session cards collapsed', async () => {
    listFavoriteTurnsMock.mockResolvedValue(page([favorite(1)]));

    renderPanel();

    expect(screen.getByTestId('page-layout-header')).toBeTruthy();
    expect(screen.getByTestId('page-layout-title').textContent).toBe('收藏列表');
    expect(screen.getByTestId('page-layout-content-frame').dataset.contentWidth).toBe('contained');
    expect(screen.getByTestId('page-layout-main').className).toContain('page-layout__main--layout');
    expect(screen.getByTestId('page-layout-scroll-viewport')).toBeTruthy();
    expect(screen.getByRole('heading', { name: '收藏列表', level: 1 })).toBeTruthy();
    expect(screen.getByRole('tab', { name: '收藏对话' }).getAttribute('aria-selected')).toBe('true');
    expect(screen.getByRole('tab', { name: '收藏问题' }).getAttribute('aria-selected')).toBe('false');
    expect(screen.getByPlaceholderText('搜索收藏对话')).toBeTruthy();
    expect(screen.getByRole('button', { name: '选择收藏日期' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: '返回之前的会话' })).toBeNull();

    expect(await screen.findByText('Session 1')).toBeTruthy();
    const favoritePanelTitle = screen.getByRole('button', { name: 'Favorite question 1' });
    expect(favoritePanelTitle.getAttribute('aria-expanded')).toBe('false');
    expect(screen.getByTestId('favorite-turn-card-session-1-run-1')).toBeTruthy();
    expect(document.querySelector('.favorite-turn-panel-body')).toBeNull();
  });

  it('shows favorite turn timestamps as YYYY-MM-DD HH:mm:ss', async () => {
    listFavoriteTurnsMock.mockResolvedValue(page([favorite(1, { favoritedAt: Date.UTC(2026, 7, 21, 1, 35, 0) })]));

    renderPanel();

    expect(await screen.findByText('2026-08-21 09:35:00')).toBeTruthy();
  });

  it('uses the shared favorites list page name in English', async () => {
    listFavoriteTurnsMock.mockResolvedValue(page([]));
    await i18n.changeLanguage('en-US');

    renderPanel();

    expect(screen.getByRole('heading', { name: 'Favorites List', level: 1 })).toBeTruthy();
    expect(screen.getByTestId('favorite-turns-panel').getAttribute('aria-label')).toBe('Favorites List');
    expect(screen.getByRole('tablist', { name: 'Favorites List' })).toBeTruthy();
    expect(screen.getByPlaceholderText('Search favorite conversations')).toBeTruthy();
  });

  it('switches to question favorites with the current filter and cancels only the question favorite', async () => {
    const answerEntry = favorite(1, { sessionTitle: 'Answer session' });
    const questionEntry = favorite(2, { sessionTitle: 'Question session' });
    listFavoriteTurnsMock.mockImplementation(
      (_offset: number, _limit: number, filter?: { readonly favoriteType?: 'ANSWER' | 'QUESTION'; readonly keyword?: string }) =>
        Promise.resolve(page(filter?.favoriteType === 'QUESTION' ? [questionEntry] : [answerEntry])),
    );
    loadConversationMock.mockResolvedValue(conversationPage(questionEntry));
    upsertAnnotationMock.mockResolvedValue({ sentiment: null, isFavorited: false, isQuestionFavorited: false });
    renderPanel();
    await screen.findByText('Answer session');

    fireEvent.change(screen.getByPlaceholderText('搜索收藏对话'), { target: { value: 'network' } });
    fireEvent.keyDown(screen.getByPlaceholderText('搜索收藏对话'), { key: 'Enter', code: 'Enter' });
    await waitFor(() =>
      expect(listFavoriteTurnsMock).toHaveBeenLastCalledWith(0, expect.any(Number), { favoriteType: 'ANSWER', keyword: 'network' }),
    );

    fireEvent.click(screen.getByRole('tab', { name: '收藏问题' }));
    expect(screen.queryByText('Question session')).toBeNull();
    expect(await screen.findByText('Favorite question 2')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Favorite question 2' })).toBeNull();
    expect(screen.getByPlaceholderText('搜索收藏问题')).toBeTruthy();
    expect(screen.queryByText('Answer session')).toBeNull();
    expect(listFavoriteTurnsMock).toHaveBeenLastCalledWith(0, expect.any(Number), { favoriteType: 'QUESTION', keyword: 'network' });

    fireEvent.click(await screen.findByRole('button', { name: '取消收藏：Favorite question 2' }));
    fireEvent.click(await screen.findByRole('button', { name: /确\s*认/ }));

    await waitFor(() => expect(upsertAnnotationMock).toHaveBeenCalledWith({ sessionId: 'session-2', runId: 'run-2', isQuestionFavorited: false }));
  });

  it('groups favorites by session and filters them only after search is submitted', async () => {
    const alpha = favorite(1, { sessionId: 'session-a', sessionTitle: 'Alpha session' });
    const alphaSecond = favorite(2, { sessionId: 'session-a', sessionTitle: 'Alpha session' });
    const beta = favorite(3, { sessionId: 'session-b', sessionTitle: 'Beta session' });
    listFavoriteTurnsMock.mockImplementation((_offset: number, _limit: number, filter?: { readonly keyword?: string }) =>
      Promise.resolve(page(filter?.keyword === 'Beta' ? [beta] : [alpha, alphaSecond, beta])),
    );
    const { container } = renderPanel();
    expect(await screen.findAllByRole('article')).toHaveLength(2);

    const search = screen.getByPlaceholderText('搜索收藏对话');
    fireEvent.change(search, { target: { value: 'Beta' } });
    expect(screen.getByText('Alpha session')).toBeTruthy();
    fireEvent.keyDown(search, { key: 'Enter', code: 'Enter' });

    await waitFor(() => {
      expect(screen.queryByText('Alpha session')).toBeNull();
      expect(screen.getByText('Beta session')).toBeTruthy();
    });
    expect(listFavoriteTurnsMock).toHaveBeenLastCalledWith(0, expect.any(Number), { favoriteType: 'ANSWER', keyword: 'Beta' });

    fireEvent.click(container.querySelector('.ant-input-clear-icon')!);
    expect(await screen.findByText('Alpha session')).toBeTruthy();
    expect(listFavoriteTurnsMock).toHaveBeenLastCalledWith(0, expect.any(Number), { favoriteType: 'ANSWER' });
  });

  it('shows start, end, and reset controls before opening a concrete date picker', async () => {
    listFavoriteTurnsMock.mockResolvedValue(page([]));
    renderPanel();

    fireEvent.click(screen.getByRole('button', { name: '选择收藏日期' }));

    expect(await screen.findByPlaceholderText('开始日期')).toBeTruthy();
    expect(screen.getByPlaceholderText('结束日期')).toBeTruthy();
    expect(screen.getByRole('button', { name: '重置' })).toBeTruthy();
  });

  it('clears either selected date independently and reloads with the remaining server filter', async () => {
    listFavoriteTurnsMock.mockResolvedValue(page([]));
    renderPanel();

    fireEvent.click(screen.getByRole('button', { name: '选择收藏日期' }));
    const startInput = await screen.findByPlaceholderText('开始日期');
    fireEvent.focus(startInput);
    fireEvent.change(startInput, { target: { value: '2026-08-01 08:00:00' } });
    fireEvent.keyDown(startInput, { key: 'Enter', code: 'Enter' });
    await waitFor(() => {
      expect(listFavoriteTurnsMock).toHaveBeenLastCalledWith(0, expect.any(Number), expect.objectContaining({ favoritedFrom: expect.any(Number) }));
    });

    const endInput = screen.getByPlaceholderText('结束日期');
    fireEvent.focus(endInput);
    fireEvent.change(endInput, { target: { value: '2026-08-02 18:00:00' } });
    fireEvent.keyDown(endInput, { key: 'Enter', code: 'Enter' });
    await waitFor(() => {
      expect(listFavoriteTurnsMock).toHaveBeenLastCalledWith(
        0,
        expect.any(Number),
        expect.objectContaining({ favoritedFrom: expect.any(Number), favoritedTo: expect.any(Number) }),
      );
    });

    expect(screen.getByRole('button', { name: '清除开始日期' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '清除结束日期' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '清除开始日期' }));

    await waitFor(() => {
      expect(listFavoriteTurnsMock).toHaveBeenLastCalledWith(
        0,
        expect.any(Number),
        expect.not.objectContaining({ favoritedFrom: expect.anything() }),
      );
    });
    expect(listFavoriteTurnsMock).toHaveBeenLastCalledWith(0, expect.any(Number), expect.objectContaining({ favoritedTo: expect.any(Number) }));
    expect(screen.queryByRole('button', { name: '清除开始日期' })).toBeNull();
    expect(screen.getByRole('button', { name: '清除结束日期' })).toBeTruthy();
  });

  it('rejects a start date later than the already-selected end date', async () => {
    listFavoriteTurnsMock.mockResolvedValue(page([]));
    renderPanel();

    fireEvent.click(screen.getByRole('button', { name: '选择收藏日期' }));
    const endInput = await screen.findByPlaceholderText('结束日期');
    fireEvent.focus(endInput);
    fireEvent.change(endInput, { target: { value: '2026-08-02 18:00:00' } });
    fireEvent.keyDown(endInput, { key: 'Enter', code: 'Enter' });
    await waitFor(() => {
      expect(listFavoriteTurnsMock).toHaveBeenLastCalledWith(0, expect.any(Number), expect.objectContaining({ favoritedTo: expect.any(Number) }));
    });

    const startInput = screen.getByPlaceholderText('开始日期');
    fireEvent.focus(startInput);
    fireEvent.change(startInput, { target: { value: '2026-08-03 08:00:00' } });
    fireEvent.keyDown(startInput, { key: 'Enter', code: 'Enter' });

    // The start date is after the end date, so onChange should be rejected
    // and the filter should remain unchanged (only favoritedTo, no favoritedFrom).
    await waitFor(() => {
      expect(listFavoriteTurnsMock).toHaveBeenLastCalledWith(
        0,
        expect.any(Number),
        expect.not.objectContaining({ favoritedFrom: expect.anything() }),
      );
    });
  });

  it('rejects an end date earlier than the already-selected start date', async () => {
    listFavoriteTurnsMock.mockResolvedValue(page([]));
    renderPanel();

    fireEvent.click(screen.getByRole('button', { name: '选择收藏日期' }));
    const startInput = await screen.findByPlaceholderText('开始日期');
    fireEvent.focus(startInput);
    fireEvent.change(startInput, { target: { value: '2026-08-05 08:00:00' } });
    fireEvent.keyDown(startInput, { key: 'Enter', code: 'Enter' });
    await waitFor(() => {
      expect(listFavoriteTurnsMock).toHaveBeenLastCalledWith(0, expect.any(Number), expect.objectContaining({ favoritedFrom: expect.any(Number) }));
    });

    const endInput = screen.getByPlaceholderText('结束日期');
    fireEvent.focus(endInput);
    fireEvent.change(endInput, { target: { value: '2026-08-03 18:00:00' } });
    fireEvent.keyDown(endInput, { key: 'Enter', code: 'Enter' });

    // The end date is before the start date, so onChange should be rejected
    // and the filter should remain unchanged (only favoritedFrom, no favoritedTo).
    await waitFor(() => {
      expect(listFavoriteTurnsMock).toHaveBeenLastCalledWith(0, expect.any(Number), expect.not.objectContaining({ favoritedTo: expect.anything() }));
    });
  });

  it('rejects a future start date', async () => {
    listFavoriteTurnsMock.mockResolvedValue(page([]));
    renderPanel();

    fireEvent.click(screen.getByRole('button', { name: '选择收藏日期' }));
    const startInput = await screen.findByPlaceholderText('开始日期');
    fireEvent.focus(startInput);
    fireEvent.change(startInput, { target: { value: '2027-01-01 08:00:00' } });
    fireEvent.keyDown(startInput, { key: 'Enter', code: 'Enter' });

    // Future date should be rejected; filter should remain without favoritedFrom.
    await waitFor(() => {
      expect(listFavoriteTurnsMock).toHaveBeenLastCalledWith(
        0,
        expect.any(Number),
        expect.not.objectContaining({ favoritedFrom: expect.anything() }),
      );
    });
  });

  it('rejects a future end date', async () => {
    listFavoriteTurnsMock.mockResolvedValue(page([]));
    renderPanel();

    fireEvent.click(screen.getByRole('button', { name: '选择收藏日期' }));
    const endInput = await screen.findByPlaceholderText('结束日期');
    fireEvent.focus(endInput);
    fireEvent.change(endInput, { target: { value: '2027-01-01 18:00:00' } });
    fireEvent.keyDown(endInput, { key: 'Enter', code: 'Enter' });

    // Future date should be rejected; filter should remain without favoritedTo.
    await waitFor(() => {
      expect(listFavoriteTurnsMock).toHaveBeenLastCalledWith(0, expect.any(Number), expect.not.objectContaining({ favoritedTo: expect.anything() }));
    });
  });

  it('loads and displays the complete anchored user and assistant content when expanded', async () => {
    const entry = favorite(1, { sessionTitle: 'Network session' });
    const onOpenFavorite = vi.fn();
    listFavoriteTurnsMock.mockResolvedValue(page([entry]));
    loadRunEventsMock.mockResolvedValue(
      runEventsPage(entry, {
        userContent: '181SE2980 network question',
        answerContent: '任务规划\n\n子任务拆解\n\n查询完成',
      }),
    );
    renderPanel({ onOpenFavorite });

    await expandFavorite('Favorite question 1');

    expect((await screen.findAllByText('181SE2980 network question')).length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('任务规划')).toBeTruthy();
    expect(screen.getByText('子任务拆解')).toBeTruthy();
    expect(screen.getByText('查询完成')).toBeTruthy();
    expect(loadRunEventsMock).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: entry.sessionId,
        runId: entry.requestRunId,
        afterSequence: 0,
        limit: 1000,
        signal: expect.any(AbortSignal),
      }),
    );

    fireEvent.click(screen.getByRole('button', { name: '打开收藏会话' }));
    expect(onOpenFavorite).toHaveBeenCalledWith('session-1', 'message-1');
  });

  it('loads every currently loaded favorite turn in an expanded session', async () => {
    const first = favorite(1, { sessionId: 'session-a', sessionTitle: 'Session A' });
    const second = favorite(2, { sessionId: 'session-a', sessionTitle: 'Session A' });
    listFavoriteTurnsMock.mockResolvedValue(page([first, second]));
    loadRunEventsMock.mockImplementation(({ runId }: { readonly runId: string }) =>
      Promise.resolve(runEventsPage(runId === first.requestRunId ? first : second)),
    );
    renderPanel();

    await expandFavorite('Favorite question 1');
    expect(await screen.findByText('Answer for Favorite question 1')).toBeTruthy();
    await expandFavorite('Favorite question 2');
    expect(await screen.findByText('Answer for Favorite question 2')).toBeTruthy();
    expect(screen.queryByText('Answer for Favorite question 1')).toBeNull();
    expect(document.querySelectorAll('.favorite-turn-panel-body')).toHaveLength(1);
  });

  it('retries an anchored conversation read without exposing its raw failure', async () => {
    const entry = favorite(1);
    listFavoriteTurnsMock.mockResolvedValue(page([entry]));
    loadRunEventsMock.mockRejectedValueOnce(new Error('raw backend detail')).mockResolvedValueOnce(runEventsPage(entry));
    renderPanel();

    await expandFavorite('Favorite question 1');
    expect(await screen.findByText('收藏对话加载失败，请重试')).toBeTruthy();
    expect(screen.queryByText('raw backend detail')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '重试' }));
    expect(await screen.findByText('Answer for Favorite question 1')).toBeTruthy();
  });

  it('requires confirmation before removing a favorite and reports success', async () => {
    const entry = favorite(1);
    const onOpenFavorite = vi.fn();
    const successMessage = vi.spyOn(message, 'success');
    listFavoriteTurnsMock.mockResolvedValue(page([entry]));
    loadRunEventsMock.mockResolvedValue(runEventsPage(entry));
    upsertAnnotationMock.mockResolvedValue({ sentiment: null, isFavorited: false });
    renderPanel({ onOpenFavorite });
    await expandFavorite('Favorite question 1');
    await screen.findByRole('button', { name: '取消收藏：Favorite question 1' });

    fireEvent.click(screen.getByRole('button', { name: '取消收藏：Favorite question 1' }));
    expect(await screen.findByText('您确定要取消收藏该对话吗？')).toBeTruthy();
    fireEvent.click(within(screen.getByRole('tooltip')).getAllByRole('button').at(-2)!);
    expect(upsertAnnotationMock).not.toHaveBeenCalled();
    expect(onOpenFavorite).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: '取消收藏：Favorite question 1' }));
    fireEvent.click(await screen.findByRole('button', { name: /确\s*认/ }));
    await waitFor(() => expect(screen.queryByRole('article')).toBeNull());
    expect(upsertAnnotationMock).toHaveBeenCalledWith({ sessionId: 'session-1', runId: 'run-1', isFavorited: false });
    expect(successMessage).toHaveBeenCalledWith('已取消收藏');
  }, 10_000);

  it('keeps the favorite and shows safe feedback when confirmed cancellation fails', async () => {
    const entry = favorite(1);
    listFavoriteTurnsMock.mockResolvedValue(page([entry]));
    loadRunEventsMock.mockResolvedValue(runEventsPage(entry));
    upsertAnnotationMock.mockRejectedValue(new Error('raw backend detail'));
    renderPanel();
    await expandFavorite('Favorite question 1');
    await screen.findByRole('button', { name: '取消收藏：Favorite question 1' });

    fireEvent.click(screen.getByRole('button', { name: '取消收藏：Favorite question 1' }));
    fireEvent.click(await screen.findByRole('button', { name: /确\s*认/ }));

    expect(await screen.findByTestId('favorite-turns-remove-error-run-1')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Favorite question 1' })).toBeTruthy();
    expect(screen.queryByText('raw backend detail')).toBeNull();
  });

  it('disables cancellation when the remote user lacks write permission', async () => {
    const entry = favorite(1);
    useUserOpsMock.mockReturnValue(['AICOService.View']);
    listFavoriteTurnsMock.mockResolvedValue(page([entry]));
    loadRunEventsMock.mockResolvedValue(runEventsPage(entry));
    renderPanel();
    await expandFavorite('Favorite question 1');
    await screen.findByRole('button', { name: '取消收藏：Favorite question 1' });

    expect((screen.getByRole('button', { name: '取消收藏：Favorite question 1' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('disables batch removal when the remote user lacks write permission', async () => {
    const entry = favorite(1);
    useUserOpsMock.mockReturnValue(['AICOService.View']);
    listFavoriteTurnsMock.mockResolvedValue(page([entry]));
    renderPanel();

    const batchButton = await screen.findByRole('button', { name: '批量取消收藏' });
    expect((batchButton as HTMLButtonElement).disabled).toBe(true);
    expect(upsertAnnotationMock).not.toHaveBeenCalled();
  });

  it('shows empty and filtered-empty states without projecting session history', async () => {
    listFavoriteTurnsMock.mockResolvedValue(page([]));
    const firstRender = renderPanel();
    expect(await screen.findByTestId('favorite-turns-empty')).toBeTruthy();
    firstRender.unmount();

    listFavoriteTurnsMock.mockImplementation((_offset: number, _limit: number, filter?: { readonly keyword?: string }) =>
      Promise.resolve(page(filter?.keyword ? [] : [favorite(1)])),
    );
    renderPanel();
    await screen.findByText('Session 1');
    fireEvent.change(screen.getByPlaceholderText('搜索收藏对话'), { target: { value: 'missing' } });
    fireEvent.keyDown(screen.getByPlaceholderText('搜索收藏对话'), { key: 'Enter', code: 'Enter' });
    expect(await screen.findByTestId('favorite-turns-no-matches')).toBeTruthy();
    expect(screen.queryByTestId('sidebar-session-list')).toBeNull();
  });

  it('keeps the panel mounted and retries the first window after a read failure', async () => {
    listFavoriteTurnsMock.mockRejectedValueOnce(new Error('raw backend detail')).mockResolvedValueOnce(page([favorite(2)]));
    renderPanel();

    expect(await screen.findByTestId('favorite-turns-error')).toBeTruthy();
    expect(screen.queryByText('raw backend detail')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '重试' }));
    expect(await screen.findByText('Session 2')).toBeTruthy();
    expect(listFavoriteTurnsMock).toHaveBeenNthCalledWith(2, 0, expect.any(Number), { favoriteType: 'ANSWER' });
  });

  it('paginates complete results by session with fifteen collapsed groups per page', async () => {
    const entries = Array.from({ length: 16 }, (_, index) => favorite(index + 1));
    listFavoriteTurnsMock.mockResolvedValue(page(entries));
    renderPanel();

    expect(await screen.findAllByRole('article')).toHaveLength(15);
    expect(screen.getByText('Session 15')).toBeTruthy();
    expect(screen.queryByText('Session 16')).toBeNull();
    expect(screen.queryByTestId('favorite-turns-pagination-sentinel')).toBeNull();
    expect(screen.getByTestId('favorite-turns-scroll').className).toContain('favorite-turns-scroll-collapsed');
    expect(listFavoriteTurnsMock).toHaveBeenCalledWith(0, 100, { favoriteType: 'ANSWER' });

    fireEvent.click(screen.getByTitle('2'));
    expect(await screen.findByText('Session 16')).toBeTruthy();
    expect(screen.getAllByRole('article')).toHaveLength(1);
    expect(screen.queryByText('Session 1')).toBeNull();
  });

  it('renders assistant answers with the same markdown component as conversation cards', async () => {
    const entry = favorite(1);
    listFavoriteTurnsMock.mockResolvedValue(page([entry]));
    loadRunEventsMock.mockResolvedValue(
      runEventsPage(entry, {
        userContent: '**plain user question**',
        answerContent: '**ABCF result**\n\n- first item\n- second item',
      }),
    );
    renderPanel();
    await expandFavorite('Favorite question 1');

    expect(await screen.findByText('ABCF result')).toBeTruthy();
    expect(screen.getByText('ABCF result').tagName).toBe('STRONG');
    expect(screen.getByText('first item').tagName).toBe('LI');
    const userQuestionNodes = screen.getAllByText('**plain user question**');
    expect(userQuestionNodes.some((node) => node.tagName !== 'STRONG')).toBeTruthy();
    expect(screen.getByTestId('favorite-turns-scroll').className).toContain('favorite-turns-scroll-expanded');
  });

  it('refreshes at least the loaded window and ignores a removed favorite from an older refresh', async () => {
    let resolveRefresh: ((value: FavoriteTurnPage) => void) | undefined;
    const entry = favorite(1);
    listFavoriteTurnsMock.mockResolvedValueOnce(page([entry])).mockImplementationOnce(
      () =>
        new Promise<FavoriteTurnPage>((resolve) => {
          resolveRefresh = resolve;
        }),
    );
    loadConversationMock.mockResolvedValue(conversationPage(entry));
    loadRunEventsMock.mockResolvedValue(runEventsPage(entry));
    upsertAnnotationMock.mockResolvedValue({ sentiment: null, isFavorited: false });
    renderPanel();
    await screen.findByText('Session 1');

    window.dispatchEvent(new CustomEvent(favoritesUpdatedEvent));
    await waitFor(() => expect(listFavoriteTurnsMock).toHaveBeenCalledTimes(2));
    await expandFavorite('Favorite question 1');
    fireEvent.click(await screen.findByRole('button', { name: '取消收藏：Favorite question 1' }));
    fireEvent.click(await screen.findByRole('button', { name: /确\s*认/ }));
    await waitFor(() => expect(screen.queryByRole('article')).toBeNull());

    await act(async () => {
      resolveRefresh?.(page([entry]));
      await Promise.resolve();
    });
    expect(screen.queryByRole('article')).toBeNull();
  }, 10_000);
});
