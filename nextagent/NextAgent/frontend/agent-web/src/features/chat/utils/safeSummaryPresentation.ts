import type { TFunction } from 'i18next';

const summaryInlineTextMaxChars = 256;

export interface SafeFailurePresentation {
  readonly statusLabel: string;
  readonly reason: string;
}

export function resolveSafeFailurePresentation(payload: Record<string, unknown>, t: TFunction): SafeFailurePresentation | null {
  const code = readString(payload.safeSummaryCode);
  const args = readRecord(payload.safeSummaryArgs);
  if (
    code === null ||
    args === null ||
    !hasExactKeys(args, []) ||
    (code !== 'CAPABILITY_RESULT_FAILURE' && !code.startsWith('CAPABILITY_RESULT_FAILURE_'))
  ) {
    return null;
  }

  const keys = capabilityFailureTranslationKeys(code);
  return {
    statusLabel: t(keys.status),
    reason: t(keys.reason),
  };
}

export function resolveSafeSummaryPresentation(payload: Record<string, unknown>, t: TFunction): string | null {
  const code = readString(payload.safeSummaryCode);
  const args = readRecord(payload.safeSummaryArgs);
  if (code === null || args === null) {
    return null;
  }
  const failure = resolveSafeFailurePresentation(payload, t);
  if (failure !== null) {
    return failure.reason;
  }

  switch (code) {
    case 'CAPABILITY_RESULT_FILE_READ': {
      const filePath = readExactBoundedTextArg(args, 'filePath');
      return filePath === null ? null : t('turn.process.fileReadSummary', { filePath });
    }
    case 'CAPABILITY_RESULT_FILE_LIST': {
      const totalCount = readExactCountArg(args, 'totalCount');
      return totalCount === null ? null : t('turn.process.fileListSummary', { count: totalCount });
    }
    case 'CAPABILITY_RESULT_GREP_FILES_WITH_MATCHES': {
      if (!hasExactKeys(args, ['totalFilesWithMatches', 'truncated'])) {
        return null;
      }
      const totalFilesWithMatches = readNonNegativeInteger(args.totalFilesWithMatches);
      const truncated = readBoolean(args.truncated);
      if (totalFilesWithMatches === null || truncated === null) {
        return null;
      }
      const summary = t('turn.process.grepFilesWithMatchesSummary', { totalFilesWithMatches });
      return truncated ? `${summary} ${t('turn.process.resultTruncated')}` : summary;
    }
    case 'CAPABILITY_RESULT_GREP_CONTENT_MATCHES': {
      if (!hasExactKeys(args, ['totalMatches', 'totalFilesWithMatches', 'truncated'])) {
        return null;
      }
      const totalMatches = readNonNegativeInteger(args.totalMatches);
      const totalFilesWithMatches = readNonNegativeInteger(args.totalFilesWithMatches);
      const truncated = readBoolean(args.truncated);
      if (totalMatches === null || totalFilesWithMatches === null || truncated === null) {
        return null;
      }
      const summary = t('turn.process.grepContentMatchesSummary', { totalMatches, totalFilesWithMatches });
      return truncated ? `${summary} ${t('turn.process.resultTruncated')}` : summary;
    }
    case 'CAPABILITY_RESULT_FILE_CREATED':
    case 'CAPABILITY_RESULT_FILE_UPDATED': {
      const filePath = readExactBoundedTextArg(args, 'filePath');
      if (filePath === null) {
        return null;
      }
      return t(code === 'CAPABILITY_RESULT_FILE_CREATED' ? 'turn.process.fileCreatedSummary' : 'turn.process.fileUpdatedSummary', { filePath });
    }
    case 'CAPABILITY_RESULT_COMMAND_TIMED_OUT':
      return hasExactKeys(args, ['exitCode']) && readFiniteNumber(args.exitCode) !== null
        ? t(executionSummaryKey(payload, 'turn.process.commandTimedOutSummary', 'turn.process.programTimedOutSummary'))
        : null;
    case 'CAPABILITY_RESULT_COMMAND_SUCCEEDED_WITH_OUTPUT':
    case 'CAPABILITY_RESULT_COMMAND_SUCCEEDED':
      return hasExactKeys(args, ['exitCode']) && readFiniteNumber(args.exitCode) !== null ? '' : null;
    case 'CAPABILITY_RESULT_COMMAND_FAILED_WITH_ERROR':
      return hasExactKeys(args, ['exitCode']) && readFiniteNumber(args.exitCode) !== null
        ? t(executionSummaryKey(payload, 'turn.process.commandFailedWithErrorOutputSummary', 'turn.process.programFailedWithErrorOutputSummary'))
        : null;
    case 'CAPABILITY_RESULT_COMMAND_FAILED':
      return hasExactKeys(args, ['exitCode']) && readFiniteNumber(args.exitCode) !== null
        ? t(executionSummaryKey(payload, 'turn.process.commandFailedSummary', 'turn.process.programFailedSummary'))
        : null;
    case 'CAPABILITY_RESULT_TOOL_SEARCH':
      return renderCountSummary(args, 'turn.process.toolSearchSummary', t);
    case 'CAPABILITY_RESULT_RAG_RETRIEVAL':
      return renderCountSummary(args, 'turn.process.ragRetrievalSummary', t);
    case 'CAPABILITY_RESULT_TODO_LIST_CLEAR':
      return readExactCountArg(args, 'totalCount') === 0 ? t('turn.process.todoListClearSummary') : null;
    case 'CAPABILITY_RESULT_TODO_LIST':
      return renderCountSummary(args, 'turn.process.todoListSummary', t);
    case 'CAPABILITY_RESULT_CRON_CREATED':
      return hasExactKeys(args, []) ? t('turn.process.cronCreatedSummary') : null;
    case 'CAPABILITY_RESULT_CRON_DELETED':
      return hasExactKeys(args, []) ? t('turn.process.cronDeletedSummary') : null;
    case 'CAPABILITY_RESULT_CRON_LIST':
      return renderCountSummary(args, 'turn.process.cronListSummary', t);
    case 'CAPABILITY_RESULT_WORKFLOW': {
      if (!hasExactKeys(args, ['recipeName', 'status'])) {
        return null;
      }
      const recipeName = readBoundedText(args.recipeName);
      const status = readBoundedText(args.status);
      if (recipeName === null || status === null) {
        return null;
      }
      return workflowSummaryKey(status) === null ? null : '';
    }
    case 'CAPABILITY_RESULT_WORKFLOW_THINKING':
      return hasExactKeys(args, []) ? t('turn.process.workflowThinkingSummary') : null;
    case 'CAPABILITY_RESULT_WORKFLOW_CONTENT':
      return hasExactKeys(args, []) ? t('turn.process.workflowContentSummary') : null;
    case 'CAPABILITY_RESULT_CLIP_EVENT':
      return hasExactKeys(args, []) ? '' : null;
    case 'CAPABILITY_RESULT_CLIP_COMPLETED':
    case 'CAPABILITY_RESULT_CLIP_RESULT': {
      if (hasExactKeys(args, [])) {
        return '';
      }
      const eventCount = readExactCountArg(args, 'eventCount');
      if (eventCount === null) {
        return null;
      }
      return t(
        code === 'CAPABILITY_RESULT_CLIP_COMPLETED' ? 'turn.process.clipCompletedWithCountSummary' : 'turn.process.clipResultWithCountSummary',
        { count: eventCount },
      );
    }
    case 'CAPABILITY_RESULT_PENDING_INPUT_ANSWER_RECEIVED':
      return hasExactKeys(args, []) ? t('turn.process.pendingInputAnswerReceivedSummary') : null;
    default:
      return null;
  }
}

