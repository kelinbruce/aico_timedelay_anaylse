## Purpose

This specification defines the stable layout and presentation requirements for the web welcome-state high-frequency question recommendations.
## Requirements
### Requirement: 高频问题容器布局

高频问题推荐区域 SHALL 使用 `highFrequencyWrapper` 作为容器，容器 MUST 设置 `width: 100%`、`display: flex`、`gap: 12px`、`flex-wrap: wrap`、`justify-content: center`。容器宽度 SHALL 与对话/输入框内容区宽度一致，并使用 `agent-web-page-layout` 定义的 `contained` 内容边界。

#### Scenario: 容器布局检查
- **WHEN** 渲染高频问题推荐区域
- **THEN** `highFrequencyWrapper` 容器 MUST 存在且包含 `width: 100%`、`display: flex`、`gap: 12px`、`flex-wrap: wrap`、`justify-content: center`

### Requirement: 问题项排版与尺寸

每个问题项 SHALL 使用 `questionItem` 类名，MUST 设置 `height: 46px`、`line-height: 22px`、`border-radius: 16px`、`padding: 12px 16px`、`font-size: 14px`、`opacity: 0.8`、`cursor: pointer`、`box-sizing: border-box`。文字颜色 MUST 引用 `var(--color-recommend-question)`，背景 MUST 引用 `var(--bg-high-recommend)`。问题项 SHALL 不包含图标。

#### Scenario: 问题项样式
- **WHEN** 渲染高频问题推荐区域的问题项
- **THEN** 每个问题项 MUST 包含 height 46px、line-height 22px、border-radius 16px、padding 12px 16px、font-size 14px、opacity 0.8、cursor pointer、box-sizing border-box
- **AND** 文字颜色 MUST 为 `var(--color-recommend-question)` 的计算值
- **AND** 背景 MUST 为 `var(--bg-high-recommend)` 的计算值
- **AND** 问题项内 MUST 不存在图标元素

### Requirement: 问题项宽度与文字截断

问题项宽度 SHALL 随问题文字长度决定，不设固定宽度或百分比 max-width。当问题文字长度超过容器可用宽度时，问题项 MUST 通过 `overflow: hidden`、`text-overflow: ellipsis`、`white-space: nowrap`、`min-width: 0` 截断文字并显示省略号。每行排列的问题项数量不限制，由 flex-wrap 自动换行决定。

#### Scenario: 短问题按内容宽度排列
- **WHEN** 问题文字长度较短，多个问题项在一行内能并排排列
- **THEN** 每个问题项宽度 SHALL 由内容决定
- **AND** 当一行内无法容纳下一个问题项时，该问题项 MUST 换行到下一行

#### Scenario: 超长问题文字截断
- **WHEN** 单个问题文字长度超过容器可用宽度
- **THEN** 问题项 MUST 截断文字并显示省略号
- **AND** 问题项 MUST 不超过容器宽度

### Requirement: 高频问题双色主题变量

`theme.css` SHALL 定义 CSS 变量 `--bg-high-recommend` 和 `--color-recommend-question`。浅色主题（`data-theme="light"` 或 `data-theme="lightday"`）下 `--bg-high-recommend` MUST 为 `rgb(255, 255, 255)`，`--color-recommend-question` MUST 为 `rgba(119, 119, 119, 1)`。深色主题（`data-theme="dark"` 或 `data-theme="evening"`）下 `--bg-high-recommend` MUST 为 `rgba(243, 243, 243, 0.1)`，`--color-recommend-question` MUST 为 `rgba(201, 201, 201, 1)`。

#### Scenario: 浅色主题颜色变量
- **WHEN** 页面 `data-theme` 为 `light` 或 `lightday`
- **THEN** `--bg-high-recommend` 计算值 MUST 为 `rgb(255, 255, 255)`
- **AND** `--color-recommend-question` 计算值 MUST 为 `rgba(119, 119, 119, 1)`

#### Scenario: 深色主题颜色变量
- **WHEN** 页面 `data-theme` 为 `dark` 或 `evening`
- **THEN** `--bg-high-recommend` 计算值 MUST 为 `rgba(243, 243, 243, 0.1)`
- **AND** `--color-recommend-question` 计算值 MUST 为 `rgba(201, 201, 201, 1)`

