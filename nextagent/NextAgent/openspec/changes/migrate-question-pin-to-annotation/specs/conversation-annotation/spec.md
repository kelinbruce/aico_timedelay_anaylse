## MODIFIED Requirements

### Requirement: Conversation annotation persistence and scope isolation

系统 SHALL 通过专用 `ConversationAnnotationStoreGateway` persistence port 持久化对话标注事实。每个 `requestRunId` 对应一行标注记录，标注锚定为 `requestRunId`，三元 scope `(tenantId, subjectId, agentId)` 隔离。`tenantId` 和 `subjectId` 来自可信 channel/auth boundary 的 `IdentityContext`，`agentId` 来自可信 app composition 或已持久化 session/run binding。请求体、模型输出、capability 参数或客户端 metadata 不得覆盖标注的 owner scope 或 agent scope。

`ConversationAnnotationRecord` 是 gateway-owned persistence DTO，MUST `extends OwnerScoped` 并包含 `agentId: AgentId`。记录包含 `annotationId`、`sessionId`、`requestRunId`、`sentiment`（`"UP" | "DOWN" | null`）、`isFavorited`、`isQuestionFavorited`、`comment`（`string | null`）、`createdAt` 和 `updatedAt`。`isFavorited` 表示回答/turn 收藏；`isQuestionFavorited` 表示用户问题收藏。两个字段 MUST 是相互独立的布尔事实。`comment` 为附属自由文本字段，不参与全空行判定。`ConversationAnnotationRecord` MUST NOT 包含 `idempotencyKey`；幂等控制信息 MUST 通过 `IdempotentWriteOptions` 传递。

`isQuestionFavorited` MUST NOT 受回答收藏数量上限（`add-favorite-count-limit` 的 100 上限）约束。问题收藏不设数量上限。

标注事实 MUST 存储在专用业务表 `conversation_annotations` 中，禁止用 generic `records(store,key,json)` 承载。表 MUST 按 `(tenant_id, subject_id, agent_id, session_id, request_run_id)` 建立唯一约束。

#### Scenario: Cross-session annotation persistence
- **WHEN** 用户在 session `S1` 的 run `R1` 上点赞，scope 为 `(T1, U1, A1)`
- **AND** session `S1` 后续产生新的 request
- **THEN** 标注记录仍然存在且锚定 `requestRunId=R1`
- **AND** `sentiment="UP"`，`isFavorited=false`

#### Scenario: Question favorite persistence
- **WHEN** 用户在 session `S1` 的 run `R1` 上收藏问题，scope 为 `(T1, U1, A1)`
- **AND** session `S1` 后续产生新的 request
- **THEN** 标注记录仍然存在且锚定 `requestRunId=R1`
- **AND** `isQuestionFavorited=true`
- **AND** `isFavorited=false`

#### Scenario: Triple scope isolation
- **WHEN** 用户 `(T1, U1, A1)` 收藏了 run `R1` 的问题
- **AND** 用户 `(T1, U2, A1)` 或 `(T2, U1, A1)` 或 `(T1, U1, A2)` 查询标注
- **THEN** `(T1, U1, A1)` 的标注记录不可见
- **AND** 查询结果为空，不泄露跨 scope 标注是否存在

#### Scenario: Client-supplied scope is ignored
- **WHEN** 请求体携带 `tenantId`、`subjectId` 或 `agentId` 字段
- **THEN** 系统 MUST 忽略这些字段
- **AND** 只使用 trusted identity context 和 trusted agent scope

#### Scenario: Question favorite not subject to answer favorite limit
- **WHEN** scope `(T1, U1, A1)` 下已有 100 个 `is_favorited=1` 的标注行
- **AND** 用户收藏一个新的 run 的问题（`isQuestionFavorited=true`）
- **THEN** 系统 MUST 接受写入
- **AND** MUST NOT 返回 `FAVORITE_LIMIT_EXCEEDED`

### Requirement: Sentiment and favorite independent upsert

`sentiment`、`isFavorited` 和 `isQuestionFavorited` 是同一行记录上的三个独立字段。`sentiment` 值为 `"UP" | "DOWN" | null`，三者在同一字段上互斥；`isFavorited` 表示回答/turn 收藏；`isQuestionFavorited` 表示用户问题收藏。三个字段可同时存在且 MUST NOT 互相覆盖。同一行记录 MUST 同时承载这三个字段，不得用 `type` 列区分多行。

标注写入 SHALL 作为 upsert 操作。若同一 `(scope, session_id, request_run_id)` 下已存在记录，MUST 更新提供的字段并保留未提供字段不变；不存在则 INSERT 新行。`sentiment`、`isFavorited` 和 `isQuestionFavorited` 的 `undefined` 均表示不修改对应字段；`isFavorited` 或 `isQuestionFavorited` 为 `true` 表示设置对应收藏，为 `false` 表示取消对应收藏。`comment` 的 upsert 语义为：`undefined` 不修改、`null` 清空、非空字符串设置。`comment` 最大长度 1000 字符，超出时返回 `400`。仅当更新后 `sentiment=null`、`isFavorited=false` 且 `isQuestionFavorited=false` 同时成立时，系统 MUST 物理删除该行，`comment` 同时被删除。

