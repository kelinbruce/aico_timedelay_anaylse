import { copyFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { load as parseYaml } from 'js-yaml';
import { copyRuntimeAssetsSync } from './runtime-assets.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const scriptPath = fileURLToPath(import.meta.url);
const packageProfiles = new Set(['backend-only', 'with-frontend', 'frontend-only']);
const requiredLocalRuntimeWorkspacePackages = ['@nextagent/agent-platform-gateway-local'];
const packagedDeveloperHookTracePlugin = Object.freeze({
  pluginId: 'developer-hook-trace',
  path: 'plugins/developer-hook-trace',
  required: true,
});
const packagedDeveloperHookTraceHook = Object.freeze({
  hookId: 'developer-hook-trace.loop-raw-boundary',
  enabled: true,
  stages: Object.freeze(['BEFORE_PLANNING', 'AFTER_MODEL_RESULT', 'BEFORE_CAPABILITY_INVOKE', 'AFTER_CAPABILITY_RESULT', 'BEFORE_AGENT_TERMINAL']),
});

export async function packLocalRuntime(options) {
  const {
    repoRoot,
    packageRootArg,
    candidateId,
    versionArg,
    packageProfile,
    excludedBuiltinSkills = [],
    archiveOutputRoot,
    platform = process.platform,
    arch = process.arch,
    nodeVersion = process.version,
    skipReleaseGateVerification = false,
    stageDefaultAgent = false,
    preservePackageRootAfterArchive = false,
    modelGatewayOnly = false,
    configSamplePath = undefined,
  } = options;
  preparePackageInputs(repoRoot, packageProfile, undefined, modelGatewayOnly);
  if (!skipReleaseGateVerification) {
    verifyReleaseE2EGate(repoRoot);
  } else {
    console.log('Skipping release E2E gate verification.');
  }
  const target = resolvePackageTarget(platform, arch);
  const packageCandidateId = qualifyCandidateId(candidateId, target);
  const version = versionArg ?? readRootVersion(repoRoot);
  const packageRoot = resolve(repoRoot, packageRootArg);
  if (packageProfile === 'frontend-only') {
    stageFrontendOnlyPackage(repoRoot, packageRoot, packageCandidateId, version, target);
    createPackageArchive(repoRoot, packageRoot, packageCandidateId, target, spawnSync, archiveOutputRoot, { preservePackageRootAfterArchive });
    return;
  }
  const appDist = resolve(repoRoot, 'packages', 'agent-app', 'dist');
  if (!existsSync(appDist)) {
    throw new Error('agent-app dist is required before packing. Run npm run build first.');
  }

  const skillsDist = resolve(repoRoot, 'packages', 'agent-capability', 'dist', 'builtins', 'skills');
  if (!existsSync(skillsDist)) {
    throw new Error(
      'Builtin skills assets not found at packages/agent-capability/dist/builtins/skills. Run npm run build (includes copy-builtin-skill-assets).',
    );
  }
  const promptTemplatesDist = resolve(repoRoot, 'packages', 'agent-context-engine', 'dist', 'prompt-templates', 'builtin');
  if (!existsSync(promptTemplatesDist)) {
    throw new Error(
      'Builtin prompt template assets not found at packages/agent-context-engine/dist/prompt-templates/builtin. Run npm run build (includes copy-builtin-skill-assets).',
    );
  }

  const [
    { stageLocalRuntimePackage },
    { parseBuiltInConfig },
    { createDeveloperHookTracePluginArtifact },
    { createContextMonitorPluginArtifact },
    { createAgentRouterPluginArtifact },
    { createNorthboundOutputNormalizationPluginArtifact },
  ] = await Promise.all([
    import(new URL('../packages/agent-app/dist/local-runtime-package/index.js', import.meta.url)),
    import(new URL('../packages/agent-app/dist/config/system-config.js', import.meta.url)),
    import(new URL('../packages/agent-plugin-sdk/dist/developer-hook-trace.js', import.meta.url)),
    import(new URL('../packages/agent-plugin-sdk/dist/context-monitor.js', import.meta.url)),
    import(new URL('../packages/agent-plugin-sdk/dist/agent-router-plugin.js', import.meta.url)),
    import(new URL('../packages/agent-plugin-sdk/dist/northbound-output-normalization-hook.js', import.meta.url)),
  ]);
  const builtInConfigContent = readFileSync(
    configSamplePath === undefined
      ? resolve(repoRoot, 'packages', 'agent-app', 'config', 'default-system.yaml')
      : resolve(repoRoot, configSamplePath),
    'utf8',
  );
  const builtInConfig = parseBuiltInConfig(builtInConfigContent);
  stageLocalRuntimePackage({
    packageRoot,
    candidateId: packageCandidateId,
    version,
    buildTime: new Date().toISOString(),
    packageProfile,
    platform: target.platform,
    arch: target.arch,
    nodeVersion,
    packageArchiveRef: `evidence:local-runtime-package-archive:${packageCandidateId}`,
    configSampleContent: builtInConfigContent,
    ...(modelGatewayOnly ? { modelProviderProfile: 'model-gateway-only' } : {}),
  });
  writeFileSync(
    resolve(packageRoot, 'config', 'default-system.yaml'),
    `${JSON.stringify(createReleaseConfigSample(builtInConfig), null, 2)}\n`,
    'utf8',
  );
  stagePackagedDeveloperHookTracePlugin(repoRoot, packageRoot, createDeveloperHookTracePluginArtifact);
  stagePackagedContextMonitorPlugin(packageRoot, createContextMonitorPluginArtifact);
  stagePackagedAgentRouterPlugin(packageRoot, createAgentRouterPluginArtifact);
  stagePackagedNorthboundOutputNormalizationPlugin(packageRoot, createNorthboundOutputNormalizationPluginArtifact);
  cpSync(appDist, resolve(packageRoot, 'backend', 'agent-app'), { recursive: true });
  stagePackageDependencies(repoRoot, packageRoot, packageProfile, version, { excludedBuiltinSkills, modelGatewayOnly });
  if (stageDefaultAgent) {
    stagePackagedDefaultAgent(repoRoot, packageRoot);
  }
  const archivePath = createPackageArchive(repoRoot, packageRoot, packageCandidateId, target, spawnSync, archiveOutputRoot, {
    preservePackageRootAfterArchive,
  });
  verifyExtractedPackageSelfCheck(archivePath, target);
}

export function preparePackageInputs(repoRoot, packageProfile, runner = spawnSync, modelGatewayOnly = false) {
  if (packageProfile === 'frontend-only') {
    return;
  }
  rebuildWorkspaceDists(repoRoot, packageProfile, runner, modelGatewayOnly);
  if (packageProfile === 'with-frontend') {
    rebuildFrontendArtifact(repoRoot, runner);
  }
}

export function rebuildWorkspaceDists(repoRoot, packageProfile = 'with-frontend', runner = spawnSync, modelGatewayOnly = false) {
  const tscBin = resolve(repoRoot, 'node_modules', 'typescript', 'bin', 'tsc');
  const workspacePackages = discoverWorkspacePackageManifests(repoRoot);
  for (const packageName of resolveRuntimeWorkspaceBuildOrder(repoRoot, packageProfile, workspacePackages)) {
    const workspacePackage = workspacePackages.get(packageName);
    if (workspacePackage === undefined) {
      throw new Error(`Local runtime package requires workspace package ${packageName}.`);
    }
    const projectPath = resolveWorkspaceProjectPath(workspacePackage, modelGatewayOnly);
    if (projectPath !== workspacePackage.packageDir) {
      rmSync(resolve(workspacePackage.packageDir, 'dist'), { recursive: true, force: true });
    }
    const result = runner(process.execPath, [tscBin, '-b', '--force', projectPath], {
      cwd: repoRoot,
      stdio: 'inherit',
      encoding: 'utf8',
    });

    if (result.status !== 0) {
      throw new Error(`Local runtime packaging requires a successful workspace rebuild for ${packageName}.`);
    }
    if (modelGatewayOnly && packageName === '@nextagent/agent-model') {
      assertModelGatewayOnlyAgentModelDist(resolve(workspacePackage.packageDir, 'dist'));
    }
  }
  copyRuntimeAssetsSync(repoRoot);
}

function resolveWorkspaceProjectPath(workspacePackage, modelGatewayOnly) {
  if (!modelGatewayOnly) {
    return workspacePackage.packageDir;
  }
  if (workspacePackage.manifest.name !== '@nextagent/agent-model' && workspacePackage.manifest.name !== '@nextagent/agent-app') {
    return workspacePackage.packageDir;
  }
  const projectPath = join(workspacePackage.packageDir, 'tsconfig.model-gateway-only.json');
  if (!existsSync(projectPath)) {
    throw new Error(`Gateway-only workspace build requires TypeScript project ${projectPath}.`);
  }
  return projectPath;
}

function assertModelGatewayOnlyAgentModelDist(packageDist) {
  const forbiddenFiles = [
    join('providers', 'openai-compatible', 'openai-compatible-provider.js'),
    join('providers', 'shared', 'tool-use-normalizer.js'),
  ];
  const presentFiles = forbiddenFiles.filter((file) => existsSync(resolve(packageDist, file)));
  if (presentFiles.length > 0) {
    throw new Error(`Gateway-only agent-model build must not emit OpenAI-compatible artifacts: ${presentFiles.join(', ')}.`);
  }
}

export function rebuildFrontendArtifact(repoRoot, runner = spawnSync) {
  const frontendRoot = resolve(repoRoot, 'frontend', 'agent-web');
  const buildResult = runner(process.execPath, [resolve(frontendRoot, 'scripts', 'build-modes.mjs')], {
    cwd: frontendRoot,
    stdio: 'inherit',
    encoding: 'utf8',
  });
  if (buildResult.status !== 0) {
    throw new Error('Local runtime packaging requires a successful frontend rebuild via frontend/agent-web/scripts/build-modes.mjs.');
  }

  const assembleResult = runner(process.execPath, [resolve(repoRoot, 'scripts', 'assemble-agent-web-artifact.mjs')], {
    cwd: repoRoot,
    stdio: 'inherit',
    encoding: 'utf8',
  });
  if (assembleResult.status !== 0) {
    throw new Error('Local runtime packaging requires a successful @nextagent/agent-web artifact assembly.');
  }
}

export function verifyReleaseE2EGate(repoRoot, runner = spawnSync) {
  const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const gates = [{ script: 'test:smoke', failureMessage: 'Local runtime packaging requires a passing npm run test:smoke gate.' }];

  for (const gate of gates) {
    const result = runner(npmCommand, ['run', gate.script], {
      cwd: repoRoot,
      stdio: 'inherit',
      encoding: 'utf8',
      ...(process.platform === 'win32' ? { shell: true } : {}),
    });

    if (result.status !== 0) {
      throw new Error(gate.failureMessage);
    }
  }
}

export function parsePackArgs(args) {
  const positional = [];
  const excludedBuiltinSkills = [];
  let skipReleaseGateVerification = false;
  let stageDefaultAgent = false;
  let modelGatewayOnly = false;
  let configSamplePath;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--exclude-builtin-skill') {
      const skillName = args[index + 1];
      if (skillName === undefined || skillName.startsWith('--')) {
        throw new Error('Flag --exclude-builtin-skill requires a skill name.');
      }
      excludedBuiltinSkills.push(skillName);
      index += 1;
      continue;
    }
    if (arg === 'skip') {
      skipReleaseGateVerification = true;
      continue;
    }
    if (arg === '--model-gateway-only') {
      modelGatewayOnly = true;
      continue;
    }
    if (arg === '--config-sample') {
      const samplePath = args[index + 1];
      if (samplePath === undefined || samplePath.startsWith('--')) {
        throw new Error('Flag --config-sample requires a package-relative config sample path.');
      }
      configSamplePath = samplePath;
      index += 1;
      continue;
    }
    if (arg === '--stage-default-agent') {
      stageDefaultAgent = true;
      continue;
    }
    positional.push(arg);
  }
  const [packageRootArg, candidateId, thirdArg, fourthArg] = positional;
  if (packageRootArg === undefined || candidateId === undefined) {
    throw new Error(
      'Usage: npm run pack <packageRoot> <candidateId> [version] [profile] [skip] [--stage-default-agent] [--model-gateway-only] [--config-sample <path>] [--exclude-builtin-skill <skillName> ...]; default profile is with-frontend.',
    );
  }
  if (positional.length > 4) {
    throw new Error(
      'Usage: npm run pack <packageRoot> <candidateId> [version] [profile] [skip] [--stage-default-agent] [--model-gateway-only] [--config-sample <path>] [--exclude-builtin-skill <skillName> ...]; default profile is with-frontend.',
    );
  }
  const packageProfile = resolvePackageProfile(thirdArg !== undefined && packageProfiles.has(thirdArg) ? thirdArg : fourthArg);
  const versionArg = thirdArg !== undefined && !packageProfiles.has(thirdArg) ? thirdArg : undefined;
  return {
    packageRootArg,
    candidateId,
    versionArg,
    packageProfile,
    skipReleaseGateVerification,
    stageDefaultAgent,
    excludedBuiltinSkills,
    modelGatewayOnly,
    configSamplePath,
  };
}

