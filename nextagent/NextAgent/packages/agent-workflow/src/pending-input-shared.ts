import type { JsonObject, WorkflowNodeType } from '@nextagent/agent-common';
import type {
  WorkflowLoopContext,
  WorkflowExecutionResumeState,
  WorkflowPendingInputActivation,
  WorkflowPendingInputRequest,
} from '@nextagent/agent-contracts/core';

export type { WorkflowExecutionResumeState, WorkflowPendingInputActivation, WorkflowPendingInputRequest };

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isStringMatrix(value: unknown): value is ReadonlyArray<readonly string[]> {
  return Array.isArray(value) && value.every((entry) => Array.isArray(entry) && entry.every((item) => typeof item === 'string'));
}

function parseLoopContext(value: unknown): WorkflowLoopContext | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const loopId = typeof value.loopId === 'string' && value.loopId.length > 0 ? value.loopId : undefined;
  const iteration = typeof value.iteration === 'number' ? value.iteration : undefined;
  const elementIndex = typeof value.elementIndex === 'number' ? value.elementIndex : undefined;
  if (loopId === undefined || iteration === undefined || elementIndex === undefined) {
    return undefined;
  }
  const collectedResults = Array.isArray(value.collectedResults) ? value.collectedResults : [];
  return { loopId, iteration, elementIndex, collectedResults };
}

export function parsePendingInputQuestions(value: unknown): WorkflowPendingInputRequest['questions'] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const questions = value.map((entry) => {
    if (!isRecord(entry) || typeof entry.prompt !== 'string' || entry.prompt.length === 0 || !Array.isArray(entry.options)) {
      return undefined;
    }
    const options = entry.options.map((option) => {
      if (
        !isRecord(option) ||
        typeof option.label !== 'string' ||
        option.label.length === 0 ||
        typeof option.value !== 'string' ||
        option.value.length === 0
      ) {
        return undefined;
      }
      return { label: option.label, value: option.value };
    });
    if (options.some((option) => option === undefined)) {
      return undefined;
    }
    return {
      prompt: entry.prompt,
      options: options as ReadonlyArray<{ readonly label: string; readonly value: string }>,
      ...(typeof entry.multiple === 'boolean' ? { multiple: entry.multiple } : {}),
      ...(typeof entry.custom === 'boolean' ? { custom: entry.custom } : {}),
    };
  });
  return questions.every((question) => question !== undefined) ? (questions as WorkflowPendingInputRequest['questions']) : undefined;
}

export function parseResumeState(value?: JsonObject): WorkflowExecutionResumeState | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const nodeId = typeof value.nodeId === 'string' && value.nodeId.length > 0 ? value.nodeId : undefined;
  const nodeType = typeof value.nodeType === 'string' && value.nodeType.length > 0 ? value.nodeType : undefined;
  const recipeName = typeof value.recipeName === 'string' && value.recipeName.length > 0 ? value.recipeName : undefined;
  const variables = isRecord(value.variables) ? (value.variables as JsonObject) : undefined;
  if (nodeId === undefined || nodeType === undefined || recipeName === undefined || variables === undefined) {
    return undefined;
  }
  const loopContext = parseLoopContext(value.loopContext);
  return {
    executionId:
      typeof value.executionId === 'string' && value.executionId.length > 0 ? value.executionId : `workflow-resume:${recipeName}:${nodeId}`,
    recipeName,
    nodeId,
    nodeType: nodeType as WorkflowNodeType,
    variables,
    ...(typeof value.pendingInputId === 'string' && value.pendingInputId.length > 0 ? { pendingInputId: value.pendingInputId } : {}),
    ...(isStringMatrix(value.answers) ? { answers: value.answers } : {}),
    ...(typeof value.pendingAnswerSummary === 'string' && value.pendingAnswerSummary.length > 0
      ? { pendingAnswerSummary: value.pendingAnswerSummary }
      : {}),
    ...(loopContext === undefined ? {} : { loopContext }),
  };
}

