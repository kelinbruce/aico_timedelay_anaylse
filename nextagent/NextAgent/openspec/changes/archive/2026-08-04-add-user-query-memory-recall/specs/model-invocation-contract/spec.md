## Function

- **所属 Function**：`FN-4.1 调用模型`
- **Function 变更类型**：`MODIFIED`
- **spec 角色**：主规格

## MODIFIED Requirements

### Requirement: Target-state request fields are stable invocation inputs

`ModelInvocationRequest` SHALL 保持封闭对象。其 required 顶层字段 MUST 恰好为可信 `invocationScope`、`modelId`、`messages` 和 `tools`；optional 顶层字段 MUST 恰好为 `temperature`、`maxOutputTokens`、`topP`、`topK`、`presencePenalty`、`frequencyPenalty`、`thinking`、`providerOptions`、正整数 `timeoutMs`、非负整数 `maxRetries` 和正整数 `contextWindowTokens`。

`contextWindowTokens` MUST 只由已解析的模型配置经可信调用路径提供，并仅用于 framework-owned final-input budget admission 与 `BEFORE_MODEL_INVOKE` Hook 边界。该字段 MUST NOT 由客户端、模型、Capability、Hook mutation 或 providerOptions 提供或覆盖，MUST NOT 映射为 provider-native request、framework-owned header 或模型可见消息。调用方缺失该字段时保持既有模型调用语义。

**需求类别**：功能性需求

#### Scenario: 受信 Hook 使用模型窗口预算
- **WHEN** 已解析模型配置的调用进入 `BEFORE_MODEL_INVOKE`
- **THEN** `ModelInvocationRequest` 和 Hook boundary MUST 携带相同的 `contextWindowTokens`
- **AND** 下游 provider request 和模型消息 MUST NOT 因该字段增加 provider 参数、header 或内容

## Function 变更汇总

### 输入

- **变更类型**：修改
- **目标内容**：模型调用可携带来自已解析模型配置的只读 `contextWindowTokens` 预算元数据。
- **依据 Requirements**：`Target-state request fields are stable invocation inputs`
