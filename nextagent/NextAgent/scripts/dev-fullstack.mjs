import { spawn } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const scriptPath = fileURLToPath(import.meta.url);

export function devFullstackSteps(root = repoRoot) {
  return [
    { command: 'npm', args: ['install'], cwd: root },
    { command: 'npm', args: ['run', 'build'], cwd: root },
    { command: 'npm', args: ['install'], cwd: resolve(root, 'frontend', 'agent-web') },
    { command: 'npm', args: ['run', 'build:vite:modes'], cwd: resolve(root, 'frontend', 'agent-web') },
    { command: 'node', args: ['scripts/assemble-agent-web-artifact.mjs'], cwd: root },
    { command: 'npm', args: ['install', '--no-save', resolve(root, 'dist', 'dev', 'agent-web-package')], cwd: root },
    { command: 'node', args: ['scripts/validate-fullstack-packaging.mjs', '--artifact', '--installed'], cwd: root },
    {
      command: 'node',
      args: ['packages/agent-app/dist/entrypoints/with-frontend.js'],
      cwd: root,
      env: { NEXTAGENT_ENTRYPOINT_PROFILE: 'development' },
    },
  ];
}

export async function runDevFullstack(root = repoRoot, runner = run) {
  for (const step of devFullstackSteps(root)) {
    await runner(step.command, step.args, step.cwd, step.env);
  }
}

if (isMain()) {
  await runDevFullstack(repoRoot);
}

export function run(command, args, cwd, env = {}) {
  return new Promise((resolvePromise, reject) => {
    const commandSpec = commandForPlatform(command, args);
    const child = spawn(commandSpec.command, commandSpec.args, { cwd, env: { ...process.env, ...env }, stdio: 'inherit' });
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) {
        resolvePromise();
        return;
      }
      reject(new Error(`${command} ${args.join(' ')} failed with exit code ${code}.`));
    });
  });
}

function isMain() {
  return process.argv[1] !== undefined && resolve(process.argv[1]) === scriptPath;
}

function commandForPlatform(command, args) {
  if (process.platform === 'win32' && command === 'npm') {
    return { command: 'cmd.exe', args: ['/d', '/s', '/c', 'npm', ...args] };
  }
  return { command, args };
}
