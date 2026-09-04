import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { createContext } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import i18n from '../src/i18n/index.ts';
import type { ProcessEntry } from '../src/features/chat/process/processDetails.ts';
import type { StreamEnvelope, TurnBlock } from '../src/state/contracts.ts';

vi.mock('../src/features/auth/AuthGate.tsx', () => ({
  AuthGate: ({ children }: { readonly children: React.ReactNode }) => children,
}));

vi.mock('../src/app/AppProviders.tsx', () => ({
  AppHostContext: createContext(undefined as unknown),
  useAppHostContext: () => ({ hostTheme: {}, mode: 'local' }),
}));

vi.mock('../src/services/annotationService.ts', () => ({
  annotationService: { upsertAnnotation: vi.fn() },
  FAVORITE_LIMIT: 100,
}));

vi.mock('../src/features/suggested-questions/components/SuggestedQuestions.tsx', () => ({
  SuggestedQuestions: () => null,
}));

vi.mock('../src/features/chat/components/ProcessPanel.tsx', () => ({
  ProcessPanel: ({ rootMessageId, processEntries }: { readonly rootMessageId: string; readonly processEntries: readonly ProcessEntry[] }) => (
    <div data-testid={`process-probe-${rootMessageId}`}>
      {processEntries.map((entry) => (
        <span data-testid="process-title" key={entry.key}>
          {entry.title}
        </span>
      ))}
    </div>
  ),
}));

vi.mock('../src/features/chat/components/MarkdownContent.tsx', () => ({
  MarkdownContent: ({ content }: { readonly content: string }) => <div>{content}</div>,
  STREAMING_TEXT_SWEEP_CSS: '',
  __resetMarkdownContentTestState: () => undefined,
  resolveTextSweepDuration: () => '3s',
}));

vi.mock('../src/services/capabilityPresentationResourceService.ts', () => ({
  loadCapabilityPresentationResources: vi.fn(),
}));

import { loadCapabilityPresentationResources } from '../src/services/capabilityPresentationResourceService.ts';
import { capabilityPresentationStore } from '../src/state/capabilityPresentationStore.ts';
import { TurnBlockComponent } from '../src/features/chat/components/TurnBlock.tsx';

beforeEach(async () => {
  vi.mocked(loadCapabilityPresentationResources).mockReset();
  capabilityPresentationStore.clear('session-business-names');
  await i18n.changeLanguage('zh-CN');
});

afterEach(() => {
  cleanup();
  capabilityPresentationStore.clear('session-business-names');
});

describe('TurnBlock capability presentation resources', () => {
  it('rerenders fixed live and history identities from the current Session projection and locale as plain text', async () => {
    const markupLikeName = '<strong>实时告警</strong> **诊断** [详情](javascript:alert(1))';
    vi.mocked(loadCapabilityPresentationResources).mockResolvedValue({
      resources: [
        {
          capabilityKind: 'TOOL',
          capabilityId: 'FutureNetworkTool',
          displayName: 'Configured network diagnosis',
          locales: { language: { 'zh-CN': { displayName: markupLikeName }, 'en-US': { displayName: 'Configured network diagnosis' } } },
        },
      ],
    });
    const liveBlock = buildBlock('live', []);
    const historyBlock = buildBlock('history', ['history-load']);

    render(
      <>
        <TurnBlockComponent block={liveBlock} onRetry={vi.fn()} onEdit={vi.fn()} onCancel={vi.fn()} />
        <TurnBlockComponent block={historyBlock} onRetry={vi.fn()} onEdit={vi.fn()} onCancel={vi.fn()} />
      </>,
    );

    await waitFor(() => {
      for (const rootMessageId of ['root-live', 'root-history']) {
        const probe = screen.getByTestId(`process-probe-${rootMessageId}`);
        expect(probe.textContent).toContain(markupLikeName);
        expect(probe.querySelector('strong')).toBeNull();
        expect(probe.querySelector('a')).toBeNull();
      }
    });
    const liveTitleNode = within(screen.getByTestId('process-probe-root-live')).getByTestId('process-title');

    vi.mocked(loadCapabilityPresentationResources).mockResolvedValue({
      resources: [
        {
          capabilityKind: 'TOOL',
          capabilityId: 'FutureNetworkTool',
          displayName: 'Updated network diagnosis',
          locales: { language: { 'zh-CN': { displayName: '更新后的网络诊断' }, 'en-US': { displayName: 'Updated network diagnosis' } } },
        },
      ],
    });
    await act(async () => capabilityPresentationStore.refresh('session-business-names'));

    await waitFor(() => {
      expect(screen.getByTestId('process-probe-root-live').textContent).toContain('更新后的网络诊断');
      expect(screen.getByTestId('process-probe-root-history').textContent).toContain('更新后的网络诊断');
    });
    expect(within(screen.getByTestId('process-probe-root-live')).getByTestId('process-title')).toBe(liveTitleNode);

    await act(async () => {
      await i18n.changeLanguage('en-US');
    });

    await waitFor(() => {
      expect(screen.getByTestId('process-probe-root-live').textContent).toContain('Updated network diagnosis · Completed');
      expect(screen.getByTestId('process-probe-root-history').textContent).toContain('Updated network diagnosis · Completed');
    });
  });
});

function buildBlock(suffix: string, transportHints: readonly string[]): TurnBlock {
  const common = {
    sessionId: 'session-business-names',
    requestId: `request-${suffix}`,
    runId: `run-${suffix}`,
    requestContextId: `context-${suffix}`,
    rootMessageId: `root-${suffix}`,
    timelineEventRef: `timeline-${suffix}`,
    transportHints,
  };
  const aiEvents = [
    envelope(common, 1, 'CAPABILITY_STARTED', {
      capabilityKind: 'TOOL',
      capabilityId: 'FutureNetworkTool',
      toolName: 'FutureNetworkTool',
      toolCallId: `call-${suffix}`,
      status: 'RUNNING',
    }),
    envelope(common, 2, 'CAPABILITY_COMPLETED', {
      capabilityKind: 'TOOL',
      capabilityId: 'FutureNetworkTool',
      toolName: 'FutureNetworkTool',
      toolCallId: `call-${suffix}`,
      status: 'SUCCEEDED',
      resultPresentationLevel: 'STATUS_ONLY',
    }),
    envelope(common, 3, 'LLM_CONTENT_DELTA', {
      role: 'ASSISTANT',
      messageId: `answer-${suffix}`,
      content: 'Business name verified.',
      text: 'Business name verified.',
      final: true,
    }),
  ];
  return {
    rootMessageId: `root-${suffix}`,
    displayRunId: `run-${suffix}`,
    userMessage: {
      messageId: `root-${suffix}`,
      sessionId: 'session-business-names',
      content: 'Verify business name',
      createdAt: '2026-08-08T00:00:00.000Z',
      visible: true,
    },
    aiEvents,
    status: 'COMPLETED',
    isLatest: false,
  };
}

function envelope(
  common: Readonly<Record<string, unknown>>,
  sequence: number,
  eventType: StreamEnvelope['eventType'],
  payload: Readonly<Record<string, unknown>>,
): StreamEnvelope {
  return {
    ...common,
    eventId: `${String(common.runId)}-${sequence}`,
    sequence,
    eventType,
    payload,
    createdAt: `2026-08-08T00:00:0${sequence}.000Z`,
  } as StreamEnvelope;
}
