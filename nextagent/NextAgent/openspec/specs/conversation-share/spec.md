## Purpose

定义对话分享能力的稳定契约，包括分享记录持久化、owner scope 受控例外（跨用户只读查看）、创建/查看 Web API、ops 权限白名单、有效期校验、异常防护、只读展示约束和前端交互行为。
## Requirements
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

请求体包含：`runIds`（string 数组，至少 1 个元素，对应要分享的问答对 run ID）、`originUrl`（string，创建者当前服务的基地址，如 `https://10.0.0.1:3000`）、`expiresIn`（枚举值 `"24h"` | `"7d"` | `"30d"` | `"permanent"`，对应 24 小时、7 天、30 天、永久）、`allowedOps`（长度为 1 的 string 数组或 null，数组元素为创建者 ops 的 SHA-256 hash，null 表示公开分享）。前端 MUST 在调用本 API 前对完整 ops 数组执行 hash 变换（去重 + 字典序排序 + `JSON.stringify` + SHA-256 + hex 编码），将结果包装为长度 1 的数组 `[hash]` 传入。

成功返回 `200` 和分享结果 DTO，包含 `shareUrl`（完整分享链接，格式为 `{originUrl}/#/shared/{shareId}`）和 `shareId`。

当 `WebChannelDependencies.shares` 未注入时，路由 MUST 返回 `503` 和 `SafeError { code: "SHARES_UNAVAILABLE" }`，不得静默返回空结果或伪装成功。

请求体和响应体 MUST 经过 runtime schema validation。`runIds` 为空数组时返回 `400`。`originUrl` 不是合法 URL 时返回 `400`。

#### Scenario: Create share via API
- **WHEN** 客户端 `POST /api/v1/sessions/S1/shares` 且请求体 `{ "runIds": ["R1","R2"], "originUrl": "https://10.0.0.1:3000", "expiresIn": "7d", "allowedOps": null }`
- **AND** identity resolver 返回 `(T1, U1)`，agent scope 为 `A1`
- **THEN** 返回 `200`，body 包含 `shareId` 和 `shareUrl`
- **AND** `shareUrl` 格式为 `https://10.0.0.1:3000/#/shared/{shareId}`
- **AND** 后端存储的 `expiresAt` 为当前时间加 7 天

#### Scenario: Create share with ops hash
- **WHEN** remote 模式下用户创建分享，前端对用户 ops `["diag:run","net:read"]` 执行 hash 变换得到 `hashH`，请求体 `{ "runIds": ["R1"], "originUrl": "https://host:3000", "expiresIn": "permanent", "allowedOps": ["hashH"] }`
- **THEN** 返回 `200`，后端存储 `allowedOps=["hashH"]`（长度 1），`expiresAt=null`

#### Scenario: Empty runIds returns 400
- **WHEN** 客户端 `POST /api/v1/sessions/S1/shares` 且请求体 `{ "runIds": [], "originUrl": "https://host:3000", "expiresIn": "7d" }`
- **THEN** 返回 `400`

#### Scenario: Shares unavailable returns 503
- **WHEN** `WebChannelDependencies.shares` 未注入
- **AND** 客户端请求创建分享路由
- **THEN** 返回 `503`，body 为 `{ error: { code: "SHARES_UNAVAILABLE" } }`

### Requirement: ops permission whitelist semantics
`allowedOps` 字段定义分享的权限门槛。`allowedOps=null` 表示公开分享，任何人凭 `shareId` 可查看，后端 MUST NOT 校验 ops。`allowedOps` 为非 null 的长度 1 的 string 数组时，元素为创建者 ops 集合的 SHA-256 hash，查看者 MUST 通过 `X-Viewer-Ops` header 传递自身 ops 的 SHA-256 hash（同样为长度 1 的数组），后端 SHALL 校验两者 hash 是否相等（`storedHash === viewerHash`）。只有 ops 集合完全相同的用户才能通过校验。

前端 hash 变换规则 MUST 确定性且顺序无关：对 ops 数组执行去重（`new Set`）→ 默认字典序排序（`.sort()`）→ `JSON.stringify` → SHA-256 → lowercase hex 编码。打乱顺序或包含重复元素的相同 ops 集合 MUST 产生相同的 hash。前端 MUST 在 `shareService.ts` 中集中实现该变换，`ShareSettingsModal` 和 `SharedConversationPage` 不直接调用 hash 函数。

