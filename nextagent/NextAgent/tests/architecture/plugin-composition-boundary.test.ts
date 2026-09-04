import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();

describe('plugin composition boundary', () => {
  it('keeps runtime, core, model, channel, and capability out of plugin loading and SDK implementation imports', () => {
    const disallowedPackages = ['agent-runtime', 'agent-core', 'agent-model', 'agent-channel-web', 'agent-capability'];
    const offenders = disallowedPackages.flatMap((packageName) =>
      sourceFiles(join(root, 'packages', packageName, 'src'))
        .filter((file) => {
          const source = readFileSync(file, 'utf8');
          return source.includes('plugin-loader') || source.includes('@nextagent/agent-plugin-sdk');
        })
        .map((file) => relative(root, file).replaceAll('\\', '/')),
    );

    expect(offenders).toEqual([]);
  });

  it('keeps plugin registry consumption inside agent-app composition', () => {
    const files = sourceFiles(join(root, 'packages')).filter((file) => relative(root, file).replaceAll('\\', '/').includes('/src/'));
    const registryConsumers = files
      .filter((file) => {
        const source = readFileSync(file, 'utf8');
        return source.includes('PluginRegistrySnapshot') || source.includes('loadPluginRegistrySnapshot');
      })
      .map((file) => relative(root, file).replaceAll('\\', '/'));

    expect(registryConsumers.sort()).toEqual([
      'packages/agent-app/src/composition/composition-contracts.ts',
      'packages/agent-app/src/composition/plugin-composition.ts',
      'packages/agent-app/src/plugin/plugin-loader.ts',
    ]);
  });

  it('keeps plugin routing policy invocation inside agent-core and plugin runtime composition inside agent-app', () => {
    const appSource = readSources(join(root, 'packages', 'agent-app', 'src'));
    const coreSource = readSources(join(root, 'packages', 'agent-core', 'src'));

    expect(appSource).not.toContain('createPluginBackedAgentRoutingPolicy');
    expect(appSource).not.toContain('createAgentScopedRoutingPolicy');
    expect(appSource).not.toContain('DefaultAgentRoutingPolicy');
    expect(appSource).toContain('policyResolver: pluginPolicyResolver');
    expect(coreSource).toContain('executable.decide(input.run, input.context, input.signal)');
    expect(coreSource).not.toMatch(/AgentRoutingPolicyOperations|selectBoundCapability|AGENT_ROUTING_SELECTION|promptTemplateResolver/u);
  });

  it('keeps plugin API 1.2 runtime services closed and the routing policy contract at three parameters', () => {
    const contractSource = readFileSync(join(root, 'packages', 'agent-contracts', 'src', 'core', 'index.ts'), 'utf8');
    const sdkSource = readFileSync(join(root, 'packages', 'agent-plugin-sdk', 'src', 'index.ts'), 'utf8');
    const servicesBody = sdkSource.match(/export interface PluginRuntimeServices \{(?<body>[\s\S]*?)\n\}/u)?.groups?.body;

    expect(contractSource).toContain('decide: (run: RequestRun, context: RequestContext, signal: AbortSignal)');
    expect(contractSource).not.toMatch(/AgentRoutingPolicyOperations|AgentRoutingSelectionOptions|defaultSelectionTask/u);
    expect(servicesBody).toBeDefined();
    expect(servicesBody).toMatch(/agentAssemblies|capabilityCatalog|capabilityInvocation|modelSelection|modelInvocation|promptTemplates/u);
    expect(servicesBody).not.toMatch(/extensions|execute\s*\(|serviceInventory|apiVersion/u);
    expect(servicesBody).not.toMatch(/^\s*(?:readonly\s+)?\[/mu);
  });

  it('keeps the SDK root independent from the dev-only scaffold subpath', () => {
    const sdkRoot = readFileSync(join(root, 'packages', 'agent-plugin-sdk', 'src', 'index.ts'), 'utf8');
    const packageJson = JSON.parse(readFileSync(join(root, 'packages', 'agent-plugin-sdk', 'package.json'), 'utf8')) as {
      exports: Record<string, unknown>;
    };
    const runtimePackages = ['agent-app', 'agent-runtime', 'agent-core', 'agent-capability', 'agent-model', 'agent-channel-web'];
    const runtimeScaffoldImports = runtimePackages.flatMap((packageName) =>
      sourceFiles(join(root, 'packages', packageName, 'src'))
        .filter((file) => readFileSync(file, 'utf8').includes('@nextagent/agent-plugin-sdk/scaffold'))
        .map((file) => relative(root, file).replaceAll('\\', '/')),
    );

    expect(sdkRoot).not.toMatch(/\.\/scaffold|@nextagent\/agent-plugin-sdk\/scaffold/u);
    expect(Object.keys(packageJson.exports).sort()).toEqual([
      '.',
      './agent-router-plugin',
      './context-monitor',
      './developer-hook-trace',
      './northbound-output-normalization-hook',
      './scaffold',
    ]);
    expect(runtimeScaffoldImports).toEqual([]);
  });

  it('keeps built-in developer diagnostic plugins on the host sink without direct runtime file output', () => {
    const sources = [
      readFileSync(join(root, 'packages', 'agent-plugin-sdk', 'src', 'developer-hook-trace.ts'), 'utf8'),
      readFileSync(join(root, 'packages', 'agent-plugin-sdk', 'src', 'context-monitor.ts'), 'utf8'),
    ];

    for (const source of sources) {
      expect(source).not.toMatch(/appendFileSync|process\.getBuiltinModule/u);
      expect(source).not.toMatch(/readonly logDirectory|readonly logFile/u);
      expect(source).toContain('developerDiagnostics');
      expect(source).toContain('apiVersion: "1.1"');
    }
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

function readSources(dir: string): string {
  return sourceFiles(dir)
    .map((file) => readFileSync(file, 'utf8'))
    .join('\n');
}
