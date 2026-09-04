import { brand, getLogger, type CapabilityId, type JsonObject, type JsonValue } from '@nextagent/agent-common';
import type { CapabilityDescriptor, CapabilityInvocationResult, SkillMetadata } from '@nextagent/agent-contracts/capability';

import { readSkillMetadata } from '../skills/skill-manifest.js';
import type { SkillResourceMetadata, SkillSourceDiscovery } from '../skills/skill-source-discovery.js';
import { defineTool, type SkillResourceProjectionEntry, type SkillResourceProjectionInput, type ToolExecuteOptions } from '../tools/tool-spi.js';

const skillToolArgsMaxBytes = 8192;
const logger = getLogger({ component: 'agent-capability', source: 'skill-tool' });
const skillToolArgsMaxDepth = 8;
const inlineSkillBodyMaxBytes = 65_536;
const skillToolDescription = [
  'Execute one governed Skill in the main conversation when its exact capability id is visible in the enabled Skill list or a ToolSearch result.',
  'Use ToolSearch first for a relevant deferred Skill that is not visible; do not guess a name or treat an undisclosed id as callable.',
  'Treat a slash command as a Skill only when the text after `/` exactly matches an available Skill; built-in CLI commands are not Skills.',
  'Set `name` to the exact capability id and put only task-specific JSON object data in `args`. Fields in `args` are task data only and do not change runtime execution governance.',
  'If Skill reports unavailable, undiscovered, timed out, canceled, or failed, follow that outcome and do not claim the Skill ran successfully.',
].join(' ');

export const skillToolDefinition = defineTool({
  name: brand<string, 'CapabilityId'>('Skill'),
  description: skillToolDescription,
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    required: ['name'],
    properties: {
      name: { type: 'string', minLength: 1, maxLength: 128, description: 'Exact name of an available Skill listed in the system prompt.' },
      args: {
        type: 'object',
        additionalProperties: true,
        description: 'Task-specific JSON object data. Fields do not change runtime timeout, child budget, or provider selection.',
      },
    },
  },
  outputSchema: {
    type: 'object',
    additionalProperties: true,
  },
  requiredDependencies: ['skillSources', 'workspaceFiles'],
  replayPolicy: 'NON_IDEMPOTENT',
  returnsCapabilityResult: true,
  async execute(input, options) {
    return executeSkillTool(input, options);
  },
});

