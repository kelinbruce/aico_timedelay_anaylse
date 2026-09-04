import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type ReactNode } from 'react';
import { App as AntdApp, Modal, Pagination } from 'antd';
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';
import { memoryService } from '../services/memoryService.ts';
import { getSubjectId, isApiError } from '../services/apiClient.ts';
import { getCurrentLocale, type SupportedLocale } from '../i18n/index.ts';
import { redactMemoryDisplayText } from '../features/memory/redactMemoryDisplayText.ts';
import {
  MEMORY_IMPORT_MAX_BYTES,
  MemoryTransferError,
  createMemoryExport,
  downloadMemoryExport,
  downloadMemoryImportTemplate,
  memoryExportFileName,
  parseMemoryImport,
  toBatchCreateItem,
  type MemoryTransferEntry,
} from '../features/memory/memoryTransfer.ts';
import type {
  ListLongTermMemoryParams,
  LongTermMemoryRecord,
  LongTermMemorySummary,
  KnowledgeSourceType,
  MemoryOwnerScope,
  MemoryState,
  MemoryType,
  SharedMemorySummary,
  SharingLongTermMemoryReq,
} from '../state/contracts.ts';
import './MemoryManagePage.css';
import { AuthGate } from '../features/auth/AuthGate.tsx';
import { AICOServiceOperation } from '../features/auth/authEnums.ts';

const DEFAULT_INSTANCE = 'defaultInstance';
const SEARCH_QUERY_MAX_CODE_POINTS = 128;
const MEMORY_PAGE_SIZE_OPTIONS = [10, 20, 50] as const;
const DEFAULT_MEMORY_PAGE_SIZE = 10;

const typeChipClass: Record<string, string> = {
  FACTUAL: 'fact',
  CONCEPTUAL: 'concept',
  PROCEDURAL: 'proc',
  USER_CHARACTERISTICS: 'user',
};

function createTypeLabels(t: TFunction): Record<string, string> {
  return {
    FACTUAL: t('memoryManagement.types.factual'),
    CONCEPTUAL: t('memoryManagement.types.conceptual'),
    PROCEDURAL: t('memoryManagement.types.procedural'),
    USER_CHARACTERISTICS: t('memoryManagement.types.userCharacteristics'),
  };
}

function createSourceLabels(t: TFunction): Record<string, string> {
  return {
    LEARNED: t('memoryManagement.sources.learned'),
    CONFIGURED: t('memoryManagement.sources.configured'),
    SYSTEM_DEFAULT: t('memoryManagement.sources.systemDefault'),
  };
}

function safeLabel(map: Record<string, string>, key: string | undefined | null, fallback = '-'): string {
  if (key === undefined || key === null) {
    return fallback;
  }
  return map[key] ?? fallback;
}

function safeChipClass(map: Record<string, string>, key: string | undefined | null): string {
  if (key === undefined || key === null) {
    return '';
  }
  return map[key] ?? '';
}

function safeArr<T>(val: readonly T[] | undefined | null): readonly T[] {
  return Array.isArray(val) ? val : [];
}

function safeNum(val: unknown): number {
  return typeof val === 'number' && Number.isFinite(val) ? val : 0;
}

function safeStr(val: unknown): string {
  return typeof val === 'string' ? val : '';
}

function memoryDisplayText(val: unknown): string {
  return redactMemoryDisplayText(safeStr(val));
}

function unicodeCodePointLength(value: string): number {
  let count = 0;
  for (const _codePoint of value) {
    count += 1;
  }
  return count;
}

function formatMemoryContent(content: string): { readonly text: string; readonly isJson: boolean } {
  const normalized = memoryDisplayText(content);
  if (!normalized.trim()) {
    return { text: normalized, isJson: false };
  }

  try {
    const parsed: unknown = JSON.parse(normalized);
    if (typeof parsed === 'object' && parsed !== null) {
      return { text: JSON.stringify(parsed, null, 2), isJson: true };
    }
  } catch {
    // Non-JSON memory content is displayed unchanged.
  }

  return { text: normalized, isJson: false };
}

function MemoryContent({ content }: { readonly content: string }): ReactNode {
  const formatted = formatMemoryContent(content);
  if (formatted.isJson) {
    return (
      <pre className="ltm-markdown ltm-json" data-testid="memory-json-content">
        <span className="ltm-markdown-content">{formatted.text}</span>
      </pre>
    );
  }

  return (
    <div className="ltm-markdown" data-testid="memory-text-content">
      <span className="ltm-markdown-content">{formatted.text}</span>
    </div>
  );
}

