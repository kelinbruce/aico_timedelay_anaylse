import { projectAskUserQuestionAnswerResult } from '@nextagent/agent-channel-common';
import { describe, expect, it } from 'vitest';

describe('AskUserQuestion answer projection', () => {
  it.each([1, 3, 4, 20])('preserves %i bounded answer groups', (groupCount) => {
    const answers = Array.from({ length: groupCount }, (_, index) => [`answer-${index + 1}`]);

    expect(projectAskUserQuestionAnswerResult(source(answers))).toMatchObject({
      safeResult: {
        kind: 'pendingInputAnswer',
        answers,
        truncated: false,
      },
    });
  });

  it('keeps the first 20 groups and marks a 21-group answer as truncated', () => {
    const answers = Array.from({ length: 21 }, (_, index) => [`answer-${index + 1}`]);
    const projected = projectAskUserQuestionAnswerResult(source(answers));

    expect(projected?.safeResult).toEqual({
      kind: 'pendingInputAnswer',
      answers: answers.slice(0, 20),
      truncated: true,
    });
  });

  it('bounds answer items and individual Unicode strings in order', () => {
    const emoji = '网';
    const projected = projectAskUserQuestionAnswerResult(
      source([Array.from({ length: 10 }, (_, index) => `item-${index + 1}`), [emoji.repeat(4_097)]]),
    );
    const safeResult = projected?.safeResult as {
      readonly answers: ReadonlyArray<readonly string[]>;
      readonly truncated: boolean;
    };

    expect(safeResult.answers[0]).toHaveLength(9);
    expect(Array.from(safeResult.answers[1]?.[0] ?? '')).toHaveLength(4_096);
    expect(safeResult.truncated).toBe(true);
  });

  it('omits later groups after the total Unicode budget is exhausted', () => {
    const answers = [...Array.from({ length: 6 }, () => ['网'.repeat(4_096)]), ['must-be-omitted']];
    const projected = projectAskUserQuestionAnswerResult(source(answers));
    const safeResult = projected?.safeResult as {
      readonly answers: ReadonlyArray<readonly string[]>;
      readonly truncated: boolean;
    };

    expect(safeResult.answers).toEqual(answers.slice(0, 6));
    expect(safeResult.answers.flat().reduce((total, value) => total + Array.from(value).length, 0)).toBe(24_576);
    expect(safeResult.truncated).toBe(true);
  });
});

function source(answers: ReadonlyArray<readonly string[]>) {
  return {
    capabilityId: 'AskUserQuestion',
    toolCallId: 'ask-1',
    pendingInputId: 'pending-1',
    kind: 'QUESTION',
    status: 'RECEIVED',
    answers,
  };
}
