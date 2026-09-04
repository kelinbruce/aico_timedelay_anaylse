import { brand, type EpochMillis, type IdentityContext } from '@nextagent/agent-common';
import type { AgentAssembly, AgentAssemblyRegistry } from '@nextagent/agent-contracts/agent-assembly';
import type { ModelInvocationService } from '@nextagent/agent-contracts/model';
import type { ModelSelectionService } from '@nextagent/agent-contracts/context';
import { MEMORY_EXTRACTION, type PromptTemplateAssembler } from '@nextagent/agent-context-engine';
import {
  createMemoryAgingScheduler,
  createMemoryExtractionLlmStrategy,
  createMemoryExtractionScheduler,
  createMemoryLifecycleDiagnostics,
  createMemoryToolsProvider,
  createLongTermMemoryToolPort,
  createTaskTrajectoryBuilder,
  createTaskTrajectoryWorker,
  extractTrajectoryCandidates,
  getLongTermMemoryDetailWithAging,
  type MemoryAgingAuditEvent,
  type MemoryAgingCycleDiagnostic,
} from '@nextagent/agent-memory';
import type { GuardrailGatewayPort } from '@nextagent/agent-contracts/gateway';
import {
  createObservationEvent,
  type MetricsRegistry,
  type ObservabilityProjectorHost,
  type TrustedOwnerScope,
} from '@nextagent/agent-observability';
import { projectMemoryToolsRegistration } from '@nextagent/agent-memory';
import type { DefaultSystemConfig } from '../config/component-config.js';
import type { AgentScope } from './composition-contracts.js';
import {
  memoryAgingDiagnosticAgentScope,
  memoryExtractionDiagnosticAgentScope,
  taskTrajectoryDiagnosticAgentScope,
  trustedOwnerScope,
} from './app-composition-helpers.js';
import type { AppGatewayStores } from './composition-contracts.js';
import { reportMemoryConfigurationTelemetry } from './memory-config-telemetry.js';

type ProjectedObservation = Parameters<ObservabilityProjectorHost['acceptObservation']>[0];

export interface MemoryMaintenanceComposition {
  readonly taskTrajectoryWorker?: ReturnType<typeof createTaskTrajectoryWorker>;
  readonly memoryAgingSchedulers: ReadonlyArray<ReturnType<typeof createMemoryAgingScheduler>>;
  readonly memoryExtractionSchedulers: ReadonlyArray<ReturnType<typeof createMemoryExtractionScheduler>>;
}

export interface MemoryAgingObservers {
  readonly diagnosticObserver: (event: MemoryAgingCycleDiagnostic) => void;
  readonly auditObserver: (event: MemoryAgingAuditEvent) => void;
}

export interface MemoryCapabilityComposition {
  readonly memoryToolsOptIn: ReturnType<typeof projectMemoryToolsRegistration>;
  readonly memoryToolsRegistered: boolean;
  readonly memoryLifecycleDiagnostics: ReturnType<typeof createMemoryLifecycleDiagnostics>;
  readonly agingObservers: MemoryAgingObservers;
  readonly memoryToolPort: ReturnType<typeof createLongTermMemoryToolPort>;
  readonly memoryCapabilityProvider?: ReturnType<typeof createMemoryToolsProvider>;
}

export function composeMemoryCapabilityLayer(input: {
  readonly systemConfig: DefaultSystemConfig;
  readonly agentAssemblies: readonly AgentAssembly[];
  readonly gateway: AppGatewayStores;
  readonly localPersistenceSelected: boolean;
  readonly identity: IdentityContext;
  readonly agentScopesByAgentId: ReadonlyMap<string, AgentScope>;
  readonly projectorHost: ObservabilityProjectorHost;
  readonly metricsRegistry: MetricsRegistry;
  readonly ownerScope: TrustedOwnerScope;
  readonly agentScope: AgentScope;
  readonly guardrail?: GuardrailGatewayPort;
}): MemoryCapabilityComposition {
  const memoryToolsOptIn = projectMemoryToolsRegistration({
    assembly: {
      capabilityBindings: input.agentAssemblies.flatMap((assembly) => assembly.capabilityBindings),
    },
    registered: input.systemConfig.memory.status === 'VALID',
  });
  const memoryToolsRegistered = input.systemConfig.memory.status === 'VALID' && memoryToolsOptIn.optedIn;
  const memoryLifecycleDiagnostics = createMemoryLifecycleDiagnostics({
    createObservationEvent,
    now: () => brand<number, 'EpochMillis'>(Date.now()),
  });
  const agingObservers = createMemoryAgingObservers({
    identity: input.identity,
    agentScopesByAgentId: input.agentScopesByAgentId,
    projectorHost: input.projectorHost,
    memoryLifecycleDiagnostics,
  });
  const memoryToolPort = composeMemoryToolPort({
    gateway: input.gateway,
    localPersistenceSelected: input.localPersistenceSelected,
    systemConfig: input.systemConfig,
    agingObservers,
    ...(input.guardrail === undefined ? {} : { guardrail: input.guardrail }),
  });
  const memoryCapabilityProvider = memoryToolsOptIn.optedIn
    ? createMemoryToolsProvider(memoryToolPort, {
        config: memoryToolsOptIn.config,
        enabled: memoryToolsRegistered,
      })
    : undefined;
  reportMemoryConfigurationTelemetry({
    memoryConfig: input.systemConfig.memory,
    descriptionDiagnostics: memoryToolsOptIn.descriptionDiagnostics,
    metricsRegistry: input.metricsRegistry,
    projectorHost: input.projectorHost,
    ownerScope: input.ownerScope,
    agentScope: input.agentScope,
  });
  return {
    memoryToolsOptIn,
    memoryToolsRegistered,
    memoryLifecycleDiagnostics,
    agingObservers,
    memoryToolPort,
    ...(memoryCapabilityProvider === undefined ? {} : { memoryCapabilityProvider }),
  };
}

