import { isDeepStrictEqual } from 'node:util';
import { AgentError } from '@nextagent/agent-common';
import type { AgentAssembly } from '@nextagent/agent-contracts/agent-assembly';
import type { CapabilityContextPatch, CapabilityDescriptor } from '@nextagent/agent-contracts/capability';
import { ModelIdSchema, ModelInferenceOptionsSchema } from '@nextagent/agent-contracts/model';
import { Ajv } from 'ajv/dist/ajv.js';

const ajv = new Ajv({ allErrors: true, strict: false });
const validateModelId = ajv.compile(ModelIdSchema);
const validateModelOptions = ajv.compile(ModelInferenceOptionsSchema);

export interface AuthorizedCapabilityModelPatch {
  readonly modelId?: string;
  readonly modelOptions?: CapabilityContextPatch['modelOptions'];
}

export function authorizeCapabilityModelPatch(
  descriptor: CapabilityDescriptor,
  patch: CapabilityContextPatch | undefined,
  assembly: AgentAssembly,
): AuthorizedCapabilityModelPatch | undefined {
  const candidate = modelPatchFrom(patch);
  if (candidate === undefined) {
    return undefined;
  }
  if (!isCanonicalSkillTool(descriptor)) {
    throw denied();
  }
  if (candidate.modelId !== undefined && (!validateModelId(candidate.modelId) || !assembly.modelIds.includes(candidate.modelId))) {
    throw denied();
  }
  if (candidate.modelOptions !== undefined && !validateModelOptions(candidate.modelOptions)) {
    throw denied();
  }
  return candidate;
}

export function mergeGovernedCapabilityContextPatch(
  current: CapabilityContextPatch | undefined,
  effectivePatch: CapabilityContextPatch,
  authorizedModelPatch?: AuthorizedCapabilityModelPatch,
): CapabilityContextPatch {
  if (!isDeepStrictEqual(modelPatchFrom(effectivePatch), authorizedModelPatch)) {
    throw denied();
  }
  return {
    ...(current ?? {}),
    ...(effectivePatch.allowedTools === undefined
      ? {}
      : { allowedTools: unique([...(current?.allowedTools ?? []), ...effectivePatch.allowedTools]) }),
    ...(effectivePatch.deniedTools === undefined ? {} : { deniedTools: unique([...(current?.deniedTools ?? []), ...effectivePatch.deniedTools]) }),
    ...(effectivePatch.discoveredSkills === undefined
      ? {}
      : { discoveredSkills: unique([...(current?.discoveredSkills ?? []), ...effectivePatch.discoveredSkills]) }),
    ...(authorizedModelPatch?.modelId === undefined ? {} : { modelId: authorizedModelPatch.modelId }),
    ...(authorizedModelPatch?.modelOptions === undefined
      ? {}
      : { modelOptions: mergeModelOptions(current?.modelOptions, authorizedModelPatch.modelOptions) }),
  };
}

function mergeModelOptions(
  current: CapabilityContextPatch['modelOptions'],
  next: NonNullable<CapabilityContextPatch['modelOptions']>,
): NonNullable<CapabilityContextPatch['modelOptions']> {
  return {
    ...(current ?? {}),
    ...next,
    ...(current?.providerOptions === undefined && next.providerOptions === undefined
      ? {}
      : {
          providerOptions: {
            ...(current?.providerOptions ?? {}),
            ...(next.providerOptions ?? {}),
          },
        }),
  };
}

function modelPatchFrom(patch?: CapabilityContextPatch): AuthorizedCapabilityModelPatch | undefined {
  if (patch?.modelId === undefined && patch?.modelOptions === undefined) {
    return undefined;
  }
  return {
    ...(patch.modelId === undefined ? {} : { modelId: patch.modelId }),
    ...(patch.modelOptions === undefined ? {} : { modelOptions: patch.modelOptions }),
  };
}

function isCanonicalSkillTool(descriptor: CapabilityDescriptor): boolean {
  return (
    descriptor.capabilityId === 'Skill' &&
    descriptor.kind === 'TOOL' &&
    descriptor.provider.providerId === 'builtin-tools' &&
    descriptor.provider.providerKind === 'BUNDLED' &&
    descriptor.availabilityStatus === 'AVAILABLE'
  );
}

function unique<T>(values: readonly T[]): readonly T[] {
  return [...new Set(values)];
}

function denied(): AgentError {
  return new AgentError({
    code: 'CAPABILITY_MODEL_PATCH_DENIED',
    message:
      'The capability returned a model-configuration patch that is not authorized for this capability or Agent assembly, so the result was rejected. Continue with the current model, choose another allowed capability, or stop and report the denied patch.',
    category: 'AUTHORIZATION',
    retryable: false,
  });
}
