import { AgentError, brand, type JsonObject } from '@nextagent/agent-common';
import type { RagRetrievalReason, RagRetrievalResult, RagRetrievalStatus } from '@nextagent/agent-contracts/gateway';

import { defineTool, ToolDegradedResultError, type ToolDiagnosticCandidate } from '../../tools/tool-spi.js';
import { builtinToolPresentation } from '../presentation-names.js';
import { ragInputSchema, ragOutputSchema } from './rag-schemas.js';

export const ragCapabilityId = brand<string, 'CapabilityId'>('Rag');

export interface SafeRagPayload extends JsonObject {
  readonly status: RagRetrievalStatus;
  readonly results: readonly JsonObject[];
  readonly diagnostics?: {
    readonly reason: RagRetrievalReason;
  };
}

export const ragToolDefinition = defineTool({
  name: ragCapabilityId,
  ...builtinToolPresentation('Rag'),
  description:
    "Retrieve bounded knowledge chunks from the current Agent's governed knowledge sources.\n\nWhen to use:\n- This event is triggered when the build-in RAG tool is specified\n\nWhen NOT to use:\n- To search workspace files, use Grep.\n- To read a known file, use Read.\n\nKey behaviors:\n- Omit `indexes` to search the Agent's configured default logical indexes; pass `indexes` only when the user specified one or more index names.\n- If omitted-index retrieval reports `INDEX_NOT_FOUND`, `INDEX_NOT_READY`, `NO_INDEX`, `PROVIDER_UNAVAILABLE` or `TIMEOUT`, ask the user to specify an available index name.\n- `status=OK` returns complete results. Incomplete retrieval is degraded only when safe chunks are available; failures without chunks are reported through `safeError` without a business payload.\n- Each result includes `content`, `source`, optional `title`, `score`, and `rankHint`.",
  inputSchema: ragInputSchema,
  outputSchema: ragOutputSchema,
  requiredDependencies: ['ragRetrieval'],
  replayPolicy: 'IDEMPOTENT',
  observability: {
    safeCompletionDiagnostics: safeRagCompletionDiagnostics,
  },
  async execute(input: JsonObject, options) {
    if (options?.context === undefined || options.deps?.ragRetrieval === undefined) {
      throw new AgentError({
        code: options?.context === undefined ? 'TOOL_CONTEXT_MISSING' : 'TOOL_DEPENDENCY_MISSING',
        message:
          options?.context === undefined
            ? 'Knowledge retrieval could not start because its trusted execution context is unavailable. Use the current conversation context, choose another available capability, or stop and report the missing execution context.'
            : 'Knowledge retrieval could not start because the governed retrieval dependency is unavailable. Use the current conversation context, choose another available capability, or stop and report the unavailable retrieval boundary.',
        category: options?.context === undefined ? 'INTERNAL' : 'UNAVAILABLE',
        retryable: false,
      });
    }
    if (options.signal?.aborted === true) {
      throw new AgentError({
        code: 'CANCELED',
        category: 'CANCELED',
        retryable: false,
        message: 'Knowledge retrieval was canceled.',
      });
    }
    const query = String(input.query).trim().slice(0, 2048);
    const indexes = readIndexes(input.indexes, options.deps.ragDefaultIndexes);
    const topK = typeof input.topK === 'number' ? input.topK : 5;
    const result = await options.deps.ragRetrieval.retrieve(
      {
        tenantId: options.context.identityContext.tenantId,
        subjectId: options.context.identityContext.subjectId,
        agentId: options.context.agentId,
        agentVersion: options.context.agentVersion,
        knowledgeScope: { scopeKind: 'AGENT_WORKSPACE', logicalRoot: 'workspace' },
        query,
        indexes,
        options: { topK },
      },
      options.signal,
    );
    const payload = safeResultPayload(result, topK);
    if (payload.status === 'OK') {
      return payload;
    }
    if (payload.status === 'DEGRADED' && payload.diagnostics?.reason === 'NO_RESULTS_FOUND' && payload.results.length === 0) {
      return safePayload('OK', []);
    }
    if (payload.status === 'DEGRADED' && payload.results.length > 0) {
      const reason = payload.diagnostics?.reason ?? 'RAG_PARTIAL_RESULT';
      const message =
        reason === 'INDEX_NOT_READY'
          ? 'Knowledge retrieval returned partial chunks and the selected index is not fully ready. Use the returned chunks, choose another available index, or check index status later.'
          : 'Knowledge retrieval returned partial chunks and the remaining scope could not be completed. Use the returned chunks or narrow the retrieval scope.';
      throw new ToolDegradedResultError(payload, reason, { safeMessage: message });
    }
    if (payload.results.length > 0) {
      throw internalRagError();
    }
    return throwRagFailure(payload);
  },
});

