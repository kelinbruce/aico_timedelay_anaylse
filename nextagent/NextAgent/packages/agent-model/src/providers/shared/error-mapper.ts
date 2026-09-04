import type { SafeError } from '@nextagent/agent-common';

export function createSafeModelError(code: string, message: string, category: SafeError['category'] = 'UNAVAILABLE'): SafeError {
  return {
    code,
    message,
    category,
    retryable: category === 'TIMEOUT' || category === 'UNAVAILABLE',
  };
}
