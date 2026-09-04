## ADDED Requirements

### Requirement: Conversation share persistence and scope isolation

系统 SHALL 通过专用 `ConversationShareStoreGateway` persistence port 持久化对话分享事实。每条分享记录锚定一个 `shareId`（高熵随机主键，长度不少于 16 字节的 URL-safe 编码），归属创建者三元 scope `(tenantId, subjectId, agentId)`。`tenantId` 和 `subjectId` 来自可信 channel/auth boundary 的 `IdentityContext`，`agentId` 来自可信 app composition 或已持久化 session/run binding。请求体、模型输出、capability 参数或客户端 metadata 不得覆盖分享记录的 owner scope 或 agent scope。

`ConversationShareRecord` 是 gateway-owned persistence DTO，MUST `extends OwnerScoped` 并包含 `agentId: AgentId`。记录包含：`shareId`（主键）、`sessionId`（被分享的会话）、`runIds`（JSON 数组，创建时冻结的问答对 run ID 快照，至少包含 1 个 run）、`originUrl`（创建时前端传入的服务基地址，用于拼接分享链接）、`allowedOps`（JSON string 数组或 null，null 表示公开分享）、`expiresAt`（EpochMillis 或 null，null 表示永久有效）、`createdAt`（创建时间）。`ConversationShareRecord` MUST NOT 包含 `idempotencyKey`；幂等控制信息 MUST 通过 `IdempotentWriteOptions` 传递。

分享事实 MUST 存储在专用业务表 `conversation_shares` 中，禁止用 generic `records(store,key,json)` 承载。表 MUST 按 `(tenant_id, subject_id, agent_id, share_id)` 建立主键。

`shareId` MUST 由后端生成，使用密码学安全随机数，确保不可预测。`shareId` 是查看分享的唯一凭证。

#### Scenario: Create share record with frozen runIds
- **WHEN** 用户 `(T1, U1, A1)` 在 session `S1` 上对 runs `[R1, R2]` 创建分享
- **THEN** 系统 MUST 存储一条 `ConversationShareRecord`，`shareId` 为后端生成的高熵随机值
- **AND** `runIds` 为 `[R1, R2]` 的冻结快照，后续 session 内容变更不影响此快照
- **AND** `tenantId=T1`，`subjectId=U1`，`agentId=A1`

#### Scenario: Triple scope isolation on share records
- **WHEN** 用户 `(T1, U1, A1)` 创建了分享 `SH1`
- **AND** 用户 `(T1, U2, A1)` 或 `(T2, U1, A1)` 或 `(T1, U1, A2)` 尝试通过创建者 scope 查询分享列表
- **THEN** `SH1` 不可见于其他 scope
- **AND** 查询结果为空，不泄露跨 scope 分享是否存在

#### Scenario: Client-supplied scope is ignored
- **WHEN** 创建分享的请求体携带 `tenantId`、`subjectId` 或 `agentId` 字段
- **THEN** 系统 MUST 忽略这些字段
- **AND** 只使用 trusted identity context 和 trusted agent scope

#### Scenario: Load share by shareId bypasses viewer scope
- **WHEN** 任意用户（无论 scope）使用有效 `shareId` 调用 `loadSharedConversation`
- **THEN** 系统 MUST 能定位到该分享记录，不依赖查看者的 owner scope 做主键查找
- **AND** 使用分享记录中冻结的创建者 scope 和 agentId 去查询 messages

### Requirement: Share creation Web API contract

系统 SHALL 通过 `agent-channel-web` 暴露 `POST /api/v1/sessions/:sessionId/shares` 路由用于创建分享。路由的 owner scope MUST 来自 `IdentityResolver` 解析的可信 identity context，agent scope MUST 来自可信 app composition 或已持久化 session 的 `agentId`；路由 MUST NOT 从请求体或路径参数中接受 `tenantId`、`subjectId` 或 `agentId`。

请求体包含：`runIds`（string 数组，至少 1 个元素，对应要分享的问答对 run ID）、`originUrl`（string，创建者当前服务的基地址，如 `https://10.0.0.1:3000`）、`expiresIn`（枚举值 `"24h"` | `"7d"` | `"30d"` | `"permanent"`，对应 24 小时、7 天、30 天、永久）、`allowedOps`（string 数组或 null，null 表示公开分享）。

