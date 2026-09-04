import { AgentError } from '@nextagent/agent-common';
import { createGatewayCronTaskPort } from '@nextagent/agent-capability';
import type { CronTaskGatewayPort, RequestRunStoreGateway } from '@nextagent/agent-contracts/gateway';
import type { RuntimeCommandPort, RuntimeSessionPort } from '@nextagent/agent-contracts/runtime';
import type { ObservabilityProjectorHost } from '@nextagent/agent-observability';
import type { FastifyInstance } from 'fastify';
import type { AppCredentialResolver } from '../config/env.js';
import type { CronDeploymentSelection } from '../config/gateway-selection.js';
import type {
  CronTaskSchedulerFactory,
  CronTriggerCallbackRegistrationFactory,
  CronTriggerCallbackRegistration,
} from '../composition/composition-contracts.js';
import { createRuntimeCronTriggerDelivery } from '../composition/cron-delivery-composition.js';
import type { CronTriggerDeliveryPort } from '../composition/cron-delivery-composition.js';
import { createCronTriggerCallbackHandler } from '../composition/cron-trigger-callback-handler.js';
import { emitCronObservation } from '@nextagent/agent-observability';
import { createCronTriggerCallbackVerifier } from './cron-trigger-callback-verifier.js';

export type CronCapabilityComposition =
  | { readonly enabled: false }
  | {
      readonly enabled: true;
      readonly deployment: Exclude<CronDeploymentSelection, 'DISABLED'>;
      readonly cronTasks: CronTaskGatewayPort;
      readonly capabilityPort: ReturnType<typeof createGatewayCronTaskPort>;
    };

export interface CronRuntimeLayer {
  readonly cronTaskScheduler?: { start: () => void; stop: () => Promise<void> };
  readonly cronTriggerCallbackRegistration?: CronTriggerCallbackRegistration;
}

export function composeCronCapabilityLayer(input: {
  readonly deploymentSelection: CronDeploymentSelection;
  readonly cronTasks?: CronTaskGatewayPort;
  readonly cronTaskIdFactory?: () => string;
  readonly clock?: () => number;
  readonly projectorHost: ObservabilityProjectorHost;
}): CronCapabilityComposition {
  if (input.deploymentSelection === 'DISABLED') {
    return { enabled: false };
  }
  if (input.cronTasks === undefined) {
    throw new AgentError({
      code: 'CRON_TASK_GATEWAY_UNAVAILABLE',
      message: 'Cron task gateway is required when Cron tools are registered.',
      category: 'VALIDATION',
      retryable: false,
    });
  }
  return {
    enabled: true,
    deployment: input.deploymentSelection,
    cronTasks: input.cronTasks,
    capabilityPort: createGatewayCronTaskPort({
      gateway: input.cronTasks,
      ...(input.cronTaskIdFactory === undefined ? {} : { idFactory: input.cronTaskIdFactory }),
      ...(input.clock === undefined ? {} : { now: input.clock }),
      onTaskMutation: ({ operation, taskId, scope }) =>
        emitCronObservation({
          projectorHost: input.projectorHost,
          ownerScope: {
            tenantId: scope.tenantId,
            subjectId: scope.subjectId,
            agentId: scope.agentId,
            agentVersion: scope.agentVersion,
          },
          operation,
          taskId,
          sessionId: scope.sessionId,
          requestRunId: scope.requestRunId,
        }),
    }),
  };
}

export function composeCronRuntimeLayer(input: {
  readonly capability: CronCapabilityComposition;
  readonly cronTaskSchedulerFactory?: CronTaskSchedulerFactory;
  readonly cronTriggerCallbackCredentialRef?: Parameters<typeof createCronTriggerCallbackVerifier>[0]['credentialRef'];
  readonly cronTriggerCallbackRegistration?: CronTriggerCallbackRegistrationFactory;
  readonly runtime: Pick<RuntimeSessionPort, 'createSession'> & Pick<RuntimeCommandPort, 'submit'>;
  readonly requestRuns: Pick<RequestRunStoreGateway, 'loadRun'>;
  readonly projectorHost: ObservabilityProjectorHost;
  readonly credentialResolver: AppCredentialResolver;
  readonly server: FastifyInstance;
  readonly locale: import('@nextagent/agent-common').RequestLocale;
  readonly computeNextRunAt: (cron: string, fromMs: number) => number | null;
  readonly delivery?: CronTriggerDeliveryPort;
}): CronRuntimeLayer {
  if (!input.capability.enabled) {
    return {};
  }
  const delivery =
    input.delivery ??
    createRuntimeCronTriggerDelivery({
      runtime: input.runtime,
      cronTasks: input.capability.cronTasks,
      requestRuns: input.requestRuns,
      projectorHost: input.projectorHost,
      locale: input.locale,
    });
  if (input.capability.deployment === 'LOCAL') {
    return {
      cronTaskScheduler: requireCronTaskSchedulerFactory(input.cronTaskSchedulerFactory)({
        cronTasks: input.capability.cronTasks,
        delivery,
        computeNextRunAt: input.computeNextRunAt,
      }),
    };
  }
  const handler = createCronTriggerCallbackHandler({
    verifier: createCronTriggerCallbackVerifier({
      credentialRef: requireCronTriggerCallbackCredentialRef(input.cronTriggerCallbackCredentialRef),
      credentialResolver: input.credentialResolver,
    }),
    cronTasks: input.capability.cronTasks,
    delivery,
  });
  const registration = requireCronTriggerCallbackRegistration(input.cronTriggerCallbackRegistration)({ server: input.server, handler });
  return registration === undefined ? {} : { cronTriggerCallbackRegistration: registration };
}

function requireCronTaskSchedulerFactory(factory?: CronTaskSchedulerFactory) {
  if (factory === undefined) {
    throw new AgentError({
      code: 'CRON_TASK_SCHEDULER_FACTORY_REQUIRED',
      message: 'Local Cron task scheduler factory must be provided when the local Cron adapter is selected.',
      category: 'VALIDATION',
      retryable: false,
    });
  }
  return factory;
}

function requireCronTriggerCallbackCredentialRef(credentialRef?: Parameters<typeof createCronTriggerCallbackVerifier>[0]['credentialRef']) {
  if (credentialRef === undefined) {
    throw new AgentError({
      code: 'CRON_CALLBACK_CREDENTIAL_REQUIRED',
      message: 'Remote Cron callback credential reference must be configured.',
      category: 'VALIDATION',
      retryable: false,
    });
  }
  return credentialRef;
}

function requireCronTriggerCallbackRegistration(registration?: CronTriggerCallbackRegistrationFactory) {
  if (registration === undefined) {
    throw new AgentError({
      code: 'CRON_CALLBACK_REGISTRATION_REQUIRED',
      message: 'Remote Cron callback transport registration must be configured.',
      category: 'VALIDATION',
      retryable: false,
    });
  }
  return registration;
}
