import type {
  GatewayAdapterKind,
  GatewayBindings,
  GatewayProviderCreateInput,
  LongTermMemoryGatewayBindings,
  SqliteGatewayStoreBindings,
  WorkingMemoryGatewayBindings,
  CronTaskGatewayPort,
  WorkflowRagRetrievalGateway,
  RagRetrievalGateway,
  SandboxGatewayPort,
  ScheduledMaintenanceGatewayPort,
} from '@nextagent/agent-contracts/gateway';

export const remoteGatewayReferenceAdapterKinds: readonly GatewayAdapterKind[] = [
  'working-memory',
  'long-term-memory',
  'sqlite',
  'sandbox',
  'scheduled-maintenance',
  'cron-tasks',
  'rag-knowledge',
  'skillhub',
  'workflow-execution',
];

export interface RemoteGatewayReferenceBindings {
  readonly workingMemory?: WorkingMemoryGatewayBindings;
  readonly longTermMemory?: LongTermMemoryGatewayBindings;
  readonly sqliteStores?: SqliteGatewayStoreBindings;
  readonly cronTasks?: CronTaskGatewayPort;
  readonly sandbox?: SandboxGatewayPort;
  readonly ragRetrieval?: RagRetrievalGateway;
  readonly workflowRagRetrieval?: WorkflowRagRetrievalGateway;
  readonly scheduledMaintenance?: ScheduledMaintenanceGatewayPort;
  close?: () => Promise<void> | void;
}

export type RemoteGatewayReferenceBindingsFactory = (input: GatewayProviderCreateInput) => RemoteGatewayReferenceBindings;

export function resolveRemoteGatewayReferenceBindings(
  bindings: RemoteGatewayReferenceBindings | RemoteGatewayReferenceBindingsFactory | undefined,
  input: GatewayProviderCreateInput,
): RemoteGatewayReferenceBindings {
  if (bindings === undefined) {
    return {};
  }
  return typeof bindings === 'function' ? bindings(input) : bindings;
}

export function selectedRemoteGatewayMissingBinding(
  selectedKinds: ReadonlySet<GatewayAdapterKind>,
  bindings: RemoteGatewayReferenceBindings,
): string | undefined {
  if (selectedKinds.has('working-memory') && bindings.workingMemory === undefined) {
    return 'workingMemory';
  }
  if (selectedKinds.has('long-term-memory') && bindings.longTermMemory === undefined) {
    return 'longTermMemory';
  }
  if (selectedKinds.has('sqlite') && bindings.sqliteStores === undefined) {
    return 'sqliteStores';
  }
  if (selectedKinds.has('sandbox') && bindings.sandbox === undefined) {
    return 'sandbox';
  }
  if (selectedKinds.has('rag-knowledge') && bindings.ragRetrieval === undefined) {
    return 'ragRetrieval';
  }
  if (selectedKinds.has('scheduled-maintenance') && bindings.scheduledMaintenance === undefined) {
    return 'scheduledMaintenance';
  }
  if (selectedKinds.has('cron-tasks') && bindings.cronTasks === undefined) {
    return 'cronTasks';
  }
  // workflow-execution does not need a reference binding; its endpoint comes
  // from the gateway selection entry and is resolved by composition.
  return undefined;
}

export function createSelectedRemoteGatewayBindings(input: {
  readonly providerId: string;
  readonly selectedKinds: ReadonlySet<GatewayAdapterKind>;
  readonly bindings: RemoteGatewayReferenceBindings;
}): GatewayBindings {
  return {
    providerId: input.providerId,
    deploymentMode: 'REMOTE',
    readiness: {
      state: 'READY',
      evidenceRef: `gateway-provider:${input.providerId}:ready`,
      safeMessage: 'Remote gateway provider is ready.',
    },
    ...(input.selectedKinds.has('working-memory') ? { workingMemory: input.bindings.workingMemory } : {}),
    ...(input.selectedKinds.has('long-term-memory') ? { longTermMemory: input.bindings.longTermMemory } : {}),
    ...(input.selectedKinds.has('sqlite') ? { sqliteStores: input.bindings.sqliteStores } : {}),
    ...(input.selectedKinds.has('sandbox') ? { sandbox: input.bindings.sandbox } : {}),
    ...(input.selectedKinds.has('cron-tasks') ? { cronTasks: input.bindings.cronTasks } : {}),
    ...(input.selectedKinds.has('rag-knowledge') ? { ragRetrieval: input.bindings.ragRetrieval } : {}),
    ...(input.selectedKinds.has('rag-knowledge') && input.bindings.workflowRagRetrieval !== undefined
      ? { workflowRagRetrieval: input.bindings.workflowRagRetrieval }
      : {}),
    ...(input.selectedKinds.has('scheduled-maintenance') ? { scheduledMaintenance: input.bindings.scheduledMaintenance } : {}),
    ...(input.bindings.close === undefined ? {} : { close: input.bindings.close }),
  };
}

export function blockedRemoteGatewayBindings(providerId: string, reason: string): GatewayBindings {
  return {
    providerId,
    deploymentMode: 'REMOTE',
    readiness: {
      state: 'BLOCKED',
      evidenceRef: `gateway-provider:${providerId}:${reason}`,
      safeMessage: 'Remote gateway provider bindings are not ready.',
    },
  };
}