function throwRagFailure(payload: SafeRagPayload): never {
  const reason = payload.diagnostics?.reason;
  if (payload.status === 'CANCELED' || reason === 'CANCELED') {
    throw new AgentError({ code: 'CANCELED', category: 'CANCELED', retryable: false, message: 'Knowledge retrieval was canceled.' });
  }
  if (payload.status === 'NO_INDEX' || reason === 'NO_INDEX' || reason === 'INDEX_NOT_FOUND') {
    throw new AgentError({
      code: 'RAG_INDEX_NOT_FOUND',
      category: 'NOT_FOUND',
      retryable: false,
      message: 'The requested knowledge index does not exist. Choose a currently available index or end retrieval.',
    });
  }
  if (reason === 'INDEX_NOT_READY') {
    throw new AgentError({
      code: 'RAG_INDEX_NOT_READY',
      category: 'CONFLICT',
      retryable: false,
      message: 'The selected knowledge index is not ready yet. Choose another available index or check index status later.',
    });
  }
  if (reason === 'SCOPE_MISMATCH') {
    throw new AgentError({
      code: 'RAG_SCOPE_MISMATCH',
      category: 'AUTHORIZATION',
      retryable: false,
      message:
        'The requested knowledge index is outside the current trusted retrieval scope and cannot be accessed from this context. Choose an index already available in this scope, continue without retrieval, or stop and report the access boundary.',
    });
  }
  if (reason === 'PROVIDER_UNAVAILABLE' || reason === 'FTS5_UNAVAILABLE') {
    throw new AgentError({
      code: reason,
      category: 'UNAVAILABLE',
      retryable: true,
      message: 'The knowledge provider is temporarily unavailable. Try again later or choose another available index.',
    });
  }
  if (payload.status === 'TIMEOUT' || reason === 'TIMEOUT') {
    throw new AgentError({
      code: 'TIMEOUT',
      category: 'TIMEOUT',
      retryable: true,
      message: 'Knowledge retrieval timed out without usable chunks. Choose another available index or try again later.',
    });
  }
  throw internalRagError();
}

function internalRagError(): AgentError {
  return new AgentError({
    code: 'RAG_EXECUTION_FAILED',
    category: 'INTERNAL',
    retryable: false,
    message: 'Knowledge retrieval failed during result validation. The call has stopped. Stop this action and report the error.',
  });
}

function safeRagCompletionDiagnostics(input: { readonly structuredPayload: JsonObject }): readonly ToolDiagnosticCandidate[] {
  const reasonCode = ragReasonCode(input.structuredPayload);
  const diagnostics: ToolDiagnosticCandidate[] = [
    { key: 'toolResultStatus', value: typeof input.structuredPayload['status'] === 'string' ? input.structuredPayload['status'] : 'unknown' },
    { key: 'toolResultCountBucket', value: ragResultCountBucket(input.structuredPayload) },
  ];
  if (reasonCode !== undefined) {
    diagnostics.push({ key: 'reasonCode', value: reasonCode });
  }
  return diagnostics;
}

function readIndexes(value: unknown, defaultIndexes?: readonly string[]): readonly string[] {
  if (Array.isArray(value)) {
    return value.map((item) => String(item));
  }
  return defaultIndexes ?? ['local'];
}

function safeResultPayload(result: RagRetrievalResult, topK: number): SafeRagPayload {
  if (!isSafeStatus(result.status) || !Array.isArray(result.results)) {
    return safePayload('FAILED', [], 'INVALID_PROVIDER_RESULT');
  }
  const diagnostics = safeDiagnostics(result.diagnostics, result.status);
  if (diagnostics === undefined) {
    return safePayload('FAILED', [], 'INVALID_PROVIDER_RESULT');
  }
  const bounded = result.results.slice(0, topK);
  return safePayload(
    result.status,
    bounded.map((item) => ({
      content: item.content,
      source: item.source,
      ...(item.title === undefined ? {} : { title: item.title }),
      ...(item.score === undefined ? {} : { score: item.score }),
      ...(item.rankHint === undefined ? {} : { rankHint: item.rankHint }),
    })),
    diagnostics,
  );
}

