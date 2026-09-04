# ts-attachment-intake

## Purpose
Define the stable user-facing behavior for attachment intake before request acceptance, including accepted inputs, limits, safe failures, and durable attachment fact creation.
## Requirements
### Requirement: Attachment intake is request-entry owned and acceptance-gated
TS 后端 MUST support attachment intake as a request-entry flow. Attachment intake MUST start after the request entry receives attachment input and before request acceptance. The request entry MAY continue to use the existing JSON submit/edit body when no attachment is present, but requests with attachment input MUST use `multipart/form-data` carrying `inputText`, `idempotencyKey`, `locale?`, and file parts. The system MUST NOT accept base64 bytes, raw upload handles, or client-declared owner/size/status/storage fields in the JSON request body.

#### Scenario: No attachment request uses existing JSON body
- **WHEN** a user submits or edits a request without attachments
- **THEN** the system MAY continue to use the existing JSON submit/edit body
- **AND** the system MUST NOT require `multipart/form-data`

#### Scenario: Attachment request uses multipart input
- **WHEN** a user submits or edits a request with attachments
- **THEN** the request entry MUST use `multipart/form-data`
- **AND** the request entry MUST forward the server-read bytes to attachment runtime intake
- **AND** the request entry MUST only place returned `AttachmentId` values into `attachmentIds`

### Requirement: Attachment intake enforces deterministic limits and type checks
Attachment intake MUST validate attachment count, size, type, and readability with deterministic rules. Each request MUST carry at most 3 attachments. Each file MUST have a server-read `sizeBytes` greater than 0 and less than or equal to 5 MiB. Markdown files (`.md` and `.markdown` extensions) MUST always pass type validation regardless of the `chatUploadFileType` configuration; this is a controlled exception because the platform has built-in markdown parsing capability. All other file types MUST be validated against the configured `chatUploadFileType` patterns. Markdown detection MUST use trusted filename, declared MIME, and server-read bytes; PDF, Excel, Word, and other non-Markdown inputs that are not in the configured `chatUploadFileType` MUST be rejected with a safe error.

#### Scenario: Markdown attachment is always accepted regardless of configuration
- **WHEN** a request carries a `.md` or `.markdown` attachment inside count and size limits
- **AND** the agent's `chatUploadFileType` configuration does not include markdown patterns (e.g. `["*.pcap"]`)
- **THEN** the system MUST accept the markdown attachment through type validation
- **AND** the system MUST continue to validate file name, magic bytes, readability, and size
- **AND** the system MUST NOT reject the attachment with `FILE_TYPE_UNSUPPORTED`

#### Scenario: Non-markdown attachment still respects configuration
+- **WHEN** a request carries a `.pcap` attachment
+- **AND** the agent's `chatUploadFileType` configuration is `["*.md", "*.markdown"]` (does not include pcap)
+- **THEN** the system MUST reject the attachment with `FILE_TYPE_UNSUPPORTED`
+- **AND** the system MUST NOT accept the non-markdown attachment regardless of media type mapping

#### Scenario: Markdown attachment inside limits is accepted
- **WHEN** a request carries 1 to 3 Markdown attachments
- **AND** each attachment is larger than 0 bytes and no larger than 5 MiB
- **THEN** the system MUST validate type and readability
- **AND** accepted attachments MUST produce `AttachmentId`

#### Scenario: Too many attachments are rejected
- **WHEN** a request carries more than 3 attachments
- **THEN** the system MUST reject the request intake
- **AND** the system MUST return `ATTACHMENT_COUNT_EXCEEDED`

#### Scenario: Unsupported type is rejected
- **WHEN** a request carries PDF, Excel, Word, or other non-Markdown attachments that are not in the configured `chatUploadFileType`
- **THEN** the system MUST return `ATTACHMENT_TYPE_UNSUPPORTED`
- **AND** the system MUST NOT attempt parser, OCR, or content extraction

#### Scenario: Markdown attachment with mismatched magic bytes is rejected
- **WHEN** a request carries a file named `report.md` but the server-read magic bytes indicate PDF or binary content
- **THEN** the system MUST reject the attachment with `MAGIC_BYTES_MISMATCH`
- **AND** the system MUST NOT accept the attachment despite markdown forced type acceptance

### Requirement: Attachment intake fails closed on any invalid attachment
Attachment intake MUST be request-level fail-closed. If any attachment fails count, size, type, readability, storage write, or metadata write validation, the entire request intake MUST fail. The system MUST NOT silently drop invalid attachments, accept a partial attachment list, or continue with partially staged attachments.

#### Scenario: Any invalid attachment fails the whole request
- **WHEN** a request carries multiple attachments and any one attachment fails validation
- **THEN** the system MUST reject the entire request intake
- **AND** the system MUST NOT place partially accepted `attachmentIds` into the request command

