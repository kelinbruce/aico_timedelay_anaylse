import { describe, expect, it } from 'vitest';

import { readSafeCapabilityResult } from '../src/features/chat/utils/safeCapabilityResult.ts';
import { tryParseStructuredMessage } from '../src/features/chat/utils/httpResponseParser.ts';

const structuredPiu = JSON.stringify({
  eventType: 'ANSWER',
  messageType: 'PIU',
  content: JSON.stringify({ piuName: 'mae_icn_sidebar_alarm', severity: 'critical' }),
});

const nonStructuredText = '根据告警分析，网元 NE-001 的光功率异常，建议检查光模块。'.repeat(800);

// Simulated SSE safeResult payloads (what the backend projection would produce)
function makeSseSafeResult(bodyContent: string, responseMode: 'BUFFERED' | 'STREAMING', streamCompleted: boolean, truncated: boolean) {
  return {
    kind: 'httpResponse' as const,
    httpStatus: 200,
    responseMode,
    streamCompleted,
    bodyPreview: bodyContent,
    bodyPreviewTruncated: truncated,
  };
}

describe('frontend httpResponse — 4 scenario verification', () => {
  const results: Array<{
    label: string;
    parsed: ReturnType<typeof readSafeCapabilityResult>;
    isStructured: boolean;
    messageType: string | null;
  }> = [];

  it('scenario 1: streaming + structured JSON — frontend identifies PIU', () => {
    // Backend would pass this through untruncated (structured → no truncation)
    const ssePayload = makeSseSafeResult(structuredPiu, 'STREAMING', false, false);
    const parsed = readSafeCapabilityResult(ssePayload);
    const bodyPreview = parsed?.kind === 'httpResponse' ? (parsed.bodyPreview ?? '') : '';
    const structured = tryParseStructuredMessage(bodyPreview);
    const r = {
      label: 'streaming+structured',
      parsed,
      isStructured: structured !== null,
      messageType: structured?.messageType ?? null,
    };
    results.push(r);
    console.log('\n===== Frontend Scenario 1: Streaming + Structured JSON =====');
    console.log('  parsed.kind:    ', parsed?.kind);
    console.log('  isStructured:   ', r.isStructured);
    console.log('  messageType:    ', r.messageType);
    console.log('  bodyPreview len:', bodyPreview.length);
    expect(parsed?.kind).toBe('httpResponse');
    expect(r.isStructured).toBe(true);
    expect(r.messageType).toBe('PIU');
  });

  it('scenario 2: streaming + non-structured text — frontend falls back to text', () => {
    // Backend would truncate to 16384 (non-structured → truncated)
    const truncatedText = nonStructuredText.slice(0, 16384) + '\n...';
    const ssePayload = makeSseSafeResult(truncatedText, 'STREAMING', false, true);
    const parsed = readSafeCapabilityResult(ssePayload);
    const bodyPreview = parsed?.kind === 'httpResponse' ? (parsed.bodyPreview ?? '') : '';
    const structured = tryParseStructuredMessage(bodyPreview);
    const isTruncated = parsed?.kind === 'httpResponse' ? (parsed.bodyPreviewTruncated ?? false) : false;
    const r = {
      label: 'streaming+non-structured',
      parsed,
      isStructured: structured !== null,
      messageType: structured?.messageType ?? null,
    };
    results.push(r);
    console.log('\n===== Frontend Scenario 2: Streaming + Non-Structured Text =====');
    console.log('  parsed.kind:       ', parsed?.kind);
    console.log('  isStructured:      ', r.isStructured);
    console.log('  bodyPreviewTruncated:', isTruncated);
    console.log('  bodyPreview len:   ', bodyPreview.length);
    expect(parsed?.kind).toBe('httpResponse');
    expect(r.isStructured).toBe(false);
    expect(isTruncated).toBe(true);
  });

  it('scenario 3: buffered + structured JSON — frontend identifies PIU', () => {
    // Backend would pass this through untruncated (structured → no truncation)
    const ssePayload = makeSseSafeResult(structuredPiu, 'BUFFERED', true, false);
    const parsed = readSafeCapabilityResult(ssePayload);
    const bodyPreview = parsed?.kind === 'httpResponse' ? (parsed.bodyPreview ?? '') : '';
    const structured = tryParseStructuredMessage(bodyPreview);
    const r = {
      label: 'buffered+structured',
      parsed,
      isStructured: structured !== null,
      messageType: structured?.messageType ?? null,
    };
    results.push(r);
    console.log('\n===== Frontend Scenario 3: Buffered + Structured JSON =====');
    console.log('  parsed.kind:    ', parsed?.kind);
    console.log('  isStructured:   ', r.isStructured);
    console.log('  messageType:    ', r.messageType);
    console.log('  bodyPreview len:', bodyPreview.length);
    expect(parsed?.kind).toBe('httpResponse');
    expect(r.isStructured).toBe(true);
    expect(r.messageType).toBe('PIU');
  });

  it('scenario 4: buffered + non-structured text — frontend falls back to text', () => {
    // Backend would truncate to 16384 (non-structured → truncated)
    const truncatedText = nonStructuredText.slice(0, 16384) + '\n...';
    const ssePayload = makeSseSafeResult(truncatedText, 'BUFFERED', true, true);
    const parsed = readSafeCapabilityResult(ssePayload);
    const bodyPreview = parsed?.kind === 'httpResponse' ? (parsed.bodyPreview ?? '') : '';
    const structured = tryParseStructuredMessage(bodyPreview);
    const isTruncated = parsed?.kind === 'httpResponse' ? (parsed.bodyPreviewTruncated ?? false) : false;
    const r = {
      label: 'buffered+non-structured',
      parsed,
      isStructured: structured !== null,
      messageType: structured?.messageType ?? null,
    };
    results.push(r);
    console.log('\n===== Frontend Scenario 4: Buffered + Non-Structured Text =====');
    console.log('  parsed.kind:       ', parsed?.kind);
    console.log('  isStructured:      ', r.isStructured);
    console.log('  bodyPreviewTruncated:', isTruncated);
    console.log('  bodyPreview len:   ', bodyPreview.length);
    expect(parsed?.kind).toBe('httpResponse');
    expect(r.isStructured).toBe(false);
    expect(isTruncated).toBe(true);
  });

  it('summary table', () => {
    console.log('\n===== Frontend Verification Summary =====');
    console.log('Scenario                | parsed.kind | isStructured | messageType | truncated');
    console.log('------------------------|-------------|--------------|-------------|----------');
    for (const r of results) {
      const name = r.label.padEnd(24);
      const kind = String(r.parsed?.kind ?? 'null').padEnd(11);
      const st = String(r.isStructured).padEnd(12);
      const mt = String(r.messageType ?? 'null').padEnd(11);
      const tr = String(r.parsed?.kind === 'httpResponse' ? (r.parsed.bodyPreviewTruncated ?? false) : 'null');
      console.log(`${name}| ${kind} | ${st} | ${mt} | ${tr}`);
    }
    expect(results).toHaveLength(4);
  });
});
