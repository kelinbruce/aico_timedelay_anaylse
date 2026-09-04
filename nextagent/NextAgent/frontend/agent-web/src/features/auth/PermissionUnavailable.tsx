import { Typography } from 'antd';
import { useTranslation } from 'react-i18next';

/**
 * Unavailable state rendered when the user has no permissions
 * (ops is an empty array in remote mode). Fills its parent container
 * so it works inside both full-viewport (immersive) and bounded (PIU
 * panel body) layouts.
 */
export function PermissionUnavailable() {
  const { t } = useTranslation();
  return (
    <main
      data-testid="permission-unavailable"
      style={{
        height: '100%',
        width: '100%',
        boxSizing: 'border-box',
        display: 'grid',
        placeItems: 'center',
        padding: 24,
        background: 'var(--color-bg-primary)',
        color: 'var(--color-text-primary)',
      }}
    >
      <section style={{ width: 'min(420px, 100%)', textAlign: 'center' }}>
        <Typography.Title level={3}>{t('auth.noPermissionTitle')}</Typography.Title>
        <Typography.Paragraph type="secondary">{t('auth.noPermissionDescription')}</Typography.Paragraph>
      </section>
    </main>
  );
}
