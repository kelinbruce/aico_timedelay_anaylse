## 背景和现状（Context）

协作式 PIU（`registerAIAgentPIU` 入口）通过 `piu.attach()` 注册 handler 供集成方调用，已有 `loadAIAgent`、`displayAIAgent`、`minimizeAIAgent`、`switchLocale`、`switchTheme`、`sendQuestionToLui`、`renderKnowledge`。这些 handler 只在 `createHandlers` 返回类型声明，不修改 `prel.ts` 的 `PIU.attach` 类型。`renderKnowledge` 是最近的先例：它在 `createHandlers` 新增 handler、用独立 React root + `AppProviders` 渲染、不修改 `prel.ts`。

`PiuRenderer`（`aico-config/PiuRenderer.tsx`）已封装 `Prel.autoLoad` + `piu.emit` + cleanup 逻辑：接收 `PIUInfoItem`（`piuName`/`piuVersion`/`renderFunc`/`data`），生成唯一 `containerId`，`useEffect` 中 `autoLoad` 后 `emit`，卸载时清空 container DOM。`PiuContext` 提供 `piu` 和 `site` 给后代组件。

`AIAgentPiuRuntime.tsx` 的 `PiuContent` 组件当前按 `hasNoPermission` -> `isCustomPanel` -> `ChatPageCore` 分支渲染 body。`ChatPageCore`（`pages/ChatPage.tsx`）的 `mainContent` 区域渲染 `MessageList`，外层由 `RightPaneLayout` 的单一滚动容器 `right-pane-scroll-viewport` 统一滚动。`ChatPageCore` 接受 `headerSlot`、`composerBridgeRef`、`navigation`、`isConversationSurfaceVisible` 等 props。

`aiAgentPiuRuntimeStore` 持有 panel display state（`showPanel`/`showEntrance`/`minimized`）、layout、site、piu ref、activeSessionId 等。`openPanel()` 设置 `showPanel: true` 但不改变 `minimized` 标志；`restoreFromMinimized()` 设置 `minimized: false`。

## 目标和非目标（Goals / Non-Goals）

**目标：**

- 新增协作式 PIU attach handler `handleHistoricalChatReplay`，接收 `{ piuName, piuVersion, method, chatId, data }` payload。
- 回放前如果面板未打开或处于最小化状态，打开会话面板。
- 以 `chatId` 为唯一标识去重：相同 `chatId` 不重复渲染，不同 `chatId` 追加到回放集合。
- 回放内容渲染为 PIU（复用 `PiuRenderer`），替换对话视图：当 `aboveMessagesSlot` 存在时，`WelcomeState` 和 `MessageList` 被抑制，回放内容独占对话面板的主内容区域。
- 回放数据是独立的，只有答案区域，不渲染额外对话元素；回放数据不参与 share/report/fork/annotation/retry/edit 等对话操作。
- 回放前如果有活跃会话，清除活跃会话（不清除已有回放条目），避免系统会话数据与回放内容混合。
- 面板关闭、会话切换（含新建会话）时清除全部回放条目。minimize 不清除。
- payload 中与 `piuName` 同级的其他字段（如 `chatId`、`isHistory` 等）收集为 `extraPayload`，通过 `PiuRenderer` 的 `extraPayload` prop 传递给 `piu.emit`。

**非目标：**

- 不修改 `prel.ts` 的 `PIU.attach` 类型。
- 不修改 `conversationStore`、`sessionStore`、`requestStore` 或后端任何 package。
- 不持久化回放条目；回放数据是纯内存本地视图状态。
- 不为回放条目添加单独关闭按钮或全局返回按钮。
- 不适用于沉浸式和本地模式。
- 不改变 `ChatPageCore` 既有消息列表渲染、滚动锚定、viewport controller 逻辑（仅在 `aboveMessagesSlot` 存在时抑制渲染）。

## 设计决策（Decisions）

### handler 注册与 payload 校验

**唯一实现路径**：在 `registerAIAgentPIU.tsx` 的 `createHandlers` 返回类型新增 `handleHistoricalChatReplay?: (payload: unknown) => void`，并在返回对象中实现该方法。不修改 `prel.ts`，与 `renderKnowledge`/`loadAIAgent` 等协作式自定义 handler 同形。

