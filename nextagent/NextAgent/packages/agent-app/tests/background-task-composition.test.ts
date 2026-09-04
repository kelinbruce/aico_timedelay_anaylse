import type { BackgroundTaskRecord, BackgroundTaskStoreGatewayPort } from '@nextagent/agent-contracts/gateway';
import { describe, expect, it, vi } from 'vitest';
import { composeBackgroundTaskLayer } from '../src/composition/background-task-composition.js';
import { createCompositionDeferredBindings } from '../src/composition/deferred-composition-bindings.js';

describe('background task composition', () => {
  it('returns an explicit disabled result without invoking an absent factory', () => {
    const timeline = { emitSessionTimelineEvent: vi.fn(async () => {}) };

    expect(composeBackgroundTaskLayer({ runtimeTimeline: timeline })).toEqual({ enabled: false });
    expect(timeline.emitSessionTimelineEvent).not.toHaveBeenCalled();
  });

  it('creates the store once and routes callbacks through the bound runtime timeline', async () => {
    const store = {} as BackgroundTaskStoreGatewayPort;
    const storeFactory = vi.fn(() => store);
    const deferred = createCompositionDeferredBindings();
    const composition = composeBackgroundTaskLayer({
      storeFactory,
      runtimeTimeline: deferred.backgroundRuntimeTimeline,
    });
    expect(composition.enabled).toBe(true);
    if (!composition.enabled) {
      throw new Error('expected enabled background composition');
    }

    await expect(composition.onStart(backgroundRecord())).rejects.toMatchObject({
      code: 'COMPOSITION_DEFERRED_BINDING_UNBOUND',
    });

    const emitSessionTimelineEvent = vi.fn(async () => {});
    deferred.bindBackgroundRuntimeTimelineTarget({ emitSessionTimelineEvent });
    await expect(composition.onStart(backgroundRecord())).resolves.toBeUndefined();

    expect(storeFactory).toHaveBeenCalledTimes(1);
    expect(composition.store).toBe(store);
    expect(emitSessionTimelineEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'BACKGROUND_TASK_STARTED',
      }),
    );
  });
});

function backgroundRecord(): BackgroundTaskRecord {
  return {
    taskId: 'task-1',
    commandName: 'diagnose-network',
    startedAt: 1,
    stdoutRef: 'stdout.log',
    stderrRef: 'stderr.log',
  } as unknown as BackgroundTaskRecord;
}
