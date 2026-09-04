import { create } from 'zustand';
import type { SkillCatalogSummaryEntry } from './contracts.ts';

interface SkillSelectionState {
  readonly selectedSkill: SkillCatalogSummaryEntry | null;
  readonly selectedIconIndex: number;
  selectSkill: (skill: SkillCatalogSummaryEntry | null, iconIndex?: number) => void;
  clearSelection: () => void;
}

export const useSkillSelectionStore = create<SkillSelectionState>((set) => ({
  selectedSkill: null,
  selectedIconIndex: 0,
  selectSkill: (skill, iconIndex = 0) => {
    set({ selectedSkill: skill, selectedIconIndex: iconIndex });
  },
  clearSelection: () => {
    set({ selectedSkill: null, selectedIconIndex: 0 });
  },
}));
