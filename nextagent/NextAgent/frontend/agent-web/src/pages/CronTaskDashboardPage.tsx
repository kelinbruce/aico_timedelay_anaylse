import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { DownOutlined } from '@ant-design/icons';
import { Button, DatePicker, Input, message, Modal, Pagination, Popconfirm, Tag } from 'antd';
import dayjs, { type Dayjs } from 'dayjs';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { useNavigate } from 'react-router-dom';
import { cronTaskService, type CronTaskExecutionView, type CronTaskTarget, type CronTaskView } from '../services/cronTaskService.ts';
import { isApiError } from '../services/apiClient.ts';
import { writeCachedComposerDraft } from '../features/chat/hooks/useChatComposerController.ts';
import newChatCron from '../assets/icons/new-chat-cron.svg';
import taskMoreLight from '../assets/icons/cron-more-light.svg';
import taskMoreDark from '../assets/icons/cron-more-dark.svg';
import executeTaskLight from '../assets/icons/execute-cron-light.svg';
import executeTaskDark from '../assets/icons/execute-cron-dark.svg';
import './CronTaskDashboardPage.css';
import { useAppHostContext } from '../app/AppProviders.tsx';
import { PageLayout } from '../components/PageLayout.tsx';
import { AuthGate } from '../features/auth/AuthGate.tsx';
import { AICOServiceOperation } from '../features/auth/authEnums.ts';

const PAGE_SIZE = 10;
const CRON_PROMPT_MAX_LENGTH = 1000;
const NOT_RUNNING_TASK_STATUS = 'NOTRUNNING';
const EXECUTION_RUN_STATUS_OPTIONS = ['FAILED', 'SUPERSEDED', 'COMPLETED', 'CANCELED', NOT_RUNNING_TASK_STATUS] as const;

type Mode = 'detail' | 'create' | 'edit';
type DashboardTab = 'tasks' | 'executions';
type TargetMode = 'NONE' | 'SKILL' | 'WORKFLOW';

interface Draft {
  readonly cron: string;
  readonly prompt: string;
  readonly targetMode: TargetMode;
  readonly targetName: string;
  readonly recurring: boolean;
}

interface ExecutionFilter {
  readonly taskName: string;
  readonly taskStatus: string;
  readonly startDate: string;
  readonly endDate: string;
}

interface ExecutionTimelineNode {
  readonly id: string;
  readonly date: string;
  readonly label: string;
  readonly count: number;
  readonly status: string | undefined;
}

const emptyDraft: Draft = {
  cron: '',
  prompt: '',
  targetMode: 'NONE',
  targetName: '',
  recurring: true,
};

const emptyExecutionFilter: ExecutionFilter = {
  taskName: '',
  taskStatus: '',
  startDate: '',
  endDate: '',
};

export interface CronTaskDashboardPageProps {
  readonly onCreateFromSession?: () => void;
}

