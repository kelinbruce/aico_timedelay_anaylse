import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import type { CreateComposedAppOptions, CreateNextAgentAppOptions } from '../src/composition/composition-contracts.js';
import type { composeAppLifecycle } from '../src/composition/app-lifecycle-composition.js';
import type { NextAgentTestAppOptions } from '../src/composition/create-test-composition.js';

type ProductInputGroup = 'basic-config' | 'model' | 'observability' | 'gateway-runtime-capability' | 'cron' | 'channel-lifecycle-plugin';

const nextAgentProductInputGroups = {
  serviceVersion: 'basic-config',
  credentialResolver: 'basic-config',
  identity: 'basic-config',
  configFile: 'basic-config',
  modelGatewayProviders: 'model',
  modelProviderProfile: 'model',
  metricsExporter: 'observability',
  gatewayProviders: 'gateway-runtime-capability',
  sandboxGatewayFactory: 'gateway-runtime-capability',
  scheduledMaintenanceGatewayFactory: 'gateway-runtime-capability',
  ragRetrievalFactory: 'gateway-runtime-capability',
  questionRecommendationsGateway: 'gateway-runtime-capability',
  backgroundTaskStoreFactory: 'gateway-runtime-capability',
  skillHubAccessFactory: 'gateway-runtime-capability',
  webChannelRegistration: 'channel-lifecycle-plugin',
  webIdentityResolver: 'channel-lifecycle-plugin',
  developerDiagnosticArtifactWriterFactory: 'channel-lifecycle-plugin',
  cronTaskGatewayFactory: 'cron',
  cronTaskSchedulerFactory: 'cron',
  cronTriggerCallbackCredentialRef: 'cron',
  cronTriggerCallbackRegistration: 'cron',
} as const satisfies Record<keyof CreateNextAgentAppOptions, ProductInputGroup>;

const composedProductInputGroups = {
  ...nextAgentProductInputGroups,
  systemConfig: 'basic-config',
  agentDefinition: 'basic-config',
  riskPolicyEvaluator: 'gateway-runtime-capability',
  registeredCustomAdapterTypes: 'gateway-runtime-capability',
  capabilityProviderReferenceValidation: 'gateway-runtime-capability',
  sandboxGateway: 'gateway-runtime-capability',
  operationalLogWriter: 'observability',
  metricsRegistry: 'observability',
  metricsInfrastructure: 'observability',
  clipCommandRunner: 'gateway-runtime-capability',
  traceProjector: 'observability',
  webChannelRegistration: 'channel-lifecycle-plugin',
  trustedLocalWebExtensionRegistration: 'channel-lifecycle-plugin',
  trustedLocalWebExtensionProtectedPrefixes: 'channel-lifecycle-plugin',
  taskChannelRegistration: 'channel-lifecycle-plugin',
  lifecycleHooks: 'channel-lifecycle-plugin',
  lifecycleHook: 'channel-lifecycle-plugin',
  lifecycleHookDefinitions: 'channel-lifecycle-plugin',
  workflowExecutionServiceFactory: 'gateway-runtime-capability',
  workflowExecutionMode: 'gateway-runtime-capability',
  workflowRemoteExecutionGateway: 'gateway-runtime-capability',
  pluginRegistrySnapshot: 'channel-lifecycle-plugin',
  gatewayBindings: 'gateway-runtime-capability',
  cronTaskIdFactory: 'cron',
  chatUploadFileConfig: 'gateway-runtime-capability',
  chatUploadConfigProvider: 'gateway-runtime-capability',
  operationLogPort: 'gateway-runtime-capability',
} as const satisfies Record<keyof CreateComposedAppOptions, ProductInputGroup>;

type TestInputGroup = 'basic-config' | 'model' | 'observability' | 'lifecycle' | 'gateway-runtime-capability' | 'cron';

const testHostInputGroups = {
  serviceVersion: 'basic-config',
  workspaceDir: 'basic-config',
  agentDefinition: 'basic-config',
  identity: 'basic-config',
  channelPort: 'basic-config',
  localAuthEnabled: 'basic-config',
  modelProfiles: 'model',
  toolDisclosureMode: 'model',
  skillDisclosureMode: 'model',
  clipcDisclosureMode: 'model',
  taskCallback: 'basic-config',
  model: 'model',
  modelSteps: 'model',
  modelRequestSink: 'model',
  operationalLogWriter: 'observability',
  observationLogger: 'observability',
  metricsRegistry: 'observability',
  metricsExporter: 'observability',
  traceProjector: 'observability',
  diagnosticDetail: 'observability',
  lifecycleHooks: 'lifecycle',
  lifecycleHook: 'lifecycle',
  lifecycleHookDefinitions: 'lifecycle',
  hooks: 'lifecycle',
  sandboxGateway: 'gateway-runtime-capability',
  sandboxGatewayFactory: 'gateway-runtime-capability',
  scheduledMaintenanceGatewayFactory: 'gateway-runtime-capability',
  ragRetrievalFactory: 'gateway-runtime-capability',
  backgroundTaskStoreFactory: 'gateway-runtime-capability',
  riskPolicyEvaluator: 'gateway-runtime-capability',
  clipCommandRunner: 'gateway-runtime-capability',
  gatewayProviders: 'gateway-runtime-capability',
  guardrailProvider: 'gateway-runtime-capability',
  skillHubAccessFactory: 'gateway-runtime-capability',
  capabilityProviders: 'gateway-runtime-capability',
  cronTaskGatewayFactory: 'cron',
  cronTaskSchedulerFactory: 'cron',
  cronTaskIdFactory: 'cron',
  cronDeploymentMode: 'cron',
  cronTriggerCallbackCredentialRef: 'cron',
  cronTriggerCallbackRegistration: 'cron',
} as const satisfies Record<keyof NextAgentTestAppOptions, TestInputGroup>;

