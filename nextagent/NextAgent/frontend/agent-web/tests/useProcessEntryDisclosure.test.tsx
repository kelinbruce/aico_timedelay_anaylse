import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useProcessEntryDisclosure } from '../src/features/chat/hooks/useProcessEntryDisclosure.ts';
import type { ProcessDisplayEntry } from '../src/features/chat/process/processDetails.ts';

function entry(key: string, isFinal: boolean): ProcessDisplayEntry {
  return {
    key,
    title: key,
    summary: key,
    detail: `${key} detail`,
    contentType: 'PLAIN_TEXT',
    kind: 'thinking',
    isFinal,
    isExpandable: true,
    lastSequence: 1,
    lastPresentationOrder: 1,
  };
}

function entryWithSequence(key: string, isFinal: boolean, lastSequence: number): ProcessDisplayEntry {
  return {
    ...entry(key, isFinal),
    lastSequence,
    lastPresentationOrder: lastSequence,
  };
}

function toolEntry(key: string, isFinal: boolean): ProcessDisplayEntry {
  return { ...entry(key, isFinal), kind: 'tool' };
}

describe('useProcessEntryDisclosure', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    });
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
  });

  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('keeps a successful entry open for 800 ms before collapsing it', () => {
    const { result, rerender } = renderHook(
      (props: { entries: readonly ProcessDisplayEntry[]; reduced: boolean }) =>
        useProcessEntryDisclosure({
          rootMessageId: 'root-1',
          displayRunId: 'run-1',
          executionDetailsPhase: 'running',
          processDisplayEntries: props.entries,
          latestAssistantAnswerPresentationOrder: null,
          panelIsOpen: true,
          prefersReducedMotion: props.reduced,
        }),
      { initialProps: { entries: [toolEntry('thinking', false)], reduced: false } },
    );

    expect(result.current.expandedKeys.has('thinking')).toBe(true);
    rerender({ entries: [toolEntry('thinking', true)], reduced: false });
    expect(result.current.expandedKeys.has('thinking')).toBe(true);
    act(() => vi.advanceTimersByTime(799));
    expect(result.current.expandedKeys.has('thinking')).toBe(true);
    act(() => vi.advanceTimersByTime(1));
    expect(result.current.expandedKeys.has('thinking')).toBe(false);
    expect(result.current.renderedKeys.has('thinking')).toBe(true);
    act(() => vi.advanceTimersByTime(200));
    expect(result.current.renderedKeys.has('thinking')).toBe(false);
  });

  it('keeps a failed terminal entry automatically expanded', () => {
    const failedEntry = { ...toolEntry('bash', true), isFailure: true };
    const { result } = renderHook(() =>
      useProcessEntryDisclosure({
        rootMessageId: 'root-1',
        displayRunId: 'run-1',
        executionDetailsPhase: 'settled',
        processDisplayEntries: [failedEntry],
        latestAssistantAnswerPresentationOrder: null,
        panelIsOpen: true,
        prefersReducedMotion: false,
      }),
    );

    act(() => vi.advanceTimersByTime(1000));
    expect(result.current.expandedKeys.has('bash')).toBe(true);
  });

  it('keeps a manually collapsed entry collapsed after it completes', () => {
    const { result, rerender } = renderHook(
      (entries: readonly ProcessDisplayEntry[]) =>
        useProcessEntryDisclosure({
          rootMessageId: 'root-1',
          displayRunId: 'run-1',
          executionDetailsPhase: 'running',
          processDisplayEntries: entries,
          latestAssistantAnswerPresentationOrder: null,
          panelIsOpen: true,
          prefersReducedMotion: false,
        }),
      { initialProps: [entry('thinking', false)] },
    );

    act(() => result.current.toggleEntry('thinking'));
    rerender([entry('thinking', true)]);

    expect(result.current.expandedKeys.has('thinking')).toBe(false);
  });

  it('keeps a manually expanded completed entry expanded for the current scope', () => {
    const { result, rerender } = renderHook(
      (entries: readonly ProcessDisplayEntry[]) =>
        useProcessEntryDisclosure({
          rootMessageId: 'root-1',
          displayRunId: 'run-1',
          executionDetailsPhase: 'running',
          processDisplayEntries: entries,
          latestAssistantAnswerPresentationOrder: null,
          panelIsOpen: true,
          prefersReducedMotion: false,
        }),
      { initialProps: [entry('thinking', false)] },
    );

    rerender([entry('thinking', true)]);
    act(() => result.current.toggleEntry('thinking'));

    expect(result.current.expandedKeys.has('thinking')).toBe(true);
    expect(result.current.hasManualExpandedEntry).toBe(true);
  });

  it('resets manual state when the display run changes', () => {
    const { result, rerender } = renderHook(
      (props: { run: string }) =>
        useProcessEntryDisclosure({
          rootMessageId: 'root-1',
          displayRunId: props.run,
          executionDetailsPhase: 'running',
          processDisplayEntries: [entry('thinking', false)],
          latestAssistantAnswerPresentationOrder: null,
          panelIsOpen: true,
          prefersReducedMotion: false,
        }),
      { initialProps: { run: 'run-1' } },
    );

    act(() => result.current.toggleEntry('thinking'));
    expect(result.current.expandedKeys.has('thinking')).toBe(false);

    rerender({ run: 'run-2' });
    expect(result.current.expandedKeys.has('thinking')).toBe(true);
  });

  it('resets manual state when the root changes', () => {
    const { result, rerender } = renderHook(
      (rootMessageId: string) =>
        useProcessEntryDisclosure({
          rootMessageId,
          displayRunId: 'run-1',
          executionDetailsPhase: 'running',
          processDisplayEntries: [entry('thinking', false)],
          latestAssistantAnswerPresentationOrder: null,
          panelIsOpen: true,
          prefersReducedMotion: false,
        }),
      { initialProps: 'root-1' },
    );

    act(() => result.current.toggleEntry('thinking'));
    expect(result.current.expandedKeys.has('thinking')).toBe(false);

    rerender('root-2');
    expect(result.current.expandedKeys.has('thinking')).toBe(true);
  });

  it('uses the same success visibility delay with reduced motion', () => {
    const { result, rerender } = renderHook(
      (entries: readonly ProcessDisplayEntry[]) =>
        useProcessEntryDisclosure({
          rootMessageId: 'root-1',
          displayRunId: 'run-1',
          executionDetailsPhase: 'running',
          processDisplayEntries: entries,
          latestAssistantAnswerPresentationOrder: null,
          panelIsOpen: true,
          prefersReducedMotion: true,
        }),
      { initialProps: [toolEntry('thinking', false)] },
    );

    rerender([toolEntry('thinking', true)]);
    expect(result.current.expandedKeys.has('thinking')).toBe(true);
    act(() => vi.advanceTimersByTime(800));
    expect(result.current.expandedKeys.has('thinking')).toBe(false);
    expect(result.current.renderedKeys.has('thinking')).toBe(false);
  });

  it('keeps an already rendered persistent detail mounted after automatic collapse', () => {
    const persistentDetailKeys = new Set(['piu']);
    const { result, rerender } = renderHook(
      (entries: readonly ProcessDisplayEntry[]) =>
        useProcessEntryDisclosure({
          rootMessageId: 'root-1',
          displayRunId: 'run-1',
          executionDetailsPhase: 'running',
          processDisplayEntries: entries,
          latestAssistantAnswerPresentationOrder: null,
          panelIsOpen: true,
          prefersReducedMotion: false,
          persistentDetailKeys,
        }),
      { initialProps: [entry('piu', false)] },
    );

    expect(result.current.renderedKeys.has('piu')).toBe(true);
    rerender([entry('piu', true)]);

    expect(result.current.expandedKeys.has('piu')).toBe(false);
    expect(result.current.visibleKeys.has('piu')).toBe(false);
    expect(result.current.renderedKeys.has('piu')).toBe(true);
  });

  it('keeps a persistent detail mounted after reduced-motion manual collapse', () => {
    const persistentDetailKeys = new Set(['piu']);
    const { result } = renderHook(() =>
      useProcessEntryDisclosure({
        rootMessageId: 'root-1',
        displayRunId: 'run-1',
        executionDetailsPhase: 'running',
        processDisplayEntries: [entry('piu', false)],
        latestAssistantAnswerPresentationOrder: null,
        panelIsOpen: true,
        prefersReducedMotion: true,
        persistentDetailKeys,
      }),
    );

    act(() => result.current.toggleEntry('piu'));

    expect(result.current.expandedKeys.has('piu')).toBe(false);
    expect(result.current.visibleKeys.has('piu')).toBe(false);
    expect(result.current.renderedKeys.has('piu')).toBe(true);
  });

  it('does not mount a persistent detail before it is expanded', () => {
    const { result } = renderHook(() =>
      useProcessEntryDisclosure({
        rootMessageId: 'root-1',
        displayRunId: 'run-1',
        executionDetailsPhase: 'settled',
        processDisplayEntries: [entry('piu', true)],
        latestAssistantAnswerPresentationOrder: null,
        panelIsOpen: false,
        prefersReducedMotion: false,
        persistentDetailKeys: new Set(['piu']),
      }),
    );

    expect(result.current.renderedKeys.has('piu')).toBe(false);
  });

  it('removes a persistent detail when its owner entry leaves the projection', () => {
    const persistentDetailKeys = new Set(['piu']);
    const { result, rerender } = renderHook(
      (entries: readonly ProcessDisplayEntry[]) =>
        useProcessEntryDisclosure({
          rootMessageId: 'root-1',
          displayRunId: 'run-1',
          executionDetailsPhase: 'running',
          processDisplayEntries: entries,
          latestAssistantAnswerPresentationOrder: null,
          panelIsOpen: true,
          prefersReducedMotion: false,
          persistentDetailKeys,
        }),
      { initialProps: [entry('piu', false)] },
    );

    expect(result.current.renderedKeys.has('piu')).toBe(true);
    rerender([]);

    expect(result.current.renderedKeys.has('piu')).toBe(false);
  });

  it('reopens a completed panel as a collapsed directory', () => {
    const { result, rerender } = renderHook(
      (panelIsOpen: boolean) =>
        useProcessEntryDisclosure({
          rootMessageId: 'root-1',
          displayRunId: 'run-1',
          executionDetailsPhase: 'settled',
          processDisplayEntries: [entry('thinking', true), entry('tool', true)],
          latestAssistantAnswerPresentationOrder: null,
          panelIsOpen,
          prefersReducedMotion: false,
        }),
      { initialProps: false },
    );

    rerender(true);
    expect([...result.current.expandedKeys]).toEqual([]);
    expect([...result.current.renderedKeys]).toEqual([]);
  });

  it('retains manual expansion when the completed panel is closed and reopened in the same scope', () => {
    const { result, rerender } = renderHook(
      (panelIsOpen: boolean) =>
        useProcessEntryDisclosure({
          rootMessageId: 'root-1',
          displayRunId: 'run-1',
          executionDetailsPhase: 'settled',
          processDisplayEntries: [entry('thinking', true), entry('tool', true)],
          latestAssistantAnswerPresentationOrder: null,
          panelIsOpen,
          prefersReducedMotion: false,
        }),
      { initialProps: true },
    );

    act(() => result.current.toggleEntry('thinking'));
    expect([...result.current.expandedKeys]).toEqual(['thinking']);

    rerender(false);
    rerender(true);

    expect([...result.current.expandedKeys]).toEqual(['thinking']);
    expect(result.current.hasManualExpandedEntry).toBe(true);
  });

  it('reveals only matching supplemental details without overriding an explicit manual collapse', () => {
    const { result, rerender } = renderHook(
      (revealAutomaticDetailKeys: ReadonlySet<string>) =>
        useProcessEntryDisclosure({
          rootMessageId: 'root-1',
          displayRunId: 'run-1',
          executionDetailsPhase: 'settled',
          processDisplayEntries: [
            entry('thinking', true),
            entry('completed-tool', true),
            entry('other-running', false),
            entry('pending-input:root-1:run-1:question-1', false),
          ],
          latestAssistantAnswerPresentationOrder: null,
          panelIsOpen: true,
          prefersReducedMotion: false,
          revealAutomaticDetailKeys,
        }),
      { initialProps: new Set<string>() },
    );

    act(() => result.current.toggleEntry('thinking'));
    act(() => result.current.toggleEntry('thinking'));
    expect([...result.current.expandedKeys]).toEqual([]);

    rerender(new Set(['pending-input:root-1:run-1:question-1']));

    expect([...result.current.expandedKeys]).toEqual(['pending-input:root-1:run-1:question-1']);
  });

  it('uses explicit entry finality rather than display wording', () => {
    const misleadingRunningEntry = {
      ...entry('waiting', false),
      title: '已完成',
      summary: '已失败',
    };
    const { result, rerender } = renderHook(
      (entries: readonly ProcessDisplayEntry[]) =>
        useProcessEntryDisclosure({
          rootMessageId: 'root-1',
          displayRunId: 'run-1',
          executionDetailsPhase: 'settling',
          processDisplayEntries: entries,
          latestAssistantAnswerPresentationOrder: null,
          panelIsOpen: true,
          prefersReducedMotion: false,
        }),
      { initialProps: [misleadingRunningEntry] },
    );

    expect(result.current.expandedKeys.has('waiting')).toBe(true);
    rerender([{ ...misleadingRunningEntry, title: '等待输入', isFinal: true }]);
    expect(result.current.expandedKeys.has('waiting')).toBe(false);
  });

  it('cleans pending timers and frames on unmount', () => {
    const { result, unmount } = renderHook(
      (entries: readonly ProcessDisplayEntry[]) =>
        useProcessEntryDisclosure({
          rootMessageId: 'root-1',
          displayRunId: 'run-1',
          executionDetailsPhase: 'running',
          processDisplayEntries: entries,
          latestAssistantAnswerPresentationOrder: null,
          panelIsOpen: true,
          prefersReducedMotion: false,
        }),
      { initialProps: [entry('thinking', false)] },
    );
    act(() => result.current.toggleEntry('thinking'));
    expect(vi.getTimerCount()).toBeGreaterThan(0);

    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('collapses an automatically open entry when later assistant text appears', () => {
    const { result, rerender } = renderHook(
      (props: { entries: readonly ProcessDisplayEntry[]; latestAssistantAnswerPresentationOrder: number | null }) =>
        useProcessEntryDisclosure({
          rootMessageId: 'root-1',
          displayRunId: 'run-1',
          executionDetailsPhase: 'running',
          processDisplayEntries: props.entries,
          latestAssistantAnswerPresentationOrder: props.latestAssistantAnswerPresentationOrder,
          panelIsOpen: true,
          prefersReducedMotion: false,
        }),
      {
        initialProps: {
          entries: [entryWithSequence('thinking', false, 2)],
          latestAssistantAnswerPresentationOrder: null as number | null,
        },
      },
    );

    expect(result.current.expandedKeys.has('thinking')).toBe(true);
    rerender({
      entries: [entryWithSequence('thinking', false, 2)],
      latestAssistantAnswerPresentationOrder: 3,
    });
    expect(result.current.expandedKeys.has('thinking')).toBe(false);
  });

  it('collapses by composed presentation order when timeline and history sequences are unrelated', () => {
    const { result, rerender } = renderHook(
      (latestAssistantAnswerPresentationOrder: number | null) =>
        useProcessEntryDisclosure({
          rootMessageId: 'root-1',
          displayRunId: 'run-1',
          executionDetailsPhase: 'running',
          processDisplayEntries: [
            {
              ...entryWithSequence('thinking', false, 10),
              lastPresentationOrder: 0,
            },
          ],
          latestAssistantAnswerPresentationOrder,
          panelIsOpen: true,
          prefersReducedMotion: false,
        }),
      { initialProps: null as number | null },
    );

    expect(result.current.expandedKeys.has('thinking')).toBe(true);
    rerender(1);
    expect(result.current.expandedKeys.has('thinking')).toBe(false);
  });

  it('restores automatic disclosure when the same entry receives later activity', () => {
    const { result, rerender } = renderHook(
      (props: { entrySequence: number; latestAssistantAnswerPresentationOrder: number | null }) =>
        useProcessEntryDisclosure({
          rootMessageId: 'root-1',
          displayRunId: 'run-1',
          executionDetailsPhase: 'running',
          processDisplayEntries: [entryWithSequence('thinking', false, props.entrySequence)],
          latestAssistantAnswerPresentationOrder: props.latestAssistantAnswerPresentationOrder,
          panelIsOpen: true,
          prefersReducedMotion: false,
        }),
      {
        initialProps: { entrySequence: 2, latestAssistantAnswerPresentationOrder: 3 },
      },
    );

    expect(result.current.expandedKeys.has('thinking')).toBe(false);
    rerender({ entrySequence: 4, latestAssistantAnswerPresentationOrder: 3 });
    expect(result.current.expandedKeys.has('thinking')).toBe(true);
  });

  it('keeps a manually expanded entry open across later assistant output', () => {
    const { result, rerender } = renderHook(
      (latestAssistantAnswerPresentationOrder: number | null) =>
        useProcessEntryDisclosure({
          rootMessageId: 'root-1',
          displayRunId: 'run-1',
          executionDetailsPhase: 'running',
          processDisplayEntries: [entryWithSequence('thinking', false, 2)],
          latestAssistantAnswerPresentationOrder,
          panelIsOpen: true,
          prefersReducedMotion: false,
        }),
      { initialProps: 3 },
    );

    expect(result.current.expandedKeys.has('thinking')).toBe(false);
    act(() => result.current.toggleEntry('thinking'));
    rerender(4);
    expect(result.current.expandedKeys.has('thinking')).toBe(true);
  });

  it('keeps an older pending question automatically revealed', () => {
    const pendingKey = 'pending-input:root-1:run-1:question-1';
    const { result } = renderHook(() =>
      useProcessEntryDisclosure({
        rootMessageId: 'root-1',
        displayRunId: 'run-1',
        executionDetailsPhase: 'running',
        processDisplayEntries: [entryWithSequence(pendingKey, false, 2)],
        latestAssistantAnswerPresentationOrder: 3,
        panelIsOpen: true,
        prefersReducedMotion: false,
        revealAutomaticDetailKeys: new Set([pendingKey]),
      }),
    );

    expect(result.current.expandedKeys.has(pendingKey)).toBe(true);
  });

  it('opens a later process entry while keeping the superseded entry collapsed', () => {
    const { result, rerender } = renderHook(
      (entries: readonly ProcessDisplayEntry[]) =>
        useProcessEntryDisclosure({
          rootMessageId: 'root-1',
          displayRunId: 'run-1',
          executionDetailsPhase: 'running',
          processDisplayEntries: entries,
          latestAssistantAnswerPresentationOrder: 3,
          panelIsOpen: true,
          prefersReducedMotion: false,
        }),
      {
        initialProps: [entryWithSequence('thinking', false, 2)],
      },
    );

    expect(result.current.expandedKeys.has('thinking')).toBe(false);
    rerender([entryWithSequence('thinking', false, 2), entryWithSequence('tool', false, 4)]);
    expect(result.current.expandedKeys.has('thinking')).toBe(false);
    expect(result.current.expandedKeys.has('tool')).toBe(true);
  });
});
