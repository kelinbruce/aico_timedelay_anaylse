// @vitest-environment jsdom
import { cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { type ReactNode } from 'react';
import { AppProviders } from '../../src/app/AppProviders.tsx';
import { useUserOps } from '../../src/features/auth/useUserOps.ts';
import type { HostSiteContext } from '../../src/app/hostTypes.ts';

function createWrapper(site: HostSiteContext | undefined, mode: 'local' | 'immersive' | 'piu') {
  return function Wrapper({ children }: { readonly children: ReactNode }) {
    return (
      <AppProviders mode={mode} site={site}>
        {children}
      </AppProviders>
    );
  };
}

afterEach(cleanup);

describe('useUserOps', () => {
  it('returns null in local mode', () => {
    const { result } = renderHook(() => useUserOps(), {
      wrapper: createWrapper({ user: { ops: ['AICOService.Write'] } }, 'local'),
    });
    expect(result.current).toBeNull();
  });

  it('returns ops array in immersive mode', () => {
    const site: HostSiteContext = {
      user: { ops: ['AICOService.View', 'AICOService.Write'] },
    };
    const { result } = renderHook(() => useUserOps(), {
      wrapper: createWrapper(site, 'immersive'),
    });
    expect(result.current).toEqual(['AICOService.View', 'AICOService.Write']);
  });

  it('returns ops array in piu mode', () => {
    const site: HostSiteContext = {
      user: { ops: ['AICOService.View'] },
    };
    const { result } = renderHook(() => useUserOps(), {
      wrapper: createWrapper(site, 'piu'),
    });
    expect(result.current).toEqual(['AICOService.View']);
  });

  it('returns empty array when remote site has no user object', () => {
    const { result } = renderHook(() => useUserOps(), {
      wrapper: createWrapper({}, 'immersive'),
    });
    expect(result.current).toEqual([]);
  });

  it('returns empty array when remote user has no ops', () => {
    const site: HostSiteContext = { user: {} };
    const { result } = renderHook(() => useUserOps(), {
      wrapper: createWrapper(site, 'piu'),
    });
    expect(result.current).toEqual([]);
  });

  it('returns null when remote user has ops null (standalone host)', () => {
    const site: HostSiteContext = { user: { ops: null } };
    const { result } = renderHook(() => useUserOps(), {
      wrapper: createWrapper(site, 'immersive'),
    });
    expect(result.current).toBeNull();
  });

  it('returns null when called outside AppProviders', () => {
    const { result } = renderHook(() => useUserOps());
    expect(result.current).toBeNull();
  });
});
