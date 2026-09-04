import type {
  GatewayAdapterKind,
  GatewayBindings,
  GatewayProvider,
  GatewayProviderCreateInput,
  WatermarkGatewayPort,
  WatermarkEmbedInput,
  WatermarkEmbedResult,
} from '@nextagent/agent-contracts/gateway';

export interface WatermarkProviderOptions {
  readonly providerId?: string;
  readonly endpoint: string;
  readonly fetch?: WatermarkFetch;
}

export type WatermarkFetch = (
  input: string,
  init?: {
    readonly method?: string;
    readonly headers?: Record<string, string>;
    readonly body?: string;
    readonly signal?: AbortSignal;
  },
) => Promise<WatermarkFetchResponse>;

export interface WatermarkFetchResponse {
  readonly ok: boolean;
  readonly status: number;
  readonly json: () => Promise<unknown>;
}

const watermarkAdapterKinds: readonly GatewayAdapterKind[] = ['watermark'];

interface WatermarkResponseBody {
  readonly success?: boolean;
  readonly watermarkedText?: string;
  readonly errorCode?: string;
  readonly errorDesc?: string;
}

/**
 * Reference implementation of a REMOTE watermark gateway provider.
 *
 * Calls an external watermark service URL and returns the watermarked text.
 * The caller (channel layer) catches all exceptions and degrades to
 * returning the original content (fail-open).
 *
 * Timeout is hardcoded at 10 seconds per spec. The provider accepts an
 * AbortSignal for caller-initiated cancellation.
 */
export function createWatermarkProvider(options: WatermarkProviderOptions): GatewayProvider {
  const providerId = options.providerId ?? 'remote-watermark';
  const endpoint = options.endpoint.replace(/\/+$/, '');
  const doFetch = options.fetch ?? defaultFetch;
  return {
    providerId,
    deploymentMode: 'REMOTE',
    supportedAdapterKinds: watermarkAdapterKinds,
    create(input: GatewayProviderCreateInput): GatewayBindings {
      const unsupported = input.selectedEntries.find(
        (entry) => entry.deploymentMode !== 'REMOTE' || !watermarkAdapterKinds.includes(entry.adapterKind),
      );
      if (unsupported !== undefined) {
        return blockedWatermarkBindings(providerId, `adapter:${unsupported.adapterKind}:unsupported`);
      }
      const port: WatermarkGatewayPort = {
        embedWatermark: (request: WatermarkEmbedInput, signal?: AbortSignal) => embedWatermark(doFetch, endpoint, request, signal),
      };
      return readyWatermarkBindings(providerId, port);
    },
  };
}

async function embedWatermark(
  fetch: WatermarkFetch,
  endpoint: string,
  input: WatermarkEmbedInput,
  signal?: AbortSignal,
): Promise<WatermarkEmbedResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);
  if (signal !== undefined) {
    signal.addEventListener('abort', () => controller.abort(), { once: true });
  }
  try {
    const response = await fetch(`${endpoint}/rest/naie/inter/compliancehub/watermark/v1/embed`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: input.text }),
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`watermark service returned status ${response.status}`);
    }
    const body = (await response.json()) as WatermarkResponseBody;
    if (body.success !== true) {
      return {
        success: false,
        watermarkedText: '',
        errorCode: body.errorCode ?? '',
        errorDesc: body.errorDesc ?? '',
      };
    }
    if (typeof body.watermarkedText !== 'string') {
      throw new Error('watermark service returned invalid response: missing watermarkedText field');
    }
    return {
      success: true,
      watermarkedText: body.watermarkedText,
      errorCode: '',
      errorDesc: '',
    };
  } finally {
    clearTimeout(timeout);
  }
}

function readyWatermarkBindings(providerId: string, port: WatermarkGatewayPort): GatewayBindings {
  return {
    providerId,
    deploymentMode: 'REMOTE',
    readiness: {
      state: 'READY',
      evidenceRef: `watermark:${providerId}`,
      safeMessage: 'Watermark binding is ready.',
    },
    watermark: port,
  };
}

function blockedWatermarkBindings(providerId: string, reason: string): GatewayBindings {
  return {
    providerId,
    deploymentMode: 'REMOTE',
    readiness: {
      state: 'BLOCKED',
      evidenceRef: `watermark:${providerId}`,
      safeMessage: reason,
    },
  };
}

async function defaultFetch(
  input: string,
  init?: { readonly method?: string; readonly headers?: Record<string, string>; readonly body?: string; readonly signal?: AbortSignal },
): Promise<WatermarkFetchResponse> {
  const response = await fetch(input, init as RequestInit | undefined);
  return { ok: response.ok, status: response.status, json: () => response.json() };
}
