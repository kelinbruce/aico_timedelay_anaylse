import { DEFAULT_LARGE_CONTENT_POLICY, LARGE_CONTENT_THRESHOLDS } from '@nextagent/agent-context-engine';
import { describe, expect, it } from 'vitest';

describe('large-content thresholds and default policy (refine-ts-large-content-tool-result-offload)', () => {
  it('pins the spec default thresholds', () => {
    expect(LARGE_CONTENT_THRESHOLDS.inlineMaxBytes).toBe(50_000);
    expect(LARGE_CONTENT_THRESHOLDS.previewMaxChars).toBe(2_048);
  });

  it('DEFAULT_LARGE_CONTENT_POLICY mirrors the spec defaults with no Infinity', () => {
    expect(DEFAULT_LARGE_CONTENT_POLICY).toEqual({
      inlineMaxBytes: 50_000,
      previewMaxChars: 2_048,
      infinity: false,
    });
  });
});
