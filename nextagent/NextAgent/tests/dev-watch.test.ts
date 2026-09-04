import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
const silentLogger = {
  info: () => undefined,
  error: () => undefined,
};
interface TestLogger {
  info: (...args: unknown[]) => unknown;
  error: (...args: unknown[]) => unknown;
}

describe('dev watch mode', () => {
  it('defines a source watch plan without entering the packaged fullstack path', async () => {
    const { createDevWatchPlan } = await importDevWatchScript();
    const plan = createDevWatchPlan(root);

    expect(plan.proxyTarget).toBe('http://127.0.0.1:3000');
    expect(plan.devHost).toBe('127.0.0.1');
    expect(plan.devUrls).toEqual({
      local: 'http://127.0.0.1:5173/',
      immersive: 'http://127.0.0.1:5173/immersive/',
      collaborative: 'http://127.0.0.1:5173/collaborative/',
    });
    expect(plan.typeScriptWatch).toEqual({
      root,
      configPath: resolve(root, 'tsconfig.json'),
    });
    expect(plan.frontendProcess).toMatchObject({
      command: 'npm',
      args: ['run', 'dev'],
      cwd: resolve(root, 'frontend', 'agent-web'),
      env: {
        VITE_PROXY_TARGET: 'http://127.0.0.1:3000',
        VITE_DEV_HOST: '127.0.0.1',
      },
    });
    expect(plan.backendProcess).toMatchObject({
      command: 'node',
      args: ['packages/agent-platform-gateway-local/dist/entrypoints/local.js'],
      cwd: root,
    });

    const scriptSource = readFileSync(join(root, 'scripts', 'dev-watch.mjs'), 'utf8');
    for (const forbidden of ['npm install', 'build:vite', 'assemble-agent-web-artifact', 'with-frontend']) {
      expect(scriptSource).not.toContain(forbidden);
    }
  });

  it('keeps dev fullstack and runtime transport selection untouched', () => {
    const packageJson = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as {
      scripts: Record<string, string>;
    };
    const watchSource = readFileSync(join(root, 'scripts', 'dev-watch.mjs'), 'utf8');

    expect(packageJson.scripts['dev:watch']).toBe('node scripts/dev-watch.mjs');
    expect(packageJson.scripts['dev:fullstack']).toBe('node scripts/dev-fullstack.mjs');
    expect(watchSource).not.toContain('.env.websocket');
    expect(watchSource).not.toContain('VITE_TRANSPORT_KIND');
  });

  it('enables Vite API proxy websocket upgrade support', () => {
    const viteConfig = readFileSync(join(root, 'frontend', 'agent-web', 'vite.config.ts'), 'utf8');

    expect(viteConfig).toMatch(/const devHost = process\.env\.VITE_DEV_HOST \|\| envFromFile\.VITE_DEV_HOST \|\| ['"]127\.0\.0\.1['"];/u);
    expect(viteConfig).toMatch(/server:\s*\{[\s\S]*host:\s*devHost[\s\S]*port:\s*5173[\s\S]*strictPort:\s*true/u);
    expect(viteConfig).toMatch(/['"]\/api['"]:\s*\{[\s\S]*target:\s*proxyTarget[\s\S]*changeOrigin:\s*true[\s\S]*ws:\s*true/u);
  });

  it('defines one Vite server for all host mode dev routes', () => {
    const viteConfig = readFileSync(join(root, 'frontend', 'agent-web', 'vite.config.ts'), 'utf8');
    const preludeMock = readFileSync(join(root, 'frontend', 'agent-web', 'scripts', 'prelude-mock-source.mjs'), 'utf8');

    expect(viteConfig).toContain('multiHostDevRoutesPlugin');
    expect(viteConfig).toMatch(/pathname\.startsWith\(['"]\/immersive\/['"]\)/u);
    expect(viteConfig).toMatch(/pathname\.startsWith\(['"]\/collaborative\/['"]\)/u);
    expect(viteConfig).toMatch(/pathname\.startsWith\(['"]\/api\/['"]\)/u);
    expect(viteConfig).toMatch(/pathname\.startsWith\(['"]\/src\/['"]\)/u);
    expect(viteConfig).toMatch(/pathname\.startsWith\(['"]\/assets\/['"]\)/u);
    expect(preludeMock).toContain('/src/entries/piu.tsx');
    expect(preludeMock).toContain('function runReadyCallback(callback)');
    expect(preludeMock).toContain('runReadyCallback(callback)');
    expect(preludeMock).not.toContain('dist/piu/AIAgentPIU.js');
    expect(preludeMock).not.toContain('dist/piu/AIAgentPIU.css');
  });

  it('starts the backend only after a successful TypeScript watch compile', async () => {
    const { createBackendRestartController, createTypeScriptSolutionWatch } = await importDevWatchScript();
    const { fakeTs } = createFakeTypeScript([
      { code: 6193, messageText: 'Found 1 error. Watching for file changes.' },
      { code: 6194, messageText: 'Found 0 errors. Watching for file changes.' },
    ]);
    const events: string[] = [];
    const failures: string[] = [];
    const controller = createBackendRestartController({
      startBackend: () => {
        events.push('start:backend-1');
        return 'backend-1';
      },
      stopBackend: async (backend: string) => {
        events.push(`stop:${backend}`);
      },
    });

    const watch = createTypeScriptSolutionWatch({
      ts: fakeTs,
      root,
      configPath: resolve(root, 'tsconfig.json'),
      logger: silentLogger,
      onFailedBuild: (message: string) => {
        failures.push(message);
      },
      onSuccessfulBuild: () => controller.restart(),
    });
    await flushPromises();

    expect(failures).toEqual(['Found 1 error. Watching for file changes.']);
    expect(events).toEqual(['start:backend-1']);
    watch.close();
  });

  it('restarts the backend on subsequent successful TypeScript watch compiles', async () => {
    const { createBackendRestartController, createTypeScriptSolutionWatch } = await importDevWatchScript();
    const { fakeTs } = createFakeTypeScript([
      { code: 6194, messageText: 'Found 0 errors. Watching for file changes.' },
      { code: 6194, messageText: 'Found 0 errors. Watching for file changes.' },
    ]);
    const events: string[] = [];
    let nextBackendId = 1;
    const controller = createBackendRestartController({
      startBackend: () => {
        const backend = `backend-${nextBackendId}`;
        nextBackendId += 1;
        events.push(`start:${backend}`);
        return backend;
      },
      stopBackend: async (backend: string) => {
        events.push(`stop:${backend}`);
      },
    });

    createTypeScriptSolutionWatch({
      ts: fakeTs,
      root,
      configPath: resolve(root, 'tsconfig.json'),
      logger: silentLogger,
      onFailedBuild: () => {
        throw new Error('compile failure was not expected');
      },
      onSuccessfulBuild: () => controller.restart(),
    });
    await waitFor(() => events.length === 3);
    await controller.stop();

    expect(events).toEqual(['start:backend-1', 'stop:backend-1', 'start:backend-2', 'stop:backend-2']);
  });

  it('ignores delayed exit events from a backend stopped for restart', async () => {
    const { runDevWatch } = await importDevWatchScript();
    const signalTarget = new EventEmitter();
    const { fakeTs } = createFakeTypeScript([{ code: 6194, messageText: 'Found 0 errors. Watching for file changes.' }]);
    const children: FakeChildProcess[] = [];
    const stoppedTreePids: number[] = [];

    const runPromise = runDevWatch(root, {
      ts: fakeTs,
      logger: silentLogger,
      stdio: 'pipe',
      signalTarget,
      platform: 'win32',
      copyRuntimeAssets: async () => undefined,
      waitForBackendReady: async () => undefined,
      restartDebounceMs: 0,
      shouldRestartAfterSuccessfulBuild: () => true,
      stopProcessTree: async (pid: number) => {
        stoppedTreePids.push(pid);
      },
      spawnImpl: (command: string, args: string[]) => {
        const child = new FakeChildProcess(command, args, 4100 + children.length);
        children.push(child);
        return child;
      },
    });

    await waitFor(() => children.length === 2);
    fakeTs.emitStatus({ code: 6194, messageText: 'Found 0 errors. Watching for file changes.' });
    await waitFor(() => children.filter((child) => child.command === 'node').length === 2);
    expect(stoppedTreePids).toEqual([4100]);

    children[0]!.exitUnexpectedly(1);
    await flushPromises();

    signalTarget.emit('SIGTERM');
    await expect(runPromise).resolves.toBeUndefined();
  });

  it('coalesces repeated successful TypeScript watch statuses into one backend restart', async () => {
    const { runDevWatch } = await importDevWatchScript();
    const signalTarget = new EventEmitter();
    const { fakeTs } = createFakeTypeScript([
      { code: 6194, messageText: 'Found 0 errors. Watching for file changes.' },
      { code: 6194, messageText: 'Found 0 errors. Watching for file changes.' },
      { code: 6194, messageText: 'Found 0 errors. Watching for file changes.' },
    ]);
    const children: FakeChildProcess[] = [];

    const runPromise = runDevWatch(root, {
      ts: fakeTs,
      logger: silentLogger,
      stdio: 'pipe',
      signalTarget,
      copyRuntimeAssets: async () => undefined,
      waitForBackendReady: async () => undefined,
      restartDebounceMs: 0,
      shouldRestartAfterSuccessfulBuild: () => true,
      spawnImpl: (command: string, args: string[]) => {
        const child = new FakeChildProcess(command, args);
        children.push(child);
        return child;
      },
    });

    await waitFor(() => children.length === 2);
    signalTarget.emit('SIGTERM');

    await expect(runPromise).resolves.toBeUndefined();
    expect(children.filter((child) => child.command === 'node')).toHaveLength(1);
  });

  it('keeps the frontend alive when a later backend restart fails readiness', async () => {
    const { runDevWatch } = await importDevWatchScript();
    const signalTarget = new EventEmitter();
    const { fakeTs } = createFakeTypeScript([{ code: 6194, messageText: 'Found 0 errors. Watching for file changes.' }]);
    const logger = {
      info: () => undefined,
      error: (message: unknown) => {
        errors.push(String(message));
      },
    };
    const errors: string[] = [];
    const children: FakeChildProcess[] = [];
    let readinessChecks = 0;

    const runPromise = runDevWatch(root, {
      ts: fakeTs,
      logger,
      stdio: 'pipe',
      signalTarget,
      copyRuntimeAssets: async () => undefined,
      waitForBackendReady: async () => {
        readinessChecks += 1;
        if (readinessChecks > 1) {
          throw new Error('simulated slow backend');
        }
      },
      restartDebounceMs: 0,
      shouldRestartAfterSuccessfulBuild: () => true,
      spawnImpl: (command: string, args: string[]) => {
        const child = new FakeChildProcess(command, args);
        children.push(child);
        return child;
      },
    });

    await waitFor(() => children.length === 2);
    fakeTs.emitStatus({ code: 6194, messageText: 'Found 0 errors. Watching for file changes.' });
    await waitFor(() => readinessChecks === 2);

    expect(children.filter((child) => child.command !== 'node')).toHaveLength(1);
    expect(errors).toEqual([
      'Backend restart readiness check failed; keeping dev-watch and the frontend alive for the next build. simulated slow backend',
    ]);

    signalTarget.emit('SIGTERM');
    await expect(runPromise).resolves.toBeUndefined();
  });

  it('uses cmd.exe only for npm commands on Windows', async () => {
    const { commandForPlatform } = await importDevWatchScript();

    expect(commandForPlatform('npm', ['run', 'dev'], 'win32')).toEqual({
      command: 'cmd.exe',
      args: ['/d', '/s', '/c', 'npm', 'run', 'dev'],
    });
    expect(commandForPlatform('node', ['packages/agent-platform-gateway-local/dist/entrypoints/local.js'], 'win32')).toEqual({
      command: 'node',
      args: ['packages/agent-platform-gateway-local/dist/entrypoints/local.js'],
    });
  });

  it('cleans up frontend and backend children on termination signals', async () => {
    const { runDevWatch } = await importDevWatchScript();
    const signalTarget = new EventEmitter();
    const { fakeTs } = createFakeTypeScript([{ code: 6194, messageText: 'Found 0 errors. Watching for file changes.' }]);
    const children: FakeChildProcess[] = [];

    const runPromise = runDevWatch(root, {
      ts: fakeTs,
      logger: silentLogger,
      stdio: 'pipe',
      signalTarget,
      copyRuntimeAssets: async () => undefined,
      waitForBackendReady: async () => undefined,
      restartDebounceMs: 0,
      spawnImpl: (command: string, args: string[]) => {
        const child = new FakeChildProcess(command, args);
        children.push(child);
        return child;
      },
    });

    await waitFor(() => children.length === 2);
    signalTarget.emit('SIGTERM');

    await expect(runPromise).resolves.toBeUndefined();
    expect(children.map((child) => child.killedWith)).toEqual(['SIGTERM', 'SIGTERM']);
  });

  it('cleans up Windows child process trees on termination signals', async () => {
    const { runDevWatch } = await importDevWatchScript();
    const signalTarget = new EventEmitter();
    const { fakeTs } = createFakeTypeScript([{ code: 6194, messageText: 'Found 0 errors. Watching for file changes.' }]);
    const children: FakeChildProcess[] = [];
    const stoppedTreePids: number[] = [];

    const runPromise = runDevWatch(root, {
      ts: fakeTs,
      logger: silentLogger,
      stdio: 'pipe',
      signalTarget,
      platform: 'win32',
      copyRuntimeAssets: async () => undefined,
      waitForBackendReady: async () => undefined,
      restartDebounceMs: 0,
      stopProcessTree: async (pid: number) => {
        stoppedTreePids.push(pid);
      },
      spawnImpl: (command: string, args: string[]) => {
        const child = new FakeChildProcess(command, args, 4100 + children.length);
        children.push(child);
        return child;
      },
    });

    await waitFor(() => children.length === 2);
    signalTarget.emit('SIGTERM');

    await expect(runPromise).resolves.toBeUndefined();
    expect(children.map((child) => child.command)).toEqual(['node', 'cmd.exe']);
    expect(stoppedTreePids).toEqual([4100, 4101]);
    expect(children.map((child) => child.killedWith)).toEqual([undefined, undefined]);
  });

  it('fails and cleans up when a required child process exits unexpectedly', async () => {
    const { runDevWatch } = await importDevWatchScript();
    const signalTarget = new EventEmitter();
    const { fakeTs } = createFakeTypeScript([{ code: 6194, messageText: 'Found 0 errors. Watching for file changes.' }]);
    const children: FakeChildProcess[] = [];
    let releaseReady!: () => void;
    const readyPromise = new Promise<void>((resolveReady) => {
      releaseReady = resolveReady;
    });

    const runPromise = runDevWatch(root, {
      ts: fakeTs,
      logger: silentLogger,
      stdio: 'pipe',
      signalTarget,
      copyRuntimeAssets: async () => undefined,
      waitForBackendReady: () => readyPromise,
      restartDebounceMs: 0,
      spawnImpl: (command: string, args: string[]) => {
        const child = new FakeChildProcess(command, args);
        children.push(child);
        return child;
      },
    });

    await waitFor(() => children.length === 1);
    children[0]!.exitUnexpectedly(1);
    releaseReady();

    await expect(runPromise).rejects.toThrow(/backend process exited unexpectedly with code 1/u);
  });

  it('starts the frontend only after the backend readiness check passes', async () => {
    const { runDevWatch } = await importDevWatchScript();
    const signalTarget = new EventEmitter();
    const { fakeTs } = createFakeTypeScript([{ code: 6194, messageText: 'Found 0 errors. Watching for file changes.' }]);
    const events: string[] = [];
    const children: FakeChildProcess[] = [];

    const runPromise = runDevWatch(root, {
      ts: fakeTs,
      logger: silentLogger,
      stdio: 'pipe',
      signalTarget,
      platform: 'win32',
      copyRuntimeAssets: async () => {
        events.push('copy:runtime-assets');
      },
      restartDebounceMs: 0,
      waitForBackendReady: async (proxyTarget: string) => {
        events.push(`ready:${proxyTarget}`);
      },
      spawnImpl: (command: string, args: string[]) => {
        events.push(`spawn:${command}:${args.join(' ')}`);
        const child = new FakeChildProcess(command, args);
        children.push(child);
        return child;
      },
    });

    await waitFor(() => children.length === 2);
    signalTarget.emit('SIGTERM');
    await expect(runPromise).resolves.toBeUndefined();

    expect(events).toEqual([
      'copy:runtime-assets',
      'spawn:node:packages/agent-platform-gateway-local/dist/entrypoints/local.js',
      'ready:http://127.0.0.1:3000',
      'spawn:cmd.exe:/d /s /c npm run dev',
    ]);
  });
});

async function importDevWatchScript(): Promise<{
  createDevWatchPlan: (root: string) => {
    proxyTarget: string;
    devHost: string;
    devUrls: { local: string; immersive: string; collaborative: string };
    typeScriptWatch: { root: string; configPath: string };
    frontendProcess: { command: string; args: string[]; cwd: string; env: Record<string, string> };
    backendProcess: { command: string; args: string[]; cwd: string; env: Record<string, string> };
  };
  commandForPlatform: (command: string, args: string[], platform: string) => { command: string; args: string[] };
  createBackendRestartController: <T>(options: { startBackend: () => T; stopBackend: (backend: T) => Promise<void> }) => {
    restart: () => Promise<T>;
    stop: () => Promise<void>;
  };
  createTypeScriptSolutionWatch: (options: {
    ts: unknown;
    root: string;
    configPath: string;
    logger: TestLogger;
    onFailedBuild: (message: string) => void;
    onSuccessfulBuild: () => unknown;
  }) => { close: () => void };
  runDevWatch: (
    root: string,
    options: {
      ts: unknown;
      logger: TestLogger;
      stdio: 'pipe';
      signalTarget: EventEmitter;
      platform?: string;
      copyRuntimeAssets?: () => Promise<void>;
      waitForBackendReady?: (proxyTarget: string) => Promise<void>;
      backendReadyTimeoutMs?: number;
      restartDebounceMs?: number;
      shouldRestartAfterSuccessfulBuild?: () => boolean;
      stopProcessTree?: (pid: number) => Promise<void>;
      spawnImpl: (command: string, args: string[]) => FakeChildProcess;
    },
  ) => Promise<void>;
}> {
  // @ts-expect-error The watch script is a dev-only ESM utility.
  return import('../scripts/dev-watch.mjs');
}

function createFakeTypeScript(statuses: Array<{ code: number; messageText: string }>): {
  fakeTs: unknown & { emitStatus: (status: { code: number; messageText: string }) => void };
  calls: { buildCount: number; roots: string[]; closed: boolean };
} {
  const calls = {
    buildCount: 0,
    roots: [] as string[],
    closed: false,
  };
  let reportStatusChanged: ((diagnostic: { code: number; messageText: string }, newLine: string) => void) | undefined;
  const fakeTs: any = {
    emitStatus: (status: { code: number; messageText: string }) => {
      if (!reportStatusChanged) {
        throw new Error('TypeScript watch host has not been initialized.');
      }

      reportStatusChanged(status, '\n');
    },
    sys: {},
    flattenDiagnosticMessageText: (messageText: unknown) => String(messageText),
    formatDiagnostic: (diagnostic: { messageText: unknown }) => String(diagnostic.messageText),
    createSolutionBuilderWithWatchHost: (
      _system: unknown,
      _createProgram: unknown,
      reportDiagnostic: (diagnostic: unknown) => void,
      reportSolutionBuilderStatus: (diagnostic: unknown) => void,
      reportWatchStatusChanged: (diagnostic: { code: number; messageText: string }, newLine: string) => void,
    ) => {
      reportStatusChanged = reportWatchStatusChanged;
      return {
        reportDiagnostic,
        reportSolutionBuilderStatus,
        reportWatchStatusChanged,
      };
    },
    createSolutionBuilderWithWatch: (
      host: {
        reportWatchStatusChanged: (diagnostic: { code: number; messageText: string }, newLine: string) => void;
      },
      roots: string[],
    ) => {
      calls.roots = roots;
      return {
        build: () => {
          calls.buildCount += 1;
          for (const status of statuses) {
            host.reportWatchStatusChanged(status, '\n');
          }
        },
        close: () => {
          calls.closed = true;
        },
      };
    },
  };

  return { fakeTs, calls };
}

async function flushPromises(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

async function waitFor(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (predicate()) {
      return;
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 0));
  }

  throw new Error('Timed out waiting for asynchronous test work.');
}

class FakeChildProcess extends EventEmitter {
  readonly command: string;
  readonly args: string[];
  readonly pid?: number | undefined;
  exitCode: number | null = null;
  killed = false;
  killedWith?: string | undefined;

  constructor(command: string, args: string[], pid?: number) {
    super();
    this.command = command;
    this.args = args;
    this.pid = pid;
  }

  kill(signal?: string): boolean {
    this.killed = true;
    this.killedWith = signal;
    this.emit('exit', null, signal);
    return true;
  }

  exitUnexpectedly(code: number): void {
    this.exitCode = code;
    this.emit('exit', code, null);
  }
}
