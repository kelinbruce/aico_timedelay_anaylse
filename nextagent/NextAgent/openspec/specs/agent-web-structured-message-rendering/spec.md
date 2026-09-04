# agent-web-structured-message-rendering Specification

## Purpose

Define frontend handling and rendering of structured tool delta stream events, including process panel entries, answer mixed rendering, PIU/DSL integration and local fallbacks.
## Requirements
### Requirement: Stream Event Type Registration

`STREAM_EVENT_TYPES` in `agent-web/src/state/contracts.ts` MUST include `"TOOL_STRUCTURED_DELTA"`. `FRAME_BATCHABLE_EVENT_TYPES` in `useStreamConnection.ts` MUST include `"TOOL_STRUCTURED_DELTA"`.

#### Scenario: Frontend receives TOOL_STRUCTURED_DELTA

- **WHEN** the SSE/WebSocket stream delivers an envelope with `eventType: "TOOL_STRUCTURED_DELTA"`
- **THEN** the frontend MUST accept and process it without dropping or misclassifying the event

### Requirement: Non-TEXT messageType content is rendered by structured renderer in process panel

`DETAIL`、`SUB_DETAIL` 和 `SUB_CONCLUSION` 事件 MUST 按 `toolMessageType` 分发到结构化渲染组件，而不是全部存为 JSON 字符串纯文本。渲染行为对齐 ANSWER 的 `MessageType Renderer Components` requirement：TEXT 渲染为 Markdown、DSL 渲染为 DslRenderer、PIU 渲染为 PiuMessage、ACTION 渲染为 ActionCard、OPERATOR 渲染为 OperatorButtons、FILE 渲染为 FileCard。

非 TEXT content MUST NOT 以 `JSON.stringify(content)` 形式存入 `detail` 字符串。非 TEXT content MUST 只进入 `structuredSegments` 数组，由 `AnswerSegments` 组件按 `toolMessageType` 渲染。

#### Scenario: DETAIL with DSL messageType renders as chart
- **WHEN** a DETAIL event has `toolMessageType: "DSL"` with structured content
- **THEN** the content MUST be stored as a structured segment in `structuredSegments`
- **AND** the ProcessPanel MUST render it via DslRenderer (not as JSON text)

#### Scenario: DETAIL with PIU messageType renders as PIU component
- **WHEN** a DETAIL event has `toolMessageType: "PIU"`
- **THEN** the content MUST be stored as a structured segment and rendered via PiuMessage
- **AND** the content MUST NOT appear as JSON text in the detail string

#### Scenario: DETAIL with TEXT messageType still accumulates as text
- **WHEN** a DETAIL event has `toolMessageType: "TEXT"`
- **THEN** the content MUST enter both the `detail` string and a TEXT segment in `structuredSegments`
- **AND** the TEXT segment MUST render via MarkdownContent when structuredSegments is rendered

### Requirement: Circle Icon for SUB_TITLE Entries

The process panel MUST render a new circle icon for entries whose source `toolEventType` is `SUB_TITLE`. The icon MUST have dark and light variants (`circle-dark.svg`, `circle-light.svg`) located in `src/assets/process-icons/`.

#### Scenario: Circle icon selected for SUB_TITLE entry

- **WHEN** rendering a process panel entry whose source `toolEventType` is `SUB_TITLE`
- **THEN** the icon MUST be the circle icon variant for the current theme
- **AND** the icon MUST NOT be the `process-complete` or `think` icon

### Requirement: Answer Content Mixed Rendering

The answer content area MUST render both `LLM_CONTENT_DELTA` and `TOOL_STRUCTURED_DELTA` events with `toolEventType: "ANSWER"`, ordered by `sequence`. `LLM_CONTENT_DELTA` events MUST be merged as text. `TOOL_STRUCTURED_DELTA` ANSWER events MUST be rendered by dispatching to the appropriate `toolMessageType` renderer component.

For `toolMessageType: "PIU"` ANSWER events, when the event `content` carries a non-empty `uuid` string field, `buildAnswerSegments` MUST ensure only one PIU segment with that uuid exists in the result: after pushing the new PIU segment, any earlier PIU segment with the same `uuid` MUST be removed. The new segment MUST remain at its own `sequence` position. Segments between the removed and the new PIU segment (text or other structured types) MUST NOT be affected. When `uuid` is absent or empty, each PIU segment MUST be rendered independently, preserving the existing behavior. The `uuid` field MUST be extracted from `content` in both object and JSON-string form.

