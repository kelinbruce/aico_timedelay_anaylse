import { createCaseInventory } from '../case-inventory-base.js';

export type AlphaKernelGateCaseId = 'alpha-01' | 'alpha-02' | 'alpha-03' | 'alpha-04' | 'alpha-05' | 'alpha-06' | 'alpha-07';

export const REQUIRED_CASE_IDS: readonly AlphaKernelGateCaseId[] = [
  'alpha-01',
  'alpha-02',
  'alpha-03',
  'alpha-04',
  'alpha-05',
  'alpha-06',
  'alpha-07',
];

const CASE_TITLES: Record<AlphaKernelGateCaseId, string> = {
  'alpha-01': 'minimal Q&A main flow',
  'alpha-02': 'SSE canonical sequence',
  'alpha-03': 'same-session concurrent conflict rejection',
  'alpha-04': 'SafeError security boundary',
  'alpha-05': 'idempotent submit reuse of session and run',
  'alpha-06': 'owner scope isolation',
  'alpha-07': 'same-round parallel tool calls',
};

const { recordCaseResult, writeReleaseCheckResult, clearCaseResults, config } = createCaseInventory<AlphaKernelGateCaseId>({
  checkId: 'alpha-kernel-gate',
  requiredCaseIds: REQUIRED_CASE_IDS,
  caseTitles: CASE_TITLES,
});

export { config, recordCaseResult, writeReleaseCheckResult, clearCaseResults };
