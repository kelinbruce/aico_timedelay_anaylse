## ADDED Requirements

### Requirement: HOFS file download endpoint

The Web channel MUST expose `GET /api/v1/sessions/:sessionId/files/download` to proxy-download a file located in HOFS by its complete object name. The endpoint MUST accept the HOFS object name as a `path` query parameter (URL-encoded). The owner scope (tenantId/subjectId) MUST be resolved from the channel/auth boundary via `identityResolver` and MUST NOT be taken from the query string, request body, or model output. The endpoint MUST materialize the HOFS object to a request-scoped temporary file via `BlobStoreGateway.materializeBlob`, stream the file bytes back as an HTTP response with `Content-Disposition: attachment; filename=<last segment>`, and clean up the temporary file when the response finishes or errors.

#### Scenario: User downloads a HOFS file by object name

- **WHEN** the frontend calls `GET /api/v1/sessions/:sessionId/files/download?path=aicoservice%2Fanswer%2Fsess1%2Frun1%2Fresult.xlsx` with an authenticated session
- **THEN** the backend MUST resolve the owner scope from the authenticated identity
- **AND** the backend MUST materialize the HOFS object named `aicoservice/answer/sess1/run1/result.xlsx` to a request-scoped temporary file via `BlobStoreGateway.materializeBlob`
- **AND** the response MUST set `Content-Disposition: attachment; filename="result.xlsx"`
- **AND** the response MUST stream the file bytes with a content type derived from the file extension (falling back to `application/octet-stream`)
- **AND** the temporary file MUST be deleted after the response finishes or errors

#### Scenario: Owner scope not taken from request input

- **WHEN** a download request arrives
- **THEN** the owner scope MUST come from `identityResolver` resolving the authenticated identity
- **AND** the owner scope MUST NOT be read from the `path` query parameter, request body, or any model-produced value

#### Scenario: Object name with path traversal rejected

- **WHEN** the `path` query parameter contains `..`, an absolute path (leading `/` or a drive letter), or a null byte
- **THEN** the backend MUST reject the request with a validation error
- **AND** the backend MUST NOT call `BlobStoreGateway`

### Requirement: Download reuses BlobStoreGateway.materializeBlob

The download path MUST NOT introduce a second HOFS read mechanism. Download MUST reuse the existing `BlobStoreGateway.materializeBlob` method (the same primitive used by the skill-read side `AttachmentExecutionRuntime`). The `blobRef` passed to `materializeBlob` MUST be the complete HOFS object name from the FILE delta content. The download materialize runtime MUST own a request-scoped temporary directory and clean it up, mirroring the `AttachmentExecutionRuntime` materialize/cleanup shape. The `BlobStoreGateway` contract MUST NOT be extended with new methods for download.

#### Scenario: Download uses the same primitive as skill read

- **WHEN** the backend materializes a file for download
- **THEN** it MUST call `BlobStoreGateway.materializeBlob` with `blobRef` set to the complete HOFS object name
- **AND** it MUST NOT call any other HOFS read method or introduce a new gateway method

#### Scenario: BlobStoreGateway contract unchanged by download

- **WHEN** validating the `agent-contracts/gateway` module
- **THEN** no new method MUST have been added to `BlobStoreGateway` for download purposes
- **AND** download MUST rely solely on the existing `materializeBlob` (and optionally `getBlobMetadata`)

### Requirement: FileDownloadPort local port

The Web channel MUST NOT import `BlobStoreGateway` directly. Download MUST be exposed to the Web channel through a `FileDownloadPort` local port interface declaring `materialize` and `cleanup`, mirroring the existing `StagedUploadPort` pattern. `WebChannelDependencies` MUST accept an optional `fileDownloadRuntime?: FileDownloadPort`. Composition MUST wire `FileDownloadPort` to `BlobStoreGateway.materializeBlob`. The local port interface MUST be structural and MUST NOT import from `agent-attachment-runtime` or `agent-contracts/gateway`.

#### Scenario: Web channel has no direct BlobStoreGateway import

- **WHEN** checking `agent-channel-web` source for `BlobStoreGateway` imports outside of type-only structural local port definitions
- **THEN** the download route MUST depend only on `FileDownloadPort`
- **AND** the architecture boundary MUST remain intact (same as the upload `StagedUploadPort` pattern)

#### Scenario: Composition wires download port to gateway

