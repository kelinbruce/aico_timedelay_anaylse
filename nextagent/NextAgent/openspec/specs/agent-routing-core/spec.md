 agent-routing-core Specification

## Purpose
Define the long-term Agent-internal routing-policy boundary that selects governed handling paths after runtime acceptance and before downstream context, model, capability, rejection, clarification, or handoff execution.
## Requirements
### Requirement: Agent internal routing policy selects handling paths
Agent Core SHALL execute a routing policy inside the Agent boundary after runtime accepts a request and before the request enters context assembly, model invocation, capability invocation, rejection, clarification, or human handoff.

#### Scenario: Model-driven path is selected by Agent routing
- **WHEN** runtime accepts a request and invokes the Agent boundary with frozen `agentId`, `agentVersion`, `agentAssemblyRef`, identity, locale, session, run, and request facts
- **THEN** Agent Core MUST execute routing policy before the first context/model/capability handling step
- **AND** the policy MAY select the model-driven loop path
- **AND** runtime MUST NOT select the model-driven business path on behalf of Agent Core

#### Scenario: No specialized route is defined
- **WHEN** runtime accepts a normal request and no later change has installed a governed deterministic, clarification, or handoff rule
- **THEN** Agent routing policy MUST select the model-driven loop path
- **AND** channel and runtime MUST NOT bypass the Agent boundary to execute a business path

### Requirement: Routing decision vocabulary reuses frozen core contract
Agent routing policy SHALL produce only routing decision kinds that already exist in the frozen core contract for this change: deterministic flow, model-driven loop, clarify, reject, or human handoff. This change SHALL NOT add a new public routing decision kind. The initial routing-core implementation SHALL select only model-driven loop for accepted normal requests, or reject/fail closed for invalid or unavailable trusted inputs.

#### Scenario: Unsupported decision kind is produced
- **WHEN** a routing policy implementation produces a decision kind outside the controlled vocabulary
- **THEN** Agent Core MUST reject the decision with a safe internal policy error
- **AND** it MUST NOT reinterpret the unknown decision as a capability invocation or model loop

#### Scenario: Deferred decision kind is not implemented yet
- **WHEN** the initial routing-core implementation has no governed rule for deterministic flow, clarify, or human handoff
- **THEN** it MUST NOT invent ad hoc selection rules for those decision kinds
- **AND** it MUST continue with model-driven loop or fail closed according to the trusted input state

### Requirement: Routing policy consumes frozen request and assembly facts
Routing policy SHALL consume the runtime-accepted `RequestRun`, `RequestContext`, frozen `AgentAssembly`, routing rule configuration from trusted Agent configuration sources, governed capability view, visible model profile facts, locale, security context, cancellation context, and any typed routing constraints made available by an accepted contract refinement. It SHALL NOT use client body, model output, capability args, or untrusted metadata to override Agent Scope or Owner Scope.

#### Scenario: Accepted input text is available to routing policy
- **WHEN** runtime accepts a request and enters Agent routing
- **THEN** `RequestContext` MUST include the accepted user input text as a runtime-owned routing input fact
- **AND** that fact MUST represent the accepted request text for the current run
- **AND** it MUST NOT grant any authority beyond routing input evaluation

### Requirement: Policy routing uses controlled input and output contracts
When routing rule configuration declares `mode=policy`, Agent routing policy SHALL consume only controlled policy input facts and SHALL preserve a controlled policy routing result boundary. Policy routing MAY target existing governed Skill and Workflow paths through fixed trusted rule output fields only. A matched rule target SHALL be resolved through the governed capability view before it becomes a deterministic routing result, and a trusted per-request routing constraint SHALL outrank configured rules.

**需求类别**：功能性需求

#### Scenario: Policy mode declares ordered regex rules
- **WHEN** trusted Agent configuration declares `mode=policy`
- **THEN** `policy` MAY include an ordered `rules` array
- **AND** each rule MUST contain a non-empty `reg` regex source
- **AND** each rule MUST contain a `target.kind` of `SKILL` or `WORKFLOW`
- **AND** each rule MUST contain a non-empty `target.name`

