// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { AppProviders } from '../../src/app/AppProviders.tsx';
import { Sidebar } from '../../src/features/sidebar/components/Sidebar.tsx';
import { sessionService } from '../../src/services/sessionService.ts';
import type { HostSiteContext } from '../../src/app/hostTypes.ts';

const noopOpenHelp = () => {};

afterEach(cleanup);

function renderInMode(ops: string[], mode: 'immersive' | 'piu' = 'immersive') {
  const site: HostSiteContext = { user: { ops } };
  render(
    <AppProviders mode={mode} site={site}>
      <MemoryRouter>
        <Sidebar onOpenHelp={noopOpenHelp} showLocalControls={false} />
      </MemoryRouter>
    </AppProviders>,
  );
}

describe('Sidebar permission control', () => {
  it('disables new session button when user lacks Write', () => {
    renderInMode(['AICOService.View']);
    const newSessionBtn = screen.getByTestId('sidebar-new-session-shortcut');
    // AuthGate wraps NavButton (not Antd Button directly) with pointerEvents none
    let el: HTMLElement | null = newSessionBtn;
    let found = false;
    while (el) {
      if (el.style.pointerEvents === 'none') {
        found = true;
        break;
      }
      el = el.parentElement;
    }
    expect(found).toBe(true);
  });

  it('keeps new session button enabled when user has Write', () => {
    renderInMode(['AICOService.View', 'AICOService.Write']);
    const newSessionBtn = screen.getByTestId('sidebar-new-session-shortcut');
    let el: HTMLElement | null = newSessionBtn;
    let found = false;
    while (el) {
      if (el.style.pointerEvents === 'none') {
        found = true;
        break;
      }
      el = el.parentElement;
    }
    expect(found).toBe(false);
  });

  it('shows no-permission sidebar message when user has no ops', () => {
    renderInMode([]);
    expect(screen.getByText('权限不足，无法查看会话列表')).toBeTruthy();
  });

  it('does not show no-permission sidebar message when user has View', () => {
    renderInMode(['AICOService.View']);
    expect(screen.queryByText('权限不足，无法查看会话列表')).toBeNull();
  });
});
