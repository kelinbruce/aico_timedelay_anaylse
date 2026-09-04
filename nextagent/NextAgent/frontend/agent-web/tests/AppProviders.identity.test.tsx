// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/state/complaintFeatureStore.ts', () => ({
  useComplaintFeatureStore: {
    getState: () => ({ probe: vi.fn() }),
  },
}));

import { AppProviders } from '../src/app/AppProviders.tsx';
import { apiClient } from '../src/services/apiClient.ts';

describe('AppProviders request identity defaults', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ({}),
      })),
    );
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it.each(['immersive', 'piu'] as const)('keeps the existing request identity defaults when %s host user is unavailable', async (mode) => {
    render(
      <AppProviders mode={mode} site={{}}>
        <div />
      </AppProviders>,
    );

    await apiClient.get('/api/v1/memory/long-term-mem');
    expect(lastRequestHeaders()).toMatchObject({
      'x-tenant-id': 'tenant-1',
      'x-subject-id': 'subject-1',
      'x-display-name': 'Local operator',
    });
  });

  it('keeps the local authenticated identity defaults', async () => {
    render(
      <AppProviders mode="local">
        <div />
      </AppProviders>,
    );

    await apiClient.get('/api/v1/memory/long-term-mem');
    expect(lastRequestHeaders()).toMatchObject({
      'x-tenant-id': 'tenant-1',
      'x-subject-id': 'subject-1',
      'x-display-name': 'Local operator',
    });
  });
});

function lastRequestHeaders(): Record<string, string> {
  const calls = vi.mocked(fetch).mock.calls;
  return (calls[calls.length - 1]?.[1]?.headers ?? {}) as Record<string, string>;
}
