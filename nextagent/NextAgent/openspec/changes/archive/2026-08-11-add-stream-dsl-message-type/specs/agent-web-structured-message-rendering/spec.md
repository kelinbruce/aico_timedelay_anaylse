# agent-web-structured-message-rendering Specification Delta

## MODIFIED Requirements

### Requirement: 回答内容混合渲染

回答内容区域 MUST 按 sequence 顺序渲染 `LLM_CONTENT_DELTA` 事件和 `toolEventType: "ANSWER"` 的 `TOOL_STRUCTURED_DELTA` 事件。结构化 ANSWER 事件 MUST 分发到对应的 `toolMessageType` renderer。当某个 LLM 回答文本与同一 turn 中某个结构化 TEXT ANSWER 完全相同时，前端 MUST 通过结构化 TEXT renderer 只渲染一次该文本，并 MUST 抑制重复的 LLM 投影。不同的 LLM 文本与非 TEXT 结构化回答 MUST 继续共存。

`STREAM_DSL` ANSWER 事件 MUST 在渲染前按 stream 累积为单个 segment。多个连续的 `STREAM_DSL` ANSWER 事件 MUST NOT 被渲染为独立 segment。

#### Scenario: 重复的 LLM 与结构化 TEXT 回答只渲染一次

- **WHEN** 某个 turn 包含一个结构化 TEXT ANSWER 和一个文本完全相同的 LLM 回答
- **THEN** 回答区域 MUST 只包含该文本的一个结构化 TEXT segment
- **AND** MUST NOT 追加第二个相同内容的 LLM 文本 segment

#### Scenario: 不同的 LLM 文本与结构化回答共存

- **WHEN** LLM 回答文本与结构化 ANSWER 内容不同
- **THEN** 两者 MUST 按 sequence 顺序渲染

### Requirement: MessageType Renderer 组件

`AnswerSegments` 组件 MUST 基于每个结构化 segment 的 `toolMessageType` 把它分发到对应的 renderer：

- `TEXT` MUST 通过 `MarkdownContent` 渲染。
- `DSL` MUST 通过 `SimpleDslRenderer`（由 `DslRenderer` 重命名而来）渲染。
- `STREAM_DSL` MUST 通过 `StreamDslAnswerCard` 渲染，它以 `dataModel`、`response` 和 `isStreaming` props 包装 `@cloudsop/dsl-engine-web/genui-components` 的 `DSLRenderer`。
- `PIU` MUST 通过 `PiuMessage` 渲染。
- `ACTION` MUST 通过 `ActionCard` 渲染。
- `OPERATOR` MUST 通过 `OperatorButtons` 渲染。
- `FILE` MUST 通过 `FileCard` 渲染。

`src/features/chat/components/structured/DslRenderer.tsx` 中名为 `DslRenderer` 的组件 MUST 重命名为 `SimpleDslRenderer`，以避免与 `@cloudsop/dsl-engine-web/genui-components` 导出的 `DSLRenderer` 命名冲突。所有 import 位置 MUST 同步更新：`AnswerSegments.tsx`、`ExpandPanel.tsx` 以及相应测试文件。

#### Scenario: DSL segment 通过 SimpleDslRenderer 渲染

- **WHEN** 某个回答 segment 的 `toolMessageType` 为 "DSL"
- **THEN** 该 segment MUST 通过 `SimpleDslRenderer` 渲染
- **AND** `SimpleDslRenderer` MUST 把 `content` 以 `data={[content]}` 传给 `DSLEngine`

#### Scenario: STREAM_DSL segment 通过 StreamDslAnswerCard 渲染

- **WHEN** 某个回答 segment 的 `toolMessageType` 为 "STREAM_DSL"，累积内容为 `{ dataModel, dsl, isDone }`
- **THEN** 该 segment MUST 通过 `StreamDslAnswerCard` 渲染
- **AND** `StreamDslAnswerCard` MUST 把 `dataModel`、作为 `response` 的 `dsl`、以及作为 `isStreaming` 的 `!isDone` 传给来自 `@cloudsop/dsl-engine-web/genui-components` 的 `DSLRenderer`

