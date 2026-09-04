import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { ReleaseCheckResult, ReleaseCheckStatus } from './e2e-helpers.js';

export interface CaseInventoryConfig<TCaseId extends string> {
  readonly checkId: string;
  readonly requiredCaseIds: readonly TCaseId[];
  readonly caseTitles: Record<TCaseId, string>;
}

export interface CaseRecord<TCaseId extends string> {
  readonly caseId: TCaseId;
  readonly title: string;
  readonly status: ReleaseCheckStatus;
  readonly safeReason?: string | undefined;
  readonly evidenceRefs: readonly string[];
  readonly startedAt: string;
  readonly endedAt: string;
}

const STATUS_PRIORITY: Record<ReleaseCheckStatus, number> = {
  FAILED: 4,
  TIMEOUT: 3,
  UNAVAILABLE: 2,
  MISSING: 1,
  PASSED: 0,
};

export function createCaseInventory<TCaseId extends string>(config: CaseInventoryConfig<TCaseId>) {
  const caseResults = new Map<TCaseId, CaseRecord<TCaseId>>();
  const persistentResultsPath = resolvePersistentResultsPath(config.checkId);

  hydrateCaseResults(caseResults, persistentResultsPath);

  function recordCaseResult(
    caseId: TCaseId,
    status: ReleaseCheckStatus,
    opts?: {
      readonly safeReason?: string | undefined;
      readonly evidenceRefs?: readonly string[];
      readonly startedAt?: string;
      readonly endedAt?: string;
    },
  ): CaseRecord<TCaseId> {
    const now = new Date().toISOString();
    const record: CaseRecord<TCaseId> = {
      caseId,
      title: config.caseTitles[caseId],
      status,
      safeReason: opts?.safeReason,
      startedAt: opts?.startedAt ?? now,
      endedAt: opts?.endedAt ?? now,
      evidenceRefs: opts?.evidenceRefs ?? [],
    };
    caseResults.set(caseId, record);
    persistCaseResults(caseResults, persistentResultsPath);
    return record;
  }

  function writeReleaseCheckResult(reportPath?: string): ReleaseCheckResult {
    const evidenceRefs: string[] = [];
    const missingCases = config.requiredCaseIds.filter((id) => !caseResults.has(id));

    for (const id of missingCases) {
      const record = recordCaseResult(id, 'MISSING', { safeReason: 'required case not executed' });
      evidenceRefs.push(JSON.stringify(record));
    }

    let gateStatus: ReleaseCheckStatus = 'PASSED';
    let gatePriority = 0;
    for (const record of caseResults.values()) {
      const p = STATUS_PRIORITY[record.status];
      if (p > gatePriority) {
        gateStatus = record.status;
        gatePriority = p;
      }
      evidenceRefs.push(JSON.stringify(record));
    }

    const result: ReleaseCheckResult = {
      checkId: config.checkId as ReleaseCheckResult['checkId'],
      status: gateStatus,
      evidenceRefs,
    };

    if (reportPath !== undefined) {
      writeFileSync(reportPath, JSON.stringify(result, null, 2), 'utf8');
    }

    return result;
  }

  function clearCaseResults(): void {
    caseResults.clear();
    if (persistentResultsPath !== undefined) {
      rmSync(persistentResultsPath, { force: true });
    }
  }

  return { recordCaseResult, writeReleaseCheckResult, clearCaseResults, config };
}

function resolvePersistentResultsPath(checkId: string): string | undefined {
  const explicit = process.env.NEXTAGENT_CASE_RESULTS_FILE;
  if (explicit !== undefined && explicit.trim().length > 0) {
    return resolve(explicit);
  }
  const reportDir = process.env.NEXTAGENT_RELEASE_CHECK_DIR;
  if (reportDir === undefined || reportDir.trim().length === 0) {
    return undefined;
  }
  return resolve(reportDir, `${checkId}.cases.json`);
}

function hydrateCaseResults<TCaseId extends string>(caseResults: Map<TCaseId, CaseRecord<TCaseId>>, persistentResultsPath?: string): void {
  if (persistentResultsPath === undefined || !existsSync(persistentResultsPath)) {
    return;
  }
  try {
    const raw = JSON.parse(readFileSync(persistentResultsPath, 'utf8')) as unknown;
    if (!Array.isArray(raw)) {
      return;
    }
    for (const record of raw) {
      if (typeof record !== 'object' || record === null) {
        continue;
      }
      const typed = record as CaseRecord<TCaseId>;
      if (typeof typed.caseId !== 'string' || typeof typed.title !== 'string' || typeof typed.status !== 'string') {
        continue;
      }
      caseResults.set(typed.caseId, typed);
    }
  } catch {
    // Ignore malformed persisted case state and rebuild from fresh execution.
  }
}

function persistCaseResults<TCaseId extends string>(caseResults: Map<TCaseId, CaseRecord<TCaseId>>, persistentResultsPath?: string): void {
  if (persistentResultsPath === undefined) {
    return;
  }
  writeFileSync(persistentResultsPath, JSON.stringify([...caseResults.values()], null, 2), 'utf8');
}
