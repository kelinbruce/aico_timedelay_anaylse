import { describe, expect, it } from 'vitest';
import { closePanel, defaultDisplayState, normalizeDisplayState, openPanel } from '../src/piu/displayState.ts';
import {
  FLOATING_MARGIN,
  PREL_MENU_HEIGHT,
  clampFloatingLayout,
  defaultDockedLayout,
  defaultFloatingLayout,
  floatingConstraints,
  floatingLayoutFromDockedLayout,
  maximizeLayout,
  resizeDockedWidth,
  resizeFloatingLayout,
  resizeFloatingFromTop,
  restoreLayout,
} from '../src/piu/layout.ts';
import { hostLocaleToSupportedLocale, hostThemeToThemeMode } from '../src/app/hostTypes.ts';

describe('AICOPIU state reducers', () => {
  it('normalizes display state combinations', () => {
    expect(normalizeDisplayState({ showEntrance: false, showPanel: false })).toEqual({
      showEntrance: false,
      showPanel: false,
      minimized: false,
    });
    expect(normalizeDisplayState({ showEntrance: true, showPanel: false })).toEqual({
      showEntrance: true,
      showPanel: false,
      minimized: false,
    });
    expect(normalizeDisplayState({ showEntrance: true, showPanel: true })).toEqual({
      showEntrance: true,
      showPanel: true,
      minimized: false,
    });
    expect(normalizeDisplayState({ showEntrance: false, showPanel: true })).toEqual({
      showEntrance: false,
      showPanel: true,
      minimized: false,
    });
    expect(closePanel({ showEntrance: false, showPanel: true })).toEqual({
      showEntrance: false,
      showPanel: false,
      minimized: false,
    });
    expect(openPanel({ showEntrance: false, showPanel: false })).toEqual({
      showEntrance: true,
      showPanel: true,
      minimized: false,
    });
  });

  it('normalizes minimized field rules', () => {
    expect(defaultDisplayState.minimized).toBe(false);
    expect(normalizeDisplayState({ showEntrance: true, showPanel: true, minimized: true })).toEqual({
      showEntrance: true,
      showPanel: true,
      minimized: true,
    });
    expect(normalizeDisplayState({ showEntrance: true, showPanel: false, minimized: true })).toEqual({
      showEntrance: true,
      showPanel: false,
      minimized: false,
    });
    expect(normalizeDisplayState({ showEntrance: false, showPanel: false, minimized: true })).toEqual({
      showEntrance: false,
      showPanel: false,
      minimized: false,
    });
  });

  it('maps Prel theme and locale vocabulary to app vocabulary', () => {
    expect(hostThemeToThemeMode('lightday')).toBe('light');
    expect(hostThemeToThemeMode('evening')).toBe('dark');
    expect(hostLocaleToSupportedLocale('zh-cn')).toBe('zh-CN');
    expect(hostLocaleToSupportedLocale('en-us')).toBe('en-US');
  });

  it('uses the 1920x1080 floating geometry requested for collaborative mode', () => {
    const layout = defaultFloatingLayout({ width: 1920, height: 1080 });
    const constraints = floatingConstraints({ width: 1920, height: 1080 });

    expect(layout.width).toBe(484);
    expect(layout.height).toBe(756);
    expect(constraints.minWidth).toBe(406);
    expect(constraints.minHeight).toBe(484);
    expect(constraints.maxWidth).toBe(1112);
    expect(layout.y).toBeGreaterThanOrEqual(PREL_MENU_HEIGHT);
  });

  it('resizes docked width from the inner edge for left and right dock sides', () => {
    const rightDocked = defaultDockedLayout({ width: 1920, height: 1080 });
    const leftDocked = defaultDockedLayout({ width: 1920, height: 1080 }, 'left');

    expect(rightDocked.kind).toBe('docked');
    expect(leftDocked.kind).toBe('docked');
    expect(rightDocked.kind === 'docked' ? rightDocked.side : null).toBe('right');
    expect(leftDocked.kind === 'docked' ? leftDocked.side : null).toBe('left');

    expect(resizeDockedWidth('right', 484, 1000, 900, { width: 1920, height: 1080 })).toBe(584);
    expect(resizeDockedWidth('left', 484, 1000, 1100, { width: 1920, height: 1080 })).toBe(584);
    expect(resizeDockedWidth('right', 484, 1000, 1200, { width: 1920, height: 1080 })).toBe(484);
    expect(resizeDockedWidth('left', 484, 1000, 800, { width: 1920, height: 1080 })).toBe(484);
  });

  it('anchors floating entry to the current dock side', () => {
    const viewport = { width: 1920, height: 1080 };
    const rightFloating = floatingLayoutFromDockedLayout({ kind: 'docked', side: 'right', width: 484 }, viewport);
    const leftFloating = floatingLayoutFromDockedLayout({ kind: 'docked', side: 'left', width: 484 }, viewport);

    expect(rightFloating.width).toBe(484);
    expect(rightFloating.height).toBe(756);
    expect(rightFloating.x).toBe(1920 - 484 - FLOATING_MARGIN);
    expect(leftFloating.width).toBe(484);
    expect(leftFloating.height).toBe(756);
    expect(leftFloating.x).toBe(FLOATING_MARGIN);
    expect(leftFloating.y).toBe(PREL_MENU_HEIGHT + FLOATING_MARGIN);
  });

  it('clamps floating windows inside the area below the Prelude menu', () => {
    const layout = clampFloatingLayout({ kind: 'floating', x: -100, y: 0, width: 2000, height: 2000 }, { width: 900, height: 700 });

    expect(layout.x).toBe(0);
    expect(layout.y).toBe(PREL_MENU_HEIGHT);
    expect(layout.width).toBeLessThanOrEqual(900);
    expect(layout.height).toBeLessThanOrEqual(700 - PREL_MENU_HEIGHT);
  });

  it('resizes floating windows from edges and corners', () => {
    const layout = { ...defaultFloatingLayout({ width: 1920, height: 1080 }), x: 600, y: 100 };
    const rightResized = resizeFloatingLayout(layout, 'right', 100, 0, { width: 1920, height: 1080 });
    const bottomResized = resizeFloatingLayout(layout, 'bottom', 0, 100, { width: 1920, height: 1080 });
    const cornerResized = resizeFloatingLayout(layout, 'bottom-right', 100, 100, { width: 1920, height: 1080 });

    expect(rightResized.width).toBe(584);
    expect(rightResized.height).toBe(756);
    expect(bottomResized.width).toBe(484);
    expect(bottomResized.height).toBe(856);
    expect(cornerResized.width).toBe(584);
    expect(cornerResized.height).toBe(856);
  });

  it('resizes floating windows from the top while preserving the lower edge', () => {
    const layout = defaultFloatingLayout({ width: 1920, height: 1080 });
    const bottom = layout.y + layout.height;
    const resized = resizeFloatingFromTop(layout, layout.y + 400, layout.height - 400, { width: 1920, height: 1080 });

    expect(resized.y + resized.height).toBe(bottom);
    expect(resized.height).toBe(484);
    expect(resized.y).toBe(bottom - 484);
  });

  it('does not let floating top resize cover the Prelude menu', () => {
    const layout = defaultFloatingLayout({ width: 1920, height: 1080 });
    const resized = resizeFloatingFromTop(layout, -500, layout.height + 500, { width: 1920, height: 1080 });

    expect(resized.y).toBeCloseTo(PREL_MENU_HEIGHT);
    expect(resized.height).toBeLessThanOrEqual(1080 - PREL_MENU_HEIGHT);
  });

  it('maximizes and restores the previous layout', () => {
    const floating = defaultFloatingLayout({ width: 1920, height: 1080 });
    const maximized = maximizeLayout(floating);

    expect(maximized.kind).toBe('maximized');
    expect(restoreLayout(maximized)).toEqual(floating);
  });
});

