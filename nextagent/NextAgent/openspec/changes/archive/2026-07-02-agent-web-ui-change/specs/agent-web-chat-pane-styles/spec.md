## ADDED Requirements

### Requirement: 对话窗格双色主题变量

`theme.css` SHALL 定义 CSS 变量 `--color-chat-pane-bg`。浅色主题（`data-theme="light"` 或 `data-theme="lightday"`）下该变量 MUST 为带紫色/青色/蓝色径向渐变的 `#f3f3f3` 背景。深色主题（`data-theme="dark"` 或 `data-theme="evening"`）下该变量 MUST 为 `var(--color-bg-primary)`。

#### Scenario: 浅色主题窗格背景
- **WHEN** 页面 `data-theme` 为 `light` 或 `lightday`
- **THEN** `--color-chat-pane-bg` 计算值 MUST 包含径向渐变和 `#f3f3f3`

#### Scenario: 深色主题窗格背景
- **WHEN** 页面 `data-theme` 为 `dark` 或 `evening`
- **THEN** `--color-chat-pane-bg` 计算值 MUST 为 `var(--color-bg-primary)`

### Requirement: 对话窗格背景应用

`ChatPage` 中的 `chat-conversation-pane` 元素 SHALL 设置 `background: var(--color-chat-pane-bg)`。

#### Scenario: 窗格背景应用
- **WHEN** 渲染 ChatPage 对话区域
- **THEN** `chat-conversation-pane` 的背景 MUST 为 `var(--color-chat-pane-bg)` 的计算值

### Requirement: AI 气泡双色主题变量

`theme.css` SHALL 定义 CSS 变量 `--color-ai-bubble-bg`。浅色主题下该变量 MUST 为 `rgba(255, 255, 255, 1)`，深色主题下 MUST 为 `rgba(243, 243, 243, 0.05)`。

#### Scenario: 浅色主题 AI 气泡背景
- **WHEN** 页面 `data-theme` 为 `light` 或 `lightday`
- **THEN** `--color-ai-bubble-bg` 计算值 MUST 为 `rgba(255, 255, 255, 1)`

#### Scenario: 深色主题 AI 气泡背景
- **WHEN** 页面 `data-theme` 为 `dark` 或 `evening`
- **THEN** `--color-ai-bubble-bg` 计算值 MUST 为 `rgba(243, 243, 243, 0.05)`

### Requirement: AI 气泡样式

`[data-testid="ai-bubble"]` 元素 SHALL 设置 `border-radius: 0px 8px 8px 8px` 和 `background: var(--color-ai-bubble-bg)`。

#### Scenario: AI 气泡圆角和背景
- **WHEN** 渲染 AI 气泡元素
- **THEN** border-radius MUST 为 `0px 8px 8px 8px`
- **AND** background MUST 为 `var(--color-ai-bubble-bg)` 的计算值

### Requirement: 回答文字和分隔线双色主题变量

`theme.css` SHALL 定义 CSS 变量 `--color-chat-answer`、`--color-answer-separator`。浅色主题下 `--color-chat-answer` MUST 为 `rgb(25, 25, 25)`，`--color-answer-separator` MUST 为 `rgba(223, 223, 223, 1)`。深色主题下 `--color-chat-answer` MUST 为 `rgb(255, 255, 255)`，`--color-answer-separator` MUST 为 `rgba(243, 243, 243, 0.15)`。

#### Scenario: 浅色主题回答文字
- **WHEN** 页面 `data-theme` 为 `light` 或 `lightday`
- **THEN** `--color-chat-answer` 计算值 MUST 为 `rgb(25, 25, 25)`

#### Scenario: 深色主题回答文字
- **WHEN** 页面 `data-theme` 为 `dark` 或 `evening`
- **THEN** `--color-chat-answer` 计算值 MUST 为 `rgb(255, 255, 255)`

### Requirement: 用户气泡背景色调整

`--color-user-bubble-bg` 浅色主题下 MUST 为 `rgba(184, 217, 249, 1)`，深色主题下 MUST 为 `rgba(0, 103, 209, 0.4)`。

#### Scenario: 浅色主题用户气泡背景
- **WHEN** 页面 `data-theme` 为 `light` 或 `lightday`
- **THEN** `--color-user-bubble-bg` 计算值 MUST 为 `rgba(184, 217, 249, 1)`

#### Scenario: 深色主题用户气泡背景
- **WHEN** 页面 `data-theme` 为 `dark` 或 `evening`
- **THEN** `--color-user-bubble-bg` 计算值 MUST 为 `rgba(0, 103, 209, 0.4)`
