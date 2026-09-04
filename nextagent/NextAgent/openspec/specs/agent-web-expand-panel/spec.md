# agent-web-expand-panel Specification

## Purpose

Define frontend expand panel layout, lifecycle, structured event integration, PIU handoff and process-panel interaction behavior.
## Requirements
### Requirement: 扩展面板渲染容器

扩展面板 SHALL 提供一个固定 id 的 div 容器供外部渲染。扩展面板根元素 SHALL 设置 `position: relative`，容器 div 设置 `width: 100%; height: 100%`。关闭按钮 SHALL 作为独立 absolute 元素悬浮在面板之上，位于右上角 `top: 24px; right: 24px`，z-index 高于容器内任何外部渲染内容。

#### Scenario: 扩展面板容器结构

- **WHEN** 扩展面板打开
- **THEN** 面板根元素 MUST 为 `position: relative`
- **AND** 容器 div MUST 有固定 id 且 `width: 100%; height: 100%`
- **AND** 关闭按钮 MUST 为 `position: absolute; top: 24px; right: 24px`
- **AND** 关闭按钮 z-index MUST 高于容器内容

#### Scenario: 关闭按钮独立悬浮

- **WHEN** 外部代码向容器 div 渲染内容
- **THEN** 关闭按钮 MUST 始终可见且可点击
- **AND** 关闭按钮 MUST 不被容器内元素遮挡

### Requirement: 扩展面板容器内容清理

扩展面板容器 div 的内容由两种来源写入：前端 React 渲染（场景 1 和历史导航）和 PIU 直接 DOM 操作（场景 2）。当来源切换时，容器 MUST 先清空原有 DOM 内容再渲染新内容。清理方式 SHALL 使用 `containerEl.replaceChildren()` 清除所有子节点。以下情况 MUST 触发清理：`content` 从非 null 变为另一个非 null 值（场景 1 内切换）、`content` 从非 null 变为 null（场景 2 接管）、`isOpen` 从 true 变为 false（关闭面板）。

#### Scenario: 场景 1 内切换清理

- **GIVEN** 扩展面板正在展示场景 1 的结构化内容
- **WHEN** 新的 `EXPAND_PANEL` 事件到达并更新 `content`
- **THEN** 容器 div MUST 先调用 `replaceChildren()` 清空
- **AND** 然后 React 渲染新内容

#### Scenario: 场景 1 到场景 2 切换清理

- **GIVEN** 扩展面板正在展示场景 1 的结构化内容
- **WHEN** PIU 调用 `handleExpandPanelOpen()`（`content` 变为 null）
- **THEN** 容器 div MUST 先调用 `replaceChildren()` 清空 React 渲染的内容
- **AND** PIU 自行往容器渲染新内容

#### Scenario: 关闭面板清理

- **WHEN** 扩展面板关闭（`isOpen` 变为 false）
- **THEN** 容器 div MUST 调用 `replaceChildren()` 清空所有内容

### Requirement: 扩展面板底色

扩展面板底色 SHALL 根据主题变化。浅色主题下底色 MUST 为 `#fff`。深色主题下底色 MUST 为 `#393939`。

#### Scenario: 浅色主题底色

- **WHEN** 当前主题为 `lightday` 或 `light`
- **THEN** 扩展面板背景色 MUST 为 `#fff`

#### Scenario: 深色主题底色

- **WHEN** 当前主题为 `evening` 或 `dark`
- **THEN** 扩展面板背景色 MUST 为 `#393939`

### Requirement: Local 模式下的扩展面板布局

在 local 模式下，扩展面板 SHALL 嵌入 `ChatPage` 的 flex 容器中，作为对话面板的兄弟元素。扩展面板位置 SHALL 固定在对话面板右侧。扩展面板打开时，对话面板宽度 MUST 收缩为 `DOCKED_DEFAULT_WIDTH`（484px），`minWidth` MUST 设置为 484px。扩展面板 MUST 填充 flex 容器剩余宽度。`AICOConfig.layoutConfig.expandPanelPosition` 在 local 模式下 MUST 被忽略。

#### Scenario: Local 模式扩展面板在右侧

- **WHEN** local 模式下扩展面板打开
- **THEN** 对话面板 MUST 在左侧，宽度为 484px
- **AND** 扩展面板 MUST 在右侧，填充剩余宽度

