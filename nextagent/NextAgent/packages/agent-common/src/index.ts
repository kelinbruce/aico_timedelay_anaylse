import { isAbsolute, relative } from 'node:path';
import { createHash } from 'node:crypto';
export * from './logging/logger.js';
export * from './objects.js';
export * from './urls.js';
export * from './guardrail-refusal-messages.js';

export type Brand<T, Name extends string> = T & { readonly __brand: Name };

export type TenantId = Brand<string, 'TenantId'>;
export type SubjectId = Brand<string, 'SubjectId'>;
export type SessionId = Brand<string, 'SessionId'>;
export type MessageId = Brand<string, 'MessageId'>;
export type RequestRunId = Brand<string, 'RequestRunId'>;
export type CapabilityId = Brand<string, 'CapabilityId'>;
export type CapabilityInvocationId = Brand<string, 'CapabilityInvocationId'>;
export type ToolCallId = Brand<string, 'ToolCallId'>;
export type ArtifactId = Brand<string, 'ArtifactId'>;
export type AttachmentId = Brand<string, 'AttachmentId'>;
export type AttachmentIntakeReservationId = Brand<string, 'AttachmentIntakeReservationId'>;
export type BlobRef = Brand<string, 'BlobRef'>;
export type CheckpointId = Brand<string, 'CheckpointId'>;
export type LongTermMemoryId = Brand<string, 'LongTermMemoryId'>;
export type TaskTrajectoryId = Brand<string, 'TaskTrajectoryId'>;
export type PendingInputId = Brand<string, 'PendingInputId'>;
export type AgentId = Brand<string, 'AgentId'>;
export type AgentType = Brand<string, 'AgentType'>;
export type AgentVersion = Brand<string, 'AgentVersion'>;
export type RequestContextId = Brand<string, 'RequestContextId'>;
export type IdempotencyKey = Brand<string, 'IdempotencyKey'>;
export type TaskEventId = Brand<string, 'TaskEventId'>;
export type EpochMillis = Brand<number, 'EpochMillis'>;
export type TimelineSequence = Brand<number, 'TimelineSequence'>;
export type RequestLocale = Brand<string, 'RequestLocale'>;
export type SecretReference = Brand<`env:${string}` | `file:${string}`, 'SecretReference'>;

export type JsonValue = string | number | boolean | null | JsonObject | readonly JsonValue[];
export interface JsonObject {
  readonly [key: string]: JsonValue;
}

const RUNTIME_EXCEPTION_TEXT_LIMIT = 2_048;

export interface IdentityContext {
  readonly tenantId: TenantId;
  readonly subjectId: SubjectId;
  readonly displayName: string;
}

export type RequestLanguage = 'ZH' | 'EN' | 'MIXED';
export type RequestPriority = 'HIGH' | 'NORMAL' | 'LOW';
export type LifecycleStage =
  | 'BEFORE_REQUEST_ACCEPT'
  | 'BEFORE_PLANNING'
  | 'BEFORE_MODEL_INVOKE'
  | 'AFTER_MODEL_RESULT'
  | 'BEFORE_CAPABILITY_INVOKE'
  | 'AFTER_CAPABILITY_RESULT'
  | 'BEFORE_CONTEXT_COMPACT'
  | 'AFTER_CONTEXT_COMPACT'
  | 'BEFORE_AGENT_TERMINAL';