export function formatPackFailure(error) {
  if (error !== null && typeof error === 'object' && typeof error.code === 'string' && error.code.length > 0) {
    return JSON.stringify({ status: 'failed', diagnostics: [{ code: error.code }] });
  }
  return error instanceof Error ? error.message : String(error);
}

export function stagePackageDependencies(repoRoot, packageRoot, packageProfile, version, options = {}) {
  const { excludedBuiltinSkills = [], modelGatewayOnly = false } = options;
  const sourceNodeModules = resolve(repoRoot, 'node_modules');
  if (!existsSync(sourceNodeModules)) {
    throw new Error('node_modules is required before packing. Run npm install first.');
  }
  const packagedAgentRoot = resolvePackageResourceRoot(packageRoot, 'agentRoot', 'agents');
  rmSync(packagedAgentRoot, { recursive: true, force: true });
  mkdirSync(packagedAgentRoot, { recursive: true });
  writeFileSync(resolve(packagedAgentRoot, '.keep'), '', 'utf8');
  const targetNodeModules = resolve(packageRoot, 'node_modules');
  rmSync(targetNodeModules, { recursive: true, force: true });
  mkdirSync(targetNodeModules, { recursive: true });
  const nextAgentScope = resolve(targetNodeModules, '@nextagent');
  mkdirSync(nextAgentScope, { recursive: true });

  const externalDependencySeeds = stageWorkspaceRuntimeDependencyClosure(repoRoot, targetNodeModules, packageProfile, {
    excludedBuiltinSkills,
    modelGatewayOnly,
  });
  stageExternalRuntimeDependencyClosure(repoRoot, targetNodeModules, externalDependencySeeds);
  assertRequiredLocalRuntimeWorkspacePackages(targetNodeModules);
  if (packageProfile === 'with-frontend') {
    stageFrontendArtifactPackage(repoRoot, nextAgentScope, version);
  }
}