function executionSummaryKey(payload: Record<string, unknown>, commandKey: string, programKey: string): string {
  return payload.capabilityId === 'Python' ? programKey : commandKey;
}

function capabilityFailureTranslationKeys(code: string): { readonly status: string; readonly reason: string } {
  switch (code) {
    case 'CAPABILITY_RESULT_FAILURE_INVALID_INPUT':
    case 'CAPABILITY_RESULT_FAILURE_VALIDATION':
      return { status: 'turn.capabilityFailure.status.unableToRun', reason: 'turn.capabilityFailure.reason.invalidInput' };
    case 'CAPABILITY_RESULT_FAILURE_FULL_READ_REQUIRED':
      return { status: 'turn.capabilityFailure.status.couldNotComplete', reason: 'turn.capabilityFailure.reason.fullReadRequired' };
    case 'CAPABILITY_RESULT_FAILURE_TARGET_CHANGED':
      return { status: 'turn.capabilityFailure.status.couldNotComplete', reason: 'turn.capabilityFailure.reason.targetChanged' };
    case 'CAPABILITY_RESULT_FAILURE_NOT_FOUND':
      return { status: 'turn.capabilityFailure.status.notFound', reason: 'turn.capabilityFailure.reason.notFound' };
    case 'CAPABILITY_RESULT_FAILURE_COMMAND_NOT_ALLOWED':
    case 'CAPABILITY_RESULT_FAILURE_PATH_REJECTED':
    case 'CAPABILITY_RESULT_FAILURE_POLICY_DENIED':
      return { status: 'turn.capabilityFailure.status.blocked', reason: 'turn.capabilityFailure.reason.policyDenied' };
    case 'CAPABILITY_RESULT_FAILURE_PLATFORM_UNSUPPORTED':
      return { status: 'turn.capabilityFailure.status.cannotRun', reason: 'turn.capabilityFailure.reason.platformUnsupported' };
    case 'CAPABILITY_RESULT_FAILURE_UNAVAILABLE':
      return { status: 'turn.capabilityFailure.status.unavailable', reason: 'turn.capabilityFailure.reason.unavailable' };
    case 'CAPABILITY_RESULT_FAILURE_TIMEOUT':
      return { status: 'turn.capabilityFailure.status.timedOut', reason: 'turn.capabilityFailure.reason.timeout' };
    case 'CAPABILITY_RESULT_FAILURE_CANCELED':
      return { status: 'turn.capabilityFailure.status.canceled', reason: 'turn.capabilityFailure.reason.canceled' };
    case 'CAPABILITY_RESULT_FAILURE_CONFLICT':
      return { status: 'turn.capabilityFailure.status.couldNotComplete', reason: 'turn.capabilityFailure.reason.conflict' };
    case 'CAPABILITY_RESULT_FAILURE_TOO_LARGE':
      return { status: 'turn.capabilityFailure.status.resultUnavailable', reason: 'turn.capabilityFailure.reason.resultTooLarge' };
    case 'CAPABILITY_RESULT_FAILURE_INTERNAL':
      return { status: 'turn.capabilityFailure.status.systemError', reason: 'turn.capabilityFailure.reason.internal' };
    default:
      return { status: 'turn.capabilityFailure.status.couldNotComplete', reason: 'turn.capabilityFailure.reason.generic' };
  }
}

