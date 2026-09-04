import { describe, expect, it, vi } from 'vitest';
import { createWatermarkProvider, type WatermarkFetch, type WatermarkFetchResponse } from '../src/watermark/watermark-gateway.js';
import type { GatewayProviderCreateInput } from '@nextagent/agent-contracts/gateway';

const REMOTE_ENTRY = { gatewayId: 'gw1', adapterKind: 'watermark' as const, deploymentMode: 'REMOTE' as const };

function makeCreateInput(): GatewayProviderCreateInput {
  return {
    selectedEntries: [REMOTE_ENTRY],
    executionCorrelation: undefined,
  } as unknown as GatewayProviderCreateInput;
}

function makeFetch(response: { ok: boolean; status: number; body: unknown }): WatermarkFetch {
  return vi.fn(async (): Promise<WatermarkFetchResponse> => ({
    ok: response.ok,
    status: response.status,
    json: async () => response.body,
  }));
}

describe('createWatermarkProvider', () => {
  it('creates a REMOTE binding with a watermark port', () => {
    const provider = createWatermarkProvider({
      endpoint: 'https://wm.example.com',
      fetch: makeFetch({ ok: true, status: 200, body: { success: true, watermarkedText: 'wm-content' } }),
    });
    const bindings = provider.create(makeCreateInput());
    expect(bindings.watermark).toBeDefined();
    expect(bindings.readiness?.state).toBe('READY');
  });

  it('embedWatermark calls the external service and returns watermarked content', async () => {
    const fetch = makeFetch({ ok: true, status: 200, body: { success: true, watermarkedText: 'watermarked-text' } });
    const provider = createWatermarkProvider({ endpoint: 'https://wm.example.com', fetch });
    const bindings = provider.create(makeCreateInput());
    const result = await bindings.watermark!.embedWatermark({ text: 'original-text' });
    expect(result.success).toBe(true);
    expect(result.watermarkedText).toBe('watermarked-text');
    expect(fetch).toHaveBeenCalledOnce();
  });

  it('embedWatermark sends request body with text field', async () => {
    const fetch = makeFetch({ ok: true, status: 200, body: { success: true, watermarkedText: 'wm' } });
    const provider = createWatermarkProvider({ endpoint: 'https://wm.example.com', fetch });
    const bindings = provider.create(makeCreateInput());
    await bindings.watermark!.embedWatermark({ text: 'original-text' });
    const call = (fetch as ReturnType<typeof vi.fn>).mock.calls[0]!;
    const body = JSON.parse(call[1].body);
    expect(body.text).toBe('original-text');
  });

  it('embedWatermark returns success=false when service rejects', async () => {
    const fetch = makeFetch({ ok: true, status: 200, body: { success: false, errorCode: 'RATE_LIMIT', errorDesc: 'too many requests' } });
    const provider = createWatermarkProvider({ endpoint: 'https://wm.example.com', fetch });
    const bindings = provider.create(makeCreateInput());
    const result = await bindings.watermark!.embedWatermark({ text: 'original-text' });
    expect(result.success).toBe(false);
    expect(result.errorCode).toBe('RATE_LIMIT');
    expect(result.errorDesc).toBe('too many requests');
  });

  it('throws when service returns non-200 status', async () => {
    const fetch = makeFetch({ ok: false, status: 503, body: {} });
    const provider = createWatermarkProvider({ endpoint: 'https://wm.example.com', fetch });
    const bindings = provider.create(makeCreateInput());
    await expect(bindings.watermark!.embedWatermark({ text: 'original-text' })).rejects.toThrow();
  });

  it('throws when success is true but watermarkedText is missing', async () => {
    const fetch = makeFetch({ ok: true, status: 200, body: { success: true } });
    const provider = createWatermarkProvider({ endpoint: 'https://wm.example.com', fetch });
    const bindings = provider.create(makeCreateInput());
    await expect(bindings.watermark!.embedWatermark({ text: 'original-text' })).rejects.toThrow();
  });

  it('blocks when an unsupported adapter kind is in selectedEntries', () => {
    const provider = createWatermarkProvider({
      endpoint: 'https://wm.example.com',
      fetch: makeFetch({ ok: true, status: 200, body: { success: true, watermarkedText: 'x' } }),
    });
    const input = {
      ...makeCreateInput(),
      selectedEntries: [{ gatewayId: 'gw1', adapterKind: 'guardrail' as const, deploymentMode: 'REMOTE' as const }],
    } as unknown as GatewayProviderCreateInput;
    const bindings = provider.create(input);
    expect(bindings.watermark).toBeUndefined();
    expect(bindings.readiness?.state).toBe('BLOCKED');
  });
});
