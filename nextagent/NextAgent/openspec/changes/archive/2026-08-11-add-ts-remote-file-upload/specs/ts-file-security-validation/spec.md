## ADDED Requirements

### Requirement: File name validation enforces strict character and length rules
The system MUST validate file names against the regex `^(?=.{1,512}$)[a-zA-Z0-9&\u3010\u3011\uff08\uff09()\s_\-\.\u4e00-\u9fa5+\[\]]+\.\w+$` on both frontend and backend. File names that do not match MUST be rejected with a user-friendly error. The backend MUST validate again at submit time to prevent frontend bypass.

#### Scenario: Valid file name is accepted
- **WHEN** a file named `网络故障报告_v2.xlsx` is uploaded
- **THEN** the file name MUST pass validation
- **AND** the upload MUST proceed

#### Scenario: File name with path traversal is rejected
- **WHEN** a file named `../../etc/passwd.xlsx` is uploaded
- **THEN** the file name MUST be rejected
- **AND** the error message MUST indicate the file name is invalid

#### Scenario: File name exceeding 512 characters is rejected
- **WHEN** a file name longer than 512 characters is uploaded
- **THEN** the file name MUST be rejected

#### Scenario: File name without extension is rejected
- **WHEN** a file named `report` (no extension) is uploaded
- **THEN** the file name MUST be rejected

### Requirement: File content security validation uses an independent module
File content security validation MUST be implemented as an independent module in `agent-attachment-runtime`, designed to be extensible for future file security checks. The module MUST perform magic bytes cross-validation and zip bomb protection.

#### Scenario: Independent module is reusable
- **WHEN** both local and remote intake need content validation
- **THEN** both paths MUST use the same independent module
- **AND** the module MUST NOT depend on deployment mode

### Requirement: Magic bytes cross-validation prevents type spoofing
The system MUST verify that the actual file content magic bytes match the declared file extension. ZIP-based extensions (`.xlsx`, `.docx`, `.pptx`, `.zip`) MUST have `PK\x03\x04` magic bytes. PDF files MUST have `%PDF` magic bytes. Text-based extensions (`.csv`, `.md`) MUST be readable UTF-8 text without binary magic bytes. Mismatched files MUST be rejected.

#### Scenario: CSV file with ZIP magic bytes is rejected
- **WHEN** a file named `data.csv` has `PK\x03\x04` magic bytes
- **THEN** the file MUST be rejected
- **AND** the error message MUST indicate content type mismatch

#### Scenario: XLSX file without ZIP magic bytes is rejected
- **WHEN** a file named `report.xlsx` does not have `PK\x03\x04` magic bytes
- **THEN** the file MUST be rejected

#### Scenario: Valid PDF file is accepted
- **WHEN** a file named `doc.pdf` has `%PDF` magic bytes
- **THEN** the file MUST pass magic bytes validation

### Requirement: Zip bomb protection limits total uncompressed size
For ZIP-based files, the system MUST read the ZIP Central Directory and calculate the total uncompressed size of all entries. If the total uncompressed size exceeds 512 MB, the file MUST be rejected. The check MUST only read ZIP headers, not decompress actual content. The check MUST NOT inspect compression ratio, entry count, or nested archives.

#### Scenario: Normal xlsx file is accepted
- **WHEN** a valid xlsx file with total uncompressed size under 512 MB is uploaded
- **THEN** the file MUST pass zip bomb validation

#### Scenario: Zip bomb exceeding 512 MB uncompressed is rejected
- **WHEN** a ZIP-based file has total uncompressed size exceeding 512 MB
- **THEN** the file MUST be rejected
- **AND** the error message MUST indicate the uncompressed size limit was exceeded

#### Scenario: Non-ZIP file skips zip bomb check
- **WHEN** a PDF or CSV file is uploaded
- **THEN** the zip bomb check MUST be skipped
- **AND** the file MUST proceed to other validation steps

