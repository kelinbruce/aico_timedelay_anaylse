import type {
  BackgroundCapableSandboxPort,
  BackgroundCompletionPayload,
  BackgroundExecutionHandle,
  BackgroundStartResult,
  SandboxExecutionRequest,
  SandboxExecutionResult,
  SandboxFilesystemLayout,
  SandboxFilesystemRoot,
  SandboxGatewayPort,
} from '@nextagent/agent-contracts/gateway';
import { brand, getLogger, isPathInside, type SafeError } from '@nextagent/agent-common';
import {
  accessSync,
  chmodSync,
  closeSync,
  constants,
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  openSync,
  realpathSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { spawn, type ChildProcess } from 'node:child_process';
import { delimiter, dirname, join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';

const utf8Decoder = new TextDecoder('utf-8', { fatal: true });
const shellControlTokens = new Set(['&&', '||', '|', '&', '(', ')', ';']);
const backgroundOutputFileLimitBytes = 10 * 1024 * 1024;
const logger = getLogger({ component: 'agent-platform-gateway-local', source: 'restricted-sandbox' });

function resolveDeniedExecutables(config?: readonly string[]): ReadonlySet<string> {
  return new Set(config ?? []);
}

export interface RestrictedLocalSandboxOptions {
  readonly allowedApis?: readonly string[];
  readonly workspaceDir?: string;
  readonly executableOverrides?: Readonly<Record<string, string>>;
  readonly clipcExecutableDirectory?: string;
  readonly enabled?: boolean;
  readonly allowedExecutables?: readonly string[];
  readonly deniedExecutables?: readonly string[];
}

export interface RestrictedLocalSandboxGatewayPort extends BackgroundCapableSandboxPort {
  executeWithStdoutChunks?: (
    request: SandboxExecutionRequest,
    options: { readonly onStdoutChunk?: (chunk: string) => void | Promise<void> },
    signal?: AbortSignal,
  ) => Promise<SandboxExecutionResult>;
  isExecutionReady?: () => boolean;
}

export function createRestrictedLocalSandboxGateway(options: RestrictedLocalSandboxOptions): RestrictedLocalSandboxGatewayPort {
  return new RestrictedLocalSandboxGateway(options);
}

class RestrictedLocalSandboxGateway implements RestrictedLocalSandboxGatewayPort {
  private readonly allowedApis: readonly URL[];
  private readonly allowedExecutables?: ReadonlySet<string> | undefined;
  private readonly deniedExecutables: ReadonlySet<string>;
  private readonly enabled: boolean;
  /**
   * Live background child processes keyed by taskId. A child is registered on
   * spawn and removed when its completion promise resolves (close/error). Used
   * only to deliver SIGTERM on kill — the store owns task status.
   */
  private readonly backgroundChildren = new Map<string, ChildProcess>();

  constructor(private readonly options: RestrictedLocalSandboxOptions) {
    this.allowedApis = Object.freeze((options.allowedApis ?? []).map((value) => new URL(value)));
    this.allowedExecutables = options.allowedExecutables === undefined ? undefined : new Set(options.allowedExecutables);
    this.deniedExecutables = resolveDeniedExecutables(options.deniedExecutables);
    this.enabled = options.enabled !== false;
    this.registerBackgroundShutdownKill();
  }

  /**
   * Kill every still-running background child when this process exits, so a
   * server crash / Ctrl+C / SIGTERM does not leave orphaned background
   * processes behind. Background children are spawned detached (child.unref),
   * so without this they would outlive the parent.
   *
   * `exit` runs a synchronous SIGKILL sweep. In the real server (not under
   * vitest, which manages signals itself) SIGINT/SIGTERM trigger process.exit
   * so the `exit` sweep actually fires on those signals too. A hard kill -9 /
   * segfault still orphans children (only an OS Job Object could cover that).
   */
  private shutdownKillRegistered = false;
  private registerBackgroundShutdownKill(): void {
    if (this.shutdownKillRegistered) {
      return;
    }
    this.shutdownKillRegistered = true;
    const killAll = (): void => {
      for (const child of this.backgroundChildren.values()) {
        try {
          child.kill('SIGKILL');
        } catch {
          /* already exited */
        }
      }
    };
    process.once('exit', killAll);
    if (process.env.VITEST === 'true') {
      return;
    }
    process.once('SIGINT', () => process.exit(130));
    process.once('SIGTERM', () => process.exit(143));
  }

  async execute(request: SandboxExecutionRequest, signal?: AbortSignal): Promise<SandboxExecutionResult> {
    return this.executeInternal(request, undefined, signal);
  }

  async executeWithStdoutChunks(
    request: SandboxExecutionRequest,
    options: { readonly onStdoutChunk?: (chunk: string) => void | Promise<void> },
    signal?: AbortSignal,
  ): Promise<SandboxExecutionResult> {
    return this.executeInternal(request, options, signal);
  }

  private async executeInternal(
    request: SandboxExecutionRequest,
    options?: { readonly onStdoutChunk?: (chunk: string) => void | Promise<void> },
    signal?: AbortSignal,
  ): Promise<SandboxExecutionResult> {
    const startedAt = Date.now();
    const effectiveRequest = withFallbackFilesystem(request, this.options.workspaceDir);
    try {
      if (signal?.aborted === true) {
        throw signal.reason ?? new DOMException('Aborted', 'AbortError');
      }
      this.validateRequest(effectiveRequest);
      const prepared = this.prepareExecution(effectiveRequest);
      this.validateNetworkAccess(effectiveRequest, prepared.args);
      const { executable, args, pythonModuleRoot, skillRoot } = prepared;
      logger.debug({
        event: 'sandbox.execution.prepared',
        executableKind: request.executable,
        argCount: args.length,
        validationEnabled: this.enabled,
      });
      try {
        assertSignalNotAborted(signal);
        return await executeProcess(
          executable,
          args,
          effectiveRequest,
          effectiveRequest.filesystem.defaultCwd,
          signal,
          startedAt,
          options,
          pythonModuleRoot,
          this.options.clipcExecutableDirectory,
          skillRoot,
        );
      } finally {
        prepared.cleanup();
      }
    } catch (error) {
      const rejection = toRejectedSandboxError(error);
      logger.warn({
        ...(rejection?.unsupportedUrl === undefined ? { err: error } : {}),
        event: rejection === undefined ? 'sandbox.execution.unavailable' : 'sandbox.execution.rejected',
        failureStage: 'SANDBOX_EXECUTION_PREPARE',
        executableKind: request.executable,
        validationEnabled: this.enabled,
        ...(rejection === undefined ? {} : { rejectionReason: rejection.reason }),
        ...(rejection === undefined ? { safeReasonCode: unavailableCode(request.executable) } : {}),
      });
      return {
        executionId: request.executionId,
        stdout: '',
        stderr: '',
        stdoutTruncated: false,
        stderrTruncated: false,
        timedOut: false,
        durationMs: Date.now() - startedAt,
        safeError: {
          code: isAbort(error)
            ? canceledCode(request.executable)
            : rejection === undefined
              ? unavailableCode(request.executable)
              : rejectedCode(request.executable),
          message: isAbort(error)
            ? canceledMessage(request.executable)
            : rejection === undefined
              ? unavailableMessage(request.executable)
              : rejectedMessage(request.executable, rejection.unsupportedUrl),
          category: isAbort(error) ? 'CANCELED' : 'UNAVAILABLE',
          retryable: false,
          ...(rejection === undefined ? {} : { safeDetails: { reason: rejection.reason } }),
        },
      };
    }
  }

  async startBackground(request: SandboxExecutionRequest): Promise<BackgroundStartResult | SafeError> {
    const startedAt = Date.now();
    const effectiveRequest = withFallbackFilesystem(request, this.options.workspaceDir);
    let cleanup: (() => void) | undefined;
    try {
      this.validateRequest(effectiveRequest);
      const prepared = this.prepareExecution(effectiveRequest);
      this.validateNetworkAccess(effectiveRequest, prepared.args);
      cleanup = prepared.cleanup;
      const executionCleanup = prepared.cleanup;
      const { executable, args, pythonModuleRoot, skillRoot } = prepared;
      const workspaceRoot = effectiveRequest.filesystem.roots.find((root) => root.kind === 'workspace' && root.access === 'readWrite');
      if (workspaceRoot === undefined) {
        throw rejectedSandboxError('workspace-root-unavailable');
      }
      const started = startBackgroundProcess(
        executable,
        args,
        effectiveRequest,
        effectiveRequest.filesystem.defaultCwd,
        workspaceRoot.physicalPath,
        request.executionId,
        startedAt,
        pythonModuleRoot,
        this.options.clipcExecutableDirectory,
        skillRoot,
      );
      this.backgroundChildren.set(started.handle.taskId, started.child);
      // Remove the child once the process has exited so kill can no longer
      // target it. Resolves after close/error regardless of outcome.
      started.completion
        .then(() => {
          this.backgroundChildren.delete(started.handle.taskId);
          executionCleanup();
        })
        .catch(() => {
          this.backgroundChildren.delete(started.handle.taskId);
          executionCleanup();
        });
      cleanup = undefined;
      return started;
    } catch (error) {
      cleanup?.();
      const rejection = toRejectedSandboxError(error);
      logger.warn({
        ...(rejection?.unsupportedUrl === undefined ? { err: error } : {}),
        event: rejection === undefined ? 'sandbox.background.unavailable' : 'sandbox.background.rejected',
        failureStage: 'SANDBOX_BACKGROUND_START',
        executableKind: request.executable,
        validationEnabled: this.enabled,
        ...(rejection === undefined ? {} : { rejectionReason: rejection.reason }),
        ...(rejection === undefined ? { safeReasonCode: unavailableCode(request.executable) } : {}),
      });
      return {
        code: rejection === undefined ? unavailableCode(request.executable) : rejectedCode(request.executable),
        message: rejection === undefined ? unavailableMessage(request.executable) : rejectedMessage(request.executable, rejection.unsupportedUrl),
        category: 'UNAVAILABLE',
        retryable: false,
        ...(rejection === undefined ? {} : { safeDetails: { reason: rejection.reason } }),
      };
    }
  }

  isExecutionReady(): boolean {
    // `enabled` controls request validation, not gateway availability.
    return true;
  }

  async killBackground(taskId: string): Promise<{ readonly killed: boolean }> {
    const child = this.backgroundChildren.get(taskId);
    if (child === undefined) {
      return { killed: false };
    }
    // SIGTERM for graceful termination. On POSIX this is a real signal; on
    // Windows Node maps it to TerminateProcess (no signal semantics) — the
    // task still transitions to KILLED via the store, documented as a v1
    // platform limitation.
    try {
      child.kill('SIGTERM');
    } catch (error) {
      logger.warn({ err: error, event: 'sandbox.background.kill_failed', failureStage: 'SANDBOX_BACKGROUND_KILL', taskId });
      return { killed: false };
    }
    logger.debug({ event: 'sandbox.background.killed', taskId });
    return { killed: true };
  }

  private validateRequest(request: SandboxExecutionRequest): void {
    if (this.enabled === false) {
      return;
    }
    if (this.deniedExecutables.has(request.command) || this.allowedExecutables?.has(request.command) === false) {
      throw rejectedSandboxError('denied-executable');
    }
    if (this.allowedExecutables !== undefined && request.executable === 'bash' && requiresShellInterpretation(request.command, request.args)) {
      throw rejectedSandboxError('shell-composition-not-allowed');
    }
  }

  private validateNetworkAccess(request: SandboxExecutionRequest, translatedArgs: readonly string[]): void {
    if (this.enabled === false) {
      return;
    }
    if (request.command === 'curl') {
      validateCurlNetworkTarget(translatedArgs, this.allowedApis);
      return;
    }
    if (request.command !== 'python' && request.command !== 'python3') {
      return;
    }
    const targets = translatedArgs.flatMap(extractHttpUrls);
    const invocation = classifyPythonInvocation(translatedArgs);
    if (invocation === 'script') {
      const script = translatedArgs[0];
      if (script !== undefined && existsSync(script) && statSync(script).isFile()) {
        if (statSync(script).size > 100_000) {
          throw rejectedSandboxError('network-target-not-allowed');
        }
        targets.push(...extractHttpUrls(readFileSync(script, 'utf8')));
      }
    }
    const unsupportedTarget = targets.find((target) => !matchesAllowedApi(target, this.allowedApis));
    if (unsupportedTarget !== undefined) {
      throw networkTargetNotAllowed(unsupportedTarget);
    }
  }

  private prepareExecution(request: SandboxExecutionRequest): PreparedExecution {
    const command = request.command;
    const { args, pythonModuleRoot, skillRoot } = translateExecutablePathArguments(request);
    if (request.executable === 'bash' && requiresShellInterpretation(command, args)) {
      return {
        ...resolveTrustedShellExecution(command, args),
        cleanup: noExecutionCleanup,
        ...(pythonModuleRoot === undefined ? {} : { pythonModuleRoot }),
      };
    }
    return {
      ...this.prepareDirectExecution(request, command, args),
      ...(pythonModuleRoot === undefined ? {} : { pythonModuleRoot }),
      ...(skillRoot === undefined ? {} : { skillRoot }),
    };
  }

  private prepareDirectExecution(request: SandboxExecutionRequest, command: string, args: readonly string[]): PreparedExecution {
    if (command === 'clipc') {
      return { executable: resolveClipcExecutable(this.options.clipcExecutableDirectory), args, cleanup: noExecutionCleanup };
    }
    const override = this.options.executableOverrides?.[command];
    if (override !== undefined) {
      return { executable: override, args, cleanup: noExecutionCleanup };
    }
    if (command === 'python' || command === 'python3') {
      return { ...resolvePythonExecution(command, args), cleanup: noExecutionCleanup };
    }
    if (process.platform !== 'win32') {
      return preparePosixDirectExecution(command, args, request);
    }
    const direct = findDirectExecutable(command);
    if (direct !== undefined) {
      return { executable: direct, args, cleanup: noExecutionCleanup };
    }
    const onPath = findExecutableOnPath(command);
    if (onPath !== undefined) {
      return { executable: onPath, args, cleanup: noExecutionCleanup };
    }
    throw rejectedSandboxError('unsupported-executable');
  }
}

function withFallbackFilesystem(request: SandboxExecutionRequest, workspaceDir?: string): SandboxExecutionRequest {
  if (request.filesystem.roots.length > 0 || workspaceDir === undefined) {
    return request;
  }
  const workspaceRoot = realpathSync(resolve(workspaceDir));
  return {
    ...request,
    filesystem: {
      defaultCwd: workspaceRoot,
      roots: [{ kind: 'workspace', logicalPath: 'workspace', physicalPath: workspaceRoot, access: 'readWrite' }],
    },
  };
}

interface PreparedExecution {
  readonly executable: string;
  readonly args: readonly string[];
  readonly cleanup: () => void;
  readonly pythonModuleRoot?: string;
  readonly skillRoot?: string;
}

function noExecutionCleanup(): void {
  // Most execution paths do not create gateway-owned resources.
}

function preparePosixDirectExecution(command: string, args: readonly string[], request: SandboxExecutionRequest): PreparedExecution {
  if (!/[\\/]/u.test(command)) {
    return { executable: command, args, cleanup: noExecutionCleanup };
  }
  const resolved = pathArgumentMatchesFilesystem(command, request.filesystem);
  if (resolved === undefined) {
    throw rejectedSandboxError('unauthorized-path');
  }
  let source: string;
  try {
    const sourceEntry = lstatSync(resolved.candidatePath);
    if (!sourceEntry.isFile() || sourceEntry.isSymbolicLink()) {
      throw rejectedSandboxError('unauthorized-path');
    }
    const trustedRoot = realpathSync(resolved.candidateRoot);
    source = realpathSync(resolved.candidatePath);
    if (source !== trustedRoot && !isPathInside(trustedRoot, source)) {
      throw rejectedSandboxError('unauthorized-path');
    }
    accessSync(source, constants.R_OK);
  } catch (error) {
    throw sandboxPathFailure(error);
  }
  try {
    accessSync(source, constants.X_OK);
    return { executable: source, args, cleanup: noExecutionCleanup };
  } catch (error) {
    if (!isPermissionError(error)) {
      throw sandboxPathFailure(error);
    }
  }
  const tempRoot = request.filesystem.roots.find((root) => root.kind === 'temp' && root.access === 'readWrite');
  if (tempRoot === undefined) {
    throw rejectedSandboxError('permission-denied');
  }
  const staged = join(tempRoot.physicalPath, `direct-${randomUUID()}`);
  try {
    copyFileSync(source, staged, constants.COPYFILE_EXCL);
    chmodSync(staged, 0o500);
  } catch (error) {
    removeStagedExecutionCopy(staged);
    throw sandboxPathFailure(error);
  }
  return {
    executable: staged,
    args,
    cleanup: () => removeStagedExecutionCopy(staged),
  };
}

function removeStagedExecutionCopy(path: string): void {
  try {
    rmSync(path, { force: true });
  } catch {
    // The existing run-temp lifecycle owns any sandbox copy left after a crash or cleanup failure.
  }
}

function sandboxPathFailure(error: unknown): RejectedSandboxError {
  return error instanceof RejectedSandboxError ? error : rejectedSandboxError(isPermissionError(error) ? 'permission-denied' : 'unauthorized-path');
}

interface TranslatedExecutableArguments {
  readonly args: readonly string[];
  readonly pythonModuleRoot?: string;
  readonly skillRoot?: string;
}

function translateExecutablePathArguments(request: SandboxExecutionRequest): TranslatedExecutableArguments {
  if (request.command === 'python' || request.command === 'python3') {
    const invocation = classifyPythonInvocation(request.args);
    if (invocation === 'module') {
      const pythonModuleRoot = resolvePythonModuleRoot(request.filesystem);
      return { args: request.args, pythonModuleRoot, skillRoot: pythonModuleRoot };
    }
    if (invocation === 'version') {
      return { args: request.args };
    }
    const [script, ...rest] = request.args;
    if (script === undefined) {
      return { args: request.args };
    }
    const resolved = pathArgumentMatchesFilesystem(script, request.filesystem);
    if (resolved === undefined) {
      if (isExecutionRootPathArgument(script) || hasUnsafeScriptPathArgument(script)) {
        throw rejectedSandboxError('unauthorized-path');
      }
      return { args: request.args };
    }
    return {
      args: [resolved.candidatePath, ...rest],
      ...(isSkillProjectionRoot(resolved.root) ? { skillRoot: resolved.root.physicalPath } : {}),
    };
  }
  return {
    args: request.args.map((arg) => {
      if (!isExecutionRootPathArgument(arg)) {
        return arg;
      }
      const resolved = pathArgumentMatchesFilesystem(arg, request.filesystem);
      if (resolved === undefined) {
        throw rejectedSandboxError('unauthorized-path');
      }
      return resolved.candidatePath;
    }),
  };
}

function classifyPythonInvocation(args: readonly string[]): 'script' | 'module' | 'version' {
  const [first, second] = args;
  if (first !== '-m') {
    if (first === '--version' && args.length === 1) {
      return 'version';
    }
    if (first?.startsWith('-') === true) {
      throw rejectedSandboxError('unsupported-python-invocation');
    }
    return 'script';
  }
  if (second === undefined || !isDottedPythonModuleName(second)) {
    throw rejectedSandboxError('unsupported-python-invocation');
  }
  return 'module';
}

function isDottedPythonModuleName(value: string): boolean {
  return /^[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)+$/u.test(value);
}

function resolvePythonModuleRoot(filesystem: SandboxFilesystemLayout): string {
  const roots = filesystem.roots.filter(
    (root) =>
      root.kind === 'systemResources' &&
      root.access === 'read' &&
      /^\.nextagent\/skills\/[^/]+\/[^/]+\/?$/u.test(root.logicalPath.replaceAll('\\', '/')),
  );
  if (roots.length === 0) {
    throw rejectedSandboxError('python-module-root-unavailable');
  }
  if (roots.length > 1) {
    throw rejectedSandboxError('python-module-root-ambiguous');
  }
  return roots[0]!.physicalPath;
}

const fixedSidecarUnixSocket = '/opt/sidecar/ir/http.sock';
const forbiddenCurlLongOptions = [
  '--url',
  '--config',
  '--proxy',
  '--preproxy',
  '--resolve',
  '--connect-to',
  '--request-target',
  '--path-as-is',
  '--location',
  '--location-trusted',
] as const;

function validateCurlNetworkTarget(args: readonly string[], allowedApis: readonly URL[]): void {
  const urlArgs = args.filter((arg) => parseHttpUrl(arg) !== undefined);
  if (urlArgs.length !== 1) {
    throw rejectedSandboxError('network-target-not-allowed');
  }
  const targetValue = urlArgs[0]!;
  const target = parseHttpUrl(targetValue);
  if (
    target === undefined ||
    /[{}\[\]]/u.test(targetValue) ||
    args.some(isForbiddenCurlOption) ||
    !hasAllowedUnixSocketArguments(args.filter((arg) => parseHttpUrl(arg) === undefined))
  ) {
    throw rejectedSandboxError('network-target-not-allowed');
  }
  if (!matchesAllowedApi(target, allowedApis)) {
    throw networkTargetNotAllowed(target);
  }
}

function isForbiddenCurlOption(arg: string): boolean {
  if (forbiddenCurlLongOptions.some((option) => arg === option || arg.startsWith(`${option}=`))) {
    return true;
  }
  if (arg === '--abstract-unix-socket' || arg.startsWith('--abstract-unix-socket=')) {
    return true;
  }
  return arg.startsWith('-') && !arg.startsWith('--') && /[KxL]/u.test(arg.slice(1));
}

function hasAllowedUnixSocketArguments(args: readonly string[]): boolean {
  let socketCount = 0;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]!;
    if (arg === '--unix-socket') {
      socketCount += 1;
      if (args[index + 1] !== fixedSidecarUnixSocket) {
        return false;
      }
      index += 1;
      continue;
    }
    if (arg.startsWith('--unix-socket=')) {
      socketCount += 1;
      if (arg.slice('--unix-socket='.length) !== fixedSidecarUnixSocket) {
        return false;
      }
    }
  }
  return socketCount <= 1;
}

