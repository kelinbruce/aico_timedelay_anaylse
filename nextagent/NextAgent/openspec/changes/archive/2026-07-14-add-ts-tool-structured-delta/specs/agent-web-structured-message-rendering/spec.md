# agent-web-structured-message-rendering Specification

## ADDED Requirements

### Requirement: Stream 事件类型注册

`agent-web/src/state/contracts.ts` 中的 `STREAM_EVENT_TYPES` MUST 包含 `"TOOL_STRUCTURED_DELTA"`。`useStreamConnection.ts` 中的 `FRAME_BATCHABLE_EVENT_TYPES` MUST 包含 `"TOOL_STRUCTURED_DELTA"`。

#### Scenario: 前端接收 TOOL_STRUCTURED_DELTA

- **WHEN** SSE/WebSocket stream 送达一个 `eventType: "TOOL_STRUCTURED_DELTA"` 的 envelope
- **THEN** 前端 MUST 接受并处理它，不得丢弃或错误分类该事件

### Requirement: 过程面板条目生成

`buildProcessTimelineEntries()` MUST 处理 `TOOL_STRUCTURED_DELTA` 事件，基于 `toolEventType` 生成独立的过程面板条目。具有同一 `toolCallId` 的多条 `TOOL_STRUCTURED_DELTA` 事件 MUST 全部被追加。

#### Scenario: TITLE 创建新的过程面板条目

- **WHEN** 一条 `toolEventType: "TITLE"` 的 `TOOL_STRUCTURED_DELTA` 事件到达
- **THEN** MUST 创建一个新的 `ProcessTimelineEntry`，其 `kind: "tool"`、主过程图标，且 `title` 设为该事件的 `content`
- **AND** 该条目 MUST NOT 被合并进前一个 CAPABILITY_* 条目

#### Scenario: DETAIL 累积到最近的 TITLE 条目

- **WHEN** 一条 `toolEventType: "DETAIL"` 的 `TOOL_STRUCTURED_DELTA` 事件到达
- **THEN** `content` MUST 累积到最近创建的 TITLE 条目的 `detail` 字段
- **AND** MUST NOT 创建新条目

#### Scenario: SUB_TITLE 创建带圆形图标的新条目

- **WHEN** 一条 `toolEventType: "SUB_TITLE"` 的 `TOOL_STRUCTURED_DELTA` 事件到达
- **THEN** MUST 创建一个新的 `ProcessTimelineEntry`，其 `kind: "tool"` 并使用圆形图标（不是主过程图标）
- **AND** 该条目相对父 TITLE 条目 MUST NOT 缩进

#### Scenario: SUB_DETAIL 累积到最近的 SUB_TITLE 条目

- **WHEN** 一条 `toolEventType: "SUB_DETAIL"` 的 `TOOL_STRUCTURED_DELTA` 事件到达
- **THEN** `content` MUST 累积到最近创建的 SUB_TITLE 条目的 `detail` 字段

#### Scenario: SUB_CONCLUSION 累积到最近的 SUB_TITLE 条目

- **WHEN** 一条 `toolEventType: "SUB_CONCLUSION"` 的 `TOOL_STRUCTURED_DELTA` 事件到达
- **THEN** `content` MUST 被追加到最近创建的 SUB_TITLE 条目的 `detail` 字段

#### Scenario: ANSWER 不创建过程面板条目

- **WHEN** 一条 `toolEventType: "ANSWER"` 的 `TOOL_STRUCTURED_DELTA` 事件到达
- **THEN** 过程面板中 MUST NOT 创建任何条目
- **AND** 该事件 MUST 被路由到回答内容区

#### Scenario: 非 TEXT messageType 的内容在过程面板中按 JSON.stringify 存储

- **WHEN** 一条 DETAIL 或 SUB_DETAIL 事件的 `toolMessageType` 不是 `TEXT`（例如 DSL、PIU）
- **THEN** 该内容 MUST 以 `JSON.stringify(content)` 形式存储到过程面板条目的 detail 字段
- **AND** 该条目 MUST 以纯文本渲染

### Requirement: 结构化 Tool 调用抑制 CAPABILITY_STARTED 和 COMPLETED

当某个 `toolCallId` 至少有一条 `TOOL_STRUCTURED_DELTA` 事件时，该 `toolCallId` 的 `CAPABILITY_STARTED` 和 `CAPABILITY_COMPLETED` 事件 MUST NOT 生成过程面板条目。这确保 CLIP 结构化事件完全控制该 tool call 的过程面板渲染。

#### Scenario: 存在 TOOL_STRUCTURED_DELTA 时 CAPABILITY_STARTED 被抑制

- **WHEN** 一条 `CAPABILITY_STARTED` 事件到达，且其 `toolCallId` 也有 `TOOL_STRUCTURED_DELTA` 事件
- **THEN** 该 `CAPABILITY_STARTED` 事件 MUST NOT 创建任何过程面板条目

