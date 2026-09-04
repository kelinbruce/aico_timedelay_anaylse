import { expect, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pathToFileURL } from 'node:url';

import type { SystemIntegrationCaseId } from '../case-manifest.js';
import { readCandidateStream, submitCandidateRequest } from './candidate-api.js';
import { requiredCandidateRoot, startCandidateHarness, type CandidateModelTurn } from './candidate-harness.js';
import { writePassingCaseEvidence } from './case-evidence.js';
import { hashDirectoryTree } from './external-consumer-root.js';
import { withRunScope, type SystemIntegrationRunScope } from './run-scope.js';

export async function runBrowserCase(caseId: SystemIntegrationCaseId, page: Page): Promise<void> {
  const candidateRoot = requiredCandidateRoot();
  const before = await hashDirectoryTree(candidateRoot);
  const externalPackagesRoot =
    caseId === 'TC-SI-094' || caseId === 'TC-SI-119' || caseId === 'TC-SI-122' ? requiredExternalPackagesRoot() : undefined;
  const localHostPackageRoot = externalPackagesRoot === undefined ? undefined : resolveLocalTestHostPackageRoot(externalPackagesRoot);
  const externalBefore = localHostPackageRoot === undefined ? undefined : await hashDirectoryTree(localHostPackageRoot);
  await withRunScope({ outputBase: process.env.TESTCLAW_SYSTEM_INTEGRATION_OUTPUT_ROOT }, async (scope) => {
    const harness = await startCandidateHarness({
      scope,
      candidateRoot,
      modelTurns: turns(caseId),
      modelResponseDelayMs: caseId === 'TC-SI-108' ? 500 : 0,
    });
    const needsHostBoundary = (caseId >= 'TC-SI-094' && caseId <= 'TC-SI-097') || caseId === 'TC-SI-119' || caseId === 'TC-SI-122';
    const localHost = externalPackagesRoot === undefined ? undefined : await resolveLocalTestHost(externalPackagesRoot);
    const browserBaseUrl = needsHostBoundary ? await startHostBoundary(scope, harness.baseUrl, localHost) : harness.baseUrl;
    const observations = await exercise(caseId, page, browserBaseUrl, harness.baseUrl);
    await writePassingCaseEvidence({
      evidenceRoot: scope.evidenceRoot,
      caseId,
      observations,
      canaries: [
        { category: 'prompt', value: `browser-prompt-${caseId}` },
        { category: 'credential', value: 'testclaw-loopback-key' },
        { category: 'absolute-path', value: candidateRoot },
      ],
    });
  });
  expect(await hashDirectoryTree(candidateRoot)).toBe(before);
  if (localHostPackageRoot !== undefined) {
    expect(await hashDirectoryTree(localHostPackageRoot)).toBe(externalBefore);
  }
}

