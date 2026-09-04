import type { AgentId, AttachmentId, AttachmentMediaType, SubjectId, TenantId } from '@nextagent/agent-common';
import type { AttachmentStoreGateway } from '@nextagent/agent-contracts/gateway';

export interface AttachmentSummaryResolver {
  loadAttachment: (request: {
    readonly tenantId: TenantId;
    readonly subjectId: SubjectId;
    readonly agentId: AgentId;
    readonly attachmentId: AttachmentId;
  }) => Promise<
    | {
        readonly fileName: string;
        readonly mediaType: AttachmentMediaType;
        readonly sizeBytes: number;
      }
    | undefined
  >;
}

export function createAttachmentSummaryResolver(attachmentStore: AttachmentStoreGateway): AttachmentSummaryResolver {
  return {
    async loadAttachment(request) {
      const record = await attachmentStore.loadAttachment(request).catch(() => undefined);
      if (record === undefined) {
        return undefined;
      }
      return { fileName: record.fileName, mediaType: record.mediaType, sizeBytes: record.sizeBytes };
    },
  };
}
