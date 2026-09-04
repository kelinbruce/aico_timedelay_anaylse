import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { message } from 'antd';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import i18n from '../../../i18n/index.ts';
import { complaintService } from '../../../services/complaintService.ts';
import { resetComplaintFeatureStoreForTesting, useComplaintFeatureStore } from '../../../state/complaintFeatureStore.ts';
import { ComplaintDialog } from './ComplaintDialog.tsx';

const testState = vi.hoisted(() => ({
  hostContext: {
    mode: 'piu',
    site: { user: { id: 'remote-user' } },
  } as {
    mode: 'local' | 'piu';
    site?: { user?: { id?: string } };
  },
}));

vi.mock('../../../app/AppProviders.tsx', () => ({
  useAppHostContext: () => testState.hostContext,
}));

vi.mock('../../../services/complaintService.ts', () => ({
  complaintService: {
    fetchRiskConfig: vi.fn(),
    createReport: vi.fn(),
  },
}));

const createReportMock = vi.mocked(complaintService.createReport);
const records = [
  { id: '1', name_en: 'Incorrect diagnosis', name_zh: '诊断错误' },
  { id: '8', name_en: 'Other', name_zh: '其他' },
];

function renderDialog(onClose = vi.fn()) {
  return {
    onClose,
    ...render(<ComplaintDialog open alogCard={'[Q]why\n[A]answer'} onClose={onClose} />),
  };
}

describe('ComplaintDialog', () => {
  beforeEach(async () => {
    resetComplaintFeatureStoreForTesting();
    useComplaintFeatureStore.setState({ enabled: true, records, status: 'ready' });
    createReportMock.mockReset();
    createReportMock.mockResolvedValue(undefined);
    testState.hostContext = { mode: 'piu', site: { user: { id: 'remote-user' } } };
    vi.spyOn(message, 'success');
    vi.spyOn(message, 'error');
    await i18n.changeLanguage('zh-CN');
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    resetComplaintFeatureStoreForTesting();
  });

  it('renders localized risk names and requires a selection', () => {
    renderDialog();

    expect(screen.getByText('诊断错误')).toBeTruthy();
    expect((screen.getByTestId('complaint-submit') as HTMLButtonElement).disabled).toBe(true);
  });

  it('renders English risk names for the English locale', async () => {
    await i18n.changeLanguage('en-US');
    renderDialog();

    expect(screen.getByText('Incorrect diagnosis')).toBeTruthy();
  });

  it('shows a loading state while complaint types are loading', () => {
    useComplaintFeatureStore.setState({ enabled: true, records: [], status: 'loading' });

    renderDialog();

    expect(screen.getByText(i18n.t('complaint.loading'))).toBeTruthy();
  });

  it('shows a failure state when complaint types fail to load', async () => {
    vi.mocked(complaintService.fetchRiskConfig).mockRejectedValueOnce(new Error('network'));
    useComplaintFeatureStore.setState({ enabled: false, records: [], status: 'failed' });

    renderDialog();

    expect(await screen.findByText(i18n.t('complaint.loadFailed'))).toBeTruthy();
  });

  it('requires detail for reason 8 and rejects leading whitespace', () => {
    renderDialog();
    fireEvent.click(screen.getByTestId('complaint-type-8'));
    expect((screen.getByTestId('complaint-submit') as HTMLButtonElement).disabled).toBe(true);

    fireEvent.change(screen.getByTestId('complaint-detail'), {
      target: { value: ' starts with whitespace' },
    });

    expect((screen.getByTestId('complaint-submit') as HTMLButtonElement).disabled).toBe(true);
    expect(createReportMock).not.toHaveBeenCalled();
  });

  it('rejects complaint detail longer than 2600 characters', () => {
    renderDialog();
    fireEvent.click(screen.getByTestId('complaint-type-1'));
    fireEvent.change(screen.getByTestId('complaint-detail'), {
      target: { value: 'x'.repeat(2601) },
    });

    expect((screen.getByTestId('complaint-submit') as HTMLButtonElement).disabled).toBe(true);
    expect(createReportMock).not.toHaveBeenCalled();
  });

  it('submits the remote user payload and closes on success', async () => {
    const { onClose } = renderDialog();
    fireEvent.click(screen.getByTestId('complaint-type-1'));
    fireEvent.change(screen.getByTestId('complaint-detail'), {
      target: { value: 'diagnosis is inaccurate' },
    });
    fireEvent.click(screen.getByTestId('complaint-submit'));

    await waitFor(() => expect(createReportMock).toHaveBeenCalledOnce());
    expect(createReportMock.mock.calls[0]?.[0]).toEqual({
      alog_card: '[Q]why\n[A]answer',
      tenant_id: '',
      user_id: 'remote-user',
      reason_id: '1',
      reason_detail: 'diagnosis is inaccurate',
    });
    expect(message.success).toHaveBeenCalledOnce();
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('uses the local fallback user id', async () => {
    testState.hostContext = { mode: 'local' };
    renderDialog();
    fireEvent.click(screen.getByTestId('complaint-type-1'));
    fireEvent.click(screen.getByTestId('complaint-submit'));

    await waitFor(() => expect(createReportMock).toHaveBeenCalledOnce());
    expect(createReportMock.mock.calls[0]?.[0].user_id).toBe('subject-1');
  });

  it('keeps the dialog draft open when submission fails', async () => {
    createReportMock.mockRejectedValueOnce(new Error('service unavailable'));
    const { onClose } = renderDialog();
    fireEvent.click(screen.getByTestId('complaint-type-1'));
    fireEvent.change(screen.getByTestId('complaint-detail'), {
      target: { value: 'keep this draft' },
    });
    fireEvent.click(screen.getByTestId('complaint-submit'));

    await waitFor(() => expect(message.error).toHaveBeenCalledOnce());
    expect(onClose).not.toHaveBeenCalled();
    expect((screen.getByTestId('complaint-detail') as HTMLTextAreaElement).value).toBe('keep this draft');
  });

  it('closes when cancel is clicked', () => {
    const { onClose } = renderDialog();
    fireEvent.click(screen.getByTestId('complaint-cancel'));

    expect(onClose).toHaveBeenCalledOnce();
  });
});
