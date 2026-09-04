import type { JsonObject } from '@nextagent/agent-common';

const answerGroupLimit = 20;
const answerItemLimit = 9;
const answerStringCodePointLimit = 4_096;
const answerTotalCodePointLimit = 24_576;

export function projectAskUserQuestionAnswerResult(source: JsonObject): JsonObject | undefined {
  if (source.capabilityId !== 'AskUserQuestion' || source.kind !== 'QUESTION' || source.status !== 'RECEIVED') {
    return undefined;
  }
  const toolCallId = readNonEmptyString(source.toolCallId);
  const pendingInputId = readNonEmptyString(source.pendingInputId);
  const answers = readCanonicalAnswers(source.answers);
  if (toolCallId === undefined || pendingInputId === undefined || answers === undefined) {
    return undefined;
  }

  const bounded = boundAnswers(answers);
  return {
    capabilityId: 'AskUserQuestion',
    toolCallId,
    pendingInputId,
    kind: 'QUESTION',
    status: 'RECEIVED',
    safeSummary: 'Pending input answer received.',
    safeResult: {
      kind: 'pendingInputAnswer',
      answers: bounded.answers,
      truncated: bounded.truncated,
    },
  };
}

function readNonEmptyString(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function readCanonicalAnswers(value: unknown): ReadonlyArray<readonly string[]> | undefined {
  if (!Array.isArray(value) || value.length === 0) {
    return undefined;
  }
  const answers: string[][] = [];
  for (const group of value) {
    if (!Array.isArray(group) || group.length === 0) {
      return undefined;
    }
    const answerGroup: string[] = [];
    for (const item of group) {
      if (typeof item !== 'string' || item.trim().length === 0) {
        return undefined;
      }
      answerGroup.push(item);
    }
    answers.push(answerGroup);
  }
  return answers;
}

function boundAnswers(answers: ReadonlyArray<readonly string[]>): {
  readonly answers: ReadonlyArray<readonly string[]>;
  readonly truncated: boolean;
} {
  const boundedGroups: string[][] = [];
  let remainingCodePoints = answerTotalCodePointLimit;
  let truncated = answers.length > answerGroupLimit;

  for (const group of answers.slice(0, answerGroupLimit)) {
    const boundedGroup: string[] = [];
    if (group.length > answerItemLimit) {
      truncated = true;
    }
    for (const item of group.slice(0, answerItemLimit)) {
      if (remainingCodePoints === 0) {
        truncated = true;
        break;
      }
      const codePoints = Array.from(item);
      const allowedCodePoints = Math.min(codePoints.length, answerStringCodePointLimit, remainingCodePoints);
      if (allowedCodePoints < codePoints.length) {
        truncated = true;
      }
      const boundedItem = codePoints.slice(0, allowedCodePoints).join('');
      if (boundedItem.length === 0) {
        truncated = true;
        break;
      }
      boundedGroup.push(boundedItem);
      remainingCodePoints -= allowedCodePoints;
    }
    if (boundedGroup.length > 0) {
      boundedGroups.push(boundedGroup);
    } else {
      truncated = true;
      break;
    }
  }

  return { answers: boundedGroups, truncated };
}
