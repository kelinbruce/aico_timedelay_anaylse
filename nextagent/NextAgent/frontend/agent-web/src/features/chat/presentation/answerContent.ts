import type { StreamEnvelope } from '../../../state/contracts.ts';
import {
  isCompletedProcessContentEvent,
  isCompletedWorkflowStructuredAnswerEvent,
  isWorkflowProcessEvent,
  mergeStreamText,
  readCompletedProcessContentStepId,
  readPendingProcessContentStepId,
  readPayloadBooleanFlag,
  readStreamPayloadText,
  readWorkflowOccurrenceCorrelationId,
  reconcileWorkflowProductFragments,
} from '../utils/streamTextSemantics.ts';
import { buildComposedActivityOrderByEnvelope } from './presentationOrder.ts';
import { redactSensitiveDisplayText } from '../../../utils/redactSensitiveDisplayText.ts';
import { buildInputSegmentByEnvelope } from '../utils/streamingHelpers.ts';

function structuredDetailPayload(payload: unknown): Record<string, unknown> {
  const record = (typeof payload === 'object' && payload !== null ? payload : {}) as Record<string, unknown>;
  const hasFlag = readPayloadBooleanFlag(record, 'accumulated') !== null;
  return hasFlag ? record : { ...record, metadata: { accumulated: false } };
}

export type ToolMessageType = 'PIU' | 'DSL' | 'STREAM_DSL' | 'ACTION' | 'OPERATOR' | 'FILE' | 'TEXT';

function readPiuContentRecord(content: unknown): Record<string, unknown> | null {
  if (typeof content === 'string') {
    try {
      const parsed = JSON.parse(content);
      if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      return null;
    }
    return null;
  }
  if (content !== null && typeof content === 'object' && !Array.isArray(content)) {
    return content as Record<string, unknown>;
  }
  return null;
}

export function readPiuContentUuid(content: unknown): string | null {
  const record = readPiuContentRecord(content);
  const uuid = record?.uuid;
  return typeof uuid === 'string' && uuid.length > 0 ? uuid : null;
}

function isPersistedPiuContent(content: unknown): boolean {
  return Array.isArray(readPiuContentRecord(content)?.data);
}

export interface AnswerTextSegment {
  readonly kind: 'text';
  readonly content: string;
  readonly sequence: number;
}

export interface AnswerStructuredSegment {
  readonly kind: 'structured';
  readonly toolMessageType: ToolMessageType;
  readonly content: unknown;
  readonly sequence: number;
  readonly isHistory?: boolean;
}

export type AnswerSegment = AnswerTextSegment | AnswerStructuredSegment;

export interface PersistedPreviewAnswer {
  readonly originalSize: number;
  readonly preview: string;
}

const persistedPreviewPattern = new RegExp(
  [
    String.raw`^<persisted-content>\nReason: [^\r\n]+\n`,
    String.raw`Full content ref: CAPABILITY_RESULT:(?<refId>tool-results\/[a-f0-9]+\.txt)\n`,
    String.raw`Original size: (?<originalSize>[0-9]+) chars\nPreview:\n(?<preview>[\s\S]*)\n`,
    String.raw`File path: \k<refId>\n`,
    String.raw`Access: Invoke the Read tool with file_path="\k<refId>"\. `,
    String.raw`If the file is too large, page it with explicit offset and limit\.\n<\/persisted-content>$`,
  ].join(''),
  'u',
);

function readPersistedPreviewBlock(content: string): string {
  if (content.startsWith('<persisted-content>')) {
    return content;
  }
  try {
    const parsed = JSON.parse(content) as unknown;
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return content;
    }
    const payload = (parsed as Record<string, unknown>).payload;
    if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) {
      return content;
    }
    const preview = (payload as Record<string, unknown>).preview;
    return typeof preview === 'string' ? preview : content;
  } catch {
    return content;
  }
}

export function readPersistedPreviewAnswer(content: string): PersistedPreviewAnswer | null {
  const match = persistedPreviewPattern.exec(readPersistedPreviewBlock(content));
  if (match === null) {
    return null;
  }
  const originalSize = Number(match.groups?.originalSize);
  const preview = match.groups?.preview;
  if (!Number.isSafeInteger(originalSize) || originalSize < 0 || preview === undefined) {
    return null;
  }
  return { originalSize, preview };
}

