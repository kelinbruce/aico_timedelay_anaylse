import { AgentError, type JsonObject } from '@nextagent/agent-common';
import type { WorkflowNodeHandlerContext, WorkflowNodeHandlerResult } from './types.js';
import { coerceNumber, firstNonEmptyString, isRecord, projectNodeOutputs, resolveNodeValue } from './shared.js';

export interface BatchExecutionConfig {
  readonly items: readonly unknown[];
  readonly elementVariable: string;
  readonly batchSize: number;
  readonly mode: 'serial' | 'parallel';
  readonly failStrategy: 'continue' | 'abort';
  readonly parallelism: number;
  readonly resultMerge: 'append' | 'map';
}

export interface BatchElementFailure {
  readonly code: string;
  readonly message: string;
}

export type BatchElementResult = { readonly result: JsonObject } | { readonly failed: BatchElementFailure };

export type BatchProcessElement = (element: unknown, index: number, signal: AbortSignal) => Promise<BatchElementResult>;

export interface BatchOutput {
  readonly batchResults: JsonObject | readonly JsonObject[];
  readonly failedItems: readonly JsonObject[];
  readonly batchAborted: boolean;
  readonly elementResults: ReadonlyArray<JsonObject | undefined>;
}

export type BatchBuildOutput = (output: BatchOutput) => JsonObject;

export function readBatchConfig(context: WorkflowNodeHandlerContext): BatchExecutionConfig | undefined {
  const rawBatchConfig = context.node.batchConfig;
  if (rawBatchConfig === undefined) {
    return undefined;
  }
  const resolved = resolveNodeValue(rawBatchConfig, context.variables);
  if (!isRecord(resolved)) {
    return undefined;
  }
  const items = resolved.batchInputDataItem;
  if (!Array.isArray(items) || items.length === 0) {
    throw new AgentError({
      code: 'WORKFLOW_BATCH_INPUT_INVALID',
      message: 'Workflow batch batchInputDataItem must be a non-empty array.',
      category: 'VALIDATION',
      retryable: false,
      safeDetails: {
        reasonCode: 'WORKFLOW_BATCH_INPUT_INVALID',
        nodeId: context.nodeId,
        nodeType: context.node.type,
      },
    });
  }
  const rawParallelism = asPositiveInteger(resolved.batchParallelism) || 5;
  return {
    items,
    elementVariable: firstNonEmptyString(resolved.batchElementVariable) ?? 'element',
    batchSize: asPositiveInteger(resolved.batchSize) || 10,
    mode: resolved.batchMode === 'parallel' ? 'parallel' : 'serial',
    failStrategy: resolved.batchFailStrategy === 'abort' ? 'abort' : 'continue',
    parallelism: Math.min(rawParallelism, 20),
    resultMerge: resolved.batchResultMerge === 'map' ? 'map' : 'append',
  };
}

export async function executeBatch(
  config: BatchExecutionConfig,
  context: WorkflowNodeHandlerContext,
  processElement: BatchProcessElement,
  buildOutput: BatchBuildOutput,
): Promise<WorkflowNodeHandlerResult> {
  const batches = chunkArray(config.items, config.batchSize);
  const results: Array<JsonObject | undefined> = new Array(config.items.length);
  const failedItems: JsonObject[] = [];
  let batchAborted = false;
  // Batch-scoped abort controller: when failStrategy is abort, the first
  // element failure aborts this controller, cancelling in-flight requests
  // that were given its signal. It also forwards parent signal aborts.
  const batchAbortController = new AbortController();
  const onParentAbort = () => batchAbortController.abort();
  context.signal.addEventListener('abort', onParentAbort, { once: true });

  const processOne = async (element: unknown, index: number): Promise<void> => {
    // Skip if already aborted before this worker picks up an element.
    if (batchAborted || context.signal.aborted) {
      return;
    }
    const elementResult = await processElement(element, index, batchAbortController.signal);
    // If a sibling worker aborted while this request was in flight, the
    // result is collateral cancellation — do not record it as a failure.
    if (batchAborted || context.signal.aborted) {
      return;
    }
    if ('failed' in elementResult) {
      failedItems.push(createBatchFailedItem(element, index, elementResult.failed));
      if (config.failStrategy === 'abort') {
        batchAborted = true;
        batchAbortController.abort();
      }
      return;
    }
    results[index] = elementResult.result;
  };

  const processBatch = async (batch: readonly unknown[], startIndex: number): Promise<void> => {
    for (let i = 0; i < batch.length; i++) {
      if (batchAborted || context.signal.aborted) {
        return;
      }
      await processOne(batch[i]!, startIndex + i);
    }
  };

  const shouldAbort = () => batchAborted || context.signal.aborted;

  if (config.mode === 'parallel') {
    await mapWithConcurrency(config.items, config.parallelism, processOne, shouldAbort);
  } else {
    for (let i = 0; i < batches.length; i++) {
      if (batchAborted || context.signal.aborted) {
        break;
      }
      await processBatch(batches[i]!, i * config.batchSize);
    }
  }

  context.signal.removeEventListener('abort', onParentAbort);

  if (context.signal.aborted) {
    throw aborted();
  }

  const successResults = results.filter((r): r is JsonObject => r !== undefined);
  const batchResults = config.resultMerge === 'map' ? mergeBatchResultsAsMap(results, config.items) : Object.freeze(successResults);

  const output: BatchOutput = {
    batchResults,
    failedItems: Object.freeze(failedItems),
    batchAborted,
    elementResults: results,
  };

  return {
    ...(batchAborted ? { status: 'NODE_FAILED' as const } : {}),
    outputVariables: projectNodeOutputs(context.node.outputs, buildOutput(output), context.node),
  };
}

export function createBatchFailedItem(element: unknown, index: number, failure: BatchElementFailure): JsonObject {
  return Object.freeze({
    index,
    item: element,
    error: {
      code: failure.code,
      message: failure.message,
    },
  }) as JsonObject;
}

export function chunkArray<T>(items: readonly T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size) as T[]);
  }
  return chunks;
}

export function mergeBatchResultsAsMap(results: readonly unknown[], items: readonly unknown[]): JsonObject {
  const map: Record<string, unknown> = {};
  for (let i = 0; i < results.length; i++) {
    if (results[i] === undefined) {
      continue;
    }
    const element = items[i];
    const key = isRecord(element) && typeof element.key === 'string' && element.key.length > 0 ? element.key : String(i);
    map[key] = results[i];
  }
  return Object.freeze(map) as JsonObject;
}

async function mapWithConcurrency<T>(
  items: readonly T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<void>,
  shouldAbort: () => boolean,
): Promise<void> {
  let nextIndex = 0;
  const workerCount = Math.min(concurrency, items.length);
  const workers = Array.from({ length: workerCount }, async () => {
    while (true) {
      if (shouldAbort()) {
        return;
      }
      const index = nextIndex;
      nextIndex += 1;
      if (index >= items.length) {
        return;
      }
      await fn(items[index]!, index);
    }
  });
  await Promise.all(workers);
}

export function aborted(): AgentError {
  return new AgentError({
    code: 'WORKFLOW_INTERRUPTED',
    message: 'Workflow execution was interrupted safely.',
    category: 'CANCELED',
    retryable: false,
    safeDetails: { reasonCode: 'WORKFLOW_INTERRUPTED' },
  });
}

function asPositiveInteger(value: unknown): number {
  const numeric = coerceNumber(value);
  return numeric !== undefined && Number.isInteger(numeric) && numeric > 0 ? numeric : 0;
}
