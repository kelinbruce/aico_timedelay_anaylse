import type { ModelFinalResult, ModelStreamDelta } from '@nextagent/agent-contracts/model';

import { ModelErrorNormalizer } from './error-normalizer.js';

const errorNormalizer = new ModelErrorNormalizer();

export class ModelStreamConsumerError extends Error {
  constructor(readonly cause: unknown) {
    super('Model stream consumer failed.');
  }
}

export async function emitModelStreamDelta(consumer: (delta: ModelStreamDelta) => Promise<void>, delta: ModelStreamDelta): Promise<void> {
  try {
    await consumer(delta);
  } catch (error) {
    throw new ModelStreamConsumerError(error);
  }
}

export function safeModelInvocationFailure(error: unknown, signal: AbortSignal): ModelFinalResult {
  if (signal.aborted) {
    return {
      content: '',
      safeError: {
        code: 'MODEL_ABORTED',
        message: 'Model invocation was canceled.',
        category: 'CANCELED',
        retryable: false,
      },
    };
  }
  return {
    content: '',
    safeError: errorNormalizer.normalize(error),
  };
}
