export interface StructuredMessage {
  readonly messageType: string;
  readonly content: unknown;
  readonly eventType: string;
}

export function tryParseStructuredMessage(bodyPreview: string): StructuredMessage | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(bodyPreview);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return null;
  }
  const obj = parsed as Record<string, unknown>;
  if (typeof obj.messageType !== 'string' || obj.content === undefined || typeof obj.eventType !== 'string') {
    return null;
  }
  return { messageType: obj.messageType, content: obj.content, eventType: obj.eventType };
}
