import { getLogger, type AgentId, type AgentVersion } from '@nextagent/agent-common';
import { createHash } from 'node:crypto';
import { createReadStream, statSync } from 'node:fs';
import { join } from 'node:path';
import { createInterface } from 'node:readline';

const DEFAULT_LOCALE = 'zh-CN';
const FALLBACK_LANGUAGE = 'zh';
const MAX_SOURCE_AVAILABILITY_STATES = 256;
const MAX_CATALOG_CACHE_ENTRIES = 64;

export interface QuestionEntry {
  readonly text: string;
  readonly fixed: boolean;
  readonly hash: string;
}

export interface CategoryL2 {
  readonly name: string;
  readonly questions: readonly QuestionEntry[];
}

export interface CategoryL1 {
  readonly name: string;
  readonly mode: 'direct' | 'nested' | 'mixed';
  readonly questions: readonly QuestionEntry[];
  readonly subCategories: readonly CategoryL2[];
}

export interface CategoryQuestionCatalog {
  readonly agentId: AgentId;
  readonly locale: string;
  readonly categories: readonly CategoryL1[];
}

export type CategoryQuestionReadinessOutcomeCode =
  'CATEGORY_QUESTION_SOURCE_UNAVAILABLE' | 'CATEGORY_QUESTION_ENTRY_INVALID' | 'CATEGORY_QUESTION_REGISTERED';

export interface CategoryQuestionReadinessEvidence {
  readonly providerId: 'category-question-resource';
  readonly sourceScope: 'agent-owned-local';
  readonly agentId?: AgentId;
  readonly locale?: string;
  readonly outcomeCode: CategoryQuestionReadinessOutcomeCode;
  readonly message: string;
}

export interface CategoryQuestionCatalogSource {
  locateResourceDir: (request: {
    readonly agentId: AgentId;
    readonly agentVersion: AgentVersion;
    readonly agentAssemblyRef: string;
  }) => Promise<string | undefined>;
}

export interface CategoryQuestionCatalogPort {
  loadCatalog: (
    agentId: AgentId,
    agentVersion: AgentVersion,
    agentAssemblyRef: string,
    locale?: string,
    signal?: AbortSignal,
  ) => Promise<CategoryQuestionCatalog | undefined>;
  getReadinessEvidence: (agentId: AgentId, locale?: string) => readonly CategoryQuestionReadinessEvidence[];
}

export interface CategoryQuestionCatalogOptions {
  readonly source?: CategoryQuestionCatalogSource;
}

const logger = getLogger({ component: 'agent-session', source: 'category-question-catalog' });

interface CatalogCacheEntry {
  readonly catalog: CategoryQuestionCatalog;
  readonly evidence: readonly CategoryQuestionReadinessEvidence[];
  readonly fingerprint?: string;
}

export function createCategoryQuestionCatalog(options: CategoryQuestionCatalogOptions = {}): CategoryQuestionCatalogPort {
  return new DefaultCategoryQuestionCatalog(options);
}

