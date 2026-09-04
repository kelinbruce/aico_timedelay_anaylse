import { create } from 'zustand';
import { useSessionStore } from './sessionStore.ts';
import { useConversationStore } from './conversationStore.ts';
import { requestService } from '../services/requestService.ts';
import type { TempFileRef } from '../services/requestService.ts';
import { isApiError, type ApiError } from '../services/apiClient.ts';
import i18n, { getCurrentLocale } from '../i18n/index.ts';
import { type RequestAccepted, type StreamEnvelope, type StreamEventType, isTerminalStreamEvent } from '../state/contracts.ts';
import type { WireTimestamp } from '../state/contracts.ts';
import { getEnvelopeAttemptId, getEnvelopeRootMessageId, getEnvelopeRunId } from '../features/chat/utils/streamingHelpers.ts';
import { deriveAttachmentMediaType } from '../features/composer/attachmentRules.ts';
import { parseDirectiveTarget, stripDirectives } from '../features/composer/capabilityDirective.ts';

export type RequestStatus = 'idle' | 'submitting' | 'accepted' | 'failed' | 'canceling' | 'canceled' | 'retrying' | 'editing';
export type RequestNoticeLevel = 'info' | 'warning' | 'error';
type TerminalStreamEventType = Extract<StreamEventType, 'REQUEST_COMPLETED' | 'REQUEST_FAILED' | 'REQUEST_CANCELED' | 'REQUEST_SUPERSEDED'>;

export interface RequestNotice {
  readonly level: RequestNoticeLevel;
  readonly message: string;
}

type PendingRequestKind = 'submit' | 'edit' | 'retry';

interface PendingRequest {
  readonly kind: PendingRequestKind;
  readonly sessionId: string;
  readonly idempotencyKey: string;
  readonly startedAtMs: number;
  readonly optimisticRequestId?: string;
  readonly retrySourceRootMessageId?: string;
  readonly acceptedRootMessageId?: string;
  readonly acceptedRunId?: string;
  readonly acceptedRequestContextId?: string;
  readonly acceptedAt?: WireTimestamp;
  readonly httpIdentityConfirmed?: boolean;
}

type RequestControlIdempotencyAction = 'cancel' | 'retry';

function createNotice(level: RequestNoticeLevel, message: string): RequestNotice {
  return { level, message };
}

function isConflictError(error: unknown): error is ApiError {
  return isApiError(error) && error.status === 409;
}

const MAX_REQUEST_ATTEMPTS = 6;

function isRetryLimitError(error: unknown): error is ApiError {
  return isApiError(error) && error.code === 'REQUEST_RETRY_LIMIT_EXCEEDED';
}

function isNetworkError(error: unknown): error is ApiError {
  return isApiError(error) && error.kind === 'network';
}

function shouldKeepControlIdempotencyKey(error: unknown): boolean {
  return isApiError(error) && error.retriable;
}

function readSessionStorage(): Storage | null {
  try {
    return typeof window !== 'undefined' ? window.sessionStorage : null;
  } catch {
    return null;
  }
}

function controlIdempotencyStorageKey(action: RequestControlIdempotencyAction, sessionId: string, expectedLatestRequestId: string): string {
  return `request-control-idempotency:${action}:${sessionId}:${expectedLatestRequestId}`;
}

function readOrCreateControlIdempotencyKey(action: RequestControlIdempotencyAction, sessionId: string, expectedLatestRequestId: string): string {
  const storage = readSessionStorage();
  const storageKey = controlIdempotencyStorageKey(action, sessionId, expectedLatestRequestId);
  const existingKey = storage?.getItem(storageKey)?.trim();
  if (existingKey) {
    return existingKey;
  }

  const idempotencyKey = crypto.randomUUID();
  storage?.setItem(storageKey, idempotencyKey);
  return idempotencyKey;
}

function clearControlIdempotencyKey(action: RequestControlIdempotencyAction, sessionId: string, expectedLatestRequestId: string): void {
  readSessionStorage()?.removeItem(controlIdempotencyStorageKey(action, sessionId, expectedLatestRequestId));
}

function isAttachmentError(error: unknown): boolean {
  return (
    isApiError(error) &&
    (error.code === 'ATTACHMENT_TYPE_UNSUPPORTED' ||
      error.code === 'ATTACHMENT_TYPE_MISMATCH' ||
      error.code === 'ATTACHMENT_READ_FAILED' ||
      error.code === 'ATTACHMENT_STAGING_FAILED' ||
      error.code === 'ATTACHMENT_INTAKE_TIMEOUT' ||
      error.code === 'ATTACHMENT_DEPENDENCY_UNAVAILABLE' ||
      error.code === 'REQUEST_RETRY_ATTACHMENT_UNAVAILABLE' ||
      error.code === 'REQUEST_EDIT_ATTACHMENT_UNAVAILABLE')
  );
}

function isAttachmentEmptyError(error: unknown): boolean {
  return isApiError(error) && error.code === 'ATTACHMENT_EMPTY';
}

function attachmentErrorNotice(error: unknown): string {
  if (!isApiError(error)) {
    return i18n.t('requestNotices.attachmentExpired');
  }
  switch (error.code) {
    case 'ATTACHMENT_TYPE_UNSUPPORTED':
      return i18n.t('requestNotices.attachmentUnsupported');
    case 'ATTACHMENT_TYPE_MISMATCH':
      return i18n.t('requestNotices.attachmentMismatch');
    case 'ATTACHMENT_READ_FAILED':
      return i18n.t('requestNotices.attachmentUnreadable');
    case 'REQUEST_RETRY_ATTACHMENT_UNAVAILABLE':
      return i18n.t('requestNotices.retryAttachmentUnavailable');
    case 'REQUEST_EDIT_ATTACHMENT_UNAVAILABLE':
      return i18n.t('requestNotices.editAttachmentUnavailable');
    default:
      return i18n.t('requestNotices.attachmentExpired');
  }
}

function getRequestErrorMessage(error: unknown, fallback: string): string {
  if (isAttachmentError(error)) {
    return attachmentErrorNotice(error);
  }
  if (isApiError(error)) {
    if (error.code === 'INVALID_RESPONSE_FORMAT') {
      return i18n.t('requestNotices.invalidResponseFormat');
    }
    if (error.code === 'SESSION_NOT_FOUND') {
      return i18n.t('requestNotices.sessionNotFound');
    }
    return error.error;
  }
  return error instanceof Error ? error.message : fallback;
}

