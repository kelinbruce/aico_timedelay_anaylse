// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BackgroundTaskHeaderMonitor } from '../src/features/background-tasks/components/BackgroundTaskMonitorPanel.tsx';
import { useBackgroundTaskStore } from '../src/state/backgroundTaskStore.ts';
import type { BackgroundTaskOutputResponse, BackgroundTaskView, StreamEnvelope } from '../src/state/contracts.ts';

const listTasks = vi.fn<(...args: readonly unknown[]) => Promise<readonly BackgroundTaskView[]>>();
const readOutput = vi.fn<(...args: readonly unknown[]) => Promise<BackgroundTaskOutputResponse>>();
const killTask = vi.fn<(...args: readonly unknown[]) => Promise<{ status: string }>>();

vi.mock('../src/services/backgroundTaskService.ts', () => ({
  backgroundTaskService: {
    listTasks: (...args: readonly unknown[]) => listTasks(...args),
    readOutput: (...args: readonly unknown[]) => readOutput(...args),
    killTask: (...args: readonly unknown[]) => killTask(...args),
  },
}));

afterEach(cleanup);

beforeEach(() => {
  vi.clearAllMocks();
  useBackgroundTaskStore.setState({ tasksBySession: {} });
});

function task(overrides: Partial<BackgroundTaskView> = {}): BackgroundTaskView {
  return {
    taskId: 'task-1',
    commandName: 'npm',
    status: 'RUNNING',
    startedAt: 1000,
    stdoutRef: 'tool-results/task-1.stdout.txt',
    stderrRef: 'tool-results/task-1.stderr.txt',
    ...overrides,
  };
}

function backgroundTaskEnvelope(
  sessionId: string,
  sequence: number,
  eventType: 'BACKGROUND_TASK_STARTED' | 'BACKGROUND_TASK_COMPLETED' | 'BACKGROUND_TASK_FAILED',
  payload: Record<string, unknown>,
): StreamEnvelope {
  return {
    eventId: `evt-${sessionId}-${sequence}`,
    sessionId,
    requestId: 'req-1',
    runId: 'run-1',
    rootMessageId: 'root-1',
    requestContextId: 'ctx-1',
    sequence,
    eventType,
    timelineEventRef: null,
    transportHints: [],
    payload,
    createdAt: sequence * 1000,
  } as StreamEnvelope;
}

