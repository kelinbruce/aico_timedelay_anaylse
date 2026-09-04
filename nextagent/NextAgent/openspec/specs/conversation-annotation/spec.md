# conversation-annotation Specification

## Purpose
定义对话标注能力的稳定契约，包括点赞/点踩/收藏的持久化、runtime 端口、Web API、retry/edit supersede 清理和 agent-web 最小集成行为。
## Requirements
### Requirement: Conversation annotation persistence and scope isolation

系统 SHALL 通过专用 `ConversationAnnotationStoreGateway` persistence port 持久化对话标注事实。每个 `requestRunId` 对应一行标注记录，标注锚定为 `requestRunId`，三元 scope `(tenantId, subjectId, agentId)` 隔离。`tenantId` 和 `subjectId` 来自可信 channel/auth boundary 的 `IdentityContext`，`agentId` 来自可信 app composition 或已持久化 session/run binding。请求体、模型输出、capability 参数或客户端 metadata 不得覆盖标注的 owner scope 或 agent scope。

`ConversationAnnotationRecord` 是 gateway-owned persistence DTO，MUST `extends OwnerScoped` 并包含 `agentId: AgentId`。记录包含 `annotationId`、`sessionId`、`requestRunId`、`sentiment`（`"UP"` | `"DOWN"` | `null`）、`isFavorited`、`isQuestionFavorited`、`comment`（`string | null`）、`createdAt` 和 `updatedAt`。`isFavorited` 表示回答/turn 收藏；`isQuestionFavorited` 表示用户问题收藏。两个字段 MUST 是相互独立的布尔事实。`comment` 为附属自由文本字段，不参与全空行判定。`ConversationAnnotationRecord` MUST NOT 包含 `idempotencyKey`；幂等控制信息 MUST 通过 `IdempotentWriteOptions` 传递。

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

### Requirement: Sentiment and favorite independent upsert

`sentiment`、`isFavorited` 和 `isQuestionFavorited` 是同一行记录上的三个独立字段。`sentiment` 值为 `"UP"` | `"DOWN"` | `null`，三者在同一字段上互斥；`isFavorited` 表示回答/turn 收藏；`isQuestionFavorited` 表示用户问题收藏。三个字段可同时存在且 MUST NOT 互相覆盖。同一行记录 MUST 同时承载这三个字段，不得用 `type` 列区分多行。

标注写入 SHALL 作为 upsert 操作。若同一 `(scope, session_id, request_run_id)` 下已存在记录，MUST 更新提供的字段并保留未提供字段不变；不存在则 INSERT 新行。`sentiment`、`isFavorited` 和 `isQuestionFavorited` 的 `undefined` 均表示不修改对应字段；`isFavorited` 或 `isQuestionFavorited` 为 `true` 表示设置对应收藏，为 `false` 表示取消对应收藏。仅当更新后 `sentiment=null`、`isFavorited=false` 且 `isQuestionFavorited=false` 同时成立时，系统 MUST 物理删除该行，`comment` 同时被删除。

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

### Requirement: Annotation supersede cleanup on retry/edit

当 request run 被 retry 或 edit 取代时，系统 MUST 删除该 run 的标注记录。runtime 在 retry/edit 流程中取代旧 run 后 MUST 调用 `ConversationAnnotationStoreGateway.deleteAnnotationsByRun` 执行清理。若清理失败，retry/edit 操作 MUST 报告失败。

#### Scenario: Retry cleans up old run annotations
- **WHEN** run `R1` 有 `sentiment="UP"` 且 `isFavorited=true`
- **AND** 用户执行 retry，`R1` 被标记为 `SUPERSEDED`
- **THEN** `R1` 的标注行 MUST 被删除
- **AND** 新 run `R2` 没有任何标注

#### Scenario: Edit cleans up old run annotations
- **WHEN** run `R1` 有 `sentiment="DOWN"`
- **AND** 用户执行 edit，`R1` 被标记为 `SUPERSEDED`
- **THEN** `R1` 的标注行 MUST 被删除

#### Scenario: Cleanup failure fails the retry
- **WHEN** 标注清理操作失败
- **THEN** retry/edit 操作 MUST 报告失败
- **AND** MUST NOT 留下 superseded run 的孤儿标注

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

