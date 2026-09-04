import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, waitFor } from '@testing-library/react';
import { __resetProcessPanelTestState } from '../src/features/chat/components/ProcessPanel.tsx';
import { __resetTurnBlockTestState, TurnBlockComponent } from '../src/features/chat/components/TurnBlock';
import { PiuContext } from '../src/features/chat/context/PiuContext.tsx';
import type { PIU } from '../src/host/prel.ts';
import type { StreamEnvelope, TurnBlock } from '../src/state/contracts';
import { renderWithAppProviders as render } from './renderWithAppProviders.tsx';

const mermaidMock = vi.hoisted(() => ({
  initialize: vi.fn(),
  render: vi.fn(),
}));

vi.mock('mermaid', () => ({
  default: {
    initialize: mermaidMock.initialize,
    render: mermaidMock.render,
  },
}));

function createMockPiu(): PIU {
  return {
    id: 'piu-1',
    name: 'TestPIU',
    version: '1.0.0',
    config: null,
    deps: [],
    isBrowser: true,
    revs: { 'febs.regs': '', 'febs.server': '' },
    attach: vi.fn(),
    emit: vi.fn(),
  } as unknown as PIU;
}

function createMockPrel(): typeof window.Prel {
  return {
    autoLoad: vi.fn().mockResolvedValue(undefined),
  } as unknown as typeof window.Prel;
}

function createStructuredPiuEvent(data: unknown, sequence = 1): StreamEnvelope {
  return {
    eventId: `evt-piu-${sequence}`,
    sessionId: 'session-1',
    requestId: 'req-1',
    sequence,
    eventType: 'TOOL_STRUCTURED_DELTA',
    timelineEventRef: null,
    transportHints: [],
    payload: {
      toolEventType: 'ANSWER',
      toolMessageType: 'PIU',
      toolCallId: 'clip-mock-call-001',
      content: {
        piuName: 'thoughtChain',
        piuVersion: '1.0.0',
        method: 'render',
        data,
      },
    },
    createdAt: '2026-04-15T00:00:00Z',
  } as StreamEnvelope;
}

function createBlock(data: unknown): TurnBlock {
  return {
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
    aiEvents: [createStructuredPiuEvent(data)],
    status: 'COMPLETED',
    isLatest: true,
  };
}

function renderTurnBlockWithPiu(data: unknown): PIU {
  const piu = createMockPiu();
  window.Prel = createMockPrel();
  render(
    <PiuContext.Provider value={{ piu, site: { locale: 'zh-cn', theme: 'lightday' } }}>
      <TurnBlockComponent block={createBlock(data)} onRetry={() => {}} onEdit={() => {}} onCancel={() => {}} />
    </PiuContext.Provider>,
  );
  return piu;
}

function createLiveTextEvent(): StreamEnvelope {
  return {
    eventId: 'evt-live-text-1',
    sessionId: 'session-1',
    requestId: 'req-1',
    sequence: 2,
    eventType: 'LLM_CONTENT_DELTA',
    timelineEventRef: null,
    transportHints: ['SSE'],
    payload: { content: 'live text', role: 'ASSISTANT' },
    createdAt: '2026-04-15T00:00:01Z',
  } as StreamEnvelope;
}

describe('TurnBlock PIU history flag', () => {
  beforeEach(() => {
    mermaidMock.initialize.mockReset();
    mermaidMock.render.mockReset();
    mermaidMock.render.mockResolvedValue({ svg: '<svg><text>piu</text></svg>' });
  });

  afterEach(() => {
    cleanup();
    __resetTurnBlockTestState();
    __resetProcessPanelTestState();
    delete window.Prel;
  });

  it('passes isHistory true through TurnBlock, AnswerSegments, and PiuMessage when PIU data is an array', async () => {
    const piu = renderTurnBlockWithPiu([{ step: 1 }, { step: 2 }]);
    await waitFor(() => expect(piu.emit).toHaveBeenCalledTimes(1));
    const [, payload] = (piu.emit as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect((payload as Record<string, unknown>).isHistory).toBe(true);
    expect((payload as Record<string, unknown>).piuName).toBe('thoughtChain');
  });

  it('keeps isHistory true for an array-data PIU even when the same turn contains a live event', async () => {
    const piu = createMockPiu();
    window.Prel = createMockPrel();
    const block = {
      ...createBlock([{ step: 1 }, { step: 2 }]),
      aiEvents: [createLiveTextEvent(), createStructuredPiuEvent([{ step: 1 }, { step: 2 }])],
    };
    render(
      <PiuContext.Provider value={{ piu, site: { locale: 'zh-cn', theme: 'lightday' } }}>
        <TurnBlockComponent block={block} onRetry={() => {}} onEdit={() => {}} onCancel={() => {}} />
      </PiuContext.Provider>,
    );
    await waitFor(() => expect(piu.emit).toHaveBeenCalledTimes(1));
    const [, payload] = (piu.emit as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect((payload as Record<string, unknown>).isHistory).toBe(true);
  });

  it('passes isHistory false through TurnBlock, AnswerSegments, and PiuMessage for object PIU data', async () => {
    const piu = renderTurnBlockWithPiu({ steps: [] });
    await waitFor(() => expect(piu.emit).toHaveBeenCalledTimes(1));
    const [, payload] = (piu.emit as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect((payload as Record<string, unknown>).isHistory).toBe(false);
    expect((payload as Record<string, unknown>).piuName).toBe('thoughtChain');
  });
});
