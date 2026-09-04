## 背景和现状（Context）

PIU 协作式面板当前通过 `piu.attach()` 注册 handler 供集成方调用，已有 `loadAIAgent`、`displayAIAgent`、`switchLocale`、`switchTheme`、`sendQuestionToLui`。这些 handler 只在 `registerAIAgentPIU`（协作式入口 `src/entries/piu.tsx`）中注册。沉浸式入口（`src/entries/immersive.tsx`）的 `piu.attach` 只注册 `switchLocale` 和 `switchTheme`，本地入口（`src/entries/local.tsx`）使用 mock prel 且不调用 `piu.attach`。因此最小化功能天然只存在于协作式模式。

显示状态模型 `AIAgentDisplayState` 只有 `showEntrance` 和 `showPanel` 两个字段，没有最小化中间态。

面板渲染结构为 `<section> > <header> + <body> > ChatPageCore > RightPaneLayout > ComposerPanel`。ChatPageCore 内部挂载了 `useChatSessionStream`（SSE/WebSocket 连接）、`useChatViewportController`（滚动位置）和 `useChatComposerController`（草稿），以及多个 Zustand store（conversation、session、request、skill）。如果最小化时卸载 ChatPageCore，这些连接和组件状态会丢失。

仓库已有 CustomEvent 先例：`annotationService.ts` 通过 `window.dispatchEvent(new CustomEvent('nextagent:favorites-updated'))` 在 PIU 内部通信，命名风格为 `nextagent:` 前缀。

`PIU.attach` 的类型声明（`prel.ts`）当前不包含 `loadAIAgent`、`displayAIAgent`、`sendQuestionToLui` 等协作式自定义 handler——这些 handler 只在 `createHandlers` 的返回类型中声明。`minimizeAIAgent` 遵循同一模式，只更新 `createHandlers` 返回类型，不修改 `prel.ts`。

## 目标和非目标（Goals / Non-Goals）

**目标：**
- 提供两条最小化触发路径（attach handler 和 CustomEvent），收敛到同一个状态变更。
- 最小化时只渲染右下角极简输入框，隐藏其余面板内容但不卸载组件。
- 恢复路径唯一：输入框 focus 触发恢复，回到之前 layout。
- 保证最小化期间 stream 连接不断、数据不丢、恢复后一切原样。

**非目标：**
- 不修改 `displayAIAgent` 的 payload 或语义。最小化是独立 handler。
- 不为 CustomEvent 设计恢复通道。恢复只能通过输入框 focus。
- 不修改 layout 状态模型（不新增 layout kind）。最小化是 display 层覆盖，layout 状态保持不变。
- 不为最小化输入框实现发送、skill selector、attachments、slash command 或 association 功能。
- 不适用于沉浸式和本地模式。最小化 handler 和 CustomEvent 监听器只在 `registerAIAgentPIU` 中注册。

## 设计决策（Decisions）

选择唯一实现路径：

### 1. 触发通道：两条路径收敛到 store.minimize()

**路径一：attach handler**

在 `createHandlers()` 新增 `minimizeAIAgent` handler，调用 `aiAgentPiuRuntimeStore.minimize()`。集成方通过 `piu.emit('minimizeAIAgent')` 调用。这与现有 `displayAIAgent`、`switchLocale` 等 handler 完全同形，只是独立出来不混入 display payload。

不扩展 `displayAIAgent` 的 payload 加 `minimized` 字段，因为最小化是独立语义动作而非 display state 的一个维度。集成方调用 `displayAIAgent` 控制面板显隐，调用 `minimizeAIAgent` 控制最小化，职责清晰。

`minimizeAIAgent` 只在 `createHandlers` 返回类型中声明，不修改 `prel.ts` 的 `PIU.attach` 类型。这与现有 `loadAIAgent`、`displayAIAgent`、`sendQuestionToLui` 等协作式自定义 handler 保持同一模式。

**路径二：CustomEvent**

PIU 在 `registerAIAgentPIU` 的 `prel.start` 回调中注册 `window` 的 `nextagent:piu-display-change` 事件监听器。`detail: { minimized: true }` 时调用 `store.minimize()`。CustomEvent 只负责最小化，`detail.minimized` 为 `false` 时忽略——恢复只能通过输入框 focus。

监听器与 `piu.attach` handler 同生命周期：在 `prel.start` 回调中注册，页面级持久。`registerAIAgentPIU` 没有 PIU 卸载机制，监听器不需要单独清理。使用 `nextagent:` 前缀与现有 `nextagent:favorites-updated` 同风格。

### 2. 状态模型

在 `AIAgentDisplayState` 新增 `minimized: boolean`，默认 `false`。

