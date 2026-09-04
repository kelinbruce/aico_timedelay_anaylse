import type { PrecomputedSuggestedQuestionPort } from '@nextagent/agent-session';

export interface PortalAbilitySuggestedQuestionProvider {
  get: () => Promise<{ readonly suggestedQuestionsEnabled: boolean }>;
}

export function createPortalAbilitySuggestedQuestionGate(
  inner: PrecomputedSuggestedQuestionPort,
  provider: PortalAbilitySuggestedQuestionProvider,
): PrecomputedSuggestedQuestionPort {
  async function suggestedQuestionsEnabled(): Promise<boolean> {
    try {
      return (await provider.get()).suggestedQuestionsEnabled !== false;
    } catch {
      return true;
    }
  }

  return {
    precompute(key, signal) {
      void (async () => {
        if (await suggestedQuestionsEnabled()) {
          inner.precompute(key, signal);
        }
      })();
    },
    async generate(request, signal) {
      if (!(await suggestedQuestionsEnabled())) {
        return { questions: [] };
      }
      return inner.generate(request, signal);
    },
  };
}
