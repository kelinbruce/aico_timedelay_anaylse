import {
  KNOWLEDGE_SOURCE_TYPES,
  MEMORY_STATES,
  MEMORY_TYPES,
  type BatchCreateLongTermMemoryItem,
  type KnowledgeSourceType,
  type LongTermMemorySummary,
  type MemoryState,
  type MemoryType,
} from '../../state/contracts.ts';
import type { SupportedLocale } from '../../i18n/index.ts';

export const MEMORY_IMPORT_SCHEMA_VERSION = 2;
export const MEMORY_IMPORT_MAX_BYTES = 5 * 1024 * 1024;
export const MEMORY_IMPORT_MAX_ITEMS = 50;
export const MEMORY_IMPORT_TEMPLATE_FILE_NAME = 'nextagent-memory-import-template.json';

const FORMULA_PREFIX = /^[=+\-@]/;
const FORMULA_IGNORED_PREFIX = /^(?:(?:\/|\\)u0000|[\u0000-\u0020\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufeff])+/i;
const MEMORY_IMPORT_FIELDS: readonly string[] = ['briefIndex', 'content', 'memoryType', 'labels', 'confidence'];
const MEMORY_IMPORT_MAX_LABELS = 10;
const MEMORY_IMPORT_MAX_LABEL_LENGTH = 256;

const MEMORY_IMPORT_TEMPLATES = {
  'zh-CN': {
    _instructions: {
      memoryTypeDescriptions: {
        FACTUAL: '事实记忆：安全的环境事实、配置事实、约束、版本、SLA 或拓扑信息。',
        CONCEPTUAL: '概念记忆：业务或电信领域的概念、定义、别名及其关系。',
        PROCEDURAL: '流程记忆：可复用的操作、排查或验证流程知识。',
        USER_CHARACTERISTICS: '用户特征记忆：用于明确适配目的的低敏感度工作流、语言、术语或偏好特征。',
      },
      usage: '请只编辑 memories 数组中的记忆记录；_instructions 仅用于说明，不会被导入。',
      requiredFields: 'briefIndex（摘要，必填，最多 2048 个字符）和 content（正文，必填，最多 4000 个字符）。',
      optionalFields: 'memoryType、labels、confidence 可配置，也可省略、填 null 或留空。',
      defaults: '为空时默认：memoryType=USER_CHARACTERISTICS，labels=[]，confidence=1。',
      labels: 'labels 必须是字符串数组，最多 10 个标签，每个标签最多 256 个字符。',
      confidence: 'confidence 必须是 0 到 1（含边界）的数字。',
      limits: 'memories 必须包含 1 至 50 条记录；用户设定记忆总量仍受 50 条服务端限制。',
    },
    memories: [
      {
        briefIndex: '北京核心网 AMF 版本',
        content: '北京核心网 AMF 当前运行版本为 V3.2.1。',
        memoryType: 'FACTUAL',
        labels: ['核心网', 'AMF'],
        confidence: 0.95,
      },
      {
        briefIndex: '切换成功率定义',
        content: '切换成功率表示成功完成切换的次数占切换尝试总次数的比例。',
        memoryType: 'CONCEPTUAL',
        labels: ['无线', 'KPI'],
        confidence: 0.9,
      },
      {
        briefIndex: 'BGP 邻居中断排查',
        content: '先检查邻居状态和接口连通性，再核对路由策略与认证配置，最后在变更后验证邻居恢复。',
        memoryType: 'PROCEDURAL',
        labels: ['BGP', '故障排查'],
        confidence: 0.9,
      },
      {
        briefIndex: '运维报告偏好',
        content: '用户偏好先查看结论和影响范围，再查看详细排查步骤。',
        memoryType: 'USER_CHARACTERISTICS',
        labels: ['偏好', '报告'],
        confidence: 1,
      },
    ],
  },
  'en-US': {
    _instructions: {
      memoryTypeDescriptions: {
        FACTUAL: 'Factual memory: safe environment or configuration facts, constraints, versions, SLAs, or topology information.',
        CONCEPTUAL: 'Conceptual memory: business or telecom-domain concepts, definitions, aliases, and relationships.',
        PROCEDURAL: 'Procedural memory: reusable operational, troubleshooting, or verification procedures.',
        USER_CHARACTERISTICS:
          'User characteristics: low-sensitivity workflow, language, terminology, or preference traits used for an explicit adaptation purpose.',
      },
      usage: 'Edit only the memory records in the memories array. _instructions is guidance and will not be imported.',
      requiredFields: 'briefIndex (summary, required, up to 2048 characters) and content (body, required, up to 4000 characters).',
      optionalFields: 'memoryType, labels, and confidence may be configured, omitted, set to null, or left blank.',
      defaults: 'Blank values default to memoryType=USER_CHARACTERISTICS, labels=[], and confidence=1.',
      labels: 'labels must be an array of up to 10 strings, with each label limited to 256 characters.',
      confidence: 'confidence must be a number from 0 to 1, inclusive.',
      limits: 'memories must contain 1 to 50 records. The server also enforces a total limit of 50 user-configured memories.',
    },
    memories: [
      {
        briefIndex: 'Beijing core AMF version',
        content: 'The Beijing core network AMF is currently running version V3.2.1.',
        memoryType: 'FACTUAL',
        labels: ['core network', 'AMF'],
        confidence: 0.95,
      },
      {
        briefIndex: 'Handover success rate definition',
        content: 'Handover success rate is the ratio of successful handovers to total handover attempts.',
        memoryType: 'CONCEPTUAL',
        labels: ['radio', 'KPI'],
        confidence: 0.9,
      },
      {
        briefIndex: 'Troubleshoot a BGP neighbor outage',
        content: 'Check neighbor state and interface reachability, verify routing policy and authentication, then confirm recovery after the change.',
        memoryType: 'PROCEDURAL',
        labels: ['BGP', 'troubleshooting'],
        confidence: 0.9,
      },
      {
        briefIndex: 'Operations report preference',
        content: 'The user prefers conclusions and impact scope before detailed troubleshooting steps.',
        memoryType: 'USER_CHARACTERISTICS',
        labels: ['preference', 'report'],
        confidence: 1,
      },
    ],
  },
} as const satisfies Record<SupportedLocale, unknown>;

