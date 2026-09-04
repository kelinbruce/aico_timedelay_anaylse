import type { Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
  vi.unstubAllGlobals();
  document.body.replaceChildren();
  delete window.Prel;
});

describe('AICOConfig entry loading', () => {
  it.each(['local', 'immersive'] as const)('loads the %s sessionStorage snapshot exactly once before rendering', async (mode) => {
    const rootElement = document.createElement('div');
    rootElement.id = 'root';
    document.body.append(rootElement);

    const loadSessionStorageAICOConfig = vi.fn();
    const renderRoot = vi.fn(async () => ({ render: vi.fn(), unmount: vi.fn() }) as unknown as Root);
    vi.doMock('../aico-config/loadSessionStorageAICOConfig.ts', () => ({ loadSessionStorageAICOConfig }));
    vi.doMock('./renderRoot.tsx', () => ({
      renderRoot,
      requireRootElement: () => rootElement,
    }));
    vi.doMock('../App.tsx', () => ({ App: () => null }));
    vi.doMock('../app/ImmersiveApp.tsx', () => ({ ImmersiveApp: () => null }));
    vi.doMock('../host/prel-mock.ts', () => ({ installMockPrel: vi.fn(), mockSite: {} }));
    vi.doMock('../host/prel.ts', () => ({
      AI_AGENT_PIU_DEPS: [],
      AI_AGENT_PIU_NAME: 'AICOPIU',
      IMMERSIVE_PIU_NAME: 'AFWebsitePIU',
      getPrel: () => {
        throw new Error('prelude unavailable in entry-loading test');
      },
      isValidSwitchLocale: () => false,
      isValidSwitchTheme: () => false,
      normalizeSiteContext: () => ({}),
    }));
    vi.stubGlobal('__NEXTAGENT_PACKAGE_VERSION__', '9.9.9-test');
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    if (mode === 'local') {
      await import('./local.tsx');
      await import('./local.tsx');
    } else {
      await import('./immersive.tsx');
      await import('./immersive.tsx');
    }

    expect(loadSessionStorageAICOConfig).toHaveBeenCalledTimes(1);
    expect(renderRoot).toHaveBeenCalledTimes(1);
    expect(loadSessionStorageAICOConfig.mock.invocationCallOrder[0]).toBeLessThan(renderRoot.mock.invocationCallOrder[0] ?? 0);
  });
});
