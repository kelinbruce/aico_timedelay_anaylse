import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { dedupeFacts, isLoadingFact } from './skillhub-remote-candidate.js';
import type { SkillHubLoadingFact } from './skillhub-types.js';

const indexFileName = 'remote-skill-content-index.json';
const legacyIndexFileName = 'skillhub-index.json';

export class SkillHubInstalledIndex {
  private static readonly writeQueues = new Map<string, Promise<void>>();

  constructor(private readonly managedInstallRoot: string) {}

  async read(): Promise<readonly SkillHubLoadingFact[]> {
    return this.readUnsafe();
  }

  async readStrict(): Promise<readonly SkillHubLoadingFact[]> {
    const current = await this.readIndexFileStrict(indexFileName);
    if (current !== undefined) {
      return current;
    }
    return (await this.readIndexFileStrict(legacyIndexFileName)) ?? [];
  }

  async write(facts: readonly SkillHubLoadingFact[]): Promise<void> {
    await this.withWriteLock(() => this.writeUnsafe(facts));
  }

  async merge(facts: readonly SkillHubLoadingFact[]): Promise<void> {
    await this.withWriteLock(async () => {
      const byKey = new Map<string, SkillHubLoadingFact>();
      for (const fact of await this.readUnsafe()) {
        byKey.set(installedFactKey(fact), fact);
      }
      for (const fact of facts) {
        byKey.set(installedFactKey(fact), fact);
      }
      await this.writeUnsafe([...byKey.values()]);
    });
  }

  private async readUnsafe(): Promise<readonly SkillHubLoadingFact[]> {
    const current = await this.readIndexFile(indexFileName);
    return current.length > 0 ? current : this.readIndexFile(legacyIndexFileName);
  }

  private async readIndexFile(fileName: string): Promise<readonly SkillHubLoadingFact[]> {
    try {
      const parsed = JSON.parse(await readFile(join(this.managedInstallRoot, fileName), 'utf8')) as unknown;
      return Array.isArray(parsed) ? parsed.map((item) => toLoadingFact(item)).filter((item): item is SkillHubLoadingFact => item !== undefined) : [];
    } catch {
      return [];
    }
  }

  private async readIndexFileStrict(fileName: string): Promise<readonly SkillHubLoadingFact[] | undefined> {
    let source: string;
    try {
      source = await readFile(join(this.managedInstallRoot, fileName), 'utf8');
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
        return undefined;
      }
      throw new Error('SkillHub installed index is unavailable.');
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(source) as unknown;
    } catch {
      throw new Error('SkillHub installed index is unavailable.');
    }
    if (!Array.isArray(parsed)) {
      throw new Error('SkillHub installed index is unavailable.');
    }
    const facts = parsed.map((item) => toLoadingFact(item));
    if (facts.some((fact) => fact === undefined)) {
      throw new Error('SkillHub installed index is unavailable.');
    }
    return dedupeFacts(facts as SkillHubLoadingFact[]);
  }

  private async writeUnsafe(facts: readonly SkillHubLoadingFact[]): Promise<void> {
    await mkdir(this.managedInstallRoot, { recursive: true });
    const indexFile = join(this.managedInstallRoot, indexFileName);
    const tempFile = join(this.managedInstallRoot, `${indexFileName}.tmp`);
    await writeFile(tempFile, JSON.stringify(dedupeFacts(facts), null, 2), 'utf8');
    await rename(tempFile, indexFile);
  }

  private async withWriteLock<T>(operation: () => Promise<T>): Promise<T> {
    const previous = SkillHubInstalledIndex.writeQueues.get(this.managedInstallRoot) ?? Promise.resolve();
    let release: (() => void) | undefined;
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    const queued = previous.then(
      () => current,
      () => current,
    );
    SkillHubInstalledIndex.writeQueues.set(this.managedInstallRoot, queued);
    await previous.catch(() => undefined);
    try {
      return await operation();
    } finally {
      release?.();
      if (SkillHubInstalledIndex.writeQueues.get(this.managedInstallRoot) === queued) {
        SkillHubInstalledIndex.writeQueues.delete(this.managedInstallRoot);
      }
    }
  }
}

function installedFactKey(fact: SkillHubLoadingFact): string {
  return `${fact.tenantId}\0${fact.subjectId}\0${fact.agentId}\0${fact.agentVersion}\0${fact.agentAssemblyRef}\0${fact.providerId}\0${fact.skillId}`;
}

function toLoadingFact(value: unknown): SkillHubLoadingFact | undefined {
  if (!isLoadingFact(value)) {
    return undefined;
  }
  const item = value as SkillHubLoadingFact & { readonly packageVersion?: string; readonly packageHash?: string };
  return {
    tenantId: item.tenantId,
    subjectId: item.subjectId,
    agentId: item.agentId,
    agentVersion: item.agentVersion,
    agentAssemblyRef: item.agentAssemblyRef,
    providerId: item.providerId,
    skillId: item.skillId,
    ...(item.contentVersion === undefined
      ? item.packageVersion === undefined
        ? {}
        : { contentVersion: item.packageVersion }
      : { contentVersion: item.contentVersion }),
    ...(item.contentHash === undefined
      ? item.packageHash === undefined
        ? {}
        : { contentHash: item.packageHash }
      : { contentHash: item.contentHash }),
    manifestFile: item.manifestFile,
    sourceIdentity: item.sourceIdentity,
    frontmatterHash: item.frontmatterHash,
  };
}
