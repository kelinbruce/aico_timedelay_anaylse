import { useSyncExternalStore } from 'react';
import { capabilityPresentationStore, type CapabilityPresentationSessionSnapshot } from './capabilityPresentationStore.ts';

export function useCapabilityPresentationResources(sessionId?: string): CapabilityPresentationSessionSnapshot {
  return useSyncExternalStore(
    capabilityPresentationStore.subscribe,
    () => capabilityPresentationStore.getSessionSnapshot(sessionId ?? ''),
    () => capabilityPresentationStore.getSessionSnapshot(sessionId ?? ''),
  );
}
