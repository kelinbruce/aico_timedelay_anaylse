import type { IdentityContext } from '@nextagent/agent-common';
import { afterAll, describe, expect, it } from 'vitest';
import { createE2ETestContext, cleanupE2ETestContext } from '../e2e-helpers.js';
import { recordCaseResult } from './case-inventory.js';

describe('alpha-06: owner scope isolation', () => {
  it('cross-owner session access returns safe not-found', async () => {
    const startedAt = new Date().toISOString();

    // Owner A creates session content
    const ctxA = await createE2ETestContext({
      modelSteps: [{ contentChunks: ['A'] }],
      tempPrefix: 'nextagent-akg-06a-',
      identity: { tenantId: 'tenant-a', subjectId: 'subject-a', displayName: 'User A' } as IdentityContext,
    });
    let sessionIdOwnerA = '';
    try {
      const createResp = await fetch(`${ctxA.baseUrl}/api/v1/sessions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({}),
      });
      const sessionA = (await createResp.json()) as { sessionId: string };
      sessionIdOwnerA = sessionA.sessionId;

      const submitResp = await fetch(`${ctxA.baseUrl}/api/v1/requests`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ inputText: 'Owner A question.', sessionId: sessionA.sessionId, idempotencyKey: `alpha-06-a-${crypto.randomUUID()}` }),
      });
      const submitBody = (await submitResp.json()) as { runId: string };
      await (await fetch(`${ctxA.baseUrl}/api/v1/sessions/${sessionA.sessionId}/stream?lastSeenSequence=0&runId=${submitBody.runId}`)).text();
    } finally {
      await cleanupE2ETestContext(ctxA);
    }

    // Owner B tries to access owner A's session
    const ctxB = await createE2ETestContext({
      modelSteps: [{ contentChunks: ['B'] }],
      tempPrefix: 'nextagent-akg-06b-',
      identity: { tenantId: 'tenant-b', subjectId: 'subject-b', displayName: 'User B' } as IdentityContext,
    });
    try {
      const crossSession = await fetch(`${ctxB.baseUrl}/api/v1/sessions/${sessionIdOwnerA}/conversation?limit=10`);
      expect(crossSession.status).toBe(404);
      const errorBody = await crossSession.text();
      expect(errorBody).not.toContain('exists');
      expect(errorBody).not.toContain('tenant-a');
      expect(errorBody).not.toContain(sessionIdOwnerA);

      recordCaseResult('alpha-06', 'PASSED', { startedAt, endedAt: new Date().toISOString() });
    } catch (error) {
      recordCaseResult('alpha-06', 'FAILED', {
        safeReason: error instanceof Error ? error.message : String(error),
        startedAt,
        endedAt: new Date().toISOString(),
      });
    } finally {
      await cleanupE2ETestContext(ctxB);
    }
  }, 30_000);

  it('cross-owner conversation access returns safe not-found', async () => {
    const startedAt = new Date().toISOString();

    const ctxX = await createE2ETestContext({
      modelSteps: [{ contentChunks: ['X'] }],
      tempPrefix: 'nextagent-akg-06c-',
      identity: { tenantId: 'tenant-x', subjectId: 'subject-x', displayName: 'User X' } as IdentityContext,
    });
    let sessionIdOwnerX = '';
    try {
      const createResp = await fetch(`${ctxX.baseUrl}/api/v1/sessions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({}),
      });
      const session = (await createResp.json()) as { sessionId: string };
      sessionIdOwnerX = session.sessionId;
      const submitResp = await fetch(`${ctxX.baseUrl}/api/v1/requests`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ inputText: 'Owner X question.', sessionId: session.sessionId, idempotencyKey: `alpha-06-x-${crypto.randomUUID()}` }),
      });
      const submitBody = (await submitResp.json()) as { runId: string };
      await (await fetch(`${ctxX.baseUrl}/api/v1/sessions/${session.sessionId}/stream?lastSeenSequence=0&runId=${submitBody.runId}`)).text();
    } finally {
      await cleanupE2ETestContext(ctxX);
    }

    const ctxY = await createE2ETestContext({
      modelSteps: [{ contentChunks: ['Y'] }],
      tempPrefix: 'nextagent-akg-06d-',
      identity: { tenantId: 'tenant-y', subjectId: 'subject-y', displayName: 'User Y' } as IdentityContext,
    });
    try {
      const crossConv = await fetch(`${ctxY.baseUrl}/api/v1/sessions/${sessionIdOwnerX}/conversation?limit=10`);
      expect(crossConv.status).toBe(404);
      const errorBody = await crossConv.text();
      expect(errorBody).not.toContain('tenant-x');
      expect(errorBody).not.toContain('subject-x');
    } catch (error) {
      recordCaseResult('alpha-06', 'FAILED', {
        safeReason: error instanceof Error ? error.message : String(error),
        startedAt,
        endedAt: new Date().toISOString(),
      });
    } finally {
      await cleanupE2ETestContext(ctxY);
    }
  }, 30_000);
});
