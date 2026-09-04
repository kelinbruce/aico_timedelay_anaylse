## Function

- **所属 Function**：`FN-1.6 查询会话列表`
- **Function 变更类型**：`MODIFIED`
- **spec 角色**：主规格

## ADDED Requirements

### Requirement: 会话列表查询校验返回确定字段级结果

系统 MUST 对 `GET /api/v1/sessions` 的时间范围和分页查询参数执行字段级校验。校验失败 MUST 返回 HTTP `400` 与 `REQUEST_VALIDATION_FAILED`，并 MUST 使用本 Requirement 规定的确定消息；可表示为有限安全整数的前导零或较长整数串 MUST 按其整数值处理。

**需求类别**：功能性需求

#### Scenario: 时间范围参数返回确定消息

- **WHEN** `createdFrom` 与 `createdTo` 仅提供一个
- **THEN** 错误消息 MUST 为 `createdFrom and createdTo must be provided together.`
- **WHEN** 任一时间参数不是整数串或超出有限安全整数范围
- **THEN** 错误消息 MUST 分别为 `{field} must be an integer.` 或 `{field} must be a finite safe integer.`
- **WHEN** `createdFrom` 大于 `createdTo`
- **THEN** 错误消息 MUST 为 `createdFrom must be less than or equal to createdTo.`
- **WHEN** 时间范围超过允许的 90 天边界
- **THEN** 错误消息 MUST 为 `created time range must not exceed 90 days.`

#### Scenario: 分页参数返回确定消息

- **WHEN** `offset` 或 `limit` 不是整数串或超出有限安全整数范围
- **THEN** 错误消息 MUST 分别为 `{field} must be an integer.` 或 `{field} must be a finite safe integer.`
- **WHEN** `offset` 为负数
- **THEN** 错误消息 MUST 为 `offset must be a non-negative integer.`
- **WHEN** `limit` 不是正整数
- **THEN** 错误消息 MUST 为 `limit must be a positive integer.`
- **WHEN** 搜索查询的 `limit` 大于 `50`
- **THEN** 错误消息 MUST 为 `search limit must not exceed 50.`
- **WHEN** 普通列表查询的 `limit` 大于 `200`
- **THEN** 错误消息 MUST 为 `limit must not exceed 200.`

#### Scenario: 可安全表示的整数串被接受

- **WHEN** 请求使用 `limit=01`
- **THEN** 系统 MUST 按整数 `1` 处理该参数并返回成功响应
- **WHEN** `createdFrom` 与 `createdTo` 是超过 13 位但仍可安全表示且范围合法的整数串
- **THEN** 系统 MUST 接受该时间范围

## Function 变更汇总

### 处理过程

- **变更类型**：修改
- **目标内容**：session list 的时间范围与分页参数由统一 parser 产生字段级校验结果，并按整数语义处理可安全表示的数字串。
- **依据 Requirements**：`会话列表查询校验返回确定字段级结果`

### 结果

- **变更类型**：修改
- **目标内容**：调用方收到与字段和失败原因一一对应的确定消息；合法前导零和较长安全整数不再被字符形状约束误拒绝。
- **依据 Requirements**：`会话列表查询校验返回确定字段级结果`
