// @vitest-environment jsdom
import { cleanup, render as testingLibraryRender } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

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

import { AppProviders } from '../src/app/AppProviders.tsx';
import { __resetTurnBlockTestState, TurnBlockComponent } from '../src/features/chat/components/TurnBlock';
import type { StreamEnvelope, TurnBlock } from '../src/state/contracts';

function render(ui: Parameters<typeof testingLibraryRender>[0]) {
  return testingLibraryRender(<AppProviders mode="local">{ui}</AppProviders>);
}

afterEach(() => {
  cleanup();
  __resetTurnBlockTestState();
});

const tableMarkdown = '| 检查项目 | 状态 | 详情 |\n|---------|------|------|\n| 设备连通性 | 正常 | ping 延迟 2ms |';

const mockBlock: TurnBlock = {
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
  status: 'COMPLETED',
  isLatest: true,
};

describe('completed assistant Markdown GFM tables', () => {
  it('renders pipe tables as semantic table elements in TurnBlock', () => {
    const block: TurnBlock = {
      ...mockBlock,
      aiEvents: [
        {
          eventId: 'evt-1',
          sessionId: 'session-1',
          requestId: 'req-1',
          sequence: 2,
          eventType: 'LLM_CONTENT_DELTA',
          timelineEventRef: null,
          transportHints: ['SSE'],
          payload: { content: tableMarkdown },
          createdAt: '2026-04-15T00:00:01Z',
        } as StreamEnvelope,
        {
          eventId: 'evt-2',
          sessionId: 'session-1',
          requestId: 'req-1',
          sequence: 3,
          eventType: 'CAPABILITY_RESULT_DELTA',
          timelineEventRef: null,
          transportHints: ['SSE'],
          payload: { text: 'tool output hidden from answer', toolCallId: 'tool-1', toolName: 'ipPoolManager' },
          createdAt: '2026-04-15T00:00:02Z',
        } as StreamEnvelope,
      ],
    };

    const { container } = render(<TurnBlockComponent block={block} onRetry={() => {}} onEdit={() => {}} onCancel={() => {}} />);

    const assistantContentRegion = container.querySelector('[data-testid="assistant-content-region"]');
    const table = container.querySelector('table') as HTMLTableElement | null;
    const tableWrapper = table?.parentElement as HTMLElement | null;
    expect(table).toBeTruthy();
    expect(tableWrapper?.style.width).toBe('100%');
    expect(tableWrapper?.style.maxWidth).toBe('100%');
    expect(tableWrapper?.style.minWidth).toBe('0px');
    expect(tableWrapper?.style.overflowX).toBe('auto');
    expect(tableWrapper?.classList.contains('markdown-table-scroll')).toBe(true);
    expect(tableWrapper?.style.marginBottom).toBe('16px');
    expect(table?.style.width).toBe('max-content');
    expect(table?.style.minWidth).toBe('max(100%, 560px)');
    expect(table?.style.marginBottom).toBe('0px');
    expect(table?.style.fontSize).toBe('');
    expect(container.querySelector('th')).toBeTruthy();
    expect(container.querySelector('td')).toBeTruthy();
    expect(assistantContentRegion?.textContent).not.toContain('tool output hidden from answer');
  });

  it('does not add a fixed maximum width inside the shared message column', () => {
    const block: TurnBlock = {
      ...mockBlock,
      aiEvents: [
        {
          eventId: 'evt-prose-width',
          sessionId: 'session-1',
          requestId: 'req-1',
          sequence: 2,
          eventType: 'LLM_CONTENT_DELTA',
          timelineEventRef: null,
          transportHints: ['SSE'],
          payload: { content: `宽屏正文用于验证连续阅读行长。\n\n${tableMarkdown}` },
          createdAt: '2026-04-15T00:00:01Z',
        } as StreamEnvelope,
      ],
    };

    const { container } = render(<TurnBlockComponent block={block} onRetry={() => {}} onEdit={() => {}} onCancel={() => {}} />);

    const proseSegment = container.querySelector('.markdown-prose-segment') as HTMLElement | null;
    const tableWrapper = container.querySelector('.markdown-table-scroll') as HTMLElement | null;
    expect(proseSegment?.style.width).toBe('100%');
    expect(proseSegment?.style.maxWidth).toBe('');
    expect(tableWrapper?.style.maxWidth).toBe('100%');
  });

  it('preserves GFM alignment on header and body cells', () => {
    const alignmentMarkdown = ['| 名称 | 数值 | 状态 | 说明 |', '| :--- | ---: | :---: | --- |', '| 项目 A | 123456.78 | 正常 | 描述文本 |'].join(
      '\n',
    );
    const block: TurnBlock = {
      ...mockBlock,
      aiEvents: [
        {
          eventId: 'evt-alignment-table',
          sessionId: 'session-1',
          requestId: 'req-1',
          sequence: 2,
          eventType: 'LLM_CONTENT_DELTA',
          timelineEventRef: null,
          transportHints: ['SSE'],
          payload: { content: alignmentMarkdown },
          createdAt: '2026-04-15T00:00:01Z',
        } as StreamEnvelope,
      ],
    };

    const { container } = render(<TurnBlockComponent block={block} onRetry={() => {}} onEdit={() => {}} onCancel={() => {}} />);

    const headers = Array.from(container.querySelectorAll('th')) as HTMLElement[];
    const cells = Array.from(container.querySelectorAll('td')) as HTMLElement[];
    expect(headers.map((cell) => cell.style.textAlign)).toEqual(['left', 'right', 'center', 'start']);
    expect(cells.map((cell) => cell.style.textAlign)).toEqual(['left', 'right', 'center', 'start']);
    expect(headers.every((cell) => cell.style.whiteSpace === 'nowrap')).toBe(true);
    expect(cells[1]?.style.whiteSpace).toBe('nowrap');
    expect(cells[2]?.style.whiteSpace).toBe('nowrap');
  });

  it('keeps alignment when appending a table row after a blank line', () => {
    const alignedSeparatedRows = ['| 名称 | 数值 | 状态 |', '| :--- | ---: | :---: |', '| 项目 A | 1 | 正常 |', '', '| 项目 B | 2 | 关注 |'].join(
      '\n',
    );
    const block: TurnBlock = {
      ...mockBlock,
      aiEvents: [
        {
          eventId: 'evt-aligned-separated-table',
          sessionId: 'session-1',
          requestId: 'req-1',
          sequence: 2,
          eventType: 'LLM_CONTENT_DELTA',
          timelineEventRef: null,
          transportHints: ['SSE'],
          payload: { content: alignedSeparatedRows },
          createdAt: '2026-04-15T00:00:01Z',
        } as StreamEnvelope,
      ],
    };

    const { container } = render(<TurnBlockComponent block={block} onRetry={() => {}} onEdit={() => {}} onCancel={() => {}} />);

    expect(container.querySelectorAll('tbody tr')).toHaveLength(2);
    for (const row of Array.from(container.querySelectorAll('tbody tr'))) {
      expect(Array.from(row.querySelectorAll('td')).map((cell) => (cell as HTMLElement).style.textAlign)).toEqual(['left', 'right', 'center']);
    }
  });

  it('repairs wrapped broken table rows before rendering in TurnBlock', () => {
    const brokenWrappedTableMarkdown =
      '\n## 6. 安全事件\n\n\n### 已阻断的攻击\n\n| 攻击类型 | 次数 | 阻断率\n|\n|:--------|:----:|:------:|\n| SQL注入 | 156 | 100% |\n| XSS攻击 | 89 | 100% |\n| CSRF | 34 | 100% |\n| 暴力破解 | 2,847 | 100% |\n|\nDDoS | 3 | 100% |\n';

    const block: TurnBlock = {
      ...mockBlock,
      aiEvents: [
        {
          eventId: 'evt-broken-table',
          sessionId: 'session-1',
          requestId: 'req-1',
          sequence: 2,
          eventType: 'LLM_CONTENT_DELTA',
          timelineEventRef: null,
          transportHints: ['SSE'],
          payload: { content: brokenWrappedTableMarkdown },
          createdAt: '2026-04-15T00:00:01Z',
        } as StreamEnvelope,
      ],
    };

    const { container } = render(<TurnBlockComponent block={block} onRetry={() => {}} onEdit={() => {}} onCancel={() => {}} />);

    expect(container.querySelector('table')).toBeTruthy();
    expect(container.textContent).toContain('SQL注入');
    expect(container.textContent).toContain('DDoS');
  });

  it('repairs merged table rows that were concatenated into a single markdown line', () => {
    const mergedRowsMarkdown = [
      '## 带宽使用分析报告',
      '',
      '| 链路 | 带宽 | 峰值 | 均值 | 利用率 |',
      '|:----|----:|----:|----:|----:|',
      '| 防火墙-互联网 | 1Gbps | 920Mbps | 485Mbps | 48.5% | | 核心-服务器区 | 10Gbps | 4.5Gbps | 2.1Gbps | 21% |',
    ].join('\n');

    const block: TurnBlock = {
      ...mockBlock,
      aiEvents: [
        {
          eventId: 'evt-merged-table',
          sessionId: 'session-1',
          requestId: 'req-1',
          sequence: 2,
          eventType: 'LLM_CONTENT_DELTA',
          timelineEventRef: null,
          transportHints: ['SSE'],
          payload: { content: mergedRowsMarkdown },
          createdAt: '2026-04-15T00:00:01Z',
        } as StreamEnvelope,
      ],
    };

    const { container } = render(<TurnBlockComponent block={block} onRetry={() => {}} onEdit={() => {}} onCancel={() => {}} />);

    const rows = container.querySelectorAll('tbody tr');
    expect(container.querySelector('table')).toBeTruthy();
    expect(rows).toHaveLength(2);
    expect(container.textContent).toContain('防火墙-互联网');
    expect(container.textContent).toContain('核心-服务器区');
  });

  it('repairs a fully flattened pipe table emitted as one markdown line', () => {
    const flattenedTableMarkdown =
      '| 编号 | 对象 | 现象 | 影响 | 建议 | |:--|:--|:--|:--|:--| | F-01 | Edge-RTR-02 | CPU 持续高于 85%，峰值达到 91% | 可能导致控制面延迟、路由刷新变慢 | 先确认高 CPU 进程，再调整同步窗口 | | F-02 | Access-SW-02 | 最近 8 分钟无心跳 | 局部接入用户可能离线 | 检查电源、上联端口和维护窗口 | | F-03 | Wireless-DHCP | 地址池使用率 96% | 新终端可能无法获取地址 | 扩容地址池并回收长期租约 | | F-04 | FW-01 | 丢包率下降，策略命中正常 | 暂无直接异常 | 不建议重启防火墙 |';

    const block: TurnBlock = {
      ...mockBlock,
      aiEvents: [
        {
          eventId: 'evt-flattened-table',
          sessionId: 'session-1',
          requestId: 'req-1',
          sequence: 2,
          eventType: 'LLM_CONTENT_DELTA',
          timelineEventRef: null,
          transportHints: ['SSE'],
          payload: { content: flattenedTableMarkdown },
          createdAt: '2026-04-15T00:00:01Z',
        } as StreamEnvelope,
      ],
    };

    const { container } = render(<TurnBlockComponent block={block} onRetry={() => {}} onEdit={() => {}} onCancel={() => {}} />);

    const rows = container.querySelectorAll('tbody tr');
    expect(container.querySelector('table')).toBeTruthy();
    expect(rows).toHaveLength(4);
    expect(container.textContent).toContain('Edge-RTR-02');
    expect(container.textContent).toContain('FW-01');
  });

  it('repairs merged table rows after non-accumulated content deltas are appended', () => {
    const streamedTableBlock: TurnBlock = {
      ...mockBlock,
      aiEvents: [
        {
          eventId: 'evt-stream-1',
          sessionId: 'session-1',
          requestId: 'req-1',
          sequence: 2,
          eventType: 'LLM_CONTENT_DELTA',
          timelineEventRef: null,
          transportHints: ['SSE'],
          payload: {
            text: [
              '## 带宽使用分析报告',
              '',
              '| 链路 | 带宽 | 峰值 | 均值 | 利用率 |',
              '|:----|----:|----:|----:|----:|',
              '| 防火墙-互联网 | 1Gbps | 920Mbps | 485Mbps | 48.5% |',
            ].join('\n'),
            contentType: 'MARKDOWN',
            metadata: { accumulated: false },
          },
          createdAt: '2026-04-15T00:00:01Z',
        } as StreamEnvelope,
        {
          eventId: 'evt-stream-2',
          sessionId: 'session-1',
          requestId: 'req-1',
          sequence: 3,
          eventType: 'LLM_CONTENT_DELTA',
          timelineEventRef: null,
          transportHints: ['SSE'],
          payload: {
            text: '| 核心-服务器区 | 10Gbps | 4.5Gbps | 2.1Gbps | 21% |',
            contentType: 'MARKDOWN',
            metadata: { accumulated: false },
          },
          createdAt: '2026-04-15T00:00:02Z',
        } as StreamEnvelope,
      ],
    };

    const { container } = render(<TurnBlockComponent block={streamedTableBlock} onRetry={() => {}} onEdit={() => {}} onCancel={() => {}} />);

    const rows = container.querySelectorAll('tbody tr');
    expect(container.querySelector('table')).toBeTruthy();
    expect(rows).toHaveLength(2);
    expect(container.textContent).toContain('防火墙-互联网');
    expect(container.textContent).toContain('核心-服务器区');
  });

  it('treats table body lines separated by a blank line as part of the preceding table', () => {
    const brokenSeparatedTableMarkdown = [
      '| 链路 | 带宽 | 峰值 | 均值 | 利用率 |',
      '|:----|----:|----:|----:|----:|',
      '| 核心-防火墙 | 10Gbps | 6.8Gbps | 3.2Gbps | 32% |',
      '',
      '| 防火墙-互联网 | 1Gbps | 920Mbps | 485Mbps | 48.5% |',
      '| 核心-服务器区 | 10Gbps | 4.5Gbps | 2.1Gbps | 21% |',
      '',
    ].join('\n');

    const block: TurnBlock = {
      ...mockBlock,
      aiEvents: [
        {
          eventId: 'evt-broken-separated-table',
          sessionId: 'session-1',
          requestId: 'req-1',
          sequence: 2,
          eventType: 'LLM_CONTENT_DELTA',
          timelineEventRef: null,
          transportHints: ['SSE'],
          payload: { content: brokenSeparatedTableMarkdown },
          createdAt: '2026-04-15T00:00:01Z',
        } as StreamEnvelope,
      ],
    };

    const { container } = render(<TurnBlockComponent block={block} onRetry={() => {}} onEdit={() => {}} onCancel={() => {}} />);

    const rows = container.querySelectorAll('tbody tr');
    expect(container.querySelector('table')).toBeTruthy();
    expect(rows).toHaveLength(3);
    expect(container.textContent).toContain('核心-防火墙');
    expect(container.textContent).toContain('防火墙-互联网');
    expect(container.textContent).toContain('核心-服务器区');
  });

  it('renders standard GFM tables without leading and trailing pipes', () => {
    const gfmTableMarkdown = ['接口 | 状态 | 延迟', '--- | --- | ---', 'eth0 | 正常 | 2ms', 'eth1 | 告警 | 34ms'].join('\n');

    const block: TurnBlock = {
      ...mockBlock,
      aiEvents: [
        {
          eventId: 'evt-gfm-table',
          sessionId: 'session-1',
          requestId: 'req-1',
          sequence: 2,
          eventType: 'LLM_CONTENT_DELTA',
          timelineEventRef: null,
          transportHints: ['SSE'],
          payload: { content: gfmTableMarkdown },
          createdAt: '2026-04-15T00:00:01Z',
        } as StreamEnvelope,
      ],
    };

    const { container } = render(<TurnBlockComponent block={block} onRetry={() => {}} onEdit={() => {}} onCancel={() => {}} />);

    expect(container.querySelector('table')).toBeTruthy();
    expect(container.querySelectorAll('tbody tr')).toHaveLength(2);
    expect(container.textContent).toContain('eth1');
  });

  it('keeps escaped and inline-code pipes inside table cells', () => {
    const tableWithPipes = ['| 字段 | 示例 |', '| --- | --- |', '| 转义 | a \\| b |', '| 代码 | `x | y` |'].join('\n');

    const block: TurnBlock = {
      ...mockBlock,
      aiEvents: [
        {
          eventId: 'evt-cell-pipes',
          sessionId: 'session-1',
          requestId: 'req-1',
          sequence: 2,
          eventType: 'LLM_CONTENT_DELTA',
          timelineEventRef: null,
          transportHints: ['SSE'],
          payload: { content: tableWithPipes },
          createdAt: '2026-04-15T00:00:01Z',
        } as StreamEnvelope,
      ],
    };

    const { container } = render(<TurnBlockComponent block={block} onRetry={() => {}} onEdit={() => {}} onCancel={() => {}} />);

    expect(container.querySelector('table')).toBeTruthy();
    expect(container.querySelectorAll('tbody tr')).toHaveLength(2);
    expect(container.querySelectorAll('tbody td')).toHaveLength(4);
    expect(container.textContent).toContain('a | b');
    expect(container.querySelector('tbody td code')?.textContent).toBe('x | y');
  });

  it('renders inline markdown inside table header and body cells', () => {
    const tableWithInlineMarkdown = ['| **项目** | 状态 |', '| --- | --- |', '| 诊断 | **正常** |', '| 命令 | `package_skill.py` |'].join('\n');

    const block: TurnBlock = {
      ...mockBlock,
      aiEvents: [
        {
          eventId: 'evt-inline-markdown-cells',
          sessionId: 'session-1',
          requestId: 'req-1',
          sequence: 2,
          eventType: 'LLM_CONTENT_DELTA',
          timelineEventRef: null,
          transportHints: ['SSE'],
          payload: { content: tableWithInlineMarkdown },
          createdAt: '2026-04-15T00:00:01Z',
        } as StreamEnvelope,
      ],
    };

    const { container } = render(<TurnBlockComponent block={block} onRetry={() => {}} onEdit={() => {}} onCancel={() => {}} />);

    expect(container.querySelector('thead th strong')?.textContent).toBe('项目');
    expect(container.querySelector('tbody td strong')?.textContent).toBe('正常');
    expect(container.querySelector('tbody td code')?.textContent).toBe('package_skill.py');
    expect(container.querySelector('tbody td p')).toBeNull();
  });

  it('does not convert table-shaped text inside ordinary code fences', () => {
    const fencedTableText = ['```text', '| 字段 | 值 |', '| --- | --- |', '| a | b |', '```'].join('\n');

    const block: TurnBlock = {
      ...mockBlock,
      aiEvents: [
        {
          eventId: 'evt-fenced-table',
          sessionId: 'session-1',
          requestId: 'req-1',
          sequence: 2,
          eventType: 'LLM_CONTENT_DELTA',
          timelineEventRef: null,
          transportHints: ['SSE'],
          payload: { content: fencedTableText },
          createdAt: '2026-04-15T00:00:01Z',
        } as StreamEnvelope,
      ],
    };

    const { container } = render(<TurnBlockComponent block={block} onRetry={() => {}} onEdit={() => {}} onCancel={() => {}} />);

    expect(container.querySelector('table')).toBeNull();
    expect(container.querySelector('pre')).toBeTruthy();
    expect(container.textContent).toContain('| 字段 | 值 |');
  });
});
