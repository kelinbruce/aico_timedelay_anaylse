## MODIFIED Requirements

### Requirement: Shared conversation view Web API contract
系统 SHALL 通过 `agent-channel-web` 暴露 `GET /api/v1/shares/:shareId/conversation` 路由用于查看分享的问答对内容。此路由通过不可猜测的 `shareId` 凭证访问，不依赖查看者的 owner scope 做数据隔离。

查看者（remote 模式）MUST 通过 HTTP header `X-Viewer-Ops` 传递自身 ops 的 SHA-256 hash（JSON 编码的长度 1 的 string 数组 `[hash]`）。前端 MUST 在调用本 API 前对完整 ops 数组执行与创建分享相同的 hash 变换规则。Local 模式下查看者不携带此 header，后端视为无 ops。

后端处理流程 MUST 按以下顺序校验：
1. 按 `shareId` 查找分享记录。不存在 → 返回 `404` 和 `SafeError { code: "SHARE_NOT_FOUND" }`。
2. 校验有效期：`expiresAt != null` 且当前时间超过 `expiresAt` → 返回 `410` 和 `SafeError { code: "SHARE_EXPIRED" }`。
3. 校验权限：`allowedOps != null` 时，校验查看者 hash 与存储 hash 是否相等（`allowedOps[0] === viewerOps[0]`）。`viewerOps` 为 null 或空数组时，只有 `allowedOps` 也为 null 才通过。校验失败 → 返回 `403` 和 `SafeError { code: "SHARE_FORBIDDEN" }`。
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

#### Scenario: View share with matching ops hash
- **WHEN** 分享 `SH1` 的 `allowedOps=["hashH"]`（创建者 ops hash）
- **AND** 查看者携带 `X-Viewer-Ops: ["hashH"]`（查看者 ops hash 与创建者相同）
- **THEN** 返回 `200`，body 包含问答对内容

#### Scenario: View share with insufficient ops hash
- **WHEN** 分享 `SH1` 的 `allowedOps=["hashH1"]`（创建者 ops hash）
- **AND** 查看者携带 `X-Viewer-Ops: ["hashH2"]`（查看者 ops hash 与创建者不同）
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
