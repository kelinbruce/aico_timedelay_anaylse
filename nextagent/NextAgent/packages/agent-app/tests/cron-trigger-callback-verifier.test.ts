import { brand, type AgentError } from '@nextagent/agent-common';
import type { CronTriggerCallbackInput } from '@nextagent/agent-contracts/gateway';
import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import { buildCronTriggerCallbackSigningPayload, createCronTriggerCallbackVerifier } from '../src/cron/cron-trigger-callback-verifier.js';

describe('Cron trigger callback verifier', () => {
  const now = 1_700_000_000_000;
  const secret = 'test-only-cron-callback-secret';

  it('verifies a valid HMAC callback through the credential resolver', async () => {
    const resolvedReferences: string[] = [];
    const verifier = createCronTriggerCallbackVerifier({
      credentialRef: 'env:CRON_CALLBACK_SECRET',
      credentialResolver: async (reference) => {
        resolvedReferences.push(reference);
        return secret;
      },
      clock: () => now,
    });
    const input = signedCallback({ issuedAt: now });

    await expect(verifier.verify(input)).resolves.toEqual(input);
    expect(resolvedReferences).toEqual(['env:CRON_CALLBACK_SECRET']);
  });

  it.each([
    { name: 'expired', issuedAt: now - 300_001, code: 'CRON_CALLBACK_EXPIRED' },
    { name: 'future', issuedAt: now + 300_001, code: 'CRON_CALLBACK_FUTURE_TIMESTAMP' },
  ])('rejects a $name callback outside the fixed five-minute window', async ({ issuedAt, code }) => {
    const verifier = createCronTriggerCallbackVerifier({
      credentialRef: 'env:CRON_CALLBACK_SECRET',
      credentialResolver: async () => secret,
      clock: () => now,
    });

    const failure = await captureFailure(verifier.verify(signedCallback({ issuedAt })));

    expect(failure).toMatchObject({ code, category: 'AUTHORIZATION', retryable: false });
  });

  it('rejects an incorrect signature without exposing either credential', async () => {
    const verifier = createCronTriggerCallbackVerifier({
      credentialRef: 'env:CRON_CALLBACK_SECRET',
      credentialResolver: async () => 'resolved-secret-must-not-leak',
      clock: () => now,
    });
    const input = signedCallback({ issuedAt: now });

    const failure = await captureFailure(verifier.verify(input));

    expect(failure).toMatchObject({
      code: 'CRON_CALLBACK_UNAUTHORIZED',
      message: 'Cron callback authentication failed.',
      category: 'AUTHORIZATION',
      retryable: false,
    });
    expect(JSON.stringify(failure)).not.toContain('resolved-secret-must-not-leak');
    expect(JSON.stringify(failure)).not.toContain(secret);
  });

  it('maps missing callback credentials to a stable safe error', async () => {
    const verifier = createCronTriggerCallbackVerifier({
      credentialRef: 'env:CRON_CALLBACK_SECRET',
      credentialResolver: async () => {
        throw new Error('credential=raw-secret missing');
      },
      clock: () => now,
    });

    const failure = await captureFailure(verifier.verify(signedCallback({ issuedAt: now })));

    expect(failure).toMatchObject({
      code: 'CRON_CALLBACK_CREDENTIAL_UNAVAILABLE',
      message: 'Cron callback credential is unavailable.',
      category: 'UNAVAILABLE',
      retryable: false,
    });
    expect(failure.cause).toBeUndefined();
    expect(JSON.stringify(failure)).not.toContain('raw-secret');
  });

  it('rejects malformed callback envelopes before resolving credentials', async () => {
    let resolveCount = 0;
    const verifier = createCronTriggerCallbackVerifier({
      credentialRef: 'env:CRON_CALLBACK_SECRET',
      credentialResolver: async () => {
        resolveCount += 1;
        return secret;
      },
      clock: () => now,
    });

    const failure = await captureFailure(
      verifier.verify({
        taskId: 'task-1',
        triggerId: 'trigger-1',
        issuedAt: now,
        nonce: 'nonce-1',
        authentication: { algorithm: 'HMAC-SHA256', signature: 'invalid' },
      }),
    );

    expect(failure).toMatchObject({ code: 'CRON_CALLBACK_INVALID', category: 'VALIDATION' });
    expect(resolveCount).toBe(0);
  });

  function signedCallback(overrides: { readonly issuedAt: number }): CronTriggerCallbackInput {
    const unsigned = {
      taskId: 'task-1',
      triggerId: 'trigger-1',
      issuedAt: brand<number, 'EpochMillis'>(overrides.issuedAt),
      nonce: 'nonce-1',
    };
    return {
      ...unsigned,
      authentication: {
        algorithm: 'HMAC-SHA256',
        signature: createHmac('sha256', secret).update(buildCronTriggerCallbackSigningPayload(unsigned)).digest('base64url'),
      },
    };
  }
});

async function captureFailure(promise: Promise<unknown>): Promise<AgentError> {
  try {
    await promise;
  } catch (error) {
    return error as AgentError;
  }
  throw new Error('Expected callback verification to fail.');
}
