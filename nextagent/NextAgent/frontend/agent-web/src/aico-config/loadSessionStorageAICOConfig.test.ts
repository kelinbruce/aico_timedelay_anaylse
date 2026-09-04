import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { aicoConfigStore, resetAICOConfigStoreForTesting } from './AICOConfigStore.ts';
import { loadSessionStorageAICOConfig } from './loadSessionStorageAICOConfig.ts';

const STORAGE_KEY = 'AICOConfig';

describe('loadSessionStorageAICOConfig', () => {
  beforeEach(() => {
    resetAICOConfigStoreForTesting();
    sessionStorage.removeItem(STORAGE_KEY);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    sessionStorage.removeItem(STORAGE_KEY);
    vi.restoreAllMocks();
  });

  it('reads, validates, and applies supported AICOConfig fields once per startup invocation', () => {
    const storedConfig = JSON.stringify({
      name: 'NetAgent',
      capabilityBusinessNames: [{ kind: 'TOOL', id: 'networkDiagnostic', names: { 'zh-CN': '网络诊断' } }],
    });
    const getItem = vi.fn(() => storedConfig);
    vi.stubGlobal('sessionStorage', { getItem });

    loadSessionStorageAICOConfig();

    expect(getItem).toHaveBeenCalledTimes(1);
    expect(getItem).toHaveBeenCalledWith(STORAGE_KEY);
    expect(aicoConfigStore.getSnapshot().config).toEqual({ name: 'NetAgent' });
    expect(aicoConfigStore.getSnapshot().config).not.toHaveProperty('capabilityBusinessNames');
  });

  it('keeps defaults without warning when the storage key is absent', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    loadSessionStorageAICOConfig();

    expect(aicoConfigStore.getSnapshot().config).toBeNull();
    expect(warn).not.toHaveBeenCalled();
  });

  it('silently keeps defaults when sessionStorage access throws', () => {
    vi.stubGlobal('sessionStorage', {
      getItem: vi.fn(() => {
        throw new Error('storage denied');
      }),
    });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    loadSessionStorageAICOConfig();

    expect(aicoConfigStore.getSnapshot().config).toBeNull();
    expect(warn).not.toHaveBeenCalled();
  });

  it('keeps defaults and warns once for malformed JSON', () => {
    sessionStorage.setItem(STORAGE_KEY, '{not valid json');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    loadSessionStorageAICOConfig();

    expect(aicoConfigStore.getSnapshot().config).toBeNull();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]?.[0]).toContain('AICOConfig');
  });

  it('keeps defaults and warns once for a parsed non-object', () => {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify('a-string'));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    loadSessionStorageAICOConfig();

    expect(aicoConfigStore.getSnapshot().config).toBeNull();
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('applies an empty object as the default-equivalent config snapshot', () => {
    sessionStorage.setItem(STORAGE_KEY, '{}');

    loadSessionStorageAICOConfig();

    expect(aicoConfigStore.getSnapshot().config).toEqual({});
  });
});
