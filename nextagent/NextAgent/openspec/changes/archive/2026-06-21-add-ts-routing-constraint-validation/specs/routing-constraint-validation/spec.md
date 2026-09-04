## ADDED Requirements

### Requirement: 路由约束使用允许清单 schema
在 `refine-ts-routing-constraints-contract` 定义了请求携带的 `RoutingConstraints` 之后，系统 SHALL 只接受允许清单内的路由约束字段：`targetSkill`、`forbiddenCapabilityIds`、`executionMode`、`locale`、`maxToolCalls`、`allowHumanInput` 和 `allowSubagents`。

#### Scenario: 允许的路由约束被提交
- **WHEN** 请求包含形状合法的允许路由约束字段
- **THEN** channel/request 边界 MAY 将它们作为类型化路由约束接受
- **AND** runtime MAY 将它们随已接受的 request 事实携带
- **AND** Agent routing policy 在使用前 MUST 仍对其实施治理

#### Scenario: 提交被禁止的路由覆盖
- **WHEN** 请求包含 owner、tenant、subject、agent 覆盖、provider 覆盖、capability provider 覆盖、raw system prompt、raw policy、raw tool authority 或 raw model profile 覆盖字段
- **THEN** 请求边界或 Agent routing policy MUST 按安全校验策略拒绝或忽略这些字段
- **AND** 这些字段 MUST NOT 影响 Agent Scope、Owner Scope、capability authority、provider selection 或 prompt construction

### Requirement: 约束校验分为两个阶段
路由约束校验 SHALL 在不可信边界处有一个 schema 阶段，在 Agent routing policy 内部有一个治理阶段。schema 有效性 SHALL 只产生类型化的约束值；它 SHALL NOT 授予执行授权。

#### Scenario: 约束通过 schema 校验
- **WHEN** `targetSkill` 是有效的安全标识符且 `maxToolCalls` 是有效的有界整数
- **THEN** schema 校验 MAY 产生类型化约束
- **AND** Agent routing policy 仍 MUST 对照当前 Agent、Owner Scope、capability governance、locale、availability、budget 和 policy 对其进行校验

#### Scenario: 约束未通过治理
- **WHEN** 一个 schema 合法的约束与当前 Agent policy、Owner Scope、capability governance、availability、budget 或安全上下文冲突
- **THEN** Agent routing policy MUST 按策略拒绝、忽略、澄清、移交或降级
- **AND** 它 MUST NOT 将 schema 有效性视为执行授权

### Requirement: 约束只能收窄或引导授权
路由约束 SHALL 只在当前已接受的 Agent 和 Owner Scope 内收窄或引导处理选择。它们 SHALL NOT 扩展 capability 可见性、model 可见性、tool authority、provider 访问、tenant 访问、subagent authority 或 prompt authority。

#### Scenario: forbiddenCapabilityIds 收窄候选
- **WHEN** `forbiddenCapabilityIds` 包含一个对当前请求可见的 capability
- **THEN** Agent routing policy MUST 将其从当前决策的合格候选中排除
- **AND** 该排除 MUST NOT 变更 AgentAssembly、catalog 状态或未来请求

#### Scenario: allowSubagents 为 false
- **WHEN** `allowSubagents=false`
- **THEN** Agent routing policy MUST 为当前请求排除 subagent/Agent capability 路径
- **AND** 它 MUST NOT 从 Agent assembly 中移除 Agent capability binding

#### Scenario: 提供 locale 约束
- **WHEN** 提供了 `locale`
- **THEN** 只有在与可信 channel/auth locale policy 和当前 Agent policy 兼容时，routing policy 才 MAY 使用它
- **AND** 它 MUST NOT 覆盖 Owner Scope 或安全身份

### Requirement: 预算和执行约束在慢边界之前被强制执行
`maxToolCalls`、`executionMode`、`allowHumanInput` 和 `allowSubagents` 等执行约束 SHALL 在调用它们所限制的 model、capability、human input、subagent 或其他慢边界之前被检查。

#### Scenario: maxToolCalls 为零
- **WHEN** `maxToolCalls=0`
- **THEN** Agent routing policy MUST 阻止受约束请求路径的 tool/capability 调用
- **AND** 它 MUST 按策略选择 model-only、拒绝、澄清或移交

#### Scenario: 禁止 human input
- **WHEN** `allowHumanInput=false`
- **AND** 路由原本会需要澄清或人工审批
- **THEN** routing policy MUST 选择安全拒绝、model-only 回退或另一条被允许的路径
- **AND** 它 MUST NOT 创建 pending input

### Requirement: 约束校验结果可观测且安全
约束校验 SHALL 为 routing evidence、audit、日志和 trace 产生安全的 accepted、rejected、ignored 或 degraded 结果。用户可见面 SHALL 只接收最终结果、pending input、移交或 safe error。

#### Scenario: 约束被拒绝
- **WHEN** 一个路由约束因形状非法、冲突、授权、可用性、预算或策略而被拒绝
- **THEN** 系统 MUST 为可观测性记录一个安全的 reason code
- **AND** 它 MUST NOT 向用户暴露原始 constraint payload、policy 内部信息、provider 私有事实、本地路径或 secret

#### Scenario: 校验依赖不可用
- **WHEN** 校验某个约束所需的 policy、catalog、availability 或 budget 依赖不可用
- **THEN** routing MUST fail closed 或选择一个 policy 声明的安全降级路径
- **AND** 它 MUST NOT 静默丢弃该约束并像未提供约束一样继续
