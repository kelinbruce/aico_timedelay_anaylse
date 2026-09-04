## 当前实现基线（Current Baseline）

### pin 收藏

- `UserQuestionActivityStoreGateway.pinQuestion()` 在 `user_question_activity` 表设置 `is_pinned=1` 和 `pinned_at`，按 `question_hash` 跨 session 去重，FIFO 淘汰，上限 `pinLimit`（默认 100）。
- `POST /api/v1/user-questions/pin` 接收 `{ question }`，计算 SHA-256 hash，调用 `pinQuestion`。
- 前端 `TurnBlock` 的 pin 按钮（`btn-pin-user`）调用 `pinQuestion({ question })`，传入用户消息文本。
- `ConversationAnnotationRecord.isQuestionFavorited` 已在 gateway contract 冻结，SQLite `question_favorite` 列已建，但 runtime port、Web API 和前端均未接通。

### 高频问题与输入联想

- `frequent-question-service.listFrequentQuestions()` 合并三层：固定问题（静态目录）+ pinned 问题（`listPinned`）+ 高频问题（`listHighFrequency`，阈值 `frequencyThreshold` 默认 8）+ 剩余非固定目录问题。
- `frequent-question-service.listQuestionAssociations()` 合并三层关键词匹配：pinned（cap 10）+ high-frequency（cap 5）+ static（cap 5），cap 级联回填至 20。
- `question-activity-tracking-command-port` 在 submit/edit 时 fire-and-forget 调 `upsertActivity` 累加 `ask_frequency`。
- `QuestionRecommendationGateway` 已冻结 contract（`listFrequentHistoryQuestions`、`recommendSimilarPresetQuestions`）和 provider wire mapping，但无 adapter 实现。
- `WorkingMemoryGatewayBindings.questionRecommendations?` 为可选 binding，当前无注入。

### 部署模式

- LOCAL 模式：所有 gateway binding 由 local SQLite provider 提供。
- REMOTE 模式（`agent-remote-deployment`）：working memory（sessions、messages、annotations）仍由本地 SQLite provider 提供；sandbox/rag/workflow 走 remote provider。`QuestionRecommendationGateway` 当前未注入。

## 目标设计（Proposed Design）

### 1. pin 迁移到 isQuestionFavorited

#### 1.1 runtime contract 接通

`RuntimeUpsertAnnotationCommand` 新增可选字段：

```ts
readonly isQuestionFavorited?: boolean;
```

`ConversationAnnotationView` 新增字段：

```ts
readonly isQuestionFavorited: boolean;
```

`ConversationAnnotationService.toAnnotationView()` 映射 `record.isQuestionFavorited ?? false` 到 view。`upsertAnnotation()` 传递 `command.isQuestionFavorited` 到 record。

#### 1.2 pin 写入 API 变更

`POST /api/v1/user-questions/pin` 的 body 从 `{ question: string }` 改为：

```ts
{ sessionId: string; runId: string }
```

route 调用 `dependencies.annotations.upsertAnnotation({ identityContext, agentId, sessionId, requestRunId: runId, isQuestionFavorited: true })`。

前端 `TurnBlock` 的 pin 按钮改为调用 `annotationService.upsertAnnotation({ sessionId, runId, isQuestionFavorited: true })`，复用既有 annotation upsert 路径。

pin 不设上限，无 FIFO 淘汰。`isQuestionFavorited` 不受 `add-favorite-count-limit` 的 100 上限约束（该上限只针对 `isFavorited`）。

#### 1.3 pin 查询

`ConversationAnnotationStoreGateway` 新增方法：

```ts
listQuestionFavoriteTurns(query: ListQuestionFavoriteTurnsQuery): Promise<readonly ConversationFavoriteTurnSummary[] | SafeError>;
```

`ListQuestionFavoriteTurnsQuery extends OwnerScoped`，包含 `agentId`、`limit`、`offset`。返回 `ConversationFavoriteTurnSummary`（复用既有类型，包含 `sessionId`、`requestRunId`、`rootMessageId`、`questionPreview`、`questionTruncated`、`favoritedAt`）。

SQL 查询与 `listFavoriteTurns` 同构，只是 predicate 从 `is_favorited=1` 改为 `question_favorite=1`。JOIN `messages` 取 `role='USER'` 且 `visible=1` 的问题文本。

