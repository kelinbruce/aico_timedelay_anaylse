import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();

interface ArchitecturePolicy {
  readonly implementationPackages: readonly string[];
  readonly contractSubpathAllowlist: Readonly<Record<string, readonly string[]>>;
  readonly nonAppImplementationPackages: readonly string[];
}

const config = require(join(root, 'dependency-cruiser.config.cjs')) as {
  readonly architecturePolicy: ArchitecturePolicy;
  readonly forbidden: ReadonlyArray<{ readonly name: string }>;
};

const policy = config.architecturePolicy;
const ruleNames = new Set(config.forbidden.map((rule) => rule.name));

describe('context-assembly-contracts architecture gates', () => {
  // Task 3.1: runtime must not import context-engine evidence/summary builders.
  it('forbids agent-runtime from importing the context-engine implementation package', () => {
    // The generated implementation firewall denies agent-runtime -> any other implementation package.
    expect(policy.nonAppImplementationPackages).toContain('agent-runtime');
    expect(policy.implementationPackages).toContain('agent-context-engine');
    expect(ruleNames.has('no-agent-runtime-to-implementation-packages')).toBe(true);

    const runtimeSource = sourceText('packages/agent-runtime/src');
    expect(runtimeSource).not.toContain('agent-context-engine');
  });

  // Task 3.2: context-engine must not write runtime checkpoint or canonical timeline facts directly.
  it('allows only the runtime lifecycle hook contract and forbids runtime implementation access', () => {
    expect(ruleNames.has('no-context-engine-to-runtime-or-adapter')).toBe(true);
    expect(policy.contractSubpathAllowlist['agent-context-engine']).toContain('runtime');

    const engineSource = sourceText('packages/agent-context-engine/src');
    expect(engineSource).toContain('agent-contracts/runtime');
    expect(engineSource).not.toMatch(/from\s+['"]@nextagent\/agent-runtime(?:\/|['"])/u);
    expect(engineSource).not.toMatch(/import\s+type\s+\{[^}]*\bAgentRunStatePort\b[^}]*\}\s+from "@nextagent\/agent-contracts\/runtime"/);
    expect(engineSource).not.toMatch(/import\s+type\s+\{[^}]*\bRequestRun\b[^}]*\}\s+from "@nextagent\/agent-contracts\/runtime"/);
    expect(engineSource).not.toContain('saveCheckpoint');
    expect(engineSource).not.toContain('appendEvent');
  });

  // Task 3.3: the new contract DTOs/schema must be consumed via public subpaths, not private paths.
  it('forbids cross-package private imports so new DTOs cross only public subpaths', () => {
    expect(ruleNames.has('no-cross-package-private-imports')).toBe(true);
    expect(ruleNames.has('no-product-contract-root-aggregate-imports')).toBe(true);
  });
});

function sourceText(relativeDir: string): string {
  const { readdirSync } = require('node:fs') as typeof import('node:fs');
  const dir = join(root, relativeDir);
  const files: string[] = [];
  const walk = (current: string): void => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const path = join(current, entry.name);
      if (entry.isDirectory()) {
        walk(path);
      } else if (entry.name.endsWith('.ts')) {
        files.push(path);
      }
    }
  };
  walk(dir);
  return files.map((file) => readFileSync(file, 'utf8')).join('\n');
}
