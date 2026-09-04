import type { CapabilityId } from '@nextagent/agent-common';
import { createReadStream, type Dirent } from 'node:fs';
import { lstat, opendir } from 'node:fs/promises';
import { isAbsolute, relative, resolve } from 'node:path';

import type { SkillCanonicalBodyView } from './skill-manifest.js';
import type { SkillResourceProjectionEntry,SkillResourceProjectionMetadata } from '../tools/tool-spi.js';

export interface SkillSourceRequest {
  readonly skillName: CapabilityId;
  readonly skillVersion: string;
}

export interface SkillSourceBodyRequest {
  readonly skillName: CapabilityId;
  readonly skillVersion: string;
  readonly capabilityId: CapabilityId;
  readonly sourceIdentity: string;
  readonly frontmatterHash: string;
}

export interface SkillSourceDiscovery {
  loadCanonicalBodyView: (
    input: SkillSourceBodyRequest,
    signal: AbortSignal
  ) => Promise<SkillCanonicalBodyView | undefined>;
  listSkillResources?: (
    input: SkillSourceRequest,
    signal: AbortSignal
  ) => Promise<readonly SkillResourceMetadata[]>;
  readSkillResource?: (
    input: SkillSourceRequest & { readonly resource: SkillResourceMetadata },
    signal: AbortSignal
  ) => Promise<SkillResourceProjectionEntry | undefined>;
}

export interface SkillSourceRegistry {
  resolveSkillSource: (providerId: string) => SkillSourceDiscovery | undefined;
}

export type SkillResourceMetadata = SkillResourceProjectionMetadata;

const allowedResourceRoots = new Set(['scripts', 'references', 'assets', 'api']);
const maxProjectedResources = 200;
const maxResourceDepth = 8;
const maxRelativePathLength = 240;
const maxResourceBytes = 1_000_000;

export async function listSkillResourcesFromDirectory(rootDir: string, signal: AbortSignal): Promise<readonly SkillResourceMetadata[]> {
  const root = resolve(rootDir);
  const entries: SkillResourceMetadata[] = [];
  const pending: Array<{ readonly relativePath: string; readonly depth: number }> = [...allowedResourceRoots]
    .sort()
    .map((relativePath) => ({ relativePath, depth: 0 }));
  while (pending.length > 0) {
    throwIfAborted(signal);
    if (entries.length >= maxProjectedResources) {
      break;
    }
    const item = pending.shift()!;
    if (!isSafeResourcePath(item.relativePath) || item.depth > maxResourceDepth) {
      continue;
    }
    const absolutePath = resolve(root, item.relativePath);
    if (!isInside(root, absolutePath)) {
      continue;
    }
    let stats;
    try {
      stats = await lstat(absolutePath);
    } catch {
      continue;
    }
    if (stats.isSymbolicLink()) {
      continue;
    }
    if (stats.isDirectory()) {
      if (hasBlockedResourceDirectory(item.relativePath)) {
        continue;
      }
      const children = await readDirectoryEntries(absolutePath);
      for (const child of children) {
        pending.push({ relativePath: `${item.relativePath}/${child.name}`, depth: item.depth + 1 });
      }
      continue;
    }
    if (!stats.isFile() || stats.nlink > 1 || stats.size > maxResourceBytes || item.relativePath.length > maxRelativePathLength) {
      continue;
    }
    entries.push({
      relativePath: item.relativePath,
      kind: resourceKind(item.relativePath),
      sizeBytes: stats.size
    });
  }
  return entries.sort((left, right) => left.relativePath.localeCompare(right.relativePath));
}

export async function readSkillResourceFromDirectory(rootDir: string, metadata: SkillResourceMetadata, signal: AbortSignal): Promise<SkillResourceProjectionEntry | undefined> {
  throwIfAborted(signal);
  const normalized = metadata.relativePath.replaceAll('\\', '/');
  if (!isSafeResourcePath(normalized) || hasBlockedResourceDirectory(normalized) || normalized.length > maxRelativePathLength || normalized.split('/').length - 1 > maxResourceDepth) {
    return undefined;
  }
  const root = resolve(rootDir);
  const absolutePath = resolve(root, normalized);
  if (!isInside(root, absolutePath)) {
    return undefined;
  }
  let stats;
  try {
    stats = await lstat(absolutePath);
  } catch {
    return undefined;
  }
  if (stats.isSymbolicLink() || stats.nlink > 1 || !stats.isFile() || stats.size > maxResourceBytes) {
    return undefined;
  }
  return {
    relativePath: normalized,
    kind: resourceKind(normalized),
    contentStream: createReadStream(absolutePath),
    sizeBytes: stats.size,
    ...(metadata.contentHash === undefined ? {} : { contentHash: metadata.contentHash })
  };
}

async function readDirectoryEntries(absolutePath: string): Promise<ReadonlyArray<Dirent<string>>> {
  const directory = await opendir(absolutePath);
  const entries: Array<Dirent<string>> = [];
  for await (const entry of directory) {
    entries.push(entry);
  }
  return entries.sort((left, right) => left.name.localeCompare(right.name));
}

function isSafeResourcePath(relativePath: string): boolean {
  const normalized = relativePath.replaceAll('\\', '/');
  if (
    normalized.length === 0 ||
    normalized.startsWith('/') ||
    /^[A-Za-z]:/u.test(normalized) ||
    /[\u0000-\u001f]/u.test(normalized) ||
    /(^|\/)(?:\.|\.\.)(?:\/|$)/u.test(normalized) ||
    /^[a-z][a-z0-9+.-]*:/iu.test(normalized)
  ) {
    return false;
  }
  const [top] = normalized.split('/');
  return top !== undefined && allowedResourceRoots.has(top);
}

function hasBlockedResourceDirectory(relativePath: string): boolean {
  return relativePath.split('/').some((segment) =>
    segment === 'node_modules' ||
    segment === '.git' ||
    segment === '.npm' ||
    segment === '.pnpm-store' ||
    segment === '.pnpm' ||
    segment === '.yarn'
  );
}

function resourceKind(relativePath: string): SkillResourceProjectionEntry['kind'] {
  const [top] = relativePath.split('/');
  if (top === 'scripts') {return 'script';}
  if (top === 'assets' || top === 'api') {return 'asset';}
  return 'reference';
}

function isInside(root: string, candidate: string): boolean {
  const path = relative(root, candidate);
  return path.length === 0 || (!path.startsWith('..') && !isAbsolute(path));
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) {
    throw signal.reason ?? new DOMException('Aborted', 'AbortError');
  }
}
