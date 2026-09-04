interface OperatorButtonsProps {
  readonly content: string;
}

interface OperatorButton {
  readonly text: string;
  readonly title?: string;
  readonly type?: 'primary' | 'default' | 'risk';
  readonly data: string;
}

interface OperatorContent {
  readonly text?: string;
  readonly type?: 'BUTTON' | 'LINK';
  readonly align?: 'left' | 'center' | 'right';
  readonly operators?: Record<string, OperatorButton>;
}

function parseOperatorContent(content: string): OperatorContent | null {
  try {
    const parsed = JSON.parse(content) as unknown;
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return null;
    }
    return parsed as OperatorContent;
  } catch {
    return null;
  }
}

function buttonStyle(buttonType: string | undefined): React.CSSProperties {
  const base: React.CSSProperties = {
    border: '1px solid var(--color-border, #d0d5dd)',
    borderRadius: 6,
    padding: '4px 16px',
    fontSize: 13,
    cursor: 'pointer',
    background: 'transparent',
  };
  if (buttonType === 'primary') {
    return { ...base, background: 'var(--color-primary, #2563eb)', color: '#fff', borderColor: 'var(--color-primary, #2563eb)' };
  }
  if (buttonType === 'risk') {
    return { ...base, borderColor: 'var(--color-danger, #ef4444)', color: 'var(--color-danger, #ef4444)' };
  }
  return { ...base, color: 'var(--color-text-primary, #344054)' };
}

export function OperatorButtons({ content }: OperatorButtonsProps) {
  const parsed = parseOperatorContent(content);
  if (!parsed || !parsed.operators) {
    return null;
  }
  const align = parsed.align ?? 'left';
  const justifyContent = align === 'center' ? 'center' : align === 'right' ? 'flex-end' : 'flex-start';

  const handleClick = (key: string, data: string) => {
    let detail: unknown = undefined;
    try {
      detail = JSON.parse(data);
    } catch {
      detail = undefined;
    }
    document.dispatchEvent(new CustomEvent(key, { detail }));
  };

  return (
    <div data-testid="structured-operator-buttons" style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '8px 0' }}>
      {parsed.text ? <div style={{ fontSize: 13, color: 'var(--color-text-secondary, #667085)' }}>{parsed.text}</div> : null}
      <div style={{ display: 'flex', gap: 8, justifyContent, flexWrap: 'wrap' }}>
        {Object.entries(parsed.operators).map(([key, button]) => (
          <button key={key} title={button.title} onClick={() => handleClick(key, button.data)} style={buttonStyle(button.type)}>
            {button.text}
          </button>
        ))}
      </div>
    </div>
  );
}