export type MemoryCategory = 'FACTUAL' | 'CONCEPTUAL' | 'PROCEDURAL' | 'USER_CHARACTERISTICS';
export type MemoryType = MemoryCategory;
export type KnowledgeSourceType = 'LEARNED' | 'CONFIGURED' | 'SYSTEM_DEFAULT';
export type SharingState = 'PRIVATE' | 'SHARED' | 'FORK';
export type LongTermMemoryState = 'ACTIVE' | 'ARCHIVED';
export type TaskTrajectoryKind = 'TROUBLESHOOTING' | 'CONFIG_CHANGE' | 'PLANNING' | 'EXPLANATION' | 'GENERAL_TASK';
export type TaskTrajectoryBuildStatus = 'COMPLETED' | 'FAILED' | 'SKIPPED';
export type TaskOutcomeStatus = 'SUCCEEDED' | 'FAILED' | 'PARTIAL' | 'UNKNOWN' | 'CANCELLED';
export type OutcomeEvidenceLevel = 'NONE' | 'MODEL_CLAIM' | 'TOOL_STATUS' | 'VERIFICATION' | 'USER_CONFIRMATION';

export function truncateUtf8(value: string, maxBytes: number): string {
  const limit = Math.max(0, Math.trunc(maxBytes));
  const bytes = new TextEncoder().encode(value);
  if (bytes.length <= limit) {
    return value;
  }
  let end = limit;
  while (end > 0 && (bytes[end]! & 0xc0) === 0x80) {
    end--;
  }
  return new TextDecoder().decode(bytes.slice(0, end));
}

export type SessionMessageRole = 'USER' | 'ASSISTANT' | 'CAPABILITY_RESULT' | 'SUMMARY';
export type MessageContentType = 'PLAIN_TEXT' | 'MARKDOWN' | 'MERMAID';
export type VisibilityReason = 'RETRY_REPLACED' | 'EDIT_REPLACED' | 'CAPABILITY_GENERATED' | 'GUARD_BLOCKED' | 'SKILL_BODY';

export type AttachmentMediaType = 'WORD' | 'EXCEL' | 'PDF' | 'MARKDOWN' | 'PCAP' | 'PCAPNG' | 'CAP' | 'TMF' | 'PTMF' | 'ZIP' | 'TAR' | 'RAR' | 'GZ';
export type AttachmentValidationStatus = 'PENDING' | 'ACCEPTED' | 'REJECTED';
export type AttachmentAvailabilityStatus = 'STAGED' | 'AVAILABLE' | 'UNAVAILABLE';

export type PendingInputKind = 'QUESTION' | 'CONFIRMATION' | 'AUTHORIZATION' | 'HUMAN_HANDOFF';
export type PendingInputStatus = 'PENDING' | 'RECEIVED' | 'TIMED_OUT' | 'CANCELED';
export type PendingInputQuestionAnswerKind =
  'TEXT' | 'OPTION_SELECTION' | 'OPTION_ATTACHED_TEXT' | 'CUSTOM_TEXT' | 'OPTION_SELECTIONS_WITH_CUSTOM_TEXT';
export type RiskPolicyOutcome = 'ALLOW' | 'DENY' | 'REQUIRE_AUTHORIZATION' | 'DEGRADED' | 'POLICY_FAILED';
export type RiskLevel = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
export type RestrictedOperationKind = 'CAPABILITY_INVOCATION' | 'SANDBOX_EXECUTION' | 'AUTHORIZATION_REQUEST' | 'RECOVERY_REPLAY';

export type RunStatus = 'ACCEPTED' | 'QUEUED' | 'PLANNING' | 'EXECUTING' | 'COMPLETED' | 'FAILED' | 'CANCELED' | 'SUPERSEDED';

export type TerminalCommitState = 'NOT_STARTED' | 'PENDING' | 'RETRYING' | 'COMMITTED' | 'FAILED';

