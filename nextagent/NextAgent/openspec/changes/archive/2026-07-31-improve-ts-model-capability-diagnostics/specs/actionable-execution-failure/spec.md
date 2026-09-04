## ADDED Requirements

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

### Requirement: 使用者失败呈现包含阶段和固定修复指引

Web chat workspace MUST 基于既有 stream/history 中的 safe code、category、retryable 和可信执行事件确定失败呈现。呈现 MUST 包含可用的稳定错误码、一个失败阶段、是否建议重试以及一个固定本地化修复指引。三个宿主模式 MUST 复用同一失败解释逻辑。

失败阶段只允许为 `MODEL_INVOCATION`、`CAPABILITY_INPUT`、`CAPABILITY_EXECUTION`、`CAPABILITY_OUTPUT`、`REQUEST_RUNTIME` 或 `UNKNOWN`。阶段 MUST 由 event type 与稳定 code 决定，不得从错误 message、raw exception、prompt、模型输出或 Capability payload 推断。

修复指引只允许使用前端 code-owned 本地化文本。认证失败 MUST 指向检查 model credential/config；模型不存在 MUST 指向检查 model profile；限流或网络失败 MUST 指向稍后重试或检查 provider 可用性；输入非法 MUST 指向修正 Capability input；输出非法或内部异常 MUST 指向携带 request/run/tool-call 可见坐标联系开发人员。未知 code MUST 降级为 `UNKNOWN` 和通用安全指引。

#### Scenario: 框架使用人员看到可行动的模型认证失败

- **WHEN**一个 turn 以 `MODEL_AUTHENTICATION_FAILED` 失败
- **THEN**三个宿主模式 MUST 显示阶段 `MODEL_INVOCATION`
- **AND** MUST 显示不可直接重试
- **AND** MUST 显示检查 model credential/config 的固定指引
- **AND** MUST NOT 显示 credential、provider body、stack 或 endpoint

#### Scenario: Capability 输入非法指导修改输入

- **WHEN**过程事件包含 `CAPABILITY_INPUT_INVALID`
- **THEN**失败阶段 MUST 为 `CAPABILITY_INPUT`
- **AND**修复指引 MUST 指向修改 Capability input
- **AND** rejected input value MUST NOT 进入失败详情

#### Scenario: 未识别 code 安全降级

- **WHEN** Web 收到未配置的安全错误码
- **THEN**失败阶段 MUST 为 `UNKNOWN`
- **AND** Web MUST 显示通用安全指引和该稳定错误码
- **AND**不得因为映射缺失而隐藏整个 process panel 或抛出渲染异常

### Requirement: 客户可见失败不暴露开发诊断原文

Web API、SSE、WebSocket、history、timeline、SafeError、audit、metric、trace 和 `ObservabilityObservationEvent` MUST NOT 包含 developer trace entry、raw model request/result、raw Capability arguments/result、provider body、raw exception stack 或本地执行路径。

#### Scenario: 开发诊断已启用但客户 surface 保持安全

- **WHEN**同一 run 启用了 `developer-hook-trace` 并产生 raw boundary entry
- **AND**该 run 发生 model 或 Capability 失败
- **THEN**客户可见 surface MUST 只包含安全失败事实与既有可信坐标
- **AND**跨 surface leakage test MUST 证明 raw canary 不存在于全部客户可见输出
