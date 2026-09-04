export type SafeCapabilityResult =
  | {
      readonly kind: 'todoList';
      readonly todos: SafeTodoItem[];
    }
  | {
      readonly kind: 'commandOutput';
      readonly exitCode: number;
      readonly stdoutPreview: string;
      readonly stderrPreview: string;
      readonly stdoutTruncated: boolean;
      readonly stderrTruncated: boolean;
      readonly timedOut?: boolean;
    }
  | {
      readonly kind: 'fileRead';
      readonly filePath: string;
      readonly contentPreview: string;
      readonly truncated: boolean;
      readonly offset?: number;
      readonly limit?: number;
      readonly nextOffset?: number;
    }
  | {
      readonly kind: 'fileList';
      readonly filenames: string[];
      readonly totalCount: number;
      readonly truncated: boolean;
    }
  | {
      readonly kind: 'grepResult';
      readonly outputMode: 'files_with_matches';
      readonly totalFilesWithMatches: number;
      readonly totalMatches: number;
      readonly truncated: boolean;
      readonly filenames: string[];
    }
  | {
      readonly kind: 'grepResult';
      readonly outputMode: 'content';
      readonly totalFilesWithMatches: number;
      readonly totalMatches: number;
      readonly truncated: boolean;
      readonly locations: SafeGrepLocation[];
    }
  | {
      readonly kind: 'fileWrite';
      readonly operation: 'create' | 'update';
      readonly filePath: string;
    }
  | {
      readonly kind: 'skillLoaded';
      readonly name: string;
      readonly status: string;
    }
  | {
      readonly kind: 'httpResponse';
      readonly httpStatus: number;
      readonly responseMode: 'BUFFERED' | 'STREAMING';
      readonly streamCompleted: boolean;
      readonly bodyPreview?: string;
      readonly bodyPreviewTruncated?: boolean;
    }
  | {
      readonly kind: 'workflowResult';
      readonly recipeName: string;
      readonly status: string;
      readonly answerPreviews?: string[];
    }
  | {
      readonly kind: 'ragRetrieval';
      readonly totalCount: number;
      readonly items: SafeRagRetrievalItem[];
    }
  | {
      readonly kind: 'toolSearch';
      readonly tools: SafeToolSearchItem[];
      readonly totalCount: number;
      readonly truncated: boolean;
    }
  | SafeCronResult
  | {
      readonly kind: 'pendingInputAnswer';
      readonly answers: string[][];
      readonly truncated: boolean;
    };

export interface SafeTodoItem {
  readonly content: string;
  readonly activeForm: string;
  readonly status: 'pending' | 'in_progress' | 'completed';
}

export interface SafeRagRetrievalItem {
  readonly source: string;
  readonly content: string;
}

export interface SafeGrepLocation {
  readonly filePath: string;
  readonly lineNumber: number;
}

export interface SafeToolSearchItem {
  readonly capability_id: string;
  readonly name: string;
  readonly kind: 'TOOL' | 'SKILL';
  readonly description?: string;
}

interface SafeCronJob {
  readonly id: string;
  readonly cron: string;
  readonly humanSchedule: string;
  readonly recurring: boolean;
}

interface SafeCronDelay {
  readonly days?: number;
  readonly hours?: number;
  readonly minutes?: number;
}

type SafeCronResult =
  | {
      readonly kind: 'cron';
      readonly action: 'create';
      readonly id: string;
      readonly humanSchedule: string;
      readonly recurring: boolean;
      readonly delay?: SafeCronDelay;
    }
  | { readonly kind: 'cron'; readonly action: 'delete'; readonly id: string }
  | {
      readonly kind: 'cron';
      readonly action: 'list';
      readonly jobs: SafeCronJob[];
      readonly totalCount: number;
      readonly truncated: boolean;
    };
