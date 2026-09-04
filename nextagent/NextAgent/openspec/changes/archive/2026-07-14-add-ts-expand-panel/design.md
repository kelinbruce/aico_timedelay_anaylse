# Design: Expand Panel

## 1. 问题概述

NextAgent 的对话面板固定 484px 宽度，无法有效展示 CLIP API 返回的大面积内容（Markdown 报告、PIU 可视化、DSL 图表等）。需要一个独立于对话面板的扩展面板，在三种主机模式下提供大面积展示空间。扩展面板有两个触发来源：CLIP `EXPAND_PANEL` 事件和 PIU 组件主动调用。

## 2. 数据模型

### 2.1 EXPAND_PANEL 事件结构

```
TOOL_STRUCTURED_DELTA {
  toolEventType: "EXPAND_PANEL",
  toolMessageType: "PIU" | "DSL" | "TEXT" | "FILE" | "ACTION" | "OPERATOR",
  content: string | JsonObject  // 按 messageType 不同，复用现有六种 content 结构
}
```

`EXPAND_PANEL` 的 `content` 结构与 `ANSWER` 类型完全一致，按 `toolMessageType` 使用相同的六种渲染组件。区别在于展示位置：`ANSWER` 进对话正文，`EXPAND_PANEL` 进扩展面板。

### 2.2 扩展面板状态

```typescript
interface ExpandPanelState {
  isOpen: boolean;
  content: {
    toolMessageType: ToolMessageType;
    content: unknown;
  } | null;
  sourceKey: string | null;  // "live-stream" 或 ProcessEntry.key
}
```

`sourceKey` 用于区分内容来源：
- `"live-stream"`：流式 EXPAND_PANEL 事件自动触发
- `ProcessEntry.key`：用户点击过程面板 TITLE 条目触发

场景 2（PIU 调用 `handleExpandPanelOpen`）调用 `expandPanelStore.open()` 但不设置 `content`（`content` 为 null）。PIU 自行往 `expandPanelId` div 渲染内容。

`ExpandPanelStore` MUST NOT 依赖 `AICOConfigStore`，保持独立。

### 2.3 ProcessEntry 扩展

```typescript
interface ProcessEntry {
  // ...existing fields
  expandPanelData?: {
    toolMessageType: ToolMessageType;
    content: unknown;
  } | undefined;
  hasExpandPanel?: boolean | undefined;
}
```

`expandPanelData` 在 `buildProcessTimelineEntries()` 中被设置，保存 EXPAND_PANEL 事件的 `toolMessageType` 和 `content`。`ProcessDisplayEntry` 同步新增这两个字段。

### 2.4 流式序列约束

```
TITLE → (DETAIL...) → [EXPAND_PANEL] → TITLE → (DETAIL...) → [EXPAND_PANEL] → ...
```

每两个 TITLE 之间最多一个 EXPAND_PANEL。后到的覆盖前面的（last-write-wins）。无 TITLE 的 EXPAND_PANEL 被忽略。

## 3. 三种模式下的布局

### 3.1 Local 模式

扩展面板固定在对话面板右侧，不受 `expandPanelPosition` 配置控制。嵌入 `ChatPage` 的 flex 容器：

```
ChatPage flex 容器
  ├─ <div chat-conversation-pane>  (flex: 0 0 484px, minWidth: 484px)
  │    └─ chatPane (RightPaneLayout + MessageList + Composer)
  │
  └─ <aside expand-panel>  (flex: 1 1 auto, 填充剩余)
```

### 3.2 Immersive 模式

扩展面板位置由 `AICOConfig.layoutConfig.expandPanelPosition` 控制：

- `RIGHT`（默认）：对话面板在左 484px，扩展面板在右填充剩余
- `LEFT`：扩展面板在左填充剩余，对话面板在右 484px

