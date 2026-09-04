import { createRequire } from 'node:module';
import { createServer, type Server } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const {
  PROCESS_HISTORY_CAPACITY_TURN_COUNT,
  PROCESS_HISTORY_STRESS_SESSION_ID,
  buildProcessHistoryCapacityFixture,
  buildProcessHistoryStressFixture,
} = require('../../agent-web-mock-server/data/process-history-stress.js') as {
  PROCESS_HISTORY_CAPACITY_TURN_COUNT: number;
  PROCESS_HISTORY_STRESS_SESSION_ID: string;
  buildProcessHistoryCapacityFixture: () => {
    conversation: { items: Array<Record<string, unknown>> };
    previewMarkers: Array<Record<string, unknown>>;
    eventsByRun: Record<string, Array<Record<string, unknown>>>;
  };
  buildProcessHistoryStressFixture: () => {
    session: { sessionId: string; displayTitle: string };
    detail: { sessionId: string; status: string };
    conversation: { sessionId: string; items: Array<Record<string, unknown>> };
    previewMarkers: Array<Record<string, unknown>>;
    eventsByRun: Record<string, Array<Record<string, unknown>>>;
  };
};
const store = require('../../agent-web-mock-server/data/store.js') as {
  createSession: (sessionId: string, locale: string) => unknown;
  recordUserRequest: (
    sessionId: string,
    requestId: string,
    inputText: string,
    submittedAt: string,
    options: { requestContextId: string; runId: string },
  ) => void;
  recordAssistantResponse: (
    sessionId: string,
    requestId: string,
    content: string,
    createdAt: string,
    options: { rootMessageId: string; requestContextId: string; runId: string },
  ) => void;
  recordCapabilityResults: (
    sessionId: string,
    requestId: string,
    capabilityResults: Array<Record<string, unknown>>,
    options: { rootMessageId: string; requestContextId: string; runId: string },
  ) => void;
  getConversation: (
    sessionId: string,
    options: {
      includeCapabilityResults: boolean;
      cursor?: string;
      newerCursor?: string;
      anchorMessageId?: string;
      limit: number;
    },
  ) => {
    items: Array<{ messageId: string; runId?: string }>;
    nextCursor: string | null;
    newerCursor?: string | null;
  } | null;
  getConversationPreview: (
    sessionId: string,
    options: { offset?: number; limit: number },
  ) => {
    sessionId: string;
    totalMarkers: number;
    offset: number;
    limit: number;
    markers: Array<{ messageId: string }>;
  } | null;
  getRunEvents: (
    sessionId: string,
    runId: string,
    options: { afterSequence: number; limit: number },
  ) => {
    availability: 'AVAILABLE';
    events: Array<{ eventType: string; runId: string }>;
    nextAfterSequence?: number;
  } | null;
};

let server: Server;
let baseUrl = '';

beforeAll(async () => {
  server = createServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://127.0.0.1');
    const previewMatch = /^\/api\/v1\/sessions\/([^/]+)\/conversation\/preview$/u.exec(url.pathname);
    const eventsMatch = /^\/api\/v1\/sessions\/([^/]+)\/runs\/([^/]+)\/events$/u.exec(url.pathname);
    const page = previewMatch
      ? store.getConversationPreview(decodeURIComponent(previewMatch[1]!), {
          offset: Number.parseInt(url.searchParams.get('offset') ?? '0', 10),
          limit: Number.parseInt(url.searchParams.get('limit') ?? '100', 10),
        })
      : eventsMatch
        ? store.getRunEvents(decodeURIComponent(eventsMatch[1]!), decodeURIComponent(eventsMatch[2]!), {
            afterSequence: Number.parseInt(url.searchParams.get('afterSequence') ?? '0', 10),
            limit: Number.parseInt(url.searchParams.get('limit') ?? '1000', 10),
          })
        : null;
    response.statusCode = page ? 200 : 404;
    response.setHeader('content-type', 'application/json');
    response.end(JSON.stringify(page ?? { error: 'Not found' }));
  });
  server = await new Promise<Server>((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Mock test server address is unavailable.');
  }
  baseUrl = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
});

