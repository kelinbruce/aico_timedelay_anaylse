## 背景与问题（Why）

用户在与电信网络智能体的多轮对话中，需要对特定问答轮次的回复做标注：点赞、点踩或收藏。当前系统没有这些能力——`FeedbackRecord` 和 `FeedbackStoreGateway` 虽然在 contract 中定义，但从未在 gateway-local 落地实现，且锚定 `messageId`/`requestRunId`、缺少 `agentId`、使用 1-5 星 rating，语义与实际需求不匹配。

具体问题：
- 用户无法对某轮问答的回复表达"好"或"不好"。现有 `FeedbackRecord` 的 1-5 星 rating 语义过重，用户需要的是轻量的点赞/点踩。
- 用户无法收藏有价值的问答轮次，侧边栏只有历史会话列表，没有按收藏维度检索的入口。
- 长期来看系统会引入会话老化机制自动清理低活跃会话。如果用户收藏了某轮对话，该轮所在整个会话不应被老化删除。但用户 retry/edit 后旧 run 的消息被隐藏，旧 run 上的标注如果残留会变成"隐形收藏"——用户看不到也无法取消，却一直阻止 session 被老化。

## 变更范围（What Changes）

- 新增 `ConversationAnnotationStoreGateway` persistence port 和 `ConversationAnnotationRecord` persistence DTO，替代未实现的 `FeedbackStoreGateway`/`FeedbackRecord`。`conversation_annotations` 单表中每个 `requestRunId` 对应一行记录，锚定 `requestRunId`，三元 scope `(tenantId, subjectId, agentId)` 隔离。`sentiment`（`"UP"` | `"DOWN"` | `null`）、`isFavorited`（boolean）和 `comment`（`string | null`，自由文本评论，本 change 仅保留字段不实现前端逻辑）是同一行上的独立字段——不使用 `type` 列区分多行。
- `sentiment` 三态互斥（`"UP"` / `"DOWN"` / `null`）：UP↔DOWN 切换是同行 `sentiment` 字段 UPDATE，无需删除和插入。`null` 表示中性（两个图标均灰色）。`isFavorited` 独立于 `sentiment`，可与之共存。当 `sentiment=null` 且 `isFavorited=false` 时，该行被物理删除（`comment` 同时被删，不参与全空行判定）。
- 新增 `conversation_annotations` SQLite 业务表。按 `(scope, session_id, request_run_id)` 建立唯一约束——一个 run 只有一行标注。
- 新增 `RuntimeConversationAnnotationPort` application port，定义 upsert/list-favorites/list-by-session 三个操作。取消标注通过 upsert `sentiment=null`/`isFavorited=false` 完成，无独立 delete 操作。由 `agent-session` 实现，注入 `agent-channel-web` 作为可选依赖。
- 新增三条 Web REST API 路由：upsert 标注（`POST`，含 sentiment 和 isFavorited 两个可选字段）、分页列出收藏会话、列出会话内标注。
- **retry/edit supersede 清理**：当 run 被标记为 `SUPERSEDED` 时，同事务删除该 run 的所有标注。这确保用户看不到的旧 run 不残留"隐形标注"，防老化语义自洽——只有用户能看到的收藏才保护 session。
- 前端（agent-web）：每轮问答回复的操作行（与复制、重新生成同行）中增加点赞、点踩、收藏三个图标，三态 toggle（灰色/高亮），鼠标悬浮时显示，排列于复制和重新生成之间；侧边栏新增收藏入口，分页展示收藏会话列表，单击还原整个会话。
- 声明会话老化豁免契约义务：当 session 下存在任意 `FAVORITE` 标注时，该 session 不应被未来会话老化机制删除。由于 supersede 清理保证已隐藏 run 的标注被删除，此条件等价于"用户可见的收藏保护 session"。
- **BREAKING**（contract 层，非实现层）：移除未实现的 `FeedbackRecord`、`FeedbackStoreGateway`、`Feedback`、`SubmitFeedbackRequest`、`ListFeedbackRequest` 及 `ListFeedbackRecordsRequest`，由 `ConversationAnnotationRecord`/`ConversationAnnotationStoreGateway` 及配套 DTO 替代。因原有 contract 从未落地实现，无运行时 breaking change。