`RuntimeConversationAnnotationPort` 新增 `listQuestionFavoriteTurns(query)` 方法。`ConversationAnnotationService` 实现该方法，委托 gateway store，并补充 `sessionTitle` 和 `sessionUpdatedAt`（与 `listFavoriteTurns` 同构）。

`frequent-question-service` 的 pin 层改调此方法获取收藏问题文本列表。

### 2. QuestionRecommendationGateway local/remote 双模式

#### 2.1 binding 注入策略

`QuestionRecommendationGateway` 是 `WorkingMemoryGatewayBindings.questionRecommendations?` 可选成员。注入策略：

- **LOCAL 模式**：local gateway provider 注入 local adapter（读本地 `user_question_activity` 表）。
- **REMOTE 模式**：remote gateway provider 注入 remote adapter（调 provider HTTP）。

local adapter 和 remote adapter 实现同一 `QuestionRecommendationGateway` interface，`frequent-question-service` 只依赖 interface，不感知 deployment mode。

#### 2.2 local adapter

`packages/agent-platform-gateway-local` 新增 local `QuestionRecommendationGateway` adapter：

- `listFrequentHistoryQuestions(request)`：委托 `UserQuestionActivityStoreGateway.listHighFrequency()`，将 `UserQuestionActivityRecord` 映射为 `FrequentHistoryQuestion { content, frequency }`。`frequency` 来自 `ask_frequency`。`limit` 透传。`threshold` 来自配置 `frequencyThreshold`。SafeError 映射同既有 store 行为。
- `recommendSimilarPresetQuestions(request)`：LOCAL 模式无 provider 相似能力。返回 `RecommendSimilarPresetQuestionsResult { questions: [] }`（空列表）。LOCAL 模式联想的动态层不使用 `recommendSimilarPresetQuestions`，而是复用 `listFrequentHistoryQuestions`（本地高频数据）做关键词匹配。

local adapter 不接收 `AbortSignal` 的实际取消（本地 SQLite 同步调用），但保持 interface 签名一致。

#### 2.3 remote adapter

`packages/agent-platform-gateway-remote` 新增 remote `QuestionRecommendationGateway` adapter，复用 frozen design 的 wire mapping：

- `listFrequentHistoryQuestions(request)`：`POST /rest/naie/memory/v1/user/portrait`，request body `{ tenantId, userId: subjectId, agentId, searchCriteria: { questionTopN: limit }, portraitType: ["QUESTION"] }`，header `system-language: locale`（缺失不发）。response `questions[].value` → `content`，`questions[].count` → `frequency`。空响应规范化为 `{ questions: [] }`。
- `recommendSimilarPresetQuestions(request)`：`POST /rest/naie/memory/v2/recommendation/similar-question`，request body `{ query, topn: limit, locale?, product?, domain?, scene? }`。`agentId` 和 Owner Scope 只用于可信 scope 和 adapter 调用上下文，不写入 body。response `data[].questionId` → `questionId`，`data[].content` → `content`。空响应规范化为 `{ questions: [] }`。

remote adapter MUST 在外部调用前验证 request（Ajv + frozen runtime schema），在构造 canonical result 后验证 result。返回条目数量不超过 request `limit`，超过时截断。失败统一使用 SafeError（`QUESTION_RECOMMENDATION_INVALID_INPUT`、`QUESTION_RECOMMENDATION_CANCELED`、`QUESTION_RECOMMENDATION_UNAVAILABLE`、`QUESTION_RECOMMENDATION_INVALID_PROVIDER_RESULT`）。

remote adapter 接收 `AbortSignal` 并在调用中传播取消。

#### 2.4 composition 注入

`agent-app` composition 根据 `systemConfig.gateway.deploymentMode` 和 `questionRecommendations` binding 是否存在选择注入：

- local gateway provider 在 `createSelected` 中，若 `questionRecommendations` 未被 remote provider 提供且 LOCAL 模式 selected，注入 local adapter。
- remote gateway provider 在 `bindings` factory 中，若 `selectedKinds` 包含 working-memory，注入 remote adapter。
- `frequent-question-service` 依赖 `QuestionRecommendationGateway`（通过 `WorkingMemoryGatewayBindings.questionRecommendations`）。若 binding 为 `undefined`，service 的高频层（`listFrequentHistoryQuestions`）和动态层返回空。

