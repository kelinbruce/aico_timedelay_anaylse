## ADDED Requirements

### Requirement: operatorPosition 控制 sidebar 与 top-bar 布局

`layoutConfig.operatorPosition` SHALL 决定 local 和 immersive 模式的布局模式。Collaborative 模式 MUST 始终使用 top-bar 布局，不受该设置影响。

- `LEFT`（默认）：local/immersive 模式 MUST 渲染带默认导航按钮（新建 session、搜索、收藏）的 sidebar。自定义 operator MUST 插入在 sidebar 中收藏按钮下方。
- `RIGHT`：local/immersive 模式 MUST NOT 渲染 sidebar。取而代之，MUST 渲染一个包含图标、名称和 operator 按钮的 top bar header，其结构与 collaborative 面板 header 一致。会话区、输入区和免责声明 MUST 渲染在 top bar 之下。

当 `operatorPosition` 为 `RIGHT` 且一个 PANEL 类型 operator 处于激活状态时，top bar 也 MUST 被自定义面板替换。唯一的返回方式是通过 `backFunc`。

当 `operatorPosition` 为 `LEFT` 且一个 PANEL 类型 operator 处于激活状态时，sidebar MUST 保持可见。用户可以通过 `backFunc` 或点击 sidebar 中的“新建 session”返回。

#### Scenario: LEFT 模式渲染 sidebar
- **GIVEN** local/immersive 模式且 `operatorPosition: LEFT`（或未设置）
- **WHEN** 应用渲染
- **THEN** sidebar MUST 可见，并带有新建 session、搜索、收藏和自定义 operator
- **AND** 会话区 MUST 位于 sidebar 右侧

#### Scenario: RIGHT 模式渲染 top bar 而非 sidebar
- **GIVEN** local/immersive 模式且 `operatorPosition: RIGHT`
- **WHEN** 应用渲染
- **THEN** MUST NOT 渲染 sidebar
- **AND** MUST 渲染一个带图标、名称和 operator 按钮的 top bar header
- **AND** 会话区 MUST 位于 top bar 之下

#### Scenario: Collaborative 模式忽略 operatorPosition
- **GIVEN** collaborative 模式且任意 `operatorPosition` 值
- **WHEN** 面板渲染
- **THEN** 布局 MUST 始终是 collaborative top-bar header 风格
- **AND** `operatorPosition` MUST NOT 影响 collaborative 面板布局

#### Scenario: RIGHT 模式下 PANEL 替换 top bar
- **GIVEN** local/immersive 模式且 `operatorPosition: RIGHT`，同时一个 PANEL operator 处于激活状态
- **THEN** top bar MUST 被自定义面板内容替换
- **AND** 用户只能通过 `backFunc` 返回

### Requirement: modalSize 控制 collaborative 面板尺寸

`modalSize` SHALL 控制 collaborative 模式的面板尺寸。当提供时，面板 MUST 使用 `modalSize.width` 作为 docked 面板宽度（覆盖默认的 `484px`）、`modalSize.height` 作为面板高度、`modalSize.minWidth` 作为最小可调宽度（覆盖默认最小值）。

`modalSize` MUST NOT 影响 local 或 immersive 模式。`modalSize` MUST NOT 影响 Operator MODAL 对话框（那些使用 `PIUInfoItem.width/height`）。

当 `modalSize` 缺失时，MUST 使用当前默认值（`DOCKED_DEFAULT_WIDTH = 484`、当前高度、当前 minWidth）。

#### Scenario: modalSize 覆盖 docked 宽度
- **GIVEN** collaborative 模式且 `modalSize: { width: 600, minWidth: 500 }`
- **WHEN** 面板以 docked 模式打开
- **THEN** 面板宽度 MUST 为 600px
- **AND** 最小可调宽度 MUST 为 500px

#### Scenario: modalSize 不影响 local 模式
- **GIVEN** local 模式且 `modalSize: { width: 600 }`
- **THEN** local 模式布局 MUST NOT 受影响
- **AND** sidebar 和会话区 MUST 使用默认尺寸

### Requirement: expandPanelPosition 是保留字段

`layoutConfig.expandPanelPosition` SHALL 是一个留待未来使用的保留字段。在本 change 中，前端 MUST 接受该字段而不报错，但 MUST NOT 基于它改变任何渲染行为。当前行为（展开面板位于右侧）MUST 保持不变。

#### Scenario: expandPanelPosition 被接受但不应用
- **GIVEN** AICOConfig 带有 `layoutConfig: { expandPanelPosition: "LEFT" }`
- **WHEN** 应用渲染
- **THEN** MUST NOT 发出任何错误
- **AND** 展开面板行为 MUST 保持不变（右侧，当前行为）
