import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import { createPluginScaffold } from '../src/scaffold/index.js';

describe('plugin scaffold', () => {
  it('creates a direct-bundle plugin project without activation side effects', () => {
    const root = mkdtempSync(join(tmpdir(), 'nextagent-plugin-scaffold-'));
    const target = join(root, 'telecom-diagnostics');

    const result = createPluginScaffold({ targetDirectory: target });

    expect(result).toMatchObject({ pluginId: 'telecom-diagnostics' });
    for (const file of ['package.json', 'tsconfig.json', 'esbuild.config.ts', 'src/index.ts', 'plugin.json', 'tests/plugin.test.ts', 'README.md']) {
      expect(existsSync(join(target, file)), file).toBe(true);
    }
    const packageJson = JSON.parse(readFileSync(join(target, 'package.json'), 'utf8')) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
      scripts?: Record<string, string>;
    };
    const pluginJson = JSON.parse(readFileSync(join(target, 'plugin.json'), 'utf8')) as {
      pluginId?: string;
      main?: string;
      artifactType?: string;
      hostExternals?: unknown[];
    };
    expect(packageJson.dependencies).toHaveProperty('@nextagent/agent-plugin-sdk');
    expect(packageJson.devDependencies).toMatchObject({ esbuild: expect.any(String), typescript: expect.any(String), vitest: expect.any(String) });
    expect(packageJson.scripts).toMatchObject({ build: expect.stringContaining('esbuild.config.ts'), test: expect.stringContaining('vitest') });
    expect(readFileSync(join(target, 'esbuild.config.ts'), 'utf8')).toMatch(/bundle: true[\s\S]*format: "esm"[\s\S]*sourcemap: "inline"/u);
    expect(readFileSync(join(target, 'src/index.ts'), 'utf8')).toContain('definePlugin({');
    expect(readFileSync(join(target, 'src/index.ts'), 'utf8')).not.toContain('definePluginFactory');
    expect(pluginJson).toMatchObject({
      pluginId: 'telecom-diagnostics',
      main: './dist/index.js',
      artifactType: 'esm-bundle',
      hostExternals: [],
    });
    expect(readFileSync(join(target, 'tests/plugin.test.ts'), 'utf8')).toContain('getPluginMetadata');
    expect(readFileSync(join(target, 'README.md'), 'utf8')).toContain('configRoot/plugins/telecom-diagnostics/');
    const generatedSources = ['package.json', 'src/index.ts', 'plugin.json', 'tests/plugin.test.ts', 'README.md']
      .map((file) => readFileSync(join(target, file), 'utf8'))
      .join('\n');
    expect(generatedSources).not.toMatch(/capabilityBindings|AgentAssembly|system config entry|plugins\[\]|runtime registry/u);
    expect(readFileSync(join(target, 'src/index.ts'), 'utf8')).not.toContain('hostExternals');
  });

  it('fails closed for existing, unsafe, or parent-traversal targets', () => {
    const root = mkdtempSync(join(tmpdir(), 'nextagent-plugin-scaffold-'));
    const target = join(root, 'telecom-diagnostics');
    createPluginScaffold({ targetDirectory: target });

    expect(() => createPluginScaffold({ targetDirectory: target })).toThrow('already exists');
    expect(() => createPluginScaffold({ targetDirectory: join(root, 'Bad Name') })).toThrow('safe plugin id');
    expect(() => createPluginScaffold({ targetDirectory: `${root}\\..\\escape` })).toThrow('parent traversal');
  });
});
