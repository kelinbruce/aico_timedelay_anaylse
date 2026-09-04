import type { CapabilityPresentationResource, CapabilityPresentationResourceMap } from '../features/chat/process/capabilityProcessTitle.ts';
import { loadCapabilityPresentationResources } from '../services/capabilityPresentationResourceService.ts';

export interface CapabilityPresentationResponse {
  readonly resources: readonly CapabilityPresentationResource[];
}

export type CapabilityPresentationLoader = (sessionId: string, signal: AbortSignal) => Promise<CapabilityPresentationResponse>;

export interface CapabilityPresentationSessionSnapshot {
  readonly resources: CapabilityPresentationResourceMap;
  readonly confirmedMissing: ReadonlySet<string>;
  readonly version: number;
}

interface SessionState {
  resources: Map<string, CapabilityPresentationResource>;
  confirmedMissing: Set<string>;
  pendingUnknown: Set<string>;
  attempted: boolean;
  dirty: boolean;
  epoch: number;
  version: number;
  retryNotBefore: number;
  snapshot: CapabilityPresentationSessionSnapshot;
  inFlight?: Promise<void> | undefined;
  controller?: AbortController | undefined;
}

const emptySnapshot: CapabilityPresentationSessionSnapshot = {
  resources: new Map(),
  confirmedMissing: new Set(),
  version: 0,
};
const MAX_CACHED_PRESENTATION_SESSIONS = 10;

export class CapabilityPresentationStore {
  private readonly sessions = new Map<string, SessionState>();
  private readonly listeners = new Set<() => void>();

  constructor(
    private readonly load: CapabilityPresentationLoader,
    private readonly now: () => number = Date.now,
  ) {}

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSessionSnapshot(sessionId: string): CapabilityPresentationSessionSnapshot {
    const state = this.sessions.get(sessionId);
    return state?.snapshot ?? emptySnapshot;
  }

  async activate(sessionId: string): Promise<void> {
    const state = this.requireState(sessionId);
    if (state.attempted) {
      if (state.inFlight !== undefined) {
        return state.inFlight;
      }
      if (state.retryNotBefore === 0) {
        return undefined;
      }
    }
    state.attempted = true;
    return this.start(sessionId, state);
  }

  async observeIdentities(sessionId: string, identities: readonly string[]): Promise<void> {
    const state = this.requireState(sessionId);
    let discoveredUnknown = false;
    for (const identity of identities) {
      if (!state.resources.has(identity) && !state.confirmedMissing.has(identity) && !state.pendingUnknown.has(identity)) {
        state.pendingUnknown.add(identity);
        discoveredUnknown = true;
      }
    }
    if (!discoveredUnknown && (state.pendingUnknown.size === 0 || this.now() < state.retryNotBefore)) {
      return undefined;
    }
    state.attempted = true;
    if (state.inFlight !== undefined) {
      state.dirty = true;
      return state.inFlight;
    }
    return this.start(sessionId, state);
  }

  async refresh(sessionId: string): Promise<void> {
    const state = this.requireState(sessionId);
    state.attempted = true;
    if (state.inFlight !== undefined) {
      state.dirty = true;
      return state.inFlight;
    }
    return this.start(sessionId, state);
  }

  clear(sessionId: string): void {
    const state = this.sessions.get(sessionId);
    if (state !== undefined) {
      state.epoch += 1;
      state.controller?.abort();
      this.sessions.delete(sessionId);
      this.emit();
    }
  }

  private requireState(sessionId: string): SessionState {
    const current = this.sessions.get(sessionId);
    if (current !== undefined) {
      return current;
    }
    const created: SessionState = {
      resources: new Map(),
      confirmedMissing: new Set(),
      pendingUnknown: new Set(),
      attempted: false,
      dirty: false,
      epoch: 0,
      version: 0,
      retryNotBefore: 0,
      snapshot: emptySnapshot,
      inFlight: undefined,
      controller: undefined,
    };
    this.sessions.set(sessionId, created);
    if (this.sessions.size > MAX_CACHED_PRESENTATION_SESSIONS) {
      const oldestSessionId = this.sessions.keys().next().value as string | undefined;
      if (oldestSessionId !== undefined && oldestSessionId !== sessionId) {
        this.clear(oldestSessionId);
      }
    }
    return created;
  }

  private start(sessionId: string, state: SessionState): Promise<void> {
    const epoch = state.epoch;
    const run = async (): Promise<void> => {
      do {
        state.dirty = false;
        const controller = new AbortController();
        state.controller = controller;
        try {
          const response = await this.load(sessionId, controller.signal);
          if (this.sessions.get(sessionId) !== state || state.epoch !== epoch) {
            return;
          }
          const nextResources = new Map(response.resources.map((resource) => [`${resource.capabilityKind}:${resource.capabilityId}`, resource]));
          const unresolvedPending = [...state.pendingUnknown].some((identity) => !nextResources.has(identity));
          const nextMissing = new Set([...state.confirmedMissing].filter((identity) => !nextResources.has(identity)));
          for (const identity of state.pendingUnknown) {
            if (!nextResources.has(identity)) {
              nextMissing.add(identity);
            }
          }
          state.resources = nextResources;
          state.confirmedMissing = nextMissing;
          state.pendingUnknown.clear();
          state.dirty = state.dirty && unresolvedPending;
          state.retryNotBefore = 0;
          state.version += 1;
          state.snapshot = {
            resources: state.resources,
            confirmedMissing: state.confirmedMissing,
            version: state.version,
          };
          this.emit();
        } catch {
          if (this.sessions.get(sessionId) !== state || state.epoch !== epoch) {
            return;
          }
          state.retryNotBefore = this.now() + 1_000;
          state.dirty = false;
        } finally {
          state.controller = undefined;
        }
      } while (state.dirty && this.sessions.get(sessionId) === state && state.epoch === epoch);
    };
    state.inFlight = run().finally(() => {
      if (this.sessions.get(sessionId) === state && state.epoch === epoch) {
        state.inFlight = undefined;
      }
    });
    return state.inFlight;
  }

  private emit(): void {
    for (const listener of this.listeners) {
      listener();
    }
  }
}

export const capabilityPresentationStore = new CapabilityPresentationStore(loadCapabilityPresentationResources);
