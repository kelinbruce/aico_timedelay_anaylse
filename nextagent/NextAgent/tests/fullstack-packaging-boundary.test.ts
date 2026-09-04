import { frontendHostingPlugin, validateFrontendHostingManifest } from '@nextagent/agent-app-frontend-hosting';
import { createDeveloperHookTracePluginArtifact } from '@nextagent/agent-plugin-sdk/developer-hook-trace';
import { createNorthboundOutputNormalizationPluginArtifact } from '@nextagent/agent-plugin-sdk/northbound-output-normalization-hook';
import Fastify from 'fastify';
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { dump as stringifyYaml, load as parseYaml } from 'js-yaml';
import { describe, expect, it } from 'vitest';
import { loadPluginRegistrySnapshot } from '../packages/agent-app/src/plugin/plugin-loader.js';

const root = process.cwd();
const productVersion = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version as string;

interface ReleaseConfigSample {
  modelProfiles: Array<{
    providerId: string;
    baseUrl: string;
    credentialRef: string;
    models: Array<{ modelId: string }>;
  }>;
  nextAgent: { system: { plugins: Array<{ pluginId: string; path: string; required: boolean }> } };
}

describe('fullstack packaging boundary', () => {
  it('validates product manifests, product version, toolchain, and shared dependency lockstep', async () => {
    const { validateFullstackPackaging } = await importValidationScript();

    expect(validateFullstackPackaging(root)).toEqual([]);

    const fixture = createPackagingFixture();
    expect(validateFullstackPackaging(fixture)).toEqual([]);

    mutateJson(join(fixture, 'packages', 'agent-app', 'manifests', 'backend-only.package.json'), (manifest) => {
      manifest.dependencies['@nextagent/agent-web'] = '0.1.0';
    });
    expect(validateFullstackPackaging(fixture)).toContain('backend-only.package.json must not declare @nextagent/agent-web.');

    const backendLocalAuthFixture = createPackagingFixture();
    mutateJson(join(backendLocalAuthFixture, 'packages', 'agent-app', 'manifests', 'backend-only.package.json'), (manifest) => {
      manifest.dependencies['@nextagent/agent-channel-web-auth-local'] = '0.1.0';
    });
    expect(validateFullstackPackaging(backendLocalAuthFixture)).toContain(
      'backend-only.package.json must not declare @nextagent/agent-channel-web-auth-local.',
    );

    const frontendLocalAuthFixture = createPackagingFixture();
    mutateJson(join(frontendLocalAuthFixture, 'packages', 'agent-app', 'manifests', 'with-frontend.package.json'), (manifest) => {
      manifest.dependencies['@nextagent/agent-channel-web-auth-local'] = '0.1.0';
    });
    expect(validateFullstackPackaging(frontendLocalAuthFixture)).toContain(
      'with-frontend.package.json must not declare @nextagent/agent-channel-web-auth-local.',
    );

    const missingLocalAuthFixture = createPackagingFixture();
    mutateJson(join(missingLocalAuthFixture, 'packages', 'agent-app', 'manifests', 'local-configured-auth.package.json'), (manifest) => {
      delete manifest.dependencies['@nextagent/agent-channel-web-auth-local'];
    });
    expect(validateFullstackPackaging(missingLocalAuthFixture)).toContain(
      'local-configured-auth.package.json must declare @nextagent/agent-channel-web-auth-local.',
    );

    const versionDriftFixture = createPackagingFixture();
    mutateJson(join(versionDriftFixture, 'packages', 'agent-app', 'manifests', 'with-frontend.package.json'), (manifest) => {
      manifest.dependencies['@nextagent/agent-web'] = '0.2.0';
    });
    expect(validateFullstackPackaging(versionDriftFixture)).toContain(
      'with-frontend.package.json must declare @nextagent/agent-web with the exact root package version.',
    );

    const toolchainDriftFixture = createPackagingFixture();
    mutateJson(join(toolchainDriftFixture, 'frontend', 'agent-web', 'package.json'), (manifest) => {
      manifest.devDependencies.typescript = '5.5.4';
    });
    expect(validateFullstackPackaging(toolchainDriftFixture)).toContain(
      'frontend/agent-web devDependencies.typescript must match root package.json devDependencies.typescript.',
    );

    const sharedDependencyDriftFixture = createPackagingFixture();
    mutateJson(join(sharedDependencyDriftFixture, 'packages', 'agent-app-frontend-hosting', 'package.json'), (manifest) => {
      manifest.dependencies['@sinclair/typebox'] = '^1.0.0';
    });
    expect(validateFullstackPackaging(sharedDependencyDriftFixture)).toContain(
      '@sinclair/typebox must use the same version across packages/agent-app, packages/agent-app-frontend-hosting.',
    );
  });

  it('requires installed and artifact frontend package versions to match the root product version', async () => {
    const { validateFullstackPackaging } = await importValidationScript();
    const fixture = createPackagingFixture();

    mkdirSync(join(fixture, 'dist', 'dev', 'agent-web-package'), { recursive: true });
    writeJson(join(fixture, 'dist', 'dev', 'agent-web-package', 'package.json'), {
      name: '@nextagent/agent-web',
      version: '0.2.0',
    });
    expect(validateFullstackPackaging(fixture, { artifactPackagePath: join(fixture, 'dist', 'dev', 'agent-web-package') })).toContain(
      '@nextagent/agent-web artifact package version must equal root package.json version.',
    );

    expect(validateFullstackPackaging(fixture, { checkInstalledFrontendPackage: true })).toContain(
      'Installed @nextagent/agent-web package is required for with-frontend.',
    );

    mkdirSync(join(fixture, 'node_modules', '@nextagent', 'agent-web'), { recursive: true });
    writeJson(join(fixture, 'node_modules', '@nextagent', 'agent-web', 'package.json'), {
      name: '@nextagent/agent-web',
      version: '0.2.0',
    });
    expect(validateFullstackPackaging(fixture, { checkInstalledFrontendPackage: true })).toContain(
      'Installed @nextagent/agent-web package version must equal root package.json version.',
    );
  });

  it('validates formal agent-web artifact allowlist and PIU sidecar assets', async () => {
    const { validateFullstackPackaging } = await importValidationScript();
    const fixture = createPackagingFixture();
    createAgentWebArtifactFixture(fixture, productVersion);
    const artifactRoot = join(fixture, 'dist', 'dev', 'agent-web-package');

    expect(validateFullstackPackaging(fixture, { artifactPackagePath: artifactRoot })).toEqual([]);

    writeFileSync(join(artifactRoot, 'dist', 'collaborative.html'), '<!doctype html>', 'utf8');
    expect(validateFullstackPackaging(fixture, { artifactPackagePath: artifactRoot })).toContain(
      '@nextagent/agent-web artifact must not include collaborative.html.',
    );

    const extraPiuFixture = createPackagingFixture();
    createAgentWebArtifactFixture(extraPiuFixture, productVersion);
    const extraArtifactRoot = join(extraPiuFixture, 'dist', 'dev', 'agent-web-package');
    writeFileSync(join(extraArtifactRoot, 'dist', 'piu', 'chunk.js'), 'export {};\n', 'utf8');
    expect(validateFullstackPackaging(extraPiuFixture, { artifactPackagePath: extraArtifactRoot })).toContain(
      '@nextagent/agent-web artifact piu directory must contain only AIAgentPIU.js and AIAgentPIU.css.',
    );

    expectAgentWebArtifactFailure(
      validateFullstackPackaging,
      (artifactRoot) => {
        writeFileSync(join(artifactRoot, 'dist', 'piu', 'AIAgentPIU.js'), "import('./chunk.js');\n", 'utf8');
      },
      'AIAgentPIU.js must not reference extra JavaScript chunks through dynamic import.',
    );

    expectAgentWebArtifactFailure(
      validateFullstackPackaging,
      (artifactRoot) => {
        writeFileSync(
          join(artifactRoot, 'dist', 'piu', 'AIAgentPIU.js'),
          "const script = document.createElement('script'); script.src = './extra.js'; document.head.appendChild(script);\n",
          'utf8',
        );
      },
      'AIAgentPIU.js must not inject additional script assets.',
    );

    expectAgentWebArtifactFailure(
      validateFullstackPackaging,
      (artifactRoot) => {
        writeFileSync(join(artifactRoot, 'dist', 'piu', 'AIAgentPIU.js'), "const manifest = 'manifest.json';\n", 'utf8');
      },
      'AIAgentPIU.js must not reference a runtime asset manifest.',
    );

    expectAgentWebArtifactFailure(
      validateFullstackPackaging,
      (artifactRoot) => {
        writeFileSync(join(artifactRoot, 'dist', 'piu', 'AIAgentPIU.css'), "@import './extra.css';\n", 'utf8');
      },
      'AIAgentPIU.css must not import additional stylesheets.',
    );

    const localIndexFixture = createPackagingFixture();
    createAgentWebArtifactFixture(localIndexFixture, productVersion);
    const localIndexArtifactRoot = join(localIndexFixture, 'dist', 'dev', 'agent-web-package');
    writeFileSync(
      join(localIndexArtifactRoot, 'dist', 'index.html'),
      '<!doctype html><script type="module" src="/src/entries/local.tsx"></script>',
      'utf8',
    );
    expect(validateFullstackPackaging(localIndexFixture, { artifactPackagePath: localIndexArtifactRoot })).toContain(
      '@nextagent/agent-web artifact index.html must be the immersive entry and include the fixed Prel loader.',
    );
  });

  it('serves frontend assets and never lets SPA fallback own backend routes', async () => {
    const fixture = createFrontendPackageFixture();
    const server = Fastify({ logger: false });
    server.get('/api/v1/sessions/:sessionId/stream', async () => 'backend stream');
    await server.register(frontendHostingPlugin, {
      manifest: {
        packageRoot: fixture.packageRoot,
        assetRoot: 'dist',
        indexHtml: 'dist/index.html',
        routeBase: '/',
        spaFallback: true,
      },
    });

    const api = await server.inject({ method: 'GET', url: '/api/v1/sessions/abc/stream' });
    expect(api.statusCode).toBe(200);
    expect(api.body).toBe('backend stream');

    const missingApi = await server.inject({ method: 'GET', url: '/api/v1/not-a-frontend-route' });
    expect(missingApi.statusCode).toBe(404);
    expect(missingApi.headers['content-type']).not.toContain('text/html');

    const control = await server.inject({ method: 'GET', url: '/control/health' });
    expect(control.statusCode).toBe(404);
    expect(control.headers['content-type']).not.toContain('text/html');

    const asset = await server.inject({ method: 'GET', url: '/assets/app.js' });
    expect(asset.statusCode).toBe(200);
    expect(asset.headers['content-type']).toContain('text/javascript');
    expect(asset.body).toContain('agent web asset');

    const preludeLoader = await server.inject({ method: 'GET', url: '/febs/v1/assets/prelude-loader' });
    expect(preludeLoader.statusCode).toBe(200);
    expect(preludeLoader.headers['content-type']).toContain('text/javascript');
    expect(preludeLoader.body).toContain('window.Prel');
    expect(preludeLoader.body).toContain('/piu/AIAgentPIU.js');
    expect(preludeLoader.body).not.toContain('<!doctype html');

    const fallback = await server.inject({ method: 'GET', url: '/sessions/abc' });
    expect(fallback.statusCode).toBe(200);
    expect(fallback.headers['content-type']).toContain('text/html');
    expect(fallback.body).toContain('NextAgent web shell');
    expect(fallback.body).not.toContain('agent-dev-workbench');

    await server.close();
  });

  it('injects only validated trusted index scripts into hosted HTML', async () => {
    const fixture = createFrontendPackageFixture();
    const manifest = {
      packageRoot: fixture.packageRoot,
      assetRoot: 'dist',
      indexHtml: 'dist/index.html',
      routeBase: '/',
      spaFallback: true,
    };
    const server = Fastify({ logger: false });
    await server.register(frontendHostingPlugin, {
      manifest,
      indexHtmlScripts: ['/__nextagent/dev/workbench/launcher.js'],
    });

    const fallback = await server.inject({ method: 'GET', url: '/session/example' });
    expect(fallback.statusCode).toBe(200);
    expect(fallback.body).toContain('<script src="/__nextagent/dev/workbench/launcher.js"></script>');
    await server.close();

    const invalidServer = Fastify({ logger: false });
    await expect(
      invalidServer.register(frontendHostingPlugin, {
        manifest,
        indexHtmlScripts: ['https://example.invalid/launcher.js'],
      }),
    ).rejects.toThrow('Invalid frontend hosting index script contribution');
    await invalidServer.close();
  });

  it('fails closed for invalid frontend hosting manifests', () => {
    const fixture = createFrontendPackageFixture();
    const valid = {
      packageRoot: fixture.packageRoot,
      assetRoot: 'dist',
      indexHtml: 'dist/index.html',
      routeBase: '/',
      spaFallback: true,
    };

    expect(validateFrontendHostingManifest(valid).resolvedIndexHtml).toBe(resolve(fixture.packageRoot, 'dist', 'index.html'));
    expect(() => validateFrontendHostingManifest({ ...valid, assetRoot: '../dist' })).toThrow(/package-root relative/u);
    expect(() => validateFrontendHostingManifest({ ...valid, indexHtml: '/tmp/index.html' })).toThrow(/package-root relative/u);
    expect(() => validateFrontendHostingManifest({ ...valid, routeBase: 'app' })).toThrow(/routeBase/u);
    expect(() => validateFrontendHostingManifest({ ...valid, indexHtml: 'dist/missing.html' })).toThrow(/existing file/u);
    expect(() => validateFrontendHostingManifest({ ...valid, spaFallback: 'true' })).toThrow(/schema/u);
  });

  it('keeps backend-only and frontend-enabled entrypoint dependency graphs separate', () => {
    const backendOnlySource = readFileSync(join(root, 'packages', 'agent-app', 'src', 'entrypoints', 'backend-only.ts'), 'utf8');
    const withFrontendSource = readFileSync(join(root, 'packages', 'agent-app', 'src', 'entrypoints', 'with-frontend.ts'), 'utf8');
    const withFrontendFinalizerSource = readFileSync(join(root, 'packages', 'agent-app', 'src', 'entrypoints', 'with-frontend-finalizer.ts'), 'utf8');
    const withFrontendProfileSource = `${withFrontendSource}\n${withFrontendFinalizerSource}`;
    const appSourceFiles = sourceFiles(join(root, 'packages', 'agent-app', 'src'));

    expect(backendOnlySource).not.toContain('@nextagent/agent-app-frontend-hosting');
    expect(backendOnlySource).not.toContain('@nextagent/agent-web');
    expect(withFrontendProfileSource).toContain('@nextagent/agent-app-frontend-hosting');
    expect(withFrontendProfileSource).toContain('@nextagent/agent-web/hosting');

    for (const file of appSourceFiles) {
      const source = readFileSync(file, 'utf8');
      expect(source, file).not.toContain('frontend/agent-web');
      if (
        !file.endsWith(join('entrypoints', 'with-frontend.ts')) &&
        !file.endsWith(join('entrypoints', 'with-frontend-finalizer.ts')) &&
        !file.endsWith(join('types', 'agent-web-hosting.d.ts')) &&
        !file.endsWith(join('local-runtime-package', 'index.ts'))
      ) {
        expect(source, file).not.toContain('@nextagent/agent-web');
      }
    }
  });

  it('packs with-frontend by default and stages frontend artifact into the runtime package', async () => {
    const {
      parsePackArgs,
      stagePackageDependencies,
      stagePackagedDefaultAgent,
      stagePackagedDeveloperHookTracePlugin,
      stagePackagedContextMonitorPlugin,
      stagePackagedAgentRouterPlugin,
      stagePackagedNorthboundOutputNormalizationPlugin,
      stageFrontendOnlyPackage,
      resolvePackageTarget,
    } = await importPackScript();
    const fixture = createPackagingFixture();
    const packageRoot = join(fixture, 'candidate');

    expect(parsePackArgs(['.package', 'candidate-1'])).toMatchObject({
      packageRootArg: '.package',
      candidateId: 'candidate-1',
      versionArg: undefined,
      packageProfile: 'with-frontend',
      skipReleaseGateVerification: false,
      stageDefaultAgent: false,
      excludedBuiltinSkills: [],
    });
    expect(parsePackArgs(['.package', 'candidate-1', 'backend-only'])).toMatchObject({ packageProfile: 'backend-only' });
    expect(parsePackArgs(['.package', 'candidate-1', '0.1.0', 'backend-only'])).toMatchObject({
      versionArg: '0.1.0',
      packageProfile: 'backend-only',
    });
    expect(parsePackArgs(['.package', 'candidate-1', 'skip'])).toMatchObject({
      packageProfile: 'with-frontend',
      skipReleaseGateVerification: true,
    });
    expect(parsePackArgs(['.package', 'candidate-1', 'with-frontend', 'skip'])).toMatchObject({
      packageProfile: 'with-frontend',
      skipReleaseGateVerification: true,
    });
    expect(parsePackArgs(['.package', 'candidate-1', '0.1.0', 'with-frontend', 'skip'])).toMatchObject({
      versionArg: '0.1.0',
      packageProfile: 'with-frontend',
      skipReleaseGateVerification: true,
    });
    expect(parsePackArgs(['.package', 'candidate-1', 'with-frontend', '--exclude-builtin-skill', 'sample-skill'])).toMatchObject({
      packageProfile: 'with-frontend',
      excludedBuiltinSkills: ['sample-skill'],
    });
    expect(parsePackArgs(['.package', 'candidate-1', '0.1.0', 'with-frontend', 'skip', '--exclude-builtin-skill', 'sample-skill'])).toMatchObject({
      versionArg: '0.1.0',
      packageProfile: 'with-frontend',
      skipReleaseGateVerification: true,
      excludedBuiltinSkills: ['sample-skill'],
    });
    expect(parsePackArgs(['dist/pack', 'nextagent-local', 'with-frontend', '--stage-default-agent'])).toMatchObject({
      packageProfile: 'with-frontend',
      stageDefaultAgent: true,
    });

    createRuntimeDependencyFixture(fixture);
    createAgentWebArtifactFixture(fixture, productVersion);
    stagePackageDependencies(fixture, packageRoot, 'with-frontend', productVersion);
    expect(existsSync(join(packageRoot, 'agents', '.keep'))).toBe(true);
    mkdirSync(join(packageRoot, 'config'), { recursive: true });
    writeFileSync(
      join(packageRoot, 'config', 'default-system.yaml'),
      stringifyYaml({ paths: { agentRoot: 'abc/agents', skillRoot: 'abc/skills' } }),
      'utf8',
    );
    stagePackagedDeveloperHookTracePlugin(fixture, packageRoot, createDeveloperHookTracePluginArtifact);
    writeFileSync(join(packageRoot, 'config', 'default-agent.yaml'), 'stale duplicate\n', 'utf8');
    stagePackagedDefaultAgent(fixture, packageRoot);

    expect(existsSync(join(packageRoot, 'config', 'plugins', 'developer-hook-trace', 'plugin.json'))).toBe(true);
    expect(existsSync(join(packageRoot, 'config', 'plugins', 'developer-hook-trace', 'index.js'))).toBe(true);
    expect(existsSync(join(packageRoot, 'config', 'plugins', 'developer-hook-trace', 'trace-viewer.html'))).toBe(true);
    expect(existsSync(join(packageRoot, 'config', 'default-agent.yaml'))).toBe(false);
    expect(existsSync(join(packageRoot, 'abc', 'agents', 'default-agent', 'agent.yaml'))).toBe(true);
    const packagedConfig = parseYaml(readFileSync(join(packageRoot, 'config', 'default-system.yaml'), 'utf8')) as {
      nextAgent?: { system?: { plugins?: unknown } };
      developerDiagnostics?: unknown;
    };
    expect(packagedConfig.nextAgent?.system?.plugins).toBeUndefined();
    expect(packagedConfig.developerDiagnostics).toBeUndefined();

    stagePackagedContextMonitorPlugin(packageRoot, (options) => {
      mkdirSync(options.targetDirectory, { recursive: true });
      writeJson(join(options.targetDirectory, 'plugin.json'), {
        pluginId: 'context-monitor',
        version: '1.0.0',
        apiVersion: '1.1',
        main: './index.js',
        artifactType: 'esm-bundle',
        hostExternals: [],
      });
      writeFileSync(join(options.targetDirectory, 'index.js'), 'export default {};\n', 'utf8');
    });
    expect(existsSync(join(packageRoot, 'config', 'plugins', 'context-monitor', 'plugin.json'))).toBe(true);
    expect(existsSync(join(packageRoot, 'config', 'plugins', 'context-monitor', 'index.js'))).toBe(true);
    const repackagedConfig = parseYaml(readFileSync(join(packageRoot, 'config', 'default-system.yaml'), 'utf8')) as {
      nextAgent?: { system?: { plugins?: unknown } };
    };
    expect(repackagedConfig.nextAgent?.system?.plugins).toBeUndefined();

    stagePackagedAgentRouterPlugin(packageRoot, (options) => {
      mkdirSync(options.targetDirectory, { recursive: true });
      writeJson(join(options.targetDirectory, 'plugin.json'), {
        pluginId: 'agent-router-plugin',
        version: '1.0.0',
        apiVersion: '1.2',
        main: './index.js',
        artifactType: 'esm-bundle',
        hostExternals: [],
      });
      writeFileSync(
        join(options.targetDirectory, 'index.js'),
        "export default (host) => ({ apiVersion: '1.2', pluginId: 'agent-router-plugin', policies: [{ policyId: 'agent-router-plugin.auto-routing' }], runtime: host.runtime });\n",
        'utf8',
      );
    });
    const routerPluginRoot = join(packageRoot, 'config', 'plugins', 'agent-router-plugin');
    expect(JSON.parse(readFileSync(join(routerPluginRoot, 'plugin.json'), 'utf8'))).toEqual({
      pluginId: 'agent-router-plugin',
      version: '1.0.0',
      apiVersion: '1.2',
      main: './index.js',
      artifactType: 'esm-bundle',
      hostExternals: [],
    });
    expect(readFileSync(join(routerPluginRoot, 'index.js'), 'utf8')).toContain('agent-router-plugin.auto-routing');
    expect(repackagedConfig.nextAgent?.system?.plugins).toBeUndefined();
    stagePackagedNorthboundOutputNormalizationPlugin(packageRoot, createNorthboundOutputNormalizationPluginArtifact);
    const northboundPluginRoot = join(packageRoot, 'config', 'plugins', 'northbound-output-normalization-hook');
    expect(existsSync(join(northboundPluginRoot, 'plugin.json'))).toBe(true);
    expect(existsSync(join(northboundPluginRoot, 'index.js'))).toBe(true);
    const pluginSnapshot = await loadPluginRegistrySnapshot(
      [{ pluginId: 'northbound-output-normalization-hook', path: 'plugins/northbound-output-normalization-hook', required: true }],
      join(packageRoot, 'config'),
    );
    expect(pluginSnapshot.plugins).toEqual([{ pluginId: 'northbound-output-normalization-hook', version: '1.0.0' }]);
    expect(pluginSnapshot.hooks).toHaveLength(1);
    const configAfterNorthboundStaging = parseYaml(readFileSync(join(packageRoot, 'config', 'default-system.yaml'), 'utf8')) as {
      nextAgent?: { system?: { plugins?: unknown } };
    };
    expect(configAfterNorthboundStaging.nextAgent?.system?.plugins).toBeUndefined();
    const packagedAgent = JSON.parse(readFileSync(join(packageRoot, 'abc', 'agents', 'default-agent', 'agent.yaml'), 'utf8')) as {
      policies?: Array<{ pluginId?: string; policyId?: string }>;
      hooks?: Array<{ hookId?: string }>;
    };
    expect(packagedAgent.policies ?? []).not.toContainEqual(
      expect.objectContaining({ pluginId: 'agent-router-plugin', policyId: 'agent-router-plugin.auto-routing' }),
    );
    expect(packagedAgent.hooks ?? []).not.toContainEqual(expect.objectContaining({ hookId: 'northbound-output-normalization-hook' }));

    const frontendOnlyPackageRoot = join(fixture, 'frontend-only-candidate');
    stageFrontendOnlyPackage(
      fixture,
      frontendOnlyPackageRoot,
      'frontend-only-candidate',
      productVersion,
      resolvePackageTarget(process.platform, process.arch),
    );
    expect(existsSync(join(frontendOnlyPackageRoot, 'config', 'plugins', 'northbound-output-normalization-hook'))).toBe(false);
    expect(existsSync(join(packageRoot, 'node_modules', '@nextagent', 'agent-web', 'package.json'))).toBe(true);
    expect(existsSync(join(packageRoot, 'node_modules', '@nextagent', 'agent-web', 'hosting.js'))).toBe(true);
    expect(existsSync(join(packageRoot, 'node_modules', '@nextagent', 'agent-web', 'dist', 'index.html'))).toBe(true);
    expect(existsSync(join(packageRoot, 'node_modules', '@nextagent', 'agent-app', 'dist', 'index.js'))).toBe(true);
    expect(existsSync(join(packageRoot, 'node_modules', '@nextagent', 'agent-core', 'dist', 'index.js'))).toBe(true);
    expect(existsSync(join(packageRoot, 'node_modules', '@nextagent', 'agent-core', 'dist', 'builtin-agents', 'default-agent', 'agent.yaml'))).toBe(
      true,
    );
    expect(existsSync(join(packageRoot, 'node_modules', '@nextagent', 'agent-platform-gateway-local', 'package.json'))).toBe(true);
    expect(existsSync(join(packageRoot, 'node_modules', '@nextagent', 'agent-platform-gateway-local', 'dist', 'index.js'))).toBe(true);
    expect(existsSync(join(packageRoot, 'node_modules', 'runtime-peer-provider', 'package.json'))).toBe(true);
    expect(existsSync(join(packageRoot, 'node_modules', 'zod', 'package.json'))).toBe(true);
    expect(existsSync(join(packageRoot, 'node_modules', '@nextagent', 'agent-capability', 'dist', 'builtins', 'skills', 'telecom-domain-qa'))).toBe(
      false,
    );
    expect(existsSync(join(packageRoot, 'node_modules', '@nextagent', 'agent-capability', 'dist', 'builtins', 'skills', 'skill-creator'))).toBe(true);
    for (const forbiddenPackage of ['@nextagent/agent-dev-workbench', 'antd', 'playwright-core', 'typescript', 'vite']) {
      expect(existsSync(join(packageRoot, 'node_modules', ...forbiddenPackage.split('/'))), forbiddenPackage).toBe(false);
    }
    expect(existsSync(join(packageRoot, 'abc', 'agents', 'default-agent', 'agent.yaml'))).toBe(true);
    expect(existsSync(join(packageRoot, 'agents', 'default-agent', 'agent.yaml'))).toBe(false);
    expect(existsSync(join(packageRoot, 'abc', 'skills', 'telecom-domain-qa', 'SKILL.md'))).toBe(false);
    expect(existsSync(join(packageRoot, 'skills', 'telecom-domain-qa', 'SKILL.md'))).toBe(false);

    const sourceAgentPath = join(fixture, 'packages', 'agent-core', 'src', 'builtin-agents', 'default-agent', 'agent.yaml');
    const sourceAgentContent = readFileSync(sourceAgentPath, 'utf8');
    stagePackagedDefaultAgent(fixture, packageRoot);
    expect(existsSync(join(packageRoot, 'abc', 'agents', 'default-agent', 'agent.yaml'))).toBe(true);
    const stagedAgent = parseYaml(readFileSync(join(packageRoot, 'abc', 'agents', 'default-agent', 'agent.yaml'), 'utf8')) as {
      agentId?: unknown;
      hooks?: unknown;
    };
    expect(stagedAgent.agentId).toBe('default-agent');
    expect(stagedAgent.hooks).toEqual([
      {
        hookId: 'developer-hook-trace.loop-raw-boundary',
        enabled: true,
        stages: ['BEFORE_PLANNING', 'AFTER_MODEL_RESULT', 'BEFORE_CAPABILITY_INVOKE', 'AFTER_CAPABILITY_RESULT', 'BEFORE_AGENT_TERMINAL'],
      },
    ]);
    expect(readFileSync(sourceAgentPath, 'utf8')).toBe(sourceAgentContent);
    expect(existsSync(join(packageRoot, 'agents', 'default-agent', 'agent.yaml'))).toBe(false);
    expect(existsSync(join(packageRoot, 'config', 'default-agent.yaml'))).toBe(false);

    const backendOnlyRoot = join(fixture, 'backend-only-candidate');
    stagePackageDependencies(fixture, backendOnlyRoot, 'backend-only', productVersion);
    expect(existsSync(join(backendOnlyRoot, 'node_modules', '@nextagent', 'agent-web'))).toBe(false);
    expect(existsSync(join(backendOnlyRoot, 'node_modules', '@nextagent', 'agent-platform-gateway-local', 'dist', 'index.js'))).toBe(true);
  });

  it('excludes OpenAI-compatible provider artifacts in model-gateway-only packages', async () => {
    const { formatPackFailure, parsePackArgs, stagePackageDependencies } = await importPackScript();
    const fixture = createPackagingFixture();
    const defaultRoot = join(fixture, 'default-candidate');
    const gatewayOnlyRoot = join(fixture, 'gateway-only-candidate');

    expect(
      parsePackArgs(['.package', 'candidate-1', 'backend-only', '--model-gateway-only', '--config-sample', 'gateway-system.yaml']),
    ).toMatchObject({
      packageProfile: 'backend-only',
      modelGatewayOnly: true,
      configSamplePath: 'gateway-system.yaml',
    });

    createRuntimeDependencyFixture(fixture);
    stagePackageDependencies(fixture, defaultRoot, 'backend-only', productVersion);
    stagePackageDependencies(fixture, gatewayOnlyRoot, 'backend-only', productVersion, { modelGatewayOnly: true });

    const defaultModelPackage = join(defaultRoot, 'node_modules', '@nextagent', 'agent-model');
    const gatewayOnlyModelPackage = join(gatewayOnlyRoot, 'node_modules', '@nextagent', 'agent-model');
    const providerInvocation = join('dist', 'providers', 'openai-compatible', 'openai-compatible-provider.js');
    const providerRegistration = join('dist', 'providers', 'openai-compatible', 'registration.js');
    const toolUseNormalizer = join('dist', 'providers', 'shared', 'tool-use-normalizer.js');

    expect(existsSync(join(defaultModelPackage, providerInvocation))).toBe(true);
    expect(existsSync(join(defaultModelPackage, toolUseNormalizer))).toBe(true);
    expect(existsSync(join(defaultRoot, 'node_modules', '@ai-sdk', 'openai-compatible'))).toBe(true);
    expect(existsSync(join(defaultRoot, 'node_modules', 'ai'))).toBe(true);

    expect(existsSync(join(gatewayOnlyModelPackage, providerInvocation))).toBe(false);
    expect(existsSync(join(gatewayOnlyModelPackage, toolUseNormalizer))).toBe(false);
    expect(existsSync(join(gatewayOnlyModelPackage, providerRegistration))).toBe(true);
    expect(existsSync(join(gatewayOnlyRoot, 'node_modules', '@ai-sdk', 'openai-compatible'))).toBe(false);
    expect(existsSync(join(gatewayOnlyRoot, 'node_modules', 'ai'))).toBe(false);
    expect(JSON.parse(readFileSync(join(gatewayOnlyModelPackage, 'package.json'), 'utf8'))).not.toHaveProperty(
      'dependencies.@ai-sdk/openai-compatible',
    );
    expect(formatPackFailure(Object.assign(new Error('incompatible provider'), { code: 'MODEL_PROVIDER_BUILD_PROFILE_INCOMPATIBLE' }))).toBe(
      JSON.stringify({ status: 'failed', diagnostics: [{ code: 'MODEL_PROVIDER_BUILD_PROFILE_INCOMPATIBLE' }] }),
    );
  });

  it('fails closed when local runtime packaging cannot stage the local gateway package', async () => {
    const { stagePackageDependencies } = await importPackScript();
    const fixture = createPackagingFixture();
    mkdirSync(join(fixture, 'node_modules'), { recursive: true });
    writeFileSync(join(fixture, 'node_modules', '.keep'), '', 'utf8');
    createWorkspaceDistFixture(fixture, 'agent-app', '@nextagent/agent-app');

    expect(() => stagePackageDependencies(fixture, join(fixture, 'candidate'), 'backend-only', productVersion)).toThrow(
      /@nextagent\/agent-platform-gateway-local/u,
    );
  });

  it('fails closed when a staged runtime package omits a nested runtime export', async () => {
    const { stagePackageDependencies } = await importPackScript();
    const fixture = createPackagingFixture();
    createRuntimeDependencyFixture(fixture);
    mutateJson(join(fixture, 'packages', 'agent-app', 'package.json'), (manifest) => {
      manifest.exports = { '.': { import: './dist/index.js' }, './engine': { import: './dist/engine/index.js' } };
    });

    expect(() => stagePackageDependencies(fixture, join(fixture, 'candidate'), 'backend-only', productVersion)).toThrow(
      'Local runtime package @nextagent/agent-app is missing staged runtime export ./dist/engine/index.js.',
    );
  });

  it('fails closed when with-frontend packaging cannot find a frontend artifact package', async () => {
    const { stagePackageDependencies } = await importPackScript();
    const fixture = createPackagingFixture();
    createRuntimeDependencyFixture(fixture);

    expect(() => stagePackageDependencies(fixture, join(fixture, 'candidate'), 'with-frontend', '0.1.0')).toThrow(
      /agent-web artifact package is required/u,
    );
  });

  it('selects explicit OS package archive names and compression commands', async () => {
    const { createPackageArchive, qualifyCandidateId, resolvePackageTarget } = await importPackScript();
    const fixture = createPackagingFixture();
    const packageRoot = join(fixture, 'candidate');
    mkdirSync(packageRoot, { recursive: true });
    writeFileSync(join(packageRoot, 'candidate-manifest.json'), '{}', 'utf8');
    const calls: Array<{ command: string; args: string[]; env?: NodeJS.ProcessEnv }> = [];
    const runner = (command: string, args: string[], options: { env?: NodeJS.ProcessEnv }) => {
      calls.push(options.env === undefined ? { command, args } : { command, args, env: options.env });
      return { status: 0, stdout: '', stderr: '' };
    };

    const winTarget = resolvePackageTarget('win32', 'x64');
    const winCandidateId = qualifyCandidateId('nextagent-local-20260608220000', winTarget);
    expect(winCandidateId).toBe('nextagent-local-20260608220000-win32-x64');
    expect(createPackageArchive(fixture, packageRoot, winCandidateId, winTarget, runner)).toBe(
      join(fixture, 'nextagent-local-20260608220000-win32-x64.zip'),
    );
    expect(calls.at(-1)).toMatchObject({ command: 'powershell' });
    expect(calls.at(-1)?.args.join(' ')).toContain('System.IO.Compression.ZipFile');
    expect(calls.at(-1)?.env?.NEXTAGENT_PACKAGE_ROOT).toBe(packageRoot);

    const linuxTarget = resolvePackageTarget('linux', 'x64');
    const linuxCandidateId = qualifyCandidateId('nextagent-local-20260608220000', linuxTarget);
    expect(linuxCandidateId).toBe('nextagent-local-20260608220000-linux-x64');
    expect(createPackageArchive(fixture, packageRoot, linuxCandidateId, linuxTarget, runner)).toBe(
      join(fixture, 'nextagent-local-20260608220000-linux-x64.tar.gz'),
    );
    expect(calls.at(-1)).toMatchObject({ command: 'tar' });
    expect(calls.at(-1)?.args).toEqual(['-czf', join(fixture, 'nextagent-local-20260608220000-linux-x64.tar.gz'), '-C', packageRoot, '.']);

    const archiveOutputRoot = join(fixture, '.tmp', 'archives');
    mkdirSync(archiveOutputRoot, { recursive: true });
    expect(createPackageArchive(fixture, packageRoot, winCandidateId, winTarget, runner, archiveOutputRoot)).toBe(
      join(archiveOutputRoot, 'nextagent-local-20260608220000-win32-x64.zip'),
    );
    expect(calls.at(-1)?.env?.NEXTAGENT_ARCHIVE_PATH).toBe(join(archiveOutputRoot, 'nextagent-local-20260608220000-win32-x64.zip'));

    expect(() => resolvePackageTarget('darwin', 'x64')).toThrow(/Unsupported local runtime package target/u);
    expect(() => resolvePackageTarget('linux', 'arm64')).toThrow(/Unsupported local runtime package target/u);
  });

  it('fails closed when the extracted package self-check fails', async () => {
    const { resolvePackageTarget, verifyExtractedPackageSelfCheck } = await importPackScript();
    const calls: Array<{ command: string; args: string[] }> = [];
    const runner = (command: string, args: string[]) => {
      calls.push({ command, args });
      return { status: command === process.execPath ? 1 : 0, stdout: '', stderr: 'module missing' };
    };

    expect(() => verifyExtractedPackageSelfCheck('candidate.zip', resolvePackageTarget('win32', 'x64'), runner)).toThrow(
      /Extracted local runtime package self-check failed/u,
    );
    expect(calls.map((call) => call.command)).toEqual(['powershell', process.execPath]);
  });

  it('defers app package version lookup until non-packaged composition needs the default', () => {
    const source = readFileSync(join(root, 'packages', 'agent-app', 'src', 'composition', 'observability-composition.ts'), 'utf8');

    expect(source).not.toMatch(/const APP_PACKAGE_VERSION = readAppPackageVersion\(\);/u);
    expect(source).toMatch(/serviceVersion \?\? readAppPackageVersion\(\)/u);
  });

  it('requires the smoke gate before cli packaging proceeds', async () => {
    const { verifyReleaseE2EGate } = await importPackScript();
    const calls: Array<{ command: string; args: string[]; cwd?: string }> = [];
    const runner = (command: string, args: string[], options: { cwd?: string }) => {
      calls.push(options.cwd === undefined ? { command, args } : { command, args, cwd: options.cwd });
      return { status: 0, stdout: '', stderr: '' };
    };

    expect(() => verifyReleaseE2EGate(root, runner)).not.toThrow();
    expect(calls).toEqual([
      {
        command: process.platform === 'win32' ? 'npm.cmd' : 'npm',
        args: ['run', 'test:smoke'],
        cwd: root,
      },
    ]);
    expect(() => verifyReleaseE2EGate(root, () => ({ status: 1, stdout: '', stderr: '' }))).toThrow(/test:smoke gate/u);
  });

  it('rebuilds local runtime workspace dists before packaging proceeds', async () => {
    const { rebuildWorkspaceDists } = await importPackScript();
    const calls: Array<{ command: string; args: string[]; cwd?: string }> = [];
    const runner = (command: string, args: string[], options: { cwd?: string }) => {
      calls.push(options.cwd === undefined ? { command, args } : { command, args, cwd: options.cwd });
      return { status: 0, stdout: '', stderr: '' };
    };

    expect(() => rebuildWorkspaceDists(root, 'with-frontend', runner)).not.toThrow();
    expect(calls.every((call) => call.command === process.execPath)).toBe(true);
    expect(calls.every((call) => call.cwd === root)).toBe(true);
    expect(calls.every((call) => call.args.at(0)?.endsWith(join('node_modules', 'typescript', 'bin', 'tsc')) === true && call.args[1] === '-b')).toBe(
      true,
    );
    expect(calls.every((call) => call.args[2] === '--force')).toBe(true);
    const builtPackageDirs = calls.map((call) => call.args[3]);
    expect(builtPackageDirs).toContain(join(root, 'packages', 'agent-app'));
    expect(builtPackageDirs).toContain(join(root, 'packages', 'agent-app-frontend-hosting'));
    expect(builtPackageDirs).toContain(join(root, 'packages', 'agent-platform-gateway-local'));
    expect(builtPackageDirs).not.toContain(join(root, 'packages', 'agent-dev-workbench'));
    expect(() => rebuildWorkspaceDists(root, 'with-frontend', () => ({ status: 1, stdout: '', stderr: '' }))).toThrow(
      /workspace rebuild for @nextagent\//u,
    );
  });

  it('forces the root runtime build to refresh product workspace dists', async () => {
    const { rebuildRuntimeWorkspaceDists } = await importRuntimeRebuildScript();
    const calls: Array<{ command: string; args: string[]; cwd?: string }> = [];
    const runner = (command: string, args: string[], options: { cwd?: string }) => {
      calls.push(options.cwd === undefined ? { command, args } : { command, args, cwd: options.cwd });
      return { status: 0, stdout: '', stderr: '' };
    };

    expect(() => rebuildRuntimeWorkspaceDists(root, runner)).not.toThrow();
    expect(calls.length).toBeGreaterThan(0);
    expect(calls.every((call) => call.command === process.execPath && call.cwd === root)).toBe(true);
    expect(calls.every((call) => call.args[1] === '-b' && call.args[2] === '--force')).toBe(true);
    expect(calls.map((call) => call.args[3])).toEqual(
      expect.arrayContaining([join(root, 'packages', 'agent-core'), join(root, 'packages', 'agent-runtime')]),
    );
  });

  it('rebuilds the frontend artifact before with-frontend packaging proceeds', async () => {
    const { rebuildFrontendArtifact } = await importPackScript();
    const calls: Array<{ command: string; args: string[]; cwd?: string }> = [];
    const runner = (command: string, args: string[], options: { cwd?: string }) => {
      calls.push(options.cwd === undefined ? { command, args } : { command, args, cwd: options.cwd });
      return { status: 0, stdout: '', stderr: '' };
    };

    expect(() => rebuildFrontendArtifact(root, runner)).not.toThrow();
    expect(calls).toEqual([
      {
        command: process.execPath,
        args: [resolve(root, 'frontend', 'agent-web', 'scripts', 'build-modes.mjs')],
        cwd: join(root, 'frontend', 'agent-web'),
      },
      {
        command: process.execPath,
        args: [resolve(root, 'scripts', 'assemble-agent-web-artifact.mjs')],
        cwd: root,
      },
    ]);
    expect(() => rebuildFrontendArtifact(root, () => ({ status: 1, stdout: '', stderr: '' }))).toThrow(/frontend rebuild/u);
    expect(() =>
      rebuildFrontendArtifact(root, (_command: string, _args: string[], options: { cwd?: string }) => ({
        status: options.cwd === root ? 1 : 0,
        stdout: '',
        stderr: '',
      })),
    ).toThrow(/artifact assembly/u);
  });

  it('prepares backend-only and with-frontend packaging inputs with the correct rebuild scope', async () => {
    const { preparePackageInputs } = await importPackScript();
    const calls: Array<{ command: string; args: string[]; cwd?: string }> = [];
    const runner = (command: string, args: string[], options: { cwd?: string }) => {
      calls.push(options.cwd === undefined ? { command, args } : { command, args, cwd: options.cwd });
      return { status: 0, stdout: '', stderr: '' };
    };

    expect(() => preparePackageInputs(root, 'backend-only', runner)).not.toThrow();
    expect(calls.every((call) => call.command === process.execPath)).toBe(true);
    expect(calls.every((call) => call.args.at(0)?.endsWith(join('node_modules', 'typescript', 'bin', 'tsc')) === true && call.args[1] === '-b')).toBe(
      true,
    );
    expect(calls.every((call) => call.args[2] === '--force')).toBe(true);
    const backendOnlyBuiltPackageDirs = calls.map((call) => call.args[3]);
    expect(backendOnlyBuiltPackageDirs).toContain(join(root, 'packages', 'agent-app'));
    expect(backendOnlyBuiltPackageDirs).toContain(join(root, 'packages', 'agent-platform-gateway-local'));
    expect(backendOnlyBuiltPackageDirs).not.toContain(join(root, 'packages', 'agent-app-frontend-hosting'));
    expect(backendOnlyBuiltPackageDirs).not.toContain(join(root, 'packages', 'agent-dev-workbench'));

    calls.length = 0;
    expect(() => preparePackageInputs(root, 'with-frontend', runner)).not.toThrow();
    const withFrontendBuildCalls = calls.filter((call) => call.command === process.execPath && call.args[1] === '-b');
    expect(withFrontendBuildCalls.every((call) => call.args[2] === '--force')).toBe(true);
    const withFrontendBuiltPackageDirs = withFrontendBuildCalls.map((call) => call.args[3]);
    expect(withFrontendBuiltPackageDirs).toContain(join(root, 'packages', 'agent-app'));
    expect(withFrontendBuiltPackageDirs).toContain(join(root, 'packages', 'agent-app-frontend-hosting'));
    expect(withFrontendBuiltPackageDirs).toContain(join(root, 'packages', 'agent-platform-gateway-local'));
    expect(withFrontendBuiltPackageDirs).not.toContain(join(root, 'packages', 'agent-dev-workbench'));
    expect(calls.slice(-2)).toEqual([
      {
        command: process.execPath,
        args: [resolve(root, 'frontend', 'agent-web', 'scripts', 'build-modes.mjs')],
        cwd: join(root, 'frontend', 'agent-web'),
      },
      {
        command: process.execPath,
        args: [resolve(root, 'scripts', 'assemble-agent-web-artifact.mjs')],
        cwd: root,
      },
    ]);

    calls.length = 0;
    expect(() => preparePackageInputs(root, 'frontend-only', runner)).not.toThrow();
    expect(calls).toEqual([]);
  });

  it('keeps release package model access fields unchanged', async () => {
    const { createReleaseConfigSample } = await importPackScript();
    const builtInConfig = {
      modelProfiles: [
        {
          providerId: 'openai-compatible',
          models: [
            {
              modelId: 'MiniMax-M2.7-highspeed',
              contextWindowTokens: 128_000,
              fallbackEligible: false,
            },
          ],
        },
      ],
    };

    const sample = createReleaseConfigSample(builtInConfig);

    expect(sample.modelProfiles[0]).toMatchObject({
      providerId: 'openai-compatible',
      models: [{ modelId: 'env:OPENAI_MODEL_NAME' }],
    });
    expect(sample.modelProfiles[0]).not.toHaveProperty('baseUrl');
    expect(sample.modelProfiles[0]).not.toHaveProperty('credentialRef');
    expect(sample.nextAgent.system.plugins).toEqual([{ pluginId: 'developer-hook-trace', path: 'plugins/developer-hook-trace', required: true }]);
    expect(builtInConfig.modelProfiles[0]).toMatchObject({
      providerId: 'openai-compatible',
      models: [{ modelId: 'MiniMax-M2.7-highspeed' }],
    });
    expect((builtInConfig as { nextAgent?: unknown }).nextAgent).toBeUndefined();
  });

  it('dev fullstack bootstrap is ordered and fails closed on the first failed step', async () => {
    const { devFullstackSteps, runDevFullstack } = await importDevScript();
    const steps = devFullstackSteps(root);
    expect(steps.map((step: { command: string; args: string[] }) => `${step.command} ${step.args.join(' ')}`)).toEqual([
      'npm install',
      'npm run build',
      'npm install',
      'npm run build:vite:modes',
      'node scripts/assemble-agent-web-artifact.mjs',
      `npm install --no-save ${resolve(root, 'dist', 'dev', 'agent-web-package')}`,
      'node scripts/validate-fullstack-packaging.mjs --artifact --installed',
      'node packages/agent-app/dist/entrypoints/with-frontend.js',
    ]);
    expect(readFileSync(join(root, 'scripts', 'dev-fullstack.mjs'), 'utf8')).not.toContain('backend-only');
    expect(readFileSync(join(root, 'scripts', 'dev-fullstack.mjs'), 'utf8')).not.toContain('release verdict');

    const calls: string[] = [];
    await expect(
      runDevFullstack(root, async (command: string, args: string[]) => {
        calls.push(`${command} ${args.join(' ')}`);
        if (calls.length === 3) {
          throw new Error('frontend dependency preparation failed');
        }
      }),
    ).rejects.toThrow(/frontend dependency preparation failed/u);
    expect(calls).toEqual(['npm install', 'npm run build', 'npm install']);
  });
});

