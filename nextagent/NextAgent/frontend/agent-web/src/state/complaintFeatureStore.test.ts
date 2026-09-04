import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../services/complaintService.ts', () => ({
  complaintService: {
    fetchRiskConfig: vi.fn(),
  },
}));

import { complaintService } from '../services/complaintService.ts';
import { useComplaintFeatureStore, resetComplaintFeatureStoreForTesting } from './complaintFeatureStore.ts';

const mockFetch = vi.mocked(complaintService.fetchRiskConfig);

describe('complaintFeatureStore', () => {
  beforeEach(() => {
    mockFetch.mockReset();
    resetComplaintFeatureStoreForTesting();
  });

  it('starts idle with enabled=false', () => {
    const state = useComplaintFeatureStore.getState();
    expect(state.status).toBe('idle');
    expect(state.enabled).toBe(false);
    expect(state.records).toEqual([]);
  });

  it('probes successfully and sets enabled=true with records', async () => {
    const records = [{ id: '1', name_en: 'One', name_zh: '一' }];
    mockFetch.mockResolvedValue({ records });

    await useComplaintFeatureStore.getState().probe();

    const state = useComplaintFeatureStore.getState();
    expect(state.status).toBe('ready');
    expect(state.enabled).toBe(true);
    expect(state.records).toEqual(records);
  });

  it('probes failure sets enabled=false and status=failed', async () => {
    mockFetch.mockRejectedValue(new Error('network'));

    await useComplaintFeatureStore.getState().probe();

    const state = useComplaintFeatureStore.getState();
    expect(state.status).toBe('failed');
    expect(state.enabled).toBe(false);
    expect(state.records).toEqual([]);
  });

  it('does not re-probe when already ready', async () => {
    mockFetch.mockResolvedValue({ records: [] });
    await useComplaintFeatureStore.getState().probe();
    expect(mockFetch).toHaveBeenCalledOnce();

    await useComplaintFeatureStore.getState().probe();
    expect(mockFetch).toHaveBeenCalledOnce();
  });

  it('does not re-probe when already loading', async () => {
    let resolveProbe: (value: { records: never[] }) => void = () => {};
    mockFetch.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveProbe = resolve as typeof resolveProbe;
        }),
    );

    const first = useComplaintFeatureStore.getState().probe();
    const second = useComplaintFeatureStore.getState().probe();

    expect(mockFetch).toHaveBeenCalledOnce();

    resolveProbe({ records: [] });
    await Promise.all([first, second]);

    expect(useComplaintFeatureStore.getState().status).toBe('ready');
  });
});
