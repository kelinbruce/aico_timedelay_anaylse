import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, render, screen, cleanup, fireEvent } from '@testing-library/react';
import type { StreamEnvelope } from '../../../../state/contracts.ts';
import { buildAnswerSegments } from '../../presentation/answerContent.ts';
import { AnswerSegments } from './AnswerSegments.tsx';
import { FileCard } from './FileCard.tsx';
import { ActionCard } from './ActionCard.tsx';
import { OperatorButtons } from './OperatorButtons.tsx';
import { PiuMessage, parsePiuContent } from './PiuMessage.tsx';
import { SimpleDslRenderer } from './SimpleDslRenderer.tsx';
import { PiuContext } from '../../context/PiuContext.tsx';
import type { PIU } from '../../../../host/prel.ts';
import { EXPAND_PANEL_DIV_ID } from '../../../expand-panel/ExpandPanelStore.ts';
import i18n from '../../../../i18n/index.ts';
// --- Mock data: TOOL_STRUCTURED_DELTA answer events from CLIP provider ---
function makeEnvelope(sequence: number, eventId: string, toolEventType: string, toolMessageType: string, content: unknown): StreamEnvelope {
  return {
    eventId,
    sessionId: 'mock-session',
    requestId: 'mock-request',
    runId: 'mock-run',
    rootMessageId: 'mock-request',
    requestContextId: 'mock-context',
    sequence,
    eventType: 'TOOL_STRUCTURED_DELTA',
    timelineEventRef: null,
    transportHints: [],
    payload: {
      metadata: { accumulated: false },
      contentType: 'PLAIN_TEXT',
      content: content as never,
      text: '',
      role: 'CAPABILITY_RESULT',
      messageId: `mock-structured-${sequence}`,
      runId: 'mock-run',
      rootMessageId: 'mock-request',
      requestContextId: 'mock-context',
      visible: true,
      toolEventType: toolEventType as never,
      toolMessageType: toolMessageType as never,
      toolCallId: 'clip-mock-call-001',
      capabilityId: 'clip-mock-tool',
    },
    createdAt: 1783346000000,
  } as StreamEnvelope;
}
const textContent =
  '## 诊断结论\n\n宽带链路状态正常，光猫接收光功率 **-22.5 dBm**，上下行速率达标。\n\nBRAS 会话保持稳定，无认证异常。\n\n建议排查用户侧路由器或终端设备。';
