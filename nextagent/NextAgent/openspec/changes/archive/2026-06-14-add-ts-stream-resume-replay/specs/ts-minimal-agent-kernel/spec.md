## MODIFIED Requirements

### Requirement: Web Submit Stream And History
`agent-channel-web` SHALL 提供最小 submit、SSE stream 和 history read 行为。Web channel SHALL 只负责 transport、runtime facade 调用、runtime session-facing stream 订阅、Web DTO schema/projection 和 stream projection，不得拥有 request lifecycle、Agent routing、session contract、canonical replay truth 或 terminal history truth。

#### Scenario: Web route table 与最小范围一致
- **WHEN** 产品 Web API 启动
- **THEN** route registry MUST expose `GET /api/v1/sessions`
- **AND** route registry MUST expose `POST /api/v1/sessions`
- **AND** route registry MUST expose `GET /api/v1/sessions/{sessionId}/conversation`
- **AND** route registry MUST expose `POST /api/v1/sessions/{sessionId}/requests`
- **AND** route registry MUST expose `GET /api/v1/sessions/{sessionId}/stream`
- **AND** route registry MUST expose TS convenience submit `POST /api/v1/requests`
- **AND** route registry MUST expose `PUT /api/v1/sessions/{sessionId}/title`
- **AND** route registry MUST NOT expose `GET /api/v1/sessions/{sessionId}` in this change
- **AND** route registry MUST NOT expose WebSocket、user-input、cancel、retry、edit、attachment upload/download 或 feedback routes as product behavior in this change

#### Scenario: Submit 返回最小 accepted response
- **WHEN** Web channel 接受合法 submit request
- **THEN** channel MUST 从 auth/channel boundary 注入可信 identity
- **AND** channel MUST call runtime session/request boundaries and MUST NOT call `agent-session` directly
- **AND** channel MUST NOT define a channel-owned session abstraction
- **AND** channel MUST 调用 Runtime command boundary
- **AND** `RuntimeCommandPort.submit` command MUST 携带 `sessionId`
- **AND** session-scoped submit request body MUST require non-blank `inputText` and `idempotencyKey`
- **AND** submit request body MAY include `locale?` and `attachments?: []`
- **AND** public `attachments?: []` in this change MUST mean empty attachment id refs and MUST be mapped to core `attachmentIds=[]`
- **AND** `agent-channel-web` MUST be the only boundary that accepts the public `attachments?: []` compatibility field
- **AND** `agent-runtime`、`agent-session`、`agent-core` and gateway ports MUST NOT receive `attachments`; channel MUST normalize it to core `attachmentIds=[]` before calling Runtime command boundary
- **AND** TS convenience submit request body MAY include `sessionId?` in addition to the same submit fields
- **AND** submit request body containing client-provided `requestId`、`language`、`submittedAt`、owner 字段、agent 字段、metadata 或其他 non-minimal envelope fields MUST fail schema validation
- **AND** `attachmentIds` field, non-empty `attachments`, attachment object, upload ref or attachment metadata MUST fail runtime schema validation
- **AND** 本 change 中 `RuntimeCommandPort.submit` command 的 `attachmentIds` MUST 为空数组
- **AND** Runtime 持久化 `RequestRun`、session message、active context item、timeline event 和 terminal commit 时 MUST 使用核心契约定义的 `idempotencyKey`、`expectedVersion` 或 `expectedActiveContextVersion`
- **AND** accepted response MUST 只返回 `sessionId`、`requestId`、`runId` 和 `attempt`
- **AND** `POST /api/v1/requests` 与 `POST /api/v1/sessions/{sessionId}/requests` 成功时 MUST 返回相同 accepted DTO
- **AND** accepted response MUST NOT 返回 `streamPath`、`createdSession`、stream cursor、`acceptedSequence` 或 timeline sequence 字段

#### Scenario: SSE 从 runtime session-facing stream facade 投影
- **WHEN** 客户端在提交后打开 SSE stream
- **THEN** channel MUST 默认使用 `lastSeenSequence=0`，也可使用客户端当前页面生命周期内持有的 session-scoped cursor
- **AND** channel MUST 调用 `RuntimeSessionPort.streamEvents({ identityContext, sessionId, lastSeenSequence, requestId?, runId?, signal? })`
- **AND** channel MUST project runtime events to public `StreamEnvelope` rather than exposing runtime timeline records as Web DTOs
- **AND** optional `requestId/runId` MUST only be filters and MUST NOT reset session-scoped sequence
- **AND** channel MUST 将 canonical timeline event 投影为 `StreamEnvelope`
- **AND** stream event name MUST match shared canonical `StreamEventType` vocabulary
- **AND** 最小可投影子集 MUST include `REQUEST_ACCEPTED`、`LLM_THINKING_DELTA`、`LLM_CONTENT_DELTA`、`CAPABILITY_STARTED`、`CAPABILITY_RESULT_DELTA`、`CAPABILITY_COMPLETED`、`REQUEST_COMPLETED`、`REQUEST_FAILED` 和 `DEGRADATION_NOTICE`
- **AND** 未实现能力对应的 `REQUEST_CANCELED`、`REQUEST_SUPERSEDED`、`USER_INPUT_REQUIRED`、`USER_INPUT_RECEIVED`、`USER_INPUT_TIMEOUT` 和 `USER_INPUT_CANCELED` MUST NOT be produced by product path in this change
- **AND** channel MUST NOT 伪造与 runtime timeline 冲突的执行事实
- **AND** channel MUST NOT call lower-level timeline stores or a channel-owned replay buffer as the source of replay truth
- **AND** WebSocket transport equivalence is owned by `ts-web-sse-ws-transports` and MUST enter the same runtime session-facing stream path

