import { randomUUID } from 'node:crypto';
import {
  AgentError,
  getLogger,
  type AgentId,
  type RequestRunId,
  type RunStatus,
  type SessionId,
  type SubjectId,
  type TenantId,
  type TerminalCommitState,
} from '@nextagent/agent-common';
import type {
  PendingInputRecord,
  PendingInputStoreGateway,
  RequestRunStoreGateway,
  SessionLaneSnapshot,
  SessionStoreGateway,
} from '@nextagent/agent-contracts/gateway';
import {
  SESSION_ACTIVITY_ID_MAX_LENGTH,
  type ConsumeTerminalActivityCommand,
  type SessionActivityEntry,
  type SessionActivityMessage,
  type SessionActivityPort,
  type SessionActivitySessionCoordinates,
  type StreamSessionActivitiesQuery,
} from '@nextagent/agent-contracts/session';

const bootstrapPageSize = 100;
const logger = getLogger({ component: 'agent-session', source: 'session-activity-service' });

export interface SessionActivityServiceDependencies {
  readonly sessions: Pick<SessionStoreGateway, 'loadSession' | 'listSessions'>;
  readonly requestRuns: Pick<RequestRunStoreGateway, 'loadSessionLaneSnapshot'>;
  readonly pendingInputs: Pick<PendingInputStoreGateway, 'loadActivePendingInput'>;
  readonly createActivityId?: () => string;
}

export interface PublishedSessionActivityState {
  readonly kind: 'PUBLISHED';
  readonly entry: Exclude<SessionActivityEntry, { readonly status: 'NONE' }>;
  readonly sourceRunId?: RequestRunId;
}

export interface ConsumedTerminalActivityState {
  readonly kind: 'CONSUMED_TERMINAL';
  readonly sourceRunId: RequestRunId;
}

export type SessionActivityInternalState = PublishedSessionActivityState | ConsumedTerminalActivityState;

export interface SessionActivityDerivationResult {
  readonly publicEntry: SessionActivityEntry;
  readonly internalState?: SessionActivityInternalState;
}

export interface SessionActivityDerivationInput {
  readonly sessionId: SessionId;
  readonly latestRun?: SessionLaneSnapshot['latestRun'];
  readonly activePendingInput?: PendingInputRecord;
  readonly previousState?: SessionActivityInternalState;
  readonly createActivityId?: () => string;
}

type PendingWork = 'REDERIVE' | 'DELETE';

interface ActivityScopeCoordinates {
  readonly tenantId: TenantId;
  readonly subjectId: SubjectId;
  readonly agentId: AgentId;
}

interface ActivityScopeState {
  readonly coordinates: ActivityScopeCoordinates;
  readonly stateBySessionId: Map<SessionId, SessionActivityInternalState>;
  readonly subscribers: Set<ActivitySubscriber>;
  readonly pendingWorkBySessionId: Map<SessionId, PendingWork>;
  bootstrapCompleted: boolean;
  bootstrapPromise?: Promise<void> | undefined;
  bootstrapTouchedSessionIds?: Set<SessionId> | undefined;
  bootstrapDirectoryChanged: boolean;
  drainPromise?: Promise<void> | undefined;
  drainScheduled: boolean;
  pendingStreamRegistrations: number;
  resyncRequired: boolean;
}

export function deriveSessionActivityState(input: SessionActivityDerivationInput): SessionActivityDerivationResult {
  const latestRun = input.latestRun;
  if (latestRun === undefined) {
    return none(input.sessionId);
  }

  if (isActivePendingForRun(input.activePendingInput, latestRun.runId)) {
    return published({
      sessionId: input.sessionId,
      status: 'WAITING_FOR_INPUT',
      pendingInputKind: input.activePendingInput.kind,
    });
  }

  if (isRunningLikeRun(latestRun.status, latestRun.terminalCommitState)) {
    return published({ sessionId: input.sessionId, status: 'RUNNING' });
  }

  if (latestRun.terminalCommitState !== 'COMMITTED') {
    return none(input.sessionId);
  }

  if (latestRun.status === 'FAILED') {
    return deriveTerminalState(input, latestRun.runId, 'UNREAD_FAILURE');
  }
  if (latestRun.status === 'COMPLETED') {
    return deriveTerminalState(input, latestRun.runId, 'UNREAD_RESULT');
  }
  return none(input.sessionId);
}

