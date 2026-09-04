## ADDED Requirements

### Requirement: 最小化能力只作用于 collaborative PIU

`minimizeAIAgent` handler 和 `nextagent:piu-display-change` CustomEvent 监听器 SHALL 只在 `registerAIAgentPIU` 中注册。immersive 入口（`immersive.tsx`）和 local 入口（`local.tsx`）MUST NOT 注册 `minimizeAIAgent` 或监听该 CustomEvent。`AIAgentPiuRuntime` 组件和 `MinimizedInputBox` SHALL 只在 collaborative 模式下渲染。

#### Scenario: immersive 模式不注册 minimizeAIAgent
- **GIVEN** immersive 入口（`immersive.tsx`）已启动
- **WHEN** `piu.attach` 被调用
- **THEN** 被附加的 handlers MUST NOT 包含 `minimizeAIAgent`
- **AND** 不得有任何 `nextagent:piu-display-change` 监听器处于活跃状态

#### Scenario: local 模式不注册 minimizeAIAgent
- **GIVEN** local 入口（`local.tsx`）已启动
- **WHEN** mock prel 启动
- **THEN** `piu.attach` MUST NOT 以 `minimizeAIAgent` 被调用
- **AND** 不得有任何 `nextagent:piu-display-change` 监听器处于活跃状态

### Requirement: PIU 通过 attach 暴露 minimizeAIAgent handler

PIU SHALL 在 `piu.attach()` 中与既有 handlers 一起注册一个 `minimizeAIAgent` handler。该 handler SHALL 调用 `aiAgentPiuRuntimeStore.minimize()` 且不带 payload。集成方通过调用 `piu.emit('minimizeAIAgent')` 触发最小化。

`minimizeAIAgent` handler SHALL 独立于 `displayAIAgent`。调用 `minimizeAIAgent` SHALL NOT 修改 `showEntrance` 或 `showPanel`。调用 `displayAIAgent` SHALL NOT 修改 `minimized`。

`minimizeAIAgent` handler 类型 SHALL 声明在 `createHandlers` 返回类型中，遵循与 `loadAIAgent`、`displayAIAgent` 和 `sendQuestionToLui` 相同的模式。`prel.ts` 中的 `PIU.attach` 类型 SHALL NOT 被修改。

#### Scenario: minimizeAIAgent handler 已注册
- **GIVEN** PIU 已通过 `registerAIAgentPIU()` 注册
- **WHEN** `prel.start` 回调触发且 `piu.attach()` 被调用
- **THEN** 被附加的 handlers MUST 包含 `minimizeAIAgent`
- **AND** `minimizeAIAgent` MUST 是一个不要求必选参数的函数

#### Scenario: minimizeAIAgent 触发最小化状态
- **GIVEN** PIU panel 处于打开状态且 `showPanel === true`、`minimized === false`
- **WHEN** `minimizeAIAgent` handler 被调用
- **THEN** `aiAgentPiuRuntimeStore.getSnapshot().display.minimized` MUST 为 `true`
- **AND** `display.showEntrance` MUST 保持不变
- **AND** `display.showPanel` MUST 保持不变

#### Scenario: minimizeAIAgent 不影响 displayAIAgent 状态
- **GIVEN** PIU panel 处于打开状态且 `showEntrance === true`、`showPanel === true`
- **WHEN** `minimizeAIAgent` 被调用
- **THEN** `display.showEntrance` MUST 仍为 `true`
- **AND** `display.showPanel` MUST 仍为 `true`
- **AND** `display.minimized` MUST 为 `true`

#### Scenario: panel 隐藏时 minimizeAIAgent 是 no-op
- **GIVEN** PIU panel 处于隐藏状态且 `showPanel === false`、`minimized === false`
- **WHEN** `minimizeAIAgent` handler 被调用
- **THEN** `display.minimized` MUST 保持 `false`
- **AND** `display.showPanel` MUST 保持 `false`

### Requirement: CustomEvent 只触发最小化

PIU SHALL 在 `window` 上监听 `nextagent:piu-display-change` CustomEvent。当 `event.detail.minimized === true` 时，PIU SHALL 调用 `aiAgentPiuRuntimeStore.minimize()`。当 `event.detail.minimized` 为 `false` 或缺席时，PIU MUST 忽略该事件，SHALL NOT 调用 `store.restoreFromMinimized()`。

