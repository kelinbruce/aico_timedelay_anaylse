## 1. 需求 A：PIU handleHistoricalChatReplay attach handler

- [x] 1.1 在 `registerAIAgentPIU.tsx` 的 `createHandlers` 返回类型新增 `handleHistoricalChatReplay?: (payload: unknown) => void`，并在返回对象中实现该方法；不修改 `prel.ts`。
  验证：`frontend/agent-web/tests/piu-runtime-contract.test.tsx` 断言 handler 注册存在；immersive.tsx 和 local.tsx 不注册 handleHistoricalChatReplay；prel.ts 无修改（git diff 检查）。
  来源：Requirement "handleHistoricalChatReplay capability is scoped to collaborative PIU only"、Requirement "PIU exposes handleHistoricalChatReplay handler through attach"、Design "handler 注册与 payload 校验"。

- [x] 1.2 实现 payload 校验和 data spread 守卫：`piuName`、`piuVersion`、`method`、`chatId` 必须为非空字符串（trim 后长度 > 0），否则 `console.warn` 并返回；`data` 是纯对象（`typeof data === 'object' && data !== null && !Array.isArray(data)`）时保留，其他类型置为 `undefined`。
  验证：`piu-runtime-contract.test.tsx` 覆盖：缺 piuName warn 返回；缺 piuVersion warn 返回；缺 method warn 返回；缺 chatId warn 返回；data 为 string 时置为 undefined；data 为 number 时置为 undefined；data 为 array 时置为 undefined；data 为 null 时置为 undefined；data 为 undefined 时不报错；data 为纯对象时保留。
  来源：Requirement "handleHistoricalChatReplay payload validation"、Requirement "handleHistoricalChatReplay data spread guard"、Design "handler 注册与 payload 校验"。

- [x] 1.3 实现面板打开逻辑：handler 执行时调用 `aiAgentPiuRuntimeStore.openPanel()` 后紧跟 `aiAgentPiuRuntimeStore.restoreFromMinimized()`，确保面板从关闭或最小化状态都恢复到可见。
  验证：`piu-runtime-contract.test.tsx` 断言：面板关闭时调用 handler 后 showPanel 为 true；面板最小化时调用 handler 后 minimized 为 false。
  来源：Requirement "handleHistoricalChatReplay opens panel before replay"、Design "handler 注册与 payload 校验"。

## 2. 需求 B：本地视图状态 store

- [x] 2.1 新建 `frontend/agent-web/src/piu/historicalChatReplayStore.ts`：使用 zustand，持有 `entries: Map<string, ReplayEntry>` 和 `entryOrder: string[]`；提供 `startReplay(entry)`（相同 chatId no-op，不同 chatId 追加到 entries 和 entryOrder）和 `clearAllReplays()`（清空 entries 和 entryOrder）方法；导出 `ReplayEntry` 类型。
  验证：`frontend/agent-web/tests/historicalChatReplayStore.test.ts` 断言：首次 startReplay 后 entries size 为 1；相同 chatId 再次 startReplay 后 entries size 不变；不同 chatId startReplay 后 entries size 增长且 entryOrder 顺序正确；clearAllReplays 后 entries 和 entryOrder 均为空。
  来源：Requirement "Historical chat replay store deduplication by chatId"、Requirement "Historical chat replay store clear"、Design "本地视图状态 store"。

## 3. 需求 C：渲染与清除

- [x] 3.1 在 `aiAgentPiuRuntimeStore` 的 `closePanel`、`openSession`、`openNewSession` 方法中调用 `historicalChatReplayStore.getState().clearAllReplays()`；minimize 不调用 clearAllReplays。
  验证：`piu-runtime-contract.test.tsx` 断言：closePanel 后 historicalChatReplayStore entries 为空；openSession 后 entries 为空；openNewSession 后 entries 为空；minimize 后 entries 仍有条目。
  来源：Requirement "Historical chat replay cleared on panel close"、Requirement "Historical chat replay cleared on session switch"、Requirement "Historical chat replay not cleared on minimize"、Design "清除触发"。

