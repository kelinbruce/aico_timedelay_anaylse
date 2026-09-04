import { createCaseInventory } from '../case-inventory-base.js';

export type ReleasePackageCaseId = 'e2e-P0-19' | 'e2e-P0-20' | 'e2e-P0-25' | 'e2e-P0-26';

export const REQUIRED_CASE_IDS: readonly ReleasePackageCaseId[] = ['e2e-P0-19', 'e2e-P0-20', 'e2e-P0-25', 'e2e-P0-26'];

const CASE_TITLES: Record<ReleasePackageCaseId, string> = {
  'e2e-P0-19': 'illegal config fail closed',
  'e2e-P0-20': 'health readiness',
  'e2e-P0-25': 'with-frontend route precedence',
  'e2e-P0-26': 'manifest evidence integrity',
};

const { recordCaseResult, writeReleaseCheckResult, clearCaseResults, config } = createCaseInventory<ReleasePackageCaseId>({
  checkId: 'release-package',
  requiredCaseIds: REQUIRED_CASE_IDS,
  caseTitles: CASE_TITLES,
});

export { config, recordCaseResult, writeReleaseCheckResult, clearCaseResults };