`isQuestionFavorited` 不设数量上限。系统 MUST NOT 对 `isQuestionFavorited=true` 的写入执行数量校验或 FIFO 淘汰。

#### Scenario: Thumbs up replaces thumbs down via field update
- **WHEN** run `R1` 已有 `sentiment="DOWN"`
- **AND** 用户对 `R1` 设置 `sentiment="UP"`
- **THEN** 同一行记录的 `sentiment` 字段 MUST 更新为 `"UP"`
- **AND** `isFavorited` 和 `isQuestionFavorited` MUST 保持不变
- **AND** 不产生新行

#### Scenario: Favorite coexists with sentiment
- **WHEN** run `R1` 已有 `sentiment="UP"`
- **AND** 用户对 `R1` 设置 `isFavorited=true`
- **THEN** 同一行记录的 `isFavorited` MUST 更新为 `true`
- **AND** `sentiment` MUST 保持 `"UP"` 不变

#### Scenario: Answer favorite and question favorite coexist
- **WHEN** run `R1` 已有 `isFavorited=true`
- **AND** 用户对 `R1` 设置 `isQuestionFavorited=true`
- **THEN** 同一行记录的 `isQuestionFavorited` MUST 更新为 `true`
- **AND** `isFavorited` MUST 保持 `true`
- **AND** 不产生新行

#### Scenario: Partial upsert preserves question favorite
- **WHEN** run `R1` 已有 `isQuestionFavorited=true`
- **AND** 调用方仅设置 `sentiment="UP"`，未提供 `isQuestionFavorited`
- **THEN** 同一行记录的 `sentiment` MUST 更新为 `"UP"`
- **AND** `isQuestionFavorited` MUST 保持 `true`

#### Scenario: Toggle off answer favorite keeps question favorite
- **WHEN** run `R1` 有 `sentiment=null`、`isFavorited=true`、`isQuestionFavorited=true`
- **AND** 用户设置 `isFavorited=false`
- **THEN** 该行 MUST 保留
- **AND** `isQuestionFavorited` MUST 保持 `true`

#### Scenario: Toggle off final annotation deletes row
- **WHEN** run `R1` 有 `sentiment=null`、`isFavorited=false`、`isQuestionFavorited=true`
- **AND** 用户设置 `isQuestionFavorited=false`
- **THEN** 该行 MUST 被物理删除
- **AND** 后续查询 MUST NOT 返回该 run 的标注

#### Scenario: Toggle off sentiment deletes row if no favorite
- **WHEN** run `R1` 有 `sentiment="UP"`、`isFavorited=false`、`isQuestionFavorited=false`
- **AND** 用户取消点赞（设置 `sentiment=null`）
- **THEN** 该行 MUST 被物理删除
- **AND** 后续查询 MUST NOT 返回该 run 的标注

#### Scenario: Toggle off answer favorite keeps row if sentiment set
- **WHEN** run `R1` 有 `sentiment="UP"`、`isFavorited=true`、`isQuestionFavorited=false`
- **AND** 用户取消回答收藏（设置 `isFavorited=false`）
- **THEN** 该行 MUST 保留
- **AND** `sentiment` MUST 保持 `"UP"`

#### Scenario: createdAt records first annotation action
- **WHEN** 用户先对 run `R1` 收藏问题
- **AND** 后续对 `R1` 点赞
- **THEN** `createdAt` MUST 保持为首次标注时间
- **AND** `updatedAt` MUST 为最后一次修改时间

#### Scenario: Question favorite no limit
- **WHEN** scope `(T1, U1, A1)` 下已有 100 个 `question_favorite=1` 的标注行
- **AND** 用户收藏第 101 个 run 的问题（`isQuestionFavorited=true`）
- **THEN** 系统 MUST 接受写入
- **AND** MUST NOT 淘汰任何已有问题收藏

### Requirement: Annotation list and query behavior

系统 SHALL 支持三个维度的标注查询：按 scope 分页列出被收藏回答的对话（turn 粒度，`isFavorited=true`）、按 scope 分页列出被收藏问题的对话（turn 粒度，`isQuestionFavorited=true`），以及按 scope + session 列出会话内所有标注。回答收藏列表 MUST 只选择 `is_favorited=1` 的记录，MUST NOT 因 `isQuestionFavorited=true` 选择记录。问题收藏列表 MUST 只选择 `question_favorite=1` 的记录，MUST NOT 因 `is_favorited=true` 选择记录。两个收藏列表 MUST 按 `updated_at` 降序分页，每条返回 `sessionId`、`requestRunId`、`rootMessageId`、`questionPreview`（用户问题文本，截断至 `CONVERSATION_PREVIEW_TEXT_LIMIT`）、`questionTruncated`、`sessionTitle`、`sessionUpdatedAt` 和 `favoritedAt`。查询通过 LEFT JOIN `messages` 表获取用户问题文本（`role='USER'` 且 `visible=1`），当无匹配消息时 `questionPreview` 为空字符串、`rootMessageId` 回退为 `requestRunId`。会话内标注列表 MUST 返回 `annotationId`、`requestRunId`、`sentiment`、`isFavorited`、`isQuestionFavorited`、`comment` 和 `createdAt`，按 `createdAt` 升序排列。

