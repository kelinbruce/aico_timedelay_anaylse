import { spawn } from 'node:child_process';
import { readdirSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { copyRuntimeAssets } from './runtime-assets.mjs';

const scriptPath = fileURLToPath(import.meta.url);
const scriptsDir = dirname(scriptPath);
const defaultRepoRoot = resolve(scriptsDir, '..');
const defaultProxyTarget = 'http://127.0.0.1:3000';
const backendReadinessPath = '/api/v1/runtime/bootstrap';
const successStatusCode = 6194;
const failedStatusCode = 6193;
const defaultBackendReadyTimeoutMs = 30000;
const defaultRestartDebounceMs = 500;

export function createDevWatchPlan(root = defaultRepoRoot) {
  const devHost = process.env.VITE_DEV_HOST || '127.0.0.1';
  const frontendBaseUrl = `http://${devHost}:5173`;
  return {
    proxyTarget: defaultProxyTarget,
    devHost,
    devUrls: {
      local: `${frontendBaseUrl}/`,
      immersive: `${frontendBaseUrl}/immersive/`,
      collaborative: `${frontendBaseUrl}/collaborative/`,
    },
    typeScriptWatch: {
      root,
      configPath: resolve(root, 'tsconfig.json'),
    },
    frontendProcess: {
      label: 'frontend',
      command: 'npm',
      args: ['run', 'dev'],
      cwd: resolve(root, 'frontend', 'agent-web'),
      env: {
        VITE_PROXY_TARGET: defaultProxyTarget,
        VITE_DEV_HOST: devHost,
      },
    },
    backendProcess: {
      label: 'backend',
      command: 'node',
      args: ['packages/agent-platform-gateway-local/dist/entrypoints/local.js'],
      cwd: root,
      env: { NEXTAGENT_ENTRYPOINT_PROFILE: 'development' },
    },
  };
}

export function logDevEntryUrls(plan, logger = console) {
  logger.info(`Local:         ${plan.devUrls.local}`);
  logger.info(`Immersive:     ${plan.devUrls.immersive}`);
  logger.info(`Collaborative: ${plan.devUrls.collaborative}`);
}

export function commandForPlatform(command, args, platform = process.platform) {
  if (platform === 'win32' && command === 'npm') {
    return {
      command: 'cmd.exe',
      args: ['/d', '/s', '/c', 'npm', ...args],
    };
  }

  return {
    command,
    args,
  };
}

export function spawnPlannedProcess(processPlan, options = {}) {
  const spawnImpl = options.spawnImpl ?? spawn;
  const parentEnv = options.parentEnv ?? process.env;
  const stdio = options.stdio ?? 'inherit';
  const commandSpec = commandForPlatform(processPlan.command, processPlan.args, options.platform);

  return spawnImpl(commandSpec.command, commandSpec.args, {
    cwd: processPlan.cwd,
    env: {
      ...parentEnv,
      ...processPlan.env,
    },
    stdio,
  });
}

export function createBackendRestartController(options) {
  const startBackend = options.startBackend;
  const stopBackend = options.stopBackend;
  let currentBackend;
  let queue = Promise.resolve();

  return {
    get currentBackend() {
      return currentBackend;
    },

    restart() {
      queue = queue.then(async () => {
        if (currentBackend) {
          await stopBackend(currentBackend);
        }

        currentBackend = startBackend();
        return currentBackend;
      });

      return queue;
    },

    stop() {
      queue = queue.then(async () => {
        if (!currentBackend) {
          return;
        }

        const backendToStop = currentBackend;
        currentBackend = undefined;
        await stopBackend(backendToStop);
      });

      return queue;
    },
  };
}

export async function waitForBackendReady(proxyTarget = defaultProxyTarget, options = {}) {
  const readinessUrl = new URL(backendReadinessPath, proxyTarget).toString();
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? defaultBackendReadyTimeoutMs;
  const intervalMs = options.intervalMs ?? 100;
  const requestTimeoutMs = options.requestTimeoutMs ?? 1000;
  const deadline = Date.now() + timeoutMs;
  let lastError;

  while (Date.now() <= deadline) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), requestTimeoutMs);
      try {
        const response = await fetchImpl(readinessUrl, { method: 'GET', signal: controller.signal });
        await response.body?.cancel?.();

        if (response.ok) {
          return;
        }

        lastError = new Error(`Backend readiness check returned HTTP ${response.status}.`);
      } finally {
        clearTimeout(timeout);
      }
    } catch (error) {
      lastError = error;
    }

    await sleep(intervalMs);
  }

  const reason = lastError instanceof Error ? ` Last error: ${lastError.message}` : '';
  throw new Error(`Backend did not become ready at ${readinessUrl} within ${timeoutMs}ms.${reason}`);
}

