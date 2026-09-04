import { release as osRelease } from 'node:os';
import { AgentError } from '@nextagent/agent-common';
import type { SystemPrompt } from '@nextagent/agent-contracts/context';
import type { ModelInferenceOptions } from '@nextagent/agent-contracts/model';
import {
  type PromptAssemblyRequest,
  type PromptAssemblyResult,
  type PromptSection,
  type PromptTemplate,
  type PromptTemplateAssembler,
  type PromptTemplateRegistry,
  type RenderedPromptSection,
} from './prompt-template-types.js';
import { renderPolicyForPurpose, systemPromptSectionMetadata } from './prompt-template-purpose-policy.js';
import { createDefaultPromptTemplateRegistry } from './prompt-template-registry.js';
import {
  createDefaultPromptTemplateVariableResolver,
  renderPromptTemplateWithVariables,
  type PromptTemplateRenderContext,
  type TemplateVariableRequirement,
} from './variable-resolver.js';

export class DefaultPromptTemplateAssembler implements PromptTemplateAssembler {
  constructor(private readonly registry: PromptTemplateRegistry = createDefaultPromptTemplateRegistry()) {}

  async assemble(request: PromptAssemblyRequest): Promise<PromptAssemblyResult> {
    const agentId = String(request.agentId);
    const agentVersion = String(request.agentVersion);
    const allTemplates = this.registry.templatesFor(agentId, agentVersion);
    const template = selectTemplate(allTemplates, request);
    const builtinFallback = template.sourceLayer === 'agent' ? selectOptionalBuiltin(allTemplates, request) : undefined;
    const sections = renderSections(template, request, builtinFallback);
    return {
      templateId: template.templateId,
      templateRef: template.templateRef,
      sections,
      renderedContent: sections.map((section) => section.content).join('\n\n'),
      ...(template.modelOptions === undefined ? {} : { modelOptions: template.modelOptions }),
    };
  }
}

export function createDefaultPromptTemplateAssembler(registry?: PromptTemplateRegistry): DefaultPromptTemplateAssembler {
  return new DefaultPromptTemplateAssembler(registry);
}

export function systemPromptFromAssemblyResult(result: PromptAssemblyResult): SystemPrompt {
  return {
    sections: result.sections.map((section, index) => ({
      sectionId: section.id,
      heading: section.id,
      content: section.content,
      metadata: systemPromptSectionMetadata(section.id, index),
    })),
  };
}

export function mergePromptModelOptions(base: ModelInferenceOptions, override?: ModelInferenceOptions): ModelInferenceOptions {
  if (override === undefined) {
    return base;
  }
  return {
    ...base,
    ...(override.temperature === undefined ? {} : { temperature: override.temperature }),
    ...(override.maxOutputTokens === undefined ? {} : { maxOutputTokens: override.maxOutputTokens }),
    ...(override.topP === undefined ? {} : { topP: override.topP }),
    ...(override.topK === undefined ? {} : { topK: override.topK }),
    ...(override.presencePenalty === undefined ? {} : { presencePenalty: override.presencePenalty }),
    ...(override.frequencyPenalty === undefined ? {} : { frequencyPenalty: override.frequencyPenalty }),
    ...(override.thinking === undefined ? {} : { thinking: override.thinking }),
    ...(override.toolChoice === undefined ? {} : { toolChoice: override.toolChoice }),
    ...(override.providerOptions === undefined ? {} : { providerOptions: { ...(base.providerOptions ?? {}), ...override.providerOptions } }),
  };
}

function selectTemplate(templates: readonly PromptTemplate[], request: PromptAssemblyRequest): PromptTemplate {
  const matches = templates.filter((template) => templateMatches(template, request));
  if (matches.length === 0) {
    throw promptAssemblyError('PROMPT_TEMPLATE_NOT_FOUND', 'No prompt template matches the assembly request.', {
      purpose: request.purpose,
    });
  }
  const selectedLayer = matches.some((template) => template.sourceLayer === 'agent') ? 'agent' : 'builtin';
  const layerMatches = matches.filter((template) => template.sourceLayer === selectedLayer);
  const ranked = layerMatches.map((template) => ({
    template,
    specificity: specificity(template, request),
  }));
  const max = Math.max(...ranked.map((item) => item.specificity));
  const highest = ranked.filter((item) => item.specificity === max);
  if (highest.length !== 1) {
    throw promptAssemblyError('PROMPT_TEMPLATE_AMBIGUOUS_RESOLUTION', 'Prompt template resolution is ambiguous.', {
      purpose: request.purpose,
      sourceLayer: selectedLayer,
      templateIds: highest.map((item) => item.template.templateId).join(','),
      templateRefs: highest.map((item) => item.template.templateRef).join(','),
    });
  }
  return highest[0]!.template;
}