function isToolStructuredAnswerEvent(event: StreamEnvelope): boolean {
  if (event.eventType !== 'TOOL_STRUCTURED_DELTA') {
    return false;
  }
  const payload = event.payload as Record<string, unknown>;
  return payload.toolEventType === 'ANSWER';
}

export const validToolMessageTypes: readonly ToolMessageType[] = ['PIU', 'DSL', 'STREAM_DSL', 'ACTION', 'OPERATOR', 'FILE', 'TEXT'];

/**
 * If the round was guard-blocked (output or input), return the guard service's
 * refusal message verbatim; otherwise null. Used to clear streamed content and
 * show the refusal in place of the (retracted) assistant answer.
 *
 * The guard layer's `OUTPUT_GUARD_BLOCKED` is a client-stream terminal signal
 * that does NOT replace the runtime terminal (see openspec
 * `refine-stream-guard-blocked-event` 决策 2): the run keeps running on the
 * runtime side and a `REQUEST_COMPLETED`/`REQUEST_CANCELED` may arrive AFTER
 * the block. So we must detect the block anywhere in the attempt's events, not
 * only as the last event — otherwise the trailing runtime terminal would mask
 * the block and the streamed content would render as the answer.
 */
function resolveGuardBlockedRefusal(aiEvents: readonly StreamEnvelope[]): { readonly content: string; readonly sequence: number } | null {
  let blockedEvent: StreamEnvelope | undefined;
  for (let index = aiEvents.length - 1; index >= 0; index -= 1) {
    const event = aiEvents[index];
    if (event?.eventType === 'OUTPUT_GUARD_BLOCKED') {
      blockedEvent = event;
      break;
    }
  }
  if (blockedEvent === undefined) {
    return null;
  }
  const payload = blockedEvent.payload as Record<string, unknown>;
  const refusalMessage = typeof payload.refusalMessage === 'string' ? payload.refusalMessage : '';
  return refusalMessage.length > 0 ? { content: refusalMessage, sequence: blockedEvent.sequence } : null;
}

