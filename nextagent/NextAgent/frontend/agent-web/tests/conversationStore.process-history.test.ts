import { beforeEach, describe, expect, it, vi } from 'vitest';
import { sessionService } from '../src/services/sessionService.ts';
import { composeTurnProcessHistory } from '../src/features/chat/history/processHistory.ts';
import { useConversationStore } from '../src/state/conversationStore.ts';
import type { SessionConversationMessage, SessionConversationPage, SessionRunEventHistoryPage, StreamEnvelope } from '../src/state/contracts.ts';

function assistantMessage(runId: string, overrides: Partial<SessionConversationMessage> = {}): SessionConversationMessage {
  return {
    messageId: `assistant-${runId}`,
    sessionId: 'session-1',
    requestId: `request-${runId}`,
    runId,
    rootMessageId: `root-${runId}`,
    role: 'ASSISTANT',
    sequence: 2,
    content: `answer for ${runId}`,
    contentType: 'MARKDOWN',
    metadata: {},
    createdAt: '2026-07-22T00:00:02.000Z',
    visible: true,
    ...overrides,
  };
}

function askUserAnswerMessage(runId: string): SessionConversationMessage {
  return {
    messageId: `ask-user-answer-${runId}`,
    sessionId: 'session-1',
    requestId: `request-${runId}`,
    runId,
    role: 'CAPABILITY_RESULT',
    sequence: 2,
    content: JSON.stringify({
      toolCallId: `ask-user-${runId}`,
      toolName: 'AskUserQuestion',
      payload: { answers: [['RAW_ANSWER_MUST_NOT_BE_READ']] },
    }),
    contentType: 'PLAIN_TEXT',
    metadata: { kind: 'CAPABILITY_RESULT', toolCallId: `ask-user-${runId}`, toolName: 'AskUserQuestion' },
    pendingInputAnswer: {
      capabilityId: 'AskUserQuestion',
      toolCallId: `ask-user-${runId}`,
      pendingInputId: `pending-${runId}`,
      kind: 'QUESTION',
      status: 'RECEIVED',
      safeSummary: 'Pending input answer received.',
      safeResult: {
        kind: 'pendingInputAnswer',
        answers: [['site-a']],
        truncated: false,
      },
    },
    createdAt: '2026-07-22T00:00:02.000Z',
    visible: true,
  };
}

function askUserRequiredEnvelope(runId: string): StreamEnvelope {
  return {
    eventId: `ask-user-required-${runId}`,
    sessionId: 'session-1',
    requestId: `request-${runId}`,
    runId,
    rootMessageId: `request-${runId}`,
    requestContextId: `context-${runId}`,
    sequence: 1,
    eventType: 'USER_INPUT_REQUIRED',
    timelineEventRef: `timeline-ask-user-required-${runId}`,
    transportHints: [],
    payload: {
      pendingInputId: `pending-${runId}`,
      kind: 'QUESTION',
      questions: [
        {
          prompt: '选择站点',
          options: [{ label: '站点 A', value: 'site-a' }],
        },
      ],
    },
    createdAt: '2026-07-22T00:00:01.000Z',
  };
}

function conversationPage(runId: string, overrides: Partial<SessionConversationPage> = {}): SessionConversationPage {
  return {
    sessionId: 'session-1',
    items: [assistantMessage(runId)],
    nextCursor: null,
    ...overrides,
  };
}

function thinkingEnvelope(runId: string, eventId = `thinking-${runId}`): StreamEnvelope {
  return {
    eventId,
    sessionId: 'session-1',
    requestId: `request-${runId}`,
    runId,
    rootMessageId: `root-${runId}`,
    requestContextId: `context-${runId}`,
    sequence: 1,
    eventType: 'LLM_THINKING_DELTA',
    timelineEventRef: `timeline-${eventId}`,
    transportHints: [],
    payload: {
      text: `thinking for ${runId}`,
      metadata: { accumulated: true, completed: true },
    },
    createdAt: '2026-07-22T00:00:01.000Z',
  };
}

function availablePage(runId: string): SessionRunEventHistoryPage {
  return {
    availability: 'AVAILABLE',
    events: [thinkingEnvelope(runId)],
  };
}

