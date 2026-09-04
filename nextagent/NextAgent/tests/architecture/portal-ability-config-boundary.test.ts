import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = join(process.cwd());
const rawConfigKey = 'portal-ability-config';
const crossPackagePrivateImportPattern = /(?:from\s+['"]|import\(\s*['"])packages\/[^/]+\/src/u;

describe('portal ability configuration architecture boundary', () => {
  it('keeps raw Agent package config parsing in agent-app only', () => {
    const backendPackages = readdirSync(join(root, 'packages'), { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .filter((packageName) => packageName !== 'agent-app');

    for (const packageName of backendPackages) {
      const source = readAllSource(join(root, 'packages', packageName, 'src'));
      expect(source, `${packageName} must not parse raw portal ability config`).not.toContain(rawConfigKey);
    }

    const appSource = readAllSource(join(root, 'packages', 'agent-app', 'src'));
    expect(appSource).toContain(rawConfigKey);
  });

  it('keeps runtime and channel-web away from the raw Agent package config file', () => {
    const runtimeSource = readAllSource(join(root, 'packages', 'agent-runtime', 'src'));
    const channelWebSource = readAllSource(join(root, 'packages', 'agent-channel-web', 'src'));

    expect(runtimeSource).not.toContain('config.json');
    expect(runtimeSource).not.toContain(rawConfigKey);
    expect(channelWebSource).not.toContain('config/config.json');
    expect(channelWebSource).not.toContain(rawConfigKey);
  });

  it('keeps the browser frontend on the public bootstrap DTO', () => {
    const frontendSource = readAllSource(join(root, 'frontend', 'agent-web', 'src'));

    expect(frontendSource).not.toContain(rawConfigKey);
    expect(frontendSource).not.toContain("from '@nextagent/agent-app'");
    expect(frontendSource).not.toContain("from '@nextagent/agent-channel-web'");
    expect(frontendSource).not.toContain("from '@nextagent/agent-attachment-runtime'");
    expect(frontendSource).toContain('portalAbilityConfig');
  });

  it('does not introduce cross-package private path imports in touched product files', () => {
    const touchedFiles = [
      'packages/agent-app/src/config/portal-ability-config.ts',
      'packages/agent-app/src/composition/portal-ability-composition.ts',
      'packages/agent-channel-web/src/schemas/runtime-bootstrap.ts',
      'packages/agent-runtime/src/lifecycle/agent-run-state-port.ts',
      'frontend/agent-web/src/config/runtimeConfig.ts',
      'frontend/agent-web/src/features/suggested-questions/components/SuggestedQuestions.tsx',
    ];

    for (const relativePath of touchedFiles) {
      const source = readFileSync(join(root, relativePath), 'utf8');
      expect(source, `${relativePath} must use public package exports`).not.toMatch(crossPackagePrivateImportPattern);
    }
  });
});

function readAllSource(directory: string): string {
  const chunks: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      chunks.push(readAllSource(path));
    } else if (entry.isFile() && /\.(ts|tsx)$/u.test(entry.name)) {
      chunks.push(readFileSync(path, 'utf8'));
    }
  }
  return chunks.join('\n');
}