```
ChatPage flex 容器 (expandPanelPosition: RIGHT)
  ├─ <div chat-conversation-pane>  (flex: 0 0 484px, minWidth: 484px)
  └─ <aside expand-panel>  (flex: 1 1 auto)

ChatPage flex 容器 (expandPanelPosition: LEFT)
  ├─ <aside expand-panel>  (flex: 1 1 auto)
  └─ <div chat-conversation-pane>  (flex: 0 0 484px, minWidth: 484px)
```

### 3.3 对话面板 minWidth 切换

`chat-conversation-pane` 的 `minWidth` 根据右侧面板状态动态切换：

| 状态 | minWidth |
|---|---|
| 扩展面板打开 | 484px（固定宽度） |
| TurnRunGraphPanel 打开 | `GRAPH_CHAT_MIN_WIDTH` |
| 都未打开 | 0 |

同时 `flex` 也切换：扩展面板打开时为 `0 0 484px`（固定），否则为 `1 1 auto`（弹性）。

### 3.4 关闭扩展面板后恢复

扩展面板关闭后，对话面板恢复 `flex: 1 1 auto`。`minWidth` 恢复为 0（如果 graph 也未打开）或 `GRAPH_CHAT_MIN_WIDTH`（如果 graph 打开）。通过条件渲染自然实现——扩展面板不渲染时对话面板没兄弟元素竞争空间。

### 3.5 Collaborative 模式

扩展面板永远在左侧。`AIAgentPiuRuntime` 渲染两个区域：

```
AIAgentPiuRuntime <section>
  ├─ <div expand-panel>  (左侧，填充剩余)
  │    └─ 容器 div + 关闭按钮
  └─ <div piu-body>  (右侧，默认宽度)
       └─ ChatPageCore
```

打开扩展面板时：
1. 检查 PIU 面板当前 layout kind
2. 如果是 `floating` 或 `maximized`，先切换为 docked-right
3. 调用 `aiAgentPiuRuntimeStore.setDocked(defaultWidth)` 重置宽度
4. `defaultWidth` = `AICOConfig.modalSize.width` ?? `DOCKED_DEFAULT_WIDTH`
5. 扩展面板填充 PIU 面板左侧的剩余区域

关闭扩展面板后，PIU 面板宽度保持默认值，不恢复用户之前拖拽的宽度。

`expandPanelPosition` 配置在 collaborative 模式下被忽略。

### 3.6 扩展面板渲染结构

```tsx
<div className="expand-panel-root" style={{ position: "relative", height: "100%" }}>
  {/* 容器 div - 外部渲染目标 */}
  <div id={EXPAND_PANEL_DIV_ID} style={{ width: "100%", height: "100%" }}>
    {/* 场景1: 前端按 toolMessageType 渲染 */}
    {/* 场景2: PIU 自行渲染 */}
    {/* 历史导航: 前端按 entry.expandPanelData 渲染 */}
  </div>
  {/* 关闭按钮 - 独立 absolute 悬浮 */}
  <button
    onClick={handleClose}
    style={{ position: "absolute", top: 24, right: 24, zIndex: 9999 }}
  >
    <CloseOutlined />
  </button>
</div>
```

`EXPAND_PANEL_DIV_ID` 是固定写死的字符串常量。

### 3.7 底色

```css
/* 浅色 */
.expand-panel-root { background: #fff; }

/* 深色 */
[data-theme="dark"] .expand-panel-root,
[data-theme="evening"] .expand-panel-root { background: #393939; }
```

## 4. 容器内容清理机制

扩展面板容器 div 的内容由两种来源写入：
- **React 渲染**（场景 1 和历史导航）：`content` 非 null 时，React 按 `toolMessageType` 渲染组件
- **PIU 直接 DOM 操作**（场景 2）：`content` 为 null 时，PIU 通过 `piu.emit` 直接操作 DOM

当来源切换时，必须先清空容器 DOM 再渲染新内容。清理使用 `containerEl.replaceChildren()`。

### 4.1 清理触发时机

在 `ExpandPanel.tsx` 的 `useEffect` 中监听 `content` 和 `isOpen` 变化：