#### Scenario: ExpandPanel 对 DSL 内容使用 SimpleDslRenderer

- **WHEN** ExpandPanel 渲染 `toolMessageType: "DSL"` 的内容
- **THEN** 它 MUST 使用 `SimpleDslRenderer`（而不是旧的 `DslRenderer` 名称）

## ADDED Requirements

### Requirement: STREAM_DSL 累积语义

`buildAnswerSegments` 函数 MUST 把连续的 `STREAM_DSL` ANSWER 事件累积为单个 segment。每个 `STREAM_DSL` 事件的 `content` 是一个带 `type` 字段的 JSON 对象，该字段决定累积行为：

1. `type: "dataModel"`：把 `content` 字段记录为 `dataModel`。若已有一个 STREAM_DSL segment 正在累积（前一个 stream 未被 `done` 关闭），前一个 segment MUST 被冲刷（以 `isDone: false` 渲染）并开启新的 segment。
2. `type: "dsl"`：把 `content` 字符串追加到已累积的 `dsl` 字符串。
3. `type: "done"`：把 `isDone` 设为 `true` 并冲刷该 segment。

一个 STREAM_DSL segment MUST 在以下情形被冲刷（加入 segments 数组）：
- 收到一个 `type: "done"` fragment。
- 在一个 segment 正在累积时收到新的 `type: "dataModel"` fragment。
- 遇到一个非 `STREAM_DSL` 事件。
- 事件流结束。

若从未收到 `type: "done"`（stream 被中断），该 segment MUST 仍以 `isDone: false` 冲刷，渲染已部分累积的内容。

STREAM_DSL 事件被保证在单个 `toolCallId` 内连续，MUST NOT 与其他 `toolMessageType` 事件交错。

累积后的 segment content MUST 具有以下形状：

```typescript
{
  dataModel: unknown,   // content from the dataModel fragment
  dsl: string,          // concatenation of all dsl fragment contents
  isDone: boolean       // true if done fragment was received
}
```

#### Scenario: 完整的 STREAM_DSL stream 累积为单个 segment

- **GIVEN** 连续的 `toolMessageType: "STREAM_DSL"` ANSWER 事件
- **WHEN** 事件按顺序到达：`{type:"dataModel",content:{fields:[]}}`、`{type:"dsl",content:"chunk1"}`、`{type:"dsl",content:"chunk2"}`、`{type:"done"}`
- **THEN** 回答 segments MUST 恰好包含一个 STREAM_DSL segment
- **AND** 该 segment content MUST 是 `{ dataModel: {fields:[]}, dsl: "chunk1chunk2", isDone: true }`

#### Scenario: 没有 done 的 STREAM_DSL stream 以 isDone false 冲刷

- **GIVEN** 连续的 `toolMessageType: "STREAM_DSL"` ANSWER 事件
- **WHEN** 事件到达：`{type:"dataModel",content:{...}}`、`{type:"dsl",content:"partial"}`，然后事件流在没有 `done` fragment 的情况下结束
- **THEN** 回答 segments MUST 包含一个 STREAM_DSL segment
- **AND** 该 segment content MUST 具有 `isDone: false` 和 `dsl: "partial"`

#### Scenario: 两个 STREAM_DSL stream 产生两个 segment

- **GIVEN** 同一 turn 中两个独立的 STREAM_DSL stream
- **WHEN** stream 1 以 `done` 完成，随后 stream 2 以新的 `dataModel` 开始
- **THEN** 回答 segments MUST 按顺序包含两个 STREAM_DSL segment
- **AND** 每个 segment MUST 拥有自己的 `dataModel`、`dsl` 和 `isDone`

#### Scenario: 被中断的 STREAM_DSL stream 在新 dataModel 到达时冲刷

- **GIVEN** 一个已开始但从未收到 `done` 的 STREAM_DSL stream
- **WHEN** 一个新的 `dataModel` fragment 到达（开启新 stream）
- **THEN** 前一个 segment MUST 以 `isDone: false` 冲刷
- **AND** MUST 以新的 `dataModel` 开启新的 segment

