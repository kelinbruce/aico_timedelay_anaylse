import { describe, expect, it } from 'vitest';
import type { ApiError } from '../../../services/apiClient.ts';
import i18n from '../../../i18n/index.ts';
import { resolveSessionRenameError } from './session-rename-error.ts';

function makeApiError(code: string, message: string, status = 400): ApiError {
  const error = new Error(message) as ApiError;
  Object.assign(error, {
    status,
    code,
    error: message,
    kind: 'http',
    retriable: false,
    authChallenge: null,
  });
  return error;
}

describe('resolveSessionRenameError', () => {
  it('maps SESSION_NOT_FOUND to the localized already-deleted notice', () => {
    expect(resolveSessionRenameError(makeApiError('SESSION_NOT_FOUND', 'Session was not found.', 404), i18n.t)).toBe(
      i18n.t('sidebar.deleteSessionAlreadyDeleted'),
    );
    expect(resolveSessionRenameError(makeApiError('SESSION_NOT_FOUND', 'Session was not found.', 404), i18n.t)).not.toContain(
      'Session was not found.',
    );
  });

  it('maps title validation codes to localized copy', () => {
    expect(resolveSessionRenameError(makeApiError('SESSION_TITLE_TOO_SHORT', 'too short'), i18n.t)).toBe(i18n.t('sidebar.renameErrorTooShort'));
    expect(resolveSessionRenameError(makeApiError('SESSION_TITLE_TOO_LONG', 'too long'), i18n.t)).toBe(i18n.t('sidebar.renameErrorTooLong'));
  });

  it('keeps backend category-specific unsafe-content detail', () => {
    expect(resolveSessionRenameError(makeApiError('SESSION_TITLE_UNSAFE_CONTENT', 'unsafe detail'), i18n.t)).toBe('unsafe detail');
  });

  it('falls back to the generic localized failure for non-error rejection', () => {
    expect(resolveSessionRenameError('network-down', i18n.t)).toBe(i18n.t('sidebar.renameFailed'));
  });
});
