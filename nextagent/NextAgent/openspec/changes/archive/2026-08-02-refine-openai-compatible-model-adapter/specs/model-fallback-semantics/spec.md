## Function

- **所属 Function**：`FN-4.2 模型失败降级`
- **Function 变更类型**：`MODIFIED`
- **spec 角色**：主规格

## ADDED Requirements

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

## MODIFIED Requirements

### Requirement: Fallback is not owned by the model invocation boundary

模型调用边界 MUST 只执行已选择的 `modelId`，并 MUST 作为唯一同模型 retry owner，在模型调用 contract 允许的范围内对明确 recoverable failure 执行 retry；它 MUST 返回归一化成功结果或 retry exhausted 安全失败。Core 和其他 caller MUST NOT 为同一 `modelId` 包裹第二层 retry、重置 logical-invocation timeout 或叠加 retry 次数。模型调用边界 MUST NOT 选择其他模型、读取 Agent default 来选择 route、执行 cross-model retry 或隐式 fallback。每次模型选择和重装配 MUST 保持在 Context Engine 的受治理边界中。

**需求类别**：功能性需求

#### Scenario: 已选模型调用失败
- **WHEN** 已选模型调用返回 fallback-eligible safe failure
- **THEN** 模型边界把该失败返回 orchestration
- **AND** 不调用其他模型

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

## Function 变更汇总

### 描述

- **变更类型**：修改
- **目标内容**：已选模型的同模型 recoverable retry 耗尽或不适用并安全失败后，系统依据可信生命周期事实决定是否允许跨模型再次尝试；允许时选择当前 Agent 下一个符合条件的模型并重新装配模型专属上下文。模型调用边界不拥有候选选择或跨模型重试。
- **依据 Requirements**：`Agent Core orchestrates model fallback explicitly`、`Fallback is not owned by the model invocation boundary`

### 前置条件

- **变更类型**：修改
- **目标内容**：已选模型在 terminal commit 前返回可判定的 retry-exhausted 或 non-recoverable 安全失败，并且 cancellation、剩余 deadline、budget、visible-output state、可信 request/run/step state 和累计 attempted model ids 足以形成 fallback 决策。
- **依据 Requirements**：`Agent Core orchestrates model fallback explicitly`、`Future fallback evaluation consumes stabilized candidates and safe failure facts`

### 输入

- **变更类型**：修改
- **目标内容**：输入包含 accepted Agent identity、当前 safe failure、request/run/step state、visible-output state、deadline、budget、cancellation 和累计 attempted model ids；不得包含 endpoint、credential、raw provider error、可变源配置或调用方提供的 route data。
- **依据 Requirements**：`Agent Core orchestrates model fallback explicitly`、`Future fallback evaluation consumes stabilized candidates and safe failure facts`

### 输出

- **变更类型**：修改
- **目标内容**：输出 fallback applied、denied 或 exhausted 决策及安全证据；允许再次尝试时同时获得针对下一模型重新预算和渲染的可信输入。
- **依据 Requirements**：`Agent Core orchestrates model fallback explicitly`、`Future fallback evaluation consumes stabilized candidates and safe failure facts`

### 处理过程

- **变更类型**：修改
- **目标内容**：模型调用边界先按调用 contract 完成同 `modelId` recoverable retry；仍失败时，系统根据生命周期 gate 判断是否允许跨模型再次尝试。允许时请求可信 fallback reassembly，从当前 Agent 已激活、`AVAILABLE`、fallback-eligible 且未尝试的模型中选择下一候选，重新计算模型专属上下文后再调用。
- **依据 Requirements**：`Agent Core orchestrates model fallback explicitly`、`Fallback is not owned by the model invocation boundary`、`Future fallback evaluation consumes stabilized candidates and safe failure facts`

### 结果

- **变更类型**：修改
- **目标内容**：gate 允许且存在候选时切换到重新装配后的模型继续处理；已有用户可见输出、failure 不符合条件、状态不安全或不完整时拒绝再次尝试；没有剩余候选时返回 exhausted。任何路径都不选择全局默认模型，不暴露 provider 接入事实。
- **依据 Requirements**：`Agent Core orchestrates model fallback explicitly`、`Fallback is not owned by the model invocation boundary`、`Future fallback evaluation consumes stabilized candidates and safe failure facts`

### 主规格

- **变更类型**：修改
- **目标内容**：`model-fallback-semantics`
- **依据 Requirements**：`Agent Core orchestrates model fallback explicitly`、`Fallback is not owned by the model invocation boundary`

### 遗留规格

- **变更类型**：修改
- **目标内容**：`routing-evidence-and-fallback` 继续承载未触及的 evidence 行为。
- **依据 Requirements**：`Agent Core orchestrates model fallback explicitly`、`Future fallback evaluation consumes stabilized candidates and safe failure facts`
