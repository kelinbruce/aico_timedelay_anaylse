import {
  type PromptModelCompatibilityRequest,
  type PromptModelCandidate,
  type PromptTemplate,
  type PromptTemplateRegistry,
  type SelectedPromptModel,
} from './prompt-template-types.js';
import { compilePromptRoot } from './prompt-template-compiler.js';
import { defaultBuiltinPromptRoot } from './builtin-prompt-root.js';

export class DefaultPromptTemplateRegistry implements PromptTemplateRegistry {
  private readonly builtinTemplates: readonly PromptTemplate[];
  private readonly agentBuckets = new Map<string, readonly PromptTemplate[]>();

  constructor(builtinRoot = defaultBuiltinPromptRoot()) {
    this.builtinTemplates = compilePromptRoot({ sourceLayer: 'builtin', rootPath: builtinRoot });
  }

  register(input: { readonly agentId: string; readonly agentVersion: string; readonly path: string }): void {
    const templates = compilePromptRoot({
      sourceLayer: 'agent',
      rootPath: input.path,
      agentId: input.agentId,
      agentVersion: input.agentVersion,
    });
    this.agentBuckets.set(agentBucketKey(input.agentId, input.agentVersion), templates);
  }

  templatesFor(agentId: string, agentVersion: string): readonly PromptTemplate[] {
    return [...this.builtinTemplates, ...(this.agentBuckets.get(agentBucketKey(agentId, agentVersion)) ?? [])];
  }

  compatibleModelIds(request: PromptModelCompatibilityRequest): readonly string[] {
    const templates = this.templatesFor(String(request.agentId), String(request.agentVersion));
    const ids = new Set<string>();
    for (const template of templates) {
      if (template.sourceLayer !== 'agent' || template.purpose !== request.purpose || template.match?.model === undefined) {
        continue;
      }
      if (!matchesLocaleAndFlow(template, request.locale, request.flowVariables)) {
        continue;
      }
      for (const candidate of request.modelCandidates) {
        if (matchesModel(template.match.model, candidate)) {
          ids.add(candidate.modelId);
        }
      }
    }
    return request.modelCandidates
      .filter((candidate) => ids.has(candidate.modelId))
      .sort((left, right) => left.order - right.order)
      .map((candidate) => candidate.modelId);
  }
}

export function createDefaultPromptTemplateRegistry(builtinRoot?: string): DefaultPromptTemplateRegistry {
  return new DefaultPromptTemplateRegistry(builtinRoot);
}

function agentBucketKey(agentId: string, agentVersion: string): string {
  return `${agentId}:${agentVersion}`;
}

function matchesLocaleAndFlow(template: PromptTemplate, locale: string | undefined, flowVariables: Readonly<Record<string, string>>): boolean {
  if (template.match?.locale !== undefined && template.match.locale !== locale) {
    return false;
  }
  for (const [key, value] of Object.entries(template.match?.flowVariables ?? {})) {
    if (flowVariables[key] !== value) {
      return false;
    }
  }
  return true;
}

function matchesModel(match: NonNullable<PromptTemplate['match']>['model'], selectedModel: SelectedPromptModel | PromptModelCandidate): boolean {
  if (match === undefined) {
    return true;
  }
  return match === selectedModel.modelId;
}