Local 模式下不存在 `HostSiteContext.user.ops`，前端 MUST NOT 展示权限配置选项，`allowedOps` MUST 始终传 null。Remote 模式下前端 SHALL 从 `HostSiteContext.user.ops` 获取分享者 ops，勾选"保持同样权限"时对完整 ops 数组执行 hash 变换后将 `[hash]` 作为 `allowedOps` 传入。

#### Scenario: Local mode always creates public share
- **WHEN** local 模式下用户创建分享
- **THEN** 前端 MUST NOT 展示权限配置选项
- **AND** `allowedOps` 始终为 null
- **AND** 后端存储 `allowedOps=null`

#### Scenario: Remote mode ops hash equality check passes
- **WHEN** 分享创建者 ops 为 `["diag:run","net:read"]`，hash 变换得到 `hashH`，存储 `allowedOps=["hashH"]`
- **AND** 查看者 ops 为 `["net:read","diag:run"]`（顺序不同但集合相同），hash 变换得到 `hashH`
- **THEN** `storedHash === viewerHash` 为 true
- **AND** 返回 `200`

#### Scenario: Remote mode ops hash equality check fails
- **WHEN** 分享创建者 ops 为 `["diag:run","net:read"]`，hash 变换得到 `hashH1`，存储 `allowedOps=["hashH1"]`
- **AND** 查看者 ops 为 `["net:read"]`（集合不同），hash 变换得到 `hashH2`
- **THEN** `hashH1 === hashH2` 为 false
- **AND** 返回 `403`，`SHARE_FORBIDDEN`

#### Scenario: ops hash is order-independent
- **WHEN** ops 数组 `["b","a","c"]` 和 ops 数组 `["c","a","b"]` 分别执行 hash 变换
- **THEN** 两者 MUST 产生相同的 hash 值

#### Scenario: ops hash is deduplication-stable
- **WHEN** ops 数组 `["a","b","a"]` 和 ops 数组 `["a","b"]` 分别执行 hash 变换
- **THEN** 两者 MUST 产生相同的 hash 值

#### Scenario: Remote mode viewer ops null is rejected
- **WHEN** 分享 `allowedOps=["hashH"]`（非 null）
- **AND** 查看者不携带 `X-Viewer-Ops` header（viewerOps 为 null）
- **THEN** 返回 `403`，`SHARE_FORBIDDEN`

#### Scenario: Remote mode viewer ops empty is rejected
- **WHEN** 分享 `allowedOps=["hashH"]`（非 null）
- **AND** 查看者携带 `X-Viewer-Ops: []`（空数组）
- **THEN** 返回 `403`，`SHARE_FORBIDDEN`

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

前端（agent-web）SHALL 在每轮问答的助手回复操作行中展示分享按钮（与复制、点赞、点踩、收藏、重新生成位于同一行）。点击分享按钮后进入分享勾选模式：当前会话下所有问答对左侧出现复选框，点击分享按钮对应的问答对默认勾选，用户可继续勾选或取消其他问答对。会话面板底部出现全宽分享按钮（占满绘画面板宽度）。

点击底部分享按钮后弹出分享设置弹窗，包含：有效期选项（24 小时、7 天、一个月、永久，始终展示）、权限选项（"保持同样权限"勾选框，仅 remote 模式展示）。点击弹窗内的生成按钮后，前端调用 `POST /api/v1/sessions/:sessionId/shares`，传入勾选的 `runIds`、`originUrl`（取自 `window.location.origin`）、`expiresIn`、`allowedOps`（remote 模式勾选时为 `HostSiteContext.user.ops`，否则为 null）。成功后展示完整 `shareUrl` 供用户复制。

勾选模式 MUST 支持退出（取消按钮或 ESC），退出后恢复正常对话视图。

分享勾选模式与报告勾选模式互斥：同一时间只能处于其中一种模式。进入报告勾选模式时，分享勾选模式 MUST 自动退出并清空分享已选集合；进入分享勾选模式时，报告勾选模式 MUST 自动退出并清空报告已选集合。

分享勾选选中数量 MUST NOT 超过 `100`。该上限与分享创建 Web API 的 `runIds` `maxItems`（`WEB_SHARE_RUN_IDS_MAX_ITEMS`）和 `RequestRunStoreGateway.listRuns` 单页 `limit` 上限同值。逐项勾选时，当前已选数量已达到 `100` 后，前端 MUST 拒绝继续新增选中并给出提示。全选时，可选项数量超过 `100` 的，前端 MUST 截断为前 `100` 个可选项并给出提示；可选项数量不超过 `100` 的，全选行为不变。取消勾选不受上限影响。前端 MUST 在勾选阶段即强制该上限，MUST NOT 依赖后端 schema 校验兜底，MUST NOT 允许用户勾选超过 `100` 项后再提交。前端限制常量 MUST 由 `agent-web` 边界独立持有，不跨包 import 后端常量。