export type TimelineEventType =
  | 'REQUEST_ACCEPTED'
  | 'PLANNING_STARTED'
  | 'MODEL_INVOCATION_STARTED'
  | 'MODEL_INVOCATION_COMPLETED'
  | 'MODEL_INVOCATION_FAILED'
  | 'LLM_THINKING_DELTA'
  | 'LLM_CONTENT_DELTA'
  | 'CAPABILITY_RESULT_DELTA'
  | 'CAPABILITY_STARTED'
  | 'CAPABILITY_COMPLETED'
  | 'TOOL_STRUCTURED_DELTA'
  | 'DEGRADATION_NOTICE'
  | 'REQUEST_COMPLETED'
  | 'REQUEST_FAILED'
  | 'REQUEST_CANCELED'
  | 'REQUEST_SUPERSEDED'
  | 'ATTACHMENT_ACCEPTED'
  | 'ATTACHMENT_REJECTED'
  | 'CONTEXT_COMPACTED'
  | 'POLICY_APPLIED'
  | 'HOOK_INVOKED'
  | 'USER_INPUT_REQUIRED'
  | 'USER_INPUT_RECEIVED'
  | 'USER_INPUT_TIMEOUT'
  | 'USER_INPUT_CANCELED'
  | 'BACKGROUND_TASK_STARTED'
  | 'BACKGROUND_TASK_COMPLETED'
  | 'BACKGROUND_TASK_FAILED';

export const CLIP_STREAM_RESULT_PROJECTION_KIND = 'CLIP_STREAM_V1' as const;

export type ToolEventType = 'TITLE' | 'DETAIL' | 'ANSWER' | 'SUB_TITLE' | 'SUB_DETAIL' | 'SUB_CONCLUSION' | 'EXPAND_PANEL' | 'FINAL_ANSWER';

export type ToolMessageType = 'PIU' | 'DSL' | 'STREAM_DSL' | 'ACTION' | 'OPERATOR' | 'FILE' | 'TEXT';

export const TOOL_EVENT_TYPES: readonly ToolEventType[] = [
  'TITLE',
  'DETAIL',
  'ANSWER',
  'SUB_TITLE',
  'SUB_DETAIL',
  'SUB_CONCLUSION',
  'EXPAND_PANEL',
  'FINAL_ANSWER',
] as const;
export const TOOL_MESSAGE_TYPES: readonly ToolMessageType[] = ['PIU', 'DSL', 'STREAM_DSL', 'ACTION', 'OPERATOR', 'FILE', 'TEXT'] as const;

export type CheckpointTriggerReason =
  | 'RUN_ACCEPTED'
  | 'STEP_STARTED'
  | 'CAPABILITY_BEFORE_CALL'
  | 'CAPABILITY_AFTER_RETURN'
  | 'CONTEXT_COMPACTED'
  | 'TERMINAL_COMMIT_PENDING'
  | 'TERMINAL_COMMITTED'
  | 'TERMINAL_PENDING_COMMIT_TAKEOVER';

export type CapabilityKind = 'TOOL' | 'SKILL' | 'AGENT' | 'WORKFLOW';
export const workflowNodeTypes = [
  'START',
  'END',
  'LLM',
  'LLM_ROUTER',
  'INTENT_RECOGNITION',
  'QUESTION_REWRITING',
  'TRANSLATION',
  'DATA_ANALYSIS',
  'PARAM_EXTRACT',
  'TOOL',
  'TOOL_CHOICE',
  'RESTFUL',
  'PYTHON',
  'AGENT',
  'SKILL',
  'DISPLAY',
  'GUARDRAIL',
  'KNOWLEDGE_SEARCH',
  'KNOWLEDGE_QA',
  'API_CHOICE',
  'RECIPE_CHOICE',
  'USER_CHECK',
  'INTERRUPT',
  'ROUTER',
  'CONDITION',
  'SUBFLOW',
  'PARALLEL',
  'DELAY',
] as const;
export type WorkflowNodeType = (typeof workflowNodeTypes)[number];
export type CapabilityProviderKind = 'BUNDLED' | 'LOCAL_DIRECTORY' | 'SKILL_HUB' | 'MCP_SERVER' | 'AGENT_REGISTRY' | 'CUSTOM';
export type CapabilityReplayPolicy = 'NON_IDEMPOTENT' | 'IDEMPOTENT';
export type CapabilityInvocationStatus = 'PENDING' | 'SUCCEEDED' | 'FAILED' | 'DEGRADED' | 'TIMED_OUT';

