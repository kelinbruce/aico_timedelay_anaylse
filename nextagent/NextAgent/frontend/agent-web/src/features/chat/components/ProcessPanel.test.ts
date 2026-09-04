import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { TurnBlock } from '../../../state/contracts.ts';
import type { PIU } from '../../../host/prel.ts';
import { PiuContext } from '../context/PiuContext.tsx';
import type { ProcessDisplayEntry, ProcessEntry } from '../process/processDetails.ts';
import { __getMarkdownContentCacheSizeForTest, __resetMarkdownContentTestState } from './MarkdownContent.tsx';
import { __resetProcessPanelTestState, ProcessPanel, type ProcessPanelProps } from './ProcessPanel.tsx';

const originalMatchMedia = window.matchMedia;
const originalPrel = window.Prel;
const originalTheme = document.documentElement.getAttribute('data-theme');

function makeEntry(
  key = 'entry',
  options?: {
    readonly toolEventType?: 'TITLE';
    readonly lastSequence?: number;
    readonly title?: string;
    readonly detail?: string;
    readonly contentType?: ProcessEntry['contentType'];
    readonly kind?: ProcessEntry['kind'];
    readonly isFinal?: boolean;
    readonly isExpandable?: boolean;
    readonly structuredSegments?: ProcessEntry['structuredSegments'];
    readonly toolName?: string;
    readonly toolCallId?: string;
    readonly parentToolCallId?: string;
  },
): ProcessEntry {
  return {
    key,
    title: options?.title ?? `Step ${key}`,
    detail: options?.detail ?? `Detail ${key}`,
    rawDetail: options?.detail ?? `Detail ${key}`,
    contentType: options?.contentType ?? 'PLAIN_TEXT',
    toolName: options?.toolName ?? null,
    kind: options?.kind ?? 'tool',
    isFinal: options?.isFinal ?? false,
    sequence: 1,
    lastSequence: options?.lastSequence ?? 2,
    lastPresentationOrder: options?.lastSequence ?? 2,
    createdAt: 1783346000000,
    ...(options?.toolEventType === undefined ? {} : { toolEventType: options.toolEventType }),
    ...(options?.isExpandable === undefined ? {} : { isExpandable: options.isExpandable }),
    ...(options?.structuredSegments === undefined ? {} : { structuredSegments: options.structuredSegments }),
    ...(options?.toolCallId === undefined ? {} : { toolCallId: options.toolCallId }),
    ...(options?.parentToolCallId === undefined ? {} : { parentToolCallId: options.parentToolCallId }),
  };
}

function toDisplayEntry(entry: ProcessEntry): ProcessDisplayEntry {
  return {
    key: entry.key,
    title: entry.title,
    toolName: entry.toolName,
    summary: entry.detail,
    detail: entry.detail,
    contentType: entry.contentType,
    kind: entry.kind,
    isFinal: entry.isFinal,
    lastSequence: entry.lastSequence,
    lastPresentationOrder: entry.lastPresentationOrder,
    isExpandable: entry.isExpandable ?? false,
    ...(entry.toolEventType === undefined ? {} : { toolEventType: entry.toolEventType }),
    ...(entry.structuredSegments === undefined ? {} : { structuredSegments: entry.structuredSegments }),
    ...(entry.toolCallId === undefined ? {} : { toolCallId: entry.toolCallId }),
    ...(entry.parentToolCallId === undefined ? {} : { parentToolCallId: entry.parentToolCallId }),
  };
}

function makePanelProps(entries: readonly ProcessEntry[], overrides?: Partial<ProcessPanelProps>): ProcessPanelProps {
  return {
    block: {} as TurnBlock,
    rootMessageId: 'root',
    status: 'EXECUTING',
    isLatest: true,
    isTerminal: false,
    isViewportFollowingBottom: true,
    executionDetailsPhase: 'running',
    processEntries: entries,
    processDisplayEntries: entries.map(toDisplayEntry),
    processSummary: 'Running',
    activeProcessEntryKey: entries.at(-1)?.key ?? null,
    shouldShowProcessIdleSweep: false,
    showProcessSummary: true,
    showProcessTimelineAction: false,
    hasAnswerContent: false,
    latestAssistantAnswerPresentationOrder: null,
    pendingSupplementalInputEntryKeys: new Set(),
    ...overrides,
  };
}

function renderPanel(entries: readonly ProcessEntry[], overrides?: Partial<ProcessPanelProps>) {
  return render(React.createElement(ProcessPanel, makePanelProps(entries, overrides)));
}

afterEach(() => {
  cleanup();
  __resetProcessPanelTestState();
  __resetMarkdownContentTestState();
  window.matchMedia = originalMatchMedia;
  window.Prel = originalPrel;
  if (originalTheme === null) {
    document.documentElement.removeAttribute('data-theme');
  } else {
    document.documentElement.setAttribute('data-theme', originalTheme);
  }
  vi.useRealTimers();
});

