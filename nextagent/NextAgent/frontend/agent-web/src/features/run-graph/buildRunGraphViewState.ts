import type { StreamEnvelope, StreamEventType, TurnBlock } from '../../state/contracts.ts';
import type {
  RunGraphActivityItem,
  RunGraphEdgeState,
  RunGraphEventReference,
  RunGraphNodeKind,
  RunGraphNodeState,
  RunGraphStatus,
  RunGraphTranslate,
  RunGraphViewState,
} from './types.ts';
import { isResultStreamEvent, mergeStreamText, readCompactedEventCount, readStreamText } from '../chat/utils/streamTextSemantics.ts';
import { readFailureErrorCodeFromPayload } from '../chat/utils/failureDetails.ts';
import { toTimestampMillis } from '../../utils/time.ts';
import { resolveSystemEventPresentation, type GovernedSystemEventType } from '../chat/process/systemEventPresentation.ts';

const TERMINAL_EVENTS = new Set<StreamEventType>(['REQUEST_COMPLETED', 'REQUEST_FAILED', 'REQUEST_CANCELED', 'REQUEST_SUPERSEDED']);
const USER_INPUT_EVENTS = new Set<StreamEventType>(['USER_INPUT_REQUIRED', 'USER_INPUT_RECEIVED', 'USER_INPUT_TIMEOUT', 'USER_INPUT_CANCELED']);
const DEGRADATION_EVENTS = new Set<StreamEventType>(['DEGRADATION_NOTICE', 'HOOK_DEGRADED', 'CONTEXT_COMPACTED']);
const MAX_SUMMARY_LENGTH = 140;

interface MutableNode {
  id: string;
  kind: RunGraphNodeKind;
  title: string;
  status: RunGraphStatus;
  summary: string;
  detailLines: string[];
  startedAt: StreamEnvelope['createdAt'] | null;
  updatedAt: StreamEnvelope['createdAt'] | null;
  relatedEventIds: string[];
  relatedToolCallIds: string[];
  references: RunGraphEventReference[];
  firstSortKey: string;
}

