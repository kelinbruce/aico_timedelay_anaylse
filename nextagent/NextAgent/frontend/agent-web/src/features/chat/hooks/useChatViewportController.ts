import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

const RESTORE_FOLLOW_BOTTOM_THRESHOLD_PX = 4;
const OLDER_PAGE_LOAD_THRESHOLD_PX = 128;
const SCROLL_TO_BOTTOM_ANIMATION_DURATION_MS = 220;
const READING_ANCHOR_CAPTURE_IDLE_MS = 120;

interface UseChatViewportControllerParams {
  readonly sessionId: string | null;
  readonly latestEnvelopeCursor: string;
  readonly turnBlockCursor: string;
  readonly isConversationLoading: boolean;
  readonly shouldShowWelcome: boolean;
  readonly isAnchoredConversation: boolean;
  readonly activeSessionEventCount: number;
  readonly hasOlderMessages: boolean;
  readonly isLoadingOlder: boolean;
  readonly loadOlderConversation: (sessionId: string) => Promise<boolean>;
}

interface UseChatViewportControllerResult {
  readonly scrollViewportRef: React.RefObject<HTMLDivElement | null>;
  readonly isAtBottom: boolean;
  readonly isFollowingBottom: boolean;
  readonly readIsFollowingBottom: () => boolean;
  readonly hasNewMessages: boolean;
  readonly handleScroll: () => void;
  readonly handleViewportWheel: (event: React.WheelEvent<HTMLDivElement>) => void;
  readonly handleAnchorCompensation: (deltaY: number) => void;
  readonly handleAsyncContentLayoutChange: () => void;
  readonly stopFollowingBottom: () => void;
  readonly scrollToBottom: () => void;
  readonly requestScrollToBottomIfFollowing: () => void;
  readonly requestLoadOlderIfNearTop: () => void;
}

