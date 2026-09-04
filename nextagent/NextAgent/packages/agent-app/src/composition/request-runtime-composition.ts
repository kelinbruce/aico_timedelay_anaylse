import { brand, getLogger, type AgentId, type EpochMillis, type RequestRunId } from '@nextagent/agent-common';
import type { AgentAssembly, AgentAssemblyRegistry, AgentSelectionPolicy } from '@nextagent/agent-contracts/agent-assembly';
import type { CapabilityCatalog, CapabilityInvocationPort } from '@nextagent/agent-contracts/capability';
import type { OperationLogGatewayPort, OperationLogEntry, SessionMessageStoreGateway } from '@nextagent/agent-contracts/gateway';
import type { WorkflowExecutionService } from '@nextagent/agent-contracts/core';
import type { ModelInvocationService } from '@nextagent/agent-contracts/model';
import type { ExecutionCorrelationPort } from '@nextagent/agent-contracts/observability';
import type {
  LifecycleHookInvocationPort,
  RequestRun,
  RiskPolicyEvaluator,
  RunTimelineEvent,
  RuntimeCommandPort,
  SubmitRequestCommand,
} from '@nextagent/agent-contracts/runtime';
import type { RunStatus } from '@nextagent/agent-common';
import {
  createBuiltInRiskPolicyEvaluator,
  DefaultAgent,
  normalizeCapabilityDirectiveInput,
  type DefaultAgentDependencies,
} from '@nextagent/agent-core';
import { createRetrySourceAttachmentValidator } from '@nextagent/agent-attachment-runtime';
import {
  createObservedRuntimeCommandPort,
  createTraceAwareRequestRunStore,
  createTraceAwareTimelineStore,
  createTimelineObservationMapper,
  runtimeExecutionStateObservation,
  type TimelineSpanLifecyclePort,
  type ObservabilityProjectorHost,
} from '@nextagent/agent-observability';
import {
  createAgentPolicyResolver,
  createRequestLifecycleCoordinator,
  createRuntimeSubagentExecutionPort,
  type LifecycleHookDefinition,
  type RuntimeLifecycleHookExecutor,
  type TrustedTerminalLifecycleHookExecutor,
} from '@nextagent/agent-runtime';
import {
  createQuestionActivityTrackingCommandPort,
  type createPrecomputedSuggestedQuestionPort,
  type createUserSessionService,
} from '@nextagent/agent-session';
import { buildResourceName, formatAiLogDetail, resolveAuditLocale, truncate } from './ai-log-helpers.js';
import type { WorkflowRecipeDefinitionSource } from '@nextagent/agent-workflow';
import type { DefaultSystemConfig } from '../config/component-config.js';
import type { LoadedPluginPolicy } from '../plugin/plugin-loader.js';
import { isTerminalRuntimeEvent } from './app-composition-helpers.js';
import { randomUUID } from 'node:crypto';
import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import type { AgentScope, AppGatewayStores } from './composition-contracts.js';
import type { AttachmentExecutionRuntime } from '@nextagent/agent-attachment-runtime';
import type { ContextEngineComposition } from './context-engine-composition.js';
import type { MemoryMaintenanceComposition } from './memory-maintenance-composition.js';
import type { PortalAbilityConfigProvider } from './portal-ability-composition.js';

const logger = getLogger({ component: 'agent-app', source: 'request-runtime-composition' });

type RequestLifecycleOptions = Parameters<typeof createRequestLifecycleCoordinator<Omit<DefaultAgentDependencies, 'runState'>>>[0];

export interface RequestRuntimeComposition {
  readonly runtime: ReturnType<typeof createRequestLifecycleCoordinator>;
  readonly trackedRuntimeCommands: RuntimeCommandPort;
  readonly runtimeSubagentExecution: ReturnType<typeof createRuntimeSubagentExecutionPort>;
}

export function prepareRequestRuntimePolicy(input: { readonly riskPolicyEvaluator?: RiskPolicyEvaluator }): RiskPolicyEvaluator {
  return input.riskPolicyEvaluator ?? createBuiltInRiskPolicyEvaluator({ authorizationSupported: true });
}

