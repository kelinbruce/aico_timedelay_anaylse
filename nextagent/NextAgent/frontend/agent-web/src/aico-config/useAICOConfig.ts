import { useSyncExternalStore } from 'react';
import { aicoConfigStore, type AICOConfigSnapshot } from './AICOConfigStore.ts';

export function useAICOConfigSnapshot(): AICOConfigSnapshot {
  return useSyncExternalStore(aicoConfigStore.subscribe, aicoConfigStore.getSnapshot, aicoConfigStore.getSnapshot);
}

export function useAICOConfig() {
  return useAICOConfigSnapshot().config;
}