事件监听器 SHALL 在 `registerAIAgentPIU` 的 `prel.start` 回调期间与 `piu.attach` handlers 一起注册。监听器 SHALL 在页面生命周期内持续存在；`registerAIAgentPIU` 没有 PIU 卸载机制，监听器不需要单独清理。

#### Scenario: minimized 为 true 的 CustomEvent 触发最小化
- **GIVEN** PIU panel 处于打开状态且 `minimized === false`
- **WHEN** `window.dispatchEvent(new CustomEvent('nextagent:piu-display-change', { detail: { minimized: true } }))` 被调用
- **THEN** `aiAgentPiuRuntimeStore.getSnapshot().display.minimized` MUST 为 `true`

#### Scenario: minimized 为 false 的 CustomEvent 被忽略
- **GIVEN** PIU panel 处于最小化状态且 `minimized === true`
- **WHEN** `window.dispatchEvent(new CustomEvent('nextagent:piu-display-change', { detail: { minimized: false } }))` 被调用
- **THEN** `display.minimized` MUST 保持 `true`
- **AND** `store.restoreFromMinimized()` MUST NOT 被调用

#### Scenario: 不带 detail 的 CustomEvent 被忽略
- **GIVEN** PIU panel 处于打开状态且 `minimized === false`
- **WHEN** `window.dispatchEvent(new CustomEvent('nextagent:piu-display-change'))` 被调用
- **THEN** `display.minimized` MUST 保持 `false`

### Requirement: 展示状态模型包含 minimized 字段

`AIAgentDisplayState` SHALL 包含一个默认值为 `false` 的 `minimized: boolean` 字段。`normalizeDisplayState` 函数 SHALL 强制执行：当 `minimized === true` 且 `showPanel === false` 时，`minimized` MUST 被设为 `false`（隐藏的 panel 不能处于最小化状态）。

既有约束 `showEntrance === false && showPanel === true → showPanel = false` SHALL 保持不变。

#### Scenario: minimized 默认为 false
- **WHEN** 检查 `defaultDisplayState`
- **THEN** `minimized` MUST 为 `false`

#### Scenario: minimized 为 true 且 showPanel 为 false 时被归一化为 false
- **GIVEN** 一个展示状态 `{ showEntrance: true, showPanel: false, minimized: true }`
- **WHEN** `normalizeDisplayState` 被调用
- **THEN** `minimized` MUST 为 `false`

#### Scenario: minimized 为 true 且 showPanel 为 true 时被保留
- **GIVEN** 一个展示状态 `{ showEntrance: true, showPanel: true, minimized: true }`
- **WHEN** `normalizeDisplayState` 被调用
- **THEN** `minimized` MUST 为 `true`
- **AND** `showPanel` MUST 为 `true`

### Requirement: 最小化渲染隐藏 panel 内容而不卸载

当 `display.minimized === true` 时，PIU panel SHALL 渲染一个固定在屏幕右下角的 `MinimizedInputBox`。panel header、resize handles 和 body（包括 `ChatPageCore`）SHALL 通过 CSS `display: none` 隐藏，MUST NOT 被卸载。

`ChatPageCore` 组件及其 hooks（`useChatSessionStream`、`useChatViewportController`、`useChatComposerController`）SHALL 在最小化期间继续运行。SSE/WebSocket stream 连接 SHALL 保持打开。所有 Zustand store（conversation、session、request、skill）SHALL 保留其数据。

当 `display.minimized` 从 `true` 变为 `false` 时，panel SHALL 恢复之前的布局（docked/floating/maximized）并使 header 和 body 再次可见。`MinimizedInputBox` SHALL 被移除。

#### Scenario: 最小化 panel 渲染 MinimizedInputBox 并隐藏 body
- **GIVEN** PIU panel 处于打开状态且 `minimized === true`
- **WHEN** panel 渲染
- **THEN** `MinimizedInputBox` MUST 被渲染
- **AND** panel header MUST 具有 `display: none`
- **AND** panel body MUST 具有 `display: none`
- **AND** `ChatPageCore` MUST 保持挂载在 React 树中