export function resolveRunTimelineEventPersistence(event: Pick<RunTimelineEvent, 'type' | 'inlinePayload'>): 'PERSISTED' | 'LIVE_ONLY' {
  if (event.type !== 'TOOL_STRUCTURED_DELTA') {
    return 'PERSISTED';
  }
  const workflowEventType = event.inlinePayload?.['workflowEventType'];
  return workflowEventType === 'NODE_STARTED' || workflowEventType === 'NODE_COMPLETED' ? 'PERSISTED' : 'LIVE_ONLY';
}

const SESSION_ACTIVITY_TIMELINE_EVENT_TYPES = new Set<RunTimelineEvent['type']>([
  'REQUEST_ACCEPTED',
  'USER_INPUT_REQUIRED',
  'USER_INPUT_RECEIVED',
  'USER_INPUT_TIMEOUT',
  'USER_INPUT_CANCELED',
  'REQUEST_COMPLETED',
  'REQUEST_FAILED',
  'REQUEST_CANCELED',
  'REQUEST_SUPERSEDED',
]);

export function createSessionActivityTimelineListener(sessionActivities: {
  invalidateSessionActivity: (coordinates: {
    readonly tenantId: NonNullable<RunTimelineEvent['tenantId']>;
    readonly subjectId: NonNullable<RunTimelineEvent['subjectId']>;
    readonly agentId: NonNullable<RunTimelineEvent['agentId']>;
    readonly sessionId: NonNullable<RunTimelineEvent['sessionId']>;
  }) => void;
}): (event: RunTimelineEvent) => void {
  return (event) => {
    if (
      event.persistence !== 'PERSISTED' ||
      !SESSION_ACTIVITY_TIMELINE_EVENT_TYPES.has(event.type) ||
      event.tenantId === undefined ||
      event.subjectId === undefined ||
      event.agentId === undefined ||
      event.sessionId === undefined
    ) {
      return;
    }
    sessionActivities.invalidateSessionActivity({
      tenantId: event.tenantId,
      subjectId: event.subjectId,
      agentId: event.agentId,
      sessionId: event.sessionId,
    });
  };
}

