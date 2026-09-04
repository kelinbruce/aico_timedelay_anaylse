# add-piu-panel-position-and-display-control Design

## 设计范围（Scope）

| Function | 目标变化 | Delta spec | 设计章节 |
|---|---|---|---|
| `FN-10.6 前端定制`（修改） | 新增 5 个 AICOConfig 字段定义和默认值 | `specs/aico-config-contract/spec.md` | [aico-config-contract](#aico-config-contract) |
| `FN-10.6 前端定制`（修改） | 面板位置参数、控件开关、最小化样式覆盖、expand panel 跟随 | `specs/aico-layout-mode/spec.md` | [aico-layout-mode](#aico-layout-mode) |
| `FN-10.6 前端定制`（修改） | 初始显示状态、关闭行为、displayAIAgent 保留当前值 | `specs/aico-display-control/spec.md` | [aico-display-control](#aico-display-control) |
| `FN-10.6 前端定制`（修改） | 最小化样式覆盖、closeBehavior 最小化触发、initialDisplayState 初始最小化、normalizeDisplayState 放开规则 | `specs/agent-web-piu-minimize/spec.md` | [agent-web-piu-minimize](#agent-web-piu-minimize) |

## aico-config-contract

### 目标与规范依据

AICOConfig 当前不支持面板位置参数、关闭行为控制、初始显示状态、控件可见性开关和最小化样式覆盖。集成方需要这些参数来适配不同页面布局场景。

本 Function 的目标 Requirements：

- Canonical spec：`aico-config-contract`
- `MODIFIED AICOConfig configuration type and field definitions`
- `MODIFIED AICOConfig default behavior when fields are absent`

### 当前实现

- 面板 docked 布局的 `top` 硬编码为 `PREL_MENU_HEIGHT`（63.2px），`left`/`right` 由 `inferDockSide` 自动推断。
- 关闭按钮固定调用 `closePanel()`，行为不可配置。
- 初始显示状态固定为 `defaultDisplayState`。
- header 中的 maximize、close、dockFloat 按钮始终渲染，drag 和 resize 始终启用。
- 最小化面板位置固定为 `right: 16, bottom: 16`，宽度固定为 `MINIMIZED_PANEL_WIDTH`（360px）。

### GAP 分析

- 不存在 `panelPosition` 参数，面板位置不可配置。
- 不存在 `closeBehavior` 参数，关闭按钮行为不可配置。
- 不存在 `initialDisplayState` 参数，初始显示状态不可配置。
- 不存在 `controls` 参数，控件可见性不可配置。
- 不存在 `minimizedStyle` 参数，最小化面板样式不可配置。

### 修改方案

新增 5 个 optional 字段：

1. `panelPosition?: { top?: number | string; bottom?: number | string; left?: number | string; right?: number | string }`
   - 默认值：`{ top: PREL_MENU_HEIGHT, bottom: 0, right: 0 }`（或 `left: 0`，由 inferDockSide 决定）
   - 校验：对象校验，4 个 optional string/number 字段，非 string/number 值静默过滤，空对象返回 undefined。

2. `closeBehavior?: 'hide' | 'minimize'`
   - 默认值：`'hide'`
   - 校验：枚举校验，非法值返回 undefined。

3. `initialDisplayState?: { showEntrance?: boolean; showPanel?: boolean; minimized?: boolean }`
   - 默认值：`{ showEntrance: true, showPanel: false, minimized: false }`
   - 校验：对象校验，3 个 optional boolean，非 boolean 过滤。

4. `controls?: { close?: boolean; maximize?: boolean; dockFloat?: boolean; drag?: boolean; resize?: boolean }`
   - 默认值：全部 `true`
   - 校验：对象校验，5 个 optional boolean，非 boolean 过滤。

5. `minimizedStyle?: Readonly<Record<string, string | number>>`
   - 默认值：`{ position: 'fixed', bottom: 16, right: 16, width: 360, borderRadius: 8 }`
   - 校验：复用 `validateEntranceStyle` 同逻辑。

#### 质量属性影响

| 质量属性 | 规范依据 | 本 Function 内实现机制 | 验证关注点 |
|---|---|---|---|
| 安全 | 不可信边界 runtime schema validation | hand-written 校验函数，非 string/number 值静默过滤 | 断言非法值被过滤且不抛错 |
| 可维护性 | 同形同策：minimizedStyle 与 entranceStyle 使用同一套校验逻辑 | 复用 validateEntranceStyle 模式 | 断言两者校验行为一致 |
| 可测试性 | 全部字段缺省时行为不变 | 缺省值等于当前硬编码值 | 断言不传新参数时行为与现有完全一致 |

## aico-layout-mode

### 目标与规范依据

面板位置当前全部硬编码，expand panel 位置也硬编码且强制 `setDocked(width, 'right')`。需要让面板位置可配置，expand panel 跟随面板位置。

本 Function 的目标 Requirements：

- Canonical spec：`aico-layout-mode`
- `ADDED panelPosition controls panel fixed positioning`
- `ADDED controls toggles header controls and interactions`
- `ADDED minimizedStyle overrides minimized panel inline style`
- `ADDED expand panel follows panelPosition`

### 当前实现

- `panelStyle` useMemo 中 docked 布局硬编码 `top: PREL_MENU_HEIGHT`、`bottom: 0`、`left: 0` / `right: 0`。
- expand panel 硬编码 `top: PREL_MENU_HEIGHT`、`left: 0`、`right: expandPanelRegionRight`。
- expand panel useEffect 强制 `setDocked(expandPanelPiuWidth, 'right')`。
- header 中 maximize、close、dockFloat 按钮始终渲染。
- header `onPointerDown={startHeaderDrag}` 始终启用。
- docked 和 floating resize handle 始终渲染。

### GAP 分析

- 面板位置不可配置。
- expand panel 位置不跟随面板位置。
- expand panel 强制 `'right'` 破坏左侧停靠。
- 控件可见性不可配置。
- drag 和 resize 不可禁用。
- 最小化面板样式不可配置。

### 修改方案

- `panelStyle` useMemo：docked 布局从 `aicoConfig?.panelPosition` 读取 `top` / `bottom` / `left` / `right`，缺省时使用现有硬编码值。`left` / `right` 优先使用 `panelPosition` 中的值，否则用 `layout.side` 推断。
- expand panel style：`top` / `bottom` 跟随 `panelPosition`，`left` / `right` 根据面板在左还是右自动推断（传了 `left` -> 面板在左 -> expand 在右；否则面板在右 -> expand 在左）。
- expand panel useEffect：不强制 `'right'`，保留当前 `layout.side`。
- header 控件：从 `aicoConfig?.controls` 读取 `maximize` / `close` / `dockFloat` / `drag` / `resize`，缺省 `true`。
- minimize 后的 panelStyle：从 `aicoConfig?.minimizedStyle` 读取，叠加到默认值上覆盖。

## aico-display-control

### 目标与规范依据

`displayAIAgent` handler 当前未传字段默认为 `false`，导致只传 `showPanel: true` 时 `showEntrance` 被误设为 `false`。`normalizeDisplayState` 的 `!showEntrance && showPanel` 规则阻止了无入口球+显示面板的组合。需要放开规则并修改 handler 行为。

本 Function 的目标 Requirements：

- Canonical spec：`aico-display-control`
- `ADDED initialDisplayState controls initial panel state on load`
- `ADDED closeBehavior controls close button action`
- `MODIFIED displayAIAgent preserves current values for absent fields`

### 当前实现

- `displayAIAgent` handler：`showEntrance: payload.showEntrance === true`（不传 = false），`showPanel: payload.showPanel === true`（不传 = false）。
- `normalizeDisplayState`：`!showEntrance && showPanel` -> 强制 `showPanel: false`。
- 无 `initialDisplayState`，面板加载后使用 `defaultDisplayState`。
- 无 `closeBehavior`，close 按钮固定调用 `closePanel()`。

### GAP 分析

- `displayAIAgent` 不传字段时丢失当前值。
- `normalizeDisplayState` 规则阻止无入口球+显示面板。
- 初始显示状态不可配置。
- 关闭按钮行为不可配置。

### 修改方案

- `displayAIAgent` handler：`typeof payload.showEntrance === 'boolean' ? payload.showEntrance : current.showEntrance`，同理 `showPanel`。未传字段保留当前值。
- `normalizeDisplayState`：新增可选 `options` 参数 `{ closeBehavior?: 'hide' | 'minimize' }`。`closeBehavior === 'minimize'` 时跳过 `!showEntrance && showPanel` 规则。不传 `options` 时行为不变。
- `loadAIAgentWithConfig`：应用 `config.closeBehavior` 到 store，应用 `config.initialDisplayState` 到 `normalizeDisplayState`（传入 `closeBehavior`）。
- `runtimeStore`：新增 `closeBehavior` 内部字段，`closePanel()` 在 `closeBehavior === 'minimize'` 时调用 `minimize()`。

## agent-web-piu-minimize

### 目标与规范依据

最小化面板位置固定为右下角，不可配置。`closeBehavior: 'minimize'` 作为新的最小化触发路径需要规范。`initialDisplayState: { minimized: true }` 作为初始最小化路径需要规范。

本 Function 的目标 Requirements：

- Canonical spec：`agent-web-piu-minimize`
- `MODIFIED Minimized rendering hides panel content without unmounting`
- `ADDED minimizedStyle overrides minimized panel positioning`

### 当前实现

- 最小化面板 inline style 固定为 `{ position: 'fixed', bottom: 16, right: 16, width: 360, borderRadius: 8 }`。
- 最小化触发路径：`minimizeAIAgent()` handler、`nextagent:piu-display-change` CustomEvent、MinimizedInputBox focus restore。
- `normalizeDisplayState` 的 `!showEntrance && showPanel` 规则阻止 `{ showEntrance: false, showPanel: true, minimized: true }`。

### GAP 分析

- 最小化面板位置不可配置。
- `closeBehavior: 'minimize'` 时 close 按钮触发最小化是新的触发路径。
- `initialDisplayState: { minimized: true }` 是新的初始最小化路径。
- `normalizeDisplayState` 需要在 `closeBehavior: 'minimize'` 时放开 `!showEntrance && showPanel`。

### 修改方案

- 最小化面板 inline style：`{ ...defaults, ...aicoConfig?.minimizedStyle }`，`minimizedStyle` 覆盖默认值。
- `closePanel()` 在 `closeBehavior === 'minimize'` 时调用 `minimize()`，成为最小化触发路径。
- `loadAIAgentWithConfig` 应用 `initialDisplayState: { minimized: true }` 时通过 `normalizeDisplayState`（传入 `closeBehavior: 'minimize'`）使 `{ showEntrance: false, showPanel: true, minimized: true }` 合法。

## 验证策略（Verification Strategy）

- 校验测试：`validateAICOConfig.test.ts` 断言 5 个新字段的合法值保留、非法值过滤、缺省返回 undefined。
- 契约测试：`piu-runtime-contract.test.tsx` 断言 `panelPosition` 渲染、`controls` 隐藏控件、`closeBehavior` 分流、`initialDisplayState` 应用、`minimizedStyle` 覆盖、`displayAIAgent` 保留当前值。
- 状态测试：`piu-state.test.ts` 断言 `closePanel` 分流、`normalizeDisplayState` 规则放开。
- 构建验证：`cd frontend/agent-web && npm run build && npm run build:vite:modes` 通过。

## 长期基线刷新计划（Baseline Promotion Plan）

- `openspec/specs/aico-config-contract/spec.md`：归档时合并 5 个新字段定义和默认值。
- `openspec/specs/aico-layout-mode/spec.md`：归档时合并 `panelPosition`、`controls`、`minimizedStyle`、expand panel 跟随规则。
- `openspec/specs/aico-display-control/spec.md`：归档时合并 `initialDisplayState`、`closeBehavior`、`displayAIAgent` 保留当前值。
- `openspec/specs/agent-web-piu-minimize/spec.md`：归档时合并 `minimizedStyle` 覆盖、`closeBehavior` 触发路径、`initialDisplayState` 初始最小化、`normalizeDisplayState` 放开规则。
- `openspec/designs/modules/agent-web.md`：归档时同步 PIU 面板位置和控件配置能力。
- `openspec/designs/spec-to-design-map.md`：无新增映射。

## 风险与取舍（Risks / Trade-offs）

- `panelPosition.left` 和 `panelPosition.right` 同时传入时，`left` 优先。这与 CSS `position: fixed` 中同时设 `left` 和 `right` 的行为不同（CSS 会拉伸元素），但与当前 `inferDockSide` 只选一侧的行为一致。
- `modalSize.width` 保持只支持 number，不支持 CSS 表达式（如 calc）。集成方需要传足够大的数值来近似占满剩余宽度。expand panel 和 resize 的数值运算依赖 number 类型。
- `normalizeDisplayState` 的 `options` 参数是可选的，不传时行为完全不变。现有调用方（openPanel、closePanel 等）不传 options，走原规则。

## 待确认问题（Open Questions）

无。