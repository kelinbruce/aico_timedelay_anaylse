## Function

- **所属 Function**：`FN-2.5 请求自动路由`、`FN-10.3 自定义路由策略`
- **Function 变更类型**：`MODIFIED`
- **spec 角色**：主规格

## ADDED Requirements

### Requirement: 显式路由指定优先于路由策略实现

Agent Core SHALL 在调用任何路由策略实现（built-in 或 plugin）之前，先执行显式路由解析。显式路由解析在请求受理后、context assembly / model invocation / capability invocation 之前同步触发，由 Agent 执行入口（`executeRun`）在路由决策阶段调用，异步契约返回 `Promise<AgentRoutingDecision>` 并接收 `AbortSignal`。

显式路由解析的输入包括：`RequestRun` 上的 frozen `agentId` / `agentVersion` / `agentAssemblyRef`（Agent Scope）、`RequestContext.acceptedInputText`（已被 `normalizeCapabilityDirectiveInput` 在 runtime composition 层剥离指令 token）、`RequestContext.routingConstraints`（含 directive-derived `targetSkill` / `targetRecipe`）、`RequestContext.identityContext`（`tenantId` / `subjectId`，用于 capability governance）、`RequestContext.locale`、accepted `AgentAssembly`（含 `routing.mode` / `routing.policy` 配置）和 `AbortSignal`。前置条件：`normalizeCapabilityDirectiveInput` 必须已在 runtime composition 层执行完毕，使指令 token 已从 `acceptedInputText` 中剥离并投影为 `routingConstraints` 字段。

显式路由指定包括：用户通过 `$skill:` / `$workflow:` 指令表达的意图、request 携带的 `targetRecipe` / `targetSkill` 约束、以及 Agent 配置的 `routing.mode=policy` 规则。显式路由解析按以下顺序短路求值，首个命中的条件直接产生路由决策：

1. abort/assembly/capability 守卫
2. `$skill:` / `$workflow:` 指令解析与冲突处理
3. `targetRecipe` 约束解析与 capability governance
4. `targetSkill` 约束检测
5. `mode=policy` 规则匹配（含 target 可用性校验）

当显式指定命中时（指令命中、约束命中、policy 规则匹配），Agent Core MUST 直接采用该决策，并且 MUST NOT 调用任何路由策略实现。当显式指定 miss 时（指令目标不可用、约束目标不可用、policy 规则命中但 target 不可用），Agent Core MUST 直接降级到 `MODEL_DRIVEN_LOOP`，并且 MUST NOT 调用任何路由策略实现。当 `mode=policy` 规则全部未匹配或 Agent 未配置 `mode=policy` 时，Agent Core SHALL 委托给路由策略实现：存在 enabled plugin binding 时调用 plugin policy；否则调用 built-in routing policy。显式路由解析的解析规则、冲突处理、miss 降级和 fail-closed 行为 MUST 与 `directive-capability-routing`、`routing-constraint-validation`、`targeted-skill-routing` 和 `workflow-routing` spec 定义一致。

显式路由解析产生 `AgentRoutingDecision`（`kind` / `safeReason` / `acceptedAssembly` / 可选 `skillName` / `recipeName`），并通过 `RoutingEvidenceRecorder` 产出 `POLICY_APPLIED` timeline-only 事件记录最终决策的 `safeReason`。决策为 request-scoped，不持久化为用户对话内容。上游是 runtime 请求受理（`submit` → `executeRun`）；下游消费方为 `translateRoutingDecision`，根据决策 kind 分发到 `executeRecipeRoute`（`DETERMINISTIC_FLOW` + `recipeName`）、`TargetedSkillRouter`（`DETERMINISTIC_FLOW` + `skillName` 或 `BEFORE_MODEL_INVOKE` 阶段的 `targetSkill` 约束）、model loop（`MODEL_DRIVEN_LOOP`）或 safe rejection（`REJECT`）。

**需求类别**：系统质量属性

**质量属性**：安全

**适用范围**：`FN-2.5 请求自动路由`、`FN-10.3 自定义路由策略`

#### Scenario: 插件激活时 skill 指令命中由框架处理

