## 1. Gateway 契约定义

- [x] 1.1 移除未实现的 `FeedbackRecord`/`FeedbackStoreGateway`，新增 `ConversationAnnotationRecord`/`ConversationAnnotationStoreGateway` 及配套 DTO
  验证：`npm run build` 编译通过；`rg "ConversationAnnotationStoreGateway" packages/agent-contracts/src/gateway/index.ts` 确认导出；`rg "FeedbackStoreGateway\|FeedbackRecord" packages/agent-contracts/src/` 确认已移除
  来源：spec "Conversation annotation persistence and scope isolation"；design 决策 1、5

  在 `packages/agent-contracts/src/gateway/index.ts` 中：
  - 移除 `FeedbackRecord`、`ListFeedbackRecordsRequest`、`FeedbackStoreGateway`
  - `ConversationAnnotationRecord extends OwnerScoped`，含 `agentId`、`annotationId`、`sessionId`、`requestRunId`、`sentiment`（`"UP" | "DOWN" | null`）、`isFavorited`（boolean）、`comment`（`string | null`，最大 1000 字符）、`createdAt`、`updatedAt`；MUST NOT 包含 `idempotencyKey`
  - 不定义 `type` 枚举——`sentiment` 和 `isFavorited` 是同行两个独立字段
  - `DeleteAnnotationsByRunRequest extends OwnerScoped`，含 `agentId`、`requestRunId`
  - `ListFavoriteSessionsQuery extends OwnerScoped`，含 `agentId`、`limit`、`offset`
  - `ConversationFavoriteSessionSummary`，含 `sessionId`、`favoriteCount`
  - `ListSessionAnnotationsQuery extends OwnerScoped`，含 `agentId`、`sessionId`
  - `ConversationAnnotationStoreGateway` 接口：`saveAnnotation`（upsert）、`deleteAnnotationsByRun`、`listFavoriteSessions`、`listSessionAnnotations`
  - `saveAnnotation` 接收 `ConversationAnnotationRecord` + `IdempotentWriteOptions`，返回 `ConversationAnnotationRecord | undefined`（全空行删除后返回 `undefined`）

- [x] 1.2 移除 `agent-contracts/session` 中的 `Feedback`/`SubmitFeedbackRequest`/`ListFeedbackRequest`
  验证：`npm run build` 编译通过；`rg "Feedback\|SubmitFeedback\|ListFeedback" packages/agent-contracts/src/session/index.ts` 确认已移除
  来源：spec "Conversation annotation persistence and scope isolation"；design 决策 5

## 2. Runtime port 契约定义

- [x] 2.1 新增 `RuntimeConversationAnnotationPort` 及配套 Command/Query/Result DTO
  验证：`npm run build` 编译通过；`rg "RuntimeConversationAnnotationPort" packages/agent-contracts/src/runtime/index.ts` 确认导出
  来源：spec "Annotation Web REST API contract"；design 决策 4

  在 `packages/agent-contracts/src/runtime/index.ts` 中新增：
  - `RuntimeUpsertAnnotationCommand`，含 `identityContext`、`sessionId`、`requestRunId`、`sentiment?`（`"UP" | "DOWN" | null`）、`isFavorited?`（boolean）、`comment?`（`string | null`）、`idempotencyKey`；至少提供 `sentiment`、`isFavorited` 或 `comment` 其一
  - `RuntimeListFavoriteSessionsQuery`，含 `identityContext`、`offset`、`limit`
  - `RuntimeListSessionAnnotationsQuery`，含 `identityContext`、`sessionId`
  - `ConversationAnnotationView`（public DTO），含 `annotationId`、`sessionId`、`requestRunId`、`sentiment`、`isFavorited`、`comment`、`createdAt`
  - `ConversationFavoriteSessionEntry`（public DTO），含 `sessionId`、`favoriteCount`、`sessionTitle?`、`sessionUpdatedAt`
  - `ConversationFavoriteSessionPage`，含 `entries[]`、`offset`、`limit`、`hasMore`
  - `RuntimeConversationAnnotationPort` 接口：`upsertAnnotation`、`listFavoriteSessions`、`listSessionAnnotations`；不定义 `deleteAnnotation`——取消标注通过 upsert `sentiment=null`/`isFavorited=false` 完成