### 3. frequent-question-service 重构

#### 3.1 listFrequentQuestions（高频问题面板）

三层合并改为：

1. **固定问题**（静态目录，locale 过滤）— 不变
2. **pin 收藏问题**（从 `conversation_annotations.isQuestionFavorited` 查询，按 hash 去重）— 替代旧 `listPinned`
3. **高频问题**（调 `QuestionRecommendationGateway.listFrequentHistoryQuestions`，local 读表 / remote 调 provider）— 替代旧 `listHighFrequency` 直接调用
4. **剩余非固定目录问题**（locale 过滤）— 不变
5. 空时返回空列表 — 不变

pin 层和高频层均不按 locale 过滤（与现状一致）。去重以 `question_hash` 为准。

#### 3.2 listQuestionAssociations（输入联想）

分层改为（第二层为动态层，由 deployment mode 决定数据来源）：

1. **pinned 层**：从 `conversation_annotations.isQuestionFavorited` 查询收藏问题，关键词模糊匹配，source=`"pinned"`，cap 10
2. **动态层**（二选一，由 deployment mode 决定）：
   - LOCAL 模式 high-frequency 层：调 `QuestionRecommendationGateway.listFrequentHistoryQuestions`（local adapter 读本地高频数据），关键词模糊匹配，source=`"high-frequency"`，cap 5
   - REMOTE 模式 recommended 层：调 `QuestionRecommendationGateway.recommendSimilarPresetQuestions`（remote adapter 调 provider 返回语义相似问题），source=`"recommended"`，cap 5
3. **static 层**：静态目录关键词匹配，source=`"static"`，cap 5

LOCAL 模式和 REMOTE 模式的动态层不会同时出现：LOCAL 模式只有 high-frequency 层（无 recommended），REMOTE 模式只有 recommended 层（无 high-frequency）。这保证 LOCAL 模式联想行为与迁移前一致（高频层不变），REMOTE 模式联想多了一层 provider 语义相似问题。

cap 级联回填策略不变（pinned → 动态层 → static，剩余 slot 按动态层 → static 回填，总计不超过 20）。

去重以 `question_hash` 为准，遍历顺序 pinned → 动态层 → static，首次出现记录 source。

#### 3.3 source 标签

`QuestionAssociationSource` 从 `"pinned" | "high-frequency" | "static"` 改为 `"pinned" | "high-frequency" | "recommended" | "static"`。

- `"pinned"`：来自用户问题收藏（`isQuestionFavorited`）
- `"high-frequency"`：来自本地高频问题（`listFrequentHistoryQuestions`，仅 LOCAL 模式联想）
- `"recommended"`：来自 provider 语义相似问题（`recommendSimilarPresetQuestions`，仅 REMOTE 模式联想）
- `"static"`：来自静态目录

`"high-frequency"` 和 `"recommended"` 不会在同一 deployment mode 下同时出现。LOCAL 模式联想保留 high-frequency 层（行为与迁移前一致），REMOTE 模式联想使用 recommended 层替代。高频问题面板（`listFrequentQuestions`）在两种模式下都通过 `listFrequentHistoryQuestions` 获取高频数据。

### 4. question-activity-tracking-command-port 模式条件注入

`question-activity-tracking-command-port` 只在 LOCAL 模式注入。REMOTE 模式下 provider 自己统计高频数据，NextAgent 不上报。

composition 判断：若 `systemConfig.gateway.deploymentMode === "LOCAL"` 且 `questionRecommendations` binding 为 local adapter，则包装 `trackedRuntimeCommands`；否则直接使用 `runtimeCommands`。

`user_question_activity` 表和 `UserQuestionActivityStoreGateway` 保留（local adapter 需要读 `listHighFrequency`）。REMOTE 模式下表不读写，但不 DROP。

### 5. 废弃清理

#### 5.1 UserQuestionActivityStoreGateway

废弃方法：
- `pinQuestion(record, pinLimit, options)` — pin 迁移到 annotation
- `listPinned(query)` — pin 查询迁到 annotation store

