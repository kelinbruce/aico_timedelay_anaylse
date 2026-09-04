const { expect, test } = require('@playwright/test');

const SESSION_ID = 'session-capability-business-language';
const RUN_ID = 'run-capability-business-language';
const hostModes = [
  { name: 'local', url: `/#/session/${SESSION_ID}` },
  { name: 'immersive', url: `/immersive#/session/${SESSION_ID}` },
  { name: 'collaborative', url: '/collaborative', collaborative: true },
];

const fullResources = [
  resource('TOOL', 'Read', 'Read file', '读取文件'),
  resource('TOOL', 'NetworkElementStatusLookup', 'Query network element status', '查询网元状态'),
  resource('TOOL', 'FutureNetworkTool', 'Future diagnosis', '<strong>扩展诊断</strong> **Tool** [详情](javascript:alert(1))'),
  resource('TOOL', 'Python', 'Run program', '执行程序'),
  resource('TOOL', 'Agent', 'Agent', '智能体'),
  resource('TOOL', 'Skill', 'Skill', '技能'),
  resource('TOOL', 'Workflow', 'Workflow', '流程'),
  resource('AGENT', 'network-diagnostic-agent', 'Network fault diagnosis', '网络故障诊断'),
  resource('SKILL', 'network-diagnosis', 'Network diagnosis', '网络诊断'),
  resource('WORKFLOW', 'workflow-title-mapped-test', 'Outer workflow', '外层流程'),
  resource('WORKFLOW', 'alarm-recovery', 'Alarm recovery', '告警恢复'),
];

for (const host of hostModes) {
  test(`${host.name} prefetches the current Session resources across refresh`, async ({ page }) => {
    const fixture = await installFixture(page, () => fullResources);
    await openHost(page, host);
    await assertBusinessLanguage(page, 'zh-CN');
    await expect.poll(fixture.readResources).toBeGreaterThanOrEqual(1);

    await page.reload();
    if (host.collaborative) {
      await page.getByTestId('ai-agent-piu-entrance').click();
      await expect(page.getByTestId('ai-agent-piu-panel')).toBeVisible();
    }
    await assertBusinessLanguage(page, 'zh-CN');
    await expect.poll(fixture.readResources).toBeGreaterThanOrEqual(2);
  });

  test(`${host.name} refreshes once for a novel runtime identity`, async ({ page }) => {
    let reads = 0;
    const fixture = await installFixture(page, () => {
      reads += 1;
      return reads === 1 ? fullResources.filter((entry) => entry.capabilityId !== 'FutureNetworkTool') : fullResources;
    });
    await openHost(page, host);
    await assertBusinessLanguage(page, 'zh-CN');
    await expect.poll(fixture.readResources).toBe(2);
  });
}

test('local switches Capability names to English without another resource request', async ({ page }) => {
  const fixture = await installFixture(page, () => fullResources);
  await openHost(page, hostModes[0]);
  await assertBusinessLanguage(page, 'zh-CN');
  await expect.poll(fixture.readResources).toBe(1);

  await page.getByRole('button', { name: '设置' }).click();
  const settings = page.getByRole('dialog', { name: '设置' });
  await settings.locator('.ant-select-selector').click();
  await page.getByText('English', { exact: true }).last().click();
  await page.getByRole('button', { name: 'Close' }).click();

  await assertBusinessLanguage(page, 'en-US');
  await expect.poll(fixture.readResources).toBe(1);
});

async function installFixture(page, readPresentationResources) {
  let eventRequests = 0;
  let presentationRequests = 0;
  await page.route('**/api/v1/sessions?**', async (route) => {
    await json(route, { entries: [], offset: 0, limit: 50, hasMore: false });
  });
  await page.route('**/api/v1/sessions/**', async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === `/api/v1/sessions/${SESSION_ID}/conversation`) {
      await json(route, conversationPage());
      return;
    }
    if (url.pathname === `/api/v1/sessions/${SESSION_ID}/capability-presentation-resources`) {
      presentationRequests += 1;
      await json(route, { resources: readPresentationResources() });
      return;
    }
    if (url.pathname === `/api/v1/sessions/${SESSION_ID}/runs/${RUN_ID}/events`) {
      eventRequests += 1;
      await json(route, eventPage());
      return;
    }
    if (url.pathname === `/api/v1/sessions/${SESSION_ID}/annotations`) {
      await json(route, { annotations: [] });
      return;
    }
    if (url.pathname === `/api/v1/sessions/${SESSION_ID}/conversation/preview`) {
      await json(route, { sessionId: SESSION_ID, totalMarkers: 0, offset: 0, limit: 100, markers: [] });
      return;
    }
    if (url.pathname === `/api/v1/sessions/${SESSION_ID}/stream`) {
      return;
    }
    await route.fulfill({ status: 404, contentType: 'application/json', body: '{}' });
  });
  return { readEvents: () => eventRequests, readResources: () => presentationRequests };
}

