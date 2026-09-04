// @vitest-environment jsdom
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import dayjs from 'dayjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CronTaskDashboardPage } from '../src/pages/CronTaskDashboardPage.tsx';
import type { ApiError } from '../src/services/apiClient.ts';
import { cronTaskService } from '../src/services/cronTaskService.ts';
import type { CronTaskView } from '../src/services/cronTaskService.ts';
import i18n from '../src/i18n/index.ts';
import { renderWithAppProviders as render } from './renderWithAppProviders.tsx';

vi.mock('../src/services/cronTaskService.ts', () => ({
  cronTaskService: {
    listCronTasks: vi.fn(),
    createCronTask: vi.fn(),
    updateCronTask: vi.fn(),
    deleteCronTask: vi.fn(),
    executeCronTask: vi.fn(),
    listCronTaskExecutions: vi.fn(),
  },
}));

describe('CronTaskDashboardPage', () => {
  beforeEach(() => {
    vi.mocked(cronTaskService.listCronTasks).mockResolvedValue({ tasks: [task()], total: 1 });
    vi.mocked(cronTaskService.listCronTaskExecutions).mockResolvedValue({
      executions: [execution()],
      total: 1,
    });
    vi.mocked(cronTaskService.executeCronTask).mockResolvedValue(execution());
  });

  afterEach(async () => {
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    await i18n.changeLanguage('zh-CN');
  });

  it('uses the unified contained header and a single layout-owned content viewport', () => {
    render(<CronTaskDashboardPage />, { withRouter: true });

    expect(screen.getByTestId('page-layout-header')).toBeTruthy();
    expect(screen.getByTestId('page-layout-title').textContent).toBe('定时任务');
    expect(screen.getByTestId('page-layout-content-frame').dataset.contentWidth).toBe('contained');
    expect(screen.getAllByTestId('page-layout-scroll-viewport')).toHaveLength(1);
    expect(screen.getByRole('button', { name: '手动创建' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '通过会话创建' })).toBeTruthy();
    expect(screen.queryByTestId('page-layout-more-actions')).toBeNull();
    expect(screen.queryByRole('button', { name: '返回' })).toBeNull();
  });

  it('renders cron task cards and execution records by tab', async () => {
    render(<CronTaskDashboardPage />, { withRouter: true });

    expect(screen.getByText('定时任务')).toBeTruthy();
    expect(screen.getByRole('button', { name: '手动创建' })).toBeTruthy();
    expect(await screen.findByTestId('cron-task-card-cron-1')).toBeTruthy();
    expect(screen.getByText('cron-1')).toBeTruthy();
    expect(screen.getByText('时间: 每天 09:00')).toBeTruthy();
    expect(screen.getByText('频率: 循环')).toBeTruthy();
    expect(screen.getByText('创建人: gongxu')).toBeTruthy();
    expect(screen.queryByText('任务总数')).toBeNull();
    expect(screen.queryByText('当前页')).toBeNull();
    expect(screen.queryByRole('button', { name: '激活' })).toBeNull();
    expect(screen.getAllByText('daily access network report').length).toBeGreaterThanOrEqual(1);

    fireEvent.click(screen.getByRole('button', { name: '执行' }));
    expect(await screen.findByTestId('cron-execution-trigger-1')).toBeTruthy();
    expect(cronTaskService.listCronTaskExecutions).toHaveBeenCalledWith('cron-1', { offset: 0, limit: 50 });
    expect(cronTaskService.executeCronTask).toHaveBeenCalledWith('cron-1');
    expect(screen.queryByText('执行时间线')).toBeNull();
    expect(screen.getByText('2026-07-22')).toBeTruthy();
    expect(screen.queryByText('cron-1 · 1 次执行')).toBeNull();
    expect(screen.getAllByText('cron-1').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('2026-07-22 09:00')).toBeTruthy();
    expect(screen.getByText('查看详情')).toBeTruthy();
    expect(screen.getByText('report finished')).toBeTruthy();
  });

  it('uses the shared scheduled tasks page name in English', async () => {
    await i18n.changeLanguage('en-US');

    render(<CronTaskDashboardPage />, { withRouter: true });

    expect(screen.getByRole('heading', { name: 'Scheduled tasks', level: 1 })).toBeTruthy();
    expect(screen.queryByText('Scheduled task management')).toBeNull();
  });

  it('keeps the creator placeholder for legacy tasks without createdByName', async () => {
    const { createdByName: _createdByName, ...legacyTask } = task();
    vi.mocked(cronTaskService.listCronTasks).mockResolvedValue({ tasks: [legacyTask], total: 1 });

    render(<CronTaskDashboardPage />, { withRouter: true });

    expect(await screen.findByText('创建人: -')).toBeTruthy();
  });

  it('marks the clicked task card as active', async () => {
    vi.mocked(cronTaskService.listCronTasks).mockResolvedValue({
      tasks: [task(), task({ taskId: 'cron-2' })],
      total: 2,
    });

    render(<CronTaskDashboardPage />, { withRouter: true });

    const firstCard = await screen.findByTestId('cron-task-card-cron-1');
    const secondCard = await screen.findByTestId('cron-task-card-cron-2');
    expect(firstCard.className).toContain('active');

    fireEvent.click(secondCard);

    expect(firstCard.className).not.toContain('active');
    expect(secondCard.className).toContain('active');
  });

  it('shows unavailable errors with a retry action', async () => {
    vi.mocked(cronTaskService.listCronTasks).mockRejectedValueOnce(new Error('Cron task management service is unavailable.'));

    render(<CronTaskDashboardPage />, { withRouter: true });

    expect(await screen.findByText('定时任务加载失败')).toBeTruthy();
    expect(screen.queryByText('Cron task management service is unavailable.')).toBeNull();
    fireEvent.click(screen.getByText('重试'));

    await waitFor(() => {
      expect(cronTaskService.listCronTasks).toHaveBeenCalledTimes(2);
    });
  });

  it('creates cron tasks and refreshes the list', async () => {
    vi.mocked(cronTaskService.createCronTask).mockResolvedValue(task({ taskId: 'cron-2', prompt: 'night check' }));

    render(<CronTaskDashboardPage />, { withRouter: true });

    fireEvent.click(screen.getByRole('button', { name: '手动创建' }));
    fireEvent.change(screen.getByPlaceholderText('0 9 * * *'), { target: { value: '0 23 * * *' } });
    fireEvent.change(screen.getAllByRole('textbox')[1]!, { target: { value: 'night check' } });
    fireEvent.click(screen.getByRole('button', { name: /保\s*存/ }));

    await waitFor(() => {
      expect(cronTaskService.createCronTask).toHaveBeenCalledWith({
        cron: '0 23 * * *',
        prompt: 'night check',
        recurring: true,
      });
    });
    expect(cronTaskService.listCronTasks).toHaveBeenCalledTimes(2);
  });

  it('shows localized cron invalid expression error with format guidance', async () => {
    vi.mocked(cronTaskService.createCronTask).mockRejectedValueOnce(cronApiError('CRON_INVALID_EXPRESSION', 'Cron expression is invalid.'));

    render(<CronTaskDashboardPage />, { withRouter: true });

    fireEvent.click(screen.getByRole('button', { name: '手动创建' }));
    fireEvent.change(screen.getByPlaceholderText('0 9 * * *'), { target: { value: 'invalid' } });
    fireEvent.change(screen.getAllByRole('textbox')[1]!, { target: { value: 'night check' } });
    fireEvent.click(screen.getByRole('button', { name: /保\s*存/ }));

    expect(await screen.findByText(/Cron 表达式不合法/)).toBeTruthy();
    expect(screen.getByText(/五段式/)).toBeTruthy();
    expect(screen.getByText(/0 9 \* \* \*/)).toBeTruthy();
    expect(screen.queryByText('Cron expression is invalid.')).toBeNull();
  });

  it('shows localized no future match error', async () => {
    vi.mocked(cronTaskService.createCronTask).mockRejectedValueOnce(
      cronApiError('CRON_NO_FUTURE_MATCH', 'Cron expression does not match any calendar date in the next year.'),
    );

    render(<CronTaskDashboardPage />, { withRouter: true });

    fireEvent.click(screen.getByRole('button', { name: '手动创建' }));
    fireEvent.change(screen.getByPlaceholderText('0 9 * * *'), { target: { value: '0 9 1 1 *' } });
    fireEvent.change(screen.getAllByRole('textbox')[1]!, { target: { value: 'night check' } });
    fireEvent.click(screen.getByRole('button', { name: /保\s*存/ }));

    expect(await screen.findByText(/未来一年内没有匹配的日期/)).toBeTruthy();
  });

  it('shows and submits explicit skill or workflow bindings', async () => {
    vi.mocked(cronTaskService.listCronTasks).mockResolvedValue({
      tasks: [task({ target: { kind: 'WORKFLOW', name: 'daily-report' } })],
      total: 1,
    });
    vi.mocked(cronTaskService.createCronTask).mockResolvedValue(
      task({
        taskId: 'cron-2',
        prompt: 'night check',
        target: { kind: 'SKILL', name: 'ran-diagnosis' },
      }),
    );

    render(<CronTaskDashboardPage />, { withRouter: true });

    expect(await screen.findByText('绑定: Workflow: daily-report')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '手动创建' }));
    fireEvent.change(screen.getByPlaceholderText('0 9 * * *'), { target: { value: '0 23 * * *' } });
    fireEvent.change(screen.getAllByRole('textbox')[1]!, { target: { value: 'night check' } });
    fireEvent.click(screen.getByRole('combobox', { name: '绑定目标' }));
    fireEvent.click(within(screen.getByRole('listbox', { name: '绑定目标' })).getByRole('option', { name: 'Skill' }));
    fireEvent.change(screen.getByLabelText('目标名称'), { target: { value: 'ran-diagnosis' } });
    fireEvent.click(screen.getByRole('button', { name: /保\s*存/ }));

    await waitFor(() => {
      expect(cronTaskService.createCronTask).toHaveBeenCalledWith({
        cron: '0 23 * * *',
        prompt: 'night check',
        target: { kind: 'SKILL', name: 'ran-diagnosis' },
        recurring: true,
      });
    });
  });

  it('updates selected active cron tasks', async () => {
    vi.mocked(cronTaskService.updateCronTask).mockResolvedValue(task({ prompt: 'changed report' }));

    render(<CronTaskDashboardPage />, { withRouter: true });

    fireEvent.click(within(await screen.findByTestId('cron-task-card-cron-1')).getByLabelText('更多操作'));
    fireEvent.click(screen.getByText('修改'));
    fireEvent.change(screen.getByDisplayValue('daily access network report'), { target: { value: 'changed report' } });
    fireEvent.click(screen.getByRole('button', { name: /保\s*存/ }));

    await waitFor(() => {
      expect(cronTaskService.updateCronTask).toHaveBeenCalledWith('cron-1', {
        cron: '0 9 * * *',
        prompt: 'changed report',
        recurring: true,
      });
    });
  });

  it('deletes cron tasks after confirmation and refreshes the list', async () => {
    vi.mocked(cronTaskService.listCronTasks)
      .mockResolvedValueOnce({ tasks: [task()], total: 1 })
      .mockResolvedValueOnce({ tasks: [], total: 0 });
    vi.mocked(cronTaskService.deleteCronTask).mockResolvedValue(undefined);

    render(<CronTaskDashboardPage />, { withRouter: true });

    fireEvent.click(within(await screen.findByTestId('cron-task-card-cron-1')).getByLabelText('更多操作'));
    fireEvent.click(screen.getByText('删除'));
    const popconfirm = await screen.findByRole('tooltip');
    expect(within(popconfirm).getByText('确认删除 cron-1？删除后不会再产生新的触发。')).toBeTruthy();
    fireEvent.click(within(popconfirm).getByRole('button', { name: /删\s*除/ }));

    await waitFor(() => {
      expect(cronTaskService.deleteCronTask).toHaveBeenCalledWith('cron-1');
    });
    expect(await screen.findByText('暂无定时任务')).toBeTruthy();
  });

  it('summarizes offset minute cron schedules', async () => {
    vi.mocked(cronTaskService.listCronTasks).mockResolvedValue({
      tasks: [
        task({
          taskId: '9bf58258-ac81-4d97-be08-b3061793f206',
          cron: '2,7,12,17,22,27,32,37,42,47,52,57 * * * *',
          humanSchedule: '2,7,12,17,22,27,32,37,42,47,52,57 * * * *',
          prompt: '回复用户：你好',
        }),
      ],
      total: 1,
    });

    render(<CronTaskDashboardPage />, { withRouter: true });

    expect(await screen.findByText('时间: 每 5 分钟')).toBeTruthy();
    expect(screen.queryByText(/2,7,12,17,22,27/)).toBeNull();
  });

  it('localizes various cron schedule patterns on task cards', async () => {
    vi.mocked(cronTaskService.listCronTasks).mockResolvedValue({
      tasks: [
        task({ taskId: 'cron-every-3h', cron: '0 */3 * * *', humanSchedule: 'Every 3 hours' }),
        task({ taskId: 'cron-weekday', cron: '0 9 * * 1-5', humanSchedule: 'Weekdays at 9:00 AM' }),
        task({ taskId: 'cron-multi-hour', cron: '0 0,12 * * *', humanSchedule: 'Every day at 12:00 AM' }),
        task({ taskId: 'cron-weekend', cron: '0 9 * * 0,6', humanSchedule: 'Weekends at 9:00 AM' }),
        task({ taskId: 'cron-monthly', cron: '0 9 1 * *', humanSchedule: 'Day 1 of every month at 9:00 AM' }),
        task({ taskId: 'cron-custom', cron: '0 9 1,15 6 *', humanSchedule: 'Complex schedule' }),
      ],
      total: 5,
    });

    render(<CronTaskDashboardPage />, { withRouter: true });

    expect(await screen.findByText('时间: 每 3 小时')).toBeTruthy();
    expect(screen.getByText('时间: 工作日 09:00')).toBeTruthy();
    expect(screen.getByText('时间: 每天 00:00, 12:00')).toBeTruthy();
    expect(screen.getByText('时间: 周末 09:00')).toBeTruthy();
    expect(screen.getByText('时间: 每月 1 日 09:00')).toBeTruthy();
    expect(screen.getByText('时间: 自定义计划')).toBeTruthy();
    expect(screen.queryByText('Every 3 hours')).toBeNull();
    expect(screen.queryByText('Weekdays at 9:00 AM')).toBeNull();
    expect(screen.queryByText(/0 0,12 \* \* \*/)).toBeNull();
  });

  it('does not auto-navigate to execution sessions', async () => {
    render(<CronTaskDashboardPage />, { withRouter: true });

    fireEvent.click(await screen.findByRole('button', { name: '执行' }));
    expect(await screen.findByTestId('cron-execution-trigger-1')).toBeTruthy();
    expect(screen.queryByText('sessionId: session-1')).toBeNull();
    fireEvent.click(screen.getByText('查看详情'));
    expect(await screen.findByText('sessionId: session-1')).toBeTruthy();
    expect(screen.getByText('触发状态: COMPLETED')).toBeTruthy();
    expect(screen.getByText('运行状态: COMPLETED')).toBeTruthy();
    expect(screen.queryByRole('link', { name: /session-1/ })).toBeNull();
  });

  it('filters execution records by task name and date range', async () => {
    vi.mocked(cronTaskService.listCronTaskExecutions).mockResolvedValue({
      executions: [
        execution({ triggerId: 'trigger-in-range', scheduledAt: '2026-07-22T01:00:00.000Z', resultContent: 'in range' }),
        execution({ triggerId: 'trigger-out-of-range', scheduledAt: '2026-07-20T01:00:00.000Z', resultContent: 'out of range' }),
      ],
      total: 2,
    });

    render(<CronTaskDashboardPage />, { withRouter: true });

    fireEvent.click(await screen.findByRole('button', { name: '执行' }));
    expect(await screen.findByText('in range')).toBeTruthy();
    expect(screen.getByText('out of range')).toBeTruthy();

    fireEvent.change(screen.getByLabelText('定时任务名称'), { target: { value: 'cron-1' } });
    const startDateInput = screen.getByLabelText('开始时间') as HTMLInputElement;
    const endDateInput = screen.getByLabelText('结束时间') as HTMLInputElement;
    fireEvent.change(startDateInput, { target: { value: '2026-07-22' } });
    fireEvent.blur(startDateInput);
    fireEvent.keyDown(startDateInput, { key: 'Enter' });
    fireEvent.change(endDateInput, { target: { value: '2026-07-22' } });
    fireEvent.blur(endDateInput);
    fireEvent.keyDown(endDateInput, { key: 'Enter' });
    fireEvent.click(screen.getByRole('button', { name: /查\s*询/ }));

    expect(await screen.findByText('in range')).toBeTruthy();
    expect(screen.queryByText('out of range')).toBeNull();
    expect(cronTaskService.listCronTaskExecutions).toHaveBeenCalledWith('cron-1', { offset: 0, limit: 50 });
  });

  it('shows execution filter placeholders', () => {
    render(<CronTaskDashboardPage />, { withRouter: true });

    fireEvent.click(screen.getByRole('tab', { name: /\u6267\u884c\u8bb0\u5f55/ }));

    expect(screen.getByPlaceholderText('\u4efb\u52a1\u540d\u79f0')).toBeTruthy();
    expect(screen.getByRole('combobox', { name: '\u4efb\u52a1\u72b6\u6001' })).toBeTruthy();
    expect(screen.getByPlaceholderText('\u8bf7\u9009\u62e9\u5f00\u59cb\u65e5\u671f')).toBeTruthy();
    expect(screen.getByPlaceholderText('\u8bf7\u9009\u62e9\u7ed3\u675f\u65e5\u671f')).toBeTruthy();
  });

  it('localizes execution filter placeholders', async () => {
    await i18n.changeLanguage('en-US');

    render(<CronTaskDashboardPage />, { withRouter: true });

    fireEvent.click(screen.getByRole('tab', { name: 'Executions' }));

    expect(screen.getByPlaceholderText('Task name')).toBeTruthy();
    expect(screen.getByPlaceholderText('Please select start date')).toBeTruthy();
    expect(screen.getByPlaceholderText('Please select end date')).toBeTruthy();
  });

  it('localizes execution run status filter options', async () => {
    await i18n.changeLanguage('en-US');

    render(<CronTaskDashboardPage />, { withRouter: true });

    fireEvent.click(screen.getByRole('tab', { name: 'Executions' }));
    fireEvent.focus(screen.getByRole('combobox', { name: 'Task status' }));

    const listbox = screen.getByRole('listbox', { name: 'Task status' });
    const options = within(listbox).getAllByRole('option');
    expect(options.map((option) => option.textContent)).toEqual(['Failed', 'Superseded', 'Completed', 'Canceled', 'Not Running']);
  });

  it('shows fixed execution run status filter options', () => {
    render(<CronTaskDashboardPage />, { withRouter: true });

    fireEvent.click(screen.getByRole('tab', { name: '执行记录' }));
    fireEvent.focus(screen.getByRole('combobox', { name: '任务状态' }));

    const listbox = screen.getByRole('listbox', { name: '任务状态' });
    const options = within(listbox).getAllByRole('option');
    expect(options.map((option) => option.textContent)).toEqual(['已失败', '已替代', '已完成', '已取消', '未运行']);
  });

  it('filters execution records by execution run status', async () => {
    vi.mocked(cronTaskService.listCronTasks).mockResolvedValue({
      tasks: [task({ taskId: 'cron-1' }), task({ taskId: 'cron-2' })],
      total: 2,
    });
    vi.mocked(cronTaskService.listCronTaskExecutions).mockImplementation(async (taskId) => ({
      executions: [
        {
          ...execution(),
          triggerId: `trigger-${taskId}`,
          taskId,
          runStatus: taskId === 'cron-1' ? 'COMPLETED' : 'FAILED',
          resultContent: taskId === 'cron-1' ? 'completed run result' : 'failed run result',
        },
      ],
      total: 1,
    }));

    render(<CronTaskDashboardPage />, { withRouter: true });

    await screen.findByTestId('cron-task-card-cron-2');
    fireEvent.click(screen.getByRole('tab', { name: /\u6267\u884c\u8bb0\u5f55/ }));

    await screen.findByText('failed run result');
    const taskNameInput = screen.getByLabelText('\u5b9a\u65f6\u4efb\u52a1\u540d\u79f0') as HTMLInputElement;
    expect(taskNameInput.value).toBe('');

    const statusTrigger = screen.getByRole('combobox', { name: '\u4efb\u52a1\u72b6\u6001' });
    fireEvent.focus(statusTrigger);
    fireEvent.click(await screen.findByRole('option', { name: '\u5df2\u5b8c\u6210' }));
    fireEvent.click(screen.getByRole('button', { name: /\u67e5\s*\u8be2/ }));

    expect(await screen.findByText('completed run result')).toBeTruthy();
    expect(screen.queryByText('failed run result')).toBeNull();
  });

  it('allows manually clearing the selected task status', async () => {
    vi.mocked(cronTaskService.listCronTasks).mockResolvedValue({
      tasks: [task(), task({ taskId: 'cron-2' })],
      total: 2,
    });
    vi.mocked(cronTaskService.listCronTaskExecutions).mockImplementation(async (taskId) => ({
      executions: [
        {
          ...execution(),
          triggerId: `trigger-${taskId}`,
          taskId,
          runStatus: taskId === 'cron-1' ? 'COMPLETED' : 'FAILED',
          resultContent: taskId === 'cron-1' ? 'completed result' : 'failed result',
        },
      ],
      total: 1,
    }));

    render(<CronTaskDashboardPage />, { withRouter: true });

    await screen.findByTestId('cron-task-card-cron-2');
    fireEvent.click(screen.getByRole('tab', { name: '执行记录' }));
    await screen.findByText('failed result');

    const statusInput = screen.getByRole('combobox', { name: '任务状态' }) as HTMLInputElement;
    fireEvent.focus(statusInput);
    fireEvent.click(await screen.findByRole('option', { name: '已完成' }));
    fireEvent.click(screen.getByRole('button', { name: /查\s*询/ }));

    expect(await screen.findByText('completed result')).toBeTruthy();
    expect(screen.queryByText('failed result')).toBeNull();

    fireEvent.change(statusInput, { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: /查\s*询/ }));

    expect(await screen.findByText('failed result')).toBeTruthy();
    expect(screen.getByText('completed result')).toBeTruthy();
  });

  it('filters execution records with missing runStatus as not run', async () => {
    vi.mocked(cronTaskService.listCronTasks).mockResolvedValue({
      tasks: [task(), task({ taskId: 'cron-2' })],
      total: 2,
    });
    vi.mocked(cronTaskService.listCronTaskExecutions).mockImplementation(async (taskId) => ({
      executions: [
        {
          ...execution(),
          triggerId: `trigger-${taskId}`,
          taskId,
          runStatus: taskId === 'cron-2' ? '' : 'COMPLETED',
          resultContent: taskId === 'cron-2' ? 'unrun result' : 'completed result',
        },
      ],
      total: 1,
    }));

    render(<CronTaskDashboardPage />, { withRouter: true });

    await screen.findByTestId('cron-task-card-cron-2');
    fireEvent.click(screen.getByRole('tab', { name: '执行记录' }));

    await screen.findByText('unrun result');
    fireEvent.focus(screen.getByRole('combobox', { name: '任务状态' }));
    fireEvent.click(await screen.findByRole('option', { name: '未运行' }));
    fireEvent.click(screen.getByRole('button', { name: /查\s*询/ }));

    expect(await screen.findByText('unrun result')).toBeTruthy();
    expect(screen.queryByText('completed result')).toBeNull();
  });

  it('sorts execution records by scheduled date descending', async () => {
    vi.mocked(cronTaskService.listCronTaskExecutions).mockResolvedValue({
      executions: [
        execution({ triggerId: 'trigger-older', scheduledAt: '2026-07-20T01:00:00.000Z', resultContent: 'older' }),
        execution({ triggerId: 'trigger-newer', scheduledAt: '2026-07-23T01:00:00.000Z', resultContent: 'newer' }),
      ],
      total: 2,
    });

    render(<CronTaskDashboardPage />, { withRouter: true });

    await screen.findByTestId('cron-task-card-cron-1');
    fireEvent.click(screen.getByRole('tab', { name: '执行记录' }));

    await screen.findByText('newer');
    const executionList = document.querySelector('.cron-executions') as HTMLElement;
    const executionCards = within(executionList).getAllByTestId(/^cron-execution-/);
    expect(executionCards[0]?.textContent).toContain('newer');
    expect(executionCards[1]?.textContent).toContain('older');

    const timelineDates = Array.from(document.querySelectorAll('.cron-execution-timeline__item time')).map((node) => node.textContent);
    expect(timelineDates).toEqual(['2026-07-23', '2026-07-20']);
    const executionGroups = Array.from(document.querySelectorAll('.cron-execution-group')).map((node) => node.getAttribute('data-date'));
    const timelineItems = Array.from(document.querySelectorAll('.cron-execution-timeline__item')).map((node) => node.getAttribute('data-date'));
    expect(executionGroups).toEqual(['2026-07-23', '2026-07-20']);
    expect(timelineItems).toEqual(executionGroups);
    const timelineExecutionIds = Array.from(document.querySelectorAll('.cron-execution-timeline__item')).map((node) =>
      node.getAttribute('data-execution-id'),
    );
    const executionIds = Array.from(document.querySelectorAll('.cron-execution[data-execution-id]')).map((node) =>
      node.getAttribute('data-execution-id'),
    );
    expect(timelineExecutionIds).toEqual(executionIds);
    expect(document.querySelector('.cron-execution-timeline')?.textContent).not.toContain('cron-1');
  });

  it('labels current date timeline nodes as today', async () => {
    const today = dayjs().format('YYYY-MM-DD');
    vi.mocked(cronTaskService.listCronTaskExecutions).mockResolvedValue({
      executions: [execution({ triggerId: 'trigger-today', scheduledAt: `${today}T00:00:00`, resultContent: 'today run' })],
      total: 1,
    });

    render(<CronTaskDashboardPage />, { withRouter: true });

    await screen.findByTestId('cron-task-card-cron-1');
    fireEvent.click(screen.getByRole('tab', { name: '执行记录' }));

    expect(await screen.findByText('今天')).toBeTruthy();
  });

  it('shows date and total count only on the first timeline node of each date', async () => {
    const today = dayjs().format('YYYY-MM-DD');
    vi.mocked(cronTaskService.listCronTaskExecutions).mockResolvedValue({
      executions: [
        execution({ triggerId: 'trigger-today-2', scheduledAt: `${today}T02:00:00`, resultContent: 'today 2' }),
        execution({ triggerId: 'trigger-today-1', scheduledAt: `${today}T01:00:00`, resultContent: 'today 1' }),
        execution({ triggerId: 'trigger-older', scheduledAt: '2020-01-02T01:00:00.000Z', resultContent: 'older' }),
      ],
      total: 3,
    });

    render(<CronTaskDashboardPage />, { withRouter: true });

    await screen.findByTestId('cron-task-card-cron-1');
    fireEvent.click(screen.getByRole('tab', { name: '执行记录' }));

    await screen.findByText('today 1');
    const timelineItems = Array.from(document.querySelectorAll('.cron-execution-timeline__item'));
    expect(timelineItems[0]?.textContent).toContain('今天');
    expect(timelineItems[0]?.textContent).toContain('2 次执行');
    expect(timelineItems[1]?.textContent).toBe('');
    expect(timelineItems[2]?.textContent).toContain('2020-01-02');
    expect(timelineItems[2]?.textContent).toContain('1 次执行');
  });

  it('colors timeline nodes by execution run status', async () => {
    vi.mocked(cronTaskService.listCronTaskExecutions).mockResolvedValue({
      executions: [
        execution({ triggerId: 'trigger-completed', scheduledAt: '2026-07-23T01:00:00.000Z', runStatus: 'COMPLETED' }),
        execution({ triggerId: 'trigger-superseded', scheduledAt: '2026-07-22T01:00:00.000Z', runStatus: 'SUPERSEDED' }),
        execution({ triggerId: 'trigger-canceled', scheduledAt: '2026-07-21T01:00:00.000Z', runStatus: 'CANCELED' }),
        execution({ triggerId: 'trigger-failed', scheduledAt: '2026-07-20T01:00:00.000Z', runStatus: 'FAILED' }),
      ],
      total: 4,
    });

    render(<CronTaskDashboardPage />, { withRouter: true });

    await screen.findByTestId('cron-task-card-cron-1');
    fireEvent.click(screen.getByRole('tab', { name: '执行记录' }));

    await waitFor(() => {
      expect(document.querySelectorAll('.cron-execution-timeline__item')).toHaveLength(4);
    });
    const dots = Array.from(document.querySelectorAll('.cron-execution-timeline__dot'));
    expect(dots[0]?.className).toContain('cron-execution-timeline__dot--completed');
    expect(dots[1]?.className).toContain('cron-execution-timeline__dot--superseded');
    expect(dots[2]?.className).toContain('cron-execution-timeline__dot--canceled');
    expect(dots[3]?.className).toContain('cron-execution-timeline__dot--failed');
  });

  it('does not commit a future start date in the start DatePicker', async () => {
    render(<CronTaskDashboardPage />, { withRouter: true });

    fireEvent.click(await screen.findByRole('tab', { name: '执行记录' }));

    const startDateInput = screen.getByLabelText('开始时间') as HTMLInputElement;
    fireEvent.change(startDateInput, { target: { value: '2099-01-01' } });
    fireEvent.blur(startDateInput);
    fireEvent.keyDown(startDateInput, { key: 'Enter' });

    await waitFor(() => {
      expect(startDateInput.value).toBe('');
    });
  });

  it('does not commit a future end date in the end DatePicker', async () => {
    render(<CronTaskDashboardPage />, { withRouter: true });

    fireEvent.click(await screen.findByRole('tab', { name: '执行记录' }));

    const endDateInput = screen.getByLabelText('结束时间') as HTMLInputElement;
    fireEvent.change(endDateInput, { target: { value: '2099-01-01' } });
    fireEvent.blur(endDateInput);
    fireEvent.keyDown(endDateInput, { key: 'Enter' });

    await waitFor(() => {
      expect(endDateInput.value).toBe('');
    });
  });

  it('shows validation error and blocks query when end date is before start date', async () => {
    render(<CronTaskDashboardPage />, { withRouter: true });

    fireEvent.click(await screen.findByRole('tab', { name: '执行记录' }));

    const startDateInput = screen.getByLabelText('开始时间') as HTMLInputElement;
    const endDateInput = screen.getByLabelText('结束时间') as HTMLInputElement;
    fireEvent.change(startDateInput, { target: { value: '2020-01-02' } });
    fireEvent.blur(startDateInput);
    fireEvent.keyDown(startDateInput, { key: 'Enter' });
    fireEvent.change(endDateInput, { target: { value: '2020-01-01' } });
    fireEvent.blur(endDateInput);
    fireEvent.keyDown(endDateInput, { key: 'Enter' });

    expect(await screen.findByText('结束时间必须大于或等于开始时间。')).toBeTruthy();
    expect((screen.getByRole('button', { name: /查\s*询/ }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('loads all task executions when the task filter is cleared', async () => {
    vi.mocked(cronTaskService.listCronTasks).mockResolvedValue({
      tasks: [task(), task({ taskId: 'cron-2' })],
      total: 2,
    });
    vi.mocked(cronTaskService.listCronTaskExecutions).mockImplementation(async (taskId) => ({
      executions: [{ ...execution(), triggerId: `trigger-${taskId}`, taskId }],
      total: 1,
    }));

    render(<CronTaskDashboardPage />, { withRouter: true });
    await screen.findByTestId('cron-task-card-cron-1');
    await screen.findByTestId('cron-task-card-cron-2');
    fireEvent.click(screen.getByRole('tab', { name: '执行记录' }));

    const taskNameInput = screen.getByLabelText('定时任务名称') as HTMLInputElement;
    fireEvent.change(taskNameInput, { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: /查\s*询/ }));

    await waitFor(() => {
      expect(cronTaskService.listCronTaskExecutions).toHaveBeenCalledWith('cron-1', { offset: 0, limit: 50 });
      expect(cronTaskService.listCronTaskExecutions).toHaveBeenCalledWith('cron-2', { offset: 0, limit: 50 });
    });
    expect(await screen.findByTestId('cron-execution-trigger-cron-1')).toBeTruthy();
    expect(screen.getByTestId('cron-execution-trigger-cron-2')).toBeTruthy();
  });

  it('defaults execution filters to empty and loads all task executions', async () => {
    vi.mocked(cronTaskService.listCronTasks).mockResolvedValue({
      tasks: [task(), task({ taskId: 'cron-2' })],
      total: 2,
    });
    vi.mocked(cronTaskService.listCronTaskExecutions).mockImplementation(async (taskId) => ({
      executions: [{ ...execution(), triggerId: `trigger-${taskId}`, taskId }],
      total: 1,
    }));

    render(<CronTaskDashboardPage />, { withRouter: true });

    await screen.findByTestId('cron-task-card-cron-1');
    await screen.findByTestId('cron-task-card-cron-2');
    fireEvent.click(screen.getByRole('tab', { name: '执行记录' }));

    expect((screen.getByLabelText('定时任务名称') as HTMLInputElement).value).toBe('');
    expect((screen.getByRole('combobox', { name: '任务状态' }) as HTMLInputElement).value).toBe('');
    expect((screen.getByLabelText('开始时间') as HTMLInputElement).value).toBe('');
    expect((screen.getByLabelText('结束时间') as HTMLInputElement).value).toBe('');

    await waitFor(() => {
      expect(cronTaskService.listCronTaskExecutions).toHaveBeenCalledWith('cron-1', { offset: 0, limit: 50 });
      expect(cronTaskService.listCronTaskExecutions).toHaveBeenCalledWith('cron-2', { offset: 0, limit: 50 });
    });
    expect(await screen.findByTestId('cron-execution-trigger-cron-1')).toBeTruthy();
    expect(screen.getByTestId('cron-execution-trigger-cron-2')).toBeTruthy();
  });

  it('shows all task filter options and highlights the current input value', async () => {
    vi.mocked(cronTaskService.listCronTasks).mockResolvedValue({
      tasks: [task(), task({ taskId: 'cron-2' })],
      total: 2,
    });

    render(<CronTaskDashboardPage />, { withRouter: true });

    await screen.findByTestId('cron-task-card-cron-1');
    await screen.findByTestId('cron-task-card-cron-2');
    fireEvent.click(screen.getByRole('tab', { name: '执行记录' }));

    const taskNameInput = screen.getByLabelText('定时任务名称') as HTMLInputElement;
    fireEvent.focus(taskNameInput);
    fireEvent.change(taskNameInput, { target: { value: 'cron-1' } });

    const listbox = screen.getByRole('listbox', { name: '定时任务名称' });
    const options = within(listbox).getAllByRole('option');
    expect(options.map((option) => option.textContent)).toEqual(['cron-1', 'cron-2']);
    expect(options[0]?.getAttribute('aria-selected')).toBe('true');
    expect(options[1]?.getAttribute('aria-selected')).toBe('false');
  });

  it('shows all target mode options and highlights the current selection', async () => {
    render(<CronTaskDashboardPage />, { withRouter: true });

    fireEvent.click(await screen.findByText('手动创建'));

    const combobox = screen.getByRole('combobox', { name: '绑定目标' });
    expect(combobox.textContent).toContain('不绑定');
    fireEvent.click(combobox);

    const options = within(screen.getByRole('listbox', { name: '绑定目标' })).getAllByRole('option');
    expect(options.map((option) => option.textContent)).toEqual(['不绑定', 'Skill', 'Workflow']);
    expect(options[0]?.getAttribute('aria-selected')).toBe('true');

    fireEvent.click(options[1]!);
    expect(screen.getByRole('combobox', { name: '绑定目标' }).textContent).toContain('Skill');
  });

  it('prefills conversation template and navigates to new session on create-via-chat', async () => {
    sessionStorage.clear();

    render(<CronTaskDashboardPage />, { withRouter: true });

    const button = await screen.findByText('通过会话创建');
    expect(button).toBeTruthy();
    fireEvent.click(button);

    const draft = sessionStorage.getItem('draft-__new__');
    expect(draft).toBeTruthy();
    expect(draft).toContain('执行频率');
    expect(draft).toContain('【');
  });
  it('calls onCreateFromSession instead of navigating when the prop is provided', async () => {
    sessionStorage.clear();
    const onCreateFromSession = vi.fn();

    render(<CronTaskDashboardPage onCreateFromSession={onCreateFromSession} />, { withRouter: true });

    const button = await screen.findByText('通过会话创建');
    fireEvent.click(button);

    expect(onCreateFromSession).toHaveBeenCalledTimes(1);
    expect(sessionStorage.getItem('draft-__new__')).toBeTruthy();
  });
});

function cronApiError(code: string, message: string): ApiError {
  return Object.assign(new Error(message), {
    status: 400,
    code,
    error: message,
    kind: 'http',
    retriable: false,
  }) as ApiError;
}

function task(overrides: Partial<CronTaskView> = {}): CronTaskView {
  return {
    taskId: 'cron-1',
    cron: '0 9 * * *',
    humanSchedule: 'Every day at 09:00',
    prompt: 'daily access network report',
    recurring: true,
    status: 'ACTIVE',
    createdByName: 'gongxu',
    createdAt: '2026-07-22T00:00:00.000Z',
    updatedAt: '2026-07-22T00:00:00.000Z',
    nextRunAt: '2026-07-23T01:00:00.000Z',
    ...overrides,
  };
}

function execution(overrides: Partial<ReturnType<typeof executionBase>> = {}) {
  return {
    ...executionBase(),
    ...overrides,
  };
}

function executionBase() {
  return {
    triggerId: 'trigger-1',
    taskId: 'cron-1',
    scheduledAt: '2026-07-22T01:00:00.000Z',
    triggerStatus: 'COMPLETED',
    createdAt: '2026-07-22T01:00:00.000Z',
    updatedAt: '2026-07-22T01:01:00.000Z',
    sessionId: 'session-1',
    requestRunId: 'run-1',
    runStatus: 'COMPLETED',
    terminalCommitState: 'COMMITTED',
    resultContent: 'report finished',
    resultEventType: 'REQUEST_COMPLETED',
    resultAt: '2026-07-22T01:01:00.000Z',
  };
}