- [x] 3.2 在 `ChatPage.tsx` 的 `ChatPageCore` 新增可选 `aboveMessagesSlot?: React.ReactNode` prop，在 `mainContent` 的 `MessageList` div 之前渲染该 slot；不传时行为完全不变。
  验证：`ChatPageCore` 不传 aboveMessagesSlot 时既有测试全部通过；传入 aboveMessagesSlot 时 slot 内容渲染在 MessageList 之前。
  来源：Requirement "aboveMessagesSlot renders above MessageList"、Requirement "aboveMessagesSlot backward compatible"、Design "回放区域渲染：aboveMessagesSlot"。

- [x] 3.3 新建 `frontend/agent-web/src/piu/HistoricalChatReplayView.tsx`：从 `historicalChatReplayStore` 读取 `entries` 和 `entryOrder`，按 `entryOrder` 顺序 map 每个 `ReplayEntry` 到 `PiuRenderer`（`piuInfo` 的 `renderFunc` 取 `entry.method`，`data` 取 `entry.data`），以 `chatId` 为 React key；外层容器 `data-testid="historical-chat-replay-view"`。
  验证：`frontend/agent-web/tests/HistoricalChatReplayView.test.tsx` 断言：store 有 2 个 entry 时渲染 2 个 PiuRenderer；PiuRenderer 的 piuInfo 正确映射（piuName/piuVersion/renderFunc=method/data）；chatId 作为 React key。
  来源：Requirement "HistoricalChatReplayView renders PiuRenderer per entry"、Design "HistoricalChatReplayView 组件"。

- [x] 3.4 在 `AIAgentPiuRuntime.tsx` 的 `PiuContent` 中读取 `historicalChatReplayStore` 的 entries，有回放条目时（entries.size > 0）构造 `<HistoricalChatReplayView>` 并传入 `ChatPageCore` 的 `aboveMessagesSlot`；无回放条目时不传 aboveMessagesSlot。
  验证：`HistoricalChatReplayView.test.tsx` 或集成测试断言：有回放条目时 aboveMessagesSlot 非空且 HistoricalChatReplayView 被渲染；无回放条目时 aboveMessagesSlot 为 undefined。
  来源：Requirement "aboveMessagesSlot renders above MessageList"、Design "回放区域渲染：aboveMessagesSlot"。

## 4. 验证与收尾

- [x] 4.1 运行需求 A、B、C 相关的 Vitest 全部通过。
  验证：`frontend/agent-web` 下 `piu-runtime-contract.test.tsx`、`historicalChatReplayStore.test.ts`、`HistoricalChatReplayView.test.tsx` 及相关测试通过。
  来源：Design "验证映射"。

- [x] 4.2 运行前端 build 和 strict validation。
  验证：`npm run build` 通过；`npm run build:vite:modes` 通过（涉及多宿主入口）；`openspec validate add-piu-historical-chat-replay --strict` 通过。
  来源：AGENTS.md 验证门禁。

- [x] 4.3 Negative verification：确认 `prel.ts` 未被修改（git diff 检查）；确认回放条目不进入 `conversationStore`/`MessageList`/`TurnBlock`（代码审查）；确认 local 和 immersive 入口的 `ChatPageCore` 调用不传 `aboveMessagesSlot`（代码审查）。
  验证：git diff 确认 prel.ts 无修改；代码审查确认回放条目不进入 canonical stream；代码审查确认 aboveMessagesSlot 仅在 PIU host 传入。
  来源：Design "非目标"、Requirement "handleHistoricalChatReplay capability is scoped to collaborative PIU only"。

## 归档前更新基线（待实施后）

归档前执行 proposal 和 design 的"归档前更新基线"计划：

- 新增 `openspec/specs/agent-web-piu-historical-chat-replay/spec.md`：同步全部 ADDED requirement。
- 更新 `openspec/designs/modules/agent-web.md`：补充 PIU 历史数据回放（本地视图状态 + PiuRenderer 复用 + aboveMessagesSlot）的模块职责。
- 更新 `openspec/designs/spec-to-design-map.md`：新增 `agent-web-piu-historical-chat-replay` 导航。
- 检查长期文档没有重复描述同一渲染能力或重复数据结构。
