import { Modal, Typography } from 'antd';
import { useTranslation } from 'react-i18next';

export interface SessionDeleteConfirmModalProps {
  readonly open: boolean;
  readonly displayTitle?: string | undefined;
  readonly error: string | null;
  readonly pending: boolean;
  readonly onCancel: () => void;
  readonly onSubmit: () => void;
}

export function SessionDeleteConfirmModal({ open, displayTitle, error, pending, onCancel, onSubmit }: SessionDeleteConfirmModalProps) {
  const { t } = useTranslation();
  return (
    <Modal
      title={t('sidebar.deleteSessionModalTitle')}
      open={open}
      okText={t('sidebar.deleteSessionConfirm')}
      cancelText={t('sidebar.deleteSessionCancel')}
      okButtonProps={{ danger: true, loading: pending }}
      cancelButtonProps={{ disabled: pending }}
      onCancel={onCancel}
      onOk={onSubmit}
      destroyOnHidden
    >
      <Typography.Text style={{ display: 'block' }}>{displayTitle}</Typography.Text>
      <Typography.Text type="secondary" style={{ display: 'block', marginTop: 8 }}>
        {t('sidebar.deleteSessionModalDescription')}
      </Typography.Text>
      {error ? (
        <Typography.Text type="danger" style={{ display: 'block', marginTop: 8 }}>
          {error}
        </Typography.Text>
      ) : null}
    </Modal>
  );
}