#### Scenario: Policy mode matches the first regex rule
- **WHEN** `mode=policy` evaluation executes with multiple rules
- **THEN** the router MUST evaluate them in configuration order
- **AND** the first matching regex rule MUST determine the controlled routing target
- **AND** later rules MUST NOT override an earlier match

#### Scenario: 命中的 SKILL 规则目标可用
- **WHEN** 首条命中规则的 `target.kind` 为 `SKILL`
- **AND** 治理后的 capability 视图把该 `target.name` 解析为可用且 kind 为 `SKILL` 的 capability
- **THEN** 路由策略 MUST 产出携带 `skillName` 的确定性路由结果
- **AND** 系统 MUST 继续走既有受治理 Skill 加载路径

#### Scenario: 命中的 SKILL 规则目标不可用
- **WHEN** 首条命中规则的 `target.kind` 为 `SKILL`
- **AND** 治理后的 capability 视图未把该 `target.name` 解析为可用且 kind 为 `SKILL` 的 capability
- **THEN** 路由策略 MUST 降级到模型驱动循环并给出安全的未命中原因
- **AND** MUST NOT 因为该配置目标不可用而使已受理请求失败
- **AND** MUST NOT 用其他 Skill、Tool、Agent 或 Workflow capability 替换该目标

#### Scenario: 命中的 WORKFLOW 规则目标可用
- **WHEN** 首条命中规则的 `target.kind` 为 `WORKFLOW`
- **AND** 治理后的 capability 视图把该 `target.name` 解析为可用且 kind 为 `WORKFLOW` 的 capability
- **THEN** 路由策略 MUST 产出携带 `recipeName` 的确定性路由结果
- **AND** 系统 MUST 继续走既有受治理 workflow 路由路径

#### Scenario: 显式可信路由约束优先于配置规则
- **WHEN** 配置为 `mode=policy` 且受理请求携带可信的定向 Skill 路由约束
- **THEN** 路由策略 MUST NOT 为该请求评估配置规则
- **AND** MUST 降级到模型驱动循环并给出安全的优先级原因
- **AND** 该可信定向 Skill MUST 仍由既有受治理 Skill 加载路径恰好服务一次

#### Scenario: Policy regex rules do not match
- **WHEN** `mode=policy` is configured and no regex rule matches the accepted input text
- **THEN** routing policy MUST fall back to the model-driven loop path
- **AND** it MUST NOT invent an arbitrary Skill or Workflow target

#### Scenario: Trusted regex configuration is invalid
- **WHEN** trusted policy configuration contains an invalid regex source or invalid target shape
- **THEN** routing policy MUST fail closed with a safe policy configuration error
- **AND** it MUST NOT enter model, workflow, or capability execution as a fallback for that invalid configuration

### Requirement: Routing core emits safe downstream commands
Routing decisions SHALL be translated into safe downstream commands for context assembly, model invocation, or safe rejection in the initial routing-core implementation. Translation for deterministic flow, pending input, or human handoff SHALL remain a boundary reserved for later changes unless those changes define the governed selection rule. The routing decision itself SHALL NOT be persisted as user conversation content.

**需求类别**：功能性需求

#### Scenario: Routing selects model-driven loop
- **WHEN** routing policy selects model-driven loop
- **THEN** Agent Core MUST call Context Engine with the selected purpose, locale, request facts, and request-local capability state
- **AND** Context Engine and Model MUST receive only governed model/capability context derived from the accepted request scope

#### Scenario: Routing selects rejection
- **WHEN** routing policy selects reject
- **THEN** Agent Core MUST end through a safe error or safe terminal result
- **AND** the rejection MUST NOT expose policy internals, raw prompt, raw capability details, or raw provider errors

#### Scenario: Policy result carries a named Skill target
- **WHEN** policy routing result includes `skillName`
- **THEN** Agent Core MUST treat that field as a controlled routing target derived from trusted policy output
- **AND** it MUST translate it only through governed downstream routing behavior
- **AND** it MUST NOT reinterpret it as direct user authorization or bypass capability governance