#### Scenario: Local 模式忽略 expandPanelPosition

- **WHEN** local 模式下 `expandPanelPosition` 为 `LEFT`
- **THEN** 扩展面板 MUST 仍在右侧

### Requirement: Immersive 模式下的扩展面板布局

在 immersive 模式下，扩展面板 SHALL 嵌入 `ChatPage` 的 flex 容器中，作为对话面板的兄弟元素。扩展面板位置由 `AICOConfig.layoutConfig.expandPanelPosition` 控制，默认 `RIGHT`。`LEFT` 时扩展面板在对话面板左侧，`RIGHT` 时在右侧。扩展面板打开时，对话面板宽度 MUST 收缩为 `DOCKED_DEFAULT_WIDTH`（484px），`minWidth` MUST 设置为 484px。扩展面板 MUST 填充 flex 容器剩余宽度。

#### Scenario: expandPanelPosition 为 RIGHT

- **WHEN** immersive 模式下 `expandPanelPosition` 为 `RIGHT` 且扩展面板打开
- **THEN** 对话面板 MUST 在左侧，宽度为 484px
- **AND** 扩展面板 MUST 在右侧，填充剩余宽度

#### Scenario: expandPanelPosition 为 LEFT

- **WHEN** immersive 模式下 `expandPanelPosition` 为 `LEFT` 且扩展面板打开
- **THEN** 扩展面板 MUST 在左侧，填充剩余宽度
- **AND** 对话面板 MUST 在右侧，宽度为 484px

#### Scenario: expandPanelPosition 默认值

- **WHEN** immersive 模式下 `expandPanelPosition` 未设置
- **THEN** 默认值 MUST 为 `RIGHT`

### Requirement: 扩展面板关闭后对话面板恢复

扩展面板关闭时，对话面板 MUST 恢复为 `flex: 1 1 auto`，`minWidth` MUST 恢复为 0（如果 TurnRunGraphPanel 也未打开）或 `GRAPH_CHAT_MIN_WIDTH`（如果 TurnRunGraphPanel 打开）。扩展面板不渲染时对话面板 MUST 占满 flex 容器。

#### Scenario: 关闭扩展面板后恢复

- **GIVEN** 扩展面板已打开，对话面板宽度为 484px
- **WHEN** 扩展面板关闭且 TurnRunGraphPanel 未打开
- **THEN** 对话面板 MUST 恢复为 `flex: 1 1 auto`
- **AND** `minWidth` MUST 为 0

### Requirement: Collaborative 模式下的扩展面板布局

在 collaborative 模式下，扩展面板 SHALL 永远位于左侧。扩展面板打开时，PIU 对话面板 MUST 强制变为 docked-right 状态，宽度 MUST 重置为基准宽度。基准宽度 MUST 为 `AICOConfig.modalSize.width` 的有效数值配置；未提供有效数值配置时 MUST 为 `DOCKED_DEFAULT_WIDTH`（484px）。如果 PIU 面板当前为 floating 或 maximized 状态，MUST 先切换为 docked 再设置宽度。`expandPanelPosition` 配置在 collaborative 模式下 MUST 被忽略。

当 PIU 对话面板宽度小于或等于基准宽度时，扩展面板 MUST 填充 PIU 对话面板左侧的剩余视口宽度。当 PIU 对话面板宽度大于基准宽度时，扩展面板 MUST 保持基准边界，PIU 对话面板 MUST 覆盖在扩展面板之上；扩展面板 MUST NOT 跟随 PIU 对话面板继续压缩。PIU 对话内容 MUST 填充当前 PIU 对话面板宽度。关闭扩展面板后，PIU 面板宽度 MUST 保持基准宽度，不恢复用户之前拖拽的宽度。

**需求类别**：功能性需求

#### Scenario: Collaborative 模式打开扩展面板

- **WHEN** collaborative 模式下扩展面板打开
- **THEN** 扩展面板 MUST 在左侧
- **AND** PIU 对话面板 MUST 在右侧
- **AND** PIU 对话面板宽度 MUST 重置为基准宽度
- **AND** PIU 对话内容 MUST 填充 PIU 对话面板

#### Scenario: 基准宽度内共享视口

- **GIVEN** collaborative 模式下扩展面板已打开
- **WHEN** PIU 对话面板宽度小于或等于基准宽度
- **THEN** 扩展面板 MUST 填充 PIU 对话面板左侧的剩余视口宽度