const MEMORY_EXPORT_LOCALIZATIONS = {
  'zh-CN': {
    headers: ['记忆类型', '摘要', '正文', '置信度', '记忆来源', '状态', '更新时间'],
    labelHeader: (index: number): string => `标签${index}`,
    memoryTypes: {
      FACTUAL: '事实记忆',
      CONCEPTUAL: '概念记忆',
      PROCEDURAL: '程序性记忆',
      USER_CHARACTERISTICS: '个性化配置',
    },
    knowledgeSources: {
      LEARNED: '智能沉淀',
      CONFIGURED: '用户设定',
      SYSTEM_DEFAULT: '系统默认',
    },
    states: {
      ACTIVE: '有效',
      ARCHIVED: '已归档',
    },
  },
  'en-US': {
    headers: ['Memory type', 'Summary', 'Content', 'Confidence', 'Memory source', 'Status', 'Updated'],
    labelHeader: (index: number): string => `Label ${index}`,
    memoryTypes: {
      FACTUAL: 'Factual',
      CONCEPTUAL: 'Conceptual',
      PROCEDURAL: 'Procedural',
      USER_CHARACTERISTICS: 'User preference',
    },
    knowledgeSources: {
      LEARNED: 'Learned',
      CONFIGURED: 'User configured',
      SYSTEM_DEFAULT: 'System default',
    },
    states: {
      ACTIVE: 'Active',
      ARCHIVED: 'Archived',
    },
  },
} as const;

export type MemoryTransferErrorCode =
  'FILE_TOO_LARGE' | 'INVALID_UTF8' | 'INVALID_JSON' | 'UNSUPPORTED_FORMAT' | 'INVALID_ITEM_COUNT' | 'INVALID_ITEM';

export class MemoryTransferError extends Error {
  constructor(
    readonly code: MemoryTransferErrorCode,
    readonly rowNumber?: number,
  ) {
    super(code);
    this.name = 'MemoryTransferError';
  }
}

export interface MemoryTransferEntry {
  readonly sourceIndex: number;
  readonly memoryType: MemoryType;
  readonly knowledgeSourceType: KnowledgeSourceType;
  readonly briefIndex: string;
  readonly content: string;
  readonly labels: readonly string[];
  readonly confidence: number;
  readonly state: MemoryState;
}

