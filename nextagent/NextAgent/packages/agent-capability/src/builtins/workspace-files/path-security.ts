import { lstatSync } from 'node:fs';
import { lstat } from 'node:fs/promises';
import { isAbsolute, normalize, relative, resolve } from 'node:path';
import type { JsonObject, SafeError } from '@nextagent/agent-common';

import { failed } from '../../invocation/input-validation.js';

export interface AuthorizedPath {
  readonly absolutePath: string;
  readonly relativePath: string;
}

export function isWindowsDeviceName(segment: string): boolean {
  const base = segment
    .replace(/[ .]+$/u, '')
    .split('.')[0]
    ?.trimEnd()
    .toUpperCase();
  return base === 'CON' || base === 'PRN' || base === 'AUX' || base === 'NUL' || /^COM[1-9]$/u.test(base ?? '') || /^LPT[1-9]$/u.test(base ?? '');
}

export function isMissingPath(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}

export function isAlreadyExists(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'EEXIST';
}

export function hasForbiddenPathSyntax(path: string): boolean {
  const normalized = path.replaceAll('\\', '/');
  const segments = normalized.split('/');
  return (
    isAbsolute(path) ||
    path.startsWith('\\\\') ||
    path.startsWith('//') ||
    /^[A-Za-z]:/u.test(path) ||
    /[*?[\]]/u.test(path) ||
    segments.includes('..') ||
    segments.some(
      (segment) =>
        segment.includes(':') || /[\u0000-\u001f]/u.test(segment) || (segment !== '.' && /[ .]$/u.test(segment)) || isWindowsDeviceName(segment),
    )
  );
}

export function hasForbiddenDirectorySyntax(path: string): boolean {
  const normalized = path.replaceAll('\\', '/');
  const segments = normalized.split('/');
  return (
    isAbsolute(path) ||
    path.startsWith('\\\\') ||
    path.startsWith('//') ||
    /^[A-Za-z]:/u.test(path) ||
    /[*?[\]{}]/u.test(path) ||
    segments.includes('..') ||
    segments.some(
      (segment) =>
        segment.includes(':') || /[\u0000-\u001f]/u.test(segment) || (segment !== '.' && /[ .]$/u.test(segment)) || isWindowsDeviceName(segment),
    )
  );
}

export function escapesWorkspace(relativePath: string): boolean {
  return relativePath === '..' || relativePath.startsWith('../');
}

export function isInsideDirectories(relativePath: string, directories: readonly string[]): boolean {
  return directories.some((directory) => directory === '.' || relativePath === directory || relativePath.startsWith(`${directory}/`));
}

function isNextAgentPath(relativePath: string): boolean {
  return relativePath === '.nextagent' || relativePath.startsWith('.nextagent/');
}

export function mergeDirectories(left: readonly string[], right: readonly string[]): readonly string[] {
  const all = [...new Set([...left, ...right])];
  return all.filter((directory) => !all.some((parent) => parent !== directory && (parent === '.' || directory.startsWith(`${parent}/`))));
}

export function resolveAuthorizedPath(workspaceRoot: string, filePath: string, directories: readonly string[]): AuthorizedPath {
  if (hasForbiddenPathSyntax(filePath)) {
    throw safeFailure('CAPABILITY_PATH_REJECTED', 'File path is outside the allowed workspace.', 'AUTHORIZATION');
  }
  const normalized = normalize(filePath.replaceAll('\\', '/')).replaceAll('\\', '/');
  const absolutePath = resolve(workspaceRoot, normalized);
  const relativePath = relative(workspaceRoot, absolutePath).replaceAll('\\', '/');
  if (
    relativePath.length === 0 ||
    escapesWorkspace(relativePath) ||
    isAbsolute(relativePath) ||
    (!isNextAgentPath(relativePath) && !isInsideDirectories(relativePath, directories))
  ) {
    throw safeFailure('CAPABILITY_PATH_REJECTED', 'File path is outside the allowed workspace.', 'AUTHORIZATION');
  }
  return { absolutePath, relativePath };
}

export async function assertPathHasNoLinks(workspaceRoot: string, relativePath: string, includeTarget: boolean): Promise<void> {
  if (isNextAgentPath(relativePath)) {
    return;
  }
  const segments = relativePath.split('/');
  const count = includeTarget ? segments.length : segments.length - 1;
  let current = workspaceRoot;
  for (let index = 0; index < count; index += 1) {
    const segment = segments[index]!;
    if (segment === '.nextagent' && (index === 0 || (index === 1 && segments[0] === 'workspace'))) {
      return;
    }
    current = resolve(current, segment);
    try {
      const value = await lstat(current);
      if (value.isSymbolicLink()) {
        throw safeFailure('CAPABILITY_PATH_REJECTED', 'File path crosses a link.', 'AUTHORIZATION');
      }
    } catch (error) {
      if (isMissingPath(error)) {
        return;
      }
      throw error;
    }
  }
}