payload 校验：`piuName`、`piuVersion`、`method`、`chatId` 必须为非空字符串（trim 后长度 > 0），否则 `console.warn` 并返回。`data` 字段保留为 `unknown`，不做类型过滤；`HistoricalChatReplayView` 渲染时通过 `toPiuData` 窄化：纯对象保留为 `Readonly<Record<string, unknown>>`，数组包裹为 `{ data: [...] }`，其他类型置为 `undefined`。

sibling 字段收集：payload 中除 `piuName`/`piuVersion`/`method`/`data` 之外的所有字段（包括 `chatId` 和 `isHistory` 等）收集到 `extraPayload: Readonly<Record<string, unknown>>`，通过 `PiuRenderer` 的 `extraPayload` prop 传递，确保 `piu.emit` 的 payload 包含这些字段。

清除活跃会话：如果 `aiAgentPiuRuntimeStore.getSnapshot().activeSessionId` 非空，调用 `clearActiveSessionForReplay()` 清除活跃会话但不清除已有回放条目。这避免打开过的历史会话数据与回放内容混合。

面板打开：调用 `aiAgentPiuRuntimeStore.openPanel()` 后紧跟 `aiAgentPiuRuntimeStore.restoreFromMinimized()`。`openPanel()` 设置 `showPanel: true` 但保留 `minimized` 标志不变；`restoreFromMinimized()` 确保 `minimized: false`。两步组合保证面板从关闭或最小化状态都恢复到可见。

### 本地视图状态 store

**唯一实现路径**：新建 `historicalChatReplayStore.ts`，使用 zustand（与 `expandPanelStore`/`aicoConfigStore` 同形）。store 持有 `entries: Map<string, ReplayEntry>` 和 `entryOrder: string[]`（记录 chatId 追加顺序），提供 `startReplay(entry)` 和 `clearAllReplays()` 方法。

```typescript
interface ReplayEntry {
  readonly chatId: string;
  readonly piuName: string;
  readonly piuVersion: string;
  readonly method: string;
  readonly data: unknown;
  readonly extraPayload: Readonly<Record<string, unknown>>;
}
```

`startReplay(entry)`：如果 `entries` 已有相同 `chatId`，no-op（去重）；否则追加到 `entries` 和 `entryOrder`。
`clearAllReplays()`：清空 `entries` 和 `entryOrder`。

为什么不持久化：回放数据是外部 host 提供的临时视图状态，没有 canonical session/request/run 绑定。持久化会引入持久化 owner 和 gateway 边界问题，超出 `frontend/agent-web` 的本地视图状态所有权。

为什么不进入 conversationStore：`conversationStore` 的消息列表严格来自后端 canonical stream/history。将合成的 PIU 条目注入 conversationStore 会混淆 canonical truth 边界，违反架构约束。

### 回放区域渲染：aboveMessagesSlot

**唯一实现路径**：在 `ChatPageCore` 新增可选 `aboveMessagesSlot?: React.ReactNode` prop。当 `aboveMessagesSlot` 存在时，`shouldShowWelcome` 三元（渲染 `WelcomeState` 或 `MessageList`）被抑制（`{!aboveMessagesSlot && (...)}`），回放内容替换对话视图的主内容区域。local 和 immersive 不传此 prop，行为完全不变。

渲染位置（`ChatPage.tsx` `mainContent` 内）：

```text
<div style={{ flex: 1, minHeight: 0, position: 'relative' }}>
  {aboveMessagesSlot}                              <- 回放区域在此渲染
  {!aboveMessagesSlot && (shouldShowWelcome ? (    <- 回放存在时抑制
    <WelcomeState ... />
  ) : (
    <MessageList ... />
  ))}
</div>
```

`aboveMessagesSlot` 在 `RightPaneLayout` 的 `right-pane-scroll-viewport` 滚动容器内，回放内容独占该滚动流，实现整体滚动。回放内容高度变化时，`RightPaneLayout` 的 `ResizeObserver` 自动更新滚动条 gutter 宽度，不需要额外滚动逻辑。

为什么不与对话共存：用户要求回放数据是独立的，只有答案区域，不渲染额外对话元素。回放与系统会话数据互斥，避免混合。

### HistoricalChatReplayView 组件

