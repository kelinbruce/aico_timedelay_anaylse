import { createLocalScheduledMaintenanceGateway } from '@nextagent/agent-platform-gateway-local';
import { describe, expect, it } from 'vitest';

describe('local scheduled maintenance gateway', () => {
  it('runs registered capability jobs and skips overlapping executions', async () => {
    const gateway = createLocalScheduledMaintenanceGateway();
    let releaseJob!: () => void;
    const jobStarted = new Promise<void>((resolveStarted) => {
      gateway.register({
        jobId: 'capability-cleanup',
        cadenceMs: 1000,
        retentionMs: 10,
        overlapPolicy: 'SKIP',
        async run() {
          resolveStarted();
          await new Promise<void>((resolveJob) => {
            releaseJob = resolveJob;
          });
          return { status: 'COMPLETED', cleanedCount: 1 };
        },
      });
    });

    const firstRun = gateway.runOnce('capability-cleanup');
    await jobStarted;
    await expect(gateway.runOnce('capability-cleanup')).resolves.toEqual({
      status: 'SKIPPED',
      safeReasonCode: 'SCHEDULED_JOB_OVERLAP',
    });
    releaseJob();
    await expect(firstRun).resolves.toEqual({ status: 'COMPLETED', cleanedCount: 1 });
  });
});