#### Scenario: Conversation bootstrap exposes activeRun for refresh and new devices
- **WHEN** a client reads `GET /api/v1/sessions/{sessionId}/conversation`
- **THEN** the response MAY include top-level `activeRun`
- **AND** `activeRun`, when present, MUST contain only `requestId`, `runId`, and `status`
- **AND** `activeRun` MUST come from runtime session-facing `getActiveRun`
- **AND** Web channel MUST NOT infer `activeRun` from visible conversation messages

#### Scenario: History 通过 runtime session facade 读取
- **WHEN** 客户端读取 session list 或 conversation history
- **THEN** channel MUST call runtime session facade
- **AND** runtime MUST resolve trusted `agentId` and call `agent-session` `UserSessionPort`
- **AND** `agent-session` MUST 将 domain `ListUserSessionsQuery` 映射为 gateway-owned `SessionHistoryRecordQuery` 后调用 `SessionStoreGateway.listSessions(...)`
- **AND** `agent-session` MUST 将 domain `ListSessionMessagesQuery` 映射为 gateway-owned `ListSessionMessagesRecordQuery` 后调用 `SessionMessageStoreGateway.listMessages(...)`
- **AND** public `GET /api/v1/sessions` query MUST only allow `offset?` and `limit?`
- **AND** `SessionHistoryRecordQuery` MUST 携带 `tenantId`、`subjectId`、`agentId`、`offset` 和 `limit`
- **AND** `SessionHistoryRecordQuery` MUST NOT contain `includeSuperseded`
- **AND** session list MUST be stably ordered by `updatedAt desc, sessionId asc`
- **AND** session list response MUST contain `entries`、`offset`、`limit` and `hasMore`
- **AND** each session list entry MUST contain only `sessionId`、`displayTitle` and `lastActivityAt`
- **AND** session list entry `displayTitle` MUST be projected from internal `title?` or a safe default title
- **AND** session list entry `lastActivityAt` MUST be projected from internal `updatedAt`
- **AND** `agent-channel-web` MUST be the only boundary that exposes public `displayTitle` and `lastActivityAt` compatibility names
- **AND** `agent-session` and gateway/internal contracts MUST use canonical/internal fields such as `title?` and `updatedAt`, and MUST NOT receive or return public session list alias names
- **AND** `agent-session` and gateway/internal contracts MUST NOT return non-minimal session list summary fields such as `lastMessagePreview`、`lastRequestStatus` or `hasInFlightRequest`
- **AND** session list response MUST NOT expose `tenantId`、`subjectId`、`agentId`、`includeSuperseded`、`nextCursor`、`title`、`updatedAt`、`lastMessagePreview`、`lastRunStatus`、`hasInFlightRequest`、stream path、websocket path or conversation messages
- **AND** `ListSessionMessagesRecordQuery` MUST 携带 `tenantId`、`subjectId`、`agentId`、`sessionId`、可选 `requestId`、可选 `locale`、固定 `includeHidden=false`、`includeCapabilityResults`、可选 `beforeCursor` 和 `limit`
- **AND** conversation history MUST default to latest visible message window
- **AND** conversation response items MUST be ordered by `createdAt asc, messageId asc`
- **AND** public conversation query MUST use `cursor?` as the older-record cursor and map it to internal `beforeCursor`
- **AND** internal conversation page MUST return optional `nextBeforeCursor`; channel MUST project it to public `nextCursor`
- **AND** conversation response MUST return `nextCursor` for loading older records and MUST set it to null or omit it when no older records remain
- **AND** `agent-channel-web` MUST be the only boundary that exposes public `cursor` and `nextCursor` compatibility names
- **AND** `agent-session` and gateway/internal contracts MUST use `beforeCursor` and `nextBeforeCursor` for older-record pagination, and MUST NOT receive or return public conversation cursor alias names
- **AND** public Web API MUST NOT expose `includeHidden`
- **AND** `includeCapabilityResults` MUST default to `false`
- **AND** history MUST 使用 visible `SessionMessage` records 作为最终对话内容来源
- **AND** Web channel MUST NOT reconstruct final history from stream envelopes, projection cache, or timeline replay
