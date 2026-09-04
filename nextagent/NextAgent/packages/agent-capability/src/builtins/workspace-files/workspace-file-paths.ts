import { isAbsolute, relative, resolve } from 'node:path';

import type { ExecutionWorkspaceRootView, ExecutionWorkspaceView } from '../../tools/tool-spi.js';
import { hasForbiddenPathSyntax, safeFailure } from './path-security.js';

type FileRootView = ExecutionWorkspaceRootView;

export interface ResolvedFileTarget {
  readonly root: FileRootView;
  readonly relativePath: string;
  readonly modelPath: string;
  readonly absolutePath: string;
  readonly skipIfMissing?: boolean;
}

export function resolveTarget(
  view: ExecutionWorkspaceView,
  inputPath: string,
  operation: 'read' | 'write' | 'glob',
  workspaceDirectories: readonly string[],
  verifiedSkillRoots: ReadonlySet<string>,
): ResolvedFileTarget {
  const normalized = normalizeModelPath(inputPath);
  if (normalized === undefined) {
    throw safeFailure('CAPABILITY_PATH_REJECTED', 'File path is outside the authorized execution roots.', 'AUTHORIZATION');
  }
  const root = selectRoot(view, normalized);
  if (operation === 'write' && root.access !== 'readWrite') {
    throw safeFailure('CAPABILITY_PATH_REJECTED', 'File path is not writable.', 'AUTHORIZATION');
  }
  if (root.kind === 'systemResources') {
    if (operation === 'write') {
      throw safeFailure('CAPABILITY_PATH_REJECTED', 'System resource projection is read-only.', 'AUTHORIZATION');
    }
    if (!isAuthorizedSkillPath(normalized.modelPath, verifiedSkillRoots)) {
      throw safeFailure('CAPABILITY_PATH_REJECTED', 'Skill resource is not authorized for this execution scope.', 'AUTHORIZATION');
    }
  }
  if (root.kind !== 'systemResources' && !isInsideDirectories(normalized.modelPath, workspaceDirectories)) {
    throw safeFailure('CAPABILITY_PATH_REJECTED', 'File path is outside allowed execution directories.', 'AUTHORIZATION');
  }
  const absolutePath = resolve(root.physicalPath, normalized.relativePath);
  assertContained(root.physicalPath, absolutePath);
  return {
    root,
    relativePath: normalized.relativePath,
    modelPath: normalized.modelPath,
    absolutePath,
  };
}

export function resolveConfiguredSearchTargets(
  view: ExecutionWorkspaceView,
  directories: readonly string[],
  verifiedSkillRoots: ReadonlySet<string>,
): readonly ResolvedFileTarget[] {
  return deduplicateSearchTargets(directories.flatMap((directory) => resolveSearchTargets(view, directory, directories, verifiedSkillRoots)));
}

export function resolveSearchTargets(
  view: ExecutionWorkspaceView,
  inputPath: string,
  workspaceDirectories: readonly string[],
  verifiedSkillRoots: ReadonlySet<string>,
): readonly ResolvedFileTarget[] {
  const normalized = normalizeModelPath(inputPath);
  if (normalized === undefined) {
    throw safeFailure('CAPABILITY_PATH_REJECTED', 'File path is outside the authorized execution roots.', 'AUTHORIZATION');
  }
  if (isSkillProjectionModelPath(normalized.modelPath)) {
    const matchingRoots = [...verifiedSkillRoots]
      .filter((root) => root === normalized.modelPath || root.startsWith(`${normalized.modelPath}/`))
      .sort(compareLexical);
    if (normalized.modelPath === '.nextagent/skills' || matchingRoots.length > 0) {
      return matchingRoots.map((root) => resolveTarget(view, root, 'glob', workspaceDirectories, verifiedSkillRoots));
    }
  }
  return [resolveTarget(view, inputPath, 'glob', workspaceDirectories, verifiedSkillRoots)];
}

