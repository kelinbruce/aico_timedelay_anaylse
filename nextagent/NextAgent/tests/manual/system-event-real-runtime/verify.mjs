#!/usr/bin/env node

import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isTerminalEventType, loadAllRunEvents, readSseRun, requestJson, requireEvent, safeEvidence } from './verify-support.mjs';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const requireFromFrontend = createRequire(resolve(repoRoot, 'frontend/agent-web/package.json'));
const { chromium } = requireFromFrontend('playwright');
const scenario = readOption('--scenario');
const baseUrl = normalizeBaseUrl(readOption('--base-url'));
const locale = 'zh-CN';

if (!['degradation', 'context-compaction'].includes(scenario)) {
  throw new Error('--scenario must be degradation or context-compaction.');
}

const browser = await chromium.launch({
  headless: true,
  ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH === undefined ? {} : { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH }),
});

try {
  const evidence = scenario === 'degradation' ? await verifyDegradation(browser) : await verifyContextCompaction(browser);
  process.stdout.write(`${JSON.stringify(safeEvidence(evidence), null, 2)}\n`);
} finally {
  await browser.close();
}

async function verifyDegradation(activeBrowser) {
  const session = await createSession();
  const page = await openSessionPage(activeBrowser, session.sessionId);
  const accepted = await submitRequest(session.sessionId, {
    inputText: '只调用 system_event_failure_probe 工具一次，不要调用其他工具；工具返回后停止。',
    modelOptions: { toolChoice: 'REQUIRED' },
  });
  const liveEvents = await readSseRun(baseUrl, session.sessionId, accepted.runId);
  const liveNotice = requireEvent(liveEvents, accepted.runId, 'DEGRADATION_NOTICE');
  const historyEvents = await loadAllRunEvents(baseUrl, session.sessionId, accepted.runId);
  const historyNotice = requireEvent(historyEvents, accepted.runId, 'DEGRADATION_NOTICE');
  requireMatchingCode(liveNotice, historyNotice, 'SYSTEM_EVENT_SCENARIO_FAILED');

  await verifyDegradationUi(page, true);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await verifyDegradationUi(page, false);

  return {
    scenario,
    sessionId: session.sessionId,
    requestId: accepted.requestId,
    runId: accepted.runId,
    eventType: 'DEGRADATION_NOTICE',
    code: 'SYSTEM_EVENT_SCENARIO_FAILED',
    terminalStatus: terminalStatus(liveEvents),
    historyEventTypes: historyEvents.map((event) => event.eventType),
  };
}

async function verifyContextCompaction(activeBrowser) {
  const session = await createSession();
  const page = await openSessionPage(activeBrowser, session.sessionId);
  await installToolChoiceNoneRequestPolicy(page, session.sessionId);
  const firstAccepted = await submitRequestThroughPage(page, session.sessionId, longTelecomAlarmRecord());
  const firstEvents = await readSseRun(baseUrl, session.sessionId, firstAccepted.runId);
  const rounds = [roundEvidence(firstAccepted, firstEvents)];
  await page.getByTestId('btn-send').waitFor({ state: 'visible', timeout: 30_000 });

  const liveNotice = page.getByTestId('assistant-compaction-notice');
  const liveNoticeResult = liveNotice
    .waitFor({ state: 'visible', timeout: 120_000 })
    .then(() => liveNotice.textContent())
    .then(
      (text) => ({ text }),
      (error) => ({ error }),
    );
  let compactedRun = null;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const accepted = await submitRequestThroughPage(
      page,
      session.sessionId,
      `不要提问，不要调用能力，只回答“共同现象是链路降级告警”。验证轮次 ${attempt}。`,
    );
    const events = await readSseRun(baseUrl, session.sessionId, accepted.runId);
    rounds.push(roundEvidence(accepted, events));
    if (events.some((event) => event.eventType === 'CONTEXT_COMPACTED')) {
      compactedRun = { accepted, events };
      break;
    }
    await page.getByTestId('btn-send').waitFor({ state: 'visible', timeout: 30_000 });
  }
  if (compactedRun === null) {
    throw new Error('CONTEXT_COMPACTED was not observed within the bounded public-API attempts.');
  }
  const notice = await liveNoticeResult;
  if ('error' in notice) {
    throw notice.error;
  }
  assertIncludes(notice.text, '系统已整理较早的对话内容，以便继续处理本次任务。', 'live context notice');
  requireEvent(compactedRun.events, compactedRun.accepted.runId, 'CONTEXT_COMPACTED');
  const historyEvents = await loadAllRunEvents(baseUrl, session.sessionId, compactedRun.accepted.runId);
  requireEvent(historyEvents, compactedRun.accepted.runId, 'CONTEXT_COMPACTED');

  await verifyContextUi(page);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await verifyContextUi(page);
  await page.waitForTimeout(3_500);
  if ((await page.getByTestId('assistant-compaction-notice').count()) !== 0) {
    throw new Error('History reload replayed the live-only context notice.');
  }

  return {
    scenario,
    sessionId: session.sessionId,
    requestId: compactedRun.accepted.requestId,
    runId: compactedRun.accepted.runId,
    eventType: 'CONTEXT_COMPACTED',
    terminalStatus: terminalStatus(compactedRun.events),
    rounds,
    historyEventTypes: historyEvents.map((event) => event.eventType),
  };
}

