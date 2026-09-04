# directive-capability-routing Specification

## Purpose

Define natural-language `$skill:` and `$workflow:` capability directives, their safe parsing, routing constraint mapping, conflict handling, channel boundary and governance requirements.
## Function

- **所属 Function**：`FN-2.8 指令定向请求处理`
- **Function 变更类型**：`MODIFIED`
- **spec 角色**：主规格
## Requirements
### Requirement: Natural Language Capability Directives

The router SHALL recognize explicit capability directives in accepted natural-language request text using only the `$skill:<name>` and `$workflow:<name>` forms. The directive name MUST be parsed as a safe capability identifier and MUST NOT contain whitespace, path separators, shell metacharacters, URL syntax, credentials, owner scope fields, agent scope fields, provider overrides, prompt text, or hidden runtime coordinates.

#### Scenario: Skill directive is parsed
- **WHEN** accepted request text contains exactly one `$skill:alarm-diagnosis` directive
- **THEN** router MUST parse a skill directive with target name `alarm-diagnosis`
- **AND** router MUST NOT execute the skill during parsing

#### Scenario: Workflow directive is parsed
- **WHEN** accepted request text contains exactly one `$workflow:push-gate` directive
- **THEN** router MUST parse a workflow directive with target name `push-gate`
- **AND** router MUST NOT execute the workflow during parsing

#### Scenario: UI slash command is not natural-language directive syntax
- **WHEN** accepted request text contains `/skill alarm-diagnosis` or `/workflow push-gate`
- **THEN** natural-language directive parsing MUST NOT treat that text as `$skill:` or `$workflow:` syntax
- **AND** any slash-command interpretation MUST belong to the UI command boundary before request submission

### Requirement: Directive Mapping to Routing Constraints

Parsed directives SHALL only produce typed routing targets for the current request. `$skill:<name>` MUST map only to the governed skill routing target. `$workflow:<name>` MUST map only to `routingConstraints.targetRecipe`. The system MUST NOT reuse skill target fields to carry workflow semantics or workflow target fields to carry skill semantics.

#### Scenario: Skill directive maps to skill target
- **WHEN** router parses `$skill:alarm-diagnosis`
- **THEN** it MUST produce a skill routing target for `alarm-diagnosis`
- **AND** it MUST NOT set `routingConstraints.targetRecipe`

#### Scenario: Workflow directive maps to targetRecipe
- **WHEN** router parses `$workflow:push-gate`
- **THEN** it MUST produce `routingConstraints.targetRecipe=push-gate`
- **AND** it MUST NOT set or overwrite a skill routing target

#### Scenario: Directive does not grant execution authority
- **WHEN** router maps a parsed directive to a typed routing target
- **THEN** the mapped target MUST still pass routing constraint validation and capability governance before execution
- **AND** schema-valid directive syntax MUST NOT be treated as authorization to invoke a capability

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

### Requirement: Directive Conflict Handling

When accepted request text contains multiple explicit capability directives, router SHALL resolve only unambiguous repeated references to the same target type and name. Conflicting directives MUST fail closed or enter a governed clarification path. Router MUST NOT silently choose one target by position, model inference, or default preference.

#### Scenario: Same directive repeated
- **WHEN** accepted request text contains `$skill:alarm-diagnosis` more than once and contains no other capability directive
- **THEN** router MAY normalize it to one skill target
- **AND** the normalized target MUST still pass governance before execution

#### Scenario: Skill and workflow directives conflict
- **WHEN** accepted request text contains `$skill:alarm-diagnosis` and `$workflow:push-gate`
- **THEN** router MUST reject the ambiguous directed route or create a governed clarification
- **AND** it MUST NOT execute either target before the conflict is resolved

#### Scenario: Different workflow directives conflict
- **WHEN** accepted request text contains `$workflow:push-gate` and `$workflow:release-gate`
- **THEN** router MUST reject the ambiguous directed route or create a governed clarification
- **AND** it MUST NOT choose the first or last directive silently

### Requirement: Directive Governance and Scope Isolation

Directive-derived targets SHALL be governed by the same Agent Scope, Owner Scope, capability kind, visibility, availability, authorization, budget, cancellation, and forbidden-capability checks as request-carried routing constraints. A directive MUST NOT cause lookup in another Agent, global catalog, plugin-private registry, or untrusted source.

#### Scenario: Skill directive target is outside Agent Scope
- **WHEN** `$skill:alarm-diagnosis` names a skill not bound to the current accepted Agent assembly
- **THEN** routing MUST reject or degrade through policy-declared paths
- **AND** it MUST NOT search another Agent or global skill catalog

#### Scenario: Workflow directive target is not a recipe capability
- **WHEN** `$workflow:push-gate` resolves to a capability that is not kind `WORKFLOW`
- **THEN** workflow routing MUST treat the target as a miss or safe rejection
- **AND** it MUST NOT invoke a skill, tool, agent, or model path under the workflow target name

