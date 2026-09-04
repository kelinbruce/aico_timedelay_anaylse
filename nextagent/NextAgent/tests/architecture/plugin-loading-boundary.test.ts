import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();

describe('plugin loading boundary', () => {
  it('keeps plugin bundle evaluation owned by agent-app plugin loader', () => {
    const files = sourceFiles(join(root, 'packages'));
    const pluginBundleEvaluationOwners = files
      .filter((file) => {
        const source = readFileSync(file, 'utf8');
        return source.includes('PluginManifest') && source.includes('evaluateBundleDefaultExport');
      })
      .map((file) => relative(root, file).replaceAll('\\', '/'));

    expect(pluginBundleEvaluationOwners).toEqual(['packages/agent-app/src/plugin/plugin-loader.ts']);
  });

  it('scans the plugin bundle before synchronous evaluation and does not run package managers or plugin node_modules', () => {
    const loader = readFileSync(join(root, 'packages', 'agent-app', 'src', 'plugin', 'plugin-loader.ts'), 'utf8');
    const scanIndex = loader.indexOf('scanBundleImports(source)');
    const evaluationIndex = loader.indexOf('evaluateBundleDefaultExport(source)');

    expect(scanIndex).toBeGreaterThan(-1);
    expect(evaluationIndex).toBeGreaterThan(scanIndex);
    expect(loader).not.toMatch(/\b(?:npm|yarn|pnpm)\b/u);
    expect(loader).not.toContain('node_modules');
  });
});

function sourceFiles(dir: string): readonly string[] {
  const result: string[] = [];
  for (const entry of readdirSync(dir)) {
    const fullPath = join(dir, entry);
    const stat = statSync(fullPath);
    if (stat.isDirectory()) {
      if (entry !== 'dist' && entry !== 'node_modules') {
        result.push(...sourceFiles(fullPath));
      }
      continue;
    }
    if (fullPath.endsWith('.ts') && !fullPath.endsWith('.d.ts')) {
      result.push(fullPath);
    }
  }
  return result;
}
