## ADDED Requirements

### Requirement: 右侧布局宽度

`RightPaneLayout` 的 `maxWidth` SHALL 从 880 调整为 1080。

#### Scenario: maxWidth 检查
- **WHEN** 渲染 RightPaneLayout
- **THEN** `maxWidth` MUST 为 1080

### Requirement: 右侧布局背景透明

`RightPaneLayout` 内容区 SHALL 移除 `background: var(--color-bg-primary)`，`scrollbarColor` SHALL 使用 `var(--color-scrollbar) transparent`。

#### Scenario: 内容区背景透明
- **WHEN** 渲染 RightPaneLayout 内容区
- **THEN** 背景 MUST 不包含 `var(--color-bg-primary)`
- **AND** scrollbarColor MUST 使用 transparent 作为轨道色

### Requirement: 免责声明文案与 Tooltip

`RightPaneLayout` SHALL 更新免责声明文案并新增 `rightPane.disclaimerTip` i18n key。免责声明旁 SHALL 添加 `QuestionCircleOutlined` 图标，鼠标悬停时显示 Tooltip 展示详细使用注意事项。

#### Scenario: 免责声明 Tooltip
- **WHEN** 渲染免责声明区域
- **THEN** MUST 包含 `QuestionCircleOutlined` 图标
- **AND** 图标 MUST 被 `Tooltip` 包裹
- **AND** Tooltip 内容 MUST 为 `t("rightPane.disclaimerTip")` 的值

### Requirement: SuggestedQuestions 间距调整

`SuggestedQuestions.css` 中的 `.suggested-questions` SHALL 移除 `margin-top: 16px`。

#### Scenario: 间距检查
- **WHEN** 检查 `.suggested-questions` CSS 规则
- **THEN** MUST 不包含 `margin-top: 16px`
