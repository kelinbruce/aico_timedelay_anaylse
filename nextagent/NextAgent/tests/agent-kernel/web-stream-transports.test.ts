import { createNextAgentTestApp } from '@nextagent/agent-platform-gateway-local/testing';
import { AgentError, brand, type IdentityContext, type JsonObject, type TimelineEventType } from '@nextagent/agent-common';
import type { StreamEnvelope } from '@nextagent/agent-contracts/channel';
import type { RunTimelineEvent, RuntimeSessionPort, RuntimeSessionStreamEventsQuery } from '@nextagent/agent-contracts/runtime';
import { deliverWebStream, registerWebChannel, sendSseStream, type WebChannelDependencies } from '@nextagent/agent-channel-web';
import Fastify from 'fastify';
import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { connect } from 'node:net';
import { describe, expect, it } from 'vitest';

const sessionId = brand<string, 'SessionId'>('session-web-stream');
const requestId = brand<string, 'MessageId'>('request-web-stream');
const runId = brand<string, 'RequestRunId'>('run-web-stream');
const identityContext: IdentityContext = {
  tenantId: brand<string, 'TenantId'>('tenant-web-bootstrap'),
  subjectId: brand<string, 'SubjectId'>('subject-web-bootstrap'),
  displayName: 'Bootstrap tester',
};