function acceptMemoryObservation(projectorHost: ObservabilityProjectorHost, event: unknown): void {
  projectorHost.acceptObservation(event as ProjectedObservation);
}

export function createMemoryAgingObservers(input: {
  readonly identity: IdentityContext;
  readonly agentScopesByAgentId: ReadonlyMap<string, AgentScope>;
  readonly projectorHost: ObservabilityProjectorHost;
  readonly memoryLifecycleDiagnostics: ReturnType<typeof createMemoryLifecycleDiagnostics>;
}): MemoryAgingObservers {
  return {
    diagnosticObserver: (event) => {
      try {
        const diagnosticAgentScope = memoryAgingDiagnosticAgentScope(event, input.agentScopesByAgentId);
        if (diagnosticAgentScope === undefined) {
          return;
        }
        acceptMemoryObservation(
          input.projectorHost,
          input.memoryLifecycleDiagnostics.createAgingDiagnosticObservation(
            event,
            trustedOwnerScope(input.identity, diagnosticAgentScope),
            diagnosticAgentScope,
          ),
        );
      } catch {
        /* non-blocking */
      }
    },
    auditObserver: (event) => {
      try {
        const diagnosticAgentScope = input.agentScopesByAgentId.get(String(event.agentId));
        if (diagnosticAgentScope === undefined) {
          return;
        }
        acceptMemoryObservation(
          input.projectorHost,
          input.memoryLifecycleDiagnostics.createAgingAuditObservation(
            event,
            trustedOwnerScope(input.identity, diagnosticAgentScope),
            diagnosticAgentScope,
          ),
        );
      } catch {
        /* non-blocking */
      }
    },
  };
}

export function composeMemoryToolPort(input: {
  readonly gateway: AppGatewayStores;
  readonly localPersistenceSelected: boolean;
  readonly systemConfig: DefaultSystemConfig;
  readonly agingObservers: MemoryAgingObservers;
  readonly guardrail?: GuardrailGatewayPort;
}): ReturnType<typeof createLongTermMemoryToolPort> {
  return createLongTermMemoryToolPort(input.gateway, {
    ...(input.guardrail === undefined ? {} : { guardrail: input.guardrail }),
    ...(input.localPersistenceSelected && input.systemConfig.memory.status === 'VALID' && input.systemConfig.memory.aging.enabled
      ? {
          getLongTermMemoryDetail: (request, signal) =>
            getLongTermMemoryDetailWithAging({
              config: input.systemConfig.memory,
              retriever: input.gateway.longTermMemoryRetriever,
              store: input.gateway.longTermMemoryStore,
              request,
              ...(signal === undefined ? {} : { signal }),
              now: () => brand<number, 'EpochMillis'>(Date.now()),
              diagnosticObserver: input.agingObservers.diagnosticObserver,
              auditObserver: input.agingObservers.auditObserver,
            }),
        }
      : {}),
  });
}

