import type { ModelInvocationRequest } from '@nextagent/agent-contracts/model';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanupE2ETestContext, createE2ETestContext, type E2ETestContext } from './e2e-helpers.js';

describe('model invocation scope e2e', () => {
  let ctx: E2ETestContext | undefined;

  afterEach(async () => {
    if (ctx !== undefined) {
      await cleanupE2ETestContext(ctx);
      ctx = undefined;
    }
  });

  it('propagates accepted session and run coordinates into model invocation scope', async () => {
    const modelRequests: ModelInvocationRequest[] = [];
    ctx = await createE2ETestContext({
      tempPrefix: 'nextagent-model-scope-',
      modelSteps: [{ contentChunks: ['scope', ' ok'] }],
      modelRequestSink: modelRequests,
    });

    const accepted = await fetch(`${ctx.baseUrl}/api/v1/requests`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        inputText: 'Check model invocation scope.',
        idempotencyKey: `model-scope-${crypto.randomUUID()}`,
        locale: 'en-US',
      }),
    });
    expect(accepted.status).toBe(200);
    const acceptedBody = (await accepted.json()) as { readonly sessionId: string; readonly requestId: string; readonly runId: string };

    const stream = await fetch(`${ctx.baseUrl}/api/v1/sessions/${acceptedBody.sessionId}/stream?lastSeenSequence=0&runId=${acceptedBody.runId}`);
    expect(stream.status).toBe(200);
    expect(await stream.text()).toContain('REQUEST_COMPLETED');

    const requestModelInvocation = modelRequests.find((request) => request.invocationScope.requestId === acceptedBody.requestId);
    expect(requestModelInvocation).toBeDefined();
    expect(requestModelInvocation?.invocationScope).toMatchObject({
      agentId: 'default-agent',
      sessionId: acceptedBody.sessionId,
      requestId: acceptedBody.requestId,
      runId: acceptedBody.runId,
    });
    expect(requestModelInvocation?.invocationScope.operationId).toBe('turn-1');
    expect(JSON.stringify(requestModelInvocation?.messages)).not.toContain(acceptedBody.sessionId);
    expect(JSON.stringify(requestModelInvocation?.messages)).not.toContain(acceptedBody.runId);
  }, 20_000);
});
