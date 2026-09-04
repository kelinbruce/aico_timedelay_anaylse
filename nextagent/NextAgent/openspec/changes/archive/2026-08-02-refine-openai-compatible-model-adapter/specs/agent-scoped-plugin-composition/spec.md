## Function

- **所属 Function**：`FN-10.2 装配插件`
- **Function 变更类型**：`MODIFIED`
- **spec 角色**：主规格

## MODIFIED Requirements

### Requirement: Policy plugins use an explicit open policy inventory

系统 SHALL 定义面向智能体二次开发者的开放 policy 清单。每个 policy point MUST 声明稳定 policy point id、状态、owning module、固定 executable contract、timeout 来源、failure semantics、安全观测事实和是否允许 Agent-scoped plugin replacement。插件 manifest 和 Agent 配置 MUST 只引用开放 policy 清单中的 policy point id。

`agent-plugin-sdk` SHALL 为同一清单暴露面向 plugin 的开放 policy authoring surface。它 MUST 导出开放 policy point id vocabulary、通用 `PluginPolicy` contribution shape、`agentRoutingPolicy` authoring helper `defineAgentRoutingPolicy(...)`，以及 `OPEN` policy point 对应的 `AgentRoutingPolicy`、`AgentRoutingPolicyExecutable` 和 `AgentRoutingPolicyResult` type。SDK MAY 从 `agent-contracts` subpath re-export durable public contract type，但 MUST NOT 依赖 `agent-core` 实现或拥有 policy runtime execution。`RESERVED` policy point id MAY 作为不可激活条目出现在 SDK inventory metadata 中，但 SDK MUST NOT 为 `RESERVED` policy point 提供 implementation helper。

policy point 状态 SHALL 只包含 `OPEN` 和 `RESERVED`。`OPEN` policy point MAY 由插件实现并由 Agent 激活；`RESERVED` policy point MUST NOT 被激活，只有 owning spec 冻结 executable contract 并将状态变更为 `OPEN` 后才 MAY 开放。

首版开放 policy 清单 SHALL 精确包含以下条目：

| policy point id | status | owner | contract | 触发边界 | 插件失败语义 |
| --- | --- | --- | --- | --- | --- |
| `restrictedOperationPolicy` | `RESERVED` | `agent-runtime` | 未冻结；状态变更为 `OPEN` 前 MUST NOT 提供 executable contract | 受限操作执行前，包括 capability invocation、sandbox dynamic execution 和 authorization/high-risk confirmation 的 risk policy enforcement 边界 | MUST NOT 激活 |
| `agentRoutingPolicy` | `OPEN` | `agent-core` | existing core `AgentRoutingPolicy.decide(RequestRun, RequestContext, AbortSignal)` / `AgentRoutingPolicyResult`; result SHALL align with `agent-contracts/core.AgentRoutingDecision` | 请求进入 Agent 后选择模型循环、定向 Skill/Workflow、澄清、拒绝或人机接管等处理路径 | fail closed to safe routing rejection |
| `modelSelectionPolicy` | `RESERVED` | `agent-context-engine` | 未冻结；状态变更为 `OPEN` 前 MUST NOT 提供 executable contract | 为主 Agent loop、summary、memory、session 辅助和 workflow 等模型调用目的，从当前 Agent 激活模型集合中选择 initial 或 fallback profile | MUST NOT 激活 |
| `modelFallbackPolicy` | `RESERVED` | `agent-core` / `agent-context-engine` | 未冻结；状态变更为 `OPEN` 前 MUST NOT 提供 executable contract。前者只拥有 fallback lifecycle gate，后者拥有 fallback model selection | 模型调用失败、超时、限流或不可用后决定是否允许 fallback，并在允许时选择下一模型 | MUST NOT 激活 |
| `contextWindowPolicy` | `RESERVED` | `agent-context-engine` | 未冻结；状态变更为 `OPEN` 前 MUST NOT 提供 executable contract | 在模型上下文窗口内分配 history、attachment、Skill disclosure、system prompt、summary 等预算 | MUST NOT 激活 |

