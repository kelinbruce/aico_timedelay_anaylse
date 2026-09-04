import { CalendarOutlined, CloseCircleFilled, DownOutlined, SearchOutlined, UpOutlined } from '@ant-design/icons';
import { Button, Checkbox, DatePicker, Input, message, Pagination, Popconfirm, Popover, Spin, Typography } from 'antd';
import dayjs, { type Dayjs } from 'dayjs';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import { MessageList } from '../../chat/components/MessageList.tsx';
import { buildHistoricalTurnBlocks } from '../../chat/utils/buildTurnBlocks.ts';
import { AuthGate } from '../../auth/AuthGate.tsx';
import { AICOServiceOperation } from '../../auth/authEnums.ts';
import { useUserOps } from '../../auth/useUserOps.ts';
import { FAVORITES_UPDATED_EVENT, annotationService, type FavoriteTurnEntry, type FavoriteTurnFilter } from '../../../services/annotationService.ts';
import { sessionService } from '../../../services/sessionService.ts';
import type { SessionConversationMessage, TurnBlock } from '../../../state/contracts.ts';
import { PageLayout } from '../../../components/PageLayout.tsx';
import { useAppHostContext } from '../../../app/AppProviders.tsx';
import { ShareModeBar } from '../../share/components/ShareModeBar.tsx';
import unfavoriteDark from '../../../assets/icons/unfavorite-dark.svg';
import unfavoriteLight from '../../../assets/icons/unfavorite-light.svg';
import positioningDark from '../../../assets/icons/positioning-dark.svg';
import positioningLight from '../../../assets/icons/positioning-light.svg';
import './FavoriteTurnsPanel.css';

export interface FavoriteTurnsPanelProps {
  readonly onOpenFavorite: (sessionId: string, rootMessageId: string) => void;
}

interface FavoriteSessionGroup {
  readonly sessionId: string;
  readonly sessionTitle: string;
  readonly latestFavoritedAt: number;
  readonly entries: readonly FavoriteTurnEntry[];
}

const FAVORITE_QUERY_LIMIT = 100;
const FAVORITE_SESSION_PAGE_SIZE = 15;
const DATE_TIME_FORMAT = 'YYYY-MM-DD HH:mm:ss';
type FavoriteType = 'ANSWER' | 'QUESTION';

function groupFavoriteTurns(entries: readonly FavoriteTurnEntry[]): readonly FavoriteSessionGroup[] {
  const groups: Array<{
    sessionId: string;
    sessionTitle: string;
    latestFavoritedAt: number;
    entries: FavoriteTurnEntry[];
  }> = [];
  const groupsBySessionId = new Map<string, (typeof groups)[number]>();

  for (const entry of entries) {
    const existingGroup = groupsBySessionId.get(entry.sessionId);
    if (existingGroup) {
      existingGroup.entries.push(entry);
      existingGroup.latestFavoritedAt = Math.max(existingGroup.latestFavoritedAt, entry.favoritedAt);
      continue;
    }
    const group = {
      sessionId: entry.sessionId,
      sessionTitle: entry.sessionTitle ?? entry.sessionId,
      latestFavoritedAt: entry.favoritedAt,
      entries: [entry],
    };
    groups.push(group);
    groupsBySessionId.set(entry.sessionId, group);
  }

  return groups;
}

