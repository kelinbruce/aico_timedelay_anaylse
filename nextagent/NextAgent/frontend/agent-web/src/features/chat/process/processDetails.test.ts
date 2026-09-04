import { describe, it, expect } from 'vitest';
import type { TFunction } from 'i18next';
import type { StreamEnvelope } from '../../../state/contracts.ts';
import { buildProcessEntries, buildProcessDisplayEntries, buildProcessTimelineEntries, hasPendingSupplementalInput } from './processDetails.ts';
import type { CapabilityPresentationResource } from './capabilityProcessTitle.ts';

const t = ((key: string) => key) as unknown as TFunction;
const businessT = ((key: string, options?: Record<string, unknown>) => {
  const values: Record<string, string> = {
    'turn.process.capability.executeOperation': '执行操作',
    'turn.process.capability.invokeAgent': '调用子智能体',
    'turn.process.capability.invokeAgentNamed': '调用子智能体：{{name}}',
    'turn.process.capability.loadSkill': '加载技能',
    'turn.process.capability.loadSkillNamed': '加载技能：{{name}}',
    'turn.process.capability.runWorkflow': '执行预设流程',
    'turn.process.capability.runWorkflowNamed': '执行预设流程：{{name}}',
    'turn.process.running': '执行中',
    'turn.process.completed': '已完成',
    'turn.process.programCompletedWithOutputSummary': '程序执行完成，返回了输出。',
    'turn.process.exitCodeWithCode': '退出码：{{code}}',
    'turn.process.stdoutLabel': '输出',
    'turn.process.stderrDetailInline': '错误信息：{{message}}',
  };
  return (values[key] ?? key).replace(/{{(\w+)}}/g, (_match, name: string) => String(options?.[name] ?? ''));
}) as unknown as TFunction;

function resources(...entries: readonly CapabilityPresentationResource[]): ReadonlyMap<string, CapabilityPresentationResource> {
  return new Map(entries.map((entry) => [`${entry.capabilityKind}:${entry.capabilityId}`, entry]));
}

const builtinResources = resources(
  { capabilityKind: 'TOOL', capabilityId: 'Read', displayName: 'Read file', locales: { language: { 'zh-CN': { displayName: '读取文件' } } } },
  { capabilityKind: 'TOOL', capabilityId: 'Python', displayName: 'Run program', locales: { language: { 'zh-CN': { displayName: '执行程序' } } } },
  {
    capabilityKind: 'WORKFLOW',
    capabilityId: 'alarm-recovery',
    displayName: 'Alarm recovery',
    locales: { language: { 'zh-CN': { displayName: '告警恢复' } } },
  },
);

function makeStructuredEnvelope(
  sequence: number,
  eventId: string,
  toolEventType: string,
  toolMessageType: string,
  content: unknown,
  toolCallId: string | null = 'test-call',
): StreamEnvelope {
  return {
    eventId,
    sessionId: 'test-session',
    requestId: 'test-request',
    runId: 'test-run',
    rootMessageId: 'test-root',
    requestContextId: 'test-context',
    sequence,
    eventType: 'TOOL_STRUCTURED_DELTA',
    timelineEventRef: null,
    transportHints: [],
    payload: {
      contentType: 'PLAIN_TEXT',
      content: content as never,
      text: '',
      role: 'CAPABILITY_RESULT',
      messageId: `msg-${sequence}`,
      runId: 'test-run',
      rootMessageId: 'test-root',
      requestContextId: 'test-context',
      visible: true,
      toolEventType: toolEventType as never,
      toolMessageType: toolMessageType as never,
      ...(toolCallId === null ? {} : { toolCallId, capabilityId: 'test-cap' }),
    },
    createdAt: 1783346000000,
  } as StreamEnvelope;
}

function makeSupplementalInputEnvelope(
  sequence: number,
  eventType: 'USER_INPUT_REQUIRED' | 'USER_INPUT_RECEIVED' | 'USER_INPUT_TIMEOUT' | 'USER_INPUT_CANCELED',
  pendingInputId: string,
  overrides: Partial<StreamEnvelope> = {},
): StreamEnvelope {
  return {
    eventId: `supplemental-${sequence}`,
    sessionId: 'test-session',
    requestId: 'test-request',
    runId: 'test-run',
    rootMessageId: 'test-root',
    requestContextId: 'test-context',
    sequence,
    eventType,
    timelineEventRef: null,
    transportHints: [],
    payload: {
      kind: 'QUESTION',
      pendingInputId,
    },
    createdAt: 1783346000000 + sequence,
    ...overrides,
  } as StreamEnvelope;
}

function makeCapabilityResultEnvelope(sequence: number, payload: Record<string, unknown>): StreamEnvelope {
  return {
    eventId: `capability-result-${sequence}`,
    sessionId: 'test-session',
    requestId: 'test-request',
    runId: 'test-run',
    rootMessageId: 'test-root',
    requestContextId: 'test-context',
    sequence,
    eventType: 'CAPABILITY_RESULT_DELTA',
    timelineEventRef: `timeline-result-${sequence}`,
    transportHints: [],
    payload: {
      capabilityId: 'Read',
      toolCallId: `call-${sequence}`,
      status: 'SUCCEEDED',
      content: '',
      text: '',
      ...payload,
    },
    createdAt: 1783346000000 + sequence,
  } as StreamEnvelope;
}

function makeCapabilityLifecycleEnvelope(
  sequence: number,
  eventType: 'CAPABILITY_STARTED' | 'CAPABILITY_RESULT_DELTA' | 'CAPABILITY_COMPLETED',
  payload: Record<string, unknown> = {},
): StreamEnvelope {
  return {
    eventId: `capability-lifecycle-${sequence}`,
    sessionId: 'test-session',
    requestId: 'test-request',
    runId: 'test-run',
    rootMessageId: 'test-root',
    requestContextId: 'test-context',
    sequence,
    eventType,
    timelineEventRef: `timeline-lifecycle-${sequence}`,
    transportHints: [],
    payload: {
      capabilityId: 'CustomNetworkProbe',
      toolName: 'CustomNetworkProbe',
      toolCallId: 'call-status-only',
      status: eventType === 'CAPABILITY_COMPLETED' ? 'COMPLETED' : 'SUCCEEDED',
      content: '',
      text: '',
      ...payload,
    },
    createdAt: 1783346000000 + sequence,
  } as StreamEnvelope;
}