function stageWorkspaceRuntimeDependencyClosure(repoRoot, targetNodeModules, packageProfile, options) {
  const { excludedBuiltinSkills, modelGatewayOnly } = options;
  const workspacePackages = discoverWorkspacePackages(repoRoot);
  const productManifest = readProductRuntimeManifest(repoRoot, packageProfile);
  const queue = [...runtimeDependencyNames(productManifest), ...requiredLocalRuntimeWorkspacePackages];
  const staged = new Set();
  const externalDependencySeeds = new Set();

  for (let index = 0; index < queue.length; index += 1) {
    const packageName = queue[index];
    if (!packageName.startsWith('@nextagent/')) {
      externalDependencySeeds.add(packageName);
      continue;
    }
    if (packageName === '@nextagent/agent-web') {
      continue;
    }
    if (staged.has(packageName)) {
      continue;
    }
    const workspacePackage = workspacePackages.get(packageName);
    if (workspacePackage === undefined) {
      throw new Error(`Local runtime package requires workspace package ${packageName}.`);
    }
    const stagedDependencyNames = stageWorkspacePackage(targetNodeModules, workspacePackage, { excludedBuiltinSkills, modelGatewayOnly });
    staged.add(packageName);
    for (const dependencyName of stagedDependencyNames) {
      if (dependencyName.startsWith('@nextagent/')) {
        queue.push(dependencyName);
      } else {
        externalDependencySeeds.add(dependencyName);
      }
    }
  }

  return externalDependencySeeds;
}

