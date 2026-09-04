import { type JsonObject, type SafeError } from '@nextagent/agent-common';
import type { CapabilityInvocationResult } from '@nextagent/agent-contracts/capability';

export function stringField(input: JsonObject, key: string): string | undefined {
  const value = input[key];
  return typeof value === 'string' && value.trim().length > 0 ? value : undefined;
}

export function integerField(input: JsonObject, key: string, fallback: number): number | undefined {
  const value = input[key] ?? fallback;
  return Number.isInteger(value) ? Number(value) : undefined;
}

export function failed(code: string, message: string, category: SafeError['category'] = 'AUTHORIZATION'): CapabilityInvocationResult {
  return {
    status: 'FAILED',
    structuredPayload: {},
    generatedMessages: [],
    artifactRefs: [],
    safeError: { code, message, category, retryable: false },
  };
}