#### Scenario: List session annotations includes question favorite
- **WHEN** session `S1` 的 run `R1` 有 `isQuestionFavorited=true`
- **AND** 调用方执行 `listSessionAnnotations`
- **THEN** 返回的 `R1` 标注 MUST 包含 `isQuestionFavorited=true`
- **AND** 结果 MUST 按 `createdAt` 升序排列

### Requirement: Annotation Web REST API contract

系统 SHALL 通过 `agent-channel-web` 暴露三条 REST API 路由：标注 upsert、分页列出收藏会话、列出会话内标注。owner scope MUST 来自 `IdentityResolver`，agent scope MUST 来自可信 app composition；路由 MUST NOT 从请求体或路径参数接受 `tenantId`、`subjectId` 或 `agentId`。

- `POST /api/v1/sessions/:sessionId/runs/:runId/annotations`：请求体至少提供 `sentiment`、`isFavorited` 或 `isQuestionFavorited` 其一，返回 `200` 和标注摘要；若更新后为空状态则返回 `200` 和空状态。
- `GET /api/v1/favorites?offset=0&limit=50`：返回收藏会话分页结果。
- `GET /api/v1/sessions/:sessionId/annotations`：返回会话内标注列表。

当 `WebChannelDependencies.annotations` 未注入时，三条路由 MUST 返回 `503` 和 `SafeError { code: "ANNOTATIONS_UNAVAILABLE" }`。请求体和响应体 MUST 经过 runtime schema validation。`limit` 上限为 `100`，超出时返回 `400`。

#### Scenario: Set sentiment via API
- **WHEN** 客户端 `POST /api/v1/sessions/S1/runs/R1/annotations` 且请求体 `{ "sentiment": "UP" }`
- **THEN** 返回 `200`，body 包含 `annotationId`、`sessionId`、`requestRunId`、`sentiment="UP"`、`isFavorited=false`

#### Scenario: Toggle off sentiment via API
- **WHEN** run `R1` 已有 `sentiment="UP"`，`isFavorited=false`
- **AND** 客户端 `POST /api/v1/sessions/S1/runs/R1/annotations` 且请求体 `{ "sentiment": null }`
- **THEN** 返回 `200`
- **AND** 标注行被删除，body 为 `{ sentiment: null, isFavorited: false, isQuestionFavorited: false }`

#### Scenario: Annotations unavailable returns 503
- **WHEN** `WebChannelDependencies.annotations` 未注入
- **AND** 客户端请求任意标注路由
- **THEN** 返回 `503`，body 为 `{ error: { code: "ANNOTATIONS_UNAVAILABLE" } }`

#### Scenario: Limit exceeds maximum
- **WHEN** 客户端 `GET /api/v1/favorites?limit=200`
- **THEN** 返回 `400`

#### Scenario: Annotating a non-existent run returns 404
- **WHEN** 客户端 `POST /api/v1/sessions/S1/runs/R_GHOST/annotations` 且 `R_GHOST` 在当前 scope 下既无 `RequestRunRecord` 也无属于该 session 的 message
- **THEN** 返回 `404` 和 `SafeError { code: "ANNOTATION_RUN_NOT_FOUND" }`
- **AND** MUST NOT 写入标注记录

#### Scenario: Annotating a fork-inherited run anchor succeeds
- **WHEN** session `S1` 是 fork 派生子会话，`R_CHILD` 是 fork 复制的 child run anchor
- **AND** `R_CHILD` 在当前 scope 下无 `RequestRunRecord`，但 `messages` 表中存在 `(sessionId=S1, runId=R_CHILD)` 的消息
- **AND** 客户端 `POST /api/v1/sessions/S1/runs/R_CHILD/annotations`
- **THEN** 返回 `200` 和标注摘要
- **AND** 标注记录 MUST 被写入

### Requirement: 会话删除级联清理对话标注

当 session 删除成功时，系统 SHALL 清理该 session 下所有 conversation annotation 事实。清理 MUST 保持 owner scope 和 Agent scope 隔离，并 MUST 作为会话删除 composite transaction 的一部分完成。删除成功后，收藏会话列表和会话内标注查询 MUST 不再返回该 session 的标注或收藏投影。

