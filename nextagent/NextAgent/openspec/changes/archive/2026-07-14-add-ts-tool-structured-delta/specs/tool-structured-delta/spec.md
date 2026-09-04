# tool-structured-delta Specification

## ADDED Requirements

### Requirement: TOOL_STRUCTURED_DELTA Timeline Event Type

The system MUST add `"TOOL_STRUCTURED_DELTA"` to `TimelineEventType` in `agent-common`. The event MUST carry `capabilityId`, `toolCallId`, `toolEventType`, `toolMessageType`, and `content` in its `inlinePayload`.

#### Scenario: Structured event emitted for CLIP API result

- **WHEN** a CLIP-backed tool returns a `structuredPayload` matching `{eventType, content, messageType}` shape
- **THEN** the tool-loop MUST emit a `TOOL_STRUCTURED_DELTA` timeline event with the original `eventType` mapped to `toolEventType`, `messageType` mapped to `toolMessageType`, and the original `content` preserved
- **AND** the event MUST include `capabilityId` and `toolCallId` for correlation with `CAPABILITY_STARTED` and `CAPABILITY_COMPLETED`

#### Scenario: Pure string result emitted as ANSWER TEXT（DEFERRED）

- **WHEN** a CLIP-backed tool returns a `structuredPayload` that is a `string`
- **THEN** the tool-loop MUST emit a `TOOL_STRUCTURED_DELTA` event with `toolEventType: "ANSWER"`, `toolMessageType: "TEXT"`, and `content` set to the string value
- **NOTE**: This scenario is deferred because `CapabilityInvocationResult.structuredPayload` is typed as `JsonObject`, not `string`. Enabling it requires either relaxing `assertCapabilityResultSafe` for CLIP sources, or wrapping the string as `{eventType:"ANSWER", messageType:"TEXT", content: string}` in the CLIP runner layer. See design.md §7 (Not in scope).

#### Scenario: Plain JSON result does not emit TOOL_STRUCTURED_DELTA

- **WHEN** a CLIP-backed tool returns a `structuredPayload` that is a JSON object but does NOT match the structured event shape
- **THEN** the tool-loop MUST NOT emit any `TOOL_STRUCTURED_DELTA` event
- **AND** the result MUST fall through to the existing `CAPABILITY_RESULT_DELTA` channel

#### Scenario: Non-CLIP results never emit TOOL_STRUCTURED_DELTA

- **WHEN** a non-CLIP tool (Bash, Read, Write, Skill, Agent, etc.) returns a result
- **THEN** the tool-loop MUST NOT emit any `TOOL_STRUCTURED_DELTA` event regardless of payload shape
- **AND** the existing `CAPABILITY_RESULT_DELTA` flow MUST remain unchanged

### Requirement: CLIP Provider Identification

The tool-loop MUST only attempt structured delta identification when the capability descriptor's provider has `providerKind === "CUSTOM"` and `providerType === "clip_server"`. All other provider types MUST skip structured delta identification entirely.

#### Scenario: CLIP provider triggers structured identification

- **WHEN** the resolved capability descriptor has `provider.providerKind === "CUSTOM"` and `provider.providerType === "clip_server"`
- **THEN** the tool-loop MUST attempt structured delta identification on the result payload

#### Scenario: Non-CLIP provider skips structured identification

- **WHEN** the resolved capability descriptor has a provider that is not `clip_server`
- **THEN** the tool-loop MUST NOT attempt structured delta identification
- **AND** no `TOOL_STRUCTURED_DELTA` event MUST be emitted

### Requirement: Structured Event Shape Validation

The tool-loop MUST validate the structured event shape before emitting `TOOL_STRUCTURED_DELTA`. The `toolEventType` field (mapped from `eventType`) MUST be one of `TITLE`, `DETAIL`, `ANSWER`, `SUB_TITLE`, `SUB_DETAIL`, `SUB_CONCLUSION`. The `toolMessageType` field (mapped from `messageType`) MUST be one of `PIU`, `DSL`, `ACTION`, `OPERATOR`, `FILE`, `TEXT`. The `content` field MUST be present. If validation fails, the result MUST fall back to the existing `CAPABILITY_RESULT_DELTA` channel.