#### Scenario: Directive target is forbidden
- **WHEN** a directive-derived capability target is also present in `forbiddenCapabilityIds`
- **THEN** routing MUST reject the directed target
- **AND** it MUST NOT invoke that capability

### Requirement: Directive Outcomes are Safe and Observable

Directive parsing and governance SHALL produce safe routing outcome evidence for accepted, rejected, ambiguous, unavailable, forbidden, or type-mismatch results. User-visible surfaces MUST NOT expose raw directive payload beyond the safe target name, policy internals, private catalog facts, local paths, credentials, or provider diagnostics.

#### Scenario: Directive target is unavailable
- **WHEN** a directive target is missing, disabled, unavailable, unauthorized, forbidden, over budget, timed out, canceled, ambiguous, or type-mismatched
- **THEN** routing MUST produce a safe reason code for observability
- **AND** user-visible output MUST use safe rejection, clarification, handoff, or declared fallback behavior

#### Scenario: Directive parse input contains unsafe syntax
- **WHEN** request text contains `$skill:../secret` or `$workflow:https://example.invalid/flow`
- **THEN** directive parsing MUST reject that directive as invalid
- **AND** the invalid value MUST NOT be echoed to logs, metrics, traces, audit events, or user-visible errors beyond a safe reason code

### Requirement: Directive 生成有效用户问题

当已接受的用户输入包含一个有效且无冲突的 `$skill:<name>` 或 `$workflow:<name>` directive 时，系统 MUST 从用户问题中移除全部已成功识别的 capability directive token；系统 MUST 把移除后仅裁剪首尾空白的剩余文本作为有效用户问题。系统 MUST NOT 把已成功识别的 directive token 作为用户问题内容传给工作流、模型或后续会话上下文。当移除全部已识别 directive token 并裁剪首尾空白后有效用户问题为空字符串时，系统 MUST 拒绝该请求并返回安全校验错误，MUST NOT 把空字符串作为有效用户问题持久化或传给下游执行。

**需求类别**：功能性需求

#### Scenario: Workflow directive 前缀从有效问题中移除

- **WHEN** 用户提交 `inputText="$workflow:ran-alarm-diagnosis diagnose RAN alarms"`
- **THEN** 系统 MUST 生成 `targetRecipe=ran-alarm-diagnosis`
- **AND** 系统 MUST 生成有效用户问题 `diagnose RAN alarms`
- **AND** 工作流 `input_question` MUST 等于 `diagnose RAN alarms`

#### Scenario: Skill directive 前缀从模型输入中移除

- **WHEN** 用户提交 `inputText="$skill:alarm-diagnosis diagnose alarms"`
- **THEN** 系统 MUST 生成目标 Skill `alarm-diagnosis`
- **AND** 该请求及后续轮次的模型用户消息 MUST 包含 `diagnose alarms`
- **AND** 该请求及后续轮次的模型用户消息 MUST NOT 包含 `$skill:alarm-diagnosis`

#### Scenario: 相同 directive 的重复引用全部移除

- **WHEN** 用户输入包含两个 `$skill:alarm-diagnosis` 且不包含其他 capability directive
- **THEN** 系统 MUST 生成恰好一个目标 Skill `alarm-diagnosis`
- **AND** 系统 MUST 从有效用户问题中移除两个 directive token

#### Scenario: 无 directive 的问题保持不变

- **WHEN** 用户输入不包含 `$skill:` 或 `$workflow:` directive
- **THEN** 系统 MUST 把原输入作为有效用户问题
- **AND** 系统 MUST NOT 生成 directive-derived routing target

#### Scenario: 非前缀 directive 只移除已识别 token

- **WHEN** 用户提交 `inputText="please use $skill:alarm-diagnosis to diagnose alarms"`
- **THEN** 系统 MUST 移除 `$skill:alarm-diagnosis`
- **AND** 系统 MUST 保留 directive token 以外的字符顺序和内容
- **AND** 系统 MUST 只裁剪结果的首尾空白

#### Scenario: 纯 directive 无附加文本时有效问题为空被拒绝

- **WHEN** 用户提交 `inputText="$skill:bom-test-skill"` 且移除该 directive token 并裁剪首尾空白后有效用户问题为空字符串
- **THEN** 系统 MUST 拒绝该请求并返回安全校验错误 `CAPABILITY_DIRECTIVE_EFFECTIVE_QUESTION_EMPTY`
- **AND** 系统 MUST NOT 把空字符串持久化为 USER message content
- **AND** 系统 MUST NOT 生成可执行的 directive-derived routing target 或进入 Skill、Workflow 或模型执行路径

#### Scenario: 纯 workflow directive 无附加文本时有效问题为空被拒绝