async function executeSkillTool(input: JsonObject, options?: ToolExecuteOptions): Promise<CapabilityInvocationResult> {
  if (options?.signal?.aborted) {
    return failed('ABORTED', 'Skill execution was aborted.', 'CANCELED');
  }
  const validation = validateInput(input);
  if (validation !== undefined) {
    return validation;
  }
  const name = input.name as string;
  if (isPathLikeName(name)) {
    return failed(
      'SKILL_NOT_AVAILABLE',
      'Skill loading did not start because a Skill must be selected by an exact governed capability id, not by a path. Use ToolSearch to discover an available Skill, choose another capability, or continue without the Skill.',
      'UNAVAILABLE',
      { targetSkillId: safeTargetId(name) },
    );
  }
  const descriptor = await options?.context?.capabilityResolver?.resolveCapability(
    { kind: 'SKILL', capabilityId: brand<string, 'CapabilityId'>(name) },
    options?.signal ?? new AbortController().signal,
  );
  if (descriptor === undefined || descriptor.kind !== 'SKILL' || descriptor.availabilityStatus !== 'AVAILABLE') {
    return failed(
      'SKILL_NOT_AVAILABLE',
      'The requested Skill is not available in the current governed scope, so it was not loaded. Use ToolSearch to discover an available Skill, choose another capability, or continue without the Skill.',
      'UNAVAILABLE',
      { targetSkillId: safeTargetId(name) },
    );
  }
  const disclosureCheck = checkSkillDisclosure(descriptor, options);
  if (disclosureCheck !== undefined) {
    return disclosureCheck;
  }
  const metadataResult = readSkillMetadata(descriptor);
  if (!metadataResult.matched) {
    return failed(
      'SKILL_NOT_AVAILABLE',
      'The requested Skill has no usable governed metadata, so it was not loaded. Use ToolSearch to discover another available Skill, choose another capability, or continue without the Skill.',
      'UNAVAILABLE',
      { targetSkillId: safeTargetId(name) },
    );
  }
  if (metadataResult.metadata.context === 'fork') {
    return failed(
      'SKILL_CONTEXT_UNSUPPORTED',
      'The requested Skill requires a forked context that this runtime cannot execute, so it was not loaded. Choose an inline-capable Skill, use another capability, or continue without the Skill.',
      'UNAVAILABLE',
      { targetSkillId: descriptor.capabilityId },
    );
  }
  const source = options?.deps?.skillSources?.resolveSkillSource(descriptor.provider.providerId);
  if (source === undefined) {
    return failed(
      'SKILL_NOT_AVAILABLE',
      'The governed source for the requested Skill is unavailable, so it was not loaded. Use ToolSearch to select another available Skill, choose another capability, or continue without the Skill.',
      'UNAVAILABLE',
      { targetSkillId: descriptor.capabilityId },
    );
  }
  const skillVersion = descriptor.version ?? 'unversioned';
  const skillSourceInput = { skillName: descriptor.capabilityId, skillVersion };
  const sourceMetadata = metadataResult.metadata.sourceMetadata ?? {};
  const sourceIdentity =
    typeof sourceMetadata.sourceIdentity === 'string'
      ? sourceMetadata.sourceIdentity
      : `${descriptor.provider.providerId}:${descriptor.capabilityId}`;
  const frontmatterHash =
    typeof sourceMetadata.frontmatterHash === 'string' ? sourceMetadata.frontmatterHash : `${descriptor.capabilityId}-frontmatter`;
  // Non-agentic dispatch: check extension flag before existing inline path
  const extension = metadataResult.metadata.extension;
  const agenticLoopFlag = extension?.['_naie_agentic_loop_flag'];
  if (agenticLoopFlag === 'false') {
    // Still load body to parse api command, but do not inject or project
    const nonAgenticLoaded = await settleWithTimeout(
      source.loadCanonicalBodyView(
        { ...skillSourceInput, capabilityId: descriptor.capabilityId, sourceIdentity, frontmatterHash },
        options?.signal ?? new AbortController().signal,
      ),
      options?.context?.timeoutMs ?? 30_000,
      options?.signal,
    ).catch(() => undefined);
    if (nonAgenticLoaded === undefined) {
      return failed(
        'EXECUTION_FAILED',
        'The governed Skill source failed during canonical body loading, so execution stopped before API dispatch. Choose another available Skill or capability, continue without it, or report the source-loading failure.',
        'INTERNAL',
        { targetSkillId: descriptor.capabilityId },
      );
    }
    if (nonAgenticLoaded.status === 'aborted') {
      return failed('ABORTED', 'Skill execution was aborted.', 'CANCELED', { targetSkillId: descriptor.capabilityId });
    }
    if (nonAgenticLoaded.status === 'timed-out') {
      return timedOut(
        'TIMEOUT',
        'The governed Skill source timed out during canonical body loading before API dispatch. Do not repeat the same load unchanged; choose another available Skill or capability, or stop and report the timeout.',
        { targetSkillId: descriptor.capabilityId },
      );
    }
    if (nonAgenticLoaded.value === undefined) {
      return failed(
        'SKILL_SOURCE_CHANGED',
        'The requested Skill source no longer matches the version accepted by governance, so it was not loaded. Use ToolSearch to discover the current governed Skill, choose another allowed capability, or continue without it.',
        'AUTHORIZATION',
        { targetSkillId: descriptor.capabilityId },
      );
    }
    const apiCommand = parseApiCommand(nonAgenticLoaded.value.body);
    if (apiCommand === undefined) {
      return failed(
        'API_COMMAND_PARSE_FAILED',
        'The governed Skill body does not contain a valid API command, so API dispatch did not start. Choose another available Skill or stop and report that this Skill definition must be corrected.',
        'VALIDATION',
        { targetSkillId: descriptor.capabilityId },
      );
    }
    const apiHeaderParams =
      typeof extension?.['api_header_params'] === 'string'
        ? extension['api_header_params']
        : Array.isArray(extension?.['api_header_params'])
          ? (extension['api_header_params'] as unknown[]).filter((v): v is string => typeof v === 'string').join(',')
          : '';
    const apiRequestParams =
      typeof extension?.['api_request_params'] === 'string'
        ? extension['api_request_params']
        : Array.isArray(extension?.['api_request_params'])
          ? (extension['api_request_params'] as unknown[]).filter((v): v is string => typeof v === 'string').join(',')
          : '';
    return {
      status: 'SUCCEEDED',
      structuredPayload: {
        skillName: descriptor.capabilityId,
        apiCommand: apiCommand as unknown as JsonObject,
        apiHeaderParams,
        apiRequestParams,
        passThroughFlag: typeof extension?.['_naie_pass_through_flag'] === 'string' ? extension['_naie_pass_through_flag'] : '',
        providerId: descriptor.provider.providerId,
        skillVersion,
        sourceIdentity,
        frontmatterHash,
        skillBody: nonAgenticLoaded.value.body,
      },
      generatedMessages: [],
      artifactRefs: [],
      metadata: { nonAgenticApiCall: true, targetSkillId: descriptor.capabilityId },
    };
  }
  const loaded = await settleWithTimeout(
    source.loadCanonicalBodyView(
      {
        ...skillSourceInput,
        capabilityId: descriptor.capabilityId,
        sourceIdentity,
        frontmatterHash,
      },
      options?.signal ?? new AbortController().signal,
    ),
    options?.context?.timeoutMs ?? 30_000,
    options?.signal,
  ).catch(() => undefined);
  if (loaded === undefined) {
    return failed(
      'EXECUTION_FAILED',
      'The governed Skill source failed during canonical body loading, so execution stopped before the Skill was injected. Choose another available Skill or capability, continue without it, or report the source-loading failure.',
      'INTERNAL',
      { targetSkillId: descriptor.capabilityId },
    );
  }
  if (loaded.status === 'aborted') {
    return failed('ABORTED', 'Skill execution was aborted.', 'CANCELED', { targetSkillId: descriptor.capabilityId });
  }
  if (loaded.status === 'timed-out') {
    return timedOut(
      'TIMEOUT',
      'The governed Skill source timed out during canonical body loading before the Skill was injected. Do not repeat the same load unchanged; choose another available Skill or capability, or stop and report the timeout.',
      { targetSkillId: descriptor.capabilityId },
    );
  }
  if (loaded.value === undefined) {
    logSkillDiagnostic(options, 'skill.tool.source_load_miss', {
      requestedSkillName: name,
      targetSkillId: descriptor.capabilityId,
      providerId: descriptor.provider.providerId,
      skillVersion,
      sourceHandleMode: sourceHandleMode(sourceMetadata),
      hasGovernedSourceIdentity: typeof sourceMetadata.sourceIdentity === 'string',
      hasGovernedFrontmatterHash: typeof sourceMetadata.frontmatterHash === 'string',
    });
    return failed(
      'SKILL_SOURCE_CHANGED',
      'The requested Skill source no longer matches the version accepted by governance, so it was not loaded. Use ToolSearch to discover the current governed Skill, choose another allowed capability, or continue without it.',
      'AUTHORIZATION',
      { targetSkillId: descriptor.capabilityId },
    );
  }
  if (!matchesDescriptor(descriptor, loaded.value)) {
    logSkillDiagnostic(options, 'skill.tool.descriptor_mismatch', {
      requestedSkillName: name,
      targetSkillId: descriptor.capabilityId,
      providerId: descriptor.provider.providerId,
      skillVersion,
      sourceHandleMode: sourceHandleMode(sourceMetadata),
      hasGovernedSourceIdentity: typeof sourceMetadata.sourceIdentity === 'string',
      hasGovernedFrontmatterHash: typeof sourceMetadata.frontmatterHash === 'string',
    });
    return failed(
      'SCOPE_MISMATCH',
      'The loaded Skill source no longer matches its governed descriptor or trusted scope, so it was rejected. Use ToolSearch to select a currently allowed Skill, choose another allowed capability, or continue without it.',
      'AUTHORIZATION',
      { targetSkillId: descriptor.capabilityId },
    );
  }
  const checkedBody = validateInlineBody(loaded.value.body);
  if (checkedBody !== undefined) {
    return checkedBody;
  }
  if (containsSkillBoundary(loaded.value.body)) {
    return failed(
      'EXECUTION_FAILED',
      'The governed Skill body contains a nested Skill boundary and cannot be injected safely. Choose another available Skill or stop and report that this Skill source must be corrected.',
      'VALIDATION',
      { targetSkillId: descriptor.capabilityId },
    );
  }
  if (options?.deps?.workspaceFiles === undefined || options.context === undefined) {
    return failed(
      'EXECUTION_FAILED',
      'The Skill body loaded, but its governed resource projection boundary or trusted context is unavailable, so the Skill was not injected. Choose another available Skill or capability, continue without it, or report the unavailable boundary.',
      'UNAVAILABLE',
      { targetSkillId: descriptor.capabilityId },
    );
  }
  const projectionInput = await prepareSkillResourcesForProjection(source, skillSourceInput, options.signal ?? new AbortController().signal);
  if ('status' in projectionInput) {
    return projectionInput;
  }
  let projection;
  try {
    projection = await options.deps.workspaceFiles.projectSkillResources(
      {
        providerId: descriptor.provider.providerId,
        skillName: descriptor.capabilityId,
        skillVersion,
        ...projectionInput,
      },
      options.context,
      options.signal,
    );
  } catch (error) {
    if (isAbort(error)) {
      return failed('ABORTED', 'Skill execution was aborted.', 'CANCELED', { targetSkillId: descriptor.capabilityId });
    }
    logSkillResourceProjectionFailure(error, {
      targetSkillId: descriptor.capabilityId,
      providerId: descriptor.provider.providerId,
      skillVersion,
      sourceHandleMode: sourceHandleMode(sourceMetadata),
      hasListResources: source.listSkillResources !== undefined,
      hasReadResource: source.readSkillResource !== undefined,
    });
    if (isSafeError(error)) {
      const projectionLocked = isProjectionLockedSafeError(error);
      return failed(
        error.code,
        projectionLocked
          ? 'The Skill body loaded, but its governed resource projection is temporarily locked, so the Skill was not injected. Choose another available Skill or capability, or try this Skill again later.'
          : 'The Skill body loaded, but resource projection failed at the governed boundary, so the Skill was not injected. Choose another available Skill or capability, continue without it, or report the projection failure.',
        projectionLocked ? 'UNAVAILABLE' : safeErrorCategory(error.category),
        {
          targetSkillId: descriptor.capabilityId,
        },
        { retryable: projectionLocked },
      );
    }
    return failed(
      'EXECUTION_FAILED',
      'The Skill body loaded, but resource projection failed at the governed boundary, so the Skill was not injected. Choose another available Skill or capability, continue without it, or report the projection failure.',
      'INTERNAL',
      { targetSkillId: descriptor.capabilityId },
    );
  }
  let resourceNotice = '';
  if (projection.projectedCount > 0) {
    resourceNotice = [
      `Skill resource root: ${projection.rootRelativePath}`,
      'The Skill body below is already loaded. Only access auxiliary files explicitly referenced by it. Do not enumerate the Skill directory or read SKILL.md.',
      'This Skill resource root is a system-managed read-only projection. Do not use Edit or Write on `.nextagent/skills/...` files.',
      'If a script needs repair, provide a patch/diff and tell the user to update the source Skill.',
      'To validate a repair, copy the script and required dependency files into `workspace/` while preserving their relative layout, then run the workspace copy.',
      'Reference those files under this root directly without using cd, &&, bash -lc, or cmd /c before Bash or Python tools.',
    ].join('\n');
  }
  const resourcePrefix = resourceNotice.length === 0 ? '' : `${resourceNotice}\n\n`;
  const skillBody = `<skill_content name="${escapeAttribute(descriptor.capabilityId)}">\n${resourcePrefix}${loaded.value.body}\n</skill_content>`;
  const patch = contextPatch(metadataResult.metadata);
  const srcMeta = metadataResult.metadata.sourceMetadata ?? {};
  const extMeta = metadataResult.metadata.extension ?? {};
  return {
    status: 'SUCCEEDED',
    // The Skill body travels in `structuredPayload.body` so the runtime
    // persists it inside the Skill tool-result payload (`output.body`). The
    // conversation projection blanks CAPABILITY_RESULT content for the page
    // and the stream envelope projects Skill results as STATUS_ONLY, so the
    // body is model-visible but user-hidden — exactly the same property the
    // previous page-hidden USER message held, without a separate message row
    // or the consume-once extraction dance.
    structuredPayload: { name: descriptor.capabilityId, status: 'loaded', body: skillBody },
    generatedMessages: [],
    ...(patch === undefined ? {} : { contextPatch: patch }),
    artifactRefs: [],
    metadata: {
      agenticSkillLoaded: true,
      skillName: descriptor.capabilityId,
      skillVersion: descriptor.version ?? 'unversioned',
      providerId: descriptor.provider.providerId,
      sourceIdentity:
        typeof (srcMeta as Record<string, unknown>).sourceIdentity === 'string'
          ? ((srcMeta as Record<string, unknown>).sourceIdentity as string)
          : `${descriptor.provider.providerId}:${descriptor.capabilityId}`,
      frontmatterHash:
        typeof (srcMeta as Record<string, unknown>).frontmatterHash === 'string'
          ? ((srcMeta as Record<string, unknown>).frontmatterHash as string)
          : `${descriptor.capabilityId}-frontmatter`,
      ...(typeof (extMeta as Record<string, unknown>)['_naie_pass_through_flag'] === 'string'
        ? { passThroughFlag: (extMeta as Record<string, unknown>)['_naie_pass_through_flag'] as string }
        : {}),
      ...(typeof (extMeta as Record<string, unknown>)['api_header_params'] === 'string'
        ? { apiHeaderParams: (extMeta as Record<string, unknown>)['api_header_params'] as string }
        : Array.isArray((extMeta as Record<string, unknown>)['api_header_params'])
          ? {
              apiHeaderParams: ((extMeta as Record<string, unknown>)['api_header_params'] as unknown[])
                .filter((v): v is string => typeof v === 'string')
                .join(','),
            }
          : {}),
      ...(typeof (extMeta as Record<string, unknown>)['api_request_params'] === 'string'
        ? { apiRequestParams: (extMeta as Record<string, unknown>)['api_request_params'] as string }
        : Array.isArray((extMeta as Record<string, unknown>)['api_request_params'])
          ? {
              apiRequestParams: ((extMeta as Record<string, unknown>)['api_request_params'] as unknown[])
                .filter((v): v is string => typeof v === 'string')
                .join(','),
            }
          : {}),
    },
  };
}

