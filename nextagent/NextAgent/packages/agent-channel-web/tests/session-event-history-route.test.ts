import { brand } from '@nextagent/agent-common';
import type { JsonObject } from '@nextagent/agent-common';
import type { RunTimelineEvent, RuntimeCommandPort, RuntimeSessionPort, SkillCatalogQueryPort } from '@nextagent/agent-contracts/runtime';
import type { SessionMessage } from '@nextagent/agent-contracts/session';
import { projectTimelineEventToStreamEnvelope, type CapabilityResultPresentationPolicy } from '@nextagent/agent-channel-common';
import Fastify from 'fastify';
import { describe, expect, it, vi } from 'vitest';

import { registerWebChannel } from '../src/routes/requests.js';

describe('GET /api/v1/sessions/:sessionId/runs/:runId/events', () => {
  it('returns the same terminal Hook snapshot as the shared live projector', async () => {
    const terminalMessage = processMessage('terminal-message-hook-results', {
      content: '<persisted-content>\nFile path: tool-results/history-result.txt\nPreview: bounded history result',
      metadata: {
        eventType: 'REQUEST_COMPLETED',
        status: 'COMPLETED',
        replacement: { contentRef: { refId: 'tool-results/history-result.txt', refType: 'CAPABILITY_RESULT' } },
      },
    });
    const terminalEvent = {
      eventId: brand<string, 'TimelineEventId'>('timeline-terminal-hook-results'),
      sessionId: brand<string, 'SessionId'>('session-event-history'),
      requestId: brand<string, 'MessageId'>('request-event-history'),
      runId: brand<string, 'RequestRunId'>('run-event-history'),
      sequence: brand<number, 'TimelineSequence'>(2),
      type: 'REQUEST_COMPLETED',
      persistence: 'PERSISTED',
      inlinePayload: {
        terminalMessageId: terminalMessage.messageId,
        hookResults: [
          {
            hookInvocationId: 'hook-invocation-1',
            hookId: 'bash-result-hook',
            stage: 'AFTER_CAPABILITY_RESULT',
            status: 'SUCCESS',
            failureMode: 'CONTINUE',
            outcome: 'PASS',
            resultSummary: { a: 1, b: 2 },
          },
        ],
      },
      createdAt: new Date(2_000),
    } as RunTimelineEvent;
    const app = Fastify();
    await registerWebChannel(
      app,
      makeDependencies(
        async () => ({ availability: 'AVAILABLE', events: [terminalEvent] }),
        vi.fn(async () => [terminalMessage]),
      ),
    );

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/sessions/session-event-history/runs/run-event-history/events',
    });
    const liveOutcome = projectTimelineEventToStreamEnvelope(terminalEvent, {
      processMessageAssociation: { message: terminalMessage },
    });

    expect(response.statusCode).toBe(200);
    expect(liveOutcome.kind).toBe('ENVELOPE');
    if (liveOutcome.kind === 'ENVELOPE') {
      expect(response.json().events).toEqual([liveOutcome.envelope]);
    }
    await app.close();
  });

  it('returns the same summary-only result projection as the shared live projector', async () => {
    const resultMessage = processMessage('message-read-result', {
      role: 'CAPABILITY_RESULT',
      content: JSON.stringify({
        toolCallId: 'call-1',
        toolName: 'Read',
        payload: { file_path: 'workspace/alarm.json', content: 'private evidence', truncated: false },
      }),
      metadata: { kind: 'CAPABILITY_RESULT', toolCallId: 'call-1', toolName: 'Read' },
    });
    const resultEvent = {
      eventId: brand<string, 'TimelineEventId'>('timeline-read-result'),
      sessionId: brand<string, 'SessionId'>('session-event-history'),
      requestId: brand<string, 'MessageId'>('request-event-history'),
      runId: brand<string, 'RequestRunId'>('run-event-history'),
      sequence: brand<number, 'TimelineSequence'>(1),
      type: 'CAPABILITY_COMPLETED',
      persistence: 'PERSISTED',
      inlinePayload: {
        messageId: resultMessage.messageId,
        capabilityKind: 'TOOL',
        capabilityId: 'Read',
        toolCallId: 'call-1',
        status: 'SUCCEEDED',
      },
      createdAt: new Date(1_000),
    } as RunTimelineEvent;
    const summaryPolicy: CapabilityResultPresentationPolicy = Object.freeze({
      defaultLevel: 'SUMMARY',
      levelByCapabilityId: new Map(),
    });
    const app = Fastify();
    await registerWebChannel(app, {
      ...makeDependencies(
        async () => ({ availability: 'AVAILABLE', events: [resultEvent] }),
        async () => [resultMessage],
      ),
      capabilityResultPresentationPolicy: summaryPolicy,
    });

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/sessions/session-event-history/runs/run-event-history/events',
    });
    const liveOutcome = projectTimelineEventToStreamEnvelope(resultEvent, {
      capabilityResultPresentationPolicy: summaryPolicy,
      processMessageAssociation: { message: resultMessage },
    });

    expect(response.statusCode).toBe(200);
    expect(liveOutcome.kind).toBe('ENVELOPE');
    if (liveOutcome.kind === 'ENVELOPE') {
      expect(response.json().events[0].payload).toEqual(liveOutcome.envelope.payload);
    }
    expect(response.json().events[0].payload.safeSummary).toContain('alarm.json');
    expect(response.json().events[0].payload.capabilityKind).toBe('TOOL');
    expect(response.json().events[0].payload).not.toHaveProperty('safeResult');
    expect(JSON.stringify(response.json())).not.toContain('private evidence');
    await app.close();
  });

  it('keeps the RAG summary result identical between live and history', async () => {
    const resultMessage = processMessage('message-rag-result', {
      role: 'CAPABILITY_RESULT',
      content: JSON.stringify({
        toolCallId: 'call-rag-1',
        toolName: 'Rag',
        payload: {
          status: 'OK',
          results: [{ source: 'knowledge-base|C:\\private\\rag\\upf-timeout.md', content: 'Inspect N4 timeout counters first.' }],
        },
      }),
      metadata: { kind: 'CAPABILITY_RESULT', toolCallId: 'call-rag-1', toolName: 'Rag' },
    });
    const resultEvent = {
      eventId: brand<string, 'TimelineEventId'>('timeline-rag-result'),
      sessionId: brand<string, 'SessionId'>('session-event-history'),
      requestId: brand<string, 'MessageId'>('request-event-history'),
      runId: brand<string, 'RequestRunId'>('run-event-history'),
      sequence: brand<number, 'TimelineSequence'>(1),
      type: 'CAPABILITY_COMPLETED',
      persistence: 'PERSISTED',
      inlinePayload: {
        messageId: resultMessage.messageId,
        capabilityId: 'Rag',
        toolCallId: 'call-rag-1',
        status: 'SUCCEEDED',
      },
      createdAt: new Date(1_000),
    } as RunTimelineEvent;
    const detailPolicy: CapabilityResultPresentationPolicy = Object.freeze({
      defaultLevel: 'DETAIL',
      levelByCapabilityId: new Map(),
    });
    const app = Fastify();
    await registerWebChannel(app, {
      ...makeDependencies(
        async () => ({ availability: 'AVAILABLE', events: [resultEvent] }),
        async () => [resultMessage],
      ),
      capabilityResultPresentationPolicy: detailPolicy,
    });

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/sessions/session-event-history/runs/run-event-history/events',
    });
    const liveOutcome = projectTimelineEventToStreamEnvelope(resultEvent, {
      capabilityResultPresentationPolicy: detailPolicy,
      processMessageAssociation: { message: resultMessage },
    });

    expect(response.statusCode).toBe(200);
    expect(liveOutcome.kind).toBe('ENVELOPE');
    if (liveOutcome.kind === 'ENVELOPE') {
      expect(response.json().events[0].payload).toEqual(liveOutcome.envelope.payload);
    }
    expect(response.json().events[0].payload.safeResult).toMatchObject({
      kind: 'ragRetrieval',
      totalCount: 1,
      items: [{ source: 'knowledge-base', content: 'Inspect N4 timeout counters first.' }],
    });
    expect(JSON.stringify(response.json())).not.toContain('C:\\private\\rag');
    await app.close();
  });

  it('keeps representative capability categories identical between live and history', async () => {
    const resultCases: ReadonlyArray<{
      readonly capabilityId: string;
      readonly result: JsonObject;
      readonly resultProjectionKind?: 'CLIP_STREAM_V1';
    }> = [
      { capabilityId: 'Read', result: { file_path: 'workspace/alarm.json', content: 'alarm evidence', truncated: false } },
      { capabilityId: 'Glob', result: { filenames: ['workspace/a.log'], truncated: false } },
      {
        capabilityId: 'Grep',
        result: {
          output_mode: 'content',
          filenames: [],
          matches: [{ file_path: 'workspace/alarm.log', line_number: 7, line: 'must not leak matched line' }],
          total_files_with_matches: 1,
          total_matches: 1,
          truncated: false,
        },
      },
      {
        capabilityId: 'Grep',
        result: { filenames: ['workspace/legacy.log'], matches: [], total_files_with_matches: 1, total_matches: 1, truncated: false },
      },
      { capabilityId: 'Bash', result: { exitCode: 0, stdout: 'command evidence', stderr: '' } },
      { capabilityId: 'TodoWrite', result: { newTodos: [{ content: 'Inspect alarms', activeForm: 'Inspecting alarms', status: 'in_progress' }] } },
      { capabilityId: 'Workflow', result: { recipeName: 'alarm-analysis', status: 'succeeded', answerPreviews: ['safe answer'] } },
      { capabilityId: 'AskUserQuestion', result: { kind: 'QUESTION', status: 'RECEIVED', pendingInputId: 'pending-1', answers: [['Core network']] } },
      { capabilityId: 'Skill', result: { file_path: '/private/internal/SKILL.md', content: 'must not leak', truncated: false } },
      {
        capabilityId: 'dynamic-clip-network-inspector',
        result: { event: 'DETAIL', data_raw: 'bounded CLIP output' },
        resultProjectionKind: 'CLIP_STREAM_V1',
      },
      { capabilityId: 'CustomTool', result: { raw: 'must not leak' } },
    ];
    const messages = resultCases.map(({ capabilityId, result }, index) =>
      processMessage(`message-result-${index}`, {
        role: 'CAPABILITY_RESULT',
        content: JSON.stringify({ toolCallId: `call-${index}`, toolName: capabilityId, payload: result }),
        metadata: { kind: 'CAPABILITY_RESULT', toolCallId: `call-${index}`, toolName: capabilityId },
        sequence: index + 1,
      }),
    );
    const events = resultCases.map(
      ({ capabilityId, resultProjectionKind }, index) =>
        ({
          eventId: brand<string, 'TimelineEventId'>(`timeline-result-${index}`),
          sessionId: brand<string, 'SessionId'>('session-event-history'),
          requestId: brand<string, 'MessageId'>('request-event-history'),
          runId: brand<string, 'RequestRunId'>('run-event-history'),
          sequence: brand<number, 'TimelineSequence'>(index + 1),
          type: 'CAPABILITY_COMPLETED',
          persistence: 'PERSISTED',
          inlinePayload: {
            messageId: messages[index]!.messageId,
            capabilityId,
            toolCallId: `call-${index}`,
            status: 'SUCCEEDED',
            ...(resultProjectionKind === undefined ? {} : { resultProjectionKind }),
          },
          createdAt: new Date(1_000 + index),
        }) as RunTimelineEvent,
    );
    const app = Fastify();
    await registerWebChannel(app, {
      ...makeDependencies(
        async () => ({ availability: 'AVAILABLE', events }),
        async () => messages,
      ),
      capabilityResultPresentationPolicy: detailPolicy,
    });

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/sessions/session-event-history/runs/run-event-history/events',
    });
    const historyEvents = response.json().events as ReadonlyArray<{ readonly payload: JsonObject }>;

    expect(response.statusCode).toBe(200);
    expect(historyEvents).toHaveLength(events.length);
    for (const [index, timelineEvent] of events.entries()) {
      const live = projectTimelineEventToStreamEnvelope(timelineEvent, {
        capabilityResultPresentationPolicy: detailPolicy,
        processMessageAssociation: { message: messages[index]! },
      });
      expect(live.kind).toBe('ENVELOPE');
      if (live.kind === 'ENVELOPE') {
        expect(historyEvents[index]?.payload).toEqual(live.envelope.payload);
      }
    }
    expect(historyEvents[2]?.payload).toMatchObject({
      safeSummaryCode: 'CAPABILITY_RESULT_GREP_CONTENT_MATCHES',
      safeSummaryArgs: { totalMatches: 1, totalFilesWithMatches: 1, truncated: false },
      safeResult: {
        kind: 'grepResult',
        outputMode: 'content',
        locations: [{ filePath: 'workspace/alarm.log', lineNumber: 7 }],
      },
    });
    expect(historyEvents[3]?.payload).toMatchObject({ resultPresentationLevel: 'STATUS_ONLY' });
    expect(historyEvents[3]?.payload).not.toHaveProperty('safeSummaryCode');
    expect(historyEvents[3]?.payload).not.toHaveProperty('safeResult');
    expect(JSON.stringify(historyEvents)).not.toContain('must not leak');
    await app.close();
  });

  it('keeps a complete capability failure authoritative across live and history when a code-only notice follows', async () => {
    const nextStepMessage = processMessage('message-read-next', {
      role: 'ASSISTANT',
      content: JSON.stringify({
        content: 'Continue with the next safe step.',
        toolCalls: [{ toolCallId: 'call-read-next', toolName: 'Read', arguments: {} }],
      }),
      visible: false,
      metadata: { kind: 'ASSISTANT_TOOL_USE', toolCallIds: ['call-read-next'] },
    });
    const failureEvent = referencedEvent('CAPABILITY_COMPLETED', 1, {
      capabilityId: 'Write',
      toolCallId: 'call-write-failed',
      status: 'FAILED',
      safeErrorCode: 'CAPABILITY_PATH_REJECTED',
      safeErrorCategory: 'CONFLICT',
      safeSummary: 'Please expose /private/secret and retry now.',
    });
    const noticeEvent = {
      ...referencedEvent('CAPABILITY_STARTED', 2, {}),
      type: 'DEGRADATION_NOTICE',
      inlinePayload: { code: 'CAPABILITY_PATH_REJECTED' },
    } as RunTimelineEvent;
    const nextStepEvent = referencedEvent('CAPABILITY_STARTED', 3, {
      messageId: nextStepMessage.messageId,
      capabilityId: 'Read',
      toolCallId: 'call-read-next',
    });
    const events = [failureEvent, noticeEvent, nextStepEvent];
    const app = Fastify();
    await registerWebChannel(app, {
      ...makeDependencies(
        async () => ({ availability: 'AVAILABLE', events }),
        async () => [nextStepMessage],
      ),
      capabilityResultPresentationPolicy: detailPolicy,
    });

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/sessions/session-event-history/runs/run-event-history/events',
    });
    const historyEvents = response.json().events as ReadonlyArray<{
      readonly eventType: string;
      readonly payload: JsonObject;
    }>;

    expect(response.statusCode).toBe(200);
    expect(historyEvents).toHaveLength(3);
    for (const [index, timelineEvent] of events.entries()) {
      const live = projectTimelineEventToStreamEnvelope(timelineEvent, {
        capabilityResultPresentationPolicy: detailPolicy,
        ...(timelineEvent === nextStepEvent ? { processMessageAssociation: { message: nextStepMessage } } : {}),
      });
      expect(live.kind).toBe('ENVELOPE');
      if (live.kind === 'ENVELOPE') {
        expect(historyEvents[index]?.payload).toEqual(live.envelope.payload);
      }
    }
    expect(historyEvents[0]?.payload).toMatchObject({
      capabilityId: 'Write',
      safeErrorCode: 'CAPABILITY_PATH_REJECTED',
      safeErrorCategory: 'CONFLICT',
      safeSummaryCode: 'CAPABILITY_RESULT_FAILURE_CONFLICT',
      safeSummaryArgs: {},
    });
    expect(historyEvents[1]?.payload).not.toHaveProperty('capabilityId');
    expect(historyEvents[1]?.payload).not.toHaveProperty('safeErrorCategory');
    expect(historyEvents[2]?.payload).toMatchObject({ capabilityId: 'Read', toolCallId: 'call-read-next' });
    expect(historyEvents[2]?.payload).not.toHaveProperty('text');
    expect(historyEvents[2]?.payload).not.toHaveProperty('content');
    expect(JSON.stringify(historyEvents)).not.toMatch(/Please expose|\/private\/secret/);
    await app.close();
  });

  it('uses bounded defaults and projects canonical events through the shared stream projector', async () => {
    const listEvents = vi.fn<RuntimeSessionPort['listEvents']>(async () => ({
      availability: 'AVAILABLE',
      events: [
        {
          eventId: brand<string, 'TimelineEventId'>('timeline-thinking-final'),
          sessionId: brand<string, 'SessionId'>('session-event-history'),
          requestId: brand<string, 'MessageId'>('request-event-history'),
          runId: brand<string, 'RequestRunId'>('run-event-history'),
          sequence: brand<number, 'TimelineSequence'>(7),
          type: 'LLM_THINKING_DELTA',
          persistence: 'PERSISTED',
          inlinePayload: { reasoning: 'checked routing policy', stepId: 'step-1', completed: true },
          createdAt: new Date(1_000),
        },
      ],
      nextAfterSequence: brand<number, 'TimelineSequence'>(7),
    }));
    const app = Fastify();
    await registerWebChannel(app, makeDependencies(listEvents));

    const response = await app.inject({ method: 'GET', url: '/api/v1/sessions/session-event-history/runs/run-event-history/events' });

    expect(response.statusCode).toBe(200);
    expect(listEvents).toHaveBeenCalledWith({
      identityContext: expect.any(Object),
      sessionId: brand<string, 'SessionId'>('session-event-history'),
      runId: brand<string, 'RequestRunId'>('run-event-history'),
      afterSequence: brand<number, 'TimelineSequence'>(0),
      limit: 100,
    });
    expect(response.json()).toMatchObject({
      availability: 'AVAILABLE',
      nextAfterSequence: 7,
      events: [{ eventType: 'LLM_THINKING_DELTA', timelineEventRef: 'timeline-thinking-final', payload: { metadata: { completed: true } } }],
    });
    await app.close();
  });

  it('preserves B305 capability route projection', async () => {
    const app = Fastify();
    await registerWebChannel(
      app,
      makeDependencies(async () => ({
        availability: 'AVAILABLE',
        events: [
          {
            eventId: brand<string, 'TimelineEventId'>('timeline-capability-started'),
            sessionId: brand<string, 'SessionId'>('session-event-history'),
            requestId: brand<string, 'MessageId'>('request-event-history'),
            runId: brand<string, 'RequestRunId'>('run-event-history'),
            sequence: brand<number, 'TimelineSequence'>(7),
            type: 'CAPABILITY_STARTED',
            persistence: 'PERSISTED',
            inlinePayload: {
              capabilityId: 'routing-policy',
              toolCallId: 'tool-call-1',
              status: 'RUNNING',
            },
            createdAt: new Date(1_000),
          },
        ],
      })),
    );

    const response = await app.inject({ method: 'GET', url: '/api/v1/sessions/session-event-history/runs/run-event-history/events' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      availability: 'AVAILABLE',
      events: [
        {
          eventType: 'CAPABILITY_STARTED',
          timelineEventRef: 'timeline-capability-started',
          payload: {
            capabilityId: 'routing-policy',
            toolCallId: 'tool-call-1',
            status: 'RUNNING',
            metadata: { accumulated: true },
          },
        },
      ],
    });
    await app.close();
  });

  it('preserves availability and the canonical cursor when every event is timeline-only', async () => {
    const app = Fastify();
    await registerWebChannel(
      app,
      makeDependencies(async () => ({
        availability: 'AVAILABLE',
        events: [
          {
            sessionId: brand<string, 'SessionId'>('session-event-history'),
            requestId: brand<string, 'MessageId'>('request-event-history'),
            runId: brand<string, 'RequestRunId'>('run-event-history'),
            sequence: brand<number, 'TimelineSequence'>(8),
            type: 'HOOK_INVOKED',
            persistence: 'PERSISTED',
            inlinePayload: {
              status: 'SUCCESS',
              outcome: 'PASS',
              failureMode: 'CONTINUE',
              resultSummary: { a: 1, b: 2 },
            },
            createdAt: new Date(2_000),
          },
        ],
        nextAfterSequence: brand<number, 'TimelineSequence'>(8),
      })),
    );

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/sessions/session-event-history/runs/run-event-history/events?afterSequence=7&limit=1',
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ availability: 'AVAILABLE', events: [], nextAfterSequence: 8 });
    await app.close();
  });

  it('returns the exact legacy fork availability response', async () => {
    const app = Fastify();
    await registerWebChannel(
      app,
      makeDependencies(async () => ({ availability: 'LEGACY_FORK_PROCESS_HISTORY_UNAVAILABLE', events: [] })),
    );

    const response = await app.inject({ method: 'GET', url: '/api/v1/sessions/session-event-history/runs/run-event-history/events' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ availability: 'LEGACY_FORK_PROCESS_HISTORY_UNAVAILABLE', events: [] });
    await app.close();
  });

  it('fails the entire page safely when any canonical event cannot be projected', async () => {
    const app = Fastify();
    await registerWebChannel(
      app,
      makeDependencies(async () => ({
        availability: 'AVAILABLE',
        events: [
          {
            sessionId: brand<string, 'SessionId'>('session-event-history'),
            requestId: brand<string, 'MessageId'>('request-event-history'),
            runId: brand<string, 'RequestRunId'>('run-event-history'),
            sequence: brand<number, 'TimelineSequence'>(9),
            type: 'LLM_THINKING_DELTA',
            persistence: 'PERSISTED',
            inlinePayload: { reasoning: 'incomplete terminal thinking' },
            createdAt: new Date(3_000),
          },
        ],
      })),
    );

    const response = await app.inject({ method: 'GET', url: '/api/v1/sessions/session-event-history/runs/run-event-history/events' });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({
      error: { code: 'STREAM_PROJECTION_THINKING_INVALID', message: 'Timeline event cannot be projected to the public stream.' },
    });
    await app.close();
  });

  it('preserves B305 rejection of deprecated stream event names', async () => {
    const app = Fastify();
    await registerWebChannel(
      app,
      makeDependencies(async () => ({
        availability: 'AVAILABLE',
        events: [
          {
            sessionId: brand<string, 'SessionId'>('session-event-history'),
            requestId: brand<string, 'MessageId'>('request-event-history'),
            runId: brand<string, 'RequestRunId'>('run-event-history'),
            sequence: brand<number, 'TimelineSequence'>(10),
            type: 'CONTENT_DELTA' as 'LLM_CONTENT_DELTA',
            persistence: 'PERSISTED',
            inlinePayload: { content: 'deprecated event must not escape' },
            createdAt: new Date(4_000),
          },
        ],
      })),
    );

    const response = await app.inject({ method: 'GET', url: '/api/v1/sessions/session-event-history/runs/run-event-history/events' });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({
      error: { code: 'DEPRECATED_STREAM_EVENT_NAME', message: 'Timeline event cannot be projected to the public stream.' },
    });
    await app.close();
  });

  it('rejects invalid bounds before calling runtime', async () => {
    const listEvents = vi.fn<RuntimeSessionPort['listEvents']>(async () => ({ availability: 'AVAILABLE', events: [] }));
    const app = Fastify();
    await registerWebChannel(app, makeDependencies(listEvents));

    for (const url of [
      '/api/v1/sessions/session-event-history/runs/run-event-history/events?afterSequence=-1',
      '/api/v1/sessions/session-event-history/runs/run-event-history/events?limit=0',
      '/api/v1/sessions/session-event-history/runs/run-event-history/events?limit=1001',
    ]) {
      expect((await app.inject({ method: 'GET', url })).statusCode).toBe(400);
    }
    expect(listEvents).not.toHaveBeenCalled();
    await app.close();
  });

  it('resolves all referenced process messages once and projects only safe public content', async () => {
    const assistantMessage = processMessage('assistant-tool-use', {
      role: 'ASSISTANT',
      content: JSON.stringify({
        content: 'I will inspect the network evidence.',
        toolCalls: [
          {
            toolCallId: 'call-1',
            toolName: 'Read',
            arguments: { path: '/private/network-evidence.json' },
          },
        ],
      }),
      visible: false,
      metadata: { kind: 'ASSISTANT_TOOL_USE', toolCallIds: ['call-1'] },
    });
    const resultMessage = processMessage('capability-result', {
      role: 'CAPABILITY_RESULT',
      content: JSON.stringify({
        toolCallId: 'call-1',
        toolName: 'Bash',
        payload: {
          exitCode: 0,
          stdout: 'diagnosis complete',
          stderr: '',
          stdoutTruncated: false,
          stderrTruncated: false,
        },
      }),
      metadata: { kind: 'CAPABILITY_RESULT', toolCallId: 'call-1', toolName: 'Bash' },
    });
    const resolveProcessMessages = vi.fn(async () => [assistantMessage, resultMessage]);
    const app = Fastify();
    await registerWebChannel(
      app,
      makeDependencies(
        async () => ({
          availability: 'AVAILABLE',
          events: [
            referencedEvent('LLM_CONTENT_DELTA', 1, {
              messageId: assistantMessage.messageId,
              stepId: 'turn-1',
              completed: true,
              content: 'legacy event copy must not be read',
            }),
            referencedEvent('CAPABILITY_STARTED', 2, {
              messageId: assistantMessage.messageId,
              capabilityId: 'Read',
              toolCallId: 'call-1',
              input: { path: '/private/event-copy.json' },
            }),
            referencedEvent('CAPABILITY_COMPLETED', 3, {
              messageId: resultMessage.messageId,
              capabilityId: 'Bash',
              toolCallId: 'call-1',
              status: 'SUCCEEDED',
              result: { stdout: 'raw event result must not be read' },
            }),
          ],
        }),
        resolveProcessMessages,
      ),
    );

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/sessions/session-event-history/runs/run-event-history/events',
    });

    expect(response.statusCode).toBe(200);
    expect(resolveProcessMessages).toHaveBeenCalledOnce();
    expect(resolveProcessMessages).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: 'session-event-history',
        requestId: 'request-event-history',
        runId: 'run-event-history',
        messageIds: [assistantMessage.messageId, resultMessage.messageId],
      }),
    );
    const body = response.json();
    expect(body.events).toHaveLength(3);
    expect(body.events[0].payload.content).toBe('I will inspect the network evidence.');
    expect(body.events[2].payload.content).toBe('Exit code: 0\nOutput:\ndiagnosis complete');
    expect(JSON.stringify(body)).not.toContain('/private/network-evidence.json');
    expect(JSON.stringify(body)).not.toContain('legacy event copy must not be read');
    expect(JSON.stringify(body)).not.toContain('raw event result must not be read');
    expect(JSON.stringify(body)).not.toContain('"visible"');
    await app.close();
  });

  it('degrades only an invalid reference while preserving the rest of the event page', async () => {
    const resolveProcessMessages = vi.fn(async () => [
      processMessage('wrong-message', {
        requestId: brand<string, 'MessageId'>('other-request'),
        content: 'cross-request content must not leak',
      }),
    ]);
    const app = Fastify();
    await registerWebChannel(
      app,
      makeDependencies(
        async () => ({
          availability: 'AVAILABLE',
          events: [
            referencedEvent('CAPABILITY_STARTED', 1, {
              messageId: 'wrong-message',
              capabilityId: 'Read',
              toolCallId: 'call-1',
              input: { path: '/private/event-copy.json' },
            }),
            {
              ...referencedEvent('LLM_THINKING_DELTA', 2, {
                reasoning: 'checked routing policy',
                stepId: 'turn-1',
                completed: true,
              }),
              persistence: 'PERSISTED',
            },
          ],
        }),
        resolveProcessMessages,
      ),
    );

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/sessions/session-event-history/runs/run-event-history/events',
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      availability: 'AVAILABLE',
      events: [
        {
          eventType: 'CAPABILITY_STARTED',
          payload: {
            capabilityId: 'Read',
            toolCallId: 'call-1',
            contentUnavailable: true,
          },
        },
        {
          eventType: 'LLM_THINKING_DELTA',
          payload: { reasoning: 'checked routing policy' },
        },
      ],
    });
    expect(JSON.stringify(response.json())).not.toContain('cross-request content must not leak');
    expect(JSON.stringify(response.json())).not.toContain('/private/event-copy.json');
    await app.close();
  });

  it('uses only a unique already-resolved legacy message and ignores legacy event text', async () => {
    const assistantMessage = processMessage('assistant-tool-use', {
      role: 'ASSISTANT',
      content: JSON.stringify({
        content: 'Canonical process explanation.',
        toolCalls: [{ toolCallId: 'call-1', toolName: 'Read', arguments: {} }],
      }),
      visible: false,
      metadata: { kind: 'ASSISTANT_TOOL_USE', toolCallIds: ['call-1'] },
    });
    const resolveProcessMessages = vi.fn(async () => [assistantMessage]);
    const app = Fastify();
    await registerWebChannel(
      app,
      makeDependencies(
        async () => ({
          availability: 'AVAILABLE',
          events: [
            referencedEvent('CAPABILITY_STARTED', 1, {
              messageId: assistantMessage.messageId,
              capabilityId: 'Read',
              toolCallId: 'call-1',
            }),
            referencedEvent('LLM_CONTENT_DELTA', 2, {
              stepId: 'turn-1',
              completed: true,
              content: 'legacy event text must not be read',
            }),
          ],
        }),
        resolveProcessMessages,
      ),
    );

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/sessions/session-event-history/runs/run-event-history/events',
    });

    expect(response.statusCode).toBe(200);
    expect(resolveProcessMessages).toHaveBeenCalledOnce();
    expect(response.json().events[1].payload.content).toBe('Canonical process explanation.');
    expect(JSON.stringify(response.json())).not.toContain('legacy event text must not be read');
    await app.close();
  });

  it('recovers an all-legacy event page from one bounded candidate query', async () => {
    const assistantMessage = processMessage('assistant-tool-use', {
      role: 'ASSISTANT',
      content: JSON.stringify({
        content: 'Canonical legacy process explanation.',
        toolCalls: [{ toolCallId: 'call-1', toolName: 'Read', arguments: {} }],
      }),
      visible: false,
      metadata: { kind: 'ASSISTANT_TOOL_USE', toolCallIds: ['call-1'] },
    });
    const resolveProcessMessages = vi.fn(async () => [assistantMessage]);
    const app = Fastify();
    await registerWebChannel(
      app,
      makeDependencies(
        async () => ({
          availability: 'AVAILABLE',
          events: [
            referencedEvent('LLM_CONTENT_DELTA', 1, {
              stepId: 'turn-legacy',
              completed: true,
              content: 'legacy event text must not be read',
            }),
          ],
        }),
        resolveProcessMessages,
      ),
    );

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/sessions/session-event-history/runs/run-event-history/events',
    });

    expect(response.statusCode).toBe(200);
    expect(resolveProcessMessages).toHaveBeenCalledOnce();
    expect(resolveProcessMessages).toHaveBeenCalledWith(
      expect.objectContaining({
        messageIds: [],
        includeLegacyCandidates: true,
      }),
    );
    expect(response.json().events[0].payload.content).toBe('Canonical legacy process explanation.');
    expect(JSON.stringify(response.json())).not.toContain('legacy event text must not be read');
    await app.close();
  });

  it('degrades an unreferenced legacy event when no unique message candidate exists', async () => {
    const app = Fastify();
    await registerWebChannel(
      app,
      makeDependencies(async () => ({
        availability: 'AVAILABLE',
        events: [
          referencedEvent('LLM_CONTENT_DELTA', 1, {
            stepId: 'turn-1',
            completed: true,
            content: 'legacy event text must not be read',
          }),
        ],
      })),
    );

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/sessions/session-event-history/runs/run-event-history/events',
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      events: [
        {
          eventType: 'LLM_CONTENT_DELTA',
          payload: {
            content: '',
            contentUnavailable: true,
            stepId: 'turn-1',
            completed: true,
          },
        },
      ],
    });
    expect(JSON.stringify(response.json())).not.toContain('legacy event text must not be read');
    await app.close();
  });

  it('degrades an unreferenced legacy event when multiple message candidates exist', async () => {
    const first = processMessage('assistant-tool-use-1', {
      role: 'ASSISTANT',
      content: JSON.stringify({
        content: 'First candidate must not be guessed.',
        toolCalls: [{ toolCallId: 'call-1', toolName: 'Read', arguments: {} }],
      }),
      visible: false,
      metadata: { kind: 'ASSISTANT_TOOL_USE', toolCallIds: ['call-1'] },
    });
    const second = processMessage('assistant-tool-use-2', {
      role: 'ASSISTANT',
      content: JSON.stringify({
        content: 'Second candidate must not be guessed.',
        toolCalls: [{ toolCallId: 'call-2', toolName: 'Glob', arguments: {} }],
      }),
      visible: false,
      metadata: { kind: 'ASSISTANT_TOOL_USE', toolCallIds: ['call-2'] },
    });
    const app = Fastify();
    await registerWebChannel(
      app,
      makeDependencies(
        async () => ({
          availability: 'AVAILABLE',
          events: [
            referencedEvent('CAPABILITY_STARTED', 1, {
              messageId: first.messageId,
              capabilityId: 'Read',
              toolCallId: 'call-1',
            }),
            referencedEvent('CAPABILITY_STARTED', 2, {
              messageId: second.messageId,
              capabilityId: 'Glob',
              toolCallId: 'call-2',
            }),
            referencedEvent('LLM_CONTENT_DELTA', 3, {
              stepId: 'turn-legacy',
              completed: true,
              content: 'legacy event text must not be read',
            }),
          ],
        }),
        vi.fn(async () => [first, second]),
      ),
    );

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/sessions/session-event-history/runs/run-event-history/events',
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().events[2].payload).toMatchObject({
      content: '',
      contentUnavailable: true,
    });
    expect(JSON.stringify(response.json())).not.toContain('candidate must not be guessed');
    expect(JSON.stringify(response.json())).not.toContain('legacy event text must not be read');
    await app.close();
  });

  it('projects trusted message-free Workflow lifecycle without resolving process Messages', async () => {
    const resolveProcessMessages = vi.fn(async () => []);
    const app = Fastify();
    await registerWebChannel(
      app,
      makeDependencies(
        async () => ({
          availability: 'AVAILABLE',
          events: [
            referencedEvent('CAPABILITY_STARTED', 1, {
              workflowEventType: 'NODE_STARTED',
              nodeId: 'tool-1',
              nodeType: 'TOOL',
              nodeExecutionId: 'node-execution-1',
              capabilityId: 'Read',
              toolCallId: 'workflow:execution-1:tool-1',
            }),
            referencedEvent('CAPABILITY_COMPLETED', 2, {
              workflowEventType: 'NODE_COMPLETED',
              nodeId: 'tool-1',
              nodeType: 'TOOL',
              nodeExecutionId: 'node-execution-1',
              capabilityId: 'Read',
              toolCallId: 'workflow:execution-1:tool-1',
              status: 'SUCCEEDED',
              durationMs: 12,
            }),
          ],
        }),
        resolveProcessMessages,
      ),
    );

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/sessions/session-event-history/runs/run-event-history/events',
    });

    expect(response.statusCode).toBe(200);
    expect(resolveProcessMessages).not.toHaveBeenCalled();
    expect(response.json()).toMatchObject({
      availability: 'AVAILABLE',
      events: [
        {
          eventType: 'CAPABILITY_STARTED',
          payload: {
            workflowEventType: 'NODE_STARTED',
            nodeId: 'tool-1',
            nodeType: 'TOOL',
            nodeExecutionId: 'node-execution-1',
            capabilityId: 'Read',
            toolCallId: 'workflow:execution-1:tool-1',
          },
        },
        {
          eventType: 'CAPABILITY_COMPLETED',
          payload: {
            workflowEventType: 'NODE_COMPLETED',
            nodeId: 'tool-1',
            nodeType: 'TOOL',
            nodeExecutionId: 'node-execution-1',
            capabilityId: 'Read',
            toolCallId: 'workflow:execution-1:tool-1',
            status: 'SUCCEEDED',
            durationMs: 12,
          },
        },
      ],
    });
    expect(JSON.stringify(response.json())).not.toContain('contentUnavailable');
    await app.close();
  });
});

