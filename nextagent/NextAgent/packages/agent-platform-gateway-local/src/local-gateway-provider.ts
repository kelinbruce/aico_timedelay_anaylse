import type {
  BlobStoreGateway,
  GatewayAdapterKind,
  GatewayBindings,
  GatewayProvider,
  GatewayProviderCreateInput,
  LongTermMemoryGatewayBindings,
  SqliteGatewayStoreBindings,
  WorkingMemoryGatewayBindings,
} from '@nextagent/agent-contracts/gateway';
import { createSqliteLongTermMemoryStores, createSqliteResidualGatewayStores, createSqliteWorkingMemoryStores } from './db/sqlite-gateway-stores.js';
import type { LocalForkActiveContextSelector } from './db/sqlite-session-fork-application.js';
import { createSqliteCronTaskGateway } from './db/sqlite-cron-task-gateway.js';
import { createLocalFilesystemBlobStore } from './blob/local-filesystem-blob-store.js';
import { createRestrictedLocalSandboxGateway } from './sandbox/restricted-local-sandbox.js';
import { createLocalScheduledMaintenanceGateway } from './scheduled/local-scheduled-maintenance.js';
import { createFileAuditEventStoreGateway } from './audit/file-audit-event-store.js';
import { createLocalUserQueryGateway } from './user-query/local-user-query-gateway.js';
import { dirname, join } from 'node:path';

const localSupportedAdapterKinds: readonly GatewayAdapterKind[] = [
  'sqlite',
  'sandbox',
  'scheduled-maintenance',
  'cron-tasks',
  'rag-knowledge',
  'workflow-execution',
  'user-query',
];

export interface SqliteWorkingMemoryGatewayProviderOptions {
  readonly forkActiveContextSelector?: LocalForkActiveContextSelector;
}

export function createSqliteWorkingMemoryGatewayProvider(
  providerId = 'local-working-memory-gateway',
  options: SqliteWorkingMemoryGatewayProviderOptions = {},
): GatewayProvider {
  return singleAdapterProvider(providerId, 'working-memory', (input) => {
    const stores = createSqliteWorkingMemoryStores({
      sqliteFile: input.runtime.paths.workingMemorySqliteFile,
      ...(options.forkActiveContextSelector === undefined ? {} : { forkActiveContextSelector: options.forkActiveContextSelector }),
    });
    return {
      workingMemory: workingMemoryBindingsFacade(stores),
      close: () => stores.close(),
    };
  });
}

export function createSqliteLongTermMemoryGatewayProvider(providerId = 'local-long-term-memory-gateway'): GatewayProvider {
  return singleAdapterProvider(providerId, 'long-term-memory', (input) => {
    const stores = createSqliteLongTermMemoryStores({ sqliteFile: input.runtime.paths.longTermMemorySqliteFile });
    return {
      longTermMemory: {
        store: portFacade(stores.store),
        retriever: portFacade(stores.retriever),
        sharing: portFacade(stores.sharing),
      },
      close: () => stores.close(),
    };
  });
}

export interface LocalGatewayProviderOptions {
  readonly allowedApis?: readonly string[];
  readonly blobStore?: BlobStoreGateway;
}

export function createLocalGatewayProvider(providerId = 'local-gateway', options?: LocalGatewayProviderOptions): GatewayProvider {
  return createLocalGatewayProviderForDeployment(providerId, true, options);
}

export function createRemoteSupportLocalGatewayProvider(
  providerId = 'remote-support-local-gateway',
  options?: LocalGatewayProviderOptions,
): GatewayProvider {
  return createLocalGatewayProviderForDeployment(providerId, false, options);
}