function renderCountSummary(args: Record<string, unknown>, key: string, t: TFunction): string | null {
  const totalCount = readExactCountArg(args, 'totalCount');
  return totalCount === null ? null : t(key, { count: totalCount });
}

function readExactBoundedTextArg(args: Record<string, unknown>, key: string): string | null {
  return hasExactKeys(args, [key]) ? readBoundedText(args[key]) : null;
}

function readExactCountArg(args: Record<string, unknown>, key: string): number | null {
  if (!hasExactKeys(args, [key])) {
    return null;
  }
  const value = readFiniteNumber(args[key]);
  return value !== null && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function workflowSummaryKey(status: string): string | null {
  switch (status) {
    case 'succeeded':
      return 'turn.process.workflowSucceededSummary';
    case 'interrupted':
      return 'turn.process.workflowInterruptedSummary';
    case 'waiting':
      return 'turn.process.workflowWaitingSummary';
    case 'failed':
      return 'turn.process.workflowFailedSummary';
    default:
      return null;
  }
}

function hasExactKeys(record: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(record).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function readBoundedText(value: unknown): string | null {
  const text = readString(value)?.trim();
  return text !== undefined && text !== null && text.length > 0 && text.length <= summaryInlineTextMaxChars ? text : null;
}

function readFiniteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function readNonNegativeInteger(value: unknown): number | null {
  const number = readFiniteNumber(value);
  return number !== null && Number.isSafeInteger(number) && number >= 0 ? number : null;
}

function readBoolean(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null;
}