type ValidateFullstackPackaging = (root: string, options?: { artifactPackagePath?: string; checkInstalledFrontendPackage?: boolean }) => string[];

function expectAgentWebArtifactFailure(
  validateFullstackPackaging: ValidateFullstackPackaging,
  mutateArtifact: (artifactRoot: string) => void,
  expectedFailure: string,
): void {
  const fixture = createPackagingFixture();
  createAgentWebArtifactFixture(fixture, productVersion);
  const artifactRoot = join(fixture, 'dist', 'dev', 'agent-web-package');
  mutateArtifact(artifactRoot);
  expect(validateFullstackPackaging(fixture, { artifactPackagePath: artifactRoot })).toContain(expectedFailure);
}

async function importValidationScript(): Promise<{
  validateFullstackPackaging: (root: string, options?: { artifactPackagePath?: string; checkInstalledFrontendPackage?: boolean }) => string[];
}> {
  // @ts-expect-error The validation script is a dev-only ESM utility.
  return import('../scripts/validate-fullstack-packaging.mjs');
}

async function importDevScript(): Promise<{
  devFullstackSteps: (root: string) => Array<{ command: string; args: string[]; cwd: string }>;
  runDevFullstack: (root: string, runner: (command: string, args: string[], cwd: string) => Promise<void>) => Promise<void>;
}> {
  // @ts-expect-error The dev bootstrap script is a dev-only ESM utility.
  return import('../scripts/dev-fullstack.mjs');
}

