import { createHttpTaskCallbackDelivery, registerTaskChannel } from '@nextagent/agent-channel-task';
import { registerWebChannel } from '@nextagent/agent-channel-web';
import { IR_ROUTE_WHITELIST } from '@nextagent/agent-channel-web';
import { AgentError, brand, type IdentityContext, type JsonObject } from '@nextagent/agent-common';
import { readSkillMetadata } from '@nextagent/agent-capability';
import { defaultChatUploadFileConfig } from '@nextagent/agent-attachment-runtime';
import { createCapabilityPresentationResourceQueryPort, createSkillCatalogQueryPort } from '@nextagent/agent-core';
import type { AgentAssembly } from '@nextagent/agent-contracts/agent-assembly';
import type { ExecutionCorrelationPort } from '@nextagent/agent-contracts/observability';
import type { DefaultPromptTemplateRegistry } from '@nextagent/agent-context-engine';
import { createLongTermMemoryManagementService } from '@nextagent/agent-memory';
import type { OperationalLogWriter } from '@nextagent/agent-log';
import type { FastifyBaseLogger, FastifyRequest } from 'fastify';
import type { IncomingMessage } from 'node:http';
import type { CronTaskManagementPort } from '@nextagent/agent-contracts/channel';
import { createNextAgentFastifyServer } from '../server/fastify.js';
import type {
  AppSandboxGatewayPort,
  AppGatewayStores,
  TaskChannelRegistration,
  TaskChannelRegistrationFactory,
  TaskChannelRegistrationContext,
  TrustedLocalWebExtensionRegistration,
  WebChannelRegistration,
  WebChannelRegistrationFactory,
  WebChannelRegistrationContext,
  WebIdentityResolver,
} from './composition-contracts.js';
import type { BackgroundCapableSandboxPort, BackgroundTaskStoreGatewayPort, WatermarkGatewayPort } from '@nextagent/agent-contracts/gateway';

const udsCallbackOrigin = 'http://localhost';
const defaultPortalAbilityConfig = {
  suggestedQuestionsEnabled: true,
  cronTasksEnabled: true,
  longTermMemoryManagementEnabled: true,
  knowledgeImportEnabled: true,
  fullProcessEnabled: true,
};

export interface ChannelLayerComposition {
  readonly server: ReturnType<typeof createNextAgentFastifyServer>;
  readonly webChannelRegistration: WebChannelRegistration;
  readonly taskChannelRegistration: TaskChannelRegistration;
  readonly irChannelRegistration: WebChannelRegistration;
}

export type ChannelAuthProfile = 'DEFAULT_WEB' | 'LOCAL_CONFIGURED_AUTH';

export interface LocalConfiguredAuthChannelContribution {
  register: (input: {
    readonly context: WebChannelRegistrationContext;
    readonly protectedPathPrefixes?: readonly string[];
    readonly routePrefix?: string;
    readonly registerProtectedWebChannel: (server: WebChannelRegistrationContext['server'], identityResolver: WebIdentityResolver) => Promise<void>;
  }) => WebChannelRegistration;
}

