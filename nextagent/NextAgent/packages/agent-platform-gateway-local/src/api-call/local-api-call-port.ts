import type { ApiCallPort, ApiCallRequest, ApiCallResult, ApiCallStreamChunk } from '@nextagent/agent-contracts/capability';

export function createLocalApiCallPort(): ApiCallPort {
  return new LocalApiCallGatewayAdapter();
}

class LocalApiCallGatewayAdapter implements ApiCallPort {
  async callApi(request: ApiCallRequest, signal: AbortSignal): Promise<ApiCallResult> {
    const url = buildUrl(request.baseUrl, request.path);
    const headers = { ...request.headers };
    const timeoutSignal = AbortSignal.timeout(request.timeoutMs);
    try {
      const response = await fetch(url, {
        method: request.method,
        headers,
        ...(request.body === undefined ? {} : { body: request.body }),
        signal: AbortSignal.any([signal, timeoutSignal]),
      });

      const body = await response.text();
      return {
        status: response.status,
        headers: headersToRecord(response.headers),
        body,
      };
    } catch (error) {
      throw normalizedAbortReason(error, signal, timeoutSignal);
    }
  }

  async *callApiStream(request: ApiCallRequest, signal: AbortSignal): AsyncIterable<ApiCallStreamChunk> {
    const url = buildUrl(request.baseUrl, request.path);
    const headers = { ...request.headers };
    const timeoutSignal = AbortSignal.timeout(request.timeoutMs);
    try {
      const response = await fetch(url, {
        method: request.method,
        headers,
        ...(request.body === undefined ? {} : { body: request.body }),
        signal: AbortSignal.any([signal, timeoutSignal]),
      });

      if (!response.ok || response.body === null) {
        throw new Error('API stream response is unavailable.');
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let completed = false;
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) {
            completed = true;
            break;
          }
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() ?? '';

          for (const line of lines) {
            const trimmed = line.trim();
            if (trimmed.startsWith('data:')) {
              const data = trimmed.slice(5).trim();
              if (data.length > 0) {
                yield { data };
              }
            }
          }
        }
        if (buffer.trim().startsWith('data:')) {
          const data = buffer.trim().slice(5).trim();
          if (data.length > 0) {
            yield { data };
          }
        }
      } finally {
        if (!completed) {
          await reader.cancel().catch(() => undefined);
        }
        reader.releaseLock();
      }
    } catch (error) {
      throw normalizedAbortReason(error, signal, timeoutSignal);
    }
  }
}

function normalizedAbortReason(error: unknown, parentSignal: AbortSignal, timeoutSignal: AbortSignal): unknown {
  if (!parentSignal.aborted && timeoutSignal.aborted) {
    return timeoutSignal.reason;
  }
  return error;
}

function buildUrl(baseUrl: string, path: string): string {
  const trimmedBase = baseUrl.replace(/\/+$/u, '');
  const trimmedPath = path.startsWith('/') ? path : `/${path}`;
  return `${trimmedBase}${trimmedPath}`;
}

function headersToRecord(headers: Headers): Record<string, string> {
  const record: Record<string, string> = {};
  headers.forEach((value, key) => {
    record[key] = value;
  });
  return record;
}