export function readSafeCapabilityResult(value: unknown): SafeCapabilityResult | null {
  const record = readRecord(value);
  if (!record) {
    return null;
  }

  switch (record.kind) {
    case 'todoList': {
      const todos = readTodoItems(record.todos);
      if (todos === null) {
        return null;
      }
      return { kind: 'todoList', todos };
    }
    case 'commandOutput': {
      const exitCode = readNumber(record.exitCode);
      const stdoutPreview = readString(record.stdoutPreview);
      const stderrPreview = readString(record.stderrPreview);
      const stdoutTruncated = readBoolean(record.stdoutTruncated);
      const stderrTruncated = readBoolean(record.stderrTruncated);
      if (exitCode === null || stdoutPreview === null || stderrPreview === null || stdoutTruncated === null || stderrTruncated === null) {
        return null;
      }
      return {
        kind: 'commandOutput',
        exitCode,
        stdoutPreview,
        stderrPreview,
        stdoutTruncated,
        stderrTruncated,
        ...(readBoolean(record.timedOut) === true ? { timedOut: true } : {}),
      };
    }
    case 'fileRead': {
      const filePath = projectSafeDisplayPath(record.filePath);
      const contentPreview = readString(record.contentPreview);
      const truncated = readBoolean(record.truncated);
      if (filePath === null || contentPreview === null || truncated === null) {
        return null;
      }
      return {
        kind: 'fileRead',
        filePath,
        contentPreview,
        truncated,
        ...(readNumber(record.offset) === null ? {} : { offset: readNumber(record.offset) as number }),
        ...(readNumber(record.limit) === null ? {} : { limit: readNumber(record.limit) as number }),
        ...(readNumber(record.nextOffset) === null ? {} : { nextOffset: readNumber(record.nextOffset) as number }),
      };
    }
    case 'fileList': {
      if (!Array.isArray(record.filenames)) {
        return null;
      }
      const filenames = record.filenames.map(projectSafeDisplayPath).filter((entry): entry is string => entry !== null);
      const totalCount = readNumber(record.totalCount);
      const truncated = readBoolean(record.truncated);
      if (totalCount === null || truncated === null) {
        return null;
      }
      return { kind: 'fileList', filenames, totalCount, truncated };
    }
    case 'grepResult': {
      const outputMode = readString(record.outputMode);
      const totalFilesWithMatches = readNonNegativeInteger(record.totalFilesWithMatches);
      const totalMatches = readNonNegativeInteger(record.totalMatches);
      const truncated = readBoolean(record.truncated);
      if (totalFilesWithMatches === null || totalMatches === null || truncated === null) {
        return null;
      }
      if (outputMode === 'files_with_matches') {
        if (!hasExactKeys(record, ['kind', 'outputMode', 'totalFilesWithMatches', 'totalMatches', 'truncated', 'filenames'])) {
          return null;
        }
        const filenames = readGrepFilenames(record.filenames);
        if (filenames === null || filenames.length > totalFilesWithMatches) {
          return null;
        }
        return { kind: 'grepResult', outputMode, totalFilesWithMatches, totalMatches, truncated, filenames };
      }
      if (outputMode === 'content') {
        if (!hasExactKeys(record, ['kind', 'outputMode', 'totalFilesWithMatches', 'totalMatches', 'truncated', 'locations'])) {
          return null;
        }
        const locations = readGrepLocations(record.locations);
        if (locations === null || locations.length > totalMatches) {
          return null;
        }
        return { kind: 'grepResult', outputMode, totalFilesWithMatches, totalMatches, truncated, locations };
      }
      return null;
    }
    case 'fileWrite': {
      const operation = readString(record.operation);
      const filePath = projectSafeDisplayPath(record.filePath);
      if ((operation !== 'create' && operation !== 'update') || filePath === null) {
        return null;
      }
      return { kind: 'fileWrite', operation, filePath };
    }
    case 'skillLoaded': {
      const name = readString(record.name);
      const status = readString(record.status);
      if (name === null || status === null) {
        return null;
      }
      return { kind: 'skillLoaded', name, status };
    }
    case 'httpResponse': {
      const httpStatus = readNumber(record.httpStatus);
      const responseMode = readString(record.responseMode);
      const streamCompleted = readBoolean(record.streamCompleted);
      if (httpStatus === null || (responseMode !== 'BUFFERED' && responseMode !== 'STREAMING') || streamCompleted === null) {
        return null;
      }
      const bodyPreview = readString(record.bodyPreview);
      const bodyPreviewTruncated = readBoolean(record.bodyPreviewTruncated);
      return {
        kind: 'httpResponse',
        httpStatus,
        responseMode,
        streamCompleted,
        ...(bodyPreview === null ? {} : { bodyPreview }),
        ...(bodyPreviewTruncated === null ? {} : { bodyPreviewTruncated }),
      };
    }
    case 'workflowResult': {
      const recipeName = readString(record.recipeName);
      const workflowStatus = readString(record.status);
      if (recipeName === null || workflowStatus === null) {
        return null;
      }
      const rawPreviews = Array.isArray(record.answerPreviews) ? record.answerPreviews : [];
      const answerPreviews = rawPreviews.filter((item): item is string => typeof item === 'string' && item.trim().length > 0).slice(0, 10);
      return {
        kind: 'workflowResult',
        recipeName,
        status: workflowStatus,
        ...(answerPreviews.length === 0 ? {} : { answerPreviews }),
      };
    }
    case 'ragRetrieval': {
      const totalCount = readNonNegativeInteger(record.totalCount);
      const items = readRagRetrievalItems(record.items);
      if (totalCount === null || items === null || items.length > totalCount) {
        return null;
      }
      return { kind: 'ragRetrieval', totalCount, items };
    }
    case 'toolSearch': {
      if (!hasExactKeys(record, ['kind', 'tools', 'totalCount', 'truncated'])) {
        return null;
      }
      const tools = readToolSearchItems(record.tools);
      const totalCount = readNonNegativeInteger(record.totalCount);
      const truncated = readBoolean(record.truncated);
      if (tools === null || totalCount === null || truncated === null || tools.length > totalCount) {
        return null;
      }
      return { kind: 'toolSearch', tools, totalCount, truncated };
    }
    case 'cron':
      return readCronResult(record);
    case 'pendingInputAnswer': {
      const answers = readPendingInputAnswerGroups(record.answers);
      const truncated = readBoolean(record.truncated);
      if (answers === null || truncated === null) {
        return null;
      }
      return { kind: 'pendingInputAnswer', answers, truncated };
    }
    default:
      return null;
  }
}