async function exercise(
  caseId: SystemIntegrationCaseId,
  page: Page,
  baseUrl: string,
  apiBaseUrl = baseUrl,
): Promise<Record<string, boolean | number | string>> {
  if (caseId === 'TC-SI-091') {
    await page.goto(`${baseUrl}/`);
    await expect(page.getByTestId('welcome-state-root')).toBeVisible();
    await expect(page.getByTestId('welcome-title-main')).toHaveText('NextAgent');
    await expect(page.getByTestId('message-textarea')).toBeVisible();
    return { chatShellLoaded: true, composerVisible: true };
  }
  if (caseId === 'TC-SI-092') {
    return await memorySearchLayout(page, baseUrl);
  }
  if (caseId === 'TC-SI-093') {
    return await favoritesMemoryExclusion(page, baseUrl);
  }
  if (caseId >= 'TC-SI-094' && caseId <= 'TC-SI-097') {
    return await complaintHost(caseId, page, baseUrl, apiBaseUrl);
  }
  if (caseId === 'TC-SI-098') {
    return await cronDashboard(page, baseUrl);
  }
  if (caseId === 'TC-SI-119') {
    return await threeHostTruth(page, baseUrl);
  }
  if (caseId === 'TC-SI-120' || caseId === 'TC-SI-121') {
    return await processOutputProjection(caseId, page, baseUrl);
  }
  if (caseId === 'TC-SI-122') {
    return await safeFailureProjection(page, baseUrl, apiBaseUrl);
  }
  if (caseId === 'TC-SI-100') {
    await page.emulateMedia({ reducedMotion: 'reduce' });
  }

  const accepted = await submitCandidateRequest({ baseUrl, inputText: `browser-prompt-${caseId}` });
  if (caseId === 'TC-SI-106' || caseId === 'TC-SI-107') {
    await readUntilEvent(`${baseUrl}/api/v1/sessions/${accepted.sessionId}/stream?lastSeenSequence=0&runId=${accepted.runId}`, 'USER_INPUT_REQUIRED');
  } else {
    await readCandidateStream(baseUrl, accepted);
  }
  if (caseId === 'TC-SI-102' || caseId === 'TC-SI-103' || caseId === 'TC-SI-109' || caseId === 'TC-SI-110') {
    const retry = await fetch(`${baseUrl}/api/v1/sessions/${accepted.sessionId}/retry`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ expectedLatestRequestId: accepted.requestId, idempotencyKey: `browser-retry-${crypto.randomUUID()}` }),
    });
    expect(retry.status).toBe(200);
    const retried = (await retry.json()) as { runId: string };
    await readCandidateStream(baseUrl, { sessionId: accepted.sessionId, runId: retried.runId });
  }

  const hostPaths = caseId === 'TC-SI-099' ? ['/', '/immersive/', '/collaborative'] : ['/'];
  for (const hostPath of hostPaths) {
    if (hostPath === '/collaborative') {
      await page.goto(`${baseUrl}${hostPath}`);
      const entrance = page.getByTestId('ai-agent-piu-entrance');
      if (await entrance.count()) {
        await entrance.click();
      }
    } else {
      await page.goto(`${baseUrl}${hostPath}#/session/${accepted.sessionId}`);
    }
    await expect(page.getByTestId('message-textarea')).toBeVisible();
    if (hostPath !== '/collaborative') {
      await expect(page.getByText(`browser-prompt-${caseId}`, { exact: false }).last()).toBeVisible();
    }
  }
  if (caseId === 'TC-SI-100') {
    expect(await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches)).toBe(true);
  }
  if (caseId === 'TC-SI-106' || caseId === 'TC-SI-107') {
    await expect(page.getByText(/Which region|Question 20/u).first()).toBeVisible();
  } else if (caseId !== 'TC-SI-099') {
    await expect(page.getByText(`browser-final-${caseId}`, { exact: false }).last()).toBeVisible();
  }
  await page.reload();
  await expect(page.getByTestId('message-textarea')).toBeVisible();
  return { realBackendSessionLoaded: true, hostProjectionRendered: true, refreshRecovered: true };
}

async function memorySearchLayout(page: Page, baseUrl: string): Promise<Record<string, boolean>> {
  await page.goto(`${baseUrl}/immersive/`);
  await page.getByRole('button', { name: /Memory|记忆管理/u }).click();
  const search = page.getByPlaceholder(/Search summaries or content|搜索摘要或正文/u);
  await search.fill('router-'.repeat(80));
  const clear = page.getByRole('button', { name: /Clear search|清除搜索/u });
  await expect(clear).toBeVisible();
  const clearLeft = await clear.evaluate((element) => element.getBoundingClientRect().left);
  const inputRight = await search.evaluate((element) => element.getBoundingClientRect().right);
  expect(clearLeft).toBeLessThanOrEqual(inputRight);
  await expect(search).toHaveValue('router-'.repeat(80));
  return { longSearchRetained: true, clearButtonReachable: true };
}

async function favoritesMemoryExclusion(page: Page, baseUrl: string): Promise<Record<string, boolean>> {
  await page.goto(`${baseUrl}/immersive/`);
  const memory = page.getByRole('button', { name: /Memory management|记忆管理/u });
  await memory.click();
  await expect(page.getByRole('heading', { name: /Memory management|记忆管理/u })).toBeVisible();
  await page.getByRole('button', { name: /Favorites|收藏/u }).click();
  await expect(page.getByTestId('sidebar-favorites-list')).toBeVisible();
  await expect(memory).not.toHaveAttribute('aria-current', 'page');
  return { memoryOpened: true, favoritesReplacedMemory: true };
}

