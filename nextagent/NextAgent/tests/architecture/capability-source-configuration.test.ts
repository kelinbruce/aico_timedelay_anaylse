import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();

describe('capability source configuration architecture', () => {
  it('keeps startup source artifacts app-owned and out of frozen public contracts', () => {
    const capabilityContracts = readFileSync(join(root, 'packages', 'agent-contracts', 'src', 'capability', 'index.ts'), 'utf8');

    expect(capabilityContracts).not.toContain('FrozenCapabilitySourceConfig');
    expect(capabilityContracts).not.toContain('CapabilitySourceDiagnostic');
  });

  it('prevents downstream packages from interpreting raw source configuration', () => {
    for (const packageName of ['agent-runtime', 'agent-core', 'agent-context-engine', 'agent-channel-web', 'agent-model']) {
      const source = readTypeScriptSources(join(root, 'packages', packageName, 'src'));
      expect(source).not.toContain('capability-providers');
      expect(source).not.toContain('CapabilitySourceConfig');
    }
  });

  it('does not expose a final provider-config override that bypasses startup freeze', () => {
    const composition = readFileSync(join(root, 'packages', 'agent-app', 'src', 'composition', 'capability-composition.ts'), 'utf8');

    expect(composition).not.toContain('capabilityProviderConfigs?:');
    expect(composition).not.toContain('capabilityProviderConfigs ??');
    expect(composition).toContain('capabilityProviders.providers');
  });

  it('keeps capability contribution assembly inside agent-capability and app composition', () => {
    const appComposition = readFileSync(join(root, 'packages', 'agent-app', 'src', 'composition', 'create-app.ts'), 'utf8');
    const capabilityComposition = readFileSync(join(root, 'packages', 'agent-app', 'src', 'composition', 'capability-composition.ts'), 'utf8');
    const memoryComposition = readFileSync(join(root, 'packages', 'agent-app', 'src', 'composition', 'memory-maintenance-composition.ts'), 'utf8');
    const registry = readFileSync(join(root, 'packages', 'agent-app', 'src', 'assembly', 'resource-provider-registry.ts'), 'utf8');

    expect(`${appComposition}\n${capabilityComposition}\n${memoryComposition}`).not.toMatch(
      /CapabilityDiscoveryFactory|discoveryFactory|appToolCatalogs/u,
    );
    expect(memoryComposition).toContain('createMemoryToolsProvider');
    expect(capabilityComposition).toContain('externalProviders');
    expect(capabilityComposition).toContain('createStartupResourceProviderRegistry(subsystem.capabilityProviders)');
    expect(capabilityComposition).toContain('validateStartupAgentAssemblyGraph');
    expect(appComposition).toContain('resourceReferences');
    expect(`${appComposition}\n${capabilityComposition}`).not.toContain('resourceInventory');
    expect(capabilityComposition).not.toContain('capabilitySubsystem.resourceProviders');
    expect(capabilityComposition).not.toContain('createCapabilityResourceProviders');
    expect(capabilityComposition).not.toContain('builtinToolsProvider');
    expect(capabilityComposition).not.toContain('builtinSkillsProvider');
    expect(capabilityComposition).not.toContain('builtinAgentsProvider');
    expect(capabilityComposition).not.toContain('localAgentsProvider');
    expect(capabilityComposition).not.toContain('localSubagentsProvider');
    expect(capabilityComposition).not.toContain('localSkillsSystemProvider');
    expect(capabilityComposition).not.toContain('localSkillsAgentOwnedProvider');
    expect(appComposition).not.toMatch(/\bmemoryToolsProvider\b/u);
    expect(`${appComposition}\n${capabilityComposition}\n${memoryComposition}`).not.toContain('WorkspaceFilePort');
    expect(`${appComposition}\n${capabilityComposition}\n${memoryComposition}`).not.toContain('createWorkspaceFilePort');
    expect(`${appComposition}\n${capabilityComposition}\n${memoryComposition}`).not.toContain('.clearRun(');
    expect(`${appComposition}\n${capabilityComposition}\n${memoryComposition}`).not.toContain('.sandboxFilesystem(');
    expect(`${appComposition}\n${capabilityComposition}\n${memoryComposition}`).not.toContain('.resolveView(');
    expect(`${appComposition}\n${capabilityComposition}\n${memoryComposition}`).not.toContain('createPythonSandboxSubmission');

    expect(registry).not.toMatch(/builtin-tools|builtin-skills|local-skills|memory-tools/u);
    expect(registry).toContain('capabilityProviders');
  });

  it('prevents runtime and orchestration packages from importing capability contribution implementation', () => {
    for (const packageName of ['agent-runtime', 'agent-core', 'agent-context-engine']) {
      const source = readTypeScriptSources(join(root, 'packages', packageName, 'src'));
      expect(source).not.toMatch(/@nextagent\/agent-capability|CapabilityProvider|extension-registration/u);
    }
  });

  it('keeps agent-memory owner contribution decoupled from agent-capability implementation package', () => {
    const memoryPackage = JSON.parse(readFileSync(join(root, 'packages', 'agent-memory', 'package.json'), 'utf8')) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    const memorySources = readTypeScriptSources(join(root, 'packages', 'agent-memory', 'src'));
    const memoryTests = readTypeScriptSources(join(root, 'packages', 'agent-memory', 'tests'));
    const memoryReadme = readFileSync(join(root, 'packages', 'agent-memory', 'README.md'), 'utf8');
    const memoryTsconfig = readFileSync(join(root, 'packages', 'agent-memory', 'tsconfig.json'), 'utf8');

    expect(memoryPackage.dependencies ?? {}).not.toHaveProperty('@nextagent/agent-capability');
    expect(memoryPackage.devDependencies ?? {}).not.toHaveProperty('@nextagent/agent-capability');
    expect(memorySources).not.toContain('@nextagent/agent-capability');
    expect(memoryTests).not.toContain('@nextagent/agent-capability');
    expect(memoryReadme).not.toContain('agent-capability');
    expect(memoryTsconfig).not.toContain('../agent-capability');
  });

  it('exports extension registration diagnostics without publishing registration assembly', () => {
    const publicIndex = readFileSync(join(root, 'packages', 'agent-capability', 'src', 'index.ts'), 'utf8');

    expect(publicIndex).toMatch(
      /export type \{ ExtensionRegistrationDiagnostic,\s*ExtensionRegistrationDiagnosticReasonCode \} from '\.\/extension-registration\.js';/u,
    );
    expect(publicIndex).not.toContain('export * from "./extension-registration.js";');
    expect(publicIndex).not.toContain('assembleCapabilityProviders');
  });

  it('keeps provider contribution construction behind explicit owner-local helpers', () => {
    const subsystem = readFileSync(join(root, 'packages', 'agent-capability', 'src', 'subsystem.ts'), 'utf8');

    for (const helperName of [
      'createBuiltinToolsProvider',
      'createBuiltinSkillsProvider',
      'createBuiltinAgentsProvider',
      'createLocalSkillProviders',
      'createLocalAgentProviders',
      'createConfigDrivenProviders',
    ]) {
      expect(subsystem).toContain(`function ${helperName}`);
    }
    expect(subsystem).toContain('createInternalProviders');
    expect(subsystem).toContain('capabilityProviders');
    expect(subsystem).toContain('runLifecycle');
    expect(subsystem).not.toContain('extensionRegistrationDiagnostics');
    expect(subsystem).not.toContain('readonly workspaceFiles');
  });

  it('keeps CLIP-backed tools behind injected runner and existing sandbox executable vocabulary', () => {
    const capabilitySources = readTypeScriptSources(join(root, 'packages', 'agent-capability', 'src'));
    const gatewayContracts = readFileSync(join(root, 'packages', 'agent-contracts', 'src', 'gateway', 'index.ts'), 'utf8');

    expect(capabilitySources).not.toContain('@nextagent/agent-platform-gateway-local');
    expect(capabilitySources).not.toContain('node:child_process');
    expect(capabilitySources).not.toContain('execFile');
    expect(capabilitySources).not.toContain('spawn(');
    expect(gatewayContracts).toContain("readonly executable: 'bash' | 'python';");
    expect(gatewayContracts).not.toContain("'clipc'");
  });
});

function readTypeScriptSources(directory: string): string {
  return readdirSync(directory)
    .flatMap((entry) => {
      const path = join(directory, entry);
      if (statSync(path).isDirectory()) {
        return readTypeScriptSources(path);
      }
      return path.endsWith('.ts') ? [readFileSync(path, 'utf8')] : [];
    })
    .join('\n');
}
