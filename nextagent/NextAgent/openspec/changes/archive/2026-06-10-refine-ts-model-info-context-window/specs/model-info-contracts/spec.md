## ADDED Requirements

### Requirement: ModelInfo 携带模型 context window 大小

`agent-contracts/model.ModelInfo` SHALL 包含 `contextWindowTokens: number` 作为必填字段，该字段是一个以 token 表达模型 context window 容量的正整数。该值 SHALL 由生产环境的 `modelInfoFromProfile` 工厂从 `ModelProfile.contextWindowTokens` 传播而来；构造 `ModelInfo` 字面量的 runtime/test 代码 SHALL 显式提供该字段。该字段 SHALL NOT 是可选的，也 SHALL NOT 在任何 consumer 中默认为常量。

#### Scenario: ModelInfo 将其 context window 声明为必填字段

- **WHEN** 构造一个 `ModelInfo` 值
- **THEN** 它以正整数携带 `contextWindowTokens`
- **AND** TypeScript 拒绝省略该字段的 ModelInfo 字面量

### Requirement: 预算决策门从 ModelInfo 读取真实模型窗口

`agent-context-engine` 中的预算决策门 SHALL 通过直接读取 `modelSelection.modelInfo.contextWindowTokens` 来为 `ContextBudgetPolicyInput` 计算模型窗口。该门 SHALL NOT 携带 fallback 常量、fallback 依赖，或把该字段当作可选字段读取的 type assertion。

#### Scenario: 预算门直接从 modelInfo 读取 contextWindowTokens

- **WHEN** 预算门计算 `ContextBudgetPolicyInput.window`
- **THEN** 该值等于 `modelSelection.modelInfo.contextWindowTokens`
- **AND** 不参考诸如 128000 的常量默认值
- **AND** `DefaultContextEngineDependencies` 上不存在任何 `contextWindowTokensFallback` 依赖
