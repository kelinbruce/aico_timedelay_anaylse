## ADDED Requirements

### Requirement: Welcome 块品牌区域容器布局

Welcome 块品牌区域 SHALL 使用 `portalGuideWrapper` 作为最外层容器，容器 MUST 设置 `gap: 24px`、`margin-top: 16px`、`margin-bottom: 16px`。Logo 图片与 Logo 名称 SHALL 包裹在一个 logo 容器内，该容器 MUST 设置 `padding-left: 16px`、`padding-right: 16px`、`gap: 16px`，并使用 flex 布局水平居中对齐。Welcome 描述 SHALL 作为 `portalGuideWrapper` 的直接子元素，位于 logo 容器之后。

#### Scenario: 品牌区域容器结构检查
- **WHEN** 渲染 Welcome 块并检查品牌区域 DOM 结构
- **THEN** `portalGuideWrapper` 容器 MUST 存在且包含 `gap: 24px`、`margin: 16px 0`
- **AND** logo 容器 MUST 存在且包含 `padding: 0 16px`、`gap: 16px`、flex 居中
- **AND** Welcome 描述元素 MUST 是 `portalGuideWrapper` 的直接子元素

### Requirement: Logo 图片尺寸

Logo 图片在默认尺寸下 SHALL 为 72px 宽 × 72px 高。当通过 collaborative 入口（`body[data-nextagent-host-mode="collaborative"]`）渲染时，Logo 图片 SHALL 缩小为 60px 宽 × 60px 高。

#### Scenario: 默认入口 Logo 尺寸
- **WHEN** 在 local 或 immersive 入口渲染 Welcome 块
- **THEN** Logo 图片 MUST 为 72px × 72px

#### Scenario: Collaborative 入口 Logo 尺寸
- **WHEN** 在 collaborative 入口（`body[data-nextagent-host-mode="collaborative"]`）渲染 Welcome 块
- **THEN** Logo 图片 MUST 为 60px × 60px

### Requirement: Logo 名称排版

Logo 名称 SHALL 使用 `logoName` 类名，字体大小 MUST 为 36px，行高 MUST 为 44px，字重 MUST 为 700，颜色 MUST 引用 CSS 变量 `var(--bg-color-logo-text)`。

#### Scenario: Logo 名称样式
- **WHEN** 渲染 Welcome 块并检查 Logo 名称元素
- **THEN** 字体大小 MUST 为 36px
- **AND** 行高 MUST 为 44px
- **AND** 字重 MUST 为 700
- **AND** 颜色 MUST 为 `var(--bg-color-logo-text)` 的计算值

### Requirement: Welcome 描述排版

Welcome 描述 SHALL 使用 `guideWelcome` 类名，字体大小 MUST 为 20px，行高 MUST 为 28px，字重 MUST 为 600，上边距 MUST 为 24px，颜色 MUST 引用 CSS 变量 `var(--bg-color-logo-text)`。当通过 collaborative 入口渲染时，字体大小 SHALL 缩小为 16px，行高 SHALL 缩小为 24px，上边距 SHALL 缩小为 16px。

#### Scenario: 默认入口描述样式
- **WHEN** 在 local 或 immersive 入口渲染 Welcome 块
- **THEN** Welcome 描述字体大小 MUST 为 20px
- **AND** 行高 MUST 为 28px
- **AND** 字重 MUST 为 600
- **AND** 上边距 MUST 为 24px
- **AND** 颜色 MUST 为 `var(--bg-color-logo-text)` 的计算值

#### Scenario: Collaborative 入口描述样式
- **WHEN** 在 collaborative 入口（`body[data-nextagent-host-mode="collaborative"]`）渲染 Welcome 块
- **THEN** Welcome 描述字体大小 MUST 为 16px
- **AND** 行高 MUST 为 24px
- **AND** 上边距 MUST 为 16px

### Requirement: Logo 文字双色主题变量

`theme.css` SHALL 定义 CSS 变量 `--bg-color-logo-text`。浅色主题（`data-theme="light"` 或 `data-theme="lightday"`）下该变量值 MUST 为 `#191919`；深色主题（`data-theme="dark"` 或 `data-theme="evening"`）下该变量值 MUST 为 `#fff`。Logo 名称和 Welcome 描述 MUST 通过 `var(--bg-color-logo-text)` 引用该变量。

#### Scenario: 浅色主题颜色变量
- **WHEN** 页面 `data-theme` 为 `light` 或 `lightday`
- **THEN** `--bg-color-logo-text` 计算值 MUST 为 `#191919`

#### Scenario: 深色主题颜色变量
- **WHEN** 页面 `data-theme` 为 `dark` 或 `evening`
- **THEN** `--bg-color-logo-text` 计算值 MUST 为 `#fff`

### Requirement: 旧标签和建议按钮网格已移除

Welcome 块的标签区域（`welcome-quick-tags`）和建议按钮网格（`welcome-suggestion-grid`）SHALL 已从 `WelcomeState` 组件中移除，不再渲染。

#### Scenario: 旧类名不存在
- **WHEN** 渲染 Welcome 块
- **THEN** DOM 中 MUST 不存在 `welcome-quick-tags` 和 `welcome-suggestion-grid` 相关元素和类名
