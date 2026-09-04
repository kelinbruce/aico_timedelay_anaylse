## Function

- **所属 Function**：`FN-1.12 标注对话`
- **Function 变更类型**：`MODIFIED`
- **spec 角色**：主规格

## ADDED Requirements

### Requirement: 前端对话标注控制

`agent-web` MUST 在每轮问答的助手回复操作行中按复制、点赞、点踩、收藏、重新生成的顺序常驻展示操作；仅当 request run 已进入 terminal 状态且存在回复内容时，系统 MUST 展示点赞、点踩和收藏控件。

点赞和点踩 MUST 作为同一评价字段的互斥选择；收藏 MUST 作为独立选择。用户操作任一标注控件时，系统 MUST 立即投影目标状态并提交对应标注写入。写入失败时，系统 MUST 回滚该次乐观投影并显示安全错误反馈。

用户打开已存在的 session 时，系统 MUST 读取该 session 的标注，并按 `requestRunId` 恢复每个已标注 turn 的点赞、点踩和收藏状态。读取期间，相关标注控件 MUST 禁用；读取失败时，系统 MUST 显示安全错误反馈且 MUST NOT 把未确认状态投影为已持久化状态。

**需求类别**：功能性需求

#### Scenario: 点赞与点踩互斥切换
- **WHEN** 用户点击未标注 turn 的点赞控件
- **THEN** 系统 MUST 立即高亮点赞控件并保持点踩控件未选中
- **WHEN** 用户随后点击同一 turn 的点踩控件
- **THEN** 系统 MUST 立即高亮点踩控件并取消点赞高亮

#### Scenario: 收藏与评价独立
- **WHEN** turn 已处于点赞状态
- **AND** 用户点击该 turn 的收藏控件
- **THEN** 系统 MUST 同时显示点赞和收藏为已选中
- **AND** 收藏操作 MUST NOT 清除点赞状态

#### Scenario: 重新打开会话恢复标注
- **WHEN** 用户重新打开包含已持久化标注的 session
- **THEN** 系统 MUST 按 `requestRunId` 恢复对应 turn 的点赞、点踩和收藏状态

#### Scenario: 标注写入失败回滚
- **WHEN** 用户操作标注控件后写入失败
- **THEN** 系统 MUST 恢复该操作前的控件状态
- **AND** 系统 MUST 显示安全错误反馈

#### Scenario: 非终态回复不提供标注
- **WHEN** request run 尚未进入 terminal 状态或没有回复内容
- **THEN** 系统 MUST NOT 展示点赞、点踩或收藏控件

## Function 变更汇总

### 处理过程

- **变更类型**：修改
- **目标内容**：系统在 terminal 回复上提供相互独立的评价与收藏控制，提交时即时投影目标状态，并在会话打开、读取失败或写入失败时给出确定的恢复与反馈结果。
- **依据 Requirements**：`前端对话标注控制`

### 主规格

- **变更类型**：新增
- **目标内容**：`conversation-annotation-controls`
- **依据 Requirements**：`前端对话标注控制`