保留方法：
- `upsertActivity(record, options)` — local 模式高频统计
- `listHighFrequency(query)` — local adapter 消费

#### 5.2 SQLite schema

`user_question_activity` 表的 `is_pinned` 和 `pinned_at` 列保留（不 DROP，避免 ALTER TABLE 风险），但代码不再读写。`idx_user_question_activity_pinned` 索引保留但无查询使用。

#### 5.3 配置项

移除 `nextAgent.highFrequencyQuestion.pinLimit` 配置项（pin 不设上限）。保留 `frequencyThreshold`（local adapter 需要）。

#### 5.4 Web API

`POST /api/v1/user-questions/pin` 的 body shape 变更。`userQuestionPinBody` schema 从 `{ question }` 改为 `{ sessionId, runId }`。

annotation upsert DTO (`upsertAnnotationBody`) 新增 `isQuestionFavorited: Type.Optional(Type.Boolean())`。annotation response DTO 新增 `isQuestionFavorited`。projection 函数映射该字段。

### 6. 前端变更

#### 6.1 TurnBlock pin 按钮

pin 按钮（`btn-pin-user`）改为调用 `annotationService.upsertAnnotation({ sessionId, runId, isQuestionFavorited: true })`，而非 `pinQuestion({ question })`。

pin 状态从 annotation view 的 `isQuestionFavorited` 读取（初始加载时通过 `listSessionAnnotations` 获取）。

#### 6.2 高频问题面板

`HighFrequencyQuestions` 组件消费 `listFrequentQuestions` 返回的数据，数据源变更对组件透明（service 层处理）。

#### 6.3 输入联想

输入联想消费 `listQuestionAssociations` 返回的数据，新增 `"recommended"` source 标签（REMOTE 模式）。LOCAL 模式 `"high-frequency"` 标签保持不变。前端展示逻辑需处理新增的 `"recommended"` 标签。

## 明确保持不变的边界

- `conversation_annotations` 的 request-run 锚点、唯一约束、idempotency option、cleanup owner 不变。
- 回答收藏（`isFavorited`）的 100 上限行为不变。
- `SuggestedQuestionPort`（回答完成后模型生成推荐问题）不变。
- 静态目录（`CategoryQuestionCatalog`）的加载、locale 过滤、hash 计算不变。
- `user_question_activity` 表的 `upsertActivity` 和 `listHighFrequency` 行为不变（local adapter 消费）。
- `ask_frequency` 的增长时机（submit/edit fire-and-forget）不变（LOCAL 模式）。
- provider wire mapping 严格遵循 `add-ts-question-recommendation-gateway-contracts` frozen design，不新增字段或映射。

## 备选方案（Alternatives Considered）

### pin 存储保留在 user_question_activity

未选择。pin 与高频统计共用表导致职责混淆，且 `isQuestionFavorited` 已冻结为问题收藏的 canonical 字段。保留旧表会形成同一语义两套存储。

### pin 查询复用 listFavoriteTurns

未选择。`listFavoriteTurns` 查询 `is_favorited=1`（回答收藏），语义不同。新增 `listQuestionFavoriteTurns` 查询 `question_favorite=1`，同构但独立，符合同形同策原则。

### LOCAL 模式 recommendSimilarPresetQuestions 复用本地关键词匹配

未选择。LOCAL 模式联想保留 high-frequency 层（复用 `listFrequentHistoryQuestions` 本地高频数据做关键词匹配），与迁移前行为一致。`recommended` 层只在 REMOTE 模式出现。两种模式的动态层互斥，标签语义精确。

### REMOTE 模式联想整体替换为 provider 相似问题

未选择。用户要求保留 pin + static 关键词匹配层。provider 相似问题作为独立一层，source 标签 `"recommended"` 与 `"pinned"`/`"static"` 区分。

## 质量属性设计（Quality Attributes）

