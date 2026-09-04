import { afterEach, describe, expect, it } from 'vitest';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createCategoryQuestionCatalog,
  normalizeLocale,
  type CategoryQuestionCatalogSource,
  type CategoryQuestionReadinessEvidence,
} from '../src/services/category-question-catalog.js';
import {
  bindRuntimeLoggerProvider,
  noopRuntimeLogger,
  type AgentId,
  type AgentVersion,
  type RuntimeLogger,
  type RuntimeLoggerProviderBinding,
} from '@nextagent/agent-common';

let loggerBinding: RuntimeLoggerProviderBinding | undefined;
afterEach(() => loggerBinding?.unbind());

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixtureResourceDir = join(__dirname, 'fixtures', 'category-questions', 'resource');
const testAgentId = 'test-agent' as AgentId;
const testAgentVersion = 'v1' as AgentVersion;
const testAssemblyRef = 'test-ref';

function createLocatorForFixture(rootDir: string): CategoryQuestionCatalogSource {
  return {
    async locateResourceDir() {
      return rootDir;
    },
  };
}

function createLocatorNotFound(): CategoryQuestionCatalogSource {
  return {
    async locateResourceDir() {
      return undefined;
    },
  };
}

describe('normalizeLocale', () => {
  it('normalizes zh-CN to zh', () => {
    expect(normalizeLocale('zh-CN')).toBe('zh');
  });

  it('normalizes en-US to en', () => {
    expect(normalizeLocale('en-US')).toBe('en');
  });

  it('normalizes already short locale to lowercase', () => {
    expect(normalizeLocale('ZH')).toBe('zh');
  });
});