function extractHttpUrls(value: string): URL[] {
  const urls: URL[] = [];
  for (const match of value.matchAll(/https?:\/\/[^\s"'`<>\\]+/giu)) {
    const parsed = parseHttpUrl(match[0]);
    if (parsed !== undefined) {
      urls.push(parsed);
    }
  }
  return urls;
}

function parseHttpUrl(value: string): URL | undefined {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function matchesAllowedApi(target: URL, allowedApis: readonly URL[]): boolean {
  return allowedApis.some(
    (allowed) =>
      target.protocol === allowed.protocol &&
      target.hostname.toLowerCase() === allowed.hostname.toLowerCase() &&
      effectivePort(target) === effectivePort(allowed) &&
      target.pathname.startsWith(allowed.pathname),
  );
}

function effectivePort(url: URL): string {
  if (url.port.length > 0) {
    return url.port;
  }
  return url.protocol === 'https:' ? '443' : '80';
}

function requiresShellInterpretation(command: string, args: readonly string[]): boolean {
  return shellControlTokens.has(command) || args.some((arg) => shellControlTokens.has(arg));
}

function resolveTrustedShellExecution(command: string, args: readonly string[]): { executable: string; args: readonly string[] } {
  const commandLine = buildShellCommandLine(command, args);
  if (process.platform === 'win32') {
    const shell = resolveWindowsCmd();
    return {
      executable: shell,
      args: ['/d', '/s', '/c', commandLine],
    };
  }
  const shell = resolvePosixShell();
  return shell.kind === 'bash' ? { executable: shell.path, args: ['-lc', commandLine] } : { executable: shell.path, args: ['-c', commandLine] };
}

function buildShellCommandLine(command: string, args: readonly string[]): string {
  const tokens = [command, ...args];
  return process.platform === 'win32' ? tokens.map(quoteWindowsShellToken).join(' ') : tokens.map(quotePosixShellToken).join(' ');
}

function quoteWindowsShellToken(token: string): string {
  if (shellControlTokens.has(token)) {
    return token;
  }
  if (/^[A-Za-z0-9_./:\\=~-]+$/u.test(token)) {
    return token;
  }
  return `"${token.replace(/"/gu, '""')}"`;
}

function quotePosixShellToken(token: string): string {
  if (shellControlTokens.has(token)) {
    return token;
  }
  if (/^[A-Za-z0-9_./:=+-]+$/u.test(token)) {
    return token;
  }
  return `'${token.replace(/'/gu, `'\"'\"'`)}'`;
}

function resolveWindowsCmd(): string {
  const comSpec = process.env['ComSpec'];
  if (comSpec !== undefined && existsSync(comSpec)) {
    return comSpec;
  }
  const systemRoot = process.env['SystemRoot'] ?? process.env['WINDIR'] ?? 'C:\\Windows';
  const candidate = join(systemRoot, 'System32', 'cmd.exe');
  if (existsSync(candidate)) {
    return candidate;
  }
  throw new Error('trusted shell unavailable');
}

function resolvePosixShell(): { readonly path: string; readonly kind: 'bash' | 'sh' } {
  for (const candidate of [
    { path: '/bin/bash', kind: 'bash' as const },
    { path: '/usr/bin/bash', kind: 'bash' as const },
    { path: '/bin/sh', kind: 'sh' as const },
    { path: '/usr/bin/sh', kind: 'sh' as const },
  ]) {
    if (existsSync(candidate.path)) {
      return candidate;
    }
  }
  throw new Error('trusted shell unavailable');
}

function gitRootCandidates(): readonly string[] {
  const candidates: string[] = [];
  const resolvedGitRoot = resolveGitInstallationRoot();
  if (resolvedGitRoot !== undefined) {
    candidates.push(resolvedGitRoot);
  }
  const programFiles = process.env['ProgramFiles'];
  if (programFiles !== undefined) {
    candidates.push(join(programFiles, 'Git'));
  } else {
    candidates.push('C:\\Program Files\\Git');
  }
  const localAppData = process.env['LOCALAPPDATA'];
  if (localAppData !== undefined) {
    candidates.push(join(localAppData, 'Programs', 'Git'));
  }
  const gitHome = process.env['GIT_HOME'];
  if (gitHome !== undefined) {
    candidates.push(gitHome);
  }
  return candidates;
}

function resolveGitInstallationRoot(): string | undefined {
  const gitExe = findExecutableOnPath('git');
  if (gitExe === undefined) {
    return undefined;
  }
  let dir = resolve(gitExe, '..');
  for (let depth = 0; depth < 3; depth++) {
    if (existsSync(join(dir, 'usr', 'bin'))) {
      return dir;
    }
    dir = resolve(dir, '..');
  }
  return undefined;
}

function findDirectExecutable(command: string): string | undefined {
  for (const root of gitRootCandidates()) {
    for (const sub of ['usr\\bin', 'bin', 'mingw64\\bin']) {
      const exe = join(root, sub, `${command}.exe`);
      if (existsSync(exe)) {
        return exe;
      }
    }
  }
  return undefined;
}

function resolveClipcExecutable(directory?: string): string {
  const normalizedDirectory = normalizeTrustedDirectory(directory);
  const directoryRoot = realpathSync(resolve(normalizedDirectory));
  const candidate = join(directoryRoot, process.platform === 'win32' ? 'clipc.exe' : 'clipc');
  if (!existsSync(candidate)) {
    throw new Error('unsupported executable');
  }
  const executable = realpathSync(candidate);
  if (!isPathInside(directoryRoot, executable) || !statSync(executable).isFile()) {
    throw new Error('unsupported executable');
  }
  return executable;
}

function normalizeTrustedDirectory(directory?: string): string {
  if (directory === undefined) {
    throw new Error('unsupported executable');
  }
  const trimmed = directory.trim();
  if (trimmed.length === 0) {
    throw new Error('unsupported executable');
  }
  if (trimmed.startsWith('"') && trimmed.endsWith('"') && trimmed.length > 1) {
    const unquoted = trimmed.slice(1, -1);
    if (unquoted.length === 0 || unquoted.includes('"')) {
      throw new Error('unsupported executable');
    }
    return unquoted;
  }
  if (trimmed.includes('"')) {
    throw new Error('unsupported executable');
  }
  return trimmed;
}

function resolvePythonExecution(command: 'python' | 'python3', args: readonly string[]): { executable: string; args: readonly string[] } {
  if (process.platform !== 'win32') {
    return { executable: command, args };
  }
  const direct = findExecutableOnPath(command, { skipWindowsApps: true });
  if (direct !== undefined) {
    return { executable: direct, args };
  }
  const launcher = findPyLauncher();
  if (launcher !== undefined) {
    return command === 'python3' ? { executable: launcher, args: ['-3', ...args] } : { executable: launcher, args };
  }
  return { executable: command, args };
}

function executeProcess(
  executable: string,
  args: readonly string[],
  request: SandboxExecutionRequest,
  cwd: string,
  signal: AbortSignal | undefined,
  startedAt: number,
  options?: { readonly onStdoutChunk?: (chunk: string) => void | Promise<void> },
  pythonModuleRoot?: string,
  clipcExecutableDirectory?: string,
  skillRoot?: string,
): Promise<SandboxExecutionResult> {
  return new Promise((resolveResult, reject) => {
    const child = spawn(executable, [...args], {
      cwd,
      env: sanitizedEnvironment(request, pythonModuleRoot, clipcExecutableDirectory, skillRoot),
      shell: false,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout: Buffer<ArrayBufferLike> = Buffer.alloc(0);
    let stderr: Buffer<ArrayBufferLike> = Buffer.alloc(0);
    let stdoutTruncated = false;
    let stderrTruncated = false;
    let timedOut = false;
    let chunkCallbacks = Promise.resolve();
    let chunkCallbackError: unknown;
    const append = (
      current: Buffer<ArrayBufferLike>,
      chunk: Buffer<ArrayBufferLike>,
      limit: number,
    ): { value: Buffer<ArrayBufferLike>; truncated: boolean } => {
      const combined = Buffer.concat([current, chunk]);
      return combined.length <= limit ? { value: combined, truncated: false } : { value: truncateUtf8(combined, limit), truncated: true };
    };
    child.stdout.on('data', (chunk: Buffer) => {
      const next = append(stdout, chunk, request.stdoutLimitBytes);
      stdout = next.value;
      stdoutTruncated ||= next.truncated;
      if (options?.onStdoutChunk !== undefined && chunkCallbackError === undefined) {
        const text = chunk.toString('utf8');
        chunkCallbacks = chunkCallbacks
          .then(async () => {
            await options.onStdoutChunk?.(text);
          })
          .catch((error: unknown) => {
            chunkCallbackError = error;
            child.kill();
          });
      }
    });
    child.stderr.on('data', (chunk: Buffer) => {
      const next = append(stderr, chunk, request.stderrLimitBytes);
      stderr = next.value;
      stderrTruncated ||= next.truncated;
    });
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, request.timeoutMs);
    timer.unref();
    const abort = () => {
      child.kill();
      reject(signal?.reason ?? new Error('aborted'));
    };
    signal?.addEventListener('abort', abort, { once: true });
    child.once('error', (error) => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      reject(error);
    });
    child.once('close', (code) => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      void chunkCallbacks.then(() => {
        if (chunkCallbackError !== undefined) {
          reject(chunkCallbackError);
          return;
        }
        resolveResult({
          executionId: request.executionId,
          exitCode: code ?? -1,
          stdout: projectSandboxOutputText(stdout.toString('utf8'), request),
          stderr: projectSandboxOutputText(stderr.toString('utf8'), request),
          stdoutTruncated,
          stderrTruncated,
          timedOut,
          durationMs: Date.now() - startedAt,
        });
      });
    });
  });
}

function startBackgroundProcess(
  executable: string,
  args: readonly string[],
  request: SandboxExecutionRequest,
  cwd: string,
  workspaceRoot: string,
  taskId: string,
  startedAt: number,
  pythonModuleRoot?: string,
  clipcExecutableDirectory?: string,
  skillRoot?: string,
): BackgroundStartResult & { readonly child: ChildProcess } {
  const toolResultsDir = join(workspaceRoot, 'tool-results');
  mkdirSync(toolResultsDir, { recursive: true });
  const stdoutRelPath = `tool-results/${taskId}.stdout.txt`;
  const stderrRelPath = `tool-results/${taskId}.stderr.txt`;
  const stdoutFd = openSync(join(workspaceRoot, stdoutRelPath), 'w');
  const stderrFd = openSync(join(workspaceRoot, stderrRelPath), 'w');
  const child = spawn(executable, [...args], {
    cwd,
    env: sanitizedEnvironment(request, pythonModuleRoot, clipcExecutableDirectory, skillRoot),
    shell: false,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.unref();
  const unrefPipe = (pipe: NodeJS.ReadableStream | null): void => {
    (pipe as (NodeJS.ReadableStream & { unref?: () => void }) | null)?.unref?.();
  };
  unrefPipe(child.stdout);
  unrefPipe(child.stderr);
  let outputFailure:
    | { readonly kind: 'limit-exceeded'; readonly outputChannel: 'stdout' | 'stderr' }
    | { readonly kind: 'write-failed'; readonly outputChannel: 'stdout' | 'stderr'; readonly rawExceptionData: unknown }
    | undefined;
  let stdoutBytesWritten = 0;
  let stderrBytesWritten = 0;
  const terminateForOutputFailure = (
    failure:
      | { readonly kind: 'limit-exceeded'; readonly outputChannel: 'stdout' | 'stderr' }
      | { readonly kind: 'write-failed'; readonly outputChannel: 'stdout' | 'stderr'; readonly rawExceptionData: unknown },
  ): void => {
    if (outputFailure !== undefined) {
      return;
    }
    outputFailure = failure;
    child.kill();
    child.stdout?.destroy();
    child.stderr?.destroy();
  };
  const writeBoundedOutput = (outputChannel: 'stdout' | 'stderr', fd: number, value: Buffer): void => {
    if (outputFailure !== undefined) {
      return;
    }
    const bytesWritten = outputChannel === 'stdout' ? stdoutBytesWritten : stderrBytesWritten;
    const remainingBytes = backgroundOutputFileLimitBytes - bytesWritten;
    const acceptedBytes = Math.min(remainingBytes, value.byteLength);
    if (acceptedBytes > 0) {
      try {
        writeFileSync(fd, value.subarray(0, acceptedBytes));
      } catch (error) {
        terminateForOutputFailure({ kind: 'write-failed', outputChannel, rawExceptionData: error });
        return;
      }
      if (outputChannel === 'stdout') {
        stdoutBytesWritten += acceptedBytes;
      } else {
        stderrBytesWritten += acceptedBytes;
      }
    }
    if (acceptedBytes < value.byteLength) {
      terminateForOutputFailure({ kind: 'limit-exceeded', outputChannel });
    }
  };
  child.stdout?.on('data', (chunk: Buffer) => writeBoundedOutput('stdout', stdoutFd, chunk));
  child.stderr?.on('data', (chunk: Buffer) => writeBoundedOutput('stderr', stderrFd, chunk));
  const closeFds = (): void => {
    try {
      closeSync(stdoutFd);
    } catch {
      /* fd may already be closed */
    }
    try {
      closeSync(stderrFd);
    } catch {
      /* fd may already be closed */
    }
  };
  const completion = new Promise<BackgroundCompletionPayload>((resolve) => {
    let settled = false;
    const finish = (exitCode: number, status: BackgroundCompletionPayload['status']): void => {
      if (settled) {
        return;
      }
      settled = true;
      closeFds();
      if (outputFailure?.kind === 'limit-exceeded') {
        logger.warn({
          event: 'sandbox.background.output_limit_exceeded',
          executableKind: request.executable,
          outputChannel: outputFailure.outputChannel,
          limitBytes: backgroundOutputFileLimitBytes,
          failureStage: 'SANDBOX_BACKGROUND_OUTPUT',
        });
      } else if (outputFailure?.kind === 'write-failed') {
        logger.warn({
          event: 'sandbox.background.output_write_failed',
          executableKind: request.executable,
          outputChannel: outputFailure.outputChannel,
          failureStage: 'SANDBOX_BACKGROUND_OUTPUT',
          rawExceptionData: outputFailure.rawExceptionData,
        });
      }
      resolve({ taskId, exitCode, status, finishedAt: brand<number, 'EpochMillis'>(Date.now()) });
    };
    child.once('error', () => {
      if (outputFailure === undefined) {
        logger.warn({
          event: 'sandbox.background.spawn_error',
          executableKind: request.executable,
        });
      }
      finish(-1, 'FAILED');
    });
    child.once('close', (code) => {
      if (outputFailure !== undefined) {
        finish(-1, 'FAILED');
        return;
      }
      const exitCode = code ?? -1;
      finish(exitCode, exitCode === 0 ? 'COMPLETED' : 'FAILED');
    });
  });
  logger.debug({
    event: 'sandbox.background.started',
    executableKind: request.executable,
    commandName: request.command,
    resolvedExecutable: executable,
    argCount: args.length,
  });
  return {
    handle: {
      taskId,
      status: 'RUNNING',
      stdoutRef: stdoutRelPath,
      stderrRef: stderrRelPath,
      startedAt: brand<number, 'EpochMillis'>(startedAt),
    },
    completion,
    child,
  };
}

function sanitizedEnvironment(
  request: SandboxExecutionRequest,
  pythonModuleRoot?: string,
  clipcExecutableDirectory?: string,
  skillRoot?: string,
): NodeJS.ProcessEnv {
  const path = process.env['PATH'];
  const systemRoot = process.env['SystemRoot'];
  const hostPythonPath = process.env['PYTHONPATH'];
  const isSkillPythonRequest = (request.command === 'python' || request.command === 'python3') && skillRoot !== undefined;
  const workspaceRoot = request.filesystem.roots.find((root) => root.kind === 'workspace' && root.access === 'readWrite');
  const tempRoot = request.filesystem.roots.find((root) => root.kind === 'temp' && root.access === 'readWrite');
  const pythonPathEnvironment = resolvePythonPathEnvironment(request, pythonModuleRoot, hostPythonPath);
  const env: NodeJS.ProcessEnv = {
    ...(path === undefined ? {} : { PATH: path }),
    ...(systemRoot === undefined ? {} : { SystemRoot: systemRoot }),
    ...(pythonPathEnvironment === undefined ? {} : { PYTHONPATH: pythonPathEnvironment }),
    LANG: 'C.UTF-8',
    // Windows: force UTF-8 output for subprocesses (Python, Node, etc.)
    // that respect these encoding environment variables.
    PYTHONIOENCODING: 'utf-8',
    PYTHONUTF8: '1',
    ...(!isSkillPythonRequest || workspaceRoot === undefined ? {} : { NEXTAGENT_WORKSPACE_DIR: workspaceRoot.physicalPath }),
    ...(!isSkillPythonRequest || tempRoot === undefined ? {} : { NEXTAGENT_TEMP_DIR: tempRoot.physicalPath }),
    ...(isSkillPythonRequest ? { NEXTAGENT_SKILL_ROOT: skillRoot } : {}),
  };
  const attachmentPaths = request.environment['FILE_PATHS'];
  if (typeof attachmentPaths === 'string') {
    env.FILE_PATHS = attachmentPaths;
  }
  if (tempRoot !== undefined) {
    const tempPath = sandboxTempPath(request, tempRoot);
    env.TMPDIR = tempPath;
    env.TMP = tempPath;
    env.TEMP = tempPath;
  }
  if (process.platform === 'win32' && path !== undefined) {
    const gitBinPaths = collectGitBinPaths();
    if (gitBinPaths.length > 0) {
      env.PATH = `${gitBinPaths.join(';')};${path}`;
    }
  }
  if (request.command === 'clipc' && clipcExecutableDirectory !== undefined) {
    env.CLIP_HOME = clipcExecutableDirectory;
  }
  return env;
}

function resolvePythonPathEnvironment(request: SandboxExecutionRequest, pythonModuleRoot?: string, hostPythonPath?: string): string | undefined {
  if (pythonModuleRoot !== undefined) {
    return pythonModuleRoot;
  }
  return resolveRequestedPythonPath(request) ?? hostPythonPath;
}

function resolveRequestedPythonPath(request: SandboxExecutionRequest): string | undefined {
  const value = request.environment['PYTHONPATH'];
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== 'string' || value.length === 0 || value.includes(';') || value.includes(':') || hasUnsafeScriptPathArgument(value)) {
    throw rejectedSandboxError('unauthorized-path');
  }
  const resolved = pathArgumentMatchesFilesystem(value, request.filesystem);
  if (resolved === undefined) {
    throw rejectedSandboxError('unauthorized-path');
  }
  return resolved.candidatePath;
}

function projectSandboxOutputText(text: string, request: SandboxExecutionRequest): string {
  if (text.length === 0) {
    return text;
  }
  const mappings = outputPathMappings(request);
  return mappings.reduce((projected, mapping) => replacePhysicalPath(projected, mapping, request), text);
}

function outputPathMappings(
  request: SandboxExecutionRequest,
): ReadonlyArray<{ readonly physicalPath: string; readonly logicalPath: string; readonly copyToTemp: boolean }> {
  const rootMappings = request.filesystem.roots.map((root) => ({
    physicalPath: resolve(root.physicalPath),
    logicalPath: normalizeLogicalPath(root.logicalPath),
    copyToTemp: false,
  }));
  const tempRoot = request.filesystem.roots.find((root) => root.kind === 'temp' && root.access === 'readWrite');
  const cwdMapping =
    tempRoot === undefined
      ? []
      : [
          {
            physicalPath: resolve(request.filesystem.defaultCwd),
            logicalPath: normalizeLogicalPath(tempRoot.logicalPath),
            copyToTemp: true,
          },
        ];
  return [...rootMappings, ...cwdMapping]
    .filter((mapping) => mapping.physicalPath.length > 0 && mapping.logicalPath.length > 0)
    .sort((left, right) => right.physicalPath.length - left.physicalPath.length);
}

function replacePhysicalPath(
  text: string,
  mapping: { readonly physicalPath: string; readonly logicalPath: string; readonly copyToTemp: boolean },
  request: SandboxExecutionRequest,
): string {
  let projected = text;
  for (const variant of physicalPathVariants(mapping.physicalPath)) {
    const escaped = escapeRegExp(variant).replace(/[\\\/]+/gu, '[\\\\/]+');
    const pattern = new RegExp(`${escaped}(?=$|[\\\\/\\s"'<>),;:\\]\\}])([\\\\/][^\\s"'<>),;\\]\\}]*)?`, 'giu');
    projected = projected.replace(pattern, (matched: string, suffixValue?: string) => {
      const suffix = normalizeOutputSuffix(suffixValue ?? '');
      if (mapping.copyToTemp && suffix.length > 0) {
        materializeDefaultCwdOutput(request, mapping.physicalPath, suffix);
      }
      return suffix.length === 0 ? mapping.logicalPath : `${mapping.logicalPath}/${suffix}`;
    });
  }
  return projected;
}

function materializeDefaultCwdOutput(request: SandboxExecutionRequest, cwd: string, relativePath: string): void {
  const tempRoot = request.filesystem.roots.find((root) => root.kind === 'temp' && root.access === 'readWrite');
  if (tempRoot === undefined || relativePath.length === 0 || relativePath.startsWith('../') || relativePath.includes('/../')) {
    return;
  }
  const source = resolve(cwd, relativePath);
  const target = resolve(tempRoot.physicalPath, relativePath);
  if (!isPathInside(resolve(cwd), source) || !isPathInside(resolve(tempRoot.physicalPath), target)) {
    return;
  }
  try {
    const sourceStat = lstatSync(source);
    if (!sourceStat.isFile() || sourceStat.nlink > 1) {
      return;
    }
    mkdirSync(dirname(target), { recursive: true });
    copyFileSync(source, target);
  } catch {
    return;
  }
}

function normalizeOutputSuffix(value: string): string {
  return value.replace(/^[\\/]+/u, '').replaceAll('\\', '/');
}

function physicalPathVariants(physicalPath: string): readonly string[] {
  const resolved = resolve(physicalPath);
  const normalized = resolved.replaceAll('\\', '/');
  return [...new Set([resolved, normalized])].sort((left, right) => right.length - left.length);
}

function normalizeLogicalPath(value: string): string {
  return value.replaceAll('\\', '/').replace(/\/+$/u, '');
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

function sandboxTempPath(request: SandboxExecutionRequest, tempRoot: SandboxExecutionRequest['filesystem']['roots'][number]): string {
  if (request.filesystem.defaultCwd === '/work') {
    return `/work/${tempRoot.logicalPath.replace(/^\/+|\/+$/gu, '')}`;
  }
  return tempRoot.physicalPath;
}

function collectGitBinPaths(): readonly string[] {
  const paths: string[] = [];
  for (const root of gitRootCandidates()) {
    for (const sub of ['usr\\bin', 'mingw64\\bin']) {
      const candidate = join(root, sub);
      if (existsSync(candidate)) {
        paths.push(candidate);
      }
    }
  }
  return paths;
}

function findExecutableOnPath(command: string, options: { readonly skipWindowsApps?: boolean } = {}): string | undefined {
  const pathValue = process.env['PATH'];
  if (pathValue === undefined) {
    return undefined;
  }
  const executableName = process.platform === 'win32' ? `${command}.exe` : command;
  for (const dir of pathValue.split(delimiter)) {
    if (dir.length === 0) {
      continue;
    }
    const candidate = join(dir, executableName);
    if (options.skipWindowsApps === true && candidate.toLowerCase().includes('\\microsoft\\windowsapps\\')) {
      continue;
    }
    if (existsSync(candidate)) {
      return candidate;
    }
  }
  return undefined;
}

function findPyLauncher(): string | undefined {
  const windir = process.env['WINDIR'] ?? 'C:\\Windows';
  const launcher = join(windir, 'py.exe');
  return existsSync(launcher) ? launcher : undefined;
}

function unavailableCode(executable: 'bash' | 'python'): string {
  return executable === 'python' ? 'PYTHON_EXECUTION_UNAVAILABLE' : 'BASH_EXECUTION_UNAVAILABLE';
}

function canceledCode(executable: 'bash' | 'python'): string {
  return executable === 'python' ? 'PYTHON_EXECUTION_CANCELED' : 'BASH_EXECUTION_CANCELED';
}

function rejectedCode(executable: 'bash' | 'python'): string {
  return executable === 'python' ? 'PYTHON_EXECUTION_REJECTED' : 'BASH_EXECUTION_REJECTED';
}

function unavailableMessage(executable: 'bash' | 'python'): string {
  return executable === 'python' ? 'Python execution is unavailable.' : 'Bash execution is unavailable.';
}

function rejectedMessage(executable: 'bash' | 'python', unsupportedUrl?: string): string {
  const base = executable === 'python' ? 'Python execution request was rejected.' : 'Bash execution request was rejected.';
  return unsupportedUrl === undefined ? base : `${base} Unsupported URL: ${unsupportedUrl}`;
}

function canceledMessage(executable: 'bash' | 'python'): string {
  return executable === 'python' ? 'Python execution was canceled.' : 'Bash execution was canceled.';
}

type RejectedSandboxReason =
  | 'denied-executable'
  | 'network-target-not-allowed'
  | 'shell-composition-not-allowed'
  | 'unsupported-executable'
  | 'workspace-root-unavailable'
  | 'unauthorized-path'
  | 'permission-denied'
  | 'unsupported-python-invocation'
  | 'python-module-root-unavailable'
  | 'python-module-root-ambiguous';

class RejectedSandboxError extends Error {
  constructor(
    readonly reason: RejectedSandboxReason,
    readonly unsupportedUrl?: string,
  ) {
    super(reason);
    this.name = 'RejectedSandboxError';
  }
}

function rejectedSandboxError(reason: RejectedSandboxReason): RejectedSandboxError {
  return new RejectedSandboxError(reason);
}

function networkTargetNotAllowed(target: URL): RejectedSandboxError {
  const safeTarget = new URL(target.href);
  safeTarget.username = '';
  safeTarget.password = '';
  safeTarget.search = '';
  safeTarget.hash = '';
  return new RejectedSandboxError('network-target-not-allowed', safeTarget.href);
}

function toRejectedSandboxError(error: unknown): RejectedSandboxError | undefined {
  if (error instanceof RejectedSandboxError) {
    return error;
  }
  return isPermissionError(error) ? rejectedSandboxError('permission-denied') : undefined;
}

function isPermissionError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null || !('code' in error)) {
    return false;
  }
  const code = (error as { readonly code?: unknown }).code;
  return code === 'EACCES' || code === 'EPERM';
}

function truncateUtf8(buffer: Buffer<ArrayBufferLike>, limit: number): Buffer<ArrayBufferLike> {
  for (let end = limit; end >= 0; end -= 1) {
    const slice = buffer.subarray(0, end);
    try {
      utf8Decoder.decode(slice);
      return slice;
    } catch {
      continue;
    }
  }
  return Buffer.alloc(0);
}

interface ResolvedPathMatch {
  readonly candidateRoot: string;
  readonly candidatePath: string;
  readonly root: SandboxFilesystemRoot;
}

/**
 * Resolve `pathArgument` against the first trusted root in which it lives.
 * Root-qualified paths use the matching logical root, then unqualified paths
 * fall back to the workspace root. Returns undefined when no root accepts the
 * candidate (which means the path is unsafe).
 */
function pathArgumentMatchesFilesystem(pathArgument: string, filesystem: SandboxFilesystemLayout): ResolvedPathMatch | undefined {
  const normalized = pathArgument.replaceAll('\\', '/').replace(/^\/work\//u, '');
  if (normalized.length === 0 || /^[A-Za-z]:/u.test(normalized) || normalized.startsWith('/') || normalized.includes('..')) {
    return undefined;
  }
  if (normalized === '.') {
    const workspace = filesystem.roots.find((root) => root.kind === 'workspace');
    return workspace === undefined ? undefined : { candidateRoot: workspace.physicalPath, candidatePath: workspace.physicalPath, root: workspace };
  }
  for (const root of filesystem.roots) {
    const logical = root.logicalPath.replaceAll('\\', '/').replace(/\/$/u, '');
    if (normalized !== logical && !normalized.startsWith(`${logical}/`)) {
      continue;
    }
    const suffix = normalized === logical ? '' : normalized.slice(logical.length + 1);
    const candidate = resolve(root.physicalPath, suffix);
    if (!isPathInside(root.physicalPath, candidate) && candidate !== root.physicalPath) {
      continue;
    }
    return { candidateRoot: root.physicalPath, candidatePath: candidate, root };
  }
  if (isExecutionRootPathArgument(normalized)) {
    return undefined;
  }
  const workspace = filesystem.roots.find((root) => root.kind === 'workspace');
  if (workspace === undefined) {
    return undefined;
  }
  const candidate = resolve(workspace.physicalPath, normalized);
  if (!isPathInside(workspace.physicalPath, candidate) && candidate !== workspace.physicalPath) {
    return undefined;
  }
  return { candidateRoot: workspace.physicalPath, candidatePath: candidate, root: workspace };
}

function isSkillProjectionRoot(root: SandboxFilesystemRoot): boolean {
  return (
    root.kind === 'systemResources' &&
    root.access === 'read' &&
    /^\.nextagent\/skills\/[^/]+\/[^/]+\/?$/u.test(root.logicalPath.replaceAll('\\', '/'))
  );
}

function isExecutionRootPathArgument(pathArgument: string): boolean {
  const normalized = pathArgument.replaceAll('\\', '/').replace(/^\/work\//u, '');
  return (
    normalized === 'workspace' ||
    normalized.startsWith('workspace/') ||
    normalized === '.nextagent' ||
    normalized.startsWith('.nextagent/') ||
    normalized === 'temp' ||
    normalized.startsWith('temp/') ||
    normalized === 'generated-skills' ||
    normalized.startsWith('generated-skills/') ||
    normalized === 'shared-data' ||
    normalized.startsWith('shared-data/')
  );
}

function hasUnsafeScriptPathArgument(pathArgument: string): boolean {
  const normalized = pathArgument.replaceAll('\\', '/').replace(/^\/work\//u, '');
  return normalized.length === 0 || /^[A-Za-z]:/u.test(normalized) || normalized.startsWith('/') || normalized.includes('..');
}

function isAbort(error: unknown): boolean {
  return error instanceof Error && (error.name === 'AbortError' || error.message === 'aborted');
}

function assertSignalNotAborted(signal?: AbortSignal): void {
  if (signal?.aborted === true) {
    throw signal.reason ?? new DOMException('Aborted', 'AbortError');
  }
}
