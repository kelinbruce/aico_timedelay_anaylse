import type { ReactNode } from 'react';
import { HighFrequencyQuestions } from '../../high-frequency-questions/components/HighFrequencyQuestions.tsx';
import { useAICOConfig } from '../../../aico-config/useAICOConfig.ts';
import { PiuRenderer } from '../../../aico-config/PiuRenderer.tsx';
import { useAppHostContext } from '../../../app/AppProviders.tsx';

export type GuideAreaComponent = 'high-frequency-questions';

export interface GuideAreaProps {
  readonly component?: GuideAreaComponent;
  readonly onQuestionClick?: (question: string) => void;
  readonly children?: ReactNode;
}

export function GuideArea({ component = 'high-frequency-questions', onQuestionClick, children }: GuideAreaProps) {
  const aicoConfig = useAICOConfig();
  const { hostTheme } = useAppHostContext();
  const guideInfo = aicoConfig?.guideInfo;

  if (guideInfo?.type === 'SELF_DEFINE' && guideInfo.data) {
    return <PiuRenderer piuInfo={guideInfo.data} theme={hostTheme} containerStyle={{ width: '100%' }} />;
  }

  // guideInfo.type === "HIGH_FREQUENCY_RECOMMEND" or absent -> default behavior
  if (children !== undefined) {
    return children;
  }
  if (component === 'high-frequency-questions') {
    return <HighFrequencyQuestions {...(onQuestionClick !== undefined ? { onQuestionClick } : {})} />;
  }
  return null;
}