const fileName = 'diagnostic-report-2026-07.pdf';
const actionContent = JSON.stringify({
  openNetworkTopology: {
    text: '已自动打开网络拓扑页面',
    data: JSON.stringify({ topologyId: 'topo-broadband-001', region: '华东' }),
  },
});
const operatorContent = JSON.stringify({
  text: '是否需要派单至现场运维？',
  type: 'BUTTON',
  align: 'center',
  operators: {
    dispatchTicket: {
      text: '派单',
      title: '创建现场运维工单',
      type: 'primary',
      data: JSON.stringify({ ticketType: 'field-ops', priority: 'P2', region: '华东' }),
    },
    cancelDispatch: {
      text: '取消',
      type: 'default',
      data: JSON.stringify({ action: 'cancel' }),
    },
  },
});
const dslContent = {
  type: 'chart',
  title: '光功率趋势（近7天）',
  xAxis: { type: 'category', data: ['7/1', '7/2', '7/3', '7/4', '7/5', '7/6', '7/7'] },
  yAxis: { type: 'value', name: 'dBm' },
  series: [{ name: '接收光功率', type: 'line', data: [-21.8, -22.0, -22.1, -22.3, -22.5, -22.5, -22.5] }],
};
const piuContent = {
  piuName: 'thoughtChain',
  piuVersion: '1.0.0',
  method: 'render',
  data: {
    steps: [
      { title: '光猫检测', status: 'success', desc: '光功率 -22.5 dBm 正常' },
      { title: 'BRAS 检测', status: 'success', desc: '会话 ACTIVE' },
      { title: '用户侧排查', status: 'pending', desc: '建议检查路由器' },
    ],
  },
};
const mockAnswerEvents: StreamEnvelope[] = [
  makeEnvelope(110, 'mock-structured-evt-110', 'ANSWER', 'TEXT', textContent),
  makeEnvelope(111, 'mock-structured-evt-111', 'ANSWER', 'FILE', fileName),
  makeEnvelope(112, 'mock-structured-evt-112', 'ANSWER', 'ACTION', actionContent),
  makeEnvelope(113, 'mock-structured-evt-113', 'ANSWER', 'OPERATOR', operatorContent),
  makeEnvelope(114, 'mock-structured-evt-114', 'ANSWER', 'DSL', dslContent),
  makeEnvelope(115, 'mock-structured-evt-115', 'ANSWER', 'PIU', piuContent),
];
afterEach(() => {
  cleanup();
});
// --- buildAnswerSegments: pure function tests ---
describe('buildAnswerSegments with CLIP structured answer events', () => {
  it('produces 6 structured segments in sequence order', () => {
    const segments = buildAnswerSegments(mockAnswerEvents);
    expect(segments).toHaveLength(6);
    expect(segments[0]!.sequence).toBe(110);
    expect(segments[5]!.sequence).toBe(115);
  });
  it('segments have correct kind and toolMessageType', () => {
    const segments = buildAnswerSegments(mockAnswerEvents);
    const expectedTypes = ['TEXT', 'FILE', 'ACTION', 'OPERATOR', 'DSL', 'PIU'];
    segments.forEach((seg, i) => {
      expect(seg.kind).toBe('structured');
      if (seg.kind === 'structured') {
        expect(seg.toolMessageType).toBe(expectedTypes[i]);
      }
    });
  });
  it('TEXT segment carries the markdown diagnostic content', () => {
    const segments = buildAnswerSegments(mockAnswerEvents);
    const textSeg = segments[0];
    expect(textSeg).toBeDefined();
    if (textSeg && textSeg.kind === 'structured') {
      expect(textSeg.content).toBe(textContent);
    }
  });
  it('FILE segment carries the filename string', () => {
    const segments = buildAnswerSegments(mockAnswerEvents);
    const fileSeg = segments[1];
    expect(fileSeg).toBeDefined();
    if (fileSeg && fileSeg.kind === 'structured') {
      expect(fileSeg.content).toBe(fileName);
    }
  });
  it('ACTION segment carries the JSON action string', () => {
    const segments = buildAnswerSegments(mockAnswerEvents);
    const actionSeg = segments[2];
    expect(actionSeg).toBeDefined();
    if (actionSeg && actionSeg.kind === 'structured') {
      expect(actionSeg.content).toBe(actionContent);
    }
  });
  it('OPERATOR segment carries the JSON operator string', () => {
    const segments = buildAnswerSegments(mockAnswerEvents);
    const operatorSeg = segments[3];
    expect(operatorSeg).toBeDefined();
    if (operatorSeg && operatorSeg.kind === 'structured') {
      expect(operatorSeg.content).toBe(operatorContent);
    }
  });
  it('DSL segment carries the chart object', () => {
    const segments = buildAnswerSegments(mockAnswerEvents);
    const dslSeg = segments[4];
    expect(dslSeg).toBeDefined();
    if (dslSeg && dslSeg.kind === 'structured') {
      expect(dslSeg.content).toEqual(dslContent);
    }
  });
  it('PIU segment carries the piu metadata object', () => {
    const segments = buildAnswerSegments(mockAnswerEvents);
    const piuSeg = segments[5];
    expect(piuSeg).toBeDefined();
    if (piuSeg && piuSeg.kind === 'structured') {
      expect(piuSeg.content).toEqual(piuContent);
    }
  });
  it('marks structured PIU segments as history when content.data is an array', () => {
    const persistedContent = {
      ...piuContent,
      data: [{ step: 1 }, { step: 2 }],
    };
    const persistedEvent = makeEnvelope(117, 'mock-structured-evt-117', 'ANSWER', 'PIU', persistedContent);
    const persistedSegments = buildAnswerSegments([persistedEvent]);
    expect(persistedSegments[0]?.kind).toBe('structured');
    if (persistedSegments[0]?.kind === 'structured') {
      expect(persistedSegments[0].isHistory).toBe(true);
    }

    const persistedJsonEvent = makeEnvelope(118, 'mock-structured-evt-118', 'ANSWER', 'PIU', JSON.stringify(persistedContent));
    const persistedJsonSegments = buildAnswerSegments([persistedJsonEvent]);
    expect(persistedJsonSegments[0]?.kind).toBe('structured');
    if (persistedJsonSegments[0]?.kind === 'structured') {
      expect(persistedJsonSegments[0].isHistory).toBe(true);
    }

    const liveSegments = buildAnswerSegments(mockAnswerEvents);
    expect(liveSegments[5]?.kind).toBe('structured');
    if (liveSegments[5]?.kind === 'structured') {
      expect(liveSegments[5].isHistory).toBe(false);
    }
  });

  it('returns empty array when no answer events exist', () => {
    const nonAnswerEvents: StreamEnvelope[] = [makeEnvelope(116, 'mock-structured-evt-116', 'TITLE', 'TEXT', textContent)];
    const segments = buildAnswerSegments(nonAnswerEvents);
    expect(segments).toHaveLength(0);
  });
  it('interleaves LLM_CONTENT_DELTA text with structured segments', () => {
    const llmEvent: StreamEnvelope = {
      eventId: 'llm-evt-109',
      sessionId: 'mock-session',
      requestId: 'mock-request',
      sequence: 109,
      eventType: 'LLM_CONTENT_DELTA',
      timelineEventRef: null,
      transportHints: [],
      payload: { content: '正在分析...' },
      createdAt: 1783346000000,
    } as StreamEnvelope;
    const segments = buildAnswerSegments([llmEvent, ...mockAnswerEvents]);
    expect(segments[0]!.kind).toBe('text');
    if (segments[0]!.kind === 'text') {
      expect(segments[0]!.content).toBe('正在分析...');
    }
    expect(segments[1]!.kind).toBe('structured');
  });

  it('keeps structured intro, PIU, and later model summary in answer display order', () => {
    const intro = makeEnvelope(201, 'piu-answer-intro', 'ANSWER', 'TEXT', '下面展示诊断卡片：');
    const piu = makeEnvelope(202, 'piu-answer-card', 'ANSWER', 'PIU', piuContent);
    const summary: StreamEnvelope = {
      eventId: 'piu-answer-summary',
      sessionId: 'mock-session',
      requestId: 'mock-request',
      sequence: 203,
      eventType: 'LLM_CONTENT_DELTA',
      timelineEventRef: null,
      transportHints: [],
      payload: { content: '## 模型总结\n\n建议优先处理边界路由器高负载进程。' },
      createdAt: 1783346000000,
    } as StreamEnvelope;

    const segments = buildAnswerSegments([intro, piu, summary]);

    expect(segments).toEqual([
      expect.objectContaining({ kind: 'structured', toolMessageType: 'TEXT', content: '下面展示诊断卡片：' }),
      expect.objectContaining({ kind: 'structured', toolMessageType: 'PIU', content: piuContent }),
      expect.objectContaining({ kind: 'text', content: '## 模型总结\n\n建议优先处理边界路由器高负载进程。' }),
    ]);
  });
});
// --- buildAnswerSegments: PIU uuid replace behavior ---
const piuContentWithUuid = {
  ...piuContent,
  uuid: 'piu-uuid-001',
};
const piuContentWithUuidUpdated = {
  ...piuContent,
  uuid: 'piu-uuid-001',
  data: {
    steps: [
      { title: '光猫检测', status: 'success', desc: '光功率 -21.0 dBm 正常' },
      { title: 'BRAS 检测', status: 'success', desc: '会话 ACTIVE' },
      { title: '用户侧排查', status: 'success', desc: '已修复' },
    ],
  },
};
describe('buildAnswerSegments PIU uuid replace', () => {
  it('keeps all PIU segments with same uuid in buildAnswerSegments', () => {
    const events: StreamEnvelope[] = [
      makeEnvelope(301, 'piu-uuid-evt-301', 'ANSWER', 'PIU', piuContentWithUuid),
      makeEnvelope(302, 'piu-uuid-evt-302', 'ANSWER', 'PIU', piuContentWithUuidUpdated),
    ];
    const segments = buildAnswerSegments(events);
    expect(segments).toHaveLength(2);
    expect(segments[0]!.kind).toBe('structured');
    expect(segments[1]!.kind).toBe('structured');
    if (segments[0]!.kind === 'structured' && segments[1]!.kind === 'structured') {
      expect(segments[0]!.sequence).toBe(301);
      expect(segments[0]!.content).toEqual(piuContentWithUuid);
      expect(segments[1]!.sequence).toBe(302);
      expect(segments[1]!.content).toEqual(piuContentWithUuidUpdated);
    }
  });

  it('preserves surrounding text with both same-uuid PIU segments', () => {
    const intro = makeEnvelope(310, 'piu-uuid-intro', 'ANSWER', 'TEXT', '诊断进行中...');
    const piuV1 = makeEnvelope(311, 'piu-uuid-v1', 'ANSWER', 'PIU', piuContentWithUuid);
    const mid = makeEnvelope(312, 'piu-uuid-mid', 'ANSWER', 'TEXT', '正在更新诊断结果...');
    const piuV2 = makeEnvelope(313, 'piu-uuid-v2', 'ANSWER', 'PIU', piuContentWithUuidUpdated);
    const segments = buildAnswerSegments([intro, piuV1, mid, piuV2]);
    expect(segments).toEqual([
      expect.objectContaining({ kind: 'structured', toolMessageType: 'TEXT', content: '诊断进行中...' }),
      expect.objectContaining({ kind: 'structured', toolMessageType: 'PIU', content: piuContentWithUuid, sequence: 311 }),
      expect.objectContaining({ kind: 'structured', toolMessageType: 'TEXT', content: '正在更新诊断结果...' }),
      expect.objectContaining({ kind: 'structured', toolMessageType: 'PIU', content: piuContentWithUuidUpdated, sequence: 313 }),
    ]);
  });

  it('keeps all PIU segments when uuids differ', () => {
    const piuA = { ...piuContent, uuid: 'piu-uuid-a' };
    const piuB = { ...piuContent, uuid: 'piu-uuid-b' };
    const events: StreamEnvelope[] = [makeEnvelope(320, 'piu-uuid-a', 'ANSWER', 'PIU', piuA), makeEnvelope(321, 'piu-uuid-b', 'ANSWER', 'PIU', piuB)];
    const segments = buildAnswerSegments(events);
    expect(segments).toHaveLength(2);
  });

  it('keeps all PIU segments when uuid is absent', () => {
    const events: StreamEnvelope[] = [
      makeEnvelope(330, 'piu-no-uuid-1', 'ANSWER', 'PIU', piuContent),
      makeEnvelope(331, 'piu-no-uuid-2', 'ANSWER', 'PIU', piuContent),
    ];
    const segments = buildAnswerSegments(events);
    expect(segments).toHaveLength(2);
  });

  it('keeps all PIU segments when content is a JSON string with uuid', () => {
    const events: StreamEnvelope[] = [
      makeEnvelope(340, 'piu-uuid-str-1', 'ANSWER', 'PIU', JSON.stringify(piuContentWithUuid)),
      makeEnvelope(341, 'piu-uuid-str-2', 'ANSWER', 'PIU', JSON.stringify(piuContentWithUuidUpdated)),
    ];
    const segments = buildAnswerSegments(events);
    expect(segments).toHaveLength(2);
    if (segments[0]!.kind === 'structured' && segments[1]!.kind === 'structured') {
      expect(segments[0]!.sequence).toBe(340);
      expect(segments[1]!.sequence).toBe(341);
    }
  });
});
// --- PIU uuid: PiuMessage stays mounted across content updates ---
describe('PIU uuid key keeps PiuMessage mounted', () => {
  it('emits each PIU data update without remounting when uuid is the same', async () => {
    const piu = createMockPiu();
    const mockPrel = createMockPrel();
    window.Prel = mockPrel as unknown as typeof window.Prel;
    const renderSegments = (content: typeof piuContentWithUuid) => (
      <PiuContext.Provider value={{ piu, site: { locale: 'zh-cn', theme: 'lightday' } }}>
        <AnswerSegments segments={buildAnswerSegments([makeEnvelope(350, 'piu-uuid-mount-1', 'ANSWER', 'PIU', content)])} />
      </PiuContext.Provider>
    );
    const rendered = render(renderSegments(piuContentWithUuid));
    await vi.waitFor(() => expect(piu.emit).toHaveBeenCalledTimes(1));
    const firstEmitPayload = (piu.emit as ReturnType<typeof vi.fn>).mock.calls[0]![1];
    expect(firstEmitPayload).toHaveProperty('uuid', 'piu-uuid-001');

    rendered.rerender(renderSegments(piuContentWithUuidUpdated));
    await vi.waitFor(() => expect(piu.emit).toHaveBeenCalledTimes(2));
    const secondEmitPayload = (piu.emit as ReturnType<typeof vi.fn>).mock.calls[1]![1];
    expect(secondEmitPayload).toHaveProperty('uuid', 'piu-uuid-001');
    // autoLoad is called on each content change; the key point is that
    // piu.emit fires for each data update (not just the latest)
    cleanup();
    delete window.Prel;
  });

  it('does not clear container DOM between content updates (replaceChildren only on unmount)', async () => {
    const piu = createMockPiu();
    const mockPrel = createMockPrel();
    window.Prel = mockPrel as unknown as typeof window.Prel;
    const renderSegments = (content: typeof piuContentWithUuid) => (
      <PiuContext.Provider value={{ piu, site: { locale: 'zh-cn', theme: 'lightday' } }}>
        <AnswerSegments segments={buildAnswerSegments([makeEnvelope(350, 'piu-uuid-mount-1', 'ANSWER', 'PIU', content)])} />
      </PiuContext.Provider>
    );
    const rendered = render(renderSegments(piuContentWithUuid));
    await vi.waitFor(() => expect(piu.emit).toHaveBeenCalledTimes(1));

    const container = screen.getByTestId('structured-piu-message');
    const replaceChildrenSpy = vi.spyOn(container, 'replaceChildren');

    rendered.rerender(renderSegments(piuContentWithUuidUpdated));
    await vi.waitFor(() => expect(piu.emit).toHaveBeenCalledTimes(2));

    // replaceChildren must NOT be called during re-render — the PIU host's
    // rendered DOM must survive between emits for progressive updates to work.
    expect(replaceChildrenSpy).not.toHaveBeenCalled();

    replaceChildrenSpy.mockRestore();
    cleanup();
    delete window.Prel;
  });
});
// --- PIU uuid: batch emit when multiple same-uuid events arrive in one render ---
describe('PIU uuid batch emit', () => {
  it('emits each PIU data when multiple same-uuid events arrive in one batch', async () => {
    const piu = createMockPiu();
    const mockPrel = createMockPrel();
    window.Prel = mockPrel as unknown as typeof window.Prel;
    const events: StreamEnvelope[] = [
      makeEnvelope(360, 'piu-batch-1', 'ANSWER', 'PIU', piuContentWithUuid),
      makeEnvelope(361, 'piu-batch-2', 'ANSWER', 'PIU', piuContentWithUuidUpdated),
    ];
    const segments = buildAnswerSegments(events);
    render(
      <PiuContext.Provider value={{ piu, site: { locale: 'zh-cn', theme: 'lightday' } }}>
        <AnswerSegments segments={segments} />
      </PiuContext.Provider>,
    );
    await vi.waitFor(() => expect(piu.emit).toHaveBeenCalledTimes(2));
    const firstPayload = (piu.emit as ReturnType<typeof vi.fn>).mock.calls[0]![1];
    const secondPayload = (piu.emit as ReturnType<typeof vi.fn>).mock.calls[1]![1];
    expect(firstPayload).toHaveProperty('uuid', 'piu-uuid-001');
    expect(secondPayload).toHaveProperty('uuid', 'piu-uuid-001');
    expect(screen.getAllByTestId('structured-piu-message')).toHaveLength(1);
    cleanup();
    delete window.Prel;
  });
});
// --- AnswerSegments: component rendering tests ---
describe('AnswerSegments component rendering', () => {
  it('renders an answer-segments container with all 6 segments', () => {
    const segments = buildAnswerSegments(mockAnswerEvents);
    render(<AnswerSegments segments={segments} />);
    expect(screen.getByTestId('answer-segments')).toBeTruthy();
  });
  it('renders FileCard for FILE segment with correct filename', () => {
    const segments = buildAnswerSegments(mockAnswerEvents);
    render(<AnswerSegments segments={segments} />);
    const fileCard = screen.getByTestId('structured-file-card');
    expect(fileCard.textContent).toContain(fileName);
  });
  it('renders ActionCard for ACTION segment with action text', () => {
    const segments = buildAnswerSegments(mockAnswerEvents);
    render(<AnswerSegments segments={segments} />);
    const actionCard = screen.getByTestId('structured-action-card');
    expect(actionCard.textContent).toContain('已自动打开网络拓扑页面');
  });
  it('renders OperatorButtons for OPERATOR segment with both buttons', () => {
    const segments = buildAnswerSegments(mockAnswerEvents);
    render(<AnswerSegments segments={segments} />);
    const operatorContainer = screen.getByTestId('structured-operator-buttons');
    expect(operatorContainer.textContent).toContain('是否需要派单至现场运维？');
    const buttons = operatorContainer.querySelectorAll('button');
    expect(buttons).toHaveLength(2);
    expect(buttons[0]!.textContent).toBe('派单');
    expect(buttons[1]!.textContent).toBe('取消');
  });
  it('renders DslRenderer for DSL segment', () => {
    const segments = buildAnswerSegments(mockAnswerEvents);
    render(<AnswerSegments segments={segments} />);
    expect(screen.getByTestId('structured-dsl-renderer')).toBeTruthy();
  });
  it('renders PiuMessage for PIU segment', () => {
    const segments = buildAnswerSegments(mockAnswerEvents);
    render(<AnswerSegments segments={segments} />);
    expect(screen.getByTestId('structured-piu-message')).toBeTruthy();
  });
});