#### Scenario: 超过基准宽度时覆盖扩展面板

- **GIVEN** collaborative 模式下扩展面板已打开
- **WHEN** PIU 对话面板被拖拽为大于基准宽度
- **THEN** 扩展面板 MUST 保持基准边界
- **AND** PIU 对话面板 MUST 覆盖在扩展面板之上
- **AND** PIU 对话内容 MUST 填充拖拽后的 PIU 对话面板宽度

#### Scenario: Collaborative 模式忽略 expandPanelPosition

- **WHEN** collaborative 模式下 `expandPanelPosition` 为 `RIGHT`
- **THEN** 扩展面板 MUST 仍在左侧

#### Scenario: 用户拖拽后触发扩展面板

- **GIVEN** collaborative 模式下用户已拖拽 PIU 面板改变宽度
- **WHEN** 扩展面板被触发打开
- **THEN** PIU 面板宽度 MUST 重置为基准宽度
- **AND** 扩展面板 MUST 填充左侧剩余区域

#### Scenario: PIU 面板为 floating 时触发扩展面板

- **GIVEN** collaborative 模式下 PIU 面板为 floating 状态
- **WHEN** 扩展面板被触发打开
- **THEN** PIU 面板 MUST 切换为 docked-right
- **AND** PIU 面板宽度 MUST 重置为基准宽度

#### Scenario: PIU 面板为 maximized 时触发扩展面板

- **GIVEN** collaborative 模式下 PIU 面板为 maximized 状态
- **WHEN** 扩展面板被触发打开
- **THEN** PIU 面板 MUST 切换为 docked-right
- **AND** PIU 面板宽度 MUST 重置为基准宽度

#### Scenario: 关闭扩展面板后 PIU 面板保持默认宽度

- **GIVEN** collaborative 模式下扩展面板已打开，PIU 面板为基准宽度
- **WHEN** 扩展面板关闭
- **THEN** PIU 面板宽度 MUST 保持基准宽度
- **AND** MUST NOT 恢复用户之前拖拽的宽度

### Requirement: 扩展面板与 TurnRunGraphPanel 互斥

扩展面板与 `TurnRunGraphPanel` SHALL 互斥。同一时间只能展示其中一个。`ChatPage` SHALL 订阅 `expandPanelStore.isOpen` 实现互斥。打开扩展面板时 MUST 清空 `selectedDetailRootMessageId`（关闭 TurnRunGraphPanel）。打开 `TurnRunGraphPanel` 时 MUST 调用 `expandPanelStore.close()`。最新触发者占用区域。

#### Scenario: 打开扩展面板时关闭 Graph Panel

- **GIVEN** `TurnRunGraphPanel` 已打开（`selectedDetailRootMessageId` 非 null）
- **WHEN** 扩展面板被触发打开（`expandPanelStore.isOpen` 变为 true）
- **THEN** `selectedDetailRootMessageId` MUST 被清空
- **AND** `TurnRunGraphPanel` MUST 关闭
- **AND** 扩展面板 MUST 展示

#### Scenario: 打开 Graph Panel 时关闭扩展面板

- **GIVEN** 扩展面板已打开（`expandPanelStore.isOpen` 为 true）
- **WHEN** `TurnRunGraphPanel` 被触发打开（设置 `selectedDetailRootMessageId`）
- **THEN** `expandPanelStore.close()` MUST 被调用
- **AND** 扩展面板 MUST 关闭
- **AND** `TurnRunGraphPanel` MUST 展示

#### Scenario: PIU 调用关闭时同步关闭面板

- **GIVEN** 扩展面板已打开且 `TurnRunGraphPanel` 未打开
- **WHEN** PIU 组件调用 `handleExpandPanelClose()`
- **THEN** `expandPanelStore.isOpen` MUST 变为 false
- **AND** `ChatPage` MUST 检测到状态变化并关闭扩展面板渲染

### Requirement: 扩展面板状态管理

扩展面板状态 SHALL 由独立 store（`ExpandPanelStore`）管理。状态 MUST 包含 `isOpen`（boolean）、`content`（`{ toolMessageType, content }` 或 null）、`sourceKey`（来源标识，用于区分流式自动刷新和用户点击导航）。后到的内容 MUST 清除前面的内容（last-write-wins）。关闭面板时 MUST 清空 `content` 和 `sourceKey`。`ExpandPanelStore` MUST NOT 依赖 `AICOConfigStore`。