export function buildAnswerSegments(aiEvents: readonly StreamEnvelope[]): AnswerSegment[] {
  const guardRefusal = resolveGuardBlockedRefusal(aiEvents);
  if (guardRefusal !== null) {
    return [{ kind: 'text' as const, content: redactSensitiveDisplayText(guardRefusal.content), sequence: guardRefusal.sequence }];
  }

  const displayEvents = reconcileWorkflowProductFragments(aiEvents);

  const segments: AnswerSegment[] = [];
  const workflowTerminalAnswer = hasWorkflowTerminalIdentity(displayEvents) ? readTerminalAnswerFact(displayEvents) : null;
  let textBuffer = '';
  let lastTextSequence = 0;
  let lastStructuredTextOccurrenceId: string | null = null;

  const flushText = () => {
    if (textBuffer.trim().length > 0) {
      segments.push({ kind: 'text', content: redactSensitiveDisplayText(textBuffer), sequence: lastTextSequence });
    }
    textBuffer = '';
  };

  let streamDslAccumulator: { dataModel: unknown; dsl: string; isDone: boolean; sequence: number } | null = null;

  const flushStreamDsl = () => {
    if (streamDslAccumulator !== null) {
      segments.push({
        kind: 'structured',
        toolMessageType: 'STREAM_DSL',
        content: Object.freeze({
          dataModel: streamDslAccumulator.dataModel,
          dsl: streamDslAccumulator.dsl,
          isDone: streamDslAccumulator.isDone,
        }),
        sequence: streamDslAccumulator.sequence,
      });
      streamDslAccumulator = null;
    }
  };

  const structuredTextAnswers = new Set(
    displayEvents
      .filter(isToolStructuredAnswerEvent)
      .filter((event) => (event.payload as Record<string, unknown>).toolMessageType === 'TEXT')
      .map((event) => (event.payload as Record<string, unknown>).content)
      .filter((content): content is string => typeof content === 'string'),
  );
  const completedWorkflowStructuredTextAnswers = new Set(
    displayEvents
      .filter(isCompletedWorkflowStructuredAnswerEvent)
      .filter((event) => (event.payload as Record<string, unknown>).toolMessageType === 'TEXT')
      .map((event) => (event.payload as Record<string, unknown>).content)
      .filter((content): content is string => typeof content === 'string'),
  );
  const answerEvents = [...displayEvents].filter((event) => {
    if (isToolStructuredAnswerEvent(event)) {
      return true;
    }
    if (!isAssistantAnswerEvent(event)) {
      return false;
    }
    if (workflowTerminalAnswer !== null) {
      return false;
    }
    const payload = event.payload as Record<string, unknown>;
    const content = readStreamPayloadText(payload, undefined, { allowWhitespaceOnly: true });
    return !structuredTextAnswers.has(content);
  });

  for (const event of answerEvents) {
    if (event.eventType === 'LLM_CONTENT_DELTA') {
      flushStreamDsl();
      const payload = event.payload as Record<string, unknown>;
      const raw = readStreamPayloadText(payload, undefined, { allowWhitespaceOnly: true });
      textBuffer = mergeStreamText(textBuffer, raw, payload);
      lastTextSequence = event.sequence;
    } else if (event.eventType === 'TOOL_STRUCTURED_DELTA') {
      const payload = event.payload as Record<string, unknown>;
      const messageType = payload.toolMessageType;
      const toolMessageType =
        typeof messageType === 'string' && (validToolMessageTypes as readonly string[]).includes(messageType)
          ? (messageType as ToolMessageType)
          : 'TEXT';
      if (toolMessageType === 'STREAM_DSL') {
        lastStructuredTextOccurrenceId = null;
        const fragment = payload.content;
        const fragmentRecord = typeof fragment === 'object' && fragment !== null ? (fragment as Record<string, unknown>) : null;
        const fragmentType = typeof fragmentRecord?.type === 'string' ? fragmentRecord.type : undefined;
        if (fragmentType === 'dataModel') {
          flushText();
          flushStreamDsl();
          streamDslAccumulator = {
            dataModel: fragmentRecord!.content,
            dsl: '',
            isDone: false,
            sequence: event.sequence,
          };
        } else if (fragmentType === 'dsl') {
          if (streamDslAccumulator !== null) {
            const dslContent = fragmentRecord!.content;
            streamDslAccumulator = {
              dataModel: streamDslAccumulator.dataModel,
              dsl: streamDslAccumulator.dsl + (typeof dslContent === 'string' ? dslContent : String(dslContent ?? '')),
              isDone: streamDslAccumulator.isDone,
              sequence: event.sequence,
            };
          }
        } else if (fragmentType === 'done') {
          if (streamDslAccumulator !== null) {
            streamDslAccumulator = {
              dataModel: streamDslAccumulator.dataModel,
              dsl: streamDslAccumulator.dsl,
              isDone: true,
              sequence: event.sequence,
            };
            flushStreamDsl();
          }
        }
      } else {
        flushText();
        flushStreamDsl();
        const lastSegment = segments[segments.length - 1];
        const workflowOccurrenceId = readWorkflowOccurrenceCorrelationId(event);
        if (
          toolMessageType === 'TEXT' &&
          lastSegment?.kind === 'structured' &&
          lastSegment.toolMessageType === 'TEXT' &&
          typeof lastSegment.content === 'string' &&
          workflowOccurrenceId === lastStructuredTextOccurrenceId
        ) {
          segments[segments.length - 1] = {
            ...lastSegment,
            isHistory: false,
            content:
              typeof payload.content === 'string'
                ? mergeStreamText(lastSegment.content, payload.content, structuredDetailPayload(payload))
                : lastSegment.content + String(payload.content ?? ''),
            sequence: event.sequence,
          };
        } else {
          segments.push({
            kind: 'structured',
            toolMessageType,
            content: payload.content,
            sequence: event.sequence,
            isHistory: toolMessageType === 'PIU' && isPersistedPiuContent(payload.content),
          });
        }
        lastStructuredTextOccurrenceId = toolMessageType === 'TEXT' ? workflowOccurrenceId : null;
      }
    }
  }

  flushStreamDsl();
  flushText();

  const hasVisibleCompletedWorkflowTextAnswer =
    workflowTerminalAnswer !== null &&
    completedWorkflowStructuredTextAnswers.has(workflowTerminalAnswer.content) &&
    segments.some(
      (segment) =>
        segment.kind === 'structured' &&
        segment.toolMessageType === 'TEXT' &&
        typeof segment.content === 'string' &&
        segment.content === workflowTerminalAnswer.content,
    );
  if (workflowTerminalAnswer !== null && !hasVisibleCompletedWorkflowTextAnswer) {
    segments.push({
      kind: 'text',
      content: redactSensitiveDisplayText(workflowTerminalAnswer.content),
      sequence: workflowTerminalAnswer.sequence,
    });
  }

  if (segments.length === 0) {
    const fallback = buildAnswerContent(displayEvents);
    if (fallback.length > 0) {
      segments.push({ kind: 'text', content: fallback, sequence: 0 });
    }
  }

  for (const [index, segment] of segments.entries()) {
    if (segment.kind === 'structured' && segment.toolMessageType === 'TEXT' && typeof segment.content === 'string') {
      segments[index] = { ...segment, content: redactSensitiveDisplayText(segment.content) };
    }
  }

  return segments;
}

