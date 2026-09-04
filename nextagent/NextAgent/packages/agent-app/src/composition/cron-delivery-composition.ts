import { AgentError, brand, type IdentityContext, type RequestLocale, type RequestRunId } from '@nextagent/agent-common';
import type { CronTaskGatewayPort, CronTaskRecord, CronTriggerRecord, RequestRunStoreGateway } from '@nextagent/agent-contracts/gateway';
import type { RoutingConstraints, RuntimeCommandPort, RuntimeSessionPort } from '@nextagent/agent-contracts/runtime';
import { emitCronObservation, type ObservabilityProjectorHost } from '@nextagent/agent-observability';

export interface CronTriggerDeliveryPort {
  deliver: (input: {
    readonly task: CronTaskRecord;
    readonly trigger: CronTriggerRecord;
    readonly signal: AbortSignal;
  }) => Promise<CronTriggerDeliveryResult>;
}

export interface CronTriggerDeliveryResult {
  readonly requestRunId: RequestRunId;
}

export function createRuntimeCronTriggerDelivery(input: {
  readonly runtime: Pick<RuntimeSessionPort, 'createSession'> & Pick<RuntimeCommandPort, 'submit'>;
  readonly cronTasks: CronTaskGatewayPort;
  readonly requestRuns: Pick<RequestRunStoreGateway, 'loadRun'>;
  readonly projectorHost: ObservabilityProjectorHost;
  readonly locale: RequestLocale;
  readonly now?: () => number;
}): CronTriggerDeliveryPort {
  const now = input.now ?? Date.now;
  return {
    async deliver({ task, trigger }) {
      const session = await input.runtime.createSession({
        identityContext: identityFromTask(task),
        idempotencyKey: brand<string, 'IdempotencyKey'>(`cron-execution:${task.taskId}`),
      });
      if (session.agentId !== task.agentId) {
        throw new AgentError({
          code: 'CRON_TRIGGER_AGENT_SCOPE_MISMATCH',
          message: 'Cron trigger execution session agent scope is invalid.',
          category: 'VALIDATION',
          retryable: false,
        });
      }
      const accepted = await input.runtime.submit({
        sessionId: session.sessionId,
        agentId: task.agentId,
        identityContext: identityFromTask(task),
        inputText: task.prompt,
        attachmentIds: [],
        locale: input.locale,
        priority: 'LOW',
        ...cronTaskRoutingConstraints(task),
        idempotencyKey: brand<string, 'IdempotencyKey'>(`cron-trigger:${trigger.triggerId}`),
      });
      const binding = await input.cronTasks.bindCronTriggerRun({
        tenantId: task.tenantId,
        subjectId: task.subjectId,
        agentId: task.agentId,
        sessionId: session.sessionId,
        taskId: task.taskId,
        triggerId: trigger.triggerId,
        requestRunId: accepted.runId,
        acceptedAt: brand<number, 'EpochMillis'>(now()),
      });
      if (binding.status === 'TRIGGER_NOT_FOUND') {
        throw new AgentError({ code: 'CRON_TRIGGER_NOT_FOUND', message: 'Cron trigger was not found.', category: 'NOT_FOUND', retryable: false });
      }
      if (binding.status === 'RUN_CONFLICT') {
        throw new AgentError({
          code: 'CRON_TRIGGER_RUN_CONFLICT',
          message: 'Cron trigger run binding conflicted.',
          category: 'CONFLICT',
          retryable: false,
        });
      }
      await observeAcceptedTrigger(input, task, trigger, accepted.runId);
      return { requestRunId: accepted.runId };
    },
  };
}

async function observeAcceptedTrigger(
  input: Parameters<typeof createRuntimeCronTriggerDelivery>[0],
  task: CronTaskRecord,
  trigger: CronTriggerRecord,
  requestRunId: RequestRunId,
): Promise<void> {
  try {
    const acceptedRun = await input.requestRuns.loadRun({
      tenantId: task.tenantId,
      subjectId: task.subjectId,
      agentId: task.agentId,
      runId: requestRunId,
    });
    if (acceptedRun === undefined) {
      return;
    }
    emitCronObservation({
      projectorHost: input.projectorHost,
      ownerScope: {
        tenantId: acceptedRun.tenantId,
        subjectId: acceptedRun.subjectId,
        agentId: acceptedRun.agentId,
        agentVersion: acceptedRun.agentVersion,
      },
      operation: 'CRON_TRIGGER_ACCEPTED',
      taskId: task.taskId,
      triggerId: trigger.triggerId,
      sessionId: acceptedRun.sessionId,
      requestRunId: acceptedRun.runId,
    });
  } catch {
    // Observation lookup and projection are advisory after durable run binding.
  }
}

function identityFromTask(task: CronTaskRecord): IdentityContext {
  return {
    tenantId: task.tenantId,
    subjectId: task.subjectId,
    displayName: 'Cron trigger',
  };
}

function cronTaskRoutingConstraints(task: CronTaskRecord): { readonly routingConstraints?: RoutingConstraints } {
  if (task.targetKind === 'SKILL' && task.targetName !== undefined) {
    return { routingConstraints: { targetSkill: task.targetName } };
  }
  if (task.targetKind === 'WORKFLOW' && task.targetName !== undefined) {
    return { routingConstraints: { targetRecipe: task.targetName } };
  }
  return {};
}