## 3. SQLite Gateway 实现

- [x] 3.1 新增 `conversation_annotations` 表定义和 row mapping
  验证：`npx vitest run packages/agent-platform-gateway-local/tests/sqlite-gateway-stores.test.ts -t "conversation_annotations" --reporter=verbose`
  来源：spec "Conversation annotation persistence and scope isolation"；design 数据模型

  在 `packages/agent-platform-gateway-local/src/db/sqlite-gateway-stores.ts` 中：
  - 在 `initialize()` 中新增 `CREATE TABLE IF NOT EXISTS conversation_annotations`
  - 列：`tenant_id, subject_id, agent_id, annotation_id, session_id, request_run_id, sentiment, is_favorited, comment, idempotency_key, created_at, updated_at`
  - `sentiment` 列类型 `TEXT NULL`，值为 `'UP'`/`'DOWN'`/`NULL`
  - `is_favorited` 列类型 `INTEGER`，值为 `0`/`1`
  - `comment` 列类型 `TEXT NULL`，最大 1000 字符，NULL 表示无评论
  - PK: `(tenant_id, subject_id, agent_id, annotation_id)`
  - UNIQUE INDEX: `(scope, session_id, request_run_id)` — 一个 run 一行
  - UNIQUE INDEX: `(scope, idempotency_key) WHERE idempotency_key IS NOT NULL`
  - INDEX: `(scope, session_id, created_at ASC)` — 会话内标注查询
  - INDEX: `(scope, is_favorited, updated_at DESC)` — 收藏会话列表查询
  - 新增 `ConversationAnnotationRow` interface 和 `toConversationAnnotationRecord` row mapper

- [x] 3.2 实现 `saveAnnotation` upsert 方法（含全空行删除）
  验证：`npx vitest run packages/agent-platform-gateway-local/tests/sqlite-gateway-stores.test.ts -t "saveAnnotation" --reporter=verbose`
  来源：spec "Sentiment and favorite independent upsert"

  实现 `saveAnnotation(record, options)`:
  - 按 `(scope, session_id, request_run_id)` 查询是否已存在行
  - 按 `(scope, idempotency_key)` 查询是否已存在（幂等），存在则返回已有记录
  - **无行**：INSERT 新行，`created_at` = `updated_at` = 当前时间
  - **有行**：UPDATE 提供的字段（`sentiment` 或 `isFavorited`），未提供的字段保持不变；`updated_at` = 当前时间
    - 若 `comment` 提供：更新 `comment` 字段（`null` 清空，非空字符串设置）
    - 若 `comment` 未提供：`comment` 不变
  - **UPDATE 后若 `sentiment=NULL` 且 `is_favorited=0`（`comment` 同时被删，不参与判定）**：物理 DELETE 该行，返回 `undefined`
  - 幂等：相同值重复 upsert 返回当前状态（不产生额外 side effect）
  - 存储失败返回 `SafeError { code: "ANNOTATION_STORAGE_UNAVAILABLE" }`

- [x] 3.3 实现 `deleteAnnotationsByRun` 方法
  验证：`npx vitest run packages/agent-platform-gateway-local/tests/sqlite-gateway-stores.test.ts -t "deleteAnnotationsByRun" --reporter=verbose`
  来源：spec "Annotation supersede cleanup on retry/edit"

  实现 `deleteAnnotationsByRun(request)`:
  - `DELETE FROM conversation_annotations WHERE scope=? AND request_run_id=?`
  - 删除该 run 的标注行（一行 per run，所以最多删一行）
  - 无论行是否存在都返回成功（幂等）

- [x] 3.4 实现 `listFavoriteSessions` 方法
  验证：`npx vitest run packages/agent-platform-gateway-local/tests/sqlite-gateway-stores.test.ts -t "listFavoriteSessions" --reporter=verbose`
  来源：spec "Annotation list and query behavior"

  实现 `listFavoriteSessions(query)`:
  - `SELECT session_id, COUNT(*) AS favorite_count FROM conversation_annotations WHERE scope=? AND is_favorited=1 GROUP BY session_id ORDER BY MAX(updated_at) DESC LIMIT ? OFFSET ?`
  - 返回 `ConversationFavoriteSessionSummary[]`

