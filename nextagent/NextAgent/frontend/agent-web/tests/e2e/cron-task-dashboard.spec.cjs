const { expect, test } = require('@playwright/test');

test('manages cron tasks and filters execution records from the dashboard', async ({ page }) => {
  let tasks = [
    {
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
    },
  ];

  await page.route('**/api/v1/sessions?**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ sessions: [], total: 0, hasMore: false }),
    });
  });

  await page.route('**/api/v1/cron-tasks?**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ tasks, total: tasks.length }),
    });
  });

  await page.route('**/api/v1/cron-tasks/cron-1/runs?**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        executions: [
          execution('trigger-in-range', '2026-07-22T01:00:00.000Z', 'in range report'),
          execution('trigger-out-of-range', '2026-07-20T01:00:00.000Z', 'out of range report'),
        ],
        total: 2,
      }),
    });
  });

  let executeRequests = 0;
  await page.route('**/api/v1/cron-tasks/cron-1/runs', async (route) => {
    if (route.request().method() === 'POST') {
      executeRequests += 1;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(execution('trigger-now', '2026-07-22T02:00:00.000Z', 'manual run accepted')),
      });
      return;
    }
    await route.fallback();
  });

  await page.route('**/api/v1/cron-tasks/cron-1', async (route) => {
    if (route.request().method() === 'DELETE') {
      tasks = [];
      await route.fulfill({ status: 204, body: '' });
      return;
    }
    await route.fallback();
  });

  await page.goto('/');
  await page.getByRole('button', { name: 'Scheduled tasks' }).click();

  await expect(page).toHaveURL(/\/cron-tasks$/);
  await expect(page.getByRole('heading', { name: 'Scheduled tasks' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Create manually' })).toBeVisible();
  await expect(page.getByTestId('cron-task-card-cron-1')).toBeVisible();
  await expect(page.getByText('daily access network report')).toBeVisible();
  await expect(page.getByText('Time: Every day at 09:00')).toBeVisible();
  await expect(page.getByText('Frequency: Recurring')).toBeVisible();
  await expect(page.getByText('Created by: gongxu')).toBeVisible();
  await expect(page.getByText('Total tasks')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Activate' })).toHaveCount(0);

  await page.getByRole('button', { name: 'Execute' }).click();
  await expect.poll(() => executeRequests).toBe(1);
  await expect(page.getByTestId('cron-execution-trigger-in-range')).toBeVisible();
  await expect(page.getByRole('complementary', { name: 'Execution timeline' })).toBeVisible();
  await expect(page.getByText('2026-07-22').first()).toBeVisible();
  await expect(page.getByText('1 executions').first()).toBeVisible();
  await expect(page.getByText('out of range report')).toBeVisible();

  await page.getByLabel('Scheduled task name').fill('cron-1');
  await page.getByLabel('Start time').fill('2026-07-22');
  await page.getByLabel('End time').fill('2026-07-22');
  await page.keyboard.press('Escape');
  await page.getByTestId('cron-execution-filters').getByRole('button', { name: 'Query' }).click();
  await expect(page.getByText('in range report')).toBeVisible();
  await expect(page.getByText('out of range report')).toHaveCount(0);

  await page.getByRole('tab', { name: 'Tasks' }).click();
  await page.getByRole('button', { name: 'More actions' }).click();
  await page.getByRole('menuitem', { name: 'Delete' }).click();
  const popconfirm = page.getByRole('tooltip');
  await expect(popconfirm.getByText('Delete cron-1? It will not create new triggers after deletion.')).toBeVisible();
  await popconfirm.getByRole('button', { name: /Delete/ }).click();
  await expect(page.getByText('No scheduled tasks')).toBeVisible();
});

function execution(triggerId, scheduledAt, resultContent) {
  return {
    triggerId,
    taskId: 'cron-1',
    scheduledAt,
    triggerStatus: 'COMPLETED',
    createdAt: scheduledAt,
    updatedAt: scheduledAt,
    sessionId: 'session-cron-1',
    requestRunId: `run-${triggerId}`,
    runStatus: 'COMPLETED',
    terminalCommitState: 'COMMITTED',
    resultContent,
    resultEventType: 'REQUEST_COMPLETED',
    resultAt: scheduledAt,
  };
}
