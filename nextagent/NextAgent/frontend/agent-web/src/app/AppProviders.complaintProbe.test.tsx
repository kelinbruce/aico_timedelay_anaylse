import { cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const probe = vi.hoisted(() => vi.fn(async () => undefined));

vi.mock('../state/complaintFeatureStore.ts', () => ({
  useComplaintFeatureStore: {
    getState: () => ({ probe }),
  },
}));

import { AppProviders } from './AppProviders.tsx';

describe('AppProviders complaint probe', () => {
  afterEach(() => {
    cleanup();
    probe.mockClear();
  });

  it('starts the shared complaint capability probe once', async () => {
    render(
      <AppProviders mode="local">
        <div>content</div>
      </AppProviders>,
    );

    await waitFor(() => expect(probe).toHaveBeenCalledOnce());
  });
});
