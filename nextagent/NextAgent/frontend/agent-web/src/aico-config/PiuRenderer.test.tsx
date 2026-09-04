import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { PiuRenderer } from './PiuRenderer.tsx';
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

function createMockPrel(autoLoadImpl?: () => Promise<void>) {
  return {
    ready: (cb: () => void) => cb(),
    autoLoad: vi.fn(autoLoadImpl ?? (async () => {})),
    start: vi.fn(),
  };
}

describe('PiuRenderer', () => {
  let originalPrel: typeof window.Prel;

  beforeEach(() => {
    originalPrel = window.Prel;
  });

  afterEach(() => {
    window.Prel = originalPrel;
    cleanup();
  });

  it('renders placeholder when Prel is unavailable', () => {
    window.Prel = undefined;
    const piuInfo = { piuName: 'widget', piuVersion: '1.0.0', renderFunc: 'render' };
    const { getByTestId } = render(
      <PiuContext.Provider value={{ piu: null, site: { locale: 'zh-cn', theme: 'lightday' } }}>
        <PiuRenderer piuInfo={piuInfo} />
      </PiuContext.Provider>,
    );
    expect(getByTestId('piu-renderer-placeholder')).toBeTruthy();
  });

  it('renders placeholder when piu is null but Prel is available', () => {
    window.Prel = createMockPrel() as unknown as typeof window.Prel;
    const piuInfo = { piuName: 'widget', piuVersion: '1.0.0', renderFunc: 'render' };
    const { getByTestId } = render(
      <PiuContext.Provider value={{ piu: null, site: { locale: 'zh-cn', theme: 'lightday' } }}>
        <PiuRenderer piuInfo={piuInfo} />
      </PiuContext.Provider>,
    );
    expect(getByTestId('piu-renderer-placeholder')).toBeTruthy();
  });

  it('calls autoLoad and emit when Prel and piu are available', async () => {
    const mockPiu = createMockPiu();
    const mockPrel = createMockPrel();
    window.Prel = mockPrel as unknown as typeof window.Prel;
    const piuInfo = { piuName: 'widget', piuVersion: '1.0.0', renderFunc: 'render', data: { foo: 'bar' } };
    render(
      <PiuContext.Provider value={{ piu: mockPiu, site: { locale: 'zh-cn', theme: 'lightday' } }}>
        <PiuRenderer piuInfo={piuInfo} theme="lightday" extraPayload={{ sessionId: 's1' }} />
      </PiuContext.Provider>,
    );
    await vi.waitFor(() => {
      expect(mockPrel.autoLoad).toHaveBeenCalledWith('widget', '1.0.0');
      expect(mockPiu.emit).toHaveBeenCalledWith(
        'render',
        expect.objectContaining({
          foo: 'bar',
          sessionId: 's1',
          theme: 'lightday',
          containerId: expect.any(String),
        }),
      );
    });
  });

  it('renders a container with an id', () => {
    const mockPiu = createMockPiu();
    const mockPrel = createMockPrel();
    window.Prel = mockPrel as unknown as typeof window.Prel;
    const piuInfo = { piuName: 'widget', piuVersion: '1.0.0', renderFunc: 'render' };
    const { container } = render(
      <PiuContext.Provider value={{ piu: mockPiu, site: { locale: 'zh-cn', theme: 'lightday' } }}>
        <PiuRenderer piuInfo={piuInfo} />
      </PiuContext.Provider>,
    );
    const el = container.querySelector('[data-testid="piu-renderer-container"]');
    expect(el).toBeTruthy();
    expect(el?.getAttribute('id')).toBeTruthy();
  });

  it('cleans up container DOM on unmount', async () => {
    const mockPiu = createMockPiu();
    const mockPrel = createMockPrel();
    window.Prel = mockPrel as unknown as typeof window.Prel;
    const piuInfo = { piuName: 'widget', piuVersion: '1.0.0', renderFunc: 'render' };
    const { container, unmount } = render(
      <PiuContext.Provider value={{ piu: mockPiu, site: { locale: 'zh-cn', theme: 'lightday' } }}>
        <PiuRenderer piuInfo={piuInfo} />
      </PiuContext.Provider>,
    );
    const el = container.querySelector('[data-testid="piu-renderer-container"]') as HTMLElement;
    el.appendChild(document.createElement('div'));
    expect(el.children.length).toBe(1);
    unmount();
    expect(el.children.length).toBe(0);
  });
});