function projectSafeDisplayPath(value: unknown): string | null {
  const raw = readString(value)?.trim();
  if (!raw) {
    return null;
  }
  const normalized = raw.replace(/\0/gu, '').replace(/\\/gu, '/').replace(/\/+/gu, '/').trim();
  const isAbsolute = normalized.startsWith('/') || /^[A-Za-z]:\//u.test(normalized) || /^[A-Za-z]:$/u.test(normalized);
  const segments = normalized
    .split('/')
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0 && segment !== '.' && segment !== '..' && !/^[A-Za-z]:$/u.test(segment));
  if (segments.length === 0) {
    return null;
  }
  const displaySegments = isAbsolute ? segments.slice(-3) : segments;
  const displayPath = `${isAbsolute ? '…/' : ''}${displaySegments.join('/')}`;
  return displayPath.length <= 256 ? displayPath : `…/${displayPath.slice(Math.max(0, displayPath.length - 254))}`;
}

function readGrepFilenames(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length > 50) {
    return null;
  }
  const filenames = value.map(readGrepLogicalPath);
  return filenames.some((entry) => entry === null) ? null : (filenames as string[]);
}

function readGrepLocations(value: unknown): SafeGrepLocation[] | null {
  if (!Array.isArray(value) || value.length > 50) {
    return null;
  }
  const locations: SafeGrepLocation[] = [];
  for (const valueItem of value) {
    const item = readRecord(valueItem);
    if (item === null || !hasExactKeys(item, ['filePath', 'lineNumber'])) {
      return null;
    }
    const filePath = readGrepLogicalPath(item.filePath);
    const lineNumber = readPositiveInteger(item.lineNumber);
    if (filePath === null || lineNumber === null) {
      return null;
    }
    locations.push({ filePath, lineNumber });
  }
  return locations;
}