describe('Capability result presentation levels', () => {
  it('applies the same configured Tool title without changing lifecycle structure', () => {
    const events = [
      makeCapabilityLifecycleEnvelope(1, 'CAPABILITY_STARTED', {
        capabilityKind: 'TOOL',
        capabilityId: 'CustomNetworkProbe',
        toolCallId: 'call-configured-probe',
        status: 'RUNNING',
      }),
      makeCapabilityLifecycleEnvelope(2, 'CAPABILITY_COMPLETED', {
        capabilityKind: 'TOOL',
        capabilityId: 'CustomNetworkProbe',
        toolCallId: 'call-configured-probe',
        status: 'SUCCEEDED',
      }),
    ];

    const baseline = buildProcessEntries(events, businessT);
    const configured = buildProcessEntries(
      events,
      businessT,
      resources({ capabilityKind: 'TOOL', capabilityId: 'CustomNetworkProbe', displayName: '产品网络探针' }),
      'zh-CN',
    );

    expect(configured[0]?.title).toBe('产品网络探针 · 已完成');
    expect(configured.map(({ title: _title, ...entry }) => entry)).toEqual(baseline.map(({ title: _title, ...entry }) => entry));
  });

  it('uses the configured wrapper title in the full process timeline', () => {
    const entries = buildProcessTimelineEntries(
      [
        makeCapabilityLifecycleEnvelope(1, 'CAPABILITY_STARTED', {
          capabilityKind: 'TOOL',
          capabilityId: 'Skill',
          targetCapabilityId: 'network-diagnosis',
          toolCallId: 'call-configured-skill',
        }),
      ],
      businessT,
      resources({ capabilityKind: 'SKILL', capabilityId: 'network-diagnosis', displayName: '产品网络诊断技能' }),
      'zh-CN',
    );

    expect(entries[0]?.title).toBe('加载技能：产品网络诊断技能');
  });

  it('uses the configured Tool title for a history result delta without a started event', () => {
    const entries = buildProcessTimelineEntries(
      [
        makeCapabilityLifecycleEnvelope(1, 'CAPABILITY_RESULT_DELTA', {
          capabilityKind: 'TOOL',
          capabilityId: 'CustomNetworkProbe',
          toolCallId: 'call-configured-delta-only',
          content: 'bounded probe output',
          text: 'bounded probe output',
        }),
      ],
      businessT,
      resources({ capabilityKind: 'TOOL', capabilityId: 'CustomNetworkProbe', displayName: '产品网络探针' }),
      'zh-CN',
    );

    expect(entries[0]?.title).toBe('产品网络探针');
  });
  it('uses one business title across started, delta, and completed without duplicating status', () => {
    const entry = buildProcessEntries(
      [
        makeCapabilityLifecycleEnvelope(1, 'CAPABILITY_STARTED', {
          capabilityKind: 'TOOL',
          capabilityId: 'Read',
          toolCallId: 'call-read-title',
          status: 'RUNNING',
        }),
        makeCapabilityLifecycleEnvelope(2, 'CAPABILITY_RESULT_DELTA', {
          capabilityId: 'Read',
          toolCallId: 'call-read-title',
          resultPresentationLevel: 'SUMMARY',
        }),
        makeCapabilityLifecycleEnvelope(3, 'CAPABILITY_COMPLETED', {
          capabilityKind: 'TOOL',
          capabilityId: 'Read',
          toolCallId: 'call-read-title',
          status: 'SUCCEEDED',
          resultPresentationLevel: 'SUMMARY',
        }),
      ],
      businessT,
      builtinResources,
      'zh-CN',
    )[0];

    expect(entry?.title).toBe('读取文件 · 已完成');
    expect(entry?.title.match(/已完成/g)).toHaveLength(1);
    expect(entry?.summary).toBeUndefined();
    expect(entry?.detail).toBe('');
  });

  it('keeps a wrapper target title across an identity-free result delta', () => {
    const entry = buildProcessEntries(
      [
        makeCapabilityLifecycleEnvelope(1, 'CAPABILITY_STARTED', {
          capabilityKind: 'TOOL',
          capabilityId: 'Skill',
          targetCapabilityId: 'network-diagnosis',
          toolCallId: 'call-skill-title',
          status: 'RUNNING',
        }),
        makeCapabilityLifecycleEnvelope(2, 'CAPABILITY_RESULT_DELTA', {
          capabilityId: 'Skill',
          toolCallId: 'call-skill-title',
        }),
        makeCapabilityLifecycleEnvelope(3, 'CAPABILITY_COMPLETED', {
          capabilityKind: 'TOOL',
          capabilityId: 'Skill',
          targetCapabilityId: 'network-diagnosis',
          toolCallId: 'call-skill-title',
          status: 'SUCCEEDED',
        }),
      ],
      businessT,
      builtinResources,
      'zh-CN',
    )[0];

    expect(entry?.title).toBe('加载技能：network-diagnosis · 已完成');
  });

  it('keeps an outer Workflow fallback separate from its mapped nested Workflow title', () => {
    const entries = buildProcessEntries(
      [
        makeCapabilityLifecycleEnvelope(1, 'CAPABILITY_STARTED', {
          capabilityKind: 'TOOL',
          capabilityId: 'Workflow',
          targetCapabilityId: 'workflow-title-mapped-test',
          toolCallId: 'call-workflow-outer',
        }),
        makeCapabilityLifecycleEnvelope(2, 'CAPABILITY_STARTED', {
          capabilityKind: 'WORKFLOW',
          capabilityId: 'alarm-recovery',
          toolCallId: 'call-workflow-child',
          parentToolCallId: 'call-workflow-outer',
        }),
        makeCapabilityLifecycleEnvelope(3, 'CAPABILITY_COMPLETED', {
          capabilityKind: 'WORKFLOW',
          capabilityId: 'alarm-recovery',
          toolCallId: 'call-workflow-child',
          parentToolCallId: 'call-workflow-outer',
          status: 'SUCCEEDED',
        }),
        makeCapabilityLifecycleEnvelope(4, 'CAPABILITY_COMPLETED', {
          capabilityKind: 'TOOL',
          capabilityId: 'Workflow',
          targetCapabilityId: 'workflow-title-mapped-test',
          toolCallId: 'call-workflow-outer',
          status: 'SUCCEEDED',
        }),
      ],
      businessT,
      builtinResources,
      'zh-CN',
    );

    expect(entries.map((entry) => entry.title)).toEqual(['执行预设流程：workflow-title-mapped-test · 已完成', '执行预设流程：告警恢复 · 已完成']);
    expect(entries[1]).toMatchObject({
      toolCallId: 'call-workflow-child',
      parentToolCallId: 'call-workflow-outer',
    });
  });

  it('keeps a successful status-only capability as a lifecycle step without a browser-authored summary', () => {
    const statusOnly = buildProcessEntries(
      [
        makeCapabilityLifecycleEnvelope(1, 'CAPABILITY_STARTED'),
        makeCapabilityLifecycleEnvelope(2, 'CAPABILITY_RESULT_DELTA'),
        makeCapabilityLifecycleEnvelope(3, 'CAPABILITY_COMPLETED', {
          message: 'CustomNetworkProbe completed',
        }),
      ],
      t,
    )[0];

    expect(statusOnly?.toolName).toBe('CustomNetworkProbe');
    expect(statusOnly?.summary).toBeUndefined();
    expect(statusOnly?.detail).toBe('');
    expect(statusOnly?.isExpandable).toBe(false);
  });

  it('renders recognized detail without trusting a raw compatibility summary', () => {
    const summary = buildProcessEntries([makeCapabilityResultEnvelope(2, { safeSummary: 'Read alarm evidence.' })], t)[0];
    const detail = buildProcessEntries(
      [
        makeCapabilityResultEnvelope(3, {
          safeSummary: 'Read alarm evidence.',
          safeResult: {
            kind: 'fileRead',
            filePath: 'workspace/alarm.log',
            contentPreview: 'bounded alarm evidence',
            truncated: false,
          },
        }),
      ],
      t,
    )[0];

    expect(summary?.summary).toBeUndefined();
    expect(summary?.isExpandable).toBe(false);
    expect(summary?.detail).not.toContain('bounded alarm evidence');
    expect(detail?.summary).toBe('turn.process.fileReadSummary');
    expect(detail?.detail).toContain('bounded alarm evidence');
    expect(detail?.isExpandable).toBe(true);
  });

  it('preserves capability entry count, order, correlation, and expansion behavior', () => {
    const events = [
      makeCapabilityLifecycleEnvelope(1, 'CAPABILITY_STARTED', {
        capabilityId: 'CustomNetworkProbe',
        toolName: 'CustomNetworkProbe',
        toolCallId: 'call-probe',
      }),
      makeCapabilityLifecycleEnvelope(2, 'CAPABILITY_RESULT_DELTA', {
        capabilityId: 'CustomNetworkProbe',
        toolName: 'CustomNetworkProbe',
        toolCallId: 'call-probe',
        resultPresentationLevel: 'SUMMARY',
        safeSummary: 'Probe completed.',
      }),
      makeCapabilityLifecycleEnvelope(3, 'CAPABILITY_COMPLETED', {
        capabilityId: 'CustomNetworkProbe',
        toolName: 'CustomNetworkProbe',
        toolCallId: 'call-probe',
        resultPresentationLevel: 'SUMMARY',
      }),
      makeCapabilityLifecycleEnvelope(4, 'CAPABILITY_STARTED', {
        capabilityId: 'Read',
        toolName: 'Read',
        toolCallId: 'call-read',
      }),
      makeCapabilityLifecycleEnvelope(5, 'CAPABILITY_RESULT_DELTA', {
        capabilityId: 'Read',
        toolName: 'Read',
        toolCallId: 'call-read',
        resultPresentationLevel: 'DETAIL',
        safeResult: {
          kind: 'fileRead',
          filePath: 'workspace/alarm.log',
          contentPreview: 'bounded alarm evidence',
          truncated: false,
        },
      }),
      makeCapabilityLifecycleEnvelope(6, 'CAPABILITY_COMPLETED', {
        capabilityId: 'Read',
        toolName: 'Read',
        toolCallId: 'call-read',
        resultPresentationLevel: 'DETAIL',
      }),
    ];

    const entries = buildProcessEntries(events, t);

    expect(entries).toHaveLength(2);
    expect(entries.map((entry) => entry.toolName)).toEqual(['CustomNetworkProbe', 'Read']);
    expect(entries.map((entry) => entry.key)).toEqual(['call-probe', 'call-read']);
    expect(entries[0]).toMatchObject({ isExpandable: false, isFinal: true });
    expect(entries[0]?.summary).toBeUndefined();
    expect(entries[1]).toMatchObject({ isExpandable: true, isFinal: true });
    expect(entries[1]?.detail).toContain('bounded alarm evidence');
  });

  it('keeps failure summaries visible without a result detail', () => {
    const failure = buildProcessEntries(
      [
        makeCapabilityResultEnvelope(1, {
          status: 'FAILED',
          safeErrorCode: 'CAPABILITY_INPUT_INVALID',
          safeErrorCategory: 'VALIDATION',
          safeSummaryCode: 'CAPABILITY_RESULT_FAILURE_INVALID_INPUT',
          safeSummaryArgs: {},
          safeSummary: 'Tool input is invalid, so the capability was not executed.',
        }),
      ],
      t,
    )[0];

    expect(failure?.summary).toBe('turn.capabilityFailure.reason.invalidInput');
    expect(failure?.title).toBe('Read · turn.capabilityFailure.status.unableToRun');
    expect(failure?.detail).toContain('turn.process.errorCodeWithCode');
    expect(failure?.detail).not.toContain('Tool input is invalid');
    expect(failure?.detail).not.toContain('safeResult');
  });

  it('keeps Python DETAIL evidence unchanged while localizing only platform labels', () => {
    const entry = buildProcessEntries(
      [
        makeCapabilityResultEnvelope(1, {
          capabilityKind: 'TOOL',
          capabilityId: 'Python',
          toolName: 'Python',
          resultPresentationLevel: 'DETAIL',
          safeResult: {
            kind: 'commandOutput',
            exitCode: 0,
            stdoutPreview: 'CELL_OK 42ms',
            stderrPreview: '',
            stdoutTruncated: false,
            stderrTruncated: false,
          },
        }),
      ],
      businessT,
      builtinResources,
      'zh-CN',
    )[0];

    expect(entry?.title).toBe('执行程序 · 已完成');
    expect(entry?.summary).toBe('');
    expect(entry?.detail).toBe('退出码：0\n输出:\nCELL_OK 42ms');
    expect(entry?.detail).not.toMatch(/script|脚本|code|参数|argument/iu);
  });

  it('keeps recognized command detail expandable when its success summary is intentionally empty', () => {
    const entry = buildProcessEntries(
      [
        makeCapabilityResultEnvelope(2, {
          capabilityId: 'Bash',
          safeSummaryCode: 'CAPABILITY_RESULT_COMMAND_SUCCEEDED_WITH_OUTPUT',
          safeSummaryArgs: { exitCode: 0 },
          text: '退出码：0\n输出:\nREADY',
          content: '退出码：0\n输出:\nREADY',
        }),
      ],
      t,
    )[0];

    expect(entry?.summary).toBe('');
    expect(entry?.rawDetail).toBe('退出码：0\n输出:\nREADY');
    expect(entry?.isExpandable).toBe(true);
  });

  it('does not expose raw detail for an unknown summary descriptor', () => {
    const entry = buildProcessEntries(
      [
        makeCapabilityResultEnvelope(3, {
          capabilityId: 'CustomNetworkProbe',
          safeSummaryCode: 'CAPABILITY_RESULT_UNKNOWN',
          safeSummaryArgs: {},
          text: 'RAW_DETAIL_MUST_NOT_RENDER',
          content: 'RAW_DETAIL_MUST_NOT_RENDER',
        }),
      ],
      t,
    )[0];

    expect(entry?.summary).toBeUndefined();
    expect(entry?.detail).toBe('');
    expect(entry?.rawDetail).toBe('');
    expect(entry?.isExpandable).toBe(false);
  });
});

