## Function

- **所属 Function**：`FN-2.8 指令定向请求处理`
- **Function 变更类型**：`MODIFIED`
- **spec 角色**：主规格

## MODIFIED Requirements

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

## Function 变更汇总

### 描述

- **变更类型**：修改
- **目标内容**：directive 剥离后有效用户问题为空字符串时，系统拒绝请求并返回安全校验错误，不持久化空 content、不进入下游执行。
- **依据 Requirements**：`Directive 生成有效用户问题`

### 输入

- **变更类型**：修改
- **目标内容**：新增“纯 `$skill:<name>` / `$workflow:<name>` 指令无附加文本”输入场景。
- **依据 Requirements**：`Directive 生成有效用户问题`

### 输出

- **变更类型**：修改
- **目标内容**：有效问题为空时产生安全失败结果（`CAPABILITY_DIRECTIVE_EFFECTIVE_QUESTION_EMPTY`），不产生可执行路由目标或空用户问题。
- **依据 Requirements**：`Directive 生成有效用户问题`

### 处理过程

- **变更类型**：修改
- **目标内容**：directive 剥离并裁剪首尾空白后，若结果为空字符串则停止下游执行并返回安全校验错误。
- **依据 Requirements**：`Directive 生成有效用户问题`

### 结果

- **变更类型**：修改
- **目标内容**：纯 directive 输入不再产生空 USER message content 或不可见对话气泡。
- **依据 Requirements**：`Directive 生成有效用户问题`

### 主规格

- **变更类型**：无变化
- **目标内容**：`directive-capability-routing`
- **依据 Requirements**：`Directive 生成有效用户问题`
