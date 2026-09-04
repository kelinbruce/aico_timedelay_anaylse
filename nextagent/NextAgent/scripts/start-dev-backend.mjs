import { createNextAgentAppAsync } from '../packages/agent-app/dist/index.js';
import { loadLocalRuntimeBindings } from '../packages/agent-app/dist/local-runtime-package/local-runtime-bindings.js';

const localRuntime = await loadLocalRuntimeBindings();
const app = await createNextAgentAppAsync({
  gatewayProviders: [
    localRuntime.createSqliteWorkingMemoryGatewayProvider(),
    localRuntime.createSqliteLongTermMemoryGatewayProvider(),
    localRuntime.createLocalGatewayProvider(),
  ],
  sandboxGatewayFactory: localRuntime.createRestrictedLocalSandboxGateway,
  scheduledMaintenanceGatewayFactory: localRuntime.createLocalScheduledMaintenanceGateway,
  ragRetrievalFactory: localRuntime.createLocalRagKnowledgeGovernance,
  cronTaskGatewayFactory: localRuntime.createSqliteCronTaskGateway,
  cronTaskSchedulerFactory: localRuntime.createLocalCronTaskScheduler,
  backgroundTaskStoreFactory: localRuntime.createLocalBackgroundTaskStore,
  trustedLocalWebExtensionRegistration: localRuntime.workbenchContribution,
  trustedLocalWebExtensionProtectedPrefixes: localRuntime.protectedPathPrefixes,
});
await app.start();