const TERMINAL_ANSWER_FALLBACK_EVENTS = new Set<StreamEnvelope['eventType']>([
  'REQUEST_COMPLETED',
  'REQUEST_FAILED',
  'REQUEST_SUPERSEDED',
  'OUTPUT_GUARD_BLOCKED',
]);

const FAILED_TERMINAL_PLACEHOLDER =
  /^(?:Request failed(?: safely(?: during local runtime recovery)?(?:\s*:\s*[A-Z0-9_]+)?|:\s*.+)?|Request canceled(?: by user)?)\.?$/u;

function stripMarkdownLineBreak(line: string): string {
  return line.replace(/\r?\n$/, '');
}

function isCompleteMarkdownLine(line: string): boolean {
  return line.endsWith('\n');
}

function splitMarkdownTableCells(line: string): readonly string[] | null {
  const trimmed = line.trim();
  if (!trimmed.includes('|')) {
    return null;
  }

  const cells: string[] = [];
  let currentCell = '';
  let isEscaped = false;
  let isInsideInlineCode = false;

  for (const char of trimmed) {
    if (isEscaped) {
      currentCell += char;
      isEscaped = false;
      continue;
    }
    if (char === '\\') {
      currentCell += char;
      isEscaped = true;
      continue;
    }
    if (char === '`') {
      currentCell += char;
      isInsideInlineCode = !isInsideInlineCode;
      continue;
    }
    if (char === '|' && !isInsideInlineCode) {
      cells.push(currentCell.trim());
      currentCell = '';
      continue;
    }
    currentCell += char;
  }
  cells.push(currentCell.trim());

  if (trimmed.startsWith('|')) {
    cells.shift();
  }
  if (trimmed.endsWith('|')) {
    cells.pop();
  }
  return cells.length >= 2 ? cells : null;
}

function isMarkdownTableRow(line: string): boolean {
  const cells = splitMarkdownTableCells(line);
  return cells !== null && cells.some((cell) => cell.length > 0);
}

function isMarkdownTableDelimiter(line: string): boolean {
  const cells = splitMarkdownTableCells(line);
  return cells !== null && cells.every((cell) => /^:?-{3,}:?$/.test(cell.trim()));
}

