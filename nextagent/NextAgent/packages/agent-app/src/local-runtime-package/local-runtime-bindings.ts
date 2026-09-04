import type { BackgroundTaskStoreGatewayPort, GatewayProvider } from '@nextagent/agent-contracts/gateway';
import type { ApiCallPort } from '@nextagent/agent-contracts/capability';
import type { ForkActiveContextSelectionPort } from '@nextagent/agent-contracts/context';
import { brand, type AgentId, type AgentVersion, type JsonObject } from '@nextagent/agent-common';
import type {
  CreateComposedAppOptions,
  CronTaskSchedulerFactory,
  RagRetrievalFactory,
  SandboxGatewayFactory,
  ScheduledMaintenanceGatewayFactory,
} from '../composition/create-app.js';

export interface LocalGatewayRuntimeBindings {
  readonly createLocalGatewayProvider: (providerId?: string, options?: { readonly allowedApis?: readonly string[] }) => GatewayProvider;
  readonly createSqliteWorkingMemoryGatewayProvider: (
    providerId?: string,
    options?: { readonly forkActiveContextSelector?: ForkActiveContextSelectionPort },
  ) => GatewayProvider;
  readonly createSqliteLongTermMemoryGatewayProvider: () => GatewayProvider;
  readonly createSqliteCronTaskGateway: NonNullable<CreateComposedAppOptions['cronTaskGatewayFactory']>;
  readonly createLocalCronTaskScheduler: CronTaskSchedulerFactory;
  readonly createRestrictedLocalSandboxGateway: SandboxGatewayFactory;
  readonly createLocalScheduledMaintenanceGateway: ScheduledMaintenanceGatewayFactory;
  readonly createLocalRagKnowledgeGovernance: RagRetrievalFactory;
  readonly createLocalBackgroundTaskStore: () => BackgroundTaskStoreGatewayPort;
  readonly createLocalApiCallPort: () => ApiCallPort;
}

export interface LocalRuntimeBindings extends LocalGatewayRuntimeBindings {
  readonly frontendScripts: readonly string[];
  readonly protectedPathPrefixes: readonly string[];
  readonly workbenchContribution: NonNullable<CreateComposedAppOptions['trustedLocalWebExtensionRegistration']>;
}

export async function loadLocalRuntimeBindings(): Promise<LocalRuntimeBindings> {
  const gatewayBindings = await loadLocalGatewayRuntime();
  return {
    ...gatewayBindings,
    frontendScripts: localDevWorkbenchFrontendScripts(),
    protectedPathPrefixes: localDevWorkbenchProtectedPrefixes(),
    workbenchContribution: createLocalDevWorkbenchExtensionRegistration(),
  };
}

async function loadLocalGatewayRuntime(): Promise<LocalGatewayRuntimeBindings> {
  const localGatewayPackage = '@nextagent/agent-platform-gateway-local';
  const module = (await import(localGatewayPackage)) as {
    readonly createLocalGatewayProvider?: unknown;
    readonly createSqliteWorkingMemoryGatewayProvider?: unknown;
    readonly createSqliteLongTermMemoryGatewayProvider?: unknown;
    readonly createSqliteCronTaskGateway?: unknown;
    readonly createLocalCronTaskScheduler?: unknown;
    readonly createRestrictedLocalSandboxGateway?: unknown;
    readonly createLocalScheduledMaintenanceGateway?: unknown;
    readonly createLocalRagKnowledgeGovernance?: unknown;
    readonly createLocalBackgroundTaskStore?: unknown;
    readonly createLocalApiCallPort?: unknown;
  };
  if (
    typeof module.createLocalGatewayProvider !== 'function' ||
    typeof module.createSqliteWorkingMemoryGatewayProvider !== 'function' ||
    typeof module.createSqliteLongTermMemoryGatewayProvider !== 'function' ||
    typeof module.createSqliteCronTaskGateway !== 'function' ||
    typeof module.createLocalCronTaskScheduler !== 'function' ||
    typeof module.createRestrictedLocalSandboxGateway !== 'function' ||
    typeof module.createLocalScheduledMaintenanceGateway !== 'function' ||
    typeof module.createLocalRagKnowledgeGovernance !== 'function' ||
    typeof module.createLocalBackgroundTaskStore !== 'function' ||
    typeof module.createLocalApiCallPort !== 'function'
  ) {
    throw new Error('Local runtime package requires @nextagent/agent-platform-gateway-local runtime bindings.');
  }
  return module as LocalGatewayRuntimeBindings;
}

export function localDevWorkbenchFrontendScripts(): readonly string[] {
  return ['/__nextagent/dev/workbench/launcher.js'];
}

function localDevWorkbenchProtectedPrefixes(): readonly string[] {
  return ['/__nextagent/dev/workbench'];
}

function createLocalDevWorkbenchExtensionRegistration(): NonNullable<CreateComposedAppOptions['trustedLocalWebExtensionRegistration']> {
  return async (context) => {
    try {
      await registerLocalDevWorkbench(context);
    } catch {
      // Dev workbench availability must not affect local runtime startup.
    }
  };
}

