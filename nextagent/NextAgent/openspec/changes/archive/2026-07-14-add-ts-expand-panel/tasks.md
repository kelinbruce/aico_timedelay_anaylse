# Tasks: add-ts-expand-panel

## 1. Backend: ToolEventType 枚举扩展

- [x] 1.1 在 `packages/agent-common` 中将 `"EXPAND_PANEL"` 加入 `ToolEventType` 联合类型
  - 来源：proposal §变更范围、spec tool-structured-delta MODIFIED Requirement
  - 验证：`npm run build` 通过，`ToolEventType` 类型包含 `"EXPAND_PANEL"`

- [x] 1.2 在 `packages/agent-core/src/tools/tool-loop.ts` 的 `isClipStructuredEvent()` 校验中允许 `"EXPAND_PANEL"` 作为合法 `eventType`
  - 来源：spec tool-structured-delta MODIFIED Requirement: Structured Event Shape Validation
  - 验证：单元测试覆盖 `eventType: "EXPAND_PANEL"` + 合法 `messageType` 通过校验并发出 `TOOL_STRUCTURED_DELTA`；非法 `eventType` 仍被拒绝

## 2. Frontend: 扩展面板状态管理

- [x] 2.1 新增 `frontend/agent-web/src/features/expand-panel/ExpandPanelStore.ts`
  - 定义 `ExpandPanelState` 接口（`isOpen`、`content`、`sourceKey`）
  - 定义 `EXPAND_PANEL_DIV_ID` 固定常量
  - 实现 `open()`、`close()`、`setContent()` 方法
  - `open()` 只设置 `isOpen: true`，不修改 `content`
  - `close()` 清空 `content` 和 `sourceKey`，设置 `isOpen: false`
  - `setContent()` 采用 last-write-wins
  - store MUST NOT 依赖 `AICOConfigStore`
  - 来源：spec agent-web-expand-panel Requirement: 扩展面板状态管理
  - 验证：单元测试覆盖 open 不修改 content、close 清空状态、setContent last-write-wins

## 3. Frontend: 扩展面板渲染组件

- [x] 3.1 新增 `frontend/agent-web/src/features/expand-panel/ExpandPanel.tsx`
  - 渲染根元素 `position: relative`，容器 div 使用 `EXPAND_PANEL_DIV_ID`
  - 关闭按钮 `position: absolute; top: 24px; right: 24px`，z-index 高于容器
  - 关闭按钮点击调用 `expandPanelStore.close()`
  - 容器内容按 `content.toolMessageType` 分发到渲染组件（TEXT→MarkdownContent、FILE→FileCard、PIU→PiuMessage、DSL→DslRenderer、ACTION→ActionCard、OPERATOR→OperatorButtons）
  - `content` 为 null 时容器留空
  - 来源：spec agent-web-expand-panel Requirement: 扩展面板渲染容器
  - 验证：组件测试覆盖容器结构、关闭按钮位置和 z-index、各 messageType 渲染分发、content 为 null 时容器为空

- [x] 3.2 实现 `ExpandPanel.tsx` 的容器内容清理机制
  - 在 `useEffect` 中监听 `content` 和 `isOpen` 变化
  - `content` 从非 null 变为另一个非 null 时：`containerEl.replaceChildren()` 清空旧内容
  - `content` 从非 null 变为 null 时：`containerEl.replaceChildren()` 清空 React 内容
  - `isOpen` 从 true 变为 false 时：`containerEl.replaceChildren()` 清空所有内容
  - 使用 `prevContentRef` 跟踪上一次 content 值
  - 来源：spec agent-web-expand-panel Requirement: 扩展面板容器内容清理
  - 验证：组件测试覆盖三种清理触发时机、清理后 `containerEl.children.length` 为 0

- [x] 3.3 新增 `frontend/agent-web/src/features/expand-panel/ExpandPanel.css`
  - 浅色主题底色 `#fff`
  - 深色主题（`data-theme="dark"` 或 `data-theme="evening"`）底色 `#393939`
  - 来源：spec agent-web-expand-panel Requirement: 扩展面板底色
  - 验证：渲染测试覆盖浅色和深色主题底色

## 4. Frontend: 流式事件拦截

- [x] 4.1 新增 `frontend/agent-web/src/features/expand-panel/useExpandPanelStreamWatcher.ts`
  - 接收 `activeSessionEventLayer` 参数
  - 使用 `lastSequenceRef` 跟踪已处理的 sequence，跳过已处理事件
  - 检测 `eventType === "TOOL_STRUCTURED_DELTA"` 且 `payload.toolEventType === "EXPAND_PANEL"` 的事件
  - 非历史重载事件：调用 `expandPanelStore.setContent()` 和 `expandPanelStore.open()`
  - 历史重载事件（`transportHints` 包含 `"history-load"`）：不触发 `open()`，只更新 `lastSequenceRef`
  - 来源：spec agent-web-expand-panel Requirement: 流式 EXPAND_PANEL 事件拦截
  - 验证：单元测试覆盖流式事件触发、历史重载不触发、sequence 去重