export function buildRunGraphViewState(block: TurnBlock, t: RunGraphTranslate): RunGraphViewState {
  const events = sortEvents(block.aiEvents);
  const nodes = new Map<string, MutableNode>();
  const capabilityNodeIds: string[] = [];
  let thinkingEventCount = 0;
  let contentEventCount = 0;
  let logicalEventCount = 0;
  let answerContent = '';
  let answerCharacterCount = 0;
  let latestNodeId: string | null = null;

  for (const event of events) {
    logicalEventCount += readCompactedEventCount(event);
    const eventNodeId = resolveNodeId(event);
    const reference = toEventReference(event);

    if (event.eventType === 'REQUEST_ACCEPTED') {
      const node = upsertNode(nodes, {
        id: 'request',
        kind: 'request',
        title: t('turnRunGraph.nodes.request'),
        status: 'success',
        summary: readSafePayloadText(event) || t('turnRunGraph.summaries.requestAccepted'),
        event,
      });
      appendReference(node, reference);
      latestNodeId = node.id;
      continue;
    }

    if (event.eventType === 'LLM_THINKING_DELTA') {
      thinkingEventCount += readCompactedEventCount(event);
      const node = upsertNode(nodes, {
        id: 'model',
        kind: 'model',
        title: t('turnRunGraph.nodes.model'),
        status: terminalStatusFromBlock(block.status) ?? 'running',
        summary: t('turnRunGraph.summaries.modelThinking', { count: thinkingEventCount }),
        event,
      });
      node.detailLines = [t('turnRunGraph.summaries.thinkingSuppressed', { count: thinkingEventCount })];
      appendReference(node, reference);
      latestNodeId = node.id;
      continue;
    }

    if (event.eventType === 'LLM_CONTENT_DELTA' && !isCapabilityResultContent(event)) {
      contentEventCount += readCompactedEventCount(event);
      const contentDelta = readPayloadText(event);
      if (contentDelta.length > 0) {
        answerContent = mergeStreamText(answerContent, contentDelta, event.payload as Record<string, unknown>);
        answerCharacterCount = answerContent.length;
      }
      const isTerminal = terminalStatusFromBlock(block.status) !== null;
      const node = upsertNode(nodes, {
        id: 'answer',
        kind: 'answer',
        title: t('turnRunGraph.nodes.answer'),
        status: isTerminal ? 'success' : 'running',
        summary: t('turnRunGraph.summaries.answerGenerated', {
          count: contentEventCount,
          chars: answerCharacterCount,
        }),
        event,
      });
      node.detailLines = [t('turnRunGraph.summaries.answerDeltaCount', { count: contentEventCount })];
      appendReference(node, reference);
      latestNodeId = node.id;
      continue;
    }

    if (isCapabilityEvent(event)) {
      const nodeId = `capability:${eventNodeId}`;
      if (!capabilityNodeIds.includes(nodeId)) {
        capabilityNodeIds.push(nodeId);
      }
      const status = resolveCapabilityStatus(event);
      const title = readCapabilityName(event) ?? t('turnRunGraph.summaries.unknownCapability');
      const existingNode = nodes.get(nodeId);
      const summary = shouldPreserveCapabilitySummary(event, title, existingNode, t)
        ? existingNode.summary
        : describeCapabilitySummary(event, t, title);
      const node = upsertNode(nodes, {
        id: nodeId,
        kind: 'capability',
        title,
        status,
        summary,
        event,
      });
      node.title = title;
      node.status = mergeStatus(node.status, status);
      node.summary = summary;
      const toolCallId = readToolCorrelationId(event);
      if (toolCallId && !node.relatedToolCallIds.includes(toolCallId)) {
        node.relatedToolCallIds.push(toolCallId);
      }
      appendReference(node, reference);
      latestNodeId = node.id;
      continue;
    }

    if (USER_INPUT_EVENTS.has(event.eventType)) {
      const node = upsertNode(nodes, {
        id: `user-input:${event.eventType.toLowerCase()}:${eventNodeId}`,
        kind: 'userInput',
        title: describeUserInputTitle(event.eventType, t),
        status: resolveUserInputStatus(event.eventType),
        summary: describeUserInputSummary(event, t),
        event,
      });
      appendReference(node, reference);
      latestNodeId = node.id;
      continue;
    }

    if (DEGRADATION_EVENTS.has(event.eventType)) {
      const presentation = resolveSystemEventPresentation(event.eventType as GovernedSystemEventType, event.payload as Record<string, unknown>, t);
      const node = upsertNode(nodes, {
        id: `${event.eventType.toLowerCase()}:${event.eventId}`,
        kind: 'degradation',
        title: presentation.title,
        status: presentation.severity,
        summary: presentation.summary,
        event,
      });
      node.detailLines = presentation.technicalCode ? [t('turn.process.errorCodeWithCode', { code: presentation.technicalCode })] : [];
      appendReference(node, reference);
      latestNodeId = node.id;
      continue;
    }

    if (TERMINAL_EVENTS.has(event.eventType)) {
      const node = upsertNode(nodes, {
        id: 'terminal',
        kind: 'terminal',
        title: t('turnRunGraph.nodes.terminal'),
        status: terminalStatusFromEvent(event.eventType),
        summary: describeTerminalSummary(event, t),
        event,
      });
      appendReference(node, reference);
      latestNodeId = node.id;
      continue;
    }
  }

  if (events.length > 0 && !nodes.has('request')) {
    const firstEvent = events[0];
    if (firstEvent) {
      const node = upsertNode(nodes, {
        id: 'request',
        kind: 'request',
        title: t('turnRunGraph.nodes.streamStarted'),
        status: 'info',
        summary: t('turnRunGraph.summaries.requestInferred'),
        event: firstEvent,
      });
      node.firstSortKey = '00000000:0000000000000000:request';
    }
  }

  const orderedMutableNodes = Array.from(nodes.values()).sort(compareMutableNodes);
  const graphStatus = resolveGraphStatus(block, orderedMutableNodes);
  finalizeOpenNodes(orderedMutableNodes, graphStatus);
  const orderedNodes = orderedMutableNodes.map((node) => toNodeState(node, t));
  const edges = buildEdges(orderedNodes);
  const latestRunningNodeId = findLatestNodeId(orderedNodes, (node) => node.status === 'running' || node.status === 'waiting');
  const startedAt = orderedNodes[0]?.startedAt ?? null;
  const updatedAt = orderedNodes.length > 0 ? (orderedNodes[orderedNodes.length - 1]?.updatedAt ?? startedAt) : startedAt;
  const failedCapabilityCount = orderedNodes.filter((node) => node.kind === 'capability' && node.status === 'failed').length;

  return {
    runKey: block.aiEvents.map((event) => `${event.eventId}:${event.sequence}`).join('|') || block.rootMessageId,
    sessionId: readSessionId(block),
    runId: readFirstIdentity(events, 'runId'),
    requestId: readFirstIdentity(events, 'requestId'),
    rootMessageId: block.rootMessageId,
    requestContextId: readFirstIdentity(events, 'requestContextId'),
    status: graphStatus,
    statusLabel: labelStatus(graphStatus, t),
    summary: {
      eventCount: logicalEventCount,
      nodeCount: orderedNodes.length,
      capabilityCount: capabilityNodeIds.length,
      failedCapabilityCount,
      startedAt,
      updatedAt,
    },
    nodes: orderedNodes,
    edges,
    activities: orderedNodes.map((node) => toActivity(node)),
    latestNodeId,
    latestRunningNodeId,
    rawEvents: events,
  };
}

