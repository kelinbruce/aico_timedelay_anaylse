import type { JsonObject } from '@nextagent/agent-common';
import { isRecord } from './shared.js';

/** Maximum recursion depth for nested time parameter extraction. */
const MAX_TIME_PARAM_DEPTH = 5;

interface TimeParamEntry {
  readonly key: string;
  readonly timeType: 'timestamp' | 'time_str';
  readonly timeFormat: string;
  readonly paramDataType: string;
}

/** Recursively extract time parameter definitions from an API inputSchema.
 *  Looks for properties where isTimeParam=true in the schema metadata. */
function extractTimeParamDefinitions(schema: JsonObject, prefix: string, depth: number, results: TimeParamEntry[]): void {
  if (depth > MAX_TIME_PARAM_DEPTH || !isRecord(schema)) {
    return;
  }
  const properties = isRecord(schema.properties) ? schema.properties : undefined;
  if (properties === undefined) {
    return;
  }
  for (const [key, value] of Object.entries(properties)) {
    if (!isRecord(value)) {
      continue;
    }
    const fullPath = prefix.length > 0 ? `${prefix}.${key}` : key;
    const isTimeParam = value.isTimeParam === true || value.isTimeParam === 'true';
    if (isTimeParam) {
      results.push({
        key: fullPath,
        timeType: value.timeType === 'time_str' ? 'time_str' : 'timestamp',
        timeFormat: typeof value.timeFormat === 'string' && value.timeFormat.length > 0 ? value.timeFormat : 'yyyy-MM-dd HH:mm:ss',
        paramDataType: typeof value.paramDataType === 'string' ? value.paramDataType : 'integer',
      });
    }
    // Recurse into object properties
    if (isRecord(value.properties)) {
      extractTimeParamDefinitions(value as JsonObject, fullPath, depth + 1, results);
    }
    // Recurse into array items
    const items = isRecord(value.items) ? value.items : undefined;
    if (value.type === 'array' && isRecord(items) && isRecord(items.properties)) {
      extractTimeParamDefinitions(items as JsonObject, fullPath, depth + 1, results);
    }
  }
}

/** Resolve a dot-path value from a record, returning { parent, leafKey } for mutation. */
function resolvePathForMutation(record: Record<string, unknown>, path: string): { parent: Record<string, unknown>; leafKey: string } | undefined {
  const segments = path.split('.');
  let current: Record<string, unknown> = record;
  for (let i = 0; i < segments.length - 1; i++) {
    const next = current[segments[i]!];
    if (!isRecord(next)) {
      return undefined;
    }
    current = next as Record<string, unknown>;
  }
  return { parent: current, leafKey: segments[segments.length - 1]! };
}

/** NLP-style natural language time resolution (local rules only).
 *  Handles relative time expressions like "今天", "昨天", "N天前", "N小时前", etc.
 *  Returns epoch milliseconds in the process-local timezone, or undefined if unresolvable. */
function resolveNlpTime(text: string, now: Date): number | undefined {
  const normalized = text.trim();
  // 今天 / today
  if (normalized === '今天' || normalized.toLowerCase() === 'today') {
    return startOfDay(now).getTime();
  }
  // 昨天 / yesterday
  if (normalized === '昨天' || normalized.toLowerCase() === 'yesterday') {
    const d = new Date(startOfDay(now));
    d.setDate(d.getDate() - 1);
    return d.getTime();
  }
  // 前天 / day before yesterday
  if (normalized === '前天') {
    const d = new Date(startOfDay(now));
    d.setDate(d.getDate() - 2);
    return d.getTime();
  }
  // N天前
  const daysAgoMatch = normalized.match(/^(\d+)\s*天前$/u);
  if (daysAgoMatch !== null) {
    const d = new Date(startOfDay(now));
    d.setDate(d.getDate() - Number(daysAgoMatch[1]));
    return d.getTime();
  }
  // N小时前
  const hoursAgoMatch = normalized.match(/^(\d+)\s*小时前$/u);
  if (hoursAgoMatch !== null) {
    return now.getTime() - Number(hoursAgoMatch[1]) * 3600_000;
  }
  // N分钟前
  const minutesAgoMatch = normalized.match(/^(\d+)\s*分钟前$/u);
  if (minutesAgoMatch !== null) {
    return now.getTime() - Number(minutesAgoMatch[1]) * 60_000;
  }
  // ISO date string (e.g., "2025-01-01" or "2025-01-01T10:00:00")
  const isoMatch = normalized.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?)?$/u);
  if (isoMatch !== null) {
    const d = new Date(
      Number(isoMatch[1]),
      Number(isoMatch[2]) - 1,
      Number(isoMatch[3]),
      isoMatch[4] !== undefined ? Number(isoMatch[4]) : 0,
      isoMatch[5] !== undefined ? Number(isoMatch[5]) : 0,
      isoMatch[6] !== undefined ? Number(isoMatch[6]) : 0,
    );
    return d.getTime();
  }
  // Unix timestamp string
  const tsMatch = normalized.match(/^(\d{10,13})$/u);
  if (tsMatch !== null) {
    const ts = Number(tsMatch[1]);
    return ts < 1e12 ? ts * 1000 : ts;
  }
  return undefined;
}

