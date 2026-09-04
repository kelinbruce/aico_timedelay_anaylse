## ADDED Requirements

### Requirement: 自然语言 capability 指令

router SHALL 只识别已接受自然语言 request 文本中使用 `$skill:<name>` 和 `$workflow:<name>` 两种形式的显式 capability 指令。指令名 MUST 被解析为安全的 capability 标识符，MUST NOT 包含空白字符、路径分隔符、shell 元字符、URL 语法、credential、owner scope 字段、agent scope 字段、provider override、prompt 文本或隐藏的 runtime 坐标。

#### Scenario: Skill 指令被解析
- **WHEN** 已接受的 request 文本恰好包含一条 `$skill:alarm-diagnosis` 指令
- **THEN** router MUST 解析出目标名为 `alarm-diagnosis` 的 skill 指令
- **AND** router MUST NOT 在解析期间执行该 skill

#### Scenario: Workflow 指令被解析
- **WHEN** 已接受的 request 文本恰好包含一条 `$workflow:push-gate` 指令
- **THEN** router MUST 解析出目标名为 `push-gate` 的 workflow 指令
- **AND** router MUST NOT 在解析期间执行该 workflow

#### Scenario: UI slash 命令不是自然语言指令语法
- **WHEN** 已接受的 request 文本包含 `/skill alarm-diagnosis` 或 `/workflow push-gate`
- **THEN** 自然语言指令解析 MUST NOT 把该文本当作 `$skill:` 或 `$workflow:` 语法
- **AND** 任何 slash 命令解释 MUST 属于 request 提交之前的 UI command 边界

### Requirement: 指令到路由约束的映射

被解析的指令 SHALL 只为当前 request 产生带类型的路由目标。`$skill:<name>` MUST 只映射到受治理的 skill 路由目标。`$workflow:<name>` MUST 只映射到 `routingConstraints.targetRecipe`。系统 MUST NOT 复用 skill 目标字段承载 workflow 语义，也 MUST NOT 复用 workflow 目标字段承载 skill 语义。

#### Scenario: Skill 指令映射到 skill 目标
- **WHEN** router 解析到 `$skill:alarm-diagnosis`
- **THEN** 它 MUST 产生一个针对 `alarm-diagnosis` 的 skill 路由目标
- **AND** 它 MUST NOT 设置 `routingConstraints.targetRecipe`

#### Scenario: Workflow 指令映射到 targetRecipe
- **WHEN** router 解析到 `$workflow:push-gate`
- **THEN** 它 MUST 产生 `routingConstraints.targetRecipe=push-gate`
- **AND** 它 MUST NOT 设置或覆盖 skill 路由目标

#### Scenario: 指令不授予执行权限
- **WHEN** router 把一条被解析的指令映射为带类型的路由目标
- **THEN** 被映射的目标在执行前 MUST 仍然通过路由约束校验和 capability governance
- **AND** 合法的指令语法 MUST NOT 被当作调用某 capability 的授权

### Requirement: Agent Web Request 不携带目标指令

agent-web public submit request SHALL NOT 接受 `routingConstraints.targetSkill` 或 `routingConstraints.targetRecipe`。Web 用户 SHALL 通过在用户问题文本中包含 `$skill:<name>` 或 `$workflow:<name>` 来指定 skill 或 workflow 目标。router SHALL 在 runtime acceptance 之后从已接受的 request 文本推导目标路由约束。

#### Scenario: Web request 不携带显式目标字段
- **WHEN** agent-web 收到一个 `inputText="$workflow:push-gate diagnose RAN alarms"` 的普通 submit request
- **THEN** agent-web MUST 把已接受的用户文本转发给 runtime submit
- **AND** agent-web MUST NOT 添加 `routingConstraints.targetRecipe` 或 `routingConstraints.targetSkill`

#### Scenario: Web request 尝试直接携带 targetRecipe
- **WHEN** agent-web 收到一个带有 `routingConstraints.targetRecipe` 的 submit request body
- **THEN** web request schema MUST 拒绝该请求
- **AND** 该请求 MUST NOT 调用 runtime submit

#### Scenario: Web request 尝试直接携带 targetSkill
- **WHEN** agent-web 收到一个带有 `routingConstraints.targetSkill` 的 submit request body
- **THEN** web request schema MUST 拒绝该请求
- **AND** 该请求 MUST NOT 调用 runtime submit

