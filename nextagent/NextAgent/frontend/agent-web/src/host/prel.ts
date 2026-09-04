import { isHostLocale, normalizeHostLocale, normalizeHostTheme, type HostLocale, type HostSiteContext, type HostTheme } from '../app/hostTypes.ts';

export type { HostSiteContext } from '../app/hostTypes.ts';

export interface PIU {
  readonly id: string;
  readonly name: string;
  readonly version: string;
  readonly config: unknown;
  readonly deps: unknown;
  readonly isBrowser: boolean;
  readonly revs: { readonly 'febs.regs': string; readonly 'febs.server': string };
  attach: (
    piu: PIU,
    handlers: {
      $stateChange?: Record<string, (newValue: unknown, oldValue: unknown) => void>;
      userAction?: {
        febsMemuEvent?: (params: { event: string; type: string }) => void;
        logout?: () => void;
      };
      switchLocale?: (locale: unknown) => void;
      switchTheme?: (theme: unknown) => void;
    },
  ) => void;
  emit: (key: string, state?: unknown) => void;
}

export interface Prel {
  ready: (callback: () => void) => void;
  autoLoad: ((packages: Record<string, string>) => Promise<void>) & ((name: string, version: string) => Promise<void>);
  start: (name: string, version: string, deps: readonly string[], callback: (piu: PIU, site: HostSiteContext) => void) => void;
}

export const AI_AGENT_PIU_NAME = 'AICOPIU';
export const IMMERSIVE_PIU_NAME = 'AFWebsitePIU';
export const AI_AGENT_PIU_DEPS = ['session', 'user', 'locale', 'theme'] as const;
export const PRELUDE_LOADER_PATH = '/febs/v1/assets/prelude-loader';
export const NON_LOCAL_LOGIN_URL = '/login-url';

declare global {
  interface Window {
    Prel?: Prel | undefined;
  }
}

export function getPrel(): Prel {
  if (!window.Prel) {
    throw new Error('Prel is not available. Ensure /febs/v1/assets/prelude-loader is loaded first.');
  }
  return window.Prel;
}

export function normalizeSiteContext(site?: HostSiteContext | null): HostSiteContext {
  return {
    session: site?.session,
    user: site?.user,
    locale: normalizeHostLocale(site?.locale),
    theme: normalizeHostTheme(site?.theme),
  };
}

export function isValidSwitchTheme(value: unknown): value is HostTheme {
  return value === 'lightday' || value === 'evening';
}

export function isValidSwitchLocale(value: unknown): value is HostLocale {
  return isHostLocale(value);
}