#### Scenario: 存在 TOOL_STRUCTURED_DELTA 时 CAPABILITY_COMPLETED 被抑制

- **WHEN** 一条 `CAPABILITY_COMPLETED` 事件到达，且其 `toolCallId` 也有 `TOOL_STRUCTURED_DELTA` 事件
- **THEN** 该 `CAPABILITY_COMPLETED` 事件 MUST NOT 创建任何过程面板条目

#### Scenario: 不存在 TOOL_STRUCTURED_DELTA 时 CAPABILITY_STARTED 不被抑制

- **WHEN** 一条 `CAPABILITY_STARTED` 事件到达，且其 `toolCallId` 没有（NO）任何 `TOOL_STRUCTURED_DELTA` 事件
- **THEN** 既有的过程面板条目生成逻辑 MUST 原样适用

### Requirement: SUB_TITLE 条目的圆形图标

过程面板 MUST 为来源 `toolEventType` 为 `SUB_TITLE` 的条目渲染一个新的圆形图标。该图标 MUST 拥有深色和浅色变体（`circle-dark.svg`、`circle-light.svg`），位于 `src/assets/process-icons/`。

#### Scenario: SUB_TITLE 条目选用圆形图标

- **WHEN** 渲染一个来源 `toolEventType` 为 `SUB_TITLE` 的过程面板条目
- **THEN** 图标 MUST 是当前主题对应的圆形图标变体
- **AND** 图标 MUST NOT 是 `process-complete` 或 `think` 图标

### Requirement: 回答内容混合渲染

回答内容区 MUST 同时渲染 `LLM_CONTENT_DELTA` 事件和带 `toolEventType: "ANSWER"` 的 `TOOL_STRUCTURED_DELTA` 事件，按 `sequence` 排序。`LLM_CONTENT_DELTA` 事件 MUST 作为文本合并。`TOOL_STRUCTURED_DELTA` ANSWER 事件 MUST 通过分发到相应的 `toolMessageType` renderer 组件渲染。

#### Scenario: LLM 文本与结构化回答共存

- **WHEN** 一个 turn 同时有 `LLM_CONTENT_DELTA` 事件和 `TOOL_STRUCTURED_DELTA` ANSWER 事件
- **THEN** 回答内容 MUST 按 sequence 顺序交错渲染它们
- **AND** `LLM_CONTENT_DELTA` 事件 MUST 贡献文本内容
- **AND** `TOOL_STRUCTURED_DELTA` ANSWER 事件 MUST 贡献结构化 renderer 组件

### Requirement: MessageType renderer 组件

前端 MUST 实现六个按 `toolMessageType` 分发的 ANSWER 事件 renderer 组件。

#### Scenario: 带 TEXT messageType 的 ANSWER

- **WHEN** 一个 ANSWER 事件带有 `toolMessageType: "TEXT"`
- **THEN** 内容 MUST 使用 `MarkdownContent` 渲染为 Markdown

#### Scenario: 带 FILE messageType 的 ANSWER

- **WHEN** 一个 ANSWER 事件带有 `toolMessageType: "FILE"`
- **THEN** 内容（一个文件名字符串）MUST 渲染为一个带圆角矩形样式的 `FileCard` 组件

#### Scenario: 带 ACTION messageType 的 ANSWER

- **WHEN** 一个 ANSWER 事件带有 `toolMessageType: "ACTION"`
- **THEN** 内容（一个 JSON 字符串）MUST 被解析，且每个 key MUST 立即触发 `document.dispatchEvent(new CustomEvent(key, { detail: JSON.parse(data) }))`
- **AND** 如果任一 key 存在 `text` 字段，它 MUST 显示为说明文本

#### Scenario: 带 OPERATOR messageType 的 ANSWER

- **WHEN** 一个 ANSWER 事件带有 `toolMessageType: "OPERATOR"`
- **THEN** 内容（一个 JSON 字符串）MUST 被解析以渲染提示文本和按钮组
- **AND** 按钮 MUST 依据其 `type` 字段（`primary`、`default`、`risk`）设置样式
- **AND** 按钮 MUST 依据 `align` 字段（`left`、`center`、`right`）对齐
- **AND** 用户点击按钮 MUST 触发 `document.dispatchEvent(new CustomEvent(eventKey, { detail: JSON.parse(data) }))`

#### Scenario: 带 DSL messageType 的 ANSWER

- **WHEN** 一个 ANSWER 事件带有 `toolMessageType: "DSL"`
- **THEN** 内容 MUST 使用来自 `@cloudsop/dsl-engine-web` 的 `<DSLEngine data={[content]} />` 渲染，不做任何转换
- **AND** 在本地 dev 模式下，vite alias MUST 解析到一个渲染占位符的 stub 组件

#### Scenario: 带 PIU messageType 的 ANSWER

