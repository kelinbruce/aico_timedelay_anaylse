## MODIFIED Requirements

### Requirement: Process Panel Entry Generation

`buildProcessEntries()`（display 版）MUST handle `TOOL_STRUCTURED_DELTA` events by generating process panel entries based on `toolEventType`. Multiple `TOOL_STRUCTURED_DELTA` events with the same `toolCallId` MUST all be appended.

`TITLE` events MUST create a new `ProcessEntry` with `toolEventType: "TITLE"`, `detail: ""`, `rawDetail: ""` and set it as the most recent TITLE entry. `SUB_TITLE` events MUST create a new `ProcessEntry` with `toolEventType: "SUB_TITLE"` and set it as the most recent SUB_TITLE entry.

`TITLE` and `SUB_TITLE` entries MUST be indexed by the first non-empty stable correlation field in this order: `toolCallId`, `invocationId`, `metadata.invocationId`, `capabilityId`. `DETAIL` events carrying a stable correlation field MUST accumulate only into the matching TITLE entry. `SUB_DETAIL` and `SUB_CONCLUSION` events carrying a stable correlation field MUST accumulate only into the matching SUB_TITLE entry. A correlated event with no matching title MUST be ignored instead of falling back to another node. Only events without any stable correlation field MAY fall back to the most recent TITLE or SUB_TITLE for legacy compatibility. Accumulation produces two parallel fields:

- `detail` 字符串：只累积 `toolMessageType === "TEXT"` 的 content，用于摘要生成、长文本检测、可展开性判断和 Markdown 渲染判断。非 TEXT content MUST NOT 进入 `detail` 字符串。
- `structuredSegments: readonly AnswerSegment[]`：承载按 `toolMessageType` 分段的结构化内容。累积语义对齐 ANSWER 的 `buildAnswerSegments`：TEXT 段与上一个 TEXT segment 相邻时做字符串拼接合并；非 TEXT 段（DSL/PIU/ACTION/OPERATOR/FILE）每个事件独立成段堆叠不替换；`toolMessageType` 变化 MUST 打断 TEXT 拼接链。

当 `structuredSegments` 非空时，`ProcessPanel` detail 渲染区 MUST 用 `AnswerSegments` 组件渲染该数组，复用 `answerContent.ts` 的 `AnswerSegment` 类型和 `AnswerSegments.tsx` 组件，按 `toolMessageType` 分发到 MarkdownContent/DslRenderer/PiuMessage/ActionCard/OperatorButtons/FileCard。当 `structuredSegments` 为空或不存在时，MUST 走现有 `shouldRenderProcessDetailAsMarkdown ? MarkdownContent : pre-wrap div` 逻辑。

`ANSWER` events MUST NOT create a process panel entry and MUST route to the answer content area. `EXPAND_PANEL` events MUST NOT create an independent process panel entry. A correlated `EXPAND_PANEL` MUST attach only to the matching TITLE entry; an uncorrelated legacy event MAY attach to the most recent TITLE. If no eligible TITLE exists, the event MUST be ignored.

During live/history envelope merging, two `TOOL_STRUCTURED_DELTA` events with the same attempt, event type and sequence MUST remain distinct when their `toolEventType` or stable correlation identifier differs. When same-sequence events share a stable correlation identifier, `TITLE` and `SUB_TITLE` MUST be projected before their associated detail events regardless of input array order.

`buildProcessTimelineEntries()`（timeline 版）MUST NOT be changed by this requirement; its output `ProcessTimelineContent` is not rendered and timeline only uses entry count.

#### Scenario: TITLE creates a new process panel entry
- **WHEN** a `TOOL_STRUCTURED_DELTA` event arrives with `toolEventType: "TITLE"`
- **THEN** a new `ProcessEntry` MUST be created with `toolEventType: "TITLE"`, empty `detail`, empty `structuredSegments`, and `title` set to the event `content`
- **AND** the entry MUST NOT be merged into a preceding CAPABILITY_* entry

#### Scenario: TEXT DETAIL accumulates into detail string and structuredSegments
- **GIVEN** the most recent TITLE entry exists with empty `detail` and empty `structuredSegments`
- **WHEN** a `TOOL_STRUCTURED_DELTA` event arrives with `toolEventType: "DETAIL"` and `toolMessageType: "TEXT"` and content `"chart-1\n"`
- **THEN** the TITLE entry `detail` MUST become `"chart-1\n"`
- **AND** the TITLE entry `structuredSegments` MUST contain one TEXT segment with content `"chart-1\n"`

#### Scenario: Non-TEXT DETAIL accumulates only into structuredSegments
- **GIVEN** the most recent TITLE entry exists
- **WHEN** a `TOOL_STRUCTURED_DELTA` event arrives with `toolEventType: "DETAIL"` and `toolMessageType: "DSL"` and structured content
- **THEN** the TITLE entry `structuredSegments` MUST contain one DSL segment with the structured content
- **AND** the TITLE entry `detail` MUST remain unchanged (non-TEXT content MUST NOT enter detail string)

#### Scenario: Mixed TEXT and non-TEXT DETAIL accumulate in order
- **GIVEN** the most recent TITLE entry exists
- **WHEN** DETAIL events arrive in sequence: TEXT `"intro\n"`, DSL `{...}`, TEXT `"outro\n"`
- **THEN** the TITLE entry `detail` MUST equal `"intro\noutro\n"` (only TEXT portions concatenated)
- **AND** the TITLE entry `structuredSegments` MUST contain three segments in order: TEXT, DSL, TEXT