function resolveRuntimeWorkspaceBuildOrder(repoRoot, packageProfile, workspacePackages = discoverWorkspacePackageManifests(repoRoot)) {
  const productManifest = readProductRuntimeManifest(repoRoot, packageProfile);
  const queue = [...runtimeDependencyNames(productManifest), ...requiredLocalRuntimeWorkspacePackages];
  const runtimePackages = new Set();

  for (let index = 0; index < queue.length; index += 1) {
    const packageName = queue[index];
    if (!packageName.startsWith('@nextagent/') || packageName === '@nextagent/agent-web' || runtimePackages.has(packageName)) {
      continue;
    }
    const workspacePackage = workspacePackages.get(packageName);
    if (workspacePackage === undefined) {
      throw new Error(`Local runtime package requires workspace package ${packageName}.`);
    }
    runtimePackages.add(packageName);
    for (const dependencyName of runtimeDependencyNames(workspacePackage.manifest)) {
      if (dependencyName.startsWith('@nextagent/')) {
        queue.push(dependencyName);
      }
    }
  }

  const visiting = new Set();
  const visited = new Set();
  const buildOrder = [];
  const visit = (packageName) => {
    if (visited.has(packageName)) {
      return;
    }
    if (visiting.has(packageName)) {
      throw new Error(`Circular local runtime workspace dependency detected for ${packageName}.`);
    }
    visiting.add(packageName);
    const workspacePackage = workspacePackages.get(packageName);
    if (workspacePackage === undefined) {
      throw new Error(`Local runtime package requires workspace package ${packageName}.`);
    }
    for (const dependencyName of runtimeDependencyNames(workspacePackage.manifest)) {
      if (runtimePackages.has(dependencyName)) {
        visit(dependencyName);
      }
    }
    visiting.delete(packageName);
    visited.add(packageName);
    buildOrder.push(packageName);
  };

  for (const packageName of runtimePackages) {
    visit(packageName);
  }
  return buildOrder;
}

function discoverWorkspacePackageManifests(repoRoot) {
  const packages = new Map();
  for (const workspace of readdirSync(resolve(repoRoot, 'packages'), { withFileTypes: true })) {
    if (!workspace.isDirectory()) {
      continue;
    }
    const packageDir = resolve(repoRoot, 'packages', workspace.name);
    const packageManifestPath = resolve(packageDir, 'package.json');
    if (!existsSync(packageManifestPath)) {
      continue;
    }
    const manifest = JSON.parse(readFileSync(packageManifestPath, 'utf8'));
    if (typeof manifest.name !== 'string' || !manifest.name.startsWith('@nextagent/')) {
      continue;
    }
    packages.set(manifest.name, { packageDir, packageManifestPath, manifest });
  }
  return packages;
}

function discoverWorkspacePackages(repoRoot) {
  const packages = new Map();
  for (const workspace of readdirSync(resolve(repoRoot, 'packages'), { withFileTypes: true })) {
    if (!workspace.isDirectory()) {
      continue;
    }
    const packageDir = resolve(repoRoot, 'packages', workspace.name);
    const packageManifestPath = resolve(packageDir, 'package.json');
    const packageDist = resolve(packageDir, 'dist');
    if (!existsSync(packageManifestPath) || !existsSync(packageDist)) {
      continue;
    }
    const manifest = JSON.parse(readFileSync(packageManifestPath, 'utf8'));
    if (typeof manifest.name !== 'string' || !manifest.name.startsWith('@nextagent/')) {
      continue;
    }
    packages.set(manifest.name, { packageDir, packageManifestPath, packageDist, manifest });
  }
  return packages;
}

function readProductRuntimeManifest(repoRoot, packageProfile) {
  if (packageProfile !== 'backend-only' && packageProfile !== 'with-frontend') {
    throw new Error('Product runtime manifest is only available for backend-only and with-frontend packages.');
  }
  return JSON.parse(readFileSync(resolve(repoRoot, 'packages', 'agent-app', 'manifests', `${packageProfile}.package.json`), 'utf8'));
}