/** AI structured time conversion: { datetime, offset } → timestamp. */
function resolveStructuredTime(value: Record<string, unknown>, now: Date): number | undefined {
  const datetime = typeof value.datetime === 'string' ? value.datetime : undefined;
  if (datetime === undefined) {
    return undefined;
  }
  const baseTs = resolveNlpTime(datetime, now);
  if (baseTs === undefined) {
    return undefined;
  }
  let result = baseTs;
  const offsets = Array.isArray(value.offset) ? value.offset : [];
  for (const offset of offsets) {
    if (typeof offset !== 'string') {
      continue;
    }
    const dayMatch = offset.match(/^([+-]?\d+)\s*day$/iu);
    if (dayMatch !== null) {
      result += Number(dayMatch[1]) * 86400_000;
      continue;
    }
    const hourMatch = offset.match(/^([+-]?\d+)\s*hour$/iu);
    if (hourMatch !== null) {
      result += Number(hourMatch[1]) * 3600_000;
      continue;
    }
    const minuteMatch = offset.match(/^([+-]?\d+)\s*min(?:ute)?$/iu);
    if (minuteMatch !== null) {
      result += Number(minuteMatch[1]) * 60_000;
    }
  }
  return result;
}

function startOfDay(date: Date): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

/** Format a timestamp to a date string using the given format pattern. */
function formatTimestamp(ts: number, format: string): string {
  const d = new Date(ts);
  return format
    .replace('yyyy', String(d.getFullYear()))
    .replace('MM', String(d.getMonth() + 1).padStart(2, '0'))
    .replace('dd', String(d.getDate()).padStart(2, '0'))
    .replace('HH', String(d.getHours()).padStart(2, '0'))
    .replace('mm', String(d.getMinutes()).padStart(2, '0'))
    .replace('ss', String(d.getSeconds()).padStart(2, '0'));
}

/** Coerce a timestamp to the target parameter data type. */
function coerceTimestampToType(ts: number, paramDataType: string): unknown {
  switch (paramDataType) {
    case 'integer':
    case 'int':
    case 'long':
      return Math.floor(ts / 1000);
    case 'float':
    case 'double':
      return ts / 1000;
    case 'string':
      return String(ts);
    default:
      return Math.floor(ts / 1000);
  }
}

export interface TimeParamConversionOptions {
  readonly apiInputSchema?: JsonObject;
}

/** Convert time parameters in resolved inputs based on API inputSchema metadata.
 *  Mutates `resolved` in place for identified time parameters. */
export function convertTimeParameters(resolved: Record<string, unknown>, options: TimeParamConversionOptions): void {
  const schema = options.apiInputSchema;
  if (schema === undefined) {
    return;
  }
  const timeParams: TimeParamEntry[] = [];
  extractTimeParamDefinitions(schema, '', 0, timeParams);
  if (timeParams.length === 0) {
    return;
  }
  const now = new Date();
  for (const param of timeParams) {
    const target = resolvePathForMutation(resolved, param.key);
    if (target === undefined) {
      continue;
    }
    const rawValue = target.parent[target.leafKey];
    if (rawValue === undefined || rawValue === null) {
      continue;
    }
    let timestamp: number | undefined;
    if (isRecord(rawValue)) {
      // AI structured time conversion
      timestamp = resolveStructuredTime(rawValue as Record<string, unknown>, now);
    } else if (typeof rawValue === 'string' || Array.isArray(rawValue)) {
      // NLP time conversion
      const text = Array.isArray(rawValue) ? (rawValue as string[]).join(' ') : rawValue;
      timestamp = resolveNlpTime(text, now);
    }
    if (timestamp === undefined) {
      continue;
    }
    if (param.timeType === 'time_str') {
      target.parent[target.leafKey] = formatTimestamp(timestamp, param.timeFormat);
    } else {
      target.parent[target.leafKey] = coerceTimestampToType(timestamp, param.paramDataType);
    }
  }
}
