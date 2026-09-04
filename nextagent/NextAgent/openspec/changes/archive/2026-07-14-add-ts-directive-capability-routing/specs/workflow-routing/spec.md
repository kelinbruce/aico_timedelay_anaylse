## ADDED Requirements

### Requirement: Workflow 指令产生 targetRecipe 约束

workflow routing SHALL 把一条合法的 `$workflow:<name>` 自然语言指令当作 `routingConstraints.targetRecipe` 的 request 局部来源。由指令推导的 targetRecipe MUST 遵循既有的 workflow 路由路径，且 MUST NOT 复用 `targetSkill` 或任何 Skill 特定字段来承载 workflow 语义。

#### Scenario: 指令推导的 targetRecipe 受治理
- **WHEN** 已接受的 request 文本包含 `$workflow:push-gate`
- **THEN** router MUST 产生 `routingConstraints.targetRecipe=push-gate`
- **AND** workflow routing 在调用 `WorkflowExecutionService.execute()` 之前 MUST 依据当前 Agent Scope 的 `RECIPE` capability 解析该目标

#### Scenario: Workflow 指令 miss 时安全 fallback
- **WHEN** 已接受的 request 文本包含 `$workflow:push-gate`
- **AND** `push-gate` 未解析到当前 Agent Scope 的 `RECIPE` capability
- **THEN** workflow routing MUST 使用既有的显式 workflow miss 行为
- **AND** 它 MUST NOT 搜索另一个 Agent、全局 recipe registry 或 skill catalog

#### Scenario: Workflow 指令目标不是 skill
- **WHEN** 已接受的 request 文本包含 `$workflow:alarm-diagnosis`
- **AND** `alarm-diagnosis` 仅以 `SKILL` capability 形式可见
- **THEN** workflow routing MUST 把该目标当作 workflow miss 或安全拒绝
- **AND** 它 MUST NOT 把 `$workflow:alarm-diagnosis` 重新解释为目标 Skill