function deferred<T>(): {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
  readonly reject: (error: unknown) => void;
} {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function publishTargets(runIds: readonly string[], sessionId = 'session-1', generation = 1): void {
  const displayRuns = useConversationStore.getState().displayProcessRunByRootBySession[sessionId] ?? {};
  useConversationStore.getState().updateAutomaticProcessHistoryTargets(
    sessionId,
    runIds.map((runId, index) => ({
      sessionId,
      rootMessageId: Object.entries(displayRuns).find(([, displayRunId]) => displayRunId === runId)?.[0] ?? `root-${runId}`,
      runId,
      priority: 'VIEWPORT' as const,
      generation,
      distanceFromViewportCenter: index,
    })),
  );
}

describe('conversationStore process history', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    useConversationStore.getState().clearConversation('session-1');
    useConversationStore.getState().clearConversation('session-a');
    useConversationStore.getState().clearConversation('session-b');
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
      conversationPreviewBySession: {},
      conversationLoadStateBySession: {},
      conversationPageInfoBySession: {},
      conversationViewBySession: {},
      runtimeBySession: {},
      isStreaming: false,
      conversationError: null,
      sessionAccessOrder: [],
    });
  });

  it('commits messages without loading offscreen process history and hydrates an explicit target', async () => {
    const eventPage = deferred<SessionRunEventHistoryPage>();
    vi.spyOn(sessionService, 'loadConversation').mockResolvedValue(conversationPage('run-1'));
    const loadRunEvents = vi.spyOn(sessionService, 'loadRunEvents').mockReturnValue(eventPage.promise);

    await expect(useConversationStore.getState().loadConversation('session-1')).resolves.toBe(true);

    let state = useConversationStore.getState();
    expect(state.conversationLoadStateBySession['session-1']).toBe('ready');
    expect(state.historyMessagesBySession['session-1']?.[0]?.content).toBe('answer for run-1');
    expect(sessionService.loadRunEvents).not.toHaveBeenCalled();
    useConversationStore.getState().setExplicitProcessHistoryTarget('session-1', 'test-panel', {
      sessionId: 'session-1',
      rootMessageId: 'root-run-1',
      runId: 'run-1',
      priority: 'EXPLICIT',
      distanceFromViewportCenter: 0,
    });
    state = useConversationStore.getState();
    expect(state.processHistoryBySession['session-1']?.['run-1']).toMatchObject({ status: 'LOADING' });
    expect(state.historyEnvelopesBySession['session-1']?.some((item) => item.eventType === 'LLM_THINKING_DELTA')).toBe(false);

    eventPage.resolve(availablePage('run-1'));
    await vi.waitFor(() => {
      expect(useConversationStore.getState().processHistoryBySession['session-1']?.['run-1']?.status).toBe('AVAILABLE');
    });

    state = useConversationStore.getState();
    const thinking =
      state.processHistoryBySession['session-1']?.['run-1']?.status === 'AVAILABLE'
        ? state.processHistoryBySession['session-1']['run-1'].envelopes.find((item) => item.eventType === 'LLM_THINKING_DELTA')
        : undefined;
    expect(thinking).toMatchObject({ eventId: 'thinking-run-1', runId: 'run-1' });
    expect(state.historyEnvelopesBySession['session-1']?.some((item) => item.eventType === 'LLM_THINKING_DELTA')).toBe(false);
  });

  it('keeps a settled AskUserQuestion interaction after a later completed submit', async () => {
    vi.spyOn(sessionService, 'loadConversation')
      .mockResolvedValueOnce(
        conversationPage('run-1', {
          items: [askUserAnswerMessage('run-1'), assistantMessage('run-1', { sequence: 3 })],
        }),
      )
      .mockResolvedValueOnce(
        conversationPage('run-2', {
          items: [askUserAnswerMessage('run-1'), assistantMessage('run-1', { sequence: 3 }), assistantMessage('run-2', { sequence: 5 })],
        }),
      );
    vi.spyOn(sessionService, 'loadRunEvents').mockImplementation((query) =>
      Promise.resolve({
        availability: 'AVAILABLE',
        events: query.runId === 'run-1' ? [askUserRequiredEnvelope('run-1')] : [],
      }),
    );

    await useConversationStore.getState().loadConversation('session-1');
    publishTargets(['run-1']);
    await vi.waitFor(() => {
      expect(useConversationStore.getState().processHistoryBySession['session-1']?.['run-1']?.status).toBe('AVAILABLE');
    });
    await useConversationStore.getState().loadConversation('session-1');
    await vi.waitFor(() => {
      expect(useConversationStore.getState().conversationLoadStateBySession['session-1']).toBe('ready');
    });

    const runOneState = useConversationStore.getState().processHistoryBySession['session-1']?.['run-1'];
    const runOneEvents = composeTurnProcessHistory({
      baseEnvelopes: useConversationStore.getState().historyEnvelopesBySession['session-1'] ?? [],
      eventEnvelopes: runOneState?.status === 'AVAILABLE' ? runOneState.envelopes : [],
      sessionId: 'session-1',
      rootMessageId: 'request-run-1',
      runId: 'run-1',
    });
    expect(runOneEvents.filter((envelope) => envelope.eventType === 'USER_INPUT_REQUIRED')).toHaveLength(1);
    expect(
      runOneEvents.filter(
        (envelope) =>
          envelope.eventType === 'CAPABILITY_RESULT_DELTA' && (envelope.payload as Record<string, unknown>).pendingInputId === 'pending-run-1',
      ),
    ).toHaveLength(1);
    expect(JSON.stringify(runOneEvents)).not.toContain('RAW_ANSWER_MUST_NOT_BE_READ');
  });

  it('distinguishes available-empty and legacy unavailable without losing messages', async () => {
    vi.spyOn(sessionService, 'loadConversation')
      .mockResolvedValueOnce(conversationPage('run-empty'))
      .mockResolvedValueOnce(conversationPage('run-legacy'));
    const loadEvents = vi
      .spyOn(sessionService, 'loadRunEvents')
      .mockResolvedValueOnce({ availability: 'AVAILABLE', events: [] })
      .mockResolvedValueOnce({ availability: 'LEGACY_FORK_PROCESS_HISTORY_UNAVAILABLE', events: [] });

    await useConversationStore.getState().loadConversation('session-1');
    publishTargets(['run-empty']);
    await vi.waitFor(() => {
      expect(useConversationStore.getState().processHistoryBySession['session-1']?.['run-empty']).toMatchObject({
        status: 'AVAILABLE',
        envelopes: [],
      });
    });

    await useConversationStore.getState().loadConversation('session-1');
    publishTargets(['run-legacy'], 'session-1', 2);
    await vi.waitFor(() => {
      expect(useConversationStore.getState().processHistoryBySession['session-1']?.['run-legacy']).toEqual({ status: 'LEGACY_UNAVAILABLE' });
    });
    expect(useConversationStore.getState().historyMessagesBySession['session-1']?.[0]?.content).toBe('answer for run-legacy');
    useConversationStore.getState().retryRunProcessHistory('session-1', 'run-legacy');
    expect(loadEvents).toHaveBeenCalledTimes(2);
  });

  it('stores only a safe failure code and retries an explicitly failed selected run', async () => {
    vi.spyOn(sessionService, 'loadConversation').mockResolvedValue(conversationPage('run-failed'));
    const loadEvents = vi
      .spyOn(sessionService, 'loadRunEvents')
      .mockRejectedValueOnce(new Error('raw provider endpoint and payload'))
      .mockResolvedValueOnce(availablePage('run-failed'));

    await useConversationStore.getState().loadConversation('session-1');
    publishTargets(['run-failed']);
    await vi.waitFor(() => {
      expect(useConversationStore.getState().processHistoryBySession['session-1']?.['run-failed']).toEqual({
        status: 'FAILED',
        errorCode: 'PROCESS_HISTORY_LOAD_FAILED',
      });
    });
    expect(JSON.stringify(useConversationStore.getState().processHistoryBySession)).not.toContain('raw provider');
    expect(useConversationStore.getState().historyMessagesBySession['session-1']?.[0]?.content).toBe('answer for run-failed');

    useConversationStore.getState().retryRunProcessHistory('session-1', 'run-failed');
    expect(useConversationStore.getState().processHistoryBySession['session-1']?.['run-failed']).toMatchObject({ status: 'LOADING' });
    await vi.waitFor(() => {
      expect(useConversationStore.getState().processHistoryBySession['session-1']?.['run-failed']?.status).toBe('AVAILABLE');
    });
    expect(loadEvents).toHaveBeenCalledTimes(2);
  });

  it('ignores a late result from a superseded authoritative load', async () => {
    const oldEvents = deferred<SessionRunEventHistoryPage>();
    let oldSignal: AbortSignal | undefined;
    vi.spyOn(sessionService, 'loadConversation')
      .mockResolvedValueOnce(conversationPage('run-old'))
      .mockResolvedValueOnce(conversationPage('run-new'));
    vi.spyOn(sessionService, 'loadRunEvents').mockImplementation((query) => {
      if (query.runId === 'run-old') {
        oldSignal = query.signal;
        return oldEvents.promise;
      }
      return Promise.resolve(availablePage('run-new'));
    });

    await useConversationStore.getState().loadConversation('session-1');
    publishTargets(['run-old']);
    await vi.waitFor(() => expect(oldSignal).toBeDefined());
    await useConversationStore.getState().loadConversation('session-1');
    publishTargets(['run-new'], 'session-1', 2);
    await vi.waitFor(() => {
      expect(useConversationStore.getState().processHistoryBySession['session-1']?.['run-new']?.status).toBe('AVAILABLE');
    });

    oldEvents.resolve(availablePage('run-old'));
    await vi.waitFor(() => {
      expect(useConversationStore.getState().processHistoryBySession['session-1']?.['run-old']?.status).toBe('AVAILABLE');
    });
    const state = useConversationStore.getState();
    expect(state.historyEnvelopesBySession['session-1']?.some((item) => item.runId === 'run-old')).toBe(false);
  });

  it('aborts and rejects late process results after clear', async () => {
    const eventPage = deferred<SessionRunEventHistoryPage>();
    let observedSignal: AbortSignal | undefined;
    vi.spyOn(sessionService, 'loadConversation').mockResolvedValue(conversationPage('run-1'));
    vi.spyOn(sessionService, 'loadRunEvents').mockImplementation((query) => {
      observedSignal = query.signal;
      return eventPage.promise;
    });

    await useConversationStore.getState().loadConversation('session-1');
    publishTargets(['run-1']);
    await vi.waitFor(() => expect(observedSignal).toBeDefined());
    useConversationStore.getState().clearConversation('session-1');
    expect(observedSignal?.aborted).toBe(true);
    eventPage.resolve(availablePage('run-1'));
    await Promise.resolve();
    await Promise.resolve();

    const state = useConversationStore.getState();
    expect(state.processHistoryBySession['session-1']).toBeUndefined();
    expect(state.historyEnvelopesBySession['session-1']).toBeUndefined();
  });

  it('keeps expansion disclosure demand separate from the started cache load', async () => {
    const eventPage = deferred<SessionRunEventHistoryPage>();
    let observedSignal: AbortSignal | undefined;
    const loadEvents = vi.spyOn(sessionService, 'loadRunEvents').mockImplementation((query) => {
      observedSignal = query.signal;
      return eventPage.promise;
    });
    const expansionTarget = {
      sessionId: 'session-1',
      rootMessageId: 'root-run-expanded',
      runId: 'run-expanded',
      priority: 'EXPLICIT',
      distanceFromViewportCenter: 0,
    } as const;

    useConversationStore.getState().setExplicitProcessHistoryTarget('session-1', 'expansion:root-run-expanded', expansionTarget);
    useConversationStore.getState().setExplicitProcessHistoryTarget('session-1', 'expansion:root-run-expanded', expansionTarget);
    await vi.waitFor(() => expect(loadEvents).toHaveBeenCalledTimes(1));

    useConversationStore.getState().setExplicitProcessHistoryTarget('session-1', 'expansion:root-run-expanded', null);
    expect(observedSignal?.aborted).toBe(false);
    eventPage.resolve(availablePage('run-expanded'));
    await vi.waitFor(() => {
      expect(useConversationStore.getState().processHistoryBySession['session-1']?.['run-expanded']?.status).toBe('AVAILABLE');
    });
    expect(loadEvents).toHaveBeenCalledTimes(1);
  });

  it('hydrates only newly visible runs when older and newer windows are merged', async () => {
    const loadConversation = vi
      .spyOn(sessionService, 'loadConversation')
      .mockResolvedValueOnce(
        conversationPage('run-recent', {
          items: [assistantMessage('run-recent', { sequence: 10 })],
          nextCursor: 'older-cursor',
        }),
      )
      .mockResolvedValueOnce(
        conversationPage('run-older', {
          items: [assistantMessage('run-older', { sequence: 2 })],
          nextCursor: null,
        }),
      )
      .mockResolvedValueOnce(
        conversationPage('run-newer', {
          items: [assistantMessage('run-newer', { sequence: 20 })],
          newerCursor: null,
        }),
      );
    const loadEvents = vi.spyOn(sessionService, 'loadRunEvents').mockImplementation((query) => Promise.resolve(availablePage(query.runId)));

    await useConversationStore.getState().loadConversation('session-1');
    publishTargets(['run-recent']);
    await vi.waitFor(() => expect(loadEvents).toHaveBeenCalledTimes(1));
    useConversationStore.getState().setConversationPageInfo('session-1', { newerCursor: 'newer-cursor' });

    await useConversationStore.getState().loadOlderConversation('session-1');
    publishTargets(['run-older', 'run-recent'], 'session-1', 2);
    await vi.waitFor(() => {
      expect(useConversationStore.getState().processHistoryBySession['session-1']?.['run-older']?.status).toBe('AVAILABLE');
    });
    await useConversationStore.getState().loadNewerConversation('session-1');
    publishTargets(['run-older', 'run-recent', 'run-newer'], 'session-1', 3);
    await vi.waitFor(() => {
      expect(useConversationStore.getState().processHistoryBySession['session-1']?.['run-newer']?.status).toBe('AVAILABLE');
    });

    expect(loadConversation).toHaveBeenCalledTimes(3);
    expect(loadEvents.mock.calls.map(([query]) => query.runId)).toEqual(['run-recent', 'run-older', 'run-newer']);
  });

  it('shares the four-request limit across overlapping history hydration batches', async () => {
    const recentMessages = ['run-1', 'run-2', 'run-3', 'run-4'].map((runId, index) => assistantMessage(runId, { sequence: index + 10 }));
    vi.spyOn(sessionService, 'loadConversation')
      .mockResolvedValueOnce(
        conversationPage('run-1', {
          items: recentMessages,
          nextCursor: 'older-cursor',
        }),
      )
      .mockResolvedValueOnce(
        conversationPage('run-5', {
          items: [assistantMessage('run-5', { sequence: 2 })],
          nextCursor: null,
        }),
      );

    let activeRequests = 0;
    let peakRequests = 0;
    const resolvers: Array<() => void> = [];
    const loadEvents = vi.spyOn(sessionService, 'loadRunEvents').mockImplementation(
      (query) =>
        new Promise<SessionRunEventHistoryPage>((resolve) => {
          activeRequests += 1;
          peakRequests = Math.max(peakRequests, activeRequests);
          resolvers.push(() => {
            activeRequests -= 1;
            resolve(availablePage(query.runId));
          });
        }),
    );

    await useConversationStore.getState().loadConversation('session-1');
    publishTargets(['run-1', 'run-2', 'run-3', 'run-4']);
    await vi.waitFor(() => expect(loadEvents).toHaveBeenCalledTimes(4));
    await useConversationStore.getState().loadOlderConversation('session-1');
    publishTargets(['run-1', 'run-2', 'run-3', 'run-4', 'run-5'], 'session-1', 2);
    await Promise.resolve();

    expect(loadEvents).toHaveBeenCalledTimes(4);
    expect(peakRequests).toBe(4);

    resolvers[0]?.();
    await vi.waitFor(() => expect(loadEvents).toHaveBeenCalledTimes(5));
    resolvers.slice(1).forEach((resolve) => resolve());
    await vi.waitFor(() => {
      expect(useConversationStore.getState().processHistoryBySession['session-1']?.['run-5']?.status).toBe('AVAILABLE');
    });
    expect(peakRequests).toBe(4);
  });

  it('reuses an AVAILABLE run cache across repeated authoritative loads', async () => {
    vi.spyOn(sessionService, 'loadConversation').mockResolvedValue(conversationPage('run-cached'));
    const loadEvents = vi.spyOn(sessionService, 'loadRunEvents').mockResolvedValue(availablePage('run-cached'));

    await useConversationStore.getState().loadConversation('session-1');
    publishTargets(['run-cached']);
    await vi.waitFor(() => {
      expect(useConversationStore.getState().processHistoryBySession['session-1']?.['run-cached']?.status).toBe('AVAILABLE');
    });
    await useConversationStore.getState().loadConversation('session-1');
    publishTargets(['run-cached'], 'session-1', 2);
    await Promise.resolve();

    expect(loadEvents).toHaveBeenCalledTimes(1);
    const cached = useConversationStore.getState().processHistoryBySession['session-1']?.['run-cached'];
    expect(cached?.status === 'AVAILABLE' ? cached.envelopes : []).toEqual(
      expect.arrayContaining([expect.objectContaining({ eventId: 'thinking-run-cached' })]),
    );
  });

  it('replaces selected runs for an anchored window while retaining reusable cache', async () => {
    vi.spyOn(sessionService, 'loadConversation')
      .mockResolvedValueOnce(conversationPage('run-recent'))
      .mockResolvedValueOnce(
        conversationPage('run-anchor', {
          items: [assistantMessage('run-anchor', { sequence: 5 })],
        }),
      );
    vi.spyOn(sessionService, 'loadRunEvents').mockImplementation((query) => Promise.resolve(availablePage(query.runId)));

    await useConversationStore.getState().loadConversation('session-1');
    publishTargets(['run-recent']);
    await vi.waitFor(() => {
      expect(useConversationStore.getState().processHistoryBySession['session-1']?.['run-recent']?.status).toBe('AVAILABLE');
    });
    await useConversationStore.getState().loadAnchoredConversation('session-1', 'root-run-anchor');
    publishTargets(['run-anchor'], 'session-1', 2);
    await vi.waitFor(() => {
      expect(useConversationStore.getState().processHistoryBySession['session-1']?.['run-anchor']?.status).toBe('AVAILABLE');
    });

    const state = useConversationStore.getState();
    expect(state.processHistoryBySession['session-1']?.['run-recent']?.status).toBe('AVAILABLE');
    expect(state.historyEnvelopesBySession['session-1']?.some((item) => item.runId === 'run-recent')).toBe(false);
  });

  it('never mixes a late session A process result into session B', async () => {
    const sessionAEvents = deferred<SessionRunEventHistoryPage>();
    vi.spyOn(sessionService, 'loadConversation').mockImplementation((query) => {
      const runId = query.sessionId === 'session-a' ? 'run-a' : 'run-b';
      return Promise.resolve(
        conversationPage(runId, {
          sessionId: query.sessionId,
          items: [
            assistantMessage(runId, {
              sessionId: query.sessionId,
              rootMessageId: `root-${runId}`,
            }),
          ],
        }),
      );
    });
    vi.spyOn(sessionService, 'loadRunEvents').mockImplementation((query) => {
      if (query.runId === 'run-a') {
        return sessionAEvents.promise;
      }
      return Promise.resolve({
        availability: 'AVAILABLE',
        events: [{ ...thinkingEnvelope('run-b'), sessionId: 'session-b' }],
      });
    });

    await useConversationStore.getState().loadConversation('session-a');
    publishTargets(['run-a'], 'session-a');
    await useConversationStore.getState().loadConversation('session-b');
    publishTargets(['run-b'], 'session-b');
    await vi.waitFor(() => {
      expect(useConversationStore.getState().processHistoryBySession['session-b']?.['run-b']?.status).toBe('AVAILABLE');
    });
    sessionAEvents.resolve({
      availability: 'AVAILABLE',
      events: [{ ...thinkingEnvelope('run-a'), sessionId: 'session-a' }],
    });
    await vi.waitFor(() => {
      expect(useConversationStore.getState().processHistoryBySession['session-a']?.['run-a']?.status).toBe('AVAILABLE');
    });

    expect(
      useConversationStore
        .getState()
        .historyEnvelopesBySession['session-b']?.some((item) => item.runId === 'run-a' || item.sessionId === 'session-a'),
    ).toBe(false);
  });

  it('bounds replacement targets to the latest sixteen explicit generations and four active loads', async () => {
    const pendingByRun = new Map<string, ReturnType<typeof deferred<SessionRunEventHistoryPage>>>();
    const startedRunIds: string[] = [];
    let activeLoads = 0;
    let maxObservedActiveLoads = 0;
    vi.spyOn(sessionService, 'loadRunEvents').mockImplementation((query) => {
      startedRunIds.push(query.runId);
      activeLoads += 1;
      maxObservedActiveLoads = Math.max(maxObservedActiveLoads, activeLoads);
      const pending = deferred<SessionRunEventHistoryPage>();
      pendingByRun.set(query.runId, pending);
      return pending.promise.finally(() => {
        activeLoads -= 1;
      });
    });

    const explicitRunIds = Array.from({ length: 21 }, (_, index) => `run-${index + 1}`);
    for (const runId of explicitRunIds) {
      useConversationStore.getState().setExplicitProcessHistoryTarget('session-1', `expansion:${runId}`, {
        sessionId: 'session-1',
        rootMessageId: `root-${runId}`,
        runId,
        priority: 'EXPLICIT',
        distanceFromViewportCenter: 0,
      });
    }
    await vi.waitFor(() => expect(startedRunIds).toHaveLength(4));

    while (startedRunIds.length < 20) {
      const pendingEntries = [...pendingByRun.entries()];
      const startedBeforeSettlement = startedRunIds.length;
      pendingByRun.clear();
      for (const [runId, pending] of pendingEntries) {
        pending.resolve(availablePage(runId));
      }
      await vi.waitFor(() => {
        expect(startedRunIds.length).toBeGreaterThan(startedBeforeSettlement);
      });
    }
    for (const [runId, pending] of pendingByRun) {
      pending.resolve(availablePage(runId));
    }
    await vi.waitFor(() => expect(activeLoads).toBe(0));

    const latestExplicitRunIds = startedRunIds.slice(4);
    expect(latestExplicitRunIds).toHaveLength(16);
    expect(latestExplicitRunIds).toEqual([
      'run-21',
      'run-20',
      'run-19',
      'run-18',
      'run-17',
      'run-16',
      'run-15',
      'run-14',
      'run-13',
      'run-12',
      'run-11',
      'run-10',
      'run-9',
      'run-8',
      'run-7',
      'run-6',
    ]);
    expect(maxObservedActiveLoads).toBeLessThanOrEqual(4);

    useConversationStore.getState().updateAutomaticProcessHistoryTargets('session-1', []);
    await Promise.resolve();
    await Promise.resolve();
    expect(startedRunIds).not.toContain('run-5');
  });

  it('releases active and expansion demand after every terminal process-history outcome', async () => {
    const pendingByRun = new Map<string, ReturnType<typeof deferred<SessionRunEventHistoryPage>>>();
    const startedRunIds: string[] = [];
    const signalsByRun = new Map<string, AbortSignal | undefined>();
    vi.spyOn(sessionService, 'loadConversation')
      .mockResolvedValueOnce(
        conversationPage('run-available', {
          items: ['run-available', 'run-failed', 'run-legacy', 'run-next'].map((runId, index) => assistantMessage(runId, { sequence: index + 1 })),
        }),
      )
      .mockResolvedValueOnce(conversationPage('run-replacement'));
    vi.spyOn(sessionService, 'loadRunEvents').mockImplementation((query) => {
      startedRunIds.push(query.runId);
      signalsByRun.set(query.runId, query.signal);
      const pending = deferred<SessionRunEventHistoryPage>();
      pendingByRun.set(query.runId, pending);
      return pending.promise;
    });

    await useConversationStore.getState().loadConversation('session-1');
    publishTargets(['run-available', 'run-failed', 'run-legacy', 'run-next']);
    await vi.waitFor(() => expect(startedRunIds).toHaveLength(4));
    await useConversationStore.getState().loadConversation('session-1');
    publishTargets(['run-replacement'], 'session-1', 2);

    expect(signalsByRun.get('run-available')?.aborted).toBe(false);
    expect(signalsByRun.get('run-failed')?.aborted).toBe(false);
    expect(signalsByRun.get('run-legacy')?.aborted).toBe(false);

    pendingByRun.get('run-available')?.resolve(availablePage('run-available'));
    pendingByRun.get('run-failed')?.reject(new Error('safe failure'));
    pendingByRun.get('run-legacy')?.resolve({
      availability: 'LEGACY_FORK_PROCESS_HISTORY_UNAVAILABLE',
      events: [],
    });
    pendingByRun.get('run-next')?.resolve(availablePage('run-next'));
    await vi.waitFor(() => expect(startedRunIds).toContain('run-replacement'));

    expect(useConversationStore.getState().processHistoryBySession['session-1']?.['run-available']?.status).toBe('AVAILABLE');
    expect(useConversationStore.getState().processHistoryBySession['session-1']?.['run-failed']?.status).toBe('FAILED');
    expect(useConversationStore.getState().processHistoryBySession['session-1']?.['run-legacy']?.status).toBe('LEGACY_UNAVAILABLE');
  });

  it('removes the replaced retry attempt from settling targets without dropping other roots', async () => {
    const loadRunEvents = vi.spyOn(sessionService, 'loadRunEvents').mockImplementation((query) => Promise.resolve(availablePage(query.runId)));
    useConversationStore.setState({
      displayProcessRunByRootBySession: { 'session-1': { 'root-retry': 'run-old', 'root-other': 'run-other' } },
    });
    useConversationStore.getState().updateAutomaticProcessHistoryTargets(
      'session-1',
      (
        [
          ['root-retry', 'run-old'],
          ['root-other', 'run-other'],
        ] as const
      ).map(([rootMessageId, runId], distanceFromViewportCenter) => ({
        sessionId: 'session-1',
        rootMessageId,
        runId,
        priority: 'VIEWPORT' as const,
        generation: 1,
        distanceFromViewportCenter,
      })),
    );

    useConversationStore.getState().selectRetryAttemptForRoot('session-1', 'root-retry', 'run-new');
    await new Promise((resolve) => setTimeout(resolve, 160));

    expect(loadRunEvents.mock.calls.map(([query]) => query.runId)).toEqual(['run-other']);
  });

  it('evicts process state and envelopes atomically without touching recency on reads', async () => {
    vi.spyOn(sessionService, 'loadRunEvents').mockImplementation((query) => Promise.resolve(availablePage(query.runId)));

    for (let index = 1; index <= 65; index += 1) {
      const runId = `run-cache-${index}`;
      useConversationStore.getState().setExplicitProcessHistoryTarget('session-1', `cache:${runId}`, {
        sessionId: 'session-1',
        rootMessageId: `root-${runId}`,
        runId,
        priority: 'EXPLICIT',
        distanceFromViewportCenter: 0,
      });
      await vi.waitFor(() => {
        expect(useConversationStore.getState().processHistoryBySession['session-1']?.[runId]?.status).toBe('AVAILABLE');
      });
      useConversationStore.getState().setExplicitProcessHistoryTarget('session-1', `cache:${runId}`, null);
    }

    const beforeRead = useConversationStore.getState().processHistoryBySession['session-1'] ?? {};
    const firstRead = beforeRead['run-cache-1'];
    void useConversationStore.getState().processHistoryBySession['session-1'];
    const afterRead = useConversationStore.getState().processHistoryBySession['session-1'] ?? {};
    const available = Object.values(afterRead).filter((state) => state?.status === 'AVAILABLE');

    expect(available).toHaveLength(64);
    expect(firstRead).toBeUndefined();
    expect(afterRead['run-cache-1']).toBeUndefined();
    expect(afterRead['run-cache-65']?.status).toBe('AVAILABLE');
  });

  it('owns strictly increasing explicit generations across panel preview and retry sources', async () => {
    vi.spyOn(sessionService, 'loadRunEvents').mockRejectedValue(new Error('failed'));
    const supplied = {
      sessionId: 'session-1',
      rootMessageId: 'root-generation',
      runId: 'run-generation',
      priority: 'EXPLICIT' as const,
      distanceFromViewportCenter: 0,
    };

    useConversationStore.getState().setExplicitProcessHistoryTarget('session-1', 'panel:root-generation', supplied);
    expect(useConversationStore.getState().processHistoryLoadVersionBySession['session-1']).toBe(1);
    useConversationStore.getState().setExplicitProcessHistoryTarget('session-1', 'panel:root-generation', null);
    useConversationStore.getState().setExplicitProcessHistoryTarget('session-1', 'panel:root-generation', supplied);
    expect(useConversationStore.getState().processHistoryLoadVersionBySession['session-1']).toBe(2);
    useConversationStore.getState().setExplicitProcessHistoryTarget('session-1', 'preview', {
      ...supplied,
      retention: 'WHILE_TARGETED',
    });
    expect(useConversationStore.getState().processHistoryLoadVersionBySession['session-1']).toBe(3);
    await vi.waitFor(() => {
      expect(useConversationStore.getState().processHistoryBySession['session-1']?.['run-generation']?.status).toBe('FAILED');
    });
    useConversationStore.setState({
      displayProcessRunByRootBySession: {
        'session-1': { 'root-generation': 'run-generation' },
      },
    });
    useConversationStore.getState().retryRunProcessHistory('session-1', 'run-generation');
    expect(useConversationStore.getState().processHistoryLoadVersionBySession['session-1']).toBe(4);
  });

  it('disposes process history and aborts late loads when the eleventh session evicts the first', async () => {
    const pending = deferred<SessionRunEventHistoryPage>();
    let firstSignal: AbortSignal | undefined;
    vi.spyOn(sessionService, 'loadRunEvents').mockImplementation((query) => {
      if (query.sessionId === 'session-cache-1') {
        firstSignal = query.signal;
        return pending.promise;
      }
      return Promise.resolve({ availability: 'AVAILABLE', events: [] });
    });

    for (let index = 1; index <= 11; index += 1) {
      const sessionId = `session-cache-${index}`;
      useConversationStore.getState().setEnvelopes(sessionId, []);
      if (index === 1) {
        useConversationStore.getState().setExplicitProcessHistoryTarget(sessionId, 'panel:root-cache-1', {
          sessionId,
          rootMessageId: 'root-cache-1',
          runId: 'run-cache-1',
          priority: 'EXPLICIT',
          distanceFromViewportCenter: 0,
        });
      }
    }

    expect(firstSignal?.aborted).toBe(true);
    expect(useConversationStore.getState().processHistoryBySession['session-cache-1']).toBeUndefined();
    expect(useConversationStore.getState().displayProcessRunByRootBySession['session-cache-1']).toBeUndefined();
    expect(useConversationStore.getState().processHistoryLoadVersionBySession['session-cache-1']).toBeUndefined();
    pending.resolve({ availability: 'AVAILABLE', events: [] });
    await Promise.resolve();
    await Promise.resolve();
    expect(useConversationStore.getState().processHistoryBySession['session-cache-1']).toBeUndefined();
  });
});
