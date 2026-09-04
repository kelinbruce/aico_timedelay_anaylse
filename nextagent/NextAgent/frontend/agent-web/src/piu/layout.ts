export const PREL_MENU_HEIGHT = 63.2;
export const DOCKED_DEFAULT_WIDTH = 484;
export const FLOATING_DEFAULT_WIDTH = 484;
export const FLOATING_DEFAULT_HEIGHT = 756;
export const FLOATING_MIN_WIDTH = 406;
export const FLOATING_MIN_HEIGHT = 484;
export const FLOATING_MAX_WIDTH = 1112;
export const FLOATING_MARGIN = 24;

export type DockedSide = 'left' | 'right';
export type FloatingResizeDirection = 'top' | 'right' | 'bottom' | 'left' | 'top-left' | 'top-right' | 'bottom-right' | 'bottom-left';

export type CollaborativePanelLayout =
  | { readonly kind: 'docked'; readonly width: number; readonly side: DockedSide }
  | { readonly kind: 'floating'; readonly x: number; readonly y: number; readonly width: number; readonly height: number }
  | { readonly kind: 'maximized'; readonly restore: Exclude<CollaborativePanelLayout, { readonly kind: 'maximized' }> };

export interface ViewportSize {
  readonly width: number;
  readonly height: number;
}

export interface FloatingConstraints {
  readonly minWidth: number;
  readonly minHeight: number;
  readonly maxWidth: number;
  readonly maxHeight: number;
}

export function defaultDockedLayout(viewport: ViewportSize = readViewportSize(), side: DockedSide = 'right'): CollaborativePanelLayout {
  return {
    kind: 'docked',
    side,
    width: clampDockedWidth(DOCKED_DEFAULT_WIDTH, viewport),
  };
}

export function clampDockedWidth(width: number, viewport: ViewportSize = readViewportSize(), minWidth = DOCKED_DEFAULT_WIDTH): number {
  const effectiveMin = Math.max(minWidth, 1);
  return clamp(width, effectiveMin, Math.max(effectiveMin, viewport.width));
}

export function resizeDockedWidth(
  side: DockedSide,
  width: number,
  startX: number,
  currentX: number,
  viewport: ViewportSize = readViewportSize(),
  minWidth = DOCKED_DEFAULT_WIDTH,
): number {
  const deltaX = currentX - startX;
  return clampDockedWidth(side === 'right' ? width - deltaX : width + deltaX, viewport, minWidth);
}

export function floatingConstraints(viewport: ViewportSize = readViewportSize()): FloatingConstraints {
  const availableHeight = Math.max(FLOATING_MIN_HEIGHT, viewport.height - PREL_MENU_HEIGHT);
  return {
    minWidth: Math.min(FLOATING_MIN_WIDTH, viewport.width),
    minHeight: Math.min(FLOATING_MIN_HEIGHT, availableHeight),
    maxWidth: Math.min(FLOATING_MAX_WIDTH, Math.max(FLOATING_MIN_WIDTH, viewport.width)),
    maxHeight: availableHeight,
  };
}

export function defaultFloatingLayout(viewport: ViewportSize = readViewportSize()): Extract<CollaborativePanelLayout, { kind: 'floating' }> {
  const constraints = floatingConstraints(viewport);
  const width = clamp(FLOATING_DEFAULT_WIDTH, constraints.minWidth, constraints.maxWidth);
  const height = clamp(FLOATING_DEFAULT_HEIGHT, constraints.minHeight, constraints.maxHeight);
  return clampFloatingLayout(
    {
      kind: 'floating',
      x: viewport.width - width - FLOATING_MARGIN,
      y: PREL_MENU_HEIGHT + FLOATING_MARGIN,
      width,
      height,
    },
    viewport,
  );
}

