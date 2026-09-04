import { spawn } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const frontendDir = resolve(repoRoot, 'frontend', 'agent-web');

const children = [];

function spawnChild(command, args, options) {
  const child = spawn(command, args, options);
  children.push(child);
  child.on('exit', (code, signal) => {
    cleanup();
    process.exit(code ?? (signal === null ? 0 : 130));
  });
  child.on('error', (error) => {
    console.error(error);
    cleanup();
    process.exit(1);
  });
  return child;
}

function cleanup() {
  for (const child of children) {
    if (!child.killed) {
      try {
        child.kill('SIGTERM');
      } catch {
        // best-effort cleanup
      }
    }
  }
}

function commandForPlatform(command, args) {
  if (process.platform === 'win32' && command === 'npm') {
    return { command: 'cmd.exe', args: ['/d', '/s', '/c', 'npm', ...args] };
  }
  return { command, args };
}

console.log('Starting NextAgent workflow demo (backend :3010 + Web UI :3011)...');

const backendSpec = commandForPlatform('node', ['scripts/start-demo-workflow-server.mjs']);
spawnChild(backendSpec.command, backendSpec.args, {
  cwd: repoRoot,
  stdio: 'inherit',
  env: { ...process.env },
});

const frontendSpec = commandForPlatform('npm', ['run', 'dev', '--', '--port', '3011', '--strictPort']);
spawnChild(frontendSpec.command, frontendSpec.args, {
  cwd: frontendDir,
  stdio: 'inherit',
  env: {
    ...process.env,
    VITE_PROXY_TARGET: 'http://127.0.0.1:3010',
  },
});

process.on('SIGINT', () => {
  cleanup();
  process.exit(0);
});

process.on('SIGTERM', () => {
  cleanup();
  process.exit(0);
});
