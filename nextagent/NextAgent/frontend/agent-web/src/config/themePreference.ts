export const THEME_PREFERENCE_STORAGE_KEY = 'nextagent.themePreference';

export const THEME_PREFERENCES = ['system', 'light', 'dark'] as const;
export type ThemePreference = (typeof THEME_PREFERENCES)[number];
export type ThemeMode = Exclude<ThemePreference, 'system'>;

export function isThemePreference(value: string | null): value is ThemePreference {
  return THEME_PREFERENCES.includes(value as ThemePreference);
}

export function detectSystemTheme(): ThemeMode {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return 'light';
  }
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function resolveThemePreference(preference: ThemePreference, systemTheme = detectSystemTheme()): ThemeMode {
  return preference === 'system' ? systemTheme : preference;
}

export function getThemePreference(): ThemePreference {
  if (typeof localStorage === 'undefined') {
    return 'system';
  }
  try {
    const stored = localStorage.getItem(THEME_PREFERENCE_STORAGE_KEY);
    return isThemePreference(stored) ? stored : 'system';
  } catch {
    return 'system';
  }
}

export function setThemePreference(preference: ThemePreference): void {
  if (typeof localStorage === 'undefined') {
    return;
  }
  try {
    localStorage.setItem(THEME_PREFERENCE_STORAGE_KEY, preference);
  } catch {
    // A blocked localStorage should not break theme selection.
  }
}
