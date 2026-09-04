# aico-display-control Delta Specification

**所属 Function**：`FN-10.6 前端定制`
**Function 变更类型**：修改
**spec 角色**：主规格

## ADDED Requirements

### Requirement: initialDisplayState controls initial panel state on load

`initialDisplayState` SHALL 在 `loadAIAgent` 调用时一次性应用面板的初始显示状态。`initialDisplayState` 包含三个 optional boolean 字段：`showEntrance`、`showPanel`、`minimized`。

应用时 MUST 通过 `normalizeDisplayState` 归一化。`initialDisplayState: { showEntrance: false, showPanel: true, minimized: true }` MUST 合法。
ormalizeDisplayState 归一化。initialDisplayState: { showEntrance: false, showPanel: true, minimized: true } MUST 合法。

当 `initialDisplayState` 缺省时，面板 MUST 使用 `defaultDisplayState`（与当前行为一致）。

**需求类别**：功能性需求

#### Scenario: initialDisplayState 应用初始最小化

- **GIVEN** AICOConfig with `closeBehavior: 'minimize'` and `initialDisplayState: { showEntrance: false, showPanel: true, minimized: true }`
- **WHEN** `loadAIAgent` 被调用
- **THEN** 面板 MUST 处于最小化状态（`minimized === true`）
- **AND** `showPanel` MUST 为 `true`
- **AND** `showEntrance` MUST 为 `false`

#### Scenario: initialDisplayState 缺省使用默认值

- **WHEN** AICOConfig 不包含 `initialDisplayState`
- **THEN** 面板 MUST 使用 `{ showEntrance: true, showPanel: false, minimized: false }`

#### Scenario: initialDisplayState 通过 normalizeDisplayState 归一化

- **GIVEN** `closeBehavior: 'hide'`（默认）and `initialDisplayState: { showEntrance: false, showPanel: true }`
- **WHEN** `loadAIAgent` 被调用
- **THEN** `normalizeDisplayState` MUST 纠正为 `{ showEntrance: false, showPanel: false, minimized: false }`

### Requirement: closeBehavior controls close button action

`closeBehavior` SHALL 控制 PIU 面板关闭按钮的行为。`'hide'`（默认）时关闭按钮 MUST 调用 `closePanel()`，`'minimize'` 时关闭按钮 MUST 调用 `minimize()`。

`closeBehavior` MUST 在 `loadAIAgent` 时通过 `setCloseBehavior` 写入 `aiAgentPiuRuntimeStore`。`closeBehavior` 不影响 `minimizeAIAgent` handler 的行为。

当 `closeBehavior` 缺省时，关闭按钮 MUST 调用 `closePanel()`（与当前行为一致）。

**需求类别**：功能性需求

#### Scenario: closeBehavior minimize 时关闭按钮触发最小化

- **GIVEN** collaborative 模式 with `closeBehavior: 'minimize'`
- **WHEN** 用户点击关闭按钮
- **THEN** `aiAgentPiuRuntimeStore.minimize()` MUST 被调用
- **AND** 面板 MUST 进入最小化状态
- **AND** `showPanel` MUST 保持 `true`
- **AND** session 和 stream MUST 保持不变

#### Scenario: closeBehavior hide 时关闭按钮触发隐藏

- **GIVEN** collaborative 模式 with `closeBehavior: 'hide'`（或缺省）
- **WHEN** 用户点击关闭按钮
- **THEN** `closePanel()` MUST 被调用
- **AND** 面板 MUST 被隐藏（`showPanel === false`）

### Requirement: displayAIAgent preserves current values for absent fields

`displayAIAgent` handler SHALL 对未传入的字段保留当前显示状态值。`showEntrance` 和 `showPanel` 字段：如果 payload 中该字段的类型是 `boolean`，使用传入值；否则保留 `aiAgentPiuRuntimeStore.getSnapshot().display` 中的当前值。`minimized` 字段 MUST NOT 接受外部传入，始终保留当前值。
`displayAIAgent` MUST 通过 `normalizeDisplayState` 归一化。
displayAIAgent MUST 通过 
ormalizeDisplayState 归一化。

