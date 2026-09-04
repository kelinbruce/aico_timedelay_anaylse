## ADDED Requirements

### Requirement: Provider 和 model 失败映射到标准 safe error 语义
Provider 调用失败、stream 失败和 normalization 失败 SHALL 映射到标准的 error code/category/retryable 语义和 `SafeError` 输出，而不是单独的 model 特定 public error DTO。

#### Scenario: Provider 调用失败
- **WHEN** 一次 provider invocation 在 `agent-model` 内部失败
- **THEN** 该失败 MUST 在跨越模块或 API 边界之前被分类为标准的 error code/category/retryable 语义

### Requirement: 未知失败在跨越边界前被 normalize
任何跨越 API、stream、audit、日志或 capability 边界的未知错误 MUST 先通过 `ErrorNormalizer.normalize(error)`。

#### Scenario: Adapter 抛出意外异常
- **WHEN** provider adapter 代码抛出未知异常
- **THEN** 导出的失败 MUST 是一个 normalize 过的 `SafeError`

### Requirement: Safe error 输出永不暴露敏感的 provider 细节
由 model/provider 失败产生的 `SafeError` MUST NOT 暴露原始 provider 响应体、原始凭据、stack trace、本地路径或 transport 内部细节。

#### Scenario: Provider 返回详细的错误响应体
- **WHEN** provider 错误响应体包含账户、transport 或 credential 细节
- **THEN** 这些细节 MUST NOT 出现在 `SafeError` 中

### Requirement: 同步、流式和 normalization 失败共享一个安全失败边界
来自 `complete()`、`stream()` 和 stream normalization 的失败 SHALL 可通过同一个安全失败边界消费。

#### Scenario: Stream normalization 失败
- **WHEN** 流式的 provider 输出无法被 normalize 为有效的 terminal result
- **THEN** terminal 失败 MUST 通过与非流式失败所使用的相同 safe error 边界表达

### Requirement: Fallback 和可观测性消费 safe error 而不是原始异常
Fallback 评估和可观测性管线 MUST 消费 `SafeError` 和标准错误分类，而不是解析原始 provider 异常。

#### Scenario: Fallback 评估可重试性
- **WHEN** 上层决定是否可以尝试另一个 profile
- **THEN** 它们 MUST 依赖诸如 `code`、`category`、`retryable` 和被允许的 `safeDetails` 这样的 safe error 字段
