// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react';
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

afterEach(() => {
  cleanup();
  __resetTurnBlockTestState();
});

describe('completed assistant Markdown rendering', () => {
  it('renders completed ordinary assistant Markdown and code as semantic elements', () => {
    const block: TurnBlock = {
      rootMessageId: 'msg-1',
      userMessage: {
        messageId: 'msg-1',
        sessionId: 'session-1',
        role: 'USER',
        sequence: 1,
        content: '检查设备状态',
        contentType: 'PLAIN_TEXT',
        metadata: {},
        createdAt: '2026-07-14T00:00:00Z',
        visible: true,
        requestContextId: 'req-1',
        rootMessageId: 'msg-1',
      },
      aiEvents: [
        {
          eventId: 'evt-1',
          sessionId: 'session-1',
          requestId: 'req-1',
          sequence: 2,
          eventType: 'LLM_CONTENT_DELTA',
          timelineEventRef: null,
          transportHints: ['SSE'],
          payload: {
            content: [
              '## 诊断结论',
              '',
              '- 设备在线',
              '- 链路正常',
              '',
              '> 未发现阻断告警',
              '',
              '状态为 **正常**，可执行 `show status` 复核。',
              '',
              '```ts',
              'const status = "ok";',
              '```',
            ].join('\n'),
          },
          createdAt: '2026-07-14T00:00:01Z',
        } as StreamEnvelope,
      ],
      status: 'COMPLETED',
      isLatest: true,
    };

    const { container } = render(
      <AppProviders mode="local">
        <TurnBlockComponent block={block} onRetry={() => {}} onEdit={() => {}} onCancel={() => {}} />
      </AppProviders>,
    );

    expect(container.querySelector('h2')?.textContent).toBe('诊断结论');
    expect(Array.from(container.querySelectorAll('ul > li'), (item) => item.textContent)).toEqual(['设备在线', '链路正常']);
    expect(container.querySelector('blockquote')?.textContent).toContain('未发现阻断告警');
    expect(container.querySelector('strong')?.textContent).toBe('正常');
    expect(container.querySelector('p code')?.textContent).toBe('show status');
    expect(container.querySelector('pre code')?.textContent).toContain('const status = "ok";');
  });
});
