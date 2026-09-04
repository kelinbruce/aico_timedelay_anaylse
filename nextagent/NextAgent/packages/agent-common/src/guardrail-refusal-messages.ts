/**
 * Guardrail fail-closed refusal messages.
 *
 * Used when the guard service itself is unavailable (non-2xx, timeout, or
 * transport error) — NOT for normal policy refusals, which are relayed verbatim
 * from the guard service's `response` field. The message language follows the
 * request `locale` (sourced from the deployment `defaultLanguage`), so an
 * English deployment returns English rather than the previously hard-coded
 * Chinese string.
 */

/**
 * Fail-closed refusal message for when the guard service is unavailable, in the
 * language indicated by `locale`. Defaults to Chinese (`zh-CN`) when `locale` is
 * absent, matching the historical behavior.
 */
export function guardrailServiceUnavailableMessage(locale?: string): string {
  return (locale ?? 'zh-CN').toLowerCase().startsWith('en')
    ? 'The guardrail service is unavailable. The response has been refused.'
    : '护栏服务不可用，拒绝回答。';
}
