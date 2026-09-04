# aico-layout-mode Delta Specification

**所属 Function**：`FN-10.6 前端定制`
**Function 变更类型**：修改
**spec 角色**：主规格

## ADDED Requirements

### Requirement: panelPosition controls panel fixed positioning

`panelPosition` SHALL 控制 collaborative 模式 docked 布局面板的 `position: fixed` 定位参数。`panelPosition.top` 覆盖默认 `PREL_MENU_HEIGHT`，`panelPosition.bottom` 覆盖默认 `0`，`panelPosition.left` 或 `panelPosition.right` 覆盖由 `inferDockSide` 推断的值。同时传入 `left` 和 `right` 时，`left` 优先。

`panelPosition` MUST NOT 影响 floating 和 maximized 布局。`panelPosition` MUST NOT 影响最小化面板（最小化面板由 `minimizedStyle` 控制）。

当 `panelPosition` 缺省时，面板 MUST 使用当前硬编码值。

**需求类别**：功能性需求

#### Scenario: panelPosition.top 覆盖 PREL_MENU_HEIGHT

- **GIVEN** collaborative 模式 with `panelPosition: { top: 0 }`
- **WHEN** 面板在 docked 布局渲染
- **THEN** 面板 `top` MUST 为 `0`
- **AND** 面板高度 MUST 由 `top` 和 `bottom` 共同决定（不设 height）

#### Scenario: panelPosition.left 使面板停靠左侧

- **GIVEN** collaborative 模式 with `panelPosition: { left: 0 }`
- **WHEN** 面板在 docked 布局渲染
- **THEN** 面板 MUST 使用 `left: 0` 而非 `right: 0`
- **AND** expand panel MUST 出现在面板右侧

#### Scenario: panelPosition 不影响 floating 布局

- **GIVEN** 面板在 floating 布局
- **WHEN** `panelPosition: { top: 0 }` 被设置
- **THEN** floating 布局的 `top` MUST NOT 被覆盖

#### Scenario: panelPosition 缺省使用硬编码值

- **WHEN** AICOConfig 不包含 `panelPosition`
- **THEN** 面板 MUST 使用 `top: PREL_MENU_HEIGHT`、`bottom: 0`、`left: 0` 或 `right: 0`

### Requirement: controls toggles header controls and interactions

`controls` SHALL 控制 PIU 面板 header 中交互控件的可见性和启用状态。各字段均为 optional boolean，缺省时默认 `true`。

- `controls.maximize`：控制全屏/恢复按钮的可见性。`false` 时按钮 MUST NOT 渲染。
- `controls.close`：控制关闭按钮的可见性。`false` 时按钮 MUST NOT 渲染。
- `controls.dockFloat`：控制 MoreMenu 中停靠/浮窗切换项的可见性。`false` 时菜单项 MUST NOT 渲染。
- `controls.drag`：控制 header 拖拽是否启用。`false` 时 `onPointerDown` MUST 设为 `undefined`。
- `controls.resize`：控制 resize handle 是否渲染。`false` 时 docked 和 floating resize handle MUST NOT 渲染。

当 `controls` 缺省时，所有控件 MUST 保持当前行为（全部可见和启用）。

**需求类别**：功能性需求

#### Scenario: controls.maximize false 隐藏全屏按钮

- **GIVEN** collaborative 模式 with `controls: { maximize: false }`
- **WHEN** 面板 header 渲染
- **THEN** 全屏/恢复按钮 MUST NOT 可见

#### Scenario: controls.close false 隐藏关闭按钮

- **GIVEN** collaborative 模式 with `controls: { close: false }`
- **WHEN** 面板 header 渲染
- **THEN** 关闭按钮 MUST NOT 可见

#### Scenario: controls.drag false 禁用拖拽

- **GIVEN** collaborative 模式 with `controls: { drag: false }`
- **WHEN** 用户在 header 上按下指针
- **THEN** 面板 MUST NOT 进入拖拽状态

#### Scenario: controls.resize false 不渲染 resize handle

- **GIVEN** collaborative 模式 with `controls: { resize: false }`
- **WHEN** 面板在 docked 布局渲染
- **THEN** docked resize handle MUST NOT 渲染

### Requirement: minimizedStyle overrides minimized panel inline style

`minimizedStyle` SHALL 覆盖最小化面板的默认 inline style。前端 MUST 将 `minimizedStyle` 叠加到默认值上：`{ ...defaults, ...aicoConfig.minimizedStyle }`。`minimizedStyle` 中的键覆盖默认值中的同名键。

默认最小化 inline style 为：`{ position: 'fixed', bottom: 16, right: 16, width: 360, borderRadius: 8 }`。

当 `minimizedStyle` 缺省时，最小化面板 MUST 使用默认值。

**需求类别**：功能性需求

#### Scenario: minimizedStyle 覆盖默认位置

- **GIVEN** collaborative 模式 with `minimizedStyle: { left: 56, right: 'auto' }`
- **WHEN** 面板进入最小化状态
- **THEN** 最小化面板 MUST 使用 `left: 56` 和 `right: 'auto'`
- **AND** 其他默认值（`bottom: 16`, `width: 360`, `borderRadius: 8`）MUST 保持不变