export function splitProgressiveMarkdownContent(
  content: string,
  shouldKeepTailPlain: boolean,
): {
  readonly markdownPrefix: string;
  readonly liveTail: string;
} {
  if (!shouldKeepTailPlain || content.length === 0) {
    return { markdownPrefix: content, liveTail: '' };
  }

  const lines = content.match(/[^\n]*(?:\n|$)/g) ?? [content];
  let offset = 0;
  let lastStableBoundary = 0;
  let fenceMarker: '```' | '~~~' | null = null;
  let previousCompleteLine: string | null = null;
  let isInsideTable = false;

  for (const line of lines) {
    if (line.length === 0) {
      continue;
    }
    const lineText = stripMarkdownLineBreak(line);
    const isCompleteLine = isCompleteMarkdownLine(line);
    const trimmedStart = line.trimStart();
    let justClosedFence = false;
    if (trimmedStart.startsWith('```') || trimmedStart.startsWith('~~~')) {
      const marker = trimmedStart.startsWith('```') ? '```' : '~~~';
      if (fenceMarker === marker) {
        fenceMarker = null;
        justClosedFence = true;
      } else if (fenceMarker === null) {
        fenceMarker = marker;
      }
    }

    offset += line.length;
    if (fenceMarker === null && (line.trim().length === 0 || justClosedFence)) {
      lastStableBoundary = offset;
      isInsideTable = false;
    } else if (fenceMarker === null && isCompleteLine) {
      if (isInsideTable) {
        if (isMarkdownTableRow(lineText)) {
          lastStableBoundary = offset;
        } else {
          isInsideTable = false;
        }
      } else if (previousCompleteLine !== null && isMarkdownTableRow(previousCompleteLine) && isMarkdownTableDelimiter(lineText)) {
        isInsideTable = true;
        lastStableBoundary = offset;
      }
    }

    if (isCompleteLine) {
      previousCompleteLine = fenceMarker === null && !justClosedFence ? lineText : null;
    }
  }

  if (lastStableBoundary <= 0) {
    return { markdownPrefix: '', liveTail: content };
  }
  if (lastStableBoundary >= content.length) {
    return { markdownPrefix: content, liveTail: '' };
  }

  return {
    markdownPrefix: content.slice(0, lastStableBoundary),
    liveTail: content.slice(lastStableBoundary),
  };
}

function sortAnswerEvents(aiEvents: readonly StreamEnvelope[]): StreamEnvelope[] {
  return [...aiEvents];
}

export function isAssistantAnswerEvent(event: StreamEnvelope): boolean {
  if (event.eventType !== 'LLM_CONTENT_DELTA') {
    return false;
  }
  const payload = event.payload as Record<string, unknown>;
  return payload.role !== 'CAPABILITY_RESULT' && !isCompletedProcessContentEvent(event) && readPendingProcessContentStepId(event) === null;
}

export function buildAnswerContent(aiEvents: readonly StreamEnvelope[]): string {
  const guardRefusal = resolveGuardBlockedRefusal(aiEvents);
  if (guardRefusal !== null) {
    return redactSensitiveDisplayText(guardRefusal.content);
  }

  const answerEvents = sortAnswerEvents(aiEvents.filter(isAssistantAnswerEvent));
  let content = '';

  for (const event of answerEvents) {
    const payload = event.payload as Record<string, unknown>;
    const raw = readStreamPayloadText(payload, undefined, { allowWhitespaceOnly: true });
    if (raw.length === 0) {
      continue;
    }
    content = mergeStreamText(content, raw, payload);
  }

  const workflowTerminalAnswer = hasWorkflowTerminalIdentity(aiEvents) ? readTerminalAnswerFact(aiEvents) : null;
  const result = workflowTerminalAnswer?.content ?? (content.length > 0 ? content : readTerminalAnswerFallback(aiEvents));
  return redactSensitiveDisplayText(result);
}

