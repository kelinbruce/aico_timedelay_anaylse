import { brand, type JsonObject } from '@nextagent/agent-common';
import type { CapabilityGeneratedMessage, CapabilityInvocationResult, CapabilityProviderIdentity } from '@nextagent/agent-contracts/capability';

import { SkillAcquisitionResultSchema, type SkillAcquisitionResult } from '../skill-acquisition/skill-acquisition-contract.js';
import { BuiltinToolsExecutor } from '../execution/executor.js';
import { SkillAcquisitionService } from '../skill-acquisition/skill-acquisition-service.js';
import { createToolCatalog } from '../tools/tool-catalog.js';
import { defineTool, type ToolExecuteOptions } from '../tools/tool-spi.js';

export const skillHubAcquireSkillCapabilityId = brand<string, 'CapabilityId'>('acquire_skill');

export const skillHubAcquireSkillInputSchema: JsonObject = {
  type: 'object',
  additionalProperties: false,
  properties: {
    requested_capability_id: { type: 'string', minLength: 1, maxLength: 128 },
    query: { type: 'string', minLength: 1, maxLength: 256 },
    provider_id: { type: 'string', minLength: 1, maxLength: 128 },
  },
  anyOf: [{ required: ['requested_capability_id'] }, { required: ['query'] }],
};

export const skillHubAcquireSkillOutputSchema: JsonObject = SkillAcquisitionResultSchema as unknown as JsonObject;

export const skillHubAcquireSkillToolDefinition = defineTool({
  name: skillHubAcquireSkillCapabilityId,
  description:
    'Acquire a governed SkillHub Skill when current Skills are insufficient. Successful acquisition only affects a later capability resolution and model step.',
  inputSchema: skillHubAcquireSkillInputSchema,
  outputSchema: skillHubAcquireSkillOutputSchema,
  replayPolicy: 'IDEMPOTENT',
  returnsCapabilityResult: true,
  async execute(input, options) {
    return executeAcquireSkill(input, options);
  },
});

export function createSkillHubAcquisitionExecutor(
  provider: CapabilityProviderIdentity & { readonly providerKind: 'SKILL_HUB' },
): BuiltinToolsExecutor {
  return new BuiltinToolsExecutor(
    createToolCatalog({
      provider,
      tools: [skillHubAcquireSkillToolDefinition],
    }),
  );
}

async function executeAcquireSkill(input: JsonObject, options?: ToolExecuteOptions): Promise<CapabilityInvocationResult> {
  if (options?.signal?.aborted) {
    return canceledResult();
  }
  const service = new SkillAcquisitionService({
    ...(options?.context?.capabilityResolver === undefined ? {} : { resolver: options.context.capabilityResolver }),
    ...(options?.signal === undefined ? {} : { signal: options.signal }),
  });
  const providerId = readString(input.provider_id);
  const requestedCapabilityId = readString(input.requested_capability_id);
  const query = readString(input.query);
  const result = await service.acquire({
    ...(providerId === undefined ? {} : { providerId }),
    ...(requestedCapabilityId === undefined ? {} : { requestedCapabilityId }),
    ...(query === undefined ? {} : { query }),
  });
  if (options?.signal?.aborted) {
    return canceledResult();
  }
  return toCapabilityResult(result);
}

function toCapabilityResult(result: SkillAcquisitionResult): CapabilityInvocationResult {
  if (result.outcomeCode !== 'ACQUIRED_REQUIRES_REPLAN') {
    return {
      status: 'FAILED',
      structuredPayload: {},
      generatedMessages: [],
      artifactRefs: [],
      safeError: {
        code: result.outcomeCode,
        message: result.message,
        category: acquisitionFailureCategory(result.outcomeCode),
        retryable: result.outcomeCode === 'UNAVAILABLE',
      },
    };
  }
  const generatedMessages = result.skillId === undefined ? [] : availableSkillMessages(result);
  return {
    status: 'SUCCEEDED',
    structuredPayload: result,
    generatedMessages,
    ...(result.skillId !== undefined ? { contextPatch: { discoveredSkills: [brand<string, 'CapabilityId'>(result.skillId)] } } : {}),
    artifactRefs: [],
  };
}

function acquisitionFailureCategory(
  outcomeCode: Exclude<SkillAcquisitionResult['outcomeCode'], 'ACQUIRED_REQUIRES_REPLAN'>,
): 'VALIDATION' | 'AUTHORIZATION' | 'NOT_FOUND' | 'UNAVAILABLE' | 'INTERNAL' {
  switch (outcomeCode) {
    case 'REJECTED':
      return 'VALIDATION';
    case 'UNAUTHORIZED':
      return 'AUTHORIZATION';
    case 'NOT_FOUND':
      return 'NOT_FOUND';
    case 'UNAVAILABLE':
      return 'UNAVAILABLE';
    case 'INSTALL_FAILED':
      return 'INTERNAL';
    default: {
      const exhaustive: never = outcomeCode;
      throw new Error(`Unhandled case: ${String(exhaustive)}`);
    }
  }
}

function canceledResult(): CapabilityInvocationResult {
  return {
    status: 'FAILED',
    structuredPayload: {},
    generatedMessages: [],
    artifactRefs: [],
    safeError: { code: 'ABORTED', message: 'Skill acquisition was aborted.', category: 'CANCELED', retryable: false },
  };
}

function availableSkillMessages(result: SkillAcquisitionResult): readonly CapabilityGeneratedMessage[] {
  return [
    {
      role: 'USER',
      meta: true,
      content: `<available-skills>\n- capability_id=${escapeXmlText(result.skillId ?? '')} | kind=SKILL | defer_loading=true\n</available-skills>\nSkill acquisition completed. Use the Skill tool with name equal to the acquired capability_id in the next model step.`,
    },
  ];
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function escapeXmlText(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}
