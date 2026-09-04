import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { createContext } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { RunProcessHistoryState, StreamEnvelope, TurnBlock } from '../../../state/contracts';

vi.mock('../../auth/AuthGate.tsx', () => ({
  AuthGate: ({ children }: { children: React.ReactNode }) => children,
}));

vi.mock('../../../aico-config/useAICOConfig.ts', () => ({
  useAICOConfig: () => null,
}));

vi.mock('../../../app/AppProviders.tsx', () => ({
  AppHostContext: createContext(undefined as unknown),
  useAppHostContext: () => ({ hostTheme: 'lightday' }),
}));

vi.mock('../../../services/annotationService.ts', () => ({
  annotationService: { upsertAnnotation: vi.fn() },
}));

vi.mock('../../../services/userQuestionService.ts', () => ({
  pinQuestion: vi.fn(),
}));

vi.mock('../../suggested-questions/components/SuggestedQuestions.tsx', () => ({
  SuggestedQuestions: () => null,
}));

vi.mock('./MarkdownContent.tsx', () => ({
  MarkdownContent: ({ content }: { content: string }) => <div>{content}</div>,
  STREAMING_TEXT_SWEEP_CSS: '',
  __resetMarkdownContentTestState: () => undefined,
  resolveTextSweepDuration: () => '3s',
}));

vi.mock('./ProcessPanel.tsx', () => ({
  ProcessPanel: ({ block, onOpenFullProcess }: { block: TurnBlock; onOpenFullProcess?: (block: TurnBlock, opener: HTMLButtonElement) => void }) => (
    <button data-testid="open-full-process" onClick={(event) => onOpenFullProcess?.(block, event.currentTarget)}>
      Open
    </button>
  ),
}));

import { TurnBlockComponent } from './TurnBlock.tsx';
import '../../../i18n/index.ts';

const sessionId = 'session-history-graph';
const rootMessageId = 'request-history-graph';
const runId = 'run-history-graph';

afterEach(() => cleanup());

describe('TurnBlock full process history', () => {
  it('opens the run graph with the same composed history used by the process panel', () => {
    const baseAccepted = event('event-accepted', 1, 'REQUEST_ACCEPTED', {});
    const baseTerminal = event('event-terminal', 3, 'REQUEST_COMPLETED', { status: 'COMPLETED' });
    const degradation = event('event-degradation', 2, 'DEGRADATION_NOTICE', { code: 'SYSTEM_EVENT_SCENARIO_FAILED' });
    const block: TurnBlock = {
      rootMessageId,
      displayRunId: runId,
      userMessage: {
        messageId: rootMessageId,
        sessionId,
        content: 'diagnose a controlled telecom scenario',
        createdAt: '2026-08-10T00:00:00.000Z',
        visible: true,
      },
      aiEvents: [baseAccepted, baseTerminal],
      status: 'COMPLETED',
      isLatest: false,
    };
    const processHistoryState: RunProcessHistoryState = { status: 'AVAILABLE', envelopes: [baseAccepted, degradation, baseTerminal] };
    const onOpenFullProcess = vi.fn();

    render(
      <TurnBlockComponent
        block={block}
        sessionId={sessionId}
        processHistoryState={processHistoryState}
        onOpenFullProcess={onOpenFullProcess}
        onRetry={vi.fn()}
        onEdit={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByTestId('open-full-process'));

    const openedBlock = onOpenFullProcess.mock.calls[0]?.[0] as TurnBlock;
    expect(openedBlock.aiEvents.map((envelope) => envelope.eventType).sort()).toEqual([
      'DEGRADATION_NOTICE',
      'REQUEST_ACCEPTED',
      'REQUEST_COMPLETED',
    ]);
  });

  it('shows a live compaction notice when Runtime compacts before producing the answer', () => {
    const block = answerBlock([
      event('event-accepted-live', 1, 'REQUEST_ACCEPTED', {}, []),
      event('event-compacted-live', 2, 'CONTEXT_COMPACTED', {}, ['SSE']),
      event('event-answer-live', 3, 'LLM_CONTENT_DELTA', { content: 'Public answer', role: 'ASSISTANT' }, ['SSE']),
    ]);

    renderTurn(block);

    expect(screen.getByTestId('assistant-compaction-notice').textContent).toContain('系统已整理较早的对话内容');
  });

  it('does not replay the transient compaction notice from history', () => {
    const block = answerBlock([
      event('event-accepted-history', 1, 'REQUEST_ACCEPTED', {}),
      event('event-compacted-history', 2, 'CONTEXT_COMPACTED', {}),
      event('event-answer-history', 3, 'LLM_CONTENT_DELTA', { content: 'Public answer', role: 'ASSISTANT' }),
    ]);

    renderTurn(block);

    expect(screen.queryByTestId('assistant-compaction-notice')).toBeNull();
  });
});

function renderTurn(block: TurnBlock) {
  render(<TurnBlockComponent block={block} sessionId={sessionId} onRetry={vi.fn()} onEdit={vi.fn()} onCancel={vi.fn()} />);
}

function answerBlock(aiEvents: readonly StreamEnvelope[]): TurnBlock {
  return {
    rootMessageId,
    displayRunId: runId,
    userMessage: {
      messageId: rootMessageId,
      sessionId,
      content: 'summarize the telecom alarms',
      createdAt: '2026-08-10T00:00:00.000Z',
      visible: true,
    },
    aiEvents,
    status: 'COMPLETED',
    isLatest: true,
  };
}

function event(
  eventId: string,
  sequence: number,
  eventType: StreamEnvelope['eventType'],
  payload: StreamEnvelope['payload'],
  transportHints: StreamEnvelope['transportHints'] = ['history-load'],
): StreamEnvelope {
  return {
    eventId,
    sessionId,
    requestId: rootMessageId,
    runId,
    rootMessageId,
    sequence,
    eventType,
    timelineEventRef: eventId,
    transportHints,
    payload,
    createdAt: `2026-08-10T00:00:0${sequence}.000Z`,
  } as StreamEnvelope;
}
