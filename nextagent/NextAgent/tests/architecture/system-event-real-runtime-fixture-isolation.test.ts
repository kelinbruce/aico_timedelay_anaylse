import { createPluginTestHarness } from '@nextagent/agent-test-kit';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const fixtureRoot = join(repoRoot, 'tests/manual/system-event-real-runtime');
const pluginEntry = join(fixtureRoot, 'config/plugins/system-event-failure/index.js');
const forbiddenFixtureIdentities = [
  'system-event-real-runtime',
  'system-event-failure',
  'system-event-degradation-agent',
  'system-event-context-agent',
];

describe('system event real Runtime fixture isolation', () => {
  it('returns one legal controlled Tool failure', async () => {
    expect(existsSync(pluginEntry)).toBe(true);
    const pluginModule = (await import(`${pathToFileURL(pluginEntry).href}?test=${Date.now()}`)) as {
      default: Parameters<typeof createPluginTestHarness>[0];
    };
    const harness = createPluginTestHarness(pluginModule.default);

    await expect(harness.invokeTool('system-event-failure.tools', 'system_event_failure_probe', {})).resolves.toEqual({
      status: 'FAILED',
      structuredPayload: {},
      generatedMessages: [],
      artifactRefs: [],
      safeError: {
        code: 'SYSTEM_EVENT_SCENARIO_FAILED',
        message: 'The controlled verification Tool failed safely.',
        category: 'INTERNAL',
        retryable: false,
      },
    });
  });

  it('keeps verification identities out of default product assembly and packaging', () => {
    const productionInputs = [
      join(repoRoot, 'packages/agent-app/config'),
      join(repoRoot, 'packages/agent-core/src/builtin-agents'),
      join(repoRoot, 'scripts/pack-local-runtime.mjs'),
      join(repoRoot, 'packages/agent-app/manifests/backend-only.package.json'),
      join(repoRoot, 'packages/agent-app/manifests/local-configured-auth.package.json'),
      join(repoRoot, 'packages/agent-app/manifests/with-frontend.package.json'),
    ];
    const productionText = productionInputs.map(readTextTree).join('\n');

    for (const identity of forbiddenFixtureIdentities) {
      expect(productionText, identity).not.toContain(identity);
    }
  });

  it('does not create a backend or channel HOOK_DEGRADED producer', () => {
    const backendText = [
      join(repoRoot, 'packages/agent-core/src'),
      join(repoRoot, 'packages/agent-runtime/src'),
      join(repoRoot, 'packages/agent-channel-web/src'),
    ]
      .map(readTextTree)
      .join('\n');

    expect(backendText).not.toContain('HOOK_DEGRADED');
  });
});

function readTextTree(path: string): string {
  if (!existsSync(path)) {
    return '';
  }
  if (statSync(path).isFile()) {
    return readFileSync(path, 'utf8');
  }
  return readdirSync(path, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() || ['.cjs', '.js', '.json', '.mjs', '.ts', '.yaml', '.yml'].includes(extname(entry.name)))
    .map((entry) => readTextTree(join(path, entry.name)))
    .join('\n');
}
