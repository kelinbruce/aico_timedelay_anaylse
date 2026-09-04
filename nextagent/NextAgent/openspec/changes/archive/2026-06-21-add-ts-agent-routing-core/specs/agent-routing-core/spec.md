## ADDED Requirements

### Requirement: Agent 内部路由 policy 选择处理路径
Agent Core SHALL 在 runtime 接受一个请求之后、该请求进入 context assembly、model 调用、capability 调用、拒绝、澄清或人工接手之前，在 Agent 边界内部执行一个路由 policy。

#### Scenario: model 驱动路径由 Agent 路由选择
- **WHEN** runtime 接受一个请求并以冻结的 `agentId`、`agentVersion`、`agentAssemblyRef`、identity、locale、session、run 和 request 事实调用 Agent 边界
- **THEN** Agent Core MUST 在第一个 context/model/capability 处理步骤之前执行路由 policy
- **AND** 该 policy MAY 选择 model 驱动循环路径
- **AND** runtime MUST NOT 代表 Agent Core 选择 model 驱动业务路径

#### Scenario: 未定义专门路由
- **WHEN** runtime 接受一个普通请求且后续 change 尚未安装受治理的确定性、澄清或接手规则
- **THEN** Agent 路由 policy MUST 选择 model 驱动循环路径
- **AND** channel 和 runtime MUST NOT 绕过 Agent 边界执行业务路径

### Requirement: 路由决策词汇复用冻结的核心 contract
Agent 路由 policy SHALL 只产出本 change 冻结核心 contract 中已存在的路由决策种类：确定性 flow、model 驱动循环、clarify、reject 或人工接手。本 change SHALL NOT 新增 public 路由决策种类。初始 routing-core 实现对已接受的普通请求 SHALL 只选择 model 驱动循环，对非法或不可用的可信输入 SHALL 选择 reject/fail closed。

#### Scenario: 产生不支持的决策种类
- **WHEN** 一个路由 policy 实现产出受控词汇之外的决策种类
- **THEN** Agent Core MUST 以安全的内部 policy 错误拒绝该决策
- **AND** 它 MUST NOT 把未知决策重新解释为 capability 调用或 model 循环

#### Scenario: 延迟的决策种类尚未实现
- **WHEN** 初始 routing-core 实现没有针对确定性 flow、clarify 或人工接手的受治理规则
- **THEN** 它 MUST NOT 为那些决策种类发明临时选择规则
- **AND** 它 MUST 根据可信输入状态继续 model 驱动循环或 fail closed

### Requirement: 路由 policy 消费冻结的 request 与 assembly 事实
路由 policy SHALL 消费 runtime 已接受的 `RequestRun`、`RequestContext`、冻结的 `AgentAssembly`、来自可信 Agent 配置源的路由规则配置、受治理的 capability 视图、可见的 model profile 事实、locale、安全上下文、cancellation 上下文，以及任何由已接受的 contract 细化提供的带类型路由约束。它 SHALL NOT 使用客户端 body、model 输出、capability 参数或不可信 metadata 覆盖 Agent Scope 或 Owner Scope。

#### Scenario: 已接受请求到达路由 policy
- **WHEN** Agent Core 为一个已接受请求开始路由
- **THEN** 它 MUST 使用冻结的 `agentId` 和 `agentVersion` 读取 `AgentAssembly`
- **AND** 它 MUST 保留来自可信 channel/auth identity 的已接受 Owner Scope
- **AND** 它 MUST NOT 在请求接受之后重新选择活跃 Agent version

#### Scenario: 路由规则配置可用
- **WHEN** Agent Core 为一个已接受请求开始路由
- **THEN** router MUST 能够接收来自可信 Agent 配置源的路由规则配置
- **AND** 缺失配置或显式 `mode=default` MUST 选择默认路由路径
- **AND** 显式非默认配置当前 MUST 限定为 `mode=policy`
- **AND** 当前内建 `mode=policy` 方法 MUST 为 `policy:intent-recognition`
- **AND** 非法、不可用或不可信的路由规则配置在 policy 要求时 MUST fail closed，仅当存在显式定义的安全默认值时才 MAY 被忽略

#### Scenario: 路由配置遵循最小形状
- **WHEN** 可信 Agent 配置提供路由规则配置
- **THEN** 它 MUST 支持与 contract owner 定义的 `AgentRoutingConfig` 等价的最小形状
- **AND** `mode` MAY 缺失
- **AND** 当 `mode=policy` 时，`policy` MUST 存在
- **AND** 在本 change 中 `policy.method` MUST 为 `policy:intent-recognition`

### Requirement: Policy 路由使用受控的输入与输出 contract
当路由规则配置声明 `mode=policy` 时，Agent 路由 policy SHALL 只消费受控的 policy 输入事实，并 SHALL 保持一个受控的 policy 路由结果边界。在本 change 中，当前结果目标字段限定为 `skillName`；`workflowName` 延迟到后续 change。

#### Scenario: Policy 模式消费受控输入
- **WHEN** 可信 Agent 配置声明 `mode=policy`
- **THEN** router MUST 只从已接受的 request 事实、冻结的 Agent 事实、受治理的 capability/model 可见性、locale/安全上下文、带类型约束和 cancellation/budget 上下文评估 policy
- **AND** 它 MUST NOT 把不可信的 request-body 覆盖、原始 prompt 文本、model 输出或 provider 私有 metadata 读取为 policy 输入