#### Scenario: 流式自动刷新

- **WHEN** 流式传输中收到 `EXPAND_PANEL` 事件
- **THEN** 扩展面板 MUST 自动打开（如果未打开）
- **AND** 面板内容 MUST 替换为新事件的数据
- **AND** `sourceKey` MUST 标记为 `"live-stream"`

#### Scenario: 历史导航

- **WHEN** 用户点击过程面板中有 `expandPanelData` 的 TITLE 条目
- **THEN** 扩展面板 MUST 打开（如果未打开）
- **AND** 面板内容 MUST 设置为该条目的 `expandPanelData`
- **AND** `sourceKey` MUST 标记为该条目的 key

#### Scenario: PIU 打开面板不设置 content

- **WHEN** PIU 组件调用 `handleExpandPanelOpen()`
- **THEN** `isOpen` MUST 变为 true
- **AND** `content` MUST 为 null（PIU 自行渲染）

#### Scenario: 关闭面板清空状态

- **WHEN** 用户点击关闭按钮
- **THEN** `isOpen` MUST 变为 false
- **AND** `content` MUST 变为 null
- **AND** `sourceKey` MUST 变为 null

### Requirement: 流式 EXPAND_PANEL 事件拦截

流式 `EXPAND_PANEL` 事件 SHALL 通过独立 hook 拦截。hook SHALL 监听 `activeSessionEventLayer`（conversation store 中的事件层）的新增事件。当检测到 `eventType === "TOOL_STRUCTURED_DELTA"` 且 `payload.toolEventType === "EXPAND_PANEL"` 的事件时，hook MUST 调用 `expandPanelStore.setContent()` 和 `expandPanelStore.open()`。历史重载的事件（`transportHints` 包含 `"history-load"`）MUST NOT 触发 `expandPanelStore.open()`。

#### Scenario: 流式事件触发面板打开

- **WHEN** hook 检测到新增的 `EXPAND_PANEL` 类型 `TOOL_STRUCTURED_DELTA` 事件且非历史重载
- **THEN** `expandPanelStore.setContent()` MUST 被调用
- **AND** `expandPanelStore.open()` MUST 被调用

#### Scenario: 历史重载事件不触发面板打开

- **WHEN** hook 检测到 `EXPAND_PANEL` 类型事件但 `transportHints` 包含 `"history-load"`
- **THEN** `expandPanelStore.open()` MUST NOT 被调用

### Requirement: Turn/Session 切换时关闭扩展面板

当切换到另一个 turn（`selectedDetailRootMessageId` 变化不算 turn 切换）或 session 时，扩展面板 MUST 自动关闭。turn 切换定义为 `routeSessionId` 变化或当前 turn block 的 `rootMessageId` 变化。关闭时 MUST 清空 `content` 和 `sourceKey`。

#### Scenario: 切换 session 时关闭

- **GIVEN** 扩展面板已打开
- **WHEN** `routeSessionId` 变化
- **THEN** `expandPanelStore.close()` MUST 被调用
- **AND** `content` MUST 变为 null

#### Scenario: 切换 turn 时关闭

- **GIVEN** 扩展面板已打开
- **WHEN** 当前 turn block 的 `rootMessageId` 变化
- **THEN** `expandPanelStore.close()` MUST 被调用
- **AND** `content` MUST 变为 null

### Requirement: EXPAND_PANEL 事件挂在最近 TITLE 条目上

`buildProcessTimelineEntries()` 处理 `TOOL_STRUCTURED_DELTA` 的 `EXPAND_PANEL` 类型时，SHALL 将数据挂到最近的 TITLE 条目的 `expandPanelData` 字段上，不创建独立过程条目。如果 `lastStructuredTitleEntry` 为 null（前面没有 TITLE），该 EXPAND_PANEL 事件 MUST 被忽略。每两个 TITLE 之间最多一个 EXPAND_PANEL；多个时后到的覆盖前面的（last-write-wins）。

#### Scenario: EXPAND_PANEL 挂到 TITLE 上

- **GIVEN** 已有 TITLE 条目
- **WHEN** 收到 `EXPAND_PANEL` 事件
- **THEN** 该 TITLE 条目的 `expandPanelData` MUST 设置为事件的 `toolMessageType` 和 `content`
- **AND** 该 TITLE 条目的 `hasExpandPanel` MUST 为 true
- **AND** MUST 不创建独立过程条目