async function complaintHost(
  caseId: SystemIntegrationCaseId,
  page: Page,
  baseUrl: string,
  apiBaseUrl: string,
): Promise<Record<string, boolean | string>> {
  if (caseId === 'TC-SI-094') {
    const accepted = await submitCandidateRequest({ baseUrl: apiBaseUrl, inputText: `browser-prompt-${caseId}` });
    await readCandidateStream(apiBaseUrl, accepted);
    await page.goto(`${baseUrl}/testclaw-local/#/session/${accepted.sessionId}`);
    await page.getByTestId('btn-complaint-feedback').click();
    await expect(page.getByText(/Complaint Center|投诉中心/u)).toBeVisible();
    await expect(page.getByRole('button', { name: /Complaint history|投诉历史/u })).toHaveCount(0);
    await page.goto('about:blank');
    return { host: 'local', feedbackOpened: true, historyHidden: true };
  }
  if (caseId === 'TC-SI-096') {
    await page.addInitScript(() => sessionStorage.setItem('AICOConfig', JSON.stringify({ layoutConfig: { operatorPosition: 'RIGHT' } })));
  }
  const host = caseId === 'TC-SI-097' ? '/testclaw-collaborative' : '/immersive/';
  await page.goto(`${baseUrl}${host}`);
  if (caseId === 'TC-SI-097') {
    await page.getByTestId('ai-agent-piu-entrance').click();
    await page.getByRole('button', { name: /More functions|更多功能/u }).click();
    await page.getByRole('menuitem', { name: /Complaint history|投诉历史/u }).click();
    await expect(page.getByTestId('piu-renderer-container')).toBeVisible();
    await page.goto('about:blank');
    return { host, complaintHistoryOpened: true };
  }
  const button = page.getByRole('button', { name: /Complaint history|投诉历史/u });
  await expect(button).toBeVisible();
  await button.click();
  await expect(page.getByTestId('piu-renderer-container')).toBeVisible();
  await page.goto('about:blank');
  return { host, complaintHistoryOpened: true };
}

async function startHostBoundary(scope: SystemIntegrationRunScope, candidateBaseUrl: string, localHost?: LocalTestHost): Promise<string> {
  const server = createServer(async (request, response) => {
    try {
      const requestUrl = new URL(request.url ?? '/', candidateBaseUrl);
      if (requestUrl.pathname === '/testclaw-local' || requestUrl.pathname.startsWith('/testclaw-local/')) {
        if (localHost === undefined) {
          response.writeHead(404).end();
          return;
        }
        const relativePath =
          requestUrl.pathname === '/testclaw-local' || requestUrl.pathname === '/testclaw-local/'
            ? 'index.html'
            : decodeURIComponent(requestUrl.pathname.slice('/testclaw-local/'.length));
        const target = path.resolve(localHost.assetRoot, relativePath);
        if (target !== localHost.assetRoot && !target.startsWith(`${localHost.assetRoot}${path.sep}`)) {
          response.writeHead(400).end();
          return;
        }
        const body = await readFile(target);
        response.writeHead(200, { 'content-type': contentType(target) });
        response.end(body);
        return;
      }
      if (requestUrl.pathname === '/rest/naie/guardrail/config/v1/report/risks') {
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end(
          JSON.stringify({
            records: [
              { id: '1', name_en: 'Incorrect diagnosis', name_zh: '诊断错误' },
              { id: '8', name_en: 'Other', name_zh: '其他' },
            ],
          }),
        );
        return;
      }
      if (requestUrl.pathname === '/testclaw-collaborative') {
        response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        response.end(collaborativeHostHtml());
        return;
      }
      const chunks: Buffer[] = [];
      for await (const chunk of request) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      }
      const headers = { ...request.headers };
      delete headers.host;
      delete headers['content-length'];
      const upstream = await fetch(new URL(requestUrl.pathname + requestUrl.search, candidateBaseUrl), {
        method: request.method,
        headers: headers as Record<string, string>,
        ...(chunks.length === 0 ? {} : { body: Buffer.concat(chunks) }),
      });
      const responseHeaders = Object.fromEntries(upstream.headers);
      delete responseHeaders['content-encoding'];
      delete responseHeaders['content-length'];
      delete responseHeaders['transfer-encoding'];
      response.writeHead(upstream.status, responseHeaders);
      if (upstream.body === null) {
        response.end();
      } else {
        const body = Readable.fromWeb(upstream.body as never);
        body.on('error', () => {
          if (!response.destroyed) {
            response.destroy();
          }
        });
        response.on('close', () => body.destroy());
        body.pipe(response);
      }
    } catch {
      response.writeHead(502, { 'content-type': 'application/json' });
      response.end('{"error":"browser-boundary-unavailable"}');
    }
  });
  const port = await scope.listenOnRandomPort(server);
  return `http://127.0.0.1:${port}`;
}

