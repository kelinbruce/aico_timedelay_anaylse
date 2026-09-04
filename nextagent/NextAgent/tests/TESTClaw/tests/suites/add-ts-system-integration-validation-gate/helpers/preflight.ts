import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import type { SystemIntegrationCaseDefinition, SystemIntegrationInputRoot } from '../case-manifest.js';
import type { NormalizedExecutionResult } from './reporter.js';

export interface SystemIntegrationInputPaths {
  readonly candidateRoot: string;
  readonly externalPackagesRoot: string;
}

export interface SystemIntegrationPreflightResult {
  readonly availableRoots: readonly SystemIntegrationInputRoot[];
  readonly unavailableRoots: readonly SystemIntegrationInputRoot[];
}

const candidateEntries = ['package.json', 'bin', 'config', 'backend', 'node_modules'] as const;
const externalPackages = [
  'node_modules/@nextagent/agent-remote-deployment/package.json',
  'node_modules/@nextagent/agent-platform-gateway-remote/package.json',
  'dist/dev/agent-web-test-hosts/package.json',
  'dist/dev/agent-web-test-hosts/hosting.js',
  'dist/dev/agent-web-test-hosts/dist/local/index.html',
] as const;

export function preflightSystemIntegrationInputs(paths: SystemIntegrationInputPaths): SystemIntegrationPreflightResult {
  const candidateAvailable = candidateEntries.every((entry) => existsSync(resolve(paths.candidateRoot, entry)));
  const externalAvailable = externalPackages.every((entry) => existsSync(resolve(paths.externalPackagesRoot, entry)));
  const availableRoots: SystemIntegrationInputRoot[] = [];
  const unavailableRoots: SystemIntegrationInputRoot[] = [];

  (candidateAvailable ? availableRoots : unavailableRoots).push('candidate');
  (externalAvailable ? availableRoots : unavailableRoots).push('external-packages');

  return Object.freeze({
    availableRoots: Object.freeze(availableRoots),
    unavailableRoots: Object.freeze(unavailableRoots),
  });
}

export function unavailableResultsForPreflight(
  definitions: readonly SystemIntegrationCaseDefinition[],
  preflight: SystemIntegrationPreflightResult,
): readonly NormalizedExecutionResult[] {
  const unavailable = new Set(preflight.unavailableRoots);
  return definitions
    .filter((definition) => definition.requiredInputRoots.some((root) => unavailable.has(root)))
    .map((definition) => {
      const missingRoots = definition.requiredInputRoots.filter((root) => unavailable.has(root));
      return Object.freeze({
        executionRef: definition.executionRef,
        result: 'UNAVAILABLE',
        failurePhase: 'preflight',
        evidenceRefs: Object.freeze(missingRoots.map((root) => `input-root:${root}-unavailable`)),
      } satisfies NormalizedExecutionResult);
    });
}