成功返回 `200` 和分享结果 DTO，包含 `shareUrl`（完整分享链接，格式为 `{originUrl}/#/shared/{shareId}`）和 `shareId`。

当 `WebChannelDependencies.shares` 未注入时，路由 MUST 返回 `503` 和 `SafeError { code: "SHARES_UNAVAILABLE" }`，不得静默返回空结果或伪装成功。

请求体和响应体 MUST 经过 runtime schema validation。`runIds` 为空数组时返回 `400`。`originUrl` 不是合法 URL 时返回 `400`。

#### Scenario: Create share via API
- **WHEN** 客户端 `POST /api/v1/sessions/S1/shares` 且请求体 `{ "runIds": ["R1","R2"], "originUrl": "https://10.0.0.1:3000", "expiresIn": "7d", "allowedOps": null }`
- **AND** identity resolver 返回 `(T1, U1)`，agent scope 为 `A1`
- **THEN** 返回 `200`，body 包含 `shareId` 和 `shareUrl`
- **AND** `shareUrl` 格式为 `https://10.0.0.1:3000/#/shared/{shareId}`
- **AND** 后端存储的 `expiresAt` 为当前时间加 7 天

#### Scenario: Create share with ops whitelist
- **WHEN** remote 模式下用户创建分享，请求体 `{ "runIds": ["R1"], "originUrl": "https://host:3000", "expiresIn": "permanent", "allowedOps": ["net:read","diag:run"] }`
- **THEN** 返回 `200`，后端存储 `allowedOps=["net:read","diag:run"]`，`expiresAt=null`

#### Scenario: Empty runIds returns 400
- **WHEN** 客户端 `POST /api/v1/sessions/S1/shares` 且请求体 `{ "runIds": [], "originUrl": "https://host:3000", "expiresIn": "7d" }`
- **THEN** 返回 `400`

#### Scenario: Shares unavailable returns 503
- **WHEN** `WebChannelDependencies.shares` 未注入
- **AND** 客户端请求创建分享路由
- **THEN** 返回 `503`，body 为 `{ error: { code: "SHARES_UNAVAILABLE" } }`

### Requirement: Shared conversation view Web API contract

系统 SHALL 通过 `agent-channel-web` 暴露 `GET /api/v1/shares/:shareId/conversation` 路由用于查看分享的问答对内容。此路由通过不可猜测的 `shareId` 凭证访问，不依赖查看者的 owner scope 做数据隔离。

查看者（remote 模式）MUST 通过 HTTP header `X-Viewer-Ops` 传递自身 `ops` 数组（JSON 编码的 string 数组）。Local 模式下查看者不携带此 header，后端视为无 ops。

后端处理流程 MUST 按以下顺序校验：
1. 按 `shareId` 查找分享记录。不存在 → 返回 `404` 和 `SafeError { code: "SHARE_NOT_FOUND" }`。
2. 校验有效期：`expiresAt != null` 且当前时间超过 `expiresAt` → 返回 `410` 和 `SafeError { code: "SHARE_EXPIRED" }`。
3. 校验权限：`allowedOps != null` 时，校验 `allowedOps` 是否为查看者 ops 的子集（`allowedOps ⊆ viewerOps`）。`viewerOps` 为 null 或空数组时，只有 `allowedOps` 也为 null 才通过。校验失败 → 返回 `403` 和 `SafeError { code: "SHARE_FORBIDDEN" }`。
4. 校验内容存在性：用分享记录中冻结的创建者三元 scope 和 agentId 查询 `runIds` 对应的 messages。若 session 或任一 run 的 messages 不存在 → 返回 `404` 和 `SafeError { code: "SHARE_CONTENT_DELETED" }`。
5. 全部通过 → 返回 `200` 和问答对内容（经 projection 的只读 DTO）。

返回的问答对内容 MUST 只包含 `runIds` 快照中对应 run 的 messages，MUST NOT 返回 session 中的其他 run。返回的 messages MUST 按 `createdAt` 升序排列。返回的 DTO MUST NOT 包含任何标注（annotation）状态。

当 `WebChannelDependencies.shares` 未注入时，路由 MUST 返回 `503` 和 `SafeError { code: "SHARES_UNAVAILABLE" }`。