### Requirement: Zip Slip protection rejects path traversal in ZIP entries
For ZIP-based files, the system MUST check each Central Directory entry's file name for path traversal characters. If any entry's file name contains `../`, starts with `/` (absolute path), or resolves outside the target directory via `path.resolve`, the entire file MUST be rejected. This check MUST execute before the zip bomb size check.

#### Scenario: ZIP with path traversal entry is rejected
- **WHEN** a ZIP-based file contains an entry with `../../etc/passwd` as its file name
- **THEN** the file MUST be rejected
- **AND** the error message MUST indicate path traversal detected

#### Scenario: ZIP with absolute path entry is rejected
- **WHEN** a ZIP-based file contains an entry with `/etc/passwd` as its file name
- **THEN** the file MUST be rejected

#### Scenario: Normal ZIP with safe relative paths is accepted
- **WHEN** a ZIP-based file contains entries with safe relative paths like `xl/workbook.xml`
- **THEN** the file MUST pass the Zip Slip check
- **AND** the file MUST proceed to zip bomb size check

### Requirement: Upload operation audit logging for success and failure
Every upload-related operation (phase 1 temp upload, phase 2 move to formal, temp file deletion) MUST record an audit log entry regardless of success or failure. The audit log MUST contain userId, sessionId, operation type, result, fileName, sizeBytes, reasonCode (on failure), timestamp, and tempRunId. The audit log MUST NOT contain HOFS paths or storage references.

#### Scenario: Successful upload is audited
- **WHEN** a phase 1 upload succeeds
- **THEN** an audit log entry MUST be recorded with operation `UPLOAD_TEMP` and result `SUCCESS`

#### Scenario: Failed upload is audited
- **WHEN** a phase 1 upload fails validation
- **THEN** an audit log entry MUST be recorded with operation `UPLOAD_TEMP`, result `FAILURE`, and the reasonCode

#### Scenario: Temp file deletion is audited
- **WHEN** a user deletes a temp file
- **THEN** an audit log entry MUST be recorded with operation `DELETE_TEMP`

### Requirement: Path traversal protection for HOFS path construction
The system MUST validate that `tempRunId` and `fileName` parameters do not escape the target directory when constructing HOFS paths. The system MUST use `path.resolve()` and verify the resolved path remains under the expected base directory. File name regex already filters `..` and path separators. `tempRunId` MUST be validated as a UUID format.

#### Scenario: Malicious tempRunId with path traversal is rejected
- **WHEN** a `tempRunId` contains `../../` characters
- **THEN** the system MUST reject the request
- **AND** the resolved path MUST NOT escape the base directory

### Requirement: Temp file cleanup on validation failure uses try-catch-finally
The phase 1 upload pipeline MUST use try-catch-finally to ensure HOFS temp files are cleaned up when any validation step fails after the file has been written. If the file was written to HOFS temp and a subsequent check fails, the system MUST delete the temp file before returning the error.

#### Scenario: Magic bytes validation failure cleans up temp file
- **WHEN** a file is written to HOFS temp but fails magic bytes cross-validation
- **THEN** the system MUST delete the temp file from HOFS
- **AND** the system MUST return a validation error

#### Scenario: Zip bomb check failure cleans up temp file
- **WHEN** a file is written to HOFS temp but fails the zip bomb size check
- **THEN** the system MUST delete the temp file from HOFS

### Requirement: Global upload concurrency limit of 4
The system MUST enforce a global concurrency limit of 4 simultaneously processing phase 1 upload requests, shared across all users. Requests beyond the limit MUST wait with a timeout (30 seconds). If the timeout expires, the system MUST return a 503 error.

#### Scenario: 5th concurrent upload waits
- **WHEN** 4 uploads are in progress and a 5th arrives
- **THEN** the 5th upload MUST wait until a slot is available
- **AND** if no slot becomes available within 30 seconds, the system MUST return 503

### Requirement: Streaming upload prevents memory exhaustion
Phase 1 upload MUST use streaming multipart parsing instead of full buffer reading. The file content MUST be streamed to HOFS temp path. Only file headers (first few KB) MUST be read back for content validation. The system MUST NOT load the entire file into memory. File size MUST be checked during streaming via real-time `dataLength` tracking, not after the full file is received.

