import { brand, type EpochMillis } from '@nextagent/agent-common';
import {
  createDefaultContextEngine,
  createDefaultForkPromotionContentResolver,
  createDefaultLargeContentExternalizer,
  createDefaultPromptTemplateRegistry,
  createDefaultProportionalBudgetPolicy,
  createDefaultTraceableSummaryGenerator,
  createDefaultTokenEstimator,
  createModelSelectionService,
  type PromptTemplateAssembler,
} from '@nextagent/agent-context-engine';
import type { AgentAssemblyRegistry } from '@nextagent/agent-contracts/agent-assembly';
import type { CapabilityCatalog } from '@nextagent/agent-contracts/capability';
import type { ModelCatalogQueryService, ModelInvocationService } from '@nextagent/agent-contracts/model';
import type { ModelSelectionService } from '@nextagent/agent-contracts/context';
import type { LifecycleHookInvocationPort } from '@nextagent/agent-contracts/runtime';
import { createObservedContextEngine, type ObservabilityProjectorHost } from '@nextagent/agent-observability';
import { searchMemoryCapabilityId } from '@nextagent/agent-memory';
import { createExecutionWorkspaceResolver } from '@nextagent/agent-runtime';
import { randomUUID } from 'node:crypto';
import type { DefaultSystemConfig } from '../config/component-config.js';
import type { AppGatewayStores } from './composition-contracts.js';

export interface ContextEngineComposition {
  readonly largeContentExternalizer: ReturnType<typeof createDefaultLargeContentExternalizer>;
  readonly forkPromotionContentResolver: ReturnType<typeof createDefaultForkPromotionContentResolver>;
  readonly contextEngine: ReturnType<typeof createDefaultContextEngine>;
}

export function composeContextEngineLayer(input: {
  readonly systemConfig: DefaultSystemConfig;
  readonly executionWorkspaceResolver: ReturnType<typeof createExecutionWorkspaceResolver>;
  readonly assemblyRegistry: AgentAssemblyRegistry;
  readonly gateway: AppGatewayStores;
  readonly catalog: CapabilityCatalog;
  readonly modelInvocationService: ModelInvocationService;
  readonly modelSelectionService: ModelSelectionService;
  readonly promptTemplateRegistry: ReturnType<typeof createDefaultPromptTemplateRegistry>;
  readonly promptTemplateAssembler: PromptTemplateAssembler;
  readonly lifecycleHookInvocation: LifecycleHookInvocationPort;
  readonly now: () => EpochMillis;
  readonly projectorHost: ObservabilityProjectorHost;
}): ContextEngineComposition {
  const largeContentExternalizer = createDefaultLargeContentExternalizer({
    runtimeWorkspaceRoot: input.systemConfig.paths.runtimeWorkspaceRoot,
    sharedDataRoot: input.systemConfig.paths.sharedDataRoot,
    deploymentMode: input.systemConfig.gateway.deploymentMode,
    executionWorkspaceResolver: input.executionWorkspaceResolver,
    assemblyRegistry: input.assemblyRegistry,
    now: input.now,
  });
  const forkPromotionContentResolver = createDefaultForkPromotionContentResolver({
    runtimeWorkspaceRoot: input.systemConfig.paths.runtimeWorkspaceRoot,
    sharedDataRoot: input.systemConfig.paths.sharedDataRoot,
    deploymentMode: input.systemConfig.gateway.deploymentMode,
    executionWorkspaceResolver: input.executionWorkspaceResolver,
    assemblyRegistry: input.assemblyRegistry,
    now: input.now,
  });
  const summaryGenerator = createDefaultTraceableSummaryGenerator({
    assemblyRegistry: input.assemblyRegistry,
    modelSelectionService: input.modelSelectionService,
    model: input.modelInvocationService,
    promptTemplateAssembler: input.promptTemplateAssembler,
  });
  const contextEngine = createDefaultContextEngine({
    activeContextStore: input.gateway.activeContext,
    messageStore: input.gateway.messages,
    attachmentStore: input.gateway.attachments,
    blobStore: input.gateway.blobs,
    forkPromotionContentStore: input.gateway.sessionForks,
    assemblyRegistry: input.assemblyRegistry,
    capabilityCatalog: input.catalog,
    modelSelectionService: input.modelSelectionService,
    toolDisclosureMode: input.systemConfig.capabilityDisclosure.toolDisclosureMode,
    skillDisclosureMode: input.systemConfig.capabilityDisclosure.skillDisclosureMode,
    memoryToolCapabilityId: searchMemoryCapabilityId,
    budgetPolicy: createDefaultProportionalBudgetPolicy(),
    tokenEstimator: createDefaultTokenEstimator(),
    summaryGenerator,
    lifecycleHook: input.lifecycleHookInvocation,
    promptTemplateRegistry: input.promptTemplateRegistry,
    promptTemplateAssembler: input.promptTemplateAssembler,
    commitCompaction: (request) =>
      input.gateway.activeContext.commitCompaction({
        tenantId: brand(request.ownerScope.tenantId),
        subjectId: brand(request.ownerScope.subjectId),
        agentId: brand(request.agentId),
        sessionId: brand(request.sessionId),
        expectedActiveContextVersion: request.expectedActiveContextVersion,
        summaryMessage: request.summaryMessage,
        retainedTailMessageIds: request.retainedTailMessageIds,
        idempotencyKey: request.idempotencyKey,
      }),
    idFactory: (prefix) => `${prefix}-${randomUUID()}`,
    clock: () => brand(Date.now()),
  });
  return {
    largeContentExternalizer,
    forkPromotionContentResolver,
    contextEngine: createObservedContextEngine(contextEngine, input.projectorHost),
  };
}

export function composeModelSelectionService(input: {
  readonly assemblyRegistry: AgentAssemblyRegistry;
  readonly modelCatalog: ModelCatalogQueryService;
  readonly promptTemplateRegistry: ReturnType<typeof createDefaultPromptTemplateRegistry>;
}): ModelSelectionService {
  return createModelSelectionService(input);
}
