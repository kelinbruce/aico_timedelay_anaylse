import { defineConfig } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import os from 'node:os';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');
const outputDir = path.resolve(projectRoot, 'test-output');

// Use 50% of CPU cores for E2E workers (minimum 1, maximum 4)
const cpuCount = os.cpus().length;
const workers = Math.min(4, Math.max(1, Math.floor(cpuCount * 0.5)));

export default defineConfig({
  testDir: path.resolve(__dirname, 'suites'),
  testIgnore: ['backend/**', 'add-ts-contract-test-gate/**', '**/*.test.ts'],
  fullyParallel: true,
  timeout: 120_000,
  globalTimeout: 3_600_000,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers,
  outputDir: path.resolve(outputDir, 'playwright-failures'),
  reporter: [
    ['list'],
    ['html', { open: 'never', outputFolder: path.resolve(outputDir, 'playwright-report') }],
    ['json', { outputFile: path.resolve(outputDir, 'playwright-results.json') }],
  ],
  use: {
    baseURL: 'http://127.0.0.1:3000',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'off',
    actiontimeout: 120_000,
    navigationTimeout: 120_000,
  },
  projects: [
    {
      name: 'chromium',
      use: { channel: 'msedge' },
    },
  ],
});
