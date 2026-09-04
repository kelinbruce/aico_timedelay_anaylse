import type { CredentialResolver } from '@nextagent/agent-model';
import type { CapabilityInvocationPort } from '@nextagent/agent-contracts/capability';
import type { WorkflowSandboxExecutionPort } from '@nextagent/agent-contracts/capability';
import type {
  RecipeDefinition,
  WorkflowExecutionEvent,
  WorkflowExecutionMode,
  WorkflowExecutionResumeState,
  WorkflowExecutionObserver,
  WorkflowExecutionRequest,
  WorkflowExecutionResult,
  WorkflowExecutionService,
  WorkflowRemoteExecutionGateway,
} from '@nextagent/agent-contracts/core';
import type { WorkflowRagRetrievalGateway } from '@nextagent/agent-contracts/gateway';
import type { ModelInvocationService } from '@nextagent/agent-contracts/model';
import type { ExecutionCorrelationPort } from '@nextagent/agent-contracts/observability';
import type { DeveloperDiagnosticArtifactWriter } from '@nextagent/agent-log';
import type { JsonObject } from '@nextagent/agent-common';
import type { DeveloperDiagnosticArtifactSink } from '@nextagent/agent-plugin-sdk';
import type { RagRetrievalBinding } from './composition-contracts.js';
import {
  adaptFetchWorkflowRemoteGateway,
  createFetchWorkflowRemoteExecutionGatewayFromEndpoint,
  createRemoteWorkflowExecutionService,
  createWorkflowExecutionService,
  createWorkflowGuardrailLifecycleHookAdapter,
  createWorkflowNodeCatalog,
  createWorkflowRagKnowledgeRetrieverAdapter,
  type WorkflowExecutionServiceFactoryOptions,
  type WorkflowRecipeDefinitionSource,
} from '@nextagent/agent-workflow';
import { WorkflowTraceCollector, createTimingWrappedService, createWorkflowTraceCoordinates } from '@nextagent/agent-plugin-sdk';
import type { DefaultSystemConfig } from '../config/component-config.js';
import { requireRemoteGateway, requireWorkflowRuntimeAdapters } from './app-composition-helpers.js';

export function composeWorkflowExecutionLayer(input: {
  readonly systemConfig: DefaultSystemConfig;
  readonly workflowExecutionMode?: WorkflowExecutionMode;
  readonly workflowRemoteExecutionGateway?: WorkflowRemoteExecutionGateway;
  readonly workflowExecutionServiceFactory?: (options: WorkflowExecutionServiceFactoryOptions) => WorkflowExecutionService;
  readonly recipeDefinitionSource: WorkflowRecipeDefinitionSource;
  readonly credentialResolver: CredentialResolver;
  readonly lifecycleHook: Parameters<typeof createWorkflowGuardrailLifecycleHookAdapter>[0]['lifecycleHook'];
  readonly ragKnowledgeGovernance: RagRetrievalBinding;
  readonly workflowRagGateway: WorkflowRagRetrievalGateway;
  readonly ensureRagKnowledgeBuilt: (signal?: AbortSignal) => Promise<void>;
  readonly workflowCapabilityInvocation: () => CapabilityInvocationPort | undefined;
  readonly workflowSandboxExecution: () => WorkflowSandboxExecutionPort | undefined;
  readonly modelInvocationService: ModelInvocationService;
  readonly workflowRuntimeAdapters: () => Parameters<typeof requireWorkflowRuntimeAdapters>[0];
  readonly executionCorrelation: ExecutionCorrelationPort;
  readonly developerDiagnosticArtifactWriter?: DeveloperDiagnosticArtifactWriter;
}): WorkflowExecutionService {
  const workflowTraceEnabled = input.systemConfig.workflowTrace?.enabled === true;
  const writer = input.developerDiagnosticArtifactWriter;
  const traceContext = workflowTraceEnabled && writer !== undefined ? createTraceContext(writer) : undefined;

  const modelInvocation =
    traceContext !== undefined
      ? createTimingWrappedService(input.modelInvocationService, traceContext.sink, traceContext.coordinates, 'MODEL', ['complete', 'stream'])
      : input.modelInvocationService;

  const capabilityInvocation =
    traceContext !== undefined && input.workflowCapabilityInvocation !== undefined
      ? () => {
          const original = input.workflowCapabilityInvocation!();
          return original === undefined
            ? undefined
            : createTimingWrappedService(original, traceContext.sink, traceContext.coordinates, 'API', ['invoke']);
        }
      : input.workflowCapabilityInvocation;

  const originalSandboxPort = input.workflowSandboxExecution === undefined ? undefined : input.workflowSandboxExecution();
  const sandboxExecution =
    traceContext !== undefined && originalSandboxPort !== undefined
      ? createTimingWrappedService(originalSandboxPort, traceContext.sink, traceContext.coordinates, 'PYTHON', ['runPython'])
      : originalSandboxPort;

  let workflowExecutionServiceRef: WorkflowExecutionService | undefined;
  const workflowExecutionFactoryOptions: WorkflowExecutionServiceFactoryOptions = {
    resolveRecipeDefinition: (request) => input.recipeDefinitionSource.require(request.agentId, request.recipeName),
    nodeCatalog: createWorkflowNodeCatalog({
      ...(capabilityInvocation === undefined ? {} : { capabilityInvocation }),
      modelInvocation,
      runtimeCapabilityResolver: (request) => requireWorkflowRuntimeAdapters(input.workflowRuntimeAdapters()).runtimeCapabilityResolver?.(request),
      resolveModelInvocationConfig: (request, signal, hint) =>
        requireWorkflowRuntimeAdapters(input.workflowRuntimeAdapters()).resolveModelInvocationConfig!(request, signal, hint),
      resolveModelForParamExtract: (request, signal, model, modelGroup) =>
        requireWorkflowRuntimeAdapters(input.workflowRuntimeAdapters()).resolveModelForParamExtract!(request, signal, model, modelGroup),
      prepareLlmPrompt: (request) => requireWorkflowRuntimeAdapters(input.workflowRuntimeAdapters()).prepareLlmPrompt!(request),
      resolveSecretReference: input.credentialResolver,
      evaluateGuardrail: createWorkflowGuardrailLifecycleHookAdapter({ lifecycleHook: input.lifecycleHook }),
      retrieveKnowledge: createWorkflowRagKnowledgeRetrieverAdapter({
        gateway: () => input.workflowRagGateway,
        ensureBuilt: input.ensureRagKnowledgeBuilt,
      }),
      resolveRecipeDefinition: (request, recipeName) => input.recipeDefinitionSource.require(request.agentId, recipeName),
      executeSubRecipe: async (request, signal, observer) => {
        if (workflowExecutionServiceRef === undefined) {
          throw new Error('Workflow execution service is unavailable.');
        }
        return await workflowExecutionServiceRef.execute(request, signal, observer);
      },
      ...(process.env.SCENE !== undefined ? { scene: process.env.SCENE } : {}),
      ...(sandboxExecution === undefined ? {} : { sandboxExecution }),
    }),
    resolveSecretReference: input.credentialResolver,
    executionCorrelation: input.executionCorrelation,
  };

  const workflowGatewayEntry = input.systemConfig.gatewaySelection.entries.find(
    (entry) => entry.adapterKind === 'workflow-execution' && entry.selectionState === 'enabled',
  );
  const workflowRemoteViaGateway = workflowGatewayEntry?.deploymentMode === 'REMOTE';
  const workflowRemoteMode = workflowRemoteViaGateway || input.workflowExecutionMode === 'remote';
  const hasWorkflowEndpoint = workflowGatewayEntry?.endpoint !== undefined;
  const workflowExecutionService =
    input.workflowExecutionServiceFactory !== undefined
      ? input.workflowExecutionServiceFactory(workflowExecutionFactoryOptions)
      : workflowRemoteMode
        ? createRemoteWorkflowExecutionService({
            gateway:
              workflowRemoteViaGateway && hasWorkflowEndpoint
                ? adaptFetchWorkflowRemoteGateway(createFetchWorkflowRemoteExecutionGatewayFromEndpoint(workflowGatewayEntry!.endpoint!))
                : requireRemoteGateway(input.workflowRemoteExecutionGateway),
          })
        : createWorkflowExecutionService(workflowExecutionFactoryOptions);

  const finalService =
    traceContext !== undefined
      ? createTraceAwareService(workflowExecutionService, traceContext.collector, traceContext.coordinates)
      : workflowExecutionService;
  workflowExecutionServiceRef = finalService;
  return finalService;
}