#### Scenario: Skill target is loaded before the model loop
- **WHEN** routing decision carries `skillName`
- **THEN** Agent Core MUST first execute a governed Skill loading path for that Skill target
- **AND** generated messages or context patches from the Skill load MUST merge into request-local state
- **AND** the request MUST then continue into the existing Context Engine and Model path unless a later governed change defines another terminal behavior

#### Scenario: 可信路由目标的 Skill 加载不依赖模型侧发现
- **WHEN** 系统为可信路由目标执行受治理 Skill 加载路径
- **THEN** MUST 在受理的 Agent Scope、Owner Scope 和会话作用域内通过治理后的 capability 视图解析该 Skill
- **AND** MUST 把该已治理 Skill 声明为本次定向调用的已披露 Skill
- **AND** 该加载 MUST NOT 额外要求先完成模型侧的 capability 发现步骤
- **AND** 该披露 MUST NOT 扩大模型发起的 capability 调用可加载的范围

#### Scenario: Policy regex target selects Workflow
- **WHEN** the first matching rule targets `WORKFLOW`
- **THEN** routing policy MUST produce a controlled deterministic routing result with `recipeName`
- **AND** Agent Core MUST continue through the existing governed workflow routing path

#### Scenario: Policy regex rules do not match
- **WHEN** `mode=policy` is configured and no regex rule matches the accepted input text
- **THEN** routing policy MUST fall back to the model-driven loop path
- **AND** it MUST NOT invent an arbitrary Skill or Workflow target

#### Scenario: Trusted regex configuration is invalid
- **WHEN** trusted policy configuration contains an invalid regex source or invalid target shape
- **THEN** routing policy MUST fail closed with a safe policy configuration error
- **AND** it MUST NOT enter model, workflow, or capability execution as a fallback for that invalid configuration

### Requirement: Routing core fails closed on unavailable policy dependencies
If routing policy cannot load required trusted inputs or cannot produce a valid decision, Agent Core SHALL fail closed or use an explicitly configured safe default path. It SHALL NOT silently choose an arbitrary model, Tool, Skill, Agent capability, or deterministic flow.

#### Scenario: Frozen assembly cannot be loaded
- **WHEN** Agent Core cannot load the accepted `AgentAssembly`
- **THEN** routing MUST fail with a safe unavailable/internal error
- **AND** it MUST NOT fall back to the active Agent version

#### Scenario: Capability governance view is unavailable
- **WHEN** routing requires the current governed capability view and that dependency is unavailable
- **THEN** routing MUST fail closed with a safe unavailable/internal error
- **AND** it MUST NOT call a capability directly from raw bindings or ungoverned descriptors

### Requirement: Routing core is observable without exposing internals
Agent routing core SHALL expose safe decision outcome hooks for audit/log/trace consumers, while detailed evidence semantics are owned by `routing-evidence-and-fallback`.

#### Scenario: Routing path is selected
- **WHEN** routing policy selects any controlled path
- **THEN** Agent Core MUST make a safe routing outcome available to the observability boundary
- **AND** user-visible stream/history MUST NOT expose routing candidates, policy internals, or hidden routing state by default

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

### Requirement: agent-router-plugin按配置限制目标类型

`agent-router-plugin` 的 Agent policy config MUST 接受 optional `selectionMode`，允许值 MUST 恰好为 `SKILL`、`WORKFLOW`、`SKILL_OR_WORKFLOW`，省略时 MUST 默认为 `SKILL_OR_WORKFLOW`。系统 MUST 在 capability 可用性治理与可选 RAG 预筛之前应用该配置：`SKILL` MUST 排除全部 `WORKFLOW` bindings，`WORKFLOW` MUST 排除全部 `SKILL` bindings，`SKILL_OR_WORKFLOW` MUST 保留两类 enabled bindings。客户端字段、accepted user input、模型输出、Capability 参数或 RAG 结果 MUST NOT 改写 `selectionMode`。

**需求类别**：功能性需求

#### Scenario: 只选择Skill

- **GIVEN** Agent policy config 声明 `selectionMode=SKILL`
- **WHEN** 当前 Agent 同时存在可用的 enabled Skill 与 Workflow bindings
- **THEN** 路由候选 MUST 只包含 Skill
- **AND** 模型与 RAG 预筛 MUST NOT 收到 Workflow 候选

