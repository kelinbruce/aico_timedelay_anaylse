# ts-attachment-remote-upload Specification

## Purpose
Define the storage-mode-agnostic unified staged upload lifecycle for file attachments: phase 1 temp upload, phase 2 submit-finalize, validation pipeline, frequency limits, temp file deletion, and cleanup.

## Function

- **所属 Function**：`FN-8.5 上传和管理附件`
- **spec 角色**：主规格

## Requirements

### Requirement: Attachment upload API is storage-mode agnostic
The Web channel attachment upload API MUST NOT expose LOCAL versus REMOTE storage mode as different client workflows. All deployments MUST use the same staged-upload lifecycle: upload file bytes to a server-owned temporary attachment location, delete unsubmitted temporary files through a backend API, and submit requests with staged attachment references. Storage-mode differences MUST be isolated behind `BlobStoreGateway` or an equivalent attachment storage adapter.

#### Scenario: Client uses one upload flow in all storage modes
- **WHEN** the frontend allows a user to attach a file
- **THEN** the frontend MUST call the same staged upload endpoint regardless of local or remote storage
- **AND** the frontend MUST NOT switch to request-submit multipart because HOFS is absent
- **AND** the frontend MUST NOT inspect `hofsBucketName` to choose a different upload protocol

#### Scenario: Storage implementation is selected below attachment runtime
- **WHEN** the staged upload runtime stores a temporary file
- **THEN** local storage MUST write under the local system data blob/temp area
- **AND** remote storage MAY write to HOFS or another remote blob backend
- **AND** the Web channel request shape MUST remain the same

### Requirement: Unified staged upload and submit-finalize lifecycle
The system MUST support a unified staged upload lifecycle in all storage modes. Phase 1 uploads a single complete file to a temporary storage object and returns a storage-opaque staged reference. Phase 2 submits a request with staged attachment references and finalizes each staged file into a request/run-scoped formal attachment record before calling runtime submit.

#### Scenario: Stage upload stores file in temp storage
- **WHEN** the user selects a file
- **THEN** the frontend MUST call `POST /api/v1/sessions/:sessionId/files/upload` with multipart file bytes and a frontend-generated `tempRunId`
- **AND** the backend MUST validate and store the file as a temporary object
- **AND** the response MUST contain `tempRunId`, `fileName`, and `sizeBytes`
- **AND** the response MUST NOT contain local filesystem paths, HOFS paths, or raw `storageRef`

#### Scenario: Submit finalizes staged attachment references
- **WHEN** the user sends a question with uploaded files
- **THEN** the request body MUST be JSON with `inputText`, `idempotencyKey`, and `attachments: [{ tempRunId, fileName }]`
- **AND** the backend MUST finalize each staged file into a formal request/run-scoped object
- **AND** the backend MUST create `RequestAttachmentRecord` with owner scope, agent scope, request/run coordinates, safe file metadata, and formal `storageRef`
- **AND** runtime MUST receive only `attachmentIds`, not file bytes or staged upload coordinates

#### Scenario: Finalize failure fails the entire request
- **WHEN** any staged file cannot be finalized
- **THEN** the entire request MUST fail
- **AND** the backend MUST return a safe user-facing error
- **AND** the backend MUST NOT create partial attachment records for the failed request

### Requirement: Upload validation is shared across storage modes
Staged upload MUST enforce one shared validation pipeline from cheapest to most expensive: global concurrency limit, file name validation, extension match against effective config, single file size limit, upload frequency limit, per-session cumulative quota, per-user cumulative quota, user temporary quota plus global upload-temp limit, streaming to local upload temp with disk-space protection, file content security validation, and storage through `BlobStoreGateway`. Any check failure MUST reject the upload with a safe error. The pipeline MUST short-circuit on first failure.

#### Scenario: First file exceeds single file size limit
- **WHEN** a user uploads a file that exceeds the effective `chat-upload-max-file-size`
- **THEN** the upload MUST be rejected before writing a formal attachment
- **AND** the error message MUST indicate the size limit

#### Scenario: No-config backend default accepts markdown family only
- **WHEN** no `chat-upload-file-type` config is present
- **THEN** backend extension validation MUST accept `.md` and `.markdown` uploads
- **AND** backend extension validation MUST reject any other extension with a safe error
- **AND** a configured `chat-upload-file-type` list MUST fully replace this default instead of merging with it

#### Scenario: User exceeds cumulative file count limit
- **WHEN** a user's total file count across all sessions reaches the system limit of 200
- **THEN** the upload MUST be rejected
- **AND** the error message MUST indicate the count limit was reached

#### Scenario: User exceeds cumulative total size limit
- **WHEN** a user's total file size across all sessions reaches the system limit of 500 MB
- **THEN** the upload MUST be rejected
- **AND** the error message MUST indicate the size limit was reached