function sortEvents(events: readonly StreamEnvelope[]): StreamEnvelope[] {
  return [...events].sort((left, right) => {
    if (left.sequence !== right.sequence) {
      return left.sequence - right.sequence;
    }
    const leftTime = toTimestampMillis(left.createdAt);
    const rightTime = toTimestampMillis(right.createdAt);
    const safeLeftTime = Number.isNaN(leftTime) ? Number.MAX_SAFE_INTEGER : leftTime;
    const safeRightTime = Number.isNaN(rightTime) ? Number.MAX_SAFE_INTEGER : rightTime;
    if (safeLeftTime !== safeRightTime) {
      return safeLeftTime - safeRightTime;
    }
    return left.eventId.localeCompare(right.eventId);
  });
}

function findLatestNodeId(nodes: readonly RunGraphNodeState[], predicate: (node: RunGraphNodeState) => boolean): string | null {
  for (let index = nodes.length - 1; index >= 0; index -= 1) {
    const node = nodes[index];
    if (node && predicate(node)) {
      return node.id;
    }
  }
  return null;
}

function upsertNode(
  nodes: Map<string, MutableNode>,
  input: {
    id: string;
    kind: RunGraphNodeKind;
    title: string;
    status: RunGraphStatus;
    summary: string;
    event: StreamEnvelope;
  },
): MutableNode {
  const existing = nodes.get(input.id);
  if (existing) {
    existing.title = input.title;
    existing.status = input.status;
    existing.summary = input.summary;
    existing.updatedAt = input.event.createdAt;
    existing.firstSortKey = existing.firstSortKey || sortKey(input.event);
    return existing;
  }

  const node: MutableNode = {
    id: input.id,
    kind: input.kind,
    title: input.title,
    status: input.status,
    summary: input.summary,
    detailLines: [],
    startedAt: input.event.createdAt,
    updatedAt: input.event.createdAt,
    relatedEventIds: [],
    relatedToolCallIds: [],
    references: [],
    firstSortKey: sortKey(input.event),
  };
  nodes.set(input.id, node);
  return node;
}