export interface ParsedMemoryImport {
  readonly memories: readonly MemoryTransferEntry[];
}

function codePointLength(value: string): number {
  return Array.from(value).length;
}

function isBoundedString(value: unknown, max: number): value is string {
  return typeof value === 'string' && value.trim().length > 0 && codePointLength(value) <= max;
}

function isMemoryType(value: unknown): value is MemoryType {
  return typeof value === 'string' && (MEMORY_TYPES as readonly string[]).includes(value);
}

function isEmptyOptionalValue(value: unknown): boolean {
  return value === undefined || value === null || (typeof value === 'string' && value.trim() === '');
}

function parseOptionalMemoryType(value: unknown): MemoryType | null {
  if (isEmptyOptionalValue(value)) {
    return 'USER_CHARACTERISTICS';
  }
  return isMemoryType(value) ? value : null;
}

function parseOptionalLabels(value: unknown): readonly string[] | null {
  if (isEmptyOptionalValue(value)) {
    return [];
  }
  if (
    !Array.isArray(value) ||
    value.length > MEMORY_IMPORT_MAX_LABELS ||
    value.some((label) => !isBoundedString(label, MEMORY_IMPORT_MAX_LABEL_LENGTH))
  ) {
    return null;
  }
  return value;
}

function parseOptionalConfidence(value: unknown): number | null {
  if (isEmptyOptionalValue(value)) {
    return 1;
  }
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1 ? value : null;
}

function isKnowledgeSourceType(value: unknown): value is KnowledgeSourceType {
  return typeof value === 'string' && (KNOWLEDGE_SOURCE_TYPES as readonly string[]).includes(value);
}

function isMemoryState(value: unknown): value is MemoryState {
  return typeof value === 'string' && (MEMORY_STATES as readonly string[]).includes(value);
}

function parseImportEntry(value: unknown, sourceIndex: number): MemoryTransferEntry {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new MemoryTransferError('INVALID_ITEM', sourceIndex + 1);
  }
  const candidate = value as Record<string, unknown>;
  const keys = Object.keys(candidate);
  const memoryType = parseOptionalMemoryType(candidate.memoryType);
  const labels = parseOptionalLabels(candidate.labels);
  const confidence = parseOptionalConfidence(candidate.confidence);
  if (
    !keys.includes('briefIndex') ||
    !keys.includes('content') ||
    keys.some((key) => !MEMORY_IMPORT_FIELDS.includes(key)) ||
    !isBoundedString(candidate.briefIndex, 2048) ||
    !isBoundedString(candidate.content, 4000) ||
    memoryType === null ||
    labels === null ||
    confidence === null
  ) {
    throw new MemoryTransferError('INVALID_ITEM', sourceIndex + 1);
  }
  return {
    sourceIndex,
    memoryType,
    knowledgeSourceType: 'CONFIGURED',
    briefIndex: candidate.briefIndex,
    content: candidate.content,
    labels: [...labels],
    confidence,
    state: 'ACTIVE',
  };
}

function extractImportEntries(parsed: unknown): readonly unknown[] {
  if (Array.isArray(parsed)) {
    return parsed;
  }
  if (typeof parsed !== 'object' || parsed === null) {
    throw new MemoryTransferError('INVALID_JSON');
  }
  const document = parsed as Record<string, unknown>;
  const keys = Object.keys(document);
  if (!keys.includes('memories') || keys.some((key) => key !== '_instructions' && key !== 'memories') || !Array.isArray(document.memories)) {
    throw new MemoryTransferError('INVALID_JSON');
  }
  return document.memories;
}

export async function parseMemoryImport(bytes: Uint8Array, fileName: string, declaredSize = bytes.byteLength): Promise<ParsedMemoryImport> {
  if (!fileName.toLowerCase().endsWith('.json')) {
    throw new MemoryTransferError('UNSUPPORTED_FORMAT');
  }
  if (declaredSize > MEMORY_IMPORT_MAX_BYTES || bytes.byteLength > MEMORY_IMPORT_MAX_BYTES) {
    throw new MemoryTransferError('FILE_TOO_LARGE');
  }

  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes).replace(/^\uFEFF/, '');
  } catch {
    throw new MemoryTransferError('INVALID_UTF8');
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new MemoryTransferError('INVALID_JSON');
  }
  const entries = extractImportEntries(parsed);
  if (entries.length < 1 || entries.length > MEMORY_IMPORT_MAX_ITEMS) {
    throw new MemoryTransferError('INVALID_ITEM_COUNT');
  }

  return {
    memories: entries.map(parseImportEntry),
  };
}