#### Scenario: Invalid eventType rejected

- **WHEN** a CLIP result has `eventType: "UNKNOWN"` and `messageType: "TEXT"`
- **THEN** the tool-loop MUST NOT emit `TOOL_STRUCTURED_DELTA`
- **AND** the result MUST fall back to `CAPABILITY_RESULT_DELTA`

#### Scenario: Invalid messageType rejected

- **WHEN** a CLIP result has `eventType: "ANSWER"` and `messageType: "UNKNOWN"`
- **THEN** the tool-loop MUST NOT emit `TOOL_STRUCTURED_DELTA`
- **AND** the result MUST fall back to `CAPABILITY_RESULT_DELTA`

### Requirement: TOOL_STRUCTURED_DELTA Does Not Replace CAPABILITY_RESULT_DELTA

The `TOOL_STRUCTURED_DELTA` event MUST NOT replace the existing `CAPABILITY_RESULT_DELTA` emission or `appendCapabilityResultMessage` call. Both events MUST be emitted for CLIP structured results. The `CAPABILITY_RESULT_DELTA` carries the full `structuredPayload` for model visibility; the `TOOL_STRUCTURED_DELTA` carries parsed structured data for frontend rendering.

#### Scenario: Both events emitted for structured CLIP result

- **WHEN** a CLIP-backed tool returns a valid structured event
- **THEN** the tool-loop MUST emit `TOOL_STRUCTURED_DELTA` with the parsed event data
- **AND** the tool-loop MUST also emit `CAPABILITY_RESULT_DELTA` with the full `structuredPayload`
- **AND** the tool-loop MUST call `appendCapabilityResultMessage` to store the full result for model visibility

### Requirement: Single Storage With History Reconstruction

The system MUST store only one copy of the CLIP result via the existing `appendCapabilityResultMessage`. The `TOOL_STRUCTURED_DELTA` event MUST NOT produce a separate persisted message. Conversation history reconstruction MUST detect the structured event shape in stored `CAPABILITY_RESULT` messages and reconstruct `TOOL_STRUCTURED_DELTA` envelopes accordingly.

#### Scenario: History reconstructs TOOL_STRUCTURED_DELTA from stored payload

- **WHEN** loading conversation history and a stored `CAPABILITY_RESULT` message contains a payload matching `{eventType, content, messageType}` shape
- **THEN** the conversation adapter MUST produce a `TOOL_STRUCTURED_DELTA` envelope
- **AND** the envelope MUST preserve `toolEventType`, `toolMessageType`, and `content`

#### Scenario: History reconstructs CAPABILITY_RESULT_DELTA for non-structured payload

- **WHEN** loading conversation history and a stored `CAPABILITY_RESULT` message payload does NOT match the structured event shape
- **THEN** the conversation adapter MUST produce a `CAPABILITY_RESULT_DELTA` envelope using the existing logic

#### Scenario: History reconstructs TOOL_STRUCTURED_DELTA for string payload（DEFERRED）

- **WHEN** loading conversation history and a stored `CAPABILITY_RESULT` message contains a string payload from a CLIP tool
- **THEN** the conversation adapter MUST produce a `TOOL_STRUCTURED_DELTA` envelope with `toolEventType: "ANSWER"`, `toolMessageType: "TEXT"`
- **NOTE**: Deferred alongside the corresponding tool-loop emission scenario. `structuredPayload` is typed as `JsonObject`, so string payloads cannot exist in stored `CAPABILITY_RESULT` messages at present.

### Requirement: Stream Envelope Projection

The stream-envelope projection layer MUST include `TOOL_STRUCTURED_DELTA` in `streamVisibleTimelineEvents`. The projection MUST pass through `toolEventType`, `toolMessageType`, `content`, `capabilityId`, and `toolCallId` into the SSE/WebSocket envelope payload.

