import { useEffect, useState, type RefObject } from 'react';

export const GRAPH_DETAIL_MIN_WIDTH = 360;
export const GRAPH_DETAIL_DEFAULT_WIDTH = 600;
export const GRAPH_DETAIL_MAX_WIDTH = 1040;
export const GRAPH_CHAT_MIN_WIDTH = 560;
export const GRAPH_RESIZE_HANDLE_WIDTH = 12;
export const GRAPH_RESIZE_KEYBOARD_STEP = 32;

export function clampGraphDetailWidth(width: number, containerWidth: number): number {
  const maxWidth = readGraphDetailMaxWidth(containerWidth);
  return Math.min(Math.max(width, GRAPH_DETAIL_MIN_WIDTH), maxWidth);
}

export function readGraphDetailMaxWidth(containerWidth: number): number {
  return Math.min(GRAPH_DETAIL_MAX_WIDTH, Math.max(GRAPH_DETAIL_MIN_WIDTH, containerWidth - GRAPH_CHAT_MIN_WIDTH - GRAPH_RESIZE_HANDLE_WIDTH));
}

export function readContainerWidth(ref: RefObject<HTMLDivElement | null>): number {
  const measuredWidth = ref.current?.getBoundingClientRect().width ?? 0;
  if (measuredWidth > 0) {
    return measuredWidth;
  }
  return typeof window === 'undefined' ? GRAPH_CHAT_MIN_WIDTH + GRAPH_DETAIL_DEFAULT_WIDTH : window.innerWidth;
}

export function shouldUseGraphDrawer(width: number): boolean {
  return width < GRAPH_CHAT_MIN_WIDTH + GRAPH_DETAIL_MIN_WIDTH + GRAPH_RESIZE_HANDLE_WIDTH;
}

export function useGraphDrawerMode(layoutRef: RefObject<HTMLDivElement | null>, isOpen: boolean): boolean {
  const [isDrawerMode, setIsDrawerMode] = useState(() => (typeof window === 'undefined' ? false : shouldUseGraphDrawer(window.innerWidth)));

  useEffect(() => {
    if (!isOpen) {
      return undefined;
    }

    const updateMode = () => {
      setIsDrawerMode(shouldUseGraphDrawer(readContainerWidth(layoutRef)));
    };

    updateMode();
    window.addEventListener('resize', updateMode);

    if (typeof ResizeObserver === 'undefined' || !layoutRef.current) {
      return () => {
        window.removeEventListener('resize', updateMode);
      };
    }

    const observer = new ResizeObserver(updateMode);
    observer.observe(layoutRef.current);
    return () => {
      window.removeEventListener('resize', updateMode);
      observer.disconnect();
    };
  }, [isOpen, layoutRef]);

  return isDrawerMode;
}
