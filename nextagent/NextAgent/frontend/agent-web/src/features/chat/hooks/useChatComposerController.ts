import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { type ComposerAttachmentView, validateAttachmentSelection, deriveAttachmentMediaType } from '../../composer/attachmentRules.ts';
import { deriveAcceptedExtensions } from '../../composer/attachmentRules.ts';
import { requestService, type StagedAttachmentRef } from '../../../services/requestService.ts';
import { isApiError } from '../../../services/apiClient.ts';
import { sessionService } from '../../../services/sessionService.ts';
import { useConversationStore } from '../../../state/conversationStore.ts';
import { useRequestStore } from '../../../state/requestStore.ts';
import { useSessionStore } from '../../../state/sessionStore.ts';
import i18n, { getCurrentLocale } from '../../../i18n/index.ts';
import type { TurnBlock, IdentityContext } from '../../../state/contracts.ts';
import type { ChatNavigationAdapter } from '../chatNavigation.ts';
import { useSkillSelectionStore } from '../../../state/skillSelectionStore.ts';
import { activateCapabilityPresentationResources } from '../../../state/capabilityPresentationCoordinator.ts';

type ManagedComposerAttachment = ComposerAttachmentView & {
  readonly file: File;
  readonly stagedRef: StagedAttachmentRef | null;
};

export function buildLocalIdentityContext(): IdentityContext {
  return {
    tenantId: 'local',
    subjectId: 'local',
    displayName: 'local',
  };
}

export function buildSubmittedMessageHistory(turnBlocks: readonly TurnBlock[]): readonly string[] {
  return turnBlocks.map((block) => block.userMessage.content.trim()).filter((content) => content.length > 0);
}

type EditModeState = {
  readonly rootMessageId: string;
  readonly targetRequestId: string;
  readonly content: string;
} | null;

const NEW_SESSION_DRAFT_STORAGE_KEY = 'draft-__new__';
const COMPOSER_DRAFT_PERSIST_DEBOUNCE_MS = 250;

const INVALID_FILE_ERROR_CODES = new Set([
  'MAGIC_BYTES_MISMATCH',
  'MAGIC_BYTES_UNREADABLE',
  'FILE_NAME_INVALID',
  'FILE_TYPE_UNSUPPORTED',
  'FILE_CONTENT_INVALID',
  'ZIP_BOMB_DETECTED',
  'ZIP_SLIP_DETECTED',
  'UPLOAD_FILE_NAME_INVALID',
  'UPLOAD_PATH_TRAVERSAL',
  'FILE_TOO_LARGE',
]);

function isInvalidFileError(error: unknown): boolean {
  return isApiError(error) && error.code !== null && INVALID_FILE_ERROR_CODES.has(error.code);
}

const UPLOAD_ERROR_NOTICE_KEYS: Record<string, string> = {
  MAGIC_BYTES_MISMATCH: 'attachments.invalidFileContent',
  MAGIC_BYTES_UNREADABLE: 'attachments.magicBytesUnreadable',
  FILE_NAME_INVALID: 'attachments.invalidFileName',
  FILE_NAME_TOO_LONG: 'attachments.uploadFileNameTooLong',
  FILE_NAME_NO_EXTENSION: 'attachments.fileNameNoExtension',
  FILE_TYPE_UNSUPPORTED: 'attachments.invalidFileType',
  FILE_CONTENT_INVALID: 'attachments.invalidFileContent',
  ZIP_BOMB_SIZE_EXCEEDED: 'attachments.zipBombDetected',
  ZIP_SLIP_PATH_TRAVERSAL: 'attachments.zipSlipDetected',
  ZIP_SLIP_ABSOLUTE_PATH: 'attachments.zipSlipDetected',
  UPLOAD_FILE_NAME_INVALID: 'attachments.invalidFileName',
  UPLOAD_PATH_TRAVERSAL: 'attachments.uploadPathTraversal',
  FILE_TOO_LARGE: 'attachments.fileTooLarge',
  QUOTA_FREQUENCY_EXCEEDED: 'attachments.uploadFrequencyExceeded',
  QUOTA_SESSION_FILE_COUNT_EXCEEDED: 'attachments.sessionFileCountExceeded',
  QUOTA_USER_FILE_COUNT_EXCEEDED: 'attachments.userFileCountExceeded',
  QUOTA_USER_FILE_SIZE_EXCEEDED: 'attachments.userFileSizeExceeded',
  QUOTA_USER_TMP_SIZE_EXCEEDED: 'attachments.userTmpSizeExceeded',
  QUOTA_GLOBAL_TMP_EXCEEDED: 'attachments.globalTmpExceeded',
  DISK_SPACE_FULL: 'attachments.diskSpaceFull',
  TEMP_FILE_EXPIRED: 'attachments.tempFileExpired',
  UPLOAD_INTERNAL_ERROR: 'attachments.uploadInternalError',
};