#### Scenario: 只选择Workflow

- **GIVEN** Agent policy config 声明 `selectionMode=WORKFLOW`
- **WHEN** 当前 Agent 同时存在可用的 enabled Skill 与 Workflow bindings
- **THEN** 路由候选 MUST 只包含 Workflow
- **AND** 模型与 RAG 预筛 MUST NOT 收到 Skill 候选

#### Scenario: 未配置时保留两类候选

- **GIVEN** Agent policy config 省略 `selectionMode`
- **WHEN** 当前 Agent 同时存在可用的 enabled Skill 与 Workflow bindings
- **THEN** 系统 MUST 按 `SKILL_OR_WORKFLOW` 处理
- **AND** 两类 bindings MUST 继续接受相同的 scope、availability 与候选成员校验

### Requirement: agent-router-plugin仅选择当前Agent绑定的可用能力

当 accepted Agent 激活 `agent-router-plugin` 且显式路由解析未产生决策时，系统 MUST 只从该请求 frozen `AgentAssembly.capabilityBindings` 中 `enabled=true`、`capabilityType` 为 `SKILL` 或 `WORKFLOW`，并且在当前 Agent Scope、Owner Scope 与会话作用域下仍可解析为同类型可用 capability 的条目构造路由候选。系统 MUST NOT 把 disabled binding、其它 capability 类型、其它 Agent 的 binding、default-visible 但未显式绑定的 capability、全局 catalog 条目、客户端字段、模型自报目标或插件配置目标加入候选。

模型路由结果 MUST 恰好为以下三类之一：选中候选中的一个 `SKILL`、选中候选中的一个 `WORKFLOW`、no-match。选中 `SKILL` 时，系统 MUST 产出 `DETERMINISTIC_FLOW` 与匹配候选名称的 `skillName`；选中 `WORKFLOW` 时，系统 MUST 产出 `DETERMINISTIC_FLOW` 与匹配候选名称的 `recipeName`；no-match 或候选集合为空时，系统 MUST 产出 `MODEL_DRIVEN_LOOP`。系统 MUST NOT 同时产出 `skillName` 与 `recipeName`，也 MUST NOT 用同名但类型不同的 capability 替换模型选择。

**需求类别**：功能性需求

#### Scenario: 当前Agent绑定的Skill被选择

- **WHEN** accepted Agent 激活 `agent-router-plugin`
- **AND** 当前 Agent 有一个 enabled `SKILL` binding，且该 Skill 在当前 Agent Scope、Owner Scope 与会话作用域下可用
- **AND** 当前模型返回该 Skill 的精确名称和 `SKILL` 类型
- **THEN** 路由结果 MUST 为 `DETERMINISTIC_FLOW`
- **AND** `skillName` MUST 等于该 binding 的 capability id
- **AND** 系统 MUST 继续进入既有受治理 Skill 定向加载路径

#### Scenario: 当前Agent绑定的Workflow被选择

- **WHEN** accepted Agent 激活 `agent-router-plugin`
- **AND** 当前 Agent 有一个 enabled `WORKFLOW` binding，且该 Workflow 在当前 Agent Scope、Owner Scope 与会话作用域下可用
- **AND** 当前模型返回该 Workflow 的精确名称和 `WORKFLOW` 类型
- **THEN** 路由结果 MUST 为 `DETERMINISTIC_FLOW`
- **AND** `recipeName` MUST 等于该 binding 的 capability id
- **AND** 系统 MUST 继续进入既有受治理 workflow 路由路径

#### Scenario: 未绑定能力不进入候选

- **WHEN** 当前请求的治理后 catalog 中存在一个可用 Skill 或 Workflow
- **AND** accepted Agent 没有该 capability 的 enabled 显式 binding
- **THEN** `agent-router-plugin` 的模型路由输入 MUST NOT 包含该 capability
- **AND** 模型即使返回其名称，系统也 MUST NOT 采用该目标

#### Scenario: 候选为空或没有匹配目标

