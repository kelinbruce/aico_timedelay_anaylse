import { afterEach, describe, expect, it, vi } from 'vitest';
import type { StreamEnvelope } from './contracts.ts';
import { capabilityPresentationStore } from './capabilityPresentationStore.ts';
import {
  activateCapabilityPresentationResources,
  clearCapabilityPresentationResources,
  deactivateCapabilityPresentationResources,
  observeCapabilityPresentationEvents,
} from './capabilityPresentationCoordinator.ts';

afterEach(() => {
  vi.restoreAllMocks();
  clearCapabilityPresentationResources('session-a');
  clearCapabilityPresentationResources('session-b');
});

describe('capability presentation event coordination', () => {
  it('deduplicates one activation and refreshes when returning to a previously active Session', () => {
    const activate = vi.spyOn(capabilityPresentationStore, 'activate').mockResolvedValue();
    const refresh = vi.spyOn(capabilityPresentationStore, 'refresh').mockResolvedValue();

    activateCapabilityPresentationResources('session-a');
    activateCapabilityPresentationResources('session-a');
    activateCapabilityPresentationResources('session-b');
    activateCapabilityPresentationResources('session-a');

    expect(activate.mock.calls.map(([sessionId]) => sessionId)).toEqual(['session-a', 'session-b']);
    expect(refresh).toHaveBeenCalledWith('session-a');
  });

  it('refreshes a previously loaded Session after the conversation surface was deactivated', () => {
    const activate = vi.spyOn(capabilityPresentationStore, 'activate').mockResolvedValue();
    const refresh = vi.spyOn(capabilityPresentationStore, 'refresh').mockResolvedValue();

    activateCapabilityPresentationResources('session-a');
    deactivateCapabilityPresentationResources();
    activateCapabilityPresentationResources('session-a');

    expect(activate).toHaveBeenCalledTimes(1);
    expect(refresh).toHaveBeenCalledWith('session-a');
  });

  it('observes outer and wrapper target identities without per-event requests', () => {
    const observe = vi.spyOn(capabilityPresentationStore, 'observeIdentities').mockResolvedValue();
    const refresh = vi.spyOn(capabilityPresentationStore, 'refresh').mockResolvedValue();

    observeCapabilityPresentationEvents('session-a', [
      event('started', 'CAPABILITY_STARTED', {
        capabilityKind: 'TOOL',
        capabilityId: 'Skill',
        targetCapabilityId: 'alarm-diagnosis',
        toolCallId: 'call-1',
      }),
      event('completed', 'CAPABILITY_COMPLETED', {
        capabilityKind: 'TOOL',
        capabilityId: 'Read',
        toolCallId: 'call-2',
        status: 'SUCCEEDED',
      }),
    ]);

    expect(observe).toHaveBeenCalledWith('session-a', ['TOOL:Skill', 'SKILL:alarm-diagnosis', 'TOOL:Read']);
    expect(refresh).not.toHaveBeenCalled();
  });

  it('refreshes only once when the same successful acquisition completion is replayed', () => {
    vi.spyOn(capabilityPresentationStore, 'observeIdentities').mockResolvedValue();
    const refresh = vi.spyOn(capabilityPresentationStore, 'refresh').mockResolvedValue();
    const completed = event('acquired', 'CAPABILITY_COMPLETED', {
      capabilityKind: 'TOOL',
      capabilityId: 'acquire_skill',
      toolCallId: 'call-acquire',
      status: 'SUCCEEDED',
    });

    observeCapabilityPresentationEvents('session-a', [completed]);
    observeCapabilityPresentationEvents('session-a', [completed]);

    expect(refresh).toHaveBeenCalledTimes(1);
  });
});

function event(eventId: string, eventType: StreamEnvelope['eventType'], payload: Record<string, unknown>): StreamEnvelope {
  return {
    eventId,
    sessionId: 'session-a',
    requestId: 'request-a',
    runId: 'run-a',
    rootMessageId: 'root-a',
    requestContextId: 'context-a',
    sequence: 1,
    eventType,
    timelineEventRef: null,
    transportHints: [],
    payload,
    createdAt: 0,
  } as StreamEnvelope;
}
