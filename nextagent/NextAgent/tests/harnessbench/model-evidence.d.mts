export function preflightModel(options: { proxyBaseUrl: string; credential: string; modelId: string; timeoutMs?: number }): Promise<{ ok: true }>;
export function preflightGrader(options: { baseUrl: string; credential: string; modelId: string; timeoutMs?: number }): Promise<{ ok: true }>;
export function summarizeModelEvidence(usage: Record<string, unknown>): {
  status: 'verified' | 'model_evidence_missing';
  requestCount: number;
  totalTokens: number;
};
export function summarizeReasoningOnlyOutputLimitEvidence(options: {
  runRoot: string;
  usageLogFile: string;
}): Promise<boolean>;
