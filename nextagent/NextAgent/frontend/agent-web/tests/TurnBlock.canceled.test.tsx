// @vitest-environment jsdom
import { cleanup, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { __resetTurnBlockTestState, TurnBlockComponent } from '../src/features/chat/components/TurnBlock';
import type { StreamEnvelope, TurnBlock } from '../src/state/contracts';
import { renderWithAppProviders as render } from './renderWithAppProviders.tsx';

afterEach(() => {
  cleanup();
  __resetTurnBlockTestState();
});

const baseBlock: TurnBlock = {
  rootMessageId: 'msg-1',
  userMessage: {
    messageId: 'msg-1',
    sessionId: 'session-1',
    role: 'USER',
    sequence: 1,
    content: 'Hello AI',
    contentType: 'PLAIN_TEXT',
    metadata: {},
    createdAt: '2026-04-15T00:00:00Z',
    visible: true,
    requestContextId: 'req-1',
    rootMessageId: 'msg-1',
  },
  aiEvents: [],
  status: 'CANCELED',
  isLatest: true,
};

function makeEnvelope(sequence: number, eventType: StreamEnvelope['eventType'], payload: StreamEnvelope['payload']): StreamEnvelope {
  return {
    eventId: `evt-${sequence}`,
    sessionId: 'session-1',
    requestId: 'req-1',
    sequence,
    eventType,
    timelineEventRef: null,
    transportHints: ['SSE'],
    payload,
    createdAt: '2026-04-15T00:00:00Z',
  } as StreamEnvelope;
}

describe('TurnBlock canceled state', () => {
  it('defaults canceled turns with process data to a collapsed summary without analyzing placeholder', () => {
    const block: TurnBlock = {
      ...baseBlock,
      aiEvents: [
        makeEnvelope(2, 'LLM_THINKING_DELTA', { content: '正在构建回复内容...' }),
        makeEnvelope(3, 'CAPABILITY_RESULT_DELTA', { toolCallId: 'tool-1', progress: '步骤一' }),
        makeEnvelope(4, 'REQUEST_CANCELED', {}),
      ],
    };

    render(<TurnBlockComponent block={block} onRetry={() => {}} onEdit={() => {}} onCancel={() => {}} isViewportFollowingBottom={false} />);

    expect(screen.queryByTestId('turn-answer-pending')).toBeNull();
    expect(screen.getByTestId('turn-process-summary-text').textContent).toContain('您已取消');
    expect(screen.getByTestId('turn-canceled-notice').getAttribute('data-canceled-partial')).toBe('false');
    expect(screen.queryByTestId('turn-process-panel')).toBeNull();
  });

  it('shows the canceled summary and kept-partial notice when partial answer text already exists', () => {
    const block: TurnBlock = {
      ...baseBlock,
      aiEvents: [
        makeEnvelope(2, 'LLM_THINKING_DELTA', { content: '正在构建回复内容...' }),
        makeEnvelope(3, 'LLM_CONTENT_DELTA', { content: '已生成的部分结果' }),
        makeEnvelope(4, 'REQUEST_CANCELED', {}),
      ],
    };

    render(<TurnBlockComponent block={block} onRetry={() => {}} onEdit={() => {}} onCancel={() => {}} isViewportFollowingBottom={false} />);

    expect(screen.getByTestId('turn-process-summary-text').textContent).toContain('您已取消');
    expect(screen.getByTestId('turn-canceled-notice').getAttribute('data-canceled-partial')).toBe('true');
    expect(screen.getByText('已生成的部分结果')).toBeTruthy();
    expect(screen.queryByTestId('turn-answer-pending')).toBeNull();
  });

  it('shows a canceled-without-answer notice when cancellation has no assistant answer', () => {
    const block: TurnBlock = {
      ...baseBlock,
      aiEvents: [makeEnvelope(2, 'REQUEST_CANCELED', { content: 'Request canceled by user.' })],
    };

    render(<TurnBlockComponent block={block} onRetry={() => {}} onEdit={() => {}} onCancel={() => {}} isViewportFollowingBottom={false} />);

    expect(screen.getByTestId('turn-canceled-notice').getAttribute('data-canceled-partial')).toBe('false');
    expect(screen.queryByText('Request canceled by user.')).toBeNull();
    expect(screen.queryByTestId('assistant-content-region')).toBeNull();
    expect(screen.queryByTestId('turn-answer-pending')).toBeNull();
  });

  it('preserves spaces when concatenating thinking deltas in the UI', async () => {
    const user = userEvent.setup();
    const block: TurnBlock = {
      ...baseBlock,
      status: 'EXECUTING',
      aiEvents: [
        makeEnvelope(2, 'LLM_THINKING_DELTA', { delta: 'api ', metadata: { accumulated: false } }),
        makeEnvelope(3, 'LLM_THINKING_DELTA', { delta: 'is time', metadata: { accumulated: false } }),
      ],
    };

    render(<TurnBlockComponent block={block} onRetry={() => {}} onEdit={() => {}} onCancel={() => {}} isViewportFollowingBottom={false} />);

    await user.click(screen.getByTestId('turn-process-toggle'));
    expect(screen.getByTestId('turn-process-panel').textContent).toContain('api is time');
  });

  it('preserves whitespace-only thinking deltas between adjacent english tokens', async () => {
    const user = userEvent.setup();
    const block: TurnBlock = {
      ...baseBlock,
      status: 'EXECUTING',
      aiEvents: [
        makeEnvelope(2, 'LLM_THINKING_DELTA', { delta: 'data', metadata: { accumulated: false } }),
        makeEnvelope(3, 'LLM_THINKING_DELTA', { delta: ' ', metadata: { accumulated: false } }),
        makeEnvelope(4, 'LLM_THINKING_DELTA', { delta: 'structure', metadata: { accumulated: false } }),
      ],
    };

    render(<TurnBlockComponent block={block} onRetry={() => {}} onEdit={() => {}} onCancel={() => {}} isViewportFollowingBottom={false} />);

    await user.click(screen.getByTestId('turn-process-toggle'));
    expect(screen.getByTestId('turn-process-panel').textContent).toContain('data structure');
    expect(screen.getByTestId('turn-process-panel').textContent).not.toContain('datastructure');
  });
});
