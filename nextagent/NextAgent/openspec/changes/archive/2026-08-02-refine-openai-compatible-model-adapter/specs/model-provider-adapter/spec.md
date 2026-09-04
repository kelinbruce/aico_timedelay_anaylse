## REMOVED Requirements

### Requirement: Agent-model owns internal provider adapter capability

**Reason**：该黑盒模型分发行为属于 `FN-4.1 调用模型` canonical spec；adapter SPI 与工厂 shape 属于 design。

**Migration**：目标行为迁入 `model-invocation-contract` 的“模型接入配置只在模型边界内解析”。

### Requirement: Provider adapter consumes reviewed invocation inputs

**Reason**：provider-neutral 输入、thinking capability 和 tool-call 结果是模型调用行为，不应在 adapter legacy spec 重复定义；provider-native mapping 细节属于 design。

**Migration**：目标行为迁入 `model-invocation-contract` 的“OpenAI-compatible 调用遵循统一 Chat Completions 语义”和“Provider options remain an open selected-provider extension”。

### Requirement: Provider SDK remains internal to agent-model

**Reason**：SDK 隔离是统一模型调用契约的可维护性边界。

**Migration**：目标行为迁入 `model-invocation-contract` 的“Invocation semantics define one stable invocation capability”和“OpenAI-compatible 调用遵循统一 Chat Completions 语义”。

### Requirement: Raw provider results stay inside agent-model boundaries

**Reason**：raw provider fact 的泄漏边界属于模型调用的安全终态语义。

**Migration**：目标行为迁入 `model-invocation-contract` 的“流式输出只暴露完整的 provider-neutral 事实”和“Failure exits are explicit and safe”。

### Requirement: Provider adapter does not own fallback or routing

**Reason**：单模型调用与 cross-model fallback 的边界分别属于 `FN-4.1` 和 `FN-4.2` canonical specs。

**Migration**：单 profile 调用约束迁入 `model-invocation-contract` 的“Failure exits are explicit and safe”；fallback owner 迁入 `model-fallback-semantics`。