```
content 变化（非 null → 另一个非 null）：
  → replaceChildren() 清空
  → React 渲染新内容（React 会管理 DOM）

content 变化（非 null → null）：
  → 场景 2 接管，PIU 将自行渲染
  → replaceChildren() 清空 React 渲染的内容
  → 容器留空，等待 PIU 操作

isOpen 变化（true → false）：
  → replaceChildren() 清空所有内容
  → 面板卸载
```

### 4.2 实现方式

```typescript
const containerRef = useRef<HTMLDivElement | null>(null);
const prevContentRef = useRef<ExpandPanelState["content"]>(null);

useEffect(() => {
  const container = containerRef.current;
  if (!container) return;

  // 关闭面板时清空
  if (!isOpen) {
    container.replaceChildren();
    prevContentRef.current = null;
    return;
  }

  // content 变化时清空旧内容
  if (prevContentRef.current !== content) {
    container.replaceChildren();
    prevContentRef.current = content;
  }
}, [isOpen, content]);
```

React 渲染的内容由 React 自己管理（`replaceChildren()` 后 React 会重新渲染），PIU 的 DOM 内容由 `replaceChildren()` 清除。

## 5. 互斥规则

扩展面板与 `TurnRunGraphPanel` 通过 cross-clearing 实现互斥，不使用独立的 `rightPanelMode` 状态变量。

### 5.1 ChatPage 订阅 expandPanelStore

```typescript
// ChatPage.tsx
const isExpandPanelOpen = useExpandPanelStore((s) => s.isOpen);
```

### 5.2 打开扩展面板时关闭 Graph Panel

当 `expandPanelStore.isOpen` 变为 true 时，ChatPage 通过 effect 清空 `selectedDetailRootMessageId`：

```typescript
useEffect(() => {
  if (isExpandPanelOpen && selectedDetailRootMessageId !== null) {
    setSelectedDetailRootMessageId(null);
  }
}, [isExpandPanelOpen]);
```

### 5.3 打开 Graph Panel 时关闭扩展面板

`handleOpenFullProcess` 回调中调用 `expandPanelStore.close()`：

```typescript
const handleOpenFullProcess = useCallback((block: TurnBlock, opener: HTMLButtonElement) => {
  expandPanelStore.close();  // 新增
  stopGraphResize();
  graphOpenerRef.current = opener;
  setSelectedDetailRootMessageId(block.rootMessageId);
}, [stopGraphResize]);
```

### 5.4 条件渲染

```typescript
// 渲染扩展面板的条件
const shouldRenderExpandPanel = isExpandPanelOpen;

// 渲染 TurnRunGraphPanel 的条件（原有逻辑不变，但 isExpandPanelOpen 时不会渲染）
const shouldRenderGraphPanel = selectedDetailBlock && !isGraphDrawerMode && !isExpandPanelOpen;
```

### 5.5 PIU 关闭时的同步

PIU 调用 `handleExpandPanelClose()` 直接调 `expandPanelStore.close()`，`isOpen` 变为 false。ChatPage 通过订阅 `expandPanelStore.isOpen` 自动检测到变化，停止渲染扩展面板。不需要额外同步机制。

## 6. 数据流

### 6.1 场景 1：CLIP EXPAND_PANEL 事件

