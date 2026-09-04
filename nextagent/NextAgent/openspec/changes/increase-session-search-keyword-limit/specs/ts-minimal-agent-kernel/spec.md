## MODIFIED Requirements

### Requirement: Web Submit Stream And History
TS Web channel SHALL expose the minimal session/create/list/conversation/submit/stream path through runtime-owned boundaries. Web channel SHALL own HTTP/SSE/WebSocket transport schema and public DTO projection, but SHALL NOT own request lifecycle, canonical timeline replay truth, session history source, or runtime terminal state.

#### Scenario: Web route table 与最小范围一致
- **WHEN** Web channel registers product routes
- **THEN** route registry MUST expose `POST /api/v1/sessions`
- **AND** route registry MUST expose `GET /api/v1/sessions`
- **AND** route registry MUST expose `GET /api/v1/sessions/{sessionId}/conversation`
- **AND** route registry MUST expose `GET /api/v1/sessions/{sessionId}/conversation/preview`
- **AND** route registry MUST expose `POST /api/v1/sessions/{sessionId}/requests`
- **AND** route registry MUST expose `GET /api/v1/sessions/{sessionId}/stream`
- **AND** route registry MUST expose TS convenience submit `POST /api/v1/requests`
- **AND** route registry MUST expose `PUT /api/v1/sessions/{sessionId}/title`
- **AND** route registry MUST NOT expose `GET /api/v1/sessions/{sessionId}` in this change
- **AND** route registry MUST NOT expose global `GET /api/v1/search`, `GET /api/v1/sessions/search`, or `GET /api/v1/sessions/{sessionId}/conversation/search` in this change
- **AND** route registry MUST NOT expose WebSocket, user-input, cancel, retry, edit, attachment upload/download, or feedback routes as product behavior in the minimal kernel scope unless another active spec explicitly owns them

#### Scenario: Submit 返回最小 accepted response
- **WHEN** Web channel accepts a legal submit request
- **THEN** channel MUST inject trusted identity from the auth/channel boundary
- **AND** channel MUST call runtime session/request boundaries and MUST NOT call `agent-session` directly
- **AND** channel MUST NOT define a channel-owned session abstraction
- **AND** channel MUST call Runtime command boundary
- **AND** `RuntimeCommandPort.submit` command MUST carry `sessionId`
- **AND** session-scoped submit request body MUST require non-blank `inputText` and `idempotencyKey`
- **AND** submit request body MAY include `locale?`、`attachments?: []`，以及 `modelOptions?: { thinking?: { depth?: "OFF" } }`
- **AND** public `attachments?: []` in this requirement MUST mean empty attachment id refs and MUST be mapped to core `attachmentIds=[]`
- **AND** `agent-channel-web` MUST be the only boundary that accepts the public `attachments?: []` compatibility field
- **AND** `agent-runtime`, `agent-session`, `agent-core`, and gateway ports MUST NOT receive `attachments`; channel MUST normalize it to core `attachmentIds=[]` before calling Runtime command boundary
- **AND** channel MUST normalize `modelOptions` to runtime-owned typed `requestModelOptions` before calling Runtime command boundary
- **AND** TS convenience submit request body MAY include `sessionId?` in addition to the same submit fields
- **AND** submit request body containing client-provided `requestId`, `language`, `submittedAt`, owner fields, agent fields, metadata, or other non-minimal envelope fields MUST fail schema validation
- **AND** `attachmentIds` field, non-empty `attachments`, attachment object, upload ref, or attachment metadata MUST fail runtime schema validation
- **AND** `modelOptions` containing `temperature`、`topP`、`maxOutputTokens`、non-`OFF` thinking depth、provider-private reasoning object or any unknown field MUST fail schema validation
- **AND** in this requirement `RuntimeCommandPort.submit` command `attachmentIds` MUST be an empty array
- **AND** Runtime persistence for `RequestRun`, session message, active context item, timeline event, and terminal commit MUST use core contract defined `idempotencyKey`, `expectedVersion`, or `expectedActiveContextVersion`
- **AND** accepted response MUST return only `sessionId`, `requestId`, `runId`, and `attempt`
- **AND** `POST /api/v1/requests` and `POST /api/v1/sessions/{sessionId}/requests` MUST return the same accepted DTO on success
- **AND** accepted response MUST NOT return `streamPath`, `createdSession`, stream cursor, `acceptedSequence`, or timeline sequence fields

