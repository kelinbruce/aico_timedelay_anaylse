import { brand } from '@nextagent/agent-common';
import type { RuntimeResolveProcessMessagesQuery, RuntimeResolvedProcessMessage, RuntimeSessionPort } from '@nextagent/agent-contracts/runtime';
import { sessionEventHistoryQuery } from '@nextagent/agent-channel-web';
import { Value } from '@sinclair/typebox/value';
import { describe, expect, expectTypeOf, it } from 'vitest';
import { createIdentityFixture } from '@nextagent/agent-test-kit';

describe('process message event contracts', () => {
  it('keeps trusted batch resolution on RuntimeSessionPort only', async () => {
    const query: RuntimeResolveProcessMessagesQuery = {
      identityContext: createIdentityFixture(),
      sessionId: brand<string, 'SessionId'>('session-1'),
      requestId: brand<string, 'MessageId'>('request-1'),
      runId: brand<string, 'RequestRunId'>('run-1'),
      messageIds: [brand<string, 'MessageId'>('message-1')],
    };
    const expected: readonly RuntimeResolvedProcessMessage[] = [];
    const port: Pick<RuntimeSessionPort, 'resolveProcessMessages'> = {
      async resolveProcessMessages(received) {
        expect(received).toBe(query);
        return expected;
      },
    };

    await expect(port.resolveProcessMessages?.(query)).resolves.toBe(expected);
    expectTypeOf<RuntimeResolveProcessMessagesQuery>().not.toHaveProperty('agentId');
  });

  it('does not expose message ids through the public history query', () => {
    expect(
      Value.Check(sessionEventHistoryQuery, {
        afterSequence: 0,
        limit: 100,
        messageIds: ['message-1'],
      }),
    ).toBe(false);
  });

  it('keeps Gateway timeline records and tables unchanged by the association contract', () => {
    type GatewayContracts = typeof import('@nextagent/agent-contracts/gateway');
    expectTypeOf<keyof GatewayContracts>().not.toEqualTypeOf<'ProcessMessageRecord'>();
    expectTypeOf<keyof GatewayContracts>().not.toEqualTypeOf<'ProcessMessageStoreGateway'>();
  });
});