export type AgentErrorCategory =
  'VALIDATION' | 'AUTHORIZATION' | 'POLICY_DENIED' | 'NOT_FOUND' | 'CONFLICT' | 'UNAVAILABLE' | 'TIMEOUT' | 'CANCELED' | 'INTERNAL';

export interface AgentErrorOptions {
  readonly code: string;
  readonly message: string;
  readonly category: AgentErrorCategory;
  readonly retryable?: boolean;
  readonly safeDetails?: JsonObject;
  readonly cause?: unknown;
}

export class AgentError extends Error {
  readonly code: string;
  readonly category: AgentErrorCategory;
  readonly retryable: boolean;
  readonly safeDetails?: JsonObject;

  constructor(options: AgentErrorOptions) {
    super(options.message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'AgentError';
    this.code = options.code;
    this.category = options.category;
    this.retryable = options.retryable ?? false;
    if (options.safeDetails !== undefined) {
      this.safeDetails = options.safeDetails;
    }
  }
}

export function cronTaskLimitReachedError(cause?: unknown): AgentError {
  return new AgentError({
    code: CRON_TASK_LIMIT_REACHED_CODE,
    message: 'Cron task limit reached. Delete an existing active task or wait for a one-shot task to complete.',
    category: 'CONFLICT',
    retryable: false,
    ...(cause === undefined ? {} : { cause }),
  });
}

export function runtimeRawExceptionData(error: unknown): JsonObject | undefined {
  const seen = new WeakSet<object>();
  if (error instanceof AgentError) {
    seen.add(error);
    const cause = runtimeRawExceptionDataInternal(error.cause, seen);
    const stack = safeErrorProperty(error, 'stack');
    return {
      name: 'AgentError',
      code: error.code,
      category: error.category,
      retryable: error.retryable,
      message: sanitizeRuntimeExceptionString('message', error.message),
      ...(typeof stack === 'string' ? { stack: sanitizeRuntimeExceptionString('stack', stack) } : {}),
      ...(error.safeDetails === undefined ? {} : { safeDetails: sanitizeRuntimeExceptionValue('safeDetails', error.safeDetails, seen) }),
      ...(cause === undefined ? {} : { cause }),
    };
  }
  return runtimeRawExceptionDataInternal(error, seen);
}

function runtimeRawExceptionDataInternal(error: unknown, seen: WeakSet<object>): JsonObject | undefined {
  if (error instanceof Error) {
    if (seen.has(error)) {
      return { value: '[Circular]' };
    }
    seen.add(error);
    const name = safeErrorProperty(error, 'name');
    const message = safeErrorProperty(error, 'message');
    const stack = safeErrorProperty(error, 'stack');
    const cause = runtimeRawExceptionDataInternal(safeErrorProperty(error, 'cause'), seen);
    const ownFields = sanitizeRuntimeExceptionOwnFields(error, seen);
    return {
      name: typeof name === 'string' && name.length > 0 ? name : 'Error',
      ...(typeof message === 'string' ? { message: sanitizeRuntimeExceptionString('message', message) } : {}),
      ...(typeof stack === 'string' ? { stack: sanitizeRuntimeExceptionString('stack', stack) } : {}),
      ...(cause === undefined ? {} : { cause }),
      ...ownFields,
    };
  }
  if (typeof error === 'string') {
    return { value: sanitizeRuntimeExceptionString('value', error) };
  }
  if (error === undefined) {
    return undefined;
  }
  if (error === null || typeof error === 'number' || typeof error === 'boolean') {
    return { value: error };
  }
  if (typeof error === 'object' && canSerializeRuntimeJson(error)) {
    return { value: sanitizeRuntimeExceptionValue('value', error as JsonObject, seen) };
  }
  return { value: sanitizeRuntimeExceptionString('value', String(error)) };
}

function sanitizeRuntimeExceptionOwnFields(error: Error, seen: WeakSet<object>): JsonObject {
  const output: Record<string, JsonValue> = {};
  for (const key of Object.keys(error)) {
    const value = safeErrorProperty(error, key);
    if (key === 'name' || key === 'message' || key === 'stack' || key === 'cause' || !isJsonValue(value)) {
      continue;
    }
    output[key] = sanitizeRuntimeExceptionValue(key, value, seen);
  }
  return output;
}

function safeErrorProperty(error: Error, key: string): unknown {
  try {
    return (error as unknown as Readonly<Record<string, unknown>>)[key];
  } catch {
    return undefined;
  }
}

function isJsonValue(value: unknown): value is JsonValue {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') {
    return true;
  }
  if (typeof value === 'number') {
    return Number.isFinite(value);
  }
  return typeof value === 'object' && canSerializeRuntimeJson(value);
}