function checkSkillDisclosure(descriptor: CapabilityDescriptor, options?: ToolExecuteOptions): CapabilityInvocationResult | undefined {
  if (descriptor.disclosurePolicy?.mode === 'HIDDEN') {
    return failed(
      'SKILL_NOT_AVAILABLE',
      'The requested Skill is hidden from model invocation in the current governed scope, so it was not loaded. Use ToolSearch to discover an invocable Skill, choose another capability, or continue without it.',
      'UNAVAILABLE',
      { targetSkillId: descriptor.capabilityId },
    );
  }
  if (isRuntimeLocalSkill(descriptor) || isGeneratedAgentOwnedLocalSkill(descriptor)) {
    return undefined;
  }
  const requiresDiscovery = descriptor.disclosurePolicy?.mode === 'DEFERRED' || descriptor.modelInvocable !== true;
  if (!requiresDiscovery) {
    return undefined;
  }
  const discovered = new Set<string>(options?.context?.discoveredSkills ?? []);
  if (discovered.has(descriptor.capabilityId)) {
    return undefined;
  }
  return failed(
    'SKILL_NOT_DISCOVERED',
    'The requested deferred Skill has not been discovered in this request, so it was not loaded. Call ToolSearch, select the exact returned capability id, and then call Skill again; otherwise choose another capability.',
    'VALIDATION',
    { targetSkillId: descriptor.capabilityId },
  );
}