export function composeProductChannelLayer(input: {
  readonly channelAuthProfile: ChannelAuthProfile;
  readonly webIdentityResolver?: WebIdentityResolver;
  readonly localConfiguredAuthContribution?: LocalConfiguredAuthChannelContribution;
  readonly webChannelRegistration?: WebChannelRegistrationFactory;
  readonly taskChannelRegistration?: TaskChannelRegistrationFactory;
  readonly trustedLocalWebExtensionRegistration?: TrustedLocalWebExtensionRegistration;
  readonly trustedLocalWebExtensionProtectedPrefixes?: readonly string[];
  readonly context: Omit<
    WebChannelRegistrationContext,
    | 'server'
    | 'longTermMemoryManagement'
    | 'cronTaskManagement'
    | 'backgroundTasks'
    | 'operationalLogActiveIdentity'
    | 'resolvePromptTemplate'
    | 'resolveAgentInventory'
  >;
  readonly promptTemplateRegistry: DefaultPromptTemplateRegistry;
  readonly agentAssemblies: readonly AgentAssembly[];
  readonly gateway: AppGatewayStores;
  readonly backgroundTasks?: BackgroundTaskStoreGatewayPort;
  readonly cronTaskManagement?: CronTaskManagementPort;
  readonly operationalLogWriter?: OperationalLogWriter;
  readonly traceEnabled: boolean;
  readonly executionCorrelation: ExecutionCorrelationPort;
}): ChannelLayerComposition {
  const accessLogger: FastifyBaseLogger | undefined = input.operationalLogWriter?.getServerAccessLogger?.({
    component: 'agent-channel-web',
    source: 'fastify',
  });
  const server = createNextAgentFastifyServer(accessLogger);
  const routePrefix = input.context.systemConfig.channel.routePrefix ?? '/';
  if (input.context.sessionActivities === undefined) {
    throw new AgentError({
      code: 'SESSION_ACTIVITY_PORT_REQUIRED',
      message: 'Session activity service is required.',
      category: 'UNAVAILABLE',
      retryable: false,
    });
  }
  const context: WebChannelRegistrationContext = {
    server,
    ...input.context,
    ...(input.context.systemConfig.memory.status === 'VALID'
      ? {
          longTermMemoryManagement: createLongTermMemoryManagementService({
            store: input.gateway.longTermMemoryStore,
            retriever: input.gateway.longTermMemoryRetriever,
            sharing: input.gateway.longTermMemorySharing,
            ...(input.context.gatewayBindings?.guardrail === undefined ? {} : { guardrail: input.context.gatewayBindings.guardrail }),
            ...(input.context.gatewayBindings?.userQuery === undefined ? {} : { userQuery: input.context.gatewayBindings.userQuery }),
          }),
        }
      : {}),
    ...(input.backgroundTasks === undefined ? {} : { backgroundTasks: input.backgroundTasks }),
    ...(input.cronTaskManagement === undefined ? {} : { cronTaskManagement: input.cronTaskManagement }),
    ...(input.operationalLogWriter === undefined ? {} : { operationalLogActiveIdentity: () => input.operationalLogWriter?.activeIdentity() }),
    resolvePromptTemplate: async (query) => {
      const template = input.promptTemplateRegistry
        .templatesFor(query.agentId, query.agentVersion)
        .find((candidate) => candidate.templateRef === query.promptTemplateRef);
      return template === undefined ? undefined : (JSON.parse(JSON.stringify(template)) as JsonObject);
    },
    resolveAgentInventory: async () => JSON.parse(JSON.stringify(input.agentAssemblies)) as JsonObject[],
  };
  try {
    const webChannelRegistration =
      input.channelAuthProfile === 'LOCAL_CONFIGURED_AUTH'
        ? registerLocalConfiguredAuthChannel(input, context, routePrefix)
        : registerProductWebChannel(
            input.webChannelRegistration,
            input.trustedLocalWebExtensionRegistration,
            context,
            input.webIdentityResolver,
            routePrefix,
          );
    return {
      server,
      webChannelRegistration,
      taskChannelRegistration: registerProductTaskChannel(input.taskChannelRegistration, {
        server,
        runtimeCommands: context.runtimeCommands,
        runtime: context.runtime,
        attachmentRuntime: context.attachmentRuntime,
        systemConfig: context.systemConfig,
        identityResolver: createTaskIdentityResolver(context.identity),
        traceEnabled: input.traceEnabled,
        executionCorrelation: input.executionCorrelation,
      }),
      irChannelRegistration: registerIrWebChannel(context, routePrefix),
    };
  } catch (error) {
    void server.close().catch(() => undefined);
    throw error;
  }
}

