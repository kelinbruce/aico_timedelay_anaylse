## ADDED Requirements

### Requirement: Conversation annotation persistence and scope isolation

系统 SHALL 通过专用 `ConversationAnnotationStoreGateway` persistence port 持久化对话标注事实。每个 `requestRunId` 对应一行标注记录，标注锚定为 `requestRunId`（具体某次执行），三元 scope `(tenantId, subjectId, agentId)` 隔离。`tenantId` 和 `subjectId` 来自可信 channel/auth boundary 的 `IdentityContext`，`agentId` 来自可信 app composition 或已持久化 session/run binding。请求体、模型输出、capability 参数或客户端 metadata 不得覆盖标注的 owner scope 或 agent scope。

`ConversationAnnotationRecord` 是 gateway-owned persistence DTO，MUST `extends OwnerScoped` 并包含 `agentId: AgentId`。记录包含 `annotationId`（主键）、`sessionId`（标注所在会话）、`requestRunId`（被标注的问答执行）、`sentiment`（点赞/点踩，值为 `"UP"` | `"DOWN"` | `null`，`null` 表示中性）、`isFavorited`（是否收藏，布尔值）、`createdAt`（首次标注动作时间，无论第一个动作是点赞、点踩还是收藏）和 `updatedAt`（最后修改时间）。`comment` 为可选自由文本字段（`string | null`），用于附属于标注的用户评论（如点踩原因），不参与全空行判定——当 `sentiment=null` 且 `isFavorited=false` 时无论 `comment` 是否有值都删除该行。ConversationAnnotationRecord` MUST NOT 包含 `idempotencyKey`；幂等控制信息 MUST 通过 `IdempotentWriteOptions` 传递。

标注事实 MUST 存储在专用业务表 `conversation_annotations` 中，禁止用 generic `records(store,key,json)` 承载。表 MUST 按 `(tenant_id, subject_id, agent_id, session_id, request_run_id)` 建立唯一约束——同一 scope 下同一 run 只能有一行标注记录。

#### Scenario: Cross-session annotation persistence
- **WHEN** 用户在 session `S1` 的 run `R1` 上点赞，scope 为 `(T1, U1, A1)`
- **AND** session `S1` 后续产生新的 request
- **THEN** 标注记录仍然存在且锚定 `requestRunId=R1`
- **AND** `sentiment="UP"`，`isFavorited=false`

#### Scenario: Triple scope isolation
- **WHEN** 用户 `(T1, U1, A1)` 标注了 run `R1`
- **AND** 用户 `(T1, U2, A1)` 或 `(T2, U1, A1)` 或 `(T1, U1, A2)` 查询标注
- **THEN** `(T1, U1, A1)` 的标注记录不可见
- **AND** 查询结果为空，不泄露跨 scope 标注是否存在

#### Scenario: Client-supplied scope is ignored
- **WHEN** 请求体携带 `tenantId`、`subjectId` 或 `agentId` 字段
- **THEN** 系统 MUST 忽略这些字段
- **AND** 只使用 trusted identity context 和 trusted agent scope

### Requirement: Sentiment and favorite independent upsert

`sentiment`（点赞/点踩）和 `isFavorited`（收藏）是同一行记录上的两个独立字段。`sentiment` 值为 `"UP"` | `"DOWN"` | `null`（`null` 表示中性，UI 两个图标均灰色），三者在同一字段上互斥——更新 `sentiment` 字段即天然完成 UP↔DOWN 切换，无需删除和插入。`isFavorited` 独立于 `sentiment`，可与之共存。同一行记录 MUST 同时承载这两个字段，不得用 `type` 列区分多行。

标注的创建和更新 SHALL 作为 upsert 操作。写入时若同一 `(scope, session_id, request_run_id)` 下已存在记录，MUST 更新对应字段（`sentiment`、`isFavorited` 或 `comment`）并保留未提供的字段不变；不存在则 INSERT 新行，`createdAt` 设为当前时间。`sentiment`、`isFavorited` 和 `comment` 可在同一次 upsert 中一起或单独更新。`comment` 的 upsert 语义：`undefined` 表示不修改该字段，`null` 表示清空，非空字符串表示设置。`comment` 最大长度 1000 字符，超出时返回 `400`。当一次更新使 `sentiment=null` 且 `isFavorited=false` 时，系统 MUST 物理删除该行（`comment` 同时被删除）——不保留全空僵尸记录，`comment` 不作为独立标注维度存在。


#### Scenario: Thumbs up replaces thumbs down via field update
- **WHEN** run `R1` 已有 `sentiment="DOWN"`
- **AND** 用户对 `R1` 设置 `sentiment="UP"`
- **THEN** 同一行记录的 `sentiment` 字段 MUST 更新为 `"UP"`
- **AND** `isFavorited` 字段 MUST 保持不变
- **AND** 不产生新行

#### Scenario: Favorite coexists with sentiment
- **WHEN** run `R1` 已有 `sentiment="UP"`
- **AND** 用户对 `R1` 设置 `isFavorited=true`
- **THEN** 同一行记录的 `isFavorited` MUST 更新为 `true`
- **AND** `sentiment` MUST 保持 `"UP"` 不变

#### Scenario: No annotation is neutral state
- **WHEN** run `R1` 没有标注记录
- **THEN** UI 点赞和点踩图标 MUST 均为灰色，收藏图标 MUST 为灰色

#### Scenario: Toggle off sentiment deletes row if no favorite
- **WHEN** run `R1` 有 `sentiment="UP"`，`isFavorited=false`
- **AND** 用户取消点赞（设置 `sentiment=null`）
- **THEN** 该行 MUST 被物理删除（因为 `sentiment=null` 且 `isFavorited=false`）
- **AND** 后续查询 MUST NOT 返回该 run 的标注

#### Scenario: Toggle off sentiment keeps row if favorited
- **WHEN** run `R1` 有 `sentiment="UP"`，`isFavorited=true`
- **AND** 用户取消点赞（设置 `sentiment=null`）
- **THEN** 该行 MUST 保留，`sentiment=null`，`isFavorited=true`

#### Scenario: Toggle off favorite keeps row if sentiment set
- **WHEN** run `R1` 有 `sentiment="UP"`，`isFavorited=true`
- **AND** 用户取消收藏（设置 `isFavorited=false`）
- **THEN** 该行 MUST 保留，`sentiment="UP"`，`isFavorited=false`

#### Scenario: Toggle off favorite deletes row if no sentiment
- **WHEN** run `R1` 有 `sentiment=null`，`isFavorited=true`
- **AND** 用户取消收藏（设置 `isFavorited=false`）
- **THEN** 该行 MUST 被物理删除

#### Scenario: createdAt records first annotation action
- **WHEN** 用户先对 run `R1` 点赞（`sentiment="UP"`）
- **AND** 后续对 `R1` 收藏（`isFavorited=true`）
- **THEN** `createdAt` MUST 保持为点赞时的时间
- **AND** `updatedAt` MUST 为收藏时的时间

### Requirement: Annotation supersede cleanup on retry/edit

当 request run 被 retry 或 edit 取代时，系统 MUST 删除该 run 的标注记录。此清理确保已被隐藏的旧 run 不残留"隐形标注"——用户看不到的标注不应继续影响会话老化或出现在标注统计中。runtime 在 retry/edit 流程中取代旧 run 后 MUST 调用 `ConversationAnnotationStoreGateway.deleteAnnotationsByRun` 执行清理。

若清理失败，retry/edit 操作 MUST 报告失败，不得留下 superseded run 的孤儿标注。

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

系统 SHALL 支持两个维度的标注查询：按 scope 分页列出有收藏的会话（用于侧边栏），按 scope + session 列出会话内所有标注（用于对话视图图标状态）。

**会话级收藏列表**：返回当前 scope 下 `isFavorited=true` 的 session 列表，按 `MAX(updated_at)` 降序分页。每条结果 MUST 包含 `sessionId`、`favoriteCount`（该 session 下 `isFavorited=true` 的行数）。runtime port SHOULD 关联 session 元数据（标题、最后更新时间）供前端展示。

**会话内标注列表**：返回当前 scope + 指定 session 下所有标注记录的 `annotationId`、`requestRunId`、`sentiment`、`isFavorited`、`comment`、`createdAt`，按 `createdAt` 升序排列。此查询用于前端在对话视图中渲染标注图标状态。

由于 supersede 清理保证已隐藏 run 的标注被删除，会话内标注查询只需返回表中该 session 的全部记录，无需 JOIN request_runs 判断 run 状态。

两个查询 MUST 强制三元 scope 过滤；缺失 scope 的查询 MUST 返回空结果。

#### Scenario: List favorited sessions paginated
- **WHEN** 用户 `(T1, U1, A1)` 请求收藏会话列表，`offset=0, limit=10`
- **AND** scope 下有 3 个 session 有 `isFavorited=true` 的标注
- **THEN** 返回 3 条结果，每条包含 `sessionId`、`favoriteCount`
- **AND** 结果按最近 `updatedAt` 降序排列

#### Scenario: Session with multiple favorites counted once
- **WHEN** session `S1` 下有 3 个 run 的 `isFavorited=true`
- **AND** 用户请求收藏会话列表
- **THEN** `S1` 在列表中出现一次
- **AND** `favoriteCount=3`

#### Scenario: List session annotations for icon state
- **WHEN** 用户打开 session `S1` 的对话视图
- **AND** 请求 `GET /api/v1/sessions/S1/annotations`
- **THEN** 返回 `S1` 下所有标注记录的 `annotationId`、`requestRunId`、`sentiment`、`isFavorited`、`comment`、`createdAt`
- **AND** 结果按 `createdAt` 升序排列

### Requirement: Annotation Web REST API contract

系统 SHALL 通过 `agent-channel-web` 暴露三条 REST API 路由用于标注操作。所有路由的 owner scope MUST 来自 `IdentityResolver` 解析的可信 identity context，agent scope MUST 来自可信 app composition；路由 MUST NOT 从请求体或路径参数中接受 `tenantId`、`subjectId` 或 `agentId`。

**路由契约**：
- `POST /api/v1/sessions/:sessionId/runs/:runId/annotations`：upsert 标注。请求体包含可选的 `sentiment`（`"UP"` | `"DOWN"` | `null`）和可选的 `isFavorited`（`boolean`），以及可选的 `comment`（`string | null`），至少提供 `sentiment`、`isFavorited` 或 `comment` 其一。成功返回 `200` 和标注摘要（含 `annotationId`、`sessionId`、`requestRunId`、`sentiment`、`isFavorited`、`comment`、`createdAt`）。若更新后 `sentiment=null` 且 `isFavorited=false`，该行被删除，返回 `200` 和空状态。幂等：相同值重复请求返回当前状态。
- `GET /api/v1/favorites?offset=0&limit=50`：分页列出收藏会话。返回会话级收藏摘要页。
- `GET /api/v1/sessions/:sessionId/annotations`：列出会话内标注。返回标注记录列表。

当 `WebChannelDependencies.annotations` 未注入时，三条路由 MUST 返回 `503` 和 `SafeError { code: "ANNOTATIONS_UNAVAILABLE" }`，不得静默返回空结果或伪装成功。

请求体和响应体 MUST 经过 runtime schema validation。`limit` 参数上限为 `100`，超出时返回 `400`。

#### Scenario: Set sentiment via API
- **WHEN** 客户端 `POST /api/v1/sessions/S1/runs/R1/annotations` 且请求体 `{ "sentiment": "UP" }`
- **AND** identity resolver 返回 `(T1, U1)`，agent scope 为 `A1`
- **THEN** 返回 `200`，body 包含 `annotationId`、`sessionId`、`requestRunId`、`sentiment="UP"`、`isFavorited=false`、`comment=null`、`createdAt`

#### Scenario: Switch sentiment via API
- **WHEN** run `R1` 已有 `sentiment="DOWN"`
- **AND** 客户端 `POST /api/v1/sessions/S1/runs/R1/annotations` 且请求体 `{ "sentiment": "UP" }`
- **THEN** 返回 `200`，`sentiment="UP"`
- **AND** `isFavorited` 保持不变

#### Scenario: Set favorite via API
- **WHEN** 客户端 `POST /api/v1/sessions/S1/runs/R1/annotations` 且请求体 `{ "isFavorited": true }`
- **THEN** 返回 `200`，`isFavorited=true`
- **AND** `sentiment` 保持不变

#### Scenario: Toggle off sentiment via API
- **WHEN** run `R1` 已有 `sentiment="UP"`，`isFavorited=false`
- **AND** 客户端 `POST /api/v1/sessions/S1/runs/R1/annotations` 且请求体 `{ "sentiment": null }`
- **THEN** 返回 `200`，标注行被删除，body 为空状态 `{ sentiment: null, isFavorited: false, comment: null }`

#### Scenario: List favorited sessions via API
- **WHEN** 客户端 `GET /api/v1/favorites?offset=0&limit=10`
- **THEN** 返回 `200`，body 包含 `entries[]`、`offset`、`limit`、`hasMore`

#### Scenario: List session annotations via API
- **WHEN** 客户端 `GET /api/v1/sessions/S1/annotations`
- **THEN** 返回 `200`，body 包含 `annotations[]`

#### Scenario: Annotations unavailable returns 503
- **WHEN** `WebChannelDependencies.annotations` 未注入
- **AND** 客户端请求任意标注路由
- **THEN** 返回 `503`，body 为 `{ error: { code: "ANNOTATIONS_UNAVAILABLE" } }`

#### Scenario: Limit exceeds maximum
- **WHEN** 客户端 `GET /api/v1/favorites?limit=200`
- **THEN** 返回 `400`

### Requirement: Frontend annotation interaction behavior

前端（agent-web）SHALL 在每轮问答的助手回复的操作行中展示三个标注图标：点赞（`sentiment="UP"`）、点踩（`sentiment="DOWN"`）和收藏（`isFavorited=true`）。三个标注图标与复制、重新生成按钮位于同一行，排列顺序为：复制、点赞、点踩、收藏、重新生成。操作行 MUST 左对齐（与助手回复内容左边缘对齐），回复时间戳 MUST 位于重新生成按钮的右侧（即操作行最末位，与重新生成按钮之间以分隔符分隔）。操作行 MUST 常驻显示（不依赖鼠标悬浮）。标注图标与复制/重新生成按钮 MUST 使用相同的图标尺寸和间距。仅在 request run 处于 terminal 状态（`COMPLETED`/`FAILED`/`CANCELED`）且有回复内容时展示标注图标。

**点赞/点踩三态 toggle**：
- 无标注记录时两个图标均为灰色
- 点击点赞 → `POST { sentiment: "UP" }`，点赞图标高亮，点踩图标灰色
- 点击点踩 → `POST { sentiment: "DOWN" }`，点踩图标高亮，点赞图标灰色
- 已高亮的点赞图标再点击 → `POST { sentiment: null }`，恢复灰色
- 已高亮的点踩图标再点击 → `POST { sentiment: null }`，恢复灰色
- 从点赞切换到点踩（或反向）→ `POST { sentiment: "DOWN" }`，即时切换高亮

**收藏 toggle**：
- 默认灰色空心
- 点击 → `POST { isFavorited: true }`，图标高亮
- 已高亮再点击 → `POST { isFavorited: false }`，恢复灰色

标注状态 MUST 与后端持久化状态一致——页面刷新或重新打开会话后，已标注的轮次图标 MUST 高亮。前端打开会话时调 `GET /api/v1/sessions/:sessionId/annotations` 获取全部标注，构建 `Map<requestRunId, { sentiment, isFavorited }>` 管理图标状态。

侧边栏 SHALL 新增收藏功能入口。点击后分页展示收藏会话列表，列表项展示会话标题和最近收藏时间。单击列表项 MUST 产生与单击历史会话相同的效果——还原整个会话内容。还原后，已标注的问答轮次下方图标 MUST 正确高亮。

标注状态变更 MUST 即时反映在 UI 上（乐观更新或请求成功后更新均可）。网络失败时 MUST 回滚乐观更新或显示错误提示，不得静默丢弃。

#### Scenario: Thumbs up toggle
- **WHEN** 用户点击未标注轮次的点赞图标
- **THEN** 点赞图标即时高亮，点踩图标灰色
- **AND** 后端 upsert `sentiment="UP"` 成功

#### Scenario: Thumbs up to thumbs down switch
- **WHEN** 轮次已有点赞（`sentiment="UP"` 高亮）
- **AND** 用户点击点踩图标
- **THEN** 点踩图标即时高亮，点赞图标恢复灰色
- **AND** 后端更新 `sentiment="DOWN"` 成功

#### Scenario: Toggle off thumbs up
- **WHEN** 轮次已有点赞（`sentiment="UP"` 高亮），且未收藏
- **AND** 用户再次点击点赞图标
- **THEN** 点赞图标恢复灰色
- **AND** 后端删除该行（`sentiment=null` 且 `isFavorited=false`）

#### Scenario: Favorite toggle
- **WHEN** 用户点击未收藏轮次的收藏图标
- **THEN** 图标即时变为高亮
- **AND** 后端 upsert `isFavorited=true` 成功

#### Scenario: Annotation state persists across reload
- **WHEN** 用户标注了 run `R1` 后刷新页面或重新打开会话
- **THEN** `R1` 对应轮次的标注图标 MUST 正确高亮

#### Scenario: Sidebar favorites list
- **WHEN** 用户点击侧边栏收藏入口
- **THEN** 展示收藏会话列表，分页加载
- **AND** 每项显示会话标题和最近收藏时间

#### Scenario: Click sidebar item restores conversation
- **WHEN** 用户单击收藏列表中的某条会话
- **THEN** 还原该会话的完整对话内容
- **AND** 已标注的问答轮次下方图标正确高亮

#### Scenario: Annotation creation failure rolls back
- **WHEN** 用户点击标注图标后 API 请求失败
- **THEN** 图标 MUST 回滚到标注前状态
- **AND** MUST 向用户展示错误反馈

### Requirement: Session aging exemption obligation

当 session 下存在任意 `isFavorited=true` 的标注记录时，该 session MUST 被视为不可老化。由于 supersede 清理保证已隐藏 run 的标注被删除，此条件等价于"用户可见的收藏保护 session"——不存在用户看不到却阻止老化的隐形收藏。

本 change 不实现会话老化逻辑。未来的 session-aging change MUST 在删除或归档任何 session 前检查该 session 是否存在 `isFavorited=true` 的标注记录，存在则跳过。session-aging change MUST 通过 `ConversationAnnotationStoreGateway` public port 查询，不得直接访问 `conversation_annotations` 表。

#### Scenario: Session with favorites is exempt from future aging
- **WHEN** session `S1` 下存在至少一条 `isFavorited=true` 的标注记录
- **AND** 未来 session-aging 引擎扫描到 `S1` 符合老化条件
- **THEN** aging 引擎 MUST 跳过 `S1`

#### Scenario: Session with all favorites removed is eligible for aging
- **WHEN** session `S1` 下所有 `isFavorited=true` 的标注已被设为 `false`（包括 supersede 清理删除的行）
- **AND** 未来 session-aging 引擎扫描到 `S1` 符合老化条件
- **THEN** aging 引擎 MAY 对 `S1` 执行老化操作

#### Scenario: Superseded run favorite does not protect session
- **WHEN** run `R1` 有 `isFavorited=true`
- **AND** `R1` 被 retry 标记为 `SUPERSEDED`
- **THEN** `R1` 的标注行 MUST 被清理
- **AND** 若 session 无其他 `isFavorited=true` 的标注，该 session 不再受收藏保护

#### Scenario: Aging engine queries via gateway port
- **WHEN** 未来 session-aging 引擎需要判断 session 是否有收藏
- **THEN** 引擎 MUST 通过 `ConversationAnnotationStoreGateway` public port 查询
- **AND** MUST NOT 直接查询 `conversation_annotations` 表或 SQLite

### Requirement: Annotation architecture boundaries

标注功能 MUST 遵循 NextAgent 架构边界。`ConversationAnnotationStoreGateway` 的 SQLite 实现 MUST 位于 `agent-platform-gateway-local`，由 `SqliteGatewayStores` 管理。`RuntimeConversationAnnotationPort` 的实现 MUST 位于 `agent-session`，通过注入的 `ConversationAnnotationStoreGateway` 操作标注数据。`agent-channel-web` 只负责 transport 和 projection，通过注入的 `RuntimeConversationAnnotationPort` 操作标注，不直接访问 gateway port。`agent-context-engine`、`agent-capability` MUST NOT 导入标注 gateway port 或 runtime port。`agent-runtime` 只在 retry/edit supersede 清理中调用 `ConversationAnnotationStoreGateway.deleteAnnotationsByRun`，不拥有标注业务逻辑。

`ConversationAnnotationRecord` 只能作为 gateway port 的入参或返回值，不得作为 `agent-session` application service 的 public return 或进入 Web response。Web response 只能暴露 public DTO projection。

标注操作 MUST NOT 阻塞 request terminal commit、改变 canonical timeline、修改 active context 或影响 stream projection。标注操作 MUST NOT 触发 memory extraction、memory aging 或 capability invocation。

#### Scenario: Gateway implementation location
- **WHEN** 实现 `ConversationAnnotationStoreGateway`
- **THEN** 实现 MUST 位于 `agent-platform-gateway-local`，由 `SqliteGatewayStores` 管理

#### Scenario: Web channel does not access gateway directly
- **WHEN** `agent-channel-web` 处理标注路由
- **THEN** 它 MUST 通过 `RuntimeConversationAnnotationPort` 操作
- **AND** MUST NOT 直接导入或调用 `ConversationAnnotationStoreGateway`

#### Scenario: Runtime only calls deleteAnnotationsByRun on supersede
- **WHEN** `agent-runtime` 在 retry/edit 流程中需要清理旧 run 标注
- **THEN** 它 MUST 调用 `ConversationAnnotationStoreGateway.deleteAnnotationsByRun`
- **AND** MUST NOT 实现标注创建、查询或其他标注业务逻辑

#### Scenario: Annotation does not affect request lifecycle
- **WHEN** 用户在对话过程中创建或更新标注
- **THEN** 当前 request 的 terminal commit、stream projection 和 active context MUST 不受影响

#### Scenario: Annotation does not trigger memory lifecycle
- **WHEN** 用户创建或更新标注
- **THEN** 系统 MUST NOT 触发 memory extraction、memory aging 或 memory confidence 调整

### Requirement: Annotation failure and safe error handling

系统 SHALL 对标注操作的所有失败路径返回显式 `SafeError` 或等价安全错误。标注 gateway port MUST NOT 将 raw SQLite 异常、SQL 语句或存储路径暴露到 port boundary 之外。日志、metric 和 audit 不得包含标注内容、对话原文、prompt、模型输出或高基数字段。

**失败与降级规则**：
- 存储不可用：gateway port 返回 `SafeError { code: "ANNOTATION_STORAGE_UNAVAILABLE", category: UNAVAILABLE, retryable: true }`。
- scope 校验失败：返回 `SafeError { code: "ANNOTATION_SCOPE_INVALID", category: VALIDATION }`。
- 无静默失败：每个失败路径 MUST 产生显式 `SafeError` 和 structured log。

#### Scenario: Storage unavailable returns safe error
- **WHEN** 标注 gateway 操作遇到 SQLite 连接错误
- **THEN** 返回 `SafeError { code: "ANNOTATION_STORAGE_UNAVAILABLE" }`
- **AND** raw 异常详情只在内部日志记录，不暴露到 port boundary 外

#### Scenario: Audit excludes conversation content
- **WHEN** 标注创建或更新产生 audit/log
- **THEN** 日志只包含 `annotationId`、`sessionId`、`requestRunId`、`sentiment`、`isFavorited`、`comment` 的长度（不含内容）、scope 标识和 `occurredAt`
- **AND** MUST NOT 包含对话内容、message text、prompt 或模型输出