function appendReference(node: MutableNode, reference: RunGraphEventReference): void {
  if (!node.relatedEventIds.includes(reference.eventId)) {
    node.relatedEventIds.push(reference.eventId);
  }
  if (!node.references.some((item) => item.eventId === reference.eventId)) {
    node.references.push(reference);
  }
}

function finalizeOpenNodes(nodes: readonly MutableNode[], graphStatus: RunGraphStatus): void {
  if (graphStatus !== 'success' && graphStatus !== 'failed' && graphStatus !== 'canceled' && graphStatus !== 'superseded') {
    return;
  }
  for (const node of nodes) {
    if (node.kind === 'terminal') {
      continue;
    }
    if (node.status === 'running' || node.status === 'waiting') {
      node.status = graphStatus;
    }
  }
}

function toNodeState(node: MutableNode, t: RunGraphTranslate): RunGraphNodeState {
  const detailLines = node.detailLines.length > 0 ? node.detailLines : [node.summary];
  return {
    id: node.id,
    x6NodeId: toX6Id(node.id),
    kind: node.kind,
    phaseLabel: labelNodePhase(node.kind, t),
    title: node.title,
    status: node.status,
    statusLabel: labelStatus(node.status, t),
    eventLabel: labelNodeEvents(node.references, t),
    metricLabel: labelNodeMetric(node, t),
    summary: node.summary,
    detailLines,
    startedAt: node.startedAt,
    updatedAt: node.updatedAt,
    relatedEventIds: [...node.relatedEventIds],
    relatedToolCallIds: [...node.relatedToolCallIds],
    references: [...node.references],
  };
}

function buildEdges(nodes: readonly RunGraphNodeState[]): RunGraphEdgeState[] {
  const edges: RunGraphEdgeState[] = [];
  for (let index = 1; index < nodes.length; index += 1) {
    const source = nodes[index - 1];
    const target = nodes[index];
    if (!source || !target) {
      continue;
    }
    const status = target.status === 'failed' || target.status === 'canceled' || target.status === 'superseded' ? target.status : 'success';
    edges.push({
      id: `edge:${source.id}:${target.id}`,
      x6EdgeId: `x6-edge-${index}`,
      source: source.x6NodeId,
      target: target.x6NodeId,
      label: null,
      status,
    });
  }
  return edges;
}

function compareMutableNodes(left: MutableNode, right: MutableNode): number {
  return left.firstSortKey.localeCompare(right.firstSortKey);
}

function sortKey(event: StreamEnvelope): string {
  const time = toTimestampMillis(event.createdAt);
  const safeTime = Number.isNaN(time) ? Number.MAX_SAFE_INTEGER : time;
  return `${String(event.sequence).padStart(8, '0')}:${String(safeTime).padStart(16, '0')}:${event.eventId}`;
}

function toX6Id(id: string): string {
  return `run-graph-node-${id.replace(/[^a-zA-Z0-9_-]/g, '-')}`;
}

function toEventReference(event: StreamEnvelope): RunGraphEventReference {
  return {
    eventId: event.eventId,
    sequence: event.sequence,
    eventType: event.eventType,
    createdAt: event.createdAt ?? null,
  };
}

function toActivity(node: RunGraphNodeState): RunGraphActivityItem {
  const description = node.kind === 'degradation' ? node.summary : node.detailLines.length > 0 ? node.detailLines.join(' ') : node.summary;
  return {
    id: `activity:${node.id}`,
    type: node.kind,
    title: node.title,
    description,
    timestamp: node.updatedAt,
    status: node.status,
    statusLabel: node.statusLabel,
    eventIds: node.relatedEventIds,
  };
}

function labelNodePhase(kind: RunGraphNodeKind, t: RunGraphTranslate): string {
  return t(`turnRunGraph.phases.${kind}`);
}