#### Scenario: Adjacent TEXT DETAIL segments merge
- **GIVEN** the most recent TITLE entry has a structuredSegments array ending with a TEXT segment `"part1"`
- **WHEN** a DETAIL event arrives with `toolMessageType: "TEXT"` and content `"part2"`
- **THEN** the last TEXT segment in `structuredSegments` MUST be updated to `"part1part2"` (merged)
- **AND** no new segment MUST be appended

#### Scenario: messageType change breaks TEXT merge chain
- **GIVEN** the most recent TITLE entry has a structuredSegments array ending with a TEXT segment
- **WHEN** a DETAIL event arrives with `toolMessageType: "DSL"`
- **THEN** a new DSL segment MUST be appended (messageType change breaks TEXT concatenation)

#### Scenario: SUB_TITLE creates a new entry with circle icon
- **WHEN** a `TOOL_STRUCTURED_DELTA` event arrives with `toolEventType: "SUB_TITLE"`
- **THEN** a new `ProcessEntry` MUST be created with `toolEventType: "SUB_TITLE"` and a circle icon

#### Scenario: SUB_DETAIL accumulates into the nearest SUB_TITLE entry
- **WHEN** a `TOOL_STRUCTURED_DELTA` event arrives with `toolEventType: "SUB_DETAIL"`
- **THEN** the content MUST accumulate into the `detail` (TEXT only) and `structuredSegments` of the most recently created SUB_TITLE entry

#### Scenario: SUB_CONCLUSION accumulates into the nearest SUB_TITLE entry
- **WHEN** a `TOOL_STRUCTURED_DELTA` event arrives with `toolEventType: "SUB_CONCLUSION"`
- **THEN** the content MUST accumulate into the `detail` (TEXT only) and `structuredSegments` of the most recently created SUB_TITLE entry

#### Scenario: Interleaved correlated DETAIL events update their own TITLE
- **GIVEN** TITLE entries exist for `toolCallId: "workflow:root"` and `toolCallId: "workflow:action"`
- **WHEN** DETAIL events for those toolCallIds arrive interleaved
- **THEN** each DETAIL MUST update only the TITLE with the same toolCallId

#### Scenario: Correlated DETAIL without TITLE is ignored
- **GIVEN** a TITLE exists for `toolCallId: "workflow:root"`
- **WHEN** a DETAIL arrives for `toolCallId: "workflow:action"` and no matching TITLE exists
- **THEN** the DETAIL MUST NOT be attached to the root TITLE

#### Scenario: Legacy uncorrelated DETAIL uses nearest TITLE
- **GIVEN** multiple TITLE entries exist
- **WHEN** a DETAIL without toolCallId, invocationId, metadata.invocationId or capabilityId arrives
- **THEN** it MAY accumulate into the most recently created TITLE

#### Scenario: Same-sequence TITLE and DETAIL survive envelope merge
- **WHEN** TITLE and DETAIL events have the same attempt, event type and sequence but different toolEventType values
- **THEN** both events MUST remain available to the process projection
- **AND** the TITLE MUST be processed before the DETAIL even when the input array contains DETAIL first

#### Scenario: ANSWER does not create a process panel entry
- **WHEN** a `TOOL_STRUCTURED_DELTA` event arrives with `toolEventType: "ANSWER"`
- **THEN** no entry MUST be created in the process panel
- **AND** the event MUST be routed to the answer content area instead

#### Scenario: EXPAND_PANEL attaches to nearest TITLE
- **GIVEN** the most recent TITLE entry exists
- **WHEN** a `TOOL_STRUCTURED_DELTA` event arrives with `toolEventType: "EXPAND_PANEL"`
- **THEN** the TITLE entry `expandPanelData` MUST be set and `hasExpandPanel` MUST be true
- **AND** no new entry MUST be created

#### Scenario: structuredSegments rendered by AnswerSegments component
- **GIVEN** a TITLE entry has non-empty `structuredSegments` containing a DSL segment and a TEXT segment
- **WHEN** the ProcessPanel renders the entry detail area
- **THEN** the `AnswerSegments` component MUST be rendered
- **AND** the DSL segment MUST render via DslRenderer and the TEXT segment via MarkdownContent

#### Scenario: Empty structuredSegments falls back to detail rendering
- **GIVEN** a TITLE entry has empty or absent `structuredSegments` but non-empty `detail`
- **WHEN** the ProcessPanel renders the entry detail area
- **THEN** the existing `shouldRenderProcessDetailAsMarkdown ? MarkdownContent : pre-wrap div` logic MUST apply

### Requirement: Answer Content Mixed Rendering

The answer content area MUST render `LLM_CONTENT_DELTA` and `TOOL_STRUCTURED_DELTA` events with `toolEventType: "ANSWER"` in sequence order. Structured ANSWER events MUST dispatch to the appropriate `toolMessageType` renderer. When an LLM answer text is exactly equal to a structured TEXT ANSWER in the same turn, the frontend MUST render that text once through the structured TEXT renderer and MUST suppress the duplicate LLM projection. Distinct LLM text and non-TEXT structured answers MUST continue to coexist.

#### Scenario: Duplicate LLM and structured TEXT answer renders once
- **WHEN** a turn contains a structured TEXT ANSWER and an LLM answer with exactly the same text
- **THEN** the answer area MUST contain one structured TEXT segment for that text
- **AND** MUST NOT append a second LLM text segment with the same content

#### Scenario: Distinct LLM text and structured answer coexist
- **WHEN** the LLM answer text differs from the structured ANSWER content
- **THEN** both MUST render in sequence order

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
