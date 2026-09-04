import { afterEach, describe, expect, it } from 'vitest';
import i18n, {
  LOCALE_PREFERENCE_STORAGE_KEY,
  getCurrentLocale,
  getLocalePreference,
  normalizeLocale,
  setLocalePreference,
} from '../src/i18n/index.ts';
import { enUS } from '../src/i18n/resources/en-US.ts';
import { zhCN } from '../src/i18n/resources/zh-CN.ts';

function flattenResourceKeys(value: unknown, prefix = ''): string[] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return prefix ? [prefix] : [];
  }

  return Object.entries(value).flatMap(([key, child]) => {
    const nextPrefix = prefix ? `${prefix}.${key}` : key;
    return flattenResourceKeys(child, nextPrefix);
  });
}

describe('i18n runtime', () => {
  afterEach(async () => {
    await setLocalePreference('zh-CN');
  });

  it('normalizes supported browser locale variants', () => {
    expect(normalizeLocale('zh')).toBe('zh-CN');
    expect(normalizeLocale('zh_Hans_CN')).toBe('zh-CN');
    expect(normalizeLocale('en')).toBe('en-US');
    expect(normalizeLocale('en-GB')).toBe('en-US');
    expect(normalizeLocale('fr-FR')).toBeNull();
  });

  it('persists explicit locale preference and updates the active i18n locale', async () => {
    await setLocalePreference('en-US');

    expect(localStorage.getItem(LOCALE_PREFERENCE_STORAGE_KEY)).toBe('en-US');
    expect(getLocalePreference()).toBe('en-US');
    expect(getCurrentLocale()).toBe('en-US');
    expect(document.documentElement.lang).toBe('en-US');
    expect(i18n.t('sidebar.settings')).toBe('Settings');
  });

  it('keeps locale resource keys aligned', () => {
    expect(flattenResourceKeys(enUS).sort()).toEqual(flattenResourceKeys(zhCN).sort());
  });

  it('uses a concise Chinese label for manual AskUserQuestion input', () => {
    expect(zhCN.respondInput.customAnswer).toBe('手动输入');
  });

  it('uses operations-friendly system event language in both locales', () => {
    expect(zhCN.turn.process.systemEvent).toEqual({
      degradation: {
        title: '本次任务有部分内容未完成',
        summary: '请查看执行详情和本次答复，确认未完成的内容。',
      },
      hookDegraded: {
        title: '本次任务有部分内容未完成',
        summary: '请查看执行详情和本次答复，确认未完成的内容。',
      },
      contextCompacted: {
        title: '已整理较早的对话',
        summary: '系统已整理较早的对话内容，以便继续处理本次任务。',
      },
    });
    expect(enUS.turn.process.systemEvent).toEqual({
      degradation: {
        title: 'Some work in this task did not complete',
        summary: 'Review the execution details and response to identify what did not complete.',
      },
      hookDegraded: {
        title: 'Some work in this task did not complete',
        summary: 'Review the execution details and response to identify what did not complete.',
      },
      contextCompacted: {
        title: 'Earlier messages were condensed',
        summary: 'The system condensed earlier messages to continue this task.',
      },
    });
  });

  it('describes the session search keyword limit in both locales', () => {
    expect(zhCN.sessionHistory.keywordTooLongHint).toBe('搜索关键词最多 200 个字符，请缩短后再试。');
    expect(enUS.sessionHistory.keywordTooLongHint).toBe('Search keyword is limited to 200 characters. Please shorten it.');
  });

  it('describes import results without claiming same-file deduplication', () => {
    expect(zhCN.memoryManagement.transfer.importSuccess).toContain('成功处理');
    expect(zhCN.memoryManagement.transfer.importPartial).toContain('成功处理');
    expect(zhCN.memoryManagement.transfer.importSuccess).not.toContain('不会重复新增');
    expect(zhCN.memoryManagement.transfer.importPartial).not.toContain('不会重复新增');
    expect(enUS.memoryManagement.transfer.importSuccess).toContain('Successfully processed');
    expect(enUS.memoryManagement.transfer.importPartial).toContain('processed successfully');
    expect(enUS.memoryManagement.transfer.importSuccess).not.toContain('not created again');
    expect(enUS.memoryManagement.transfer.importPartial).not.toContain('not created again');
  });

  it('describes the personal import limit, existing count, and available count', () => {
    expect(zhCN.memoryManagement.transfer.capacitySummary).toBe('个人导入记忆限制50条，已有 {{existing}} 条，可导入{{available}}条。');
    expect(enUS.memoryManagement.transfer.capacitySummary).toBe(
      'Personal memory import limit: 50. {{existing}} existing; {{available}} can be imported.',
    );
  });
});