function readGrepLogicalPath(value: unknown): string | null {
  const path = readString(value);
  if (
    path === null ||
    path.length === 0 ||
    path.length > 256 ||
    path !== path.trim() ||
    path.includes('\\') ||
    /[\u0000-\u001f\u007f]/u.test(path) ||
    path.startsWith('/') ||
    /^[A-Za-z]:/u.test(path)
  ) {
    return null;
  }
  return path.split('/').some((segment) => segment.length === 0 || segment === '.' || segment === '..') ? null : path;
}

function hasExactKeys(record: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(record).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function readTodoItems(value: unknown): SafeTodoItem[] | null {
  if (!Array.isArray(value)) {
    return null;
  }
  const todos: SafeTodoItem[] = [];
  for (const item of value) {
    const record = readRecord(item);
    const content = readString(record?.content);
    const activeForm = readString(record?.activeForm);
    const status = readString(record?.status);
    if (content === null || activeForm === null || (status !== 'pending' && status !== 'in_progress' && status !== 'completed')) {
      return null;
    }
    todos.push({ content, activeForm, status });
  }
  return todos;
}

function readRagRetrievalItems(value: unknown): SafeRagRetrievalItem[] | null {
  if (!Array.isArray(value)) {
    return null;
  }
  const items: SafeRagRetrievalItem[] = [];
  for (const valueItem of value) {
    const item = readRecord(valueItem);
    if (item === null || !hasExactKeys(item, ['source', 'content'])) {
      return null;
    }
    const source = readString(item.source);
    const content = readString(item.content);
    if (source === null || content === null) {
      return null;
    }
    items.push({ source, content });
  }
  return items;
}

function readToolSearchItems(value: unknown): SafeToolSearchItem[] | null {
  if (!Array.isArray(value) || value.length > 50) {
    return null;
  }
  const tools: SafeToolSearchItem[] = [];
  for (const valueItem of value) {
    const item = readRecord(valueItem);
    if (item === null) {
      return null;
    }
    const itemKeys = item.description === undefined ? ['capability_id', 'name', 'kind'] : ['capability_id', 'name', 'kind', 'description'];
    if (!hasExactKeys(item, itemKeys)) {
      return null;
    }
    const capabilityId = readBoundedText(item.capability_id, 256);
    const name = readBoundedText(item.name, 256);
    const kind = readString(item.kind);
    const description = item.description === undefined ? null : readBoundedText(item.description, 1_000);
    if (capabilityId === null || name === null || (kind !== 'TOOL' && kind !== 'SKILL') || (item.description !== undefined && description === null)) {
      return null;
    }
    tools.push({ capability_id: capabilityId, name, kind, ...(description === null ? {} : { description }) });
  }
  return tools;
}

function readCronResult(record: Record<string, unknown>): SafeCronResult | null {
  const action = readString(record.action);
  if (action === 'create') {
    const createKeys =
      record.delay === undefined
        ? ['kind', 'action', 'id', 'humanSchedule', 'recurring']
        : ['kind', 'action', 'id', 'humanSchedule', 'recurring', 'delay'];
    if (!hasExactKeys(record, createKeys)) {
      return null;
    }
    const id = readBoundedText(record.id, 256);
    const humanSchedule = readBoundedText(record.humanSchedule, 256);
    const recurring = readBoolean(record.recurring);
    const delay = record.delay === undefined ? null : readCronDelay(record.delay);
    if (id === null || humanSchedule === null || recurring === null || (record.delay !== undefined && delay === null)) {
      return null;
    }
    return { kind: 'cron', action, id, humanSchedule, recurring, ...(delay === null ? {} : { delay }) };
  }
  if (action === 'delete') {
    if (!hasExactKeys(record, ['kind', 'action', 'id'])) {
      return null;
    }
    const id = readBoundedText(record.id, 256);
    return id === null ? null : { kind: 'cron', action, id };
  }
  if (action !== 'list' || !hasExactKeys(record, ['kind', 'action', 'jobs', 'totalCount', 'truncated'])) {
    return null;
  }
  const jobs = readCronJobs(record.jobs);
  const totalCount = readNonNegativeInteger(record.totalCount);
  const truncated = readBoolean(record.truncated);
  return jobs === null || totalCount === null || truncated === null || jobs.length > totalCount
    ? null
    : { kind: 'cron', action, jobs, totalCount, truncated };
}

function readCronDelay(value: unknown): SafeCronDelay | null {
  const record = readRecord(value);
  if (record === null || Object.keys(record).some((key) => !['days', 'hours', 'minutes'].includes(key))) {
    return null;
  }
  const delay: SafeCronDelay = {};
  for (const key of ['days', 'hours', 'minutes'] as const) {
    if (record[key] === undefined) {
      continue;
    }
    const component = readNonNegativeInteger(record[key]);
    if (component === null) {
      return null;
    }
    Object.assign(delay, { [key]: component });
  }
  return Object.keys(delay).length === 0 ? null : delay;
}

function readCronJobs(value: unknown): SafeCronJob[] | null {
  if (!Array.isArray(value) || value.length > 50) {
    return null;
  }
  const jobs: SafeCronJob[] = [];
  for (const valueItem of value) {
    const item = readRecord(valueItem);
    if (item === null || !hasExactKeys(item, ['id', 'cron', 'humanSchedule', 'recurring'])) {
      return null;
    }
    const id = readBoundedText(item.id, 256);
    const cron = readBoundedText(item.cron, 256);
    const humanSchedule = readBoundedText(item.humanSchedule, 256);
    const recurring = readBoolean(item.recurring);
    if (id === null || cron === null || humanSchedule === null || recurring === null) {
      return null;
    }
    jobs.push({ id, cron, humanSchedule, recurring });
  }
  return jobs;
}

function readPendingInputAnswerGroups(value: unknown): string[][] | null {
  if (!Array.isArray(value) || value.length === 0 || value.length > 20) {
    return null;
  }
  const answers: string[][] = [];
  let totalCodePoints = 0;
  for (const group of value) {
    if (!Array.isArray(group) || group.length === 0 || group.length > 9) {
      return null;
    }
    const answerGroup: string[] = [];
    for (const item of group) {
      if (typeof item !== 'string' || item.trim().length === 0) {
        return null;
      }
      const codePointLength = Array.from(item).length;
      totalCodePoints += codePointLength;
      if (codePointLength > 4_096 || totalCodePoints > 24_576) {
        return null;
      }
      answerGroup.push(item);
    }
    answers.push(answerGroup);
  }
  return answers;
}

function readString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function readBoundedText(value: unknown, maxLength: number): string | null {
  const text = readString(value);
  return text !== null && text.length > 0 && Array.from(text).length <= maxLength ? text : null;
}

function readNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function readNonNegativeInteger(value: unknown): number | null {
  const number = readNumber(value);
  return number !== null && Number.isInteger(number) && number >= 0 ? number : null;
}

function readPositiveInteger(value: unknown): number | null {
  const number = readNumber(value);
  return number !== null && Number.isSafeInteger(number) && number >= 1 ? number : null;
}

function readBoolean(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null;
}
