import { useCallback, useEffect, useRef, useState } from 'react';
import { Badge, Button, Empty, Popconfirm, Popover, Spin, Tag, Tooltip } from 'antd';
import {
  CaretDownOutlined,
  CaretRightOutlined,
  CheckCircleFilled,
  CloseCircleFilled,
  LoadingOutlined,
  ReloadOutlined,
  StopOutlined,
  ThunderboltFilled,
} from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import { backgroundTaskService } from '../../../services/backgroundTaskService.ts';
import { useBackgroundTaskStore } from '../../../state/backgroundTaskStore.ts';
import type { BackgroundTaskStatus, BackgroundTaskView } from '../../../state/contracts.ts';

const OUTPUT_LIMIT_BYTES = 65_536;
const EMPTY_BACKGROUND_TASKS: readonly BackgroundTaskView[] = [];
export interface BackgroundTaskHeaderMonitorProps {
  readonly sessionId: string;
}

interface TaskOutput {
  readonly stdout?: string;
  readonly stderr?: string;
  readonly stdoutTruncated?: boolean;
  readonly stderrTruncated?: boolean;
  readonly error?: boolean;
}

function statusColor(status: BackgroundTaskStatus): string {
  switch (status) {
    case 'RUNNING':
      return 'processing';
    case 'COMPLETED':
      return 'success';
    case 'FAILED':
      return 'error';
    case 'KILLED':
      return 'default';
    default: {
      const exhaustive: never = status;
      throw new Error(`Unhandled case: ${String(exhaustive)}`);
    }
  }
}

function statusIcon(status: BackgroundTaskStatus, isDark: boolean) {
  const color = isDark ? 'rgba(201,201,201,1)' : '#777777';
  if (status === 'RUNNING') {
    return <LoadingOutlined style={{ color: 'var(--color-primary, #1677ff)' }} />;
  }
  if (status === 'COMPLETED') {
    return <CheckCircleFilled style={{ color: 'var(--color-success, #12b76a)' }} />;
  }
  return <CloseCircleFilled style={{ color: status === 'KILLED' ? color : 'var(--color-error, #f04438)' }} />;
}

function formatElapsed(startedAt: number, finishedAt?: number): string {
  const end = finishedAt ?? Date.now();
  const seconds = Math.max(0, Math.round((end - startedAt) / 1000));
  if (seconds < 60) {
    return `${seconds}s`;
  }
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return `${minutes}m${remainder}s`;
}

function useIsDarkTheme(): boolean {
  const [isDark, setIsDark] = useState(() => {
    if (typeof document === 'undefined') {
      return false;
    }
    const theme = document.documentElement.getAttribute('data-theme');
    return theme === 'dark' || theme === 'evening';
  });
  useEffect(() => {
    if (typeof document === 'undefined' || typeof MutationObserver === 'undefined') {
      return undefined;
    }
    const observer = new MutationObserver(() => {
      const theme = document.documentElement.getAttribute('data-theme');
      setIsDark(theme === 'dark' || theme === 'evening');
    });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => observer.disconnect();
  }, []);
  return isDark;
}

/**
 * Header affordance for background tasks: a compact badge (thunderbolt icon +
 * running count) placed in the chat pane header `headerExtra`. Clicking toggles
 * an inline dropdown panel listing the session's background tasks with live
 * status, stdout/stderr output viewing, and SIGTERM kill for RUNNING tasks.
 * Renders nothing when the session has no background tasks. NOT mounted in the
 * message stream — lives in the header.
 */