```
后端 tool-loop.ts
  │
  ├─ CLIP 返回 { eventType: "EXPAND_PANEL", messageType: "PIU", content: {...} }
  ├─ isClipStructuredEvent() 校验通过
  ├─ 发出 TOOL_STRUCTURED_DELTA { toolEventType: "EXPAND_PANEL", ... }
  │
  ▼
Stream → 前端 conversationStore.appendEnvelope
  │
  ├─ activeSessionEventLayer 更新
  │
  ├─ buildAnswerSegments()：EXPAND_PANEL ≠ ANSWER → 不进回答正文 ✓
  │
  ├─ buildProcessTimelineEntries()：
  │     EXPAND_PANEL → 挂到 lastStructuredTitleEntry.expandPanelData
  │     hasExpandPanel = true
  │
  ├─ useExpandPanelStreamWatcher hook 检测到新增 EXPAND_PANEL 事件
  │   → expandPanelStore.setContent({ toolMessageType, content, sourceKey: "live-stream" })
  │   → expandPanelStore.open()
  │
  ▼
ExpandPanel 渲染（content 非 null）
  ├─ TEXT     → MarkdownContent
  ├─ FILE     → FileCard
  ├─ PIU      → PiuMessage（在面板容器内）
  ├─ DSL      → DslRenderer
  ├─ ACTION   → ActionCard
  └─ OPERATOR → OperatorButtons
```

### 6.2 场景 2：PIU 调用 handleExpandPanelOpen

```
PiuMessage.tsx
  │
  ├─ piu.emit(method, {
  │     ...content,
  │     wrapperId,
  │     containerId: wrapperId,
  │     handleExpandPanelOpen: () => {
  │       expandPanelStore.open()  // 不设置 content
  │     },
  │     handleExpandPanelClose: () => {
  │       expandPanelStore.close()
  │     },
  │     expandPanelId: EXPAND_PANEL_DIV_ID
  │   })
  │
  ▼
PIU 组件内部决定何时调用 handleExpandPanelOpen()
  │
  ├─ 调用 → expandPanelStore.open()
  ├─ content 为 null → 容器 div 清空（replaceChildren）
  ├─ PIU 往 EXPAND_PANEL_DIV_ID div 渲染内容
  │
  ▼
用户点击关闭按钮或 PIU 调用 handleExpandPanelClose
  ├─ expandPanelStore.close()
  ├─ 容器 div replaceChildren() 清空
```

### 6.3 场景切换

```
场景 1 → 场景 2：
  流式 EXPAND_PANEL 正在展示（content 非 null）
  → PIU 调用 handleExpandPanelOpen()
  → expandPanelStore.open()（content 变为 null）
  → ExpandPanel useEffect 检测 content 变化
  → containerEl.replaceChildren() 清空 React 内容
  → PIU 往 div 渲染新内容

场景 2 → 场景 1：
  PIU 正在展示（content 为 null）
  → 流式 EXPAND_PANEL 事件到达
  → useExpandPanelStreamWatcher 调用 expandPanelStore.setContent({ ... })
  → content 变为非 null
  → ExpandPanel useEffect 检测 content 变化
  → containerEl.replaceChildren() 清空 PIU 的 DOM
  → React 按 toolMessageType 渲染新内容
```

### 6.4 历史导航（用户点击过程面板 TITLE）

```
过程面板
  ├─ TITLE 条目有 expandPanelData
  ├─ 鼠标悬停 → cursor: pointer + tooltip
  ├─ 用户点击
  │   → expandPanelStore.setContent({
  │       toolMessageType: entry.expandPanelData.toolMessageType,
  │       content: entry.expandPanelData.content,
  │       sourceKey: entry.key
  │     })
  │   → expandPanelStore.open()
  │
  ▼
ExpandPanel 按 toolMessageType 渲染（content 非 null）
```

## 7. 流式事件拦截

### 7.1 useExpandPanelStreamWatcher hook

新增 hook `frontend/agent-web/src/features/expand-panel/useExpandPanelStreamWatcher.ts`。

```typescript
function useExpandPanelStreamWatcher(
  activeSessionEventLayer: readonly StreamEnvelope[]
): void {
  const lastSequenceRef = useRef<number>(-1);

  useEffect(() => {
    for (const event of activeSessionEventLayer) {
      // 跳过已处理的事件
      if (event.sequence <= lastSequenceRef.current) continue;

      // 只处理 TOOL_STRUCTURED_DELTA + EXPAND_PANEL
      if (event.eventType !== "TOOL_STRUCTURED_DELTA") continue;
      const payload = event.payload as Record<string, unknown>;
      if (payload.toolEventType !== "EXPAND_PANEL") continue;

      // 历史重载事件不触发自动打开
      if (event.transportHints.includes("history-load")) {
        lastSequenceRef.current = event.sequence;
        continue;
      }

      // 流式事件触发面板打开
      expandPanelStore.setContent({
        toolMessageType: payload.toolMessageType as ToolMessageType,
        content: payload.content,
        sourceKey: "live-stream",
      });
      expandPanelStore.open();
      lastSequenceRef.current = event.sequence;
    }
  }, [activeSessionEventLayer]);
}
```

