## Function

- **所属 Function**：`FN-1.15 查看分享的会话`
- **Function 变更类型**：`MODIFIED`
- **spec 角色**：主规格

## ADDED Requirements

### Requirement: Shared conversation view Web API contract

系统 SHALL 通过 `agent-channel-web` 暴露 `GET /api/v1/shares/:shareId/conversation` 路由用于查看分享的问答对内容。此路由通过不可猜测的 `shareId` 凭证访问，不依赖查看者的 owner scope 做数据隔离。

查看者（remote 模式）MUST 通过 HTTP header `X-Viewer-Ops` 传递自身 ops 的 SHA-256 hash（JSON 编码的长度 1 的 string 数组 `[hash]`）。前端 MUST 在调用本 API 前对完整 ops 数组执行与创建分享相同的确定性 hash 变换：去重、字典序排序、`JSON.stringify`、SHA-256、lowercase hex 编码。Local 模式下查看者不携带此 header，后端视为无 ops。

后端处理流程 MUST 按以下顺序校验：
1. 按 `shareId` 查找分享记录。不存在 → 返回 `404` 和 `SafeError { code: "SHARE_NOT_FOUND" }`。
2. 校验有效期：`expiresAt != null` 且当前时间超过 `expiresAt` → 返回 `410` 和 `SafeError { code: "SHARE_EXPIRED" }`。
3. 校验权限：`allowedOps != null` 时，校验存储的创建者 ops hash 与查看者 ops hash 是否相等（`allowedOps[0] === viewerOps[0]`）。`viewerOps` 为 null 或空数组时，只有 `allowedOps` 也为 null 才通过。校验失败 → 返回 `403` 和 `SafeError { code: "SHARE_FORBIDDEN" }`。
4. 用分享记录中冻结的创建者 owner scope `(tenantId, subjectId)`、Agent Scope `agentId`、`sessionId` 和每个已选 `runId` 解析完整分享单元。若 session 不存在，或任一已选 `runId` 无法解析为恰好一个 canonical `USER` message 和至少一条 `ASSISTANT` answer message，则整个请求返回 `404` 和 `SafeError { code: "SHARE_CONTENT_DELETED" }`，MUST NOT 返回其余已选 run 的部分结果。
5. 全部通过 → 返回 `200` 和问答对内容（经 projection 的只读 DTO）。

完整分享单元 MUST 遵守以下穷尽规则：
- 普通请求和 edit 后创建的新请求：返回已选 `runId` 下的 canonical 用户问题、`ASSISTANT` answer 及既有规则允许分享的同 attempt messages。
- retry attempt：返回该 attempt 的 `ASSISTANT` answer 及既有规则允许分享的同 attempt messages，并返回与该 attempt 属于同一 request 的 canonical 用户问题；当该用户问题归属于该 request 的较早 attempt 时，系统 MUST 仍返回该问题，且 MUST NOT 因此返回较早 attempt 的回答或 capability result。
- fork copied run anchor：返回子会话内同一 copied run anchor 下的 canonical 用户问题、`ASSISTANT` answer 及既有规则允许分享的 copied messages，MUST NOT 读取 parent session。

`RETRY_REPLACED` 或 `EDIT_REPLACED` 隐藏原因只改变默认会话投影；当对应消息属于已冻结分享单元时，分享读取 MUST 允许读取这些消息，并在只读分享 DTO 中投影为 `visible=true`，使分享页面能够渲染冻结内容，但 MUST NOT 返回内部 `metadata.visibility` 或 `hiddenByContextId`，且 MUST NOT 回写原消息可见性。`GUARD_BLOCKED`、物理删除以及其他隐藏原因不属于分享读取的允许集合，分享读取 MUST NOT 返回对应消息。

