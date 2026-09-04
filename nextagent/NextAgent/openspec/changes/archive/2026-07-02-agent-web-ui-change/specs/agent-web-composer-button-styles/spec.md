## ADDED Requirements

### Requirement: 发送按钮自定义图标

发送按钮 SHALL 使用自定义图标组件 `SendIcon` 替代 antd `ArrowUpOutlined`。`SendIcon` SHALL 根据 `disabled` prop 和当前 `data-theme` 选择对应的 SVG 资源（light/dark 版本）。提交中（`submitting`）时 SHALL 显示 antd `Spin` 替代图标。

#### Scenario: 正常态发送按钮图标
- **WHEN** 渲染发送按钮且未处于提交中
- **THEN** 按钮 MUST 包含 `SendIcon` 组件

#### Scenario: 提交中发送按钮图标
- **WHEN** 渲染发送按钮且处于提交中
- **THEN** 按钮 MUST 包含 `Spin` 组件

### Requirement: 停止按钮自定义图标

停止按钮 SHALL 使用自定义图标组件 `StopResponseIcon` 替代 antd `StopOutlined`。停止按钮 SHALL 在 `isExecuting && onStop` 时显示，否则显示发送按钮。停止按钮 SHALL 包含文字标签。

#### Scenario: 停止按钮显示条件
- **WHEN** `isExecuting` 为 true 且 `onStop` 存在
- **THEN** 停止按钮 MUST 显示，包含 `StopResponseIcon` 和文字标签

#### Scenario: 停止按钮隐藏条件
- **WHEN** `isExecuting` 为 false 或 `onStop` 不存在
- **THEN** 发送按钮 MUST 显示，停止按钮 MUST 不显示

### Requirement: 发送/停止按钮双色主题变量

`theme.css` SHALL 定义 CSS 变量 `--send-icon-enabled`、`--send-icon-disabled`、`--send-btn-bg`、`--send-btn-bg-hover`、`--stop-icon-color`、`--color-stop-text`、`--bg-input-context`。浅色主题下 `--send-icon-enabled` MUST 为 `rgb(0, 103, 209)`，`--send-btn-bg` MUST 为 `rgba(0, 103, 209, 0.1)`。深色主题下 `--send-icon-enabled` MUST 为 `#5CA2E9`，`--send-btn-bg` MUST 为 `rgba(92, 162, 233, 0.15)`。

#### Scenario: 浅色主题按钮变量
- **WHEN** 页面 `data-theme` 为 `light` 或 `lightday`
- **THEN** `--send-icon-enabled` MUST 为 `rgb(0, 103, 209)`
- **AND** `--send-btn-bg` MUST 为 `rgba(0, 103, 209, 0.1)`

#### Scenario: 深色主题按钮变量
- **WHEN** 页面 `data-theme` 为 `dark` 或 `evening`
- **THEN** `--send-icon-enabled` MUST 为 `#5CA2E9`
- **AND** `--send-btn-bg` MUST 为 `rgba(92, 162, 233, 0.15)`

### Requirement: 发送按钮 CSS 类

`theme.css` SHALL 定义 `.send-btn` CSS 类，设置 `height: 32px`、`width: 32px`、`border-radius: 16px`、`display: flex`、`align-items: center`、`justify-content: center`、`background: var(--send-btn-bg)`、`border: none`、`transition: background 120ms ease`。hover 非禁用态 SHALL 使用 `var(--send-btn-bg-hover)` 背景。

#### Scenario: 发送按钮样式
- **WHEN** 渲染发送按钮
- **THEN** 按钮 MUST 包含 `send-btn` 类
- **AND** 尺寸 MUST 为 32×32，圆角 16px

### Requirement: 停止按钮 CSS 类

`theme.css` SHALL 定义 `.stop-button` CSS 类，设置 `display: flex`、`align-items: center`、`gap: 4px`、`height: 32px`、`border-radius: 16px`、`padding: 0 8px`、`background-color: var(--send-btn-bg)`、`cursor: pointer`、`border: none`。文字标签 SHALL 使用 `.stop-text` 类，`font-size: 14px`、`color: var(--color-stop-text)`。

#### Scenario: 停止按钮样式
- **WHEN** 渲染停止按钮
- **THEN** 按钮 MUST 包含 `stop-button` 类
- **AND** 文字标签 MUST 包含 `stop-text` 类

### Requirement: 停止按钮文字标签

停止按钮 SHALL 显示 `composer.stopResponse` i18n key 对应的文字标签。en-US 下 MUST 为 "Stop response"，zh-CN 下 MUST 为 "停止响应"。

#### Scenario: 停止按钮文字
- **WHEN** 渲染停止按钮
- **THEN** 文字标签 MUST 为 `t("composer.stopResponse")` 的值
