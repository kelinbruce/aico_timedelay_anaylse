import { describe, expect, it } from 'vitest';

import { buildFailedCapabilityPayload, buildModelVisibleCapabilityPayload } from '../src/tools/capability-result-projection.js';

describe('failed capability result projection', () => {
  it('projects actionable safe validation text as model-visible errorMessage', () => {
    const payload = buildFailedCapabilityPayload({
      status: 'FAILED',
      structuredPayload: {},
      safeError: {
        code: 'CAPABILITY_INPUT_INVALID',
        message: 'Capability input failed validation: Required field "query" is missing.',
        category: 'VALIDATION',
        retryable: false,
      },
    });

    expect(payload).toMatchObject({
      safeError: {
        code: 'CAPABILITY_INPUT_INVALID',
        category: 'VALIDATION',
        retryable: false,
        errorMessage: 'Capability input failed validation: Required field "query" is missing.',
      },
    });
  });
});

describe('model-visible capability result projection', () => {
  it('removes internal source diagnostics without inspecting the structured payload', () => {
    const payload = buildModelVisibleCapabilityPayload({
      structuredPayload: {
        results: [
          {
            longTermMemoryId: 'ltm-1',
            sourceTrace: { domainOwnedField: 'preserved' },
          },
        ],
      },
      metadata: {
        sourceTrace: [{ longTermMemoryId: 'ltm-1', source: { runId: 'run-source' } }],
        toolDiagnostics: [{ key: 'reasonCode', value: 'SAFE_REASON' }],
        retained: 'safe-metadata',
      },
    });

    expect(payload).toEqual({
      results: [
        {
          longTermMemoryId: 'ltm-1',
          sourceTrace: { domainOwnedField: 'preserved' },
        },
      ],
      capabilityResult: {
        metadata: { retained: 'safe-metadata' },
      },
    });
  });
});