function makeDependencies(
  listEvents: RuntimeSessionPort['listEvents'],
  resolveProcessMessages?: NonNullable<RuntimeSessionPort['resolveProcessMessages']>,
) {
  const session = (sessionId: string) => ({
    tenantId: brand<string, 'TenantId'>('tenant-event-history'),
    subjectId: brand<string, 'SubjectId'>('subject-event-history'),
    agentId: brand<string, 'AgentId'>('agent-event-history'),
    sessionId: brand<string, 'SessionId'>(sessionId),
    title: 'Event History',
    createdAt: brand<number, 'EpochMillis'>(1),
    updatedAt: brand<number, 'EpochMillis'>(1),
    hasInFlightRequest: false,
  });
  const sessions: RuntimeSessionPort = {
    createSession: vi.fn(async () => session('session-event-history')),
    requireSession: vi.fn(async ({ sessionId }) => session(sessionId)),
    listSessions: vi.fn(async () => ({ entries: [], offset: 0, limit: 50, hasMore: false })),
    deleteSession: vi.fn(async () => undefined),
    forkFromMessage: vi.fn(async () => {
      throw new Error('not used');
    }),
    forkFromRequest: vi.fn(async () => {
      throw new Error('not used');
    }),
    listMessages: vi.fn(async () => ({ items: [], limit: 20, hasMore: false })),
    listConversationPreview: vi.fn(async ({ sessionId }) => ({ sessionId, totalMarkers: 0, offset: 0, limit: 100, markers: [] })),
    updateTitle: vi.fn(async () => session('session-event-history')),
    streamEvents: vi.fn(async function* () {}),
    listEvents,
    ...(resolveProcessMessages === undefined ? {} : { resolveProcessMessages }),
    getActiveRun: vi.fn(async () => undefined),
    getRequestSummary: vi.fn(async () => undefined),
  };
  const runtime = {
    submit: vi.fn(),
    cancel: vi.fn(),
    retryLatest: vi.fn(),
    editLatest: vi.fn(),
    answerPendingInput: vi.fn(),
  } as unknown as RuntimeCommandPort;
  return {
    capabilityResultPresentationPolicy: detailPolicy,
    runtime,
    sessions,
    identityResolver: () => ({
      tenantId: brand<string, 'TenantId'>('tenant-event-history'),
      subjectId: brand<string, 'SubjectId'>('subject-event-history'),
      displayName: 'event-history-user',
    }),
    runtimeBootstrap: { transportKind: 'SSE' as const },
    skillCatalog: { listSkills: vi.fn(async () => ({ total: 0, pageNum: 1, pageSize: 50, skills: [] })) } as unknown as SkillCatalogQueryPort,
    defaultAgentId: brand<string, 'AgentId'>('agent-event-history'),
  };
}