### Requirement: Attachment intake writes authoritative attachment facts
If all validation succeeds, attachment runtime MUST write accepted bytes to `BlobStoreGateway`, create an opaque `BlobRef`, and then write an authoritative `RequestAttachment` record through `AttachmentStoreGateway`. The authoritative record MUST contain `attachmentId`, `sessionId`, `requestId`, `runId?`, `agentId`, `fileName`, `mediaType`, `sizeBytes`, `storageRef`, `validationStatus=ACCEPTED`, `availabilityStatus=AVAILABLE`, and `createdAt`. The request entry MUST then pass only `attachmentIds` downstream.

#### Scenario: Accepted attachment becomes durable authority
- **WHEN** a Markdown attachment passes validation and staging
- **THEN** the system MUST write the attachment bytes to `BlobStoreGateway`
- **AND** the system MUST write the authoritative `RequestAttachment` record
- **AND** the request entry MUST only keep `attachmentIds`

### Requirement: Attachment intake emits safe evidence and safe errors
Attachment intake MUST emit safe audit, log, and metric evidence for accepted and rejected outcomes. Safe output MUST include `attachmentId`, safe file metadata, a reason code, and stable business refs. It MUST NOT include raw attachment content, `BlobRef`, storage paths, URLs, secret material, or provider raw errors. Failures MUST be surfaced as explicit safe errors or rejected outcomes.

#### Scenario: Rejected attachment returns explicit safe error
- **WHEN** an attachment fails type, size, readability, or storage validation
- **THEN** the system MUST return an explicit safe error or rejected outcome
- **AND** the system MUST record safe audit and metric evidence

### Requirement: Attachment intake keeps cleanup and context flows separate
Attachment intake MUST only produce accepted `AttachmentId` values and authoritative `RequestAttachment` facts. It MUST NOT define cleanup scheduling, retention, content summaries, or request-context classification. Retry, request-context consumption, and cleanup behaviors are owned by their respective downstream specs.

#### Scenario: Intake does not define downstream lifecycle policy
- **WHEN** a request intake completes successfully
- **THEN** the system MUST only surface accepted `AttachmentId` values
- **AND** the system MUST NOT add summary, retention, or cleanup policy

### Requirement: Attachment mediaType uses shared vocabulary
`RequestAttachmentRecord.mediaType`, `RequestAttachment.mediaType`, and gateway persistence DTOs MUST use the shared `AttachmentMediaType` union (`"WORD" | "EXCEL" | "PDF" | "MARKDOWN" | "PCAP" | "PCAPNG" | "CAP" | "TMF" | "PTMF" | "ZIP" | "TAR" | "RAR" | "GZ"`). Unified staged upload MUST map each supported extension to this vocabulary before persistence; it MUST reject a configured extension with no mapping.

#### Scenario: Staged upload maps mediaType before persistence
- **WHEN** attachment upload accepts a file named `report.xlsx`
- **THEN** the `RequestAttachmentRecord.mediaType` MUST be `"EXCEL"`
- **AND** the file MUST be persisted via `BlobStoreGateway`
- **AND** the `mediaType` field MUST use `AttachmentMediaType`

#### Scenario: Telecom capture extensions map to their own vocabulary values
- **WHEN** attachment upload accepts a file named `capture.pcap` (or `.pcapng`, `.cap`, `.tmf`, `.ptmf`, `.zip`, `.tar`, `.rar`, `.gz`)
- **THEN** the `RequestAttachmentRecord.mediaType` MUST be the matching vocabulary value (`"PCAP"`, `"PCAPNG"`, `"CAP"`, `"TMF"`, `"PTMF"`, `"ZIP"`, `"TAR"`, `"RAR"`, `"GZ"`)
- **AND** extension matching MUST be case-insensitive (`.PCAP` maps to `"PCAP"`)
- **AND** extension extraction MUST keep only the final segment (`bundle.tar.gz` maps to `"GZ"`)
- **AND** the intake path and the staged-upload path MUST persist the same `mediaType` for the same file name

#### Scenario: Mapped mediaType does not break context engine
- **WHEN** a `RequestAttachmentRecord` has a mapped `mediaType`
- **THEN** the context engine MUST NOT check `mediaType` for content injection
- **AND** all supported mapped file types MUST be accepted
- **AND** tool execution MUST receive system-resolved attachment refs without exposing storage coordinates in model-visible prompt text

### Requirement: Frontend AttachmentRef mediaType uses shared vocabulary
The frontend `AttachmentRef.mediaType` MUST use the `AttachmentMediaType` enum.

#### Scenario: Frontend displays mapped file type
- **WHEN** a remote mode attachment has `mediaType: "EXCEL"`
- **THEN** the frontend MUST display it without type error
- **AND** the frontend MUST render the shared vocabulary value

