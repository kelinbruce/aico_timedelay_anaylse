const structuredDeltaSensitivePattern = /api_key|credential|password|secret|token/iu;

export function hasSensitiveStructuredContent(content: unknown): boolean {
  const text = typeof content === 'string' ? content : JSON.stringify(content);
  return structuredDeltaSensitivePattern.test(text);
}
