import { describe, it, expect, vi } from 'vitest';
import {
  UploadQuotaTracker,
  UploadConcurrencyLimiter,
  SYSTEM_MAX_FILE_COUNT_PER_USER,
  SYSTEM_MAX_FILE_SIZE_PER_USER,
  SYSTEM_TMP_QUOTA_PER_USER,
  FREQUENCY_MAX_UPLOADS,
  GLOBAL_UPLOAD_TMP_LIMIT,
  MAX_UPLOAD_CONCURRENCY,
} from '../src/upload-quota.js';

describe('UploadQuotaTracker', () => {
  it('allows upload within all limits', () => {
    const tracker = new UploadQuotaTracker();
    expect(tracker.checkUserFileCount('user1').allowed).toBe(true);
    expect(tracker.checkUserFileSize('user1', 1024).allowed).toBe(true);
    expect(tracker.checkUserTmpQuota('user1', 1024).allowed).toBe(true);
    expect(tracker.checkFrequency('user1').allowed).toBe(true);
  });

  it('rejects when user file count exceeds limit', () => {
    const tracker = new UploadQuotaTracker();
    tracker.recordFormalUpload('user1', 'session1', SYSTEM_MAX_FILE_COUNT_PER_USER, 1000, 200);
    const result = tracker.checkUserFileCount('user1');
    expect(result.allowed).toBe(false);
    expect(result.reasonCode).toBe('QUOTA_USER_FILE_COUNT_EXCEEDED');
  });

  it('rejects when user file size exceeds limit', () => {
    const tracker = new UploadQuotaTracker();
    tracker.recordFormalUpload('user1', 'session1', 1, SYSTEM_MAX_FILE_SIZE_PER_USER, 200);
    const result = tracker.checkUserFileSize('user1', 1);
    expect(result.allowed).toBe(false);
    expect(result.reasonCode).toBe('QUOTA_USER_FILE_SIZE_EXCEEDED');
  });

  it('rejects when user tmp quota exceeds limit', () => {
    const tracker = new UploadQuotaTracker();
    tracker.recordTempUpload('user1', SYSTEM_TMP_QUOTA_PER_USER);
    const result = tracker.checkUserTmpQuota('user1', 1);
    expect(result.allowed).toBe(false);
    expect(result.reasonCode).toBe('QUOTA_USER_TMP_SIZE_EXCEEDED');
  });

  it('rejects when frequency limit reached', () => {
    const tracker = new UploadQuotaTracker();
    for (let i = 0; i < FREQUENCY_MAX_UPLOADS; i++) {
      tracker.recordTempUpload('user1', 100);
    }
    const result = tracker.checkFrequency('user1');
    expect(result.allowed).toBe(false);
    expect(result.reasonCode).toBe('QUOTA_FREQUENCY_EXCEEDED');
  });

  it('deducts frequency count on formal upload', () => {
    const tracker = new UploadQuotaTracker();
    for (let i = 0; i < 10; i++) {
      tracker.recordTempUpload('user1', 100);
    }
    tracker.recordFormalUpload('user1', 'session1', 3, 300, 200);
    // Should have 7 remaining in frequency window
    expect(tracker.checkFrequency('user1').allowed).toBe(true);
  });

  it('deducts frequency count on temp delete', () => {
    const tracker = new UploadQuotaTracker();
    for (let i = 0; i < 10; i++) {
      tracker.recordTempUpload('user1', 100);
    }
    tracker.recordTempDelete('user1', 100);
    // Should have 9 remaining
    const result = tracker.checkFrequency('user1');
    expect(result.allowed).toBe(true);
  });

  it('checks session file count against config limit', () => {
    const tracker = new UploadQuotaTracker();
    // config says 10
    for (let i = 0; i < 10; i++) {
      tracker.recordFormalUpload('user1', 'session1', 1, 100, 10);
    }
    const result = tracker.checkSessionFileCount('session1', 10);
    expect(result.allowed).toBe(false);
    expect(result.reasonCode).toBe('QUOTA_SESSION_FILE_COUNT_EXCEEDED');
  });

  it('caps session file count at system limit', () => {
    const tracker = new UploadQuotaTracker();
    const result = tracker.checkSessionFileCount('session1', 500);
    // config says 500, system caps at 200
    expect(result.allowed).toBe(true);
    // Fill up to 200
    for (let i = 0; i < 200; i++) {
      tracker.recordFormalUpload('user1', 'session1', 1, 100, 500);
    }
    const result2 = tracker.checkSessionFileCount('session1', 500);
    expect(result2.allowed).toBe(false);
  });

  it('rejects when global tmp limit exceeded', () => {
    const tracker = new UploadQuotaTracker();
    tracker.recordTempUpload('user1', GLOBAL_UPLOAD_TMP_LIMIT);
    const result = tracker.checkGlobalTmp(1);
    expect(result.allowed).toBe(false);
    expect(result.reasonCode).toBe('QUOTA_GLOBAL_TMP_EXCEEDED');
  });

  it('isolates quotas between users', () => {
    const tracker = new UploadQuotaTracker();
    tracker.recordTempUpload('user1', SYSTEM_TMP_QUOTA_PER_USER);
    expect(tracker.checkUserTmpQuota('user1', 1).allowed).toBe(false);
    expect(tracker.checkUserTmpQuota('user2', 1).allowed).toBe(true);
  });
});

describe('UploadConcurrencyLimiter', () => {
  it('allows up to 4 concurrent uploads', async () => {
    const limiter = new UploadConcurrencyLimiter();
    await limiter.acquire();
    await limiter.acquire();
    await limiter.acquire();
    await limiter.acquire();
    expect(limiter.activeCount).toBe(MAX_UPLOAD_CONCURRENCY);
  });

  it('waits when 4 slots are full', async () => {
    const limiter = new UploadConcurrencyLimiter();
    for (let i = 0; i < MAX_UPLOAD_CONCURRENCY; i++) {
      await limiter.acquire();
    }
    let acquired = false;
    const promise = limiter.acquire().then(() => {
      acquired = true;
    });
    // Give it a tick
    await new Promise((r) => setTimeout(r, 50));
    expect(acquired).toBe(false);
    // Release one slot
    limiter.release();
    await promise;
    expect(acquired).toBe(true);
  });

  it('releases correctly', async () => {
    const limiter = new UploadConcurrencyLimiter();
    await limiter.acquire();
    expect(limiter.activeCount).toBe(1);
    limiter.release();
    expect(limiter.activeCount).toBe(0);
  });
});
