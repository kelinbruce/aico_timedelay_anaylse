## 背景与问题（Why）

用户在与电信网络智能体的多轮对话中，经常需要将某个会话中的部分问答对分享给同事或合作伙伴，以便协同诊断网络故障、传递排查思路或归档有价值的对话结果。当前系统已有对话标注（点赞/点踩/收藏）能力，但无法将对话内容以受控只读的方式分享给其他用户。

具体问题：
- 用户无法将某个会话中选定的问答对生成可分享链接。当前每个会话的数据按三元 owner scope `(tenantId, subjectId, agentId)` 严格隔离，跨用户查看对话内容没有任何受控路径。
- 多机部署场景下，分享链接必须携带原始服务地址，否则被分享者在不同环境下打开链接无法定位到正确的后端实例。
- Remote 模式下用户拥有 `ops`（操作权限数组），分享者需要指定被分享者必须具备的权限门槛；Local 模式下只有单一配置用户，不存在权限维度。当前系统没有能力表达"带权限门槛的跨用户只读访问"。
- 分享内容可能因会话/消息被删除而失效，或因超过有效期而过期。当前系统没有机制向查看者返回明确的过期/权限不足/内容已删除状态，无法做异常防护。

## 变更范围（What Changes）

- 新增 `ConversationShareStoreGateway` persistence port 和 `ConversationShareRecord` persistence DTO。每条分享记录锚定一个 `shareId`（高熵随机主键），归属创建者三元 scope `(tenantId, subjectId, agentId)`。记录包含 `sessionId`、`runIds`（JSON 数组，创建时冻结的问答对快照）、`originUrl`（创建时前端传入的服务地址）、`allowedOps`（JSON string 数组或 null，null 表示公开分享）、`expiresAt`（EpochMillis 或 null，null 表示永久）、`createdAt`。`ConversationShareRecord` MUST `extends OwnerScoped` 并包含 `agentId: AgentId`；不得包含 `idempotencyKey`，幂等控制通过 `IdempotentWriteOptions` 传递。
- 新增 `conversation_shares` SQLite 专用业务表，按 `(tenant_id, subject_id, agent_id, share_id)` 建立主键。禁止用 generic `records(store,key,json)` 承载分享事实。
- 新增 `RuntimeConversationSharePort` application port，定义 `createShare`（创建分享）和 `loadSharedConversation`（加载分享问答对）两个操作。由 `agent-session` 实现，注入 `agent-channel-web` 作为可选依赖。
- 新增两条 Web REST API 路由：`POST /api/v1/sessions/:sessionId/shares`（创建分享）和 `GET /api/v1/shares/:shareId/conversation`（查看分享问答对）。创建路由的 owner scope 来自 `IdentityResolver` 解析的可信 identity context，agent scope 来自可信 app composition；路由 MUST NOT 从请求体接受 `tenantId`、`subjectId` 或 `agentId`。查看路由通过不可猜测的 `shareId` 凭证访问，不依赖查看者的 owner scope 做数据隔离——这是 owner scope 隔离原则的受控例外。
- **owner scope 受控例外（跨 scope 只读读取）**：查看分享时，系统用 `ConversationShareRecord` 中冻结的创建者三元 scope 和 `agentId` 去查询 messages，而非查看者的 scope。触发此跨 scope 读取的唯一凭证是不可猜测的 `shareId`，读取范围严格锁定在 `runIds` 快照。此例外只存在于"查看分享"只读路径，不传染其他主路径。
- **权限模型（ops 白名单）**：创建分享时，remote 模式下分享者可勾选"保持同样权限"，将自身 `HostSiteContext.user.ops` 数组作为 `allowedOps` 存入分享记录；不勾选则 `allowedOps=null`（公开）。查看分享时，被分享者在 remote 模式下携带自身 `ops` 数组，后端校验 `allowedOps ⊆ viewerOps`（子集校验）。Local 模式下不存在 ops，`allowedOps` 始终为 null，自然放行。`allowedOps=null` 时后端不校验权限，任何人凭链接可查看。
- **有效期模型**：`expiresAt` 为 null 表示永久；非 null 时，查看时若当前时间超过 `expiresAt` 则返回 `SHARE_EXPIRED`。前端创建弹窗提供 24 小时、7 天、一个月、永久四个选项。
- **异常防护**：查看分享时依次校验过期（`SHARE_EXPIRED`）、权限（`SHARE_FORBIDDEN`）、内容存在性（`SHARE_CONTENT_DELETED`）、分享记录存在性（`SHARE_NOT_FOUND`），返回明确的 `SafeError`，前端展示对应的全屏异常提示界面。
- **只读展示约束**：分享查看页面只做问答对的纯只读展示。MUST NOT 展示原用户的标注（点赞/点踩/收藏）组件，MUST NOT 提供任何写操作（提交、retry、edit、cancel、标注）。复制操作保留（纯客户端行为，不涉及后端写入）。查看页面 MUST NOT 连接 stream，不展示 composer、sidebar。
- 前端（agent-web）新增：TurnBlock 操作行新增分享按钮；点击后进入勾选模式（每个问答对左侧出现复选框，当前问答对默认勾选，可继续勾选其他问答对）；底部全宽分享按钮触发分享设置弹窗（有效期选项始终展示，权限选项仅 remote 模式展示）；点击生成后调 `POST` 接口，成功后返回完整分享 URL。新增 `/#/shared/:shareId` 哈希路由的只读展示页面，复用 `conversationMessagesToHistoryEnvelopes` + `buildHistoricalTurnBlocks` 纯函数链路渲染问答对，通过 `turnActionsDisabled` 和 `showAnnotations=false` 禁用所有写操作和评价组件。
- 声明 session 同生命周期契约义务：当未来引入 session 删除/老化机制时，MUST 级联清理该 session 的分享记录。本 change 不实现 session 删除。

