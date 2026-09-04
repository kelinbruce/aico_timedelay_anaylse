所属 Function：FN-1.19 收藏问题
Function 变更类型：修改
spec 角色：主规格

## MODIFIED Requirements

### Requirement: 用户消息「添加到常问」图标

需求类别：功能性需求。用户消息的 BubbleActions（`bubble="user"`）SHALL 在复制图标和编辑图标之间渲染问题收藏图标。图标 MUST 仅在用户消息的 BubbleActions 中出现，MUST NOT 在 assistant 消息中出现。图标 MUST 被 `AuthGate`（`AICOServiceOperation.Write`）包裹。

图标 MUST 反映该问题所属 run 的标注收藏状态（`isQuestionFavorited`）：未收藏时显示 `FolderOutlined`，已收藏时显示高亮的 `FolderFilled`。Tooltip 文案 MUST 随状态切换：未收藏时为"收藏此问题，用于快速提问和输入联想"，已收藏时为"取消收藏"。

点击图标时 SHALL 按当前收藏状态取反执行：未收藏时通过 `POST /api/v1/sessions/:sessionId/runs/:runId/annotations` 写入 `isQuestionFavorited=true` 完成收藏，已收藏时写入 `isQuestionFavorited=false` 完成取消收藏。收藏成功后 SHALL 通过消息气泡提示"已添加至常用问题"；取消收藏成功后 SHALL 提示"已取消收藏"。API 调用失败时 SHALL 提示操作失败，且图标 MUST 保持操作前状态。

常用问题面板与输入联想列表 MUST NOT 渲染问题收藏图标或取消收藏入口。

#### Scenario: 未收藏态渲染
- **WHEN** 用户消息 hover 时 BubbleActions 可见，且该问题所属 run 无标注或标注的 `isQuestionFavorited=false`
- **THEN** 在复制和编辑图标之间 MUST 存在问题收藏图标
- **AND** 图标 MUST 为 `FolderOutlined`
- **AND** tooltip MUST 为"收藏此问题，用于快速提问和输入联想"
- **AND** 图标 MUST 被 AuthGate 包裹

#### Scenario: 已收藏态渲染
- **WHEN** 用户消息 hover 时 BubbleActions 可见，且该问题所属 run 的标注 `isQuestionFavorited=true`
- **THEN** 问题收藏图标 MUST 为高亮的 `FolderFilled`
- **AND** tooltip MUST 为"取消收藏"

#### Scenario: 点击收藏未收藏问题
- **WHEN** 有写权限的用户对未收藏问题点击问题收藏图标
- **THEN** 前端 MUST 调用 `POST /api/v1/sessions/:sessionId/runs/:runId/annotations` 并写入 `isQuestionFavorited=true`
- **AND** 成功后 MUST 通过消息气泡提示"已添加至常用问题"
- **AND** 图标 MUST 变为高亮的 `FolderFilled`

#### Scenario: 点击取消已收藏问题
- **WHEN** 有写权限的用户对已收藏问题点击问题收藏图标
- **THEN** 前端 MUST 调用 `POST /api/v1/sessions/:sessionId/runs/:runId/annotations` 并写入 `isQuestionFavorited=false`
- **AND** 成功后 MUST 通过消息气泡提示"已取消收藏"
- **AND** 图标 MUST 变为 `FolderOutlined`

#### Scenario: API 失败时回滚
- **WHEN** 收藏或取消收藏的 API 调用失败
- **THEN** 前端 MUST 通过消息气泡提示操作失败
- **AND** 图标 MUST 保持操作前状态

#### Scenario: 仅用户消息显示
- **WHEN** 渲染 assistant 消息的 BubbleActions
- **THEN** MUST NOT 出现问题收藏图标

#### Scenario: 无写权限时不显示
- **WHEN** 用户无写权限
- **THEN** 问题收藏图标 MUST NOT 渲染

#### Scenario: 常用问题面板与联想列表无收藏入口
- **WHEN** 渲染常用问题面板或输入联想列表
- **THEN** MUST NOT 渲染问题收藏图标或取消收藏入口

## Function 变更汇总

### 处理过程

- 变更类型：修改
- 目标内容：用户通过问题气泡悬浮操作区的问题收藏图标收藏或取消收藏问题；系统按用户操作将目标 run 的问题收藏事实置为已收藏或取消收藏，取消后该问题不再进入常用问题列表与输入联想的收藏层。
- 依据 Requirements：用户消息「添加到常问」图标

### 结果

- 变更类型：修改
- 目标内容：正常：收藏成功或取消收藏成功，均有对应提示；失败：提示操作失败且收藏状态不变。
- 依据 Requirements：用户消息「添加到常问」图标

### 接口

- 变更类型：修改
- 目标内容：`POST /api/v1/sessions/:sessionId/runs/:runId/annotations`（`isQuestionFavorited` 字段）
- 依据 Requirements：用户消息「添加到常问」图标
