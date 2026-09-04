import { brand, type JsonObject } from '@nextagent/agent-common';
import type { RunTimelineEvent } from '@nextagent/agent-contracts/runtime';
import { projectTimelineEventToStreamEnvelope } from '@nextagent/agent-channel-web';
import { describe, expect, it } from 'vitest';

describe('pending input projection', () => {
  it('projects text question prompts without requiring options', () => {
    const outcome = projectTimelineEventToStreamEnvelope(
      pendingInputRequiredEvent({
        questions: [{ prompt: 'Please provide the site name.' }],
      }),
    );

    expect(outcome.kind).toBe('ENVELOPE');
    if (outcome.kind === 'ENVELOPE') {
      expect(outcome.envelope.eventType).toBe('USER_INPUT_REQUIRED');
      expect(outcome.envelope.payload.questions).toEqual([{ prompt: 'Please provide the site name.' }]);
    }
  });

  it('projects bounded option-attached text input metadata', () => {
    const outcome = projectTimelineEventToStreamEnvelope(
      pendingInputRequiredEvent({
        questions: [
          {
            prompt: 'What should receive tests?',
            options: [
              {
                label: 'Existing project',
                value: 'existing_project',
                requiresTextInput: true,
                inputPlaceholder: 'Enter the project path',
              },
              { label: 'New project', value: 'new_project' },
            ],
          },
        ],
      }),
    );

    expect(outcome.kind).toBe('ENVELOPE');
    if (outcome.kind === 'ENVELOPE') {
      expect(outcome.envelope.payload.questions).toEqual([
        {
          prompt: 'What should receive tests?',
          options: [
            {
              label: 'Existing project',
              value: 'existing_project',
              requiresTextInput: true,
              inputPlaceholder: 'Enter the project path',
            },
            { label: 'New project', value: 'new_project' },
          ],
        },
      ]);
    }
  });

  it('drops ambiguous option-attached input projection', () => {
    const outcome = projectTimelineEventToStreamEnvelope(
      pendingInputRequiredEvent({
        questions: [
          {
            prompt: 'What should receive tests?',
            multiple: true,
            options: [
              { label: 'Existing project', value: 'existing_project', requiresTextInput: true },
              { label: 'New project', value: 'new_project' },
            ],
          },
        ],
      }),
    );

    expect(outcome.kind).toBe('ENVELOPE');
    if (outcome.kind === 'ENVELOPE') {
      expect(outcome.envelope.payload).not.toHaveProperty('questions');
    }
  });

  it('keeps USER_INPUT_RECEIVED answer-free even when answer fields are injected', () => {
    const outcome = projectTimelineEventToStreamEnvelope({
      ...pendingInputRequiredEvent({}),
      type: 'USER_INPUT_RECEIVED',
      inlinePayload: {
        pendingInputId: 'pending-input-projection',
        id: 'pending-input-projection',
        kind: 'QUESTION',
        status: 'RECEIVED',
        safeSummary: 'Pending input answer received.',
        answers: [['SECRET_ANSWER']],
        value: 'SECRET_VALUE',
        response: 'SECRET_RESPONSE',
      },
    });

    expect(outcome.kind).toBe('ENVELOPE');
    if (outcome.kind === 'ENVELOPE') {
      expect(outcome.envelope.payload).toMatchObject({
        pendingInputId: 'pending-input-projection',
        id: 'pending-input-projection',
        kind: 'QUESTION',
        status: 'RECEIVED',
        safeSummary: 'Pending input answer received.',
      });
      expect(JSON.stringify(outcome.envelope.payload)).not.toContain('SECRET_');
      expect(outcome.envelope.payload).not.toHaveProperty('answers');
      expect(outcome.envelope.payload).not.toHaveProperty('value');
      expect(outcome.envelope.payload).not.toHaveProperty('response');
    }
  });
});

function pendingInputRequiredEvent(inlinePayload: JsonObject): RunTimelineEvent {
  return {
    type: 'USER_INPUT_REQUIRED',
    eventId: 'timeline-pending-input-projection',
    sessionId: brand<string, 'SessionId'>('session-pending-input-projection'),
    requestId: brand<string, 'MessageId'>('request-pending-input-projection'),
    runId: brand<string, 'RequestRunId'>('run-pending-input-projection'),
    requestContextId: brand<string, 'RequestContextId'>('context-pending-input-projection'),
    sequence: brand<number, 'TimelineSequence'>(1),
    createdAt: new Date(1_000),
    inlinePayload: {
      pendingInputId: 'pending-input-projection',
      id: 'pending-input-projection',
      kind: 'QUESTION',
      status: 'PENDING',
      timeoutAt: 2_000,
      ...inlinePayload,
    } satisfies JsonObject,
  };
}
