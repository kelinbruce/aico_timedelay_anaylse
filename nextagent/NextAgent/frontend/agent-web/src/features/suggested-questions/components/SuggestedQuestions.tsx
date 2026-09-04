import { useCallback, useEffect, useRef, useState } from 'react';
import { runtimeConfig } from '../../../config/runtimeConfig.ts';
import { apiClient } from '../../../services/apiClient.ts';
import { useUserOps } from '../../auth/useUserOps.ts';
import { AuthGate } from '../../auth/AuthGate.tsx';
import { AICOServiceOperation } from '../../auth/authEnums.ts';
import './SuggestedQuestions.css';

export interface SuggestedQuestionsProps {
  readonly sessionId: string;
  readonly requestId: string;
  readonly onQuestionClick: (question: string) => void;
}

interface SuggestedQuestionsResponse {
  readonly questions: readonly string[];
}

export function SuggestedQuestions({ sessionId, requestId, onQuestionClick }: SuggestedQuestionsProps) {
  const userOps = useUserOps();
  const [questions, setQuestions] = useState<readonly string[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const suggestedQuestionsEnabled = runtimeConfig.portalAbilityConfig?.suggestedQuestionsEnabled ?? true;

  useEffect(() => {
    if (!suggestedQuestionsEnabled) {
      setIsLoading(false);
      setQuestions([]);
      return undefined;
    }

    const controller = new AbortController();
    abortRef.current = controller;
    setIsLoading(true);
    setQuestions([]);
    apiClient
      .post<SuggestedQuestionsResponse>(`/api/v1/sessions/${sessionId}/requests/${requestId}/suggested-questions`, {}, { signal: controller.signal })
      .then((result) => {
        if (controller.signal.aborted) {
          return;
        }
        setQuestions(result.questions ?? []);
      })
      .catch(() => {
        if (controller.signal.aborted) {
          return;
        }
        setQuestions([]);
      })
      .finally(() => {
        if (controller.signal.aborted) {
          return;
        }
        setIsLoading(false);
      });
    return () => {
      controller.abort();
      abortRef.current = null;
    };
  }, [sessionId, requestId, suggestedQuestionsEnabled]);

  const handleClick = useCallback(
    (question: string) => {
      if (userOps !== null && !userOps.includes(AICOServiceOperation.Write)) {
        return;
      }
      onQuestionClick(question);
    },
    [onQuestionClick, userOps],
  );

  if (!suggestedQuestionsEnabled) {
    return null;
  }

  if (isLoading) {
    return (
      <div className="suggested-questions" data-testid="suggested-questions-loading">
        <span className="suggested-questions__loading-dot" />
        <span className="suggested-questions__loading-dot" />
        <span className="suggested-questions__loading-dot" />
      </div>
    );
  }

  if (questions.length === 0) {
    return null;
  }

  return (
    <div className="suggested-questions" data-testid="suggested-questions">
      {questions.map((question, index) => (
        <AuthGate key={`${index}-${question}`} requiredOps={[AICOServiceOperation.Write]}>
          <button type="button" className="suggested-questions__item" data-testid="suggested-question-item" onClick={() => handleClick(question)}>
            <span className="suggested-questions__item-text">{question}</span>
          </button>
        </AuthGate>
      ))}
    </div>
  );
}
