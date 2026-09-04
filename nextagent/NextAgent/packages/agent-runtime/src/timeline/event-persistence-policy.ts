import { AgentError, CLIP_STREAM_RESULT_PROJECTION_KIND, TOOL_EVENT_TYPES, TOOL_MESSAGE_TYPES, workflowNodeTypes } from '@nextagent/agent-common';
import type { RunTimelineEvent } from '@nextagent/agent-contracts/runtime';

export type TimelineEventPersistence = 'PERSISTED' | 'LIVE_ONLY';
export type SelectiveTimelineEventPersistencePolicy = (event: RunTimelineEvent) => TimelineEventPersistence;

export interface TimelineEventPersistencePolicy {
  resolve: (event: RunTimelineEvent) => TimelineEventPersistence;
}

interface MandatoryTimelineEventRule {
  readonly eventType: RunTimelineEvent['type'];
  readonly persistence: TimelineEventPersistence;
  readonly payloadMatches: (payload: RunTimelineEvent['inlinePayload']) => boolean;
}

const mandatoryTimelineEventRules: readonly MandatoryTimelineEventRule[] = [
  {
    eventType: 'LLM_THINKING_DELTA',
    persistence: 'LIVE_ONLY',
    payloadMatches: (payload) => isValidThinkingPayload(payload, false),
  },
  {
    eventType: 'LLM_THINKING_DELTA',
    persistence: 'PERSISTED',
    payloadMatches: (payload) => isValidThinkingPayload(payload, true),
  },
  {
    eventType: 'LLM_CONTENT_DELTA',
    persistence: 'PERSISTED',
    payloadMatches: isValidCompletedContentReference,
  },
  {
    eventType: 'LLM_CONTENT_DELTA',
    persistence: 'LIVE_ONLY',
    payloadMatches: isValidLiveContentPayload,
  },
  {
    eventType: 'CAPABILITY_RESULT_DELTA',
    persistence: 'LIVE_ONLY',
    payloadMatches: (payload) =>
      payload.capabilityKind === undefined && payload.targetCapabilityId === undefined && hasValidCapabilityResultProjectionKind(payload),
  },
  {
    eventType: 'TOOL_STRUCTURED_DELTA',
    persistence: 'PERSISTED',
    payloadMatches: isQualifiedWorkflowProductPayload,
  },
  {
    eventType: 'TOOL_STRUCTURED_DELTA',
    persistence: 'PERSISTED',
    payloadMatches: (payload) => payload['streaming'] === true,
  },
  {
    eventType: 'TOOL_STRUCTURED_DELTA',
    persistence: 'LIVE_ONLY',
    payloadMatches: () => true,
  },
  {
    eventType: 'CAPABILITY_STARTED',
    persistence: 'PERSISTED',
    payloadMatches: isValidCapabilityStartedPayload,
  },
  {
    eventType: 'CAPABILITY_COMPLETED',
    persistence: 'PERSISTED',
    payloadMatches: isValidCapabilityCompletedPayload,
  },
];

export function createTimelineEventPersistencePolicy(
  selectivePolicy: SelectiveTimelineEventPersistencePolicy = () => 'PERSISTED',
): TimelineEventPersistencePolicy {
  return {
    resolve(event) {
      const declaredRules = mandatoryTimelineEventRules.filter((rule) => rule.eventType === event.type);
      const mandatoryRule = declaredRules.find((rule) => rule.payloadMatches(event.inlinePayload));
      if (declaredRules.length > 0 && mandatoryRule === undefined) {
        throw invalidPersistenceError();
      }
      const resolved = mandatoryRule?.persistence ?? selectivePolicy(event);
      if (event.persistence !== undefined && event.persistence !== resolved) {
        throw invalidPersistenceError();
      }
      return resolved;
    },
  };
}

function isValidThinkingPayload(payload: RunTimelineEvent['inlinePayload'], completed: boolean): boolean {
  const reasoning = payload.reasoning;
  const stepId = payload.stepId;
  if (typeof reasoning !== 'string' || reasoning.trim().length === 0) {
    return false;
  }
  if (typeof stepId !== 'string' || stepId.trim().length === 0) {
    return false;
  }
  if (payload.segmentId !== undefined || payload.segmentOrdinal !== undefined || payload.content !== undefined || payload.text !== undefined) {
    return false;
  }
  return completed ? payload.completed === true : payload.completed === undefined;
}