function isGeneratedAgentOwnedLocalSkill(descriptor: CapabilityDescriptor): boolean {
  return descriptor.provider.providerId === 'local-skills-agent-owned' && descriptor.capabilityId.startsWith('generated-');
}

function isRuntimeLocalSkill(descriptor: CapabilityDescriptor): boolean {
  return descriptor.provider.providerId === 'local-skills-runtime-generated';
}

async function prepareSkillResourcesForProjection(
  source: SkillSourceDiscovery,
  input: { readonly skillName: CapabilityId; readonly skillVersion: string },
  signal: AbortSignal,
): Promise<Pick<SkillResourceProjectionInput, 'listResources' | 'readResource'> | CapabilityInvocationResult> {
  const listResources: NonNullable<SkillResourceProjectionInput['listResources']> = async (listSignal) => {
    const resources = (await source.listSkillResources?.({ ...input }, listSignal ?? signal)) ?? [];
    return resources.filter((resource) => resource.relativePath.replaceAll('\\', '/') !== 'SKILL.md');
  };
  const readResource: NonNullable<SkillResourceProjectionInput['readResource']> = async (resource, readSignal) => {
    if (source.readSkillResource === undefined) {
      return undefined;
    }
    try {
      const loaded = await source.readSkillResource({ ...input, resource }, readSignal ?? signal);
      if (loaded === undefined || !sameResourceMetadata(resource, loaded)) {
        return undefined;
      }
      return loaded;
    } catch (error) {
      if (isAbort(error)) {
        throw error;
      }
      return undefined;
    }
  };
  return { listResources, readResource };
}