function registerLocalConfiguredAuthChannel(
  input: Parameters<typeof composeProductChannelLayer>[0],
  context: WebChannelRegistrationContext,
  routePrefix: string,
): WebChannelRegistration {
  const contribution = input.localConfiguredAuthContribution;
  if (contribution === undefined) {
    throw new AgentError({
      code: 'LOCAL_AUTH_CONTRIBUTION_REQUIRED',
      message: 'Local configured auth channel contribution is required.',
      category: 'VALIDATION',
      retryable: false,
    });
  }
  return contribution.register({
    context,
    ...(input.trustedLocalWebExtensionProtectedPrefixes === undefined
      ? {}
      : { protectedPathPrefixes: input.trustedLocalWebExtensionProtectedPrefixes }),
    routePrefix,
    registerProtectedWebChannel: async (server, identityResolver) => {
      registerLocalConfiguredProtectedWebChannel({ ...context, server }, identityResolver, routePrefix);
      await input.trustedLocalWebExtensionRegistration?.({ ...context, server, identityResolver });
    },
  });
}

function registerLocalConfiguredProtectedWebChannel(
  context: WebChannelRegistrationContext,
  identityResolver: WebIdentityResolver,
  routePrefix: string,
): void {
  registerWebChannel(context.server, {
    capabilityResultPresentationPolicy: context.systemConfig.capabilityResultPresentationPolicy,
    runtime: context.runtimeCommands,
    sessions: context.runtime,
    sessionActivities: context.sessionActivities,
    identityResolver,
    executionCorrelation: context.executionCorrelation,
    runtimeBootstrap: { transportKind: 'SSE', portalAbilityConfig: defaultPortalAbilityConfig },
    ...(context.portalAbilityConfigProvider === undefined ? {} : { portalAbilityConfigProvider: context.portalAbilityConfigProvider }),
    skillCatalog: createSkillCatalogQueryPort({
      assemblyRegistry: context.assemblyRegistry,
      catalog: context.catalog,
      defaultAgentId: context.systemConfig.activeAgentId,
      readSkillMetadata,
    }),
    capabilityPresentationResources: createCapabilityPresentationResourceQueryPort({
      assemblyRegistry: context.assemblyRegistry,
      currentView: context.capabilityCurrentView,
    }),
    suggestedQuestions: context.suggestedQuestions,
    annotations: context.annotationService,
    defaultAgentId: context.systemConfig.activeAgentId,
    routePrefix,
    ...(context.cronTaskManagement === undefined ? {} : { cronTaskManagement: context.cronTaskManagement }),
  });
}

export function registerProductWebChannel(
  registration: WebChannelRegistrationFactory | undefined,
  trustedLocalExtension: TrustedLocalWebExtensionRegistration | undefined,
  context: WebChannelRegistrationContext,
  webIdentityResolver?: WebIdentityResolver,
  routePrefix: string = '/',
): WebChannelRegistration {
  if (registration !== undefined) {
    return registration(context) ?? {};
  }
  const effectiveResolver = webIdentityResolver ?? (() => context.identity);
  const registrationResult = registerTrustedIdentityWebChannel(context, effectiveResolver, routePrefix);
  const extensionReady = trustedLocalExtension?.({
    ...context,
    identityResolver: effectiveResolver,
  });
  return extensionReady === undefined
    ? registrationResult
    : {
        ready: async () => {
          await registrationResult.ready?.();
          await extensionReady;
        },
      };
}