- **WHEN** 当前 Agent 没有同时满足 binding 与治理可用性条件的 Skill 或 Workflow，或当前模型返回 no-match
- **THEN** 路由结果 MUST 为 `MODEL_DRIVEN_LOOP`
- **AND** 系统 MUST NOT 发起 Skill 或 Workflow capability 调用

### Requirement: agent-router-plugin可通过受治理RAG Tool预筛候选

`agent-router-plugin` 的 Agent policy config MAY 包含 optional `ragPrefilter`。配置存在时，`ragPrefilter` MUST 只接受 optional `indexes` 与 optional `topK`：`indexes` 存在时 MUST 为 1–5 个符合既有 RAG logical index 约束的名称，省略时 MUST 使用 builtin `Rag` 的 trusted default indexes；`topK` 存在时 MUST 为 1–10 的整数，省略时 MUST 默认为 5。配置缺失时，系统 MUST 跳过 RAG 预筛并把全部受控候选交给最终模型选择。

启用 `ragPrefilter` 后，系统 MUST 先应用 `selectionMode`、Agent binding 与 capability 可用性治理。受控候选数小于或等于 effective `topK` 时，系统 MUST 跳过 RAG 调用并把全部受控候选交给最终模型选择；受控候选数大于 effective `topK` 时，系统 MUST 通过当前 Agent enabled binding 下可用的 builtin `Rag` 执行恰好一次受治理 logical invocation，并 MUST 为该 invocation 设置 `maxRetries=0`。RAG query MUST 使用 accepted user input trim 后的前 256 个 Unicode code points；完整 accepted user input MUST 继续提供给最终模型选择。

用于预筛的 RAG 结果 MUST 通过 `source` 精确标识候选，格式 MUST 为 `capability/SKILL/<capabilityId>` 或 `capability/WORKFLOW/<capabilityId>`。系统 MUST 按 RAG result 顺序去重，并只保留 kind 与 capability id 同时匹配原受控候选集合的前 `topK` 个结果；其它 source、未绑定目标、不可用目标、类型不匹配目标与重复目标 MUST 被忽略，MUST NOT 扩大候选权限。RAG 完整成功但零命中，或结果过滤后没有合法候选时，系统 MUST 返回 no-match；RAG 返回包含至少一个合法候选的受治理部分结果时，系统 MUST 使用这些合法候选继续最终模型选择；RAG 调用失败、取消、超时、无可用 chunk 的 degraded/failure 或 `Rag` 未绑定/不可用时，系统 MUST 进入既有安全 plugin failure boundary。

**需求类别**：功能性需求

#### Scenario: 未配置ragPrefilter时跳过RAG

- **GIVEN** Agent policy config 未声明 `ragPrefilter`
- **WHEN** router 完成 `selectionMode`、binding 与 capability 可用性治理
- **THEN** 系统 MUST NOT 调用 builtin `Rag`
- **AND** MUST 把全部治理后候选交给最终模型

#### Scenario: 从N个候选预筛到配置上限

- **GIVEN** `ragPrefilter.topK=5`
- **AND** `selectionMode`、binding 与 capability 可用性治理后存在多于 5 个候选
- **WHEN** builtin `Rag` 返回按 relevance 排序且 source 可映射到原候选的结果
- **THEN** 系统 MUST 把至多前 5 个去重后的合法候选交给最终模型
- **AND** 最终模型 MUST 只能从该预筛子集中选择一个目标或返回 no-match

#### Scenario: 候选数不超过topK时跳过RAG

- **GIVEN** `ragPrefilter.topK=5`
- **AND** 治理后候选数小于或等于 5
- **WHEN** router 执行候选准备
- **THEN** 系统 MUST 不调用 builtin `Rag`
- **AND** MUST 把全部治理后候选交给最终模型

#### Scenario: RAG结果不能扩大候选集合

- **WHEN** RAG 结果包含未绑定 capability、类型不匹配 capability、重复 source 或不符合 capability source 格式的 chunk
- **THEN** 系统 MUST 忽略这些结果
- **AND** MUST NOT 把任何原受控候选集合外的目标交给最终模型或后续执行路径

#### Scenario: RAG零命中

