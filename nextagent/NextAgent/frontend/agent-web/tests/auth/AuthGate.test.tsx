// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { Button } from 'antd';
import { type ReactNode } from 'react';
import { AppProviders } from '../../src/app/AppProviders.tsx';
import { AuthGate } from '../../src/features/auth/AuthGate.tsx';
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

describe('AuthGate', () => {
  it('renders children normally in local mode', () => {
    renderWithOps(
      null,
      'local',
      <AuthGate requiredOps={[AICOServiceOperation.Write]}>
        <Button data-testid="test-btn">Action</Button>
      </AuthGate>,
    );
    expect(screen.getByTestId('test-btn').hasAttribute('disabled')).toBe(false);
  });

  it('renders children normally when user has all required ops', () => {
    renderWithOps(
      ['AICOService.View', 'AICOService.Write'],
      'immersive',
      <AuthGate requiredOps={[AICOServiceOperation.Write]}>
        <Button data-testid="test-btn">Action</Button>
      </AuthGate>,
    );
    expect(screen.getByTestId('test-btn').hasAttribute('disabled')).toBe(false);
  });

  it('disables Antd Button when user lacks required ops', () => {
    renderWithOps(
      ['AICOService.View'],
      'immersive',
      <AuthGate requiredOps={[AICOServiceOperation.Write]}>
        <Button data-testid="test-btn">Action</Button>
      </AuthGate>,
    );
    expect(screen.getByTestId('test-btn').hasAttribute('disabled')).toBe(true);
  });

  it('disables Antd Button when user has no ops', () => {
    renderWithOps(
      [],
      'immersive',
      <AuthGate requiredOps={[AICOServiceOperation.Write]}>
        <Button data-testid="test-btn">Action</Button>
      </AuthGate>,
    );
    expect(screen.getByTestId('test-btn').hasAttribute('disabled')).toBe(true);
  });

  it('disables non-Button elements via pointerEvents wrapper', () => {
    renderWithOps(
      ['AICOService.View'],
      'immersive',
      <AuthGate requiredOps={[AICOServiceOperation.Write]}>
        <button data-testid="plain-btn">Plain</button>
      </AuthGate>,
    );
    const btn = screen.getByTestId('plain-btn');
    expect(btn).toBeTruthy();
    // The parent span should have cursor not-allowed
    const wrapper = btn.parentElement;
    expect(wrapper?.style.pointerEvents).toBe('none');
  });
});
