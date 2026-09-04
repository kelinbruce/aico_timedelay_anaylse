// @vitest-environment jsdom
import { act, cleanup, render, waitFor } from '@testing-library/react';
import { useEffect } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { buildComposerDraftStorageKey, useChatComposerController } from '../src/features/chat/hooks/useChatComposerController.ts';
import { useConversationStore } from '../src/state/conversationStore.ts';
import { useRequestStore } from '../src/state/requestStore.ts';
import type { TurnBlock } from '../src/state/contracts.ts';
import type { ChatNavigationAdapter } from '../src/features/chat/chatNavigation.ts';

type Controller = ReturnType<typeof useChatComposerController>;
const originalSubmitRequest = useRequestStore.getState().submitRequest;
const originalSubmitRequestWithAttachments = useRequestStore.getState().submitRequestWithAttachments;

function makeTurn(content: string): TurnBlock {
  return {
    rootMessageId: `root-${content}`,
    userMessage: {
      messageId: `msg-${content}`,
      sessionId: 'session-a',
      content,
      createdAt: '2026-06-02T00:00:00.000Z',
      visible: true,
    },
    aiEvents: [],
    status: 'COMPLETED',
    isLatest: true,
  };
}

function Harness({
  sessionId,
  turnBlocks = [],
  onController,
}: {
  readonly sessionId: string | null;
  readonly turnBlocks?: readonly TurnBlock[];
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

describe('useChatComposerController draft cache', () => {
  afterEach(() => {
    cleanup();
    sessionStorage.clear();
    vi.useRealTimers();
    vi.restoreAllMocks();
    useRequestStore.setState({
      draftBeforeEdit: null,
      submitRequest: originalSubmitRequest,
      submitRequestWithAttachments: originalSubmitRequestWithAttachments,
    });
  });

  it('restores normal composer drafts by session when navigation changes', async () => {
    let controller: Controller | null = null;
    const onController = (nextController: Controller) => {
      controller = nextController;
    };
    const { rerender } = render(<Harness sessionId="session-a" onController={onController} />);

    await waitFor(() => {
      expect(controller).not.toBeNull();
    });
    act(() => {
      controller!.setComposerDraft('draft A');
    });
    sessionStorage.setItem(buildComposerDraftStorageKey('session-b'), 'draft B');

    rerender(<Harness sessionId="session-b" onController={onController} />);

    await waitFor(() => {
      expect(controller?.composerHydratedInput).toBe('draft B');
    });
    expect(sessionStorage.getItem(buildComposerDraftStorageKey('session-a'))).toBe('draft A');
    expect(sessionStorage.getItem(buildComposerDraftStorageKey('session-b'))).toBe('draft B');
  });

  it('debounces normal composer draft cache writes', async () => {
    let controller: Controller | null = null;
    const onController = (nextController: Controller) => {
      controller = nextController;
    };
    render(<Harness sessionId="session-a" onController={onController} />);

    await waitFor(() => {
      expect(controller).not.toBeNull();
    });
    vi.useFakeTimers();
    act(() => {
      controller!.setComposerDraft('draft A');
      controller!.setComposerDraft('draft AB');
    });

    expect(sessionStorage.getItem(buildComposerDraftStorageKey('session-a'))).toBeNull();
    act(() => {
      vi.advanceTimersByTime(249);
    });
    expect(sessionStorage.getItem(buildComposerDraftStorageKey('session-a'))).toBeNull();
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(sessionStorage.getItem(buildComposerDraftStorageKey('session-a'))).toBe('draft AB');
  });

  it('does not re-render the controller for normal draft typing', async () => {
    let controller: Controller | null = null;
    let renderCount = 0;
    const onController = (nextController: Controller) => {
      renderCount += 1;
      controller = nextController;
    };
    render(<Harness sessionId="session-a" onController={onController} />);

    await waitFor(() => {
      expect(controller).not.toBeNull();
    });
    const renderCountBeforeTyping = renderCount;
    act(() => {
      controller!.setComposerDraft('draft A');
    });

    expect(renderCount).toBe(renderCountBeforeTyping);
  });

  it('does not store edit-mode replacement text as the normal session draft', async () => {
    let controller: Controller | null = null;
    const onController = (nextController: Controller) => {
      controller = nextController;
    };
    render(<Harness sessionId="session-a" turnBlocks={[makeTurn('original request')]} onController={onController} />);

    await waitFor(() => {
      expect(controller).not.toBeNull();
    });
    act(() => {
      controller!.setComposerDraft('normal draft');
    });
    act(() => {
      controller!.handleEditRequest('root-original request');
    });

    await waitFor(() => {
      expect(controller?.composerHydratedInput).toBe('original request');
    });
    expect(sessionStorage.getItem(buildComposerDraftStorageKey('session-a'))).toBe('normal draft');
  });

  it('clears the hydrated input and cached draft after successful normal submit', async () => {
    let controller: Controller | null = null;
    const submitRequestWithAttachments = vi.fn().mockResolvedValue({
      sessionId: 'session-a',
      requestId: 'req-1',
      runId: 'run-1',
      attempt: 1,
    });
    useRequestStore.setState({
      submitRequestWithAttachments,
    });
    const onController = (nextController: Controller) => {
      controller = nextController;
    };
    render(<Harness sessionId="session-a" onController={onController} />);

    await waitFor(() => {
      expect(controller).not.toBeNull();
    });
    act(() => {
      controller!.setComposerDraft('draft A');
    });

    await act(async () => {
      await controller!.handleSend('draft A');
    });

    expect(submitRequestWithAttachments).toHaveBeenCalledWith('draft A', [], [], undefined);
    await waitFor(() => {
      expect(controller?.composerHydratedInput).toBe('');
    });
    expect(sessionStorage.getItem(buildComposerDraftStorageKey('session-a'))).toBeNull();
  });

  it('exposes handleClearConversation that delegates to conversationStore.clearConversation', async () => {
    const clearConversation = vi.fn();
    const originalClearConversation = useConversationStore.getState().clearConversation;
    useConversationStore.setState({ clearConversation });

    let controller: Controller | null = null;
    const onController = (nextController: Controller) => {
      controller = nextController;
    };
    render(<Harness sessionId="session-a" onController={onController} />);

    await waitFor(() => {
      expect(controller).not.toBeNull();
    });
    act(() => {
      controller!.handleClearConversation();
    });

    expect(clearConversation).toHaveBeenCalledWith('session-a');
    useConversationStore.setState({ clearConversation: originalClearConversation });
  });
});
