## 背景与问题（Why）

NextAgent 的 CLIP Server 结构化工具数据通道（`TOOL_STRUCTURED_DELTA`）当前支持六种 `toolEventType`：`TITLE`、`DETAIL`、`ANSWER`、`SUB_TITLE`、`SUB_DETAIL`、`SUB_CONCLUSION`。这些数据全部渲染在 484px 对话面板内部——回答正文区域或过程面板。但电信网络智能体的部分 CLIP API 结果需要更大的展示空间，例如生成的 Markdown 报告、PIU 可视化组件、DSL 图表等，484px 宽度不足以有效呈现这些内容。

类似豆包等产品的扩展面板模式，需要一个独立于对话面板的大区域来承载这类内容。该面板与对话面板并排展示，对话面板收缩为固定宽度，扩展面板填充剩余区域。

同时，内联 PIU 组件（`PiuMessage`）在某些场景下需要主动打开/关闭一个独立面板来展示详情。当前 `PiuMessage` 的 `piu.emit` payload 只包含 `wrapperId` 和 `containerId`，PIU 组件无法触发独立面板的展开。

## 变更范围（What Changes）

- 新增 `EXPAND_PANEL` 到 `ToolEventType` 枚举（`tool-structured-delta` spec 修改），使 CLIP API 可通过 `{ eventType: "EXPAND_PANEL", messageType, content }` 触发扩展面板。
- 在前端 `processDetails.ts` 的 `buildProcessTimelineEntries()` 新增 `EXPAND_PANEL` 处理分支：将 EXPAND_PANEL 数据挂到最近的 TITLE 条目上（`expandPanelData` 字段），不创建独立过程条目。约束：每两个 TITLE 之间最多一个 EXPAND_PANEL；无 TITLE 的 EXPAND_PANEL 不处理。
- 在前端 `ProcessEntry` / `ProcessDisplayEntry` 新增 `expandPanelData` 和 `hasExpandPanel` 字段，使过程面板中有扩展面板数据的 TITLE 条目可交互（cursor pointer + tooltip）。
- 在前端 `PiuMessage.tsx` 的 `piu.emit` payload 注入 `handleExpandPanelOpen`、`handleExpandPanelClose` 方法和固定的 `expandPanelId`，使 PIU 组件可主动控制扩展面板。
- 新增 `agent-web-expand-panel` capability：定义扩展面板的布局规则（三种模式下的位置和宽度）、状态管理、渲染容器、容器内容清理机制、关闭按钮、与 TurnRunGraphPanel 的互斥规则、流式自动刷新、turn/session 切换关闭和历史导航。
- 在 `ChatPage.tsx` 中订阅 `expandPanelStore.isOpen`，通过 cross-clearing 实现与 TurnRunGraphPanel 的互斥；新增 `minWidth` 动态切换；新增 `useExpandPanelStreamWatcher` hook 拦截流式 EXPAND_PANEL 事件；turn/session 切换时自动关闭扩展面板。
- 在 `AIAgentPiuRuntime.tsx` 中新增扩展面板区域（collaborative 模式），打开时 PIU 面板强制切换为 docked-right 并重置宽度；关闭后保持默认宽度不恢复。
- 扩展面板底色：浅色 `#fff`，深色 `#393939`。
- 关闭按钮：独立 absolute 元素悬浮在面板之上，位于右上角 24px 边距。
- `expandPanelPosition` 只在 immersive 模式下生效；local 模式下扩展面板固定在右侧；collaborative 模式下扩展面板永远在左侧。
- **BREAKING**：无。`EXPAND_PANEL` 是新增 `toolEventType`，不影响现有六种类型的行为。扩展面板是新增 UI 能力，不触发时对话面板行为不变。

## Capability 影响（Capabilities）

### 新增 Capability
- `agent-web-expand-panel`: 定义扩展面板的布局规则、状态管理、渲染容器、容器内容清理、关闭按钮、互斥规则、流式刷新、turn/session 切换关闭和历史导航行为。

### 修改的 Capability
- `tool-structured-delta`: `ToolEventType` 枚举新增 `EXPAND_PANEL`。
- `agent-web-structured-message-rendering`: `PiuMessage` 的 `piu.emit` payload 新增扩展面板控制方法和 `expandPanelId`。
- `agent-web-process-panel`: `ProcessEntry` / `ProcessDisplayEntry` 新增 `expandPanelData` 和 `hasExpandPanel` 字段，过程面板 TITLE 条目可交互。