const detailPolicy: CapabilityResultPresentationPolicy = Object.freeze({
  defaultLevel: 'DETAIL',
  levelByCapabilityId: new Map(),
});

function referencedEvent(
  type: 'LLM_CONTENT_DELTA' | 'LLM_THINKING_DELTA' | 'CAPABILITY_STARTED' | 'CAPABILITY_COMPLETED',
  sequence: number,
  inlinePayload: JsonObject,
): RunTimelineEvent {
  return {
    eventId: brand<string, 'TimelineEventId'>(`timeline-${sequence}`),
    sessionId: brand<string, 'SessionId'>('session-event-history'),
    requestId: brand<string, 'MessageId'>('request-event-history'),
    runId: brand<string, 'RequestRunId'>('run-event-history'),
    sequence: brand<number, 'TimelineSequence'>(sequence),
    type,
    persistence: 'PERSISTED',
    inlinePayload,
    createdAt: new Date(sequence * 1_000),
  };
}

function processMessage(messageId: string, overrides: Partial<SessionMessage> = {}): SessionMessage {
  return {
    messageId: brand<string, 'MessageId'>(messageId),
    sessionId: brand<string, 'SessionId'>('session-event-history'),
    requestId: brand<string, 'MessageId'>('request-event-history'),
    runId: brand<string, 'RequestRunId'>('run-event-history'),
    role: 'ASSISTANT',
    content: '',
    contentType: 'PLAIN_TEXT',
    metadata: {},
    sequence: 1,
    visible: true,
    createdAt: brand<number, 'EpochMillis'>(1),
    ...overrides,
  };
}
