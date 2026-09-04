import type { ReactNode } from 'react';
import type { Root } from 'react-dom/client';
import { ImmersiveApp } from '../app/ImmersiveApp.tsx';
import {
  AI_AGENT_PIU_DEPS,
  IMMERSIVE_PIU_NAME,
  getPrel,
  isValidSwitchLocale,
  isValidSwitchTheme,
  normalizeSiteContext,
  type HostSiteContext,
} from '../host/prel.ts';
import { renderRoot, requireRootElement } from './renderRoot.tsx';
import { PiuContext, type PiuContextValue } from '../features/chat/context/PiuContext.tsx';
import { loadSessionStorageAICOConfig } from '../aico-config/loadSessionStorageAICOConfig.ts';
import { reportError, reportWarning } from '../utils/diagnostics.ts';

const rootElement = requireRootElement();
let activeSite: HostSiteContext = normalizeSiteContext(undefined);
loadSessionStorageAICOConfig();
let activePiuContext: PiuContextValue = { piu: null, site: activeSite };
let activeRoot: Root | null = null;
let activeRootPromise: Promise<Root> | null = null;

function createRootWithRuntimeConfig(node: ReactNode): Promise<Root> {
  return renderRoot(rootElement, node, {
    mode: 'immersive',
    onRuntimeConfigError: (error) => {
      reportError('[RuntimeConfig] Failed to load runtime bootstrap config', error);
    },
  });
}

function renderImmersiveApp(site: HostSiteContext): void {
  activeSite = normalizeSiteContext(site);
  activePiuContext = { ...activePiuContext, site: activeSite };

  if (activeRoot) {
    activeRoot.render(
      <PiuContext.Provider value={activePiuContext}>
        <ImmersiveApp site={activeSite} />
      </PiuContext.Provider>,
    );
    return;
  }

  if (!activeRootPromise) {
    activeRootPromise = createRootWithRuntimeConfig(
      <PiuContext.Provider value={activePiuContext}>
        <ImmersiveApp site={activeSite} />
      </PiuContext.Provider>,
    ).then((root) => {
      activeRoot = root;
      return root;
    });
    return;
  }

  void activeRootPromise.then((root) => {
    activeRoot = root;
    root.render(
      <PiuContext.Provider value={activePiuContext}>
        <ImmersiveApp site={activeSite} />
      </PiuContext.Provider>,
    );
  });
}

function renderPreludeUnavailable(error: unknown): void {
  document.body.removeAttribute('data-nextagent-prel-ready');
  reportError('[Prel] Failed to start immersive host frame', error);
  void createRootWithRuntimeConfig(<ImmersiveHostUnavailable />);
}

try {
  const prel = getPrel();
  prel.ready(async () => {
    await prel.autoLoad({ refr: '*' });
    try {
      prel.start(IMMERSIVE_PIU_NAME, __NEXTAGENT_PACKAGE_VERSION__, AI_AGENT_PIU_DEPS, (piu, site) => {
        document.body.setAttribute('data-nextagent-prel-ready', 'true');
        activePiuContext = { piu, site: normalizeSiteContext(site) };
        renderImmersiveApp(site);
        const handleThemeChange = (theme: unknown): void => {
          if (!isValidSwitchTheme(theme)) {
            reportWarning("[ImmersiveHost] Unsupported theme. Expected 'lightday' or 'evening'.");
            return;
          }
          renderImmersiveApp({ ...activeSite, theme });
        };
        const handleLocaleChange = (locale: unknown): void => {
          if (!isValidSwitchLocale(locale)) {
            reportWarning("[ImmersiveHost] Unsupported locale. Expected 'zh-cn' or 'en-us'.");
            return;
          }
          renderImmersiveApp({ ...activeSite, locale });
        };
        piu.attach(piu, {
          $stateChange: {
            theme: (newValue: unknown) => {
              handleThemeChange(newValue);
            },
            locale: (newValue: unknown) => {
              handleLocaleChange(newValue);
            },
          },
          switchLocale: (locale: unknown) => {
            handleLocaleChange(locale);
          },
          switchTheme: (theme: unknown) => {
            handleThemeChange(theme);
          },
        });
      });
    } catch (error) {
      renderPreludeUnavailable(error);
    }
  });
} catch (error) {
  renderPreludeUnavailable(error);
}

function ImmersiveHostUnavailable() {
  return (
    <main
      data-testid="immersive-host-unavailable"
      style={{
        alignItems: 'center',
        boxSizing: 'border-box',
        color: 'var(--color-text-secondary, #667085)',
        display: 'grid',
        fontFamily: 'var(--font-family-app)',
        height: '100%',
        justifyItems: 'center',
        padding: 24,
        width: '100%',
      }}
    >
      Product framework unavailable.
    </main>
  );
}
