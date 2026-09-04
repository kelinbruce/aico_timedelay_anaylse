import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import type { SkillCatalogSummaryEntry } from '../../../state/contracts.ts';
import { useSkillSelectionStore } from '../../../state/skillSelectionStore.ts';
import { ChipBar, type ChipBarItem } from '../../shared/components/ChipBar.tsx';
import { resolveSkillDisplayName } from '../skill-display-name.ts';

export interface SkillSelectorBarProps {
  readonly skills: readonly SkillCatalogSummaryEntry[];
  readonly total: number;
  readonly onOpenModal: () => void;
}

export function SkillSelectorBar({ skills, total, onOpenModal }: SkillSelectorBarProps) {
  const safeSkills = skills ?? [];
  const { i18n, t } = useTranslation();
  const selectSkill = useSkillSelectionStore((s) => s.selectSkill);

  const items: readonly ChipBarItem[] = safeSkills.map((skill) => ({
    key: skill.capabilityId,
    label: resolveSkillDisplayName(skill, i18n.resolvedLanguage ?? i18n.language),
    tooltip: skill.description,
  }));

  const handleSelect = useCallback(
    (key: string, index: number) => {
      const skill = safeSkills.find((s) => s.capabilityId === key);
      if (skill) {
        selectSkill(skill, index);
      }
    },
    [safeSkills, selectSkill],
  );

  return (
    <ChipBar
      items={items}
      selectedKey={null}
      testIdPrefix="skill"
      allLabel={t('skillSelector.all')}
      onSelect={handleSelect}
      onOpenAll={onOpenModal}
    />
  );
}
