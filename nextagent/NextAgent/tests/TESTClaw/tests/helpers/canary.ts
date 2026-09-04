import { createHash } from 'node:crypto';

export interface CanaryToken {
  readonly label: string;
  readonly value: string;
  readonly sha256: string;
}

function hashCanary(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export function createSecretCanary(label: string, seed = '2026'): CanaryToken {
  const normalizedLabel = label
    .replace(/[^a-z0-9]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase();
  const value = `sk-canary-${normalizedLabel}-${seed}-secret`;
  return { label, value, sha256: hashCanary(value) };
}

export function createSensitiveCanary(label: string, seed = '2026'): CanaryToken {
  const normalizedLabel = label
    .replace(/[^A-Z0-9]+/gi, '_')
    .replace(/^_+|_+$/g, '')
    .toUpperCase();
  const value = `CANARY_${normalizedLabel}_${seed}_SENSITIVE`;
  return { label, value, sha256: hashCanary(value) };
}

export function expectNoCanaryLeak(surface: string, canary: CanaryToken): void {
  if (surface.includes(canary.value)) {
    throw new Error(`Observed leaked canary "${canary.label}" (sha256=${canary.sha256}).`);
  }
}