function safePayload(status: RagRetrievalStatus, results: readonly JsonObject[], reason?: RagRetrievalReason): SafeRagPayload {
  return status === 'OK' ? { status, results } : { status, results, diagnostics: { reason: reason ?? statusToReason(status) } };
}

function safeDiagnostics(diagnostics: unknown, status: RagRetrievalStatus): RagRetrievalReason | undefined {
  if (diagnostics === undefined) {
    return statusToReason(status);
  }
  if (diagnostics === null || typeof diagnostics !== 'object' || Array.isArray(diagnostics)) {
    return undefined;
  }
  const reason = (diagnostics as Record<string, unknown>).reason;
  if (reason === undefined) {
    return statusToReason(status);
  }
  return isSafeReason(reason) ? reason : undefined;
}

function statusToReason(status: RagRetrievalStatus): RagRetrievalReason {
  switch (status) {
    case 'OK':
      return 'EXECUTION_FAILED';
    case 'NO_INDEX':
      return 'NO_INDEX';
    case 'UNAVAILABLE':
      return 'PROVIDER_UNAVAILABLE';
    case 'DEGRADED':
      return 'INDEX_NOT_READY';
    case 'TIMEOUT':
      return 'TIMEOUT';
    case 'CANCELED':
      return 'CANCELED';
    case 'FAILED':
      return 'EXECUTION_FAILED';
    default: {
      const exhaustive: never = status;
      throw new Error(`Unhandled case: ${String(exhaustive)}`);
    }
  }
}

function isSafeStatus(value: unknown): value is RagRetrievalStatus {
  return (
    value === 'OK' ||
    value === 'NO_INDEX' ||
    value === 'UNAVAILABLE' ||
    value === 'DEGRADED' ||
    value === 'FAILED' ||
    value === 'TIMEOUT' ||
    value === 'CANCELED'
  );
}

function isSafeReason(value: unknown): value is RagRetrievalReason {
  return (
    value === 'INVALID_INPUT' ||
    value === 'PROVIDER_UNAVAILABLE' ||
    value === 'FTS5_UNAVAILABLE' ||
    value === 'INDEX_NOT_READY' ||
    value === 'INDEX_NOT_FOUND' ||
    value === 'NO_RESULTS_FOUND' ||
    value === 'NO_INDEX' ||
    value === 'SCOPE_MISMATCH' ||
    value === 'WORKSPACE_READ_FAILED' ||
    value === 'DECODE_FAILED' ||
    value === 'CAPACITY_EXCEEDED' ||
    value === 'BUILD_FAILED' ||
    value === 'CLEANUP_FAILED' ||
    value === 'TIMEOUT' ||
    value === 'CANCELED' ||
    value === 'INVALID_PROVIDER_RESULT' ||
    value === 'EXECUTION_FAILED'
  );
}

function ragResultCountBucket(structuredPayload: JsonObject): '0' | '1' | '2-10' | '11-100' | '101+' | 'unknown' {
  const results = structuredPayload['results'];
  return countBucket(Array.isArray(results) ? results.length : undefined);
}

function countBucket(rawCount?: number): '0' | '1' | '2-10' | '11-100' | '101+' | 'unknown' {
  if (rawCount === undefined || !Number.isFinite(rawCount) || rawCount < 0) {
    return 'unknown';
  }
  if (rawCount === 0) {
    return '0';
  }
  if (rawCount === 1) {
    return '1';
  }
  if (rawCount <= 10) {
    return '2-10';
  }
  if (rawCount <= 100) {
    return '11-100';
  }
  return '101+';
}

function ragReasonCode(structuredPayload: JsonObject): string | undefined {
  const diagnostics = structuredPayload['diagnostics'];
  if (diagnostics === null || typeof diagnostics !== 'object' || Array.isArray(diagnostics)) {
    return undefined;
  }
  const reason = (diagnostics as JsonObject)['reason'];
  return typeof reason === 'string' ? reason : undefined;
}