async function createSession() {
  return requestJson(baseUrl, '/api/v1/sessions', { method: 'POST', body: { locale } });
}

async function submitRequest(sessionId, input) {
  return requestJson(baseUrl, `/api/v1/sessions/${encodeURIComponent(sessionId)}/requests`, {
    method: 'POST',
    body: {
      inputText: input.inputText,
      locale,
      idempotencyKey: `system-event-${scenario}-${crypto.randomUUID()}`,
      modelOptions: input.modelOptions,
    },
  });
}

async function submitRequestThroughPage(page, sessionId, inputText) {
  const acceptedResponse = page.waitForResponse(
    (response) => response.request().method() === 'POST' && new URL(response.url()).pathname === `/api/v1/sessions/${sessionId}/requests`,
    { timeout: 30_000 },
  );
  await page.getByTestId('message-textarea').fill(inputText);
  await page.getByTestId('btn-send').click();
  const response = await acceptedResponse;
  if (!response.ok()) {
    throw new Error(`UI request submission failed with HTTP ${response.status()}.`);
  }
  return response.json();
}

async function installToolChoiceNoneRequestPolicy(page, sessionId) {
  await page.route(`**/api/v1/sessions/${sessionId}/requests`, async (route) => {
    const request = route.request();
    const body = request.postDataJSON();
    await route.continue({
      headers: { ...request.headers(), 'content-type': 'application/json' },
      postData: JSON.stringify({
        ...body,
        modelOptions: { ...(body.modelOptions ?? {}), toolChoice: 'NONE' },
      }),
    });
  });
}

async function openSessionPage(activeBrowser, sessionId) {
  const context = await activeBrowser.newContext();
  await context.addInitScript((selectedLocale) => {
    globalThis.localStorage.setItem('nextagent.localePreference', selectedLocale);
  }, locale);
  const page = await context.newPage();
  const streamReady = page.waitForResponse((response) => new URL(response.url()).pathname === `/api/v1/sessions/${sessionId}/stream`, {
    timeout: 30_000,
  });
  await page.goto(`${baseUrl}#/session/${encodeURIComponent(sessionId)}`, { waitUntil: 'domcontentloaded' });
  await streamReady;
  return page;
}

