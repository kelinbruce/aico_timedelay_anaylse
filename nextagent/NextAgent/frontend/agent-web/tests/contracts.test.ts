import { describe, expect, it } from 'vitest';

import {
  RUN_STATUSES,
  SESSION_MESSAGE_ROLES,
  STREAM_EVENT_TYPES,
  TRANSPORT_KINDS,
  USER_INPUT_KINDS,
  type AttachmentRef,
  type RequestState,
  type RunStatus,
  type SessionConversationPage,
  type SessionConversationQuery,
  type SessionHistoryEntry,
  type StreamEnvelope,
  type TransportState,
  isTerminalStreamEvent,
} from '../src/state/contracts.ts';

describe('frontend shared contracts', () => {
  it('keeps transport values aligned with backend deployment selection', () => {
    expect(TRANSPORT_KINDS).toEqual(['SSE', 'WEBSOCKET']);

    const state: TransportState = {
      kind: 'SSE',
      status: 'CONNECTED',
      streamPath: '/api/v1/sessions/sess-1/stream',
      websocketPath: '/api/v1/sessions/sess-1/ws',
      lastSeenSequence: 4,
    };

    expect(state.kind).toBe('SSE');
  });

  it('represents session history projection used by the sidebar', () => {
    const entry: SessionHistoryEntry = {
      sessionId: 'sess-1',
      displayTitle: 'Inspect OTN route',
      lastActivityAt: '2026-04-11T12:00:00Z',
    };

    expect(entry.displayTitle).toBe('Inspect OTN route');
    expect(Object.keys(entry).sort()).toEqual(['displayTitle', 'lastActivityAt', 'sessionId']);
  });

  it('RunStatus values match backend enum exactly', () => {
    // Backend: agent-common/src/index.ts RunStatus
    expect(RUN_STATUSES).toEqual(['ACCEPTED', 'QUEUED', 'PLANNING', 'EXECUTING', 'COMPLETED', 'FAILED', 'CANCELED', 'SUPERSEDED']);
    type StatusEntry = (typeof RUN_STATUSES)[number];
    const terminalStatuses: StatusEntry[] = ['COMPLETED', 'FAILED', 'CANCELED', 'SUPERSEDED'];
    terminalStatuses.forEach((s) => {
      const asStatus: RunStatus = s;
      expect(asStatus).toBe(s);
    });
  });

  it('represents accepted requests with attachment refs and latest-version fields', () => {
    const attachment: AttachmentRef = {
      attachmentId: 'att-1',
      fileName: 'network-plan.pdf',
      mediaType: 'PDF',
      sizeBytes: 1024,
    };

    const request: RequestState = {
      requestId: 'req-1',
      sessionId: 'sess-1',
      inputText: 'Analyze this topology',
      language: 'EN',
      attachments: [attachment],
      requestedAt: '2026-04-11T12:00:00Z',
      status: 'EXECUTING',
      activeRequestContextId: 'ctx-1',
      latestAgentResponseId: null,
      supersededByRequestId: null,
      isLatestVisibleVersion: true,
    };

    expect(request.attachments).toHaveLength(1);
  });

  it('keeps stream envelopes identical across SSE and WebSocket delivery', () => {
    expect(STREAM_EVENT_TYPES).toContain('LLM_CONTENT_DELTA');
    expect(STREAM_EVENT_TYPES).toContain('LLM_CONTENT_DELTA');

    expect(STREAM_EVENT_TYPES).toContain('BACKGROUND_TASK_STARTED');
    expect(STREAM_EVENT_TYPES).toContain('BACKGROUND_TASK_COMPLETED');
    expect(STREAM_EVENT_TYPES).toContain('BACKGROUND_TASK_FAILED');

    const envelope: StreamEnvelope = {
      eventId: 'evt-1',
      sessionId: 'sess-1',
      requestId: 'req-1',
      sequence: 5,
      eventType: 'REQUEST_COMPLETED',
      timelineEventRef: 'timeline-evt-1',
      transportHints: ['replayable'],
      payload: { agentResponseRef: 'response-1' },
      createdAt: '2026-04-11T12:00:01Z',
    };

    expect(isTerminalStreamEvent(envelope.eventType)).toBe(true);
  });

  it('accepts NextAgent session roles, pending input kinds, and epoch-millis timestamps', () => {
    expect(SESSION_MESSAGE_ROLES).toContain('SUMMARY');
    expect(USER_INPUT_KINDS).toEqual(expect.arrayContaining(['QUESTION', 'AUTHORIZATION', 'HUMAN_HANDOFF']));

    const entry: SessionHistoryEntry = {
      sessionId: 'sess-1',
      displayTitle: 'Inspect OTN route',
      lastActivityAt: Date.parse('2026-04-11T12:00:00Z'),
    };
    const envelope: StreamEnvelope = {
      eventId: 'evt-1',
      sessionId: 'sess-1',
      requestId: 'req-1',
      sequence: 5,
      eventType: 'REQUEST_COMPLETED',
      timelineEventRef: 'timeline-evt-1',
      transportHints: ['replayable'],
      payload: { agentResponseRef: 'response-1' },
      createdAt: Date.parse('2026-04-11T12:00:01Z'),
    };

    expect(typeof entry.lastActivityAt).toBe('number');
    expect(typeof envelope.createdAt).toBe('number');
  });

  it('models paged session conversation loading separately from stream replay', () => {
    const query: SessionConversationQuery = {
      sessionId: 'sess-1',
      cursor: null,
      limit: 20,
      includeCapabilityResults: true,
    };

    const page: SessionConversationPage = {
      sessionId: 'sess-1',
      items: [
        {
          messageId: 'msg-user-1',
          sessionId: 'sess-1',
          requestContextId: null,
          role: 'USER',
          sequence: 1,
          content: 'Inspect this transport path.',
          contentType: 'PLAIN_TEXT',
          metadata: {},
          createdAt: '2026-04-11T12:00:00Z',
          visible: true,
        },
        {
          messageId: 'msg-cap-1',
          sessionId: 'sess-1',
          requestContextId: 'req-1',
          role: 'CAPABILITY_RESULT',
          sequence: 2,
          content: 'Tool inspection result',
          contentType: 'MARKDOWN',
          metadata: { capabilityId: 'builtin-cli-diagnose' },
          createdAt: '2026-04-11T12:00:01Z',
          visible: true,
        },
      ],
      nextCursor: 'cursor-2',
    };

    expect(query.includeCapabilityResults).toBe(true);
    expect(page.items[1]?.role).toBe('CAPABILITY_RESULT');
  });

  it('rejects unsupported literal values at compile time', () => {
    // @ts-expect-error The frontend must not invent a third transport.
    const transport: TransportState = { kind: 'LONG_POLL', status: 'IDLE', lastSeenSequence: 0 };

    const attachment: AttachmentRef = {
      attachmentId: 'att-2',
      fileName: 'photo.png',
      // @ts-expect-error Attachment types are a shared closed vocabulary.
      mediaType: 'IMAGE',
      sizeBytes: 12,
    };

    expect(transport).toBeDefined();
    expect(attachment).toBeDefined();
  });
});