返回的问答对内容 MUST 只包含由 `runIds` 快照解析出的完整分享单元，MUST NOT 返回 session 中未被解析为所选单元组成部分的其他 request 或回答。返回的 messages MUST 按 `createdAt` 升序排列。返回的 DTO MUST NOT 包含任何标注（annotation）状态，也不得为分享读取新增 think 或 timeline event 查询；既有 `CAPABILITY_RESULT` message 的分享投影保持不变。

当 `WebChannelDependencies.shares` 未注入时，路由 MUST 返回 `503` 和 `SafeError { code: "SHARES_UNAVAILABLE" }`。

**需求类别**：功能性需求

#### Scenario: 查看普通公开分享
- **WHEN** 分享 `SH1` 的 `runIds=[R1]`、`allowedOps=null`、`expiresAt=null`
- **AND** `R1` 下存在一个 canonical `USER` message 和至少一条 `ASSISTANT` answer message
- **THEN** 返回 `200` 和 `R1` 的完整问答单元
- **AND** messages 按 `createdAt` 升序排列
- **AND** body 不包含 annotation、think 或 timeline event

#### Scenario: 查看者 ops hash 与创建者相同
- **WHEN** 分享 `SH1` 的 `allowedOps=["hashH"]`
- **AND** 查看者携带 `X-Viewer-Ops: ["hashH"]`
- **THEN** 返回 `200` 和所选完整问答单元

#### Scenario: 查看者 ops hash 与创建者不同
- **WHEN** 分享 `SH1` 的 `allowedOps=["hashH1"]`
- **AND** 查看者携带 `X-Viewer-Ops: ["hashH2"]`
- **THEN** 返回 `403` 和 `{ error: { code: "SHARE_FORBIDDEN" } }`

#### Scenario: 查看 retry attempt 的新分享
- **WHEN** request `Q1` 的 canonical 用户问题属于 attempt `R1`
- **AND** 分享 `SH1` 只选择 retry attempt `R2`
- **THEN** 返回 `Q1` 的 canonical 用户问题和 `R2` 的可渲染回答消息
- **AND** MUST NOT 返回 `R1` 的回答消息

#### Scenario: retry 替换后查看既有分享
- **WHEN** 分享 `SH1` 在 retry 前冻结 `runIds=[R1]`
- **AND** retry 将 `R1` 的回答消息标记为 `RETRY_REPLACED`
- **THEN** 查看 `SH1` 返回 `R1` 创建时对应的完整问答单元
- **AND** 分享 DTO 将允许读取的 replacement-hidden 消息投影为 `visible=true`
- **AND** 分享 DTO 不包含内部 `metadata.visibility` 或 `hiddenByContextId`
- **AND** 原消息的 `visible=false` 与隐藏原因保持不变

#### Scenario: edit 替换后查看既有与新分享
- **WHEN** 分享 `SH1` 在 edit 前冻结源 request 的 `runIds=[R1]`
- **AND** edit 创建新 request 和 run `R2`，并将源 request 消息标记为 `EDIT_REPLACED`
- **AND** 分享 `SH2` 在 edit 后冻结 `runIds=[R2]`
- **THEN** 查看 `SH1` 返回源 request 的完整问答单元
- **AND** 查看 `SH2` 返回新 request 的完整问答单元

#### Scenario: 查看 fork copied run anchor 分享
- **WHEN** 子会话中的 copied run anchor `F1` 下存在 canonical 用户问题和可渲染回答消息
- **AND** 分享 `SH1` 冻结 `runIds=[F1]`
- **THEN** 返回子会话中 `F1` 的完整问答单元
- **AND** MUST NOT 读取或返回 parent session 的消息

#### Scenario: 多 run 分享中任一单元不完整
- **WHEN** 分享 `SH1` 冻结 `runIds=[R1,R2]`
- **AND** `R1` 可解析为完整问答单元，但 `R2` 缺少 canonical 用户问题或可渲染回答消息
- **THEN** 返回 `404` 和 `{ error: { code: "SHARE_CONTENT_DELETED" } }`
- **AND** MUST NOT 返回 `R1` 的部分成功结果