## 影响范围（Impact）

- `packages/agent-common`：`ToolEventType` 新增 `"EXPAND_PANEL"`。
- `packages/agent-core/src/tools/tool-loop.ts`：`isClipStructuredEvent()` 校验允许 `EXPAND_PANEL`。
- `frontend/agent-web/src/features/chat/process/processDetails.ts`：`buildProcessTimelineEntries()` 新增 `EXPAND_PANEL` 分支；`ProcessEntry` / `ProcessDisplayEntry` 新增 `expandPanelData` 和 `hasExpandPanel`。
- `frontend/agent-web/src/features/chat/components/structured/PiuMessage.tsx`：`piu.emit` payload 注入 `handleExpandPanelOpen`、`handleExpandPanelClose`、`expandPanelId`。
- `frontend/agent-web/src/features/chat/components/ProcessPanel.tsx`：有 `expandPanelData` 的 TITLE 条目可交互（cursor pointer + tooltip），点击触发扩展面板。
- `frontend/agent-web/src/pages/ChatPage.tsx`：订阅 `expandPanelStore.isOpen`、cross-clearing 互斥 effect、`minWidth` 动态切换、turn/session 切换关闭、调用 `useExpandPanelStreamWatcher`。
- `frontend/agent-web/src/piu/AIAgentPiuRuntime.tsx`：新增扩展面板区域，打开时 PIU 面板强制 docked-right 并重置宽度，关闭后保持默认宽度。
- `frontend/agent-web/src/aico-config/types.ts`：`ExpandPanelPosition` 已存在（`LEFT` | `RIGHT`），无需修改。
- `frontend/agent-web/src/piu/layout.ts`：`DOCKED_DEFAULT_WIDTH` 已存在（484），扩展面板打开时复用。
- 新增 `frontend/agent-web/src/features/expand-panel/` 目录：`ExpandPanelStore.ts`（状态管理 + `EXPAND_PANEL_DIV_ID` 常量）、`ExpandPanel.tsx`（渲染组件 + 容器清理）、`ExpandPanel.css`（底色样式）、`useExpandPanelStreamWatcher.ts`（流式事件拦截 hook）。
- 安全：`EXPAND_PANEL` 的 content 复用现有 `messageType` 安全校验；`handleExpandPanelOpen` / `handleExpandPanelClose` 是前端方法，不传输到后端；`expandPanelId` 是固定字符串，不含敏感信息。
- 测试：contract 测试（`ToolEventType` 新增值、CLIP 校验）、前端组件测试（扩展面板布局、互斥、容器清理、流式刷新、历史导航、PIU 注入、过程面板交互、turn/session 切换关闭、local 忽略 expandPanelPosition）。

## 归档前更新基线（Baseline Promotion Plan）

行为契约：
- `openspec/specs/agent-web-expand-panel/spec.md`：新增——扩展面板布局规则、状态管理、渲染容器、容器内容清理、关闭按钮、互斥规则、流式刷新、turn/session 切换关闭、历史导航。
- `openspec/changes/add-ts-tool-structured-delta/specs/tool-structured-delta/spec.md`：修改——`ToolEventType` 新增 `EXPAND_PANEL`。
- `openspec/changes/add-ts-tool-structured-delta/specs/agent-web-structured-message-rendering/spec.md`：修改——`PiuMessage` payload 注入扩展面板控制方法。

设计视图：
- `openspec/designs/architecture/expand-panel.md`：新增——跨模式布局、状态管理、互斥规则、容器清理、数据流、流式拦截。
- `openspec/designs/modules/agent-web.md`：补充扩展面板模块职责。
- `openspec/designs/adr/expand-panel-mutex-with-graph.md`：新增——扩展面板与 TurnRunGraphPanel 通过 cross-clearing 实现互斥的设计决策。
- `openspec/designs/spec-to-design-map.md`：补充新 spec 到 design 的导航。

验证入口：
- `openspec validate --all --strict`
- `npm run build`
- `npm test`
- `npm run test:contract`
- `npm run lint:architecture`