// --- PiuMessage: string content parsing ---
describe('PiuMessage string content parsing', () => {
  it('parsePiuContent parses a JSON string into an object', () => {
    const parsed = parsePiuContent(JSON.stringify(piuContent));
    expect(parsed).toEqual(piuContent);
  });

  it('parsePiuContent returns empty object for unparseable string', () => {
    expect(parsePiuContent('not-json')).toEqual({});
  });

  it('parsePiuContent returns the object as-is when already an object', () => {
    expect(parsePiuContent(piuContent)).toEqual(piuContent);
  });

  it('parsePiuContent returns empty object for null or undefined', () => {
    expect(parsePiuContent(null)).toEqual({});
    expect(parsePiuContent(undefined)).toEqual({});
  });

  it('renders PiuMessage when PIU segment content is a JSON string', () => {
    const segments = buildAnswerSegments([makeEnvelope(120, 'mock-structured-evt-120', 'ANSWER', 'PIU', JSON.stringify(piuContent))]);
    render(<AnswerSegments segments={segments} />);
    expect(screen.getByTestId('structured-piu-message')).toBeTruthy();
  });
});
// --- ActionCard: CustomEvent dispatch tests ---
describe('ActionCard CustomEvent dispatch', () => {
  beforeEach(() => {
    vi.spyOn(document, 'dispatchEvent');
  });
  it('dispatches openNetworkTopology CustomEvent with parsed detail', () => {
    render(<ActionCard content={actionContent} />);
    expect(document.dispatchEvent).toHaveBeenCalledOnce();
    const event = (document.dispatchEvent as unknown as ReturnType<typeof vi.spyOn>).mock.calls[0]![0] as CustomEvent;
    expect(event.type).toBe('openNetworkTopology');
    expect(event.detail).toEqual({ topologyId: 'topo-broadband-001', region: '华东' });
  });
});
// --- OperatorButtons: click dispatch tests ---
describe('OperatorButtons click dispatch', () => {
  beforeEach(() => {
    vi.spyOn(document, 'dispatchEvent');
  });
  it('dispatches dispatchTicket event when 派单 button is clicked', () => {
    render(<OperatorButtons content={operatorContent} />);
    const buttons = screen.getByTestId('structured-operator-buttons').querySelectorAll('button');
    fireEvent.click(buttons[0]!);
    expect(document.dispatchEvent).toHaveBeenCalledOnce();
    const event = (document.dispatchEvent as unknown as ReturnType<typeof vi.spyOn>).mock.calls[0]![0] as CustomEvent;
    expect(event.type).toBe('dispatchTicket');
    expect(event.detail).toEqual({ ticketType: 'field-ops', priority: 'P2', region: '华东' });
  });
  it('dispatches cancelDispatch event when 取消 button is clicked', () => {
    render(<OperatorButtons content={operatorContent} />);
    const buttons = screen.getByTestId('structured-operator-buttons').querySelectorAll('button');
    fireEvent.click(buttons[1]!);
    expect(document.dispatchEvent).toHaveBeenCalledOnce();
    const event = (document.dispatchEvent as unknown as ReturnType<typeof vi.spyOn>).mock.calls[0]![0] as CustomEvent;
    expect(event.type).toBe('cancelDispatch');
    expect(event.detail).toEqual({ action: 'cancel' });
  });
});
// --- FileCard: rendering tests ---
describe('FileCard rendering', () => {
  it('renders the filename inside the card', () => {
    render(<FileCard content={fileName} />);
    const card = screen.getByTestId('structured-file-card');
    expect(card.textContent).toContain(fileName);
  });
});
// --- PiuMessage: dev mode placeholder ---
describe('PiuMessage dev mode placeholder', () => {
  it('shows placeholder text when window.Prel is not set', () => {
    const origPrel = window.Prel;
    delete window.Prel;
    render(<PiuMessage content={piuContent} />);
    const msg = screen.getByTestId('structured-piu-message');
    expect(msg.textContent).toContain('PIU');
    window.Prel = origPrel;
  });

  it('localizes the local-preview-unavailable placeholder', async () => {
    const origPrel = window.Prel;
    delete window.Prel;
    await act(async () => {
      await i18n.changeLanguage('zh-CN');
    });
    const zhRender = render(<PiuMessage content={piuContent} />);
    expect(screen.getByTestId('structured-piu-message').textContent).toBe('PIU 内容（本地不可预览）');
    zhRender.unmount();

    await act(async () => {
      await i18n.changeLanguage('en-US');
    });
    const enRender = render(<PiuMessage content={piuContent} />);
    expect(screen.getByTestId('structured-piu-message').textContent).toBe('PIU content (local preview unavailable)');
    enRender.unmount();
    await act(async () => {
      await i18n.changeLanguage('zh-CN');
    });
    window.Prel = origPrel;
  });

  it('localizes the waiting-for-host-render placeholder', async () => {
    const origPrel = window.Prel;
    const piu = createMockPiu();
    window.Prel = createMockPrel() as unknown as typeof window.Prel;
    await act(async () => {
      await i18n.changeLanguage('zh-CN');
    });
    const zhRender = render(
      <PiuContext.Provider value={{ piu, site: { locale: 'zh-cn', theme: 'lightday' } }}>
        <PiuMessage content={defaultPiuContent} />
      </PiuContext.Provider>,
    );
    expect(screen.getByTestId('structured-piu-message').textContent).toBe('PIU: thoughtChain@1.0.0（等待宿主渲染）');
    zhRender.unmount();

    await act(async () => {
      await i18n.changeLanguage('en-US');
    });
    const enRender = render(
      <PiuContext.Provider value={{ piu, site: { locale: 'en-us', theme: 'lightday' } }}>
        <PiuMessage content={defaultPiuContent} />
      </PiuContext.Provider>,
    );
    expect(screen.getByTestId('structured-piu-message').textContent).toBe('PIU: thoughtChain@1.0.0 (waiting for host rendering)');
    enRender.unmount();
    await act(async () => {
      await i18n.changeLanguage('zh-CN');
    });
    window.Prel = origPrel;
  });
});

