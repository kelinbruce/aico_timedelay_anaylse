import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const mockServerDir = path.resolve(__dirname, '../agent-web-mock-server');
const viteBin = path.join(__dirname, 'node_modules', 'vite', 'bin', 'vite.js');

const mock = spawn(process.execPath, [path.join(mockServerDir, 'server.js')], {
  cwd: mockServerDir,
  stdio: 'inherit',
  env: process.env,
});
const vite = spawn(process.execPath, [viteBin, '--mode', 'mock'], {
  cwd: __dirname,
  stdio: 'inherit',
  env: {
    ...process.env,
    VITE_PROXY_TARGET: process.env.VITE_PROXY_TARGET || 'http://localhost:3001',
    VITE_TRANSPORT_KIND: process.env.VITE_TRANSPORT_KIND || 'SSE',
  },
});

const stop = (code = 0) => {
  if (!mock.killed) {
    mock.kill('SIGTERM');
  }
  if (!vite.killed) {
    vite.kill('SIGTERM');
  }
  process.exit(code);
};

mock.on('exit', (code) => {
  if (code && code !== 0) {
    stop(code);
  }
});

vite.on('exit', (code) => {
  stop(code ?? 0);
});

process.on('SIGINT', () => stop(130));
process.on('SIGTERM', () => stop(143));
