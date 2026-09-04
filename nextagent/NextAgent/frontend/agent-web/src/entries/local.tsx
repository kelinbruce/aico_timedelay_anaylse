import { useEffect, useState } from 'react';
import { App } from '../App.tsx';
import { renderRoot, requireRootElement } from './renderRoot.tsx';
import { installMockPrel, mockSite } from '../host/prel-mock.ts';
import { AI_AGENT_PIU_DEPS, AI_AGENT_PIU_NAME, getPrel } from '../host/prel.ts';
import { PiuContext, type PiuContextValue } from '../features/chat/context/PiuContext.tsx';
import { loadSessionStorageAICOConfig } from '../aico-config/loadSessionStorageAICOConfig.ts';
import { reportError } from '../utils/diagnostics.ts';

installMockPrel();
loadSessionStorageAICOConfig();

function LocalApp() {
  const [piuContext, setPiuContext] = useState<PiuContextValue>({ piu: null, site: mockSite });

  useEffect(() => {
    const prel = getPrel();
    prel.ready(() => {
      prel.start(AI_AGENT_PIU_NAME, __NEXTAGENT_PACKAGE_VERSION__, AI_AGENT_PIU_DEPS, (piu, site) => {
        setPiuContext({ piu, site });
      });
    });
  }, []);

  return (
    <PiuContext.Provider value={piuContext}>
      <App />
    </PiuContext.Provider>
  );
}

void renderRoot(requireRootElement(), <LocalApp />, {
  mode: 'local',
  onRuntimeConfigError: (error) => {
    reportError('[RuntimeConfig] Failed to load runtime bootstrap config', error);
  },
});
