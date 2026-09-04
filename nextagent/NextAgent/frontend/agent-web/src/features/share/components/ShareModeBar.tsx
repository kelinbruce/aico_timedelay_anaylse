import React from 'react';
import { Button, Checkbox } from 'antd';
import { useTranslation } from 'react-i18next';

export interface ShareModeBarLabels {
  readonly selectAll?: string;
  readonly selectedCount?: string;
  readonly cancel?: string;
  readonly confirm?: string;
}

export interface ShareModeBarProps {
  readonly maxItems?: number;
  readonly selectedCount: number;
  readonly allSelectableCount: number;
  readonly selectedRunIds: ReadonlySet<string>;
  readonly selectableRunIds: ReadonlySet<string>;
  readonly onToggleSelectAll: () => void;
  readonly onShare: () => void;
  readonly onCancel: () => void;
  readonly labels?: ShareModeBarLabels;
}

export function ShareModeBar({
  maxItems,
  selectedCount,
  allSelectableCount,
  selectedRunIds,
  selectableRunIds,
  onToggleSelectAll,
  onShare,
  onCancel,
  labels,
}: ShareModeBarProps) {
  const { t } = useTranslation();
  const allSelected =
    allSelectableCount > 0 && selectedRunIds.size >= allSelectableCount && [...selectableRunIds].every((id) => selectedRunIds.has(id));
  const indeterminate = selectedCount > 0 && !allSelected;

  const selectAllLabel = labels?.selectAll ?? t('share.selectAll');
  const selectedCountLabel = labels?.selectedCount
    ? labels.selectedCount.replace('{{count}}', String(selectedCount))
    : maxItems !== undefined
      ? t('share.selectedCountLimited', { count: selectedCount, max: maxItems })
      : t('share.selectedCount', { count: selectedCount });
  const cancelLabel = labels?.cancel ?? t('share.cancel');
  const confirmLabel = labels?.confirm ?? t('share.share');

  return (
    <div
      data-testid="share-mode-bar"
      style={{
        position: 'absolute',
        left: 0,
        right: 0,
        bottom: 0,
        display: 'flex',
        alignItems: 'center',
        height: 64,
        background: 'var(--color-composer-bg)',
        borderTop: '1px solid var(--color-composer-border)',
        boxShadow: '0 -4px 12px var(--color-composer-shadow)',
        zIndex: 10,
        boxSizing: 'border-box',
      }}
    >
      <div
        data-testid="share-mode-bar-content"
        style={{
          maxWidth: 1080,
          width: '100%',
          margin: '0 auto',
          padding: '0 16px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          boxSizing: 'border-box',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center' }}>
          <Checkbox
            data-testid="share-select-all-checkbox"
            checked={allSelected}
            indeterminate={indeterminate}
            onChange={onToggleSelectAll}
            disabled={allSelectableCount === 0}
          >
            <span style={{ fontSize: 14, color: 'var(--n-primary)' }}>{selectAllLabel}</span>
          </Checkbox>
          <span
            data-testid="share-selected-count"
            style={{
              marginLeft: 16,
              fontSize: 14,
              lineHeight: 1.5715,
              color: 'var(--color-recommend-question)',
            }}
          >
            {selectedCountLabel}
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <Button onClick={onCancel} data-testid="share-cancel-btn" style={{ minWidth: 88, height: 32 }}>
            {cancelLabel}
          </Button>
          <Button
            type="primary"
            onClick={onShare}
            disabled={selectedCount === 0}
            style={{ minWidth: 88, height: 32 }}
            data-testid="share-confirm-btn"
          >
            {confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}
