import { useCallback, useRef, type CSSProperties } from 'react';
import { Button, Dropdown, Tooltip } from 'antd';
import { CloseOutlined, EllipsisOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import type { ReactNode } from 'react';
import { useAICOConfigSnapshot } from './useAICOConfig.ts';
import { aicoConfigStore } from './AICOConfigStore.ts';
import { OperatorButton } from './OperatorButton.tsx';
import { PiuRenderer } from './PiuRenderer.tsx';
import { resolveIconSrc } from './iconUtils.ts';
import type { Operator } from './types.ts';

export interface OperatorsAreaProps {
  readonly isDark: boolean;
  readonly collapsed?: boolean;
  readonly variant: 'sidebar' | 'header';
  readonly style?: CSSProperties;
  readonly showInnerMenu?: boolean;
}

export function OperatorsArea({ isDark, collapsed = false, variant, style, showInnerMenu = true }: OperatorsAreaProps) {
  const snapshot = useAICOConfigSnapshot();
  const operators = snapshot.config?.operators;
  const { t, i18n } = useTranslation();
  const isZh = i18n.language === 'zh-CN';
  const triggerRef = useRef<HTMLElement | null>(null);
  const moreMenuRef = useRef<HTMLButtonElement | null>(null);

  const handleOperatorClick = useCallback((operator: Operator, el: HTMLElement | null) => {
    triggerRef.current = el;
    if (operator.type === 'MODAL') {
      aicoConfigStore.setActiveModalOperator(operator);
    } else if (operator.type === 'PANEL') {
      aicoConfigStore.setActivePanelOperator(operator.data);
    }
  }, []);

  if (!operators || operators.length === 0) {
    return null;
  }

  const outerOperators = operators.filter((op) => op.position === 'OUTER');
  const innerOperators = operators.filter((op) => op.position === 'INNER');

  const containerStyle: CSSProperties =
    variant === 'sidebar'
      ? { display: 'flex', flexDirection: 'column', gap: 2, ...style }
      : { display: 'flex', alignItems: 'center', gap: 2, ...style };

  const menuItems = innerOperators.map((operator) => ({
    key: operator.enName,
    label: isZh ? operator.zhName : operator.enName,
    icon: renderOperatorMenuIcon(operator, isDark),
    onClick: () => handleOperatorClick(operator, moreMenuRef.current),
  }));

  return (
    <>
      <div data-testid="operators-area" style={containerStyle}>
        {outerOperators.map((operator) => (
          <OperatorButton
            key={operator.enName}
            operator={operator}
            isDark={isDark}
            collapsed={collapsed || variant === 'header'}
            onClick={(el) => handleOperatorClick(operator, el)}
          />
        ))}
        {showInnerMenu && innerOperators.length > 0 ? (
          variant === 'sidebar' ? (
            <Dropdown trigger={['click']} menu={{ items: menuItems }}>
              <Tooltip
                rootClassName="app-common-tooltip"
                title={collapsed ? t('sidebar.moreFunctions') : undefined}
                placement="right"
              >
                <Button
                  ref={moreMenuRef}
                  type="text"
                  icon={<EllipsisOutlined />}
                  data-testid="operators-more-menu"
                  style={{ width: '100%', justifyContent: collapsed ? 'center' : 'flex-start' }}
                >
                  {!collapsed && <span style={{ fontSize: 14, whiteSpace: 'nowrap' }}>{t('sidebar.moreFunctions')}</span>}
                </Button>
              </Tooltip>
            </Dropdown>
          ) : (
            <Dropdown trigger={['click']} menu={{ items: menuItems }}>
              <Button ref={moreMenuRef} type="text" size="small" data-testid="operators-more-menu" icon={<EllipsisOutlined />} />
            </Dropdown>
          )
        ) : null}
      </div>
      <OperatorModal isDark={isDark} variant={variant} triggerRef={triggerRef} />
    </>
  );
}

function renderOperatorMenuIcon(operator: Operator, isDark: boolean): ReactNode {
  const icon = isDark ? operator.darkIcon : operator.lightIcon;
  const src = resolveIconSrc(icon, '');
  return <img src={src} alt="" aria-hidden="true" style={{ width: 16, height: 16, display: 'block' }} />;
}

interface OperatorModalProps {
  readonly isDark: boolean;
  readonly variant: 'sidebar' | 'header';
  readonly triggerRef: React.RefObject<HTMLElement | null>;
}

function OperatorModal({ isDark, variant, triggerRef }: OperatorModalProps) {
  const snapshot = useAICOConfigSnapshot();
  const operator = snapshot.activeModalOperator;

  const handleClose = useCallback(() => {
    aicoConfigStore.setActiveModalOperator(null);
  }, []);

  if (!operator) {
    return null;
  }

  const modalData = operator.data;
  const isCenter = operator.isCenter === true;
  const width = typeof modalData.width === 'number' ? modalData.width : 800;
  const height = typeof modalData.height === 'number' ? modalData.height : 600;

  let positionStyle: CSSProperties = {};
  if (!isCenter && triggerRef.current) {
    const rect = triggerRef.current.getBoundingClientRect();
    if (variant === 'sidebar') {
      positionStyle = { position: 'fixed', top: rect.top, left: rect.right, zIndex: 1300 };
    } else {
      positionStyle = { position: 'fixed', top: rect.bottom, right: window.innerWidth - rect.right, zIndex: 1300 };
    }
  } else {
    positionStyle = { position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', zIndex: 1300 };
  }

  return (
    <div style={positionStyle} data-testid="operator-modal">
      <div
        style={{
          width,
          height,
          position: 'relative',
          background: 'var(--color-bg-primary, #fff)',
          borderRadius: 8,
          boxShadow: '0 14px 38px rgba(15, 23, 42, 0.18)',
          border: '1px solid var(--color-border, #e5e7eb)',
          overflow: 'hidden',
        }}
      >
        <Button
          type="text"
          size="small"
          onClick={handleClose}
          icon={<CloseOutlined />}
          style={{ position: 'absolute', top: 4, right: 4, zIndex: 1 }}
        />
        <PiuRenderer piuInfo={modalData} theme={isDark ? 'evening' : 'lightday'} containerStyle={{ width: '100%', height: '100%' }} />
      </div>
    </div>
  );
}