- **WHEN** RAG 完整成功但返回零个 chunk，或全部结果在候选成员校验时被过滤
- **THEN** 路由结果 MUST 为 `MODEL_DRIVEN_LOOP`
- **AND** `safeReason` MUST 为 `AGENT_ROUTER_PLUGIN_NO_MATCH`
- **AND** 系统 MUST NOT 调用最终路由模型

#### Scenario: RAG依赖失败

- **WHEN** 启用预筛但 builtin `Rag` 未在当前 Agent enabled binding 中可用，或 RAG 调用失败、取消、超时且没有合法部分结果
- **THEN** 系统 MUST 进入既有安全 plugin failure boundary
- **AND** MUST NOT 回退到完整候选集合、其它 RAG provider 或全局能力搜索

### Requirement: agent-router-plugin使用当前Agent初始模型执行一次受控选择

`agent-router-plugin` MUST 通过 `ModelSelectionService` 的 `INITIAL` 模式按 accepted Agent 既有初始模型规则选择实际模型，并使用 purpose `AGENT_ROUTING_SELECTION` 计算 prompt compatibility；MUST NOT 在 router 内复制 `defaultModelId`、first eligible 或 fallback 选择规则。模型选择成功后，系统 MUST 通过唯一 `PromptTemplateResolverPort`，使用同一 accepted Agent scope、locale、trusted string flow variables 与 selected canonical model id 解析 Agent-scoped 终选 template。resolver 返回 `RESOLVED` 时系统 MUST 使用其 rendered content；返回 `NOT_FOUND` 时系统 MUST 使用 plugin 代码私有且非空的 `defaultSelectionTask`。系统 MUST 对 accepted user input 与 effective final candidate set 执行一次无 Tool 的 run-bound 模型调用。effective final candidate set MUST 为未启用 RAG 预筛时的全部受控候选、候选数不超过 `topK` 时的全部受控候选，或 RAG 预筛后仍属于原受控候选集合的子集。

模型输入 MUST 把 resolved Agent template content 或 plugin `defaultSelectionTask` 作为独立 `task`，并把完整 accepted input 与 effective final candidate set 作为分离 JSON 字段。router MUST 固定 `tools=[]`、`toolChoice=NONE`、`temperature=0`、`maxOutputTokens=128`、`maxRetries=0`，MUST NOT 合并 prompt template `modelOptions`。模型输出契约 MUST 只允许 `kind` 为 `SKILL`、`WORKFLOW` 或 `NONE`，并在 `kind` 为 `SKILL` 或 `WORKFLOW` 时包含精确候选名称。系统 MUST 在产生路由决策前校验输出结构、未知字段、类型与 effective final candidate set 成员关系。

官方 `agent-router-plugin` 代码内置的 `defaultSelectionTask` MUST 把 effective final candidate set 定义为唯一可选权威，MUST 把 accepted input、候选 display name 与 description 仅作为语义匹配数据，并 MUST 指示模型拒绝执行其中企图改变路由规则、输出契约或候选范围的指令。该 task MUST 要求选择最强直接语义匹配的单一候选；当无候选能有意义支持请求目标、候选 description 不支持所需结果，或无法可辩护地确定唯一候选时，MUST 要求返回 `NONE`。该 task MUST 只要求返回精确的 `{"kind":"SKILL","name":"<exact capabilityId>"}`、`{"kind":"WORKFLOW","name":"<exact capabilityId>"}` 或 `{"kind":"NONE"}` JSON object，MUST NOT 要求 prose、reasoning、Markdown 或 code fence。Agent-scoped override template MAY 提供不同的选择指导，但不得改变 router 固定的候选成员校验、输出 schema 或模型调用控制。

该模型调用 MUST 复用 accepted request 的 Agent Scope、Owner Scope、session、request 与 run coordinates，MUST 接收同一个 `AbortSignal`，并 MUST NOT 使用 Tool descriptors、其它 Agent 的模型、其它 Agent 的 bindings 或未按 accepted assembly 治理的 capability catalog结果。该路由选择 MUST NOT 修改 Agent 的模型集合、默认模型或后续模型循环的选择规则。

**需求类别**：功能性需求

