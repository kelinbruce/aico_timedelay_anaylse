const { existsSync, readFileSync, readdirSync } = require('node:fs');
const { join, relative } = require('node:path');

const root = process.cwd();
const dependencyCruiserConfig = require('../../dependency-cruiser.config.cjs');
const policy = dependencyCruiserConfig.architecturePolicy;

const dependencyFields = ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies'];

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function dependencyNames(packageJson) {
  return dependencyFields.flatMap((field) => Object.keys(packageJson[field] ?? {}));
}

function packageDependencyViolations(packageJson, packageName) {
  const allowed = policy.implementationAllowedDependencies?.[packageName] ?? [];
  const forbiddenImplementationDependencies = new Set(
    policy.implementationPackages
      .map((candidate) => `@nextagent/${candidate}`)
      .filter((candidate) => candidate !== `@nextagent/${packageName}`)
      .filter((candidate) => !allowed.includes(candidate.slice('@nextagent/'.length))),
  );

  return dependencyNames(packageJson).filter(
    (dependencyName) =>
      forbiddenImplementationDependencies.has(dependencyName) && !isAllowedProductEntrypointDependency(packageName, dependencyName, packageJson),
  );
}

function isAllowedProductEntrypointDependency(packageName, dependencyName, packageJson) {
  if (dependencyName !== '@nextagent/agent-app') {
    return false;
  }
  if (packageName !== 'agent-platform-gateway-local') {
    return false;
  }
  const exports = packageJson.exports ?? {};
  return Object.prototype.hasOwnProperty.call(exports, './entrypoints/local');
}

function findManifestViolations(workspaceRoot = root) {
  const packagesRoot = join(workspaceRoot, 'packages');
  if (!existsSync(packagesRoot)) {
    return [];
  }

  return readdirSync(packagesRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .filter((entry) => policy.nonAppImplementationPackages.includes(entry.name))
    .flatMap((entry) => {
      const manifestPath = join(packagesRoot, entry.name, 'package.json');
      if (!existsSync(manifestPath)) {
        return [];
      }
      const packageJson = readJson(manifestPath);
      return packageDependencyViolations(packageJson, entry.name).map((dependencyName) => ({
        packageName: entry.name,
        dependencyName,
        manifestPath,
      }));
    });
}

function formatManifestViolation(violation, workspaceRoot = root) {
  const manifestPath = relative(workspaceRoot, violation.manifestPath).replace(/\\/g, '/');
  return `${manifestPath}: non-app implementation package @nextagent/${violation.packageName} must not depend on implementation package ${violation.dependencyName}`;
}

function runCli(workspaceRoot = root) {
  const violations = findManifestViolations(workspaceRoot);
  if (violations.length === 0) {
    console.log('✔ package manifest dependency policy passed');
    return 0;
  }

  console.error('ERROR: package manifest dependency policy violations found');
  for (const violation of violations) {
    console.error(`  - ${formatManifestViolation(violation, workspaceRoot)}`);
  }
  return 1;
}

if (require.main === module) {
  process.exitCode = runCli(process.argv[2] ?? root);
}

module.exports = {
  dependencyFields,
  findManifestViolations,
  formatManifestViolation,
  packageDependencyViolations,
  runCli,
};