function resolveUploadErrorNotice(error: unknown, fileName: string): string | null {
  if (!isApiError(error) || error.code === null) {
    return null;
  }
  const noticeKey = UPLOAD_ERROR_NOTICE_KEYS[error.code];
  if (noticeKey === undefined) {
    return null;
  }
  const config = runtimeConfig.chatUploadFileConfig;
  const types = deriveAcceptedExtensions(config?.chatUploadFileType).join(', ');
  const maxSizeMB = config?.chatUploadMaxFileSize ?? 10;
  return i18n.t(noticeKey, { fileName, types, maxSizeMB });
}

function readComposerSessionStorage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.sessionStorage;
  } catch {
    return null;
  }
}

export function buildComposerDraftStorageKey(sessionId?: string | null): string {
  return sessionId ? `draft-${sessionId}` : NEW_SESSION_DRAFT_STORAGE_KEY;
}

export function readCachedComposerDraft(sessionId?: string | null): string {
  try {
    return readComposerSessionStorage()?.getItem(buildComposerDraftStorageKey(sessionId)) ?? '';
  } catch {
    return '';
  }
}

export function writeCachedComposerDraft(sessionId: string | null | undefined, draft: string): void {
  try {
    const key = buildComposerDraftStorageKey(sessionId);
    const storage = readComposerSessionStorage();
    if (draft.length === 0) {
      storage?.removeItem(key);
      return;
    }
    storage?.setItem(key, draft);
  } catch {
    // A blocked sessionStorage should not break composer editing.
  }
}

interface UseChatComposerControllerParams {
  readonly navigation: ChatNavigationAdapter;
  readonly turnBlocks: readonly TurnBlock[];
}

interface UseChatComposerControllerResult {
  readonly composerHydratedInput: string;
  readonly composerInputVersion: number;
  readonly submittedMessageHistory: readonly string[];
  readonly editMode: EditModeState;
  readonly showEditSubmitNotice: boolean;
  readonly canRetryLatest: boolean;
  readonly showRetryLatestButton: boolean;
  readonly canEditLatest: boolean;
  readonly attachmentItems: readonly ComposerAttachmentView[];
  readonly attachmentNotice: string | null;
  readonly uploadExpireNotice: string | null;
  readonly setComposerDraft: (draft: string) => void;
  readonly hydrateComposerInput: (value: string) => void;
  readonly injectQuestion: (payload: { readonly question: string; readonly isSend?: boolean }) => Promise<boolean>;
  readonly clearEditSubmitNotice: () => void;
  readonly handleSend: (message: string) => Promise<void>;
  readonly handleAddAttachments: (files: File[]) => Promise<void>;
  readonly handleRemoveAttachment: (localId: string) => void;
  readonly handleRetryAttachment: (localId: string) => Promise<void>;
  readonly handleEditRequest: (rootMessageId: string) => void;
  readonly handleEditLatest: () => void;
  readonly handleCancelEdit: () => void;
  readonly handleRetryRequest: (rootMessageId: string) => Promise<void>;
  readonly handleRetryLatest: () => Promise<void>;
  readonly handleCancelRequest: (targetRequestId?: string) => Promise<void>;
  readonly handleClearConversation: () => void;
}

