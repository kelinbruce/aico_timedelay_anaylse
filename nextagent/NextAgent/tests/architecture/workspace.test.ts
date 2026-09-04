import { readFileSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
const require = createRequire(import.meta.url);
const dependencyCruiserConfig = require('../../dependency-cruiser.config.cjs') as {
  architecturePolicy: {
    implementationPackages: readonly string[];
    contractSubpathAllowlist: Record<string, readonly string[]>;
    agentAppCompositionContractSubpaths: readonly string[];
    nonAppImplementationPackages: readonly string[];
  };
  forbidden: ReadonlyArray<{ name: string }>;
};
const manifestPolicy = require('./package-manifest-policy.cjs') as {
  findManifestViolations: (workspaceRoot?: string) => Array<{ packageName: string; dependencyName: string; manifestPath: string }>;
};

const forbiddenCreateAppCompositionFragments = [
  'createObservationEvent(',
  'diagnosticObserver:',
  'auditObserver:',
  'createAttachmentIntakeRuntime',
  'createAttachmentCleanupRuntime',
  'createAttachmentLifecycleDiagnostics',
  'createHealthEvaluator',
  'createObservedHealthEvaluator',
  'createLongTermMemoryToolPort',
  'isProviderAdapterRegistered',
  'createModelProviderHealthProbe',
] as const;

const allowedNamedCompositionFragments: ReadonlyArray<{
  readonly file: string;
  readonly fragment: (typeof forbiddenCreateAppCompositionFragments)[number];
  readonly owner: string;
  readonly reason: string;
}> = [
  {
    file: 'packages/agent-app/src/composition/attachment-composition.ts',
    fragment: 'createAttachmentIntakeRuntime',
    owner: 'agent-attachment-runtime',
    reason: 'composition wires the owner runtime factory returned by the attachment package',
  },
  {
    file: 'packages/agent-app/src/composition/attachment-composition.ts',
    fragment: 'createAttachmentCleanupRuntime',
    owner: 'agent-attachment-runtime',
    reason: 'composition wires the owner cleanup factory returned by the attachment package',
  },
  {
    file: 'packages/agent-app/src/composition/attachment-composition.ts',
    fragment: 'createAttachmentLifecycleDiagnostics',
    owner: 'agent-attachment-runtime',
    reason: 'composition injects the owner lifecycle diagnostics factory without reshaping attachment events',
  },
  {
    file: 'packages/agent-app/src/composition/capability-composition.ts',
    fragment: 'isProviderAdapterRegistered',
    owner: 'agent-capability',
    reason: 'composition adapts registered provider types into the capability owner factory',
  },
  {
    file: 'packages/agent-app/src/composition/gateway-composition.ts',
    fragment: 'diagnosticObserver:',
    owner: 'agent-memory',
    reason: 'composition passes the memory-owned disabled gateway diagnostic observer into gateway wiring',
  },
  {
    file: 'packages/agent-app/src/composition/health-composition.ts',
    fragment: 'createHealthEvaluator',
    owner: 'agent-observability',
    reason: 'composition wires the observability-owned health evaluator',
  },
  {
    file: 'packages/agent-app/src/composition/health-composition.ts',
    fragment: 'createObservedHealthEvaluator',
    owner: 'agent-observability',
    reason: 'composition wires the observability-owned observed health evaluator',
  },
  {
    file: 'packages/agent-app/src/composition/health-composition.ts',
    fragment: 'createModelProviderHealthProbe',
    owner: 'agent-model',
    reason: 'composition wires the model-owned health probe factory',
  },
  {
    file: 'packages/agent-app/src/composition/memory-maintenance-composition.ts',
    fragment: 'createLongTermMemoryToolPort',
    owner: 'agent-memory',
    reason: 'composition wires the memory-owned tool port factory',
  },
  {
    file: 'packages/agent-app/src/composition/memory-maintenance-composition.ts',
    fragment: 'diagnosticObserver:',
    owner: 'agent-memory',
    reason: 'composition adapts memory-owned lifecycle diagnostics to the injected projector host',
  },
  {
    file: 'packages/agent-app/src/composition/memory-maintenance-composition.ts',
    fragment: 'auditObserver:',
    owner: 'agent-memory',
    reason: 'composition adapts memory-owned audit diagnostics to the injected gateway audit store',
  },
] as const;

function composeNextAgentAppBody(source: string): string {
  const signatureIndex = source.indexOf('function composeNextAgentApp(');
  expect(signatureIndex).toBeGreaterThanOrEqual(0);
  const bodyStart = source.indexOf('{', signatureIndex);
  expect(bodyStart).toBeGreaterThanOrEqual(0);
  let depth = 0;
  for (let index = bodyStart; index < source.length; index += 1) {
    const char = source[index];
    if (char === '{') {
      depth += 1;
    } else if (char === '}') {
      depth -= 1;
      if (depth === 0) {
        return source.slice(bodyStart + 1, index);
      }
    }
  }
  throw new Error('composeNextAgentApp function body was not closed.');
}

function letDeclarationCount(source: string): number {
  return source.match(/\blet\s+/gu)?.length ?? 0;
}

function assertBoundedCreateAppCompositionSource(appSource: string, deferredSource: string): void {
  for (const fragment of forbiddenCreateAppCompositionFragments) {
    expect(appSource).not.toContain(fragment);
  }
  const body = composeNextAgentAppBody(appSource);
  expect(letDeclarationCount(body)).toBeLessThanOrEqual(letDeclarationCount(deferredSource));
  expect(body.match(/\bcompose[A-Z]\w+\(/gu)?.length ?? 0).toBeGreaterThanOrEqual(14);
  expect(body.match(/\bdeferredBindings\.bind/gu)?.length ?? 0).toBeLessThanOrEqual(6);
  expect(body.match(/\breturn\s+\{/gu)?.length ?? 0).toBe(1);
  expect(body).not.toMatch(/\bfunction\s+\w+/u);
  expect(body).not.toContain('CreateComposedAppOptions');
  expect(body).not.toMatch(/failureScope\.(?:commit|rollbackSync|rollbackAsync)/u);
  expect(appSource.match(/function runProductCompositionSync\(/gu)?.length ?? 0).toBe(1);
  expect(appSource.match(/function runProductCompositionAsync\(/gu)?.length ?? 0).toBe(1);
  expect(appSource.match(/createCompositionFailureScope\(\)/gu)?.length ?? 0).toBe(2);
  expect(appSource).not.toMatch(/\b(?:hostKind|testMode)\b/u);
  expect(appSource).not.toContain('function composeBoundApp(');
  expect(appSource).not.toContain('validateCronRuntimeComposition');
}

function assertNoForbiddenNamedCompositionFragments(sources: ReadonlyMap<string, string>): void {
  for (const exception of allowedNamedCompositionFragments) {
    expect(exception.owner.length).toBeGreaterThan(0);
    expect(exception.reason.length).toBeGreaterThan(0);
  }
  for (const [file, source] of sources) {
    for (const fragment of forbiddenCreateAppCompositionFragments) {
      const allowed = allowedNamedCompositionFragments.some((exception) => exception.file === file && exception.fragment === fragment);
      if (!allowed) {
        expect(source, `${file} must not contain ${fragment}`).not.toContain(fragment);
      }
    }
  }
}

function assertCompositionContractsAreTypeOnly(source: string): void {
  expect(source).not.toMatch(/\b(?:const|let|var|function|class|enum)\b/u);
  for (const line of source.split(/\r?\n/u)) {
    const trimmed = line.trim();
    if (trimmed.length === 0 || trimmed.startsWith('//')) {
      continue;
    }
    if (trimmed.startsWith('import ')) {
      expect(trimmed).toMatch(/^import type\b/u);
    }
    if (trimmed.startsWith('export ')) {
      expect(trimmed).toMatch(/^export (?:interface|type)\b/u);
    }
  }
}

function assertNoSiblingCompositionValueImports(sources: ReadonlyMap<string, string>): void {
  const importStatement = /import\s+(?:type\s+)?[\s\S]*?\s+from\s+["'][^"']+["'];/gu;
  for (const [file, source] of sources) {
    const siblingValueImports = [...source.matchAll(importStatement)]
      .map((match) => match[0])
      .filter((statement) => !statement.startsWith('import type '))
      .filter((statement) => /from\s+["']\.\/[^"']+-composition\.js["']/u.test(statement));
    expect(siblingValueImports, `${file} must not value-import sibling composition modules`).toEqual([]);
  }
}

const expectedPackages = [
  'agent-common',
  'agent-contracts',
  'agent-local-file-roll',
  'agent-log',
  'agent-runtime',
  'agent-session',
  'agent-attachment-runtime',
  'agent-context-engine',
  'agent-memory',
  'agent-core',
  'agent-dev-workbench',
  'agent-model',
  'agent-channel-common',
  'agent-channel-web',
  'agent-channel-task',
  'agent-channel-web-auth-local',
  'agent-app-frontend-hosting',
  'agent-platform-gateway-local',
  'agent-platform-gateway-remote',
  'agent-capability',
  'agent-observability',
  'agent-workflow',
  'agent-app',
  'agent-plugin-sdk',
  'agent-test-kit',
] as const;

const deploymentWorkspacePackages = ['agent-remote-deployment'] as const;

const implementationPackages = [
  'agent-log',
  'agent-runtime',
  'agent-session',
  'agent-attachment-runtime',
  'agent-context-engine',
  'agent-memory',
  'agent-core',
  'agent-model',
  'agent-channel-common',
  'agent-channel-web',
  'agent-dev-workbench',
  'agent-channel-task',
  'agent-channel-web-auth-local',
  'agent-app-frontend-hosting',
  'agent-platform-gateway-local',
  'agent-platform-gateway-remote',
  'agent-capability',
  'agent-observability',
  'agent-workflow',
  'agent-app',
] as const;

const expectedContractSubpathAllowlist: Readonly<Record<string, readonly string[]>> = {
  'agent-runtime': ['agent-assembly', 'runtime', 'session', 'gateway', 'observability', 'capability', 'context'],
  'agent-session': ['agent-assembly', 'capability', 'context', 'gateway', 'model', 'runtime', 'session'],
  'agent-attachment-runtime': ['attachment', 'gateway'],
  'agent-context-engine': ['agent-assembly', 'context', 'capability', 'model', 'gateway', 'session', 'runtime', 'system-reminder'],
  'agent-memory': ['capability', 'channel', 'context', 'gateway', 'model'],
  'agent-core': ['agent-assembly', 'runtime', 'context', 'model', 'capability', 'observability', 'session', 'core'],
  'agent-model': ['agent-assembly', 'model', 'runtime', 'observability'],
  'agent-channel-common': ['channel', 'runtime'],
  'agent-channel-web': ['channel', 'runtime', 'observability'],
  'agent-dev-workbench': ['gateway'],
  'agent-channel-task': ['channel', 'runtime', 'observability'],
  'agent-channel-web-auth-local': [],
  'agent-app-frontend-hosting': [],
  'agent-platform-gateway-local': ['gateway', 'capability'],
  'agent-platform-gateway-remote': ['gateway', 'model', 'capability', 'observability'],
  'agent-capability': ['agent-assembly', 'capability', 'gateway', 'model', 'observability'],
  'agent-observability': ['context', 'gateway', 'observability'],
  'agent-workflow': ['agent-assembly', 'core', 'capability', 'context', 'model', 'gateway', 'observability'],
};

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, 'utf8'));
}

describe('TS backend workspace architecture', () => {
  it('defines the root workspace scripts and strict TypeScript settings', () => {
    const packageJson = readJson(join(root, 'package.json')) as {
      engines: { node: string };
      scripts: Record<string, string>;
      workspaces: string[];
    };
    const tsconfig = readJson(join(root, 'tsconfig.base.json')) as {
      compilerOptions: Record<string, unknown>;
    };

    expect(packageJson.workspaces).toEqual(['packages/*']);
    expect(packageJson.engines.node).toBe('22.22.0');
    expect(readFileSync(join(root, '.nvmrc'), 'utf8').trim()).toBe(packageJson.engines.node);
    expect(packageJson.scripts).toMatchObject({
      build:
        'npm run typecheck && npm run build:runtime && node scripts/copy-builtin-skill-assets.mjs && npm run build:web --workspace @nextagent/agent-dev-workbench',
      'build:runtime': 'node scripts/rebuild-runtime-workspace-dists.mjs',
      typecheck: 'node --max-old-space-size=2048 node_modules/typescript/bin/tsc -b --pretty false',
      test: 'npm run build:web --workspace @nextagent/agent-dev-workbench && vitest run --maxWorkers=8',
      'test:smoke': 'vitest run --config vitest.config.smoke.ts --maxWorkers=1',
      'test:release':
        'npm run build && npm test && npm run test:contract && vitest run --config vitest.config.release.ts --maxWorkers=2 && npm run lint',
      'test:contract': 'vitest run --config vitest.config.contract.ts',
      'dev:watch': 'node scripts/dev-watch.mjs',
      lint: 'npm run lint:code && npm run lint:architecture && npm run lint:openspec',
      'lint:code': 'eslint . --cache --cache-strategy content --cache-location .cache/eslint/.eslintcache',
      'lint:architecture':
        'depcruise --config dependency-cruiser.config.cjs packages src tests --output-type err && node tests/architecture/package-manifest-policy.cjs && vitest run --config vitest.config.architecture.ts --maxWorkers=4',
      'lint:openspec': 'openspec validate --all --strict',
      format: 'prettier . --write --ignore-unknown --ignore-path .prettierignore',
    });
    expect(tsconfig.compilerOptions.strict).toBe(true);
    expect(tsconfig.compilerOptions.exactOptionalPropertyTypes).toBe(true);
    expect(tsconfig.compilerOptions.noUncheckedIndexedAccess).toBe(true);
    expect(tsconfig.compilerOptions.incremental).toBe(true);
    expect(tsconfig.compilerOptions.skipLibCheck).toBe(true);
    expect(tsconfig.compilerOptions.module).toBe('NodeNext');
  });

  it('creates every first-stage responsibility package with public exports and README ownership notes', () => {
    const actual = readdirSync(join(root, 'packages')).sort();
    expect(actual).toEqual([...expectedPackages, ...deploymentWorkspacePackages].sort());

    for (const packageName of expectedPackages) {
      const packageDir = join(root, 'packages', packageName);
      const packageJson = readJson(join(packageDir, 'package.json')) as { exports?: unknown; name?: string };
      const readme = readFileSync(join(packageDir, 'README.md'), 'utf8');

      expect(packageJson.name).toBe(`@nextagent/${packageName}`);
      expect(packageJson.exports).toBeDefined();
      expect(readme).toContain('职责');
      expect(readme).toContain('非职责');
      expect(readme).toContain('Public exports');
      expect(readme).toContain('Allowed dependencies');
      expect(readme).toContain('Forbidden dependencies');
    }
  });

  it('keeps contract exports on declared public subpaths', () => {
    const packageJson = readJson(join(root, 'packages', 'agent-contracts', 'package.json')) as {
      exports: Record<string, unknown>;
    };
    const exports = Object.keys(packageJson.exports);

    const allowedSubpaths = [
      'runtime',
      'channel',
      'session',
      'attachment',
      'context',
      'model',
      'capability',
      'core',
      'gateway',
      'observability',
      'app',
      'agent-assembly',
    ];

    for (const subpath of allowedSubpaths) {
      expect(exports).toContain(`./${subpath}`);
    }
    expect(exports).not.toContain('./configuration');
    expect(exports).not.toContain('./common');
    expect(exports).not.toContain('./identity');
    expect(exports).not.toContain('./timeline');
    expect(exports).not.toContain('./checkpoint');
    expect(exports).not.toContain('./pending-input');
    expect(exports).not.toContain('./hook');
    expect(exports).not.toContain('./sandbox');
  });

  it('keeps non-app implementation package manifests behind the dependency firewall', () => {
    expect(manifestPolicy.findManifestViolations(root)).toEqual([]);
  });

  it('rejects representative non-app implementation package manifest dependencies', () => {
    const fixtureRoot = join(root, 'tests', 'fixtures', 'architecture', 'implementation-package-manifest');

    expect(manifestPolicy.findManifestViolations(fixtureRoot)).toEqual([
      expect.objectContaining({
        packageName: 'agent-core',
        dependencyName: '@nextagent/agent-model',
      }),
    ]);
  });

  it('keeps contract subpath and app composition exceptions in the architecture policy', () => {
    const ruleNames = dependencyCruiserConfig.forbidden.map((rule) => rule.name);

    expect(dependencyCruiserConfig.architecturePolicy.implementationPackages).toEqual(implementationPackages);
    expect(dependencyCruiserConfig.architecturePolicy.contractSubpathAllowlist).toEqual(expectedContractSubpathAllowlist);
    expect(dependencyCruiserConfig.architecturePolicy.agentAppCompositionContractSubpaths).toEqual([
      'agent-assembly',
      'app',
      'capability',
      'channel',
      'context',
      'gateway',
      'core',
      'model',
      'observability',
      'runtime',
    ]);
    expect(dependencyCruiserConfig.architecturePolicy.nonAppImplementationPackages).toEqual(
      implementationPackages.filter((packageName) => packageName !== 'agent-app'),
    );
    expect(ruleNames).toContain('no-agent-app-unauthorized-contract-subpaths');
    expect(ruleNames).toContain('no-product-contract-root-aggregate-imports');
    expect(ruleNames).toContain('no-agent-assembly-to-runtime-or-wide-contracts');
    expect(ruleNames).toContain('no-agent-app-config-to-composition');
    expect(ruleNames).toContain('no-agent-app-composition-modules-to-create-app');
    expect(ruleNames).toContain('no-agent-app-composition-sibling-value-imports');
  });

  it('does not duplicate the agent-app contract whitelist in package-local sources or README notes', () => {
    const forbiddenPolicyTerms = /agentAppCompositionContractSubpaths|contractSubpathAllowlist/;

    for (const packageName of expectedPackages) {
      const packageDir = join(root, 'packages', packageName);
      const readme = readFileSync(join(packageDir, 'README.md'), 'utf8');

      expect(readme, packageName).not.toMatch(forbiddenPolicyTerms);
      for (const entry of readdirSync(join(packageDir, 'src'), { withFileTypes: true })) {
        if (entry.isFile() && entry.name.endsWith('.ts')) {
          expect(readFileSync(join(packageDir, 'src', entry.name), 'utf8'), `${packageName}/${entry.name}`).not.toMatch(forbiddenPolicyTerms);
        }
      }
    }
  });

  it('keeps local auth assembled only by the local product entrypoint and out of generic Web channel composition', () => {
    const packageJson = readJson(join(root, 'packages', 'agent-app', 'package.json')) as {
      dependencies?: Record<string, string>;
      exports?: Record<string, unknown>;
    };
    const localAuthManifest = readJson(join(root, 'packages', 'agent-app', 'manifests', 'local-configured-auth.package.json')) as {
      dependencies?: Record<string, string>;
    };
    const channelSource = readFileSync(join(root, 'packages', 'agent-channel-web', 'src', 'index.ts'), 'utf8');
    const genericCompositionSource = readFileSync(join(root, 'packages', 'agent-app', 'src', 'composition', 'create-app.ts'), 'utf8');
    const backendOnlySource = readFileSync(join(root, 'packages', 'agent-app', 'src', 'entrypoints', 'backend-only.ts'), 'utf8');
    const withFrontendSource = readFileSync(join(root, 'packages', 'agent-app', 'src', 'entrypoints', 'with-frontend.ts'), 'utf8');
    const localCompositionSource = readFileSync(join(root, 'packages', 'agent-app', 'src', 'composition', 'create-local-configured-app.ts'), 'utf8');
    const localContributionSource = readFileSync(
      join(root, 'packages', 'agent-app', 'src', 'composition', 'local-configured-auth-channel-contribution.ts'),
      'utf8',
    );
    const localEntrypointSource = readFileSync(join(root, 'packages', 'agent-app', 'src', 'entrypoints', 'local-configured-auth.ts'), 'utf8');
    const localAuthSource = readFileSync(join(root, 'packages', 'agent-channel-web-auth-local', 'src', 'index.ts'), 'utf8');

    expect(packageJson.dependencies).not.toHaveProperty('@nextagent/agent-channel-web-auth-local');
    expect(localAuthManifest.dependencies).toHaveProperty('@nextagent/agent-app');
    expect(localAuthManifest.dependencies).toHaveProperty('@nextagent/agent-channel-web-auth-local');
    expect(packageJson.exports).toHaveProperty('./entrypoints/local-configured-auth');
    expect(genericCompositionSource).not.toContain('@nextagent/agent-channel-web-auth-local');
    expect(backendOnlySource).not.toContain('@nextagent/agent-channel-web-auth-local');
    expect(withFrontendSource).not.toContain('@nextagent/agent-channel-web-auth-local');
    expect(localCompositionSource).not.toContain('@nextagent/agent-channel-web-auth-local');
    expect(localContributionSource).toContain('@nextagent/agent-channel-web-auth-local');
    expect(localContributionSource).not.toMatch(/Create(?:NextAgent|Composed)AppOptions/u);
    expect(localCompositionSource).not.toMatch(/registerWebChannel|server\.register|\.\.\.options/u);
    expect(localEntrypointSource).toContain('createLocalConfiguredNextAgentApp');
    expect(localEntrypointSource).toContain('const app = await createLocalConfiguredNextAgentAppAsync();');
    expect(localAuthSource).toContain('FastifyPluginAsync');
    expect(localAuthSource).toContain('createLocalConfiguredWebAuthPlugin');
    expect(channelSource).not.toContain('@nextagent/agent-channel-web-auth-local');
  });

  it('keeps local auth scoped out of gateway public contracts', () => {
    const packageJson = readJson(join(root, 'packages', 'agent-channel-web-auth-local', 'package.json')) as {
      dependencies?: Record<string, string>;
    };
    const localAuthSource = readFileSync(join(root, 'packages', 'agent-channel-web-auth-local', 'src', 'index.ts'), 'utf8');
    const gatewaySource = readFileSync(join(root, 'packages', 'agent-contracts', 'src', 'gateway', 'index.ts'), 'utf8');

    expect(packageJson.dependencies).not.toHaveProperty('@nextagent/agent-contracts');
    expect(localAuthSource).not.toContain('@nextagent/agent-contracts/gateway');
    expect(gatewaySource).not.toContain('LocalAuthenticationGatewayBoundary');
  });

  it('keeps agent-app create-app as a bounded composition root facade', () => {
    const appSource = readFileSync(join(root, 'packages', 'agent-app', 'src', 'composition', 'create-app.ts'), 'utf8');
    const deferredSource = readFileSync(join(root, 'packages', 'agent-app', 'src', 'composition', 'deferred-composition-bindings.ts'), 'utf8');
    assertBoundedCreateAppCompositionSource(appSource, deferredSource);
    expect(() =>
      assertBoundedCreateAppCompositionSource('export function createComposedApp() { createObservationEvent({}); }', deferredSource),
    ).toThrow();
    const namedCompositionSources = new Map(
      sourceFiles(join(root, 'packages', 'agent-app', 'src', 'composition'))
        .filter((path) => path.endsWith('-composition.ts'))
        .map((path) => [path.replaceAll('\\', '/').replace(root.replaceAll('\\', '/') + '/', ''), readFileSync(path, 'utf8')]),
    );
    assertNoForbiddenNamedCompositionFragments(namedCompositionSources);
    assertNoSiblingCompositionValueImports(namedCompositionSources);
    assertCompositionContractsAreTypeOnly(
      readFileSync(join(root, 'packages', 'agent-app', 'src', 'composition', 'composition-contracts.ts'), 'utf8'),
    );
    expect(() =>
      assertNoForbiddenNamedCompositionFragments(
        new Map([['packages/agent-app/src/composition/example-composition.ts', 'createObservationEvent({});']]),
      ),
    ).toThrow();
    expect(() =>
      assertNoSiblingCompositionValueImports(
        new Map([['packages/agent-app/src/composition/example-composition.ts', 'import { helper } from "./other-composition.js";\nhelper();']]),
      ),
    ).toThrow();
    expect(() => assertCompositionContractsAreTypeOnly('import { value } from "./create-app.js";\nexport const value = 1;')).toThrow();
    expect(appSource).not.toContain('function createGatewayBindingsForSelection');
    expect(appSource).not.toContain('function registerProductWebChannel');
    expect(appSource).not.toContain('function createHotReloadingActiveAssemblyRegistry');
    expect(appSource).not.toContain('function createCapabilityProviderReferenceValidation');
    expect(appSource).toContain("from './gateway-composition.js'");
    expect(appSource).toContain("from './channel-composition.js'");
    expect(appSource).toContain("from './assembly-composition.js'");
    expect(appSource).toContain("from './capability-composition.js'");
    expect(appSource).toContain("from './workflow-composition.js'");
    expect(appSource).toContain("from './context-engine-composition.js'");
    expect(appSource).toContain("from './memory-maintenance-composition.js'");
    expect(appSource).toContain("from './request-runtime-composition.js'");
    expect(appSource).toContain("from './session-services-composition.js'");
    expect(appSource).toContain("from './app-lifecycle-composition.js'");
    expect(appSource).toContain("from './attachment-composition.js'");
    expect(appSource).toContain("from './deferred-composition-bindings.js'");
    expect(appSource).toContain("from './health-composition.js'");
    expect(appSource).toContain("from './app-composition-helpers.js'");
    expect(appSource).toContain("from './observability-composition.js'");
    expect(appSource).toContain("from './lifecycle-hook-composition.js'");
    expect(appSource).toContain("from './model-composition.js'");
    expect(appSource).toContain("from './prompt-template-composition.js'");
  });

  it('enforces the single prepared root, runner scope, and classified host surfaces', () => {
    const appSource = readFileSync(join(root, 'packages', 'agent-app', 'src', 'composition', 'create-app.ts'), 'utf8');
    const appIndexSource = readFileSync(join(root, 'packages', 'agent-app', 'src', 'index.ts'), 'utf8');
    const testingSource = readFileSync(join(root, 'packages', 'agent-app', 'src', 'testing.ts'), 'utf8');
    const testHostSource = readFileSync(join(root, 'packages', 'agent-app', 'src', 'composition', 'create-test-composition.ts'), 'utf8');
    const localAuthHostSource = readFileSync(join(root, 'packages', 'agent-app', 'src', 'composition', 'create-local-configured-app.ts'), 'utf8');
    const withFrontendSource = readFileSync(join(root, 'packages', 'agent-app', 'src', 'entrypoints', 'with-frontend.ts'), 'utf8');
    const localPackageSource = readFileSync(join(root, 'packages', 'agent-app', 'src', 'local-runtime-package', 'index.ts'), 'utf8');
    const localBindingsSource = readFileSync(
      join(root, 'packages', 'agent-app', 'src', 'local-runtime-package', 'local-runtime-bindings.ts'),
      'utf8',
    );
    const agentAppSources = sourceFiles(join(root, 'packages', 'agent-app', 'src')).filter((path) => path.endsWith('.ts'));

    for (const path of agentAppSources) {
      const source = readFileSync(path, 'utf8');
      if (!path.endsWith(join('composition', 'create-app.ts'))) {
        expect(source, path).not.toContain('PreparedCompositionInputs');
      }
    }
    expect(appSource.match(/interface PreparedCompositionInputs\b/gu)).toHaveLength(1);
    expect(appSource.match(/function prepareCompositionInputsSync\(/gu)).toHaveLength(1);
    expect(appSource.match(/function prepareCompositionInputsAsync\(/gu)).toHaveLength(1);
    expect(appSource.match(/function composeNextAgentApp\(/gu)).toHaveLength(1);
    expect(appSource.match(/createCompositionFailureScope\(\)/gu)).toHaveLength(2);
    expect(appSource.match(/completeWithFrontendProductComposition\(outcome\.app, productHostInput\)/gu)).toHaveLength(1);
    expect(appSource).not.toMatch(/\b(?:hostKind|testMode)\b|"LOCAL"\s*\|\s*"REMOTE"\s*\|\s*"TEST"/u);
    expect(appIndexSource).not.toMatch(/ProductCompositionOutcome|hostFacts/u);
    expect(testingSource).not.toMatch(/ProductCompositionOutcome|hostFacts/u);

    for (const source of [testingSource, testHostSource, localAuthHostSource, withFrontendSource, localPackageSource, localBindingsSource]) {
      expect(source).not.toContain('createCompositionFailureScope');
      expect(source).not.toContain('PreparedCompositionInputs');
      expect(source).not.toContain('composeNextAgentApp');
    }
    expect(testHostSource).not.toMatch(/loadAppCompositionConfiguration|composeProductChannelLayer/u);
    expect(localAuthHostSource).not.toMatch(/\.\.\.options|registerWebChannel|server\.register/u);
    expect(withFrontendSource).not.toMatch(/\.\.\.options|createCompositionFailureScope/u);
    expect(withFrontendSource).not.toContain('completeWithFrontendProductComposition');
    expect(localBindingsSource).not.toMatch(/runProductComposition|createNextAgentApp|server\.close|rollback/u);
    expect(localPackageSource).toContain('if (!runnerAccepted)');
    expect(localPackageSource).not.toContain('startLocalRuntimePackage(packageRoot);');

    const layerOffsets = [
      '// Layer 1: startup contributions.',
      '// Layer 2: static Agent assembly.',
      '// Layer 3: platform infrastructure.',
      '// Layer 4: execution capabilities.',
      '// Layer 5: application services.',
      '// Layer 6: request runtime and product channels.',
      '// Layer 7: app lifecycle and private host handoff.',
    ].map((marker) => appSource.indexOf(marker));
    expect(layerOffsets.every((offset) => offset >= 0)).toBe(true);
    expect(layerOffsets).toEqual([...layerOffsets].sort((left, right) => left - right));
  });

  it('keeps external hosts classified without a second config, core, or rollback policy', () => {
    const externalSources = new Map([
      ['local-public', readFileSync(join(root, 'packages', 'agent-platform-gateway-local', 'src', 'entrypoints', 'local.ts'), 'utf8')],
      ['local-testing', readFileSync(join(root, 'packages', 'agent-platform-gateway-local', 'src', 'testing.ts'), 'utf8')],
      ['remote', readFileSync(join(root, 'packages', 'agent-remote-deployment', 'src', 'index.ts'), 'utf8')],
      ['process', readFileSync(join(root, 'src', 'main.ts'), 'utf8')],
      ['dev', readFileSync(join(root, 'scripts', 'start-dev-backend.mjs'), 'utf8')],
      ['demo', readFileSync(join(root, 'scripts', 'start-demo-workflow-server.mjs'), 'utf8')],
      ['workflow-demo-launcher', readFileSync(join(root, 'scripts', 'dev-workflow-demo.mjs'), 'utf8')],
    ]);
    for (const [surface, source] of externalSources) {
      expect(source, surface).not.toMatch(/PreparedCompositionInputs|composeNextAgentApp|createCompositionFailureScope|rollback(?:Sync|Async)/u);
      expect(source, surface).not.toMatch(
        /from ["'][^"']+(?:assembly|attachment|capability|channel|context-engine|gateway|health|memory-maintenance|request-runtime|session-services)-composition/u,
      );
    }
    const localPublic = externalSources.get('local-public')!;
    const localTesting = externalSources.get('local-testing')!;
    const processHost = externalSources.get('process')!;
    const devHost = externalSources.get('dev')!;
    const demoHost = externalSources.get('demo')!;
    const workflowDemoLauncher = externalSources.get('workflow-demo-launcher')!;
    expect(localPublic).toContain('localGatewayCompositionDefaults(options)');
    expect(localPublic).toMatch(/options\.gatewayProviders \?\?/u);
    expect(localTesting).toContain('registerAuditCapture');
    expect(localTesting).toContain('options.metricsRegistry ?? createInMemoryMetricsRegistry()');
    expect(processHost).toContain('createProcessFatalBoundary');
    expect(processHost).toContain('await app.close()');
    expect(devHost.match(/loadLocalRuntimeBindings\(\)/gu)).toHaveLength(1);
    expect(devHost.match(/createNextAgentAppAsync\(/gu)).toHaveLength(1);
    expect(demoHost).toContain("from '@nextagent/agent-platform-gateway-local/testing'");
    expect(demoHost.indexOf('app.server.addHook')).toBeLessThan(demoHost.indexOf('await app.start()'));
    expect(demoHost).toContain("process.on('SIGINT'");
    expect(demoHost).toContain("process.on('SIGTERM'");
    expect(workflowDemoLauncher).toContain('start-demo-workflow-server.mjs');
    expect(workflowDemoLauncher).toContain('VITE_PROXY_TARGET');
    expect(workflowDemoLauncher).toContain("process.on('SIGINT'");
    expect(workflowDemoLauncher).toContain("process.on('SIGTERM'");
  });

  it('keeps Agent Dev Workbench entrypoint-selected and out of product Web ownership', () => {
    const appPackageJson = readJson(join(root, 'packages', 'agent-app', 'package.json')) as {
      dependencies?: Record<string, string>;
    };
    const devWorkbenchPackageJson = readJson(join(root, 'packages', 'agent-dev-workbench', 'package.json')) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    const appCompositionSource = readFileSync(join(root, 'packages', 'agent-app', 'src', 'composition', 'create-app.ts'), 'utf8');
    const localRuntimePackageSource = readFileSync(join(root, 'packages', 'agent-app', 'src', 'local-runtime-package', 'index.ts'), 'utf8');
    const localRuntimeBindingsSource = readFileSync(
      join(root, 'packages', 'agent-app', 'src', 'local-runtime-package', 'local-runtime-bindings.ts'),
      'utf8',
    );
    const backendOnlySource = readFileSync(join(root, 'packages', 'agent-app', 'src', 'entrypoints', 'backend-only.ts'), 'utf8');
    const withFrontendSource = readFileSync(join(root, 'packages', 'agent-app', 'src', 'entrypoints', 'with-frontend.ts'), 'utf8');
    const withFrontendFinalizerSource = readFileSync(join(root, 'packages', 'agent-app', 'src', 'entrypoints', 'with-frontend-finalizer.ts'), 'utf8');
    const channelWebSources = sourceFiles(join(root, 'packages', 'agent-channel-web', 'src'))
      .map((path) => readFileSync(path, 'utf8'))
      .join('\n');
    const devWorkbenchSource = readFileSync(join(root, 'packages', 'agent-dev-workbench', 'src', 'index.ts'), 'utf8');
    const devWorkbenchWebSources = ['App.tsx', 'ProcessGraphCanvas.tsx', 'main.tsx']
      .map((fileName) => readFileSync(join(root, 'packages', 'agent-dev-workbench', 'web', 'src', fileName), 'utf8'))
      .join('\n');
    const agentWebSources = sourceFiles(join(root, 'frontend', 'agent-web', 'src'))
      .filter((path) => path.endsWith('.ts') || path.endsWith('.tsx'))
      .map((path) => readFileSync(path, 'utf8'))
      .join('\n');

    expect(appPackageJson.dependencies).not.toHaveProperty('@nextagent/agent-dev-workbench');
    expect(devWorkbenchPackageJson.dependencies).toMatchObject({
      '@antv/g6': '4.8.21',
      antd: '5.29.3',
      react: '19.2.4',
      'react-dom': '19.2.4',
    });
    expect(devWorkbenchPackageJson.devDependencies).toMatchObject({ vite: '5.4.21' });
    expect(appCompositionSource).not.toContain('@nextagent/agent-dev-workbench');
    expect(appCompositionSource).not.toContain('/__nextagent/dev/workbench');
    expect(appCompositionSource).toContain('loadLocalRuntimeBindings');
    expect(localRuntimeBindingsSource).toContain("'@nextagent/agent-dev-workbench'");
    expect(localRuntimePackageSource).not.toMatch(/process\.env.*workbench|feature flag|packageProfile === "dev"/u);
    expect(backendOnlySource).not.toContain('agent-dev-workbench');
    expect(withFrontendSource).toContain('useDefaultWorkbenchScripts');
    expect(withFrontendFinalizerSource).toContain('input.useDefaultWorkbenchScripts ? localDevWorkbenchFrontendScripts() : []');
    expect(channelWebSources).not.toContain('__nextagent/dev/workbench');
    expect(channelWebSources).not.toContain('agent-dev-workbench');
    expect(agentWebSources).not.toContain('__nextagent/dev/workbench');
    expect(agentWebSources).not.toContain('Agent Dev Workbench');
    expect(devWorkbenchSource).toContain('/__nextagent/dev/workbench');
    expect(devWorkbenchSource).toContain('nextagent-dev-workbench-launcher');
    expect(devWorkbenchWebSources).toContain('@antv/g6');
    expect(devWorkbenchSource).not.toContain('/api/v1');
    expect(devWorkbenchSource).not.toMatch(/instance\.(?:post|put|delete)\(|answerPendingInput|retryLatest|editLatest|cancelRun|forkFrom/u);
    expect(devWorkbenchSource).not.toMatch(/EventSource|WebSocket|sendSseStream|registerWebSocketStream/u);
    expect(devWorkbenchWebSources).not.toMatch(
      /EventSource|WebSocket|\/stream|method:\s*["'](?:POST|PUT|DELETE)|answerPendingInput|retryLatest|editLatest|cancelRun|forkFrom/u,
    );
    expect(devWorkbenchSource).not.toMatch(/DevWorkbench\w*Record|process_graph|raw snapshot|rawSnapshot|raw prompt|raw model output|raw tool/u);
    expect(devWorkbenchSource).not.toMatch(/createRuntimeLogger|appendFile|createWriteStream|writeFile|logOffset|fileOffset|filePath/u);
  });

  it('keeps local package config preparation single-read across direct and dispatch starts', () => {
    const source = readFileSync(join(root, 'packages', 'agent-app', 'src', 'local-runtime-package', 'index.ts'), 'utf8');
    const localEntrypointSource = readFileSync(join(root, 'packages', 'agent-platform-gateway-local', 'src', 'entrypoints', 'local.ts'), 'utf8');
    const preparation = source.slice(
      source.indexOf('function prepareRuntimePackageConfigFact'),
      source.indexOf('async function prepareLocalRuntimePackageHost'),
    );
    const directStart = source.slice(
      source.indexOf('export async function startLocalRuntimePackage'),
      source.indexOf('async function startPreparedLocalRuntimePackage'),
    );
    const dispatchStart = source.slice(
      source.indexOf('export async function startRuntimePackage'),
      source.indexOf('export function runLocalRuntimePackageSelfCheck'),
    );

    expect(preparation.match(/readFileSync\(configPath,/gu)).toHaveLength(1);
    expect(directStart.match(/prepareRuntimePackageConfigFact\(/gu)).toHaveLength(1);
    expect(dispatchStart.match(/prepareRuntimePackageConfigFact\(/gu)).toHaveLength(1);
    expect(dispatchStart).toContain('startPreparedLocalRuntimePackage(await prepareLocalRuntimePackageHost(preparedConfig))');
    expect(dispatchStart).not.toContain('startLocalRuntimePackage(');
    const localHostPreparation = source.slice(
      source.indexOf('async function prepareLocalRuntimePackageHost'),
      source.indexOf('export async function startLocalRuntimePackage'),
    );
    const preparedStart = source.slice(
      source.indexOf('async function startPreparedLocalRuntimePackage'),
      source.indexOf('export async function startRuntimePackage'),
    );
    expect(localHostPreparation).toContain('createAppOperationalLogWriter');
    expect(source).not.toContain('initOtelSdk');
    expect(preparedStart).toContain('operationalLogWriter: prepared.operationalLogWriter');
    expect(preparedStart).toContain('runProductCompositionAsync(');
    expect(preparedStart).not.toContain('traceProjector:');
    expect(localEntrypointSource).toContain('const app = await createLocalNextAgentAppAsync();');
  });

  it('keeps secret validation app-internal without parallel snapshots or product resolvers', () => {
    const appSource = readFileSync(join(root, 'packages', 'agent-app', 'src', 'composition', 'create-app.ts'), 'utf8');
    const envSource = readFileSync(join(root, 'packages', 'agent-app', 'src', 'config', 'env.ts'), 'utf8');
    const validationSource = readFileSync(join(root, 'packages', 'agent-app', 'src', 'config', 'validation.ts'), 'utf8');
    const contractSources = sourceFiles(join(root, 'packages', 'agent-contracts', 'src'))
      .map((path) => readFileSync(path, 'utf8'))
      .join('\n');
    const downstreamSources = [
      'packages/agent-model/src/providers/openai-compatible/openai-compatible-provider.ts',
      'packages/agent-platform-gateway-local/src/db/sqlite-gateway-stores.ts',
      'packages/agent-capability/src/catalog/catalog.ts',
    ];

    expect(appSource).toContain('createAppCredentialResolver');
    expect(envSource).toContain('createAppCredentialResolver');
    expect(validationSource).not.toContain('SecretUsageSnapshot');
    expect(contractSources).not.toMatch(/SecretUsageSnapshot|SecretReadinessState|SecretValidationResult/u);
    for (const path of downstreamSources) {
      const source = readFileSync(join(root, path), 'utf8');
      expect(source, path).not.toContain('process.env');
      expect(source, path).not.toContain('default-system');
    }
  });

  it('keeps model contracts declarative and stream terminal ownership in the invocation service', () => {
    const modelContract = readFileSync(join(root, 'packages', 'agent-contracts', 'src', 'model', 'index.ts'), 'utf8');

    expect(modelContract).toContain('onDelta: (delta: ModelStreamDelta) => Promise<void>');
    expect(modelContract).toContain(') => Promise<ModelFinalResult>;');
    expect(modelContract).not.toContain('ModelStreamTerminalResultSchema');
    expect(modelContract).not.toMatch(/export function /u);
  });

  it('keeps SQLite gateway-local main-path facts on dedicated business tables', () => {
    const source = readFileSync(join(root, 'packages', 'agent-platform-gateway-local', 'src', 'db', 'sqlite-gateway-core.ts'), 'utf8');

    expect(source).toContain('CREATE TABLE IF NOT EXISTS request_runs');
    expect(source).toContain('CREATE TABLE IF NOT EXISTS sessions');
    expect(source).toContain('CREATE TABLE IF NOT EXISTS messages');
    expect(source).toContain('CREATE TABLE IF NOT EXISTS active_context_states');
    expect(source).toContain('CREATE TABLE IF NOT EXISTS active_context_items');
    expect(source).toContain('CREATE TABLE IF NOT EXISTS timeline_events');
    expect(source).toContain('CREATE TABLE IF NOT EXISTS checkpoints');
    expect(source).toContain('CREATE UNIQUE INDEX IF NOT EXISTS idx_sessions_idempotency');
    expect(source).toContain('CREATE UNIQUE INDEX IF NOT EXISTS idx_messages_idempotency');
    expect(source).toContain('CREATE UNIQUE INDEX IF NOT EXISTS idx_timeline_events_idempotency');
    expect(source).toContain('CREATE UNIQUE INDEX IF NOT EXISTS idx_checkpoints_idempotency');
    expect(source).toContain('agent_id TEXT NOT NULL,');
    expect(source).toContain('request_context_id TEXT NOT NULL,');
    expect(source).not.toContain('CREATE TABLE IF NOT EXISTS records');
    expect(source).not.toContain('message_idempotency');
    expect(source).not.toContain('terminal_commits');
    expect(source).not.toContain('operation_kind');
    // checkpoints must have individual columns (no json blob), agent_id in PK
    expect(source).not.toContain('PRIMARY KEY (tenant_id, subject_id, checkpoint_id)');
    // sessions, messages, attachments, pending_inputs must not have json blob columns
    const sessionsBlock = source.match(/CREATE TABLE IF NOT EXISTS sessions[\s\S]*?(?=\n\s{6}CREATE (?:TABLE|INDEX))/)?.[0] ?? '';
    const messagesBlock = source.match(/CREATE TABLE IF NOT EXISTS messages[\s\S]*?(?=\n\s{6}CREATE (?:TABLE|INDEX))/)?.[0] ?? '';
    const attachmentsBlock = source.match(/CREATE TABLE IF NOT EXISTS attachments[\s\S]*?(?=\n\s{6}CREATE (?:TABLE|INDEX))/)?.[0] ?? '';
    const pendingInputsBlock = source.match(/CREATE TABLE IF NOT EXISTS pending_inputs[\s\S]*?(?=\n\s{6}CREATE (?:TABLE|INDEX))/)?.[0] ?? '';
    expect(sessionsBlock).not.toContain('json TEXT NOT NULL');
    expect(messagesBlock).not.toContain('json TEXT NOT NULL');
    expect(attachmentsBlock).not.toContain('json TEXT NOT NULL');
    expect(pendingInputsBlock).not.toContain('json TEXT NOT NULL');
  });

  it('keeps message append and active context append in one gateway transaction', () => {
    const gatewaySource = readFileSync(join(root, 'packages', 'agent-platform-gateway-local', 'src', 'db', 'sqlite-gateway-core.ts'), 'utf8');
    const runMessagePortSource = readFileSync(join(root, 'packages', 'agent-runtime', 'src', 'lifecycle', 'run-message-port.ts'), 'utf8');
    const submitSource = readFileSync(join(root, 'packages', 'agent-runtime', 'src', 'lifecycle', 'submit.ts'), 'utf8');
    const dispatcherSource = readFileSync(join(root, 'packages', 'agent-runtime', 'src', 'lifecycle', 'dispatcher.ts'), 'utf8');
    const terminalSource = readFileSync(join(root, 'packages', 'agent-runtime', 'src', 'terminal', 'terminal-commit.ts'), 'utf8');

    expect(gatewaySource).toContain('appendSessionMessage');
    expect(gatewaySource).toMatch(
      /appendSessionMessage\(record: SessionMessageRecord, options: IdempotentWriteOptions = \{\}\)[\s\S]*return this\.transaction\(\(\) => \{[\s\S]*this\.saveMessageSync\(record, options\)[\s\S]*this\.appendActiveContextItemSync\(/,
    );
    expect(gatewaySource).toMatch(
      /async commitTerminal[\s\S]*return this\.transaction\(\(\) => \{[\s\S]*this\.putRun\([\s\S]*this\.saveMessageSync\([\s\S]*this\.appendActiveContextItemSync\([\s\S]*this\.appendTimelineEventSync\(/,
    );
    expect(runMessagePortSource).toContain('appendSessionMessage');
    expect(submitSource).toContain('appendSessionMessage');
    expect(terminalSource).toContain('terminalMessage');
    expect(terminalSource).toContain('terminalEvent');
    expect(terminalSource.match(/requestRunStore\.commitTerminal/g)).toHaveLength(1);
    expect(terminalSource).not.toContain('truncateTimelineInlinePayload');
    expect(terminalSource).not.toContain('appendSessionMessage');
    expect(submitSource).not.toContain('publishTerminalCommitFallbackEvent');
    expect(submitSource).not.toContain('terminalCommitFallback');
    expect(runMessagePortSource).not.toContain('activeContextStore');
    expect(submitSource).not.toMatch(/persistUserMessage[\s\S]*activeContextStore\.appendItem/);
    expect(dispatcherSource).not.toContain(':executing');
    expect(terminalSource).not.toContain('activeContextStore');
    expect(terminalSource).not.toContain('terminal-pending');
    expect(terminalSource).not.toContain('terminal-diagnostic');
  });

  it('keeps Capability terminal ownership closed and terminal recovery Message-first', () => {
    const coreSource = readFileSync(join(root, 'packages', 'agent-core', 'src', 'agent', 'default-agent.ts'), 'utf8');
    const runtimeContractSource = readFileSync(join(root, 'packages', 'agent-contracts', 'src', 'runtime', 'index.ts'), 'utf8');
    const runtimeOwnerSource = readFileSync(join(root, 'packages', 'agent-runtime', 'src', 'lifecycle', 'agent-run-state-port.ts'), 'utf8');
    const submitSource = readFileSync(join(root, 'packages', 'agent-runtime', 'src', 'lifecycle', 'submit.ts'), 'utf8');
    const terminalCommitSource = readFileSync(join(root, 'packages', 'agent-runtime', 'src', 'terminal', 'terminal-commit.ts'), 'utf8');
    const projectionSource = readFileSync(join(root, 'packages', 'agent-channel-common', 'src', 'projections', 'stream-envelope.ts'), 'utf8');
    const webContractSource = readFileSync(join(root, 'packages', 'agent-channel-web', 'src', 'schemas', 'api-contract.ts'), 'utf8');
    const terminalReader = projectionSource.match(/function readTerminalAssistantContent[\s\S]*?\n\}/u)?.[0] ?? '';
    const publicTerminalOptions = terminalCommitSource.match(/export interface TerminalCommitOptions[\s\S]*?\n\}/u)?.[0] ?? '';

    expect(coreSource.match(/this\.deps\.runState\.setCapabilityTerminalAnswer\(/gu)).toHaveLength(3);
    expect(runtimeContractSource.match(/setCapabilityTerminalAnswer:/gu)).toHaveLength(1);
    expect(runtimeOwnerSource.match(/async setCapabilityTerminalAnswer\(/gu)).toHaveLength(1);
    expect(submitSource).toMatch(/lifecycleInterruption\?\.outcome === 'PEND'[\s\S]{0,200}runState\.discardRun\(run\)/u);
    expect(publicTerminalOptions).not.toContain('capabilityTerminalAnswer');
    expect(terminalReader).toContain('message.content');
    expect(terminalReader).not.toContain('event.inlinePayload.content');
    expect(webContractSource).not.toContain('GET /api/v1/sessions/:sessionId/messages/:messageId');
    expect(webContractSource).not.toMatch(/GET \/api\/v1\/.*(?:workspace|tool-results)/u);
  });

  it('keeps idempotency keys on write options instead of gateway records', () => {
    const gatewayContract = readFileSync(join(root, 'packages', 'agent-contracts', 'src', 'gateway', 'index.ts'), 'utf8');
    const recordInterfaces = gatewayContract.match(/export interface \w*Record(?: extends \w+)? \{[\s\S]*?\n\}/g) ?? [];

    expect(recordInterfaces.length).toBeGreaterThan(0);
    for (const recordInterface of recordInterfaces) {
      expect(recordInterface).not.toContain('idempotencyKey');
    }
    expect(gatewayContract).toContain('export interface IdempotentWriteOptions');
    expect(gatewayContract).toContain('readonly idempotencyKey?: IdempotencyKey');
    expect(gatewayContract).toContain('appendSessionMessage: (record: SessionMessageRecord, options?: IdempotentWriteOptions)');
    expect(gatewayContract).toContain('saveCheckpoint: (record: CheckpointRecord, options: { readonly idempotencyKey: IdempotencyKey })');
    expect(gatewayContract).toContain('export interface OwnerScoped');
    expect(gatewayContract).toContain('SessionMessageRole');
    expect(gatewayContract).toContain('PendingInputKind');
    expect(gatewayContract).toContain("} from '@nextagent/agent-common'");
    expect(gatewayContract).not.toContain('../session/index.js');
    expect(gatewayContract).not.toContain('../runtime/index.js');
    expect(gatewayContract).not.toContain('../attachment/index.js');
    expect(gatewayContract).not.toContain('OwnerScopedRequest');
    expect(gatewayContract).not.toContain('RequiredIdempotentWriteOptions');
    expect(gatewayContract).not.toContain('saveMessage(record: SessionMessageRecord');
    expect(gatewayContract).not.toContain('SessionMessageRecordRole');
    expect(gatewayContract).not.toContain('MessageContentRecordType');
    expect(gatewayContract).not.toContain('VisibilityRecordReason');
    expect(gatewayContract).not.toContain('AttachmentMediaRecordType');
    expect(gatewayContract).not.toContain('AttachmentValidationRecordStatus');
    expect(gatewayContract).not.toContain('AttachmentAvailabilityRecordStatus');
    expect(gatewayContract).not.toContain('PendingInputRecordKind');
    expect(gatewayContract).not.toContain('PendingInputRecordStatus');
    expect(gatewayContract).not.toContain('RequestRunWriteRequest');
    expect(gatewayContract).not.toContain('SessionWriteRequest');
    expect(gatewayContract).not.toContain('SessionMessageWriteRequest');
    expect(gatewayContract).not.toContain('RunTimelineEventAppendRequest');
    expect(gatewayContract).not.toContain('CheckpointWriteRequest');
    expect(gatewayContract).not.toContain('AppendSessionMessageRecordRequest');
    expect(gatewayContract).not.toContain('SaveSessionMessageAndAppendActiveContextRequest');
    expect(gatewayContract).not.toContain('saveMessageAndAppendToActiveContext');
  });

  it('keeps pending input lifecycle queries and producer coordinates runtime-owned', () => {
    const gatewayContract = readFileSync(join(root, 'packages', 'agent-contracts', 'src', 'gateway', 'index.ts'), 'utf8');
    const runtimeContract = readFileSync(join(root, 'packages', 'agent-contracts', 'src', 'runtime', 'index.ts'), 'utf8');
    const capabilityContract = readFileSync(join(root, 'packages', 'agent-contracts', 'src', 'capability', 'index.ts'), 'utf8');
    const coreToolLoopSource = readFileSync(join(root, 'packages', 'agent-core', 'src', 'tools', 'tool-loop.ts'), 'utf8');
    const toolNormalizer = readFileSync(join(root, 'packages', 'agent-model', 'src', 'providers', 'shared', 'tool-use-normalizer.ts'), 'utf8');
    const capabilityPackageSources = sourceFiles(join(root, 'packages', 'agent-capability'))
      .map((path) => readFileSync(path, 'utf8'))
      .join('\n');
    const gatewayBlock = gatewayContract.slice(
      gatewayContract.indexOf('export interface PendingInputRecord'),
      gatewayContract.indexOf('export interface CreatePendingInputRecordRequest'),
    );
    const pendingInputRequestBlock = runtimeContract.slice(
      runtimeContract.indexOf('export interface PendingInputRequest'),
      runtimeContract.indexOf('export interface PendingInputAnswer'),
    );
    const pendingInputAnswerBlock = runtimeContract.slice(
      runtimeContract.indexOf('export interface PendingInputAnswer'),
      runtimeContract.indexOf('export interface AnswerPendingInputCommand'),
    );
    const pendingInputBlock = runtimeContract.slice(
      runtimeContract.indexOf('export interface PendingInput'),
      runtimeContract.indexOf('export type HookFailureMode'),
    );
    const outcomeBlock = runtimeContract.slice(
      runtimeContract.indexOf('export type AgentExecutionOutcome'),
      runtimeContract.indexOf('export interface Agent'),
    );
    const invocationRuntimeContextBlock = capabilityContract.slice(
      capabilityContract.indexOf('export interface CapabilityInvocationRuntimeContext'),
      capabilityContract.indexOf('export interface RuntimeCapabilityResolveRequest'),
    );
    const forbiddenGatewayConsumers = ['agent-channel-web', 'agent-core', 'agent-model', 'agent-capability']
      .flatMap((pkg) => sourceFiles(join(root, 'packages', pkg)))
      .map((path) => readFileSync(path, 'utf8'))
      .join('\n');

    expect(gatewayBlock).toContain('producerRef');
    expect(gatewayBlock).not.toContain('idempotencyKey');
    expect(gatewayBlock).not.toContain('identityContext');
    expect(gatewayBlock).not.toContain('policy');
    expect(gatewayBlock).not.toContain('risk');
    expect(gatewayBlock).not.toContain('timeoutBehavior');
    expect(gatewayBlock).not.toContain('autoApprove');
    expect(pendingInputRequestBlock).not.toContain('timeoutBehavior');
    expect(pendingInputRequestBlock).not.toContain('autoApprove');
    expect(pendingInputAnswerBlock).not.toContain('timeoutBehavior');
    expect(pendingInputAnswerBlock).not.toContain('autoApprove');
    expect(pendingInputBlock).not.toContain('timeoutBehavior');
    expect(pendingInputBlock).not.toContain('autoApprove');
    expect(gatewayBlock).not.toContain('operationScope');
    expect(`${pendingInputRequestBlock}\n${pendingInputAnswerBlock}\n${pendingInputBlock}`).not.toContain('authorizationScope');
    expect(`${gatewayBlock}\n${pendingInputRequestBlock}\n${pendingInputAnswerBlock}\n${pendingInputBlock}`).not.toMatch(
      /confirmationApproved|approvedConfirmation|operationId|permissionScope|protectedOperation|riskPolicy|policyDecision|capabilityArgs|authorizationGrant/u,
    );
    expect(`${gatewayBlock}\n${pendingInputRequestBlock}\n${pendingInputAnswerBlock}\n${pendingInputBlock}`).not.toMatch(
      /operatorId|assignment|claim|workbench|handoffQueue|externalReview|sla|SLA/u,
    );
    expect(outcomeBlock).toContain("status: 'PENDING_INPUT'");
    expect(outcomeBlock).toContain('pendingInput: PendingInputRequest');
    expect(outcomeBlock).not.toContain('producerRef');
    expect(outcomeBlock).not.toContain('toolCallId');
    expect(outcomeBlock).not.toContain('resume');
    expect(outcomeBlock).not.toContain('reason');
    expect(forbiddenGatewayConsumers).not.toMatch(/\.loadActivePendingInput\(|\.listUnresolvedPendingInputTimeoutFacts\(|\.resolvePendingInput\(/u);
    expect(invocationRuntimeContextBlock).not.toContain('requestPendingInput');
    expect(capabilityPackageSources).not.toMatch(/requestPendingInput\(|answerPendingInput\(/u);
    expect(coreToolLoopSource).not.toMatch(
      /@nextagent\/agent-capability|@nextagent\/agent-channel-web|@nextagent\/agent-platform-gateway|agent-runtime\/src|pendingProducerRegistry|PendingProducerRegistry|PolicyPort/u,
    );
    const askUserQuestionRoutingBlock = coreToolLoopSource.match(/function isCanonicalAskUserQuestionDescriptor[\s\S]*?\n\}/u)?.[0] ?? '';
    expect(askUserQuestionRoutingBlock).toContain('descriptor.provider.providerId === askUserQuestionProviderId');
    expect(askUserQuestionRoutingBlock).not.toMatch(/displayName|description|metadata|inputSchema|outputSchema/u);
    expect(toolNormalizer).toContain('descriptor.name');
    expect(toolNormalizer).not.toMatch(/AskUser(?!Question)|ask_user_question|askUserQuestion|ask_user|askUser/u);
    expect(capabilityPackageSources).not.toMatch(/confirmationApproved|approvedConfirmation|PendingInputKind\.CONFIRMATION/u);
    expect(`${gatewayContract}\n${runtimeContract}\n${forbiddenGatewayConsumers}`).not.toContain('PolicyPort');
    expect(gatewayContract).toContain('loadActivePendingInput: (request: LoadActivePendingInputRecordRequest)');
    expect(gatewayContract).toContain('listUnresolvedPendingInputTimeoutFacts: (request: AgentListUnresolvedPendingInputTimeoutFactsRequest)');
    expect(gatewayContract).not.toContain('AgentListPendingInputTimeoutCandidatesRequest');
    expect(gatewayContract).not.toContain('listPendingInputTimeoutCandidates(');
    expect(gatewayContract).not.toContain('ListDuePendingInputsRecordRequest');
    expect(gatewayContract).not.toContain('listDuePendingInputs(');
    expect(gatewayContract).toContain('ResolvePendingInputRecordOptions');
  });

  it('keeps Web control command outcomes derived from RequestRun facts', () => {
    const gatewayContract = readFileSync(join(root, 'packages', 'agent-contracts', 'src', 'gateway', 'index.ts'), 'utf8');
    const runtimeContract = readFileSync(join(root, 'packages', 'agent-contracts', 'src', 'runtime', 'index.ts'), 'utf8');
    const mockRequests = readFileSync(join(root, 'frontend', 'agent-web-mock-server', 'routes', 'requests.js'), 'utf8');

    expect(gatewayContract).not.toContain('RuntimeControlCommandOutcomeRecord');
    expect(runtimeContract).not.toContain('RuntimeControlCommandOutcomeRecord');
    expect(gatewayContract).not.toContain('CommandOutcomeStore');
    expect(runtimeContract).not.toContain('CommandOutcomeStore');
    expect(mockRequests).not.toContain('cancel-${Date.now()}');
    expect(mockRequests).toContain("code: 'IDEMPOTENCY_KEY_REQUIRED'");
  });

  it('keeps interaction workflow nodes on runtime-owned pending and projection boundaries', () => {
    const interactionSource = readFileSync(join(root, 'packages', 'agent-workflow', 'src', 'nodes', 'interaction-nodes.ts'), 'utf8');
    const workflowTypesSource = readFileSync(join(root, 'packages', 'agent-workflow', 'src', 'nodes', 'types.ts'), 'utf8');

    expect(interactionSource).toContain('context.requestPendingInput');
    expect(interactionSource).toContain('context.emitOutputDelta');
    expect(interactionSource).not.toMatch(
      /pendingInputStore|loadActivePendingInput|listUnresolvedPendingInputTimeoutFacts|resolvePendingInput|createPendingInput\(/u,
    );
    expect(interactionSource).not.toMatch(/StreamProjector|registerWebChannel|timelineStore|appendTimelineEventSync/u);
    expect(workflowTypesSource).toContain('readonly requestPendingInput?: (');
    expect(workflowTypesSource).toContain('readonly emitOutputDelta: (delta: WorkflowVisibleDelta)');
  });

  it('keeps interaction workflow nodes out of registry, dispatch, and capability side-effect ownership', () => {
    const interactionSource = readFileSync(join(root, 'packages', 'agent-workflow', 'src', 'nodes', 'interaction-nodes.ts'), 'utf8');
    const interactionImports = interactionSource
      .split('\n')
      .filter((line) => line.startsWith('import '))
      .join('\n');

    expect(interactionImports).not.toMatch(/@nextagent\/agent-core|@nextagent\/agent-app|@nextagent\/agent-capability|@nextagent\/agent-model/u);
    expect(interactionSource).toContain('options.resolveRecipeDefinition');
    expect(interactionSource).toContain('options.executeSubRecipe');
    expect(interactionSource).not.toMatch(
      /new RecipeRegistry|createCatalogBackedRuntimeCapabilityResolver|resolveCapability\(|listCapabilities\(|invokeCapability\(|model\.complete\(/u,
    );
    expect(interactionSource).not.toMatch(/selectCandidateRecipe|candidate recipe|dispatch path|main request/u);
  });

  it('resolves sub-recipe targets only through the app-provided recipe definition source', () => {
    const requestRuntimeCompositionSource = readFileSync(
      join(root, 'packages', 'agent-app', 'src', 'composition', 'request-runtime-composition.ts'),
      'utf8',
    );
    const workflowCompositionSource = readFileSync(join(root, 'packages', 'agent-app', 'src', 'composition', 'workflow-composition.ts'), 'utf8');
    const interactionSource = readFileSync(join(root, 'packages', 'agent-workflow', 'src', 'nodes', 'interaction-nodes.ts'), 'utf8');

    expect(requestRuntimeCompositionSource).toContain(
      'resolveRecipeDefinition: (request) => input.recipeDefinitionSource.require(request.agentId, request.recipeName)',
    );
    expect(workflowCompositionSource).toContain(
      'resolveRecipeDefinition: (request, recipeName) => input.recipeDefinitionSource.require(request.agentId, recipeName)',
    );
    expect(interactionSource).toContain('const recipe = resolveRecipeDefinition(context.request, recipeName);');
    expect(interactionSource).not.toMatch(
      /RecipeRegistry|recipeDefinitionSource\.list|recipeDefinitionSource\.active|recipeDefinitionSource\.resolve|recipeCache|cachedRecipe/u,
    );
  });

  it('keeps knowledge workflow nodes behind app-provided retrieval and model boundaries', () => {
    const knowledgeSource = readFileSync(join(root, 'packages', 'agent-workflow', 'src', 'nodes', 'knowledge-nodes.ts'), 'utf8');
    const knowledgeImports = knowledgeSource
      .split('\n')
      .filter((line) => line.startsWith('import '))
      .join('\n');
    const adapterSource = readFileSync(join(root, 'packages', 'agent-workflow', 'src', 'runtime-node-adapters.ts'), 'utf8');
    const localAdapterSource = readFileSync(
      join(root, 'packages', 'agent-platform-gateway-local', 'src', 'rag', 'local-workflow-rag-retrieval.ts'),
      'utf8',
    );
    const appSource = readFileSync(join(root, 'packages', 'agent-app', 'src', 'composition', 'create-app.ts'), 'utf8');
    const workflowCompositionSource = readFileSync(join(root, 'packages', 'agent-app', 'src', 'composition', 'workflow-composition.ts'), 'utf8');

    expect(knowledgeImports).not.toMatch(
      /@nextagent\/agent-contracts\/gateway|@nextagent\/agent-platform-gateway-local|@nextagent\/agent-platform-gateway-remote/u,
    );
    expect(knowledgeSource).toContain('options.retrieveKnowledge');
    expect(knowledgeSource).toContain('requireModelInvocation(options.modelInvocation)');
    expect(adapterSource).toContain('createWorkflowRagKnowledgeRetrieverAdapter');
    expect(adapterSource).toContain('createWorkflowGuardrailLifecycleHookAdapter');
    expect(adapterSource).toContain('resolveRagRetrievalGateway(options.gateway).retrieve');
    expect(adapterSource).toContain('@nextagent/agent-contracts/gateway');
    expect(adapterSource).not.toMatch(/@nextagent\/agent-platform-gateway-local|@nextagent\/agent-platform-gateway-remote/u);
    expect(localAdapterSource).toContain('createLocalWorkflowRagGateway');
    expect(localAdapterSource).not.toMatch(/@nextagent\/agent-workflow/u);
    expect(appSource).toContain('composeWorkflowExecutionLayer({');
    expect(workflowCompositionSource).toContain('retrieveKnowledge: createWorkflowRagKnowledgeRetrieverAdapter({');
    expect(workflowCompositionSource).toContain(
      'evaluateGuardrail: createWorkflowGuardrailLifecycleHookAdapter({ lifecycleHook: input.lifecycleHook })',
    );
    expect(appSource).not.toContain('retrieveKnowledge: async (request, signal) => {');
    expect(appSource).not.toContain('evaluateGuardrail: async (request, signal) => {');
  });

  it('keeps knowledge choice nodes on selection semantics without dispatch or side-effect execution', () => {
    const knowledgeSource = readFileSync(join(root, 'packages', 'agent-workflow', 'src', 'nodes', 'knowledge-nodes.ts'), 'utf8');

    expect(knowledgeSource).not.toMatch(
      /executeSubRecipe\(|executeRestfulNode\(|createRequestLifecycleCoordinator|RecipeRegistry|recipeDefinitionSource\.require/u,
    );
    expect(knowledgeSource).toContain('api_name: apiName');
    expect(knowledgeSource).not.toContain('api_choice_result');
    expect(knowledgeSource).toContain('recipe_choice_result');
    expect(knowledgeSource).toContain('toolCalls?.[0]');
  });
});

describe('runtime logger component ownership', () => {
  it('binds direct product loggers to their owning package component', () => {
    const violations: string[] = [];
    const packageRoot = join(root, 'packages');
    for (const packageEntry of readdirSync(packageRoot, { withFileTypes: true })) {
      if (!packageEntry.isDirectory() || !packageEntry.name.startsWith('agent-')) {
        continue;
      }
      const src = join(packageRoot, packageEntry.name, 'src');
      for (const file of sourceFiles(src)) {
        const source = readFileSync(file, 'utf8');
        const bindingPattern = /(?:getLogger|createRuntimeLogger)\(\{\s*component:\s*'([^']+)'/gu;
        for (const match of source.matchAll(bindingPattern)) {
          if (match[1] !== packageEntry.name) {
            violations.push(`${file}:${match[1]}!=${packageEntry.name}`);
          }
        }
      }
    }
    expect(violations).toEqual([]);
  });
});

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      return sourceFiles(path);
    }
    return entry.isFile() && path.endsWith('.ts') ? [path] : [];
  });
}
