// @vitest-environment jsdom
import { act, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithAppProviders as render } from './renderWithAppProviders.tsx';

const streamHookState = vi.hoisted(() => ({
  latestParams: null as {
    onTerminal?: (envelope: import('../src/state/contracts.ts').StreamEnvelope) => void;
  } | null,
}));

vi.mock('../src/features/chat/hooks/useStreamConnection.ts', () => ({
  useStreamConnection: (params: unknown) => {
    streamHookState.latestParams = params as { onTerminal?: (envelope: import('../src/state/contracts.ts').StreamEnvelope) => void };
    return { isStreaming: false };
  },
}));

import { useMemo } from 'react';
import { TurnBlockComponent, __resetTurnBlockTestState } from '../src/features/chat/components/TurnBlock.tsx';
import { useChatSessionStream } from '../src/features/chat/hooks/useChatSessionStream.ts';
import { buildSessionProjection } from '../src/features/chat/view-model/buildSessionProjection.ts';
import { defaultSessionRuntimeState, flattenLiveBuckets, useConversationStore } from '../src/state/conversationStore.ts';
import type { RuntimeActiveRunSummary, SessionConversationMessage, StreamEnvelope, TurnBlock } from '../src/state/contracts.ts';
import { useRequestStore } from '../src/state/requestStore.ts';

const EMPTY_STREAM_ENVELOPES: readonly StreamEnvelope[] = [];
const EMPTY_HISTORY_MESSAGES: readonly SessionConversationMessage[] = [];
const DEFAULT_RUNTIME_STATE = defaultSessionRuntimeState();

interface HarnessProps {
  readonly sessionId: string;
  readonly loadConversation: (
    sessionId: string,
    options?: {
      background?: boolean;
      merge?: boolean;
      requiredRootMessageId?: string;
      preserveRequestId?: string;
    },
  ) => Promise<boolean>;
  readonly loadSessions: () => Promise<void>;
  readonly setStreaming: (streaming: boolean) => void;
}

function Harness({ sessionId, loadConversation, loadSessions, setStreaming }: HarnessProps) {
  const historyEnvelopes = useConversationStore((state) => state.historyEnvelopesBySession[sessionId] ?? EMPTY_STREAM_ENVELOPES);
  const activeBuckets = useConversationStore((state) => state.activeLiveBySession[sessionId]);
  const settledBuckets = useConversationStore((state) => state.settledLiveBySession[sessionId]);
  const activeEnvelopes = useMemo(() => flattenLiveBuckets(activeBuckets), [activeBuckets]);
  const settledEnvelopes = useMemo(() => flattenLiveBuckets(settledBuckets), [settledBuckets]);
  const historyMessages = useConversationStore((state) => state.historyMessagesBySession[sessionId] ?? EMPTY_HISTORY_MESSAGES);
  const runtimeState = useConversationStore((state) => state.runtimeBySession[sessionId] ?? DEFAULT_RUNTIME_STATE);
  const appendEnvelope = useConversationStore((state) => state.appendEnvelope);
  const appendEnvelopes = useConversationStore((state) => state.appendEnvelopes);
  const activeRequestRootMessageId = useRequestStore((state) => state.activeRequestRootMessageId);
  const requestStatus = useRequestStore((state) => state.requestStatus);
  const settleRequestFromTerminal = useRequestStore((state) => state.settleRequestFromTerminal);
  const acceptRequestFromStream = useRequestStore((state) => state.acceptRequestFromStream);
  const reconcilePendingRequestFromLiveEnvelope = useRequestStore((state) => state.reconcilePendingRequestFromLiveEnvelope);

  const projection = useMemo(
    () =>
      buildSessionProjection({
        historyMessages,
        historyEnvelopes,
        settledEnvelopes,
        activeEnvelopes,
        activeRun: runtimeState.activeRun,
      }),
    [activeEnvelopes, historyEnvelopes, historyMessages, runtimeState.activeRun, settledEnvelopes],
  );
  const latestBlock = projection.turnBlocks.at(-1) as TurnBlock | undefined;
  const activeSessionEventLayer = [...settledEnvelopes, ...activeEnvelopes];

  useChatSessionStream({
    sessionId,
    canOpenStream: true,
    isExecuting: false,
    hasInFlightRequest: Boolean(runtimeState.activeRun),
    activeRun: runtimeState.activeRun,
    acceptedRun: null,
    hasLocalEnvelopes: activeSessionEventLayer.length > 0,
    shouldDeferSnapshotLoad: false,
    suppressAutomaticSnapshotRefresh: true,
    activeRequestRootMessageId,
    ...(activeBuckets ? { activeLiveByRoot: activeBuckets } : {}),
    ...(settledBuckets ? { settledLiveByRoot: settledBuckets } : {}),
    turnBlocks: projection.turnBlocks,
    appendEnvelope,
    appendEnvelopes,
    setStreaming,
    setStreamConnectionState: () => {},
    loadConversation,
    loadSessions,
    settleRequestFromTerminal,
    acceptRequestFromStream,
    reconcilePendingRequestFromLiveEnvelope,
  });

  return (
    <div>
      <div data-testid="active-run-status">{runtimeState.activeRun?.status ?? 'NONE'}</div>
      <div data-testid="request-status">{requestStatus}</div>
      {latestBlock ? (
        <TurnBlockComponent block={latestBlock} onRetry={() => {}} onEdit={() => {}} onCancel={() => {}} isViewportFollowingBottom={false} />
      ) : null}
    </div>
  );
}