- [x] 3.5 实现 `listSessionAnnotations` 方法
  验证：`npx vitest run packages/agent-platform-gateway-local/tests/sqlite-gateway-stores.test.ts -t "listSessionAnnotations" --reporter=verbose`
  来源：spec "Annotation list and query behavior"

  实现 `listSessionAnnotations(query)`:
  - `SELECT * FROM conversation_annotations WHERE scope=? AND session_id=? ORDER BY created_at ASC`
  - 返回 `ConversationAnnotationRecord[]`，含 `sentiment`、`isFavorited`、`comment`、`createdAt`

- [x] 3.6 在 `SqliteGatewayStores` 中注册 annotation store
  验证：`npm run build` 编译通过
  来源：spec "Annotation architecture boundaries"

  在 `SqliteGatewayStores` class 中新增 `conversationAnnotations` getter。

- [x] 3.7 Gateway scope 隔离 negative test
  验证：`npx vitest run packages/agent-platform-gateway-local/tests/sqlite-gateway-stores.test.ts -t "cross scope" --reporter=verbose`
  来源：spec "Conversation annotation persistence and scope isolation"

  测试 `(T1,U1,A1)` 创建标注后，`(T1,U2,A1)`、`(T2,U1,A1)`、`(T1,U1,A2)` 查询均返回空。

- [x] 3.8 Upsert 行为 negative test
  验证：`npx vitest run packages/agent-platform-gateway-local/tests/sqlite-gateway-stores.test.ts -t "upsert" --reporter=verbose`
  来源：spec "Sentiment and favorite independent upsert"

  测试场景：
  - UP→DOWN 是同行 `sentiment` 字段 UPDATE，`isFavorited` 不变
  - 设 `isFavorited=true` 不影响 `sentiment` 字段
  - `sentiment=null` + `isFavorited=false` 后行被物理删除
  - `sentiment=null` + `isFavorited=true` 后行保留
  - `isFavorited=false` + `sentiment="UP"` 后行保留
  - `createdAt` 保持首次动作时间不变，`updatedAt` 随每次更新推进
  - `comment` upsert：设置、清空（`null`）、不修改（`undefined`）三种语义
  - `sentiment=null` + `isFavorited=false` + `comment="text"` 后行被物理删除（`comment` 不阻止删除）

- [x] 3.9 幂等 negative test
  验证：`npx vitest run packages/agent-platform-gateway-local/tests/sqlite-gateway-stores.test.ts -t "idempotent" --reporter=verbose`
  来源：spec "Sentiment and favorite independent upsert"

  测试重复 `saveAnnotation` 同一 `(scope, runId)` 相同值返回同一 `annotationId`，无额外 side effect。

## 4. Runtime Port 实现

- [x] 4.1 实现 `RuntimeConversationAnnotationPort` in `agent-session`
  验证：`npx vitest run packages/agent-session/tests/conversation-annotation.test.ts --reporter=verbose`
  来源：spec "Annotation Web REST API contract"；design 决策 4

  在 `packages/agent-session/src/` 中新增 annotation service 实现：
  - `upsertAnnotation`：组装 `ConversationAnnotationRecord`（scope 来自 IdentityContext + 可信 agentId），调 `saveAnnotation`，返回 `ConversationAnnotationView` 或空状态
  - `listFavoriteSessions`：调 gateway `listFavoriteSessions` + 批量加载 session 元数据（标题、最后更新时间），投影为 `ConversationFavoriteSessionEntry[]`
  - `listSessionAnnotations`：调 gateway `listSessionAnnotations`，投影为 `ConversationAnnotationView[]`

## 5. Supersede 清理实现

- [x] 5.1 在 retry/edit supersede 流程中新增标注清理调用
  验证：`npx vitest run packages/agent-runtime/tests/supersede-cleanup.test.ts --reporter=verbose`
  来源：spec "Annotation supersede cleanup on retry/edit"；design 决策 3

  在 `packages/agent-runtime/src/lifecycle/submit.ts` 的 retry/edit 流程中：
  - 在标记旧 run 为 `SUPERSEDED` 后，调用 `ConversationAnnotationStoreGateway.deleteAnnotationsByRun`
  - 若清理失败，retry/edit 操作 MUST 报告失败
  - runtime 只调用 `deleteAnnotationsByRun`，不拥有其他标注业务逻辑