export function computeQuestionHash(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

export function createQuestionEntry(text: string, fixed: boolean): QuestionEntry {
  return { text, fixed, hash: computeQuestionHash(text) };
}

export function normalizeLocale(locale: string): string {
  if (/[\/\\]|\.\./u.test(locale)) {
    return FALLBACK_LANGUAGE;
  }
  const dashIndex = locale.indexOf('-');
  const lang = dashIndex > 0 ? locale.slice(0, dashIndex) : locale;
  return lang.toLowerCase();
}

class DefaultCategoryQuestionCatalog implements CategoryQuestionCatalogPort {
  private readonly providerId = 'category-question-resource' as const;
  private readonly sourceScope = 'agent-owned-local' as const;
  private readonly source?: CategoryQuestionCatalogSource | undefined;
  private readonly cache = new Map<string, CatalogCacheEntry>();
  private readonly loading = new Map<string, Promise<CatalogCacheEntry | undefined>>();
  private readonly unavailable = new Map<string, true>();

  constructor(options: CategoryQuestionCatalogOptions) {
    this.source = options.source;
  }

  async loadCatalog(
    agentId: AgentId,
    agentVersion: AgentVersion,
    agentAssemblyRef: string,
    locale?: string,
    signal?: AbortSignal,
  ): Promise<CategoryQuestionCatalog | undefined> {
    const normalizedLocale = normalizeLocale(locale ?? DEFAULT_LOCALE);
    const cacheKey = `${agentId}\0${normalizedLocale}`;

    const resourceDir = await this.source?.locateResourceDir({ agentId, agentVersion, agentAssemblyRef });
    if (resourceDir === undefined) {
      this.reportUnavailable(agentId, normalizedLocale);
      return undefined;
    }

    const currentFingerprint = computeCatalogFingerprint(resourceDir, normalizedLocale);

    // Only validate cache when fingerprint is defined (files exist)
    if (currentFingerprint !== undefined) {
      const cached = this.getCatalogCacheEntry(cacheKey);
      if (cached !== undefined && cached.fingerprint === currentFingerprint) {
        return cached.catalog;
      }
    }

    // Deduplicate concurrent loads
    const loadingPromise = this.loading.get(cacheKey);
    if (loadingPromise !== undefined) {
      return (await loadingPromise)?.catalog;
    }

    const promise = this.loadFromResourceDir(agentId, normalizedLocale, resourceDir, signal);
    this.loading.set(cacheKey, promise);
    try {
      const entry = await promise;
      // Only cache when fingerprint is defined (files exist); empty results
      // from missing files are not cached so subsequent requests re-check.
      if (entry !== undefined && currentFingerprint !== undefined) {
        this.cache.set(cacheKey, { ...entry, fingerprint: currentFingerprint });
        if (this.cache.size > MAX_CATALOG_CACHE_ENTRIES) {
          const oldestKey = this.cache.keys().next().value;
          if (oldestKey !== undefined) {
            this.cache.delete(oldestKey);
          }
        }
      }
      return entry?.catalog;
    } finally {
      this.loading.delete(cacheKey);
    }
  }

  getReadinessEvidence(agentId: AgentId, locale?: string): readonly CategoryQuestionReadinessEvidence[] {
    const normalizedLocale = normalizeLocale(locale ?? DEFAULT_LOCALE);
    return this.getCatalogCacheEntry(`${agentId}\0${normalizedLocale}`)?.evidence ?? [];
  }

  private getCatalogCacheEntry(key: string): CatalogCacheEntry | undefined {
    const entry = this.cache.get(key);
    if (entry !== undefined) {
      this.cache.delete(key);
      this.cache.set(key, entry);
    }
    return entry;
  }

  private async loadFromResourceDir(
    agentId: AgentId,
    normalizedLocale: string,
    resourceDir: string,
    signal?: AbortSignal,
  ): Promise<CatalogCacheEntry | undefined> {
    const evidence: CategoryQuestionReadinessEvidence[] = [];
    const categories: CategoryL1[] = [];
    const localesToTry = [normalizedLocale];
    if (normalizedLocale !== FALLBACK_LANGUAGE) {
      localesToTry.push(FALLBACK_LANGUAGE);
    }
    let loadedLocale: string | undefined;
    for (const localeCandidate of localesToTry) {
      if (signal?.aborted === true) {
        return undefined;
      }
      const entries = await this.parseJsonlFile(
        join(resourceDir, `category-question-${localeCandidate}.jsonl`),
        agentId,
        localeCandidate,
        evidence,
        signal,
      );
      if (entries !== undefined) {
        categories.push(...entries);
        loadedLocale = localeCandidate;
        break;
      }
    }
    if (loadedLocale === undefined) {
      evidence.push({
        providerId: this.providerId,
        sourceScope: this.sourceScope,
        agentId,
        locale: normalizedLocale,
        outcomeCode: 'CATEGORY_QUESTION_SOURCE_UNAVAILABLE',
        message: 'Category question resource file not found.',
      });
      this.reportUnavailable(agentId, normalizedLocale);
    } else {
      evidence.push({
        providerId: this.providerId,
        sourceScope: this.sourceScope,
        agentId,
        locale: loadedLocale,
        outcomeCode: 'CATEGORY_QUESTION_REGISTERED',
        message: `Category question catalog loaded for locale ${loadedLocale}.`,
      });
      const recoveryKey = this.sourceStateKey(agentId, normalizedLocale);
      if (this.unavailable.delete(recoveryKey)) {
        logger.info({
          event: 'category.question.source_recovered',
          providerId: this.providerId,
          agentId,
          locale: loadedLocale,
          categoryCount: categories.length,
        });
      } else {
        logger.info({
          event: 'category.question.registered',
          providerId: this.providerId,
          agentId,
          locale: loadedLocale,
          categoryCount: categories.length,
        });
      }
    }
    return { catalog: { agentId, locale: loadedLocale ?? normalizedLocale, categories }, evidence };
  }

  private reportUnavailable(agentId: AgentId, locale: string): void {
    const key = this.sourceStateKey(agentId, locale);
    if (this.unavailable.has(key)) {
      return;
    }
    if (this.unavailable.size >= MAX_SOURCE_AVAILABILITY_STATES) {
      const oldest = this.unavailable.keys().next().value;
      if (oldest !== undefined) {
        this.unavailable.delete(oldest);
      }
    }
    this.unavailable.set(key, true);
    logger.warn({
      event: 'category.question.source_unavailable',
      providerId: this.providerId,
      agentId,
      locale,
      safeReasonCode: 'CATEGORY_QUESTION_SOURCE_UNAVAILABLE',
    });
  }

  private sourceStateKey(agentId: AgentId, locale: string): string {
    return `${agentId}\0${locale}`;
  }

  private async parseJsonlFile(
    filePath: string,
    agentId: AgentId,
    locale: string,
    evidence: CategoryQuestionReadinessEvidence[],
    signal?: AbortSignal,
  ): Promise<CategoryL1[] | undefined> {
    let stream;
    try {
      stream = createReadStream(filePath, { encoding: 'utf8' });
    } catch {
      return undefined;
    }
    let streamFailed = false;
    stream.on('error', () => {
      streamFailed = true;
    });
    const categories: CategoryL1[] = [];
    const rl = createInterface({ input: stream, crlfDelay: Infinity });
    const abortHandler = () => rl.close();
    signal?.addEventListener('abort', abortHandler, { once: true });
    try {
      for await (const line of rl) {
        if (signal?.aborted === true || streamFailed) {
          break;
        }
        const trimmed = line.trim();
        if (trimmed.length === 0) {
          continue;
        }
        const parsed = this.parseLine(trimmed, agentId, locale, evidence);
        if (parsed !== undefined) {
          categories.push(parsed);
        }
      }
    } catch {
      return undefined;
    } finally {
      signal?.removeEventListener('abort', abortHandler);
      rl.close();
      stream.destroy();
    }
    return categories;
  }

  private parseLine(line: string, agentId: AgentId, locale: string, evidence: CategoryQuestionReadinessEvidence[]): CategoryL1 | undefined {
    let obj: unknown;
    try {
      obj = JSON.parse(line);
    } catch {
      this.recordInvalid(agentId, locale, 'JSON parse error', evidence);
      return undefined;
    }
    if (obj === null || typeof obj !== 'object' || Array.isArray(obj)) {
      this.recordInvalid(agentId, locale, 'Entry is not an object', evidence);
      return undefined;
    }
    const record = obj as Record<string, unknown>;
    const category = record['category'];
    if (typeof category !== 'string' || category.trim().length === 0) {
      this.recordInvalid(agentId, locale, 'Missing or empty category name', evidence);
      return undefined;
    }
    const questions = Array.isArray(record['questions']) ? record['questions'] : [];
    const records = Array.isArray(record['records']) ? record['records'] : [];
    if (questions.length === 0 && records.length === 0) {
      this.recordInvalid(agentId, locale, `Category "${category}": no questions or records`, evidence);
      return undefined;
    }
    const parsedQuestions = this.parseQuestions(questions, agentId, locale, evidence);
    const subCategories = this.parseSubCategories(records, agentId, locale, evidence);
    if (parsedQuestions.length === 0 && subCategories.length === 0) {
      this.recordInvalid(agentId, locale, `Category "${category}": all questions and sub-categories invalid`, evidence);
      return undefined;
    }
    const hasQ = parsedQuestions.length > 0;
    const hasSub = subCategories.length > 0;
    return {
      name: category,
      mode: hasQ && hasSub ? 'mixed' : hasSub ? 'nested' : 'direct',
      questions: parsedQuestions,
      subCategories,
    };
  }

  private parseSubCategories(rawRecords: unknown[], agentId: AgentId, locale: string, evidence: CategoryQuestionReadinessEvidence[]): CategoryL2[] {
    const subCategories: CategoryL2[] = [];
    for (const raw of rawRecords) {
      if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
        this.recordInvalid(agentId, locale, 'Sub-category is not an object', evidence);
        continue;
      }
      const sub = raw as Record<string, unknown>;
      const subCategory = sub['category'];
      const rawSubQuestions = sub['questions'];
      if (typeof subCategory !== 'string' || subCategory.trim().length === 0) {
        this.recordInvalid(agentId, locale, 'Sub-category missing or empty name', evidence);
        continue;
      }
      if (!Array.isArray(rawSubQuestions) || rawSubQuestions.length === 0) {
        this.recordInvalid(agentId, locale, `Sub-category "${subCategory}": no valid questions`, evidence);
        continue;
      }
      const parsedSubQuestions = this.parseQuestions(rawSubQuestions, agentId, locale, evidence);
      if (parsedSubQuestions.length === 0) {
        this.recordInvalid(agentId, locale, `Sub-category "${subCategory}": no valid questions`, evidence);
        continue;
      }
      subCategories.push({ name: subCategory, questions: parsedSubQuestions });
    }
    return subCategories;
  }

  private parseQuestions(rawQuestions: unknown[], agentId: AgentId, locale: string, evidence: CategoryQuestionReadinessEvidence[]): QuestionEntry[] {
    const entries: QuestionEntry[] = [];
    for (const raw of rawQuestions) {
      if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
        this.recordInvalid(agentId, locale, 'Question entry is not an object', evidence);
        continue;
      }
      const q = raw as Record<string, unknown>;
      if (typeof q['question'] !== 'string' || q['question'].trim().length === 0) {
        this.recordInvalid(agentId, locale, 'Question missing or empty text', evidence);
        continue;
      }
      if (typeof q['fixed'] !== 'boolean') {
        this.recordInvalid(agentId, locale, 'Question missing or invalid fixed field', evidence);
        continue;
      }
      entries.push(createQuestionEntry(q['question'], q['fixed']));
    }
    return entries;
  }

  private recordInvalid(agentId: AgentId, locale: string, detail: string, evidence: CategoryQuestionReadinessEvidence[]): void {
    evidence.push({
      providerId: this.providerId,
      sourceScope: this.sourceScope,
      agentId,
      locale,
      outcomeCode: 'CATEGORY_QUESTION_ENTRY_INVALID',
      message: detail,
    });
  }
}

/**
 * Compute a fingerprint for the category question JSONL file matching the
 * given locale. Tries the normalized locale first, then falls back to the
 * fallback language. Returns undefined when neither file exists.
 */
function computeCatalogFingerprint(resourceDir: string, normalizedLocale: string): string | undefined {
  const localesToTry = [normalizedLocale];
  if (normalizedLocale !== FALLBACK_LANGUAGE) {
    localesToTry.push(FALLBACK_LANGUAGE);
  }
  for (const localeCandidate of localesToTry) {
    const filePath = join(resourceDir, `category-question-${localeCandidate}.jsonl`);
    try {
      const stat = statSync(filePath);
      return `${filePath}:${stat.size}:${stat.mtimeMs}`;
    } catch {
      // File doesn't exist, try next locale
    }
  }
  return undefined;
}