async function openHost(page, host, locale = 'zh-CN') {
  await page.addInitScript((initialLocale) => {
    window.localStorage.setItem('nextagent.localePreference', initialLocale);
  }, locale);
  if (host.collaborative) {
    await page.addInitScript((sessionId) => {
      window.sessionStorage.setItem('nextagent:AICOPIU:activeSessionId', sessionId);
    }, SESSION_ID);
  }
  await page.goto(host.url);
  if (host.collaborative) {
    await page.getByTestId('ai-agent-piu-entrance').click();
    await expect(page.getByTestId('ai-agent-piu-panel')).toBeVisible();
  }
}

async function assertBusinessLanguage(page, locale) {
  const turn = page.locator('[data-root-message-id="root-business-language"]');
  await expect(turn.getByText('Business language verified.', { exact: true })).toBeVisible();
  const toggle = turn.getByTestId('turn-process-toggle');
  if ((await toggle.getAttribute('aria-expanded')) !== 'true') {
    await toggle.click();
  }
  const panel = turn.getByTestId('turn-process-panel');
  const expectedByLocale = {
    'zh-CN': [
      '读取文件 · 已完成',
      '查询网元状态 · 已完成',
      '调用子智能体：网络故障诊断 · 已完成',
      '加载技能：网络诊断 · 已完成',
      '执行预设流程：外层流程 · 已完成',
      '<strong>扩展诊断</strong> **Tool** [详情](javascript:alert(1)) · 已完成',
      '执行程序 · 已完成',
    ],
    'en-US': [
      'Read file · Completed',
      'Query network element status · Completed',
      'Invoke sub-agent: Network fault diagnosis · Completed',
      'Load skill: Network diagnosis · Completed',
      'Run preset workflow: Outer workflow · Completed',
      'Future diagnosis · Completed',
      'Run program · Completed',
    ],
  };
  const titles = expectedByLocale[locale];
  for (const title of titles) {
    await expect(panel).toContainText(title);
  }
  await expect(panel).not.toContainText('结果已返回，暂无可展示摘要');
  await expect(panel).not.toContainText('Result returned without a displayable summary');
  await expect(panel).not.toContainText('Read ·');
  await expect(panel).not.toContainText('Skill ·');

  const workflowTitle = locale === 'zh-CN' ? '执行预设流程：外层流程' : 'Run preset workflow: Outer workflow';
  const workflow = panel.getByTestId('turn-process-entry-toggle').filter({ hasText: workflowTitle });
  await expect(workflow).toHaveCount(1);
  const nestedWorkflowTitle = locale === 'zh-CN' ? '执行预设流程：告警恢复' : 'Run preset workflow: Alarm recovery';
  if ((await workflow.getAttribute('aria-expanded')) === 'true') {
    await workflow.click();
  }
  await expect(panel).not.toContainText(nestedWorkflowTitle);
  await workflow.click();
  const completedLabel = locale === 'zh-CN' ? '已完成' : 'Completed';
  await expect(panel).toContainText(`${nestedWorkflowTitle} · ${completedLabel}`);

  const python = panel.getByTestId('turn-process-entry-toggle').filter({ hasText: locale === 'zh-CN' ? '执行程序' : 'Run program' });
  await expect(python).toHaveCount(1);
  if ((await python.getAttribute('aria-expanded')) !== 'true') {
    await python.click();
  }
  await expect(panel).toContainText('CELL_OK 42ms');
  await expect(panel).not.toContainText('private-script.py');

  if (locale === 'zh-CN') {
    const literalMarkupTitle = panel
      .getByTestId('turn-process-entry-title')
      .filter({ hasText: '<strong>扩展诊断</strong> **Tool** [详情](javascript:alert(1))' });
    await expect(literalMarkupTitle).toHaveCount(1);
    await expect(literalMarkupTitle.locator('strong')).toHaveCount(0);
    await expect(literalMarkupTitle.locator('a')).toHaveCount(0);
  }
}

function resource(capabilityKind, capabilityId, displayName, zhDisplayName) {
  return {
    capabilityKind,
    capabilityId,
    displayName,
    locales: { language: { 'en-US': { displayName }, 'zh-CN': { displayName: zhDisplayName } } },
  };
}

function conversationPage() {
  const common = {
    sessionId: SESSION_ID,
    requestId: 'request-business-language',
    runId: RUN_ID,
    requestContextId: 'context-business-language',
    rootMessageId: 'root-business-language',
    contentType: 'PLAIN_TEXT',
    visible: true,
  };
  const items = [
    {
      ...common,
      messageId: 'root-business-language',
      role: 'USER',
      sequence: 1,
      content: 'Verify capability business language',
      metadata: {},
      createdAt: '2026-08-06T01:00:00.000Z',
    },
  ];
  let sequence = 2;
  for (const [toolCallId, toolName] of [
    ['read-call', 'Read'],
    ['network-status-call', 'NetworkElementStatusLookup'],
    ['agent-call', 'Agent'],
    ['skill-call', 'Skill'],
    ['workflow-call', 'Workflow'],
    ['future-call', 'FutureNetworkTool'],
    ['python-call', 'Python'],
  ]) {
    items.push({
      ...common,
      messageId: `${toolCallId}-result`,
      role: 'CAPABILITY_RESULT',
      sequence: sequence++,
      content: '',
      metadata: { kind: 'CAPABILITY_RESULT', toolCallId, toolName },
      createdAt: `2026-08-06T01:00:00.${String(sequence).padStart(3, '0')}Z`,
    });
  }
  items.push({
    ...common,
    messageId: 'answer-business-language',
    role: 'ASSISTANT',
    sequence,
    content: 'Business language verified.',
    contentType: 'MARKDOWN',
    metadata: { status: 'COMPLETED' },
    createdAt: '2026-08-06T01:00:01.000Z',
  });
  return { sessionId: SESSION_ID, items, nextCursor: null };
}

