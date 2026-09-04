import { registerWebChannel, projectTimelineEventToStreamEnvelope } from '@nextagent/agent-channel-web';
import type { CapabilityResultPresentationPolicy } from '@nextagent/agent-channel-common';
import { brand, type JsonObject } from '@nextagent/agent-common';
import type { RuntimeCommandPort, RuntimeSessionPort, RunTimelineEvent, SkillCatalogQueryPort } from '@nextagent/agent-contracts/runtime';
import Fastify from 'fastify';
import { describe, expect, it, vi } from 'vitest';

describe('conversation answer projection', () => {
  it('projects bounded AskUserQuestion answers identically for stream and conversation', async () => {
    const answerPayload = {
      capabilityId: 'AskUserQuestion',
      toolCallId: 'ask-user-1',
      pendingInputId: 'pending-1',
      kind: 'QUESTION',
      status: 'RECEIVED',
      safeSummary: 'Pending input answer received.',
      answers: [Array.from({ length: 10 }, (_, index) => `answer-${index + 1}`), ['😀'.repeat(4_100)], ['third-group'], ['fourth-group']],
    } as const;
    const app = Fastify();
    await registerWebChannel(
      app,
      makeDependencies(async (query) => ({
        items: [
          {
            messageId: brand<string, 'MessageId'>('message-answer-result'),
            sessionId: query.sessionId,
            requestId: brand<string, 'MessageId'>('request-answer-result'),
            runId: brand<string, 'RequestRunId'>('run-answer-result'),
            role: 'CAPABILITY_RESULT',
            content: JSON.stringify({
              toolCallId: answerPayload.toolCallId,
              toolName: answerPayload.capabilityId,
              payload: {
                pendingInputId: answerPayload.pendingInputId,
                kind: answerPayload.kind,
                status: answerPayload.status,
                safeSummary: answerPayload.safeSummary,
                answers: answerPayload.answers,
              },
            }),
            contentType: 'PLAIN_TEXT',
            metadata: { kind: 'CAPABILITY_RESULT', toolCallId: answerPayload.toolCallId, toolName: answerPayload.capabilityId },
            sequence: 1,
            visible: true,
            createdAt: brand<number, 'EpochMillis'>(1),
          },
        ],
        limit: query.limit,
        hasMore: false,
      })),
    );

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/sessions/session-answer-result/conversation?limit=20&includeCapabilityResults=true',
    });
    const streamOutcome = projectTimelineEventToStreamEnvelope(timelineEvent(answerPayload), {
      capabilityResultPresentationPolicy: detailPolicy,
    });
    expect(response.statusCode).toBe(200);
    expect(streamOutcome.kind).toBe('ENVELOPE');
    if (streamOutcome.kind === 'ENVELOPE') {
      const body = response.json<{ readonly items: ReadonlyArray<{ readonly content: string; readonly pendingInputAnswer?: unknown }> }>();
      expect(body.items[0]?.content).toBe('');
      expect(body.items[0]?.pendingInputAnswer).toEqual({
        capabilityId: streamOutcome.envelope.payload.capabilityId,
        toolCallId: streamOutcome.envelope.payload.toolCallId,
        pendingInputId: streamOutcome.envelope.payload.pendingInputId,
        kind: streamOutcome.envelope.payload.kind,
        status: streamOutcome.envelope.payload.status,
        safeSummary: streamOutcome.envelope.payload.safeSummary,
        safeResult: streamOutcome.envelope.payload.safeResult,
      });
    }
    await app.close();
  });

  it('fails closed for malformed AskUserQuestion conversation results', async () => {
    const app = Fastify();
    await registerWebChannel(
      app,
      makeDependencies(async (query) => ({
        items: [
          {
            messageId: brand<string, 'MessageId'>('message-malformed-answer'),
            sessionId: query.sessionId,
            requestId: brand<string, 'MessageId'>('request-malformed-answer'),
            role: 'CAPABILITY_RESULT',
            content: JSON.stringify({
              toolCallId: 'ask-user-1',
              toolName: 'AskUserQuestion',
              payload: {
                pendingInputId: 'pending-1',
                kind: 'QUESTION',
                status: 'RECEIVED',
                answers: [[''], ['SECRET_MALFORMED_ANSWER']],
              },
            }),
            contentType: 'PLAIN_TEXT',
            metadata: { kind: 'CAPABILITY_RESULT', toolCallId: 'ask-user-1', toolName: 'AskUserQuestion' },
            sequence: 1,
            visible: true,
            createdAt: brand<number, 'EpochMillis'>(1),
          },
          {
            messageId: brand<string, 'MessageId'>('message-wrong-kind-answer'),
            sessionId: query.sessionId,
            requestId: brand<string, 'MessageId'>('request-wrong-kind-answer'),
            role: 'CAPABILITY_RESULT',
            content: JSON.stringify({
              toolCallId: 'ask-user-2',
              toolName: 'AskUserQuestion',
              payload: {
                pendingInputId: 'pending-2',
                kind: 'CONFIRMATION',
                status: 'RECEIVED',
                answers: [['SECRET_WRONG_KIND']],
              },
            }),
            contentType: 'PLAIN_TEXT',
            metadata: { kind: 'CAPABILITY_RESULT', toolCallId: 'ask-user-2', toolName: 'AskUserQuestion' },
            sequence: 2,
            visible: true,
            createdAt: brand<number, 'EpochMillis'>(2),
          },
        ],
        limit: query.limit,
        hasMore: false,
      })),
    );

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/sessions/session-answer-result/conversation?limit=20&includeCapabilityResults=true',
    });
    const body = response.json<{ readonly items: ReadonlyArray<Record<string, unknown>> }>();

    expect(response.statusCode).toBe(200);
    expect(body.items.every((item) => item['pendingInputAnswer'] === undefined)).toBe(true);
    await app.close();
  });

  it('rejects AskUserQuestion answers whose durable identity does not match the stored result payload', async () => {
    const app = Fastify();
    await registerWebChannel(
      app,
      makeDependencies(async (query) => ({
        items: [
          capabilityResultMessage(query.sessionId, {
            messageId: 'message-forged-tool-name',
            parsedToolCallId: 'forged-call',
            metadataToolCallId: 'real-call',
            parsedToolName: 'AskUserQuestion',
            metadataToolName: 'Read',
            answer: 'SECRET_FORGED_TOOL_NAME',
          }),
          capabilityResultMessage(query.sessionId, {
            messageId: 'message-missing-kind',
            parsedToolCallId: 'ask-user-missing-kind',
            metadataToolCallId: 'ask-user-missing-kind',
            parsedToolName: 'AskUserQuestion',
            metadataToolName: 'AskUserQuestion',
            metadataKind: 'OTHER',
            answer: 'SECRET_MISSING_KIND',
          }),
          capabilityResultMessage(query.sessionId, {
            messageId: 'message-mismatched-call',
            parsedToolCallId: 'forged-call-id',
            metadataToolCallId: 'canonical-call-id',
            parsedToolName: 'AskUserQuestion',
            metadataToolName: 'AskUserQuestion',
            answer: 'SECRET_MISMATCHED_CALL',
          }),
        ],
        limit: query.limit,
        hasMore: false,
      })),
    );

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/sessions/session-forged-answer/conversation?limit=20&includeCapabilityResults=true',
    });
    const body = response.json<{ readonly items: ReadonlyArray<Record<string, unknown>> }>();

    expect(response.statusCode).toBe(200);
    expect(body.items.every((item) => item['content'] === '')).toBe(true);
    expect(body.items.every((item) => item['pendingInputAnswer'] === undefined)).toBe(true);
    expect(JSON.stringify(body)).not.toContain('SECRET_');
    await app.close();
  });

  it('returns empty public content for an explicitly requested ordinary capability result', async () => {
    const listMessages = vi.fn<RuntimeSessionPort['listMessages']>(async (query) => ({
      items: [
        {
          messageId: brand<string, 'MessageId'>('message-read-result'),
          sessionId: query.sessionId,
          requestId: brand<string, 'MessageId'>('request-read-result'),
          runId: brand<string, 'RequestRunId'>('run-read-result'),
          role: 'CAPABILITY_RESULT',
          content: JSON.stringify({
            toolCallId: 'read-1',
            toolName: 'Read',
            payload: { file_path: '/private/secret.txt', content: 'raw secret', truncated: false },
          }),
          contentType: 'PLAIN_TEXT',
          metadata: {
            kind: 'CAPABILITY_RESULT',
            toolCallId: 'read-1',
            toolName: 'Read',
            arguments: { file_path: '/private/metadata-secret.txt' },
            rawPayload: { content: 'SECRET_CAPABILITY_METADATA' },
            providerMetadata: { requestId: 'provider-secret-request' },
          },
          sequence: 1,
          visible: false,
          createdAt: brand<number, 'EpochMillis'>(1),
        },
      ],
      limit: query.limit,
      hasMore: false,
    }));
    const app = Fastify();
    await registerWebChannel(app, makeDependencies(listMessages));

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/sessions/session-read-result/conversation?limit=20&includeCapabilityResults=true',
    });

    expect(response.statusCode).toBe(200);
    expect(listMessages).toHaveBeenCalledWith(expect.objectContaining({ includeCapabilityResults: true }));
    const body = response.json<{
      readonly items: ReadonlyArray<{
        readonly content: string;
        readonly metadata: Record<string, unknown>;
      }>;
    }>();
    expect(body.items[0]?.content).toBe('');
    expect(body.items[0]?.metadata).toEqual({
      kind: 'CAPABILITY_RESULT',
      toolCallId: 'read-1',
      toolName: 'Read',
    });
    expect(JSON.stringify(body)).not.toContain('raw secret');
    expect(JSON.stringify(body)).not.toContain('/private/secret.txt');
    expect(JSON.stringify(body)).not.toContain('SECRET_CAPABILITY_METADATA');
    expect(JSON.stringify(body)).not.toContain('/private/metadata-secret.txt');
    expect(JSON.stringify(body)).not.toContain('provider-secret-request');
    await app.close();
  });

  it('treats null message metadata as having no attachment references', async () => {
    const app = Fastify();
    const loadAttachment = vi.fn();
    await registerWebChannel(app, {
      ...makeDependencies(async (query) => ({
        items: [
          {
            messageId: brand<string, 'MessageId'>('message-null-metadata'),
            sessionId: query.sessionId,
            requestId: brand<string, 'MessageId'>('request-null-metadata'),
            role: 'USER',
            content: 'inspect conversation',
            contentType: 'PLAIN_TEXT',
            metadata: null as unknown as JsonObject,
            sequence: 1,
            visible: true,
            createdAt: brand<number, 'EpochMillis'>(1),
          },
        ],
        limit: query.limit,
        hasMore: false,
      })),
      attachmentSummaryResolver: { loadAttachment },
    });

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/sessions/session-null-metadata/conversation?limit=20',
    });

    expect(response.statusCode).toBe(200);
    expect(loadAttachment).not.toHaveBeenCalled();
    await app.close();
  });
});

