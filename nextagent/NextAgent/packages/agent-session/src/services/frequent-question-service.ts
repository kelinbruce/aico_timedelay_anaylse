import type {
  FrequentQuestionPort,
  FrequentQuestionQuery,
  FrequentQuestionResult,
  FrequentQuestionEntryDto,
  QuestionAssociationQuery,
  QuestionAssociationResult,
  QuestionAssociationEntryDto,
  QuestionAssociationSource,
} from '@nextagent/agent-contracts/runtime';
import { brand, type EpochMillis } from '@nextagent/agent-common';
import type { QuestionRecommendationGateway, UserQuestionActivityStoreGateway } from '@nextagent/agent-contracts/gateway';
import type { RuntimeConversationAnnotationPort } from '@nextagent/agent-contracts/runtime';
import type { AgentAssemblyRegistry } from '@nextagent/agent-contracts/agent-assembly';
import { computeQuestionHash, type CategoryQuestionCatalogPort, type QuestionEntry } from './category-question-catalog.js';
import { createLocalQuestionRecommendationFallback } from './local-question-recommendation-fallback.js';

export interface FrequentQuestionServiceDependencies {
  readonly categoryCatalog: CategoryQuestionCatalogPort;
  readonly assemblyRegistry: AgentAssemblyRegistry;
  readonly annotations: RuntimeConversationAnnotationPort;
  readonly questionRecommendations?: QuestionRecommendationGateway | undefined;
  readonly deploymentMode: 'LOCAL' | 'REMOTE';
  readonly activityStore?: UserQuestionActivityStoreGateway;
  readonly frequencyThreshold?: number;
}

interface CatalogQuestion {
  readonly text: string;
  readonly fixed: boolean;
  readonly hash: string;
}

const ASSOCIATION_MAX_RESULTS = 20;
const ASSOCIATION_PINNED_CAP = 10;
const ASSOCIATION_DYNAMIC_CAP = 5;
const ASSOCIATION_STATIC_CAP = 5;

interface AssociationCandidate {
  readonly text: string;
  readonly hash: string;
  readonly source: QuestionAssociationSource;
}

function isSafeError(value: unknown): value is { readonly code: string; readonly message: string } {
  return value !== null && typeof value === 'object' && 'code' in value && 'message' in value && !Array.isArray(value);
}

export function createFrequentQuestionService(deps: FrequentQuestionServiceDependencies): FrequentQuestionPort {
  const questionRecommendations =
    deps.questionRecommendations ??
    (deps.deploymentMode === 'LOCAL' && deps.activityStore !== undefined
      ? createLocalQuestionRecommendationFallback({
          activityStore: deps.activityStore,
          frequencyThreshold: deps.frequencyThreshold ?? 8,
        })
      : undefined);
  return {
    async listFrequentQuestions(request: FrequentQuestionQuery, signal?: AbortSignal): Promise<FrequentQuestionResult> {
      const agentId = request.agentId;
      const locale = request.locale;

      const assembly = await deps.assemblyRegistry.active(agentId);

      const catalog = await deps.categoryCatalog.loadCatalog(agentId, assembly.agentVersion, assembly.agentAssemblyRef, locale, signal);

      const responseLocale = locale ?? 'zh-CN';

      const fixedQuestions: CatalogQuestion[] = [];
      const nonFixedQuestions: CatalogQuestion[] = [];
      if (catalog !== undefined) {
        for (const cat of catalog.categories) {
          const allQuestions = [...cat.questions, ...cat.subCategories.flatMap((sub) => sub.questions)];
          for (const q of allQuestions) {
            (q.fixed ? fixedQuestions : nonFixedQuestions).push({ text: q.text, fixed: q.fixed, hash: q.hash });
          }
        }
      }

      // Query annotation store for pinned questions (isQuestionFavorited).
      const pinnedPage = await deps.annotations.listQuestionFavoriteTurns({
        identityContext: { tenantId: request.tenantId, subjectId: request.subjectId, displayName: '' },
        agentId,
        offset: 0,
        limit: 100,
      });
      const pinnedQuestions = pinnedPage.entries.map((e: { questionPreview: string }) => ({
        text: e.questionPreview,
        hash: computeQuestionHash(e.questionPreview),
      }));

      // Query gateway for high-frequency questions.
      const highFreqQuestions: Array<{ text: string; hash: string }> = [];
      if (questionRecommendations !== undefined) {
        const freqResult = await questionRecommendations.listFrequentHistoryQuestions(
          {
            tenantId: request.tenantId,
            subjectId: request.subjectId,
            agentId,
            limit: 10,
          },
          signal,
        );
        if (!isSafeError(freqResult)) {
          for (const q of freqResult.questions) {
            highFreqQuestions.push({ text: q.content, hash: computeQuestionHash(q.content) });
          }
        }
      }

      const seenHashes = new Set<string>();
      const merged: FrequentQuestionEntryDto[] = [];

      for (const q of fixedQuestions) {
        if (!seenHashes.has(q.hash)) {
          seenHashes.add(q.hash);
          merged.push({ text: q.text });
        }
      }

      for (const r of pinnedQuestions) {
        if (!seenHashes.has(r.hash)) {
          seenHashes.add(r.hash);
          merged.push({ text: r.text });
        }
      }

      for (const r of highFreqQuestions) {
        if (!seenHashes.has(r.hash)) {
          seenHashes.add(r.hash);
          merged.push({ text: r.text });
        }
      }

      for (const q of nonFixedQuestions) {
        if (!seenHashes.has(q.hash)) {
          seenHashes.add(q.hash);
          merged.push({ text: q.text });
        }
      }

      return {
        locale: responseLocale,
        questions: merged,
      };
    },

    async listQuestionAssociations(request: QuestionAssociationQuery, signal?: AbortSignal): Promise<QuestionAssociationResult> {
      const agentId = request.agentId;
      const keyword = request.keyword.trim();
      const responseLocale = request.locale ?? 'zh-CN';

      // Layer 1: pinned questions from annotation store (keyword-matched).
      const pinnedPage = await deps.annotations.listQuestionFavoriteTurns({
        identityContext: { tenantId: request.tenantId, subjectId: request.subjectId, displayName: '' },
        agentId,
        offset: 0,
        limit: 100,
      });
      const pinnedCandidates = pinnedPage.entries.map((e) => ({
        text: e.questionPreview,
        hash: computeQuestionHash(e.questionPreview),
        source: 'pinned' as const,
      }));

      // Layer 2 (dynamic): high-frequency (LOCAL) or recommended (REMOTE).
      const dynamicCandidates: AssociationCandidate[] = [];
      if (questionRecommendations !== undefined) {
        if (deps.deploymentMode === 'LOCAL') {
          const freqResult = await questionRecommendations.listFrequentHistoryQuestions(
            {
              tenantId: request.tenantId,
              subjectId: request.subjectId,
              agentId,
              limit: 10,
            },
            signal,
          );
          if (!isSafeError(freqResult)) {
            for (const q of freqResult.questions) {
              dynamicCandidates.push({ text: q.content, hash: computeQuestionHash(q.content), source: 'high-frequency' });
            }
          }
        } else {
          const similarResult = await questionRecommendations.recommendSimilarPresetQuestions(
            {
              tenantId: request.tenantId,
              subjectId: request.subjectId,
              agentId,
              query: keyword,
              limit: 10,
            },
            signal,
          );
          if (!isSafeError(similarResult)) {
            for (const q of similarResult.questions) {
              dynamicCandidates.push({ text: q.content, hash: computeQuestionHash(q.content), source: 'recommended' });
            }
          }
        }
      }

      // Layer 3: static catalog (keyword-matched).
      const assembly = await deps.assemblyRegistry.active(agentId);
      const catalog = await deps.categoryCatalog.loadCatalog(agentId, assembly.agentVersion, assembly.agentAssemblyRef, request.locale, signal);

      const catalogQuestions: QuestionEntry[] = [];
      if (catalog !== undefined) {
        for (const cat of catalog.categories) {
          catalogQuestions.push(...cat.questions);
          for (const sub of cat.subCategories) {
            catalogQuestions.push(...sub.questions);
          }
        }
      }

      const { pinned, dynamic, staticQ } = buildAssociationCandidates(pinnedCandidates, dynamicCandidates, catalogQuestions);

      const pinnedFiltered = filterByKeyword(pinned, keyword);
      const dynamicFiltered = deps.deploymentMode === 'REMOTE' ? dynamic : filterByKeyword(dynamic, keyword);
      const staticFiltered = filterByKeyword(staticQ, keyword);

      const merged = mergeWithCascadeAndDedup(pinnedFiltered, dynamicFiltered, staticFiltered);

      return {
        locale: responseLocale,
        questions: merged,
      };
    },
  };
}

