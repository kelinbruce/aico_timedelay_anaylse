## 背景与问题（Why）

NextAgent 的"添加到常用问题"功能当前通过 `user_question_activity` 表的 `is_pinned` 字段实现，与高频问题统计（`ask_frequency`）共用一张表。这带来三个问题：

- **存储职责混淆**：pin 收藏与高频统计是两个独立业务事实，却共用 `UserQuestionActivityStoreGateway` 的同一行记录和同一张表。pin 收藏锚定问题文本 hash（跨 session 去重），高频统计锚定问题文本 hash（频次累加），两者生命周期、清理边界和消费方均不同。
- **pin 与 annotation 收藏能力割裂**：前序 change `add-ts-question-recommendation-gateway-contracts` 已在 `ConversationAnnotationRecord` 冻结了 `isQuestionFavorited` 字段，专门表达"问题收藏"，但该字段只接通了 gateway 持久化层，runtime port、Web API 和前端均未接通。pin 仍在旧表，形成了同一语义的两套存储。
- **高频/联想能力缺少 remote 适配**：`QuestionRecommendationGateway` 已冻结 provider 高频问题（`/rest/naie/memory/v1/user/portrait`，返回带 count）和相似问题（`/rest/naie/memory/v2/recommendation/similar-question`）的 canonical contract，但没有 local/remote adapter 实现。`frequent-question-service` 永远读本地 `user_question_activity` 表，remote 部署模式下无法消费 provider 的高频和相似问题能力。

### 术语

- **问题收藏（Question Favorite / pin）**：用户对某轮对话中用户问题本身的收藏，锚定 `requestRunId`，存储在 `conversation_annotations.isQuestionFavorited`。迁移后与回答收藏（`isFavorited`）同属一行标注的两个独立布尔事实。
- **高频问题（Frequent History Question）**：按当前 Owner Scope 和 Agent Scope 聚合的历史高频问题。LOCAL 模式由 NextAgent 本地统计（`ask_frequency`），REMOTE 模式由 provider 返回（带 count）。
- **预置相似问题（Preset Similar Question）**：根据当前查询文本从 provider 返回的语义相似问题，用于输入联想。
- **常用问题列表**：高频问题面板的数据来源，由固定问题（静态目录）、pin 收藏问题和高频问题三层合并。

### 规范上下文

- 需求来源：将"添加到常用问题"从独立 pin 表迁移到 `isQuestionFavorited`，并接通 `QuestionRecommendationGateway` 的 local/remote 双模式实现。
- Change 类型：frozen contract 接通 + persistence owner 迁移 + local/remote adapter 实现。
- 主要 owner：`agent-contracts`（runtime port）、`agent-session`（service）、`agent-platform-gateway-local`（local adapter + pin 迁移）、`agent-platform-gateway-remote`（remote adapter）、`agent-channel-web`（Web API）、`frontend/agent-web`（前端交互）。

## 目标与非目标（Goals / Non-Goals）

**目标：**

- 将 pin 收藏从 `user_question_activity.is_pinned` 迁移到 `conversation_annotations.isQuestionFavorited`，接通 runtime `ConversationAnnotationView`、Web API body/response 和前端按钮。
- pin 收藏不设上限，移除 FIFO 淘汰和 `pinLimit` 配置项。
- pin 查询（常用问题列表中的收藏层）从 `conversation_annotations` 读取，JOIN `messages` 取用户问题文本，按问题 hash 去重。
- 实现 `QuestionRecommendationGateway` 的 local adapter（读本地 `user_question_activity` 表高频统计）和 remote adapter（调 provider HTTP），按 deployment mode 注入。
- `frequent-question-service` 高频层改用 `QuestionRecommendationGateway.listFrequentHistoryQuestions`；联想层新增 provider 相似问题层（`recommendSimilarPresetQuestions`）+ 本地 pin/static 关键词匹配层。
- 联想 source 标签新增 `"recommended"`，废弃 `"high-frequency"` 在联想层的语义。
- REMOTE 模式下 `question-activity-tracking-command-port` 不工作（provider 自己统计高频）；`user_question_activity` 表保留但 remote 模式不读写。

**非目标：**

- 不改变 `conversation_annotations` 的 request-run 锚点、唯一约束、idempotency option 或 cleanup owner。
- 不改变回答收藏（`isFavorited`）的 100 上限行为（`add-favorite-count-limit` spec 不变）。
- 不改变 `SuggestedQuestionPort`（回答完成后模型生成推荐问题）的行为。
- 不实现向 provider 上报用户问题的接口（provider 自己统计高频数据）。
- 不改变静态目录（`CategoryQuestionCatalog`）的加载和 locale 过滤逻辑。
- 不定义问题收藏的跨 session 聚合、去重排序或推荐加权行为（pin 锚定 requestRunId，去重在 service 层按 hash 完成）。

