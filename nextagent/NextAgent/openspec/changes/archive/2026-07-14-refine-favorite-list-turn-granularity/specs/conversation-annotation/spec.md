## MODIFIED Requirements

### Requirement: Annotation list and query behavior

系统 SHALL 支持两个维度的标注查询：按 scope 分页列出被收藏的对话（turn 粒度），以及按 scope + session 列出会话内所有标注。收藏对话列表 MUST 按 `updated_at` 降序分页，每条返回 `sessionId`、`requestRunId`、`rootMessageId`、`questionPreview`（用户问题文本，截断至 `CONVERSATION_PREVIEW_TEXT_LIMIT`）、`questionTruncated`、`sessionTitle`、`sessionUpdatedAt` 和 `favoritedAt`。查询通过 LEFT JOIN `messages` 表获取用户问题文本（`role='USER'` 且 `visible=1`），当无匹配消息时 `questionPreview` 为空字符串、`rootMessageId` 回退为 `requestRunId`。会话内标注列表 MUST 返回 `annotationId`、`requestRunId`、`sentiment`、`isFavorited`、`comment` 和 `createdAt`，按 `createdAt` 升序排列。

#### Scenario: List favorited turns paginated
- **WHEN** 用户 `(T1, U1, A1)` 请求收藏对话列表，`offset=0, limit=10`
- **AND** scope 下有 3 个 `isFavorited=true` 的标注记录
- **THEN** 返回 3 条结果，每条包含 `sessionId`、`requestRunId`、`rootMessageId`、`questionPreview`、`questionTruncated`、`favoritedAt`
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
- **AND** `rootMessageId` 回退为 `requestRunId`

#### Scenario: List session annotations for icon state
- **WHEN** 用户打开 session `S1` 的对话视图
- **AND** 请求 `GET /api/v1/sessions/S1/annotations`
- **THEN** 返回 `S1` 下所有标注记录
- **AND** 结果按 `createdAt` 升序排列
