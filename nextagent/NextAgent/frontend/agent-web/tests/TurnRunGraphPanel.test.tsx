// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/features/run-graph/X6FlowDiagram.tsx', () => ({
  X6FlowDiagram: ({ viewState, selectedNodeId, onNodeSelect }: any) => (
    <div data-testid="mock-x6-flow">
      <button
        type="button"
        data-testid="mock-x6-select-capability"
        onClick={() => onNodeSelect?.(viewState.nodes.find((node: any) => node.kind === 'capability')?.id)}
      >
        select capability
      </button>
      <span data-testid="mock-x6-selected-node">{selectedNodeId ?? ''}</span>
      {viewState.nodes.map((node: any) => `${node.title}:${node.summary}`).join('|')}
    </div>
  ),
}));

import { TurnRunGraphPanel } from '../src/features/run-graph/TurnRunGraphPanel.tsx';
import { setLocalePreference } from '../src/i18n/index.ts';
import type { StreamEnvelope, TurnBlock } from '../src/state/contracts.ts';

function makeEvent(sequence: number, eventType: StreamEnvelope['eventType'], payload: Record<string, any> = {}): StreamEnvelope {
  return {
    eventId: `evt-${sequence}-${eventType}`,
    sessionId: 'session-1',
    requestId: 'request-1',
    runId: 'run-1',
    rootMessageId: 'root-1',
    requestContextId: 'context-1',
    sequence,
    eventType,
    timelineEventRef: null,
    transportHints: ['SSE'],
    payload,
    createdAt: `2026-04-20T12:00:${String(sequence).padStart(2, '0')}.000Z`,
  } as StreamEnvelope;
}

function makeBlock(aiEvents: readonly StreamEnvelope[]): TurnBlock {
  return {
    rootMessageId: 'root-1',
    userMessage: {
      messageId: 'root-1',
      sessionId: 'session-1',
      role: 'USER',
      sequence: 1,
      content: 'Question',
      contentType: 'PLAIN_TEXT',
      metadata: {},
      createdAt: '2026-04-20T12:00:00.000Z',
      visible: true,
      rootMessageId: 'root-1',
      requestContextId: 'context-1',
    },
    aiEvents,
    status: 'EXECUTING',
    isLatest: true,
  };
}

describe('TurnRunGraphPanel', () => {
  beforeEach(async () => {
    await setLocalePreference('en-US');
  });

  afterEach(async () => {
    cleanup();
    await setLocalePreference('zh-CN');
  });

  it('renders localized controls and a DOM process summary from graph view state', () => {
    render(
      <TurnRunGraphPanel
        block={makeBlock([
          makeEvent(1, 'REQUEST_ACCEPTED', {}),
          makeEvent(2, 'LLM_THINKING_DELTA', { delta: 'private thinking' }),
          makeEvent(3, 'CAPABILITY_STARTED', { toolCallId: 'tool-1', toolName: 'diagnose' }),
        ])}
        onClose={() => {}}
      />,
    );

    expect(screen.getByText('Full process')).toBeTruthy();
    expect(screen.getByLabelText('Fit graph')).toBeTruthy();
    expect(screen.getByLabelText('Reset graph view')).toBeTruthy();
    expect(screen.getByTestId('turn-run-graph-summary-list').textContent).toContain('Request accepted');
    expect(screen.getByTestId('turn-run-graph-summary-list').textContent).toContain('Thinking content is hidden');
    expect(screen.getByTestId('turn-run-graph-summary-list').textContent).toContain('diagnose');
    expect(screen.getByTestId('mock-x6-flow').textContent).toContain('Model processing');
  });

  it('keeps close reachable by keyboard and calls onClose', async () => {
    const onClose = vi.fn();
    render(
      <TurnRunGraphPanel block={makeBlock([makeEvent(1, 'CAPABILITY_STARTED', { toolCallId: 'tool-1', toolName: 'diagnose' })])} onClose={onClose} />,
    );

    const closeButton = screen.getByTestId('turn-run-graph-close');
    expect(document.activeElement).toBe(closeButton);
    await userEvent.click(closeButton);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('shows safe full node detail when a graph node is selected', async () => {
    render(
      <TurnRunGraphPanel
        block={makeBlock([
          makeEvent(1, 'LLM_THINKING_DELTA', { delta: 'secret reasoning' }),
          makeEvent(2, 'CAPABILITY_STARTED', { toolCallId: 'tool-1', toolName: 'diagnose' }),
          makeEvent(3, 'CAPABILITY_RESULT_DELTA', {
            toolCallId: 'tool-1',
            toolName: 'diagnose',
            result: '{"args":{"secret":true},"result":"raw"}',
          }),
        ])}
        onClose={() => {}}
      />,
    );

    await userEvent.click(screen.getByTestId('mock-x6-select-capability'));

    expect(screen.getByTestId('mock-x6-selected-node').textContent).toBe('capability:tool-1');
    const detailText = screen.getByTestId('turn-run-graph-node-detail').textContent ?? '';
    expect(detailText).toContain('diagnose');
    expect(detailText).toContain('Capability SPI');
    expect(detailText).toContain('tool-1');
    expect(detailText).toContain('CAPABILITY_STARTED');
    expect(detailText).not.toContain('secret reasoning');
    expect(detailText).not.toContain('"args"');
  });

  it('resizes the process summary with keyboard and pointer input', async () => {
    render(
      <TurnRunGraphPanel
        block={makeBlock([makeEvent(1, 'CAPABILITY_STARTED', { toolCallId: 'tool-1', toolName: 'diagnose' })])}
        onClose={() => {}}
      />,
    );

    const handle = screen.getByTestId('turn-run-graph-summary-resize-handle');
    expect(handle.getAttribute('aria-valuenow')).toBe('220');

    handle.focus();
    await userEvent.keyboard('{ArrowUp}');
    expect(handle.getAttribute('aria-valuenow')).toBe('244');

    await userEvent.keyboard('{Home}');
    expect(handle.getAttribute('aria-valuenow')).toBe('128');

    fireEvent.pointerDown(handle, { button: 0, clientY: 300 });
    fireEvent.pointerMove(window, { clientY: 260 });
    fireEvent.pointerUp(window);

    expect(handle.getAttribute('aria-valuenow')).toBe('168');
  });

  it('does not expose raw thinking text or raw JSON-like tool results in the summary', () => {
    render(
      <TurnRunGraphPanel
        block={makeBlock([
          makeEvent(1, 'LLM_THINKING_DELTA', { delta: 'secret reasoning' }),
          makeEvent(2, 'CAPABILITY_RESULT_DELTA', {
            toolCallId: 'tool-1',
            toolName: 'jsonTool',
            result: '{"args":{"secret":true},"result":"raw"}',
          }),
        ])}
        onClose={() => {}}
      />,
    );

    const summaryText = screen.getByTestId('turn-run-graph-summary-list').textContent ?? '';
    expect(summaryText).not.toContain('secret reasoning');
    expect(summaryText).not.toContain('"args"');
    expect(summaryText).toContain('Thinking content is hidden');
    expect(summaryText).toContain('Capability output updated');
  });
});