#### Scenario: Web request 携带非目标约束
- **WHEN** agent-web 收到一个带有非目标路由约束（例如 `forbiddenCapabilityIds`、`executionMode`、`maxToolCalls`、`allowHumanInput` 或 `allowSubagents`）的 submit request body
- **THEN** agent-web MAY 在 schema 校验之后把这些约束转发给 runtime submit
- **AND** 目标 Skill 或目标 Recipe MUST 仍然只能由 router 解析已接受的 request 文本推导

### Requirement: 指令冲突处理

当已接受的 request 文本包含多条显式 capability 指令时，router SHALL 只解析指向同一目标类型和名称的无歧义重复引用。相互冲突的指令 MUST fail closed 或进入受治理的 clarification 路径。router MUST NOT 依据位置、模型推断或默认偏好静默选择某个目标。

#### Scenario: 同一指令重复出现
- **WHEN** 已接受的 request 文本多次包含 `$skill:alarm-diagnosis` 且不包含其他 capability 指令
- **THEN** router MAY 把它规范化为一个 skill 目标
- **AND** 规范化后的目标在执行前 MUST 仍然通过 governance

#### Scenario: Skill 与 workflow 指令冲突
- **WHEN** 已接受的 request 文本同时包含 `$skill:alarm-diagnosis` 和 `$workflow:push-gate`
- **THEN** router MUST 拒绝该有歧义的定向路由或创建一个受治理的 clarification
- **AND** 在冲突解决之前它 MUST NOT 执行任何一个目标

#### Scenario: 不同 workflow 指令冲突
- **WHEN** 已接受的 request 文本同时包含 `$workflow:push-gate` 和 `$workflow:release-gate`
- **THEN** router MUST 拒绝该有歧义的定向路由或创建一个受治理的 clarification
- **AND** 它 MUST NOT 静默选择第一条或最后一条指令

### Requirement: 指令治理与 scope 隔离

由指令推导的目标 SHALL 与 request 携带的路由约束接受同样的 Agent Scope、Owner Scope、capability kind、visibility、availability、authorization、budget、cancellation 和 forbidden-capability 检查。指令 MUST NOT 导致查找另一个 Agent、全局 catalog、plugin-private registry 或不可信来源。

#### Scenario: Skill 指令目标在 Agent Scope 之外
- **WHEN** `$skill:alarm-diagnosis` 命名了一个未绑定到当前已接受 Agent assembly 的 skill
- **THEN** 路由 MUST 通过策略声明的路径拒绝或降级
- **AND** 它 MUST NOT 搜索另一个 Agent 或全局 skill catalog

#### Scenario: Workflow 指令目标不是 recipe capability
- **WHEN** `$workflow:push-gate` 解析到一个 kind 不是 `RECIPE` 的 capability
- **THEN** workflow 路由 MUST 把该目标视为 miss 或安全拒绝
- **AND** 它 MUST NOT 以该 workflow 目标名调用 skill、tool、agent 或 model 路径

#### Scenario: 指令目标被禁止
- **WHEN** 一个由指令推导的 capability 目标同时出现在 `forbiddenCapabilityIds` 中
- **THEN** 路由 MUST 拒绝该定向目标
- **AND** 它 MUST NOT 调用该 capability

### Requirement: 指令结果安全且可观察

指令解析和治理 SHALL 为 accepted、rejected、ambiguous、unavailable、forbidden 或 type-mismatch 结果产生安全的路由结果证据。用户可见界面 MUST NOT 暴露超出安全目标名之外的 raw directive payload、策略内部信息、私有 catalog 事实、本地路径、credential 或 provider 诊断。

#### Scenario: 指令目标不可用
- **WHEN** 一个指令目标缺失、被禁用、不可用、未授权、被禁止、超预算、超时、被取消、有歧义或类型不匹配
- **THEN** 路由 MUST 为可观测性产生一个安全的 reason code
- **AND** 用户可见输出 MUST 使用安全的拒绝、clarification、handoff 或声明的 fallback 行为

#### Scenario: 指令解析输入包含不安全语法
- **WHEN** request 文本包含 `$skill:../secret` 或 `$workflow:https://example.invalid/flow`
- **THEN** 指令解析 MUST 把该指令当作无效予以拒绝
- **AND** 除安全 reason code 之外，无效值 MUST NOT 被回显到日志、metric、trace、audit 事件或用户可见错误中