#### Scenario: Question favorite is excluded from favorite turns
- **WHEN** 当前 scope 仅有一条 `isFavorited=false` 且 `isQuestionFavorited=true` 的标注记录
- **AND** 调用方执行 `listFavoriteTurns`
- **THEN** 返回结果 MUST 为空

#### Scenario: Answer favorite remains in favorite turns
- **WHEN** 当前 scope 有一条 `isFavorited=true` 且 `isQuestionFavorited=false` 的标注记录
- **AND** 调用方执行 `listFavoriteTurns`
- **THEN** 返回结果 MUST 包含该记录对应的 turn

#### Scenario: Answer favorite is excluded from question favorite turns
- **WHEN** 当前 scope 仅有一条 `isFavorited=true` 且 `isQuestionFavorited=false` 的标注记录
- **AND** 调用方执行 `listQuestionFavoriteTurns`
- **THEN** 返回结果 MUST 为空

#### Scenario: Question favorite remains in question favorite turns
- **WHEN** 当前 scope 有一条 `isFavorited=false` 且 `isQuestionFavorited=true` 的标注记录
- **AND** 调用方执行 `listQuestionFavoriteTurns`
- **THEN** 返回结果 MUST 包含该记录对应的 turn

#### Scenario: List favorited turns paginated
- **WHEN** 用户 `(T1, U1, A1)` 请求收藏对话列表，`offset=0, limit=10`
- **AND** scope 下有 3 个 `isFavorited=true` 的标注记录
- **THEN** 返回 3 条结果，每条包含 `sessionId`、`requestRunId`、`rootMessageId`、`questionPreview`、`questionTruncated`、`favoritedAt`
- **AND** 结果按 `favoritedAt`（即 `updated_at`）降序排列

#### Scenario: List question favorited turns paginated
- **WHEN** 用户 `(T1, U1, A1)` 请求问题收藏列表，`offset=0, limit=10`
- **AND** scope 下有 3 个 `isQuestionFavorited=true` 的标注记录
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

#### Scenario: List session annotations includes question favorite
- **WHEN** session `S1` 的 run `R1` 有 `isQuestionFavorited=true`
- **AND** 调用方执行 `listSessionAnnotations`
- **THEN** 返回的 `R1` 标注 MUST 包含 `isQuestionFavorited=true`
- **AND** 结果 MUST 按 `createdAt` 升序排列

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

## ADDED Requirements

### Requirement: Question favorite via annotation upsert

用户问题收藏（pin）SHALL 通过 annotation upsert 路径写入，MUST NOT 使用独立的 pin store 或 pin gateway 方法。pin 写入 MUST 携带 `sessionId` 和 `requestRunId`，因为 annotation 锚定 `requestRunId`。pin 状态 MUST 通过 `isQuestionFavorited=true` 设置，通过 `isQuestionFavorited=false` 取消。pin 不设数量上限，MUST NOT 执行 FIFO 淘汰。

`POST /api/v1/user-questions/pin` 端点 SHALL 接收 `{ sessionId, runId }` body，调用 annotation upsert 设置 `isQuestionFavorited=true`。端点 MUST 通过 trusted identity resolver 解析 owner scope，`agentId` MUST 来自 trusted agent scope。`runId` MUST 映射为 annotation upsert 的 `requestRunId`。

#### Scenario: Pin question via annotation upsert
- **WHEN** 已认证用户 POST `{ "sessionId": "S1", "runId": "R1" }` 到 `/api/v1/user-questions/pin`
- **THEN** 系统 MUST 调用 annotation upsert 设置 `isQuestionFavorited=true`
- **AND** MUST 返回 HTTP 204

#### Scenario: Pin preserves existing annotation fields
- **WHEN** run `R1` 已有 `sentiment="UP"` 且 `isFavorited=false`
- **AND** 用户 pin 该 run 的问题
- **THEN** `isQuestionFavorited` MUST 设为 `true`
- **AND** `sentiment` MUST 保持 `"UP"`
- **AND** `isFavorited` MUST 保持 `false`

#### Scenario: Pin no limit
- **WHEN** scope 下已有 100 个 `isQuestionFavorited=true` 的标注行
- **AND** 用户 pin 第 101 个 run 的问题
- **THEN** 系统 MUST 接受写入
- **AND** MUST NOT 淘汰任何已有问题收藏

#### Scenario: Pin requires sessionId and runId
- **WHEN** 用户 POST `{ "question": "some text" }` 到 `/api/v1/user-questions/pin`
- **THEN** 系统 MUST 返回 HTTP 400
- **AND** MUST NOT 调用 annotation upsert
