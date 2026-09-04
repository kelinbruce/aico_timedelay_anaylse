import { type JsonObject } from '@nextagent/agent-common';
import type { AgentAssemblyRegistry, AgentCapabilityBinding } from '@nextagent/agent-contracts/agent-assembly';
import type {
  LongTermMemoryRecord,
  LongTermMemoryRetrieverGateway,
  LongTermMemoryStoreGateway,
  LongTermMemorySummary,
  RequestRunStoreGateway,
  SearchItem,
  SessionMessageStoreGateway,
} from '@nextagent/agent-contracts/gateway';
import type { ModelMessage, ModelMessageContentPart, ModelToolDescriptor } from '@nextagent/agent-contracts/model';
import type { LifecycleHookDefinition, ModelInvokeBoundary } from '@nextagent/agent-contracts/runtime';
import { RenderedContextSupplementAdmission, type RenderedContextSupplement, wrapInSystemReminder } from '@nextagent/agent-context-engine';
import { createUserQueryMemoryRecallService } from '@nextagent/agent-memory';
import { RegisteredTrustedTerminalLifecycleHookExecutor, type TrustedTerminalLifecycleHookInput } from '@nextagent/agent-runtime';

export const userQueryMemoryRecallHookId = 'user-query-memory-recall';
const maxTrackedRecallAttempts = 1_000;

export const userQueryMemoryRecallHookDefinition: LifecycleHookDefinition = {
  hookId: userQueryMemoryRecallHookId,
  kind: 'CUSTOM',
  supportedStages: ['BEFORE_MODEL_INVOKE'],
  effects: ['TRANSFORM'],
  executionStrategy: 'SERIAL_IMPACT',
  failureMode: 'CONTINUE',
};

