import type { JsonObject } from '@nextagent/agent-common';
import { Value } from '@sinclair/typebox/value';
import type {
  WorkflowExecutionEvent,
  WorkflowExecutionRequest,
  WorkflowExecutionResult,
  WorkflowRemoteExecutionFailureReasonCode,
  WorkflowRemoteExecutionGateway,
  WorkflowRemoteExecutionStreamItem,
} from '@nextagent/agent-contracts/core';
import { WorkflowExecutionEventSchema, WorkflowExecutionResultSchema } from '@nextagent/agent-contracts/core';

const BRIDGE_FAILURE_MESSAGE = 'Remote workflow execution failed safely.';

export interface FetchWorkflowRemoteExecutionGateway {
  execute: (
    request: JsonObject,
    signal: AbortSignal,
  ) => AsyncIterable<
    { readonly kind: 'event'; readonly event: unknown } | { readonly kind: 'result'; readonly result: unknown } | WorkflowRemoteExecutionStreamItem
  >;
}

export function adaptFetchWorkflowRemoteGateway(fetch: FetchWorkflowRemoteExecutionGateway): WorkflowRemoteExecutionGateway {
  return {
    async *execute(request: WorkflowExecutionRequest, signal: AbortSignal): AsyncIterable<WorkflowRemoteExecutionStreamItem> {
      for await (const item of fetch.execute(request as unknown as JsonObject, signal)) {
        if (item.kind === 'event') {
          if (!Value.Check(WorkflowExecutionEventSchema, item.event)) {
            yield failureFromCode('WORKFLOW_REMOTE_INVALID_RESPONSE');
            return;
          }
          yield { kind: 'event', event: deserializeEvent(item.event as SerializedWorkflowExecutionEvent) };
        } else if (item.kind === 'result') {
          if (!Value.Check(WorkflowExecutionResultSchema, item.result)) {
            yield failureFromCode('WORKFLOW_REMOTE_INVALID_RESPONSE');
            return;
          }
          yield { kind: 'result', result: deserializeResult(item.result as SerializedWorkflowExecutionResult) };
        } else {
          yield item;
        }
      }
    },
  };
}

type SerializedWorkflowExecutionEvent = Omit<WorkflowExecutionEvent, 'startedAt' | 'completedAt'> & {
  readonly startedAt: string;
  readonly completedAt?: string;
};

type SerializedWorkflowExecutionResult = Omit<WorkflowExecutionResult, 'startedAt' | 'completedAt' | 'nodeResults'> & {
  readonly startedAt: string;
  readonly completedAt: string;
  readonly nodeResults: ReadonlyArray<
    Omit<WorkflowExecutionResult['nodeResults'][number], 'startedAt' | 'completedAt'> & {
      readonly startedAt: string;
      readonly completedAt: string;
    }
  >;
};

function deserializeEvent(event: SerializedWorkflowExecutionEvent): WorkflowExecutionEvent {
  const { startedAt, completedAt, ...rest } = event;
  return {
    ...rest,
    startedAt: new Date(startedAt),
    ...(completedAt === undefined ? {} : { completedAt: new Date(completedAt) }),
  };
}

function deserializeResult(result: SerializedWorkflowExecutionResult): WorkflowExecutionResult {
  const { startedAt, completedAt, nodeResults, ...rest } = result;
  return {
    ...rest,
    startedAt: new Date(startedAt),
    completedAt: new Date(completedAt),
    nodeResults: nodeResults.map((node) => {
      const { startedAt: nodeStartedAt, completedAt: nodeCompletedAt, ...nodeRest } = node;
      return {
        ...nodeRest,
        startedAt: new Date(nodeStartedAt),
        completedAt: new Date(nodeCompletedAt),
      };
    }),
  };
}

function failureFromCode(reasonCode: WorkflowRemoteExecutionFailureReasonCode): WorkflowRemoteExecutionStreamItem {
  return { kind: 'failure', reasonCode, message: BRIDGE_FAILURE_MESSAGE };
}

type BridgeStreamItem =
  { readonly kind: 'event'; readonly event: unknown } | { readonly kind: 'result'; readonly result: unknown } | WorkflowRemoteExecutionStreamItem;

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

export function createFetchWorkflowRemoteExecutionGatewayFromEndpoint(endpoint: string): FetchWorkflowRemoteExecutionGateway {
  const fetchImpl = globalThis.fetch as unknown as FetchLike;
  return new EndpointFetchGateway(endpoint, fetchImpl);
}

class EndpointFetchGateway implements FetchWorkflowRemoteExecutionGateway {
  constructor(
    private readonly endpoint: string,
    private readonly fetchImpl: FetchLike,
  ) {}

  async *execute(request: JsonObject, signal: AbortSignal): AsyncIterable<BridgeStreamItem> {
    const controller = new AbortController();
    const onAbort = (): void => controller.abort();
    if (signal.aborted) {
      controller.abort();
    } else {
      signal.addEventListener('abort', onAbort, { once: true });
    }
    try {
      const response = await this.fetchImpl(`${this.endpoint.replace(/\/+$/u, '')}/workflow/execute`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'text/event-stream' },
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
      yield failureFromCode(signal.aborted ? 'WORKFLOW_REMOTE_TIMEOUT' : 'WORKFLOW_REMOTE_UNAVAILABLE');
    } finally {
      signal.removeEventListener('abort', onAbort);
    }
  }
}

async function* consumeSseStream(
  body: ReadableStream<Uint8Array> | NodeJS.ReadableStream,
  linkedSignal: AbortSignal,
  parentSignal: AbortSignal,
): AsyncIterable<BridgeStreamItem> {
  const reader =
    typeof (body as ReadableStream<Uint8Array>)?.getReader === 'function'
      ? (body as ReadableStream<Uint8Array>).getReader()
      : wrapNodeStream(body as NodeJS.ReadableStream);
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

function parseSseFrame(frame: string): BridgeStreamItem | undefined {
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
    return { kind: 'event', event: payload };
  }
  if (eventType === 'result') {
    return { kind: 'result', result: payload };
  }
  if (eventType === 'failure') {
    const record = payload as Record<string, unknown>;
    const reasonCode = record.reasonCode;
    if (typeof reasonCode !== 'string') {
      return failureFromCode('WORKFLOW_REMOTE_INVALID_RESPONSE');
    }
    return {
      kind: 'failure',
      reasonCode: reasonCode as WorkflowRemoteExecutionFailureReasonCode,
      message: typeof record.message === 'string' ? record.message : BRIDGE_FAILURE_MESSAGE,
    };
  }
  return undefined;
}

function failureFromHttpStatus(status: number): WorkflowRemoteExecutionStreamItem {
  const reasonCode: WorkflowRemoteExecutionFailureReasonCode =
    status === 401 || status === 403
      ? 'WORKFLOW_REMOTE_UNAUTHORIZED'
      : status === 408 || status === 504
        ? 'WORKFLOW_REMOTE_TIMEOUT'
        : 'WORKFLOW_REMOTE_UNAVAILABLE';
  return { kind: 'failure', reasonCode, message: BRIDGE_FAILURE_MESSAGE };
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