export function isFinalAnswerHandoffFromPendingProcessContent(aiEvents: readonly StreamEnvelope[], answerContent: string): boolean {
  if (answerContent.length === 0) {
    return false;
  }

  const inputSegmentByEnvelope = buildInputSegmentByEnvelope(aiEvents);
  const readOccurrenceKey = (event: StreamEnvelope, stepId: string): string => `${stepId}\u0000${inputSegmentByEnvelope.get(event) ?? 0}`;
  const completedOccurrences = new Set<string>();
  for (const event of aiEvents) {
    const stepId = readCompletedProcessContentStepId(event);
    if (stepId !== null) {
      completedOccurrences.add(readOccurrenceKey(event, stepId));
    }
  }
  const contentByOccurrence = new Map<string, string>();
  let latestPendingOccurrence: string | null = null;

  for (const event of aiEvents) {
    const stepId = readPendingProcessContentStepId(event);
    if (stepId === null) {
      continue;
    }
    const occurrenceKey = readOccurrenceKey(event, stepId);
    if (completedOccurrences.has(occurrenceKey)) {
      continue;
    }
    const payload = event.payload as Record<string, unknown>;
    const raw = readStreamPayloadText(payload, undefined, { allowWhitespaceOnly: true });
    if (raw.length === 0) {
      continue;
    }
    contentByOccurrence.set(occurrenceKey, mergeStreamText(contentByOccurrence.get(occurrenceKey) ?? '', raw, payload));
    latestPendingOccurrence = occurrenceKey;
  }

  if (latestPendingOccurrence === null) {
    return false;
  }
  const pendingContent = redactSensitiveDisplayText(contentByOccurrence.get(latestPendingOccurrence) ?? '');
  return pendingContent.length > 0 && answerContent.startsWith(pendingContent);
}

function readTerminalAnswerFallback(aiEvents: readonly StreamEnvelope[]): string {
  return readTerminalAnswerFact(aiEvents)?.content ?? '';
}

function hasWorkflowTerminalIdentity(aiEvents: readonly StreamEnvelope[]): boolean {
  return aiEvents.some(isWorkflowProcessEvent);
}

function readTerminalAnswerFact(aiEvents: readonly StreamEnvelope[]): { readonly content: string; readonly sequence: number } | null {
  for (let index = aiEvents.length - 1; index >= 0; index -= 1) {
    const event = aiEvents[index];
    if (event === undefined || !TERMINAL_ANSWER_FALLBACK_EVENTS.has(event.eventType)) {
      continue;
    }
    const raw = readStreamPayloadText(event.payload as Record<string, unknown>, ['content', 'text'], { allowWhitespaceOnly: true });
    // Defensive: skip cancel-category REQUEST_FAILED and known placeholder
    // text so neither leaks into the answer body. See D2 for the same check.
    if (
      event.eventType === 'REQUEST_FAILED' &&
      ((event.payload as { category?: string })?.category === 'CANCELED' || FAILED_TERMINAL_PLACEHOLDER.test(raw.trim()))
    ) {
      continue;
    }
    if (raw.length > 0) {
      return { content: raw, sequence: event.sequence };
    }
  }
  return null;
}

export function readLatestAssistantAnswerSequence(aiEvents: readonly StreamEnvelope[]): number | null {
  let latestSequence: number | null = null;

  for (const event of aiEvents) {
    if (!isAssistantAnswerEvent(event)) {
      continue;
    }
    const payload = event.payload as Record<string, unknown>;
    if (readStreamPayloadText(payload, undefined, { allowWhitespaceOnly: true }).trim().length === 0) {
      continue;
    }
    latestSequence = latestSequence === null ? event.sequence : Math.max(latestSequence, event.sequence);
  }

  return latestSequence;
}

export function readLatestAssistantAnswerPresentationOrder(aiEvents: readonly StreamEnvelope[]): number | null {
  let latestOrder: number | null = null;
  const activityOrderByEnvelope = buildComposedActivityOrderByEnvelope(aiEvents);

  aiEvents.forEach((event) => {
    if (!isAssistantAnswerEvent(event)) {
      return;
    }
    const payload = event.payload as Record<string, unknown>;
    if (readStreamPayloadText(payload, undefined, { allowWhitespaceOnly: true }).trim().length === 0) {
      return;
    }
    latestOrder = Math.max(latestOrder ?? -1, activityOrderByEnvelope.get(event) ?? -1);
  });

  return latestOrder;
}

export function readLatestLiveStreamActivitySignature(aiEvents: readonly StreamEnvelope[]): string {
  let latestEvent: StreamEnvelope | null = null;

  for (const event of aiEvents) {
    if (event.transportHints.includes('history-load')) {
      continue;
    }
    if (!latestEvent || event.sequence >= latestEvent.sequence) {
      latestEvent = event;
    }
  }

  return latestEvent ? `${latestEvent.sequence}:${latestEvent.eventId}:${latestEvent.eventType}` : 'no-live-stream-event';
}
