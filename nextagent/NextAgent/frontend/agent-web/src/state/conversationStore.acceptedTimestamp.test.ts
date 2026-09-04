import { describe, expect, it, beforeEach } from 'vitest';
import type { StreamEnvelope } from './contracts.ts';
import { useConversationStore } from './conversationStore.ts';
import { useRequestStore } from './requestStore.ts';

const EMPTY_TS = '';
const SERVER_TS = '2026-08-11T11:33:01.000Z';
const CLOCK_SKEW_SERVER_TS = '2026-08-11T11:25:01.000Z';

function makeOptimisticUserEnvelope(sessionId: string, rootMessageId: string, requestContextId: string, createdAt: string | number): StreamEnvelope {
  return {
    eventId: `temp-${rootMessageId}`,
    sessionId,
    requestId: rootMessageId,
    runId: null,
    rootMessageId,
    requestContextId,
    sequence: 0,
    eventType: 'REQUEST_ACCEPTED',
    timelineEventRef: null,
    transportHints: ['local-optimistic'],
    payload: {
      content: 'hello',
      text: 'hello',
      contentType: 'PLAIN_TEXT',
      role: 'USER',
      messageId: rootMessageId,
      rootMessageId,
      metadata: { accumulated: true },
    },
    createdAt,
  } as StreamEnvelope;
}

function collectAllEnvelopes(sessionId: string): StreamEnvelope[] {
  return [
    ...(useConversationStore.getState().historyEnvelopesBySession[sessionId] ?? []),
    ...Object.values(useConversationStore.getState().activeLiveBySession[sessionId] ?? {}).flatMap((b) => b?.envelopes ?? []),
    ...Object.values(useConversationStore.getState().settledLiveBySession[sessionId] ?? {}).flatMap((b) => b?.envelopes ?? []),
  ];
}

function findOptimisticUserEnvelope(sessionId: string): StreamEnvelope | undefined {
  return collectAllEnvelopes(sessionId).find((env: StreamEnvelope) => env.transportHints.includes('local-optimistic') && env.payload.role === 'USER');
}

