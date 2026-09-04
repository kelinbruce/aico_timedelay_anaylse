import { brand, type AttachmentId, type IdentityContext } from '@nextagent/agent-common';
import type { BlobStoreGateway } from '@nextagent/agent-contracts/gateway';
import { mkdir, rm } from 'node:fs/promises';
import { basename, join } from 'node:path';

export interface AttachmentExecutionReference {
  readonly attachmentId: AttachmentId;
  readonly fileName: string;
  readonly storageRef: string;
}

export interface AttachmentExecutionRuntime {
  materialize: (input: {
    readonly identityContext: IdentityContext;
    readonly attachments: readonly AttachmentExecutionReference[];
    readonly attachmentsDirectory: string;
  }) => Promise<readonly string[]>;
  cleanup: (input: { readonly attachmentsDirectory: string }) => Promise<void>;
}

export function createAttachmentExecutionRuntime(input: { readonly blobStore: BlobStoreGateway }): AttachmentExecutionRuntime {
  return {
    async materialize(request) {
      const paths: string[] = [];
      try {
        for (const attachment of request.attachments) {
          const targetDirectory = join(request.attachmentsDirectory, attachment.attachmentId);
          const localFilePath = join(targetDirectory, basename(attachment.fileName));
          await mkdir(targetDirectory, { recursive: true });
          const materialized = await input.blobStore.materializeBlob({
            tenantId: request.identityContext.tenantId,
            subjectId: request.identityContext.subjectId,
            blobRef: brand<string, 'BlobRef'>(attachment.storageRef),
            localFilePath,
          });
          if (materialized !== true) {
            throw new Error('Attachment blob is unavailable.');
          }
          paths.push(localFilePath);
        }
        return paths;
      } catch (error) {
        await rm(request.attachmentsDirectory, { recursive: true, force: true }).catch(() => {});
        throw error;
      }
    },
    async cleanup(request) {
      await rm(request.attachmentsDirectory, { recursive: true, force: true });
    },
  };
}
