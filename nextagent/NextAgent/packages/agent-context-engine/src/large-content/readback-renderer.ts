export function renderReadbackFileContent(rawContent: string): string {
  try {
    const parsed = JSON.parse(rawContent) as unknown;
    if (
      parsed !== null &&
      typeof parsed === 'object' &&
      typeof (parsed as Record<string, unknown>)['toolCallId'] === 'string' &&
      typeof (parsed as Record<string, unknown>)['toolName'] === 'string'
    ) {
      const value = parsed as Record<string, unknown>;
      const lines = [`toolCallId: ${value['toolCallId']}`, `toolName: ${value['toolName']}`, 'payload:'];
      renderValueLines(value['payload'], 'payload', lines);
      return `${lines.join('\n')}\n`;
    }
  } catch {
    return rawContent;
  }
  return rawContent;
}

function renderValueLines(value: unknown, path: string, lines: string[]): void {
  if (typeof value === 'string') {
    if (value.includes('\n') || value.includes('\r')) {
      lines.push(`${path}:`);
      lines.push(...value.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n'));
      return;
    }
    lines.push(`${path}: ${value}`);
    return;
  }
  if (value === null || typeof value !== 'object') {
    lines.push(`${path}: ${String(value)}`);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => renderValueLines(item, `${path}[${index}]`, lines));
    return;
  }
  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    renderValueLines(nested, `${path}.${key}`, lines);
  }
}
