import { readFile } from 'node:fs/promises';
import { statSync } from 'node:fs';
import { join } from 'node:path';

const CAPABILITY_DESCRIPTION_FILENAME = 'capabilityDescription.md';
const RESOURCE_DIR = 'resource';

/**
 * Port for locating agent package root directories.
 * Mirrors the ChatUploadConfigSourceLocator shape from agent-attachment-runtime
 * without taking a direct dependency on that package.
 */
export interface CapabilityDescriptionSourceLocator {
  locate: (input: {
    readonly agentId: string;
  }) => Promise<
    | { readonly status: 'found'; readonly agentPackageRoot: string }
    | { readonly status: 'not-configured' | 'not-found' | 'unavailable' | 'invalid'; readonly safeCode: string }
  >;
}

/**
 * Hot-reloadable provider for the agent-owned capability description file.
 * Returns the raw markdown content of
 * `agents/{agentId}/resource/capabilityDescription.md`, or `undefined`
 * when the file does not exist or cannot be read.
 */
export interface CapabilityDescriptionProvider {
  get: (signal?: AbortSignal) => Promise<string | undefined>;
}

export interface CapabilityDescriptionProviderOptions {
  readonly sourceLocator: CapabilityDescriptionSourceLocator;
  readonly activeAgentId: string;
  readonly loadFromFile?: (filePath: string) => Promise<string | undefined>;
}

export function createLocalCapabilityDescriptionProvider(options: CapabilityDescriptionProviderOptions): CapabilityDescriptionProvider {
  return new LocalCapabilityDescriptionProvider(options);
}

export function createRemoteCapabilityDescriptionProvider(options: CapabilityDescriptionProviderOptions): CapabilityDescriptionProvider {
  return new RemoteCapabilityDescriptionProvider(options);
}

async function loadDescriptionFile(filePath: string): Promise<string | undefined> {
  try {
    return await readFile(filePath, 'utf-8');
  } catch {
    return undefined;
  }
}

function computeFileFingerprint(filePath: string): string | undefined {
  try {
    const stat = statSync(filePath);
    return `${filePath}:${stat.size}:${stat.mtimeMs}`;
  } catch {
    return undefined;
  }
}

function resolveDescriptionPath(agentPackageRoot: string): string {
  return join(agentPackageRoot, RESOURCE_DIR, CAPABILITY_DESCRIPTION_FILENAME);
}

class LocalCapabilityDescriptionProvider implements CapabilityDescriptionProvider {
  private cached?: Promise<string | undefined>;

  constructor(private readonly options: CapabilityDescriptionProviderOptions) {}

  async get(signal?: AbortSignal): Promise<string | undefined> {
    if (signal?.aborted === true) {
      return undefined;
    }
    if (this.cached === undefined) {
      this.cached = this.loadOnce();
    }
    return this.cached;
  }

  private async loadOnce(): Promise<string | undefined> {
    const located = await this.options.sourceLocator.locate({ agentId: this.options.activeAgentId });
    if (located.status !== 'found') {
      return undefined;
    }
    const filePath = resolveDescriptionPath(located.agentPackageRoot);
    try {
      return await (this.options.loadFromFile ?? loadDescriptionFile)(filePath);
    } catch {
      return undefined;
    }
  }
}

class RemoteCapabilityDescriptionProvider implements CapabilityDescriptionProvider {
  private cachedFingerprint?: string | undefined;
  private cachedContent?: string | undefined;

  constructor(private readonly options: CapabilityDescriptionProviderOptions) {}

  async get(signal?: AbortSignal): Promise<string | undefined> {
    if (signal?.aborted === true) {
      return undefined;
    }
    const located = await this.options.sourceLocator.locate({ agentId: this.options.activeAgentId });
    if (located.status !== 'found') {
      this.cachedFingerprint = undefined;
      this.cachedContent = undefined;
      return undefined;
    }

    const filePath = resolveDescriptionPath(located.agentPackageRoot);
    const fingerprint = computeFileFingerprint(filePath);

    if (fingerprint === undefined) {
      this.cachedFingerprint = undefined;
      this.cachedContent = undefined;
      return undefined;
    }

    if (fingerprint === this.cachedFingerprint && this.cachedContent !== undefined) {
      return this.cachedContent;
    }

    try {
      const content = await (this.options.loadFromFile ?? loadDescriptionFile)(filePath);
      this.cachedFingerprint = fingerprint;
      this.cachedContent = content;
      return content;
    } catch {
      return undefined;
    }
  }
}
