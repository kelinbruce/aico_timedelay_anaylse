import type { SafeError } from '@nextagent/agent-common';

export interface ErrorNormalizer {
  normalize: (error: unknown) => SafeError;
}

export class SafeErrorNormalizer implements ErrorNormalizer {
  normalize(error: unknown): SafeError {
    if (typeof error === 'object' && error !== null && 'code' in error && 'category' in error) {
      const safe = error as Partial<SafeError>;
      return {
        code: String(safe.code),
        message: typeof safe.message === 'string' ? safe.message : 'Request failed safely.',
        category: safe.category ?? 'INTERNAL',
        retryable: safe.retryable ?? false,
      };
    }
    return { code: 'INTERNAL_ERROR', message: 'Request failed safely.', category: 'INTERNAL', retryable: false };
  }
}
