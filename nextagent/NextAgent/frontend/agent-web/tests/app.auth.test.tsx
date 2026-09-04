// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AuthChallenge } from '../src/services/apiClient.ts';

const postMock = vi.hoisted(() => vi.fn());
const setAuthChallengeHandlerMock = vi.hoisted(() => vi.fn());

vi.mock('../src/services/apiClient.ts', () => ({
  apiClient: {
    post: postMock,
  },
  setAuthChallengeHandler: setAuthChallengeHandlerMock,
  setTenantId: vi.fn(),
  setSubjectId: vi.fn(),
  setDisplayName: vi.fn(),
  setCsrfToken: vi.fn(),
}));

vi.mock('#auth/LocalLoginPage', () => ({
  LocalLoginPage: ({ onAuthenticated }: { readonly onAuthenticated: () => void }) => (
    <button type="button" onClick={onAuthenticated}>
      Local login
    </button>
  ),
}));

vi.mock('../src/features/sidebar/components/Sidebar.tsx', () => ({
  Sidebar: ({ onLogout }: { readonly onLogout?: () => void | Promise<void> }) => (
    <aside data-testid="mock-sidebar">
      {onLogout ? (
        <button type="button" onClick={() => void onLogout()}>
          Sign out
        </button>
      ) : null}
    </aside>
  ),
}));

vi.mock('../src/pages/ChatPage.tsx', () => ({
  ChatPage: () => <div data-testid="mock-chat-page" />,
}));

import { App } from '../src/App.tsx';

describe('App authentication routing', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('shows local login after LOCAL_CONFIG 401 challenge and enters the app after login', async () => {
    const authHandler = await renderAndReadAuthHandler();

    authHandler(localChallenge());
    expect(await screen.findByText('Local login')).toBeTruthy();

    fireEvent.click(screen.getByText('Local login'));

    expect(await screen.findByTestId('mock-chat-page')).toBeTruthy();
  });

  it('does not show local login after IAM 401 challenge', async () => {
    const authHandler = await renderAndReadAuthHandler();

    authHandler({
      authMode: 'IAM',
      loginUrl: null,
      iamStatus: 'UNIMPLEMENTED',
      localLoginEnabled: false,
    });

    expect(screen.queryByText('Local login')).toBeNull();
    expect(await screen.findByText('IAM identity is unavailable')).toBeTruthy();
  });

  it('logs out through the local logout endpoint and returns to local login', async () => {
    postMock.mockResolvedValue({});
    render(<App />);

    fireEvent.click(screen.getByText('Sign out'));

    await waitFor(() => {
      expect(postMock).toHaveBeenCalledWith('/api/v1/auth/local/logout', {});
    });
    expect(await screen.findByText('Local login')).toBeTruthy();
  });
});

async function renderAndReadAuthHandler(): Promise<(challenge: AuthChallenge) => void> {
  render(<App />);
  await waitFor(() => expect(setAuthChallengeHandlerMock).toHaveBeenCalled());
  const handler = setAuthChallengeHandlerMock.mock.calls.find((call) => typeof call[0] === 'function')?.[0];
  if (typeof handler !== 'function') {
    throw new Error('Auth challenge handler was not registered');
  }
  return handler as (challenge: AuthChallenge) => void;
}

function localChallenge(): AuthChallenge {
  return {
    authMode: 'LOCAL_CONFIG',
    loginUrl: '/login',
    iamStatus: 'DISABLED',
    localLoginEnabled: true,
  };
}
