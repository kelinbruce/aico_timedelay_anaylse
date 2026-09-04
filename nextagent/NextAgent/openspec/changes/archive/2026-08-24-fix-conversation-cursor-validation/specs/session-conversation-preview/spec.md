## Function

- **所属 Function**：`FN-1.8 查看会话消息`
- **Function 变更类型**：`MODIFIED`
- **spec 角色**：主规格

## ADDED Requirements

### Requirement: Stale or hidden cursor/anchor fails safely

For `GET /api/v1/sessions/{sessionId}/conversation`, the Web channel MUST validate that a supplied `cursor`, `newerCursor`, or `anchorMessageId` resolves to a message within the requested session under the trusted owner and Agent scope before returning a conversation page. The validation SHALL use a same-session message lookup keyed by the cursor/anchor message ID; a cursor/anchor that does not resolve, or that resolves to a message belonging to a different session, MUST fail closed and the Web API SHALL return `404` with `SafeError { code: "SESSION_MESSAGE_ANCHOR_NOT_FOUND", category: "NOT_FOUND", retryable: false }`.

This applies to all three cursor modes:
- `anchorMessageId` MUST fail closed when the anchor message is stale, hidden, deleted, cross-owner, cross-agent, cross-session, or otherwise unavailable; it MUST NOT silently fall back to the latest conversation window as if the anchor succeeded, and MUST NOT expose hidden or cross-scope message content.
- `cursor` (older-record) and `newerCursor` (newer-record) MUST fail closed with `SESSION_MESSAGE_ANCHOR_NOT_FOUND` when the cursor message does not resolve within the session. A cursor that resolves but has no older/newer visible messages remaining (paging boundary) MUST return `200` with an empty items page and `hasMore: false`, and MUST NOT be treated as not-found.

The `cursor`, `newerCursor`, and `anchorMessageId` query parameters MUST each be 1–64 characters; the Web channel MUST reject a value exceeding 64 characters with `400` and a field-level `REQUEST_VALIDATION_FAILED` message. The three parameters MUST NOT be combined in one request.

**需求类别**：功能性需求

#### Scenario: Stale or hidden anchor fails safely
- **GIVEN** a preview marker references a message that later becomes hidden, deleted, or unavailable to the current owner or Agent scope
- **WHEN** the client requests `conversation?anchorMessageId=<messageId>`
- **THEN** Web API SHALL return `404` with `SafeError { code: "SESSION_MESSAGE_ANCHOR_NOT_FOUND" }`
- **AND** it MUST NOT silently fall back to the latest conversation window as if the anchor succeeded
- **AND** it MUST NOT expose hidden or cross-scope message content

#### Scenario: Non-existent anchor returns 404 even when the store returns an empty page
- **WHEN** the client requests `conversation?anchorMessageId=<messageId>` and the anchor does not resolve within the session (including a hidden anchor whose message-store lookup returns an empty visible page)
- **THEN** Web API SHALL return `404` with `SafeError { code: "SESSION_MESSAGE_ANCHOR_NOT_FOUND" }`
- **AND** it MUST NOT return `200` with `items: []`

#### Scenario: Non-existent cursor or newerCursor returns 404
- **WHEN** the client requests `conversation?cursor=<messageId>` or `conversation?newerCursor=<messageId>` and the cursor message does not resolve within the session (forged, deleted, or cross-session)
- **THEN** Web API SHALL return `404` with `SafeError { code: "SESSION_MESSAGE_ANCHOR_NOT_FOUND" }`
- **AND** it MUST NOT return `200` with `items: []`

#### Scenario: Paging boundary still returns an empty page
- **WHEN** the client requests `conversation?cursor=<messageId>` or `conversation?newerCursor=<messageId>`, the cursor resolves within the session, and no older/newer visible messages remain beyond it
- **THEN** Web API SHALL return `200` with `items: []` and `hasMore: false`
- **AND** it MUST NOT return `404`

#### Scenario: Cursor or anchor exceeding 64 characters returns 400
- **WHEN** the client requests `conversation?cursor=<over-64>` (or `newerCursor`/`anchorMessageId` exceeding 64 characters)
- **THEN** Web API SHALL return `400` with `REQUEST_VALIDATION_FAILED` and a field-level message (`cursor must not exceed 64 characters.` / `newerCursor must not exceed 64 characters.` / `anchorMessageId must not exceed 64 characters.`)
- **AND** it MUST NOT forward the value to the backing message store

## Function 变更汇总

### 处理过程

- **变更类型**：修改
- **目标内容**：`UserSessionService.listMessages` 在查询 message store 之前对 `anchorMessageId`/`cursor`(`beforeCursor`)/`newerCursor`(`afterCursor`) 执行同会话解析预检；未解析或跨会话时抛 `SESSION_MESSAGE_ANCHOR_NOT_FOUND`。`anchorMessageId` 模式下 store 返回空页时同样抛错。`cursor`/`newerCursor` 解析通过但无更旧/更新消息时仍返回 200 空页。
- **依据 Requirements**：`Stale or hidden cursor/anchor fails safely`

### 结果

- **变更类型**：修改
- **目标内容**：三字段指向本会话内不存在或跨会话的消息时统一返回 `404 SESSION_MESSAGE_ANCHOR_NOT_FOUND`，不再返回 `200 items: []`；翻页边界空集行为保留。
- **依据 Requirements**：`Stale or hidden cursor/anchor fails safely`

### 规格

- **规格项**：conversation 游标/锚点长度上限
- **变更类型**：新增
- **原规格值**：不适用（新增）
- **目标规格值**：`cursor`/`newerCursor`/`anchorMessageId` 各为 1–64 字符，>64 在 web 边界返回字段级 400，不转发至 message store。
- **依据 Requirements**：`Stale or hidden cursor/anchor fails safely`
