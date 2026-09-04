import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validatePiuClosedRuntimeAssetSet } from './agent-web-artifact-validation.mjs';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const scriptPath = fileURLToPath(import.meta.url);
const args = new Set(process.argv.slice(2));

export function validateFullstackPackaging(root = repoRoot, options = {}) {
  const rootPackage = readJson(resolve(root, 'package.json'));
  const agentApp = readJson(resolve(root, 'packages', 'agent-app', 'package.json'));
  const hostingPackage = readJson(resolve(root, 'packages', 'agent-app-frontend-hosting', 'package.json'));
  const frontendPackage = readJson(resolve(root, 'frontend', 'agent-web', 'package.json'));
  const backendOnlyManifest = readJson(resolve(root, 'packages', 'agent-app', 'manifests', 'backend-only.package.json'));
  const withFrontendManifest = readJson(resolve(root, 'packages', 'agent-app', 'manifests', 'with-frontend.package.json'));
  const localConfiguredAuthManifest = readJson(resolve(root, 'packages', 'agent-app', 'manifests', 'local-configured-auth.package.json'));
  const failures = [];

  const distSkills = resolve(root, 'packages', 'agent-capability', 'dist', 'builtins', 'skills');
  const sourceSkills = resolve(root, 'packages', 'agent-capability', 'src', 'builtins', 'skills');
  if (!existsSync(distSkills) && !existsSync(sourceSkills)) {
    failures.push('Builtin skills assets missing at packages/agent-capability/dist/builtins/skills.');
  }
  const distPromptTemplates = resolve(root, 'packages', 'agent-context-engine', 'dist', 'prompt-templates', 'builtin');
  const sourcePromptTemplates = resolve(root, 'packages', 'agent-context-engine', 'prompt-templates', 'builtin');
  if (!existsSync(distPromptTemplates) && !existsSync(sourcePromptTemplates)) {
    failures.push('Builtin prompt template assets missing at packages/agent-context-engine/dist/prompt-templates/builtin.');
  }

  if (JSON.stringify(rootPackage.workspaces) !== JSON.stringify(['packages/*'])) {
    failures.push('Root workspaces must stay scoped to packages/*.');
  }

  if (!Array.isArray(rootPackage['x-nextagent']?.sharedDependencyLockstep)) {
    failures.push('Root package.json must define x-nextagent.sharedDependencyLockstep.');
  }

  if (frontendPackage.engines?.node !== rootPackage.engines?.node) {
    failures.push('frontend/agent-web engines.node must match root package.json engines.node.');
  }

  if (frontendPackage.devDependencies?.typescript !== rootPackage.devDependencies?.typescript) {
    failures.push('frontend/agent-web devDependencies.typescript must match root package.json devDependencies.typescript.');
  }

  for (const dependencyName of ['@nextagent/agent-app-frontend-hosting', '@nextagent/agent-web']) {
    if (declaresDependency(backendOnlyManifest, dependencyName)) {
      failures.push(`backend-only.package.json must not declare ${dependencyName}.`);
    }
  }

  for (const [manifestName, manifest] of [
    ['backend-only.package.json', backendOnlyManifest],
    ['with-frontend.package.json', withFrontendManifest],
  ]) {
    if (declaresDependency(manifest, '@nextagent/agent-channel-web-auth-local')) {
      failures.push(`${manifestName} must not declare @nextagent/agent-channel-web-auth-local.`);
    }
  }

  if (!declaresDependency(withFrontendManifest, '@nextagent/agent-app-frontend-hosting')) {
    failures.push('with-frontend.package.json must declare @nextagent/agent-app-frontend-hosting.');
  }

  const frontendDependency = withFrontendManifest.dependencies?.['@nextagent/agent-web'];
  if (frontendDependency !== rootPackage.version) {
    failures.push('with-frontend.package.json must declare @nextagent/agent-web with the exact root package version.');
  }

  if (!declaresDependency(localConfiguredAuthManifest, '@nextagent/agent-app')) {
    failures.push('local-configured-auth.package.json must declare @nextagent/agent-app.');
  }

  if (!declaresDependency(localConfiguredAuthManifest, '@nextagent/agent-channel-web-auth-local')) {
    failures.push('local-configured-auth.package.json must declare @nextagent/agent-channel-web-auth-local.');
  }

  const lockstep = rootPackage['x-nextagent']?.sharedDependencyLockstep ?? [];
  for (const dependencyName of lockstep) {
    const declared = [
      ['frontend/agent-web', dependencyVersion(frontendPackage, dependencyName)],
      ['packages/agent-app', dependencyVersion(agentApp, dependencyName)],
      ['packages/agent-app-frontend-hosting', dependencyVersion(hostingPackage, dependencyName)],
    ].filter((entry) => entry[1] !== undefined);
    if (declared.length > 1 && new Set(declared.map((entry) => entry[1])).size > 1) {
      failures.push(`${dependencyName} must use the same version across ${declared.map((entry) => entry[0]).join(', ')}.`);
    }
  }

  if (options.artifactPackagePath !== undefined) {
    const artifactPackage = readJson(resolve(options.artifactPackagePath, 'package.json'));
    if (artifactPackage.name !== '@nextagent/agent-web' || artifactPackage.version !== rootPackage.version) {
      failures.push('@nextagent/agent-web artifact package version must equal root package.json version.');
    }
    failures.push(...validateAgentWebArtifact(resolve(options.artifactPackagePath)));
  }

  if (options.checkInstalledFrontendPackage) {
    const installedPath = resolve(root, 'node_modules', '@nextagent', 'agent-web', 'package.json');
    if (!existsSync(installedPath)) {
      failures.push('Installed @nextagent/agent-web package is required for with-frontend.');
    } else {
      const installedPackage = readJson(installedPath);
      if (installedPackage.version !== rootPackage.version) {
        failures.push('Installed @nextagent/agent-web package version must equal root package.json version.');
      }
    }
  }

  return failures;
}

