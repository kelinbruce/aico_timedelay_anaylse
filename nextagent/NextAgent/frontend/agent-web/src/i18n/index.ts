import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import dayjs from 'dayjs';
import 'dayjs/locale/en';
import 'dayjs/locale/zh-cn';
import { enUS } from './resources/en-US.ts';
import { zhCN } from './resources/zh-CN.ts';

export const LOCALE_PREFERENCE_STORAGE_KEY = 'nextagent.localePreference';
const LEGACY_LOCALE_PREFERENCE_STORAGE_KEY = 'adnclaw.localePreference';

export const supportedLocales = ['zh-CN', 'en-US'] as const;
export type SupportedLocale = (typeof supportedLocales)[number];
export type LocalePreference = 'system' | SupportedLocale;

const DEFAULT_LOCALE: SupportedLocale = 'zh-CN';

export function normalizeLocale(locale?: string | null): SupportedLocale | null {
  if (!locale) {
    return null;
  }
  const normalized = locale.replace('_', '-').toLowerCase();
  if (normalized === 'zh' || normalized.startsWith('zh-')) {
    return 'zh-CN';
  }
  if (normalized === 'en' || normalized.startsWith('en-')) {
    return 'en-US';
  }
  return null;
}

function supportedLocaleToDayjsLocale(locale: SupportedLocale): string {
  switch (locale) {
    case 'zh-CN':
      return 'zh-cn';
    case 'en-US':
      return 'en';
    default: {
      const exhaustive: never = locale;
      throw new Error(`Unhandled case: ${String(exhaustive)}`);
    }
  }
}

function applyDayjsLocale(locale: SupportedLocale): void {
  dayjs.locale(supportedLocaleToDayjsLocale(locale));
}

export function detectBrowserLocale(): SupportedLocale {
  if (typeof navigator === 'undefined') {
    return DEFAULT_LOCALE;
  }
  const candidates = [...Array.from(navigator.languages ?? []), navigator.language];
  for (const candidate of candidates) {
    const locale = normalizeLocale(candidate);
    if (locale) {
      return locale;
    }
  }
  return DEFAULT_LOCALE;
}

function isLocalePreference(value: string | null): value is LocalePreference {
  return value === 'system' || value === 'zh-CN' || value === 'en-US';
}

export function getLocalePreference(): LocalePreference {
  if (typeof localStorage === 'undefined') {
    return 'system';
  }
  try {
    const stored = localStorage.getItem(LOCALE_PREFERENCE_STORAGE_KEY) ?? localStorage.getItem(LEGACY_LOCALE_PREFERENCE_STORAGE_KEY);
    return isLocalePreference(stored) ? stored : 'system';
  } catch {
    return 'system';
  }
}

function writeLocalePreference(preference: LocalePreference): void {
  if (typeof localStorage === 'undefined') {
    return;
  }
  try {
    localStorage.setItem(LOCALE_PREFERENCE_STORAGE_KEY, preference);
    localStorage.removeItem(LEGACY_LOCALE_PREFERENCE_STORAGE_KEY);
  } catch {
    // A blocked localStorage should not break the application shell.
  }
}

export function resolveLocalePreference(preference: LocalePreference): SupportedLocale {
  return preference === 'system' ? detectBrowserLocale() : preference;
}

function applyDocumentLocale(locale: SupportedLocale): void {
  if (typeof document === 'undefined') {
    return;
  }
  document.documentElement.lang = locale;
}

export function getCurrentLocale(): SupportedLocale {
  return normalizeLocale(i18n.resolvedLanguage) ?? normalizeLocale(i18n.language) ?? resolveLocalePreference(getLocalePreference());
}

export async function setLocalePreference(preference: LocalePreference): Promise<void> {
  writeLocalePreference(preference);
  const locale = resolveLocalePreference(preference);
  await i18n.changeLanguage(locale);
  applyDocumentLocale(locale);
}

const initialLocale = resolveLocalePreference(getLocalePreference());

void i18n.use(initReactI18next).init({
  resources: {
    'zh-CN': { translation: zhCN },
    'en-US': { translation: enUS },
  },
  lng: initialLocale,
  fallbackLng: DEFAULT_LOCALE,
  initAsync: false,
  showSupportNotice: false,
  interpolation: {
    escapeValue: false,
  },
  react: {
    useSuspense: false,
  },
});

applyDocumentLocale(initialLocale);
applyDayjsLocale(initialLocale);

i18n.on('languageChanged', (language) => {
  const locale = normalizeLocale(language) ?? DEFAULT_LOCALE;
  applyDocumentLocale(locale);
  applyDayjsLocale(locale);
});

if (typeof window !== 'undefined') {
  window.addEventListener('languagechange', () => {
    if (getLocalePreference() !== 'system') {
      return;
    }
    void i18n.changeLanguage(detectBrowserLocale());
  });
}

export default i18n;
