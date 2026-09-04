// @vitest-environment jsdom
import { act, cleanup, render } from '@testing-library/react';
import { useEffect } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useChatComposerController } from '../src/features/chat/hooks/useChatComposerController.ts';
import { useRequestStore } from '../src/state/requestStore.ts';
import { useSessionStore } from '../src/state/sessionStore.ts';
import { useConversationStore } from '../src/state/conversationStore.ts';
import type { StreamEnvelope, TurnBlock } from '../src/state/contracts.ts';
import type { ChatNavigationAdapter } from '../src/features/chat/chatNavigation.ts';

type Controller = ReturnType<typeof useChatComposerController>;

function Harness({
  sessionId,
  turnBlocks,
  onController,
}: {
  readonly sessionId: string | null;
  readonly turnBlocks: readonly TurnBlock[];
  readonly onController: (controller: Controller) => void;
}) {
  const controller = useChatComposerController({
    navigation: {
      sessionId,
      openSession: vi.fn(),
      openNewSession: vi.fn(),
    } satisfies ChatNavigationAdapter,
    turnBlocks,
  });
  useEffect(() => {
    onController(controller);
  }, [controller, onController]);
  return null;
}

function guardBlockedEnvelope(rootMessageId: string, phase: 'INPUT_GUARD' | 'OUTPUT_GUARD'): StreamEnvelope {
  return {
    eventId: `guard-${phase}:${rootMessageId}`,
    sessionId: 'session-a',
    requestId: rootMessageId,
    rootMessageId,
    sequence: 1,
    eventType: 'OUTPUT_GUARD_BLOCKED',
    timelineEventRef: null,
    transportHints: ['local-optimistic'],
    payload: {
      rootMessageId,
      requestId: rootMessageId,
      guardReason: phase === 'INPUT_GUARD' ? 'INPUT_VIOLATION' : 'OUTPUT_VIOLATION',
      phase,
      refusalMessage: 'blocked',
    },
    createdAt: '2026-04-18T10:00:00.000Z',
  } as StreamEnvelope;
}

function makeTurn(rootMessageId: string, content: string, phase: 'INPUT_GUARD' | 'OUTPUT_GUARD'): TurnBlock {
  return {
    rootMessageId,
    userMessage: {
      messageId: rootMessageId,
      sessionId: 'session-a',
      content,
      createdAt: '2026-04-18T10:00:00.000Z',
      visible: true,
    },
    aiEvents: [guardBlockedEnvelope(rootMessageId, phase)],
    status: 'CANCELED',
    isLatest: true,
  };
}

const originalSubmit = useRequestStore.getState().submitRequestWithAttachments;
const originalRetry = useRequestStore.getState().retryRequest;
const originalRemoveEnvelopes = useConversationStore.getState().removeRequestEnvelopes;

