import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PiuContext } from '../../../features/chat/context/PiuContext.tsx';
import { resetComplaintFeatureStoreForTesting, useComplaintFeatureStore } from '../../../state/complaintFeatureStore.ts';
import { ComplaintHistoryPage, ComplaintHistoryView } from './ComplaintHistoryView.tsx';

vi.mock('../../../app/AppProviders.tsx', () => ({
  useAppHostContext: () => ({ hostTheme: 'lightday' }),
}));

describe('ComplaintHistoryView', () => {
  const originalPrel = window.Prel;

  beforeEach(() => {
    resetComplaintFeatureStoreForTesting();
    window.Prel = undefined;
  });

  afterEach(() => {
    window.Prel = originalPrel;
    cleanup();
    resetComplaintFeatureStoreForTesting();
  });

  it('does not render when the complaint probe is disabled', () => {
    const { container } = render(
      <PiuContext.Provider value={{ piu: null, site: { locale: 'zh-cn', theme: 'lightday' } }}>
        <ComplaintHistoryView />
      </PiuContext.Provider>,
    );

    expect(container.innerHTML).toBe('');
  });

  it('renders the PIU placeholder without throwing when Prel is unavailable', () => {
    useComplaintFeatureStore.setState({ enabled: true, status: 'ready' });

    render(
      <PiuContext.Provider value={{ piu: null, site: { locale: 'zh-cn', theme: 'lightday' } }}>
        <ComplaintHistoryView />
      </PiuContext.Provider>,
    );

    expect(screen.getByTestId('piu-renderer-placeholder')).toBeTruthy();
    expect(screen.queryByTestId('page-layout-header')).toBeNull();
  });

  it('wraps page content with exactly one complaint history header', () => {
    useComplaintFeatureStore.setState({ enabled: true, status: 'ready' });

    render(
      <PiuContext.Provider value={{ piu: null, site: { locale: 'zh-cn', theme: 'lightday' } }}>
        <ComplaintHistoryPage />
      </PiuContext.Provider>,
    );

    expect(screen.getAllByRole('heading', { name: '投诉历史', level: 1 })).toHaveLength(1);
    expect(screen.getAllByTestId('page-layout-header')).toHaveLength(1);
    expect(screen.getByTestId('piu-renderer-placeholder')).toBeTruthy();
  });
});
