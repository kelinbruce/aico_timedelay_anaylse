## Function

- **所属 Function**：`FN-1.8 查看会话消息`
- **Function 变更类型**：`MODIFIED`
- **spec 角色**：主规格

## MODIFIED Requirements

### Requirement: 会话预览查询校验返回确定字段级结果

系统 MUST 对 `GET /api/v1/sessions/:sessionId/conversation/preview` 的 `offset` 和 `limit` 查询参数执行字段级校验。校验失败 MUST 返回 HTTP `400` 与 `REQUEST_VALIDATION_FAILED`，并 MUST 使用本 Requirement 规定的确定消息；合法的前导零正整数 MUST 按其整数值处理。`offset` 范围 MUST 为 `0` 到 `10000`（含），`limit` 范围 MUST 为 `1` 到 `100`（含）。

**需求类别**：功能性需求

#### Scenario: 缺失或非法分页参数返回字段级消息

- **WHEN** 请求缺失 `limit`
- **THEN** 错误消息 MUST 为 `limit is required.`
- **WHEN** `offset` 或 `limit` 不是整数串
- **THEN** 错误消息 MUST 分别为 `offset must be an integer.` 或 `limit must be an integer.`
- **WHEN** `offset` 为负数
- **THEN** 错误消息 MUST 为 `offset must be a non-negative integer.`
- **WHEN** `offset` 大于 `10000`，或为长度超过 5 位的 digit string（如 `1e27`）
- **THEN** 错误消息 MUST 为 `offset must not exceed 10000.`
- **AND** 超大 digit string MUST 在数值解析前被长度守卫拦截，MUST NOT 返回 `offset must be a finite safe integer.`
- **WHEN** `limit` 小于 `1` 或大于 `100`
- **THEN** 错误消息 MUST 为 `limit must be a positive integer.`（小于 1）或 `limit must not exceed 100.`（大于 100）

#### Scenario: 额外查询参数返回 preview 专属消息

- **WHEN** 请求包含 `offset`、`limit` 之外的查询参数
- **THEN** 系统 MUST 返回 HTTP `400` 与 `REQUEST_VALIDATION_FAILED`
- **AND** 错误消息 MUST 为 `Conversation preview only supports offset and limit query parameters.`

#### Scenario: 前导零正整数 limit 被接受

- **WHEN** 请求使用 `limit=01`
- **THEN** 系统 MUST 按整数 `1` 处理该参数并返回成功响应

#### Scenario: Preview 分页参数范围被收紧且仍可读多 marker 会话

- **WHEN** 客户端请求 preview 且 `offset` 在 `0` 到 `10000` 之间、`limit` 在 `1` 到 `100` 之间
- **THEN** Web API SHALL 接受请求并返回对应 marker 窗口
- **AND** `offset=10000` 与 `limit=100` MUST 返回 `200`
- **WHEN** 客户端请求 preview 且 `offset` 大于 `10000` 或 `limit` 大于 `100`
- **THEN** Web API SHALL 返回 validation error
- **AND** runtime/session/gateway preview contracts MUST NOT 接收越界的 preview 查询
- **AND** 超过 100 个 visible USER marker 的会话 MUST 仍可通过合法 `offset` 与 `limit` 分页读取

## Function 变更汇总

### 处理过程

- **变更类型**：修改
- **目标内容**：`parseConversationPreviewQuery` 在数值解析前对 `offset` 加长度守卫（5 位），解析后加数值上界（10000）；`limit` 上限由 500 收紧为 100。超大 digit string 不再经 `Number()` 触发 `finite safe integer` 分支。
- **依据 Requirements**：`会话预览查询校验返回确定字段级结果`

### 结果

- **变更类型**：修改
- **目标内容**：`offset` 范围 `0`–`10000`、`limit` 范围 `1`–`100`；错误消息统一为 `must not exceed` 文案，移除 `offset must be a finite safe integer.` 与 `limit must be between 1 and 500.`。
- **依据 Requirements**：`会话预览查询校验返回确定字段级结果`