type LifecycleOwnership = 'app-owned-lifecycle' | 'start-only' | 'pure-fact';
type LifecycleInput = Parameters<typeof composeAppLifecycle>[0];

const lifecycleInputOwnership = {
  scheduledMaintenance: 'app-owned-lifecycle',
  cronTaskScheduler: 'app-owned-lifecycle',
  taskTrajectoryWorker: 'app-owned-lifecycle',
  memoryAgingSchedulers: 'app-owned-lifecycle',
  memoryExtractionSchedulers: 'app-owned-lifecycle',
  capabilitySubsystem: 'start-only',
  webChannelRegistration: 'start-only',
  taskChannelRegistration: 'start-only',
  cronTriggerCallbackRegistration: 'app-owned-lifecycle',
  ensureRagKnowledgeBuilt: 'start-only',
  runtime: 'app-owned-lifecycle',
  sessionActivityService: 'app-owned-lifecycle',
  server: 'app-owned-lifecycle',
  systemConfig: 'pure-fact',
  projectorHost: 'app-owned-lifecycle',
  ragRetrieval: 'app-owned-lifecycle',
  ragKnowledgeGovernance: 'app-owned-lifecycle',
  gatewayBindings: 'app-owned-lifecycle',
  closeCronTasks: 'app-owned-lifecycle',
  operationalLogWriter: 'app-owned-lifecycle',
  runtimeLoggerProviderBinding: 'app-owned-lifecycle',
  metricsInfrastructure: 'app-owned-lifecycle',
  developerDiagnosticArtifactWriter: 'app-owned-lifecycle',
} as const satisfies Record<keyof LifecycleInput, LifecycleOwnership>;

describe('composition input and lifecycle ownership characterization', () => {
  it('keeps every current public product input in an explicit preparation group', () => {
    expect(Object.keys(nextAgentProductInputGroups)).toHaveLength(21);
    expect(Object.keys(composedProductInputGroups)).toHaveLength(47);
    const source = readFileSync(new URL('../src/composition/create-app.ts', import.meta.url), 'utf8');
    const syncPreparation = source.slice(
      source.indexOf('function prepareCompositionInputsSync'),
      source.indexOf('async function prepareCompositionInputsAsync'),
    );
    const asyncPreparation = source.slice(
      source.indexOf('async function prepareCompositionInputsAsync'),
      source.indexOf('function composeNextAgentApp'),
    );
    for (const field of Object.keys(composedProductInputGroups)) {
      expect(syncPreparation, `sync preparation must project ${field}`).toContain(`options.${field}`);
      expect(asyncPreparation, `async preparation must project ${field}`).toContain(`options.${field}`);
    }
  });

  it('keeps all 41 test-host fields in an explicit projection group', () => {
    expect(Object.keys(testHostInputGroups)).toHaveLength(41);
    expect(new Set(Object.values(testHostInputGroups))).toEqual(
      new Set<TestInputGroup>(['basic-config', 'model', 'observability', 'lifecycle', 'gateway-runtime-capability', 'cron']),
    );
  });

  it('classifies every app lifecycle input by ownership', () => {
    expect(Object.keys(lifecycleInputOwnership)).toHaveLength(23);
    expect(Object.values(lifecycleInputOwnership).filter((value) => value === 'start-only')).toHaveLength(4);
    expect(Object.values(lifecycleInputOwnership).filter((value) => value === 'pure-fact')).toEqual(['pure-fact']);
  });

  it('distributes the same configured ModelInvocationService to every model consumer', () => {
    const source = readFileSync(new URL('../src/composition/create-app.ts', import.meta.url), 'utf8');
    const memoryComposition = source.slice(
      source.indexOf('const memoryMaintenance = composeMemoryMaintenanceLayer'),
      source.indexOf('const sessionServices = composeSessionServicesLayer'),
    );
    const workflowComposition = source.slice(
      source.indexOf('const workflowExecutionService = composeWorkflowExecutionLayer'),
      source.indexOf('const capabilityLayer = composeCapabilityLayer'),
    );
    const sessionComposition = source.slice(
      source.indexOf('const sessionServices = composeSessionServicesLayer'),
      source.indexOf('const contextLayer = composeContextEngineLayer'),
    );
    const contextComposition = source.slice(
      source.indexOf('const contextLayer = composeContextEngineLayer'),
      source.indexOf('const health = composeHealthEvaluator'),
    );
    const requestRuntimeComposition = source.slice(
      source.indexOf('const requestRuntimeLayer = composeRequestRuntimeLayer'),
      source.indexOf('deferredBindings.bindRuntimeSubagentExecution(requestRuntimeLayer.runtimeSubagentExecution)'),
    );

    expect(memoryComposition).toContain('modelInvocationService,');
    expect(workflowComposition).toContain('modelInvocationService,');
    expect(sessionComposition).toContain('modelInvocationService,');
    expect(contextComposition).toContain('modelInvocationService,');
    expect(requestRuntimeComposition).toContain('modelInvocationService,');
    expect(source).not.toContain('runBoundModelInvocationService');
    expect(source).not.toContain('configuredModelInvocationService');
  });

  it('does not restore the removed run-scoped Skill resource reauthorizer', () => {
    const source = readFileSync(new URL('../src/composition/request-runtime-composition.ts', import.meta.url), 'utf8');
    const dependenciesStart = source.indexOf('agentRuntimeDependencies:');
    const agentRuntimeDependencies = source.slice(dependenciesStart, source.indexOf('assemblyRegistry: input.assemblyRegistry', dependenciesStart));

    expect(agentRuntimeDependencies).not.toContain('skillResourceReauthorizer');
  });
});
