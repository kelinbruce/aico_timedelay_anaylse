// =============================================================================
// User-level upload quota counter (D7, D22)
// =============================================================================

export const SYSTEM_MAX_FILE_COUNT_PER_USER = 200;
export const SYSTEM_MAX_FILE_SIZE_PER_USER = 500 * 1024 * 1024; // 500 MB
export const SYSTEM_TMP_QUOTA_PER_USER = 1024 * 1024 * 1024; // 1024 MB
export const FREQUENCY_WINDOW_MS = 60 * 60 * 1000; // 1 hour
export const FREQUENCY_MAX_UPLOADS = 500;
export const USER_LRU_MAX = 10000;

// Per-session limits (D22)
export const SYSTEM_MAX_FILE_COUNT_PER_SESSION = 200;

// Global upload-tmp limit (D33)
export const GLOBAL_UPLOAD_TMP_LIMIT = 2048 * 1024 * 1024; // 2048 MB

export interface UserUploadQuota {
  totalFileCount: number;
  totalFileSize: number;
  tmpTotalSize: number;
  uploadTimestamps: number[];
}

export interface SessionUploadQuota {
  fileCount: number;
  totalSize: number;
}

export type QuotaRejectionCode =
  | 'QUOTA_USER_FILE_COUNT_EXCEEDED'
  | 'QUOTA_USER_FILE_SIZE_EXCEEDED'
  | 'QUOTA_USER_TMP_SIZE_EXCEEDED'
  | 'QUOTA_SESSION_FILE_COUNT_EXCEEDED'
  | 'QUOTA_FREQUENCY_EXCEEDED'
  | 'QUOTA_GLOBAL_TMP_EXCEEDED';

export interface QuotaCheckResult {
  readonly allowed: boolean;
  readonly reasonCode?: QuotaRejectionCode;
}

/**
 * LRU map with a max size. Evicts least recently accessed entries.
 */
class LruMap<K, V> {
  private readonly map = new Map<K, V>();
  constructor(private readonly max: number) {}

  get(key: K): V | undefined {
    const value = this.map.get(key);
    if (value !== undefined) {
      this.map.delete(key);
      this.map.set(key, value);
    }
    return value;
  }

  set(key: K, value: V): void {
    if (this.map.has(key)) {
      this.map.delete(key);
    } else if (this.map.size >= this.max) {
      const firstKey = this.map.keys().next().value;
      if (firstKey !== undefined) {
        this.map.delete(firstKey);
      }
    }
    this.map.set(key, value);
  }

  has(key: K): boolean {
    return this.map.has(key);
  }

  delete(key: K): boolean {
    return this.map.delete(key);
  }

  get size(): number {
    return this.map.size;
  }
}

export class UploadQuotaTracker {
  private readonly userQuotas = new LruMap<string, UserUploadQuota>(USER_LRU_MAX);
  private readonly sessionQuotas = new LruMap<string, SessionUploadQuota>(10000);
  private globalTmpSize = 0;
  private readonly clock: () => number;

  constructor(clock?: () => number) {
    this.clock = clock ?? (() => Date.now());
  }

  // ===== Per-user checks =====

  checkUserFileCount(userId: string, additionalCount: number = 1): QuotaCheckResult {
    const quota = this.getOrCreateUserQuota(userId);
    if (quota.totalFileCount + additionalCount > SYSTEM_MAX_FILE_COUNT_PER_USER) {
      return { allowed: false, reasonCode: 'QUOTA_USER_FILE_COUNT_EXCEEDED' };
    }
    return { allowed: true };
  }

  checkUserFileSize(userId: string, additionalBytes: number): QuotaCheckResult {
    const quota = this.getOrCreateUserQuota(userId);
    if (quota.totalFileSize + additionalBytes > SYSTEM_MAX_FILE_SIZE_PER_USER) {
      return { allowed: false, reasonCode: 'QUOTA_USER_FILE_SIZE_EXCEEDED' };
    }
    return { allowed: true };
  }

  checkUserTmpQuota(userId: string, additionalBytes: number): QuotaCheckResult {
    const quota = this.getOrCreateUserQuota(userId);
    if (quota.tmpTotalSize + additionalBytes > SYSTEM_TMP_QUOTA_PER_USER) {
      return { allowed: false, reasonCode: 'QUOTA_USER_TMP_SIZE_EXCEEDED' };
    }
    return { allowed: true };
  }

  checkFrequency(userId: string): QuotaCheckResult {
    const quota = this.getOrCreateUserQuota(userId);
    const now = this.clock();
    const cutoff = now - FREQUENCY_WINDOW_MS;
    const recentTimestamps = quota.uploadTimestamps.filter((ts) => ts > cutoff);
    quota.uploadTimestamps = recentTimestamps;
    if (recentTimestamps.length >= FREQUENCY_MAX_UPLOADS) {
      return { allowed: false, reasonCode: 'QUOTA_FREQUENCY_EXCEEDED' };
    }
    return { allowed: true };
  }

