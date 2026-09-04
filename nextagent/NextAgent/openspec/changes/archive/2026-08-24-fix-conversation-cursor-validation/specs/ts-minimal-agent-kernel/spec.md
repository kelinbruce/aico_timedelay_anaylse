## Function

- **所属 Function**：`FN-1.8 查看会话消息`
- **Function 变更类型**：`MODIFIED`
- **spec 角色**：主规格

## ADDED Requirements

### Requirement: Conversation cursor and anchor existence validation

`UserSessionService.listMessages` MUST validate that a supplied `beforeCursor` (`cursor`), `afterCursor` (`newerCursor`), or `anchorMessageId` resolves to a message within the requested session `(tenantId, subjectId, agentId, sessionId)` before delegating to the message store. The validation SHALL perform a same-session message lookup keyed by the cursor/anchor message ID (reusing the existing message-store `loadMessage` port); a cursor/anchor that does not resolve, or that resolves to a message whose `sessionId` differs from the requested session (cross-session), MUST fail closed by throwing `AgentError { code: "SESSION_MESSAGE_ANCHOR_NOT_FOUND", category: "NOT_FOUND", retryable: false }`, which the Web channel projects to HTTP `404`.

For `anchorMessageId`, the service MUST additionally fail closed when the message store returns an empty visible page after a resolving lookup (covering the case where a backing store returns an empty set for a hidden anchor); it MUST NOT return `200` with `items: []`. For `beforeCursor`/`afterCursor`, a cursor that resolves but yields no older/newer visible messages (paging boundary) MUST return `200` with an empty items page and `hasMore: false`, and MUST NOT be treated as not-found. A hidden cursor (resolves via the lookup but is filtered out by `includeHidden=false`) is treated as a paging boundary, not an error.

The `cursor`, `newerCursor`, and `anchorMessageId` public query parameters MUST each be 1–64 characters. The Web channel MUST reject a value exceeding 64 characters at the web boundary with HTTP `400` and a field-level `REQUEST_VALIDATION_FAILED` message (`<field> must not exceed 64 characters.`), and MUST NOT forward the value to the backing message store. The three parameters MUST NOT be combined in one request.

**需求类别**：功能性需求

#### Scenario: Non-existent anchor fails closed even on an empty store page
- **WHEN** `listMessages` is called with `anchorMessageId` that does not resolve within the session, or resolves but the store returns an empty visible page
- **THEN** the service MUST throw `SESSION_MESSAGE_ANCHOR_NOT_FOUND`
- **AND** the Web API MUST return `404` and MUST NOT return `200` with `items: []`

#### Scenario: Non-existent cursor or newerCursor fails closed
- **WHEN** `listMessages` is called with `beforeCursor` or `afterCursor` whose message does not resolve within the session (forged, deleted, or cross-session)
- **THEN** the service MUST throw `SESSION_MESSAGE_ANCHOR_NOT_FOUND`
- **AND** the Web API MUST return `404` and MUST NOT return `200` with `items: []`

#### Scenario: Paging boundary returns an empty page
- **WHEN** `listMessages` is called with a `beforeCursor` or `afterCursor` that resolves within the session, and no older/newer visible messages remain
- **THEN** the service MUST return `200` with `items: []` and `hasMore: false`
- **AND** it MUST NOT throw `SESSION_MESSAGE_ANCHOR_NOT_FOUND`

#### Scenario: Cursor or anchor exceeding 64 characters is rejected at the web boundary
- **WHEN** the Web channel receives `cursor`, `newerCursor`, or `anchorMessageId` exceeding 64 characters
- **THEN** it MUST return `400` with a field-level `REQUEST_VALIDATION_FAILED` message
- **AND** it MUST NOT forward the value to the message store

## Function 变更汇总

### 处理过程

- **变更类型**：修改
- **目标内容**：`UserSessionService.listMessages` 在 `messageStore.listMessages` 之前对 `anchorMessageId`/`beforeCursor`/`afterCursor` 执行同会话 `loadMessage` 解析预检，未解析或跨会话时抛 `SESSION_MESSAGE_ANCHOR_NOT_FOUND`；`anchorMessageId` 模式下 store 返回空页时同样抛错。
- **依据 Requirements**：`Conversation cursor and anchor existence validation`

### 结果

- **变更类型**：修改
- **目标内容**：三游标字段指向本会话内不存在或跨会话的消息时统一返回 `404 SESSION_MESSAGE_ANCHOR_NOT_FOUND`；翻页边界空集保留 `200`。
- **依据 Requirements**：`Conversation cursor and anchor existence validation`

### 规格

- **规格项**：conversation 游标/锚点长度上限
- **变更类型**：新增
- **原规格值**：不适用（新增）
- **目标规格值**：`cursor`/`newerCursor`/`anchorMessageId` 各为 1–64 字符，>64 在 web 边界返回字段级 400，不转发至 message store。
- **依据 Requirements**：`Conversation cursor and anchor existence validation`
