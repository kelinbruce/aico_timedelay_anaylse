import { createNextAgentTestApp } from '@nextagent/agent-platform-gateway-local/testing';
import { brand, type EpochMillis, type JsonObject, type RunStatus, type TimelineEventType } from '@nextagent/agent-common';
import type { StreamEventType } from '@nextagent/agent-contracts/channel';
import type { RunTimelineEvent } from '@nextagent/agent-contracts/runtime';
import {
  isProjectedEvent,
  projectRunStatus,
  projectTimelineEventsToStreamEnvelopes,
  projectTimelineEventToStreamEnvelope,
} from '@nextagent/agent-channel-web';
import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const sessionId = brand<string, 'SessionId'>('session-run-status');
const requestId = brand<string, 'MessageId'>('request-run-status');
const runId = brand<string, 'RequestRunId'>('run-run-status');
const requestContextId = brand<string, 'RequestContextId'>('context-run-status');
const createdAt = new Date(1_000);

const streamEventTypes = [
  'REQUEST_ACCEPTED',
  'LLM_THINKING_DELTA',
  'LLM_CONTENT_DELTA',
  'CAPABILITY_STARTED',
  'CAPABILITY_RESULT_DELTA',
  'CAPABILITY_COMPLETED',
  'DEGRADATION_NOTICE',
  'REQUEST_COMPLETED',
  'REQUEST_FAILED',
  'REQUEST_CANCELED',
  'REQUEST_SUPERSEDED',
  'USER_INPUT_REQUIRED',
  'USER_INPUT_RECEIVED',
  'USER_INPUT_TIMEOUT',
  'USER_INPUT_CANCELED',
  'ATTACHMENT_ACCEPTED',
  'ATTACHMENT_REJECTED',
  'CONTEXT_COMPACTED',
] as const satisfies readonly StreamEventType[];

const nonStreamEventTypes = [
  'PLANNING_STARTED',
  'MODEL_INVOCATION_STARTED',
  'MODEL_INVOCATION_COMPLETED',
  'MODEL_INVOCATION_FAILED',
  'POLICY_APPLIED',
  'HOOK_INVOKED',
] as const satisfies readonly TimelineEventType[];

const deprecatedEventNames = ['THINKING_SUMMARY', 'CONTENT_DELTA', 'CAPABILITY_PROGRESS', 'CAPABILITY_FINISHED', 'CAPABILITY_DISCOVERED'] as const;

