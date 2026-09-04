// Keep the sensitive categories shared by Chat and Memory aligned.
// Absolute-path redaction is a Memory-only presentation rule.
const privateKeyBlockPattern = /-----BEGIN\s+(?:RSA\s+)?PRIVATE\s+KEY-----[\s\S]*?(?:-----END\s+(?:RSA\s+)?PRIVATE\s+KEY-----|$)/giu;
const credentialAssignmentPattern = /\b(?:password|credential|secret|api[-_]?key|access[-_]?token)\s*[:=]\s*[^\s,;]+/giu;
const bearerTokenPattern = /\bBearer\s+[A-Za-z0-9._~+/=-]+/gu;
const skTokenPattern = /\bsk-[A-Za-z0-9._-]{10,}\b/gu;
const phoneNumberPattern = /\b1[3-9]\d{9}\b/gu;
const markdownEscapedPlaceholderPattern = /\[REDACTED\\_(?<category>PATH|SECRET|TOKEN|PHONE)\]/gu;

export function redactSensitiveDisplayText(text: string): string {
  return text
    .replace(privateKeyBlockPattern, '[REDACTED_SECRET]')
    .replace(credentialAssignmentPattern, '[REDACTED_SECRET]')
    .replace(bearerTokenPattern, 'Bearer [REDACTED_TOKEN]')
    .replace(skTokenPattern, '[REDACTED_TOKEN]')
    .replace(phoneNumberPattern, '[REDACTED_PHONE]')
    .replace(markdownEscapedPlaceholderPattern, '[REDACTED_$<category>]');
}