- **WHEN** the app composition assembles `WebChannelDependencies`
- **THEN** it MUST provide a `fileDownloadRuntime` backed by `BlobStoreGateway.materializeBlob`
- **AND** the download runtime MUST receive `downloadTempDir` from `AppRuntimePaths`

### Requirement: Download temporary file lifecycle

Download MUST stage materialized files under `{systemDataDir}/download-tmp/{downloadId}/{safeFileName}`, where `downloadId` is request-scoped unique and `safeFileName` is the last path segment of the object name after path-traversal sanitization. `AppRuntimePaths` MUST add a `downloadTempDir` field resolved to `{systemDataDir}/download-tmp`, and runtime path validation MUST cover it. Download MUST implement three-layer cleanup mirroring the upload temp lifecycle: delete the temporary directory on HTTP response finish/error; scan and clean residuals at startup; and run a periodic cleanup job (reusing the `execution-cleanup-jobs` pattern) for orphan files older than one hour. A global size cap MUST guard `download-tmp/` against disk exhaustion, tracked separately from the upload-tmp cap. Capacity MUST be reserved atomically before materialization when blob metadata provides a valid content length. When metadata is unavailable, the runtime MUST atomically reserve the actual materialized size and immediately delete the request directory if the reservation would exceed the cap. Concurrent accepted downloads MUST NOT make the accounted total exceed the cap. The temporary file MUST NOT enter model-visible paths, tool args, sandbox, or prompt.

#### Scenario: Temporary file cleaned on response finish

- **WHEN** a download response finishes sending
- **THEN** the backend MUST delete the `download-tmp/{downloadId}` directory

#### Scenario: Temporary file cleaned on response error

- **WHEN** materialization or streaming fails mid-download
- **THEN** the backend MUST delete the `download-tmp/{downloadId}` directory
- **AND** the backend MUST return a safe error to the client

#### Scenario: Startup scan cleans residual download temp files

- **WHEN** the app starts
- **THEN** the backend MUST scan `download-tmp/` and delete all residual files

#### Scenario: Periodic cleanup removes orphan download temp files

- **WHEN** a periodic cleanup job runs
- **THEN** it MUST delete files under `download-tmp/` older than one hour

#### Scenario: Download temp global size cap enforced

- **WHEN** a new or concurrent download would make the accounted `download-tmp/` size exceed the system cap
- **THEN** the backend MUST reject that download with a safe capacity error
- **AND** it MUST NOT retain the rejected download's request-scoped temporary directory

#### Scenario: Download temp file never model-visible

- **WHEN** a download temporary file is materialized
- **THEN** its path MUST NOT appear in `ToolExecutionContext`, tool call args, sandbox environment, or model prompt

### Requirement: Download file name and content type derivation

The download response `Content-Disposition` filename MUST be the last path segment of the HOFS object name (`safeFileName`). The `Content-Type` MUST be derived from the file extension of `safeFileName`, falling back to `application/octet-stream` when the extension is unknown or absent. The backend MUST NOT require `BlobStoreGateway.getBlobMetadata` to derive content type; a metadata round-trip is optional.

The download response SHOULD include a `Content-Length` header set to the materialized file size in bytes when the size is known.

#### Scenario: Filename is last segment of object name

- **WHEN** downloading `aicoservice/answer/sess1/run1/result.xlsx`
- **THEN** the response `Content-Disposition` MUST be `attachment; filename="result.xlsx"`

#### Scenario: Content type derived from extension

- **WHEN** downloading `report.csv`
- **THEN** the response `Content-Type` MUST be derived from the `.csv` extension

#### Scenario: Unknown extension falls back to octet-stream

- **WHEN** downloading a file with an unknown or no extension
- **THEN** the response `Content-Type` MUST be `application/octet-stream`

### Requirement: FILE delta content carries complete HOFS object name

The `FILE` `toolMessageType` of `TOOL_STRUCTURED_DELTA` MUST carry the complete HOFS object name as its `content` string. The frontend MUST extract the last path segment for display and pass the complete object name to the download endpoint. Frontend rendering MUST remain backward compatible: when `content` contains no path separator (legacy plain file name), the `FileCard` MUST render as a display-only card without a download button.

#### Scenario: FileCard displays last segment and download button