export function normalizeModelPath(inputPath: string): { readonly modelPath: string; readonly relativePath: string } | undefined {
  const path = inputPath.replaceAll('\\', '/').replace(/^\/work\//u, '');
  if (
    path.trim().length === 0 ||
    path.startsWith('/') ||
    /^[A-Za-z]:/u.test(path) ||
    /^[a-z][a-z0-9+.-]*:/iu.test(path) ||
    hasForbiddenPathSyntax(path) ||
    /[\u0000-\u001f]/u.test(path) ||
    /(^|\/)\.\.(\/|$)/u.test(path)
  ) {
    return undefined;
  }
  const segments = path.split('/').filter((segment) => segment.length > 0 && segment !== '.');
  if (segments.length === 0) {
    return { modelPath: 'workspace', relativePath: '.' };
  }
  const [first, ...rest] = segments;
  if (first === 'workspace' || first === '.nextagent' || first === 'temp' || first === 'generated-skills' || first === 'shared-data') {
    return {
      modelPath: [first, ...rest].join('/'),
      relativePath: rest.length === 0 ? '.' : rest.join('/'),
    };
  }
  return { modelPath: ['workspace', ...segments].join('/'), relativePath: segments.join('/') };
}

export function requireRoot(view: ExecutionWorkspaceView, kind: ExecutionWorkspaceRootView['kind']): ExecutionWorkspaceRootView {
  const root = view.roots.find((item) => item.kind === kind);
  if (root === undefined) {
    throw safeFailure('CAPABILITY_PATH_REJECTED', 'Execution workspace root is unavailable.', 'AUTHORIZATION');
  }
  return root;
}

export function isAuthorizedSkillPath(modelPath: string, roots?: ReadonlySet<string>): boolean {
  if (roots === undefined) {
    return false;
  }
  for (const root of roots) {
    if (modelPath === root || modelPath.startsWith(`${root}/`)) {
      return true;
    }
  }
  return false;
}

export function isInsideDirectories(path: string, directories: readonly string[]): boolean {
  return directories.some((directory) => directory === '.' || path === directory || path.startsWith(`${directory}/`));
}

export function assertContained(root: string, candidate: string): void {
  const normalizedRoot = resolve(root);
  const normalizedCandidate = resolve(candidate);
  const path = relative(normalizedRoot, normalizedCandidate);
  if (path === '..' || path.startsWith('../') || path.startsWith('..\\') || isAbsolute(path)) {
    throw safeFailure('CAPABILITY_PATH_REJECTED', 'File path is outside the authorized execution root.', 'AUTHORIZATION');
  }
}

function selectRoot(view: ExecutionWorkspaceView, normalized: { readonly modelPath: string }): FileRootView {
  if (normalized.modelPath === 'workspace' || normalized.modelPath.startsWith('workspace/')) {
    return requireRoot(view, 'workspace');
  }
  if (normalized.modelPath === '.nextagent' || normalized.modelPath.startsWith('.nextagent/')) {
    return requireRoot(view, 'systemResources');
  }
  if (normalized.modelPath === 'generated-skills' || normalized.modelPath.startsWith('generated-skills/')) {
    return requireRoot(view, 'generatedSkills');
  }
  if (normalized.modelPath === 'shared-data' || normalized.modelPath.startsWith('shared-data/')) {
    return requireRoot(view, 'sharedData');
  }
  if (normalized.modelPath === 'temp' || normalized.modelPath.startsWith('temp/')) {
    return requireRoot(view, 'temp');
  }
  throw safeFailure('CAPABILITY_PATH_REJECTED', 'File path is outside the authorized execution roots.', 'AUTHORIZATION');
}

function isSkillProjectionModelPath(modelPath: string): boolean {
  return modelPath === '.nextagent/skills' || modelPath.startsWith('.nextagent/skills/');
}

function deduplicateSearchTargets(targets: readonly ResolvedFileTarget[]): readonly ResolvedFileTarget[] {
  const unique = new Map<string, ResolvedFileTarget>();
  for (const target of targets) {
    unique.set(`${target.modelPath}\0${target.absolutePath}`, target);
  }
  return [...unique.values()];
}

function compareLexical(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
