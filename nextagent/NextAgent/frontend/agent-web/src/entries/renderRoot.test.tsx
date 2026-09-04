import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup } from '@testing-library/react';

beforeEach(() => {
  document.cookie = 'locale=;expires=Thu, 01 Jan 1970 00:00:00 GMT';
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.resetModules();
  cleanup();
  document.body.replaceChildren();
  document.cookie = 'locale=;expires=Thu, 01 Jan 1970 00:00:00 GMT';
});

describe('renderRoot - RuntimeConfigError', () => {
  it('renders local mode error page in zh when cookie locale=zh-cn', async () => {
    vi.stubEnv('DEV', false);
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new Error('Network error'))),
    );
    document.cookie = 'locale=zh-cn';

    const { renderRoot } = await import('./renderRoot.tsx');

    const container = document.createElement('div');
    document.body.append(container);

    const onRuntimeConfigError = vi.fn();
    await act(async () => {
      await renderRoot(container, null, { mode: 'local', onRuntimeConfigError });
    });

    expect(onRuntimeConfigError).toHaveBeenCalledOnce();
    expect(container.textContent).toContain('服务不可用，请稍后重试');
    expect(container.textContent).toContain('重新加载');
  }, 15000);

  it('renders immersive mode error page in en when cookie locale=en-us', async () => {
    vi.stubEnv('DEV', false);
    document.cookie = 'locale=en-us';
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve({
          ok: false,
          status: 503,
          json: async () => ({}),
        } as Response),
      ),
    );

    const { renderRoot } = await import('./renderRoot.tsx');

    const container = document.createElement('div');
    document.body.append(container);

    await act(async () => {
      await renderRoot(container, null, { mode: 'immersive' });
    });

    expect(container.textContent).toContain('Service unavailable, please try again later.');
    expect(container.textContent).toContain('Retry');
  }, 15000);

  it('renders PIU disabled entrance without error page text', async () => {
    vi.stubEnv('DEV', false);
    document.cookie = 'locale=zh-cn';
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new Error('Network error'))),
    );

    const { renderRoot } = await import('./renderRoot.tsx');

    const container = document.createElement('div');
    container.style.width = '48px';
    container.style.height = '48px';
    document.body.append(container);

    await act(async () => {
      await renderRoot(container, null, { mode: 'piu' });
    });

    const button = container.querySelector('button[data-testid="ai-agent-entrance-disabled"]');
    expect(button).not.toBeNull();
    expect((button as HTMLButtonElement).style.cursor).toBe('not-allowed');
    expect((button as HTMLButtonElement).style.opacity).toBe('0.45');
    const img = container.querySelector('img');
    expect(img).not.toBeNull();
    expect(container.textContent).not.toContain('服务不可用，请稍后重试');
  }, 15000);
});