function capabilityResultMessage(
  sessionId: string,
  options: {
    readonly messageId: string;
    readonly parsedToolCallId: string;
    readonly metadataToolCallId: string;
    readonly parsedToolName: string;
    readonly metadataToolName: string;
    readonly metadataKind?: string;
    readonly answer: string;
  },
) {
  return {
    messageId: brand<string, 'MessageId'>(options.messageId),
    sessionId: brand<string, 'SessionId'>(sessionId),
    requestId: brand<string, 'MessageId'>(`request-${options.messageId}`),
    runId: brand<string, 'RequestRunId'>(`run-${options.messageId}`),
    role: 'CAPABILITY_RESULT' as const,
    content: JSON.stringify({
      toolCallId: options.parsedToolCallId,
      toolName: options.parsedToolName,
      payload: {
        pendingInputId: `pending-${options.messageId}`,
        kind: 'QUESTION',
        status: 'RECEIVED',
        answers: [[options.answer]],
      },
    }),
    contentType: 'PLAIN_TEXT' as const,
    metadata: {
      kind: options.metadataKind ?? 'CAPABILITY_RESULT',
      toolCallId: options.metadataToolCallId,
      toolName: options.metadataToolName,
    },
    sequence: 1,
    visible: false,
    createdAt: brand<number, 'EpochMillis'>(1),
  };
}