function labelNodeEvents(references: readonly RunGraphEventReference[], t: RunGraphTranslate): string {
  if (references.length === 0) {
    return t('turnRunGraph.eventMeta.none');
  }
  if (references.length === 1) {
    const reference = references[0]!;
    return t('turnRunGraph.eventMeta.single', {
      type: reference.eventType,
      seq: reference.sequence,
    });
  }
  const first = references[0]!;
  const last = references[references.length - 1]!;
  const eventTypes = Array.from(new Set(references.map((reference) => reference.eventType)));
  const typeSummary = eventTypes.length > 2 ? `${eventTypes.slice(0, 2).join(' -> ')} +${eventTypes.length - 2}` : eventTypes.join(' -> ');
  return t('turnRunGraph.eventMeta.multiple', {
    count: references.length,
    types: typeSummary,
    start: first.sequence,
    end: last.sequence,
  });
}

function labelNodeMetric(node: MutableNode, t: RunGraphTranslate): string {
  if (node.kind === 'capability' && node.relatedToolCallIds.length > 0) {
    return t('turnRunGraph.metrics.toolCall', {
      id: compactIdentifier(node.relatedToolCallIds[0]!),
    });
  }
  return t('turnRunGraph.metrics.eventCount', {
    count: node.relatedEventIds.length,
  });
}

function compactIdentifier(value: string): string {
  const normalized = value.trim();
  if (normalized.length <= 20) {
    return normalized;
  }
  return `${normalized.slice(0, 8)}...${normalized.slice(-6)}`;
}

function readSessionId(block: TurnBlock): string {
  return block.aiEvents[0]?.sessionId ?? block.userMessage.sessionId;
}

function readFirstIdentity(events: readonly StreamEnvelope[], field: 'runId' | 'requestId' | 'requestContextId'): string | null {
  for (const event of events) {
    const value = event[field];
    if (typeof value === 'string' && value.trim().length > 0) {
      return value;
    }
  }
  return null;
}

function resolveNodeId(event: StreamEnvelope): string {
  if (isCapabilityEvent(event)) {
    return readToolCorrelationId(event) ?? event.eventId;
  }
  const payload = event.payload as Record<string, unknown>;
  const inputRequestId = payload.inputRequestId;
  if (typeof inputRequestId === 'string' && inputRequestId.trim().length > 0) {
    return inputRequestId;
  }
  return event.eventId;
}

function isCapabilityEvent(event: StreamEnvelope): boolean {
  return event.eventType === 'CAPABILITY_STARTED' || event.eventType === 'CAPABILITY_RESULT_DELTA' || event.eventType === 'CAPABILITY_COMPLETED';
}

function isCapabilityResultContent(event: StreamEnvelope): boolean {
  return (event.payload as Record<string, unknown>).role === 'CAPABILITY_RESULT';
}

function readPayloadText(event: StreamEnvelope): string {
  return readStreamText(event, undefined, { allowWhitespaceOnly: isResultStreamEvent(event) });
}

function readSafePayloadText(event: StreamEnvelope): string {
  return summarizePresentationText(readPayloadText(event));
}

function summarizePresentationText(text: string): string {
  const normalized = text.trim().replace(/\s+/g, ' ');
  if (!normalized) {
    return '';
  }
  if (looksLikeJson(normalized)) {
    return '';
  }
  return normalized.length > MAX_SUMMARY_LENGTH ? `${normalized.slice(0, MAX_SUMMARY_LENGTH - 1)}...` : normalized;
}

function looksLikeJson(text: string): boolean {
  const trimmed = text.trim();
  return (trimmed.startsWith('{') && trimmed.endsWith('}')) || (trimmed.startsWith('[') && trimmed.endsWith(']'));
}

function readCapabilityName(event: StreamEnvelope): string | null {
  const payload = event.payload as Record<string, unknown>;
  const metadata = readMetadata(payload);
  const candidates = [payload.toolName, payload.capabilityName, metadata?.toolName, metadata?.capabilityName, payload.skillId, payload.capabilityId];
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim().length > 0) {
      return candidate;
    }
  }
  return null;
}