## 5. Frontend: 过程面板 EXPAND_PANEL 处理

- [x] 5.1 在 `processDetails.ts` 的 `ProcessEntry` 和 `ProcessDisplayEntry` 接口新增 `expandPanelData?: { toolMessageType: ToolMessageType; content: unknown }` 和 `hasExpandPanel?: boolean`
  - 来源：spec agent-web-process-panel MODIFIED Requirement、spec agent-web-expand-panel Requirement: EXPAND_PANEL 事件挂在最近 TITLE 条目上
  - 验证：`npm run build` 类型检查通过

- [x] 5.2 在 `buildProcessTimelineEntries()` 的 `TOOL_STRUCTURED_DELTA` case 中新增 `EXPAND_PANEL` 分支
  - `toolEventType === "EXPAND_PANEL"` 时：如果 `lastStructuredTitleEntry` 不为 null，设置其 `expandPanelData` 和 `hasExpandPanel = true`；如果为 null 则忽略
  - 不创建独立过程条目
  - 多个 EXPAND_PANEL 在同一 TITLE 范围内时后到覆盖（last-write-wins）
  - 来源：spec agent-web-process-panel MODIFIED Requirement
  - 验证：单元测试覆盖：有 TITLE 时挂载、无 TITLE 时忽略、多个 EXPAND_PANEL 后到覆盖

- [x] 5.3 在 `buildProcessDisplayEntries()` 中透传 `expandPanelData` 和 `hasExpandPanel`
  - 来源：spec agent-web-process-panel MODIFIED Requirement
  - 验证：单元测试断言 `ProcessDisplayEntry` 包含这两个字段

## 6. Frontend: 过程面板 TITLE 条目交互

- [x] 6.1 在 `ProcessPanel.tsx` 中为 `hasExpandPanel === true` 的条目添加交互
  - 鼠标悬停 cursor: pointer
  - Tooltip 显示"点击打开扩展面板"
  - 点击调用 `expandPanelStore.setContent({ ...entry.expandPanelData, sourceKey: entry.key })` 并 `expandPanelStore.open()`
  - `hasExpandPanel` 为 false/undefined 的条目不添加交互
  - 来源：spec agent-web-expand-panel Requirement: 过程面板 TITLE 条目可交互
  - 验证：组件测试覆盖悬停样式、tooltip 内容、点击触发 store 更新、无 expandPanelData 不触发

## 7. Frontend: PiuMessage 注入

- [x] 7.1 在 `PiuMessage.tsx` 的 `piu.emit` payload 中注入 `handleExpandPanelOpen`、`handleExpandPanelClose` 和 `expandPanelId`
  - `handleExpandPanelOpen` 调用 `expandPanelStore.open()`（不设置 content）
  - `handleExpandPanelClose` 调用 `expandPanelStore.close()`
  - `expandPanelId` 为 `EXPAND_PANEL_DIV_ID` 固定常量
  - 来源：spec agent-web-structured-message-rendering MODIFIED Requirement
  - 验证：组件测试覆盖 payload 包含三个字段、调用 handleExpandPanelOpen 后 store isOpen 为 true 且 content 为 null、调用 handleExpandPanelClose 后 store isOpen 为 false

## 8. Frontend: ChatPage 集成（Local/Immersive）

- [x] 8.1 在 `ChatPage.tsx` 订阅 `expandPanelStore.isOpen` 并实现互斥
  - 订阅 `const isExpandPanelOpen = useExpandPanelStore((s) => s.isOpen)`
  - `isExpandPanelOpen` 变为 true 时：effect 清空 `selectedDetailRootMessageId`
  - `handleOpenFullProcess` 回调中：先调 `expandPanelStore.close()` 再设置 `selectedDetailRootMessageId`
  - 来源：spec agent-web-expand-panel Requirement: 扩展面板与 TurnRunGraphPanel 互斥
  - 验证：组件测试覆盖打开 expand 关闭 graph、打开 graph 关闭 expand、PIU 调用关闭同步

- [x] 8.2 在 `ChatPage.tsx` flex 容器中新增扩展面板条件渲染和 minWidth 切换
  - `isExpandPanelOpen` 为 true 时渲染 `<ExpandPanel />`，不渲染 TurnRunGraphPanel
  - 对话面板 `minWidth`：扩展面板打开时为 484px，graph 打开时为 `GRAPH_CHAT_MIN_WIDTH`，都不打开时为 0
  - 对话面板 `flex`：扩展面板打开时为 `0 0 484px`，否则为 `1 1 auto`
  - local 模式：扩展面板固定在右侧，忽略 `expandPanelPosition`
  - immersive 模式：扩展面板位置由 `expandPanelPosition` 控制（LEFT 或 RIGHT）
  - 来源：spec agent-web-expand-panel Requirement: Local 模式下的扩展面板布局、Immersive 模式下的扩展面板布局、扩展面板关闭后对话面板恢复
  - 验证：组件测试覆盖 local 固定右侧、immersive LEFT/RIGHT、minWidth 切换、关闭后恢复