describe('BackgroundTaskHeaderMonitor', () => {
  it('renders no badge when the session has no background tasks', async () => {
    listTasks.mockResolvedValue([]);
    const { container } = render(<BackgroundTaskHeaderMonitor sessionId="session-1" />);
    await waitFor(() => expect(listTasks).toHaveBeenCalled());
    expect(container.firstChild).toBeNull();
    expect(screen.queryByTestId('background-task-badge')).toBeNull();
  });

  it('shows the badge and, on click, lists running and completed tasks with kill only on RUNNING', async () => {
    listTasks.mockResolvedValue([
      task({ taskId: 'task-running', commandName: 'npm', status: 'RUNNING', startedAt: 2000 }),
      task({ taskId: 'task-done', commandName: 'git', status: 'COMPLETED', startedAt: 1000, exitCode: 0, finishedAt: 1500 }),
    ]);
    render(<BackgroundTaskHeaderMonitor sessionId="session-1" />);

    const badge = await screen.findByTestId('background-task-badge');
    fireEvent.click(badge);

    expect(await screen.findByText('npm')).toBeDefined();
    expect(screen.getByText('git')).toBeDefined();
    // Kill button present on RUNNING row only.
    expect(screen.queryAllByTestId('background-task-kill-button')).toHaveLength(1);
  });

  it('loads output on row expand', async () => {
    listTasks.mockResolvedValue([task({ taskId: 'task-1' })]);
    readOutput.mockImplementation(async (...args: readonly unknown[]) => {
      const stream = args[2] as 'stdout' | 'stderr';
      return {
        content: stream === 'stdout' ? 'hello-out' : 'hello-err',
        truncated: false,
        stream,
      };
    });

    render(<BackgroundTaskHeaderMonitor sessionId="session-1" />);
    fireEvent.click(await screen.findByTestId('background-task-badge'));

    const toggle = await screen.findByTestId('background-task-row-toggle');
    fireEvent.click(toggle);

    await waitFor(() => expect(readOutput).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.getByText('hello-out')).toBeDefined());
    expect(screen.getByText('hello-err')).toBeDefined();
  });

  it('issues a kill request when the kill button is confirmed', async () => {
    listTasks.mockResolvedValue([task({ taskId: 'task-1' })]);
    killTask.mockResolvedValue({ status: 'KILLED' });
    readOutput.mockResolvedValue({ content: '', truncated: false, stream: 'stdout' });

    render(<BackgroundTaskHeaderMonitor sessionId="session-1" />);
    fireEvent.click(await screen.findByTestId('background-task-badge'));
    await screen.findByTestId('background-task-kill-button');

    fireEvent.click(screen.getByTestId('background-task-kill-button'));
    const confirmButton = await screen.findByText('关闭进程', { selector: '.ant-popconfirm-buttons .ant-btn-primary span' });
    fireEvent.click(confirmButton);

    await waitFor(() => expect(killTask).toHaveBeenCalledWith('session-1', 'task-1'));
  });

  it('closes the dropdown on Escape', async () => {
    listTasks.mockResolvedValue([task({ taskId: 'task-1' })]);
    render(<BackgroundTaskHeaderMonitor sessionId="session-1" />);
    fireEvent.click(await screen.findByTestId('background-task-badge'));
    expect(screen.getByTestId('background-task-monitor-panel')).toBeDefined();

    fireEvent.keyDown(window, { key: 'Escape' });
    await waitFor(() => {
      const badge = screen.getByTestId('background-task-badge');
      expect(badge.getAttribute('aria-expanded')).toBe('false');
    });
  });

  it('derives task state from BACKGROUND_TASK stream events with no extra list calls', async () => {
    listTasks.mockResolvedValue([]); // seed empty — the task arrives via the stream

    render(<BackgroundTaskHeaderMonitor sessionId="session-stream" />);
    expect(screen.queryByTestId('background-task-badge')).toBeNull();

    // STARTED → badge appears, task shows as RUNNING (kill button present).
    useBackgroundTaskStore.getState().applyStreamEnvelope(
      backgroundTaskEnvelope('session-stream', 1, 'BACKGROUND_TASK_STARTED', {
        taskId: 'task-stream',
        commandName: 'sleep',
        status: 'RUNNING',
        startedAt: 1000,
        stdoutRef: 'out.txt',
        stderrRef: 'err.txt',
      }),
    );
    fireEvent.click(await screen.findByTestId('background-task-badge'));
    expect(await screen.findByText('sleep')).toBeDefined();
    expect(screen.queryAllByTestId('background-task-kill-button')).toHaveLength(1);

    // COMPLETED → status transitions to 已完成, kill button gone.
    useBackgroundTaskStore.getState().applyStreamEnvelope(
      backgroundTaskEnvelope('session-stream', 2, 'BACKGROUND_TASK_COMPLETED', {
        taskId: 'task-stream',
        commandName: 'sleep',
        status: 'COMPLETED',
        startedAt: 1000,
        finishedAt: 2000,
        exitCode: 0,
        stdoutRef: 'out.txt',
        stderrRef: 'err.txt',
      }),
    );
    await waitFor(() => expect(screen.getByText('已完成')).toBeDefined());
    expect(screen.queryAllByTestId('background-task-kill-button')).toHaveLength(0);
    // Only the one seed fetch happened — stream events drove the updates.
    expect(listTasks).toHaveBeenCalledTimes(1);
  });
});
