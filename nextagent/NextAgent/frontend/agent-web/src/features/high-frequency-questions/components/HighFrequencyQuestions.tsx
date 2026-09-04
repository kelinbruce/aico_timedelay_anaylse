import { useTranslation } from 'react-i18next';
import { useEffect, useState } from 'react';
import { Tooltip } from 'antd';
import { useAppHostContext } from '../../../app/AppProviders.tsx';
import { hostLocaleToSupportedLocale } from '../../../app/hostTypes.ts';
import { queryFrequentQuestions, type FrequentQuestionEntry } from '../../../services/frequentQuestionService.ts';
import './HighFrequencyQuestions.css';

export interface HighFrequencyQuestionsProps {
  readonly onQuestionClick?: (question: string) => void;
}

const SUGGESTIONS = [
  { key: 'analyze-latency', labelKey: 'welcome.suggestions.analyzeLatency' },
  { key: 'check-compliance', labelKey: 'welcome.suggestions.checkCompliance' },
  { key: 'traffic-report', labelKey: 'welcome.suggestions.trafficReport' },
  { key: 'diagnose-issues', labelKey: 'welcome.suggestions.diagnoseIssues' },
] as const;

const MAX_DISPLAY_LENGTH = 30;
const PIN_TRUNCATE_LENGTH = 100;

function truncateDisplay(text: string): string {
  return text.length > MAX_DISPLAY_LENGTH ? `${text.slice(0, MAX_DISPLAY_LENGTH)}\u2026` : text;
}

export function HighFrequencyQuestions({ onQuestionClick }: HighFrequencyQuestionsProps) {
  const { t } = useTranslation();
  const { site } = useAppHostContext();
  const locale = hostLocaleToSupportedLocale(site?.locale ?? 'zh-cn');
  const [questions, setQuestions] = useState<readonly FrequentQuestionEntry[]>([]);

  useEffect(() => {
    let cancelled = false;
    queryFrequentQuestions(locale)
      .then((result) => {
        if (!cancelled) {
          setQuestions(result.questions);
        }
      })
      .catch(() => {
        // Fallback to i18n hardcoded defaults on failure.
      });
    return () => {
      cancelled = true;
    };
  }, [locale]);

  const displayItems = questions.length > 0 ? questions.map((q) => q.text) : SUGGESTIONS.map((s) => t(s.labelKey));
  const shouldShowTooltip = (text: string) => text.length > MAX_DISPLAY_LENGTH;

  return (
    <div className="highFrequencyWrapper" data-testid="high-frequency-questions">
      {displayItems.map((text, index) => {
        const truncated = truncateDisplay(text);
        const button = (
          <button
            key={`${text}-${index}`}
            type="button"
            className="questionItem"
            data-testid="high-frequency-question-item"
            onClick={() => onQuestionClick?.(text)}
          >
            {truncated}
          </button>
        );
        return shouldShowTooltip(text) ? (
          <Tooltip
            key={`${text}-${index}`}
            rootClassName="app-common-tooltip"
            title={
              <div className="message-textarea-scroll" style={{ maxHeight: 200, overflowY: 'auto', maxWidth: 400 }}>
                {text}
              </div>
            }
          >
            {button}
          </Tooltip>
        ) : (
          button
        );
      })}
    </div>
  );
}