export function CronTaskDashboardPage({ onCreateFromSession }: CronTaskDashboardPageProps) {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<DashboardTab>('tasks');
  const [tasks, setTasks] = useState<readonly CronTaskView[]>([]);
  const [selectedTaskId, setSelectedTaskId] = useState('');
  const [mode, setMode] = useState<Mode>('detail');
  const [listLoading, setListLoading] = useState(false);
  const [listError, setListError] = useState('');
  const [actionLoading, setActionLoading] = useState(false);
  const [actionError, setActionError] = useState('');
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [executions, setExecutions] = useState<readonly CronTaskExecutionView[]>([]);
  const [executionsLoading, setExecutionsLoading] = useState(false);
  const [executionsError, setExecutionsError] = useState('');
  const [executionFilterDraft, setExecutionFilterDraft] = useState<ExecutionFilter>(emptyExecutionFilter);
  const [executionFilter, setExecutionFilter] = useState<ExecutionFilter>(emptyExecutionFilter);
  const [activeMenuTaskId, setActiveMenuTaskId] = useState<string | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalTasks, setTotalTasks] = useState(0);
  const listSeqRef = useRef(0);
  const executionsSeqRef = useRef(0);

  const selectedTask = useMemo(() => tasks.find((task) => task.taskId === selectedTaskId) ?? null, [selectedTaskId, tasks]);
  const statusFilterOptions = EXECUTION_RUN_STATUS_OPTIONS;

  const filteredExecutions = useMemo(() => filterExecutions(executions, selectedTask, executionFilter), [executionFilter, executions, selectedTask]);

  const loadTasks = useCallback(
    async (preferredTaskId?: string, page?: number) => {
      const targetPage = page ?? 1;
      const seq = ++listSeqRef.current;
      setListLoading(true);
      setListError('');
      try {
        const offset = (targetPage - 1) * PAGE_SIZE;
        const result = await cronTaskService.listCronTasks({ offset, limit: PAGE_SIZE });
        if (seq !== listSeqRef.current) {
          return;
        }
        const sortedTasks = [...result.tasks].sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime());
        setTasks(sortedTasks);
        setTotalTasks(result.total);
        setCurrentPage(targetPage);
        setSelectedTaskId((current) => {
          if (preferredTaskId && sortedTasks.some((task) => task.taskId === preferredTaskId)) {
            return preferredTaskId;
          }
          if (current && sortedTasks.some((task) => task.taskId === current)) {
            return current;
          }
          return sortedTasks[0]?.taskId ?? '';
        });
      } catch (error) {
        if (seq === listSeqRef.current) {
          setListError(errorMessage(error, t('cronTasks.errors.loadTasks'), t));
        }
      } finally {
        if (seq === listSeqRef.current) {
          setListLoading(false);
        }
      }
    },
    [t],
  );

  const loadExecutions = useCallback(
    async (taskId: string) => {
      if (!taskId) {
        setExecutions([]);
        return;
      }
      const seq = ++executionsSeqRef.current;
      setExecutionsLoading(true);
      setExecutionsError('');
      try {
        const page = await cronTaskService.listCronTaskExecutions(taskId, { offset: 0, limit: PAGE_SIZE });
        if (seq !== executionsSeqRef.current) {
          return;
        }
        setExecutions(page.executions);
      } catch (error) {
        if (seq === executionsSeqRef.current) {
          setExecutions([]);
          setExecutionsError(errorMessage(error, t('cronTasks.errors.loadExecutions'), t));
        }
      } finally {
        if (seq === executionsSeqRef.current) {
          setExecutionsLoading(false);
        }
      }
    },
    [t],
  );

  const loadAllExecutions = useCallback(async () => {
    const seq = ++executionsSeqRef.current;
    setExecutionsLoading(true);
    setExecutionsError('');
    try {
      const pages = await Promise.all(tasks.map((task) => cronTaskService.listCronTaskExecutions(task.taskId, { offset: 0, limit: PAGE_SIZE })));
      if (seq !== executionsSeqRef.current) {
        return;
      }
      setExecutions(pages.flatMap((page) => page.executions));
    } catch (error) {
      if (seq === executionsSeqRef.current) {
        setExecutions([]);
        setExecutionsError(errorMessage(error, t('cronTasks.errors.loadExecutions'), t));
      }
    } finally {
      if (seq === executionsSeqRef.current) {
        setExecutionsLoading(false);
      }
    }
  }, [t, tasks]);

  useEffect(() => {
    void loadTasks();
  }, [loadTasks]);

  useEffect(() => {
    if (executionFilter.taskName.trim()) {
      return;
    }
    void loadAllExecutions();
  }, [executionFilter, loadAllExecutions]);

  useEffect(() => {
    if (activeMenuTaskId === null) {
      return undefined;
    }

    const handleDocumentMouseDown = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Element)) {
        return;
      }
      if (target.closest('.cron-task-card__menu') || target.closest('.cron-task-card__menu-wrap > button') || target.closest('.ant-popover')) {
        return;
      }
      setActiveMenuTaskId(null);
    };

    document.addEventListener('mousedown', handleDocumentMouseDown);
    return () => document.removeEventListener('mousedown', handleDocumentMouseDown);
  }, [activeMenuTaskId]);

  const startCreate = useCallback(() => {
    setActiveTab('tasks');
    setMode('create');
    setActionError('');
    setDraft(emptyDraft);
  }, []);

  const createFromSession = useCallback(() => {
    writeCachedComposerDraft(null, t('cronTasks.conversationTemplate'));
    if (onCreateFromSession) {
      onCreateFromSession();
      return;
    }
    navigate('/');
  }, [navigate, onCreateFromSession, t]);

  const startEdit = useCallback((task: CronTaskView) => {
    setActiveTab('tasks');
    setSelectedTaskId(task.taskId);
    setMode('edit');
    setActionError('');
    setDraft({
      cron: task.cron,
      prompt: task.prompt,
      targetMode: task.target?.kind ?? 'NONE',
      targetName: task.target?.name ?? '',
      recurring: task.recurring,
    });
  }, []);

  const cancelForm = useCallback(() => {
    setMode('detail');
    setActionError('');
    setDraft(emptyDraft);
  }, []);

  const submitForm = useCallback(async () => {
    const cron = draft.cron.trim();
    const prompt = draft.prompt.trim();
    if (!cron || !prompt) {
      setActionError(t('cronTasks.errors.required'));
      return;
    }
    const target = buildDraftTarget(draft);
    if (target === false) {
      setActionError(t('cronTasks.errors.targetRequired'));
      return;
    }
    setActionLoading(true);
    setActionError('');
    try {
      const saved =
        mode === 'create'
          ? await cronTaskService.createCronTask({
              cron,
              prompt,
              ...(target === undefined ? {} : { target }),
              recurring: draft.recurring,
            })
          : selectedTask
            ? await cronTaskService.updateCronTask(selectedTask.taskId, {
                cron,
                prompt,
                ...(target === undefined && selectedTask.target !== undefined ? { target: null } : target === undefined ? {} : { target }),
                recurring: draft.recurring,
              })
            : null;
      if (!saved) {
        return;
      }
      message.success(mode === 'create' ? t('cronTasks.messages.created') : t('cronTasks.messages.updated'));
      setMode('detail');
      setActiveTab('tasks');
      await loadTasks(saved.taskId, mode === 'create' ? 1 : currentPage);
    } catch (error) {
      setActionError(resolveCronFormError(error, t('cronTasks.errors.save'), t));
    } finally {
      setActionLoading(false);
    }
  }, [currentPage, draft, loadTasks, mode, selectedTask, t]);

  const deleteTask = useCallback(
    async (task: CronTaskView) => {
      setSelectedTaskId(task.taskId);
      setMode('detail');
      setActionLoading(true);
      setActionError('');
      try {
        await cronTaskService.deleteCronTask(task.taskId);
        message.success(t('cronTasks.messages.deleted'));
        setExecutions([]);
        const targetPage = tasks.length <= 1 && currentPage > 1 ? currentPage - 1 : currentPage;
        await loadTasks(undefined, targetPage);
      } catch (error) {
        setActionError(resolveCronErrorByCode(error, t('cronTasks.errors.delete'), t));
        await loadTasks(undefined, currentPage);
      } finally {
        setActionLoading(false);
      }
    },
    [currentPage, loadTasks, t, tasks.length],
  );

  const openExecutions = useCallback(
    async (task: CronTaskView) => {
      setSelectedTaskId(task.taskId);
      setExecutionFilterDraft((current) => ({ ...current, taskName: taskTitle(task) }));
      setExecutionFilter((current) => ({ ...current, taskName: taskTitle(task) }));
      setMode('detail');
      setActionError('');
      setActionLoading(true);
      try {
        await cronTaskService.executeCronTask(task.taskId);
        setActiveTab('executions');
        await loadExecutions(task.taskId);
      } catch (error) {
        setActionError(errorMessage(error, t('cronTasks.errors.execute'), t));
      } finally {
        setActionLoading(false);
      }
    },
    [loadExecutions, t],
  );

  const applyExecutionFilter = useCallback(() => {
    const normalized = normalizeExecutionFilter(executionFilterDraft);
    const matchedTask = normalized.taskName ? tasks.find((task) => taskTitle(task).toLowerCase() === normalized.taskName.toLowerCase()) : null;
    if (matchedTask) {
      setSelectedTaskId(matchedTask.taskId);
      void loadExecutions(matchedTask.taskId);
    }
    setExecutionFilter(normalized);
  }, [executionFilterDraft, loadExecutions, tasks]);

  const resetExecutionFilter = useCallback(() => {
    setExecutionFilterDraft(emptyExecutionFilter);
    setExecutionFilter(emptyExecutionFilter);
  }, []);

  const handleExecutionFilterChange = useCallback((filter: ExecutionFilter) => {
    setExecutionFilterDraft(filter);
  }, []);

  const openExecutionsTab = useCallback(() => {
    setActiveTab('executions');
  }, []);

  return (
    <div className="cron-dashboard" data-testid="cron-task-dashboard-page">
      <PageLayout
        title={t('cronTasks.title')}
        contentWidth="contained"
        scrollOwner="layout"
        actions={
          <div className="cron-dashboard__actions">
            <AuthGate requiredOps={[AICOServiceOperation.Write]}>
              <Button onClick={startCreate}>{t('cronTasks.actions.manualCreate')}</Button>
            </AuthGate>
            <AuthGate requiredOps={[AICOServiceOperation.Write]}>
              <Button type="primary" onClick={createFromSession}>
                <img src={newChatCron} alt="" aria-hidden="true" style={{ width: 20, height: 20, flexShrink: 0 }} />
                {t('cronTasks.actions.createFromSession')}
              </Button>
            </AuthGate>
          </div>
        }
      >
        <div className="cron-dashboard__content">
          <div className="cron-dashboard__tabs" role="tablist" aria-label={t('cronTasks.tabs.label')}>
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === 'tasks'}
              className={`cron-tab ${activeTab === 'tasks' ? 'active' : ''}`}
              onClick={() => setActiveTab('tasks')}
            >
              {t('cronTasks.tabs.tasks')}
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === 'executions'}
              className={`cron-tab ${activeTab === 'executions' ? 'active' : ''}`}
              onClick={openExecutionsTab}
            >
              {t('cronTasks.tabs.executions')}
            </button>
          </div>

          {activeTab === 'tasks' ? (
            <section className="cron-panel" aria-label={t('cronTasks.tabs.tasks')}>
              <Modal
                open={mode === 'create' || mode === 'edit'}
                title={mode === 'create' ? t('cronTasks.form.createTitle') : t('cronTasks.form.editTitle')}
                onCancel={cancelForm}
                onOk={() => void submitForm()}
                confirmLoading={actionLoading}
                okText={t('cronTasks.actions.save')}
                cancelText={t('common.cancel')}
                width={560}
              >
                <TaskForm
                  draft={draft}
                  actionError={actionError}
                  onDraftChange={setDraft}
                  labels={{
                    cron: t('cronTasks.form.cron'),
                    prompt: t('cronTasks.form.prompt'),
                    targetMode: t('cronTasks.form.targetMode'),
                    targetNone: t('cronTasks.form.targetNone'),
                    targetSkill: t('cronTasks.form.targetSkill'),
                    targetWorkflow: t('cronTasks.form.targetWorkflow'),
                    targetName: t('cronTasks.form.targetName'),
                    recurring: t('cronTasks.form.recurring'),
                  }}
                />
              </Modal>
              {actionError && mode === 'detail' ? <div className="cron-error">{actionError}</div> : null}
              {listLoading && tasks.length === 0 ? <EmptyState text={t('cronTasks.empty.loadingTasks')} /> : null}
              {listError ? (
                <EmptyState text={listError}>
                  <button type="button" className="cron-btn" onClick={() => void loadTasks(undefined, currentPage)}>
                    {t('common.retry')}
                  </button>
                </EmptyState>
              ) : null}
              {!listLoading && !listError && tasks.length === 0 ? <EmptyState text={t('cronTasks.empty.noTasks')} /> : null}
              {tasks.length > 0 ? (
                <>
                  <div className="cron-card-grid" data-testid="cron-task-card-list">
                    {tasks.map((task) => (
                      <TaskCard
                        key={task.taskId}
                        task={task}
                        selected={task.taskId === selectedTaskId}
                        onSelect={() => setSelectedTaskId(task.taskId)}
                        actionLoading={actionLoading}
                        menuOpen={activeMenuTaskId === task.taskId}
                        onMenuToggle={() => setActiveMenuTaskId((current) => (current === task.taskId ? null : task.taskId))}
                        onExecute={() => void openExecutions(task)}
                        onEdit={() => startEdit(task)}
                        onDelete={() => void deleteTask(task)}
                        labels={{
                          title: t('cronTasks.card.title'),
                          content: t('cronTasks.card.content'),
                          schedule: t('cronTasks.card.schedule'),
                          frequency: t('cronTasks.card.frequency'),
                          createdBy: t('cronTasks.card.createdBy'),
                          everyMinutes: (minutes) => t('cronTasks.card.everyMinutes', { minutes }),
                          everyHourAtMinute: (minute) => t('cronTasks.card.everyHourAtMinute', { minute }),
                          everyDayAt: (time) => t('cronTasks.card.everyDayAt', { time }),
                          everyHours: (hours) => t('cronTasks.card.everyHours', { hours }),
                          everyHoursAtMinute: (hours, minute) => t('cronTasks.card.everyHoursAtMinute', { hours, minute }),
                          everyWeekdayAt: (weekday, time) => t('cronTasks.card.everyWeekdayAt', { weekday, time }),
                          weekdaysAt: (time) => t('cronTasks.card.weekdaysAt', { time }),
                          weekendAt: (time) => t('cronTasks.card.weekendAt', { time }),
                          dailyAtMultiple: (times) => t('cronTasks.card.dailyAtMultiple', { times }),
                          multiWeekdaysAt: (weekdays, time) => t('cronTasks.card.multiWeekdaysAt', { weekdays, time }),
                          monthlyOnDayAt: (day, time) => t('cronTasks.card.monthlyOnDayAt', { day, time }),
                          monthlyOnDaysAt: (days, time) => t('cronTasks.card.monthlyOnDaysAt', { days, time }),
                          customSchedule: () => t('cronTasks.card.customSchedule'),
                          weekdayName: (index: number) => (i18n.language.startsWith('zh') ? WEEKDAY_LABELS_ZH : WEEKDAY_LABELS_EN)[index % 7] ?? '',
                          target: t('cronTasks.card.target'),
                          recurring: t('cronTasks.detail.recurring'),
                          oneTime: t('cronTasks.detail.oneTime'),
                          nextRun: t('cronTasks.detail.nextRun'),
                          execute: t('cronTasks.actions.execute'),
                          edit: t('cronTasks.actions.edit'),
                          delete: t('cronTasks.actions.delete'),
                          moreActions: t('cronTasks.actions.moreActions'),
                          statusActive: t('cronTasks.card.statusActive'),
                          statusCompleted: t('cronTasks.card.statusCompleted'),
                          deleteTitle: t('cronTasks.delete.title'),
                          deleteConfirm: t('cronTasks.delete.content', { taskId: task.taskId }),
                          cancel: t('common.cancel'),
                        }}
                      />
                    ))}
                  </div>
                  {totalTasks > PAGE_SIZE ? (
                    <Pagination
                      className="cron-pagination"
                      current={currentPage}
                      pageSize={PAGE_SIZE}
                      total={totalTasks}
                      onChange={(page) => void loadTasks(undefined, page)}
                      showTotal={(total) => t('cronTasks.pagination.total', { total })}
                    />
                  ) : null}
                </>
              ) : null}
            </section>
          ) : (
            <section className="cron-panel" aria-label={t('cronTasks.tabs.executions')}>
              <ExecutionFilterBar
                filter={executionFilterDraft}
                taskOptions={tasks.map(taskTitle)}
                statusOptions={statusFilterOptions}
                onFilterChange={handleExecutionFilterChange}
                onApply={applyExecutionFilter}
                onReset={resetExecutionFilter}
                labels={{
                  taskName: t('cronTasks.filters.taskName'),
                  taskNamePlaceholder: t('cronTasks.filters.taskNamePlaceholder'),
                  taskStatus: t('cronTasks.filters.taskStatus'),
                  startDate: t('cronTasks.filters.startDate'),
                  startDatePlaceholder: t('cronTasks.filters.startDatePlaceholder'),
                  endDate: t('cronTasks.filters.endDate'),
                  endDatePlaceholder: t('cronTasks.filters.endDatePlaceholder'),
                  endDateBeforeStart: t('cronTasks.filters.endDateBeforeStart'),
                  apply: t('cronTasks.filters.apply'),
                  reset: t('cronTasks.filters.reset'),
                  statusFailed: t('cronTasks.executions.statusFailed'),
                  statusSuperseded: t('cronTasks.executions.statusSuperseded'),
                  statusCompleted: t('cronTasks.executions.statusCompleted'),
                  statusCanceled: t('cronTasks.executions.statusCanceled'),
                  statusNotRunning: t('cronTasks.executions.statusNotRunning'),
                }}
              />
              {selectedTask || !executionFilter.taskName.trim() ? (
                <ExecutionRecords
                  executions={filteredExecutions}
                  executionsLoading={executionsLoading}
                  executionsError={executionsError}
                  onRetry={() => {
                    if (executionFilter.taskName.trim() && selectedTask) {
                      void loadExecutions(selectedTask.taskId);
                    } else {
                      void loadAllExecutions();
                    }
                  }}
                  labels={{
                    retry: t('common.retry'),
                    loadingExecutions: t('cronTasks.empty.loadingExecutions'),
                    noExecutions: t('cronTasks.empty.noExecutions'),
                    timeline: t('cronTasks.executions.timeline'),
                    today: t('cronTasks.executions.today'),
                    runCount: (count) => t('cronTasks.executions.runCount', { count }),
                    details: t('cronTasks.executions.details'),
                    triggerStatus: t('cronTasks.executions.triggerStatus'),
                    runStatus: t('cronTasks.executions.runStatus'),
                    commitState: t('cronTasks.executions.commitState'),
                  }}
                />
              ) : (
                <EmptyState text={t('cronTasks.empty.selectTask')} />
              )}
            </section>
          )}
        </div>
      </PageLayout>
    </div>
  );
}

