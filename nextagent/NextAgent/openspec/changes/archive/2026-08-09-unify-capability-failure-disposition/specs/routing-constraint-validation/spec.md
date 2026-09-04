# routing-constraint-validation Delta Specification

所属 Function：`FN-2.1 提交请求`

Function 变更类型：修改

spec 角色：主规格

## MODIFIED Requirements

### Requirement: Routing constraints use an allow-list schema
系统 SHALL 只接受 allow-list 中的 request-carried `RoutingConstraints` 字段：`targetSkill`、`targetRecipe`、`forbiddenCapabilityIds`、`executionMode`、`locale`、`allowHumanInput` 和 `allowSubagents`。Router 从 directive 派生的目标 SHALL 在影响 Agent 内部路由前归一化到同一 vocabulary。其他字段 SHALL NOT 被接收；Agent loop limits SHALL 只来自可信 runtime-ready Agent assembly settings。

**需求类别**：功能性需求

#### Scenario: Allowed routing constraints are submitted
- **WHEN** request 包含 shape 合法的 allow-listed routing constraint fields
- **THEN** channel/request boundary MUST 把它们接收为 typed routing constraints
- **AND** runtime MUST 把它们作为 accepted request facts 携带
- **AND** Agent routing policy MUST 在使用前继续治理这些约束

#### Scenario: Directive-derived routing constraints are normalized
- **WHEN** router 从 accepted request text 解析 `$skill:alarm-diagnosis` 或 `$workflow:push-gate`
- **THEN** router MUST 把 directive 归一化到 allow-listed routing constraint vocabulary
- **AND** router MUST NOT 创建 allow-list 之外的临时 routing field

#### Scenario: Forbidden routing override is submitted
- **WHEN** request 包含 owner、tenant、subject、agent override、provider override、capability provider override、raw system prompt、raw policy、raw tool authority、raw model profile override 或其他非 allow-list 字段
- **THEN** closed request schema MUST 拒绝该 request
- **AND** 这些字段 MUST NOT 影响 Agent Scope、Owner Scope、capability authority、provider selection、prompt construction、`maxTurns` 或 `maxToolCallsPerTurn`

### Requirement: Constraint validation has two stages
Routing constraint validation SHALL 在不可信边界执行 schema validation，并在 Agent routing policy 内执行 governance validation。schema 合法 SHALL 只产生 typed constraints value，SHALL NOT 授予执行 authority。

**需求类别**：功能性需求

#### Scenario: Constraint passes schema validation
- **WHEN** `targetSkill` 是合法 safe identifier 且全部 allow-listed fields shape 合法
- **THEN** schema validation MUST 产生 typed constraints
- **AND** Agent routing policy MUST 继续根据当前 Agent、Owner Scope、capability governance、locale、availability 和 policy 校验这些约束

#### Scenario: Constraint fails governance
- **WHEN** schema-valid constraint 与当前 Agent policy、Owner Scope、capability governance、availability 或 security context 冲突
- **THEN** Agent routing policy MUST 按 policy reject、ignore、clarify、hand off 或 degrade
- **AND** policy MUST NOT 把 schema 合法视为执行授权

### Requirement: Budget and execution constraints are enforced before slow boundaries
`executionMode`、`allowHumanInput` 和 `allowSubagents` 等执行约束 SHALL 在调用其限制的 model、capability、human input、subagent 或其他 slow boundary 前检查。Agent loop `maxTurns` 和 `maxToolCallsPerTurn` SHALL 从可信 runtime-ready Agent assembly settings 解析，SHALL NOT 通过 request-carried `RoutingConstraints` 提供。

**需求类别**：功能性需求

#### Scenario: 请求 model-only 执行
- **WHEN** `executionMode=model-only`
- **THEN** Agent routing policy MUST prevent Tool or Capability invocation for the constrained request path
- **AND** model invocation MUST retain visible Tool descriptors and use effective `toolChoice=NONE`
- **AND** request input MUST NOT set or replace assembly-owned `maxTurns` or `maxToolCallsPerTurn`

#### Scenario: human input is disallowed
- **WHEN** `allowHumanInput=false`
- **AND** routing would otherwise require clarification or human approval
- **THEN** routing policy MUST select safe rejection, model-only fallback, or another allowed path
- **AND** it MUST NOT create pending input

## Function 变更汇总

### 描述

- 变更类型：修改
- 目标内容：request-carried routing constraints 不再拥有 Tool-call 数量预算；请求只能用 `executionMode=model-only` 收窄执行，canonical loop limits 由可信 Agent assembly 拥有。
- 依据 Requirements：`Routing constraints use an allow-list schema`、`Constraint validation has two stages`、`Budget and execution constraints are enforced before slow boundaries`

### 输入

- 变更类型：修改
- 目标内容：`RoutingConstraints` 使用封闭 allow-list，仅保留非预算 routing inputs。
- 依据 Requirements：`Routing constraints use an allow-list schema`

### 输出

- 变更类型：修改
- 目标内容：accepted request facts 不再携带可覆盖 Agent loop limits 的 request field。
- 依据 Requirements：`Routing constraints use an allow-list schema`、`Constraint validation has two stages`

### 处理过程

- 变更类型：修改
- 目标内容：routing policy 继续治理 `executionMode` 等约束，但从 trusted Agent assembly 读取 `maxTurns` 和 `maxToolCallsPerTurn`。
- 依据 Requirements：`Budget and execution constraints are enforced before slow boundaries`

### 结果

- 变更类型：修改
- 目标内容：请求仍可显式选择 model-only，但不能扩大、缩小或复制 Agent-owned loop budgets。
- 依据 Requirements：`Budget and execution constraints are enforced before slow boundaries`

### 规格

- 规格项：请求级 Tool 使用约束
- 变更类型：新增
- 原规格值：不适用（新增）
- 目标规格值：request 可以禁用 Tool，但不能携带或覆盖任一 Agent-owned Tool-call 数量预算
- 依据 Requirements：`Routing constraints use an allow-list schema`、`Budget and execution constraints are enforced before slow boundaries`
