# workflow-routing Specification

## Purpose
定义 agent-core routing 如何基于 trusted request-carried `routingConstraints.targetRecipe`、capability directive `$workflow:<name>` 或 routing policy rule 决定请求是否进入 workflow path，以及未命中时如何稳定降级到 conversation loop。recipe 作为 `WORKFLOW` capability 通过 capability catalog 解析，不引入独立 RecipeRegistry；dispatch 只负责把请求交给 WorkflowExecutionService，不定义 recipe durable store、workflow event durable store 或 terminal commit 新规则。
## Requirements
### Requirement: Recipe Capability Routing

recipe MUST 作为 capability 的一类进入 capability catalog。`agent-core` MUST NOT 提供独立 `RecipeRegistry`；routing MUST 按当前 Agent Scope 通过 capability catalog 解析 `kind === "WORKFLOW"` 的 capability。

#### Scenario: Register Recipe Capabilities
- **WHEN** startup composition 加载已校验 recipe 索引
- **THEN** 系统 MUST 为当前 Agent Scope 发布对应 `WORKFLOW` capability descriptor

#### Scenario: Resolve Recipe Capability
- **WHEN** routing 需要按 `agentId + recipeName` 判断 recipe 是否可用
- **THEN** `CapabilityCatalog.resolve` MUST 返回当前 Agent Scope 下对应 `WORKFLOW` capability 或明确未命中

### Requirement: TargetRecipe Routing Constraint

workflow routing MUST 通过 trusted request-carried `routingConstraints.targetRecipe` 接收显式 recipe 目标。

#### Scenario: Carry Trusted Target Recipe
- **WHEN** 请求显式提供 `routingConstraints.targetRecipe`
- **THEN** runtime / channel / agent-core MUST 保留该字段
- **AND** MUST NOT 复用 `targetSkill` 承载 workflow 语义

### Requirement: Workflow Routing

agent-core MUST 根据 recipe 命中结果决定是否进入 workflow path。

#### Scenario: Explicit Workflow Match
- **WHEN** 请求显式提供 `routingConstraints.targetRecipe` 且命中当前 Agent Scope 的 `WORKFLOW` capability
- **THEN** 系统 MUST 调用 `WorkflowExecutionService.execute()`

#### Scenario: Explicit Workflow Miss
- **WHEN** 请求显式提供 `routingConstraints.targetRecipe` 但未命中当前 Agent Scope 的 `WORKFLOW` capability
- **THEN** 系统 MUST 回退到 conversation loop

#### Scenario: Intent Match Miss
- **WHEN** intent match 未命中 recipe
- **THEN** 系统 MUST 回退到 conversation loop

### Requirement: Boot Recipe Routing

当前 workflow routing 仅支持显式指定进入 workflow path。当请求未携带显式 `routingConstraints.targetRecipe` 时，agent-core routing MUST NOT 自动检查或进入 boot-recipe（`RecipeDefinition.type === "boot-recipe"`）。routing MUST 回退到 conversation loop 或 policy routing。

`RecipeDefinition.type` 字段（`"recipe"` | `"boot-recipe"`）在 schema 中保留，但 routing 层 MUST NOT 消费该字段作为自动进入 workflow 的判据。boot-recipe 自动进入逻辑未实现，若后续需要启用 MUST 经独立 OpenSpec change 承载。

#### Scenario: No Boot Recipe Auto Entry
- **WHEN** 请求未提供 `routingConstraints.targetRecipe` 且当前 Agent Scope 存在源自 `type === "boot-recipe"` 静态资源的 `WORKFLOW` capability
- **THEN** 系统 MUST NOT 自动调用 `WorkflowExecutionService.execute()`
- **AND** 系统 MUST 回退到 conversation loop 或 policy routing

#### Scenario: No Boot Recipe Fallback
- **WHEN** 请求未提供 `routingConstraints.targetRecipe` 且没有 boot-recipe
- **THEN** 系统 MUST 回退到 conversation loop 或 policy routing

#### Scenario: Boot Recipe Requires Explicit Target
- **WHEN** 请求显式提供 `routingConstraints.targetRecipe` 且该 recipe 的 `type === "boot-recipe"`
- **THEN** 系统 MUST 按显式 workflow routing 路径处理
- **AND** MUST NOT 因 `type === "boot-recipe"` 而改变路由行为

### Requirement: Dispatch Boundary

本 change MUST 只定义 dispatch 行为，不定义 recipe durable store、workflow event durable store 或 terminal commit 新规则。

#### Scenario: No Durable Recipe Store in Dispatch
- **WHEN** 审视本 change 的行为边界
- **THEN** 本 change MUST NOT 要求 recipe 写入数据库

#### Scenario: No Workflow Event Table in Dispatch
- **WHEN** 审视本 change 的行为边界
- **THEN** 本 change MUST NOT 要求 workflow event 写入独立 event table

### Requirement: Workflow Directive Produces TargetRecipe Constraint

workflow routing SHALL accept a valid `$workflow:<name>` natural-language directive as a request-local source for `routingConstraints.targetRecipe`. The directive-derived targetRecipe MUST follow the existing workflow routing path and MUST NOT reuse `targetSkill` or any Skill-specific field to carry workflow semantics.

#### Scenario: Directive-derived targetRecipe is governed
- **WHEN** accepted request text contains `$workflow:push-gate`
- **THEN** router MUST produce `routingConstraints.targetRecipe=push-gate`
- **AND** workflow routing MUST resolve that target against current Agent Scope `WORKFLOW` capabilities before calling `WorkflowExecutionService.execute()`

#### Scenario: Workflow directive miss falls back safely
- **WHEN** accepted request text contains `$workflow:push-gate`
- **AND** `push-gate` does not resolve to a current Agent Scope `WORKFLOW` capability
- **THEN** workflow routing MUST use the existing explicit workflow miss behavior
- **AND** it MUST NOT search another Agent, global recipe registry, or skill catalog

#### Scenario: Workflow directive target is not a skill
- **WHEN** accepted request text contains `$workflow:alarm-diagnosis`
- **AND** `alarm-diagnosis` is visible only as a `SKILL` capability
- **THEN** workflow routing MUST treat the target as a workflow miss or safe rejection
- **AND** it MUST NOT reinterpret `$workflow:alarm-diagnosis` as a target Skill