#### Scenario: TOOL_STRUCTURED_DELTA projected to stream envelope

- **WHEN** a `TOOL_STRUCTURED_DELTA` RunTimelineEvent is emitted
- **THEN** the stream-envelope projection MUST produce a `StreamEnvelope` with `eventType: "TOOL_STRUCTURED_DELTA"`
- **AND** the payload MUST contain `toolEventType`, `toolMessageType`, `content`, `capabilityId`, and `toolCallId`

### Requirement: StreamEventType Contract Update

`StreamEventType` in `agent-contracts/channel` and `STREAM_EVENT_TYPES` in `agent-web/src/state/contracts.ts` MUST include `"TOOL_STRUCTURED_DELTA"`.

#### Scenario: StreamEventType includes new event

- **WHEN** checking `StreamEventType` in channel contracts
- **THEN** it MUST include `"TOOL_STRUCTURED_DELTA"`

### Requirement: Security Constraints

The `TOOL_STRUCTURED_DELTA` content MUST NOT contain credentials, tokens, raw provider errors, file paths, or prompt text. The `toolMessageType` validation MUST reject unknown types before emission. The `content` field for ACTION and OPERATOR types MUST be a JSON string whose `data` field is an object string safe to `JSON.parse` on the client side.

#### Scenario: Content with credentials rejected

- **WHEN** a CLIP structured event content contains `api_key`, `authorization`, `credential`, `password`, `secret`, or `token` patterns
- **THEN** the tool-loop MUST NOT emit `TOOL_STRUCTURED_DELTA` for that event
- **AND** the result MUST fall back to `CAPABILITY_RESULT_DELTA` with the full payload (model still sees it)
﻿
### Requirement: Workflow Visible Delta Level

`agent-contracts/core` 中的 `WorkflowVisibleDelta` 必须接受可选 `level` 字段，类型为 `ToolEventType`。当存在时，`WorkflowRuntimeEventProjector` 必须发送 `TOOL_STRUCTURED_DELTA` 事件（内容为 fragment，非累积），而不是 `LLM_CONTENT_DELTA`。 `level` 字段必须被 `WorkflowVisibleDeltaSchema` 校验（`additionalProperties: false`）。

#### Scenario: 携带 level 的流式 delta 发送 TOOL_STRUCTURED_DELTA fragment

- **WHEN** workflow 节点发送 `NODE_OUTPUT_DELTA` 且 `visibleDelta.level` 为有效 `ToolEventType`
- **THEN** projector 必须发送 `TOOL_STRUCTURED_DELTA` 事件，内容为 fragment
- **AND** projector 必须不为该 delta 发送 `LLM_CONTENT_DELTA`
- **AND** projector 必须不累积 fragment 内容

#### Scenario: 无 level 的流式 delta 发送 LLM_CONTENT_DELTA

- **WHEN** workflow 节点发送 `NODE_OUTPUT_DELTA` 且 `visibleDelta.level` 缺失
- **THEN** projector 必须如常发送 `LLM_CONTENT_DELTA`，内容为累积值

#### Scenario: 无效 level 值被拒绝

- **WHEN** `visibleDelta.level` 存在但不是有效 `ToolEventType`
- **THEN** `WorkflowVisibleDeltaSchema` 校验必须在 remote bridge 模式拒绝该事件

### Requirement: Workflow 节点完成去重

当 workflow 节点已通过流式 `visibleDelta.level` 发送了 `TOOL_STRUCTURED_DELTA` 事件时，projector 必须抑制 `NODE_COMPLETED` 的 structured delta，避免重复推送内容。projector 必须跟踪哪些 step 已流式发送 structured delta，并跳过这些 step 在完成时的 structured delta。

#### Scenario: 流式 structured delta 后 NODE_COMPLETED 被抑制

- **WHEN** workflow 节点已发送至少一个携带 `visibleDelta.level` 的 `NODE_OUTPUT_DELTA`
- **AND** 该节点到达 `NODE_COMPLETED`
- **THEN** projector 必须不为 `NODE_COMPLETED` 事件发送 `TOOL_STRUCTURED_DELTA`

