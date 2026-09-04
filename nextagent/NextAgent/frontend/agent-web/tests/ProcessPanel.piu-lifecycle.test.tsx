import { cleanup, fireEvent, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ProcessPanel, __resetProcessPanelTestState } from '../src/features/chat/components/ProcessPanel.tsx';
import { PiuContext } from '../src/features/chat/context/PiuContext.tsx';
import type { ProcessDisplayEntry, ProcessEntry } from '../src/features/chat/process/processDetails.ts';
import type { PIU } from '../src/host/prel.ts';
import type { TurnBlock } from '../src/state/contracts.ts';
import { renderWithAppProviders as render } from './renderWithAppProviders.tsx';

const block: TurnBlock = {
  rootMessageId: 'root-1',
  displayRunId: 'run-1',
  userMessage: {
    messageId: 'root-1',
    sessionId: 'session-1',
    content: 'diagnose access network',
    createdAt: '2026-08-02T00:00:00.000Z',
    visible: true,
  },
  aiEvents: [],
  status: 'EXECUTING',
  isLatest: true,
};

const piuContent = JSON.stringify({
  piuName: 'network-diagnostic-card',
  piuVersion: '1.0.0',
  method: 'render',
  data: { region: 'east' },
});

function processEntry(options: { readonly withPiu: boolean; readonly isFinal?: boolean; readonly content?: string }): ProcessEntry {
  return {
    key: 'diagnostic',
    title: '接入网诊断',
    summary: '正在诊断',
    detail: options.withPiu ? '' : '普通诊断详情',
    toolName: 'diagnostic-tool',
    kind: 'tool',
    isFinal: options.isFinal ?? false,
    isExpandable: true,
    sequence: 1,
    lastSequence: 1,
    lastPresentationOrder: 1,
    toolEventType: 'TITLE',
    ...(options.withPiu
      ? {
          structuredSegments: [
            {
              kind: 'structured' as const,
              toolMessageType: 'PIU' as const,
              content: options.content ?? piuContent,
              sequence: 1,
            },
          ],
        }
      : {}),
  };
}

function displayEntry(options: { readonly withPiu: boolean; readonly isFinal?: boolean; readonly content?: string }): ProcessDisplayEntry {
  const source = processEntry(options);
  return {
    key: source.key,
    title: source.title,
    summary: source.summary ?? '',
    detail: source.detail,
    kind: source.kind,
    isFinal: source.isFinal,
    isExpandable: true,
    lastSequence: source.lastSequence,
    lastPresentationOrder: source.lastPresentationOrder,
    toolEventType: source.toolEventType,
    structuredSegments: source.structuredSegments,
  };
}

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
    emit: vi.fn((_method: string, payload?: unknown) => {
      const containerId = (payload as { readonly containerId?: string } | undefined)?.containerId;
      const container = containerId ? document.getElementById(containerId) : null;
      if (!container) {
        return;
      }
      const input = document.createElement('input');
      input.setAttribute('data-testid', 'piu-interaction-state');
      container.replaceChildren(input);
    }),
  };
}

function panelElement(options: {
  readonly piu: PIU;
  readonly withPiu?: boolean;
  readonly executionDetailsPhase?: 'running' | 'settled';
  readonly displayRunId?: string;
  readonly content?: string;
}) {
  const withPiu = options.withPiu ?? true;
  const entryOptions = options.content === undefined ? { withPiu } : { withPiu, content: options.content };
  const entry = processEntry(entryOptions);
  const projected = displayEntry(entryOptions);
  const displayRunId = options.displayRunId ?? 'run-1';
  return (
    <PiuContext.Provider value={{ piu: options.piu, site: { locale: 'zh-cn', theme: 'lightday' } }}>
      <ProcessPanel
        block={{ ...block, displayRunId }}
        rootMessageId="root-1"
        displayRunId={displayRunId}
        status="EXECUTING"
        isLatest
        isTerminal={false}
        isViewportFollowingBottom
        executionDetailsPhase={options.executionDetailsPhase ?? 'running'}
        processEntries={[entry]}
        processDisplayEntries={[projected]}
        processSummary="执行详情"
        activeProcessEntryKey="diagnostic"
        shouldShowProcessIdleSweep={false}
        showProcessSummary
        showProcessTimelineAction={false}
        hasAnswerContent={false}
        latestAssistantAnswerPresentationOrder={null}
        pendingSupplementalInputEntryKeys={new Set()}
      />
    </PiuContext.Provider>
  );
}

