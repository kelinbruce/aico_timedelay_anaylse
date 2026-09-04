import { brand } from '@nextagent/agent-common';
import type { RuntimeListSessionEventsQuery, RuntimeSessionEventHistoryPage, RuntimeSessionPort } from '@nextagent/agent-contracts/runtime';
import { RuntimeListSessionEventsPaginationSchema, RuntimeSessionEventHistoryPageSchema } from '@nextagent/agent-contracts/runtime';
import { sessionEventHistoryQuery, sessionEventHistoryResponse, sessionRunParams } from '@nextagent/agent-channel-web';
import { Value } from '@sinclair/typebox/value';
import { Ajv } from 'ajv/dist/ajv.js';
import { describe, expect, it } from 'vitest';
import { createIdentityFixture } from '@nextagent/agent-test-kit';

describe('run-scoped session event history contracts', () => {
  it('exposes listEvents through RuntimeSessionPort with trusted scope and required runId', async () => {
    const query: RuntimeListSessionEventsQuery = {
      identityContext: createIdentityFixture(),
      sessionId: brand<string, 'SessionId'>('session-1'),
      runId: brand<string, 'RequestRunId'>('run-1'),
      afterSequence: brand<number, 'TimelineSequence'>(0),
      limit: 100,
    };
    const expected: RuntimeSessionEventHistoryPage = {
      availability: 'AVAILABLE',
      events: [],
    };
    const port: Pick<RuntimeSessionPort, 'listEvents'> = {
      async listEvents(received) {
        expect(received).toBe(query);
        return expected;
      },
    };

    await expect(port.listEvents(query)).resolves.toBe(expected);
    expect(Object.hasOwn(query, 'agentId')).toBe(false);
  });

  it.each([
    { afterSequence: -1, limit: 100 },
    { afterSequence: 0.5, limit: 100 },
    { afterSequence: 0, limit: 0 },
    { afterSequence: 0, limit: 1001 },
    { afterSequence: Number.MAX_SAFE_INTEGER + 1, limit: 100 },
  ])('rejects invalid runtime pagination $afterSequence/$limit', (pagination) => {
    expect(Value.Check(RuntimeListSessionEventsPaginationSchema, pagination)).toBe(false);
  });

  it('enforces the exact available and legacy-unavailable page union', () => {
    expect(
      Value.Check(RuntimeSessionEventHistoryPageSchema, {
        availability: 'AVAILABLE',
        events: [],
        nextAfterSequence: 3,
      }),
    ).toBe(true);
    expect(
      Value.Check(RuntimeSessionEventHistoryPageSchema, {
        availability: 'LEGACY_FORK_PROCESS_HISTORY_UNAVAILABLE',
        events: [],
      }),
    ).toBe(true);

    expect(
      Value.Check(RuntimeSessionEventHistoryPageSchema, {
        availability: 'LEGACY_FORK_PROCESS_HISTORY_UNAVAILABLE',
        events: [],
        nextAfterSequence: 3,
      }),
    ).toBe(false);
    expect(
      Value.Check(RuntimeSessionEventHistoryPageSchema, {
        availability: 'LEGACY_FORK_PROCESS_HISTORY_UNAVAILABLE',
        events: [{ type: 'REQUEST_ACCEPTED', inlinePayload: {} }],
      }),
    ).toBe(false);
    expect(
      Value.Check(RuntimeSessionEventHistoryPageSchema, {
        availability: 'AVAILABLE',
        events: [],
        unexpected: true,
      }),
    ).toBe(false);
  });

  it('defines strict Web params, pagination, and response schemas', () => {
    const ajv = new Ajv({ allErrors: true });
    const validateParams = ajv.compile(sessionRunParams);
    const validateQuery = ajv.compile(sessionEventHistoryQuery);
    const validateResponse = ajv.compile(sessionEventHistoryResponse);

    expect(validateParams({ sessionId: 'session-1', runId: 'run-1' })).toBe(true);
    expect(validateParams({ sessionId: 'session-1', runId: '' })).toBe(false);
    expect(validateQuery({ afterSequence: 0, limit: 100 })).toBe(true);
    expect(validateQuery({ afterSequence: -1, limit: 100 })).toBe(false);
    expect(validateQuery({ afterSequence: 0, limit: 1001 })).toBe(false);
    expect(validateResponse({ availability: 'AVAILABLE', events: [] })).toBe(true);
    expect(
      validateResponse({
        availability: 'LEGACY_FORK_PROCESS_HISTORY_UNAVAILABLE',
        events: [],
        nextAfterSequence: 1,
      }),
    ).toBe(false);
  });
});