function registerTrustedIdentityWebChannel(
  context: WebChannelRegistrationContext,
  identityResolver: WebIdentityResolver = () => context.identity,
  routePrefix: string = '/',
): WebChannelRegistration {
  const stagedUploadRuntime = context.stagedUploadRuntime;
  if (stagedUploadRuntime === undefined) {
    throw new AgentError({
      code: 'ATTACHMENT_STAGING_UNAVAILABLE',
      message: 'Attachment staged-upload runtime is unavailable.',
      category: 'UNAVAILABLE',
      retryable: false,
    });
  }
  registerWebChannel(context.server, {
    capabilityResultPresentationPolicy: context.systemConfig.capabilityResultPresentationPolicy,
    runtime: context.runtimeCommands,
    sessions: context.runtime,
    sessionActivities: context.sessionActivities,
    identityResolver,
    executionCorrelation: context.executionCorrelation,
    runtimeBootstrap: {
      transportKind: 'SSE',
      portalAbilityConfig: defaultPortalAbilityConfig,
      ...(context.chatUploadConfigProvider !== undefined
        ? {}
        : { chatUploadFileConfig: context.chatUploadFileConfig ?? defaultChatUploadFileConfig() }),
      ...(context.gatewayBindings?.guardrail === undefined ? {} : { guardrail: { enabled: true } }),
    },
    routePrefix,
    stagedUploadRuntime,
    ...(context.fileDownloadRuntime === undefined ? {} : { fileDownloadRuntime: context.fileDownloadRuntime }),
    ...(context.chatUploadConfigProvider !== undefined
      ? { chatUploadConfigProvider: context.chatUploadConfigProvider }
      : { chatUploadFileConfig: context.chatUploadFileConfig ?? defaultChatUploadFileConfig() }),
    ...(context.portalAbilityConfigProvider === undefined ? {} : { portalAbilityConfigProvider: context.portalAbilityConfigProvider }),
    ...(context.attachmentSummaryResolver === undefined ? {} : { attachmentSummaryResolver: context.attachmentSummaryResolver }),
    health: context.health,
    skillCatalog: createSkillCatalogQueryPort({
      assemblyRegistry: context.assemblyRegistry,
      catalog: context.catalog,
      defaultAgentId: context.systemConfig.activeAgentId,
      readSkillMetadata,
    }),
    capabilityPresentationResources: createCapabilityPresentationResourceQueryPort({
      assemblyRegistry: context.assemblyRegistry,
      currentView: context.capabilityCurrentView,
    }),
    suggestedQuestions: context.suggestedQuestions,
    categoryQuestions: context.categoryQuestions,
    annotations: context.annotationService,
    shares: context.shareService,
    defaultAgentId: context.systemConfig.activeAgentId,
    ...(context.longTermMemoryManagement === undefined ? {} : { longTermMemoryManagement: context.longTermMemoryManagement }),
    ...(context.cronTaskManagement === undefined ? {} : { cronTaskManagement: context.cronTaskManagement }),
    ...(context.frequentQuestions === undefined ? {} : { frequentQuestions: context.frequentQuestions }),
    ...(context.backgroundTasks !== undefined && context.sandboxGateway !== undefined && isBackgroundCapable(context.sandboxGateway)
      ? { backgroundTasks: adaptBackgroundTaskViewPort(context.backgroundTasks, context.sandboxGateway) }
      : {}),
    ...(context.gatewayBindings?.guardrail === undefined
      ? {}
      : { guardrail: context.gatewayBindings.guardrail, guardrailEnabled: true, guardLocale: context.guardLocale }),
    ...(context.gatewayBindings?.watermark === undefined || context.getWatermarkEnabled === undefined
      ? {}
      : { watermark: adaptWatermarkGatewayPort(context.gatewayBindings.watermark), getWatermarkEnabled: context.getWatermarkEnabled }),
  });
  return {};
}

function isBackgroundCapable(gateway: AppSandboxGatewayPort): gateway is BackgroundCapableSandboxPort {
  return (
    typeof (gateway as { killBackground?: unknown }).killBackground === 'function' &&
    typeof (gateway as { startBackground?: unknown }).startBackground === 'function'
  );
}

function adaptWatermarkGatewayPort(port: WatermarkGatewayPort) {
  return {
    async applyWatermark(content: string, signal?: AbortSignal): Promise<string> {
      const result = await port.embedWatermark({ text: content }, signal);
      if (!result.success) {
        throw new Error(`watermark service rejected: ${result.errorCode} ${result.errorDesc}`.trim());
      }
      return result.watermarkedText;
    },
  };
}

