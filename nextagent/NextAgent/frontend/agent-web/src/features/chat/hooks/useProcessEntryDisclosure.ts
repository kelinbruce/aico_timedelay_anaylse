import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { isProcessEntryVisuallySuperseded, type ExecutionDetailsPhase, type ProcessDisplayEntry } from '../process/processDetails.ts';

const ENTRY_TRANSITION_MS = 200;
const SUCCESS_COLLAPSE_DELAY_MS = 800;

export interface ProcessEntryDisclosureState {
  readonly expandedKeys: ReadonlySet<string>;
  readonly renderedKeys: ReadonlySet<string>;
  readonly visibleKeys: ReadonlySet<string>;
  readonly hasManualExpandedEntry: boolean;
  readonly toggleEntry: (key: string) => void;
}

function withoutKey(current: ReadonlySet<string>, key: string): ReadonlySet<string> {
  if (!current.has(key)) {
    return current;
  }
  const next = new Set(current);
  next.delete(key);
  return next;
}

function withKey(current: ReadonlySet<string>, key: string): ReadonlySet<string> {
  if (current.has(key)) {
    return current;
  }
  const next = new Set(current);
  next.add(key);
  return next;
}

function retainValidKeys(current: ReadonlySet<string>, validKeys: ReadonlySet<string>): ReadonlySet<string> {
  if ([...current].every((key) => validKeys.has(key))) {
    return current;
  }
  return new Set([...current].filter((key) => validKeys.has(key)));
}

function shouldAutomaticallyOpenEntry(
  entry: ProcessDisplayEntry,
  executionDetailsPhase: ExecutionDetailsPhase,
  latestAssistantAnswerPresentationOrder: number | null,
  revealAutomaticDetailKeys?: ReadonlySet<string>,
): boolean {
  if (entry.isFailure) {
    return true;
  }
  if (entry.isFinal) {
    return false;
  }
  if (revealAutomaticDetailKeys !== undefined && revealAutomaticDetailKeys.size > 0) {
    return revealAutomaticDetailKeys.has(entry.key);
  }
  if (executionDetailsPhase === 'settled') {
    return false;
  }
  return !isProcessEntryVisuallySuperseded(entry, latestAssistantAnswerPresentationOrder);
}