function eventPage() {
  const events = [];
  let sequence = 1;
  const addLifecycle = ({ capabilityKind, capabilityId, targetCapabilityId, toolCallId, parentToolCallId, resultPresentationLevel = 'SUMMARY' }) => {
    const identity = {
      capabilityKind,
      capabilityId,
      ...(targetCapabilityId === undefined ? {} : { targetCapabilityId }),
      ...(parentToolCallId === undefined ? {} : { parentToolCallId }),
      toolCallId,
      toolName: capabilityId,
    };
    events.push(envelope(sequence++, 'CAPABILITY_STARTED', `${toolCallId}-start`, identity));
    if (capabilityId === 'Python') {
      events.push(
        envelope(sequence++, 'CAPABILITY_RESULT_DELTA', `${toolCallId}-result`, {
          capabilityId,
          toolCallId,
          toolName: capabilityId,
          status: 'SUCCEEDED',
          resultPresentationLevel: 'DETAIL',
          text: '',
          content: '',
          contentType: 'PLAIN_TEXT',
          safeSummaryCode: 'CAPABILITY_RESULT_COMMAND_SUCCEEDED_WITH_OUTPUT',
          safeSummaryArgs: { exitCode: 0 },
          safeResult: {
            kind: 'commandOutput',
            exitCode: 0,
            stdoutPreview: 'CELL_OK 42ms',
            stderrPreview: '',
            stdoutTruncated: false,
            stderrTruncated: false,
          },
        }),
      );
    }
    events.push(
      envelope(sequence++, 'CAPABILITY_COMPLETED', `${toolCallId}-complete`, {
        ...identity,
        messageId: `${toolCallId}-result`,
        status: 'SUCCEEDED',
        resultPresentationLevel,
      }),
    );
  };

  addLifecycle({ capabilityKind: 'TOOL', capabilityId: 'Read', toolCallId: 'read-call' });
  addLifecycle({
    capabilityKind: 'TOOL',
    capabilityId: 'NetworkElementStatusLookup',
    toolCallId: 'network-status-call',
    resultPresentationLevel: 'STATUS_ONLY',
  });
  addLifecycle({
    capabilityKind: 'TOOL',
    capabilityId: 'Agent',
    targetCapabilityId: 'network-diagnostic-agent',
    toolCallId: 'agent-call',
    resultPresentationLevel: 'STATUS_ONLY',
  });
  addLifecycle({
    capabilityKind: 'TOOL',
    capabilityId: 'Skill',
    targetCapabilityId: 'network-diagnosis',
    toolCallId: 'skill-call',
    resultPresentationLevel: 'STATUS_ONLY',
  });
  addLifecycle({
    capabilityKind: 'TOOL',
    capabilityId: 'Workflow',
    targetCapabilityId: 'workflow-title-mapped-test',
    toolCallId: 'workflow-call',
    resultPresentationLevel: 'STATUS_ONLY',
  });
  addLifecycle({
    capabilityKind: 'WORKFLOW',
    capabilityId: 'alarm-recovery',
    toolCallId: 'workflow-child-call',
    parentToolCallId: 'workflow-call',
    resultPresentationLevel: 'STATUS_ONLY',
  });
  addLifecycle({ capabilityKind: 'TOOL', capabilityId: 'FutureNetworkTool', toolCallId: 'future-call', resultPresentationLevel: 'STATUS_ONLY' });
  addLifecycle({ capabilityKind: 'TOOL', capabilityId: 'Python', toolCallId: 'python-call', resultPresentationLevel: 'DETAIL' });
  return { availability: 'AVAILABLE', events };
}

function envelope(sequence, eventType, eventId, payload) {
  return {
    eventId,
    sessionId: SESSION_ID,
    requestId: 'request-business-language',
    runId: RUN_ID,
    requestContextId: 'context-business-language',
    rootMessageId: 'root-business-language',
    sequence,
    eventType,
    timelineEventRef: `timeline-${eventId}`,
    transportHints: ['SSE', 'WEBSOCKET'],
    payload,
    createdAt: `2026-08-06T01:00:00.${String(sequence).padStart(3, '0')}Z`,
  };
}

async function json(route, body) {
  await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
}
