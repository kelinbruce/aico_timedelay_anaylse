import React from 'react';
import { cleanup, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ProcessPanelProps } from '../src/features/chat/components/ProcessPanel.tsx';
import { TurnBlockComponent } from '../src/features/chat/components/TurnBlock.tsx';
import type { StreamEnvelope, TurnBlock } from '../src/state/contracts.ts';
import { renderWithAppProviders as render } from './renderWithAppProviders.tsx';

vi.mock('../src/features/chat/components/ProcessPanel.tsx', () => ({
  ProcessPanel: ({ pendingSupplementalInputEntryKeys, latestAssistantAnswerPresentationOrder, processDisplayEntries }: ProcessPanelProps) => (
    <div
      data-testid="process-panel-props"
      data-has-pending-input={String(pendingSupplementalInputEntryKeys.size > 0)}
      data-pending-input-keys={[...pendingSupplementalInputEntryKeys].join(',')}
      data-latest-assistant-presentation-order={
        latestAssistantAnswerPresentationOrder === null ? 'none' : String(latestAssistantAnswerPresentationOrder)
      }
      data-latest-process-presentation-order={processDisplayEntries.at(-1)?.lastPresentationOrder ?? 'none'}
    />
  ),
}));

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function makeEvent(sequence: number, eventType: StreamEnvelope['eventType'], payload: Record<string, unknown>): StreamEnvelope {
  return {
    eventId: `event-${sequence}`,
    sessionId: 'session-1',
    requestId: 'request-1',
    runId: 'run-1',
    rootMessageId: 'root-1',
    requestContextId: 'context-1',
    sequence,
    eventType,
    timelineEventRef: null,
    transportHints: [],
    payload,
    createdAt: 1783346000000 + sequence,
  } as StreamEnvelope;
}

function makeBlock(aiEvents: readonly StreamEnvelope[]): TurnBlock {
  return {
    rootMessageId: 'root-1',
    displayRunId: 'run-1',
    userMessage: {
      messageId: 'root-1',
      sessionId: 'session-1',
      content: '检查链路',
      createdAt: '2026-07-28T00:00:00.000Z',
      visible: true,
    },
    aiEvents,
    status: 'EXECUTING',
    isLatest: true,
  };
}

function makeStreamingEvents(answer: string, trailingThinkingSequence?: number): readonly StreamEnvelope[] {
  const events = [
    makeEvent(1, 'LLM_THINKING_DELTA', {
      text: '正在分析链路',
      metadata: { accumulated: true },
    }),
    makeEvent(2, 'LLM_CONTENT_DELTA', {
      content: answer,
      contentType: 'MARKDOWN',
    }),
  ];
  if (trailingThinkingSequence !== undefined) {
    events.push(
      makeEvent(trailingThinkingSequence, 'LLM_THINKING_DELTA', {
        text: '正在核对链路指标',
        metadata: { accumulated: true },
      }),
    );
  }
  return events;
}

