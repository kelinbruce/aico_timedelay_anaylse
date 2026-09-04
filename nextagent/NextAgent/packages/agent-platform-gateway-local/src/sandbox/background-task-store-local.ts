import type { BackgroundTaskRecord, BackgroundTaskStatus, BackgroundTaskStoreGatewayPort } from '@nextagent/agent-contracts/gateway';

/**
 * In-process background task store. Records are held in memory for the lifetime
 * of the Node process; no cross-process persistence or recovery is provided
 * (a Node restart leaves in-flight tasks STALE in the monitoring view).
 *
 * All mutating operations are synchronous check-and-set with no awaits between
 * the check and the update, so they are atomic under Node's single-threaded
 * event loop. `markNotified` is the atomic CAS used to guarantee at most one
 * completion notification per task.
 */
export function createLocalBackgroundTaskStore(): BackgroundTaskStoreGatewayPort {
  return new LocalBackgroundTaskStore();
}

class LocalBackgroundTaskStore implements BackgroundTaskStoreGatewayPort {
  private readonly tasks = new Map<string, BackgroundTaskRecord>();

  async create(record: BackgroundTaskRecord): Promise<BackgroundTaskRecord> {
    this.tasks.set(record.taskId, record);
    return record;
  }

  async get(taskId: string): Promise<BackgroundTaskRecord | undefined> {
    return this.tasks.get(taskId);
  }

  async list(sessionId: BackgroundTaskRecord['sessionId']): Promise<readonly BackgroundTaskRecord[]> {
    return Array.from(this.tasks.values()).filter((record) => record.sessionId === sessionId);
  }

  async markCompleted(
    taskId: string,
    result: { readonly exitCode: number; readonly finishedAt: BackgroundTaskRecord['startedAt'] },
  ): Promise<BackgroundTaskRecord | undefined> {
    const record = this.tasks.get(taskId);
    if (record === undefined) {
      return undefined;
    }
    // Sticky KILLED: a kill (SIGTERM) races ahead of the process close event.
    // The close would otherwise rewrite KILLED back to FAILED. Treat KILLED as
    // terminal and let the kill path own the terminal transition.
    if (record.status === 'KILLED') {
      return undefined;
    }
    const status: BackgroundTaskStatus = result.exitCode === 0 ? 'COMPLETED' : 'FAILED';
    const updated: BackgroundTaskRecord = { ...record, status, exitCode: result.exitCode, finishedAt: result.finishedAt };
    this.tasks.set(taskId, updated);
    return updated;
  }

  async markKilled(taskId: string, result: { readonly finishedAt: BackgroundTaskRecord['startedAt'] }): Promise<BackgroundTaskRecord | undefined> {
    const record = this.tasks.get(taskId);
    if (record === undefined) {
      return undefined;
    }
    const updated: BackgroundTaskRecord = { ...record, status: 'KILLED', finishedAt: result.finishedAt };
    this.tasks.set(taskId, updated);
    return updated;
  }

  async markNotified(taskId: string): Promise<boolean> {
    const record = this.tasks.get(taskId);
    if (record === undefined || record.notified) {
      return false;
    }
    this.tasks.set(taskId, { ...record, notified: true });
    return true;
  }

  async updateStatus(taskId: string, status: BackgroundTaskStatus): Promise<BackgroundTaskRecord | undefined> {
    const record = this.tasks.get(taskId);
    if (record === undefined) {
      return undefined;
    }
    const updated: BackgroundTaskRecord = { ...record, status };
    this.tasks.set(taskId, updated);
    return updated;
  }

  async remove(taskId: string): Promise<boolean> {
    return this.tasks.delete(taskId);
  }
}