function stageWorkspacePackage(targetNodeModules, workspacePackage, options) {
  const targetPackage = resolve(targetNodeModules, ...workspacePackage.manifest.name.split('/'));
  mkdirSync(targetPackage, { recursive: true });
  const stagedManifest =
    options.modelGatewayOnly && workspacePackage.manifest.name === '@nextagent/agent-model'
      ? createModelGatewayOnlyAgentModelManifest(workspacePackage.manifest)
      : workspacePackage.manifest;
  writeFileSync(resolve(targetPackage, 'package.json'), `${JSON.stringify(stagedManifest, null, 2)}\n`, 'utf8');
  cpSync(workspacePackage.packageDist, resolve(targetPackage, 'dist'), { recursive: true });
  if (options.modelGatewayOnly && workspacePackage.manifest.name === '@nextagent/agent-model') {
    removeOpenAICompatibleProviderRuntimeArtifacts(targetPackage);
  }
  assertStagedRuntimeExports(targetPackage, workspacePackage.manifest.name, stagedManifest.exports);
  const packageWebDist = resolve(workspacePackage.packageDir, 'web-dist');
  if (existsSync(packageWebDist)) {
    cpSync(packageWebDist, resolve(targetPackage, 'web-dist'), { recursive: true });
  }
  if (workspacePackage.manifest.name === '@nextagent/agent-capability') {
    excludeBuiltinSkillsFromPackagedCapability(targetPackage, options.excludedBuiltinSkills);
  }
  return runtimeDependencyNames(stagedManifest);
}

function createModelGatewayOnlyAgentModelManifest(manifest) {
  const dependencies = { ...(manifest.dependencies ?? {}) };
  delete dependencies['@ai-sdk/openai-compatible'];
  delete dependencies.ai;
  return { ...manifest, dependencies };
}

function removeOpenAICompatibleProviderRuntimeArtifacts(targetPackage) {
  for (const extension of ['.js', '.d.ts', '.js.map', '.d.ts.map']) {
    rmSync(resolve(targetPackage, 'dist', 'providers', 'openai-compatible', `openai-compatible-provider${extension}`), { force: true });
    rmSync(resolve(targetPackage, 'dist', 'providers', 'shared', `tool-use-normalizer${extension}`), { force: true });
  }
}

function assertStagedRuntimeExports(packageRoot, packageName, exportsField) {
  for (const target of runtimeExportTargets(exportsField)) {
    if (!target.startsWith('./') || target.includes('..') || !existsSync(resolve(packageRoot, target))) {
      throw new Error(`Local runtime package ${packageName} is missing staged runtime export ${target}.`);
    }
  }
}

function runtimeExportTargets(exportsField) {
  const targets = new Set();
  const visit = (value, condition) => {
    if (typeof value === 'string') {
      if (condition === undefined || condition === 'import' || condition === 'require') {
        targets.add(value);
      }
      return;
    }
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      return;
    }
    for (const [key, nested] of Object.entries(value)) {
      visit(nested, key === 'import' || key === 'require' || key === 'types' ? key : condition);
    }
  };
  visit(exportsField, undefined);
  return targets;
}

function stageExternalRuntimeDependencyClosure(repoRoot, targetNodeModules, dependencySeeds) {
  const rootNodeModules = resolve(repoRoot, 'node_modules');
  const queue = [...dependencySeeds].map((packageName) => ({ packageName, parentPackageRoot: undefined }));
  const staged = new Set();

  for (let index = 0; index < queue.length; index += 1) {
    const { packageName, parentPackageRoot } = queue[index];
    if (packageName.startsWith('@nextagent/') || staged.has(packageName)) {
      continue;
    }
    const sourcePackageRoot = resolveSourceDependencyPackageRoot(rootNodeModules, packageName, parentPackageRoot);
    const manifestPath = resolve(sourcePackageRoot, 'package.json');
    if (!existsSync(manifestPath)) {
      throw new Error(`Local runtime package requires runtime dependency ${packageName}. Run npm install first.`);
    }
    const targetPackageRoot = resolve(targetNodeModules, ...packageName.split('/'));
    rmSync(targetPackageRoot, { recursive: true, force: true });
    mkdirSync(dirname(targetPackageRoot), { recursive: true });
    cpSync(sourcePackageRoot, targetPackageRoot, { recursive: true });
    staged.add(packageName);

    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    for (const dependencyName of runtimeDependencyNames(manifest)) {
      queue.push({ packageName: dependencyName, parentPackageRoot: sourcePackageRoot });
    }
  }
}

function resolveSourceDependencyPackageRoot(rootNodeModules, packageName, parentPackageRoot) {
  const packagePathParts = packageName.split('/');
  if (parentPackageRoot !== undefined) {
    const nested = resolve(parentPackageRoot, 'node_modules', ...packagePathParts);
    if (existsSync(nested)) {
      return nested;
    }
  }
  return resolve(rootNodeModules, ...packagePathParts);
}

function runtimeDependencyNames(manifest) {
  const dependencies =
    typeof manifest.dependencies === 'object' && manifest.dependencies !== null && !Array.isArray(manifest.dependencies) ? manifest.dependencies : {};
  const peerDependencies =
    typeof manifest.peerDependencies === 'object' && manifest.peerDependencies !== null && !Array.isArray(manifest.peerDependencies)
      ? manifest.peerDependencies
      : {};
  const peerDependenciesMeta =
    typeof manifest.peerDependenciesMeta === 'object' && manifest.peerDependenciesMeta !== null && !Array.isArray(manifest.peerDependenciesMeta)
      ? manifest.peerDependenciesMeta
      : {};
  const requiredPeerDependencies = Object.keys(peerDependencies).filter((dependencyName) => {
    const metadata = peerDependenciesMeta[dependencyName];
    return !(typeof metadata === 'object' && metadata !== null && !Array.isArray(metadata) && metadata.optional === true);
  });
  return [...new Set([...Object.keys(dependencies), ...requiredPeerDependencies])];
}

