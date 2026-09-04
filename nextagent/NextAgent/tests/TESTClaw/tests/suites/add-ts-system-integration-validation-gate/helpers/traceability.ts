import type { SystemIntegrationCaseDefinition, SystemIntegrationCaseId } from '../case-manifest.js';
import type { SystemIntegrationCaseResult, SystemIntegrationReport } from './report.js';

export interface TraceabilityEntry {
  readonly sourceCaseRef: string;
  readonly caseId: SystemIntegrationCaseId;
  readonly featureRefs: readonly string[];
  readonly functionRefs: readonly string[];
  readonly requirementRefs: readonly string[];
  readonly executionRef: string;
  readonly result: SystemIntegrationCaseResult['result'];
  readonly evidenceRefs: readonly string[];
}

export interface TraceabilityIndex {
  readonly entries: readonly TraceabilityEntry[];
  readonly findByCaseId: (caseId: string) => TraceabilityEntry | undefined;
  readonly findBySourceCaseRef: (sourceCaseRef: string) => TraceabilityEntry | undefined;
  readonly findByExecutionRef: (executionRef: string) => TraceabilityEntry | undefined;
  readonly findBySpecRef: (specRef: string) => readonly TraceabilityEntry[];
}

export function createTraceabilityIndex(definitions: readonly SystemIntegrationCaseDefinition[], report: SystemIntegrationReport): TraceabilityIndex {
  if (definitions.length !== 122 || report.cases.length !== 122) {
    throw new Error('traceability requires exactly 122 definitions and results');
  }
  const resultsById = new Map(report.cases.map((entry) => [entry.caseId, entry]));
  const entries = definitions.map((definition): TraceabilityEntry => {
    const result = resultsById.get(definition.caseId);
    if (
      result === undefined ||
      result.sourceCaseRef !== definition.sourceCaseRef ||
      result.layer !== definition.layer ||
      result.originKind !== definition.originKind ||
      result.ownerGate !== definition.ownerGate
    ) {
      throw new Error(`traceability mismatch for ${definition.caseId}`);
    }
    return Object.freeze({
      sourceCaseRef: definition.sourceCaseRef,
      caseId: definition.caseId,
      featureRefs: definition.featureRefs,
      functionRefs: definition.functionRefs,
      requirementRefs: definition.requirementRefs,
      executionRef: definition.executionRef,
      result: result.result,
      evidenceRefs: result.evidenceRefs,
    });
  });

  const byCaseId = uniqueIndex(entries, (entry) => entry.caseId, 'caseId');
  const bySource = uniqueIndex(entries, (entry) => entry.sourceCaseRef, 'sourceCaseRef');
  const byExecution = uniqueIndex(entries, (entry) => entry.executionRef, 'executionRef');

  return Object.freeze({
    entries: Object.freeze(entries),
    findByCaseId: (caseId: string) => byCaseId.get(caseId),
    findBySourceCaseRef: (sourceCaseRef: string) => bySource.get(sourceCaseRef),
    findByExecutionRef: (executionRef: string) => byExecution.get(executionRef),
    findBySpecRef: (specRef: string) =>
      entries.filter(
        (entry) => entry.featureRefs.includes(specRef) || entry.functionRefs.includes(specRef) || entry.requirementRefs.includes(specRef),
      ),
  });
}

function uniqueIndex(
  entries: readonly TraceabilityEntry[],
  keyOf: (entry: TraceabilityEntry) => string,
  kind: string,
): ReadonlyMap<string, TraceabilityEntry> {
  const index = new Map<string, TraceabilityEntry>();
  for (const entry of entries) {
    const key = keyOf(entry);
    if (index.has(key)) {
      throw new Error(`duplicate traceability ${kind}`);
    }
    index.set(key, entry);
  }
  return index;
}
