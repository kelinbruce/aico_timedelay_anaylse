## MODIFIED Requirements

### Requirement: Gateway Port And Durable Fact Baseline
TS 后端 MUST 在核心契约中定义 gateway logical ports，而不是暴露具体 adapter、数据库、文件路径或 remote SDK。Gateway ports MUST 支持 session、message、active context、RequestRun、timeline、checkpoint、attachment、blob、artifact、pending input 和 conversation annotation 等 durable facts 的最小读写边界，并提供 owner-scoped request、optimistic version、claim/fencing 和 idempotent terminal write 的语义。Gateway ports MUST use `*Record` persistence DTOs as their request/return data shape and MUST NOT depend on upper-layer domain objects such as RequestRun、SessionMessage、RunTimelineEvent、RequestAttachment、CheckpointPayload、PendingInput or ConversationAnnotation. RequestRun、active context、checkpoint、attachment、blob、pending input 和 conversation annotation 的持久化端口 MUST 分别命名为 RequestRunStoreGateway、ActiveContextStoreGateway、CheckpointStoreGateway、AttachmentStoreGateway、BlobStoreGateway、PendingInputStoreGateway 和 ConversationAnnotationStoreGateway。

#### Scenario: 上层模块只依赖 logical gateway port
- **WHEN** runtime、session、channel、context、capability 或 observability 需要持久化或查询 durable fact
- **THEN** 该模块 MUST 依赖 gateway logical port
- **AND** 该模块 MUST NOT 直接依赖具体数据库 driver、local path layout、remote endpoint SDK 或 adapter-private query object

#### Scenario: Gateway ports use Record DTOs
- **WHEN** gateway port reads, writes, claims, hides, resolves or commits a durable fact
- **THEN** the gateway request and return types MUST use gateway-owned `*Record` DTOs
- **AND** gateway contracts MUST NOT import or expose upper-layer domain objects as store request or return values
- **AND** gateway record DTOs MUST use foundation vocabulary owned by `agent-common` when they need shared id、time、JSON、owner or shared durable vocabulary fields
- **AND** gateway record DTOs MUST NOT import upper-domain subpath enum or DTO types
- **AND** session、attachment、pending-input and content-specific record fields MUST use gateway-owned record value types or `agent-common` foundation types
- **AND** domain modules MUST map between their DOs/read models and gateway Records at the module boundary
- **AND** gateway adapters MUST store and return Records without enforcing domain state machines or lifecycle policies

#### Scenario: Owner-scoped request 和 CAS 结果保持简单
- **WHEN** gateway port 读取或写入 owner-scoped durable fact
- **THEN** request MUST 直接包含 tenantId and subjectId, including unique-id lookup requests
- **AND** core contracts MUST NOT define a generic OwnerScope or GatewayLookupRequest base object
- **AND** system recovery or maintenance scans MUST use explicitly named system-scoped ports and MUST NOT reuse owner-scoped lookup contracts
- **AND** ordinary persistence writes MUST return the persisted object when the caller needs a value
- **AND** run version update、claim/fencing and pending input resolve MUST use a CAS result that distinguishes updated、version conflict and not found
- **AND** terminal commit MUST use a dedicated result that distinguishes committed、already committed、version conflict and not found
- **AND** infrastructure failures MUST be represented as gateway errors normalized by the error boundary, not as CAS result statuses

#### Scenario: Session and message stores expose client history read models
- **WHEN** channel lists sessions or loads a session conversation
- **THEN** core contracts MUST define SessionStoreGateway with loadSession、listSessions and saveSession(record, options?) operations
- **AND** listSessions MUST use gateway-owned SessionHistoryRecordQuery and return SessionHistoryPage
- **AND** core contracts MUST define SessionMessageStoreGateway with appendSessionMessage、loadMessage、listMessages、listCurrentRequestMessages and hideMessage operations
- **AND** appendSessionMessage MUST be the only public message write contract for the minimal kernel
- **AND** listMessages MUST use gateway-owned ListSessionMessagesRecordQuery and return SessionMessageRecordPage
- **AND** listCurrentRequestMessages MUST use ListCurrentRequestMessagesRecordQuery and return SessionMessageRecordPage
- **AND** core contracts MUST define ActiveContextStoreGateway with loadActiveContext、appendItem and commitCompaction operations
- **AND** active context append and compaction commit MUST use activeContextVersion for optimistic conflict detection
- **AND** SessionHistoryRecordQuery、ListSessionMessagesRecordQuery、ListCurrentRequestMessagesRecordQuery、active context requests and message lookup/write records MUST carry tenantId、subjectId and agentId on main-path facts

#### Scenario: Session message visibility is updated through hideMessage only
- **WHEN** runtime hides a superseded or replaced conversation message from the default history view
- **THEN** SessionMessageStoreGateway MUST expose hideMessage(HideMessageRequest)
- **AND** HideMessageRequest MUST contain tenantId、subjectId、messageId、reason、hiddenByContextId and idempotencyKey
- **AND** hiddenByContextId MUST be a RequestContextId
- **AND** hiddenAt MUST be assigned by the store using a controlled clock
- **AND** appendSessionMessage MUST NOT modify visibility fields of an existing message
- **AND** SessionMessageStoreGateway MUST NOT expose standalone saveMessage as a public message write contract
- **AND** hideMessage MUST be one-way and MUST NOT support unhide
- **AND** hiding an already hidden message MUST return the current persisted message without overwriting the original hide metadata
- **AND** hiding a missing message MUST return undefined
- **AND** default history queries MUST exclude hidden messages unless includeHidden is explicitly true
- **AND** visible=false MUST NOT be used as the model context removal mechanism; active context view owns model-visible context

#### Scenario: Timeline events use a durable store gateway
- **WHEN** runtime appends or queries canonical timeline events
- **THEN** core contracts MUST define RunTimelineEventStoreGateway
- **AND** appendEvent MUST use RunTimelineEventRecord plus write options and return RunTimelineEventRecord
- **AND** listEvents MUST use RunTimelineEventRecordQuery and return RunTimelineEventRecord records
- **AND** RunTimelineEventRecordQuery MUST use tenantId、subjectId、agentId、sessionId and afterSequence, with optional requestId and runId filters
- **AND** RunTimelineEventStoreGateway MUST NOT be represented by execution trace storage or channel replay buffers

#### Scenario: Attachment metadata and blob content use separate ports
- **WHEN** attachment runtime stores, validates, queries or cleans up uploaded content
- **THEN** core contracts MUST define AttachmentStoreGateway for RequestAttachmentRecord metadata, validationStatus, availabilityStatus and request/session/run association
- **AND** core contracts MUST define BlobStoreGateway as the shared opaque bytes store for attachments, artifacts, large capability results, model summaries and other large objects
- **AND** RequestAttachment.storageRef MUST be a BlobRef returned by BlobStoreGateway
- **AND** BlobRef MUST be opaque and MUST NOT be parsed, exposed as local path or treated as a business id by callers
- **AND** BlobStoreGateway MUST NOT own attachment status, artifact visibility, session/run binding, content parsing results or context descriptor generation
- **AND** attachment and artifact MUST remain separate durable facts with separate ids and metadata stores
