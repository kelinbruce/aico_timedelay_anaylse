import { memo } from 'react';
import { ComplaintIcon, useIsDarkTheme } from './TurnIcons.tsx';
import { Tooltip } from 'antd';
import { useTranslation } from 'react-i18next';
import { useComplaintFeatureStore } from '../../../state/complaintFeatureStore.ts';

function actionButtonStyle(): React.CSSProperties {
  return {
    border: 'none',
    background: 'transparent',
    cursor: 'pointer',
    color: 'var(--color-text-tertiary)',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 0,
    borderRadius: 0,
    fontSize: 16,
    boxShadow: 'none',
    transition: 'color 160ms ease',
  };
}

export const ComplaintFeedbackButton = memo(function ComplaintFeedbackButton({ onOpenComplaint }: { readonly onOpenComplaint: () => void }) {
  const { t } = useTranslation();
  const isDark = useIsDarkTheme();
  const enabled = useComplaintFeatureStore((s) => s.enabled);

  if (!enabled) {
    return null;
  }

  return (
    <Tooltip title={t('complaint.feedback')}>
      <button
        type="button"
        data-testid="btn-complaint-feedback"
        aria-label={t('complaint.feedback')}
        onClick={onOpenComplaint}
        style={actionButtonStyle()}
      >
        <ComplaintIcon isDark={isDark} />
      </button>
    </Tooltip>
  );
});
