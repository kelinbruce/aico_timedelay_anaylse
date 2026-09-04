import type { AgentId, RequestRunId, SessionId, TenantId, SubjectId, MessageId } from '@nextagent/agent-common';
import type { SuggestedQuestionPort, SuggestedQuestionRequest, SuggestedQuestionResult } from '@nextagent/agent-contracts/runtime';

interface CacheEntry {
  readonly state: 'computing' | 'done' | 'error';
  readonly questions: readonly string[];
  readonly promise: Promise<SuggestedQuestionResult>;
}

interface PrecomputeKey {
  readonly tenantId: TenantId;
  readonly subjectId: SubjectId;
  readonly agentId: AgentId;
  readonly sessionId: SessionId;
  readonly requestId: MessageId;
  readonly runId: RequestRunId;
}

function keyOf(request: SuggestedQuestionRequest): string {
  return `${request.tenantId}:${request.subjectId}:${request.agentId}:${request.sessionId}:${request.requestId}:${request.runId}`;
}

function keyFromPrecompute(k: PrecomputeKey): string {
  return `${k.tenantId}:${k.subjectId}:${k.agentId}:${k.sessionId}:${k.requestId}:${k.runId}`;
}

const CACHE_TTL_MS = 5 * 60 * 1000;

export interface PrecomputedSuggestedQuestionPort extends SuggestedQuestionPort {
  precompute: (key: PrecomputeKey, signal?: AbortSignal) => void;
}

export function createPrecomputedSuggestedQuestionPort(inner: SuggestedQuestionPort): PrecomputedSuggestedQuestionPort {
  const cache = new Map<string, { entry: CacheEntry; expiresAt: number }>();

  function precompute(key: PrecomputeKey, signal?: AbortSignal): void {
    const cacheKey = keyFromPrecompute(key);
    if (cache.has(cacheKey)) {
      return;
    }

    const request: SuggestedQuestionRequest = {
      tenantId: key.tenantId,
      subjectId: key.subjectId,
      agentId: key.agentId,
      sessionId: key.sessionId,
      requestId: key.requestId,
      runId: key.runId,
    };

    const promise = inner.generate(request, signal).catch(() => ({ questions: [] }));
    const entry: CacheEntry = { state: 'computing', questions: [], promise };

    promise
      .then((result) => {
        const existing = cache.get(cacheKey);
        if (existing !== undefined) {
          cache.set(cacheKey, {
            entry: { state: 'done', questions: result.questions, promise: existing.entry.promise },
            expiresAt: Date.now() + CACHE_TTL_MS,
          });
        }
      })
      .catch(() => {
        const existing = cache.get(cacheKey);
        if (existing !== undefined) {
          cache.set(cacheKey, {
            entry: { state: 'error', questions: [], promise: existing.entry.promise },
            expiresAt: Date.now() + CACHE_TTL_MS,
          });
        }
      });

    cache.set(cacheKey, { entry, expiresAt: Date.now() + CACHE_TTL_MS });
  }

  async function generate(request: SuggestedQuestionRequest, signal?: AbortSignal): Promise<SuggestedQuestionResult> {
    const cacheKey = keyOf(request);
    const cached = cache.get(cacheKey);

    if (cached !== undefined) {
      if (cached.entry.state === 'done') {
        return { questions: cached.entry.questions };
      }
      if (cached.entry.state === 'computing') {
        // Wait for the precompute to finish — avoids duplicate model calls.
        return cached.entry.promise;
      }
      // state === "error" — fall through to live computation
    }

    return inner.generate(request, signal);
  }

  // Periodic cleanup of expired entries
  const cleanupInterval = setInterval(() => {
    const now = Date.now();
    for (const [k, v] of cache) {
      if (now > v.expiresAt) {
        cache.delete(k);
      }
    }
  }, 60_000);
  if (typeof cleanupInterval.unref === 'function') {
    cleanupInterval.unref();
  }

  return { generate, precompute };
}