- **WHEN** a `TOOL_STRUCTURED_DELTA` FILE event arrives with content `aicoservice/answer/sess1/run1/result.xlsx`
- **THEN** the `FileCard` MUST display `result.xlsx`
- **AND** the `FileCard` MUST render a download control that triggers a request to the download endpoint with the complete object name

#### Scenario: Legacy plain file name renders without download

- **WHEN** a `TOOL_STRUCTURED_DELTA` FILE event arrives with content `result.xlsx` (no path separator)
- **THEN** the `FileCard` MUST render as a display-only card
- **AND** the `FileCard` MUST NOT render a download button


### Requirement: File download card visual specification

The download `FileCard` MUST render at a fixed size of 291px width and 58px height, with 8px border radius and 8px 16px padding. The card MUST be split horizontally into a left region (file icon plus file info) and a right region of fixed 48px width carrying the "下载" (download) text. A vertical divider of 26px height and 1px width MUST sit between the two regions. The left region MUST contain a 24x24 `FileTypeIcon` (reusing the existing `resolveFileTypeKind` mapping shared with the composer `AttachmentFileCard` chip, no second icon mapping) followed by a file info area that is 8px from both the icon and the divider and fills the remaining width; the info area has two lines, the first being the file name at 14px / 22px line-height with `truncateFileNameMiddle` middle-ellipsis truncation (preserving the file extension, same as the composer `AttachmentFileCard` chip) and a `title` tooltip showing the full name, the second being the fixed text「已生成」at 12px / 20px line-height. The right region "下载" text MUST be 12px, and clicking it MUST trigger the download flow; the text MUST change cursor to pointer on hover. Colors MUST follow the existing `:root[data-theme]` light/dark CSS variable mechanism: dark theme card background `rgba(243,243,243,0.1)` with border `1px solid rgba(46,134,222,1)`, file name `rgba(255,255,255,1)`, the「已生成」text `rgba(201,201,201,1)`, divider `rgba(119,119,119,1)`, download text `rgba(92,162,233,1)`; light theme card background `rgba(201,201,201,0.2)` with border `1px solid rgba(0,103,209,1)`, file name `rgba(25,25,25,1)`, the「已生成」text `rgba(119,119,119,1)`, divider `rgba(201,201,201,1)`, download text `rgba(0,103,209,1)`. The card MUST accept an `isDark` flag for theme selection, consistent with `AttachmentFileCard`.

#### Scenario: Card uses fixed dimensions and split layout

- **WHEN** the `FileCard` renders for a FILE delta with a HOFS object name
- **THEN** the card MUST be 291px wide and 58px tall with 8px border radius and 8px 16px padding
- **AND** the card MUST have a left region and a 48px-wide right region separated by a 26px x 1px divider

#### Scenario: File icon reuses shared mapping

- **WHEN** the `FileCard` renders the file icon
- **THEN** it MUST use `FileTypeIcon.resolveFileTypeKind`, the same mapping as the composer `AttachmentFileCard` chip
- **AND** it MUST NOT introduce a second file-type icon mapping

#### Scenario: File name truncates with tooltip

- **WHEN** the file name exceeds the info area width
- **THEN** the name MUST truncate using the shared `truncateFileNameMiddle` function (middle ellipsis preserving the file extension, same as the composer `AttachmentFileCard` chip) at 14px / 22px line-height
- **AND** hovering the name MUST show the full file name via a `title` tooltip

#### Scenario: Download text triggers download with pointer cursor

- **WHEN** the user hovers the right-region "下载" text
- **THEN** the cursor MUST change to pointer
- **AND** clicking the text MUST trigger the HOFS file download flow

#### Scenario: Dark theme colors applied

- **WHEN** the `FileCard` renders under a dark theme (`isDark` true)
- **THEN** the card background MUST be `rgba(243,243,243,0.1)`, border `1px solid rgba(46,134,222,1)`, file name `rgba(255,255,255,1)`, the「已生成」text `rgba(201,201,201,1)`, divider `rgba(119,119,119,1)`, and download text `rgba(92,162,233,1)`

#### Scenario: Light theme colors applied

- **WHEN** the `FileCard` renders under a light theme (`isDark` false)
- **THEN** the card background MUST be `rgba(201,201,201,0.2)`, border `1px solid rgba(0,103,209,1)`, file name `rgba(25,25,25,1)`, the「已生成」text `rgba(119,119,119,1)`, divider `rgba(201,201,201,1)`, and download text `rgba(0,103,209,1)`