function validateAgentWebArtifact(artifactPackagePath) {
  const failures = [];
  const distRoot = resolve(artifactPackagePath, 'dist');
  const indexHtml = resolve(distRoot, 'index.html');
  const piuRoot = resolve(distRoot, 'piu');
  const piuJs = resolve(piuRoot, 'AIAgentPIU.js');
  const piuCss = resolve(piuRoot, 'AIAgentPIU.css');

  for (const [label, file] of [
    ['dist/index.html', indexHtml],
    ['dist/piu/AIAgentPIU.js', piuJs],
    ['dist/piu/AIAgentPIU.css', piuCss],
  ]) {
    if (!existsSync(file)) {
      failures.push(`@nextagent/agent-web artifact must include ${label}.`);
    }
  }

  if (existsSync(indexHtml)) {
    const indexSource = readFileSync(indexHtml, 'utf8');
    if (!indexSource.includes('<script src="/febs/v1/assets/prelude-loader"></script>')) {
      failures.push('@nextagent/agent-web artifact index.html must be the immersive entry and include the fixed Prel loader.');
    }
    for (const forbidden of ['/src/entries/local.tsx', 'LocalLoginPage', 'nextagent.themePreference', 'nextagent.localePreference']) {
      if (indexSource.includes(forbidden)) {
        failures.push(`@nextagent/agent-web artifact index.html must not contain local-only marker ${forbidden}.`);
      }
    }
  }

  for (const forbidden of ['immersive.html', 'collaborative.html', 'febs']) {
    if (existsSync(resolve(distRoot, forbidden))) {
      failures.push(`@nextagent/agent-web artifact must not include ${forbidden}.`);
    }
  }

  if (existsSync(piuRoot)) {
    const piuFiles = readdirSync(piuRoot).sort();
    const expected = ['AIAgentPIU.css', 'AIAgentPIU.js'];
    if (JSON.stringify(piuFiles) !== JSON.stringify(expected)) {
      failures.push('@nextagent/agent-web artifact piu directory must contain only AIAgentPIU.js and AIAgentPIU.css.');
    }
  }

  failures.push(...validatePiuClosedRuntimeAssetSet({ piuJs, piuCss }));

  return failures;
}

if (isMain()) {
  const artifactPackagePath = args.has('--artifact') ? resolve(repoRoot, 'dist', 'dev', 'agent-web-package') : undefined;
  const failures = validateFullstackPackaging(repoRoot, {
    artifactPackagePath,
    checkInstalledFrontendPackage: args.has('--installed'),
  });
  if (failures.length > 0) {
    console.error('ERROR: fullstack packaging validation failed');
    for (const failure of failures) {
      console.error(`  - ${failure}`);
    }
    process.exitCode = 1;
  } else {
    console.log('fullstack packaging validation passed');
  }
}

function isMain() {
  return process.argv[1] !== undefined && resolve(process.argv[1]) === scriptPath;
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function declaresDependency(packageJson, dependencyName) {
  return dependencyVersion(packageJson, dependencyName) !== undefined;
}

function dependencyVersion(packageJson, dependencyName) {
  return (
    packageJson.dependencies?.[dependencyName] ??
    packageJson.devDependencies?.[dependencyName] ??
    packageJson.peerDependencies?.[dependencyName] ??
    packageJson.optionalDependencies?.[dependencyName]
  );
}
