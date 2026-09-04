# agent-web-attachment-composer Specification

## Purpose
定义 Agent Web 浏览器附件选择与拖放的统一入口、整批原子预检、根路由 session 建立顺序、本地待提交队列和提交/路由结果驱动的清理语义；服务端 intake 与附件 authority 仍由既有附件能力拥有。
## Requirements
### Requirement: Attachment picker and file drop SHALL share one permission-controlled intake path

Agent Web SHALL accept attachments through the file picker and through file drag-and-drop using the same client intake behavior. Non-file drag data SHALL be ignored. Without `AICOService.Write`, the attachment button SHALL be disabled, the hidden file input SHALL not be rendered, and file drop SHALL not add attachments.

When the bootstrap response does not include `chatUploadFileConfig` (REMOTE mode and configuration file not available), the attachment button SHALL be disabled with a tooltip explaining that file upload is not configured. The hidden file input SHALL not be rendered. File drop SHALL not add attachments. Agent Web SHALL NOT silently fall back to default upload limits when `chatUploadFileConfig` is absent.

When the bootstrap response includes `chatUploadFileConfig` (LOCAL mode always, REMOTE mode when config file exists), the attachment button SHALL be enabled and SHALL use the config values to drive accepted file types, size limits, and count limits.

#### Scenario: Picker and file drop add through the same queue
- **WHEN** the user selects supported files from the picker or drops supported files on the Composer
- **THEN** Agent Web SHALL apply the same batch validation and queue behavior

#### Scenario: Non-file drag is ignored
- **WHEN** the user drags data that does not include files over the Composer
- **THEN** Agent Web SHALL NOT display file-drop intake or add an attachment

#### Scenario: Missing Write permission prevents attachment intake
- **GIVEN** a remote user lacks `AICOService.Write`
- **WHEN** the Composer is rendered or files are dropped
- **THEN** the attachment button SHALL be visible but disabled
- **AND** the file input SHALL not be rendered
- **AND** the dropped files SHALL not be queued

#### Scenario: REMOTE mode missing upload config disables attachment button
- **GIVEN** REMOTE mode and the bootstrap response does not include `chatUploadFileConfig`
- **WHEN** the Composer is rendered
- **THEN** the attachment button SHALL be disabled
- **AND** a tooltip SHALL explain that file upload is not configured
- **AND** the file input SHALL not be rendered
- **AND** file drop SHALL not add attachments

#### Scenario: LOCAL mode attachment button always enabled
- **GIVEN** LOCAL mode and the bootstrap response includes `chatUploadFileConfig` with default markdown-only limits
- **WHEN** the Composer is rendered
- **THEN** the attachment button SHALL be enabled
- **AND** the accepted file types SHALL be markdown-only (`.md`, `.markdown`)

#### Scenario: Upload config present enables attachment button
- **GIVEN** the bootstrap response includes `chatUploadFileConfig` with effective values
- **WHEN** the Composer is rendered
- **THEN** the attachment button SHALL be enabled
- **AND** the accepted file types, size limits, and count limits SHALL be driven by the config

### Requirement: Client attachment precheck SHALL reject an invalid batch atomically

Before changing the local queue, Agent Web MUST validate the complete selected batch against the current queue. The combined queue SHALL contain at most 3 files. Each filename SHALL end in `.md` or `.markdown` case-insensitively and each file SHALL be at most 5 MiB. Duplicate identity SHALL be the lower-cased filename together with size and `lastModified`, checked against both the existing queue and the same batch. If any check fails, Agent Web SHALL reject the complete new batch, preserve the existing queue, and show a warning. This client precheck SHALL NOT replace authoritative server attachment validation.

#### Scenario: One invalid file rejects the complete new batch
- **GIVEN** a selected batch contains both valid and invalid files
- **WHEN** the batch is added
- **THEN** none of the new files SHALL enter the queue
- **AND** the existing queue SHALL remain unchanged
- **AND** Agent Web SHALL show a validation warning