**需求类别**：功能性需求

#### Scenario: displayAIAgent 只传 showPanel 保留 showEntrance

- **GIVEN** 当前显示状态为 `{ showEntrance: false, showPanel: false, minimized: false }` and `closeBehavior: 'minimize'`
- **WHEN** 调用 `displayAIAgent({ showPanel: true })`
- **THEN** `showEntrance` MUST 保留为 `false`
- **AND** `showPanel` MUST 变为 `true`

#### Scenario: displayAIAgent 显式传 false 仍然生效

- **GIVEN** 当前显示状态为 `{ showEntrance: true, showPanel: true, minimized: false }`
- **WHEN** 调用 `displayAIAgent({ showPanel: false })`
- **THEN** `showPanel` MUST 变为 `false`
- **AND** `showEntrance` MUST 保留为 `true`

#### Scenario: displayAIAgent 不传任何字段时无变化

- **GIVEN** 当前显示状态为 `{ showEntrance: true, showPanel: true, minimized: false }`
- **WHEN** 调用 `displayAIAgent({})`
- **THEN** 全部字段 MUST 保留当前值

#### Scenario: displayAIAgent 两个字段都显式传入时行为不变

- **GIVEN** 任意当前显示状态
- **WHEN** 调用 `displayAIAgent({ showEntrance: true, showPanel: true })`
- **THEN** 行为 MUST 与修改前完全一致


### Requirement: updatePanelLayout handler updates current panel layout

`updatePanelLayout` handler SHALL 更新当前 PIU 面板的 `panelPosition`、`modalSize` 和 `minimizedStyle`，而不触发 `loadAIAgent` 的卸载和重挂载。集成方在布局变化（如侧边栏展开/收起、窗口 resize）时调用此 handler 更新面板位置。

`updatePanelLayout` 接收与 `loadAIAgent` 相同的 `panelPosition`、`modalSize` 和 `minimizedStyle` 字段，但 MUST NOT 接受 `containerId`、`closeBehavior`、`initialDisplayState` 或 `controls`。传入这些字段 MUST 被静默忽略。

`updatePanelLayout` MUST 将传入的字段合并到当前 `aicoConfigStore` 的 config 中，而非完整替换。传入的字段覆盖 config 中的同名字段，未传入的字段保持不变。

当 `panelPosition` 被更新时，面板 MUST 立即使用新的位置渲染。当 `modalSize.width` 被更新时，面板 docked 布局宽度 MUST 立即更新。当 `minimizedStyle` 被更新时，最小化面板样式 MUST 立即更新。

**需求类别**：功能性需求

#### Scenario: updatePanelLayout 更新 panelPosition

- **GIVEN** PIU 面板已加载 with `panelPosition: { top: 0, right: 0 }`
- **WHEN** 调用 `updatePanelLayout({ panelPosition: { top: 0, right: 200 } })`
- **THEN** 面板 MUST 立即使用 `right: 200` 渲染
- **AND** `top: 0` MUST 保持不变
- **AND** React root MUST NOT 被卸载和重挂载

#### Scenario: updatePanelLayout 更新 modalSize

- **GIVEN** PIU 面板已加载 with `modalSize: { width: 484 }`
- **WHEN** 调用 `updatePanelLayout({ modalSize: { width: 600 } })`
- **THEN** 面板宽度 MUST 立即变为 `600`
- **AND** 其他 config 字段 MUST 保持不变

#### Scenario: updatePanelLayout 更新 minimizedStyle

- **GIVEN** PIU 面板已加载 with `minimizedStyle: { left: 56 }`
- **WHEN** 调用 `updatePanelLayout({ minimizedStyle: { left: 200, right: 'auto' } })`
- **THEN** 最小化面板 MUST 使用 `left: 200` 和 `right: 'auto'`
- **AND** 其他 minimizedStyle 字段 MUST 保持不变