function timelineEvent(inlinePayload: RunTimelineEvent['inlinePayload']): RunTimelineEvent {
  return {
    type: 'CAPABILITY_RESULT_DELTA',
    eventId: 'timeline-answer-result',
    sessionId: brand<string, 'SessionId'>('session-answer-result'),
    requestId: brand<string, 'MessageId'>('request-answer-result'),
    runId: brand<string, 'RequestRunId'>('run-answer-result'),
    requestContextId: brand<string, 'RequestContextId'>('context-answer-result'),
    sequence: brand<number, 'TimelineSequence'>(1),
    createdAt: new Date(1),
    inlinePayload,
  };
}

const detailPolicy: CapabilityResultPresentationPolicy = Object.freeze({
  defaultLevel: 'DETAIL',
  levelByCapabilityId: new Map(),
});

function makeDependencies(listMessages: RuntimeSessionPort['listMessages']) {
  const runtime: RuntimeCommandPort = {
    submit: vi.fn(async (command) => ({
      sessionId: command.sessionId,
      requestId: brand<string, 'MessageId'>('request-conversation-route'),
      runId: brand<string, 'RequestRunId'>('run-conversation-route'),
      attempt: 1,
    })),
    cancel: vi.fn(async () => ({
      sessionId: brand<string, 'SessionId'>('session-conversation-route'),
      targetRequestId: brand<string, 'MessageId'>('request-conversation-route'),
      action: 'CANCEL' as const,
      idempotencyKey: brand<string, 'IdempotencyKey'>('idem-conversation-route-cancel'),
    })),
    retryLatest: vi.fn(async () => ({
      sessionId: brand<string, 'SessionId'>('session-conversation-route'),
      requestId: brand<string, 'MessageId'>('request-conversation-route'),
      runId: brand<string, 'RequestRunId'>('run-conversation-route'),
      attempt: 2,
    })),
    editLatest: vi.fn(async () => {
      throw new Error('not used');
    }),
    answerPendingInput: vi.fn(async () => ({
      sessionId: brand<string, 'SessionId'>('session-conversation-route'),
      pendingInputId: brand<string, 'PendingInputId'>('pending-conversation-route'),
      status: 'RECEIVED' as const,
    })),
  };
  const sessions: RuntimeSessionPort = {
    createSession: vi.fn(async () => ({
      tenantId: brand<string, 'TenantId'>('tenant-conversation-route'),
      subjectId: brand<string, 'SubjectId'>('subject-conversation-route'),
      agentId: brand<string, 'AgentId'>('agent-conversation-route'),
      sessionId: brand<string, 'SessionId'>('session-conversation-route'),
      title: 'Conversation Route',
      createdAt: brand<number, 'EpochMillis'>(1),
      updatedAt: brand<number, 'EpochMillis'>(1),
      hasInFlightRequest: false,
    })),
    requireSession: vi.fn(async ({ sessionId }) => ({
      tenantId: brand<string, 'TenantId'>('tenant-conversation-route'),
      subjectId: brand<string, 'SubjectId'>('subject-conversation-route'),
      agentId: brand<string, 'AgentId'>('agent-conversation-route'),
      sessionId,
      title: 'Conversation Route',
      createdAt: brand<number, 'EpochMillis'>(1),
      updatedAt: brand<number, 'EpochMillis'>(1),
      hasInFlightRequest: false,
    })),
    listSessions: vi.fn(async (query) => ({ entries: [], offset: query.offset, limit: query.limit, hasMore: false })),
    deleteSession: vi.fn(async () => undefined),
    forkFromMessage: vi.fn(async () => {
      throw new Error('not used');
    }),
    forkFromRequest: vi.fn(async () => {
      throw new Error('not used');
    }),
    listMessages,
    listConversationPreview: vi.fn(async ({ sessionId, offset, limit }) => ({ sessionId, totalMarkers: 0, offset: offset ?? 0, limit, markers: [] })),
    updateTitle: vi.fn(async () => {
      throw new Error('not used');
    }),
    streamEvents: vi.fn(async function* () {}),
    listEvents: vi.fn(async () => ({ availability: 'AVAILABLE' as const, events: [] })),
    getActiveRun: vi.fn(async () => undefined),
    getRequestSummary: vi.fn(async () => undefined),
  };

  return {
    runtime,
    sessions,
    identityResolver: () => ({
      tenantId: brand<string, 'TenantId'>('tenant-conversation-route'),
      subjectId: brand<string, 'SubjectId'>('subject-conversation-route'),
      displayName: 'Conversation Route',
    }),
    runtimeBootstrap: { transportKind: 'SSE' as const },
    skillCatalog: { listSkills: vi.fn(async () => ({ total: 0, pageNum: 1, pageSize: 50, skills: [] })) } as unknown as SkillCatalogQueryPort,
    defaultAgentId: brand<string, 'AgentId'>('agent-conversation-route'),
  };
}