export function normalizeConfiguredDirectories(workspaceRoot: string, directories: readonly string[]): readonly string[] {
  return mergeDirectories(
    directories.map((directory) => {
      if (directory.length === 0 || (directory !== '.' && hasForbiddenPathSyntax(directory))) {
        throw new Error('Workspace file directory configuration is invalid.');
      }
      const resolved = resolve(workspaceRoot, directory.replaceAll('\\', '/'));
      const relativePath = relative(workspaceRoot, resolved).replaceAll('\\', '/') || '.';
      if (escapesWorkspace(relativePath) || isAbsolute(relativePath)) {
        throw new Error('Workspace file directory configuration escapes workspace.');
      }
      assertConfiguredDirectoryHasNoLinks(workspaceRoot, relativePath);
      return relativePath;
    }),
    [],
  );
}

export function assertConfiguredDirectoryHasNoLinks(workspaceRoot: string, relativePath: string): void {
  let current = workspaceRoot;
  for (const segment of relativePath === '.' ? [] : relativePath.split('/')) {
    current = resolve(current, segment);
    try {
      if (lstatSync(current).isSymbolicLink()) {
        throw new Error('Workspace file directory configuration crosses a link.');
      }
    } catch (error) {
      if (isMissingPath(error)) {
        return;
      }
      throw error;
    }
  }
}

export function resolveSkillSearchRoot(skillRoot: string, path: string): AuthorizedPath | null {
  const normalizedSkillRoot = normalize(skillRoot.replaceAll('\\', '/')).replaceAll('\\', '/');
  const normalizedPath = normalize(path.replaceAll('\\', '/')).replaceAll('\\', '/');
  const absolutePath = resolve(normalizedSkillRoot, normalizedPath);
  const normalized = normalize(absolutePath).replaceAll('\\', '/');
  const relativeToSkill = relative(normalizedSkillRoot, normalized).replaceAll('\\', '/');
  if (escapesWorkspace(relativeToSkill) || isAbsolute(relativeToSkill)) {
    return null;
  }
  return { absolutePath: normalized, relativePath: relativeToSkill || '.' };
}

export function resolveSearchRoot(workspaceRoot: string, directory: string, readDirectories: readonly string[]): AuthorizedPath {
  if (directory !== '.' && hasForbiddenDirectorySyntax(directory)) {
    throw safeFailure('CAPABILITY_PATH_REJECTED', 'Search path is outside the allowed workspace.', 'AUTHORIZATION');
  }
  const normalized = normalize(directory.replaceAll('\\', '/')).replaceAll('\\', '/');
  const absolutePath = resolve(workspaceRoot, normalized);
  const relativePath = relative(workspaceRoot, absolutePath).replaceAll('\\', '/') || '.';
  if (
    escapesWorkspace(relativePath) ||
    isAbsolute(relativePath) ||
    (!isNextAgentPath(relativePath) && !isInsideDirectories(relativePath, readDirectories))
  ) {
    throw safeFailure('CAPABILITY_PATH_REJECTED', 'Search path is outside the allowed workspace.', 'AUTHORIZATION');
  }
  return { absolutePath, relativePath };
}

export function safeFailure(code: string, message: string, category: SafeError['category']) {
  return failed(code, workspaceFailureMessage(message, category), category).safeError!;
}

function workspaceFailureMessage(message: string, category: SafeError['category']): string {
  switch (category) {
    case 'VALIDATION':
      return `${message} Correct the stated file-operation input and call the capability again.`;
    case 'NOT_FOUND':
      return `${message} Use Glob or another current listing to locate an available path, or choose another capability.`;
    case 'CONFLICT':
      return `${message} Read or refresh the current workspace state before deciding whether to retry, or choose another capability.`;
    case 'AUTHORIZATION':
    case 'POLICY_DENIED':
      return `${message} Use a path within the authorized workspace or choose another allowed capability; do not attempt to bypass this boundary.`;
    case 'UNAVAILABLE':
    case 'TIMEOUT':
      return `${message} Narrow the operation, choose another capability, try again later, or stop and report the unavailable boundary.`;
    case 'INTERNAL':
      return `${message} The file operation has stopped. Choose another capability or stop and report the filesystem failure.`;
    case 'CANCELED':
      return message;
    default: {
      const exhaustive: never = category;
      throw new Error(`Unhandled case: ${String(exhaustive)}`);
    }
  }
}

/**
 * Builds a SafeError that carries `safeDetails` plus optional top-level fields
 * (`reasonCode`, `structuredPayload`) that direct `readText`/`writeText`/
 * `editText` callers receive on the thrown object as-is. The capability
 * executor copies only `code/message/category/retryable/safeDetails` through to
 * the model-visible payload, so anything the model needs (e.g. a
 * `suggestedLimit`) must live in `safeDetails`; the top-level fields are for
 * direct callers/tests. Used by actionable failures such as
 * `PAGING_REQUIRED`, where the caller/model needs concrete guidance rather
 * than a bare code+message.
 */
export function safeFailureWithDetails(
  code: string,
  message: string,
  category: SafeError['category'],
  safeDetails: JsonObject,
  topLevel: { readonly reasonCode?: string; readonly structuredPayload?: JsonObject } = {},
): SafeError & { readonly reasonCode?: string; readonly structuredPayload?: JsonObject } {
  return {
    ...safeFailure(code, message, category),
    safeDetails,
    ...(topLevel.reasonCode === undefined ? {} : { reasonCode: topLevel.reasonCode }),
    ...(topLevel.structuredPayload === undefined ? {} : { structuredPayload: topLevel.structuredPayload }),
  };
}
