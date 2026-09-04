import { brand, type EpochMillis } from '@nextagent/agent-common';
import type { ScheduledMaintenanceJob, SessionForkStoreGateway } from '@nextagent/agent-contracts/gateway';

const defaultForkPromotionRetentionMs = 24 * 60 * 60 * 1000;
const defaultForkPromotionCleanupCadenceMs = 60 * 60 * 1000;

export interface ForkPromotionCleanupJobOptions {
  readonly sessionForkStore: SessionForkStoreGateway;
  readonly retentionMs?: number;
  readonly cadenceMs?: number;
}

export function createForkPromotionCleanupJob(options: ForkPromotionCleanupJobOptions): ScheduledMaintenanceJob {
  const retentionMs = options.retentionMs ?? defaultForkPromotionRetentionMs;
  return {
    jobId: 'agent-runtime.fork-promotion-cleanup',
    cadenceMs: options.cadenceMs ?? defaultForkPromotionCleanupCadenceMs,
    retentionMs,
    overlapPolicy: 'SKIP',
    run: async (signal, now) => {
      try {
        const result = await options.sessionForkStore.cleanupExpiredForkPromotions(
          {
            now: brand<number, 'EpochMillis'>(now.getTime()) as EpochMillis,
            retentionMs,
          },
          signal,
        );
        return {
          status: 'COMPLETED',
          cleanedCount: result.cleanedCount,
          ...(result.retryableCount === 0 ? {} : { safeReasonCode: 'FORK_PROMOTION_CLEANUP_RETRYABLE_RESIDUE' }),
        };
      } catch {
        return { status: 'FAILED', safeReasonCode: 'FORK_PROMOTION_CLEANUP_FAILED' };
      }
    },
  };
}
