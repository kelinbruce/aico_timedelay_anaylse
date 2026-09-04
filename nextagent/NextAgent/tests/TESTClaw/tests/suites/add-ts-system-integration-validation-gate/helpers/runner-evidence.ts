import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

import type { SystemIntegrationCaseDefinition, SystemIntegrationCaseId } from '../case-manifest.js';
import type { ExportedArtifact } from './evidence-safety.js';
import type { NormalizedExecutionResult } from './reporter.js';

export async function linkPassingCaseEvidence(input: {
  readonly evidenceRoot: string;
  readonly definitions: readonly SystemIntegrationCaseDefinition[];
  readonly executionResults: readonly NormalizedExecutionResult[];
}): Promise<{
  readonly executionResults: readonly NormalizedExecutionResult[];
  readonly artifacts: readonly ExportedArtifact[];
}> {
  const filesByCaseId = await findCaseEvidenceFiles(input.evidenceRoot);
  const resultsByRef = new Map(input.executionResults.map((entry) => [entry.executionRef, entry]));
  const artifacts: ExportedArtifact[] = [];

  const executionResults = await Promise.all(
    input.definitions.map(async (definition): Promise<NormalizedExecutionResult> => {
      const current = resultsByRef.get(definition.executionRef);
      if (current?.result !== 'PASSED') {
        return current ?? missingResult(definition.executionRef);
      }
      const evidenceFiles = filesByCaseId.get(definition.caseId) ?? [];
      if (evidenceFiles.length !== 1) {
        return evidenceFailure(definition.executionRef, evidenceFiles.length === 0 ? 'missing' : 'duplicate');
      }
      const evidenceFile = evidenceFiles[0];
      const content = await readFile(evidenceFile, 'utf8');
      if (!isMatchingPassingEvidence(content, definition.caseId)) {
        return evidenceFailure(definition.executionRef, 'invalid');
      }
      const evidenceRef = path.relative(input.evidenceRoot, evidenceFile).split(path.sep).join('/');
      artifacts.push({
        caseId: definition.caseId,
        surface: 'evidence',
        content,
      });
      return Object.freeze({
        ...current,
        evidenceRefs: Object.freeze([evidenceRef]),
      });
    }),
  );

  return Object.freeze({
    executionResults: Object.freeze(executionResults),
    artifacts: Object.freeze(artifacts),
  });
}

async function findCaseEvidenceFiles(evidenceRoot: string): Promise<Map<SystemIntegrationCaseId, string[]>> {
  const filesByCaseId = new Map<SystemIntegrationCaseId, string[]>();
  await visit(evidenceRoot, async (filePath) => {
    if (path.basename(path.dirname(filePath)) !== 'cases') {
      return;
    }
    const caseId = path.basename(filePath, '.json');
    if (!/^TC-SI-\d{3}$/.test(caseId)) {
      return;
    }
    const typedCaseId = caseId as SystemIntegrationCaseId;
    const paths = filesByCaseId.get(typedCaseId) ?? [];
    paths.push(filePath);
    filesByCaseId.set(typedCaseId, paths);
  });
  return filesByCaseId;
}

async function visit(root: string, action: (filePath: string) => Promise<void>): Promise<void> {
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const entryPath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      await visit(entryPath, action);
    } else if (entry.isFile()) {
      await action(entryPath);
    }
  }
}

function isMatchingPassingEvidence(content: string, caseId: SystemIntegrationCaseId): boolean {
  try {
    const parsed = JSON.parse(content) as Record<string, unknown>;
    return parsed.schemaVersion === 1 && parsed.caseId === caseId && parsed.result === 'PASSED';
  } catch {
    return false;
  }
}

function evidenceFailure(executionRef: string, reason: 'missing' | 'duplicate' | 'invalid'): NormalizedExecutionResult {
  return Object.freeze({
    executionRef,
    result: 'FAILED',
    failurePhase: 'evidence',
    evidenceRefs: Object.freeze([`reason:case-evidence-${reason}`]),
  });
}

function missingResult(executionRef: string): NormalizedExecutionResult {
  return Object.freeze({
    executionRef,
    result: 'MISSING',
    failurePhase: 'execute',
    evidenceRefs: Object.freeze(['runner:missing']),
  });
}
