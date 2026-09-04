import {
  cleanupUploadTempAtStartup,
  createLocalChatUploadConfigProvider,
  createRemoteChatUploadConfigProvider,
  createUploadTempCleanupJob,
  createAttachmentStagedUploadRuntime,
  createAttachmentExecutionRuntime,
  createAttachmentSummaryResolver,
  createAttachmentCleanupRuntime,
  createAttachmentIntakeRuntime,
  createAttachmentLifecycleDiagnostics,
  createFileDownloadRuntime,
  createDownloadTempCleanupJob,
  cleanupDownloadTempAtStartup,
  DownloadConcurrencyLimiter,
  DownloadTempSizeGuard,
  defaultChatUploadFileConfig,
  type AttachmentExecutionRuntime,
  type AttachmentSummaryResolver,
  type AttachmentStagedUploadRuntime,
  type AttachmentCleanupRuntime,
  type AttachmentIntakeRuntime,
  type FileDownloadRuntime,
} from '@nextagent/agent-attachment-runtime';
import type { ChatUploadFileConfig as InternalChatUploadFileConfig } from '@nextagent/agent-attachment-runtime';
import type { ChatUploadConfigProviderPort } from '@nextagent/agent-channel-web';
import type { EpochMillis } from '@nextagent/agent-common';
import { createObservationEvent, type ObservabilityProjectorHost, type TrustedOwnerScope } from '@nextagent/agent-observability';

import type { AppGatewayStores } from './composition-contracts.js';
import { mkdir } from 'node:fs/promises';
import { createAgentPackageRootLocator } from '../assembly/agent-package-source-locator.js';
import type { DefaultSystemConfig } from '../config/component-config.js';

export interface PreparedAttachmentComposition {
  readonly chatUploadFileConfig?: InternalChatUploadFileConfig;
  readonly chatUploadConfigProvider?: ChatUploadConfigProviderPort;
}

export function preloadAttachmentCompositionSync(input: {
  readonly chatUploadFileConfig?: InternalChatUploadFileConfig;
  readonly chatUploadConfigProvider?: ChatUploadConfigProviderPort;
}): PreparedAttachmentComposition {
  return {
    chatUploadFileConfig: input.chatUploadFileConfig ?? defaultChatUploadFileConfig(),
    ...(input.chatUploadConfigProvider === undefined ? {} : { chatUploadConfigProvider: input.chatUploadConfigProvider }),
  };
}

export async function preloadAttachmentCompositionAsync(input: {
  readonly systemConfig: DefaultSystemConfig;
  readonly chatUploadFileConfig?: InternalChatUploadFileConfig;
  readonly chatUploadConfigProvider?: ChatUploadConfigProviderPort;
}): Promise<PreparedAttachmentComposition> {
  const chatUploadConfigProvider =
    input.chatUploadConfigProvider ??
    (input.chatUploadFileConfig !== undefined
      ? createStaticChatUploadConfigProvider(input.chatUploadFileConfig)
      : createChatUploadConfigProviderFromSystemConfig(input.systemConfig));
  await mkdir(input.systemConfig.paths.uploadTempDir, { recursive: true }).catch(() => {});
  await mkdir(input.systemConfig.paths.downloadTempDir, { recursive: true }).catch(() => {});
  await cleanupUploadTempAtStartup(input.systemConfig.paths.uploadTempDir).catch(() => {});
  await cleanupDownloadTempAtStartup(input.systemConfig.paths.downloadTempDir).catch(() => {});
  return { chatUploadConfigProvider };
}

function createChatUploadConfigProviderFromSystemConfig(systemConfig: DefaultSystemConfig): ChatUploadConfigProviderPort {
  const rootLocator = createAgentPackageRootLocator(systemConfig);
  const options = {
    sourceLocator: {
      async locate(input: { readonly agentId: string }) {
        return rootLocator.locate(input.agentId);
      },
    },
    activeAgentId: systemConfig.activeAgentId,
  };
  if (systemConfig.deployment.mode === 'LOCAL') {
    return createLocalChatUploadConfigProvider(options);
  }
  return createRemoteChatUploadConfigProvider(options);
}

function createStaticChatUploadConfigProvider(config: InternalChatUploadFileConfig): ChatUploadConfigProviderPort {
  return { get: () => Promise.resolve(config) };
}

export interface AttachmentLayerComposition {
  readonly attachmentRuntime: AttachmentIntakeRuntime;
  readonly attachmentCleanupRuntime: AttachmentCleanupRuntime;
  readonly attachmentExecutionRuntime: AttachmentExecutionRuntime;
  readonly stagedUploadRuntime: AttachmentStagedUploadRuntime;
  readonly fileDownloadRuntime: FileDownloadRuntime;
  readonly attachmentSummaryResolver?: AttachmentSummaryResolver;
}

export function composeAttachmentLayer(input: {
  readonly gateway: AppGatewayStores;
  readonly clock: () => EpochMillis;
  readonly projectorHost: ObservabilityProjectorHost;
  readonly defaultRouteOwnerScope: TrustedOwnerScope;
  readonly uploadTempDir: string;
  readonly downloadTempDir: string;
  readonly scheduledMaintenance: {
    register: (job: ReturnType<typeof createUploadTempCleanupJob>) => void;
  };
}): AttachmentLayerComposition {
  const attachmentDiagnostics = createAttachmentLifecycleDiagnostics({
    createObservationEvent,
  });
  const stagedUploadRuntime = createAttachmentStagedUploadRuntime({
    blobStore: input.gateway.blobs,
    attachmentStore: input.gateway.attachments,
    uploadTempDir: input.uploadTempDir,
    clock: input.clock,
  });
  const attachmentExecutionRuntime = createAttachmentExecutionRuntime({
    blobStore: input.gateway.blobs,
  });
  const downloadSizeGuard = new DownloadTempSizeGuard();
  const downloadConcurrencyLimiter = new DownloadConcurrencyLimiter();
  const fileDownloadRuntime = createFileDownloadRuntime({
    blobStore: input.gateway.blobs,
    downloadTempDir: input.downloadTempDir,
    sizeGuard: downloadSizeGuard,
    concurrencyLimiter: downloadConcurrencyLimiter,
    clock: input.clock,
  });
  const attachmentSummaryResolver = createAttachmentSummaryResolver(input.gateway.attachments);
  input.scheduledMaintenance.register(createUploadTempCleanupJob({ uploadTempDir: input.uploadTempDir }));
  input.scheduledMaintenance.register(createDownloadTempCleanupJob({ downloadTempDir: input.downloadTempDir }));
  return {
    attachmentRuntime: createAttachmentIntakeRuntime({
      blobStore: input.gateway.blobs,
      uploadTempDir: input.uploadTempDir,
      attachmentStore: input.gateway.attachments,
      reservationGateway: input.gateway.attachmentReservations,
      clock: input.clock,
      outcomeObserver: (event) =>
        input.projectorHost.acceptObservation(attachmentDiagnostics.createIntakeObservation(event, input.defaultRouteOwnerScope)),
    }),
    attachmentCleanupRuntime: createAttachmentCleanupRuntime({
      attachmentStore: input.gateway.attachments,
      blobStore: input.gateway.blobs,
      messageStore: input.gateway.messages,
      clock: input.clock,
      outcomeObserver: (event) =>
        input.projectorHost.acceptObservation(attachmentDiagnostics.createCleanupObservation(event, input.defaultRouteOwnerScope)),
    }),
    attachmentExecutionRuntime,
    stagedUploadRuntime,
    fileDownloadRuntime,
    attachmentSummaryResolver,
  };
}
