import { describe, expect, it } from 'vitest';

import { redactMemoryDisplayText } from '../src/features/memory/redactMemoryDisplayText.ts';
import { redactSensitiveDisplayText } from '../src/utils/redactSensitiveDisplayText.ts';

describe('redactSensitiveDisplayText', () => {
  it('preserves Unix and Windows absolute paths in Chat presentation text', () => {
    const text = 'Unix /opt/nextagent/config.json\nWindows C:\\Users\\operator\\alarm.log';

    expect(redactSensitiveDisplayText(text)).toBe(text);
  });

  it('preserves URLs and relative paths', () => {
    const text = 'Open https://example.com/a/b, ./logs/alarm.log, and docs/runbook.md';

    expect(redactSensitiveDisplayText(text)).toBe(text);
  });

  it('normalizes the Markdown-escaped placeholder to the canonical visible placeholder', () => {
    expect(redactSensitiveDisplayText('[REDACTED\\_PATH]')).toBe('[REDACTED_PATH]');
  });

  it('covers the shared Chat-sensitive categories while preserving paths and IP addresses', () => {
    const privateKey = '-----BEGIN PRIVATE KEY-----\nkey-material\n-----END PRIVATE KEY-----';
    const text = [
      'password=hunter2',
      'Bearer abcdefghijk',
      'sk-abcdefghijk',
      '13800138000',
      '/opt/nextagent/config.json',
      privateKey,
      '10.0.0.1',
      '2001:db8::1',
    ].join('\n');

    expect(redactSensitiveDisplayText(text)).toBe(
      [
        '[REDACTED_SECRET]',
        'Bearer [REDACTED_TOKEN]',
        '[REDACTED_TOKEN]',
        '[REDACTED_PHONE]',
        '/opt/nextagent/config.json',
        '[REDACTED_SECRET]',
        '10.0.0.1',
        '2001:db8::1',
      ].join('\n'),
    );
  });

  it('normalizes every Markdown-escaped sensitive placeholder', () => {
    expect(redactSensitiveDisplayText('[REDACTED\\_SECRET] [REDACTED\\_TOKEN] [REDACTED\\_PHONE] [REDACTED\\_PATH]')).toBe(
      '[REDACTED_SECRET] [REDACTED_TOKEN] [REDACTED_PHONE] [REDACTED_PATH]',
    );
  });
});

describe('redactMemoryDisplayText', () => {
  it('adds memory-only Unix and Windows absolute path redaction', () => {
    expect(redactMemoryDisplayText('Unix /opt/nextagent/config.json\nWindows C:\\Users\\operator\\alarm.log')).toBe(
      'Unix [REDACTED_PATH]\nWindows [REDACTED_PATH]',
    );
  });

  it('keeps the shared sensitive-category projection before applying memory path redaction', () => {
    expect(redactMemoryDisplayText('password=hunter2 at /opt/nextagent/config.json')).toBe('[REDACTED_SECRET] at [REDACTED_PATH]');
  });

  it('preserves HTML closing tags instead of redacting them as paths', () => {
    expect(redactMemoryDisplayText('<div class="foo">content</div>')).toBe('<div class="foo">content</div>');
    expect(redactMemoryDisplayText('hello </span> world')).toBe('hello </span> world');
    expect(redactMemoryDisplayText('mixed </b></i> tags and /opt/config.json path')).toBe(
      'mixed </b></i> tags and [REDACTED_PATH] path',
    );
  });
});