normalize 规则更新：
- `minimized === true` 且 `showPanel === false` → `minimized = false`（不能最小化一个隐藏的面板）。
- 现有约束 `showEntrance === false && showPanel === true → showPanel = false` 保留不变。

`store.minimize()` 设置 `display.minimized = true`（经 `normalizeDisplayState` 处理，面板隐藏时为 no-op）。`store.restoreFromMinimized()` 设置 `display.minimized = false`。不修改 `CollaborativePanelLayout`，不新增 layout kind。

### 3. 渲染策略：隐藏不卸载

minimized 状态下，`PiuContent` 组件：
- `<section>` 面板容器不卸载，但 `panelStyle` 固定为右下角固定位置（`position: fixed; bottom: 0; right: 0`），忽略当前 layout。
- `<header>` PiuPanelHeader 和 resize handles 设为 `display: none`。
- `<div className="ai-agent-piu-body">` 设为 `display: none`。ChatPageCore 保持 mounted，`useChatSessionStream` 连接继续运行，消息继续写入 store。
- 渲染 `<MinimizedInputBox>`，替代 header 和 body。

不采用条件渲染卸载策略，因为卸载 ChatPageCore 会断开 SSE/WebSocket 连接、丢失组件内部状态（滚动位置、草稿、retry 状态），恢复后需要重连流和重建状态。

### 4. MinimizedInputBox

极简组件，只包含一个空 `<textarea>`：
- 复用 `composer.placeholder`（i18n `composer.placeholder`，中文"有问题，尽管问"，英文"Ask anything"）。
- `onFocus` → `aiAgentPiuRuntimeStore.restoreFromMinimized()`。
- 不预填当前草稿文本。ChatPageCore 未卸载，完整 MessageInput 的草稿本来就在，恢复后原样可见。
- 不包含 skill selector、attachments、retry/edit、slash command、association panel。
- 高度固定为 40px，低于现有 MessageInput。

### 5. expandPanel 交互

最小化时调用 `expandPanelStore.close()` 强制关闭 expandPanel。恢复时不自动重新打开。

`close()` 调用放在 `runtimeStore.minimize()` 中，使 `runtimeStore.ts` 新增对 `ExpandPanelStore.ts` 的 import 依赖。这是可接受的耦合：`minimize()` 需要原子地保证 expandPanel 关闭，放在 store 层比放在组件 useEffect 中更可测试。`runtimeStore` 不反向依赖任何 feature store，`ExpandPanelStore` 也不依赖 `runtimeStore`，不存在循环依赖。

## 质量属性设计（Quality Attributes）

| 质量属性 | 设计结论 | 验证入口 |
|---|---|---|
| 安全 | 最小化只受 PIU attach handler 和 CustomEvent 驱动；不接受请求体、模型输出或 capability 参数作为触发源。 | handler 注册测试断言 attach handler 集合；CustomEvent 监听测试。 |
| 性能/容量 | 最小化不卸载组件树，内存占用不降；但 CSS 隐藏后浏览器不渲染，layout/paint 开销降低。无新增 I/O。 | 渲染策略测试断言 ChatPageCore 保持 mounted。 |
| 可靠性/恢复 | stream 连接最小化期间不断开；恢复后数据和滚动位置原样。 | 数据持久性测试断言 store 数据和连接状态。 |
| 可维护性 | minimize/restore 是独立 handler，不与 displayAIAgent 混合；MinimizedInputBox 是独立组件，不侵入 MessageInput。 | 代码审查确认职责边界。 |
| 可测试性 | handler 注册、CustomEvent 监听、状态转换、渲染策略、恢复路径、数据持久性、expandPanel 关闭均可独立断言。 | Vitest 定向测试。 |
| 审计/可追溯性 | 无新增日志或审计事件；最小化是纯前端 display 状态变更。 | 代码审查确认。 |

## 验证映射（Verification Map）