export function useProcessEntryDisclosure(options: {
  readonly rootMessageId: string;
  readonly displayRunId?: string | undefined;
  readonly executionDetailsPhase: ExecutionDetailsPhase;
  readonly processDisplayEntries: readonly ProcessDisplayEntry[];
  readonly latestAssistantAnswerPresentationOrder: number | null;
  readonly panelIsOpen: boolean;
  readonly prefersReducedMotion: boolean;
  readonly revealAutomaticDetailKeys?: ReadonlySet<string> | undefined;
  readonly persistentDetailKeys?: ReadonlySet<string> | undefined;
}): ProcessEntryDisclosureState {
  const [expandedKeys, setExpandedKeys] = useState<ReadonlySet<string>>(() => new Set());
  const [renderedKeys, setRenderedKeys] = useState<ReadonlySet<string>>(() => new Set());
  const [visibleKeys, setVisibleKeys] = useState<ReadonlySet<string>>(() => new Set());
  const previousAutomaticOpenByKeyRef = useRef<Map<string, boolean>>(new Map());
  const previousPanelIsOpenRef = useRef(false);
  const manualExpansionByKeyRef = useRef<Map<string, boolean>>(new Map());
  const renderRemovalTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const successCollapseTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const openFramesRef = useRef<Map<string, number>>(new Map());
  const disclosureScopeKey = options.displayRunId ? `${options.rootMessageId}:${options.displayRunId}` : options.rootMessageId;

  const cancelKeyAutomation = useCallback((key: string) => {
    const successTimer = successCollapseTimersRef.current.get(key);
    if (successTimer !== undefined) {
      clearTimeout(successTimer);
      successCollapseTimersRef.current.delete(key);
    }
    const removalTimer = renderRemovalTimersRef.current.get(key);
    if (removalTimer !== undefined) {
      clearTimeout(removalTimer);
      renderRemovalTimersRef.current.delete(key);
    }
    const openFrame = openFramesRef.current.get(key);
    if (openFrame !== undefined) {
      cancelAnimationFrame(openFrame);
      openFramesRef.current.delete(key);
    }
  }, []);

  const collapseKey = useCallback(
    (key: string, immediate: boolean) => {
      const openFrame = openFramesRef.current.get(key);
      if (openFrame !== undefined) {
        cancelAnimationFrame(openFrame);
        openFramesRef.current.delete(key);
      }
      setExpandedKeys((current) => withoutKey(current, key));
      setVisibleKeys((current) => withoutKey(current, key));
      if (options.persistentDetailKeys?.has(key) === true) {
        const removalTimer = renderRemovalTimersRef.current.get(key);
        if (removalTimer !== undefined) {
          clearTimeout(removalTimer);
          renderRemovalTimersRef.current.delete(key);
        }
        return;
      }
      if (immediate) {
        const removalTimer = renderRemovalTimersRef.current.get(key);
        if (removalTimer !== undefined) {
          clearTimeout(removalTimer);
          renderRemovalTimersRef.current.delete(key);
        }
        setRenderedKeys((current) => withoutKey(current, key));
        return;
      }
      const removalTimer = setTimeout(() => {
        setRenderedKeys((current) => withoutKey(current, key));
        renderRemovalTimersRef.current.delete(key);
      }, ENTRY_TRANSITION_MS);
      renderRemovalTimersRef.current.set(key, removalTimer);
    },
    [options.persistentDetailKeys],
  );

  const expandKey = useCallback(
    (key: string) => {
      const successTimer = successCollapseTimersRef.current.get(key);
      if (successTimer !== undefined) {
        clearTimeout(successTimer);
        successCollapseTimersRef.current.delete(key);
      }
      const removalTimer = renderRemovalTimersRef.current.get(key);
      if (removalTimer !== undefined) {
        clearTimeout(removalTimer);
        renderRemovalTimersRef.current.delete(key);
      }
      setExpandedKeys((current) => withKey(current, key));
      setRenderedKeys((current) => withKey(current, key));
      if (options.prefersReducedMotion) {
        setVisibleKeys((current) => withKey(current, key));
        return;
      }
      const existingFrame = openFramesRef.current.get(key);
      if (existingFrame !== undefined) {
        cancelAnimationFrame(existingFrame);
      }
      const frame = requestAnimationFrame(() => {
        setVisibleKeys((current) => withKey(current, key));
        openFramesRef.current.delete(key);
      });
      openFramesRef.current.set(key, frame);
    },
    [options.prefersReducedMotion],
  );

  const cancelAll = useCallback(() => {
    for (const timer of successCollapseTimersRef.current.values()) {
      clearTimeout(timer);
    }
    successCollapseTimersRef.current.clear();
    for (const timer of renderRemovalTimersRef.current.values()) {
      clearTimeout(timer);
    }
    renderRemovalTimersRef.current.clear();
    for (const frame of openFramesRef.current.values()) {
      cancelAnimationFrame(frame);
    }
    openFramesRef.current.clear();
  }, []);

  const scheduleSuccessfulCollapse = useCallback(
    (key: string) => {
      const previousTimer = successCollapseTimersRef.current.get(key);
      if (previousTimer !== undefined) {
        clearTimeout(previousTimer);
      }
      successCollapseTimersRef.current.set(
        key,
        setTimeout(() => {
          collapseKey(key, options.prefersReducedMotion);
          successCollapseTimersRef.current.delete(key);
        }, SUCCESS_COLLAPSE_DELAY_MS),
      );
    },
    [collapseKey, options.prefersReducedMotion],
  );

  useLayoutEffect(() => {
    cancelAll();
    manualExpansionByKeyRef.current.clear();
    previousAutomaticOpenByKeyRef.current.clear();
    previousPanelIsOpenRef.current = false;
    setExpandedKeys(new Set());
    setRenderedKeys(new Set());
    setVisibleKeys(new Set());
  }, [cancelAll, disclosureScopeKey]);

  useEffect(() => {
    const currentAutomaticOpenByKey = new Map(
      options.processDisplayEntries.map((entry) => [
        entry.key,
        shouldAutomaticallyOpenEntry(
          entry,
          options.executionDetailsPhase,
          options.latestAssistantAnswerPresentationOrder,
          options.revealAutomaticDetailKeys,
        ),
      ]),
    );
    const validKeys = new Set(currentAutomaticOpenByKey.keys());

    for (const key of previousAutomaticOpenByKeyRef.current.keys()) {
      if (!validKeys.has(key)) {
        cancelKeyAutomation(key);
        manualExpansionByKeyRef.current.delete(key);
      }
    }
    setExpandedKeys((current) => retainValidKeys(current, validKeys));
    setRenderedKeys((current) => retainValidKeys(current, validKeys));
    setVisibleKeys((current) => retainValidKeys(current, validKeys));

    const justOpened = options.panelIsOpen && !previousPanelIsOpenRef.current;
    previousPanelIsOpenRef.current = options.panelIsOpen;
    if (justOpened) {
      for (const [key, automaticOpen] of currentAutomaticOpenByKey) {
        if (!manualExpansionByKeyRef.current.has(key)) {
          if (automaticOpen) {
            expandKey(key);
          } else {
            cancelKeyAutomation(key);
            collapseKey(key, true);
          }
        }
      }
      previousAutomaticOpenByKeyRef.current = currentAutomaticOpenByKey;
      return;
    }

    if (options.panelIsOpen) {
      for (const [key, automaticOpen] of currentAutomaticOpenByKey) {
        if (manualExpansionByKeyRef.current.has(key)) {
          continue;
        }
        const previousAutomaticOpen = previousAutomaticOpenByKeyRef.current.get(key);
        if ((previousAutomaticOpen === undefined || previousAutomaticOpen === false) && automaticOpen) {
          expandKey(key);
          continue;
        }
        if (previousAutomaticOpen === true && !automaticOpen) {
          const entry = options.processDisplayEntries.find((candidate) => candidate.key === key);
          if (entry?.kind === 'tool' && entry.isFinal === true && entry.isFailure !== true) {
            scheduleSuccessfulCollapse(key);
          } else {
            cancelKeyAutomation(key);
            collapseKey(key, true);
          }
        }
      }
    }
    previousAutomaticOpenByKeyRef.current = currentAutomaticOpenByKey;
  }, [
    cancelKeyAutomation,
    collapseKey,
    expandKey,
    options.executionDetailsPhase,
    options.latestAssistantAnswerPresentationOrder,
    options.panelIsOpen,
    options.prefersReducedMotion,
    options.processDisplayEntries,
    options.revealAutomaticDetailKeys,
    scheduleSuccessfulCollapse,
  ]);

  useEffect(() => cancelAll, [cancelAll]);

  useEffect(() => {
    for (const key of options.persistentDetailKeys ?? []) {
      const removalTimer = renderRemovalTimersRef.current.get(key);
      if (removalTimer !== undefined) {
        clearTimeout(removalTimer);
        renderRemovalTimersRef.current.delete(key);
      }
    }
  }, [options.persistentDetailKeys]);

  const toggleEntry = useCallback(
    (key: string) => {
      const shouldExpand = !expandedKeys.has(key);
      manualExpansionByKeyRef.current.set(key, shouldExpand);
      cancelKeyAutomation(key);
      if (!shouldExpand) {
        collapseKey(key, options.prefersReducedMotion);
      } else {
        expandKey(key);
      }
    },
    [cancelKeyAutomation, collapseKey, expandKey, expandedKeys, options.prefersReducedMotion],
  );

  const hasManualExpandedEntry = [...manualExpansionByKeyRef.current.values()].some(Boolean);
  return { expandedKeys, renderedKeys, visibleKeys, hasManualExpandedEntry, toggleEntry };
}