  // ===== Per-session checks =====

  checkSessionFileCount(sessionId: string, configMax: number, additionalCount: number = 1): QuotaCheckResult {
    const effectiveMax = Math.min(configMax, SYSTEM_MAX_FILE_COUNT_PER_SESSION);
    const quota = this.getOrCreateSessionQuota(sessionId);
    if (quota.fileCount + additionalCount > effectiveMax) {
      return { allowed: false, reasonCode: 'QUOTA_SESSION_FILE_COUNT_EXCEEDED' };
    }
    return { allowed: true };
  }

  // ===== Global tmp check =====

  checkGlobalTmp(additionalBytes: number): QuotaCheckResult {
    if (this.globalTmpSize + additionalBytes > GLOBAL_UPLOAD_TMP_LIMIT) {
      return { allowed: false, reasonCode: 'QUOTA_GLOBAL_TMP_EXCEEDED' };
    }
    return { allowed: true };
  }

  // ===== Mutations (phase 1 upload) =====

  recordTempUpload(userId: string, sizeBytes: number): void {
    const quota = this.getOrCreateUserQuota(userId);
    quota.uploadTimestamps.push(this.clock());
    quota.tmpTotalSize += sizeBytes;
    this.globalTmpSize += sizeBytes;
  }

  // ===== Mutations (phase 2 submit) =====

  recordFormalUpload(userId: string, sessionId: string, fileCount: number, totalSize: number, configMaxFileNumber: number): void {
    const userQuota = this.getOrCreateUserQuota(userId);
    userQuota.totalFileCount += fileCount;
    userQuota.totalFileSize += totalSize;
    userQuota.tmpTotalSize -= totalSize;
    this.globalTmpSize -= totalSize;

    // Deduct frequency count: remove N oldest timestamps
    userQuota.uploadTimestamps.splice(0, fileCount);

    // Update session quota
    const sessionQuota = this.getOrCreateSessionQuota(sessionId);
    sessionQuota.fileCount += fileCount;
    sessionQuota.totalSize += totalSize;
  }

  // ===== Mutations (temp file delete) =====

  recordTempDelete(userId: string, sizeBytes: number): void {
    const quota = this.getOrCreateUserQuota(userId);
    quota.tmpTotalSize = Math.max(0, quota.tmpTotalSize - sizeBytes);
    this.globalTmpSize = Math.max(0, this.globalTmpSize - sizeBytes);
    // Remove 1 oldest timestamp
    if (quota.uploadTimestamps.length > 0) {
      quota.uploadTimestamps.shift();
    }
  }

  // ===== Helpers =====

  private getOrCreateUserQuota(userId: string): UserUploadQuota {
    let quota = this.userQuotas.get(userId);
    if (quota === undefined) {
      quota = {
        totalFileCount: 0,
        totalFileSize: 0,
        tmpTotalSize: 0,
        uploadTimestamps: [],
      };
      this.userQuotas.set(userId, quota);
    }
    return quota;
  }

  private getOrCreateSessionQuota(sessionId: string): SessionUploadQuota {
    let quota = this.sessionQuotas.get(sessionId);
    if (quota === undefined) {
      quota = { fileCount: 0, totalSize: 0 };
      this.sessionQuotas.set(sessionId, quota);
    }
    return quota;
  }
}

// =============================================================================
// Global upload concurrency limiter (D26)
// =============================================================================

export const MAX_UPLOAD_CONCURRENCY = 4;
export const CONCURRENCY_TIMEOUT_MS = 30_000;

export class UploadConcurrencyLimiter {
  private active = 0;
  private readonly waiters: Array<{ resolve: () => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }> = [];

  async acquire(signal?: AbortSignal): Promise<void> {
    if (this.active < MAX_UPLOAD_CONCURRENCY) {
      this.active++;
      return undefined;
    }

    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        const index = this.waiters.findIndex((w) => w.resolve === resolve);
        if (index >= 0) {
          this.waiters.splice(index, 1);
        }
        reject(new Error('UPLOAD_CONCURRENCY_TIMEOUT'));
      }, CONCURRENCY_TIMEOUT_MS);

      const waiter = { resolve, reject, timer };
      this.waiters.push(waiter);

      if (signal !== undefined) {
        signal.addEventListener(
          'abort',
          () => {
            clearTimeout(timer);
            const index = this.waiters.indexOf(waiter);
            if (index >= 0) {
              this.waiters.splice(index, 1);
            }
            reject(new Error('UPLOAD_ABORTED'));
          },
          { once: true },
        );
      }
    });
  }

  release(): void {
    this.active = Math.max(0, this.active - 1);
    const next = this.waiters.shift();
    if (next !== undefined) {
      clearTimeout(next.timer);
      this.active++;
      next.resolve();
    }
  }

  get activeCount(): number {
    return this.active;
  }

  get waitingCount(): number {
    return this.waiters.length;
  }
}
