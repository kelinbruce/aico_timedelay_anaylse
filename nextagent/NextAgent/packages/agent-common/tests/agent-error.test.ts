import { AgentError, runtimeRawExceptionData } from '../src/index.js';
import { describe, expect, it } from 'vitest';

describe('AgentError cause', () => {
  it('uses the standard Error cause without exposing it through SafeError fields', () => {
    const cause = new TypeError('private provider failure');
    const error = new AgentError({
      code: 'APP_START_FAILED',
      message: 'App startup failed.',
      category: 'INTERNAL',
      safeDetails: { failureStage: 'SERVER_LISTEN' },
      cause,
    });

    expect(error.cause).toBe(cause);
    expect(Object.keys(error)).not.toContain('cause');
    expect(JSON.parse(JSON.stringify(error))).not.toHaveProperty('cause');
  });
});

describe('runtime raw exception diagnostics', () => {
  it('preserves useful bounded exception messages while redacting tokens', () => {
    const longDetail = 'segment-'.repeat(80);
    const error = new Error(`tool failed because ${longDetail} token=sk-common-runtime-exception-secret`);
    error.cause = new Error(`cause explains retry condition ${longDetail}`);

    const data = runtimeRawExceptionData(error);

    expect(data?.message).toContain('tool failed because segment-segment-segment');
    expect(String(data?.message).length).toBeGreaterThan(96);
    expect(JSON.stringify(data)).not.toContain('sk-common-runtime-exception-secret');
    expect(data?.cause).toEqual(
      expect.objectContaining({
        message: expect.stringContaining('cause explains retry condition'),
      }),
    );
  });

  it('preserves prompt and diagnostic token fields while narrowly redacting authentication values', () => {
    const data = runtimeRawExceptionData({
      prompt: 'diagnose a transport alarm',
      path: 'C:\\network\\alarm.log',
      credentialRef: 'vault:model-primary',
      credentialStatus: 'missing',
      tokenCount: 12,
      tokenLength: 8,
      tokenizationMode: 'strict',
      accessToken: 'access-secret',
      apiKey: 'api-secret',
      authorization: 'Bearer abcdefghijklmnop',
    });

    expect(data).toEqual({
      value: {
        prompt: 'diagnose a transport alarm',
        path: 'C:\\network\\alarm.log',
        credentialRef: 'vault:model-primary',
        credentialStatus: 'missing',
        tokenCount: 12,
        tokenLength: 8,
        tokenizationMode: 'strict',
        accessToken: '<redacted:credential>',
        apiKey: '<redacted:credential>',
        authorization: '<redacted:credential>',
      },
    });
  });
});