The `AnswerSegments` component MUST use a uuid-based React key (`structured-PIU-uuid-{uuid}`) for PIU segments carrying a non-empty `uuid`, so the `PiuMessage` component stays mounted across content updates and each PIU data event triggers a `piu.emit` call. PIU segments without `uuid` MUST use the existing sequence-based key (`structured-PIU-{sequence}`).

#### Scenario: LLM text and structured answer coexist

- **WHEN** a turn has both `LLM_CONTENT_DELTA` events and `TOOL_STRUCTURED_DELTA` ANSWER events
- **THEN** the answer content MUST render them interleaved by sequence order
- **AND** `LLM_CONTENT_DELTA` events MUST contribute text content
- **AND** `TOOL_STRUCTURED_DELTA` ANSWER events MUST contribute structured renderer components

#### Scenario: PIU with same uuid replaced by latest

- **GIVEN** two `TOOL_STRUCTURED_DELTA` ANSWER events with `toolMessageType: "PIU"` and the same non-empty `uuid` in `content`
- **WHEN** `buildAnswerSegments` processes both events
- **THEN** the result MUST contain exactly one PIU segment
- **AND** the segment MUST carry the content and sequence of the later event

#### Scenario: PIU replacement preserves intermediate segments

- **GIVEN** a PIU segment with `uuid: "X"`, followed by a TEXT segment, followed by another PIU segment with `uuid: "X"`
- **WHEN** `buildAnswerSegments` processes all events
- **THEN** the result MUST contain the TEXT segment and exactly one PIU segment
- **AND** the PIU segment MUST carry the content and sequence of the later PIU event

#### Scenario: PIU with different uuids not replaced

- **GIVEN** two PIU ANSWER events with different `uuid` values
- **WHEN** `buildAnswerSegments` processes both events
- **THEN** both PIU segments MUST be present in the result

#### Scenario: PIU without uuid not replaced

- **GIVEN** two PIU ANSWER events where neither `content` carries a `uuid` field
- **WHEN** `buildAnswerSegments` processes both events
- **THEN** both PIU segments MUST be present in the result

#### Scenario: PIU uuid extracted from JSON-string content

- **GIVEN** a PIU ANSWER event whose `content` is a JSON string containing `{ "uuid": "X", ... }`
- **WHEN** `buildAnswerSegments` processes the event
- **THEN** the `uuid` MUST be extracted from the parsed JSON string for replacement

#### Scenario: PIU with same uuid keeps PiuMessage mounted and emits each data

- **GIVEN** a rendered PIU segment with `uuid: "X"` and data A, followed by another PIU ANSWER event with `uuid: "X"` and data B
- **WHEN** `AnswerSegments` re-renders with the updated segments
- **THEN** the `PiuMessage` component MUST stay mounted (same React key based on uuid)
- **AND** `piu.emit` MUST be called with data B
- **AND** `piu.emit` MUST have been previously called with data A

### Requirement: MessageType Renderer Components

The `AnswerSegments` component MUST dispatch each structured segment to the appropriate renderer based on `toolMessageType`:

- `TEXT` MUST render via `MarkdownContent`.
- `DSL` MUST render via `SimpleDslRenderer` (renamed from `DslRenderer`).
- `STREAM_DSL` MUST render via `StreamDslAnswerCard`, which wraps `@cloudsop/dsl-engine-web/genui-components` `DSLRenderer` with `dataModel`, `response`, and `isStreaming` props.
- `PIU` MUST render via `PiuMessage`.
- `ACTION` MUST render via `ActionCard`.
- `OPERATOR` MUST render via `OperatorButtons`.
- `FILE` MUST render via `FileCard`.

The component named `DslRenderer` in `src/features/chat/components/structured/DslRenderer.tsx` MUST be renamed to `SimpleDslRenderer` to avoid naming conflict with `DSLRenderer` exported from `@cloudsop/dsl-engine-web/genui-components`. All import sites MUST be updated: `AnswerSegments.tsx`, `ExpandPanel.tsx`, and corresponding test files.

#### Scenario: DSL segment renders via SimpleDslRenderer

- **WHEN** an answer segment has `toolMessageType: "DSL"`
- **THEN** the segment MUST render via `SimpleDslRenderer`
- **AND** `SimpleDslRenderer` MUST pass `content` to `DSLEngine` as `data={[content]}`

