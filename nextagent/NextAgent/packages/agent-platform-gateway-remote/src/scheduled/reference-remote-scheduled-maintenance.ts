import type { ScheduledMaintenanceGatewayPort, ScheduledMaintenanceJob, ScheduledMaintenanceJobResult } from '@nextagent/agent-contracts/gateway';

export interface ReferenceRemoteScheduledMaintenanceClient {
  register: (job: ScheduledMaintenanceJob) => void;
  start: () => void;
  stop: () => Promise<void>;
  runOnce: (jobId: string, signal?: AbortSignal, now?: Date) => Promise<ScheduledMaintenanceJobResult>;
}

export function createReferenceRemoteScheduledMaintenanceGateway(client: ReferenceRemoteScheduledMaintenanceClient): ScheduledMaintenanceGatewayPort {
  return {
    register(job) {
      client.register(job);
    },
    start() {
      client.start();
    },
    stop() {
      return client.stop();
    },
    runOnce(jobId, signal, now) {
      return client.runOnce(jobId, signal, now);
    },
  };
}
