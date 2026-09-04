import { AgentError } from '@nextagent/agent-common';
import type { CapabilityContextPatch, CapabilityDescriptor } from '@nextagent/agent-contracts/capability';
import type { SkillDisclosureMode, ToolDisclosureMode } from '../prompt-shaping/skill-disclosure-mode.js';

/**
 * Capability context filtering (extracted from assemble-context.ts).
 *
 * Owns the allow/deny tool patch logic and capability deduplication.
 * Pure functions of their inputs — no side effects, no gateway calls.
 */

/**
 * Apply a `CapabilityContextPatch` (allowedTools / deniedTools) to
 * the model-invocable capability set. Allowed tools are added first,
 * then denied tools are excluded.
 */
export function applyCapabilityContextPatch(
  capabilities: readonly CapabilityDescriptor[],
  patch: CapabilityContextPatch | undefined,
  availableCapabilities: readonly CapabilityDescriptor[],
): readonly CapabilityDescriptor[] {
  const withAllowed =
    patch?.allowedTools === undefined
      ? capabilities
      : uniqueCapabilities([...capabilities, ...resolveAllowedTools(patch.allowedTools, availableCapabilities)]);
  return excludeDeniedTools(withAllowed, patch?.deniedTools);
}

/**
 * ToolSearch is the default governed discovery entry for deferred
 * capabilities. Keeping it visible must not prune or rewrite the
 * pre-existing governed tool surface; lazy loading only adds request-local
 * discovered capabilities.
 */
export function applyToolSearchDisclosurePolicy(
  capabilities: readonly CapabilityDescriptor[],
  _patch: CapabilityContextPatch | undefined,
  toolDisclosureMode: ToolDisclosureMode = 'list',
  skillDisclosureMode: SkillDisclosureMode = 'list',
): readonly CapabilityDescriptor[] {
  void toolDisclosureMode;
  void skillDisclosureMode;
  return capabilities;
}

/**
 * Resolve `allowedTools` capability IDs against the full available
 * capability set. Each allowed tool ID must correspond to an existing
 * TOOL-kind capability; unknown IDs throw an authorization error.
 */
export function resolveAllowedTools(
  allowedTools: CapabilityContextPatch['allowedTools'],
  availableCapabilities: readonly CapabilityDescriptor[],
): readonly CapabilityDescriptor[] {
  if (allowedTools === undefined) {
    return [];
  }
  const activated: CapabilityDescriptor[] = [];
  const availableToolByRef = new Map<string, CapabilityDescriptor>();
  for (const capability of availableCapabilities) {
    if (capability.kind !== 'TOOL') {
      continue;
    }
    for (const ref of capabilityRefs(capability)) {
      if (!availableToolByRef.has(ref)) {
        availableToolByRef.set(ref, capability);
      }
      const lowerRef = ref.toLowerCase();
      if (!availableToolByRef.has(lowerRef)) {
        availableToolByRef.set(lowerRef, capability);
      }
    }
  }
  for (const capabilityId of allowedTools) {
    const capability = availableToolByRef.get(capabilityId) ?? availableToolByRef.get(capabilityId.toLowerCase());
    if (capability === undefined) {
      throw new AgentError({
        code: 'CAPABILITY_CONTEXT_PATCH_DENIED',
        message: 'Capability context patch is not authorized.',
        category: 'AUTHORIZATION',
        retryable: false,
      });
    }
    activated.push(capability);
  }
  return activated;
}

/**
 * Remove capabilities whose tool refs appear in the `deniedTools` set.
 */
export function excludeDeniedTools(
  capabilities: readonly CapabilityDescriptor[],
  deniedTools: CapabilityContextPatch['deniedTools'],
): readonly CapabilityDescriptor[] {
  if (deniedTools === undefined) {
    return capabilities;
  }
  const denied = new Set<string>(deniedTools.flatMap((tool) => [tool, tool.toLowerCase()]));
  return capabilities.filter(
    (capability) => capability.kind !== 'TOOL' || !capabilityRefs(capability).some((ref) => denied.has(ref) || denied.has(ref.toLowerCase())),
  );
}

/**
 * Stable ref set for a capability: the bare capabilityId and the
 * provider-qualified `@providerId/capabilityId` form.
 */
export function capabilityRefs(capability: CapabilityDescriptor): readonly string[] {
  return [capability.capabilityId, `@${capability.provider.providerId}/${capability.capabilityId}`];
}

/**
 * Deduplicate capabilities by a composite key of
 * `providerId\0kind\0capabilityId`.
 */
export function uniqueCapabilities(capabilities: readonly CapabilityDescriptor[]): readonly CapabilityDescriptor[] {
  const byKey = new Map<string, CapabilityDescriptor>();
  for (const capability of capabilities) {
    byKey.set(`${capability.provider.providerId}\0${capability.kind}\0${capability.capabilityId}`, capability);
  }
  return [...byKey.values()];
}
