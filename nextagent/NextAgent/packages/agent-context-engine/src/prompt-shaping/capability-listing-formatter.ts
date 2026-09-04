import type { CapabilityDescriptor } from '@nextagent/agent-contracts/capability';

/**
 * Formats the `skills` section from the request-scoped capability view.
 * Only SKILL capabilities are rendered here; TOOL capabilities are projected
 * into RenderedModelInput.tools by the renderer.
 */
export const SKILL_BULLET_CHAR_BUDGET = 4_000;
export const MAX_SKILL_DESCRIPTION_CHARS = 240;

export interface FormatSkillsOptions {
  readonly charBudget?: number;
  readonly maxDescriptionChars?: number;
}

export function formatSkillsSection(capabilities: readonly CapabilityDescriptor[], options: FormatSkillsOptions = {}): string {
  const skills = capabilities.filter((capability) => capability.kind === 'SKILL');
  if (skills.length === 0) {
    return '';
  }

  const charBudget = options.charBudget ?? SKILL_BULLET_CHAR_BUDGET;
  const maxDescriptionChars = options.maxDescriptionChars ?? MAX_SKILL_DESCRIPTION_CHARS;
  const lines: string[] = [];
  let used = 'Available skills:\n'.length;

  for (const skill of skills) {
    const description = truncateDescription(skill.description, maxDescriptionChars, skill);
    const line = `- ${skill.capabilityId}: ${description}`;
    if (used + line.length + 1 > charBudget) {
      break;
    }
    lines.push(line);
    used += line.length + 1;
  }

  return lines.length === 0 ? '' : ['Available skills:', ...lines].join('\n');
}

function truncateDescription(description: string, maxChars: number, skill: CapabilityDescriptor): string {
  if (skill.provider.providerKind === 'BUNDLED' || description.length <= maxChars) {
    return description;
  }
  return `${description.slice(0, maxChars)}...`;
}