describe('CategoryQuestionCatalog', () => {
  it('loads catalog with direct and nested categories (zh)', async () => {
    const discovery = createCategoryQuestionCatalog({ source: createLocatorForFixture(fixtureResourceDir) });

    const catalog = await discovery.loadCatalog(testAgentId, testAgentVersion, testAssemblyRef, 'zh-CN');

    expect(catalog).toBeDefined();
    expect(catalog!.locale).toBe('zh');
    expect(catalog!.categories).toHaveLength(4);

    // First category: direct questions
    const directCat = catalog!.categories[0]!;
    expect(directCat.name).toBe('查库存');
    expect(directCat.mode).toBe('direct');
    expect(directCat.questions).toHaveLength(1);
    expect(directCat.questions[0]!.text).toBe('请查询【SKU001】商品的当前库存数量');
    expect(directCat.questions[0]!.fixed).toBe(true);
    expect(directCat.questions[0]!.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(directCat.subCategories).toHaveLength(0);

    // Second category: nested with sub-categories
    const nestedCat = catalog!.categories[1]!;
    expect(nestedCat.name).toBe('查销量');
    expect(nestedCat.mode).toBe('nested');
    expect(nestedCat.questions).toHaveLength(0);
    expect(nestedCat.subCategories).toHaveLength(2);
    expect(nestedCat.subCategories[0]!.name).toBe('查日销');
    expect(nestedCat.subCategories[0]!.questions).toHaveLength(1);
    expect(nestedCat.subCategories[1]!.name).toBe('查月销');
  });

  it('loads catalog with en locale', async () => {
    const discovery = createCategoryQuestionCatalog({ source: createLocatorForFixture(fixtureResourceDir) });

    const catalog = await discovery.loadCatalog(testAgentId, testAgentVersion, testAssemblyRef, 'en-US');

    expect(catalog).toBeDefined();
    expect(catalog!.locale).toBe('en');
    expect(catalog!.categories).toHaveLength(2);
    expect(catalog!.categories[0]!.name).toBe('Inventory');
  });

  it('falls back to zh when requested locale file does not exist', async () => {
    const discovery = createCategoryQuestionCatalog({ source: createLocatorForFixture(fixtureResourceDir) });

    const catalog = await discovery.loadCatalog(testAgentId, testAgentVersion, testAssemblyRef, 'ja-JP');

    expect(catalog).toBeDefined();
    expect(catalog!.locale).toBe('zh');
  });

  it('produces CATEGORY_QUESTION_REGISTERED evidence on success', async () => {
    const discovery = createCategoryQuestionCatalog({ source: createLocatorForFixture(fixtureResourceDir) });

    await discovery.loadCatalog(testAgentId, testAgentVersion, testAssemblyRef, 'zh-CN');

    const evidence = discovery.getReadinessEvidence(testAgentId, 'zh-CN');
    const registered = evidence.find((e) => e.outcomeCode === 'CATEGORY_QUESTION_REGISTERED');
    expect(registered).toBeDefined();
    expect(registered!.agentId).toBe(testAgentId);
    expect(registered!.locale).toBe('zh');
  });

  it('produces CATEGORY_QUESTION_SOURCE_UNAVAILABLE when agent package not found', async () => {
    const discovery = createCategoryQuestionCatalog({ source: createLocatorNotFound() });

    const catalog = await discovery.loadCatalog(testAgentId, testAgentVersion, testAssemblyRef, 'zh-CN');

    expect(catalog).toBeUndefined();
  });

  it('produces CATEGORY_QUESTION_SOURCE_UNAVAILABLE when no locator configured', async () => {
    const discovery = createCategoryQuestionCatalog({});

    const catalog = await discovery.loadCatalog(testAgentId, testAgentVersion, testAssemblyRef, 'zh-CN');

    expect(catalog).toBeUndefined();
  });

  it('logs unavailable and recovered only on state transitions per agent and locale', async () => {
    const entries: Array<Record<string, unknown>> = [];
    let available = false;
    const runtimeLogger: RuntimeLogger = {
      ...noopRuntimeLogger,
      info: (fields) => entries.push(fields as Record<string, unknown>),
      warn: ((fields: object) => entries.push(fields as Record<string, unknown>)) as RuntimeLogger['warn'],
    };
    loggerBinding = bindRuntimeLoggerProvider({ getLogger: () => runtimeLogger });
    const discovery = createCategoryQuestionCatalog({
      source: {
        async locateResourceDir() {
          return available ? fixtureResourceDir : undefined;
        },
      },
    });

    await discovery.loadCatalog(testAgentId, testAgentVersion, testAssemblyRef, 'zh-CN');
    await discovery.loadCatalog(testAgentId, testAgentVersion, testAssemblyRef, 'zh-CN');
    available = true;
    await discovery.loadCatalog(testAgentId, testAgentVersion, testAssemblyRef, 'zh-CN');

    expect(entries.filter((entry) => entry.event === 'category.question.source_unavailable')).toHaveLength(1);
    expect(entries.filter((entry) => entry.event === 'category.question.source_recovered')).toEqual([
      expect.objectContaining({ agentId: testAgentId, locale: 'zh', categoryCount: expect.any(Number) }),
    ]);
    expect(entries.filter((entry) => entry.event === 'category.question.registered')).toHaveLength(0);
  });

  it('bounds unavailable transition state across untrusted locale variants', async () => {
    const entries: Array<Record<string, unknown>> = [];
    const runtimeLogger: RuntimeLogger = {
      ...noopRuntimeLogger,
      warn: ((fields: object) => entries.push(fields as Record<string, unknown>)) as RuntimeLogger['warn'],
    };
    loggerBinding = bindRuntimeLoggerProvider({ getLogger: () => runtimeLogger });
    const discovery = createCategoryQuestionCatalog({
      source: createLocatorNotFound(),
    });

    for (let index = 0; index <= 256; index++) {
      await discovery.loadCatalog(testAgentId, testAgentVersion, testAssemblyRef, `locale${index}`);
    }
    await discovery.loadCatalog(testAgentId, testAgentVersion, testAssemblyRef, 'locale256');
    await discovery.loadCatalog(testAgentId, testAgentVersion, testAssemblyRef, 'locale0');

    expect(entries.filter((entry) => entry.event === 'category.question.source_unavailable')).toHaveLength(258);
  });

  it('caches catalog per agentId + locale', async () => {
    const discovery = createCategoryQuestionCatalog({ source: createLocatorForFixture(fixtureResourceDir) });

    const catalog1 = await discovery.loadCatalog(testAgentId, testAgentVersion, testAssemblyRef, 'zh-CN');
    const catalog2 = await discovery.loadCatalog(testAgentId, testAgentVersion, testAssemblyRef, 'zh-CN');

    // Same reference (cached)
    expect(catalog1).toBe(catalog2);
  });

  it('isolates catalogs between different agents', async () => {
    const discovery = createCategoryQuestionCatalog({ source: createLocatorForFixture(fixtureResourceDir) });

    const agentA = 'agent-a' as AgentId;
    const agentB = 'agent-b' as AgentId;

    const catalogA = await discovery.loadCatalog(agentA, testAgentVersion, testAssemblyRef, 'zh-CN');
    const catalogB = await discovery.loadCatalog(agentB, testAgentVersion, testAssemblyRef, 'zh-CN');

    expect(catalogA!.agentId).toBe(agentA);
    expect(catalogB!.agentId).toBe(agentB);
    // Both load from the same fixture, so categories are the same
    // but they are different catalog objects
    expect(catalogA).not.toBe(catalogB);
  });
});

describe('CategoryQuestionCatalog - invalid entries', () => {
  it('rejects entries where both questions and records are non-empty', async () => {
    const resourceDir = join(__dirname, 'fixtures', 'category-questions-invalid', 'resource');
    const discovery = createCategoryQuestionCatalog({
      source: {
        async locateResourceDir() {
          return resourceDir;
        },
      },
    });

    const catalog = await discovery.loadCatalog(testAgentId, testAgentVersion, testAssemblyRef, 'zh-CN');
    expect(catalog).toBeDefined();
    // Only the valid category should remain; invalid ones skipped
    expect(catalog!.categories).toHaveLength(1);
    expect(catalog!.categories[0]!.name).toBe('valid');
    const evidence = discovery.getReadinessEvidence(testAgentId, 'zh-CN');
    const invalid = evidence.filter((e) => e.outcomeCode === 'CATEGORY_QUESTION_ENTRY_INVALID');
    expect(invalid.length).toBeGreaterThan(0);
  });

  it('does not expose question text in evidence messages', async () => {
    const discovery = createCategoryQuestionCatalog({ source: createLocatorForFixture(fixtureResourceDir) });

    await discovery.loadCatalog(testAgentId, testAgentVersion, testAssemblyRef, 'zh-CN');
    const evidence = discovery.getReadinessEvidence(testAgentId, 'zh-CN');

    for (const e of evidence) {
      // Evidence messages should not contain actual question text
      expect(e.message).not.toContain('请查询');
      expect(e.message).not.toContain('过去24小时');
    }
  });
});

describe('CategoryQuestionCatalog - edge cases (mixed mode + invalid fields)', () => {
  const edgeResourceDir = join(__dirname, 'fixtures', 'category-questions-edge', 'resource');
  const edgeLocator: CategoryQuestionCatalogSource = {
    async locateResourceDir() {
      return edgeResourceDir;
    },
  };

  it('parses mixed category with both questions and records', async () => {
    const discovery = createCategoryQuestionCatalog({ source: edgeLocator });
    const catalog = await discovery.loadCatalog(testAgentId, testAgentVersion, testAssemblyRef, 'zh-CN');

    expect(catalog).toBeDefined();
    const mixed = catalog!.categories.find((c) => c.name === '混合分类')!;
    expect(mixed).toBeDefined();
    expect(mixed.mode).toBe('mixed');
    expect(mixed.questions).toHaveLength(1);
    expect(mixed.questions[0]!.text).toBe('直接问题1');
    expect(mixed.subCategories).toHaveLength(1);
    expect(mixed.subCategories[0]!.name).toBe('子分类A');
    expect(mixed.subCategories[0]!.questions[0]!.text).toBe('子问题1');
  });

  it('ignores records on sub-categories (only parses questions)', async () => {
    const discovery = createCategoryQuestionCatalog({ source: edgeLocator });
    const catalog = await discovery.loadCatalog(testAgentId, testAgentVersion, testAssemblyRef, 'zh-CN');

    const cat = catalog!.categories.find((c) => c.name === '二级分类有records')!;
    expect(cat).toBeDefined();
    expect(cat.mode).toBe('nested');
    expect(cat.subCategories).toHaveLength(1);
    expect(cat.subCategories[0]!.name).toBe('子分类B');
    expect(cat.subCategories[0]!.questions).toHaveLength(1);
    expect(cat.subCategories[0]!.questions[0]!.text).toBe('有效子问题');
  });

  it('parses direct-only and nested-only categories', async () => {
    const discovery = createCategoryQuestionCatalog({ source: edgeLocator });
    const catalog = await discovery.loadCatalog(testAgentId, testAgentVersion, testAssemblyRef, 'zh-CN');

    const direct = catalog!.categories.find((c) => c.name === '仅直接问题')!;
    expect(direct.mode).toBe('direct');
    expect(direct.questions).toHaveLength(2);
    expect(direct.subCategories).toHaveLength(0);

    const nested = catalog!.categories.find((c) => c.name === '仅二级分类')!;
    expect(nested.mode).toBe('nested');
    expect(nested.questions).toHaveLength(0);
    expect(nested.subCategories).toHaveLength(1);
  });

  it('skips question missing question field', async () => {
    const discovery = createCategoryQuestionCatalog({ source: edgeLocator });
    const catalog = await discovery.loadCatalog(testAgentId, testAgentVersion, testAssemblyRef, 'zh-CN');

    const cat = catalog!.categories.find((c) => c.name === '问题缺question字段');
    expect(cat).toBeUndefined();

    const evidence = discovery.getReadinessEvidence(testAgentId, 'zh-CN');
    expect(evidence.some((e) => e.outcomeCode === 'CATEGORY_QUESTION_ENTRY_INVALID' && e.message.includes('no questions or records'))).toBe(true);
  });

  it('skips question missing fixed field', async () => {
    const discovery = createCategoryQuestionCatalog({ source: edgeLocator });
    const catalog = await discovery.loadCatalog(testAgentId, testAgentVersion, testAssemblyRef, 'zh-CN');
    expect(catalog!.categories.find((c) => c.name === '问题缺fixed字段')).toBeUndefined();
  });

  it('skips question with non-string question field', async () => {
    const discovery = createCategoryQuestionCatalog({ source: edgeLocator });
    const catalog = await discovery.loadCatalog(testAgentId, testAgentVersion, testAssemblyRef, 'zh-CN');
    expect(catalog!.categories.find((c) => c.name === 'question非字符串')).toBeUndefined();
  });

  it('skips question with non-boolean fixed field', async () => {
    const discovery = createCategoryQuestionCatalog({ source: edgeLocator });
    const catalog = await discovery.loadCatalog(testAgentId, testAgentVersion, testAssemblyRef, 'zh-CN');
    expect(catalog!.categories.find((c) => c.name === 'fixed非布尔')).toBeUndefined();
  });

  it('skips question with empty string', async () => {
    const discovery = createCategoryQuestionCatalog({ source: edgeLocator });
    const catalog = await discovery.loadCatalog(testAgentId, testAgentVersion, testAssemblyRef, 'zh-CN');
    expect(catalog!.categories.find((c) => c.name === 'question空字符串')).toBeUndefined();
  });

  it('skips category with empty questions and records', async () => {
    const discovery = createCategoryQuestionCatalog({ source: edgeLocator });
    const catalog = await discovery.loadCatalog(testAgentId, testAgentVersion, testAssemblyRef, 'zh-CN');
    expect(catalog!.categories.find((c) => c.name === 'questions和records同时为空')).toBeUndefined();
  });

  it('skips category with no questions and no records fields', async () => {
    const discovery = createCategoryQuestionCatalog({ source: edgeLocator });
    const catalog = await discovery.loadCatalog(testAgentId, testAgentVersion, testAssemblyRef, 'zh-CN');
    expect(catalog!.categories.find((c) => c.name === 'questions和records均不存在')).toBeUndefined();
  });

  it('skips category with empty name', async () => {
    const discovery = createCategoryQuestionCatalog({ source: edgeLocator });
    const catalog = await discovery.loadCatalog(testAgentId, testAgentVersion, testAssemblyRef, 'zh-CN');
    expect(catalog!.categories.find((c) => c.name === '')).toBeUndefined();
  });

  it('skips sub-category missing category name', async () => {
    const discovery = createCategoryQuestionCatalog({ source: edgeLocator });
    const catalog = await discovery.loadCatalog(testAgentId, testAgentVersion, testAssemblyRef, 'zh-CN');
    const cat = catalog!.categories.find((c) => c.name === '二级分类缺category');
    expect(cat).toBeUndefined();
  });

  it('skips sub-category with empty questions array', async () => {
    const discovery = createCategoryQuestionCatalog({ source: edgeLocator });
    const catalog = await discovery.loadCatalog(testAgentId, testAgentVersion, testAssemblyRef, 'zh-CN');
    const cat = catalog!.categories.find((c) => c.name === '二级分类空questions');
    expect(cat).toBeUndefined();
  });

  it('skips sub-category missing questions field', async () => {
    const discovery = createCategoryQuestionCatalog({ source: edgeLocator });
    const catalog = await discovery.loadCatalog(testAgentId, testAgentVersion, testAssemblyRef, 'zh-CN');
    const cat = catalog!.categories.find((c) => c.name === '二级分类缺questions');
    expect(cat).toBeUndefined();
  });

  it('parses partially valid questions', async () => {
    const discovery = createCategoryQuestionCatalog({ source: edgeLocator });
    const catalog = await discovery.loadCatalog(testAgentId, testAgentVersion, testAssemblyRef, 'zh-CN');
    const cat = catalog!.categories.find((c) => c.name === '部分问题有效部分无效')!;
    expect(cat).toBeDefined();
    expect(cat.questions).toHaveLength(2);
    expect(cat.questions[0]!.text).toBe('有效问题');
    expect(cat.questions[1]!.text).toBe('也有效');
  });

  it('parses partially valid sub-categories', async () => {
    const discovery = createCategoryQuestionCatalog({ source: edgeLocator });
    const catalog = await discovery.loadCatalog(testAgentId, testAgentVersion, testAssemblyRef, 'zh-CN');
    const cat = catalog!.categories.find((c) => c.name === '部分二级分类有效部分无效')!;
    expect(cat).toBeDefined();
    expect(cat.subCategories).toHaveLength(2);
    expect(cat.subCategories[0]!.name).toBe('有效子分类');
    expect(cat.subCategories[1]!.name).toBe('也有效');
  });

  it('produces evidence for invalid JSON line', async () => {
    const discovery = createCategoryQuestionCatalog({ source: edgeLocator });
    await discovery.loadCatalog(testAgentId, testAgentVersion, testAssemblyRef, 'zh-CN');
    const evidence = discovery.getReadinessEvidence(testAgentId, 'zh-CN');
    expect(evidence.some((e) => e.outcomeCode === 'CATEGORY_QUESTION_ENTRY_INVALID' && e.message.includes('JSON parse error'))).toBe(true);
  });

  it('produces evidence for non-object lines (number, null, array)', async () => {
    const discovery = createCategoryQuestionCatalog({ source: edgeLocator });
    await discovery.loadCatalog(testAgentId, testAgentVersion, testAssemblyRef, 'zh-CN');
    const evidence = discovery.getReadinessEvidence(testAgentId, 'zh-CN');
    const nonObjectEvidence = evidence.filter((e) => e.message.includes('not an object'));
    expect(nonObjectEvidence.length).toBeGreaterThanOrEqual(3);
  });
});