describe('Web stream SSE and WebSocket transports', () => {
  it('projects backend bootstrap transport kind without client override fields', async () => {
    const app = Fastify();
    await registerWebChannel(app, webChannelDependencies({ transportKind: 'WEBSOCKET' }));

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/runtime/bootstrap?transportKind=SSE&tenantId=evil',
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ transportKind: 'WEBSOCKET' });
    expect(response.body).not.toContain('tenant');
    expect(response.body).not.toContain('credential');
    await app.close();
  });

  it('fails safely when backend bootstrap transport kind is invalid', async () => {
    const app = Fastify();
    await registerWebChannel(app, webChannelDependencies({ transportKind: 'WS' as never }));

    const response = await app.inject({ method: 'GET', url: '/api/v1/runtime/bootstrap' });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({
      error: {
        code: 'WEB_RUNTIME_BOOTSTRAP_TRANSPORT_INVALID',
      },
    });
    await app.close();
  });

  it('routes pending input answers through the runtime boundary with trusted identity and server idempotency', async () => {
    const observed: unknown[] = [];
    const app = Fastify();
    await registerWebChannel(app, {
      ...webChannelDependencies({ transportKind: 'SSE' }),
      runtime: {
        async answerPendingInput(command) {
          observed.push(command);
          return {
            sessionId: command.answer.sessionId,
            pendingInputId: command.answer.pendingInputId,
            status: 'RECEIVED',
          };
        },
      } as WebChannelDependencies['runtime'],
      idempotencyKeyFactory: () => brand<string, 'IdempotencyKey'>('server-answer-idem'),
    });

    const rejected = await app.inject({
      method: 'POST',
      url: `/api/v1/sessions/${sessionId}/pending-inputs/pending-web-answer/answer`,
      payload: { answers: [[]] },
    });
    const accepted = await app.inject({
      method: 'POST',
      url: `/api/v1/sessions/${sessionId}/pending-inputs/pending-web-answer/answer`,
      payload: {
        answers: [['yes']],
        answerKinds: ['CUSTOM_TEXT'],
        idempotencyKey: 'client-idem',
        identityContext: { tenantId: 'evil' },
      },
    });

    expect(rejected.statusCode).toBe(400);
    expect(accepted.statusCode).toBe(200);
    expect(observed).toHaveLength(1);
    expect(observed[0]).toMatchObject({
      identityContext,
      idempotencyKey: 'server-answer-idem',
      answer: {
        sessionId,
        pendingInputId: 'pending-web-answer',
        answers: [['yes']],
        answerKinds: ['CUSTOM_TEXT'],
      },
    });
    expect(JSON.stringify(observed[0])).not.toContain('client-idem');
    expect(JSON.stringify(observed[0])).not.toContain('evil');
    await app.close();
  });

  it('delivers equivalent StreamEnvelope sequences over SSE and WebSocket for the same run', async () => {
    const app = createNextAgentTestApp({
      workspaceDir: process.cwd(),
      modelSteps: [{ content: 'transport equivalent answer' }],
    });
    const accepted = await app.server.inject({
      method: 'POST',
      url: '/api/v1/requests',
      payload: { inputText: 'transport equivalence', idempotencyKey: 'idem-transport-equivalence' },
    });
    const body = accepted.json<{ sessionId: string; runId: string }>();
    await app.runtime.waitForIdle({ timeoutMs: 5_000 });

    const sse = await app.server.inject({ method: 'GET', url: `/api/v1/sessions/${body.sessionId}/stream?lastSeenSequence=0&runId=${body.runId}` });
    expect(sse.body.startsWith(': stream-open\n\n')).toBe(true);
    const sseEnvelopes = parseSseEnvelopes(sse.body);

    const baseUrl = await listenOnRandomPort(app.server);
    const wsEnvelopes = await readWebSocketEnvelopes(
      `${baseUrl.replace('http://', 'ws://')}/api/v1/sessions/${body.sessionId}/ws?lastSeenSequence=0&runId=${body.runId}`,
    );

    expect(wsEnvelopes.map(projectComparableEnvelope)).toEqual(sseEnvelopes.map(projectComparableEnvelope));
    expect(wsEnvelopes.map((envelope) => envelope.eventType)).toEqual(['REQUEST_ACCEPTED', 'REQUEST_COMPLETED']);
  });

  it('maps replay anchors into runtime stream requests and handles terminal scope without owning lifecycle', async () => {
    const observedQueries: RuntimeSessionStreamEventsQuery[] = [];
    const sessions = webSessionFacade({
      async *streamEvents(query) {
        observedQueries.push(query);
        yield timelineEvent('REQUEST_ACCEPTED', 3, { status: 'QUEUED' });
        yield timelineEvent('REQUEST_COMPLETED', 4, { content: 'done' });
        yield timelineEvent('REQUEST_ACCEPTED', 5, { status: 'QUEUED' });
      },
    });

    const requestScoped = await collect(
      deliverWebStream({
        sessions,
        identityContext,
        sessionId,
        requestId,
        runId,
        lastSeenSequence: brand<number, 'TimelineSequence'>(2),
      }),
    );
    expect(requestScoped.map((envelope) => envelope.eventType)).toEqual(['REQUEST_ACCEPTED', 'REQUEST_COMPLETED']);
    expect(observedQueries.at(0)).toMatchObject({
      identityContext,
      sessionId,
      requestId,
      runId,
      lastSeenSequence: brand<number, 'TimelineSequence'>(2),
    });
    expect(observedQueries.at(0)).not.toHaveProperty('agentId');

    const sessionScoped = await collect(
      deliverWebStream({
        sessions,
        identityContext,
        sessionId,
        lastSeenSequence: brand<number, 'TimelineSequence'>(2),
      }),
    );
    expect(sessionScoped.map((envelope) => envelope.eventType)).toEqual(['REQUEST_ACCEPTED', 'REQUEST_COMPLETED', 'REQUEST_ACCEPTED']);
  });

  it('preserves omitted replay anchors for ordinary session live-tail streams', async () => {
    const observedQueries: RuntimeSessionStreamEventsQuery[] = [];
    const sessions = webSessionFacade({
      async *streamEvents(query) {
        observedQueries.push(query);
        yield timelineEvent('REQUEST_ACCEPTED', 1, { status: 'QUEUED' });
      },
    });

    const delivered = await collect(
      deliverWebStream({
        sessions,
        identityContext,
        sessionId,
      }),
    );

    expect(delivered.map((envelope) => envelope.eventType)).toEqual(['REQUEST_ACCEPTED']);
    expect(observedQueries).toHaveLength(1);
    expect(observedQueries[0]).toMatchObject({ identityContext, sessionId });
    expect(observedQueries[0]).not.toHaveProperty('lastSeenSequence');
  });

  it('preserves omitted replay anchors through SSE and WebSocket routes', async () => {
    const observedQueries: RuntimeSessionStreamEventsQuery[] = [];
    const app = Fastify();
    await registerWebChannel(app, {
      ...webChannelDependencies({ transportKind: 'SSE' }),
      sessions: webSessionFacade({
        async requireSession() {
          return {
            tenantId: identityContext.tenantId,
            subjectId: identityContext.subjectId,
            agentId: brand<string, 'AgentId'>('default-agent'),
            sessionId,
            createdAt: brand<number, 'EpochMillis'>(1),
            updatedAt: brand<number, 'EpochMillis'>(2),
            hasInFlightRequest: false,
          };
        },
        async *streamEvents(query) {
          observedQueries.push(query);
          yield timelineEvent('REQUEST_ACCEPTED', observedQueries.length, { status: 'QUEUED' });
        },
      }),
    });

    const sse = await app.inject({ method: 'GET', url: `/api/v1/sessions/${sessionId}/stream` });
    expect(sse.statusCode).toBe(200);
    expect(sse.body.startsWith(': stream-open\n\n')).toBe(true);
    expect(parseSseEnvelopes(sse.body).map((envelope) => envelope.eventType)).toEqual(['REQUEST_ACCEPTED']);

    const baseUrl = await listenOnRandomPort(app);
    const wsEnvelopes = await readWebSocketEnvelopes(`${baseUrl.replace('http://', 'ws://')}/api/v1/sessions/${sessionId}/ws`);
    expect(wsEnvelopes.map((envelope) => envelope.eventType)).toEqual(['REQUEST_ACCEPTED']);

    expect(observedQueries).toHaveLength(2);
    expect(observedQueries[0]).not.toHaveProperty('lastSeenSequence');
    expect(observedQueries[1]).not.toHaveProperty('lastSeenSequence');
    await app.close();
  });

  it('emits safe transport failure without synthesizing a successful terminal event', async () => {
    const sessions = webSessionFacade({
      async *streamEvents() {
        throw new Error('raw timeline failure with C:\\secret.txt');
      },
    });
    const [failure] = await collect(
      deliverWebStream({
        sessions,
        identityContext,
        sessionId,
        requestId,
        runId,
        lastSeenSequence: brand<number, 'TimelineSequence'>(8),
      }),
    );

    expect(failure).toBeDefined();
    expect(failure!.eventType).toBe('DEGRADATION_NOTICE');
    expect(failure!.sequence).toBe(brand<number, 'TimelineSequence'>(8));
    expect(failure!.payload.code).toBe('TIMELINE_STREAM_READ_FAILED');
    expect(failure!.payload.refreshConversation).toBe(true);
    expect(JSON.stringify(failure!.payload)).not.toContain('C:\\secret.txt');
    expect(failure!.eventType).not.toBe('REQUEST_COMPLETED');
  });

  it('preserves runtime facade safe errors in Web stream notices', async () => {
    const sessions = webSessionFacade({
      async *streamEvents() {
        throw new AgentError({
          code: 'STREAM_FILTER_NOT_FOUND',
          message: 'Stream could not be opened. The request may not have started yet.',
          category: 'NOT_FOUND',
          retryable: false,
          safeDetails: { reasonCode: 'STREAM_FILTER_NOT_FOUND' },
        });
      },
    });
    const [failure] = await collect(
      deliverWebStream({
        sessions,
        identityContext,
        sessionId,
        requestId,
        runId,
        lastSeenSequence: brand<number, 'TimelineSequence'>(8),
      }),
    );

    expect(failure).toBeDefined();
    expect(failure!.eventType).toBe('DEGRADATION_NOTICE');
    expect(failure!.sequence).toBe(brand<number, 'TimelineSequence'>(8));
    expect(failure!.payload.code).toBe('STREAM_FILTER_NOT_FOUND');
    expect(failure!.payload.category).toBe('NOT_FOUND');
    expect(failure!.payload.retryable).toBe(false);
    expect(failure!.payload.reasonCode).toBe('STREAM_FILTER_NOT_FOUND');
  });

  it('carries stream resume gap details without advancing the cursor', async () => {
    const sessions = webSessionFacade({
      async *streamEvents() {
        throw new AgentError({
          code: 'STREAM_RESUME_GAP',
          message: 'Stream resume gap requires conversation refresh.',
          category: 'UNAVAILABLE',
          retryable: true,
          safeDetails: {
            kind: 'STREAM_RESUME_GAP',
            reason: 'SEQUENCE_GAP',
            refreshConversation: true,
            resumeAfterSequence: 13,
          },
        });
      },
    });
    const [failure] = await collect(
      deliverWebStream({
        sessions,
        identityContext,
        sessionId,
        requestId,
        runId,
        lastSeenSequence: brand<number, 'TimelineSequence'>(8),
      }),
    );

    expect(failure).toBeDefined();
    expect(failure!.eventType).toBe('DEGRADATION_NOTICE');
    expect(failure!.sequence).toBe(brand<number, 'TimelineSequence'>(8));
    expect(failure!.payload).toMatchObject({
      code: 'STREAM_RESUME_GAP',
      kind: 'STREAM_RESUME_GAP',
      reason: 'SEQUENCE_GAP',
      refreshConversation: true,
      resumeAfterSequence: 13,
    });
  });

  it('keeps degradation notice sequence on the last timeline-backed cursor when runtime stream data regresses', async () => {
    const sessions = webSessionFacade({
      async *streamEvents() {
        yield timelineEvent('REQUEST_ACCEPTED', 3, { status: 'QUEUED' });
      },
    });
    const [failure] = await collect(
      deliverWebStream({
        sessions,
        identityContext,
        sessionId,
        requestId,
        runId,
        lastSeenSequence: brand<number, 'TimelineSequence'>(4),
      }),
    );

    expect(failure).toBeDefined();
    expect(failure!.eventType).toBe('DEGRADATION_NOTICE');
    expect(failure!.sequence).toBe(brand<number, 'TimelineSequence'>(4));
    expect(failure!.payload.code).toBe('STREAM_SEQUENCE_REGRESSED');
    expect(failure!.payload.refreshConversation).toBe(true);
  });

  it('does not advance the cursor for projection failure notices', async () => {
    const sessions = webSessionFacade({
      async *streamEvents() {
        yield timelineEvent('REQUEST_ACCEPTED', 5, { status: 'QUEUED' });
        yield { ...timelineEvent('REQUEST_ACCEPTED', 6, { content: 'deprecated' }), type: 'CONTENT_DELTA' as TimelineEventType };
        yield timelineEvent('LLM_CONTENT_DELTA', 7, { content: 'must not be sent' });
      },
    });

    const projected = await collect(
      deliverWebStream({
        sessions,
        identityContext,
        sessionId,
        requestId,
        runId,
        lastSeenSequence: brand<number, 'TimelineSequence'>(4),
      }),
    );

    expect(projected.map((event) => event.eventType)).toEqual(['REQUEST_ACCEPTED', 'DEGRADATION_NOTICE']);
    expect(projected.map((event) => event.sequence)).toEqual([brand<number, 'TimelineSequence'>(5), brand<number, 'TimelineSequence'>(5)]);
    expect(projected[1]?.payload.code).toBe('DEPRECATED_STREAM_EVENT_NAME');
    expect(JSON.stringify(projected)).not.toContain('must not be sent');
  });

  it('emits a safe timeout outcome when timeline replay read does not return', async () => {
    const diagnostics: unknown[] = [];
    let streamSignal: AbortSignal | undefined;
    const sessions = webSessionFacade({
      async *streamEvents(query) {
        streamSignal = query.signal;
        await new Promise<never>(() => undefined);
      },
    });
    const result = await Promise.race([
      collect(
        deliverWebStream({
          sessions,
          identityContext,
          sessionId,
          requestId,
          runId,
          lastSeenSequence: brand<number, 'TimelineSequence'>(11),
          timelineReadTimeoutMs: 5,
          onDiagnostic: (diagnostic) => diagnostics.push(diagnostic),
        }),
      ),
      timeoutValue('timed-out', 100),
    ]);

    expect(result).not.toBe('timed-out');
    const [failure] = result as StreamEnvelope[];
    expect(failure).toBeDefined();
    expect(failure!.eventType).toBe('DEGRADATION_NOTICE');
    expect(failure!.sequence).toBe(brand<number, 'TimelineSequence'>(11));
    expect(failure!.payload.code).toBe('TIMELINE_READ_TIMEOUT');
    expect(failure!.payload.refreshConversation).toBe(true);
    expect(streamSignal?.aborted).toBe(true);
    expect(JSON.stringify(diagnostics)).not.toContain(sessionId);
    expect(JSON.stringify(diagnostics)).not.toContain(requestId);
    expect(JSON.stringify(diagnostics)).not.toContain(runId);
  });

  it('stops SSE delivery safely when the transport never drains backpressure', async () => {
    const diagnostics: unknown[] = [];
    const raw = new BackpressureRawResponse();
    const reply = {
      raw,
      hijack() {
        return undefined;
      },
    };

    const result = await Promise.race([
      sendSseStream(reply as never, streamEnvelopes([streamEnvelope(21)]), {
        streamBackpressureTimeoutMs: 5,
        onDiagnostic: (diagnostic) => diagnostics.push(diagnostic),
      }).then(() => 'completed'),
      timeoutValue('timed-out', 100),
    ]);

    expect(result).toBe('completed');
    expect(raw.ended).toBe(true);
    expect(JSON.stringify(diagnostics)).toContain('BACKPRESSURE_TIMEOUT');
    expect(JSON.stringify(diagnostics)).not.toContain(sessionId);
    expect(JSON.stringify(diagnostics)).not.toContain(requestId);
    expect(JSON.stringify(diagnostics)).not.toContain(runId);
  });

  it('rejects invalid WebSocket replay anchors and owner fields before runtime subscription', async () => {
    const app = createNextAgentTestApp({ workspaceDir: process.cwd(), modelSteps: [{ content: 'ok' }] });
    const session = await app.server.inject({ method: 'POST', url: '/api/v1/sessions', payload: {} });
    const { sessionId: liveSessionId } = session.json<{ sessionId: string }>();
    const baseUrl = await listenOnRandomPort(app.server);
    const port = Number(new URL(baseUrl).port);

    const invalidAnchor = await readUpgradeResponse(port, `/api/v1/sessions/${liveSessionId}/ws?lastSeenSequence=-1`);
    expect(invalidAnchor).toContain('HTTP/1.1 400');
    expect(invalidAnchor).toContain('STREAM_REPLAY_ANCHOR_INVALID');

    const ownerOverride = await readUpgradeResponse(port, `/api/v1/sessions/${liveSessionId}/ws?lastSeenSequence=0&tenantId=evil`);
    expect(ownerOverride).toContain('HTTP/1.1 400');
    expect(ownerOverride).toContain('WEBSOCKET_STREAM_QUERY_INVALID');
  });

  it('keeps the WebSocket adapter free of lifecycle-changing private commands', async () => {
    const websocketSource = await readFile('packages/agent-channel-web/src/transports/websocket.ts', 'utf8');
    const routesSource = await readFile('packages/agent-channel-web/src/routes/requests.ts', 'utf8');
    const deliverySource = await readFile('packages/agent-channel-web/src/transports/web-stream-delivery.ts', 'utf8');

    expect(routesSource).not.toContain('RuntimeEventStreamPort');
    expect(routesSource).not.toContain('RuntimeEventStreamQuery');
    expect(routesSource).not.toContain('RunTimelineEventRecordQuery');
    expect(routesSource).not.toContain('eventStream:');
    expect(deliverySource).not.toContain('RuntimeEventStreamPort');
    expect(deliverySource).not.toContain('RuntimeEventStreamQuery');
    expect(deliverySource).not.toContain('RunTimelineEventRecordQuery');
    expect(websocketSource).not.toContain('RuntimeEventStreamPort');
    expect(websocketSource).not.toContain('RuntimeEventStreamQuery');
    expect(websocketSource).not.toContain('RunTimelineEventRecordQuery');
    expect(websocketSource).not.toContain('runtime.cancel');
    expect(websocketSource).not.toContain('answerPendingInput');
    expect(websocketSource).not.toContain('retryLatest');
    expect(websocketSource).not.toContain('REQUEST_CANCELED');
    expect(websocketSource).not.toContain('RequestRunStore');
    expect(websocketSource).toContain('streamBackpressureTimeoutMs');
    expect(websocketSource).toContain('BACKPRESSURE_TIMEOUT');
    expect(websocketSource).toContain('waitForSocketDrain');
  });

  it('projects activeRun only on the conversation top-level response', async () => {
    const app = Fastify();
    await registerWebChannel(app, webChannelDependencies({ transportKind: 'SSE' }));

    const conversation = await app.inject({
      method: 'GET',
      url: '/api/v1/sessions/session-web-stream/conversation',
    });
    const sessions = await app.inject({ method: 'GET', url: '/api/v1/sessions' });

    expect(conversation.statusCode).toBe(200);
    expect(conversation.json()).toMatchObject({
      items: [],
      activeRun: {
        requestId: 'request-web-stream',
        runId: 'run-web-stream',
        status: 'EXECUTING',
      },
    });
    expect(Object.keys(conversation.json().activeRun)).toEqual(['requestId', 'runId', 'status']);
    expect(sessions.statusCode).toBe(200);
    expect(sessions.body).not.toContain('activeRun');
    expect(sessions.json()).toMatchObject({
      entries: [
        {
          lastRunStatus: 'EXECUTING',
          hasInFlightRequest: true,
        },
      ],
    });
    await app.close();
  });
});

