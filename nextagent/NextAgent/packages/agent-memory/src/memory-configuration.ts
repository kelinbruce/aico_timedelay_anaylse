import { deepFreeze } from '@nextagent/agent-common';

export type MemoryConfigStatus = 'VALID' | 'INVALID' | 'DISABLED';
export type MemoryConfigDiagnosticSource = 'default' | 'explicit';
export type MemoryConfigExtractionStrategy = 'RULE_FIRST' | 'LLM_ONLY';

export interface MemoryConfigProjection {
  readonly enabled?: boolean;
  readonly search?: {
    readonly 'default-limit'?: number;
    readonly 'min-confidence'?: number;
  };
  readonly extraction?: {
    readonly enabled?: boolean;
    readonly strategy?: string;
    readonly crossSessionSchedule?: string;
    readonly maxCycleTrajectories?: number;
    readonly maxCandidates?: number;
    readonly timeoutMs?: number;
    readonly lookbackDays?: number;
  };
  readonly aging?: {
    readonly enabled?: boolean;
    readonly schedule?: string;
    readonly decayStaleDays?: number;
    readonly archiveRetentionDays?: number;
    readonly decayFactor?: number;
    readonly batchLimit?: number;
    readonly timeoutMs?: number;
    readonly reviveConfidenceBoost?: number;
  };
}

export interface MemoryOwnerConfig {
  readonly enabled: boolean;
  readonly status: MemoryConfigStatus;
  readonly search: {
    readonly defaultLimit: number;
    readonly minConfidence: number;
  };
  readonly extraction: {
    readonly enabled: boolean;
    readonly strategy: MemoryConfigExtractionStrategy;
    readonly crossSessionSchedule?: string;
    readonly maxCycleTrajectories: number;
    readonly maxCandidates: number;
    readonly timeoutMs: number;
    readonly lookbackDays: number;
  };
  readonly aging: {
    readonly enabled: boolean;
    readonly schedule?: string;
    readonly decayStaleDays: number;
    readonly archiveRetentionDays: number;
    readonly decayFactor: number;
    readonly batchLimit: number;
    readonly timeoutMs: number;
    readonly reviveConfidenceBoost: number;
  };
  readonly diagnostics: readonly MemoryOwnerConfigDiagnostic[];
}

export interface MemoryOwnerConfigDiagnostic {
  readonly issueCode: string;
  readonly status: MemoryConfigStatus;
  readonly fieldRef: string;
  readonly safeMessage: string;
  readonly source: MemoryConfigDiagnosticSource;
}

export interface MemoryConfigValidationIssue {
  readonly issueCode: string;
  readonly fieldRef: string;
  readonly safeMessage: string;
}

export type MemoryConfigValidationResult =
  { readonly status: 'valid'; readonly config: MemoryOwnerConfig } | { readonly status: 'invalid'; readonly issue: MemoryConfigValidationIssue };

import { isSupportedMemoryCronSchedule } from './memory-cron.js';

export function defaultMemoryConfig(): MemoryOwnerConfig {
  return normalizeMemoryConfig(undefined);
}

export function validateMemoryConfig(projection?: MemoryConfigProjection): MemoryConfigValidationResult {
  const issue = validateMemoryConfigProjection(projection);
  if (issue !== undefined) {
    return { status: 'invalid', issue };
  }
  return { status: 'valid', config: normalizeMemoryConfig(projection) };
}

