import { Flex } from 'antd';
import { useTranslation } from 'react-i18next';
import { GuideArea } from '../../guide/components/GuideArea.tsx';
import { useAICOConfig } from '../../../aico-config/useAICOConfig.ts';
import { useIconWithFallback } from '../../../aico-config/iconUtils.ts';
import logoSvg from '../../../assets/logo.svg';
import './WelcomeState.css';

export interface WelcomeStateProps {
  onSuggestionClick?: (suggestion: string) => void;
}

export function WelcomeState({ onSuggestionClick }: WelcomeStateProps) {
  const { t } = useTranslation();
  const aicoConfig = useAICOConfig();
  const { src: resolvedIcon, onError } = useIconWithFallback(aicoConfig?.guideIcon, logoSvg, 'welcome-brand-icon');
  const displayName = aicoConfig?.name ?? 'NextAgent';
  const welcomeText = aicoConfig?.welcome ?? t('welcome.subtitle');

  const handleQuestionClick = (question: string) => {
    if (onSuggestionClick) {
      onSuggestionClick(question);
    }
  };

  return (
    <div data-testid="welcome-state-root" className="welcome-state-root">
      <Flex vertical align="center" gap={0} className="welcome-state-shell">
        <div className="portalGuideWrapper">
          <div className="logoContainer">
            <img data-testid="welcome-brand-icon" src={resolvedIcon} alt="" aria-hidden="true" onError={onError} className="welcome-brand-icon" />
            <span data-testid="welcome-title-main" className="logoName notranslate" translate="no">
              {displayName}
            </span>
          </div>
          <div data-testid="welcome-title-sub" className="guideWelcome">
            {welcomeText}
          </div>
        </div>

        <GuideArea onQuestionClick={handleQuestionClick} />
      </Flex>
    </div>
  );
}
