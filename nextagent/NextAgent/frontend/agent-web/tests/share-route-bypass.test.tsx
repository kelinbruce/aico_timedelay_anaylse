// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const setAuthChallengeHandlerMock = vi.hoisted(() => vi.fn());
const loadShareMock = vi.hoisted(() => vi.fn());

vi.mock('../src/services/apiClient.ts', () => ({
  apiClient: {
    post: vi.fn(),
  },
  setAuthChallengeHandler: setAuthChallengeHandlerMock,
  setTenantId: vi.fn(),
  setSubjectId: vi.fn(),
  setDisplayName: vi.fn(),
  setCsrfToken: vi.fn(),
}));

vi.mock('#auth/LocalLoginPage', () => ({
  LocalLoginPage: () => <div data-testid="local-login-page">Login</div>,
}));

vi.mock('../src/features/sidebar/components/Sidebar.tsx', () => ({
  Sidebar: () => <div data-testid="mock-sidebar" />,
}));

vi.mock('../src/pages/ChatPage.tsx', () => ({
  ChatPage: () => <div data-testid="mock-chat-page" />,
}));

vi.mock('../src/services/shareService.ts', () => ({
  shareService: {
    loadSharedConversation: loadShareMock,
  },
}));

vi.mock('mermaid', () => ({
  default: {
    initialize: vi.fn(),
    render: vi.fn(),
  },
}));

import { App } from '../src/App.tsx';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  window.location.hash = '';
});

describe('Share route bypasses auth guard', () => {
  it('renders SharedConversationPage even when auth challenge is active', async () => {
    loadShareMock.mockResolvedValue({
      sessionId: 'S1',
      messages: [
        {
          messageId: 'msg-1',
          sessionId: 'S1',
          requestId: 'req-1',
          runId: 'R1',
          role: 'USER',
          content: 'hello',
          contentType: 'PLAIN_TEXT',
          metadata: {},
          visible: true,
          createdAt: 1000,
        },
      ],
      createdAt: 1000,
    });

    window.location.hash = '#/shared/sh-test';
    render(<App />);

    await waitFor(() => {
      expect(setAuthChallengeHandlerMock).toHaveBeenCalled();
    });
    const handler = setAuthChallengeHandlerMock.mock.calls.find((c) => typeof c[0] === 'function')?.[0] as
      ((challenge: { authMode: string; localLoginEnabled?: boolean }) => void) | undefined;
    if (typeof handler === 'function') {
      handler({ authMode: 'LOCAL_CONFIG', localLoginEnabled: true });
    }

    await waitFor(() => {
      expect(screen.getByTestId('shared-conversation-page')).toBeTruthy();
    });
    expect(screen.queryByTestId('local-login-page')).toBeNull();
  });
});
