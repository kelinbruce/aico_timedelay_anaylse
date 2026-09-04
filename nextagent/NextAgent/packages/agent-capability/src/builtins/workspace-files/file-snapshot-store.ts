import type { ToolExecutionContext } from '../../tools/tool-spi.js';

interface SnapshotKey {
  readonly agentId: string;
  readonly agentVersion: string;
  readonly runId: string;
  readonly relativePath: string;
}

interface FileSnapshot {
  readonly fingerprint: string;
}

export interface SnapshotContext extends Pick<ToolExecutionContext, 'agentId' | 'agentVersion' | 'runId'> {}

export interface ClearRunContext extends Pick<ToolExecutionContext, 'agentId' | 'runId'> {}

export class FileSnapshotStore {
  private readonly snapshots = new Map<string, { readonly key: SnapshotKey; readonly snapshot: FileSnapshot }>();

  set(context: SnapshotContext, relativePath: string, fingerprint: string): void {
    const key = makeKey(context, relativePath);
    this.snapshots.set(serializeKey(key), { key, snapshot: { fingerprint } });
  }

  get(context: SnapshotContext, relativePath: string): FileSnapshot | undefined {
    return this.snapshots.get(serializeKey(makeKey(context, relativePath)))?.snapshot;
  }

  delete(context: SnapshotContext, relativePath: string): void {
    this.snapshots.delete(serializeKey(makeKey(context, relativePath)));
  }

  clearRun(context: ClearRunContext): void {
    for (const [serialized, entry] of this.snapshots) {
      if (entry.key.agentId === context.agentId && entry.key.runId === context.runId) {
        this.snapshots.delete(serialized);
      }
    }
  }
}

function makeKey(context: SnapshotContext, relativePath: string): SnapshotKey {
  return {
    agentId: context.agentId,
    agentVersion: context.agentVersion,
    runId: context.runId,
    relativePath,
  };
}

function serializeKey(key: SnapshotKey): string {
  return `${key.agentId}\u0000${key.agentVersion}\u0000${key.runId}\u0000${key.relativePath}`;
}
