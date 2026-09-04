import { isApiError } from '../../../services/apiClient.ts';
import type { TFunction } from 'i18next';

const SESSION_RENAME_ERROR_CODE_TO_KEY: Record<string, string> = {
  SESSION_TITLE_TOO_SHORT: 'sidebar.renameErrorTooShort',
  SESSION_TITLE_TOO_LONG: 'sidebar.renameErrorTooLong',
  SESSION_TITLE_UNSAFE_CONTENT: 'sidebar.renameErrorUnsafe',
  // The session can be deleted in another tab while this tab keeps the rename
  // modal open; surface the same localized already-deleted notice as delete.
  SESSION_NOT_FOUND: 'sidebar.deleteSessionAlreadyDeleted',
};

export function resolveSessionRenameError(error: unknown, t: TFunction): string {
  if (isApiError(error) && error.code) {
    // The unsafe-content message is category-specific (XSS vs secret) and
    // comes from the backend, so surface it directly rather than the generic
    // i18n fallback. Other mapped codes keep their localized i18n copy.
    if (error.code === 'SESSION_TITLE_UNSAFE_CONTENT' && error.error) {
      return error.error;
    }
    const key = SESSION_RENAME_ERROR_CODE_TO_KEY[error.code];
    if (key) {
      return t(key);
    }
  }
  return error instanceof Error ? error.message : t('sidebar.renameFailed');
}