describe('AskUserQuestion generic tool row suppression', () => {
  it('does not produce a generic tool row when CAPABILITY_STARTED precedes the AskUserQuestion lifecycle', () => {
    const events = [
      makeCapabilityLifecycleEnvelope(1, 'CAPABILITY_STARTED', {
        capabilityId: 'AskUserQuestion',
        toolName: 'AskUserQuestion',
        toolCallId: 'call-aq-1',
        status: 'RUNNING',
      }),
      makeCapabilityLifecycleEnvelope(2, 'CAPABILITY_COMPLETED', {
        capabilityId: 'AskUserQuestion',
        toolName: 'AskUserQuestion',
        toolCallId: 'call-aq-1',
        status: 'SUCCEEDED',
      }),
    ];

    const entries = buildProcessEntries(events, t);
    expect(entries.filter((entry) => entry.toolName === 'AskUserQuestion')).toHaveLength(0);
  });

  it('does not produce a generic tool row for AskUserQuestion CAPABILITY_RESULT_DELTA without CAPABILITY_STARTED (history path)', () => {
    const events = [
      makeCapabilityLifecycleEnvelope(1, 'CAPABILITY_RESULT_DELTA', {
        capabilityId: 'AskUserQuestion',
        toolName: 'AskUserQuestion',
        toolCallId: 'call-aq-2',
        status: 'SUCCEEDED',
        kind: 'QUESTION',
        safeSummary: 'User answered the question.',
      }),
      makeCapabilityLifecycleEnvelope(2, 'CAPABILITY_COMPLETED', {
        capabilityId: 'AskUserQuestion',
        toolName: 'AskUserQuestion',
        toolCallId: 'call-aq-2',
        status: 'SUCCEEDED',
      }),
    ];

    const entries = buildProcessEntries(events, t);
    expect(entries.filter((entry) => entry.toolName === 'AskUserQuestion')).toHaveLength(0);
  });

  it('does not produce a timeline entry for AskUserQuestion without CAPABILITY_STARTED (history path)', () => {
    const events = [
      makeCapabilityLifecycleEnvelope(1, 'CAPABILITY_RESULT_DELTA', {
        capabilityId: 'AskUserQuestion',
        toolName: 'AskUserQuestion',
        toolCallId: 'call-aq-3',
        status: 'SUCCEEDED',
        kind: 'QUESTION',
        safeSummary: 'User answered the question.',
      }),
    ];

    const entries = buildProcessTimelineEntries(events, t);
    expect(entries.filter((entry) => entry.kind === 'tool' && entry.correlationId === 'call-aq-3')).toHaveLength(0);
  });
});