export function createUserQueryMemoryRecallTrustedHook(input: {
  readonly assemblyRegistry: AgentAssemblyRegistry;
  readonly requestRuns: RequestRunStoreGateway;
  readonly messages: SessionMessageStoreGateway;
  readonly longTermMemoryRetriever: LongTermMemoryRetrieverGateway;
  readonly longTermMemoryStore: LongTermMemoryStoreGateway;
}): RegisteredTrustedTerminalLifecycleHookExecutor {
  const recall = createUserQueryMemoryRecallService({
    retriever: input.longTermMemoryRetriever,
    store: input.longTermMemoryStore,
  });
  const admission = new RenderedContextSupplementAdmission();
  const attemptedRunIds = new Map<string, undefined>();

  return new RegisteredTrustedTerminalLifecycleHookExecutor({
    [userQueryMemoryRecallHookId]: async (hookInput, signal) => {
      const coordinates = hookInput.coordinates;
      if (coordinates.sessionId === undefined || coordinates.requestId === undefined || coordinates.requestRunId === undefined) {
        return skipped('MEMORY_RECALL_SKIPPED_COORDINATES_INCOMPLETE');
      }
      if (!isInitialModelInvocation(hookInput.boundary.stepId)) {
        return skipped('MEMORY_RECALL_SKIPPED_NOT_INITIAL_MODEL');
      }
      const finalInput = finalModelInput(hookInput.boundary);
      if (finalInput === undefined) {
        return skipped('MEMORY_RECALL_SKIPPED_FINAL_INPUT_INVALID');
      }

      let assembly: Awaited<ReturnType<AgentAssemblyRegistry['require']>>;
      try {
        assembly = await input.assemblyRegistry.require(coordinates.agentId, coordinates.agentVersion);
      } catch {
        return skipped('MEMORY_RECALL_SKIPPED_ASSEMBLY_LOAD_FAILED');
      }
      if (!hasRequiredMemoryBindings(assembly.capabilityBindings)) {
        return skipped('MEMORY_RECALL_SKIPPED_BINDINGS_MISSING');
      }
      let run: Awaited<ReturnType<RequestRunStoreGateway['loadRun']>>;
      try {
        run = await input.requestRuns.loadRun({
          ...hookInput.ownerScope,
          agentId: coordinates.agentId,
          runId: coordinates.requestRunId,
        });
      } catch {
        return skipped('MEMORY_RECALL_SKIPPED_RUN_LOAD_FAILED');
      }
      if (
        run === undefined ||
        run.sessionId !== coordinates.sessionId ||
        run.requestId !== coordinates.requestId ||
        run.agentVersion !== coordinates.agentVersion ||
        run.agentAssemblyRef !== coordinates.agentAssemblyRef ||
        run.attempt !== 1 ||
        run.retryOfRunId !== undefined ||
        run.parentRunId !== undefined
      ) {
        return skipped('MEMORY_RECALL_SKIPPED_RUN_INELIGIBLE');
      }

      let rootMessage: Awaited<ReturnType<SessionMessageStoreGateway['loadMessage']>>;
      try {
        rootMessage = await input.messages.loadMessage({
          ...hookInput.ownerScope,
          agentId: coordinates.agentId,
          messageId: coordinates.requestId,
        });
      } catch {
        return skipped('MEMORY_RECALL_SKIPPED_ROOT_MESSAGE_LOAD_FAILED');
      }
      if (
        rootMessage === undefined ||
        rootMessage.sessionId !== coordinates.sessionId ||
        rootMessage.requestId !== coordinates.requestId ||
        rootMessage.runId !== coordinates.requestRunId ||
        rootMessage.role !== 'USER' ||
        !rootMessage.visible ||
        rootMessage.content.trim().length === 0
      ) {
        return completed('MEMORY_RECALL_NO_CONTEXT_ROOT_MESSAGE_INVALID', { contextDisposition: 'NO_CONTEXT' });
      }
      if (!claimRecallAttempt(attemptedRunIds, coordinates.requestRunId)) {
        return skipped('MEMORY_RECALL_SKIPPED_ALREADY_ATTEMPTED');
      }

      const recallRequest = {
        ...hookInput.ownerScope,
        agentId: coordinates.agentId,
        queryText: rootMessage.content,
      };
      const [recalled, characteristics] = await Promise.all([
        recall.recall(recallRequest, signal),
        recall.recallUserCharacteristics(recallRequest, signal),
      ]);

      const supplements: RenderedContextSupplement[] = [];
      if (recalled.status === 'SUCCESS') {
        supplements.push(
          { kind: 'L2', message: l2MemoryMessage(recalled.l2Details), exclusiveGroup: 'broad-recall' },
          { kind: 'L1', message: l1MemoryMessage(recalled.l1Items), exclusiveGroup: 'broad-recall' },
        );
      }
      const characteristicsMsg =
        characteristics.status === 'SUCCESS' && characteristics.items.length > 0 ? characteristicsMessage(characteristics.items) : undefined;
      if (characteristicsMsg !== undefined) {
        supplements.push({ kind: 'CHARACTERISTICS', message: characteristicsMsg });
      }

      const characteristicsLookupDiagnosticCode =
        characteristics.status === 'SUCCESS'
          ? characteristics.items.length > 0
            ? 'MEMORY_RECALL_CHARACTERISTICS_AVAILABLE'
            : 'MEMORY_RECALL_CHARACTERISTICS_NO_CONTEXT'
          : `MEMORY_RECALL_${characteristics.reason}`;

      if (supplements.length === 0) {
        return completed(recalled.status === 'NO_CONTEXT' ? `MEMORY_RECALL_${recalled.reason}` : 'MEMORY_RECALL_NO_CONTEXT', {
          ...diagnostic(recalled.status === 'NO_CONTEXT' ? `MEMORY_RECALL_${recalled.reason}` : 'MEMORY_RECALL_NO_CONTEXT', recalled, 'NO_CONTEXT'),
          characteristicsDisposition: 'NO_CONTEXT',
          characteristicsDiagnosticCode: characteristicsLookupDiagnosticCode,
        });
      }

      const admitted = admission.admit({ ...finalInput, supplements });
      const characteristicsAdmitted =
        characteristicsMsg !== undefined && admitted.disposition !== 'NO_CONTEXT' && admitted.messages.includes(characteristicsMsg);
      const characteristicsDisposition = characteristicsAdmitted ? 'CHARACTERISTICS_CONTEXT' : 'NO_CONTEXT';
      const characteristicsDiagnosticCode = characteristicsAdmitted ? 'MEMORY_RECALL_CHARACTERISTICS_ADMITTED' : characteristicsLookupDiagnosticCode;

      if (admitted.disposition === 'NO_CONTEXT') {
        return completed('MEMORY_RECALL_NO_CONTEXT_BUDGET_EXCEEDED', {
          ...diagnostic('MEMORY_RECALL_NO_CONTEXT_BUDGET_EXCEEDED', recalled, 'NO_CONTEXT'),
          characteristicsDisposition,
          characteristicsDiagnosticCode,
        });
      }
      const messages = insertManyBeforeLastUser(finalInput.messages, admitted.messages);
      return messages === undefined
        ? completed('MEMORY_RECALL_NO_CONTEXT_INSERT_FAILED', {
            ...diagnostic('MEMORY_RECALL_NO_CONTEXT_INSERT_FAILED', recalled, 'NO_CONTEXT'),
            characteristicsDisposition,
            characteristicsDiagnosticCode,
          })
        : {
            outcome: 'PASS',
            mutation: { messages: messages as unknown as readonly JsonObject[] },
            diagnostic: {
              ...diagnostic(`MEMORY_RECALL_${admitted.disposition}_ADMITTED`, recalled, broadRecallDisposition(admitted.disposition)),
              characteristicsDisposition,
              characteristicsDiagnosticCode,
            },
          };
    },
  });
}

