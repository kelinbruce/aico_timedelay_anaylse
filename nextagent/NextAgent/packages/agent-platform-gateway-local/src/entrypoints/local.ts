import { createNextAgentApp, createNextAgentAppAsync, type CreateNextAgentAppOptions, type NextAgentApp } from '@nextagent/agent-app';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createLocalBackgroundTaskStore,
  createLocalCronTaskScheduler,
  createLocalGatewayProvider,
  createLocalRagKnowledgeGovernance,
  createLocalScheduledMaintenanceGateway,
  createRestrictedLocalSandboxGateway,
  createSqliteCronTaskGateway,
} from '../index.js';
import { createDefaultLocalGatewayProviders, unavailableLocalSkillHubAccessFactory } from '../local-skillhub-defaults.js';

export function createLocalNextAgentApp(options: CreateNextAgentAppOptions = {}): NextAgentApp {
  return createNextAgentApp({
    ...options,
    ...localGatewayCompositionDefaults(options),
    gatewayProviders: options.gatewayProviders ?? createDefaultLocalGatewayProviders(),
    skillHubAccessFactory: options.skillHubAccessFactory ?? unavailableLocalSkillHubAccessFactory,
  });
}

export function createLocalNextAgentAppAsync(options: CreateNextAgentAppOptions = {}): Promise<NextAgentApp> {
  return createNextAgentAppAsync({
    ...options,
    ...localGatewayCompositionDefaults(options),
    gatewayProviders: options.gatewayProviders ?? createDefaultLocalGatewayProviders(),
    skillHubAccessFactory: options.skillHubAccessFactory ?? unavailableLocalSkillHubAccessFactory,
  });
}

export function localGatewayCompositionDefaults(options: CreateNextAgentAppOptions = {}): CreateNextAgentAppOptions {
  return {
    ...(options.cronTaskGatewayFactory === undefined ? { cronTaskGatewayFactory: createSqliteCronTaskGateway } : {}),
    ...(options.cronTaskSchedulerFactory === undefined ? { cronTaskSchedulerFactory: createLocalCronTaskScheduler } : {}),
    ...(options.sandboxGatewayFactory === undefined ? { sandboxGatewayFactory: createRestrictedLocalSandboxGateway } : {}),
    ...(options.scheduledMaintenanceGatewayFactory === undefined
      ? { scheduledMaintenanceGatewayFactory: createLocalScheduledMaintenanceGateway }
      : {}),
    ...(options.ragRetrievalFactory === undefined ? { ragRetrievalFactory: createLocalRagKnowledgeGovernance } : {}),
    ...(options.backgroundTaskStoreFactory === undefined ? { backgroundTaskStoreFactory: createLocalBackgroundTaskStore } : {}),
  };
}

if (isMain()) {
  const app = await createLocalNextAgentAppAsync();
  await app.start();
}

function isMain(): boolean {
  return process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
}
