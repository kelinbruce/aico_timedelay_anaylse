import type { JsonObject, SafeError } from '@nextagent/agent-common';
import type { AgentWorkspacePolicy } from '@nextagent/agent-contracts/agent-assembly';
import { createHash, randomBytes } from 'node:crypto';
import type { Dirent } from 'node:fs';
import { constants } from 'node:fs';
import { access, chmod, link, lstat, mkdir, open, opendir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { extname, isAbsolute, resolve } from 'node:path';
import picomatch from 'picomatch';

import { failed, integerField, stringField } from '../../invocation/input-validation.js';
import {
  type ExecutionWorkspaceRootView,
  type ExecutionWorkspaceView,
  type SandboxFilesystemLayout,
  type SkillResourceProjectionEntry,
  type SkillResourceProjectionInput,
  type SkillResourceProjectionResult,
  type SkillResourcePathResolution,
  type ToolExecutionContext,
  type WorkspaceFilePort,
} from '../../tools/tool-spi.js';
import { decodeText, type DecodedText, encodeText, fingerprint, truncateUtf8 } from './text-encoding.js';
import { FileSnapshotStore } from './file-snapshot-store.js';
import {
  assertContained,
  isAuthorizedSkillPath,
  isInsideDirectories,
  normalizeModelPath,
  requireRoot,
  resolveConfiguredSearchTargets,
  resolveSearchTargets,
  resolveTarget,
} from './workspace-file-paths.js';
import {
  hasForbiddenDirectorySyntax,
  hasForbiddenPathSyntax,
  isAlreadyExists,
  isMissingPath,
  mergeDirectories,
  normalizeConfiguredDirectories,
  safeFailure,
  safeFailureWithDetails,
} from './path-security.js';

const defaultMaxTextBytes = 256_000;
const toolResultReadbackMaxTextBytes = 65_536;
const globMaxDepth = 10;
const globMaxResults = 500;
const globMaxInspectedEntries = 20_000;
const globMaxBraceAlternatives = 32;
const globMaxBraceCombinations = 256;
const grepMaxDepth = 10;
const grepDefaultMaxResults = 100;
const grepMaxResults = 500;
const grepMaxInspectedEntries = 20_000;
const grepMaxReadBytesPerFile = 512 * 1024;
const grepMaxTotalReadBytes = 32 * 1024 * 1024;
const grepMaxLineCodeUnits = 4096;
const grepBinaryScanWindow = 8 * 1024;
const workspaceFileCacheMaxEntries = 1024;
const skillProjectionNamespace = 'nextagent.skill-projection.v1';
const maxProjectionFiles = 200;
const maxPhysicalPathLength = 240;
const projectionManifestVersion = 'nextagent.skill-resource-projection.v6';
const projectionLockWaitMs = 5000;
const projectionLockPollMs = 25;

export type ReadWorkspaceFileOptions = LegacyWorkspaceFileOptions | ResolverBackedWorkspaceFileOptions;

export interface LegacyWorkspaceFileOptions extends WorkspaceFilePolicyOptions {
  readonly workspaceDir: string;
}

export interface ResolverBackedWorkspaceFileOptions extends WorkspaceFilePolicyOptions {
  readonly runtimeWorkspaceRoot: string;
  readonly sharedDataRoot?: string;
  readonly executionWorkspaceResolver: ExecutionWorkspaceResolver;
  readonly deploymentMode: ExecutionDeploymentMode;
  readonly workspacePolicyProvider: {
    require: (agentId: ToolExecutionContext['agentId'], agentVersion: ToolExecutionContext['agentVersion']) => Promise<AgentWorkspacePolicy>;
  };
  readonly workspaceFileExtensionPolicyProvider?: {
    require: (agentId: ToolExecutionContext['agentId'], agentVersion: ToolExecutionContext['agentVersion']) => Promise<WorkspaceFileExtensionPolicy>;
  };
}

type ExecutionDeploymentMode = 'LOCAL' | 'REMOTE';

interface ExecutionWorkspaceResolver {
  locateRoot?: (
    input: {
      readonly runtimeWorkspaceRoot: string;
      readonly sharedDataRoot?: string;
      readonly workspacePolicy: AgentWorkspacePolicy;
      readonly agentId: ToolExecutionContext['agentId'];
      readonly tenantId: ToolExecutionContext['identityContext']['tenantId'];
      readonly subjectId: ToolExecutionContext['identityContext']['subjectId'];
      readonly sessionId?: ToolExecutionContext['sessionId'];
      readonly deploymentMode: ExecutionDeploymentMode;
    },
    kind: ExecutionWorkspaceRootView['kind'],
  ) => string | undefined;
  resolve: (input: {
    readonly runtimeWorkspaceRoot: string;
    readonly sharedDataRoot?: string;
    readonly workspacePolicy: AgentWorkspacePolicy;
    readonly agentId: ToolExecutionContext['agentId'];
    readonly tenantId: ToolExecutionContext['identityContext']['tenantId'];
    readonly subjectId: ToolExecutionContext['identityContext']['subjectId'];
    readonly sessionId?: ToolExecutionContext['sessionId'];
    readonly runId: ToolExecutionContext['runId'];
    readonly deploymentMode: ExecutionDeploymentMode;
  }) => ExecutionWorkspaceView;
}

interface WorkspaceFileExtensionPolicy {
  readonly readAllowedExtensions?: readonly string[];
  readonly readDeniedExtensions?: readonly string[];
  readonly writeAllowedExtensions?: readonly string[];
  readonly writeDeniedExtensions?: readonly string[];
}

export interface WorkspaceFilePolicyOptions extends WorkspaceFileExtensionPolicy {
  readonly maxLines?: number;
  readonly maxOutputBytes?: number;
  readonly maxTextBytes?: number;
  readonly maxGlobInspectedEntries?: number;
  readonly readDirectories?: readonly string[];
  readonly writeDirectories?: readonly string[];
}

interface ExistingTarget {
  readonly bytes: Buffer;
  readonly decoded: DecodedText;
  readonly mtimeMs: number;
  readonly mode: number;
}

interface ProjectionPlanEntry {
  readonly relativePath: string;
  readonly kind: 'script' | 'reference' | 'asset';
  readonly sizeBytes: number;
  readonly sha256: string;
}

interface ProjectionManifest {
  readonly schemaVersion: typeof projectionManifestVersion;
  readonly providerId: string;
  readonly skillName: string;
  readonly skillVersion: string;
  readonly resourceCount: number;
  readonly resources: readonly ProjectionManifestResource[];
}

interface ProjectionManifestResource {
  readonly relativePath: string;
  readonly kind: 'script' | 'reference' | 'asset';
  readonly sizeBytes: number;
  readonly sha256: string;
}

interface ProjectionIdentity {
  readonly schemaVersion: typeof projectionManifestVersion;
  readonly providerId: string;
  readonly skillName: string;
  readonly skillVersion: string;
}

interface ResolvedWorkspaceFilePolicy {
  readonly maxLines: number;
  readonly maxTextBytes: number;
  readonly maxGlobInspectedEntries: number;
  readonly readDirectories: readonly string[];
  readonly writeDirectories: readonly string[];
  readonly readAllowedExtensions?: ReadonlySet<string>;
  readonly readDeniedExtensions: ReadonlySet<string>;
  readonly writeAllowedExtensions?: ReadonlySet<string>;
  readonly writeDeniedExtensions: ReadonlySet<string>;
}

export function createWorkspaceFilePort(options: ReadWorkspaceFileOptions): WorkspaceFilePort {
  const defaultPolicy = resolveWorkspaceFilePolicy(options);
  const policyCache = new Map<string, ResolvedWorkspaceFilePolicy>();
  const workspacePolicyCache = new Map<string, AgentWorkspacePolicy>();
  const snapshots = new FileSnapshotStore();
  const writeLocks = new Map<string, Promise<void>>();
  const verifiedSkillRootsBySystemRoot = new Map<string, Map<string, string>>();
  const initializedSkillProjectionBases = new Set<string>();

  async function resolveFilePolicy(context: ToolExecutionContext): Promise<ResolvedWorkspaceFilePolicy> {
    if (!('runtimeWorkspaceRoot' in options)) {
      return defaultPolicy;
    }
    const key = `${context.agentId}:${context.agentVersion}`;
    const cached = policyCache.get(key);
    if (cached !== undefined) {
      return cached;
    }
    const workspacePolicy = await requireWorkspacePolicy(context);
    const extensionPolicy =
      options.workspaceFileExtensionPolicyProvider === undefined
        ? extensionPolicyFromOptions(options)
        : await options.workspaceFileExtensionPolicyProvider.require(context.agentId, context.agentVersion);
    const agentPolicy = resolveWorkspaceFilePolicy({
      ...(options.maxLines === undefined ? {} : { maxLines: options.maxLines }),
      ...(options.maxOutputBytes === undefined ? {} : { maxOutputBytes: options.maxOutputBytes }),
      ...(options.maxTextBytes === undefined ? {} : { maxTextBytes: options.maxTextBytes }),
      ...(options.maxGlobInspectedEntries === undefined ? {} : { maxGlobInspectedEntries: options.maxGlobInspectedEntries }),
      ...(workspacePolicy.files ?? {}),
      ...extensionPolicy,
    });
    setCappedCacheEntry(policyCache, key, agentPolicy, workspaceFileCacheMaxEntries);
    return agentPolicy;
  }

  async function requireWorkspacePolicy(context: ToolExecutionContext): Promise<AgentWorkspacePolicy> {
    if (!('runtimeWorkspaceRoot' in options)) {
      throw new Error('Workspace policy is unavailable for legacy workspace files.');
    }
    const key = `${context.agentId}:${context.agentVersion}`;
    const cached = workspacePolicyCache.get(key);
    if (cached !== undefined) {
      return cached;
    }
    const policy = await options.workspacePolicyProvider.require(context.agentId, context.agentVersion);
    setCappedCacheEntry(workspacePolicyCache, key, policy, workspaceFileCacheMaxEntries);
    return policy;
  }

  async function resolveView(context: ToolExecutionContext): Promise<ExecutionWorkspaceView> {
    if ('runtimeWorkspaceRoot' in options) {
      const workspacePolicy = await requireWorkspacePolicy(context);
      return options.executionWorkspaceResolver.resolve({
        runtimeWorkspaceRoot: options.runtimeWorkspaceRoot,
        ...(options.sharedDataRoot === undefined ? {} : { sharedDataRoot: options.sharedDataRoot }),
        workspacePolicy,
        agentId: context.agentId,
        tenantId: context.identityContext.tenantId,
        subjectId: context.identityContext.subjectId,
        sessionId: context.sessionId,
        runId: context.runId,
        deploymentMode: options.deploymentMode,
      });
    }
    const workspaceRoot = resolve(options.workspaceDir);
    const scopeBase = workspaceRoot;
    return {
      workspaceDir: 'workspace/',
      defaultCwd: scopeBase,
      roots: [
        { kind: 'workspace', logicalPath: 'workspace', physicalPath: workspaceRoot, access: 'readWrite' },
        { kind: 'systemResources', logicalPath: '.nextagent', physicalPath: resolve(scopeBase, '.nextagent'), access: 'read' },
        { kind: 'temp', logicalPath: 'temp', physicalPath: resolve(scopeBase, 'temp', String(context.runId)), access: 'readWrite' },
        { kind: 'generatedSkills', logicalPath: 'generated-skills', physicalPath: resolve(scopeBase, 'generated-skills'), access: 'readWrite' },
      ],
    };
  }

  function requireScopeSkillRootCache(systemRoot: ExecutionWorkspaceRootView): Map<string, string> {
    const cached = verifiedSkillRootsBySystemRoot.get(systemRoot.physicalPath);
    if (cached !== undefined) {
      return cached;
    }
    const created = new Map<string, string>();
    setCappedCacheEntry(verifiedSkillRootsBySystemRoot, systemRoot.physicalPath, created, workspaceFileCacheMaxEntries);
    return created;
  }

  async function cacheCommittedSkillRoot(systemRoot: ExecutionWorkspaceRootView, rootRelativePath: string, manifestPath: string): Promise<void> {
    const manifestHash = createHash('sha256')
      .update(await readFile(manifestPath))
      .digest('hex');
    setCappedCacheEntry(requireScopeSkillRootCache(systemRoot), rootRelativePath, manifestHash, workspaceFileCacheMaxEntries);
  }

  async function validateCommittedSkillRoot(
    systemRoot: ExecutionWorkspaceRootView,
    skillProjectionKey: string,
    expectedSkillName?: string,
  ): Promise<{ readonly rootRelativePath: string; readonly manifestPath: string } | undefined> {
    if (!/^[a-f0-9]{16}$/u.test(skillProjectionKey)) {
      return undefined;
    }
    const projectionBase = resolve(systemRoot.physicalPath, 'skills', skillProjectionKey);
    const manifestPath = resolve(projectionBase, '.projection.json');
    try {
      const baseStat = await lstat(projectionBase);
      const manifestStat = await lstat(manifestPath);
      if (baseStat.isSymbolicLink() || !baseStat.isDirectory() || manifestStat.isSymbolicLink() || !manifestStat.isFile()) {
        return undefined;
      }
      const rawManifest = await readFile(manifestPath, 'utf8');
      const manifest = JSON.parse(rawManifest) as Partial<ProjectionManifest>;
      if (
        manifest.schemaVersion !== projectionManifestVersion ||
        typeof manifest.providerId !== 'string' ||
        typeof manifest.skillName !== 'string' ||
        typeof manifest.skillVersion !== 'string' ||
        !isSafeProjectionDirectoryName(manifest.skillName) ||
        (expectedSkillName !== undefined && manifest.skillName !== expectedSkillName) ||
        deriveSkillProjectionKey(manifest.providerId, manifest.skillName, manifest.skillVersion) !== skillProjectionKey
      ) {
        return undefined;
      }
      const targetRoot = resolve(projectionBase, manifest.skillName);
      assertContained(systemRoot.physicalPath, targetRoot);
      const committed = await projectionCommitted(manifestPath, targetRoot, {
        schemaVersion: projectionManifestVersion,
        providerId: manifest.providerId,
        skillName: manifest.skillName,
        skillVersion: manifest.skillVersion,
      });
      if (committed === undefined) {
        return undefined;
      }
      const rootRelativePath = `.nextagent/skills/${skillProjectionKey}/${manifest.skillName}`;
      await cacheCommittedSkillRoot(systemRoot, rootRelativePath, manifestPath);
      return { rootRelativePath, manifestPath };
    } catch {
      return undefined;
    }
  }

  async function validateCachedSkillRoot(
    systemRoot: ExecutionWorkspaceRootView,
    rootRelativePath: string,
    expectedManifestHash: string,
  ): Promise<boolean> {
    const parsed = parseSkillRootRelativePath(rootRelativePath);
    if (parsed === undefined) {
      return false;
    }
    const projectionBase = resolve(systemRoot.physicalPath, 'skills', parsed.skillProjectionKey);
    const manifestPath = resolve(projectionBase, '.projection.json');
    const targetRoot = resolve(projectionBase, parsed.skillName);
    try {
      const manifestStat = await lstat(manifestPath);
      const targetStat = await lstat(targetRoot);
      if (manifestStat.isSymbolicLink() || !manifestStat.isFile() || targetStat.isSymbolicLink() || !targetStat.isDirectory()) {
        return false;
      }
      const actualManifestHash = createHash('sha256')
        .update(await readFile(manifestPath))
        .digest('hex');
      if (actualManifestHash === expectedManifestHash) {
        return true;
      }
    } catch {
      return false;
    }
    return (await validateCommittedSkillRoot(systemRoot, parsed.skillProjectionKey, parsed.skillName)) !== undefined;
  }

  async function verifiedSkillRootsForPath(view: ExecutionWorkspaceView, modelPath: string): Promise<ReadonlySet<string>> {
    const systemRoot = requireRoot(view, 'systemResources');
    const cache = requireScopeSkillRootCache(systemRoot);
    const candidate = skillRootFromModelPath(modelPath);
    if (candidate === undefined) {
      return new Set(cache.keys());
    }
    const cachedHash = cache.get(candidate.rootRelativePath);
    if (cachedHash !== undefined) {
      if (await validateCachedSkillRoot(systemRoot, candidate.rootRelativePath, cachedHash)) {
        return new Set(cache.keys());
      }
      cache.delete(candidate.rootRelativePath);
    }
    await validateCommittedSkillRoot(systemRoot, candidate.skillProjectionKey, candidate.skillName);
    return new Set(cache.keys());
  }

  async function discoverVerifiedSkillRoots(view: ExecutionWorkspaceView): Promise<ReadonlySet<string>> {
    const systemRoot = requireRoot(view, 'systemResources');
    const cache = requireScopeSkillRootCache(systemRoot);
    for (const [rootRelativePath, manifestHash] of [...cache]) {
      if (!(await validateCachedSkillRoot(systemRoot, rootRelativePath, manifestHash))) {
        cache.delete(rootRelativePath);
      }
    }
    const skillsRoot = resolve(systemRoot.physicalPath, 'skills');
    try {
      const skillsStat = await lstat(skillsRoot);
      if (skillsStat.isSymbolicLink() || !skillsStat.isDirectory()) {
        return new Set(cache.keys());
      }
      const listed = await readBoundedDirectory(skillsRoot, workspaceFileCacheMaxEntries + 1);
      if (listed.truncated || listed.entries.length > workspaceFileCacheMaxEntries) {
        throw safeFailure('RESOURCE_TOO_LARGE', 'Skill projection root count exceeds the supported limit.', 'VALIDATION');
      }
      for (const entry of listed.entries.sort((left, right) => compareLexical(left.name, right.name))) {
        if (entry.name.startsWith('.') || cacheHasProjectionKey(cache, entry.name)) {
          continue;
        }
        await validateCommittedSkillRoot(systemRoot, entry.name);
      }
    } catch (error) {
      if (!isMissingPath(error)) {
        throw error;
      }
    }
    return new Set(cache.keys());
  }

  async function sandboxFilesystem(context: ToolExecutionContext): Promise<SandboxFilesystemLayout> {
    const view = await resolveView(context);
    const roots: Array<SandboxFilesystemLayout['roots'][number]> = view.roots
      .filter((root) => root.kind !== 'systemResources')
      .map((root) => ({
        kind: root.kind,
        logicalPath: root.logicalPath,
        physicalPath: root.physicalPath,
        access: root.access,
      }));
    const systemRoot = requireRoot(view, 'systemResources');
    for (const rootRelativePath of await discoverVerifiedSkillRoots(view)) {
      const relativeToSystemRoot = rootRelativePath.slice('.nextagent/'.length);
      roots.push({
        kind: 'systemResources',
        logicalPath: rootRelativePath,
        physicalPath: resolve(systemRoot.physicalPath, relativeToSystemRoot),
        access: 'read',
      });
    }
    return { defaultCwd: view.defaultCwd, roots };
  }

  function readActiveSkillName(flowVariables: ToolExecutionContext['flowVariables']): string | undefined {
    const activeSkillContext = flowVariables?.['activeSkillContext'];
    if (activeSkillContext === null || typeof activeSkillContext !== 'object' || Array.isArray(activeSkillContext)) {
      return undefined;
    }
    const skillName = (activeSkillContext as Record<string, unknown>)['skillName'];
    return typeof skillName === 'string' ? skillName : undefined;
  }

  async function resolveSkillResourcePath(relativePath: string, context: ToolExecutionContext): Promise<SkillResourcePathResolution> {
    const parsed = parseSkillRelativeResourcePath(relativePath);
    if (parsed === undefined) {
      return { status: 'not-found' };
    }
    // When the model writes a bare 'scripts/foo.py' path without a skill name
    // prefix, use the active Skill context to disambiguate so that only the
    // currently active Skill's scripts are matched.
    const effectiveSkillName = parsed.skillName ?? readActiveSkillName(context.flowVariables);
    const view = await resolveView(context);
    const systemRoot = requireRoot(view, 'systemResources');
    const candidates: string[] = [];
    for (const rootRelativePath of await discoverVerifiedSkillRoots(view)) {
      const root = parseSkillRootRelativePath(rootRelativePath);
      if (root === undefined || (effectiveSkillName !== undefined && root.skillName !== effectiveSkillName)) {
        continue;
      }
      const committed = await validateCommittedSkillRoot(systemRoot, root.skillProjectionKey, root.skillName);
      if (committed === undefined) {
        continue;
      }
      const manifest = await readProjectionManifest(committed.manifestPath);
      if (manifest === undefined || !manifest.resources.some((resource) => resource.relativePath === parsed.resourcePath)) {
        continue;
      }
      const skillRoot = resolve(systemRoot.physicalPath, 'skills', root.skillProjectionKey, root.skillName);
      try {
        await assertPathHasNoLinks(skillRoot, parsed.resourcePath, true);
        const targetStat = await lstat(resolve(skillRoot, parsed.resourcePath));
        if (!targetStat.isFile()) {
          continue;
        }
      } catch {
        continue;
      }
      candidates.push(`${rootRelativePath}/${parsed.resourcePath}`);
    }
    const uniqueCandidates = [...new Set(candidates)].sort(compareLexical);
    if (uniqueCandidates.length === 0) {
      return { status: 'not-found' };
    }
    if (uniqueCandidates.length === 1) {
      return { status: 'resolved', logicalPath: uniqueCandidates[0]! };
    }
    return { status: 'ambiguous', candidates: uniqueCandidates };
  }

  return {
    async resolveView(context) {
      return resolveView(context);
    },

    async sandboxFilesystem(context) {
      return sandboxFilesystem(context);
    },

    async resolveSkillResourcePath(relativePath, context) {
      return resolveSkillResourcePath(relativePath, context);
    },

    async projectSkillResources(
      input: SkillResourceProjectionInput,
      context: ToolExecutionContext,
      signal?: AbortSignal,
    ): Promise<SkillResourceProjectionResult> {
      throwIfAborted(signal);
      const view = await resolveView(context);
      const systemRoot = requireRoot(view, 'systemResources');
      const skillProjectionKey = deriveSkillProjectionKey(input.providerId, input.skillName, input.skillVersion);
      const rootRelativePath = `.nextagent/skills/${skillProjectionKey}/${input.skillName}`;
      const projectionBase = resolve(systemRoot.physicalPath, 'skills', skillProjectionKey);
      const targetRoot = resolve(systemRoot.physicalPath, 'skills', skillProjectionKey, input.skillName);
      const manifestPath = resolve(projectionBase, '.projection.json');
      assertContained(systemRoot.physicalPath, targetRoot);
      const projectionIdentity: ProjectionIdentity = {
        schemaVersion: projectionManifestVersion,
        providerId: input.providerId,
        skillName: input.skillName,
        skillVersion: input.skillVersion,
      };
      if (initializedSkillProjectionBases.has(projectionBase)) {
        const committed = await projectionCommitted(manifestPath, targetRoot, projectionIdentity);
        if (committed !== undefined) {
          await cacheCommittedSkillRoot(systemRoot, rootRelativePath, manifestPath);
          return { skillProjectionKey, rootRelativePath: `${rootRelativePath}/`, projectedCount: committed.resourceCount };
        }
      }
      const lockRoot = resolve(systemRoot.physicalPath, 'skills', '.locks', skillProjectionKey);
      const lockStatus = await acquireProjectionLock(lockRoot, manifestPath, targetRoot, projectionIdentity, signal);
      if (lockStatus.status === 'reused') {
        await cacheCommittedSkillRoot(systemRoot, rootRelativePath, manifestPath);
        return { skillProjectionKey, rootRelativePath: `${rootRelativePath}/`, projectedCount: lockStatus.manifest.resourceCount };
      }
      if (lockStatus.status === 'timeout') {
        throw projectionSafeFailure('CAPABILITY_PATH_REJECTED', 'Skill resource projection is locked.', 'CONFLICT', {
          failureStage: 'LOCK_ACQUIRE',
          failureReasonCode: 'SKILL_PROJECTION_LOCK_TIMEOUT',
          lockWaitMs: projectionLockWaitMs,
        });
      }
      const operationKey = randomBytes(12).toString('hex');
      const stagingRoot = resolve(systemRoot.physicalPath, 'skills', '.staging', operationKey);
      const stagingSkillRoot = resolve(stagingRoot, input.skillName);
      let projectedCount = 0;
      try {
        throwIfAborted(signal);
        if (initializedSkillProjectionBases.has(projectionBase) || lockStatus.observedContention) {
          const committedAfterLock = await projectionCommitted(manifestPath, targetRoot, projectionIdentity);
          if (committedAfterLock !== undefined) {
            await cacheCommittedSkillRoot(systemRoot, rootRelativePath, manifestPath);
            return { skillProjectionKey, rootRelativePath: `${rootRelativePath}/`, projectedCount: committedAfterLock.resourceCount };
          }
        }
        const listedResources = (await input.listResources?.(signal)) ?? [];
        if (listedResources.length > maxProjectionFiles) {
          throw projectionSafeFailure('RESOURCE_TOO_LARGE', 'Skill resource projection exceeds the file count limit.', 'VALIDATION', {
            failureStage: 'LIST_RESOURCES',
            failureReasonCode: 'SKILL_PROJECTION_RESOURCE_COUNT_LIMIT',
            resourceCount: listedResources.length,
            maxResourceCount: maxProjectionFiles,
          });
        }
        const projectionResources = listedResources
          .filter((resource) => isSafeProjectionRelativePath(resource.relativePath))
          .map((resource) => {
            const normalizedResource = { ...resource, relativePath: resource.relativePath.replaceAll('\\', '/') };
            const target = resolve(targetRoot, normalizedResource.relativePath);
            assertContained(targetRoot, target);
            if (target.length > maxPhysicalPathLength) {
              throw projectionSafeFailure('RESOURCE_TOO_LARGE', 'Skill resource projection path exceeds the path length budget.', 'VALIDATION', {
                failureStage: 'RESOURCE_METADATA_VALIDATE',
                failureReasonCode: 'SKILL_PROJECTION_PATH_LENGTH_LIMIT',
                pathLength: target.length,
                maxPathLength: maxPhysicalPathLength,
              });
            }
            return { resource: normalizedResource, target };
          })
          .sort((left, right) => compareLexical(left.resource.relativePath, right.resource.relativePath));
        projectedCount = projectionResources.length;
        if (projectionResources.length > 0 && input.readResource === undefined) {
          throw projectionSafeFailure('CAPABILITY_PATH_REJECTED', 'Skill resource reader boundary is unavailable.', 'CONFLICT', {
            failureStage: 'READ_RESOURCE',
            failureReasonCode: 'SKILL_PROJECTION_READER_UNAVAILABLE',
            resourceCount: projectionResources.length,
          });
        }
        await rm(stagingRoot, { recursive: true, force: true });
        await mkdir(stagingSkillRoot, { recursive: true });
        const plan: ProjectionPlanEntry[] = [];
        for (const { resource } of projectionResources) {
          throwIfAborted(signal);
          const loaded = await input.readResource?.(resource, signal);
          if (loaded === undefined || !sameProjectionResource(resource, loaded)) {
            throw projectionSafeFailure('CAPABILITY_PATH_REJECTED', 'Skill resource projection source no longer matches.', 'CONFLICT', {
              failureStage: 'READ_RESOURCE',
              failureReasonCode: 'SKILL_PROJECTION_SOURCE_CHANGED',
            });
          }
          const target = resolve(stagingSkillRoot, resource.relativePath);
          assertContained(stagingSkillRoot, target);
          await mkdir(resolve(target, '..'), { recursive: true });
          const written = await writeProjectionStream(target, loaded, signal);
          plan.push({
            relativePath: resource.relativePath,
            kind: resource.kind,
            sizeBytes: written.sizeBytes,
            sha256: written.sha256,
          });
        }
        const manifest: ProjectionManifest = {
          ...projectionIdentity,
          resourceCount: projectedCount,
          resources: plan,
        };
        await verifyProjectionTree(stagingSkillRoot, plan);
        await mkdir(projectionBase, { recursive: true });
        await restoreWritableForRemoval(targetRoot);
        await rm(targetRoot, { recursive: true, force: true });
        await rename(stagingSkillRoot, targetRoot);
        await writeFile(manifestPath, JSON.stringify(manifest, undefined, 2), 'utf8');
        addCappedSetEntry(initializedSkillProjectionBases, projectionBase, workspaceFileCacheMaxEntries);
      } finally {
        await rm(stagingRoot, { recursive: true, force: true }).catch(() => undefined);
        await rm(lockRoot, { recursive: true, force: true }).catch(() => undefined);
      }
      await cacheCommittedSkillRoot(systemRoot, rootRelativePath, manifestPath);
      return { skillProjectionKey, rootRelativePath: `${rootRelativePath}/`, projectedCount };
    },

    async readText(input: JsonObject, context: ToolExecutionContext, signal?: AbortSignal): Promise<JsonObject> {
      throwIfAborted(signal);
      const policy = await resolveFilePolicy(context);
      const filePath = stringField(input, 'file_path');
      const offset = integerField(input, 'offset', 0);
      const limit = integerField(input, 'limit', policy.maxLines);
      if (filePath === undefined) {
        throw safeFailure('CAPABILITY_INPUT_INVALID', 'Read file_path must be a non-empty string.', 'VALIDATION');
      }
      if (offset === undefined || offset < 0) {
        throw safeFailure('CAPABILITY_INPUT_INVALID', 'Read offset must be a non-negative integer.', 'VALIDATION');
      }
      if (limit === undefined || limit < 1 || limit > policy.maxLines) {
        throw safeFailure('CAPABILITY_INPUT_INVALID', `Read limit must be an integer from 1 through ${policy.maxLines}.`, 'VALIDATION');
      }
      const view = await resolveView(context);
      const normalizedPath = normalizeModelPath(filePath);
      const verifiedSkillRoots =
        normalizedPath !== undefined && isModelVisibleSkillResourcePath(normalizedPath.modelPath)
          ? await verifiedSkillRootsForPath(view, normalizedPath.modelPath)
          : new Set<string>();
      if (
        normalizedPath !== undefined &&
        isModelVisibleSkillResourcePath(normalizedPath.modelPath) &&
        !isAuthorizedSkillPath(normalizedPath.modelPath, verifiedSkillRoots)
      ) {
        throw safeFailure(
          'SKILL_RESOURCE_UNAVAILABLE',
          'The requested Skill resource is not available in the verified workspace view. Stop this read and resolve or acquire the Skill first.',
          'AUTHORIZATION',
        );
      }
      const target = resolveTarget(view, filePath, 'read', policy.readDirectories, verifiedSkillRoots);
      if (!isExtensionAllowed(target.modelPath, policy.readAllowedExtensions, policy.readDeniedExtensions)) {
        throw safeFailure('CAPABILITY_PATH_REJECTED', 'File extension is not allowed by Agent workspace policy.', 'AUTHORIZATION');
      }
      try {
        if (target.root.kind !== 'systemResources') {
          await assertPathHasNoLinks(target.root.physicalPath, target.relativePath, true);
        }
        const singleCallTextBudget = resolveReadSingleCallTextBudget(target.modelPath, policy.maxTextBytes);
        const fileStat = await stat(target.absolutePath);
        if (!fileStat.isFile()) {
          throw safeFailure('FILE_UNAVAILABLE', 'The requested path is not a readable file.', 'NOT_FOUND');
        }
        const bytes = await readFile(target.absolutePath);
        const decoded = decodeText(bytes);
        const lines = decoded.text.split(/\r?\n/u);
        const selected = lines.slice(offset, offset + limit);
        let content = selected.join('\n');
        let truncated = offset + limit < lines.length;
        if (Buffer.byteLength(content, 'utf8') > singleCallTextBudget) {
          if (limit > 1) {
            // The requested slice exceeds the per-call byte budget. Compute a
            // concrete `suggestedLimit` so the caller/model can retry verbatim
            // instead of guessing smaller limits (which, with very large lines,
            // burns tool rounds and can exhaust the request retry budget).
            // Suggested limit is derived from the largest line in the slice;
            // when even one line fills the budget it collapses to 1, which the
            // `limit === 1` branch below handles by truncating that single line.
            const selectedLineCount = Math.max(1, selected.length);
            const selectedByteLengths = selected.map((line) => Buffer.byteLength(line, 'utf8'));
            const maxLineBytes = selectedByteLengths.reduce((acc, value) => (value > acc ? value : acc), 0);
            const sliceBytes = Buffer.byteLength(content, 'utf8');
            const maxLineWithSeparatorBytes = maxLineBytes + 1;
            let suggestedLimit = Math.max(1, Math.floor(singleCallTextBudget / Math.max(1, maxLineWithSeparatorBytes)));
            if (suggestedLimit >= limit) {
              // Every line is small relative to the budget; the slice is huge
              // because `limit` is large. Shrink based on the average line size
              // and guarantee progress by staying below the current limit.
              const averageLineBytes = Math.max(1, Math.ceil(sliceBytes / selectedLineCount));
              suggestedLimit = Math.min(limit - 1, Math.max(1, Math.floor(singleCallTextBudget / averageLineBytes)));
            }
            suggestedLimit = Math.min(suggestedLimit, policy.maxLines);
            throw safeFailureWithDetails(
              'PAGING_REQUIRED',
              `The requested file slice (${sliceBytes} bytes, ${selectedLineCount} selected lines, requested limit ${limit}) ` +
                `exceeds the single-call read budget (${singleCallTextBudget} bytes). ` +
                `Largest line is ${maxLineBytes} bytes. Retry Read with offset=${offset} and limit=${suggestedLimit} (or smaller). ` +
                `A single line that alone exceeds the budget is returned truncated when limit=1.`,
              'VALIDATION',
              {
                reasonCode: 'PAGING_REQUIRED',
                suggestedLimit,
                byteBudget: singleCallTextBudget,
                requestedLimit: limit,
                offset,
                maxLineBytes,
                sliceBytes,
              },
              {
                reasonCode: 'PAGING_REQUIRED',
                structuredPayload: {
                  file_path: target.modelPath,
                  offset,
                  content: '',
                  error: 'PAGING_REQUIRED',
                  nextOffset: offset,
                  suggestedLimit,
                },
              },
            );
          }
          // limit === 1: a single line still exceeds the byte budget and cannot
          // be subdivided (offset/limit are line-based). Fall back to a bounded
          // head so the model is not dead-locked, and mark truncated so it knows
          // the line is incomplete rather than silently treating it as whole.
          content = truncateUtf8(content, singleCallTextBudget);
          truncated = true;
        }
        if (offset === 0 && !truncated) {
          snapshots.set(context, target.modelPath, fingerprint(bytes, fileStat.mtimeMs, fileStat.mode));
        }
        return {
          file_path: target.modelPath,
          offset,
          limit,
          content,
          truncated,
          ...(truncated ? { nextOffset: offset + selected.length } : {}),
        };
      } catch (error) {
        if (isSafeErrorLike(error)) {
          throw error;
        }
        if (isMissingPath(error)) {
          throw safeFailure('FILE_UNAVAILABLE', 'The requested file does not exist in the current workspace view.', 'NOT_FOUND');
        }
        throw safeFailure('CAPABILITY_EXECUTION_FAILED', 'The requested file could not be read safely.', 'INTERNAL');
      }
    },

    async writeText(input: JsonObject, context: ToolExecutionContext, signal?: AbortSignal): Promise<JsonObject> {
      throwIfAborted(signal);
      const filePath = stringField(input, 'file_path');
      const content = input['content'];
      if (filePath === undefined) {
        throw safeFailure('CAPABILITY_INPUT_INVALID', 'Write file_path must be a non-empty string.', 'VALIDATION');
      }
      if (typeof content !== 'string' || content.length === 0) {
        throw safeFailure('CAPABILITY_INPUT_INVALID', 'Write content must be a non-empty string.', 'VALIDATION');
      }
      const view = await resolveView(context);
      const policy = await resolveFilePolicy(context);
      const target = resolveTarget(view, filePath, 'write', policy.writeDirectories, new Set<string>());
      assertExtensionAllowed(target.modelPath, policy.writeAllowedExtensions, policy.writeDeniedExtensions);
      await assertPathHasNoLinks(target.root.physicalPath, target.relativePath, false);
      const existing = await loadExistingTarget(target.absolutePath);
      const generatedSkillWrite = detectGeneratedSkillManifestWrite(target.modelPath, content);
      const encoded = encodeText(content, existing?.decoded.encoding ?? 'UTF8');
      if (encoded.byteLength > policy.maxTextBytes) {
        throw safeFailure('CAPABILITY_INPUT_INVALID', `Write content must not exceed ${policy.maxTextBytes} UTF-8 bytes.`, 'VALIDATION');
      }
      const currentSnapshot = snapshots.get(context, target.modelPath);
      if (existing !== undefined) {
        if (currentSnapshot === undefined) {
          throw safeFailure(
            'WRITE_REQUIRES_FULL_READ',
            `File "${target.modelPath}" already exists. You must use the Read tool to read the entire file before overwriting it. Call Read with file_path="${target.modelPath}" (no offset/limit), then retry the Write.`,
            'CONFLICT',
          );
        }
        if (currentSnapshot.fingerprint !== fingerprint(existing.bytes, existing.mtimeMs, existing.mode)) {
          throw safeFailure(
            'WRITE_TARGET_CHANGED',
            `File "${target.modelPath}" changed after your last Read. Re-read the entire file before writing.`,
            'CONFLICT',
          );
        }
      } else if (currentSnapshot !== undefined) {
        throw safeFailure(
          'WRITE_TARGET_CHANGED',
          `File "${target.modelPath}" was deleted after your last Read. Re-read or verify the file before writing.`,
          'CONFLICT',
        );
      }

      const releaseWriteLock = await acquireWriteLock(writeLocks, target.absolutePath);
      try {
        throwIfAborted(signal);
        await mkdir(resolve(target.absolutePath, '..'), { recursive: true });
        const beforeWrite = await loadExistingTarget(target.absolutePath);
        if (!sameTarget(existing, beforeWrite)) {
          throw safeFailure('WRITE_TARGET_CHANGED', 'Write target changed before replacement.', 'CONFLICT');
        }
        await assertWritableTarget(target.absolutePath, beforeWrite !== undefined);
        const temporaryPath = `${target.absolutePath}.nextagent-${randomBytes(12).toString('hex')}.tmp`;
        try {
          const handle = await open(temporaryPath, 'wx', beforeWrite?.mode ?? 0o600);
          try {
            throwIfAborted(signal);
            await handle.writeFile(encoded);
            await handle.sync();
          } finally {
            await handle.close();
          }
          throwIfAborted(signal);
          if (beforeWrite === undefined) {
            await link(temporaryPath, target.absolutePath);
          } else {
            await rename(temporaryPath, target.absolutePath);
          }
        } catch (error) {
          if (isSafeErrorLike(error)) {
            throw error;
          }
          if (beforeWrite === undefined && isAlreadyExists(error)) {
            throw safeFailure('WRITE_TARGET_CHANGED', 'Write target changed before replacement.', 'CONFLICT');
          }
          throw safeFailure(
            'WRITE_ATOMIC_REPLACE_FAILED',
            'The atomic file replacement failed before commit. This write did not commit. Stop this action and report the error.',
            'INTERNAL',
          );
        } finally {
          await rm(temporaryPath, { force: true }).catch(() => undefined);
        }
        await updateCommittedSnapshot(snapshots, context, target.absolutePath, target.modelPath, encoded);
        return {
          type: existing === undefined ? 'create' : 'update',
          file_path: target.modelPath,
          ...(generatedSkillWrite === undefined
            ? {}
            : {
                generated_skill: {
                  capability_id: generatedSkillWrite.capabilityId,
                  ready: true,
                  next_skill_call: `Skill(name="${generatedSkillWrite.capabilityId}")`,
                },
              }),
        };
      } finally {
        releaseWriteLock();
      }
    },

    async editText(input: JsonObject, context: ToolExecutionContext, signal?: AbortSignal): Promise<JsonObject> {
      throwIfAborted(signal);
      const filePath = stringField(input, 'file_path');
      const oldString = input['old_string'];
      const newString = input['new_string'];
      const replaceAll = Boolean(input['replace_all']);
      if (filePath === undefined) {
        throw safeFailure('CAPABILITY_INPUT_INVALID', 'Edit file_path must be a non-empty string.', 'VALIDATION');
      }
      if (typeof oldString !== 'string' || oldString.length === 0) {
        throw safeFailure('CAPABILITY_INPUT_INVALID', 'Edit old_string must be a non-empty string.', 'VALIDATION');
      }
      if (typeof newString !== 'string') {
        throw safeFailure('CAPABILITY_INPUT_INVALID', 'Edit new_string must be a string.', 'VALIDATION');
      }
      if (oldString === newString) {
        throw safeFailure('CAPABILITY_INPUT_INVALID', 'Edit new_string must differ from old_string.', 'VALIDATION');
      }
      const view = await resolveView(context);
      const policy = await resolveFilePolicy(context);
      const target = resolveTarget(view, filePath, 'write', policy.writeDirectories, new Set<string>());
      assertExtensionAllowed(target.modelPath, policy.writeAllowedExtensions, policy.writeDeniedExtensions);
      await assertPathHasNoLinks(target.root.physicalPath, target.relativePath, false);
      const existing = await loadExistingTarget(target.absolutePath);
      if (existing === undefined) {
        throw safeFailure(
          'EDIT_TARGET_MISSING',
          'Edit target file does not exist. Locate the current target or use Write to create a new file.',
          'NOT_FOUND',
        );
      }
      const currentSnapshot = snapshots.get(context, target.modelPath);
      if (currentSnapshot === undefined) {
        throw safeFailure('EDIT_REQUIRES_FULL_READ', 'File requires a current full Read before editing.', 'CONFLICT');
      }
      if (currentSnapshot.fingerprint !== fingerprint(existing.bytes, existing.mtimeMs, existing.mode)) {
        throw safeFailure('EDIT_TARGET_CHANGED', 'Edit target changed after Read.', 'CONFLICT');
      }

      const content = existing.decoded.text;
      let matches = findAllMatches(content, oldString);
      if (matches.length === 0) {
        throw safeFailure(
          'EDIT_STRING_NOT_FOUND',
          'old_string was not found in the file. The file content may have changed or the string does not exist.',
          'VALIDATION',
        );
      }
      if (!replaceAll && matches.length > 1) {
        throw safeFailure(
          'EDIT_STRING_NOT_UNIQUE',
          'old_string is not unique in the file. Provide a larger string with more surrounding context or use replace_all.',
          'VALIDATION',
        );
      }

      const newContent = replaceMatches(content, matches, newString, replaceAll);
      const encoded = encodeText(newContent, existing.decoded.encoding ?? 'UTF8');
      if (encoded.byteLength > policy.maxTextBytes) {
        throw safeFailure('CAPABILITY_INPUT_INVALID', 'Edit result exceeds maximum text size.', 'VALIDATION');
      }

      const releaseWriteLock = await acquireWriteLock(writeLocks, target.absolutePath);
      try {
        throwIfAborted(signal);
        await mkdir(resolve(target.absolutePath, '..'), { recursive: true });
        const beforeWrite = await loadExistingTarget(target.absolutePath);
        if (!sameTarget(existing, beforeWrite)) {
          throw safeFailure('EDIT_TARGET_CHANGED', 'Edit target changed before replacement.', 'CONFLICT');
        }
        await assertWritableTarget(target.absolutePath, true);
        const temporaryPath = `${target.absolutePath}.nextagent-${randomBytes(12).toString('hex')}.tmp`;
        try {
          const handle = await open(temporaryPath, 'wx', beforeWrite?.mode ?? 0o600);
          try {
            throwIfAborted(signal);
            await handle.writeFile(encoded);
            await handle.sync();
          } finally {
            await handle.close();
          }
          throwIfAborted(signal);
          await rename(temporaryPath, target.absolutePath);
        } catch (error) {
          if (isSafeErrorLike(error)) {
            throw error;
          }
          throw safeFailure(
            'EDIT_ATOMIC_REPLACE_FAILED',
            'The atomic file replacement failed before commit. This edit did not commit. Stop this action and report the error.',
            'INTERNAL',
          );
        } finally {
          await rm(temporaryPath, { force: true }).catch(() => undefined);
        }
        await updateCommittedSnapshot(snapshots, context, target.absolutePath, target.modelPath, encoded);
        return {
          file_path: target.modelPath,
          type: 'update',
          old_string: oldString,
          new_string: newString,
          replaced_count: replaceAll ? matches.length : 1,
          replace_all: replaceAll,
        };
      } finally {
        releaseWriteLock();
      }
    },

    async globFiles(input: JsonObject, context: ToolExecutionContext, signal?: AbortSignal): Promise<JsonObject> {
      throwIfAborted(signal);
      const patternValue = stringField(input, 'pattern');
      const pathValue = input['path'];
      if (patternValue === undefined || patternValue.length > 4096) {
        throw safeFailure('CAPABILITY_INPUT_INVALID', 'Glob pattern must be a non-empty string of at most 4096 characters.', 'VALIDATION');
      }
      if (pathValue !== undefined && (typeof pathValue !== 'string' || pathValue.trim().length === 0 || pathValue.length > 4096)) {
        throw safeFailure('CAPABILITY_INPUT_INVALID', 'Glob path must be a non-empty string of at most 4096 characters when provided.', 'VALIDATION');
      }
      const view = await resolveView(context);
      const verifiedSkillRoots = await discoverVerifiedSkillRoots(view);
      const qualifiedSearch = pathValue === undefined ? splitRootQualifiedGlobPattern(patternValue, verifiedSkillRoots) : undefined;
      const pattern = normalizeAndValidateGlobPattern(qualifiedSearch?.pattern ?? patternValue);
      const matcher = picomatch(pattern, {
        dot: true,
        nocase: process.platform === 'win32',
        nonegate: true,
        noext: true,
        windows: true,
      });
      const policy = await resolveFilePolicy(context);
      const roots =
        pathValue === undefined
          ? qualifiedSearch === undefined
            ? resolveConfiguredSearchTargets(view, workspaceSearchDirectories(policy.readDirectories), verifiedSkillRoots)
            : resolveSearchTargets(view, qualifiedSearch.path, policy.readDirectories, verifiedSkillRoots)
          : resolveSearchTargets(view, pathValue, policy.readDirectories, verifiedSkillRoots);
      const matches = new Set<string>();
      let inspectedEntries = 0;
      let truncated = false;
      let scanLimitReached = false;
      try {
        for (const root of roots) {
          throwIfAborted(signal);
          if (root.root.kind !== 'systemResources') {
            await assertPathHasNoLinks(root.root.physicalPath, root.relativePath, true);
          }
          let rootStat;
          try {
            rootStat = await lstat(root.absolutePath);
          } catch (error) {
            if (root.skipIfMissing === true && isMissingPath(error)) {
              continue;
            }
            throw error;
          }
          if (rootStat.isSymbolicLink() || !rootStat.isDirectory()) {
            throw safeFailure('FILE_UNAVAILABLE', 'Search path is not a directory.', 'NOT_FOUND');
          }
          const pending: Array<{
            readonly absolutePath: string;
            readonly modelPrefix: string;
            readonly matchPrefix: string;
            readonly depth: number;
          }> = [{ absolutePath: root.absolutePath, modelPrefix: root.modelPath, matchPrefix: '', depth: 0 }];
          while (pending.length > 0 && inspectedEntries < policy.maxGlobInspectedEntries) {
            throwIfAborted(signal);
            const directory = pending.pop()!;
            const directoryStat = await lstat(directory.absolutePath);
            if (directoryStat.isSymbolicLink()) {
              continue;
            }
            if (!directoryStat.isDirectory()) {
              throw new Error('Glob traversal entry is no longer a directory.');
            }
            const boundedDirectory = await readBoundedDirectory(directory.absolutePath, policy.maxGlobInspectedEntries - inspectedEntries);
            const entries = boundedDirectory.entries.sort((left, right) => compareLexical(left.name, right.name));
            if (boundedDirectory.truncated) {
              truncated = true;
              scanLimitReached = true;
            }
            const childDirectories: typeof pending = [];
            for (const entry of entries) {
              inspectedEntries += 1;
              throwIfAborted(signal);
              const absolutePath = resolve(directory.absolutePath, entry.name);
              const modelPath = directory.modelPrefix.length === 0 ? entry.name : `${directory.modelPrefix}/${entry.name}`;
              const matchPath = directory.matchPrefix.length === 0 ? entry.name : `${directory.matchPrefix}/${entry.name}`;
              let entryStat;
              try {
                entryStat = await lstat(absolutePath);
              } catch (error) {
                if (isMissingPath(error)) {
                  continue;
                }
                throw error;
              }
              if (entryStat.isSymbolicLink()) {
                continue;
              }
              if (entryStat.isDirectory()) {
                if (directory.depth >= globMaxDepth) {
                  truncated = true;
                } else {
                  childDirectories.push({ absolutePath, modelPrefix: modelPath, matchPrefix: matchPath, depth: directory.depth + 1 });
                }
                continue;
              }
              if (
                !entryStat.isFile() ||
                !isExtensionAllowed(modelPath, policy.readAllowedExtensions, policy.readDeniedExtensions) ||
                !matcher(matchPath.replace(/^workspace\//u, ''))
              ) {
                continue;
              }
              matches.add(modelPath);
            }
            for (let index = childDirectories.length - 1; index >= 0; index -= 1) {
              pending.push(childDirectories[index]!);
            }
          }
          if (pending.length > 0) {
            truncated = true;
          }
          if (scanLimitReached) {
            break;
          }
        }
      } catch (error) {
        if (isSafeErrorLike(error)) {
          throw error;
        }
        if (isMissingPath(error)) {
          throw safeFailure('FILE_UNAVAILABLE', 'The requested search path does not exist.', 'NOT_FOUND');
        }
        throw safeFailure('CAPABILITY_EXECUTION_FAILED', 'The workspace file scan failed safely.', 'INTERNAL');
      }

      const filenames = [...matches].sort(compareLexical);
      if (filenames.length > globMaxResults) {
        truncated = true;
      }
      return { filenames: filenames.slice(0, globMaxResults), truncated };
    },

    async grepFiles(input: JsonObject, context: ToolExecutionContext, signal?: AbortSignal): Promise<JsonObject> {
      throwIfAborted(signal);
      const patternValue = stringField(input, 'pattern');
      const pathValue = input['path'];
      const globFilterValue = input['glob_filter'];
      const outputModeValue = input['output_mode'];
      const caseInsensitiveValue = input['case_insensitive'];
      const maxResultsValue = input['max_results'];
      if (patternValue === undefined || patternValue.length === 0 || patternValue.length > 4096) {
        throw safeFailure('CAPABILITY_INPUT_INVALID', 'Grep pattern must be a non-empty string of at most 4096 characters.', 'VALIDATION');
      }
      if (pathValue !== undefined && (typeof pathValue !== 'string' || pathValue.trim().length === 0 || pathValue.length > 4096)) {
        throw safeFailure('CAPABILITY_INPUT_INVALID', 'Grep path must be a non-empty string of at most 4096 characters when provided.', 'VALIDATION');
      }
      if (globFilterValue !== undefined && (typeof globFilterValue !== 'string' || globFilterValue.length === 0 || globFilterValue.length > 4096)) {
        throw safeFailure(
          'CAPABILITY_INPUT_INVALID',
          'Grep glob_filter must be a non-empty string of at most 4096 characters when provided.',
          'VALIDATION',
        );
      }
      if (outputModeValue !== undefined && outputModeValue !== 'files_with_matches' && outputModeValue !== 'content') {
        throw safeFailure('CAPABILITY_INPUT_INVALID', 'Grep output_mode must be either files_with_matches or content.', 'VALIDATION');
      }
      if (caseInsensitiveValue !== undefined && typeof caseInsensitiveValue !== 'boolean') {
        throw safeFailure('CAPABILITY_INPUT_INVALID', 'Grep case_insensitive must be a boolean when provided.', 'VALIDATION');
      }
      if (
        maxResultsValue !== undefined &&
        (!Number.isInteger(maxResultsValue) || (maxResultsValue as number) < 1 || (maxResultsValue as number) > grepMaxResults)
      ) {
        throw safeFailure('CAPABILITY_INPUT_INVALID', `Grep max_results must be an integer from 1 through ${grepMaxResults}.`, 'VALIDATION');
      }
      assertRegexSourceSafety(patternValue);
      const regex = compileGrepRegex(patternValue, Boolean(caseInsensitiveValue));
      const outputMode: 'files_with_matches' | 'content' = outputModeValue === 'content' ? 'content' : 'files_with_matches';
      const maxResults = (maxResultsValue as number | undefined) ?? grepDefaultMaxResults;
      const globMatcher = typeof globFilterValue === 'string' ? buildGlobFilterMatcher(globFilterValue) : undefined;
      const view = await resolveView(context);
      const verifiedSkillRoots = await discoverVerifiedSkillRoots(view);
      const policy = await resolveFilePolicy(context);
      const roots =
        pathValue === undefined
          ? resolveConfiguredSearchTargets(view, workspaceSearchDirectories(policy.readDirectories), verifiedSkillRoots)
          : resolveSearchTargets(view, pathValue, policy.readDirectories, verifiedSkillRoots);
      const matches: Array<{ readonly file_path: string; readonly line_number: number; readonly line: string }> = [];
      const matchedFiles = new Set<string>();
      let totalMatches = 0;
      let matchedLineCount = 0;
      let inspectedEntries = 0;
      let totalReadBytes = 0;
      let truncated = false;
      let scanLimitReached = false;
      let readBudgetReached = false;
      const utf8Decoder = new TextDecoder('utf-8', { fatal: false });
      try {
        for (const root of roots) {
          throwIfAborted(signal);
          if (root.root.kind !== 'systemResources') {
            await assertPathHasNoLinks(root.root.physicalPath, root.relativePath, true);
          }
          let rootStat;
          try {
            rootStat = await lstat(root.absolutePath);
          } catch (error) {
            if (root.skipIfMissing === true && isMissingPath(error)) {
              continue;
            }
            throw error;
          }
          if (rootStat.isSymbolicLink() || !rootStat.isDirectory()) {
            throw safeFailure('FILE_UNAVAILABLE', 'Search path is not a directory.', 'NOT_FOUND');
          }
          const pending: Array<{
            readonly absolutePath: string;
            readonly modelPrefix: string;
            readonly matchPrefix: string;
            readonly depth: number;
          }> = [{ absolutePath: root.absolutePath, modelPrefix: root.modelPath, matchPrefix: '', depth: 0 }];
          while (pending.length > 0 && inspectedEntries < policy.maxGlobInspectedEntries && !readBudgetReached) {
            throwIfAborted(signal);
            const directory = pending.pop()!;
            const directoryStat = await lstat(directory.absolutePath);
            if (directoryStat.isSymbolicLink()) {
              continue;
            }
            if (!directoryStat.isDirectory()) {
              throw new Error('Grep traversal entry is no longer a directory.');
            }
            const boundedDirectory = await readBoundedDirectory(directory.absolutePath, policy.maxGlobInspectedEntries - inspectedEntries);
            const entries = boundedDirectory.entries.sort((left, right) => compareLexical(left.name, right.name));
            if (boundedDirectory.truncated) {
              truncated = true;
              scanLimitReached = true;
            }
            const childDirectories: typeof pending = [];
            for (const entry of entries) {
              inspectedEntries += 1;
              throwIfAborted(signal);
              const absolutePath = resolve(directory.absolutePath, entry.name);
              const modelPath = directory.modelPrefix.length === 0 ? entry.name : `${directory.modelPrefix}/${entry.name}`;
              const matchPath = directory.matchPrefix.length === 0 ? entry.name : `${directory.matchPrefix}/${entry.name}`;
              let entryStat;
              try {
                entryStat = await lstat(absolutePath);
              } catch (error) {
                if (isMissingPath(error)) {
                  continue;
                }
                throw error;
              }
              if (entryStat.isSymbolicLink()) {
                continue;
              }
              if (entryStat.isDirectory()) {
                if (directory.depth >= grepMaxDepth) {
                  truncated = true;
                } else {
                  childDirectories.push({ absolutePath, modelPrefix: modelPath, matchPrefix: matchPath, depth: directory.depth + 1 });
                }
                continue;
              }
              if (!entryStat.isFile()) {
                continue;
              }
              if (!isExtensionAllowed(modelPath, policy.readAllowedExtensions, policy.readDeniedExtensions)) {
                continue;
              }
              const matchableRelativePath = matchPath.replace(/^workspace\//u, '');
              if (globMatcher !== undefined && !globMatcher(matchableRelativePath)) {
                continue;
              }
              const perFileBudget = Math.min(grepMaxReadBytesPerFile, Math.max(0, grepMaxTotalReadBytes - totalReadBytes));
              if (perFileBudget <= 0) {
                truncated = true;
                readBudgetReached = true;
                break;
              }
              const readSize = Math.min(perFileBudget, entryStat.size);
              if (readSize <= 0) {
                continue;
              }
              const buffer = Buffer.alloc(readSize);
              const fileHandle = await open(absolutePath, 'r');
              let bytesRead = 0;
              try {
                while (bytesRead < readSize) {
                  const chunk = await fileHandle.read(buffer, bytesRead, readSize - bytesRead, bytesRead);
                  if (chunk.bytesRead === 0) {
                    break;
                  }
                  bytesRead += chunk.bytesRead;
                }
              } finally {
                await fileHandle.close().catch(() => undefined);
              }
              totalReadBytes += bytesRead;
              if (containsNulByte(buffer.subarray(0, Math.min(bytesRead, grepBinaryScanWindow)))) {
                continue;
              }
              if (entryStat.size > bytesRead) {
                truncated = true;
              }
              const text = stripBom(utf8Decoder.decode(buffer.subarray(0, bytesRead)));
              const lines = text.split(/\r?\n/u);
              let lineNumber = 0;
              for (const rawLine of lines) {
                lineNumber += 1;
                if (rawLine.length === 0) {
                  continue;
                }
                const lineMatches = countRegexMatches(rawLine, regex);
                if (lineMatches === 0) {
                  continue;
                }
                const line = rawLine.length > grepMaxLineCodeUnits ? rawLine.slice(0, grepMaxLineCodeUnits) : rawLine;
                totalMatches += lineMatches;
                matchedFiles.add(modelPath);
                if (rawLine.length > grepMaxLineCodeUnits) {
                  truncated = true;
                }
                if (outputMode === 'content') {
                  matchedLineCount += 1;
                  insertSortedCapped(matches, { file_path: modelPath, line_number: lineNumber, line }, compareGrepMatch, maxResults);
                }
              }
              if (readBudgetReached) {
                break;
              }
              if (totalReadBytes >= grepMaxTotalReadBytes) {
                truncated = true;
                readBudgetReached = true;
                break;
              }
            }
            for (let index = childDirectories.length - 1; index >= 0; index -= 1) {
              pending.push(childDirectories[index]!);
            }
            if (readBudgetReached) {
              break;
            }
          }
          if (pending.length > 0) {
            truncated = true;
          }
          if (scanLimitReached || readBudgetReached) {
            break;
          }
        }
      } catch (error) {
        if (isSafeErrorLike(error)) {
          throw error;
        }
        if (isMissingPath(error)) {
          throw safeFailure('FILE_UNAVAILABLE', 'The requested search path does not exist.', 'NOT_FOUND');
        }
        throw safeFailure('CAPABILITY_EXECUTION_FAILED', 'The workspace content search failed safely.', 'INTERNAL');
      }

      const sortedFilenames = outputMode === 'files_with_matches' ? [...matchedFiles].sort(compareLexical).slice(0, maxResults) : [];
      const sortedMatches = outputMode === 'content' ? matches : [];
      if (outputMode === 'files_with_matches' && matchedFiles.size > sortedFilenames.length) {
        truncated = true;
      }
      if (outputMode === 'content' && matchedLineCount > sortedMatches.length) {
        truncated = true;
      }
      return {
        output_mode: outputMode,
        filenames: sortedFilenames,
        matches: sortedMatches,
        total_files_with_matches: matchedFiles.size,
        total_matches: totalMatches,
        truncated,
      };
    },

    clearRun(context): void {
      snapshots.clearRun(context);
    },
  };
}

function extensionPolicyFromOptions(options: WorkspaceFileExtensionPolicy): WorkspaceFileExtensionPolicy {
  return {
    ...(options.readAllowedExtensions === undefined ? {} : { readAllowedExtensions: options.readAllowedExtensions }),
    ...(options.readDeniedExtensions === undefined ? {} : { readDeniedExtensions: options.readDeniedExtensions }),
    ...(options.writeAllowedExtensions === undefined ? {} : { writeAllowedExtensions: options.writeAllowedExtensions }),
    ...(options.writeDeniedExtensions === undefined ? {} : { writeDeniedExtensions: options.writeDeniedExtensions }),
  };
}

function resolveReadSingleCallTextBudget(modelPath: string, configuredMaxTextBytes: number): number {
  if (isToolResultReadbackPath(modelPath)) {
    return Math.min(configuredMaxTextBytes, toolResultReadbackMaxTextBytes);
  }
  return configuredMaxTextBytes;
}

function isToolResultReadbackPath(modelPath: string): boolean {
  return modelPath.startsWith('tool-results/') || modelPath.startsWith('workspace/tool-results/');
}

function isModelVisibleSkillResourcePath(modelPath: string): boolean {
  if (!modelPath.startsWith('.nextagent/skills/')) {
    return false;
  }
  const segments = modelPath.split('/');
  return (
    segments.length >= 5 &&
    segments[2] !== '.locks' &&
    segments[2] !== '.staging' &&
    segments[3] !== '.projection.json' &&
    segments[4] !== '.projection.json'
  );
}

function skillRootFromModelPath(modelPath: string):
  | {
      readonly rootRelativePath: string;
      readonly skillProjectionKey: string;
      readonly skillName: string;
    }
  | undefined {
  const segments = modelPath.split('/');
  if (
    segments.length < 4 ||
    segments[0] !== '.nextagent' ||
    segments[1] !== 'skills' ||
    !/^[a-f0-9]{16}$/u.test(segments[2]!) ||
    !isSafeProjectionDirectoryName(segments[3]!)
  ) {
    return undefined;
  }
  return {
    rootRelativePath: segments.slice(0, 4).join('/'),
    skillProjectionKey: segments[2]!,
    skillName: segments[3]!,
  };
}

function parseSkillRootRelativePath(rootRelativePath: string):
  | {
      readonly skillProjectionKey: string;
      readonly skillName: string;
    }
  | undefined {
  const parsed = skillRootFromModelPath(rootRelativePath);
  if (parsed === undefined || parsed.rootRelativePath !== rootRelativePath) {
    return undefined;
  }
  return {
    skillProjectionKey: parsed.skillProjectionKey,
    skillName: parsed.skillName,
  };
}

function parseSkillRelativeResourcePath(value: string): { readonly skillName?: string; readonly resourcePath: string } | undefined {
  if (value.length === 0 || value.includes('\\') || isAbsolute(value) || hasForbiddenPathSyntax(value)) {
    return undefined;
  }
  const segments = value.split('/');
  if (segments.some((segment) => segment.length === 0 || segment === '.' || segment === '..')) {
    return undefined;
  }
  if (segments[0] === 'scripts' && segments.length >= 2) {
    return { resourcePath: value };
  }
  if (segments.length >= 3 && isSafeProjectionDirectoryName(segments[0]!) && segments[1] === 'scripts') {
    return { skillName: segments[0]!, resourcePath: segments.slice(1).join('/') };
  }
  return undefined;
}

async function readProjectionManifest(manifestPath: string): Promise<ProjectionManifest | undefined> {
  try {
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as Partial<ProjectionManifest>;
    if (manifest.schemaVersion !== projectionManifestVersion || !Array.isArray(manifest.resources)) {
      return undefined;
    }
    return manifest as ProjectionManifest;
  } catch {
    return undefined;
  }
}

function isSafeProjectionDirectoryName(value: string): boolean {
  return (
    value.length > 0 &&
    value !== '.' &&
    value !== '..' &&
    value !== '.projection.json' &&
    !value.includes('/') &&
    !value.includes('\\') &&
    !hasForbiddenPathSyntax(value) &&
    !/[\u0000-\u001f]/u.test(value)
  );
}

function cacheHasProjectionKey(cache: ReadonlyMap<string, string>, skillProjectionKey: string): boolean {
  for (const rootRelativePath of cache.keys()) {
    if (parseSkillRootRelativePath(rootRelativePath)?.skillProjectionKey === skillProjectionKey) {
      return true;
    }
  }
  return false;
}

async function assertPathHasNoLinks(root: string, relativePath: string, targetMustExist: boolean): Promise<void> {
  const segments = relativePath === '.' ? [] : relativePath.split('/');
  let current = resolve(root);
  for (let index = 0; index < segments.length; index += 1) {
    current = resolve(current, segments[index]!);
    try {
      const item = await lstat(current);
      if (item.isSymbolicLink()) {
        throw safeFailure('CAPABILITY_PATH_REJECTED', 'File path contains an unsafe link.', 'AUTHORIZATION');
      }
    } catch (error) {
      if (isMissingPath(error) && (!targetMustExist || index < segments.length - 1)) {
        continue;
      }
      throw error;
    }
  }
}

async function readBoundedDirectory(
  absolutePath: string,
  remainingEntries: number,
): Promise<{ readonly entries: Dirent[]; readonly truncated: boolean }> {
  const directory = await opendir(absolutePath);
  const entries: Dirent[] = [];
  try {
    while (entries.length < remainingEntries) {
      const entry = await directory.read();
      if (entry === null) {
        return { entries, truncated: false };
      }
      entries.push(entry);
    }
    return { entries, truncated: (await directory.read()) !== null };
  } finally {
    await directory.close().catch(() => undefined);
  }
}

function compareLexical(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function normalizeAndValidateGlobPattern(value: string): string {
  const pattern = value.replaceAll('\\', '/');
  if (
    pattern.trim().length === 0 ||
    pattern.startsWith('/') ||
    pattern.startsWith('!') ||
    /^[A-Za-z]:/u.test(pattern) ||
    /[\u0000-\u001f]/u.test(pattern) ||
    /(^|\/)\.\.(\/|$)/u.test(pattern) ||
    /(?:^|[^\\])[!+@?*]\(/u.test(pattern)
  ) {
    throw safeFailure(
      'CAPABILITY_INPUT_INVALID',
      'Glob pattern must be relative, must not traverse parent directories, and must not use extglob syntax.',
      'VALIDATION',
    );
  }
  assertGlobStructures(pattern);
  try {
    const compiledPattern = pattern.replace(/\[!([^\]]+)\]/gu, '[^$1]');
    picomatch.makeRe(compiledPattern, { nonegate: true, noext: true });
    return compiledPattern;
  } catch {
    throw safeFailure('CAPABILITY_INPUT_INVALID', 'Glob pattern syntax is invalid.', 'VALIDATION');
  }
}

function splitRootQualifiedGlobPattern(
  value: string,
  verifiedSkillRoots?: ReadonlySet<string>,
): { readonly path: string; readonly pattern: string } | undefined {
  const pattern = value.replaceAll('\\', '/');
  const skillRoot = longestSkillRootPrefix(pattern, verifiedSkillRoots);
  if (skillRoot !== undefined) {
    return splitQualifiedPattern(pattern, skillRoot);
  }
  for (const root of ['workspace', '.nextagent', 'temp', 'generated-skills', 'shared-data'] as const) {
    if (pattern === root) {
      return { path: root, pattern: '*' };
    }
    if (pattern.startsWith(`${root}/`)) {
      const suffix = pattern.slice(root.length + 1);
      const split = splitGlobSuffix(root, suffix);
      return split ?? splitQualifiedPattern(pattern, root);
    }
  }
  return undefined;
}

function longestSkillRootPrefix(pattern: string, verifiedSkillRoots?: ReadonlySet<string>): string | undefined {
  if (verifiedSkillRoots === undefined || !pattern.startsWith('.nextagent/skills/')) {
    return undefined;
  }
  return [...verifiedSkillRoots]
    .filter((root) => pattern === root || pattern.startsWith(`${root}/`))
    .sort((left, right) => right.length - left.length || compareLexical(left, right))[0];
}

function splitQualifiedPattern(pattern: string, root: string): { readonly path: string; readonly pattern: string } {
  if (pattern === root) {
    return { path: root, pattern: '*' };
  }
  const suffix = pattern.slice(root.length + 1);
  if (suffix.length === 0) {
    return { path: root, pattern: '*' };
  }
  return { path: root, pattern: suffix.endsWith('/') ? `${suffix}*` : suffix };
}

function splitGlobSuffix(root: string, suffix: string): { readonly path: string; readonly pattern: string } | undefined {
  const segments = suffix.split('/').filter((segment) => segment.length > 0);
  const firstGlobSegmentIndex = segments.findIndex((segment) => hasGlobSyntax(segment));
  if (firstGlobSegmentIndex <= 0) {
    return undefined;
  }
  return {
    path: [root, ...segments.slice(0, firstGlobSegmentIndex)].join('/'),
    pattern: segments.slice(firstGlobSegmentIndex).join('/'),
  };
}

function hasGlobSyntax(segment: string): boolean {
  return /[*?[\]{}]/u.test(segment);
}

function assertGlobStructures(pattern: string): void {
  let combinations = 1;
  let braceStart = -1;
  let bracketStart = -1;
  for (let index = 0; index < pattern.length; index += 1) {
    const character = pattern[index]!;
    if (character === '{') {
      if (braceStart !== -1) {
        throw safeFailure('CAPABILITY_INPUT_INVALID', 'Glob pattern cannot contain nested braces.', 'VALIDATION');
      }
      braceStart = index;
    } else if (character === '}') {
      if (braceStart === -1) {
        throw safeFailure('CAPABILITY_INPUT_INVALID', 'Glob pattern contains an unmatched closing brace.', 'VALIDATION');
      }
      const alternatives = pattern.slice(braceStart + 1, index).split(',');
      if (alternatives.length < 2 || alternatives.length > globMaxBraceAlternatives || alternatives.some((alternative) => alternative.length === 0)) {
        throw safeFailure(
          'CAPABILITY_INPUT_INVALID',
          `Glob brace groups must contain from 2 through ${globMaxBraceAlternatives} non-empty alternatives.`,
          'VALIDATION',
        );
      }
      combinations *= alternatives.length;
      if (combinations > globMaxBraceCombinations) {
        throw safeFailure('CAPABILITY_INPUT_INVALID', `Glob brace expansion must not exceed ${globMaxBraceCombinations} combinations.`, 'VALIDATION');
      }
      braceStart = -1;
    } else if (character === '[') {
      if (bracketStart !== -1) {
        throw safeFailure('CAPABILITY_INPUT_INVALID', 'Glob pattern cannot contain nested character classes.', 'VALIDATION');
      }
      bracketStart = index;
    } else if (character === ']') {
      if (bracketStart === -1 || index === bracketStart + 1) {
        throw safeFailure('CAPABILITY_INPUT_INVALID', 'Glob character class is empty or has an unmatched closing bracket.', 'VALIDATION');
      }
      bracketStart = -1;
    }
  }
  if (braceStart !== -1 || bracketStart !== -1) {
    throw safeFailure('CAPABILITY_INPUT_INVALID', 'Glob pattern contains an unclosed brace or character class.', 'VALIDATION');
  }
}

async function acquireWriteLock(locks: Map<string, Promise<void>>, key: string): Promise<() => void> {
  const previous = locks.get(key) ?? Promise.resolve();
  let releaseCurrent!: () => void;
  const current = new Promise<void>((resolveCurrent) => {
    releaseCurrent = resolveCurrent;
  });
  const queue = previous.then(() => current);
  locks.set(key, queue);
  await previous;
  return () => {
    releaseCurrent();
    if (locks.get(key) === queue) {
      locks.delete(key);
    }
  };
}

async function loadExistingTarget(path: string): Promise<ExistingTarget | undefined> {
  try {
    const fileStat = await lstat(path);
    if (fileStat.isSymbolicLink() || !fileStat.isFile() || fileStat.nlink > 1) {
      throw safeFailure('CAPABILITY_PATH_REJECTED', 'File path is not an allowed regular file.', 'AUTHORIZATION');
    }
    const bytes = await readFile(path);
    return { bytes, decoded: decodeText(bytes), mtimeMs: fileStat.mtimeMs, mode: fileStat.mode };
  } catch (error) {
    if (isMissingPath(error)) {
      return undefined;
    }
    throw error;
  }
}

async function projectionCommitted(manifestPath: string, targetRoot: string, expected: ProjectionIdentity): Promise<ProjectionManifest | undefined> {
  try {
    const targetStat = await lstat(targetRoot);
    if (targetStat.isSymbolicLink() || !targetStat.isDirectory()) {
      return undefined;
    }
    const rawManifest = await readFile(manifestPath, 'utf8');
    const manifest = JSON.parse(rawManifest) as Partial<ProjectionManifest>;
    if (
      manifest.schemaVersion === expected.schemaVersion &&
      manifest.providerId === expected.providerId &&
      manifest.skillName === expected.skillName &&
      manifest.skillVersion === expected.skillVersion &&
      typeof manifest.resourceCount === 'number' &&
      Number.isInteger(manifest.resourceCount) &&
      manifest.resourceCount >= 0 &&
      Array.isArray(manifest.resources) &&
      manifest.resources.length === manifest.resourceCount &&
      manifest.resources.every(isProjectionManifestResource)
    ) {
      await verifyProjectionTree(targetRoot, manifest.resources);
      await reconcileProjectionModes(targetRoot, manifest.resources);
      return manifest as ProjectionManifest;
    }
    return undefined;
  } catch {
    return undefined;
  }
}

function isProjectionManifestResource(resource: unknown): resource is ProjectionManifestResource {
  if (typeof resource !== 'object' || resource === null) {
    return false;
  }
  const value = resource as Partial<ProjectionManifestResource>;
  return (
    typeof value.relativePath === 'string' &&
    isSafeProjectionRelativePath(value.relativePath) &&
    (value.kind === 'script' || value.kind === 'reference' || value.kind === 'asset') &&
    typeof value.sizeBytes === 'number' &&
    Number.isInteger(value.sizeBytes) &&
    value.sizeBytes >= 0 &&
    typeof value.sha256 === 'string' &&
    /^[a-f0-9]{64}$/u.test(value.sha256)
  );
}

async function reconcileProjectionModes(targetRoot: string, resources: readonly ProjectionManifestResource[]): Promise<void> {
  for (const resource of resources) {
    const target = resolve(targetRoot, resource.relativePath);
    assertContained(targetRoot, target);
    const item = await lstat(target);
    if (item.isSymbolicLink() || !item.isFile() || item.nlink > 1 || item.size !== resource.sizeBytes) {
      throw safeFailure('CAPABILITY_PATH_REJECTED', 'Skill resource projection verification failed.', 'CONFLICT');
    }
    if ((item.mode & 0o777) !== projectionFileMode(resource.kind)) {
      await chmod(target, projectionFileMode(resource.kind));
    }
  }
}

function sameProjectionResource(
  expected: {
    readonly relativePath: string;
    readonly kind: 'script' | 'reference' | 'asset';
    readonly sizeBytes: number;
    readonly contentHash?: string;
  },
  actual: {
    readonly relativePath: string;
    readonly kind: 'script' | 'reference' | 'asset';
    readonly sizeBytes: number;
    readonly contentHash?: string;
  },
): boolean {
  return (
    actual.relativePath.replaceAll('\\', '/') === expected.relativePath &&
    actual.kind === expected.kind &&
    actual.sizeBytes === expected.sizeBytes &&
    (expected.contentHash === undefined || actual.contentHash === expected.contentHash)
  );
}

async function writeProjectionStream(
  target: string,
  entry: SkillResourceProjectionEntry,
  signal?: AbortSignal,
): Promise<{ readonly sizeBytes: number; readonly sha256: string }> {
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  const hash = createHash('sha256');
  let sizeBytes = 0;
  try {
    handle = await open(target, 'w');
    for await (const chunk of entry.contentStream) {
      throwIfAborted(signal);
      sizeBytes += chunk.byteLength;
      if (sizeBytes > entry.sizeBytes) {
        throw projectionSafeFailure('CAPABILITY_PATH_REJECTED', 'Skill resource projection source no longer matches.', 'CONFLICT', {
          failureStage: 'STAGING_WRITE',
          failureReasonCode: 'SKILL_PROJECTION_SOURCE_CHANGED',
          sizeBytes,
          expectedSizeBytes: entry.sizeBytes,
        });
      }
      hash.update(chunk);
      await handle.write(chunk);
    }
    const sha256 = hash.digest('hex');
    if (sizeBytes !== entry.sizeBytes || (entry.contentHash !== undefined && entry.contentHash !== sha256)) {
      throw projectionSafeFailure('CAPABILITY_PATH_REJECTED', 'Skill resource projection source no longer matches.', 'CONFLICT', {
        failureStage: 'STAGING_WRITE',
        failureReasonCode: 'SKILL_PROJECTION_SOURCE_CHANGED',
        sizeBytes,
        expectedSizeBytes: entry.sizeBytes,
      });
    }
    await chmod(target, projectionFileMode(entry.kind));
    return { sizeBytes, sha256 };
  } catch (error) {
    if (isAbortError(error) || isSafeFailure(error)) {
      throw error;
    }
    throw projectionSafeFailure('CAPABILITY_PATH_REJECTED', 'Skill resource projection source no longer matches.', 'CONFLICT', {
      failureStage: 'STAGING_WRITE',
      failureReasonCode: 'SKILL_PROJECTION_SOURCE_CHANGED',
    });
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

function projectionFileMode(kind: SkillResourceProjectionEntry['kind']): number {
  return kind === 'script' ? 0o750 : 0o640;
}

async function restoreWritableForRemoval(root: string): Promise<void> {
  try {
    const entries = await readdir(root);
    for (const entry of entries) {
      const target = resolve(root, entry);
      const item = await lstat(target);
      if (item.isDirectory() && !item.isSymbolicLink()) {
        await restoreWritableForRemoval(target);
      }
    }
    await chmod(root, 0o750).catch(() => undefined);
  } catch (error) {
    if (!isMissingPath(error)) {
      throw error;
    }
  }
}

function isAbortError(error: unknown): boolean {
  return (error instanceof DOMException && error.name === 'AbortError') || (error instanceof Error && error.name === 'AbortError');
}

function isSafeFailure(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && 'category' in error;
}

function projectionSafeFailure(code: string, message: string, category: 'CONFLICT' | 'VALIDATION', safeDetails: JsonObject): SafeError {
  return { ...safeFailure(code, message, category), safeDetails };
}

function projectionVerificationFailure(): SafeError {
  return projectionSafeFailure('CAPABILITY_PATH_REJECTED', 'Skill resource projection verification failed.', 'CONFLICT', {
    failureStage: 'STAGING_VERIFY',
    failureReasonCode: 'SKILL_PROJECTION_VERIFY_FAILED',
  });
}

async function verifyProjectionTree(root: string, plan: readonly ProjectionPlanEntry[]): Promise<void> {
  const expectedPaths = new Set(plan.map((entry) => entry.relativePath));
  for (const entry of plan) {
    const target = resolve(root, entry.relativePath);
    assertContained(root, target);
    const item = await lstat(target);
    if (item.isSymbolicLink() || !item.isFile() || item.nlink > 1 || item.size !== entry.sizeBytes) {
      throw projectionVerificationFailure();
    }
    const actualHash = createHash('sha256')
      .update(await readFile(target))
      .digest('hex');
    if (actualHash !== entry.sha256) {
      throw projectionVerificationFailure();
    }
  }
  const actualPaths = await listProjectionFiles(root);
  if (actualPaths.length !== expectedPaths.size || actualPaths.some((path) => !expectedPaths.has(path))) {
    throw projectionVerificationFailure();
  }
}

async function listProjectionFiles(root: string): Promise<readonly string[]> {
  const files: string[] = [];
  const pending: Array<{ readonly absolutePath: string; readonly relativePath: string }> = [{ absolutePath: root, relativePath: '' }];
  while (pending.length > 0) {
    const current = pending.pop()!;
    const entries = await readBoundedDirectory(current.absolutePath, maxProjectionFiles + 1);
    if (entries.truncated || entries.entries.length > maxProjectionFiles) {
      throw projectionSafeFailure('RESOURCE_TOO_LARGE', 'Skill resource projection exceeds the file count limit.', 'VALIDATION', {
        failureStage: 'STAGING_VERIFY',
        failureReasonCode: 'SKILL_PROJECTION_RESOURCE_COUNT_LIMIT',
        resourceCount: entries.entries.length,
        maxResourceCount: maxProjectionFiles,
      });
    }
    for (const entry of entries.entries) {
      const absolutePath = resolve(current.absolutePath, entry.name);
      const relativePath = current.relativePath.length === 0 ? entry.name : `${current.relativePath}/${entry.name}`;
      const item = await lstat(absolutePath);
      if (item.isSymbolicLink()) {
        throw projectionVerificationFailure();
      }
      if (item.isDirectory()) {
        pending.push({ absolutePath, relativePath });
      } else if (item.isFile()) {
        if (item.nlink > 1) {
          throw projectionVerificationFailure();
        }
        files.push(relativePath);
      } else {
        throw projectionVerificationFailure();
      }
    }
  }
  return files.sort(compareLexical);
}

async function acquireProjectionLock(
  lockRoot: string,
  manifestPath: string,
  targetRoot: string,
  identity: ProjectionIdentity,
  signal?: AbortSignal,
): Promise<
  | { readonly status: 'acquired'; readonly observedContention: boolean }
  | { readonly status: 'reused'; readonly manifest: ProjectionManifest }
  | { readonly status: 'timeout' }
> {
  const startedAt = Date.now();
  let observedContention = false;
  await mkdir(resolve(lockRoot, '..'), { recursive: true });
  while (true) {
    throwIfAborted(signal);
    try {
      await mkdir(lockRoot);
      return { status: 'acquired', observedContention };
    } catch (error) {
      if (!isAlreadyExists(error)) {
        throw error;
      }
      observedContention = true;
      const committed = await projectionCommitted(manifestPath, targetRoot, identity);
      if (committed !== undefined) {
        return { status: 'reused', manifest: committed };
      }
      if (Date.now() - startedAt >= projectionLockWaitMs) {
        return { status: 'timeout' };
      }
      await sleep(projectionLockPollMs, signal);
    }
  }
}

async function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  let abort: (() => void) | undefined;
  await new Promise<void>((resolveSleep, reject) => {
    const timer = setTimeout(resolveSleep, ms);
    abort = () => {
      clearTimeout(timer);
      reject(safeFailure('CAPABILITY_ABORTED', 'Capability invocation was aborted.', 'CANCELED'));
    };
    signal?.addEventListener('abort', abort, { once: true });
  }).finally(() => {
    if (abort !== undefined) {
      signal?.removeEventListener('abort', abort);
    }
  });
}

function sameTarget(first?: ExistingTarget, second?: ExistingTarget): boolean {
  if (first === undefined || second === undefined) {
    return first === second;
  }
  return fingerprint(first.bytes, first.mtimeMs, first.mode) === fingerprint(second.bytes, second.mtimeMs, second.mode);
}

async function assertWritableTarget(path: string, exists: boolean): Promise<void> {
  try {
    await access(exists ? path : resolve(path, '..'), constants.W_OK);
  } catch {
    throw safeFailure('CAPABILITY_PATH_REJECTED', 'File path is not writable.', 'AUTHORIZATION');
  }
}

function assertMaxTextBytes(value: number): void {
  if (!Number.isInteger(value) || value < 1 || value > defaultMaxTextBytes) {
    throw new Error('maxTextBytes must be an integer from 1 through 256000.');
  }
}

function assertMaxGlobInspectedEntries(value: number): void {
  if (!Number.isInteger(value) || value < 1 || value > globMaxInspectedEntries) {
    throw new Error('maxGlobInspectedEntries must be an integer from 1 through 20000.');
  }
}

function resolveWorkspaceFilePolicy(options: WorkspaceFilePolicyOptions): ResolvedWorkspaceFilePolicy {
  const maxLines = options.maxLines ?? 2000;
  const maxTextBytes = options.maxTextBytes ?? options.maxOutputBytes ?? defaultMaxTextBytes;
  const maxGlobInspectedEntries = options.maxGlobInspectedEntries ?? globMaxInspectedEntries;
  assertMaxTextBytes(maxTextBytes);
  assertMaxGlobInspectedEntries(maxGlobInspectedEntries);
  const writeDirectories = mergeDirectories(
    ['workspace', 'generated-skills', 'temp'],
    canonicalizeConfiguredDirectories(options.writeDirectories ?? []),
  );
  const readDirectories =
    options.readDirectories === undefined
      ? mergeDirectories(['workspace'], writeDirectories)
      : mergeDirectories(canonicalizeConfiguredDirectories(options.readDirectories), writeDirectories);
  return {
    maxLines,
    maxTextBytes,
    maxGlobInspectedEntries,
    readDirectories,
    writeDirectories,
    ...(options.readAllowedExtensions === undefined ? {} : { readAllowedExtensions: new Set(options.readAllowedExtensions) }),
    readDeniedExtensions: new Set(options.readDeniedExtensions ?? []),
    ...(options.writeAllowedExtensions === undefined ? {} : { writeAllowedExtensions: new Set(options.writeAllowedExtensions) }),
    writeDeniedExtensions: new Set(options.writeDeniedExtensions ?? []),
  };
}

function canonicalizeConfiguredDirectories(directories: readonly string[]): readonly string[] {
  return mergeDirectories(
    directories.map((directory) => {
      const normalizedDirectory = normalizeConfiguredDirectories('/', [directory])[0];
      const canonical = normalizedDirectory === undefined ? undefined : normalizeModelPath(normalizedDirectory);
      if (canonical === undefined) {
        throw new Error('Workspace file directory is outside the authorized execution roots.');
      }
      return canonical.modelPath;
    }),
    [],
  );
}

function workspaceSearchDirectories(directories: readonly string[]): readonly string[] {
  return directories.filter((directory) => directory === 'workspace' || directory.startsWith('workspace/'));
}

function isExtensionAllowed(modelPath: string, allowedExtensions: ReadonlySet<string> | undefined, deniedExtensions: ReadonlySet<string>): boolean {
  const extension = extname(modelPath).toLowerCase();
  const finalExtension = extension === '.' ? '' : extension;
  return !deniedExtensions.has(finalExtension) && (allowedExtensions === undefined || allowedExtensions.has(finalExtension));
}

function assertExtensionAllowed(modelPath: string, allowedExtensions: ReadonlySet<string> | undefined, deniedExtensions: ReadonlySet<string>): void {
  if (!isExtensionAllowed(modelPath, allowedExtensions, deniedExtensions)) {
    throw recoverableExtensionPolicyFailure();
  }
}

function recoverableExtensionPolicyFailure() {
  return safeFailure('CAPABILITY_PATH_REJECTED', 'File extension is not allowed by Agent workspace policy.', 'AUTHORIZATION');
}

async function updateCommittedSnapshot(
  snapshots: FileSnapshotStore,
  context: ToolExecutionContext,
  absolutePath: string,
  modelPath: string,
  content: Uint8Array,
): Promise<void> {
  try {
    const finalStat = await stat(absolutePath);
    snapshots.set(context, modelPath, fingerprint(content, finalStat.mtimeMs, finalStat.mode));
  } catch {
    snapshots.delete(context, modelPath);
  }
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw safeFailure('CAPABILITY_ABORTED', 'Capability invocation was aborted.', 'CANCELED');
  }
}

function isSafeErrorLike(value: unknown): value is NonNullable<ReturnType<typeof failed>['safeError']> {
  return value !== null && value !== undefined && typeof value === 'object' && 'code' in value && 'category' in value;
}

function deriveSkillProjectionKey(providerId: string, skillName: string, skillVersion: string): string {
  return createHash('sha256')
    .update(skillProjectionNamespace)
    .update('\0')
    .update(providerId)
    .update('\0')
    .update(skillName)
    .update('\0')
    .update(skillVersion)
    .digest('hex')
    .slice(0, 16);
}

function detectGeneratedSkillManifestWrite(modelPath: string, content: string): { readonly capabilityId: string } | undefined {
  const match = /^generated-skills\/([a-z0-9]+(?:-[a-z0-9]+)*)\/SKILL\.md$/u.exec(modelPath);
  if (match === null) {
    return undefined;
  }
  const directoryName = match[1]!;
  const frontmatterMatch = /^---\r?\n([\s\S]*?)\r?\n---/u.exec(content);
  if (frontmatterMatch === null) {
    return undefined;
  }
  const frontmatter = frontmatterMatch[1]!;
  const nameMatch = /(^|\r?\n)name:[ \t]*([^\r\n#]+?)[ \t]*(?=\r?\n|$)/u.exec(frontmatter);
  if (nameMatch === null) {
    return undefined;
  }
  const capabilityId = nameMatch[2]!.trim();
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(capabilityId) || capabilityId !== directoryName) {
    return undefined;
  }
  return {
    capabilityId,
  };
}

function isSafeProjectionRelativePath(relativePath: string): boolean {
  const path = relativePath.replaceAll('\\', '/');
  if (path.length === 0 || path.startsWith('/') || isAbsolute(path) || /^[A-Za-z]:/u.test(path) || /^[a-z][a-z0-9+.-]*:/iu.test(path)) {
    return false;
  }
  const segments = path.split('/');
  if (segments.some((segment) => segment.length === 0 || segment === '.' || segment === '..' || segment === 'node_modules')) {
    return false;
  }
  if (
    segments.some((segment, index) => segment === '.npm' || segment === '.pnpm-store' || (segment === '.yarn' && segments[index + 1] === 'cache'))
  ) {
    return false;
  }
  if (hasForbiddenDirectorySyntax(path)) {
    return false;
  }
  return true;
}

interface StringMatch {
  readonly start: number;
  readonly end: number;
}

const maxGrepRegexSourceLength = 1024;
const nestedRegexQuantifierPattern = /\((?:[^()\\]|\\.|\[[^\]]*\])*[*+](?:[^()\\]|\\.|\[[^\]]*\])*\)\s*(?:[*+]|\{\d+(?:,\d*)?\})/u;

function findAllMatches(content: string, needle: string): readonly StringMatch[] {
  const matches: StringMatch[] = [];
  let offset = 0;
  while (offset < content.length) {
    const index = content.indexOf(needle, offset);
    if (index === -1) {
      break;
    }
    matches.push({ start: index, end: index + needle.length });
    offset = index + 1;
  }
  return matches;
}

function replaceMatches(content: string, matches: readonly StringMatch[], newString: string, replaceAll: boolean): string {
  const selected = replaceAll ? matches : [matches[0]!];
  let result = '';
  let cursor = 0;
  for (const match of selected) {
    result += content.slice(cursor, match.start);
    result += newString;
    cursor = match.end;
  }
  result += content.slice(cursor);
  return result;
}

function compileGrepRegex(source: string, caseInsensitive: boolean): RegExp {
  try {
    assertSafeRegexSource(source);
    return new RegExp(source, `g${caseInsensitive ? 'i' : ''}`);
  } catch {
    throw safeFailure('CAPABILITY_INPUT_INVALID', 'Grep pattern must be a valid bounded regular expression.', 'VALIDATION');
  }
}

function assertSafeRegexSource(source: string): void {
  if (source.length === 0 || source.length > maxGrepRegexSourceLength || nestedRegexQuantifierPattern.test(source)) {
    throw new Error('unsafe regex source');
  }
}

function assertRegexSourceSafety(value: string): void {
  const normalized = value.replaceAll('\\', '/');
  if (
    normalized.length === 0 ||
    normalized.startsWith('/') ||
    /^[A-Za-z]:/u.test(normalized) ||
    /[\u0000-\u001f]/u.test(normalized) ||
    /(^|\/)\.\.(\/|$)/u.test(normalized)
  ) {
    throw safeFailure('CAPABILITY_INPUT_INVALID', 'Grep pattern must be relative and must not traverse parent directories.', 'VALIDATION');
  }
  if (hasNestedQuantifier(value)) {
    throw safeFailure('CAPABILITY_INPUT_INVALID', 'Grep pattern must not contain nested quantifiers.', 'VALIDATION');
  }
}

function hasNestedQuantifier(source: string): boolean {
  return /\((?:\?:|\?=|\?!|\?<=|\?<!)?[^()]{0,128}(?:[+*]|\{\d+(?:,\d*)?\})[^()]{0,128}\)\s*(?:[+*?]|\{\d+(?:,\d*)?\})/u.test(source);
}

function buildGlobFilterMatcher(value: string): (candidate: string) => boolean {
  const pattern = normalizeAndValidateGlobPattern(value);
  return picomatch(pattern, {
    dot: true,
    nocase: process.platform === 'win32',
    nonegate: true,
    noext: true,
    windows: true,
  });
}

function containsNulByte(buffer: Buffer): boolean {
  for (let index = 0; index < buffer.length; index += 1) {
    if (buffer[index] === 0) {
      return true;
    }
  }
  return false;
}

function stripBom(text: string): string {
  if (text.length > 0 && text.charCodeAt(0) === 0xfeff) {
    return text.slice(1);
  }
  return text;
}

function compareGrepMatch(
  left: { readonly file_path: string; readonly line_number: number },
  right: { readonly file_path: string; readonly line_number: number },
): number {
  const fileOrder = compareLexical(left.file_path, right.file_path);
  if (fileOrder !== 0) {
    return fileOrder;
  }
  return left.line_number - right.line_number;
}

function countRegexMatches(line: string, regex: RegExp): number {
  regex.lastIndex = 0;
  let count = 0;
  while (true) {
    const match = regex.exec(line);
    if (match === null) {
      return count;
    }
    count += 1;
    if (match[0] === '') {
      regex.lastIndex += 1;
      if (regex.lastIndex > line.length) {
        return count;
      }
    }
  }
}

function insertSortedCapped<T>(items: T[], item: T, compare: (left: T, right: T) => number, maxItems: number): void {
  let index = 0;
  while (index < items.length && compare(items[index]!, item) <= 0) {
    index += 1;
  }
  if (items.length < maxItems) {
    items.splice(index, 0, item);
  } else if (index < maxItems) {
    items.splice(index, 0, item);
    items.pop();
  }
}

function setCappedCacheEntry<K, V>(cache: Map<K, V>, key: K, value: V, maxEntries: number): void {
  if (!cache.has(key) && cache.size >= maxEntries) {
    const oldestKey = cache.keys().next().value as K | undefined;
    if (oldestKey !== undefined) {
      cache.delete(oldestKey);
    }
  }
  cache.set(key, value);
}

function addCappedSetEntry<T>(items: Set<T>, item: T, maxEntries: number): void {
  if (!items.has(item) && items.size >= maxEntries) {
    const oldestItem = items.values().next().value as T | undefined;
    if (oldestItem !== undefined) {
      items.delete(oldestItem);
    }
  }
  items.add(item);
}