// --- PiuMessage: emit payload shape contract ---
type PiuMessageProps = Parameters<typeof PiuMessage>[0];

function createMockPiu(): PIU {
  return {
    id: 'test-piu',
    name: 'TestPIU',
    version: '1.0.0',
    config: {},
    deps: [],
    isBrowser: true,
    revs: { 'febs.regs': '', 'febs.server': '' },
    attach: vi.fn(),
    emit: vi.fn(),
  };
}

function createMockPrel() {
  return {
    ready: (cb: () => void) => cb(),
    autoLoad: vi.fn(async () => {}),
    start: vi.fn(),
  };
}

function renderPiuMessageWithPrel(content: PiuMessageProps['content'], piu: PIU, isHistory?: boolean) {
  const mockPrel = createMockPrel();
  window.Prel = mockPrel as unknown as typeof window.Prel;
  render(
    <PiuContext.Provider value={{ piu, site: { locale: 'zh-cn', theme: 'lightday' } }}>
      <PiuMessage content={content} {...(isHistory === undefined ? {} : { isHistory })} />
    </PiuContext.Provider>,
  );
  return piu;
}

const defaultPiuContent = {
  piuName: 'thoughtChain',
  piuVersion: '1.0.0',
  method: 'render',
  data: { steps: [{ title: 'step1', status: 'success' }] },
};

