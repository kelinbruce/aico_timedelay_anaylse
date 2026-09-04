import { useCallback, useLayoutEffect, useState, type RefObject } from 'react';

const FEEDBACK_GAP_PX = 12;

export function useShellFeedbackTop(contentRef: RefObject<HTMLElement | null>): number {
  const [feedbackTop, setFeedbackTop] = useState(FEEDBACK_GAP_PX);

  const measure = useCallback(() => {
    const content = contentRef.current;
    const nextTop = content === null ? FEEDBACK_GAP_PX : content.getBoundingClientRect().top + FEEDBACK_GAP_PX;
    setFeedbackTop((currentTop) => (currentTop === nextTop ? currentTop : nextTop));
  }, [contentRef]);

  useLayoutEffect(() => {
    measure();
    window.addEventListener('resize', measure);

    const content = contentRef.current;
    const resizeObserver = content !== null && typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null;
    if (content !== null) {
      resizeObserver?.observe(content);
    }

    return () => {
      window.removeEventListener('resize', measure);
      resizeObserver?.disconnect();
    };
  }, [contentRef, measure]);

  return feedbackTop;
}