#### Scenario: Enter selection mode

- **WHEN** 用户点击某问答对操作行的分享按钮
- **THEN** 当前会话所有问答对左侧出现复选框
- **AND** 该问答对默认勾选
- **AND** 会话面板底部出现全宽分享按钮

#### Scenario: Toggle selection in selection mode

- **WHEN** 用户在勾选模式下点击另一个问答对的复选框
- **THEN** 该问答对被勾选
- **AND** 再次点击取消勾选

#### Scenario: Selection rejects additions beyond max items

- **GIVEN** 分享勾选模式已选中 `100` 个问答对
- **WHEN** 用户点击第 `101` 个未勾选问答对的复选框
- **THEN** 前端 MUST 拒绝勾选该问答对
- **AND** 已选集合 MUST 保持 `100` 项不变
- **AND** 前端 MUST 给出已达上限的提示
- **AND** 取消勾选已选项仍有效

#### Scenario: Select all truncates to max items

- **GIVEN** 当前会话有 `120` 个可分享问答对
- **WHEN** 用户点击全选
- **THEN** 前端 MUST 选中前 `100` 个可选项
- **AND** 已选集合大小 MUST 为 `100`
- **AND** 前端 MUST 给出已截断至 `100` 的提示

#### Scenario: Select all within limit selects all

- **GIVEN** 当前会话有 `50` 个可分享问答对
- **WHEN** 用户点击全选
- **THEN** 前端 MUST 选中全部 `50` 个可选项
- **AND** MUST NOT 截断
- **AND** MUST NOT 显示截断提示

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

#### Scenario: Entering report selection mode exits share selection mode

- **GIVEN** 当前处于分享勾选模式且已勾选若干问答对
- **WHEN** 用户通过右键"生成报告"进入报告勾选模式
- **THEN** 分享勾选模式 MUST 自动退出
- **AND** 分享已选集合 MUST 被清空
- **AND** 报告勾选模式 MUST 激活

#### Scenario: Entering share selection mode exits report selection mode

- **GIVEN** 当前处于报告勾选模式且已勾选若干问答对
- **WHEN** 用户点击分享按钮进入分享勾选模式
- **THEN** 报告勾选模式 MUST 自动退出
- **AND** 报告已选集合 MUST 被清空
- **AND** 分享勾选模式 MUST 激活

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

当 session 删除机制删除 session 时，系统 MUST 级联清理被删除 session 的分享记录。此清理 MUST 通过分享 gateway public port 或会话删除 composite gateway boundary 执行，MUST NOT 由 Web channel 直接访问 `conversation_shares` 表。

分享记录与 session 同生命周期。session 删除成功后，使用该 session 既有 `shareId` 查看分享 MUST 返回 `SHARE_NOT_FOUND` 或 `SHARE_CONTENT_DELETED` 的 safe not-found/deleted outcome，MUST NOT 返回删除前的 messages。清理 MUST 保持创建者 owner scope 和 Agent scope 隔离。若分享清理失败，会话删除 MUST 失败并回滚。

#### Scenario: Deleted session cascades share cleanup
- **WHEN** session 删除机制删除 session `S1`
- **THEN** 该 session 的分享记录 MUST 被级联清理
- **AND** 清理 MUST 通过 gateway public boundary 或会话删除 composite gateway boundary 执行

#### Scenario: Deleted session share no longer exposes content
- **GIVEN** 分享 `SH1` 指向 session `S1` 的 run `R1`
- **WHEN** `S1` 删除成功
- **THEN** 查看 `SH1` MUST 返回 `SHARE_NOT_FOUND` 或 `SHARE_CONTENT_DELETED`
- **AND** MUST NOT 返回 `R1` 的 user 或 assistant messages

#### Scenario: Share cleanup failure rolls back session delete
- **GIVEN** session `S1` 存在分享记录 `SH1`
- **WHEN** 会话删除事务中的 share 清理失败
- **THEN** 会话删除 MUST 返回显式 safe error
- **AND** `S1` 和 `SH1` MUST 保持删除前状态