function webChannelDependencies(runtimeBootstrap: WebChannelDependencies['runtimeBootstrap']): WebChannelDependencies {
  return {
    runtime: {} as WebChannelDependencies['runtime'],
    sessions: webSessionFacade({
      async requireSession() {
        return {
          tenantId: identityContext.tenantId,
          subjectId: identityContext.subjectId,
          agentId: brand<string, 'AgentId'>('default-agent'),
          sessionId,
          createdAt: brand<number, 'EpochMillis'>(1),
          updatedAt: brand<number, 'EpochMillis'>(2),
          latestRunStatus: 'EXECUTING',
          hasInFlightRequest: true,
        };
      },
      async listSessions() {
        return {
          entries: [
            {
              tenantId: identityContext.tenantId,
              subjectId: identityContext.subjectId,
              agentId: brand<string, 'AgentId'>('default-agent'),
              sessionId,
              createdAt: brand<number, 'EpochMillis'>(1),
              updatedAt: brand<number, 'EpochMillis'>(2),
              latestRunStatus: 'EXECUTING',
              hasInFlightRequest: true,
            },
          ],
          offset: 0,
          limit: 50,
          hasMore: false,
        };
      },
      async listMessages() {
        return { items: [], limit: 50, hasMore: false };
      },
      async getActiveRun() {
        return { requestId, runId, status: 'EXECUTING' };
      },
      async getRequestSummary() {
        return undefined;
      },
    }),
    identityResolver: () => identityContext,
    runtimeBootstrap,
    skillCatalog: { listSkills: async () => ({ total: 0, pageNum: 1, pageSize: 50, skills: [] }) },
    defaultAgentId: brand<string, 'AgentId'>('default-agent'),
  };
}

