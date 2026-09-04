export function executeHarnessTask(
  options: Record<string, unknown>,
): Promise<{ sessionId: string; runId: string; requestId: string; terminalStatus: string; workspaceOutcomeObserved: boolean }>;
export function harnessCandidateKey(sessionId: unknown): string;
export function loadHarnessSessionState(candidateRoot: string, upstreamSessionId: unknown): Promise<{ sessionId: string } | undefined>;
export function buildHarnessCandidateConfig(options: { port: number; modelId: string }): {
  modelProfiles: Array<{ models: Array<{ maxOutputTokens: number; timeoutMs: number }> }>;
  sandbox: { enabled: boolean; deniedExecutables: string[] };
};
export function registerProxyRoute(routesFile: string, providerBaseUrl: string): Promise<void>;
export function terminalReasonCode(status: string): 'TERMINAL_FAILED' | 'TASK_TIMED_OUT' | 'REQUEST_CANCELED' | 'UNKNOWN';
export function waitForTerminal(
  baseUrl: string,
  sessionId: string,
  accepted: { runId: string; requestId: string },
  timeoutMs: number,
): Promise<{ status: string; reasonCode?: string }>;