可激活 policy point set SHALL 恰好等于上表中的 `OPEN` 条目。`redactionPolicy`、`promptAssemblyPolicy`、`capabilityConflictResolutionPolicy`、`observabilityProjectionPolicy`、`authorizationAnswerPolicy` 和 `gatewayRetryPolicy` 属于非目标边界。

`agentRoutingPolicy` SHALL 使用由 `agent-core` 拥有且仅通过 public contract subpath 暴露的既有 core routing policy executable contract：`decide(run: RequestRun, context: RequestContext, signal: AbortSignal)`。`agentAssemblyRef` MUST 保持为 `RequestRun` 上 accepted request 的 frozen assembly ref。`acceptedInputText` MUST 与当前 routing policy baseline 消费的既有 `RequestContext.acceptedInputText` 保持相同名称和语义；core routing adapter MUST 原样传递该字段，不增加 summary、redaction、truncation 或 wrapper-level field projection。未来若收窄该输入边界，收窄规则 MUST 在 routing business contract 中定义，并 MUST 同等适用于 built-in 和 plugin routing policy。

`AgentRoutingPolicyResult` SHALL 使用 `agent-contracts/core` 的 public `AgentRoutingDecision` shape：`kind: RoutingDecisionKind`、`safeReason: string`、可选 `evidenceRef?: string` 和可选 `skillName?: string`。允许的 `kind` 值是既有 `RoutingDecisionKind` vocabulary：`DETERMINISTIC_FLOW`、`MODEL_DRIVEN_LOOP`、`CLARIFY`、`REJECT` 和 `HUMAN_HANDOFF`。系统 SHALL NOT 增加 plugin-specific routing result field。accepted assembly materialization 或 recipe/workflow implementation detail 等内部 `agent-core` routing field 保持在 `agent-core` 内部，并 SHALL 由 core routing adapter 或 routing implementation 增加，而不是由 plugin evaluator 返回。

除 `decide(...)` 和 `timeoutMs` 外，`AgentRoutingPolicy` implementation object MAY 声明 `configSchema` 和 `configure(config)`。`configure(config)` SHALL 返回带有 `decide(...)` 的 `AgentRoutingPolicyExecutable`。存在 `configSchema` 时，`AgentAssembly.policies.config` MUST 根据该 schema 校验，并 SHALL 仅由 runtime startup materialization 用于创建 assembly-specific policy executable。raw policy config MUST NOT 加入 routing policy execution input。

`agent-runtime` SHALL 根据 app composition 提供的 frozen plugin policy contribution materialize startup policy registry/resolver。该 materialization 只在 startup/assembly-scoped materialization 和 lookup 方面与 lifecycle hook materialization 同形：startup policy implementation 生成 default executable，带 config 的 accepted `AgentAssembly.policies` activation 生成以 `agentAssemblyRef + policyPointId + pluginId + policyId` 为 key 的 assembly-specific configured executable。plugin loading、Agent assembly compilation 或 policy registry materialization 期间，非法 policy activation reference、同一 policy point 的重复 enabled activation、非法 config 或不可用 executable implementation MUST 在 app/request readiness 前失败。resolver SHALL 接收 accepted Agent scope facts（`agentId`、`agentVersion`、`agentAssemblyRef`）和 `policyPointId`，加载 accepted Agent assembly，校验 assembly ref，选择该 assembly 针对请求 policy point 的 enabled `AgentAssembly.policies` binding，并从 assembly-specific executable map 或 fallback startup executable 解析具体 executable。存在 enabled binding 时，policy point lookup SHALL 返回 resolved policy entry；没有激活 binding 时 SHALL 返回 `undefined`。registry/resolver MUST 是可枚举 `AgentPolicyExecutableByPoint` mapping 上的 container 和 lookup mechanism：它 MUST 保留每个 policy point 自身的 executable shape，而不是强制全部 policy point 使用 `agentRoutingPolicy` input/output 或 method shape。每个 policy point owner SHALL 在执行前提供自己的 typed adapter。系统 SHALL 只通过 routing typed adapter 执行 `agentRoutingPolicy` 这一 `OPEN` point，`RESERVED` point 保持不可激活。

