import { describe, expect, it } from 'vitest';

import { readSafeCapabilityResult } from '../src/features/chat/utils/safeCapabilityResult.ts';

describe('pending input answer safe-result guard', () => {
  it('accepts the runtime compatibility boundary of 20 answer groups', () => {
    const answers = Array.from({ length: 20 }, (_, index) => [`answer-${index + 1}`]);

    expect(
      readSafeCapabilityResult({
        kind: 'pendingInputAnswer',
        answers,
        truncated: false,
      }),
    ).toEqual({
      kind: 'pendingInputAnswer',
      answers,
      truncated: false,
    });
  });

  it('rejects a channel result above the 20-group boundary', () => {
    expect(
      readSafeCapabilityResult({
        kind: 'pendingInputAnswer',
        answers: Array.from({ length: 21 }, (_, index) => [`answer-${index + 1}`]),
        truncated: true,
      }),
    ).toBeNull();
  });
});

describe('RAG retrieval safe-result guard', () => {
  it('accepts the RAG source and full content shape projected by the trusted backend', () => {
    const longContent = `${'中'.repeat(50)}尾部不应展示`;
    expect(
      readSafeCapabilityResult({
        kind: 'ragRetrieval',
        totalCount: 3,
        items: [
          { source: 'upf-timeout.md', content: 'Handle N4 timeout first.' },
          { source: 'amf-overload.md', content: longContent },
          { source: '', content: 'Counted without a displayable source.' },
        ],
      }),
    ).toEqual({
      kind: 'ragRetrieval',
      totalCount: 3,
      items: [
        { source: 'upf-timeout.md', content: 'Handle N4 timeout first.' },
        { source: 'amf-overload.md', content: longContent },
        { source: '', content: 'Counted without a displayable source.' },
      ],
    });
  });

  it('accepts content longer than the previous preview limits without rejection', () => {
    expect(
      readSafeCapabilityResult({
        kind: 'ragRetrieval',
        totalCount: 1,
        items: [{ source: 'english-runbook.md', content: 'x'.repeat(600) }],
      }),
    ).toEqual({
      kind: 'ragRetrieval',
      totalCount: 1,
      items: [{ source: 'english-runbook.md', content: 'x'.repeat(600) }],
    });
  });

  it.each([
    {
      caseName: 'unknown field on item',
      value: {
        kind: 'ragRetrieval',
        totalCount: 1,
        items: [{ source: 'upf-timeout.md', content: 'safe', privateScore: 'must not render' }],
      },
    },
    {
      caseName: 'missing source',
      value: {
        kind: 'ragRetrieval',
        totalCount: 1,
        items: [{ content: 'safe' }],
      },
    },
    {
      caseName: 'missing content',
      value: {
        kind: 'ragRetrieval',
        totalCount: 1,
        items: [{ source: 'upf-timeout.md' }],
      },
    },
    {
      caseName: 'non-string source',
      value: {
        kind: 'ragRetrieval',
        totalCount: 1,
        items: [{ source: 42, content: 'safe' }],
      },
    },
  ])('rejects $caseName', ({ value }) => {
    expect(readSafeCapabilityResult(value)).toBeNull();
  });
});

