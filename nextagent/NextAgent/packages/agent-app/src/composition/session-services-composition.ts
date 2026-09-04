import { brand, type AgentId, type AgentVersion, type EpochMillis } from '@nextagent/agent-common';
import type { AgentAssemblyRegistry } from '@nextagent/agent-contracts/agent-assembly';
import type { CapabilityCatalog } from '@nextagent/agent-contracts/capability';
import type { ModelSelectionService } from '@nextagent/agent-contracts/context';
import type { ModelInvocationService } from '@nextagent/agent-contracts/model';
import type { RuntimeSessionActivityPort } from '@nextagent/agent-contracts/runtime';
import {
  createCategoryQuestionCatalog,
  createCategoryQuestionService,
  createConversationAnnotationService,
  createConversationShareService,
  createPrecomputedSuggestedQuestionPort,
  createSessionFrequentQuestionService,
  createSessionActivityService,
  createSuggestedQuestionService,
  createUserSessionService,
  createLocalCapabilityDescriptionProvider,
  createRemoteCapabilityDescriptionProvider,
  type CapabilityDescriptionProvider,
  type CapabilityDescriptionSourceLocator,
} from '@nextagent/agent-session';
import { join } from 'node:path';
import type { createAgentPackageSourceLocator } from '../assembly/agent-package-source-locator.js';
import type { DefaultSystemConfig } from '../config/component-config.js';
import type { AppGatewayStores } from './composition-contracts.js';
import type { PortalAbilityConfigProvider } from './portal-ability-composition.js';
import { createPortalAbilitySuggestedQuestionGate } from './portal-ability-suggested-question-gate.js';

export interface SessionServicesComposition {
  readonly sessions: ReturnType<typeof createUserSessionService>;
  readonly sessionActivityService: ReturnType<typeof createSessionActivityService>;
  readonly runtimeSessionActivities: RuntimeSessionActivityPort;
  readonly annotationService: ReturnType<typeof createConversationAnnotationService>;
  readonly suggestedQuestions: ReturnType<typeof createPrecomputedSuggestedQuestionPort>;
  readonly categoryQuestions: ReturnType<typeof createCategoryQuestionService>;
  readonly frequentQuestions: ReturnType<typeof createSessionFrequentQuestionService>;
  readonly shareService: ReturnType<typeof createConversationShareService>;
}

export function composeSessionServicesLayer(input: {
  readonly systemConfig: DefaultSystemConfig;
  readonly gateway: AppGatewayStores;
  readonly clock: () => EpochMillis;
  readonly modelInvocationService: ModelInvocationService;
  readonly assemblyRegistry: AgentAssemblyRegistry;
  readonly modelSelectionService: ModelSelectionService;
  readonly catalog: CapabilityCatalog;
  readonly agentPackageSourceLocator: ReturnType<typeof createAgentPackageSourceLocator>;
  readonly portalAbilityConfigProvider: PortalAbilityConfigProvider;
  readonly questionRecommendations?: import('@nextagent/agent-contracts/gateway').QuestionRecommendationGateway;
}): SessionServicesComposition {
  const categoryQuestionCatalog = createCategoryQuestionCatalog({
    source: {
      async locateResourceDir(request) {
        const located = await input.agentPackageSourceLocator.locate(request);
        return located.status === 'found' ? join(located.agentPackageRoot, 'resource') : undefined;
      },
    },
  });
  const sessionActivityService = createSessionActivityService({
    sessions: input.gateway.sessions,
    requestRuns: input.gateway.requestRuns,
    pendingInputs: input.gateway.pendingInputs,
  });
  const sessions = createUserSessionService({
    sessionStore: input.gateway.sessions,
    messageStore: input.gateway.messages,
    sessionForkStore: input.gateway.sessionForks,
    activeContextStore: input.gateway.activeContext,
    invalidateDeletedSession: (coordinates) => sessionActivityService.invalidateDeletedSession(coordinates),
  });
  const annotationService = createConversationAnnotationService({
    annotationStore: input.gateway.conversationAnnotations,
    runStore: input.gateway.requestRuns,
    messageStore: input.gateway.messages,
    clock: input.clock,
  });
  const capabilityDescriptionProvider = createCapabilityDescriptionProvider(input.systemConfig, input.agentPackageSourceLocator);
  const suggestedQuestionService = createSuggestedQuestionService({
    model: input.modelInvocationService,
    assemblyRegistry: input.assemblyRegistry,
    modelSelectionService: input.modelSelectionService,
    catalog: input.catalog,
    requestRuns: input.gateway.requestRuns,
    messages: input.gateway.messages,
    timeline: input.gateway.timeline,
    capabilityDescriptionProvider,
  });
  const suggestedQuestions = createPortalAbilitySuggestedQuestionGate(
    createPrecomputedSuggestedQuestionPort(suggestedQuestionService),
    input.portalAbilityConfigProvider,
  );
  return {
    sessions,
    sessionActivityService,
    runtimeSessionActivities: createRuntimeSessionActivityPort(sessionActivityService, input.systemConfig.activeAgentId),
    annotationService,
    suggestedQuestions,
    categoryQuestions: createCategoryQuestionService({
      categoryCatalog: categoryQuestionCatalog,
      assemblyRegistry: input.assemblyRegistry,
    }),
    frequentQuestions: createSessionFrequentQuestionService({
      categoryCatalog: categoryQuestionCatalog,
      assemblyRegistry: input.assemblyRegistry,
      annotations: annotationService,
      questionRecommendations: input.questionRecommendations ?? input.gateway.questionRecommendations,
      deploymentMode: input.systemConfig.gateway.deploymentMode,
      activityStore: input.gateway.userQuestionActivity,
      frequencyThreshold: input.systemConfig.highFrequencyQuestion.frequencyThreshold,
    }),
    shareService: createConversationShareService({
      shareStore: input.gateway.conversationShares,
      messageStore: input.gateway.messages,
      runStore: input.gateway.requestRuns,
      clock: input.clock,
    }),
  };
}

export function createRuntimeSessionActivityPort(
  sessionActivityService: Pick<ReturnType<typeof createSessionActivityService>, 'streamActivities' | 'consumeTerminalActivity'>,
  agentId: AgentId,
): RuntimeSessionActivityPort {
  return {
    streamSessionActivities: ({ identityContext, signal }) =>
      sessionActivityService.streamActivities({
        identityContext,
        agentId,
        ...(signal === undefined ? {} : { signal }),
      }),
    consumeSessionActivity: ({ identityContext, sessionId, activityId, observedRunId }) =>
      sessionActivityService.consumeTerminalActivity({
        identityContext,
        agentId,
        sessionId,
        activityId,
        observedRunId,
      }),
  };
}

function createCapabilityDescriptionProvider(
  systemConfig: DefaultSystemConfig,
  agentPackageSourceLocator: ReturnType<typeof createAgentPackageSourceLocator>,
): CapabilityDescriptionProvider {
  const sourceLocator: CapabilityDescriptionSourceLocator = {
    async locate(input) {
      return agentPackageSourceLocator.locate({
        agentId: brand<string, 'AgentId'>(input.agentId),
        agentVersion: brand<string, 'AgentVersion'>('unknown'),
        agentAssemblyRef: 'unknown',
      });
    },
  };
  const options = {
    sourceLocator,
    activeAgentId: systemConfig.activeAgentId,
  };
  if (systemConfig.deployment.mode === 'LOCAL') {
    return createLocalCapabilityDescriptionProvider(options);
  }
  return createRemoteCapabilityDescriptionProvider(options);
}