core `agentRoutingPolicy` adapter SHALL 在调用系统 built-in routing policy 前调用注入的 policy resolver。存在 enabled plugin binding 时，adapter MUST 直接评估 resolved plugin policy，并且 MUST NOT 先调用 built-in routing policy。当 `AgentAssembly.policies` 缺失、为空、不包含 enabled `agentRoutingPolicy` binding，或 Agent 没有 `policies` config 时，adapter MUST 委托给系统 built-in routing policy。adapter MUST NOT 为不可用 plugin policy activation 增加第三种 runtime routing state；非法 activation 或 registry materialization MUST 在请求执行前被拒绝，而 plugin policy execution failure、timeout 或非法结果 MUST fail closed 为安全 routing rejection。`agent-core` SHALL 把 policy resolver 作为 runtime dependency 接收，并且 MUST NOT 读取 plugin config、plugin registry、plugin path 或 Agent raw config 来选择 plugin evaluator。

**需求类别**：功能性需求

#### Scenario: Agent 激活开放 routing policy
- **WHEN** 插件 manifest 贡献 `policyPointId="agentRoutingPolicy"` 的 implementation
- **AND** Agent `policies` 配置显式激活该 policy implementation
- **AND** `agent-app` 将该 activation 编译为 `AgentAssembly.policies` 中的 implementation-free binding fact
- **THEN** plugin loader MUST 根据开放 policy inventory 校验 contribution
- **AND** app/runtime composition MUST 为 accepted `agentAssemblyRef` materialize configured executable
- **AND** Agent core SHALL 通过 `agentRoutingPolicy` adapter 解析并调用 plugin routing policy
- **AND** runtime、capability、model 和 channel path SHALL 通过 core routing adapter 获得 selected routing behavior
- **AND** routing policy adapter MUST 使用注入的 policy resolver，根据 accepted Agent 的 `AgentAssembly.policies` 和 runtime implementation registry 选择 implementation
- **AND** 该 implementation 的失败、timeout 或非法输出 MUST fail closed 为安全 routing rejection

#### Scenario: 未激活 routing policy 的 Agent 使用 built-in routing
- **WHEN** accepted Agent 的 `AgentAssembly.policies` 缺失、为空或不包含 enabled `agentRoutingPolicy` binding
- **THEN** core routing policy adapter MUST 委托给系统 built-in routing policy
- **AND** `agent-core` MUST NOT 读取 plugin registry 或 raw Agent config 来选择 plugin evaluator

#### Scenario: 拒绝 Reserved policy point
- **WHEN** 插件 manifest 或 Agent 配置引用 `restrictedOperationPolicy`、`modelSelectionPolicy`、`modelFallbackPolicy` 或 `contextWindowPolicy`
- **THEN** 系统 MUST 拒绝该 plugin policy 或 Agent activation
- **AND** 系统 MUST 产生 safe diagnostic，说明该 policy point 为 `RESERVED`
- **AND** policy point 处于 `RESERVED` 时，execution path creation SHALL 保持不可用

#### Scenario: 拒绝未知 policy point
- **WHEN** 插件 manifest 或 Agent 配置引用 `redactionPolicy`、`promptAssemblyPolicy` 或任何不在开放 policy 清单中的 policy point id
- **THEN** 系统 MUST 拒绝该 plugin policy 或 Agent activation
- **AND** 系统 MUST 产生 safe diagnostic
- **AND** policy execution path creation SHALL 仅限开放 inventory 条目

## Function 变更汇总

### 输出

- **变更类型**：修改
- **目标内容**：开放 policy inventory 中，`modelSelectionPolicy` 的 owner 调整为 `agent-context-engine`；`modelFallbackPolicy` 的 owner 调整为 `agent-core` / `agent-context-engine`，分别表示 fallback lifecycle gate 与 fallback model selection。两者继续保持 `RESERVED`，不产生 implementation helper、executable binding 或运行期执行路径；其余 policy point 的状态、owner、契约和行为不变。
- **依据 Requirements**：`Policy plugins use an explicit open policy inventory`

### 主规格

- **变更类型**：修改
- **目标内容**：`agent-scoped-plugin-composition`
- **依据 Requirements**：`Policy plugins use an explicit open policy inventory`

### 遗留规格

- **变更类型**：修改
- **目标内容**：遗留规格为 `extension-registration`。
- **依据 Requirements**：`Policy plugins use an explicit open policy inventory`
