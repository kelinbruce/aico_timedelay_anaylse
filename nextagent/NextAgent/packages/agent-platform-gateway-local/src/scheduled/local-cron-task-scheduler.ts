import { brand, type EpochMillis } from '@nextagent/agent-common';
import type { ClaimedCronTriggerDeliveryRecord, CronTaskGatewayPort, CronTaskRecord, CronTriggerRecord } from '@nextagent/agent-contracts/gateway';
import { randomUUID } from 'node:crypto';

export interface LocalCronTriggerDelivery {
  deliver: (input: { readonly task: CronTaskRecord; readonly trigger: CronTriggerRecord; readonly signal: AbortSignal }) => Promise<unknown>;
}

export interface LocalCronTaskSchedulerOptions {
  readonly cronTasks: CronTaskGatewayPort;
  readonly delivery: LocalCronTriggerDelivery;
  readonly computeNextRunAt: (cron: string, fromMs: number) => number | null;
  readonly now?: () => number;
  readonly triggerIdFactory?: (input: { readonly task: CronTaskRecord; readonly scheduledAt: EpochMillis }) => string;
  readonly cadenceMs?: number;
  readonly batchSize?: number;
}

export function createLocalCronTaskScheduler(options: LocalCronTaskSchedulerOptions): LocalCronTaskScheduler {
  return new LocalCronTaskScheduler(options);
}

export class LocalCronTaskScheduler {
  private readonly cronTasks: CronTaskGatewayPort;
  private readonly delivery: LocalCronTriggerDelivery;
  private readonly computeNextRunAt: LocalCronTaskSchedulerOptions['computeNextRunAt'];
  private readonly now: () => number;
  private readonly triggerIdFactory: NonNullable<LocalCronTaskSchedulerOptions['triggerIdFactory']>;
  private readonly cadenceMs: number;
  private readonly batchSize: number;
  private controllers = new Set<AbortController>();
  private timer?: ReturnType<typeof setTimeout> | undefined;
  private started = false;
  private running = false;

  constructor(options: LocalCronTaskSchedulerOptions) {
    this.cronTasks = options.cronTasks;
    this.delivery = options.delivery;
    this.computeNextRunAt = options.computeNextRunAt;
    this.now = options.now ?? Date.now;
    this.triggerIdFactory = options.triggerIdFactory ?? (() => randomUUID());
    this.cadenceMs = options.cadenceMs ?? 1000;
    this.batchSize = options.batchSize ?? 100;
    if (!Number.isFinite(this.cadenceMs) || this.cadenceMs < 1) {
      throw new Error('Cron scheduler cadence must be a positive finite number.');
    }
    if (!Number.isInteger(this.batchSize) || this.batchSize < 1) {
      throw new Error('Cron scheduler batch size must be a positive integer.');
    }
  }

  start(): void {
    if (this.started) {
      return;
    }
    this.started = true;
    this.schedule(0);
  }

  async stop(): Promise<void> {
    this.started = false;
    if (this.timer !== undefined) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
    for (const controller of this.controllers) {
      controller.abort(new DOMException('Cron scheduler stopped.', 'AbortError'));
    }
    this.controllers.clear();
  }

  async runOnce(signal: AbortSignal = new AbortController().signal): Promise<{ readonly deliveredCount: number }> {
    if (this.running) {
      return { deliveredCount: 0 };
    }
    this.running = true;
    const controller = new AbortController();
    const abort = () => controller.abort(signal.reason);
    signal.addEventListener('abort', abort, { once: true });
    this.controllers.add(controller);
    try {
      let deliveredCount = 0;
      while (!controller.signal.aborted) {
        const deliveredClaimed = await this.deliverClaimed(controller.signal);
        const deliveredDue = await this.claimAndDeliverDue(controller.signal);
        deliveredCount += deliveredClaimed + deliveredDue;
        if (deliveredClaimed + deliveredDue < this.batchSize) {
          break;
        }
      }
      return { deliveredCount };
    } finally {
      signal.removeEventListener('abort', abort);
      this.controllers.delete(controller);
      this.running = false;
    }
  }

  private async deliverClaimed(signal: AbortSignal): Promise<number> {
    const claimed = await this.cronTasks.listClaimedTriggers({ limit: this.batchSize }, signal);
    await this.deliverAll(claimed, signal);
    return claimed.length;
  }

  private async claimAndDeliverDue(signal: AbortSignal): Promise<number> {
    const dueTasks = await this.cronTasks.listDueTasks({ dueAtOrBefore: brand<number, 'EpochMillis'>(this.now()), limit: this.batchSize }, signal);
    const claimed: ClaimedCronTriggerDeliveryRecord[] = [];
    for (const task of dueTasks) {
      const scheduledAt = task.nextRunAt;
      const nextRunAt = task.recurring ? this.computeNextRunAt(task.cron, scheduledAt) : null;
      const result = await this.cronTasks.claimCronTrigger(
        {
          tenantId: task.tenantId,
          subjectId: task.subjectId,
          agentId: task.agentId,
          taskId: task.taskId,
          scheduledAt,
          triggerId: this.triggerIdFactory({ task, scheduledAt }),
          ...(nextRunAt === null ? {} : { nextRunAt: brand<number, 'EpochMillis'>(nextRunAt) }),
          claimedAt: brand<number, 'EpochMillis'>(this.now()),
        },
        signal,
      );
      if ((result.status === 'CLAIMED' || result.status === 'ALREADY_CLAIMED') && result.trigger !== undefined && result.task !== undefined) {
        claimed.push({ task: result.task, trigger: result.trigger });
      }
    }
    await this.deliverAll(claimed, signal);
    return claimed.length;
  }

  private async deliverAll(records: readonly ClaimedCronTriggerDeliveryRecord[], signal: AbortSignal): Promise<void> {
    for (const record of records) {
      if (signal.aborted) {
        return;
      }
      await this.delivery.deliver({ task: record.task, trigger: record.trigger, signal });
    }
  }

  private schedule(delayMs: number): void {
    if (!this.started || this.timer !== undefined) {
      return;
    }
    this.timer = setTimeout(() => {
      this.timer = undefined;
      void this.runOnce().finally(() => {
        if (this.started) {
          this.schedule(this.cadenceMs);
        }
      });
    }, delayMs);
    this.timer.unref?.();
  }
}
