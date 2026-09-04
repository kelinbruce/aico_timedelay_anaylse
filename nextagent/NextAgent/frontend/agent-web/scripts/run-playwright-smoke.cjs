const http = require('node:http');
const path = require('node:path');
const { spawn } = require('node:child_process');

const host = '127.0.0.1';
const port = Number(process.env.PLAYWRIGHT_SMOKE_PORT || process.env.PLAYWRIGHT_E2E_PORT || 5174);
const baseURL = `http://${host}:${port}`;
const rootDir = path.resolve(__dirname, '..');

function waitForServer(url, timeoutMs) {
  const startedAt = Date.now();

  return new Promise((resolve, reject) => {
    const check = () => {
      const request = http.get(url, (response) => {
        response.resume();
        resolve();
      });

      request.on('error', () => {
        if (Date.now() - startedAt > timeoutMs) {
          reject(new Error(`Timed out waiting for ${url}`));
          return;
        }
        setTimeout(check, 500);
      });

      request.setTimeout(2_000, () => {
        request.destroy();
      });
    };

    check();
  });
}

function run(command, args, options) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: rootDir,
      stdio: 'inherit',
      ...options,
    });

    child.on('error', reject);
    child.on('exit', (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`${command} ${args.join(' ')} exited with ${code ?? signal}`));
    });
  });
}

async function main() {
  const playwrightArgs = process.argv.slice(2);
  const viteBin = path.join(rootDir, 'node_modules', 'vite', 'bin', 'vite.js');
  const playwrightCli = path.join(rootDir, 'node_modules', 'playwright', 'cli.js');
  const server = spawn(process.execPath, [viteBin, '--host', host, '--port', String(port), '--strictPort'], {
    cwd: rootDir,
    stdio: 'inherit',
    env: {
      ...process.env,
      VITE_TRANSPORT_KIND: process.env.VITE_TRANSPORT_KIND || 'SSE',
    },
  });

  try {
    await waitForServer(baseURL, 120_000);
    await run(process.execPath, [playwrightCli, 'test', '--config=playwright.config.cjs', ...playwrightArgs], {
      env: {
        ...process.env,
        PLAYWRIGHT_BASE_URL: baseURL,
      },
    });
  } finally {
    server.kill();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
