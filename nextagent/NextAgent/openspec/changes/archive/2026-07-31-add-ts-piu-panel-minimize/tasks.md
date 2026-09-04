## 1. 状态模型与 normalize 规则

- [x] 1.1 在 `AIAgentDisplayState` 新增 `minimized: boolean` 字段，默认 `false`。更新 `normalizeDisplayState` 规则：`minimized === true && showPanel === false` 时 `minimized` 纠正为 `false`。更新 `defaultDisplayState`、`openPanel`、`closePanel` 等 helper 保持 `minimized` 默认值。
  验证：`frontend/agent-web/tests/piu-state.test.ts` 断言 default 值、normalize 规则、非法组合纠正、面板隐藏时 minimized 保持 false。
  来源：Requirement "Display state model includes minimized field"。

## 2. Store 方法与 handler 注册

- [x] 2.1 在 `AIAgentPiuRuntimeStore` 新增 `minimize()` 和 `restoreFromMinimized()` 方法。`minimize()` 设置 `display.minimized = true`（经 `normalizeDisplayState` 处理，面板隐藏时为 no-op），并在调用前检查 `expandPanelStore.isOpen`，若为 true 则先调用 `expandPanelStore.close()`。`restoreFromMinimized()` 设置 `display.minimized = false`。
  验证：`frontend/agent-web/tests/piu-state.test.ts` 断言 minimize/restore 状态转换、expandPanel 关闭、面板隐藏时 no-op。
  来源：Requirement "Minimization force-closes expand panel"；Design "状态模型"。

- [x] 2.2 在 `createHandlers()` 新增 `minimizeAIAgent` handler，调用 `aiAgentPiuRuntimeStore.minimize()`。更新 `createHandlers` 返回类型声明（不修改 `prel.ts` 的 `PIU.attach` 类型）。在 `registerAIAgentPIU` 的 `prel.start` 回调中注册 `window` 的 `nextagent:piu-display-change` CustomEvent 监听器：`detail.minimized === true` 时调用 `store.minimize()`，`false` 或 absent 时忽略。监听器页面级持久，不需要单独清理。
  验证：`frontend/agent-web/tests/piu-runtime-contract.test.tsx` 断言 handler 注册、调用触发状态变更、CustomEvent 触发和忽略、detail.minimized=false 不调用 restore、沉浸式和本地模式不注册 handler。
  来源：Requirement "PIU exposes minimizeAIAgent handler through attach"；Requirement "CustomEvent triggers minimization only"；Requirement "Minimize capability is scoped to collaborative PIU only"。

## 3. 渲染策略与 MinimizedInputBox

- [x] 2.3 在 `AIAgentPiuRuntime.tsx` 的 `PiuContent` 中新增 minimized 渲染分支：`display.minimized === true` 时面板固定在右下角（`position: fixed; bottom: 0; right: 0`），header 和 body 设为 `display: none`，ChatPageCore 不卸载。新增 `MinimizedInputBox` 组件：空 textarea，placeholder 使用 `composer.placeholder`，`onFocus` 调用 `store.restoreFromMinimized()`，无 skill selector / attachments / slash / association。
  验证：`frontend/agent-web/tests/piu-runtime-contract.test.tsx` 断言 minimized 时 MinimizedInputBox 渲染、header/body 隐藏、ChatPageCore 保持 mounted、placeholder 文案、focus 触发 restore。
  来源：Requirement "Minimized rendering hides panel content without unmounting"；Requirement "MinimizedInputBox is a minimal empty textarea"；Requirement "Restore is triggered by MinimizedInputBox focus only"。

- [x] 2.4 新增恢复路径测试：MinimizedInputBox 的 `onFocus` 触发 `store.restoreFromMinimized()`，`display.minimized` 转为 `false`，面板回到之前 layout，header/body 恢复可见。断言 `displayAIAgent` 不触发 restore。
  验证：`frontend/agent-web/tests/piu-runtime-contract.test.tsx` 断言 focus 触发 restore 和 displayAIAgent 不影响 minimized。
  来源：Requirement "Restore is triggered by MinimizedInputBox focus only"。

## 4. 数据持久性

- [x] 2.5 新增数据持久性测试：最小化时 ChatPageCore 保持 mounted，stream 连接不断，conversationStore 数据不清。恢复后 store 数据和组件状态原样。
  验证：`frontend/agent-web/tests/piu-runtime-contract.test.tsx` 断言 minimized 前后 ChatPageCore 保持 mounted、conversationStore 数据不变。
  来源：Requirement "Minimized rendering hides panel content without unmounting"。

## 5. expandPanel 交互

- [x] 2.6 新增 expandPanel 强制关闭测试：最小化时 expandPanel 关闭，恢复后不自动重新打开。
  验证：`frontend/agent-web/tests/piu-runtime-contract.test.tsx` 断言 minimize 时 expandPanelStore.close() 被调用，restore 后 isOpen 仍为 false。
  来源：Requirement "Minimization force-closes expand panel"。

## 6. 验证

- [x] 3.1 运行相关前端测试。
  验证：`frontend/agent-web` 下相关 Vitest 命令全部通过。
  来源：Design "验证映射"。

- [x] 3.2 运行 build 和 strict validation。
  验证：`npm run build`、`openspec validate add-ts-piu-panel-minimize --strict` 通过。
  来源：AGENTS.md 验证门禁。

## 归档前更新基线检查（非实施任务）

归档前依据 proposal 和 design，将稳定的最小化行为契约同步至 `openspec/specs/agent-web-piu-minimize/spec.md`，并更新 `agent-web` 模块设计和 `spec-to-design-map` 的长期设计文档。
