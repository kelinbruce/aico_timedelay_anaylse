// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, screen, within } from '@testing-library/react';
import { CronTaskDashboardPage } from '../../src/pages/CronTaskDashboardPage.tsx';
import { renderWithAppProviders as render } from '../renderWithAppProviders.tsx';
import type { CronTaskView } from '../../src/services/cronTaskService.ts';

const mocks = vi.hoisted(() => ({
  listCronTasks: vi.fn(),
  listCronTaskExecutions: vi.fn(),
}));

vi.mock('../../src/services/cronTaskService.ts', () => ({
  cronTaskService: {
    listCronTasks: mocks.listCronTasks,
    listCronTaskExecutions: mocks.listCronTaskExecutions,
    createCronTask: vi.fn(),
    updateCronTask: vi.fn(),
    deleteCronTask: vi.fn(),
    executeCronTask: vi.fn(),
  },
}));

const sampleTask: CronTaskView = {
  taskId: 'task-1',
  cron: '0 9 * * *',
  humanSchedule: 'Daily at 09:00',
  prompt: 'Check network alarms',
  recurring: true,
  status: 'ACTIVE',
  createdAt: 1786332000000,
  updatedAt: 1786332000000,
  nextRunAt: 1786417200000,
  createdBy: 'local-subject',
  createdByName: 'Local developer',
};

beforeEach(() => {
  mocks.listCronTasks.mockReset();
  mocks.listCronTaskExecutions.mockReset();
  mocks.listCronTasks.mockResolvedValue({ tasks: [sampleTask], total: 1 });
  mocks.listCronTaskExecutions.mockResolvedValue({ executions: [], total: 0 });
});

afterEach(() => {
  cleanup();
});

function isGated(element: HTMLElement): boolean {
  let el: HTMLElement | null = element;
  while (el && el.tagName !== 'BODY') {
    if (el.style.pointerEvents === 'none') return true;
    el = el.parentElement;
  }
  const button = element.closest('button');
  return button?.hasAttribute('disabled') ?? false;
}

async function renderPage(ops: string[] | null) {
  if (ops === null) {
    render(<CronTaskDashboardPage />, { mode: 'local', withRouter: true });
  } else {
    render(<CronTaskDashboardPage />, { mode: 'immersive', site: { user: { ops } }, withRouter: true });
  }
  return screen.findByTestId('cron-task-card-task-1');
}

describe('CronTaskDashboardPage permission control', () => {
  it('disables manual create button when user lacks Write', async () => {
    await renderPage(['AICOService.View']);
    const createBtn = screen.getByText('手动创建').closest('button')!;
    expect(isGated(createBtn)).toBe(true);
  });

  it('disables create-from-session button when user lacks Write', async () => {
    await renderPage(['AICOService.View']);
    const createFromSessionBtn = screen.getByText('通过会话创建').closest('button')!;
    expect(isGated(createFromSessionBtn)).toBe(true);
  });

  it('keeps create buttons enabled when user has Write', async () => {
    await renderPage(['AICOService.View', 'AICOService.Write']);
    const createBtn = screen.getByText('手动创建').closest('button')!;
    expect(isGated(createBtn)).toBe(false);
  });

  it('disables execute button when user lacks Write', async () => {
    const card = await renderPage(['AICOService.View']);
    const executeBtn = within(card).getByRole('button', { name: '执行' });
    expect(isGated(executeBtn)).toBe(true);
  });

  it('disables edit menu item when user lacks Write', async () => {
    const card = await renderPage(['AICOService.View']);
    const moreButton = within(card).getByRole('button', { name: '更多操作' });
    fireEvent.click(moreButton);
    const menu = screen.getByRole('menu');
    const editItem = within(menu).getByText('修改');
    expect(isGated(editItem)).toBe(true);
  });

  it('disables delete menu item when user lacks Write', async () => {
    const card = await renderPage(['AICOService.View']);
    const moreButton = within(card).getByRole('button', { name: '更多操作' });
    fireEvent.click(moreButton);
    const menu = screen.getByRole('menu');
    const deleteItem = within(menu).getByText('删除');
    expect(isGated(deleteItem)).toBe(true);
  });

  it('keeps task list visible when user lacks Write', async () => {
    const card = await renderPage(['AICOService.View']);
    expect(card).toBeTruthy();
    expect(screen.getByText('Check network alarms')).toBeTruthy();
  });

  it('renders all controls normally in local mode', async () => {
    const card = await renderPage(null);
    const createBtn = screen.getByText('手动创建').closest('button')!;
    expect(isGated(createBtn)).toBe(false);
    const executeBtn = within(card).getByRole('button', { name: '执行' });
    expect(isGated(executeBtn)).toBe(false);
  });
});
