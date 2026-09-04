import type { SafeError } from '@nextagent/agent-common';

export function safeDiagnostic(error: SafeError): Pick<SafeError, 'code' | 'message' | 'category' | 'retryable'> {
  return {
    code: error.code,
    message: error.message,
    category: error.category,
    retryable: error.retryable,
  };
}