function templateMatches(template: PromptTemplate, request: PromptAssemblyRequest): boolean {
  if (template.purpose !== request.purpose) {
    return false;
  }
  if (template.sourceLayer === 'agent' && (template.agentId !== String(request.agentId) || template.agentVersion !== String(request.agentVersion))) {
    return false;
  }
  if (template.match?.locale !== undefined && template.match.locale !== request.locale) {
    return false;
  }
  if (template.match?.model !== undefined) {
    if (template.match.model !== request.selectedModel.modelId) {
      return false;
    }
  }
  for (const [key, value] of Object.entries(template.match?.flowVariables ?? {})) {
    if (request.flowVariables[key] !== value) {
      return false;
    }
  }
  return true;
}

function specificity(template: PromptTemplate, request: PromptAssemblyRequest): number {
  let score = 0;
  if (template.match?.locale !== undefined && template.match.locale === request.locale) {
    score += 1;
  }
  if (template.match?.model !== undefined && template.match.model === request.selectedModel.modelId) {
    score += 1;
  }
  for (const [key, value] of Object.entries(template.match?.flowVariables ?? {})) {
    if (request.flowVariables[key] === value) {
      score += 1;
    }
  }
  return score;
}

function renderSections(
  template: PromptTemplate,
  request: PromptAssemblyRequest,
  builtinFallback?: PromptTemplate,
): readonly RenderedPromptSection[] {
  const ctx = buildPromptTemplateRenderContext(request);
  const ordered = renderPolicyForPurpose(template.purpose).orderSections(mergeSections(template, builtinFallback), {
    memoryEnabled: ctx.memoryEnabled === true,
    skillDisclosureVisible: skillDisclosureVisible(ctx),
  });
  const resolver = createDefaultPromptTemplateVariableResolver();
  const rendered: RenderedPromptSection[] = [];
  for (const section of ordered) {
    const requirements = new Map<string, TemplateVariableRequirement>(
      section.variables.map((variable) => [variable.name, variable.optional ? 'optional' : 'required']),
    );
    const result = renderPromptTemplateWithVariables(section.content, ctx, resolver, requirements);
    if (result.rendered.trim().length > 0) {
      rendered.push({ id: section.id, content: result.rendered });
    }
  }
  return rendered;
}

function mergeSections(template: PromptTemplate, builtinFallback?: PromptTemplate): readonly PromptSection[] {
  if (builtinFallback === undefined) {
    return template.sections;
  }
  const agentIds = new Set(template.sections.map((s) => s.id));
  const fallbackSections = builtinFallback.sections.filter((s) => !agentIds.has(s.id));
  return [...template.sections, ...fallbackSections];
}

function selectOptionalBuiltin(templates: readonly PromptTemplate[], request: PromptAssemblyRequest): PromptTemplate | undefined {
  const builtins = templates.filter((t) => t.sourceLayer === 'builtin' && templateMatches(t, request));
  if (builtins.length === 0) {
    return undefined;
  }
  const ranked = builtins.map((t) => ({ template: t, specificity: specificity(t, request) }));
  const max = Math.max(...ranked.map((item) => item.specificity));
  const best = ranked.filter((item) => item.specificity === max);
  return best.length === 1 ? best[0]!.template : builtins[0];
}

function buildPromptTemplateRenderContext(request: PromptAssemblyRequest): PromptTemplateRenderContext {
  const now = new Date();
  const currentDate = [
    now.getFullYear().toString().padStart(4, '0'),
    (now.getMonth() + 1).toString().padStart(2, '0'),
    now.getDate().toString().padStart(2, '0'),
  ].join('-');
  return {
    agentId: String(request.agentId),
    agentVersion: String(request.agentVersion),
    selectedModel: request.selectedModel,
    environmentInfo: {
      platform: process.platform,
      osVersion: osRelease(),
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone ?? 'UTC',
      currentDate,
    },
    ...(request.locale === undefined ? {} : { locale: String(request.locale) }),
    flowVariables: request.flowVariables,
    workspaceDir: 'workspace/',
    memoryEnabled: request.memoryEnabled === true,
    ...(request.skillDisclosure === undefined ? {} : { skillDisclosure: request.skillDisclosure }),
  };
}

/**
 * The `skill_disclosure` section renders only when the governed Skill
 * list projection is non-empty. Tool-entry visibility (`Skill`, and in
 * `tool-search` mode `ToolSearch`) is checked by the caller when it
 * derives the projection, so the render filter only enforces the
 * non-empty list here.
 */
function skillDisclosureVisible(ctx: PromptTemplateRenderContext): boolean {
  return (ctx.skillDisclosure?.skills ?? []).length > 0;
}

function promptAssemblyError(code: string, message: string, safeDetails: Record<string, string>): AgentError {
  return new AgentError({
    code,
    message,
    category: 'VALIDATION',
    retryable: false,
    safeDetails,
  });
}