新建 `HistoricalChatReplayView.tsx`，从 `historicalChatReplayStore` 读取 `entries` 和 `entryOrder`，按 `entryOrder` 顺序 map 每个 `ReplayEntry` 到 `ReplayPiuRenderer`：

```text
<div data-testid="historical-chat-replay-view">
  {entryOrder.map(chatId => {
    const entry = entries.get(chatId);
    return <ReplayPiuRenderer key={chatId} entry={entry} />;
  })}
</div>
```

`ReplayPiuRenderer` 是 `React.memo` 包装的组件，接收不可变 `ReplayEntry` 作为唯一 prop。`memo` 防止新增回放条目时已有条目重渲染——否则 `PiuRenderer` 的 `useEffect` cleanup（`containerEl.replaceChildren()`）会清空已有 PIU 的 DOM 内容。

`PiuRenderer` 复用 `PiuContext` 获取 `piu`，自动处理 `autoLoad` + `emit` + cleanup。每条回放以 `chatId` 为 React key，保证同一 `chatId` 的 `PiuRenderer` 实例稳定。

回放区域不渲染 process panel、thinking chain、bubble actions。回放条目不携带 `runId`/`requestId`，不进入 `MessageList`/`TurnBlock`，因此 share/report/fork/annotation/retry/edit 等对话操作自然不可用。

### 清除触发

在 `aiAgentPiuRuntimeStore` 的 `closePanel`、`openSession`、`openNewSession` 方法中调用 `historicalChatReplayStore.getState().clearAllReplays()`。这与 `minimize()` 调用 `expandPanelStore.getState().close()` 的跨 store 清理模式一致。

`clearActiveSessionForReplay()` 是 `clearActiveSession` 的回放专用变体：清除 `activeSessionId` 和 `activeSessionTitle` 并持久化 null，但不调用 `clearAllReplays()`，与 `openNewSession()`（同时清除会话和回放）区分。

minimize 不清除：与用户要求一致，也和 `expandPanelStore` 在 minimize 时 close（但不销毁数据）的模式类似。minimize -> restore 时 `PiuRenderer` 的 `useEffect` cleanup 会清空 container DOM，React 重新挂载时重新 `autoLoad` + `emit`，这是可接受的行为。

### data 保留与 toPiuData 窄化

`ReplayEntry.data` 类型为 `unknown`，handler 层不做类型过滤，保留原始值。`HistoricalChatReplayView` 渲染时通过 `toPiuData` 窄化：纯对象保留为 `Readonly<Record<string, unknown>>`，数组包裹为 `{ data: [...] }`（防止 spread 产生数字索引键），其他类型（null/undefined/string/number/boolean）置为 `undefined`。`PIUInfoItem.data` 类型接受 `Readonly<Record<string, unknown>> | readonly unknown[]`。

守卫在 view 层而非 handler 层或 `PiuRenderer` 中：handler 保持 `data` 原样以支持未来需要完整 `data` 的场景；view 层在传入 `PiuRenderer` 前窄化，保证 spread 操作安全；不修改共享组件 `PiuRenderer`。

**放弃的备选方案：**

- 修改 `prel.ts` 的 `PIU.attach` 类型加 `handleHistoricalChatReplay`：放弃，与 `renderKnowledge`/`minimizeAIAgent` 同形同策，这些 handler 只在 `createHandlers` 返回类型声明。
- 回放与对话共存（原方案）：放弃，用户明确要求回放数据独立，只有答案区域，不渲染额外对话元素。
- 在 `conversationStore` 注入回放消息：放弃，违反 canonical truth 边界。
- 在 `PiuRenderer` 内加 spread 守卫：放弃，修改共享组件扩大影响范围；守卫在 view 层即可。
- 回放条目单独关闭按钮：放弃，用户明确不需要。
- 全局返回按钮：放弃，用户明确不需要。

## 质量属性设计（Quality Attributes）

