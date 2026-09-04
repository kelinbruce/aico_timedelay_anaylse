## Function

- **所属 Function**：`FN-1.14 创建分享链接`
- **Function 变更类型**：`MODIFIED`
- **spec 角色**：主规格

## ADDED Requirements

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

## Function 变更汇总

### 处理过程

- **变更类型**：修改
- **目标内容**：分享创建请求的 schema 校验结果投影为稳定的顶层字段名和实际约束值。
- **依据 Requirements**：`分享创建校验返回确定字段级结果`

### 结果

- **变更类型**：修改
- **目标内容**：调用方可通过确定消息定位 `runIds` 缺失、数量或元素长度问题，不再收到数组下标或 `undefined` 约束值。
- **依据 Requirements**：`分享创建校验返回确定字段级结果`