#### Scenario: STREAM_DSL 之后跟 TEXT 时冲刷 segment

- **GIVEN** 一个 STREAM_DSL stream 之后跟一个 TEXT ANSWER 事件
- **WHEN** 该 STREAM_DSL stream 已完成（收到 `done`）
- **THEN** STREAM_DSL segment MUST 在 TEXT segment 加入之前被冲刷

### Requirement: DSL Engine genui-components 集成

前端 MUST 从 `@cloudsop/dsl-engine-web/genui-components` import `DSLRenderer`、`StreamDSLContext` 和 `init`。vite 配置 MUST 在 dev 模式下把该 subpath alias 到本地 stub，并在生产构建中 alias 到真实 package subpath。

stub 模块 MUST 导出：
- `DSLRenderer`：渲染占位 div 的 no-op 组件。
- `StreamDSLContext`：透明渲染其 `children` 的 no-op React context Provider。
- `init`：no-op 函数。

既有的 `@cloudsop/dsl-engine-web/generateui` alias 及其 stub 文件 MUST 被移除。本变更之后，任何代码都 MUST NOT 引用 `@cloudsop/dsl-engine-web/generateui`。

#### Scenario: genui-components alias 在 vite 中配置

- **WHEN** vite 配置在 dev 模式下解析 `@cloudsop/dsl-engine-web/genui-components`
- **THEN** 它 MUST 解析到 `src/vendor/dsl-engine-genui-components-stub.tsx`
- **AND** 在生产模式下它 MUST 解析到真实 package subpath

#### Scenario: generateui alias 被移除

- **WHEN** vite 配置被更新
- **THEN** `@cloudsop/dsl-engine-web/generateui` alias MUST NOT 存在
- **AND** 文件 `src/vendor/dsl-engine-generateui-stub.tsx` MUST 被删除

### Requirement: DSL Engine init 调用

前端 MUST 在应用 bootstrap 期间、任何 React 渲染之前，恰好调用一次来自 `@cloudsop/dsl-engine-web/genui-components` 的 `init`。该调用 MUST 发生在 `renderRoot.tsx` 中 `loadRuntimeConfig()` 成功之后、`root.render(node)` 之前。

`init` 调用 MUST 是幂等的：若 `renderRoot` 被多次调用（例如 collaborative 模式的 `loadAIAgent` 和 `renderKnowledge`），`init` MUST 通过模块级 flag 只执行一次。

`init` 的参数 MUST 是：

```typescript
init({
  instanceId: "nextagent-dsl-instance",
  expandPanelId: EXPAND_PANEL_DIV_ID,
  handleExpandPanel: (open: boolean) => {
    if (open) { expandPanelStore.getState().open(); }
    else { expandPanelStore.getState().close(); }
  },
  handleConversation: () => {}
});
```

三个宿主入口（local、immersive、collaborative）MUST 都到达 `init` 调用，因为它们都经过 `renderRoot`。

#### Scenario: init 在首次渲染之前被调用

- **WHEN** `renderRoot` 第一次被调用
- **THEN** MUST 在 `loadRuntimeConfig` 成功之后调用 `init`
- **AND** MUST 在 `root.render` 之前调用 `init`

#### Scenario: init 在重复 renderRoot 调用时幂等

- **WHEN** `renderRoot` 被多次调用
- **THEN** `init` MUST 恰好被调用一次
- **AND** 后续调用 MUST 是 no-op

#### Scenario: init 接收 expand panel 配置

- **WHEN** `init` 被调用
- **THEN** `instanceId` MUST 是 `"nextagent-dsl-instance"`
- **AND** `expandPanelId` MUST 是 `EXPAND_PANEL_DIV_ID` 常量值
- **AND** `handleExpandPanel` MUST 通过 `expandPanelStore` 打开/关闭 expand panel
- **AND** `handleConversation` MUST 是一个 no-op 函数