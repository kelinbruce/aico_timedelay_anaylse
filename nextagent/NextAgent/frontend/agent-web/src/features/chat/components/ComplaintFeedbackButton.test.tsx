import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetComplaintFeatureStoreForTesting, useComplaintFeatureStore } from '../../../state/complaintFeatureStore.ts';
import { ComplaintFeedbackButton } from './ComplaintFeedbackButton.tsx';

describe('ComplaintFeedbackButton', () => {
  beforeEach(() => {
    resetComplaintFeatureStoreForTesting();
  });

  afterEach(() => {
    cleanup();
    resetComplaintFeatureStoreForTesting();
  });

  it('does not render before the complaint probe is enabled', () => {
    render(<ComplaintFeedbackButton onOpenComplaint={vi.fn()} />);

    expect(screen.queryByTestId('btn-complaint-feedback')).toBeNull();
  });

  it('renders when enabled and opens the complaint dialog', () => {
    const onOpenComplaint = vi.fn();
    useComplaintFeatureStore.setState({ enabled: true, status: 'ready' });

    render(<ComplaintFeedbackButton onOpenComplaint={onOpenComplaint} />);
    fireEvent.click(screen.getByTestId('btn-complaint-feedback'));

    expect(onOpenComplaint).toHaveBeenCalledOnce();
  });
});