export function BackgroundTaskHeaderMonitor({ sessionId }: BackgroundTaskHeaderMonitorProps) {
  const { t } = useTranslation();
  const isDark = useIsDarkTheme();
  const [open, setOpen] = useState(false);
  const tasks = useBackgroundTaskStore((state) =>
    sessionId.length === 0 ? EMPTY_BACKGROUND_TASKS : (state.tasksBySession[sessionId] ?? EMPTY_BACKGROUND_TASKS),
  );
  const seedTasks = useBackgroundTaskStore((state) => state.seedTasks);
  const markTaskKilled = useBackgroundTaskStore((state) => state.markTaskKilled);
  const clearStoreTasks = useBackgroundTaskStore((state) => state.clearTasks);

  // One-time seed fetch when the session changes: recovers tasks that started
  // before the stream connected (e.g. page refresh) and supplies `commandLine`,
  // which stream events don't carry. This is NOT polling — one request per
  // session mount.
  useEffect(() => {
    if (sessionId.length === 0) {
      return undefined;
    }
    let cancelled = false;
    void backgroundTaskService
      .listTasks(sessionId)
      .then((result) => {
        if (!cancelled) {
          seedTasks(sessionId, result);
        }
      })
      .catch(() => {
        // Swallow transient errors — stream events still drive live updates.
      });
    return () => {
      cancelled = true;
      clearStoreTasks(sessionId);
    };
  }, [sessionId, seedTasks, clearStoreTasks]);

  // Kill emits no stream event (the backend only `markKilled`), so apply an
  // optimistic local override immediately on a successful kill request.
  const handleTaskKilled = useCallback(
    (taskId: string) => {
      markTaskKilled(sessionId, taskId, Date.now());
    },
    [sessionId, markTaskKilled],
  );

  // Close the dropdown on Escape.
  useEffect(() => {
    if (!open) {
      return undefined;
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  if (sessionId.length === 0 || tasks.length === 0) {
    return null;
  }

  const runningCount = tasks.filter((task) => task.status === 'RUNNING').length;
  const sortedTasks = [...tasks].sort((a, b) => b.startedAt - a.startedAt);

  return (
    <Popover
      trigger="click"
      placement="bottomRight"
      open={open}
      onOpenChange={setOpen}
      arrow={false}
      content={
        <div
          data-testid="background-task-monitor-panel"
          style={{
            width: 'min(440px, calc(100vw - 32px))',
            maxHeight: 'min(520px, calc(100vh - 80px))',
            overflow: 'auto',
          }}
        >
          <BackgroundTaskList sessionId={sessionId} tasks={sortedTasks} isDark={isDark} onKilled={handleTaskKilled} />
        </div>
      }
    >
      <Tooltip title={t('backgroundTasks.title')}>
        <Badge count={runningCount} size="small" offset={[-2, 2]}>
          <Button
            data-testid="background-task-badge"
            size="small"
            type="text"
            icon={<ThunderboltFilled style={{ color: open ? 'var(--color-primary, #1677ff)' : 'var(--color-text-secondary, #475467)' }} />}
            aria-label={t('backgroundTasks.title')}
            aria-expanded={open}
            style={{ padding: '0 4px' }}
          />
        </Badge>
      </Tooltip>
    </Popover>
  );
}

interface BackgroundTaskListProps {
  readonly sessionId: string;
  readonly tasks: readonly BackgroundTaskView[];
  readonly isDark: boolean;
  readonly onKilled: (taskId: string) => void;
}

function BackgroundTaskList({ sessionId, tasks, isDark, onKilled }: BackgroundTaskListProps) {
  const { t } = useTranslation();
  const [expandedTaskIds, setExpandedTaskIds] = useState<ReadonlySet<string>>(() => new Set());
  const [outputs, setOutputs] = useState<ReadonlyMap<string, TaskOutput>>(() => new Map());
  const [outputLoadingTaskIds, setOutputLoadingTaskIds] = useState<ReadonlySet<string>>(() => new Set());
  const [killingTaskId, setKillingTaskId] = useState<string | null>(null);
  const [killErrorTaskId, setKillErrorTaskId] = useState<string | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const loadOutput = useCallback(
    async (taskId: string) => {
      setOutputLoadingTaskIds((current) => new Set(current).add(taskId));
      try {
        const [stdout, stderr] = await Promise.all([
          backgroundTaskService.readOutput(sessionId, taskId, 'stdout', OUTPUT_LIMIT_BYTES),
          backgroundTaskService.readOutput(sessionId, taskId, 'stderr', OUTPUT_LIMIT_BYTES),
        ]);
        if (!mountedRef.current) {
          return;
        }
        setOutputs((current) => {
          const next = new Map(current);
          next.set(taskId, {
            stdout: stdout.content,
            stderr: stderr.content,
            stdoutTruncated: stdout.truncated,
            stderrTruncated: stderr.truncated,
          });
          return next;
        });
      } catch {
        if (!mountedRef.current) {
          return;
        }
        setOutputs((current) => {
          const next = new Map(current);
          next.set(taskId, { error: true });
          return next;
        });
      } finally {
        if (mountedRef.current) {
          setOutputLoadingTaskIds((current) => {
            const next = new Set(current);
            next.delete(taskId);
            return next;
          });
        }
      }
    },
    [sessionId],
  );

  const handleExpand = useCallback(
    (taskId: string) => {
      setExpandedTaskIds((current) => {
        const next = new Set(current);
        if (next.has(taskId)) {
          next.delete(taskId);
        } else {
          next.add(taskId);
        }
        return next;
      });
      setOutputs((current) => {
        if (current.has(taskId)) {
          return current;
        }
        void loadOutput(taskId);
        return current;
      });
    },
    [loadOutput],
  );

  const handleKill = useCallback(
    async (taskId: string) => {
      setKillingTaskId(taskId);
      setKillErrorTaskId(null);
      try {
        await backgroundTaskService.killTask(sessionId, taskId);
        if (!mountedRef.current) {
          return;
        }
        onKilled(taskId);
        void loadOutput(taskId);
      } catch {
        if (mountedRef.current) {
          setKillErrorTaskId(taskId);
        }
      } finally {
        if (mountedRef.current) {
          setKillingTaskId(null);
        }
      }
    },
    [sessionId, onKilled, loadOutput],
  );

  if (tasks.length === 0) {
    return (
      <div style={{ padding: 16 }}>
        <Empty description={t('backgroundTasks.empty')} image={Empty.PRESENTED_IMAGE_SIMPLE} />
      </div>
    );
  }

  return (
    <div style={{ padding: 8, display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          padding: '4px 4px 8px',
          borderBottom: '1px solid var(--color-border, rgba(0,0,0,0.04))',
        }}
      >
        <ThunderboltFilled style={{ color: 'var(--color-primary, #1677ff)', fontSize: 14 }} />
        <span style={{ fontWeight: 600, fontSize: 13, color: 'var(--color-text-primary, #101828)' }}>{t('backgroundTasks.title')}</span>
      </div>
      {tasks.map((task) => {
        const isTaskExpanded = expandedTaskIds.has(task.taskId);
        const output = outputs.get(task.taskId);
        const isLoadingOutput = outputLoadingTaskIds.has(task.taskId);
        const isKilling = killingTaskId === task.taskId;
        const hasKillError = killErrorTaskId === task.taskId;
        return (
          <div
            key={task.taskId}
            data-testid="background-task-row"
            style={{
              borderRadius: 8,
              border: '1px solid var(--color-border, rgba(0,0,0,0.06))',
              background: 'var(--color-bg-secondary, rgba(250,250,252,1))',
              overflow: 'hidden',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px' }}>
              <button
                data-testid="background-task-row-toggle"
                onClick={() => handleExpand(task.taskId)}
                aria-expanded={isTaskExpanded}
                style={{
                  border: 'none',
                  background: 'transparent',
                  cursor: 'pointer',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                  padding: 0,
                  color: 'var(--color-text-primary, #101828)',
                  fontFamily: 'var(--font-mono, monospace)',
                  fontSize: 13,
                  minWidth: 0,
                  flex: 1,
                  textAlign: 'left',
                }}
              >
                {isTaskExpanded ? <CaretDownOutlined style={{ fontSize: 10 }} /> : <CaretRightOutlined style={{ fontSize: 10 }} />}
                {statusIcon(task.status, isDark)}
                <span style={{ minWidth: 0, display: 'flex', flexDirection: 'column' }}>
                  <span style={{ overflowWrap: 'anywhere', wordBreak: 'break-word' }}>{task.commandName || task.taskId}</span>
                  {task.commandLine ? (
                    <span
                      data-testid="background-task-command-line"
                      style={{
                        fontSize: 11,
                        color: 'var(--color-text-tertiary, #98a2b3)',
                        fontFamily: 'var(--font-mono, monospace)',
                        overflowWrap: 'anywhere',
                        wordBreak: 'break-word',
                      }}
                    >
                      {task.commandLine}
                    </span>
                  ) : null}
                </span>
              </button>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
                <Tag color={statusColor(task.status)}>{t(`backgroundTasks.status${task.status.charAt(0)}${task.status.slice(1).toLowerCase()}`)}</Tag>
                {task.exitCode !== undefined ? (
                  <span style={{ fontSize: 12, color: 'var(--color-text-secondary, #475467)' }}>
                    {t('backgroundTasks.exitCode')} {task.exitCode}
                  </span>
                ) : null}
                <span style={{ fontSize: 12, color: 'var(--color-text-tertiary, #98a2b3)' }}>{formatElapsed(task.startedAt, task.finishedAt)}</span>
                {task.status === 'RUNNING' ? (
                  <Popconfirm
                    title={t('backgroundTasks.kill')}
                    description={t('backgroundTasks.killConfirm')}
                    onConfirm={() => void handleKill(task.taskId)}
                    okText={t('backgroundTasks.kill')}
                    cancelText={t('common.cancel')}
                    disabled={isKilling}
                  >
                    <Tooltip title={hasKillError ? t('backgroundTasks.killFailed') : t('backgroundTasks.kill')}>
                      <Button
                        data-testid="background-task-kill-button"
                        size="small"
                        danger
                        type="text"
                        icon={isKilling ? <LoadingOutlined /> : <StopOutlined />}
                        loading={isKilling}
                      />
                    </Tooltip>
                  </Popconfirm>
                ) : null}
              </div>
            </div>

            {isTaskExpanded ? (
              <div style={{ padding: '0 10px 10px', borderTop: '1px solid var(--color-border, rgba(0,0,0,0.04))' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingTop: 8 }}>
                  <span style={{ fontSize: 12, color: 'var(--color-text-secondary, #475467)' }}>{t('backgroundTasks.outputLabel')}</span>
                  <Button
                    data-testid="background-task-output-refresh"
                    size="small"
                    type="text"
                    icon={<ReloadOutlined />}
                    loading={isLoadingOutput}
                    onClick={() => void loadOutput(task.taskId)}
                  >
                    {t('backgroundTasks.refresh')}
                  </Button>
                </div>
                {isLoadingOutput && output === undefined ? (
                  <div style={{ padding: 12, textAlign: 'center' }}>
                    <Spin size="small" />
                  </div>
                ) : output?.error ? (
                  <div style={{ fontSize: 12, color: 'var(--color-error, #f04438)', padding: '8px 0' }}>{t('backgroundTasks.outputLoadFailed')}</div>
                ) : (
                  <OutputBlock
                    label={t('backgroundTasks.stdout')}
                    content={output?.stdout}
                    truncated={output?.stdoutTruncated}
                    emptyText={t('backgroundTasks.outputEmpty')}
                  />
                )}
                {!output?.error ? (
                  <OutputBlock
                    label={t('backgroundTasks.stderr')}
                    content={output?.stderr}
                    truncated={output?.stderrTruncated}
                    emptyText={t('backgroundTasks.outputEmpty')}
                  />
                ) : null}
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

function OutputBlock({
  label,
  content,
  truncated,
  emptyText,
}: {
  readonly label: string;
  readonly content: string | undefined;
  readonly truncated: boolean | undefined;
  readonly emptyText: string;
}) {
  return (
    <div style={{ marginTop: 6 }}>
      <div style={{ fontSize: 11, color: 'var(--color-text-tertiary, #98a2b3)', marginBottom: 2 }}>{label}</div>
      <pre
        data-testid="background-task-output-content"
        style={{
          margin: 0,
          padding: 8,
          maxHeight: 200,
          overflow: 'auto',
          background: 'var(--color-bg-tertiary, rgba(245,245,247,1))',
          borderRadius: 6,
          fontSize: 12,
          lineHeight: 1.5,
          fontFamily: 'var(--font-mono, monospace)',
          color: 'var(--color-text-primary, #101828)',
          whiteSpace: 'pre-wrap',
          overflowWrap: 'anywhere',
          wordBreak: 'break-word',
        }}
      >
        {content && content.length > 0 ? content : emptyText}
      </pre>
      {truncated ? <div style={{ fontSize: 11, color: 'var(--color-text-tertiary, #98a2b3)', marginTop: 2 }}>…</div> : null}
    </div>
  );
}
