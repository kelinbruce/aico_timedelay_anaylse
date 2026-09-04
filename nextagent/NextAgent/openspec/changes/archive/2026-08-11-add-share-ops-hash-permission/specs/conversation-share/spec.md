## MODIFIED Requirements

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