export class SessionActivityService implements SessionActivityPort {
  private readonly stateByScopeKey = new Map<string, ActivityScopeState>();
  private readonly createActivityId: () => string;
  private closed = false;

  constructor(private readonly deps: SessionActivityServiceDependencies) {
    this.createActivityId = deps.createActivityId ?? (() => `activity-${randomUUID()}`);
  }

  invalidateSessionActivity(coordinates: SessionActivitySessionCoordinates): void {
    if (this.closed) {
      return;
    }
    const scope = this.ensureScope(coordinates);
    scope.bootstrapTouchedSessionIds?.add(coordinates.sessionId);
    if (scope.bootstrapTouchedSessionIds !== undefined) {
      scope.bootstrapDirectoryChanged = true;
    }
    if (scope.pendingWorkBySessionId.get(coordinates.sessionId) !== 'DELETE') {
      scope.pendingWorkBySessionId.set(coordinates.sessionId, 'REDERIVE');
    }
    this.scheduleDrain(scope);
  }

  invalidateDeletedSession(coordinates: SessionActivitySessionCoordinates): void {
    if (this.closed) {
      return;
    }
    const scope = this.ensureScope(coordinates);
    scope.bootstrapTouchedSessionIds?.add(coordinates.sessionId);
    if (scope.bootstrapTouchedSessionIds !== undefined) {
      scope.bootstrapDirectoryChanged = true;
    }
    scope.pendingWorkBySessionId.set(coordinates.sessionId, 'DELETE');
    this.applyDelete(scope, coordinates.sessionId);
    this.scheduleDrain(scope);
  }

  async *streamActivities(query: StreamSessionActivitiesQuery): AsyncIterable<SessionActivityMessage> {
    this.assertOpen();
    const scope = this.ensureScope({
      tenantId: query.identityContext.tenantId,
      subjectId: query.identityContext.subjectId,
      agentId: query.agentId,
    });
    scope.pendingStreamRegistrations += 1;
    let registrationPending = true;
    let subscriber: ActivitySubscriber | undefined;
    try {
      await this.ensureBootstrapAndDrain(scope);
      if (query.signal?.aborted === true || this.closed) {
        return;
      }

      subscriber = new ActivitySubscriber();
      scope.subscribers.add(subscriber);
      scope.pendingStreamRegistrations -= 1;
      registrationPending = false;
      const snapshotEntries = [...scope.stateBySessionId.values()]
        .filter((state): state is PublishedSessionActivityState => state.kind === 'PUBLISHED')
        .map((state) => state.entry);
      subscriber.acceptSnapshot(snapshotEntries);
      yield { type: 'SNAPSHOT', entries: snapshotEntries };
      while (true) {
        const entry = await subscriber.next(query.signal);
        if (entry === undefined) {
          return;
        }
        yield { type: 'DELTA', entry };
      }
    } finally {
      if (registrationPending) {
        scope.pendingStreamRegistrations -= 1;
      }
      subscriber?.close();
      if (subscriber !== undefined) {
        scope.subscribers.delete(subscriber);
      }
      this.maybeDeleteScope(scope);
    }
  }

  async consumeTerminalActivity(command: ConsumeTerminalActivityCommand): Promise<void> {
    this.assertOpen();
    const session = await this.deps.sessions.loadSession({
      tenantId: command.identityContext.tenantId,
      subjectId: command.identityContext.subjectId,
      agentId: command.agentId,
      sessionId: command.sessionId,
    });
    if (session === undefined) {
      throw new AgentError({
        code: 'SESSION_NOT_FOUND',
        message: 'Session was not found.',
        category: 'NOT_FOUND',
        retryable: false,
      });
    }

    const scope = this.stateByScopeKey.get(
      scopeKey({
        tenantId: command.identityContext.tenantId,
        subjectId: command.identityContext.subjectId,
        agentId: command.agentId,
      }),
    );
    const current = scope?.stateBySessionId.get(command.sessionId);
    if (
      scope === undefined ||
      current?.kind !== 'PUBLISHED' ||
      current.sourceRunId === undefined ||
      (current.entry.status !== 'UNREAD_FAILURE' && current.entry.status !== 'UNREAD_RESULT') ||
      current.entry.activityId !== command.activityId ||
      current.sourceRunId !== command.observedRunId
    ) {
      if (scope !== undefined) {
        this.maybeDeleteScope(scope);
      }
      return;
    }

    scope.stateBySessionId.set(command.sessionId, {
      kind: 'CONSUMED_TERMINAL',
      sourceRunId: current.sourceRunId,
    });
    this.broadcast(scope, { sessionId: command.sessionId, status: 'NONE' });
  }