## Capability 影响（Capabilities）

### 新增 Capability
- `conversation-annotation`: 定义对话标注（点赞/点踩/收藏）的 gateway 持久化契约、runtime application port、Web REST API 契约、supersede 清理行为、前端 UI 行为契约，以及会话老化豁免的契约义务声明。

### 修改的 Capability
- `ts-core-contracts`: gateway port 命名从 `FeedbackStoreGateway` 变更为 `ConversationAnnotationStoreGateway`，persistence DTO 从 `FeedbackRecord` 变更为 `ConversationAnnotationRecord`，`feedback` durable fact 变更为 `conversation annotation`。

## 影响范围（Impact）

- `agent-contracts/gateway`：移除 `FeedbackRecord`/`FeedbackStoreGateway`/`ListFeedbackRecordsRequest`，新增 `ConversationAnnotationRecord`/`ConversationAnnotationStoreGateway` 及配套 DTO。
- `agent-contracts/session`：移除 `Feedback`/`SubmitFeedbackRequest`/`ListFeedbackRequest`。
- `agent-contracts/runtime`：新增 `RuntimeConversationAnnotationPort` 及配套 Command/Query/Result DTO。
- `agent-platform-gateway-local`：新增 `conversation_annotations` SQLite 表、row mapping、gateway 实现。
- `agent-session`：实现 `RuntimeConversationAnnotationPort`，注入 `ConversationAnnotationStoreGateway`。
- `agent-runtime`：retry/edit supersede 流程中新增标注清理调用。
- `agent-channel-web`：新增三条 REST 路由、DTO schema、projection 函数；`WebChannelDependencies` 新增可选 `annotations` 依赖。
- `agent-app`：composition root 注入 annotation port 和 gateway。
- `agent-web`（前端，独立 workspace）：新增标注图标组件、收藏列表侧边栏视图。
- 测试：gateway-local unit test、web route integration test、agent-session port test、supersede cleanup test、agent-web 前端 test。
- 无运行时 breaking change——被替换的 `FeedbackStoreGateway` 从未实现。`WebChannelDependencies.annotations` 为可选依赖，未注入时标注路由返回 503。

## 归档前更新基线（Baseline Promotion Plan）

**行为契约：**
- `openspec/specs/conversation-annotation/spec.md`：新增，承载标注 gateway/runtime/web/前端行为契约、supersede 清理行为和会话老化豁免义务声明。
- `openspec/specs/ts-core-contracts/spec.md`：修改，`FeedbackStoreGateway` → `ConversationAnnotationStoreGateway`，`FeedbackRecord` → `ConversationAnnotationRecord`。

**长期背景：**
- `openspec/overview.md`：新增对话标注能力对用户对话管理体验的支撑说明。

**设计视图：**
- `openspec/designs/architecture/core-contracts.md`：修改，补充 `ConversationAnnotationStoreGateway` port 和三元 scope 要求。
- `openspec/designs/modules/agent-contracts.md`：修改，补充标注 gateway 和 runtime port contract 归属。
- `openspec/designs/modules/agent-channel-web.md`：修改，补充标注路由 projection 职责。
- `openspec/designs/modules/agent-session.md`：修改，补充 `RuntimeConversationAnnotationPort` 实现职责。
- `openspec/designs/modules/agent-runtime.md`：修改，补充 supersede 清理职责。
- `openspec/designs/spec-to-design-map.md`：修改，新增 `conversation-annotation` spec 到 design 导航。

**验证入口：**
- `agent-platform-gateway-local` unit test：标注 upsert、scope 隔离、幂等、互斥、全空行删除、分页。
- `agent-channel-web` route integration test：三条路由的正向/负向/scope 校验。
- `agent-session` port test：upsert/list 行为和 scope 传递。
- `agent-runtime` supersede cleanup test：retry/edit 后旧 run 标注被清理。
- `agent-web` 前端 test：三态 toggle、列表分页、单击还原会话。