#### Scenario: View public share without ops
- **WHEN** 分享 `SH1` 的 `allowedOps=null`，`expiresAt=null`
- **AND** 查看者不携带 `X-Viewer-Ops` header
- **THEN** 返回 `200`，body 包含 `runIds` 对应的问答对 messages
- **AND** messages 按 `createdAt` 升序排列
- **AND** body 不包含任何 annotation 状态

#### Scenario: View share with matching ops
- **WHEN** 分享 `SH1` 的 `allowedOps=["net:read","diag:run"]`
- **AND** 查看者携带 `X-Viewer-Ops: ["net:read","diag:run","admin"]`
- **THEN** 返回 `200`，body 包含问答对内容

#### Scenario: View share with insufficient ops
- **WHEN** 分享 `SH1` 的 `allowedOps=["net:read","diag:run"]`
- **AND** 查看者携带 `X-Viewer-Ops: ["net:read"]`
- **THEN** 返回 `403`，body 为 `{ error: { code: "SHARE_FORBIDDEN" } }`

#### Scenario: View expired share
- **WHEN** 分享 `SH1` 的 `expiresAt` 为过去时间
- **AND** 查看者请求 `GET /api/v1/shares/SH1/conversation`
- **THEN** 返回 `410`，body 为 `{ error: { code: "SHARE_EXPIRED" } }`

#### Scenario: View share with deleted content
- **WHEN** 分享 `SH1` 的 `runIds` 包含 `R1`
- **AND** run `R1` 对应的 messages 已被删除
- **THEN** 返回 `404`，body 为 `{ error: { code: "SHARE_CONTENT_DELETED" } }`

#### Scenario: View non-existent share
- **WHEN** 查看者请求 `GET /api/v1/shares/nonexistent/conversation`
- **THEN** 返回 `404`，body 为 `{ error: { code: "SHARE_NOT_FOUND" } }`

#### Scenario: Public share with null viewer ops passes
- **WHEN** 分享 `SH1` 的 `allowedOps=null`
- **AND** 查看者携带 `X-Viewer-Ops: []`（空数组）
- **THEN** 返回 `200`，`allowedOps=null` 时不校验 ops

### Requirement: Owner scope controlled exception for share viewing

查看分享路径是 owner scope 隔离原则的受控例外。系统 MUST 用 `ConversationShareRecord` 中冻结的创建者三元 scope `(tenantId, subjectId, agentId)` 和 `agentId` 去查询 messages，而非查看者的 scope。

触发此跨 scope 读取的唯一凭证是不可猜测的 `shareId`。读取范围 MUST 严格锁定在 `runIds` 快照中的 run，MUST NOT 扩散到 session 的其他 run 或其他 session。此例外只存在于"查看分享"只读路径，MUST NOT 传染其他主路径的数据访问逻辑。

此受控例外的安全保证基于：`shareId` 的不可预测性（密码学安全随机生成）、读取范围的严格锁定（只读 `runIds` 快照）、以及只读语义（不产生任何写操作）。

#### Scenario: Cross-scope read uses frozen creator scope
- **WHEN** 创建者 `(T1, U1, A1)` 创建了分享 `SH1`，`runIds=[R1]`
- **AND** 查看者 `(T2, U2, A1)` 使用有效 `shareId` 查看分享
- **THEN** 系统 MUST 用 `(T1, U1, A1)` scope 查询 `R1` 的 messages
- **AND** MUST NOT 用查看者 `(T2, U2, A1)` scope 查询

#### Scenario: Share read scope locked to runIds snapshot
- **WHEN** 分享 `SH1` 的 `runIds=[R1, R2]`
- **AND** session `S1` 中还有 `R3, R4` 等其他 run
- **THEN** 查看分享 MUST 只返回 `R1, R2` 的 messages
- **AND** MUST NOT 返回 `R3, R4` 的任何内容

### Requirement: ops permission whitelist semantics

`allowedOps` 字段定义分享的权限门槛。`allowedOps=null` 表示公开分享，任何人凭 `shareId` 可查看，后端 MUST NOT 校验 ops。`allowedOps` 为非 null 的 string 数组时，查看者 MUST 通过 `X-Viewer-Ops` header 提供自身 ops，后端 SHALL 校验 `allowedOps ⊆ viewerOps`（子集校验：查看者的 ops MUST 包含分享者设定的全部 ops）。

