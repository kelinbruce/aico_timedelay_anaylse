import { brand, type JsonObject } from '@nextagent/agent-common';
import type { CapabilityDescriptor, CapabilityInvocationResult } from '@nextagent/agent-contracts/capability';
import { describe, expect, it } from 'vitest';
import { boundedSafeNames, capabilityStructureDiagnostics } from '../src/projection/safe-structure-diagnostics.js';

const descriptor: CapabilityDescriptor = {
  capabilityId: brand<string, 'CapabilityId'>('Lookup'),
  kind: 'TOOL',
  provider: { providerId: 'builtin-tools', providerKind: 'BUNDLED', providerType: 'builtin' },
  displayName: 'Lookup',
  description: 'Lookup records',
  availabilityStatus: 'AVAILABLE',
  inputSchema: {
    type: 'object',
    properties: {
      query: { type: 'string' },
      tokenLength: { type: 'number' },
      apiToken: { type: 'string' },
      password: { type: 'string' },
    },
  },
  outputSchema: {
    type: 'object',
    properties: {
      records: { type: 'array' },
      status: { type: 'string' },
    },
  },
};

describe('safe structure diagnostics', () => {
  it('projects only schema-matched non-credential names and typed result effects', () => {
    const result = makeResult({
      structuredPayload: { records: [], ignoredRawValue: 'result-canary' },
      generatedMessages: [
        { role: 'USER', content: 'generated-meta-canary', meta: true },
        { role: 'USER', content: 'generated-canary' },
      ],
      contextPatch: { allowedTools: [brand<string, 'CapabilityId'>('Read')], modelId: 'private-model-value' },
    });
    expect(
      capabilityStructureDiagnostics(
        descriptor,
        {
          query: 'argument-canary',
          tokenLength: 123,
          apiToken: 'credential-canary',
          unknown: 'unknown-canary',
        },
        result,
      ),
    ).toEqual({
      argumentProjectionStatus: 'PARTIALLY_PROJECTED',
      validatedArgumentNames: ['query', 'tokenLength'],
      validatedArgumentNamesTruncated: 'true',
      resultProjectionStatus: 'PROJECTED',
      validatedResultFieldNames: ['records'],
      validatedResultFieldNamesTruncated: 'false',
      generatedMessageKinds: ['USER', 'USER_META'],
      contextPatchFields: ['allowedTools', 'modelId'],
    });
  });

  it.each([
    [{}, 'EMPTY'],
    [{ value: 'x' }, 'NO_SCHEMA_MATCH'],
    [{ password: 'x' }, 'FILTERED'],
  ] as const)('reports the argument projection status for %j', (argumentsValue, expectedStatus) => {
    expect(capabilityStructureDiagnostics(descriptor, argumentsValue as JsonObject, undefined)).toMatchObject({
      argumentProjectionStatus: expectedStatus,
      resultProjectionStatus: 'NOT_PRODUCED',
    });
  });

  it('reports unavailable schema properties without exposing names', () => {
    const noProperties = { ...descriptor, inputSchema: { type: 'object' } };
    expect(capabilityStructureDiagnostics(noProperties, { query: 'canary' }, undefined)).toEqual({
      argumentProjectionStatus: 'SCHEMA_PROPERTIES_UNAVAILABLE',
      resultProjectionStatus: 'NOT_PRODUCED',
    });
  });

  it('bounds safe names by item and JSON byte budgets', () => {
    expect(boundedSafeNames(Array.from({ length: 101 }, (_, index) => `tool-${index}`))).toMatchObject({
      names: expect.arrayContaining(['tool-0', 'tool-99']),
      truncated: 'true',
    });
    const byteBounded = boundedSafeNames(Array.from({ length: 20 }, (_, index) => `tool-${index}-${'x'.repeat(240)}`));
    expect(Buffer.byteLength(JSON.stringify(byteBounded.names), 'utf8')).toBeLessThanOrEqual(4_096);
    expect(byteBounded.truncated).toBe('true');
  });
});

function makeResult(overrides: Partial<CapabilityInvocationResult>): CapabilityInvocationResult {
  return {
    status: 'SUCCEEDED',
    structuredPayload: {},
    generatedMessages: [],
    artifactRefs: [],
    ...overrides,
  };
}
