import type { ReactElement } from 'react';
import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { AppProviders } from '../src/app/AppProviders.tsx';
import type { HostMode, HostSiteContext } from '../src/app/hostTypes.ts';

function ensureMatchMedia(): void {
  if (typeof window === 'undefined' || typeof window.matchMedia === 'function') {
    return;
  }

  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }),
  });
}

export function renderWithAppProviders(
  ui: ReactElement,
  options?: {
    readonly mode?: HostMode;
    readonly route?: string;
    readonly site?: HostSiteContext;
    readonly withRouter?: boolean;
  },
) {
  ensureMatchMedia();
  const mode = options?.mode ?? 'local';
  const route = options?.route ?? '/';
  const wrap = (element: ReactElement) => (
    <AppProviders mode={mode} site={options?.site}>
      {options?.withRouter ? <MemoryRouter initialEntries={[route]}>{element}</MemoryRouter> : element}
    </AppProviders>
  );

  const result = render(wrap(ui));
  return {
    ...result,
    rerender: (nextUi: ReactElement) => result.rerender(wrap(nextUi)),
  };
}