#### Scenario: 无流式 structured delta 时 NODE_COMPLETED 正常发送

- **WHEN** workflow 节点未发送任何携带 `visibleDelta.level` 的 `NODE_OUTPUT_DELTA`
- **AND** 该节点到达 `NODE_COMPLETED`
- **THEN** projector 必须如常发送 `TOOL_STRUCTURED_DELTA`

### Requirement: Workflow Level Scope

`WorkflowRuntimeEventProjector` 必须接受 `levelScope` 参数，值为 `"MAIN" | "SUB"`（默认 `"MAIN"`）。当 delta 或节点 output 上未提供显式 `level` 时，projector 必须按 scope 自动分配 level： `MAIN` 映射 `TITLE`/`ANSWER`/`DETAIL`， `SUB` 映射 `SUB_TITLE`/`SUB_CONCLUSION`/`SUB_DETAIL`。 `tryEmitWorkflowToolDelta` 投影路径必须以 `levelScope: "SUB"` 创建 projector。

#### Scenario: MAIN scope 在 NODE_STARTED 时自动分配 TITLE

- **WHEN** projector 以 `levelScope: "MAIN"` 创建（默认）
- **AND** 非 gateway 节点发送 `NODE_STARTED`
- **THEN** projector 必须发送 `TOOL_STRUCTURED_DELTA`，`toolEventType: "TITLE"`

#### Scenario: SUB scope 在 NODE_STARTED 时自动分配 SUB_TITLE

- **WHEN** projector 以 `levelScope: "SUB"` 创建
- **AND** 非 gateway 节点发送 `NODE_STARTED`
- **THEN** projector 必须发送 `TOOL_STRUCTURED_DELTA`，`toolEventType: "SUB_TITLE"`

#### Scenario: SUB scope 在 answer 节点完成时自动分配 SUB_CONCLUSION

- **WHEN** projector 以 `levelScope: "SUB"` 创建
- **AND** answer 节点到达 `NODE_COMPLETED` 且之前未流式发送 structured delta
- **THEN** projector 必须发送 `TOOL_STRUCTURED_DELTA`，`toolEventType: "SUB_CONCLUSION"`

### Requirement: DISPLAY 节点 Level 传递

`executeDisplayContentNode` 必须从节点定义中的 `outputParser.level` 或 `presentation.outputParser.level` 读取 `level`。当存在且有效时，节点必须在每次 `emitOutputDelta` 调用中包含 `level`。level 必须校验 `TOOL_EVENT_TYPES` 并归一化为大写。

#### Scenario: 配置了 level 的 DISPLAY 节点传递到 delta

- **WHEN** DISPLAY 节点配置 `outputParser.level: "ANSWER"`
- **AND** 节点通过 `emitOutputDelta` 发送可见内容
- **THEN** 每个 delta 必须携带 `level: "ANSWER"`

#### Scenario: 未配置 level 的 DISPLAY 节点省略 level

- **WHEN** DISPLAY 节点未配置 `outputParser.level`
- **AND** 节点通过 `emitOutputDelta` 发送可见内容
- **THEN** delta 必须不携带 `level` 字段

### Requirement: Answer Level 大小写不敏感匹配

`workflow-tool-port.ts` 中的 `extractAnswerPreviews` 和 `extractAnswerGeneratedMessages` 必须大小写不敏感地匹配 `output.level`。大写 `"ANSWER"` 和小写 `"answer"` 都必须被识别为 answer level。

#### Scenario: 大写 ANSWER level 被识别

- **WHEN** 节点结果的 `output.level: "ANSWER"`
- **THEN** `extractAnswerPreviews` 必须将内容包含在 answer previews 中

#### Scenario: 小写 answer level 被识别

- **WHEN** 节点结果的 `output.level: "answer"`
- **THEN** `extractAnswerPreviews` 必须将内容包含在 answer previews 中