function collaborativeHostHtml(): string {
  return `<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="/piu/AIAgentPIU.css"></head><body data-nextagent-host-mode="collaborative"><div id="ai-agent-container"></div><script>window.__testclawHandlers={};const piu={id:'testclaw-host',name:'AICOPIU',version:'1.0.0',config:{},deps:[],isBrowser:true,revs:{'febs.regs':'testclaw','febs.server':'testclaw'},attach(_piu,handlers){Object.assign(window.__testclawHandlers,handlers)},emit(key,state){const invoke=()=>{const handler=window.__testclawHandlers[key];if(typeof handler==='function')handler(state);else setTimeout(invoke,10)};invoke()}};window.Prel={ready(callback){callback()},autoLoad(){return Promise.resolve()},start(_name,_version,_deps,callback){callback(piu,{session:{},user:{id:'testclaw-user',name:'TestClaw',ops:null,roles:[]},locale:'zh-cn',theme:'lightday'})}};</script><script src="/piu/AIAgentPIU.js"></script><script>piu.emit('loadAIAgent',{containerId:'ai-agent-container'});</script></body></html>`;
}

async function cronDashboard(page: Page, baseUrl: string): Promise<Record<string, boolean>> {
  const created = await fetch(`${baseUrl}/api/v1/cron-tasks`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ cron: '*/5 * * * *', prompt: 'Inspect RAN alarms', recurring: true }),
  });
  expect(created.status).toBe(200);
  const task = (await created.json()) as { taskId: string };
  await page.goto(`${baseUrl}/immersive/`);
  const button = page.getByRole('button', { name: /Scheduled tasks|Cron|定时任务/u }).first();
  await expect(button).toBeVisible();
  await button.click();
  await expect(page.getByText(task.taskId, { exact: false })).toBeVisible();
  return { durableTaskSeeded: true, dashboardRenderedTask: true };
}

