## Function

- **所属 Function**：`FN-1.8 查看会话消息`
- **Function 变更类型**：`MODIFIED`
- **spec 角色**：主规格

## ADDED Requirements

### Requirement: 会话预览查询校验返回确定字段级结果

系统 MUST 对 `GET /api/v1/sessions/:sessionId/conversation/preview` 的 `offset` 和 `limit` 查询参数执行字段级校验。校验失败 MUST 返回 HTTP `400` 与 `REQUEST_VALIDATION_FAILED`，并 MUST 使用本 Requirement 规定的确定消息；合法的前导零正整数 MUST 按其整数值处理。

**需求类别**：功能性需求

#### Scenario: 缺失或非法分页参数返回字段级消息

- **WHEN** 请求缺失 `limit`
- **THEN** 错误消息 MUST 为 `limit is required.`
- **WHEN** `offset` 或 `limit` 不是整数串
- **THEN** 错误消息 MUST 分别为 `offset must be an integer.` 或 `limit must be an integer.`
- **WHEN** `offset` 或 `limit` 超出有限安全整数范围
- **THEN** 错误消息 MUST 分别为 `offset must be a finite safe integer.` 或 `limit must be a finite safe integer.`
- **WHEN** `offset` 为负数
- **THEN** 错误消息 MUST 为 `offset must be a non-negative integer.`
- **WHEN** `limit` 小于 `1` 或大于 `500`
- **THEN** 错误消息 MUST 为 `limit must be between 1 and 500.`

#### Scenario: 额外查询参数返回 preview 专属消息

- **WHEN** 请求包含 `offset`、`limit` 之外的查询参数
- **THEN** 系统 MUST 返回 HTTP `400` 与 `REQUEST_VALIDATION_FAILED`
- **AND** 错误消息 MUST 为 `Conversation preview only supports offset and limit query parameters.`

#### Scenario: 前导零正整数 limit 被接受

- **WHEN** 请求使用 `limit=01`
- **THEN** 系统 MUST 按整数 `1` 处理该参数并返回成功响应

## Function 变更汇总

### 处理过程

- **变更类型**：修改
- **目标内容**：preview 查询参数由同一路由校验路径产生字段级错误结果，并将合法前导零正整数按整数值处理。
- **依据 Requirements**：`会话预览查询校验返回确定字段级结果`

### 结果

- **变更类型**：修改
- **目标内容**：调用方收到与字段和失败原因一一对应的确定校验消息；`limit=01` 成功并等同于 `limit=1`。
- **依据 Requirements**：`会话预览查询校验返回确定字段级结果`