#### Scenario: 最小化 panel 固定在右下角
- **GIVEN** PIU panel 处于打开状态且 `minimized === true`、布局 kind 为 `docked`
- **WHEN** panel 渲染
- **THEN** panel 容器 MUST 被定位在 viewport 右下角
- **AND** 当前 `CollaborativePanelLayout` 状态 MUST NOT 被修改

#### Scenario: 最小化期间 stream 连接持续存在
- **GIVEN** PIU panel 处于打开状态且带有活跃 SSE stream，`minimized` 变为 `true`
- **WHEN** panel 处于最小化状态
- **THEN** SSE stream 连接 MUST 保持打开
- **AND** 到达的 stream 消息 MUST 继续写入 `conversationStore`

#### Scenario: 恢复时返回之前的布局
- **GIVEN** PIU panel 已最小化且之前的布局为 `floating`
- **WHEN** `display.minimized` 变为 `false`
- **THEN** panel MUST 以 `floating` 布局渲染
- **AND** header 和 body MUST 可见
- **AND** `MinimizedInputBox` MUST NOT 被渲染

### Requirement: 恢复只由 MinimizedInputBox 聚焦触发

`MinimizedInputBox` SHALL 在其 textarea 获得焦点时从最小化状态恢复 panel。`onFocus` 事件 SHALL 调用 `aiAgentPiuRuntimeStore.restoreFromMinimized()`。SHALL 不存在其他恢复路径；`displayAIAgent` handler 和 CustomEvent 都 SHALL NOT 触发恢复。

#### Scenario: 聚焦 MinimizedInputBox 恢复 panel
- **GIVEN** PIU panel 处于最小化状态
- **WHEN** MinimizedInputBox 的 textarea 获得焦点
- **THEN** `display.minimized` MUST 变为 `false`
- **AND** panel MUST 恢复之前的布局

#### Scenario: displayAIAgent 不从最小化状态恢复
- **GIVEN** PIU panel 处于最小化状态
- **WHEN** `displayAIAgent({ showEntrance: true, showPanel: true })` 被调用
- **THEN** `display.minimized` MUST 保持 `true`

### Requirement: MinimizedInputBox 是一个最小的空 textarea

`MinimizedInputBox` SHALL 渲染单个 `<textarea>` 元素，不带 skill 选择器、附件、retry/edit 按钮、slash command 面板或关联面板。textarea SHALL 为空（没有预填内容）。textarea 占位符 SHALL 使用 i18n key `composer.placeholder`。`MinimizedInputBox` 的高度 SHALL 为 40px，低于当前 `MessageInput` 组件。

#### Scenario: MinimizedInputBox 渲染带 composer 占位符的空 textarea
- **GIVEN** PIU panel 处于最小化状态且 locale 为 `zh-cn`
- **WHEN** `MinimizedInputBox` 渲染
- **THEN** textarea MUST 为空
- **AND** textarea 占位符 MUST 是当前 locale 的 `composer.placeholder` 值
- **AND** MUST 不存在任何 skill 选择器、附件或 slash command 元素

### Requirement: 最小化强制关闭 expand panel

当 `store.minimize()` 被调用时，如果 `expandPanelStore.getState().isOpen === true`，最小化操作 SHALL 在转入最小化状态前调用 `expandPanelStore.close()`。当 panel 从最小化状态恢复时，expand panel SHALL NOT 自动重新打开。

#### Scenario: 最小化时关闭打开的 expandPanel
- **GIVEN** PIU panel 处于打开状态且 `expandPanelStore.isOpen === true`
- **WHEN** `store.minimize()` 被调用
- **THEN** `expandPanelStore.getState().isOpen` MUST 为 `false`
- **AND** `display.minimized` MUST 为 `true`

#### Scenario: 恢复时 expandPanel 不重新打开
- **GIVEN** PIU panel 已最小化且此前处于最小化状态
- **WHEN** panel 通过 MinimizedInputBox 聚焦恢复
- **THEN** `expandPanelStore.getState().isOpen` MUST 保持 `false`
