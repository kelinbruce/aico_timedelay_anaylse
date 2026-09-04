import type { TFunction } from 'i18next';
import { describe, expect, it } from 'vitest';
import { resolveSafeSummaryPresentation } from './safeSummaryPresentation.ts';

const t = ((key: string) => key) as unknown as TFunction;

describe('safe command and program summary presentation', () => {
  it.each([
    ['CAPABILITY_RESULT_COMMAND_SUCCEEDED', ''],
    ['CAPABILITY_RESULT_COMMAND_SUCCEEDED_WITH_OUTPUT', ''],
    ['CAPABILITY_RESULT_COMMAND_FAILED', 'turn.process.programFailedSummary'],
    ['CAPABILITY_RESULT_COMMAND_FAILED_WITH_ERROR', 'turn.process.programFailedWithErrorOutputSummary'],
    ['CAPABILITY_RESULT_COMMAND_TIMED_OUT', 'turn.process.programTimedOutSummary'],
  ])('uses program wording for Python %s', (safeSummaryCode, expected) => {
    expect(resolveSafeSummaryPresentation({ capabilityId: 'Python', safeSummaryCode, safeSummaryArgs: { exitCode: 0 } }, t)).toBe(expected);
  });

  it.each([
    ['CAPABILITY_RESULT_COMMAND_SUCCEEDED', ''],
    ['CAPABILITY_RESULT_COMMAND_FAILED', 'turn.process.commandFailedSummary'],
    ['CAPABILITY_RESULT_COMMAND_TIMED_OUT', 'turn.process.commandTimedOutSummary'],
  ])('keeps command wording for Bash %s', (safeSummaryCode, expected) => {
    expect(resolveSafeSummaryPresentation({ capabilityId: 'Bash', safeSummaryCode, safeSummaryArgs: { exitCode: 0 } }, t)).toBe(expected);
  });

  it.each([
    ['CAPABILITY_RESULT_GREP_FILES_WITH_MATCHES', { totalFilesWithMatches: 2, truncated: false }, 'turn.process.grepFilesWithMatchesSummary'],
    [
      'CAPABILITY_RESULT_GREP_CONTENT_MATCHES',
      { totalMatches: 3, totalFilesWithMatches: 2, truncated: false },
      'turn.process.grepContentMatchesSummary',
    ],
  ])('uses mode-specific Grep wording for %s', (safeSummaryCode, safeSummaryArgs, expected) => {
    expect(resolveSafeSummaryPresentation({ capabilityId: 'Grep', safeSummaryCode, safeSummaryArgs }, t)).toBe(expected);
  });

  it('discloses truncated Grep summaries and rejects non-exact args', () => {
    expect(
      resolveSafeSummaryPresentation(
        {
          capabilityId: 'Grep',
          safeSummaryCode: 'CAPABILITY_RESULT_GREP_CONTENT_MATCHES',
          safeSummaryArgs: { totalMatches: 0, totalFilesWithMatches: 0, truncated: true },
        },
        t,
      ),
    ).toBe('turn.process.grepContentMatchesSummary turn.process.resultTruncated');
    expect(
      resolveSafeSummaryPresentation(
        {
          capabilityId: 'Grep',
          safeSummaryCode: 'CAPABILITY_RESULT_GREP_CONTENT_MATCHES',
          safeSummaryArgs: { totalMatches: 0, totalFilesWithMatches: 0, truncated: false, extra: true },
        },
        t,
      ),
    ).toBeNull();
  });
});
