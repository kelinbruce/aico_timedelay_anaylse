import { AgentError, type SecretReference } from '@nextagent/agent-common';
import { cronTriggerCallbackInputSchema, type CronTriggerCallbackInput } from '@nextagent/agent-contracts/gateway';
import { Ajv } from 'ajv/dist/ajv.js';
import { createHmac, timingSafeEqual } from 'node:crypto';

export interface CronTriggerCallbackVerifierOptions {
  readonly credentialRef: SecretReference | string;
  readonly credentialResolver: (credentialRef: SecretReference | string) => Promise<string>;
  readonly clock?: () => number;
}

export interface CronTriggerCallbackVerifier {
  verify: (input: unknown, signal?: AbortSignal) => Promise<CronTriggerCallbackInput>;
}

const maxClockSkewMs = 5 * 60 * 1_000;
const callbackSigningPurpose = 'NEXTAGENT_CRON_TRIGGER_V1';
const ajv = new Ajv({ allErrors: true });
const validateCronTriggerCallback = ajv.compile(cronTriggerCallbackInputSchema);

export function createCronTriggerCallbackVerifier(options: CronTriggerCallbackVerifierOptions): CronTriggerCallbackVerifier {
  const clock = options.clock ?? (() => Date.now());
  return {
    async verify(input, signal) {
      throwIfAborted(signal);
      if (!validateCronTriggerCallback(input)) {
        throw callbackError('CRON_CALLBACK_INVALID', 'Cron callback is invalid.', 'VALIDATION');
      }
      const callback = input as CronTriggerCallbackInput;
      const now = clock();
      if (callback.issuedAt < now - maxClockSkewMs) {
        throw callbackError('CRON_CALLBACK_EXPIRED', 'Cron callback has expired.', 'AUTHORIZATION');
      }
      if (callback.issuedAt > now + maxClockSkewMs) {
        throw callbackError('CRON_CALLBACK_FUTURE_TIMESTAMP', 'Cron callback timestamp is invalid.', 'AUTHORIZATION');
      }

      const credential = await resolveCredential(options);
      throwIfAborted(signal);
      const expected = createHmac('sha256', credential).update(buildCronTriggerCallbackSigningPayload(callback)).digest('base64url');
      if (!constantTimeEquals(callback.authentication.signature, expected)) {
        throw callbackError('CRON_CALLBACK_UNAUTHORIZED', 'Cron callback authentication failed.', 'AUTHORIZATION');
      }
      return callback;
    },
  };
}

export function buildCronTriggerCallbackSigningPayload(input: Pick<CronTriggerCallbackInput, 'taskId' | 'triggerId' | 'issuedAt' | 'nonce'>): string {
  return [callbackSigningPurpose, input.taskId, input.triggerId, String(input.issuedAt), input.nonce].join('\n');
}

async function resolveCredential(options: CronTriggerCallbackVerifierOptions): Promise<string> {
  try {
    const credential = await options.credentialResolver(options.credentialRef);
    if (credential.length === 0) {
      throw new Error('empty credential');
    }
    return credential;
  } catch {
    throw callbackError('CRON_CALLBACK_CREDENTIAL_UNAVAILABLE', 'Cron callback credential is unavailable.', 'UNAVAILABLE');
  }
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted === true) {
    throw callbackError('CRON_CALLBACK_CANCELED', 'Cron callback verification was canceled.', 'CANCELED');
  }
}

function constantTimeEquals(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left, 'utf8');
  const rightBuffer = Buffer.from(right, 'utf8');
  if (leftBuffer.length !== rightBuffer.length) {
    timingSafeEqual(rightBuffer, rightBuffer);
    return false;
  }
  return timingSafeEqual(leftBuffer, rightBuffer);
}

function callbackError(code: string, message: string, category: 'VALIDATION' | 'AUTHORIZATION' | 'UNAVAILABLE' | 'CANCELED'): AgentError {
  return new AgentError({ code, message, category, retryable: false });
}