/**
 * Map a directive / targeted-skill routing failure to a friendly i18n notice.
 * Returns null when the error is not a skill-routing failure, so callers can
 * fall through to the generic submit-failed message. `targetSkill` is the
 * directive-derived skill name from the optimistic envelope (the backend does
 * not echo safeDetails to the web client, so we use the locally known name).
 */
function skillRoutingFailureNotice(error: unknown, targetSkill?: string): string | null {
  if (!isApiError(error)) {
    return null;
  }
  switch (error.code) {
    case 'CAPABILITY_DIRECTIVE_EFFECTIVE_QUESTION_EMPTY':
      return i18n.t('composer.emptyAfterDirective');
    case 'ROUTING_PREFERRED_SKILL_FORBIDDEN':
      return i18n.t('composer.skillForbidden', { skill: targetSkill ?? '' });
    case 'ROUTING_PREFERRED_SKILL_UNAVAILABLE':
    case 'ROUTING_PREFERRED_SKILL_FAILED':
    case 'ROUTING_PREFERRED_SKILL_TOOL_UNAVAILABLE':
    case 'ROUTING_CONSTRAINT_DEPENDENCY_UNAVAILABLE':
      return i18n.t('composer.skillUnavailable', { skill: targetSkill ?? '' });
    default:
      return null;
  }
}

function resolveAcceptedRootMessageId(accepted: RequestAccepted, fallback: string): string {
  return accepted.requestId ?? fallback;
}

function resolveAcceptedRunId(accepted: RequestAccepted, fallback: string): string {
  return accepted.runId ?? accepted.requestId ?? fallback;
}

function readEnvelopeRequestContextId(envelope: StreamEnvelope): string | null {
  const envelopeContextId = envelope.requestContextId?.trim();
  if (envelopeContextId) {
    return envelopeContextId;
  }
  const payloadContextId = (envelope.payload as Record<string, unknown>).requestContextId;
  if (typeof payloadContextId === 'string' && payloadContextId.trim()) {
    return payloadContextId.trim();
  }
  return envelope.eventType === 'REQUEST_ACCEPTED' ? getEnvelopeAttemptId(envelope) : null;
}

function mergePendingIdentity(
  pending: PendingRequest,
  identity: {
    readonly rootMessageId: string;
    readonly runId: string;
    readonly requestContextId?: string | null;
  },
): PendingRequest | null {
  if (
    (pending.acceptedRootMessageId && pending.acceptedRootMessageId !== identity.rootMessageId) ||
    (pending.acceptedRunId && pending.acceptedRunId !== identity.runId) ||
    (pending.acceptedRequestContextId && identity.requestContextId && pending.acceptedRequestContextId !== identity.requestContextId)
  ) {
    return null;
  }
  const acceptedRequestContextId = pending.acceptedRequestContextId ?? identity.requestContextId ?? null;
  return {
    ...pending,
    acceptedRootMessageId: pending.acceptedRootMessageId ?? identity.rootMessageId,
    acceptedRunId: pending.acceptedRunId ?? identity.runId,
    ...(acceptedRequestContextId ? { acceptedRequestContextId } : {}),
  };
}

function mergePendingHttpIdentity(
  pending: PendingRequest,
  identity: {
    readonly rootMessageId: string;
    readonly runId: string;
  },
): {
  readonly pending: PendingRequest;
  readonly previousRootMessageId: string | null;
  readonly previousRunId: string | null;
} {
  const candidateConflicts = Boolean(
    (pending.acceptedRootMessageId && pending.acceptedRootMessageId !== identity.rootMessageId) ||
    (pending.acceptedRunId && pending.acceptedRunId !== identity.runId),
  );
  const previousRootMessageId = candidateConflicts ? (pending.acceptedRootMessageId ?? null) : null;
  const previousRunId = candidateConflicts ? (pending.acceptedRunId ?? null) : null;
  const {
    acceptedRootMessageId: _acceptedRootMessageId,
    acceptedRunId: _acceptedRunId,
    acceptedRequestContextId: _acceptedRequestContextId,
    httpIdentityConfirmed: _httpIdentityConfirmed,
    ...pendingBase
  } = pending;
  return {
    pending: {
      ...pendingBase,
      acceptedRootMessageId: identity.rootMessageId,
      acceptedRunId: identity.runId,
      ...(!candidateConflicts && pending.acceptedRequestContextId ? { acceptedRequestContextId: pending.acceptedRequestContextId } : {}),
      httpIdentityConfirmed: true,
    },
    previousRootMessageId,
    previousRunId,
  };
}

function applyPendingConversationProjection(pending: PendingRequest): void {
  if (pending.kind === 'retry') {
    const sourceRootMessageId = pending.retrySourceRootMessageId;
    if (!sourceRootMessageId || !pending.acceptedRunId) {
      return;
    }
    useConversationStore.getState().selectRetryAttemptForRoot(pending.sessionId, sourceRootMessageId, pending.acceptedRunId);
    if (pending.acceptedRootMessageId && pending.acceptedRequestContextId) {
      useConversationStore.getState().reconcileOptimisticRequest(pending.sessionId, sourceRootMessageId, {
        rootMessageId: pending.acceptedRootMessageId,
        runId: pending.acceptedRunId,
        requestContextId: pending.acceptedRequestContextId,
        ...(pending.acceptedAt ? { acceptedAt: pending.acceptedAt } : {}),
      });
    }
    return;
  }
  if (!pending.optimisticRequestId || !pending.acceptedRootMessageId || !pending.acceptedRunId || !pending.acceptedRequestContextId) {
    return;
  }
  useConversationStore.getState().reconcileOptimisticRequest(pending.sessionId, pending.optimisticRequestId, {
    rootMessageId: pending.acceptedRootMessageId,
    runId: pending.acceptedRunId,
    requestContextId: pending.acceptedRequestContextId,
    ...(pending.acceptedAt ? { acceptedAt: pending.acceptedAt } : {}),
  });
}

function reconcilePendingHttpIdentity(
  pending: PendingRequest,
  previousRootMessageId: string | null = null,
  previousRunId: string | null = null,
): PendingRequest {
  if (!pending.optimisticRequestId || !pending.acceptedRootMessageId || !pending.acceptedRunId) {
    return pending;
  }
  const acceptedRequestContextId = useConversationStore.getState().reconcileOptimisticRequest(pending.sessionId, pending.optimisticRequestId, {
    rootMessageId: pending.acceptedRootMessageId,
    runId: pending.acceptedRunId,
    ...(previousRootMessageId ? { previousRootMessageId } : {}),
    ...(previousRunId ? { previousRunId } : {}),
    ...(pending.acceptedAt ? { acceptedAt: pending.acceptedAt } : {}),
  });
  if (!acceptedRequestContextId || pending.acceptedRequestContextId) {
    return pending;
  }
  return {
    ...pending,
    acceptedRequestContextId,
  };
}