function adaptBackgroundTaskViewPort(store: BackgroundTaskStoreGatewayPort, sandboxGateway: BackgroundCapableSandboxPort) {
  return {
    async list(sessionId: import('@nextagent/agent-common').SessionId) {
      const records = await store.list(sessionId);
      return records.map((record) => ({
        taskId: record.taskId,
        commandName: record.commandName,
        ...(record.commandLine === undefined ? {} : { commandLine: record.commandLine }),
        status: record.status,
        startedAt: record.startedAt,
        ...(record.finishedAt === undefined ? {} : { finishedAt: record.finishedAt }),
        ...(record.exitCode === undefined ? {} : { exitCode: record.exitCode }),
        stdoutRef: record.stdoutRef,
        stderrRef: record.stderrRef,
      }));
    },
    async readOutput(sessionId: import('@nextagent/agent-common').SessionId, taskId: string, stream: 'stdout' | 'stderr', limitBytes: number) {
      const record = await store.get(taskId);
      if (record === undefined || record.sessionId !== sessionId || record.workspaceRoot === undefined) {
        return { unavailable: true as const };
      }
      const ref = stream === 'stdout' ? record.stdoutRef : record.stderrRef;
      const { readFile } = await import('node:fs/promises');
      try {
        const buffer = await readFile(`${record.workspaceRoot}/${ref}`);
        if (buffer.length <= limitBytes) {
          return { content: decodeOutput(buffer), truncated: false };
        }
        return { content: decodeOutput(buffer.subarray(0, limitBytes)), truncated: true };
      } catch {
        return { content: '', truncated: false };
      }
    },
    async kill(sessionId: import('@nextagent/agent-common').SessionId, taskId: string) {
      const record = await store.get(taskId);
      if (record === undefined || record.sessionId !== sessionId) {
        return { status: 'NOT_FOUND' as const };
      }
      if (record.status !== 'RUNNING') {
        return { status: 'ALREADY_TERMINAL' as const };
      }
      const result = await sandboxGateway.killBackground(taskId);
      if (!result.killed) {
        return { status: 'ALREADY_TERMINAL' as const };
      }
      const { brand } = await import('@nextagent/agent-common');
      await store.markKilled(taskId, { finishedAt: brand<number, 'EpochMillis'>(Date.now()) });
      // No chat notification — kill status is shown in the background-task panel.
      return { status: 'KILLED' as const };
    },
  };
}

const utf8DecoderFatal = new TextDecoder('utf-8', { fatal: true });
function decodeOutput(buffer: Uint8Array): string {
  try {
    return utf8DecoderFatal.decode(buffer);
  } catch {
    try {
      return new TextDecoder('gbk').decode(buffer);
    } catch {
      return new TextDecoder('utf-8').decode(buffer);
    }
  }
}

function registerIrWebChannel(context: WebChannelRegistrationContext, routePrefix: string = '/'): WebChannelRegistration {
  registerWebChannel(context.server, {
    capabilityResultPresentationPolicy: context.systemConfig.capabilityResultPresentationPolicy,
    runtime: context.runtimeCommands,
    sessions: context.runtime,
    identityResolver: createTaskIdentityResolver(context.identity),
    executionCorrelation: context.executionCorrelation,
    runtimeBootstrap: { transportKind: 'SSE', portalAbilityConfig: defaultPortalAbilityConfig },
    ...(context.portalAbilityConfigProvider === undefined ? {} : { portalAbilityConfigProvider: context.portalAbilityConfigProvider }),
    skillCatalog: createSkillCatalogQueryPort({
      assemblyRegistry: context.assemblyRegistry,
      catalog: context.catalog,
      defaultAgentId: context.systemConfig.activeAgentId,
      readSkillMetadata,
    }),
    defaultAgentId: context.systemConfig.activeAgentId,
    routePrefix,
    apiSubNamespace: 'ir',
    routeWhitelist: IR_ROUTE_WHITELIST,
    ...(context.gatewayBindings?.guardrail === undefined
      ? {}
      : { guardrail: context.gatewayBindings.guardrail, guardrailEnabled: true, guardLocale: context.guardLocale }),
    ...(context.gatewayBindings?.watermark === undefined || context.getWatermarkEnabled === undefined
      ? {}
      : { watermark: adaptWatermarkGatewayPort(context.gatewayBindings.watermark), getWatermarkEnabled: context.getWatermarkEnabled }),
  });
  return {};
}