  close(): void {
    if (this.closed) {
      return;
    }
    this.closed = true;
    for (const scope of this.stateByScopeKey.values()) {
      for (const subscriber of scope.subscribers) {
        subscriber.close();
      }
      scope.subscribers.clear();
      scope.pendingWorkBySessionId.clear();
    }
    this.stateByScopeKey.clear();
  }

  private async ensureBootstrapAndDrain(scope: ActivityScopeState): Promise<void> {
    await this.ensureBootstrap(scope);
    await this.ensureDrained(scope);
  }

  private async ensureBootstrap(scope: ActivityScopeState): Promise<void> {
    if (scope.bootstrapCompleted) {
      return undefined;
    }
    if (scope.bootstrapPromise !== undefined) {
      return scope.bootstrapPromise;
    }
    const promise = Promise.resolve().then(async () => {
      const touched = new Set<SessionId>();
      scope.bootstrapTouchedSessionIds = touched;
      const seeds = new Map<SessionId, PublishedSessionActivityState>();
      try {
        do {
          scope.bootstrapDirectoryChanged = false;
          seeds.clear();
          let offset = 0;
          while (true) {
            const page = await this.deps.sessions.listSessions({
              ...scope.coordinates,
              offset,
              limit: bootstrapPageSize,
            });
            if (scope.bootstrapDirectoryChanged) {
              break;
            }
            for (const entry of page.entries) {
              if (!entry.hasInFlightRequest) {
                continue;
              }
              const facts = await this.readFacts({ ...scope.coordinates, sessionId: entry.sessionId });
              if (scope.bootstrapDirectoryChanged) {
                break;
              }
              const derived = deriveSessionActivityState({
                sessionId: entry.sessionId,
                ...facts,
                createActivityId: this.createActivityId,
              });
              if (
                derived.internalState?.kind === 'PUBLISHED' &&
                (derived.internalState.entry.status === 'RUNNING' || derived.internalState.entry.status === 'WAITING_FOR_INPUT')
              ) {
                seeds.set(entry.sessionId, derived.internalState);
              }
            }
            if (scope.bootstrapDirectoryChanged || !page.hasMore) {
              break;
            }
            offset += page.entries.length;
            if (page.entries.length === 0) {
              throw new Error('Session activity bootstrap pagination did not advance.');
            }
          }
        } while (scope.bootstrapDirectoryChanged);

        for (const [sessionId, state] of seeds) {
          if (!touched.has(sessionId) && !scope.stateBySessionId.has(sessionId)) {
            scope.stateBySessionId.set(sessionId, state);
          }
        }
        scope.bootstrapCompleted = true;
        scope.resyncRequired = false;
      } catch (error) {
        this.failScope(scope, error);
        throw error;
      } finally {
        scope.bootstrapTouchedSessionIds = undefined;
      }
    });
    scope.bootstrapPromise = promise;
    try {
      await promise;
    } finally {
      if (scope.bootstrapPromise === promise) {
        scope.bootstrapPromise = undefined;
      }
      if (scope.pendingWorkBySessionId.size > 0) {
        this.scheduleDrain(scope);
      }
    }
    return undefined;
  }

  private async ensureDrained(scope: ActivityScopeState): Promise<void> {
    while (scope.pendingWorkBySessionId.size > 0 || scope.drainPromise !== undefined) {
      if (scope.drainPromise === undefined) {
        this.startDrain(scope);
      }
      await scope.drainPromise;
    }
  }

