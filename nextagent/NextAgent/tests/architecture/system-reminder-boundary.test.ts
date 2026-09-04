import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();

/**
 * Spec anchor: add-ts-system-reminder-memory-v1 / design.md §2
 * Architecture firewall: the system-reminder pipeline lives in
 * `agent-context-engine/src/system-reminder/` and MUST NOT import `agent-runtime`
 * or `agent-app`. It depends only on `agent-contracts` (ModelMessage,
 * SystemReminder) and `agent-common`. This keeps the pipeline reusable and
 * prevents the context-engine from reaching into runtime lifecycle or app
 * composition.
 */
describe('system-reminder pipeline architecture boundary', () => {
  it('agent-context-engine/src/system-reminder does not import agent-runtime or agent-app', () => {
    const dir = join(root, 'packages', 'agent-context-engine', 'src', 'system-reminder');
    expect(existsSync(dir), `${dir} must exist`).toBe(true);
    for (const file of sourceFiles(dir)) {
      const source = readFileSync(file, 'utf8');
      expect(source, file).not.toMatch(/from ["']@nextagent\/agent-runtime["']/u);
      expect(source, file).not.toMatch(/from ["']@nextagent\/agent-app["']/u);
      expect(source, file).not.toMatch(/from ["']\.\.\/\.\.\/agent-runtime/u);
      expect(source, file).not.toMatch(/from ["']\.\.\/\.\.\/agent-app/u);
    }
  });

  it('agent-contracts/src/system-reminder does not import any implementation package', () => {
    const dir = join(root, 'packages', 'agent-contracts', 'src', 'system-reminder');
    expect(existsSync(dir), `${dir} must exist`).toBe(true);
    for (const file of sourceFiles(dir)) {
      const source = readFileSync(file, 'utf8');
      expect(source, file).not.toMatch(
        /from ["']@nextagent\/agent-(runtime|app|context-engine|core|model|capability|channel|session|memory|observability|plugin-sdk|workflow)["']/u,
      );
    }
  });

  it('system-reminder pipeline only depends on agent-contracts and agent-common', () => {
    const dir = join(root, 'packages', 'agent-context-engine', 'src', 'system-reminder');
    const allowed = /@nextagent\/agent-(contracts|common)/u;
    for (const file of sourceFiles(dir)) {
      const source = readFileSync(file, 'utf8');
      const imports = [...source.matchAll(/from ["'](@nextagent\/[^"']+)["']/gu)].map((match) => match[1]!);
      for (const imp of imports) {
        expect(allowed.test(imp), `${file} imports ${imp} which is outside agent-contracts/agent-common`).toBe(true);
      }
    }
  });
});

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? sourceFiles(path) : entry.name.endsWith('.ts') ? [path] : [];
  });
}