function isCurrentPendingRequest(
  pending: PendingRequest | null,
  kind: PendingRequestKind,
  sessionId: string,
  idempotencyKey: string,
): pending is PendingRequest {
  return Boolean(pending && pending.kind === kind && pending.sessionId === sessionId && pending.idempotencyKey === idempotencyKey);
}

function isRecentPendingEnvelope(pending: PendingRequest, envelope: StreamEnvelope): boolean {
  if (pending.sessionId !== envelope.sessionId) {
    return false;
  }
  return true;
}

function isReplayOrLocalEnvelope(envelope: StreamEnvelope): boolean {
  return envelope.transportHints.includes('history-load') || envelope.transportHints.includes('local-optimistic');
}

interface TerminalRequestIdentity {
  readonly eventType: TerminalStreamEventType;
  readonly requestId: string | null;
  readonly rootMessageId: string | null;
  readonly attemptId: string | null;
  readonly runId: string | null;
}

function toTerminalRequestIdentity(
  eventOrEnvelope: TerminalStreamEventType | StreamEnvelope,
  fallbackRootMessageId?: string | null,
): TerminalRequestIdentity | null {
  if (typeof eventOrEnvelope === 'string') {
    return {
      eventType: eventOrEnvelope,
      requestId: fallbackRootMessageId ?? null,
      rootMessageId: fallbackRootMessageId ?? null,
      attemptId: fallbackRootMessageId ?? null,
      runId: fallbackRootMessageId ?? null,
    };
  }
  if (!isTerminalStreamEvent(eventOrEnvelope.eventType)) {
    return null;
  }
  const rootMessageId = getEnvelopeRootMessageId(eventOrEnvelope);
  const attemptId = getEnvelopeAttemptId(eventOrEnvelope);
  const runId = getEnvelopeRunId(eventOrEnvelope);
  return {
    eventType: eventOrEnvelope.eventType as TerminalStreamEventType,
    requestId: eventOrEnvelope.requestId ?? null,
    rootMessageId,
    attemptId,
    runId,
  };
}

function terminalMatchesIdentity(terminal: TerminalRequestIdentity, identity?: string | null): boolean {
  const normalized = identity?.trim();
  return Boolean(
    normalized &&
    (normalized === terminal.requestId ||
      normalized === terminal.rootMessageId ||
      normalized === terminal.attemptId ||
      normalized === terminal.runId),
  );
}

function terminalMatchesPendingRequest(terminal: TerminalRequestIdentity, pending: PendingRequest | null): boolean {
  if (!pending) {
    return false;
  }
  if (pending.httpIdentityConfirmed === false) {
    return false;
  }
  if (pending.acceptedRootMessageId || pending.acceptedRunId || pending.acceptedRequestContextId) {
    return (
      (!pending.acceptedRootMessageId ||
        terminal.rootMessageId === pending.acceptedRootMessageId ||
        terminal.requestId === pending.acceptedRootMessageId) &&
      (!pending.acceptedRunId || terminal.runId === pending.acceptedRunId) &&
      (!pending.acceptedRequestContextId || terminal.attemptId === pending.acceptedRequestContextId)
    );
  }
  return terminalMatchesIdentity(terminal, pending.optimisticRequestId);
}

async function refreshSessionSnapshot(sessionId: string): Promise<void> {
  await Promise.allSettled([
    useSessionStore.getState().loadSessions(),
    useConversationStore.getState().loadConversation(sessionId, { background: true }),
  ]);
}

interface RequestState {
  isSubmittingRequest: boolean;
  activeRequestRootMessageId: string | null;
  activeRequestSessionId: string | null;
  requestStatus: RequestStatus;
  lastIdempotencyKey: string | null;
  retryLimitReachedFor: { readonly sessionId: string; readonly requestId: string } | null;
  retryLimitNotice: RequestNotice | null;
  submitError: RequestNotice | null;
  cancelError: RequestNotice | null;
  retryError: RequestNotice | null;
  editError: RequestNotice | null;
  lastSubmittedInput: string;
  lastSubmittedAttachments: readonly File[];
  uploadError: RequestNotice | null;
  draftBeforeEdit: string | null;
  pendingRequest: PendingRequest | null;
}

interface RequestActions {
  setSubmittingRequest: (submitting: boolean) => void;
  setActiveRequestRootMessageId: (rootMessageId: string | null) => void;
  setRequestStatus: (status: RequestStatus) => void;
  clearRequestNotices: () => void;
  setDraftBeforeEdit: (draft: string) => void;
  clearDraftBeforeEdit: () => void;
  settleRequestFromTerminal: (eventOrEnvelope: TerminalStreamEventType | StreamEnvelope, rootMessageId?: string | null) => boolean;
  acceptRequestFromStream: (envelope: StreamEnvelope) => boolean;
  clearRetryLimitNotice: () => void;
  reconcilePendingRequestFromLiveEnvelope: (envelope: StreamEnvelope) => boolean;
  submitRequest: (inputText: string, attachments?: readonly File[], targetSkill?: string) => Promise<void>;
  submitRequestWithAttachments: (
    inputText: string,
    attachments: readonly TempFileRef[],
    attachmentSummaries?: ReadonlyArray<{ readonly fileName: string; readonly mediaType: string; readonly sizeBytes: number }>,
    targetSkill?: string,
  ) => Promise<void>;
  hydrateFromActiveRun: (sessionId: string, requestId: string) => void;
  settleStaleSessionRequest: (sessionId: string) => boolean;
  cancelRequest: (targetRequestId?: string) => Promise<void>;
  retryRequest: (targetRootMessageId?: string) => Promise<RequestAccepted | null>;
  editRequest: (
    inputText: string,
    attachments?: readonly File[],
    targetRequestIdentity?: string,
    visibleRootMessageId?: string,
    options?: EditRequestOptions,
  ) => Promise<RequestAccepted | null>;
}

interface EditRequestOptions {
  readonly targetSkill?: string;
  readonly sourceInputText?: string;
}

type RequestStore = RequestState & RequestActions;

function normalizeRequestError(error: unknown): Error {
  if (error instanceof Error) {
    return error;
  }
  return new Error(getRequestErrorMessage(error, i18n.t('requestNotices.submitFailed')), { cause: error });
}

