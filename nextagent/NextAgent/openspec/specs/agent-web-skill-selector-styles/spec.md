## Purpose

This specification defines the stable visual style requirements for the web skill selector UI, including theme-aware layout and presentation details.

## Requirements

### Requirement: 技能选择器图标

技能选择条 chip、技能目录弹窗列表项和已选技能 chip SHALL 在技能名称前显示图标。图标按技能在列表中的 index 取模 4 选择（`index1.png` 到 `index4.png`）。"全部" 按钮 SHALL 使用 `all.png` 图标。

#### Scenario: 技能选择条 chip 图标
- **WHEN** 渲染技能选择条
- **THEN** 每个 chip MUST 包含一个 `img` 元素显示对应图标

#### Scenario: 技能目录弹窗列表项图标
- **WHEN** 渲染技能目录弹窗列表
- **THEN** 每个列表项 MUST 包含一个 `img` 元素显示对应图标

#### Scenario: 已选技能 chip 图标
- **WHEN** 渲染已选技能 chip
- **THEN** chip MUST 包含一个 `img` 元素显示对应图标

### Requirement: 技能选择条 chip 样式

技能选择条 chip SHALL 使用圆角药丸样式：`border-radius: 16px`、`height: 32px`、`padding: 7px 12px`。chip SHALL 不区分选中态边框/背景，统一使用 `border: 1px solid var(--color-composer-border)` 和 `background: var(--color-composer-bg)`。

#### Scenario: chip 圆角药丸样式
- **WHEN** 渲染技能选择条 chip
- **THEN** border-radius MUST 为 16px
- **AND** height MUST 为 32px

### Requirement: 技能目录弹窗样式

技能目录弹窗 SHALL 使用更新的样式：标题字号 20px / 字重 600，新增副标题文字，搜索框 height 32px 并带 `SearchOutlined` 图标 suffix，列表项 height 36px / border-radius 8px / flex 布局。

#### Scenario: 弹窗标题样式
- **WHEN** 渲染技能目录弹窗
- **THEN** 标题字号 MUST 为 20px
- **AND** 副标题 MUST 存在

#### Scenario: 弹窗搜索框样式
- **WHEN** 渲染技能目录弹窗搜索框
- **THEN** 搜索框 height MUST 为 32px
- **AND** 搜索框 MUST 包含 `SearchOutlined` suffix 图标

### Requirement: 已选技能 chip 样式

已选技能 chip SHALL 使用 `background: var(--bg-input-context)`、`color: var(--color-chat-answer)`、`border-radius: 4px`、`height: 28px`。chip SHALL 显示图标和技能名称，关闭按钮使用 `var(--color-chat-answer)` 颜色。

#### Scenario: 已选 chip 样式
- **WHEN** 渲染已选技能 chip
- **THEN** background MUST 为 `var(--bg-input-context)` 的计算值
- **AND** color MUST 为 `var(--color-chat-answer)` 的计算值
- **AND** border-radius MUST 为 4px

### Requirement: 技能选择 store 扩展

`skillSelectionStore` SHALL 新增 `selectedIconIndex: number` 字段，默认值 0。`selectSkill` 方法 SHALL 接收可选 `iconIndex` 参数并更新 `selectedIconIndex`。`clearSelection` SHALL 将 `selectedIconIndex` 重置为 0。

#### Scenario: selectSkill 带 iconIndex
- **WHEN** 调用 `selectSkill(skill, 2)`
- **THEN** `selectedIconIndex` MUST 为 2

#### Scenario: clearSelection 重置 iconIndex
- **WHEN** 调用 `clearSelection()`
- **THEN** `selectedIconIndex` MUST 为 0