function skipped(diagnosticCode: string) {
  return { outcome: 'SKIP' as const, diagnostic: { diagnosticCode } };
}

function isInitialModelInvocation(stepId: string): boolean {
  return stepId === 'turn-1';
}

function claimRecallAttempt(attemptedRunIds: Map<string, undefined>, requestRunId: string): boolean {
  if (attemptedRunIds.has(requestRunId)) {
    return false;
  }
  if (attemptedRunIds.size >= maxTrackedRecallAttempts) {
    const oldestRunId = attemptedRunIds.keys().next().value;
    if (oldestRunId !== undefined) {
      attemptedRunIds.delete(oldestRunId);
    }
  }
  attemptedRunIds.set(requestRunId, undefined);
  return true;
}

function completed(
  diagnosticCode: string,
  values: {
    readonly diagnosticCode?: string;
    readonly candidateCount?: number;
    readonly detailCount?: number;
    readonly contextDisposition?: 'L2_CONTEXT' | 'L1_CONTEXT' | 'NO_CONTEXT';
    readonly characteristicsDisposition?: 'CHARACTERISTICS_CONTEXT' | 'NO_CONTEXT';
    readonly characteristicsDiagnosticCode?: string;
  },
) {
  return { outcome: 'PASS' as const, diagnostic: { diagnosticCode, ...values } };
}

function diagnostic(
  diagnosticCode: string,
  recalled:
    | { readonly status: 'SUCCESS'; readonly l1Items: readonly SearchItem[]; readonly l2Details: readonly LongTermMemoryRecord[] }
    | { readonly status: 'NO_CONTEXT'; readonly candidateCount: number; readonly detailCount: 0 },
  contextDisposition: 'L2_CONTEXT' | 'L1_CONTEXT' | 'NO_CONTEXT',
) {
  return {
    diagnosticCode,
    candidateCount: recalled.status === 'SUCCESS' ? recalled.l1Items.length : recalled.candidateCount,
    detailCount: recalled.status === 'SUCCESS' ? recalled.l2Details.length : recalled.detailCount,
    contextDisposition,
  };
}