function isValidCompletedContentReference(payload: RunTimelineEvent['inlinePayload']): boolean {
  return (
    isNonBlankString(payload.messageId) &&
    isNonBlankString(payload.stepId) &&
    payload.completed === true &&
    payload.final === undefined &&
    !hasRecoverableContent(payload)
  );
}

function isValidLiveContentPayload(payload: RunTimelineEvent['inlinePayload']): boolean {
  if (payload.messageId !== undefined || payload.completed !== undefined) {
    return false;
  }
  return typeof payload.content === 'string';
}

function isValidCapabilityStartedPayload(payload: RunTimelineEvent['inlinePayload']): boolean {
  if (!hasValidCapabilityPublicIdentity(payload)) {
    return false;
  }
  if (payload.workflowEventType !== undefined) {
    return isQualifiedWorkflowLifecycleEvent(payload, ['NODE_STARTED']);
  }
  const hasCapabilityIdentity = payload.capabilityId !== undefined || payload.toolCallId !== undefined;
  if (!hasCapabilityIdentity) {
    return payload.messageId === undefined;
  }
  if (hasRecoverableContent(payload)) {
    return false;
  }
  return isNonBlankString(payload.messageId) && isNonBlankString(payload.capabilityId) && isNonBlankString(payload.toolCallId);
}

function isValidCapabilityCompletedPayload(payload: RunTimelineEvent['inlinePayload']): boolean {
  if (!hasValidCapabilityPublicIdentity(payload) || !hasValidCapabilityResultProjectionKind(payload)) {
    return false;
  }
  if (payload.workflowEventType !== undefined) {
    return isQualifiedWorkflowLifecycleEvent(payload, ['NODE_COMPLETED', 'NODE_FAILED', 'NODE_SKIPPED', 'NODE_WAITING']);
  }
  const hasCapabilityIdentity = payload.capabilityId !== undefined || payload.toolCallId !== undefined;
  if (!hasCapabilityIdentity) {
    return payload.messageId === undefined;
  }
  if (hasRecoverableContent(payload)) {
    return false;
  }
  if (!isNonBlankString(payload.capabilityId) || !isNonBlankString(payload.toolCallId)) {
    return false;
  }
  if (payload.messageId !== undefined && !isNonBlankString(payload.messageId)) {
    return false;
  }
  return payload.status !== 'SUCCEEDED' || isNonBlankString(payload.messageId);
}

function hasValidCapabilityPublicIdentity(payload: RunTimelineEvent['inlinePayload']): boolean {
  const capabilityKind = payload.capabilityKind;
  if (
    capabilityKind !== undefined &&
    capabilityKind !== 'TOOL' &&
    capabilityKind !== 'SKILL' &&
    capabilityKind !== 'AGENT' &&
    capabilityKind !== 'WORKFLOW'
  ) {
    return false;
  }
  const targetCapabilityId = payload.targetCapabilityId;
  if (targetCapabilityId === undefined) {
    return true;
  }
  if (typeof targetCapabilityId !== 'string') {
    return false;
  }
  const trimmed = targetCapabilityId.trim();
  if (trimmed.length === 0 || trimmed !== targetCapabilityId || Array.from(trimmed).length > 128 || /\p{Cc}/u.test(trimmed)) {
    return false;
  }
  return payload.capabilityId === 'Agent' || payload.capabilityId === 'Skill' || payload.capabilityId === 'Workflow';
}

function hasValidCapabilityResultProjectionKind(payload: RunTimelineEvent['inlinePayload']): boolean {
  return payload.resultProjectionKind === undefined || payload.resultProjectionKind === CLIP_STREAM_RESULT_PROJECTION_KIND;
}

function isQualifiedWorkflowLifecycleEvent(payload: RunTimelineEvent['inlinePayload'], acceptedEventTypes: readonly string[]): boolean {
  return (
    payload.messageId === undefined &&
    hasWorkflowProjectionIdentity(payload) &&
    typeof payload.workflowEventType === 'string' &&
    acceptedEventTypes.includes(payload.workflowEventType) &&
    !hasRecoverableContent(payload) &&
    payload.description === undefined &&
    isOptionalNonBlankString(payload.nodeExecutionId) &&
    isOptionalNonBlankString(payload.parentToolCallId) &&
    isOptionalNonBlankStringArray(payload.predecessorNodeExecutionIds) &&
    isOptionalNonNegativeInteger(payload.retryCount) &&
    hasMatchingWorkflowLifecycleStatus(payload)
  );
}

