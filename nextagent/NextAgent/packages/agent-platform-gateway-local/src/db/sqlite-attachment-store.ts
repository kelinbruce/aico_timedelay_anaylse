import type {
  AttachmentIntakeReservationGateway,
  AttachmentIntakeReservationRecord,
  AttachmentIntakeReservationResult,
  AttachmentStoreGateway,
  BlobStoreGateway,
  CompleteAttachmentIntakeReservationRequest,
  CopyBlobRequest,
  CopyBlobResult,
  BlobMetadataRequest,
  BlobMetadata,
  ListBlobsRequest,
  ListBlobsResult,
  DeleteBlobRequest,
  ListAttachmentsByRequestIdRequest,
  ListAttachmentsByRunIdRequest,
  ListAttachmentsBySessionRequest,
  LoadAttachmentRequest,
  LoadBlobRequest,
  MaterializeBlobRequest,
  RequestAttachmentRecord,
  ReserveAttachmentIntakeRequest,
  StoreBlobRequest,
  UpdateAttachmentStatusRequest,
} from '@nextagent/agent-contracts/gateway';
import type { BlobRef } from '@nextagent/agent-common';
import type { SqliteGatewayCore } from './sqlite-gateway-core.js';

export class SqliteAttachmentStore implements AttachmentStoreGateway, AttachmentIntakeReservationGateway, BlobStoreGateway {
  constructor(private readonly core: SqliteGatewayCore) {}

  async saveAttachment(record: RequestAttachmentRecord): Promise<RequestAttachmentRecord> {
    return this.core.saveAttachment(record);
  }

  async loadAttachment(request: LoadAttachmentRequest): Promise<RequestAttachmentRecord | undefined> {
    return this.core.loadAttachment(request);
  }

  async listAttachmentsByRequestId(request: ListAttachmentsByRequestIdRequest): Promise<readonly RequestAttachmentRecord[]> {
    return this.core.listAttachmentsByRequestId(request);
  }

  async listAttachmentsByRunId(request: ListAttachmentsByRunIdRequest): Promise<readonly RequestAttachmentRecord[]> {
    return this.core.listAttachmentsByRunId(request);
  }

  async listAttachmentsBySession(request: ListAttachmentsBySessionRequest): Promise<readonly RequestAttachmentRecord[]> {
    return this.core.listAttachmentsBySession(request);
  }

  async updateAttachmentStatus(request: UpdateAttachmentStatusRequest): Promise<RequestAttachmentRecord | undefined> {
    return this.core.updateAttachmentStatus(request);
  }

  async reserveAttachmentIntake(request: ReserveAttachmentIntakeRequest): Promise<AttachmentIntakeReservationResult> {
    return this.core.reserveAttachmentIntake(request);
  }

  async completeAttachmentIntakeReservation(
    request: CompleteAttachmentIntakeReservationRequest,
  ): Promise<AttachmentIntakeReservationRecord | undefined> {
    return this.core.completeAttachmentIntakeReservation(request);
  }

  async storeBlob(request: StoreBlobRequest): Promise<BlobRef> {
    return this.core.storeBlob(request);
  }

  async loadBlob(request: LoadBlobRequest): Promise<Uint8Array | undefined> {
    return this.core.loadBlob(request);
  }

  async materializeBlob(request: MaterializeBlobRequest): Promise<boolean> {
    return this.core.materializeBlob(request);
  }

  async blobExists(request: LoadBlobRequest): Promise<boolean> {
    return this.core.blobExists(request);
  }

  async deleteBlob(request: DeleteBlobRequest): Promise<boolean> {
    return this.core.deleteBlob(request);
  }

  async copyBlob(request: CopyBlobRequest): Promise<CopyBlobResult> {
    return this.core.copyBlob(request);
  }

  async getBlobMetadata(request: BlobMetadataRequest): Promise<BlobMetadata | undefined> {
    return this.core.getBlobMetadata(request);
  }

  async listBlobs(request: ListBlobsRequest): Promise<ListBlobsResult> {
    return this.core.listBlobs(request);
  }
}
