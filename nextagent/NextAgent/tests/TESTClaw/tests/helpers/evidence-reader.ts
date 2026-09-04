import { readFileSync, existsSync } from 'node:fs';
import {
  MANIFEST_PATH,
  LAYOUT_CHECK_PATH,
  CONFIG_VALIDATION_PATH,
  STARTUP_PROOF_PATH,
  HEALTH_READINESS_PATH,
  PID_FILE_PATH,
} from './package-root.js';

function readJsonOrUndefined(path: string): Record<string, unknown> | undefined {
  if (!existsSync(path)) {
    return undefined;
  }
  return JSON.parse(readFileSync(path, 'utf8'));
}

export function readManifest(): Record<string, unknown> {
  const data = readJsonOrUndefined(MANIFEST_PATH);
  if (data === undefined) {
    throw new Error(`Manifest not found at ${MANIFEST_PATH}`);
  }
  return data;
}

export function readLayoutCheck(): Record<string, unknown> | undefined {
  return readJsonOrUndefined(LAYOUT_CHECK_PATH);
}

export function readConfigValidation(): Record<string, unknown> | undefined {
  return readJsonOrUndefined(CONFIG_VALIDATION_PATH);
}

export function readStartupProof(): Record<string, unknown> | undefined {
  return readJsonOrUndefined(STARTUP_PROOF_PATH);
}

export function readHealthReadiness(): Record<string, unknown> | undefined {
  return readJsonOrUndefined(HEALTH_READINESS_PATH);
}

export function readPidFile(): { candidateId: string; pid: number } | undefined {
  const data = readJsonOrUndefined(PID_FILE_PATH);
  if (data === undefined) {
    return undefined;
  }
  return { candidateId: String(data.candidateId ?? ''), pid: Number(data.pid ?? -1) };
}

export function validateEvidenceChain(): {
  valid: boolean;
  issues: string[];
} {
  const issues: string[] = [];
  const manifest = readManifest();
  const candidateId = String(manifest.candidateId);

  const evidenceFiles = [
    { name: 'layout-check', reader: readLayoutCheck },
    { name: 'config-validation', reader: readConfigValidation },
    { name: 'startup-proof', reader: readStartupProof },
    { name: 'health-readiness', reader: readHealthReadiness },
  ];

  for (const evidence of evidenceFiles) {
    const data = evidence.reader();
    if (data === undefined) {
      issues.push(`${evidence.name} evidence file missing`);
      continue;
    }
    if (String(data.candidateId) !== candidateId) {
      issues.push(`${evidence.name} candidateId mismatch: expected ${candidateId}, got ${data.candidateId}`);
    }
  }

  return { valid: issues.length === 0, issues };
}

export function isLayoutCheckPassed(): boolean {
  const data = readLayoutCheck();
  return data?.passed === true;
}

export function isStartupProofOk(): boolean {
  const data = readStartupProof();
  return data?.primaryHealth === 'ok' && data?.readiness === 'ready';
}

export function isHealthReadinessPassed(): boolean {
  const data = readHealthReadiness();
  return data?.primaryStatus === 'PASSED' && data?.deepStatus === 'PASSED';
}
