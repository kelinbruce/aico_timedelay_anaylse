import { createHash } from 'node:crypto';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import type { JsonObject } from '@nextagent/agent-common';
import type { AgentWorkspacePolicy, AgentAssemblyRegistry } from '@nextagent/agent-contracts/agent-assembly';
import type {
  ExecutionDeploymentMode,
  ExecutionWorkspaceResolver,
  ForkPromotionContentResolverPort,
  LargeContentExternalizationContext,
  LargeContentExternalizerPort,
} from '@nextagent/agent-contracts/runtime';
import { applyReplacement, projectReplacementMetadata } from './applier.js';
import { classifyReplacement, type ClassifyReplacementDecision } from './classifier.js';
import { renderPersistedPreviewBlock } from './preview-reader.js';
import { renderReadbackFileContent } from './readback-renderer.js';
import { DEFAULT_LARGE_CONTENT_POLICY, LARGE_CONTENT_THRESHOLDS, type LargeContentPolicy } from './thresholds.js';

const toolResultsDirectory = 'tool-results';
type ExternalizableDraft = Parameters<LargeContentExternalizerPort['externalize']>[0];

/**
 * Tool names whose results are never offloaded / truncated (Infinity tools).
 * Defaults to an empty set: every tool — including `Read` — is subject to
 * the normal large-content policy. `Read` results that exceed the inline
 * threshold are externalized to a workspace readback file, which the model
 * can still page back with `Read` offset/limit via the contentRef.
 */
const DEFAULT_INFINITY_TOOL_NAMES: ReadonlySet<string> = new Set();

export interface DefaultLargeContentExternalizerDependencies {
  readonly runtimeWorkspaceRoot: string;
  readonly sharedDataRoot?: string;
  readonly deploymentMode: ExecutionDeploymentMode;
  readonly executionWorkspaceResolver: ExecutionWorkspaceResolver;
  readonly assemblyRegistry: AgentAssemblyRegistry;
  readonly now?: () => number;
  /**
   * Tool names whose results are never offloaded / truncated. Defaults
   * to `["Read"]`.
   */
  readonly infinityToolNames?: ReadonlySet<string>;
}

export function createDefaultLargeContentExternalizer(deps: DefaultLargeContentExternalizerDependencies): LargeContentExternalizerPort {
  return new DefaultLargeContentExternalizer(deps);
}

export function createDefaultForkPromotionContentResolver(deps: DefaultLargeContentExternalizerDependencies): ForkPromotionContentResolverPort {
  return {
    async resolveForkPromotionContent(request, signal) {
      throwIfAborted(signal);
      const refId = normalizeToolResultRef(request.refId);
      if (refId === undefined) {
        return undefined;
      }
      const workspacePolicy = await deps.assemblyRegistry.require(request.agentId, request.agentVersion).then((assembly) => assembly.workspacePolicy);
      const view = deps.executionWorkspaceResolver.resolve({
        runtimeWorkspaceRoot: deps.runtimeWorkspaceRoot,
        ...(deps.sharedDataRoot === undefined ? {} : { sharedDataRoot: deps.sharedDataRoot }),
        workspacePolicy,
        agentId: request.agentId,
        tenantId: request.identityContext.tenantId,
        subjectId: request.identityContext.subjectId,
        sessionId: request.sourceSessionId,
        runId: request.sourceRunId,
        deploymentMode: deps.deploymentMode,
      });
      const workspaceRoot = view.roots.find((root) => root.kind === 'workspace' && root.access === 'readWrite');
      if (workspaceRoot === undefined) {
        return undefined;
      }
      const target = resolve(workspaceRoot.physicalPath, refId);
      const relativeTarget = relative(workspaceRoot.physicalPath, target);
      if (relativeTarget.startsWith('..') || isAbsolute(relativeTarget)) {
        return undefined;
      }
      try {
        const fileStat = await stat(target);
        if (!fileStat.isFile() || fileStat.size > request.maxBytes) {
          return undefined;
        }
        const bytes = await readFile(target);
        if (bytes.byteLength > request.maxBytes) {
          return undefined;
        }
        return { bytes: new Uint8Array(bytes), mimeType: 'text/plain;charset=utf-8' };
      } catch {
        return undefined;
      }
    },
  };
}