#### Scenario: User exceeds tmp quota
- **WHEN** a user's unsubmitted temporary file total size reaches 1024 MB
- **THEN** the upload MUST be rejected
- **AND** the error message MUST indicate the temp storage quota was reached

### Requirement: User-level upload frequency limit prevents abuse
The system MUST track a per-user sliding window of unsubmitted staged upload timestamps. A file uploaded in the staged phase that has not yet been finalized counts toward the frequency limit. Files that are finalized with a request MUST be deducted from the count. The limit is 500 unsubmitted uploads per 1-hour sliding window. The counter MUST use an in-memory Map with LRU eviction (max 10000 users).

#### Scenario: Frequency limit reached
- **WHEN** a user has 500 unsubmitted uploads within the past hour
- **THEN** the next upload MUST be rejected
- **AND** the error message MUST indicate the frequency limit was reached

#### Scenario: Submitting a question deducts frequency count
- **WHEN** a user submits a question with 3 staged attachments
- **THEN** the frequency count MUST decrease by 3
- **AND** subsequent uploads within the window MUST use the updated count

### Requirement: Temporary file expiry is storage-owned
Temporary attachment expiry MUST be owned by the storage implementation and attachment runtime policy, not by Web channel protocol branching. Remote storage MAY rely on HOFS TTL rules. Local storage MUST keep temporary bytes under `<workspaceRoot>/data/system/upload-tmp` or another `systemDataDir`-derived area and MUST clean local server-side temp files through the three-layer mechanism defined in the file security validation spec. The frontend MAY display timer reminders based on `upload-file-idle-expire-time` and `upload-file-max-expire-time` from effective config.

#### Scenario: Expired staged file causes finalize failure
- **WHEN** a user submits a question with a staged attachment reference
- **AND** the temporary file has expired or been cleaned
- **THEN** finalization MUST fail
- **AND** the error message MUST indicate the file has expired and needs to be re-uploaded

### Requirement: Edit latest follows product policy, not storage mode
Whether edit latest can add new attachments MUST be defined as a product/API rule and MUST NOT differ because storage is local or remote. If edit supports attachments, it MUST use the same staged upload references as submit. If edit is text-only, it MUST reject staged attachment references in all storage modes.

#### Scenario: Text-only edit rejects staged attachments consistently
- **WHEN** edit latest is configured as text-only
- **AND** an edit request includes staged attachment references
- **THEN** the request MUST be rejected with a validation error in every storage mode

### Requirement: Retry latest reuses persisted storage references
Retry latest MUST read persisted `attachmentIds` and their `RequestAttachmentRecord.storageRef` without re-uploading or re-finalizing files. Before tool execution, runtime MUST materialize those refs into a new run-scoped temp directory through `BlobStoreGateway`.

#### Scenario: Retry reuses existing formal attachment records
- **WHEN** a user retries the latest request
- **THEN** the system MUST NOT perform temp upload or temp-to-formal finalization
- **AND** the runtime MUST reuse persisted `storageRef` values only as gateway input
- **AND** tool execution MUST receive newly materialized paths, never raw storage refs

### Requirement: Deleting a temp file requires a backend API call
When a user removes a file from the input area chip list before submitting a question, the frontend MUST call a backend endpoint to delete the staged temporary file. The backend MUST delete the temporary file through the storage gateway and update the in-memory counters (tmp quota and frequency count).

#### Scenario: User deletes an uploaded temp file
- **WHEN** a user clicks the remove button on a file chip
- **THEN** the frontend MUST call `DELETE /api/v1/sessions/:sessionId/files/tmp/{tempRunId}/{fileName}` or the equivalent storage-opaque temp-file delete endpoint
- **AND** the backend MUST delete the staged temporary file
- **AND** the backend MUST decrement `tmpTotalSize` and remove one timestamp from the frequency window

#### Scenario: Deleting an already-expired temp file is idempotent
- **WHEN** the backend is asked to delete a temp file that was already cleaned by storage TTL or local cleanup
- **THEN** the backend MUST still update in-memory counters
- **AND** the backend MUST return success

### Requirement: A single tempRunId can associate multiple files across upload calls
The frontend MUST generate one `tempRunId` per conversation input session. Multiple staged upload calls within the same input session MUST use the same `tempRunId`. The temporary storage namespace MUST support multiple files under the same `tempRunId`.

#### Scenario: Multiple files uploaded under the same tempRunId
- **WHEN** a user uploads file A and file B in separate staged upload calls using the same `tempRunId`
- **THEN** both files MUST be stored under the same temporary upload namespace
- **AND** submission MUST include both files in `attachments`
- **AND** both files MUST be finalized to formal attachment records

