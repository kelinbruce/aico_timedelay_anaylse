import { AgentError, brand, type MessageId } from '@nextagent/agent-common';
import type {
  ForkActiveContextMessage,
  ForkActiveContextSelectionPort,
  ForkActiveContextSelectionRequest,
  ForkActiveContextSelectionResult,
} from '@nextagent/agent-contracts/context';
import type { SessionMessageRecord } from '@nextagent/agent-contracts/gateway';
import { selectHistoryCandidates } from './active-context-selector.js';

export class DefaultForkActiveContextSelector implements ForkActiveContextSelectionPort {
  async select(request: ForkActiveContextSelectionRequest): Promise<ForkActiveContextSelectionResult> {
    const copied = request.copiedMessages;
    const seen = new Set<string>();
    for (const message of copied) {
      if (message.sessionId !== request.childSessionId) {
        throw forkSelectorError('FORK_CONTEXT_MIXED_CHILD_SESSIONS', 'Fork active context input contains mixed child session ids.');
      }
      if (seen.has(message.messageId)) {
        throw forkSelectorError('FORK_CONTEXT_DUPLICATE_MESSAGE_ID', 'Fork active context input contains duplicate message ids.');
      }
      seen.add(message.messageId);
    }
    const anchorIndex = copied.findIndex((message) => message.messageId === request.childAnchorMessageId);
    if (anchorIndex < 0) {
      throw forkSelectorError('FORK_CONTEXT_ANCHOR_NOT_COPIED', 'Fork active context anchor is missing from copied messages.');
    }
    if (anchorIndex !== copied.length - 1) {
      throw forkSelectorError('FORK_CONTEXT_RECORD_AFTER_ANCHOR', 'Fork active context input must stop at the child anchor.');
    }

    const activeMessages = applySummaryCoverage(copied);
    const records = new Map<MessageId, SessionMessageRecord>();
    for (const message of activeMessages) {
      records.set(message.messageId, toRecord(message));
    }
    const anchor = copied[anchorIndex]!;
    const outcome = await selectHistoryCandidates({
      owner: { tenantId: anchor.tenantId, subjectId: anchor.subjectId, displayName: 'fork-context' },
      agentId: anchor.agentId,
      sessionId: request.childSessionId,
      currentRequestId: anchor.requestId,
      activeContextItems: activeMessages.map((message) => ({ messageId: message.messageId })),
      activeContextVersion: 0,
      loadMessages: async (messageIds) => {
        const out: SessionMessageRecord[] = [];
        for (const messageId of messageIds) {
          const record = records.get(messageId);
          if (record === undefined) {
            throw forkSelectorError('FORK_CONTEXT_MESSAGE_UNRESOLVABLE', 'Fork active context message ref could not be resolved.');
          }
          out.push(record);
        }
        return out;
      },
    });
    return {
      messageIds: uniqueMessageIds([
        ...activeMessages.filter((message) => message.role === 'SUMMARY').map((message) => message.messageId),
        ...outcome.priorTurnCandidates,
        ...outcome.currentRequestRecords.map((record) => record.messageId),
      ]),
    };
  }
}

export function createForkActiveContextSelector(): ForkActiveContextSelectionPort {
  return new DefaultForkActiveContextSelector();
}

function applySummaryCoverage(messages: readonly ForkActiveContextMessage[]): readonly ForkActiveContextMessage[] {
  const ids = new Set(messages.map((message) => message.messageId));
  const covered = new Set<MessageId>();
  for (const message of messages) {
    if (message.role !== 'SUMMARY' || message.metadata['kind'] !== 'CONTEXT_COMPRESSION_SUMMARY') {
      continue;
    }
    for (const ref of summaryRefs(message, 'coveredMessageRefs')) {
      if (!ids.has(ref)) {
        throw forkSelectorError('FORK_CONTEXT_SUMMARY_REF_UNRESOLVABLE', 'Fork summary metadata references a message outside the copied prefix.');
      }
      covered.add(ref);
    }
    for (const ref of summaryRefs(message, 'retainedTailMessageRefs')) {
      if (!ids.has(ref)) {
        throw forkSelectorError('FORK_CONTEXT_SUMMARY_REF_UNRESOLVABLE', 'Fork summary metadata references a message outside the copied prefix.');
      }
    }
  }
  return messages.filter((message) => !covered.has(message.messageId));
}

function summaryRefs(message: ForkActiveContextMessage, key: 'coveredMessageRefs' | 'retainedTailMessageRefs'): readonly MessageId[] {
  const value = message.metadata[key];
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    throw forkSelectorError('FORK_CONTEXT_SUMMARY_REF_UNRESOLVABLE', 'Fork summary metadata has invalid message refs.');
  }
  return value.map((item) => brand<string, 'MessageId'>(item));
}

function toRecord(message: ForkActiveContextMessage): SessionMessageRecord {
  return {
    tenantId: message.tenantId,
    subjectId: message.subjectId,
    agentId: message.agentId,
    messageId: message.messageId,
    sessionId: message.sessionId,
    requestId: message.requestId,
    ...(message.runId === undefined ? {} : { runId: message.runId }),
    role: message.role,
    content: message.content,
    contentType: message.contentType,
    metadata: message.metadata,
    visible: message.visible,
    createdAt: message.createdAt,
  };
}

function uniqueMessageIds(messageIds: readonly MessageId[]): readonly MessageId[] {
  const seen = new Set<string>();
  const result: MessageId[] = [];
  for (const messageId of messageIds) {
    if (seen.has(messageId)) {
      continue;
    }
    seen.add(messageId);
    result.push(messageId);
  }
  return result;
}

function forkSelectorError(code: string, message: string): AgentError {
  return new AgentError({ code, message, category: 'VALIDATION', retryable: false });
}
