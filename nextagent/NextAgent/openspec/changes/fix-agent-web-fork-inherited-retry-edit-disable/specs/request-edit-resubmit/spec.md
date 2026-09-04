## Function

- **所属 Function**：`FN-2.1 提交请求`
- **Function 变更类型**：`MODIFIED`
- **spec 角色**：主规格

## MODIFIED Requirements

### Requirement: Agent Web SHALL expose edit only for the current latest turn

仅当 latest target 存在、目标属于当前最新轮次、conversation 不处于界面转换状态且用户拥有 Write permission 时，Agent Web SHALL 提供用户消息 edit 入口和 `/edit` 命令。当 `metadata.forkInherited: true` 时，Agent Web MUST 禁用 edit 入口，呈现禁用视觉态（`not-allowed` 光标、降低透明度），并在悬浮时通过 Tooltip 展示继承轮次不可编辑的原因说明。进入 edit 模式时，Agent Web SHALL 加载最新原始用户文本、聚焦 Composer，并提供取消和确认操作。从最新用户消息操作进入时，Agent Web SHALL 保留当前普通草稿；执行精确的 `/edit` 命令时，Agent Web SHALL 消费命令文本，并使用空白的 edit 后普通草稿。确认操作 SHALL 要求编辑文本非空白。

在当前 Web text-only Edit 中，当 trim 后的编辑文本与进入 edit 模式时加载的原始用户文本相同、未选择新的 Skill 定向且附件队列为空时，Agent Web SHALL 将确认操作处理为未变化 Edit：MUST NOT 发送 edit request，MUST NOT 隐藏或替换原轮次，MUST 保持 edit 模式和当前文本，并 MUST 显示"内容未修改"的非错误提示。用户需要重新生成相同问题答案时，界面 MUST 继续提供独立的 Retry 操作，MUST NOT 把未变化 Edit 静默转换为 Retry。

当 trim 后文本发生变化或选择了新的 Skill 定向时，Agent Web SHALL 沿用既有 Edit 提交与完整原轮次 replacement 行为。附件队列非空时，Agent Web SHALL 沿用既有 Web Edit 拒绝行为，MUST NOT 将其归类为未变化 Edit。

**需求类别**：功能性需求

#### Scenario: 较早轮次没有 edit 操作

- **GIVEN** 一条用户消息不属于当前最新轮次
- **WHEN** Agent Web 渲染该消息的操作入口
- **THEN** Agent Web SHALL NOT 提供 edit-resubmit

#### Scenario: 最新继承轮次禁用 edit

- **GIVEN** 最新轮次携带 `metadata.forkInherited: true`
- **AND** 该轮次满足其他既有 edit 入口条件
- **WHEN** Agent Web 渲染该用户消息的 edit 入口
- **THEN** Agent Web MUST 呈现禁用态
- **AND** 点击 edit 入口 MUST NOT 进入 edit 模式
- **AND** 悬浮时 MUST 展示继承轮次不可编辑的原因说明

#### Scenario: 非 inherited latest turn 正常暴露 edit

- **GIVEN** 最新轮次不携带 `metadata.forkInherited: true`
- **AND** 会话不处于界面转换状态且用户拥有 Write permission
- **WHEN** 用户从该用户消息或 `/edit` 命令进入编辑
- **THEN** Agent Web SHALL 进入 edit 模式

#### Scenario: 进入 edit 时保留普通草稿

- **GIVEN** Composer 中存在普通草稿
- **WHEN** 用户从最新用户消息操作进入 edit 模式
- **THEN** Agent Web SHALL 单独保留普通草稿
- **AND** SHALL 加载并聚焦最新原始用户文本

#### Scenario: Slash edit 消费命令文本

- **WHEN** 用户执行精确的 `/edit` 命令
- **THEN** Agent Web SHALL 进入最新轮次的 edit 模式
- **AND** 取消或成功后 SHALL 恢复空白普通草稿，而不是 `/edit`

#### Scenario: 未变化 Edit 不创建 replacement

- **GIVEN** 用户进入最新轮次的 edit 模式
- **AND** trim 后文本与进入 edit 模式时加载的原始用户文本相同
- **AND** 未选择新的 Skill 定向
- **AND** 附件队列为空
- **WHEN** 用户确认 Edit
- **THEN** Agent Web MUST NOT 发送 edit request
- **AND** MUST NOT 隐藏或替换原轮次
- **AND** MUST 保持 edit 模式和当前文本
- **AND** MUST 显示"内容未修改"的提示

#### Scenario: 未变化 Edit 不转换为 Retry

- **GIVEN** 用户确认未变化 Edit
- **WHEN** Agent Web 阻止该操作
- **THEN** Agent Web MUST NOT 发送 retry request
- **AND** 原 request 的 attempt、Retry 次数和当前可见结果 MUST 保持不变

#### Scenario: 文本变化继续执行 Edit replacement

- **GIVEN** 用户进入最新轮次的 edit 模式
- **AND** trim 后文本与原始用户文本不同
- **WHEN** 用户确认 Edit
- **THEN** Agent Web SHALL 发送既有 edit request
- **AND** 接受成功后 SHALL 以新 request 替换完整原轮次

#### Scenario: 新 Skill 定向构成有效变化

- **GIVEN** trim 后文本与原始用户文本相同
- **AND** 用户选择了新的 Skill 定向
- **WHEN** 用户确认 Edit
- **THEN** Agent Web SHALL 发送包含该定向的既有 edit request
- **AND** SHALL NOT 将该操作归类为未变化 Edit

#### Scenario: 附件队列继续使用既有拒绝行为

- **GIVEN** 用户处于 edit 模式且附件队列非空
- **WHEN** 用户确认 Edit
- **THEN** Agent Web SHALL 按既有 Web Edit 附件限制拒绝提交
- **AND** MUST 保留编辑文本和附件队列
- **AND** MUST NOT 显示"内容未修改"提示

#### Scenario: 最新继承轮次可进入 edit

- **GIVEN** 最新轮次携带 `metadata.forkInherited: true`
- **AND** 该轮次满足其他既有 edit 入口条件
- **WHEN** 用户从该用户消息或 `/edit` 命令请求进入编辑
- **THEN** Agent Web MUST 保持 edit 入口为禁用态
- **AND** SHALL NOT 因该请求进入 edit 模式

#### Scenario: 后端拒绝继承轮次 edit

- **WHEN** Agent Web 已提交最新继承轮次 edit
- **AND** 后端因目标已过期、存在 active runtime work、附件不可用、scope 不匹配或 durable fork source 不可用而拒绝
- **THEN** Agent Web SHALL 按既有失败协调规则保留用户输入并展示安全结果
- **AND** Agent Web SHALL NOT 将 `forkInherited` 当作后端资格判断的替代项

## Function 变更汇总

### 处理过程

- **变更类型**：修改
- **目标内容**：Agent Web 对最新继承轮次禁用 edit 入口并展示说明性 tooltip；非 inherited 轮次和既有 edit 协调不变。
- **依据 Requirements**：`Agent Web SHALL expose edit only for the current latest turn`

### 结果

- **变更类型**：修改
- **目标内容**：继承轮次显示禁用 edit 入口；非 inherited 轮次正常暴露 edit。
- **依据 Requirements**：`Agent Web SHALL expose edit only for the current latest turn`