#### Scenario: SSE 从 runtime session-facing stream facade 投影
- **WHEN** a client opens SSE stream for a visible session
- **THEN** channel MUST call `RuntimeSessionPort.streamEvents({ identityContext, sessionId, lastSeenSequence?, requestId?, runId?, signal? })`
- **AND** channel MUST pass `lastSeenSequence` only when the client explicitly provides the query parameter
- **AND** frontend product paths MUST explicitly provide `lastSeenSequence` only for a verified in-memory cursor, activeRun bootstrap, accepted-run bounded recovery, or intentional explicit replay
- **AND** cold-start product paths for refresh, new tab, new device, or ordinary session switch MUST load conversation bootstrap before opening an ordinary session-level stream
- **AND** channel MUST NOT synthesize `lastSeenSequence=0` when a session-scoped stream omits the query parameter
- **AND** omitted `lastSeenSequence` with no `requestId/runId` MUST be treated as session live-tail rather than replay from the beginning
- **AND** optional `requestId/runId` MUST only be filters and MUST NOT reset session-scoped sequence
- **AND** channel MUST project runtime events to public `StreamEnvelope` rather than exposing runtime timeline records as Web DTOs
- **AND** stream event name MUST match shared canonical `StreamEventType` vocabulary
- **AND** minimal projectable subset MUST include `REQUEST_ACCEPTED`, `LLM_THINKING_DELTA`, `LLM_CONTENT_DELTA`, `CAPABILITY_STARTED`, `CAPABILITY_RESULT_DELTA`, `CAPABILITY_COMPLETED`, `REQUEST_COMPLETED`, `REQUEST_FAILED`, and `DEGRADATION_NOTICE`
- **AND** unimplemented capability-related `REQUEST_CANCELED`, `REQUEST_SUPERSEDED`, `USER_INPUT_REQUIRED`, `USER_INPUT_RECEIVED`, `USER_INPUT_TIMEOUT`, and `USER_INPUT_CANCELED` MUST NOT be produced by product path unless an owning spec enables them
- **AND** channel MUST NOT fabricate execution facts that conflict with runtime timeline
- **AND** channel MUST NOT call lower-level timeline stores or a channel-owned replay buffer as the source of replay truth
- **AND** WebSocket transport equivalence is owned by `ts-web-sse-ws-transports` and MUST enter the same runtime session-facing stream path

#### Scenario: Conversation bootstrap exposes activeRun for refresh and new devices
- **WHEN** a client reads `GET /api/v1/sessions/{sessionId}/conversation`
- **THEN** the response MAY include top-level `activeRun`
- **AND** `activeRun`, when present, MUST contain only `requestId`, `runId`, and `status`
- **AND** `activeRun` MUST come from runtime session-facing `getActiveRun`
- **AND** Web channel MUST NOT infer `activeRun` from visible conversation messages
- **AND** frontend cold-start bootstrap MUST use conversation as the initial history source before opening ordinary no-cursor live-tail
- **AND** after ordinary no-cursor live-tail is established, frontend MUST perform one opening conversation reconcile to cover committed messages or activeRun state that appeared between the initial conversation snapshot and the live-tail boundary