function webSessionFacade(overrides: Partial<RuntimeSessionPort>): RuntimeSessionPort {
  return {
    async createSession() {
      throw new Error('not used');
    },
    async requireSession() {
      throw new Error('not used');
    },
    async listSessions() {
      throw new Error('not used');
    },
    async deleteSession() {
      throw new Error('not used');
    },
    async forkFromMessage() {
      throw new Error('not used');
    },
    async forkFromRequest() {
      throw new Error('not used');
    },
    async listMessages() {
      throw new Error('not used');
    },
    async listConversationPreview() {
      throw new Error('not used');
    },
    async updateTitle() {
      throw new Error('not used');
    },
    async *streamEvents() {
      yield* [];
    },
    async listEvents() {
      return { availability: 'AVAILABLE', events: [] };
    },
    async getActiveRun() {
      return undefined;
    },
    async getRequestSummary() {
      return undefined;
    },
    ...overrides,
  };
}

function timelineEvent(type: TimelineEventType, sequence: number, inlinePayload: JsonObject = {}): RunTimelineEvent {
  return {
    eventId: `timeline-${sequence}`,
    sessionId,
    requestId,
    runId,
    requestContextId: brand<string, 'RequestContextId'>('context-web-stream'),
    sequence: brand<number, 'TimelineSequence'>(sequence),
    type,
    inlinePayload,
    createdAt: new Date(sequence),
  };
}