describe('AIAgentPiuRuntimeStore minimize/restore', () => {
  it('minimize sets minimized true and restores to false', async () => {
    const { aiAgentPiuRuntimeStore } = await import('../src/piu/runtimeStore.ts');
    aiAgentPiuRuntimeStore.openPanel();
    expect(aiAgentPiuRuntimeStore.getSnapshot().display.minimized).toBe(false);

    aiAgentPiuRuntimeStore.minimize();
    expect(aiAgentPiuRuntimeStore.getSnapshot().display.minimized).toBe(true);
    expect(aiAgentPiuRuntimeStore.getSnapshot().display.showPanel).toBe(true);
    expect(aiAgentPiuRuntimeStore.getSnapshot().display.showEntrance).toBe(true);

    aiAgentPiuRuntimeStore.restoreFromMinimized();
    expect(aiAgentPiuRuntimeStore.getSnapshot().display.minimized).toBe(false);
    expect(aiAgentPiuRuntimeStore.getSnapshot().display.showPanel).toBe(true);
  });

  it('minimize is a no-op when panel is hidden', async () => {
    const { aiAgentPiuRuntimeStore } = await import('../src/piu/runtimeStore.ts');
    aiAgentPiuRuntimeStore.display({ showEntrance: true, showPanel: false });
    expect(aiAgentPiuRuntimeStore.getSnapshot().display.showPanel).toBe(false);

    aiAgentPiuRuntimeStore.minimize();
    expect(aiAgentPiuRuntimeStore.getSnapshot().display.minimized).toBe(false);
    expect(aiAgentPiuRuntimeStore.getSnapshot().display.showPanel).toBe(false);
  });

  it('minimize force-closes expandPanel', async () => {
    const { aiAgentPiuRuntimeStore } = await import('../src/piu/runtimeStore.ts');
    const { expandPanelStore } = await import('../src/features/expand-panel/ExpandPanelStore.ts');
    aiAgentPiuRuntimeStore.openPanel();
    expandPanelStore.getState().open();
    expect(expandPanelStore.getState().isOpen).toBe(true);

    aiAgentPiuRuntimeStore.minimize();
    expect(expandPanelStore.getState().isOpen).toBe(false);
    expect(aiAgentPiuRuntimeStore.getSnapshot().display.minimized).toBe(true);

    aiAgentPiuRuntimeStore.restoreFromMinimized();
    expect(expandPanelStore.getState().isOpen).toBe(false);
  });
});