#### Scenario: 安全隐藏内容不因分享而暴露
- **WHEN** 已选 `runId` 的消息被标记为 `GUARD_BLOCKED`
- **THEN** 分享读取 MUST NOT 返回该消息
- **AND** 若因此无法形成完整分享单元，则返回 `404` 和 `{ error: { code: "SHARE_CONTENT_DELETED" } }`

#### Scenario: 分享能力未注入
- **WHEN** `WebChannelDependencies.shares` 未注入
- **AND** 客户端请求查看分享路由
- **THEN** 返回 `503` 和 `{ error: { code: "SHARES_UNAVAILABLE" } }`

### Requirement: Owner scope controlled exception for share viewing

查看分享路径是 owner scope 隔离原则的受控例外。系统 MUST 用 `ConversationShareRecord` 中冻结的创建者 owner scope `(tenantId, subjectId)`、Agent Scope `agentId` 和 `sessionId` 解析分享单元，而非查看者的 scope。

触发此跨 scope 读取的唯一凭证是不可猜测的 `shareId`。读取范围 MUST 严格锁定在 `runIds` 快照以及形成每个所选 retry attempt 完整分享单元所必需的同 request canonical 用户问题，MUST NOT 扩散到 session 的其他 request、未选 attempt 的回答、其他 session 或 parent session。此例外只存在于“查看分享”只读路径，MUST NOT 传染其他主路径的数据访问逻辑。

此受控例外的安全保证基于：`shareId` 的不可预测性（密码学安全随机生成）、读取范围的严格锁定、隐藏原因允许集合，以及只读语义（不产生任何写操作）。

**需求类别**：系统质量属性

**质量属性**：安全

**适用范围**：该 Function

#### Scenario: 跨 scope 读取使用冻结的创建者范围
- **WHEN** 创建者 `(T1, U1, A1)` 在 session `S1` 创建分享 `SH1`
- **AND** 查看者 `(T2, U2, A1)` 使用有效 `shareId` 查看分享
- **THEN** 系统 MUST 用 `(T1, U1, A1,S1)` 解析所选完整分享单元
- **AND** MUST NOT 用查看者 `(T2, U2, A1)` 的 scope 查询消息

#### Scenario: retry 问题补全不扩散回答范围
- **WHEN** 分享 `SH1` 选择 retry attempt `R2`
- **AND** canonical 用户问题属于同 request 的较早 attempt `R1`
- **THEN** 系统 MUST 允许读取该 canonical 用户问题
- **AND** MUST NOT 读取 `R1` 的回答或同 session 其他 request 的消息

#### Scenario: fork 分享不追溯 parent session
- **WHEN** 分享 `SH1` 选择子会话的 copied run anchor `F1`
- **THEN** 系统 MUST 只读取子会话内 `F1` 对应的 copied messages
- **AND** MUST NOT 使用 fork source 追溯 parent session

## Function 变更汇总

### 描述

- **变更类型**：修改
- **目标内容**：查看分享时把每个冻结 `runId` 解析为完整且 attempt 精确的问答单元；retry/edit 替换不破坏既有分享，安全隐藏和内容缺失不会产生部分结果或越权暴露。
- **依据 Requirements**：`Shared conversation view Web API contract`、`Owner scope controlled exception for share viewing`

### 处理过程

- **变更类型**：修改
- **目标内容**：在既有凭证、有效期和权限校验通过后，逐个解析所选分享单元；任一单元不完整则整体失败，全部完整时按时间顺序返回只读内容。
- **依据 Requirements**：`Shared conversation view Web API contract`

### 结果

- **变更类型**：修改
- **目标内容**：成功结果包含全部所选完整问答单元且不含未选回答、运行过程或标注；内容无法完整解析时返回既有 `SHARE_CONTENT_DELETED`。
- **依据 Requirements**：`Shared conversation view Web API contract`、`Owner scope controlled exception for share viewing`