#### Scenario: Policy 输入遵循最小形状
- **WHEN** 路由执行一个 policy 方法
- **THEN** policy 输入 MUST 限定为与 contract owner 定义的 `AgentRoutingPolicyInput` 等价的形状
- **AND** 它 MUST 包含已接受的 `run`
- **AND** 它 MUST 包含已接受的 `context`
- **AND** 它 MUST 包含冻结的 `agentAssembly`
- **AND** 它 MUST 包含 `signal`

#### Scenario: 当前 policy 方法是内建的
- **WHEN** 可信 Agent 配置声明 `mode=policy`
- **THEN** 当前实现 MUST 将内建 `policy:intent-recognition` 方法识别为可信配置
- **AND** 它 MUST NOT 在本 change 中执行用户定义的代码作为 policy 方法
- **AND** 它 MUST NOT 在本 change 中声称具备完整的 intent-recognition policy 评估
- **AND** 自定义 policy 代码的加载和执行 MUST 延迟到后续受治理 change

#### Scenario: Policy 模式产生受控路由结果
- **WHEN** `mode=policy` 评估完成
- **THEN** router MUST 产生一个包含路由决策种类和安全原因的受控路由结果
- **AND** 它 MAY 包含 `skillName`
- **AND** 它 MUST NOT 在路由结果中暴露任意规则引擎 payload、原始 policy 内部细节、secret 或 provider 私有数据

#### Scenario: Policy 结果遵循最小形状
- **WHEN** policy 路由评估成功
- **THEN** 结果 MUST 遵循与 contract owner 定义的 `AgentRoutingPolicyResult` 等价的形状
- **AND** `decisionKind` MUST 是冻结路由决策种类之一
- **AND** `safeReason` MUST 存在
- **AND** `skillName` MAY 缺失

#### Scenario: 存在不可信 scope 覆盖
- **WHEN** request body、model 输出、capability 参数或客户端 metadata 包含 tenant、subject、owner、provider 覆盖、原始 system prompt 或 Agent 覆盖字段
- **THEN** 路由 policy MUST 为路由权限忽略这些字段
- **AND** 它 MUST 只继续基于可信的 Agent Scope 和 Owner Scope 事实

### Requirement: Routing core 发出安全的下游命令
在初始 routing-core 实现中，路由决策 SHALL 被翻译为用于 context assembly、model 调用或安全拒绝的安全下游命令。确定性 flow、pending 输入或人工接手的翻译 SHALL 保持为留给后续 change 的边界，除非那些 change 定义了受治理的选择规则。路由决策本身 SHALL NOT 作为用户会话内容被持久化。

#### Scenario: 路由选择 model 驱动循环
- **WHEN** 路由 policy 选择 model 驱动循环
- **THEN** Agent Core MUST 以选定的 purpose、locale、request 事实和 request 本地 capability 状态调用 Context Engine
- **AND** Context Engine 和 Model MUST 只接收从已接受 request scope 派生的受治理 model/capability context

#### Scenario: 路由选择拒绝
- **WHEN** 路由 policy 选择 reject
- **THEN** Agent Core MUST 通过安全错误或安全终态结果结束
- **AND** 该拒绝 MUST NOT 暴露 policy 内部细节、原始 prompt、原始 capability 细节或原始 provider 错误

#### Scenario: Policy 结果携带命名的 Skill 目标
- **WHEN** policy 路由结果包含 `skillName`
- **THEN** Agent Core MUST 把该字段视为从可信 policy 输出派生的受控路由目标
- **AND** 它 MUST 只通过受治理的下游路由行为翻译它
- **AND** 它 MUST NOT 将其重新解释为直接的用户授权或绕过 capability 治理

#### Scenario: Skill 目标在 model 循环之前被加载
- **WHEN** 路由决策携带 `skillName`
- **THEN** Agent Core MUST 首先为该 Skill 目标执行受治理的 Skill 加载路径
- **AND** 来自 Skill 加载的生成消息或 context 补丁 MUST 合并到 request 本地状态
- **AND** 随后该请求 MUST 继续进入既有 Context Engine 和 Model 路径，除非后续受治理 change 定义了其他终态行为

### Requirement: Routing core 在 policy 依赖不可用时 fail closed
如果路由 policy 无法加载所需的可信输入或无法产生有效决策，Agent Core SHALL fail closed 或使用显式配置的安全默认路径。它 SHALL NOT 静默选择任意的 model、Tool、Skill、Agent capability 或确定性 flow。

#### Scenario: 冻结 assembly 无法加载
- **WHEN** Agent Core 无法加载已接受的 `AgentAssembly`
- **THEN** 路由 MUST 以安全的不可用/内部错误失败
- **AND** 它 MUST NOT 回退到活跃 Agent version

#### Scenario: Capability 治理视图不可用
- **WHEN** 路由需要当前受治理的 capability 视图且该依赖不可用
- **THEN** 路由 MUST 以安全的不可用/内部错误 fail closed
- **AND** 它 MUST NOT 直接从原始 binding 或未治理的 descriptor 调用 capability

### Requirement: Routing core 可观测且不暴露内部细节
Agent routing core SHALL 为 audit/log/trace 消费方暴露安全的决策结果钩子，而详细证据语义由 `routing-evidence-and-fallback` 拥有。

#### Scenario: 路由路径被选择
- **WHEN** 路由 policy 选择任何受控路径
- **THEN** Agent Core MUST 向 observability 边界提供安全的路由结果
- **AND** 用户可见的 stream/history 默认 MUST NOT 暴露路由候选、policy 内部细节或隐藏路由状态