function sameResourceMetadata(expected: SkillResourceMetadata, actual: SkillResourceProjectionEntry): boolean {
  return (
    actual.relativePath === expected.relativePath &&
    actual.kind === expected.kind &&
    actual.sizeBytes === expected.sizeBytes &&
    (expected.contentHash === undefined || actual.contentHash === expected.contentHash)
  );
}

function validateInput(input: JsonObject): CapabilityInvocationResult | undefined {
  if (typeof input.name !== 'string' || input.name.trim() === '') {
    return failed(
      'INVALID_INPUT',
      'Skill validation failed before loading: name must be a non-empty string. Supply an exact available Skill capability id and call again.',
      'VALIDATION',
    );
  }
  if (input.name.length > 128) {
    return failed(
      'INVALID_INPUT',
      'Skill validation failed before loading: name must contain at most 128 characters. Supply a shorter exact Skill capability id and call again.',
      'VALIDATION',
    );
  }
  for (const key of Object.keys(input)) {
    if (key !== 'name' && key !== 'args') {
      return failed(
        'INVALID_INPUT',
        'Skill validation failed before loading: input supports only name and task-specific args; execution-governance fields are not accepted. Remove unsupported fields and call again.',
        'VALIDATION',
      );
    }
  }
  if (input.args === undefined) {
    return undefined;
  }
  if (!isJsonObject(input.args)) {
    return failed(
      'INVALID_INPUT',
      'Skill validation failed before loading: args must be a JSON object. Correct or omit args and call again.',
      'VALIDATION',
    );
  }
  if (!isJsonSerializable(input.args)) {
    return failed(
      'INVALID_INPUT',
      'Skill validation failed before loading: args must contain only JSON-serializable values. Remove unsupported values and call again.',
      'VALIDATION',
    );
  }
  if (jsonDepth(input.args) > skillToolArgsMaxDepth) {
    return failed(
      'INVALID_INPUT',
      `Skill validation failed before loading: args nesting must not exceed ${skillToolArgsMaxDepth} levels. Flatten the args and call again.`,
      'VALIDATION',
    );
  }
  if (Buffer.byteLength(JSON.stringify(input.args), 'utf8') > skillToolArgsMaxBytes) {
    return failed(
      'INVALID_INPUT',
      `Skill validation failed before loading: args must not exceed ${skillToolArgsMaxBytes} UTF-8 bytes. Reduce the args and call again.`,
      'VALIDATION',
    );
  }
  return undefined;
}