export function floatingLayoutFromDockedLayout(
  layout: Extract<CollaborativePanelLayout, { kind: 'docked' }>,
  viewport: ViewportSize = readViewportSize(),
): Extract<CollaborativePanelLayout, { kind: 'floating' }> {
  const constraints = floatingConstraints(viewport);
  const width = clamp(FLOATING_DEFAULT_WIDTH, constraints.minWidth, constraints.maxWidth);
  const height = clamp(FLOATING_DEFAULT_HEIGHT, constraints.minHeight, constraints.maxHeight);
  return clampFloatingLayout(
    {
      kind: 'floating',
      x: layout.side === 'left' ? FLOATING_MARGIN : viewport.width - width - FLOATING_MARGIN,
      y: PREL_MENU_HEIGHT + FLOATING_MARGIN,
      width,
      height,
    },
    viewport,
  );
}

export function clampFloatingLayout(
  layout: Extract<CollaborativePanelLayout, { kind: 'floating' }>,
  viewport: ViewportSize = readViewportSize(),
): Extract<CollaborativePanelLayout, { kind: 'floating' }> {
  const constraints = floatingConstraints(viewport);
  const width = clamp(layout.width, constraints.minWidth, constraints.maxWidth);
  const height = clamp(layout.height, constraints.minHeight, constraints.maxHeight);
  const maxX = Math.max(0, viewport.width - width);
  const maxY = Math.max(PREL_MENU_HEIGHT, viewport.height - height);
  return {
    kind: 'floating',
    x: clamp(layout.x, 0, maxX),
    y: clamp(layout.y, PREL_MENU_HEIGHT, maxY),
    width,
    height,
  };
}

export function resizeFloatingFromTop(
  layout: Extract<CollaborativePanelLayout, { kind: 'floating' }>,
  top: number,
  height: number,
  viewport: ViewportSize = readViewportSize(),
): Extract<CollaborativePanelLayout, { kind: 'floating' }> {
  return resizeFloatingLayout(layout, 'top', 0, top - layout.y, viewport, height);
}

export function resizeFloatingLayout(
  layout: Extract<CollaborativePanelLayout, { kind: 'floating' }>,
  direction: FloatingResizeDirection,
  deltaX: number,
  deltaY: number,
  viewport: ViewportSize = readViewportSize(),
  explicitTopHeight?: number,
): Extract<CollaborativePanelLayout, { kind: 'floating' }> {
  const constraints = floatingConstraints(viewport);
  const left = layout.x;
  const right = layout.x + layout.width;
  const top = layout.y;
  const bottom = layout.y + layout.height;

  const resizesLeft = direction.includes('left');
  const resizesRight = direction.includes('right');
  const resizesTop = direction.includes('top');
  const resizesBottom = direction.includes('bottom');

  let nextX = left;
  let nextWidth = layout.width;
  if (resizesLeft) {
    nextWidth = clamp(right - (left + deltaX), constraints.minWidth, Math.min(constraints.maxWidth, right));
    nextX = right - nextWidth;
  } else if (resizesRight) {
    nextWidth = clamp(right + deltaX - left, constraints.minWidth, Math.min(constraints.maxWidth, viewport.width - left));
  }

  let nextY = top;
  let nextHeight = layout.height;
  if (resizesTop) {
    const requestedHeight = explicitTopHeight ?? bottom - (top + deltaY);
    nextHeight = clamp(requestedHeight, constraints.minHeight, Math.min(constraints.maxHeight, bottom - PREL_MENU_HEIGHT));
    nextY = bottom - nextHeight;
  } else if (resizesBottom) {
    nextHeight = clamp(bottom + deltaY - top, constraints.minHeight, Math.min(constraints.maxHeight, viewport.height - top));
  }

  return clampFloatingLayout(
    {
      ...layout,
      x: nextX,
      y: nextY,
      width: nextWidth,
      height: nextHeight,
    },
    viewport,
  );
}

export function maximizeLayout(layout: CollaborativePanelLayout): CollaborativePanelLayout {
  if (layout.kind === 'maximized') {
    return layout;
  }
  return { kind: 'maximized', restore: layout };
}

export function restoreLayout(layout: CollaborativePanelLayout): CollaborativePanelLayout {
  return layout.kind === 'maximized' ? layout.restore : layout;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

export function readViewportSize(): ViewportSize {
  if (typeof window === 'undefined') {
    return { width: 1920, height: 1080 };
  }
  return {
    width: window.innerWidth,
    height: window.innerHeight,
  };
}