function turns(caseId: SystemIntegrationCaseId): readonly CandidateModelTurn[] {
  if (caseId === 'TC-SI-120') {
    return [
      {
        content: 'I will correlate the route convergence record with the busy-hour load window.',
        toolCalls: [{ toolCallId: 'browser-process-write', toolName: 'Write', arguments: { file_path: 'process.txt', content: 'ok' } }],
      },
      { content: 'Route convergence evidence is complete.', delayMs: 8_000 },
    ];
  }
  if (caseId === 'TC-SI-121') {
    return [
      {
        content: 'The backbone latency check is complete.',
        toolCalls: [{ toolCallId: 'browser-handoff-write', toolName: 'Write', arguments: { file_path: 'handoff.txt', content: 'ok' } }],
      },
      { content: 'The backbone latency check is complete.', delayMs: 8_000 },
    ];
  }
  if (caseId === 'TC-SI-122') {
    return [
      {
        toolCalls: [
          {
            toolCallId: 'browser-seed-write',
            toolName: 'Write',
            arguments: { file_path: 'workspace/existing.txt', content: 'existing protected content' },
          },
        ],
      },
      { content: 'The protected fixture is ready.' },
      {
        toolCalls: [
          { toolCallId: 'browser-safe-failure-write', toolName: 'Write', arguments: { file_path: 'workspace/existing.txt', content: 'replacement' } },
        ],
      },
      { content: 'The protected file was not changed.' },
    ];
  }
  if (caseId === 'TC-SI-099' || caseId === 'TC-SI-101') {
    return [
      {
        reasoning: 'router reasoning',
        toolCalls: [{ toolCallId: 'browser-write', toolName: 'Write', arguments: { file_path: 'browser.txt', content: 'ok' } }],
      },
      { content: `browser-final-${caseId}` },
    ];
  }
  if (caseId === 'TC-SI-106' || caseId === 'TC-SI-119') {
    return [
      {
        toolCalls: [
          {
            toolCallId: 'browser-question',
            toolName: 'AskUserQuestion',
            arguments: {
              questions: [
                {
                  prompt: 'Which region?',
                  options: [
                    { value: 'north', label: 'North' },
                    { value: 'south', label: 'South' },
                  ],
                },
              ],
            },
          },
        ],
      },
      { content: `browser-final-${caseId}` },
    ];
  }
  if (caseId === 'TC-SI-107') {
    return [
      {
        toolCalls: [
          {
            toolCallId: 'browser-questions-20',
            toolName: 'AskUserQuestion',
            arguments: {
              questions: Array.from({ length: 20 }, (_, index) => ({
                prompt: `Question ${index + 1}`,
                options: [
                  { value: 'yes', label: 'Yes' },
                  { value: 'no', label: 'No' },
                ],
              })),
            },
          },
        ],
      },
      { content: `browser-final-${caseId}` },
    ];
  }
  return [{ content: `browser-final-${caseId}` }];
}

async function processOutputProjection(caseId: SystemIntegrationCaseId, page: Page, baseUrl: string): Promise<Record<string, boolean>> {
  const accepted = await submitCandidateRequest({ baseUrl, inputText: `browser-prompt-${caseId}` });
  const terminal = readCandidateStream(baseUrl, accepted);
  await page.goto(`${baseUrl}/#/session/${accepted.sessionId}`);
  if (caseId === 'TC-SI-120') {
    const explanation = page.getByTestId('turn-process-explanation').last();
    await expect(explanation).toContainText('route convergence record');
    await expect(explanation.getByTestId('turn-process-entry-icon-node')).toHaveCount(0);
    await expect(page.getByTestId('assistant-content-region')).toHaveCount(0);
    await terminal;
    const answer = page.getByTestId('assistant-content-region').last();
    await expect(answer).toContainText('Route convergence evidence is complete.');
    return { pendingOutputProjectedInProcessBridge: true, pendingOutputHadNoAnswerRegion: true, terminalAnswerRendered: true };
  }
  const explanation = page.getByTestId('turn-process-entry-detail').last();
  await expect(explanation).toContainText('backbone latency check is complete');
  const pendingPresentation = await explanation.evaluate((element) => {
    const style = getComputedStyle(element);
    return { fontSize: style.fontSize, lineHeight: style.lineHeight, color: style.color };
  });
  const answer = page.getByTestId('assistant-content-region').last();
  await expect(answer).toContainText('The backbone latency check is complete.', { timeout: 15_000 });
  const handoffPresentation = await answer.evaluate((element) => {
    const style = getComputedStyle(element.querySelector('.markdown-content') ?? element);
    const regionStyle = getComputedStyle(element);
    return { fontSize: style.fontSize, lineHeight: style.lineHeight, color: style.color, opacity: regionStyle.opacity };
  });
  await terminal;
  expect(handoffPresentation).toEqual({ ...pendingPresentation, opacity: '1' });
  return { pendingOutputProjected: true, finalAnswerPreserved: true, typographyPreserved: true, presentationVisible: true };
}

