import { AgentError } from '@nextagent/agent-common';
import type { CapabilityDescriptor } from '@nextagent/agent-contracts/capability';
import type { SkillDisclosureMode } from './skill-disclosure-mode.js';

/**
 * Prompt template variable resolution for the purpose-aware
 * assembly boundary.
 *
 * The resolver owns a closed-registration table of safe variables
 * keyed by name. Prompt template assembly rejects unknown variables
 * during compilation/rendering instead of passing them through.
 */
export interface PromptTemplateRenderContext {
  readonly agentId: string;
  readonly agentVersion: string;
  readonly sessionId?: string;
  readonly selectedModel: {
    readonly modelId: string;
  };
  readonly environmentInfo: {
    readonly platform: string;
    readonly osVersion: string;
    readonly timezone: string;
    readonly currentDate: string;
  };
  readonly locale?: string;
  readonly flowVariables: Readonly<Record<string, string>>;
  readonly workspaceDir: string;
  readonly memoryEnabled?: boolean;
  readonly skillDisclosure?: {
    readonly mode: SkillDisclosureMode;
    readonly skills: readonly CapabilityDescriptor[];
    readonly body: string;
  };
}

export interface PromptTemplateVariableDescriptor {
  readonly name: string;
  readonly description: string;
  readonly resolve: (ctx: PromptTemplateRenderContext) => string;
}

export interface PromptTemplateVariableResolver {
  readonly supportedVariableNames: readonly string[];
  resolve: (name: string, ctx: PromptTemplateRenderContext) => PromptTemplateVariableResolution;
}

export interface PromptTemplateVariableResolution {
  readonly name: string;
  readonly value: string;
  readonly unresolved: boolean;
}

export class DefaultPromptTemplateVariableResolver implements PromptTemplateVariableResolver {
  private readonly table: ReadonlyMap<string, PromptTemplateVariableDescriptor>;
  readonly supportedVariableNames: readonly string[];

  constructor(variables: readonly PromptTemplateVariableDescriptor[] = defaultPromptTemplateVariableDescriptors()) {
    this.table = new Map(variables.map((entry) => [entry.name, entry]));
    this.supportedVariableNames = [...this.table.keys()];
  }

  resolve(name: string, ctx: PromptTemplateRenderContext): PromptTemplateVariableResolution {
    const descriptor = this.table.get(name);
    if (descriptor === undefined) {
      return { name, value: `{{${name}}}`, unresolved: true };
    }
    try {
      const value = descriptor.resolve(ctx);
      return { name, value, unresolved: false };
    } catch {
      return { name, value: `{{${name}}}`, unresolved: true };
    }
  }
}

export function createDefaultPromptTemplateVariableResolver(
  variables: readonly PromptTemplateVariableDescriptor[] = defaultPromptTemplateVariableDescriptors(),
): PromptTemplateVariableResolver {
  return new DefaultPromptTemplateVariableResolver(variables);
}