| 质量属性 | 设计结论 | 验证方向 |
|---|---|---|
| 安全 | pin 写入通过 annotation upsert 路径，继承 Owner Scope + Agent Scope 校验；remote adapter 不泄漏 query、结果、身份或 provider raw error；SafeError 统一映射。 | contract negative tests、SafeError 映射测试、安全边界审查 |
| 性能/容量 | pin 不设上限，但锚定 requestRunId，自然受会话生命周期约束；高频查询 provider 返回 top N（最多 10），SQLite 仅新增一个查询方法（复用现有索引模式）。 | schema 边界测试、SQLite characterization |
| 可靠性/恢复 | remote adapter AbortSignal 可取消；provider 失败 SafeError fallback 到空；LOCAL 模式 tracking port 失败 fire-and-forget 不阻断请求。 | cancellation contract review、store integration tests |
| 可维护性 | local/remote adapter 实现同一 interface，service 不感知模式；pin 迁移消除双存储；source 标签语义清晰。 | TypeScript build、architecture test、模型语义审查 |
| 可测试性 | local adapter 可用 SQLite fixture 测试；remote adapter 可用 HTTP mock 测试；service 层可用 gateway mock 测试双模式。 | contract tests、adapter integration tests、service unit tests |
| 审计/可追溯性 | pin 事实继承 annotation 的 createdAt/updatedAt 和 request-run anchor；高频查询不写入 telemetry。 | row round-trip 测试、observability 人工审查 |

## 验证策略（Verification Strategy）

- contract tests 验证 `QuestionRecommendationGateway` local/remote adapter 的 schema 边界、SafeError 映射和 canonical result validation。
- SQLite integration tests 验证 `listQuestionFavoriteTurns` 的查询、去重、scope 隔离和 JOIN messages 行为。
- SQLite integration tests 验证 `isQuestionFavorited` 通过 runtime port 和 Web API 的 round-trip。
- service unit tests 验证 `frequent-question-service` 在 local/remote 两种 gateway mock 下的三层合并和 source 标签。
- architecture tests 验证 `QuestionRecommendationGateway` 只出现在 `WorkingMemoryGatewayBindings.questionRecommendations`，不新增顶层 binding。
- frontend tests 验证 pin 按钮调用 annotation API 和状态回显。
- workspace build、contract gate、architecture lint 验证跨 package 编译和 minimal kernel non-regression。

## 风险与取舍（Risks / Trade-offs）

- **pin API shape 破坏性变更**：`POST /user-questions/pin` body 从 `{ question }` 改为 `{ sessionId, runId }`，前端必须同步更新。缓解：前后端在同一 change 内完成。
- **LOCAL/REMOTE 模式动态层差异**：LOCAL 模式联想动态层为 high-frequency（本地高频关键词匹配），REMOTE 模式为 recommended（provider 语义相似）。两种模式下动态层的内容和匹配方式不同（关键词 vs 语义），联想结果可能不同。缓解：这是 deployment mode 的自然差异，service 层不补偿；LOCAL 模式联想行为与迁移前完全一致，无回退。
- **REMOTE 模式高频数据口径差异**：provider 的 `count` 统计口径可能与本地 `ask_frequency` 不同，高频问题列表内容在模式切换时会变化。缓解：这是预期的模式差异，service 层不补偿。
- **`user_question_activity.is_pinned` 列保留**：旧列不 DROP，避免 ALTER TABLE 风险，但形成死列。缓解：代码不读写，归档时在长期 design 记录。
- **pin 不设上限**：无界增长受 requestRunId 生命周期约束（supersede/session 删除级联清理），但极端场景仍可能积累。缓解：与回答收藏不同，问题收藏是低频操作，且 annotation 行复用（同一 run 的 sentiment/favorite/comment 共享行）。

## 迁移与回滚（Migration / Rollback）

### pin 数据迁移

pin 从 `user_question_activity.is_pinned` 迁到 `conversation_annotations.isQuestionFavorited`。已有 pin 数据不自动迁移（旧表 `is_pinned` 记录无 `requestRunId` 锚点，无法映射到 annotation 行）。用户需重新 pin。这是破坏性变更，在同一 change 内前端同步切换。

### SQLite schema

`conversation_annotations.question_favorite` 列已在前序 change 建好，无需新增。`user_question_activity` 的 `is_pinned`/`pinned_at` 列保留不 DROP。

### 回滚

回滚到旧版本时，`conversation_annotations.question_favorite` 列保留（SQLite 兼容），旧版本不读写该列。`user_question_activity` 旧列仍在，旧版本可恢复 pin 行为。前端回滚需同步。