describe('hasPendingSupplementalInput', () => {
  it('reports a question request as pending until its matching receipt arrives', () => {
    const required = makeSupplementalInputEnvelope(1, 'USER_INPUT_REQUIRED', 'pending-1');

    expect(hasPendingSupplementalInput([required])).toBe(true);
    expect(hasPendingSupplementalInput([required, makeSupplementalInputEnvelope(2, 'USER_INPUT_RECEIVED', 'pending-1')])).toBe(false);
  });

  it('treats a matching durable answer projection as resolved without the live receipt', () => {
    const required = makeSupplementalInputEnvelope(1, 'USER_INPUT_REQUIRED', 'pending-1');
    const answer = {
      ...makeStructuredEnvelope(2, 'answer-2', 'RESULT', 'TEXT', ''),
      eventType: 'CAPABILITY_RESULT_DELTA',
      payload: {
        capabilityId: 'AskUserQuestion',
        toolCallId: 'tool-call-1',
        pendingInputId: 'pending-1',
        kind: 'QUESTION',
        status: 'RECEIVED',
        safeResult: {
          kind: 'pendingInputAnswer',
          answers: [['核心网']],
          truncated: false,
        },
      },
    } as StreamEnvelope;

    expect(hasPendingSupplementalInput([required, answer])).toBe(false);
  });

  it('does not let a receipt for another request or run clear the pending question', () => {
    const required = makeSupplementalInputEnvelope(1, 'USER_INPUT_REQUIRED', 'pending-1');

    expect(
      hasPendingSupplementalInput([
        required,
        makeSupplementalInputEnvelope(2, 'USER_INPUT_RECEIVED', 'pending-2'),
        makeSupplementalInputEnvelope(3, 'USER_INPUT_RECEIVED', 'pending-1', {
          runId: 'another-run',
        }),
      ]),
    ).toBe(true);
  });

  it('preserves composed presentation order when history ordinals differ from timeline sequences', () => {
    const required = makeSupplementalInputEnvelope(200, 'USER_INPUT_REQUIRED', 'pending-1');
    const durableAnswer = {
      ...makeStructuredEnvelope(1, 'answer-history-1', 'RESULT', 'TEXT', ''),
      eventType: 'CAPABILITY_RESULT_DELTA',
      payload: {
        capabilityId: 'AskUserQuestion',
        toolCallId: 'tool-call-1',
        pendingInputId: 'pending-1',
        kind: 'QUESTION',
        status: 'RECEIVED',
        safeResult: {
          kind: 'pendingInputAnswer',
          answers: [['核心网']],
          truncated: false,
        },
      },
    } as StreamEnvelope;

    expect(hasPendingSupplementalInput([required, durableAnswer])).toBe(false);
  });

  it('clears pending state after a matching timeout or cancellation outcome', () => {
    const required = makeSupplementalInputEnvelope(1, 'USER_INPUT_REQUIRED', 'pending-1');

    for (const eventType of ['USER_INPUT_TIMEOUT', 'USER_INPUT_CANCELED'] as const) {
      const events = [required, makeSupplementalInputEnvelope(2, eventType, 'pending-1')];
      const supplementalEntry = buildProcessEntries(events, t).find((entry) => entry.key.startsWith('pending-input:'));

      expect(hasPendingSupplementalInput(events)).toBe(false);
      expect(supplementalEntry?.title).toBe('turn.process.supplementalInputTitle');
      expect(supplementalEntry?.isFinal).toBe(true);
    }
  });

  it('ignores malformed or non-question status events', () => {
    const missingId = makeSupplementalInputEnvelope(1, 'USER_INPUT_REQUIRED', 'pending-1', {
      payload: { kind: 'QUESTION' },
    });
    const unrelatedKind = makeSupplementalInputEnvelope(2, 'USER_INPUT_REQUIRED', 'pending-2', {
      payload: { kind: 'APPROVAL', pendingInputId: 'pending-2' },
    });

    expect(hasPendingSupplementalInput([missingId, unrelatedKind])).toBe(false);
  });
});

