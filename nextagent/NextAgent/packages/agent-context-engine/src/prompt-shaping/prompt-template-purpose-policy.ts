import { AgentError } from '@nextagent/agent-common';
import { SYSTEM_PROMPT_CACHE_BOUNDARY_MARKER, type SystemPromptSectionMetadata } from '@nextagent/agent-contracts/context';
import { SYSTEM_PROMPT, type PromptSection } from './prompt-template-types.js';

const systemSectionOrder = [
  'identity',
  'system_behavior',
  'task_approach',
  'communication_style',
  'agent_delegation',
  'tooling',
  'memory',
  'skill_disclosure',
  'action_safety',
  'context_management',
  'workspace',
  'runtime',
  'environment',
  'project_context',
  'dynamic_context',
  'session_context',
] as const;

const configurableSystemSections = new Set<string>(systemSectionOrder);
const dynamicSystemSections = new Set<string>([
  'runtime',
  'environment',
  'skill_disclosure',
  'project_context',
  'dynamic_context',
  'session_context',
]);
const sealedSystemPlacements = new Set<string>(['cache_boundary', 'system_protocol', 'developer_protocol']);

interface PromptCompilePolicy {
  validateContentShape: (input: { readonly templateId: string; readonly contentKind: 'string' | 'sections' }) => void;
  validateSectionId: (input: { readonly templateId: string; readonly sectionId: string }) => void;
}

interface PromptRenderPolicy {
  orderSections: (sections: readonly PromptSection[], filters?: SystemSectionRenderFilters) => readonly PromptSection[];
}

/**
 * Conditional system section filters derived from the render context.
 * The `memory` section renders only when `memoryEnabled` is true, i.e.
 * when the gating memory capability is visible to the model for the
 * accepted Agent. The `skill_disclosure` section renders only when the
 * Skill disclosure gate passes, i.e. the `Skill` tool entry (and, in
 * `tool-search` mode, the `ToolSearch` tool entry) is visible and the
 * governed Skill list projection is non-empty.
 */
export interface SystemSectionRenderFilters {
  readonly memoryEnabled: boolean;
  readonly skillDisclosureVisible: boolean;
}

const defaultCompilePolicy: PromptCompilePolicy = {
  validateContentShape: () => undefined,
  validateSectionId: () => undefined,
};

const systemCompilePolicy: PromptCompilePolicy = {
  validateContentShape(input) {
    if (input.contentKind === 'string') {
      throw promptTemplatePolicyError('PROMPT_SYSTEM_CONTENT_ARRAY_REQUIRED', 'SYSTEM_PROMPT content must be a section array.', {
        templateId: input.templateId,
      });
    }
  },
  validateSectionId(input) {
    if (sealedSystemPlacements.has(input.sectionId)) {
      throw promptTemplatePolicyError('PROMPT_SYSTEM_SECTION_SEALED', 'SYSTEM_PROMPT section id is sealed by the system policy.', {
        templateId: input.templateId,
        sectionId: input.sectionId,
      });
    }
    if (!configurableSystemSections.has(input.sectionId)) {
      throw promptTemplatePolicyError('PROMPT_SYSTEM_SECTION_UNSUPPORTED', 'SYSTEM_PROMPT section id is unsupported.', {
        templateId: input.templateId,
        sectionId: input.sectionId,
      });
    }
  },
};

const defaultRenderPolicy: PromptRenderPolicy = {
  orderSections: (sections) => sections,
};

const systemRenderPolicy: PromptRenderPolicy = {
  orderSections(sections, filters) {
    const byId = new Map(sections.map((section) => [section.id, section]));
    return systemSectionOrder.flatMap((id) => {
      if (id === 'memory' && filters?.memoryEnabled !== true) {
        return [];
      }
      if (id === 'skill_disclosure' && filters?.skillDisclosureVisible !== true) {
        return [];
      }
      const section = byId.get(id);
      return section === undefined ? [] : [section];
    });
  },
};

export function compilePolicyForPurpose(purpose: string): PromptCompilePolicy {
  return purpose === SYSTEM_PROMPT ? systemCompilePolicy : defaultCompilePolicy;
}

export function renderPolicyForPurpose(purpose: string): PromptRenderPolicy {
  return purpose === SYSTEM_PROMPT ? systemRenderPolicy : defaultRenderPolicy;
}

export function defaultSystemPromptSectionOrder(): readonly string[] {
  return systemSectionOrder;
}

export function systemPromptSectionMetadata(sectionId: string, order: number): SystemPromptSectionMetadata {
  return {
    overridable: configurableSystemSections.has(sectionId),
    sectionKey: sectionId,
    order,
    dependencies: [],
  };
}

export function renderSystemPromptContent(sections: ReadonlyArray<{ readonly sectionId: string; readonly content: string }>): string {
  const stable = sections.filter((section) => !dynamicSystemSections.has(section.sectionId));
  const dynamic = sections.filter((section) => dynamicSystemSections.has(section.sectionId));
  const stableText = stable.map((section) => section.content).join('\n\n');
  const dynamicText = dynamic.map((section) => section.content).join('\n\n');
  if (stableText.length === 0) {
    return dynamicText;
  }
  if (dynamicText.length === 0) {
    return stableText;
  }
  return `${stableText}\n\n${SYSTEM_PROMPT_CACHE_BOUNDARY_MARKER}\n\n${dynamicText}`;
}

function promptTemplatePolicyError(code: string, message: string, safeDetails: Record<string, string>): AgentError {
  return new AgentError({
    code,
    message,
    category: 'VALIDATION',
    retryable: false,
    safeDetails,
  });
}
