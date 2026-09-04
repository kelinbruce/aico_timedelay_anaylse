import { describe, expect, it } from 'vitest';
import {
  MEMORY_IMPORT_MAX_BYTES,
  MEMORY_IMPORT_TEMPLATE_FILE_NAME,
  MemoryTransferError,
  createMemoryExport,
  createMemoryImportTemplate,
  memoryExportFileName,
  parseMemoryImport,
  toBatchCreateItem,
} from '../src/features/memory/memoryTransfer.ts';

function encode(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

function json(value: unknown): Uint8Array {
  return encode(JSON.stringify(value));
}

describe('memoryTransfer', () => {
  it.each([
    ['zh-CN', '事实记忆', '北京核心网 AMF 版本'],
    ['en-US', 'Factual memory', 'Beijing core AMF version'],
  ] as const)(
    'creates a directly importable %s template with four type explanations and examples',
    async (locale, factualDescription, factualBriefIndex) => {
      expect(MEMORY_IMPORT_TEMPLATE_FILE_NAME).toBe('nextagent-memory-import-template.json');
      const template = JSON.parse(createMemoryImportTemplate(locale));
      expect(Object.keys(template._instructions)[0]).toBe('memoryTypeDescriptions');
      expect(template._instructions).toMatchObject({
        memoryTypeDescriptions: {
          FACTUAL: expect.stringContaining(factualDescription),
          CONCEPTUAL: expect.any(String),
          PROCEDURAL: expect.any(String),
          USER_CHARACTERISTICS: expect.any(String),
        },
        usage: expect.stringContaining('memories'),
        requiredFields: expect.stringContaining('briefIndex'),
        optionalFields: expect.stringContaining('memoryType'),
        defaults: expect.stringContaining('USER_CHARACTERISTICS'),
        limits: expect.stringContaining('50'),
      });
      expect(template.memories).toHaveLength(4);
      expect(template.memories.map((memory: { memoryType: string }) => memory.memoryType)).toEqual([
        'FACTUAL',
        'CONCEPTUAL',
        'PROCEDURAL',
        'USER_CHARACTERISTICS',
      ]);
      expect(template.memories[0].briefIndex).toBe(factualBriefIndex);

      const parsed = await parseMemoryImport(encode(createMemoryImportTemplate(locale)), MEMORY_IMPORT_TEMPLATE_FILE_NAME);
      expect(parsed.memories).toHaveLength(4);
      expect(parsed.memories[0]).toMatchObject({
        sourceIndex: 0,
        memoryType: 'FACTUAL',
        knowledgeSourceType: 'CONFIGURED',
        briefIndex: factualBriefIndex,
        confidence: 0.95,
        state: 'ACTIVE',
      });
    },
  );

  it('defaults omitted or null configurable fields while preserving explicit values', async () => {
    const parsed = await parseMemoryImport(
      json([
        { briefIndex: 'defaults omitted', content: 'first' },
        { briefIndex: 'defaults null', content: 'second', memoryType: null, labels: null, confidence: null },
        { briefIndex: 'defaults blank', content: 'third', memoryType: ' ', labels: '', confidence: '' },
        { briefIndex: 'configured', content: 'fourth', memoryType: 'CONCEPTUAL', labels: ['network', 'intent'], confidence: 0 },
      ]),
      'memories.json',
    );

    expect(parsed.memories[0]).toMatchObject({
      memoryType: 'USER_CHARACTERISTICS',
      labels: [],
      confidence: 1,
    });
    expect(parsed.memories[1]).toMatchObject({
      memoryType: 'USER_CHARACTERISTICS',
      labels: [],
      confidence: 1,
    });
    expect(parsed.memories[2]).toMatchObject({
      memoryType: 'USER_CHARACTERISTICS',
      labels: [],
      confidence: 1,
    });
    expect(parsed.memories[3]).toMatchObject({
      memoryType: 'CONCEPTUAL',
      labels: ['network', 'intent'],
      confidence: 0,
    });
  });

  it('rejects non-JSON files, oversized bytes, invalid UTF-8, invalid JSON, and invalid counts', async () => {
    await expect(parseMemoryImport(json([]), 'memories.csv')).rejects.toMatchObject({ code: 'UNSUPPORTED_FORMAT' });
    await expect(parseMemoryImport(json([]), 'memories.json', MEMORY_IMPORT_MAX_BYTES + 1)).rejects.toMatchObject({ code: 'FILE_TOO_LARGE' });
    await expect(parseMemoryImport(new Uint8Array([0xff]), 'memories.json')).rejects.toMatchObject({ code: 'INVALID_UTF8' });
    await expect(parseMemoryImport(encode('['), 'memories.json')).rejects.toMatchObject({ code: 'INVALID_JSON' });
    const invalidDocuments: readonly unknown[] = [
      { briefIndex: 'name', content: 'value' },
      { _instructions: {}, memories: [], extra: true },
      { _instructions: {} },
      { memories: 'not-an-array' },
    ];
    for (const invalidDocument of invalidDocuments) {
      await expect(parseMemoryImport(json(invalidDocument), 'memories.json')).rejects.toMatchObject({ code: 'INVALID_JSON' });
    }
    await expect(parseMemoryImport(json([]), 'memories.json')).rejects.toMatchObject({ code: 'INVALID_ITEM_COUNT' });
    await expect(
      parseMemoryImport(
        json(
          Array.from({ length: 51 }, () => ({
            briefIndex: 'name',
            content: 'value',
          })),
        ),
        'memories.json',
      ),
    ).rejects.toMatchObject({ code: 'INVALID_ITEM_COUNT' });
  });

  it('rejects the first invalid item and all unknown or authority-bearing fields', async () => {
    const invalidItems: readonly unknown[] = [
      null,
      { briefIndex: 'name' },
      { label: 'legacy', content: 'value' },
      { briefIndex: 'name', content: 'value', memoryId: 'forged' },
      { briefIndex: 'name', content: 'value', tenantId: 'forged' },
      { briefIndex: 'name', content: 'value', knowledgeSourceType: 'LEARNED' },
      { briefIndex: 'name', content: 'value', state: 'ARCHIVED' },
      { briefIndex: 'name', content: 'value', memoryType: 'UNKNOWN' },
      { briefIndex: 'name', content: 'value', labels: 'network' },
      { briefIndex: 'name', content: 'value', labels: Array.from({ length: 11 }, (_, index) => `label-${index}`) },
      { briefIndex: 'name', content: 'value', labels: [' '] },
      { briefIndex: 'name', content: 'value', labels: ['😀'.repeat(257)] },
      { briefIndex: 'name', content: 'value', confidence: -0.01 },
      { briefIndex: 'name', content: 'value', confidence: 1.01 },
      { briefIndex: 'name', content: 'value', confidence: '1' },
      { briefIndex: '   ', content: 'value' },
      { briefIndex: 'name', content: '\n\t' },
      { briefIndex: 42, content: 'value' },
      { briefIndex: '😀'.repeat(2049), content: 'value' },
      { briefIndex: 'name', content: '😀'.repeat(4001) },
    ];

    for (const invalid of invalidItems) {
      await expect(parseMemoryImport(json([{ briefIndex: 'valid', content: 'first' }, invalid]), 'memories.json')).rejects.toMatchObject({
        code: 'INVALID_ITEM',
        rowNumber: 2,
      });
    }
  });

  it('accepts summary and content exactly at their Unicode code point limits', async () => {
    const briefIndex = '摘'.repeat(2048);
    const content = '文'.repeat(4000);

    const parsed = await parseMemoryImport(
      json([
        {
          briefIndex,
          content,
          labels: ['签'.repeat(256)],
          confidence: 1,
        },
      ]),
      'memories.json',
    );

    expect(parsed.memories[0]?.briefIndex).toBe(briefIndex);
    expect(parsed.memories[0]?.content).toBe(content);
    expect(parsed.memories[0]?.labels).toEqual(['签'.repeat(256)]);
  });

  it('uses original JSON indexes for stable idempotency within one import batch', async () => {
    const bytes = json([
      { briefIndex: 'name', content: 'zhang san' },
      { briefIndex: 'age', content: '28' },
      { briefIndex: 'skill', content: 'NodeJs' },
    ]);
    const parsed = await parseMemoryImport(bytes, 'memories.json');
    const remaining = [parsed.memories[0]!, parsed.memories[2]!].map((entry) => toBatchCreateItem(entry, 'batch-1'));

    expect(remaining.map((item) => item.idempotencyKey)).toEqual(['ltm-import-json-v2-batch-1-0', 'ltm-import-json-v2-batch-1-2']);
    expect(remaining[0]).toMatchObject({
      memoryType: 'USER_CHARACTERISTICS',
      knowledgeSourceType: 'CONFIGURED',
      state: 'ACTIVE',
      confidence: 1,
      labels: [],
    });
    expect(remaining[0]?.idempotencyKey).toBe(toBatchCreateItem(parsed.memories[0]!, 'batch-1').idempotencyKey);
    expect(remaining[0]?.idempotencyKey).not.toBe(toBatchCreateItem(parsed.memories[0]!, 'batch-2').idempotencyKey);
    expect(remaining[0]?.idempotencyKey).toMatch(/^[a-zA-Z0-9\-_]{1,128}$/);
  });

  it('localizes CSV headers and enums while including memory source and update time', () => {
    const exportedAt = new Date('2026-07-28T08:09:10.000Z');
    const summaries = [
      {
        memoryId: 'memory-1',
        memoryType: 'FACTUAL',
        knowledgeSourceType: 'LEARNED',
        state: 'ACTIVE',
        briefIndex: '=BGP, "neighbor"',
        content: 'Prefer route-policy checks\r\nbefore a reset.',
        labels: ['BGP,edge', '@ops'],
        confidence: 0.8,
        isPinned: false,
        accessCount: 2,
        createTime: 1,
        updateTime: Date.parse('2026-07-28T08:09:10.000Z'),
        version: 3,
      },
      {
        memoryId: 'memory-2',
        memoryType: 'USER_CHARACTERISTICS',
        knowledgeSourceType: 'CONFIGURED',
        state: 'ACTIVE',
        briefIndex: 'personalized preference',
        content: 'Show impact before diagnostic details.',
        labels: [],
        confidence: 1,
        isPinned: false,
        accessCount: 0,
        createTime: 1,
        updateTime: Date.parse('2026-07-28T08:09:10.000Z'),
        version: 1,
      },
    ] as const;
    const chinese = createMemoryExport(summaries, 'zh-CN');
    const english = createMemoryExport(summaries, 'en-US');

    expect(chinese.startsWith('\uFEFF记忆类型,摘要,正文,置信度,记忆来源,状态,更新时间,标签1')).toBe(true);
    expect(chinese).toContain('事实记忆');
    expect(chinese).toContain('智能沉淀');
    expect(chinese).toContain('有效');
    expect(chinese).toContain('个性化配置');
    expect(chinese).not.toContain('用户偏好');
    expect(chinese).toContain('2026');
    expect(chinese).not.toContain('FACTUAL');
    expect(english.startsWith('\uFEFFMemory type,Summary,Content,Confidence,Memory source,Status,Updated,Label 1')).toBe(true);
    expect(english).toContain('Factual');
    expect(english).toContain('Learned');
    expect(english).toContain('Active');
    expect(english).toContain('User preference');
    expect(memoryExportFileName(exportedAt)).toBe('nextagent-memories-20260728-080910.csv');
  });

  it.each([
    '＝ｃｍｄ｜＇ ／ｋｎｅｔ ｕｓｅｒ＇！Ａ０',
    '＝1+1',
    "/u0000= cmd|' /C calc'!A0",
    "＝cmd|'/c calc'!'A1",
    '＝ＨＹＰＥＲＬＩＮＫ（＂[http://www.baidu.com](https://link.gitcode.com/?target=http%3A%2F%2Fwww.baidu.com&from=https%3A%2F%2Fgitcode.com%2Fgdd_hw%2FNextAgent%2Fissues%2F676&lang=zh&theme=white)＂，＂ｔｅｓｔ＂）',
    '=1+1',
    '-1+1',
    '+1+1',
    '@SUM(A1)',
    '－1+1',
    '＋1+1',
    '＠SUM(A1)',
    "\u0000=cmd|' /C calc'!A0",
    "\t＝cmd|' /C calc'!A0",
    "\u200B＝cmd|' /C calc'!A0",
  ])('exports spreadsheet injection payload %j as text', (payload) => {
    const content = createMemoryExport(
      [
        {
          memoryId: 'memory-injection',
          memoryType: 'FACTUAL',
          knowledgeSourceType: 'CONFIGURED',
          state: 'ACTIVE',
          briefIndex: payload,
          content: payload,
          labels: [payload],
          confidence: 0.8,
          isPinned: false,
          accessCount: 0,
          createTime: 1,
          updateTime: 2,
          version: 1,
        },
      ],
      'zh-CN',
    );

    expect(content).toContain(`'${payload}`);
  });

  it('exposes typed transfer errors without leaking file contents', () => {
    const error = new MemoryTransferError('INVALID_ITEM', 3);
    expect(error.message).toBe('INVALID_ITEM');
    expect(error.rowNumber).toBe(3);
  });
});
