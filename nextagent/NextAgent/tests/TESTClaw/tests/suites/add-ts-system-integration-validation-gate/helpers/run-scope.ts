import type { ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import type { Server } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';

export interface SystemIntegrationRunScope {
  readonly runId: string;
  readonly tempRoot: string;
  readonly persistenceRoot: string;
  readonly skillRoot: string;
  readonly browserStateRoot: string;
  readonly restrictedDiagnosticRoot: string;
  readonly evidenceRoot: string;
  readonly listenOnRandomPort: (server: Server) => Promise<number>;
  readonly registerChild: (child: ChildProcess) => void;
  readonly toEvidenceRef: (absolutePath: string) => string;
  readonly cleanup: () => Promise<void>;
}

export async function withRunScope<T>(
  input: {
    readonly outputBase?: string;
    readonly tempBase?: string;
  },
  action: (scope: SystemIntegrationRunScope) => Promise<T>,
): Promise<T> {
  const scope = await createRunScope(input);
  try {
    return await action(scope);
  } finally {
    await scope.cleanup();
  }
}

export async function createRunScope(
  input: {
    readonly outputBase?: string;
    readonly tempBase?: string;
  } = {},
): Promise<SystemIntegrationRunScope> {
  const runId = randomUUID();
  const tempBase = path.resolve(input.tempBase ?? tmpdir());
  const outputBase = path.resolve(input.outputBase ?? path.join(process.cwd(), 'test-output', 'system-integration'));
  await Promise.all([mkdir(tempBase, { recursive: true }), mkdir(outputBase, { recursive: true })]);

  const tempRoot = await mkdtemp(path.join(tempBase, `testclaw-system-integration-${runId}-`));
  const persistenceRoot = path.join(tempRoot, 'persistence');
  const skillRoot = path.join(tempRoot, 'skills');
  const browserStateRoot = path.join(tempRoot, 'browser-state');
  const restrictedDiagnosticRoot = path.join(tempRoot, 'restricted-diagnostics');
  const evidenceRoot = path.join(outputBase, runId);
  await Promise.all([
    mkdir(persistenceRoot, { recursive: true }),
    mkdir(skillRoot, { recursive: true }),
    mkdir(browserStateRoot, { recursive: true }),
    mkdir(restrictedDiagnosticRoot, { recursive: true }),
    mkdir(evidenceRoot, { recursive: true }),
  ]);

  const servers = new Set<Server>();
  const children = new Set<ChildProcess>();
  let cleanupPromise: Promise<void> | undefined;

  const cleanup = (): Promise<void> => {
    cleanupPromise ??= cleanupResources(servers, children, tempRoot);
    return cleanupPromise;
  };

  return Object.freeze({
    runId,
    tempRoot,
    persistenceRoot,
    skillRoot,
    browserStateRoot,
    restrictedDiagnosticRoot,
    evidenceRoot,
    async listenOnRandomPort(server: Server): Promise<number> {
      const port = await listen(server);
      servers.add(server);
      return port;
    },
    registerChild(child: ChildProcess): void {
      children.add(child);
    },
    toEvidenceRef(absolutePath: string): string {
      const relative = path.relative(evidenceRoot, path.resolve(absolutePath));
      if (relative.length === 0 || relative.startsWith('..') || path.isAbsolute(relative)) {
        throw new Error('evidence path is outside the evidence root');
      }
      return relative.split(path.sep).join('/');
    },
    cleanup,
  });
}

async function listen(server: Server): Promise<number> {
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
      resolve();
    });
  });
  const address = server.address();
  if (address === null || typeof address === 'string') {
    await closeServer(server);
    throw new Error('random TCP listener did not expose a numeric port');
  }
  return address.port;
}

async function cleanupResources(servers: ReadonlySet<Server>, children: ReadonlySet<ChildProcess>, tempRoot: string): Promise<void> {
  const results = await Promise.allSettled([
    ...Array.from(servers, (server) => closeServer(server)),
    ...Array.from(children, (child) => terminateChild(child)),
  ]);
  await rm(tempRoot, { recursive: true, force: true });
  const failures = results.filter((result): result is PromiseRejectedResult => result.status === 'rejected').map((result) => result.reason);
  if (failures.length > 0) {
    throw new AggregateError(failures, 'failed to clean all run resources');
  }
}

async function closeServer(server: Server): Promise<void> {
  if (!server.listening) {
    return;
  }
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

async function terminateChild(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) {
    return;
  }

  const exited = new Promise<void>((resolve) => child.once('exit', () => resolve()));
  child.kill();
  if (await settlesWithin(exited, 2_000)) {
    return;
  }
  child.kill('SIGKILL');
  if (!(await settlesWithin(exited, 2_000))) {
    throw new Error(`child process ${child.pid ?? 'unknown'} did not terminate`);
  }
}

async function settlesWithin(promise: Promise<void>, timeoutMs: number): Promise<boolean> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise.then(() => true),
      new Promise<false>((resolve) => {
        timer = setTimeout(() => resolve(false), timeoutMs);
        timer.unref();
      }),
    ]);
  } finally {
    if (timer !== undefined) {
      clearTimeout(timer);
    }
  }
}