describe('buildProcessEntries EXPAND_PANEL handling', () => {
  it('attaches EXPAND_PANEL data to last TITLE entry', () => {
    const events: StreamEnvelope[] = [
      makeStructuredEnvelope(1, 'evt-1', 'TITLE', 'TEXT', 'Network Diagnosis'),
      makeStructuredEnvelope(2, 'evt-2', 'DETAIL', 'TEXT', 'Checking link status'),
      makeStructuredEnvelope(3, 'evt-3', 'EXPAND_PANEL', 'TEXT', 'Full diagnostic report content'),
    ];
    const entries = buildProcessEntries(events, t);
    const titleEntry = entries.find((e) => e.toolEventType === 'TITLE');
    expect(titleEntry).toBeDefined();
    expect(titleEntry!.hasExpandPanel).toBe(true);
    expect(titleEntry!.expandPanelData).toEqual({
      toolMessageType: 'TEXT',
      content: 'Full diagnostic report content',
    });
  });

  it('ignores EXPAND_PANEL when no preceding TITLE', () => {
    const events: StreamEnvelope[] = [makeStructuredEnvelope(1, 'evt-1', 'EXPAND_PANEL', 'TEXT', 'Orphan expand panel')];
    const entries = buildProcessEntries(events, t);
    const expandEntries = entries.filter((e) => e.hasExpandPanel === true);
    expect(expandEntries).toHaveLength(0);
  });

  it('last-write-wins for multiple EXPAND_PANEL in same TITLE scope', () => {
    const events: StreamEnvelope[] = [
      makeStructuredEnvelope(1, 'evt-1', 'TITLE', 'TEXT', 'Diagnosis'),
      makeStructuredEnvelope(2, 'evt-2', 'EXPAND_PANEL', 'TEXT', 'First report'),
      makeStructuredEnvelope(3, 'evt-3', 'EXPAND_PANEL', 'PIU', { piuName: 'report' }),
    ];
    const entries = buildProcessEntries(events, t);
    const titleEntry = entries.find((e) => e.toolEventType === 'TITLE');
    expect(titleEntry!.expandPanelData?.toolMessageType).toBe('PIU');
    expect(titleEntry!.expandPanelData?.content).toEqual({ piuName: 'report' });
  });

  it('does not create independent process entry for EXPAND_PANEL', () => {
    const events: StreamEnvelope[] = [
      makeStructuredEnvelope(1, 'evt-1', 'TITLE', 'TEXT', 'Diagnosis'),
      makeStructuredEnvelope(2, 'evt-2', 'EXPAND_PANEL', 'TEXT', 'Report'),
    ];
    const entries = buildProcessEntries(events, t);
    expect(entries).toHaveLength(1);
    expect(entries[0]!.toolEventType).toBe('TITLE');
  });

  it('passes expandPanelData through buildProcessDisplayEntries', () => {
    const events: StreamEnvelope[] = [
      makeStructuredEnvelope(1, 'evt-1', 'TITLE', 'TEXT', 'Diagnosis'),
      makeStructuredEnvelope(2, 'evt-2', 'EXPAND_PANEL', 'TEXT', 'Report content'),
    ];
    const entries = buildProcessEntries(events, t);
    const displayEntries = buildProcessDisplayEntries(entries, t);
    const titleEntry = displayEntries.find((e) => e.toolEventType === 'TITLE');
    expect(titleEntry!.hasExpandPanel).toBe(true);
    expect(titleEntry!.expandPanelData).toEqual({
      toolMessageType: 'TEXT',
      content: 'Report content',
    });
  });
});

