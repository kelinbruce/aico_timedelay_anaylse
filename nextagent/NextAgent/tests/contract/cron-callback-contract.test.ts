import { brand } from '@nextagent/agent-common';
import { cronTriggerCallbackInputSchema, type CronTriggerCallbackInput } from '@nextagent/agent-contracts/gateway';
import { Ajv } from 'ajv/dist/ajv.js';
import { describe, expect, it } from 'vitest';

describe('Cron callback contract', () => {
  const validate = new Ajv({ allErrors: true }).compile(cronTriggerCallbackInputSchema);

  it('accepts only task/trigger references, freshness fields, and the HMAC envelope', () => {
    const callback: CronTriggerCallbackInput = {
      taskId: 'task-1',
      triggerId: 'trigger-1',
      issuedAt: brand<number, 'EpochMillis'>(1_700_000_000_000),
      nonce: 'nonce-1',
      authentication: {
        algorithm: 'HMAC-SHA256',
        signature: 'A'.repeat(43),
      },
    };

    expect(validate(callback)).toBe(true);
    expect(validate({ ...callback, prompt: 'injected' })).toBe(false);
    expect(validate({ ...callback, tenantId: 'tenant-injected' })).toBe(false);
    expect(validate({ ...callback, agentId: 'agent-injected' })).toBe(false);
    expect(validate({ ...callback, sessionId: 'session-injected' })).toBe(false);
  });
});
