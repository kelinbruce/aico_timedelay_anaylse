## Purpose

This specification defines the high-frequency question UI components, including GuideArea container, dynamic data fetching, and pin-to-frequent icon interaction.
## Requirements
### Requirement: GuideArea 参数化容器

WelcomeState SHALL 使用参数化 `GuideArea` 容器替代直接渲染 `HighFrequencyQuestions`。容器 SHALL 通过参数控制渲染 HighFrequencyQuestions 或自定义组件，默认渲染 HighFrequencyQuestions。GuideArea 的宽度 SHALL 与 WelcomeState 内容区宽度一致。

#### Scenario: 默认渲染高频问题
- **WHEN** WelcomeState 渲染 GuideArea 且参数为默认值
- **THEN** GuideArea MUST 渲染 HighFrequencyQuestions 组件

#### Scenario: 参数指定自定义组件
- **WHEN** GuideArea 参数指定为自定义组件
- **THEN** GuideArea MUST 渲染自定义组件

### Requirement: HighFrequencyQuestions 动态数据获取

HighFrequencyQuestions 组件 SHALL 通过 `GET /api/v1/frequent-questions?locale={site.locale}` 获取动态排序的高频问题列表。当 API 返回空列表时，组件 MUST fallback 到 i18n 硬编码的 4 个默认问题。当 API 请求失败时，组件 MUST 也 fallback 到 i18n 硬编码默认问题，MUST NOT 向用户报错。组件 MUST 最多展示 3 行高频问题，超出部分截断。

#### Scenario: API 返回问题列表
- **WHEN** `GET /api/v1/frequent-questions` 返回 `questions.length > 0`
- **THEN** 组件 MUST 渲染返回的问题列表
- **AND** 问题项样式 MUST 符合现有 `agent-web-high-frequency-questions` spec 定义

#### Scenario: API 返回空列表
- **WHEN** `GET /api/v1/frequent-questions` 返回 `questions: []`
- **THEN** 组件 MUST fallback 到 i18n 硬编码 4 个默认问题

#### Scenario: API 请求失败
- **WHEN** API 请求失败或网络错误
- **THEN** 组件 MUST fallback 到 i18n 硬编码 4 个默认问题
- **AND** MUST NOT 向用户显示错误

#### Scenario: 最多展示 3 行
- **WHEN** 返回的问题列表超过 3 行可展示数量
- **THEN** 组件 MUST 截断展示为 3 行
- **AND** MUST NOT 出现垂直滚动条

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