function readToolCorrelationId(event: StreamEnvelope): string | null {
  const payload = event.payload as Record<string, unknown>;
  const metadata = readMetadata(payload);
  const candidates = [payload.toolCallId, payload.invocationId, metadata?.invocationId, payload.capabilityId];
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim().length > 0) {
      return candidate;
    }
  }
  return null;
}

function readMetadata(payload: Record<string, unknown>): Record<string, unknown> | null {
  const metadata = payload.metadata;
  return metadata && typeof metadata === 'object' && !Array.isArray(metadata) ? (metadata as Record<string, unknown>) : null;
}

function resolveCapabilityStatus(event: StreamEnvelope): RunGraphStatus {
  if (event.eventType === 'CAPABILITY_STARTED') {
    return 'running';
  }
  if (event.eventType === 'CAPABILITY_RESULT_DELTA') {
    return 'running';
  }
  const payload = event.payload as Record<string, unknown>;
  const status = typeof payload.status === 'string' ? payload.status.toUpperCase() : '';
  const hasError =
    typeof payload.error === 'string' ||
    typeof payload.errorCode === 'string' ||
    typeof payload.errorMessage === 'string' ||
    status === 'FAILED' ||
    status === 'ERROR';
  return hasError ? 'failed' : 'success';
}

function mergeStatus(current: RunGraphStatus, next: RunGraphStatus): RunGraphStatus {
  if (current === 'failed' || next === 'failed') {
    return 'failed';
  }
  if (next === 'success') {
    return 'success';
  }
  return next;
}

function shouldPreserveCapabilitySummary(
  event: StreamEnvelope,
  capabilityName: string,
  existingNode: MutableNode | undefined,
  t: RunGraphTranslate,
): existingNode is MutableNode {
  if (!existingNode || event.eventType !== 'CAPABILITY_COMPLETED') {
    return false;
  }
  if (existingNode.summary === t('turnRunGraph.summaries.capabilityRunning')) {
    return false;
  }
  const payload = event.payload as Record<string, unknown>;
  const errorText = summarizePresentationText(String(payload.errorMessage ?? payload.error ?? ''));
  if (errorText) {
    return false;
  }
  const completionText = summarizePresentationText(readPayloadText(event));
  return !completionText || isGenericCompletionText(completionText, capabilityName);
}

function describeCapabilitySummary(event: StreamEnvelope, t: RunGraphTranslate, capabilityName: string): string {
  const payload = event.payload as Record<string, unknown>;
  const errorText = summarizePresentationText(String(payload.errorMessage ?? payload.error ?? ''));
  if (errorText) {
    return t('turnRunGraph.summaries.capabilityFailedWithText', { text: errorText });
  }

  if (event.eventType === 'CAPABILITY_STARTED') {
    return t('turnRunGraph.summaries.capabilityRunning');
  }

  if (event.eventType === 'CAPABILITY_RESULT_DELTA') {
    const text = summarizePresentationText(readPayloadText(event));
    return text ? t('turnRunGraph.summaries.capabilityOutputWithText', { text }) : t('turnRunGraph.summaries.capabilityOutput');
  }

  const text = summarizePresentationText(readPayloadText(event));
  if (text && !isGenericCompletionText(text, capabilityName)) {
    return t('turnRunGraph.summaries.capabilityCompletedWithText', { text });
  }
  return t('turnRunGraph.summaries.capabilityCompleted');
}

function isGenericCompletionText(text: string, capabilityName?: string): boolean {
  const normalized = text.trim().toLowerCase();
  const normalizedCapabilityName = capabilityName?.trim().toLowerCase();
  return (
    normalized === 'completed' ||
    normalized === 'tool completed' ||
    normalized === 'capability completed' ||
    (Boolean(normalizedCapabilityName) && normalized === `${normalizedCapabilityName} completed`)
  );
}