function filterByKeyword(candidates: readonly AssociationCandidate[], keyword: string): readonly AssociationCandidate[] {
  const lowerKeyword = keyword.toLowerCase();
  return candidates.filter((c) => c.text.toLowerCase().includes(lowerKeyword));
}

function buildAssociationCandidates(
  pinnedRecords: readonly AssociationCandidate[],
  dynamicRecords: readonly AssociationCandidate[],
  catalogQuestions: readonly QuestionEntry[],
): { pinned: readonly AssociationCandidate[]; dynamic: readonly AssociationCandidate[]; staticQ: readonly AssociationCandidate[] } {
  return {
    pinned: pinnedRecords,
    dynamic: dynamicRecords,
    staticQ: catalogQuestions.map((q) => ({ text: q.text, hash: q.hash, source: 'static' as const })),
  };
}

function mergeWithCascadeAndDedup(
  pinnedFiltered: readonly AssociationCandidate[],
  dynamicFiltered: readonly AssociationCandidate[],
  staticFiltered: readonly AssociationCandidate[],
): QuestionAssociationEntryDto[] {
  const seenHashes = new Set<string>();
  const result: QuestionAssociationEntryDto[] = [];

  const take = (candidates: readonly AssociationCandidate[], count: number): void => {
    for (const c of candidates) {
      if (result.length >= ASSOCIATION_MAX_RESULTS) {
        break;
      }
      if (count <= 0) {
        break;
      }
      if (seenHashes.has(c.hash)) {
        continue;
      }
      seenHashes.add(c.hash);
      result.push({ text: c.text, source: c.source });
      count--;
    }
  };

  const pinnedTaken = Math.min(ASSOCIATION_PINNED_CAP, pinnedFiltered.length);
  take(pinnedFiltered, pinnedTaken);

  const remainingAfterPinned = ASSOCIATION_MAX_RESULTS - result.length;
  const dynamicTake = Math.min(ASSOCIATION_DYNAMIC_CAP, dynamicFiltered.length, remainingAfterPinned);
  take(dynamicFiltered, dynamicTake);

  const remainingAfterDynamic = ASSOCIATION_MAX_RESULTS - result.length;
  const staticTake = Math.min(ASSOCIATION_STATIC_CAP, staticFiltered.length, remainingAfterDynamic);
  take(staticFiltered, staticTake);

  take(dynamicFiltered, ASSOCIATION_MAX_RESULTS);
  take(staticFiltered, ASSOCIATION_MAX_RESULTS);

  return result;
}