  private scheduleDrain(scope: ActivityScopeState): void {
    if (scope.resyncRequired || scope.drainScheduled || scope.drainPromise !== undefined) {
      return;
    }
    scope.drainScheduled = true;
    queueMicrotask(() => {
      scope.drainScheduled = false;
      if (scope.bootstrapPromise === undefined) {
        this.startDrain(scope);
      }
    });
  }

  private startDrain(scope: ActivityScopeState): void {
    if (
      this.closed ||
      scope.resyncRequired ||
      scope.drainPromise !== undefined ||
      scope.bootstrapPromise !== undefined ||
      scope.pendingWorkBySessionId.size === 0
    ) {
      return;
    }
    const promise = this.drainScope(scope);
    scope.drainPromise = promise;
    void promise
      .catch(() => {
        logger.warn({
          event: 'session.activity.rederive_failed',
          failureStage: 'ACTIVITY_REDERIVE',
          safeReasonCode: 'GATEWAY_READ_FAILED',
        });
      })
      .finally(() => {
        if (scope.drainPromise === promise) {
          scope.drainPromise = undefined;
        }
        if (scope.pendingWorkBySessionId.size > 0) {
          this.scheduleDrain(scope);
        } else {
          this.maybeDeleteScope(scope);
        }
      });
  }

  private async drainScope(scope: ActivityScopeState): Promise<void> {
    while (!this.closed && scope.pendingWorkBySessionId.size > 0) {
      const next = scope.pendingWorkBySessionId.entries().next().value as [SessionId, PendingWork] | undefined;
      if (next === undefined) {
        return;
      }
      const [sessionId, work] = next;
      scope.pendingWorkBySessionId.delete(sessionId);
      if (work === 'DELETE') {
        this.applyDelete(scope, sessionId);
        continue;
      }
      try {
        const facts = await this.readFacts({ ...scope.coordinates, sessionId });
        if (scope.pendingWorkBySessionId.has(sessionId)) {
          continue;
        }
        this.applyFacts(scope, sessionId, facts);
      } catch (error) {
        if (!scope.pendingWorkBySessionId.has(sessionId)) {
          scope.pendingWorkBySessionId.set(sessionId, 'REDERIVE');
        }
        this.failScope(scope, error);
        throw error;
      }
    }
  }

  private async readFacts(
    coordinates: SessionActivitySessionCoordinates,
  ): Promise<Pick<SessionActivityDerivationInput, 'latestRun' | 'activePendingInput'>> {
    const [laneSnapshot, activePendingInput] = await Promise.all([
      this.deps.requestRuns.loadSessionLaneSnapshot(coordinates),
      this.deps.pendingInputs.loadActivePendingInput(coordinates),
    ]);
    return {
      ...(laneSnapshot.latestRun === undefined ? {} : { latestRun: laneSnapshot.latestRun }),
      ...(activePendingInput === undefined ? {} : { activePendingInput }),
    };
  }

  private applyFacts(
    scope: ActivityScopeState,
    sessionId: SessionId,
    facts: Pick<SessionActivityDerivationInput, 'latestRun' | 'activePendingInput'>,
  ): SessionActivityDerivationResult {
    const previousState = scope.stateBySessionId.get(sessionId);
    const previousEntry = publicEntry(sessionId, previousState);
    const derived = deriveSessionActivityState({
      sessionId,
      ...facts,
      ...(previousState === undefined ? {} : { previousState }),
      createActivityId: this.createActivityId,
    });
    if (derived.internalState === undefined) {
      scope.stateBySessionId.delete(sessionId);
    } else {
      scope.stateBySessionId.set(sessionId, derived.internalState);
    }
    if (!equalEntry(previousEntry, derived.publicEntry)) {
      this.broadcast(scope, derived.publicEntry);
    }
    return derived;
  }

  private applyDelete(scope: ActivityScopeState, sessionId: SessionId): void {
    const previous = scope.stateBySessionId.get(sessionId);
    scope.stateBySessionId.delete(sessionId);
    if (previous?.kind === 'PUBLISHED') {
      this.broadcast(scope, { sessionId, status: 'NONE' });
    }
  }