## 变更范围（What Changes）

- **pin 迁移**：`conversation_annotations.isQuestionFavorited` 接通 runtime port 和 Web API。`POST /api/v1/user-questions/pin` 的 body 从 `{ question }` 改为 `{ sessionId, runId }`（因为 annotation 锚定 requestRunId）。前端 TurnBlock 的 pin 按钮改为调用 annotation upsert API。
- **pin 查询**：`ConversationAnnotationStoreGateway` 新增 `listQuestionFavoriteTurns` 方法，查询 `question_favorite=1` 的标注行并 JOIN `messages` 取用户问题文本。`RuntimeConversationAnnotationPort` 新增对应查询方法。
- **pin 上限**：移除 `user_question_activity` 的 `pinQuestion` FIFO 淘汰逻辑和 `pinLimit` 配置。pin 不设上限。
- **gateway adapter**：`QuestionRecommendationGateway` local adapter 读本地 `user_question_activity.listHighFrequency`；remote adapter 调 provider 两个 HTTP 接口，复用 frozen design 的 wire mapping 和 SafeError 映射。
- **service 重构**：`frequent-question-service` 的 `listFrequentQuestions` 高频层改调 `QuestionRecommendationGateway.listFrequentHistoryQuestions`；`listQuestionAssociations` 新增 `recommended` 层（调 `recommendSimilarPresetQuestions`），保留 `pinned` 和 `static` 层。
- **source 标签**：`QuestionAssociationSource` 从 `"pinned" | "high-frequency" | "static"` 改为 `"pinned" | "recommended" | "static"`。
- **tracking port**：`question-activity-tracking-command-port` 只在 LOCAL 模式注入；REMOTE 模式不包装。
- **废弃清理**：`UserQuestionActivityStoreGateway.pinQuestion` 和 `listPinned` 方法废弃；`user_question_activity` 表的 `is_pinned` 和 `pinned_at` 列在 SQLite schema 中保留（不 DROP，避免迁移风险），但代码不再读写。

## Capability 影响（Capabilities）

### 新增 Capability

（无）

### 修改的 Capability

- `conversation-annotation`：接通 `isQuestionFavorited` 到 runtime view、Web API 和前端；新增问题收藏查询方法。
- `question-recommendation`：实现 `QuestionRecommendationGateway` local/remote adapter；service 消费 gateway。
- `user-question-activity`：废弃 pin 相关方法和列；保留高频统计供 local adapter。
- `frequent-question-api`：高频层和 pin 层数据源变更；移除 `pinLimit` 配置。
- `question-association-api`：source 标签变更；新增 `recommended` 层。

## 影响范围（Impact）

- `packages/agent-contracts`：runtime `ConversationAnnotationView`、`RuntimeUpsertAnnotationCommand`、`RuntimeConversationAnnotationPort`、`ConversationAnnotationStoreGateway`、`QuestionAssociationSource`、`FrequentQuestionPort` 变更。
- `packages/agent-session`：`conversation-annotation-service`、`frequent-question-service`、`question-activity-tracking-command-port` 变更。
- `packages/agent-platform-gateway-local`：SQLite annotation store 新增查询方法；local `QuestionRecommendationGateway` adapter 新增；pin 相关 store 方法废弃。
- `packages/agent-platform-gateway-remote`：remote `QuestionRecommendationGateway` adapter 新增。
- `packages/agent-app`：composition 注入 local/remote adapter；tracking port 按模式条件注入。
- `packages/agent-channel-web`：pin API shape 变更；annotation DTO 增加 `isQuestionFavorited`；联想响应 source 标签变更。
- `frontend/agent-web`：TurnBlock pin 按钮改调 annotation API；高频面板和联想消费新数据源。

## 归档前更新基线（Baseline Promotion Plan）

- `openspec/specs/conversation-annotation/spec.md`：合并 `isQuestionFavorited` 接通和问题收藏查询行为。
- `openspec/specs/question-recommendation/spec.md`：合并 local/remote adapter 实现和 service 消费行为。
- `openspec/specs/user-question-activity/spec.md`：移除 pin 相关 requirement，保留高频统计。
- `openspec/specs/frequent-question-api/spec.md`：更新高频层和 pin 层数据源，移除 `pinLimit`。
- `openspec/specs/question-association-api/spec.md`：更新 source 标签和分层逻辑。
- `openspec/designs/modules/agent-contracts.md`：更新 runtime port 和 gateway contract。
- `openspec/designs/modules/agent-platform-gateway-local.md`：更新 local adapter 和 annotation store。
- `openspec/designs/modules/agent-platform-gateway-remote.md`：补充 remote adapter。