function canSerializeRuntimeJson(value: object): boolean {
  try {
    JSON.stringify(value);
    return true;
  } catch {
    return false;
  }
}

function sanitizeRuntimeExceptionValue(key: string, value: JsonValue, seen: WeakSet<object>): JsonValue {
  if (typeof value === 'string') {
    return sanitizeRuntimeExceptionString(key, value);
  }
  if (value === null || typeof value === 'boolean' || typeof value === 'number') {
    return value;
  }
  if (seen.has(value)) {
    return '[Circular]';
  }
  seen.add(value);
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeRuntimeExceptionValue(key, item, seen));
  }
  return Object.fromEntries(
    Object.entries(value).map(([childKey, childValue]) => [childKey, sanitizeRuntimeExceptionValue(childKey, childValue, seen)]),
  );
}

function sanitizeRuntimeExceptionString(key: string, value: string): string {
  if (isRuntimeExceptionCredentialOrTokenKey(key)) {
    return '<redacted:credential>';
  }
  if (value.length > 128 || /\s/u.test(value)) {
    return runtimeExceptionExcerpt(value);
  }
  return value;
}

function isRuntimeExceptionCredentialOrTokenKey(key: string): boolean {
  const segments = normalizeRuntimeExceptionKey(key).split('_').filter(Boolean);
  const last = segments.at(-1);
  if (last === undefined) {
    return false;
  }
  if (
    new Set(['password', 'passwords', 'secret', 'secrets', 'credential', 'credentials', 'authorization', 'authorizations', 'cookie', 'cookies']).has(
      last,
    )
  ) {
    return true;
  }
  if (last === 'token' || last === 'tokens') {
    return segments.length === 1 || new Set(['api', 'access', 'auth', 'refresh', 'bearer', 'id']).has(segments.at(-2) ?? '');
  }
  if ((last === 'key' || last === 'keys') && segments.at(-2) === 'api') {
    return true;
  }
  if (last !== 'value' && last !== 'values') {
    return false;
  }
  const kind = segments.at(-2);
  return (
    new Set(['password', 'passwords', 'secret', 'secrets', 'credential', 'credentials', 'authorization', 'authorizations', 'cookie', 'cookies']).has(
      kind ?? '',
    ) ||
    kind === 'token' ||
    kind === 'tokens' ||
    (kind === 'key' && segments.at(-3) === 'api')
  );
}

function normalizeRuntimeExceptionKey(key: string): string {
  return key.replace(/([a-z0-9])([A-Z])/gu, '$1_$2').toLowerCase();
}

function runtimeExceptionExcerpt(value: string): string {
  const redacted = redactRuntimeExceptionTokens(value);
  const compact = redacted.trim().replace(/\s+/gu, ' ');
  return compact.length <= RUNTIME_EXCEPTION_TEXT_LIMIT ? compact : `${compact.slice(0, RUNTIME_EXCEPTION_TEXT_LIMIT - 3)}...`;
}

