import { useAppHostContext } from '../../../app/AppProviders.tsx';
import { useTranslation } from 'react-i18next';
import type { ReactNode } from 'react';
import { PiuRenderer } from '../../../aico-config/PiuRenderer.tsx';
import type { PIUInfoItem } from '../../../aico-config/types.ts';
import { PageHeader } from '../../../components/PageLayout.tsx';

const KNOWLEDGE_IMPORT_PIU: PIUInfoItem = {
  piuName: 'MCSemanticPIU',
  piuVersion: '1.0.0',
  renderFunc: 'loadDataSet',
};

export function KnowledgeImportView(): ReactNode {
  const { hostTheme } = useAppHostContext();
  const { i18n } = useTranslation();

  return (
    <PiuRenderer
      key={`${hostTheme}-${i18n.language}`}
      piuInfo={KNOWLEDGE_IMPORT_PIU}
      theme={hostTheme}
      containerStyle={{ width: '100%', height: '100%', padding: 16, backgroundColor: 'var(--color-bg-primary)' }}
    />
  );
}

export function KnowledgeImportPage(): ReactNode {
  const { t } = useTranslation();

  return (
    <section
      aria-label={t('knowledge.importTitle')}
      style={{ display: 'flex', flexDirection: 'column', width: '100%', height: '100%', minHeight: 0 }}
    >
      <PageHeader title={t('knowledge.importTitle')} />
      <div style={{ flex: '1 1 auto', minHeight: 0 }}>
        <KnowledgeImportView />
      </div>
    </section>
  );
}