export function composeRequestRuntimeLayer(input: {
  readonly systemConfig: DefaultSystemConfig;
  readonly agentAssemblies: readonly AgentAssembly[];
  readonly pluginPolicies: readonly LoadedPluginPolicy[];
  readonly assemblyRegistry: AgentAssemblyRegistry;
  readonly agentSelectionPolicy?: AgentSelectionPolicy;
  readonly contextLayer: ContextEngineComposition;
  readonly modelInvocationService: ModelInvocationService;
  readonly catalog: CapabilityCatalog;
  readonly capabilitySubsystem: {
    readonly invocationPort: CapabilityInvocationPort;
    readonly runLifecycle: {
      onTerminalRun: (event: { readonly agentId: AgentId; readonly runId: RequestRunId }) => void;
    };
  };
  readonly riskPolicyEvaluator: RiskPolicyEvaluator;
  readonly lifecycleHookInvocation: LifecycleHookInvocationPort;
  readonly recipeDefinitionSource: WorkflowRecipeDefinitionSource;
  readonly workflowExecutionService: WorkflowExecutionService;
  readonly sessions: ReturnType<typeof createUserSessionService>;
  readonly sessionActivities: Parameters<typeof createSessionActivityTimelineListener>[0];
  readonly gateway: AppGatewayStores;
  readonly lifecycleHook: RuntimeLifecycleHookExecutor;
  readonly trustedTerminalLifecycleHook: TrustedTerminalLifecycleHookExecutor;
  readonly lifecycleHookDefinitions?: readonly LifecycleHookDefinition[] | undefined;
  readonly lifecycleHookSnapshots: RequestLifecycleOptions['lifecycleHookSnapshots'];
  readonly clock: () => EpochMillis;
  readonly memoryMaintenance: MemoryMaintenanceComposition;
  readonly projectorHost: ObservabilityProjectorHost;
  readonly defaultRouteAgentScope: AgentScope;
  readonly precomputedSuggestedQuestions: ReturnType<typeof createPrecomputedSuggestedQuestionPort>;
  readonly portalAbilityConfigProvider: PortalAbilityConfigProvider;
  readonly bindLifecycleHookInvocationTarget: (target: LifecycleHookInvocationPort) => void;
  readonly executionWorkspaceResolver: ReturnType<typeof import('@nextagent/agent-runtime').createExecutionWorkspaceResolver>;
  readonly attachmentExecutionRuntime: AttachmentExecutionRuntime;
  readonly executionCorrelation: ExecutionCorrelationPort;
  readonly timelineSpanLifecycle: TimelineSpanLifecyclePort;
  readonly traceEnabled: boolean;
  readonly operationLogPort?: OperationLogGatewayPort;
}): RequestRuntimeComposition {
  const timelineObservationMapper = createTimelineObservationMapper();
  const timelineStore = createTraceAwareTimelineStore(input.gateway.timeline, input.timelineSpanLifecycle);
  const requestRunStore = createTraceAwareRequestRunStore(input.gateway.requestRuns, input.timelineSpanLifecycle);
  const pluginPolicyResolver = createAgentPolicyResolver({
    assemblyRegistry: input.assemblyRegistry,
    assemblies: input.agentAssemblies,
    policyContributions: input.pluginPolicies,
  });
  // Process-local Map collecting model names and km markers per runId for AI log reporting.
  const modelInfoByRun = new Map<string, { models: Set<string>; hasKm: boolean }>();
  const operationLogPort = input.operationLogPort;
  const runtime = createRequestLifecycleCoordinator<Omit<DefaultAgentDependencies, 'runState'>>({
    agentConstructors: [DefaultAgent],
    agentRuntimeDependencies: {
      contextEngine: input.contextLayer.contextEngine,
      model: input.modelInvocationService,
      capabilityCatalog: input.catalog,
      capabilityInvocation: input.capabilitySubsystem.invocationPort,
      riskPolicyEvaluator: input.riskPolicyEvaluator,
      assemblyRegistry: input.assemblyRegistry,
      policyResolver: pluginPolicyResolver,
      lifecycleHook: input.lifecycleHookInvocation,
      ...(input.systemConfig.capabilityDisclosure.skillDisclosureMode === 'tool-search' ? { toolSearchSkillSearchEnabled: true } : {}),
      resolveRecipeDefinition: (request) => input.recipeDefinitionSource.require(request.agentId, request.recipeName),
      workflowExecutionService: input.workflowExecutionService,
      executionCorrelation: input.executionCorrelation,
      attachmentStore: input.gateway.attachments,
      attachmentPathResolver: async ({ run, context, attachments }) => {
        const assembly = await input.assemblyRegistry.require(run.agentId, run.agentVersion);
        const view = input.executionWorkspaceResolver.resolve({
          runtimeWorkspaceRoot: input.systemConfig.paths.runtimeWorkspaceRoot,
          sharedDataRoot: input.systemConfig.paths.sharedDataRoot,
          deploymentMode: input.systemConfig.gateway.deploymentMode,
          workspacePolicy: assembly.workspacePolicy,
          agentId: run.agentId,
          tenantId: context.identityContext.tenantId,
          subjectId: context.identityContext.subjectId,
          sessionId: run.sessionId,
          runId: run.runId,
        });
        const attachmentsDirectory = attachmentDirectory(view.roots);
        return input.attachmentExecutionRuntime.materialize({
          identityContext: context.identityContext,
          attachments,
          attachmentsDirectory,
        });
      },
    },
    assemblyRegistry: input.assemblyRegistry,
    capabilityCatalog: input.catalog,
    userSessions: input.sessions,
    messageStore: input.gateway.messages,
    sessionForkStore: input.gateway.sessionForks,
    forkPromotionContentResolver: input.contextLayer.forkPromotionContentResolver,
    attachmentReservations: input.gateway.attachmentReservations,
    retryAttachmentValidator: createRetrySourceAttachmentValidator(input.gateway.attachments),
    activeContextStore: input.gateway.activeContext,
    requestRunStore,
    timelineStore,
    traceEnabled: input.traceEnabled,
    executionCorrelation: input.executionCorrelation,
    checkpointStore: input.gateway.checkpoints,
    pendingInputStore: input.gateway.pendingInputs,
    conversationAnnotationStore: input.gateway.conversationAnnotations,
    largeContentExternalizer: input.contextLayer.largeContentExternalizer,
    acceptedInputProjector: normalizeCapabilityDirectiveInput,
    lifecycleHook: input.lifecycleHook,
    trustedTerminalLifecycleHook: input.trustedTerminalLifecycleHook,
    ...(input.lifecycleHookDefinitions === undefined ? {} : { lifecycleHookDefinitions: input.lifecycleHookDefinitions }),
    ...(input.lifecycleHookSnapshots === undefined ? {} : { lifecycleHookSnapshots: input.lifecycleHookSnapshots }),
    clock: input.clock,
    askUserQuestionDefaultTimeoutMs: async () => (await input.portalAbilityConfigProvider.get()).askUserQuestionTimeoutMs,
    runTimelineEventListeners: [
      createSessionActivityTimelineListener(input.sessionActivities),
      (event) => {
        if (
          event.tenantId === undefined ||
          event.subjectId === undefined ||
          event.agentId === undefined ||
          event.agentVersion === undefined ||
          event.eventId === undefined ||
          event.sessionId === undefined ||
          event.runId === undefined ||
          event.requestId === undefined ||
          event.requestContextId === undefined ||
          event.createdAt === undefined
        ) {
          return;
        }
        const observations = timelineObservationMapper({
          tenantId: event.tenantId,
          subjectId: event.subjectId,
          agentId: event.agentId,
          agentVersion: event.agentVersion,
          eventId: event.eventId,
          sessionId: event.sessionId,
          runId: event.runId,
          requestId: event.requestId,
          requestContextId: event.requestContextId,
          type: event.type,
          ...(event.persistence === undefined ? {} : { persistence: event.persistence }),
          inlinePayload: event.inlinePayload,
          createdAt: brand<number, 'EpochMillis'>(event.createdAt.getTime()),
        });
        for (const observation of observations) {
          input.projectorHost.acceptObservation(observation);
        }
      },
      (event) => {
        if (isTerminalRuntimeEvent(event.type) && event.agentId !== undefined && event.runId !== undefined) {
          input.capabilitySubsystem.runLifecycle.onTerminalRun({
            agentId: event.agentId,
            runId: event.runId,
          });
        }
      },
      (event) => {
        const taskTrajectoryWorker = input.memoryMaintenance.taskTrajectoryWorker;
        if (
          taskTrajectoryWorker === undefined ||
          event.persistence !== 'PERSISTED' ||
          !isTerminalRuntimeEvent(event.type) ||
          event.tenantId === undefined ||
          event.subjectId === undefined ||
          event.agentId === undefined ||
          event.sessionId === undefined ||
          event.runId === undefined ||
          event.requestId === undefined ||
          event.eventId === undefined ||
          event.sequence === undefined ||
          event.createdAt === undefined
        ) {
          return;
        }
        taskTrajectoryWorker.enqueue({
          tenantId: event.tenantId,
          subjectId: event.subjectId,
          agentId: event.agentId,
          sessionId: event.sessionId,
          requestId: event.requestId,
          requestRunId: event.runId,
          terminalTimelineEventId: event.eventId,
          terminalTimelineSequence: event.sequence,
          terminalCommittedAt: brand<number, 'EpochMillis'>(event.createdAt.getTime()),
          ...(event.agentVersion === undefined ? {} : { agentVersion: event.agentVersion }),
        });
      },
      ...(operationLogPort === undefined
        ? []
        : [
            (event: RunTimelineEvent) => {
              if (event.runId === undefined) {
                return;
              }
              const runKey = event.runId as string;
              if (event.type === 'MODEL_INVOCATION_COMPLETED') {
                const modelId = event.inlinePayload?.['modelId'];
                if (typeof modelId === 'string' && modelId.length > 0) {
                  let entry = modelInfoByRun.get(runKey);
                  if (entry === undefined) {
                    entry = { models: new Set<string>(), hasKm: false };
                    modelInfoByRun.set(runKey, entry);
                  }
                  entry.models.add(modelId);
                }
                return;
              }
              if (event.type === 'CAPABILITY_COMPLETED') {
                const payload = event.inlinePayload;
                const status = payload?.['status'];
                if (status !== 'SUCCEEDED') {
                  return;
                }
                const capabilityId = payload?.['capabilityId'];
                const nodeType = payload?.['nodeType'];
                const isKm = capabilityId === 'Rag' || nodeType === 'KNOWLEDGE_SEARCH' || nodeType === 'KNOWLEDGE_QA';
                if (!isKm) {
                  return;
                }
                let entry = modelInfoByRun.get(runKey);
                if (entry === undefined) {
                  entry = { models: new Set<string>(), hasKm: false };
                  modelInfoByRun.set(runKey, entry);
                }
                entry.hasKm = true;
              }
            },
          ]),
    ],
    runExecutionStateListeners: [
      (transition) => {
        input.projectorHost.acceptObservation(runtimeExecutionStateObservation(transition));
      },
    ],
    defaultRouteAgentId: input.systemConfig.activeAgentId,
    ...(input.agentSelectionPolicy === undefined ? {} : { agentSelectionPolicy: input.agentSelectionPolicy }),
    runTimelineEventPersistencePolicy: resolveRunTimelineEventPersistence,
    recoveryAgentId: input.systemConfig.activeAgentId,
    recoveryLockedBy: `runtime-recovery-${randomUUID()}`,
    postTerminalCallback: async (command, run, status) => {
      const assembly = await input.assemblyRegistry.require(run.agentId, run.agentVersion);
      const view = input.executionWorkspaceResolver.resolve({
        runtimeWorkspaceRoot: input.systemConfig.paths.runtimeWorkspaceRoot,
        sharedDataRoot: input.systemConfig.paths.sharedDataRoot,
        deploymentMode: input.systemConfig.gateway.deploymentMode,
        workspacePolicy: assembly.workspacePolicy,
        agentId: run.agentId,
        tenantId: command.identityContext.tenantId,
        subjectId: command.identityContext.subjectId,
        sessionId: run.sessionId,
        runId: run.runId,
      });
      await input.attachmentExecutionRuntime.cleanup({ attachmentsDirectory: attachmentDirectory(view.roots) }).catch(() => {});
      await cleanupRunTempDirectory(view.roots);
      // AI log reporting — must execute before the COMPLETED early-return so all terminal states are reported.
      if (operationLogPort !== undefined) {
        try {
          await reportAiLog(operationLogPort, input.gateway.messages, command, run, status, modelInfoByRun);
        } catch (error) {
          logger.warn(
            {
              event: 'ai_log.report_failed',
              agentId: run.agentId,
              sessionId: run.sessionId,
              runId: run.runId,
              errorMessage: error instanceof Error ? error.message : String(error),
            },
            'AI log reporting failed; business flow continues',
          );
        }
      }
      if (status !== 'COMPLETED') {
        return;
      }
      input.precomputedSuggestedQuestions.precompute({
        tenantId: command.identityContext.tenantId,
        subjectId: command.identityContext.subjectId,
        agentId: run.agentId,
        sessionId: run.sessionId,
        requestId: run.requestId,
        runId: run.runId,
      });
    },
  });
  input.bindLifecycleHookInvocationTarget(runtime.lifecycleHookInvocationPort());
  const runtimeSubagentExecution = createRuntimeSubagentExecutionPort({ assemblyRegistry: input.assemblyRegistry, runtime });
  const runtimeCommands = createObservedRuntimeCommandPort(runtime, {
    defaultRouteAgentScope: input.defaultRouteAgentScope,
    acceptObservation: (event) => input.projectorHost.acceptObservation(event),
    now: () => Date.now(),
  });
  const trackedRuntimeCommands =
    input.systemConfig.gateway.deploymentMode === 'LOCAL'
      ? createQuestionActivityTrackingCommandPort(runtimeCommands, input.gateway.userQuestionActivity, input.systemConfig.activeAgentId)
      : runtimeCommands;
  return {
    runtime,
    trackedRuntimeCommands,
    runtimeSubagentExecution,
  };
}