function redactRuntimeExceptionTokens(value: string): string {
  return value
    .replace(/sk-[A-Za-z0-9._-]{10,}/gu, '<redacted:credential>')
    .replace(/Bearer\s+[A-Za-z0-9._\-~+/=]+/gu, 'Bearer <redacted:credential>')
    .replace(/((?:password|api[-_]?key|token|secret|credential|authorization)\s*[:=]\s*)[^\s,;]+/giu, '$1<redacted:credential>');
}

export interface SafeError {
  readonly code: string;
  readonly message: string;
  readonly category: AgentErrorCategory;
  readonly retryable: boolean;
  readonly safeDetails?: JsonObject;
}

export function brand<T extends string | number, Name extends string>(value: T): Brand<T, Name> {
  if (value === '' || value === null || value === undefined) {
    throw new AgentError({
      code: 'INVALID_BRAND_VALUE',
      message: 'Identifier value must be non-empty.',
      category: 'VALIDATION',
      retryable: false,
    });
  }
  return value as Brand<T, Name>;
}

export function deriveCapabilityInvocationIdempotencyKey(runId: RequestRunId, toolCallId: string): IdempotencyKey {
  return brand<string, 'IdempotencyKey'>(`${runId}:${toolCallId}`);
}

// Downstream memory/gateway services cap `idempotencyKey` at 256 chars. A
// batched assistant-tool-use message joins every toolCallId into one key, so a
// large model-returned batch (many long provider IDs) can blow past that limit
// and surface as an opaque WM_HTTP_ERROR. When the literal would exceed it,
// collapse the unbounded id list to a fixed sha256 digest of the joined IDs.
// The digest is deterministic, so retries/replays of the same batch still hit
// the same key — idempotent dedup semantics are preserved.
export const IDEMPOTENCY_KEY_MAX_LENGTH = 256;

export function deriveAssistantToolUseIdempotencyKey(runId: RequestRunId, toolCallIds: readonly string[]): IdempotencyKey {
  const joined = toolCallIds.join(',');
  const literal = `${runId}:assistant-tool-use:${joined}`;
  if (literal.length <= IDEMPOTENCY_KEY_MAX_LENGTH) {
    return brand<string, 'IdempotencyKey'>(literal);
  }
  const digest = createHash('sha256').update(joined).digest('hex').slice(0, 16);
  return brand<string, 'IdempotencyKey'>(`${runId}:assistant-tool-use:h:${digest}`);
}

export const SECRET_KEYWORD_PATTERN = /secret|credential|token/iu;
export const TASK_EVENT_ID_MAX_LENGTH = 32;
export const TASK_EVENT_ID_PATTERN = '^[A-Za-z0-9_.: -]{1,32}$';
export const CRON_MAX_TASKS_PER_SCOPE = 50;
export const CRON_TASK_LIMIT_REACHED_CODE = 'CRON_TASK_LIMIT_REACHED';
const taskEventIdPattern = new RegExp(TASK_EVENT_ID_PATTERN, 'u');

export function isTaskEventId(value: unknown): value is TaskEventId {
  return typeof value === 'string' && value.length <= TASK_EVENT_ID_MAX_LENGTH && taskEventIdPattern.test(value);
}

/**
 * Returns true when `candidate` is the same path as `root` or a
 * descendant of it. Both arguments must be absolute — a non-absolute
 * path has no structural relationship to any root, so the check
 * rejects it. Comparison is purely structural via `path.relative` —
 * no symlink resolution. The cross-platform contract is: a relative
 * result that does not start with `..` and is not absolute means
 * `candidate` lives inside `root`.
 *
 * Single source of truth for "is this path inside one of the trust
 * roots". The restricted local sandbox's readonly root protection
 * converges on this helper instead of carrying its own prefix /
 * `relative` comparison.
 */
export function isPathInside(root: string, candidate: string): boolean {
  if (!isAbsolute(candidate)) {
    return false;
  }
  const rel = relative(root, candidate);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}