describe('process-history stress fixture', () => {
  it('records dynamic conversation messages with run coordinates for history discovery', () => {
    const sessionId = 'session-dynamic-process-history';
    const requestId = 'request-dynamic-process-history';
    const runId = 'run-dynamic-process-history';
    const createdAt = '2026-07-30T05:00:00.000Z';
    store.createSession(sessionId, 'zh-CN');
    store.recordUserRequest(sessionId, requestId, '检查骨干网络延迟', createdAt, {
      requestContextId: requestId,
      runId,
    });
    store.recordCapabilityResults(
      sessionId,
      requestId,
      [
        {
          content: '链路指标采集完成',
          toolCallId: 'tool-dynamic-process-history',
          toolName: 'collectLinkMetrics',
          status: 'COMPLETED',
        },
      ],
      {
        rootMessageId: requestId,
        requestContextId: requestId,
        runId,
      },
    );
    store.recordAssistantResponse(sessionId, requestId, '诊断完成', createdAt, {
      rootMessageId: requestId,
      requestContextId: requestId,
      runId,
    });

    const conversation = store.getConversation(sessionId, {
      includeCapabilityResults: true,
      limit: 100,
    });
    expect(conversation?.items).toHaveLength(3);
    expect(conversation?.items.map((message) => message.runId)).toEqual([runId, runId, runId]);
  });

  it('builds 10,000 user turns with at least two completed thinking and tool lifecycles per turn', () => {
    const fixture = buildProcessHistoryCapacityFixture();

    expect(PROCESS_HISTORY_CAPACITY_TURN_COUNT).toBe(10_000);
    expect(fixture.previewMarkers).toHaveLength(10_000);
    expect(fixture.conversation.items).toHaveLength(40_000);
    expect(Object.keys(fixture.eventsByRun)).toHaveLength(10_000);
    for (const ordinal of [1, 5_000, 10_000]) {
      const events = fixture.eventsByRun[`run-stress-${ordinal}`] ?? [];
      expect(events.filter((item) => item.eventType === 'LLM_THINKING_DELTA')).toHaveLength(2);
      expect(events.filter((item) => item.eventType === 'CAPABILITY_STARTED')).toHaveLength(2);
      expect(events.filter((item) => item.eventType === 'CAPABILITY_COMPLETED')).toHaveLength(2);
    }
  });

  it('builds 200 coordinate-consistent multi-thinking and multi-tool turns', () => {
    const fixture = buildProcessHistoryStressFixture();

    expect(fixture.session.sessionId).toBe(PROCESS_HISTORY_STRESS_SESSION_ID);
    expect(fixture.session.displayTitle).toBe('200轮复杂网络诊断历史');
    expect(fixture.detail.status).toBe('COMPLETED');
    expect(fixture.previewMarkers).toHaveLength(200);
    expect(fixture.conversation.items).toHaveLength(1_000);
    expect(Object.keys(fixture.eventsByRun)).toHaveLength(200);

    for (let ordinal = 1; ordinal <= 200; ordinal += 1) {
      const rootMessageId = `root-stress-${ordinal}`;
      const runId = `run-stress-${ordinal}`;
      const messages = fixture.conversation.items.filter((item) => item.rootMessageId === rootMessageId);
      const events = fixture.eventsByRun[runId] ?? [];

      expect(messages.filter((item) => item.role === 'USER')).toHaveLength(1);
      expect(messages.filter((item) => item.role === 'CAPABILITY_RESULT')).toHaveLength(3);
      expect(messages.filter((item) => item.role === 'ASSISTANT')).toHaveLength(1);
      expect(events.filter((item) => item.eventType === 'LLM_THINKING_DELTA')).toHaveLength(3);
      expect(events.filter((item) => item.eventType === 'CAPABILITY_STARTED')).toHaveLength(3);
      expect(events.filter((item) => item.eventType === 'CAPABILITY_COMPLETED')).toHaveLength(3);
      expect(events.every((item) => item.runId === runId && item.rootMessageId === rootMessageId)).toBe(true);
    }
  });

  it('pages preview markers and run events without cross-run leakage', () => {
    const recentConversation = store.getConversation(PROCESS_HISTORY_STRESS_SESSION_ID, { includeCapabilityResults: true, limit: 120 });
    expect(recentConversation?.items.at(-1)?.messageId).toBe('assistant-stress-200');
    expect(recentConversation?.nextCursor).not.toBeNull();

    const anchoredConversation = store.getConversation(PROCESS_HISTORY_STRESS_SESSION_ID, {
      includeCapabilityResults: true,
      anchorMessageId: 'root-stress-100',
      limit: 120,
    });
    expect(anchoredConversation?.items.some((item) => item.messageId === 'root-stress-100')).toBe(true);
    expect(anchoredConversation?.newerCursor).not.toBeNull();

    const latestPreview = store.getConversationPreview(PROCESS_HISTORY_STRESS_SESSION_ID, { limit: 100 });
    expect(latestPreview?.offset).toBe(100);
    expect(latestPreview?.markers[0]?.messageId).toBe('root-stress-101');

    const preview = store.getConversationPreview(PROCESS_HISTORY_STRESS_SESSION_ID, { offset: 190, limit: 10 });
    expect(preview?.totalMarkers).toBe(200);
    expect(preview?.markers.map((marker) => marker.messageId)).toEqual(Array.from({ length: 10 }, (_, index) => `root-stress-${191 + index}`));

    const page = store.getRunEvents(PROCESS_HISTORY_STRESS_SESSION_ID, 'run-stress-200', { afterSequence: 0, limit: 1_000 });
    expect(page?.availability).toBe('AVAILABLE');
    expect(page?.events).toHaveLength(9);
    expect(page?.events.every((event) => event.runId === 'run-stress-200')).toBe(true);
    expect(store.getRunEvents(PROCESS_HISTORY_STRESS_SESSION_ID, 'run-stress-unknown', { afterSequence: 0, limit: 1_000 })).toBeNull();
  });

  it('projects preview and run events through the existing HTTP contracts', async () => {
    const previewResponse = await fetch(`${baseUrl}/api/v1/sessions/${PROCESS_HISTORY_STRESS_SESSION_ID}/conversation/preview?offset=199&limit=1`);
    expect(previewResponse.status).toBe(200);
    const preview = (await previewResponse.json()) as {
      totalMarkers: number;
      markers: Array<{ messageId: string }>;
    };
    expect(preview.totalMarkers).toBe(200);
    expect(preview.markers[0]?.messageId).toBe('root-stress-200');

    const eventsResponse = await fetch(
      `${baseUrl}/api/v1/sessions/${PROCESS_HISTORY_STRESS_SESSION_ID}/runs/run-stress-200/events?afterSequence=0&limit=1000`,
    );
    expect(eventsResponse.status).toBe(200);
    const events = (await eventsResponse.json()) as {
      availability: string;
      events: Array<{ runId: string }>;
    };
    expect(events.availability).toBe('AVAILABLE');
    expect(events.events).toHaveLength(9);
    expect(events.events.every((event) => event.runId === 'run-stress-200')).toBe(true);

    const unknownResponse = await fetch(
      `${baseUrl}/api/v1/sessions/${PROCESS_HISTORY_STRESS_SESSION_ID}/runs/run-stress-unknown/events?afterSequence=0&limit=1000`,
    );
    expect(unknownResponse.status).toBe(404);
  });
});