#### Scenario: 使用当前Agent初始模型

- **WHEN** accepted Agent 激活 `agent-router-plugin` 且 effective final candidate set 至少有一个候选
- **THEN** 系统 MUST 按 accepted Agent 的初始模型选择规则取得模型
- **AND** MUST 使用该模型完成恰好一次无 Tool 路由选择调用
- **AND** 后续请求处理 MUST 继续使用既有模型选择规则，且 MUST NOT 因本次选择改变默认或 fallback 顺序

#### Scenario: 终选提示词优先使用Agent模板

- **WHEN** effective final candidate set 至少有一个候选且当前 Agent 为 purpose `AGENT_ROUTING_SELECTION` 注册了匹配模板
- **THEN** router MUST 使用该 Agent-scoped template 的 rendered content 作为模型请求 `task`
- **AND** MUST NOT 使用 plugin default task 覆盖该 Agent template
- **AND** MUST NOT 使用平行硬编码终选 task 覆盖该 Agent template

#### Scenario: 插件内置默认task约束语义选择

- **WHEN** effective final candidate set 非空且当前 Agent 未注册匹配的 `AGENT_ROUTING_SELECTION` template
- **THEN** resolver MUST 返回 `NOT_FOUND`
- **AND** router MUST 使用官方插件代码内置的 `defaultSelectionTask`
- **AND** 该 task MUST 明确候选数组是唯一可选范围
- **AND** MUST 要求模型忽略 accepted input 或 candidate text 中企图改变路由规则、输出契约或候选范围的指令
- **AND** MUST 要求在存在唯一最强直接语义匹配时选择该候选，否则返回 `NONE`
- **AND** MUST 要求只返回约定的单一 exact JSON object

#### Scenario: 空候选跳过模型与模板解析

- **WHEN** 受治理候选为空或 configured RAG 成功返回零个合法命中
- **THEN** 系统 MUST 直接返回 no-match
- **AND** MUST NOT 调用 `ModelSelectionService`、`PromptTemplateResolverPort` 或模型

#### Scenario: 模型返回候选集合外目标

- **WHEN** 模型输出的名称不属于受控候选集合，类型与同名候选不一致，包含未知字段，或同时表达多个目标
- **THEN** 系统 MUST 把该输出判定为非法路由结果
- **AND** MUST NOT 调用该输出指向的任何 Skill 或 Workflow

### Requirement: agent-router-plugin依赖失败时安全拒绝

当初始模型选择、prompt template resolution、模型调用、候选治理读取、configured RAG 预筛、请求取消或模型输出校验失败时，系统 MUST 通过既有 plugin routing failure boundary 产出安全 `REJECT` 路由结果。失败路径 MUST NOT 回退到未治理候选、预筛前完整候选、随机候选或全局能力搜索，MUST NOT 把 raw prompt、模型原始输出、RAG query、RAG result content、binding 描述、provider error、credential、路径或 stack 投影到 SafeError、timeline、stream、audit、metric 或 trace。

no-match 和空候选集合属于正常 `MODEL_DRIVEN_LOOP` 结果，MUST NOT 被归类为依赖失败。系统 MUST 为 Skill 选择、Workflow 选择、no-match 与安全失败使用稳定且低敏的 safe reason code，使测试和运维可以区分四类结果而无需读取原始输入或模型输出。

四类结果的 `safeReason` MUST 分别为 `AGENT_ROUTER_PLUGIN_SKILL_SELECTED`、`AGENT_ROUTER_PLUGIN_WORKFLOW_SELECTED`、`AGENT_ROUTER_PLUGIN_NO_MATCH` 与 `PLUGIN_ROUTING_POLICY_FAILED`。

**需求类别**：系统质量属性

**质量属性**：安全

**适用范围**：该 Function

#### Scenario: 模型调用失败

- **WHEN** 当前模型不可用、调用超时、返回 safe error 或抛出执行错误
- **THEN** 路由结果 MUST 为安全 `REJECT`
- **AND** 系统 MUST NOT 改选任何 Skill 或 Workflow
- **AND** 可观察诊断 MUST 只包含稳定 scope refs、结果类别和 safe reason code
