import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Button, Dropdown, Flex, Space, Spin, Tooltip, Typography, Tag } from 'antd';
import {
  CloseCircleOutlined,
  DeleteOutlined,
  EditOutlined,
  HolderOutlined,
  PaperClipOutlined,
  RedoOutlined,
  ReloadOutlined,
} from '@ant-design/icons';
import { SendIcon } from '../../../assets/icons/SendIcon.tsx';
import { StopResponseIcon } from '../../../assets/icons/StopResponseIcon.tsx';
import { getExactComposerCommand, getMatchingComposerCommands, type ComposerCommandContext, type ComposerCommandKey } from '../commandCatalog.ts';
import { parseDirectiveTarget, stripDirectives } from '../capabilityDirective.ts';
import { useUserOps } from '../../auth/useUserOps.ts';
import { AuthGate } from '../../auth/AuthGate.tsx';
import { AuthWrapper } from '../../auth/AuthWrapper.tsx';
import { AICOServiceOperation } from '../../auth/authEnums.ts';
import { useSkillSelectionStore } from '../../../state/skillSelectionStore.ts';
import { loadSkillSelectorSummary } from '../../skill-selector/components/SkillSelector.tsx';
import { resolveSkillDisplayName } from '../../skill-selector/skill-display-name.ts';
import { querySkills } from '../../../services/skillCatalogService.ts';
import { SKILL_ICONS } from '../../../constants/skillIcons.ts';
import type { SkillCatalogSummaryEntry } from '../../../state/contracts.ts';
import { useCategorySelectionStore } from '../../../state/categorySelectionStore.ts';
import { buildAcceptAttribute, type ComposerAttachmentView } from '../attachmentRules.ts';
import { AttachmentFileCard } from '../../shared/components/AttachmentFileCard.tsx';
import { runtimeConfig } from '../../../config/runtimeConfig.ts';
import { queryQuestionAssociations, type QuestionAssociationEntry } from '../../../services/questionAssociationService.ts';
import { useAppHostContext } from '../../../app/AppProviders.tsx';
import { hostLocaleToSupportedLocale } from '../../../app/hostTypes.ts';
import { useAICOConfig } from '../../../aico-config/useAICOConfig.ts';
import { PiuRenderer } from '../../../aico-config/PiuRenderer.tsx';
import { LONG_TEXT_THRESHOLD } from '../../../constants/inputLimits.ts';

const ESC_CANCEL_ARM_WINDOW_MS = 1800;
const EMPTY_SUBMITTED_MESSAGE_HISTORY: readonly string[] = [];
const ASSOCIATION_DEBOUNCE_MS = 300;
const ASSOCIATION_SOURCE_COLORS: Record<string, string> = {
  pinned: 'var(--association-tag-pinned-bg)',
  'high-frequency': 'var(--association-tag-freq-bg)',
  recommended: 'var(--association-tag-recommended-bg)',
  static: 'var(--association-tag-static-bg)',
};

function requestTextareaResize(callback: FrameRequestCallback): number {
  if (typeof window === 'undefined') {
    return 0;
  }
  if (typeof window.requestAnimationFrame === 'function') {
    return window.requestAnimationFrame(callback);
  }
  return window.setTimeout(() => callback(window.performance.now()), 0);
}

function cancelTextareaResize(frameId: number): void {
  if (typeof window === 'undefined') {
    return;
  }
  if (typeof window.cancelAnimationFrame === 'function') {
    window.cancelAnimationFrame(frameId);
    return;
  }
  window.clearTimeout(frameId);
}

function highlightKeyword(text: string, keyword: string): React.ReactNode {
  if (keyword.length === 0) {
    return text;
  }
  const lowerText = text.toLowerCase();
  const lowerKeyword = keyword.toLowerCase();
  const parts: React.ReactNode[] = [];
  let cursor = 0;
  let idx = lowerText.indexOf(lowerKeyword, cursor);
  let key = 0;
  while (idx !== -1) {
    if (idx > cursor) {
      parts.push(text.slice(cursor, idx));
    }
    parts.push(
      <span key={key++} style={{ color: 'var(--association-highlight-color)', fontWeight: 600 }}>
        {text.slice(idx, idx + keyword.length)}
      </span>,
    );
    cursor = idx + keyword.length;
    idx = lowerText.indexOf(lowerKeyword, cursor);
  }
  if (cursor < text.length) {
    parts.push(text.slice(cursor));
  }
  return parts;
}

function getSlashCommandToken(input: string): string {
  return input.split(/\s+/u, 1)[0] ?? input;
}

function hasVisibleEscapeDismissibleOverlay(): boolean {
  const selector = [
    '[role="dialog"]',
    '.ant-modal-root .ant-modal',
    '.ant-drawer-open',
    '.ant-popover:not(.ant-popover-hidden)',
    '.ant-dropdown:not(.ant-dropdown-hidden)',
    '.ant-picker-dropdown:not(.ant-picker-dropdown-hidden)',
    '.ant-select-dropdown:not(.ant-select-dropdown-hidden)',
  ].join(',');
  return Array.from(document.querySelectorAll(selector)).some((element) => element instanceof HTMLElement && element.getClientRects().length > 0);
}

export interface MessageInputProps {
  readonly onSend?: (message: string) => Promise<void>;
  readonly onOpenHelp?: (() => void) | undefined;
  readonly onRetryLatest?: (() => Promise<void> | void) | undefined;
  readonly onEditLatest?: (() => void) | undefined;
  readonly canRetryLatest?: boolean;
  readonly retryLatestDisabled?: boolean;
  readonly showRetryLatestButton?: boolean;
  readonly canEditLatest?: boolean;
  readonly onReloadConversation?: (() => void) | undefined;
  readonly onClearConversation?: (() => void) | undefined;
  readonly isReloading?: boolean;
  readonly disabled?: boolean;
  readonly initialInput?: string;
  readonly inputVersion?: number;
  readonly submittedMessageHistory?: readonly string[];
  readonly onDraftChange?: ((draft: string) => void) | undefined;
  readonly mode?: 'normal' | 'edit';
  readonly onCancelEdit?: (() => void) | undefined;
  readonly isExecuting?: boolean;
  readonly onStop?: (() => void) | undefined;
  readonly attachments?: readonly ComposerAttachmentView[];
  readonly attachmentNotice?: string | null;
  readonly uploadExpireNotice?: string | null;
  readonly onAddAttachments?: ((files: File[]) => Promise<void> | void) | undefined;
  readonly onRemoveAttachment?: ((localId: string) => void) | undefined;
  readonly onRetryAttachment?: ((localId: string) => Promise<void> | void) | undefined;
  readonly inlineNotice?: { readonly type: 'info' | 'warning' | 'error'; readonly message: string } | null;
  readonly skillSelectorSlot?: React.ReactNode;
  readonly selectedSkillChip?: React.ReactNode;
}

interface InlineNotice {
  readonly type: 'info' | 'warning' | 'error';
  readonly message: string;
}

