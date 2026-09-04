import { describe, expect, it } from 'vitest';
import i18n from '../src/i18n/index.ts';
import { conversationMessagesToHistoryEnvelopes } from '../src/features/chat/adapters/conversationAdapter.ts';
import { buildAnswerContent } from '../src/features/chat/presentation/answerContent.ts';
import {
  buildProcessDisplayEntries,
  buildProcessEntries,
  buildProcessTimelineEntries,
  buildProcessSummary,
  resolveExecutionDetailsPhase,
  resolveActiveProcessEntryKey,
  isProcessEntryVisuallySuperseded,
  type ProcessDisplayEntry,
  type ProcessEntry,
} from '../src/features/chat/process/processDetails.ts';
import type { SessionConversationMessage, StreamEnvelope, StreamEventType } from '../src/state/contracts.ts';

const presentationResources = new Map([
  [
    'TOOL:Read',
    {
      capabilityKind: 'TOOL' as const,
      capabilityId: 'Read',
      displayName: 'Read file',
      locales: { language: { 'zh-CN': { displayName: '读取文件' } } },
    },
  ],
  [
    'SKILL:network-diagnosis',
    {
      capabilityKind: 'SKILL' as const,
      capabilityId: 'network-diagnosis',
      displayName: 'Network diagnosis',
      locales: { language: { 'zh-CN': { displayName: '网络诊断' } } },
    },
  ],
]);

function event(eventType: StreamEventType, sequence: number, payload: Record<string, unknown>): StreamEnvelope {
  return {
    eventId: `event-${sequence}`,
    sequence,
    sessionId: 'session-1',
    requestId: 'request-1',
    eventType,
    payload,
    createdAt: `2026-06-02T00:00:${String(sequence).padStart(2, '0')}.000Z`,
    transportHints: [],
    timelineEventRef: null,
  } as StreamEnvelope;
}

