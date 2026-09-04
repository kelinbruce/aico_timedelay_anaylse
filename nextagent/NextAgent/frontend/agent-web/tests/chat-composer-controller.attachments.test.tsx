// @vitest-environment jsdom
import { act, cleanup, render, waitFor } from '@testing-library/react';
import { useEffect } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useChatComposerController } from '../src/features/chat/hooks/useChatComposerController.ts';
import { runtimeConfig } from '../src/config/runtimeConfig.ts';

type Controller = ReturnType<typeof useChatComposerController>;
import { requestService } from '../src/services/requestService.ts';
import { useRequestStore } from '../src/state/requestStore.ts';
import { useSessionStore } from '../src/state/sessionStore.ts';
import type { TurnBlock } from '../src/state/contracts.ts';
import type { ChatNavigationAdapter } from '../src/features/chat/chatNavigation.ts';

const makeFile = (name: string, content = 'content') => new File([content], name, { type: 'text/plain' });

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

const originalSubmitRequestWithAttachments = useRequestStore.getState().submitRequestWithAttachments;
const originalChatUploadFileConfig = runtimeConfig.chatUploadFileConfig;

describe('useChatComposerController attachments', () => {
  beforeEach(() => {
    runtimeConfig.chatUploadFileConfig = {
      chatUploadFileType: ['*.md'],
      chatUploadMaxFileNumber: 10,
      chatUploadMaxFileSize: 10,
      uploadFileIdleExpireTime: 5,
      uploadFileMaxExpireTime: 30,
    };
    useSessionStore.getState().setActiveSessionId(null);
    vi.spyOn(requestService, 'stageAttachment').mockResolvedValue({
      tempRunId: 'temp-run',
      fileName: 'note.md',
      sizeBytes: 7,
    });
    vi.spyOn(requestService, 'deleteStagedAttachment').mockResolvedValue(undefined);
    useRequestStore.setState({
      submitRequestWithAttachments: vi.fn().mockResolvedValue({
        sessionId: 'session-a',
        requestId: 'req-1',
        runId: 'run-1',
        attempt: 1,
      }),
    });
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.restoreAllMocks();
    if (originalChatUploadFileConfig === undefined) {
      delete runtimeConfig.chatUploadFileConfig;
    } else {
      runtimeConfig.chatUploadFileConfig = originalChatUploadFileConfig;
    }
    useRequestStore.setState({ submitRequestWithAttachments: originalSubmitRequestWithAttachments });
  });

  it('stages files immediately on add and reuses one tempRunId per input session', async () => {
    let controller: Controller | null = null;
    render(
      <Harness
        sessionId="session-a"
        onController={(c) => {
          controller = c;
        }}
      />,
    );

    await waitFor(() => expect(controller).not.toBeNull());

    await act(async () => {
      await controller!.handleAddAttachments([makeFile('a.md'), makeFile('b.md')]);
    });

    expect(controller!.attachmentItems).toHaveLength(2);
    expect(controller!.attachmentItems.every((i) => i.status === 'uploaded')).toBe(true);
    expect(requestService.stageAttachment).toHaveBeenCalledTimes(2);
    const calls = vi.mocked(requestService.stageAttachment).mock.calls;
    const tempRunId = calls[0]![1];
    expect(calls[1]![1]).toBe(tempRunId);
    expect(calls[0]![2].name).toBe('a.md');
    expect(calls[1]![2].name).toBe('b.md');
  });

  it('submits staged refs (not File objects) and clears the queue on send', async () => {
    let controller: Controller | null = null;
    render(
      <Harness
        sessionId="session-a"
        onController={(c) => {
          controller = c;
        }}
      />,
    );

    await waitFor(() => expect(controller).not.toBeNull());

    await act(async () => {
      await controller!.handleAddAttachments([makeFile('note.md')]);
    });

    await act(async () => {
      await controller!.handleSend('hello');
    });

    const submit = useRequestStore.getState().submitRequestWithAttachments as ReturnType<typeof vi.fn>;
    expect(submit).toHaveBeenCalledWith(
      'hello',
      [{ tempRunId: 'temp-run', fileName: 'note.md' }],
      [{ fileName: 'note.md', mediaType: 'MARKDOWN', sizeBytes: 7 }],
      undefined,
    );
    expect(controller!.attachmentItems).toHaveLength(0);
  });

  it('yields one browser task before submitting into an existing session', async () => {
    let controller: Controller | null = null;
    render(
      <Harness
        sessionId="session-a"
        onController={(c) => {
          controller = c;
        }}
      />,
    );

    await waitFor(() => expect(controller).not.toBeNull());
    vi.useFakeTimers();

    let sendPromise!: Promise<void>;
    await act(async () => {
      sendPromise = controller!.handleSend('hello');
      await Promise.resolve();
    });

    const submit = useRequestStore.getState().submitRequestWithAttachments as ReturnType<typeof vi.fn>;
    expect(submit).not.toHaveBeenCalled();

    await act(async () => {
      await vi.runOnlyPendingTimersAsync();
      await sendPromise;
    });

    expect(submit).toHaveBeenCalledTimes(1);
  });

  it('does not submit into another session when navigation wins during the yielded task', async () => {
    let controller: Controller | null = null;
    render(
      <Harness
        sessionId="session-a"
        onController={(c) => {
          controller = c;
        }}
      />,
    );

    await waitFor(() => expect(controller).not.toBeNull());
    vi.useFakeTimers();

    let sendPromise!: Promise<void>;
    await act(async () => {
      sendPromise = controller!.handleSend('hello');
      await Promise.resolve();
    });
    act(() => {
      useSessionStore.getState().setActiveSessionId('session-b');
    });

    await act(async () => {
      const rejection = expect(sendPromise).rejects.toThrow('Active session changed before request submission.');
      await vi.runOnlyPendingTimersAsync();
      await rejection;
    });

    const submit = useRequestStore.getState().submitRequestWithAttachments as ReturnType<typeof vi.fn>;
    expect(submit).not.toHaveBeenCalled();
    expect(useSessionStore.getState().activeSessionId).toBe('session-b');
  });

  it('restarts expiry timers and deletes the replacement after replacing an expired file', async () => {
    vi.mocked(requestService.stageAttachment).mockImplementation(async (_sessionId, tempRunId, file) => ({
      tempRunId,
      fileName: file.name,
      sizeBytes: file.size,
    }));
    runtimeConfig.chatUploadFileConfig = {
      chatUploadFileType: ['*.md'],
      chatUploadMaxFileNumber: 10,
      chatUploadMaxFileSize: 10,
      uploadFileIdleExpireTime: 1,
      uploadFileMaxExpireTime: 2,
    };

    let controller: Controller | null = null;
    render(
      <Harness
        sessionId="session-a"
        onController={(c) => {
          controller = c;
        }}
      />,
    );

    await waitFor(() => expect(controller).not.toBeNull());
    vi.useFakeTimers();

    await act(async () => {
      await controller!.handleAddAttachments([makeFile('note.md')]);
    });

    expect(controller!.attachmentItems[0]!.status).toBe('uploaded');
    expect(controller!.uploadExpireNotice).toBeNull();
    const firstTempRunId = vi.mocked(requestService.stageAttachment).mock.calls[0]![1];

    act(() => {
      vi.advanceTimersByTime(48 * 1000);
    });
    expect(controller!.uploadExpireNotice).not.toBeNull();
    expect(controller!.attachmentItems[0]!.status).toBe('uploaded');

    act(() => {
      vi.advanceTimersByTime(12 * 1000);
    });
    expect(controller!.attachmentItems[0]!.status).toBe('expired');
    expect(requestService.deleteStagedAttachment).toHaveBeenCalledTimes(1);
    expect(vi.mocked(requestService.deleteStagedAttachment).mock.calls).toContainEqual(['session-a', firstTempRunId, 'note.md']);

    await act(async () => {
      await controller!.handleAddAttachments([makeFile('replacement.md')]);
    });

    expect(controller!.attachmentItems).toHaveLength(1);
    expect(controller!.attachmentItems[0]!.status).toBe('uploaded');
    expect(controller!.uploadExpireNotice).toBeNull();
    const replacementTempRunId = vi.mocked(requestService.stageAttachment).mock.calls[1]![1];

    act(() => {
      vi.advanceTimersByTime(48 * 1000);
    });
    expect(controller!.uploadExpireNotice).not.toBeNull();
    expect(controller!.attachmentItems[0]!.status).toBe('uploaded');

    act(() => {
      vi.advanceTimersByTime(12 * 1000);
    });
    expect(controller!.attachmentItems[0]!.status).toBe('expired');
    expect(requestService.deleteStagedAttachment).toHaveBeenCalledTimes(2);
    const deleteCalls = vi.mocked(requestService.deleteStagedAttachment).mock.calls;
    expect(deleteCalls).toContainEqual(['session-a', replacementTempRunId, 'replacement.md']);
    expect(replacementTempRunId).not.toBe(firstTempRunId);
  });

  it('keeps the maximum expiry deadline when another upload resets idle expiry', async () => {
    vi.mocked(requestService.stageAttachment).mockImplementation(async (_sessionId, tempRunId, file) => ({
      tempRunId,
      fileName: file.name,
      sizeBytes: file.size,
    }));
    runtimeConfig.chatUploadFileConfig = {
      chatUploadFileType: ['*.md'],
      chatUploadMaxFileNumber: 10,
      chatUploadMaxFileSize: 10,
      uploadFileIdleExpireTime: 2,
      uploadFileMaxExpireTime: 3,
    };

    let controller: Controller | null = null;
    render(
      <Harness
        sessionId="session-a"
        onController={(c) => {
          controller = c;
        }}
      />,
    );

    await waitFor(() => expect(controller).not.toBeNull());
    vi.useFakeTimers();

    await act(async () => {
      await controller!.handleAddAttachments([makeFile('first.md')]);
    });

    act(() => {
      vi.advanceTimersByTime(90 * 1000);
    });

    await act(async () => {
      await controller!.handleAddAttachments([makeFile('second.md')]);
    });

    expect(controller!.attachmentItems.every((item) => item.status === 'uploaded')).toBe(true);
    const stageCalls = vi.mocked(requestService.stageAttachment).mock.calls;

    act(() => {
      vi.advanceTimersByTime(72 * 1000);
    });
    expect(controller!.uploadExpireNotice).not.toBeNull();
    expect(controller!.attachmentItems.every((item) => item.status === 'uploaded')).toBe(true);

    act(() => {
      vi.advanceTimersByTime(18 * 1000);
    });
    expect(controller!.attachmentItems.every((item) => item.status === 'expired')).toBe(true);
    expect(requestService.deleteStagedAttachment).toHaveBeenCalledTimes(2);
    const deleteCalls = vi.mocked(requestService.deleteStagedAttachment).mock.calls;
    expect(deleteCalls).toContainEqual(['session-a', stageCalls[0]![1], 'first.md']);
    expect(deleteCalls).toContainEqual(['session-a', stageCalls[1]![1], 'second.md']);
  });

  it('calls deleteStagedAttachment when removing an uploaded file', async () => {
    let controller: Controller | null = null;
    render(
      <Harness
        sessionId="session-a"
        onController={(c) => {
          controller = c;
        }}
      />,
    );

    await waitFor(() => expect(controller).not.toBeNull());

    await act(async () => {
      await controller!.handleAddAttachments([makeFile('note.md')]);
    });

    const localId = controller!.attachmentItems[0]!.localId;

    act(() => {
      controller!.handleRemoveAttachment(localId);
    });

    await waitFor(() => expect(controller!.attachmentItems).toHaveLength(0));
    expect(requestService.deleteStagedAttachment).toHaveBeenCalledWith('session-a', 'temp-run', 'note.md');
  });

  it('re-stages a failed attachment on retry', async () => {
    vi.mocked(requestService.stageAttachment)
      .mockRejectedValueOnce(new Error('network'))
      .mockResolvedValueOnce({ tempRunId: 'temp-run', fileName: 'note.md', sizeBytes: 7 });

    let controller: Controller | null = null;
    render(
      <Harness
        sessionId="session-a"
        onController={(c) => {
          controller = c;
        }}
      />,
    );

    await waitFor(() => expect(controller).not.toBeNull());

    await act(async () => {
      await controller!.handleAddAttachments([makeFile('note.md')]);
    });

    const item = controller!.attachmentItems[0]!;
    expect(item.status).toBe('error');

    await act(async () => {
      await controller!.handleRetryAttachment(item.localId);
    });

    expect(requestService.stageAttachment).toHaveBeenCalledTimes(2);
    expect(controller!.attachmentItems[0]!.status).toBe('uploaded');
  });
});