### 7.2 挂载位置

在 `ChatPage.tsx` 中调用：

```typescript
useExpandPanelStreamWatcher(activeSessionEventLayer);
```

`ChatPageCore`（collaborative 模式使用的组件）同样调用。

## 8. Turn/Session 切换时关闭扩展面板

在 `ChatPage.tsx` 中监听 `routeSessionId` 和当前 turn block 的 `rootMessageId` 变化：

```typescript
const prevSessionIdRef = useRef<string | null>(null);
const prevTurnRootIdRef = useRef<string | null>(null);

useEffect(() => {
  const currentTurnRootId = turnBlocks.length > 0
    ? turnBlocks[turnBlocks.length - 1]?.rootMessageId ?? null
    : null;

  if (
    prevSessionIdRef.current !== null &&
    prevSessionIdRef.current !== routeSessionId
  ) {
    expandPanelStore.close();
  }
  if (
    prevTurnRootIdRef.current !== null &&
    prevTurnRootIdRef.current !== currentTurnRootId
  ) {
    expandPanelStore.close();
  }

  prevSessionIdRef.current = routeSessionId;
  prevTurnRootIdRef.current = currentTurnRootId;
}, [routeSessionId, turnBlocks]);
```

## 9. PiuMessage 注入实现

```typescript
// PiuMessage.tsx
import { EXPAND_PANEL_DIV_ID, expandPanelStore } from "../../expand-panel/ExpandPanelStore.ts";

useEffect(() => {
  if (!isValidName || !piu || !window.Prel) return;
  void window.Prel.autoLoad(piuName, piuVersion).then(() => {
    piu.emit(content.method ?? "", {
      ...content,
      wrapperId,
      containerId: wrapperId,
      handleExpandPanelOpen: () => {
        expandPanelStore.open();
      },
      handleExpandPanelClose: () => {
        expandPanelStore.close();
      },
      expandPanelId: EXPAND_PANEL_DIV_ID,
    });
  });
}, [content, piu, isValidName, piuName, piuVersion, wrapperId]);
```

`EXPAND_PANEL_DIV_ID` 是固定常量字符串，定义在 `ExpandPanelStore.ts` 中。

## 10. 后端变更

### 10.1 ToolEventType 枚举

`packages/agent-common` 中 `ToolEventType` 新增 `"EXPAND_PANEL"`：

```typescript
type ToolEventType =
  = "TITLE"
  | "DETAIL"
  | "ANSWER"
  | "SUB_TITLE"
  | "SUB_DETAIL"
  | "SUB_CONCLUSION"
  | "EXPAND_PANEL";  // 新增
```

### 10.2 isClipStructuredEvent 校验

`tool-loop.ts` 中 `isClipStructuredEvent()` 的 `eventType` 合法值列表新增 `"EXPAND_PANEL"`。

### 10.3 不新增存储

`EXPAND_PANEL` 事件不产生独立存储。与现有 `TOOL_STRUCTURED_DELTA` 一致，完整 `structuredPayload` 由 `appendCapabilityResultMessage` 全量存储。历史重建时 conversation adapter 检测 payload shape 并重建为 `TOOL_STRUCTURED_DELTA` envelope，`toolEventType` 为 `EXPAND_PANEL` 的事件同样被重建。

## 11. 前端变更清单

