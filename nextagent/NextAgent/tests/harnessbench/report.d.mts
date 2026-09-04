export function normalizeTaskResult(manifestTask: Record<string, unknown>, upstreamResult?: Record<string, unknown>): Record<string, any>;
export function createEvaluationReport(
  manifest: Record<string, any>,
  taskResults: Array<Record<string, any>>,
  options?: Record<string, any>,
): Record<string, any>;
export function writeEvaluationReport(
  outputDirectory: string,
  report: Record<string, any>,
  options?: { baseName?: string },
): Promise<{ jsonPath: string; markdownPath: string }>;
export function renderMarkdown(report: Record<string, any>): string;
export function assertSafeReport(value: unknown): void;
