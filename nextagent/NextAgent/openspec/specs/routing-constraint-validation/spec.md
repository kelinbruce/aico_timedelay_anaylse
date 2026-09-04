# routing-constraint-validation Specification

## Purpose
Define the stable schema-stage and governance-stage validation rules for request-carried routing constraints before they influence Agent-internal routing.
## Function

- **所属 Function**：`FN-2.1 提交请求`
- **Function 变更类型**：`MODIFIED`
- **spec 角色**：主规格
## Requirements
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

### Requirement: Constraints can only narrow or guide authority
Routing constraints SHALL only narrow or guide handling choices within the current accepted Agent and Owner Scope. They SHALL NOT expand capability visibility, model visibility, tool authority, provider access, tenant access, subagent authority, or prompt authority.

#### Scenario: forbiddenCapabilityIds narrows candidates
- **WHEN** `forbiddenCapabilityIds` includes a capability visible to the current request
- **THEN** Agent routing policy MUST exclude it from eligible candidates for the current decision
- **AND** the exclusion MUST NOT mutate AgentAssembly, catalog state, or future requests

#### Scenario: allowSubagents is false
- **WHEN** `allowSubagents=false`
- **THEN** Agent routing policy MUST exclude subagent/Agent capability paths for the current request
- **AND** it MUST NOT remove Agent capability bindings from the Agent assembly

#### Scenario: locale constraint is supplied
- **WHEN** `locale` is supplied
- **THEN** routing policy MAY use it only if it is compatible with trusted channel/auth locale policy and current Agent policy
- **AND** it MUST NOT override Owner Scope or security identity

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

### Requirement: Constraint validation outcomes are observable and safe
Constraint validation SHALL produce safe accepted, rejected, ignored, or degraded outcomes for routing evidence, audit, logs, and trace. User-visible surfaces SHALL receive only final results, pending input, handoff, or safe errors.

#### Scenario: Constraint is rejected
- **WHEN** a routing constraint is rejected due to invalid shape, conflict, authorization, availability, budget, or policy
- **THEN** the system MUST record a safe reason code for observability
- **AND** it MUST NOT expose raw constraint payload, policy internals, provider-private facts, local paths, or secrets to the user

#### Scenario: Validation dependency is unavailable
- **WHEN** policy, catalog, availability, or budget dependency needed to validate a constraint is unavailable
- **THEN** routing MUST fail closed or choose a policy-declared safe degradation path
- **AND** it MUST NOT silently drop the constraint and proceed as if no constraint was supplied