function validateInlineBody(body: string): CapabilityInvocationResult | undefined {
  if (
    body.trim().length === 0 ||
    Buffer.byteLength(body, 'utf8') > inlineSkillBodyMaxBytes ||
    /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/u.test(body)
  ) {
    return failed(
      'EXECUTION_FAILED',
      'The governed Skill body failed safe boundary validation and cannot be loaded. Choose another available Skill or stop and report that this Skill source must be corrected.',
      'VALIDATION',
    );
  }
  // Defense-in-depth encoding backstop: a U+FFFD replacement character means
  // the body was decoded from bytes that were not valid UTF-8 (e.g. GBK or
  // Latin-1). The model cannot read garbled instructions, so the body MUST be
  // rejected rather than silently injected into hidden context. Discovery and
  // invocation now reject non-UTF-8 sources upstream via
  // SKILL_MD_UNSUPPORTED_ENCODING; this check guards any non-file body source
  // or a race where encoding changes between discovery and invocation.
  if (body.includes('�')) {
    return failed(
      'EXECUTION_FAILED',
      'The governed Skill body has an unsupported encoding and cannot be loaded safely. Choose another available Skill or stop and report that this Skill source must be re-encoded as UTF-8.',
      'VALIDATION',
    );
  }
  if (hostPathLeakagePattern.test(body)) {
    return failed(
      'EXECUTION_FAILED',
      'The governed Skill body contains host-location text that cannot cross the capability boundary, so it was not loaded. Choose another available Skill or stop and report that this Skill source must be corrected.',
      'VALIDATION',
    );
  }
  return undefined;
}

const hostPathLeakagePattern = /(?:^|[^A-Za-z0-9])(?:[A-Za-z]:[\\/]|\/(?:Users|home|var|etc)\/)/iu;

function matchesDescriptor(
  descriptor: CapabilityDescriptor,
  body: {
    readonly providerId: string;
    readonly capabilityId: CapabilityId;
    readonly skillVersion: string;
    readonly sourceIdentity?: string;
    readonly frontmatterHash?: string;
  },
): boolean {
  return (
    body.providerId === descriptor.provider.providerId &&
    body.capabilityId === descriptor.capabilityId &&
    body.skillVersion === (descriptor.version ?? 'unversioned')
  );
}

function contextPatch(metadata: SkillMetadata): CapabilityInvocationResult['contextPatch'] | undefined {
  if (
    metadata.model === undefined &&
    metadata.modelOptions === undefined &&
    metadata.allowedTools === undefined &&
    metadata.deniedTools === undefined
  ) {
    return undefined;
  }
  return {
    ...(metadata.allowedTools === undefined ? {} : { allowedTools: metadata.allowedTools.map((tool) => brand<string, 'CapabilityId'>(tool)) }),
    ...(metadata.deniedTools === undefined ? {} : { deniedTools: metadata.deniedTools.map((tool) => brand<string, 'CapabilityId'>(tool)) }),
    ...(metadata.model === undefined ? {} : { modelId: metadata.model }),
    ...(metadata.modelOptions === undefined ? {} : { modelOptions: metadata.modelOptions }),
  };
}