const PENDING_INPUT_KINDS: ReadonlySet<string> = new Set(['QUESTION', 'CONFIRMATION', 'AUTHORIZATION', 'HUMAN_HANDOFF']);

function parsePendingInputKind(value: unknown): WorkflowPendingInputRequest['kind'] | undefined {
  return typeof value === 'string' && PENDING_INPUT_KINDS.has(value) ? (value as WorkflowPendingInputRequest['kind']) : undefined;
}

export function parsePendingInputActivation(value?: JsonObject): WorkflowPendingInputActivation | undefined {
  if (value === undefined) {
    return undefined;
  }
  const kind = parsePendingInputKind(value.kind);
  const questions = parsePendingInputQuestions(value.questions);
  const resumeStateRaw = value.resumeState;
  const resumeState = isRecord(resumeStateRaw) ? parseResumeState(resumeStateRaw) : undefined;
  if (kind === undefined || questions === undefined || resumeState === undefined) {
    return undefined;
  }
  return {
    kind,
    questions,
    ...(typeof value.timeoutAt === 'number' ? { timeoutAt: value.timeoutAt } : {}),
    resumeState,
  };
}

export function parsePendingInputRequest(value: JsonObject): WorkflowPendingInputRequest | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const id = typeof value.id === 'string' && value.id.length > 0 ? value.id : undefined;
  const sessionId = typeof value.sessionId === 'string' && value.sessionId.length > 0 ? value.sessionId : undefined;
  const kind = parsePendingInputKind(value.kind);
  const questions = parsePendingInputQuestions(value.questions);
  if (id === undefined || sessionId === undefined || kind === undefined || questions === undefined) {
    return undefined;
  }
  return {
    id,
    sessionId,
    kind,
    questions: questions as WorkflowPendingInputRequest['questions'],
    ...(typeof value.timeoutAt === 'number' ? { timeoutAt: value.timeoutAt } : {}),
  };
}

export function pendingInputActivationToJson(activation: WorkflowPendingInputActivation): JsonObject {
  return {
    kind: activation.kind,
    questions: activation.questions.map((question) => ({
      prompt: question.prompt,
      options: question.options.map((option) => ({ label: option.label, value: option.value })),
      ...(question.multiple === undefined ? {} : { multiple: question.multiple }),
      ...(question.custom === undefined ? {} : { custom: question.custom }),
    })),
    ...(activation.timeoutAt === undefined ? {} : { timeoutAt: activation.timeoutAt }),
    resumeState: {
      executionId: activation.resumeState.executionId,
      recipeName: activation.resumeState.recipeName,
      nodeId: activation.resumeState.nodeId,
      nodeType: activation.resumeState.nodeType,
      variables: activation.resumeState.variables,
      ...(activation.resumeState.pendingInputId === undefined ? {} : { pendingInputId: activation.resumeState.pendingInputId }),
      ...(activation.resumeState.answers === undefined ? {} : { answers: activation.resumeState.answers }),
      ...(activation.resumeState.pendingAnswerSummary === undefined ? {} : { pendingAnswerSummary: activation.resumeState.pendingAnswerSummary }),
      ...(activation.resumeState.loopContext === undefined
        ? {}
        : {
            loopContext: {
              loopId: activation.resumeState.loopContext.loopId,
              iteration: activation.resumeState.loopContext.iteration,
              elementIndex: activation.resumeState.loopContext.elementIndex,
              collectedResults: activation.resumeState.loopContext.collectedResults,
            },
          }),
    },
  };
}

export function pendingInputRequestToJson(request: WorkflowPendingInputRequest): JsonObject {
  return {
    id: request.id,
    sessionId: request.sessionId,
    kind: request.kind,
    questions: request.questions.map((question) => ({
      prompt: question.prompt,
      options: question.options.map((option) => ({ label: option.label, value: option.value })),
      ...(question.multiple === undefined ? {} : { multiple: question.multiple }),
      ...(question.custom === undefined ? {} : { custom: question.custom }),
    })),
    ...(request.timeoutAt === undefined ? {} : { timeoutAt: request.timeoutAt }),
  };
}
