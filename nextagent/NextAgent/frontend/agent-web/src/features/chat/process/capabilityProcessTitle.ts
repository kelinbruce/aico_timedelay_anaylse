export type CapabilityProcessKind = 'TOOL' | 'SKILL' | 'AGENT' | 'WORKFLOW';

export interface CapabilityProcessIdentityInput {
  readonly capabilityKind?: unknown;
  readonly capabilityId?: unknown;
  readonly targetCapabilityId?: unknown;
}

export interface CapabilityPresentationResource {
  readonly capabilityKind: CapabilityProcessKind;
  readonly capabilityId: string;
  readonly displayName: string;
  readonly locales?: {
    readonly language: Readonly<Record<string, { readonly displayName: string }>>;
  };
}

export type CapabilityPresentationResourceMap = ReadonlyMap<string, CapabilityPresentationResource>;
export const EMPTY_CAPABILITY_PRESENTATION_RESOURCES: CapabilityPresentationResourceMap = new Map();
export type CapabilityTitleTranslation = (key: string, options?: Readonly<Record<string, unknown>>) => string;

export function resolveCapabilityProcessTitle(
  identity: CapabilityProcessIdentityInput,
  t: CapabilityTitleTranslation,
  locale: string,
  resources: CapabilityPresentationResourceMap,
): string {
  const capabilityId = normalizeIdentifier(identity.capabilityId, 256);
  if (capabilityId === undefined) {
    return translate(t, 'turn.process.capability.executeOperation') ?? 'Execute operation';
  }

  const wrapper = wrapperTemplate(capabilityId);
  if (wrapper !== undefined) {
    const targetCapabilityId = normalizeIdentifier(identity.targetCapabilityId, 128);
    if (targetCapabilityId === undefined) {
      return translate(t, wrapper.neutralKey) ?? capabilityId;
    }
    const name = resolveResourceName(wrapper.targetKind, targetCapabilityId, locale, resources) ?? targetCapabilityId;
    return translate(t, wrapper.namedKey, { name }) ?? `${capabilityId}: ${name}`;
  }

  const capabilityKind = normalizeKind(identity.capabilityKind);
  if (capabilityKind === undefined) {
    return capabilityId;
  }
  const name = resolveResourceName(capabilityKind, capabilityId, locale, resources) ?? capabilityId;
  if (capabilityKind === 'TOOL') {
    return name;
  }
  const template = directTemplate(capabilityKind);
  return translate(t, template.namedKey, { name }) ?? `${template.fallbackPrefix}: ${name}`;
}

function resolveResourceName(
  kind: CapabilityProcessKind,
  capabilityId: string,
  locale: string,
  resources: CapabilityPresentationResourceMap,
): string | undefined {
  const resource = resources.get(`${kind}:${capabilityId}`);
  if (resource === undefined) {
    return undefined;
  }
  return resource.locales?.language[locale]?.displayName ?? resource.locales?.language['en-US']?.displayName ?? resource.displayName;
}

function wrapperTemplate(
  capabilityId: string,
): { readonly targetKind: CapabilityProcessKind; readonly neutralKey: string; readonly namedKey: string } | undefined {
  if (capabilityId === 'Agent') {
    return { targetKind: 'AGENT', neutralKey: 'turn.process.capability.invokeAgent', namedKey: 'turn.process.capability.invokeAgentNamed' };
  }
  if (capabilityId === 'Skill') {
    return { targetKind: 'SKILL', neutralKey: 'turn.process.capability.loadSkill', namedKey: 'turn.process.capability.loadSkillNamed' };
  }
  if (capabilityId === 'Workflow') {
    return { targetKind: 'WORKFLOW', neutralKey: 'turn.process.capability.runWorkflow', namedKey: 'turn.process.capability.runWorkflowNamed' };
  }
  return undefined;
}

function directTemplate(kind: Exclude<CapabilityProcessKind, 'TOOL'>): { readonly namedKey: string; readonly fallbackPrefix: string } {
  if (kind === 'AGENT') {
    return { namedKey: 'turn.process.capability.invokeAgentNamed', fallbackPrefix: 'Invoke sub-agent' };
  }
  if (kind === 'SKILL') {
    return { namedKey: 'turn.process.capability.loadSkillNamed', fallbackPrefix: 'Load skill' };
  }
  return { namedKey: 'turn.process.capability.runWorkflowNamed', fallbackPrefix: 'Run preset workflow' };
}

function normalizeKind(value: unknown): CapabilityProcessKind | undefined {
  return value === 'TOOL' || value === 'SKILL' || value === 'AGENT' || value === 'WORKFLOW' ? value : undefined;
}

function normalizeIdentifier(value: unknown, maxCodePoints: number): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 && Array.from(trimmed).length <= maxCodePoints && !/\p{Cc}/u.test(trimmed) ? trimmed : undefined;
}

function translate(t: CapabilityTitleTranslation, key: string, options?: Readonly<Record<string, unknown>>): string | undefined {
  const value = t(key, options).trim();
  return value.length > 0 && value !== key ? value : undefined;
}