function createLocalGatewayProviderForDeployment(
  providerId: string,
  includeLocalAudit: boolean,
  options?: LocalGatewayProviderOptions,
): GatewayProvider {
  return {
    providerId,
    deploymentMode: 'LOCAL',
    supportedAdapterKinds: localSupportedAdapterKinds,
    create(input: GatewayProviderCreateInput): GatewayBindings {
      const unsupported = input.selectedEntries.find((entry) => !localSupportedAdapterKinds.includes(entry.adapterKind));
      if (unsupported !== undefined) {
        return blockedBindings(providerId, 'unsupported-adapter');
      }
      const selectedKinds = new Set(input.selectedEntries.map((entry) => entry.adapterKind));
      const sqliteStores = selectedKinds.has('sqlite')
        ? createSqliteResidualGatewayStores({ sqliteFile: input.runtime.paths.sqliteFile })
        : undefined;
      const blobs =
        sqliteStores === undefined
          ? undefined
          : (options?.blobStore ?? createLocalFilesystemBlobStore({ blobDataDir: join(dirname(input.runtime.paths.sqliteFile), 'blobs') }));
      const cronTasks = selectedKinds.has('cron-tasks') ? createSqliteCronTaskGateway(input.runtime.paths.sqliteFile) : undefined;
      const sandbox = selectedKinds.has('sandbox')
        ? createRestrictedLocalSandboxGateway({
            allowedApis: options?.allowedApis ?? [],
            ...(input.runtime.sandbox.allowedExecutables === undefined ? {} : { allowedExecutables: input.runtime.sandbox.allowedExecutables }),
            ...(input.runtime.sandbox.clipcExecutableDirectory === undefined
              ? {}
              : { clipcExecutableDirectory: input.runtime.sandbox.clipcExecutableDirectory }),
            deniedExecutables: input.runtime.sandbox.deniedExecutables,
            enabled: input.runtime.sandbox.enabled,
          })
        : undefined;
      const scheduledMaintenance = selectedKinds.has('scheduled-maintenance') ? createLocalScheduledMaintenanceGateway() : undefined;
      const userQuery = selectedKinds.has('user-query') ? createLocalUserQueryGateway() : undefined;
      const audit = includeLocalAudit ? createFileAuditEventStoreGateway({ logDirectory: input.runtime.paths.logDirectory }) : undefined;
      let closePromise: Promise<void> | undefined;
      return {
        providerId,
        deploymentMode: 'LOCAL',
        readiness: readyReadiness(providerId),
        ...(audit === undefined ? {} : { audit }),
        ...(sqliteStores === undefined ? {} : { sqliteStores: sqliteBindingsFacade(sqliteStores, blobs) }),
        ...(sandbox === undefined ? {} : { sandbox }),
        ...(cronTasks === undefined ? {} : { cronTasks }),
        ...(scheduledMaintenance === undefined ? {} : { scheduledMaintenance }),
        ...(userQuery === undefined ? {} : { userQuery }),
        close: () => {
          closePromise ??= Promise.resolve().then(async () => {
            let failure: unknown;
            try {
              sqliteStores?.close();
            } catch (error) {
              failure = error;
            }
            try {
              cronTasks?.close();
            } catch (error) {
              failure ??= error;
            }
            try {
              await audit?.close();
            } catch (error) {
              failure ??= error;
            }
            if (failure !== undefined) {
              throw failure;
            }
          });
          return closePromise;
        },
      };
    },
  };
}

function singleAdapterProvider(
  providerId: string,
  adapterKind: GatewayAdapterKind,
  createSelected: (input: GatewayProviderCreateInput) => Pick<GatewayBindings, 'workingMemory' | 'longTermMemory' | 'close'>,
): GatewayProvider {
  return {
    providerId,
    deploymentMode: 'LOCAL',
    supportedAdapterKinds: [adapterKind],
    create(input) {
      if (input.selectedEntries.length !== 1 || input.selectedEntries[0]?.adapterKind !== adapterKind) {
        return blockedBindings(providerId, 'invalid-selection');
      }
      return {
        providerId,
        deploymentMode: 'LOCAL',
        readiness: readyReadiness(providerId),
        ...createSelected(input),
      };
    },
  };
}

function readyReadiness(providerId: string): GatewayBindings['readiness'] {
  return {
    state: 'READY',
    evidenceRef: `gateway-provider:${providerId}:ready`,
    safeMessage: 'Local gateway provider bindings are ready.',
  };
}

function blockedBindings(providerId: string, reason: string): GatewayBindings {
  return {
    providerId,
    deploymentMode: 'LOCAL',
    readiness: {
      state: 'BLOCKED',
      evidenceRef: `gateway-provider:${providerId}:${reason}`,
      safeMessage: 'Local gateway provider does not support the selected adapter selection.',
    },
  };
}

function workingMemoryBindingsFacade(stores: WorkingMemoryGatewayBindings): WorkingMemoryGatewayBindings {
  return {
    requestRuns: portFacade(stores.requestRuns),
    ...(stores.memoryRecallAttempts === undefined ? {} : { memoryRecallAttempts: portFacade(stores.memoryRecallAttempts) }),
    sessions: portFacade(stores.sessions),
    messages: portFacade(stores.messages),
    sessionForks: portFacade(stores.sessionForks),
    attachments: portFacade(stores.attachments),
    activeContext: portFacade(stores.activeContext),
    timeline: portFacade(stores.timeline),
    checkpoints: portFacade(stores.checkpoints),
    pendingInputs: portFacade(stores.pendingInputs),
    conversationAnnotations: portFacade(stores.conversationAnnotations),
    conversationShares: portFacade(stores.conversationShares),
  };
}

function sqliteBindingsFacade(stores: SqliteGatewayStoreBindings, blobs = stores.blobs): SqliteGatewayStoreBindings {
  return {
    attachmentReservations: portFacade(stores.attachmentReservations),
    blobs: portFacade(blobs),
    taskTrajectoryStore: portFacade(stores.taskTrajectoryStore),
    taskTrajectoryQuery: portFacade(stores.taskTrajectoryQuery),
    todoStateStore: portFacade(stores.todoStateStore),
    userQuestionActivity: portFacade(stores.userQuestionActivity),
  };
}

function portFacade<T extends object>(target: T): T {
  return new Proxy(target, {
    get(innerTarget, property, receiver) {
      const value = Reflect.get(innerTarget, property, receiver) as unknown;
      return typeof value === 'function' ? value.bind(innerTarget) : value;
    },
    ownKeys() {
      return [];
    },
    getOwnPropertyDescriptor() {
      return undefined;
    },
  });
}
