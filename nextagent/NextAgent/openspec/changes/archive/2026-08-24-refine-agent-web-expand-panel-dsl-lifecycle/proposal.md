## Why

`@cloudsop/dsl-engine-web` 通过 `init` 接管扩展面板容器 div 直接渲染内容，并维护自己的展开状态。当前 NextAgent 扩展面板 store 只记录 `isOpen`/`content`/`view`，不区分内容来源，导致：

- DSL 面板场景下仍渲染 NextAgent 的 header（含关闭按钮），与 DSL 自带的关闭按钮重复。
- DSL 面板被外部关闭/替换（例如打开定时任务等）时，DSL 引擎未收到清理通知，其内部状态仍认为面板已打开，无法再次打开。

## 目标与非目标

### 目标

- 扩展面板 MUST 区分内容来源：React 结构化内容、React 视图页、DSL 引擎直接接管。
- DSL 引擎通过 `init` 打开扩展面板时，NextAgent 不渲染 header（含关闭按钮）。
- DSL 来源被外部关闭或切换到其他来源时，NextAgent MUST 触发注册的清理回调，让宿主/DSL 引擎重置状态。
- DSL 正常关闭（点击 DSL 自带关闭按钮并回调 `handleExpandPanel(false)`）时，NextAgent 不重复触发清理回调。

### 非目标

- 不修改 `SimpleDslRenderer` 渲染路径；该路径仍走 React 结构化内容，保留 header。
- 不修改 DSL 引擎内部实现；只规范 NextAgent 与 DSL 引擎之间的生命周期回调契约。
- 不修改 expand panel 与 TurnRunGraphPanel 的互斥逻辑。

## What Changes

- `ExpandPanelStore` 增加 `contentSource`（`'react' | 'dsl' | 'view' | null`）。
- `ExpandPanelStore` 增加 `openDsl()` 与 `closeDsl()` 方法；`close()`、`setContent()`、`setView()` 在从 `'dsl'` 来源切换时触发已注册的清理回调。
- `renderRoot` 中 DSL `init` 的 `handleExpandPanel(true/false)` 分别映射到 `openDsl()` / `closeDsl()`。
- `ExpandPanel` 在 `contentSource === 'dsl'` 时不渲染 header。
- `ImmersiveApp` 与 `AIAgentPiuRuntime` 注册清理回调，向 `piu` 发送 `smart-canvas:clearExpandPanel`。

## Function 影响

- 不涉及新 Function；仅修改 `agent-web-expand-panel` 规格。

## 影响范围

- actor：immersive 与 collaborative 宿主下使用 DSL 扩展面板的用户。
- 前端：`frontend/agent-web` 的 expand panel 相关组件与 store。
- 测试：expand panel store 测试、layout 测试。
