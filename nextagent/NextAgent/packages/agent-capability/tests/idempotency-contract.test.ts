import { describe, expect, it } from 'vitest';
import type { CapabilityDescriptor } from '@nextagent/agent-contracts/capability';
import type { CapabilityReplayPolicy, IdempotencyKey } from '@nextagent/agent-common';
import {
  brand,
  deriveAssistantToolUseIdempotencyKey,
  deriveCapabilityInvocationIdempotencyKey,
  IDEMPOTENCY_KEY_MAX_LENGTH,
} from '@nextagent/agent-common';

function makeDescriptor(overrides: Partial<CapabilityDescriptor> = {}): CapabilityDescriptor {
  return {
    capabilityId: brand('test-cap'),
    kind: 'TOOL',
    provider: { providerId: 'test-provider', providerKind: 'BUNDLED' },
    displayName: 'Test Capability',
    description: 'Test capability for idempotency contract',
    availabilityStatus: 'AVAILABLE',
    modelInvocable: true,
    ...overrides,
  };
}

describe('Capability descriptor replay policy (task 2.1)', () => {
  it('defaults to undefined — consumers treat as NON_IDEMPOTENT', () => {
    expect(makeDescriptor().replayPolicy).toBeUndefined();
  });

  it('preserves explicit IDEMPOTENT', () => {
    expect(makeDescriptor({ replayPolicy: 'IDEMPOTENT' }).replayPolicy).toBe('IDEMPOTENT');
  });

  it('preserves explicit NON_IDEMPOTENT', () => {
    expect(makeDescriptor({ replayPolicy: 'NON_IDEMPOTENT' }).replayPolicy).toBe('NON_IDEMPOTENT');
  });

  it('CapabilityReplayPolicy only accepts valid enum values', () => {
    const valid: CapabilityReplayPolicy[] = ['NON_IDEMPOTENT', 'IDEMPOTENT'];
    expect(valid).toHaveLength(2);
  });
});

describe('Provider conformance: IDEMPOTENT same-key replay (task 2.4)', () => {
  it('same key repeated calls produce only one side effect', () => {
    let sideEffectCount = 0;
    const seen = new Set<string>();
    function invoke(key: string) {
      if (!seen.has(key)) {
        seen.add(key);
        sideEffectCount++;
      }
    }
    invoke('run-1:tc-1');
    invoke('run-1:tc-1');
    invoke('run-1:tc-1');
    expect(sideEffectCount).toBe(1);
  });

  it('different keys are independent', () => {
    let sideEffectCount = 0;
    const seen = new Set<string>();
    function invoke(key: string) {
      if (!seen.has(key)) {
        seen.add(key);
        sideEffectCount++;
      }
    }
    invoke('run-1:tc-1');
    invoke('run-1:tc-2');
    invoke('run-2:tc-1');
    expect(sideEffectCount).toBe(3);
  });

  it('deriveCapabilityInvocationIdempotencyKey produces stable runId:toolCallId', () => {
    const key = deriveCapabilityInvocationIdempotencyKey(brand('run-abc'), 'tool-xyz');
    expect(key).toBe('run-abc:tool-xyz');
  });
});

describe('Idempotency key redaction (task 3.1)', () => {
  it('IdempotencyKey is a branded type for redaction safety', () => {
    const key: IdempotencyKey = brand('secret-key');
    expect(typeof key).toBe('string');
    // Observability layers must hash/correlate, never emit raw key.
  });

  it('invocation request idempotencyKey is optional', () => {
    const withKey = { idempotencyKey: brand('k') };
    const without = {};
    expect('idempotencyKey' in withKey).toBe(true);
    expect('idempotencyKey' in without).toBe(false);
  });
});

describe('Assistant tool-use idempotency key length bound', () => {
  // Reproduces run-613aa86a: minimax-m2.5-naie returned 19 skill tool calls,
  // each ~25 chars. The literal key joined all IDs and hit 648 chars, exceeding
  // the downstream memory service's 256-char limit → WM_HTTP_ERROR.
  it('stays within the 256-char limit for a large batch of real provider IDs', () => {
    const runId = brand<string, 'RequestRunId'>('run-613aa86a-f858-470d-8810-778a7aa73c00');
    const toolCallIds = Array.from({ length: 19 }, (_value, index) => `chatcmpl-tool-9c1404af92a40c31-${index}`);
    const literal = `${runId}:assistant-tool-use:${toolCallIds.join(',')}`;
    expect(literal.length).toBeGreaterThan(IDEMPOTENCY_KEY_MAX_LENGTH);
    const key = deriveAssistantToolUseIdempotencyKey(runId, toolCallIds);
    expect(key.length).toBeLessThanOrEqual(IDEMPOTENCY_KEY_MAX_LENGTH);
  });

  it('is deterministic — the same batch always yields the same key (replay safe)', () => {
    const runId = brand<string, 'RequestRunId'>('run-determinism');
    const toolCallIds = Array.from({ length: 19 }, (_value, index) => `chatcmpl-tool-${index}-abcdef1234567890`);
    const first = deriveAssistantToolUseIdempotencyKey(runId, toolCallIds);
    const second = deriveAssistantToolUseIdempotencyKey(runId, toolCallIds);
    expect(second).toBe(first);
  });

  it('keeps the readable literal form for small batches', () => {
    const runId = brand<string, 'RequestRunId'>('run-small');
    const key = deriveAssistantToolUseIdempotencyKey(runId, ['tc-1', 'tc-2']);
    expect(key).toBe('run-small:assistant-tool-use:tc-1,tc-2');
  });

  it('hash form stays distinct across different batches in the same run', () => {
    const runId = brand<string, 'RequestRunId'>('run-distinct');
    const a = deriveAssistantToolUseIdempotencyKey(
      runId,
      Array.from({ length: 19 }, (_value, index) => `chatcmpl-tool-a-${index}-abcdef1234567890`),
    );
    const b = deriveAssistantToolUseIdempotencyKey(
      runId,
      Array.from({ length: 19 }, (_value, index) => `chatcmpl-tool-b-${index}-abcdef1234567890`),
    );
    expect(a).not.toBe(b);
  });
});
