## MODIFIED Requirements

### Requirement: Web Submit Stream And History

`agent-channel-web` SHALL 提供最小 submit、SSE stream 和 history read 行为。Web channel SHALL 只负责 transport、runtime facade 调用、runtime session-facing stream 订阅、Web DTO schema/projection 和 stream projection，不得拥有 request lifecycle、Agent routing、session contract、canonical replay truth 或 terminal history truth。

本 change 仅修改 `GET /api/v1/sessions` 的 public session-list query allowance。它不得新增全局 `/search` route、`/api/v1/sessions/search` route、session detail route、stream cursor shape、conversation preview/anchor query 或 session-list search DTO，也不得因为搜索删除归档或实现时已经存在的 session-list response 字段。

#### Scenario: History 通过 runtime session facade 读取
- **WHEN** 客户端读取 session list
- **THEN** channel MUST call runtime session facade
- **AND** runtime MUST resolve trusted `agentId` and call `agent-session` `UserSessionPort`
- **AND** `agent-session` MUST 将 domain `ListUserSessionsQuery` 映射为 gateway-owned `SessionHistoryRecordQuery` 后调用 `SessionStoreGateway.listSessions(...)`
- **AND** public `GET /api/v1/sessions` query MUST allow only `offset?`, `limit?`, `q?`, `createdFrom?`, and `createdTo?`
- **AND** non-empty `q.trim()` MUST be mapped by `agent-channel-web` to canonical `questionSearchText` before runtime/session/gateway contracts are called only when it is at most 50 Unicode code points and either all ASCII with length at least 3 or contains any non-ASCII code point with length at least 2
- **AND** omitted `q` or trim-empty `q` MUST NOT produce `questionSearchText` in runtime/session/gateway contracts
- **AND** `q.trim()` with length 1, all-ASCII length 2, or length greater than 50 Unicode code points MUST fail Web API validation before runtime/session/gateway contracts are called
- **AND** `createdFrom` and `createdTo` MUST be mapped by `agent-channel-web` to canonical `createdAtFrom` and `createdAtTo` before runtime/session/gateway contracts are called only when both are present, `createdFrom <= createdTo`, and their epoch millis span does not exceed 90 days minus 1 millisecond
- **AND** invalid or partial `createdFrom/createdTo` ranges MUST fail Web API validation before runtime/session/gateway contracts are called
- **AND** when neither a legal trim-non-empty `q` nor a complete `createdFrom/createdTo` range is present, the pre-existing session-list default limit behavior MUST be preserved
- **AND** when a legal trim-non-empty `q` or a complete `createdFrom/createdTo` range is present and `limit` is omitted, the search list page size MUST default to 20
- **AND** search queries MUST reject `limit` values greater than 50
- **AND** `SessionHistoryRecordQuery` MUST carry trusted `tenantId`, `subjectId`, `agentId`, `offset`, `limit`, optional `questionSearchText`, and optional `createdAtFrom/createdAtTo`
- **AND** `SessionHistoryRecordQuery` MUST NOT contain `includeSuperseded`
- **AND** session list MUST be stably ordered by `updatedAt desc, sessionId asc`
- **AND** session list response MUST contain `entries`, `offset`, `limit`, and `hasMore`
- **AND** this change MUST preserve the existing session list entry response field set rather than adding a search-specific entry DTO or removing existing run-state summary fields
- **AND** session list entry `displayTitle` MUST be projected from internal `title?` or a safe default title
- **AND** session list entry `lastActivityAt` MUST be projected from internal `updatedAt`
- **AND** `agent-channel-web` MUST be the only boundary that exposes public `displayTitle` and `lastActivityAt` compatibility names
- **AND** `agent-session` and gateway/internal contracts MUST use canonical/internal fields such as `title?` and `updatedAt`, and MUST NOT receive or return public session list alias names
- **AND** this change MUST NOT introduce non-existing session list summary fields such as `lastMessagePreview` or `lastRequestStatus`
- **AND** session list response MUST NOT expose `tenantId`、`subjectId`、`agentId`、`includeSuperseded`、`nextCursor`、`title`、`updatedAt`、`lastMessagePreview`、stream path、websocket path、matched text、highlights、result count、snippets or conversation messages
