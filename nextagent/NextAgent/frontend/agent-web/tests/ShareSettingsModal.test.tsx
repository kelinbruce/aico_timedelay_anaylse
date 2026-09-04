// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const createShareMock = vi.hoisted(() => vi.fn());

vi.mock('../src/services/shareService.ts', () => ({
  shareService: {
    createShare: createShareMock,
  },
}));

vi.mock('mermaid', () => ({
  default: {
    initialize: vi.fn(),
    render: vi.fn(),
  },
}));

import { ShareSettingsModal } from '../src/features/share/components/ShareSettingsModal.tsx';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('ShareSettingsModal', () => {
  it('does not show permission section in local mode', () => {
    render(<ShareSettingsModal open={true} sessionId="S1" runIds={['R1']} isRemoteMode={false} userOps={null} onCancel={() => {}} />);
    expect(screen.queryByTestId('share-permission-section')).toBeNull();
  });

  it('shows permission section in remote mode', () => {
    render(<ShareSettingsModal open={true} sessionId="S1" runIds={['R1']} isRemoteMode={true} userOps={['net:read']} onCancel={() => {}} />);
    expect(screen.getByTestId('share-permission-section')).toBeTruthy();
  });

  it('shows all four expiry options', () => {
    render(<ShareSettingsModal open={true} sessionId="S1" runIds={['R1']} isRemoteMode={false} userOps={null} onCancel={() => {}} />);
    expect(screen.getByText('24 小时')).toBeTruthy();
    expect(screen.getByText('7 天')).toBeTruthy();
    expect(screen.getByText('一个月')).toBeTruthy();
    expect(screen.getByText('永久')).toBeTruthy();
  });

  it('calls createShare with null allowedOps in local mode', async () => {
    createShareMock.mockResolvedValue({ shareId: 'sh-1', shareUrl: 'https://host/#/shared/sh-1' });
    render(<ShareSettingsModal open={true} sessionId="S1" runIds={['R1']} isRemoteMode={false} userOps={null} onCancel={() => {}} />);
    fireEvent.click(screen.getByTestId('share-generate-btn'));
    await waitFor(() => {
      expect(createShareMock).toHaveBeenCalledTimes(1);
    });
    const params = createShareMock.mock.calls[0]![0];
    expect(params.allowedOps).toBeNull();
    expect(params.runIds).toEqual(['R1']);
    expect(params.expiresIn).toBe('7d');
  });

  it('calls createShare with userOps when keepPermissions is checked in remote mode', async () => {
    createShareMock.mockResolvedValue({ shareId: 'sh-2', shareUrl: 'https://host/#/shared/sh-2' });
    render(
      <ShareSettingsModal
        open={true}
        sessionId="S1"
        runIds={['R1', 'R2']}
        isRemoteMode={true}
        userOps={['net:read', 'diag:run']}
        onCancel={() => {}}
      />,
    );
    const toggle = screen.getByRole('switch');
    fireEvent.click(toggle);
    fireEvent.click(screen.getByTestId('share-generate-btn'));
    await waitFor(() => {
      expect(createShareMock).toHaveBeenCalledTimes(1);
    });
    const params = createShareMock.mock.calls[0]![0];
    expect(params.allowedOps).toEqual(['net:read', 'diag:run']);
  });

  it('calls createShare with null allowedOps when keepPermissions is unchecked in remote mode', async () => {
    createShareMock.mockResolvedValue({ shareId: 'sh-3', shareUrl: 'https://host/#/shared/sh-3' });
    render(<ShareSettingsModal open={true} sessionId="S1" runIds={['R1']} isRemoteMode={true} userOps={['net:read']} onCancel={() => {}} />);
    fireEvent.click(screen.getByTestId('share-generate-btn'));
    await waitFor(() => {
      expect(createShareMock).toHaveBeenCalledTimes(1);
    });
    const params = createShareMock.mock.calls[0]![0];
    expect(params.allowedOps).toBeNull();
  });

  it('displays share URL after successful generation', async () => {
    createShareMock.mockResolvedValue({ shareId: 'sh-4', shareUrl: 'https://host/#/shared/sh-4' });
    render(<ShareSettingsModal open={true} sessionId="S1" runIds={['R1']} isRemoteMode={false} userOps={null} onCancel={() => {}} />);
    fireEvent.click(screen.getByTestId('share-generate-btn'));
    await waitFor(() => {
      expect(screen.getByTestId('share-url-display')).toBeTruthy();
    });
    expect(screen.getByDisplayValue('https://host/#/shared/sh-4')).toBeTruthy();
  });
});

describe('ShareSettingsModal cancel-mid-request', () => {
  it('resets loading state when cancelled mid-request and allows a new request on reopen', async () => {
    // Simulate a slow backend: createShare never resolves on its own, but
    // rejects with an AbortError when the caller aborts the signal.
    createShareMock.mockImplementation((params: { signal?: AbortSignal }) => {
      return new Promise((_resolve, reject) => {
        const signal = params.signal;
        if (signal) {
          if (signal.aborted) {
            reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
          } else {
            signal.addEventListener(
              'abort',
              () => {
                reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
              },
              { once: true },
            );
          }
        }
      });
    });

    const { rerender } = render(
      <ShareSettingsModal open={true} sessionId="S1" runIds={['R1']} isRemoteMode={false} userOps={null} onCancel={() => {}} />,
    );

    // Start a share request; the button enters loading state.
    fireEvent.click(screen.getByTestId('share-generate-btn'));
    await waitFor(() => {
      expect(screen.getByTestId('share-generate-btn').textContent).toContain('生成中');
    });
    expect(createShareMock).toHaveBeenCalledTimes(1);

    // Cancel while the request is still in flight, then reopen the modal.
    fireEvent.click(screen.getByRole('button', { name: /取\s*消/ }));
    rerender(<ShareSettingsModal open={true} sessionId="S1" runIds={['R2']} isRemoteMode={false} userOps={null} onCancel={() => {}} />);

    // The generate button must no longer be in loading state.
    const generateBtn = screen.getByTestId('share-generate-btn');
    expect(generateBtn.textContent).toContain('生成分享链接');

    // A fresh request can be initiated with the new selection.
    createShareMock.mockResolvedValue({ shareId: 'sh-5', shareUrl: 'https://host/#/shared/sh-5' });
    fireEvent.click(generateBtn);
    await waitFor(() => {
      expect(createShareMock).toHaveBeenCalledTimes(2);
    });
    expect(createShareMock.mock.calls[1]![0].runIds).toEqual(['R2']);
  });
});