function failed(
  code: string,
  message: string,
  category: 'AUTHORIZATION' | 'VALIDATION' | 'UNAVAILABLE' | 'CANCELED' | 'INTERNAL',
  metadata: JsonObject = {},
  options: { readonly retryable?: boolean } = {},
): CapabilityInvocationResult {
  return {
    status: 'FAILED',
    structuredPayload: {},
    generatedMessages: [],
    artifactRefs: [],
    safeError: { code, message, category, retryable: options.retryable ?? false },
    ...(Object.keys(metadata).length === 0 ? {} : { metadata }),
  };
}

function timedOut(code: string, message: string, metadata: JsonObject): CapabilityInvocationResult {
  return {
    status: 'TIMED_OUT',
    structuredPayload: {},
    generatedMessages: [],
    artifactRefs: [],
    safeError: { code, message, category: 'TIMEOUT', retryable: false },
    metadata,
  };
}

async function settleWithTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<{ readonly status: 'ok'; readonly value: T } | { readonly status: 'timed-out' } | { readonly status: 'aborted' }> {
  if (signal?.aborted) {
    return { status: 'aborted' };
  }
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise.then((value) => ({ status: 'ok' as const, value })),
      new Promise<{ readonly status: 'timed-out' }>((resolve) => {
        timeout = setTimeout(() => resolve({ status: 'timed-out' }), Math.max(1, timeoutMs));
      }),
      new Promise<{ readonly status: 'aborted' }>((resolve) =>
        signal?.addEventListener('abort', () => resolve({ status: 'aborted' }), { once: true }),
      ),
    ]);
  } finally {
    if (timeout !== undefined) {
      clearTimeout(timeout);
    }
  }
}

function isPathLikeName(value: string): boolean {
  return /[\\/]|(^|[.])\.\.($|[.])|\.md$/iu.test(value);
}

function safeTargetId(value: string): string {
  return value.replace(/[^A-Za-z0-9._:-]/gu, '_').slice(0, 128);
}