function favoriteTurnKey(entry: FavoriteTurnEntry): string {
  return JSON.stringify([entry.sessionId, entry.requestRunId]);
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

function formatConversationTime(value: number | string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '';
  }
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

function isFutureDate(current: Dayjs, now: number = Date.now()): boolean {
  return current.endOf('day').valueOf() > dayjs(now).endOf('day').valueOf();
}

function fallbackUserMessage(entry: FavoriteTurnEntry): SessionConversationMessage {
  return {
    messageId: entry.rootMessageId,
    sessionId: entry.sessionId,
    rootMessageId: entry.rootMessageId,
    role: 'USER',
    sequence: 0,
    content: entry.questionPreview,
    contentType: 'PLAIN_TEXT',
    metadata: {},
    createdAt: entry.favoritedAt,
    visible: true,
  };
}

function FavoriteDateFilter({
  start,
  end,
  onStartChange,
  onEndChange,
  onReset,
}: {
  readonly start: Dayjs | null;
  readonly end: Dayjs | null;
  readonly onStartChange: (value: Dayjs | null) => void;
  readonly onEndChange: (value: Dayjs | null) => void;
  readonly onReset: () => void;
}): ReactElement {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const summary =
    start || end
      ? `${start?.format(DATE_TIME_FORMAT) ?? t('sidebar.favoritesDateFrom')} - ${end?.format(DATE_TIME_FORMAT) ?? t('sidebar.favoritesDateTo')}`
      : t('sidebar.favoritesDateFilter');

  return (
    <div className="favorite-date-filter-control">
      <Popover
        trigger="click"
        open={open}
        onOpenChange={setOpen}
        placement="bottomRight"
        content={
          <div className="favorite-date-filter-popover">
            <DatePicker
              value={start}
              format={DATE_TIME_FORMAT}
              placeholder={t('sidebar.favoritesDateFrom')}
              showTime={{ format: 'HH:mm:ss' }}
              showNow
              allowClear={false}
              disabledDate={(current) => isFutureDate(current) || (end !== null && current.isAfter(end, 'day'))}
              onChange={(value) => {
                if (value !== null && (isFutureDate(value) || (end !== null && value.isAfter(end, 'second')))) {
                  return;
                }
                onStartChange(value);
              }}
            />
            <span aria-hidden="true" className="favorite-date-filter-divider">
              -
            </span>
            <DatePicker
              value={end}
              format={DATE_TIME_FORMAT}
              placeholder={t('sidebar.favoritesDateTo')}
              showTime={{ format: 'HH:mm:ss' }}
              showNow
              allowClear={false}
              disabledDate={(current) => isFutureDate(current) || (start !== null && current.isBefore(start, 'day'))}
              onChange={(value) => {
                if (value !== null && (isFutureDate(value) || (start !== null && value.isBefore(start, 'second')))) {
                  return;
                }
                onEndChange(value);
              }}
            />
            <Button type="link" onClick={onReset}>
              {t('sidebar.favoritesDateReset')}
            </Button>
          </div>
        }
      >
        <Button className="favorite-date-filter-trigger" icon={<CalendarOutlined />} aria-label={t('sidebar.favoritesDateFilter')} title={summary} />
      </Popover>
      {start ? (
        <button
          type="button"
          className="favorite-date-filter-clear"
          aria-label={t('sidebar.favoritesDateClearFrom')}
          onClick={() => onStartChange(null)}
        >
          <CloseCircleFilled />
        </button>
      ) : null}
      {end ? (
        <button type="button" className="favorite-date-filter-clear" aria-label={t('sidebar.favoritesDateClearTo')} onClick={() => onEndChange(null)}>
          <CloseCircleFilled />
        </button>
      ) : null}
    </div>
  );
}

type FavoriteTurnChatState = { readonly status: 'loading' } | { readonly status: 'error' } | { readonly status: 'ready'; readonly block: TurnBlock };

function FavoriteTurnExpandedChat({ entry }: { readonly entry: FavoriteTurnEntry }): ReactElement {
  const { t } = useTranslation();
  const [retryKey, setRetryKey] = useState(0);
  const [state, setState] = useState<FavoriteTurnChatState>({ status: 'loading' });

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    setState({ status: 'loading' });
    void sessionService
      .loadRunEvents({
        sessionId: entry.sessionId,
        runId: entry.requestRunId,
        afterSequence: 0,
        limit: 1000,
        signal: controller.signal,
      })
      .then((page) => {
        if (!active) {
          return;
        }
        const builtBlock = buildHistoricalTurnBlocks(page.events).find((candidate) => candidate.rootMessageId === entry.rootMessageId);
        let block: TurnBlock | undefined;
        if (builtBlock) {
          block =
            builtBlock.userMessage.content.trim().length > 0
              ? builtBlock
              : { ...builtBlock, userMessage: { ...builtBlock.userMessage, content: entry.questionPreview } };
        }
        setState(block ? { status: 'ready', block } : { status: 'error' });
      })
      .catch(() => {
        if (active) {
          setState({ status: 'error' });
        }
      });
    return (): void => {
      active = false;
      controller.abort();
    };
  }, [entry.requestRunId, entry.rootMessageId, entry.sessionId, retryKey]);

  return (
    <div className="favorite-turn-expanded-chat">
      {state.status === 'loading' ? (
        <div className="favorite-turn-read-state" role="status" aria-label={t('sidebar.favoritesConversationLoading')}>
          <Spin size="small" />
          <Typography.Text type="secondary">{t('sidebar.favoritesConversationLoading')}</Typography.Text>
        </div>
      ) : null}
      {state.status === 'error' ? (
        <div className="favorite-turn-read-state">
          <Typography.Text type="danger">{t('sidebar.favoritesConversationLoadFailed')}</Typography.Text>
          <Button type="link" size="small" onClick={(): void => setRetryKey((current): number => current + 1)}>
            {t('common.retry')}
          </Button>
        </div>
      ) : null}
      {state.status === 'ready' ? (
        <MessageList
          blocks={[state.block]}
          onRetry={(): void => undefined}
          onEdit={(): void => undefined}
          onCancel={(): void => undefined}
          sessionId={entry.sessionId}
          showInlineScrollToBottomButton={false}
        />
      ) : null}
    </div>
  );
}

