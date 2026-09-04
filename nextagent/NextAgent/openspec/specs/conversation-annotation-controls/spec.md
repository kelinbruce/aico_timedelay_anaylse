# conversation-annotation-controls Specification

## Purpose
定义 `agent-web` 在每轮问答助手回复操作行中提供的标注控件行为：复制、点赞、点踩、收藏和重新生成的展示顺序、terminal 状态前置条件、评价互斥与收藏独立性、乐观投影与失败回滚、会话打开时按 `requestRunId` 恢复标注状态，以及非终态回复不提供标注。该控件行为跨 Local、Immersive 和 Collaborative 共享对话渲染路径复用，宿主 shell 不拥有标注写入或 turn 控件状态。
## Requirements
### Requirement: 前端对话标注控制

agent-web MUST 在每轮问答的助手回复操作行中按复制、点赞、点踩、收藏、重新生成的顺序常驻展示操作；仅当 request run 已进入 terminal 状态且存在回复内容时，系统 MUST 展示点赞、点踩和收藏控件。

点赞和点踩 MUST 作为同一评价字段的互斥选择；收藏 MUST 作为独立选择。用户操作任一标注控件时，系统 MUST 立即投影目标状态并提交对应标注写入。写入成功后，系统 MUST 按当前语言展示与本次操作一致的成功提示：添加点赞、取消点赞、添加点踩、取消点踩、添加收藏或取消收藏。写入失败时，系统 MUST 回滚该次乐观投影并显示安全错误反馈，且 MUST NOT 展示成功提示。

用户打开已存在的 session 时，系统 MUST 读取该 session 的标注，并按 `requestRunId` 恢复每个已标注 turn 的点赞、点踩和收藏状态。读取期间，相关标注控件 MUST 禁用；读取失败时，系统 MUST 显示安全错误反馈且 MUST NOT 把未确认状态投影为已持久化状态。

**需求类别**：功能性需求

#### Scenario: 标注写入成功提示

- **WHEN** 用户对 terminal 回复执行点赞、点踩或收藏操作
- **AND** 标注写入成功
- **THEN** 系统 MUST 展示当前语言下与本次操作一致的成功提示
- **AND** 未改变的评价或收藏状态 MUST 保持不变

#### Scenario: 取消标注写入成功提示

- **WHEN** 用户取消已有点赞、点踩或收藏
- **AND** 标注写入成功
- **THEN** 系统 MUST 展示当前语言下对应的取消成功提示

#### Scenario: 标注写入失败回滚

- **WHEN** 用户执行任一回答标注操作
- **AND** 标注写入失败
- **THEN** 系统 MUST 回滚操作前状态
- **AND** 系统 MUST 显示安全错误反馈
- **AND** 系统 MUST NOT 展示成功提示

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

#### Scenario: 非终态回复不提供标注

- **WHEN** request run 尚未进入 terminal 状态或没有回复内容
- **THEN** 系统 MUST NOT 展示点赞、点踩或收藏控件
