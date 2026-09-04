# model-fallback-semantics Specification

## Purpose
定义模型调用失败后的跨模型降级判定、候选选择、重新装配、执行边界和安全失败结果，同时保持同模型重试与跨模型降级的语义分离。

## Function

- **所属 Function**：`FN-4.2 模型失败降级`
- **Function 变更类型**：`MODIFIED`
- **spec 角色**：主规格

## Requirements
### Requirement: Fallback is not owned by the model invocation boundary

模型调用边界 MUST 只执行已选择的 `modelId`，并 MUST 作为唯一同模型 retry owner，在模型调用 contract 允许的范围内对明确 recoverable failure 执行 retry；它 MUST 返回归一化成功结果或 retry exhausted 安全失败。Core 和其他 caller MUST NOT 为同一 `modelId` 包裹第二层 retry、重置 logical-invocation timeout 或叠加 retry 次数。模型调用边界 MUST NOT 选择其他模型、读取 Agent default 来选择 route、执行 cross-model retry 或隐式 fallback。每次模型选择和重装配 MUST 保持在 Context Engine 的受治理边界中。

**需求类别**：功能性需求

#### Scenario: 已选模型调用失败
- **WHEN** 已选模型调用返回 fallback-eligible safe failure
- **THEN** 模型边界把该失败返回 orchestration
- **AND** 不调用其他模型

### Requirement: Agent-model must not perform implicit cross-profile fallback
`agent-model` MUST NOT silently switch to another profile on route miss, provider failure, or normalization failure.

#### Scenario: Provider invocation fails
- **WHEN** the selected profile fails during invocation
- **THEN** `agent-model` MUST return the terminal result with safe failure semantics, AND it MUST NOT automatically invoke a different profile

### Requirement: Future fallback evaluation consumes stabilized candidates and safe failure facts

Fallback evaluation SHALL 消费 accepted Agent identity、当前 safe failure、request/run/step state、visible-output state、deadline、budget、cancellation 和累计 attempted ids。Agent Core MUST 只在 `SafeError.retryable=true` 时允许该失败进入 cross-model fallback lifecycle gate；category 只表达安全错误类别，MUST NOT 把 `retryable=false` 的失败升级为可恢复。Agent Core MUST 只决定是否允许再次尝试；Context Engine MUST 从 accepted Agent 的 `AVAILABLE`、fallback-eligible 且未尝试模型中选择。两者 MUST NOT 消费 endpoint、credential、raw provider error、可变源配置或调用方提供的 route data。

**需求类别**：功能性需求

#### Scenario: 允许再次尝试
- **WHEN** safe failure 和 lifecycle gate 允许再次尝试
- **THEN** Agent Core 使用 attempted ids 请求可信 fallback reassembly
- **AND** Context Engine 从剩余 available eligible configurations 中选择

#### Scenario: Failure 不符合 fallback 条件
- **WHEN** safe failure 的 `retryable=false`
- **THEN** Agent Core 拒绝 fallback
- **AND** Context Engine 不收到选择请求
- **AND** `UNAVAILABLE`、`TIMEOUT` 或 `INTERNAL` category MUST NOT 覆盖该决定

#### Scenario: Failure facts 不安全或不完整
- **WHEN** 系统无法确认 eligible failure 或可信 request state
- **THEN** 系统拒绝另一次模型调用
- **AND** 不检查或暴露 provider access fact

### Requirement: Routing evidence owns future fallback evidence
Fallback decision evidence, selected path evidence, and rejection evidence SHALL be owned by the routing evidence capability rather than by a model-specific evidence contract.

#### Scenario: Fallback decision is recorded
- **WHEN** orchestration decides whether to fallback
- **THEN** the resulting evidence MUST follow the routing evidence contract

### Requirement: Future fallback orchestration handles visible-output replay gates
If a request step has already emitted user-visible output, future fallback orchestration MUST NOT silently replay that same step on another profile without explicit evidence and policy handling.

#### Scenario: Partial visible output already emitted
- **WHEN** a model step has already emitted user-visible content and then fails
- **THEN** upper layers MUST NOT perform silent replay on another profile

### Requirement: Agent Core orchestrates model fallback explicitly

已选模型在模型边界内完成或耗尽同 `modelId` recoverable retry 后、且在 terminal commit 前安全失败时，Agent Core SHALL 根据 cancellation、剩余 deadline 和 budget、visible-output state、safe failure、request/run/step state 及累计 attempted model ids 决定是否允许 fallback replay。允许 replay 时，Agent Core MUST 请求可信 fallback context reassembly；Context Engine MUST 选择下一个符合条件的 activated model 并重新计算 model-specific context。Agent Core MUST 只调用新渲染的选择结果，并记录 applied、denied 或 exhausted evidence。Agent Core MUST NOT 拥有模型候选、查询 provider access configuration 或自行选择模型。

**需求类别**：功能性需求

#### Scenario: 应用 fallback model
- **WHEN** 已选模型的同模型 retry 已耗尽或不适用，并在产生用户可见输出前失败
- **AND** deadline、budget 和 cancellation 允许再次尝试
- **AND** 可信 fallback reassembly 返回新选择的模型
- **THEN** Agent Core 调用新模型的渲染请求
- **AND** 记录安全 fallback-applied evidence

#### Scenario: 可见输出阻止 replay
- **WHEN** 已选模型产生用户可见输出后失败
- **THEN** Agent Core 拒绝 same-step fallback replay
- **AND** 不请求或调用其他模型

#### Scenario: Context Engine 报告候选耗尽
- **WHEN** 可信 fallback reassembly 报告没有符合条件且未尝试的模型
- **THEN** Agent Core 记录 fallback-exhausted evidence
- **AND** 不构造 route 或选择全局默认模型