describe('normalizeDisplayState allows showEntrance=false + showPanel=true', () => {
  it('allows showEntrance=false + showPanel=true', () => {
    const result = normalizeDisplayState({ showEntrance: false, showPanel: true });
    expect(result).toEqual({ showEntrance: false, showPanel: true, minimized: false });
  });

  it('allows showEntrance=false + showPanel=true + minimized=true', () => {
    const result = normalizeDisplayState({ showEntrance: false, showPanel: true, minimized: true });
    expect(result).toEqual({ showEntrance: false, showPanel: true, minimized: true });
  });

  it('corrects minimized=true + showPanel=false', () => {
    const result = normalizeDisplayState({ showEntrance: true, showPanel: false, minimized: true });
    expect(result.minimized).toBe(false);
  });
});

describe('closePanel with closeBehavior', () => {
  it('closePanel calls minimize when closeBehavior is minimize', async () => {
    const { aiAgentPiuRuntimeStore } = await import('../src/piu/runtimeStore.ts');
    aiAgentPiuRuntimeStore.openPanel();
    aiAgentPiuRuntimeStore.setCloseBehavior('minimize');

    aiAgentPiuRuntimeStore.closePanel();
    expect(aiAgentPiuRuntimeStore.getSnapshot().display.minimized).toBe(true);
    expect(aiAgentPiuRuntimeStore.getSnapshot().display.showPanel).toBe(true);
  });

  it('closePanel hides panel when closeBehavior is hide (default)', async () => {
    const { aiAgentPiuRuntimeStore } = await import('../src/piu/runtimeStore.ts');
    aiAgentPiuRuntimeStore.openPanel();
    aiAgentPiuRuntimeStore.setCloseBehavior('hide');

    aiAgentPiuRuntimeStore.closePanel();
    expect(aiAgentPiuRuntimeStore.getSnapshot().display.showPanel).toBe(false);
  });

  it('closePanel hides panel when closeBehavior is not set', async () => {
    const { aiAgentPiuRuntimeStore } = await import('../src/piu/runtimeStore.ts');
    aiAgentPiuRuntimeStore.openPanel();

    aiAgentPiuRuntimeStore.closePanel();
    expect(aiAgentPiuRuntimeStore.getSnapshot().display.showPanel).toBe(false);
  });
});
