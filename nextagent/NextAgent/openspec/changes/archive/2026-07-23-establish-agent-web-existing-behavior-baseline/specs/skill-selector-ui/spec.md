## MODIFIED Requirements

### Requirement: Skill 选择栏组件位置

前端 SHALL 在聊天输入框上方的 `QuickOperatorArea` 中呈现当前 quick operator。当该区域未被 host quick-info capability 覆盖时，容器的 `component` 默认值 SHALL 为 `"skills"` 并渲染 Skill 选择器；显式指定 `"category-questions"` 时 SHALL 渲染分类问题组件。Host quick-info 的覆盖选择由 Stable `aico-piu-injection` capability 拥有，不在本 requirement 中重复定义。Skill 栏宽度 SHALL 与输入框宽度齐平。当当前 Agent Scope 下没有可用 Skill 或 Skill 查询失败时，Skill 栏 MUST NOT 渲染，且输入框上方 MUST NOT 为该 Skill 栏保留额外空白间距。

#### Scenario: 默认渲染 Skill 选择器
- **GIVEN** host quick info 未覆盖 quick operator
- **WHEN** `QuickOperatorArea` 未显式传入 `component`
- **THEN** 容器 MUST 使用默认值 `"skills"`
- **AND** MUST 渲染 Skill 选择器而不是分类问题组件

#### Scenario: 参数指定分类问题组件
- **GIVEN** host quick info 未覆盖 quick operator
- **WHEN** `component` 显式指定为 `"category-questions"`
- **THEN** 容器 MUST 渲染分类问题组件

#### Scenario: 有可用 Skill 时渲染选择栏
- **WHEN** 容器选择 Skill 选择器且 `GET /api/v1/skills` 返回可用 Skill
- **THEN** 前端 MUST 在输入框上方渲染 Skill 选择栏
- **AND** Skill 栏宽度 MUST 与输入框宽度一致

#### Scenario: 无可用 Skill 时不渲染选择栏
- **WHEN** 容器选择 Skill 选择器且 Skill 查询返回空结果或失败
- **THEN** 前端 MUST NOT 渲染 Skill 选择栏
- **AND** 输入框上方 MUST NOT 为该 Skill 栏保留额外空白间距

### Requirement: Skill 栏 Chip 展示行为

Skill 栏 SHALL 将可用 Skill 以单行 chip 展示，每个 chip 显示当前 locale 下解析出的 Skill display name，并以 tooltip 展示 `description`。Skill 栏 MUST 在输入框宽度内尽可能多地渲染 chip，MUST NOT 换行或出现水平滚动条；不能容纳的 Skill chip SHALL 隐藏。只要 Skill 栏渲染，行内 SHALL 始终渲染“全部”按钮并为该按钮预留空间，无论全部 Skill chip 是否都能容纳。

chip wrapper SHALL 禁止 flex 收缩并限制最大宽度；超长名称 SHALL 截断而不换行或撑开容器。“全部”按钮 SHALL 跟随 chip 流式排列并使用相同 gap，MUST NOT 固定在容器右侧。chip 与“全部”按钮的具体当前视觉样式由 `agent-web-skill-selector-styles` capability 定义。

#### Scenario: Skill 数量少时仍显示全部按钮
- **WHEN** 所有可用 Skill chip 都能在一行内展示
- **THEN** Skill 栏 MUST 在单行内展示所有 Skill chip
- **AND** 行内 MUST 仍渲染“全部”按钮

#### Scenario: Skill 数量多时隐藏溢出 chip
- **WHEN** 可用 Skill chip 与“全部”按钮不能同时容纳在一行
- **THEN** Skill 栏 MUST 为“全部”按钮预留空间
- **AND** MUST 隐藏超出可用宽度的 Skill chip
- **AND** MUST NOT 换行或显示水平滚动条

#### Scenario: 全部按钮跟随 chip 流式排列
- **WHEN** Skill 栏渲染
- **THEN** “全部”按钮 MUST 与最后一个可见 chip 保持相同 gap 排列
- **AND** MUST NOT 固定在容器右侧

#### Scenario: 悬浮显示 Skill 描述
- **WHEN** 用户将鼠标悬浮在某个 Skill chip 上
- **THEN** 前端 MUST 显示该 Skill 的 `description`

### Requirement: 全部 Skill 列表 Modal

点击“全部”按钮 SHALL 打开一个宽度为 328px 的 Skill 列表 Modal，并以该按钮的当前位置作为定位锚点。Modal 与按钮的右边缘 SHALL 对齐；上方空间足够时 SHALL 在按钮上方保留 16px 间距并向上增长，按最大高度计算会越过 viewport 顶部时 SHALL 改在按钮下方保留 16px 间距。Modal 标题 SHALL 使用当前本地化的 `skillSelector.all` 文案（`zh-CN` 为“全部”）、20px 字号和 600 字重，标题下方 SHALL 显示当前副标题。副标题下方 SHALL 提供带搜索图标的搜索输入框和可滚动 Skill 列表；每个列表项 SHALL 显示当前 locale 下解析出的 Skill display name。Modal 高度 SHALL 受最小值和最大值约束，超出最大可用高度的列表 SHALL 垂直滚动。Modal MUST NOT 再渲染“全部”按钮。

#### Scenario: 点击全部打开 Modal
- **WHEN** 用户点击 Skill 栏中的“全部”按钮
- **THEN** 前端 MUST 打开 Skill 列表 Modal
- **AND** Modal 宽度 MUST 为 328px
- **AND** Modal 标题 MUST 为当前本地化的 `skillSelector.all` 文案
- **AND** 标题字号 MUST 为 20px 且副标题 MUST 存在

#### Scenario: Modal 打开时自动聚焦搜索框
- **WHEN** 用户点击“全部”按钮打开 Modal
- **THEN** 搜索输入框 MUST 自动获得焦点

#### Scenario: Modal 列表超出最大高度时滚动
- **WHEN** Skill 数量导致列表区域超过最大高度
- **THEN** 列表区域 MUST 支持垂直滚动
- **AND** Modal 整体高度 MUST NOT 超过最大高度

#### Scenario: 关闭 Modal
- **WHEN** 用户点击 Modal 外部区域或按 Escape 键
- **THEN** Modal MUST 关闭
- **AND** 关闭 Modal MUST NOT 清除已选中的 Skill
