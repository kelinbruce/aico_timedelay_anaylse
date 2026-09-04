# directive-capability-routing Delta Specification

所属 Function：`FN-2.8 指令定向请求处理`

Function 变更类型：修改

spec 角色：主规格

## MODIFIED Requirements

### Requirement: Agent Web Requests Do Not Carry Target Directives

agent-web public submit requests SHALL NOT accept `routingConstraints.targetSkill` or `routingConstraints.targetRecipe`. Web users SHALL specify skill or workflow targets by including `$skill:<name>` or `$workflow:<name>` in the user question text. Router SHALL derive the target routing constraint from the accepted request text after runtime acceptance.非目标 routing constraints MUST 使用 `routing-constraint-validation` 定义的同一 closed allow-list，MUST NOT 包含任何 Agent loop 数量预算。

**需求类别**：功能性需求

#### Scenario: Web request carries no explicit target fields

- **WHEN** agent-web 收到 `inputText="$workflow:push-gate diagnose RAN alarms"` 的普通 submit request
- **THEN** agent-web MUST 把 accepted user text 转发给 runtime submit
- **AND** agent-web MUST NOT 添加 `routingConstraints.targetRecipe` 或 `routingConstraints.targetSkill`

#### Scenario: Web request attempts direct targetRecipe

- **WHEN** agent-web submit request body 包含 `routingConstraints.targetRecipe`
- **THEN** Web request schema MUST 拒绝该 request
- **AND** runtime submit MUST NOT 被调用

#### Scenario: Web request attempts direct targetSkill

- **WHEN** agent-web submit request body 包含 `routingConstraints.targetSkill`
- **THEN** Web request schema MUST 拒绝该 request
- **AND** runtime submit MUST NOT 被调用

#### Scenario: Web request carries non-target constraints

- **WHEN** agent-web submit request body 包含 `forbiddenCapabilityIds`、`executionMode`、`allowHumanInput` 或 `allowSubagents` 等 allow-listed 非目标 routing constraints
- **THEN** agent-web MUST 在 schema validation 后把这些约束转发给 runtime submit
- **AND** Tool-call 数量预算或其他非 allow-list 字段 MUST 被 closed request schema 拒绝
- **AND** target Skill 或 target Recipe MUST 仍只由 router 解析 accepted request text 得出

## Function 变更汇总

### 描述

- 变更类型：修改
- 目标内容：directive target 继续只从 accepted user text 派生，Web request 的非目标约束复用同一 closed allow-list 且不包含 Tool-call 数量预算。
- 依据 Requirements：`Agent Web Requests Do Not Carry Target Directives`

### 输入

- 变更类型：修改
- 目标内容：agent-web submit schema 接受安全非目标约束并拒绝 target fields、Tool-call 数量预算和其他未知字段。
- 依据 Requirements：`Agent Web Requests Do Not Carry Target Directives`

### 输出

- 变更类型：修改
- 目标内容：runtime submit 只收到 schema-valid 非目标约束，directive target 仍由 router 派生。
- 依据 Requirements：`Agent Web Requests Do Not Carry Target Directives`

### 处理过程

- 变更类型：修改
- 目标内容：Web schema validation 与 Agent 内部 directive parsing 保持边界分离。
- 依据 Requirements：`Agent Web Requests Do Not Carry Target Directives`

### 结果

- 变更类型：修改
- 目标内容：Web request 不能直接指定 capability target，也不能覆盖 Agent-owned loop limits。
- 依据 Requirements：`Agent Web Requests Do Not Carry Target Directives`

### 规格

- 规格项：Web request routing constraints
- 变更类型：新增
- 原规格值：不适用（新增）
- 目标规格值：只接受安全非目标 allow-list；无 Tool-call 数量预算
- 依据 Requirements：`Agent Web Requests Do Not Carry Target Directives`