#### Scenario: Share cleanup cannot cross creator scope
- **GIVEN** 两个不同创建者 owner 或 Agent scope 下存在相同 `sessionId` 字符串的分享记录
- **WHEN** 当前 scope 删除 session `S1`
- **THEN** 系统 MUST 只清理当前 `(tenantId, subjectId, agentId, sessionId)` 下的分享记录
- **AND** 其他 scope 的分享记录 MUST 不被删除

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

### Requirement: Copied retry answer 的冻结分享保持完整

当冻结分享选择的 `runId` 是 fork 生成的 copied run anchor、该 anchor 没有真实 `RequestRun`，且 selected answer 来自 source request 的 retry attempt 时，分享读取 MUST 使用 selected run messages 的唯一 child-owned `requestId` 关联同 session、同 frozen creator scope 下恰好一个 canonical USER message。canonical USER 与 selected answer MAY 携带同 request 的不同 child run anchor。

分享结果 MUST 只包含该 canonical USER 和冻结 selected run 对应的 messages，MUST NOT 因 request 关联而加入同 request 的其他 run assistant/capability messages。selected run 缺少 assistant answer、request identity 不唯一、canonical USER 缺失或不唯一时，读取 MUST 返回 `SHARE_CONTENT_DELETED`。系统 MUST NOT 回源读取 parent/ancestor session，也不得扩大到分享 session 的其他 request。

**需求类别**：系统质量属性

**质量属性**：安全、可靠性/恢复

**适用范围**：该 Function

#### Scenario: 递归 fork 分享 copied retry answer
- **GIVEN** source request 的 canonical USER 属于原 attempt run，visible answer 属于 retry run
- **AND** 递归 fork 将二者复制到同一 child request，但使用不同 child run anchor
- **WHEN** 用户冻结分享 copied retry answer 的 child run anchor
- **THEN** 分享读取 MUST 返回该 request 的唯一 canonical USER 和 selected answer run messages
- **AND** MUST NOT 返回同 request 的其他 run answer 或 capability messages
- **AND** MUST NOT 返回 parent 或 ancestor session facts

#### Scenario: copied retry answer 分享在 replacement 后保持可读
- **GIVEN** copied retry answer 的冻结分享已创建
- **WHEN** child 后续执行 retry 或 edit 并以 replacement reason 隐藏 copied messages
- **THEN** 原分享 MUST 继续返回创建时选中的 canonical USER 和 copied retry answer

#### Scenario: copied run 无法唯一补齐 canonical USER
- **WHEN** selected copied run 缺少 assistant answer，或其 request identity/canonical USER 无法唯一解析
- **THEN** 分享读取 MUST 返回 `SHARE_CONTENT_DELETED`
- **AND** MUST NOT 猜测其他 request、run、session 或 ancestor 中的用户问题

### Requirement: 分享创建校验返回确定字段级结果

系统 MUST 对 `POST /api/v1/sessions/:sessionId/shares` 的 `runIds` 请求字段执行字段级校验。校验失败 MUST 返回 HTTP `400` 与 `REQUEST_VALIDATION_FAILED`，并 MUST 使用本 Requirement 规定的确定消息；消息 MUST NOT 包含数组下标或未解析的约束值。

**需求类别**：功能性需求

#### Scenario: 缺失 runIds

- **WHEN** 分享创建请求缺失 `runIds`
- **THEN** 错误消息 MUST 为 `runIds is required.`

#### Scenario: runIds 数组为空或超量

- **WHEN** `runIds` 是空数组
- **THEN** 错误消息 MUST 为 `runIds must contain at least 1 item(s).`
- **WHEN** `runIds` 包含超过 `100` 个元素
- **THEN** 错误消息 MUST 为 `runIds must not exceed 100 items.`

#### Scenario: runId 超过字段长度上限

- **WHEN** `runIds` 中任一元素超过 `256` 个字符
- **THEN** 错误消息 MUST 为 `runIds must not exceed 256 characters.`
- **AND** 错误消息 MUST NOT 暴露该元素的数组下标

### Requirement: 分享 run 解析使用批量查询

`ConversationShareService` 在创建分享和查看分享路径解析选中 `runIds` 时，MUST 通过一次 `RequestRunStoreGateway.listRuns` 批量查询获取当前可信 scope 下全部选中 run 的 `RequestRunRecord`，构建 `runId -> RequestRunRecord` 的映射，MUST NOT 对每个 `runId` 在解析循环内逐条调用 `loadRun`。单次 `listRuns` 的 `limit` MUST 等于选中 `runIds` 数量（受前端 `100` 上限约束，恒满足 `listRuns` 的 `1..100` 上限），MUST NOT 使用分页循环。