- [x] 8.3 在 `ChatPage.tsx` 调用 `useExpandPanelStreamWatcher(activeSessionEventLayer)`
  - 来源：spec agent-web-expand-panel Requirement: 流式 EXPAND_PANEL 事件拦截
  - 验证：集成测试覆盖流式事件到达后面板打开

- [x] 8.4 在 `ChatPage.tsx` 实现 turn/session 切换时关闭扩展面板
  - 监听 `routeSessionId` 变化：变化时调用 `expandPanelStore.close()`
  - 监听当前 turn block 的 `rootMessageId` 变化：变化时调用 `expandPanelStore.close()`
  - 来源：spec agent-web-expand-panel Requirement: Turn/Session 切换时关闭扩展面板
  - 验证：单元测试覆盖 session 切换关闭、turn 切换关闭

## 9. Frontend: Collaborative 模式集成

- [x] 9.1 在 `AIAgentPiuRuntime.tsx` 中新增扩展面板区域
  - 扩展面板在 PIU 面板左侧
  - 打开时检查 PIU 面板当前 layout kind
  - 如果是 `floating` 或 `maximized`，先切换为 docked-right
  - 调用 `aiAgentPiuRuntimeStore.setDocked(defaultWidth)` 重置 PIU 面板宽度
  - `defaultWidth` = `AICOConfig.modalSize.width` ?? `DOCKED_DEFAULT_WIDTH`
  - 忽略 `expandPanelPosition` 配置
  - 关闭扩展面板后 PIU 面板保持默认宽度，不恢复用户之前拖拽的宽度
  - 来源：spec agent-web-expand-panel Requirement: Collaborative 模式下的扩展面板布局
  - 验证：组件测试覆盖扩展面板在左侧、PIU 面板宽度重置、floating/maximized 切换为 docked、关闭后保持默认宽度

## 10. Frontend: 确认现有行为不受影响

- [x] 10.1 确认 `buildAnswerSegments()` 不处理 `EXPAND_PANEL` 类型
  - `EXPAND_PANEL` ≠ `ANSWER`，现有 `isToolStructuredAnswerEvent()` 只匹配 `ANSWER`，自动跳过
  - 来源：spec agent-web-expand-panel Requirement: EXPAND_PANEL 不进入回答正文
  - 验证：单元测试断言 EXPAND_PANEL 事件不出现在 answer segments 中

- [x] 10.2 确认历史重载时 EXPAND_PANEL 事件不自动打开扩展面板
  - 历史重建的 `TOOL_STRUCTURED_DELTA` envelope 中 `toolEventType === "EXPAND_PANEL"` 的事件只进 `buildProcessTimelineEntries()` 挂到 TITLE 上
  - `useExpandPanelStreamWatcher` 跳过 `transportHints` 包含 `"history-load"` 的事件
  - 来源：spec agent-web-expand-panel Requirement: 历史重载不自动打开扩展面板
  - 验证：单元测试覆盖历史重载事件不触发 store open

## 11. Contract / Architecture 测试

- [x] 11.1 Contract 测试：`ToolEventType` 包含 `"EXPAND_PANEL"`
  - 来源：spec tool-structured-delta MODIFIED Requirement
  - 验证：`npm run test:contract`

- [x] 11.2 Contract 测试：`isClipStructuredEvent` 接受 `eventType: "EXPAND_PANEL"` + 合法 `messageType`
  - 来源：spec tool-structured-delta MODIFIED Requirement
  - 验证：`npm run test:contract`

- [x] 11.3 Negative test：`EXPAND_PANEL` 不进入 `buildAnswerSegments` 输出
  - 来源：spec agent-web-expand-panel Requirement: EXPAND_PANEL 不进入回答正文
  - 验证：单元测试断言 EXPAND_PANEL 事件被跳过

- [x] 11.4 Negative test：无 TITLE 的 EXPAND_PANEL 被忽略
  - 来源：spec agent-web-expand-panel Requirement: EXPAND_PANEL 事件挂在最近 TITLE 条目上
  - 验证：单元测试断言不产生 expandPanelData

- [x] 11.5 Negative test：local 模式下 `expandPanelPosition: LEFT` 被忽略
  - 来源：spec agent-web-expand-panel Requirement: Local 模式下的扩展面板布局
  - 验证：组件测试断言扩展面板在右侧

- [x] 11.6 Architecture 测试：`ExpandPanelStore` 不依赖 `AICOConfigStore`
  - 来源：design §12 可维护性
  - 验证：`npm run lint:architecture` 或 source-level assertion

## 12. 全量验证

- [x] 12.1 `openspec validate --all --strict` 通过
- [x] 12.2 `npm run build` 通过
- [x] 12.3 `npm test` 通过
- [x] 12.4 `npm run test:contract` 通过
- [x] 12.5 `npm run lint:architecture` 通过
