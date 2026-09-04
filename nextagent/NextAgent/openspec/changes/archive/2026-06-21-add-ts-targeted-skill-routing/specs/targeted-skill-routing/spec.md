## ADDED Requirements

### Requirement: 目标 Skill 是一种路由约束
在路由约束 contract 完善之后，系统 SHALL 把来自用户或上游输入的 `targetSkill` 视为一个类型化路由约束。它 SHALL NOT 将其视为调用 Skill 的直接授权。

#### Scenario: Channel 接收 targetSkill
- **WHEN** channel 接收到一个带有 `targetSkill` 的请求
- **THEN** channel MAY 通过 runtime request submission 将其作为类型化路由约束转发
- **AND** channel MUST NOT 直接调用该 Skill
- **AND** 在 Agent routing policy 接受该约束之前，runtime MUST NOT 解析或执行该 Skill

### Requirement: 目标 Skill 路由在执行前受治理
Agent routing policy SHALL 只通过 request 作用域的 capability governance 边界解析目标 Skill，并在执行前校验 kind=`SKILL`、当前 Agent binding、Owner Scope 可见性/授权、availability、禁止约束、capability invocation budget、deadline 和 cancellation。

#### Scenario: 目标 Skill 被接受
- **WHEN** 一个请求指定 `targetSkill=alarm-diagnosis`
- **AND** 该 Skill 属于当前冻结的 Agent assembly，处于启用、可用、对当前 Owner Scope 可见且已授权、未被禁止的状态，并在 capability invocation budget 之内
- **THEN** Agent routing policy MAY 选择一个 Agent 自有的确定性流程，在其内部调用受治理的 Skill
- **AND** Skill 执行 MUST 使用受治理的 capability invocation 路径
- **AND** 该决策 MUST 为下游可观测性产生安全的路由结果/evidence

#### Scenario: 目标 Skill 被约束禁止
- **WHEN** `targetSkill` 指定的 Skill 同时出现在 `forbiddenCapabilityIds` 中
- **THEN** Agent routing policy MUST 拒绝该目标 Skill
- **AND** 它 MUST NOT 执行该 Skill
- **AND** 它 MUST 按策略返回 safe error、澄清或一条被允许的回退路径

#### Scenario: 目标 Skill 超出 Agent scope
- **WHEN** `targetSkill` 解析到一个未绑定到当前已接受 Agent assembly 的 Skill
- **THEN** Agent routing policy MUST 拒绝该定向 Skill 路径
- **AND** 它 MUST NOT 搜索其他 Agent 或全局 catalog 来执行它

### Requirement: 定向 Skill 执行保持请求生命周期边界
定向 Skill 路由 SHALL 在已接受的 request/run 生命周期内执行，并且 SHALL 不在既有 runtime/core port 之外创建 session message、terminal commit、audit 事件、checkpoint 或 timeline 事件。本 change SHALL NOT 为定向 Skill 执行新增公开的路由决策 kind。

#### Scenario: 定向 Skill 成功
- **WHEN** 一次受治理的首选 Skill 调用成功
- **THEN** Agent Core MUST 通过统一的结果 contract 消费 `CapabilityInvocationResult`
- **AND** 生成的 message、context patch、ref、安全 payload、降级或 safe error MUST 遵循既有的 capability result 消费规则

#### Scenario: 定向 Skill 需要用户输入
- **WHEN** 所选 Skill 在执行前需要澄清、确认、授权或人工移交
- **THEN** Agent Core MUST 使用 runtime 拥有的 pending input 或移交边界
- **AND** 它 MUST NOT 创建对 runtime 不可见的 Agent 本地 pending 状态

### Requirement: 目标 Skill 失败显式降级
如果目标 Skill 无法使用，系统 SHALL 只通过 policy 声明的路径拒绝、澄清、移交或回退。它 SHALL NOT 静默忽略该偏好并执行一个无关的 Skill 且当作它被选中一样。

#### Scenario: 目标 Skill 不可用
- **WHEN** 目标 Skill 缺失、被禁用、不可用、不可见、未授权、被禁止、超出预算、超时或被取消
- **THEN** Agent routing policy MUST 产生一个安全的拒绝或降级 reason
- **AND** 只有当 policy 显式允许从用户定向 Skill 失败回退时，它才 MAY 选择 model 驱动的回退
- **AND** 任何 model 驱动的回退 MUST 为已接受的请求进入既有的 model 驱动下游路径，而不是以相同 `targetSkill` 重新启动路由
- **AND** 用户可见结果 MUST 不暴露 provider 私有诊断或 policy 内部信息

#### Scenario: Skill 解析超时
- **WHEN** 解析或检查目标 Skill 的可用性超出请求预算，或 AbortSignal 被 abort
- **THEN** routing MUST 以安全的超时/取消结果或一条被允许的澄清/移交路径结束
- **AND** 它 MUST NOT 以过期或部分解析的 Skill 事实继续

### Requirement: 定向 Skill 路由区别于 model 的 Skill tool 使用
用户定向的 Skill 路由 SHALL 是一条可信的 Agent 路由路径。Model 发起的 `Skill` tool 使用 SHALL 仍由 Skill tool contract 治理，且 MUST NOT 被视为用户定向的 `targetSkill`。

#### Scenario: Model 发出 Skill tool 调用
- **WHEN** model 以 `name` 调用 `Skill` tool
- **THEN** 该调用 MUST 遵循面向 model 的 Skill tool 治理路径
- **AND** 它 MUST NOT 事后变成用户可信的 `targetSkill`

#### Scenario: 用户指定目标 Skill
- **WHEN** 用户或上游可信边界提供 `targetSkill`
- **THEN** Agent routing policy MUST 在 model 生成的 tool 调用之前处理它
- **AND** model 输出 MUST NOT 覆盖或放宽可信的目标 Skill 约束
- **AND** 定向 Skill 路由 MUST NOT 重新接受一个已被路由约束治理为同一已接受请求拒绝过的 `targetSkill`
