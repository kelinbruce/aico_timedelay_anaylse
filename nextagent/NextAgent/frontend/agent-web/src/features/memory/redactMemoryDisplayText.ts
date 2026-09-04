import { redactSensitiveDisplayText } from '../../utils/redactSensitiveDisplayText.ts';

const absolutePathPattern = /(?<![\w:./<])(\/[^\s"'<>|*?]+|[A-Za-z]:[\\/][^\s"'<>|*?]+)/gu;

export function redactMemoryDisplayText(text: string): string {
  return redactSensitiveDisplayText(text).replace(absolutePathPattern, '[REDACTED_PATH]');
}
