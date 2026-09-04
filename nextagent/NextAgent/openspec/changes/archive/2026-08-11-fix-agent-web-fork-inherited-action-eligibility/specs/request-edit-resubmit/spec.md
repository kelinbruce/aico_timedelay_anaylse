## Function

- **所属 Function**：`FN-2.1 提交请求`
- **Function 变更类型**：`MODIFIED`
- **spec 角色**：主规格

## MODIFIED Requirements

### Requirement: Agent Web SHALL expose edit only for the current latest turn

仅当 latest target 存在、目标属于当前最新轮次、conversation 不处于界面转换状态且用户拥有 Write permission 时，Agent Web SHALL 提供用户消息 edit 入口和 `/edit` 命令。`metadata.forkInherited: true` SHALL NOT 单独禁用或隐藏任一 edit 入口；Agent Web 提交 edit 请求后，后端 SHALL 判定继承最新轮次的最终资格。进入 edit 模式时，Agent Web SHALL 加载最新原始用户文本、聚焦 Composer，并提供取消和确认操作。从最新用户消息操作进入时，Agent Web SHALL 保留当前普通草稿；执行精确的 `/edit` 命令时，Agent Web SHALL 消费命令文本，并使用空白的 edit 后普通草稿。确认操作 SHALL 要求编辑文本非空白。

**需求类别**：功能性需求

#### Scenario: 较早轮次没有 edit 操作

- **GIVEN** 一条用户消息不属于当前最新轮次
- **WHEN** Agent Web 渲染该消息的操作入口
- **THEN** Agent Web SHALL NOT 提供 edit-resubmit

#### Scenario: 最新继承轮次可进入 edit

- **GIVEN** 最新轮次携带 `metadata.forkInherited: true`
- **AND** 该轮次满足其他既有 edit 入口条件
- **WHEN** 用户从该用户消息或 `/edit` 命令进入编辑
- **THEN** Agent Web SHALL 进入 edit 模式
- **AND** SHALL NOT 因 `forkInherited` 禁用或隐藏 edit 入口

#### Scenario: 进入 edit 时保留普通草稿

- **GIVEN** Composer 中存在普通草稿
- **WHEN** 用户从最新用户消息操作进入 edit 模式
- **THEN** Agent Web SHALL 单独保留普通草稿
- **AND** SHALL 加载并聚焦最新原始用户文本

#### Scenario: Slash edit 消费命令文本

- **WHEN** 用户执行精确的 `/edit` 命令
- **THEN** Agent Web SHALL 进入最新轮次的 edit 模式
- **AND** 取消或成功后 SHALL 恢复空白普通草稿，而不是 `/edit`

#### Scenario: 后端拒绝继承轮次 edit

- **WHEN** Agent Web 已提交最新继承轮次 edit
- **AND** 后端因目标已过期、存在 active runtime work、附件不可用、scope 不匹配或 durable fork source 不可用而拒绝
- **THEN** Agent Web SHALL 按既有失败协调规则保留用户输入并展示安全结果
- **AND** Agent Web SHALL NOT 将 `forkInherited` 当作后端资格判断的替代项

## REMOVED Requirements

### Requirement: Agent Web 禁用继承 latest turn 的 edit 入口

**Reason**：该禁用契约与已经交付的继承最新轮次 edit-resubmit 能力相冲突，并阻止合法请求到达后端权威校验边界。

**Migration**：使用修改后的“Agent Web SHALL expose edit only for the current latest turn”；`forkInherited` 仅保留 provenance 语义，其他 edit 入口条件保持不变。

## Function 变更汇总

### 处理过程

- **变更类型**：修改
- **目标内容**：系统根据 latest target、界面转换状态和 Write permission 暴露 edit；继承来源不构成额外禁用条件，后端继续执行权威资格校验。
- **依据 Requirements**：`Agent Web SHALL expose edit only for the current latest turn`

### 结果

- **变更类型**：修改
- **目标内容**：符合条件的最新继承轮次可进入 edit 模式；后端拒绝时保留用户输入并展示既有安全失败结果。
- **依据 Requirements**：`Agent Web SHALL expose edit only for the current latest turn`
