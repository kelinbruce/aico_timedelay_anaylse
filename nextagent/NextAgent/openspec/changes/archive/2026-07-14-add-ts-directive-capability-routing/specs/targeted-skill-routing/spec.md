## ADDED Requirements

### Requirement: Skill 指令产生目标 Skill 约束

router SHALL 把一条合法的 `$skill:<name>` 自然语言指令当作既有受治理目标 Skill 路由路径的 request 局部来源。由指令推导的 Skill 目标 SHALL NOT 绕过 capability governance、request lifecycle 边界或面向 model 的 Skill tool 语义。

#### Scenario: 指令推导的 targetSkill 受治理
- **WHEN** 已接受的 request 文本包含 `$skill:alarm-diagnosis`
- **THEN** router MUST 产生与 request 定向 Skill 路由相同的受治理目标 Skill 路由输入
- **AND** Agent 路由策略在执行前 MUST 校验 kind=`SKILL`、当前 Agent 绑定、Owner Scope visibility/authorization、availability、forbidden 约束、budget、deadline 和 cancellation

#### Scenario: Skill 指令不会变成 model 的 Skill tool 调用
- **WHEN** 已接受的 request 文本包含 `$skill:alarm-diagnosis`
- **THEN** router MUST 在 model 生成的 tool call 之前处理它
- **AND** model 输出 MUST NOT 覆盖、放宽或重新分类由指令推导的目标 Skill

#### Scenario: Skill 指令目标不是 workflow
- **WHEN** 已接受的 request 文本包含 `$skill:push-gate`
- **AND** `push-gate` 仅以 `RECIPE` capability 形式可见
- **THEN** 目标 Skill 路由 MUST 拒绝或降级该定向 Skill 目标
- **AND** 它 MUST NOT 把 `$skill:push-gate` 重新解释为 `routingConstraints.targetRecipe`