| 文件 | 变更 |
|---|---|
| `features/expand-panel/ExpandPanelStore.ts` | 新增：状态管理 store + `EXPAND_PANEL_DIV_ID` 常量 |
| `features/expand-panel/ExpandPanel.tsx` | 新增：渲染组件 + 容器清理逻辑 |
| `features/expand-panel/ExpandPanel.css` | 新增：底色样式 |
| `features/expand-panel/useExpandPanelStreamWatcher.ts` | 新增：流式事件拦截 hook |
| `features/chat/process/processDetails.ts` | 修改：EXPAND_PANEL 分支、ProcessEntry 扩展 |
| `features/chat/components/ProcessPanel.tsx` | 修改：TITLE 条目交互 |
| `features/chat/components/structured/PiuMessage.tsx` | 修改：payload 注入 |
| `pages/ChatPage.tsx` | 修改：订阅 store、互斥 effect、minWidth 切换、turn/session 切换关闭、stream watcher hook |
| `piu/AIAgentPiuRuntime.tsx` | 修改：新增扩展面板区域、PIU 面板状态重置 |

## 12. 质量属性审视

### 安全
- `EXPAND_PANEL` 的 content 复用现有 `messageType` 安全校验，不引入新攻击面。
- `handleExpandPanelOpen` / `handleExpandPanelClose` 是前端闭包函数，不序列化、不传输到后端。
- `expandPanelId` 是固定字符串常量，不含敏感信息。
- PIU 组件往 div 渲染的内容由宿主框架控制，与现有 PiuMessage 安全边界一致。

### 性能/容量
- 扩展面板是纯前端 UI 组件，不涉及后端查询或存储。
- 流式刷新采用 last-write-wins，不累积历史数据，内存占用恒定。
- 过程面板 `expandPanelData` 只存储最近一个 EXPAND_PANEL 的数据，不增长。
- `useExpandPanelStreamWatcher` 只扫描新增事件（通过 `lastSequenceRef` 跳过已处理），不重复遍历全部历史。

### 可靠性/恢复
- 扩展面板状态是前端 ephemeral state，会话切换或页面刷新后不恢复。
- 历史重载不自动打开扩展面板，用户需手动点击过程面板 TITLE 条目查看。
- 扩展面板打开失败不影响对话面板正常工作。
- turn/session 切换时自动关闭扩展面板，避免展示过期内容。

### 可维护性
- 扩展面板状态独立 store，不与 `AICOConfigStore` 或 `aiAgentPiuRuntimeStore` 耦合。
- 三种模式的扩展面板渲染共用同一 `ExpandPanel` 组件，模式差异由父容器处理。
- `EXPAND_PANEL` 复用现有六种 `messageType` 渲染组件，不新增渲染逻辑。
- 互斥通过 cross-clearing 实现，不引入新的状态变量。

### 可测试性
- `ExpandPanelStore` 是纯状态管理，可独立测试。
- `useExpandPanelStreamWatcher` 可通过构造事件序列测试。
- `buildProcessTimelineEntries()` 的 EXPAND_PANEL 分支可通过构造事件序列测试。
- `PiuMessage` 的 payload 注入可通过 mock PiuContext 测试。
- 互斥规则可通过渲染 `ChatPage` 并交替触发测试。
- 容器清理可通过检查 `containerEl.children.length` 测试。

### 审计/可追溯性
- `EXPAND_PANEL` 事件通过 `TOOL_STRUCTURED_DELTA` timeline event 传输，与现有审计链一致。
- 不新增审计需求。

## 13. 不在本次范围

- 扩展面板内多个 EXPAND_PANEL 内容的 tab/历史导航（当前只支持 last-write-wins 和过程面板点击导航）。
- 扩展面板的拖拽缩放（当前固定填充剩余区域）。
- 窄屏降级（窗口宽度不足时切换为 Drawer 或全屏模式）。
- 过程面板 SUB_TITLE 条目挂载 expandPanelData（当前只支持 TITLE 级别）。
- CLIP CLI 流式 stdout 对 EXPAND_PANEL 的支持。