  private broadcast(scope: ActivityScopeState, entry: SessionActivityEntry): void {
    for (const subscriber of scope.subscribers) {
      subscriber.enqueue(entry);
    }
  }

  private failScope(scope: ActivityScopeState, error: unknown): void {
    scope.bootstrapCompleted = false;
    scope.resyncRequired = true;
    for (const subscriber of scope.subscribers) {
      subscriber.fail(error);
    }
  }

  private ensureScope(coordinates: ActivityScopeCoordinates): ActivityScopeState {
    const key = scopeKey(coordinates);
    const existing = this.stateByScopeKey.get(key);
    if (existing !== undefined) {
      return existing;
    }
    const created: ActivityScopeState = {
      coordinates: {
        tenantId: coordinates.tenantId,
        subjectId: coordinates.subjectId,
        agentId: coordinates.agentId,
      },
      stateBySessionId: new Map(),
      subscribers: new Set(),
      pendingWorkBySessionId: new Map(),
      bootstrapCompleted: false,
      bootstrapPromise: undefined,
      bootstrapTouchedSessionIds: undefined,
      bootstrapDirectoryChanged: false,
      drainPromise: undefined,
      drainScheduled: false,
      pendingStreamRegistrations: 0,
      resyncRequired: false,
    };
    this.stateByScopeKey.set(key, created);
    return created;
  }

  private maybeDeleteScope(scope: ActivityScopeState): void {
    if (
      scope.stateBySessionId.size > 0 ||
      scope.subscribers.size > 0 ||
      scope.pendingWorkBySessionId.size > 0 ||
      scope.pendingStreamRegistrations > 0 ||
      scope.bootstrapPromise !== undefined ||
      scope.bootstrapTouchedSessionIds !== undefined ||
      scope.drainPromise !== undefined ||
      scope.drainScheduled
    ) {
      return;
    }
    const key = scopeKey(scope.coordinates);
    if (this.stateByScopeKey.get(key) === scope) {
      this.stateByScopeKey.delete(key);
    }
  }

  private assertOpen(): void {
    if (this.closed) {
      throw new AgentError({
        code: 'SESSION_ACTIVITY_UNAVAILABLE',
        message: 'Session activity service is unavailable.',
        category: 'UNAVAILABLE',
        retryable: true,
      });
    }
  }
}

class ActivitySubscriber {
  private readonly pendingBySessionId = new Map<SessionId, SessionActivityEntry>();
  private readonly projectedSessionIds = new Set<SessionId>();
  private wake?: (() => void) | undefined;
  private failure?: unknown;
  private closed = false;

  acceptSnapshot(entries: ReadonlyArray<Exclude<SessionActivityEntry, { readonly status: 'NONE' }>>): void {
    for (const entry of entries) {
      this.projectedSessionIds.add(entry.sessionId);
    }
  }

  enqueue(entry: SessionActivityEntry): void {
    if (this.closed || this.failure !== undefined) {
      return;
    }
    if (entry.status === 'NONE' && !this.projectedSessionIds.has(entry.sessionId)) {
      this.pendingBySessionId.delete(entry.sessionId);
    } else {
      this.pendingBySessionId.set(entry.sessionId, entry);
    }
    this.notify();
  }

  async next(signal?: AbortSignal): Promise<SessionActivityEntry | undefined> {
    while (!this.closed && signal?.aborted !== true) {
      if (this.failure !== undefined) {
        throw this.failure;
      }
      const next = this.pendingBySessionId.entries().next().value as [SessionId, SessionActivityEntry] | undefined;
      if (next !== undefined) {
        const [sessionId, entry] = next;
        this.pendingBySessionId.delete(sessionId);
        if (entry.status === 'NONE') {
          this.projectedSessionIds.delete(sessionId);
        } else {
          this.projectedSessionIds.add(sessionId);
        }
        return entry;
      }
      await this.wait(signal);
    }
    if (this.failure !== undefined) {
      throw this.failure;
    }
    return undefined;
  }

  fail(error: unknown): void {
    this.pendingBySessionId.clear();
    this.failure = error;
    this.notify();
  }

