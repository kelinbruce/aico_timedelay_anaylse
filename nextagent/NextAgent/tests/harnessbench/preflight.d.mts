export interface HarnessBenchProfile {
  profileId: 'full-suite';
  upstreamUrl: string;
  upstreamCommit: string;
  taskSupport: Record<string, 'execute' | { status: 'unsupported'; reason: string }>;
  modelId: string;
  providerBaseUrlRef: string;
  credentialRef: string;
  graderModelId: string;
  graderProviderBaseUrlRef: string;
  graderCredentialRef: string;
  taskTimeoutSeconds: number;
  terminalTimeoutSeconds: number;
}
export const DEFAULT_HARNESSBENCH_REMOTE: string;
export const DEFAULT_HARNESSBENCH_COMMIT: string;
export const HARNESSBENCH_RESULT_COLLECTION_GRACE_SECONDS: 120;
export function loadProfile(path: string): Promise<HarnessBenchProfile>;
export function loadDiagnosticProfile(path: string): Promise<{ profileId: string; nonScoring: true; taskIds: string[] }>;
export function selectDiagnosticTasks(profile: { taskIds: string[] }, catalog: readonly string[]): string[];
export function validateTaskSupport(taskSupport: HarnessBenchProfile['taskSupport'], catalog: readonly string[]): void;
export function createRunManifest(input: Record<string, unknown> & { profile: HarnessBenchProfile; catalog: readonly string[] }): Readonly<{
  benchmarkTaskCount: number;
  tasks: ReadonlyArray<{ taskId: string; supportStatus: 'execute' | 'unsupported'; reason?: string }>;
  [key: string]: unknown;
}>;