export function stopProcessTree(pid, options = {}) {
  const spawnImpl = options.spawnImpl ?? spawn;

  return new Promise((resolveStop, rejectStop) => {
    const killer = spawnImpl('taskkill.exe', ['/pid', String(pid), '/t', '/f'], {
      stdio: 'ignore',
    });

    killer.once('error', rejectStop);
    killer.once('exit', (code) => {
      if (code === 0) {
        resolveStop();
        return;
      }

      rejectStop(new Error(`taskkill failed for process tree ${pid} with exit code ${code ?? 'unknown'}.`));
    });
  });
}

export function stopChildProcess(child, options = {}) {
  const signal = options.signal ?? 'SIGTERM';
  const killSignal = options.killSignal ?? 'SIGKILL';
  const timeoutMs = options.timeoutMs ?? 5000;
  const platform = options.platform ?? process.platform;

  if (platform === 'win32' && typeof child?.pid === 'number' && child.pid > 0) {
    return stopWindowsChildProcessTree(child, {
      killSignal,
      stopProcessTree: options.stopProcessTree ?? stopProcessTree,
      timeoutMs,
    });
  }

  return new Promise((resolveStop) => {
    if (!child || child.exitCode !== null || child.killed) {
      resolveStop();
      return;
    }

    const timeout = setTimeout(() => {
      child.kill(killSignal);
      resolveStop();
    }, timeoutMs);

    child.once('exit', () => {
      clearTimeout(timeout);
      resolveStop();
    });

    child.kill(signal);
  });
}

function stopWindowsChildProcessTree(child, options) {
  const killSignal = options.killSignal;
  const stopProcessTreeImpl = options.stopProcessTree;
  const timeoutMs = options.timeoutMs;

  return new Promise((resolveStop) => {
    if (!child || child.exitCode !== null || child.killed) {
      resolveStop();
      return;
    }

    let settled = false;
    const finish = () => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      child.off('exit', finish);
      resolveStop();
    };
    const forceDirectKill = () => {
      try {
        child.kill(killSignal);
      } catch {
        // The process may have already exited while taskkill was running.
      }
    };
    const timeout = setTimeout(() => {
      forceDirectKill();
      finish();
    }, timeoutMs);

    child.once('exit', finish);

    try {
      Promise.resolve(stopProcessTreeImpl(child.pid)).then(finish, () => {
        forceDirectKill();
        finish();
      });
    } catch {
      forceDirectKill();
      finish();
    }
  });
}

function sleep(ms) {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
}

function readPositiveIntegerEnv(name, fallback) {
  const rawValue = process.env[name];
  if (!rawValue) {
    return fallback;
  }

  const parsedValue = Number.parseInt(rawValue, 10);
  return Number.isFinite(parsedValue) && parsedValue > 0 ? parsedValue : fallback;
}