describe('run status visibility and stream projection', () => {
  it('projects only canonical stream event names and rejects deprecated public event aliases', async () => {
    for (const type of streamEventTypes) {
      expect(isProjectedEvent(type)).toBe(true);
      const outcome = projectTimelineEventToStreamEnvelope(timelineEvent(type, payloadFor(type)), { clock });
      expect(outcome.kind).toBe('ENVELOPE');
      if (outcome.kind === 'ENVELOPE') {
        expect(outcome.envelope.eventType).toBe(type);
        expect(outcome.envelope.eventId).toBe(`stream:timeline-${type}`);
        expect(outcome.envelope.timelineEventRef).toBe(`timeline-${type}`);
        expect(outcome.envelope.sequence).toBe(brand<number, 'TimelineSequence'>(7));
        expect(outcome.envelope.createdAt).toBe(brand<number, 'EpochMillis'>(1_000));
      }
    }

    for (const type of nonStreamEventTypes) {
      expect(isProjectedEvent(type)).toBe(false);
      const outcome = projectTimelineEventToStreamEnvelope(
        {
          ...timelineEvent(type as TimelineEventType),
          type: type as TimelineEventType,
          ...(type === 'HOOK_INVOKED'
            ? {
                inlinePayload: {
                  status: 'SUCCESS',
                  outcome: 'PASS',
                  failureMode: 'CONTINUE',
                  resultSummary: { a: 1, b: 2 },
                },
              }
            : {}),
        },
        { clock },
      );
      expect(outcome.kind).toBe('TIMELINE_ONLY');
    }

    for (const type of deprecatedEventNames) {
      expect(isProjectedEvent(type)).toBe(false);
      const outcome = projectTimelineEventToStreamEnvelope(
        { ...timelineEvent(type as TimelineEventType), type: type as TimelineEventType },
        { clock },
      );
      expect(outcome.kind).toBe('PROJECTION_FAILURE');
      if (outcome.kind === 'PROJECTION_FAILURE') {
        expect(outcome.safeError.code).toBe('DEPRECATED_STREAM_EVENT_NAME');
      }
    }

    const projected = await collect(
      projectTimelineEventsToStreamEnvelopes(events(...nonStreamEventTypes.map((type) => timelineEvent(type))), { clock }),
    );
    expect(projected).toHaveLength(0);
  });

  it('silently drops unrecognized event names and continues streaming subsequent visible events', async () => {
    const projected = await collect(
      projectTimelineEventsToStreamEnvelopes(
        events(
          {
            ...timelineEvent('REQUEST_ACCEPTED'),
            type: 'STREAM_STARTED' as TimelineEventType,
          },
          timelineEvent('LLM_CONTENT_DELTA', { content: 'should still be sent after dropped event' }),
        ),
        { clock },
      ),
    );

    expect(projected).toHaveLength(1);
    expect(projected[0]?.eventType).toBe('LLM_CONTENT_DELTA');
    expect(projected[0]?.payload.content).toBe('should still be sent after dropped event');
  });

  it('keeps canonical run status visible without deriving it from request-accepted event names', () => {
    const statuses = [
      'ACCEPTED',
      'QUEUED',
      'PLANNING',
      'EXECUTING',
      'COMPLETED',
      'FAILED',
      'CANCELED',
      'SUPERSEDED',
    ] as const satisfies readonly RunStatus[];
    expect(statuses.map(projectRunStatus)).toEqual(statuses);

    const accepted = projectTimelineEventToStreamEnvelope(timelineEvent('REQUEST_ACCEPTED', { attempt: 1, status: 'QUEUED' }), { clock });
    expect(accepted.kind).toBe('ENVELOPE');
    if (accepted.kind === 'ENVELOPE') {
      expect(accepted.envelope.eventType).toBe('REQUEST_ACCEPTED');
      expect(accepted.envelope.payload.status).toBe('QUEUED');
    }
  });

  it('projects pending input as a safe summary and drops raw answers, prompts and credentials', () => {
    const outcome = projectTimelineEventToStreamEnvelope(
      timelineEvent('USER_INPUT_REQUIRED', {
        pendingInputId: 'pending-1',
        id: 'pending-1',
        kind: 'QUESTION',
        questions: [
          {
            prompt: 'Approve?',
            options: [{ label: 'Yes', value: 'yes', secret: 'option-secret' }],
            multiple: true,
            custom: true,
            answerSchema: { type: 'string' },
            hiddenReasoning: 'hidden',
          },
        ],
        timeoutAt: 123_456,
        status: 'PENDING',
        identity: { tenantId: 'tenant-leak' },
        idempotencyKey: 'idem-leak',
        rawAnswer: 'raw answer',
        timeoutBehavior: 'auto-submit',
        modelFormattedAnswer: 'model answer',
        rawPrompt: 'hidden prompt',
        secret: 'secret',
        credential: 'credential',
        localPath: 'C:\\secret.txt',
      }),
      { clock },
    );

    expect(outcome.kind).toBe('ENVELOPE');
    if (outcome.kind === 'ENVELOPE') {
      expect(outcome.envelope.payload).toMatchObject({
        pendingInputId: 'pending-1',
        id: 'pending-1',
        kind: 'QUESTION',
        timeoutAt: 123_456,
        status: 'PENDING',
        questions: [
          {
            prompt: 'Approve?',
            options: [{ label: 'Yes', value: 'yes' }],
            multiple: true,
            custom: true,
          },
        ],
      });
      expect(Object.keys(outcome.envelope.payload)).not.toContain('identity');
      expect(Object.keys(outcome.envelope.payload)).not.toContain('idempotencyKey');
      expect(Object.keys(outcome.envelope.payload)).not.toContain('rawAnswer');
      expect(Object.keys(outcome.envelope.payload)).not.toContain('timeoutBehavior');
      expect(Object.keys(outcome.envelope.payload)).not.toContain('modelFormattedAnswer');
      expect(Object.keys(outcome.envelope.payload)).not.toContain('rawPrompt');
      expect(Object.keys(outcome.envelope.payload)).not.toContain('secret');
      expect(Object.keys(outcome.envelope.payload)).not.toContain('credential');
      expect(Object.keys(outcome.envelope.payload)).not.toContain('localPath');
      expect(JSON.stringify(outcome.envelope.payload)).not.toContain('answerSchema');
      expect(JSON.stringify(outcome.envelope.payload)).not.toContain('hiddenReasoning');
      expect(JSON.stringify(outcome.envelope.payload)).not.toContain('option-secret');
    }

    const timeout = projectTimelineEventToStreamEnvelope(
      timelineEvent('USER_INPUT_TIMEOUT', {
        pendingInputId: 'pending-1',
        id: 'pending-1',
        kind: 'HUMAN_HANDOFF',
        status: 'TIMED_OUT',
        safeSummary: 'Pending input timed out.',
        timeoutAt: 123_456,
        questions: [{ prompt: 'Approve?', options: [{ label: 'Yes', value: 'yes' }] }],
        operatorNotes: 'private operator note',
        assignment: { queue: 'handoff-queue' },
        workbenchState: { tab: 'private' },
        identity: { tenantId: 'tenant-leak' },
        idempotencyKey: 'idem-leak',
        rawAnswer: 'raw answer',
        timeoutBehavior: 'auto-submit',
        modelFormattedAnswer: 'model answer',
        rawPrompt: 'hidden prompt',
        secret: 'secret',
        credential: 'credential',
        localPath: 'C:\\secret.txt',
      }),
      { clock },
    );

    expect(timeout.kind).toBe('ENVELOPE');
    if (timeout.kind === 'ENVELOPE') {
      expect(timeout.envelope.payload).toMatchObject({
        pendingInputId: 'pending-1',
        id: 'pending-1',
        kind: 'HUMAN_HANDOFF',
        status: 'TIMED_OUT',
        safeSummary: 'Pending input timed out.',
      });
      expect(Object.keys(timeout.envelope.payload)).not.toContain('timeoutAt');
      expect(Object.keys(timeout.envelope.payload)).not.toContain('questions');
      expect(Object.keys(timeout.envelope.payload)).not.toContain('operatorNotes');
      expect(Object.keys(timeout.envelope.payload)).not.toContain('assignment');
      expect(Object.keys(timeout.envelope.payload)).not.toContain('workbenchState');
      expect(Object.keys(timeout.envelope.payload)).not.toContain('identity');
      expect(Object.keys(timeout.envelope.payload)).not.toContain('idempotencyKey');
      expect(Object.keys(timeout.envelope.payload)).not.toContain('rawAnswer');
      expect(Object.keys(timeout.envelope.payload)).not.toContain('timeoutBehavior');
      expect(Object.keys(timeout.envelope.payload)).not.toContain('modelFormattedAnswer');
      expect(Object.keys(timeout.envelope.payload)).not.toContain('rawPrompt');
      expect(Object.keys(timeout.envelope.payload)).not.toContain('secret');
      expect(Object.keys(timeout.envelope.payload)).not.toContain('credential');
      expect(Object.keys(timeout.envelope.payload)).not.toContain('localPath');
    }
  });

  it('projects bounded AskUserQuestion answers with stable order and Unicode code-point limits', () => {
    const longUnicodeAnswer = `${'😀'.repeat(4_096)}TAIL_SHOULD_NOT_LEAK`;
    const outcome = projectTimelineEventToStreamEnvelope(
      timelineEvent('CAPABILITY_RESULT_DELTA', {
        capabilityId: 'AskUserQuestion',
        toolCallId: 'ask-user-1',
        pendingInputId: 'pending-1',
        kind: 'QUESTION',
        status: 'RECEIVED',
        safeSummary: 'Pending input answer received.',
        answers: [
          ['site-a', 'site-b', longUnicodeAnswer, 'item-4', 'item-5', 'item-6', 'item-7', 'item-8', 'item-9', 'item-10'],
          ['second-group'],
          ['third-group'],
          ['fourth-group'],
        ],
        rawPrompt: 'SECRET_PROMPT',
        credential: 'SECRET_CREDENTIAL',
      }),
      { clock },
    );

    expect(outcome.kind).toBe('ENVELOPE');
    if (outcome.kind === 'ENVELOPE') {
      expect(outcome.envelope.payload).toMatchObject({
        capabilityId: 'AskUserQuestion',
        toolCallId: 'ask-user-1',
        pendingInputId: 'pending-1',
        kind: 'QUESTION',
        status: 'RECEIVED',
        safeSummary: 'Pending input answer received.',
        safeResult: {
          kind: 'pendingInputAnswer',
          truncated: true,
        },
      });
      const safeResult = outcome.envelope.payload.safeResult as {
        readonly answers: ReadonlyArray<readonly string[]>;
        readonly truncated: boolean;
      };
      expect(safeResult.answers).toHaveLength(4);
      expect(safeResult.answers[0]).toHaveLength(9);
      expect(safeResult.answers[0]?.slice(0, 2)).toEqual(['site-a', 'site-b']);
      expect(Array.from(safeResult.answers[0]?.[2] ?? '')).toHaveLength(4_096);
      expect(safeResult.answers[1]).toEqual(['second-group']);
      expect(safeResult.answers[2]).toEqual(['third-group']);
      expect(safeResult.answers[3]).toEqual(['fourth-group']);
      expect(JSON.stringify(outcome.envelope.payload)).not.toContain('TAIL_SHOULD_NOT_LEAK');
      expect(JSON.stringify(outcome.envelope.payload)).not.toContain('SECRET_PROMPT');
      expect(JSON.stringify(outcome.envelope.payload)).not.toContain('SECRET_CREDENTIAL');
      expect(outcome.envelope.payload.text).toBe('');
      expect(outcome.envelope.payload.content).toBe('');
    }
  });

  it('projects bounded AskUserQuestion answers within the shared total code-point budget', () => {
    const outcome = projectTimelineEventToStreamEnvelope(
      timelineEvent('CAPABILITY_RESULT_DELTA', {
        capabilityId: 'AskUserQuestion',
        toolCallId: 'ask-user-budget',
        pendingInputId: 'pending-budget',
        kind: 'QUESTION',
        status: 'RECEIVED',
        answers: [Array.from({ length: 7 }, (_, index) => String(index).repeat(4_096))],
      }),
      { clock },
    );

    expect(outcome.kind).toBe('ENVELOPE');
    if (outcome.kind === 'ENVELOPE') {
      expect(outcome.envelope.payload.safeResult).toMatchObject({
        kind: 'pendingInputAnswer',
        truncated: true,
        answers: [expect.any(Array)],
      });
      const answers = (
        outcome.envelope.payload.safeResult as {
          readonly answers: ReadonlyArray<readonly string[]>;
        }
      ).answers;
      expect(answers[0]).toHaveLength(6);
      expect(answers.flatMap((group) => group).reduce((sum, item) => sum + Array.from(item).length, 0)).toBe(24_576);
    }
  });

  it('fails closed for malformed or non-question AskUserQuestion answer results', () => {
    const invalidPayloads = [
      {
        capabilityId: 'askuserquestion',
        toolCallId: 'ask-user-1',
        pendingInputId: 'pending-1',
        kind: 'QUESTION',
        status: 'RECEIVED',
        answers: [['SECRET_WRONG_IDENTITY']],
      },
      {
        capabilityId: 'AskUserQuestion',
        toolCallId: 'ask-user-1',
        pendingInputId: 'pending-1',
        kind: 'CONFIRMATION',
        status: 'RECEIVED',
        answers: [['SECRET_WRONG_KIND']],
      },
      {
        capabilityId: 'AskUserQuestion',
        toolCallId: 'ask-user-1',
        pendingInputId: 'pending-1',
        kind: 'QUESTION',
        status: 'RECEIVED',
        answers: [['']],
      },
    ];

    for (const inlinePayload of invalidPayloads) {
      const outcome = projectTimelineEventToStreamEnvelope(timelineEvent('CAPABILITY_RESULT_DELTA', inlinePayload), { clock });
      expect(outcome.kind).toBe('ENVELOPE');
      if (outcome.kind === 'ENVELOPE') {
        expect(outcome.envelope.payload.safeResult).toBeUndefined();
        expect(JSON.stringify(outcome.envelope.payload)).not.toContain('SECRET_');
      }
    }
  });

  it('projects capability results as allowlisted safe results without exposing raw payload fields', () => {
    const outcome = projectTimelineEventToStreamEnvelope(
      timelineEvent('CAPABILITY_RESULT_DELTA', {
        capabilityId: 'Read',
        toolCallId: 'tool-1',
        status: 'SUCCEEDED',
        safeSummary: 'Capability result is available.',
        result: {
          file_path: 'src/readme.md',
          content: 'safe file content',
          offset: 0,
          limit: 20,
          truncated: true,
          nextOffset: 20,
          credential: 'RAW_CAPABILITY_SECRET',
          nested: { token: 'token-leak' },
        },
      }),
      { clock },
    );

    expect(outcome.kind).toBe('ENVELOPE');
    if (outcome.kind === 'ENVELOPE') {
      expect(outcome.envelope.payload.text).toBe('');
      expect(outcome.envelope.payload.content).toBe(outcome.envelope.payload.text);
      expect(outcome.envelope.payload.safeSummary).toBeUndefined();
      expect(outcome.envelope.payload.safeResult).toBeUndefined();
      const serialized = JSON.stringify(outcome.envelope.payload);
      expect(serialized).not.toContain('RAW_CAPABILITY_SECRET');
      expect(serialized).not.toContain('token-leak');
      expect(Object.keys(outcome.envelope.payload)).not.toContain('result');
    }
  });

  it('bounds projected file read result previews', () => {
    const longContent = `${'a'.repeat(4_100)}TAIL_SHOULD_NOT_LEAK`;
    const outcome = projectTimelineEventToStreamEnvelope(
      timelineEvent('CAPABILITY_RESULT_DELTA', {
        capabilityId: 'read',
        toolCallId: 'tool-1',
        status: 'SUCCEEDED',
        result: {
          file_path: 'src/large.md',
          content: longContent,
          offset: 0,
          limit: 2000,
          truncated: false,
        },
      }),
      { clock },
    );

    expect(outcome.kind).toBe('ENVELOPE');
    if (outcome.kind === 'ENVELOPE') {
      expect(outcome.envelope.payload.text).toBe('');
      expect(outcome.envelope.payload.text).not.toContain('TAIL_SHOULD_NOT_LEAK');
      expect(outcome.envelope.payload.safeResult).toBeUndefined();
      expect(JSON.stringify(outcome.envelope.payload)).not.toContain('TAIL_SHOULD_NOT_LEAK');
    }
  });

  it('projects command error codes separately from safe error information', () => {
    const outcome = projectTimelineEventToStreamEnvelope(
      timelineEvent('CAPABILITY_RESULT_DELTA', {
        capabilityId: 'bash',
        toolCallId: 'tool-1',
        status: 'SUCCEEDED',
        result: {
          exitCode: 126,
          stdout: '',
          stderr: 'COMMAND_NOT_ALLOWED: Bash command is not allowed by policy.',
        },
      }),
      { clock },
    );

    expect(outcome.kind).toBe('ENVELOPE');
    if (outcome.kind === 'ENVELOPE') {
      expect(outcome.envelope.payload.safeSummary).toBeUndefined();
      expect(outcome.envelope.payload.text).toBe('');
      expect(JSON.stringify(outcome.envelope.payload)).not.toContain('COMMAND_NOT_ALLOWED');
    }
  });

  it('projects directed Skill lifecycle identity through the public stream envelope', async () => {
    const projected = await collect(
      projectTimelineEventsToStreamEnvelopes(
        events(
          timelineEvent('CAPABILITY_STARTED', {
            messageId: 'assistant-tool-use',
            capabilityKind: 'TOOL',
            capabilityId: 'Skill',
            targetCapabilityId: 'alarm-diagnosis',
            toolCallId: 'directed-skill:alarm-diagnosis',
            stepId: 'turn-1',
          }),
          timelineEvent('CAPABILITY_COMPLETED', {
            messageId: 'capability-result',
            capabilityKind: 'TOOL',
            capabilityId: 'Skill',
            targetCapabilityId: 'alarm-diagnosis',
            toolCallId: 'directed-skill:alarm-diagnosis',
            status: 'SUCCEEDED',
            durationMs: 12,
          }),
        ),
        { clock },
      ),
    );

    expect(projected.map((envelope) => envelope.eventType)).toEqual(['CAPABILITY_STARTED', 'CAPABILITY_COMPLETED']);
    expect(projected[0]?.payload).toMatchObject({
      capabilityKind: 'TOOL',
      capabilityId: 'Skill',
      targetCapabilityId: 'alarm-diagnosis',
      toolCallId: 'directed-skill:alarm-diagnosis',
    });
    expect(projected[1]?.payload).toMatchObject({
      capabilityKind: 'TOOL',
      capabilityId: 'Skill',
      targetCapabilityId: 'alarm-diagnosis',
      toolCallId: 'directed-skill:alarm-diagnosis',
      status: 'SUCCEEDED',
    });
  });

  it('projects safe capability failure fields from completion events without raw safe error messages', () => {
    const outcome = projectTimelineEventToStreamEnvelope(
      timelineEvent('CAPABILITY_COMPLETED', {
        capabilityId: 'glob',
        toolCallId: 'tool-glob-1',
        status: 'FAILED',
        safeError: {
          code: 'CAPABILITY_INPUT_INVALID',
          category: 'VALIDATION',
          message: 'Raw validator message with D:\\secret\\workspace',
          safeDetails: { rawPath: 'D:\\secret\\workspace' },
        },
      }),
      { clock },
    );

    expect(outcome.kind).toBe('ENVELOPE');
    if (outcome.kind === 'ENVELOPE') {
      expect(outcome.envelope.payload).toMatchObject({
        capabilityId: 'glob',
        toolCallId: 'tool-glob-1',
        status: 'FAILED',
        safeErrorCode: 'CAPABILITY_INPUT_INVALID',
        safeErrorCategory: 'VALIDATION',
        safeSummary: 'Tool input is invalid, so the capability was not executed.',
      });
      const serialized = JSON.stringify(outcome.envelope.payload);
      expect(serialized).not.toContain('Raw validator message');
      expect(serialized).not.toContain('D:\\secret\\workspace');
      expect(serialized).not.toContain('rawPath');
      expect(Object.keys(outcome.envelope.payload)).not.toContain('safeError');
    }
  });

  it('preserves non-generic upstream safe summaries on failed completion events', () => {
    const outcome = projectTimelineEventToStreamEnvelope(
      timelineEvent('CAPABILITY_COMPLETED', {
        capabilityId: 'Write',
        toolCallId: 'tool-write-extension-rejected',
        status: 'FAILED',
        safeErrorCode: 'CAPABILITY_PATH_REJECTED',
        safeErrorCategory: 'AUTHORIZATION',
        safeSummary: 'Path access was blocked by policy.',
        result: {
          file_path: 'workspace/secret.exe',
          content: 'raw content must stay hidden',
        },
      }),
      { clock },
    );

    expect(outcome.kind).toBe('ENVELOPE');
    if (outcome.kind === 'ENVELOPE') {
      expect(outcome.envelope.payload).toMatchObject({
        capabilityId: 'Write',
        toolCallId: 'tool-write-extension-rejected',
        status: 'FAILED',
        safeErrorCode: 'CAPABILITY_PATH_REJECTED',
        safeErrorCategory: 'AUTHORIZATION',
        safeSummary: 'Path access was blocked by policy.',
      });
      const serialized = JSON.stringify(outcome.envelope.payload);
      expect(serialized).not.toContain('workspace/secret.exe');
      expect(serialized).not.toContain('raw content must stay hidden');
      expect(Object.keys(outcome.envelope.payload)).not.toContain('result');
    }
  });

  it('falls back to generic path-rejected summary when completion safe summary is generic', () => {
    const outcome = projectTimelineEventToStreamEnvelope(
      timelineEvent('CAPABILITY_COMPLETED', {
        capabilityId: 'Write',
        toolCallId: 'tool-write-path-rejected',
        status: 'FAILED',
        safeErrorCode: 'CAPABILITY_PATH_REJECTED',
        safeErrorCategory: 'AUTHORIZATION',
        safeSummary: 'Capability result is available.',
      }),
      { clock },
    );

    expect(outcome.kind).toBe('ENVELOPE');
    if (outcome.kind === 'ENVELOPE') {
      expect(outcome.envelope.payload.safeSummary).toBe('Path access was blocked by policy.');
    }
  });

  it('projects safe capability failure fields from result deltas without copying raw result payload', () => {
    const outcome = projectTimelineEventToStreamEnvelope(
      timelineEvent('CAPABILITY_RESULT_DELTA', {
        capabilityId: 'glob',
        toolCallId: 'tool-glob-1',
        status: 'FAILED',
        safeSummary: 'Capability result is available.',
        result: {
          safeError: {
            code: 'CAPABILITY_INPUT_INVALID',
            category: 'VALIDATION',
            message: 'Raw validator message with D:\\secret\\workspace',
          },
          rawArgs: { pattern: 'D:\\secret\\workspace\\*.ts' },
        },
      }),
      { clock },
    );

    expect(outcome.kind).toBe('ENVELOPE');
    if (outcome.kind === 'ENVELOPE') {
      expect(outcome.envelope.payload.text).toBe('');
      expect(outcome.envelope.payload.content).toBe('');
      expect(outcome.envelope.payload.safeErrorCode).toBe('CAPABILITY_INPUT_INVALID');
      expect(outcome.envelope.payload.safeErrorCategory).toBe('VALIDATION');
      expect(outcome.envelope.payload.safeSummary).toBe('Tool input is invalid, so the capability was not executed.');
      expect(outcome.envelope.payload.safeResult).toBeUndefined();
      const serialized = JSON.stringify(outcome.envelope.payload);
      expect(serialized).not.toContain('Raw validator message');
      expect(serialized).not.toContain('D:\\secret\\workspace');
      expect(serialized).not.toContain('rawArgs');
      expect(Object.keys(outcome.envelope.payload)).not.toContain('result');
      expect(Object.keys(outcome.envelope.payload)).not.toContain('safeError');
    }
  });

  it('preserves non-generic upstream safe summaries on failed result deltas', () => {
    const outcome = projectTimelineEventToStreamEnvelope(
      timelineEvent('CAPABILITY_RESULT_DELTA', {
        capabilityId: 'Edit',
        toolCallId: 'tool-edit-extension-rejected',
        status: 'FAILED',
        safeErrorCode: 'CAPABILITY_PATH_REJECTED',
        safeErrorCategory: 'AUTHORIZATION',
        safeSummary: 'File extension is not allowed by Agent workspace policy.',
        result: {
          safeError: {
            code: 'CAPABILITY_PATH_REJECTED',
            category: 'AUTHORIZATION',
            message: 'Raw file path D:\\secret\\run.exe must stay hidden',
          },
          rawArgs: { file_path: 'D:\\secret\\run.exe' },
        },
      }),
      { clock },
    );

    expect(outcome.kind).toBe('ENVELOPE');
    if (outcome.kind === 'ENVELOPE') {
      expect(outcome.envelope.payload.text).toBe('');
      expect(outcome.envelope.payload.content).toBe('');
      expect(outcome.envelope.payload.safeErrorCode).toBe('CAPABILITY_PATH_REJECTED');
      expect(outcome.envelope.payload.safeErrorCategory).toBe('AUTHORIZATION');
      expect(outcome.envelope.payload.safeSummary).toBe('Path access was blocked by policy.');
      const serialized = JSON.stringify(outcome.envelope.payload);
      expect(serialized).not.toContain('Raw file path');
      expect(serialized).not.toContain('D:\\secret\\run.exe');
      expect(serialized).not.toContain('rawArgs');
      expect(Object.keys(outcome.envelope.payload)).not.toContain('result');
      expect(Object.keys(outcome.envelope.payload)).not.toContain('safeError');
    }
  });

  it('falls back to generic path-rejected summary when result delta safe summary is generic', () => {
    const outcome = projectTimelineEventToStreamEnvelope(
      timelineEvent('CAPABILITY_RESULT_DELTA', {
        capabilityId: 'Edit',
        toolCallId: 'tool-edit-path-rejected',
        status: 'FAILED',
        safeErrorCode: 'CAPABILITY_PATH_REJECTED',
        safeErrorCategory: 'AUTHORIZATION',
        safeSummary: 'Capability result is available.',
      }),
      { clock },
    );

    expect(outcome.kind).toBe('ENVELOPE');
    if (outcome.kind === 'ENVELOPE') {
      expect(outcome.envelope.payload.safeSummary).toBe('Path access was blocked by policy.');
    }
  });

  it('projects file write status with safe display paths', () => {
    const outcome = projectTimelineEventToStreamEnvelope(
      timelineEvent('CAPABILITY_RESULT_DELTA', {
        capabilityId: 'write',
        toolCallId: 'tool-write-1',
        status: 'SUCCEEDED',
        result: {
          type: 'create',
          file_path: 'diagnostics/generated/alarm-summary.txt',
        },
      }),
      { clock },
    );

    expect(outcome.kind).toBe('ENVELOPE');
    if (outcome.kind === 'ENVELOPE') {
      expect(outcome.envelope.payload.text).toBe('');
      expect(outcome.envelope.payload.safeSummary).toBeUndefined();
      expect(outcome.envelope.payload.safeResult).toBeUndefined();
      const serialized = JSON.stringify(outcome.envelope.payload);
      expect(serialized).not.toContain('file_path');
      expect(Object.keys(outcome.envelope.payload)).not.toContain('result');
    }
  });

  it('projects absolute file paths as non-absolute display paths', () => {
    const outcome = projectTimelineEventToStreamEnvelope(
      timelineEvent('CAPABILITY_RESULT_DELTA', {
        capabilityId: 'Read',
        toolCallId: 'tool-read-absolute',
        status: 'SUCCEEDED',
        result: {
          file_path: 'D:\\tenant\\workspace\\diagnostics\\secret-report.md',
          content: 'safe preview',
          truncated: false,
        },
      }),
      { clock },
    );

    expect(outcome.kind).toBe('ENVELOPE');
    if (outcome.kind === 'ENVELOPE') {
      const serialized = JSON.stringify(outcome.envelope.payload);
      expect(outcome.envelope.payload.safeSummary).toBeUndefined();
      expect(outcome.envelope.payload.text).toBe('');
      expect(outcome.envelope.payload.safeResult).toBeUndefined();
      expect(serialized).not.toContain('D:\\tenant');
      expect(serialized).not.toContain('D:/tenant');
      expect(serialized).not.toContain('file_path');
      expect(Object.keys(outcome.envelope.payload)).not.toContain('result');
    }
  });

  it('projects upstream safe capability result fields for frontend display', () => {
    const outcome = projectTimelineEventToStreamEnvelope(
      timelineEvent('CAPABILITY_RESULT_DELTA', {
        capabilityId: 'external-tool',
        toolCallId: 'tool-external-1',
        status: 'SUCCEEDED',
        safeSummary: 'External stream event received.',
        safeDetailText: 'safe preview text',
        safeResult: {
          kind: 'externalStreamEvent',
          eventType: 'progress',
          dataPreview: '{"progress":1}',
          dataTruncated: false,
        },
        result: {
          routingRef: 'private-route-should-stay-hidden',
          rawPayload: { token: 'raw-result-should-stay-hidden' },
        },
      }),
      { clock },
    );

    expect(outcome.kind).toBe('ENVELOPE');
    if (outcome.kind === 'ENVELOPE') {
      expect(outcome.envelope.payload.text).toBe('');
      expect(outcome.envelope.payload.content).toBe('');
      expect(outcome.envelope.payload.safeSummary).toBeUndefined();
      expect(outcome.envelope.payload.safeResult).toBeUndefined();
      const serialized = JSON.stringify(outcome.envelope.payload);
      expect(serialized).not.toContain('private-route-should-stay-hidden');
      expect(serialized).not.toContain('raw-result-should-stay-hidden');
      expect(Object.keys(outcome.envelope.payload)).not.toContain('result');
    }
  });

  it('does not infer stream text from nested event payloads without upstream safe fields', () => {
    const outcome = projectTimelineEventToStreamEnvelope(
      timelineEvent('CAPABILITY_RESULT_DELTA', {
        capabilityId: 'external-tool',
        toolCallId: 'tool-external-1',
        status: 'SUCCEEDED',
        result: {
          event: { type: 'data', data: { chunk: 'raw chunk must stay hidden' } },
        },
      }),
      { clock },
    );

    expect(outcome.kind).toBe('ENVELOPE');
    if (outcome.kind === 'ENVELOPE') {
      expect(outcome.envelope.payload.text).toBe('');
      expect(outcome.envelope.payload.content).toBe('');
      expect(outcome.envelope.payload.safeSummary).toBeUndefined();
      expect(outcome.envelope.payload.safeResult).toBeUndefined();
      expect(JSON.stringify(outcome.envelope.payload)).not.toContain('raw chunk must stay hidden');
      expect(Object.keys(outcome.envelope.payload)).not.toContain('result');
    }
  });

  it('does not infer stream text from data-only payloads without upstream safe fields', () => {
    const outcome = projectTimelineEventToStreamEnvelope(
      timelineEvent('CAPABILITY_RESULT_DELTA', {
        capabilityId: 'external-tool',
        toolCallId: 'tool-external-1',
        status: 'SUCCEEDED',
        result: {
          event: 'progress',
          data: { char: 'H', token: 'data-only must stay hidden' },
        },
      }),
      { clock },
    );

    expect(outcome.kind).toBe('ENVELOPE');
    if (outcome.kind === 'ENVELOPE') {
      expect(outcome.envelope.payload.text).toBe('');
      expect(outcome.envelope.payload.content).toBe('');
      expect(outcome.envelope.payload.safeSummary).toBeUndefined();
      expect(outcome.envelope.payload.safeResult).toBeUndefined();
      expect(JSON.stringify(outcome.envelope.payload)).not.toContain('data-only must stay hidden');
      expect(Object.keys(outcome.envelope.payload)).not.toContain('result');
    }
  });

  it('projects normalized CLIP subscribe Bash stdout as generic command output', () => {
    const firstDataRaw = JSON.stringify({ char: 'H', timestamp: '2026-07-07T11:17:54.860025100+01:00', index: 0 });
    const secondDataRaw = JSON.stringify({ char: 'e', timestamp: '2026-07-07T11:17:55.876547100+01:00', index: 1 });
    const stdout = `${firstDataRaw}\n${secondDataRaw}`;

    const outcome = projectTimelineEventToStreamEnvelope(
      timelineEvent('CAPABILITY_RESULT_DELTA', {
        capabilityId: 'bash',
        toolCallId: 'tool-bash-clip-1',
        status: 'SUCCEEDED',
        result: {
          exitCode: 0,
          stdout,
          stderr: '',
        },
      }),
      { clock },
    );

    expect(outcome.kind).toBe('ENVELOPE');
    if (outcome.kind === 'ENVELOPE') {
      expect(outcome.envelope.payload.text).toBe('');
      expect(outcome.envelope.payload.content).toBe(outcome.envelope.payload.text);
      expect(outcome.envelope.payload.safeSummary).toBeUndefined();
      expect(outcome.envelope.payload.safeResult).toBeUndefined();
      const serialized = JSON.stringify(outcome.envelope.payload);
      expect(serialized).not.toContain('clip.subscribe.event');
      expect(serialized).not.toContain('trace-should-stay-private');
      expect(serialized).not.toContain('/api/hello/stream');
      expect(Object.keys(outcome.envelope.payload)).not.toContain('result');
    }
  });

  it('does not synthesize generic capability result text for unknown result shapes', () => {
    const outcome = projectTimelineEventToStreamEnvelope(
      timelineEvent('CAPABILITY_RESULT_DELTA', {
        capabilityId: 'unknown',
        toolCallId: 'tool-unknown-1',
        safeSummary: 'Capability result is available.',
        result: {
          arbitrary: 'raw result must stay hidden',
          data: { token: 'data-token-leak' },
          nested: { token: 'token-leak' },
        },
      }),
      { clock },
    );

    expect(outcome.kind).toBe('ENVELOPE');
    if (outcome.kind === 'ENVELOPE') {
      expect(outcome.envelope.payload.text).toBe('');
      expect(outcome.envelope.payload.content).toBe('');
      expect(outcome.envelope.payload.safeSummary).toBeUndefined();
      expect(outcome.envelope.payload.safeResult).toBeUndefined();
      const serialized = JSON.stringify(outcome.envelope.payload);
      expect(serialized).not.toContain('Capability result is available.');
      expect(serialized).not.toContain('raw result must stay hidden');
      expect(serialized).not.toContain('data-token-leak');
      expect(serialized).not.toContain('token-leak');
      expect(Object.keys(outcome.envelope.payload)).not.toContain('result');
    }
  });

  it('does not synthesize completed events from empty output, disconnect or non-terminal timeline events', async () => {
    expect(await collect(projectTimelineEventsToStreamEnvelopes(events(), { clock }))).toEqual([]);

    const projectedEvents = await collect(
      projectTimelineEventsToStreamEnvelopes(events(timelineEvent('LLM_CONTENT_DELTA', { content: 'still streaming' })), { clock }),
    );
    expect(projectedEvents).toHaveLength(1);
    const projected = projectedEvents[0]!;
    expect(projected.eventType).toBe('LLM_CONTENT_DELTA');
    expect(projected.eventType).not.toBe('REQUEST_COMPLETED');
  });

  it('keeps the Web main path on canonical accepted, progress and terminal events', async () => {
    const app = createNextAgentTestApp({
      workspaceDir: process.cwd(),
      modelSteps: [{ content: 'status visible answer' }],
    });
    const accepted = await app.server.inject({
      method: 'POST',
      url: '/api/v1/requests',
      payload: { inputText: 'status visibility', idempotencyKey: 'idem-status-visibility' },
    });
    const body = accepted.json<{ sessionId: string; runId: string }>();

    const sessionList = await app.server.inject({ method: 'GET', url: '/api/v1/sessions' });
    expect(sessionList.json()).toMatchObject({
      entries: [
        {
          lastRunStatus: 'EXECUTING',
          hasInFlightRequest: true,
        },
      ],
    });

    const stream = await app.server.inject({
      method: 'GET',
      url: `/api/v1/sessions/${body.sessionId}/stream?lastSeenSequence=0&runId=${body.runId}`,
    });
    expect(stream.body).toContain('event: REQUEST_ACCEPTED');
    expect(stream.body).toContain('event: LLM_CONTENT_DELTA');
    expect(stream.body).toContain('event: REQUEST_COMPLETED');
    expect(stream.body).toContain('"hookResults"');
    expect(stream.body).not.toContain('STREAM_STARTED');
    expect(stream.body).not.toContain('event: CONTENT_DELTA');
  });

  it('keeps projection in the Web channel boundary without owning runtime lifecycle or private state', async () => {
    const routesSource = await readFile('packages/agent-channel-web/src/routes/requests.ts', 'utf8');
    expect(routesSource).not.toContain('function projectStreamEvents');
    expect(routesSource).not.toContain('function projectStreamPayload');

    const projectionSource = await readFile('packages/agent-channel-web/src/projections/stream-envelope.ts', 'utf8');
    expect(projectionSource).not.toContain('@nextagent/agent-runtime');
    expect(projectionSource).not.toContain('RequestRunStore');
    expect(projectionSource).not.toContain('saveTimeline');
  });
});