- **WHEN** Agent 配置了 enabled `agentRoutingPolicy` plugin binding
- **AND** 用户输入包含 `$skill:alarm-diagnosis` 指令
- **AND** normalization 后该 Skill 在当前 Agent Scope 下可用且未禁止
- **THEN** Agent Core MUST 在显式路由解析阶段产生 `DETERMINISTIC_FLOW` 决策
- **AND** plugin routing policy MUST NOT 被调用
- **AND** 路由证据 MUST 记录既有安全原因码 `CAPABILITY_DIRECTIVE_SKILL_MATCHED`

#### Scenario: 插件激活时 workflow 指令命中由框架处理

- **WHEN** Agent 配置了 enabled `agentRoutingPolicy` plugin binding
- **AND** 用户输入包含 `$workflow:push-gate` 指令
- **AND** `push-gate` 在当前 Agent Scope 下是可用的 `WORKFLOW` capability
- **THEN** Agent Core MUST 在显式路由解析阶段产生 `DETERMINISTIC_FLOW` 决策
- **AND** plugin routing policy MUST NOT 被调用
- **AND** 路由证据 MUST 记录安全原因码 `CAPABILITY_DIRECTIVE_WORKFLOW_MATCHED`

#### Scenario: 插件激活时指令 miss 降级到 model loop

- **WHEN** Agent 配置了 enabled `agentRoutingPolicy` plugin binding
- **AND** 用户输入包含 `$workflow:push-gate` 指令
- **AND** `push-gate` 在当前 Agent Scope 下不是 `WORKFLOW` capability
- **THEN** Agent Core MUST 在显式路由解析阶段降级为 `MODEL_DRIVEN_LOOP`
- **AND** plugin routing policy MUST NOT 被调用
- **AND** 路由证据 MUST 记录安全原因码 `CAPABILITY_DIRECTIVE_WORKFLOW_MISS_FALLBACK`

#### Scenario: 插件激活时指令冲突由框架 fail-closed

- **WHEN** Agent 配置了 enabled `agentRoutingPolicy` plugin binding
- **AND** 用户输入同时包含 `$skill:alarm-diagnosis` 和 `$workflow:push-gate`
- **THEN** Agent Core MUST 在显式路由解析阶段产生 `REJECT` 决策
- **AND** plugin routing policy MUST NOT 被调用
- **AND** 路由证据 MUST 记录安全原因码 `CAPABILITY_DIRECTIVE_AMBIGUOUS`

#### Scenario: 插件激活时 targetRecipe 约束命中由框架处理

- **WHEN** Agent 配置了 enabled `agentRoutingPolicy` plugin binding
- **AND** request 携带 trusted `routingConstraints.targetRecipe=ran-alarm-diagnosis`
- **AND** 该 recipe 在当前 Agent Scope 下可用
- **THEN** Agent Core MUST 在显式路由解析阶段产生 `DETERMINISTIC_FLOW` 决策
- **AND** plugin routing policy MUST NOT 被调用

#### Scenario: 插件激活时 targetSkill 约束由框架处理

- **WHEN** Agent 配置了 enabled `agentRoutingPolicy` plugin binding
- **AND** request 携带 trusted `routingConstraints.targetSkill=alarm-diagnosis`
- **THEN** Agent Core MUST 在显式路由解析阶段产生 `MODEL_DRIVEN_LOOP` 决策
- **AND** plugin routing policy MUST NOT 被调用
- **AND** 路由证据 MUST 记录安全原因码 `POLICY_RULE_TARGET_SKILL_PRIORITY`

#### Scenario: 插件激活时 policy 规则匹配由框架处理

- **WHEN** Agent 配置了 enabled `agentRoutingPolicy` plugin binding
- **AND** Agent 配置了 `routing.mode=policy` 且有 regex 规则
- **AND** 首条匹配规则的目标 Skill 或 Workflow 在当前 Agent Scope 下可用
- **THEN** Agent Core MUST 在显式路由解析阶段产生 `DETERMINISTIC_FLOW` 决策
- **AND** plugin routing policy MUST NOT 被调用

#### Scenario: 插件激活时 policy 规则命中但 target 不可用由框架降级

