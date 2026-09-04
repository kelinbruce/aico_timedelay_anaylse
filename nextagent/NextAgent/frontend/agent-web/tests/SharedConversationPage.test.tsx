// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { createContext } from 'react';

const loadShareMock = vi.hoisted(() => vi.fn());

vi.mock('../src/services/shareService.ts', () => ({
  shareService: {
    loadSharedConversation: loadShareMock,
  },
}));

vi.mock('../src/app/AppProviders.tsx', () => ({
  AppProviders: ({ children }: { readonly children: ReactNode }) => children,
  AppHostContext: createContext({ mode: 'local', site: undefined }),
  useAppHostContext: () => ({ mode: 'local', site: undefined, hostTheme: 'lightday' }),
}));

vi.mock('mermaid', () => ({
  default: {
    initialize: vi.fn(),
    render: vi.fn(),
  },
}));

import { SharedConversationPage } from '../src/pages/SharedConversationPage.tsx';
import { MemoryRouter, Routes, Route } from 'react-router-dom';

function renderAtSharedRoute(shareId: string) {
  return render(
    <MemoryRouter initialEntries={[`/shared/${shareId}`]}>
      <Routes>
        <Route path="/shared/:shareId" element={<SharedConversationPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

const validPage = {
  sessionId: 'S1',
  messages: [
    {
      messageId: 'msg-1',
      sessionId: 'S1',
      requestId: 'req-1',
      runId: 'R1',
      role: 'USER',
      content: 'What is the status?',
      contentType: 'PLAIN_TEXT',
      metadata: {},
      visible: true,
      createdAt: 1000,
    },
    {
      messageId: 'msg-2',
      sessionId: 'S1',
      requestId: 'req-1',
      runId: 'R1',
      role: 'ASSISTANT',
      content: 'All systems normal.',
      contentType: 'PLAIN_TEXT',
      metadata: {},
      visible: true,
      createdAt: 2000,
    },
  ],
  createdAt: 1000,
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('SharedConversationPage', () => {
  it('renders shared conversation content on success', async () => {
    loadShareMock.mockResolvedValue(validPage);
    renderAtSharedRoute('sh-ok');
    await waitFor(() => {
      expect(screen.getByTestId('shared-conversation-page')).toBeTruthy();
    });
    expect(screen.getByText('What is the status?')).toBeTruthy();
    expect(screen.getByText('All systems normal.')).toBeTruthy();
  });

  it('enables vertical scrolling so long content stays reachable', async () => {
    loadShareMock.mockResolvedValue(validPage);
    renderAtSharedRoute('sh-scroll');
    const main = await waitFor(() => screen.getByTestId('shared-conversation-page'));
    // Immersive host sets body/#root overflow:hidden; the page <main> must be
    // its own scroll container or content beyond the fold is clipped.
    expect(main.style.overflowY).toBe('auto');
  });

  it('shows expired screen when API returns SHARE_EXPIRED', async () => {
    loadShareMock.mockRejectedValue({ status: 410, code: 'SHARE_EXPIRED' });
    renderAtSharedRoute('sh-exp');
    await waitFor(() => {
      expect(screen.getByTestId('share-error-expired')).toBeTruthy();
    });
  });

  it('shows forbidden screen when API returns SHARE_FORBIDDEN', async () => {
    loadShareMock.mockRejectedValue({ status: 403, code: 'SHARE_FORBIDDEN' });
    renderAtSharedRoute('sh-forbid');
    await waitFor(() => {
      expect(screen.getByTestId('share-error-forbidden')).toBeTruthy();
    });
  });

  it('shows content deleted screen when API returns SHARE_CONTENT_DELETED', async () => {
    loadShareMock.mockRejectedValue({ status: 404, code: 'SHARE_CONTENT_DELETED' });
    renderAtSharedRoute('sh-del');
    await waitFor(() => {
      expect(screen.getByTestId('share-error-content_deleted')).toBeTruthy();
    });
  });

  it('shows not found screen when API returns SHARE_NOT_FOUND', async () => {
    loadShareMock.mockRejectedValue({ status: 404, code: 'SHARE_NOT_FOUND' });
    renderAtSharedRoute('sh-404');
    await waitFor(() => {
      expect(screen.getByTestId('share-error-not_found')).toBeTruthy();
    });
  });

  it('fills the viewport width on every error state', async () => {
    loadShareMock.mockRejectedValue({ status: 404, code: 'SHARE_NOT_FOUND' });
    renderAtSharedRoute('sh-fill');
    const main = await waitFor(() => screen.getByTestId('share-error-not_found'));
    // Immersive host renders #root as a flex row; a widthless <main> collapses to its
    // content width and hugs the left edge. The error surface must claim full width.
    expect(main.style.width).toBe('100%');
    expect(main.style.boxSizing).toBe('border-box');
  });

  it('shows a full-width empty state when shared messages is empty', async () => {
    loadShareMock.mockResolvedValue({ sessionId: 'S1', messages: [], createdAt: 1000 });
    renderAtSharedRoute('sh-empty');
    const main = await waitFor(() => screen.getByTestId('share-empty'));
    expect(main.style.width).toBe('100%');
    expect(main.style.boxSizing).toBe('border-box');
  });

  it('does not render annotation like/dislike/favorite icons', async () => {
    loadShareMock.mockResolvedValue(validPage);
    renderAtSharedRoute('sh-no-ann');
    await waitFor(() => {
      expect(screen.getByTestId('shared-conversation-page')).toBeTruthy();
    });
    expect(screen.queryAllByLabelText(/like|dislike|favorite/i)).toHaveLength(0);
  });

  it('does not render retry or edit buttons', async () => {
    loadShareMock.mockResolvedValue(validPage);
    renderAtSharedRoute('sh-no-retry');
    await waitFor(() => {
      expect(screen.getByTestId('shared-conversation-page')).toBeTruthy();
    });
    expect(screen.queryAllByLabelText(/retry|edit/i)).toHaveLength(0);
  });

  it('does not render pin (add to frequent questions) button', async () => {
    loadShareMock.mockResolvedValue(validPage);
    renderAtSharedRoute('sh-no-pin');
    await waitFor(() => {
      expect(screen.getByTestId('shared-conversation-page')).toBeTruthy();
    });
    expect(screen.queryAllByTestId('btn-pin-user')).toHaveLength(0);
  });
});