function escapeAttribute(value: string): string {
  return value.replace(/&/gu, '&amp;').replace(/"/gu, '&quot;').replace(/</gu, '&lt;').replace(/>/gu, '&gt;');
}

function containsSkillBoundary(value: string): boolean {
  return /<\/?\s*skill_content\b|&lt;\/?\s*skill_content\b/iu.test(value);
}

function isAbort(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}

function isSafeError(error: unknown): error is { readonly code: string; readonly category: string; readonly safeDetails?: JsonObject } {
  return error !== null && typeof error === 'object' && 'code' in error && 'category' in error;
}

function isProjectionLockedSafeError(error: { readonly code: string; readonly category: string; readonly message?: unknown }): boolean {
  return error.code === 'CAPABILITY_PATH_REJECTED' && error.category === 'CONFLICT' && error.message === 'Skill resource projection is locked.';
}

function safeErrorCategory(category: string): 'AUTHORIZATION' | 'VALIDATION' | 'UNAVAILABLE' | 'CANCELED' | 'INTERNAL' {
  if (category === 'AUTHORIZATION' || category === 'VALIDATION' || category === 'CANCELED') {
    return category;
  }
  return 'INTERNAL';
}

function logSkillResourceProjectionFailure(
  error: unknown,
  payload: {
    readonly targetSkillId: CapabilityId;
    readonly providerId: string;
    readonly skillVersion: string;
    readonly sourceHandleMode: 'governed' | 'fallback';
    readonly hasListResources: boolean;
    readonly hasReadResource: boolean;
  },
): void {
  const safeError = isSafeError(error) ? error : undefined;
  logger.warn({
    event: 'skill.tool.resource_projection_failed',
    safeReasonCode: safeError?.code ?? 'EXECUTION_FAILED',
    targetSkillId: payload.targetSkillId,
    providerId: payload.providerId,
    skillVersion: payload.skillVersion,
    sourceHandleMode: payload.sourceHandleMode,
    hasListResources: payload.hasListResources,
    hasReadResource: payload.hasReadResource,
    ...(safeError === undefined
      ? {
          exceptionName: exceptionName(error),
          nodeErrorCode: nodeErrorCode(error),
          failureKind: projectionFailureKind(error),
        }
      : {
          safeErrorCode: safeError.code,
          safeErrorCategory: safeError.category,
          ...projectionDiagnosticDetails(safeError.safeDetails),
          failureKind: projectionFailureKind(error),
        }),
  });
}

function logSkillDiagnostic(
  options: ToolExecuteOptions | undefined,
  event: 'skill.tool.source_load_miss' | 'skill.tool.descriptor_mismatch',
  payload: {
    readonly requestedSkillName: string;
    readonly targetSkillId: CapabilityId;
    readonly providerId: string;
    readonly skillVersion: string;
    readonly sourceHandleMode: 'governed' | 'fallback';
    readonly hasGovernedSourceIdentity: boolean;
    readonly hasGovernedFrontmatterHash: boolean;
  },
): void {
  logger.warn({
    event,
    safeReasonCode: event === 'skill.tool.source_load_miss' ? 'SKILL_SOURCE_CHANGED' : 'SCOPE_MISMATCH',
    requestedSkillName: payload.requestedSkillName,
    targetSkillId: payload.targetSkillId,
    providerId: payload.providerId,
    skillVersion: payload.skillVersion,
    sourceHandleMode: payload.sourceHandleMode,
    hasGovernedSourceIdentity: payload.hasGovernedSourceIdentity,
    hasGovernedFrontmatterHash: payload.hasGovernedFrontmatterHash,
  });
}

function exceptionName(error: unknown): string {
  return error instanceof Error ? error.name : typeof error;
}

function nodeErrorCode(error: unknown): string | undefined {
  if (error === null || typeof error !== 'object') {
    return undefined;
  }
  const code = (error as { readonly code?: unknown }).code;
  return typeof code === 'string' && /^[A-Z_]+$/u.test(code) ? code : undefined;
}

function projectionFailureKind(error: unknown): string {
  if (isSafeError(error)) {
    if (error.code === 'RESOURCE_TOO_LARGE') {
      return 'RESOURCE_LIMIT';
    }
    if (error.code === 'CAPABILITY_PATH_REJECTED') {
      return 'PATH_REJECTED';
    }
    return 'SAFE_ERROR';
  }
  const code = nodeErrorCode(error);
  if (code === 'EACCES' || code === 'EPERM') {
    return 'PERMISSION_DENIED';
  }
  if (code === 'ENOENT') {
    return 'MISSING_PATH';
  }
  if (code === 'EBUSY' || code === 'ENOTEMPTY') {
    return 'FILESYSTEM_BUSY';
  }
  return 'UNKNOWN_EXCEPTION';
}

function projectionDiagnosticDetails(details?: JsonObject): JsonObject {
  if (details === undefined) {
    return {};
  }
  const output: Record<string, string | number> = {};
  copyStringDetail(details, output, 'failureStage');
  copyStringDetail(details, output, 'failureReasonCode');
  copyNumberDetail(details, output, 'resourceCount');
  copyNumberDetail(details, output, 'maxResourceCount');
  copyNumberDetail(details, output, 'pathLength');
  copyNumberDetail(details, output, 'maxPathLength');
  copyNumberDetail(details, output, 'sizeBytes');
  copyNumberDetail(details, output, 'expectedSizeBytes');
  copyNumberDetail(details, output, 'lockWaitMs');
  return output;
}

function copyStringDetail(source: JsonObject, target: Record<string, string | number>, key: string): void {
  const value = source[key];
  if (typeof value === 'string' && /^[A-Z0-9_]+$/u.test(value)) {
    target[key] = value;
  }
}

function copyNumberDetail(source: JsonObject, target: Record<string, string | number>, key: string): void {
  const value = source[key];
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) {
    target[key] = value;
  }
}

function sourceHandleMode(sourceMetadata?: SkillMetadata['sourceMetadata']): 'governed' | 'fallback' {
  return typeof sourceMetadata?.sourceIdentity === 'string' || typeof sourceMetadata?.frontmatterHash === 'string' ? 'governed' : 'fallback';
}

function jsonDepth(value: JsonValue): number {
  if (Array.isArray(value)) {
    return 1 + Math.max(0, ...value.map(jsonDepth));
  }
  if (isJsonObject(value)) {
    return 1 + Math.max(0, ...Object.values(value).map(jsonDepth));
  }
  return 0;
}

function isJsonSerializable(value: JsonObject): boolean {
  try {
    JSON.stringify(value);
    return true;
  } catch {
    return false;
  }
}

function isJsonObject(value: unknown): value is JsonObject {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

interface ParsedApiCommand {
  readonly name: string;
  readonly hiro?: string;
}

function parseApiCommand(body: string): ParsedApiCommand | undefined {
  const codeBlockMatch = body.match(/```api\s+([\s\S]*?)```/iu);
  if (codeBlockMatch === null || codeBlockMatch[1] === undefined) {
    return undefined;
  }
  const commandText = codeBlockMatch[1].trim();
  const nameMatch = commandText.match(/-name\s+(\S+)/iu);
  if (nameMatch === null || nameMatch[1] === undefined) {
    return undefined;
  }
  const hiroMatch = commandText.match(/-hiro\s+(\S+)/iu);
  return {
    name: nameMatch[1],
    ...(hiroMatch !== null && hiroMatch[1] !== undefined ? { hiro: hiroMatch[1] } : {}),
  };
}
