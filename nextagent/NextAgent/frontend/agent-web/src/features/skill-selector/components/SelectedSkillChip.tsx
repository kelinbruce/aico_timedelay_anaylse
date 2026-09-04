import { useCallback } from 'react';
import { CloseOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import { useSkillSelectionStore } from '../../../state/skillSelectionStore.ts';
import { SKILL_ICONS } from '../../../constants/skillIcons.ts';
import { resolveSkillDisplayName } from '../skill-display-name.ts';

export function SelectedSkillChip() {
  const selectedSkill = useSkillSelectionStore((s) => s.selectedSkill);
  const selectedIconIndex = useSkillSelectionStore((s) => s.selectedIconIndex);
  const clearSelection = useSkillSelectionStore((s) => s.clearSelection);
  const { i18n } = useTranslation();

  const handleClear = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      clearSelection();
    },
    [clearSelection],
  );

  if (!selectedSkill) {
    return null;
  }

  const iconSrc = SKILL_ICONS[selectedIconIndex % SKILL_ICONS.length];

  return (
    <div
      data-testid="selected-skill-chip"
      style={{
        display: 'flex',
        alignItems: 'center',
        height: 28,
        width: 'fit-content',
        maxWidth: '100%',
        lineHeight: '22px',
        padding: '0 8px',
        borderRadius: 4,
        background: 'var(--bg-input-context)',
        color: 'var(--color-chat-answer)',
        fontSize: 12,
        whiteSpace: 'nowrap',
        flexShrink: 0,
        userSelect: 'none',
        gap: 4,
      }}
    >
      <img src={iconSrc} alt="" aria-hidden="true" style={{ width: 16, height: 16, flexShrink: 0, verticalAlign: 'middle' }} />
      <span
        style={{
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        {resolveSkillDisplayName(selectedSkill, i18n.resolvedLanguage ?? i18n.language)}
      </span>
      <button
        type="button"
        data-testid="selected-skill-chip-remove"
        onClick={handleClear}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: 16,
          height: 16,
          border: 'none',
          background: 'transparent',
          color: 'var(--color-chat-answer)',
          cursor: 'pointer',
          padding: 0,
          flexShrink: 0,
        }}
      >
        <CloseOutlined style={{ fontSize: 10 }} />
      </button>
    </div>
  );
}