async function importRuntimeRebuildScript(): Promise<{
  rebuildRuntimeWorkspaceDists: (
    repoRoot: string,
    runner?: (
      command: string,
      args: string[],
      options: { cwd?: string; stdio?: string; encoding?: string },
    ) => { status: number; stdout?: string; stderr?: string },
  ) => void;
}> {
  // @ts-expect-error The runtime rebuild script is a dev-only ESM utility.
  return import('../scripts/rebuild-runtime-workspace-dists.mjs');
}

async function importPackScript(): Promise<{
  preparePackageInputs: (
    repoRoot: string,
    packageProfile: 'backend-only' | 'with-frontend' | 'frontend-only',
    runner?: (
      command: string,
      args: string[],
      options: { cwd?: string; stdio?: string; encoding?: string },
    ) => { status: number; stdout?: string; stderr?: string },
  ) => void;
  rebuildWorkspaceDists: (
    repoRoot: string,
    packageProfile: 'backend-only' | 'with-frontend',
    runner?: (
      command: string,
      args: string[],
      options: { cwd?: string; stdio?: string; encoding?: string },
    ) => { status: number; stdout?: string; stderr?: string },
  ) => void;
  rebuildFrontendArtifact: (
    repoRoot: string,
    runner?: (
      command: string,
      args: string[],
      options: { cwd?: string; stdio?: string; encoding?: string },
    ) => { status: number; stdout?: string; stderr?: string },
  ) => void;
  verifyReleaseE2EGate: (
    repoRoot: string,
    runner?: (
      command: string,
      args: string[],
      options: { cwd?: string; stdio?: string; encoding?: string },
    ) => { status: number; stdout?: string; stderr?: string },
  ) => void;
  createReleaseConfigSample: (rawConfig: Record<string, unknown>) => ReleaseConfigSample;
  formatPackFailure: (error: unknown) => string;
  parsePackArgs: (args: string[]) => {
    packageRootArg: string;
    candidateId: string;
    versionArg?: string;
    packageProfile: 'backend-only' | 'with-frontend' | 'frontend-only';
    skipReleaseGateVerification: boolean;
    excludedBuiltinSkills: string[];
    stageDefaultAgent: boolean;
    modelGatewayOnly: boolean;
    configSamplePath?: string;
  };
  createPackageArchive: (
    repoRoot: string,
    packageRoot: string,
    candidateId: string,
    target: PackageTarget,
    runner: (command: string, args: string[], options: { env?: NodeJS.ProcessEnv }) => { status: number; stdout?: string; stderr?: string },
    archiveOutputRoot?: string,
  ) => string;
  verifyExtractedPackageSelfCheck: (
    archivePath: string,
    target: PackageTarget,
    runner: (
      command: string,
      args: string[],
      options: { cwd?: string; env?: NodeJS.ProcessEnv; encoding?: string },
    ) => { status: number; stdout?: string; stderr?: string },
  ) => void;
  qualifyCandidateId: (candidateId: string, target: PackageTarget) => string;
  resolvePackageTarget: (platform: NodeJS.Platform, arch: NodeJS.Architecture) => PackageTarget;
  stagePackageDependencies: (
    repoRoot: string,
    packageRoot: string,
    packageProfile: 'backend-only' | 'with-frontend',
    version: string,
    options?: { excludedBuiltinSkills?: string[]; modelGatewayOnly?: boolean },
  ) => void;
  stagePackagedDefaultAgent: (repoRoot: string, packageRoot: string) => void;
  stagePackagedDeveloperHookTracePlugin: (
    repoRoot: string,
    packageRoot: string,
    createDeveloperHookTracePluginArtifact: (options: { targetDirectory: string; overwrite: true }) => void,
  ) => void;
  stagePackagedContextMonitorPlugin: (
    packageRoot: string,
    createContextMonitorPluginArtifact: (options: { targetDirectory: string; overwrite: true }) => void,
  ) => void;
  stagePackagedAgentRouterPlugin: (
    packageRoot: string,
    createAgentRouterPluginArtifact: (options: { targetDirectory: string; overwrite: true }) => void,
  ) => void;
  stagePackagedNorthboundOutputNormalizationPlugin: (
    packageRoot: string,
    createNorthboundOutputNormalizationPluginArtifact: (options: { targetDirectory: string; overwrite: true }) => void,
  ) => void;
  stageFrontendOnlyPackage: (repoRoot: string, packageRoot: string, candidateId: string, version: string, target: PackageTarget) => void;
}> {
  // @ts-expect-error The packaging script is a dev-only ESM utility.
  return import('../scripts/pack-local-runtime.mjs');
}