describe('ProcessPanel active entry presentation', () => {
  it('defers stable caching until settled process explanation content is mounted again', () => {
    const runningEntry = makeEntry('live-process-explanation', {
      title: 'Execution update',
      detail: '## Live status\n\n- first update',
      contentType: 'MARKDOWN',
      kind: 'process-explanation',
      isFinal: false,
    });
    const view = renderPanel([runningEntry]);
    const liveStatusHeading = screen.getByText('Live status');

    expect(__getMarkdownContentCacheSizeForTest()).toBe(0);

    const completedEntry = makeEntry('live-process-explanation', {
      title: 'Execution update',
      detail: '## Live status\n\n- first update',
      contentType: 'MARKDOWN',
      kind: 'process-explanation',
      isFinal: true,
    });
    view.rerender(
      React.createElement(
        ProcessPanel,
        makePanelProps([completedEntry], {
          status: 'COMPLETED',
          isTerminal: true,
          executionDetailsPhase: 'settled',
          activeProcessEntryKey: null,
        }),
      ),
    );

    expect(screen.getByText('Live status')).toBe(liveStatusHeading);
    expect(__getMarkdownContentCacheSizeForTest()).toBe(0);

    view.unmount();
    renderPanel([completedEntry], {
      status: 'COMPLETED',
      isTerminal: true,
      executionDetailsPhase: 'settled',
      activeProcessEntryKey: null,
    });
    fireEvent.click(screen.getByTestId('turn-process-toggle'));

    expect(__getMarkdownContentCacheSizeForTest()).toBe(1);
  });

  it('renders a title-suppressed workflow product as content without empty step chrome', () => {
    const entry = makeEntry('workflow-content-only', {
      title: '',
      detail: 'Alarm details for Cell-3 interference',
      isFinal: true,
      isExpandable: true,
    });

    renderPanel([entry], {
      status: 'COMPLETED',
      isLatest: false,
      isTerminal: true,
      executionDetailsPhase: 'settled',
      activeProcessEntryKey: null,
    });

    fireEvent.click(screen.getByTestId('turn-process-toggle'));

    expect(screen.getByText('Alarm details for Cell-3 interference')).toBeTruthy();
    expect(screen.queryByTestId('turn-process-entry-title')).toBeNull();
    expect(screen.queryByTestId('turn-process-entry-icon-node')).toBeNull();
    expect(screen.queryByTestId('turn-process-entry-toggle')).toBeNull();
    const layoutGutter = screen.getByTestId('turn-process-entry-layout-gutter');
    expect(layoutGutter.getAttribute('aria-hidden')).toBe('true');
    expect(layoutGutter.style.width).toBe('20px');
  });

  it('keeps workflow-as-tool inner entries inside the matching outer Workflow disclosure', () => {
    const innerTitle = makeEntry('workflow-inner-title', {
      title: 'Show alarm info',
      detail: 'RRC connection failed',
      isFinal: true,
      isExpandable: true,
      parentToolCallId: 'outer-workflow-1',
    });
    const innerContent = makeEntry('workflow-inner-content', {
      title: '',
      detail: 'Alarm details for Cell-3 interference',
      isFinal: true,
      isExpandable: true,
      parentToolCallId: 'outer-workflow-1',
    });
    const unmatched = makeEntry('workflow-unmatched', {
      title: 'Independent workflow step',
      detail: 'Independent detail',
      isFinal: true,
      parentToolCallId: 'another-outer-workflow',
    });
    const outer = makeEntry('outer-workflow', {
      title: 'Workflow · 已完成',
      detail: '',
      isFinal: true,
      isExpandable: false,
      toolCallId: 'outer-workflow-1',
      toolName: 'Workflow',
    });

    renderPanel([innerTitle, innerContent, unmatched, outer], {
      status: 'COMPLETED',
      isLatest: false,
      isTerminal: true,
      executionDetailsPhase: 'settled',
      activeProcessEntryKey: null,
    });

    fireEvent.click(screen.getByTestId('turn-process-toggle'));

    expect(screen.getByText('Independent workflow step')).toBeTruthy();
    expect(screen.queryByText('Show alarm info')).toBeNull();
    expect(screen.queryByText('Alarm details for Cell-3 interference')).toBeNull();

    const outerTitle = screen.getByText('Workflow · 已完成');
    const outerToggle = outerTitle.closest('button');
    expect(outerToggle?.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(outerToggle!);

    expect(screen.getByText('Show alarm info')).toBeTruthy();
    expect(screen.getByText('Alarm details for Cell-3 interference')).toBeTruthy();
    const visibleEntries = screen.getAllByTestId('turn-process-entry').map((entry) => entry.textContent ?? '');
    expect(visibleEntries.findIndex((text) => text.includes('Workflow · 已完成'))).toBeLessThan(
      visibleEntries.findIndex((text) => text.includes('Show alarm info')),
    );
  });

  it('shows an active Workflow outer entry expanded before its matching inner content', async () => {
    const outer = makeEntry('outer-workflow-running', {
      title: 'Workflow · 执行中',
      detail: '',
      isFinal: false,
      isExpandable: false,
      toolCallId: 'outer-workflow-running-1',
      toolName: 'Workflow',
    });
    const inner = makeEntry('workflow-inner-running', {
      title: 'Show alarm info',
      detail: 'RRC connection failed',
      isFinal: false,
      isExpandable: true,
      parentToolCallId: 'outer-workflow-running-1',
    });

    renderPanel([outer, inner]);

    const outerToggle = screen.getByText('Workflow · 执行中').closest('button');
    await waitFor(() => expect(outerToggle?.getAttribute('aria-expanded')).toBe('true'));
    expect(screen.getByText('Show alarm info')).toBeTruthy();
    expect(screen.getByText('RRC connection failed')).toBeTruthy();
  });

  it('renders a completed status-only capability without an empty disclosure control', () => {
    const entry = makeEntry('status-only', {
      title: 'CustomNetworkProbe · 已完成',
      detail: '',
      isFinal: true,
      isExpandable: false,
    });
    const displayEntry: ProcessDisplayEntry = {
      ...toDisplayEntry(entry),
      summary: '',
      detail: '',
      isExpandable: false,
    };

    renderPanel([entry], {
      processDisplayEntries: [displayEntry],
      activeProcessEntryKey: null,
    });

    expect(screen.getByText('CustomNetworkProbe · 已完成')).toBeTruthy();
    expect(screen.queryByTestId('turn-process-entry-toggle')).toBeNull();
    expect(screen.queryByTestId('turn-process-entry-detail')).toBeNull();
  });

  it('shows the factual failure reason once while technical failure details are expanded', () => {
    const reason = '修改文件前需要先完整读取最新内容。';
    const detail = ['错误码：WRITE_REQUIRES_FULL_READ', '错误类别：CONFLICT', '调用状态：失败'].join('\n');
    const baseEntry = makeEntry('failure-card', {
      title: 'Write · 未能完成',
      detail,
      isFinal: true,
      isExpandable: true,
    });
    const entry = {
      ...baseEntry,
      summary: reason,
      isFailure: true,
    } as ProcessEntry;
    const displayEntry = {
      ...toDisplayEntry(entry),
      summary: reason,
      detail,
      isExpandable: true,
      isFailure: true,
    } as ProcessDisplayEntry;

    renderPanel([entry], {
      processDisplayEntries: [displayEntry],
      activeProcessEntryKey: null,
    });

    const failureReason = screen.getByTestId('turn-process-failure-reason');
    expect(failureReason.textContent).toBe(reason);
    expect(failureReason.style.fontSize).toBe('14px');
    expect(failureReason.style.lineHeight).toBe('1.5');
    // Failure entries auto-expand so the technical detail is visible by default;
    // the human-readable failure reason is rendered separately and must not duplicate.
    expect(screen.getByTestId('turn-process-entry-toggle').getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByTestId('turn-process-entry-detail').textContent).toContain('WRITE_REQUIRES_FULL_READ');

    fireEvent.click(screen.getByTestId('turn-process-entry-toggle'));

    expect(screen.getByTestId('turn-process-entry-toggle').getAttribute('aria-expanded')).toBe('false');
    expect(screen.getAllByText(reason)).toHaveLength(1);
    expect(document.body.textContent).not.toMatch(/执行结果：|请先读取|系统将继续|重试/);
  });

  it('renders RAG sources as clickable labels without content preview', () => {
    const entry = makeEntry('rag', { isFinal: true });
    const ragDisplayEntry: ProcessDisplayEntry = {
      ...toDisplayEntry(entry),
      isExpandable: true,
      ragRetrievalItems: [
        {
          displaySource: 'rag-upf-timeout-test.md',
          content: '# UPF timeout\n\nUnique recovery guidance',
        },
      ],
    };
    renderPanel([entry], {
      processDisplayEntries: [ragDisplayEntry],
      activeProcessEntryKey: 'rag',
    });

    fireEvent.click(screen.getByTestId('turn-process-entry-toggle'));
    expect(screen.getByTestId('turn-process-rag-source').textContent).toBe('rag-upf-timeout-test.md');
    expect(screen.queryByTestId('turn-process-rag-preview')).toBeNull();
  });

  it('truncates RAG source label at 512 characters with ellipsis', () => {
    const longSource = 's'.repeat(600);
    const entry = makeEntry('rag', { isFinal: true });
    const ragDisplayEntry: ProcessDisplayEntry = {
      ...toDisplayEntry(entry),
      isExpandable: true,
      ragRetrievalItems: [
        {
          displaySource: longSource,
          content: 'irrelevant content',
        },
      ],
    };
    renderPanel([entry], {
      processDisplayEntries: [ragDisplayEntry],
      activeProcessEntryKey: 'rag',
    });

    fireEvent.click(screen.getByTestId('turn-process-entry-toggle'));
    expect(screen.getByTestId('turn-process-rag-source').textContent).toBe(`${'s'.repeat(512)}...`);
  });

  it('opens a modal with markdown-rendered content when clicking the source label', () => {
    const entry = makeEntry('rag', { isFinal: true });
    const ragDisplayEntry: ProcessDisplayEntry = {
      ...toDisplayEntry(entry),
      isExpandable: true,
      ragRetrievalItems: [
        {
          displaySource: 'rag-upf-timeout-test.md',
          content: '# UPF timeout\n\nUnique recovery guidance',
        },
      ],
    };
    renderPanel([entry], {
      processDisplayEntries: [ragDisplayEntry],
      activeProcessEntryKey: 'rag',
    });

    fireEvent.click(screen.getByTestId('turn-process-entry-toggle'));
    fireEvent.click(screen.getByTestId('turn-process-rag-source'));

    expect(screen.getByText('UPF timeout')).toBeTruthy();
    expect(screen.getByText('Unique recovery guidance')).toBeTruthy();

    const modal = document.querySelector<HTMLElement>('.ant-modal');
    expect(modal).not.toBeNull();
    expect(modal?.style.width).toBe('800px');
    expect(document.querySelector('.ant-modal-wrap')?.classList.contains('ant-modal-centered')).toBe(true);
    expect(document.querySelector('.ant-modal-header')).not.toBeNull();

    const modalBody = document.querySelector<HTMLElement>('.ant-modal-body');
    expect(modalBody).not.toBeNull();
    expect(modalBody?.style.maxHeight).toBe('70vh');
    expect(modalBody?.style.overflowY).toBe('auto');
    expect(modalBody?.classList.contains('nextagent-trackless-scrollbar')).toBe(true);
  });

  it('preserves the think icon and applies the running-step treatment to the active skill node', () => {
    renderPanel([makeEntry('think', { title: '思考', kind: 'thinking' }), makeEntry('tool', { title: 'Skill 调用', kind: 'tool' })], {
      activeProcessEntryKey: 'tool',
    });

    const iconNodes = screen.getAllByTestId('turn-process-entry-icon-node');
    const thinkIcon = iconNodes[0]?.querySelector('img');
    const skillIcon = iconNodes[1]?.querySelector('img');
    expect(thinkIcon?.getAttribute('src')).toContain('think-light.svg');
    expect(skillIcon?.getAttribute('src')).toContain('step-running-animated.svg');
    expect(thinkIcon?.style.width).toBe('14px');
    expect(thinkIcon?.style.height).toBe('14px');
    expect(skillIcon?.style.width).toBe('16px');
    expect(skillIcon?.style.height).toBe('16px');
  });

  it('uses warning and info status icons for governed system events without changing failure or success icons', () => {
    const warningEntry = makeEntry('warning-event', {
      title: '本次任务有部分内容未完成',
      kind: 'system',
      isFinal: true,
    });
    const infoEntry = makeEntry('info-event', {
      title: '已整理较早的对话',
      kind: 'system',
      isFinal: true,
    });
    const failedEntry = { ...makeEntry('failed-tool', { title: 'Probe', isFinal: true }), isFailure: true };
    const completedEntry = makeEntry('completed-tool', { title: 'Read', isFinal: true });
    const entries = [warningEntry, infoEntry, failedEntry, completedEntry];
    const displayEntries = [
      { ...toDisplayEntry(warningEntry), presentation: 'governed-system-event', severity: 'warning' },
      { ...toDisplayEntry(infoEntry), presentation: 'governed-system-event', severity: 'info' },
      { ...toDisplayEntry(failedEntry), isFailure: true },
      toDisplayEntry(completedEntry),
    ] as readonly ProcessDisplayEntry[];

    renderPanel(entries, {
      activeProcessEntryKey: null,
      processDisplayEntries: displayEntries,
    });

    expect(screen.getByTestId('turn-process-entry-warning-icon').style.color).toBe('var(--color-status-warning-dot)');
    expect(screen.getByTestId('turn-process-entry-info-icon').style.color).toBe('var(--color-status-info-dot)');
    const iconNodes = screen.getAllByTestId('turn-process-entry-icon-node');
    expect(iconNodes[2]?.querySelector('img')?.getAttribute('src')).toContain('step-failed.svg');
    expect(iconNodes[3]?.querySelector('img')?.getAttribute('src')).toContain('process-complete-light.svg');
  });

  it('marks only the current live entry without moving focus', () => {
    const focusTarget = document.createElement('button');
    document.body.appendChild(focusTarget);
    focusTarget.focus();

    renderPanel([makeEntry('one'), makeEntry('two')], {
      activeProcessEntryKey: 'two',
    });

    const rows = screen.getAllByTestId('turn-process-entry');
    const iconNodes = screen.getAllByTestId('turn-process-entry-icon-node');
    const titles = screen.getAllByTestId('turn-process-entry-title');
    expect(rows).toHaveLength(2);
    expect(rows[0]?.hasAttribute('aria-current')).toBe(false);
    expect(rows[1]?.getAttribute('data-process-active')).toBe('true');
    expect(rows[1]?.getAttribute('aria-current')).toBe('step');
    expect(iconNodes[0]?.style.width).toBe('20px');
    expect(iconNodes[0]?.style.background).toBe('transparent');
    expect(iconNodes[1]?.style.width).toBe('20px');
    expect(iconNodes[1]?.style.height).toBe('20px');
    expect(iconNodes[1]?.style.borderRadius).toBe('50%');
    expect(titles[0]?.style.fontWeight).toBe('');
    expect(titles[1]?.style.fontWeight).toBe('500');
    expect(titles[1]?.classList.contains('turn-process-thinking-shimmer')).toBe(true);
    expect(titles[1]?.style.color).toBe('');
    expect(document.activeElement).toBe(focusTarget);

    focusTarget.remove();
  });

  it('removes the active marker for terminal and cold-history entries', () => {
    renderPanel([makeEntry('one', { toolEventType: 'TITLE' })], {
      status: 'COMPLETED',
      isLatest: false,
      isTerminal: true,
      executionDetailsPhase: 'settled',
      activeProcessEntryKey: 'one',
      processHistoryState: { status: 'AVAILABLE', envelopes: [] },
    });

    const row = screen.getByTestId('turn-process-entry');
    expect(row.hasAttribute('data-process-active')).toBe(false);
    expect(row.hasAttribute('aria-current')).toBe(false);
  });

  it('removes the active marker when later assistant output visually supersedes the step', () => {
    renderPanel([makeEntry('thinking', { title: '思考', kind: 'thinking', lastSequence: 2 })], {
      activeProcessEntryKey: 'thinking',
      latestAssistantAnswerPresentationOrder: 3,
      hasAnswerContent: true,
    });

    const row = screen.getByTestId('turn-process-entry');
    expect(row.hasAttribute('data-process-active')).toBe(false);
    expect(row.hasAttribute('aria-current')).toBe(false);
    expect(screen.getByTestId('turn-process-entry-title').style.fontWeight).toBe('');
    expect(screen.getByTestId('turn-process-entry-icon-node').style.background).toBe('transparent');
  });

  it('restores the active marker when the same step receives later process activity', () => {
    const view = renderPanel([makeEntry('thinking', { title: '思考', kind: 'thinking', lastSequence: 2 })], {
      activeProcessEntryKey: 'thinking',
      latestAssistantAnswerPresentationOrder: 3,
      hasAnswerContent: true,
    });

    view.rerender(
      React.createElement(
        ProcessPanel,
        makePanelProps([makeEntry('thinking', { title: '思考', kind: 'thinking', lastSequence: 4 })], {
          activeProcessEntryKey: 'thinking',
          latestAssistantAnswerPresentationOrder: 3,
          hasAnswerContent: true,
        }),
      ),
    );

    const row = screen.getByTestId('turn-process-entry');
    expect(row.getAttribute('data-process-active')).toBe('true');
    expect(row.getAttribute('aria-current')).toBe('step');
  });

  it('keeps the active icon node stable without breathing effects', () => {
    document.documentElement.setAttribute('data-theme', 'lightday');
    renderPanel([makeEntry('thinking', { title: '思考', kind: 'thinking' })]);

    const node = screen.getByTestId('turn-process-entry-icon-node');
    expect(node.classList.contains('turn-process-entry-icon-node--breathing')).toBe(false);
    expect(node.style.width).toBe('20px');
    expect(node.style.height).toBe('20px');
    expect(node.style.transform).toBe('');
  });

  it('keeps the icon node clean for dark and evening themes', () => {
    document.documentElement.setAttribute('data-theme', 'dark');
    const view = renderPanel([makeEntry('thinking', { title: '思考', kind: 'thinking' })]);

    const node = screen.getByTestId('turn-process-entry-icon-node');
    expect(node.classList.contains('turn-process-entry-icon-node--breathing')).toBe(false);

    document.documentElement.setAttribute('data-theme', 'evening');
    view.rerender(React.createElement(ProcessPanel, makePanelProps([makeEntry('thinking', { title: '思考', kind: 'thinking' })])));
    expect(screen.getByTestId('turn-process-entry-icon-node').classList.contains('turn-process-entry-icon-node--breathing')).toBe(false);
  });

  it('keeps the active affordance without breathing for reduced motion', () => {
    window.matchMedia = vi.fn().mockReturnValue({
      matches: true,
      media: '(prefers-reduced-motion: reduce)',
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    } satisfies MediaQueryList);

    renderPanel([makeEntry('thinking', { title: '思考', kind: 'thinking' })]);

    const row = screen.getByTestId('turn-process-entry');
    const node = screen.getByTestId('turn-process-entry-icon-node');
    expect(row.getAttribute('aria-current')).toBe('step');
    expect(node.classList.contains('turn-process-entry-icon-node--breathing')).toBe(false);
    expect(node.style.background).toBe('transparent');
  });
});

describe('ProcessPanel entry appearance feedback', () => {
  it('animates only a newly appended live entry once', async () => {
    const firstEntry = makeEntry('one');
    const secondEntry = makeEntry('two');
    const view = renderPanel([firstEntry], { displayRunId: 'run-one' });

    expect(screen.getByTestId('turn-process-entry').classList.contains('turn-process-entry--entering')).toBe(false);

    view.rerender(
      React.createElement(ProcessPanel, makePanelProps([firstEntry, secondEntry], { displayRunId: 'run-one', activeProcessEntryKey: 'two' })),
    );

    const enteringRow = screen.getAllByTestId('turn-process-entry')[1]!;
    expect(enteringRow.classList.contains('turn-process-entry--entering')).toBe(true);

    await waitFor(
      () => {
        expect(enteringRow.classList.contains('turn-process-entry--entering')).toBe(false);
      },
      { timeout: 500 },
    );

    const updatedSecondEntry = makeEntry('two', { lastSequence: 3 });
    view.rerender(
      React.createElement(ProcessPanel, makePanelProps([firstEntry, updatedSecondEntry], { displayRunId: 'run-one', activeProcessEntryKey: 'two' })),
    );
    expect(screen.getAllByTestId('turn-process-entry')[1]?.classList.contains('turn-process-entry--entering')).toBe(false);

    fireEvent.click(screen.getByTestId('turn-process-toggle'));
    fireEvent.click(screen.getByTestId('turn-process-toggle'));
    expect(screen.getAllByTestId('turn-process-entry')[1]?.classList.contains('turn-process-entry--entering')).toBe(false);
  });

  it('seeds a new run scope and completed history without replaying feedback', () => {
    const view = renderPanel([makeEntry('one')], {
      rootMessageId: 'root-one',
      displayRunId: 'run-one',
    });

    view.rerender(
      React.createElement(
        ProcessPanel,
        makePanelProps([makeEntry('two', { toolEventType: 'TITLE' })], {
          rootMessageId: 'root-two',
          displayRunId: 'run-two',
          status: 'COMPLETED',
          isLatest: false,
          isTerminal: true,
          executionDetailsPhase: 'settled',
          activeProcessEntryKey: 'two',
          processHistoryState: { status: 'AVAILABLE', envelopes: [] },
        }),
      ),
    );

    expect(screen.getByTestId('turn-process-entry').classList.contains('turn-process-entry--entering')).toBe(false);
  });

  it('shows new entries directly when reduced motion is preferred', () => {
    window.matchMedia = vi.fn().mockReturnValue({
      matches: true,
      media: '(prefers-reduced-motion: reduce)',
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    } satisfies MediaQueryList);

    const firstEntry = makeEntry('one');
    const view = renderPanel([firstEntry], { displayRunId: 'run-reduced' });
    view.rerender(
      React.createElement(
        ProcessPanel,
        makePanelProps([firstEntry, makeEntry('two')], { displayRunId: 'run-reduced', activeProcessEntryKey: 'two' }),
      ),
    );

    expect(screen.getAllByTestId('turn-process-entry')[1]?.classList.contains('turn-process-entry--entering')).toBe(false);
  });

  it('does not perform element-owned scrolling', () => {
    const originalScrollIntoView = Element.prototype.scrollIntoView;
    const scrollIntoView = vi.fn();
    Object.defineProperty(Element.prototype, 'scrollIntoView', {
      configurable: true,
      value: scrollIntoView,
    });

    try {
      const firstEntry = makeEntry('one');
      const view = renderPanel([firstEntry], { displayRunId: 'run-without-scroll-owner' });
      view.rerender(
        React.createElement(
          ProcessPanel,
          makePanelProps([firstEntry, makeEntry('two')], { displayRunId: 'run-without-scroll-owner', activeProcessEntryKey: 'two' }),
        ),
      );
      expect(scrollIntoView).not.toHaveBeenCalled();
    } finally {
      if (originalScrollIntoView === undefined) {
        delete (Element.prototype as { scrollIntoView?: Element['scrollIntoView'] }).scrollIntoView;
      } else {
        Object.defineProperty(Element.prototype, 'scrollIntoView', {
          configurable: true,
          value: originalScrollIntoView,
        });
      }
    }
  });
});

describe('ProcessPanel completed answer handoff', () => {
  it('keeps PIU process detail disclosure usable across automatic and manual collapse', async () => {
    const piu: PIU = {
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
    const autoLoad = vi.fn(async () => {});
    window.Prel = {
      ready: (callback) => callback(),
      autoLoad,
      start: vi.fn(),
    };
    const structuredSegments = [
      {
        kind: 'structured',
        toolMessageType: 'PIU',
        content: {
          piuName: 'network-diagnostic',
          piuVersion: '1.0.0',
          data: { status: 'running' },
        },
        sequence: 2,
      },
    ] as const;
    const runningEntry = makeEntry('piu-step', {
      structuredSegments,
    });
    const completedEntry = makeEntry('piu-step', {
      isFinal: true,
      structuredSegments,
    });
    const renderPiuPanel = (entry: ProcessEntry) =>
      React.createElement(
        PiuContext.Provider,
        { value: { piu, site: { locale: 'zh-cn', theme: 'lightday' } } },
        React.createElement(ProcessPanel, makePanelProps([entry], { displayRunId: 'piu-disclosure-run' })),
      );
    const view = render(renderPiuPanel(runningEntry));

    const toggle = screen.getByTestId('turn-process-entry-toggle');
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByTestId('structured-piu-message').closest('[aria-hidden]')?.getAttribute('aria-hidden')).toBe('false');
    await waitFor(() => {
      expect(autoLoad).toHaveBeenCalledWith('network-diagnostic', '1.0.0');
      expect(piu.emit).toHaveBeenCalled();
    });

    view.rerender(renderPiuPanel(completedEntry));

    // Successful tool entries auto-collapse after a short dwell delay, so wait for it.
    await waitFor(() => {
      expect(toggle.getAttribute('aria-expanded')).toBe('false');
    });
    const automaticallyCollapsedPiu = screen.queryByTestId('structured-piu-message');
    expect(automaticallyCollapsedPiu === null || automaticallyCollapsedPiu.closest('[aria-hidden]')?.getAttribute('aria-hidden') === 'true').toBe(
      true,
    );

    fireEvent.click(toggle);
    await waitFor(() => {
      expect(toggle.getAttribute('aria-expanded')).toBe('true');
      expect(screen.getByTestId('structured-piu-message').closest('[aria-hidden]')?.getAttribute('aria-hidden')).toBe('false');
    });

    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    const manuallyCollapsedPiu = screen.queryByTestId('structured-piu-message');
    expect(manuallyCollapsedPiu === null || manuallyCollapsedPiu.closest('[aria-hidden]')?.getAttribute('aria-hidden') === 'true').toBe(true);
  });

  it('collapses only the superseded step detail while keeping the running panel open', () => {
    const view = renderPanel([makeEntry('thinking', { lastSequence: 2 })], {
      displayRunId: 'running-output-handoff',
    });

    expect(screen.getByText('Detail thinking')).toBeTruthy();
    view.rerender(
      React.createElement(
        ProcessPanel,
        makePanelProps([makeEntry('thinking', { lastSequence: 2 })], {
          displayRunId: 'running-output-handoff',
          latestAssistantAnswerPresentationOrder: 3,
          hasAnswerContent: true,
        }),
      ),
    );

    expect(screen.getByTestId('turn-process-toggle').getAttribute('aria-expanded')).toBe('true');
    expect(screen.queryByText('Detail thinking')).toBeNull();

    view.rerender(
      React.createElement(
        ProcessPanel,
        makePanelProps([makeEntry('thinking', { lastSequence: 4 })], {
          displayRunId: 'running-output-handoff',
          latestAssistantAnswerPresentationOrder: 3,
          hasAnswerContent: true,
        }),
      ),
    );

    expect(screen.getByTestId('turn-process-toggle').getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByText('Detail thinking')).toBeTruthy();
  });

  it('does not collapse for assistant content while the turn is still executing', () => {
    renderPanel([makeEntry('thinking')], {
      displayRunId: 'running-answer',
      hasAnswerContent: true,
    });

    expect(screen.getByTestId('turn-process-toggle').getAttribute('aria-expanded')).toBe('true');
    expect(screen.queryByTestId('turn-process-panel')).not.toBeNull();
  });

  it('collapses in the same committed render when a followed turn completes with an answer', () => {
    const runningEntry = makeEntry('thinking');
    const completedEntry = makeEntry('thinking', { isFinal: true });
    const view = renderPanel([runningEntry], { displayRunId: 'answer-run' });

    view.rerender(
      React.createElement(
        ProcessPanel,
        makePanelProps([completedEntry], {
          displayRunId: 'answer-run',
          status: 'COMPLETED',
          isTerminal: true,
          executionDetailsPhase: 'settled',
          hasAnswerContent: true,
        }),
      ),
    );

    expect(screen.getByTestId('turn-process-toggle').getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByTestId('turn-process-panel')).toBeNull();
  });

  it('keeps an automatic completed handoff collapsed after the user leaves the bottom', async () => {
    const completedEntry = makeEntry('structured-step', {
      isFinal: true,
      toolEventType: 'TITLE',
    });
    const view = renderPanel([completedEntry], {
      displayRunId: 'latched-answer-run',
      status: 'COMPLETED',
      isTerminal: true,
      executionDetailsPhase: 'settled',
      hasAnswerContent: true,
      isViewportFollowingBottom: true,
    });

    expect(screen.queryByTestId('turn-process-panel')).toBeNull();
    await waitFor(() => {
      expect(screen.getByTestId('turn-process-toggle').getAttribute('aria-expanded')).toBe('false');
    });

    view.rerender(
      React.createElement(
        ProcessPanel,
        makePanelProps([completedEntry], {
          displayRunId: 'latched-answer-run',
          status: 'COMPLETED',
          isTerminal: true,
          executionDetailsPhase: 'settled',
          hasAnswerContent: true,
          isViewportFollowingBottom: false,
          readIsViewportFollowingBottom: () => false,
        }),
      ),
    );

    expect(screen.getByTestId('turn-process-toggle').getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByTestId('turn-process-panel')).toBeNull();
  });

  it('preserves the process layout when the user has left the bottom', () => {
    vi.useFakeTimers();
    const runningEntry = makeEntry('thinking');
    const completedEntry = makeEntry('thinking', { isFinal: true });
    const view = renderPanel([runningEntry], {
      displayRunId: 'reading-run',
    });

    view.rerender(
      React.createElement(
        ProcessPanel,
        makePanelProps([completedEntry], {
          displayRunId: 'reading-run',
          status: 'COMPLETED',
          isTerminal: true,
          isViewportFollowingBottom: false,
          readIsViewportFollowingBottom: () => false,
          executionDetailsPhase: 'settled',
          hasAnswerContent: true,
        }),
      ),
    );

    vi.advanceTimersByTime(500);
    expect(screen.getByTestId('turn-process-toggle').getAttribute('aria-expanded')).toBe('true');
    expect(screen.queryByTestId('turn-process-panel')).not.toBeNull();
  });

  it('preserves a user-expanded process panel when the turn completes', () => {
    const entry = makeEntry('thinking');
    const view = renderPanel([entry], { displayRunId: 'manual-run' });

    fireEvent.click(screen.getByTestId('turn-process-toggle'));
    fireEvent.click(screen.getByTestId('turn-process-toggle'));
    expect(screen.getByTestId('turn-process-toggle').getAttribute('aria-expanded')).toBe('true');

    view.rerender(
      React.createElement(
        ProcessPanel,
        makePanelProps([makeEntry('thinking', { isFinal: true })], {
          displayRunId: 'manual-run',
          status: 'COMPLETED',
          isTerminal: true,
          executionDetailsPhase: 'settled',
          hasAnswerContent: true,
        }),
      ),
    );

    expect(screen.getByTestId('turn-process-toggle').getAttribute('aria-expanded')).toBe('true');
    expect(screen.queryByTestId('turn-process-panel')).not.toBeNull();
  });

  it('keeps failure as an open directory and exposes pending-input detail', () => {
    const failed = renderPanel([makeEntry('failed-step')], {
      displayRunId: 'failed-run',
      status: 'FAILED',
      isTerminal: true,
      executionDetailsPhase: 'settled',
      hasAnswerContent: true,
    });
    expect(screen.queryByTestId('turn-process-panel')).not.toBeNull();
    expect(screen.getByTestId('turn-process-entry-title').textContent).toBe('Step failed-step');
    expect(screen.queryByText('Detail failed-step')).toBeNull();

    failed.unmount();
    renderPanel([makeEntry('other-running'), makeEntry('question')], {
      rootMessageId: 'pending-root',
      displayRunId: 'pending-run',
      pendingSupplementalInputEntryKeys: new Set(['question']),
    });
    expect(screen.queryByTestId('turn-process-panel')).not.toBeNull();
    expect(screen.getByText('Detail question')).toBeTruthy();
    expect(screen.queryByText('Detail other-running')).toBeNull();
  });

  it('keeps a completed answer process visible until supplemental input resolves', () => {
    const entry = makeEntry('question');
    const view = renderPanel([entry], {
      rootMessageId: 'pending-root',
      displayRunId: 'pending-run',
      status: 'COMPLETED',
      isTerminal: true,
      executionDetailsPhase: 'settled',
      hasAnswerContent: true,
      pendingSupplementalInputEntryKeys: new Set(['question']),
    });

    expect(screen.queryByTestId('turn-process-panel')).not.toBeNull();
    expect(screen.getByText('Detail question')).toBeTruthy();

    view.rerender(
      React.createElement(
        ProcessPanel,
        makePanelProps([makeEntry('question', { isFinal: true })], {
          rootMessageId: 'pending-root',
          displayRunId: 'pending-run',
          status: 'COMPLETED',
          isTerminal: true,
          executionDetailsPhase: 'settled',
          hasAnswerContent: true,
          pendingSupplementalInputEntryKeys: new Set(),
        }),
      ),
    );

    expect(screen.queryByTestId('turn-process-panel')).toBeNull();
  });

  it('preserves an explicit panel collapse when the run later fails', async () => {
    const entry = makeEntry('diagnostic-step');
    const view = renderPanel([entry], {
      displayRunId: 'manual-failure-run',
    });

    fireEvent.click(screen.getByTestId('turn-process-toggle'));
    expect(screen.getByTestId('turn-process-toggle').getAttribute('aria-expanded')).toBe('false');

    view.rerender(
      React.createElement(
        ProcessPanel,
        makePanelProps([makeEntry('diagnostic-step', { isFinal: true })], {
          displayRunId: 'manual-failure-run',
          status: 'FAILED',
          isTerminal: true,
          executionDetailsPhase: 'settled',
        }),
      ),
    );

    expect(screen.getByTestId('turn-process-toggle').getAttribute('aria-expanded')).toBe('false');
    await waitFor(
      () => {
        expect(screen.queryByTestId('turn-process-panel')).toBeNull();
      },
      { timeout: 500 },
    );
  });

  it('reopens a successful completed panel as a collapsed step directory', () => {
    const entries = [makeEntry('thinking', { isFinal: true }), makeEntry('tool', { isFinal: true })];
    renderPanel(entries, {
      displayRunId: 'completed-run',
      status: 'COMPLETED',
      isTerminal: true,
      executionDetailsPhase: 'settled',
      hasAnswerContent: true,
    });

    fireEvent.click(screen.getByTestId('turn-process-toggle'));

    expect(screen.getAllByTestId('turn-process-entry-title')).toHaveLength(2);
    expect(screen.getAllByTestId('turn-process-entry-toggle').every((toggle) => toggle.getAttribute('aria-expanded') === 'false')).toBe(true);
    expect(screen.queryByTestId('turn-process-entry-detail')).toBeNull();

    fireEvent.click(screen.getAllByTestId('turn-process-entry-toggle')[0]!);
    expect(screen.getByText('Detail thinking')).toBeTruthy();
  });

  it('renders an execution explanation as bridge content without an independent step', () => {
    const entries = [
      makeEntry('process-content:root:attempt:stage-note', {
        title: 'Execution update',
        detail: 'I will inspect the router configuration.',
        contentType: 'MARKDOWN',
        kind: 'process-explanation',
        isFinal: true,
        isExpandable: false,
      }),
      makeEntry('tool', { isFinal: true }),
    ];
    renderPanel(entries, {
      displayRunId: 'completed-execution-update',
      status: 'COMPLETED',
      isTerminal: true,
      executionDetailsPhase: 'settled',
      hasAnswerContent: true,
    });

    fireEvent.click(screen.getByTestId('turn-process-toggle'));

    expect(screen.getByText('I will inspect the router configuration.')).toBeTruthy();
    expect(screen.queryByText('接下来')).toBeNull();
    expect(screen.queryByTestId('turn-process-entry-static-title')).toBeNull();
    expect(screen.getAllByTestId('turn-process-entry-icon-node')).toHaveLength(1);
    expect(screen.getAllByTestId('turn-process-entry-toggle')).toHaveLength(1);
    expect(screen.getByText('I will inspect the router configuration.').closest('.markdown-content')?.getAttribute('style')).toContain(
      'font-size: 16px',
    );
  });

  it('does not carry manual panel mode into another display run under the same root', () => {
    const entry = makeEntry('thinking');
    const view = renderPanel([entry], { displayRunId: 'first-run' });

    fireEvent.click(screen.getByTestId('turn-process-toggle'));
    expect(screen.getByTestId('turn-process-toggle').getAttribute('aria-expanded')).toBe('false');

    view.rerender(
      React.createElement(
        ProcessPanel,
        makePanelProps([entry], {
          displayRunId: 'retry-run',
        }),
      ),
    );

    expect(screen.getByTestId('turn-process-toggle').getAttribute('aria-expanded')).toBe('true');
    expect(screen.queryByTestId('turn-process-panel')).not.toBeNull();
  });
});
