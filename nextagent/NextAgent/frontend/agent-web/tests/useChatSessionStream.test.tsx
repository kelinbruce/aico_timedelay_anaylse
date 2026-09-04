// @vitest-environment jsdom
import { act, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const streamHookState = vi.hoisted(() => ({
  latestParams: null as {
    onTerminal?: (envelope: import('../src/state/contracts.ts').StreamEnvelope) => void;
    onLiveEnvelope?: (envelope: import('../src/state/contracts.ts').StreamEnvelope) => void;
    onRequestAccepted?: (envelope: import('../src/state/contracts.ts').StreamEnvelope) => void;
    onUserInputRequired?: (envelope: import('../src/state/contracts.ts').StreamEnvelope) => void;
    onUserInputResolved?: (envelope: import('../src/state/contracts.ts').StreamEnvelope) => void;
  } | null,
}));

vi.mock('../src/features/chat/hooks/useStreamConnection.ts', () => ({
  useStreamConnection: (params: unknown) => {
    streamHookState.latestParams = params as {
      onTerminal?: (envelope: import('../src/state/contracts.ts').StreamEnvelope) => void;
      onLiveEnvelope?: (envelope: import('../src/state/contracts.ts').StreamEnvelope) => void;
      onRequestAccepted?: (envelope: import('../src/state/contracts.ts').StreamEnvelope) => void;
      onUserInputRequired?: (envelope: import('../src/state/contracts.ts').StreamEnvelope) => void;
      onUserInputResolved?: (envelope: import('../src/state/contracts.ts').StreamEnvelope) => void;
    };
    return { isStreaming: false };
  },
}));

import { useChatSessionStream } from '../src/features/chat/hooks/useChatSessionStream.ts';
import { useConversationStore, defaultSessionRuntimeState, type LiveBucketsByRoot } from '../src/state/conversationStore.ts';
import { useUserInputStore } from '../src/state/userInputStore.ts';
import { useBackgroundTaskStore } from '../src/state/backgroundTaskStore.ts';
import type { RuntimeActiveRunSummary, StreamEnvelope, TurnBlock } from '../src/state/contracts.ts';

interface HarnessProps {
  readonly sessionId: string | null;
  readonly isExecuting: boolean;
  readonly hasInFlightRequest: boolean;
  readonly activeRun: RuntimeActiveRunSummary | null;
  readonly activeRequestRootMessageId: string | null;
  readonly settledEnvelopes?: readonly StreamEnvelope[];
  readonly suppressAutomaticSnapshotRefresh?: boolean;
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
  readonly settleRequestFromTerminal: (eventOrEnvelope: StreamEnvelope | StreamEnvelope['eventType'], requestId?: string | null) => boolean;
  readonly setStreaming: (streaming: boolean) => void;
  readonly onSessionEntrySnapshot?: ((sessionId: string) => void) | undefined;
}

function Harness({
  sessionId,
  isExecuting,
  hasInFlightRequest,
  activeRun,
  activeRequestRootMessageId,
  settledEnvelopes = [],
  suppressAutomaticSnapshotRefresh = false,
  loadConversation,
  loadSessions,
  settleRequestFromTerminal,
  setStreaming,
  onSessionEntrySnapshot,
}: HarnessProps) {
  const settledLiveByRoot: LiveBucketsByRoot =
    activeRequestRootMessageId && settledEnvelopes.length > 0
      ? {
          [activeRequestRootMessageId]: {
            rootMessageId: activeRequestRootMessageId,
            attemptId: settledEnvelopes[0]?.requestContextId ?? settledEnvelopes[0]?.requestId ?? activeRequestRootMessageId,
            firstSeenOrdinal: 0,
            envelopes: settledEnvelopes,
            nextCompactionAt: settledEnvelopes.length + 500,
          },
        }
      : {};
  useChatSessionStream({
    sessionId,
    canOpenStream: true,
    isExecuting,
    hasInFlightRequest,
    activeRun,
    acceptedRun: null,
    hasLocalEnvelopes: true,
    shouldDeferSnapshotLoad: false,
    suppressAutomaticSnapshotRefresh,
    activeRequestRootMessageId,
    settledLiveByRoot,
    turnBlocks: [] as readonly TurnBlock[],
    appendEnvelope: () => {},
    appendEnvelopes: () => {},
    setStreaming,
    setStreamConnectionState: () => {},
    loadConversation,
    loadSessions,
    settleRequestFromTerminal,
    acceptRequestFromStream: () => false,
    reconcilePendingRequestFromLiveEnvelope: () => false,
    onSessionEntrySnapshot,
  });
  return null;
}

function makeTerminalEnvelope(overrides: Partial<StreamEnvelope> = {}): StreamEnvelope {
  return {
    eventId: 'evt-terminal',
    sessionId: 'session-1',
    requestId: 'run-live',
    runId: 'run-live',
    sequence: 9,
    eventType: 'REQUEST_FAILED',
    timelineEventRef: null,
    transportHints: ['SSE'],
    payload: {
      rootMessageId: 'root-live',
      status: 'FAILED',
      content: 'Request failed: Model invocation timed out.',
    },
    createdAt: '2026-07-06T10:00:00.000Z',
    ...overrides,
  } as StreamEnvelope;
}

function makeLiveEnvelope(overrides: Partial<StreamEnvelope> = {}): StreamEnvelope {
  return {
    eventId: 'evt-live',
    sessionId: 'session-1',
    requestId: 'run-live',
    runId: 'run-live',
    rootMessageId: 'root-live',
    sequence: 8,
    eventType: 'LLM_CONTENT_DELTA',
    timelineEventRef: null,
    transportHints: ['WEBSOCKET'],
    payload: {
      rootMessageId: 'root-live',
      content: 'delta',
    },
    createdAt: '2026-07-06T09:59:59.000Z',
    ...overrides,
  } as StreamEnvelope;
}

describe('useChatSessionStream terminal refresh', () => {
  beforeEach(() => {
    streamHookState.latestParams = null;
    useConversationStore.setState({
      runtimeBySession: {
        'session-1': defaultSessionRuntimeState('session-1'),
      },
    });
    useUserInputStore.getState().clear();
    useBackgroundTaskStore.setState({ tasksBySession: {} });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('routes an old-attempt background task terminal independently of the active conversation attempt', () => {
    useBackgroundTaskStore.getState().seedTasks('session-1', [
      {
        taskId: 'task-old-attempt',
        commandName: 'sleep',
        commandLine: 'sleep 30',
        status: 'RUNNING',
        startedAt: 1_000,
        stdoutRef: 'out.txt',
        stderrRef: 'err.txt',
      },
    ]);

    render(
      <Harness
        sessionId="session-1"
        isExecuting
        hasInFlightRequest
        activeRun={{ requestId: 'root-new', runId: 'run-new', status: 'EXECUTING' }}
        activeRequestRootMessageId="root-new"
        loadConversation={vi.fn().mockResolvedValue(true)}
        loadSessions={vi.fn().mockResolvedValue(undefined)}
        settleRequestFromTerminal={vi.fn(() => false)}
        setStreaming={vi.fn()}
      />,
    );

    act(() => {
      streamHookState.latestParams?.onLiveEnvelope?.(
        makeLiveEnvelope({
          eventId: 'evt-background-completed',
          requestId: 'request-old-attempt',
          runId: 'run-old-attempt',
          rootMessageId: 'root-old-attempt',
          requestContextId: 'attempt-old',
          eventType: 'BACKGROUND_TASK_COMPLETED',
          payload: {
            taskId: 'task-old-attempt',
            commandName: 'sleep',
            status: 'COMPLETED',
            startedAt: 1_000,
            finishedAt: 2_000,
            exitCode: 0,
            stdoutRef: 'out.txt',
            stderrRef: 'err.txt',
          },
        }),
      );
    });

    expect(useBackgroundTaskStore.getState().tasksBySession['session-1']?.[0]).toMatchObject({
      taskId: 'task-old-attempt',
      commandLine: 'sleep 30',
      status: 'COMPLETED',
      finishedAt: 2_000,
    });
  });

  it('settles the active request after terminal without refreshing conversation state', async () => {
    const loadSessions = vi.fn().mockResolvedValue(undefined);
    const setStreaming = vi.fn();
    const settleRequestFromTerminal = vi.fn(() => true);
    const loadConversation = vi.fn().mockResolvedValue(true);

    render(
      <Harness
        sessionId="session-1"
        isExecuting
        hasInFlightRequest
        activeRun={{ requestId: 'root-live', runId: 'run-live', status: 'EXECUTING' }}
        activeRequestRootMessageId="root-live"
        loadConversation={loadConversation}
        loadSessions={loadSessions}
        settleRequestFromTerminal={settleRequestFromTerminal}
        setStreaming={setStreaming}
      />,
    );

    loadSessions.mockClear();
    loadConversation.mockClear();
    setStreaming.mockClear();
    settleRequestFromTerminal.mockClear();

    await act(async () => {
      streamHookState.latestParams?.onTerminal?.(makeTerminalEnvelope());
      await Promise.resolve();
    });

    expect(settleRequestFromTerminal).toHaveBeenCalledTimes(1);
    expect(settleRequestFromTerminal).toHaveBeenCalledWith(expect.objectContaining({ eventType: 'REQUEST_FAILED', requestId: 'run-live' }));
    expect(loadSessions).toHaveBeenCalledTimes(1);
    expect(loadConversation).not.toHaveBeenCalled();
    expect(setStreaming).toHaveBeenCalledWith(false);
  });

  it('does not clear a newer active run when an older attempt terminal shares its root', async () => {
    const activeRun = {
      requestId: 'root-shared',
      runId: 'run-new',
      status: 'EXECUTING',
    } as const;
    const loadSessions = vi.fn().mockResolvedValue(undefined);
    const setStreaming = vi.fn();
    const settleRequestFromTerminal = vi.fn(() => false);
    useConversationStore.getState().setRuntimeState('session-1', { activeRun });

    render(
      <Harness
        sessionId="session-1"
        isExecuting
        hasInFlightRequest
        activeRun={activeRun}
        activeRequestRootMessageId="root-shared"
        loadConversation={vi.fn().mockResolvedValue(true)}
        loadSessions={loadSessions}
        settleRequestFromTerminal={settleRequestFromTerminal}
        setStreaming={setStreaming}
      />,
    );

    loadSessions.mockClear();
    setStreaming.mockClear();
    settleRequestFromTerminal.mockClear();

    await act(async () => {
      streamHookState.latestParams?.onTerminal?.(
        makeTerminalEnvelope({
          requestId: 'root-shared',
          runId: 'run-old',
          rootMessageId: 'root-shared',
          requestContextId: 'context-old',
          payload: {
            rootMessageId: 'root-shared',
            requestId: 'root-shared',
            runId: 'run-old',
            requestContextId: 'context-old',
            status: 'FAILED',
          },
        }),
      );
      await Promise.resolve();
    });

    expect(settleRequestFromTerminal).toHaveBeenCalledTimes(1);
    expect(useConversationStore.getState().runtimeBySession['session-1']?.activeRun).toEqual(activeRun);
    expect(setStreaming).not.toHaveBeenCalled();
  });

  it('settles an exact live terminal after the accepted identity arrives', async () => {
    const terminalEnvelope = makeTerminalEnvelope();
    const loadSessions = vi.fn().mockResolvedValue(undefined);
    const setStreaming = vi.fn();
    const settleRequestFromTerminal = vi.fn(() => true);
    const loadConversation = vi.fn().mockResolvedValue(true);
    const commonProps = {
      sessionId: 'session-1',
      isExecuting: true,
      hasInFlightRequest: true,
      activeRun: null,
      loadConversation,
      loadSessions,
      settleRequestFromTerminal,
      setStreaming,
    } as const;

    const { rerender } = render(<Harness activeRequestRootMessageId={null} {...commonProps} />);

    await act(async () => {
      streamHookState.latestParams?.onTerminal?.(terminalEnvelope);
      await Promise.resolve();
    });
    expect(settleRequestFromTerminal).not.toHaveBeenCalled();

    rerender(<Harness activeRequestRootMessageId="another-root" settledEnvelopes={[terminalEnvelope]} {...commonProps} />);
    await act(async () => {
      await Promise.resolve();
    });
    expect(settleRequestFromTerminal).not.toHaveBeenCalled();

    rerender(<Harness activeRequestRootMessageId="root-live" settledEnvelopes={[terminalEnvelope]} {...commonProps} />);

    await act(async () => {
      await Promise.resolve();
    });
    expect(settleRequestFromTerminal).toHaveBeenCalledTimes(1);
    expect(settleRequestFromTerminal).toHaveBeenCalledWith(terminalEnvelope);
    expect(setStreaming).toHaveBeenCalledWith(false);
    expect(useConversationStore.getState().runtimeBySession['session-1']?.activeRun).toBeNull();
  });

  it('refreshes the session list for an in-flight session even when no active request is tracked locally', async () => {
    const loadSessions = vi.fn().mockResolvedValue(undefined);
    const setStreaming = vi.fn();
    const settleRequestFromTerminal = vi.fn(() => false);
    const loadConversation = vi.fn().mockResolvedValue(true);

    render(
      <Harness
        sessionId="session-1"
        isExecuting={false}
        hasInFlightRequest
        activeRun={{ requestId: 'root-live', runId: 'run-live', status: 'EXECUTING' }}
        activeRequestRootMessageId={null}
        loadConversation={loadConversation}
        loadSessions={loadSessions}
        settleRequestFromTerminal={settleRequestFromTerminal}
        setStreaming={setStreaming}
      />,
    );

    loadSessions.mockClear();
    loadConversation.mockClear();
    setStreaming.mockClear();
    settleRequestFromTerminal.mockClear();

    await act(async () => {
      streamHookState.latestParams?.onTerminal?.(makeTerminalEnvelope());
      await Promise.resolve();
    });

    expect(settleRequestFromTerminal).toHaveBeenCalledTimes(1);
    expect(loadSessions).toHaveBeenCalledTimes(1);
    expect(loadConversation).not.toHaveBeenCalled();
    expect(setStreaming).toHaveBeenCalledWith(false);
    expect(useConversationStore.getState().runtimeBySession['session-1']?.activeRun).toBeNull();
  });

  it('does not reload the same session when an anchored snapshot becomes the continuous latest window', async () => {
    const loadSessions = vi.fn().mockResolvedValue(undefined);
    const setStreaming = vi.fn();
    const settleRequestFromTerminal = vi.fn(() => false);
    const loadConversation = vi.fn().mockResolvedValue(true);
    const commonProps = {
      isExecuting: false,
      hasInFlightRequest: false,
      activeRun: null,
      activeRequestRootMessageId: null,
      loadConversation,
      loadSessions,
      settleRequestFromTerminal,
      setStreaming,
    } as const;

    const { rerender } = render(<Harness sessionId="session-1" suppressAutomaticSnapshotRefresh {...commonProps} />);
    expect(loadConversation).not.toHaveBeenCalled();

    rerender(<Harness sessionId="session-1" suppressAutomaticSnapshotRefresh={false} {...commonProps} />);
    await act(async () => Promise.resolve());
    expect(loadConversation).not.toHaveBeenCalled();

    rerender(<Harness sessionId="session-2" suppressAutomaticSnapshotRefresh={false} {...commonProps} />);
    await act(async () => Promise.resolve());
    expect(loadConversation).toHaveBeenCalledWith('session-2', { background: true, merge: false });
  });

  it('notifies after the session entry snapshot resolves', async () => {
    const loadSessions = vi.fn().mockResolvedValue(undefined);
    const setStreaming = vi.fn();
    const loadConversation = vi.fn().mockResolvedValue(true);
    const onSessionEntrySnapshot = vi.fn();

    render(
      <Harness
        sessionId="session-1"
        isExecuting={false}
        hasInFlightRequest={false}
        activeRun={null}
        activeRequestRootMessageId={null}
        loadConversation={loadConversation}
        loadSessions={loadSessions}
        settleRequestFromTerminal={() => false}
        setStreaming={setStreaming}
        onSessionEntrySnapshot={onSessionEntrySnapshot}
      />,
    );

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(loadConversation).toHaveBeenCalledTimes(1);
    expect(onSessionEntrySnapshot).toHaveBeenCalledWith('session-1');
  });

  it('does not notify when the session entry snapshot fails to refresh', async () => {
    const loadSessions = vi.fn().mockResolvedValue(undefined);
    const setStreaming = vi.fn();
    const loadConversation = vi.fn().mockResolvedValue(false);
    const onSessionEntrySnapshot = vi.fn();

    render(
      <Harness
        sessionId="session-1"
        isExecuting={false}
        hasInFlightRequest={false}
        activeRun={null}
        activeRequestRootMessageId={null}
        loadConversation={loadConversation}
        loadSessions={loadSessions}
        settleRequestFromTerminal={() => false}
        setStreaming={setStreaming}
        onSessionEntrySnapshot={onSessionEntrySnapshot}
      />,
    );

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(loadConversation).toHaveBeenCalledTimes(1);
    expect(onSessionEntrySnapshot).not.toHaveBeenCalled();
  });
});