#### Scenario: STREAM_DSL segment renders via StreamDslAnswerCard

- **WHEN** an answer segment has `toolMessageType: "STREAM_DSL"` with accumulated content `{ dataModel, dsl, isDone }`
- **THEN** the segment MUST render via `StreamDslAnswerCard`
- **AND** `StreamDslAnswerCard` MUST pass `dataModel`, `dsl` as `response`, and `!isDone` as `isStreaming` to `DSLRenderer` from `@cloudsop/dsl-engine-web/genui-components`

#### Scenario: ExpandPanel uses SimpleDslRenderer for DSL content

- **WHEN** the ExpandPanel renders content with `toolMessageType: "DSL"`
- **THEN** it MUST use `SimpleDslRenderer` (not the old `DslRenderer` name)

### Requirement: PIU Message Rendering

`PiuMessage` SHALL get the `piu` object from `PiuContext`, use `useId()` to generate a stable `wrapperId`, call `window.Prel.autoLoad(piuName, piuVersion)`, and then emit to the loaded PIU component. The emitted payload 默认形状 MUST 是 `{ ...content, wrapperId, containerId, handleExpandPanelOpen, handleExpandPanelClose, expandPanelId }`，即展开整个 content（含 `piuName`/`piuVersion`/`method`/`data`）并附加宿主字段；`wrapperId` 与 `containerId` 取相同值，`expandPanelId` 取固定常量。`handleExpandPanelOpen` 打开 expand panel 且不设置结构化内容，使 PIU 组件可直接渲染到 `expandPanelId`；`handleExpandPanelClose` 关闭 expand panel。

**受控例外：spread-data payload 形状**。对于 `piuName` 出现在前端 view 层编译期常量白名单 `SPREAD_DATA_PIU_NAMES` 中的 PIU（当前仅 `dte-bi-agent`），emit payload MUST 改为 `{ ...content.data, wrapperId, containerId, handleExpandPanelOpen, handleExpandPanelClose, expandPanelId }`，即只展开 `content.data` 的业务字段，MUST NOT 包含路由元信息 `piuName`/`piuVersion`/`method`。该例外用于适配既有 PIU handler 契约，后端 structuredPayload 不需改动。`SPREAD_DATA_PIU_NAMES` MUST 是编译期常量 `ReadonlySet<string>`，MUST NOT 接受运行时外部输入覆盖。`content.data` 来自不可信 stream（`parsePiuContent` 用 `as` 强转，无 runtime 校验），因此 spread-data 分支 MUST 只展开对象类型的 `data`；当 `content.data` 为 `null`、`undefined` 或非对象（字符串、数组、数字等）时，payload MUST 退化为仅含宿主字段，MUST NOT 产生来自非对象展开的 index key。当特例 PIU 数量增长时，SHALL 迁移为后端发声明字段并由前端按声明构造 payload，届时移除受控白名单。

两种形状下 `hostFields`（`wrapperId`/`containerId`/`handleExpandPanelOpen`/`handleExpandPanelClose`/`expandPanelId`）都 MUST 后置展开，确保宿主能力字段覆盖 `content` 或 `content.data` 中的同名 key。

Invalid `piuName`、缺失 `piu` 或缺失 `window.Prel` SHALL 渲染本地 fallback placeholder，且 MUST NOT 调用宿主 loader。

#### Scenario: PIU normal rendering with whole content payload

- **WHEN** `piuName` is valid and not in `SPREAD_DATA_PIU_NAMES`, and `piu` and `window.Prel` are available
- **THEN** the component MUST call `window.Prel.autoLoad(piuName, piuVersion)`
- **AND** after loading succeeds it MUST call `piu.emit(method, payload)`
- **AND** payload MUST contain all fields of `content` (including `piuName`, `piuVersion`, `method`, `data`) plus `wrapperId`, `containerId`, `handleExpandPanelOpen`, `handleExpandPanelClose`, and `expandPanelId`

#### Scenario: PIU in spread-data allowlist emits flattened data

- **GIVEN** `piuName` is `"dte-bi-agent"` (a member of `SPREAD_DATA_PIU_NAMES`)
- **WHEN** the component emits the payload
- **THEN** payload MUST be `{ ...content.data, wrapperId, containerId, handleExpandPanelOpen, handleExpandPanelClose, expandPanelId }`
- **AND** payload MUST NOT contain top-level `piuName`, `piuVersion`, or `method`

