import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { validateIndependentTestSource } from './helpers/independence.js';

describe('system integration suite independence', () => {
  it.each([
    ['import value from "../../../../packages/agent-core/src/private.js";', 'source private import'],
    ['import { createApp } from "@nextagent/agent-app/testing";', 'testing subpath'],
    ['const report = readFileSync("test-output/source-vitest-results.json");', 'source report'],
    ['page.route("**/api/v1/sessions", route => route.fulfill({ body: "{}" }));', 'mock route'],
    ['test.skip("activated case", async () => {});', 'skipped case'],
    ['it.todo("activated case");', 'todo case'],
  ])('rejects %s', (source, _label) => {
    expect(() => validateIndependentTestSource(source)).toThrow();
  });

  it('accepts public candidate HTTP and packed package imports', () => {
    expect(() =>
      validateIndependentTestSource(`
        import { createRemoteGateway } from "@nextagent/agent-platform-gateway-remote";
        const response = await fetch("http://127.0.0.1:3000/api/v1/sessions");
        void createRemoteGateway;
        void response;
      `),
    ).not.toThrow();
  });

  it('keeps the standard runner independent from source-sync and source workspaces', async () => {
    const runnerSource = await readFile(new URL('../../../scripts/run-system-integration-gate.mjs', import.meta.url), 'utf8');

    expect(runnerSource).not.toMatch(/source-sync|source-manifests|(?:^|["'])\.\.\/.*(?:packages|frontend|tests\/e2e)\//);
  });
});
