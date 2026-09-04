import type { JsonObject, SecretReference } from '@nextagent/agent-common';

export interface WorkflowRemoteExecutionGatewayConfig {
  readonly endpoint: string;
  readonly credentialRef?: SecretReference | string;
  readonly timeoutMs?: number;
}

export interface FetchWorkflowRemoteExecutionGatewayOptions {
  readonly fetch?: FetchLike;
  readonly credentialResolver?: (credentialRef: SecretReference | string) => Promise<string>;
}

export type FetchWorkflowRemoteFailureReasonCode =
  'WORKFLOW_REMOTE_UNAVAILABLE' | 'WORKFLOW_REMOTE_TIMEOUT' | 'WORKFLOW_REMOTE_UNAUTHORIZED' | 'WORKFLOW_REMOTE_INVALID_RESPONSE';

export type FetchWorkflowRemoteStreamItem =
  | { readonly kind: 'event'; readonly event: JsonObject }
  | { readonly kind: 'result'; readonly result: JsonObject }
  | { readonly kind: 'failure'; readonly reasonCode: FetchWorkflowRemoteFailureReasonCode; readonly message: string };

export interface FetchWorkflowRemoteExecutionGateway {
  execute: (request: JsonObject, signal: AbortSignal) => AsyncIterable<FetchWorkflowRemoteStreamItem>;
}

type FetchLike = (
  input: string,
  init?: {
    readonly method?: string;
    readonly headers?: Record<string, string>;
    readonly body?: string;
    readonly signal?: AbortSignal;
  },
) => Promise<FetchLikeResponse>;

interface FetchLikeResponse {
  readonly ok: boolean;
  readonly status: number;
  readonly body?: ReadableStream<Uint8Array> | NodeJS.ReadableStream | null;
}

export function createFetchWorkflowRemoteExecutionGateway(
  config: WorkflowRemoteExecutionGatewayConfig,
  options: FetchWorkflowRemoteExecutionGatewayOptions = {},
): FetchWorkflowRemoteExecutionGateway {
  const fetchImpl = options.fetch ?? (globalThis.fetch as unknown as FetchLike);
  return new FetchWorkflowRemoteExecutionGatewayAdapter(config, fetchImpl, options.credentialResolver);
}

const FAILURE_MESSAGE = 'Remote workflow execution failed safely.';

class FetchWorkflowRemoteExecutionGatewayAdapter implements FetchWorkflowRemoteExecutionGateway {
  constructor(
    private readonly config: WorkflowRemoteExecutionGatewayConfig,
    private readonly fetchImpl: FetchLike,
    private readonly credentialResolver?: (credentialRef: SecretReference | string) => Promise<string>,
  ) {}

  async *execute(request: JsonObject, signal: AbortSignal): AsyncIterable<FetchWorkflowRemoteStreamItem> {
    const controller = new AbortController();
    const timeoutMs = this.config.timeoutMs;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    if (timeoutMs !== undefined) {
      timeout = setTimeout(() => controller.abort(), timeoutMs);
    }
    const onParentAbort = (): void => controller.abort();
    if (signal.aborted) {
      controller.abort();
    } else {
      signal.addEventListener('abort', onParentAbort, { once: true });
    }

    try {
      const response = await this.fetchImpl(`${trimSlash(this.config.endpoint)}/workflow/execute`, {
        method: 'POST',
        headers: { ...(await this.buildHeaders()), accept: 'text/event-stream' },
        body: JSON.stringify(request),
        signal: controller.signal,
      });
      if (!response.ok) {
        yield failureFromHttpStatus(response.status);
        return;
      }
      if (response.body === undefined || response.body === null) {
        yield failureFromCode('WORKFLOW_REMOTE_INVALID_RESPONSE');
        return;
      }
      yield* consumeSseStream(response.body, controller.signal, signal);
    } catch {
      if (signal.aborted) {
        yield failureFromCode('WORKFLOW_REMOTE_TIMEOUT');
        return;
      }
      const isTimeout = controller.signal.aborted && !signal.aborted;
      yield failureFromCode(isTimeout ? 'WORKFLOW_REMOTE_TIMEOUT' : 'WORKFLOW_REMOTE_UNAVAILABLE');
    } finally {
      if (timeout !== undefined) {
        clearTimeout(timeout);
      }
      signal.removeEventListener('abort', onParentAbort);
    }
  }

  private async buildHeaders(): Promise<Record<string, string>> {
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (this.config.credentialRef === undefined || this.credentialResolver === undefined) {
      return headers;
    }
    const credential = await this.credentialResolver(this.config.credentialRef);
    return { ...headers, authorization: `Bearer ${credential}` };
  }
}