#### Scenario: Large file is streamed without memory impact
- **WHEN** a user uploads a 400 MB file
- **THEN** the system MUST stream the file to HOFS without loading 400 MB into memory
- **AND** memory usage per upload MUST remain in the KB range

#### Scenario: File exceeding size limit is aborted during streaming
- **WHEN** a user uploads a file that exceeds the configured size limit
- **THEN** the streaming MUST be aborted as soon as the size limit is detected
- **AND** any partially written temp file MUST be deleted
- **AND** the system MUST return a size limit error

### Requirement: Chunked upload is not supported
The phase 1 upload endpoint MUST only accept a single complete file in a multipart request. Chunked upload (splitting a file into multiple requests) MUST NOT be supported. File size is controlled by real-time streaming size checks, preventing size limit bypass through chunking.

#### Scenario: Chunked upload request is rejected
- **WHEN** a client attempts to upload file chunks in separate requests
- **THEN** each chunk MUST be treated as a separate complete file upload
- **AND** the size limit MUST apply to each chunk individually

### Requirement: Local temp file staging before BlobStoreGateway upload
Phase 1 upload MUST stage files to a local temporary directory before uploading to BlobStoreGateway. The local temp file path MUST be under `{systemDataDir}/upload-tmp/{userId}/{tempRunId}/{fileName}`. The system MUST stream the incoming file to local disk (not memory) with real-time size checking. After the local file is complete, the system MUST validate file content (magic bytes, zip bomb, zip slip) on the local file, then upload the complete file to BlobStoreGateway via `storeBlob` in a single request. The local temp file MUST be deleted after BlobStoreGateway upload succeeds or fails.

#### Scenario: File is staged to local temp before BlobStoreGateway upload
- **WHEN** a user uploads a file in remote mode
- **THEN** the system MUST stream the file to a local temp directory
- **AND** the system MUST NOT load the entire file into memory
- **AND** after local staging, the system MUST upload the complete file to BlobStoreGateway
- **AND** the local temp file MUST be deleted after BlobStoreGateway upload completes

### Requirement: Local upload temp directory has disk space protection
The system MUST enforce a global upload temp directory size limit of 2048 MB. When the total size of files in the upload temp directory reaches 2048 MB, new uploads MUST be rejected. If a local disk write fails due to insufficient space (ENOSPC), the system MUST abort the stream, delete the partial temp file, and return a user-friendly error.

#### Scenario: Disk space exhaustion during write aborts upload
- **WHEN** a disk write fails with ENOSPC during local temp file staging
- **THEN** the system MUST abort the streaming
- **AND** the system MUST delete the partial temp file
- **AND** the system MUST return a user-friendly error indicating insufficient storage

#### Scenario: Global upload temp limit rejects new upload
- **WHEN** the total size of files in the upload temp directory reaches 2048 MB
- **THEN** the next upload MUST be rejected before writing to disk
- **AND** the error message MUST indicate the upload temp storage is full

### Requirement: Local upload temp directory has three-layer cleanup
The system MUST clean up local upload temp files through three mechanisms: (1) immediate deletion after HOFS upload completes (success or failure), guaranteed by try-catch-finally; (2) startup scan that removes all residual files in the upload temp directory; (3) periodic cleanup job that removes files older than 1 hour.

#### Scenario: Normal flow deletes local temp file after HOFS upload
- **WHEN** a file is successfully uploaded to HOFS
- **THEN** the local temp file MUST be deleted immediately
- **AND** no residual file MUST remain on disk

#### Scenario: Startup scan cleans residual temp files
- **WHEN** the service starts up
- **THEN** the system MUST scan the upload temp directory
- **AND** the system MUST delete all files found in the directory

#### Scenario: Periodic cleanup removes orphaned temp files
- **WHEN** a local temp file has existed for more than 1 hour
- **THEN** the periodic cleanup job MUST delete it