export function useChatViewportController({
  sessionId,
  latestEnvelopeCursor,
  turnBlockCursor,
  isConversationLoading,
  shouldShowWelcome,
  isAnchoredConversation,
  activeSessionEventCount,
  hasOlderMessages,
  isLoadingOlder,
  loadOlderConversation,
}: UseChatViewportControllerParams): UseChatViewportControllerResult {
  const [isAtBottom, setIsAtBottom] = useState(true);
  const [isFollowingBottom, setIsFollowingBottom] = useState(true);
  const [hasNewMessages, setHasNewMessages] = useState(false);
  const scrollViewportRef = useRef<HTMLDivElement>(null);
  const isFollowingBottomRef = useRef(true);
  const readingAnchorRef = useRef<{ rootMessageId: string; top: number; scrollTop: number } | null>(null);
  const scrollFrameRef = useRef<number | null>(null);
  const readingAnchorCaptureTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingScrollTopRef = useRef<number | null>(null);
  const pendingMovedUpRef = useRef(false);
  const scrollToBottomAnimationFrameRef = useRef<number | null>(null);
  const scrollToBottomTargetRef = useRef(0);
  const followBottomAnimationFrameRef = useRef<number | null>(null);
  const followBottomTargetRef = useRef<number | null>(null);
  const lastScrollTopRef = useRef(0);
  const programmaticScrollInProgressRef = useRef(false);
  const olderLoadInFlightRef = useRef(false);

  const updateFollowingBottom = useCallback((next: boolean) => {
    isFollowingBottomRef.current = next;
    setIsFollowingBottom(next);
  }, []);

  const readIsFollowingBottom = useCallback(() => isFollowingBottomRef.current, []);

  const cancelScrollToBottomAnimation = useCallback(() => {
    if (scrollToBottomAnimationFrameRef.current !== null) {
      cancelAnimationFrame(scrollToBottomAnimationFrameRef.current);
      scrollToBottomAnimationFrameRef.current = null;
    }
    programmaticScrollInProgressRef.current = false;
  }, []);

  const cancelScheduledFollowBottom = useCallback(() => {
    if (followBottomAnimationFrameRef.current !== null) {
      cancelAnimationFrame(followBottomAnimationFrameRef.current);
      followBottomAnimationFrameRef.current = null;
    }
    followBottomTargetRef.current = null;
  }, []);

  const cancelScheduledScrollUpdate = useCallback(() => {
    if (scrollFrameRef.current !== null) {
      cancelAnimationFrame(scrollFrameRef.current);
      scrollFrameRef.current = null;
    }
    pendingScrollTopRef.current = null;
    pendingMovedUpRef.current = false;
  }, []);

  const cancelScheduledReadingAnchorCapture = useCallback(() => {
    if (readingAnchorCaptureTimerRef.current !== null) {
      clearTimeout(readingAnchorCaptureTimerRef.current);
      readingAnchorCaptureTimerRef.current = null;
    }
  }, []);

  const pinScrollPositionToBottom = useCallback((targetTop?: number) => {
    const el = scrollViewportRef.current;
    if (!el) {
      return;
    }

    const nextTop = targetTop ?? el.scrollHeight;
    programmaticScrollInProgressRef.current = true;
    if (typeof el.scrollTo === 'function') {
      el.scrollTo({ top: nextTop, behavior: 'auto' });
    } else {
      el.scrollTop = nextTop;
    }
  }, []);

  useEffect(() => {
    return () => {
      cancelScheduledScrollUpdate();
      cancelScheduledReadingAnchorCapture();
      cancelScrollToBottomAnimation();
      cancelScheduledFollowBottom();
    };
  }, [cancelScheduledFollowBottom, cancelScheduledReadingAnchorCapture, cancelScheduledScrollUpdate, cancelScrollToBottomAnimation]);

  useEffect(() => {
    cancelScheduledScrollUpdate();
    cancelScheduledReadingAnchorCapture();
    cancelScrollToBottomAnimation();
    cancelScheduledFollowBottom();
    lastScrollTopRef.current = 0;
    olderLoadInFlightRef.current = false;
    readingAnchorRef.current = null;
    setIsAtBottom(true);
    setHasNewMessages(false);
    updateFollowingBottom(true);
  }, [
    sessionId,
    cancelScheduledFollowBottom,
    cancelScheduledReadingAnchorCapture,
    cancelScheduledScrollUpdate,
    cancelScrollToBottomAnimation,
    updateFollowingBottom,
  ]);

  const captureReadingAnchor = useCallback(() => {
    const viewport = scrollViewportRef.current;
    if (!viewport) {
      return null;
    }

    const viewportRect = viewport.getBoundingClientRect();
    const turnElements = Array.from(viewport.querySelectorAll<HTMLElement>('[data-testid="turn-block"][data-root-message-id]'));
    const firstVisibleTurn = turnElements.find((element) => {
      const rect = element.getBoundingClientRect();
      return rect.bottom > viewportRect.top && rect.top < viewportRect.bottom;
    });

    if (!firstVisibleTurn?.dataset.rootMessageId) {
      return null;
    }

    return {
      rootMessageId: firstVisibleTurn.dataset.rootMessageId,
      top: firstVisibleTurn.getBoundingClientRect().top,
      scrollTop: viewport.scrollTop,
    };
  }, []);

  const captureReadingAnchorNow = useCallback(() => {
    cancelScheduledReadingAnchorCapture();
    readingAnchorRef.current = captureReadingAnchor();
  }, [cancelScheduledReadingAnchorCapture, captureReadingAnchor]);

  const scheduleReadingAnchorCapture = useCallback(() => {
    if (readingAnchorCaptureTimerRef.current !== null) {
      return;
    }
    readingAnchorCaptureTimerRef.current = setTimeout(() => {
      readingAnchorCaptureTimerRef.current = null;
      if (!isFollowingBottomRef.current) {
        readingAnchorRef.current = captureReadingAnchor();
      }
    }, READING_ANCHOR_CAPTURE_IDLE_MS);
  }, [captureReadingAnchor]);

  const handleLoadOlderMessages = useCallback(async () => {
    if (!sessionId || isConversationLoading || !hasOlderMessages || isLoadingOlder || olderLoadInFlightRef.current) {
      return;
    }

    const viewport = scrollViewportRef.current;
    const beforeHeight = viewport?.scrollHeight ?? 0;
    const beforeTop = viewport?.scrollTop ?? 0;

    olderLoadInFlightRef.current = true;
    updateFollowingBottom(false);
    cancelScheduledReadingAnchorCapture();
    readingAnchorRef.current = null;

    try {
      const loaded = await loadOlderConversation(sessionId);
      if (!loaded) {
        return;
      }

      requestAnimationFrame(() => {
        const currentViewport = scrollViewportRef.current;
        if (!currentViewport) {
          return;
        }
        const afterHeight = currentViewport.scrollHeight;
        const delta = afterHeight - beforeHeight;
        currentViewport.scrollTop = beforeTop + delta;
        lastScrollTopRef.current = currentViewport.scrollTop;
        setIsAtBottom(false);
        setHasNewMessages(false);
        captureReadingAnchorNow();
      });
    } finally {
      olderLoadInFlightRef.current = false;
    }
  }, [
    sessionId,
    isConversationLoading,
    hasOlderMessages,
    isLoadingOlder,
    loadOlderConversation,
    updateFollowingBottom,
    cancelScheduledReadingAnchorCapture,
    captureReadingAnchorNow,
  ]);

  const requestLoadOlderIfNearTop = useCallback(() => {
    const viewport = scrollViewportRef.current;
    if (!viewport || viewport.scrollTop > OLDER_PAGE_LOAD_THRESHOLD_PX) {
      return;
    }
    void handleLoadOlderMessages();
  }, [handleLoadOlderMessages]);

  const updateScrollState = useCallback(() => {
    const el = scrollViewportRef.current;
    if (!el) {
      return;
    }
    const currentScrollTop = el.scrollTop;
    const previousScrollTop = lastScrollTopRef.current;
    lastScrollTopRef.current = currentScrollTop;
    const movedUpInPendingFrame = pendingMovedUpRef.current;
    pendingScrollTopRef.current = null;
    pendingMovedUpRef.current = false;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    const atBottom = distanceFromBottom <= RESTORE_FOLLOW_BOTTOM_THRESHOLD_PX;
    const movedUp = movedUpInPendingFrame || currentScrollTop < previousScrollTop - 1;
    setIsAtBottom(atBottom);
    const shouldRestoreFollowing = !isAnchoredConversation && atBottom;
    if (shouldRestoreFollowing) {
      updateFollowingBottom(true);
      setHasNewMessages(false);
      cancelScheduledReadingAnchorCapture();
      readingAnchorRef.current = null;
      programmaticScrollInProgressRef.current = false;
      return;
    }
    if (programmaticScrollInProgressRef.current && !movedUp) {
      return;
    }
    if (programmaticScrollInProgressRef.current && movedUp) {
      cancelScrollToBottomAnimation();
    }
    if (isFollowingBottomRef.current && movedUp) {
      cancelScheduledFollowBottom();
      updateFollowingBottom(false);
      setHasNewMessages(true);
      scheduleReadingAnchorCapture();
      return;
    }
    if (!isFollowingBottomRef.current) {
      scheduleReadingAnchorCapture();
    }
  }, [
    cancelScheduledFollowBottom,
    cancelScheduledReadingAnchorCapture,
    cancelScrollToBottomAnimation,
    scheduleReadingAnchorCapture,
    isAnchoredConversation,
    updateFollowingBottom,
  ]);

  const handleScroll = useCallback(() => {
    const el = scrollViewportRef.current;
    if (el) {
      const nextScrollTop = el.scrollTop;
      const previousObservedScrollTop = pendingScrollTopRef.current ?? lastScrollTopRef.current;
      const movedUpFromPrevious = nextScrollTop < previousObservedScrollTop - 1;
      if (programmaticScrollInProgressRef.current && !movedUpFromPrevious) {
        lastScrollTopRef.current = nextScrollTop;
        pendingScrollTopRef.current = null;
        pendingMovedUpRef.current = false;
        return;
      }
      const isAtBottomNow = el.scrollHeight - nextScrollTop - el.clientHeight <= RESTORE_FOLLOW_BOTTOM_THRESHOLD_PX;
      const movedUp = !isAtBottomNow && movedUpFromPrevious;
      if (programmaticScrollInProgressRef.current && !movedUp) {
        lastScrollTopRef.current = nextScrollTop;
        pendingScrollTopRef.current = null;
        pendingMovedUpRef.current = false;
        return;
      }
      if (movedUp) {
        pendingMovedUpRef.current = true;
        cancelScrollToBottomAnimation();
        cancelScheduledFollowBottom();
        if (isFollowingBottomRef.current) {
          setIsAtBottom(false);
          updateFollowingBottom(false);
          setHasNewMessages(true);
        }
        requestLoadOlderIfNearTop();
      }
      pendingScrollTopRef.current = nextScrollTop;
    }

    if (scrollFrameRef.current !== null) {
      return;
    }

    let frameDidRunSynchronously = false;
    const frameId = requestAnimationFrame(() => {
      frameDidRunSynchronously = true;
      scrollFrameRef.current = null;
      updateScrollState();
    });
    if (!frameDidRunSynchronously) {
      scrollFrameRef.current = frameId;
    }
  }, [cancelScheduledFollowBottom, cancelScrollToBottomAnimation, requestLoadOlderIfNearTop, updateFollowingBottom, updateScrollState]);

  const handleViewportWheel = useCallback(
    (event: React.WheelEvent<HTMLDivElement>) => {
      const viewport = scrollViewportRef.current;
      const canMoveUp = Boolean(viewport && viewport.scrollHeight > viewport.clientHeight && viewport.scrollTop > 0);
      if (event.deltaY < 0 && canMoveUp) {
        cancelScrollToBottomAnimation();
        cancelScheduledFollowBottom();
        if (isFollowingBottomRef.current) {
          updateFollowingBottom(false);
          setHasNewMessages(true);
        }
      }
      if (event.deltaY < 0) {
        requestLoadOlderIfNearTop();
      }
    },
    [cancelScheduledFollowBottom, cancelScrollToBottomAnimation, requestLoadOlderIfNearTop, updateFollowingBottom],
  );

  const stopFollowingBottom = useCallback(() => {
    cancelScrollToBottomAnimation();
    cancelScheduledFollowBottom();
    updateFollowingBottom(false);
    setHasNewMessages(false);
    programmaticScrollInProgressRef.current = false;
    const viewport = scrollViewportRef.current;
    if (viewport) {
      setIsAtBottom(viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight <= RESTORE_FOLLOW_BOTTOM_THRESHOLD_PX);
      lastScrollTopRef.current = viewport.scrollTop;
    } else {
      setIsAtBottom(false);
    }
    captureReadingAnchorNow();
  }, [cancelScheduledFollowBottom, cancelScrollToBottomAnimation, captureReadingAnchorNow, updateFollowingBottom]);

  useEffect(() => {
    if (isAnchoredConversation) {
      stopFollowingBottom();
    }
  }, [isAnchoredConversation, stopFollowingBottom]);

  const handleAnchorCompensation = useCallback(
    (deltaY: number) => {
      if (isFollowingBottomRef.current || deltaY === 0) {
        return;
      }
      const viewport = scrollViewportRef.current;
      if (!viewport) {
        return;
      }
      viewport.scrollTop += deltaY;
      captureReadingAnchorNow();
    },
    [captureReadingAnchorNow],
  );

  const handleAsyncContentLayoutChange = useCallback(() => {
    if (isFollowingBottomRef.current) {
      return;
    }

    const viewport = scrollViewportRef.current;
    if (!viewport) {
      return;
    }

    cancelScheduledReadingAnchorCapture();
    const anchor = readingAnchorRef.current ?? captureReadingAnchor();
    if (!anchor) {
      return;
    }

    const anchoredElement = Array.from(viewport.querySelectorAll<HTMLElement>('[data-testid="turn-block"][data-root-message-id]')).find(
      (element) => element.dataset.rootMessageId === anchor.rootMessageId,
    );

    if (!anchoredElement) {
      captureReadingAnchorNow();
      return;
    }

    if (Math.abs(viewport.scrollTop - anchor.scrollTop) > 1) {
      captureReadingAnchorNow();
      return;
    }

    const afterTop = anchoredElement.getBoundingClientRect().top;
    const delta = afterTop - anchor.top;
    if (delta !== 0) {
      viewport.scrollTop += delta;
    }
    captureReadingAnchorNow();
  }, [cancelScheduledReadingAnchorCapture, captureReadingAnchor, captureReadingAnchorNow]);

  const stickToBottom = useCallback(
    (targetTop?: number) => {
      cancelScrollToBottomAnimation();
      cancelScheduledReadingAnchorCapture();
      pinScrollPositionToBottom(targetTop);
      const el = scrollViewportRef.current;
      if (el) {
        setIsAtBottom(true);
        updateFollowingBottom(true);
        setHasNewMessages(false);
        readingAnchorRef.current = null;
        requestAnimationFrame(() => {
          programmaticScrollInProgressRef.current = false;
          const viewport = scrollViewportRef.current;
          if (viewport) {
            lastScrollTopRef.current = viewport.scrollTop;
          }
        });
      }
    },
    [cancelScheduledReadingAnchorCapture, cancelScrollToBottomAnimation, pinScrollPositionToBottom, updateFollowingBottom],
  );

  const scheduleStickToBottomIfFollowing = useCallback(
    (targetTop?: number) => {
      if (isAnchoredConversation || !isFollowingBottomRef.current) {
        return;
      }
      if (targetTop !== undefined) {
        followBottomTargetRef.current = targetTop;
      }
      if (scrollToBottomAnimationFrameRef.current !== null || followBottomAnimationFrameRef.current !== null) {
        return;
      }

      let frameDidRunSynchronously = false;
      const frameId = requestAnimationFrame(() => {
        frameDidRunSynchronously = true;
        followBottomAnimationFrameRef.current = null;
        const nextTargetTop = followBottomTargetRef.current ?? undefined;
        followBottomTargetRef.current = null;
        if (isFollowingBottomRef.current) {
          stickToBottom(nextTargetTop);
        }
      });
      if (!frameDidRunSynchronously) {
        followBottomAnimationFrameRef.current = frameId;
      }
    },
    [isAnchoredConversation, stickToBottom],
  );

  const scrollToBottom = useCallback(() => {
    const el = scrollViewportRef.current;
    if (!el) {
      return;
    }

    cancelScrollToBottomAnimation();
    cancelScheduledScrollUpdate();
    cancelScheduledReadingAnchorCapture();

    updateFollowingBottom(true);
    setHasNewMessages(false);
    readingAnchorRef.current = null;
    programmaticScrollInProgressRef.current = true;

    const startTop = el.scrollTop;
    const initialTargetTop = el.scrollHeight;
    scrollToBottomTargetRef.current = initialTargetTop;
    if (Math.abs(initialTargetTop - startTop) < 1) {
      el.scrollTop = initialTargetTop;
      lastScrollTopRef.current = initialTargetTop;
      programmaticScrollInProgressRef.current = false;
      setIsAtBottom(true);
      return;
    }

    let startTimestamp: number | null = null;
    let lastTimestamp: number | null = null;
    let syntheticElapsed = 0;

    const scheduleAnimationStep = () => {
      let frameDidRunSynchronously = false;
      const frameId = requestAnimationFrame((timestamp) => {
        frameDidRunSynchronously = true;
        step(timestamp);
      });
      if (!frameDidRunSynchronously) {
        scrollToBottomAnimationFrameRef.current = frameId;
      }
    };

    const step = (timestamp: number) => {
      const viewport = scrollViewportRef.current;
      if (!viewport) {
        scrollToBottomAnimationFrameRef.current = null;
        return;
      }

      if (startTimestamp === null) {
        startTimestamp = timestamp;
      }

      if (lastTimestamp !== null) {
        if (timestamp > lastTimestamp) {
          syntheticElapsed += Math.min(40, timestamp - lastTimestamp);
        } else {
          syntheticElapsed += 16;
        }
      }
      lastTimestamp = timestamp;

      const elapsed = timestamp > startTimestamp ? timestamp - startTimestamp : syntheticElapsed;
      const progress = Math.min(1, elapsed / SCROLL_TO_BOTTOM_ANIMATION_DURATION_MS);
      const easedProgress = 1 - (1 - progress) ** 3;
      const targetTop = scrollToBottomTargetRef.current;
      viewport.scrollTop = startTop + (targetTop - startTop) * easedProgress;

      if (progress >= 1) {
        viewport.scrollTop = viewport.scrollHeight;
        lastScrollTopRef.current = viewport.scrollTop;
        programmaticScrollInProgressRef.current = false;
        scrollToBottomAnimationFrameRef.current = null;
        setIsAtBottom(true);
        return;
      }

      scheduleAnimationStep();
    };

    scheduleAnimationStep();
  }, [cancelScheduledReadingAnchorCapture, cancelScheduledScrollUpdate, cancelScrollToBottomAnimation, updateFollowingBottom]);

  const requestScrollToBottomIfFollowing = useCallback(() => {
    if (!isFollowingBottomRef.current) {
      return;
    }
    scheduleStickToBottomIfFollowing();
  }, [scheduleStickToBottomIfFollowing]);

  useLayoutEffect(() => {
    if (shouldShowWelcome || typeof ResizeObserver === 'undefined') {
      return undefined;
    }

    const viewport = scrollViewportRef.current;
    const content = viewport?.firstElementChild;
    if (!viewport || !(content instanceof HTMLElement)) {
      return undefined;
    }

    let previousScrollHeight = viewport.scrollHeight;
    const handleContentSizeChange = () => {
      const nextScrollHeight = viewport.scrollHeight;
      if (nextScrollHeight === previousScrollHeight) {
        return;
      }

      previousScrollHeight = nextScrollHeight;
      if (scrollToBottomAnimationFrameRef.current !== null) {
        scrollToBottomTargetRef.current = nextScrollHeight;
      } else if (isFollowingBottomRef.current) {
        scheduleStickToBottomIfFollowing(nextScrollHeight);
      } else {
        handleAsyncContentLayoutChange();
      }
    };

    const observer = new ResizeObserver(handleContentSizeChange);
    observer.observe(content);
    return () => observer.disconnect();
  }, [handleAsyncContentLayoutChange, scheduleStickToBottomIfFollowing, shouldShowWelcome]);

  useEffect(() => {
    if (!isFollowingBottomRef.current && activeSessionEventCount > 0) {
      setHasNewMessages(true);
    } else if (isFollowingBottomRef.current && activeSessionEventCount > 0) {
      setHasNewMessages(false);
      scheduleStickToBottomIfFollowing();
    }
  }, [latestEnvelopeCursor, isFollowingBottom, activeSessionEventCount, scheduleStickToBottomIfFollowing]);

  useLayoutEffect(() => {
    if (isFollowingBottomRef.current) {
      cancelScheduledReadingAnchorCapture();
      readingAnchorRef.current = null;
      return;
    }

    const viewport = scrollViewportRef.current;
    if (!viewport) {
      return;
    }

    const anchor = readingAnchorRef.current;
    if (!anchor) {
      captureReadingAnchorNow();
      return;
    }

    const anchoredElement = Array.from(viewport.querySelectorAll<HTMLElement>('[data-testid="turn-block"][data-root-message-id]')).find(
      (element) => element.dataset.rootMessageId === anchor.rootMessageId,
    );

    if (!anchoredElement) {
      captureReadingAnchorNow();
      return;
    }

    if (Math.abs(viewport.scrollTop - anchor.scrollTop) > 1) {
      captureReadingAnchorNow();
      return;
    }

    const afterTop = anchoredElement.getBoundingClientRect().top;
    const delta = afterTop - anchor.top;
    if (delta !== 0) {
      viewport.scrollTop += delta;
    }
    captureReadingAnchorNow();
  }, [cancelScheduledReadingAnchorCapture, captureReadingAnchorNow, latestEnvelopeCursor, turnBlockCursor, isConversationLoading]);

  useEffect(() => {
    if (!shouldShowWelcome) {
      return;
    }

    const viewport = scrollViewportRef.current;
    if (viewport) {
      if (typeof viewport.scrollTo === 'function') {
        viewport.scrollTo({ top: 0, behavior: 'auto' });
      } else {
        viewport.scrollTop = 0;
      }
    }

    setIsAtBottom(true);
    setHasNewMessages(false);
    cancelScheduledReadingAnchorCapture();
    readingAnchorRef.current = null;
    updateFollowingBottom(true);
  }, [cancelScheduledReadingAnchorCapture, shouldShowWelcome, updateFollowingBottom]);

  return {
    scrollViewportRef,
    isAtBottom,
    isFollowingBottom,
    readIsFollowingBottom,
    hasNewMessages,
    handleScroll,
    handleViewportWheel,
    handleAnchorCompensation,
    handleAsyncContentLayoutChange,
    stopFollowingBottom,
    scrollToBottom,
    requestScrollToBottomIfFollowing,
    requestLoadOlderIfNearTop,
  };
}
