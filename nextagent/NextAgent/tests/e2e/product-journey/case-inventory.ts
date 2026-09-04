import { createCaseInventory } from '../case-inventory-base.js';

export type ProductJourneyCaseId =
  | 'e2e-P0-02'
  | 'e2e-P0-03'
  | 'e2e-P0-04'
  | 'e2e-P0-06'
  | 'e2e-P0-07'
  | 'e2e-P0-08'
  | 'e2e-P0-09'
  | 'e2e-P0-10'
  | 'e2e-P0-11'
  | 'e2e-P0-13'
  | 'e2e-P0-14'
  | 'e2e-P0-15'
  | 'e2e-P0-18'
  | 'e2e-P0-22'
  | 'e2e-P0-23'
  | 'e2e-P0-24';

export const REQUIRED_CASE_IDS: readonly ProductJourneyCaseId[] = [
  'e2e-P0-02',
  'e2e-P0-03',
  'e2e-P0-04',
  'e2e-P0-06',
  'e2e-P0-07',
  'e2e-P0-08',
  'e2e-P0-09',
  'e2e-P0-10',
  'e2e-P0-11',
  'e2e-P0-13',
  'e2e-P0-14',
  'e2e-P0-15',
  'e2e-P0-18',
  'e2e-P0-22',
  'e2e-P0-23',
  'e2e-P0-24',
];

const CASE_TITLES: Record<ProductJourneyCaseId, string> = {
  'e2e-P0-02': 'login session create and conversation read',
  'e2e-P0-03': 'SSE canonical sequence and terminal state',
  'e2e-P0-04': 'SSE and WebSocket lifecycle terminal consistency',
  'e2e-P0-06': 'terminal commit stream history and refresh consistency',
  'e2e-P0-07': 'same-session latest-submit replacement and serial dispatch',
  'e2e-P0-08': 'cancel terminal state and partial answer',
  'e2e-P0-09': 'retry new run and old result traceability',
  'e2e-P0-10': 'edit-resubmit new mainline',
  'e2e-P0-11': 'attachment intake to context',
  'e2e-P0-13': 'long session selection summary compaction and degradation hint',
  'e2e-P0-14': 'large content lazy load on demand',
  'e2e-P0-15': 'model-tool-capability complete loop',
  'e2e-P0-18': 'capability source disable directory and call result',
  'e2e-P0-22': 'feedback immutable and associated facts',
  'e2e-P0-23': 'auto title vs manual title priority',
  'e2e-P0-24': 'bilingual output with telecom term fidelity',
};

const { recordCaseResult, writeReleaseCheckResult, clearCaseResults, config } = createCaseInventory<ProductJourneyCaseId>({
  checkId: 'product-journey',
  requiredCaseIds: REQUIRED_CASE_IDS,
  caseTitles: CASE_TITLES,
});

export { config, recordCaseResult, writeReleaseCheckResult, clearCaseResults };
