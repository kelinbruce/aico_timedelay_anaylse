import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, screen, within } from '@testing-library/react';
import { CronTaskDashboardPage } from './CronTaskDashboardPage.tsx';
import { renderWithAppProviders as render } from '../../tests/renderWithAppProviders.tsx';
import type { CronTaskView } from '../services/cronTaskService.ts';

const mocks = vi.hoisted(() => ({
  listCronTasks: vi.fn(),
  listCronTaskExecutions: vi.fn(),
}));

vi.mock('../services/cronTaskService.ts', () => ({
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

async function renderPage() {
  render(<CronTaskDashboardPage />, { withRouter: true });
  const card = await screen.findByTestId('cron-task-card-task-1');
  const moreButton = within(card).getByRole('button', { name: '更多操作' });
  return { card, moreButton };
}

describe('CronTaskDashboardPage task menu', () => {
  it('closes the menu when clicking outside the panel and trigger', async () => {
    const { moreButton } = await renderPage();

    fireEvent.click(moreButton);
    expect(screen.getByRole('menu')).toBeTruthy();

    fireEvent.mouseDown(screen.getByText('Check network alarms'));
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('keeps the menu open when mousedown starts inside the panel', async () => {
    const { moreButton } = await renderPage();

    fireEvent.click(moreButton);
    const menuItem = screen.getAllByRole('menuitem')[0] as HTMLElement;
    fireEvent.mouseDown(menuItem);
    expect(screen.getByRole('menu')).toBeTruthy();

    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('still closes the menu when the trigger is clicked again', async () => {
    const { moreButton } = await renderPage();

    fireEvent.click(moreButton);
    expect(screen.getByRole('menu')).toBeTruthy();

    fireEvent.click(moreButton);
    expect(screen.queryByRole('menu')).toBeNull();
  });
});