| 质量属性 | 设计结论 | 验证入口 |
|---|---|---|
| 安全 | handler 只接受 `piuName`/`piuVersion`/`method`/`chatId`/`data` 及 sibling 字段，不接收身份、agent scope 或 capability 参数；回放数据不进入 canonical stream/session/request。无新增 secret/prompt 泄露面。 | 代码审查确认无身份/credential 字段进入 payload |
| 性能/容量 | 回放条目数量由外部 host 控制调用频率决定；`chatId` 去重防止重复渲染。每条 `PiuRenderer` 独立 `autoLoad` + `emit`，与现有 `CustomPanelRenderer` 同模式。`React.memo` 防止已有条目重渲染。 | store 去重测试、多条回放渲染测试、memo 行为测试 |
| 可靠性/恢复 | 纯前端本地视图状态，无 stream 连接、持久化或 terminal commit 影响。面板关闭/会话切换时清除，不残留。handler 缺必填字段时 warn 返回，不崩溃。 | handler 缺字段测试、清除触发测试 |
| 可维护性 | 复用 `PiuRenderer` 和 `PiuContext`，不新建平行渲染组件；store 与 `expandPanelStore` 同形。`aboveMessagesSlot` 是向后兼容的可选 prop 扩展。 | 架构检查确认无平行类型、无 private import |
| 可测试性 | store 是纯 zustand store，去重和清除可单测；handler 注册和 payload 校验可单测；`HistoricalChatReplayView` 渲染可单测；`extraPayload` 传递可单测。 | `historicalChatReplayStore.test.ts`、`piu-runtime-contract.test.tsx`、`HistoricalChatReplayView.test.tsx` |
| 审计/可追溯性 | 无新增日志/审计事件；纯前端 display 层变更。 | 不适用 |

## 验证映射（Verification Map）

| 约束 | Task | 验证入口 |
|---|---|---|
| handleHistoricalChatReplay 仅在 registerAIAgentPIU 注册 | A.1 | `piu-runtime-contract.test.tsx` 断言 immersive/local 不注册 |
| payload 校验：缺必填字段 warn 返回 | A.2 | `piu-runtime-contract.test.tsx` 覆盖缺 piuName/piuVersion/method/chatId |
| data 保留：unknown 类型不过滤 | A.2 | `piu-runtime-contract.test.tsx` 覆盖 string/array/null/undefined/object data |
| sibling 字段收集为 extraPayload | A.2 | `piu-runtime-contract.test.tsx` 断言 extraPayload 包含 chatId 和 isHistory |
| extraPayload 传递到 PiuRenderer | A.2 | `HistoricalChatReplayView.test.tsx` 断言 lastExtraPayload 包含预期字段 |
| 回放前清除活跃会话 | A.3 | `piu-runtime-contract.test.tsx` 断言 clearActiveSessionForReplay 被调用且 activeSessionId 为 null |
| 回放前打开面板 | A.3 | `piu-runtime-contract.test.tsx` 断言 openPanel + restoreFromMinimized 被调用 |
| chatId 去重：相同 chatId 不重复渲染 | B.1 | `historicalChatReplayStore.test.ts` 断言 entries size 不变 |
| 不同 chatId 追加 | B.1 | `historicalChatReplayStore.test.ts` 断言 entries size 增长且顺序正确 |
| clearAllReplays 清空 | B.1 | `historicalChatReplayStore.test.ts` 断言 entries 清空 |
| closePanel 触发清除 | C.1 | `piu-runtime-contract.test.tsx` 断言 closePanel 后 store 为空 |
| openSession 触发清除 | C.1 | `piu-runtime-contract.test.tsx` 断言 openSession 后 store 为空 |
| openNewSession 触发清除 | C.1 | `piu-runtime-contract.test.tsx` 断言 openNewSession 后 store 为空 |
| minimize 不清除 | C.2 | `piu-runtime-contract.test.tsx` 断言 minimize 后 store 仍有条目 |
| aboveMessagesSlot 向后兼容 | C.3 | `ChatPageCore` 不传 aboveMessagesSlot 时行为不变（现有测试通过） |
| aboveMessagesSlot 存在时抑制 welcome | C.3 | spec scenario 断言 WelcomeState 和 MessageList MUST NOT 渲染 |
| 回放区域渲染 PiuRenderer | C.4 | `HistoricalChatReplayView.test.tsx` 断言 PiuRenderer 被渲染 |
| React.memo 防止已有条目重渲染 | C.4 | `HistoricalChatReplayView.test.tsx` 断言新增条目不影响已有条目 |
| 回放条目不参与对话操作 | C.5 | 代码审查确认回放条目不进入 MessageList/TurnBlock |
| 不修改 prel.ts | A.1 | git diff 检查 prel.ts 无修改 |