#### Scenario: History 通过 runtime session facade 读取
- **WHEN** client reads session list, conversation history, or conversation preview
- **THEN** channel MUST call runtime session facade
- **AND** runtime MUST resolve trusted `agentId` and call `agent-session` `UserSessionPort`
- **AND** `agent-session` MUST map domain `ListUserSessionsQuery` to gateway-owned `SessionHistoryRecordQuery` before calling `SessionStoreGateway.listSessions(...)`
- **AND** `agent-session` MUST map domain `ListSessionMessagesQuery` to gateway-owned `ListSessionMessagesRecordQuery` before calling `SessionMessageStoreGateway.listMessages(...)`
- **AND** `agent-session` MUST map domain conversation preview/query to gateway-owned message-store query before calling gateway
- **AND** public `GET /api/v1/sessions` query MUST allow only `offset?`, `limit?`, `q?`, `createdFrom?`, and `createdTo?`
- **AND** non-empty `q.trim()` MUST be mapped by `agent-channel-web` to canonical `questionSearchText` before runtime/session/gateway contracts are called only when it is at most 200 Unicode code points
- **AND** omitted `q` or trim-empty `q` MUST NOT produce `questionSearchText` in runtime/session/gateway contracts
- **AND** `q.trim()` with length greater than 200 Unicode code points MUST fail Web API validation before runtime/session/gateway contracts are called
- **AND** `createdFrom` and `createdTo` MUST be mapped by `agent-channel-web` to canonical `createdAtFrom` and `createdAtTo` before runtime/session/gateway contracts are called only when both are present, `createdFrom <= createdTo`, and their epoch millis span does not exceed 90 days minus 1 millisecond
- **AND** invalid or partial `createdFrom/createdTo` ranges MUST fail Web API validation before runtime/session/gateway contracts are called
- **AND** when neither a legal trim-non-empty `q` nor a complete `createdFrom/createdTo` range is present, the pre-existing session-list default limit behavior MUST be preserved
- **AND** when a legal trim-non-empty `q` or a complete `createdFrom/createdTo` range is present and `limit` is omitted, the search list page size MUST default to 20
- **AND** search queries MUST reject `limit` values greater than 50
- **AND** `SessionHistoryRecordQuery` MUST carry trusted `tenantId`, `subjectId`, `agentId`, `offset`, `limit`, optional `questionSearchText`, and optional `createdAtFrom/createdAtTo`
- **AND** `SessionHistoryRecordQuery` MUST NOT contain `includeSuperseded`
- **AND** session list MUST be stably ordered by `updatedAt desc, sessionId asc`
- **AND** session list response MUST contain `entries`, `offset`, `limit`, and `hasMore`
- **AND** each session list entry MUST contain `sessionId`, `displayTitle`, `lastActivityAt`, and `hasInFlightRequest`
- **AND** each session list entry MAY contain `lastRunStatus`
- **AND** search MUST preserve the existing session list entry response field set rather than adding a search-specific entry DTO or removing existing run-state summary fields
- **AND** session list entry `displayTitle` MUST be projected from internal `title?` or a safe default title
- **AND** session list entry `lastActivityAt` MUST be projected from internal `updatedAt`
- **AND** `agent-channel-web` MUST be the only boundary that exposes public `displayTitle` and `lastActivityAt` compatibility names
- **AND** `agent-session` and gateway/internal contracts MUST use canonical/internal fields such as `title?` and `updatedAt`, and MUST NOT receive or return public session list alias names
- **AND** session list response MUST NOT expose `tenantId`, `subjectId`, `agentId`, `includeSuperseded`, `nextCursor`, `title`, `updatedAt`, `latestRunStatus`, `lastMessagePreview`, `lastRequestStatus`, stream path, websocket path, matched text, highlights, result count, snippets, or conversation messages
- **AND** `ListSessionMessagesRecordQuery` MUST carry `tenantId`, `subjectId`, `agentId`, `sessionId`, optional `requestId`, optional `locale`, fixed `includeHidden=false`, `includeCapabilityResults`, optional `beforeCursor`, optional `afterCursor`, optional `anchorMessageId`, and `limit`
- **AND** conversation history MUST default to latest visible message window
- **AND** conversation response items MUST be ordered by `createdAt asc, messageId asc`
- **AND** public conversation query MUST use `cursor?` as the older-record cursor and map it to internal `beforeCursor`
- **AND** public conversation query MAY use `newerCursor?` to load records newer than the current newest boundary
- **AND** public `newerCursor?` MUST map to internal `afterCursor?`
- **AND** public conversation query MAY use `anchorMessageId?` to load a continuous visible message window containing that message
- **AND** `cursor?`, `newerCursor?`, and `anchorMessageId?` MUST NOT be combined in one request
- **AND** existing public `includeCapabilityResults?` query semantics MUST be preserved for conversation reads, default to `false`, and MAY be combined with latest, older, newer, or anchor reads without changing scope, anchor validation, window continuity, or cursor semantics
- **AND** internal conversation page MUST return optional `nextBeforeCursor` and optional `newerCursor`; channel MUST project `nextBeforeCursor` to public `nextCursor` for compatibility
- **AND** conversation response MUST return `nextCursor` for loading older records and MUST set it to null or omit it when no older records remain
- **AND** conversation response MAY return `newerCursor` for loading newer records and MUST set it to null or omit it when no newer records remain
- **AND** conversation response MUST NOT include `windowMode`
- **AND** conversation response MUST NOT include `anchor`
- **AND** anchored conversation history MUST return one continuous visible message window around the anchor message
- **AND** anchored conversation history MUST NOT stitch a latest window and an earlier window together when messages between them are not loaded
- **AND** stale, hidden, deleted, cross-owner, or cross-agent `anchorMessageId` MUST fail closed and MUST NOT fall back to latest history as if anchor loading succeeded
- **AND** `agent-channel-web` MUST be the only boundary that exposes public `cursor` and `nextCursor` compatibility names
- **AND** `agent-session` and gateway/internal contracts MUST preserve existing `beforeCursor`/`nextBeforeCursor` older-record pagination names, use internal `afterCursor` for newer-record queries, return `newerCursor` for newer-record pagination, and MUST NOT receive or return public conversation older cursor alias names
- **AND** public `GET /api/v1/sessions/{sessionId}/conversation/preview` query MUST require explicit `limit` and MAY accept explicit `offset`
- **AND** public preview query without `offset` MUST return the latest preview marker window and report the actual effective `offset`
- **AND** public preview query MUST reject search, date, cursor, `includeCapabilityResults`, position, or search-total parameters
- **AND** public preview query MUST reject negative `offset`, non-positive `limit`, or `limit` greater than 500
- **AND** conversation preview MUST create markers only from visible USER messages in the requested session under the trusted owner and Agent scope
- **AND** conversation preview response MUST contain only `sessionId`, `totalMarkers`, `offset`, `limit`, and `markers`
- **AND** `totalMarkers` MUST represent the current-session visible USER marker count under the trusted owner and Agent scope
- **AND** each conversation preview marker MUST contain `messageId`, optional `requestId`, `createdAt`, bounded `previewText`, and `previewTruncated`
- **AND** each conversation preview marker MAY contain bounded `answerPreviewText` and `answerPreviewTruncated` only when a visible ASSISTANT message exists for the same request
- **AND** conversation preview MUST server-truncate `previewText` and `answerPreviewText` to at most 300 Unicode code points before the Web response without splitting surrogate pairs
- **AND** conversation preview MUST support sessions with more than 100 visible USER markers through valid `offset` and `limit` pages
- **AND** conversation preview MUST NOT sample markers or return random/partial marker data that does not correspond to the requested page
- **AND** conversation preview response MUST NOT include `markersComplete`, `markerLimit`, highlight, rank, position ratio, tool/Capability result text, hidden content, or conversation items
- **AND** public Web API MUST NOT expose `includeHidden`
- **AND** `includeCapabilityResults` MUST default to `false`
- **AND** history MUST use visible `SessionMessage` records as the final conversation content source
- **AND** Web channel MUST NOT reconstruct final history from stream envelopes, projection cache, or timeline replay
