## ADDED Requirements

### Requirement: Fallback 不由 model invocation 边界拥有
Model-profile fallback 评估 SHALL NOT 由 `agent-model` 内部执行。

在上层 orchestration 与路由策略能力实现之前，runtime SHALL 在所选 profile 失败后 fail closed。

#### Scenario: 单个 profile 的调用失败
- **WHEN** 一次 model invocation 以失败结束
- **THEN** `agent-model` MUST 把失败结果返回给其调用方，AND 它 MUST NOT 自行决定尝试另一个 profile

### Requirement: Agent-model 不得执行隐式跨 profile fallback
`agent-model` MUST NOT 在路由未命中、provider 失败或 normalization 失败时静默切换到另一个 profile。

#### Scenario: Provider 调用失败
- **WHEN** 所选 profile 在调用期间失败
- **THEN** `agent-model` MUST 返回带安全失败语义的 terminal result，AND 它 MUST NOT 自动调用另一个不同的 profile

### Requirement: 未来 fallback 评估消费已稳定的候选与安全失败事实
当上层 fallback orchestration 实现后，它 SHALL 使用 `modelProfileRegistry` 的 fallback-eligible selector 和安全失败语义来评估 fallback，而不是使用原始 provider 异常或 ad hoc 的 profile 发现。

#### Scenario: Fallback 策略评估可重试性
- **WHEN** orchestration 考虑另一个 profile
- **THEN** 它 MUST 依赖 registry selector 和当前的 `SafeError`

### Requirement: 路由证据拥有未来 fallback 证据
Fallback 决策证据、已选路径证据和拒绝证据 SHALL 由路由证据能力拥有，而不是由特定 model 的 evidence contract 拥有。

#### Scenario: Fallback 决策被记录
- **WHEN** orchestration 决定是否 fallback
- **THEN** 产生的证据 MUST 遵循路由 evidence contract

### Requirement: 未来 fallback orchestration 处理可见输出重放门禁
如果某个 request step 已经发出用户可见输出，未来的 fallback orchestration MUST NOT 在没有显式证据和策略处理的情况下，静默地在另一个 profile 上重放同一步骤。

#### Scenario: 已发出部分可见输出
- **WHEN** 某 model step 已发出用户可见内容随后失败
- **THEN** 上层 MUST NOT 在另一个 profile 上执行静默重放
