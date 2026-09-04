import type { SupportedLocale } from '../i18n/index.ts';
import type { ThemeMode } from '../config/themePreference.ts';

export type HostMode = 'local' | 'immersive' | 'piu';
export type HostTheme = 'lightday' | 'evening';
export type HostLocale = 'zh-cn' | 'en-us';

export interface HostSiteContext {
  readonly session?: { readonly csrfToken?: string } | undefined;
  readonly user?:
    | {
        readonly id?: string;
        readonly name?: string;
        readonly domain?: string;
        readonly oDomain?:
          | {
              readonly id: string;
              readonly name: string;
            }
          | undefined;
        readonly ops?: readonly string[] | null;
        readonly roles?: ReadonlyArray<{ readonly id: string; readonly name: string }>;
      }
    | undefined;
  readonly locale?: HostLocale | undefined;
  readonly theme?: HostTheme | undefined;
}

export function isHostTheme(value: unknown): value is HostTheme {
  return value === 'lightday' || value === 'evening';
}

export function isHostLocale(value: unknown): value is HostLocale {
  return value === 'zh-cn' || value === 'en-us';
}

export function hostThemeToThemeMode(theme: HostTheme): ThemeMode {
  return theme === 'evening' ? 'dark' : 'light';
}

export function themeModeToHostTheme(themeMode: ThemeMode): HostTheme {
  return themeMode === 'dark' ? 'evening' : 'lightday';
}

export function hostLocaleToSupportedLocale(locale: HostLocale): SupportedLocale {
  return locale === 'en-us' ? 'en-US' : 'zh-CN';
}

export function supportedLocaleToHostLocale(locale: SupportedLocale): HostLocale {
  return locale === 'en-US' ? 'en-us' : 'zh-cn';
}

export function normalizeHostTheme(value: unknown): HostTheme {
  return isHostTheme(value) ? value : 'lightday';
}

export function normalizeHostLocale(value: unknown): HostLocale {
  return isHostLocale(value) ? value : 'zh-cn';
}
