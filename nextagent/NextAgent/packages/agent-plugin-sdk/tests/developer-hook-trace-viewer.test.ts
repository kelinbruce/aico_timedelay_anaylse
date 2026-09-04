/// <reference lib="dom" />
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const playwright = loadPlaywright();
const browserExecutable = playwright === undefined ? undefined : resolveBrowserExecutable(playwright);
const viewerPath = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'assets', 'developer-hook-trace-viewer.html');

describe('developer hook trace viewer', () => {
  it('is a self-contained static asset with no network or persistent storage dependencies', () => {
    const viewer = readFileSync(viewerPath, 'utf8');
    expect(viewer).toContain('<title>NextAgent Plugin Trace Viewer</title>');
    expect(viewer).toContain("default-src 'none'");
    expect(viewer).not.toMatch(/https?:\/\//u);
    expect(viewer).not.toMatch(/\b(?:fetch|XMLHttpRequest|WebSocket|EventSource|sendBeacon)\b/u);
    expect(viewer).not.toMatch(/\b(?:localStorage|sessionStorage|indexedDB|caches|serviceWorker)\b/u);
  });

  it.skipIf(browserExecutable === undefined)(
    'renders exact trajectories, stable event order, isolated issues and inert raw JSON from a local file',
    async () => {
      if (playwright === undefined || browserExecutable === undefined) {
        throw new Error('Browser test prerequisites are unavailable.');
      }
      const testDirectory = mkdtempSync(join(tmpdir(), 'nextagent-trace-viewer-'));
      const fixturePath = join(testDirectory, 'trace.ndjson');
      writeFileSync(fixturePath, traceFixture(), 'utf8');

      const browser = await playwright.chromium.launch({ executablePath: browserExecutable });
      try {
        const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
        const pageErrors: string[] = [];
        const importRequests: string[] = [];
        page.on('pageerror', (error) => pageErrors.push(error.message));
        await page.goto(pathToFileURL(viewerPath).href, { waitUntil: 'load', timeout: 15_000 });
        page.on('request', (request) => importRequests.push(request.url()));

        await page.locator('#trace-file').setInputFiles(fixturePath);
        await page.getByText('3 条轨迹 · 4 条问题', { exact: true }).waitFor();

        expect(await page.locator('.trace-option').allTextContents()).toEqual([
          'ab / c4 个事件',
          'a / bc1 个事件',
          'other-session / other-request1 个事件',
        ]);
        expect(await page.locator('.event-card').first().getAttribute('data-line-number')).toBe('3');
        expect(await page.locator('.event-card').allTextContents()).toEqual([
          expect.stringContaining('BEFORE_PLANNING'),
          expect.stringContaining('AFTER_MODEL_RESULT'),
          expect.stringContaining('BEFORE_CAPABILITY_INVOKE'),
          expect.stringContaining('UNKNOWN_STAGE'),
        ]);
        expect(await page.locator('.event-delta').allTextContents()).toEqual(['起点', '+0 ms', '+2,000 ms', '不可用']);
        expect(await page.locator('.event-time').allTextContents()).toEqual([
          '第 3 行 · ' + localTimestampOf('2026-08-05T10:00:01.000Z'),
          '第 4 行 · ' + localTimestampOf('2026-08-05T10:00:01.000Z'),
          '第 1 行 · ' + localTimestampOf('2026-08-05T10:00:03.000Z'),
          '第 5 行 · 时间未知',
        ]);
        expect(await page.locator('.event-core').allTextContents()).toEqual([
          'input_question执行ls -l命令',
          expect.stringContaining('firstContentLatencyMs120 ms'),
          'capabilityIdRead',
        ]);
        const modelResultCore = page.locator('.event-card[data-line-number="4"] .event-core');
        expect(await modelResultCore.locator('.core-label').allTextContents()).toEqual([
          'firstContentLatencyMs',
          'modelE2ELatencyMs',
          'usage',
          'toolCalls',
        ]);
        expect(await modelResultCore.locator('.core-value').allTextContents()).toEqual([
          '120 ms',
          '450 ms',
          expect.stringContaining('"inputTokens": 12'),
          expect.stringContaining('search_memory'),
        ]);
        expect(await modelResultCore.textContent()).toContain('"totalTokens": 20');
        expect(await modelResultCore.textContent()).toContain('USER_CHARACTERISTICS');
        expect(await page.locator('.issue-row').allTextContents()).toEqual([
          '第 6 行INVALID_JSON',
          '第 7 行NOT_OBJECT',
          '第 8 行MISSING_SESSION_ID',
          '第 9 行MISSING_REQUEST_ID',
        ]);

        await page.locator('.event-card details').first().click();
        expect(await page.locator('.event-card pre').first().textContent()).toContain("document.body.dataset.xss='1'");
        expect(await page.locator('.event-card pre').first().textContent()).toContain('"recordedAt": "2026-08-05T10:00:01.000Z"');
        expect(await page.locator('img[src="x"]').count()).toBe(0);
        expect(await page.evaluate(() => document.body.dataset.xss ?? null)).toBeNull();

        await page.getByRole('button', { name: 'a / bc' }).click();
        expect(await page.locator('.event-card').count()).toBe(1);
        expect(await page.locator('.event-card').getAttribute('data-line-number')).toBe('2');
        expect(await page.locator('.core-label').allTextContents()).toEqual(['firstContentLatencyMs', 'modelE2ELatencyMs', 'usage', 'toolCalls']);
        expect(await page.locator('.core-value').allTextContents()).toEqual(['不可用', '不可用', '不可用', '不可用']);

        await page.getByRole('button', { name: 'other-session / other-request' }).click();
        expect(await page.locator('.event-core').count()).toBe(0);
        expect(importRequests).toEqual([]);
        expect(pageErrors).toEqual([]);

        const invalidFixturePath = join(testDirectory, 'invalid.ndjson');
        writeFileSync(invalidFixturePath, '{broken\n[]\n{"sessionId":"s"}\n', 'utf8');
        await page.locator('#trace-file').setInputFiles(invalidFixturePath);
        await page.getByText('无可用轨迹', { exact: true }).waitFor();
        expect(await page.getByText('0 条轨迹 · 3 条问题', { exact: true }).count()).toBe(1);
      } finally {
        await browser.close();
      }
    },
    60_000,
  );
});

function traceFixture(): string {
  const lines = [
    JSON.stringify({
      recordedAt: '2026-08-05T10:00:03.000Z',
      sessionId: 'ab',
      requestId: 'c',
      runId: 'run-1',
      payload: {
        stage: 'BEFORE_CAPABILITY_INVOKE',
        toolCallId: 'tool-1',
        capabilityId: 'Read',
        boundary: { capabilityId: 'Read' },
      },
    }),
    JSON.stringify({ recordedAt: '2026-08-05T10:00:00.000Z', sessionId: 'a', requestId: 'bc', payload: { stage: 'AFTER_MODEL_RESULT' } }),
    JSON.stringify({
      recordedAt: '2026-08-05T10:00:01.000Z',
      sessionId: 'ab',
      requestId: 'c',
      payload: {
        stage: 'BEFORE_PLANNING',
        note: '<img src=x onerror="document.body.dataset.xss=\'1\'">',
        boundary: { flowVariables: { input_question: '执行ls -l命令' } },
      },
    }),
    JSON.stringify({
      recordedAt: '2026-08-05T10:00:01.000Z',
      sessionId: 'ab',
      requestId: 'c',
      payload: {
        stage: 'AFTER_MODEL_RESULT',
        stepId: 'step-1',
        modelId: 'model-1',
        boundary: {
          firstContentLatencyMs: 120,
          modelE2ELatencyMs: 450,
          usage: { inputTokens: 12, totalTokens: 20 },
          toolCalls: [
            {
              toolCallId: 'tool-2',
              toolName: 'search_memory',
              arguments: { categoryFilter: 'USER_CHARACTERISTICS' },
            },
          ],
        },
      },
    }),
    JSON.stringify({ recordedAt: 'not-a-time', sessionId: 'ab', requestId: 'c', payload: {} }),
    '{broken',
    '[]',
    JSON.stringify({ requestId: 'missing-session' }),
    JSON.stringify({ sessionId: 'missing-request' }),
    JSON.stringify({ recordedAt: '2026-08-05T10:00:04.000Z', sessionId: 'other-session', requestId: 'other-request', stage: 'TERMINAL' }),
    '',
  ];
  return `${lines.join('\n')}\n`;
}

function localTimestampOf(iso: string): string {
  const date = new Date(iso);
  const p = (num: number, width: number) => String(num).padStart(width, '0');
  return `${date.getFullYear()}-${p(date.getMonth() + 1, 2)}-${p(date.getDate(), 2)} ${p(date.getHours(), 2)}:${p(date.getMinutes(), 2)}:${p(date.getSeconds(), 2)}.${p(date.getMilliseconds(), 3)}`;
}

function loadPlaywright(): PlaywrightModule | undefined {
  try {
    return require('playwright') as PlaywrightModule;
  } catch {
    return undefined;
  }
}

function resolveBrowserExecutable(module: PlaywrightModule): string | undefined {
  const candidates = [
    module.chromium.executablePath(),
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    '/usr/bin/google-chrome',
    '/usr/bin/microsoft-edge',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
  ];
  return candidates.find((candidate) => existsSync(candidate));
}

interface PlaywrightModule {
  readonly chromium: {
    executablePath: () => string;
    launch: (options: { readonly executablePath: string }) => Promise<BrowserLike>;
  };
}

interface BrowserLike {
  newPage: (options: { readonly viewport: { readonly width: number; readonly height: number } }) => Promise<PageLike>;
  close: () => Promise<void>;
}

interface PageLike {
  on: ((event: 'pageerror', handler: (error: Error) => void) => void) & ((event: 'request', handler: (request: RequestLike) => void) => void);
  goto: (url: string, options: { readonly waitUntil: 'load'; readonly timeout: number }) => Promise<unknown>;
  locator: (selector: string) => LocatorLike;
  getByText: (text: string, options: { readonly exact: boolean }) => LocatorLike;
  getByRole: (role: string, options: { readonly name: string }) => LocatorLike;
  evaluate: <T>(script: () => T) => Promise<T>;
}

interface LocatorLike {
  locator: (selector: string) => LocatorLike;
  waitFor: () => Promise<void>;
  setInputFiles: (path: string) => Promise<void>;
  allTextContents: () => Promise<string[]>;
  textContent: () => Promise<string | null>;
  getAttribute: (name: string) => Promise<string | null>;
  count: () => Promise<number>;
  click: () => Promise<void>;
  first: () => LocatorLike;
}

interface RequestLike {
  url: () => string;
}
