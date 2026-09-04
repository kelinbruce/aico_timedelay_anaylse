// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { type ReactNode } from 'react';
import { AppProviders } from '../../src/app/AppProviders.tsx';
import { AuthWrapper } from '../../src/features/auth/AuthWrapper.tsx';
import { AICOServiceOperation } from '../../src/features/auth/authEnums.ts';
import type { HostSiteContext } from '../../src/app/hostTypes.ts';

function renderWithOps(ops: string[] | null, mode: 'local' | 'immersive', children: ReactNode) {
  const site: HostSiteContext | undefined = ops === null ? undefined : { user: { ops } };
  const effectiveMode = ops === null ? 'local' : mode;
  return render(
    <AppProviders mode={effectiveMode} site={site}>
      {children}
    </AppProviders>,
  );
}

afterEach(cleanup);

describe('AuthWrapper', () => {
  it('renders children in local mode', () => {
    renderWithOps(
      null,
      'local',
      <AuthWrapper requiredOps={[AICOServiceOperation.Write]}>
        <div data-testid="content">File</div>
      </AuthWrapper>,
    );
    expect(screen.getByTestId('content')).toBeTruthy();
  });

  it('renders children when user has all required ops', () => {
    renderWithOps(
      ['AICOService.View', 'AICOService.Write'],
      'immersive',
      <AuthWrapper requiredOps={[AICOServiceOperation.Write]}>
        <div data-testid="content">File</div>
      </AuthWrapper>,
    );
    expect(screen.getByTestId('content')).toBeTruthy();
  });

  it('returns null when user lacks required ops and no fallback', () => {
    renderWithOps(
      ['AICOService.View'],
      'immersive',
      <AuthWrapper requiredOps={[AICOServiceOperation.Write]}>
        <div data-testid="content">File</div>
      </AuthWrapper>,
    );
    expect(screen.queryByTestId('content')).toBeNull();
  });

  it('renders fallback when provided and user lacks required ops', () => {
    renderWithOps(
      ['AICOService.View'],
      'immersive',
      <AuthWrapper requiredOps={[AICOServiceOperation.Write]} fallback={<div data-testid="fallback">Placeholder</div>}>
        <div data-testid="content">File</div>
      </AuthWrapper>,
    );
    expect(screen.queryByTestId('content')).toBeNull();
    expect(screen.getByTestId('fallback')).toBeTruthy();
  });

  it('returns null when user has no ops and no fallback', () => {
    renderWithOps(
      [],
      'immersive',
      <AuthWrapper requiredOps={[AICOServiceOperation.Write]}>
        <div data-testid="content">File</div>
      </AuthWrapper>,
    );
    expect(screen.queryByTestId('content')).toBeNull();
  });
});
