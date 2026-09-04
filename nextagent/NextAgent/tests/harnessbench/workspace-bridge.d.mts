export function resolveContainedPath(root: string, relativePath: string): string;
export function copyRegularTree(sourceRoot: string, targetRoot: string): Promise<void>;
export function replaceRegularTree(sourceRoot: string, targetRoot: string): Promise<void>;
export function parseTerminalSse(body: string): { status: string } | undefined;
export function latestTimelineSequenceSse(body: string): number | undefined;
