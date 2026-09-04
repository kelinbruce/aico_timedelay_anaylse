import { normalizeSiteContext, type HostSiteContext, type PIU, type Prel } from './prel.ts';
import { renderLocalMockPiu } from './prel-mock-piu-renderers.ts';
import { reportDebug } from '../utils/diagnostics.ts';

export const mockSite: HostSiteContext = normalizeSiteContext({
  session: {},
  user: { id: 'local-user', name: 'Local User', ops: null, roles: [] },
  locale: 'zh-cn',
  theme: 'lightday',
});

export const mockPiu: PIU = {
  id: 'mock-piu',
  name: 'AICOPIU',
  version: '0.0.0-mock',
  config: {},
  deps: [],
  isBrowser: true,
  revs: { 'febs.regs': 'mock', 'febs.server': 'mock' },
  attach: () => {},
  emit: (key, state) => {
    if (!renderLocalMockPiu(key, state)) {
      reportDebug(`[PiuMock] emit("${key}") no-op`);
    }
  },
};

export const mockPrel: Prel = {
  ready: (cb) => cb(),
  autoLoad: () => Promise.resolve(),
  start: (_name, _version, _deps, cb) => {
    cb(mockPiu, mockSite);
  },
};

export function installMockPrel(): void {
  if (!window.Prel) {
    window.Prel = mockPrel;
  }
}