`resolveShareUnit` MUST 从批量查询构建的映射中按 `selectedRunId` 取 `RequestRunRecord`，取不到时 MUST 进入与原 `loadRun === undefined` 等价的 fork copied run anchor 回退分支。映射命中时 MUST 沿用原 scope 与 session 归属校验（`run.tenantId`、`run.subjectId`、`run.agentId`、`run.sessionId` 与当前 scope 一致）和 attempt 精度逻辑。批量解析 MUST 与原逐条解析行为等价：`SHARE_RUN_NOT_RESOLVABLE`、`SHARE_CONTENT_DELETED`、fork copied run anchor 回退、scope 隔离和 attempt 精度语义 MUST 保持不变。

`listRuns` 已按可信 `tenantId`、`subjectId`、`agentId` 过滤，跨 scope 的同值 `runId` 不会出现在结果页中，因此映射缺失即等价于原 `loadRun` 对跨 scope run 返回 `undefined` 的回退路径。

**需求类别**：系统质量属性

**质量属性**：性能/容量、可靠性/恢复

**适用范围**：该 Function

#### Scenario: 创建分享单次批量解析

- **GIVEN** 用户 `(T1, U1, A1)` 在 session `S1` 选中 runs `[R1, R2, R3]` 创建分享
- **WHEN** `createShare` 解析选中 `runIds`
- **THEN** `ConversationShareService` MUST 调用一次 `listRuns({ tenantId: T1, subjectId: U1, agentId: A1, runIds: [R1, R2, R3], offset: 0, limit: 3 })`
- **AND** MUST NOT 对 `R1`、`R2`、`R3` 分别调用 `loadRun`

#### Scenario: 查看分享单次批量解析

- **GIVEN** 分享 `SH1` 的冻结 `runIds` 为 `[R1, R2]`
- **WHEN** `loadSharedConversation` 解析选中 `runIds`
- **THEN** `ConversationShareService` MUST 调用一次 `listRuns` 获取 `R1` 和 `R2` 的记录
- **AND** MUST NOT 对 `R1`、`R2` 分别调用 `loadRun`

#### Scenario: 批量解析与逐条解析行为等价

- **GIVEN** scope `(T1, U1, A1)`、session `S1` 下存在可分享的 runs `[R1, R2]`
- **WHEN** 使用批量 `listRuns` 解析 `runIds`
- **THEN** 分享创建结果 MUST 与逐条 `loadRun` 解析时一致
- **AND** 分享查看结果 MUST 与逐条 `loadRun` 解析时一致

#### Scenario: fork copied run anchor 回退保持不变

- **GIVEN** 选中 `runId` `F1` 是 fork 生成的 copied run anchor，没有 `RequestRunRecord`
- **AND** `F1` 对应的 readable messages 恰好有一个唯一 canonical USER 和 assistant answer
- **WHEN** 使用批量 `listRuns` 解析 `runIds`
- **THEN** `listRuns` 结果 MUST 不包含 `F1`
- **AND** `resolveShareUnit` MUST 进入 fork copied run anchor 回退分支
- **AND** 分享解析 MUST 成功返回 canonical USER 和 `F1` 的 selected messages

#### Scenario: 跨 scope runId 不可见

- **GIVEN** `(T1, U1, A1)` 与 `(T2, U2, A2)` 下存在相同字符串值的 `runId`
- **WHEN** `(T1, U1, A1)` 的分享解析使用 `listRuns` 查询该 `runId`
- **THEN** 结果 MUST 只包含 `(T1, U1, A1)` 的记录
- **AND** 映射缺失该 runId 时 MUST 进入 fork 回退分支或返回不可解析
- **AND** 其他 scope 的记录 MUST 不可见

#### Scenario: 跨 session run 被拒绝

- **GIVEN** scope `(T1, U1, A1)` 下 `runId` `R1` 属于 session `S2` 而非当前分享 session `S1`
- **WHEN** `listRuns` 返回 `R1` 的记录
- **THEN** `resolveShareUnit` MUST 校验 `run.sessionId !== S1` 并返回 null
- **AND** 分享创建 MUST 抛出 `SHARE_RUN_NOT_RESOLVABLE`，分享查看 MUST 返回 `SHARE_CONTENT_DELETED`