- [x] 5.2 supersede 清理 negative test
  验证：`npx vitest run packages/agent-runtime/tests/supersede-cleanup.test.ts -t "cleanup" --reporter=verbose`
  来源：spec "Annotation supersede cleanup on retry/edit"

  测试 retry 后旧 run 的标注行（无论 `sentiment` 还是 `isFavorited`）被删除。

- [x] 5.3 清理失败则 retry 失败 negative test
  验证：`npx vitest run packages/agent-runtime/tests/supersede-cleanup.test.ts -t "failure" --reporter=verbose`
  来源：spec "Annotation supersede cleanup on retry/edit" — 清理失败 MUST 报告失败

  测试 `deleteAnnotationsByRun` 失败时 retry 操作报告失败。

## 6. Web 路由实现

- [x] 6.1 新增标注 DTO schema 和 projection 函数
  验证：`npm run build` 编译通过
  来源：spec "Annotation Web REST API contract"

  在 `packages/agent-channel-web/src/schemas/` 中新增 `annotation-dto.ts`：
  - `upsertAnnotationBody` TypeBox schema: `{ sentiment?: "UP"|"DOWN"|null, isFavorited?: boolean }`，至少提供其一
  - `annotationResponse` projection
  - `favoriteSessionListResponse` projection
  - `sessionAnnotationsResponse` projection

- [x] 6.2 实现三条标注 REST 路由
  验证：`npx vitest run packages/agent-channel-web/tests/annotation-routes.test.ts --reporter=verbose`
  来源：spec "Annotation Web REST API contract"

  在 `packages/agent-channel-web/src/routes/requests.ts` 中新增：
  - `POST /api/v1/sessions/:sessionId/runs/:runId/annotations`（upsert，无 DELETE 路由）
  - `GET /api/v1/favorites`
  - `GET /api/v1/sessions/:sessionId/annotations`
  - `WebChannelDependencies` 新增 `annotations?: RuntimeConversationAnnotationPort`

- [x] 6.3 503 降级 negative test
  验证：`npx vitest run packages/agent-channel-web/tests/annotation-routes.test.ts -t "unavailable" --reporter=verbose`
  来源：spec "Annotation Web REST API contract" — ANNOTATIONS_UNAVAILABLE

  测试 `annotations` 未注入时三条路由均返回 `503`。

- [x] 6.4 limit 超限 negative test
  验证：`npx vitest run packages/agent-channel-web/tests/annotation-routes.test.ts -t "limit" --reporter=verbose`
  来源：spec "Annotation Web REST API contract" — limit 上限 100

  测试 `GET /api/v1/favorites?limit=200` 返回 `400`。

- [x] 6.5 client-supplied scope ignored negative test
  验证：`npx vitest run packages/agent-channel-web/tests/annotation-routes.test.ts -t "scope" --reporter=verbose`
  来源：spec "Conversation annotation persistence and scope isolation"

  测试 POST body 携带 `tenantId/subjectId/agentId` 时被忽略。

## 7. App Composition 注入

- [x] 7.1 在 `agent-app` composition root 注入 annotation port 和 gateway
  验证：`npm run build` 编译通过；`npm test` 现有测试不回归
  来源：spec "Annotation architecture boundaries"；design 调用链路

## 8. 前端实现（agent-web）

- [x] 8.1 新增标注 API client 模块
  验证：`npx vitest run packages/agent-web/tests/annotation-api.test.ts --reporter=verbose`
  来源：spec "Frontend annotation interaction behavior"

  在 `packages/agent-web/src/` 中新增 annotation API client：
  - `upsertAnnotation(sessionId, runId, { sentiment?, isFavorited? })` → POST
  - `listFavoriteSessions(offset, limit)` → GET /api/v1/favorites
  - `listSessionAnnotations(sessionId)` → GET /api/v1/sessions/:sessionId/annotations