function assertRequiredLocalRuntimeWorkspacePackages(targetNodeModules) {
  for (const packageName of requiredLocalRuntimeWorkspacePackages) {
    const packageRoot = resolve(targetNodeModules, ...packageName.split('/'));
    if (!existsSync(resolve(packageRoot, 'package.json')) || !existsSync(resolve(packageRoot, 'dist'))) {
      throw new Error(`Local runtime package requires ${packageName} to be staged with package.json and dist.`);
    }
  }
}

function excludeBuiltinSkillsFromPackagedCapability(targetPackage, excludedBuiltinSkills) {
  for (const skillName of excludedBuiltinSkills) {
    rmSync(resolve(targetPackage, 'dist', 'builtins', 'skills', skillName), { recursive: true, force: true });
  }
}

function removePackagedBuiltinAgentConfigs(targetPackage) {
  rmSync(resolve(targetPackage, 'dist', 'builtin-agents'), { recursive: true, force: true });
}

export function stagePackagedDefaultAgent(repoRoot, packageRoot) {
  const source = resolve(repoRoot, 'packages', 'agent-core', 'src', 'builtin-agents', 'default-agent', 'agent.yaml');
  if (!existsSync(source)) {
    throw new Error('Builtin default Agent definition is required before staging the release validation Agent.');
  }
  const packagedDefaultAgentRoot = resolvePackageResourceRoot(packageRoot, 'agentRoot', 'agents');
  const targetRoot = resolve(packagedDefaultAgentRoot, 'default-agent');
  rmSync(resolve(packageRoot, 'config', 'default-agent.yaml'), { force: true });
  rmSync(targetRoot, { recursive: true, force: true });
  mkdirSync(targetRoot, { recursive: true });
  const agentDefinition = createPackagedDefaultAgentDefinition(readFileSync(source, 'utf8'));
  writeFileSync(resolve(targetRoot, 'agent.yaml'), `${JSON.stringify(agentDefinition, null, 2)}\n`, 'utf8');
}

export function stagePackagedDeveloperHookTracePlugin(repoRoot, packageRoot, createDeveloperHookTracePluginArtifact) {
  const targetDirectory = resolve(packageRoot, 'config', 'plugins', 'developer-hook-trace');
  createDeveloperHookTracePluginArtifact({
    targetDirectory,
    overwrite: true,
  });
  copyFileSync(
    resolve(repoRoot, 'packages', 'agent-plugin-sdk', 'assets', 'developer-hook-trace-viewer.html'),
    resolve(targetDirectory, 'trace-viewer.html'),
  );
}

export function stagePackagedContextMonitorPlugin(packageRoot, createContextMonitorPluginArtifact) {
  createContextMonitorPluginArtifact({
    targetDirectory: resolve(packageRoot, 'config', 'plugins', 'context-monitor'),
    overwrite: true,
  });
}

export function stagePackagedAgentRouterPlugin(packageRoot, createAgentRouterPluginArtifact) {
  createAgentRouterPluginArtifact({
    targetDirectory: resolve(packageRoot, 'config', 'plugins', 'agent-router-plugin'),
    overwrite: true,
  });
}

export function stagePackagedNorthboundOutputNormalizationPlugin(packageRoot, createNorthboundOutputNormalizationPluginArtifact) {
  createNorthboundOutputNormalizationPluginArtifact({
    targetDirectory: resolve(packageRoot, 'config', 'plugins', 'northbound-output-normalization-hook'),
    overwrite: true,
  });
}

function resolvePackageResourceRoot(packageRoot, fieldName, fallback) {
  const configPath = resolve(packageRoot, 'config', 'default-system.yaml');
  if (!existsSync(configPath)) {
    return resolve(packageRoot, fallback);
  }
  try {
    const config = parseYaml(readFileSync(configPath, 'utf8'));
    const paths = typeof config === 'object' && config !== null && !Array.isArray(config) ? config.paths : undefined;
    const resourceRoot = typeof paths === 'object' && paths !== null && !Array.isArray(paths) ? safePackageDirectoryRef(paths[fieldName]) : undefined;
    return resolve(packageRoot, resourceRoot ?? fallback);
  } catch {
    return resolve(packageRoot, fallback);
  }
}

function safePackageDirectoryRef(value) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    return undefined;
  }
  if (isAbsolute(value) || value.includes('..') || value.split(/[\\/]/u).some((part) => part === '')) {
    return undefined;
  }
  return value;
}

function uniqueStrings(values) {
  return [...new Set(values)];
}

