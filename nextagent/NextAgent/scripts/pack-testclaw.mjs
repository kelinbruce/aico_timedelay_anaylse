import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { resolvePackageTarget } from './pack-local-runtime.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const testclawRoot = resolve(root, 'tests', 'TESTClaw');
const targetDir = resolve(testclawRoot, 'target');

const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';

const target = resolvePackageTarget(process.platform, process.arch);
const archivePath = resolve(root, `nextagent-local-${target.platformSuffix}.${target.archiveExtension}`);

if (!existsSync(archivePath)) {
  console.error(`Missing release archive: ${archivePath}`);
  process.exit(1);
}

if (target.archiveExtension !== 'zip') {
  console.error(`Unsupported release archive type for TESTClaw staging: ${target.archiveExtension}`);
  process.exit(1);
}

const requiredTestDependencies = [
  resolve(testclawRoot, 'node_modules', 'vitest', 'package.json'),
  resolve(testclawRoot, 'node_modules', '@playwright', 'test', 'package.json'),
];

if (requiredTestDependencies.some((dependencyPath) => !existsSync(dependencyPath))) {
  console.log('Installing TESTClaw test dependencies...');
  const installResult = spawnSync(npmCommand, ['ci'], {
    cwd: testclawRoot,
    stdio: 'inherit',
    encoding: 'utf8',
    ...(process.platform === 'win32' ? { shell: true } : {}),
  });

  if (installResult.status !== 0) {
    process.exitCode = installResult.status ?? 1;
    process.exit();
  }
}

rmSync(targetDir, { recursive: true, force: true });
mkdirSync(targetDir, { recursive: true });

const extractResult = spawnSync(
  'powershell',
  [
    '-NoProfile',
    '-ExecutionPolicy',
    'Bypass',
    '-Command',
    `$ErrorActionPreference='Stop'; Expand-Archive -LiteralPath ${JSON.stringify(archivePath)} -DestinationPath ${JSON.stringify(targetDir)} -Force`,
  ],
  { cwd: root, stdio: 'inherit', encoding: 'utf8' },
);

if (extractResult.status !== 0) {
  process.exitCode = extractResult.status ?? 1;
  process.exit();
}

const testResult = spawnSync(npmCommand, ['--prefix', 'tests/TESTClaw', 'run', 'pack'], {
  cwd: root,
  stdio: 'inherit',
  encoding: 'utf8',
  ...(process.platform === 'win32' ? { shell: true } : {}),
});

process.exitCode = testResult.status ?? 1;