- **WHEN** 一个 ANSWER 事件带有 `toolMessageType: "PIU"`
- **THEN** 内容 MUST 使用 `PiuMessage` 组件渲染
- **AND** 该组件 MUST 先调用 `window.Prel.autoLoad(piuName, piuVersion)`，再调用 `piu.emit(method, { ...content, wrapperId, containerId })`
- **AND** 该组件 MUST 渲染一个带唯一 `id`（与 `wrapperId` 匹配）的 `<div>` 容器
- **AND** 如果 `content.piuName` 缺失、`piu` 为 null 或 `window.Prel` 不可用，该组件 MUST 渲染一个 fallback 占位符

### Requirement: PiuContext Provider

前端 MUST 提供一个 `PiuContext`，向任何后代组件暴露 `piu`（类型为 `PIU | null`）和 `site`（类型为 `HostSiteContext`）。全部三个入口（`local.tsx`、`immersive.tsx`、`registerAIAgentPIU.tsx`）MUST 用从 `prel.start` 回调获得的 `piu` 和 `site` 填充 `PiuContext`。

#### Scenario: Immersive 入口填充 PiuContext

- **WHEN** immersive 入口调用 `prel.start(name, version, deps, (piu, site) => ...)`
- **THEN** `piu` 和 `site` MUST 被设置进 `PiuContext.Provider` value
- **AND** 后代组件 MUST 能通过 `useContext(PiuContext)` 读取 `piu`

#### Scenario: PIU collaborative 入口填充 PiuContext

- **WHEN** PIU collaborative 入口调用 `prel.start(name, version, deps, (piu, site) => ...)`
- **THEN** `piu` 和 `site` MUST 通过 runtime store 或直接 state 被设置进 `PiuContext.Provider` value

#### Scenario: Local 入口使用 mock Prel

- **WHEN** 本地入口（`local.tsx`）以 dev 模式启动
- **THEN** MUST 在渲染之前调用 `installMockPrel()` 以注入带 mock 实现的 `window.Prel`
- **AND** `prel.start` 回调 MUST 接收 `mockPiu` 和 `mockSite`
- **AND** `PiuContext` MUST 用 `mockPiu` 和 `mockSite` 填充

### Requirement: 本地开发的 Mock Prel

前端 MUST 提供一个 `prel-mock.ts` 模块，导出 `mockPrel`、`mockPiu`、`mockSite` 和 `installMockPrel()`。mock `Prel.start` MUST 同步地以 `mockPiu` 和 `mockSite` 调用回调。mock `Prel.autoLoad` MUST 返回一个已 resolve 的 promise。mock `piu.emit` MUST 是带 `console.debug` 日志的 no-op。mock `piu.attach` MUST 是 no-op。

#### Scenario: 本地模式下安装 Mock Prel

- **WHEN** `installMockPrel()` 被调用且 `window.Prel` 尚未被设置
- **THEN** `window.Prel` MUST 被设置为 `mockPrel`
- **AND** 后续 `prel.start` 调用 MUST 以 `mockPiu` 和 `mockSite` 调用回调

#### Scenario: Mock Prel 不覆盖真实 Prel

- **WHEN** `installMockPrel()` 被调用且 `window.Prel` 已被设置
- **THEN** `window.Prel` MUST NOT 被覆盖

### Requirement: PIU 类型定义更新

`host/prel.ts` 中的 `PIU` 接口 MUST 更新为匹配实际的 host framework contract。`attach` 方法 MUST 接受一个带可选 `$stateChange` 和 `userAction` 字段的类型化对象，而不是 `Record<string, unknown>`。

#### Scenario: PIU attach 接受类型化 handler

- **WHEN** 调用 `piu.attach(piu, handlers)`
- **THEN** `handlers` 参数 MUST 类型化为 `{ $stateChange?: Dictionary<(newValue: any, oldValue: any) => void>; userAction?: { febsMemuEvent?: (params: { event: string; type: string }) => void; logout?: () => void; } }`

### Requirement: DSL Vite Alias Stub

vite 配置 MUST 在 dev 模式下把 `@cloudsop/dsl-engine-web` alias 到本地 stub 组件，并在 production 构建中 alias 到真实 package。该 stub MUST 导出一个渲染占位符的 `DSLEngine` 函数组件。

#### Scenario: 本地 dev 模式解析到 stub

- **WHEN** vite dev server 以本地模式启动
- **THEN** `import { DSLEngine } from '@cloudsop/dsl-engine-web'` MUST 解析到 stub 组件
- **AND** 该 stub MUST 无错误地渲染一个可见占位符

#### Scenario: Production 构建解析到真实 package

- **WHEN** vite 为 production 构建
- **THEN** `import { DSLEngine } from '@cloudsop/dsl-engine-web'` MUST 解析到真实的 `@cloudsop/dsl-engine-web` package
- **AND** 如果该 package 未安装，构建 MUST 失败
