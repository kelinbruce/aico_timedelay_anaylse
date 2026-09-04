import { createLocalApiCallPort } from '@nextagent/agent-platform-gateway-local';
import type { ApiCallRequest } from '@nextagent/agent-contracts/capability';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('local ApiCall gateway timeout', () => {
  it('reaches an IPv6 literal endpoint over a real socket', async () => {
    let receivedRequest = false;
    const server = createServer((_request, response) => {
      receivedRequest = true;
      response.writeHead(200, { 'content-type': 'text/plain' });
      response.end('IPv6 api-call response');
    });
    try {
      const port = await listenOnIpv6Loopback(server);
      const result = await createLocalApiCallPort().callApi(request(1_000, `http://[::1]:${port}`), new AbortController().signal);

      expect(result).toMatchObject({ status: 200, body: 'IPv6 api-call response' });
      expect(receivedRequest).toBe(true);
    } finally {
      await closeServer(server);
    }
  });

  it('enforces request.timeoutMs for non-streaming calls', async () => {
    vi.stubGlobal('fetch', abortableFetch());

    await expect(createLocalApiCallPort().callApi(request(), new AbortController().signal)).rejects.toMatchObject({
      name: 'TimeoutError',
    });
  });

  it('enforces request.timeoutMs while opening a streaming call', async () => {
    vi.stubGlobal('fetch', abortableFetch());

    const consume = async (): Promise<void> => {
      for await (const _chunk of createLocalApiCallPort().callApiStream(request(), new AbortController().signal)) {
        // The mocked fetch never opens the stream.
      }
    };
    await expect(consume()).rejects.toMatchObject({ name: 'TimeoutError' });
  });

  it('preserves parent cancellation instead of relabeling it as a timeout', async () => {
    vi.stubGlobal('fetch', abortableFetch());
    const controller = new AbortController();
    const pending = createLocalApiCallPort().callApi(request(1_000), controller.signal);
    controller.abort();

    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('cancels the response stream when its consumer stops early', async () => {
    const canceled = vi.fn();
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>(async () =>
        Promise.resolve(
          new Response(
            new ReadableStream<Uint8Array>({
              start(controller) {
                controller.enqueue(new TextEncoder().encode('data: first\n\n'));
              },
              cancel: canceled,
            }),
          ),
        ),
      ),
    );

    for await (const chunk of createLocalApiCallPort().callApiStream(request(1_000), new AbortController().signal)) {
      expect(chunk).toEqual({ data: 'first' });
      break;
    }

    expect(canceled).toHaveBeenCalledOnce();
  });

  it.each([
    ['HTTP failure', new Response('upstream failed', { status: 500 })],
    ['missing response body', new Response(null, { status: 200 })],
  ])('rejects a streaming %s instead of completing successfully', async (_caseName, response) => {
    const fetchMock = vi.fn<typeof fetch>(async () => Promise.resolve(response));
    vi.stubGlobal('fetch', fetchMock);

    const consume = async (): Promise<void> => {
      for await (const _chunk of createLocalApiCallPort().callApiStream(request(1_000), new AbortController().signal)) {
        // Invalid responses must fail before emitting a chunk.
      }
    };

    await expect(consume()).rejects.toThrow('API stream response is unavailable.');
    expect(fetchMock).toHaveBeenCalledOnce();
  });
});

function abortableFetch(): typeof fetch {
  return vi.fn<typeof fetch>(async (_input, init) => {
    const signal = init?.signal;
    if (signal === null || signal === undefined) {
      throw new Error('Expected an effective AbortSignal.');
    }
    await new Promise<void>((_resolve, reject) => {
      if (signal.aborted) {
        reject(signal.reason);
        return;
      }
      signal.addEventListener('abort', () => reject(signal.reason), { once: true });
    });
    throw new Error('unreachable');
  });
}

function request(timeoutMs = 10, baseUrl = 'https://example.test'): ApiCallRequest {
  return {
    baseUrl,
    path: '/health',
    method: 'GET',
    headers: {},
    timeoutMs,
  };
}

async function listenOnIpv6Loopback(server: Server): Promise<number> {
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '::1', () => {
      server.removeListener('error', reject);
      resolve();
    });
  });
  return (server.address() as AddressInfo).port;
}

async function closeServer(server: Server): Promise<void> {
  if (!server.listening) {
    return;
  }
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error === undefined ? resolve() : reject(error)));
  });
}