function broadRecallDisposition(
  admittedDisposition: 'L2_CONTEXT' | 'L1_CONTEXT' | 'CHARACTERISTICS_CONTEXT',
): 'L2_CONTEXT' | 'L1_CONTEXT' | 'NO_CONTEXT' {
  return admittedDisposition === 'CHARACTERISTICS_CONTEXT' ? 'NO_CONTEXT' : admittedDisposition;
}

function hasRequiredMemoryBindings(bindings: readonly AgentCapabilityBinding[]): boolean {
  const enabledIds = new Set(
    bindings
      .filter((binding) => binding.enabled !== false && binding.capabilityType === 'TOOL' && binding.providerId === 'memory-tools')
      .map((binding) => binding.capabilityId),
  );
  return enabledIds.has('search_memory') && enabledIds.has('get_memory_detail');
}

function finalModelInput(boundary: ModelInvokeBoundary):
  | {
      readonly messages: readonly ModelMessage[];
      readonly tools: readonly ModelToolDescriptor[];
      readonly contextWindowTokens: number;
      readonly reservedOutputTokens?: number;
    }
  | undefined {
  if (boundary.contextWindowTokens === undefined || boundary.contextWindowTokens <= 0) {
    return undefined;
  }
  if (boundary.messages === undefined) {
    return undefined;
  }
  if (!Array.isArray(boundary.tools)) {
    return undefined;
  }
  const maxOutputTokens = boundary.maxOutputTokens;
  const messages = boundary.messages;
  if (!messages.some((message) => message.role === 'USER')) {
    return undefined;
  }
  return {
    messages,
    tools: boundary.tools,
    contextWindowTokens: boundary.contextWindowTokens,
    ...(typeof maxOutputTokens === 'number' && maxOutputTokens > 0 ? { reservedOutputTokens: maxOutputTokens } : {}),
  };
}

function insertManyBeforeLastUser(messages: readonly ModelMessage[], inserts: readonly ModelMessage[]): readonly ModelMessage[] | undefined {
  if (inserts.length === 0) {
    return messages;
  }
  let index = -1;
  for (let candidate = messages.length - 1; candidate >= 0; candidate -= 1) {
    if (messages[candidate]?.role === 'USER') {
      index = candidate;
      break;
    }
  }
  if (index < 0) {
    return undefined;
  }
  return [...messages.slice(0, index), ...inserts, ...messages.slice(index)];
}

function l2MemoryMessage(details: readonly LongTermMemoryRecord[]): ModelMessage {
  return memoryMessage(
    details.map((detail, index) => `${index + 1}. [${detail.memoryType}] ${detail.briefIndex}\n${detail.content}`),
    '以下内容来自用户长期记忆，仅作为回答当前问题的背景事实：',
  );
}

function l1MemoryMessage(items: readonly SearchItem[]): ModelMessage {
  return memoryMessage(
    items.map((item, index) => `${index + 1}. [${item.summary.memoryType}] ${item.summary.briefIndex}\n${item.summary.content}`),
    '以下内容来自用户长期记忆，仅作为回答当前问题的背景事实：',
  );
}

function characteristicsMessage(items: readonly LongTermMemorySummary[]): ModelMessage {
  return memoryMessage(
    items.map((item, index) => `${index + 1}. ${item.briefIndex}\n${item.content}`),
    '以下为当前用户的偏好与特征，作为回答风格、语言、输出格式与工作流的默认参考，可被用户当场要求覆盖：',
  );
}

function memoryMessage(entries: readonly string[], prefix: string): ModelMessage {
  // Wrap in a <system-reminder> tag so the model treats this as system-injected
  // runtime context, not a user instruction. Attribution isolation is carried
  // by the tag + system prompt declaration; the prefix only describes the
  // content's purpose. See add-ts-system-reminder-memory-v1.
  const body = [prefix, ...entries].join('\n\n');
  const content: ModelMessageContentPart = {
    type: 'text',
    text: wrapInSystemReminder(body),
  };
  return { role: 'USER', content: [content] };
}
