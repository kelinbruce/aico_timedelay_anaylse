import type { ReactNode } from 'react';
import { SkillSelector } from '../../skill-selector/components/SkillSelector.tsx';
import { SelectedSkillChip } from '../../skill-selector/components/SelectedSkillChip.tsx';
import { CategoryQuestions } from '../../category-questions/components/CategoryQuestions.tsx';
import { SelectedCategoryChip } from '../../category-questions/components/SelectedCategoryChip.tsx';
import { useAICOConfig } from '../../../aico-config/useAICOConfig.ts';
import { PiuRenderer } from '../../../aico-config/PiuRenderer.tsx';
import { useAppHostContext } from '../../../app/AppProviders.tsx';

export type QuickOperatorAreaComponent = 'category-questions' | 'skills';

export interface QuickOperatorAreaProps {
  readonly component?: QuickOperatorAreaComponent;
  readonly onQuestionSelect?: (question: string) => void;
}

export function QuickOperatorArea({ component = 'skills', onQuestionSelect }: QuickOperatorAreaProps) {
  const aicoConfig = useAICOConfig();
  const { hostTheme } = useAppHostContext();
  const quickInfo = aicoConfig?.quickInfo;

  if (quickInfo?.type === 'SELF_DEFINE' && quickInfo.data) {
    return <PiuRenderer piuInfo={quickInfo.data} theme={hostTheme} />;
  }
  if (quickInfo?.type === 'CATEGORY_RECOMMEND') {
    return <CategoryQuestions {...(onQuestionSelect !== undefined ? { onQuestionSelect } : {})} />;
  }

  // quickInfo.type === "SKILL_LIST" or absent -> default behavior
  if (component === 'skills') {
    return <SkillSelector />;
  }

  return <CategoryQuestions onQuestionSelect={onQuestionSelect} />;
}

export function QuickOperatorAreaSelectedChip({ component = 'skills' }: { component?: QuickOperatorAreaComponent }): ReactNode | null {
  if (component === 'skills') {
    return <SelectedSkillChip />;
  }
  return <SelectedCategoryChip />;
}
