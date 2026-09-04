// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/features/sidebar/components/Sidebar.tsx', () => ({
  Sidebar: () => <div data-testid="mock-sidebar" />,
}));

vi.mock('../src/pages/ChatPage.tsx', () => ({
  ChatPage: () => <div data-testid="mock-chat-page" />,
}));

vi.mock('../src/pages/CronTaskDashboardPage.tsx', () => ({
  CronTaskDashboardPage: () => <div data-testid="mock-cron-task-dashboard-page" />,
}));

import { App } from '../src/App.tsx';

function renderApp(pathname: string) {
  window.history.pushState({}, '', '/');
  window.location.hash = pathname;
  return render(<App />);
}

describe('App routes', () => {
  afterEach(() => {
    cleanup();
  });

  it('routes the root path to ChatPage', () => {
    renderApp('/');

    expect(screen.getByTestId('mock-chat-page')).toBeTruthy();
  });

  it('routes session detail paths to ChatPage', () => {
    renderApp('/session/session-1');

    expect(screen.getByTestId('mock-chat-page')).toBeTruthy();
  });

  it('routes cron task dashboard paths to CronTaskDashboardPage', () => {
    renderApp('/cron-tasks');

    expect(screen.getByTestId('mock-cron-task-dashboard-page')).toBeTruthy();
  });

  it('does not expose a standalone /sessions page', () => {
    renderApp('/sessions');

    expect(screen.queryByTestId('mock-chat-page')).toBeNull();
  });
});
