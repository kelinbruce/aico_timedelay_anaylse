## MODIFIED Requirements

### Requirement: Annotation list and query behavior
系统 SHALL 支持两个维度的标注查询：按 scope 分页列出被收藏的对话（turn 粒度），以及按 scope + session 列出会话内所有标注。收藏对话列表 MUST 只选择 `isFavorited=true` 的记录，MUST NOT 因 `isQuestionFavorited=true` 选择记录。收藏对话列表 MUST 按 `updated_at` 降序分页，每条返回 `sessionId`、`requestRunId`、`rootMessageId`、`questionPreview`（用户问题文本，截断至 `CONVERSATION_PREVIEW_TEXT_LIMIT`）、`questionTruncated`、`sessionTitle`、`sessionUpdatedAt` 和 `favoritedAt`。查询通过 LEFT JOIN `messages` 表获取用户问题文本（`role='USER'` 且 `visible=1`），当无匹配消息时 `questionPreview` 为空字符串、`rootMessageId` 回退为 `requestRunId`。gateway `listFavoriteTurns` 和 `listQuestionFavoriteTurns` SHALL 通过 LEFT JOIN `sessions` 表在单次 SQL 查询中返回 `sessionTitle`（映射自 `sessions.title`）和 `sessionUpdatedAt`（映射自 `sessions.updated_at`），MUST NOT 在应用层对每条 summary 单独调用 `sessionStore.loadSession` 补齐这两个字段（N+1 anti-pattern）。当 session 行不存在（LEFT JOIN 无匹配）时，`sessionTitle` MUST 为 `undefined`、`sessionUpdatedAt` MUST 回退为 `0`。会话内标注列表 MUST 返回 `annotationId`、`requestRunId`、`sentiment`、`isFavorited`、`isQuestionFavorited` 和 `createdAt`，按 `createdAt` 升序排列。

#### Scenario: Question favorite is excluded from favorite turns
- **WHEN** 当前 scope 仅有一条 `isFavorited=false` 且 `isQuestionFavorited=true` 的标注记录
- **AND** 调用方执行 `listFavoriteTurns`
- **THEN** 返回结果 MUST 为空

#### Scenario: Answer favorite remains in favorite turns
- **WHEN** 当前 scope 有一条 `isFavorited=true` 且 `isQuestionFavorited=false` 的标注记录
- **AND** 调用方执行 `listFavoriteTurns`
- **THEN** 返回结果 MUST 包含该记录对应的 turn

#### Scenario: List favorited turns paginated
- **WHEN** 用户 `(T1, U1, A1)` 请求收藏对话列表，`offset=0, limit=10`
- **AND** scope 下有 3 个 `isFavorited=true` 的标注记录
- **THEN** 返回 3 条结果，每条包含 `sessionId`、`requestRunId`、`rootMessageId`、`questionPreview`、`questionTruncated`、`sessionTitle`、`sessionUpdatedAt`、`favoritedAt`
- **AND** 结果按 `favoritedAt`（即 `updated_at`）降序排列

#### Scenario: Favorite turn with user question preview
- **WHEN** session `S1` 的 run `R1` 被收藏，且 `R1` 对应一条 `role='USER'` 且 `visible=1` 的消息
- **AND** 该消息内容为 "如何重置路由器？"
- **THEN** 返回的 `questionPreview` 为该消息内容（截断至限制长度）
- **AND** `rootMessageId` 为该消息的 `request_id`

#### Scenario: Favorite turn without matching user message
- **WHEN** session `S1` 的 run `R1` 被收藏
- **AND** `messages` 表中无 `role='USER'` 且 `visible=1` 且 `run_id=R1` 的消息
- **THEN** `questionPreview` 为空字符串

#### Scenario: Favorite turn returns session metadata via single query
- **WHEN** session `S1`（title="路由器故障诊断"，`updated_at=200`）的 run `R1` 被收藏
- **AND** 调用方执行 `listFavoriteTurns`
- **THEN** 返回的 `sessionTitle` MUST 为 "路由器故障诊断"
- **AND** `sessionUpdatedAt` MUST 为 `200`
- **AND** gateway MUST 在单次 SQL 查询中通过 LEFT JOIN `sessions` 表返回这两个字段
- **AND** 应用层 MUST NOT 对该 summary 单独调用 `sessionStore.loadSession`

#### Scenario: Favorite turn without matching session
- **WHEN** session `S1` 的 run `R1` 被收藏
- **AND** `sessions` 表中不存在 `S1` 的行（session 被删除但 annotation 行残留）
- **THEN** `sessionTitle` MUST 为 `undefined`
- **AND** `sessionUpdatedAt` MUST 为 `0`
