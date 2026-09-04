import { useAppHostContext } from '../../../app/AppProviders.tsx';
import { useTranslation } from 'react-i18next';
import type { ReactNode } from 'react';
import { PiuRenderer } from '../../../aico-config/PiuRenderer.tsx';
import type { PIUInfoItem } from '../../../aico-config/types.ts';
import { PageHeader } from '../../../components/PageLayout.tsx';
import { useComplaintFeatureStore } from '../../../state/complaintFeatureStore.ts';

const COMPLAINT_HISTORY_PIU: PIUInfoItem = {
  piuName: 'RobotRouterPIU',
  piuVersion: '1.0.0',
  renderFunc: 'renderComplaintList',
};

export function ComplaintHistoryView(): ReactNode {
  const enabled = useComplaintFeatureStore((s) => s.enabled);
  const { hostTheme } = useAppHostContext();
  const { i18n } = useTranslation();

  if (!enabled) {
    return null;
  }

  return (
    <PiuRenderer
      key={`${hostTheme}-${i18n.language}`}
      piuInfo={COMPLAINT_HISTORY_PIU}
      theme={hostTheme}
      containerStyle={{ width: '100%', height: '100%', padding: 16, backgroundColor: 'var(--color-bg-primary)' }}
    />
  );
}

export function ComplaintHistoryPage(): ReactNode {
  const enabled = useComplaintFeatureStore((state) => state.enabled);
  const { t } = useTranslation();

  if (!enabled) {
    return null;
  }

  return (
    <section
      aria-label={t('complaint.historyTitle')}
      style={{ display: 'flex', flexDirection: 'column', width: '100%', height: '100%', minHeight: 0 }}
    >
      <PageHeader title={t('complaint.historyTitle')} />
      <div style={{ flex: '1 1 auto', minHeight: 0 }}>
        <ComplaintHistoryView />
      </div>
    </section>
  );
}