function renderPanel(options: Parameters<typeof panelElement>[0]) {
  return render(panelElement(options));
}

async function waitForPiuEmit(piu: PIU): Promise<void> {
  await vi.waitFor(() => expect(piu.emit).toHaveBeenCalled());
}

async function waitForDisclosureTransition(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 250));
}

describe('ProcessPanel PIU detail lifecycle', () => {
  beforeEach(() => {
    __resetProcessPanelTestState();
    window.Prel = {
      ready: (callback: () => void) => callback(),
      autoLoad: vi.fn(async () => {}),
      start: vi.fn(),
    } as unknown as typeof window.Prel;
  });

  afterEach(() => {
    cleanup();
    __resetProcessPanelTestState();
    delete window.Prel;
    vi.restoreAllMocks();
  });

  it('renders structured task progress before the ordinary command result inside one capability disclosure', () => {
    const section = {
      key: 'bash-progress',
      title: '任务进展',
      detail: '查数已接收到任务\n开始识别分析查询对象',
      rawDetail: '查数已接收到任务\n开始识别分析查询对象',
      contentType: 'PLAIN_TEXT' as const,
      sequence: 28,
      lastSequence: 30,
      lastPresentationOrder: 30,
      toolEventType: 'SUB_TITLE',
    };
    const source: ProcessEntry = {
      key: 'bash-call',
      title: '执行命令 · 已失败',
      summary: '命令执行失败',
      detail: 'ordinary command result',
      rawDetail: 'ordinary command result',
      contentType: 'PLAIN_TEXT',
      toolName: 'Bash',
      toolCallId: 'bash-call',
      kind: 'tool',
      isFinal: true,
      isExpandable: true,
      isFailure: true,
      sequence: 25,
      lastSequence: 31,
      lastPresentationOrder: 31,
      structuredSections: [section],
    };
    const projected: ProcessDisplayEntry = {
      key: source.key,
      title: source.title,
      summary: source.summary ?? '',
      detail: source.detail,
      contentType: source.contentType,
      toolName: source.toolName,
      toolCallId: source.toolCallId,
      kind: source.kind,
      isFinal: source.isFinal,
      isExpandable: true,
      isFailure: source.isFailure,
      lastSequence: source.lastSequence,
      lastPresentationOrder: source.lastPresentationOrder,
      structuredSections: [section],
    };

    render(
      <ProcessPanel
        block={block}
        rootMessageId="root-1"
        displayRunId="run-1"
        status="EXECUTING"
        isLatest
        isTerminal={false}
        isViewportFollowingBottom
        executionDetailsPhase="running"
        processEntries={[source]}
        processDisplayEntries={[projected]}
        processSummary="执行详情"
        activeProcessEntryKey="bash-call"
        shouldShowProcessIdleSweep={false}
        showProcessSummary
        showProcessTimelineAction={false}
        hasAnswerContent={false}
        latestAssistantAnswerPresentationOrder={null}
        pendingSupplementalInputEntryKeys={new Set()}
      />,
    );

    const detail = screen.getByTestId('turn-process-entry-detail');
    const structuredSection = screen.getByTestId('turn-process-structured-section');
    const sectionIcon = screen.getByTestId('turn-process-structured-section-icon');
    expect(structuredSection.getAttribute('data-structured-level')).toBe('sub');
    expect(sectionIcon.getAttribute('src')).toContain('circle-light');
    expect(detail.textContent).toContain('任务进展');
    expect(detail.textContent).toContain('ordinary command result');
    expect(detail.textContent?.indexOf('任务进展')).toBeLessThan(detail.textContent?.indexOf('ordinary command result') ?? -1);
    expect(screen.getByTestId('turn-process-panel').textContent?.indexOf('ordinary command result')).toBeLessThan(
      screen.getByTestId('turn-process-panel').textContent?.indexOf('命令执行失败') ?? -1,
    );
    expect(screen.getAllByTestId('turn-process-entry-title')).toHaveLength(1);
  });

  it('keeps the PIU node and interaction state across entry collapse and reopen', async () => {
    const piu = createMockPiu();
    renderPanel({ piu });
    await waitForPiuEmit(piu);
    const piuNode = screen.getByTestId('structured-piu-message');
    const input = screen.getByTestId('piu-interaction-state') as HTMLInputElement;
    input.value = 'selected-router-42';

    fireEvent.click(screen.getByTestId('turn-process-entry-toggle'));
    await waitForDisclosureTransition();

    expect(screen.getByTestId('structured-piu-message')).toBe(piuNode);
    expect(screen.getByTestId('piu-interaction-state')).toBe(input);
    expect(input.value).toBe('selected-router-42');
    // The detail is wrapped in a disclosure-content div inside the grid disclosure container.
    const detailDisclosure = screen.getByTestId('turn-process-entry-detail').parentElement?.parentElement;
    expect(detailDisclosure?.getAttribute('aria-hidden')).toBe('true');
    expect(detailDisclosure?.hasAttribute('inert')).toBe(true);

    fireEvent.click(screen.getByTestId('turn-process-entry-toggle'));
    expect(screen.getByTestId('structured-piu-message')).toBe(piuNode);
    expect(window.Prel?.autoLoad).toHaveBeenCalledTimes(1);
    expect(piu.emit).toHaveBeenCalledTimes(1);
  });

  it('keeps the PIU node and interaction state across whole-panel collapse and reopen', async () => {
    const piu = createMockPiu();
    renderPanel({ piu });
    await waitForPiuEmit(piu);
    const piuNode = screen.getByTestId('structured-piu-message');
    const input = screen.getByTestId('piu-interaction-state') as HTMLInputElement;
    input.value = 'page-3';

    fireEvent.click(screen.getByTestId('turn-process-toggle'));
    await waitForDisclosureTransition();

    expect(screen.getByTestId('structured-piu-message')).toBe(piuNode);
    expect(input.value).toBe('page-3');
    const panelDisclosure = screen.getByTestId('turn-process-panel').parentElement;
    expect(panelDisclosure?.getAttribute('aria-hidden')).toBe('true');
    expect(panelDisclosure?.hasAttribute('inert')).toBe(true);

    fireEvent.click(screen.getByTestId('turn-process-toggle'));
    expect(screen.getByTestId('structured-piu-message')).toBe(piuNode);
    expect(window.Prel?.autoLoad).toHaveBeenCalledTimes(1);
    expect(piu.emit).toHaveBeenCalledTimes(1);
  });

  it('does not preload a PIU detail that has never been expanded', async () => {
    const piu = createMockPiu();
    const entry = processEntry({ withPiu: true, isFinal: true });
    const projected = displayEntry({ withPiu: true, isFinal: true });
    render(
      <PiuContext.Provider value={{ piu, site: { locale: 'zh-cn', theme: 'lightday' } }}>
        <ProcessPanel
          block={block}
          rootMessageId="root-1"
          displayRunId="run-1"
          status="COMPLETED"
          isLatest
          isTerminal
          isViewportFollowingBottom
          executionDetailsPhase="settled"
          processEntries={[{ ...entry, toolEventType: null }]}
          processDisplayEntries={[{ ...projected, toolEventType: null }]}
          processSummary="执行详情"
          activeProcessEntryKey={null}
          shouldShowProcessIdleSweep={false}
          showProcessSummary
          showProcessTimelineAction={false}
          hasAnswerContent={false}
          latestAssistantAnswerPresentationOrder={null}
          pendingSupplementalInputEntryKeys={new Set()}
        />
      </PiuContext.Provider>,
    );

    await Promise.resolve();
    expect(screen.queryByTestId('structured-piu-message')).toBeNull();
    expect(window.Prel?.autoLoad).not.toHaveBeenCalled();
    expect(piu.emit).not.toHaveBeenCalled();
  });

  it('continues to unmount a non-PIU detail after collapse', async () => {
    const piu = createMockPiu();
    renderPanel({ piu, withPiu: false });
    expect(screen.getByTestId('turn-process-entry-detail')).toBeTruthy();

    fireEvent.click(screen.getByTestId('turn-process-entry-toggle'));
    await waitForDisclosureTransition();

    expect(screen.queryByTestId('turn-process-entry-detail')).toBeNull();
  });

  it('releases the old PIU owner when the run scope changes with the same entry key', async () => {
    const piu = createMockPiu();
    const rendered = renderPanel({ piu, displayRunId: 'run-1' });
    await waitForPiuEmit(piu);
    const previousNode = screen.getByTestId('structured-piu-message');
    previousNode.appendChild(document.createElement('span'));

    rendered.rerender(
      panelElement({
        piu,
        displayRunId: 'run-2',
        content: JSON.stringify({
          piuName: 'network-diagnostic-card',
          piuVersion: '1.0.0',
          method: 'render',
          data: { region: 'west' },
        }),
      }),
    );

    await vi.waitFor(() => {
      expect(screen.getByTestId('structured-piu-message')).not.toBe(previousNode);
    });
    expect(previousNode.children).toHaveLength(0);
  });
});
