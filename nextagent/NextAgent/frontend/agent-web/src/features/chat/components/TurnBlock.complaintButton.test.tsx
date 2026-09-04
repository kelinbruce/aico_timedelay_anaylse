import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { createContext } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { StreamEnvelope, TurnBlock } from '../../../state/contracts';
import { resetComplaintFeatureStoreForTesting, useComplaintFeatureStore } from '../../../state/complaintFeatureStore.ts';

const testState = vi.hoisted(() => ({
  aicoConfig: null as null | { answerOperator: { piuName: string; piuVersion: string; renderFunc: string } },
}));

vi.mock('../../auth/AuthGate.tsx', () => ({
  AuthGate: ({ children }: { children: React.ReactNode }) => children,
}));
vi.mock('../../../aico-config/useAICOConfig.ts', () => ({
  useAICOConfig: () => testState.aicoConfig,
}));
vi.mock('../../../aico-config/PiuRenderer.tsx', () => ({
  PiuRenderer: () => <div data-testid="answer-operator" />,
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
  MarkdownContent: ({ content }: { content: string }) => <div>{content}</div>,
  STREAMING_TEXT_SWEEP_CSS: '',
  __resetMarkdownContentTestState: () => undefined,
  resolveTextSweepDuration: () => '3s',
}));
vi.mock('../../complaint/components/ComplaintDialog.tsx', () => ({
  ComplaintDialog: ({ open }: { open: boolean }) => (open ? <div data-testid="complaint-dialog-open" /> : null),
}));

import { TurnBlockComponent } from './TurnBlock.tsx';
import { getActionButton, queryActionButton } from './_overflowHelper';

function completedBlock(): TurnBlock {
  const event = {
    eventId: 'event-1',
    sessionId: 'session-1',
    requestId: 'request-1',
    runId: 'run-1',
    sequence: 1,
    eventType: 'LLM_CONTENT_DELTA',
    timelineEventRef: null,
    transportHints: ['history-load'],
    payload: {
      content: 'diagnosis answer',
      role: 'ASSISTANT',
      messageId: 'assistant-1',
      rootMessageId: 'root-1',
    },
    createdAt: '2026-07-29T00:00:00.000Z',
  } as unknown as StreamEnvelope;
  return {
    rootMessageId: 'root-1',
    userMessage: {
      messageId: 'root-1',
      sessionId: 'session-1',
      content: 'diagnose packet loss',
      createdAt: '2026-07-29T00:00:00.000Z',
      visible: true,
    },
    aiEvents: [event],
    status: 'COMPLETED',
    isLatest: false,
  };
}

function renderTurn() {
  return render(
    <TurnBlockComponent block={completedBlock()} onRetry={vi.fn()} onEdit={vi.fn()} onCancel={vi.fn()} sessionId="session-1" showAnnotations />,
  );
}

describe('TurnBlock complaint feedback', () => {
  beforeEach(() => {
    testState.aicoConfig = null;
    resetComplaintFeatureStoreForTesting();
  });

  afterEach(() => {
    cleanup();
    resetComplaintFeatureStoreForTesting();
  });

  it('shows the enabled feedback control and opens the complaint dialog', () => {
    useComplaintFeatureStore.setState({ enabled: true, status: 'ready' });
    renderTurn();

    fireEvent.click(screen.getByTestId('btn-complaint-feedback'));
    expect(screen.getByTestId('complaint-dialog-open')).toBeTruthy();
  });

  it('does not show feedback while the complaint feature is disabled', () => {
    renderTurn();

    expect(screen.queryByTestId('btn-complaint-feedback')).toBeNull();
  });

  it('does not show feedback when answerOperator replaces bubble actions', () => {
    testState.aicoConfig = {
      answerOperator: {
        piuName: 'AnswerOperator',
        piuVersion: '1.0.0',
        renderFunc: 'render',
      },
    };
    useComplaintFeatureStore.setState({ enabled: true, status: 'ready' });
    renderTurn();

    expect(screen.getByTestId('answer-operator')).toBeTruthy();
    expect(screen.queryByTestId('btn-complaint-feedback')).toBeNull();
  });

  it('shows complaint in overflow dropdown when feature is enabled and buttons exceed primary row', () => {
    useComplaintFeatureStore.setState({ enabled: true, status: 'ready' });
    render(
      <TurnBlockComponent
        block={completedBlock()}
        onRetry={vi.fn()}
        onEdit={vi.fn()}
        onCancel={vi.fn()}
        sessionId="session-1"
        showAnnotations
        onShare={vi.fn()}
        onGenerateReport={vi.fn()}
      />,
    );
    expect(getActionButton('btn-complaint-feedback')).toBeTruthy();
  });

  it('does not show complaint in overflow dropdown when feature is disabled', () => {
    render(
      <TurnBlockComponent
        block={completedBlock()}
        onRetry={vi.fn()}
        onEdit={vi.fn()}
        onCancel={vi.fn()}
        sessionId="session-1"
        showAnnotations
        onShare={vi.fn()}
        onGenerateReport={vi.fn()}
      />,
    );
    expect(queryActionButton('btn-complaint-feedback')).toBeNull();
  });
});