describe('reconcileOptimisticRequest: acceptedAt overwrites empty createdAt', () => {
  beforeEach(() => {
    useConversationStore.getState().clearConversation('session-ts-1');
    useConversationStore.getState().clearConversation('session-ts-2');
    useConversationStore.getState().clearConversation('session-ts-3');
    useRequestStore.setState({ pendingRequest: null, requestStatus: 'idle' });
  });

  it('replaces empty timestamp with server timestamp (reconcileLayer path)', () => {
    const sessionId = 'session-ts-1';
    const store = useConversationStore.getState();

    const optimisticEnv = makeOptimisticUserEnvelope(sessionId, 'opt-root-1', 'opt-ctx-1', EMPTY_TS);
    store.appendEnvelope(sessionId, optimisticEnv);

    useConversationStore.getState().reconcileOptimisticRequest(sessionId, 'opt-root-1', {
      rootMessageId: 'accepted-root-1',
      runId: 'accepted-run-1',
      requestContextId: 'accepted-ctx-1',
      acceptedAt: SERVER_TS,
    });

    const userEnvelope = findOptimisticUserEnvelope(sessionId);
    expect(userEnvelope).toBeDefined();
    expect(userEnvelope!.createdAt).toBe(SERVER_TS);
  });

  it('replaces empty timestamp with server timestamp (carryLocalOptimisticUserAnchor path)', () => {
    const sessionId = 'session-ts-2';
    const store = useConversationStore.getState();

    const optimisticEnv = makeOptimisticUserEnvelope(sessionId, 'accepted-root-2', 'opt-ctx-2', EMPTY_TS);
    store.appendEnvelope(sessionId, optimisticEnv);

    useConversationStore.getState().reconcileOptimisticRequest(sessionId, 'accepted-root-2', {
      rootMessageId: 'accepted-root-2',
      runId: 'accepted-run-2',
      requestContextId: 'accepted-ctx-2',
      acceptedAt: SERVER_TS,
    });

    const liveBuckets = useConversationStore.getState().activeLiveBySession[sessionId] ?? {};
    const bucket = liveBuckets['accepted-root-2'];
    expect(bucket).toBeDefined();

    const userEnvelope = bucket!.envelopes.find(
      (env: StreamEnvelope) => env.transportHints.includes('local-optimistic') && env.payload.role === 'USER',
    );
    expect(userEnvelope).toBeDefined();
    expect(userEnvelope!.createdAt).toBe(SERVER_TS);
  });

  it('applies server timestamp via acceptRequestFromStream early-return path', () => {
    const sessionId = 'session-ts-3';
    const store = useConversationStore.getState();
    const requestStore = useRequestStore.getState();

    const optimisticEnv = makeOptimisticUserEnvelope(sessionId, 'opt-root-3', 'opt-ctx-3', EMPTY_TS);
    store.appendEnvelope(sessionId, optimisticEnv);

    // Simulate HTTP arriving first: identity already set, no acceptedAt.
    useRequestStore.setState({
      isSubmittingRequest: true,
      requestStatus: 'submitting',
      activeRequestSessionId: sessionId,
      pendingRequest: {
        kind: 'submit',
        sessionId,
        idempotencyKey: 'key-3',
        startedAtMs: Date.now(),
        optimisticRequestId: 'opt-root-3',
        acceptedRootMessageId: 'accepted-root-3',
        acceptedRunId: 'accepted-run-3',
        acceptedRequestContextId: 'accepted-ctx-3',
        httpIdentityConfirmed: true,
      },
    });

    // Stream REQUEST_ACCEPTED arrives with server createdAt.
    const streamAcceptedEnvelope: StreamEnvelope = {
      eventId: 'evt-stream-accepted-3',
      sessionId,
      requestId: 'accepted-root-3',
      runId: 'accepted-run-3',
      rootMessageId: 'accepted-root-3',
      requestContextId: 'accepted-ctx-3',
      sequence: 1,
      eventType: 'REQUEST_ACCEPTED',
      timelineEventRef: null,
      transportHints: [],
      payload: {
        content: 'hello',
        text: 'hello',
        contentType: 'PLAIN_TEXT',
        role: 'USER',
        messageId: 'accepted-root-3',
        rootMessageId: 'accepted-root-3',
        metadata: { accumulated: true },
      },
      createdAt: SERVER_TS,
    } as StreamEnvelope;

    requestStore.acceptRequestFromStream(streamAcceptedEnvelope);

    const userEnvelope = findOptimisticUserEnvelope(sessionId);
    expect(userEnvelope).toBeDefined();
    expect(userEnvelope!.createdAt).toBe(SERVER_TS);
  });

  it('accepts stream REQUEST_ACCEPTED when server clock is behind browser clock', () => {
    const sessionId = 'session-ts-4';
    const store = useConversationStore.getState();
    const requestStore = useRequestStore.getState();

    const optimisticEnv = makeOptimisticUserEnvelope(sessionId, 'opt-root-4', 'opt-ctx-4', EMPTY_TS);
    store.appendEnvelope(sessionId, optimisticEnv);

    // Browser clock is 8 minutes ahead: startedAtMs is "now" in browser time.
    useRequestStore.setState({
      isSubmittingRequest: true,
      requestStatus: 'submitting',
      activeRequestSessionId: sessionId,
      pendingRequest: {
        kind: 'submit',
        sessionId,
        idempotencyKey: 'key-4',
        startedAtMs: Date.now(),
        optimisticRequestId: 'opt-root-4',
        httpIdentityConfirmed: false,
      },
    });

    // Stream REQUEST_ACCEPTED arrives with server timestamp that is 8 minutes behind browser.
    const streamAcceptedEnvelope: StreamEnvelope = {
      eventId: 'evt-stream-accepted-4',
      sessionId,
      requestId: 'accepted-root-4',
      runId: 'accepted-run-4',
      rootMessageId: 'accepted-root-4',
      requestContextId: 'accepted-ctx-4',
      sequence: 1,
      eventType: 'REQUEST_ACCEPTED',
      timelineEventRef: null,
      transportHints: [],
      payload: {
        content: 'hello',
        text: 'hello',
        contentType: 'PLAIN_TEXT',
        role: 'USER',
        messageId: 'accepted-root-4',
        rootMessageId: 'accepted-root-4',
        metadata: { accumulated: true },
      },
      createdAt: CLOCK_SKEW_SERVER_TS,
    } as StreamEnvelope;

    const accepted = requestStore.acceptRequestFromStream(streamAcceptedEnvelope);
    expect(accepted).toBe(true);

    const userEnvelope = findOptimisticUserEnvelope(sessionId);
    expect(userEnvelope).toBeDefined();
    expect(userEnvelope!.createdAt).toBe(CLOCK_SKEW_SERVER_TS);
  });
});