export const useRequestStore = create<RequestStore>((set, get) => ({
  isSubmittingRequest: false,
  activeRequestRootMessageId: null,
  activeRequestSessionId: null,
  requestStatus: 'idle',
  lastIdempotencyKey: null,
  retryLimitReachedFor: null,
  retryLimitNotice: null,
  submitError: null,
  cancelError: null,
  retryError: null,
  editError: null,
  lastSubmittedInput: '',
  lastSubmittedAttachments: [],
  uploadError: null,
  draftBeforeEdit: null,
  pendingRequest: null,

  setSubmittingRequest: (submitting) => {
    set({ isSubmittingRequest: submitting });
  },

  setActiveRequestRootMessageId: (rootMessageId) => {
    set({ activeRequestRootMessageId: rootMessageId });
  },

  setRequestStatus: (status) => {
    set({ requestStatus: status });
  },

  clearRequestNotices: () => {
    set({
      submitError: null,
      cancelError: null,
      retryError: null,
      retryLimitNotice: null,
      editError: null,
      uploadError: null,
    });
  },

  setDraftBeforeEdit: (draft) => {
    set({ draftBeforeEdit: draft });
  },

  clearDraftBeforeEdit: () => {
    set({ draftBeforeEdit: null });
  },

  submitRequest: async (inputText: string, attachments?: readonly File[], targetSkill?: string) => {
    const sessionId = useSessionStore.getState().activeSessionId;
    const normalizedInput = inputText.trim();

    if (!sessionId) {
      throw new Error('No active session is selected.');
    }
    if (!normalizedInput) {
      return;
    }

    const clientRequestId = crypto.randomUUID();
    const idempotencyKey = crypto.randomUUID();
    const optimisticContent = stripDirectives(normalizedInput);
    const parsedDirective = parseDirectiveTarget(normalizedInput);
    const optimisticTargetSkill = targetSkill ?? (parsedDirective?.kind === 'skill' ? parsedDirective.name : undefined);
    const tempUserEnvelope: StreamEnvelope = {
      eventId: `temp-${clientRequestId}`,
      sessionId,
      requestId: clientRequestId,
      sequence: 0,
      eventType: 'REQUEST_ACCEPTED',
      payload: {
        content: optimisticContent,
        text: optimisticContent,
        contentType: 'PLAIN_TEXT',
        metadata: {
          accumulated: true,
          ...(optimisticTargetSkill === undefined ? {} : { targetSkill: optimisticTargetSkill }),
        },
        role: 'USER',
        messageId: clientRequestId,
        rootMessageId: clientRequestId,
        ...(attachments === undefined || attachments.length === 0
          ? {}
          : {
              attachments: attachments.map((file) => ({
                fileName: file.name,
                mediaType: deriveAttachmentMediaType(file.name),
                sizeBytes: file.size,
              })),
            }),
      },
      timelineEventRef: null,
      transportHints: ['local-optimistic'],
      createdAt: '',
    };
    useConversationStore.getState().appendEnvelope(sessionId, tempUserEnvelope);

    set({
      isSubmittingRequest: true,
      requestStatus: 'submitting',
      activeRequestSessionId: sessionId,
      activeRequestRootMessageId: null,
      lastIdempotencyKey: null,
      lastSubmittedInput: normalizedInput,
      lastSubmittedAttachments: attachments ?? [],
      pendingRequest: {
        kind: 'submit',
        sessionId,
        idempotencyKey,
        startedAtMs: Date.now(),
        optimisticRequestId: clientRequestId,
        httpIdentityConfirmed: false,
      },
      submitError: null,
    });
    useConversationStore.getState().setConversationError(null);
    sessionStorage.setItem(`draft-${sessionId}`, normalizedInput);

    try {
      const stagedAttachments =
        attachments === undefined || attachments.length === 0 ? [] : await requestService.stageAttachments(sessionId, attachments);
      const accepted = await requestService.submitRequest(sessionId, {
        inputText: normalizedInput,
        locale: getCurrentLocale(),
        idempotencyKey,
        ...(stagedAttachments.length === 0 ? {} : { attachments: stagedAttachments }),
        ...(targetSkill === undefined ? {} : { targetSkill }),
      });
      const pending = get().pendingRequest;
      if (!isCurrentPendingRequest(pending, 'submit', sessionId, idempotencyKey)) {
        sessionStorage.removeItem(`draft-${sessionId}`);
        return;
      }
      const acceptedFallback = accepted.requestId ?? pending.acceptedRootMessageId ?? clientRequestId;
      const acceptedRootMessageId = resolveAcceptedRootMessageId(accepted, acceptedFallback);
      const acceptedRunId = resolveAcceptedRunId(accepted, acceptedFallback);
      const httpIdentity = mergePendingHttpIdentity(pending, {
        rootMessageId: acceptedRootMessageId,
        runId: acceptedRunId,
      });
      const mergedPending = reconcilePendingHttpIdentity(httpIdentity.pending, httpIdentity.previousRootMessageId, httpIdentity.previousRunId);
      set({
        requestStatus: 'accepted',
        activeRequestRootMessageId: acceptedRootMessageId,
        activeRequestSessionId: sessionId,
        lastIdempotencyKey: idempotencyKey,
        lastSubmittedInput: normalizedInput,
        lastSubmittedAttachments: attachments ?? [],
        pendingRequest: mergedPending,
        submitError: null,
        retryLimitReachedFor: null,
      });
      useConversationStore.getState().clearForkNotice(sessionId);

      sessionStorage.removeItem(`draft-${sessionId}`);
      await useSessionStore.getState().loadSessions();
    } catch (error) {
      const pending = get().pendingRequest;
      if (!isCurrentPendingRequest(pending, 'submit', sessionId, idempotencyKey)) {
        throw normalizeRequestError(error);
      }

      if (isApiError(error) && error.code === 'GUARD_INPUT_BLOCKED') {
        // The backend persists the blocked round as a server-side
        // visible=true + modelVisibility.excluded safe marker pair
        // (recordInputGuardBlock), so the authoritative user input + refusal
        // come from conversation on the next load. Roll back the optimistic
        // user envelope so it does not duplicate the server-persisted round.
        // The refusal is rendered only as the turn's GuardBlockedNotice in
        // the message list (conversationAdapter projects the persisted
        // refusal as OUTPUT_GUARD_BLOCKED) — do NOT set submitError, which
        // would duplicate the refusal text as a composer inline notice.
        // Clear the sessionStorage draft (mirrors the success path) so the
        // composer does not rehydrate the blocked input.
        sessionStorage.removeItem(`draft-${sessionId}`);
        useConversationStore.getState().removeRequestEnvelopes(sessionId, clientRequestId);
        set({
          requestStatus: 'failed',
          pendingRequest: null,
        });
        return;
      }

      if (!pending.acceptedRunId && !pending.acceptedRequestContextId) {
        useConversationStore.getState().removeRequestEnvelopes(sessionId, clientRequestId);
      }

      if (isConflictError(error)) {
        await refreshSessionSnapshot(sessionId);
        set({
          requestStatus: 'failed',
          pendingRequest: null,
          submitError: createNotice('warning', i18n.t('requestNotices.sessionChanged')),
        });
        throw normalizeRequestError(error);
      }

      if (isAttachmentEmptyError(error)) {
        set({
          requestStatus: 'failed',
          pendingRequest: null,
          submitError: createNotice('warning', i18n.t('requestNotices.attachmentEmpty')),
        });
        throw normalizeRequestError(error);
      }

      if (isAttachmentError(error)) {
        set({
          requestStatus: 'failed',
          pendingRequest: null,
          submitError: createNotice('warning', attachmentErrorNotice(error)),
        });
        throw normalizeRequestError(error);
      }

      if (isNetworkError(error)) {
        set({
          requestStatus: 'failed',
          pendingRequest: null,
          submitError: createNotice('error', i18n.t('requestNotices.networkFailure')),
        });
        throw normalizeRequestError(error);
      }

      const skillFailureNotice = skillRoutingFailureNotice(error, optimisticTargetSkill);
      if (skillFailureNotice !== null) {
        set({
          requestStatus: 'failed',
          pendingRequest: null,
          submitError: createNotice('warning', skillFailureNotice),
        });
        throw normalizeRequestError(error);
      }

      set({
        requestStatus: 'failed',
        pendingRequest: null,
        submitError: createNotice('error', getRequestErrorMessage(error, i18n.t('requestNotices.submitFailed'))),
      });
      throw normalizeRequestError(error);
    } finally {
      set({ isSubmittingRequest: false });
    }
  },

  submitRequestWithAttachments: async (
    inputText: string,
    stagedAttachments: readonly TempFileRef[],
    attachmentSummaries?: ReadonlyArray<{ readonly fileName: string; readonly mediaType: string; readonly sizeBytes: number }>,
    targetSkill?: string,
  ) => {
    const sessionId = useSessionStore.getState().activeSessionId;
    const normalizedInput = inputText.trim();

    if (!sessionId) {
      throw new Error('No active session is selected.');
    }
    if (!normalizedInput) {
      return;
    }

    const clientRequestId = crypto.randomUUID();
    const idempotencyKey = crypto.randomUUID();
    const optimisticContent = stripDirectives(normalizedInput);
    const parsedDirective = parseDirectiveTarget(normalizedInput);
    const optimisticTargetSkill = targetSkill ?? (parsedDirective?.kind === 'skill' ? parsedDirective.name : undefined);
    const tempUserEnvelope: StreamEnvelope = {
      eventId: `temp-${clientRequestId}`,
      sessionId,
      requestId: clientRequestId,
      sequence: 0,
      eventType: 'REQUEST_ACCEPTED',
      payload: {
        content: optimisticContent,
        text: optimisticContent,
        contentType: 'PLAIN_TEXT',
        metadata: {
          accumulated: true,
          ...(optimisticTargetSkill === undefined ? {} : { targetSkill: optimisticTargetSkill }),
        },
        role: 'USER',
        messageId: clientRequestId,
        rootMessageId: clientRequestId,
        ...(attachmentSummaries === undefined || attachmentSummaries.length === 0 ? {} : { attachments: [...attachmentSummaries] }),
      },
      timelineEventRef: null,
      transportHints: ['local-optimistic'],
      createdAt: '',
    };
    useConversationStore.getState().appendEnvelope(sessionId, tempUserEnvelope);

    set({
      isSubmittingRequest: true,
      requestStatus: 'submitting',
      activeRequestSessionId: sessionId,
      activeRequestRootMessageId: null,
      lastIdempotencyKey: null,
      lastSubmittedInput: normalizedInput,
      lastSubmittedAttachments: [],
      pendingRequest: {
        kind: 'submit',
        sessionId,
        idempotencyKey,
        startedAtMs: Date.now(),
        optimisticRequestId: clientRequestId,
        httpIdentityConfirmed: false,
      },
      submitError: null,
    });
    useConversationStore.getState().setConversationError(null);
    sessionStorage.setItem(`draft-${sessionId}`, normalizedInput);

    try {
      const accepted = await requestService.submitRequest(sessionId, {
        inputText: normalizedInput,
        locale: getCurrentLocale(),
        idempotencyKey,
        attachments: stagedAttachments,
        ...(targetSkill === undefined ? {} : { targetSkill }),
      });
      const pending = get().pendingRequest;
      if (!isCurrentPendingRequest(pending, 'submit', sessionId, idempotencyKey)) {
        sessionStorage.removeItem(`draft-${sessionId}`);
        return;
      }
      const acceptedFallback = accepted.requestId ?? pending.acceptedRootMessageId ?? clientRequestId;
      const acceptedRootMessageId = resolveAcceptedRootMessageId(accepted, acceptedFallback);
      const acceptedRunId = resolveAcceptedRunId(accepted, acceptedFallback);
      const httpIdentity = mergePendingHttpIdentity(pending, {
        rootMessageId: acceptedRootMessageId,
        runId: acceptedRunId,
      });
      const mergedPending = reconcilePendingHttpIdentity(httpIdentity.pending, httpIdentity.previousRootMessageId, httpIdentity.previousRunId);
      set({
        requestStatus: 'accepted',
        activeRequestRootMessageId: acceptedRootMessageId,
        activeRequestSessionId: sessionId,
        lastIdempotencyKey: idempotencyKey,
        lastSubmittedInput: normalizedInput,
        lastSubmittedAttachments: [],
        retryLimitReachedFor: null,
        pendingRequest: mergedPending,
        submitError: null,
      });
      useConversationStore.getState().clearForkNotice(sessionId);

      sessionStorage.removeItem(`draft-${sessionId}`);
      await useSessionStore.getState().loadSessions();
    } catch (error) {
      const pending = get().pendingRequest;
      if (!isCurrentPendingRequest(pending, 'submit', sessionId, idempotencyKey)) {
        throw normalizeRequestError(error);
      }

      if (isApiError(error) && error.code === 'GUARD_INPUT_BLOCKED') {
        // Backend persists the blocked round as a visible=true + modelVisibility.excluded
        // safe marker pair; roll back the optimistic envelope. The refusal renders only
        // as the turn's GuardBlockedNotice in the message list — do NOT set submitError
        // (would duplicate the refusal as a composer inline notice). Clear the
        // sessionStorage draft so the composer does not rehydrate the blocked input.
        sessionStorage.removeItem(`draft-${sessionId}`);
        useConversationStore.getState().removeRequestEnvelopes(sessionId, clientRequestId);
        set({
          requestStatus: 'failed',
          pendingRequest: null,
        });
        return;
      }

      if (!pending.acceptedRunId && !pending.acceptedRequestContextId) {
        useConversationStore.getState().removeRequestEnvelopes(sessionId, clientRequestId);
      }
      if (isNetworkError(error)) {
        set({
          requestStatus: 'failed',
          pendingRequest: null,
          submitError: createNotice('error', i18n.t('requestNotices.networkFailure')),
        });
        throw normalizeRequestError(error);
      }
      const skillFailureNotice = skillRoutingFailureNotice(error, optimisticTargetSkill);
      if (skillFailureNotice !== null) {
        set({
          requestStatus: 'failed',
          pendingRequest: null,
          submitError: createNotice('warning', skillFailureNotice),
        });
        throw normalizeRequestError(error);
      }
      set({
        requestStatus: 'failed',
        pendingRequest: null,
        submitError: createNotice('error', getRequestErrorMessage(error, i18n.t('requestNotices.submitFailed'))),
      });
      throw normalizeRequestError(error);
    } finally {
      set({ isSubmittingRequest: false });
    }
  },

  settleRequestFromTerminal: (eventOrEnvelope, rootMessageId) => {
    const terminal = toTerminalRequestIdentity(eventOrEnvelope, rootMessageId);
    if (!terminal) {
      return false;
    }

    const state = get();
    const currentRootMessageId = state.activeRequestRootMessageId;
    const pending = state.pendingRequest;
    const matchesPending = terminalMatchesPendingRequest(terminal, pending);
    const matchesActive = terminalMatchesIdentity(terminal, currentRootMessageId);
    if (pending ? !matchesPending : !matchesActive) {
      return false;
    }

    if (terminal.eventType === 'REQUEST_COMPLETED' || terminal.eventType === 'REQUEST_SUPERSEDED') {
      set({
        isSubmittingRequest: false,
        requestStatus: 'idle',
        activeRequestRootMessageId: null,
        activeRequestSessionId: null,
        pendingRequest: null,
        submitError: null,
        cancelError: null,
        retryError: null,
        editError: null,
      });
      return true;
    }

    set({
      isSubmittingRequest: false,
      requestStatus: terminal.eventType === 'REQUEST_FAILED' ? 'failed' : 'canceled',
      activeRequestRootMessageId: terminal.rootMessageId ?? currentRootMessageId,
      pendingRequest: null,
      submitError: null,
    });
    return true;
  },

  clearRetryLimitNotice: () => {
    set({ retryLimitNotice: null });
  },

  acceptRequestFromStream: (envelope) => {
    if (envelope.eventType !== 'REQUEST_ACCEPTED' || isReplayOrLocalEnvelope(envelope)) {
      return false;
    }

    const pending = get().pendingRequest;
    if (
      !pending ||
      pending.sessionId !== envelope.sessionId ||
      (!pending.acceptedRootMessageId && !pending.acceptedRunId && !isRecentPendingEnvelope(pending, envelope))
    ) {
      return false;
    }

    const acceptedRootMessageId = getEnvelopeRootMessageId(envelope);
    const acceptedRunId = getEnvelopeRunId(envelope);
    const acceptedRequestContextId = readEnvelopeRequestContextId(envelope);
    if (!acceptedRootMessageId || !acceptedRunId || !acceptedRequestContextId) {
      return false;
    }
    if (
      pending.acceptedRootMessageId === acceptedRootMessageId &&
      pending.acceptedRunId === acceptedRunId &&
      pending.acceptedRequestContextId === acceptedRequestContextId
    ) {
      if (pending.acceptedAt) {
        return true;
      }
      const streamPending: PendingRequest = {
        ...pending,
        acceptedAt: envelope.createdAt,
      };
      applyPendingConversationProjection(streamPending);
      set({ pendingRequest: streamPending });
      return true;
    }
    const mergedPending = mergePendingIdentity(pending, {
      rootMessageId: acceptedRootMessageId,
      runId: acceptedRunId,
      requestContextId: acceptedRequestContextId,
    });
    if (!mergedPending) {
      return false;
    }

    const attempt = (envelope.payload as Record<string, unknown>).attempt;

    const streamPending: PendingRequest = {
      ...mergedPending,
      httpIdentityConfirmed: mergedPending.httpIdentityConfirmed ?? false,
      acceptedAt: envelope.createdAt,
    };
    applyPendingConversationProjection(streamPending);

    set({
      requestStatus: 'accepted',
      activeRequestRootMessageId: acceptedRootMessageId,
      activeRequestSessionId: pending.sessionId,
      lastIdempotencyKey: pending.idempotencyKey,
      pendingRequest: streamPending,
      ...(typeof attempt === 'number' && attempt >= MAX_REQUEST_ATTEMPTS
        ? { retryLimitReachedFor: { sessionId: pending.sessionId, requestId: acceptedRootMessageId } }
        : {}),
    });
    return true;
  },

  reconcilePendingRequestFromLiveEnvelope: (envelope) => {
    const state = get();
    const pending = state.pendingRequest;
    if (envelope.eventType === 'REQUEST_ACCEPTED') {
      return get().acceptRequestFromStream(envelope);
    }
    if (!pending || isReplayOrLocalEnvelope(envelope) || pending.sessionId !== envelope.sessionId) {
      return false;
    }

    const acceptedRootMessageId = getEnvelopeRootMessageId(envelope);
    const acceptedRunId = getEnvelopeRunId(envelope);
    const acceptedRequestContextId = readEnvelopeRequestContextId(envelope);
    if (
      !pending.acceptedRootMessageId ||
      !pending.acceptedRunId ||
      !acceptedRootMessageId ||
      !acceptedRunId ||
      !acceptedRequestContextId ||
      acceptedRootMessageId !== pending.acceptedRootMessageId ||
      acceptedRunId !== pending.acceptedRunId
    ) {
      return false;
    }
    if (pending.acceptedRequestContextId === acceptedRequestContextId) {
      return true;
    }
    const mergedPending = mergePendingIdentity(pending, {
      rootMessageId: acceptedRootMessageId,
      runId: acceptedRunId,
      requestContextId: acceptedRequestContextId,
    });
    if (!mergedPending) {
      return false;
    }
    applyPendingConversationProjection(mergedPending);

    set({
      requestStatus: 'accepted',
      activeRequestRootMessageId: acceptedRootMessageId,
      activeRequestSessionId: pending.sessionId,
      lastIdempotencyKey: pending.idempotencyKey,
      pendingRequest: mergedPending,
    });
    return true;
  },

  settleStaleSessionRequest: (sessionId) => {
    const state = get();
    if ((state.requestStatus !== 'accepted' && state.requestStatus !== 'submitting') || state.activeRequestSessionId !== sessionId) {
      return false;
    }
    set({
      isSubmittingRequest: false,
      requestStatus: 'idle',
      activeRequestRootMessageId: null,
      activeRequestSessionId: null,
      pendingRequest: null,
    });
    return true;
  },

  hydrateFromActiveRun: (sessionId, requestId) => {
    const state = get();
    if (state.requestStatus !== 'idle') {
      const trackedSessionId = state.activeRequestSessionId ?? state.pendingRequest?.sessionId ?? null;
      if (trackedSessionId === null || trackedSessionId === sessionId) {
        return;
      }
    }
    set({
      isSubmittingRequest: false,
      requestStatus: 'accepted',
      activeRequestRootMessageId: requestId,
      activeRequestSessionId: sessionId,
      pendingRequest: null,
    });
  },

  cancelRequest: async (targetRequestId?: string) => {
    if (targetRequestId !== undefined && typeof targetRequestId !== 'string') {
      targetRequestId = undefined;
    }
    const sessionId = useSessionStore.getState().activeSessionId;
    const state = get();
    const explicitTargetRequestId = typeof targetRequestId === 'string' ? targetRequestId.trim() || null : null;
    if (
      state.pendingRequest?.httpIdentityConfirmed === false &&
      (explicitTargetRequestId === null || explicitTargetRequestId === state.pendingRequest.acceptedRootMessageId)
    ) {
      return;
    }
    const rootMessageId = explicitTargetRequestId ?? state.pendingRequest?.acceptedRootMessageId ?? state.activeRequestRootMessageId;

    if (!sessionId || !rootMessageId) {
      return;
    }

    const previousStatus = get().requestStatus;
    const idempotencyKey = readOrCreateControlIdempotencyKey('cancel', sessionId, rootMessageId);

    set({ requestStatus: 'canceling', cancelError: null });

    try {
      await requestService.cancelRequest(sessionId, rootMessageId, idempotencyKey);
      clearControlIdempotencyKey('cancel', sessionId, rootMessageId);
      set({
        isSubmittingRequest: false,
        requestStatus: 'canceled',
        activeRequestRootMessageId: rootMessageId,
        pendingRequest: null,
        lastIdempotencyKey: idempotencyKey,
        cancelError: null,
      });
      await refreshSessionSnapshot(sessionId);
    } catch (error) {
      if (isConflictError(error)) {
        await refreshSessionSnapshot(sessionId);
        clearControlIdempotencyKey('cancel', sessionId, rootMessageId);
        set({
          requestStatus: previousStatus,
          cancelError: createNotice('warning', i18n.t('requestNotices.requestStateChanged')),
        });
        return;
      }

      if (!shouldKeepControlIdempotencyKey(error)) {
        clearControlIdempotencyKey('cancel', sessionId, rootMessageId);
      }
      const message = getRequestErrorMessage(error, i18n.t('requestNotices.cancelFailed'));
      set({ requestStatus: previousStatus, cancelError: createNotice('error', message) });
    }
  },

  retryRequest: async (targetRootMessageId?: string) => {
    const sessionId = useSessionStore.getState().activeSessionId;
    const rootMessageId = targetRootMessageId ?? get().activeRequestRootMessageId;

    if (!sessionId || !rootMessageId) {
      return null;
    }

    const previousStatus = get().requestStatus;
    const idempotencyKey = readOrCreateControlIdempotencyKey('retry', sessionId, rootMessageId);

    set({
      requestStatus: 'retrying',
      activeRequestSessionId: sessionId,
      retryError: null,
      pendingRequest: {
        kind: 'retry',
        sessionId,
        idempotencyKey,
        startedAtMs: Date.now(),
        retrySourceRootMessageId: rootMessageId,
        httpIdentityConfirmed: false,
      },
    });

    try {
      const accepted = await requestService.retryRequest(sessionId, rootMessageId, idempotencyKey);
      const pending = get().pendingRequest;
      if (!isCurrentPendingRequest(pending, 'retry', sessionId, idempotencyKey)) {
        clearControlIdempotencyKey('retry', sessionId, rootMessageId);
        return accepted;
      }
      const acceptedRootMessageId = resolveAcceptedRootMessageId(accepted, rootMessageId);
      const acceptedRunId = resolveAcceptedRunId(accepted, rootMessageId);
      const httpIdentity = mergePendingHttpIdentity(pending, {
        rootMessageId: acceptedRootMessageId,
        runId: acceptedRunId,
      });
      const mergedPending = httpIdentity.pending;
      applyPendingConversationProjection(mergedPending);
      clearControlIdempotencyKey('retry', sessionId, rootMessageId);
      set({
        requestStatus: 'accepted',
        activeRequestRootMessageId: acceptedRootMessageId,
        activeRequestSessionId: sessionId,
        lastIdempotencyKey: idempotencyKey,
        ...(accepted.attempt >= MAX_REQUEST_ATTEMPTS ? { retryLimitReachedFor: { sessionId, requestId: acceptedRootMessageId } } : {}),
        pendingRequest: mergedPending,
      });
      await useSessionStore.getState().loadSessions();
      return accepted;
    } catch (error) {
      if (isRetryLimitError(error)) {
        clearControlIdempotencyKey('retry', sessionId, rootMessageId);
        set({
          requestStatus: previousStatus,
          pendingRequest: null,
          retryLimitReachedFor: { sessionId, requestId: rootMessageId },
          retryLimitNotice: createNotice('warning', i18n.t('requestNotices.retryLimitReached')),
        });
        throw normalizeRequestError(error);
      }

      if (isConflictError(error)) {
        await refreshSessionSnapshot(sessionId);
        clearControlIdempotencyKey('retry', sessionId, rootMessageId);
        set({
          requestStatus: previousStatus,
          pendingRequest: null,
          retryError: createNotice('warning', i18n.t('requestNotices.latestChangedForRetry')),
        });
        throw normalizeRequestError(error);
      }

      if (!shouldKeepControlIdempotencyKey(error)) {
        clearControlIdempotencyKey('retry', sessionId, rootMessageId);
      }
      const message = getRequestErrorMessage(error, i18n.t('requestNotices.retryFailed'));
      set({ requestStatus: previousStatus, pendingRequest: null, retryError: createNotice('error', message) });
      throw normalizeRequestError(error);
    }
  },

  editRequest: async (
    inputText: string,
    attachments?: readonly File[],
    targetRequestIdentity?: string,
    visibleRootMessageId?: string,
    options?: EditRequestOptions,
  ) => {
    const sessionId = useSessionStore.getState().activeSessionId;
    const rootMessageId = targetRequestIdentity ?? get().activeRequestRootMessageId;
    const normalizedInput = inputText.trim();
    const turnRootMessageId = visibleRootMessageId ?? targetRequestIdentity ?? rootMessageId;

    if (!sessionId || !rootMessageId) {
      return null;
    }
    if (!normalizedInput) {
      return null;
    }
    const hasAttachments = (attachments?.length ?? 0) > 0;
    const hasTargetSkill = Boolean(options?.targetSkill?.trim());
    if (!hasAttachments && !hasTargetSkill && typeof options?.sourceInputText === 'string' && normalizedInput === options.sourceInputText.trim()) {
      set({ editError: createNotice('warning', i18n.t('requestNotices.editUnchanged')) });
      return null;
    }

    const previousStatus = get().requestStatus;
    const idempotencyKey = crypto.randomUUID();
    const clientRequestId = crypto.randomUUID();

    if (turnRootMessageId) {
      useConversationStore.getState().optimisticallyEditRoot(sessionId, turnRootMessageId, normalizedInput, clientRequestId);
    }

    set({
      requestStatus: 'editing',
      activeRequestSessionId: sessionId,
      editError: null,
      lastSubmittedInput: normalizedInput,
      lastSubmittedAttachments: attachments ?? [],
      pendingRequest: {
        kind: 'edit',
        sessionId,
        idempotencyKey,
        startedAtMs: Date.now(),
        optimisticRequestId: clientRequestId,
        httpIdentityConfirmed: false,
      },
    });

    try {
      const accepted = await requestService.editRequest(sessionId, rootMessageId, normalizedInput, attachments, idempotencyKey, options?.targetSkill);
      const pending = get().pendingRequest;
      if (!isCurrentPendingRequest(pending, 'edit', sessionId, idempotencyKey)) {
        return accepted;
      }
      const acceptedFallback = accepted.requestId ?? pending.acceptedRootMessageId ?? rootMessageId;
      const acceptedRootMessageId = resolveAcceptedRootMessageId(accepted, acceptedFallback);
      const acceptedRunId = resolveAcceptedRunId(accepted, acceptedFallback);
      const httpIdentity = mergePendingHttpIdentity(pending, {
        rootMessageId: acceptedRootMessageId,
        runId: acceptedRunId,
      });
      const mergedPending = reconcilePendingHttpIdentity(httpIdentity.pending, httpIdentity.previousRootMessageId, httpIdentity.previousRunId);
      set({
        requestStatus: 'accepted',
        activeRequestRootMessageId: acceptedRootMessageId,
        activeRequestSessionId: sessionId,
        lastIdempotencyKey: idempotencyKey,
        lastSubmittedInput: normalizedInput,
        lastSubmittedAttachments: attachments ?? [],
        retryLimitReachedFor: null,
        pendingRequest: mergedPending,
      });
      await useSessionStore.getState().loadSessions();
      return accepted;
    } catch (error) {
      const pending = get().pendingRequest;
      if (!isCurrentPendingRequest(pending, 'edit', sessionId, idempotencyKey)) {
        throw normalizeRequestError(error);
      }
      if (turnRootMessageId && !pending.acceptedRunId && !pending.acceptedRequestContextId) {
        useConversationStore.getState().rollbackOptimisticEdit(sessionId, turnRootMessageId, clientRequestId);
      }

      if (isAttachmentEmptyError(error)) {
        set({
          requestStatus: previousStatus,
          pendingRequest: null,
          editError: createNotice('warning', i18n.t('requestNotices.attachmentEmpty')),
        });
        throw normalizeRequestError(error);
      }

      if (isAttachmentError(error)) {
        set({
          requestStatus: previousStatus,
          pendingRequest: null,
          editError: createNotice('warning', attachmentErrorNotice(error)),
        });
        throw normalizeRequestError(error);
      }

      if (isConflictError(error)) {
        await refreshSessionSnapshot(sessionId);
        set({
          requestStatus: previousStatus,
          pendingRequest: null,
          editError: createNotice('warning', i18n.t('requestNotices.editLatestChanged')),
        });
        throw normalizeRequestError(error);
      }

      const message = getRequestErrorMessage(error, i18n.t('requestNotices.editFailed'));
      set({ requestStatus: previousStatus, pendingRequest: null, editError: createNotice('error', message) });
      throw normalizeRequestError(error);
    }
  },
}));