- **WHEN** Agent 配置了 enabled `agentRoutingPolicy` plugin binding
- **AND** Agent 配置了 `routing.mode=policy` 且有 regex 规则
- **AND** 首条匹配规则的目标 Skill 或 Workflow 在当前 Agent Scope 下不可用
- **THEN** Agent Core MUST 在显式路由解析阶段降级为 `MODEL_DRIVEN_LOOP`
- **AND** plugin routing policy MUST NOT 被调用
- **AND** 路由证据 MUST 记录安全原因码 `POLICY_RULE_SKILL_MISS_FALLBACK` 或 `POLICY_RULE_WORKFLOW_MISS_FALLBACK`

#### Scenario: 插件激活时 policy 规则未匹配时委托给插件

- **WHEN** Agent 配置了 enabled `agentRoutingPolicy` plugin binding
- **AND** Agent 配置了 `routing.mode=policy` 且有 regex 规则
- **AND** 全部规则均未匹配 accepted input text
- **THEN** Agent Core MUST 委托给 plugin routing policy
- **AND** plugin 接收的 `RequestContext` 与既有契约保持一致

#### Scenario: 无显式指定时委托给插件

- **WHEN** Agent 配置了 enabled `agentRoutingPolicy` plugin binding
- **AND** accepted request text 不包含 `$skill:` 或 `$workflow:` 指令
- **AND** request 不携带 `targetRecipe` 或 `targetSkill` 约束
- **AND** Agent 未配置 `routing.mode=policy` 或配置了但无规则
- **THEN** Agent Core MUST 委托给 plugin routing policy

#### Scenario: 无插件且无显式指定时使用 built-in 默认路由

- **WHEN** Agent 未配置 enabled `agentRoutingPolicy` plugin binding
- **AND** 无显式指定（无指令、无约束、无 policy 规则或规则未匹配）
- **THEN** Agent Core MUST 使用 built-in 默认路由 `MODEL_DRIVEN_LOOP`

#### Scenario: 显式路由不因路由策略实现不同而改变

- **WHEN** 两个 Agent 配置了不同的路由策略实现（一个使用 plugin，一个使用 built-in）
- **AND** 两个 Agent 收到相同的含 `$skill:alarm-diagnosis` 指令的请求
- **AND** 该 Skill 在两个 Agent Scope 下均可用
- **THEN** 两个 Agent 的显式路由解析 MUST 产生相同的路由决策 kind 和安全原因码

#### Scenario: 守卫失败时不调用路由策略实现

- **WHEN** Agent 配置了 enabled `agentRoutingPolicy` plugin binding
- **AND** AbortSignal 已取消、frozen assembly 加载失败或 capability governance view 不可用
- **THEN** Agent Core MUST 抛出安全错误（`ROUTING_ABORTED` / `ROUTING_ASSEMBLY_UNAVAILABLE` / `ROUTING_CAPABILITY_VIEW_UNAVAILABLE`）
- **AND** plugin routing policy MUST NOT 被调用

## Function 变更汇总

### 描述

- **变更类型**：修改
- **目标内容**：路由优先级从"路由策略实现拥有全部决策权"变为"显式指定优先于路由策略实现"。指令、约束和 policy 规则在任何路由策略实现之前执行，命中或 miss 时路由策略实现不被调用。
- **依据 Requirements**：`显式路由指定优先于路由策略实现`

### 处理过程

- **变更类型**：修改
- **目标内容**：请求受理后，Agent Core 先执行显式路由解析（守卫、指令解析与冲突处理、targetRecipe/targetSkill 约束解析、mode=policy 规则匹配）。命中时直接采用决策；miss 时直接降级到 MODEL_DRIVEN_LOOP；policy 规则未匹配或无显式指定时委托给路由策略实现（plugin 优先，无 plugin 时用 built-in 默认）。
- **依据 Requirements**：`显式路由指定优先于路由策略实现`

### 规格

- **规格项**：显式路由优先级
- **变更类型**：新增
- **原规格值**：不适用（新增）
- **目标规格值**：显式指定（指令、约束、policy 规则）MUST 先于路由策略实现执行；命中或 miss 时路由策略实现 MUST NOT 被调用；policy 规则未匹配或无显式指定时委托给路由策略实现
- **依据 Requirements**：`显式路由指定优先于路由策略实现`
