import type { SafeError } from '@nextagent/agent-common';

/**
 * ModelErrorNormalizer normalizes unknown errors into SafeError before crossing
 * the agent-model boundary.
 *
 * - If error already carries safe classification, preserve only the stable
 *   classification and replace its message at the boundary
 * - Otherwise, map to generic INTERNAL_ERROR without exposing raw details
 */
export class ModelErrorNormalizer {
  normalize(error: unknown): SafeError {
    if (typeof error === 'object' && error !== null && 'code' in error && 'category' in error) {
      const code = isSafeErrorCode(error.code) ? error.code : 'MODEL_INTERNAL_ERROR';
      const category = isSafeErrorCategory(error.category) ? error.category : 'INTERNAL';
      const retryable = 'retryable' in error && typeof error.retryable === 'boolean' ? error.retryable : false;
      return {
        code,
        message: 'Model invocation failed safely.',
        category,
        retryable,
      };
    }
    return {
      code: 'MODEL_INTERNAL_ERROR',
      message: 'Model invocation failed safely.',
      category: 'INTERNAL',
      retryable: false,
    };
  }
}

function isSafeErrorCode(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Z][A-Z0-9_]{0,127}$/u.test(value);
}

function isSafeErrorCategory(value: unknown): value is SafeError['category'] {
  return (
    value === 'VALIDATION' ||
    value === 'AUTHORIZATION' ||
    value === 'POLICY_DENIED' ||
    value === 'NOT_FOUND' ||
    value === 'CONFLICT' ||
    value === 'UNAVAILABLE' ||
    value === 'TIMEOUT' ||
    value === 'CANCELED' ||
    value === 'INTERNAL'
  );
}