如果标注清理失败，会话删除 MUST 失败并回滚；系统 MUST NOT 留下 session 已删除但 annotation/favorite 仍可见的状态。

#### Scenario: 删除会话清理标注和收藏投影
- **GIVEN** session `S1` 下存在点赞、点踩或收藏标注
- **WHEN** `S1` 删除成功
- **THEN** `GET /api/v1/sessions/S1/annotations` MUST 返回 safe not-found outcome 或空的不可达结果
- **AND** 收藏会话列表 MUST NOT 返回 `S1`

#### Scenario: 标注清理失败导致会话删除回滚
- **GIVEN** session `S1` 下存在 annotation 事实
- **WHEN** 会话删除事务中的 annotation 清理失败
- **THEN** 会话删除 MUST 返回显式 safe error
- **AND** `S1` 及其 annotation facts MUST 保持删除前状态

#### Scenario: 标注清理不能跨 scope
- **GIVEN** 两个不同 owner 或 Agent scope 下存在相同 `sessionId` 字符串的标注事实
- **WHEN** 当前 scope 删除 session `S1`
- **THEN** 系统 MUST 只清理当前 `(tenantId, subjectId, agentId, sessionId)` 下的标注
- **AND** 其他 scope 的标注 MUST 保持不可见且不被删除

### Requirement: 收藏数量上限
系统 MUST 对每个 `(tenantId, subjectId)` scope（即单用户，跨所有 agent）的收藏数量强制执行固定上限：同一 scope 下最多存在 100 个 `isFavorited=true` 的标注行。local 宿主上限 MUST 在 annotation save 事务内原子 enforce：gateway MUST 在同一事务中统计当前 scope 下 `is_favorited=1` 的现有行数，当计数已达到 100 且本次写入为净新增收藏时，MUST 在 INSERT 或 UPDATE 之前拒绝写入。remote 宿主无 gateway 事务 enforce 能力，前端 MUST 在净新增收藏前查询 `listFavoriteTurns(limit=100)`，若 `entries.length >= 100` 则 MUST NOT 发送 upsert 请求并 MUST 展示专门的数量超限提示。上限 MUST 只对净新增收藏生效：INSERT 且 `isFavorited=true`、或 UPDATE 将 `isFavorited` 从 false 翻转为 true 时校验；取消收藏（true→false）、对已收藏行重新收藏（true→true）、单独更新 sentiment 或 comment MUST NOT 触发上限校验。supersede 清理和会话删除级联删除 `is_favorited=1` 行后 MUST 自然释放配额，无需额外配额返还机制。上限值是固定常量 100，系统 MUST NOT 从 client payload、client metadata、model output 或 capability arguments 读取上限或计数。当上限被超出时，gateway MUST 返回 `SafeError { code: "FAVORITE_LIMIT_EXCEEDED", category: "VALIDATION", retryable: false }`；Web channel MUST 将其投影为 HTTP `400` 且 MUST NOT 暴露 tenant、subject、storage、SQL、stack trace 或 hidden resource existence；前端 MUST 回滚乐观收藏状态并展示专门的数量超限提示，而非通用标注错误文案。`isQuestionFavorited` 不受本上限约束。

#### Scenario: 第 100 个收藏被接受
- **WHEN** scope `(T1, U1)` 下已有 99 个 `is_favorited=1` 的标注行
- **AND** 用户收藏一个新 run（该 run 无既有标注，`isFavorited=true`）
- **THEN** gateway MUST 接受写入并创建 `is_favorited=1` 行
- **AND** 该 scope 下 `is_favorited=1` 行数变为 100

#### Scenario: 第 101 个收藏被拒绝
- **WHEN** scope `(T1, U1)` 下已有 100 个 `is_favorited=1` 的标注行
- **AND** 用户收藏一个新 run（该 run 无既有标注，`isFavorited=true`）
- **THEN** gateway MUST 返回 `SafeError { code: "FAVORITE_LIMIT_EXCEEDED", category: "VALIDATION", retryable: false }`
- **AND** gateway MUST NOT 插入新行、修改既有行或改变 scope 内 `is_favorited=1` 行数

