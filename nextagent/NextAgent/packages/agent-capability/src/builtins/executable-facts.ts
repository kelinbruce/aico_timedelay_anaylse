import { AgentError, SECRET_KEYWORD_PATTERN, type JsonObject } from '@nextagent/agent-common';

export type SupportedPlatform = 'WINDOWS' | 'LINUX' | 'ALL';

export interface PlatformAdaptedExecutableFacts {
  readonly executable: 'bash' | 'python';
  readonly command: string;
  readonly args: readonly string[];
  readonly workingDirectoryRef?: string;
  readonly environment: JsonObject;
}

export interface BuiltinExecutableFactsInput {
  readonly platform: SupportedPlatform;
  readonly executable: 'bash' | 'python';
  readonly command: string;
  readonly args: readonly string[];
  readonly workingDirectoryRef?: string;
  readonly allowedWorkingDirectoryRefs?: readonly string[];
  readonly environment?: JsonObject;
  readonly environmentAllowlist?: readonly string[];
  readonly controlledInterpreters?: Readonly<Partial<Record<'bash' | 'python', string>>>;
}

export function detectSupportedPlatform(platform: NodeJS.Platform = process.platform): SupportedPlatform {
  if (platform === 'win32') {
    return 'WINDOWS';
  }
  if (platform === 'linux') {
    return 'LINUX';
  }
  return 'ALL';
}

export function prepareBuiltinExecutableFacts(input: BuiltinExecutableFactsInput): PlatformAdaptedExecutableFacts {
  if (!['WINDOWS', 'LINUX'].includes(input.platform)) {
    throw safeFailure('PLATFORM_UNSUPPORTED', 'Builtin executable platform is unsupported.', 'unsupported-platform');
  }
  if (input.executable === 'python' && input.controlledInterpreters?.python === undefined) {
    throw safeFailure('INTERPRETER_UNAVAILABLE', 'Python interpreter is not configured.', 'interpreter-missing');
  }
  if (input.executable === 'bash' && input.platform === 'WINDOWS' && input.command === 'bash' && input.controlledInterpreters?.bash === undefined) {
    throw safeFailure('INTERPRETER_UNAVAILABLE', 'Bash interpreter is not configured.', 'interpreter-missing');
  }
  const workingDirectoryRef = normalizeWorkingDirectoryRef(input.workingDirectoryRef, input.allowedWorkingDirectoryRefs ?? []);
  return {
    executable: input.executable,
    command: input.command,
    args: input.args,
    ...(workingDirectoryRef === undefined ? {} : { workingDirectoryRef }),
    environment: filterEnvironment(input.environment ?? {}, input.environmentAllowlist ?? []),
  };
}

function normalizeWorkingDirectoryRef(value: string | undefined, allowedRefs: readonly string[]): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  const normalized = normalizePathSeparators(value);
  if (!isPathSafe(normalized)) {
    throw safeFailure('WORKING_DIRECTORY_ESCAPE', 'Working directory is outside allowed roots.', 'working-directory-escape');
  }
  if (allowedRefs.length > 0 && !isPathWithinAllowedRoots(normalized, allowedRefs)) {
    throw safeFailure('WORKING_DIRECTORY_ESCAPE', 'Working directory is outside allowed roots.', 'working-directory-escape');
  }
  return normalized;
}

function normalizePathSeparators(path: string): string {
  return path.replace(/\\/gu, '/').replace(/\/+/gu, '/');
}

function isPathSafe(normalizedPath: string): boolean {
  if (normalizedPath.length === 0 || normalizedPath.startsWith('/') || normalizedPath.includes(':')) {
    return false;
  }
  return !normalizedPath.split('/').some((segment) => segment === '..' || segment.length === 0);
}

function isPathWithinAllowedRoots(normalizedPath: string, allowedRefs: readonly string[]): boolean {
  return allowedRefs.some((root) => {
    const normalizedRoot = normalizePathSeparators(root).replace(/\/+$/u, '');
    return normalizedPath === normalizedRoot || normalizedPath.startsWith(`${normalizedRoot}/`);
  });
}

function filterEnvironment(environment: JsonObject, allowlist: readonly string[]): JsonObject {
  const allowed = new Set(allowlist);
  const filtered: Record<string, string> = {};
  for (const [key, value] of Object.entries(environment)) {
    if (allowed.has(key) && typeof value === 'string' && !SECRET_KEYWORD_PATTERN.test(key)) {
      filtered[key] = value;
    }
  }
  return filtered;
}

function safeFailure(code: string, message: string, reason: string): AgentError {
  return new AgentError({
    code,
    message,
    category: code === 'WORKING_DIRECTORY_ESCAPE' ? 'AUTHORIZATION' : 'UNAVAILABLE',
    retryable: false,
    safeDetails: { reason },
  });
}