function normalizeMemoryConfig(memory?: MemoryConfigProjection): MemoryOwnerConfig {
  const enabled = memory?.enabled ?? true;
  const source = memory?.enabled === undefined ? 'default' : 'explicit';
  const status = enabled ? 'VALID' : 'DISABLED';
  return deepFreeze({
    enabled,
    status,
    search: {
      defaultLimit: memory?.search?.['default-limit'] ?? 20,
      minConfidence: memory?.search?.['min-confidence'] ?? 0.3,
    },
    extraction: {
      enabled: enabled && (memory?.extraction?.enabled ?? true),
      strategy: (memory?.extraction?.strategy ?? 'RULE_FIRST') as MemoryConfigExtractionStrategy,
      crossSessionSchedule: memory?.extraction?.crossSessionSchedule ?? '0 0 0 * * ?',
      maxCycleTrajectories: memory?.extraction?.maxCycleTrajectories ?? 20,
      maxCandidates: memory?.extraction?.maxCandidates ?? 50,
      timeoutMs: memory?.extraction?.timeoutMs ?? 60_000,
      lookbackDays: memory?.extraction?.lookbackDays ?? 7,
    },
    aging: {
      enabled: enabled && (memory?.aging?.enabled ?? true),
      schedule: memory?.aging?.schedule ?? '0 0 0 * * ?',
      decayStaleDays: memory?.aging?.decayStaleDays ?? 30,
      archiveRetentionDays: memory?.aging?.archiveRetentionDays ?? 90,
      decayFactor: memory?.aging?.decayFactor ?? 0.05,
      batchLimit: memory?.aging?.batchLimit ?? 1_000,
      timeoutMs: memory?.aging?.timeoutMs ?? 30_000,
      reviveConfidenceBoost: memory?.aging?.reviveConfidenceBoost ?? 0.1,
    },
    diagnostics: [
      {
        issueCode: enabled ? 'MEMORY_CONFIG_VALID' : 'MEMORY_CONFIG_DISABLED_EXPLICIT',
        status,
        fieldRef: 'nextAgent.memory.enabled',
        safeMessage: enabled
          ? source === 'default'
            ? 'Long-term memory configuration is enabled by default.'
            : 'Long-term memory configuration is enabled.'
          : 'Long-term memory is disabled by explicit configuration.',
        source,
      },
    ],
  });
}

