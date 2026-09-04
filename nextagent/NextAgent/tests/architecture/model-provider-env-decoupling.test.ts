import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, sep } from 'node:path';
import { describe, expect, it } from 'vitest';
import { load as parseYaml } from 'js-yaml';

const root = process.cwd();
const packagesRoot = join(root, 'packages');
const configRoot = join(packagesRoot, 'agent-app', 'config');
const defaultConfigPath = join(configRoot, 'default-system.yaml');

function walkFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const fullPath = join(dir, entry);
    return statSync(fullPath).isDirectory() ? walkFiles(fullPath) : [fullPath];
  });
}

describe('model provider environment decoupling', () => {
  it('keeps model provider access configuration decoupled from OpenAI-specific environment names', () => {
    const defaultConfig = parseYaml(readFileSync(defaultConfigPath, 'utf8')) as { modelProfiles?: Array<Record<string, unknown>> };
    const provider = defaultConfig.modelProfiles?.find((profile) => profile.providerId === 'openai-compatible');
    expect(provider).toBeDefined();
    expect(provider).not.toHaveProperty('baseUrl');
    expect(provider).not.toHaveProperty('credentialRef');
    expect(provider?.models).toEqual([expect.objectContaining({ modelId: 'env:OPENAI_MODEL_NAME' })]);

    const sourceFiles = walkFiles(packagesRoot)
      .filter((file) => file.endsWith('.ts') || (file.startsWith(configRoot) && file.endsWith('.yaml')))
      .filter((file) => !file.includes(`${sep}tests${sep}`))
      .filter((file) => !file.includes(`${sep}dist${sep}`));
    const forbidden = ['OPENAI_API_KEY', 'OPENAI_BASE_URL'];

    expect(sourceFiles.length).toBeGreaterThan(0);
    for (const file of sourceFiles) {
      const sourceText = readFileSync(file, 'utf8');
      for (const envName of forbidden) {
        expect(sourceText, `${file} contains ${envName}`).not.toContain(envName);
      }
    }
  });
});