describe('buildProcessEntries streaming TEXT concatenation', () => {
  it('creates standalone entry for DETAIL without preceding TITLE', () => {
    const events: StreamEnvelope[] = [makeStructuredEnvelope(1, 'evt-1', 'DETAIL', 'TEXT', 'Standalone detail content')];
    const entries = buildProcessEntries(events, t);
    const detailEntry = entries.find((e) => e.toolEventType === 'DETAIL');
    expect(detailEntry).toBeDefined();
    expect(detailEntry!.title).toBe('');
    expect(detailEntry!.detail).toBe('Standalone detail content');
  });

  it('attaches subsequent DETAIL to standalone entry when no TITLE', () => {
    const events: StreamEnvelope[] = [
      makeStructuredEnvelope(1, 'evt-1', 'DETAIL', 'TEXT', 'First detail'),
      makeStructuredEnvelope(2, 'evt-2', 'DETAIL', 'TEXT', ' continued'),
    ];
    const entries = buildProcessEntries(events, t);
    const detailEntries = entries.filter((e) => e.toolEventType === 'DETAIL');
    expect(detailEntries).toHaveLength(1);
    expect(detailEntries[0]!.detail).toBe('First detail continued');
  });

  it('concatenates DETAIL TEXT fragments without newline separator', () => {
    const events: StreamEnvelope[] = [
      makeStructuredEnvelope(1, 'evt-1', 'TITLE', 'TEXT', 'Diagnosis'),
      makeStructuredEnvelope(2, 'evt-2', 'DETAIL', 'TEXT', 'Link status: '),
      makeStructuredEnvelope(3, 'evt-3', 'DETAIL', 'TEXT', 'UP'),
    ];
    const entries = buildProcessEntries(events, t);
    const titleEntry = entries.find((e) => e.toolEventType === 'TITLE');
    expect(titleEntry!.detail).toBe('Link status: UP');
  });

  it('stores non-TEXT DETAIL fragments in structuredSegments, not in detail string', () => {
    const events: StreamEnvelope[] = [
      makeStructuredEnvelope(1, 'evt-1', 'TITLE', 'TEXT', 'Diagnosis'),
      makeStructuredEnvelope(2, 'evt-2', 'DETAIL', 'DSL', 'chart-1'),
      makeStructuredEnvelope(3, 'evt-3', 'DETAIL', 'DSL', 'chart-2'),
    ];
    const entries = buildProcessEntries(events, t);
    const titleEntry = entries.find((e) => e.toolEventType === 'TITLE');
    // Non-TEXT content MUST NOT enter the detail string
    expect(titleEntry!.detail).toBe('');
    // Each non-TEXT event becomes an independent structured segment stacked in order
    expect(titleEntry!.structuredSegments).toHaveLength(2);
    expect(titleEntry!.structuredSegments![0]).toMatchObject({ kind: 'structured', toolMessageType: 'DSL', content: 'chart-1' });
    expect(titleEntry!.structuredSegments![1]).toMatchObject({ kind: 'structured', toolMessageType: 'DSL', content: 'chart-2' });
  });

  it('concatenates SUB_DETAIL TEXT fragments without newline separator', () => {
    const events: StreamEnvelope[] = [
      makeStructuredEnvelope(1, 'evt-1', 'TITLE', 'TEXT', 'Diagnosis'),
      makeStructuredEnvelope(2, 'evt-2', 'SUB_TITLE', 'TEXT', 'SubDiagnosis'),
      makeStructuredEnvelope(3, 'evt-3', 'SUB_DETAIL', 'TEXT', 'Signal: '),
      makeStructuredEnvelope(4, 'evt-4', 'SUB_DETAIL', 'TEXT', 'strong'),
    ];
    const entries = buildProcessEntries(events, t);
    const subTitleEntry = entries.find((e) => e.toolEventType === 'SUB_TITLE');
    expect(subTitleEntry!.detail).toBe('Signal: strong');
  });

  it('concatenates SUB_CONCLUSION TEXT fragments without newline separator', () => {
    const events: StreamEnvelope[] = [
      makeStructuredEnvelope(1, 'evt-1', 'TITLE', 'TEXT', 'Diagnosis'),
      makeStructuredEnvelope(2, 'evt-2', 'SUB_TITLE', 'TEXT', 'SubDiagnosis'),
      makeStructuredEnvelope(3, 'evt-3', 'SUB_CONCLUSION', 'TEXT', 'Result: '),
      makeStructuredEnvelope(4, 'evt-4', 'SUB_CONCLUSION', 'TEXT', 'pass'),
    ];
    const entries = buildProcessEntries(events, t);
    const subTitleEntry = entries.find((e) => e.toolEventType === 'SUB_TITLE');
    expect(subTitleEntry!.detail).toBe('Result: pass');
  });

  it('accumulates EXPAND_PANEL TEXT fragments instead of replacing', () => {
    const events: StreamEnvelope[] = [
      makeStructuredEnvelope(1, 'evt-1', 'TITLE', 'TEXT', 'Diagnosis'),
      makeStructuredEnvelope(2, 'evt-2', 'EXPAND_PANEL', 'TEXT', 'Full report part 1. '),
      makeStructuredEnvelope(3, 'evt-3', 'EXPAND_PANEL', 'TEXT', 'Full report part 2.'),
    ];
    const entries = buildProcessEntries(events, t);
    const titleEntry = entries.find((e) => e.toolEventType === 'TITLE');
    expect(titleEntry!.hasExpandPanel).toBe(true);
    expect(titleEntry!.expandPanelData).toEqual({
      toolMessageType: 'TEXT',
      content: 'Full report part 1. Full report part 2.',
    });
  });

  it('replaces EXPAND_PANEL content when message type changes from TEXT to non-TEXT', () => {
    const events: StreamEnvelope[] = [
      makeStructuredEnvelope(1, 'evt-1', 'TITLE', 'TEXT', 'Diagnosis'),
      makeStructuredEnvelope(2, 'evt-2', 'EXPAND_PANEL', 'TEXT', 'Text content'),
      makeStructuredEnvelope(3, 'evt-3', 'EXPAND_PANEL', 'PIU', { piuName: 'report' }),
    ];
    const entries = buildProcessEntries(events, t);
    const titleEntry = entries.find((e) => e.toolEventType === 'TITLE');
    expect(titleEntry!.expandPanelData?.toolMessageType).toBe('PIU');
    expect(titleEntry!.expandPanelData?.content).toEqual({ piuName: 'report' });
  });

  it('TEXT DETAIL enters both detail string and structuredSegments', () => {
    const events: StreamEnvelope[] = [
      makeStructuredEnvelope(1, 'evt-1', 'TITLE', 'TEXT', 'Diagnosis'),
      makeStructuredEnvelope(2, 'evt-2', 'DETAIL', 'TEXT', 'chart-1\n'),
    ];
    const entries = buildProcessEntries(events, t);
    const titleEntry = entries.find((e) => e.toolEventType === 'TITLE');
    expect(titleEntry!.detail).toBe('chart-1\n');
    expect(titleEntry!.structuredSegments).toHaveLength(1);
    expect(titleEntry!.structuredSegments![0]).toMatchObject({ kind: 'structured', toolMessageType: 'TEXT', content: 'chart-1\n' });
  });

  it('mixed TEXT and non-TEXT DETAIL accumulate in order with TEXT-only detail', () => {
    const events: StreamEnvelope[] = [
      makeStructuredEnvelope(1, 'evt-1', 'TITLE', 'TEXT', 'Diagnosis'),
      makeStructuredEnvelope(2, 'evt-2', 'DETAIL', 'TEXT', 'intro\n'),
      makeStructuredEnvelope(3, 'evt-3', 'DETAIL', 'DSL', { chart: 1 }),
      makeStructuredEnvelope(4, 'evt-4', 'DETAIL', 'TEXT', 'outro\n'),
    ];
    const entries = buildProcessEntries(events, t);
    const titleEntry = entries.find((e) => e.toolEventType === 'TITLE');
    // detail string only contains TEXT portions concatenated
    expect(titleEntry!.detail).toBe('intro\noutro\n');
    // structuredSegments keeps all three in order: TEXT, DSL, TEXT
    expect(titleEntry!.structuredSegments).toHaveLength(3);
    expect(titleEntry!.structuredSegments![0]).toMatchObject({ kind: 'structured', toolMessageType: 'TEXT', content: 'intro\n' });
    expect(titleEntry!.structuredSegments![1]).toMatchObject({ kind: 'structured', toolMessageType: 'DSL', content: { chart: 1 } });
    expect(titleEntry!.structuredSegments![2]).toMatchObject({ kind: 'structured', toolMessageType: 'TEXT', content: 'outro\n' });
  });

  it('adjacent TEXT DETAIL segments merge into the last TEXT segment', () => {
    const events: StreamEnvelope[] = [
      makeStructuredEnvelope(1, 'evt-1', 'TITLE', 'TEXT', 'Diagnosis'),
      makeStructuredEnvelope(2, 'evt-2', 'DETAIL', 'TEXT', 'part1'),
      makeStructuredEnvelope(3, 'evt-3', 'DETAIL', 'TEXT', 'part2'),
    ];
    const entries = buildProcessEntries(events, t);
    const titleEntry = entries.find((e) => e.toolEventType === 'TITLE');
    expect(titleEntry!.structuredSegments).toHaveLength(1);
    expect(titleEntry!.structuredSegments![0]).toMatchObject({ kind: 'structured', toolMessageType: 'TEXT', content: 'part1part2' });
  });

  it('messageType change breaks TEXT merge chain', () => {
    const events: StreamEnvelope[] = [
      makeStructuredEnvelope(1, 'evt-1', 'TITLE', 'TEXT', 'Diagnosis'),
      makeStructuredEnvelope(2, 'evt-2', 'DETAIL', 'TEXT', 'text-part'),
      makeStructuredEnvelope(3, 'evt-3', 'DETAIL', 'DSL', { chart: 1 }),
      makeStructuredEnvelope(4, 'evt-4', 'DETAIL', 'TEXT', 'text-after'),
    ];
    const entries = buildProcessEntries(events, t);
    const titleEntry = entries.find((e) => e.toolEventType === 'TITLE');
    // messageType change breaks the TEXT merge chain: three segments, not two merged
    expect(titleEntry!.structuredSegments).toHaveLength(3);
    expect(titleEntry!.structuredSegments![0]).toMatchObject({ kind: 'structured', toolMessageType: 'TEXT', content: 'text-part' });
    expect(titleEntry!.structuredSegments![1]).toMatchObject({ kind: 'structured', toolMessageType: 'DSL', content: { chart: 1 } });
    expect(titleEntry!.structuredSegments![2]).toMatchObject({ kind: 'structured', toolMessageType: 'TEXT', content: 'text-after' });
  });

  it('buildProcessDisplayEntries passes through structuredSegments', () => {
    const events: StreamEnvelope[] = [
      makeStructuredEnvelope(1, 'evt-1', 'TITLE', 'TEXT', 'Diagnosis'),
      makeStructuredEnvelope(2, 'evt-2', 'DETAIL', 'DSL', { chart: 1 }),
    ];
    const entries = buildProcessEntries(events, t);
    const displayEntries = buildProcessDisplayEntries(entries, t);
    const titleEntry = displayEntries.find((e) => e.toolEventType === 'TITLE');
    expect(titleEntry!.structuredSegments).toHaveLength(1);
    expect(titleEntry!.structuredSegments![0]).toMatchObject({ kind: 'structured', toolMessageType: 'DSL', content: { chart: 1 } });
  });
  it('renders DETAIL with JSON object content and accumulated:true (workflow scenario)', () => {
    const tableContent = {
      headers: ['Cell ID', 'RSRP'],
      rows: [
        ['Cell-001', -112],
        ['Cell-002', -95],
      ],
    };
    const titleEnvelope: StreamEnvelope = {
      eventId: 'evt-title-1',
      sessionId: 's',
      requestId: 'r',
      runId: 'run',
      rootMessageId: 'root',
      requestContextId: 'ctx',
      sequence: 1,
      eventType: 'TOOL_STRUCTURED_DELTA',
      timelineEventRef: null,
      transportHints: [],
      payload: {
        contentType: 'PLAIN_TEXT',
        content: 'Cell Metrics' as never,
        text: '',
        role: 'CAPABILITY_RESULT',
        messageId: 'm1',
        runId: 'run',
        rootMessageId: 'root',
        requestContextId: 'ctx',
        visible: true,
        toolEventType: 'TITLE' as never,
        toolMessageType: 'TEXT' as never,
        toolCallId: 'wf:table',
        capabilityId: 'table',
        metadata: { accumulated: true } as never,
      },
      createdAt: 1784628130000,
    } as StreamEnvelope;
    const detailEnvelope: StreamEnvelope = {
      eventId: 'evt-detail-1',
      sessionId: 's',
      requestId: 'r',
      runId: 'run',
      rootMessageId: 'root',
      requestContextId: 'ctx',
      sequence: 2,
      eventType: 'TOOL_STRUCTURED_DELTA',
      timelineEventRef: null,
      transportHints: [],
      payload: {
        contentType: 'PLAIN_TEXT',
        content: tableContent as never,
        text: '',
        role: 'CAPABILITY_RESULT',
        messageId: 'm2',
        runId: 'run',
        rootMessageId: 'root',
        requestContextId: 'ctx',
        visible: true,
        toolEventType: 'DETAIL' as never,
        toolMessageType: 'TEXT' as never,
        toolCallId: 'wf:table',
        capabilityId: 'table',
        metadata: { accumulated: true } as never,
      },
      createdAt: 1784628130001,
    } as StreamEnvelope;

    const entries = buildProcessEntries([titleEnvelope, detailEnvelope], t);
    const titleEntry = entries.find((e) => e.toolEventType === 'TITLE');
    expect(titleEntry).toBeDefined();
    expect(titleEntry!.detail.trim().length).toBeGreaterThan(0);
    expect(titleEntry!.detail).toBe(JSON.stringify(tableContent));

    const displayEntries = buildProcessDisplayEntries(entries, t);
    const displayEntry = displayEntries.find((e) => e.toolEventType === 'TITLE');
    expect(displayEntry).toBeDefined();
    expect(displayEntry!.detail.trim().length).toBeGreaterThan(0);
  });
});