#### Scenario: 取消收藏不受上限影响
- **WHEN** scope `(T1, U1)` 下已有 100 个 `is_favorited=1` 的标注行
- **AND** 用户取消其中一个已收藏 run 的收藏（`isFavorited=false`）
- **THEN** gateway MUST 接受写入，将该行 `is_favorited` 置为 0
- **AND** 该 scope 下 `is_favorited=1` 行数变为 99

#### Scenario: 已收藏行重新收藏不触发上限
- **WHEN** scope `(T1, U1)` 下已有 100 个 `is_favorited=1` 的标注行
- **AND** 用户对其中一个已收藏 run 再次发送 `isFavorited=true`（true→true）
- **THEN** gateway MUST 接受写入，不触发计数校验
- **AND** 该 scope 下 `is_favorited=1` 行数保持 100

#### Scenario: 已收藏行更新 sentiment 不触发上限
- **WHEN** scope `(T1, U1)` 下已有 100 个 `is_favorited=1` 的标注行
- **AND** 用户对其中一个已收藏 run 设置 `sentiment="UP"`（不修改 `isFavorited`）
- **THEN** gateway MUST 接受写入，不触发计数校验
- **AND** 该 scope 下 `is_favorited=1` 行数保持 100

#### Scenario: 跨 agent 共享配额
- **WHEN** scope `(T1, U1)` 下已有 100 个 `is_favorited=1` 的标注行（分布在 agent A1 和 A2 的 run 上）
- **AND** 用户在 agent A2 的一个新 run 上收藏（`isFavorited=true`）
- **THEN** gateway MUST 返回 `SafeError { code: "FAVORITE_LIMIT_EXCEEDED", category: "VALIDATION", retryable: false }`
- **AND** 配额按用户 `(T1, U1)` 聚合，不按 agent 隔离

#### Scenario: supersede 清理释放配额
- **WHEN** scope `(T1, U1)` 下已有 100 个 `is_favorited=1` 的标注行
- **AND** 其中一个被收藏的 run 被 retry/edit 取代，supersede 清理删除其标注行
- **AND** 用户随后收藏一个新 run
- **THEN** gateway MUST 接受写入
- **AND** 该 scope 下 `is_favorited=1` 行数恢复为 100

#### Scenario: 幂等重放不受上限影响
- **WHEN** scope `(T1, U1)` 下已有 100 个 `is_favorited=1` 的标注行
- **AND** 一个收藏操作在达到上限前已被 accepted 并锚定 idempotency key
- **AND** client 以相同 idempotency key 重放该收藏操作
- **THEN** gateway MUST 返回首次 accepted 的结果
- **AND** gateway MUST NOT 因当前已达上限而拒绝该幂等重放

#### Scenario: 超限安全错误的 Web 投影
- **WHEN** `POST /api/v1/sessions/:sessionId/runs/:runId/annotations` 因收藏上限被拒绝
- **THEN** Web channel MUST 返回 HTTP `400`
- **AND** 响应 body MUST 包含稳定错误码 `FAVORITE_LIMIT_EXCEEDED`
- **AND** 响应 MUST NOT 暴露 raw tenant、subject、storage、SQL、stack trace 或 hidden resource existence

#### Scenario: local 前端超限回滚与提示
- **WHEN** local 宿主 agent-web 收到 `FAVORITE_LIMIT_EXCEEDED` 错误
- **THEN** agent-web MUST 回滚乐观收藏状态至操作前
- **AND** agent-web MUST 展示专门的数量超限提示
- **AND** agent-web MUST NOT 展示通用标注错误文案

#### Scenario: remote 前端前置检查
- **WHEN** remote 宿主（`immersive`/`piu` 模式）用户尝试净新增收藏（`isFavorited` 从 false→true）
- **AND** 当前用户收藏列表 `listFavoriteTurns(limit=100)` 返回 `entries.length >= 100`
- **THEN** agent-web MUST NOT 发送 upsert 请求
- **AND** agent-web MUST 回滚乐观收藏状态至操作前
- **AND** agent-web MUST 展示专门的数量超限提示
- **AND** agent-web MUST NOT 展示通用标注错误文案
