import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? sourceFiles(path) : entry.name.endsWith('.ts') ? [path] : [];
  });
}

describe('workflow recipe no durable store', () => {
  it('does not introduce RecipeStoreGateway or RecipeRecord anywhere in the codebase', () => {
    const packages = ['agent-contracts', 'agent-core', 'agent-app', 'agent-workflow', 'agent-platform-gateway-local'];
    for (const pkg of packages) {
      const srcDir = join(root, 'packages', pkg, 'src');
      for (const file of sourceFiles(srcDir)) {
        const source = readFileSync(file, 'utf8');
        expect(source).not.toMatch(/RecipeStoreGateway/u);
        expect(source).not.toMatch(/RecipeRecord/u);
      }
    }
  });
});
