import { brand, type AgentId, type EpochMillis, type IdentityContext, type RequestLocale } from '@nextagent/agent-common';
import type { UserQuestionActivityStoreGateway } from '@nextagent/agent-contracts/gateway';
import type { EditLatestRequestCommand, RuntimeCommandPort, SubmitRequestCommand } from '@nextagent/agent-contracts/runtime';
import { computeQuestionHash } from './category-question-catalog.js';

export function createQuestionActivityTrackingCommandPort(
  inner: RuntimeCommandPort,
  activityStore: UserQuestionActivityStoreGateway,
  agentId: AgentId,
  now: () => EpochMillis = () => brand<number, 'EpochMillis'>(Date.now()),
): RuntimeCommandPort {
  function trackQuestionActivity(inputText: string, identityContext: IdentityContext, locale: RequestLocale): void {
    const trimmed = inputText.trim();
    if (trimmed.length === 0) {
      return;
    }
    void activityStore
      .upsertActivity({
        tenantId: identityContext.tenantId,
        subjectId: identityContext.subjectId,
        agentId,
        questionHash: computeQuestionHash(trimmed),
        questionText: trimmed,
        locale,
        isPinned: false,
        pinnedAt: null,
        askFrequency: 0,
        lastAskedAt: null,
        createdAt: now(),
        updatedAt: now(),
      })
      .catch(() => {
        // Activity tracking is advisory and must not block the runtime command.
      });
  }

  return {
    ...(inner.reserveSubmit === undefined ? {} : { reserveSubmit: inner.reserveSubmit.bind(inner) }),
    async submit(command: SubmitRequestCommand) {
      const result = await inner.submit(command);
      if (command.guardBlockRefusal === undefined) {
        trackQuestionActivity(command.inputText, command.identityContext, command.locale);
      }
      return result;
    },
    async cancel(command) {
      return inner.cancel(command);
    },
    async retryLatest(command) {
      return inner.retryLatest(command);
    },
    async editLatest(command: EditLatestRequestCommand) {
      const result = await inner.editLatest(command);
      if (command.guardBlockRefusal === undefined) {
        trackQuestionActivity(command.editedInputText, command.identityContext, command.locale ?? brand<string, 'RequestLocale'>('zh-CN'));
      }
      return result;
    },
    async answerPendingInput(command) {
      return inner.answerPendingInput(command);
    },
    ...(inner.hideRunMessages === undefined ? {} : { hideRunMessages: inner.hideRunMessages.bind(inner) }),
  };
}