export function useChatComposerController({ navigation, turnBlocks }: UseChatComposerControllerParams): UseChatComposerControllerResult {
  const routeSessionId = navigation.sessionId;
  const setActiveSessionId = useSessionStore((s) => s.setActiveSessionId);

  const submitRequestWithAttachments = useRequestStore((s) => s.submitRequestWithAttachments);
  const draftBeforeEdit = useRequestStore((s) => s.draftBeforeEdit);
  const setDraftBeforeEdit = useRequestStore((s) => s.setDraftBeforeEdit);
  const clearDraftBeforeEdit = useRequestStore((s) => s.clearDraftBeforeEdit);
  const editRequest = useRequestStore((s) => s.editRequest);
  const retryRequest = useRequestStore((s) => s.retryRequest);
  const cancelRequest = useRequestStore((s) => s.cancelRequest);
  const clearConversation = useConversationStore((s) => s.clearConversation);

  const [composerHydratedInput, setComposerHydratedInput] = useState(() => readCachedComposerDraft(routeSessionId));
  const [composerInputVersion, setComposerInputVersion] = useState(0);
  const [editMode, setEditMode] = useState<EditModeState>(null);
  const [showEditSubmitNotice, setShowEditSubmitNotice] = useState(false);
  const [attachmentItems, setAttachmentItems] = useState<ManagedComposerAttachment[]>([]);
  const [attachmentNotice, setAttachmentNotice] = useState<string | null>(null);
  const [uploadExpireNotice, setUploadExpireNotice] = useState<string | null>(null);
  const [attachmentTimerEpoch, setAttachmentTimerEpoch] = useState(0);
  const firstUploadTimeRef = useRef<number | null>(null);
  const lastUploadTimeRef = useRef<number | null>(null);
  const attachmentItemsRef = useRef<readonly ManagedComposerAttachment[]>(attachmentItems);
  attachmentItemsRef.current = attachmentItems;

  const attachmentSessionIdRef = useRef<string | null>(routeSessionId);
  const composerTempRunIdRef = useRef<string | null>(null);
  const activeDraftSessionIdRef = useRef<string | null>(routeSessionId ?? null);
  const composerDraftRef = useRef(composerHydratedInput);
  const editModeRef = useRef<EditModeState>(null);
  const draftPersistTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const turnBlocksRef = useRef(turnBlocks);
  turnBlocksRef.current = turnBlocks;

  const latestTurnBlock = turnBlocks.at(-1) ?? null;
  const canRetryLatest = latestTurnBlock !== null && latestTurnBlock.forkInherited !== true;
  const showRetryLatestButton = latestTurnBlock?.status === 'FAILED' && latestTurnBlock.forkInherited !== true;
  const canEditLatest = latestTurnBlock !== null && latestTurnBlock.forkInherited !== true;
  const submittedMessageHistory = useMemo(() => buildSubmittedMessageHistory(turnBlocks), [turnBlocks]);

  useEffect(() => {
    const currentRouteSessionId = routeSessionId ?? null;
    if (attachmentItems.length === 0) {
      attachmentSessionIdRef.current = currentRouteSessionId;
      return;
    }

    if (attachmentSessionIdRef.current === currentRouteSessionId) {
      return;
    }

    setAttachmentItems([]);
    setAttachmentNotice(null);
    composerTempRunIdRef.current = null;
    attachmentSessionIdRef.current = currentRouteSessionId;
  }, [attachmentItems.length, routeSessionId]);

  // Upload expire timer reminders (D10)
  const expireAttachments = useCallback((noticeKey: 'attachments.idleExpired' | 'attachments.maxExpired') => {
    const items = attachmentItemsRef.current;
    if (items.length === 0) {
      return;
    }
    const sessionId = attachmentSessionIdRef.current;
    for (const item of items) {
      if (item.stagedRef !== null && sessionId !== null) {
        void requestService.deleteStagedAttachment(sessionId, item.stagedRef.tempRunId, item.stagedRef.fileName).catch(() => {});
      }
    }
    setAttachmentItems(items.map((i) => ({ ...i, status: 'expired' as const })));
    composerTempRunIdRef.current = null;
    setUploadExpireNotice(i18n.t(noticeKey));
  }, []);

  useEffect(() => {
    if (attachmentItems.length === 0) {
      firstUploadTimeRef.current = null;
      lastUploadTimeRef.current = null;
      setUploadExpireNotice(null);
      return undefined;
    }

    const config = runtimeConfig.chatUploadFileConfig;
    if (config === undefined) {
      return undefined;
    }

    const idleExpireMs = config.uploadFileIdleExpireTime * 60 * 1000;
    const maxExpireMs = config.uploadFileMaxExpireTime * 60 * 1000;
    const now = Date.now();

    if (firstUploadTimeRef.current === null) {
      firstUploadTimeRef.current = now;
    }
    lastUploadTimeRef.current = now;

    const idleTimer = setTimeout(() => {
      expireAttachments('attachments.idleExpired');
    }, idleExpireMs);

    const maxExpireAt = firstUploadTimeRef.current + maxExpireMs;
    const maxRemaining = maxExpireAt - now;
    const maxTimer =
      maxRemaining > 0
        ? setTimeout(() => {
            expireAttachments('attachments.maxExpired');
          }, maxRemaining)
        : null;

    const warningTimer = setTimeout(
      () => {
        setUploadExpireNotice(i18n.t('attachments.expiringSoon'));
      },
      Math.min(idleExpireMs * 0.8, maxRemaining > 0 ? maxRemaining * 0.8 : idleExpireMs * 0.8),
    );

    return () => {
      clearTimeout(idleTimer);
      if (maxTimer !== null) {
        clearTimeout(maxTimer);
      }
      clearTimeout(warningTimer);
    };
  }, [attachmentItems.length, attachmentTimerEpoch, expireAttachments]);

  useEffect(() => {
    editModeRef.current = editMode;
  }, [editMode]);

  const cancelPendingComposerDraftWrite = useCallback(() => {
    if (draftPersistTimerRef.current === null) {
      return;
    }
    clearTimeout(draftPersistTimerRef.current);
    draftPersistTimerRef.current = null;
  }, []);

  const writeComposerDraftNow = useCallback(
    (sessionId: string | null | undefined, draft: string) => {
      cancelPendingComposerDraftWrite();
      writeCachedComposerDraft(sessionId, draft);
    },
    [cancelPendingComposerDraftWrite],
  );

  const scheduleComposerDraftWrite = useCallback(
    (sessionId: string | null | undefined, draft: string) => {
      cancelPendingComposerDraftWrite();
      draftPersistTimerRef.current = setTimeout(() => {
        draftPersistTimerRef.current = null;
        writeCachedComposerDraft(sessionId, draft);
      }, COMPOSER_DRAFT_PERSIST_DEBOUNCE_MS);
    },
    [cancelPendingComposerDraftWrite],
  );

  const setComposerDraftValue = useCallback((draft: string) => {
    composerDraftRef.current = draft;
  }, []);

  const hydrateComposerInputValue = useCallback(
    (value: string, options?: { readonly persist?: boolean }) => {
      setComposerHydratedInput(value);
      setComposerInputVersion((version) => version + 1);
      setComposerDraftValue(value);
      if (options?.persist !== false) {
        writeComposerDraftNow(routeSessionId, value);
      }
    },
    [routeSessionId, setComposerDraftValue, writeComposerDraftNow],
  );

  const hydrateComposerInput = useCallback(
    (value: string) => {
      hydrateComposerInputValue(value);
    },
    [hydrateComposerInputValue],
  );

  const handleComposerDraftChange = useCallback(
    (draft: string) => {
      setComposerDraftValue(draft);
      if (!editMode) {
        scheduleComposerDraftWrite(routeSessionId, draft);
      }
    },
    [editMode, routeSessionId, scheduleComposerDraftWrite, setComposerDraftValue],
  );

  useEffect(() => {
    const nextSessionId = routeSessionId ?? null;
    const previousSessionId = activeDraftSessionIdRef.current;
    if (previousSessionId === nextSessionId) {
      return;
    }

    writeComposerDraftNow(previousSessionId, editMode ? (useRequestStore.getState().draftBeforeEdit ?? '') : composerDraftRef.current);
    activeDraftSessionIdRef.current = nextSessionId;

    if (editMode) {
      setEditMode(null);
      clearDraftBeforeEdit();
    }
    setShowEditSubmitNotice(false);
    hydrateComposerInputValue(readCachedComposerDraft(nextSessionId), { persist: false });
  }, [clearDraftBeforeEdit, editMode, hydrateComposerInputValue, routeSessionId, writeComposerDraftNow]);

  useEffect(() => {
    return () => {
      if (draftPersistTimerRef.current === null) {
        return;
      }
      clearTimeout(draftPersistTimerRef.current);
      draftPersistTimerRef.current = null;
      if (!editModeRef.current) {
        writeCachedComposerDraft(activeDraftSessionIdRef.current, composerDraftRef.current);
      }
    };
  }, []);

  const clearEditSubmitNotice = useCallback(() => {
    setShowEditSubmitNotice(false);
  }, []);

  const ensureComposerSession = useCallback(async (): Promise<string> => {
    let currentSessionId = routeSessionId;

    if (!currentSessionId) {
      // The user is on the new-session route. Create a session asynchronously.
      // While awaiting, the user may click a sidebar session and navigate away.
      // After the await, check the store's activeSessionId: if it became non-null,
      // the user navigated to an existing session — honor that instead of
      // overwriting it with the freshly created session.
      const handle = await sessionService.createSession({
        locale: getCurrentLocale(),
        idempotencyKey: crypto.randomUUID(),
      });
      const activeSessionIdNow = useSessionStore.getState().activeSessionId;
      if (activeSessionIdNow !== null && activeSessionIdNow !== handle.sessionId) {
        // User navigated to an existing session during the await; use it.
        currentSessionId = activeSessionIdNow;
      } else {
        currentSessionId = handle.sessionId;
        activateCapabilityPresentationResources(currentSessionId);
        attachmentSessionIdRef.current = currentSessionId;
        navigation.openSession(currentSessionId, { replace: true });
      }
    }

    if (useSessionStore.getState().activeSessionId !== currentSessionId) {
      setActiveSessionId(currentSessionId);
    }

    attachmentSessionIdRef.current = currentSessionId;
    return currentSessionId;
  }, [navigation, routeSessionId, setActiveSessionId]);

  const handleAddAttachments = useCallback(
    async (files: File[]) => {
      if (files.length === 0) {
        return;
      }

      const hasExpired = attachmentItems.some((item) => item.status === 'expired' || item.status === 'invalid');
      if (hasExpired) {
        setUploadExpireNotice(null);
        firstUploadTimeRef.current = null;
        lastUploadTimeRef.current = null;
        composerTempRunIdRef.current = null;
      }
      const validationError = validateAttachmentSelection(
        files,
        (hasExpired ? [] : attachmentItems).map((item) => item.file),
        runtimeConfig.chatUploadFileConfig,
      );
      if (validationError) {
        setAttachmentNotice(validationError);
        return;
      }

      setAttachmentNotice(null);
      setUploadExpireNotice(null);
      const currentSessionId = await ensureComposerSession();
      if (!currentSessionId) {
        return;
      }
      const tempRunId = composerTempRunIdRef.current ?? crypto.randomUUID();
      composerTempRunIdRef.current = tempRunId;
      setAttachmentTimerEpoch((epoch) => epoch + 1);

      const queuedItems = files.map<ManagedComposerAttachment>((file) => ({
        localId: crypto.randomUUID(),
        file,
        fileName: file.name,
        sizeBytes: file.size,
        status: 'uploading',
        progressPercent: 0,
        errorMessage: null,
        stagedRef: null,
      }));

      setAttachmentItems((items) => [...items.filter((i) => i.status !== 'expired' && i.status !== 'invalid'), ...queuedItems]);

      await Promise.all(
        queuedItems.map(async (item) => {
          try {
            const staged = await requestService.stageAttachment(currentSessionId, tempRunId, item.file, (percent) => {
              setAttachmentItems((items) => items.map((i) => (i.localId === item.localId ? { ...i, progressPercent: percent } : i)));
            });
            setAttachmentItems((items) =>
              items.map((i) =>
                i.localId === item.localId
                  ? {
                      ...i,
                      status: 'uploaded',
                      progressPercent: 100,
                      errorMessage: null,
                      stagedRef: { tempRunId: staged.tempRunId, fileName: staged.fileName },
                    }
                  : i,
              ),
            );
          } catch (error) {
            const friendlyNotice = resolveUploadErrorNotice(error, item.fileName);
            const message =
              friendlyNotice ?? (error instanceof Error ? error.message : i18n.t('attachments.uploadFailed', { fileName: item.fileName }));
            if (friendlyNotice !== null) {
              setAttachmentNotice(message);
              setAttachmentItems((items) =>
                items.map((i) =>
                  i.localId === item.localId
                    ? {
                        ...i,
                        status: 'invalid',
                        progressPercent: 0,
                        errorMessage: message,
                      }
                    : i,
                ),
              );
            } else {
              setAttachmentItems((items) =>
                items.map((i) =>
                  i.localId === item.localId
                    ? {
                        ...i,
                        status: 'error',
                        progressPercent: 0,
                        errorMessage: message,
                      }
                    : i,
                ),
              );
            }
          }
        }),
      );
    },
    [attachmentItems, ensureComposerSession],
  );

  const handleRemoveAttachment = useCallback((localId: string) => {
    setAttachmentNotice(null);
    setAttachmentItems((items) => {
      const item = items.find((i) => i.localId === localId);
      const sessionId = attachmentSessionIdRef.current;
      if (item !== undefined && item.stagedRef !== null && sessionId !== null) {
        void requestService.deleteStagedAttachment(sessionId, item.stagedRef.tempRunId, item.stagedRef.fileName).catch(() => {});
      }
      const remaining = items.filter((i) => i.localId !== localId);
      if (remaining.length === 0) {
        composerTempRunIdRef.current = null;
      }
      return remaining;
    });
  }, []);

  const handleRetryAttachment = useCallback(
    async (localId: string) => {
      setAttachmentNotice(null);
      const sessionId = attachmentSessionIdRef.current;
      const item = attachmentItems.find((i) => i.localId === localId);
      if (sessionId === null || item === undefined) {
        return;
      }

      const tempRunId = composerTempRunIdRef.current ?? crypto.randomUUID();
      composerTempRunIdRef.current = tempRunId;
      setAttachmentTimerEpoch((epoch) => epoch + 1);

      setAttachmentItems((items) =>
        items.map((i) => (i.localId === localId ? { ...i, status: 'uploading', progressPercent: 0, errorMessage: null } : i)),
      );

      try {
        const staged = await requestService.stageAttachment(sessionId, tempRunId, item.file, (percent) => {
          setAttachmentItems((items) => items.map((i) => (i.localId === localId ? { ...i, progressPercent: percent } : i)));
        });
        setAttachmentItems((items) =>
          items.map((i) =>
            i.localId === localId
              ? {
                  ...i,
                  status: 'uploaded',
                  progressPercent: 100,
                  errorMessage: null,
                  stagedRef: { tempRunId: staged.tempRunId, fileName: staged.fileName },
                }
              : i,
          ),
        );
      } catch (error) {
        const friendlyNotice = resolveUploadErrorNotice(error, item.fileName);
        const message = friendlyNotice ?? (error instanceof Error ? error.message : i18n.t('attachments.uploadFailed', { fileName: item.fileName }));
        if (friendlyNotice !== null) {
          setAttachmentNotice(message);
          setAttachmentItems((items) =>
            items.map((i) => (i.localId === localId ? { ...i, status: 'invalid', progressPercent: 0, errorMessage: message } : i)),
          );
        } else {
          setAttachmentItems((items) =>
            items.map((i) => (i.localId === localId ? { ...i, status: 'error', progressPercent: 0, errorMessage: message } : i)),
          );
        }
      }
    },
    [attachmentItems],
  );

  const handleSend = useCallback(
    async (message: string) => {
      const currentSessionId = await ensureComposerSession();
      if (!currentSessionId) {
        return;
      }

      if (editMode) {
        try {
          const editTargetSkill = useSkillSelectionStore.getState().selectedSkill?.capabilityId;
          // NOTE: input-guard-blocked rounds have no run, so editRequest may
          // not be able to target them (edit shares the retry/latest target
          // resolution path). The retry button routes blocked turns through
          // re-submit via handleRetryRequest; editing a blocked turn is not
          // specially handled here yet.
          const accepted = await editRequest(
            message,
            attachmentItems.map((item) => item.file),
            editMode.targetRequestId,
            editMode.rootMessageId,
            {
              ...(editTargetSkill ? { targetSkill: editTargetSkill } : {}),
              sourceInputText: editMode.content,
            },
          );
          if (!accepted) {
            return;
          }
          const restoredDraft = useRequestStore.getState().draftBeforeEdit ?? '';
          setAttachmentItems([]);
          setAttachmentNotice(null);
          setEditMode(null);
          useRequestStore.getState().clearDraftBeforeEdit();
          hydrateComposerInput(restoredDraft);
          setShowEditSubmitNotice(true);
        } catch (error) {
          throw error;
        }
        return;
      }

      if (routeSessionId) {
        // A resolved promise stays inside the native keydown task. Yield a timer task
        // so the browser can commit the submitting state before the optimistic write.
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
        if (useSessionStore.getState().activeSessionId !== currentSessionId) {
          throw new Error('Active session changed before request submission.');
        }
      }

      setShowEditSubmitNotice(false);
      const currentTargetSkill = useSkillSelectionStore.getState().selectedSkill?.capabilityId;
      const activeAttachments = attachmentItems.filter((item) => item.status !== 'expired' && item.status !== 'invalid');
      const stagedRefs = activeAttachments.map((item) => item.stagedRef).filter((ref): ref is StagedAttachmentRef => ref !== null);
      const attachmentSummaries = activeAttachments.map((item) => ({
        fileName: item.fileName,
        mediaType: deriveAttachmentMediaType(item.fileName),
        sizeBytes: item.sizeBytes,
      }));
      await submitRequestWithAttachments(message, stagedRefs, attachmentSummaries, currentTargetSkill);
      writeComposerDraftNow(currentSessionId, '');
      if (!routeSessionId) {
        writeCachedComposerDraft(null, '');
      }
      hydrateComposerInputValue('', { persist: false });
      setAttachmentItems([]);
      setAttachmentNotice(null);
      composerTempRunIdRef.current = null;
    },
    [
      attachmentItems,
      editMode,
      editRequest,
      ensureComposerSession,
      hydrateComposerInput,
      hydrateComposerInputValue,
      routeSessionId,
      submitRequestWithAttachments,
      writeComposerDraftNow,
    ],
  );

  const injectQuestion = useCallback(
    async ({ question, isSend = false }: { readonly question: string; readonly isSend?: boolean }) => {
      const normalizedQuestion = question.trim();
      if (normalizedQuestion.length === 0) {
        return false;
      }

      hydrateComposerInput(question);
      if (isSend) {
        await handleSend(question);
      }
      return true;
    },
    [handleSend, hydrateComposerInput],
  );

  const handleEditRequest = useCallback(
    (rootMessageId: string) => {
      const block = turnBlocksRef.current.find((candidate) => candidate.rootMessageId === rootMessageId);
      if (!block) {
        return;
      }

      setShowEditSubmitNotice(false);
      writeComposerDraftNow(routeSessionId, composerDraftRef.current);
      setDraftBeforeEdit(composerDraftRef.current);
      setEditMode({
        rootMessageId,
        targetRequestId: rootMessageId,
        content: block.userMessage.content,
      });
      hydrateComposerInputValue(block.userMessage.content, { persist: false });
    },
    [hydrateComposerInputValue, routeSessionId, setDraftBeforeEdit, writeComposerDraftNow],
  );

  const handleCancelEdit = useCallback(() => {
    const restoredDraft = draftBeforeEdit ?? '';
    setEditMode(null);
    clearDraftBeforeEdit();
    hydrateComposerInput(restoredDraft);
  }, [clearDraftBeforeEdit, draftBeforeEdit, hydrateComposerInput]);

  const handleRetryRequest = useCallback(
    async (rootMessageId: string) => {
      setShowEditSubmitNotice(false);
      const block = turnBlocksRef.current.find((candidate) => candidate.rootMessageId === rootMessageId);
      if (!block) {
        return;
      }

      // Input-guard-blocked rounds go through runtime.submit and have a normal
      // COMPLETED run in requestRunStore, so retryLatest targets them like any
      // normal round — no special re-submit path needed.
      try {
        await retryRequest(rootMessageId);
      } catch {
        // Error handled in the request store.
      }
    },
    [retryRequest, routeSessionId, submitRequestWithAttachments],
  );

  const handleCancelRequest = useCallback(
    async (targetRequestId?: string) => {
      await cancelRequest(targetRequestId);
    },
    [cancelRequest],
  );

  const handleClearConversation = useCallback(() => {
    if (!routeSessionId) {
      return;
    }
    clearConversation(routeSessionId);
  }, [clearConversation, routeSessionId]);

  const handleRetryLatest = useCallback(async () => {
    if (!latestTurnBlock) {
      return;
    }
    await handleRetryRequest(latestTurnBlock.rootMessageId);
  }, [handleRetryRequest, latestTurnBlock]);

  const handleEditLatest = useCallback(() => {
    if (!latestTurnBlock) {
      return;
    }
    setShowEditSubmitNotice(false);
    setDraftBeforeEdit('');
    setEditMode({
      rootMessageId: latestTurnBlock.rootMessageId,
      targetRequestId: latestTurnBlock.rootMessageId,
      content: latestTurnBlock.userMessage.content,
    });
    hydrateComposerInputValue(latestTurnBlock.userMessage.content, { persist: false });
  }, [hydrateComposerInputValue, latestTurnBlock, setDraftBeforeEdit]);

  return {
    composerHydratedInput,
    composerInputVersion,
    submittedMessageHistory,
    editMode,
    showEditSubmitNotice,
    canRetryLatest,
    showRetryLatestButton,
    canEditLatest,
    attachmentItems,
    attachmentNotice,
    uploadExpireNotice,
    setComposerDraft: handleComposerDraftChange,
    hydrateComposerInput,
    injectQuestion,
    clearEditSubmitNotice,
    handleSend,
    handleAddAttachments,
    handleRemoveAttachment,
    handleRetryAttachment,
    handleEditRequest,
    handleEditLatest,
    handleCancelEdit,
    handleRetryRequest,
    handleRetryLatest,
    handleCancelRequest,
    handleClearConversation,
  };
}
import { runtimeConfig } from '../../../config/runtimeConfig.ts';
