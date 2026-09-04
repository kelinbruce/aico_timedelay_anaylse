import { CloseOutlined } from '@ant-design/icons';
import { Tooltip } from 'antd';
import { useTranslation } from 'react-i18next';
import { EXPAND_PANEL_DIV_ID, expandPanelStore, type ExpandPanelContent } from './ExpandPanelStore.ts';
import { MarkdownContent } from '../chat/components/MarkdownContent.tsx';
import { FileCard } from '../chat/components/structured/FileCard.tsx';
import { ActionCard } from '../chat/components/structured/ActionCard.tsx';
import { OperatorButtons } from '../chat/components/structured/OperatorButtons.tsx';
import { SimpleDslRenderer } from '../chat/components/structured/SimpleDslRenderer.tsx';
import { PiuMessage, parsePiuContent } from '../chat/components/structured/PiuMessage.tsx';
import './ExpandPanel.css';

function renderExpandPanelContent(content: ExpandPanelContent) {
  switch (content.toolMessageType) {
    case 'TEXT':
      return <MarkdownContent content={typeof content.content === 'string' ? content.content : String(content.content ?? '')} />;
    case 'FILE':
      return <FileCard content={typeof content.content === 'string' ? content.content : String(content.content ?? '')} />;
    case 'ACTION':
      return <ActionCard content={typeof content.content === 'string' ? content.content : String(content.content ?? '')} />;
    case 'OPERATOR':
      return <OperatorButtons content={typeof content.content === 'string' ? content.content : String(content.content ?? '')} />;
    case 'DSL':
      return <SimpleDslRenderer content={content.content} />;
    case 'PIU':
      return <PiuMessage content={parsePiuContent(content.content)} />;
    default:
      return null;
  }
}

export function ExpandPanel() {
  const { t } = useTranslation();
  const content = expandPanelStore((s) => s.content);
  const view = expandPanelStore((s) => s.view);
  const isOpen = expandPanelStore((s) => s.isOpen);
  const contentSource = expandPanelStore((s) => s.contentSource);
  const handleClose = () => {
    expandPanelStore.getState().close();
  };

  return (
    <div
      className="expand-panel-root"
      style={{ position: 'relative', height: '100%', display: 'flex', flexDirection: 'column', lineHeight: 'normal' }}
    >
      {contentSource !== 'dsl' && (
        <div style={{ flex: '0 0 48px', display: 'flex', alignItems: 'center', justifyContent: 'flex-end', paddingRight: 16 }}>
          <Tooltip title={t('expandPanel.close')}>
            <button
              data-testid="expand-panel-close-button"
              onClick={handleClose}
              style={{ border: 'none', background: 'transparent', cursor: 'pointer', fontSize: 18, color: 'var(--color-text-secondary)' }}
            >
              <CloseOutlined />
            </button>
          </Tooltip>
        </div>
      )}
      <div
        key={contentSource ?? 'none'}
        id={EXPAND_PANEL_DIV_ID}
        data-testid="expand-panel-container"
        style={{ width: '100%', flex: 1, minHeight: 0, overflow: 'auto' }}
      >
        {view ?? (content ? renderExpandPanelContent(content) : null)}
      </div>
    </div>
  );
}