- [x] 8.2 新增标注图标组件和三态 toggle 交互
  验证：`npx vitest run packages/agent-web/tests/annotation-icons.test.ts --reporter=verbose`
  来源：spec "Frontend annotation interaction behavior" — 三态 toggle

  在每轮问答回复下方新增点赞、点踩、收藏三个图标：
  - 打开会话时调 `listSessionAnnotations` 获取标注，构建 `Map<requestRunId, { sentiment, isFavorited, comment }>`（本 change 不实现 comment 的前端展示逻辑）
  - 渲染时查 Map 决定图标高亮/灰色；不在 Map 中的 run 全灰
  - 点赞/点踩三态 toggle（灰→UP→DOWN→灰，互斥切换），通过 upsert `sentiment` 实现
  - 收藏 toggle（灰→高亮→灰），通过 upsert `isFavorited` 实现
  - 乐观更新 + 失败回滚

- [x] 8.3 标注状态持久化：页面刷新后恢复高亮
  验证：`npx vitest run packages/agent-web/tests/annotation-icons.test.ts -t "persist" --reporter=verbose`
  来源：spec "Frontend annotation interaction behavior" — 状态 persists across reload

- [x] 8.4 侧边栏收藏列表视图
  验证：`npx vitest run packages/agent-web/tests/favorite-sidebar.test.ts --reporter=verbose`
  来源：spec "Frontend annotation interaction behavior" — sidebar list

  侧边栏新增收藏功能入口：分页加载、显示标题和最近收藏时间。

- [x] 8.5 单击收藏列表项还原会话
  验证：`npx vitest run packages/agent-web/tests/favorite-sidebar.test.ts -t "restore" --reporter=verbose`
  来源：spec "Frontend annotation interaction behavior" — click restores conversation

  单击列表项复用历史会话还原逻辑，还原后已标注轮次图标正确高亮。

## 9. 架构边界验证

- [x] 9.1 架构边界 assertion test：web channel 不导入 gateway port
  验证：`npm run lint:architecture` 或 source-level assertion
  来源：spec "Annotation architecture boundaries"

  `agent-channel-web` MUST NOT import `ConversationAnnotationStoreGateway`。
  `agent-context-engine`、`agent-capability` MUST NOT 导入标注 gateway port 或 runtime port。
  `agent-runtime` 只调用 `deleteAnnotationsByRun`，不导入其他标注方法。

- [x] 9.2 标注不影响 terminal commit characterization test
  验证：`npx vitest run packages/agent-session/tests/conversation-annotation.test.ts -t "terminal commit" --reporter=verbose`
  来源：spec "Annotation architecture boundaries" — 不影响 request lifecycle

  测试创建/更新标注后，request run 状态、timeline、active context 不变。

- [x] 9.3 标注不触发 memory lifecycle negative test
  验证：`npx vitest run packages/agent-session/tests/conversation-annotation.test.ts -t "memory" --reporter=verbose`
  来源：spec "Annotation architecture boundaries" — 不触发 memory lifecycle

  测试创建标注后 `LongTermMemoryStoreGateway` 的方法未被调用。

## 10. 集成验证和收尾

- [x] 10.1 全量 build 和 test
  验证：`npm run build && npm test`
  来源：所有 spec requirements

- [x] 10.2 OpenSpec 验证
  验证：`openspec validate --all --strict`
  来源：AGENTS.md 验证门禁

- [x] 10.3 清理实现产生的临时状态
  验证：`git diff --check`；code review 检查无 debug logging、临时 fixture 或未使用 import
  来源：AGENTS.md 实现质量门禁

## 归档前更新基线检查（非实施任务）

实现完成并验证通过后，在归档前根据 proposal/design 的"归档前更新基线"处理：

- 同步 `openspec/specs/conversation-annotation/spec.md`。
- 修改 `openspec/specs/ts-core-contracts/spec.md`，`FeedbackStoreGateway` → `ConversationAnnotationStoreGateway`。
- 更新 `openspec/overview.md`，新增对话标注能力说明。
- 更新 `openspec/designs/architecture/core-contracts.md`。
- 更新 `openspec/designs/modules/agent-contracts.md`、`agent-channel-web.md`、`agent-session.md`、`agent-runtime.md`。
- 更新 `openspec/designs/spec-to-design-map.md`。
- 检查长期文档没有重复定义同一状态机、API schema、数据 owner 或接口语义。
