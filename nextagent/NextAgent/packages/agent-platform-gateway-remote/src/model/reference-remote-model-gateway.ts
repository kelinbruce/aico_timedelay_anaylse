import type {
  ModelFinalResult,
  ModelGatewayModelInformationService,
  ModelGatewayProvider,
  ModelInvocationRequest,
  ModelInvocationService,
  ModelStreamDelta,
} from '@nextagent/agent-contracts/model';
import { ModelFinalResultSchema, ModelStreamDeltaSchema } from '@nextagent/agent-contracts/model';
import { Ajv } from 'ajv/dist/ajv.js';

const ajv = new Ajv({ allErrors: true, strict: false });
const validateModelFinalResult = ajv.compile(ModelFinalResultSchema);
const validateModelStreamDelta = ajv.compile(ModelStreamDeltaSchema);

export interface ReferenceRemoteModelGatewayClient {
  complete: (request: ModelInvocationRequest, signal: AbortSignal) => Promise<ModelFinalResult>;
  stream: (request: ModelInvocationRequest, signal: AbortSignal, onDelta: (delta: ModelStreamDelta) => Promise<void>) => Promise<ModelFinalResult>;
}

export interface ReferenceRemoteModelGatewayProviderOptions {
  readonly providerId?: string;
  readonly client: ReferenceRemoteModelGatewayClient;
  readonly modelInformationService?: ModelGatewayModelInformationService;
}

export function createReferenceRemoteModelGatewayProvider(options: ReferenceRemoteModelGatewayProviderOptions): ModelGatewayProvider {
  const providerId = options.providerId ?? 'remote-model-gateway';
  return {
    providerId,
    createModelService() {
      return createReferenceRemoteModelGatewayService(options.client);
    },
    createModelInformationService() {
      return (
        options.modelInformationService ?? {
          async get() {
            return {
              status: 'UNAVAILABLE',
              reason: 'MODEL_INFORMATION_UNAVAILABLE',
            };
          },
        }
      );
    },
  };
}

export function createReferenceRemoteModelGatewayService(client: ReferenceRemoteModelGatewayClient): ModelInvocationService {
  return {
    async complete(request, signal) {
      try {
        const result = await client.complete(request, signal);
        return isModelFinalResult(result) ? result : unavailable();
      } catch {
        return unavailable();
      }
    },
    async stream(request, signal, onDelta) {
      try {
        let invalidDelta = false;
        const result = await client.stream(request, signal, async (delta) => {
          if (!isModelStreamDelta(delta)) {
            invalidDelta = true;
            return;
          }
          try {
            await onDelta(delta);
          } catch (error) {
            throw new DeltaHandlerError(error);
          }
        });
        if (invalidDelta || !isModelFinalResult(result)) {
          return unavailable();
        }
        return result;
      } catch (error) {
        if (error instanceof DeltaHandlerError) {
          throw error.cause;
        }
        return unavailable();
      }
    },
  };
}

function isModelFinalResult(value: unknown): value is ModelFinalResult {
  return validateModelFinalResult(value);
}

function isModelStreamDelta(value: unknown): value is ModelStreamDelta {
  return validateModelStreamDelta(value);
}

class DeltaHandlerError extends Error {
  constructor(readonly cause: unknown) {
    super('Model stream delta handler failed.');
  }
}

function unavailable(): ModelFinalResult {
  return {
    content: '',
    safeError: {
      code: 'MODEL_GATEWAY_UNAVAILABLE',
      message: 'Remote model gateway is unavailable.',
      category: 'UNAVAILABLE',
      retryable: true,
    },
  };
}
