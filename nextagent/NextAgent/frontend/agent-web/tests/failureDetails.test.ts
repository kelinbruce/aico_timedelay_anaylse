import { describe, expect, it } from 'vitest';
import type { StreamEnvelope, StreamEventType } from '../src/state/contracts.ts';
import { readFailureReasonPresentation } from '../src/features/chat/utils/failureDetails.ts';

describe('failure details', () => {
  it.each([
    ['MODEL_AUTHENTICATION_FAILED', 'MODEL_INVOCATION', false, 'turn.failureRemediations.modelCredential'],
    ['MODEL_NOT_FOUND', 'MODEL_INVOCATION', false, 'turn.failureRemediations.modelProfile'],
    ['MODEL_RATE_LIMITED', 'MODEL_INVOCATION', true, 'turn.failureRemediations.providerRetry'],
    ['MODEL_NETWORK_FAILED', 'MODEL_INVOCATION', true, 'turn.failureRemediations.providerRetry'],
    ['MODEL_TIMEOUT', 'MODEL_INVOCATION', true, 'turn.failureRemediations.providerRetry'],
    ['MODEL_REQUEST_INVALID', 'MODEL_INVOCATION', false, 'turn.failureRemediations.requestInput'],
    ['MODEL_CONTEXT_LIMIT_EXCEEDED', 'MODEL_INVOCATION', false, 'turn.failureRemediations.requestInput'],
    ['MODEL_RESPONSE_INVALID', 'MODEL_INVOCATION', false, 'turn.failureRemediations.developerSupport'],
    ['MODEL_INTERNAL_ERROR', 'MODEL_INVOCATION', false, 'turn.failureRemediations.developerSupport'],
    ['CAPABILITY_INPUT_INVALID', 'CAPABILITY_INPUT', false, 'turn.failureRemediations.capabilityInput'],
    ['CAPABILITY_OUTPUT_INVALID', 'CAPABILITY_OUTPUT', false, 'turn.failureRemediations.developerSupport'],
    ['CAPABILITY_DEPENDENCY_UNAVAILABLE', 'CAPABILITY_EXECUTION', true, 'turn.failureRemediations.retryLater'],
    ['CAPABILITY_EXECUTION_FAILED', 'CAPABILITY_EXECUTION', false, 'turn.failureRemediations.developerSupport'],
    ['PENDING_INPUT_TIMEOUT', 'REQUEST_RUNTIME', false, 'turn.failureRemediations.inputTimeout'],
  ] as const)('maps %s to an actionable presentation', (code, stage, retryRecommended, remediationTranslationKey) => {
    expect(
      readFailureReasonPresentation([event(code.startsWith('CAPABILITY_') ? 'CAPABILITY_COMPLETED' : 'REQUEST_FAILED', 1, { safeErrorCode: code })]),
    ).toMatchObject({ errorCode: code, stage, retryRecommended, remediationTranslationKey });
  });

  it('keeps an unknown stable code and degrades safely', () => {
    expect(readFailureReasonPresentation([event('REQUEST_FAILED', 1, { safeErrorCode: 'FUTURE_SAFE_CODE', message: 'raw-canary' })])).toEqual({
      translationKey: 'turn.failureReasons.generic',
      errorCode: 'FUTURE_SAFE_CODE',
      stage: 'UNKNOWN',
      retryRecommended: false,
      remediationTranslationKey: 'turn.failureRemediations.generic',
    });
  });

  it('preserves request-failed priority and latest event selection', () => {
    const presentation = readFailureReasonPresentation([
      event('CAPABILITY_COMPLETED', 1, { safeErrorCode: 'CAPABILITY_INPUT_INVALID' }),
      event('REQUEST_FAILED', 2, { safeErrorCode: 'MODEL_NETWORK_FAILED' }),
      event('REQUEST_FAILED', 3, { safeErrorCode: 'MODEL_AUTHENTICATION_FAILED' }),
      event('DEGRADATION_NOTICE', 4, { safeErrorCode: 'MODEL_RATE_LIMITED' }),
    ]);
    expect(presentation).toMatchObject({
      errorCode: 'MODEL_AUTHENTICATION_FAILED',
      stage: 'MODEL_INVOCATION',
      retryRecommended: false,
    });
  });

  it.each([
    ['ROUTING_PREFERRED_SKILL_UNAVAILABLE', 'turn.failureReasons.skillUnavailable'],
    ['ROUTING_PREFERRED_SKILL_FAILED', 'turn.failureReasons.skillUnavailable'],
    ['ROUTING_PREFERRED_SKILL_TOOL_UNAVAILABLE', 'turn.failureReasons.skillUnavailable'],
    ['ROUTING_CONSTRAINT_DEPENDENCY_UNAVAILABLE', 'turn.failureReasons.skillUnavailable'],
    ['ROUTING_PREFERRED_SKILL_FORBIDDEN', 'turn.failureReasons.skillForbidden'],
  ] as const)('maps %s to a skill-routing presentation', (code, translationKey) => {
    expect(
      readFailureReasonPresentation([
        event('REQUEST_FAILED', 1, { safeErrorCode: code, safeError: { safeDetails: { targetSkill: 'bom-test-skill' } } }),
      ]),
    ).toMatchObject({
      errorCode: code,
      stage: 'CAPABILITY_EXECUTION',
      retryRecommended: false,
      remediationTranslationKey: 'turn.failureRemediations.skillRouting',
      translationKey,
      skillName: 'bom-test-skill',
    });
  });

  it('maps an empty effective question directive to a directive-empty presentation', () => {
    expect(
      readFailureReasonPresentation([event('REQUEST_FAILED', 1, { safeErrorCode: 'CAPABILITY_DIRECTIVE_EFFECTIVE_QUESTION_EMPTY' })]),
    ).toMatchObject({
      errorCode: 'CAPABILITY_DIRECTIVE_EFFECTIVE_QUESTION_EMPTY',
      stage: 'CAPABILITY_INPUT',
      remediationTranslationKey: 'turn.failureRemediations.skillRouting',
      translationKey: 'turn.failureReasons.directiveEmpty',
    });
  });

  it('maps pending input timeout to a user-friendly presentation', () => {
    expect(readFailureReasonPresentation([event('REQUEST_FAILED', 1, { safeErrorCode: 'PENDING_INPUT_TIMEOUT' })])).toMatchObject({
      errorCode: 'PENDING_INPUT_TIMEOUT',
      stage: 'REQUEST_RUNTIME',
      retryRecommended: false,
      remediationTranslationKey: 'turn.failureRemediations.inputTimeout',
      translationKey: 'turn.failureReasons.inputTimeout',
    });
  });
});

function event(eventType: StreamEventType, sequence: number, payload: Record<string, unknown>): StreamEnvelope {
  return {
    eventId: `event-${sequence}`,
    sequence,
    sessionId: 'session-1',
    requestId: 'request-1',
    eventType,
    payload,
    createdAt: '2026-07-28T00:00:00.000Z',
    transportHints: [],
    timelineEventRef: null,
  } as StreamEnvelope;
}
