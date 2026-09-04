/**
 * Fastify body-parse error detection shared by the web and task channels.
 *
 * Fastify's content-type parser throws typed errors (FST_ERR_CTP_*) when the
 * request body cannot be parsed — empty body, malformed JSON, unsupported
 * media type, or a raw control byte like NUL inside a JSON string. These
 * errors carry their own `statusCode` (400 / 415) but NO `validation` array,
 * so the channels' `isFastifyValidationError` (which only checks for that
 * array) classifies them as INTERNAL → 500. Detecting them by `code` lets the
 * error handlers adopt Fastify's intended status (400 for body content, 415
 * for unsupported media type) and surface a request-validation error instead
 * of an internal server error.
 */

/** A Fastify error created via `@fastify/error` — carries `code` + `statusCode`. */
export type FastifyHttpError = Error & {
  readonly code: string;
  readonly statusCode: number;
};

const FST_BODY_PARSE_ERROR_CODES = new Set<string>([
  'FST_ERR_CTP_EMPTY_JSON_BODY',
  'FST_ERR_CTP_INVALID_JSON_BODY',
  'FST_ERR_CTP_INVALID_MEDIA_TYPE',
]);

/**
 * True for Fastify content-type-parser errors (empty/malformed body, wrong
 * media type). These are expected client errors, not internal failures.
 */
export function isFastifyBodyParseError(error: unknown): error is FastifyHttpError {
  return (
    error !== null &&
    typeof error === 'object' &&
    typeof (error as { readonly code?: unknown }).code === 'string' &&
    FST_BODY_PARSE_ERROR_CODES.has((error as { readonly code: string }).code)
  );
}

/**
 * Human-readable message for a Fastify body-parse error code. The body could
 * not be parsed, so there is no field path to surface — the message describes
 * the parse failure itself.
 */
export function bodyParseErrorMessage(code: string): string {
  switch (code) {
    case 'FST_ERR_CTP_EMPTY_JSON_BODY':
      return 'Request body cannot be empty when Content-Type is application/json.';
    case 'FST_ERR_CTP_INVALID_JSON_BODY':
      return 'Request body is not valid JSON.';
    case 'FST_ERR_CTP_INVALID_MEDIA_TYPE':
      return 'Unsupported Media Type. Use application/json.';
    default:
      return 'Request validation failed.';
  }
}
