// @vitest-environment jsdom

import { act, cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/services/sessionActivityService.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/services/sessionActivityService.ts')>();
  return {
    ...actual,
    sessionActivityService: {
      consume: vi.fn().mockResolvedValue(undefined),
    },
  };
});

import { SessionActivityTerminalObserver } from '../src/pages/ChatPage.tsx';
import { sessionActivityService } from '../src/services/sessionActivityService.ts';
import { useSessionActivityStore } from '../src/state/sessionActivityStore.ts';
import type { StreamEnvelope, TurnBlock } from '../src/state/contracts.ts';

function makeTerminalBlock({
  status = 'COMPLETED',
  eventRunId = 'run-presented',
  displayRunId,
}: {
  readonly status?: TurnBlock['status'];
  readonly eventRunId?: string | null;
  readonly displayRunId?: string;
} = {}): TurnBlock {
  const terminal: StreamEnvelope = {
    eventId: 'event-terminal',
    sessionId: 'session-1',
    requestId: 'request-1',
    runId: eventRunId,
    rootMessageId: 'root-1',
    requestContextId: 'context-1',
    sequence: 3,
    eventType: status === 'FAILED' ? 'REQUEST_FAILED' : 'REQUEST_COMPLETED',
    timelineEventRef: null,
    transportHints: ['SSE'],
    payload: {},
    createdAt: '2026-07-28T10:00:00.000Z',
  };
  return {
    rootMessageId: 'root-1',
    ...(displayRunId ? { displayRunId } : {}),
    userMessage: {
      messageId: 'root-1',
      sessionId: 'session-1',
      requestContextId: null,
      rootMessageId: 'root-1',
      role: 'USER',
      sequence: 1,
      content: 'question',
      contentType: 'PLAIN_TEXT',
      metadata: {},
      createdAt: '2026-07-28T09:59:00.000Z',
      visible: true,
    },
    aiEvents: [terminal],
    status,
    isLatest: true,
  };
}

function renderObserver(overrides: Partial<Parameters<typeof SessionActivityTerminalObserver>[0]> = {}) {
  const props: Parameters<typeof SessionActivityTerminalObserver>[0] = {
    sessionId: 'session-1',
    activeSessionId: 'session-1',
    conversationLoadState: 'ready',
    isConversationSurfaceVisible: true,
    turnBlocks: [makeTerminalBlock()],
    ...overrides,
  };
  return render(<SessionActivityTerminalObserver {...props} />);
}

describe('SessionActivityTerminalObserver', () => {
  beforeEach(() => {
    vi.mocked(sessionActivityService.consume).mockReset();
    vi.mocked(sessionActivityService.consume).mockResolvedValue(undefined);
    useSessionActivityStore.setState({
      entriesBySessionId: {
        'session-1': {
          sessionId: 'session-1',
          status: 'UNREAD_RESULT',
          activityId: 'activity-1',
        },
      },
      connectionGeneration: 0,
    });
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      value: 'visible',
    });
  });

  afterEach(() => {
    cleanup();
  });

  it('consumes the exact activity and latest presented run without clearing local projection', async () => {
    renderObserver({
      turnBlocks: [makeTerminalBlock({ eventRunId: 'run-old', displayRunId: 'run-presented' })],
    });

    await waitFor(() => {
      expect(sessionActivityService.consume).toHaveBeenCalledWith({
        sessionId: 'session-1',
        activityId: 'activity-1',
        observedRunId: 'run-presented',
        signal: expect.any(AbortSignal),
      });
    });
    expect(useSessionActivityStore.getState().entriesBySessionId['session-1']?.status).toBe('UNREAD_RESULT');
  });

  it.each([
    ['inactive route', { activeSessionId: 'session-2' }],
    ['loading conversation', { conversationLoadState: 'loading' }],
    ['failed conversation', { conversationLoadState: 'failed' }],
    ['hidden host surface', { isConversationSurfaceVisible: false }],
    ['non-terminal presentation', { turnBlocks: [makeTerminalBlock({ status: 'EXECUTING' })] }],
    ['transport terminal without presentation', { turnBlocks: [] }],
  ] as const)('does not consume for %s', async (_label, overrides) => {
    renderObserver(overrides);

    await act(async () => Promise.resolve());
    expect(sessionActivityService.consume).not.toHaveBeenCalled();
  });

  it('waits for document visibility and then consumes the already-presented terminal', async () => {
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      value: 'hidden',
    });
    renderObserver();

    await act(async () => Promise.resolve());
    expect(sessionActivityService.consume).not.toHaveBeenCalled();

    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      value: 'visible',
    });
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });

    await waitFor(() => {
      expect(sessionActivityService.consume).toHaveBeenCalledTimes(1);
    });
  });

  it('consumes after a covered or failed conversation surface becomes visible and ready', async () => {
    const props: Parameters<typeof SessionActivityTerminalObserver>[0] = {
      sessionId: 'session-1',
      activeSessionId: 'session-1',
      conversationLoadState: 'failed',
      isConversationSurfaceVisible: false,
      turnBlocks: [makeTerminalBlock()],
    };
    const view = render(<SessionActivityTerminalObserver {...props} />);

    await act(async () => Promise.resolve());
    expect(sessionActivityService.consume).not.toHaveBeenCalled();
    expect(useSessionActivityStore.getState().entriesBySessionId['session-1']?.status).toBe('UNREAD_RESULT');

    view.rerender(<SessionActivityTerminalObserver {...props} conversationLoadState="ready" isConversationSurfaceVisible />);

    await waitFor(() => {
      expect(sessionActivityService.consume).toHaveBeenCalledTimes(1);
    });
  });

  it('retries consumption when the conversation surface returns after aborting an in-flight attempt', async () => {
    const resolveConsumes: Array<() => void> = [];
    vi.mocked(sessionActivityService.consume).mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveConsumes.push(resolve);
        }),
    );
    const props: Parameters<typeof SessionActivityTerminalObserver>[0] = {
      sessionId: 'session-1',
      activeSessionId: 'session-1',
      conversationLoadState: 'ready',
      isConversationSurfaceVisible: true,
      turnBlocks: [makeTerminalBlock()],
    };
    const view = render(<SessionActivityTerminalObserver {...props} />);
    await waitFor(() => {
      expect(sessionActivityService.consume).toHaveBeenCalledTimes(1);
    });

    view.rerender(<SessionActivityTerminalObserver {...props} isConversationSurfaceVisible={false} />);
    view.rerender(<SessionActivityTerminalObserver {...props} />);

    await waitFor(() => {
      expect(sessionActivityService.consume).toHaveBeenCalledTimes(2);
    });
    for (const resolveConsume of resolveConsumes) {
      resolveConsume();
    }
  });

  it('does not consume waiting or running activity even when a terminal is visible', async () => {
    useSessionActivityStore.setState({
      entriesBySessionId: {
        'session-1': {
          sessionId: 'session-1',
          status: 'RUNNING',
        },
      },
    });

    renderObserver();

    await act(async () => Promise.resolve());
    expect(sessionActivityService.consume).not.toHaveBeenCalled();
  });
});