export const useIsSubmittingRequest = () => useRequestStore((s) => s.isSubmittingRequest);
export const useRequestStatus = () => useRequestStore((s) => s.requestStatus);
export const useActiveRequestRootMessageId = () => useRequestStore((s) => s.activeRequestRootMessageId);
export const useLastIdempotencyKey = () => useRequestStore((s) => s.lastIdempotencyKey);
export const useSubmitErrorNotice = () => useRequestStore((s) => s.submitError);
export const useCancelErrorNotice = () => useRequestStore((s) => s.cancelError);
export const useRetryErrorNotice = () => useRequestStore((s) => s.retryError);
export const useEditErrorNotice = () => useRequestStore((s) => s.editError);
export const useCancelError = () => useRequestStore((s) => s.cancelError?.message ?? null);
export const useRetryError = () => useRequestStore((s) => s.retryError?.message ?? null);
export const useEditError = () => useRequestStore((s) => s.editError?.message ?? null);
export const useLastSubmittedInput = () => useRequestStore((s) => s.lastSubmittedInput);
export const useLastSubmittedAttachments = () => useRequestStore((s) => s.lastSubmittedAttachments);
export const useUploadErrorNotice = () => useRequestStore((s) => s.uploadError);
export const useUploadError = () => useRequestStore((s) => s.uploadError?.message ?? null);
export const useDraftBeforeEdit = () => useRequestStore((s) => s.draftBeforeEdit);
