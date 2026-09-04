## 背景与问题（Why）

协作式 PIU（`registerAIAgentPIU` 入口）通过 `piu.attach()` 注册 handler 供集成方调用，已有 `loadAIAgent`、`displayAIAgent`、`minimizeAIAgent`、`switchLocale`、`switchTheme`、`sendQuestionToLui`、`renderKnowledge`。这些 handler 只在 `createHandlers` 返回类型声明，不修改 `prel.ts` 的 `PIU.attach` 类型。

集成场景需要一个新的 attach handler `handleHistoricalChatReplay`，用于做历史数据回放。外部 host 通过 `piu.emit('handleHistoricalChatReplay', payload)` 触发回放，回放内容渲染为一个 PIU（通过 `Prel.autoLoad` + `piu.emit` 加载外部 PIU 组件），显示在对话面板中。

回放数据完全独立于会话的 canonical stream/history——它只有答案 PIU 渲染，不参与请求生命周期、session persistence、request lifecycle、Agent Scope 或 Owner Scope。回放内容与当前会话对话共存于同一面板：回放区域在消息列表上方纵向堆叠，用户可在回放期间正常提问，新对话在回放下方流入当前会话。

## 变更范围（What Changes）

### 新增 PIU attach handler `handleHistoricalChatReplay`

- 仅在 `registerAIAgentPIU`（协作式入口）的 `createHandlers` 注册。沉浸式入口（`immersive.tsx`）和本地入口（`local.tsx`）不注册此 handler。
- 接收 payload `{ piuName: string, piuVersion: string, method: string, chatId: string, data: unknown }`，其中 `method` 是 `piu.emit` 的 emit 键。
- handler 执行流程：
  1. 校验 `piuName`、`piuVersion`、`method`、`chatId` 为非空字符串，否则 warn 并返回。
  2. 对 `data` 做 spread 守卫：纯对象（非数组）保留，其他类型（null、string、number、array）置为 `undefined`。
  3. 如果面板未打开或处于最小化状态，打开会话面板（`openPanel` + `restoreFromMinimized`）。
  4. 以 `chatId` 为唯一标识去重：相同 `chatId` 不重复渲染；不同 `chatId` 追加到回放集合。
  5. 将回放条目存入本地视图状态 store，由对话面板视图读取并渲染。
- 不修改 `prel.ts` 的 `PIU.attach` 类型，与 `renderKnowledge`/`loadAIAgent` 等协作式自定义 handler 同形。

### 新增本地视图状态 store `historicalChatReplayStore`

- 使用 zustand，与 `expandPanelStore`/`aicoConfigStore` 同形，是纯前端本地视图状态。
- 持有 `entries: Map<chatId, ReplayEntry>`，支持 `startReplay(entry)`（去重追加）、`clearAllReplays()`（清空）。
- 不持久化，不进入 Web API、SSE、WebSocket、timeline、SafeError、audit、metric、trace。
- 不参与 share/report/fork/annotation/retry/edit 等对话操作——回放条目不携带 `runId`/`requestId`，不进入 `MessageList`/`TurnBlock`，无法被勾选或操作。

### 回放区域渲染

- 在 `ChatPageCore` 新增可选 `aboveMessagesSlot` prop，渲染在消息列表上方、同一滚动容器内，实现整体滚动。
- local 和 immersive 入口不传此 prop，行为完全不变。
- PIU host 在 `AIAgentPiuRuntime` 中读取 `historicalChatReplayStore` 的 entries，有回放条目时传入 `aboveMessagesSlot`。
- 回放区域渲染 `HistoricalChatReplayView` 组件：按追加顺序纵向堆叠多个 `PiuRenderer`，每条通过 `PiuRenderer` 加载外部 PIU（`piuName`/`piuVersion`/`renderFunc=method`/`data`），复用 `PiuContext` 获取 `piu` 和 `site`。
- 回放区域不渲染 process panel、thinking chain、bubble actions 等附属内容。

### 清除触发

- `aiAgentPiuRuntimeStore.closePanel()` → `clearAllReplays()`
- `aiAgentPiuRuntimeStore.openSession(sessionId)` → `clearAllReplays()`
- `aiAgentPiuRuntimeStore.openNewSession()` → `clearAllReplays()`
- minimize 不清除（与既有 `expandPanelStore` 在 minimize 时的处理模式一致）。

## Capability 影响（Capabilities）

### 新增 Capability
- `agent-web-piu-historical-chat-replay`: 协作式 PIU 通过 attach handler `handleHistoricalChatReplay` 回放历史数据并渲染为 PIU 的行为契约。

### 修改的 Capability
- 无。回放区域通过可选 `aboveMessagesSlot` prop 扩展 `ChatPageCore`，是向后兼容的扩展，不改变既有消息列表渲染行为。

## 影响范围（Impact）

- `frontend/agent-web/src/piu/registerAIAgentPIU.tsx`: `createHandlers` 返回类型新增 `handleHistoricalChatReplay`，新增 handler 实现和 payload 校验逻辑。
- `frontend/agent-web/src/piu/historicalChatReplayStore.ts`（新建）: 本地视图状态 store，管理回放条目集合。
- `frontend/agent-web/src/piu/HistoricalChatReplayView.tsx`（新建）: 回放区域组件，渲染多个 `PiuRenderer`。
- `frontend/agent-web/src/piu/AIAgentPiuRuntime.tsx`: `PiuContent` 中读取 `historicalChatReplayStore`，有回放条目时向 `ChatPageCore` 传入 `aboveMessagesSlot`；`closePanel`/`openSession`/`openNewSession` 触发 `clearAllReplays`。
- `frontend/agent-web/src/pages/ChatPage.tsx`: `ChatPageCore` 新增可选 `aboveMessagesSlot` prop，渲染在 `MessageList` 之前。
- 不修改 `prel.ts`、`conversationStore`、`sessionStore`、`requestStore`、后端任何 package。

## 归档前更新基线（Baseline Promotion Plan）

行为契约：
- `openspec/specs/agent-web-piu-historical-chat-replay/spec.md`: 新增 PIU 历史数据回放行为契约。

长期设计：
- `openspec/designs/modules/agent-web.md`: 归档时补充 PIU 历史数据回放（本地视图状态 + PiuRenderer 复用）的模块职责。
- `openspec/designs/spec-to-design-map.md`: 归档时新增 `agent-web-piu-historical-chat-replay` 导航。

验证入口：
- `frontend/agent-web` 下 Vitest：`piu-runtime-contract.test.tsx`（handler 注册与 payload 校验）、`historicalChatReplayStore.test.ts`（store 去重与清除）、`HistoricalChatReplayView.test.tsx`（渲染与共存）。
- `frontend/agent-web` 下 `npm run build` 和 `npm run build:vite:modes`。
- `openspec validate add-piu-historical-chat-replay --strict`。