const spreadDataPiuContent = {
  piuName: 'dte-bi-agent',
  piuVersion: '2.0.0',
  method: 'render',
  data: { chartId: 'bi-001', filters: { region: 'east' } },
};

describe('PiuMessage emit payload shape', () => {
  afterEach(() => {
    cleanup();
    delete window.Prel;
  });

  it('emits whole content payload for non-allowlist piuName', async () => {
    const piu = createMockPiu();
    renderPiuMessageWithPrel(defaultPiuContent, piu);
    await vi.waitFor(() => {
      expect(piu.emit).toHaveBeenCalledTimes(1);
    });
    const [key, payload] = (piu.emit as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(key).toBe('render');
    expect(payload).toEqual(
      expect.objectContaining({
        piuName: 'thoughtChain',
        piuVersion: '1.0.0',
        method: 'render',
        data: { steps: [{ title: 'step1', status: 'success' }] },
        expandPanelId: EXPAND_PANEL_DIV_ID,
        isHistory: false,
      }),
    );
    expect(payload).toHaveProperty('wrapperId');
    expect(payload).toHaveProperty('containerId');
    expect(payload).toHaveProperty('handleExpandPanelOpen');
    expect(payload).toHaveProperty('handleExpandPanelClose');
  });

  it('emits isHistory true for history replay', async () => {
    const piu = createMockPiu();
    renderPiuMessageWithPrel(defaultPiuContent, piu, true);
    await vi.waitFor(() => {
      expect(piu.emit).toHaveBeenCalledTimes(1);
    });
    const [, payload] = (piu.emit as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect((payload as Record<string, unknown>).isHistory).toBe(true);
  });

  it('emits spread-data payload for dte-bi-agent', async () => {
    const piu = createMockPiu();
    renderPiuMessageWithPrel(spreadDataPiuContent, piu);
    await vi.waitFor(() => {
      expect(piu.emit).toHaveBeenCalledTimes(1);
    });
    const [key, payload] = (piu.emit as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(key).toBe('render');
    expect(payload).toEqual(
      expect.objectContaining({
        chartId: 'bi-001',
        filters: { region: 'east' },
        expandPanelId: EXPAND_PANEL_DIV_ID,
        isHistory: false,
      }),
    );
    expect(payload).toHaveProperty('wrapperId');
    expect(payload).toHaveProperty('containerId');
    expect(payload).toHaveProperty('handleExpandPanelOpen');
    expect(payload).toHaveProperty('handleExpandPanelClose');
    expect(payload).not.toHaveProperty('piuName');
    expect(payload).not.toHaveProperty('piuVersion');
    expect(payload).not.toHaveProperty('method');
  });

  it('host fields override same-named content.data keys', async () => {
    const piu = createMockPiu();
    const content = {
      ...defaultPiuContent,
      data: { ...defaultPiuContent.data, wrapperId: 'evil', expandPanelId: 'evil', isHistory: true },
    };
    renderPiuMessageWithPrel(content, piu);
    await vi.waitFor(() => {
      expect(piu.emit).toHaveBeenCalledTimes(1);
    });
    const [, payload] = (piu.emit as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect((payload as Record<string, unknown>).wrapperId).not.toBe('evil');
    expect((payload as Record<string, unknown>).expandPanelId).toBe(EXPAND_PANEL_DIV_ID);
    expect((payload as Record<string, unknown>).isHistory).toBe(false);
  });

  it('spread-data payload degrades to host fields when data is absent', async () => {
    const piu = createMockPiu();
    const content = { piuName: 'dte-bi-agent', piuVersion: '2.0.0', method: 'render' };
    renderPiuMessageWithPrel(content, piu);
    await vi.waitFor(() => {
      expect(piu.emit).toHaveBeenCalledTimes(1);
    });
    const [, payload] = (piu.emit as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(Object.keys(payload as object)).toEqual(
      expect.arrayContaining(['wrapperId', 'containerId', 'handleExpandPanelOpen', 'handleExpandPanelClose', 'expandPanelId']),
    );
    expect(payload).not.toHaveProperty('piuName');
    expect(payload).not.toHaveProperty('method');
  });

  it('spread-data payload ignores non-object data (string)', async () => {
    const piu = createMockPiu();
    const content = { piuName: 'dte-bi-agent', piuVersion: '2.0.0', method: 'render', data: 'not-an-object' as unknown as Record<string, unknown> };
    renderPiuMessageWithPrel(content, piu);
    await vi.waitFor(() => {
      expect(piu.emit).toHaveBeenCalledTimes(1);
    });
    const [, payload] = (piu.emit as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(payload as Record<string, unknown>).not.toHaveProperty('0');
    expect(payload as Record<string, unknown>).not.toHaveProperty('1');
    expect(payload).toHaveProperty('wrapperId');
    expect(payload).toHaveProperty('expandPanelId');
  });

  it('spread-data payload ignores non-object data (array)', async () => {
    const piu = createMockPiu();
    const content = { piuName: 'dte-bi-agent', piuVersion: '2.0.0', method: 'render', data: ['a', 'b'] as unknown as Record<string, unknown> };
    renderPiuMessageWithPrel(content, piu);
    await vi.waitFor(() => {
      expect(piu.emit).toHaveBeenCalledTimes(1);
    });
    const [, payload] = (piu.emit as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(payload as Record<string, unknown>).not.toHaveProperty('0');
    expect(payload as Record<string, unknown>).not.toHaveProperty('1');
    expect(Object.keys(payload as object).sort()).toEqual(
      ['containerId', 'expandPanelId', 'handleExpandPanelClose', 'handleExpandPanelOpen', 'isHistory', 'wrapperId'].sort(),
    );
  });
  it('does not reload or emit when rerendered with equal JSON content', async () => {
    const piu = createMockPiu();
    const mockPrel = createMockPrel();
    window.Prel = mockPrel as unknown as typeof window.Prel;
    const renderMessage = () => (
      <PiuContext.Provider value={{ piu, site: { locale: 'zh-cn', theme: 'lightday' } }}>
        <PiuMessage content={parsePiuContent(JSON.stringify(defaultPiuContent))} />
      </PiuContext.Provider>
    );
    const rendered = render(renderMessage());
    await vi.waitFor(() => expect(piu.emit).toHaveBeenCalledTimes(1));

    rendered.rerender(renderMessage());
    await Promise.resolve();

    expect(mockPrel.autoLoad).toHaveBeenCalledTimes(1);
    expect(piu.emit).toHaveBeenCalledTimes(1);
  });

  it('emits again when isHistory changes with equal JSON content', async () => {
    const piu = createMockPiu();
    const mockPrel = createMockPrel();
    window.Prel = mockPrel as unknown as typeof window.Prel;
    const renderMessage = (isHistory?: boolean) => (
      <PiuContext.Provider value={{ piu, site: { locale: 'zh-cn', theme: 'lightday' } }}>
        <PiuMessage content={defaultPiuContent} {...(isHistory === undefined ? {} : { isHistory })} />
      </PiuContext.Provider>
    );
    const rendered = render(renderMessage());
    await vi.waitFor(() => expect(piu.emit).toHaveBeenCalledTimes(1));

    rendered.rerender(renderMessage(true));

    await vi.waitFor(() => expect(piu.emit).toHaveBeenCalledTimes(2));
    const payloads = (piu.emit as ReturnType<typeof vi.fn>).mock.calls.map(([, payload]) => payload as Record<string, unknown>);
    expect(payloads.map((payload) => payload.isHistory)).toEqual([false, true]);
    expect(mockPrel.autoLoad).toHaveBeenCalledTimes(2);
  });

  it('emits again when the PIU content value changes', async () => {
    const piu = createMockPiu();
    const mockPrel = createMockPrel();
    window.Prel = mockPrel as unknown as typeof window.Prel;
    const renderMessage = (stepTitle: string) => (
      <PiuContext.Provider value={{ piu, site: { locale: 'zh-cn', theme: 'lightday' } }}>
        <PiuMessage
          content={{
            ...defaultPiuContent,
            data: { steps: [{ title: stepTitle, status: 'success' }] },
          }}
        />
      </PiuContext.Provider>
    );
    const rendered = render(renderMessage('step1'));
    await vi.waitFor(() => expect(piu.emit).toHaveBeenCalledTimes(1));

    rendered.rerender(renderMessage('step2'));

    await vi.waitFor(() => expect(piu.emit).toHaveBeenCalledTimes(2));
    expect(mockPrel.autoLoad).toHaveBeenCalledTimes(2);
  });

  it('clears its container and suppresses a pending emit after unmount', async () => {
    const piu = createMockPiu();
    let resolveAutoLoad: (() => void) | undefined;
    const autoLoadPromise = new Promise<void>((resolve) => {
      resolveAutoLoad = resolve;
    });
    window.Prel = {
      ...createMockPrel(),
      autoLoad: vi.fn(() => autoLoadPromise),
    } as unknown as typeof window.Prel;
    const rendered = render(
      <PiuContext.Provider value={{ piu, site: { locale: 'zh-cn', theme: 'lightday' } }}>
        <PiuMessage content={defaultPiuContent} />
      </PiuContext.Provider>,
    );
    const container = screen.getByTestId('structured-piu-message');
    container.appendChild(document.createElement('input'));

    rendered.unmount();

    expect(container.children).toHaveLength(0);
    await act(async () => {
      resolveAutoLoad?.();
      await autoLoadPromise;
    });
    expect(piu.emit).not.toHaveBeenCalled();
  });
});
// --- DslRenderer: stub rendering ---
describe('DslRenderer stub rendering', () => {
  it('renders the DSL container', () => {
    render(<SimpleDslRenderer content={dslContent} />);
    expect(screen.getByTestId('structured-dsl-renderer')).toBeTruthy();
  });
});
