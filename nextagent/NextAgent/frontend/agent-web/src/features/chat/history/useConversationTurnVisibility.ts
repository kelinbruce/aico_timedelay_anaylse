import { useEffect, useRef, type RefObject } from 'react';
import { MAX_AUTOMATIC_PROCESS_HISTORY_TARGETS, type ProcessHistoryTarget, type ProcessHistoryTargetUpdate } from './processHistoryScheduler.ts';

export interface ConversationTurnVisibility {
  readonly sessionId: string;
  readonly rootMessageId: string;
  readonly runId: string;
  readonly kind: 'VIEWPORT' | 'PRELOAD';
  readonly distanceFromViewportCenter: number;
}

export function selectBoundedVisibilityTargets(
  visibleTurns: readonly ConversationTurnVisibility[],
  generation: number,
): readonly ProcessHistoryTarget[] {
  const selected = new Map<string, ConversationTurnVisibility>();
  for (const turn of [...visibleTurns].sort((left, right) => {
    const priorityDelta = (left.kind === 'VIEWPORT' ? 0 : 1) - (right.kind === 'VIEWPORT' ? 0 : 1);
    return priorityDelta || left.distanceFromViewportCenter - right.distanceFromViewportCenter || left.runId.localeCompare(right.runId);
  })) {
    if (!selected.has(turn.runId)) {
      selected.set(turn.runId, turn);
    }
  }
  return [...selected.values()].slice(0, MAX_AUTOMATIC_PROCESS_HISTORY_TARGETS).map((turn) => ({
    sessionId: turn.sessionId,
    rootMessageId: turn.rootMessageId,
    runId: turn.runId,
    priority: turn.kind,
    generation,
    distanceFromViewportCenter: turn.distanceFromViewportCenter,
  }));
}

interface UseConversationTurnVisibilityOptions {
  readonly sessionId: string;
  readonly containerRef: RefObject<HTMLElement | null>;
  readonly viewportRef: RefObject<HTMLElement | null>;
  readonly turnIdentityKey: string;
  readonly onTargetsChange: (targets: ProcessHistoryTargetUpdate) => void;
}

const PRELOAD_IDLE_MS = 120;

export function useConversationTurnVisibility(options: UseConversationTurnVisibilityOptions): void {
  const generationRef = useRef(0);
  const onTargetsChangeRef = useRef(options.onTargetsChange);

  useEffect(() => {
    onTargetsChangeRef.current = options.onTargetsChange;
  }, [options.onTargetsChange]);

  useEffect(() => {
    return () => {
      onTargetsChangeRef.current({ automatic: [], explicit: [] });
    };
  }, [options.sessionId]);

  useEffect(() => {
    const container = options.containerRef.current;
    const viewport = options.viewportRef.current;
    if (!container || !viewport || typeof IntersectionObserver === 'undefined') {
      return undefined;
    }

    const viewportElements = new Set<Element>();
    const preloadElements = new Set<Element>();
    let frame: number | null = null;
    let preloadTimer: ReturnType<typeof setTimeout> | null = null;
    let pointerDragging = false;

    const readVisibility = (includePreload: boolean): ConversationTurnVisibility[] => {
      const viewportRect = viewport.getBoundingClientRect();
      const viewportCenter = viewportRect.top + viewportRect.height / 2;
      const elements = new Set(viewportElements);
      if (includePreload) {
        for (const element of preloadElements) {
          elements.add(element);
        }
      }
      return [...elements].flatMap((element) => {
        if (!(element instanceof HTMLElement)) {
          return [];
        }
        const runId = element.dataset.processRunId;
        const rootMessageId = element.dataset.rootMessageId;
        if (!runId || !rootMessageId) {
          return [];
        }
        const rect = element.getBoundingClientRect();
        return [
          {
            sessionId: options.sessionId,
            rootMessageId,
            runId,
            kind: viewportElements.has(element) ? ('VIEWPORT' as const) : ('PRELOAD' as const),
            distanceFromViewportCenter: Math.abs(rect.top + rect.height / 2 - viewportCenter),
          },
        ];
      });
    };

    const publish = (includePreload: boolean): void => {
      if (pointerDragging) {
        return;
      }
      generationRef.current += 1;
      onTargetsChangeRef.current({
        automatic: selectBoundedVisibilityTargets(readVisibility(includePreload), generationRef.current),
        explicit: [],
      });
    };

    const schedule = (): void => {
      if (frame === null) {
        frame = requestAnimationFrame(() => {
          frame = null;
          publish(false);
        });
      }
      if (preloadTimer !== null) {
        clearTimeout(preloadTimer);
      }
      preloadTimer = setTimeout(() => {
        preloadTimer = null;
        publish(true);
      }, PRELOAD_IDLE_MS);
    };

    const viewportObserver = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            viewportElements.add(entry.target);
          } else {
            viewportElements.delete(entry.target);
          }
        }
        schedule();
      },
      { root: viewport },
    );
    const preloadObserver = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            preloadElements.add(entry.target);
          } else {
            preloadElements.delete(entry.target);
          }
        }
        schedule();
      },
      { root: viewport, rootMargin: '100% 0px' },
    );

    const observed = container.querySelectorAll<HTMLElement>('[data-process-run-id][data-root-message-id]');
    observed.forEach((element) => {
      viewportObserver.observe(element);
      preloadObserver.observe(element);
    });

    const handlePointerDown = (): void => {
      pointerDragging = true;
    };
    const handlePointerEnd = (): void => {
      if (!pointerDragging) {
        return;
      }
      pointerDragging = false;
      schedule();
    };
    const handleWheel = (): void => schedule();
    viewport.addEventListener('pointerdown', handlePointerDown);
    viewport.addEventListener('wheel', handleWheel, { passive: true });
    window.addEventListener('pointerup', handlePointerEnd);
    window.addEventListener('pointercancel', handlePointerEnd);

    return () => {
      viewportObserver.disconnect();
      preloadObserver.disconnect();
      viewport.removeEventListener('pointerdown', handlePointerDown);
      viewport.removeEventListener('wheel', handleWheel);
      window.removeEventListener('pointerup', handlePointerEnd);
      window.removeEventListener('pointercancel', handlePointerEnd);
      if (frame !== null) {
        cancelAnimationFrame(frame);
      }
      if (preloadTimer !== null) {
        clearTimeout(preloadTimer);
      }
    };
  }, [options.containerRef, options.sessionId, options.turnIdentityKey, options.viewportRef]);
}