  close(): void {
    this.closed = true;
    this.pendingBySessionId.clear();
    this.notify();
  }

  private async wait(signal?: AbortSignal): Promise<void> {
    await new Promise<void>((resolve) => {
      const finish = () => {
        signal?.removeEventListener('abort', finish);
        if (this.wake === finish) {
          this.wake = undefined;
        }
        resolve();
      };
      this.wake = finish;
      signal?.addEventListener('abort', finish, { once: true });
      if (this.closed || this.failure !== undefined || signal?.aborted === true) {
        finish();
      }
    });
  }

  private notify(): void {
    this.wake?.();
  }
}

export function createSessionActivityService(deps: SessionActivityServiceDependencies): SessionActivityService {
  return new SessionActivityService(deps);
}

function deriveTerminalState(
  input: SessionActivityDerivationInput,
  sourceRunId: RequestRunId,
  status: 'UNREAD_FAILURE' | 'UNREAD_RESULT',
): SessionActivityDerivationResult {
  const previousState = input.previousState;
  if (previousState?.kind === 'CONSUMED_TERMINAL' && previousState.sourceRunId === sourceRunId) {
    return none(input.sessionId, previousState);
  }
  if (previousState?.kind === 'PUBLISHED' && previousState.sourceRunId === sourceRunId && previousState.entry.status === status) {
    return { publicEntry: previousState.entry, internalState: previousState };
  }
  const activityId = (input.createActivityId ?? (() => `activity-${randomUUID()}`))();
  if (activityId.length === 0 || activityId.length > SESSION_ACTIVITY_ID_MAX_LENGTH) {
    throw new Error('Session activity id factory returned an invalid identifier.');
  }
  const state: PublishedSessionActivityState = {
    kind: 'PUBLISHED',
    entry: { sessionId: input.sessionId, status, activityId },
    sourceRunId,
  };
  return { publicEntry: state.entry, internalState: state };
}

function published(entry: Exclude<SessionActivityEntry, { readonly status: 'NONE' }>): SessionActivityDerivationResult {
  return { publicEntry: entry, internalState: { kind: 'PUBLISHED', entry } };
}

function none(sessionId: SessionId, internalState?: SessionActivityInternalState): SessionActivityDerivationResult {
  return {
    publicEntry: { sessionId, status: 'NONE' },
    ...(internalState === undefined ? {} : { internalState }),
  };
}

function publicEntry(sessionId: SessionId, state?: SessionActivityInternalState): SessionActivityEntry {
  return state?.kind === 'PUBLISHED' ? state.entry : { sessionId, status: 'NONE' };
}

function equalEntry(left: SessionActivityEntry, right: SessionActivityEntry): boolean {
  if (left.sessionId !== right.sessionId || left.status !== right.status) {
    return false;
  }
  if (left.status === 'WAITING_FOR_INPUT' && right.status === 'WAITING_FOR_INPUT') {
    return left.pendingInputKind === right.pendingInputKind;
  }
  if (
    (left.status === 'UNREAD_FAILURE' || left.status === 'UNREAD_RESULT') &&
    (right.status === 'UNREAD_FAILURE' || right.status === 'UNREAD_RESULT')
  ) {
    return left.activityId === right.activityId;
  }
  return true;
}

function isActivePendingForRun(activePendingInput: PendingInputRecord | undefined, runId: RequestRunId): activePendingInput is PendingInputRecord {
  return activePendingInput?.status === 'PENDING' && activePendingInput.requestRunId === runId;
}

function isRunningLikeRun(status: RunStatus, terminalCommitState: TerminalCommitState): boolean {
  return (
    status === 'ACCEPTED' ||
    status === 'QUEUED' ||
    status === 'PLANNING' ||
    status === 'EXECUTING' ||
    terminalCommitState === 'NOT_STARTED' ||
    terminalCommitState === 'PENDING' ||
    terminalCommitState === 'RETRYING'
  );
}

function scopeKey(coordinates: ActivityScopeCoordinates): string {
  return JSON.stringify([coordinates.tenantId, coordinates.subjectId, coordinates.agentId]);
}
