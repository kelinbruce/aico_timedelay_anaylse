import type { ReferenceRemoteQuestionRecommendationClient } from './reference-remote-question-recommendation-gateway.js';

type FetchLike = (
  input: string,
  init?: { readonly method?: string; readonly headers?: Record<string, string>; readonly body?: string; readonly signal?: AbortSignal },
) => Promise<FetchLikeResponse>;

interface FetchLikeResponse {
  readonly ok: boolean;
  readonly status: number;
  json: () => Promise<unknown>;
}

export interface HttpQuestionRecommendationClientOptions {
  readonly frequentHistoryEndpoint: string;
  readonly similarQuestionEndpoint: string;
  readonly fetch?: FetchLike;
  readonly credentialResolver?: () => Promise<string | undefined>;
}

export function createHttpQuestionRecommendationClient(
  options: HttpQuestionRecommendationClientOptions,
): ReferenceRemoteQuestionRecommendationClient {
  const fetchFn: FetchLike = options.fetch ?? globalThis.fetch;

  async function resolveHeaders(): Promise<Record<string, string>> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    const credential = options.credentialResolver !== undefined ? await options.credentialResolver() : undefined;
    if (credential !== undefined) {
      headers['Authorization'] = `Bearer ${credential}`;
    }
    return headers;
  }

  return {
    async listFrequentHistoryQuestions(request, extraHeaders, signal) {
      const headers = { ...(await resolveHeaders()), ...extraHeaders };
      const init: { method: string; headers: Record<string, string>; body: string; signal?: AbortSignal } = {
        method: 'POST',
        headers,
        body: JSON.stringify(request),
      };
      if (signal !== undefined) {
        init.signal = signal;
      }
      const response = await fetchFn(options.frequentHistoryEndpoint, init);
      if (!response.ok) {
        throw new Error(`Provider returned status ${response.status}`);
      }
      return response.json();
    },

    async recommendSimilarPresetQuestions(request, signal) {
      const headers = await resolveHeaders();
      const init: { method: string; headers: Record<string, string>; body: string; signal?: AbortSignal } = {
        method: 'POST',
        headers,
        body: JSON.stringify(request),
      };
      if (signal !== undefined) {
        init.signal = signal;
      }
      const response = await fetchFn(options.similarQuestionEndpoint, init);
      if (!response.ok) {
        throw new Error(`Provider returned status ${response.status}`);
      }
      return response.json();
    },
  };
}
