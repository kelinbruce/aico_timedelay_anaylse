import { cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { packLocalRuntime, qualifyCandidateId, resolvePackageTarget } from './pack-local-runtime.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const reportDir =
  process.env.NEXTAGENT_RELEASE_CHECK_DIR === undefined
    ? resolve(root, '.tmp', 'release-package-gate')
    : resolve(process.env.NEXTAGENT_RELEASE_CHECK_DIR);
mkdirSync(reportDir, { recursive: true });

const caseResultsPath = resolve(reportDir, 'release-package.cases.json');
rmSync(caseResultsPath, { force: true });
rmSync(resolve(reportDir, 'release-package.json'), { force: true });
rmSync(resolve(reportDir, 'package-candidate-evidence.json'), { force: true });
rmSync(resolve(reportDir, 'health-proof.json'), { force: true });

const candidateRoot = process.env.NEXTAGENT_RELEASE_CANDIDATE_ROOT ?? (await createEphemeralCandidateRoot());
const scopeFile = process.env.NEXTAGENT_RELEASE_SCOPE_FILE ?? createEphemeralScopeFile();
ensureWorkspaceFrontendArtifactInstalled();

const vitestPath = resolve(root, 'node_modules', 'vitest', 'vitest.mjs');
const env = {
  ...process.env,
  NEXTAGENT_RELEASE_CHECK_DIR: reportDir,
  NEXTAGENT_CASE_RESULTS_FILE: caseResultsPath,
  NEXTAGENT_RELEASE_CANDIDATE_ROOT: candidateRoot,
  NEXTAGENT_RELEASE_SCOPE_FILE: scopeFile,
};
const result = spawnSync(
  process.execPath,
  [vitestPath, 'run', '--config', 'vitest.config.release.ts', '--maxWorkers=1', 'tests/e2e/release-package/release-package-gate.test.ts'],
  { cwd: root, env, stdio: 'inherit' },
);
const reportResult = spawnSync(
  process.execPath,
  [vitestPath, 'run', '--config', 'vitest.config.release.ts', '--maxWorkers=1', 'tests/e2e/release-package/write-report.test.ts'],
  { cwd: root, env, stdio: 'inherit' },
);
process.exitCode = result.status === 0 && reportResult.status === 0 ? 0 : (result.status ?? reportResult.status ?? 1);

async function createEphemeralCandidateRoot() {
  const packageRoot = mkdtempSync(resolve(tmpdir(), 'nextagent-release-package-'));
  const target = resolvePackageTarget(process.platform, process.arch);
  const requestedProfile = process.env.NEXTAGENT_RELEASE_PACKAGE_PROFILE;
  const fallbackProfile = 'with-frontend';
  const packageProfile = requestedProfile === 'backend-only' || requestedProfile === 'with-frontend' ? requestedProfile : fallbackProfile;
  const baseCandidateId = `release-package-gate-${Date.now()}`;
  const candidateId = qualifyCandidateId(baseCandidateId, target);
  await packLocalRuntime({
    repoRoot: root,
    packageRootArg: packageRoot,
    candidateId,
    packageProfile,
    archiveOutputRoot: reportDir,
    skipReleaseGateVerification: true,
    stageDefaultAgent: true,
    preservePackageRootAfterArchive: true,
  });
  return packageRoot;
}

function createEphemeralScopeFile() {
  const scopeFile = resolve(reportDir, 'release-scope.txt');
  writeFileSync(scopeFile, 'Local release-package gate smoke scope.', 'utf8');
  return scopeFile;
}

function ensureWorkspaceFrontendArtifactInstalled() {
  const artifactRoot = resolve(root, 'dist', 'dev', 'agent-web-package');
  const artifactManifest = resolve(artifactRoot, 'package.json');
  const workspacePackageRoot = resolve(root, 'node_modules', '@nextagent', 'agent-web');
  if (!existsSync(artifactManifest)) {
    return;
  }
  rmSync(workspacePackageRoot, { recursive: true, force: true });
  cpSync(artifactRoot, workspacePackageRoot, { recursive: true });
}
