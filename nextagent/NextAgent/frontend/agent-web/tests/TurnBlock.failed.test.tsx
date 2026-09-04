// @vitest-environment jsdom
import { cleanup, fireEvent, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { __resetTurnBlockTestState, TurnBlockComponent } from '../src/features/chat/components/TurnBlock';
import i18n from '../src/i18n/index.ts';
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
  status: 'FAILED',
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

describe('TurnBlock failed state', () => {
  it('shows a user-readable path rejection reason without exposing the terminal error code', () => {
    const block: TurnBlock = {
      ...baseBlock,
      aiEvents: [makeEnvelope(2, 'REQUEST_FAILED', { content: 'Request failed safely: CAPABILITY_PATH_REJECTED' })],
    };

    render(<TurnBlockComponent block={block} onRetry={() => {}} onEdit={() => {}} onCancel={() => {}} isViewportFollowingBottom={false} />);

    expect(screen.getByTestId('turn-failed-notice').getAttribute('data-failed-partial')).toBe('false');
    expect(screen.getByText(i18n.t('turn.failedWithoutAnswer'))).toBeTruthy();
    expect(screen.getByText(i18n.t('turn.failureReasonPrefix'))).toBeTruthy();
    expect(screen.getByText(i18n.t('turn.failureReasons.pathRejected'))).toBeTruthy();
    expect(screen.queryByText('CAPABILITY_PATH_REJECTED')).toBeNull();
    expect(screen.queryByText('Request failed safely: CAPABILITY_PATH_REJECTED')).toBeNull();
    expect(screen.queryByTestId('assistant-content-region')).toBeNull();
    expect(screen.queryByTestId('turn-answer-pending')).toBeNull();
  });

  it('disables copy when the failed turn has no answer content', () => {
    render(<TurnBlockComponent block={baseBlock} onRetry={() => {}} onEdit={() => {}} onCancel={() => {}} isViewportFollowingBottom={false} />);

    const copyButton = screen.getByTestId('btn-copy-assistant');
    expect(copyButton.hasAttribute('disabled')).toBe(true);
    expect(copyButton.getAttribute('aria-label')).toBe(i18n.t('turn.copyDisabled'));
  });

  it('hides share from more actions when sharing is disabled', () => {
    render(
      <TurnBlockComponent block={baseBlock} onShare={() => {}} onRetry={() => {}} onEdit={() => {}} onCancel={() => {}} isViewportFollowingBottom={false} />,
    );

    const moreButton = screen.getByTestId('btn-more-actions');
    fireEvent.click(moreButton);
    expect(screen.queryByTestId('btn-share')).toBeNull();
  });

  it('keeps partial answer content and shows a user-readable generic failure reason', () => {
    const block: TurnBlock = {
      ...baseBlock,
      aiEvents: [
        makeEnvelope(2, 'LLM_CONTENT_DELTA', { content: 'partial answer' }),
        makeEnvelope(3, 'REQUEST_FAILED', { content: 'Request failed safely.', code: 'MODEL_PROVIDER_ERROR' }),
      ],
    };

    render(<TurnBlockComponent block={block} onRetry={() => {}} onEdit={() => {}} onCancel={() => {}} isViewportFollowingBottom={false} />);

    expect(screen.getByTestId('turn-failed-notice').getAttribute('data-failed-partial')).toBe('true');
    expect(screen.getByText(i18n.t('turn.failedWithPartialContent'))).toBeTruthy();
    expect(screen.getByText(i18n.t('turn.failureReasons.generic'))).toBeTruthy();
    expect(screen.queryByText('MODEL_PROVIDER_ERROR')).toBeNull();
    expect(screen.getByText('partial answer')).toBeTruthy();
    expect(screen.queryByText('Request failed safely.')).toBeNull();
    expect(screen.queryByTestId('turn-answer-pending')).toBeNull();
  });

  it('shows failed terminal partial answer content when it is not a safe failure placeholder', () => {
    const block: TurnBlock = {
      ...baseBlock,
      aiEvents: [makeEnvelope(2, 'REQUEST_FAILED', { content: 'I checked the workspace before the tool failed.' })],
    };

    render(<TurnBlockComponent block={block} onRetry={() => {}} onEdit={() => {}} onCancel={() => {}} isViewportFollowingBottom={false} />);

    expect(screen.getByTestId('turn-failed-notice').getAttribute('data-failed-partial')).toBe('true');
    expect(screen.getByText(i18n.t('turn.failedWithPartialContent'))).toBeTruthy();
    expect(screen.getByText('I checked the workspace before the tool failed.')).toBeTruthy();
  });

  it('uses capability safe errors as the top-level failed reason', () => {
    const block: TurnBlock = {
      ...baseBlock,
      aiEvents: [
        makeEnvelope(2, 'CAPABILITY_COMPLETED', {
          toolName: 'bash',
          status: 'FAILED',
          safeErrorCode: 'COMMAND_NOT_ALLOWED',
          safeErrorCategory: 'AUTHORIZATION',
        }),
      ],
    };

    render(<TurnBlockComponent block={block} onRetry={() => {}} onEdit={() => {}} onCancel={() => {}} isViewportFollowingBottom={false} />);

    expect(screen.getByText(i18n.t('turn.failureReasons.localAccessBlocked'))).toBeTruthy();
    expect(screen.queryByText('COMMAND_NOT_ALLOWED')).toBeNull();
    expect(screen.queryByText('AUTHORIZATION')).toBeNull();
  });

  it('falls back to the safe error category when the code is not mapped', () => {
    const block: TurnBlock = {
      ...baseBlock,
      aiEvents: [makeEnvelope(2, 'REQUEST_FAILED', { code: 'FUTURE_AUTHORIZATION_CODE', category: 'AUTHORIZATION' })],
    };

    render(<TurnBlockComponent block={block} onRetry={() => {}} onEdit={() => {}} onCancel={() => {}} isViewportFollowingBottom={false} />);

    expect(screen.getByText(i18n.t('turn.failureReasons.authorization'))).toBeTruthy();
    expect(screen.queryByText('FUTURE_AUTHORIZATION_CODE')).toBeNull();
  });
});