interface TraceContext {
  readonly sink: DeveloperDiagnosticArtifactSink;
  readonly collector: WorkflowTraceCollector;
  readonly coordinates: ReturnType<typeof createWorkflowTraceCoordinates>;
}

function createTraceContext(writer: DeveloperDiagnosticArtifactWriter): TraceContext {
  const coordinates = createWorkflowTraceCoordinates();
  const sink: DeveloperDiagnosticArtifactSink = {
    emit(emitInput) {
      return writer.emit({ ...emitInput, pluginId: 'workflow-trace' });
    },
  };
  return {
    sink,
    coordinates,
    collector: new WorkflowTraceCollector(sink, coordinates),
  };
}

function createTraceAwareService(
  original: WorkflowExecutionService,
  traceCollector: WorkflowTraceCollector,
  coordinates: { sessionId?: string; requestId?: string; runId?: string; agentId?: string; agentVersion?: string },
): WorkflowExecutionService {
  return {
    async execute(
      request: WorkflowExecutionRequest,
      signal: AbortSignal,
      observer?: WorkflowExecutionObserver,
      runtime?: {
        requestPendingInput: (request: JsonObject, signal: AbortSignal) => Promise<JsonObject>;
        saveCheckpoint?: (input: { readonly resumeState: WorkflowExecutionResumeState }) => Promise<void>;
      },
    ): Promise<WorkflowExecutionResult> {
      coordinates.sessionId = request.sessionId;
      coordinates.requestId = request.requestId;
      coordinates.runId = request.runId;
      coordinates.agentId = request.agentId;
      coordinates.agentVersion = request.agentVersion;

      const compositeObserver: WorkflowExecutionObserver | undefined =
        observer === undefined
          ? traceCollector
          : {
              async emitEvent(event: WorkflowExecutionEvent) {
                try {
                  await traceCollector.emitEvent(event);
                } catch {
                  // Trace collection is isolated; its failure must not suppress the app observer.
                }
                try {
                  await observer.emitEvent(event);
                } catch {
                  // Observer failure remains isolated from the authoritative workflow execution result.
                }
              },
              ...(observer !== undefined &&
              typeof (observer as unknown as { registerExecutionRecipe?: unknown }).registerExecutionRecipe === 'function'
                ? {
                    registerExecutionRecipe(executionId: string, recipe: RecipeDefinition) {
                      (
                        observer as unknown as { registerExecutionRecipe: (executionId: string, recipe: RecipeDefinition) => void }
                      ).registerExecutionRecipe(executionId, recipe);
                    },
                  }
                : {}),
            };
      return original.execute(request, signal, compositeObserver, runtime);
    },
  };
}
