# add-piu-panel-position-and-display-control

## Why

NextAgent PIU collaborative 模式当前面板位置全部硬编码（	op: PREL_MENU_HEIGHT 63.2px、ight: 0 / left: 0），无法适应不同集成方页面布局。集成方有两种新场景需要面板在不同位置渲染，且需要控制关闭按钮行为、初始显示状态、控件可见性和最小化面板样式。

## 目标与非目标（Goals / Non-Goals）

**目标：**

- 新增 panelPosition 参数：暴露面板的 	op / ottom / left / ight 位置，覆盖当前硬编码值。
- 新增 closeBehavior 参数：控制关闭按钮行为为 'hide'（默认，现有行为）或 'minimize'（关闭=最小化，保留 session/stream）。
- 新增 initialDisplayState 参数：loadAIAgent 时一次性应用初始显示状态（含 minimized），支持加载即最小化。
- 新增 controls 参数：控制 maximize、close、dockFloat、drag、resize 五个交互控件的可见性。
- 新增 minimizedStyle 参数：覆盖最小化面板的默认 inline style（位置、宽度等）。
- 修改 displayAIAgent handler：未传字段保留当前值，而非默认为 alse。
- 修改 
ormalizeDisplayState：在 closeBehavior: 'minimize' 时放开 !showEntrance && showPanel 规则。
- expand panel 的位置跟随 panelPosition，且不再强制 setDocked(width, 'right')。

**非目标：**

- 不改变 overlay 模式下的 position: fixed 定位方式。
- 不改变 modalSize.width 只支持 
umber 的约束。
- 不修改 floating 和 maximized 布局逻辑。
- 不新增 panelMode: 'embedded' 或 ntranceMode。
- 不修改 PIU.attach 类型签名。
- 不修改 local / immersive 宿主行为。

## What Changes

- 	ypes.ts：新增 PanelPosition、CloseBehavior 类型，扩展 AICOConfig 接口新增 5 个 optional 字段。
- alidateAICOConfig.ts：新增 alidatePanelPosition、alidateCloseBehavior、alidateInitialDisplayState、alidateControls、alidateMinimizedStyle 校验函数。
- displayState.ts：
ormalizeDisplayState 新增可选 options 参数，closeBehavior: 'minimize' 时跳过 !showEntrance && showPanel 规则。
- untimeStore.ts：新增 closeBehavior 内部字段和 setCloseBehavior 方法，closePanel 根据 closeBehavior 分流。
- egisterAIAgentPIU.tsx：loadAIAgentWithConfig 应用 closeBehavior 和 initialDisplayState；displayAIAgent handler 未传字段保留当前值并传入 closeBehavior。
- AIAgentPiuRuntime.tsx：panelStyle 读取 panelPosition；expand panel 位置跟随 panelPosition；header 控件按 controls 条件渲染；drag 和 resize 按 controls 条件启用。

## Function 影响（OpenSpec Capabilities）

### 修改的 Function

| Function | spec | 变化边界 |
|---|---|---|
| FN-10.6 前端定制 | ico-config-contract | 新增 5 个 AICOConfig 字段定义和默认值 |
| FN-10.6 前端定制 | ico-layout-mode | panelPosition 位置参数、controls 控件开关、minimizedStyle 样式覆盖、expand panel 跟随 |
| FN-10.6 前端定制 | ico-display-control | initialDisplayState、closeBehavior、displayAIAgent 保留当前值 |
| FN-10.6 前端定制 | gent-web-piu-minimize | minimizedStyle 覆盖位置、closeBehavior: 'minimize' 触发路径、initialDisplayState 初始最小化、
ormalizeDisplayState 放开规则 |

## 影响范围（Impact）

- actor：使用 collaborative/PIU 宿主的集成方和最终用户。
- 前端：rontend/agent-web 的 ico-config/types.ts、ico-config/validateAICOConfig.ts、piu/displayState.ts、piu/runtimeStore.ts、piu/registerAIAgentPIU.tsx、piu/AIAgentPiuRuntime.tsx。
- 测试：ico-config/validateAICOConfig.test.ts、	ests/piu-runtime-contract.test.tsx、	ests/piu-state.test.ts。
- 配置：新增 5 个 optional AICOConfig 字段，全部缺省时行为与现有完全一致。
