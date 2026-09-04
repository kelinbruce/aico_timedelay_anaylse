import { Input, Modal, Typography } from 'antd';
import { useTranslation } from 'react-i18next';

const SESSION_TITLE_MAX_LENGTH = 100;

export interface SessionRenameModalProps {
  readonly open: boolean;
  readonly draft: string;
  readonly error: string | null;
  readonly pending: boolean;
  readonly onDraftChange: (value: string) => void;
  readonly onCancel: () => void;
  readonly onSubmit: () => void;
}

export function SessionRenameModal({ open, draft, error, pending, onDraftChange, onCancel, onSubmit }: SessionRenameModalProps) {
  const { t } = useTranslation();
  return (
    <Modal
      title={t('sidebar.renameModalTitle')}
      open={open}
      onOk={onSubmit}
      onCancel={onCancel}
      confirmLoading={pending}
      okButtonProps={{ disabled: draft.trim().length === 0 }}
      destroyOnHidden
    >
      <Input
        value={draft}
        maxLength={SESSION_TITLE_MAX_LENGTH}
        showCount
        placeholder={t('sidebar.renamePlaceholder')}
        status={error ? 'error' : ''}
        onChange={(event) => onDraftChange(event.target.value)}
        onPressEnter={onSubmit}
      />
      {error ? (
        <Typography.Text type="danger" style={{ display: 'block', marginTop: 8, fontSize: 12 }}>
          {error}
        </Typography.Text>
      ) : null}
    </Modal>
  );
}
