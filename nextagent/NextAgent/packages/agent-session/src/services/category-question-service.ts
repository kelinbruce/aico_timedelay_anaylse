import type { AgentId } from '@nextagent/agent-common';
import type {
  CategoryQuestionPort,
  CategoryQuestionRequest,
  CategoryQuestionResult,
  CategoryL1Dto,
  CategoryL2Dto,
  CategoryQuestionEntryDto,
} from '@nextagent/agent-contracts/runtime';
import type { AgentAssembly, AgentAssemblyRegistry } from '@nextagent/agent-contracts/agent-assembly';
import { type CategoryQuestionCatalogPort } from './category-question-catalog.js';

export interface CategoryQuestionServiceDependencies {
  readonly categoryCatalog: CategoryQuestionCatalogPort;
  readonly assemblyRegistry: AgentAssemblyRegistry;
}

export function createCategoryQuestionService(deps: CategoryQuestionServiceDependencies): CategoryQuestionPort {
  return {
    async listCategoryQuestions(request: CategoryQuestionRequest, signal?: AbortSignal): Promise<CategoryQuestionResult> {
      const agentId = request.agentId;
      const locale = request.locale;

      const assembly = await resolveAssembly(deps.assemblyRegistry, agentId);

      const catalog = await deps.categoryCatalog.loadCatalog(agentId, assembly.agentVersion, assembly.agentAssemblyRef, locale, signal);

      if (catalog === undefined) {
        return { locale: locale ?? 'zh-CN', categories: [] };
      }

      return {
        locale: catalog.locale,
        categories: catalog.categories.map(projectL1),
      };
    },
  };
}

async function resolveAssembly(registry: AgentAssemblyRegistry, agentId: AgentId): Promise<AgentAssembly> {
  return registry.active(agentId);
}

function projectL1(category: {
  readonly name: string;
  readonly mode: 'direct' | 'nested' | 'mixed';
  readonly questions: ReadonlyArray<{ readonly text: string; readonly fixed: boolean; readonly hash: string }>;
  readonly subCategories: ReadonlyArray<{
    readonly name: string;
    readonly questions: ReadonlyArray<{ readonly text: string; readonly fixed: boolean; readonly hash: string }>;
  }>;
}): CategoryL1Dto {
  const hasSub = category.subCategories.length > 0;
  const hasQ = category.questions.length > 0;
  if (!hasSub) {
    return {
      name: category.name,
      hasSubCategories: false,
      questions: category.questions.map(projectEntry),
    };
  }
  if (!hasQ) {
    return {
      name: category.name,
      hasSubCategories: true,
      subCategories: category.subCategories.map(projectL2),
    };
  }
  return {
    name: category.name,
    hasSubCategories: true,
    questions: category.questions.map(projectEntry),
    subCategories: category.subCategories.map(projectL2),
  };
}
function projectL2(sub: {
  readonly name: string;
  readonly questions: ReadonlyArray<{ readonly text: string; readonly fixed: boolean; readonly hash: string }>;
}): CategoryL2Dto {
  return {
    name: sub.name,
    questions: sub.questions.map(projectEntry),
  };
}

function projectEntry(entry: { readonly text: string; readonly fixed: boolean; readonly hash: string }): CategoryQuestionEntryDto {
  return { text: entry.text, fixed: entry.fixed };
}
