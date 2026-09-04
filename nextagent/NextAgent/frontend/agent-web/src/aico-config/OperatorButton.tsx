import { useState, useRef, type CSSProperties } from 'react';
import { Button, Tooltip } from 'antd';
import { useTranslation } from 'react-i18next';
import type { Operator } from './types.ts';
import { resolveIconSrc } from './iconUtils.ts';
import { reportWarning } from '../utils/diagnostics.ts';

export interface OperatorButtonProps {
  readonly operator: Operator;
  readonly isDark: boolean;
  readonly collapsed?: boolean;
  readonly onClick: (el: HTMLElement | null) => void;
  readonly style?: CSSProperties;
  readonly showLabel?: boolean;
}

export function OperatorButton({ operator, isDark, collapsed = false, onClick, style, showLabel = true }: OperatorButtonProps) {
  const { i18n } = useTranslation();
  const [imgError, setImgError] = useState(false);
  const btnRef = useRef<HTMLElement | null>(null);
  const isZh = i18n.language === 'zh-CN';
  const label = isZh ? operator.zhName : operator.enName;
  const iconSrc = imgError ? undefined : isDark ? operator.darkIcon : operator.lightIcon;
  const fullIconSrc = iconSrc ? resolveIconSrc(iconSrc, '') : undefined;

  const handleClick = () => {
    setImgError(false);
    onClick(btnRef.current);
  };

  const iconEl = fullIconSrc ? (
    <img
      src={fullIconSrc}
      alt=""
      aria-hidden="true"
      style={{ width: 20, height: 20, display: 'block', flexShrink: 0 }}
      onError={() => {
        reportWarning(`[AICOConfig] Failed to load operator icon for "${label}".`);
        setImgError(true);
      }}
    />
  ) : (
    <span style={{ width: 20, height: 20, display: 'inline-block', flexShrink: 0 }} />
  );

  if (collapsed || !showLabel) {
    return (
      <Tooltip rootClassName="app-common-tooltip" title={label} placement="right">
        <Button
          ref={btnRef as React.RefObject<HTMLButtonElement>}
          type="text"
          size="small"
          data-testid={`operator-button-${operator.enName}`}
          onClick={handleClick}
          icon={iconEl}
          style={{ ...style }}
        />
      </Tooltip>
    );
  }

  return (
    <Tooltip rootClassName="app-common-tooltip" title={label}>
      <Button
        ref={btnRef as React.RefObject<HTMLButtonElement>}
        type="text"
        data-testid={`operator-button-${operator.enName}`}
        onClick={handleClick}
        icon={iconEl}
        style={{
          width: '100%',
          justifyContent: 'flex-start',
          ...style,
        }}
      >
        <span style={{ fontSize: 14, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{label}</span>
      </Button>
    </Tooltip>
  );
}