### Requirement: Frontend file selector accepts effective config file types
The frontend MUST set the `<input type="file" accept="...">` attribute based on `chatUploadFileConfig.chatUploadFileType` from the bootstrap API. The frontend MUST also perform JavaScript-level validation after selection, and that validation MUST be driven by the same bootstrap config: the accepted extension list derives from `chatUploadFileType`, the size limit from `chatUploadMaxFileSize`, and the count limit from `chatUploadMaxFileNumber`. When no bootstrap config is present, validation MUST fall back to the markdown-only defaults. The rejection message MUST present the effective type list and size limit instead of hardcoding default values. This behavior MUST NOT branch on local versus remote storage.

#### Scenario: File selector accepts configured types
- **WHEN** the bootstrap config returns `chatUploadFileType: ["*.xlsx", "*.csv"]`
- **THEN** the file input MUST have `accept=".xlsx,.csv"`
- **AND** the file dialog MUST filter to those types

#### Scenario: Post-selection validation follows the configured type list
- **WHEN** the bootstrap config returns `chatUploadFileType: ["*.pcap"]` and the user selects `capture.pcap`
- **THEN** the selection MUST pass client-side validation
- **AND** when the user selects `notes.md` under the same config, the rejection message MUST list `.pcap` as the supported type

#### Scenario: Post-selection validation falls back to defaults without config
- **WHEN** no bootstrap `chatUploadFileConfig` is present
- **THEN** client-side validation MUST accept only the markdown defaults (`.md`, `.markdown`) with the default size and count limits

### Requirement: Finalize failure does not require rollback of already-copied bytes
When finalizing staged files fails after some bytes were copied to formal storage, the system MUST NOT create attachment records for the failed request. Already-copied orphan files MAY be left for storage TTL or cleanup, unless the storage implementation can safely delete them best-effort without changing request outcome.

#### Scenario: Finalize failure leaves orphan bytes invisible
- **WHEN** a submission finalizes 2 files successfully but the 3rd file fails
- **THEN** the system MUST NOT create any attachment records for the request
- **AND** the request MUST fail with a safe error
- **AND** already-copied orphan bytes MUST remain unreferenced and invisible to normal reads

### Requirement: Per-session and per-user dual-layer file count limits
The system MUST enforce two layers of file count limits. The config `chat-upload-max-file-number` (default 10, capped at 200) MUST be enforced per-session. The system hard limit of 200 files and 500 MB total size MUST be enforced per-user across all sessions. Both limits MUST be checked on every staged upload. Either limit being exceeded MUST reject the upload.

#### Scenario: Per-session config limit rejects upload
- **WHEN** a user has uploaded 10 files in a single session and the config limit is 10
- **THEN** the 11th upload MUST be rejected
- **AND** the error message MUST indicate the per-session file count limit

#### Scenario: Per-user system limit rejects upload across sessions
- **WHEN** a user has uploaded 200 files across multiple sessions
- **THEN** the next upload MUST be rejected
- **AND** the error message MUST indicate the user-level file count limit

### Requirement: BlobStoreGateway supports temp and formal file deletion
The BlobStoreGateway port MUST support deleting temp files and formal files. Temp file deletion MUST be idempotent. Formal file deletion MUST also be idempotent. Temp file deletion is used when a user removes an unsubmitted file. Formal file deletion is used by the cleanup runtime when attachments are cleaned.

#### Scenario: Deleting a temp file calls BlobStoreGateway
- **WHEN** a user deletes an unsubmitted temp file
- **THEN** the backend MUST call `BlobStoreGateway.deleteBlob`
- **AND** the deletion MUST be idempotent

#### Scenario: Cleanup deletes formal files via BlobStoreGateway
- **WHEN** the cleanup runtime deletes an attachment
- **THEN** the cleanup runtime MUST call `blobStore.deleteBlob`

### Requirement: Cleanup runtime uses BlobStoreGateway
The cleanup runtime MUST use `blobStore.deleteBlob` to delete attachments in all storage modes. The cleanup runtime MUST NOT branch on `deploymentMode` for deletion. The cleanup runtime MUST receive `blobStore` as a dependency.

#### Scenario: Cleanup uses blob store
- **WHEN** the cleanup runtime deletes an attachment
- **THEN** it MUST call `blobStore.deleteBlob`
- **AND** it MUST NOT inspect local versus remote storage mode

### Requirement: Deleting a temp file deducts frequency count
When a user deletes an unsubmitted temp file, the backend MUST remove one timestamp from the user's frequency sliding window in addition to decrementing `tmpTotalSize`. This ensures that deleted uploads do not count toward the 500-per-hour frequency limit.

#### Scenario: Deleting a temp file decrements frequency count
- **WHEN** a user has 400 uploads in the frequency window and deletes one unsubmitted temp file
- **THEN** the frequency count MUST decrease to 399
- **AND** `tmpTotalSize` MUST be decremented by the deleted file's size
- **AND** a subsequent upload MUST see the updated frequency count of 399