async function* consumeSseStream(
  body: ReadableStream<Uint8Array> | NodeJS.ReadableStream,
  linkedSignal: AbortSignal,
  parentSignal: AbortSignal,
): AsyncIterable<FetchWorkflowRemoteStreamItem> {
  const reader = isWebReadableStream(body) ? body.getReader() : wrapNodeStream(body as NodeJS.ReadableStream);

  let buffer = '';
  let terminated = false;
  try {
    while (!terminated) {
      const chunk = await reader.read();
      if (chunk.done) {
        break;
      }
      buffer += decoder.decode(chunk.value, { stream: true });
      let frameEnd: number;
      while ((frameEnd = buffer.indexOf('\n\n')) !== -1) {
        const frame = buffer.slice(0, frameEnd);
        buffer = buffer.slice(frameEnd + 2);
        const item = parseSseFrame(frame);
        if (item === undefined) {
          continue;
        }
        yield item;
        if (item.kind === 'result' || item.kind === 'failure') {
          terminated = true;
          break;
        }
      }
    }
    if (!terminated) {
      yield failureFromCode('WORKFLOW_REMOTE_INVALID_RESPONSE');
    }
  } catch {
    if (parentSignal.aborted) {
      yield failureFromCode('WORKFLOW_REMOTE_TIMEOUT');
      return;
    }
    if (linkedSignal.aborted && !parentSignal.aborted) {
      yield failureFromCode('WORKFLOW_REMOTE_TIMEOUT');
      return;
    }
    yield failureFromCode('WORKFLOW_REMOTE_INVALID_RESPONSE');
  } finally {
    if (typeof (reader as { cancel?: () => Promise<void> }).cancel === 'function') {
      await (reader as { cancel: () => Promise<void> }).cancel();
    }
  }
}

function parseSseFrame(frame: string): FetchWorkflowRemoteStreamItem | undefined {
  const lines = frame.split('\n');
  let eventType = '';
  let data = '';
  for (const line of lines) {
    if (line.startsWith('event:')) {
      eventType = line.slice(6).trim();
    } else if (line.startsWith('data:')) {
      data += line.slice(5).trim();
    }
  }
  if (eventType === '' || data === '') {
    return undefined;
  }
  let payload: unknown;
  try {
    payload = JSON.parse(data);
  } catch {
    return undefined;
  }
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) {
    return failureFromCode('WORKFLOW_REMOTE_INVALID_RESPONSE');
  }
  if (eventType === 'event') {
    return { kind: 'event', event: payload as JsonObject };
  }
  if (eventType === 'result') {
    return { kind: 'result', result: payload as JsonObject };
  }
  if (eventType === 'failure') {
    const record = payload as Record<string, unknown>;
    const reasonCode = record.reasonCode;
    if (typeof reasonCode !== 'string') {
      return failureFromCode('WORKFLOW_REMOTE_INVALID_RESPONSE');
    }
    return {
      kind: 'failure',
      reasonCode: reasonCode as FetchWorkflowRemoteFailureReasonCode,
      message: typeof record.message === 'string' ? record.message : FAILURE_MESSAGE,
    };
  }
  return undefined;
}

function failureFromHttpStatus(status: number): FetchWorkflowRemoteStreamItem {
  const reasonCode: FetchWorkflowRemoteFailureReasonCode =
    status === 401 || status === 403
      ? 'WORKFLOW_REMOTE_UNAUTHORIZED'
      : status === 408 || status === 504
        ? 'WORKFLOW_REMOTE_TIMEOUT'
        : 'WORKFLOW_REMOTE_UNAVAILABLE';
  return { kind: 'failure', reasonCode, message: FAILURE_MESSAGE };
}

function failureFromCode(reasonCode: FetchWorkflowRemoteFailureReasonCode): FetchWorkflowRemoteStreamItem {
  return { kind: 'failure', reasonCode, message: FAILURE_MESSAGE };
}

function isWebReadableStream(body: unknown): body is ReadableStream<Uint8Array> {
  return typeof (body as ReadableStream<Uint8Array>)?.getReader === 'function';
}

function wrapNodeStream(stream: NodeJS.ReadableStream): { read: () => Promise<{ done: boolean; value: Uint8Array }> } {
  const iterator = stream[Symbol.asyncIterator]();
  return {
    async read() {
      const result = await iterator.next();
      if (result.done === true) {
        return { done: true, value: new Uint8Array() };
      }
      const chunk = result.value;
      return { done: false, value: chunk instanceof Uint8Array ? chunk : Buffer.from(chunk as string) };
    },
  };
}

const decoder = new TextDecoder();

function trimSlash(value: string): string {
  return value.replace(/\/+$/u, '');
}
