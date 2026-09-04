import type { StreamEnvelope } from '../../../state/contracts.ts';

const LEGACY_SAFE_FAILURE_WITH_CODE = /^Request failed safely(?: during local runtime recovery)?:\s*([A-Z0-9_]+)\.?$/u;

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function readPayloadMetadata(payload: Record<string, unknown>): Record<string, unknown> | null {
  const metadata = payload.metadata;
  return metadata && typeof metadata === 'object' && !Array.isArray(metadata) ? (metadata as Record<string, unknown>) : null;
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

export function readFailureErrorCodeFromPayload(payload: Record<string, unknown>): string | null {
  const metadata = readPayloadMetadata(payload);
  const safeError = readRecord(payload.safeError);
  const metadataSafeError = readRecord(metadata?.safeError);
  const directCode = readString(payload.safeErrorCode) ?? readString(payload.code) ?? readString(payload.errorCode) ?? readString(safeError?.code);
  if (directCode) {
    return directCode;
  }

  const metadataCode =
    readString(metadata?.safeErrorCode) ?? readString(metadata?.code) ?? readString(metadata?.errorCode) ?? readString(metadataSafeError?.code);
  if (metadataCode) {
    return metadataCode;
  }

  const legacyText =
    readString(payload.content) ??
    readString(payload.text) ??
    readString(payload.message) ??
    readString(payload.reason) ??
    readString(payload.detail);
  const match = legacyText ? LEGACY_SAFE_FAILURE_WITH_CODE.exec(legacyText) : null;
  return match?.[1] ?? null;
}

export function readFailureErrorCategoryFromPayload(payload: Record<string, unknown>): string | null {
  const metadata = readPayloadMetadata(payload);
  const safeError = readRecord(payload.safeError);
  const metadataSafeError = readRecord(metadata?.safeError);
  return (
    readString(payload.safeErrorCategory) ??
    readString(payload.category) ??
    readString(safeError?.category) ??
    readString(metadata?.safeErrorCategory) ??
    readString(metadata?.category) ??
    readString(metadataSafeError?.category)
  );
}

export interface FailureReasonPresentation {
  readonly translationKey: string;
  readonly errorCode: string | null;
  readonly stage: FailureStage;
  readonly retryRecommended: boolean;
  readonly remediationTranslationKey: string;
  readonly skillName?: string;
}

export type FailureStage = 'MODEL_INVOCATION' | 'CAPABILITY_INPUT' | 'CAPABILITY_EXECUTION' | 'CAPABILITY_OUTPUT' | 'REQUEST_RUNTIME' | 'UNKNOWN';

interface FailureAction {
  readonly stage: FailureStage;
  readonly retryRecommended: boolean;
  readonly remediationTranslationKey: string;
}

const MODEL_RETRY_CODES = new Set(['MODEL_TIMEOUT', 'MODEL_RATE_LIMITED', 'MODEL_NETWORK_FAILED']);
const MODEL_PROFILE_CODES = new Set(['MODEL_NOT_FOUND']);
const MODEL_CREDENTIAL_CODES = new Set(['MODEL_AUTHENTICATION_FAILED']);
const MODEL_DEVELOPER_CODES = new Set(['MODEL_RESPONSE_INVALID', 'MODEL_INTERNAL_ERROR']);
const CAPABILITY_RETRY_CODES = new Set(['CAPABILITY_DEPENDENCY_UNAVAILABLE']);
const SKILL_ROUTING_CODES = new Set([
  'ROUTING_PREFERRED_SKILL_UNAVAILABLE',
  'ROUTING_PREFERRED_SKILL_FAILED',
  'ROUTING_PREFERRED_SKILL_TOOL_UNAVAILABLE',
  'ROUTING_CONSTRAINT_DEPENDENCY_UNAVAILABLE',
]);
const SKILL_FORBIDDEN_CODE = 'ROUTING_PREFERRED_SKILL_FORBIDDEN';
const DIRECTIVE_EMPTY_CODE = 'CAPABILITY_DIRECTIVE_EFFECTIVE_QUESTION_EMPTY';

const FAILURE_REASON_BY_CODE: Record<string, string> = {
  CAPABILITY_INPUT_INVALID: 'turn.failureReasons.invalidToolInput',
  CAPABILITY_OUTPUT_INVALID: 'turn.failureReasons.validation',
  CAPABILITY_DEPENDENCY_UNAVAILABLE: 'turn.failureReasons.unavailable',
  CAPABILITY_DIRECTIVE_EFFECTIVE_QUESTION_EMPTY: 'turn.failureReasons.directiveEmpty',
  CAPABILITY_EXECUTION_FAILED: 'turn.failureReasons.internal',
  CAPABILITY_PATH_REJECTED: 'turn.failureReasons.pathRejected',
  CAPABILITY_RESULT_LIMIT_EXCEEDED: 'turn.failureReasons.resultTooLarge',
  CAPABILITY_UNAVAILABLE: 'turn.failureReasons.unavailable',
  COMMAND_NOT_ALLOWED: 'turn.failureReasons.localAccessBlocked',
  INVALID_INPUT: 'turn.failureReasons.invalidToolInput',
  LOCAL_STORE_UNAVAILABLE: 'turn.failureReasons.unavailable',
  MODEL_REFUSAL: 'turn.failureReasons.modelRefusal',
  MODEL_ABORTED: 'turn.failureReasons.canceled',
  MODEL_AUTHENTICATION_FAILED: 'turn.failureReasons.authorization',
  MODEL_CONTEXT_LIMIT_EXCEEDED: 'turn.failureReasons.modelOutputLimitExceeded',
  MODEL_INTERNAL_ERROR: 'turn.failureReasons.internal',
  MODEL_NETWORK_FAILED: 'turn.failureReasons.unavailable',
  MODEL_NOT_FOUND: 'turn.failureReasons.notFound',
  MODEL_RATE_LIMITED: 'turn.failureReasons.unavailable',
  MODEL_REQUEST_INVALID: 'turn.failureReasons.validation',
  MODEL_RESPONSE_INVALID: 'turn.failureReasons.validation',
  MODEL_TEXT_LIMIT_EXCEEDED: 'turn.failureReasons.modelOutputLimitExceeded',
  MODEL_TIMEOUT: 'turn.failureReasons.timeout',
  PENDING_INPUT_NOT_FOUND: 'turn.failureReasons.notFound',
  PENDING_INPUT_TIMEOUT: 'turn.failureReasons.inputTimeout',
  PYTHON_EXECUTION_TIMEOUT: 'turn.failureReasons.timeout',
  REQUEST_CANCEL_NOT_FOUND: 'turn.failureReasons.notFound',
  REQUEST_RETRY_NOT_FOUND: 'turn.failureReasons.notFound',
  RESOURCE_TOO_LARGE: 'turn.failureReasons.resultTooLarge',
  ROUTING_CONSTRAINT_DEPENDENCY_UNAVAILABLE: 'turn.failureReasons.skillUnavailable',
  ROUTING_PREFERRED_SKILL_DEADLINE_EXCEEDED: 'turn.failureReasons.timeout',
  ROUTING_PREFERRED_SKILL_FAILED: 'turn.failureReasons.skillUnavailable',
  ROUTING_PREFERRED_SKILL_FORBIDDEN: 'turn.failureReasons.skillForbidden',
  ROUTING_PREFERRED_SKILL_UNAVAILABLE: 'turn.failureReasons.skillUnavailable',
  ROUTING_PREFERRED_SKILL_TOOL_UNAVAILABLE: 'turn.failureReasons.skillUnavailable',
  RUNTIME_IDLE_TIMEOUT: 'turn.failureReasons.timeout',
  SANDBOX_PREREQUISITE_MISSING: 'turn.failureReasons.unavailable',
  SANDBOX_REMOTE_UNAVAILABLE: 'turn.failureReasons.unavailable',
  SANDBOX_TIMEOUT: 'turn.failureReasons.timeout',
  SANDBOX_UNAVAILABLE: 'turn.failureReasons.unavailable',
  SANDBOX_UNCONFIGURED: 'turn.failureReasons.unavailable',
  SESSION_NOT_FOUND: 'turn.failureReasons.notFound',
  STREAM_FILTER_NOT_FOUND: 'turn.failureReasons.notFound',
  TIMELINE_READ_TIMEOUT: 'turn.failureReasons.timeout',
  TOOL_CALL_LIMIT_EXCEEDED: 'turn.failureReasons.limitExceeded',
  TOOL_DEPENDENCY_MISSING: 'turn.failureReasons.unavailable',
  TOOL_ROUND_LIMIT_EXCEEDED: 'turn.failureReasons.limitExceeded',
  UNEXPECTED_ERROR: 'turn.failureReasons.internal',
};

function failureAction(code: string | null, category: string | null, eventType: StreamEnvelope['eventType'] | null): FailureAction {
  if (code) {
    if (MODEL_CREDENTIAL_CODES.has(code)) {
      return action('MODEL_INVOCATION', false, 'turn.failureRemediations.modelCredential');
    }
    if (MODEL_PROFILE_CODES.has(code)) {
      return action('MODEL_INVOCATION', false, 'turn.failureRemediations.modelProfile');
    }
    if (MODEL_RETRY_CODES.has(code)) {
      return action('MODEL_INVOCATION', true, 'turn.failureRemediations.providerRetry');
    }
    if (MODEL_DEVELOPER_CODES.has(code)) {
      return action('MODEL_INVOCATION', false, 'turn.failureRemediations.developerSupport');
    }
    if (
      code === 'MODEL_ABORTED' ||
      code === 'MODEL_REQUEST_INVALID' ||
      code === 'MODEL_CONTEXT_LIMIT_EXCEEDED' ||
      code === 'MODEL_REFUSAL' ||
      code === 'MODEL_TEXT_LIMIT_EXCEEDED'
    ) {
      return action('MODEL_INVOCATION', false, 'turn.failureRemediations.requestInput');
    }
    if (code === 'CAPABILITY_INPUT_INVALID' || code === 'INVALID_INPUT') {
      return action('CAPABILITY_INPUT', false, 'turn.failureRemediations.capabilityInput');
    }
    if (code === 'CAPABILITY_OUTPUT_INVALID') {
      return action('CAPABILITY_OUTPUT', false, 'turn.failureRemediations.developerSupport');
    }
    if (CAPABILITY_RETRY_CODES.has(code)) {
      return action('CAPABILITY_EXECUTION', true, 'turn.failureRemediations.retryLater');
    }
    if (code === 'CAPABILITY_EXECUTION_FAILED') {
      return action('CAPABILITY_EXECUTION', false, 'turn.failureRemediations.developerSupport');
    }
    if (code === DIRECTIVE_EMPTY_CODE) {
      return action('CAPABILITY_INPUT', false, 'turn.failureRemediations.skillRouting');
    }
    if (code === SKILL_FORBIDDEN_CODE) {
      return action('CAPABILITY_EXECUTION', false, 'turn.failureRemediations.skillRouting');
    }
    if (SKILL_ROUTING_CODES.has(code)) {
      return action('CAPABILITY_EXECUTION', false, 'turn.failureRemediations.skillRouting');
    }
    if (code === 'PENDING_INPUT_TIMEOUT') {
      return action('REQUEST_RUNTIME', false, 'turn.failureRemediations.inputTimeout');
    }
    if (FAILURE_REASON_BY_CODE[code] !== undefined) {
      const retry = category === 'TIMEOUT' || category === 'UNAVAILABLE';
      const stage = eventType === 'CAPABILITY_COMPLETED' || eventType === 'CAPABILITY_RESULT_DELTA' ? 'CAPABILITY_EXECUTION' : 'REQUEST_RUNTIME';
      return action(stage, retry, retry ? 'turn.failureRemediations.retryLater' : 'turn.failureRemediations.requestInput');
    }
    return action('UNKNOWN', false, 'turn.failureRemediations.generic');
  }
  const retry = category === 'TIMEOUT' || category === 'UNAVAILABLE';
  return action(
    eventType === 'CAPABILITY_COMPLETED' || eventType === 'CAPABILITY_RESULT_DELTA' ? 'CAPABILITY_EXECUTION' : 'REQUEST_RUNTIME',
    retry,
    retry ? 'turn.failureRemediations.retryLater' : 'turn.failureRemediations.generic',
  );
}

function action(stage: FailureStage, retryRecommended: boolean, remediationTranslationKey: string): FailureAction {
  return { stage, retryRecommended, remediationTranslationKey };
}

const FAILURE_REASON_BY_CATEGORY: Record<string, string> = {
  AUTHORIZATION: 'turn.failureReasons.authorization',
  CANCELED: 'turn.failureReasons.canceled',
  CONFLICT: 'turn.failureReasons.conflict',
  INTERNAL: 'turn.failureReasons.internal',
  NOT_FOUND: 'turn.failureReasons.notFound',
  POLICY_DENIED: 'turn.failureReasons.policyDenied',
  TIMEOUT: 'turn.failureReasons.timeout',
  UNAVAILABLE: 'turn.failureReasons.unavailable',
  VALIDATION: 'turn.failureReasons.validation',
};

const FAILURE_REASON_PRIORITY: ReadonlyArray<ReadonlySet<StreamEnvelope['eventType']>> = [
  new Set(['REQUEST_FAILED']),
  new Set(['CAPABILITY_COMPLETED', 'CAPABILITY_RESULT_DELTA']),
  new Set(['DEGRADATION_NOTICE']),
];

function resolveFailureReasonTranslationKey(code: string | null, category: string | null): string {
  if (code) {
    const codeKey = FAILURE_REASON_BY_CODE[code];
    if (codeKey) {
      return codeKey;
    }
  }
  if (category) {
    const categoryKey = FAILURE_REASON_BY_CATEGORY[category];
    if (categoryKey) {
      return categoryKey;
    }
  }
  return 'turn.failureReasons.generic';
}

export function readFailureReasonTranslationKeyFromPayload(payload: Record<string, unknown>): string {
  return resolveFailureReasonTranslationKey(readFailureErrorCodeFromPayload(payload), readFailureErrorCategoryFromPayload(payload));
}

function readTargetSkillFromPayload(payload: Record<string, unknown>): string | undefined {
  const metadata = readPayloadMetadata(payload);
  const safeError = readRecord(payload.safeError);
  const metadataSafeError = readRecord(metadata?.safeError);
  const safeDetails = readRecord(safeError?.safeDetails) ?? readRecord(metadataSafeError?.safeDetails);
  const targetSkill = readString(safeDetails?.targetSkill) ?? readString(metadata?.targetSkill) ?? readString(payload.targetSkill);
  return targetSkill === null ? undefined : targetSkill;
}

export function readFailureReasonPresentation(events: readonly StreamEnvelope[]): FailureReasonPresentation {
  for (const eventTypes of FAILURE_REASON_PRIORITY) {
    for (let index = events.length - 1; index >= 0; index -= 1) {
      const event = events[index];
      if (!event || !eventTypes.has(event.eventType)) {
        continue;
      }
      const payload = event.payload as Record<string, unknown>;
      const code = readFailureErrorCodeFromPayload(payload);
      const category = readFailureErrorCategoryFromPayload(payload);
      if (code || category) {
        const failure = failureAction(code, category, event.eventType);
        const skillName = readTargetSkillFromPayload(payload);
        return {
          translationKey: readFailureReasonTranslationKeyFromPayload(payload),
          errorCode: code,
          ...failure,
          ...(skillName === undefined ? {} : { skillName }),
        };
      }
    }
  }
  return {
    translationKey: 'turn.failureReasons.generic',
    errorCode: null,
    stage: 'UNKNOWN',
    retryRecommended: false,
    remediationTranslationKey: 'turn.failureRemediations.generic',
  };
}

export function readFailureErrorCode(events: readonly StreamEnvelope[]): string | null {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (event?.eventType !== 'REQUEST_FAILED') {
      continue;
    }
    const code = readFailureErrorCodeFromPayload(event.payload as Record<string, unknown>);
    if (code) {
      return code;
    }
  }
  return null;
}