interface PackageTarget {
  readonly platform: NodeJS.Platform;
  readonly arch: NodeJS.Architecture;
  readonly platformSuffix: string;
  readonly archiveExtension: string;
  readonly command: string;
  readonly args: (packageRoot: string, archivePath: string) => string[];
  readonly options: (packageRoot: string, archivePath: string) => { readonly encoding: string; readonly env?: NodeJS.ProcessEnv };
}

function createPackagingFixture(): string {
  const fixture = createTempDir();
  copyRequiredPackageJson('package.json', fixture);
  copyRequiredPackageJson('packages/agent-app/package.json', fixture);
  copyRequiredPackageJson('packages/agent-app-frontend-hosting/package.json', fixture);
  copyRequiredPackageJson('packages/agent-capability/package.json', fixture);
  copyRequiredPackageJson('packages/agent-app/manifests/backend-only.package.json', fixture);
  copyRequiredPackageJson('packages/agent-app/manifests/local-configured-auth.package.json', fixture);
  copyRequiredPackageJson('packages/agent-app/manifests/with-frontend.package.json', fixture);
  copyRequiredPackageJson('frontend/agent-web/package.json', fixture);
  mkdirSync(join(fixture, 'frontend', 'agent-web-mock-server'), { recursive: true });
  writeJson(join(fixture, 'frontend', 'agent-web-mock-server', 'package.json'), {
    name: '@nextagent/agent-web-mock-server',
    devDependencies: { typescript: '0.0.0' },
  });
  mkdirSync(join(fixture, 'packages/agent-capability/dist/builtins/skills'), { recursive: true });
  mkdirSync(join(fixture, 'packages/agent-capability/dist/builtins/skills/skill-creator'), { recursive: true });
  writeFileSync(join(fixture, 'packages/agent-capability/dist/builtins/skills/skill-creator', 'SKILL.md'), '---\nname: skill-creator\n---\n', 'utf8');
  mkdirSync(join(fixture, 'packages/agent-core/src/builtin-agents/default-agent'), { recursive: true });
  writeFileSync(
    join(fixture, 'packages/agent-core/src/builtin-agents/default-agent', 'agent.yaml'),
    'agentId: default-agent\nagentVersion: v1\n',
    'utf8',
  );
  writeFileSync(join(fixture, 'packages/agent-capability/dist/index.js'), 'export {};\n', 'utf8');
  mkdirSync(join(fixture, 'packages/agent-context-engine/dist/prompt-templates/builtin'), { recursive: true });
  const viewerTarget = join(fixture, 'packages', 'agent-plugin-sdk', 'assets', 'developer-hook-trace-viewer.html');
  mkdirSync(dirname(viewerTarget), { recursive: true });
  cpSync(join(root, 'packages', 'agent-plugin-sdk', 'assets', 'developer-hook-trace-viewer.html'), viewerTarget);
  return fixture;
}