| 约束 | Task | 验证入口 |
|---|---|---|
| minimizeAIAgent handler 注册并调用 store.minimize() | 1.1, 2.2 | `piu-runtime-contract.test.tsx` 断言 handler 存在且触发状态变更 |
| CustomEvent 监听只处理 minimized:true | 1.2, 2.2 | `piu-runtime-contract.test.tsx` 断言事件触发和忽略 |
| minimized 状态 normalize 规则 | 2.1 | `piu-state.test.ts` 断言非法组合被纠正 |
| 最小化时 CSS 隐藏不卸载 | 2.3 | `piu-runtime-contract.test.tsx` 断言 ChatPageCore 保持 mounted |
| 恢复路径为 focus 触发 | 2.4 | `piu-runtime-contract.test.tsx` 断言 onFocus 触发 restore |
| stream 连接和数据持久性 | 2.5 | `piu-runtime-contract.test.tsx` 断言 store 数据和连接状态 |
| expandPanel 强制关闭 | 2.6 | `piu-runtime-contract.test.tsx` 断言 expandPanelStore.close() 被调用 |
| CustomEvent 不负责恢复 | 2.2 | `piu-runtime-contract.test.tsx` 断言 detail.minimized=false 被忽略 |
| MinimizedInputBox 复用 composer.placeholder | 2.3 | 渲染测试断言 placeholder 文案 |
| 面板隐藏时 minimize 为 no-op | 2.1 | `piu-state.test.ts` 断言 showPanel=false 时 minimized 保持 false |
| 沉浸式和本地模式不受影响 | 2.2 | `piu-runtime-contract.test.tsx` 断言 handler 只在 registerAIAgentPIU 注册 |

## 文档承载决策（Documentation Ownership）

- 行为契约：`openspec/specs/agent-web-piu-minimize/spec.md` 是 PIU 面板最小化的唯一规范性承载。
- 架构和跨模块设计：无跨模块影响，纯前端 `frontend/agent-web` 内部变更。
- 模块设计：`openspec/designs/modules/agent-web.md` 归档时补充 PIU 最小化能力的模块职责。
- ADR：无。此变更复用现有 PIU attach handler 和 CustomEvent 通道，未引入长期新取舍。
- 导航：`openspec/designs/spec-to-design-map.md` 归档时新增导航。

## 风险与取舍（Risks / Trade-offs）

- [最小化时组件树不卸载，内存占用不降] -> 接受。数据持久性要求 stream 不断、状态不丢，CSS 隐藏是唯一可行策略。浏览器对 `display:none` 元素不进行 layout/paint，实际渲染开销已降低。
- [CustomEvent 可能在监听器注册前被 dispatch] -> 接受。监听器在 `prel.start` 回调中注册，此时 PIU 已 ready。集成方在 PIU ready 后 dispatch 事件是合理预期。若事件在注册前到达，PIU 不会响应，集成方可重试。
- [minimizeAIAgent 与 displayAIAgent 职责边界] -> minimizeAIAgent 只管最小化，displayAIAgent 只管显隐。两者独立，不互相调用。最小化时 showPanel 保持 true。
- [runtimeStore 新增对 expandPanelStore 的 import 依赖] -> 接受。minimize() 需要原子地关闭 expandPanel，store 层调用比组件 useEffect 更可测试。无循环依赖。

## 迁移计划（Migration Plan）

无数据迁移。变更纯前端，发布后直接生效。集成方按需调用 `piu.emit('minimizeAIAgent')` 或 dispatch CustomEvent。未使用最小化能力的集成方不受影响。沉浸式和本地模式不包含此功能，不受影响。

## 归档前更新基线（Baseline Promotion Plan）

- `openspec/specs/agent-web-piu-minimize/spec.md`: 新增 PIU 面板最小化行为契约。
- `openspec/designs/modules/agent-web.md`: 归档时补充 PIU 最小化模块职责。
- `openspec/designs/spec-to-design-map.md`: 归档时新增导航。

## 待确认问题（Open Questions）

无。

## 长期基线刷新计划

本节将旧模板的“归档前更新基线”归一为可审计的归档门禁；以下均为**归档前待执行**，不表示 stable baseline 已刷新。

- **Function：**以 `FN-5.6-向用户提问` 为唯一用户可见行为 owner；若本 change 增加的行为不能被该 Function 的既有边界完整表达，先在同一能力域新增一个单一职责 Function，再更新 `openspec/designs/functions/index.md`，不得把实现细节直接写入 Function。
- **Stable spec：**将 delta Requirement 合并至 `openspec/specs/agent-web-piu-minimize/spec.md`，逐条核对 Requirement 标题、MUST/SHALL 语义、场景、迁移和 metadata；不得以 `--skip-specs` 绕过同名 Requirement 重叠。
- **长期设计：**先执行本 design/proposal 已列出的“归档前更新基线”设计 owner；再在 `openspec/designs/spec-to-design-map.md` 为上述 stable spec 写入该 Function、实际承载的 architecture/module/ADR 与验证入口。若现有 map 无该 spec 行，先创建该行，而非把 change-local design 当作长期设计。
- **归档判定：**Function、stable spec、长期设计和 map 四端均完成 diff 审阅且 `openspec validate --all --strict` 通过后，才允许归档；任一端无法唯一归属时保留 active 并标记阻塞。