async function safeFailureProjection(page: Page, hostBaseUrl: string, apiBaseUrl: string): Promise<Record<string, boolean | number>> {
  const seeded = await submitCandidateRequest({ baseUrl: apiBaseUrl, inputText: 'seed protected workspace fixture' });
  await readCandidateStream(apiBaseUrl, seeded);
  const accepted = await submitCandidateRequest({ baseUrl: apiBaseUrl, inputText: 'browser-prompt-TC-SI-122' });
  await readCandidateStream(apiBaseUrl, accepted);
  await page.addInitScript((sessionId) => sessionStorage.setItem('nextagent:AICOPIU:activeSessionId', sessionId), accepted.sessionId);

  const hosts = [
    { mode: 'local', baseUrl: apiBaseUrl, path: `/#/session/${accepted.sessionId}` },
    { mode: 'immersive', baseUrl: apiBaseUrl, path: `/immersive/#/session/${accepted.sessionId}` },
    { mode: 'collaborative', baseUrl: hostBaseUrl, path: '/testclaw-collaborative' },
  ] as const;
  for (const host of hosts) {
    await page.goto(`${host.baseUrl}${host.path}`);
    if (host.mode === 'collaborative') {
      await page.getByTestId('ai-agent-piu-entrance').click();
    }
    const panelToggle = page.getByTestId('turn-process-toggle').last();
    await expect(panelToggle).toHaveAttribute('aria-expanded', 'false');
    await panelToggle.click();

    const title = page.getByText(/Write · (未能完成|Could not complete)/u).last();
    const row = title.locator('xpath=ancestor::*[@data-testid="turn-process-entry"]');
    const reason = row.getByText(/修改文件前需要先完整读取最新内容。|The latest file content must be read completely before it can be modified\./u);
    const detailToggle = row.getByTestId('turn-process-entry-toggle');
    await expect(reason).toHaveCount(1);
    await expect(reason).toBeVisible();
    await expect(detailToggle).toHaveAttribute('aria-expanded', 'false');
    await expect(row.getByTestId('turn-process-entry-detail')).toHaveCount(0);

    await detailToggle.click();
    const detail = row.getByTestId('turn-process-entry-detail');
    await expect(detail).toContainText('WRITE_REQUIRES_FULL_READ');
    await expect(detail).toContainText('CONFLICT');
    await expect(reason).toHaveCount(1);
    const panelText = await page.getByTestId('turn-process-panel').last().innerText();
    expect(panelText).not.toMatch(/existing protected content|CAPABILITY_STARTED|执行结果：|Execution result:|系统将继续|retry now/u);
  }
  return { hostsVerified: hosts.length, singleFactualReason: true, detailsCollapsedByDefault: true, safeTechnicalDetails: true };
}

async function threeHostTruth(page: Page, baseUrl: string): Promise<Record<string, boolean | number>> {
  const accepted = await submitCandidateRequest({ baseUrl, inputText: 'browser-prompt-TC-SI-119' });
  const pending = await readUntilEvent(
    `${baseUrl}/api/v1/sessions/${accepted.sessionId}/stream?lastSeenSequence=0&runId=${accepted.runId}`,
    'USER_INPUT_REQUIRED',
  );
  const pendingInputId = findString(pending, 'pendingInputId');
  expect(pendingInputId).toBeDefined();
  await page.addInitScript((sessionId) => sessionStorage.setItem('nextagent:AICOPIU:activeSessionId', sessionId), accepted.sessionId);
  for (const host of threeHostRoutes(accepted.sessionId)) {
    await page.goto(`${baseUrl}${host.path}`);
    if (host.mode === 'collaborative') {
      await page.getByTestId('ai-agent-piu-entrance').click();
    }
    await expect(page.getByText('Which region?', { exact: false }).first()).toBeVisible();
  }
  const answer = await fetch(`${baseUrl}/api/v1/sessions/${accepted.sessionId}/pending-inputs/${pendingInputId}/answer`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ answers: [['north']] }),
  });
  expect(answer.status).toBe(200);
  const terminal = await readCandidateStream(baseUrl, accepted);
  expect(terminal).toContain('REQUEST_COMPLETED');
  expect(terminal).toContain('USER_INPUT_RECEIVED');
  for (const host of threeHostRoutes(accepted.sessionId)) {
    await page.goto(`${baseUrl}${host.path}`);
    if (host.mode === 'collaborative') {
      await page.getByTestId('ai-agent-piu-entrance').click();
    }
    await expect(page.getByText('browser-final-TC-SI-119', { exact: false })).toBeVisible();
    await page.reload();
    if (host.mode === 'collaborative') {
      await page.getByTestId('ai-agent-piu-entrance').click();
    }
    await expect(page.getByTestId('message-textarea')).toBeVisible();
  }
  return { hostsVerified: 3, sharedPendingInput: true, terminalAndRefreshConsistent: true };
}