class DefaultLargeContentExternalizer implements LargeContentExternalizerPort {
  private readonly infinityToolNames: ReadonlySet<string>;

  constructor(private readonly deps: DefaultLargeContentExternalizerDependencies) {
    this.infinityToolNames = deps.infinityToolNames ?? DEFAULT_INFINITY_TOOL_NAMES;
  }

  async externalize(draft: ExternalizableDraft, executionContext: LargeContentExternalizationContext): Promise<ExternalizableDraft> {
    const toolName = readToolName(draft);
    const policy = this.resolvePolicy(toolName);
    if (!shouldExternalizeDraft(draft, policy)) {
      return draft;
    }
    const decision = classifyReplacement({
      content: draft.content,
      originalSize: draft.content.length,
      ...(draft.contentType === undefined ? {} : { contentType: draft.contentType }),
      policy,
    });
    if (decision.kind !== 'PERSISTED_PREVIEW') {
      return draft;
    }
    return this.persistAsPreview(draft, executionContext, decision);
  }

  /**
   * Single-result PERSISTED_PREVIEW externalize: write workspace file,
   * render preview block, attach replacement evidence.
   */
  private async persistAsPreview(
    draft: ExternalizableDraft,
    executionContext: LargeContentExternalizationContext,
    decision: ClassifyReplacementDecision,
  ): Promise<ExternalizableDraft> {
    const refId = `${toolResultsDirectory}/${stableRefId(draft.idempotencyKey ?? executionContext.messageId, decision.kind)}.txt`;
    try {
      await this.writeWorkspaceFile(executionContext, refId, renderReadbackFileContent(draft.content));
      const replacement = this.buildReplacement(draft, executionContext, decision, refId);
      const previewBlock = renderPersistedPreviewBlock({
        replacementReason: replacement.replacement.reason,
        contentRefId: refId,
        contentRefType: 'CAPABILITY_RESULT',
        originalSize: draft.content.length,
        preview: draft.content.slice(0, LARGE_CONTENT_THRESHOLDS.previewMaxChars),
      });
      return {
        ...draft,
        content: renderCapabilityResultPreview(draft.content, previewBlock),
        metadata: replacementMetadata(draft, replacement.replacement),
      };
    } catch {
      const replacement = this.buildReplacement(draft, executionContext, decision, refId, {
        reason: safeFailureReason(),
        canInlineFallback: draft.content.length <= DEFAULT_LARGE_CONTENT_POLICY.inlineMaxBytes,
      });
      return {
        ...draft,
        content: renderCapabilityResultPreview(draft.content, replacement.modelVisibleContent),
        metadata: replacementMetadata(draft, replacement.replacement),
      };
    }
  }

  private buildReplacement(
    draft: ExternalizableDraft,
    executionContext: LargeContentExternalizationContext,
    decision: ClassifyReplacementDecision,
    refId: string,
    offloadFailure?: { readonly reason: string; readonly canInlineFallback: boolean },
  ) {
    return applyReplacement({
      kind: decision.kind,
      reason: decision.reason,
      originalContent: draft.content,
      originalSize: draft.content.length,
      contentType: draft.contentType,
      lineage: {
        sourceMessageId: executionContext.messageId,
        sourceRunId: executionContext.runId,
        sourceInvocationId: null,
        stepId: null,
      },
      persistContent: () => ({ contentRef: { refId, refType: 'CAPABILITY_RESULT' } }),
      ...(offloadFailure === undefined ? {} : { offloadFailure }),
      now: this.deps.now ?? Date.now,
    });
  }

