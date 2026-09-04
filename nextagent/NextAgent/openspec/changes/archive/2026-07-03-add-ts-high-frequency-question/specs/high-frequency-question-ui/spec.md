## ADDED Requirements

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

用户消息的 BubbleActions（`bubble="user"`）SHALL 在复制图标和编辑图标之间渲染「添加到常问」图标。图标 SHALL 始终使用 `FolderAddOutlined`，不区分已添加/未添加态。Tooltip 文案 SHALL 为"收藏此问题，用于快速提问和输入联想"。图标 MUST 仅在用户消息的 BubbleActions 中出现，MUST NOT 在 assistant 消息中出现。图标 MUST 被 `AuthGate`（`AICOServiceOperation.Write`）包裹。

点击图标时 SHALL 调用 `POST /api/v1/user-questions/pin`，成功后 SHALL 通过消息气泡（toast/message）提示用户"已添加至常用问题"。API 调用失败时 SHALL 提示用户操作失败。图标状态 MUST NOT 因点击而改变（始终为 `FolderAddOutlined`）。重复 pin 同一问题时后端保证幂等，前端也 MUST 显示成功提示。

#### Scenario: 渲染添加到常问图标
- **WHEN** 用户消息 hover 时 BubbleActions 可见
- **THEN** 在复制和编辑图标之间 MUST 存在「添加到常问」图标
- **AND** 图标 MUST 为 `FolderAddOutlined`
- **AND** 图标 MUST 被 AuthGate 包裹

#### Scenario: 点击添加到常问
- **WHEN** 有写权限的用户点击「添加到常问」图标
- **THEN** 前端 MUST 调用 `POST /api/v1/user-questions/pin`
- **AND** 成功后 MUST 通过消息气泡提示"已添加至常用问题"
- **AND** 图标 MUST 保持为 `FolderAddOutlined`

#### Scenario: API 失败时提示
- **WHEN** pin API 调用失败
- **THEN** 前端 MUST 通过消息气泡提示操作失败
- **AND** 图标 MUST 保持为 `FolderAddOutlined`

#### Scenario: 重复点击同一问题
- **WHEN** 用户对同一问题多次点击「添加到常问」
- **THEN** 每次 MUST 调用 pin API
- **AND** 后端返回成功时前端 MUST 显示"已添加至常用问题"提示

#### Scenario: 仅用户消息显示
- **WHEN** 渲染 assistant 消息的 BubbleActions
- **THEN** MUST NOT 出现「添加到常问」图标

#### Scenario: 无写权限时不显示
- **WHEN** 用户无写权限
- **THEN** 「添加到常问」图标 MUST NOT 渲染

#### Scenario: 超长问题截断提示
- **WHEN** 用户点击「添加到常问」图标且问题文本超过 `PIN_QUESTION_MAX_LENGTH`（2000）字符
- **THEN** 前端 MUST 显示截断提示消息气泡
- **AND** MUST 将截断至 2000 字符后的文本发送到 pin API
- **AND** 图标 MUST 保持为 `FolderAddOutlined`
