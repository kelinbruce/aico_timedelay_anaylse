import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();

describe('builtin Skill source packaging', () => {
  it('keeps builtin discovery assets reachable from the accepted source or build paths', () => {
    const rootPackage = JSON.parse(read('package.json')) as { scripts?: Record<string, string> };
    const capabilityPackage = JSON.parse(read('packages/agent-capability/package.json')) as { scripts?: Record<string, string> };

    expect(existsSync(join(root, 'scripts', 'copy-builtin-skill-assets.mjs'))).toBe(true);
    expect(rootPackage.scripts?.build).toContain('copy-builtin-skill-assets.mjs');
    expect(capabilityPackage.scripts?.build).toContain('copy-builtin-skill-assets.mjs');
    expect(existsSync(join(root, 'packages', 'agent-capability', 'src', 'builtins', 'skills', 'telecom-domain-qa', 'SKILL.md'))).toBe(false);
    expect(existsSync(join(root, 'packages', 'agent-capability', 'src', 'builtins', 'skills', 'skill-creator', 'SKILL.md'))).toBe(true);
    expect(
      existsSync(join(root, 'packages', 'agent-capability', 'dist', 'builtins', 'skills', 'skill-creator', 'SKILL.md')) ||
        existsSync(join(root, 'packages', 'agent-capability', 'src', 'builtins', 'skills', 'skill-creator', 'SKILL.md')),
    ).toBe(true);
    expect(
      existsSync(join(root, 'packages', 'agent-context-engine', 'dist', 'prompt-templates', 'builtin', 'SYSTEM_PROMPT', 'template.yaml')) ||
        existsSync(join(root, 'packages', 'agent-context-engine', 'prompt-templates', 'builtin', 'SYSTEM_PROMPT', 'template.yaml')),
    ).toBe(true);
  });
});

function read(relativePath: string): string {
  return readFileSync(join(root, relativePath), 'utf8');
}
