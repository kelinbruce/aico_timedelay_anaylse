# actionable-execution-failure Specification

## Purpose
定义模型与 Capability 执行失败的统一安全分类、重试语义和调用方可行动结果，使上游调用方只依赖既有安全错误字段即可判断恢复或停止路径。
## Requirements
### Requirement: Model 和 Capability 失败具有稳定可行动分类

进入模型或 Capability 执行路径的失败 MUST 在离开 owning boundary 前形成一个 `SafeError`。该错误 MUST 使用既有 `code`、`category`、`retryable` 和允许的安全细节表达失败，不得新增平行公开错误 DTO。

Model provider 失败 MUST 按以下有序规则选择恰好一个 code；前项命中后不得再匹配后项：

1. 当前调用已被上游取消时使用 `MODEL_ABORTED`，category 为 `CANCELED`，retryable 为 `false`。
2. 当前调用达到 invocation timeout 时使用 `MODEL_TIMEOUT`，category 为 `TIMEOUT`，retryable 为 `true`。
3. Provider 明确拒绝 credential 或认证时使用 `MODEL_AUTHENTICATION_FAILED`，category 为 `AUTHORIZATION`，retryable 为 `false`。
4. Provider 明确表示目标模型不存在或当前凭据无权使用该模型时使用 `MODEL_NOT_FOUND`，category 为 `NOT_FOUND`，retryable 为 `false`。
5. Provider 明确返回调用频率或并发限制时使用 `MODEL_RATE_LIMITED`，category 为 `UNAVAILABLE`，retryable 为 `true`。
6. Provider 明确拒绝请求 shape、参数或 context window 时分别使用 `MODEL_REQUEST_INVALID` 或 `MODEL_CONTEXT_LIMIT_EXCEEDED`，category 为 `VALIDATION`，retryable 为 `false`。
7. Provider transport 无法建立或维持连接时使用 `MODEL_NETWORK_FAILED`，category 为 `UNAVAILABLE`，retryable 为 `true`。
8. Provider stream 或 response 无法通过规范化/schema validation 时使用 `MODEL_RESPONSE_INVALID`，category 为 `VALIDATION`，retryable 为 `false`。
9. 其余未知异常使用 `MODEL_INTERNAL_ERROR`，category 为 `INTERNAL`，retryable 为 `false`。

Capability 失败 MUST 区分 `CAPABILITY_INPUT_INVALID`、`CAPABILITY_OUTPUT_INVALID`、owner 已声明的 Tool failure/timeout code、`CAPABILITY_DEPENDENCY_UNAVAILABLE` 和 `CAPABILITY_EXECUTION_FAILED`。未知异常只能映射为 `CAPABILITY_EXECUTION_FAILED`、category `INTERNAL`、retryable `false`；不得把输入 schema failure 或输出 schema failure改写为该通用 code。

#### Scenario: Provider 认证失败给出配置指导所需分类

- **WHEN** provider 明确拒绝当前 credential
- **THEN** model boundary MUST 返回 code `MODEL_AUTHENTICATION_FAILED`
- **AND** category MUST 为 `AUTHORIZATION`
- **AND** retryable MUST 为 `false`
- **AND** SafeError MUST NOT 包含 credential、provider body、header 或 endpoint

#### Scenario: Provider 限流保留可重试语义

- **WHEN** provider 明确返回调用频率或并发限制
- **THEN** model boundary MUST 返回 code `MODEL_RATE_LIMITED`
- **AND** retryable MUST 为 `true`

#### Scenario: Capability 输出不符合 schema

- **WHEN** Capability 已执行但返回值未通过其 output schema
- **THEN** capability boundary MUST 返回 code `CAPABILITY_OUTPUT_INVALID`
- **AND** category MUST 为 `VALIDATION`
- **AND**安全细节 MUST NOT 包含 rejected output value

#### Scenario: 未知异常安全降级

- **WHEN** model 或 Capability owner 无法按更具体规则分类异常
- **THEN** owner MUST 返回对应的 `MODEL_INTERNAL_ERROR` 或 `CAPABILITY_EXECUTION_FAILED`
- **AND**客户可见 surface MUST NOT 接收原始异常

### Requirement: 客户可见失败不暴露开发诊断原文

Web API、SSE、WebSocket、history、timeline、SafeError、audit、metric、trace 和 `ObservabilityObservationEvent` MUST NOT 包含 developer trace entry、raw model request/result、raw Capability arguments/result、provider body、raw exception stack 或本地执行路径。

#### Scenario: 开发诊断已启用但客户 surface 保持安全

- **WHEN**同一 run 启用了 `developer-hook-trace` 并产生 raw boundary entry
- **AND**该 run 发生 model 或 Capability 失败
- **THEN**客户可见 surface MUST 只包含安全失败事实与既有可信坐标
- **AND**跨 surface leakage test MUST 证明 raw canary 不存在于全部客户可见输出