export const MessageInput = memo(function MessageInput({
  onSend,
  onOpenHelp,
  onRetryLatest,
  onEditLatest,
  canRetryLatest = false,
  retryLatestDisabled = false,
  showRetryLatestButton = false,
  canEditLatest = false,
  onReloadConversation,
  onClearConversation,
  isReloading = false,
  disabled = false,
  initialInput = '',
  inputVersion,
  submittedMessageHistory = EMPTY_SUBMITTED_MESSAGE_HISTORY,
  onDraftChange,
  mode = 'normal',
  onCancelEdit,
  isExecuting = false,
  onStop,
  attachments = [],
  attachmentNotice = null,
  uploadExpireNotice = null,
  onAddAttachments,
  onRemoveAttachment,
  onRetryAttachment,
  inlineNotice = null,
  skillSelectorSlot,
  selectedSkillChip,
}: MessageInputProps) {
  const { i18n, t } = useTranslation();
  const [message, setMessage] = useState(initialInput);
  const { site } = useAppHostContext();
  const aicoConfig = useAICOConfig();
  const inputOperator = aicoConfig?.inputOperator;
  const { hostTheme } = useAppHostContext();
  const siteLocale = hostLocaleToSupportedLocale(site?.locale ?? 'zh-cn');
  const hasSelectedSkill = useSkillSelectionStore((s) => s.selectedSkill !== null);
  const hasSelectedCategory = useCategorySelectionStore((s) => s.selectedCategoryName !== null);
  const hasSelectedChip = hasSelectedSkill || hasSelectedCategory;
  const userOps = useUserOps();
  const hasWritePermission = userOps === null || userOps.includes(AICOServiceOperation.Write);
  const [submitting, setSubmitting] = useState(false);
  const [slashOpen, setSlashOpen] = useState(false);
  const [slashFilter, setSlashFilter] = useState('');
  const [showMoreMenu, setShowMoreMenu] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const [isComposing, setIsComposing] = useState(false);
  const [escCancelArmed, setEscCancelArmed] = useState(false);
  const [localNotice, setLocalNotice] = useState<InlineNotice | null>(null);
  const [isDragActive, setIsDragActive] = useState(false);
  const [historyIndex, setHistoryIndex] = useState<number | null>(null);
  const [assocOpen, setAssocOpen] = useState(false);
  const [assocResults, setAssocResults] = useState<readonly QuestionAssociationEntry[]>([]);
  // -1 means "no active selection": Enter submits the typed text and arrow keys
  // move into the list, matching standard search-box autocomplete behavior.
  const [assocHighlightIndex, setAssocHighlightIndex] = useState(-1);
  const [slashSkills, setSlashSkills] = useState<readonly SkillCatalogSummaryEntry[]>([]);
  const [slashSkillsTotal, setSlashSkillsTotal] = useState(0);
  const [slashSkillsPageNum, setSlashSkillsPageNum] = useState(1);
  const [slashSkillsLoadingMore, setSlashSkillsLoadingMore] = useState(false);

  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const cmdItemRefs = useRef<Array<HTMLDivElement | null>>([]);
  const assocItemRefs = useRef<Array<HTMLDivElement | null>>([]);
  const assocPanelRef = useRef<HTMLDivElement | null>(null);
  const slashPanelRef = useRef<HTMLDivElement | null>(null);
  const slashSkillsLoadingMoreRef = useRef(false);
  const assocDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const assocAbortRef = useRef<AbortController | null>(null);
  const assocSuppressedRef = useRef(false);
  const assocSkipQueryRef = useRef(false);
  const assocKeyboardNavRef = useRef(false);
  const escCancelTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const textareaResizeFrameRef = useRef<number | null>(null);
  const messageRef = useRef(message);
  const lastHydratedInputVersionRef = useRef<number | undefined>(inputVersion);
  const historySnapshotRef = useRef<readonly string[] | null>(null);
  const draftBeforeHistoryRef = useRef('');
  const onDraftChangeRef = useRef<MessageInputProps['onDraftChange']>(onDraftChange);

  const setMessageValue = useCallback((nextMessage: string) => {
    messageRef.current = nextMessage;
    setMessage(nextMessage);
  }, []);

  const normalizedSubmittedMessageHistory = useMemo(
    () => submittedMessageHistory.map((item) => item.trim()).filter((item) => item.length > 0),
    [submittedMessageHistory],
  );

  const resetHistoryNavigation = useCallback(() => {
    historySnapshotRef.current = null;
    draftBeforeHistoryRef.current = '';
    setHistoryIndex(null);
  }, []);

  const cancelAssociationQuery = useCallback(() => {
    if (assocDebounceRef.current !== null) {
      clearTimeout(assocDebounceRef.current);
      assocDebounceRef.current = null;
    }
    assocAbortRef.current?.abort();
    assocAbortRef.current = null;
  }, []);

  const closeQuestionAssociation = useCallback(() => {
    cancelAssociationQuery();
    setAssocOpen(false);
    setAssocResults([]);
    setAssocHighlightIndex(-1);
    assocKeyboardNavRef.current = false;
  }, [cancelAssociationQuery]);

  // Auto-resize textarea
  useEffect(() => {
    if (textareaResizeFrameRef.current !== null) {
      cancelTextareaResize(textareaResizeFrameRef.current);
      textareaResizeFrameRef.current = null;
    }
    const textarea = textareaRef.current;
    if (!textarea) {
      return undefined;
    }
    if (message.length === 0) {
      textarea.style.height = '';
      return undefined;
    }
    textareaResizeFrameRef.current = requestTextareaResize(() => {
      textareaResizeFrameRef.current = null;
      const ta = textareaRef.current;
      if (!ta) {
        return;
      }
      ta.style.height = 'auto';
      ta.style.height = `${Math.min(ta.scrollHeight, 90)}px`;
    });
    return () => {
      if (textareaResizeFrameRef.current !== null) {
        cancelTextareaResize(textareaResizeFrameRef.current);
        textareaResizeFrameRef.current = null;
      }
    };
  }, [message]);

  useEffect(() => {
    return () => {
      if (escCancelTimerRef.current) {
        clearTimeout(escCancelTimerRef.current);
      }
    };
  }, []);

  // Clean up association debounce and abort on unmount
  useEffect(() => {
    return cancelAssociationQuery;
  }, [cancelAssociationQuery]);

  // Load skills (shared cache with SkillSelector) when slash panel opens
  useEffect(() => {
    if (!slashOpen) {
      return undefined;
    }
    let cancelled = false;
    loadSkillSelectorSummary()
      .then((result) => {
        if (!cancelled) {
          setSlashSkills(result.skills);
          setSlashSkillsTotal(result.total);
          setSlashSkillsPageNum(1);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setSlashSkills([]);
          setSlashSkillsTotal(0);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [slashOpen]);

  const loadMoreSlashSkills = useCallback(() => {
    if (slashSkillsLoadingMoreRef.current) {
      return;
    }
    if (slashSkills.length >= slashSkillsTotal) {
      return;
    }
    slashSkillsLoadingMoreRef.current = true;
    setSlashSkillsLoadingMore(true);
    const nextPage = slashSkillsPageNum + 1;
    querySkills({ pageNum: nextPage, pageSize: 50 })
      .then((result) => {
        setSlashSkills((prev) => {
          const existingIds = new Set(prev.map((s) => s.capabilityId));
          const newSkills = (result.skills ?? []).filter((s) => !existingIds.has(s.capabilityId));
          return [...prev, ...newSkills];
        });
        setSlashSkillsTotal(result.total ?? 0);
        setSlashSkillsPageNum(nextPage);
      })
      .catch(() => {})
      .finally(() => {
        slashSkillsLoadingMoreRef.current = false;
        setSlashSkillsLoadingMore(false);
      });
  }, [slashSkills.length, slashSkillsTotal, slashSkillsPageNum]);

  const handleSlashPanelScroll = useCallback(() => {
    const panel = slashPanelRef.current;
    if (!panel) {
      return;
    }
    const nearBottom = panel.scrollTop + panel.clientHeight >= panel.scrollHeight - 20;
    if (nearBottom) {
      loadMoreSlashSkills();
    }
  }, [loadMoreSlashSkills]);

  // Association debounce: fetch suggestions 300ms after user stops typing non-slash text
  useEffect(() => {
    const trimmed = message.trim();
    if (historyIndex !== null) {
      closeQuestionAssociation();
      return;
    }
    if (assocDebounceRef.current) {
      clearTimeout(assocDebounceRef.current);
      assocDebounceRef.current = null;
    }
    if (trimmed.length === 0 || trimmed.startsWith('/')) {
      setAssocOpen(false);
      setAssocResults([]);
      setAssocHighlightIndex(-1);
      return;
    }
    if (assocSuppressedRef.current) {
      assocSuppressedRef.current = false;
      return;
    }
    // Pasted content is treated as finished text: do not pop suggestions for
    // it. The panel reopens on the next real keystroke.
    if (assocSkipQueryRef.current) {
      assocSkipQueryRef.current = false;
      setAssocOpen(false);
      setAssocResults([]);
      setAssocHighlightIndex(-1);
      return;
    }
    assocDebounceRef.current = setTimeout(() => {
      assocAbortRef.current?.abort();
      const controller = new AbortController();
      assocAbortRef.current = controller;
      queryQuestionAssociations(trimmed, siteLocale, controller.signal)
        .then((result) => {
          if (controller.signal.aborted) {
            return;
          }
          // Do not pop the panel when the textarea lost focus while the query
          // was in flight (e.g. the user clicked away right after typing).
          const textarea = textareaRef.current;
          if (textarea !== null && document.activeElement !== textarea) {
            return;
          }
          setAssocResults(result.questions);
          setAssocHighlightIndex(-1);
          assocKeyboardNavRef.current = false;
          setAssocOpen(result.questions.length > 0);
        })
        .catch(() => {
          if (controller.signal.aborted) {
            return;
          }
          setAssocOpen(false);
          setAssocResults([]);
        });
    }, ASSOCIATION_DEBOUNCE_MS);
  }, [closeQuestionAssociation, historyIndex, message, siteLocale]);

  useEffect(() => {
    onDraftChangeRef.current = onDraftChange;
  }, [onDraftChange]);

  useEffect(() => {
    onDraftChangeRef.current?.(message);
  }, [message]);

  useEffect(() => {
    if (inputVersion === undefined) {
      return;
    }
    if (lastHydratedInputVersionRef.current === inputVersion) {
      return;
    }
    lastHydratedInputVersionRef.current = inputVersion;
    resetHistoryNavigation();
    setMessageValue(initialInput);
    setTimeout(() => {
      const ta = textareaRef.current;
      if (!ta) {
        return;
      }
      ta.focus();
      if (mode === 'edit') {
        const len = ta.value.length;
        ta.setSelectionRange(len, len);
      }
    }, 0);
  }, [initialInput, inputVersion, mode, resetHistoryNavigation, setMessageValue]);

  useEffect(() => {
    if (mode !== 'edit') {
      return;
    }
    resetHistoryNavigation();
    setTimeout(() => {
      const ta = textareaRef.current;
      if (!ta) {
        return;
      }
      ta.focus();
      const len = ta.value.length;
      ta.setSelectionRange(len, len);
    }, 0);
  }, [mode, resetHistoryNavigation]);

  const commandContext = useMemo<ComposerCommandContext>(
    () => ({
      hasRetryTarget: canRetryLatest,
      hasEditTarget: canEditLatest,
      isExecuting,
      hasWritePermission,
    }),
    [canEditLatest, canRetryLatest, isExecuting, hasWritePermission],
  );

  const filteredCommands = useMemo(() => getMatchingComposerCommands(slashFilter, commandContext), [commandContext, slashFilter, t]);

  const selectablePanelIndexes = useMemo(() => {
    const cmdIndexes = filteredCommands.flatMap((command, index) => (command.enabled ? [index] : []));
    const skillStart = filteredCommands.length;
    const skillIndexes = slashSkills.map((_, index) => skillStart + index);
    return [...cmdIndexes, ...skillIndexes];
  }, [filteredCommands, slashSkills]);

  const effectiveHighlightedIndex = useMemo(() => {
    if (selectablePanelIndexes.includes(highlightedIndex)) {
      return highlightedIndex;
    }
    return selectablePanelIndexes[0] ?? -1;
  }, [highlightedIndex, selectablePanelIndexes]);

  const handleEscapeCancelRequest = useCallback(() => {
    if (!isExecuting || !onStop) {
      return false;
    }

    if (escCancelArmed) {
      if (escCancelTimerRef.current) {
        clearTimeout(escCancelTimerRef.current);
        escCancelTimerRef.current = null;
      }
      setEscCancelArmed(false);
      onStop();
      return true;
    }

    setEscCancelArmed(true);
    if (escCancelTimerRef.current) {
      clearTimeout(escCancelTimerRef.current);
    }
    escCancelTimerRef.current = setTimeout(() => {
      setEscCancelArmed(false);
      escCancelTimerRef.current = null;
    }, ESC_CANCEL_ARM_WINDOW_MS);
    return true;
  }, [escCancelArmed, isExecuting, onStop]);

  useEffect(() => {
    if (!isExecuting || !onStop) {
      return undefined;
    }

    const handleWindowKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented || event.isComposing) {
        return;
      }

      if (hasVisibleEscapeDismissibleOverlay()) {
        return;
      }

      if (slashOpen || showMoreMenu || assocOpen) {
        event.preventDefault();
        setSlashOpen(false);
        setShowMoreMenu(false);
        setAssocOpen(false);
        return;
      }

      event.preventDefault();
      setSlashOpen(false);
      setShowMoreMenu(false);
      setAssocOpen(false);
      handleEscapeCancelRequest();
    };

    window.addEventListener('keydown', handleWindowKeyDown);
    return () => window.removeEventListener('keydown', handleWindowKeyDown);
  }, [handleEscapeCancelRequest, isExecuting, onStop, showMoreMenu, slashOpen, assocOpen]);

  useEffect(() => {
    if (!slashOpen || effectiveHighlightedIndex < 0) {
      return;
    }
    try {
      cmdItemRefs.current[effectiveHighlightedIndex]?.scrollIntoView({ block: 'nearest' });
    } catch {
      // jsdom does not implement scrollIntoView.
    }
  }, [effectiveHighlightedIndex, slashOpen]);

  useEffect(() => {
    if (!assocOpen || assocHighlightIndex < 0) {
      return;
    }
    try {
      assocItemRefs.current[assocHighlightIndex]?.scrollIntoView({ block: 'nearest' });
    } catch {
      // jsdom does not implement scrollIntoView.
    }
  }, [assocHighlightIndex, assocOpen]);

  // Dismiss the association panel when the user clicks anywhere outside the
  // panel and the textarea (e.g. the send button or the conversation area).
  useEffect(() => {
    if (!assocOpen) {
      return undefined;
    }
    const handleDocumentMouseDown = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) {
        return;
      }
      if (textareaRef.current?.contains(target)) {
        return;
      }
      if (assocPanelRef.current?.contains(target)) {
        return;
      }
      setAssocOpen(false);
    };
    document.addEventListener('mousedown', handleDocumentMouseDown);
    return () => document.removeEventListener('mousedown', handleDocumentMouseDown);
  }, [assocOpen]);

  const handleTextChange = useCallback(
    (text: string) => {
      const truncated = text.length > LONG_TEXT_THRESHOLD ? text.slice(0, LONG_TEXT_THRESHOLD) : text;
      if (messageRef.current === truncated) {
        return;
      }
      resetHistoryNavigation();
      if (truncated.length < text.length) {
        setLocalNotice({
          type: 'warning',
          message: t('composer.inputLimitTruncated', { max: LONG_TEXT_THRESHOLD }),
        });
      } else {
        setLocalNotice(null);
      }
      setMessageValue(truncated);
      setSlashFilter(truncated);

      if (truncated.startsWith('/')) {
        const matches = getMatchingComposerCommands(truncated, commandContext);
        setSlashOpen(matches.length > 0);
        setHighlightedIndex(matches.findIndex((command) => command.enabled));
        return;
      }

      setSlashOpen(false);
      setHighlightedIndex(0);
      // Association panel is handled by the debounce effect on `message`.
      // When text becomes empty, the effect will close the association panel.
    },
    [commandContext, resetHistoryNavigation, setMessageValue, t],
  );

  const selectSkill = useSkillSelectionStore((s) => s.selectSkill);

  const fillCommand = useCallback(
    (commandKey: ComposerCommandKey) => {
      resetHistoryNavigation();
      setLocalNotice(null);
      setMessageValue(commandKey);
      setSlashFilter(commandKey);
      setSlashOpen(false);
      setHighlightedIndex(0);
      setTimeout(() => textareaRef.current?.focus(), 0);
    },
    [resetHistoryNavigation, setMessageValue],
  );

  const selectSkillFromPanel = useCallback(
    (skill: SkillCatalogSummaryEntry, iconIndex: number) => {
      resetHistoryNavigation();
      setLocalNotice(null);
      selectSkill(skill, iconIndex);
      setSlashOpen(false);
      setMessageValue('');
      setSlashFilter('/');
      setHighlightedIndex(0);
      setTimeout(() => textareaRef.current?.focus(), 0);
    },
    [resetHistoryNavigation, selectSkill, setMessageValue],
  );

  const focusTextareaSoon = useCallback(() => {
    setTimeout(() => textareaRef.current?.focus(), 0);
  }, []);

  const fillAssociation = useCallback(
    (text: string) => {
      resetHistoryNavigation();
      setLocalNotice(null);
      assocSuppressedRef.current = true;
      setMessageValue(text);
      setSlashFilter(text);
      setSlashOpen(false);
      setHighlightedIndex(0);
      setAssocOpen(false);
      setAssocResults([]);
      setAssocHighlightIndex(-1);
      assocKeyboardNavRef.current = false;
      setTimeout(() => textareaRef.current?.focus(), 0);
    },
    [resetHistoryNavigation, setMessageValue],
  );

  const applyHistoryMessage = useCallback(
    (nextMessage: string, nextIndex: number | null) => {
      closeQuestionAssociation();
      setLocalNotice(null);
      setMessageValue(nextMessage);
      setSlashFilter(nextMessage);
      setSlashOpen(false);
      setHighlightedIndex(0);
      setHistoryIndex(nextIndex);
      focusTextareaSoon();
    },
    [closeQuestionAssociation, focusTextareaSoon, setMessageValue],
  );

  const handleSubmittedHistoryNavigation = useCallback(
    (key: 'ArrowUp' | 'ArrowDown', currentValue: string): boolean => {
      if (mode === 'edit') {
        return false;
      }

      if (key === 'ArrowUp') {
        const snapshot = historySnapshotRef.current ?? normalizedSubmittedMessageHistory;
        if (snapshot.length === 0) {
          return false;
        }

        if (historyIndex === null) {
          if (currentValue.length > 0) {
            return false;
          }
          historySnapshotRef.current = snapshot;
          draftBeforeHistoryRef.current = currentValue;
          applyHistoryMessage(snapshot[snapshot.length - 1] ?? '', snapshot.length - 1);
          return true;
        }

        const nextIndex = Math.max(historyIndex - 1, 0);
        applyHistoryMessage(snapshot[nextIndex] ?? '', nextIndex);
        return true;
      }

      if (historyIndex === null) {
        return false;
      }

      const snapshot = historySnapshotRef.current ?? normalizedSubmittedMessageHistory;
      const nextIndex = historyIndex + 1;
      if (nextIndex >= snapshot.length) {
        const restoredDraft = draftBeforeHistoryRef.current;
        closeQuestionAssociation();
        resetHistoryNavigation();
        setLocalNotice(null);
        setMessageValue(restoredDraft);
        setSlashFilter(restoredDraft);
        setSlashOpen(false);
        setHighlightedIndex(0);
        focusTextareaSoon();
        return true;
      }

      applyHistoryMessage(snapshot[nextIndex] ?? '', nextIndex);
      return true;
    },
    [
      applyHistoryMessage,
      closeQuestionAssociation,
      focusTextareaSoon,
      historyIndex,
      mode,
      normalizedSubmittedMessageHistory,
      resetHistoryNavigation,
      setMessageValue,
    ],
  );

  const hasPendingAttachments = attachments.some((attachment) => attachment.status === 'uploading');
  const isUploadConfigured = runtimeConfig.chatUploadFileConfig !== undefined;

  const handleSubmit = useCallback(async () => {
    const normalizedMessage = message.trim();
    if (!normalizedMessage || submitting || disabled || hasPendingAttachments || !hasWritePermission || isExecuting) {
      return;
    }

    // Preflight: a bare `$skill:`/`$workflow:` directive with no effective
    // user question would be stripped to empty by the backend projector and
    // produce an invisible user message. Reject before submission instead.
    if (stripDirectives(normalizedMessage).length === 0) {
      setLocalNotice({ type: 'warning', message: t('composer.emptyAfterDirective') });
      focusTextareaSoon();
      return;
    }

    // Preflight: when the user hand-types `$skill:<name>`, check the loaded
    // skill catalog and reject obvious misses early. The backend still governs
    // unavailable/forbidden/load-failed skills, so this only filters names not
    // present in the currently loaded catalog.
    const directiveTarget = parseDirectiveTarget(normalizedMessage);
    if (directiveTarget?.kind === 'skill' && slashSkills.length > 0) {
      const known = slashSkills.some((skill) => skill.capabilityId === directiveTarget.name);
      if (!known) {
        setLocalNotice({ type: 'warning', message: t('composer.skillNotFound', { skill: directiveTarget.name }) });
        focusTextareaSoon();
        return;
      }
    }

    // Check if input starts with / - it could be a command or an invalid command attempt
    if (normalizedMessage.startsWith('/')) {
      const exactCommand = getExactComposerCommand(getSlashCommandToken(normalizedMessage), commandContext);
      if (exactCommand) {
        setSlashOpen(false);

        if (!exactCommand.enabled) {
          setMessageValue('');
          setLocalNotice({
            type: 'warning',
            message: exactCommand.disabledReason ?? t('composer.commandUnavailable'),
          });
          focusTextareaSoon();
          return;
        }

        switch (exactCommand.key) {
          case '/help':
            setMessageValue('');
            setLocalNotice(null);
            onOpenHelp?.();
            return;
          case '/retry':
            setMessageValue('');
            setLocalNotice(null);
            try {
              await onRetryLatest?.();
            } catch {
              // Errors are surfaced by parent request-store notices.
            }
            focusTextareaSoon();
            return;
          case '/edit':
            setMessageValue('');
            setLocalNotice(null);
            try {
              onEditLatest?.();
            } catch {
              // Errors are surfaced by parent request-store notices.
            }
            return;
        }
      }

      // Input starts with / but is not a recognized command - show warning and don't send
      const matchingCommands = getMatchingComposerCommands(normalizedMessage, commandContext);
      if (matchingCommands.length === 0) {
        setMessageValue('');
        setLocalNotice({
          type: 'warning',
          message: t('composer.unknownCommand', { command: normalizedMessage }),
        });
        focusTextareaSoon();
        return;
      }

      // There are partial matches - show them in slash panel instead of sending
      setSlashOpen(true);
      setSlashFilter(normalizedMessage);
      setHighlightedIndex(matchingCommands.findIndex((cmd) => cmd.enabled));
      return;
    }

    setSubmitting(true);
    try {
      await onSend?.(normalizedMessage);
      resetHistoryNavigation();
      setMessageValue('');
      setAssocOpen(false);
      setAssocResults([]);
      setAssocHighlightIndex(-1);
      assocKeyboardNavRef.current = false;
    } catch {
      // keep input on error
    } finally {
      setSubmitting(false);
      setTimeout(() => textareaRef.current?.focus(), 0);
    }
  }, [
    commandContext,
    disabled,
    hasPendingAttachments,
    hasWritePermission,
    isExecuting,
    message,
    onEditLatest,
    focusTextareaSoon,
    onOpenHelp,
    onRetryLatest,
    onSend,
    resetHistoryNavigation,
    setMessageValue,
    slashSkills,
    submitting,
    t,
  ]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (slashOpen) {
        const safeIdx = effectiveHighlightedIndex;

        if (e.key === 'ArrowDown') {
          e.preventDefault();
          if (selectablePanelIndexes.length === 0) {
            return;
          }
          const currentPosition = Math.max(selectablePanelIndexes.indexOf(safeIdx), 0);
          const next = selectablePanelIndexes[Math.min(currentPosition + 1, selectablePanelIndexes.length - 1)] ?? safeIdx;
          setHighlightedIndex(next);
          // Trigger pagination when near the last skill
          const lastIdx = selectablePanelIndexes[selectablePanelIndexes.length - 1];
          if (lastIdx !== undefined && next >= lastIdx - 2) {
            loadMoreSlashSkills();
          }
          return;
        }
        if (e.key === 'ArrowUp') {
          e.preventDefault();
          if (selectablePanelIndexes.length === 0) {
            return;
          }
          const currentPosition = selectablePanelIndexes.indexOf(safeIdx);
          const prev = selectablePanelIndexes[Math.max((currentPosition >= 0 ? currentPosition : selectablePanelIndexes.length) - 1, 0)] ?? safeIdx;
          setHighlightedIndex(prev);
          return;
        }
        if (e.key === 'Enter' || e.key === 'Tab') {
          e.preventDefault();
          if (safeIdx >= 0 && safeIdx < filteredCommands.length) {
            const cmd = filteredCommands[safeIdx];
            if (cmd?.enabled) {
              fillCommand(cmd.key);
            } else {
              setSlashOpen(false);
            }
          } else if (safeIdx >= filteredCommands.length) {
            const skillIdx = safeIdx - filteredCommands.length;
            const skill = slashSkills[skillIdx];
            if (skill) {
              selectSkillFromPanel(skill, skillIdx % SKILL_ICONS.length);
            } else {
              setSlashOpen(false);
            }
          } else {
            setSlashOpen(false);
          }
          return;
        }
        if (e.key === 'Escape') {
          setSlashOpen(false);
          setShowMoreMenu(false);
          return;
        }
      }

      // While an IME composition session is active (e.g. Chinese pinyin input),
      // the association panel must not intercept keys: Enter confirms the IME
      // candidate and arrow keys navigate the IME candidate window.
      if (assocOpen && !isComposing && !e.nativeEvent.isComposing) {
        if (e.key === 'ArrowDown') {
          e.preventDefault();
          assocKeyboardNavRef.current = true;
          setAssocHighlightIndex((prev) => (prev + 1 > assocResults.length - 1 ? -1 : prev + 1));
          return;
        }
        if (e.key === 'ArrowUp') {
          e.preventDefault();
          assocKeyboardNavRef.current = true;
          setAssocHighlightIndex((prev) => (prev - 1 < -1 ? assocResults.length - 1 : prev - 1));
          return;
        }
        // Enter/Tab only adopt a suggestion the user explicitly navigated to
        // with the keyboard. Without a keyboard selection, Enter falls through
        // and submits the typed text, and Tab keeps its default focus behavior.
        if ((e.key === 'Enter' || e.key === 'Tab') && assocKeyboardNavRef.current) {
          const entry = assocHighlightIndex >= 0 ? assocResults[assocHighlightIndex] : undefined;
          if (entry) {
            e.preventDefault();
            fillAssociation(entry.text);
            return;
          }
        }
        if (e.key === 'Escape') {
          setAssocOpen(false);
          return;
        }
      }

      if (
        (e.key === 'ArrowUp' || e.key === 'ArrowDown') &&
        !isComposing &&
        !e.altKey &&
        !e.ctrlKey &&
        !e.metaKey &&
        e.currentTarget.selectionStart === e.currentTarget.selectionEnd
      ) {
        const handledHistoryNavigation = handleSubmittedHistoryNavigation(e.key, e.currentTarget.value);
        if (handledHistoryNavigation) {
          e.preventDefault();
          return;
        }
      }

      if (e.key === 'Enter' && !e.shiftKey) {
        if (isComposing) {
          return;
        }
        e.preventDefault();
        void handleSubmit();
        return;
      }
      if (e.key === 'Escape') {
        if (mode === 'edit' && onCancelEdit && !isExecuting) {
          e.preventDefault();
          setSlashOpen(false);
          setShowMoreMenu(false);
          if (escCancelTimerRef.current) {
            clearTimeout(escCancelTimerRef.current);
            escCancelTimerRef.current = null;
          }
          setEscCancelArmed(false);
          onCancelEdit();
          return;
        }
        if (isExecuting && onStop) {
          e.preventDefault();
          handleEscapeCancelRequest();
        }
        setSlashOpen(false);
        setShowMoreMenu(false);
        setAssocOpen(false);
      }
    },
    [
      escCancelArmed,
      assocOpen,
      assocHighlightIndex,
      assocResults,
      fillAssociation,
      effectiveHighlightedIndex,
      fillCommand,
      filteredCommands,
      handleSubmittedHistoryNavigation,
      handleSubmit,
      handleEscapeCancelRequest,
      isComposing,
      isExecuting,
      mode,
      onCancelEdit,
      onStop,
      selectablePanelIndexes,
      slashOpen,
      loadMoreSlashSkills,
    ],
  );

  const handleFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(e.target.files ?? []);
      if (files.length === 0) {
        return;
      }
      void onAddAttachments?.(files);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    },
    [onAddAttachments],
  );

  const isFileDrag = useCallback((event: { dataTransfer?: DataTransfer | null }) => {
    const types = Array.from(event.dataTransfer?.types ?? []);
    return types.includes('Files');
  }, []);

  const handleDragEnter = useCallback(
    (event: React.DragEvent<HTMLDivElement>) => {
      if (!hasWritePermission) {
        return;
      }
      if (!isFileDrag(event)) {
        return;
      }
      event.preventDefault();
      setIsDragActive(true);
    },
    [isFileDrag, hasWritePermission],
  );

  const handleDragOver = useCallback(
    (event: React.DragEvent<HTMLDivElement>) => {
      if (!hasWritePermission) {
        return;
      }
      if (!isFileDrag(event)) {
        return;
      }
      event.preventDefault();
      event.dataTransfer.dropEffect = 'copy';
      setIsDragActive(true);
    },
    [isFileDrag, hasWritePermission],
  );

  const handleDragLeave = useCallback(
    (event: React.DragEvent<HTMLDivElement>) => {
      if (!hasWritePermission) {
        return;
      }
      if (!isFileDrag(event)) {
        return;
      }
      if (event.currentTarget.contains(event.relatedTarget as Node | null)) {
        return;
      }
      setIsDragActive(false);
    },
    [isFileDrag, hasWritePermission],
  );

  const handleDrop = useCallback(
    (event: React.DragEvent<HTMLDivElement>) => {
      if (!hasWritePermission || !isUploadConfigured) {
        return;
      }
      if (!isFileDrag(event)) {
        return;
      }
      event.preventDefault();
      setIsDragActive(false);
      const files = Array.from(event.dataTransfer.files ?? []);
      if (files.length === 0) {
        return;
      }
      void onAddAttachments?.(files);
    },
    [isFileDrag, onAddAttachments, hasWritePermission, isUploadConfigured],
  );

  const handlePaste = useCallback(
    (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
      // Clean rich text formatting, keep plain text only
      const items = Array.from(e.clipboardData.items);
      const textItem = items.find((item) => item.type === 'text/plain');
      if (textItem) {
        e.preventDefault();
        textItem.getAsString((text) => {
          const ta = textareaRef.current;
          if (ta) {
            const start = ta.selectionStart;
            const end = ta.selectionEnd;
            const newValue = message.substring(0, start) + text + message.substring(end);
            // Pasted text is finished content; suppress the association query
            // for this change so the panel does not pop over pasted content.
            assocSkipQueryRef.current = true;
            handleTextChange(newValue);
            // Set cursor position after pasted text
            setTimeout(() => {
              ta.selectionStart = ta.selectionEnd = start + text.length;
            }, 0);
          }
        });
      }
    },
    [message, handleTextChange],
  );

  const handleTextareaWheel = useCallback((e: React.WheelEvent<HTMLTextAreaElement>) => {
    const target = e.currentTarget;
    const canScrollSelf = target.scrollHeight > target.clientHeight;
    if (!canScrollSelf) {
      return;
    }
    e.stopPropagation();
  }, []);

  const submitDisabled = disabled || !message.trim() || submitting || hasPendingAttachments || !hasWritePermission || isExecuting;
  const isNearLimit = message.length > LONG_TEXT_THRESHOLD * 0.9 && message.length <= LONG_TEXT_THRESHOLD;
  const activeInlineNotice =
    localNotice ??
    (attachmentNotice
      ? {
          type: 'warning',
          message: attachmentNotice,
        }
      : null) ??
    inlineNotice;
  const taStyle: React.CSSProperties = {
    width: '100%',
    resize: 'none',
    border: 'none',
    outline: 'none',
    boxShadow: 'none',
    padding: '0 0 8px 0',
    fontSize: 14,
    lineHeight: 1.6,
    background: 'transparent',
    color: 'var(--color-text-primary)',
    minHeight: 40,
    maxHeight: 90,
    overflowY: 'auto',
  };

  return (
    <div
      data-testid="message-input-root"
      data-drag-active={isDragActive ? 'true' : 'false'}
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      style={{
        width: '100%',
        maxWidth: '100%',
        margin: '0 auto',
        position: 'relative',
      }}
    >
      {skillSelectorSlot && <div style={{ marginBottom: 12 }}>{skillSelectorSlot}</div>}
      {/* Main input card */}
      <div
        data-mode={mode}
        style={{
          position: 'relative',
          borderRadius: 16,
          boxShadow:
            mode === 'edit'
              ? '0 0 0 3px rgba(22,119,255,0.12), 0 6px 18px var(--color-composer-shadow, rgba(0, 0, 0, 0.08))'
              : '0 6px 18px var(--color-composer-shadow, rgba(0, 0, 0, 0.08))',
          border:
            mode === 'edit'
              ? '1px solid var(--color-primary, #1677ff)'
              : isDragActive
                ? '1px solid var(--color-primary, #1677ff)'
                : '1px solid var(--color-composer-border, #e5e7eb)',
          background:
            mode === 'edit'
              ? 'var(--color-composer-bg, #ffffff)'
              : isDragActive
                ? 'var(--color-bg-active, #e6f4ff)'
                : 'var(--color-composer-bg, #ffffff)',
          padding: 12,
          display: 'flex',
          flexDirection: 'column',
          gap: 4,
          transition: 'border-color 120ms ease, background 120ms ease, box-shadow 120ms ease',
        }}
      >
        {/* Slash command autocomplete */}
        {slashOpen && (filteredCommands.length > 0 || slashSkills.length > 0) && (
          <div
            data-testid="slash-command-panel"
            className="association-panel-scroll"
            ref={slashPanelRef}
            onScroll={handleSlashPanelScroll}
            style={{
              position: 'absolute',
              bottom: 'calc(100% + 4px)',
              left: 0,
              right: 0,
              zIndex: 50,
              background: 'var(--color-bg-primary)',
              border: '1px solid var(--color-bg-tertiary)',
              borderRadius: 12,
              padding: '6px 8px',
              boxShadow: '0 2px 8px rgba(0,0,0,0.08)',
              maxHeight: 280,
              overflowY: 'auto',
            }}
          >
            <Space direction="vertical" size={2} style={{ width: '100%' }}>
              {filteredCommands.length > 0 && (
                <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-text-tertiary)', padding: '4px 8px 2px' }}>
                  {t('composer.slashCategoryQuickActions')}
                </div>
              )}
              {(() => {
                cmdItemRefs.current = [];
                return filteredCommands.map((cmd, idx) => {
                  const isHighlighted = idx === effectiveHighlightedIndex;
                  const icon =
                    cmd.key === '/help' ? (
                      <HolderOutlined style={{ color: 'var(--color-text-secondary)' }} />
                    ) : cmd.key === '/retry' ? (
                      <RedoOutlined style={{ color: 'var(--color-text-secondary)' }} />
                    ) : cmd.key === '/edit' ? (
                      <EditOutlined style={{ color: 'var(--color-text-secondary)' }} />
                    ) : (
                      <ReloadOutlined style={{ color: 'var(--color-text-secondary)' }} />
                    );

                  return (
                    <div
                      key={cmd.key}
                      ref={(el) => {
                        cmdItemRefs.current[idx] = el;
                      }}
                      style={{
                        padding: '4px 8px',
                        borderRadius: 6,
                        cursor: cmd.enabled ? 'pointer' : 'not-allowed',
                        background: isHighlighted ? 'var(--color-bg-active)' : 'transparent',
                        border: isHighlighted ? '1px solid var(--color-primary)' : '1px solid transparent',
                        opacity: cmd.enabled ? 1 : 0.6,
                      }}
                      onMouseDown={(event) => {
                        event.preventDefault();
                        if (!cmd.enabled) {
                          return;
                        }
                        fillCommand(cmd.key);
                      }}
                      onMouseEnter={() => {
                        if (cmd.enabled) {
                          setHighlightedIndex(idx);
                        }
                      }}
                    >
                      <Flex justify="space-between" align="center" gap={16}>
                        <Space>
                          {icon}
                          <Typography.Text code style={{ fontSize: 13 }}>
                            {cmd.key}
                          </Typography.Text>
                        </Space>
                        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                          {cmd.enabled ? cmd.description : cmd.disabledReason}
                        </Typography.Text>
                      </Flex>
                    </div>
                  );
                });
              })()}
              {slashSkills.length > 0 && (
                <>
                  <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-text-tertiary)', padding: '4px 8px 2px' }}>
                    {t('composer.slashCategorySkills')}
                  </div>
                  {slashSkills.map((skill, skillIdx) => {
                    const unifiedIdx = filteredCommands.length + skillIdx;
                    const isHighlighted = unifiedIdx === effectiveHighlightedIndex;
                    return (
                      <div
                        key={skill.capabilityId}
                        ref={(el) => {
                          cmdItemRefs.current[unifiedIdx] = el;
                        }}
                        title={skill.description}
                        style={{
                          padding: '4px 8px',
                          borderRadius: 6,
                          cursor: 'pointer',
                          background: isHighlighted ? 'var(--color-bg-active)' : 'transparent',
                          border: isHighlighted ? '1px solid var(--color-primary)' : '1px solid transparent',
                          overflow: 'hidden',
                        }}
                        onMouseDown={(event) => {
                          event.preventDefault();
                          selectSkillFromPanel(skill, skillIdx % SKILL_ICONS.length);
                        }}
                        onMouseEnter={() => {
                          setHighlightedIndex(unifiedIdx);
                        }}
                      >
                        <Flex justify="space-between" align="center" gap={16}>
                          <Space>
                            <svg
                              width="16"
                              height="16"
                              viewBox="0 0 24 24"
                              fill="none"
                              stroke="var(--color-text-secondary)"
                              strokeWidth="2"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              style={{ flexShrink: 0 }}
                            >
                              <path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z" />
                              <path d="M20 3v4" />
                              <path d="M22 5h-4" />
                              <path d="M4 17v2" />
                              <path d="M5 18H3" />
                            </svg>
                            <Typography.Text style={{ fontSize: 13, whiteSpace: 'nowrap' }}>
                              {resolveSkillDisplayName(skill, i18n.resolvedLanguage ?? i18n.language)}
                            </Typography.Text>
                          </Space>
                          <Typography.Text
                            type="secondary"
                            style={{
                              fontSize: 12,
                              flex: 1,
                              minWidth: 0,
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              whiteSpace: 'nowrap',
                              textAlign: 'right',
                            }}
                          >
                            {skill.description}
                          </Typography.Text>
                        </Flex>
                      </div>
                    );
                  })}
                  {slashSkillsLoadingMore && (
                    <div style={{ textAlign: 'center', padding: '8px 0' }}>
                      <Spin size="small" />
                    </div>
                  )}
                </>
              )}
            </Space>
          </div>
        )}

        {/* Question association autocomplete panel */}
        {assocOpen && assocResults.length > 0 && (
          <div
            data-testid="association-panel"
            className="association-panel-scroll"
            ref={assocPanelRef}
            style={{
              position: 'absolute',
              bottom: 'calc(100% + 4px)',
              left: 0,
              right: 0,
              zIndex: 50,
              background: 'var(--association-panel-bg)',
              border: '1px solid var(--color-bg-tertiary)',
              borderRadius: 16,
              padding: 4,
              boxShadow: 'var(--association-panel-shadow)',
              maxHeight: 180,
              overflowY: 'auto',
            }}
          >
            <Space direction="vertical" size={2} style={{ width: '100%' }}>
              {(() => {
                assocItemRefs.current = [];
                return assocResults.map((entry, idx) => {
                  const isHighlighted = idx === assocHighlightIndex;
                  const sourceLabel = t(`composer.associationSource.${entry.source}`);
                  return (
                    <div
                      key={`${entry.text}-${idx}`}
                      ref={(el) => {
                        assocItemRefs.current[idx] = el;
                      }}
                      data-testid={`association-item-${idx}`}
                      style={{
                        height: 36,
                        padding: '7px 12px',
                        borderRadius: 12,
                        cursor: 'pointer',
                        background: isHighlighted ? 'var(--association-item-hover)' : 'transparent',
                        border: 'none',
                      }}
                      onMouseDown={(event) => {
                        event.preventDefault();
                        fillAssociation(entry.text);
                      }}
                      onMouseEnter={() => {
                        // Mouse hover is visual feedback only; it must not arm
                        // Enter to adopt the suggestion (click adopts instead).
                        assocKeyboardNavRef.current = false;
                        setAssocHighlightIndex(idx);
                      }}
                    >
                      <Flex justify="space-between" align="center" gap={8} style={{ width: '100%', height: '100%' }}>
                        <Typography.Text
                          ellipsis
                          style={{
                            fontSize: 13,
                            minWidth: 0,
                            flex: 1,
                            color: isHighlighted ? 'var(--color-text-primary)' : 'var(--color-text-secondary)',
                          }}
                        >
                          {highlightKeyword(entry.text, message.trim())}
                        </Typography.Text>
                        <Tag
                          style={{
                            fontSize: 11,
                            margin: 0,
                            flexShrink: 0,
                            userSelect: 'none',
                            border: 'none',
                            borderRadius: 4,
                            padding: '4px 8px',
                            background: ASSOCIATION_SOURCE_COLORS[entry.source],
                            color: isHighlighted ? 'var(--color-text-primary)' : 'var(--color-text-secondary)',
                          }}
                        >
                          {sourceLabel}
                        </Tag>
                      </Flex>
                    </div>
                  );
                });
              })()}
            </Space>
          </div>
        )}
        {isDragActive && (
          <div
            data-testid="attachment-drop-hint"
            style={{
              borderRadius: 10,
              border: '1px dashed rgba(22,119,255,0.35)',
              background: 'rgba(22,119,255,0.06)',
              color: 'var(--color-primary)',
              padding: '6px 10px',
              fontSize: 12,
              lineHeight: '18px',
              marginBottom: 4,
            }}
          >
            {t('composer.dropHint')}
          </div>
        )}

        {escCancelArmed && isExecuting && (
          <Alert
            data-testid="esc-cancel-hint"
            type="info"
            showIcon={false}
            message={t('composer.escCancelHint')}
            style={{
              marginBottom: 4,
              borderRadius: 10,
              padding: '6px 10px',
            }}
          />
        )}

        {activeInlineNotice && (
          <Alert
            data-testid="message-input-inline-notice"
            type={activeInlineNotice.type}
            showIcon={false}
            message={activeInlineNotice.message}
            style={{
              marginBottom: 4,
              borderRadius: 10,
              padding: '6px 10px',
            }}
          />
        )}

        {mode === 'edit' && (
          <div
            data-testid="edit-mode-hint"
            style={{
              alignSelf: 'flex-start',
              borderRadius: 999,
              background: 'var(--color-bg-hover)',
              border: '1px solid var(--color-border-strong)',
              color: 'var(--color-text-secondary)',
              padding: '2px 10px',
              fontSize: 12,
              lineHeight: '18px',
              marginBottom: 2,
            }}
          >
            {t('composer.editModeHint')}
          </div>
        )}

        {uploadExpireNotice && (
          <Alert
            data-testid="upload-expire-notice"
            type="warning"
            showIcon={false}
            message={uploadExpireNotice}
            style={{
              marginBottom: 4,
              borderRadius: 10,
              padding: '6px 10px',
            }}
          />
        )}

        {attachments.length > 0 && (
          <div
            data-testid="attachment-queue"
            onWheel={(e) => {
              if (e.currentTarget.scrollWidth > e.currentTarget.clientWidth) {
                e.currentTarget.scrollLeft += e.deltaY;
              }
            }}
            style={{
              display: 'flex',
              flexDirection: 'row',
              gap: 4,
              marginBottom: 4,
              overflowX: 'auto',
              overflowY: 'hidden',
              scrollbarWidth: 'thin',
            }}
          >
            {attachments.map((attachment) => {
              const isError = attachment.status === 'error';
              const isExpired = attachment.status === 'expired';
              const isInvalid = attachment.status === 'invalid';
              const footer = isExpired ? (
                <span style={{ fontSize: 12, color: 'var(--color-error)' }}>{t('attachments.expiredLabel')}</span>
              ) : isInvalid ? (
                <span style={{ fontSize: 12, color: 'var(--color-error)' }}>{t('attachments.invalidLabel')}</span>
              ) : isError && onRetryAttachment ? (
                <Button
                  type="text"
                  size="small"
                  data-testid={`attachment-retry-${attachment.localId}`}
                  onClick={() => void onRetryAttachment(attachment.localId)}
                  style={{ padding: 0, height: 20, minWidth: 0, fontSize: 12, color: 'var(--color-error)' }}
                >
                  {t('common.retry')}
                </Button>
              ) : attachment.status === 'uploading' ? (
                `${Math.round(attachment.progressPercent)}%`
              ) : undefined;
              return (
                <AttachmentFileCard
                  key={attachment.localId}
                  testId={`attachment-item-${attachment.localId}`}
                  fileName={attachment.fileName}
                  sizeBytes={attachment.sizeBytes}
                  isDark={hostTheme === 'evening'}
                  surface="composer"
                  footer={footer}
                  expired={isExpired || isInvalid}
                  onRemove={isExpired || isInvalid ? undefined : onRemoveAttachment ? () => onRemoveAttachment(attachment.localId) : undefined}
                  removeTestId={`attachment-remove-${attachment.localId}`}
                />
              );
            })}
          </div>
        )}

        {/* Text area row */}
        {hasSelectedChip && selectedSkillChip && (
          <div
            data-testid="selected-skill-area"
            style={{
              display: 'flex',
              alignItems: 'center',
              padding: '0 0 4px',
            }}
          >
            {selectedSkillChip}
          </div>
        )}
        {hasSelectedChip && selectedSkillChip && (
          <div
            style={{
              height: 1,
              background: 'var(--color-border)',
              margin: '0 4px',
              opacity: 0.5,
            }}
          />
        )}
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8 }}>
          {/* Center: textarea */}
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 6, flex: 1, minWidth: 0 }}>
            {(() => {
              const textareaEl = (
                <textarea
                  ref={textareaRef}
                  className="message-textarea-scroll"
                  data-testid="message-textarea"
                  value={message}
                  placeholder={t('composer.placeholder')}
                  disabled={disabled || submitting || !hasWritePermission}
                  onChange={(e) => handleTextChange(e.target.value)}
                  onKeyDown={handleKeyDown}
                  onPaste={handlePaste}
                  onBlur={() => setAssocOpen(false)}
                  onWheel={handleTextareaWheel}
                  onCompositionStart={() => setIsComposing(true)}
                  onCompositionEnd={() => {
                    setIsComposing(false);
                    const nextText = textareaRef.current?.value ?? '';
                    if (messageRef.current !== nextText) {
                      handleTextChange(nextText);
                    }
                  }}
                  style={{
                    ...taStyle,
                    flex: 1,
                    cursor: !hasWritePermission ? 'not-allowed' : 'text',
                  }}
                  rows={1}
                />
              );
              return !hasWritePermission ? <Tooltip title={t('auth.noWritePermission')}>{textareaEl}</Tooltip> : textareaEl;
            })()}
          </div>
        </div>

        {/* Bottom row: slash hint + More + submit buttons */}
        <Flex justify="space-between" align="flex-end">
          {inputOperator ? (
            <PiuRenderer
              piuInfo={inputOperator}
              theme={hostTheme}
              containerStyle={{ height: 20, display: 'flex', alignItems: 'center', flex: 1, marginRight: 16 }}
            />
          ) : (
            <div style={{ display: 'flex', alignItems: 'center' }}>
              <Typography.Text
                data-testid="slash-hint"
                type="secondary"
                onClick={() => {
                  resetHistoryNavigation();
                  setLocalNotice(null);
                  setMessageValue('/');
                  setSlashFilter('/');
                  setSlashOpen(true);
                  setHighlightedIndex(0);
                  textareaRef.current?.focus();
                }}
              >
                {t('composer.slashHintPrefix')}{' '}
                <Typography.Text code style={{ fontSize: 11 }}>
                  /
                </Typography.Text>{' '}
                {t('composer.slashHintSuffix')}
              </Typography.Text>
              {isNearLimit && (
                <span
                  data-testid="char-counter"
                  style={{
                    marginLeft: 8,
                    marginTop: 3,
                    fontSize: 12,
                    lineHeight: '18px',
                    color: hostTheme === 'evening' ? 'rgba(147,147,147,1)' : 'rgba(174,174,174,1)',
                  }}
                >
                  {t('composer.charCount', { count: message.length, max: LONG_TEXT_THRESHOLD })}
                </span>
              )}
            </div>
          )}

          <Flex align="flex-end" style={{ flexShrink: 0 }}>
            {showRetryLatestButton && onRetryLatest ? (
              <AuthGate requiredOps={[AICOServiceOperation.Write]}>
                <Tooltip title={retryLatestDisabled ? t('turn.retryLimitReached') : undefined}>
                  <span
                    style={{
                      display: 'inline-flex',
                      cursor: retryLatestDisabled ? 'not-allowed' : undefined,
                    }}
                  >
                    <Button
                      type="text"
                      size="small"
                      data-testid="btn-retry-latest"
                      icon={<RedoOutlined />}
                      disabled={retryLatestDisabled}
                      onClick={() => void onRetryLatest()}
                      style={{
                        fontSize: 11,
                        height: 20,
                        padding: '0 4px',
                        color: 'var(--color-text-secondary)',
                      }}
                    >
                      {t('common.retry')}
                    </Button>
                  </span>
                </Tooltip>
              </AuthGate>
            ) : null}
            {(onReloadConversation || onClearConversation) && (
              <div style={{ flexShrink: 0, marginRight: 6 }}>
                <Dropdown
                  trigger={['click']}
                  open={showMoreMenu}
                  onOpenChange={setShowMoreMenu}
                  menu={{
                    items: [
                      ...(onReloadConversation
                        ? [
                            {
                              key: 'reload',
                              icon: <ReloadOutlined />,
                              label: t('composer.reloadConversation'),
                              disabled: isReloading || !hasWritePermission,
                              onClick: () => {
                                onReloadConversation();
                                setShowMoreMenu(false);
                              },
                            },
                          ]
                        : []),
                      ...(onClearConversation
                        ? [
                            {
                              key: 'clear',
                              icon: <DeleteOutlined />,
                              label: t('composer.clearConversation'),
                              disabled: !hasWritePermission,
                              onClick: () => {
                                onClearConversation();
                                setShowMoreMenu(false);
                              },
                            },
                          ]
                        : []),
                    ],
                  }}
                >
                  <Button
                    type="text"
                    size="small"
                    data-testid="btn-more-menu"
                    style={{
                      fontSize: 11,
                      height: 20,
                      padding: '0 4px',
                      color: 'var(--color-text-secondary)',
                    }}
                  >
                    {t('composer.more')}
                  </Button>
                </Dropdown>
              </div>
            )}

            {/* Attach button */}
            <AuthGate requiredOps={[AICOServiceOperation.Write]}>
              {isUploadConfigured ? (
                <Tooltip title={t('composer.uploadFile')}>
                  <Button
                    type="text"
                    icon={<PaperClipOutlined style={{ fontSize: 20 }} />}
                    size="small"
                    onClick={() => fileInputRef.current?.click()}
                    style={{
                      flexShrink: 0,
                      width: 32,
                      height: 32,
                      borderRadius: '50%',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      color: 'var(--color-text-secondary)',
                      marginRight: 8,
                      marginTop: 2,
                    }}
                    data-testid="attach-button"
                  />
                </Tooltip>
              ) : (
                <Tooltip title={t('attachments.uploadNotConfigured')}>
                  <Button
                    type="text"
                    icon={<PaperClipOutlined style={{ fontSize: 20 }} />}
                    size="small"
                    disabled
                    style={{
                      flexShrink: 0,
                      width: 32,
                      height: 32,
                      borderRadius: '50%',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      color: 'var(--color-text-tertiary)',
                      opacity: 0.45,
                      marginRight: 8,
                      marginTop: 2,
                    }}
                    data-testid="attach-button"
                  />
                </Tooltip>
              )}
            </AuthGate>

            {/* Submit/edit/stop buttons */}
            <Space size={4} align="end" style={{ flexShrink: 0 }}>
              {mode === 'edit' ? (
                <>
                  <AuthGate requiredOps={[AICOServiceOperation.Write]}>
                    <Button
                      type="default"
                      shape="circle"
                      icon={<CloseCircleOutlined />}
                      size="small"
                      data-testid="btn-cancel-edit"
                      onClick={onCancelEdit}
                      style={{ width: 28, height: 28 }}
                    />
                  </AuthGate>
                  <AuthGate requiredOps={[AICOServiceOperation.Write]}>
                    <Button
                      type="text"
                      data-testid="btn-confirm-edit"
                      className="send-btn"
                      disabled={!message.trim() || submitting || isExecuting}
                      loading={submitting}
                      onClick={handleSubmit}
                    >
                      {submitting ? <Spin size="small" /> : <SendIcon disabled={!message.trim()} />}
                    </Button>
                  </AuthGate>
                </>
              ) : isExecuting && onStop ? (
                <AuthGate requiredOps={[AICOServiceOperation.Write]}>
                  <div className="stop-button" data-testid="btn-stop" onClick={onStop}>
                    <StopResponseIcon />
                    <span className="stop-text">{t('composer.stopResponse')}</span>
                  </div>
                </AuthGate>
              ) : (
                <AuthGate requiredOps={[AICOServiceOperation.Write]}>
                  <Button
                    type="text"
                    data-testid="btn-send"
                    className="send-btn"
                    disabled={submitDisabled}
                    loading={submitting}
                    onClick={handleSubmit}
                  >
                    {submitting ? <Spin size="small" /> : <SendIcon disabled={submitDisabled} />}
                  </Button>
                </AuthGate>
              )}
            </Space>
          </Flex>
        </Flex>

        {/* Hidden file input */}
        {isUploadConfigured && (
          <AuthWrapper requiredOps={[AICOServiceOperation.Write]}>
            <input
              ref={fileInputRef}
              type="file"
              accept={buildAcceptAttribute(runtimeConfig.chatUploadFileConfig?.chatUploadFileType)}
              multiple
              onChange={handleFileChange}
              style={{ display: 'none' }}
            />
          </AuthWrapper>
        )}
      </div>
    </div>
  );
});
