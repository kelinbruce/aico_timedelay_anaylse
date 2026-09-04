// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { AppProviders } from '../../src/app/AppProviders.tsx';
import { AuthGate } from '../../src/features/auth/AuthGate.tsx';
import { AICOServiceOperation } from '../../src/features/auth/authEnums.ts';
import { ShareAltOutlined } from '@ant-design/icons';
import { Tooltip } from 'antd';
import type { HostSiteContext } from '../../src/app/hostTypes.ts';

afterEach(cleanup);

function renderWithOps(ops: string[], mode: 'immersive' | 'local' = 'immersive') {
  const site: HostSiteContext | undefined = ops === null ? undefined : { user: { ops } };
  const effectiveMode = ops === null ? 'local' : mode;
  return render(
    <AppProviders mode={effectiveMode} site={site}>
      <AuthGate requiredOps={[AICOServiceOperation.Write]}>
        <Tooltip title="Share">
          <button type="button" data-testid="btn-share" aria-label="Share" onClick={() => {}}>
            <ShareAltOutlined />
          </button>
        </Tooltip>
      </AuthGate>
    </AppProviders>,
  );
}

describe('TurnBlock share button permission control', () => {
  it('renders share button normally when user has Write', () => {
    renderWithOps(['AICOService.View', 'AICOService.Write']);
    const shareBtn = screen.getByTestId('btn-share');
    expect(shareBtn).toBeTruthy();
    expect(shareBtn.parentElement?.style.pointerEvents).not.toBe('none');
  });

  it('disables share button when user lacks Write', () => {
    renderWithOps(['AICOService.View']);
    const shareBtn = screen.getByTestId('btn-share');
    expect(shareBtn).toBeTruthy();
    // AuthGate wraps non-Button elements with pointerEvents none
    expect(shareBtn.parentElement?.style.pointerEvents).toBe('none');
  });

  it('renders share button normally in local mode', () => {
    renderWithOps(['AICOService.View', 'AICOService.Write'], 'local');
    const shareBtn = screen.getByTestId('btn-share');
    expect(shareBtn.parentElement?.style.pointerEvents).not.toBe('none');
  });
});