export function toBatchCreateItem(entry: MemoryTransferEntry, importBatchId: string): BatchCreateLongTermMemoryItem {
  return {
    memoryType: entry.memoryType,
    knowledgeSourceType: entry.knowledgeSourceType,
    briefIndex: entry.briefIndex,
    content: entry.content,
    labels: [...entry.labels],
    confidence: entry.confidence,
    idempotencyKey: `ltm-import-json-v${MEMORY_IMPORT_SCHEMA_VERSION}-${importBatchId}-${entry.sourceIndex}`,
    state: entry.state,
  };
}

export function createMemoryImportTemplate(locale: SupportedLocale = 'zh-CN'): string {
  return `${JSON.stringify(MEMORY_IMPORT_TEMPLATES[locale], null, 2)}\n`;
}

function downloadText(content: string, fileName: string, type: string): void {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  anchor.hidden = true;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

export function downloadMemoryImportTemplate(locale: SupportedLocale = 'zh-CN'): void {
  downloadText(createMemoryImportTemplate(locale), MEMORY_IMPORT_TEMPLATE_FILE_NAME, 'application/json;charset=utf-8');
}

function protectFormula(value: string): string {
  const inspectionValue = value.normalize('NFKC').replace(FORMULA_IGNORED_PREFIX, '');
  return FORMULA_PREFIX.test(inspectionValue) ? `'${value}` : value;
}

function csvCell(value: string | number): string {
  const protectedValue = protectFormula(String(value));
  return /[",\r\n]/.test(protectedValue) ? `"${protectedValue.replace(/"/g, '""')}"` : protectedValue;
}

function formatExportTime(value: number, locale: SupportedLocale): string {
  return new Intl.DateTimeFormat(locale, {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(new Date(value));
}

function exportRow(summary: LongTermMemorySummary, locale: SupportedLocale): ReadonlyArray<string | number> {
  if (
    !isMemoryType(summary.memoryType) ||
    !isKnowledgeSourceType(summary.knowledgeSourceType) ||
    !isMemoryState(summary.state) ||
    !isBoundedString(summary.briefIndex, 2048) ||
    !isBoundedString(summary.content, 4000) ||
    !Number.isFinite(summary.confidence) ||
    summary.confidence < 0 ||
    summary.confidence > 1 ||
    !Number.isFinite(summary.updateTime) ||
    summary.updateTime < 0 ||
    !Array.isArray(summary.labels) ||
    summary.labels.length > 10 ||
    summary.labels.some((label) => !isBoundedString(label, 256))
  ) {
    throw new Error('Memory export contains an invalid summary.');
  }
  const localization = MEMORY_EXPORT_LOCALIZATIONS[locale];
  return [
    localization.memoryTypes[summary.memoryType],
    summary.briefIndex,
    summary.content,
    summary.confidence,
    localization.knowledgeSources[summary.knowledgeSourceType],
    localization.states[summary.state],
    formatExportTime(summary.updateTime, locale),
    ...Array.from({ length: 10 }, (_, index) => summary.labels[index] ?? ''),
  ];
}

export function createMemoryExport(summaries: readonly LongTermMemorySummary[], locale: SupportedLocale = 'zh-CN'): string {
  const localization = MEMORY_EXPORT_LOCALIZATIONS[locale];
  const headers = [...localization.headers, ...Array.from({ length: 10 }, (_, index) => localization.labelHeader(index + 1))];
  const rows = [headers, ...summaries.map((summary) => exportRow(summary, locale))];
  return `\uFEFF${rows.map((row) => row.map(csvCell).join(',')).join('\r\n')}\r\n`;
}

export function memoryExportFileName(exportedAt = new Date()): string {
  const compact = exportedAt.toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
  return `nextagent-memories-${compact}.csv`;
}

export function downloadMemoryExport(content: string, fileName: string): void {
  downloadText(content, fileName, 'text/csv;charset=utf-8');
}
