export function buildHarnessConfig(options: Record<string, unknown>): {
  models: { nextagent: { adapter: string; args: string[]; timeout_sec: number; use_usage_proxy: boolean } };
};
export function classifyUpstreamTaskResult(
  result: Record<string, unknown>,
  evidence?: { modelReasoningOnlyOutputLimitObserved?: boolean },
): Record<string, unknown> & { terminalStatus: string; taskScore: number };
export function mergeHarnessTaskResult(
  summary: Record<string, unknown>,
  raw?: Record<string, unknown> & { adapter_result?: unknown; adapter_results?: unknown[] },
): Record<string, unknown>;
export function resolveHarnessTaskProcessResult(
  processResult: { exitCode: number; stdout: string; stderr: string },
  raw?: Record<string, unknown>,
): Record<string, unknown>;
export function runWithBoundedInfrastructureRetry(options: Record<string, any>): Promise<Record<string, unknown>>;
export function readHarnessTaskResult(resultRoot: string, taskId: string): Promise<Record<string, unknown> | undefined>;
