import { describe, expect, it, vi } from 'vitest';
import { CapabilityPresentationStore } from './capabilityPresentationStore.ts';

describe('CapabilityPresentationStore', () => {
  it('prefetches once on Session activation and treats an entry without locales as resolved', async () => {
    const load = vi.fn(async () => ({
      resources: [{ capabilityKind: 'SKILL' as const, capabilityId: 'generated-skill', displayName: 'Generated skill' }],
    }));
    const store = new CapabilityPresentationStore(load);

    await Promise.all([store.activate('session-a'), store.activate('session-a')]);
    await store.observeIdentities('session-a', ['SKILL:generated-skill']);

    expect(load).toHaveBeenCalledTimes(1);
    expect(store.getSessionSnapshot('session-a').resources.get('SKILL:generated-skill')).toMatchObject({ displayName: 'Generated skill' });
  });

  it('uses one in-flight request and drains one dirty trailing refresh', async () => {
    const first = deferred<{ resources: readonly [] }>();
    const load = vi
      .fn()
      .mockImplementationOnce(() => first.promise)
      .mockResolvedValue({ resources: [] });
    const store = new CapabilityPresentationStore(load);

    const activation = store.activate('session-a');
    const unknown = store.observeIdentities('session-a', ['TOOL:late-tool']);
    const duplicateUnknown = store.observeIdentities('session-a', ['TOOL:late-tool']);
    first.resolve({ resources: [] });
    await Promise.all([activation, unknown, duplicateUnknown]);

    expect(load).toHaveBeenCalledTimes(2);
    expect(store.getSessionSnapshot('session-a').confirmedMissing.has('TOOL:late-tool')).toBe(true);
    await store.observeIdentities('session-a', ['TOOL:late-tool']);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('does not issue a trailing refresh when the in-flight full projection resolves the observed identity', async () => {
    const first = deferred<{
      resources: readonly [{ capabilityKind: 'TOOL'; capabilityId: 'static-tool'; displayName: 'Static tool' }];
    }>();
    const load = vi.fn(() => first.promise);
    const store = new CapabilityPresentationStore(load);

    const activation = store.activate('session-a');
    const observation = store.observeIdentities('session-a', ['TOOL:static-tool']);
    first.resolve({ resources: [{ capabilityKind: 'TOOL', capabilityId: 'static-tool', displayName: 'Static tool' }] });
    await Promise.all([activation, observation]);

    expect(load).toHaveBeenCalledTimes(1);
  });

  it('keeps last-good resources on failure and ignores a response after Session clear', async () => {
    const late = deferred<{ resources: readonly [{ capabilityKind: 'TOOL'; capabilityId: 'late'; displayName: 'Late' }] }>();
    const load = vi
      .fn()
      .mockResolvedValueOnce({ resources: [{ capabilityKind: 'TOOL', capabilityId: 'Read', displayName: 'Read file' }] })
      .mockRejectedValueOnce(new Error('unavailable'))
      .mockImplementationOnce(() => late.promise);
    const store = new CapabilityPresentationStore(load);

    await store.activate('session-a');
    await store.refresh('session-a');
    expect(store.getSessionSnapshot('session-a').resources.has('TOOL:Read')).toBe(true);

    const pending = store.refresh('session-a');
    store.clear('session-a');
    late.resolve({ resources: [{ capabilityKind: 'TOOL', capabilityId: 'late', displayName: 'Late' }] });
    await pending;

    expect(store.getSessionSnapshot('session-a').resources.size).toBe(0);
  });

  it('does not retry an unknown identity during failure cooldown and retries after the boundary', async () => {
    let now = 10_000;
    const load = vi.fn().mockRejectedValueOnce(new Error('unavailable')).mockResolvedValue({ resources: [] });
    const store = new CapabilityPresentationStore(load, () => now);

    await store.observeIdentities('session-a', ['TOOL:runtime-tool']);
    await store.observeIdentities('session-a', ['TOOL:runtime-tool']);
    expect(load).toHaveBeenCalledTimes(1);

    now += 1_000;
    await store.observeIdentities('session-a', ['TOOL:runtime-tool']);
    expect(load).toHaveBeenCalledTimes(2);
    expect(store.getSessionSnapshot('session-a').confirmedMissing.has('TOOL:runtime-tool')).toBe(true);
  });
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}