export function isQualifiedWorkflowProductPayload(payload: RunTimelineEvent['inlinePayload']): boolean {
  return (
    payload.messageId === undefined &&
    hasWorkflowProjectionIdentity(payload) &&
    (payload.workflowEventType === 'NODE_STARTED' || payload.workflowEventType === 'NODE_COMPLETED') &&
    isCanonicalToolEventType(payload.toolEventType) &&
    isCanonicalToolMessageType(payload.toolMessageType) &&
    payload.content !== undefined &&
    payload.content !== null &&
    !hasUnexpectedWorkflowProductBody(payload) &&
    payload.accumulated === true &&
    isOptionalNonBlankString(payload.nodeExecutionId) &&
    isOptionalNonBlankString(payload.parentToolCallId) &&
    isOptionalNonBlankStringArray(payload.predecessorNodeExecutionIds) &&
    isOptionalNonNegativeInteger(payload.retryCount)
  );
}

function hasUnexpectedWorkflowProductBody(payload: RunTimelineEvent['inlinePayload']): boolean {
  return ['text', 'reasoning', 'delta', 'arguments', 'input', 'output', 'result', 'safeResult', 'structuredPayload'].some(
    (key) => payload[key] !== undefined,
  );
}

function hasWorkflowProjectionIdentity(payload: RunTimelineEvent['inlinePayload']): boolean {
  return (
    isNonBlankString(payload.nodeId) &&
    isWorkflowNodeType(payload.nodeType) &&
    isNonBlankString(payload.capabilityId) &&
    isNonBlankString(payload.toolCallId) &&
    payload.toolCallId.startsWith('workflow:') &&
    payload.toolCallId.endsWith(`:${payload.nodeId}`)
  );
}

function isWorkflowNodeType(value: unknown): boolean {
  return isNonBlankString(value) && (workflowNodeTypes as readonly string[]).includes(value);
}

function isCanonicalToolEventType(value: unknown): boolean {
  return isNonBlankString(value) && (TOOL_EVENT_TYPES as readonly string[]).includes(value);
}

function isCanonicalToolMessageType(value: unknown): boolean {
  return isNonBlankString(value) && (TOOL_MESSAGE_TYPES as readonly string[]).includes(value);
}

function isOptionalNonBlankString(value: unknown): boolean {
  return value === undefined || isNonBlankString(value);
}

function isOptionalNonBlankStringArray(value: unknown): boolean {
  return value === undefined || (Array.isArray(value) && value.every(isNonBlankString));
}

function isOptionalNonNegativeInteger(value: unknown): boolean {
  return value === undefined || (typeof value === 'number' && Number.isInteger(value) && value >= 0);
}

function hasMatchingWorkflowLifecycleStatus(payload: RunTimelineEvent['inlinePayload']): boolean {
  switch (payload.workflowEventType) {
    case 'NODE_STARTED':
      return payload.status === undefined;
    case 'NODE_COMPLETED':
      return payload.status === 'SUCCEEDED';
    case 'NODE_FAILED':
      return payload.status === 'FAILED' || payload.status === 'TIMED_OUT';
    case 'NODE_SKIPPED':
    case 'NODE_WAITING':
      return payload.status === 'DEGRADED';
    default:
      return false;
  }
}

function hasRecoverableContent(payload: RunTimelineEvent['inlinePayload']): boolean {
  return ['content', 'text', 'reasoning', 'delta', 'arguments', 'input', 'output', 'result', 'safeResult', 'structuredPayload'].some(
    (key) => payload[key] !== undefined,
  );
}

function isNonBlankString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function invalidPersistenceError(): AgentError {
  return new AgentError({
    code: 'TIMELINE_EVENT_PERSISTENCE_INVALID',
    message: 'Timeline event persistence classification is invalid.',
    category: 'VALIDATION',
    retryable: false,
  });
}