Local 模式下不存在 `HostSiteContext.user.ops`，前端 MUST NOT 展示权限配置选项，`allowedOps` MUST 始终传 null。Remote 模式下前端 SHALL 从 `HostSiteContext.user.ops` 获取分享者 ops，勾选"保持同样权限"时将完整 ops 数组作为 `allowedOps` 传入。

#### Scenario: Local mode always creates public share
- **WHEN** local 模式下用户创建分享
- **THEN** 前端 MUST NOT 展示权限配置选项
- **AND** `allowedOps` 始终为 null
- **AND** 后端存储 `allowedOps=null`

#### Scenario: Remote mode ops subset check passes
- **WHEN** 分享 `allowedOps=["net:read"]`
- **AND** 查看者 ops 为 `["net:read","diag:run"]`
- **THEN** `["net:read"] ⊆ ["net:read","diag:run"]` 为 true
- **AND** 返回 `200`

#### Scenario: Remote mode ops subset check fails
- **WHEN** 分享 `allowedOps=["net:read","diag:run"]`
- **AND** 查看者 ops 为 `["net:read"]`
- **THEN** `["net:read","diag:run"] ⊆ ["net:read"]` 为 false
- **AND** 返回 `403`，`SHARE_FORBIDDEN`

### Requirement: Expiration validation

`expiresAt` 为 null 表示永久有效。`expiresAt` 为非 null 的 EpochMillis 时，查看分享 MUST 校验当前时间是否超过 `expiresAt`，超过则返回 `SHARE_EXPIRED`。

前端创建弹窗提供四个有效期选项，对应后端 `expiresIn` 枚举：`"24h"`（当前时间加 24 小时）、`"7d"`（当前时间加 7 天）、`"30d"`（当前时间加 30 天）、`"permanent"`（`expiresAt=null`）。

#### Scenario: Permanent share never expires
- **WHEN** 分享 `SH1` 的 `expiresAt=null`
- **AND** 任意时间后查看
- **THEN** MUST NOT 返回 `SHARE_EXPIRED`

#### Scenario: Time-limited share expires
- **WHEN** 分享 `SH1` 的 `expiresIn="7d"`，创建于 `2026-06-28T10:00:00Z`
- **AND** 在 `2026-07-05T10:00:01Z` 查看
- **THEN** 返回 `410`，`SHARE_EXPIRED`

#### Scenario: Time-limited share within validity
- **WHEN** 分享 `SH1` 的 `expiresIn="7d"`，创建于 `2026-06-28T10:00:00Z`
- **AND** 在 `2026-07-04T10:00:00Z` 查看
- **THEN** 返回 `200`

### Requirement: Read-only display constraint

分享查看页面 MUST 只做问答对的纯只读展示。MUST NOT 展示原用户的标注（点赞/点踩/收藏）组件。MUST NOT 提供任何写操作（提交新消息、retry、edit、cancel、标注 upsert）。复制操作 MAY 保留（纯客户端行为，不涉及后端写入）。

查看页面 MUST NOT 连接 stream（SSE/WebSocket），MUST NOT 展示 composer（输入框）、sidebar（侧边栏）。查看页面 MUST 复用 `conversationMessagesToHistoryEnvelopes` + `buildHistoricalTurnBlocks` 纯函数链路渲染问答对，通过 `turnActionsDisabled` 和 `showAnnotations=false` 禁用写操作和评价组件。

#### Scenario: Share view shows no annotation components
- **WHEN** 查看者打开分享链接 `/#/shared/SH1`
- **AND** 分享内容正常返回
- **THEN** 页面展示问答对内容
- **AND** 每个 TurnBlock 的操作行 MUST NOT 出现点赞、点踩、收藏图标
- **AND** MUST NOT 出现 retry、edit、cancel 按钮

#### Scenario: Share view retains copy button
- **WHEN** 查看者打开分享链接
- **THEN** 每个 TurnBlock 的操作行 MAY 保留复制按钮
- **AND** 复制操作为纯客户端行为，不产生后端请求

#### Scenario: Share view has no stream connection
- **WHEN** 查看者打开分享链接
- **THEN** 页面 MUST NOT 发起 SSE 或 WebSocket 连接
- **AND** MUST NOT 展示 composer 或 sidebar

### Requirement: Frontend share interaction behavior

