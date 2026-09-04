import type { ScheduledMaintenanceGatewayPort, ScheduledMaintenanceJob, ScheduledMaintenanceJobResult } from '@nextagent/agent-contracts/gateway';

export interface LocalScheduledMaintenanceOptions {
  readonly autoStart?: boolean;
}

export function createLocalScheduledMaintenanceGateway(options: LocalScheduledMaintenanceOptions = {}): ScheduledMaintenanceGatewayPort {
  return new LocalScheduledMaintenanceGateway(options);
}

class LocalScheduledMaintenanceGateway implements ScheduledMaintenanceGatewayPort {
  private readonly jobs = new Map<string, ScheduledMaintenanceJob>();
  private readonly runningJobs = new Set<string>();
  private readonly scheduledControllers = new Set<AbortController>();
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();
  private started = false;

  constructor(options: LocalScheduledMaintenanceOptions) {
    if (options.autoStart === true) {
      this.start();
    }
  }

  register(job: ScheduledMaintenanceJob): void {
    if (job.cadenceMs < 1 || !Number.isFinite(job.cadenceMs)) {
      throw new Error('Scheduled maintenance cadence must be a positive finite number.');
    }
    if (this.jobs.has(job.jobId)) {
      throw new Error('Scheduled maintenance job is already registered.');
    }
    this.jobs.set(job.jobId, job);
    if (this.started) {
      this.schedule(job);
    }
  }

  start(): void {
    if (this.started) {
      return;
    }
    this.started = true;
    for (const job of this.jobs.values()) {
      this.schedule(job);
    }
  }

  async stop(): Promise<void> {
    this.started = false;
    for (const timer of this.timers.values()) {
      clearTimeout(timer);
    }
    this.timers.clear();
    for (const controller of this.scheduledControllers) {
      controller.abort(new DOMException('Scheduled maintenance stopped.', 'AbortError'));
    }
    this.scheduledControllers.clear();
  }

  async runOnce(jobId: string, signal: AbortSignal = new AbortController().signal, now: Date = new Date()): Promise<ScheduledMaintenanceJobResult> {
    const job = this.jobs.get(jobId);
    if (job === undefined) {
      return { status: 'FAILED', safeReasonCode: 'SCHEDULED_JOB_NOT_FOUND' };
    }
    if (job.overlapPolicy === 'SKIP' && this.runningJobs.has(job.jobId)) {
      return { status: 'SKIPPED', safeReasonCode: 'SCHEDULED_JOB_OVERLAP' };
    }
    this.runningJobs.add(job.jobId);
    try {
      return await job.run(signal, now);
    } catch {
      return { status: 'FAILED', safeReasonCode: 'SCHEDULED_JOB_FAILED' };
    } finally {
      this.runningJobs.delete(job.jobId);
    }
  }

  private schedule(job: ScheduledMaintenanceJob): void {
    if (!this.started || this.timers.has(job.jobId)) {
      return;
    }
    const runAndReschedule = async () => {
      this.timers.delete(job.jobId);
      const controller = new AbortController();
      this.scheduledControllers.add(controller);
      try {
        await this.runOnce(job.jobId, controller.signal, new Date());
      } finally {
        this.scheduledControllers.delete(controller);
        if (this.started) {
          this.schedule(job);
        }
      }
    };
    const timer = setTimeout(runAndReschedule, job.cadenceMs);
    timer.unref();
    this.timers.set(job.jobId, timer);
  }
}