async function registerLocalDevWorkbench(
  context: Parameters<NonNullable<CreateComposedAppOptions['trustedLocalWebExtensionRegistration']>>[0],
): Promise<void> {
  const moduleName = '@nextagent/agent-dev-workbench';
  const workbench = (await import(moduleName)) as {
    readonly registerAgentDevWorkbench?: (
      server: typeof context.server,
      options: {
        readonly readPort: unknown;
        readonly resolveAccessScope: (request: Parameters<typeof context.identityResolver>[0]) => Promise<{
          readonly tenantId: string;
          readonly subjectId: string;
          readonly allowedAgentIds: readonly string[];
        }>;
      },
    ) => void;
    readonly createSqliteAgentDevWorkbenchReadPort?: (options: object) => unknown;
  };
  if (typeof workbench.registerAgentDevWorkbench !== 'function' || typeof workbench.createSqliteAgentDevWorkbenchReadPort !== 'function') {
    return;
  }
  const inventoryPromise = context.resolveAgentInventory();
  const readPort = workbench.createSqliteAgentDevWorkbenchReadPort({
    sqliteFile: context.systemConfig.paths.workingMemorySqliteFile,
    ...(context.operationalLogActiveIdentity === undefined ? {} : { activeOperationalLog: context.operationalLogActiveIdentity }),
    resolveAgentConfiguration: async (query: {
      readonly agentId: string;
      readonly agentVersion: string;
      readonly agentAssemblyRef: string;
    }): Promise<JsonObject | undefined> => {
      const assembly = await context.assemblyRegistry.require(query.agentId as AgentId, query.agentVersion as AgentVersion);
      return JSON.parse(JSON.stringify(assembly)) as JsonObject;
    },
    resolvePromptTemplate: context.resolvePromptTemplate,
    resolveAgentInventory: async () => inventoryPromise,
    resolveCapabilityDescriptors: async (query: {
      readonly tenantId: string;
      readonly subjectId: string;
      readonly sessionId: string;
      readonly agentId: string;
      readonly agentVersion: string;
      readonly agentAssemblyRef: string;
      readonly capabilityIds: readonly string[];
    }): Promise<readonly JsonObject[]> => {
      const assembly = await context.assemblyRegistry.require(query.agentId as AgentId, query.agentVersion as AgentVersion);
      if (assembly.agentAssemblyRef !== query.agentAssemblyRef) {
        return [];
      }
      const disclosed = new Set(query.capabilityIds);
      const descriptors = await context.catalog.listAvailable({
        tenantId: brand<string, 'TenantId'>(query.tenantId),
        subjectId: brand<string, 'SubjectId'>(query.subjectId),
        sessionId: brand<string, 'SessionId'>(query.sessionId),
        agentAssembly: assembly,
        includeUnavailable: true,
      });
      return JSON.parse(JSON.stringify(descriptors.filter((descriptor) => disclosed.has(descriptor.capabilityId)))) as JsonObject[];
    },
  });
  workbench.registerAgentDevWorkbench(context.server, {
    readPort,
    ...(context.developerDiagnosticArtifactStatus === undefined
      ? {}
      : { developerDiagnosticArtifactStatus: context.developerDiagnosticArtifactStatus }),
    resolveAccessScope: async (request) => {
      const identity = context.identityResolver(request);
      return {
        tenantId: identity.tenantId,
        subjectId: identity.subjectId,
        allowedAgentIds: resolveReachableAgentIds(String(context.systemConfig.activeAgentId), await inventoryPromise),
      };
    },
  });
}

function resolveReachableAgentIds(rootAgentId: string, inventory: readonly JsonObject[]): readonly string[] {
  const allowed = new Set<string>([rootAgentId]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const entry of inventory) {
      const agentId = stringField(entry, 'agentId');
      if (agentId === undefined) {
        continue;
      }
      const parentScope = objectField(entry, 'parentAgentScope');
      if (parentScope !== undefined && allowed.has(stringField(parentScope, 'agentId') ?? '') && !allowed.has(agentId)) {
        allowed.add(agentId);
        changed = true;
      }
      if (!allowed.has(agentId)) {
        continue;
      }
      const bindings = entry['capabilityBindings'];
      if (!Array.isArray(bindings)) {
        continue;
      }
      for (const binding of bindings) {
        if (typeof binding !== 'object' || binding === null || Array.isArray(binding)) {
          continue;
        }
        const candidate = binding as JsonObject;
        const targetId = stringField(candidate, 'capabilityId');
        if (candidate['capabilityType'] === 'AGENT' && candidate['enabled'] !== false && targetId !== undefined && !allowed.has(targetId)) {
          allowed.add(targetId);
          changed = true;
        }
      }
    }
  }
  return [...allowed].sort();
}

function objectField(value: JsonObject, key: string): JsonObject | undefined {
  const candidate = value[key];
  return typeof candidate === 'object' && candidate !== null && !Array.isArray(candidate) ? (candidate as JsonObject) : undefined;
}

function stringField(value: JsonObject, key: string): string | undefined {
  const candidate = value[key];
  return typeof candidate === 'string' && candidate.length > 0 ? candidate : undefined;
}

export async function loadRemoteApiCallPort(): Promise<ApiCallPort> {
  const remotePackage = '@nextagent/agent-platform-gateway-remote';
  const module = (await import(remotePackage)) as {
    readonly createRemoteApiCallPort?: unknown;
    readonly createUdsRemoteServiceCallGateway?: unknown;
  };
  if (typeof module.createRemoteApiCallPort !== 'function') {
    throw new Error('Remote runtime package requires @nextagent/agent-platform-gateway-remote with createRemoteApiCallPort.');
  }
  if (typeof module.createUdsRemoteServiceCallGateway !== 'function') {
    throw new Error('Remote runtime package requires @nextagent/agent-platform-gateway-remote with createUdsRemoteServiceCallGateway.');
  }
  const udsGateway = (
    module as { readonly createUdsRemoteServiceCallGateway: (options: { socketPath: string; allowLocalhost: boolean }) => unknown }
  ).createUdsRemoteServiceCallGateway({
    socketPath: process.env.MODEL_GATEWAY_SOCKET_PATH ?? '/opt/sidecar/ir/http.sock',
    allowLocalhost: true,
  });
  return (module as { readonly createRemoteApiCallPort: (options: { readonly udsGateway: unknown }) => ApiCallPort }).createRemoteApiCallPort({
    udsGateway,
  });
}