function createBuildOutputSnapshot(root) {
  const packagesRoot = resolve(root, 'packages');
  const snapshot = {
    fileCount: 0,
    latestMtimeMs: 0,
  };

  const visit = (directory) => {
    let entries;
    try {
      entries = readdirSync(directory, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      const entryPath = resolve(directory, entry.name);
      if (entry.isDirectory()) {
        visit(entryPath);
        continue;
      }

      if (!/\.(?:cjs|js|mjs)$/u.test(entry.name)) {
        continue;
      }

      try {
        const stats = statSync(entryPath);
        snapshot.fileCount += 1;
        snapshot.latestMtimeMs = Math.max(snapshot.latestMtimeMs, stats.mtimeMs);
      } catch {
        // A file can disappear while TypeScript is writing output; the next success event will rescan it.
      }
    }
  };

  let packageEntries;
  try {
    packageEntries = readdirSync(packagesRoot, { withFileTypes: true });
  } catch {
    return snapshot;
  }

  for (const entry of packageEntries) {
    if (entry.isDirectory()) {
      visit(resolve(packagesRoot, entry.name, 'dist'));
    }
  }

  return snapshot;
}

function sameBuildOutputSnapshot(left, right) {
  return left.fileCount === right.fileCount && left.latestMtimeMs === right.latestMtimeMs;
}

function formatErrorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

export function formatDiagnostic(ts, diagnostic, formatHost) {
  if (typeof ts.formatDiagnostic === 'function') {
    return ts.formatDiagnostic(diagnostic, formatHost).trimEnd();
  }

  return flattenDiagnosticMessage(ts, diagnostic.messageText, formatHost.getNewLine());
}

export function flattenDiagnosticMessage(ts, messageText, newLine = '\n') {
  if (typeof ts.flattenDiagnosticMessageText === 'function') {
    return ts.flattenDiagnosticMessageText(messageText, newLine);
  }

  return String(messageText);
}

export function isSuccessfulWatchStatus(ts, diagnostic, newLine = '\n') {
  const message = flattenDiagnosticMessage(ts, diagnostic.messageText, newLine);
  return diagnostic.code === successStatusCode || /^Found 0 errors?\b/i.test(message);
}

export function isFailedWatchStatus(ts, diagnostic, newLine = '\n') {
  const message = flattenDiagnosticMessage(ts, diagnostic.messageText, newLine);
  return diagnostic.code === failedStatusCode || /^Found [1-9][0-9]* errors?\b/i.test(message);
}

export function createTypeScriptSolutionWatch(options) {
  const ts = options.ts;
  const root = options.root ?? defaultRepoRoot;
  const configPath = options.configPath ?? resolve(root, 'tsconfig.json');
  const logger = options.logger ?? console;
  const onSuccessfulBuild = options.onSuccessfulBuild;
  const onFailedBuild = options.onFailedBuild ?? (() => {});
  const onWatcherError = options.onWatcherError ?? ((error) => logger.error(error));
  const formatHost = {
    getCanonicalFileName: (fileName) => fileName,
    getCurrentDirectory: () => root,
    getNewLine: () => '\n',
  };

  const reportDiagnostic = (diagnostic) => {
    logger.error(formatDiagnostic(ts, diagnostic, formatHost));
  };
  const reportSolutionBuilderStatus = (diagnostic) => {
    logger.info(formatDiagnostic(ts, diagnostic, formatHost));
  };
  const reportWatchStatusChanged = (diagnostic, newLine) => {
    const message = flattenDiagnosticMessage(ts, diagnostic.messageText, newLine ?? '\n');
    logger.info(message);

    if (isSuccessfulWatchStatus(ts, diagnostic, newLine)) {
      Promise.resolve().then(onSuccessfulBuild).catch(onWatcherError);
      return;
    }

    if (isFailedWatchStatus(ts, diagnostic, newLine)) {
      onFailedBuild(message);
    }
  };

  const host = ts.createSolutionBuilderWithWatchHost(ts.sys, undefined, reportDiagnostic, reportSolutionBuilderStatus, reportWatchStatusChanged);
  const builder = ts.createSolutionBuilderWithWatch(host, [configPath], {});
  builder.build();

  return {
    close() {
      if (typeof builder.close === 'function') {
        builder.close();
      }
    },
  };
}

function describeExit(label, code, signal) {
  const reason = signal ? `signal ${signal}` : `code ${code ?? 'unknown'}`;
  return `${label} process exited unexpectedly with ${reason}`;
}

export async function runDevWatch(root = defaultRepoRoot, options = {}) {
  const plan = createDevWatchPlan(root);
  const logger = options.logger ?? console;
  const spawnImpl = options.spawnImpl ?? spawn;
  const parentEnv = options.parentEnv ?? process.env;
  const stdio = options.stdio ?? 'inherit';
  const platform = options.platform ?? process.platform;
  const stopProcessTreeImpl = options.stopProcessTree;
  const copyRuntimeAssetsImpl = options.copyRuntimeAssets ?? (() => copyRuntimeAssets(root));
  const backendReadyTimeoutMs =
    options.backendReadyTimeoutMs ?? readPositiveIntegerEnv('NEXTAGENT_BACKEND_READY_TIMEOUT_MS', defaultBackendReadyTimeoutMs);
  const restartDebounceMs = options.restartDebounceMs ?? readPositiveIntegerEnv('NEXTAGENT_DEV_WATCH_RESTART_DEBOUNCE_MS', defaultRestartDebounceMs);
  const waitForBackendReadyImpl =
    options.waitForBackendReady ?? ((proxyTarget) => waitForBackendReady(proxyTarget, { timeoutMs: backendReadyTimeoutMs }));
  const shouldRestartAfterSuccessfulBuild = options.shouldRestartAfterSuccessfulBuild ?? createBuildOutputChangeDetector(root);
  const signalTarget = options.signalTarget ?? process;
  const ts = options.ts ?? (await import('typescript'));
  let frontendProcess;
  let typeScriptWatch;
  let stopping = false;
  const expectedBackendExits = new WeakSet();
  let initialBackendReady = false;
  let backendRestartInFlight = false;
  let backendRestartPending = false;
  let backendRestartTimer;
  let resolveRun;
  let rejectRun;

  const runPromise = new Promise((resolve, reject) => {
    resolveRun = resolve;
    rejectRun = reject;
  });

  const fail = (error) => {
    if (stopping) {
      return;
    }

    stopping = true;
    clearBackendRestartTimer();
    void cleanup().then(() => rejectRun(error), rejectRun);
  };

  const startWatchedProcess = (processPlan) => {
    const child = spawnPlannedProcess(processPlan, {
      spawnImpl,
      parentEnv,
      stdio,
      platform,
    });

    child.on('error', (error) => {
      fail(error);
    });
    child.on('exit', (code, signal) => {
      if (stopping) {
        return;
      }

      if (processPlan.label === 'backend' && expectedBackendExits.has(child)) {
        expectedBackendExits.delete(child);
        return;
      }

      fail(new Error(describeExit(processPlan.label, code, signal)));
    });

    return child;
  };
  const startFrontendIfNeeded = () => {
    if (frontendProcess) {
      return;
    }

    logDevEntryUrls(plan, logger);
    frontendProcess = startWatchedProcess(plan.frontendProcess);
  };

  const backendController = createBackendRestartController({
    startBackend: () => startWatchedProcess(plan.backendProcess),
    stopBackend: async (backendProcess) => {
      expectedBackendExits.add(backendProcess);
      try {
        await stopChildProcess(backendProcess, { platform, stopProcessTree: stopProcessTreeImpl });
      } catch (error) {
        expectedBackendExits.delete(backendProcess);
        throw error;
      }
    },
  });

  const clearBackendRestartTimer = () => {
    if (!backendRestartTimer) {
      return;
    }

    clearTimeout(backendRestartTimer);
    backendRestartTimer = undefined;
  };

  const drainBackendRestarts = async () => {
    if (backendRestartInFlight || stopping) {
      return;
    }

    backendRestartInFlight = true;
    try {
      while (backendRestartPending && !stopping) {
        backendRestartPending = false;

        try {
          await backendController.restart();
          await waitForBackendReadyImpl(plan.proxyTarget);
          initialBackendReady = true;
          startFrontendIfNeeded();
        } catch (error) {
          if (!initialBackendReady) {
            fail(error);
            return;
          }

          logger.error(
            `Backend restart readiness check failed; keeping dev-watch and the frontend alive for the next build. ${formatErrorMessage(error)}`,
          );
        }
      }
    } finally {
      backendRestartInFlight = false;
    }
  };

  const scheduleBackendRestart = () => {
    if (stopping) {
      return;
    }

    backendRestartPending = true;
    clearBackendRestartTimer();
    backendRestartTimer = setTimeout(() => {
      backendRestartTimer = undefined;
      void drainBackendRestarts();
    }, restartDebounceMs);
  };

  const onSuccessfulBuild = () => {
    if (stopping) {
      return;
    }

    if (!shouldRestartAfterSuccessfulBuild()) {
      if (!initialBackendReady) {
        scheduleBackendRestart();
        return;
      }

      logger.info('Backend restart skipped because TypeScript success did not change emitted JavaScript output.');
      return;
    }

    scheduleBackendRestart();
  };

  async function cleanup() {
    clearBackendRestartTimer();

    if (typeScriptWatch) {
      typeScriptWatch.close();
      typeScriptWatch = undefined;
    }

    await backendController.stop();

    if (frontendProcess) {
      const frontendToStop = frontendProcess;
      frontendProcess = undefined;
      await stopChildProcess(frontendToStop, { platform, stopProcessTree: stopProcessTreeImpl });
    }
  }

  const stopFromSignal = () => {
    if (stopping) {
      return;
    }

    stopping = true;
    void cleanup().then(resolveRun, rejectRun);
  };
  signalTarget.once('SIGINT', stopFromSignal);
  signalTarget.once('SIGTERM', stopFromSignal);

  try {
    await copyRuntimeAssetsImpl();
    typeScriptWatch = createTypeScriptSolutionWatch({
      ts,
      root,
      configPath: plan.typeScriptWatch.configPath,
      logger,
      onSuccessfulBuild,
      onFailedBuild: (message) => {
        logger.error(`Backend restart skipped because TypeScript reported errors: ${message}`);
      },
      onWatcherError: fail,
    });
  } catch (error) {
    fail(error);
  }

  return runPromise.finally(() => {
    signalTarget.off('SIGINT', stopFromSignal);
    signalTarget.off('SIGTERM', stopFromSignal);
  });
}

function createBuildOutputChangeDetector(root) {
  let previousSnapshot = createBuildOutputSnapshot(root);

  return () => {
    const nextSnapshot = createBuildOutputSnapshot(root);
    const changed = !sameBuildOutputSnapshot(previousSnapshot, nextSnapshot);
    previousSnapshot = nextSnapshot;
    return changed;
  };
}

function isMain() {
  return process.argv[1] ? resolve(process.argv[1]) === scriptPath : false;
}

if (isMain()) {
  runDevWatch().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
