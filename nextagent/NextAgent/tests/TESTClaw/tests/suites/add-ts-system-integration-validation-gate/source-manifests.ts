import { SYSTEM_INTEGRATION_CASES, type SystemIntegrationCaseDefinition } from './case-manifest.ts';

export interface SourceManifestEntry {
  readonly sourceCaseRef: string;
  readonly sourceFile: string;
  readonly sourceToken: string;
}

const fixedSourceFiles: Readonly<Record<string, string>> = Object.freeze({
  'alpha-kernel-gate': 'tests/e2e/alpha-kernel-gate/case-inventory.ts',
  'product-journey': 'tests/e2e/product-journey/case-inventory.ts',
  'security-gate': 'tests/e2e/security/security-gate.test.ts',
  'resilience-gate': 'tests/e2e/resilience/resilience-gate.test.ts',
  'release-package': 'tests/e2e/release-package/case-inventory.ts',
  'p1-p2-scenario-gate': 'tests/e2e/p1-p2-scenario-gate/case-inventory.ts',
});

export const FIXED_GATE_SOURCE_MANIFEST: readonly SourceManifestEntry[] = Object.freeze(
  byOrigin('FIXED_GATE').map((definition) => {
    const [gate, sourceToken] = definition.sourceCaseRef.split(':');
    const sourceFile = fixedSourceFiles[gate];
    if (sourceFile === undefined || sourceToken === undefined) {
      throw new Error(`unknown fixed gate source: ${definition.sourceCaseRef}`);
    }
    return Object.freeze({
      sourceCaseRef: definition.sourceCaseRef,
      sourceFile,
      sourceToken,
    });
  }),
);

export const BACKEND_E2E_SOURCE_MANIFEST: readonly SourceManifestEntry[] = Object.freeze(byOrigin('BACKEND_E2E').map(fromFileReference));

export const BROWSER_E2E_SOURCE_MANIFEST: readonly SourceManifestEntry[] = Object.freeze(byOrigin('BROWSER_E2E').map(fromFileReference));

function byOrigin(originKind: SystemIntegrationCaseDefinition['originKind']): readonly SystemIntegrationCaseDefinition[] {
  return SYSTEM_INTEGRATION_CASES.filter((entry) => entry.originKind === originKind);
}

function fromFileReference(definition: SystemIntegrationCaseDefinition): SourceManifestEntry {
  const separator = definition.sourceCaseRef.lastIndexOf('#');
  if (separator <= 0 || separator === definition.sourceCaseRef.length - 1) {
    throw new Error(`invalid file source ref: ${definition.sourceCaseRef}`);
  }
  return Object.freeze({
    sourceCaseRef: definition.sourceCaseRef,
    sourceFile: definition.sourceCaseRef.slice(0, separator),
    sourceToken: definition.sourceCaseRef.slice(separator + 1),
  });
}