export function stageFrontendOnlyPackage(repoRoot, packageRoot, candidateId, version, target) {
  const artifactRoot = resolve(repoRoot, 'dist', 'dev', 'agent-web-package');
  const artifactManifestPath = resolve(artifactRoot, 'package.json');
  if (!existsSync(artifactManifestPath)) {
    throw new Error(
      '@nextagent/agent-web artifact package is required for frontend-only packing. Run npm run dev:fullstack preparation or node scripts/assemble-agent-web-artifact.mjs first.',
    );
  }
  const artifactManifest = JSON.parse(readFileSync(artifactManifestPath, 'utf8'));
  if (artifactManifest.name !== '@nextagent/agent-web' || artifactManifest.version !== version) {
    throw new Error('@nextagent/agent-web artifact package version must equal root package.json version before frontend-only packing.');
  }
  for (const ref of ['dist', 'hosting.js', 'hosting-manifest.json']) {
    if (!existsSync(resolve(artifactRoot, ref))) {
      throw new Error(`@nextagent/agent-web artifact package is missing ${ref}.`);
    }
  }
  rmSync(packageRoot, { recursive: true, force: true });
  mkdirSync(resolve(packageRoot, 'frontend'), { recursive: true });
  cpSync(artifactRoot, resolve(packageRoot, 'frontend', 'agent-web'), { recursive: true });
  const packageManifest = {
    name: '@nextagent/local-frontend',
    version,
    type: 'module',
    platform: target.platform,
    arch: target.arch,
    profile: 'frontend-only',
  };
  writeFileSync(resolve(packageRoot, 'package.json'), `${JSON.stringify(packageManifest, null, 2)}\n`, 'utf8');
  console.log(`Staged frontend-only package at ${packageRoot}`);
}

function stageFrontendArtifactPackage(repoRoot, nextAgentScope, version) {
  const artifactRoot = resolve(repoRoot, 'dist', 'dev', 'agent-web-package');
  const artifactManifestPath = resolve(artifactRoot, 'package.json');
  if (!existsSync(artifactManifestPath)) {
    throw new Error(
      '@nextagent/agent-web artifact package is required for with-frontend packing. Run npm run dev:fullstack preparation or node scripts/assemble-agent-web-artifact.mjs first.',
    );
  }
  const artifactManifest = JSON.parse(readFileSync(artifactManifestPath, 'utf8'));
  if (artifactManifest.name !== '@nextagent/agent-web' || artifactManifest.version !== version) {
    throw new Error('@nextagent/agent-web artifact package version must equal root package.json version before with-frontend packing.');
  }
  for (const ref of ['dist', 'hosting.js', 'hosting-manifest.json']) {
    if (!existsSync(resolve(artifactRoot, ref))) {
      throw new Error(`@nextagent/agent-web artifact package is missing ${ref}.`);
    }
  }
  const targetPackage = resolve(nextAgentScope, 'agent-web');
  rmSync(targetPackage, { recursive: true, force: true });
  cpSync(artifactRoot, targetPackage, { recursive: true });
}

export function createPackageArchive(
  repoRoot,
  packageRoot,
  candidateId,
  target = resolvePackageTarget(process.platform, process.arch),
  runner = spawnSync,
  archiveOutputRoot = repoRoot,
  options = {},
) {
  const archivePath = resolve(archiveOutputRoot, `${candidateId}.${target.archiveExtension}`);
  rmSync(archivePath, { force: true });
  const result = runner(target.command, target.args(packageRoot, archivePath), target.options(packageRoot, archivePath));
  if (result.status !== 0) {
    throw new Error(`Unable to create local runtime package artifact: ${result.stderr || result.stdout || 'unknown failure'}`);
  }
  if (options.preservePackageRootAfterArchive !== true) {
    rmSync(packageRoot, { recursive: true, force: true });
  }
  console.log(`Created local runtime package archive: ${archivePath}`);
  return archivePath;
}

export function verifyExtractedPackageSelfCheck(archivePath, target = resolvePackageTarget(process.platform, process.arch), runner = spawnSync) {
  const validationRoot = mkdtempSync(join(tmpdir(), 'nextagent-package-self-check-'));
  try {
    const extraction =
      target.platform === 'win32'
        ? runner(
            'powershell',
            [
              '-NoProfile',
              '-Command',
              "$ErrorActionPreference='Stop'; Add-Type -AssemblyName System.IO.Compression.FileSystem; [System.IO.Compression.ZipFile]::ExtractToDirectory($env:NEXTAGENT_ARCHIVE_PATH, $env:NEXTAGENT_EXTRACT_ROOT)",
            ],
            {
              encoding: 'utf8',
              env: { ...process.env, NEXTAGENT_ARCHIVE_PATH: archivePath, NEXTAGENT_EXTRACT_ROOT: validationRoot },
            },
          )
        : runner('tar', ['-xzf', archivePath, '-C', validationRoot], { encoding: 'utf8' });
    if (extraction.status !== 0) {
      throw new Error(
        `Unable to extract local runtime package artifact for self-check: ${extraction.stderr || extraction.stdout || 'unknown failure'}`,
      );
    }
    const selfCheck = runner(process.execPath, [resolve(validationRoot, 'bin', 'nextagent-self-check')], {
      cwd: validationRoot,
      encoding: 'utf8',
      env: {
        ...process.env,
        OPENAI_MODEL_NAME: 'package-self-check',
      },
    });
    if (selfCheck.status !== 0) {
      throw new Error(`Extracted local runtime package self-check failed: ${selfCheck.stderr || selfCheck.stdout || 'unknown failure'}`);
    }
  } finally {
    rmSync(validationRoot, { recursive: true, force: true });
  }
}

