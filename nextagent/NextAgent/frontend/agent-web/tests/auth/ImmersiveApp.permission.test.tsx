// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { ImmersiveApp } from '../../src/app/ImmersiveApp.tsx';
import type { HostSiteContext } from '../../src/app/hostTypes.ts';

afterEach(cleanup);

function renderImmersive(ops: string[]) {
  const site: HostSiteContext = { user: { ops } };
  render(<ImmersiveApp site={site} />);
}

describe('ImmersiveApp permission control', () => {
  it('renders PermissionUnavailable when user has no ops', () => {
    renderImmersive([]);
    expect(screen.getByTestId('permission-unavailable')).toBeTruthy();
    expect(screen.queryByTestId('immersive-shell')).toBeNull();
  });

  it('renders immersive shell when user has View only', () => {
    renderImmersive(['AICOService.View']);
    expect(screen.getByTestId('immersive-shell')).toBeTruthy();
    expect(screen.queryByTestId('permission-unavailable')).toBeNull();
  });

  it('renders immersive shell when user has View and Write', () => {
    renderImmersive(['AICOService.View', 'AICOService.Write']);
    expect(screen.getByTestId('immersive-shell')).toBeTruthy();
    expect(screen.queryByTestId('permission-unavailable')).toBeNull();
  });

  it('does not render SharedConversationPage when user has no ops', () => {
    renderImmersive([]);
    expect(screen.queryByTestId('share-loading')).toBeNull();
    expect(screen.queryByTestId('permission-unavailable')).toBeTruthy();
  });
});