function describeUserInputTitle(eventType: StreamEventType, t: RunGraphTranslate): string {
  switch (eventType) {
    case 'USER_INPUT_REQUIRED':
      return t('turnRunGraph.nodes.userInputRequired');
    case 'USER_INPUT_RECEIVED':
      return t('turnRunGraph.nodes.userInputReceived');
    case 'USER_INPUT_TIMEOUT':
      return t('turnRunGraph.nodes.userInputTimeout');
    case 'USER_INPUT_CANCELED':
      return t('turnRunGraph.nodes.userInputCanceled');
    default:
      return t('turnRunGraph.nodes.userInputRequired');
  }
}

function resolveUserInputStatus(eventType: StreamEventType): RunGraphStatus {
  switch (eventType) {
    case 'USER_INPUT_REQUIRED':
      return 'waiting';
    case 'USER_INPUT_TIMEOUT':
    case 'USER_INPUT_CANCELED':
      return 'canceled';
    case 'USER_INPUT_RECEIVED':
      return 'success';
    default:
      return 'waiting';
  }
}

function describeUserInputSummary(event: StreamEnvelope, t: RunGraphTranslate): string {
  const text = readSafePayloadText(event);
  switch (event.eventType) {
    case 'USER_INPUT_REQUIRED':
      return text || t('turnRunGraph.summaries.userInputRequired');
    case 'USER_INPUT_RECEIVED':
      return t('turnRunGraph.summaries.userInputReceived');
    case 'USER_INPUT_TIMEOUT':
      return t('turnRunGraph.summaries.userInputTimeout');
    case 'USER_INPUT_CANCELED':
      return t('turnRunGraph.summaries.userInputCanceled');
    default:
      return text || t('turnRunGraph.summaries.userInputRequired');
  }
}

function terminalStatusFromEvent(eventType: StreamEventType): RunGraphStatus {
  switch (eventType) {
    case 'REQUEST_FAILED':
      return 'failed';
    case 'REQUEST_CANCELED':
      return 'canceled';
    case 'REQUEST_SUPERSEDED':
      return 'superseded';
    default:
      return 'success';
  }
}

function terminalStatusFromBlock(status: TurnBlock['status']): RunGraphStatus | null {
  switch (status) {
    case 'COMPLETED':
      return 'success';
    case 'FAILED':
      return 'failed';
    case 'CANCELED':
      return 'canceled';
    case 'SUPERSEDED':
      return 'superseded';
    default:
      return null;
  }
}

function describeTerminalSummary(event: StreamEnvelope, t: RunGraphTranslate): string {
  const text = readSafePayloadText(event);
  switch (event.eventType) {
    case 'REQUEST_FAILED': {
      const failureCode = readFailureErrorCodeFromPayload(event.payload as Record<string, unknown>);
      return failureCode
        ? t('turnRunGraph.summaries.terminalFailedWithCode', { code: failureCode })
        : text || t('turnRunGraph.summaries.terminalFailed');
    }
    case 'REQUEST_CANCELED':
      return text || t('turnRunGraph.summaries.terminalCanceled');
    case 'REQUEST_SUPERSEDED':
      return text || t('turnRunGraph.summaries.terminalSuperseded');
    default:
      return text || t('turnRunGraph.summaries.terminalCompleted');
  }
}

function resolveGraphStatus(block: TurnBlock, nodes: ReadonlyArray<{ readonly status: RunGraphStatus }>): RunGraphStatus {
  const terminalStatus = terminalStatusFromBlock(block.status);
  if (terminalStatus) {
    return terminalStatus;
  }
  if (nodes.some((node) => node.status === 'waiting')) {
    return 'waiting';
  }
  if (nodes.length > 0) {
    return 'running';
  }
  return 'pending';
}

function labelStatus(status: RunGraphStatus, t: RunGraphTranslate): string {
  return t(`turnRunGraph.status.${status}`);
}
