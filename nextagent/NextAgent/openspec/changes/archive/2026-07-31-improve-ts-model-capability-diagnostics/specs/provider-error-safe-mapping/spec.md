## MODIFIED Requirements

### Requirement: Provider and model failures map into standard safe error semantics

Provider invocation failure、stream failure 和 normalization failure SHALL map into standard `SafeError` code/category/retryable semantics，而不是单独的 model-specific public error DTO。

映射 SHALL 遵守 `actionable-execution-failure` 定义的有序分类。Provider adapter 只能使用经过 schema/shape 检查的 provider status、provider-owned stable error code、transport outcome 和当前 cancellation/timeout state 进行分类；不得解析 prompt、模型输出、provider free-text message 或 raw body 来决定公开 code、category 或 retryable。

#### Scenario: Provider call fails with a recognized stable outcome

- **WHEN** provider invocation returns a recognized status or provider-owned stable error code
- **THEN** the failure MUST be classified into the matching standard code/category/retryable semantics before crossing the module boundary
- **AND** classification MUST NOT depend on provider free-text content

#### Scenario: Provider call fails without a recognized outcome

- **WHEN** provider invocation fails without a recognized status or stable provider code
- **THEN** the exported result MUST use `MODEL_INTERNAL_ERROR`
- **AND** category MUST be `INTERNAL`
- **AND** retryable MUST be `false`

## ADDED Requirements

### Requirement: Provider 异常在安全归一化前形成安全本地诊断

当 model provider 的 complete、stream 或 normalization owner 捕获将被转换成失败 `ModelFinalResult` 的异常时，该 owner MUST 在安全归一化之前以 `error` level 向本地 runtime diagnostic logger 输出恰好一个 `model.provider.failure_captured`。

该 diagnostic 由 producer 提交的字段 MUST 限定为 `event`、`failureStage=MODEL_PROVIDER`、`requestId`、`stepId`、`providerKind`、`safeErrorCode`、`safeErrorCategory`、`retryable` 和标准 `err`；writer-owned timestamp、level、component 与安全异常投影不受该 producer allowlist 限制。请求提供 `modelProfileId` 时 MUST 输出该字段；请求包含且已通过现有 precondition validation 的 `invocationScope` 时 MUST 输出其中的 `agentId`、`agentVersion`、`sessionId` 和 `runId`。可选 scope/profile 缺失时 MUST 省略对应字段，不得从默认 Agent、全局配置、model name、raw payload 或相邻 invocation 推断。

该 diagnostic MUST NOT 输出 `rawExceptionData`、exception message、raw stack、raw provider body、header、endpoint、base URL、model name、provider custom metadata、prompt、模型输出或 credential。如果失败由正常 provider result 表达且不存在异常对象，owner MUST NOT 伪造异常证据。诊断写入失败 MUST NOT 改变 model result、fallback、cancellation 或 request terminal outcome。

该 diagnostic MUST NOT 进入 `ObservabilityObservationEvent`、timeline、SafeError、audit、metric、trace、Web API 或 stream。

#### Scenario: Provider 异常先诊断后归一化

- **WHEN** provider SDK 抛出携带 status、cause 和 message 的异常
- **THEN** model owner MUST 输出一个 `model.provider.failure_captured`
- **AND** MUST 随后返回按稳定字段分类的 SafeError
- **AND** local runtime log MUST 能使用既有 run 和 step 坐标关联这两个结果
- **AND** local runtime log MUST NOT 包含 exception message、provider body 或 raw stack

#### Scenario: 正常安全失败结果不伪造异常

- **WHEN** provider adapter 通过普通返回值报告失败且没有捕获异常
- **THEN** model owner MUST 返回对应 SafeError
- **AND** MUST NOT 创建虚构异常类型、fingerprint 或 frame

#### Scenario: 诊断 sink 失败不改变模型结果

- **WHEN** runtime diagnostic logger 拒绝或丢弃 provider exception entry
- **THEN** model owner MUST 继续完成 SafeError 归一化
- **AND** invocation result MUST 与 logger 可用时相同

#### Scenario: 非 run-bound model invocation 不伪造执行坐标

- **WHEN** provider 捕获异常且 `ModelInvocationRequest` 没有 `invocationScope` 或 `modelProfileId`
- **THEN** `model.provider.failure_captured` MUST 保留 request、step、provider 和安全分类字段
- **AND** MUST 省略缺失的 Agent、session、run 或 profile 字段
- **AND** MUST NOT 使用默认 Agent、全局 model profile、model name 或占位值补齐字段
