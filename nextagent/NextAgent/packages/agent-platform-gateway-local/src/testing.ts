export * from '@nextagent/agent-app/testing';

import {
  createComposedApp as createBaseComposedApp,
  createComposedAppAsync as createBaseComposedAppAsync,
  createLocalConfiguredComposedApp as createBaseLocalConfiguredComposedApp,
  createProviderConfiguredComposedApp as createBaseProviderConfiguredComposedApp,
  createProviderConfiguredComposedAppAsync as createBaseProviderConfiguredComposedAppAsync,
  createNextAgentApp as createBaseNextAgentApp,
  createNextAgentTestApp as createBaseNextAgentTestApp,
  createInMemoryMetricsRegistry,
  readCapturedAuditRecords as readBaseCapturedAuditRecords,
  readCapturedMetricSamples as readBaseCapturedMetricSamples,
  type CreateComposedAppOptions,
  type CreateComposedTestAppOptions,
  type CreateNextAgentAppOptions,
  type CreateNextAgentTestProductAppOptions,
  type NextAgentApp,
  type NextAgentTestAppOptions,
} from '@nextagent/agent-app/testing';
import type { AuditEventRecord, GatewayProvider } from '@nextagent/agent-contracts/gateway';
import {
  createLocalGatewayProvider,
  createLocalCronTaskScheduler,
  createLocalRagKnowledgeGovernance,
  createLocalScheduledMaintenanceGateway,
  createRestrictedLocalSandboxGateway,
  createSqliteCronTaskGateway,
} from './index.js';
import { createDefaultLocalGatewayProviders, unavailableLocalSkillHubAccessFactory } from './local-skillhub-defaults.js';
export { auditFilePolicy, createFileAuditEventStoreGatewayForTesting } from './audit/file-audit-event-store.js';

type TestModelInvocationService = Parameters<typeof createBaseComposedApp>[1];

export function createNextAgentApp(options: CreateNextAgentTestProductAppOptions = {}): NextAgentApp {
  const records: AuditEventRecord[] = [];
  return registerAuditCapture(createBaseNextAgentApp(withLocalGatewayDefaults(options, records)), records);
}

export function createComposedApp(options: CreateComposedTestAppOptions, model: TestModelInvocationService): NextAgentApp {
  const records: AuditEventRecord[] = [];
  return registerAuditCapture(
    createBaseComposedApp(
      {
        ...withLocalGatewayDefaults(options, records),
        metricsRegistry: options.metricsRegistry ?? createInMemoryMetricsRegistry(),
      },
      model,
    ),
    records,
  );
}

export function createComposedAppAsync(options: CreateComposedAppOptions, model: TestModelInvocationService): Promise<NextAgentApp> {
  const records: AuditEventRecord[] = [];
  return createBaseComposedAppAsync(
    {
      ...withLocalGatewayDefaults(options, records),
      metricsRegistry: options.metricsRegistry ?? createInMemoryMetricsRegistry(),
    },
    model,
  ).then((app) => registerAuditCapture(app, records));
}

export function createLocalConfiguredComposedApp(options: CreateComposedAppOptions, model: TestModelInvocationService): NextAgentApp {
  const records: AuditEventRecord[] = [];
  return registerAuditCapture(
    createBaseLocalConfiguredComposedApp(
      {
        ...withLocalGatewayDefaults(options, records),
        metricsRegistry: options.metricsRegistry ?? createInMemoryMetricsRegistry(),
      },
      model,
    ),
    records,
  );
}

export function createProviderConfiguredComposedApp(options: CreateComposedTestAppOptions): NextAgentApp {
  const records: AuditEventRecord[] = [];
  return registerAuditCapture(
    createBaseProviderConfiguredComposedApp({
      ...withLocalGatewayDefaults(options, records),
      metricsRegistry: options.metricsRegistry ?? createInMemoryMetricsRegistry(),
    }),
    records,
  );
}

export function createProviderConfiguredComposedAppAsync(options: CreateComposedAppOptions): Promise<NextAgentApp> {
  const records: AuditEventRecord[] = [];
  return createBaseProviderConfiguredComposedAppAsync({
    ...withLocalGatewayDefaults(options, records),
    metricsRegistry: options.metricsRegistry ?? createInMemoryMetricsRegistry(),
  }).then((app) => registerAuditCapture(app, records));
}

