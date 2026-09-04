export interface ResumeManifestTask {
  taskId: string;
  supportStatus: string;
  reason?: string;
}

export interface ResumeManifest {
  benchmarkTaskCount: number;
  tasks: ResumeManifestTask[];
}

export function readCompletedPrefix(manifest: ResumeManifest, resultRoot: string, runRoot?: string): Promise<Array<Record<string, unknown>>>;

export interface HarnessPythonToolchain {
  commandRoot: string;
  pythonHome: string;
}

export function resolvePythonExecutable(pythonCommand: string): Promise<string>;
export function prepareHarnessPythonToolchain(options: {
  pythonExecutable: string;
  runRoot: string;
  baseEnvironment?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
}): Promise<HarnessPythonToolchain | undefined>;

export function buildHarnessTaskEnvironment(options: {
  baseEnvironment?: NodeJS.ProcessEnv;
  upstreamRoot: string;
  pythonCommandRoot?: string;
  pythonHome?: string;
  appConfigPath: string;
  providerBaseUrl: string;
  credential: string;
  modelId: string;
  graderBaseUrl: string;
  graderCredential: string;
  graderModelId: string;
}): Record<string, string>;