#### Scenario: spread-data payload degrades to host fields when data is absent

- **GIVEN** `piuName` is in `SPREAD_DATA_PIU_NAMES` and `content.data` is `null`, `undefined`, or a non-object value (string, array, number)
- **WHEN** the component emits the payload
- **THEN** payload MUST contain only `wrapperId`, `containerId`, `handleExpandPanelOpen`, `handleExpandPanelClose`, and `expandPanelId`
- **AND** payload MUST NOT contain index keys produced by spreading a non-object

#### Scenario: host fields override same-named content keys

- **GIVEN** `content.data` contains a key `wrapperId` with value `"evil"`
- **WHEN** the component emits the payload in either whole or spread-data shape
- **THEN** the payload `wrapperId` MUST equal the `useId()`-generated value, not `"evil"`

#### Scenario: PIU calls handleExpandPanelOpen

- **WHEN** the PIU component calls `handleExpandPanelOpen()`
- **THEN** the expand panel MUST open
- **AND** the `expandPanelId` div MUST be available for PIU rendering

#### Scenario: PIU calls handleExpandPanelClose

- **WHEN** the PIU component calls `handleExpandPanelClose()`
- **THEN** the expand panel MUST close

#### Scenario: PIU unavailable fallback

- **WHEN** `piuName` is invalid, `piu` is null, or `window.Prel` is unavailable
- **THEN** the component MUST render a fallback placeholder

### Requirement: PiuContext Provider

The frontend MUST provide a `PiuContext` that exposes `piu` (of type `PIU | null`) and `site` (of type `HostSiteContext`) to any descendant component. All three entry points (`local.tsx`, `immersive.tsx`, `registerAIAgentPIU.tsx`) MUST populate `PiuContext` with the `piu` and `site` obtained from `prel.start` callback.

#### Scenario: Immersive entry populates PiuContext

- **WHEN** the immersive entry calls `prel.start(name, version, deps, (piu, site) => ...)`
- **THEN** the `piu` and `site` MUST be set into `PiuContext.Provider` value
- **AND** descendant components MUST be able to read `piu` via `useContext(PiuContext)`

#### Scenario: PIU collaborative entry populates PiuContext

- **WHEN** the PIU collaborative entry calls `prel.start(name, version, deps, (piu, site) => ...)`
- **THEN** the `piu` and `site` MUST be set into `PiuContext.Provider` value via the runtime store or direct state

#### Scenario: Local entry uses mock Prel

- **WHEN** the local entry (`local.tsx`) starts in dev mode
- **THEN** `installMockPrel()` MUST be called before render to inject `window.Prel` with mock implementations
- **AND** `prel.start` callback MUST receive `mockPiu` and `mockSite`
- **AND** `PiuContext` MUST be populated with `mockPiu` and `mockSite`

### Requirement: Mock Prel for Local Development

The frontend MUST provide a `prel-mock.ts` module that exports `mockPrel`, `mockPiu`, `mockSite`, and `installMockPrel()`. The mock `Prel.start` MUST synchronously invoke the callback with `mockPiu` and `mockSite`. The mock `Prel.autoLoad` MUST return a resolved promise. The mock `piu.emit` MUST be a no-op with `console.debug` logging. The mock `piu.attach` MUST be a no-op.

#### Scenario: Mock Prel installed in local mode

- **WHEN** `installMockPrel()` is called and `window.Prel` is not already set
- **THEN** `window.Prel` MUST be set to `mockPrel`
- **AND** subsequent `prel.start` calls MUST invoke the callback with `mockPiu` and `mockSite`

#### Scenario: Mock Prel not overriding real Prel

- **WHEN** `installMockPrel()` is called and `window.Prel` is already set
- **THEN** `window.Prel` MUST NOT be overridden

### Requirement: PIU Type Definition Update

The `PIU` interface in `host/prel.ts` MUST be updated to match the actual host framework contract. The `attach` method MUST accept a typed object with optional `$stateChange` and `userAction` fields, not `Record<string, unknown>`.

#### Scenario: PIU attach accepts typed handlers

- **WHEN** calling `piu.attach(piu, handlers)`
- **THEN** the `handlers` parameter MUST be typed as `{ $stateChange?: Dictionary<(newValue: any, oldValue: any) => void>; userAction?: { febsMemuEvent?: (params: { event: string; type: string }) => void; logout?: () => void; } }`

