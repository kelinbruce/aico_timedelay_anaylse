import { describe, expect, it } from 'vitest';

import { parseSingleTaskMessage, projectTaskMessageInput } from '../src/task-message.js';

describe('TaskMessage', () => {
  it('projects a text message', () => {
    expect(projectTaskMessageInput(parseSingleTaskMessage([{ text: 'diagnose alarm' }]))).toEqual({
      inputText: 'diagnose alarm',
    });
  });

  it('projects only a valid metadata eventId as taskEventId', () => {
    expect(
      projectTaskMessageInput(
        parseSingleTaskMessage([
          {
            text: 'diagnose alarm',
            metadata: { eventId: 'alarm_01: ran', ignored: 'not propagated' },
          },
        ]),
      ),
    ).toEqual({
      inputText: 'diagnose alarm',
      taskEventId: 'alarm_01: ran',
    });
  });

  it.each(['', 'a'.repeat(33), '事件', 'line\nbreak'])('rejects invalid metadata eventId %j', (eventId) => {
    expect(() => parseSingleTaskMessage([{ text: 'diagnose alarm', metadata: { eventId } }])).toThrow('exactly one valid TaskMessage');
  });

  it('projects data with stable key ordering', () => {
    expect(projectTaskMessageInput(parseSingleTaskMessage([{ data: { z: 1, a: { d: 2, c: 1 } } }]))).toEqual({
      inputText: '{"a":{"c":1,"d":2},"z":1}',
      inputVariables: { z: 1, a: { d: 2, c: 1 } },
    });
  });

  it('decodes an inline raw file', () => {
    const projected = projectTaskMessageInput(
      parseSingleTaskMessage([
        {
          fileContent: {
            raw: Buffer.from('alarm-data', 'utf8').toString('base64'),
            filename: 'alarm.txt',
            mediaType: 'text/plain',
          },
        },
      ]),
    );

    expect(projected.inputText).toBe('The task input is provided in the attached file.');
    expect(Buffer.from(projected.inlineFile?.bytes ?? []).toString('utf8')).toBe('alarm-data');
  });

  it('projects a remote file without fetching it', () => {
    expect(
      projectTaskMessageInput(
        parseSingleTaskMessage([
          {
            fileContent: {
              url: 'https://files.example/alarm.txt',
              filename: 'alarm.txt',
              mediaType: 'text/plain',
            },
          },
        ]),
      ),
    ).toEqual({
      inputText: 'The task input is provided in the attached file.',
      remoteFile: {
        url: 'https://files.example/alarm.txt',
        fileName: 'alarm.txt',
        declaredMimeType: 'text/plain',
      },
    });
  });

  const invalidInputs: readonly unknown[] = [
    [],
    [{ text: 'one' }, { text: 'two' }],
    [{ text: 'one', data: {} }],
    [{ fileContent: { raw: 'YQ==', url: 'https://files.example/a', filename: 'a', mediaType: 'text/plain' } }],
  ];
  invalidInputs.forEach((input, index) => {
    it(`rejects invalid one-of input ${index + 1}`, () => {
      expect(() => parseSingleTaskMessage(input)).toThrow('exactly one valid TaskMessage');
    });
  });

  it('rejects malformed base64', () => {
    expect(() =>
      projectTaskMessageInput(
        parseSingleTaskMessage([
          {
            fileContent: { raw: 'not-base64', filename: 'a.txt', mediaType: 'text/plain' },
          },
        ]),
      ),
    ).toThrow('valid base64');
  });
});
