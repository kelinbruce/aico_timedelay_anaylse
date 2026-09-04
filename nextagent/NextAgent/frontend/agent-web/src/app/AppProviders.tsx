import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { ConfigProvider, message, theme } from 'antd';
import enUS from 'antd/locale/en_US';
import zhCN from 'antd/locale/zh_CN';
import { useTranslation } from 'react-i18next';
import { default as i18n, getCurrentLocale, type SupportedLocale } from '../i18n/index.ts';
import {
  detectSystemTheme,
  getThemePreference,
  resolveThemePreference,
  setThemePreference,
  type ThemeMode,
  type ThemePreference,
} from '../config/themePreference.ts';
import { setCsrfToken, setTenantId, setSubjectId, setDisplayName } from '../services/apiClient.ts';
import { useComplaintFeatureStore } from '../state/complaintFeatureStore.ts';
import {
  hostLocaleToSupportedLocale,
  hostThemeToThemeMode,
  normalizeHostLocale,
  normalizeHostTheme,
  themeModeToHostTheme,
  type HostMode,
  type HostSiteContext,
  type HostTheme,
} from './hostTypes.ts';
import '../styles/theme.css';

// Host environments render a ~64px header at the top of the viewport with a
// very high z-index that cannot be surpassed from within the embedded app.
// Pushing message notifications below the header height keeps them visible.
const HOST_HEADER_HEIGHT = 64;

const antdLocaleByAppLocale: Record<SupportedLocale, typeof zhCN> = {
  'zh-CN': zhCN,
  'en-US': enUS,
};

interface AppHostContextValue {
  readonly mode: HostMode;
  readonly site?: HostSiteContext | undefined;
  readonly themePreference: ThemePreference;
  readonly themeMode: ThemeMode;
  readonly hostTheme: HostTheme;
  readonly setLocalThemePreference: (preference: ThemePreference) => void;
  readonly switchHostTheme: (theme: HostTheme) => void;
}

export const AppHostContext = createContext<AppHostContextValue | null>(null);

export interface AppProvidersProps {
  readonly mode: HostMode;
  readonly site?: HostSiteContext | undefined;
  readonly children: ReactNode;
}

export function AppProviders({ mode, site, children }: AppProvidersProps) {
  useTranslation();
  const [themePreference, setThemePreferenceState] = useState<ThemePreference>(() => getThemePreference());
  const [systemTheme, setSystemTheme] = useState<ThemeMode>(() => detectSystemTheme());
  const [hostTheme, setHostTheme] = useState<HostTheme>(() => normalizeHostTheme(site?.theme));
  const localThemeMode = resolveThemePreference(themePreference, systemTheme);
  const themeMode = mode === 'local' ? localThemeMode : hostThemeToThemeMode(hostTheme);
  const locale = getCurrentLocale();

  useEffect(() => {
    if (mode === 'local' || !site?.theme) {
      return;
    }
    setHostTheme(normalizeHostTheme(site.theme));
  }, [mode, site?.theme]);

  useMemo(() => {
    const user = mode === 'local' || !site?.user ? null : site.user;
    setTenantId(user?.oDomain?.id ?? 'tenant-1');
    setSubjectId(user?.id ?? 'subject-1');
    setDisplayName(user?.name ?? 'Local operator');
  }, [mode, site?.user]);

  useEffect(() => {
    if (mode !== 'local' && site?.session?.csrfToken) {
      setCsrfToken(site.session.csrfToken);
    } else {
      setCsrfToken(null);
    }
  }, [mode, site?.session?.csrfToken]);

  useEffect(() => {
    if (mode === 'local') {
      return;
    }
    void i18n.changeLanguage(hostLocaleToSupportedLocale(normalizeHostLocale(site?.locale)));
  }, [mode, site?.locale]);

  useEffect(() => {
    if (mode !== 'local' || typeof window.matchMedia !== 'function') {
      return undefined;
    }
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = (event: MediaQueryListEvent) => {
      setSystemTheme(event.matches ? 'dark' : 'light');
    };
    setSystemTheme(mediaQuery.matches ? 'dark' : 'light');
    mediaQuery.addEventListener('change', handler);
    return () => mediaQuery.removeEventListener('change', handler);
  }, [mode]);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', mode === 'local' ? themeMode : hostTheme);
  }, [hostTheme, mode, themeMode]);

  useEffect(() => {
    message.config({ top: HOST_HEADER_HEIGHT });
  }, []);

  useEffect(() => {
    void useComplaintFeatureStore.getState().probe();
  }, []);

  const handleLocalThemePreferenceChange = useCallback((nextPreference: ThemePreference) => {
    setThemePreference(nextPreference);
    setThemePreferenceState(nextPreference);
  }, []);

  const handleHostThemeChange = useCallback((nextTheme: HostTheme) => {
    setHostTheme(nextTheme);
  }, []);

  const value = useMemo<AppHostContextValue>(
    () => ({
      mode,
      site,
      themePreference,
      themeMode,
      hostTheme: mode === 'local' ? themeModeToHostTheme(themeMode) : hostTheme,
      setLocalThemePreference: handleLocalThemePreferenceChange,
      switchHostTheme: handleHostThemeChange,
    }),
    [handleHostThemeChange, handleLocalThemePreferenceChange, hostTheme, mode, site, themeMode, themePreference],
  );

  return (
    <AppHostContext.Provider value={value}>
      <ConfigProvider
        locale={antdLocaleByAppLocale[locale]}
        theme={{
          algorithm: themeMode === 'dark' ? theme.darkAlgorithm : theme.defaultAlgorithm,
          token: {
            fontSize: 15,
            fontFamily: 'var(--font-family-app)',
            // Must exceed host chrome z-index in collaborative and immersive hosts.
            zIndexPopupBase: 100000,
          },
        }}
      >
        {children}
      </ConfigProvider>
    </AppHostContext.Provider>
  );
}

export function useAppHostContext(): AppHostContextValue {
  const context = useContext(AppHostContext);
  if (!context) {
    throw new Error('useAppHostContext must be used inside AppProviders.');
  }
  return context;
}
