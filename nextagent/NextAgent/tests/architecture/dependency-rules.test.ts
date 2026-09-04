import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
const fixtureRoot = join(root, 'tests', 'fixtures', 'architecture');
const depcruiseCli = join(root, 'node_modules', 'dependency-cruiser', 'bin', 'dependency-cruise.mjs');

const expectedRules: Readonly<Record<string, string>> = {
  'forbidden-contract-import': 'no-contract-to-implementation',
  'private-import': 'no-cross-package-private-imports',
  'framework-leakage': 'no-framework-leakage-into-business-packages',
  'provider-sdk-leakage': 'no-provider-sdk-leakage',
  'channel-web-local-auth': 'no-channel-web-to-local-auth',
  'channel-web-gateway-records': 'no-channel-web-to-gateway-records',
  'channel-web-session-owner': 'no-channel-to-lifecycle-owners',
  'channel-web-gateway-adapter': 'no-channel-web-to-gateway-adapter',
  'implementation-package-import': 'no-agent-core-to-implementation-packages',
  'contract-root-aggregate-import': 'no-product-contract-root-aggregate-imports',
  'model-runtime-contract': 'no-agent-model-unauthorized-contract-subpaths',
  'capability-runtime-contract': 'no-agent-capability-unauthorized-contract-subpaths',
  'channel-web-model-contract': 'no-agent-channel-web-unauthorized-contract-subpaths',
  'channel-web-session-contract': 'no-agent-channel-web-unauthorized-contract-subpaths',
  'gateway-local-runtime-contract': 'no-agent-platform-gateway-local-unauthorized-contract-subpaths',
  'agent-assembly-runtime-contract': 'no-agent-assembly-to-runtime-or-wide-contracts',
  'agent-app-config-composition': 'no-agent-app-config-to-composition',
  'unauthorized-local-file-roll-consumer': 'no-unauthorized-local-file-roll-consumers',
  'local-file-roll-reverse-dependency': 'no-local-file-roll-reverse-dependencies',
  'rolling-lifecycle-outside-foundation': 'no-rolling-lifecycle-outside-foundation',
};

function runDepcruise(fixtureName: string): string {
  const result = spawnSync(process.execPath, [depcruiseCli, '--config', '../dependency-cruiser.config.cjs', 'packages', '--output-type', 'err'], {
    cwd: join(fixtureRoot, fixtureName),
    encoding: 'utf8',
  });

  expect(result.error).toBeUndefined();
  expect(result.status).not.toBe(0);
  return `${result.stdout}\n${result.stderr}`;
}

describe('dependency-cruiser architecture rule fixtures', () => {
  const fixtures = readdirSync(fixtureRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name in expectedRules)
    .map((entry) => entry.name)
    .sort();

  it('covers every expected architecture rule fixture', () => {
    expect(fixtures).toEqual(Object.keys(expectedRules).sort());
  });

  for (const fixture of fixtures) {
    it(`rejects ${fixture}`, () => {
      const output = runDepcruise(fixture);

      expect(output).toContain(expectedRules[fixture]);
    }, 15_000);
  }
});