export function composeMemoryMaintenanceLayer(input: {
  readonly localPersistenceSelected: boolean;
  readonly systemConfig: DefaultSystemConfig;
  readonly gateway: AppGatewayStores;
  readonly identity: IdentityContext;
  readonly agentScopesByAgentId: ReadonlyMap<string, AgentScope>;
  readonly projectorHost: ObservabilityProjectorHost;
  readonly assemblyRegistry: AgentAssemblyRegistry;
  readonly modelSelectionService: ModelSelectionService;
  readonly modelInvocationService: ModelInvocationService;
  readonly promptTemplateAssembler: PromptTemplateAssembler;
  readonly memoryCapability: MemoryCapabilityComposition;
  readonly guardrail?: GuardrailGatewayPort;
}): MemoryMaintenanceComposition {
  if (!input.localPersistenceSelected) {
    return {
      memoryAgingSchedulers: [],
      memoryExtractionSchedulers: [],
    };
  }
  const agingObservers = input.memoryCapability.agingObservers;
  return {
    taskTrajectoryWorker: createTaskTrajectoryWorker({
      builder: createTaskTrajectoryBuilder({
        requestRuns: input.gateway.requestRuns,
        messages: input.gateway.messages,
        timeline: input.gateway.timeline,
        now: () => brand<number, 'EpochMillis'>(Date.now()),
      }),
      store: input.gateway.taskTrajectoryStore,
      query: input.gateway.taskTrajectoryQuery,
      catchUpScopes: Array.from(input.agentScopesByAgentId.values()).map((agentScope) => ({
        tenantId: input.identity.tenantId,
        subjectId: input.identity.subjectId,
        agentId: agentScope.agentId,
      })),
      diagnosticObserver: (event) => {
        try {
          const agentScope = taskTrajectoryDiagnosticAgentScope(event, input.agentScopesByAgentId);
          if (agentScope === undefined) {
            return;
          }
          acceptMemoryObservation(
            input.projectorHost,
            input.memoryCapability.memoryLifecycleDiagnostics.createTaskTrajectoryDiagnosticObservation(
              event,
              trustedOwnerScope(input.identity, agentScope),
              agentScope,
            ),
          );
        } catch {
          /* non-blocking */
        }
      },
    }),
    memoryAgingSchedulers: Array.from(input.agentScopesByAgentId.values()).map((agentScope) =>
      createMemoryAgingScheduler({
        config: input.systemConfig.memory,
        store: input.gateway.longTermMemoryStore,
        scopes: [
          {
            tenantId: input.identity.tenantId,
            subjectId: input.identity.subjectId,
            agentId: agentScope.agentId,
            agentVersion: agentScope.agentVersion,
          },
        ],
        now: () => brand<number, 'EpochMillis'>(Date.now()),
        diagnosticObserver: agingObservers.diagnosticObserver,
        auditObserver: agingObservers.auditObserver,
      }),
    ),
    memoryExtractionSchedulers: Array.from(input.agentScopesByAgentId.values()).map((agentScope) =>
      createMemoryExtractionScheduler({
        config: input.systemConfig.memory,
        store: input.gateway.longTermMemoryStore,
        ...(input.guardrail === undefined ? {} : { guardrail: input.guardrail }),
        taskTrajectoryQuery: input.gateway.taskTrajectoryQuery,
        scopes: [
          {
            tenantId: input.identity.tenantId,
            subjectId: input.identity.subjectId,
            agentId: agentScope.agentId,
            agentVersion: agentScope.agentVersion,
          },
        ],
        extractTrajectoryCandidates,
        llmStrategy: createMemoryExtractionLlmStrategy({
          resolveAssembly: async (scope) =>
            scope.agentVersion === undefined
              ? input.assemblyRegistry.active(scope.agentId)
              : input.assemblyRegistry.require(scope.agentId, scope.agentVersion),
          modelSelectionService: input.modelSelectionService,
          model: input.modelInvocationService,
          identity: input.identity,
          assemblePrompt: (request) =>
            input.promptTemplateAssembler.assemble({
              purpose: MEMORY_EXTRACTION,
              agentId: request.agentId,
              agentVersion: request.agentVersion,
              ...(request.locale === undefined ? {} : { locale: request.locale }),
              flowVariables: {},
              selectedModel: request.selectedModel,
            }),
        }),
        now: () => brand<number, 'EpochMillis'>(Date.now()),
        diagnosticObserver: (event) => {
          try {
            const agentScope = memoryExtractionDiagnosticAgentScope(event, input.agentScopesByAgentId);
            if (agentScope === undefined) {
              return;
            }
            acceptMemoryObservation(
              input.projectorHost,
              input.memoryCapability.memoryLifecycleDiagnostics.createExtractionDiagnosticObservation(
                event,
                trustedOwnerScope(input.identity, agentScope),
                agentScope,
              ),
            );
          } catch {
            /* non-blocking */
          }
        },
        auditObserver: (event) => {
          try {
            const agentScope = input.agentScopesByAgentId.get(String(event.agentId));
            if (agentScope === undefined) {
              return;
            }
            acceptMemoryObservation(
              input.projectorHost,
              input.memoryCapability.memoryLifecycleDiagnostics.createExtractionAuditObservation(
                event,
                trustedOwnerScope(input.identity, agentScope),
                agentScope,
              ),
            );
          } catch {
            /* non-blocking */
          }
        },
      }),
    ),
  };
}