function parseSseEnvelopes(body: string): StreamEnvelope[] {
  return body
    .split('\n')
    .filter((line) => line.startsWith('data: '))
    .map((line) => JSON.parse(line.slice('data: '.length)) as StreamEnvelope);
}

function projectComparableEnvelope(envelope: StreamEnvelope): Pick<StreamEnvelope, 'eventType' | 'sequence' | 'payload'> {
  return {
    eventType: envelope.eventType,
    sequence: envelope.sequence,
    payload: envelope.payload,
  };
}

async function listenOnRandomPort(server: ReturnType<typeof createNextAgentTestApp>['server']): Promise<string> {
  if (server.server.listening) {
    const address = server.server.address();
    if (address !== null && typeof address === 'object') {
      return `http://127.0.0.1:${address.port}`;
    }
  }
  await server.listen({ host: '127.0.0.1', port: 0 });
  const address = server.server.address();
  if (address === null || typeof address !== 'object') {
    throw new Error('Fastify test server did not expose a TCP address.');
  }
  return `http://127.0.0.1:${address.port}`;
}

async function readWebSocketEnvelopes(url: string): Promise<StreamEnvelope[]> {
  const WebSocketCtor = (globalThis as unknown as { WebSocket: new (url: string) => TestWebSocket }).WebSocket;
  return new Promise((resolve, reject) => {
    const socket = new WebSocketCtor(url);
    const envelopes: StreamEnvelope[] = [];
    const timeout = setTimeout(() => {
      socket.close();
      reject(new Error('WebSocket test timed out.'));
    }, 2_000);
    socket.onmessage = (event) => {
      envelopes.push(JSON.parse(String(event.data)) as StreamEnvelope);
    };
    socket.onerror = () => {
      clearTimeout(timeout);
      reject(new Error('WebSocket stream failed.'));
    };
    socket.onclose = () => {
      clearTimeout(timeout);
      resolve(envelopes);
    };
  });
}

