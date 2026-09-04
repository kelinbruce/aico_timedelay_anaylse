## ADDED Requirements

### Requirement: ModelProfile 携带模型 context window 大小

`agent-contracts/app.ModelProfile` SHALL 包含 `contextWindowTokens: number`，一个以 token 表达模型 context window 容量的正整数。本次 refinement SHALL NOT 改变 `ModelInfo` 或 `ModelOptions`；`ModelOptions.maxTokens` SHALL 继续只表达输出上限。

#### Scenario: 模型 profile 声明其 context window

- **WHEN** 定义一个 model profile
- **THEN** 它以正整数携带 `contextWindowTokens`
- **AND** `ModelOptions.maxTokens` 仍然只表达输出上限，而不是 context window

### Requirement: Context window 是装配预算窗口来源

用于 context assembly 预算计算的选定模型窗口 SHALL 派生自已受理 model profile 的 `contextWindowTokens`。它 SHALL NOT 由 `ContextAssemblyRequest`、客户端请求体、模型输出或 capability 参数携带。

#### Scenario: 预算计算解析窗口

- **WHEN** context assembly 计算 `availableInputUnits`
- **THEN** 模型窗口从已受理 model profile 的 `contextWindowTokens` 读取
- **AND** 不接受来自 `ContextAssemblyRequest` 的任何窗口值
