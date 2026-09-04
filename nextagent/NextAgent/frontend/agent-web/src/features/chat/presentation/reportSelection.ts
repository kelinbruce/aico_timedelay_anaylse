import type { TurnBlock } from '../../../state/contracts.ts';
import { buildAnswerContent } from './answerContent.ts';

const TERMINAL_RUN_STATUSES = new Set(['COMPLETED', 'CANCELED', 'SUPERSEDED']);

interface ParsedDslContent {
  readonly type?: unknown;
  readonly properties?: { readonly name?: unknown } | null;
}

/**
 * Returns the requestId when the turn block is eligible for BI report
 * selection, otherwise undefined. Eligibility is stricter than share
 * selection: the answer must come from plain LLM text or a structured
 * ANSWER whose toolMessageType is TEXT or DSL (DSL further requires
 * obj.type === "piu" and properties.name === "dte-bi-agent").
 *
 * Single source of truth shared by TurnBlock (per-item checkbox) and
 * ChatPage (select-all set). Returns requestId (not runId) because the
 * bi-report API consumes requestIds.
 */
export function resolveReportableRequestId(block: TurnBlock): string | undefined {
  if (block.rootMessageId.startsWith('bi-report:')) {
    return undefined;
  }
  const requestId = block.aiEvents.find((e) => e.requestId)?.requestId;
  if (!requestId) {
    return undefined;
  }
  if (!TERMINAL_RUN_STATUSES.has(block.status) || block.status === 'FAILED') {
    return undefined;
  }

  const hasPlainTextAnswer = buildAnswerContent(block.aiEvents).trim().length > 0;

  if (hasPlainTextAnswer) {
    return requestId;
  }

  for (const event of block.aiEvents) {
    if (event.eventType !== 'TOOL_STRUCTURED_DELTA') {
      continue;
    }
    const payload = event.payload as Record<string, unknown>;
    if (payload.toolEventType !== 'ANSWER') {
      continue;
    }

    const messageType = payload.toolMessageType;
    if (messageType === 'TEXT') {
      return requestId;
    }
    if (messageType === 'DSL' && isDteBiAgentDsl(payload.content)) {
      return requestId;
    }
  }

  return undefined;
}

function isDteBiAgentDsl(content: unknown): boolean {
  let parsed: ParsedDslContent;
  if (typeof content === 'string') {
    try {
      parsed = JSON.parse(content) as ParsedDslContent;
    } catch {
      return false;
    }
  } else if (typeof content === 'object' && content !== null) {
    parsed = content as ParsedDslContent;
  } else {
    return false;
  }
  return parsed.type === 'piu' && parsed.properties?.name === 'dte-bi-agent';
}