function copyRequiredPackageJson(relativePath: string, fixture: string): void {
  const source = join(root, relativePath);
  const target = join(fixture, relativePath);
  mkdirSync(dirname(target), { recursive: true });
  cpSync(source, target);
}

function createFrontendPackageFixture(): { packageRoot: string } {
  const packageRoot = createTempDir();
  mkdirSync(join(packageRoot, 'dist', 'assets'), { recursive: true });
  writeFileSync(join(packageRoot, 'dist', 'index.html'), '<!doctype html><title>NextAgent web shell</title>', 'utf8');
  writeFileSync(join(packageRoot, 'dist', 'assets', 'app.js'), "console.log('agent web asset');", 'utf8');
  writeJson(join(packageRoot, 'package.json'), { name: '@nextagent/agent-web', version: productVersion });
  return { packageRoot };
}

function createRuntimeDependencyFixture(fixture: string): void {
  mkdirSync(join(fixture, 'node_modules'), { recursive: true });
  writeFileSync(join(fixture, 'node_modules', '.keep'), '', 'utf8');
  createInstalledPackageFixture(fixture, '@nextagent/agent-dev-workbench');
  createInstalledPackageFixture(fixture, '@ai-sdk/openai-compatible');
  createInstalledPackageFixture(fixture, 'ai');
  createInstalledPackageFixture(fixture, 'antd');
  createInstalledPackageFixture(fixture, 'playwright-core');
  createInstalledPackageFixture(fixture, 'runtime-peer-provider', { peerDependencies: { zod: '^1.0.0' } });
  createInstalledPackageFixture(fixture, 'typescript');
  createInstalledPackageFixture(fixture, 'vite');
  createInstalledPackageFixture(fixture, 'zod');
  createWorkspaceDistFixture(fixture, 'agent-app', '@nextagent/agent-app', {
    '@nextagent/agent-capability': productVersion,
    '@nextagent/agent-core': productVersion,
    '@nextagent/agent-model': productVersion,
    'runtime-peer-provider': '1.0.0',
  });
  createWorkspaceDistFixture(fixture, 'agent-app-frontend-hosting', '@nextagent/agent-app-frontend-hosting');
  createWorkspaceDistFixture(fixture, 'agent-capability', '@nextagent/agent-capability');
  createWorkspaceDistFixture(fixture, 'agent-core', '@nextagent/agent-core');
  createWorkspaceDistFixture(fixture, 'agent-model', '@nextagent/agent-model', {
    '@ai-sdk/openai-compatible': '2.0.62',
    ai: '6.0.235',
  });
  const agentModelDist = join(fixture, 'packages', 'agent-model', 'dist');
  mkdirSync(join(agentModelDist, 'providers', 'openai-compatible'), { recursive: true });
  mkdirSync(join(agentModelDist, 'providers', 'shared'), { recursive: true });
  writeFileSync(join(agentModelDist, 'providers', 'openai-compatible', 'registration.js'), 'export {};\n', 'utf8');
  writeFileSync(join(agentModelDist, 'providers', 'openai-compatible', 'openai-compatible-provider.js'), 'export {};\n', 'utf8');
  writeFileSync(join(agentModelDist, 'providers', 'shared', 'tool-use-normalizer.js'), 'export {};\n', 'utf8');
  mutateJson(join(fixture, 'packages', 'agent-model', 'package.json'), (manifest) => {
    manifest.exports = {
      '.': { import: './dist/index.js' },
      './providers/openai-compatible': { import: './dist/providers/openai-compatible/registration.js' },
    };
  });
  mkdirSync(join(fixture, 'packages', 'agent-core', 'dist', 'builtin-agents', 'default-agent'), { recursive: true });
  writeFileSync(
    join(fixture, 'packages', 'agent-core', 'dist', 'builtin-agents', 'default-agent', 'agent.yaml'),
    'agentId: bundled-default-agent\nagentVersion: v1\n',
    'utf8',
  );
  createWorkspaceDistFixture(fixture, 'agent-platform-gateway-local', '@nextagent/agent-platform-gateway-local');
}

