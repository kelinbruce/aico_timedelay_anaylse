import { describe, it, expect, vi, afterEach } from 'vitest';
import { createContext } from 'react';
import { render, screen, cleanup } from '@testing-library/react';
import type { StreamEnvelope, TurnBlock } from '../../../state/contracts';

vi.mock('../../auth/AuthGate.tsx', () => ({
  AuthGate: ({ children }: { children: React.ReactNode }) => children,
}));

vi.mock('../../../aico-config/useAICOConfig.ts', () => ({
  useAICOConfig: () => null,
}));

vi.mock('../../../app/AppProviders.tsx', () => ({
  AppHostContext: createContext(undefined as unknown),
  useAppHostContext: () => ({ hostTheme: {} }),
}));

vi.mock('../../../services/annotationService.ts', () => ({
  annotationService: { upsertAnnotation: vi.fn() },
}));

vi.mock('../../suggested-questions/components/SuggestedQuestions.tsx', () => ({
  SuggestedQuestions: () => null,
}));

vi.mock('./ProcessPanel.tsx', () => ({
  ProcessPanel: () => null,
}));

vi.mock('./MarkdownContent.tsx', () => ({
  MarkdownContent: ({ content }: { content: string }) => <div data-testid="markdown-content">{content}</div>,
  STREAMING_TEXT_SWEEP_CSS: '',
  __resetMarkdownContentTestState: () => undefined,
  resolveTextSweepDuration: () => '3s',
}));

import { TurnBlockComponent } from './TurnBlock.tsx';
import '../../../i18n/index.ts';

function buildCanceledBlock(hasContent: boolean): TurnBlock {
  const events: StreamEnvelope[] = [
    {
      eventId: 'evt-accepted',
      sessionId: 'S1',
      requestId: 'req-1',
      runId: 'run-1',
      sequence: 1,
      eventType: 'REQUEST_ACCEPTED',
      timelineEventRef: null,
      transportHints: [],
      payload: { content: '' },
      createdAt: '2026-08-08T10:00:00.000Z',
    } as StreamEnvelope,
  ];
  if (hasContent) {
    events.push({
      eventId: 'evt-content',
      sessionId: 'S1',
      requestId: 'req-1',
      runId: 'run-1',
      sequence: 2,
      eventType: 'LLM_CONTENT_DELTA',
      timelineEventRef: null,
      transportHints: [],
      payload: { content: 'Partial answer text' },
      createdAt: '2026-08-08T10:00:01.000Z',
    } as StreamEnvelope);
  }
  events.push({
    eventId: 'evt-canceled',
    sessionId: 'S1',
    requestId: 'req-1',
    runId: 'run-1',
    sequence: hasContent ? 3 : 2,
    eventType: 'REQUEST_CANCELED',
    timelineEventRef: null,
    transportHints: [],
    payload: { status: 'CANCELED', content: 'Request canceled by user.' },
    createdAt: '2026-08-08T10:00:02.000Z',
  } as StreamEnvelope);

  return {
    rootMessageId: 'root-1',
    userMessage: {
      messageId: 'root-1',
      sessionId: 'S1',
      content: 'test question',
      createdAt: '2026-08-08T10:00:00.000Z',
      visible: true,
    },
    aiEvents: events,
    status: 'CANCELED',
    isLatest: true,
  };
}

function renderTurn(block: TurnBlock) {
  render(<TurnBlockComponent block={block} onRetry={vi.fn()} onEdit={vi.fn()} onCancel={vi.fn()} />);
}

afterEach(() => {
  cleanup();
});

describe('D4: TurnBlock cancel rendering (task 2.7 + 2.9)', () => {
  it('renders canceledWithoutAnswer i18n text in answer body when no content', () => {
    renderTurn(buildCanceledBlock(false));
    const placeholder = screen.getByTestId('assistant-canceled-placeholder');
    expect(placeholder).toBeTruthy();
    expect(placeholder.textContent).toBe('已取消，本次未生成回复内容。');
  });

  it('renders CanceledNotice (gray notice above divider) when no content', () => {
    renderTurn(buildCanceledBlock(false));
    const notice = screen.getByTestId('turn-canceled-notice');
    expect(notice).toBeTruthy();
    expect(notice.getAttribute('data-canceled-partial')).toBe('false');
  });

  it('does not render canceled placeholder when content exists', () => {
    renderTurn(buildCanceledBlock(true));
    expect(screen.queryByTestId('assistant-canceled-placeholder')).toBeNull();
  });

  it('renders CanceledNotice with partial content text when content exists', () => {
    renderTurn(buildCanceledBlock(true));
    const notice = screen.getByTestId('turn-canceled-notice');
    expect(notice).toBeTruthy();
    expect(notice.getAttribute('data-canceled-partial')).toBe('true');
  });

  it('renders streamed content in answer body when content exists', () => {
    renderTurn(buildCanceledBlock(true));
    const markdown = screen.getByTestId('markdown-content');
    expect(markdown.textContent).toBe('Partial answer text');
  });

  it('does not render terminal content in answer body', () => {
    renderTurn(buildCanceledBlock(false));
    // The terminal content 'Request canceled by user.' must NOT appear in the answer body
    const body = screen.queryByTestId('markdown-content');
    expect(body).toBeNull();
  });
});