describe('TurnBlock process activity integration', () => {
  it('passes the latest visible assistant presentation order without treating later thinking as an answer', () => {
    render(
      <TurnBlockComponent
        block={makeBlock(makeStreamingEvents('阶段说明', 3))}
        onRetry={() => undefined}
        onEdit={() => undefined}
        onCancel={() => undefined}
      />,
    );

    expect(screen.getByTestId('process-panel-props').getAttribute('data-latest-assistant-presentation-order')).toBe('1');
  });

  it('keeps timeline sequence and history ordinal out of process-answer ordering', () => {
    render(
      <TurnBlockComponent
        block={makeBlock([
          {
            ...makeEvent(10, 'LLM_THINKING_DELTA', {
              text: '正在分析链路',
              metadata: { accumulated: true },
            }),
            createdAt: '2026-06-02T00:00:01.000Z',
          },
          {
            ...makeEvent(1, 'LLM_CONTENT_DELTA', {
              content: '最终答案开始输出',
              role: 'ASSISTANT',
              contentType: 'MARKDOWN',
            }),
            createdAt: '2026-06-02T00:00:02.000Z',
          },
        ])}
        onRetry={() => undefined}
        onEdit={() => undefined}
        onCancel={() => undefined}
      />,
    );

    const props = screen.getByTestId('process-panel-props');
    expect(props.getAttribute('data-latest-process-presentation-order')).toBe('0');
    expect(props.getAttribute('data-latest-assistant-presentation-order')).toBe('1');
  });

  it('treats a pending process explanation as superseding the preceding thinking entry', () => {
    render(
      <TurnBlockComponent
        block={makeBlock([
          makeEvent(1, 'LLM_THINKING_DELTA', {
            text: '正在分析链路',
            metadata: { accumulated: true },
          }),
          makeEvent(2, 'LLM_CONTENT_DELTA', {
            content: '我将继续核查路由收敛记录',
            stepId: 'step-route-convergence',
            contentType: 'MARKDOWN',
            metadata: { accumulated: true },
          }),
        ])}
        onRetry={() => undefined}
        onEdit={() => undefined}
        onCancel={() => undefined}
      />,
    );

    const props = screen.getByTestId('process-panel-props');
    expect(props.getAttribute('data-latest-process-presentation-order')).toBe('1');
    expect(props.getAttribute('data-latest-assistant-presentation-order')).toBe('1');
  });

  it('passes the pending supplemental-input presentation to ProcessPanel', () => {
    const required = makeEvent(1, 'USER_INPUT_REQUIRED', {
      kind: 'QUESTION',
      pendingInputId: 'pending-1',
      questions: [{ prompt: '请选择站点' }],
    });
    const { rerender } = render(
      <TurnBlockComponent block={makeBlock([required])} onRetry={() => undefined} onEdit={() => undefined} onCancel={() => undefined} />,
    );

    expect(screen.getByTestId('process-panel-props').getAttribute('data-has-pending-input')).toBe('true');
    expect(screen.getByTestId('process-panel-props').getAttribute('data-pending-input-keys')).toBe('pending-input:root-1:run-1:pending-1');

    rerender(
      <TurnBlockComponent
        block={makeBlock([
          required,
          makeEvent(2, 'USER_INPUT_RECEIVED', {
            kind: 'QUESTION',
            pendingInputId: 'pending-1',
          }),
        ])}
        onRetry={() => undefined}
        onEdit={() => undefined}
        onCancel={() => undefined}
      />,
    );

    expect(screen.getByTestId('process-panel-props').getAttribute('data-has-pending-input')).toBe('false');
    expect(screen.getByTestId('process-panel-props').getAttribute('data-pending-input-keys')).toBe('');
  });

  it('requests the existing bottom-follow action when the active process content advances', () => {
    const onRequestScrollToBottom = vi.fn();
    const readIsViewportFollowingBottom = vi.fn(() => true);
    const { rerender } = render(
      <TurnBlockComponent
        block={makeBlock(makeStreamingEvents('正在处理'))}
        isViewportFollowingBottom={true}
        readIsViewportFollowingBottom={readIsViewportFollowingBottom}
        onRequestScrollToBottom={onRequestScrollToBottom}
        onRetry={() => undefined}
        onEdit={() => undefined}
        onCancel={() => undefined}
      />,
    );
    onRequestScrollToBottom.mockClear();
    readIsViewportFollowingBottom.mockClear();

    rerender(
      <TurnBlockComponent
        block={makeBlock(makeStreamingEvents('正在处理', 3))}
        isViewportFollowingBottom={true}
        readIsViewportFollowingBottom={readIsViewportFollowingBottom}
        onRequestScrollToBottom={onRequestScrollToBottom}
        onRetry={() => undefined}
        onEdit={() => undefined}
        onCancel={() => undefined}
      />,
    );

    expect(readIsViewportFollowingBottom).toHaveBeenCalled();
    expect(onRequestScrollToBottom).toHaveBeenCalledTimes(1);
  });

  it('does not request scrolling when the live viewport state says the user left the bottom', () => {
    let isFollowingBottom = true;
    const onRequestScrollToBottom = vi.fn();
    const readIsViewportFollowingBottom = vi.fn(() => isFollowingBottom);
    const { rerender } = render(
      <TurnBlockComponent
        block={makeBlock(makeStreamingEvents('正在处理'))}
        isViewportFollowingBottom={true}
        readIsViewportFollowingBottom={readIsViewportFollowingBottom}
        onRequestScrollToBottom={onRequestScrollToBottom}
        onRetry={() => undefined}
        onEdit={() => undefined}
        onCancel={() => undefined}
      />,
    );
    onRequestScrollToBottom.mockClear();
    readIsViewportFollowingBottom.mockClear();
    isFollowingBottom = false;

    rerender(
      <TurnBlockComponent
        block={makeBlock(makeStreamingEvents('正在处理，等待更多指标', 3))}
        isViewportFollowingBottom={true}
        readIsViewportFollowingBottom={readIsViewportFollowingBottom}
        onRequestScrollToBottom={onRequestScrollToBottom}
        onRetry={() => undefined}
        onEdit={() => undefined}
        onCancel={() => undefined}
      />,
    );

    expect(readIsViewportFollowingBottom).toHaveBeenCalled();
    expect(onRequestScrollToBottom).not.toHaveBeenCalled();
  });
});