describe('process details projection', () => {
  it('identifies only strictly later assistant output as visually superseding a process entry', () => {
    const entry = {
      key: 'thinking',
      title: '思考',
      toolName: null,
      summary: 'checking routes',
      detail: 'checking routes',
      contentType: 'PLAIN_TEXT',
      kind: 'thinking',
      isFinal: false,
      lastSequence: 2,
      lastPresentationOrder: 2,
      isExpandable: false,
    } satisfies ProcessDisplayEntry;

    expect(isProcessEntryVisuallySuperseded(entry, null)).toBe(false);
    expect(isProcessEntryVisuallySuperseded(entry, 2)).toBe(false);
    expect(isProcessEntryVisuallySuperseded(entry, 3)).toBe(true);
  });

  it('surfaces canonical in-flight run status in the process summary', () => {
    const phase = resolveExecutionDetailsPhase('QUEUED', []);
    const expectedSummary = i18n.t('turn.process.summary', { status: i18n.t('runTimeline.queued') });

    expect(phase).toBe('running');
    expect(buildProcessSummary('QUEUED', phase, i18n.t)).toBe(expectedSummary);
  });

  it('updates one AskUserQuestion process entry from waiting to answered', () => {
    const waiting = event('USER_INPUT_REQUIRED', 1, {
      pendingInputId: 'pending-1',
      kind: 'QUESTION',
      questions: [
        {
          prompt: '请选择站点',
          options: [{ label: '站点 A', value: 'site-a' }],
        },
      ],
    });
    const waitingEntries = buildProcessEntries([waiting], i18n.t);
    const answeredEntries = buildProcessEntries(
      [
        waiting,
        event('USER_INPUT_RECEIVED', 2, {
          pendingInputId: 'pending-1',
          kind: 'QUESTION',
          status: 'RECEIVED',
        }),
        event('CAPABILITY_RESULT_DELTA', 2, {
          capabilityId: 'AskUserQuestion',
          toolCallId: 'ask-user-1',
          pendingInputId: 'pending-1',
          kind: 'QUESTION',
          status: 'RECEIVED',
          safeResult: {
            kind: 'pendingInputAnswer',
            answers: [['site-a']],
            truncated: false,
          },
        }),
        event('CAPABILITY_COMPLETED', 3, {
          capabilityId: 'AskUserQuestion',
          toolCallId: 'ask-user-1',
          pendingInputId: 'pending-1',
          kind: 'QUESTION',
          status: 'SUCCEEDED',
          safeSummary: 'Pending input answer received.',
          safeResult: {
            kind: 'pendingInputAnswer',
            answers: [['site-a']],
            truncated: false,
          },
        }),
      ],
      i18n.t,
    );

    expect(waitingEntries).toHaveLength(1);
    expect(waitingEntries[0]?.title).toBe(i18n.t('turn.process.supplementalInputWaitingTitle'));
    expect(answeredEntries).toHaveLength(1);
    expect(answeredEntries[0]?.key).toBe(waitingEntries[0]?.key);
    expect(answeredEntries[0]?.title).toBe(i18n.t('turn.process.supplementalInputTitle'));
    expect(answeredEntries[0]?.detail).toContain('请选择站点');
    expect(answeredEntries[0]?.detail).toContain('站点 A');
    expect(answeredEntries[0]?.detail).not.toContain('site-a');
    expect(answeredEntries[0]?.title).not.toContain(i18n.t('turn.process.responded'));
    expect(answeredEntries.some((entry) => entry.toolName === 'AskUserQuestion')).toBe(false);
  });

  it('does not produce a generic tool row when CAPABILITY_STARTED precedes the AskUserQuestion lifecycle', () => {
    const started = event('CAPABILITY_STARTED', 1, {
      capabilityId: 'AskUserQuestion',
      capabilityKind: 'TOOL',
      toolCallId: 'ask-user-1',
      toolName: 'AskUserQuestion',
    });
    const waiting = event('USER_INPUT_REQUIRED', 2, {
      pendingInputId: 'pending-1',
      kind: 'QUESTION',
      questions: [
        {
          prompt: '请选择站点',
          options: [{ label: '站点 A', value: 'site-a' }],
        },
      ],
    });
    const answeredEntries = buildProcessEntries(
      [
        started,
        waiting,
        event('USER_INPUT_RECEIVED', 3, {
          pendingInputId: 'pending-1',
          kind: 'QUESTION',
          status: 'RECEIVED',
        }),
        event('CAPABILITY_RESULT_DELTA', 4, {
          capabilityId: 'AskUserQuestion',
          toolCallId: 'ask-user-1',
          pendingInputId: 'pending-1',
          kind: 'QUESTION',
          status: 'RECEIVED',
          safeResult: {
            kind: 'pendingInputAnswer',
            answers: [['site-a']],
            truncated: false,
          },
        }),
        event('CAPABILITY_COMPLETED', 5, {
          capabilityId: 'AskUserQuestion',
          capabilityKind: 'TOOL',
          toolCallId: 'ask-user-1',
          status: 'SUCCEEDED',
        }),
      ],
      i18n.t,
    );

    expect(answeredEntries.some((entry) => entry.toolName === 'AskUserQuestion')).toBe(false);
    expect(answeredEntries.some((entry) => entry.key === 'ask-user-1')).toBe(false);
    const supplemental = answeredEntries.find((entry) => entry.key.startsWith('pending-input:'));
    expect(supplemental).toBeDefined();
    expect(supplemental?.title).toBe(i18n.t('turn.process.supplementalInputTitle'));
  });

  it('shows option choices and input modes while AskUserQuestion is waiting', () => {
    const entries = buildProcessEntries(
      [
        event('USER_INPUT_REQUIRED', 1, {
          pendingInputId: 'pending-shapes',
          kind: 'QUESTION',
          questions: [
            {
              prompt: 'Select one site',
              options: [
                { label: 'Site A', value: 'site-a' },
                { label: 'Site B', value: 'site-b' },
              ],
              multiple: false,
              custom: false,
            },
            {
              prompt: 'Select affected services',
              options: [
                { label: 'Voice', value: 'voice' },
                { label: 'Data', value: 'data' },
              ],
              multiple: true,
              custom: true,
            },
            {
              prompt: 'Add context',
              options: [],
              custom: true,
            },
          ],
        }),
      ],
      i18n.t,
    );

    expect(entries).toHaveLength(1);
    expect(entries[0]?.title).toBe(i18n.t('turn.process.supplementalInputWaitingTitle'));
    expect(entries[0]?.detail).toContain('Site A / Site B');
    expect(entries[0]?.detail).toContain(i18n.t('turn.process.supplementalInputSingleSelect'));
    expect(entries[0]?.detail).toContain(i18n.t('turn.process.supplementalInputMultipleSelect'));
    expect(entries[0]?.detail.match(new RegExp(i18n.t('turn.process.supplementalInputCustomAllowed'), 'gu'))).toHaveLength(2);
  });

  it('restores an AskUserQuestion completion as the same supplemental input entry', () => {
    const entries = buildProcessEntries(
      [
        event('USER_INPUT_REQUIRED', 1, {
          pendingInputId: 'pending-history-1',
          kind: 'QUESTION',
          questions: [
            {
              prompt: '请选择区域',
              options: [{ label: '北区', value: 'north' }],
            },
          ],
        }),
        event('CAPABILITY_COMPLETED', 2, {
          capabilityId: 'AskUserQuestion',
          toolCallId: 'ask-user-history-1',
          pendingInputId: 'pending-history-1',
          kind: 'QUESTION',
          status: 'SUCCEEDED',
          safeSummary: 'Pending input answer received.',
          safeResult: {
            kind: 'pendingInputAnswer',
            answers: [['north']],
            truncated: false,
          },
        }),
      ],
      i18n.t,
    );

    expect(entries).toHaveLength(1);
    expect(entries[0]?.title).toBe(i18n.t('turn.process.supplementalInputTitle'));
    expect(entries[0]?.detail).toContain('请选择区域');
    expect(entries[0]?.detail).toContain('北区');
    expect(entries.some((entry) => entry.toolName === 'AskUserQuestion')).toBe(false);
  });

  it('pairs multiple AskUserQuestion answer shapes and discloses truncation in one entry', () => {
    const entries = buildProcessEntries(
      [
        event('USER_INPUT_REQUIRED', 1, {
          pendingInputId: 'pending-multi',
          kind: 'QUESTION',
          questions: [
            {
              prompt: '选择站点',
              options: [
                { label: '站点 A', value: 'site-a' },
                { label: '站点 B', value: 'site-b' },
              ],
              multiple: true,
            },
            {
              prompt: '补充说明',
              options: [],
              custom: true,
            },
          ],
        }),
        event('CAPABILITY_RESULT_DELTA', 2, {
          capabilityId: 'AskUserQuestion',
          toolCallId: 'ask-user-multi',
          pendingInputId: 'pending-multi',
          kind: 'QUESTION',
          status: 'RECEIVED',
          safeResult: {
            kind: 'pendingInputAnswer',
            answers: [['site-b', 'site-a'], ['自定义补充']],
            truncated: true,
          },
        }),
      ],
      i18n.t,
    );

    expect(entries).toHaveLength(1);
    expect(entries[0]?.title).toBe(i18n.t('turn.process.supplementalInputTitle'));
    expect(entries[0]?.detail).toContain('1.');
    expect(entries[0]?.detail).toContain('2.');
    const siteAnswerLine = entries[0]?.detail.split('\n').find((line) => line.startsWith(`${i18n.t('turn.process.supplementalInputAnswerLabel')}:`));
    expect(siteAnswerLine?.indexOf('站点 B')).toBeLessThan(siteAnswerLine?.indexOf('站点 A') ?? 0);
    expect(entries[0]?.detail).toContain('自定义补充');
    expect(entries[0]?.detail).toContain(i18n.t('turn.process.supplementalInputTruncated'));
  });

  it('keeps orphan answers and received-only fallbacks visible without generic tool rows', () => {
    const orphanEntries = buildProcessEntries(
      [
        event('CAPABILITY_RESULT_DELTA', 1, {
          capabilityId: 'AskUserQuestion',
          toolCallId: 'ask-user-orphan',
          pendingInputId: 'pending-orphan',
          kind: 'QUESTION',
          status: 'RECEIVED',
          safeResult: {
            kind: 'pendingInputAnswer',
            answers: [['orphan answer']],
            truncated: false,
          },
        }),
      ],
      i18n.t,
    );
    const receivedOnlyEntries = buildProcessEntries(
      [
        event('USER_INPUT_REQUIRED', 1, {
          pendingInputId: 'pending-received',
          kind: 'QUESTION',
          questions: [{ prompt: '补充信息', options: [] }],
        }),
        event('USER_INPUT_RECEIVED', 2, {
          pendingInputId: 'pending-received',
          kind: 'QUESTION',
          status: 'RECEIVED',
        }),
      ],
      i18n.t,
    );

    expect(orphanEntries).toHaveLength(1);
    expect(orphanEntries[0]?.title).toBe(i18n.t('turn.process.supplementalInputTitle'));
    expect(orphanEntries[0]?.detail).toContain(i18n.t('turn.process.supplementalInputQuestionUnavailable'));
    expect(orphanEntries[0]?.detail).toContain('orphan answer');
    expect(orphanEntries[0]?.toolName).toBeNull();
    expect(receivedOnlyEntries).toHaveLength(1);
    expect(receivedOnlyEntries[0]?.title).toBe(i18n.t('turn.process.supplementalInputTitle'));
    expect(receivedOnlyEntries[0]?.detail).toContain(i18n.t('turn.process.supplementalInputAnswerUnavailable'));
  });

  it('deduplicates live and history answers without joining different attempts', () => {
    const required = {
      ...event('USER_INPUT_REQUIRED', 1, {
        pendingInputId: 'pending-shared',
        kind: 'QUESTION',
        questions: [{ prompt: '当前尝试的问题', options: [] }],
      }),
      requestId: 'request-root',
      rootMessageId: 'request-root',
      requestContextId: 'context-live',
      runId: 'run-1',
    } as StreamEnvelope;
    const answerPayload = {
      capabilityId: 'AskUserQuestion',
      toolCallId: 'ask-user-shared',
      pendingInputId: 'pending-shared',
      kind: 'QUESTION',
      status: 'RECEIVED',
      safeResult: {
        kind: 'pendingInputAnswer' as const,
        answers: [['same answer']],
        truncated: false,
      },
    };
    const liveAnswer = {
      ...event('CAPABILITY_RESULT_DELTA', 2, answerPayload),
      requestId: 'request-root',
      rootMessageId: 'request-root',
      requestContextId: 'context-live',
      runId: 'run-1',
    } as StreamEnvelope;
    const [historyAnswer] = conversationMessagesToHistoryEnvelopes([
      {
        messageId: 'history-answer',
        sessionId: 'session-1',
        requestId: 'request-root',
        runId: 'run-1',
        role: 'CAPABILITY_RESULT',
        content: JSON.stringify({
          toolCallId: 'ask-user-shared',
          toolName: 'AskUserQuestion',
          payload: { answers: [['RAW_ANSWER_MUST_NOT_BE_READ']] },
        }),
        contentType: 'PLAIN_TEXT',
        metadata: {
          kind: 'CAPABILITY_RESULT',
          toolCallId: 'ask-user-shared',
          toolName: 'AskUserQuestion',
        },
        pendingInputAnswer: {
          capabilityId: 'AskUserQuestion',
          toolCallId: 'ask-user-shared',
          pendingInputId: 'pending-shared',
          kind: 'QUESTION',
          status: 'RECEIVED',
          safeSummary: 'Pending input answer received.',
          safeResult: answerPayload.safeResult,
        },
        sequence: 2,
        visible: true,
        createdAt: '2026-06-02T00:00:02.000Z',
      } satisfies SessionConversationMessage,
    ]);
    const otherAttemptAnswer = {
      ...event('CAPABILITY_RESULT_DELTA', 1, {
        ...answerPayload,
        safeResult: {
          kind: 'pendingInputAnswer',
          answers: [['other attempt answer']],
          truncated: false,
        },
      }),
      eventId: 'other-attempt-answer',
      requestId: 'request-root',
      rootMessageId: 'request-root',
      requestContextId: 'context-other',
      runId: 'run-2',
    } as StreamEnvelope;

    const entries = buildProcessEntries([required, liveAnswer, historyAnswer as StreamEnvelope, otherAttemptAnswer], i18n.t);

    expect(entries).toHaveLength(2);
    expect(entries.filter((entry) => entry.detail.includes('same answer'))).toHaveLength(1);
    expect(entries.filter((entry) => entry.detail.includes('other attempt answer'))).toHaveLength(1);
    expect(JSON.stringify(entries)).not.toContain('RAW_ANSWER_MUST_NOT_BE_READ');
    expect(entries.find((entry) => entry.detail.includes('other attempt answer'))?.detail).toContain(
      i18n.t('turn.process.supplementalInputQuestionUnavailable'),
    );
  });

  it('merges thinking token deltas into a single process entry', () => {
    const entries = buildProcessEntries(
      [
        event('LLM_THINKING_DELTA', 1, { delta: 'this', accumulated: false }),
        event('LLM_THINKING_DELTA', 2, { delta: ' is', accumulated: false }),
        event('LLM_THINKING_DELTA', 3, { delta: ' reasoning', accumulated: false }),
      ],
      i18n.t,
    );

    expect(entries).toHaveLength(1);
    expect(entries[0]?.rawDetail).toBe('this is reasoning');
    expect(resolveActiveProcessEntryKey(buildProcessDisplayEntries(entries, i18n.t))).toBe(entries[0]?.key);
  });

  it('keeps presentation positions distinct when unrelated process events reuse a sequence', () => {
    const entries = buildProcessEntries(
      [
        {
          ...event('LLM_THINKING_DELTA', 10, {
            content: 'checking routes',
            metadata: { accumulated: true },
          }),
          eventId: 'thinking-event',
          createdAt: '2026-06-02T00:00:00.000Z',
        },
        {
          ...event('LLM_CONTENT_DELTA', 1, { content: 'public answer' }),
          eventId: 'answer-event',
          createdAt: '2026-06-02T00:00:01.000Z',
        },
        {
          ...event('CAPABILITY_STARTED', 10, {
            capabilityId: 'routerAudit',
            toolCallId: 'router-audit',
            toolName: 'routerAudit',
            content: 'starting audit',
          }),
          eventId: 'tool-event',
          createdAt: '2026-06-02T00:00:02.000Z',
        },
      ],
      i18n.t,
    );

    expect(entries.find((entry) => entry.kind === 'thinking')?.lastPresentationOrder).toBe(0);
    expect(entries.find((entry) => entry.kind === 'tool')?.lastPresentationOrder).toBe(2);
  });

  it('settles a consecutive thinking entry with the final envelope and keeps later segments separate', () => {
    const entries = buildProcessEntries(
      [
        event('LLM_THINKING_DELTA', 1, { content: 'checking', runId: 'run-1', stepId: 'model:1', metadata: { accumulated: true } }),
        event('LLM_THINKING_DELTA', 2, {
          content: 'checking routes',
          runId: 'run-1',
          stepId: 'model:1',
          metadata: { accumulated: true, completed: true },
        }),
        event('LLM_CONTENT_DELTA', 3, { content: 'answer' }),
        event('LLM_THINKING_DELTA', 4, { content: 'later segment', runId: 'run-1', stepId: 'model:1', metadata: { accumulated: true } }),
      ],
      i18n.t,
    ).filter((entry) => entry.kind === 'thinking');

    expect(entries).toHaveLength(2);
    expect(entries[0]).toMatchObject({
      key: 'thinking:request-1:request-1:segment:1',
      rawDetail: 'checking routes',
      isFinal: true,
      lastSequence: 2,
    });
    expect(entries[1]).toMatchObject({
      key: 'thinking:request-1:request-1:segment:2',
      rawDetail: 'later segment',
      isFinal: false,
      lastSequence: 4,
    });
  });

  it('settles the current thinking entry when its completed snapshot follows answer deltas', () => {
    const entries = buildProcessEntries(
      [
        event('LLM_THINKING_DELTA', 1, {
          content: 'checking AMF registration',
          runId: 'run-1',
          stepId: 'turn-1',
          metadata: { accumulated: true },
        }),
        event('LLM_CONTENT_DELTA', 2, { content: 'AMF is' }),
        event('LLM_CONTENT_DELTA', 3, { content: 'AMF is a 5G core network function' }),
        event('LLM_THINKING_DELTA', 4, {
          content: 'checking AMF registration and mobility responsibilities',
          runId: 'run-1',
          stepId: 'turn-1',
          metadata: { accumulated: true, completed: true },
        }),
      ],
      i18n.t,
    ).filter((entry) => entry.kind === 'thinking');

    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      key: 'thinking:request-1:request-1:segment:1',
      rawDetail: 'checking AMF registration and mobility responsibilities',
      isFinal: true,
      lastSequence: 4,
    });
  });

  it('projects the same completed thinking snapshot from live and history without inferring completion at another boundary', () => {
    const completedThinking = event('LLM_THINKING_DELTA', 2, {
      content: 'checking router policy',
      runId: 'run-1',
      stepId: 'model:1',
      metadata: { accumulated: true, completed: true },
    });
    const liveEntries = buildProcessEntries([completedThinking], i18n.t);
    const historyEntries = buildProcessEntries([{ ...completedThinking, transportHints: ['history-load'] }], i18n.t);
    const boundaryEntries = buildProcessEntries(
      [
        event('LLM_THINKING_DELTA', 1, {
          content: 'checking router policy',
          runId: 'run-1',
          stepId: 'model:1',
          metadata: { accumulated: true },
        }),
        event('HOOK_DEGRADED', 2, { code: 'HOOK_TIMEOUT' }),
      ],
      i18n.t,
    ).filter((entry) => entry.kind === 'thinking');

    expect(historyEntries).toEqual(liveEntries);
    expect(liveEntries[0]).toMatchObject({ rawDetail: 'checking router policy', isFinal: true });
    expect(boundaryEntries[0]).toMatchObject({ rawDetail: 'checking router policy', isFinal: false });
  });

  it.each([
    ['DEGRADATION_NOTICE', 'warning'],
    ['CONTEXT_COMPACTED', 'info'],
  ] as const)('projects durable %s business semantics identically from live and history', (eventType, severity) => {
    const liveEvent = event(eventType, 1, {
      code: 'MODEL_FALLBACK',
      message: 'RAW_EVENT_TEXT_MUST_NOT_BE_VISIBLE',
    });
    const historyEvent = { ...liveEvent, transportHints: ['history-load'] } satisfies StreamEnvelope;
    const liveProcess = buildProcessEntries([liveEvent], i18n.getFixedT('en-US'));
    const historyProcess = buildProcessEntries([historyEvent], i18n.getFixedT('en-US'));
    const liveTimeline = buildProcessTimelineEntries([liveEvent], i18n.getFixedT('en-US'));
    const historyTimeline = buildProcessTimelineEntries([historyEvent], i18n.getFixedT('en-US'));

    expect(historyProcess).toEqual(liveProcess);
    expect(historyTimeline).toEqual(liveTimeline);
    expect(liveProcess[0]).toMatchObject({ severity });
    expect(JSON.stringify({ liveProcess, liveTimeline })).not.toContain('RAW_EVENT_TEXT_MUST_NOT_BE_VISIBLE');
  });

  it('projects compatibility-only HOOK_DEGRADED as a live warning without exposing payload text', () => {
    const entries = buildProcessEntries(
      [event('HOOK_DEGRADED', 1, { code: 'HOOK_TIMEOUT', message: 'RAW_EVENT_TEXT_MUST_NOT_BE_VISIBLE' })],
      i18n.getFixedT('en-US'),
    );

    expect(entries[0]).toMatchObject({ severity: 'warning' });
    expect(JSON.stringify(entries)).not.toContain('RAW_EVENT_TEXT_MUST_NOT_BE_VISIBLE');
  });

  it('projects the same status-only generic capability lifecycle from live and history', () => {
    const capabilityProcess = [
      event('CAPABILITY_STARTED', 1, {
        capabilityId: 'routerAudit',
        toolCallId: 'tool-router-audit',
        toolName: 'routerAudit',
      }),
      event('CAPABILITY_RESULT_DELTA', 2, {
        capabilityId: 'routerAudit',
        toolCallId: 'tool-router-audit',
        toolName: 'routerAudit',
        role: 'CAPABILITY_RESULT',
        content: 'Router audit result: policy is compliant.',
        contentType: 'PLAIN_TEXT',
      }),
      event('CAPABILITY_COMPLETED', 3, {
        capabilityId: 'routerAudit',
        toolCallId: 'tool-router-audit',
        toolName: 'routerAudit',
        status: 'SUCCEEDED',
      }),
    ];
    const liveEntries = buildProcessEntries(capabilityProcess, i18n.t);
    const historyEntries = buildProcessEntries(
      capabilityProcess.map((envelope) => ({ ...envelope, transportHints: ['history-load'] })),
      i18n.t,
    );

    expect(historyEntries).toEqual(liveEntries);
    expect(liveEntries).toHaveLength(1);
    expect(liveEntries[0]).toMatchObject({
      kind: 'tool',
      rawDetail: '',
      detail: '',
      isExpandable: false,
      isFinal: true,
    });
  });

  it('moves a completed tool-round explanation into one process entry and keeps it out of the final answer', () => {
    const liveExplanation = event('LLM_CONTENT_DELTA', 1, {
      content: 'I will inspect',
      stepId: 'turn-1',
      metadata: { accumulated: true },
    });
    const completedExplanation = event('LLM_CONTENT_DELTA', 2, {
      content: 'I will inspect the network evidence.',
      stepId: 'turn-1',
      completed: true,
      metadata: { accumulated: true, completed: true },
    });
    const finalAnswer = event('LLM_CONTENT_DELTA', 3, {
      content: 'The backbone link is healthy.',
      stepId: 'turn-2',
      final: true,
      metadata: { accumulated: true },
    });

    const entries = buildProcessEntries([liveExplanation, completedExplanation, finalAnswer], i18n.t);

    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      key: 'process-content:request-1:request-1:turn-1',
      title: i18n.t('turn.process.executionNote'),
      detail: 'I will inspect the network evidence.',
      kind: 'process-explanation',
      isFinal: true,
      isExpandable: false,
    });
    expect(buildAnswerContent([completedExplanation, finalAnswer])).toBe('The backbone link is healthy.');
  });

  it('keeps process explanations with the same step id separate across accepted user input', () => {
    const entries = buildProcessEntries(
      [
        event('LLM_CONTENT_DELTA', 1, {
          content: '正在调用意图识别工具',
          stepId: 'turn-2',
          completed: true,
          metadata: { accumulated: true, completed: true },
        }),
        event('USER_INPUT_RECEIVED', 2, { pendingInputId: 'pending-1' }),
        event('LLM_CONTENT_DELTA', 3, {
          content: '已获取补充信息，调用数据查询工具中',
          stepId: 'turn-2',
          completed: true,
          metadata: { accumulated: true, completed: true },
        }),
      ],
      i18n.t,
    ).filter((entry) => entry.kind === 'process-explanation');

    expect(entries).toHaveLength(2);
    expect(entries.map((entry) => entry.rawDetail)).toEqual(['正在调用意图识别工具', '已获取补充信息，调用数据查询工具中']);
    expect(entries.map((entry) => entry.sequence)).toEqual([1, 3]);
  });

  it('does not merge equal process explanation text across accepted user input', () => {
    const entries = buildProcessEntries(
      [
        event('LLM_CONTENT_DELTA', 1, {
          content: '正在查询网络数据',
          stepId: 'turn-2',
          completed: true,
          metadata: { accumulated: true, completed: true },
        }),
        event('USER_INPUT_RECEIVED', 2, { pendingInputId: 'pending-1' }),
        event('LLM_CONTENT_DELTA', 3, {
          content: '正在查询网络数据',
          stepId: 'turn-2',
          completed: true,
          metadata: { accumulated: true, completed: true },
        }),
      ],
      i18n.t,
    ).filter((entry) => entry.kind === 'process-explanation');

    expect(entries.map((entry) => [entry.rawDetail, entry.sequence])).toEqual([
      ['正在查询网络数据', 1],
      ['正在查询网络数据', 3],
    ]);
  });

  it('keeps in-flight assistant text in one pending process explanation until its role is known', () => {
    const liveExplanation = event('LLM_CONTENT_DELTA', 2, {
      content: 'I will inspect the network evidence.',
      stepId: 'turn-1',
      metadata: { accumulated: true },
    });

    const entries = buildProcessEntries(
      [
        event('LLM_THINKING_DELTA', 1, {
          content: 'Checking available evidence.',
          stepId: 'turn-1',
          completed: true,
          metadata: { accumulated: true, completed: true },
        }),
        liveExplanation,
      ],
      i18n.t,
    );

    expect(entries).toHaveLength(2);
    expect(entries[1]).toMatchObject({
      key: 'process-content:request-1:request-1:turn-1',
      detail: 'I will inspect the network evidence.',
      kind: 'process-explanation',
      isFinal: false,
      isExpandable: false,
    });
    expect(buildAnswerContent([liveExplanation])).toBe('');
  });

  it('lets the final answer replace an unresolved process explanation without leaving a process copy', () => {
    const liveAnswer = event('LLM_CONTENT_DELTA', 1, {
      content: 'The backbone link',
      stepId: 'turn-1',
      metadata: { accumulated: true },
    });
    const finalAnswer = event('LLM_CONTENT_DELTA', 2, {
      content: 'The backbone link is healthy.',
      final: true,
      metadata: { accumulated: true },
    });

    expect(buildProcessEntries([liveAnswer, finalAnswer], i18n.t)).toEqual([]);
    expect(buildAnswerContent([liveAnswer, finalAnswer])).toBe('The backbone link is healthy.');
  });

  it('lets a referenced capability completion replace its live result snapshot', () => {
    const entries = buildProcessEntries(
      [
        event('CAPABILITY_STARTED', 1, {
          capabilityId: 'routerAudit',
          toolCallId: 'tool-router-audit',
        }),
        event('CAPABILITY_RESULT_DELTA', 2, {
          capabilityId: 'routerAudit',
          toolCallId: 'tool-router-audit',
          content: 'provisional live result',
        }),
        event('CAPABILITY_COMPLETED', 3, {
          capabilityId: 'routerAudit',
          toolCallId: 'tool-router-audit',
          status: 'SUCCEEDED',
          content: 'canonical safe result',
        }),
      ],
      i18n.t,
    );

    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      kind: 'tool',
      rawDetail: 'canonical safe result',
      isFinal: true,
    });
    expect(entries[0]?.detail).not.toContain('provisional live result');
  });

  it.each([
    ['Skill', 'network-diagnostics', '加载技能：network-diagnostics'],
    ['Agent', 'network-explorer', '调用子智能体：network-explorer'],
    ['ApiCall', undefined, 'ApiCall'],
  ])('displays the business title or technical fallback for %s', (capabilityId, targetCapabilityId, expectedName) => {
    const entries = buildProcessEntries(
      [
        event('CAPABILITY_STARTED', 1, {
          capabilityId,
          capabilityKind: 'TOOL',
          targetCapabilityId,
          toolCallId: `tool-${capabilityId}`,
        }),
      ],
      i18n.t,
    );

    expect(entries[0]?.title).toBe(`${expectedName} · ${i18n.t('turn.process.running')}`);
  });

  it('uses the same Agent target title when started and completed repeat the public identity', () => {
    const entries = buildProcessEntries(
      [
        event('CAPABILITY_STARTED', 1, {
          capabilityId: 'Agent',
          capabilityKind: 'TOOL',
          targetCapabilityId: 'network-explorer',
          toolCallId: 'tool-agent',
        }),
        event('CAPABILITY_COMPLETED', 2, {
          capabilityKind: 'TOOL',
          capabilityId: 'Agent',
          targetCapabilityId: 'network-explorer',
          toolCallId: 'tool-agent',
          status: 'SUCCEEDED',
          resultPresentationLevel: 'STATUS_ONLY',
        }),
      ],
      i18n.t,
    );

    expect(entries).toHaveLength(1);
    expect(entries[0]?.title).toBe(`调用子智能体：network-explorer · ${i18n.t('turn.process.completed')}`);
  });

  it('falls back to the wrapper title for completion-only and unsafe target names', () => {
    const completionOnly = buildProcessEntries(
      [
        event('CAPABILITY_COMPLETED', 1, {
          capabilityKind: 'TOOL',
          capabilityId: 'Agent',
          toolCallId: 'tool-agent-completion-only',
          status: 'SUCCEEDED',
          resultPresentationLevel: 'STATUS_ONLY',
        }),
      ],
      i18n.t,
    );
    const unsafeTarget = buildProcessEntries(
      [
        event('CAPABILITY_STARTED', 1, {
          capabilityId: 'Skill',
          capabilityKind: 'TOOL',
          targetCapabilityId: 'private\u0000skill',
          toolCallId: 'tool-unsafe-skill',
        }),
      ],
      i18n.t,
    );

    expect(completionOnly[0]?.title).toBe(`调用子智能体 · ${i18n.t('turn.process.completed')}`);
    expect(unsafeTarget[0]?.title).toBe(`加载技能 · ${i18n.t('turn.process.running')}`);
    expect(JSON.stringify(unsafeTarget)).not.toContain('private\u0000skill');
  });

  it('does not let an ordinary Tool display a spoofed technical target name', () => {
    const entries = buildProcessEntries(
      [
        event('CAPABILITY_STARTED', 1, {
          capabilityKind: 'TOOL',
          capabilityId: 'Read',
          targetCapabilityId: 'spoofed-skill-name',
          toolCallId: 'tool-read',
        }),
      ],
      i18n.t,
      presentationResources,
      'zh-CN',
    );

    expect(entries[0]?.title).toBe(`读取文件 · ${i18n.t('turn.process.running')}`);
    expect(JSON.stringify(entries)).not.toContain('spoofed-skill-name');
  });

  it('uses the same business target title in the full process timeline projection', () => {
    const entries = buildProcessTimelineEntries(
      [
        event('CAPABILITY_STARTED', 1, {
          capabilityKind: 'TOOL',
          capabilityId: 'Skill',
          targetCapabilityId: 'network-diagnosis',
          toolCallId: 'tool-skill',
        }),
      ],
      i18n.t,
      presentationResources,
      'zh-CN',
    );

    expect(entries[0]?.title).toBe('加载技能：网络诊断');
  });

  it('shows directed and nested Skill loads as the same kind of process step', () => {
    const entries = buildProcessEntries(
      [
        event('CAPABILITY_STARTED', 1, {
          capabilityKind: 'TOOL',
          capabilityId: 'Skill',
          targetCapabilityId: 'alarm-diagnosis',
          toolCallId: 'directed-skill:alarm-diagnosis',
          stepId: 'turn-1',
        }),
        event('CAPABILITY_COMPLETED', 2, {
          capabilityKind: 'TOOL',
          capabilityId: 'Skill',
          targetCapabilityId: 'alarm-diagnosis',
          toolCallId: 'directed-skill:alarm-diagnosis',
          status: 'SUCCEEDED',
          resultPresentationLevel: 'STATUS_ONLY',
        }),
        event('CAPABILITY_STARTED', 3, {
          capabilityKind: 'TOOL',
          capabilityId: 'Skill',
          targetCapabilityId: 'network-diagnostics',
          toolCallId: 'tool-skill-nested',
          stepId: 'turn-1',
        }),
        event('CAPABILITY_COMPLETED', 4, {
          capabilityKind: 'TOOL',
          capabilityId: 'Skill',
          targetCapabilityId: 'network-diagnostics',
          toolCallId: 'tool-skill-nested',
          status: 'SUCCEEDED',
          resultPresentationLevel: 'STATUS_ONLY',
        }),
      ],
      i18n.t,
    );

    expect(entries.map((entry) => entry.title)).toEqual([
      `加载技能：alarm-diagnosis · ${i18n.t('turn.process.completed')}`,
      `加载技能：network-diagnostics · ${i18n.t('turn.process.completed')}`,
    ]);
  });

  it('does not synthesize a directed Skill step from routing metadata or policy evidence', () => {
    const entries = buildProcessEntries(
      [
        event('REQUEST_ACCEPTED', 1, {
          content: '诊断核心网告警',
          metadata: { targetSkill: 'alarm-diagnosis' },
        }),
      ],
      i18n.t,
    );

    expect(entries).toEqual([]);
    expect(JSON.stringify(entries)).not.toContain('加载技能');
    expect(JSON.stringify(entries)).not.toContain('alarm-diagnosis');
  });

  it('does not restore live tool output when the referenced completion is unavailable', () => {
    const entries = buildProcessEntries(
      [
        event('CAPABILITY_STARTED', 1, {
          capabilityId: 'routerAudit',
          toolCallId: 'tool-router-audit',
        }),
        event('CAPABILITY_RESULT_DELTA', 2, {
          capabilityId: 'routerAudit',
          toolCallId: 'tool-router-audit',
          content: 'live result must not become canonical',
        }),
        event('CAPABILITY_COMPLETED', 3, {
          capabilityId: 'routerAudit',
          toolCallId: 'tool-router-audit',
          status: 'SUCCEEDED',
          contentUnavailable: true,
        }),
      ],
      i18n.t,
    );

    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      kind: 'tool',
      detail: '',
      isFinal: true,
    });
    expect(JSON.stringify(entries)).not.toContain('live result must not become canonical');
  });

  it('replaces live structured tool detail with the referenced completion for the same tool call', () => {
    const entries = buildProcessEntries(
      [
        event('CAPABILITY_STARTED', 1, {
          capabilityId: 'routerAudit',
          toolCallId: 'tool-router-audit',
        }),
        event('TOOL_STRUCTURED_DELTA', 2, {
          capabilityId: 'routerAudit',
          toolCallId: 'tool-router-audit',
          toolEventType: 'TITLE',
          toolMessageType: 'TEXT',
          content: 'Live network diagnostics',
        }),
        event('TOOL_STRUCTURED_DELTA', 3, {
          capabilityId: 'routerAudit',
          toolCallId: 'tool-router-audit',
          toolEventType: 'DETAIL',
          toolMessageType: 'TEXT',
          content: 'live structured result must be replaced',
        }),
        event('CAPABILITY_COMPLETED', 4, {
          capabilityId: 'routerAudit',
          toolCallId: 'tool-router-audit',
          status: 'SUCCEEDED',
          content: 'canonical safe result',
        }),
      ],
      i18n.t,
    );

    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      kind: 'tool',
      rawDetail: 'canonical safe result',
      isFinal: true,
    });
    expect(JSON.stringify(entries)).not.toContain('live structured result must be replaced');
  });

  it('preserves message-derived PIU detail when the completion has no canonical safe body', () => {
    const entries = buildProcessEntries(
      [
        event('CAPABILITY_STARTED', 1, {
          capabilityId: 'routerAudit',
          toolCallId: 'tool-router-piu',
        }),
        event('TOOL_STRUCTURED_DELTA', 2, {
          messageId: 'capability-result-piu',
          capabilityId: 'routerAudit',
          toolCallId: 'tool-router-piu',
          toolEventType: 'TITLE',
          toolMessageType: 'TEXT',
          content: 'Router audit',
        }),
        event('TOOL_STRUCTURED_DELTA', 3, {
          messageId: 'capability-result-piu',
          capabilityId: 'routerAudit',
          toolCallId: 'tool-router-piu',
          toolEventType: 'EXPAND_PANEL',
          toolMessageType: 'PIU',
          content: { component: 'router-audit', status: 'healthy' },
        }),
        event('CAPABILITY_COMPLETED', 4, {
          capabilityId: 'routerAudit',
          toolCallId: 'tool-router-piu',
          status: 'SUCCEEDED',
          content: '',
          text: '',
        }),
      ],
      i18n.t,
    );

    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      title: 'Router audit',
      hasExpandPanel: true,
      expandPanelData: {
        toolMessageType: 'PIU',
        content: { component: 'router-audit', status: 'healthy' },
      },
    });
  });

  it('preserves message-derived PIU detail when completion text is lifecycle-only', () => {
    const entries = buildProcessEntries(
      [
        event('CAPABILITY_STARTED', 1, {
          capabilityId: 'routerAudit',
          toolCallId: 'tool-router-piu-status',
        }),
        event('TOOL_STRUCTURED_DELTA', 2, {
          capabilityId: 'routerAudit',
          toolCallId: 'tool-router-piu-status',
          toolEventType: 'TITLE',
          toolMessageType: 'TEXT',
          content: 'Router audit',
        }),
        event('TOOL_STRUCTURED_DELTA', 3, {
          capabilityId: 'routerAudit',
          toolCallId: 'tool-router-piu-status',
          toolEventType: 'DETAIL',
          toolMessageType: 'PIU',
          content: { component: 'router-audit', status: 'healthy' },
        }),
        event('CAPABILITY_COMPLETED', 4, {
          capabilityId: 'routerAudit',
          toolCallId: 'tool-router-piu-status',
          toolName: 'routerAudit',
          status: 'SUCCEEDED',
          text: 'routerAudit completed',
        }),
      ],
      i18n.t,
    );

    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      title: 'Router audit',
      structuredSegments: [
        {
          kind: 'structured',
          toolMessageType: 'PIU',
          content: { component: 'router-audit', status: 'healthy' },
        },
      ],
    });
  });

  it('keeps the final answer message-derived while event history contributes only process detail', () => {
    const messages: SessionConversationMessage[] = [
      {
        messageId: 'assistant-1',
        sessionId: 'session-1',
        requestId: 'request-1',
        runId: 'run-1',
        rootMessageId: 'user-1',
        role: 'ASSISTANT',
        sequence: 3,
        content: 'router configuration is compliant',
        contentType: 'MARKDOWN',
        metadata: {},
        createdAt: '2026-07-22T00:00:03.000Z',
        visible: true,
      },
    ];
    const messageEnvelopes = conversationMessagesToHistoryEnvelopes(messages);
    const processEnvelopes = [
      event('LLM_THINKING_DELTA', 2, {
        content: 'checking router policy',
        metadata: { accumulated: true, completed: true },
      }),
    ];

    expect(messageEnvelopes).toHaveLength(1);
    expect(messageEnvelopes[0]).toMatchObject({
      eventType: 'LLM_CONTENT_DELTA',
      payload: expect.objectContaining({ content: 'router configuration is compliant' }),
    });
    expect(buildProcessEntries([...processEnvelopes, ...messageEnvelopes], i18n.t)).toEqual(buildProcessEntries(processEnvelopes, i18n.t));
  });

  it('keeps one full-process thinking entry when answer deltas precede its completed snapshot', () => {
    const entries = buildProcessTimelineEntries(
      [
        event('LLM_THINKING_DELTA', 1, {
          content: 'checking AMF registration',
          runId: 'run-1',
          stepId: 'turn-1',
          metadata: { accumulated: true },
        }),
        event('LLM_CONTENT_DELTA', 2, { content: 'AMF is' }),
        event('LLM_THINKING_DELTA', 3, {
          content: 'checking AMF registration and mobility responsibilities',
          runId: 'run-1',
          stepId: 'turn-1',
          metadata: { accumulated: true, completed: true },
        }),
      ],
      i18n.t,
    ).filter((entry) => entry.kind === 'thinking');

    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      key: 'event-1',
      detail: 'checking AMF registration and mobility responsibilities',
      sequence: 3,
    });
  });

  it('does not use raw ordinary tool markdown as browser-authored detail', () => {
    const markdown = `# Capability Result: network-diagnostic-suite

## Device Health Summary

| Device | Status | CPU |
| --- | --- | --- |
| Core-SW-01 | NORMAL | 42% |
| Edge-RTR-02 | DEGRADED | 91% |
| Access-SW-02 | UNREACHABLE | n/a |

The diagnostic output includes enough operational detail to require an expandable row.`;
    const entries = buildProcessEntries(
      [
        event('CAPABILITY_STARTED', 1, {
          capabilityKind: 'TOOL',
          capabilityId: 'networkDiagnostic',
          toolName: 'networkDiagnostic',
          toolCallId: 'tool-1',
        }),
        event('CAPABILITY_RESULT_DELTA', 2, {
          content: markdown,
          contentType: 'MARKDOWN',
          toolName: 'networkDiagnostic',
          toolCallId: 'tool-1',
        }),
        event('CAPABILITY_COMPLETED', 3, {
          capabilityKind: 'TOOL',
          capabilityId: 'networkDiagnostic',
          content: 'networkDiagnostic completed',
          toolName: 'networkDiagnostic',
          toolCallId: 'tool-1',
        }),
      ],
      i18n.t,
    );

    const displayEntries = buildProcessDisplayEntries(entries, i18n.t);
    const toolEntry = displayEntries.find((entry) => entry.title === `networkDiagnostic · ${i18n.t('turn.process.completed')}`);

    expect(toolEntry?.isExpandable).toBe(false);
    expect(toolEntry?.summary).toBe('');
    expect(toolEntry?.detail).toBe('');
    expect(resolveActiveProcessEntryKey(displayEntries)).toBeNull();
  });

  it('omits the summary when a completed capability has no matching result message', () => {
    const entries = buildProcessDisplayEntries(
      buildProcessEntries(
        [
          event('CAPABILITY_STARTED', 1, {
            capabilityKind: 'TOOL',
            capabilityId: 'routerAudit',
            toolName: 'routerAudit',
            toolCallId: 'tool-missing',
          }),
          event('CAPABILITY_COMPLETED', 2, {
            capabilityKind: 'TOOL',
            capabilityId: 'routerAudit',
            toolName: 'routerAudit',
            toolCallId: 'tool-missing',
            status: 'SUCCEEDED',
          }),
        ],
        i18n.t,
      ),
      i18n.t,
    );

    expect(entries).toHaveLength(1);
    expect(entries[0]?.kind).toBe('tool');
    expect(entries[0]?.detail).toBe('');
    expect(entries[0]?.detail).not.toContain('SUCCEEDED');
  });

  it('keeps a completion-only status result visible without inventing an unavailable summary', () => {
    const entries = buildProcessDisplayEntries(
      buildProcessEntries(
        [
          event('CAPABILITY_COMPLETED', 1, {
            capabilityId: 'Agent',
            toolCallId: 'tool-agent-status-only',
            status: 'SUCCEEDED',
            resultPresentationLevel: 'STATUS_ONLY',
            text: '',
            content: '',
          }),
        ],
        i18n.t,
      ),
      i18n.t,
    );

    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      kind: 'tool',
      title: `调用子智能体 · ${i18n.t('turn.process.completed')}`,
      summary: '',
      detail: '',
      isExpandable: false,
    });
    expect(JSON.stringify(entries)).not.toContain(i18n.t('turn.process.resultReturnedWithoutSummary'));
  });

  it('shows Skill result from safeResult without exposing raw status', () => {
    const entries = buildProcessEntries(
      [
        event('CAPABILITY_RESULT_DELTA', 1, {
          capabilityId: 'Skill',
          toolCallId: 'tool-skill-1',
          skillName: 'network-diagnostics',
          text: 'Capability result is available.',
          content: 'Capability result is available.',
          safeResult: { kind: 'skillLoaded', name: 'network-diagnostics', status: 'loaded' },
        }),
        event('CAPABILITY_COMPLETED', 2, {
          capabilityKind: 'TOOL',
          capabilityId: 'Skill',
          targetCapabilityId: 'network-diagnostics',
          toolCallId: 'tool-skill-1',
          skillName: 'network-diagnostics',
          status: 'SUCCEEDED',
          text: 'SUCCEEDED',
        }),
      ],
      i18n.t,
    );

    const displayEntries = buildProcessDisplayEntries(entries, i18n.t);
    const skillEntry = displayEntries[0];

    expect(skillEntry?.title).toBe(`加载技能：network-diagnostics · ${i18n.t('turn.process.completed')}`);
    expect(skillEntry?.summary).toBe(i18n.t('turn.process.skillLoadedSummary', { skillName: 'network-diagnostics' }));
    expect(skillEntry?.isExpandable).toBe(false);
    expect(skillEntry?.detail).not.toContain('SUCCEEDED');
    expect(skillEntry?.detail).not.toContain('toolCallId');
  });
  it('shows Workflow result summary and answer previews from safeResult', () => {
    const entries = buildProcessEntries(
      [
        event('CAPABILITY_RESULT_DELTA', 1, {
          capabilityId: 'Workflow',
          toolCallId: 'tool-wf-1',
          text: 'Capability result is available.',
          content: 'Capability result is available.',
          safeResult: {
            kind: 'workflowResult',
            recipeName: 'alarm-localization',
            status: 'succeeded',
            answerPreviews: ['Root cause: high CPU on cell-1.', 'Action: restart AMF service.'],
          },
        }),
        event('CAPABILITY_COMPLETED', 2, {
          capabilityId: 'Workflow',
          toolCallId: 'tool-wf-1',
          status: 'SUCCEEDED',
          text: 'SUCCEEDED',
        }),
      ],
      i18n.t,
    );

    const displayEntries = buildProcessDisplayEntries(entries, i18n.t);
    const wfEntry = displayEntries[0];

    expect(wfEntry?.summary).toBe('');
    expect(wfEntry?.isExpandable).toBe(true);
    expect(wfEntry?.detail).toContain('Root cause: high CPU on cell-1.');
    expect(wfEntry?.detail).toContain('Action: restart AMF service.');
  });

  it('shows Workflow failed summary without answer previews', () => {
    const entries = buildProcessEntries(
      [
        event('CAPABILITY_RESULT_DELTA', 1, {
          capabilityId: 'Workflow',
          toolCallId: 'tool-wf-2',
          text: 'Capability result is available.',
          content: 'Capability result is available.',
          safeResult: {
            kind: 'workflowResult',
            recipeName: 'alarm-localization',
            status: 'failed',
          },
        }),
        event('CAPABILITY_COMPLETED', 2, {
          capabilityId: 'Workflow',
          toolCallId: 'tool-wf-2',
          status: 'FAILED',
          text: 'FAILED',
        }),
      ],
      i18n.t,
    );

    const displayEntries = buildProcessDisplayEntries(entries, i18n.t);
    const wfEntry = displayEntries[0];

    expect(wfEntry?.summary).toBe('');
    expect(wfEntry?.isExpandable).toBe(false);
    expect(wfEntry?.detail).toBe('');
    expect(wfEntry?.detail).not.toContain('FAILED');
  });

  it('renders backend RAG projections with source split and full content without rebuilding raw conversation results', () => {
    const longContent = `${'中'.repeat(50)}尾部不应展示`;
    const safeResult = {
      kind: 'ragRetrieval',
      totalCount: 3,
      items: [
        { source: 'upf-timeout.md', content: 'Handle N4 timeout first.' },
        { source: 'amf-overload.md', content: longContent },
        { source: '', content: 'Counted without a displayable source.' },
      ],
    };
    const liveEnvelopes = [
      event('CAPABILITY_RESULT_DELTA', 1, {
        capabilityId: 'Rag',
        toolCallId: 'tool-rag-1',
        text: 'Capability result is available.',
        content: 'Capability result is available.',
        safeResult,
      }),
    ];
    const historyEnvelopes = conversationMessagesToHistoryEnvelopes([
      {
        messageId: 'capability-result-rag-1',
        sessionId: 'session-1',
        requestId: 'request-1',
        runId: 'run-1',
        role: 'CAPABILITY_RESULT',
        content: JSON.stringify({
          toolCallId: 'tool-rag-1',
          toolName: 'Rag',
          payload: {
            status: 'OK',
            results: [
              { source: 'docs/upf-timeout.md', content: 'Handle N4 timeout first.' },
              { source: 'C:\\private\\alarms\\amf-overload.md', content: longContent, score: 0.99 },
              { content: 'Counted without a displayable source.' },
            ],
          },
        }),
        contentType: 'PLAIN_TEXT',
        metadata: { kind: 'CAPABILITY_RESULT', toolCallId: 'tool-rag-1', toolName: 'Rag' },
        sequence: 1,
        visible: true,
        createdAt: '2026-06-02T00:00:01.000Z',
      },
    ]);

    const displayEntry = buildProcessDisplayEntries(buildProcessEntries(liveEnvelopes, i18n.t), i18n.t)[0];
    expect(displayEntry?.summary).toBe(i18n.t('turn.process.ragRetrievalSummary', { count: 3 }));
    expect(displayEntry?.detail).toContain('1. upf-timeout.md');
    expect(displayEntry?.detail).toContain('3. 未提供来源');
    expect(displayEntry?.detail).toContain(longContent);
    expect(displayEntry?.ragRetrievalItems).toEqual([
      { displaySource: 'upf-timeout.md', content: 'Handle N4 timeout first.' },
      { displaySource: 'amf-overload.md', content: longContent },
      { displaySource: '未提供来源', content: 'Counted without a displayable source.' },
    ]);
    expect(displayEntry?.detail).not.toBe(i18n.t('turn.process.resultReturnedWithoutSummary'));
    expect(historyEnvelopes).toEqual([]);
    expect(JSON.stringify(historyEnvelopes)).not.toContain('private\\alarms');
  });

  it('splits RAG source by pipe and takes the first segment for displaySource', () => {
    const safeResult = {
      kind: 'ragRetrieval',
      totalCount: 1,
      items: [{ source: 'knowledge-base.md|section-2|extra', content: 'Evidence text.' }],
    };
    const liveEnvelopes = [
      event('CAPABILITY_RESULT_DELTA', 1, {
        capabilityId: 'Rag',
        toolCallId: 'tool-rag-pipe',
        text: 'Capability result is available.',
        content: 'Capability result is available.',
        safeResult,
      }),
    ];

    const displayEntry = buildProcessDisplayEntries(buildProcessEntries(liveEnvelopes, i18n.t), i18n.t)[0];
    expect(displayEntry?.ragRetrievalItems).toEqual([{ displaySource: 'knowledge-base.md', content: 'Evidence text.' }]);
  });

  it('truncates RAG detail text at 512 characters with ellipsis', () => {
    const overLimitContent = 'x'.repeat(600);
    const safeResult = {
      kind: 'ragRetrieval',
      totalCount: 1,
      items: [{ source: 'long-runbook.md', content: overLimitContent }],
    };
    const liveEnvelopes = [
      event('CAPABILITY_RESULT_DELTA', 1, {
        capabilityId: 'Rag',
        toolCallId: 'tool-rag-long',
        text: 'Capability result is available.',
        content: 'Capability result is available.',
        safeResult,
      }),
    ];

    const displayEntry = buildProcessDisplayEntries(buildProcessEntries(liveEnvelopes, i18n.t), i18n.t)[0];
    expect(displayEntry?.detail).toContain('x'.repeat(512) + '...');
    expect(displayEntry?.detail).not.toContain('x'.repeat(600));
    expect(displayEntry?.ragRetrievalItems).toEqual([{ displaySource: 'long-runbook.md', content: overLimitContent }]);
  });

  it('projects historical Skill result messages into the same Skill-name display shape', () => {
    const messages: SessionConversationMessage[] = [
      {
        messageId: 'capability-result-1',
        sessionId: 'session-1',
        requestId: 'request-1',
        runId: 'run-1',
        role: 'CAPABILITY_RESULT',
        content: JSON.stringify({
          toolCallId: 'tool-skill-1',
          toolName: 'Skill',
          payload: {
            name: 'network-diagnostics',
            status: 'loaded',
            capabilityResult: { metadata: { targetSkillId: 'network-diagnostics' } },
          },
        }),
        contentType: 'PLAIN_TEXT',
        metadata: { kind: 'CAPABILITY_RESULT', toolCallId: 'tool-skill-1', toolName: 'Skill' },
        sequence: 1,
        visible: true,
        createdAt: '2026-06-02T00:00:01.000Z',
      },
    ];
    const historyEnvelopes = conversationMessagesToHistoryEnvelopes(messages);
    const payload = historyEnvelopes[0]?.payload as Record<string, unknown> | undefined;
    const entries = buildProcessEntries(historyEnvelopes, i18n.t);
    const displayEntries = buildProcessDisplayEntries(entries, i18n.t);

    expect(historyEnvelopes).toEqual([]);
    expect(payload).toBeUndefined();
    expect(entries).toEqual([]);
    expect(displayEntries).toEqual([]);
    expect(JSON.stringify(historyEnvelopes)).not.toContain('network-diagnostics');
  });

  it('shows glob result from safeResult as a file list summary', () => {
    const entries = buildProcessEntries(
      [
        event('CAPABILITY_RESULT_DELTA', 1, {
          capabilityId: 'glob',
          toolCallId: 'tool-glob-1',
          skillName: 'network-diagnostics',
          text: 'Capability result is available.',
          content: 'Capability result is available.',
          safeResult: { kind: 'fileList', filenames: ['src/a.ts', 'src/b.ts'], totalCount: 2, truncated: false },
        }),
        event('CAPABILITY_COMPLETED', 2, {
          capabilityId: 'glob',
          toolCallId: 'tool-glob-1',
          skillName: 'network-diagnostics',
          status: 'SUCCEEDED',
          text: 'SUCCEEDED',
        }),
      ],
      i18n.t,
    );

    const displayEntries = buildProcessDisplayEntries(entries, i18n.t);
    const globEntry = displayEntries[0];

    expect(globEntry?.title).toBe(`glob · ${i18n.t('turn.process.completed')}`);
    expect(globEntry?.summary).toBe(i18n.t('turn.process.fileListSummary', { count: 2 }));
    expect(globEntry?.detail).toContain('src/a.ts');
    expect(globEntry?.detail).toContain('src/b.ts');
    expect(JSON.stringify(displayEntries)).not.toContain('network-diagnostics');
    expect(globEntry?.detail).not.toContain('SUCCEEDED');
    expect(globEntry?.detail).not.toContain('toolCallId');
  });

  it('shows mode-specific Grep details without matched line content', () => {
    const contentEntries = buildProcessDisplayEntries(
      buildProcessEntries(
        [
          event('CAPABILITY_RESULT_DELTA', 1, {
            capabilityId: 'Grep',
            toolCallId: 'tool-grep-content-1',
            safeSummaryCode: 'CAPABILITY_RESULT_GREP_CONTENT_MATCHES',
            safeSummaryArgs: { totalMatches: 3, totalFilesWithMatches: 2, truncated: false },
            safeResult: {
              kind: 'grepResult',
              outputMode: 'content',
              totalFilesWithMatches: 2,
              totalMatches: 3,
              truncated: false,
              locations: [
                { filePath: 'workspace/a.log', lineNumber: 4 },
                { filePath: 'workspace/b.log', lineNumber: 9 },
              ],
            },
          }),
        ],
        i18n.t,
      ),
      i18n.t,
    );
    const fileEntries = buildProcessDisplayEntries(
      buildProcessEntries(
        [
          event('CAPABILITY_RESULT_DELTA', 1, {
            capabilityId: 'Grep',
            toolCallId: 'tool-grep-files-1',
            safeSummaryCode: 'CAPABILITY_RESULT_GREP_FILES_WITH_MATCHES',
            safeSummaryArgs: { totalFilesWithMatches: 2, truncated: false },
            safeResult: {
              kind: 'grepResult',
              outputMode: 'files_with_matches',
              totalFilesWithMatches: 2,
              totalMatches: 3,
              truncated: false,
              filenames: ['workspace/a.log', 'workspace/b.log'],
            },
          }),
        ],
        i18n.t,
      ),
      i18n.t,
    );

    expect(contentEntries[0]?.summary).toBe(i18n.t('turn.process.grepContentMatchesSummary', { totalMatches: 3, totalFilesWithMatches: 2 }));
    expect(contentEntries[0]?.detail).toContain('workspace/a.log:4');
    expect(contentEntries[0]?.detail).toContain('workspace/b.log:9');
    expect(fileEntries[0]?.summary).toBe(i18n.t('turn.process.grepFilesWithMatchesSummary', { totalFilesWithMatches: 2 }));
    expect(fileEntries[0]?.detail).toContain('workspace/a.log');
    expect(JSON.stringify([contentEntries, fileEntries])).not.toContain('matched line');
  });

  it('ignores an invalid Grep safeResult while retaining a valid safe summary', () => {
    const entries = buildProcessDisplayEntries(
      buildProcessEntries(
        [
          event('CAPABILITY_RESULT_DELTA', 1, {
            capabilityId: 'Grep',
            toolCallId: 'tool-grep-invalid-1',
            safeSummaryCode: 'CAPABILITY_RESULT_GREP_CONTENT_MATCHES',
            safeSummaryArgs: { totalMatches: 0, totalFilesWithMatches: 0, truncated: false },
            safeResult: {
              kind: 'grepResult',
              outputMode: 'content',
              totalFilesWithMatches: 0,
              totalMatches: 0,
              truncated: false,
              locations: [],
              leakedLine: 'must not render',
            },
          }),
        ],
        i18n.t,
      ),
      i18n.t,
    );

    expect(entries[0]?.summary).toBe(i18n.t('turn.process.grepContentMatchesSummary', { totalMatches: 0, totalFilesWithMatches: 0 }));
    expect(entries[0]?.isExpandable).toBe(false);
    expect(JSON.stringify(entries)).not.toContain('must not render');
  });

  it('shows TodoWrite safeResult as the current todo list', () => {
    const entries = buildProcessEntries(
      [
        event('CAPABILITY_RESULT_DELTA', 1, {
          capabilityId: 'TodoWrite',
          toolCallId: 'tool-todo-1',
          text: '',
          content: '',
          safeResult: {
            kind: 'todoList',
            todos: [
              {
                content: 'Inspect AMF registration alarms',
                activeForm: 'Inspecting AMF registration alarms',
                status: 'in_progress',
              },
              {
                content: 'Summarize affected cells',
                activeForm: 'Summarizing affected cells',
                status: 'pending',
              },
            ],
          },
        }),
        event('CAPABILITY_COMPLETED', 2, {
          capabilityId: 'TodoWrite',
          toolCallId: 'tool-todo-1',
          status: 'SUCCEEDED',
          text: 'SUCCEEDED',
        }),
      ],
      i18n.t,
    );

    const displayEntries = buildProcessDisplayEntries(entries, i18n.t);
    const todoEntry = displayEntries[0];

    expect(todoEntry?.title).toBe(`TodoWrite · ${i18n.t('turn.process.completed')}`);
    expect(todoEntry?.summary).toBe(i18n.t('turn.process.todoListSummary', { count: 2 }));
    expect(todoEntry?.isExpandable).toBe(true);
    expect(todoEntry?.detail).toContain('1. [进行中] Inspect AMF registration alarms');
    expect(todoEntry?.detail).toContain('Inspecting AMF registration alarms');
    expect(todoEntry?.detail).toContain('2. [待处理] Summarize affected cells');
    expect(todoEntry?.detail).not.toContain('tool-todo-1');
    expect(todoEntry?.detail).not.toContain('SUCCEEDED');
  });

  it('projects historical TodoWrite results into the same todo list display shape', () => {
    const messages: SessionConversationMessage[] = [
      {
        messageId: 'capability-result-todo',
        sessionId: 'session-1',
        requestId: 'request-1',
        runId: 'run-1',
        role: 'CAPABILITY_RESULT',
        content: JSON.stringify({
          toolCallId: 'tool-todo-1',
          toolName: 'TodoWrite',
          payload: {
            oldTodos: [],
            newTodos: [
              {
                content: 'Collect UE attach traces',
                activeForm: 'Collecting UE attach traces',
                status: 'completed',
              },
            ],
          },
        }),
        contentType: 'PLAIN_TEXT',
        metadata: { kind: 'CAPABILITY_RESULT', toolCallId: 'tool-todo-1', toolName: 'TodoWrite' },
        sequence: 1,
        visible: true,
        createdAt: '2026-06-02T00:00:01.000Z',
      },
    ];
    const historyEnvelopes = conversationMessagesToHistoryEnvelopes(messages);
    const payload = historyEnvelopes[0]?.payload as Record<string, unknown> | undefined;
    const entries = buildProcessEntries(historyEnvelopes, i18n.t);
    const displayEntries = buildProcessDisplayEntries(entries, i18n.t);

    expect(historyEnvelopes).toEqual([]);
    expect(payload).toBeUndefined();
    expect(entries).toEqual([]);
    expect(displayEntries).toEqual([]);
    expect(JSON.stringify(historyEnvelopes)).not.toContain('Collect UE attach traces');
  });

  it('projects historical glob results into a bounded file list safeResult', () => {
    const messages: SessionConversationMessage[] = [
      {
        messageId: 'capability-result-glob',
        sessionId: 'session-1',
        requestId: 'request-1',
        runId: 'run-1',
        role: 'CAPABILITY_RESULT',
        content: JSON.stringify({
          toolCallId: 'tool-glob-1',
          toolName: 'glob',
          payload: {
            filenames: ['src/a.ts', 'src/b.ts', 'src/c.ts', 'src/d.ts', 'src/e.ts', 'src/f.ts'],
            truncated: false,
          },
        }),
        contentType: 'PLAIN_TEXT',
        metadata: { kind: 'CAPABILITY_RESULT', toolCallId: 'tool-glob-1', toolName: 'glob' },
        sequence: 1,
        visible: true,
        createdAt: '2026-06-02T00:00:01.000Z',
      },
    ];
    const historyEnvelopes = conversationMessagesToHistoryEnvelopes(messages);
    const payload = historyEnvelopes[0]?.payload as Record<string, unknown> | undefined;
    const entries = buildProcessEntries(historyEnvelopes, i18n.t);
    const displayEntries = buildProcessDisplayEntries(entries, i18n.t);

    expect(historyEnvelopes).toEqual([]);
    expect(payload).toBeUndefined();
    expect(entries).toEqual([]);
    expect(displayEntries).toEqual([]);
    expect(JSON.stringify(historyEnvelopes)).not.toContain('src/a.ts');
  });

  it('shows read safeResult content in second-level details', () => {
    const entries = buildProcessEntries(
      [
        event('CAPABILITY_RESULT_DELTA', 1, {
          capabilityId: 'read',
          toolCallId: 'tool-read-1',
          text: 'Capability result is available.',
          content: 'Capability result is available.',
          safeResult: {
            kind: 'fileRead',
            filePath: 'frontend/agent-web/src/features/chat/process/processDetails.ts',
            contentPreview: 'export function buildProcessEntries() {}',
            truncated: true,
            offset: 0,
            limit: 2000,
            nextOffset: 2000,
          },
        }),
        event('CAPABILITY_COMPLETED', 2, {
          capabilityId: 'read',
          toolCallId: 'tool-read-1',
          status: 'SUCCEEDED',
          text: 'SUCCEEDED',
        }),
      ],
      i18n.t,
    );

    const displayEntries = buildProcessDisplayEntries(entries, i18n.t);

    expect(displayEntries[0]?.title).toBe(`read · ${i18n.t('turn.process.completed')}`);
    expect(displayEntries[0]?.summary).toBe(
      i18n.t('turn.process.fileReadSummary', {
        filePath: 'frontend/agent-web/src/features/chat/process/processDetails.ts',
      }),
    );
    expect(displayEntries[0]?.isExpandable).toBe(true);
    expect(displayEntries[0]?.detail).toContain(i18n.t('turn.process.fileReadRangeWithRange', { startLine: 1, limit: 2000 }));
    expect(displayEntries[0]?.detail).toContain('export function buildProcessEntries');
    expect(displayEntries[0]?.detail).toContain(i18n.t('turn.process.fileReadContinuationNoticeWithLine', { nextLine: 2001 }));
    expect(displayEntries[0]?.detail).not.toContain('tool-read-1');
    expect(displayEntries[0]?.detail).not.toContain('nextOffset');
  });

  it('shows file write safeResult with the safe display path', () => {
    const entries = buildProcessEntries(
      [
        event('CAPABILITY_RESULT_DELTA', 1, {
          capabilityId: 'write',
          toolCallId: 'tool-write-1',
          text: '',
          content: '',
          safeResult: {
            kind: 'fileWrite',
            operation: 'create',
            filePath: 'diagnostics/generated/alarm-summary.txt',
          },
          safeSummary: 'File was created: diagnostics/generated/alarm-summary.txt.',
        }),
        event('CAPABILITY_COMPLETED', 2, {
          capabilityId: 'write',
          toolCallId: 'tool-write-1',
          status: 'SUCCEEDED',
          text: 'SUCCEEDED',
        }),
      ],
      i18n.t,
    );

    const displayEntries = buildProcessDisplayEntries(entries, i18n.t);
    const rendered = displayEntries.flatMap((entry) => [entry.title, entry.summary, entry.detail]).join('\n');

    expect(displayEntries[0]?.title).toBe(`write · ${i18n.t('turn.process.completed')}`);
    expect(displayEntries[0]?.summary).toBe(i18n.t('turn.process.fileCreatedSummary', { filePath: 'diagnostics/generated/alarm-summary.txt' }));
    expect(displayEntries[0]?.isExpandable).toBe(false);
    expect(rendered).toContain('diagnostics/generated/alarm-summary.txt');
    expect(rendered).not.toContain('tool-write-1');
  });

  it('sanitizes absolute file paths from upstream safeResult before display', () => {
    const entries = buildProcessEntries(
      [
        event('CAPABILITY_RESULT_DELTA', 1, {
          capabilityId: 'read',
          toolCallId: 'tool-read-absolute',
          text: '',
          content: '',
          safeResult: {
            kind: 'fileRead',
            filePath: 'D:\\tenant\\workspace\\diagnostics\\secret-report.md',
            contentPreview: 'safe preview',
            truncated: false,
          },
        }),
      ],
      i18n.t,
    );

    const displayEntries = buildProcessDisplayEntries(entries, i18n.t);
    const absoluteRendered = displayEntries.flatMap((entry) => [entry.title, entry.summary, entry.detail]).join('\n');

    expect(absoluteRendered).toContain('…/workspace/diagnostics/secret-report.md');
    expect(absoluteRendered).not.toContain('D:\\tenant');
    expect(absoluteRendered).not.toContain('D:/tenant');
    expect(absoluteRendered).not.toContain('tool-read-absolute');
  });

  it('preserves absolute paths in Chat command output text', () => {
    const entries = buildProcessEntries(
      [
        event('CAPABILITY_RESULT_DELTA', 1, {
          capabilityId: 'bash',
          toolCallId: 'tool-bash-path',
          text: 'Capability result is available.',
          content: 'Capability result is available.',
          safeResult: {
            kind: 'commandOutput',
            exitCode: 0,
            stdoutPreview: 'saved at /var/log/nextagent/runtime.log',
            stderrPreview: '',
            stdoutTruncated: false,
            stderrTruncated: false,
          },
        }),
      ],
      i18n.t,
    );

    const rendered = buildProcessDisplayEntries(entries, i18n.t)
      .flatMap((entry) => [entry.title, entry.summary, entry.detail])
      .join('\n');

    expect(rendered).toContain('/var/log/nextagent/runtime.log');
    expect(rendered).not.toContain('[REDACTED_PATH]');
  });

  it('keeps command result detail spacing compact', () => {
    const entries = buildProcessEntries(
      [
        event('CAPABILITY_RESULT_DELTA', 1, {
          capabilityId: 'bash',
          toolCallId: 'tool-bash-1',
          text: 'Capability result is available.',
          content: 'Capability result is available.',
          safeResult: {
            kind: 'commandOutput',
            exitCode: 126,
            stdoutPreview: '',
            stderrPreview: 'COMMAND_NOT_ALLOWED: Bash command is not allowed by policy.',
            stdoutTruncated: false,
            stderrTruncated: false,
          },
        }),
      ],
      i18n.t,
    );

    const displayEntries = buildProcessDisplayEntries(entries, i18n.t);

    expect(displayEntries[0]?.title).toBe(`bash · ${i18n.t('turn.process.blocked')}`);
    expect(displayEntries[0]?.summary).toBe(i18n.t('turn.process.commandBlockedSummary'));
    expect(displayEntries[0]?.detail).toContain(i18n.t('turn.process.exitCodeWithCode', { code: 126 }));
    expect(displayEntries[0]?.detail).toContain(i18n.t('turn.process.errorCodeWithCode', { code: 'COMMAND_NOT_ALLOWED' }));
    expect(displayEntries[0]?.detail).toContain(i18n.t('turn.process.stderrDetailInline', { message: 'Bash command is not allowed by policy.' }));
    expect(displayEntries[0]?.detail).not.toContain(`${i18n.t('turn.process.stderrLabel')}:\n`);
    expect(displayEntries[0]?.detail).not.toContain('COMMAND_NOT_ALLOWED: Bash');
    expect(displayEntries[0]?.detail).not.toContain('\n\n');
    expect(displayEntries[0]?.detail).not.toContain('tool-bash-1');
  });

  it('does not trust a compatibility safeSummary without a recognized descriptor', () => {
    const safeSummary = 'Validated 3 interface alarms.';
    const entries = buildProcessEntries(
      [
        event('CAPABILITY_RESULT_DELTA', 1, {
          capabilityId: 'customTool',
          toolCallId: 'tool-custom-1',
          text: '',
          content: '',
          safeSummary,
        }),
        event('CAPABILITY_COMPLETED', 2, {
          capabilityId: 'customTool',
          toolCallId: 'tool-custom-1',
          status: 'SUCCEEDED',
          text: 'SUCCEEDED',
        }),
      ],
      i18n.t,
    );

    const displayEntries = buildProcessDisplayEntries(entries, i18n.t);

    expect(displayEntries[0]?.title).toBe(`customTool · ${i18n.t('turn.process.completed')}`);
    expect(displayEntries[0]?.summary).toBe('');
    expect(displayEntries[0]?.detail).toBe('');
    expect(displayEntries[0]?.isExpandable).toBe(false);
    const rendered = displayEntries.flatMap((entry) => [entry.title, entry.summary, entry.detail]).join('\n');
    expect(rendered).not.toContain('Capability result is available.');
    expect(rendered).not.toContain('tool-custom-1');
  });

  it('renders a language-neutral summary descriptor before the English compatibility fallback', () => {
    const entries = buildProcessDisplayEntries(
      buildProcessEntries(
        [
          event('CAPABILITY_RESULT_DELTA', 1, {
            capabilityId: 'Read',
            toolCallId: 'tool-read-summary-code',
            resultPresentationLevel: 'SUMMARY',
            text: '',
            content: '',
            safeSummaryCode: 'CAPABILITY_RESULT_FILE_READ',
            safeSummaryArgs: { filePath: 'workspace/backbone-latency.csv' },
            safeSummary: 'Read workspace/backbone-latency.csv and returned its content.',
          }),
        ],
        i18n.t,
      ),
      i18n.t,
    );

    expect(entries[0]?.summary).toBe('已读取 workspace/backbone-latency.csv，内容已返回。');
    expect(entries[0]?.detail).toBe('已读取 workspace/backbone-latency.csv，内容已返回。');
  });

  it('shows ToolSearch governed matches from its typed safe result', () => {
    const safeSummary = 'ToolSearch found 2 governed capabilities.';
    const safeDetail = [
      'RAN Alarm Diagnosis (SKILL · ran-alarm-diagnosis)',
      'Diagnose active radio access network alarms.',
      '',
      'CLIP API 021 (TOOL · clipc-api-021)',
      'Query a governed telecom KPI snapshot.',
    ].join('\n');
    const entries = buildProcessEntries(
      [
        event('CAPABILITY_RESULT_DELTA', 1, {
          capabilityId: 'ToolSearch',
          toolCallId: 'tool-search-1',
          text: safeDetail,
          content: safeDetail,
          safeSummary,
          safeResult: {
            kind: 'toolSearch',
            tools: [
              { capability_id: 'ran-alarm-diagnosis', name: 'RAN Alarm Diagnosis', kind: 'SKILL' },
              { capability_id: 'clipc-api-021', name: 'CLIP API 021', kind: 'TOOL' },
            ],
            totalCount: 2,
            truncated: false,
          },
        }),
      ],
      i18n.t,
    );

    const displayEntries = buildProcessDisplayEntries(entries, i18n.t);

    expect(displayEntries[0]?.summary).toBe(i18n.t('turn.process.toolSearchSummary', { count: 2 }));
    expect(displayEntries[0]?.isExpandable).toBe(true);
    expect(displayEntries[0]?.detail).toContain('ran-alarm-diagnosis');
    expect(displayEntries[0]?.detail).toContain('clipc-api-021');
    expect(displayEntries[0]?.detail).not.toContain('tool-search-1');
  });

  it('shows Cron create fields from its typed safe result', () => {
    const entries = buildProcessEntries(
      [
        event('CAPABILITY_RESULT_DELTA', 1, {
          capabilityId: 'Cron',
          toolCallId: 'cron-create-1',
          text: 'Cron task was created.',
          content: 'Cron task was created.',
          safeResult: {
            kind: 'cron',
            action: 'create',
            id: 'cron-1',
            humanSchedule: 'Every day at 03:17',
            recurring: true,
          },
        }),
      ],
      i18n.t,
    );

    const displayEntry = buildProcessDisplayEntries(entries, i18n.t)[0];
    expect(displayEntry?.summary).toBe(i18n.t('turn.process.cronCreatedSummary'));
    expect(displayEntry?.detail).toContain('任务标识：cron-1');
    expect(displayEntry?.detail).toContain('执行计划：Every day at 03:17');
    expect(displayEntry?.detail).toContain('重复执行：是');
  });

  it('uses English TodoWrite status labels without changing todo values', () => {
    const englishT = i18n.getFixedT('en-US');
    const entries = buildProcessEntries(
      [
        event('CAPABILITY_RESULT_DELTA', 1, {
          capabilityId: 'TodoWrite',
          toolCallId: 'todo-en-1',
          safeResult: {
            kind: 'todoList',
            todos: [
              { content: 'Inspect AMF alarms', activeForm: 'Inspecting AMF alarms', status: 'in_progress' },
              { content: 'Summarize cells', activeForm: 'Summarizing cells', status: 'completed' },
            ],
          },
        }),
      ],
      englishT,
    );

    const displayEntry = buildProcessDisplayEntries(entries, englishT)[0];
    expect(displayEntry?.summary).toBe('The task list contains 2 items.');
    expect(displayEntry?.detail).toContain('1. [In progress] Inspect AMF alarms');
    expect(displayEntry?.detail).toContain('2. [Completed] Summarize cells');
  });

  it('keeps a status-only result visible without inventing a result summary', () => {
    const entries = buildProcessEntries(
      [
        event('CAPABILITY_RESULT_DELTA', 1, {
          capabilityId: 'unknownTool',
          toolCallId: 'tool-unknown-1',
          text: '',
          content: '',
        }),
      ],
      i18n.t,
    );

    const displayEntries = buildProcessDisplayEntries(entries, i18n.t);

    expect(displayEntries[0]?.title).toBe(`unknownTool · ${i18n.t('turn.process.resultReturned')}`);
    expect(displayEntries[0]?.summary).toBe('');
    expect(displayEntries[0]?.detail).toBe('');
    expect(displayEntries[0]?.isExpandable).toBe(false);
    const rendered = displayEntries.flatMap((entry) => [entry.title, entry.summary, entry.detail]).join('\n');
    expect(rendered).not.toContain(i18n.t('turn.process.resultReturnedWithoutSummary'));
    expect(rendered).not.toContain('Capability result is available.');
    expect(rendered).not.toContain('tool-unknown-1');
  });

  it('does not synthesize display fields for historical capability results', () => {
    const messages: SessionConversationMessage[] = [
      {
        messageId: 'capability-result-2',
        sessionId: 'session-1',
        requestId: 'request-1',
        runId: 'run-1',
        role: 'CAPABILITY_RESULT',
        content: JSON.stringify({
          toolCallId: 'tool-read-1',
          toolName: 'Read',
          payload: {
            name: 'workspace-file',
            status: 'loaded',
          },
        }),
        contentType: 'PLAIN_TEXT',
        metadata: { kind: 'CAPABILITY_RESULT', toolCallId: 'tool-read-1', toolName: 'Read' },
        sequence: 1,
        visible: true,
        createdAt: '2026-06-02T00:00:01.000Z',
      },
    ];
    const envelopes = conversationMessagesToHistoryEnvelopes(messages);

    expect(envelopes).toEqual([]);
  });

  it('does not summarize generic JSON tool results in the browser', () => {
    const entries = buildProcessEntries(
      [
        event('CAPABILITY_RESULT_DELTA', 1, {
          capabilityId: 'Read',
          toolName: 'read',
          capabilityName: 'read',
          toolCallId: 'tool-read-1',
          result: JSON.stringify({
            toolCallId: 'tool-read-1',
            toolName: 'read',
            payload: {
              filePath: 'package.json',
              content: 'raw file content that should stay hidden',
            },
          }),
        }),
        event('CAPABILITY_COMPLETED', 2, {
          capabilityKind: 'TOOL',
          capabilityId: 'Read',
          toolName: 'read',
          capabilityName: 'read',
          toolCallId: 'tool-read-1',
          status: 'SUCCEEDED',
          content: 'read completed',
        }),
      ],
      i18n.t,
      presentationResources,
      'zh-CN',
    );

    const displayEntries = buildProcessDisplayEntries(entries, i18n.t);
    const readEntry = displayEntries[0];

    expect(readEntry?.title).toBe(`读取文件 · ${i18n.t('turn.process.completed')}`);
    expect(readEntry?.summary).toBe('');
    expect(readEntry?.isExpandable).toBe(false);
    expect(readEntry?.detail).toBe('');
    expect(readEntry?.detail).not.toContain('raw file content');
    expect(readEntry?.detail).not.toContain('toolCallId');
    expect(readEntry?.detail).not.toContain('payload');
  });

  it('keeps historical unknown JSON tool results non-specific without exposing raw payload content', () => {
    const messages: SessionConversationMessage[] = [
      {
        messageId: 'capability-result-read',
        sessionId: 'session-1',
        requestId: 'request-1',
        runId: 'run-1',
        role: 'CAPABILITY_RESULT',
        content: JSON.stringify({
          toolCallId: 'tool-read-1',
          toolName: 'read',
          payload: {
            filePath: 'package.json',
            content: 'stored file content that should stay hidden',
          },
        }),
        contentType: 'PLAIN_TEXT',
        metadata: { kind: 'CAPABILITY_RESULT', toolCallId: 'tool-read-1', toolName: 'read' },
        sequence: 1,
        visible: true,
        createdAt: '2026-06-02T00:00:01.000Z',
      },
    ];

    const historyEnvelopes = conversationMessagesToHistoryEnvelopes(messages);
    const payload = historyEnvelopes[0]?.payload as Record<string, unknown> | undefined;
    const entries = buildProcessEntries(historyEnvelopes, i18n.t);
    const displayEntries = buildProcessDisplayEntries(entries, i18n.t);

    expect(historyEnvelopes).toEqual([]);
    expect(payload).toBeUndefined();
    expect(entries).toEqual([]);
    expect(displayEntries).toEqual([]);
    const serializedPayload = JSON.stringify(historyEnvelopes);
    const rendered = displayEntries.flatMap((entry) => [entry.title, entry.summary, entry.detail]).join('\n');
    expect(serializedPayload).not.toContain('stored file content');
    expect(serializedPayload).not.toContain('payload');
    expect(rendered).not.toContain('stored file content');
    expect(rendered).not.toContain('toolCallId');
    expect(rendered).not.toContain('payload');
  });

  it('uses historical safeSummary without making raw stored capability content expandable', () => {
    const safeSummary = 'Validated 3 interface alarms.';
    const messages: SessionConversationMessage[] = [
      {
        messageId: 'capability-result-custom',
        sessionId: 'session-1',
        requestId: 'request-1',
        runId: 'run-1',
        role: 'CAPABILITY_RESULT',
        content: JSON.stringify({
          toolCallId: 'tool-custom-1',
          toolName: 'customTool',
          payload: {
            arbitrary: 'raw result must stay hidden',
            nested: { token: 'token-leak' },
          },
        }),
        contentType: 'PLAIN_TEXT',
        metadata: { kind: 'CAPABILITY_RESULT', toolCallId: 'tool-custom-1', toolName: 'customTool', safeSummary },
        sequence: 1,
        visible: true,
        createdAt: '2026-06-02T00:00:01.000Z',
      },
    ];

    const historyEnvelopes = conversationMessagesToHistoryEnvelopes(messages);
    const payload = historyEnvelopes[0]?.payload as Record<string, unknown> | undefined;
    const entries = buildProcessEntries(historyEnvelopes, i18n.t);
    const displayEntries = buildProcessDisplayEntries(entries, i18n.t);
    const serializedPayload = JSON.stringify(historyEnvelopes);
    const rendered = displayEntries.flatMap((entry) => [entry.title, entry.summary, entry.detail]).join('\n');

    expect(historyEnvelopes).toEqual([]);
    expect(payload).toBeUndefined();
    expect(entries).toEqual([]);
    expect(displayEntries).toEqual([]);
    expect(serializedPayload).not.toContain('raw result must stay hidden');
    expect(serializedPayload).not.toContain('token-leak');
    expect(rendered).not.toContain('raw result must stay hidden');
    expect(rendered).not.toContain('token-leak');
  });

  it('attaches a realtime extension-policy error to the corresponding Tool Calling without raw output', () => {
    const entries = buildProcessEntries(
      [
        event('CAPABILITY_STARTED', 1, {
          capabilityId: 'Write',
          toolCallId: 'tool-write-1',
        }),
        event('CAPABILITY_RESULT_DELTA', 2, {
          capabilityId: 'Write',
          toolCallId: 'tool-write-1',
          status: 'FAILED',
          safeErrorCode: 'CAPABILITY_PATH_REJECTED',
          safeErrorCategory: 'AUTHORIZATION',
          safeSummaryCode: 'CAPABILITY_RESULT_FAILURE_PATH_REJECTED',
          safeSummaryArgs: {},
          safeSummary: 'File extension is not allowed by Agent workspace policy.',
          text: 'Path access was blocked by policy.',
          content: 'Path access was blocked by policy.',
        }),
        event('CAPABILITY_COMPLETED', 3, {
          capabilityId: 'Write',
          toolCallId: 'tool-write-1',
          status: 'FAILED',
          safeErrorCode: 'CAPABILITY_PATH_REJECTED',
          safeErrorCategory: 'AUTHORIZATION',
          safeSummaryCode: 'CAPABILITY_RESULT_FAILURE_PATH_REJECTED',
          safeSummaryArgs: {},
          safeSummary: 'File extension is not allowed by Agent workspace policy.',
          text: 'FAILED',
          result: '{"file_path":"secret-file.ts","content":"raw content must stay hidden"}',
          stdout: 'raw stdout must stay hidden',
          stderr: 'raw stderr must stay hidden',
        }),
        event('DEGRADATION_NOTICE', 4, {
          code: 'CAPABILITY_PATH_REJECTED',
          text: 'Degradation notice',
          content: 'Degradation notice',
        }),
      ],
      i18n.t,
    );
    const displayEntries = buildProcessDisplayEntries(entries, i18n.t);
    const writeEntry = displayEntries.find((entry) => entry.title === `Write · ${i18n.t('turn.capabilityFailure.status.blocked')}`);
    const degradationEntry = displayEntries.find((entry) => entry.title === i18n.t('turn.process.systemEvent.degradation.title'));
    const rendered = displayEntries.flatMap((entry) => [entry.title, entry.summary, entry.detail]).join('\n');

    expect(writeEntry?.summary).toBe(i18n.t('turn.capabilityFailure.reason.policyDenied'));
    expect(writeEntry?.detail).not.toContain(i18n.t('turn.capabilityFailure.reason.policyDenied'));
    expect(writeEntry?.detail).toContain(i18n.t('turn.process.errorCodeWithCode', { code: 'CAPABILITY_PATH_REJECTED' }));
    expect(writeEntry?.detail).toContain(i18n.t('turn.process.errorCategoryWithCategory', { category: 'AUTHORIZATION' }));
    expect(writeEntry?.detail).toContain(i18n.t('turn.process.invocationStatusWithStatus', { status: i18n.t('turn.process.failed') }));
    expect(degradationEntry?.summary).toBe(i18n.t('turn.process.systemEvent.degradation.summary'));
    expect(degradationEntry?.detail).toBe(i18n.t('turn.process.errorCodeWithCode', { code: 'CAPABILITY_PATH_REJECTED' }));
    expect(degradationEntry?.isExpandable).toBe(true);
    expect(rendered).not.toContain('secret-file.ts');
    expect(rendered).not.toContain('raw content must stay hidden');
    expect(rendered).not.toContain('raw stdout must stay hidden');
    expect(rendered).not.toContain('raw stderr must stay hidden');
    expect(rendered).not.toContain('tool-write-1');
  });

  it('localizes completed-only Write extension-policy failures from safe summary', () => {
    const entries = buildProcessEntries(
      [
        event('CAPABILITY_STARTED', 1, {
          capabilityId: 'Write',
          toolCallId: 'tool-write-completed-only',
        }),
        event('CAPABILITY_COMPLETED', 2, {
          capabilityId: 'Write',
          toolCallId: 'tool-write-completed-only',
          status: 'FAILED',
          safeErrorCode: 'CAPABILITY_PATH_REJECTED',
          safeErrorCategory: 'AUTHORIZATION',
          safeSummaryCode: 'CAPABILITY_RESULT_FAILURE_PATH_REJECTED',
          safeSummaryArgs: {},
          safeSummary: 'File extension is not allowed by Agent workspace policy.',
          text: 'FAILED',
          result: '{"file_path":"workspace/secret.exe"}',
        }),
      ],
      i18n.t,
    );
    const displayEntries = buildProcessDisplayEntries(entries, i18n.t);
    const rendered = displayEntries.flatMap((entry) => [entry.title, entry.summary, entry.detail]).join('\n');

    expect(displayEntries[0]?.title).toBe(`Write · ${i18n.t('turn.capabilityFailure.status.blocked')}`);
    expect(displayEntries[0]?.summary).toBe(i18n.t('turn.capabilityFailure.reason.policyDenied'));
    expect(displayEntries[0]?.detail).not.toContain(i18n.t('turn.capabilityFailure.reason.policyDenied'));
    expect(displayEntries[0]?.detail).toContain(i18n.t('turn.process.errorCodeWithCode', { code: 'CAPABILITY_PATH_REJECTED' }));
    expect(rendered).not.toContain('workspace/secret.exe');
    expect(rendered).not.toContain('tool-write-completed-only');
  });

  it('localizes Edit extension-policy failures without depending on the capability name', () => {
    const entries = buildProcessEntries(
      [
        event('CAPABILITY_RESULT_DELTA', 1, {
          capabilityId: 'Edit',
          toolCallId: 'tool-edit-extension',
          status: 'FAILED',
          safeErrorCode: 'CAPABILITY_PATH_REJECTED',
          safeErrorCategory: 'AUTHORIZATION',
          safeSummaryCode: 'CAPABILITY_RESULT_FAILURE_PATH_REJECTED',
          safeSummaryArgs: {},
          safeSummary: 'File extension is not allowed by Agent workspace policy.',
        }),
        event('CAPABILITY_COMPLETED', 2, {
          capabilityId: 'Edit',
          toolCallId: 'tool-edit-extension',
          status: 'FAILED',
          safeErrorCode: 'CAPABILITY_PATH_REJECTED',
          safeErrorCategory: 'AUTHORIZATION',
          safeSummaryCode: 'CAPABILITY_RESULT_FAILURE_PATH_REJECTED',
          safeSummaryArgs: {},
          safeSummary: 'File extension is not allowed by Agent workspace policy.',
          text: 'FAILED',
          stderr: 'D:\\secret\\run.exe',
        }),
      ],
      i18n.t,
    );
    const displayEntries = buildProcessDisplayEntries(entries, i18n.t);
    const rendered = displayEntries.flatMap((entry) => [entry.title, entry.summary, entry.detail]).join('\n');

    expect(displayEntries[0]?.title).toBe(`Edit · ${i18n.t('turn.capabilityFailure.status.blocked')}`);
    expect(displayEntries[0]?.summary).toBe(i18n.t('turn.capabilityFailure.reason.policyDenied'));
    expect(displayEntries[0]?.detail).toContain(i18n.t('turn.process.errorCategoryWithCategory', { category: 'AUTHORIZATION' }));
    expect(rendered).not.toContain('D:\\secret\\run.exe');
    expect(rendered).not.toContain('tool-edit-extension');
  });

  it('keeps generic path rejection copy when no extension-policy safe summary is present', () => {
    const entries = buildProcessEntries(
      [
        event('CAPABILITY_COMPLETED', 1, {
          capabilityId: 'Read',
          toolCallId: 'tool-read-path',
          status: 'FAILED',
          safeErrorCode: 'CAPABILITY_PATH_REJECTED',
          safeErrorCategory: 'AUTHORIZATION',
          safeSummaryCode: 'CAPABILITY_RESULT_FAILURE_PATH_REJECTED',
          safeSummaryArgs: {},
          text: 'FAILED',
        }),
      ],
      i18n.t,
    );
    const displayEntries = buildProcessDisplayEntries(entries, i18n.t);

    expect(displayEntries[0]?.summary).toBe(i18n.t('turn.capabilityFailure.reason.policyDenied'));
    expect(displayEntries[0]?.summary).not.toBe(i18n.t('turn.failureReasons.fileExtensionRejected'));
  });

  it('ignores arbitrary non-generic safe summaries for unknown safe failures', () => {
    const safeSummary = 'Policy denied access to a governed local resource.';
    const entries = buildProcessEntries(
      [
        event('CAPABILITY_COMPLETED', 1, {
          capabilityId: 'customTool',
          toolCallId: 'tool-custom-policy',
          status: 'FAILED',
          safeErrorCode: 'CUSTOM_POLICY_DENIED',
          safeErrorCategory: 'AUTHORIZATION',
          safeSummary,
          text: 'FAILED',
          result: '{"path":"D:/secret/path"}',
        }),
      ],
      i18n.t,
    );
    const displayEntries = buildProcessDisplayEntries(entries, i18n.t);
    const rendered = displayEntries.flatMap((entry) => [entry.title, entry.summary, entry.detail]).join('\n');

    expect(displayEntries[0]?.summary).toBe(i18n.t('turn.capabilityFailure.reason.generic'));
    expect(displayEntries[0]?.detail).not.toContain(safeSummary);
    expect(rendered).not.toContain('D:/secret/path');
    expect(rendered).not.toContain('tool-custom-policy');
  });

  it('projects historical failed capability safe errors into the same display shape', () => {
    const messages: SessionConversationMessage[] = [
      {
        messageId: 'capability-result-glob-failed',
        sessionId: 'session-1',
        requestId: 'request-1',
        runId: 'run-1',
        role: 'CAPABILITY_RESULT',
        content: JSON.stringify({
          toolCallId: 'tool-glob-1',
          toolName: 'glob',
          payload: {
            status: 'FAILED',
            safeError: {
              code: 'CAPABILITY_PATH_REJECTED',
              category: 'AUTHORIZATION',
              message: 'raw path D:\\secret\\workspace must stay hidden',
            },
            filenames: ['secret-file.ts'],
          },
        }),
        contentType: 'PLAIN_TEXT',
        metadata: { kind: 'CAPABILITY_RESULT', toolCallId: 'tool-glob-1', toolName: 'glob' },
        sequence: 1,
        visible: true,
        createdAt: '2026-06-02T00:00:01.000Z',
      },
    ];
    const historyEnvelopes = conversationMessagesToHistoryEnvelopes(messages);
    const payload = historyEnvelopes[0]?.payload as Record<string, unknown> | undefined;
    const entries = buildProcessEntries(historyEnvelopes, i18n.t);
    const displayEntries = buildProcessDisplayEntries(entries, i18n.t);
    const rendered = displayEntries.flatMap((entry) => [entry.title, entry.summary, entry.detail]).join('\n');

    expect(historyEnvelopes).toEqual([]);
    expect(payload).toBeUndefined();
    expect(entries).toEqual([]);
    expect(displayEntries).toEqual([]);
    expect(rendered).not.toContain('raw path');
    expect(rendered).not.toContain('secret-file.ts');
    expect(rendered).not.toContain('tool-glob-1');
  });

  it('shows failed terminal error codes without exposing legacy safe-failure prose', () => {
    const expectedDetail = i18n.t('turn.process.failedWithCode', { code: 'CAPABILITY_PATH_REJECTED' });
    const entries = buildProcessTimelineEntries([event('REQUEST_FAILED', 1, { reason: 'Request failed safely: CAPABILITY_PATH_REJECTED' })], i18n.t);

    expect(entries).toHaveLength(1);
    expect(entries[0]?.detail).toBe(expectedDetail);
    expect(entries[0]?.detail).not.toContain('Request failed safely');
  });

  it('restores failed terminal safe code as expandable degradation detail from history', () => {
    const messages: SessionConversationMessage[] = [
      {
        messageId: 'assistant-terminal-run-1',
        sessionId: 'session-1',
        requestId: 'request-1',
        runId: 'run-1',
        role: 'ASSISTANT',
        content: 'Request failed safely: MODEL_PROVIDER_ERROR',
        contentType: 'PLAIN_TEXT',
        metadata: {
          eventType: 'REQUEST_FAILED',
          status: 'FAILED',
          code: 'MODEL_PROVIDER_ERROR',
          category: 'UNAVAILABLE',
        },
        sequence: 1,
        visible: true,
        createdAt: '2026-06-02T00:00:01.000Z',
      },
    ];
    const historyEnvelopes = conversationMessagesToHistoryEnvelopes(messages);
    const entries = buildProcessEntries(historyEnvelopes, i18n.t);
    const displayEntries = buildProcessDisplayEntries(entries, i18n.t);

    expect(historyEnvelopes[0]?.eventType).toBe('REQUEST_FAILED');
    expect(displayEntries).toHaveLength(1);
    expect(displayEntries[0]?.title).toBe(i18n.t('turn.process.systemEvent.degradation.title'));
    expect(displayEntries[0]?.summary).toBe(i18n.t('turn.process.systemEvent.degradation.summary'));
    expect(displayEntries[0]?.detail).toBe(i18n.t('turn.process.errorCodeWithCode', { code: 'MODEL_PROVIDER_ERROR' }));
    expect(displayEntries[0]?.isExpandable).toBe(true);
  });

  it('does not duplicate live degradation detail when failed terminal also carries a safe code', () => {
    const entries = buildProcessEntries(
      [event('DEGRADATION_NOTICE', 1, { code: 'MODEL_PROVIDER_ERROR' }), event('REQUEST_FAILED', 2, { code: 'MODEL_PROVIDER_ERROR' })],
      i18n.t,
    );

    expect(entries.filter((entry) => entry.title === i18n.t('turn.process.systemEvent.degradation.title'))).toHaveLength(1);
  });

  it('renders one factual capability failure reason and keeps only safe technical details expandable', () => {
    const entries = buildProcessEntries(
      [
        event('CAPABILITY_COMPLETED', 1, {
          capabilityId: 'Write',
          toolCallId: 'tool-write-full-read',
          status: 'FAILED',
          resultPresentationLevel: 'DETAIL',
          safeErrorCode: 'WRITE_REQUIRES_FULL_READ',
          safeErrorCategory: 'CONFLICT',
          safeSummaryCode: 'CAPABILITY_RESULT_FAILURE_FULL_READ_REQUIRED',
          safeSummaryArgs: {},
          safeSummary: 'Please read /private/secret and retry now.',
          text: 'CAPABILITY_STARTED',
          content: 'must not leak result content',
          retryable: true,
        }),
      ],
      i18n.getFixedT('zh-CN'),
    );
    const displayEntry = buildProcessDisplayEntries(entries, i18n.getFixedT('zh-CN'))[0];
    const rendered = [displayEntry?.title, displayEntry?.summary, displayEntry?.detail].join('\n');

    expect(displayEntry).toMatchObject({
      title: 'Write · 未能完成',
      summary: '修改文件前需要先完整读取最新内容。',
      isExpandable: true,
    });
    expect((displayEntry as unknown as { readonly isFailure?: boolean }).isFailure).toBe(true);
    expect(displayEntry?.detail).toContain('错误码：WRITE_REQUIRES_FULL_READ');
    expect(displayEntry?.detail).toContain('错误类别：CONFLICT');
    expect(displayEntry?.detail).toContain('调用状态：已失败');
    expect(displayEntry?.detail).not.toContain('修改文件前需要先完整读取最新内容。');
    expect(rendered).not.toMatch(/Please read|\/private\/secret|must not leak|CAPABILITY_STARTED|系统将|重试|请先/);
  });

  it('uses a localized generic reason for an unknown failure descriptor instead of upstream prose', () => {
    const displayEntry = buildProcessDisplayEntries(
      buildProcessEntries(
        [
          event('CAPABILITY_COMPLETED', 1, {
            capabilityId: 'VendorProbe',
            toolCallId: 'tool-vendor-failure',
            status: 'FAILED',
            safeErrorCode: 'VENDOR_FAILURE',
            safeErrorCategory: 'FUTURE_CATEGORY',
            safeSummaryCode: 'CAPABILITY_RESULT_FAILURE_FUTURE_VENDOR_CODE',
            safeSummaryArgs: {},
            safeSummary: 'Restart the private appliance and retry.',
          }),
        ],
        i18n.getFixedT('zh-CN'),
      ),
      i18n.getFixedT('zh-CN'),
    )[0];
    const rendered = [displayEntry?.title, displayEntry?.summary, displayEntry?.detail].join('\n');

    expect(displayEntry).toMatchObject({
      title: 'VendorProbe · 未能完成',
      summary: '该步骤未能完成。',
    });
    expect(rendered).not.toContain('Restart the private appliance');
    expect(rendered).not.toContain('CAPABILITY_RESULT_FAILURE_FUTURE_VENDOR_CODE');
  });

  it('keeps capability failure presentation identical under all success disclosure levels', () => {
    const t = i18n.getFixedT('en-US');
    const presentations = (['STATUS_ONLY', 'SUMMARY', 'DETAIL'] as const).map((resultPresentationLevel, index) => {
      const displayEntry = buildProcessDisplayEntries(
        buildProcessEntries(
          [
            event('CAPABILITY_COMPLETED', index + 1, {
              capabilityId: 'Bash',
              toolCallId: `tool-platform-${index}`,
              status: 'FAILED',
              resultPresentationLevel,
              safeErrorCode: 'PLATFORM_UNSUPPORTED',
              safeErrorCategory: 'UNAVAILABLE',
              safeSummaryCode: 'CAPABILITY_RESULT_FAILURE_PLATFORM_UNSUPPORTED',
              safeSummaryArgs: {},
            }),
          ],
          t,
        ),
        t,
      )[0];
      return {
        title: displayEntry?.title,
        summary: displayEntry?.summary,
        detail: displayEntry?.detail,
        isExpandable: displayEntry?.isExpandable,
      };
    });

    expect(presentations).toEqual(
      Array.from({ length: 3 }, () => ({
        title: 'Bash · Cannot run',
        summary: 'The current runtime environment does not support this capability.',
        detail: ['Error code: PLATFORM_UNSUPPORTED', 'Error category: UNAVAILABLE', 'Invocation status: Failed'].join('\n'),
        isExpandable: true,
      })),
    );
  });

  it('does not render lifecycle protocol identifiers as process prose', () => {
    const entries = buildProcessDisplayEntries(
      buildProcessEntries(
        [
          event('CAPABILITY_STARTED', 1, {
            capabilityId: 'Read',
            toolCallId: 'tool-read-running',
            text: 'CAPABILITY_STARTED',
            content: 'CAPABILITY_STARTED',
          }),
        ],
        i18n.getFixedT('zh-CN'),
      ),
      i18n.getFixedT('zh-CN'),
    );
    const rendered = entries.flatMap((entry) => [entry.title, entry.summary, entry.detail]).join('\n');

    expect(entries[0]?.title).toBe('Read · 执行中');
    expect(rendered).not.toContain('CAPABILITY_STARTED');
  });

  it('does not render legacy capability lifecycle fallback prose', () => {
    const entries = buildProcessDisplayEntries(
      buildProcessEntries(
        [
          event('CAPABILITY_STARTED', 1, {
            capabilityId: 'Agent',
            toolCallId: 'tool-agent-running',
            text: 'Capability started',
          }),
        ],
        i18n.getFixedT('zh-CN'),
      ),
      i18n.getFixedT('zh-CN'),
    );
    const rendered = entries.flatMap((entry) => [entry.title, entry.summary, entry.detail]).join('\n');

    expect(entries[0]?.title).toBe('调用子智能体 · 执行中');
    expect(entries[0]?.summary).toBe('');
    expect(entries[0]?.detail).toBe('');
    expect(entries[0]?.isExpandable).toBe(false);
    expect(rendered).not.toContain('Capability started');
  });

  it('does not treat untrusted capability start text as a safe business explanation', () => {
    const entries = buildProcessDisplayEntries(
      buildProcessEntries(
        [
          event('CAPABILITY_STARTED', 1, {
            capabilityId: 'Agent',
            toolCallId: 'tool-agent-explained',
            text: '正在委派网络数据检查任务。',
          }),
        ],
        i18n.getFixedT('zh-CN'),
      ),
      i18n.getFixedT('zh-CN'),
    );

    expect(entries[0]?.title).toBe('调用子智能体 · 执行中');
    expect(entries[0]?.summary).toBe('');
    expect(entries[0]?.detail).toBe('');
    expect(entries[0]?.isExpandable).toBe(false);
  });

  it.each([
    ['TEXT', 'partial', 'complete detail'],
    ['DSL', '<dsl>partial</dsl>', '<dsl>complete</dsl>'],
    ['PIU', { component: 'diagnosis', phase: 'partial' }, { component: 'diagnosis', phase: 'complete' }],
  ] as const)('settles live Workflow %s detail fragments to the same process projection as cold history', (toolMessageType, partial, complete) => {
    const productPayload = {
      capabilityId: 'render-result',
      toolCallId: 'workflow:execution-1:render-result',
      nodeId: 'render-result',
      nodeType: 'DISPLAY',
      toolEventType: 'DETAIL',
      toolMessageType,
      metadata: { accumulated: true },
    };
    const withRun = (envelope: StreamEnvelope): StreamEnvelope => ({ ...envelope, runId: 'run-1' });
    const completed = withRun(
      event('TOOL_STRUCTURED_DELTA', 3, {
        ...productPayload,
        workflowEventType: 'NODE_COMPLETED',
        content: complete,
      }),
    );
    const terminal = withRun(event('REQUEST_COMPLETED', 4, { content: 'terminal answer', status: 'COMPLETED' }));
    const live = [
      withRun(event('TOOL_STRUCTURED_DELTA', 1, { ...productPayload, workflowEventType: 'NODE_OUTPUT_DELTA', content: partial })),
      withRun(event('TOOL_STRUCTURED_DELTA', 2, { ...productPayload, workflowEventType: 'NODE_OUTPUT_DELTA', content: complete })),
      completed,
      terminal,
    ];

    expect(buildProcessEntries(live, i18n.t)).toEqual(buildProcessEntries([completed, terminal], i18n.t));
    expect(buildProcessTimelineEntries(live, i18n.t)).toEqual(buildProcessTimelineEntries([completed, terminal], i18n.t));
  });

  it('keeps show-title-free Workflow DETAIL products isolated by node execution occurrence', () => {
    const productPayload = {
      capabilityId: 'render-result',
      toolCallId: 'workflow:execution-1:render-result',
      workflowEventType: 'NODE_COMPLETED',
      nodeId: 'render-result',
      nodeType: 'DISPLAY',
      toolEventType: 'DETAIL',
      toolMessageType: 'TEXT',
      metadata: { accumulated: true },
    };
    const products = [
      event('TOOL_STRUCTURED_DELTA', 1, {
        ...productPayload,
        nodeExecutionId: 'render-result-attempt-1',
        content: 'first occurrence detail',
      }),
      event('TOOL_STRUCTURED_DELTA', 2, {
        ...productPayload,
        nodeExecutionId: 'render-result-attempt-2',
        content: 'second occurrence detail',
      }),
    ];

    expect(buildProcessEntries(products, i18n.t).map((entry) => entry.detail)).toEqual(['first occurrence detail', 'second occurrence detail']);
    expect(buildProcessTimelineEntries(products, i18n.t).map((entry) => entry.detail)).toEqual([
      'first occurrence detail',
      'second occurrence detail',
    ]);
  });

  it('keeps an ordinary structured ANSWER owned by the answer projection', () => {
    const answer = event('TOOL_STRUCTURED_DELTA', 1, {
      capabilityId: 'network-diagnosis',
      toolCallId: 'tool-call-1',
      toolEventType: 'ANSWER',
      toolMessageType: 'TEXT',
      content: 'ordinary tool answer',
      metadata: { accumulated: true },
    });

    expect(buildProcessEntries([answer], i18n.t)).toEqual([]);
    expect(buildProcessTimelineEntries([answer], i18n.t)).toEqual([]);
  });

  it.each([
    ['DETAIL', 'PIU', { component: 'root-diagnosis', status: 'complete' }],
    ['SUB_DETAIL', 'TEXT', 'nested text detail'],
    ['SUB_DETAIL', 'PIU', { component: 'nested-diagnosis', status: 'complete' }],
    ['SUB_CONCLUSION', 'TEXT', 'nested conclusion'],
  ] as const)('keeps show-title-free Workflow %s %s product visible as a standalone occurrence', (toolEventType, toolMessageType, content) => {
    const product = event('TOOL_STRUCTURED_DELTA', 1, {
      capabilityId: 'render-result',
      toolCallId: 'workflow:child-execution-1:render-result',
      workflowEventType: 'NODE_COMPLETED',
      nodeId: 'render-result',
      nodeType: 'DISPLAY',
      nodeExecutionId: 'render-result-attempt-1',
      toolEventType,
      toolMessageType,
      content,
      metadata: { accumulated: true },
    });

    const processEntries = buildProcessEntries([product], i18n.t);
    const timelineEntries = buildProcessTimelineEntries([product], i18n.t);

    expect(processEntries).toHaveLength(1);
    expect(processEntries[0]).toMatchObject({ title: '', toolEventType });
    expect(processEntries[0]?.structuredSegments).toEqual([
      {
        kind: 'structured',
        toolMessageType,
        content,
        sequence: 1,
      },
    ]);
    expect(timelineEntries).toHaveLength(1);
    expect(timelineEntries[0]).toMatchObject({ title: '', detail: typeof content === 'string' ? content : JSON.stringify(content), toolEventType });
  });

  it('keeps a Workflow structured ANSWER owned by the answer projection', () => {
    const answer = event('TOOL_STRUCTURED_DELTA', 1, {
      capabilityId: 'render-result',
      toolCallId: 'workflow:child-execution-1:render-result',
      workflowEventType: 'NODE_COMPLETED',
      nodeId: 'render-result',
      nodeType: 'DISPLAY',
      nodeExecutionId: 'render-result-attempt-1',
      toolEventType: 'ANSWER',
      toolMessageType: 'PIU',
      content: { component: 'workflow-result', status: 'complete' },
      metadata: { accumulated: true },
    });

    expect(buildProcessEntries([answer], i18n.t)).toEqual([]);
    expect(buildProcessTimelineEntries([answer], i18n.t)).toEqual([]);
  });

  it.each([
    ['TITLE', 'DETAIL'],
    ['SUB_TITLE', 'SUB_DETAIL'],
  ] as const)('associates interleaved Workflow %s/%s products with their explicit node occurrence', (titleEventType, detailEventType) => {
    const product = (sequence: number, nodeId: string, nodeExecutionId: string, toolEventType: string, content: string) =>
      event('TOOL_STRUCTURED_DELTA', sequence, {
        capabilityId: nodeId,
        toolCallId: `workflow:child-execution-1:${nodeId}`,
        workflowEventType: toolEventType === titleEventType ? 'NODE_STARTED' : 'NODE_COMPLETED',
        nodeId,
        nodeType: 'DISPLAY',
        nodeExecutionId,
        toolEventType,
        toolMessageType: 'TEXT',
        content,
        metadata: { accumulated: true },
      });
    const products = [
      product(1, 'node-a', 'node-a-attempt-1', titleEventType, 'Node A'),
      product(2, 'node-b', 'node-b-attempt-1', titleEventType, 'Node B'),
      product(3, 'node-a', 'node-a-attempt-1', detailEventType, 'A detail'),
      product(4, 'node-b', 'node-b-attempt-1', detailEventType, 'B detail'),
    ];
    const visibleShape = (entries: ReadonlyArray<{ readonly title: string; readonly detail: string }>) =>
      entries.map(({ title, detail }) => ({ title, detail }));

    expect(visibleShape(buildProcessEntries(products, i18n.t))).toEqual([
      { title: 'Node A', detail: 'A detail' },
      { title: 'Node B', detail: 'B detail' },
    ]);
    expect(visibleShape(buildProcessTimelineEntries(products, i18n.t))).toEqual([
      { title: 'Node A', detail: 'A detail' },
      { title: 'Node B', detail: 'B detail' },
    ]);
  });

  it('preserves trusted Workflow-as-Tool parent correlation in live and cold process projections', () => {
    const innerProduct = event('TOOL_STRUCTURED_DELTA', 1, {
      capabilityId: 'show-info',
      toolCallId: 'workflow:execution-1:show-info',
      parentToolCallId: 'outer-workflow-1',
      workflowEventType: 'NODE_COMPLETED',
      nodeId: 'show-info',
      nodeType: 'DISPLAY',
      nodeExecutionId: 'show-info-attempt-1',
      toolEventType: 'SUB_TITLE',
      toolMessageType: 'TEXT',
      content: 'Show alarm info',
      metadata: { accumulated: true },
    });
    const outerCompletion = event('CAPABILITY_COMPLETED', 2, {
      capabilityId: 'Workflow',
      toolName: 'Workflow',
      toolCallId: 'outer-workflow-1',
      status: 'SUCCEEDED',
      resultPresentationLevel: 'STATUS_ONLY',
    });
    const live = buildProcessDisplayEntries(buildProcessEntries([innerProduct, outerCompletion], i18n.t), i18n.t);
    const cold = buildProcessDisplayEntries(
      buildProcessEntries(
        [innerProduct, outerCompletion].map((envelope) => ({ ...envelope, transportHints: ['history-load'] })),
        i18n.t,
      ),
      i18n.t,
    );

    expect(live).toEqual(cold);
    expect(live.find((entry) => entry.title === 'Show alarm info')).toMatchObject({ parentToolCallId: 'outer-workflow-1' });
    expect(live.find((entry) => entry.title.startsWith('执行预设流程'))).toMatchObject({ toolCallId: 'outer-workflow-1' });
  });

  it('aggregates Bash task progress and command result into one started-anchored capability card', () => {
    const toolCallId = 'func_1786706995962_6999';
    const entries = buildProcessEntries(
      [
        event('CAPABILITY_STARTED', 25, { capabilityId: 'Bash', toolName: 'Bash', toolCallId }),
        event('TOOL_STRUCTURED_DELTA', 28, {
          capabilityId: 'Bash',
          toolCallId,
          toolEventType: 'SUB_TITLE',
          toolMessageType: 'TEXT',
          content: '任务进展',
          metadata: { accumulated: true },
        }),
        event('TOOL_STRUCTURED_DELTA', 29, {
          capabilityId: 'Bash',
          toolCallId,
          toolEventType: 'SUB_CONCLUSION',
          toolMessageType: 'TEXT',
          content: '查数已接收到任务',
          metadata: { accumulated: true },
        }),
        event('TOOL_STRUCTURED_DELTA', 30, {
          capabilityId: 'Bash',
          toolCallId,
          toolEventType: 'SUB_CONCLUSION',
          toolMessageType: 'TEXT',
          content: '查数已接收到任务\n开始识别分析查询对象',
          metadata: { accumulated: true },
        }),
        event('CAPABILITY_RESULT_DELTA', 30, {
          capabilityId: 'Bash',
          toolName: 'Bash',
          toolCallId,
          safeResult: {
            kind: 'commandOutput',
            exitCode: 0,
            timedOut: false,
            stdoutPreview: 'ordinary command result',
            stderrPreview: '',
            stdoutTruncated: false,
            stderrTruncated: false,
          },
        }),
        event('CAPABILITY_COMPLETED', 31, {
          capabilityId: 'Bash',
          toolName: 'Bash',
          toolCallId,
          status: 'SUCCEEDED',
        }),
      ],
      i18n.t,
    );

    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      toolCallId,
      sequence: 25,
      lastSequence: 31,
      isFinal: true,
      rawDetail: expect.stringContaining('ordinary command result'),
    });
    expect((entries[0] as ProcessEntry & { structuredSections?: readonly ProcessEntry[] }).structuredSections).toEqual([
      expect.objectContaining({
        title: '任务进展',
        rawDetail: '查数已接收到任务\n开始识别分析查询对象',
        sequence: 28,
        lastSequence: 30,
      }),
    ]);
  });

  it('keeps a SUB_TITLE standalone when no matching capability lifecycle exists', () => {
    const entries = buildProcessEntries(
      [
        event('TOOL_STRUCTURED_DELTA', 1, {
          capabilityId: 'custom-display',
          toolCallId: 'standalone-section',
          toolEventType: 'SUB_TITLE',
          toolMessageType: 'TEXT',
          content: '独立进展',
        }),
        event('TOOL_STRUCTURED_DELTA', 2, {
          capabilityId: 'custom-display',
          toolCallId: 'standalone-section',
          toolEventType: 'SUB_DETAIL',
          toolMessageType: 'TEXT',
          content: '没有匹配 Capability lifecycle',
        }),
      ],
      i18n.t,
    );

    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      title: '独立进展',
      detail: '没有匹配 Capability lifecycle',
      toolCallId: 'standalone-section',
    });
    expect(entries[0]?.structuredSections).toBeUndefined();
  });

  it('does not repeat completion stdout after Bash structured progress while retaining terminal command facts', () => {
    const toolCallId = 'bash-structured-completion';
    const entries = buildProcessEntries(
      [
        event('CAPABILITY_STARTED', 1, { capabilityId: 'Bash', toolName: 'Bash', toolCallId }),
        event('TOOL_STRUCTURED_DELTA', 2, {
          capabilityId: 'Bash',
          toolCallId,
          toolEventType: 'SUB_TITLE',
          toolMessageType: 'TEXT',
          content: '任务进展',
        }),
        event('TOOL_STRUCTURED_DELTA', 3, {
          capabilityId: 'Bash',
          toolCallId,
          toolEventType: 'SUB_CONCLUSION',
          toolMessageType: 'TEXT',
          content: '开始识别分析查询对象',
        }),
        event('CAPABILITY_RESULT_DELTA', 3, {
          capabilityId: 'Bash',
          toolName: 'Bash',
          toolCallId,
          content: 'untrusted raw interim result',
        }),
        event('CAPABILITY_COMPLETED', 4, {
          capabilityId: 'Bash',
          toolName: 'Bash',
          toolCallId,
          status: 'FAILED',
          safeResult: {
            kind: 'commandOutput',
            exitCode: 2,
            timedOut: false,
            stdoutPreview: 'structured protocol residue',
            stderrPreview: 'query failed',
            stdoutTruncated: true,
            stderrTruncated: false,
          },
        }),
      ],
      i18n.t,
    );

    expect(entries).toHaveLength(1);
    expect(entries[0]?.isFailure).toBe(true);
    expect(entries[0]?.rawDetail).toContain('2');
    expect(entries[0]?.rawDetail).toContain('query failed');
    expect(entries[0]?.rawDetail).toContain(i18n.t('turn.process.stdoutTruncated'));
    expect(entries[0]?.rawDetail).not.toContain('structured protocol residue');
    expect(entries[0]?.rawDetail).not.toContain('untrusted raw interim result');
    expect(entries[0]?.structuredSections?.[0]).toMatchObject({ title: '任务进展', detail: '开始识别分析查询对象' });
  });

  it('keeps an independent Bash result delta when completion repeats structured stdout', () => {
    const toolCallId = 'bash-independent-result';
    const commandOutput = (stdoutPreview: string) => ({
      kind: 'commandOutput' as const,
      exitCode: 0,
      timedOut: false,
      stdoutPreview,
      stderrPreview: '',
      stdoutTruncated: false,
      stderrTruncated: false,
    });
    const entries = buildProcessEntries(
      [
        event('CAPABILITY_STARTED', 1, { capabilityId: 'Bash', toolName: 'Bash', toolCallId }),
        event('TOOL_STRUCTURED_DELTA', 2, {
          capabilityId: 'Bash',
          toolCallId,
          toolEventType: 'SUB_TITLE',
          toolMessageType: 'TEXT',
          content: '任务进展',
        }),
        event('TOOL_STRUCTURED_DELTA', 3, {
          capabilityId: 'Bash',
          toolCallId,
          toolEventType: 'SUB_CONCLUSION',
          toolMessageType: 'TEXT',
          content: '查询完成',
        }),
        event('CAPABILITY_RESULT_DELTA', 4, {
          capabilityId: 'Bash',
          toolName: 'Bash',
          toolCallId,
          safeResult: commandOutput('ordinary command result'),
        }),
        event('CAPABILITY_COMPLETED', 5, {
          capabilityId: 'Bash',
          toolName: 'Bash',
          toolCallId,
          status: 'SUCCEEDED',
          safeResult: commandOutput('structured protocol residue'),
        }),
      ],
      i18n.t,
    );

    expect(entries).toHaveLength(1);
    expect(entries[0]?.rawDetail).toContain('ordinary command result');
    expect(entries[0]?.rawDetail).not.toContain('structured protocol residue');
  });

  it('removes a residual Workflow detail fragment when the run terminates without a completed product', () => {
    const withRun = (envelope: StreamEnvelope): StreamEnvelope => ({ ...envelope, runId: 'run-1' });
    const fragment = withRun(
      event('TOOL_STRUCTURED_DELTA', 1, {
        capabilityId: 'render-result',
        toolCallId: 'workflow:execution-1:render-result',
        nodeId: 'render-result',
        nodeType: 'DISPLAY',
        toolEventType: 'DETAIL',
        toolMessageType: 'DSL',
        workflowEventType: 'NODE_OUTPUT_DELTA',
        content: '<dsl>partial</dsl>',
        metadata: { accumulated: true },
      }),
    );
    const terminal = withRun(event('REQUEST_COMPLETED', 2, { content: 'terminal answer', status: 'COMPLETED' }));

    expect(buildProcessEntries([fragment, terminal], i18n.t)).toEqual(buildProcessEntries([terminal], i18n.t));
  });

  it('hides untitled non-Capability Workflow lifecycle from started and successful projections', () => {
    const lifecyclePayload = {
      capabilityId: 'active_delay',
      toolCallId: 'workflow:execution-1:active_delay',
      nodeId: 'active_delay',
      nodeType: 'DELAY',
      nodeExecutionId: 'active-delay-attempt-1',
    };
    const started = event('CAPABILITY_STARTED', 1, {
      ...lifecyclePayload,
      workflowEventType: 'NODE_STARTED',
    });
    const completed = event('CAPABILITY_COMPLETED', 2, {
      ...lifecyclePayload,
      workflowEventType: 'NODE_COMPLETED',
      status: 'SUCCEEDED',
      contentUnavailable: true,
    });
    const detail = event('TOOL_STRUCTURED_DELTA', 3, {
      ...lifecyclePayload,
      workflowEventType: 'NODE_COMPLETED',
      toolEventType: 'SUB_DETAIL',
      toolMessageType: 'TEXT',
      content: '等待窗口结束，继续诊断。',
      metadata: { accumulated: true },
    });

    expect(buildProcessEntries([started], i18n.getFixedT('zh-CN'))).toEqual([]);
    expect(buildProcessTimelineEntries([started], i18n.getFixedT('zh-CN'))).toEqual([]);
    expect(buildProcessEntries([started, completed], i18n.getFixedT('zh-CN'))).toEqual([]);
    expect(buildProcessTimelineEntries([started, completed], i18n.getFixedT('zh-CN'))).toEqual([]);

    const settledProcess = buildProcessEntries([started, completed, detail], i18n.getFixedT('zh-CN'));
    const settledTimeline = buildProcessTimelineEntries([started, completed, detail], i18n.getFixedT('zh-CN'));
    expect(settledProcess).toHaveLength(1);
    expect(settledProcess[0]).toMatchObject({ title: '', detail: '等待窗口结束，继续诊断。', toolEventType: 'SUB_DETAIL' });
    expect(buildProcessDisplayEntries(settledProcess, i18n.getFixedT('zh-CN'))[0]?.isExpandable).toBe(false);
    expect(settledTimeline).toHaveLength(1);
    expect(settledTimeline[0]).toMatchObject({ title: '', detail: '等待窗口结束，继续诊断。', toolEventType: 'SUB_DETAIL' });
  });

  it.each(['FAILED', 'TIMED_OUT'] as const)('applies title and detail visibility to untitled Workflow lifecycle when status is %s', (status) => {
    const failed = event('CAPABILITY_COMPLETED', 1, {
      capabilityId: 'active_delay',
      toolCallId: 'workflow:execution-1:active_delay',
      workflowEventType: 'NODE_FAILED',
      nodeId: 'active_delay',
      nodeType: 'DELAY',
      nodeExecutionId: 'active-delay-attempt-1',
      status,
    });
    const detail = event('TOOL_STRUCTURED_DELTA', 2, {
      capabilityId: 'active_delay',
      toolCallId: 'workflow:execution-1:active_delay',
      workflowEventType: 'NODE_COMPLETED',
      nodeId: 'active_delay',
      nodeType: 'DELAY',
      nodeExecutionId: 'active-delay-attempt-1',
      toolEventType: 'SUB_DETAIL',
      toolMessageType: 'TEXT',
      content: '失败 occurrence 的无标题正文不得展示。',
    });
    const liveEvents = [failed, detail];
    const historyEvents = liveEvents.map((envelope) => ({ ...envelope, transportHints: ['history-load'] }) satisfies StreamEnvelope);

    expect(buildProcessEntries([failed], i18n.getFixedT('zh-CN'))).toEqual([]);
    expect(buildProcessTimelineEntries([failed], i18n.getFixedT('zh-CN'))).toEqual([]);
    expect(buildProcessEntries(liveEvents, i18n.getFixedT('zh-CN'))).toEqual([]);
    expect(buildProcessTimelineEntries(liveEvents, i18n.getFixedT('zh-CN'))).toEqual([]);
    expect(buildProcessEntries(historyEvents, i18n.getFixedT('zh-CN'))).toEqual([]);
    expect(buildProcessTimelineEntries(historyEvents, i18n.getFixedT('zh-CN'))).toEqual([]);
  });

  it('preserves a structured Workflow business title when the same node occurrence fails', () => {
    const lifecyclePayload = {
      capabilityId: 'titled_validation_probe',
      toolCallId: 'workflow:execution-1:titled_validation_probe',
      workflowEventType: 'NODE_FAILED',
      nodeId: 'titled_validation_probe',
      nodeType: 'VALIDATION',
      nodeExecutionId: 'titled-validation-attempt-1',
    };
    const structuredTitle = event('TOOL_STRUCTURED_DELTA', 1, {
      ...lifecyclePayload,
      toolEventType: 'TITLE',
      toolMessageType: 'TEXT',
      content: '验证有标题失败状态',
    });
    const structuredDetail = event('TOOL_STRUCTURED_DELTA', 2, {
      ...lifecyclePayload,
      toolEventType: 'DETAIL',
      toolMessageType: 'TEXT',
      content: '校验失败已被安全恢复分支接管。',
    });
    const failed = event('CAPABILITY_COMPLETED', 3, {
      ...lifecyclePayload,
      status: 'FAILED',
      safeSummaryCode: 'WORKFLOW_NODE_INPUT_INVALID',
    });
    const liveEvents = [structuredTitle, structuredDetail, failed];
    const historyEvents = liveEvents.map((envelope) => ({ ...envelope, transportHints: ['history-load'] }) satisfies StreamEnvelope);
    const visibleProcess = (envelopes: readonly StreamEnvelope[]) =>
      buildProcessDisplayEntries(buildProcessEntries(envelopes, i18n.getFixedT('zh-CN')), i18n.getFixedT('zh-CN'));

    expect(visibleProcess(liveEvents)).toEqual(visibleProcess(historyEvents));
    expect(visibleProcess(liveEvents)).toEqual([
      expect.objectContaining({
        title: '验证有标题失败状态 · 已失败',
        detail: '校验失败已被安全恢复分支接管。',
        isFinal: true,
      }),
    ]);
    expect(buildProcessTimelineEntries(liveEvents, i18n.getFixedT('zh-CN'))).toEqual([
      expect.objectContaining({
        title: '验证有标题失败状态',
        detail: '校验失败已被安全恢复分支接管。',
        statusLabel: '已失败',
      }),
    ]);
    const rendered = visibleProcess(liveEvents)
      .flatMap((entry) => [entry.title, entry.summary, entry.detail])
      .join('\n');
    expect(rendered).not.toMatch(/流程步骤|titled_validation_probe|workflow:execution-1|VALIDATION/u);
  });

  it('preserves the actual successful status on a structured Workflow business title', () => {
    const lifecyclePayload = {
      capabilityId: 'titled_sampling_window',
      toolCallId: 'workflow:execution-1:titled_sampling_window',
      nodeId: 'titled_sampling_window',
      nodeType: 'DELAY',
      nodeExecutionId: 'titled-sampling-attempt-1',
    };
    const structuredTitle = event('TOOL_STRUCTURED_DELTA', 1, {
      ...lifecyclePayload,
      workflowEventType: 'NODE_STARTED',
      toolEventType: 'TITLE',
      toolMessageType: 'TEXT',
      content: '等待指标采样窗口',
    });
    const completed = event('CAPABILITY_COMPLETED', 2, {
      ...lifecyclePayload,
      workflowEventType: 'NODE_COMPLETED',
      status: 'SUCCEEDED',
      contentUnavailable: true,
    });
    const structuredDetail = event('TOOL_STRUCTURED_DELTA', 3, {
      ...lifecyclePayload,
      workflowEventType: 'NODE_COMPLETED',
      toolEventType: 'DETAIL',
      toolMessageType: 'TEXT',
      content: '连续三个采样周期数据完整，可以继续关联分析。',
    });
    const visibleProcess = buildProcessDisplayEntries(
      buildProcessEntries([structuredTitle, completed, structuredDetail], i18n.getFixedT('zh-CN')),
      i18n.getFixedT('zh-CN'),
    );

    expect(visibleProcess).toEqual([
      expect.objectContaining({
        title: '等待指标采样窗口 · 已完成',
        detail: '连续三个采样周期数据完整，可以继续关联分析。',
        isFinal: true,
      }),
    ]);
    expect(buildProcessTimelineEntries([structuredTitle, completed, structuredDetail], i18n.getFixedT('zh-CN'))).toEqual([
      expect.objectContaining({ title: '等待指标采样窗口', statusLabel: '已完成' }),
    ]);
  });

  it('keeps structured business titles and legal capability kinds visible beside untitled Workflow lifecycle rules', () => {
    const structuredTitle = event('TOOL_STRUCTURED_DELTA', 2, {
      capabilityId: 'active_delay',
      toolCallId: 'workflow:execution-1:active_delay',
      workflowEventType: 'NODE_STARTED',
      nodeId: 'active_delay',
      nodeType: 'DELAY',
      nodeExecutionId: 'active-delay-attempt-1',
      toolEventType: 'SUB_TITLE',
      toolMessageType: 'TEXT',
      content: '等待网元状态稳定',
    });
    const untitledLifecycle = event('CAPABILITY_STARTED', 1, {
      capabilityId: 'active_delay',
      toolCallId: 'workflow:execution-1:active_delay',
      workflowEventType: 'NODE_STARTED',
      nodeId: 'active_delay',
      nodeType: 'DELAY',
      nodeExecutionId: 'active-delay-attempt-1',
    });
    const capabilityLifecycle = event('CAPABILITY_STARTED', 3, {
      capabilityKind: 'TOOL',
      capabilityId: 'Read',
      toolCallId: 'workflow:execution-1:read-config',
      workflowEventType: 'NODE_STARTED',
      nodeId: 'read-config',
      nodeType: 'TOOL',
      nodeExecutionId: 'read-config-attempt-1',
    });
    const presentationResources = new Map([
      [
        'TOOL:Read',
        {
          capabilityKind: 'TOOL' as const,
          capabilityId: 'Read',
          displayName: 'Read file',
          locales: { language: { 'zh-CN': { displayName: '读取文件' } } },
        },
      ],
    ]);

    expect(buildProcessTimelineEntries([untitledLifecycle, structuredTitle], i18n.getFixedT('zh-CN'))).toEqual([
      expect.objectContaining({ title: '等待网元状态稳定', toolEventType: 'SUB_TITLE' }),
    ]);
    expect(
      buildProcessDisplayEntries(
        buildProcessEntries([capabilityLifecycle], i18n.getFixedT('zh-CN'), presentationResources, 'zh-CN'),
        i18n.getFixedT('zh-CN'),
      )[0]?.title,
    ).toBe('读取文件 · 执行中');
    expect(buildProcessTimelineEntries([capabilityLifecycle], i18n.getFixedT('zh-CN'), presentationResources, 'zh-CN')[0]?.title).toBe('读取文件');
  });
});
