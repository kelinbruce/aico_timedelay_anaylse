## 背景与问题（Why）

协作式场景下，PIU 面板占据较大屏幕空间。集成方需要一种轻量手段将完整会话面板最小化为右下角极简输入框，让用户在不使用面板时释放页面空间，同时保留随时恢复对话的能力。

当前 PIU 的显示控制只有"入口按钮"和"完整面板"两种状态，没有最小化中间态。集成方也没有通过外部触发最小化的通道。

此功能仅适用于协作式 PIU（`registerAIAgentPIU` 入口）。沉浸式（`immersive.tsx`）和本地模式（`local.tsx`）不包含此功能——它们的 `piu.attach` 调用不注册 `minimizeAIAgent` handler，也不渲染 `AIAgentPiuRuntime` 组件。

## 变更范围（What Changes）

- 新增 PIU attach handler `minimizeAIAgent`，集成方通过 `piu.emit('minimizeAIAgent')` 触发最小化。仅在 `registerAIAgentPIU` 中注册。
- 新增 CustomEvent 监听 `nextagent:piu-display-change`，`detail: { minimized: true }`，作为集成方触发最小化的第二条通道。监听器在 `registerAIAgentPIU` 的 `prel.start` 回调中注册，页面级持久。CustomEvent 只负责最小化，不负责恢复。
- 在 `AIAgentDisplayState` 新增 `minimized` 字段。最小化是独立于 `displayAIAgent` 的 handler，不混入现有 display payload。
- 最小化时面板固定在屏幕右下角，只渲染一个极简输入框（空 textarea + 复用 `composer.placeholder`），隐藏 header、resize handles 和 body。面板内部组件（ChatPageCore、stream 连接、所有 store）不卸载，仅 CSS 隐藏，保证恢复后数据和流不丢失。
- 恢复路径唯一：最小化输入框 `onFocus` 触发 `store.restore()`，回到之前的 layout（docked/floating/maximized 原样恢复）。输入框内容回灌到完整面板的 MessageInput。
- 最小化时强制关闭 expandPanel。

## Capability 影响（Capabilities）

### 新增 Capability
- `agent-web-piu-minimize`: 定义协作式 PIU 面板最小化至输入框的外部触发、状态模型、渲染策略、恢复路径和数据持久性。

### 修改的 Capability
- 无。

## 影响范围（Impact）

- `frontend/agent-web/src/piu/displayState.ts`: 新增 `minimized` 字段和对应 normalize 规则。
- `frontend/agent-web/src/piu/runtimeStore.ts`: 新增 `minimize()` 和 `restore()` 方法。
- `frontend/agent-web/src/piu/registerAIAgentPIU.tsx`: 新增 `minimizeAIAgent` handler；注册 CustomEvent 监听器。更新 `createHandlers` 返回类型声明。
- `frontend/agent-web/src/piu/AIAgentPiuRuntime.tsx`: minimized 状态下的渲染分支（CSS 隐藏完整面板 + 渲染 MinimizedInputBox）。
- `frontend/agent-web/src/features/expand-panel/ExpandPanelStore.ts`: 无直接修改，但最小化时由 `runtimeStore.minimize()` 调用 `expandPanelStore.close()`。
- 测试覆盖：handler 注册与调用、CustomEvent 监听与触发、minimized 状态转换、渲染策略（隐藏不卸载）、恢复路径（focus 触发）、数据持久性（stream 不断、store 不清）、expandPanel 强制关闭、面板隐藏时 minimize 为 no-op。

## 归档前更新基线（Baseline Promotion Plan）

行为契约：
- `openspec/specs/agent-web-piu-minimize/spec.md`: 新增 PIU 面板最小化的外部触发通道、状态模型、渲染策略、恢复路径和数据持久性行为契约。

长期背景：
- `openspec/overview.md`: 无。

设计视图：
- `openspec/designs/modules/agent-web.md`: 归档时补充 PIU 最小化能力的模块职责。
- `openspec/designs/spec-to-design-map.md`: 归档时新增 `agent-web-piu-minimize` 的导航。

验证入口：
- `frontend/agent-web/tests/piu-state.test.ts`: minimized 状态转换和 normalize 规则。
- `frontend/agent-web/tests/piu-runtime-contract.test.tsx`: handler 注册、CustomEvent 监听、渲染策略、恢复路径、数据持久性、expandPanel 关闭。
- `openspec validate add-ts-piu-panel-minimize --strict`。