function createWorkspaceDistFixture(fixture: string, dirName: string, packageName: string, dependencies: Record<string, string> = {}): void {
  const packageRoot = join(fixture, 'packages', dirName);
  mkdirSync(join(packageRoot, 'dist'), { recursive: true });
  writeJson(join(packageRoot, 'package.json'), { name: packageName, version: productVersion, type: 'module', dependencies });
  writeFileSync(join(packageRoot, 'dist', 'index.js'), 'export {};\n', 'utf8');
}

function createInstalledPackageFixture(fixture: string, packageName: string, manifestFields: Record<string, unknown> = {}): void {
  const packageRoot = join(fixture, 'node_modules', ...packageName.split('/'));
  mkdirSync(packageRoot, { recursive: true });
  writeJson(join(packageRoot, 'package.json'), { name: packageName, version: productVersion, type: 'module', ...manifestFields });
  writeFileSync(join(packageRoot, 'index.js'), 'export {};\n', 'utf8');
}

function createAgentWebArtifactFixture(fixture: string, version: string): void {
  const artifactRoot = join(fixture, 'dist', 'dev', 'agent-web-package');
  mkdirSync(join(artifactRoot, 'dist', 'piu'), { recursive: true });
  writeJson(join(artifactRoot, 'package.json'), { name: '@nextagent/agent-web', version, type: 'module' });
  writeJson(join(artifactRoot, 'hosting-manifest.json'), { assetRoot: 'dist', indexHtml: 'dist/index.html', routeBase: '/', spaFallback: true });
  writeFileSync(join(artifactRoot, 'hosting.js'), 'export function resolveFrontendHostingManifest() { return {}; }\n', 'utf8');
  writeFileSync(
    join(artifactRoot, 'dist', 'index.html'),
    '<!doctype html><script src="/febs/v1/assets/prelude-loader"></script><title>NextAgent</title>',
    'utf8',
  );
  writeFileSync(join(artifactRoot, 'dist', 'piu', 'AIAgentPIU.js'), "console.log('AIAgentPIU');\n", 'utf8');
  writeFileSync(join(artifactRoot, 'dist', 'piu', 'AIAgentPIU.css'), '.ai-agent-piu{}\n', 'utf8');
}

function createTempDir(): string {
  return mkCleanTempDir(join(tmpdir(), 'nextagent-fullstack-'));
}

function mkCleanTempDir(prefix: string): string {
  const dir = `${prefix}${crypto.randomUUID()}`;
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  return dir;
}

function writeJson(path: string, value: unknown): void {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function mutateJson(path: string, mutate: (value: any) => void): void {
  const value = JSON.parse(readFileSync(path, 'utf8'));
  mutate(value);
  writeJson(path, value);
}

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      return sourceFiles(path);
    }
    return entry.isFile() && path.endsWith('.ts') ? [path] : [];
  });
}
