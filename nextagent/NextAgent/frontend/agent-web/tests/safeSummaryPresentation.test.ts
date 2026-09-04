import { describe, expect, it } from 'vitest';

import i18n from '../src/i18n/index.ts';
import { resolveSafeFailurePresentation, resolveSafeSummaryPresentation } from '../src/features/chat/utils/safeSummaryPresentation.ts';

describe('safe summary presentation', () => {
  it('renders one language-neutral summary descriptor in the selected UI language', () => {
    const payload = {
      safeSummaryCode: 'CAPABILITY_RESULT_FILE_READ',
      safeSummaryArgs: { filePath: 'workspace/backbone-latency.csv' },
      safeSummary: 'Read workspace/backbone-latency.csv and returned its content.',
    };

    expect(resolveSafeSummaryPresentation(payload, i18n.getFixedT('zh-CN'))).toBe('已读取 workspace/backbone-latency.csv，内容已返回。');
    expect(resolveSafeSummaryPresentation(payload, i18n.getFixedT('en-US'))).toBe('Read workspace/backbone-latency.csv and returned its content.');
  });

  it('fails closed for unknown codes, unexpected arguments, and unbounded text', () => {
    const t = i18n.getFixedT('zh-CN');

    expect(
      resolveSafeSummaryPresentation(
        {
          safeSummaryCode: 'CAPABILITY_RESULT_UNKNOWN',
          safeSummaryArgs: {},
        },
        t,
      ),
    ).toBeNull();
    expect(
      resolveSafeSummaryPresentation(
        {
          safeSummaryCode: 'CAPABILITY_RESULT_FILE_READ',
          safeSummaryArgs: { filePath: 'safe.txt', rawResult: 'must not leak' },
        },
        t,
      ),
    ).toBeNull();
    expect(
      resolveSafeSummaryPresentation(
        {
          safeSummaryCode: 'CAPABILITY_RESULT_FILE_READ',
          safeSummaryArgs: { filePath: 'x'.repeat(257) },
        },
        t,
      ),
    ).toBeNull();
    expect(
      resolveSafeSummaryPresentation(
        {
          safeSummaryCode: 'CAPABILITY_RESULT_FILE_READ',
          safeSummaryArgs: { filePath: '   ' },
        },
        t,
      ),
    ).toBeNull();
  });

  it.each([
    [
      'CAPABILITY_RESULT_FAILURE_INVALID_INPUT',
      '未能执行',
      '本次工具输入未满足执行要求。',
      'Unable to run',
      'The tool input did not meet the execution requirements.',
    ],
    [
      'CAPABILITY_RESULT_FAILURE_FULL_READ_REQUIRED',
      '未能完成',
      '修改文件前需要先完整读取最新内容。',
      'Could not complete',
      'The latest file content must be read completely before it can be modified.',
    ],
    [
      'CAPABILITY_RESULT_FAILURE_TARGET_CHANGED',
      '未能完成',
      '文件在处理期间发生变化，本次修改未应用。',
      'Could not complete',
      'The file changed while it was being processed, so the modification was not applied.',
    ],
    [
      'CAPABILITY_RESULT_FAILURE_NOT_FOUND',
      '未找到',
      '未找到本次操作所需的对象。',
      'Not found',
      'The object required for this operation was not found.',
    ],
    [
      'CAPABILITY_RESULT_FAILURE_PATH_REJECTED',
      '已阻止',
      '当前安全策略不允许执行该操作。',
      'Blocked',
      'The current safety policy does not allow this operation.',
    ],
    [
      'CAPABILITY_RESULT_FAILURE_PLATFORM_UNSUPPORTED',
      '无法执行',
      '当前运行环境不支持此能力。',
      'Cannot run',
      'The current runtime environment does not support this capability.',
    ],
    [
      'CAPABILITY_RESULT_FAILURE_UNAVAILABLE',
      '暂不可用',
      '执行所需能力当前不可用。',
      'Unavailable',
      'A capability required for execution is currently unavailable.',
    ],
    ['CAPABILITY_RESULT_FAILURE_TIMEOUT', '已超时', '未在规定时间内完成。', 'Timed out', 'The step did not complete within the allowed time.'],
    ['CAPABILITY_RESULT_FAILURE_CANCELED', '已取消', '该步骤已取消。', 'Canceled', 'The step was canceled.'],
    [
      'CAPABILITY_RESULT_FAILURE_CONFLICT',
      '未能完成',
      '当前状态与操作要求不一致。',
      'Could not complete',
      'The current state does not meet the operation requirements.',
    ],
    [
      'CAPABILITY_RESULT_FAILURE_TOO_LARGE',
      '结果不可展示',
      '返回结果超过安全展示范围。',
      'Result unavailable',
      'The returned result exceeds the safe display limit.',
    ],
    [
      'CAPABILITY_RESULT_FAILURE_INTERNAL',
      '系统异常',
      '系统处理该步骤时出现异常。',
      'System error',
      'An error occurred while the system was processing this step.',
    ],
    ['CAPABILITY_RESULT_FAILURE', '未能完成', '该步骤未能完成。', 'Could not complete', 'This step could not be completed.'],
  ] as const)('renders factual capability failure %s without action guidance', (safeSummaryCode, zhStatus, zhReason, enStatus, enReason) => {
    const payload = { safeSummaryCode, safeSummaryArgs: {} };

    expect(resolveSafeFailurePresentation(payload, i18n.getFixedT('zh-CN'))).toEqual({
      statusLabel: zhStatus,
      reason: zhReason,
    });
    expect(resolveSafeFailurePresentation(payload, i18n.getFixedT('en-US'))).toEqual({
      statusLabel: enStatus,
      reason: enReason,
    });
    expect(resolveSafeSummaryPresentation(payload, i18n.getFixedT('zh-CN'))).toBe(zhReason);
  });

  it('uses a factual generic fallback for an unknown failure descriptor and rejects non-empty failure args', () => {
    const t = i18n.getFixedT('zh-CN');

    expect(
      resolveSafeFailurePresentation(
        {
          safeSummaryCode: 'CAPABILITY_RESULT_FAILURE_FUTURE_VENDOR_CODE',
          safeSummaryArgs: {},
          safeSummary: 'Install a dependency and retry now.',
        },
        t,
      ),
    ).toEqual({
      statusLabel: '未能完成',
      reason: '该步骤未能完成。',
    });
    expect(
      resolveSafeFailurePresentation(
        {
          safeSummaryCode: 'CAPABILITY_RESULT_FAILURE_CONFLICT',
          safeSummaryArgs: { errorCode: 'must not become display text' },
        },
        t,
      ),
    ).toBeNull();
  });
});
