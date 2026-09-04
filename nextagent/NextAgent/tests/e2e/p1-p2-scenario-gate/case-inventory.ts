import { createCaseInventory } from '../case-inventory-base.js';

export type P1P2ScenarioGateCaseId = 'e2e-P1P2-01' | 'e2e-P1P2-02' | 'e2e-P1P2-03' | 'e2e-P1P2-04' | 'e2e-P1P2-05' | 'e2e-P1P2-06';

export const REQUIRED_CASE_IDS: readonly P1P2ScenarioGateCaseId[] = [
  'e2e-P1P2-01',
  'e2e-P1P2-02',
  'e2e-P1P2-03',
  'e2e-P1P2-04',
  'e2e-P1P2-05',
  'e2e-P1P2-06',
];

const CASE_TITLES: Record<P1P2ScenarioGateCaseId, string> = {
  'e2e-P1P2-01': 'extension governance over real product process',
  'e2e-P1P2-02': 'long-term memory over real request and persistence path',
  'e2e-P1P2-03': 'routing child-agent skill loading over real request path',
  'e2e-P1P2-04': 'human pending input over real request and answer boundary',
  'e2e-P1P2-05': 'workflow routing and execution over real request path',
  'e2e-P1P2-06': 'conversation share over real create and shared-view path',
};

const { recordCaseResult, writeReleaseCheckResult, clearCaseResults, config } = createCaseInventory<P1P2ScenarioGateCaseId>({
  checkId: 'p1-p2-scenario-gate',
  requiredCaseIds: REQUIRED_CASE_IDS,
  caseTitles: CASE_TITLES,
});

export { clearCaseResults, config, recordCaseResult, writeReleaseCheckResult };