#### Scenario: Duplicate identity includes metadata
- **GIVEN** an existing or same-batch file has the same case-insensitive name, size, and `lastModified`
- **WHEN** the duplicate is selected
- **THEN** Agent Web SHALL reject the complete new batch as duplicate

#### Scenario: Server remains authoritative for file contents
- **GIVEN** a file passes filename, size, count, and duplicate precheck but violates server content validation
- **WHEN** the user submits it
- **THEN** Agent Web SHALL surface the mapped safe server warning
- **AND** SHALL preserve the message and attachment queue for correction

### Requirement: First valid root-route attachment SHALL establish its session before queueing

When a valid attachment batch is selected on the pre-session root route, Agent Web SHALL create a session, replace the route with that session, make it active, and then add the files to the session-bound local queue. A batch that fails client validation SHALL NOT create a session.

#### Scenario: Valid root attachment creates and binds a session
- **GIVEN** the user is on the pre-session root route
- **WHEN** the user selects a valid attachment batch
- **THEN** Agent Web SHALL create and activate a session before queueing the files

#### Scenario: Invalid root attachment does not create a session
- **GIVEN** the user is on the pre-session root route
- **WHEN** attachment precheck rejects the selected batch
- **THEN** Agent Web SHALL remain on the root route without creating a session

### Requirement: Attachment queue SHALL represent local ready-to-submit files

The attachment queue SHALL display each accepted local file's name, size, ready status, and a remove action. Files that fail client precheck SHALL be represented by the validation notice rather than by a persistent error item in the queue. Files that pass client precheck SHALL be treated as locally ready for a normal request submission; Agent Web SHALL NOT describe that state as proof of a completed server upload. Only after the user initiates a normal submit SHALL Agent Web hand the queued files to the current normal-request attachment flow; the transport endpoint and temporary-reference contract are owned outside this frontend queue capability. The current browser edit-resubmit path is text-only: a non-empty local attachment queue SHALL fail before the Web edit route is called and SHALL remain available for correction or later normal submit. Removing an attachment SHALL also clear the current attachment validation notice. The Composer SHALL require non-blank message text and all queued attachments to be locally ready before submit is enabled.

#### Scenario: Ready attachment remains local until normal submit
- **WHEN** a file passes client precheck and enters the queue
- **THEN** Agent Web SHALL display it as ready to submit
- **AND** SHALL hand it to the normal-request attachment flow only after the user initiates a normal submit

#### Scenario: Browser edit does not accept a queued attachment
- **GIVEN** edit mode has a non-empty local attachment queue
- **WHEN** the user confirms edit-resubmit
- **THEN** Agent Web SHALL fail before calling the Web edit route
- **AND** SHALL preserve the edited text and attachment queue

#### Scenario: Attachment-only submit is unavailable
- **GIVEN** the queue contains ready files but the message text is blank
- **WHEN** the Composer evaluates submit eligibility
- **THEN** submit SHALL remain disabled

#### Scenario: Remove clears the attachment notice
- **GIVEN** an attachment validation notice is visible
- **WHEN** the user removes a queued attachment
- **THEN** Agent Web SHALL remove that attachment and clear the notice

### Requirement: Attachment queue cleanup SHALL follow request and route outcomes

A successful normal submit SHALL clear the attachment queue and its notice. A failed normal submit or a blocked/failed edit-resubmit SHALL preserve the relevant message or edited text and the queue. Cancelling edit mode SHALL preserve the current queue for normal Composer use. When the active route session changes, Agent Web SHALL clear a queue that belongs to a different session.

#### Scenario: Successful submit clears attachments
- **WHEN** a normal submit is accepted successfully
- **THEN** Agent Web SHALL clear the attachment queue and notice

#### Scenario: Failed submit preserves attachments
- **WHEN** normal submit or edit-resubmit fails before acceptance
- **THEN** Agent Web SHALL preserve the relevant text and queued attachments

#### Scenario: Session switch removes a foreign queue
- **GIVEN** queued attachments are bound to one session
- **WHEN** the active route changes to another session
- **THEN** Agent Web SHALL clear the foreign session's attachment queue
