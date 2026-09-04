import type { MessageId, RequestRunId, SessionId } from '@nextagent/agent-common';

export interface MemorySourceTraceRef {
  readonly sessionId: SessionId;
  readonly rootMessageId?: MessageId;
  readonly runId?: RequestRunId;
  readonly messageRefs?: readonly MessageId[];
  readonly extractionCycleId?: string;
}

export interface InteractionMemorySourceTrace {
  readonly sessionId: SessionId;
  readonly requestId?: MessageId;
  readonly runId?: RequestRunId;
  readonly messageRefs?: readonly MessageId[];
  readonly extractionCycleId?: string;
  readonly refs?: readonly MemorySourceTraceRef[];
}

export interface ManualMemorySourceTrace {
  readonly sourceKind: 'MANUAL';
}

export type MemorySourceTrace = InteractionMemorySourceTrace | ManualMemorySourceTrace;

export interface FactualMemoryContent {
  readonly category: 'FACTUAL';
  readonly subject: string;
  readonly claim: string;
  readonly evidence?: readonly string[];
  readonly qualifiers?: readonly string[];
}

export interface ConceptualMemoryContent {
  readonly category: 'CONCEPTUAL';
  readonly concept: string;
  readonly definition: string;
  readonly aliases?: readonly string[];
  readonly relatedConcepts?: readonly string[];
}

export interface ProceduralMemoryContent {
  readonly category: 'PROCEDURAL';
  readonly procedureName: string;
  readonly procedureText: string;
}

export type UserCharacteristicsPurpose = 'PERSONALIZATION' | 'TROUBLESHOOTING' | 'WORKFLOW_ADAPTATION' | 'GENERAL';

export interface UserCharacteristicsMemoryContent {
  readonly category: 'USER_CHARACTERISTICS';
  readonly traits: readonly string[];
  readonly purpose: readonly UserCharacteristicsPurpose[];
}

export type MemoryContentByCategory = FactualMemoryContent | ConceptualMemoryContent | ProceduralMemoryContent | UserCharacteristicsMemoryContent;

export function serializeMemoryContent(content: MemoryContentByCategory): string {
  return JSON.stringify(content);
}

export function parseMemoryContent(content: string): MemoryContentByCategory | undefined {
  try {
    const parsed = JSON.parse(content) as unknown;
    return isMemoryContent(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

export function serializeMemorySource(source: InteractionMemorySourceTrace): string {
  return JSON.stringify(source);
}

export function parseMemorySource(source: string): MemorySourceTrace | undefined {
  if (source === 'MANUAL') {
    return { sourceKind: 'MANUAL' };
  }
  try {
    const parsed = JSON.parse(source) as unknown;
    return isInteractionMemorySourceTrace(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function isMemoryContent(value: unknown): value is MemoryContentByCategory {
  if (!isRecord(value) || typeof value.category !== 'string') {
    return false;
  }
  switch (value.category) {
    case 'FACTUAL':
      return nonEmpty(value.subject) && nonEmpty(value.claim) && optionalStrings(value.evidence) && optionalStrings(value.qualifiers);
    case 'CONCEPTUAL':
      return nonEmpty(value.concept) && nonEmpty(value.definition) && optionalStrings(value.aliases) && optionalStrings(value.relatedConcepts);
    case 'PROCEDURAL':
      return nonEmpty(value.procedureName) && nonEmpty(value.procedureText);
    case 'USER_CHARACTERISTICS':
      return (
        nonEmptyStrings(value.traits) &&
        Array.isArray(value.purpose) &&
        value.purpose.length > 0 &&
        value.purpose.every((purpose) => ['PERSONALIZATION', 'TROUBLESHOOTING', 'WORKFLOW_ADAPTATION', 'GENERAL'].includes(String(purpose)))
      );
    default:
      return false;
  }
}

function isInteractionMemorySourceTrace(value: unknown): value is InteractionMemorySourceTrace {
  if (!isRecord(value) || !nonEmpty(value.sessionId)) {
    return false;
  }
  if (!optionalNonEmpty(value.requestId) || !optionalNonEmpty(value.runId) || !optionalNonEmpty(value.extractionCycleId)) {
    return false;
  }
  if (!optionalStrings(value.messageRefs)) {
    return false;
  }
  return value.refs === undefined || (Array.isArray(value.refs) && value.refs.every(isMemorySourceTraceRef));
}

function isMemorySourceTraceRef(value: unknown): value is MemorySourceTraceRef {
  return (
    isRecord(value) &&
    nonEmpty(value.sessionId) &&
    optionalNonEmpty(value.rootMessageId) &&
    optionalNonEmpty(value.runId) &&
    optionalNonEmpty(value.extractionCycleId) &&
    optionalStrings(value.messageRefs)
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function nonEmpty(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function optionalNonEmpty(value: unknown): boolean {
  return value === undefined || nonEmpty(value);
}

function nonEmptyStrings(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.length > 0 && value.every(nonEmpty);
}

function optionalStrings(value: unknown): boolean {
  return value === undefined || (Array.isArray(value) && value.every(nonEmpty));
}