interface TestWebSocket {
  onmessage: ((event: { readonly data: unknown }) => void) | null;
  onerror: (() => void) | null;
  onclose: (() => void) | null;
  close: () => void;
}

async function readUpgradeResponse(port: number, path: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const socket = connect({ host: '127.0.0.1', port });
    const chunks: Buffer[] = [];
    socket.setTimeout(2_000);
    socket.on('connect', () => {
      socket.write(
        [
          `GET ${path} HTTP/1.1`,
          `Host: 127.0.0.1:${port}`,
          'Upgrade: websocket',
          'Connection: Upgrade',
          `Sec-WebSocket-Key: ${randomBytes(16).toString('base64')}`,
          'Sec-WebSocket-Version: 13',
          '',
          '',
        ].join('\r\n'),
      );
    });
    socket.on('data', (chunk) => chunks.push(chunk));
    socket.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    socket.on('timeout', () => {
      socket.destroy();
      reject(new Error('Upgrade response timed out.'));
    });
    socket.on('error', reject);
  });
}

async function collect<T>(items: AsyncIterable<T>): Promise<T[]> {
  const collected: T[] = [];
  for await (const item of items) {
    collected.push(item);
  }
  return collected;
}

async function timeoutValue<T>(value: T, timeoutMs: number): Promise<T> {
  return new Promise((resolve) => {
    setTimeout(() => resolve(value), timeoutMs);
  });
}

async function* streamEnvelopes(envelopes: readonly StreamEnvelope[]): AsyncIterable<StreamEnvelope> {
  yield* envelopes;
}

function streamEnvelope(sequence: number): StreamEnvelope {
  return {
    eventId: `stream-${sequence}`,
    sessionId,
    requestId,
    runId,
    sequence: brand<number, 'TimelineSequence'>(sequence),
    eventType: 'LLM_CONTENT_DELTA',
    transportHints: [],
    payload: {
      rootMessageId: requestId,
      requestId,
      runId,
      content: 'delta',
      text: 'delta',
      contentType: 'MARKDOWN',
      role: 'ASSISTANT',
      metadata: { accumulated: true },
    },
    createdAt: brand<number, 'EpochMillis'>(sequence),
  };
}

class BackpressureRawResponse {
  destroyed = false;
  ended = false;

  writeHead(): void {
    return undefined;
  }

  write(): boolean {
    return false;
  }

  end(): void {
    this.ended = true;
  }

  once(): this {
    return this;
  }

  off(): this {
    return this;
  }
}
