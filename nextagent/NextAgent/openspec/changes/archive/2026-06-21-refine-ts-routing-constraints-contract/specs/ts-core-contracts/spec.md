## ADDED Requirements

### Requirement: Runtime 拥有请求携带的 RoutingConstraints contract
系统 SHALL 在 `agent-contracts/runtime` 边界下定义请求携带的 `RoutingConstraints`。`SubmitRequestCommand` 和已接受的 `RequestContext` SHALL 能够携带可选的 `routingConstraints`。Runtime SHALL 将该类型化值传递给 Agent 执行，而不解释业务路由语义。

#### Scenario: Submit command 携带路由约束
- **WHEN** channel/auth 边界以允许的路由约束字段构造一个请求提交
- **THEN** `SubmitRequestCommand` MAY 携带 `routingConstraints`
- **AND** 已接受的 `RequestContext` MAY 为 Agent Core 携带相同的类型化约束
- **AND** runtime MUST NOT 基于这些约束解析 Skill、Tool、Agent capability、provider、model profile 或业务路径

#### Scenario: 请求没有路由约束
- **WHEN** channel/auth 边界构造一个不带路由约束的请求提交
- **THEN** `SubmitRequestCommand.routingConstraints` MAY 缺省
- **AND** 已接受的 `RequestContext.routingConstraints` MAY 缺省
- **AND** 请求生命周期 MUST 保持既有的默认路由行为

### Requirement: RoutingConstraints 字段最小且安全
`RoutingConstraints` SHALL 只定义 request 作用域的处理偏好字段：`targetSkill`、`forbiddenCapabilityIds`、`executionMode`、`locale`、`maxToolCalls`、`allowHumanInput` 和 `allowSubagents`。它 SHALL NOT 定义 owner、tenant、subject、agent 覆盖、provider 覆盖、model profile 覆盖、raw prompt、raw policy、raw tool authority、capability provider 覆盖、credential、path 或 provider 私有字段。

#### Scenario: 允许的字段被表达
- **WHEN** 路由约束包含 contract 形状合法的允许字段
- **THEN** 类型化 DTO MAY 将这些字段表达为 request 作用域约束
- **AND** 该 DTO MUST NOT 暗示执行授权

#### Scenario: 尝试提供被禁止的覆盖
- **WHEN** 输入试图把 owner、tenant、subject、agent 覆盖、provider 覆盖、raw prompt、raw policy、model profile 覆盖、raw tool authority、credential、path 或 provider 私有数据作为路由约束提供
- **THEN** 这些字段 MUST NOT 能在 `RoutingConstraints` contract 中被表达
- **AND** runtime MUST NOT 用它们改变 Agent Scope、Owner Scope、provider selection、prompt construction、model profile、capability authority 或 catalog 可见性

### Requirement: 路由核心 contract 形状有唯一 owner
系统 SHALL 在同一个 contract refinement owner 中定义最小化的路由核心 contract 形状，供下游 router 改动消费。这些形状 SHALL 覆盖路由配置、policy 输入和 policy 结果，而不引入新的路由 subpath 或新的决策 kind。

#### Scenario: 路由配置形状被声明
- **WHEN** 下游路由核心需要可信的路由配置
- **THEN** contract owner MUST 定义与 `AgentRoutingConfig` 等价的最小形状
- **AND** 该形状 MUST 支持 `mode?: "default" | "policy"`
- **AND** 当 `mode=policy` 时，它 MUST 支持 `policy.method`
- **AND** 在本 change 中 `policy.method` MUST 是 `policy:intent-recognition`

#### Scenario: Policy 输入和结果形状被声明
- **WHEN** 下游路由核心需要 policy 输入和输出 contract
- **THEN** contract owner MUST 定义与 `AgentRoutingPolicyInput` 和 `AgentRoutingPolicyResult` 等价的最小形状
- **AND** policy 输入 MUST 限定为已接受的 `run`、已接受的 `context`、冻结的 `agentAssembly` 和 `signal`
- **AND** policy 结果 MUST 包含冻结的路由 `decisionKind` 和 `safeReason`
- **AND** policy 结果 MAY 包含 `skillName`
- **AND** `skillName` MUST NOT 暗示直接授权或绕过治理

### Requirement: Runtime 携带但不治理 RoutingConstraints
Runtime SHALL 把 `routingConstraints` 视为从提交传递到已接受执行上下文的请求事实。Runtime SHALL NOT 把 schema 合法的约束当作授权、policy 决策、capability 解析、provider 选择或 model 选择。

#### Scenario: Runtime 接受约束
- **WHEN** runtime 接受一个带有类型化 `routingConstraints` 的请求
- **THEN** runtime MUST 保持当前可信的 Agent Scope 和 Owner Scope
- **AND** runtime MUST 将类型化约束作为请求事实传递给 Agent 执行
- **AND** Agent Core routing policy 仍对使用前的后续治理负责

#### Scenario: 下游治理不可用
- **WHEN** 路由约束校验或定向 Skill 路由未实现或不可用
- **THEN** runtime MUST NOT 用自己的业务治理替代
- **AND** 它 MUST NOT 静默地将约束重新解释为路由授权
