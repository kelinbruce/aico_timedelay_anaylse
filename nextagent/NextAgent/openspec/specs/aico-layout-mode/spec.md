# aico-layout-mode Specification

## Purpose
定义由 AICOConfig 控制的前端布局行为，包括 local/immersive 的 operator 摆放、collaborative 面板尺寸和保留的展开面板摆放语义。
## Requirements
### Requirement: operatorPosition 控制 sidebar 与 top-bar 布局

`layoutConfig.operatorPosition` SHALL 决定 local 和 immersive 模式的布局模式。Collaborative 模式 MUST 始终使用 top-bar 布局，不受该设置影响。

- `LEFT`（默认）：local/immersive 模式 MUST 渲染带默认导航按钮（新建会话、搜索、收藏）的 sidebar。自定义 operator MUST 插入在 sidebar 中收藏按钮下方。
- `RIGHT`：local/immersive 模式 MUST NOT 渲染 sidebar。取而代之，MUST 渲染一个包含图标、名称和 operator 按钮的 top bar header，其结构与 collaborative 面板 header 完全一致。会话区域、输入区域和免责声明 MUST 渲染在 top bar 下方。

当 `operatorPosition` 为 `RIGHT` 且某个 PANEL 类型 operator 处于激活状态时，top bar 也 MUST 被自定义面板替换。唯一的返回方式是通过 `backFunc`。

当 `operatorPosition` 为 `LEFT` 且某个 PANEL 类型 operator 处于激活状态时，sidebar MUST 保持可见。用户可以通过 `backFunc` 或点击 sidebar 中的"新建会话"返回。

#### Scenario: LEFT 模式渲染 sidebar
- **GIVEN** local/immersive 模式且 `operatorPosition: LEFT`（或缺省）
- **WHEN** app 渲染
- **THEN** sidebar MUST 可见，带有新建会话、搜索、收藏和自定义 operator
- **AND** 会话区域 MUST 位于 sidebar 右侧

#### Scenario: RIGHT 模式渲染 top bar 而非 sidebar
- **GIVEN** local/immersive 模式且 `operatorPosition: RIGHT`
- **WHEN** app 渲染
- **THEN** sidebar MUST NOT 被渲染
- **AND** MUST 渲染一个带图标、名称和 operator 按钮的 top bar header
- **AND** 会话区域 MUST 位于 top bar 下方

#### Scenario: collaborative 模式忽略 operatorPosition
- **GIVEN** collaborative 模式且任意 `operatorPosition` 值
- **WHEN** 面板渲染
- **THEN** 布局 MUST 始终是 collaborative 的 top-bar header 样式
- **AND** `operatorPosition` MUST NOT 影响 collaborative 面板布局

#### Scenario: RIGHT 模式下 PANEL 替换 top bar
- **GIVEN** local/immersive 模式且 `operatorPosition: RIGHT` 且某个 PANEL operator 处于激活状态
- **THEN** top bar MUST 被自定义面板内容替换
- **AND** 用户只能通过 `backFunc` 返回

### Requirement: modalSize 控制 collaborative 面板尺寸

`modalSize` SHALL 控制 collaborative 模式面板尺寸。提供时，面板 MUST 使用 `modalSize.width` 作为 docked 面板宽度（覆盖默认的 `484px`），使用 `modalSize.height` 作为面板高度，使用 `modalSize.minWidth` 作为最小可调整宽度（覆盖默认最小值）。

`modalSize` MUST NOT 影响 local 或 immersive 模式。`modalSize` MUST NOT 影响 Operator MODAL 对话框（后者使用 `PIUInfoItem.width/height`）。

`modalSize` 缺省时，MUST 使用当前默认值（`DOCKED_DEFAULT_WIDTH = 484`、当前高度、当前 minWidth）。

#### Scenario: modalSize 覆盖 docked 宽度
- **GIVEN** collaborative 模式且 `modalSize: { width: 600, minWidth: 500 }`
- **WHEN** 面板以 docked 模式打开
- **THEN** 面板宽度 MUST 为 600px
- **AND** 最小可调整宽度 MUST 为 500px

#### Scenario: modalSize 不影响 local 模式
- **GIVEN** local 模式且 `modalSize: { width: 600 }`
- **THEN** local 模式布局 MUST NOT 受影响
- **AND** sidebar 和会话区域 MUST 使用默认尺寸

### Requirement: expandPanelPosition 是保留字段

`layoutConfig.expandPanelPosition` SHALL 是一个供未来使用的保留字段。在本 change 中，前端 MUST 无错误地接受该字段，但 MUST NOT 基于它改变任何渲染行为。当前行为（展开面板在右侧）MUST 保持不变。

#### Scenario: expandPanelPosition 被接受但不生效
- **GIVEN** AICOConfig 且 `layoutConfig: { expandPanelPosition: "LEFT" }`
- **WHEN** app 渲染
- **THEN** MUST NOT 发出任何错误
- **AND** 展开面板行为 MUST 保持不变（右侧，当前行为）
