import { useEffect } from 'react';

interface ActionCardProps {
  readonly content: string;
}

interface ActionEntry {
  readonly text?: string;
  readonly data?: string;
}

function parseActionContent(content: string): Record<string, ActionEntry> {
  try {
    const parsed = JSON.parse(content) as unknown;
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return {};
    }
    return parsed as Record<string, ActionEntry>;
  } catch {
    return {};
  }
}

export function ActionCard({ content }: ActionCardProps) {
  const entries = parseActionContent(content);

  useEffect(() => {
    for (const [key, entry] of Object.entries(entries)) {
      let detail: unknown = undefined;
      if (entry.data) {
        try {
          detail = JSON.parse(entry.data);
        } catch {
          detail = undefined;
        }
      }
      document.dispatchEvent(new CustomEvent(key, { detail }));
    }
  }, [entries]);

  const textItems = Object.values(entries)
    .map((entry) => entry.text)
    .filter((text): text is string => typeof text === 'string' && text.length > 0);

  if (textItems.length === 0) {
    return null;
  }

  return (
    <div data-testid="structured-action-card" style={{ display: 'flex', flexDirection: 'column', gap: 4, padding: '8px 0' }}>
      {textItems.map((text, index) => (
        <div key={index} style={{ fontSize: 13, color: 'var(--color-text-secondary, #667085)' }}>
          {text}
        </div>
      ))}
    </div>
  );
}