async function verifyDegradationUi(page, expandCode) {
  const processPanel = await openLatestProcessPanel(page);
  await waitForText(processPanel, '本次任务有部分内容未完成');
  await processPanel.getByTestId('turn-process-entry-warning-icon').first().waitFor({ state: 'visible' });
  assertIncludes(await processPanel.textContent(), '请查看执行详情和本次答复，确认未完成的内容。', 'degradation summary');
  if ((await processPanel.textContent())?.includes('SYSTEM_EVENT_SCENARIO_FAILED')) {
    throw new Error('The degradation code was visible before technical details were expanded.');
  }
  if (expandCode) {
    const row = processPanel.getByTestId('turn-process-entry').filter({ hasText: '本次任务有部分内容未完成' }).first();
    await row.getByTestId('turn-process-entry-toggle').click();
    await waitForText(row, '错误码：SYSTEM_EVENT_SCENARIO_FAILED');
  }
  await openFullProcess(processPanel);
  const graph = page.getByTestId('turn-run-graph-panel');
  await waitForGraphSummary(graph, '本次任务有部分内容未完成');
  assertIncludes(
    await graph.getByTestId('turn-run-graph-summary').textContent(),
    '请查看执行详情和本次答复，确认未完成的内容。',
    'degradation graph summary',
  );
}

async function verifyContextUi(page) {
  const processPanel = await openLatestProcessPanel(page);
  await waitForText(processPanel, '已整理较早的对话');
  await processPanel.getByTestId('turn-process-entry-info-icon').first().waitFor({ state: 'visible' });
  assertIncludes(await processPanel.textContent(), '系统已整理较早的对话内容，以便继续处理本次任务。', 'context summary');
  await openFullProcess(processPanel);
  await waitForGraphSummary(page.getByTestId('turn-run-graph-panel'), '已整理较早的对话');
}

async function openLatestProcessPanel(page) {
  const toggle = page.getByTestId('turn-process-toggle').last();
  await toggle.waitFor({ state: 'visible', timeout: 120_000 });
  if ((await toggle.getAttribute('aria-expanded')) !== 'true') {
    await toggle.click();
  }
  const panel = page.getByTestId('turn-process-panel').last();
  await panel.waitFor({ state: 'visible', timeout: 10_000 });
  return panel;
}

async function openFullProcess(processPanel) {
  const turn = processPanel.locator('xpath=ancestor::*[@data-root-message-id][1]');
  const button = turn.getByRole('button', { name: '完整过程', exact: true });
  await button.waitFor({ state: 'visible', timeout: 10_000 });
  await button.click();
}

async function waitForText(locator, text) {
  await locator.getByText(text, { exact: false }).first().waitFor({ state: 'visible', timeout: 120_000 });
}

async function waitForGraphSummary(graph, text) {
  await graph.waitFor({ state: 'visible', timeout: 10_000 });
  await graph.getByTestId('turn-run-graph-summary').filter({ hasText: text }).waitFor({ state: 'attached', timeout: 120_000 });
}

function requireMatchingCode(liveEvent, historyEvent, expectedCode) {
  const liveCode = liveEvent?.payload?.code;
  const historyCode = historyEvent?.payload?.code;
  if (liveCode !== expectedCode || historyCode !== expectedCode) {
    throw new Error('Live/history degradation code did not match the controlled fixture.');
  }
}

function terminalStatus(events) {
  const terminal = events.find((event) => isTerminalEventType(event.eventType));
  if (terminal === undefined) {
    throw new Error('No request terminal event was observed.');
  }
  return terminal.eventType.replace('REQUEST_', '');
}

function roundEvidence(accepted, events) {
  return { requestId: accepted.requestId, runId: accepted.runId, terminalStatus: terminalStatus(events) };
}

function longTelecomAlarmRecord() {
  const line = 'NE=RAN-001 ALARM=LINK_DEGRADED SEVERITY=MAJOR STATUS=ACTIVE; ';
  return `这些是有界测试数据。不要提问，不要调用能力，只回答“已收到”。\n${line.repeat(Math.ceil(24_000 / line.length)).slice(0, 24_000)}`;
}

function assertIncludes(actual, expected, label) {
  if (typeof actual !== 'string' || !actual.includes(expected)) {
    throw new Error(`${label} did not contain the expected governed text.`);
  }
}

function normalizeBaseUrl(value) {
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new Error('--base-url must use http or https.');
  }
  return url.href.endsWith('/') ? url.href : `${url.href}/`;
}

function readOption(name) {
  const index = process.argv.indexOf(name);
  const value = index < 0 ? undefined : process.argv[index + 1];
  if (value === undefined || value.startsWith('--')) {
    throw new Error(`${name} is required.`);
  }
  return value;
}