### Requirement: 高频问题独立组件

高频问题推荐区域 SHALL 作为独立 React 组件 `HighFrequencyQuestions` 实现，位于 `frontend/agent-web/src/features/high-frequency-questions/components/`。组件 SHALL 接收 `onQuestionClick?: (question: string) => void` prop。组件 SHALL 通过 `GET /api/v1/frequent-questions` 获取动态排序的问题列表。当 API 返回空列表或请求失败时，组件 SHALL fallback 到 i18n 硬编码的 4 个默认问题。`WelcomeState` SHALL 通过 `GuideArea` 容器渲染该组件。

#### Scenario: 独立组件渲染
- **WHEN** 渲染 Welcome 块
**THEN** `HighFrequencyQuestions` 组件 MUST 通过 `GuideArea` 容器被渲染
- **AND** `WelcomeState` 中 MUST 不再包含 `welcome-suggestion-grid`、`welcome-suggestion-button`、`welcome-suggestion-label` 相关 DOM

#### Scenario: 问题点击回调
- **WHEN** 用户点击高频问题项
- **THEN** `onQuestionClick` 回调 MUST 被调用，参数为问题文本

#### Scenario: 动态数据获取
- **WHEN** 组件挂载
- **THEN** 组件 MUST 调用 `GET /api/v1/frequent-questions` 获取问题列表
- **AND** 返回非空列表时 MUST 渲染返回的问题

#### Scenario: 空列表 fallback
- **WHEN** API 返回 `questions: []`
- **THEN** 组件 MUST fallback 到 i18n 硬编码 4 个默认问题

#### Scenario: API 失败 fallback
- **WHEN** API 请求失败
- **THEN** 组件 MUST fallback 到 i18n 硬编码 4 个默认问题
- **AND** MUST NOT 向用户显示错误

### Requirement: welcome-state-shell 宽度放宽

`welcome-state-shell` 的 `max-width` SHALL 从 640px 放宽到 100%，使品牌区域和高频问题区域宽度与对话/输入框内容区一致。

#### Scenario: shell 宽度检查
- **WHEN** 渲染 Welcome 块并检查 `welcome-state-shell`
- **THEN** `max-width` MUST 为 100%（或等价的 `none`）
- **AND** shell 宽度 SHALL 不超过 `agent-web-page-layout` 定义的 `contained` 内容边界

### Requirement: 高频问题区域无独立小屏样式

高频问题推荐区域 SHALL 不在 collaborative 入口下使用差异化样式，保持默认样式。小屏判断沿用 `body[data-nextagent-host-mode="collaborative"]` 选择器约定，但该组件不定义任何 collaborative 覆盖规则。

#### Scenario: collaborative 入口样式不变
- **WHEN** 在 collaborative 入口渲染高频问题推荐区域
- **THEN** `highFrequencyWrapper` 和 `questionItem` 的样式 MUST 与 local/immersive 入口一致

### Requirement: 欢迎页高频问题点击 SHALL 只回填 Composer

欢迎页 `HighFrequencyQuestions` 的问题点击 SHALL 将完整问题文本写入并聚焦普通 Composer 草稿。该点击 MUST NOT 创建 session、MUST NOT 调用 request submit，并 MUST 等待用户后续显式发送。此行为与消息 turn 内可直接触发提交的 suggested-question action 不同。

#### Scenario: 欢迎页问题回填但不发送
- **GIVEN** 用户位于尚未建立 session 的欢迎页
- **WHEN** 用户点击一个高频问题项
- **THEN** Agent Web SHALL 将完整问题文本填入并聚焦 Composer
- **AND** SHALL NOT 创建 session
- **AND** SHALL NOT 提交 request

#### Scenario: 回填文本成为普通草稿
- **WHEN** 欢迎页问题文本被回填 Composer
- **THEN** 该文本 SHALL 按普通 Composer 草稿语义保存和编辑
- **AND** 只有后续显式提交才 SHALL 创建或发送 request
