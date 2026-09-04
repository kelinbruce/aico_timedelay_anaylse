import { describe, expect, it } from 'vitest';

import { tryParseStructuredMessage } from '../src/features/chat/utils/httpResponseParser.ts';

describe('tryParseStructuredMessage', () => {
  it('returns structured message when all three fields are present', () => {
    const body = JSON.stringify({
      messageType: 'PIU',
      content: '{"piuName":"alarm_001"}',
      eventType: 'ANSWER',
    });
    const result = tryParseStructuredMessage(body);
    expect(result).toEqual({
      messageType: 'PIU',
      content: '{"piuName":"alarm_001"}',
      eventType: 'ANSWER',
    });
  });

  it('returns null when messageType is missing', () => {
    const body = JSON.stringify({ content: 'data', eventType: 'ANSWER' });
    expect(tryParseStructuredMessage(body)).toBeNull();
  });

  it('returns null when content is missing', () => {
    const body = JSON.stringify({ messageType: 'PIU', eventType: 'ANSWER' });
    expect(tryParseStructuredMessage(body)).toBeNull();
  });

  it('returns null when eventType is missing', () => {
    const body = JSON.stringify({ messageType: 'PIU', content: 'data' });
    expect(tryParseStructuredMessage(body)).toBeNull();
  });

  it('returns null for non-JSON string', () => {
    expect(tryParseStructuredMessage('this is not json')).toBeNull();
  });

  it('returns null for JSON array', () => {
    expect(tryParseStructuredMessage('[1, 2, 3]')).toBeNull();
  });

  it('returns null for JSON null', () => {
    expect(tryParseStructuredMessage('null')).toBeNull();
  });

  it('returns null for JSON primitive', () => {
    expect(tryParseStructuredMessage('42')).toBeNull();
  });

  it('returns null for empty string', () => {
    expect(tryParseStructuredMessage('')).toBeNull();
  });

  it('accepts non-string content field', () => {
    const body = JSON.stringify({
      messageType: 'DSL',
      content: { nested: 'value' },
      eventType: 'ANSWER',
    });
    const result = tryParseStructuredMessage(body);
    expect(result).not.toBeNull();
    expect(result?.messageType).toBe('DSL');
    expect(result?.eventType).toBe('ANSWER');
  });
});
