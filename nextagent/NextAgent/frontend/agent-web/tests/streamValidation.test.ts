import { describe, expect, it } from 'vitest';

import { isStreamEnvelope, normalizeStreamEnvelope } from '../src/features/chat/utils/streamValidation.ts';
import type { StreamEnvelope } from '../src/state/contracts.ts';

type EnvelopeOverrides = Partial<Omit<StreamEnvelope, 'payload'>> & {
  payload?: Record<string, unknown>;
};

function makeEnvelope(overrides: EnvelopeOverrides = {}): unknown {
  return {
    eventId: 'evt-1',
    sessionId: 'session-1',
    requestId: 'req-1',
    sequence: 1,
    eventType: 'LLM_CONTENT_DELTA',
    timelineEventRef: null,
    transportHints: ['SSE'],
    payload: {
      text: 'hello',
      contentType: 'PLAIN_TEXT',
      metadata: { accumulated: true },
    },
    createdAt: '2026-04-24T12:00:00.000Z',
    ...overrides,
  };
}

describe('streamValidation', () => {
  it('rejects routing policy evidence outside the public stream vocabulary', () => {
    const normalized = normalizeStreamEnvelope(
      makeEnvelope({
        eventType: 'POLICY_APPLIED' as StreamEnvelope['eventType'],
        payload: {
          policyDomain: 'TARGETED_SKILL',
          outcome: 'selected',
          reasonCode: 'PREFERRED_SKILL_LOADED',
          selectedCapabilityId: 'alarm-diagnosis',
        },
      }),
    );

    expect(normalized).toBeNull();
  });

  it('normalizes result-stream accumulated flags into payload.metadata', () => {
    const normalized = normalizeStreamEnvelope(
      makeEnvelope({
        eventType: 'LLM_THINKING_DELTA',
        payload: {
          text: 'thinking',
          accumulated: false,
        },
      }),
    );

    expect(normalized).not.toBeNull();
    expect(normalized?.payload.contentType).toBe('PLAIN_TEXT');
    expect(normalized?.payload.metadata).toMatchObject({ accumulated: false });
  });

  it('normalizes lowercase content types for streamed content', () => {
    const normalized = normalizeStreamEnvelope(
      makeEnvelope({
        payload: {
          text: '### heading',
          contentType: 'markdown',
          metadata: { accumulated: true },
        },
      }),
    );

    expect(normalized).not.toBeNull();
    expect(normalized?.payload.contentType).toBe('MARKDOWN');
  });

  it('accepts backend delta-only content frames as incremental plain text', () => {
    const normalized = normalizeStreamEnvelope(
      makeEnvelope({
        payload: {
          delta: 'hel',
          accumulatedLength: 3,
        },
      }),
    );

    expect(normalized).not.toBeNull();
    expect(normalized?.payload.text).toBe('hel');
    expect(normalized?.payload.contentType).toBe('PLAIN_TEXT');
    expect(normalized?.payload.metadata).toMatchObject({ accumulated: false });
  });

  it('preserves leading and trailing spaces for thinking deltas', () => {
    const normalized = normalizeStreamEnvelope(
      makeEnvelope({
        eventType: 'LLM_THINKING_DELTA',
        payload: {
          text: ' api ',
        },
      }),
    );

    expect(normalized).not.toBeNull();
    expect(normalized?.payload.text).toBe(' api ');
  });

  it('preserves whitespace-only thinking delta chunks', () => {
    const first = normalizeStreamEnvelope(
      makeEnvelope({
        eventType: 'LLM_THINKING_DELTA',
        payload: {
          delta: 'data',
          metadata: { accumulated: false },
        },
      }),
    );
    const spacer = normalizeStreamEnvelope(
      makeEnvelope({
        eventId: 'evt-2',
        sequence: 2,
        eventType: 'LLM_THINKING_DELTA',
        payload: {
          delta: ' ',
          metadata: { accumulated: false },
        },
      }),
    );
    const third = normalizeStreamEnvelope(
      makeEnvelope({
        eventId: 'evt-3',
        sequence: 3,
        eventType: 'LLM_THINKING_DELTA',
        payload: {
          delta: 'structure',
          metadata: { accumulated: false },
        },
      }),
    );

    expect(first?.payload.text).toBe('data');
    expect(spacer?.payload.text).toBe(' ');
    expect(third?.payload.text).toBe('structure');
  });

  it('accepts NextAgent epoch-millis stream timestamps', () => {
    const createdAt = Date.parse('2026-04-24T12:00:00.000Z');
    const normalized = normalizeStreamEnvelope(makeEnvelope({ createdAt }));

    expect(normalized).not.toBeNull();
    expect(normalized?.createdAt).toBe(createdAt);
  });

  it('preserves whitespace-only assistant content delta chunks', () => {
    const normalized = normalizeStreamEnvelope(
      makeEnvelope({
        eventType: 'LLM_CONTENT_DELTA',
        payload: {
          delta: ' ',
        },
      }),
    );

    expect(normalized).not.toBeNull();
    expect(normalized?.payload.text).toBe(' ');
    expect(normalized?.payload.contentType).toBe('PLAIN_TEXT');
    expect(normalized?.payload.metadata).toMatchObject({ accumulated: false });
  });

  it('preserves whitespace-only capability result delta chunks', () => {
    const normalized = normalizeStreamEnvelope(
      makeEnvelope({
        eventType: 'CAPABILITY_RESULT_DELTA',
        payload: {
          toolCallId: 'tool-1',
          delta: ' ',
        },
      }),
    );

    expect(normalized).not.toBeNull();
    expect(normalized?.payload.text).toBe(' ');
    expect(normalized?.payload.contentType).toBe('PLAIN_TEXT');
    expect(normalized?.payload.metadata).toMatchObject({ accumulated: false });
  });

  it('accepts capability lifecycle events when a correlation id exists', () => {
    expect(
      isStreamEnvelope(
        makeEnvelope({
          eventType: 'CAPABILITY_STARTED',
          payload: {
            capabilityId: 'topologyDiscovery',
          },
        }),
      ),
    ).toBe(true);

    expect(
      isStreamEnvelope(
        makeEnvelope({
          eventType: 'CAPABILITY_COMPLETED',
          payload: {
            metadata: { invocationId: 'inv-1' },
          },
        }),
      ),
    ).toBe(true);
  });

  it('does not synthesize English prose for capability lifecycle events without business text', () => {
    const started = normalizeStreamEnvelope(
      makeEnvelope({
        eventType: 'CAPABILITY_STARTED',
        payload: {
          capabilityId: 'Agent',
        },
      }),
    );
    const completed = normalizeStreamEnvelope(
      makeEnvelope({
        eventType: 'CAPABILITY_COMPLETED',
        payload: {
          capabilityId: 'Agent',
          status: 'SUCCEEDED',
        },
      }),
    );

    expect(started).not.toBeNull();
    expect(completed).not.toBeNull();
    expect(started?.payload).not.toHaveProperty('text');
    expect(completed?.payload).not.toHaveProperty('text');
  });

  it('drops untrusted free text from capability start events', () => {
    const started = normalizeStreamEnvelope(
      makeEnvelope({
        eventType: 'CAPABILITY_STARTED',
        payload: {
          capabilityId: 'Agent',
          text: '正在委派网络数据检查任务。',
        },
      }),
    );

    expect(started).not.toBeNull();
    expect(started?.payload).not.toHaveProperty('text');
  });

  it('rejects capability lifecycle events without a correlation id', () => {
    expect(
      isStreamEnvelope(
        makeEnvelope({
          eventType: 'CAPABILITY_RESULT_DELTA',
          payload: {
            text: 'partial output',
            contentType: 'PLAIN_TEXT',
          },
        }),
      ),
    ).toBe(false);
  });

  it('rejects result-stream events when text is missing', () => {
    expect(
      isStreamEnvelope(
        makeEnvelope({
          eventType: 'LLM_CONTENT_DELTA',
          payload: {
            contentType: 'PLAIN_TEXT',
            metadata: { accumulated: true },
          },
        }),
      ),
    ).toBe(false);
  });

  it('rejects streamed content when contentType is missing', () => {
    expect(
      isStreamEnvelope(
        makeEnvelope({
          eventType: 'CAPABILITY_RESULT_DELTA',
          payload: {
            toolCallId: 'tool-1',
            text: 'partial output',
            metadata: { accumulated: true },
          },
        }),
      ),
    ).toBe(false);
  });

  it('accepts assistant content without contentType as markdown', () => {
    const normalized = normalizeStreamEnvelope(
      makeEnvelope({
        eventType: 'LLM_CONTENT_DELTA',
        payload: {
          text: '| A | B |\n| --- | --- |\n| 1 | 2 |',
          metadata: { accumulated: true },
        },
      }),
    );

    expect(normalized).not.toBeNull();
    expect(normalized?.payload.contentType).toBe('MARKDOWN');
    expect(normalized?.payload.text).toContain('| A | B |');
  });

  it('accepts empty assistant content completion markers', () => {
    const normalized = normalizeStreamEnvelope(
      makeEnvelope({
        eventId: 'llm-stream-ctx-1-complete',
        eventType: 'LLM_CONTENT_DELTA',
        payload: {
          complete: true,
          finishReason: 'tool_calls',
          contentType: 'PLAIN_TEXT',
        },
      }),
    );

    expect(normalized).not.toBeNull();
    expect(normalized?.eventType).toBe('LLM_CONTENT_DELTA');
    expect(normalized?.payload.text).toBe('');
    expect(normalized?.payload.complete).toBe(true);
    expect(normalized?.payload.finishReason).toBe('tool_calls');
    expect(normalized?.payload.contentType).toBe('PLAIN_TEXT');
  });

  it('accepts empty capability delta frames when a tool call id is present', () => {
    const normalized = normalizeStreamEnvelope(
      makeEnvelope({
        eventId: 'llm-stream-ctx-1-tool-delta-2',
        eventType: 'CAPABILITY_RESULT_DELTA',
        payload: {
          toolCallId: 'call-function-1',
          toolName: 'powershell',
          delta: '',
          contentType: 'PLAIN_TEXT',
        },
      }),
    );

    expect(normalized).not.toBeNull();
    expect(normalized?.eventType).toBe('CAPABILITY_RESULT_DELTA');
    expect(normalized?.payload.text).toBe('');
    expect(normalized?.payload.toolCallId).toBe('call-function-1');
    expect(normalized?.payload.contentType).toBe('PLAIN_TEXT');
  });

  it('accepts pre-invocation tool argument deltas identified by toolCallIndex', () => {
    const normalized = normalizeStreamEnvelope(
      makeEnvelope({
        eventId: 'llm-stream-ctx-1-tool-delta-3',
        eventType: 'CAPABILITY_RESULT_DELTA',
        payload: {
          toolCallId: '',
          toolName: '',
          toolCallIndex: 0,
          delta: '{"command":"ping 127.0.0.1 -n 4"}',
          contentType: 'PLAIN_TEXT',
        },
      }),
    );

    expect(normalized).not.toBeNull();
    expect(normalized?.eventType).toBe('CAPABILITY_RESULT_DELTA');
    expect(normalized?.payload.text).toBe('{"command":"ping 127.0.0.1 -n 4"}');
    expect(normalized?.payload.toolCallIndex).toBe(0);
    expect(normalized?.payload.toolCallId).toBe('');
    expect(normalized?.payload.contentType).toBe('PLAIN_TEXT');
  });

  it('keeps terminal events valid without forcing text or contentType', () => {
    const normalized = normalizeStreamEnvelope(
      makeEnvelope({
        eventType: 'REQUEST_COMPLETED',
        payload: {
          agentResponseRef: 'response-1',
        },
      }),
    );

    expect(normalized).not.toBeNull();
    expect(normalized?.eventType).toBe('REQUEST_COMPLETED');
    expect(normalized?.payload.text).toBe('Request completed');
    expect(normalized?.payload.contentType).toBe('PLAIN_TEXT');
    expect(normalized?.payload.metadata).toMatchObject({ accumulated: true });
  });

  it('normalizes all non-user-input web event payloads to text, contentType, and metadata.accumulated', () => {
    const eventTypes: Array<StreamEnvelope['eventType']> = [
      'REQUEST_ACCEPTED',
      'CAPABILITY_STARTED',
      'CAPABILITY_COMPLETED',
      'ATTACHMENT_ACCEPTED',
      'ATTACHMENT_REJECTED',
      'DEGRADATION_NOTICE',
      'CONTEXT_COMPACTED',
      'HOOK_DEGRADED',
      'REQUEST_COMPLETED',
      'REQUEST_FAILED',
      'REQUEST_CANCELED',
      'REQUEST_SUPERSEDED',
    ];

    for (const eventType of eventTypes) {
      const normalized = normalizeStreamEnvelope(
        makeEnvelope({
          eventType,
          payload: {
            capabilityId: eventType.startsWith('CAPABILITY') ? 'capability-1' : undefined,
            message: `${eventType} message`,
          },
        }),
      );

      if (eventType === 'CAPABILITY_STARTED') {
        expect(normalized?.payload).not.toHaveProperty('text');
      } else {
        expect(normalized?.payload.text).toBe(`${eventType} message`);
      }
      expect(normalized?.payload.contentType).toBe('PLAIN_TEXT');
      expect(normalized?.payload.metadata).toMatchObject({ accumulated: true });
    }
  });

  it('accepts the current stream identity fields without a legacy requestId', () => {
    const envelope = makeEnvelope() as Record<string, unknown>;
    delete envelope.requestId;
    envelope.runId = 'run-1';
    envelope.rootMessageId = 'root-1';
    envelope.requestContextId = 'ctx-1';
    envelope.payload = {
      text: 'hello',
      contentType: 'PLAIN_TEXT',
      metadata: { accumulated: true },
    };
    const normalized = normalizeStreamEnvelope(envelope);

    expect(normalized).toMatchObject({
      requestId: 'ctx-1',
      runId: 'run-1',
      rootMessageId: 'root-1',
      requestContextId: 'ctx-1',
    });
  });
});