function timelineEvent(type: TimelineEventType, inlinePayload: JsonObject = {}): RunTimelineEvent {
  return {
    eventId: `timeline-${type}`,
    sessionId,
    requestId,
    runId,
    requestContextId,
    sequence: brand<number, 'TimelineSequence'>(7),
    type,
    inlinePayload,
    createdAt,
    ...(type === 'LLM_THINKING_DELTA' ? { persistence: 'LIVE_ONLY' as const } : {}),
  };
}

function payloadFor(type: StreamEventType): JsonObject {
  if (type === 'LLM_THINKING_DELTA') {
    return { reasoning: 'thinking', stepId: 'model:1' };
  }
  if (type === 'LLM_CONTENT_DELTA') {
    return { content: 'answer', contentType: 'MARKDOWN', role: 'ASSISTANT' };
  }
  if (type === 'CAPABILITY_RESULT_DELTA') {
    return { capabilityId: 'Read', toolCallId: 'tool-1', safeSummary: 'Capability result is available.', result: { text: 'capability result' } };
  }
  if (type === 'CAPABILITY_STARTED' || type === 'CAPABILITY_COMPLETED') {
    return { capabilityId: 'Read', toolCallId: 'tool-1', status: 'SUCCEEDED' };
  }
  if (type === 'DEGRADATION_NOTICE') {
    return { code: 'MODEL_PROVIDER_ERROR', message: 'Request failed safely', category: 'UNAVAILABLE', retryable: false };
  }
  if (type === 'USER_INPUT_REQUIRED') {
    return { pendingInputId: 'pending-1', kind: 'CONFIRMATION', questions: [], status: 'PENDING' };
  }
  if (type === 'USER_INPUT_RECEIVED' || type === 'USER_INPUT_TIMEOUT' || type === 'USER_INPUT_CANCELED') {
    return { pendingInputId: 'pending-1', kind: 'CONFIRMATION', status: 'RECEIVED' };
  }
  if (type === 'ATTACHMENT_ACCEPTED' || type === 'ATTACHMENT_REJECTED') {
    return { attachmentId: 'attachment-1', status: 'ACCEPTED' };
  }
  if (type === 'CONTEXT_COMPACTED') {
    return { contextVersion: 2, safeSummary: 'compacted' };
  }
  if (type === 'REQUEST_COMPLETED' || type === 'REQUEST_FAILED' || type === 'REQUEST_CANCELED' || type === 'REQUEST_SUPERSEDED') {
    return { content: 'done', hookResults: [] };
  }
  return { attempt: 1, status: 'QUEUED', content: 'done' };
}

async function collect<T>(items: AsyncIterable<T>): Promise<T[]> {
  const collected: T[] = [];
  for await (const item of items) {
    collected.push(item);
  }
  return collected;
}

async function* events(...items: RunTimelineEvent[]): AsyncIterable<RunTimelineEvent> {
  for (const item of items) {
    yield item;
  }
}

function clock(): EpochMillis {
  return brand<number, 'EpochMillis'>(2_000);
}
