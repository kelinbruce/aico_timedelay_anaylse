import { Modal, Space, Typography } from 'antd';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { COMPOSER_COMMANDS } from '../commandCatalog.ts';
import { formatShortcutCombo, shortcutRegistry } from '../../../shortcuts/shortcutRegistry.ts';

export interface CommandHelpModalProps {
  readonly open: boolean;
  readonly onClose: () => void;
}

interface HelpShortcut {
  readonly id: string;
  readonly combo: string;
  readonly description: string;
}

function formatHelpShortcut(combo: string): string {
  const formatted = formatShortcutCombo(combo);
  return formatted === 'Escape' ? 'Esc' : formatted;
}

export function CommandHelpModal({ open, onClose }: CommandHelpModalProps) {
  const { t } = useTranslation();
  useEffect(() => {
    if (!open) {
      return undefined;
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [onClose, open]);

  const globalShortcuts: HelpShortcut[] = shortcutRegistry
    .list('global')
    .filter((descriptor) => descriptor.showInHelp)
    .map((shortcut) => ({
      id: shortcut.actionId,
      combo: shortcut.combo,
      description: shortcut.descriptionKey ? t(shortcut.descriptionKey) : (shortcut.description ?? ''),
    }));
  const inputShortcuts: HelpShortcut[] = [
    {
      id: 'composer-enter',
      combo: 'Enter',
      description: t('composer.shortcutDescriptions.enterSend'),
    },
    {
      id: 'composer-shift-enter',
      combo: 'Shift+Enter',
      description: t('composer.shortcutDescriptions.newLine'),
    },
    {
      id: 'composer-tab',
      combo: 'Tab',
      description: t('composer.shortcutDescriptions.tabComplete'),
    },
    {
      id: 'composer-escape',
      combo: 'Escape',
      description: t('composer.shortcutDescriptions.escapeBehavior'),
    },
  ];

  const renderShortcutRows = (shortcuts: readonly HelpShortcut[]) => (
    <Space direction="vertical" size={10} style={{ width: '100%' }}>
      {shortcuts.map((shortcut) => (
        <div
          key={shortcut.id}
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 12,
            paddingBottom: 10,
            borderBottom: '1px solid var(--color-bg-tertiary)',
          }}
        >
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-text-secondary)' }}>{shortcut.description}</div>
          <Typography.Text code style={{ fontSize: 12, flexShrink: 0 }}>
            {formatHelpShortcut(shortcut.combo)}
          </Typography.Text>
        </div>
      ))}
    </Space>
  );

  return (
    <Modal open={open} title={t('composer.helpTitle')} footer={null} onCancel={onClose} width={680}>
      <div
        data-testid="command-help-modal"
        className="nextagent-trackless-scrollbar"
        style={{
          maxHeight: '60vh',
          overflowY: 'auto',
          display: 'flex',
          flexDirection: 'column',
          gap: 18,
          paddingRight: 4,
        }}
      >
        <section>
          <Typography.Title level={5} style={{ marginTop: 0, marginBottom: 12 }}>
            {t('composer.globalShortcuts')}
          </Typography.Title>
          {renderShortcutRows(globalShortcuts)}
        </section>

        <section>
          <Typography.Title level={5} style={{ marginTop: 0, marginBottom: 12 }}>
            {t('composer.inputShortcuts')}
          </Typography.Title>
          {renderShortcutRows(inputShortcuts)}
        </section>

        <section>
          <Typography.Title level={5} style={{ marginTop: 0, marginBottom: 12 }}>
            {t('composer.slashCommands')}
          </Typography.Title>
          <Space direction="vertical" size={10} style={{ width: '100%' }}>
            {COMPOSER_COMMANDS.map((command) => (
              <div
                key={command.key}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 12,
                  paddingBottom: 10,
                  borderBottom: '1px solid var(--color-bg-tertiary)',
                }}
              >
                <div style={{ fontSize: 13, color: 'var(--color-text-secondary)' }}>{t(command.descriptionKey)}</div>
                <Typography.Text code style={{ fontSize: 12, flexShrink: 0 }}>
                  {command.key}
                </Typography.Text>
              </div>
            ))}
          </Space>
        </section>
      </div>
    </Modal>
  );
}
