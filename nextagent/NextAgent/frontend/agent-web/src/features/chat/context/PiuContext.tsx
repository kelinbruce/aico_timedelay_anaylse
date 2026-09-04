import { createContext } from 'react';
import type { PIU } from '../../../host/prel.ts';
import type { HostSiteContext } from '../../../app/hostTypes.ts';
import { normalizeSiteContext } from '../../../host/prel.ts';

export interface PiuContextValue {
  readonly piu: PIU | null;
  readonly site: HostSiteContext;
}

const defaultSite = normalizeSiteContext(undefined);

export const PiuContext = createContext<PiuContextValue>({ piu: null, site: defaultSite });