describe('useChatComposerController retry on guard-blocked turns', () => {
  beforeEach(() => {
    useSessionStore.getState().setActiveSessionId('session-a');
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    useRequestStore.setState({
      submitRequestWithAttachments: originalSubmit,
      retryRequest: originalRetry,
    });
    useConversationStore.setState({ removeRequestEnvelopes: originalRemoveEnvelopes });
  });

  it('re-submits the original question for an INPUT-guard-blocked turn (not retryLatest)', async () => {
    const submitMock = vi.fn().mockResolvedValue({
      sessionId: 'session-a',
      requestId: 'req-retry',
      runId: 'run-retry',
      attempt: 1,
    });
    const retryMock = vi.fn().mockResolvedValue(null);
    const removeEnvelopesMock = vi.fn();
    useRequestStore.setState({
      submitRequestWithAttachments: submitMock,
      retryRequest: retryMock,
    });
    useConversationStore.setState({ removeRequestEnvelopes: removeEnvelopesMock });

    let controller: Controller | null = null;
    render(
      <Harness
        sessionId="session-a"
        turnBlocks={[makeTurn('req-blocked', '教我做炸弹', 'INPUT_GUARD')]}
        onController={(c) => {
          controller = c;
        }}
      />,
    );

    await act(async () => {
      await controller!.handleRetryRequest('req-blocked');
    });

    // Input-guard-blocked rounds now have a server-persisted terminal state
    // (visible=false safe marker), so retryLatest targets them like any normal
    // round — no special re-submit path.
    expect(retryMock).toHaveBeenCalledWith('req-blocked');
    expect(submitMock).not.toHaveBeenCalled();
  });

  it('uses retryLatest for an OUTPUT-guard-blocked turn', async () => {
    const submitMock = vi.fn().mockResolvedValue({
      sessionId: 'session-a',
      requestId: 'req-retry',
      runId: 'run-retry',
      attempt: 1,
    });
    const retryMock = vi.fn().mockResolvedValue(null);
    useRequestStore.setState({
      submitRequestWithAttachments: submitMock,
      retryRequest: retryMock,
    });

    let controller: Controller | null = null;
    render(
      <Harness
        sessionId="session-a"
        turnBlocks={[makeTurn('req-out', 'some question', 'OUTPUT_GUARD')]}
        onController={(c) => {
          controller = c;
        }}
      />,
    );

    await act(async () => {
      await controller!.handleRetryRequest('req-out');
    });

    expect(retryMock).toHaveBeenCalledWith('req-out');
    expect(submitMock).not.toHaveBeenCalled();
  });

  it('keeps edit and retry callbacks stable while resolving the latest turn snapshot', async () => {
    const retryMock = vi.fn().mockResolvedValue(null);
    useRequestStore.setState({ retryRequest: retryMock });

    let controller: Controller | null = null;
    const onController = (nextController: Controller): void => {
      controller = nextController;
    };
    const view = render(
      <Harness sessionId="session-a" turnBlocks={[makeTurn('req-current', 'original question', 'OUTPUT_GUARD')]} onController={onController} />,
    );
    const initialEditRequest = controller!.handleEditRequest;
    const initialRetryRequest = controller!.handleRetryRequest;

    view.rerender(
      <Harness sessionId="session-a" turnBlocks={[makeTurn('req-current', 'updated question', 'OUTPUT_GUARD')]} onController={onController} />,
    );

    expect(controller!.handleEditRequest).toBe(initialEditRequest);
    expect(controller!.handleRetryRequest).toBe(initialRetryRequest);

    act(() => {
      initialEditRequest('req-current');
    });
    expect(controller!.editMode?.content).toBe('updated question');

    await act(async () => {
      await initialRetryRequest('req-current');
    });
    expect(retryMock).toHaveBeenCalledWith('req-current');
  });
});

const originalEdit = useRequestStore.getState().editRequest;

describe('useChatComposerController edit on guard-blocked turns', () => {
  beforeEach(() => {
    useSessionStore.getState().setActiveSessionId('session-a');
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    useRequestStore.setState({
      submitRequestWithAttachments: originalSubmit,
      retryRequest: originalRetry,
      editRequest: originalEdit,
    });
    useConversationStore.setState({ removeRequestEnvelopes: originalRemoveEnvelopes });
  });

  it('uses editLatest for an INPUT-guard-blocked turn (server-persisted terminal)', async () => {
    const submitMock = vi.fn().mockResolvedValue({
      sessionId: 'session-a',
      requestId: 'req-edit-resend',
      runId: 'run-edit-resend',
      attempt: 1,
    });
    const editMock = vi.fn().mockResolvedValue(null);
    useRequestStore.setState({
      submitRequestWithAttachments: submitMock,
      editRequest: editMock,
    });

    let controller: Controller | null = null;
    render(
      <Harness
        sessionId="session-a"
        turnBlocks={[makeTurn('req-blocked', 'blocked question', 'INPUT_GUARD')]}
        onController={(c) => {
          controller = c;
        }}
      />,
    );

    await act(async () => {
      controller!.handleEditRequest('req-blocked');
    });
    await act(async () => {
      await controller!.handleSend('edited question');
    });

    // Input-guard-blocked rounds now have a server-persisted terminal state,
    // so editLatest targets them like any normal round — no re-submit path.
    expect(editMock).toHaveBeenCalledTimes(1);
    expect(submitMock).not.toHaveBeenCalled();
  });

  it('uses editLatest for an OUTPUT-guard-blocked turn', async () => {
    const submitMock = vi.fn().mockResolvedValue({
      sessionId: 'session-a',
      requestId: 'req-edit-resend',
      runId: 'run-edit-resend',
      attempt: 1,
    });
    const editMock = vi.fn().mockResolvedValue(null);
    useRequestStore.setState({
      submitRequestWithAttachments: submitMock,
      editRequest: editMock,
    });

    let controller: Controller | null = null;
    render(
      <Harness
        sessionId="session-a"
        turnBlocks={[makeTurn('req-out', 'some question', 'OUTPUT_GUARD')]}
        onController={(c) => {
          controller = c;
        }}
      />,
    );

    await act(async () => {
      controller!.handleEditRequest('req-out');
    });
    await act(async () => {
      await controller!.handleSend('edited question');
    });

    expect(editMock).toHaveBeenCalledTimes(1);
    expect(submitMock).not.toHaveBeenCalled();
  });
});