#### Scenario: 无 TITLE 的 EXPAND_PANEL 被忽略

- **GIVEN** `lastStructuredTitleEntry` 为 null
- **WHEN** 收到 `EXPAND_PANEL` 事件
- **THEN** 该事件 MUST 被忽略

#### Scenario: 多个 EXPAND_PANEL 后到覆盖

- **GIVEN** TITLE 条目已有 `expandPanelData`
- **WHEN** 同一 TITLE 范围内收到新的 `EXPAND_PANEL` 事件
- **THEN** `expandPanelData` MUST 被新数据覆盖

### Requirement: 过程面板 TITLE 条目可交互

过程面板中 `hasExpandPanel` 为 true 的 TITLE 条目 SHALL 可交互。鼠标悬停时 cursor MUST 变为 `pointer`。鼠标悬停时 MUST 显示 tooltip 提示"点击打开扩展面板"。点击该条目 SHALL 触发扩展面板打开，展示该条目的 `expandPanelData`。

#### Scenario: 悬停样式

- **WHEN** 鼠标悬停在有 `expandPanelData` 的 TITLE 条目上
- **THEN** cursor MUST 为 `pointer`
- **AND** MUST 显示 tooltip "点击打开扩展面板"

#### Scenario: 点击打开扩展面板

- **WHEN** 用户点击有 `expandPanelData` 的 TITLE 条目
- **THEN** 扩展面板 MUST 打开
- **AND** 面板内容 MUST 为该条目的 `expandPanelData`

#### Scenario: 无 expandPanelData 的条目不可交互

- **WHEN** TITLE 条目 `hasExpandPanel` 为 false 或 undefined
- **THEN** cursor MUST NOT 为 pointer
- **AND** MUST NOT 显示 tooltip
- **AND** 点击 MUST NOT 触发扩展面板

### Requirement: PiuMessage 注入扩展面板控制方法

`PiuMessage.tsx` 的 `piu.emit` payload SHALL 注入 `handleExpandPanelOpen`（函数，调用后打开扩展面板，不设置 `content`）、`handleExpandPanelClose`（函数，调用后关闭扩展面板）和 `expandPanelId`（固定字符串，扩展面板容器 div 的 id）。PIU 组件调用 `handleExpandPanelOpen` 后自行往 `expandPanelId` div 渲染内容。场景切换时容器 MUST 先清空原有内容再渲染新内容。

#### Scenario: PIU 调用 handleExpandPanelOpen

- **WHEN** PIU 组件调用 `handleExpandPanelOpen()`
- **THEN** 扩展面板 MUST 打开
- **AND** `content` MUST 为 null
- **AND** 扩展面板容器 div MUST 可供 PIU 渲染

#### Scenario: PIU 调用 handleExpandPanelClose

- **WHEN** PIU 组件调用 `handleExpandPanelClose()`
- **THEN** 扩展面板 MUST 关闭
- **AND** 容器 div MUST 被清空

#### Scenario: 场景切换清空内容

- **GIVEN** 扩展面板正在展示场景 1（EXPAND_PANEL 事件）的内容
- **WHEN** PIU 组件调用 `handleExpandPanelOpen()`
- **THEN** 扩展面板容器 MUST 先清空原有内容
- **AND** PIU 自行往容器渲染新内容

### Requirement: 历史重载不自动打开扩展面板

加载会话历史时，存储的 `CAPABILITY_RESULT` 消息重建为 `TOOL_STRUCTURED_DELTA` envelope 后，如果包含 `EXPAND_PANEL` 类型，扩展面板 MUST NOT 自动打开。EXPAND_PANEL 数据 MUST 仍然挂到过程面板的 TITLE 条目上，供用户手动点击查看。

#### Scenario: 历史重载不自动打开

- **WHEN** 加载会话历史且存在 `EXPAND_PANEL` 类型的 `TOOL_STRUCTURED_DELTA` 事件
- **THEN** 扩展面板 MUST NOT 自动打开
- **AND** EXPAND_PANEL 数据 MUST 挂到对应 TITLE 条目的 `expandPanelData` 上

### Requirement: EXPAND_PANEL 不进入回答正文