export function createNextAgentTestApp(options: NextAgentTestAppOptions): NextAgentApp {
  const records: AuditEventRecord[] = [];
  return registerAuditCapture(createBaseNextAgentTestApp(withLocalGatewayDefaultsForTestApp(options, records)), records);
}

export function localGatewayCompositionDefaults(options: CreateNextAgentAppOptions = {}): CreateNextAgentAppOptions {
  return {
    ...(options.gatewayProviders === undefined ? { gatewayProviders: createDefaultLocalGatewayProviders() } : {}),
    ...(options.cronTaskGatewayFactory === undefined ? { cronTaskGatewayFactory: createSqliteCronTaskGateway } : {}),
    ...(options.cronTaskSchedulerFactory === undefined ? { cronTaskSchedulerFactory: createLocalCronTaskScheduler } : {}),
    ...(options.sandboxGatewayFactory === undefined ? { sandboxGatewayFactory: createRestrictedLocalSandboxGateway } : {}),
    ...(options.scheduledMaintenanceGatewayFactory === undefined
      ? { scheduledMaintenanceGatewayFactory: createLocalScheduledMaintenanceGateway }
      : {}),
    ...(options.ragRetrievalFactory === undefined ? { ragRetrievalFactory: createLocalRagKnowledgeGovernance } : {}),
    ...(options.skillHubAccessFactory === undefined ? { skillHubAccessFactory: unavailableLocalSkillHubAccessFactory } : {}),
  };
}

function withLocalGatewayDefaults<T extends CreateNextAgentAppOptions>(options: T, auditRecords: AuditEventRecord[]): T & CreateNextAgentAppOptions {
  const defaults = localGatewayCompositionDefaults(options);
  return {
    ...options,
    ...defaults,
    gatewayProviders: withAuditCapture(options.gatewayProviders ?? defaults.gatewayProviders ?? [], auditRecords),
  };
}

function withLocalGatewayDefaultsForTestApp(options: NextAgentTestAppOptions, auditRecords: AuditEventRecord[]): NextAgentTestAppOptions {
  return {
    ...options,
    gatewayProviders: withAuditCapture(options.gatewayProviders ?? createDefaultLocalGatewayProviders(), auditRecords),
    ...(options.cronTaskGatewayFactory === undefined ? { cronTaskGatewayFactory: createSqliteCronTaskGateway } : {}),
    ...(options.cronTaskSchedulerFactory === undefined ? { cronTaskSchedulerFactory: createLocalCronTaskScheduler } : {}),
    ...(options.sandboxGatewayFactory === undefined ? { sandboxGatewayFactory: createRestrictedLocalSandboxGateway } : {}),
    ...(options.scheduledMaintenanceGatewayFactory === undefined
      ? { scheduledMaintenanceGatewayFactory: createLocalScheduledMaintenanceGateway }
      : {}),
    ...(options.ragRetrievalFactory === undefined ? { ragRetrievalFactory: createLocalRagKnowledgeGovernance } : {}),
    ...(options.skillHubAccessFactory === undefined ? { skillHubAccessFactory: unavailableLocalSkillHubAccessFactory } : {}),
  };
}

const capturedAuditRecords = new WeakMap<NextAgentApp, readonly AuditEventRecord[]>();

export function readCapturedAuditRecords(app: NextAgentApp): readonly AuditEventRecord[] {
  return capturedAuditRecords.get(app) ?? readBaseCapturedAuditRecords(app);
}

export function readCapturedMetricSamples(app: NextAgentApp) {
  return readBaseCapturedMetricSamples(app);
}

function registerAuditCapture(app: NextAgentApp, records: readonly AuditEventRecord[]): NextAgentApp {
  capturedAuditRecords.set(app, records);
  return app;
}

function withAuditCapture(providers: readonly GatewayProvider[], records: AuditEventRecord[]): readonly GatewayProvider[] {
  return providers.map((provider) => ({
    ...provider,
    create(input) {
      const bindings = provider.create(input);
      if (bindings.audit === undefined) {
        return bindings;
      }
      return {
        ...bindings,
        audit: {
          async appendAuditEvent(record) {
            records.push(record);
          },
        },
      };
    },
  }));
}