  // refId is hex-only and joined under the owner-scoped workspace root;
  // no path-traversal surface, no model-driven authorization needed.
  private async writeWorkspaceFile(executionContext: LargeContentExternalizationContext, refId: string, content: string): Promise<void> {
    const workspacePolicy = await this.requireWorkspacePolicy(executionContext);
    const view = this.deps.executionWorkspaceResolver.resolve({
      runtimeWorkspaceRoot: this.deps.runtimeWorkspaceRoot,
      ...(this.deps.sharedDataRoot === undefined ? {} : { sharedDataRoot: this.deps.sharedDataRoot }),
      workspacePolicy,
      agentId: executionContext.agentId,
      tenantId: executionContext.identityContext.tenantId,
      subjectId: executionContext.identityContext.subjectId,
      sessionId: executionContext.sessionId,
      runId: executionContext.runId,
      deploymentMode: this.deps.deploymentMode,
    });
    const workspaceRoot = view.roots.find((root) => root.kind === 'workspace' && root.access === 'readWrite');
    if (workspaceRoot === undefined) {
      throw new Error('Writable execution workspace root is unavailable.');
    }
    const target = join(workspaceRoot.physicalPath, refId);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, content, 'utf8');
  }

  private async requireWorkspacePolicy(executionContext: LargeContentExternalizationContext): Promise<AgentWorkspacePolicy> {
    return (await this.deps.assemblyRegistry.require(executionContext.agentId, executionContext.agentVersion)).workspacePolicy;
  }

  /**
   * Resolve the effective policy for a draft. `infinity` is set when
   * the draft's tool is in `infinityToolNames`; the threshold fields
   * come from the constructor-resolved overrides (already min-clamped
   * against the spec default).
   */
  private resolvePolicy(toolName?: string): LargeContentPolicy {
    return {
      inlineMaxBytes: DEFAULT_LARGE_CONTENT_POLICY.inlineMaxBytes,
      previewMaxChars: DEFAULT_LARGE_CONTENT_POLICY.previewMaxChars,
      infinity: toolName !== undefined && this.infinityToolNames.has(toolName),
    };
  }
}

function shouldExternalizeDraft(draft: ExternalizableDraft, policy: LargeContentPolicy): boolean {
  return (
    draft.role === 'CAPABILITY_RESULT' &&
    // Infinity tools are never offloaded (spec §"Infinity tool result
    // is never offloaded or truncated").
    !policy.infinity &&
    draft.content.length > policy.inlineMaxBytes &&
    !hasReplacementMetadata(draft)
  );
}

function hasReplacementMetadata(draft: ExternalizableDraft): boolean {
  const metadata = draft.metadata;
  return metadata !== undefined && typeof metadata['replacement'] === 'object' && metadata['replacement'] !== null;
}

function readToolName(draft: ExternalizableDraft): string | undefined {
  const metadataToolName = draft.metadata?.['toolName'];
  if (typeof metadataToolName === 'string') {
    return metadataToolName;
  }
  try {
    const parsed = JSON.parse(draft.content) as unknown;
    if (parsed !== null && typeof parsed === 'object') {
      const toolName = (parsed as Record<string, unknown>)['toolName'];
      return typeof toolName === 'string' ? toolName : undefined;
    }
  } catch {
    return undefined;
  }
  return undefined;
}

function replacementMetadata(draft: ExternalizableDraft, replacement: Parameters<typeof projectReplacementMetadata>[0]): JsonObject {
  const projected = projectReplacementMetadata(replacement);
  return {
    ...(draft.metadata ?? {}),
    replacement: projected.replacement as JsonObject,
  } as JsonObject;
}

function renderCapabilityResultPreview(rawContent: string, previewBlock: string): string {
  try {
    const parsed = JSON.parse(rawContent) as unknown;
    if (
      parsed !== null &&
      typeof parsed === 'object' &&
      typeof (parsed as Record<string, unknown>)['toolCallId'] === 'string' &&
      typeof (parsed as Record<string, unknown>)['toolName'] === 'string'
    ) {
      return JSON.stringify({
        ...(parsed as Record<string, unknown>),
        payload: { preview: previewBlock },
      });
    }
  } catch {
    return previewBlock;
  }
  return previewBlock;
}

function stableRefId(messageId: string, kind: string): string {
  return createHash('sha256').update(messageId).update('\0').update(kind).digest('hex').slice(0, 24);
}

function safeFailureReason(): string {
  return 'workspace-write-failed';
}

function normalizeToolResultRef(refId: string): string | undefined {
  const candidate = refId.startsWith('workspace/') ? refId.slice('workspace/'.length) : refId;
  if (
    candidate.length === 0 ||
    candidate.length > 512 ||
    !candidate.startsWith(`${toolResultsDirectory}/`) ||
    candidate.includes('\\') ||
    candidate.includes('\0') ||
    candidate.split('/').some((segment) => segment.length === 0 || segment === '.' || segment === '..')
  ) {
    return undefined;
  }
  return candidate;
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new Error('Operation aborted.');
  }
}