async function readUntilEvent(url: string, eventType: string): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30_000);
  try {
    const response = await fetch(url, { signal: controller.signal });
    const reader = response.body?.getReader();
    if (reader === undefined) {
      throw new Error('stream-body-missing');
    }
    const decoder = new TextDecoder();
    let buffer = '';
    while (true) {
      const next = await reader.read();
      if (next.done) {
        break;
      }
      buffer += decoder.decode(next.value, { stream: true });
      const frames = buffer.split(/\r?\n\r?\n/u);
      buffer = frames.pop() ?? '';
      for (const frame of frames) {
        if (frame.includes(`event: ${eventType}`)) {
          const line = frame.split(/\r?\n/u).find((entry) => entry.startsWith('data: '));
          if (line !== undefined) {
            await reader.cancel();
            return JSON.parse(line.slice(6));
          }
        }
      }
    }
  } finally {
    clearTimeout(timer);
    controller.abort();
  }
  throw new Error(`event-${eventType}-missing`);
}

function findString(value: unknown, key: string): string | undefined {
  if (Array.isArray(value)) {
    for (const entry of value) {
      const found = findString(entry, key);
      if (found !== undefined) {
        return found;
      }
    }
    return undefined;
  }
  if (typeof value !== 'object' || value === null) {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  if (typeof record[key] === 'string') {
    return record[key];
  }
  for (const entry of Object.values(record)) {
    const found = findString(entry, key);
    if (found !== undefined) {
      return found;
    }
  }
  return undefined;
}

interface LocalTestHost {
  readonly assetRoot: string;
}

async function resolveLocalTestHost(externalPackagesRoot: string): Promise<LocalTestHost> {
  const packageRoot = resolveLocalTestHostPackageRoot(externalPackagesRoot);
  const packageJson = JSON.parse(await readFile(path.join(packageRoot, 'package.json'), 'utf8')) as { exports?: Record<string, unknown> };
  const hostingExport = packageJson.exports?.['./hosting'];
  if (typeof hostingExport !== 'string') {
    throw new Error('local-test-host-public-export-unavailable');
  }
  const hosting = (await import(pathToFileURL(path.resolve(packageRoot, hostingExport)).href)) as { resolveTestHostManifest?: () => unknown };
  const manifest = hosting.resolveTestHostManifest?.();
  if (!isRecord(manifest) || !isRecord(manifest.local) || typeof manifest.packageRoot !== 'string' || typeof manifest.local.assetRoot !== 'string') {
    throw new Error('local-test-host-manifest-invalid');
  }
  return { assetRoot: path.resolve(manifest.packageRoot, manifest.local.assetRoot) };
}

function resolveLocalTestHostPackageRoot(externalPackagesRoot: string): string {
  return path.join(externalPackagesRoot, 'dist', 'dev', 'agent-web-test-hosts');
}

function requiredExternalPackagesRoot(): string {
  const value = process.env.NEXTAGENT_EXTERNAL_PACKAGES_ROOT;
  if (value === undefined || value.trim().length === 0) {
    throw new Error('external-packages-root-unavailable');
  }
  return path.resolve(value);
}

function threeHostRoutes(sessionId: string): readonly { readonly mode: 'local' | 'immersive' | 'collaborative'; readonly path: string }[] {
  return [
    { mode: 'local', path: `/testclaw-local/#/session/${sessionId}` },
    { mode: 'immersive', path: `/immersive/#/session/${sessionId}` },
    { mode: 'collaborative', path: '/testclaw-collaborative' },
  ];
}

function contentType(filePath: string): string {
  if (filePath.endsWith('.html')) {
    return 'text/html; charset=utf-8';
  }
  if (filePath.endsWith('.js')) {
    return 'text/javascript; charset=utf-8';
  }
  if (filePath.endsWith('.css')) {
    return 'text/css; charset=utf-8';
  }
  if (filePath.endsWith('.svg')) {
    return 'image/svg+xml';
  }
  return 'application/octet-stream';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
