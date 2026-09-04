## Function

- **所属 Function**：`FN-1.14 创建分享链接`
- **Function 变更类型**：`MODIFIED`
- **spec 角色**：主规格

## MODIFIED Requirements

### Requirement: Share creation Web API contract

系统 SHALL 通过 `agent-channel-web` 暴露 `POST /api/v1/sessions/:sessionId/shares` 路由用于创建分享。路由的 owner scope MUST 来自 `IdentityResolver` 解析的可信 identity context，agent scope MUST 来自可信 app composition 或已持久化 session 的 `agentId`；路由 MUST NOT 从请求体或路径参数中接受 `tenantId`、`subjectId` 或 `agentId`。

请求体包含：`runIds`（string 数组，至少 1 个元素，对应要分享的问答对 run ID）、`originUrl`（string，创建者当前服务的基地址，如 `https://10.0.0.1:3000`）、`expiresIn`（枚举值 `"24h"` | `"7d"` | `"30d"` | `"permanent"`，对应 24 小时、7 天、30 天、永久）、`allowedOps`（string 数组或 null，null 表示公开分享）。

成功返回 `200` 和分享结果 DTO，包含 `shareUrl`（完整分享链接，格式为 `{originUrl}/#/shared/{shareId}`）和 `shareId`。

当 `WebChannelDependencies.shares` 未注入时，路由 MUST 返回 `503` 和 `SafeError { code: "SHARES_UNAVAILABLE" }`，不得静默返回空结果或伪装成功。

请求体和响应体 MUST 经过 runtime schema validation。`runIds` 为空数组时返回 `400`。`originUrl` 不是合法 URL 时返回 `400`。

`ConversationShareService.createShare` MUST 在持久化分享记录之前，对请求体中的每个 `runId` 执行可 resolve 校验：使用与 `loadSharedConversation` 相同的 resolve 逻辑判定该 `runId` 能否在创建者 scope `(tenantId, subjectId, agentId, sessionId)` 下 resolve 为一个完整问答对（canonical USER 问题 + final assistant answer）。任一 `runId` 不可 resolve 时，系统 MUST 返回 `404` 和 `SafeError { code: "SHARE_RUN_NOT_RESOLVABLE", category: "NOT_FOUND", retryable: false }`，MUST NOT 持久化分享记录，MUST NOT 返回 `shareId` 或 `shareUrl`。校验逻辑 MUST 复用 `loadSharedConversation` 的 resolve 路径，保证"创建时可 resolve"与"查看时可读"判定一致；fork 生成的 copied run anchor（无 `RequestRunRecord` 但有可读 messages 且能唯一补齐 canonical USER 与 assistant answer）MUST 通过校验，不得因缺少 `RequestRunRecord` 而被拒绝。校验 MUST NOT 回源读取 parent / ancestor session 或扩大到同 session 的其他 request。

**需求类别**：功能性需求

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

#### Scenario: Non-existent or unresolvable runId returns 404
- **WHEN** 客户端 `POST /api/v1/sessions/S1/shares` 且请求体 `runIds` 含一个不存在或无法 resolve 为完整问答对的 `runId`（如该 `runId` 在创建者 scope 下无任何可读 message、缺少 canonical USER、或缺少 final assistant answer）
- **THEN** 返回 `404`，body 为 `{ error: { code: "SHARE_RUN_NOT_RESOLVABLE" } }`
- **AND** 系统 MUST NOT 持久化分享记录
- **AND** 系统 MUST NOT 返回 `shareId` 或 `shareUrl`

#### Scenario: Cross-scope or cross-session runId returns 404
- **WHEN** 客户端 `POST /api/v1/sessions/S1/shares` 且请求体 `runIds` 含一个 `RequestRunRecord` 存在但其 scope（tenantId / subjectId / agentId / sessionId）与创建者 scope 不一致的 `runId`
- **THEN** 返回 `404`，body 为 `{ error: { code: "SHARE_RUN_NOT_RESOLVABLE" } }`
- **AND** 系统 MUST NOT 持久化分享记录、MUST NOT 回源读取其他 scope 或 parent / ancestor session

#### Scenario: Fork-generated copied run anchor passes create-time validation
- **WHEN** 客户端 `POST /api/v1/sessions/S1/shares` 且请求体 `runIds` 含一个 fork 生成的 copied run anchor：该 `runId` 无 `RequestRunRecord`，但在创建者 scope 下有可读 messages、归属唯一 `requestId`、且该 `requestId` 下能唯一补齐 canonical USER 并存在 final assistant answer
- **THEN** 返回 `200`，body 包含 `shareId` 和 `shareUrl`
- **AND** 后续 `GET /api/v1/shares/{shareId}/conversation` 返回 `200` 且包含该 canonical USER 与 selected run answer

## Function 变更汇总

### 处理过程

- **变更类型**：修改
- **目标内容**：`ConversationShareService.createShare` 在持久化分享记录之前，对每个 `runId` 复用 `loadSharedConversation` 的 resolve 逻辑校验能否形成完整问答对；不可 resolve 时 throw `AgentError(SHARE_RUN_NOT_RESOLVABLE, NOT_FOUND)` 并中止，不落库、不返回分享结果。
- **依据 Requirements**：`Share creation Web API contract`

### 结果

- **变更类型**：修改
- **目标内容**：传入不存在、不可 resolve、跨 scope 或跨 session 的 `runIds` 创建分享时，立即返回 `404 SHARE_RUN_NOT_RESOLVABLE`，不再生成死链；合法 run（含 copied run anchor）仍正常创建并可查看。
- **依据 Requirements**：`Share creation Web API contract`

### 规格

- **规格项**：创建分享的 runId 可 resolve 校验
- **变更类型**：新增
- **原规格值**：不适用（新增）
- **目标规格值**：创建分享前对每个 `runId` 执行可 resolve 校验，复用查看期 resolve 逻辑；不可 resolve 返回 `404 SHARE_RUN_NOT_RESOLVABLE` 且不落库；copied run anchor 通过校验；不回源 parent / ancestor session。
- **依据 Requirements**：`Share creation Web API contract`
