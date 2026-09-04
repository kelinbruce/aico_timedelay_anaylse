import { access, readFile } from 'node:fs/promises';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { requiredCandidateRoot, startCandidateHarness } from '../../helpers/candidate-harness.js';
import { writePassingCaseEvidence } from '../../helpers/case-evidence.js';
import { hashDirectoryTree } from '../../helpers/external-consumer-root.js';
import { withRunScope } from '../../helpers/run-scope.js';

describe('TC-SI-034 with-frontend route precedence', () => {
  it('serves SPA fallbacks while preserving backend and extension route ownership', async () => {
    const candidateRoot = requiredCandidateRoot();
    const candidateHashBefore = await hashDirectoryTree(candidateRoot);
    const manifest: unknown = JSON.parse(await readFile(path.join(candidateRoot, 'candidate-manifest.json'), 'utf8'));
    if (!isObject(manifest)) {
      throw new Error('candidate-manifest-invalid');
    }
    expect(manifest.packageProfile).toBe('with-frontend');
    await Promise.all([
      access(path.join(candidateRoot, 'node_modules', '@nextagent', 'agent-web', 'hosting.js')),
      access(path.join(candidateRoot, 'node_modules', '@nextagent', 'agent-web', 'hosting-manifest.json')),
      access(path.join(candidateRoot, 'node_modules', '@nextagent', 'agent-web', 'dist', 'index.html')),
    ]);

    await withRunScope(
      {
        outputBase: process.env.TESTCLAW_SYSTEM_INTEGRATION_OUTPUT_ROOT,
      },
      async (scope) => {
        const harness = await startCandidateHarness({
          scope,
          candidateRoot,
          modelAnswer: 'unused-frontend-answer',
        });

        const home = await fetch(`${harness.baseUrl}/`);
        expect(home.status).toBe(200);
        expect(home.headers.get('content-type')).toContain('text/html');
        const homeHtml = await home.text();
        expect(homeHtml.toLowerCase()).toContain('<!doctype html');

        const fallback = await fetch(`${harness.baseUrl}/telecom/ran/overview`);
        expect(fallback.status).toBe(200);
        expect(fallback.headers.get('content-type')).toContain('text/html');
        expect(await fallback.text()).toBe(homeHtml);

        const preludeLoader = await fetch(`${harness.baseUrl}/febs/v1/assets/prelude-loader`);
        expect(preludeLoader.status).toBe(200);
        expect(preludeLoader.headers.get('content-type')).toContain('text/javascript');
        const preludeSource = await preludeLoader.text();
        expect(preludeSource).toContain('window.Prel');
        expect(preludeSource).toContain('/piu/AIAgentPIU.js');
        expect(preludeSource.toLowerCase()).not.toContain('<!doctype html');

        const api = await fetch(`${harness.baseUrl}/api/v1/sessions`);
        expect(api.status).toBe(200);
        expect(api.headers.get('content-type')).toContain('application/json');
        const apiBody: unknown = await api.json();
        expect(isObject(apiBody) && Array.isArray(apiBody.entries)).toBe(true);

        const missingApi = await fetch(`${harness.baseUrl}/api/v1/unknown`);
        expect(missingApi.status).toBe(404);
        expect(missingApi.headers.get('content-type')).toContain('application/json');
        expect((await missingApi.text()).toLowerCase()).not.toContain('<!doctype html');
        expect(harness.modelInvocationCount()).toBe(0);

        await writePassingCaseEvidence({
          evidenceRoot: scope.evidenceRoot,
          caseId: 'TC-SI-034',
          observations: {
            withFrontendProfileDeclared: true,
            spaHomeServed: true,
            spaFallbackServed: true,
            extensionPreludeOwned: true,
            backendApiPrecedencePreserved: true,
            unknownApiDidNotFallBackToSpa: true,
          },
          canaries: [
            { category: 'model-output', value: 'unused-frontend-answer' },
            { category: 'credential', value: 'testclaw-loopback-key' },
            { category: 'absolute-path', value: candidateRoot },
          ],
        });
      },
    );

    expect(await hashDirectoryTree(candidateRoot)).toBe(candidateHashBefore);
  }, 120_000);
});

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
