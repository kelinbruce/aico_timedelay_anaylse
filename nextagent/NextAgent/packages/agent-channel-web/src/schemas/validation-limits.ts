export const WEB_INPUT_TEXT_MAX_LENGTH = 32768;
export const WEB_IDEMPOTENCY_KEY_MAX_LENGTH = 256;
export const WEB_FORK_IDEMPOTENCY_KEY_MAX_LENGTH = 128;
export const WEB_ID_MAX_LENGTH = 256;
// Conversation cursor/anchor message IDs — memory service enforces a hard 64-character ceiling
// (`size must be between 0 and 64`). Aligning here and in the route parser keeps values >64 from
// leaking past the web boundary into memory as an opaque WM_HTTP_ERROR. Lower than WEB_ID_MAX_LENGTH
// because these cursors are memory-backed message IDs, not arbitrary web IDs (e.g. session/request).
export const WEB_CONVERSATION_CURSOR_MAX_LENGTH = 64;
export const WEB_LOCALE_MAX_LENGTH = 35;
export const WEB_LOCALE_PATTERN = '^[a-zA-Z][a-zA-Z-]*[a-zA-Z]$|^[a-zA-Z]$';
export const WEB_QUERY_TEXT_MAX_LENGTH = 512;
export const WEB_ORIGIN_URL_MAX_LENGTH = 2048;
export const WEB_SHARE_RUN_IDS_MAX_ITEMS = 100;
export const WEB_SHARE_ALLOWED_OPS_MAX_ITEMS = 100;
export const WEB_PENDING_INPUT_ANSWER_MAX_LENGTH = 4096;
export const WEB_PENDING_INPUT_ANSWERS_MAX_ITEMS = 100;
// Pagination offset — max 9999999 is far beyond any realistic page position
export const WEB_QUERY_OFFSET_MAX_LENGTH = 7;
// Favorites offset — capped at 10000 (5 digits). A length guard in the route parser uses this to
// reject oversized digit strings up front with a field-level range message, instead of letting them
// reach Number() and either surface parseStrictInteger's opaque "finite safe integer" message or
// leak past the web boundary into the backing memory service (which returns an opaque WM_HTTP_ERROR).
// The numeric 0–10000 range is enforced separately after parsing.
export const WEB_FAVORITES_OFFSET_MAX_LENGTH = 5;
// Conversation preview offset — capped at 10000 (5 digits). A length guard in the route parser uses
// this to reject oversized digit strings (e.g. 1e27) up front with a field-level range message,
// instead of letting them reach Number() and surface parseStrictInteger's opaque
// "finite safe integer" message. The numeric 0–10000 range is enforced separately after parsing.
export const WEB_CONVERSATION_PREVIEW_OFFSET_MAX_LENGTH = 5;
// Pagination limit — max 999, business layer caps at 50~200
export const WEB_QUERY_LIMIT_MAX_LENGTH = 3;
// Unix millisecond timestamps — current epoch ~1.7 trillion = 13 digits
export const WEB_QUERY_TIMESTAMP_MAX_LENGTH = 13;
// SSE sequence numbers — per-session, 7 digits covers 10M events
export const WEB_QUERY_SEQUENCE_MAX_LENGTH = 7;
// Byte counts (limitBytes) — max 262144 = 6 digits
export const WEB_QUERY_BYTES_MAX_LENGTH = 6;
// Query search text — API doc says max 50 characters
export const WEB_QUERY_SEARCH_MAX_LENGTH = 50;
// Session list q — exact Unicode code-point cap is enforced by the route parser.
export const WEB_SESSION_SEARCH_MAX_CODE_POINTS = 200;
// Page number — 3 digits covers up to 999
export const WEB_QUERY_PAGE_NUM_MAX_LENGTH = 3;
// Memory limit — 5 digits covers up to 10000
export const WEB_QUERY_MEMORY_LIMIT_MAX_LENGTH = 5;
// TypeBox maxLength counts UTF-16 code units, so the schema uses the maximum
// possible code-unit length and the route performs the exact code-point check.
export const WEB_QUERY_MEMORY_TEXT_MAX_CODE_POINTS = 128;
export const WEB_QUERY_MEMORY_TEXT_MAX_CODE_UNITS = WEB_QUERY_MEMORY_TEXT_MAX_CODE_POINTS * 2;
// Memory numeric query string branches (confidence, sinceTime, etc.)
// Timestamps dominate at 13 digits
export const WEB_QUERY_MEMORY_NUM_MAX_LENGTH = 13;
export const WEB_ATTACHMENTS_MAX_ITEMS = 10;