export function defaultPromptTemplateVariableDescriptors(): readonly PromptTemplateVariableDescriptor[] {
  return [
    { name: 'agentId', description: 'agent identifier', resolve: (ctx) => ctx.agentId },
    { name: 'agentVersion', description: 'agent version', resolve: (ctx) => ctx.agentVersion },
    { name: 'sessionId', description: 'session identifier', resolve: (ctx) => ctx.sessionId ?? '' },
    {
      name: 'modelInfo',
      description: 'canonical model identifier',
      resolve: (ctx) => ctx.selectedModel.modelId,
    },
    {
      name: 'runtimeInfo',
      description: 'selected model runtime projection',
      resolve: (ctx) => `model=${ctx.selectedModel.modelId}`,
    },
    {
      name: 'runtime',
      description: 'safe runtime summary',
      resolve: (ctx) => `model=${ctx.selectedModel.modelId}; date=${ctx.environmentInfo.currentDate}`,
    },
    {
      name: 'environment',
      description: 'platform / os / timezone / date',
      resolve: (ctx) =>
        `${ctx.environmentInfo.platform} ${ctx.environmentInfo.osVersion} (${ctx.environmentInfo.timezone}, ${ctx.environmentInfo.currentDate})`,
    },
    {
      name: 'skillDisclosureList',
      description: 'governed bullet list of model-invocable SKILL capabilities',
      resolve: (ctx) => (ctx.skillDisclosure?.skills ?? []).map((skill) => `- ${skill.capabilityId}: ${skill.description}`).join('\n'),
    },
    {
      name: 'skillDisclosureMode',
      description: 'trusted skill disclosure mode (list or tool-search)',
      resolve: (ctx) => ctx.skillDisclosure?.mode ?? 'list',
    },
    {
      name: 'skillDisclosureBody',
      description: 'mode-aware builtin default `How to use skills` instruction body from the projection',
      resolve: (ctx) => ctx.skillDisclosure?.body ?? '',
    },
    {
      name: 'networkEnvironment',
      description: 'telecom network environment safe flow variable',
      resolve: (ctx) => ctx.flowVariables['networkEnvironment'] ?? '',
    },
    {
      name: 'isProduction',
      description: 'true when operationLevel flow variable is production',
      resolve: (ctx) => (ctx.flowVariables['operationLevel'] === 'PRODUCTION' ? 'true' : 'false'),
    },
    { name: 'timezone', description: 'current IANA timezone', resolve: (ctx) => ctx.environmentInfo.timezone },
    { name: 'currentDate', description: 'current date in YYYY-MM-DD', resolve: (ctx) => ctx.environmentInfo.currentDate },
    { name: 'locale', description: 'request locale', resolve: (ctx) => ctx.locale ?? '' },
    { name: 'selectedModelId', description: 'canonical selected model id', resolve: (ctx) => ctx.selectedModel.modelId },
    { name: 'platform', description: 'host platform identifier', resolve: (ctx) => ctx.environmentInfo.platform },
    { name: 'osVersion', description: 'host operating system version', resolve: (ctx) => ctx.environmentInfo.osVersion },
    { name: 'workspaceDir', description: 'workspace root directory path', resolve: (ctx) => ctx.workspaceDir },
  ];
}

/**
 * Replace `{{name}}` and `{{name?}}` tokens in a content string
 * with values from the resolver. Unknown names and unresolved
 * required variables fail closed. Optional variables render as an
 * empty string when unresolved.
 */
export interface RenderTemplateResult {
  readonly rendered: string;
  readonly unresolvedVariableNames: readonly string[];
}

export type TemplateVariableRequirement = 'required' | 'optional';

export function renderPromptTemplateWithVariables(
  content: string,
  ctx: PromptTemplateRenderContext,
  resolver: PromptTemplateVariableResolver,
  variableRequirements: ReadonlyMap<string, TemplateVariableRequirement> = new Map(),
): RenderTemplateResult {
  const pattern = /\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)(\?)?\s*\}\}/g;
  const anyMustachePattern = /\{\{([^}]*)\}\}/g;
  const unresolved: string[] = [];
  const seenUnresolved = new Set<string>();
  const supported = new Set(resolver.supportedVariableNames);
  const validTokens = new Set<string>();
  const rendered = content.replace(pattern, (_match, name: string, optionalMarker?: string) => {
    validTokens.add(_match);
    if (!supported.has(name)) {
      throw new AgentError({
        code: 'TEMPLATE_VARIABLE_UNKNOWN',
        message: 'Prompt template references an unknown variable.',
        category: 'VALIDATION',
        retryable: false,
        safeDetails: { variableName: name },
      });
    }
    const requirement = optionalMarker === '?' ? 'optional' : (variableRequirements.get(name) ?? 'required');
    const resolution = resolver.resolve(name, ctx);
    if (resolution.unresolved && !seenUnresolved.has(name)) {
      seenUnresolved.add(name);
      unresolved.push(name);
    }
    if (resolution.unresolved && requirement === 'required') {
      throw new AgentError({
        code: 'TEMPLATE_VARIABLE_REQUIRED_UNRESOLVED',
        message: `Required template variable ${name} could not be resolved.`,
        category: 'VALIDATION',
        retryable: false,
        safeDetails: { variableName: name },
      });
    }
    if (resolution.unresolved && requirement === 'optional') {
      return '';
    }
    return resolution.value;
  });
  for (const match of content.matchAll(anyMustachePattern)) {
    if (!validTokens.has(match[0]!)) {
      throw new AgentError({
        code: 'TEMPLATE_VARIABLE_SYNTAX_UNSUPPORTED',
        message: 'Prompt template uses unsupported variable syntax.',
        category: 'VALIDATION',
        retryable: false,
      });
    }
  }
  return { rendered, unresolvedVariableNames: unresolved };
}
