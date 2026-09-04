/**
 * Shared error → presentation-safe string projection.
 *
 * Centralizes the pattern of extracting a safe, redacted detail string
 * from an unknown error value. Used by the compression orchestrator,
 * summary generator, and any other module that needs to surface error
 * details without leaking raw provider payloads, paths, or credentials.
 */

/**
 * Extract a presentation-safe detail string from an unknown error.
 * The returned string is prefixed with `prefix` and carries only the
 * error's code or name — never the raw message (which may contain
 * provider payloads, paths, or credentials).
 */
export function extractSafeErrorDetail(error: unknown, prefix: string): string {
  if (error === null || typeof error !== 'object') {
    return `${prefix}.`;
  }
  const e = error as { code?: unknown; name?: unknown };
  if (typeof e.code === 'string' || typeof e.code === 'number') {
    return `${prefix} (code: ${String(e.code)}).`;
  }
  if (typeof e.name === 'string') {
    return `${prefix} (${e.name}).`;
  }
  return `${prefix}.`;
}

/**
 * Classify an error into a stable reason code for structured
 * diagnostics. Inspects the error's `code` field for known patterns
 * (abort, auth, timeout) and falls back to a generic reason.
 */
export function classifyErrorReason(error: unknown): string {
  if (error === null || typeof error !== 'object') {
    return 'unknown_error';
  }
  const code = (error as { code?: unknown }).code;
  if (typeof code === 'string' && (code === 'AbortError' || code === 'ABORTED')) {
    return 'aborted';
  }
  if (code === 401 || code === 403 || code === 'PERMISSION_DENIED') {
    return 'auth_denied';
  }
  if (typeof code === 'string' && /timeout|abort/i.test(code)) {
    return 'aborted';
  }
  return 'unknown_error';
}