- **WHEN** 用户提交 `inputText="$workflow:push-gate"` 且移除该 directive token 并裁剪首尾空白后有效用户问题为空字符串
- **THEN** 系统 MUST 拒绝该请求并返回安全校验错误 `CAPABILITY_DIRECTIVE_EFFECTIVE_QUESTION_EMPTY`
- **AND** 系统 MUST NOT 把空字符串持久化为 USER message content

### Requirement: 有效用户问题成为持久化和执行事实

对于包含有效且无冲突 capability directive 的已接受请求，系统 MUST 把有效用户问题保存为该请求的可见 USER message content。系统 MUST 使用同一个有效用户问题构造当前请求的工作流输入和模型用户消息。系统 MUST 把 directive-derived routing target 保存为与 USER message content 分离的结构化请求路由事实。

**需求类别**：功能性需求

#### Scenario: 可见历史只保存有效问题

- **WHEN** 包含 `$workflow:ran-alarm-diagnosis` 的请求被接受并保存
- **THEN** 会话历史中的对应 USER message content MUST 等于有效用户问题
- **AND** 该 content MUST NOT 包含 `$workflow:ran-alarm-diagnosis`
- **AND** 请求仍 MUST 保留结构化 `targetRecipe=ran-alarm-diagnosis`

#### Scenario: Skill 路由结果与有效问题同时可用

- **WHEN** 包含 `$skill:alarm-diagnosis` 的请求进入受治理 Skill 路由
- **THEN** Skill 路由 MUST 消费结构化目标 Skill `alarm-diagnosis`
- **AND** 下游模型 MUST 消费不含该 directive 的有效用户问题

### Requirement: 重试编辑与恢复保持净化语义

系统 MUST 在 retry 和 local recovery 时从已保存的有效用户问题与结构化请求路由事实重建请求。系统 MUST NOT 通过在 USER message content 中保留或重新拼接 capability directive 来恢复路由。Edit MUST 对编辑后的输入重新执行 directive 解析与有效用户问题生成，并 MUST NOT 继承被替换请求的 directive-derived routing target。

**需求类别**：系统质量属性

**质量属性**：可靠性/恢复

**适用范围**：该 Function

#### Scenario: Workflow retry 保持路由且不恢复 directive

- **WHEN** 用户重试一个由 `$workflow:ran-alarm-diagnosis` 定向且已完成的请求
- **THEN** retry MUST 继续使用 `targetRecipe=ran-alarm-diagnosis`
- **AND** retry 的有效用户问题和工作流 `input_question` MUST NOT 包含 `$workflow:ran-alarm-diagnosis`

#### Scenario: Skill retry 保持路由且模型输入净化

- **WHEN** 用户重试一个由 `$skill:alarm-diagnosis` 定向且已完成的请求
- **THEN** retry MUST 继续使用目标 Skill `alarm-diagnosis`
- **AND** retry 的模型用户消息 MUST NOT 包含 `$skill:alarm-diagnosis`

#### Scenario: Edit 使用新输入事实

- **WHEN** 用户把最新请求编辑为 `$workflow:transport-diagnosis diagnose transport alarms`
- **THEN** 新请求 MUST 使用 `targetRecipe=transport-diagnosis`
- **AND** 新请求的有效用户问题 MUST 等于 `diagnose transport alarms`
- **AND** 新请求 MUST NOT 继承被替换请求的 directive-derived routing target

#### Scenario: Local recovery 保持结构化目标

- **WHEN** local recovery 重建一个尚未终结且包含 directive-derived routing target 的请求
- **THEN** 恢复后的请求 MUST 使用已保存的结构化路由事实
- **AND** 恢复后的有效用户问题 MUST 等于已保存的 USER message content

### Requirement: 非成功解析不产生净化路由事实

当 capability directive 非法或多个 directive 冲突时，系统 MUST 保持现有 fail-closed routing outcome。系统 MUST NOT 从非法或冲突 directive 生成可执行结构化路由目标。系统 MUST NOT 把部分解析结果当作成功净化结果继续执行 Skill、Workflow 或模型路径。

**需求类别**：功能性需求

#### Scenario: Skill 与 Workflow directive 冲突

- **WHEN** 用户输入同时包含 `$skill:alarm-diagnosis` 和 `$workflow:ran-alarm-diagnosis`
- **THEN** 系统 MUST 产生安全拒绝或受治理澄清
- **AND** 系统 MUST NOT 生成可执行 target Skill 或 `targetRecipe`
- **AND** 系统 MUST NOT 进入 Skill、Workflow 或模型执行路径
#### Scenario: Directive 名称非法

- **WHEN** 用户输入包含 `$skill:../secret`
- **THEN** 系统 MUST 产生安全拒绝
- **AND** 系统 MUST NOT 生成结构化路由目标
- **AND** 系统 MUST NOT 进入 Skill、Workflow 或模型执行路径
