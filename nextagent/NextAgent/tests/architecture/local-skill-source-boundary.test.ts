import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();

describe('local Skill source architecture boundary', () => {
  it('keeps runtime, core, and context engine away from local source scanning and manifest parsing', () => {
    for (const packageName of ['agent-runtime', 'agent-core', 'agent-context-engine']) {
      const source = readPackageSource(packageName);

      expect(source).not.toContain('local/skill-discovery');
      expect(source).not.toContain('LocalSkillDiscovery');
      expect(source).not.toContain('AgentPackageSourceLocator');
      expect(source).not.toContain('parseSkillFrontmatter');
      expect(source).not.toContain('readSkillFrontmatterSourceFromFile');
      expect(source).not.toContain('SKILL.md');
      expect(source).not.toContain('workspaceDir/skills');
    }
  });

  it('keeps runtime, core, and context engine away from subagent source scanning and locator implementation', () => {
    for (const packageName of ['agent-runtime', 'agent-core', 'agent-context-engine']) {
      const source = readPackageSource(packageName);

      expect(source).not.toContain('LocalAgentCapabilityDiscovery');
      expect(source).not.toContain('listSubagentPackages');
      expect(source).not.toContain('locateSubagentPackage');
      expect(source).not.toContain('local-agents-parent-owned');
      expect(source).not.toContain('subagents/');
      expect(source).not.toContain('workspaceDir/subagents');
    }
  });

  it('keeps Agent package locator contracts out of Skill discovery implementation', () => {
    const skillDiscoverySource = readFileSync(join(root, 'packages', 'agent-capability', 'src', 'local', 'skill-discovery.ts'), 'utf8');
    const publicIndex = readFileSync(join(root, 'packages', 'agent-capability', 'src', 'index.ts'), 'utf8');
    const executorSource = readFileSync(join(root, 'packages', 'agent-capability', 'src', 'execution', 'executor.ts'), 'utf8');

    expect(skillDiscoverySource).not.toContain('listSubagentPackages');
    expect(skillDiscoverySource).not.toContain('LocalAgentPackageCandidate');
    expect(skillDiscoverySource).not.toContain('LocalAgentPackageDiagnostic');
    expect(publicIndex).not.toContain('createAgentCapabilityExecutorFactoryForTesting');
    expect(executorSource).not.toContain('createAgentCapabilityExecutorFactoryForTesting');
  });
});

function readPackageSource(packageName: string): string {
  return readTypeScriptFiles(join(root, 'packages', packageName, 'src')).join('\n');
}

function readTypeScriptFiles(dir: string): string[] {
  const sources: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      sources.push(...readTypeScriptFiles(path));
    } else if (entry.name.endsWith('.ts')) {
      sources.push(readFileSync(path, 'utf8'));
    }
  }
  return sources;
}
