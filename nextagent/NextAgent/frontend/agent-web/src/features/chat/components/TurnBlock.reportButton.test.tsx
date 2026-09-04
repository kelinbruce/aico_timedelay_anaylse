import { describe, it, expect, vi, afterEach } from 'vitest';
import { createContext } from 'react';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
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

vi.mock('./structured/ReportAnswerCard.tsx', () => ({
  ReportAnswerCard: ({ content }: { content: unknown }) => <div data-testid="mock-report-answer-card">{JSON.stringify(content)}</div>,
}));

import { TurnBlockComponent } from './TurnBlock.tsx';
import { getActionButton, queryActionButton } from './_overflowHelper';

function buildCompletedBlock(rootMessageId = 'root-1', requestId = 'req-1'): TurnBlock {
  const answerEvent = {
    eventId: 'evt-1',
    sessionId: 'S1',
    requestId,
    runId: 'run-1',
    sequence: 1,
    eventType: 'LLM_CONTENT_DELTA',
    timelineEventRef: null,
    transportHints: [],
    payload: {
      content: 'RAN alarm diagnosis result',
      role: 'ASSISTANT',
      messageId: 'ai-1',
      rootMessageId,
    },
    createdAt: '2026-07-22T10:00:01.000Z',
  } as unknown as StreamEnvelope;
  return {
    rootMessageId,
    userMessage: {
      messageId: rootMessageId,
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

function buildExecutingBlock(rootMessageId = 'root-exec', requestId = 'req-exec'): TurnBlock {
  const answerEvent = {
    eventId: 'evt-1',
    sessionId: 'S1',
    requestId,
    runId: 'run-1',
    sequence: 1,
    eventType: 'LLM_CONTENT_DELTA',
    timelineEventRef: null,
    transportHints: [],
    payload: {
      content: 'streaming answer',
      role: 'ASSISTANT',
      messageId: 'ai-1',
      rootMessageId,
    },
    createdAt: '2026-07-22T10:00:01.000Z',
  } as unknown as StreamEnvelope;
  return {
    rootMessageId,
    userMessage: {
      messageId: rootMessageId,
      sessionId: 'S1',
      content: 'diagnose RAN alarms',
      createdAt: '2026-07-22T10:00:00.000Z',
      visible: true,
    },
    aiEvents: [answerEvent],
    status: 'EXECUTING',
    isLatest: false,
  };
}

function buildBiReportBlock(): TurnBlock {
  const dslEvent = {
    eventId: 'bi-evt-1',
    sessionId: 'S1',
    requestId: 'bi-report:m1',
    sequence: 0,
    eventType: 'TOOL_STRUCTURED_DELTA',
    timelineEventRef: null,
    transportHints: ['history-load'],
    payload: {
      toolEventType: 'ANSWER',
      toolMessageType: 'DSL',
      content: '{"type":"report","data":"bi"}',
    },
    createdAt: '2026-07-22T10:00:01.000Z',
  } as unknown as StreamEnvelope;
  return {
    rootMessageId: 'bi-report:m1',
    userMessage: {
      messageId: 'bi-report:m1',
      sessionId: 'S1',
      content: '',
      createdAt: '2026-07-22T10:00:00.000Z',
      visible: true,
    },
    aiEvents: [dslEvent],
    status: 'COMPLETED',
    isLatest: false,
  };
}

function renderTurn(block: TurnBlock, props: Record<string, unknown> = {}) {
  return render(<TurnBlockComponent block={block} onRetry={vi.fn()} onEdit={vi.fn()} onCancel={vi.fn()} sessionId="S1" {...props} />);
}

afterEach(() => {
  cleanup();
});

describe('TurnBlock report action bar button', () => {
  it('shows generate-report button in action bar for reportable turn', () => {
    const onGenerateReport = vi.fn();
    renderTurn(buildCompletedBlock(), { onGenerateReport });

    const btn = getActionButton('btn-generate-report');
    expect(btn).toBeTruthy();
  });

  it('does not show generate-report button when in report selection mode', () => {
    const onGenerateReport = vi.fn();
    renderTurn(buildCompletedBlock(), {
      onGenerateReport,
      reportSelectionDisabled: false,
      reportSelection: true,
      onToggleReportSelection: vi.fn(),
    });

    expect(queryActionButton('btn-generate-report')).toBeNull();
  });

  it('does not show generate-report button when in share selection mode', () => {
    const onGenerateReport = vi.fn();
    renderTurn(buildCompletedBlock(), {
      onGenerateReport,
      shareSelection: true,
      onToggleShareSelection: vi.fn(),
    });

    expect(queryActionButton('btn-generate-report')).toBeNull();
  });

  it('calls onGenerateReport with rootMessageId and requestId on button click', () => {
    const onGenerateReport = vi.fn();
    renderTurn(buildCompletedBlock('root-42', 'req-42'), { onGenerateReport });

    const btn = getActionButton('btn-generate-report');
    fireEvent.click(btn);

    expect(onGenerateReport).toHaveBeenCalledOnce();
    expect(onGenerateReport).toHaveBeenCalledWith('root-42', 'req-42');
  });

  it('does not show generate-report button for bi-report turn', () => {
    const onGenerateReport = vi.fn();
    renderTurn(buildBiReportBlock(), { onGenerateReport });

    expect(queryActionButton('btn-generate-report')).toBeNull();
  });

  it('does not show generate-report button for non-reportable turn', () => {
    const onGenerateReport = vi.fn();
    renderTurn(buildExecutingBlock(), { onGenerateReport });

    expect(queryActionButton('btn-generate-report')).toBeNull();
  });
});

describe('TurnBlock bi-report render branch', () => {
  it('renders ReportAnswerCard for bi-report prefixed turn', () => {
    renderTurn(buildBiReportBlock(), { onGenerateReport: vi.fn() });

    expect(screen.getByTestId('mock-report-answer-card')).toBeTruthy();
    expect(screen.queryByTestId('assistant-content-region')).toBeNull();
  });

  it('does not render checkbox for bi-report turn', () => {
    renderTurn(buildBiReportBlock(), {
      reportSelection: true,
      onToggleReportSelection: vi.fn(),
    });

    expect(screen.queryByTestId(/report-checkbox-/)).toBeNull();
  });
});

describe('TurnBlock report checkbox disabled state', () => {
  it('disables unselected checkbox when reportSelectionDisabled is true', () => {
    renderTurn(buildCompletedBlock('root-1', 'req-1'), {
      reportSelection: true,
      reportSelected: false,
      reportSelectionDisabled: true,
      onToggleReportSelection: vi.fn(),
    });

    const checkbox = screen.getByTestId('report-checkbox-req-1') as HTMLInputElement;
    expect(checkbox.disabled).toBe(true);
  });

  it('does not disable selected checkbox (disabled prop is false for selected items)', () => {
    renderTurn(buildCompletedBlock('root-1', 'req-1'), {
      reportSelection: true,
      reportSelected: true,
      reportSelectionDisabled: false,
      onToggleReportSelection: vi.fn(),
    });

    const checkbox = screen.getByTestId('report-checkbox-req-1') as HTMLInputElement;
    expect(checkbox.disabled).toBe(false);
  });

  it('enables checkbox when reportSelectionDisabled is false', () => {
    renderTurn(buildCompletedBlock('root-1', 'req-1'), {
      reportSelection: true,
      reportSelected: false,
      reportSelectionDisabled: false,
      onToggleReportSelection: vi.fn(),
    });

    const checkbox = screen.getByTestId('report-checkbox-req-1') as HTMLInputElement;
    expect(checkbox.disabled).toBe(false);
  });

  it('renders disabled checkbox for non-reportable turn', () => {
    renderTurn(buildExecutingBlock('root-exec', 'req-exec'), {
      reportSelection: true,
      onToggleReportSelection: vi.fn(),
    });

    const checkbox = screen.getByTestId('report-checkbox-req-exec') as HTMLInputElement;
    expect(checkbox.disabled).toBe(true);
  });
});