## 文档承载决策（Documentation Ownership）

- 行为契约：`openspec/specs/agent-web-piu-historical-chat-replay/spec.md`
- 架构和跨模块设计：无（纯前端 `agent-web` 内部变更，无跨模块流程）
- 模块设计：`openspec/designs/modules/agent-web.md`（归档时补充 PIU 历史数据回放的模块职责）
- ADR：无（复用现有 `PiuRenderer`/`PiuContext`/zustand store 模式，无长期技术取舍）
- 导航：`openspec/designs/spec-to-design-map.md`（归档时新增 `agent-web-piu-historical-chat-replay` 导航）

## 风险与取舍（Risks / Trade-offs）

- [aboveMessagesSlot 修改共享组件 ChatPageCore] -> 可选 prop，local/immersive 不传时行为不变。回放存在时抑制 welcome/message-list 是最小侵入的替换方案；替代方案是在 PIU host 层重建一套独立的 RightPaneLayout，复杂度远高于一个可选 prop。
- [React.memo 依赖 ReplayEntry 引用稳定性] -> `ReplayEntry` 是 immutable readonly 对象，zustand store 中已有条目不会因新增条目而获得新引用。`memo` 默认浅比较对单个 prop 对象足够。
- [minimize -> restore 导致 PiuRenderer 重新 autoLoad + emit] -> 接受。与 `CustomPanelRenderer` 在面板状态变化时的行为一致。PIU 组件应能处理重复 emit。
- [回放条目数量无上限] -> 由外部 host 控制调用频率。`chatId` 去重防止同一回放重复渲染。面板关闭/会话切换时全部清除，不残留。
- [data 窄化在 view 层而非 handler 层或 PiuRenderer 层] -> handler 保持 `unknown` 以支持未来需要完整 `data` 的场景；view 层窄化保证 spread 安全；不修改共享组件。

## 迁移计划（Migration Plan）

无数据迁移。变更纯前端，发布后直接生效。未调用 `handleHistoricalChatReplay` 的集成方不受影响。`ChatPageCore` 的 `aboveMessagesSlot` 是可选 prop，不传时行为不变。

## 归档前更新基线（Baseline Promotion Plan）

- `openspec/specs/agent-web-piu-historical-chat-replay/spec.md`：归档时新增 PIU 历史数据回放行为契约。
- `openspec/designs/modules/agent-web.md`：归档时补充 PIU 历史数据回放（本地视图状态 + PiuRenderer 复用 + aboveMessagesSlot 替换对话视图）的模块职责。
- `openspec/designs/spec-to-design-map.md`：归档时新增 `agent-web-piu-historical-chat-replay` 导航。

## 待确认问题（Open Questions）

无。

## 长期基线刷新计划

本节将旧模板的"归档前更新基线"归一为可审计的归档门禁；以下均为**归档前待执行**，不表示 stable baseline 已刷新。

- **Function：**以 `FN-10.6 前端定制` 为唯一用户可见行为 owner；若本 change 增加的行为不能被该 Function 的既有边界完整表达，先在同一能力域新增一个单一职责 Function，再更新 `openspec/designs/functions/index.md`，不得把实现细节直接写入 Function。
- **Stable spec：**将 delta Requirement 合并至 `openspec/specs/agent-web-piu-historical-chat-replay/spec.md`，逐条核对 Requirement 标题、MUST/SHALL 语义、场景、迁移和 metadata；不得以 `--skip-specs` 绕过同名 Requirement 重叠。
- **长期设计：**先执行本 design/proposal 已列出的"归档前更新基线"设计 owner；再在 `openspec/designs/spec-to-design-map.md` 为上述 stable spec 写入该 Function、实际承载的 architecture/module/ADR 与验证入口。若现有 map 无该 spec 行，先创建该行，而非把 change-local design 当作长期设计。
- **归档判定：**Function、stable spec、长期设计和 map 四端均完成 diff 审阅且 `openspec validate --all --strict` 通过后，才允许归档；任一端无法唯一归属时保留 active 并标记阻塞。