## Capability 影响（Capabilities）

### 新增 Capability
- `conversation-share`: 定义对话分享的 gateway 持久化契约、runtime application port、Web REST API 契约、owner scope 受控例外（跨 scope 只读读取）、ops 权限白名单校验、有效期校验、异常防护、只读展示约束，以及 session 同生命周期的契约义务声明。

### 修改的 Capability
（无）

## 影响范围（Impact）

- `agent-contracts/gateway`：新增 `ConversationShareRecord`、`ConversationShareStoreGateway` 及配套 DTO（`CreateShareRecord`、`LoadShareConversationRequest`、`SharedConversationResult` 等）。
- `agent-contracts/runtime`：新增 `RuntimeConversationSharePort` 及配套 Command/Query/Result DTO。
- `agent-platform-gateway-local`：新增 `conversation_shares` SQLite 表、row mapping、gateway 实现，由 `SqliteGatewayStores` 统一管理。
- `agent-session`：实现 `RuntimeConversationSharePort`，注入 `ConversationShareStoreGateway` 和 `SessionMessageStoreGateway`（用于跨 scope 只读查询 messages）。
- `agent-channel-web`：新增两条 REST 路由、DTO schema、projection 函数；`WebChannelDependencies` 新增可选 `shares` 依赖，未注入时路由返回 503。
- `agent-app`：composition root 注入 share port 和 gateway。
- `agent-web`（前端，独立 workspace）：新增分享按钮、勾选模式、分享设置弹窗、`/#/shared/:shareId` 只读展示页面、`shareService`。
- 测试：gateway-local unit test（分享记录 CRUD、scope 隔离）、web route integration test（创建/查看路由正向/负向/权限/过期/内容删除）、agent-session port test（createShare/loadSharedConversation 行为和 scope 传递）、agent-web 前端 test（勾选模式、弹窗、只读展示页、异常状态）。
- 无运行时 breaking change。`WebChannelDependencies.shares` 为可选依赖，未注入时分享路由返回 503。

## 归档前更新基线（Baseline Promotion Plan）

**行为契约：**
- `openspec/specs/conversation-share/spec.md`：新增，承载分享 gateway/runtime/web/前端行为契约、owner scope 受控例外、ops 权限校验、有效期校验、异常防护和只读展示约束。

**长期背景：**
- `openspec/overview.md`：新增对话分享能力对用户协同诊断和对话传递体验的支撑说明。

**设计视图：**
- `openspec/designs/architecture/core-contracts.md`：修改，补充 `ConversationShareStoreGateway` port 和 owner scope 受控例外说明。
- `openspec/designs/architecture/owner-scope-isolation.md`：修改，补充"查看分享"作为 owner scope 隔离的受控例外，凭证为不可猜测的 shareId，读取范围锁定在 runIds 快照。
- `openspec/designs/modules/agent-contracts.md`：修改，补充分享 gateway 和 runtime port contract 归属。
- `openspec/designs/modules/agent-channel-web.md`：修改，补充分享路由 projection 职责。
- `openspec/designs/modules/agent-session.md`：修改，补充 `RuntimeConversationSharePort` 实现职责。
- `openspec/designs/modules/agent-platform-gateway-local.md`：修改，补充 `conversation_shares` 表和 gateway 实现职责。
- `openspec/designs/spec-to-design-map.md`：修改，新增 `conversation-share` spec 到 design 导航。

**验证入口：**
- `agent-platform-gateway-local` unit test：分享记录创建、scope 隔离、loadShare 按 shareId 读取、runIds 快照完整性。
- `agent-channel-web` route integration test：创建/查看路由的正向/负向/scope 校验/权限校验/过期校验/内容删除校验。
- `agent-session` port test：createShare 返回完整 URL、loadSharedConversation 跨 scope 读取、异常状态返回。
- `agent-web` 前端 test：勾选模式 toggle、分享弹窗 local/remote 权限选项差异、只读展示页渲染、异常状态全屏提示。