function makeEnvelope(overrides: Partial<StreamEnvelope>): StreamEnvelope {
  return {
    eventId: 'evt-1',
    sessionId: 'session-1',
    requestId: 'root-live',
    runId: 'run-live',
    sequence: 1,
    eventType: 'REQUEST_ACCEPTED',
    timelineEventRef: null,
    transportHints: ['SSE'],
    payload: {
      rootMessageId: 'root-live',
      content: '检查一下当前任务',
      text: '检查一下当前任务',
      contentType: 'PLAIN_TEXT',
      role: 'USER',
      messageId: 'root-live',
      metadata: { accumulated: true },
    },
    createdAt: '2026-07-06T10:00:00.000Z',
    ...overrides,
  } as StreamEnvelope;
}

describe('terminal timeout live failure integration', () => {
  beforeEach(() => {
    streamHookState.latestParams = null;
    useConversationStore.setState({
      historyEnvelopesBySession: {},
      activeLiveBySession: {},
      settledLiveBySession: {},
      nextLiveOrdinalBySession: {},
      historyMessagesBySession: {},
      conversationLoadStateBySession: { 'session-1': 'ready' },
      conversationPageInfoBySession: {},
      runtimeBySession: {
        'session-1': {
          ...defaultSessionRuntimeState('session-1'),
          activeRun: {
            requestId: 'root-live',
            runId: 'run-live',
            status: 'EXECUTING',
          } as RuntimeActiveRunSummary,
        },
      },
      isStreaming: false,
      conversationError: null,
      sessionAccessOrder: [],
    });
    useRequestStore.setState({
      isSubmittingRequest: false,
      activeRequestRootMessageId: null,
      requestStatus: 'idle',
      lastIdempotencyKey: null,
      submitError: null,
      cancelError: null,
      retryError: null,
      editError: null,
      lastSubmittedInput: '',
      lastSubmittedAttachments: [],
      uploadError: null,
      draftBeforeEdit: null,
      pendingRequest: null,
    });
    __resetTurnBlockTestState();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('clears the live thinking state after a timeout failure without needing a manual refresh', async () => {
    const loadConversation = vi.fn().mockResolvedValue(true);
    const loadSessions = vi.fn().mockResolvedValue(undefined);
    const setStreaming = vi.fn();

    useConversationStore.getState().appendEnvelope('session-1', makeEnvelope({}));
    useConversationStore.getState().appendEnvelope(
      'session-1',
      makeEnvelope({
        eventId: 'evt-thinking',
        sequence: 2,
        eventType: 'LLM_THINKING_DELTA',
        payload: {
          rootMessageId: 'root-live',
          content: '正在构建回复内容...',
          text: '正在构建回复内容...',
          contentType: 'PLAIN_TEXT',
          metadata: { accumulated: true },
        },
      }),
    );

    render(<Harness sessionId="session-1" loadConversation={loadConversation} loadSessions={loadSessions} setStreaming={setStreaming} />);

    expect(screen.getByTestId('turn-process-executing-gif')).toBeTruthy();
    expect(screen.getByTestId('active-run-status').textContent).toBe('EXECUTING');
    expect(screen.getByTestId('request-status').textContent).toBe('idle');

    const failedEnvelope = makeEnvelope({
      eventId: 'evt-failed',
      sequence: 5,
      eventType: 'REQUEST_FAILED',
      payload: {
        rootMessageId: 'root-live',
        content: 'Request failed: Model invocation timed out.',
        text: 'Request failed: Model invocation timed out.',
        contentType: 'PLAIN_TEXT',
        status: 'FAILED',
        code: 'MODEL_TIMEOUT',
        category: 'TIMEOUT',
        metadata: { accumulated: true },
      },
    });

    await act(async () => {
      useConversationStore.getState().appendEnvelope(
        'session-1',
        makeEnvelope({
          eventId: 'evt-blank-content',
          sequence: 3,
          eventType: 'LLM_CONTENT_DELTA',
          payload: {
            rootMessageId: 'root-live',
            content: '\n\n\n\n\n\n',
            text: '\n\n\n\n\n\n',
            contentType: 'MARKDOWN',
            role: 'ASSISTANT',
            metadata: { accumulated: true },
          },
        }),
      );
      useConversationStore.getState().appendEnvelope(
        'session-1',
        makeEnvelope({
          eventId: 'evt-degradation',
          sequence: 4,
          eventType: 'DEGRADATION_NOTICE',
          payload: {
            rootMessageId: 'root-live',
            code: 'MODEL_TIMEOUT',
            category: 'TIMEOUT',
            content: 'Degradation notice',
            text: 'Degradation notice',
            contentType: 'PLAIN_TEXT',
            metadata: { accumulated: true },
          },
        }),
      );
      useConversationStore.getState().appendEnvelope('session-1', failedEnvelope);
      streamHookState.latestParams?.onTerminal?.(failedEnvelope);
      await Promise.resolve();
    });

    expect(screen.queryByTestId('turn-answer-pending')).toBeNull();
    expect(screen.getByTestId('turn-failed-notice')).toBeTruthy();
    expect(screen.getByTestId('turn-failed-notice').getAttribute('data-failed-partial')).toBe('false');
    expect(screen.getByTestId('active-run-status').textContent).toBe('NONE');
    expect(loadSessions).toHaveBeenCalledTimes(1);
    expect(loadConversation).not.toHaveBeenCalled();
    expect(setStreaming).toHaveBeenCalledWith(false);
  });
});
