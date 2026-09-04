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

function buildBlock(): TurnBlock {
  const answerEvent = {
    eventId: 'evt-1',
    sessionId: 'S1',
    requestId: 'req-1',
    runId: 'run-1',
    sequence: 1,
    eventType: 'LLM_CONTENT_DELTA',
    timelineEventRef: null,
    transportHints: [],
    payload: {
      content: 'RAN alarm diagnosis result',
      role: 'ASSISTANT',
      messageId: 'ai-1',
      rootMessageId: 'root-1',
    },
    createdAt: '2026-07-22T10:00:01.000Z',
  } as unknown as StreamEnvelope;
  return {
    rootMessageId: 'root-1',
    userMessage: {
      messageId: 'root-1',
      sessionId: 'S1',
      content: 'diagnose RAN alarms',
      createdAt: '2026-07-22T10:00:00.000Z',
      visible: true,
    },
    aiEvents: [answerEvent],
    status: 'COMPLETED',
    isLatest: false,
  };
}

afterEach(() => {
  cleanup();
});

describe('Report/share selection mode mutex', () => {
  it('hides share button when report selection mode is active', () => {
    render(
      <TurnBlockComponent
        block={buildBlock()}
        onRetry={vi.fn()}
        onEdit={vi.fn()}
        onCancel={vi.fn()}
        sessionId="S1"
        onShare={vi.fn()}
        reportSelection
        onToggleReportSelection={vi.fn()}
      />,
    );

    expect(screen.queryByTestId('btn-share')).toBeNull();
    expect(screen.queryByTestId('btn-fork-ai')).toBeNull();
  });

  it('hides fork button when share selection mode is active', () => {
    render(
      <TurnBlockComponent
        block={buildBlock()}
        onRetry={vi.fn()}
        onEdit={vi.fn()}
        onCancel={vi.fn()}
        sessionId="S1"
        onFork={vi.fn()}
        shareSelection
        onToggleShareSelection={vi.fn()}
      />,
    );

    expect(screen.queryByTestId('btn-fork-ai')).toBeNull();
    expect(screen.queryByTestId('btn-share')).toBeNull();
  });

  it('does not show generate-report button when share selection is active', () => {
    const onGenerateReport = vi.fn();
    render(
      <TurnBlockComponent
        block={buildBlock()}
        onRetry={vi.fn()}
        onEdit={vi.fn()}
        onCancel={vi.fn()}
        sessionId="S1"
        onGenerateReport={onGenerateReport}
        shareSelection
        onToggleShareSelection={vi.fn()}
      />,
    );

    expect(screen.queryByTestId('btn-generate-report')).toBeNull();
  });

  it('does not show generate-report button when report selection is active', () => {
    const onGenerateReport = vi.fn();
    render(
      <TurnBlockComponent
        block={buildBlock()}
        onRetry={vi.fn()}
        onEdit={vi.fn()}
        onCancel={vi.fn()}
        sessionId="S1"
        onGenerateReport={onGenerateReport}
        reportSelection
        onToggleReportSelection={vi.fn()}
      />,
    );

    expect(screen.queryByTestId('btn-generate-report')).toBeNull();
  });

  it('shows report checkbox when report selection is active, not share checkbox', () => {
    render(
      <TurnBlockComponent
        block={buildBlock()}
        onRetry={vi.fn()}
        onEdit={vi.fn()}
        onCancel={vi.fn()}
        sessionId="S1"
        reportSelection
        onToggleReportSelection={vi.fn()}
      />,
    );

    expect(screen.queryByTestId('share-checkbox-run-1')).toBeNull();
    expect(screen.getByTestId('report-checkbox-req-1')).toBeTruthy();
  });

  it('shows share checkbox when share selection is active, not report checkbox', () => {
    render(
      <TurnBlockComponent
        block={buildBlock()}
        onRetry={vi.fn()}
        onEdit={vi.fn()}
        onCancel={vi.fn()}
        sessionId="S1"
        shareSelection
        onToggleShareSelection={vi.fn()}
      />,
    );

    expect(screen.getByTestId('share-checkbox-run-1')).toBeTruthy();
    expect(screen.queryByTestId(/report-checkbox-/)).toBeNull();
  });
});