`buildAnswerSegments()` 处理 `TOOL_STRUCTURED_DELTA` 事件时，`toolEventType` 为 `EXPAND_PANEL` 的事件 MUST NOT 进入回答正文区域。EXPAND_PANEL 内容只通过扩展面板展示。

#### Scenario: EXPAND_PANEL 不混入回答正文

- **WHEN** `buildAnswerSegments()` 处理事件流
- **THEN** `toolEventType === "EXPAND_PANEL"` 的事件 MUST 被跳过
- **AND** 回答正文 MUST NOT 包含 EXPAND_PANEL 内容

### Requirement: 扩展面板内容来源

扩展面板 SHALL 区分内容来源，以决定布局、header 显隐和生命周期回调行为。

- `'react'`：前端通过 `setContent` 渲染结构化内容。
- `'view'`：前端通过 `setView` 渲染 React 视图页。
- `'dsl'`：DSL 引擎通过 `@cloudsop/dsl-engine-web` 的 `init` 方法直接接管容器渲染。
- `null`：面板未打开。

#### Scenario: 设置内容来源

- **WHEN** `setContent` 被调用
- **THEN** `contentSource` MUST 变为 `'react'`

- **WHEN** `setView` 被调用
- **THEN** `contentSource` MUST 变为 `'view'`

- **WHEN** `openDsl` 被调用
- **THEN** `contentSource` MUST 变为 `'dsl'`

- **WHEN** `close` 或 `closeDsl` 被调用
- **THEN** `contentSource` MUST 变为 `null`

### Requirement: DSL 引擎打开时隐藏 header

当 `contentSource === 'dsl'` 时，扩展面板 SHALL 不渲染 header（含关闭按钮）。

#### Scenario: DSL 内容源不显示 header

- **GIVEN** `contentSource` 为 `'dsl'`
- **WHEN** 扩展面板打开
- **THEN** header 区域 MUST 不被渲染

#### Scenario: 非 DSL 内容源显示 header

- **GIVEN** `contentSource` 为 `'react'` 或 `'view'`
- **WHEN** 扩展面板打开
- **THEN** header 区域 MUST 被渲染

### Requirement: DSL 引擎生命周期回调

扩展面板 SHALL 提供 `registerDslClearHandler` 方法，允许外部注册一个无参回调。当 `contentSource` 从 `'dsl'` 切换到其他来源，或面板被外部关闭时，该回调 MUST 被调用。

#### Scenario: 外部关闭触发 DSL 清理

- **GIVEN** `contentSource` 为 `'dsl'` 且已注册 DSL 清理回调
- **WHEN** `close()` 被调用
- **THEN** 已注册的 DSL 清理回调 MUST 被调用一次
- **AND** `contentSource` MUST 变为 `null`

#### Scenario: 切换到 React 内容触发 DSL 清理

- **GIVEN** `contentSource` 为 `'dsl'` 且已注册 DSL 清理回调
- **WHEN** `setContent()` 被调用
- **THEN** 已注册的 DSL 清理回调 MUST 被调用一次
- **AND** `contentSource` MUST 变为 `'react'`

#### Scenario: 切换到视图页触发 DSL 清理

- **GIVEN** `contentSource` 为 `'dsl'` 且已注册 DSL 清理回调
- **WHEN** `setView()` 被调用
- **THEN** 已注册的 DSL 清理回调 MUST 被调用一次
- **AND** `contentSource` MUST 变为 `'view'`

#### Scenario: DSL 正常关闭不触发清理回调

- **GIVEN** `contentSource` 为 `'dsl'` 且已注册 DSL 清理回调
- **WHEN** DSL 引擎调用 `handleExpandPanel(false)`，进而调用 `closeDsl()`
- **THEN** 已注册的 DSL 清理回调 MUST NOT 被调用
- **AND** `contentSource` MUST 变为 `null`

### Requirement: 按来源重新挂载容器

扩展面板容器 div 的 React key SHALL 基于 `contentSource`，确保来源切换时 React 重新挂载容器，清空 DSL 注入的 DOM。

#### Scenario: 来源切换清空容器

- **GIVEN** 扩展面板当前显示 DSL 内容
- **WHEN** `contentSource` 从 `'dsl'` 变为 `'react'` 或 `'view'`
- **THEN** 容器 div MUST 被重新挂载，原有 DSL DOM 被清除