describe('Grep safe-result guard', () => {
  it('accepts both bounded exact variants', () => {
    expect(
      readSafeCapabilityResult({
        kind: 'grepResult',
        outputMode: 'files_with_matches',
        totalFilesWithMatches: 2,
        totalMatches: 3,
        truncated: false,
        filenames: ['workspace/a.log', 'workspace/b.log'],
      }),
    ).toEqual({
      kind: 'grepResult',
      outputMode: 'files_with_matches',
      totalFilesWithMatches: 2,
      totalMatches: 3,
      truncated: false,
      filenames: ['workspace/a.log', 'workspace/b.log'],
    });
    expect(
      readSafeCapabilityResult({
        kind: 'grepResult',
        outputMode: 'content',
        totalFilesWithMatches: 1,
        totalMatches: 2,
        truncated: false,
        locations: [
          { filePath: 'workspace/a.log', lineNumber: 4 },
          { filePath: 'workspace/a.log', lineNumber: 9 },
        ],
      }),
    ).toMatchObject({
      outputMode: 'content',
      locations: [
        { filePath: 'workspace/a.log', lineNumber: 4 },
        { filePath: 'workspace/a.log', lineNumber: 9 },
      ],
    });
  });

  it.each([
    {
      caseName: 'unknown field',
      value: {
        kind: 'grepResult',
        outputMode: 'content',
        totalFilesWithMatches: 0,
        totalMatches: 0,
        truncated: false,
        locations: [],
        line: 'must not render',
      },
    },
    {
      caseName: 'unsafe path',
      value: {
        kind: 'grepResult',
        outputMode: 'content',
        totalFilesWithMatches: 1,
        totalMatches: 1,
        truncated: false,
        locations: [{ filePath: '/private/alarm.log', lineNumber: 1 }],
      },
    },
    {
      caseName: 'invalid line number',
      value: {
        kind: 'grepResult',
        outputMode: 'content',
        totalFilesWithMatches: 1,
        totalMatches: 1,
        truncated: false,
        locations: [{ filePath: 'workspace/alarm.log', lineNumber: 0 }],
      },
    },
    {
      caseName: 'more than 50 entries',
      value: {
        kind: 'grepResult',
        outputMode: 'files_with_matches',
        totalFilesWithMatches: 51,
        totalMatches: 51,
        truncated: true,
        filenames: Array.from({ length: 51 }, (_, index) => `workspace/${index}.log`),
      },
    },
  ])('rejects $caseName', ({ value }) => {
    expect(readSafeCapabilityResult(value)).toBeNull();
  });
});

describe('ToolSearch and Cron safe-result guards', () => {
  it('accepts the exact bounded ToolSearch and Cron shapes projected by the backend', () => {
    expect(
      readSafeCapabilityResult({
        kind: 'toolSearch',
        tools: [{ capability_id: 'ran-alarm-diagnosis', name: 'RAN Alarm Diagnosis', kind: 'SKILL', description: 'Diagnose RAN alarms.' }],
        totalCount: 1,
        truncated: false,
      }),
    ).toEqual({
      kind: 'toolSearch',
      tools: [{ capability_id: 'ran-alarm-diagnosis', name: 'RAN Alarm Diagnosis', kind: 'SKILL', description: 'Diagnose RAN alarms.' }],
      totalCount: 1,
      truncated: false,
    });
    expect(
      readSafeCapabilityResult({
        kind: 'cron',
        action: 'create',
        id: 'cron-1',
        humanSchedule: 'Every day at 03:17',
        recurring: true,
        delay: { days: 0, hours: 1, minutes: 30 },
      }),
    ).toEqual({
      kind: 'cron',
      action: 'create',
      id: 'cron-1',
      humanSchedule: 'Every day at 03:17',
      recurring: true,
      delay: { days: 0, hours: 1, minutes: 30 },
    });
    expect(readSafeCapabilityResult({ kind: 'cron', action: 'delete', id: 'cron-1' })).toEqual({
      kind: 'cron',
      action: 'delete',
      id: 'cron-1',
    });
    expect(
      readSafeCapabilityResult({
        kind: 'cron',
        action: 'list',
        jobs: [{ id: 'cron-1', cron: '17 3 * * *', humanSchedule: 'Every day at 03:17', recurring: true }],
        totalCount: 1,
        truncated: false,
      }),
    ).toEqual({
      kind: 'cron',
      action: 'list',
      jobs: [{ id: 'cron-1', cron: '17 3 * * *', humanSchedule: 'Every day at 03:17', recurring: true }],
      totalCount: 1,
      truncated: false,
    });
  });

  it.each([
    {
      kind: 'toolSearch',
      tools: [],
      totalCount: 0,
      truncated: false,
      privateValue: 'must not render',
    },
    {
      kind: 'cron',
      action: 'delete',
      id: 'cron-1',
      prompt: 'must not render',
    },
  ])('rejects unknown fields from typed safe results', (value) => {
    expect(readSafeCapabilityResult(value)).toBeNull();
  });
});
