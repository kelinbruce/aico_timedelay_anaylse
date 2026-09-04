import type { TFunction } from 'i18next';
import { describe, expect, it } from 'vitest';
import { resolveSystemEventPresentation } from './systemEventPresentation.ts';

const zh = translation({
  'turn.process.systemEvent.degradation.title': '本次任务有部分内容未完成',
  'turn.process.systemEvent.degradation.summary': '请查看执行详情和本次答复，确认未完成的内容。',
  'turn.process.systemEvent.hookDegraded.title': '本次任务有部分内容未完成',
  'turn.process.systemEvent.hookDegraded.summary': '请查看执行详情和本次答复，确认未完成的内容。',
  'turn.process.systemEvent.contextCompacted.title': '已整理较早的对话',
  'turn.process.systemEvent.contextCompacted.summary': '系统已整理较早的对话内容，以便继续处理本次任务。',
});

const en = translation({
  'turn.process.systemEvent.degradation.title': 'Some work in this task did not complete',
  'turn.process.systemEvent.degradation.summary': 'Review the execution details and response to identify what did not complete.',
  'turn.process.systemEvent.hookDegraded.title': 'Some work in this task did not complete',
  'turn.process.systemEvent.hookDegraded.summary': 'Review the execution details and response to identify what did not complete.',
  'turn.process.systemEvent.contextCompacted.title': 'Earlier messages were condensed',
  'turn.process.systemEvent.contextCompacted.summary': 'The system condensed earlier messages to continue this task.',
});

describe('resolveSystemEventPresentation', () => {
  it.each([
    ['DEGRADATION_NOTICE', '本次任务有部分内容未完成', '请查看执行详情和本次答复，确认未完成的内容。', 'warning'],
    ['HOOK_DEGRADED', '本次任务有部分内容未完成', '请查看执行详情和本次答复，确认未完成的内容。', 'warning'],
    ['CONTEXT_COMPACTED', '已整理较早的对话', '系统已整理较早的对话内容，以便继续处理本次任务。', 'info'],
  ] as const)('maps %s to fixed Chinese business language', (eventType, title, summary, severity) => {
    expect(resolveSystemEventPresentation(eventType, {}, zh)).toEqual({ title, summary, severity });
  });

  it('uses the English resources for the same governed semantics', () => {
    expect(resolveSystemEventPresentation('DEGRADATION_NOTICE', {}, en)).toEqual({
      title: 'Some work in this task did not complete',
      summary: 'Review the execution details and response to identify what did not complete.',
      severity: 'warning',
    });
  });

  it('only retains an explicit top-level degradation code', () => {
    expect(resolveSystemEventPresentation('DEGRADATION_NOTICE', { code: ' FUTURE_SAFE_CODE ' }, zh)).toMatchObject({
      technicalCode: 'FUTURE_SAFE_CODE',
    });
    expect(
      resolveSystemEventPresentation(
        'DEGRADATION_NOTICE',
        { message: 'Request failed safely: TEXT_CODE', content: 'raw', reason: 'secret', safeSummary: 'unsafe' },
        zh,
      ),
    ).not.toHaveProperty('technicalCode');
  });

  it('never exposes a code for compatibility hook or context events', () => {
    expect(resolveSystemEventPresentation('HOOK_DEGRADED', { code: 'HOOK_TIMEOUT' }, zh)).not.toHaveProperty('technicalCode');
    expect(resolveSystemEventPresentation('CONTEXT_COMPACTED', { code: 'CONTEXT_CODE' }, zh)).not.toHaveProperty('technicalCode');
  });
});

function translation(resources: Readonly<Record<string, string>>): TFunction {
  return ((key: string) => resources[key] ?? key) as TFunction;
}
