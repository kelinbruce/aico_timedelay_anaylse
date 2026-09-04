import { useEffect, useRef, useState } from 'react';
import { Button, Input, message, Modal, Spin } from 'antd';
import { useTranslation } from 'react-i18next';
import { getCurrentLocale } from '../../../i18n/index.ts';
import { useAppHostContext } from '../../../app/AppProviders.tsx';
import { useComplaintFeatureStore } from '../../../state/complaintFeatureStore.ts';
import { complaintService } from '../../../services/complaintService.ts';

const REASON_DETAIL_MAX_LENGTH = 2600;
const LEADING_WHITESPACE_PATTERN = /^[^\s].*/;

export interface ComplaintDialogProps {
  readonly open: boolean;
  readonly alogCard: string;
  onClose: () => void;
}

export function ComplaintDialog({ open, alogCard, onClose }: ComplaintDialogProps) {
  const { t } = useTranslation();
  const { mode, site } = useAppHostContext();
  const records = useComplaintFeatureStore((s) => s.records);
  const complaintStatus = useComplaintFeatureStore((s) => s.status);
  const locale = getCurrentLocale();
  const [selectedReasonId, setSelectedReasonId] = useState<string | null>(null);
  const [detail, setDetail] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [hoveredReasonId, setHoveredReasonId] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (open) {
      setSelectedReasonId(null);
      setDetail('');
      abortRef.current = new AbortController();
      void useComplaintFeatureStore.getState().probe();
    }
    return () => {
      abortRef.current?.abort();
      abortRef.current = null;
    };
  }, [open]);

  const isZh = locale === 'zh-CN';
  const requiresDetail = selectedReasonId === '8';

  const detailHasContent = detail.length > 0;
  const detailLeadingWhitespaceError = detailHasContent && !LEADING_WHITESPACE_PATTERN.test(detail);
  const detailTooLong = detail.length > REASON_DETAIL_MAX_LENGTH;
  const detailRequiredError = requiresDetail && !detailHasContent;
  const detailError = detailLeadingWhitespaceError || detailTooLong || detailRequiredError;

  const canSubmit = selectedReasonId !== null && !detailError && !submitting;

  const handleSubmit = async () => {
    if (!canSubmit || selectedReasonId === null) {
      return;
    }
    const controller = abortRef.current;
    if (!controller) {
      return;
    }
    const userId = mode === 'local' ? 'subject-1' : (site?.user?.id ?? '');
    setSubmitting(true);
    try {
      await complaintService.createReport(
        {
          alog_card: alogCard,
          tenant_id: '',
          user_id: userId,
          reason_id: selectedReasonId,
          reason_detail: detail,
        },
        controller.signal,
      );
      message.success(t('complaint.submitSuccess'));
      onClose();
    } catch {
      if (!controller.signal.aborted) {
        message.error(t('complaint.submitFailed'));
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      title={t('complaint.title')}
      open={open}
      onCancel={onClose}
      destroyOnHidden
      footer={[
        <Button key="cancel" data-testid="complaint-cancel" onClick={onClose}>
          {t('complaint.cancel')}
        </Button>,
        <Button
          key="submit"
          type="primary"
          data-testid="complaint-submit"
          loading={submitting}
          disabled={!canSubmit}
          onClick={() => void handleSubmit()}
        >
          {t('complaint.submit')}
        </Button>,
      ]}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16, paddingTop: 8 }}>
        <div>
          <div style={{ marginBottom: 8, fontWeight: 500 }}>
            {t('complaint.type')}
            <span style={{ color: 'var(--color-error, #ff4d4f)', marginLeft: 4 }}>*</span>
          </div>
          {records.length > 0 ? (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {records.map((record) => {
                const selected = record.id === selectedReasonId;
                const hovered = record.id === hoveredReasonId;
                return (
                  <button
                    key={record.id}
                    type="button"
                    data-testid={`complaint-type-${record.id}`}
                    onClick={() => setSelectedReasonId(record.id)}
                    onMouseEnter={() => setHoveredReasonId(record.id)}
                    onMouseLeave={() => setHoveredReasonId(null)}
                    style={{
                      padding: '6px 12px',
                      borderRadius: 6,
                      border: `1px solid ${selected || hovered ? 'var(--color-primary)' : 'var(--color-border)'}`,
                      background: selected ? 'var(--color-primary-bg, rgba(22, 119, 255, 0.06))' : 'transparent',
                      color: selected ? 'var(--color-primary)' : 'var(--color-text-primary)',
                      cursor: 'pointer',
                      fontSize: 14,
                      transition: 'border-color 160ms ease, color 160ms ease',
                    }}
                  >
                    {isZh ? record.name_zh : record.name_en}
                  </button>
                );
              })}
            </div>
          ) : complaintStatus === 'failed' ? (
            <div style={{ color: 'var(--color-error, #ff4d4f)', fontSize: 14 }}>{t('complaint.loadFailed')}</div>
          ) : (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--color-text-secondary)', fontSize: 14 }}>
              <Spin size="small" />
              <span>{t('complaint.loading')}</span>
            </div>
          )}
        </div>
        <div>
          <div style={{ marginBottom: 8, fontWeight: 500 }}>
            {t('complaint.description')}
            {requiresDetail ? <span style={{ color: 'var(--color-error, #ff4d4f)', marginLeft: 4 }}>*</span> : null}
          </div>
          <Input.TextArea
            data-testid="complaint-detail"
            value={detail}
            onChange={(e) => setDetail(e.target.value)}
            maxLength={REASON_DETAIL_MAX_LENGTH}
            autoSize={{ minRows: 4, maxRows: 8 }}
            {...(detailError ? { status: 'error' as const } : {})}
          />
          {detailError ? (
            <div style={{ marginTop: 4, fontSize: 12, color: 'var(--color-error, #ff4d4f)' }}>
              {detailRequiredError
                ? t('complaint.detailRequired')
                : detailLeadingWhitespaceError
                  ? t('complaint.detailLeadingWhitespace')
                  : t('complaint.detailTooLong')}
            </div>
          ) : null}
        </div>
      </div>
    </Modal>
  );
}
