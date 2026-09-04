import { afterAll, describe, expect, it } from 'vitest';
import { createE2ETestContext, cleanupE2ETestContext } from '../e2e-helpers.js';
import { recordCaseResult } from './case-inventory.js';

describe('alpha-04: SafeError security boundary', () => {
  it('returns SafeError for invalid input without leaking sensitive content', async () => {
    const startedAt = new Date().toISOString();
    const ctx = await createE2ETestContext({
      modelSteps: [{ contentChunks: ['dummy'] }],
      tempPrefix: 'nextagent-akg-04-',
    });
    try {
      const { baseUrl } = ctx;

      const invalid = await fetch(`${baseUrl}/api/v1/requests`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ idempotencyKey: `alpha-04-${crypto.randomUUID()}` }),
      });
      expect(invalid.status).toBeGreaterThanOrEqual(400);
      const errorBody = await invalid.text();

      expect(errorBody).not.toContain('OPENAI_API_KEY');
      expect(errorBody).not.toContain('sk-');
      expect(errorBody).not.toContain('node_modules');
      expect(errorBody).not.toMatch(/[A-Za-z]:\\(Users|code|src)\\s+/i);

      expect(errorBody.length).toBeGreaterThan(0);

      recordCaseResult('alpha-04', 'PASSED', { startedAt, endedAt: new Date().toISOString() });
    } catch (error) {
      recordCaseResult('alpha-04', 'FAILED', {
        safeReason: error instanceof Error ? error.message : String(error),
        startedAt,
        endedAt: new Date().toISOString(),
      });
    } finally {
      await cleanupE2ETestContext(ctx);
    }
  }, 30_000);

  it('returns SafeError for malformed JSON body without leaking internals', async () => {
    const startedAt = new Date().toISOString();
    const ctx = await createE2ETestContext({
      modelSteps: [{ contentChunks: ['dummy'] }],
      tempPrefix: 'nextagent-akg-04b-',
    });
    try {
      const { baseUrl } = ctx;

      const invalid = await fetch(`${baseUrl}/api/v1/sessions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: 'not-valid-json',
      });
      expect(invalid.status).toBeGreaterThanOrEqual(400);
      const errorBody = await invalid.text();
      expect(errorBody.length).toBeGreaterThan(0);
      expect(errorBody).not.toContain('stack');
    } catch (error) {
      recordCaseResult('alpha-04', 'FAILED', {
        safeReason: error instanceof Error ? error.message : String(error),
        startedAt,
        endedAt: new Date().toISOString(),
      });
    } finally {
      await cleanupE2ETestContext(ctx);
    }
  }, 30_000);
});
