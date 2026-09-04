import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { CustomPanelRenderer } from './CustomPanelRenderer.tsx';
import { aicoConfigStore, resetAICOConfigStoreForTesting } from './AICOConfigStore.ts';
import { PiuContext } from '../features/chat/context/PiuContext.tsx';
import type { PIU } from '../host/prel.ts';

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
    emit: vi.fn(),
  };
}

function createMockPrel() {
  return {
    ready: (cb: () => void) => cb(),
    autoLoad: vi.fn(async () => {}),
    start: vi.fn(),
  };
}

describe('CustomPanelRenderer', () => {
  let originalPrel: typeof window.Prel;

  beforeEach(() => {
    originalPrel = window.Prel;
    resetAICOConfigStoreForTesting();
  });

  afterEach(() => {
    window.Prel = originalPrel;
    cleanup();
  });

  it('preserves PIU container content across re-render (stable extraPayload)', async () => {
    const mockPiu = createMockPiu();
    window.Prel = createMockPrel() as unknown as typeof window.Prel;

    aicoConfigStore.setConfig({ name: 'Test' });
    aicoConfigStore.setActivePanelOperator({ piuName: 'p', piuVersion: '1', renderFunc: 'r' });

    const { container, rerender } = render(
      <PiuContext.Provider value={{ piu: mockPiu, site: { locale: 'zh-cn', theme: 'lightday' } }}>
        <CustomPanelRenderer isDark={false} />
      </PiuContext.Provider>,
    );

    await vi.waitFor(() => {
      expect(mockPiu.emit).toHaveBeenCalledTimes(1);
    });

    // Simulate PIU content written into the container by the external renderFunc.
    const containerEl = container.querySelector('[data-testid="piu-renderer-container"]') as HTMLElement;
    containerEl.appendChild(document.createElement('div'));
    expect(containerEl.children.length).toBe(1);

    // Re-render with identical props -- simulates parent re-render during drag/resize
    // where isDark/theme haven't changed but the parent tree re-renders.
    rerender(
      <PiuContext.Provider value={{ piu: mockPiu, site: { locale: 'zh-cn', theme: 'lightday' } }}>
        <CustomPanelRenderer isDark={false} />
      </PiuContext.Provider>,
    );

    // Container content must survive re-render -- effect cleanup must not fire.
    const containerElAfter = container.querySelector('[data-testid="piu-renderer-container"]') as HTMLElement;
    expect(containerElAfter.children.length).toBe(1);
  });
});