### Requirement: DSL Vite Alias Stub

The vite configuration MUST alias `@cloudsop/dsl-engine-web` to a local stub component in dev mode and to the real package in production builds. The stub MUST export a `DSLEngine` function component that renders a placeholder.

The vite configuration MUST additionally alias the subpath `@cloudsop/dsl-engine-web/generateui` to a separate local stub module in dev mode and to the real package subpath in production builds. The generateui stub MUST export a `StreamDSLContext` React context Provider component that transparently renders its `children` without injecting any context value (no-op passthrough). The two aliases MUST be independent: the `@cloudsop/dsl-engine-web` alias MUST NOT be affected by the addition of the `@cloudsop/dsl-engine-web/generateui` alias, and existing `DSLEngine` resolution behavior MUST remain unchanged.

#### Scenario: Local dev mode resolves to stub

- **WHEN** vite dev server starts in local mode
- **THEN** `import { DSLEngine } from "@cloudsop/dsl-engine-web"` MUST resolve to the stub component
- **AND** the stub MUST render a visible placeholder without errors

#### Scenario: Production build resolves to real package

- **WHEN** vite builds for production
- **THEN** `import { DSLEngine } from "@cloudsop/dsl-engine-web"` MUST resolve to the real `@cloudsop/dsl-engine-web` package
- **AND** the build MUST fail if the package is not installed

#### Scenario: generateui subpath resolves to separate stub in dev

- **WHEN** vite dev server starts in local mode
- **THEN** `import { StreamDSLContext } from "@cloudsop/dsl-engine-web/generateui"` MUST resolve to a separate stub module
- **AND** the stub `StreamDSLContext` MUST render its children without injecting any context value

#### Scenario: generateui subpath resolves to real package in production

- **WHEN** vite builds for production
- **THEN** `import { StreamDSLContext } from "@cloudsop/dsl-engine-web/generateui"` MUST resolve to the real `@cloudsop/dsl-engine-web/generateui` subpath
- **AND** the build MUST fail if the package or subpath is not available

#### Scenario: Existing DSLEngine alias unaffected by generateui alias

- **GIVEN** the `@cloudsop/dsl-engine-web/generateui` alias has been added
- **WHEN** resolving `import { DSLEngine } from "@cloudsop/dsl-engine-web"`
- **THEN** resolution MUST be identical to before the generateui alias was added
- **AND** existing DSL rendering behavior MUST NOT change

### Requirement: STREAM_DSL Accumulation Semantics

The `buildAnswerSegments` function MUST accumulate consecutive `STREAM_DSL` ANSWER events into a single segment. The `content` of each `STREAM_DSL` event is a JSON object with a `type` field that determines the accumulation behavior:

1. `type: "dataModel"`: Records the `content` field as `dataModel`. If a STREAM_DSL segment is already being accumulated (previous stream not closed by `done`), the previous segment MUST be flushed (rendered with `isDone: false`) and a new segment started.
2. `type: "dsl"`: Appends the `content` string to the accumulated `dsl` string.
3. `type: "done"`: Sets `isDone` to `true` and flushes the segment.

A STREAM_DSL segment MUST be flushed (added to the segments array) when:
- A `type: "done"` fragment is received.
- A new `type: "dataModel"` fragment is received while a segment is already accumulating.
- A non-`STREAM_DSL` event is encountered.
- The event stream ends.

If `type: "done"` is never received (stream interrupted), the segment MUST still be flushed with `isDone: false`, rendering the partially accumulated content.

STREAM_DSL events are guaranteed to be consecutive within a single `toolCallId` and MUST NOT be interleaved with other `toolMessageType` events.

The accumulated segment content MUST have the shape:

```typescript
{
  dataModel: unknown,   // content from the dataModel fragment
  dsl: string,          // concatenation of all dsl fragment contents
  isDone: boolean       // true if done fragment was received
}
```

#### Scenario: Complete STREAM_DSL stream accumulates into single segment

- **GIVEN** consecutive ANSWER events with `toolMessageType: "STREAM_DSL"`
- **WHEN** events arrive in order: `{type:"dataModel",content:{fields:[]}}`, `{type:"dsl",content:"chunk1"}`, `{type:"dsl",content:"chunk2"}`, `{type:"done"}`
- **THEN** the answer segments MUST contain exactly one STREAM_DSL segment
- **AND** the segment content MUST be `{ dataModel: {fields:[]}, dsl: "chunk1chunk2", isDone: true }`