export function resolvePackageTarget(platform, arch) {
  if (platform === 'win32' && arch === 'x64') {
    return {
      platform,
      arch,
      platformSuffix: 'win32-x64',
      archiveExtension: 'zip',
      command: 'powershell',
      args: () => [
        '-NoProfile',
        '-Command',
        "$ErrorActionPreference='Stop'; Add-Type -AssemblyName System.IO.Compression.FileSystem; if (Test-Path $env:NEXTAGENT_ARCHIVE_PATH) { Remove-Item -LiteralPath $env:NEXTAGENT_ARCHIVE_PATH -Force }; [System.IO.Compression.ZipFile]::CreateFromDirectory($env:NEXTAGENT_PACKAGE_ROOT, $env:NEXTAGENT_ARCHIVE_PATH)",
      ],
      options: (packageRoot, archivePath) => ({
        encoding: 'utf8',
        env: { ...process.env, NEXTAGENT_PACKAGE_ROOT: packageRoot, NEXTAGENT_ARCHIVE_PATH: archivePath },
      }),
    };
  }
  if (platform === 'linux' && arch === 'x64') {
    return {
      platform,
      arch,
      platformSuffix: 'linux-x64',
      archiveExtension: 'tar.gz',
      command: 'tar',
      args: (packageRoot, archivePath) => ['-czf', archivePath, '-C', packageRoot, '.'],
      options: () => ({ encoding: 'utf8' }),
    };
  }
  throw new Error('Unsupported local runtime package target. Supported targets: win32-x64, linux-x64.');
}

export function qualifyCandidateId(candidateId, target) {
  return candidateId.endsWith(`-${target.platformSuffix}`) ? candidateId : `${candidateId}-${target.platformSuffix}`;
}

export function createReleaseConfigSample(rawConfig) {
  if (typeof rawConfig !== 'object' || rawConfig === null || Array.isArray(rawConfig)) {
    return rawConfig;
  }
  const config = rawConfig;
  const modelProfiles = Array.isArray(config.modelProfiles) ? config.modelProfiles : [];
  return {
    ...config,
    paths: {
      ...(typeof config.paths === 'object' && config.paths !== null && !Array.isArray(config.paths) ? config.paths : {}),
      agentRoot: 'agents',
      skillRoot: 'skills',
    },
    nextAgent: createPackagedNextAgentConfig(config.nextAgent),
    modelProfiles: modelProfiles.map((profile) => {
      if (typeof profile !== 'object' || profile === null || Array.isArray(profile)) {
        return profile;
      }
      const models = Array.isArray(profile.models) ? profile.models : [];
      return {
        ...profile,
        models: models.map((model, index) =>
          index === 0 && profile.providerId === 'openai-compatible' && typeof model === 'object' && model !== null && !Array.isArray(model)
            ? { ...model, modelId: 'env:OPENAI_MODEL_NAME' }
            : model,
        ),
      };
    }),
  };
}

function createPackagedNextAgentConfig(nextAgent) {
  const current = typeof nextAgent === 'object' && nextAgent !== null && !Array.isArray(nextAgent) ? nextAgent : {};
  const currentSystem = typeof current.system === 'object' && current.system !== null && !Array.isArray(current.system) ? current.system : {};
  const currentPlugins = Array.isArray(currentSystem.plugins) ? currentSystem.plugins : [];
  const plugins = currentPlugins.some(
    (entry) => typeof entry === 'object' && entry !== null && !Array.isArray(entry) && entry.pluginId === packagedDeveloperHookTracePlugin.pluginId,
  )
    ? currentPlugins
    : [...currentPlugins, packagedDeveloperHookTracePlugin];
  return {
    ...current,
    system: {
      ...currentSystem,
      plugins,
    },
  };
}

function createPackagedDefaultAgentDefinition(content) {
  const parsed = parseAgentDefinitionContent(content);
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('Default Agent definition must be an object before local runtime packaging.');
  }
  const currentHooks = Array.isArray(parsed.hooks) ? parsed.hooks : [];
  return {
    ...parsed,
    hooks: [
      ...currentHooks.filter(
        (entry) => !(typeof entry === 'object' && entry !== null && !Array.isArray(entry) && entry.hookId === packagedDeveloperHookTraceHook.hookId),
      ),
      packagedDeveloperHookTraceHook,
    ],
  };
}

function parseAgentDefinitionContent(content) {
  try {
    return JSON.parse(content);
  } catch {
    return parseYaml(content);
  }
}

function readRootVersion(repoRoot) {
  const manifest = JSON.parse(readFileSync(resolve(repoRoot, 'package.json'), 'utf8'));
  if (typeof manifest.version !== 'string' || manifest.version.length === 0) {
    throw new Error('Root package.json version is required for local runtime packaging.');
  }
  return manifest.version;
}

function resolvePackageProfile(profileArg) {
  const profile = profileArg ?? 'with-frontend';
  if (!packageProfiles.has(profile)) {
    throw new Error('Package profile must be backend-only, with-frontend, or frontend-only.');
  }
  return profile;
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === scriptPath) {
  try {
    await packLocalRuntime({ repoRoot: root, ...parsePackArgs(process.argv.slice(2)) });
  } catch (error) {
    console.error(formatPackFailure(error));
    process.exitCode = 1;
  }
}
