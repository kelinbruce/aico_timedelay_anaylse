import { create } from 'zustand';
import { complaintService, type ComplaintRiskRecord } from '../services/complaintService.ts';

export type ComplaintFeatureStatus = 'idle' | 'loading' | 'ready' | 'failed';

export interface ComplaintFeatureState {
  readonly enabled: boolean;
  readonly records: readonly ComplaintRiskRecord[];
  readonly status: ComplaintFeatureStatus;
  probe: () => Promise<void>;
}

export const useComplaintFeatureStore = create<ComplaintFeatureState>((set, get) => ({
  enabled: false,
  records: [],
  status: 'idle',
  probe: async () => {
    if (get().status === 'ready' || get().status === 'loading') {
      return;
    }
    set({ status: 'loading' });
    try {
      const config = await complaintService.fetchRiskConfig();
      set({ enabled: true, records: config.records, status: 'ready' });
    } catch {
      set({ enabled: false, records: [], status: 'failed' });
    }
  },
}));

export function resetComplaintFeatureStoreForTesting(): void {
  useComplaintFeatureStore.setState({ enabled: false, records: [], status: 'idle' });
}