function validateMemoryConfigProjection(memory?: MemoryConfigProjection): MemoryConfigValidationIssue | undefined {
  if (memory === undefined) {
    return undefined;
  }
  if (memory.enabled !== undefined && typeof memory.enabled !== 'boolean') {
    return memoryInvalid('nextAgent.memory.enabled', 'Memory enabled must be boolean.');
  }
  const search = memory.search;
  if (search !== undefined) {
    if (!isObject(search)) {
      return memoryInvalid('nextAgent.memory.search', 'Memory search configuration must be an object.');
    }
    const defaultLimit = search['default-limit'];
    if (defaultLimit !== undefined && !integerInRange(defaultLimit, 1, 100)) {
      return memoryInvalid('nextAgent.memory.search.default-limit', 'Memory search default-limit must be in [1, 100].');
    }
    const minConfidence = search['min-confidence'];
    if (minConfidence !== undefined && !numberInRange(minConfidence, 0, 1)) {
      return memoryInvalid('nextAgent.memory.search.min-confidence', 'Memory search min-confidence must be in [0, 1].');
    }
  }
  const extraction = memory.extraction;
  if (extraction !== undefined) {
    if (!isObject(extraction)) {
      return memoryInvalid('nextAgent.memory.extraction', 'Memory extraction configuration must be an object.');
    }
    if (extraction.enabled !== undefined && typeof extraction.enabled !== 'boolean') {
      return memoryInvalid('nextAgent.memory.extraction.enabled', 'Memory extraction enabled must be boolean.');
    }
    if (extraction.strategy !== undefined && extraction.strategy !== 'RULE_FIRST' && extraction.strategy !== 'LLM_ONLY') {
      return memoryInvalid('nextAgent.memory.extraction.strategy', 'Memory extraction strategy must be RULE_FIRST or LLM_ONLY.');
    }
    if (
      extraction.crossSessionSchedule !== undefined &&
      (typeof extraction.crossSessionSchedule !== 'string' || !isSupportedMemoryCronSchedule(extraction.crossSessionSchedule))
    ) {
      return memoryInvalid(
        'nextAgent.memory.extraction.crossSessionSchedule',
        'Memory extraction crossSessionSchedule must use the supported six-field minute cron format.',
      );
    }
    if (extraction.maxCycleTrajectories !== undefined && !integerInRange(extraction.maxCycleTrajectories, 5, 50)) {
      return memoryInvalid('nextAgent.memory.extraction.maxCycleTrajectories', 'Memory extraction maxCycleTrajectories must be in [5, 50].');
    }
    if (extraction.maxCandidates !== undefined && !integerInRange(extraction.maxCandidates, 10, 200)) {
      return memoryInvalid('nextAgent.memory.extraction.maxCandidates', 'Memory extraction maxCandidates must be in [10, 200].');
    }
    if (extraction.timeoutMs !== undefined && !integerInRange(extraction.timeoutMs, 10_000, 300_000)) {
      return memoryInvalid('nextAgent.memory.extraction.timeoutMs', 'Memory extraction timeoutMs must be in [10000, 300000].');
    }
    if (extraction.lookbackDays !== undefined && !integerInRange(extraction.lookbackDays, 1, 30)) {
      return memoryInvalid('nextAgent.memory.extraction.lookbackDays', 'Memory extraction lookbackDays must be in [1, 30].');
    }
  }
  const aging = memory.aging;
  if (aging === undefined) {
    return undefined;
  }
  if (!isObject(aging)) {
    return memoryInvalid('nextAgent.memory.aging', 'Memory aging configuration must be an object.');
  }
  if (aging.enabled !== undefined && typeof aging.enabled !== 'boolean') {
    return memoryInvalid('nextAgent.memory.aging.enabled', 'Memory aging enabled must be boolean.');
  }
  if (aging.schedule !== undefined && (typeof aging.schedule !== 'string' || !isSupportedMemoryCronSchedule(aging.schedule))) {
    return memoryInvalid('nextAgent.memory.aging.schedule', 'Memory aging schedule must use the supported six-field minute cron format.');
  }
  if (aging.decayStaleDays !== undefined && !integerInRange(aging.decayStaleDays, 7, 365)) {
    return memoryInvalid('nextAgent.memory.aging.decayStaleDays', 'Memory aging decayStaleDays must be in [7, 365].');
  }
  if (aging.archiveRetentionDays !== undefined && !integerInRange(aging.archiveRetentionDays, 30, 730)) {
    return memoryInvalid('nextAgent.memory.aging.archiveRetentionDays', 'Memory aging archiveRetentionDays must be in [30, 730].');
  }
  if (aging.decayFactor !== undefined && !numberInRange(aging.decayFactor, 0.01, 0.5)) {
    return memoryInvalid('nextAgent.memory.aging.decayFactor', 'Memory aging decayFactor must be in [0.01, 0.5].');
  }
  if (aging.batchLimit !== undefined && !integerInRange(aging.batchLimit, 100, 10_000)) {
    return memoryInvalid('nextAgent.memory.aging.batchLimit', 'Memory aging batchLimit must be in [100, 10000].');
  }
  if (aging.timeoutMs !== undefined && !integerInRange(aging.timeoutMs, 5_000, 120_000)) {
    return memoryInvalid('nextAgent.memory.aging.timeoutMs', 'Memory aging timeoutMs must be in [5000, 120000].');
  }
  if (aging.reviveConfidenceBoost !== undefined && !numberInRange(aging.reviveConfidenceBoost, 0.01, 0.5)) {
    return memoryInvalid('nextAgent.memory.aging.reviveConfidenceBoost', 'Memory aging reviveConfidenceBoost must be in [0.01, 0.5].');
  }
  return undefined;
}

function memoryInvalid(fieldRef: string, safeMessage: string): MemoryConfigValidationIssue {
  return { issueCode: 'MEMORY_CONFIG_INVALID', fieldRef, safeMessage };
}

function integerInRange(value: unknown, min: number, max: number): boolean {
  return typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max;
}

function numberInRange(value: unknown, min: number, max: number): boolean {
  return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
