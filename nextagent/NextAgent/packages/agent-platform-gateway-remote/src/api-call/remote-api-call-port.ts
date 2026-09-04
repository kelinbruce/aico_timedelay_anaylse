import type { ApiCallPort, ApiCallRequest, ApiCallResult, ApiCallStreamChunk } from '@nextagent/agent-contracts/capability';

/**
 * REMOTE deployment mode ApiCallPort implementation via UDS (Unix Domain Socket).
 * This is a placeholder that returns UNAVAILABLE. The actual UDS implementation
 * will be added in a follow-up change.
 */
export function createRemoteApiCallPort(): ApiCallPort {
  return {
    async callApi(_request: ApiCallRequest, _signal: AbortSignal): Promise<ApiCallResult> {
      return {
        status: 503,
        headers: {},
        body: '',
      };
    },
    async *callApiStream(_request: ApiCallRequest, _signal: AbortSignal): AsyncIterable<ApiCallStreamChunk> {
      return;
    },
  };
}