#### Scenario: STREAM_DSL stream without done flushes with isDone false

- **GIVEN** consecutive ANSWER events with `toolMessageType: "STREAM_DSL"`
- **WHEN** events arrive: `{type:"dataModel",content:{...}}`, `{type:"dsl",content:"partial"}`, then the event stream ends without a `done` fragment
- **THEN** the answer segments MUST contain one STREAM_DSL segment
- **AND** the segment content MUST have `isDone: false` and `dsl: "partial"`

#### Scenario: Two STREAM_DSL streams produce two segments

- **GIVEN** two independent STREAM_DSL streams in the same turn
- **WHEN** stream 1 completes with `done`, then stream 2 starts with a new `dataModel`
- **THEN** the answer segments MUST contain two STREAM_DSL segments in order
- **AND** each segment MUST have its own `dataModel`, `dsl`, and `isDone`

#### Scenario: Interrupted STREAM_DSL stream flushes on new dataModel

- **GIVEN** a STREAM_DSL stream that started but never received `done`
- **WHEN** a new `dataModel` fragment arrives (starting a new stream)
- **THEN** the previous segment MUST be flushed with `isDone: false`
- **AND** a new segment MUST start with the new `dataModel`

#### Scenario: STREAM_DSL followed by TEXT flushes segment

- **GIVEN** a STREAM_DSL stream followed by a TEXT ANSWER event
- **WHEN** the STREAM_DSL stream is complete (received `done`)
- **THEN** the STREAM_DSL segment MUST be flushed before the TEXT segment is added

### Requirement: DSL Engine genui-components Integration

The frontend MUST import `DSLRenderer`, `StreamDSLContext`, and `init` from `@cloudsop/dsl-engine-web/genui-components`. The vite configuration MUST alias this subpath to a local stub in dev mode and to the real package subpath in production builds.

The stub module MUST export:
- `DSLRenderer`: a no-op component rendering a placeholder div.
- `StreamDSLContext`: a no-op React context Provider that transparently renders its `children`.
- `init`: a no-op function.

The existing `@cloudsop/dsl-engine-web/generateui` alias and its stub file MUST be removed. No code MUST reference `@cloudsop/dsl-engine-web/generateui` after this change.

#### Scenario: genui-components alias configured in vite

- **WHEN** the vite config resolves `@cloudsop/dsl-engine-web/genui-components` in dev mode
- **THEN** it MUST resolve to `src/vendor/dsl-engine-genui-components-stub.tsx`
- **AND** in production mode it MUST resolve to the real package subpath

#### Scenario: generateui alias removed

- **WHEN** the vite config is updated
- **THEN** the `@cloudsop/dsl-engine-web/generateui` alias MUST NOT exist
- **AND** the file `src/vendor/dsl-engine-generateui-stub.tsx` MUST be deleted

### Requirement: DSL Engine init Call

The frontend MUST call `init` from `@cloudsop/dsl-engine-web/genui-components` exactly once during application bootstrap, before any React rendering. The call MUST occur in `renderRoot.tsx` after `loadRuntimeConfig()` succeeds and before `root.render(node)`.

The `init` call MUST be idempotent: if `renderRoot` is called multiple times (e.g., collaborative mode's `loadAIAgent` and `renderKnowledge`), `init` MUST execute only once via a module-level flag.

The `init` parameters MUST be:

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

All three host entry points (local, immersive, collaborative) MUST reach the `init` call because they all pass through `renderRoot`.

#### Scenario: init called before first render

- **WHEN** `renderRoot` is called for the first time
- **THEN** `init` MUST be called after `loadRuntimeConfig` succeeds
- **AND** `init` MUST be called before `root.render`

#### Scenario: init idempotent on repeated renderRoot calls

- **WHEN** `renderRoot` is called multiple times
- **THEN** `init` MUST be called exactly once
- **AND** subsequent calls MUST be no-ops

#### Scenario: init receives expand panel configuration

- **WHEN** `init` is called
- **THEN** `instanceId` MUST be `"nextagent-dsl-instance"`
- **AND** `expandPanelId` MUST be the `EXPAND_PANEL_DIV_ID` constant value
- **AND** `handleExpandPanel` MUST open/close the expand panel via `expandPanelStore`
- **AND** `handleConversation` MUST be a no-op function