function epochToDate(ms: number, locale: SupportedLocale): string {
  if (!ms || !Number.isFinite(ms)) {
    return '-';
  }
  return new Intl.DateTimeFormat(locale, {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(ms));
}

function epochToDateShort(ms: number, locale: SupportedLocale): string {
  if (!ms || !Number.isFinite(ms)) {
    return '-';
  }
  return new Intl.DateTimeFormat(locale, {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(ms));
}

function pct(c: number): number {
  return Math.round(safeNum(c) * 100);
}
function confidenceBarClass(confidence: unknown): string {
  return `ltm-bar ${safeNum(confidence) < 0.6 ? 'low' : ''}`;
}
function parseLabels(text: string): string[] {
  return text
    .split(/[，,、\s]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}
function labelsToText(labels: readonly string[], locale: SupportedLocale): string {
  return safeArr(labels).join(locale === 'zh-CN' ? '，' : ', ');
}

function sharingLabel(state: string, t: TFunction): string {
  if (state === 'SHARED') {
    return t('memoryManagement.sharing.shared');
  }
  if (state === 'FORK') {
    return t('memoryManagement.sharing.fork');
  }
  return t('memoryManagement.sharing.private');
}

function errMsg(err: unknown, fallback: string): string {
  if (isApiError(err)) {
    return err.error || fallback;
  }
  if (err instanceof Error) {
    return err.message || fallback;
  }
  return fallback;
}

function isDeletedMemoryError(err: unknown): boolean {
  return isApiError(err) && (err.status === 404 || err.code === 'LTM_MEMORY_NOT_FOUND' || err.code === 'INVALID_BRAND_VALUE');
}

const CONFIGURED_MEMORY_CAPACITY_MESSAGE = 'At most 50 configured long-term memories are allowed.';

function operationErrMsg(err: unknown, fallback: string, t: TFunction): string {
  if (isApiError(err) && err.code === 'LTM_CONTENT_GUARD_BLOCKED') {
    return t('memoryManagement.messages.contentGuardBlocked');
  }
  if (isApiError(err) && err.code === 'LTM_WRITE_INVALID' && err.error === CONFIGURED_MEMORY_CAPACITY_MESSAGE) {
    return t('memoryManagement.messages.capacityExceeded');
  }
  return errMsg(err, fallback);
}

function transferErrMsg(err: unknown, t: TFunction): string {
  if (!(err instanceof MemoryTransferError)) {
    return t('memoryManagement.transfer.operationFailed');
  }
  if (err.code === 'FILE_TOO_LARGE') {
    return t('memoryManagement.transfer.fileTooLarge');
  }
  if (err.code === 'INVALID_UTF8') {
    return t('memoryManagement.transfer.invalidUtf8');
  }
  if (err.code === 'INVALID_JSON') {
    return t('memoryManagement.transfer.invalidJson');
  }
  if (err.code === 'UNSUPPORTED_FORMAT') {
    return t('memoryManagement.transfer.unsupportedFormat');
  }
  if (err.code === 'INVALID_ITEM_COUNT') {
    return t('memoryManagement.transfer.invalidItemCount');
  }
  return t('memoryManagement.transfer.invalidItem', { item: err.rowNumber ?? 0 });
}

type View = 'mine' | 'shared' | 'expiring';
type Mode = 'detail' | 'edit' | 'create';
type TransferOperation = 'import' | 'export';
const CONFIGURED_MEMORY_CAPACITY = 50;

interface Metrics {
  mine: number;
  shared: number;
  archived: number;
}
interface Filters {
  q: string;
  memoryType: string;
  knowledgeSourceType: string;
  isPinned: string;
}
type MemoryExportFilter = Pick<ListLongTermMemoryParams, 'queryText' | 'memoryType' | 'knowledgeSourceType' | 'isPinned'>;
interface PendingMemoryImport {
  readonly fileName: string;
  readonly importBatchId: string;
  readonly memories: readonly MemoryTransferEntry[];
  readonly unknownResult: boolean;
}
const emptyFilters: Filters = { q: '', memoryType: '', knowledgeSourceType: '', isPinned: '' };
const DEFAULT_MANUAL_MEMORY_TYPE: MemoryType = 'USER_CHARACTERISTICS';

export function MemoryManagePage(): ReactNode {
  const { t } = useTranslation();
  const { message: messageApi, modal: modalApi } = AntdApp.useApp();
  const locale = getCurrentLocale();
  const typeLabel = useMemo(() => createTypeLabels(t), [t]);
  const sourceLabel = useMemo(() => createSourceLabels(t), [t]);
  const scope: MemoryOwnerScope = useMemo(
    () => ({
      memoryInstance: DEFAULT_INSTANCE,
    }),
    [],
  );

  const [view, setView] = useState<View>('mine');
  const [mode, setMode] = useState<Mode>('detail');
  const [filters, setFilters] = useState<Filters>(emptyFilters);
  const [selectedMemoryId, setSelectedMemoryId] = useState<string>('');
  const [selectedSharedId, setSelectedSharedId] = useState<string>('');
  const [listLoading, setListLoading] = useState(false);
  const [listError, setListError] = useState<string>('');
  const [summaries, setSummaries] = useState<readonly LongTermMemorySummary[]>([]);
  const [sharedSummaries, setSharedSummaries] = useState<readonly SharedMemorySummary[]>([]);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detail, setDetail] = useState<LongTermMemoryRecord | null>(null);
  const [metrics, setMetrics] = useState<Metrics>({ mine: 0, shared: 0, archived: 0 });
  const [publishedMap, setPublishedMap] = useState<Map<string, string>>(new Map());
  const [actionLoading, setActionLoading] = useState(false);
  const [transferLoading, setTransferLoading] = useState<TransferOperation | null>(null);
  const [pendingImport, setPendingImport] = useState<PendingMemoryImport | null>(null);
  const [existingMemoryCount, setExistingMemoryCount] = useState<number | null>(null);
  const [capacityLoading, setCapacityLoading] = useState(false);
  const [capacityError, setCapacityError] = useState(false);
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState<number>(DEFAULT_MEMORY_PAGE_SIZE);
  const [listTotal, setListTotal] = useState(0);
  const totalPages = Math.max(1, Math.ceil(listTotal / pageSize));

  // Request sequence guards to prevent stale responses overwriting current state
  const listSeqRef = useRef(0);
  const detailSeqRef = useRef(0);
  const countSeqRef = useRef(0);
  // Search debounce
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const importInputRef = useRef<HTMLInputElement | null>(null);
  const transferLockRef = useRef(false);
  const capacitySeqRef = useRef(0);
  const [searchQ, setSearchQ] = useState('');
  const searchLength = unicodeCodePointLength(searchQ);
  const searchTooLong = searchLength > SEARCH_QUERY_MAX_CODE_POINTS;

  useEffect(() => {
    if (searchTimerRef.current) {
      clearTimeout(searchTimerRef.current);
      searchTimerRef.current = null;
    }
    if (searchTooLong) {
      return undefined;
    }
    searchTimerRef.current = setTimeout(() => {
      setFilters((f) => (f.q === searchQ ? f : { ...f, q: searchQ }));
    }, 350);
    return () => {
      if (searchTimerRef.current) {
        clearTimeout(searchTimerRef.current);
      }
    };
  }, [searchQ, searchTooLong]);

  const clearSearch = useCallback(() => {
    if (searchTimerRef.current) {
      clearTimeout(searchTimerRef.current);
      searchTimerRef.current = null;
    }
    setSearchQ('');
    setFilters((current) => (current.q ? { ...current, q: '' } : current));
    setPage(0);
  }, []);

  const loadCounts = useCallback(async (): Promise<void> => {
    const seq = ++countSeqRef.current;
    try {
      const totals = await memoryService.getLongTermMemoryTabTotals(scope);
      if (seq !== countSeqRef.current) {
        return;
      }
      if (!totals) {
        return;
      }
      setMetrics((current) => ({
        mine: totals.mine === undefined ? current.mine : safeNum(totals.mine),
        shared: totals.shared === undefined ? current.shared : safeNum(totals.shared),
        archived: totals.archived === undefined ? current.archived : safeNum(totals.archived),
      }));
    } catch {
      // Tab totals are supplementary and must not block the current list.
    }
  }, [scope]);

  const loadSharedListPage = useCallback(
    async (pageToLoad: number, seq: number): Promise<void> => {
      const sharedPage = await memoryService.listPublishedLongTermMemory({
        memoryInstance: scope.memoryInstance,
        ...(filters.q.trim() ? { queryText: filters.q.trim() } : {}),
        ...(filters.memoryType ? { memoryType: filters.memoryType as MemoryType } : {}),
        limit: pageSize,
        offset: pageToLoad * pageSize,
      });
      if (seq !== listSeqRef.current) {
        return;
      }
      const items = safeArr(sharedPage?.items);
      const total = safeNum(sharedPage?.total);
      if (items.length === 0 && pageToLoad > 0 && pageToLoad * pageSize >= total) {
        setPage(Math.max(0, Math.ceil(total / pageSize) - 1));
        return;
      }
      setSharedSummaries(items);
      setSelectedSharedId((current) => (items.some((item) => item.memoryId === current) ? current : safeStr(items[0]?.memoryId)));
      setListTotal(total);
      const map = new Map<string, string>();
      for (const item of items) {
        if (safeStr(item.sourceMemoryId)) {
          map.set(safeStr(item.sourceMemoryId), item.memoryId);
        }
      }
      setPublishedMap(map);
    },
    [scope, filters, pageSize],
  );

  const loadMineListPage = useCallback(
    async (pageToLoad: number, seq: number): Promise<void> => {
      const params: ListLongTermMemoryParams = {
        ...scope,
        state: view === 'expiring' ? 'ARCHIVED' : 'ACTIVE',
        limit: pageSize,
        offset: pageToLoad * pageSize,
        ...(filters.q.trim() ? { queryText: filters.q.trim() } : {}),
        ...(filters.memoryType ? { memoryType: filters.memoryType as MemoryType } : {}),
        ...(filters.knowledgeSourceType ? { knowledgeSourceType: filters.knowledgeSourceType as never } : {}),
        ...(filters.isPinned === 'pinned' ? { isPinned: true } : filters.isPinned === 'unpinned' ? { isPinned: false } : {}),
      };
      const listPage = await memoryService.listLongTermMemory(params);
      if (seq !== listSeqRef.current) {
        return;
      }
      const total = safeNum(listPage?.total);
      const items = safeArr(listPage?.items);
      if (items.length === 0 && pageToLoad > 0 && pageToLoad * pageSize >= total) {
        setPage(Math.max(0, Math.ceil(total / pageSize) - 1));
        return;
      }
      setListTotal(total);
      setSummaries(items);
      setSelectedMemoryId((current) => (items.some((item) => item.memoryId === current) ? current : safeStr(items[0]?.memoryId)));
    },
    [scope, filters, view, pageSize],
  );

  const loadList = useCallback(
    async (pageOverride?: number): Promise<void> => {
      const seq = ++listSeqRef.current;
      const pageToLoad = pageOverride ?? page;
      setListLoading(true);
      setListError('');
      try {
        if (view === 'shared') {
          await loadSharedListPage(pageToLoad, seq);
        } else {
          await loadMineListPage(pageToLoad, seq);
        }
      } catch (err) {
        if (seq === listSeqRef.current) {
          setListError(errMsg(err, t('memoryManagement.messages.loadFailed')));
        }
      } finally {
        if (seq === listSeqRef.current) {
          setListLoading(false);
        }
      }
    },
    [view, page, loadSharedListPage, loadMineListPage, t],
  );

  const loadDetail = useCallback(
    async (memoryId: string) => {
      if (!memoryId) {
        setDetail(null);
        return;
      }
      const seq = ++detailSeqRef.current;
      setDetailLoading(true);
      try {
        const record = await memoryService.getLongTermMemory(memoryId, scope);
        if (seq !== detailSeqRef.current) {
          return;
        }
        setDetail(record);
      } catch (err) {
        if (seq !== detailSeqRef.current) {
          return;
        }
        setDetail(null);
        if (isDeletedMemoryError(err)) {
          setSelectedMemoryId('');
          setSelectedSharedId('');
          messageApi.error(t('memoryManagement.messages.recordDeleted'));
          void loadList();
          void loadCounts();
        } else {
          messageApi.error(errMsg(err, t('memoryManagement.messages.detailLoadFailed')));
        }
      } finally {
        if (seq === detailSeqRef.current) {
          setDetailLoading(false);
        }
      }
    },
    [loadCounts, loadList, messageApi, scope, t],
  );

  useEffect(() => {
    void loadList();
  }, [loadList]);
  useEffect(() => {
    void loadCounts();
  }, [loadCounts]);
  useEffect(() => {
    setPage(0);
  }, [filters.memoryType, filters.knowledgeSourceType, filters.isPinned, filters.q]);
  useEffect(() => {
    if ((view === 'mine' || view === 'expiring') && selectedMemoryId) {
      void loadDetail(selectedMemoryId);
    } else {
      setDetail(null);
    }
  }, [selectedMemoryId, view, loadDetail]);

  const refreshAll = useCallback(
    (refreshCounts = false, keepCurrentPage = false) => {
      if (keepCurrentPage) {
        void loadList();
      } else {
        // setPage(0) 会让 loadList 重建并触发其 useEffect 重新加载；
        // 已在第 1 页时 effect 不会重跑，需要手动加载一次。
        setPage((current) => {
          if (current !== 0) {
            return 0;
          }
          void loadList(0);
          return current;
        });
      }
      if (refreshCounts) {
        void loadCounts();
      }
    },
    [loadCounts, loadList],
  );

  const withLoading = useCallback(
    async <T,>(fn: () => Promise<T>): Promise<T | undefined> => {
      setActionLoading(true);
      try {
        return await fn();
      } catch (err) {
        if (isDeletedMemoryError(err)) {
          setSelectedMemoryId('');
          setSelectedSharedId('');
          setDetail(null);
          setMode('detail');
          messageApi.error(t('memoryManagement.messages.recordDeleted'));
          refreshAll(true);
        } else {
          messageApi.error(operationErrMsg(err, t('memoryManagement.messages.operationFailed'), t));
        }
        return undefined;
      } finally {
        setActionLoading(false);
      }
    },
    [messageApi, refreshAll, t],
  );

  const handlePin = useCallback(
    async (record: LongTermMemoryRecord, pinned: boolean) => {
      const result = await withLoading(() =>
        memoryService.patchLongTermMemory(record.memoryId, {
          memoryInstance: scope.memoryInstance,
          isPinned: pinned,
          expectedVersion: record.version,
        }),
      );
      if (result === undefined) {
        return;
      }
      messageApi.success(pinned ? t('memoryManagement.messages.pinned') : t('memoryManagement.messages.automatic'));
      refreshAll(false, true);
      void loadDetail(record.memoryId);
    },
    [scope, refreshAll, loadDetail, messageApi, t, withLoading],
  );

  const handleArchive = useCallback(
    async (record: LongTermMemoryRecord) => {
      if (record.isPinned) {
        messageApi.warning(t('memoryManagement.messages.archivePinnedWarning'));
        return;
      }
      modalApi.confirm({
        title: t('memoryManagement.messages.archiveConfirmTitle'),
        content: t('memoryManagement.messages.archiveConfirmContent'),
        okText: t('memoryManagement.messages.archiveConfirm'),
        cancelText: t('memoryManagement.form.cancel'),
        onOk: async () => {
          const result = await withLoading(() =>
            memoryService.patchLongTermMemory(record.memoryId, {
              memoryInstance: scope.memoryInstance,
              targetState: 'ARCHIVED',
              archiveReason: 'user_archive',
              expectedVersion: record.version,
            }),
          );
          if (result === undefined) {
            return;
          }
          messageApi.success(t('memoryManagement.messages.archived'));
          setView('expiring');
          refreshAll(true);
        },
      });
    },
    [scope, refreshAll, messageApi, modalApi, t, withLoading],
  );

  const handleUnarchive = useCallback(
    async (record: LongTermMemoryRecord) => {
      const result = await withLoading(() =>
        memoryService.patchLongTermMemory(record.memoryId, {
          memoryInstance: scope.memoryInstance,
          targetState: 'ACTIVE',
          expectedVersion: record.version,
        }),
      );
      if (result === undefined) {
        return;
      }
      messageApi.success(t('memoryManagement.messages.unarchived'));
      setView('mine');
      refreshAll(true);
    },
    [scope, refreshAll, messageApi, t, withLoading],
  );

  const handleDelete = useCallback(
    async (record: LongTermMemoryRecord) => {
      modalApi.confirm({
        title: t('memoryManagement.messages.deleteConfirmTitle'),
        content: t('memoryManagement.messages.deleteConfirmContent'),
        okText: t('memoryManagement.messages.deleteConfirm'),
        okType: 'danger',
        cancelText: t('memoryManagement.form.cancel'),
        onOk: async () => {
          const result = await withLoading(() => memoryService.deleteLongTermMemory(record.memoryId, scope, 'user_delete'));
          if (result === undefined) {
            return;
          }
          messageApi.success(t('memoryManagement.messages.deleted'));
          setSelectedMemoryId('');
          void loadList();
          void loadCounts();
        },
      });
    },
    [scope, loadCounts, loadList, messageApi, modalApi, t, withLoading],
  );

  const handleSave = useCallback(
    async (data: {
      memoryId?: string;
      memoryType: MemoryType;
      knowledgeSourceType: KnowledgeSourceType;
      confidence: number;
      briefIndex: string;
      content: string;
      labels: string[];
    }) => {
      const result = await withLoading(() =>
        memoryService.manualSaveLongTermMemory({
          ...(data.memoryId ? { memoryId: data.memoryId } : {}),
          memoryInstance: scope.memoryInstance,
          memoryType: data.memoryType,
          knowledgeSourceType: data.knowledgeSourceType,
          briefIndex: data.briefIndex,
          content: data.content,
          labels: data.labels,
          confidence: data.confidence,
        }),
      );
      if (result === undefined) {
        return;
      }
      messageApi.success(data.memoryId ? t('memoryManagement.messages.changesSaved') : t('memoryManagement.messages.memoryCreated'));
      setMode('detail');
      if (data.memoryId) {
        setSelectedMemoryId(data.memoryId);
        await loadDetail(data.memoryId);
      }
      refreshAll(!data.memoryId, Boolean(data.memoryId));
    },
    [scope, refreshAll, loadDetail, messageApi, t, withLoading],
  );

  // Fix problem 13: detail panel "取消共享" should call unpublish, not publish
  const handlePublish = useCallback(
    async (record: LongTermMemoryRecord) => {
      const publishedCopyId = publishedMap.get(record.memoryId);
      if (publishedCopyId !== undefined) {
        const result = await withLoading(() => {
          const req: SharingLongTermMemoryReq = { memoryInstance: scope.memoryInstance, reasonCode: 'user_unpublish' };
          return memoryService.unpublishLongTermMemory(publishedCopyId, req);
        });
        if (result === undefined) {
          return;
        }
        setPublishedMap((prev) => {
          const next = new Map(prev);
          next.delete(record.memoryId);
          return next;
        });
        messageApi.success(t('memoryManagement.messages.unpublished'));
        refreshAll(true, true);
      } else {
        const result = await withLoading(() => {
          const req: SharingLongTermMemoryReq = { memoryInstance: scope.memoryInstance, reasonCode: 'user_publish' };
          return memoryService.publishLongTermMemory(record.memoryId, req);
        });
        if (result === undefined) {
          return;
        }
        setPublishedMap((prev) => new Map(prev).set(record.memoryId, result.publishedMemory.memoryId));
        messageApi.success(t('memoryManagement.messages.published'));
        setView('shared');
        refreshAll(true);
      }
    },
    [scope, refreshAll, messageApi, t, withLoading, publishedMap],
  );

  const handleUnpublish = useCallback(
    async (shared: SharedMemorySummary) => {
      const result = await withLoading(() => {
        const req: SharingLongTermMemoryReq = { memoryInstance: scope.memoryInstance, reasonCode: 'user_unpublish' };
        return memoryService.unpublishLongTermMemory(shared.memoryId, req);
      });
      if (result === undefined) {
        return;
      }
      messageApi.success(t('memoryManagement.messages.unpublished'));
      refreshAll(true, true);
    },
    [scope, refreshAll, messageApi, t, withLoading],
  );

  const handleCopy = useCallback(
    async (shared: SharedMemorySummary) => {
      const result = await withLoading(() =>
        memoryService.copyPublishedMemory({ memoryIds: [shared.memoryId], memoryInstance: scope.memoryInstance, reasonCode: 'user_copy' }),
      );
      if (result === undefined) {
        return;
      }
      const forked = safeArr(result)[0];
      if (forked?.copyStatus === 'COPIED') {
        messageApi.success(t('memoryManagement.messages.copied'));
        setView('mine');
        setMode('detail');
        setFilters(emptyFilters);
        setSearchQ('');
        setPage(0);
        setSelectedMemoryId('');
        setSelectedSharedId('');
        void loadCounts();
      } else if (forked?.copyStatus === 'EXISTING') {
        messageApi.warning(
          t(forked.record.state === 'ARCHIVED' ? 'memoryManagement.messages.copyExistsArchived' : 'memoryManagement.messages.copyExistsActive'),
        );
      } else {
        messageApi.warning(t('memoryManagement.messages.copyMissing'));
      }
    },
    [scope, loadCounts, messageApi, t, withLoading],
  );

  const handleCopyContent = useCallback(
    async (content: string) => {
      try {
        if (navigator.clipboard?.writeText === undefined) {
          throw new Error('Clipboard API unavailable');
        }
        await navigator.clipboard.writeText(safeStr(content));
        messageApi.success(t('memoryManagement.messages.contentCopied'));
      } catch {
        messageApi.error(t('memoryManagement.messages.copyContentFailed'));
      }
    },
    [messageApi, t],
  );

  const refreshAfterImport = useCallback(() => {
    setView('mine');
    setMode('detail');
    setPage(0);
    setFilters(emptyFilters);
    setSearchQ('');
    setSelectedMemoryId('');
    void loadList();
    void loadCounts();
  }, [loadCounts, loadList]);

  const readExistingMemoryCount = useCallback(async (): Promise<number> => {
    const [active, archived] = await Promise.all([
      memoryService.listLongTermMemory({
        ...scope,
        knowledgeSourceType: 'CONFIGURED',
        state: 'ACTIVE',
        limit: 1,
        offset: 0,
      }),
      memoryService.listLongTermMemory({
        ...scope,
        knowledgeSourceType: 'CONFIGURED',
        state: 'ARCHIVED',
        limit: 1,
        offset: 0,
      }),
    ]);
    if (!Number.isInteger(active.total) || active.total < 0 || !Number.isInteger(archived.total) || archived.total < 0) {
      throw new Error('Memory capacity API returned an invalid total.');
    }
    return active.total + archived.total;
  }, [scope]);

  const refreshImportCapacity = useCallback(async (): Promise<number | null> => {
    const seq = ++capacitySeqRef.current;
    setCapacityLoading(true);
    setCapacityError(false);
    try {
      const count = await readExistingMemoryCount();
      if (seq !== capacitySeqRef.current) {
        return null;
      }
      setExistingMemoryCount(count);
      return count;
    } catch {
      if (seq !== capacitySeqRef.current) {
        return null;
      }
      setExistingMemoryCount(null);
      setCapacityError(true);
      return null;
    } finally {
      if (seq === capacitySeqRef.current) {
        setCapacityLoading(false);
      }
    }
  }, [readExistingMemoryCount]);

  const handleImportFile = useCallback(
    async (file: File) => {
      const replacingEmptyPreview = pendingImport !== null && pendingImport.memories.length === 0;
      if (transferLockRef.current || transferLoading !== null || actionLoading || (pendingImport !== null && !replacingEmptyPreview)) {
        return;
      }
      const lowerName = file.name.toLowerCase();
      if (!lowerName.endsWith('.json')) {
        messageApi.error(t('memoryManagement.transfer.unsupportedFormat'));
        return;
      }
      if (file.size > MEMORY_IMPORT_MAX_BYTES) {
        messageApi.error(t('memoryManagement.transfer.fileTooLarge'));
        return;
      }
      transferLockRef.current = true;
      setTransferLoading('import');
      try {
        const bytes = new Uint8Array(await file.arrayBuffer());
        const parsed = await parseMemoryImport(bytes, file.name, file.size);
        setPendingImport({
          fileName: file.name,
          importBatchId: crypto.randomUUID(),
          memories: parsed.memories,
          unknownResult: false,
        });
        setExistingMemoryCount(null);
        void refreshImportCapacity();
      } catch (err) {
        messageApi.error(transferErrMsg(err, t));
      } finally {
        transferLockRef.current = false;
        setTransferLoading(null);
      }
    },
    [actionLoading, messageApi, pendingImport, refreshImportCapacity, t, transferLoading],
  );

  const handleImportInput = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      const file = event.currentTarget.files?.[0];
      event.currentTarget.value = '';
      if (file !== undefined) {
        void handleImportFile(file);
      }
    },
    [handleImportFile],
  );

  const handleDownloadTemplate = useCallback(() => {
    if (transferLockRef.current || transferLoading !== null || actionLoading || pendingImport !== null) {
      return;
    }
    try {
      downloadMemoryImportTemplate(locale);
    } catch {
      messageApi.error(t('memoryManagement.transfer.operationFailed'));
    }
  }, [actionLoading, locale, messageApi, pendingImport, t, transferLoading]);

  const handleRemovePendingImport = useCallback(
    (sourceIndex: number) => {
      if (transferLockRef.current || transferLoading === 'import' || capacityLoading) {
        return;
      }
      const refreshAfterUnknown = pendingImport?.unknownResult === true;
      setPendingImport((current) =>
        current === null
          ? null
          : {
              ...current,
              memories: current.memories.filter((memory) => memory.sourceIndex !== sourceIndex),
              unknownResult: false,
            },
      );
      if (refreshAfterUnknown) {
        void refreshImportCapacity();
      }
    },
    [capacityLoading, pendingImport?.unknownResult, refreshImportCapacity, transferLoading],
  );

  const handleCancelImport = useCallback(() => {
    if (transferLockRef.current || transferLoading === 'import' || capacityLoading) {
      return;
    }
    capacitySeqRef.current += 1;
    setPendingImport(null);
    setExistingMemoryCount(null);
    setCapacityError(false);
  }, [capacityLoading, transferLoading]);

  const handleConfirmImport = useCallback(async () => {
    const current = pendingImport;
    if (current === null || current.memories.length === 0 || transferLockRef.current || transferLoading !== null) {
      return;
    }

    transferLockRef.current = true;
    try {
      setTransferLoading('import');
      const result = await memoryService.batchCreateLongTermMemory({
        memoryInstance: scope.memoryInstance,
        items: current.memories.map((entry) => toBatchCreateItem(entry, current.importBatchId)),
      });
      if (result.failCount > 0) {
        messageApi.warning(
          t('memoryManagement.transfer.importPartial', {
            success: result.successCount,
            failed: result.failCount,
          }),
        );
      } else {
        messageApi.success(t('memoryManagement.transfer.importSuccess', { success: result.successCount }));
      }
      capacitySeqRef.current += 1;
      setPendingImport(null);
      setExistingMemoryCount(null);
      setCapacityError(false);
      if (result.successCount > 0) {
        refreshAfterImport();
      }
    } catch (error) {
      const isKnownHttpRejection = isApiError(error) && error.kind === 'http' && error.status !== null && error.status >= 400 && error.status < 500;
      if (isKnownHttpRejection) {
        setPendingImport((latest) => (latest === null ? null : { ...latest, unknownResult: false }));
        messageApi.error(
          error.status === 404
            ? t('memoryManagement.transfer.importBatchUnavailable')
            : operationErrMsg(error, t('memoryManagement.transfer.operationFailed'), t),
        );
      } else {
        setPendingImport((latest) => (latest === null ? null : { ...latest, unknownResult: true }));
        messageApi.error(t('memoryManagement.transfer.importUnknown', { unknown: current.memories.length }));
      }
    } finally {
      transferLockRef.current = false;
      setTransferLoading(null);
    }
  }, [messageApi, pendingImport, refreshAfterImport, scope.memoryInstance, t, transferLoading]);

  const loadAllForState = useCallback(
    async (state: MemoryState, exportFilter: MemoryExportFilter): Promise<readonly LongTermMemorySummary[]> => {
      const items: LongTermMemorySummary[] = [];
      let offset = 0;
      for (;;) {
        const result = await memoryService.listLongTermMemory({
          ...exportFilter,
          memoryInstance: scope.memoryInstance,
          state,
          limit: 100,
          offset,
        });
        if (
          !Array.isArray(result?.items) ||
          !Number.isInteger(result.total) ||
          result.total < 0 ||
          result.offset !== offset ||
          result.limit !== 100 ||
          result.items.length > 100 ||
          offset + result.items.length > result.total
        ) {
          throw new Error('Memory export API returned an invalid page.');
        }
        if (result.items.length === 0 && items.length < result.total) {
          throw new Error('Memory export API returned an incomplete page.');
        }
        items.push(...result.items);
        if (items.length >= result.total) {
          return items;
        }
        offset += result.items.length;
      }
    },
    [scope.memoryInstance],
  );

  const handleExport = useCallback(async () => {
    if (view === 'shared' || searchTooLong || transferLockRef.current || transferLoading !== null || actionLoading || pendingImport !== null) {
      return;
    }
    transferLockRef.current = true;
    setTransferLoading('export');
    try {
      const exportFilter: MemoryExportFilter = {
        ...(searchQ.trim() ? { queryText: searchQ.trim() } : {}),
        ...(filters.memoryType ? { memoryType: filters.memoryType as MemoryType } : {}),
        ...(filters.knowledgeSourceType ? { knowledgeSourceType: filters.knowledgeSourceType as KnowledgeSourceType } : {}),
        ...(filters.isPinned === 'pinned' ? { isPinned: true } : filters.isPinned === 'unpinned' ? { isPinned: false } : {}),
      };
      const summaries = await loadAllForState(view === 'expiring' ? 'ARCHIVED' : 'ACTIVE', exportFilter);
      const exportedAt = new Date();
      downloadMemoryExport(createMemoryExport(summaries, locale), memoryExportFileName(exportedAt));
      messageApi.success(
        t(view === 'expiring' ? 'memoryManagement.transfer.exportArchivedSuccess' : 'memoryManagement.transfer.exportMineSuccess', {
          count: summaries.length,
        }),
      );
    } catch {
      messageApi.error(t('memoryManagement.transfer.exportFailed'));
    } finally {
      transferLockRef.current = false;
      setTransferLoading(null);
    }
  }, [actionLoading, filters, loadAllForState, locale, messageApi, pendingImport, searchQ, searchTooLong, t, transferLoading, view]);

  const operationLoading = actionLoading || transferLoading !== null || pendingImport !== null;
  const pendingImportCount = pendingImport?.memories.length ?? 0;
  const availableCapacity = existingMemoryCount === null ? null : Math.max(0, CONFIGURED_MEMORY_CAPACITY - existingMemoryCount);
  const importCapacityExceeded = existingMemoryCount !== null && existingMemoryCount + pendingImportCount > CONFIGURED_MEMORY_CAPACITY;
  const importConfirmDisabled = pendingImport === null || pendingImportCount === 0 || transferLoading === 'import';

  const tabItems: Array<{ key: View; label: string }> = [
    { key: 'mine', label: t('memoryManagement.tabs.mine') },
    { key: 'shared', label: t('memoryManagement.tabs.shared') },
    { key: 'expiring', label: t('memoryManagement.tabs.archived') },
  ];
  const tabCounts: Record<View, number> = {
    mine: metrics.mine,
    shared: metrics.shared,
    expiring: metrics.archived,
  };

  const filteredSummaries = useMemo(() => {
    if (view === 'shared') {
      return sharedSummaries;
    }
    return summaries;
  }, [view, summaries, sharedSummaries]);

  const filteredShared = useMemo(() => {
    if (view !== 'shared') {
      return [];
    }
    return sharedSummaries;
  }, [view, sharedSummaries]);

  return (
    <div className="ltm-app" data-testid="memory-manage-page">
      <header className="ltm-topbar">
        <div className="ltm-title-row">
          <h1 className="ltm-h1">{t('memoryManagement.title')}</h1>
        </div>
        <div className="ltm-topbar-actions">
          <input
            ref={importInputRef}
            className="ltm-file-input"
            type="file"
            accept=".json,application/json"
            aria-label={t('memoryManagement.transfer.import')}
            onChange={handleImportInput}
          />
          <AuthGate requiredOps={[AICOServiceOperation.Write]}>
            <button className="ltm-btn" disabled={operationLoading} onClick={() => importInputRef.current?.click()}>
              {transferLoading === 'import' ? t('memoryManagement.transfer.importing') : t('memoryManagement.transfer.import')}
            </button>
          </AuthGate>
          <button className="ltm-btn" disabled={operationLoading} onClick={handleDownloadTemplate}>
            {t('memoryManagement.transfer.downloadTemplate')}
          </button>
          {view !== 'shared' && (
            <button className="ltm-btn" disabled={operationLoading || searchTooLong} onClick={() => void handleExport()}>
              {transferLoading === 'export'
                ? t('memoryManagement.transfer.exporting')
                : view === 'expiring'
                  ? t('memoryManagement.transfer.exportArchived')
                  : t('memoryManagement.transfer.exportMine')}
            </button>
          )}
          {view === 'mine' && (
            <AuthGate requiredOps={[AICOServiceOperation.Write]}>
              <button
                className="ltm-btn primary"
                disabled={operationLoading}
                onClick={() => {
                  setMode('create');
                  setSelectedMemoryId('');
                }}
              >
                {t('memoryManagement.addMemory')}
              </button>
            </AuthGate>
          )}
        </div>
      </header>

      <main className="ltm-main nextagent-themed-scrollbar">
        <div className="ltm-workspace">
          <div className="ltm-panel ltm-list-panel">
            <div className="ltm-tabs">
              {tabItems.map((tab) => (
                <button
                  key={tab.key}
                  className={`ltm-tab ${view === tab.key ? 'active' : ''}`}
                  onClick={() => {
                    setView(tab.key);
                    setMode('detail');
                    setFilters(emptyFilters);
                    setSearchQ('');
                    setPage(0);
                    setSelectedMemoryId('');
                    setSelectedSharedId('');
                  }}
                >
                  {tab.label}
                  <span className="ltm-tab-count" aria-hidden="true" title={t('memoryManagement.tabs.count', { count: tabCounts[tab.key] })}>
                    {tabCounts[tab.key]}
                  </span>
                </button>
              ))}
            </div>

            <div className="ltm-filters">
              <div className="ltm-search-control">
                <input
                  className="ltm-control ltm-search-input"
                  placeholder={t('memoryManagement.searchPlaceholder')}
                  title={t('memoryManagement.searchLimitHint', { max: SEARCH_QUERY_MAX_CODE_POINTS })}
                  value={searchQ}
                  aria-invalid={searchTooLong}
                  aria-describedby={searchTooLong ? 'ltm-search-limit-error' : undefined}
                  onChange={(e) => setSearchQ(e.target.value)}
                />
                {searchQ && (
                  <button type="button" className="ltm-search-clear" aria-label={t('memoryManagement.clearSearch')} onClick={clearSearch}>
                    ×
                  </button>
                )}
                {searchTooLong && (
                  <span id="ltm-search-limit-error" className="ltm-search-error" role="alert">
                    {t('memoryManagement.searchLimitError', { count: searchLength, max: SEARCH_QUERY_MAX_CODE_POINTS })}
                  </span>
                )}
              </div>
              <select className="ltm-control" value={filters.memoryType} onChange={(e) => setFilters((f) => ({ ...f, memoryType: e.target.value }))}>
                <option value="">{t('memoryManagement.filters.allTypes')}</option>
                {Object.entries(typeLabel).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
              {view === 'mine' && (
                <select
                  className="ltm-control"
                  value={filters.knowledgeSourceType}
                  onChange={(e) => setFilters((f) => ({ ...f, knowledgeSourceType: e.target.value }))}
                >
                  <option value="">{t('memoryManagement.filters.allSources')}</option>
                  {(['CONFIGURED', 'LEARNED'] as const).map((value) => (
                    <option key={value} value={value}>
                      {sourceLabel[value]}
                    </option>
                  ))}
                </select>
              )}
              {view === 'mine' && (
                <select
                  className="ltm-control ltm-update-mode"
                  value={filters.isPinned}
                  onChange={(e) => setFilters((f) => ({ ...f, isPinned: e.target.value }))}
                >
                  <option value="">{t('memoryManagement.filters.allUpdateModes')}</option>
                  <option value="pinned">{t('memoryManagement.filters.pinned')}</option>
                  <option value="unpinned">{t('memoryManagement.filters.automatic')}</option>
                </select>
              )}
            </div>

            <div className={`ltm-list-head ${view === 'shared' ? 'ltm-head-shared' : view === 'expiring' ? 'ltm-head-expiring' : 'ltm-head-mine'}`}>
              {view === 'shared' ? (
                <>
                  <span>{t('memoryManagement.columns.summary')}</span>
                  <span>{t('memoryManagement.columns.type')}</span>
                  <span>{t('memoryManagement.columns.source')}</span>
                  <span>{t('memoryManagement.columns.owner')}</span>
                  <span>{t('memoryManagement.columns.confidence')}</span>
                  <span>{t('memoryManagement.columns.updatedAt')}</span>
                </>
              ) : view === 'expiring' ? (
                <>
                  <span>{t('memoryManagement.columns.summary')}</span>
                  <span>{t('memoryManagement.columns.type')}</span>
                  <span>{t('memoryManagement.columns.source')}</span>
                  <span>{t('memoryManagement.columns.status')}</span>
                  <span>{t('memoryManagement.columns.confidence')}</span>
                </>
              ) : (
                <>
                  <span>{t('memoryManagement.columns.summary')}</span>
                  <span>{t('memoryManagement.columns.type')}</span>
                  <span>{t('memoryManagement.columns.source')}</span>
                  <span>{t('memoryManagement.columns.confidence')}</span>
                  <span>{t('memoryManagement.columns.updatedAt')}</span>
                </>
              )}
            </div>

            <div className="ltm-rows nextagent-themed-scrollbar">
              {listLoading ? (
                <div className="ltm-spin">
                  <div className="ltm-spinner" />
                </div>
              ) : listError ? (
                <div className="ltm-empty">
                  {t('memoryManagement.list.loadFailed', { message: listError })}
                  <br />
                  <button className="ltm-btn" style={{ marginTop: 8 }} onClick={() => loadList()}>
                    {t('memoryManagement.list.retry')}
                  </button>
                </div>
              ) : view === 'shared' ? (
                filteredShared.length === 0 ? (
                  <div className="ltm-empty">{t('memoryManagement.list.empty')}</div>
                ) : (
                  filteredShared.map((item) => {
                    const active = item.memoryId === selectedSharedId && mode === 'detail';
                    const p = pct(item.confidence);
                    return (
                      <div
                        key={item.memoryId}
                        className={`ltm-memory-row ltm-row-shared ${active ? 'active' : ''}`}
                        onClick={() => {
                          setSelectedSharedId(item.memoryId);
                          setMode('detail');
                        }}
                      >
                        <div>
                          <div className="ltm-row-titleline">
                            <span className="ltm-row-title">{memoryDisplayText(item.briefIndex)}</span>
                          </div>
                          <div className="ltm-brief">{memoryDisplayText(item.content)}</div>
                        </div>
                        <span className={`ltm-chip ltm-type-chip ${safeChipClass(typeChipClass, item.memoryType)} ltm-hide-mobile`}>
                          {safeLabel(typeLabel, item.memoryType)}
                        </span>
                        <div className="ltm-muted-text ltm-hide-mobile">{safeLabel(sourceLabel, item.knowledgeSourceType)}</div>
                        <div className="ltm-muted-text ltm-hide-mobile">{safeStr(item.ownerUserName ?? item.ownerUserId)}</div>
                        <div className="ltm-confidence ltm-hide-mobile">
                          <div className={confidenceBarClass(item.confidence)}>
                            <span style={{ width: `${p}%` }} />
                          </div>
                          {p}%
                        </div>
                        <div className="ltm-muted-text ltm-hide-mobile">{epochToDateShort(safeNum(item.updateTime), locale)}</div>
                      </div>
                    );
                  })
                )
              ) : filteredSummaries.length === 0 ? (
                <div className="ltm-empty">{t('memoryManagement.list.empty')}</div>
              ) : (
                filteredSummaries.map((item) => {
                  const active = item.memoryId === selectedMemoryId && mode === 'detail';
                  const p = pct(item.confidence);
                  const rowClass = view === 'expiring' ? 'ltm-row-expiring' : 'ltm-row-mine';
                  const stableClass = item.isPinned && view === 'mine' ? 'stable' : '';
                  if (view === 'expiring') {
                    return (
                      <div
                        key={item.memoryId}
                        className={`ltm-memory-row ${rowClass} ${active ? 'active' : ''}`}
                        onClick={() => {
                          setSelectedMemoryId(item.memoryId);
                          setMode('detail');
                        }}
                      >
                        <div>
                          <div className="ltm-row-titleline">
                            <span className="ltm-row-title">{memoryDisplayText(item.briefIndex)}</span>
                          </div>
                          <div className="ltm-brief">{memoryDisplayText(item.content)}</div>
                        </div>
                        <span className={`ltm-chip ltm-type-chip ${safeChipClass(typeChipClass, item.memoryType)} ltm-hide-mobile`}>
                          {safeLabel(typeLabel, item.memoryType)}
                        </span>
                        <div className="ltm-muted-text ltm-hide-mobile">{safeLabel(sourceLabel, item.knowledgeSourceType)}</div>
                        <div className="ltm-muted-text ltm-hide-mobile">{item.state === 'ARCHIVED' ? t('memoryManagement.states.archived') : ''}</div>
                        <div className="ltm-confidence ltm-hide-mobile">
                          <div className={confidenceBarClass(item.confidence)}>
                            <span style={{ width: `${p}%` }} />
                          </div>
                          {p}%
                        </div>
                      </div>
                    );
                  }
                  return (
                    <div
                      key={item.memoryId}
                      className={`ltm-memory-row ${rowClass} ${stableClass} ${active ? 'active' : ''}`}
                      onClick={() => {
                        setSelectedMemoryId(item.memoryId);
                        setMode('detail');
                      }}
                    >
                      <div>
                        <div className="ltm-row-titleline">
                          <span className="ltm-row-title">{memoryDisplayText(item.briefIndex)}</span>
                        </div>
                        <div className="ltm-brief">{memoryDisplayText(item.content)}</div>
                      </div>
                      <span className={`ltm-chip ltm-type-chip ${safeChipClass(typeChipClass, item.memoryType)} ltm-hide-mobile`}>
                        {safeLabel(typeLabel, item.memoryType)}
                      </span>
                      <div className="ltm-muted-text ltm-hide-mobile">{safeLabel(sourceLabel, item.knowledgeSourceType)}</div>
                      <div className="ltm-confidence ltm-hide-mobile">
                        <div className={confidenceBarClass(item.confidence)}>
                          <span style={{ width: `${p}%` }} />
                        </div>
                        {p}%
                      </div>
                      <div className="ltm-muted-text ltm-hide-mobile">{epochToDateShort(safeNum(item.updateTime), locale)}</div>
                    </div>
                  );
                })
              )}
            </div>
            {listTotal > 0 && (
              <div className="ltm-pagination">
                <button type="button" className="ltm-pagination-boundary" disabled={listLoading || page === 0} onClick={() => setPage(0)}>
                  {t('memoryManagement.pagination.first')}
                </button>
                <Pagination
                  className="ltm-pagination-pages"
                  current={page + 1}
                  pageSize={pageSize}
                  total={listTotal}
                  disabled={listLoading}
                  pageSizeOptions={[...MEMORY_PAGE_SIZE_OPTIONS]}
                  showTotal={(total) => t('memoryManagement.pagination.total', { total })}
                  showQuickJumper
                  showSizeChanger
                  size="small"
                  onChange={(nextPage, nextPageSize) => {
                    if (nextPageSize !== pageSize) {
                      setPageSize(nextPageSize);
                      setPage(0);
                      return;
                    }
                    setPage(nextPage - 1);
                  }}
                />
                <button
                  type="button"
                  className="ltm-pagination-boundary"
                  disabled={listLoading || page >= totalPages - 1}
                  onClick={() => setPage(totalPages - 1)}
                >
                  {t('memoryManagement.pagination.last')}
                </button>
              </div>
            )}
          </div>

          <aside className="ltm-panel ltm-detail-panel nextagent-themed-scrollbar">
            <DetailPanel
              view={view}
              mode={mode}
              detail={detail}
              detailLoading={detailLoading}
              actionLoading={operationLoading}
              sharedSummary={view === 'shared' ? (sharedSummaries.find((s) => s.memoryId === selectedSharedId) ?? null) : null}
              onEdit={() => setMode('edit')}
              onCancelEdit={() => setMode('detail')}
              onSave={handleSave}
              onPin={handlePin}
              onArchive={handleArchive}
              onUnarchive={handleUnarchive}
              onDelete={handleDelete}
              onPublish={handlePublish}
              onUnpublish={handleUnpublish}
              onCopy={handleCopy}
              onCopyContent={handleCopyContent}
              isPublished={detail ? publishedMap.has(detail.memoryId) : false}
            />
          </aside>
        </div>
      </main>
      <Modal
        open={pendingImport !== null}
        rootClassName="ltm-import-modal"
        title={t('memoryManagement.transfer.previewTitle')}
        width={880}
        closable={!capacityLoading && transferLoading !== 'import'}
        maskClosable={false}
        onCancel={handleCancelImport}
        footer={[
          <button key="cancel" className="ltm-btn" disabled={capacityLoading || transferLoading === 'import'} onClick={handleCancelImport}>
            {t('memoryManagement.transfer.cancelImport')}
          </button>,
          <AuthGate key="confirm" requiredOps={[AICOServiceOperation.Write]}>
            <button className="ltm-btn primary" disabled={importConfirmDisabled} onClick={() => void handleConfirmImport()}>
              {transferLoading === 'import'
                ? t('memoryManagement.transfer.importing')
                : pendingImport?.unknownResult
                  ? t('memoryManagement.transfer.retryImport')
                  : t('memoryManagement.transfer.confirmImport')}
            </button>
          </AuthGate>,
        ]}
      >
        {pendingImport !== null && (
          <div className="ltm-import-preview">
            <div className="ltm-import-file-summary">
              <strong>{pendingImport.fileName}</strong>
              <span>{t('memoryManagement.transfer.previewCount', { count: pendingImportCount })}</span>
            </div>
            <div
              className={`ltm-import-capacity ${importCapacityExceeded ? 'error' : ''}`}
              role={capacityError || importCapacityExceeded ? 'alert' : 'status'}
            >
              {capacityLoading
                ? t('memoryManagement.transfer.capacityLoading')
                : capacityError
                  ? t('memoryManagement.transfer.capacityLoadFailed')
                  : existingMemoryCount === null
                    ? ''
                    : t('memoryManagement.transfer.capacitySummary', {
                        existing: existingMemoryCount,
                        available: availableCapacity,
                      })}
              {pendingImport.unknownResult && <div>{t('memoryManagement.transfer.unknownRetryHint')}</div>}
            </div>
            <div className="ltm-import-items nextagent-themed-scrollbar" role="list">
              {pendingImport.memories.map((memory) => {
                const confidence = pct(memory.confidence);
                const labels = labelsToText(memory.labels, locale) || t('memoryManagement.transfer.previewNoLabels');
                return (
                  <div className="ltm-import-item" role="listitem" key={memory.sourceIndex}>
                    <div className="ltm-import-item-content">
                      <div className="ltm-import-item-heading">
                        <strong className="ltm-import-item-summary" title={memory.briefIndex}>
                          {memory.briefIndex}
                        </strong>
                        <div className="ltm-import-item-meta">
                          <span
                            className={`ltm-chip ltm-type-chip ltm-import-type ${safeChipClass(typeChipClass, memory.memoryType)}`}
                            title={typeLabel[memory.memoryType]}
                          >
                            {typeLabel[memory.memoryType]}
                          </span>
                          <span className="ltm-chip ltm-import-labels" title={labels}>
                            {labels}
                          </span>
                          <span
                            className="ltm-import-confidence"
                            title={t('memoryManagement.transfer.previewConfidence', { confidence: memory.confidence })}
                            aria-label={t('memoryManagement.detail.confidenceAria', { value: confidence })}
                          >
                            {confidence}%
                          </span>
                        </div>
                      </div>
                      <p title={memory.content}>{memory.content}</p>
                    </div>
                    <button
                      type="button"
                      className="ltm-import-remove"
                      aria-label={t('memoryManagement.transfer.removeItemAria', { label: memory.briefIndex })}
                      title={t('memoryManagement.transfer.removeItemAria', { label: memory.briefIndex })}
                      disabled={capacityLoading || transferLoading === 'import'}
                      onClick={() => handleRemovePendingImport(memory.sourceIndex)}
                    >
                      ×
                    </button>
                  </div>
                );
              })}
              {pendingImport.memories.length === 0 && (
                <div className="ltm-empty ltm-import-empty">
                  <span>{t('memoryManagement.transfer.previewEmpty')}</span>
                  <button className="ltm-btn" disabled={transferLoading !== null || actionLoading} onClick={() => importInputRef.current?.click()}>
                    {t('memoryManagement.transfer.selectFileAgain')}
                  </button>
                </div>
              )}
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}

interface DetailPanelProps {
  readonly view: View;
  readonly mode: Mode;
  readonly detail: LongTermMemoryRecord | null;
  readonly detailLoading: boolean;
  readonly actionLoading: boolean;
  readonly sharedSummary: SharedMemorySummary | null;
  readonly onEdit: () => void;
  readonly onCancelEdit: () => void;
  readonly onSave: (data: {
    memoryId?: string;
    memoryType: MemoryType;
    knowledgeSourceType: KnowledgeSourceType;
    confidence: number;
    briefIndex: string;
    content: string;
    labels: string[];
  }) => void;
  readonly onPin: (record: LongTermMemoryRecord, pinned: boolean) => void;
  readonly onArchive: (record: LongTermMemoryRecord) => void;
  readonly onUnarchive: (record: LongTermMemoryRecord) => void;
  readonly onDelete: (record: LongTermMemoryRecord) => void;
  readonly onPublish: (record: LongTermMemoryRecord) => void;
  readonly onUnpublish: (shared: SharedMemorySummary) => void;
  readonly onCopy: (shared: SharedMemorySummary) => void;
  readonly onCopyContent: (content: string) => void;
  readonly isPublished: boolean;
}

function DetailPanel(props: DetailPanelProps): ReactNode {
  const { t } = useTranslation();
  const locale = getCurrentLocale();
  const typeLabel = useMemo(() => createTypeLabels(t), [t]);
  const sourceLabel = useMemo(() => createSourceLabels(t), [t]);
  const [summaryExpanded, setSummaryExpanded] = useState(false);
  const [contentExpanded, setContentExpanded] = useState(false);
  useEffect(() => {
    setSummaryExpanded(false);
    setContentExpanded(false);
  }, [props.detail?.memoryId, props.mode]);
  if (props.view === 'shared') {
    return (
      <SharedDetail
        summary={props.sharedSummary}
        onUnpublish={props.onUnpublish}
        onCopy={props.onCopy}
        onCopyContent={props.onCopyContent}
        actionLoading={props.actionLoading}
      />
    );
  }
  if (props.mode === 'create') {
    return <MemoryForm mode="create" onSave={props.onSave} onCancel={props.onCancelEdit} actionLoading={props.actionLoading} />;
  }
  if (props.detailLoading) {
    return (
      <div className="ltm-spin">
        <div className="ltm-spinner" />
      </div>
    );
  }
  if (!props.detail) {
    return <div className="ltm-empty">{t('memoryManagement.detail.selectMemory')}</div>;
  }
  if (props.mode === 'edit') {
    return <MemoryForm mode="edit" record={props.detail} onSave={props.onSave} onCancel={props.onCancelEdit} actionLoading={props.actionLoading} />;
  }

  const record = props.detail;
  const p = pct(record.confidence);
  const isActive = record.state === 'ACTIVE';
  const summaryCollapsible = Array.from(safeStr(record.briefIndex)).length > 1024;
  const contentCollapsible = Array.from(safeStr(record.content)).length > 2000;

  return (
    <div className="ltm-detail">
      <div className="ltm-detail-head">
        <div className="ltm-detail-identity">
          <div className="ltm-chips" aria-label={t('memoryManagement.detail.memoryAttributes')}>
            <span className={`ltm-chip ltm-type-chip ${safeChipClass(typeChipClass, record.memoryType)}`}>
              {safeLabel(typeLabel, record.memoryType)}
            </span>
            <span className={`ltm-chip ${isActive ? 'active' : 'expiring'}`}>
              {isActive ? t('memoryManagement.states.active') : t('memoryManagement.states.archived')}
            </span>
            <span className={`ltm-chip ${record.sharingState === 'FORK' ? 'copy' : record.sharingState === 'SHARED' ? 'shared' : ''}`}>
              {sharingLabel(safeStr(record.sharingState), t)}
            </span>
          </div>
          <div className="ltm-detail-confidence" aria-label={t('memoryManagement.detail.confidenceAria', { value: p })}>
            <span>{t('memoryManagement.detail.confidence')}</span>
            <div className={confidenceBarClass(record.confidence)}>
              <span style={{ width: `${p}%` }} />
            </div>
            <strong>{p}%</strong>
          </div>
        </div>
        <div className={`ltm-summary-block ${summaryCollapsible && !summaryExpanded ? 'collapsed' : ''}`}>
          <h2 id="ltm-memory-summary" className="ltm-detail-title">
            {memoryDisplayText(record.briefIndex)}
          </h2>
          {summaryCollapsible && (
            <button
              className="ltm-collapse-toggle"
              type="button"
              aria-expanded={summaryExpanded}
              aria-controls="ltm-memory-summary"
              onClick={() => setSummaryExpanded((current) => !current)}
            >
              {t(summaryExpanded ? 'memoryManagement.detail.collapseSummary' : 'memoryManagement.detail.expandSummary')}
            </button>
          )}
        </div>
        <div className="ltm-detail-toolbar" role="toolbar" aria-label={t('memoryManagement.detail.memoryActions')}>
          <div className="ltm-detail-actions">
            {isActive && (
              <AuthGate requiredOps={[AICOServiceOperation.Write]}>
                <button className="ltm-btn primary" disabled={props.actionLoading} onClick={props.onEdit}>
                  {t('memoryManagement.detail.edit')}
                </button>
              </AuthGate>
            )}
            {isActive && (
              <AuthGate requiredOps={[AICOServiceOperation.Write]}>
                <button className="ltm-btn" disabled={props.actionLoading} onClick={(): void => props.onPin(record, !record.isPinned)}>
                  {record.isPinned ? t('memoryManagement.detail.automatic') : t('memoryManagement.detail.pin')}
                </button>
              </AuthGate>
            )}
            {isActive && (
              <AuthGate requiredOps={[AICOServiceOperation.Write]}>
                <button
                  className="ltm-btn"
                  disabled={props.actionLoading || record.sharingState === 'FORK'}
                  title={record.sharingState === 'FORK' ? t('memoryManagement.detail.forkShareDisabled') : undefined}
                  onClick={(): void => props.onPublish(record)}
                >
                  {props.isPublished ? t('memoryManagement.detail.unpublish') : t('memoryManagement.detail.publish')}
                </button>
              </AuthGate>
            )}
            {isActive && (
              <AuthGate requiredOps={[AICOServiceOperation.Write]}>
                <button className="ltm-btn warning" disabled={props.actionLoading} onClick={(): void => props.onArchive(record)}>
                  {t('memoryManagement.detail.archive')}
                </button>
              </AuthGate>
            )}
            {!isActive && (
              <AuthGate requiredOps={[AICOServiceOperation.Write]}>
                <button className="ltm-btn primary" disabled={props.actionLoading} onClick={(): void => props.onUnarchive(record)}>
                  {t('memoryManagement.detail.unarchive')}
                </button>
              </AuthGate>
            )}
          </div>
          {isActive && (
            <div className="ltm-detail-danger-actions">
              <AuthGate requiredOps={[AICOServiceOperation.Write]}>
                <button className="ltm-btn danger" disabled={props.actionLoading} onClick={(): void => props.onDelete(record)}>
                  {t('memoryManagement.detail.delete')}
                </button>
              </AuthGate>
            </div>
          )}
        </div>
      </div>
      <div className="ltm-detail-body">
        <section className="ltm-detail-section ltm-content-section">
          <div className="ltm-section-heading">
            <h3 className="ltm-section-title">{t('memoryManagement.detail.content')}</h3>
            <div className="ltm-section-actions">
              {contentCollapsible && (
                <button
                  className="ltm-collapse-toggle"
                  type="button"
                  aria-expanded={contentExpanded}
                  aria-controls="ltm-memory-content"
                  onClick={() => setContentExpanded((current) => !current)}
                >
                  {t(contentExpanded ? 'memoryManagement.detail.collapseContent' : 'memoryManagement.detail.expandContent')}
                </button>
              )}
              <button className="ltm-copy-content" type="button" onClick={(): void => props.onCopyContent(memoryDisplayText(record.content))}>
                {t('memoryManagement.detail.copyContent')}
              </button>
            </div>
          </div>
          <div id="ltm-memory-content" className={`ltm-collapsible-content ${contentCollapsible && !contentExpanded ? 'collapsed' : ''}`}>
            <MemoryContent content={safeStr(record.content)} />
          </div>
        </section>
        <section className="ltm-detail-section ltm-tags-section">
          <h3 className="ltm-section-title">{t('memoryManagement.detail.tags')}</h3>
          <div className="ltm-chips">
            {safeArr(record.labels).length === 0 ? (
              <span className="ltm-muted-text">{t('memoryManagement.detail.noTags')}</span>
            ) : (
              safeArr(record.labels).map((tag) => (
                <span key={tag} className="ltm-chip">
                  {tag}
                </span>
              ))
            )}
          </div>
        </section>
        <section className="ltm-detail-section ltm-properties-section">
          <h3 className="ltm-section-title">{t('memoryManagement.detail.otherProperties')}</h3>
          <dl className="ltm-property-list">
            <DetailProperty label={t('memoryManagement.detail.source')}>{safeLabel(sourceLabel, record.knowledgeSourceType)}</DetailProperty>
            <DetailProperty label={t('memoryManagement.detail.updateMode')}>
              {record.isPinned ? t('memoryManagement.filters.pinned') : t('memoryManagement.filters.automatic')}
            </DetailProperty>
            <DetailProperty label={t('memoryManagement.detail.accessCount')}>{safeNum(record.accessCount)}</DetailProperty>
            <DetailProperty label={t('memoryManagement.detail.lastAccessedAt')}>
              {record.lastAccessedAt ? epochToDate(safeNum(record.lastAccessedAt), locale) : '-'}
            </DetailProperty>
            <DetailProperty label={t('memoryManagement.detail.createdAt')}>{epochToDate(safeNum(record.createTime), locale)}</DetailProperty>
            <DetailProperty label={t('memoryManagement.detail.updatedAt')}>{epochToDate(safeNum(record.updateTime), locale)}</DetailProperty>
          </dl>
        </section>
      </div>
    </div>
  );
}

function DetailProperty({ label, children }: { readonly label: string; readonly children: ReactNode }): ReactNode {
  return (
    <div className="ltm-property-item">
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

function SharedDetail({
  summary,
  onUnpublish,
  onCopy,
  onCopyContent,
  actionLoading,
}: {
  readonly summary: SharedMemorySummary | null;
  readonly onUnpublish: (shared: SharedMemorySummary) => void;
  readonly onCopy: (shared: SharedMemorySummary) => void;
  readonly onCopyContent: (content: string) => void;
  readonly actionLoading: boolean;
}): ReactNode {
  const { t } = useTranslation();
  const locale = getCurrentLocale();
  const typeLabel = useMemo(() => createTypeLabels(t), [t]);
  const sourceLabel = useMemo(() => createSourceLabels(t), [t]);
  const [summaryExpanded, setSummaryExpanded] = useState(false);
  const [contentExpanded, setContentExpanded] = useState(false);
  useEffect(() => {
    setSummaryExpanded(false);
    setContentExpanded(false);
  }, [summary?.memoryId]);
  if (!summary) {
    return <div className="ltm-empty">{t('memoryManagement.detail.selectShared')}</div>;
  }
  const p = pct(summary.confidence);
  const summaryCollapsible = Array.from(safeStr(summary.briefIndex)).length > 1024;
  const contentCollapsible = Array.from(safeStr(summary.content)).length > 2000;
  return (
    <div className="ltm-detail">
      <div className="ltm-detail-head">
        <div className="ltm-detail-identity">
          <div className="ltm-chips" aria-label={t('memoryManagement.detail.sharedAttributes')}>
            <span className={`ltm-chip ltm-type-chip ${safeChipClass(typeChipClass, summary.memoryType)}`}>
              {safeLabel(typeLabel, summary.memoryType)}
            </span>
            <span className="ltm-chip active">{t('memoryManagement.states.active')}</span>
            <span className="ltm-chip shared">{t('memoryManagement.sharing.sharedKnowledge')}</span>
          </div>
          <div className="ltm-detail-confidence" aria-label={t('memoryManagement.detail.confidenceAria', { value: p })}>
            <span>{t('memoryManagement.detail.confidence')}</span>
            <div className={confidenceBarClass(summary.confidence)}>
              <span style={{ width: `${p}%` }} />
            </div>
            <strong>{p}%</strong>
          </div>
        </div>
        <div className={`ltm-summary-block ${summaryCollapsible && !summaryExpanded ? 'collapsed' : ''}`}>
          <h2 id="ltm-shared-summary" className="ltm-detail-title">
            {memoryDisplayText(summary.briefIndex)}
          </h2>
          {summaryCollapsible && (
            <button
              className="ltm-collapse-toggle"
              type="button"
              aria-expanded={summaryExpanded}
              aria-controls="ltm-shared-summary"
              onClick={() => setSummaryExpanded((current) => !current)}
            >
              {t(summaryExpanded ? 'memoryManagement.detail.collapseSummary' : 'memoryManagement.detail.expandSummary')}
            </button>
          )}
        </div>
        <div className="ltm-detail-toolbar" role="toolbar" aria-label={t('memoryManagement.detail.sharedActions')}>
          <div className="ltm-detail-actions">
            <AuthGate requiredOps={[AICOServiceOperation.Write]}>
              <button className="ltm-btn primary" disabled={actionLoading} onClick={(): void => onCopy(summary)}>
                {t('memoryManagement.detail.copyToMine')}
              </button>
            </AuthGate>
          </div>
          {summary.ownerUserId === getSubjectId() && (
            <div className="ltm-detail-danger-actions">
              <AuthGate requiredOps={[AICOServiceOperation.Write]}>
                <button className="ltm-btn danger" disabled={actionLoading} onClick={(): void => onUnpublish(summary)}>
                  {t('memoryManagement.detail.unpublish')}
                </button>
              </AuthGate>
            </div>
          )}
        </div>
      </div>
      <div className="ltm-detail-body">
        <section className="ltm-detail-section ltm-content-section">
          <div className="ltm-section-heading">
            <h3 className="ltm-section-title">{t('memoryManagement.detail.knowledgeContent')}</h3>
            <div className="ltm-section-actions">
              {contentCollapsible && (
                <button
                  className="ltm-collapse-toggle"
                  type="button"
                  aria-expanded={contentExpanded}
                  aria-controls="ltm-shared-content"
                  onClick={() => setContentExpanded((current) => !current)}
                >
                  {t(contentExpanded ? 'memoryManagement.detail.collapseContent' : 'memoryManagement.detail.expandContent')}
                </button>
              )}
              <button className="ltm-copy-content" type="button" onClick={(): void => onCopyContent(memoryDisplayText(summary.content))}>
                {t('memoryManagement.detail.copyContent')}
              </button>
            </div>
          </div>
          <div id="ltm-shared-content" className={`ltm-collapsible-content ${contentCollapsible && !contentExpanded ? 'collapsed' : ''}`}>
            <MemoryContent content={safeStr(summary.content)} />
          </div>
        </section>
        <section className="ltm-detail-section ltm-tags-section">
          <h3 className="ltm-section-title">{t('memoryManagement.detail.tags')}</h3>
          <div className="ltm-chips">
            {safeArr(summary.labels).length === 0 ? (
              <span className="ltm-muted-text">{t('memoryManagement.detail.noTags')}</span>
            ) : (
              safeArr(summary.labels).map((tag) => (
                <span key={tag} className="ltm-chip">
                  {tag}
                </span>
              ))
            )}
          </div>
        </section>
        <section className="ltm-detail-section ltm-properties-section">
          <h3 className="ltm-section-title">{t('memoryManagement.detail.sharedProperties')}</h3>
          <div className="ltm-notice">{t('memoryManagement.detail.copyNotice')}</div>
          <dl className="ltm-property-list">
            <DetailProperty label={t('memoryManagement.detail.owner')}>{safeStr(summary.ownerUserName ?? summary.ownerUserId)}</DetailProperty>
            <DetailProperty label={t('memoryManagement.detail.source')}>{safeLabel(sourceLabel, summary.knowledgeSourceType)}</DetailProperty>
            <DetailProperty label={t('memoryManagement.detail.updatedAt')}>{epochToDate(safeNum(summary.updateTime), locale)}</DetailProperty>
          </dl>
        </section>
      </div>
    </div>
  );
}

function MemoryForm({
  mode,
  record,
  onSave,
  onCancel,
  actionLoading,
}: {
  readonly mode: 'create' | 'edit';
  readonly record?: LongTermMemoryRecord | null;
  readonly onSave: (data: {
    memoryId?: string;
    memoryType: MemoryType;
    knowledgeSourceType: KnowledgeSourceType;
    confidence: number;
    briefIndex: string;
    content: string;
    labels: string[];
  }) => void;
  readonly onCancel: () => void;
  readonly actionLoading: boolean;
}): ReactNode {
  const { t } = useTranslation();
  const locale = getCurrentLocale();
  const typeLabel = useMemo(() => createTypeLabels(t), [t]);
  const [memoryType, setMemoryType] = useState<MemoryType>(record?.memoryType ?? DEFAULT_MANUAL_MEMORY_TYPE);
  const [confidenceText, setConfidenceText] = useState(record ? String(safeNum(record.confidence)) : '1');
  const [briefIndex, setBriefIndex] = useState(safeStr(record?.briefIndex));
  const [content, setContent] = useState(safeStr(record?.content));
  const [labelsText, setLabelsText] = useState(record ? labelsToText(record.labels, locale) : '');
  const labels = parseLabels(labelsText);
  const labelsOverLimit = labels.length > 10;
  const labelsTooLong = labels.some((label) => Array.from(label).length > 256);
  const summaryLength = Array.from(briefIndex).length;
  const contentLength = Array.from(content).length;
  const summaryInvalid = summaryLength === 0 || summaryLength > 2048;
  const contentInvalid = contentLength === 0 || contentLength > 4000;
  const confidenceGrammarValid = /^(?:0(?:\.\d{1,2})?|1(?:\.0{1,2})?)$/.test(confidenceText);
  const confidence = Number(confidenceText);
  const confidenceInvalid = !confidenceGrammarValid;
  const formInvalid = summaryInvalid || contentInvalid || labelsOverLimit || labelsTooLong || confidenceInvalid;

  return (
    <div className="ltm-detail">
      <div className="ltm-detail-head ltm-form-head">
        <div className="ltm-form-heading-row">
          <h2 className="ltm-detail-title">{mode === 'create' ? t('memoryManagement.form.createTitle') : t('memoryManagement.form.editTitle')}</h2>
          <div className="ltm-chips">
            {mode === 'create' ? (
              <>
                <span className={`ltm-chip ltm-type-chip ${safeChipClass(typeChipClass, memoryType)}`}>{safeLabel(typeLabel, memoryType)}</span>
                <span className="ltm-chip active">{t('memoryManagement.states.active')}</span>
                <span className="ltm-chip">{t('memoryManagement.sharing.private')}</span>
              </>
            ) : (
              <>
                <span className={`ltm-chip ltm-type-chip ${safeChipClass(typeChipClass, memoryType)}`}>{safeLabel(typeLabel, memoryType)}</span>
                <span className={`ltm-chip ${record!.state === 'ACTIVE' ? 'active' : 'expiring'}`}>
                  {record!.state === 'ACTIVE' ? t('memoryManagement.states.active') : t('memoryManagement.states.archived')}
                </span>
              </>
            )}
          </div>
        </div>
        {mode === 'create' && <div className="ltm-muted-text ltm-form-note">{t('memoryManagement.form.createDescription')}</div>}
        <div className="ltm-detail-actions ltm-form-actions">
          <button
            className="ltm-btn primary"
            disabled={actionLoading || formInvalid}
            onClick={() =>
              onSave({
                ...(record ? { memoryId: record.memoryId } : {}),
                memoryType,
                knowledgeSourceType: record?.knowledgeSourceType ?? 'CONFIGURED',
                confidence,
                briefIndex,
                content,
                labels,
              })
            }
          >
            {mode === 'create' ? t('memoryManagement.form.save') : t('memoryManagement.form.saveChanges')}
          </button>
          <button className="ltm-btn" disabled={actionLoading} onClick={onCancel}>
            {t('memoryManagement.form.cancel')}
          </button>
        </div>
      </div>
      <div className="ltm-detail-body ltm-form-body">
        <div className="ltm-form">
          <label className="ltm-field">
            <span className="ltm-label">{t('memoryManagement.form.type')}</span>
            <select
              className="ltm-select ltm-form-primary-control"
              aria-label={t('memoryManagement.form.type')}
              value={memoryType}
              onChange={(event) => setMemoryType(event.target.value as MemoryType)}
            >
              {Object.entries(typeLabel).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label className="ltm-field">
            <span className="ltm-label">{t('memoryManagement.form.confidence')}</span>
            <input
              className="ltm-input ltm-form-primary-control"
              type="text"
              inputMode="decimal"
              maxLength={4}
              aria-label={t('memoryManagement.form.confidence')}
              value={confidenceText}
              onChange={(event) => setConfidenceText(event.target.value)}
              aria-invalid={confidenceInvalid}
            />
            <span className={`ltm-field-hint ${confidenceInvalid ? 'error' : ''}`}>{t('memoryManagement.form.confidenceHint')}</span>
          </label>
          <label className="ltm-field wide">
            <span className="ltm-label">{t('memoryManagement.form.summary')}</span>
            <textarea
              className="ltm-textarea"
              aria-label={t('memoryManagement.form.summary')}
              maxLength={2048}
              value={briefIndex}
              onChange={(e) => setBriefIndex(e.target.value)}
              aria-invalid={summaryInvalid}
            />
            <span className="ltm-field-hint-row">
              <span className={`ltm-field-hint ${summaryInvalid ? 'error' : ''}`}>{t('memoryManagement.form.summaryHint')}</span>
              <span className="ltm-field-count">{t('memoryManagement.form.summaryCount', { count: summaryLength })}</span>
            </span>
          </label>
          <label className="ltm-field wide">
            <span className="ltm-label">{t('memoryManagement.form.content')}</span>
            <textarea
              className="ltm-textarea content"
              aria-label={t('memoryManagement.form.content')}
              maxLength={4000}
              value={content}
              onChange={(e) => setContent(e.target.value)}
              aria-invalid={contentInvalid}
            />
            <span className="ltm-field-hint-row">
              <span className={`ltm-field-hint ${contentInvalid ? 'error' : ''}`}>{t('memoryManagement.form.contentHint')}</span>
              <span className="ltm-field-count">{t('memoryManagement.form.contentCount', { count: contentLength })}</span>
            </span>
          </label>
          <label className="ltm-field wide">
            <span className="ltm-label">{t('memoryManagement.form.labels')}</span>
            <input
              className="ltm-input"
              value={labelsText}
              onChange={(e) => setLabelsText(e.target.value)}
              placeholder={t('memoryManagement.form.labelsPlaceholder')}
              aria-invalid={labelsOverLimit || labelsTooLong}
              aria-describedby="ltm-label-count"
            />
            <span className="ltm-field-hint">{t('memoryManagement.form.labelsHint')}</span>
            <span
              id="ltm-label-count"
              className={`ltm-field-hint ${labelsOverLimit || labelsTooLong ? 'error' : ''}`}
              role={labelsOverLimit || labelsTooLong ? 'alert' : undefined}
            >
              {labelsOverLimit
                ? t('memoryManagement.form.labelsOverLimit', { count: labels.length })
                : labelsTooLong
                  ? t('memoryManagement.form.labelTooLong')
                  : t('memoryManagement.form.labelsCount', { count: labels.length })}
            </span>
          </label>
        </div>
      </div>
    </div>
  );
}