#### Scenario: updatePanelLayout 忽略不支持的字段

- **WHEN** 调用 `updatePanelLayout({ containerId: 'new', controls: { close: false } })`
- **THEN** `containerId` MUST NOT 被应用
- **AND** `controls` MUST NOT 被应用
- **AND** 当前 config MUST 保持不变

#### Scenario: updatePanelLayout 不触发卸载

- **GIVEN** PIU 面板已加载并渲染
- **WHEN** 调用 `updatePanelLayout({ panelPosition: { top: 0 } })`
- **THEN** React root MUST NOT 被卸载
- **AND** 面板 MUST NOT 闪烁或重新挂载


### Requirement: 关闭面板时清理 expand panel

当面板的 `showPanel` 变为 `false` 时（通过 `displayAIAgent` 或 `closePanel`），如果 expand panel 当前处于打开状态，前端 MUST 关闭 expand panel 并 dispatch `smart-canvas:clearExpandPanel` CustomEvent。

`closePanel` 在 `closeBehavior: 'minimize'` 时触发最小化，此时 expand panel 已由 `minimize()` 关闭，MUST NOT 重复 dispatch `smart-canvas:clearExpandPanel`。`closePanel` 在 `closeBehavior: 'hide'` 时触发隐藏，此时如果 expand panel 仍打开，MUST dispatch `smart-canvas:clearExpandPanel`。

**需求类别**：功能性需求

#### Scenario: displayAIAgent 关闭面板时清理 expand panel

- **GIVEN** PIU 面板已打开 with expand panel open
- **WHEN** 调用 `displayAIAgent({ showPanel: false })`
- **THEN** expand panel MUST 被关闭
- **AND** `smart-canvas:clearExpandPanel` CustomEvent MUST 被 dispatch

#### Scenario: closePanel 在 hide 模式时清理 expand panel

- **GIVEN** PIU 面板已打开 with expand panel open and `closeBehavior: 'hide'`
- **WHEN** 用户点击关闭按钮
- **THEN** expand panel MUST 被关闭
- **AND** `smart-canvas:clearExpandPanel` CustomEvent MUST 被 dispatch

#### Scenario: closePanel 在 minimize 模式时不重复 dispatch

- **GIVEN** PIU 面板已打开 with expand panel open and `closeBehavior: 'minimize'`
- **WHEN** 用户点击关闭按钮
- **THEN** `minimize()` MUST 被调用
- **AND** expand panel MUST 被关闭（由 minimize 处理）
- **AND** `smart-canvas:clearExpandPanel` MUST NOT 被 dispatch

#### Scenario: minimize 已清理 expand panel

- **GIVEN** PIU 面板已打开 with expand panel open
- **WHEN** `minimizeAIAgent()` 被调用
- **THEN** expand panel MUST 被关闭
- **AND** `smart-canvas:clearExpandPanel` CustomEvent MUST 被 dispatch

## Function 变更汇总

### 描述

- **变更类型**：修改
- **目标内容**：新增 `initialDisplayState` 和 `closeBehavior` 参数，修改 `displayAIAgent` 保留未传字段当前值。
- **依据 Requirements**：`initialDisplayState controls initial panel state on load`、`closeBehavior controls close button action`、`displayAIAgent preserves current values for absent fields`

### 规格

- **规格项**：PIU 面板显示控制
- **变更类型**：修改
- **目标规格值**：`initialDisplayState` 初始状态、`closeBehavior` 关闭行为、`displayAIAgent` 保留当前值
- **依据 Requirements**：`initialDisplayState controls initial panel state on load`、`closeBehavior controls close button action`、`displayAIAgent preserves current values for absent fields`

### 主规格

- **变更类型**：修改
- **目标内容**：`aico-display-control`
- **依据 Requirements**：`initialDisplayState controls initial panel state on load`、`closeBehavior controls close button action`、`displayAIAgent preserves current values for absent fields`
