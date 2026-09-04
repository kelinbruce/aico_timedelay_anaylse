import { describe, expect, it } from 'vitest';
import { renderCompactedPlaceholder, replaceCapabilityResultPayload } from '../src/micro-compact/content-replacer.js';

describe('renderCompactedPlaceholder', () => {
  it('is deterministic (same input → same output)', () => {
    const a = renderCompactedPlaceholder({ originalSize: 1000, toolName: 'bash' });
    const b = renderCompactedPlaceholder({ originalSize: 1000, toolName: 'bash' });
    expect(a).toBe(b);
  });

  it('contains originalSize and toolName', () => {
    const result = renderCompactedPlaceholder({ originalSize: 5000, toolName: 'read' });
    expect(result).toContain('5000');
    expect(result).toContain('read');
  });

  it('uses XML tag structure', () => {
    const result = renderCompactedPlaceholder({ originalSize: 100, toolName: 'grep' });
    expect(result).toContain('<compacted-tool-result>');
    expect(result).toContain('</compacted-tool-result>');
  });

  it('includes re-obtain hint', () => {
    const result = renderCompactedPlaceholder({ originalSize: 100, toolName: 'write' });
    expect(result).toContain('re-obtained by re-invoking the tool');
  });
});

describe('replaceCapabilityResultPayload', () => {
  it('preserves toolCallId and toolName, replaces payload', () => {
    const raw = JSON.stringify({
      toolCallId: 'tc-123',
      toolName: 'bash',
      payload: 'original output content',
    });
    const placeholder = '<compacted/>';
    const result = replaceCapabilityResultPayload(raw, placeholder);
    const parsed = JSON.parse(result);

    expect(parsed.toolCallId).toBe('tc-123');
    expect(parsed.toolName).toBe('bash');
    expect(parsed.payload).toEqual({ compacted: placeholder });
  });

  it('falls back to full replacement for non-JSON content', () => {
    const result = replaceCapabilityResultPayload('not json', '<compacted/>');
    expect(result).toBe('<compacted/>');
  });

  it('falls back to full replacement for JSON without toolCallId', () => {
    const raw = JSON.stringify({ someOtherField: 'value' });
    const result = replaceCapabilityResultPayload(raw, '<compacted/>');
    expect(result).toBe('<compacted/>');
  });

  it('falls back to full replacement when toolCallId is not string', () => {
    const raw = JSON.stringify({ toolCallId: 42, toolName: 'bash' });
    const result = replaceCapabilityResultPayload(raw, '<compacted/>');
    expect(result).toBe('<compacted/>');
  });

  it('handles JSON with object payload', () => {
    const raw = JSON.stringify({
      toolCallId: 'tc-456',
      toolName: 'read',
      payload: { stdout: 'line1\nline2', exitCode: 0 },
    });
    const placeholder = '<compacted/>';
    const result = replaceCapabilityResultPayload(raw, placeholder);
    const parsed = JSON.parse(result);

    expect(parsed.toolCallId).toBe('tc-456');
    expect(parsed.payload).toEqual({ compacted: placeholder });
  });
});