function attachmentDirectory(roots: ReadonlyArray<{ readonly kind: string; readonly access: string; readonly physicalPath: string }>): string {
  const tempRoot = roots.find((root) => root.kind === 'temp' && root.access === 'readWrite');
  if (tempRoot === undefined) {
    throw new Error('Attachment materialization requires a writable execution temp root.');
  }
  return join(tempRoot.physicalPath, 'attachments');
}

/**
 * Remove the per-run temp directory (`{scopeKey}/temp/{runKey}`) when a run
 * reaches a terminal state. This is the only per-run execution directory 鈥?
 * `workspace` / `.nextagent` / `generated-skills` are scope-level (shared
 * across runs in the same scope), so only `temp` carries a `runKey` segment.
 *
 * On Linux this effectively always succeeds, so the temp dir is reclaimed as
 * soon as the run finishes. On Windows a lingering file handle or antivirus
 * scan can still fail even with retries; in that case we log and leave the
 * dir for the 24h retention sweep (`execution-cleanup-jobs.ts`), which is
 * hardened with the same retry + per-entry isolation so it will eventually
 * remove it. A failure here MUST NOT break the terminal callback.
 */
async function cleanupRunTempDirectory(
  roots: ReadonlyArray<{ readonly kind: string; readonly access: string; readonly physicalPath: string }>,
): Promise<void> {
  const tempRoot = roots.find((root) => root.kind === 'temp' && root.access === 'readWrite');
  if (tempRoot === undefined) {
    return;
  }
  try {
    await rm(tempRoot.physicalPath, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
  } catch (error) {
    logger.warn(
      {
        event: 'execution.temp.cleanup_failed_on_terminal',
        path: tempRoot.physicalPath,
        errorName: error instanceof Error ? error.name : 'unknown',
        errorMessage: error instanceof Error ? error.message : String(error),
      },
      'failed to remove run temp directory on terminal; leaving it for the retention sweep',
    );
  }
}

const aiLogAnswerMaxChars = 1024;

/**
 * Assemble and report an AI log entry to CloudSop after a run reaches terminal state.
 * All terminal states (COMPLETED/FAILED/CANCELED) are reported. Fire-and-forget:
 * failures are caught by the caller and logged as warn.
 */
async function reportAiLog(
  port: OperationLogGatewayPort,
  messageStore: SessionMessageStoreGateway,
  command: SubmitRequestCommand,
  run: RequestRun,
  status: RunStatus,
  modelInfoByRun: Map<string, { models: Set<string>; hasKm: boolean }>,
): Promise<void> {
  const runKey = run.runId as string;
  const locale = resolveAuditLocale(process.env.OSS_LANG, command.locale);
  const modelInfo = modelInfoByRun.get(runKey);
  modelInfoByRun.delete(runKey);

  const resourceItems: string[] = [];
  if (modelInfo !== undefined) {
    for (const modelId of modelInfo.models) {
      resourceItems.push(modelId);
    }
    if (modelInfo.hasKm) {
      resourceItems.push('km');
    }
  }
  const resourceName = buildResourceName(resourceItems, locale);

  const messages = await messageStore.listCurrentRequestMessages({
    tenantId: command.identityContext.tenantId,
    subjectId: command.identityContext.subjectId,
    agentId: run.agentId,
    sessionId: run.sessionId,
    requestId: run.requestId,
    runId: run.runId,
    includeHidden: false,
    offset: 0,
    limit: 100,
  });

  let question = '';
  let answer = '';
  for (const msg of messages.items) {
    if (msg.role === 'USER') {
      question = msg.content;
    } else if (msg.role === 'ASSISTANT') {
      answer = msg.content;
    }
  }
  answer = truncate(answer, aiLogAnswerMaxChars);

  const detail = formatAiLogDetail(locale, run.sessionId as string, resourceName, question, answer);

  const requestHeaders = command.inputVariables?.['requestHeaders'] as Record<string, unknown> | undefined;
  const terminalIP = (requestHeaders?.['x-real-client-addr'] as string) ?? '';

  const entry: OperationLogEntry = {
    operation: locale === 'zh-CN' ? '创建对话资源访问详情' : 'Create chat resource access details',
    source: 'NextAgent',
    target: locale === 'zh-CN' ? '对话' : 'chat',
    detail,
    level: 'MINOR',
    result: status === 'COMPLETED' ? 'SUCCESSFUL' : 'FAILURE',
    tenantId: command.identityContext.tenantId,
    userName: command.identityContext.displayName,
    terminalIP,
    logType: 'OperationLog',
    systemLang: locale,
    show: true,
  };

  await port.writeAiLog(entry);
}