前端（agent-web）SHALL 在每轮问答的助手回复操作行中展示分享按钮（与复制、点赞、点踩、收藏、重新生成位于同一行）。点击分享按钮后进入勾选模式：当前会话下所有问答对左侧出现复选框，点击分享按钮对应的问答对默认勾选，用户可继续勾选或取消其他问答对。会话面板底部出现全宽分享按钮（占满绘画面板宽度）。

点击底部分享按钮后弹出分享设置弹窗，包含：有效期选项（24 小时、7 天、一个月、永久，始终展示）、权限选项（"保持同样权限"勾选框，仅 remote 模式展示）。点击弹窗内的生成按钮后，前端调用 `POST /api/v1/sessions/:sessionId/shares`，传入勾选的 `runIds`、`originUrl`（取自 `window.location.origin`）、`expiresIn`、`allowedOps`（remote 模式勾选时为 `HostSiteContext.user.ops`，否则为 null）。成功后展示完整 `shareUrl` 供用户复制。

勾选模式 MUST 支持退出（取消按钮或 ESC），退出后恢复正常对话视图。

#### Scenario: Enter selection mode
- **WHEN** 用户点击某问答对操作行的分享按钮
- **THEN** 当前会话所有问答对左侧出现复选框
- **AND** 该问答对默认勾选
- **AND** 会话面板底部出现全宽分享按钮

#### Scenario: Toggle selection in selection mode
- **WHEN** 用户在勾选模式下点击另一个问答对的复选框
- **THEN** 该问答对被勾选
- **AND** 再次点击取消勾选

#### Scenario: Open share settings dialog
- **WHEN** 用户点击底部全宽分享按钮
- **THEN** 弹出分享设置弹窗
- **AND** 弹窗包含有效期选项（24h/7d/30d/永久）
- **AND** remote 模式下弹窗包含"保持同样权限"勾选框
- **AND** local 模式下弹窗不展示权限勾选框

#### Scenario: Generate share link
- **WHEN** 用户在弹窗中设置有效期和权限后点击生成
- **THEN** 前端调用 `POST /api/v1/sessions/:sessionId/shares`
- **AND** 请求体包含勾选的 `runIds`、`originUrl`、`expiresIn`、`allowedOps`
- **AND** 成功后展示完整 `shareUrl` 供复制

#### Scenario: Exit selection mode
- **WHEN** 用户在勾选模式下点击取消或按 ESC
- **THEN** 退出勾选模式，恢复正常对话视图
- **AND** 复选框消失

### Requirement: Shared conversation page routing

前端 SHALL 新增 `/#/shared/:shareId` 哈希路由，对应只读分享展示页面。此路由 MUST 在 auth 守卫之前被拦截，分享页面 MUST NOT 要求登录（公开分享）或走 local/immersive 的登录守卫流程。

分享页面加载时调用 `GET /api/v1/shares/:shareId/conversation`，remote 模式下通过 `X-Viewer-Ops` header 传递查看者 ops。根据响应状态展示：正常内容、分享已过期、没有查看权限、内容已删除、分享不存在。

#### Scenario: Open shared conversation page
- **WHEN** 用户打开 `https://host:3000/#/shared/SH1`
- **THEN** 页面加载并调用 `GET /api/v1/shares/SH1/conversation`
- **AND** remote 模式下请求携带 `X-Viewer-Ops` header
- **AND** local 模式下不携带 `X-Viewer-Ops` header

#### Scenario: Expired share shows expired screen
- **WHEN** API 返回 `410` 和 `SHARE_EXPIRED`
- **THEN** 页面展示"分享已过期"全屏提示

#### Scenario: Forbidden share shows forbidden screen
- **WHEN** API 返回 `403` 和 `SHARE_FORBIDDEN`
- **THEN** 页面展示"没有查看权限"全屏提示

#### Scenario: Deleted content shows deleted screen
- **WHEN** API 返回 `404` 和 `SHARE_CONTENT_DELETED`
- **THEN** 页面展示"内容已删除"全屏提示

#### Scenario: Non-existent share shows not found screen
- **WHEN** API 返回 `404` 和 `SHARE_NOT_FOUND`
- **THEN** 页面展示"分享不存在"全屏提示

### Requirement: Session lifecycle obligation for shares

