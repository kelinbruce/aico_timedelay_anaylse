## MODIFIED Requirements

### Requirement: 路由约束使用 allow-list schema
在 `refine-ts-routing-constraints-contract` 定义了 request 携带的 `RoutingConstraints` 之后，系统 SHALL 只接受 allow-list 中的路由约束字段：`targetSkill`、`targetRecipe`、`forbiddenCapabilityIds`、`executionMode`、`locale`、`maxToolCalls`、`allowHumanInput` 和 `allowSubagents`。由 router 推导的指令目标在影响 Agent 内部路由之前，SHALL 被规范化到同一 allow-list 路由约束词汇表。

#### Scenario: 提交允许的路由约束
- **WHEN** 一个 request 带有形态合法的允许路由约束字段
- **THEN** channel/request 边界 MAY 把它们作为带类型的路由约束接受
- **AND** runtime MAY 把它们随已接受的 request 事实一起携带
- **AND** Agent 路由策略在使用前 MUST 仍然治理它们

#### Scenario: 指令推导的路由约束被规范化
- **WHEN** router 从已接受的 request 文本中解析出 `$skill:alarm-diagnosis` 或 `$workflow:push-gate`
- **THEN** 它 MUST 把该指令规范化到 allow-list 路由约束词汇表
- **AND** 它 MUST NOT 在 allow-list 之外创建临时路由字段

#### Scenario: 提交被禁止的路由 override
- **WHEN** 一个 request 带有 owner、tenant、subject、agent override、provider override、capability provider override、raw system prompt、raw policy、raw tool authority 或 raw model profile override 字段
- **THEN** request 边界或 Agent 路由策略 MUST 依据安全校验策略拒绝或忽略这些字段
- **AND** 这些字段 MUST NOT 影响 Agent Scope、Owner Scope、capability authority、provider 选择或 prompt 构造