describe('buildProcessEntries structured event correlation', () => {
  it('appends SUB_DETAIL to last TITLE entry when no matching SUB_TITLE', () => {
    const events: StreamEnvelope[] = [
      makeStructuredEnvelope(1, 'evt-1', 'TITLE', 'TEXT', 'Main title', 'call-1'),
      makeStructuredEnvelope(2, 'evt-2', 'SUB_DETAIL', 'TEXT', 'Sub detail content', 'call-2'),
    ];
    const entries = buildProcessEntries(events, t);
    const titleEntry = entries.find((e) => e.toolEventType === 'TITLE');
    expect(titleEntry).toBeDefined();
    expect(titleEntry!.detail).toBe('Sub detail content');
  });

  it('appends SUB_DETAIL to last standalone DETAIL when no matching SUB_TITLE', () => {
    const events: StreamEnvelope[] = [
      makeStructuredEnvelope(1, 'evt-1', 'DETAIL', 'TEXT', 'Standalone detail', 'call-1'),
      makeStructuredEnvelope(2, 'evt-2', 'SUB_DETAIL', 'TEXT', ' sub content', 'call-2'),
    ];
    const entries = buildProcessEntries(events, t);
    const detailEntries = entries.filter((e) => e.toolEventType === 'DETAIL');
    expect(detailEntries).toHaveLength(1);
    expect(detailEntries[0]!.detail).toBe('Standalone detail sub content');
  });

  it('processes a same-sequence TITLE before its correlated DETAIL', () => {
    const events: StreamEnvelope[] = [
      makeStructuredEnvelope(4, 'detail-root', 'DETAIL', 'TEXT', 'Root detail', 'workflow:root'),
      makeStructuredEnvelope(4, 'title-action', 'TITLE', 'TEXT', 'Action plan', 'workflow:action'),
      makeStructuredEnvelope(4, 'title-root', 'TITLE', 'TEXT', 'Root cause', 'workflow:root'),
    ];

    const entries = buildProcessEntries(events, t);
    expect(entries.find((entry) => entry.title === 'Root cause')?.detail).toBe('Root detail');
    expect(entries.find((entry) => entry.title === 'Action plan')?.detail).toBe('');
  });

  it('correlates interleaved DETAIL events by toolCallId', () => {
    const events: StreamEnvelope[] = [
      makeStructuredEnvelope(1, 'title-root', 'TITLE', 'TEXT', 'Root cause', 'workflow:root'),
      makeStructuredEnvelope(2, 'title-action', 'TITLE', 'TEXT', 'Action plan', 'workflow:action'),
      makeStructuredEnvelope(3, 'detail-root', 'DETAIL', 'TEXT', 'Root detail', 'workflow:root'),
      makeStructuredEnvelope(4, 'detail-action', 'DETAIL', 'TEXT', 'Action detail', 'workflow:action'),
    ];

    const entries = buildProcessEntries(events, t);
    expect(entries.find((entry) => entry.title === 'Root cause')?.detail).toBe('Root detail');
    expect(entries.find((entry) => entry.title === 'Action plan')?.detail).toBe('Action detail');
  });

  it('correlates interleaved SUB_DETAIL and SUB_CONCLUSION events by toolCallId', () => {
    const events: StreamEnvelope[] = [
      makeStructuredEnvelope(1, 'sub-title-cell', 'SUB_TITLE', 'TEXT', 'Cell analysis', 'workflow:cell'),
      makeStructuredEnvelope(2, 'sub-title-link', 'SUB_TITLE', 'TEXT', 'Link analysis', 'workflow:link'),
      makeStructuredEnvelope(3, 'sub-detail-cell', 'SUB_DETAIL', 'TEXT', 'Cell detail', 'workflow:cell'),
      makeStructuredEnvelope(4, 'sub-detail-link', 'SUB_CONCLUSION', 'TEXT', 'Link conclusion', 'workflow:link'),
    ];

    const entries = buildProcessEntries(events, t);
    expect(entries.find((entry) => entry.title === 'Cell analysis')?.detail).toBe('Cell detail');
    expect(entries.find((entry) => entry.title === 'Link analysis')?.detail).toBe('Link conclusion');
  });

  it('correlates EXPAND_PANEL with its TITLE by toolCallId', () => {
    const events: StreamEnvelope[] = [
      makeStructuredEnvelope(1, 'title-root', 'TITLE', 'TEXT', 'Root cause', 'workflow:root'),
      makeStructuredEnvelope(2, 'title-action', 'TITLE', 'TEXT', 'Action plan', 'workflow:action'),
      makeStructuredEnvelope(3, 'expand-root', 'EXPAND_PANEL', 'TEXT', 'Root evidence', 'workflow:root'),
    ];

    const entries = buildProcessEntries(events, t);
    expect(entries.find((entry) => entry.title === 'Root cause')?.expandPanelData?.content).toBe('Root evidence');
    expect(entries.find((entry) => entry.title === 'Action plan')?.expandPanelData).toBeUndefined();
  });

  it('falls back to the latest TITLE when no correlated TITLE exists', () => {
    const events: StreamEnvelope[] = [
      makeStructuredEnvelope(1, 'title-root', 'TITLE', 'TEXT', 'Root cause', 'workflow:root'),
      makeStructuredEnvelope(2, 'title-action', 'TITLE', 'TEXT', 'Action plan', 'workflow:action'),
      makeStructuredEnvelope(3, 'legacy-detail', 'DETAIL', 'TEXT', 'Legacy detail', null),
    ];

    const entries = buildProcessEntries(events, t);
    expect(entries.find((entry) => entry.title === 'Root cause')?.detail).toBe('');
    expect(entries.find((entry) => entry.title === 'Action plan')?.detail).toBe('Legacy detail');
  });

  it('does not attach a correlated DETAIL when its TITLE is missing', () => {
    const events: StreamEnvelope[] = [
      makeStructuredEnvelope(1, 'title-root', 'TITLE', 'TEXT', 'Root cause', 'workflow:root'),
      makeStructuredEnvelope(2, 'detail-action', 'DETAIL', 'TEXT', 'Action detail', 'workflow:action'),
    ];

    const entries = buildProcessEntries(events, t);
    expect(entries.find((entry) => entry.title === 'Root cause')?.detail).toBe('');
  });

  describe('workflow break strategy degradation dedup', () => {
    function makeTerminalFailureEnvelope(sequence: number, eventId: string, code: string, category: string): StreamEnvelope {
      return {
        eventId,
        sessionId: 'test-session',
        requestId: 'test-request',
        runId: 'test-run',
        rootMessageId: 'test-root',
        requestContextId: 'test-context',
        sequence,
        eventType: 'REQUEST_FAILED',
        timelineEventRef: `timeline-${eventId}`,
        transportHints: [],
        payload: {
          content: '',
          text: '',
          code,
          category,
          eventType: 'REQUEST_FAILED',
          status: 'FAILED',
          metadata: { accumulated: true },
        },
        createdAt: 1783346000000 + sequence,
      } as StreamEnvelope;
    }

    function makeFinalContentEnvelope(sequence: number, eventId: string): StreamEnvelope {
      return {
        eventId,
        sessionId: 'test-session',
        requestId: 'test-request',
        runId: 'test-run',
        rootMessageId: 'test-root',
        requestContextId: 'test-context',
        sequence,
        eventType: 'LLM_CONTENT_DELTA',
        timelineEventRef: `timeline-${eventId}`,
        transportHints: [],
        payload: {
          content: 'fast_branch done',
          text: 'fast_branch done',
          final: true,
          role: 'ASSISTANT',
          metadata: { accumulated: true },
        },
        createdAt: 1783346000000 + sequence,
      } as StreamEnvelope;
    }

    it('renders a single terminal-failure degradation entry for one REQUEST_FAILED event', () => {
      const events = [makeFinalContentEnvelope(1, 'content-1'), makeTerminalFailureEnvelope(2, 'failed-1', 'CAPABILITY_UNAVAILABLE', 'INTERNAL')];

      const entries = buildProcessEntries(events, businessT);
      const degradationEntries = entries.filter((entry) => entry.kind === 'system' && entry.title === 'turn.process.systemEvent.degradation.title');
      expect(degradationEntries).toHaveLength(1);
    });

    it('does not duplicate degradation entries when the same REQUEST_FAILED appears twice with different eventIds (refresh merge)', () => {
      // Simulate refresh: the same REQUEST_FAILED event appears in both the
      // historical (optimistic stream) and settled (persisted) envelopes,
      // with different eventIds because the stream event was optimistic.
      const events = [
        makeFinalContentEnvelope(1, 'content-1'),
        makeTerminalFailureEnvelope(2, 'failed-stream', 'CAPABILITY_UNAVAILABLE', 'INTERNAL'),
        makeTerminalFailureEnvelope(2, 'failed-persisted', 'CAPABILITY_UNAVAILABLE', 'INTERNAL'),
      ];

      const entries = buildProcessEntries(events, businessT);
      const degradationEntries = entries.filter((entry) => entry.kind === 'system' && entry.title === 'turn.process.systemEvent.degradation.title');
      expect(degradationEntries).toHaveLength(1);
    });
  });
});