#### Scenario: minimizedStyle 缺省使用默认值

- **WHEN** AICOConfig 不包含 `minimizedStyle`
- **THEN** 最小化面板 MUST 使用 `{ position: 'fixed', bottom: 16, right: 16, width: 360, borderRadius: 8 }`

### Requirement: expand panel follows panelPosition

expand panel 的 `top` 和 `bottom` SHALL 跟随 `panelPosition.top` 和 `panelPosition.bottom`。expand panel 的 `left` / `right` 根据面板在左侧还是右侧自动推断：当 `panelPosition.left` 被设置时，面板在左侧，expand panel 在右侧（`left: panelWidth, right: 0`）；否则面板在右侧，expand panel 在左侧（`left: 0, right: panelWidth`）。

expand panel useEffect 打开时 MUST NOT 强制 `setDocked(width, 'right')`，MUST 保留当前 `layout.side`。

**需求类别**：功能性需求

#### Scenario: expand panel top 跟随 panelPosition

- **GIVEN** collaborative 模式 with `panelPosition: { top: 0 }`
- **WHEN** expand panel 打开
- **THEN** expand panel 的 `top` MUST 为 `0`
- **AND** expand panel 的 `top` MUST 与面板的 `top` 一致

#### Scenario: expand panel 在面板左侧（面板在右侧）

- **GIVEN** collaborative 模式 with `panelPosition: { right: 0 }`
- **WHEN** expand panel 打开
- **THEN** expand panel MUST 使用 `left: 0, right: panelWidth`

#### Scenario: expand panel 在面板右侧（面板在左侧）

- **GIVEN** collaborative 模式 with `panelPosition: { left: 0 }`
- **WHEN** expand panel 打开
- **THEN** expand panel MUST 使用 `left: panelWidth, right: 0`

#### Scenario: expand panel 打开时面板宽度缩小为 minWidth

- **GIVEN** collaborative 模式 with modalSize: { width: 800, minWidth: 400 }`n- **WHEN** expand panel 打开
- **THEN** 面板宽度 MUST 缩小为 400（modalSize.minWidth）
- **AND** expand panel 宽度 MUST 为视口宽度减去 400`n
#### Scenario: expand panel 打开时面板宽度回退到 width

- **GIVEN** collaborative 模式 with modalSize: { width: 600 }（无 minWidth）
- **WHEN** expand panel 打开
- **THEN** 面板宽度 MUST 缩小为 600（modalSize.width）

#### Scenario: expand panel 关闭时恢复面板宽度

- **GIVEN** collaborative 模式 with modalSize: { width: 800, minWidth: 400 } and expand panel is open
- **WHEN** expand panel 关闭
- **THEN** 面板宽度 MUST 恢复为 800（modalSize.width）

#### Scenario: modalSize 缺省时打开和关闭后面板宽度均为 DOCKED_DEFAULT_WIDTH

- **GIVEN** collaborative 模式 without modalSize`n- **WHEN** expand panel 打开
- **THEN** 面板宽度 MUST 为 484（DOCKED_DEFAULT_WIDTH）
- **WHEN** expand panel 关闭
- **THEN** 面板宽度 MUST 恢复为 484`n
#### Scenario: expand panel 偏移加上 panelPosition.left

- **GIVEN** collaborative 模式 with panelPosition: { left: 56 } and modalSize: { width: 484 }
- **WHEN** expand panel 打开
- **THEN** expand panel MUST 使用 left: 540（484 + 56）和 ight: 0

#### Scenario: expand panel 偏移加上 panelPosition.right

- **GIVEN** collaborative 模式 with panelPosition: { right: 56 } and modalSize: { width: 484 }
- **WHEN** expand panel 打开
- **THEN** expand panel MUST 使用 left: 0 和 ight: 540（484 + 56）

#### Scenario: expand panel 不强制 right

- **GIVEN** 面板在左侧（`layout.side === 'left'`）
- **WHEN** expand panel 打开
- **THEN** `setDocked` MUST NOT 被调用时 side 参数为 `'right'`
- **AND** 面板 MUST 保持 `layout.side === 'left'`

## Function 变更汇总

### 描述

- **变更类型**：修改
- **目标内容**：新增 `panelPosition`、`controls`、`minimizedStyle` 参数，expand panel 跟随 `panelPosition`。
- **依据 Requirements**：`panelPosition controls panel fixed positioning`、`controls toggles header controls and interactions`、`minimizedStyle overrides minimized panel inline style`、`expand panel follows panelPosition`

### 规格

- **规格项**：PIU 面板布局配置
- **变更类型**：修改
- **目标规格值**：`panelPosition` 位置覆盖、`controls` 控件开关、`minimizedStyle` 样式覆盖、expand panel 跟随
- **依据 Requirements**：`panelPosition controls panel fixed positioning`、`controls toggles header controls and interactions`、`minimizedStyle overrides minimized panel inline style`、`expand panel follows panelPosition`

### 主规格

- **变更类型**：修改
- **目标内容**：`aico-layout-mode`
- **依据 Requirements**：`panelPosition controls panel fixed positioning`、`controls toggles header controls and interactions`、`minimizedStyle overrides minimized panel inline style`、`expand panel follows panelPosition`