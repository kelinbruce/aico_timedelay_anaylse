import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  THEME_PREFERENCE_STORAGE_KEY,
  detectSystemTheme,
  getThemePreference,
  resolveThemePreference,
  setThemePreference,
} from '../src/config/themePreference.ts';

describe('theme preference', () => {
  afterEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it('falls back to system for missing or unknown stored values', () => {
    expect(getThemePreference()).toBe('system');

    localStorage.setItem(THEME_PREFERENCE_STORAGE_KEY, 'sepia');

    expect(getThemePreference()).toBe('system');
  });

  it('persists explicit theme preferences', () => {
    setThemePreference('dark');

    expect(localStorage.getItem(THEME_PREFERENCE_STORAGE_KEY)).toBe('dark');
    expect(getThemePreference()).toBe('dark');
  });

  it('resolves system preference from the active media query', () => {
    vi.spyOn(window, 'matchMedia').mockReturnValue({
      matches: true,
      media: '(prefers-color-scheme: dark)',
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    });

    expect(detectSystemTheme()).toBe('dark');
    expect(resolveThemePreference('system', 'light')).toBe('light');
    expect(resolveThemePreference('dark', 'light')).toBe('dark');
  });
});