function CronFilterSelect(props: {
  readonly id: string;
  readonly value: string;
  readonly displayValue: string;
  readonly placeholder: string;
  readonly ariaLabel: string;
  readonly options: readonly string[];
  readonly optionLabel?: (option: string) => string;
  readonly readOnly?: boolean;
  readonly onInputChange?: (value: string) => void;
  readonly onOptionSelect: (option: string) => void;
}) {
  const [optionsOpen, setOptionsOpen] = useState(false);
  const optionsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!optionsOpen) {
      return undefined;
    }
    const handleDocumentMouseDown = (event: MouseEvent) => {
      const target = event.target;
      if (target instanceof Node && optionsRef.current?.contains(target)) {
        return;
      }
      setOptionsOpen(false);
    };
    document.addEventListener('mousedown', handleDocumentMouseDown);
    return () => document.removeEventListener('mousedown', handleDocumentMouseDown);
  }, [optionsOpen]);

  const resolveOptionLabel = props.optionLabel ?? ((option: string) => option);

  return (
    <div className="cron-execution-filter-select" ref={optionsRef}>
      {props.readOnly ? (
        <button
          type="button"
          role="combobox"
          aria-label={props.ariaLabel}
          aria-expanded={optionsOpen}
          aria-controls={props.id}
          aria-haspopup="listbox"
          className="cron-task-form__target-mode-trigger cron-execution-filter-select__trigger"
          onClick={() => setOptionsOpen((open) => !open)}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              setOptionsOpen(false);
            }
            if (event.key === 'ArrowDown') {
              setOptionsOpen(true);
            }
          }}
        >
          {props.displayValue || props.placeholder}
          <DownOutlined
            aria-hidden="true"
            className={`cron-execution-filter-select__arrow ${optionsOpen ? 'cron-execution-filter-select__arrow--open' : ''}`}
          />
        </button>
      ) : (
        <>
          <input
            role="combobox"
            aria-label={props.ariaLabel}
            aria-expanded={optionsOpen}
            aria-controls={props.id}
            aria-autocomplete="list"
            value={props.displayValue}
            placeholder={props.placeholder}
            onChange={(event) => {
              if (props.onInputChange) {
                props.onInputChange(event.target.value);
                setOptionsOpen(true);
              }
            }}
            onFocus={() => setOptionsOpen(true)}
            onBlur={() => setOptionsOpen(false)}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                setOptionsOpen(false);
              }
              if (event.key === 'ArrowDown') {
                setOptionsOpen(true);
              }
            }}
          />
          <DownOutlined
            aria-hidden="true"
            className={`cron-execution-filter-select__arrow ${optionsOpen ? 'cron-execution-filter-select__arrow--open' : ''}`}
          />
        </>
      )}
      {optionsOpen && props.options.length > 0 ? (
        <div id={props.id} className="cron-execution-filter-options" role="listbox" aria-label={props.ariaLabel}>
          {props.options.map((option) => (
            <button
              type="button"
              key={option}
              role="option"
              aria-selected={option === props.value}
              className="cron-execution-filter-option"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => {
                props.onOptionSelect(option);
                setOptionsOpen(false);
              }}
            >
              {resolveOptionLabel(option)}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

interface ExecutionRunStatusLabels {
  readonly statusFailed: string;
  readonly statusSuperseded: string;
  readonly statusCompleted: string;
  readonly statusCanceled: string;
  readonly statusNotRunning: string;
}

function taskStatusLabel(status: string, labels: ExecutionRunStatusLabels): string {
  switch (status) {
    case 'FAILED':
      return labels.statusFailed;
    case 'SUPERSEDED':
      return labels.statusSuperseded;
    case 'COMPLETED':
      return labels.statusCompleted;
    case 'CANCELED':
      return labels.statusCanceled;
    case NOT_RUNNING_TASK_STATUS:
      return labels.statusNotRunning;
    default:
      return status;
  }
}

function ExecutionFilterBar(props: {
  readonly filter: ExecutionFilter;
  readonly taskOptions: readonly string[];
  readonly statusOptions: readonly string[];
  readonly onFilterChange: (filter: ExecutionFilter) => void;
  readonly onApply: () => void;
  readonly onReset: () => void;
  readonly labels: {
    readonly taskName: string;
    readonly taskNamePlaceholder: string;
    readonly taskStatus: string;
    readonly startDate: string;
    readonly startDatePlaceholder: string;
    readonly endDate: string;
    readonly endDatePlaceholder: string;
    readonly endDateBeforeStart: string;
    readonly apply: string;
    readonly reset: string;
    readonly statusFailed: string;
    readonly statusSuperseded: string;
    readonly statusCompleted: string;
    readonly statusCanceled: string;
    readonly statusNotRunning: string;
  };
}) {
  const normalizedTaskName = props.filter.taskName.trim().toLocaleLowerCase();
  const visibleTaskOptions = props.taskOptions;
  const selectedTaskOption = props.taskOptions.find((option) => option.toLocaleLowerCase() === normalizedTaskName) ?? '';
  const today = dayjs().startOf('day');
  const parsedStartDate = props.filter.startDate ? dayjs(props.filter.startDate) : null;
  const parsedEndDate = props.filter.endDate ? dayjs(props.filter.endDate) : null;
  const startDate = parsedStartDate?.isValid() ? parsedStartDate : null;
  const endDate = parsedEndDate?.isValid() ? parsedEndDate : null;
  const endDateError = startDate && endDate && endDate.isBefore(startDate, 'day') ? props.labels.endDateBeforeStart : '';
  const hasDateRangeError = Boolean(endDateError);

  const handleApply = () => {
    if (!hasDateRangeError) {
      props.onApply();
    }
  };

  return (
    <div className="cron-execution-filters" data-testid="cron-execution-filters">
      <label className="cron-field">
        <CronFilterSelect
          id="cron-task-status-filter-options"
          value={props.filter.taskStatus}
          displayValue={props.filter.taskStatus ? taskStatusLabel(props.filter.taskStatus, props.labels) : ''}
          placeholder={props.labels.taskStatus}
          ariaLabel={props.labels.taskStatus}
          options={props.statusOptions}
          optionLabel={(status) => taskStatusLabel(status, props.labels)}
          onInputChange={(value) => props.onFilterChange({ ...props.filter, taskStatus: value })}
          onOptionSelect={(status) => props.onFilterChange({ ...props.filter, taskStatus: status })}
        />
      </label>
      <label className="cron-field">
        <CronFilterSelect
          id="cron-task-filter-options"
          value={selectedTaskOption}
          displayValue={props.filter.taskName}
          placeholder={props.labels.taskNamePlaceholder}
          ariaLabel={props.labels.taskName}
          options={visibleTaskOptions}
          onInputChange={(value) => props.onFilterChange({ ...props.filter, taskName: value })}
          onOptionSelect={(option) => props.onFilterChange({ ...props.filter, taskName: option })}
        />
      </label>
      <label className="cron-field">
        <DatePicker
          value={startDate}
          placeholder={props.labels.startDatePlaceholder}
          aria-label={props.labels.startDate}
          format="YYYY-MM-DD"
          allowClear
          disabledDate={(current: Dayjs | null) => (current ? current.isAfter(today, 'day') : false)}
          onChange={(date: Dayjs | null) => props.onFilterChange({ ...props.filter, startDate: date ? date.format('YYYY-MM-DD') : '' })}
        />
      </label>
      <label className="cron-field">
        <DatePicker
          value={endDate}
          placeholder={props.labels.endDatePlaceholder}
          aria-label={props.labels.endDate}
          format="YYYY-MM-DD"
          allowClear
          disabledDate={(current: Dayjs | null) => (current ? current.isAfter(today, 'day') : false)}
          status={endDateError ? 'error' : ''}
          onChange={(date: Dayjs | null) => props.onFilterChange({ ...props.filter, endDate: date ? date.format('YYYY-MM-DD') : '' })}
        />
        {endDateError ? (
          <div className="cron-field__error" role="alert">
            {endDateError}
          </div>
        ) : null}
      </label>
      <div className="cron-execution-filters__actions">
        <Button type="primary" onClick={handleApply} disabled={hasDateRangeError}>
          {props.labels.apply}
        </Button>
        <Button onClick={props.onReset}>{props.labels.reset}</Button>
      </div>
    </div>
  );
}

function TaskForm(props: {
  readonly draft: Draft;
  readonly actionError: string;
  readonly onDraftChange: (draft: Draft) => void;
  readonly labels: {
    readonly cron: string;
    readonly prompt: string;
    readonly targetMode: string;
    readonly targetNone: string;
    readonly targetSkill: string;
    readonly targetWorkflow: string;
    readonly targetName: string;
    readonly recurring: string;
  };
}) {
  const [targetModeOpen, setTargetModeOpen] = useState(false);
  const targetModeRef = useRef<HTMLDivElement>(null);
  const targetModeOptions: ReadonlyArray<{ readonly value: TargetMode; readonly label: string }> = [
    { value: 'NONE', label: props.labels.targetNone },
    { value: 'SKILL', label: props.labels.targetSkill },
    { value: 'WORKFLOW', label: props.labels.targetWorkflow },
  ];
  const selectedTargetModeLabel = targetModeOptions.find((option) => option.value === props.draft.targetMode)?.label ?? '';

  useEffect(() => {
    if (!targetModeOpen) {
      return undefined;
    }
    const handleDocumentMouseDown = (event: MouseEvent) => {
      const target = event.target;
      if (target instanceof Node && targetModeRef.current?.contains(target)) {
        return;
      }
      setTargetModeOpen(false);
    };
    document.addEventListener('mousedown', handleDocumentMouseDown);
    return () => document.removeEventListener('mousedown', handleDocumentMouseDown);
  }, [targetModeOpen]);

  return (
    <div className="cron-form" data-testid="cron-task-form">
      {props.actionError ? <div className="cron-error">{props.actionError}</div> : null}
      <label className="cron-field">
        <span>{props.labels.cron}</span>
        <input
          className="cron-task-form__cron"
          value={props.draft.cron}
          onChange={(event) => props.onDraftChange({ ...props.draft, cron: event.target.value })}
          placeholder="0 9 * * *"
        />
      </label>
      <label className="cron-field">
        <span>{props.labels.prompt}</span>
        <Input.TextArea
          className="cron-task-form__prompt"
          value={props.draft.prompt}
          onChange={(event) => props.onDraftChange({ ...props.draft, prompt: event.target.value })}
          rows={5}
          maxLength={CRON_PROMPT_MAX_LENGTH}
          showCount
        />
      </label>
      <div className="cron-target-fields">
        <label className="cron-field">
          <span>{props.labels.targetMode}</span>
          <div className="cron-execution-filter-select cron-task-form__target-mode-select" ref={targetModeRef}>
            <button
              type="button"
              role="combobox"
              aria-expanded={targetModeOpen}
              aria-controls="cron-task-target-mode-options"
              aria-label={props.labels.targetMode}
              className="cron-task-form__target-mode-trigger"
              onClick={() => setTargetModeOpen((open) => !open)}
              onKeyDown={(event) => {
                if (event.key === 'Escape') {
                  setTargetModeOpen(false);
                }
                if (event.key === 'ArrowDown') {
                  setTargetModeOpen(true);
                }
              }}
            >
              {selectedTargetModeLabel}
              <DownOutlined
                aria-hidden="true"
                className={`cron-execution-filter-select__arrow ${targetModeOpen ? 'cron-execution-filter-select__arrow--open' : ''}`}
              />
            </button>
            {targetModeOpen ? (
              <div id="cron-task-target-mode-options" className="cron-execution-filter-options" role="listbox" aria-label={props.labels.targetMode}>
                {targetModeOptions.map((option) => (
                  <button
                    type="button"
                    key={option.value}
                    role="option"
                    aria-selected={option.value === props.draft.targetMode}
                    className="cron-execution-filter-option"
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => {
                      props.onDraftChange({ ...props.draft, targetMode: option.value });
                      setTargetModeOpen(false);
                    }}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        </label>
        {props.draft.targetMode !== 'NONE' ? (
          <label className="cron-field">
            <span>{props.labels.targetName}</span>
            <input
              value={props.draft.targetName}
              onChange={(event) => props.onDraftChange({ ...props.draft, targetName: event.target.value })}
              placeholder={props.draft.targetMode === 'SKILL' ? 'network-diagnosis' : 'daily-report'}
            />
          </label>
        ) : null}
      </div>
      <label className="cron-checkbox">
        <input
          type="checkbox"
          checked={props.draft.recurring}
          onChange={(event) => props.onDraftChange({ ...props.draft, recurring: event.target.checked })}
        />
        <span>{props.labels.recurring}</span>
      </label>
    </div>
  );
}

function TaskCard(props: {
  readonly task: CronTaskView;
  readonly selected: boolean;
  readonly onSelect: () => void;
  readonly actionLoading: boolean;
  readonly menuOpen: boolean;
  readonly onMenuToggle: () => void;
  readonly onExecute: () => void;
  readonly onEdit: () => void;
  readonly onDelete: () => void;
  readonly labels: {
    readonly title: string;
    readonly content: string;
    readonly schedule: string;
    readonly frequency: string;
    readonly createdBy: string;
    readonly everyMinutes: (minutes: number) => string;
    readonly everyHourAtMinute: (minute: string) => string;
    readonly everyDayAt: (time: string) => string;
    readonly everyHours: (hours: number) => string;
    readonly everyHoursAtMinute: (hours: number, minute: string) => string;
    readonly everyWeekdayAt: (weekday: string, time: string) => string;
    readonly weekdaysAt: (time: string) => string;
    readonly weekendAt: (time: string) => string;
    readonly dailyAtMultiple: (times: string) => string;
    readonly multiWeekdaysAt: (weekdays: string, time: string) => string;
    readonly monthlyOnDayAt: (day: number, time: string) => string;
    readonly monthlyOnDaysAt: (days: string, time: string) => string;
    readonly customSchedule: () => string;
    readonly weekdayName: (index: number) => string;
    readonly target: string;
    readonly recurring: string;
    readonly oneTime: string;
    readonly nextRun: string;
    readonly execute: string;
    readonly edit: string;
    readonly delete: string;
    readonly moreActions: string;
    readonly statusActive: string;
    readonly statusCompleted: string;
    readonly deleteTitle: string;
    readonly deleteConfirm: string;
    readonly cancel: string;
  };
}) {
  const { themeMode } = useAppHostContext();
  const editTask = () => {
    props.onMenuToggle();
    props.onEdit();
  };
  return (
    <article
      className={`cron-task-card ${props.selected ? 'active' : ''}`}
      data-testid={`cron-task-card-${props.task.taskId}`}
      onClick={props.onSelect}
    >
      <div className="cron-task-card__head">
        <div className="cron-task-card__title">
          <strong>{taskTitle(props.task)}</strong>
        </div>
        <div className="cron-task-card__head-actions">
          <div className="cron-task-card__menu-wrap">
            <button
              type="button"
              className="cron-btn cron-btn--icon"
              aria-label={props.labels.moreActions}
              aria-haspopup="menu"
              aria-expanded={props.menuOpen}
              onClick={props.onMenuToggle}
              disabled={props.actionLoading}
            >
              <img
                src={themeMode === 'dark' ? taskMoreDark : taskMoreLight}
                alt=""
                aria-hidden="true"
                style={{ width: 20, height: 20, flexShrink: 0 }}
              />
            </button>
            {props.menuOpen ? (
              <div className="cron-task-card__menu" role="menu">
                <AuthGate requiredOps={[AICOServiceOperation.Write]}>
                  <button
                    type="button"
                    role="menuitem"
                    className="cron-task-card__menu-item"
                    onClick={editTask}
                    disabled={props.actionLoading || props.task.status !== 'ACTIVE'}
                  >
                    {props.labels.edit}
                  </button>
                </AuthGate>
                <AuthGate requiredOps={[AICOServiceOperation.Write]}>
                  <Popconfirm
                    title={props.labels.deleteTitle}
                    description={props.labels.deleteConfirm}
                    onConfirm={props.onDelete}
                    okText={props.labels.delete}
                    cancelText={props.labels.cancel}
                    disabled={props.actionLoading}
                  >
                    <button type="button" role="menuitem" className="cron-task-card__menu-item" disabled={props.actionLoading}>
                      {props.labels.delete}
                    </button>
                  </Popconfirm>
                </AuthGate>
              </div>
            ) : null}
          </div>
          <AuthGate requiredOps={[AICOServiceOperation.Write]}>
            <button type="button" className="cron-btn cron-btn--link" onClick={props.onExecute} aria-label={props.labels.execute}>
              <img
                src={themeMode === 'dark' ? executeTaskDark : executeTaskLight}
                alt=""
                aria-hidden="true"
                style={{ width: 20, height: 20, flexShrink: 0 }}
              />
            </button>
          </AuthGate>
          <Tag color={props.task.status === 'ACTIVE' ? 'success' : 'default'}>
            {props.task.status === 'ACTIVE' ? props.labels.statusActive : props.labels.statusCompleted}
          </Tag>
        </div>
      </div>
      <p className="cron-task-card__content">{props.task.prompt}</p>
      {props.task.target ? (
        <div className="cron-task-card__target">
          <span>
            {props.labels.target}: {taskTargetLabel(props.task.target)}
          </span>
        </div>
      ) : null}
      <div className="cron-task-card__footer">
        <div className="cron-task-card__schedule">
          <span>
            {props.labels.schedule}: {formatTaskSchedule(props.task, props.labels)}
          </span>
          <span>
            {props.labels.nextRun}: {formatDateTime(props.task.nextRunAt)}
          </span>
          <span>
            {props.labels.frequency}: {props.task.recurring ? props.labels.recurring : props.labels.oneTime}
          </span>
        </div>
        <span className="cron-task-card__owner">
          {props.labels.createdBy}: {taskOwner(props.task)}
        </span>
      </div>
    </article>
  );
}

function ExecutionRecords(props: {
  readonly executions: readonly CronTaskExecutionView[];
  readonly executionsLoading: boolean;
  readonly executionsError: string;
  readonly onRetry: () => void;
  readonly labels: {
    readonly retry: string;
    readonly loadingExecutions: string;
    readonly noExecutions: string;
    readonly timeline: string;
    readonly today: string;
    readonly runCount: (count: number) => string;
    readonly details: string;
    readonly triggerStatus: string;
    readonly runStatus: string;
    readonly commitState: string;
  };
}) {
  const [expandedTriggerId, setExpandedTriggerId] = useState<string | null>(null);
  const sortedExecutions = useMemo(
    () => [...props.executions].sort((left, right) => new Date(right.scheduledAt).getTime() - new Date(left.scheduledAt).getTime()),
    [props.executions],
  );
  const todayDate = dayjs().startOf('day').format('YYYY-MM-DD');
  const executionGroups = useMemo(() => {
    const byDate = new Map<string, { readonly executions: CronTaskExecutionView[]; readonly count: number }>();
    const dates: string[] = [];
    for (const execution of sortedExecutions) {
      const date = formatDate(execution.scheduledAt);
      const existing = byDate.get(date);
      if (existing) {
        byDate.set(date, { executions: [...existing.executions, execution], count: existing.count + 1 });
      } else {
        dates.push(date);
        byDate.set(date, { executions: [execution], count: 1 });
      }
    }
    return dates.map((date) => ({ date, executions: byDate.get(date)?.executions ?? [], count: byDate.get(date)?.count ?? 0 }));
  }, [sortedExecutions]);
  const timelineNodes = useMemo(() => {
    const seenDates = new Set<string>();
    const countByDate = new Map(executionGroups.map((group) => [group.date, group.count]));
    return sortedExecutions.map((execution) => {
      const date = formatDate(execution.scheduledAt);
      const isFirst = !seenDates.has(date);
      seenDates.add(date);
      return {
        id: execution.triggerId,
        date,
        label: isFirst ? (date === todayDate ? props.labels.today : date) : '',
        count: isFirst ? (countByDate.get(date) ?? 0) : 0,
        status: execution.runStatus,
      };
    });
  }, [executionGroups, props.labels.today, sortedExecutions, todayDate]);

  useLayoutEffect(() => {
    const executionsNode = document.querySelector('.cron-executions');
    if (!(executionsNode instanceof HTMLElement)) {
      return;
    }
    const desktopLayout = typeof window.matchMedia === 'function' && window.matchMedia('(min-width: 761px)').matches;
    if (desktopLayout) {
      const firstCard = executionsNode.querySelector<HTMLElement>('.cron-execution');
      const firstTimelineItem = document.querySelector<HTMLElement>('.cron-execution-timeline__item');
      if (firstCard && firstTimelineItem) {
        const offset = firstTimelineItem.getBoundingClientRect().top - firstCard.getBoundingClientRect().top;
        executionsNode.style.paddingTop = `${Math.max(0, offset)}px`;
      }
    } else {
      executionsNode.style.paddingTop = '';
    }
    executionsNode.querySelectorAll<HTMLElement>('.cron-execution[data-execution-id]').forEach((card) => {
      const executionId = card.dataset.executionId;
      const timelineItem = executionId
        ? document.querySelector<HTMLElement>(`.cron-execution-timeline__item[data-execution-id="${executionId}"]`)
        : null;
      if (timelineItem) {
        timelineItem.style.minHeight = '0px';
        timelineItem.style.minHeight = `${card.offsetHeight}px`;
      }
    });
  }, [executionGroups, expandedTriggerId]);
  return (
    <>
      {props.executionsLoading ? <EmptyState text={props.labels.loadingExecutions} compact /> : null}
      {props.executionsError ? (
        <EmptyState text={props.executionsError} compact>
          <button type="button" className="cron-btn" onClick={props.onRetry}>
            {props.labels.retry}
          </button>
        </EmptyState>
      ) : null}
      {!props.executionsLoading && !props.executionsError && props.executions.length === 0 ? (
        <EmptyState text={props.labels.noExecutions} compact />
      ) : null}
      {props.executions.length > 0 ? (
        <div className="cron-execution-layout">
          <ExecutionTimeline nodes={timelineNodes} labels={{ title: props.labels.timeline, runCount: props.labels.runCount }} />
          <div className="cron-executions">
            {executionGroups.map((group) => (
              <div key={group.date} className="cron-execution-group" data-date={group.date}>
                {group.executions.map((execution) => (
                  <div
                    key={execution.triggerId}
                    className="cron-execution"
                    data-testid={`cron-execution-${execution.triggerId}`}
                    data-execution-id={execution.triggerId}
                  >
                    <div className="cron-execution__summary">
                      <div className="cron-execution__head">
                        <strong>{execution.taskId}</strong>
                        <span>{formatDateTime(execution.scheduledAt)}</span>
                      </div>
                      <p className="cron-execution__content">{executionResultSummary(execution)}</p>
                      <Button onClick={() => setExpandedTriggerId((current) => (current === execution.triggerId ? null : execution.triggerId))}>
                        {props.labels.details}
                      </Button>
                    </div>
                    {expandedTriggerId === execution.triggerId ? (
                      <div className="cron-execution__detail">
                        <div className="cron-execution__meta">
                          <span>
                            {props.labels.triggerStatus}: {execution.triggerStatus}
                          </span>
                          {execution.runStatus ? (
                            <span>
                              {props.labels.runStatus}: {execution.runStatus}
                            </span>
                          ) : null}
                          {execution.terminalCommitState ? (
                            <span>
                              {props.labels.commitState}: {execution.terminalCommitState}
                            </span>
                          ) : null}
                          {execution.sessionId ? <span>sessionId: {execution.sessionId}</span> : null}
                          {execution.requestRunId ? <span>runId: {execution.requestRunId}</span> : null}
                        </div>
                        {execution.resultContent ? <pre className="cron-result">{execution.resultContent}</pre> : null}
                      </div>
                    ) : null}
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </>
  );
}

function timelineDotStatusClass(status: string | undefined): string {
  switch (status) {
    case 'COMPLETED':
      return ' cron-execution-timeline__dot--completed';
    case 'FAILED':
      return ' cron-execution-timeline__dot--failed';
    case 'SUPERSEDED':
      return ' cron-execution-timeline__dot--superseded';
    case 'CANCELED':
      return ' cron-execution-timeline__dot--canceled';
    default:
      return '';
  }
}

function ExecutionTimeline(props: {
  readonly nodes: readonly ExecutionTimelineNode[];
  readonly labels: {
    readonly title: string;
    readonly runCount: (count: number) => string;
  };
}) {
  return (
    <aside className="cron-execution-timeline" aria-label={props.labels.title}>
      <div className="cron-execution-timeline__items">
        {props.nodes.map((node) => (
          <div key={node.id} className="cron-execution-timeline__item" data-date={node.date} data-execution-id={node.id}>
            <span className={`cron-execution-timeline__dot${timelineDotStatusClass(node.status)}`} aria-hidden="true" />
            <div>
              {node.label ? <time dateTime={node.date}>{node.label}</time> : null}
              {node.count > 0 ? <span>{props.labels.runCount(node.count)}</span> : null}
            </div>
          </div>
        ))}
      </div>
    </aside>
  );
}

function EmptyState(props: { readonly text: string; readonly compact?: boolean; readonly children?: ReactNode }) {
  return (
    <div className={`cron-empty ${props.compact ? 'compact' : ''}`}>
      <span>{props.text}</span>
      {props.children}
    </div>
  );
}

function taskTitle(task: CronTaskView): string {
  return task.taskId;
}

function taskOwner(task: CronTaskView): string {
  return task.createdByName?.trim() || task.createdBy?.trim() || '-';
}

function taskTargetLabel(target: CronTaskTarget): string {
  return `${target.kind === 'SKILL' ? 'Skill' : 'Workflow'}: ${target.name}`;
}

function buildDraftTarget(draft: Draft): CronTaskTarget | undefined | false {
  if (draft.targetMode === 'NONE') {
    return undefined;
  }
  const name = draft.targetName.trim();
  if (!name) {
    return false;
  }
  return { kind: draft.targetMode, name };
}

function formatTaskSchedule(task: CronTaskView, labels: CronScheduleLabels): string {
  return summarizeCronExpression(task.cron, labels) ?? labels.customSchedule();
}

interface CronScheduleLabels {
  readonly everyMinutes: (minutes: number) => string;
  readonly everyHourAtMinute: (minute: string) => string;
  readonly everyDayAt: (time: string) => string;
  readonly everyHours: (hours: number) => string;
  readonly everyHoursAtMinute: (hours: number, minute: string) => string;
  readonly everyWeekdayAt: (weekday: string, time: string) => string;
  readonly weekdaysAt: (time: string) => string;
  readonly weekendAt: (time: string) => string;
  readonly dailyAtMultiple: (times: string) => string;
  readonly multiWeekdaysAt: (weekdays: string, time: string) => string;
  readonly monthlyOnDayAt: (day: number, time: string) => string;
  readonly monthlyOnDaysAt: (days: string, time: string) => string;
  readonly customSchedule: () => string;
  readonly weekdayName: (index: number) => string;
}

const WEEKDAY_LABELS_ZH = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
const WEEKDAY_LABELS_EN = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function summarizeCronExpression(cron: string, labels: CronScheduleLabels): string | null {
  const fields = cron.trim().split(/\s+/);
  if (fields.length !== 5) {
    return null;
  }
  const [minute, hour, dayOfMonth, month, dayOfWeek] = fields as [string, string, string, string, string];
  if (minute === undefined || hour === undefined || dayOfMonth === undefined || month === undefined || dayOfWeek === undefined) {
    return null;
  }

  const unrestrictedDate = dayOfMonth === '*' && month === '*';
  const padTime = (h: number, m: number) => `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;

  // Every N minutes: */N * * * *
  if (hour === '*' && unrestrictedDate && dayOfWeek === '*') {
    const interval = minuteInterval(minute);
    if (interval !== null) {
      return labels.everyMinutes(interval);
    }
    // Every hour at minute M: M * * * *
    if (/^\d+$/.test(minute)) {
      return labels.everyHourAtMinute(String(Number(minute)).padStart(2, '0'));
    }
  }

  // Every N hours: */N */H * * *  or  M */H * * *
  if (unrestrictedDate && dayOfWeek === '*') {
    const hourInterval = hourStepInterval(hour);
    if (hourInterval !== null) {
      const fixedMinute = readMinute(minute);
      if (fixedMinute !== null && fixedMinute !== 0) {
        return labels.everyHoursAtMinute(hourInterval, String(fixedMinute).padStart(2, '0'));
      }
      return labels.everyHours(hourInterval);
    }
  }

  // Fixed minute + fixed hour patterns
  const fixedMinute = readMinute(minute);
  const fixedHour = readDecimal(hour);
  if (fixedMinute !== null && fixedHour !== null) {
    const time = padTime(fixedHour, fixedMinute);

    // Every day at HH:MM: M H * * *
    if (unrestrictedDate && dayOfWeek === '*') {
      return labels.everyDayAt(time);
    }

    // Every weekday at HH:MM: M H * * 1-5
    if (dayOfMonth === '*' && month === '*' && dayOfWeek === '1-5') {
      return labels.weekdaysAt(time);
    }

    // Every specific weekday at HH:MM: M H * * D
    if (dayOfMonth === '*' && month === '*' && /^\d$/.test(dayOfWeek)) {
      const dayIdx = Number.parseInt(dayOfWeek, 10) % 7;
      const weekdayName = labels.weekdayName(dayIdx);
      if (weekdayName) {
        return labels.everyWeekdayAt(weekdayName, time);
      }
    }
  }

  // Multiple hours per day: M H1,H2,... * * *
  const multiHourMinute = readMinute(minute);
  const hourList = parseNumberList(hour, 0, 23);
  if (multiHourMinute !== null && hourList !== null && hourList.length >= 2 && unrestrictedDate && dayOfWeek === '*') {
    const times = hourList.map((h) => padTime(h, multiHourMinute)).join(', ');
    return labels.dailyAtMultiple(times);
  }

  // Multiple weekdays: M H * * D1,D2,...
  const multiDowMinute = readMinute(minute);
  const multiDowHour = readDecimal(hour);
  if (multiDowMinute !== null && multiDowHour !== null && dayOfMonth === '*' && month === '*') {
    const dowList = parseNumberList(dayOfWeek, 0, 6);
    if (dowList !== null && dowList.length >= 2) {
      const time = padTime(multiDowHour, multiDowMinute);
      if (dowList.length === 2 && dowList.includes(0) && dowList.includes(6)) {
        return labels.weekendAt(time);
      }
      const weekdayLabels = dowList.map((d) => labels.weekdayName(d)).join(', ');
      return labels.multiWeekdaysAt(weekdayLabels, time);
    }
  }

  // Monthly on specific day(s): M H D * *
  const monthlyMinute = readMinute(minute);
  const monthlyHour = readDecimal(hour);
  if (monthlyMinute !== null && monthlyHour !== null && month === '*' && dayOfWeek === '*') {
    const domList = parseNumberList(dayOfMonth, 1, 31);
    if (domList !== null && domList.length >= 1) {
      const time = padTime(monthlyHour, monthlyMinute);
      if (domList.length === 1) {
        return labels.monthlyOnDayAt(domList[0]!, time);
      }
      return labels.monthlyOnDaysAt(domList.join(', '), time);
    }
  }

  return null;
}

function readMinute(value: string): number | null {
  if (!/^\d+$/.test(value)) {
    return null;
  }
  const n = Number(value);
  return n >= 0 && n <= 59 ? n : null;
}

function readDecimal(value: string): number | null {
  return /^\d+$/.test(value) ? Number(value) : null;
}

function parseNumberList(value: string, min: number, max: number): number[] | null {
  if (!/^\d+(,\d+)*$/.test(value)) {
    return null;
  }
  const numbers = value.split(',').map(Number);
  if (numbers.some((n) => !Number.isInteger(n) || n < min || n > max)) {
    return null;
  }
  return numbers;
}

function hourStepInterval(value: string): number | null {
  const match = /^\*\/(\d+)$/.exec(value);
  if (match === null) {
    return null;
  }
  const interval = Number(match[1]);
  return interval > 0 && interval <= 23 ? interval : null;
}

function minuteInterval(field: string): number | null {
  const stepMatch = /^(?:\*|0)\/(\d+)$/.exec(field);
  if (stepMatch !== null) {
    const interval = Number(stepMatch[1]);
    return interval > 1 && interval <= 59 ? interval : null;
  }
  const minutes = field.split(',').map((item) => Number(item));
  if (minutes.length < 2 || minutes.some((minute) => !Number.isInteger(minute) || minute < 0 || minute > 59)) {
    return null;
  }
  const sorted = [...minutes].sort((left, right) => left - right);
  const interval = sorted[1]! - sorted[0]!;
  if (interval <= 1 || sorted.some((minute, index) => index > 0 && minute - sorted[index - 1]! !== interval)) {
    return null;
  }
  return sorted[sorted.length - 1]! + interval >= 60 ? interval : null;
}

function executionResultSummary(execution: CronTaskExecutionView): string {
  if (execution.resultContent) {
    return execution.resultContent.length > 80 ? `${execution.resultContent.slice(0, 80)}...` : execution.resultContent;
  }
  return execution.runStatus ?? execution.triggerStatus;
}

function executionStatusValue(execution: CronTaskExecutionView): string {
  return execution.runStatus?.trim() || NOT_RUNNING_TASK_STATUS;
}

function normalizeExecutionFilter(filter: ExecutionFilter): ExecutionFilter {
  return {
    taskName: filter.taskName.trim(),
    taskStatus: filter.taskStatus.trim(),
    startDate: filter.startDate,
    endDate: filter.endDate,
  };
}

function filterExecutions(
  executions: readonly CronTaskExecutionView[],
  selectedTask: CronTaskView | null,
  filter: ExecutionFilter,
): readonly CronTaskExecutionView[] {
  const normalizedTaskName = filter.taskName.trim().toLowerCase();
  if (normalizedTaskName && (!selectedTask || !taskTitle(selectedTask).toLowerCase().includes(normalizedTaskName))) {
    return [];
  }
  const start = parseDateBoundary(filter.startDate, false);
  const end = parseDateBoundary(filter.endDate, true);
  return executions.filter((execution) => {
    if (filter.taskStatus && executionStatusValue(execution) !== filter.taskStatus) {
      return false;
    }
    const scheduledAt = new Date(execution.scheduledAt).getTime();
    if (Number.isNaN(scheduledAt)) {
      return true;
    }
    if (start !== null && scheduledAt < start) {
      return false;
    }
    if (end !== null && scheduledAt > end) {
      return false;
    }
    return true;
  });
}

function parseDateBoundary(value: string, endOfDay: boolean): number | null {
  if (!value) {
    return null;
  }
  const suffix = endOfDay ? 'T23:59:59.999' : 'T00:00:00.000';
  const date = new Date(`${value}${suffix}`);
  return Number.isNaN(date.getTime()) ? null : date.getTime();
}

const cronErrorCodeI18nMap: Readonly<Record<string, string>> = {
  CRON_INVALID_EXPRESSION: 'cronTasks.errors.cronInvalid',
  CRON_NO_FUTURE_MATCH: 'cronTasks.errors.cronNoFutureMatch',
  CRON_TASK_LIMIT_REACHED: 'cronTasks.errors.taskLimitReached',
  CRON_TASK_NOT_FOUND: 'cronTasks.errors.taskNotFound',
  CRON_TASK_NOT_ACTIVE: 'cronTasks.errors.taskNotActive',
  CRON_TASK_UPDATE_CONFLICT: 'cronTasks.errors.taskUpdateConflict',
  CRON_TASK_EXECUTION_UNAVAILABLE: 'cronTasks.errors.taskExecutionUnavailable',
  CRON_TASK_EXECUTION_CONFLICT: 'cronTasks.errors.taskExecutionConflict',
  CRON_TASK_GATEWAY_UNAVAILABLE: 'cronTasks.errors.taskGatewayUnavailable',
  CRON_TASKS_UNAVAILABLE: 'cronTasks.errors.tasksUnavailable',
  CRON_TASK_TARGET_INVALID: 'cronTasks.errors.taskTargetInvalid',
  CRON_TASK_TARGET_PROMPT_CONFLICT: 'cronTasks.errors.taskTargetPromptConflict',
  CRON_PROMPT_TOO_LONG: 'cronTasks.errors.promptTooLong',
};

function resolveCronErrorByCode(error: unknown, fallback: string, t: TFunction): string {
  if (isApiError(error) && error.code) {
    const i18nKey = cronErrorCodeI18nMap[error.code];
    if (i18nKey) {
      return t(i18nKey);
    }
    return error.error || fallback;
  }
  if (error instanceof Error) {
    return error.message || fallback;
  }
  return fallback;
}

function errorMessage(_error: unknown, fallback: string, _t: TFunction): string {
  return fallback;
}

function resolveCronFormError(error: unknown, fallback: string, t: TFunction): string {
  return resolveCronErrorByCode(error, fallback, t);
}

function formatDateTime(value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === '') {
    return '-';
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return String(value);
  }
  const p = (num: number) => String(num).padStart(2, '0');
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())} ${p(date.getHours())}:${p(date.getMinutes())}`;
}

function formatDate(value: string | number | null | undefined): string {
  const dateTime = formatDateTime(value);
  return dateTime.includes(' ') ? dateTime.split(' ')[0]! : dateTime;
}