export function registerProductTaskChannel(
  registration: TaskChannelRegistrationFactory | undefined,
  context: TaskChannelRegistrationContext,
): TaskChannelRegistration {
  if (registration !== undefined) {
    return registration(context) ?? {};
  }
  return registerTrustedIdentityTaskChannel(context);
}

function registerTrustedIdentityTaskChannel(context: TaskChannelRegistrationContext): TaskChannelRegistration {
  const taskCallback = context.systemConfig.taskCallback;
  const isRemote = context.systemConfig.deployment.mode === 'REMOTE';
  const effectiveSocketPath = taskCallback.socketPath ?? (isRemote ? context.systemConfig.channel.udsPath : undefined);
  const hasUdsSocket = effectiveSocketPath !== undefined;
  const allowedOrigins = taskCallback.allowedOrigins.length === 0 && isRemote && hasUdsSocket ? [udsCallbackOrigin] : taskCallback.allowedOrigins;
  const tlsInsecure = taskCallback.tlsInsecure === true;
  const callbackDelivery =
    allowedOrigins.length === 0
      ? {}
      : {
          callbackDeliveryPort: createHttpTaskCallbackDelivery(
            effectiveSocketPath === undefined
              ? { allowedOrigins, ...(tlsInsecure ? { tlsInsecure } : {}) }
              : { allowedOrigins, socketPath: effectiveSocketPath, udsOrigin: udsCallbackOrigin, ...(tlsInsecure ? { tlsInsecure } : {}) },
          ),
          callbackDeliveryOptions: {
            timeoutMs: taskCallback.timeoutMs,
            maxRetries: taskCallback.maxRetries,
          },
        };
  void registerTaskChannel(context.server, {
    runtime: context.runtimeCommands,
    sessions: context.runtime,
    attachmentRuntime: context.attachmentRuntime,
    identityResolver: context.identityResolver,
    traceEnabled: context.traceEnabled,
    executionCorrelation: context.executionCorrelation,
    routePrefix: context.systemConfig.channel.routePrefix ?? '/',
    ...callbackDelivery,
  });
  return {};
}

export function createTaskIdentityResolver(defaultIdentity: IdentityContext): WebIdentityResolver {
  const headerTenantId = 'x-tenant-id';
  const headerSubjectId = 'x-subject-id';
  const headerDisplayName = 'x-display-name';
  return (request: FastifyRequest | IncomingMessage) => {
    const headers = request.headers;
    const tenantId = readHeader(headers, headerTenantId);
    const subjectId = readHeader(headers, headerSubjectId);
    const displayName = readHeader(headers, headerDisplayName);
    if (tenantId === undefined || subjectId === undefined) {
      throw new AgentError({ code: 'LOCAL_AUTH_REQUIRED', message: 'Identity headers are required.', category: 'AUTHORIZATION', retryable: false });
    }
    return {
      tenantId: brand<string, 'TenantId'>(tenantId),
      subjectId: brand<string, 'SubjectId'>(subjectId),
      displayName: displayName ?? defaultIdentity.displayName,
    };
  };
}

function readHeader(headers: Record<string, string | string[] | undefined>, name: string): string | undefined {
  const value = headers[name.toLowerCase()];
  return Array.isArray(value) ? value[0] : value;
}
