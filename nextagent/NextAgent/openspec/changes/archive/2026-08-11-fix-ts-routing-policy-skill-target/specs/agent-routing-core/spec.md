## Function

- **所属 Function**：`FN-2.5 请求自动路由`
- **Function 变更类型**：`MODIFIED`
- **spec 角色**：主规格

## MODIFIED Requirements

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

## Function 变更汇总

### 处理过程

- **变更类型**：修改
- **目标内容**：`mode=policy` 命中规则后，系统先按治理后的 capability 视图解析 `target.name` 并校验 kind，`SKILL` 与 `WORKFLOW` 使用同一判定；请求携带可信定向 Skill 约束时不评估配置规则；为可信路由目标执行 Skill 加载时，在受理的 Agent Scope、Owner Scope 和会话作用域内解析目标，并把该已治理 Skill 声明为本次定向调用的已披露 Skill。
- **依据 Requirements**：`Policy routing uses controlled input and output contracts`、`Routing core emits safe downstream commands`

### 结果

- **变更类型**：修改
- **目标内容**：配置规则命中但目标不可用时，请求降级到模型驱动循环并给出安全的未命中原因，不再失败也不替换目标；显式可信定向 Skill 约束存在时，配置规则不生效且该 Skill 恰好加载一次；可信路由目标的 Skill 加载不再因缺少模型侧发现而失败。
- **依据 Requirements**：`Policy routing uses controlled input and output contracts`、`Routing core emits safe downstream commands`

### 规格

- **规格项**：配置规则目标不可用时的处理
- **变更类型**：修改
- **原规格值**：`WORKFLOW` 目标降级到模型驱动循环；`SKILL` 目标不做可用性判定
- **目标规格值**：`SKILL` 与 `WORKFLOW` 目标一致，按治理视图判定 kind 后不可用则降级到模型驱动循环
- **依据 Requirements**：`Policy routing uses controlled input and output contracts`

- **规格项**：显式可信定向 Skill 约束与配置规则的优先级
- **变更类型**：新增
- **原规格值**：不适用（新增）
- **目标规格值**：显式可信定向 Skill 约束优先，配置规则不参与该请求的评估
- **依据 Requirements**：`Policy routing uses controlled input and output contracts`

- **规格项**：可信路由目标 Skill 加载的发现前置
- **变更类型**：修改
- **原规格值**：与模型发起的加载一致，要求先完成模型侧 capability 发现
- **目标规格值**：不要求模型侧发现；披露范围仅限本次定向调用，模型发起的加载不受影响
- **依据 Requirements**：`Routing core emits safe downstream commands`
