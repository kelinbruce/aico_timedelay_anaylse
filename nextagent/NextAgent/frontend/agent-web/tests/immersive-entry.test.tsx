// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import type { Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PIU } from '../src/host/prel.ts';

interface ImmersiveHostHandlers {
  readonly switchLocale?: (locale: unknown) => void;
  readonly switchTheme?: (theme: unknown) => void;
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.resetModules();
  vi.unstubAllGlobals();
  vi.doUnmock('../src/app/ImmersiveApp.tsx');
  vi.doUnmock('../src/entries/renderRoot.tsx');
  document.body.replaceChildren();
  document.body.removeAttribute('data-nextagent-host-mode');
  document.body.removeAttribute('data-nextagent-prel-ready');
  delete window.Prel;
});

describe('immersive entry', () => {
  it('renders the full-height fallback without reserving menu space when Prel is unavailable', async () => {
    document.body.setAttribute('data-nextagent-host-mode', 'immersive');
    const root = document.createElement('div');
    root.id = 'root';
    document.body.append(root);

    const renderRootMock = vi.fn(async (container: HTMLElement, node: ReactNode) => {
      render(node, { container });
      return { render: vi.fn(), unmount: vi.fn() } as unknown as Root;
    });
    vi.doMock('../src/entries/renderRoot.tsx', () => ({
      renderRoot: renderRootMock,
      requireRootElement: () => root,
    }));
    vi.doMock('../src/app/ImmersiveApp.tsx', () => ({
      ImmersiveApp: () => <div data-testid="immersive-app" />,
    }));
    vi.stubGlobal('__NEXTAGENT_PACKAGE_VERSION__', '9.9.9-test');
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    await import('../src/entries/immersive.tsx');

    expect((await screen.findByTestId('immersive-host-unavailable')).style.height).toBe('100%');
    expect(screen.queryByTestId('immersive-app')).toBeNull();
    expect(document.body.hasAttribute('data-nextagent-prel-ready')).toBe(false);
    expect(renderRootMock).toHaveBeenCalledWith(root, expect.anything(), expect.objectContaining({ onRuntimeConfigError: expect.any(Function) }));
    expect(error).toHaveBeenCalledWith('[Prel] Failed to start immersive host frame', expect.any(Error));
  });

  it('updates the immersive app theme when the host switches theme without a refresh', async () => {
    document.body.setAttribute('data-nextagent-host-mode', 'immersive');
    const root = document.createElement('div');
    root.id = 'root';
    document.body.append(root);

    let handlers: ImmersiveHostHandlers = {};
    const renderRootMock = vi.fn(async (container: HTMLElement, node: ReactNode) => {
      const fakeRoot: Root = {
        render: (nextNode: ReactNode) => {
          render(nextNode, { container });
        },
        unmount: vi.fn(),
      } as unknown as Root;
      render(node, { container });
      return fakeRoot;
    });
    vi.doMock('../src/entries/renderRoot.tsx', () => ({
      renderRoot: renderRootMock,
      requireRootElement: () => root,
    }));
    vi.doMock('../src/app/ImmersiveApp.tsx', () => ({
      ImmersiveApp: ({ site }: { readonly site: { readonly theme?: string } }) => <div data-testid="immersive-app-theme">{site.theme}</div>,
    }));
    vi.stubGlobal('__NEXTAGENT_PACKAGE_VERSION__', '9.9.9-test');
    window.Prel = {
      ready: (callback: () => void) => callback(),
      autoLoad: vi.fn(async () => undefined),
      start: vi.fn((_name, _version, _deps, callback) => {
        callback(
          {
            id: 'ai-agent-piu',
            name: 'AFWebsitePIU',
            version: '9.9.9-test',
            config: {},
            deps: {},
            isBrowser: true,
            revs: { 'febs.regs': '1', 'febs.server': '1' },
            attach: (_piu: PIU, nextHandlers: Record<string, unknown>) => {
              handlers = nextHandlers as ImmersiveHostHandlers;
            },
            emit: vi.fn(),
          },
          { locale: 'zh-cn', theme: 'lightday' },
        );
      }),
    };

    await import('../src/entries/immersive.tsx');

    expect((await screen.findByTestId('immersive-app-theme')).textContent).toBe('lightday');

    const switchTheme = handlers.switchTheme;
    expect(typeof switchTheme).toBe('function');
    (switchTheme as (theme: unknown) => void)('evening');

    expect((await screen.findByTestId('immersive-app-theme')).textContent).toBe('evening');
    expect(renderRootMock).toHaveBeenCalledTimes(1);
  });

  it('updates the immersive app locale when the host switches locale without a refresh', async () => {
    document.body.setAttribute('data-nextagent-host-mode', 'immersive');
    const root = document.createElement('div');
    root.id = 'root';
    document.body.append(root);

    let handlers: ImmersiveHostHandlers = {};
    const renderRootMock = vi.fn(async (container: HTMLElement, node: ReactNode) => {
      const fakeRoot: Root = {
        render: (nextNode: ReactNode) => {
          render(nextNode, { container });
        },
        unmount: vi.fn(),
      } as unknown as Root;
      render(node, { container });
      return fakeRoot;
    });
    vi.doMock('../src/entries/renderRoot.tsx', () => ({
      renderRoot: renderRootMock,
      requireRootElement: () => root,
    }));
    vi.doMock('../src/app/ImmersiveApp.tsx', () => ({
      ImmersiveApp: ({ site }: { readonly site: { readonly locale?: string } }) => <div data-testid="immersive-app-locale">{site.locale}</div>,
    }));
    vi.stubGlobal('__NEXTAGENT_PACKAGE_VERSION__', '9.9.9-test');
    window.Prel = {
      ready: (callback: () => void) => callback(),
      autoLoad: vi.fn(async () => undefined),
      start: vi.fn((_name, _version, _deps, callback) => {
        callback(
          {
            id: 'ai-agent-piu',
            name: 'AFWebsitePIU',
            version: '9.9.9-test',
            config: {},
            deps: {},
            isBrowser: true,
            revs: { 'febs.regs': '1', 'febs.server': '1' },
            attach: (_piu: PIU, nextHandlers: Record<string, unknown>) => {
              handlers = nextHandlers as ImmersiveHostHandlers;
            },
            emit: vi.fn(),
          },
          { locale: 'zh-cn', theme: 'lightday' },
        );
      }),
    };

    await import('../src/entries/immersive.tsx');

    expect((await screen.findByTestId('immersive-app-locale')).textContent).toBe('zh-cn');

    const switchLocale = handlers.switchLocale;
    expect(typeof switchLocale).toBe('function');
    (switchLocale as (locale: unknown) => void)('en-us');

    expect((await screen.findByTestId('immersive-app-locale')).textContent).toBe('en-us');
    expect(renderRootMock).toHaveBeenCalledTimes(1);
  });
});
