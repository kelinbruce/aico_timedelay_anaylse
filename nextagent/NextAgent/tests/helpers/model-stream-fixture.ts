import type { ModelFinalResult, ModelInvocationRequest, ModelInvocationService, ModelStreamDelta } from '@nextagent/agent-contracts/model';

type ModelEventFixture = (request: ModelInvocationRequest, signal: AbortSignal) => AsyncIterable<ModelStreamDelta | ModelFinalResult>;

export function modelEventStreamFixture(events: ModelEventFixture): ModelInvocationService['stream'] {
  return async (request, signal, onDelta) => {
    let pending: ModelStreamDelta | ModelFinalResult | undefined;
    for await (const event of events(request, signal)) {
      if (pending !== undefined) {
        await onDelta(pending as ModelStreamDelta);
      }
      pending = event;
    }
    if (pending === undefined) {
      throw new Error('Model stream fixture requires a terminal result.');
    }
    return pending as ModelFinalResult;
  };
}

export async function collectModelStream(
  service: ModelInvocationService,
  request: ModelInvocationRequest,
  signal: AbortSignal,
): Promise<Array<ModelStreamDelta | ModelFinalResult>> {
  const events: Array<ModelStreamDelta | ModelFinalResult> = [];
  const result = await service.stream(request, signal, async (delta) => {
    events.push(delta);
  });
  events.push(result);
  return events;
}