当未来引入 session 删除或会话老化机制时，系统 MUST 级联清理被删除/老化 session 的分享记录。此清理 MUST 通过 `ConversationShareStoreGateway` public port 执行，MUST NOT 直接访问 `conversation_shares` 表。

本 change 不实现 session 删除或老化。本 change 只声明契约义务：分享记录与 session 同生命周期，session 不存在时查看分享 MUST 返回 `SHARE_CONTENT_DELETED`（通过校验 messages 存在性实现，不依赖主动清理）。

#### Scenario: Deleted session content returns content deleted
- **WHEN** 分享 `SH1` 的 `runIds=[R1]`
- **AND** session `S1` 或 run `R1` 的 messages 已被外部方式删除
- **THEN** 查看分享 MUST 返回 `SHARE_CONTENT_DELETED`
- **AND** 分享记录本身仍保留（用于审计）

#### Scenario: Future session deletion cascades share cleanup
- **WHEN** 未来 session 删除/老化机制删除 session `S1`
- **THEN** 该 session 的分享记录 MUST 被级联清理
- **AND** 清理 MUST 通过 `ConversationShareStoreGateway` public port 执行

### Requirement: Share architecture boundaries

分享功能 MUST 遵循 NextAgent 架构边界。`ConversationShareStoreGateway` 的 SQLite 实现 MUST 位于 `agent-platform-gateway-local`，由 `SqliteGatewayStores` 管理。`RuntimeConversationSharePort` 的实现 MUST 位于 `agent-session`，通过注入的 `ConversationShareStoreGateway` 和 `SessionMessageStoreGateway` 操作数据。`agent-channel-web` 只负责 transport 和 projection，通过注入的 `RuntimeConversationSharePort` 操作，不直接访问 gateway port。`agent-context-engine`、`agent-capability`、`agent-runtime` MUST NOT 导入分享 gateway port 或 runtime port。

`ConversationShareRecord` 只能作为 gateway port 的入参或返回值，不得作为 `agent-session` application service 的 public return 或进入 Web response。Web response 只能暴露 public DTO projection。

分享操作 MUST NOT 阻塞 request terminal commit、改变 canonical timeline、修改 active context 或影响 stream projection。分享操作 MUST NOT 触发 memory extraction 或 capability invocation。

#### Scenario: Gateway implementation location
- **WHEN** 实现 `ConversationShareStoreGateway`
- **THEN** 实现 MUST 位于 `agent-platform-gateway-local`，由 `SqliteGatewayStores` 管理

#### Scenario: Web channel does not access gateway directly
- **WHEN** `agent-channel-web` 处理分享路由
- **THEN** 它 MUST 通过 `RuntimeConversationSharePort` 操作
- **AND** MUST NOT 直接导入或调用 `ConversationShareStoreGateway`

#### Scenario: Share does not affect request lifecycle
- **WHEN** 用户创建分享
- **THEN** 当前 request 的 terminal commit、stream projection 和 active context MUST 不受影响

### Requirement: Share failure and safe error handling

系统 SHALL 对分享操作的所有失败路径返回显式 `SafeError`。分享 gateway port MUST NOT 将 raw SQLite 异常、SQL 语句或存储路径暴露到 port boundary 之外。日志、metric 和 audit 不得包含对话内容、message text、prompt、模型输出或高基数字段。

**失败与降级规则**：
- 存储不可用：gateway port 返回 `SafeError { code: "SHARE_STORAGE_UNAVAILABLE", category: UNAVAILABLE, retryable: true }`。
- scope 校验失败：返回 `SafeError { code: "SHARE_SCOPE_INVALID", category: VALIDATION }`。
- 无静默失败：每个失败路径 MUST 产生显式 `SafeError` 和 structured log。

#### Scenario: Storage unavailable returns safe error
- **WHEN** 分享 gateway 操作遇到 SQLite 连接错误
- **THEN** 返回 `SafeError { code: "SHARE_STORAGE_UNAVAILABLE" }`
- **AND** raw 异常详情只在内部日志记录，不暴露到 port boundary 外

#### Scenario: Audit excludes conversation content
- **WHEN** 分享创建产生 audit/log
- **THEN** 日志只包含 `shareId`、`sessionId`、`runIds`（不含内容）、`allowedOps` 长度、`expiresAt`、scope 标识和 `occurredAt`
- **AND** MUST NOT 包含对话内容、message text 或 prompt