export function FavoriteTurnsPanel({ onOpenFavorite }: FavoriteTurnsPanelProps): ReactElement {
  const { t } = useTranslation();
  const { themeMode } = useAppHostContext();
  const userOps = useUserOps();
  const [entries, setEntries] = useState<readonly FavoriteTurnEntry[]>([]);
  const [favoriteType, setFavoriteType] = useState<FavoriteType>('ANSWER');
  const [isLoading, setIsLoading] = useState(true);
  const [hasError, setHasError] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [searchDraft, setSearchDraft] = useState('');
  const [searchKeyword, setSearchKeyword] = useState('');
  const [startDate, setStartDate] = useState<Dayjs | null>(null);
  const [endDate, setEndDate] = useState<Dayjs | null>(null);
  const [pendingRemovalKey, setPendingRemovalKey] = useState<string | null>(null);
  const [removalErrorKey, setRemovalErrorKey] = useState<string | null>(null);
  const [expandedEntryKeys, setExpandedEntryKeys] = useState<ReadonlySet<string>>(() => new Set<string>());
  const [batchMode, setBatchMode] = useState(false);
  const [batchSelectedKeys, setBatchSelectedKeys] = useState<ReadonlySet<string>>(() => new Set<string>());
  const requestIdRef = useRef(0);
  const mountedRef = useRef(true);
  const pendingRemovalRef = useRef<{ readonly sessionId: string; readonly requestRunId: string } | null>(null);
  const normalizedKeyword = searchKeyword.trim();
  const favoriteFilter = useMemo<FavoriteTurnFilter>(
    () => ({
      favoriteType,
      ...(normalizedKeyword ? { keyword: normalizedKeyword } : {}),
      ...(startDate ? { favoritedFrom: startDate.valueOf() } : {}),
      ...(endDate ? { favoritedTo: endDate.valueOf() } : {}),
    }),
    [endDate, favoriteType, normalizedKeyword, startDate],
  );
  const filterActive = normalizedKeyword.length > 0 || startDate !== null || endDate !== null;
  const canWriteFavorites = userOps === null || userOps.includes(AICOServiceOperation.Write);
  const unfavoriteSvg = themeMode === 'dark' ? unfavoriteDark : unfavoriteLight;
  const positioningSvg = themeMode === 'dark' ? positioningDark : positioningLight;
  const favoriteSessionGroups = useMemo(() => groupFavoriteTurns(entries), [entries]);
  const selectableBatchKeys = useMemo(() => new Set(entries.map(favoriteTurnKey)), [entries]);
  const pageCount = Math.max(1, Math.ceil(favoriteSessionGroups.length / FAVORITE_SESSION_PAGE_SIZE));
  const currentSessionGroups = useMemo(
    () => favoriteSessionGroups.slice((currentPage - 1) * FAVORITE_SESSION_PAGE_SIZE, currentPage * FAVORITE_SESSION_PAGE_SIZE),
    [currentPage, favoriteSessionGroups],
  );
  const hasExpandedEntry =
    favoriteType === 'ANSWER' && currentSessionGroups.some((group) => group.entries.some((entry) => expandedEntryKeys.has(favoriteTurnKey(entry))));

  useEffect(() => {
    setCurrentPage((page) => Math.min(page, pageCount));
  }, [pageCount]);

  useEffect(() => {
    mountedRef.current = true;
    return (): void => {
      mountedRef.current = false;
      requestIdRef.current += 1;
    };
  }, []);

  const loadFavorites = useCallback(async () => {
    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    setIsLoading(true);
    setHasError(false);
    try {
      const page = await annotationService.listFavoriteTurns(0, FAVORITE_QUERY_LIMIT, favoriteFilter);
      if (!mountedRef.current || requestIdRef.current !== requestId) {
        return;
      }
      setEntries(page.entries);
    } catch {
      if (mountedRef.current && requestIdRef.current === requestId) {
        setHasError(true);
      }
    } finally {
      if (mountedRef.current && requestIdRef.current === requestId) {
        setIsLoading(false);
      }
    }
  }, [favoriteFilter]);

  useEffect(() => {
    setCurrentPage(1);
    void loadFavorites();
  }, [loadFavorites]);

  useEffect(() => {
    const handleFavoritesUpdated = (event: Event): void => {
      const detail = (event as CustomEvent<{ readonly sessionId?: string; readonly isFavorited?: boolean }>).detail;
      if (detail?.isFavorited === false && detail.sessionId === pendingRemovalRef.current?.sessionId) {
        return;
      }
      void loadFavorites();
    };
    window.addEventListener(FAVORITES_UPDATED_EVENT, handleFavoritesUpdated);
    return (): void => window.removeEventListener(FAVORITES_UPDATED_EVENT, handleFavoritesUpdated);
  }, [loadFavorites]);

  const toggleEntryExpanded = useCallback(
    (entry: FavoriteTurnEntry) => {
      const entryKey = favoriteTurnKey(entry);
      const expanding = !expandedEntryKeys.has(entryKey);
      setExpandedEntryKeys(expanding ? new Set([entryKey]) : new Set());
    },
    [expandedEntryKeys],
  );

  const selectFavoriteType = useCallback(
    (nextType: FavoriteType) => {
      if (nextType === favoriteType) {
        return;
      }
      setExpandedEntryKeys(new Set<string>());
      setBatchMode(false);
      setBatchSelectedKeys(new Set<string>());
      setCurrentPage(1);
      setFavoriteType(nextType);
    },
    [favoriteType],
  );

  const removeFavorite = useCallback(
    async (entry: FavoriteTurnEntry, options: { readonly suppressSuccess?: boolean } = {}) => {
      if (pendingRemovalRef.current) {
        return;
      }
      const entryKey = favoriteTurnKey(entry);
      pendingRemovalRef.current = { sessionId: entry.sessionId, requestRunId: entry.requestRunId };
      setPendingRemovalKey(entryKey);
      setRemovalErrorKey(null);
      try {
        const annotation = await annotationService.upsertAnnotation({
          sessionId: entry.sessionId,
          runId: entry.requestRunId,
          ...(favoriteType === 'ANSWER' ? { isFavorited: false } : { isQuestionFavorited: false }),
        });
        if (!mountedRef.current) {
          return;
        }
        const remainsFavorited = favoriteType === 'ANSWER' ? annotation.isFavorited : annotation.isQuestionFavorited;
        if (remainsFavorited) {
          setRemovalErrorKey(entryKey);
          return;
        }
        requestIdRef.current += 1;
        setIsLoading(false);
        setEntries((current) => {
          const nextEntries = current.filter((candidate) => candidate.sessionId !== entry.sessionId || candidate.requestRunId !== entry.requestRunId);
          return nextEntries;
        });
        if (!options.suppressSuccess) {
          message.success(t('sidebar.removeFavoriteSuccess'));
        }
      } catch {
        if (mountedRef.current) {
          setRemovalErrorKey(entryKey);
        }
      } finally {
        pendingRemovalRef.current = null;
        if (mountedRef.current) {
          setPendingRemovalKey(null);
        }
      }
    },
    [favoriteType, t],
  );

  const startBatchMode = useCallback(() => {
    setBatchSelectedKeys(new Set<string>());
    setBatchMode(true);
  }, []);

  const cancelBatchMode = useCallback(() => {
    setBatchMode(false);
    setBatchSelectedKeys(new Set<string>());
  }, []);

  const toggleBatchEntry = useCallback((entryKey: string) => {
    setBatchSelectedKeys((current) => {
      const next = new Set(current);
      if (next.has(entryKey)) {
        next.delete(entryKey);
      } else {
        next.add(entryKey);
      }
      return next;
    });
  }, []);

  const toggleSelectAllBatch = useCallback(() => {
    setBatchSelectedKeys((current) => (current.size >= selectableBatchKeys.size ? new Set<string>() : new Set(selectableBatchKeys)));
  }, [selectableBatchKeys]);

  const batchRemoveFavorites = useCallback(async () => {
    const selectedEntries = entries.filter((entry) => batchSelectedKeys.has(favoriteTurnKey(entry)));
    for (const entry of selectedEntries) {
      await removeFavorite(entry, { suppressSuccess: true });
    }
    if (selectedEntries.length > 0) {
      message.success(t('sidebar.removeFavoriteSuccess'));
    }
    cancelBatchMode();
  }, [batchSelectedKeys, cancelBatchMode, entries, removeFavorite, t]);

  return (
    <section className="favorite-turns-panel" aria-label={t('favorites.title')} data-testid="favorite-turns-panel">
      <PageLayout
        title={t('favorites.title')}
        contentWidth="contained"
        scrollOwner="layout"
        actions={
          <div className="favorite-turns-actions">
            <AuthGate requiredOps={[AICOServiceOperation.Write]}>
              <Button onClick={startBatchMode} icon={<img src={unfavoriteSvg} alt="" aria-hidden="true" className="favorite-batch-remove-icon" />}>
                {t('sidebar.favoritesBatchRemove')}
              </Button>
            </AuthGate>
          </div>
        }
      >
        <div className="favorite-turns-body">
          <div className="favorite-turn-tabs" role="tablist" aria-label={t('favorites.title')}>
            <button
              type="button"
              role="tab"
              aria-selected={favoriteType === 'ANSWER'}
              className={favoriteType === 'ANSWER' ? 'favorite-turn-tab favorite-turn-tab-active' : 'favorite-turn-tab'}
              onClick={() => selectFavoriteType('ANSWER')}
            >
              {t('sidebar.favoriteConversationsTab')}
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={favoriteType === 'QUESTION'}
              className={favoriteType === 'QUESTION' ? 'favorite-turn-tab favorite-turn-tab-active' : 'favorite-turn-tab'}
              onClick={() => selectFavoriteType('QUESTION')}
            >
              {t('sidebar.favoriteQuestionsTab')}
            </button>
          </div>
          <div className="favorite-turns-filter">
            <Input
              className="favorite-turns-search"
              classNames={{ input: 'favorite-turns-search-input' }}
              style={{ height: 32, width: '100%' }}
              styles={{ input: { height: 32 } }}
              value={searchDraft}
              allowClear
              placeholder={
                favoriteType === 'ANSWER' ? t('sidebar.favoriteAnswersSearchPlaceholder') : t('sidebar.favoriteQuestionsSearchPlaceholder')
              }
              aria-label={t('sidebar.favoritesSearch')}
              onChange={(event) => {
                const value = event.target.value;
                setSearchDraft(value);
                if (!value) {
                  setSearchKeyword('');
                }
              }}
              onPressEnter={() => setSearchKeyword(searchDraft)}
              suffix={<SearchOutlined className="favorite-turns-search-icon" />}
            />
            <FavoriteDateFilter
              start={startDate}
              end={endDate}
              onStartChange={setStartDate}
              onEndChange={setEndDate}
              onReset={() => {
                setStartDate(null);
                setEndDate(null);
              }}
            />
          </div>

          <div
            data-testid="favorite-turns-scroll"
            className={`favorite-turns-scroll nextagent-themed-scrollbar ${
              hasExpandedEntry ? 'favorite-turns-scroll-expanded' : 'favorite-turns-scroll-collapsed'
            }`}
          >
            <div className={`favorite-turns-list${hasExpandedEntry ? '' : ' favorite-turns-list-collapsed'}`}>
              {isLoading && entries.length === 0 ? (
                <div className="favorite-turns-state" data-testid="favorite-turns-loading">
                  <Spin size="small" />
                  <Typography.Text type="secondary">{t('sidebar.loadingSessions')}</Typography.Text>
                </div>
              ) : null}

              {hasError ? (
                <div className="favorite-turns-state" data-testid="favorite-turns-error">
                  <Typography.Text type="danger">{t('sidebar.favoritesLoadFailed')}</Typography.Text>
                  <Button type="link" size="small" onClick={() => void loadFavorites()}>
                    {t('common.retry')}
                  </Button>
                </div>
              ) : null}

              {!isLoading && !hasError && entries.length === 0 && !filterActive ? (
                <Typography.Text className="favorite-turns-empty" type="secondary" data-testid="favorite-turns-empty">
                  {t('sidebar.favoritesEmpty')}
                </Typography.Text>
              ) : null}

              {!isLoading && !hasError && entries.length === 0 && filterActive ? (
                <Typography.Text className="favorite-turns-empty" type="secondary" data-testid="favorite-turns-no-matches">
                  {t('sidebar.favoritesNoMatches')}
                </Typography.Text>
              ) : null}

              {currentSessionGroups.map((group) => (
                <article
                  key={group.sessionId}
                  className="favorite-session-card"
                  data-testid={`favorite-session-group-${group.sessionId}`}
                  aria-label={t('sidebar.favoriteSessionGroupLabel', { title: group.sessionTitle, count: group.entries.length })}
                >
                  {favoriteType === 'ANSWER' ? (
                    <div className="favorite-session-summary">
                      <span className="favorite-session-summary-left">
                        <span className="favorite-session-title">{group.sessionTitle}</span>
                      </span>
                    </div>
                  ) : null}

                  {group.entries.map((entry) => {
                    const entryKey = favoriteTurnKey(entry);
                    const canExpandEntry = favoriteType === 'ANSWER';
                    const isEntryExpanded = expandedEntryKeys.has(entryKey);
                    const userMessage = fallbackUserMessage(entry);
                    const panelTitle = userMessage.content || entry.questionPreview;
                    return (
                      <div key={entryKey} className="favorite-turn-row">
                        {batchMode ? (
                          <Checkbox
                            className="favorite-turn-batch-checkbox"
                            checked={batchSelectedKeys.has(entryKey)}
                            aria-label={t('sidebar.favoritesBatchSelect', { title: panelTitle })}
                            onChange={() => toggleBatchEntry(entryKey)}
                          />
                        ) : null}
                        <div className="favorite-turn-detail" data-testid={`favorite-turn-card-${entry.sessionId}-${entry.requestRunId}`}>
                          <div
                            role={canExpandEntry ? 'button' : undefined}
                            tabIndex={canExpandEntry ? 0 : undefined}
                            className={`favorite-turn-panel-title${canExpandEntry ? '' : ' favorite-turn-panel-title--static'}`}
                            aria-expanded={canExpandEntry ? isEntryExpanded : undefined}
                            aria-label={panelTitle}
                            onClick={canExpandEntry ? (): void => toggleEntryExpanded(entry) : undefined}
                            onKeyDown={
                              canExpandEntry
                                ? (event): void => {
                                    if (event.key === 'Enter' || event.key === ' ') {
                                      event.preventDefault();
                                      toggleEntryExpanded(entry);
                                    }
                                  }
                                : undefined
                            }
                          >
                            {canExpandEntry ? (
                              <span className="favorite-turn-panel-title-icon">{isEntryExpanded ? <UpOutlined /> : <DownOutlined />}</span>
                            ) : null}
                            <span className="favorite-turn-panel-title-text">{panelTitle}</span>
                            <time className="favorite-turn-panel-time" dateTime={new Date(userMessage.createdAt).toISOString()}>
                              {formatConversationTime(userMessage.createdAt)}
                            </time>
                            <div className="favorite-turn-card-actions">
                              <button
                                type="button"
                                className="favorite-turn-positioning-button"
                                aria-label={t('sidebar.favoriteOpenConversation')}
                                onClick={(event): void => {
                                  event.stopPropagation();
                                  onOpenFavorite(entry.sessionId, entry.rootMessageId);
                                }}
                              >
                                <img src={positioningSvg} alt="" aria-hidden="true" className="favorite-turn-positioning-icon" />
                              </button>
                              <AuthGate requiredOps={[AICOServiceOperation.Write]}>
                                <Popconfirm
                                  placement="leftTop"
                                  title={t('sidebar.removeFavoriteConfirm')}
                                  cancelText={t('common.cancel')}
                                  okText={t('sidebar.removeFavoriteConfirmButton')}
                                  onConfirm={() => removeFavorite(entry)}
                                >
                                  <button
                                    type="button"
                                    className="favorite-turn-star"
                                    aria-label={t('sidebar.removeFavoriteLabel', { question: entry.questionPreview })}
                                    disabled={batchMode || !canWriteFavorites || pendingRemovalKey !== null}
                                    onClick={(event) => event.stopPropagation()}
                                  >
                                    {pendingRemovalKey === entryKey ? (
                                      <Spin size="small" />
                                    ) : (
                                      <img src={unfavoriteSvg} alt="" aria-hidden="true" className="favorite-turn-unfavorite-icon" />
                                    )}
                                  </button>
                                </Popconfirm>
                              </AuthGate>
                            </div>
                          </div>
                          {removalErrorKey === entryKey ? (
                            <Typography.Text
                              type="danger"
                              className="favorite-turn-remove-error"
                              data-testid={`favorite-turns-remove-error-${entry.requestRunId}`}
                            >
                              {t('sidebar.removeFavoriteFailed')}
                            </Typography.Text>
                          ) : null}
                          {canExpandEntry && isEntryExpanded ? (
                            <div className="favorite-turn-panel-body">
                              <FavoriteTurnExpandedChat entry={entry} />
                            </div>
                          ) : null}
                        </div>
                      </div>
                    );
                  })}
                </article>
              ))}
            </div>
          </div>
          {favoriteSessionGroups.length > FAVORITE_SESSION_PAGE_SIZE ? (
            <Pagination
              className="favorite-turns-pagination"
              current={currentPage}
              pageSize={FAVORITE_SESSION_PAGE_SIZE}
              total={favoriteSessionGroups.length}
              showSizeChanger={false}
              onChange={setCurrentPage}
            />
          ) : null}
        </div>
      </PageLayout>
      {batchMode ? (
        <ShareModeBar
          selectedCount={batchSelectedKeys.size}
          allSelectableCount={selectableBatchKeys.size}
          selectedRunIds={batchSelectedKeys}
          selectableRunIds={selectableBatchKeys}
          onToggleSelectAll={toggleSelectAllBatch}
          onShare={() => void batchRemoveFavorites()}
          onCancel={cancelBatchMode}
          labels={{
            selectAll: t('common.selectAll'),
            selectedCount: t('sidebar.favoritesBatchSelectedCount'),
            cancel: t('common.cancel'),
            confirm: t('sidebar.favoritesBatchRemoveConfirm'),
          }}
        />
      ) : null}
    </section>
  );
}
