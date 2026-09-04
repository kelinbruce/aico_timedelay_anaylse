# tool-structured-delta Specification Delta

所属 Function：tool-structured-delta
Function 变更类型：修改
spec 角色：主规格

## ADDED Requirements

### Requirement: Streaming Terminal LLM_CONTENT_DELTA Suppression

For non-agentic streaming ApiCall results, the orchestration layer MUST track whether each streaming chunk was identified as a structured delta. After streaming completes, the orchestration layer MUST conditionally suppress the terminal `LLM_CONTENT_DELTA { final: true }` event:

- If ALL streaming chunks were identified as structured deltas (every chunk emitted `TOOL_STRUCTURED_DELTA`), the orchestration layer MUST NOT emit `LLM_CONTENT_DELTA { final: true }`.
- If SOME streaming chunks were NOT identified as structured deltas, the orchestration layer MUST emit `LLM_CONTENT_DELTA { final: true }` with content containing ONLY the aggregation of non-structured chunk data. Structured chunk data MUST NOT be included in this terminal content.

The `terminalContent` used for `assertTerminalContentReady` and terminal commit MUST retain its original value regardless of the suppression decision. The suppression MUST only affect the `LLM_CONTENT_DELTA` emit.

This requirement applies to both non-agentic ApiCall paths in the orchestration layer (the pre-round path and the post-tool-call path). The model-driven tool-loop path is not affected because it does not emit `LLM_CONTENT_DELTA` from ApiCall results.

#### Scenario: All chunks structured suppresses terminal LLM_CONTENT_DELTA

- **WHEN** a streaming ApiCall has 3 chunks, all matching the structured delta shape
- **THEN** the orchestration layer MUST emit 3 `TOOL_STRUCTURED_DELTA` events during streaming
- **AND** the orchestration layer MUST NOT emit `LLM_CONTENT_DELTA { final: true }` after streaming completes
- **AND** `CAPABILITY_COMPLETED` MUST still be emitted

#### Scenario: Mixed chunks emits terminal LLM_CONTENT_DELTA with non-structured residue only

- **WHEN** a streaming ApiCall has 3 chunks where chunk 1 and 3 match structured delta shape but chunk 2 does not
- **THEN** the orchestration layer MUST emit 2 `TOOL_STRUCTURED_DELTA` events (for chunk 1 and 3)
- **AND** the orchestration layer MUST emit 1 `CAPABILITY_RESULT_DELTA` for chunk 2 during streaming
- **AND** the orchestration layer MUST emit `LLM_CONTENT_DELTA { final: true }` with content containing ONLY chunk 2's data (not chunk 1 or 3's data)

#### Scenario: No streaming chunks does not suppress

- **WHEN** a non-streaming ApiCall returns a result (no streaming chunks)
- **THEN** the orchestration layer MUST emit `LLM_CONTENT_DELTA { final: true }` with the full terminal content
- **AND** the suppression logic MUST NOT trigger (streamDeltaTotal is 0)

### Requirement: Streaming Terminal CAPABILITY_RESULT_DELTA Suppression

For non-agentic streaming ApiCall results, the orchestration layer MUST NOT emit a terminal `CAPABILITY_RESULT_DELTA` after streaming completes. The per-chunk `CAPABILITY_RESULT_DELTA` events emitted during streaming for non-structured chunks MUST NOT be affected. The `CAPABILITY_COMPLETED` event MUST still be emitted with status and duration. The `appendCapabilityResultMessage` call MUST still execute to preserve model context.

#### Scenario: Terminal CAPABILITY_RESULT_DELTA skipped for streaming result

- **WHEN** a streaming ApiCall completes
- **THEN** the orchestration layer MUST NOT emit a `CAPABILITY_RESULT_DELTA` event after the streaming loop
- **AND** per-chunk `CAPABILITY_RESULT_DELTA` events from during streaming MUST remain in the event stream
- **AND** `CAPABILITY_COMPLETED` MUST be emitted with the correct status

### Requirement: Streaming TOOL_STRUCTURED_DELTA Persistence Marker

The orchestration layer and tool-loop MUST set `streaming: true` in the `inlinePayload` of `TOOL_STRUCTURED_DELTA` events emitted from streaming ApiCall chunks. Non-streaming `TOOL_STRUCTURED_DELTA` events MUST NOT include the `streaming` field. The `streaming` field MUST be a boolean `true` when present.

The `streaming` field MUST be passed through the `tryEmitStructuredDelta` / `emitStructuredDeltaData` call chain as an optional parameter. When the parameter is not provided, the `inlinePayload` MUST NOT contain a `streaming` field.

#### Scenario: Streaming chunk TOOL_STRUCTURED_DELTA includes streaming marker

- **WHEN** a streaming ApiCall chunk is identified as a structured delta and `TOOL_STRUCTURED_DELTA` is emitted
- **THEN** the event `inlinePayload` MUST contain `streaming: true`

#### Scenario: Non-streaming TOOL_STRUCTURED_DELTA does not include streaming marker

- **WHEN** a non-streaming ApiCall result is identified as a structured delta and `TOOL_STRUCTURED_DELTA` is emitted
- **THEN** the event `inlinePayload` MUST NOT contain a `streaming` field

### Requirement: Streaming TOOL_STRUCTURED_DELTA Persistence

The runtime persistence policy MUST persist `TOOL_STRUCTURED_DELTA` events with `inlinePayload.streaming === true` to the timeline store. These events MUST be classified as `PERSISTED`.

Non-streaming `TOOL_STRUCTURED_DELTA` events (without `streaming` field) MUST retain their existing `LIVE_ONLY` classification and continue to rely on `CAPABILITY_RESULT` message reconstruction for history replay.

Workflow `TOOL_STRUCTURED_DELTA` events (those with `workflowEventType`) MUST retain their existing persistence classification: `NODE_COMPLETED` events as `PERSISTED`, `NODE_OUTPUT_DELTA` fragment events as `LIVE_ONLY`.

#### Scenario: Streaming structured delta persisted

- **WHEN** a `TOOL_STRUCTURED_DELTA` event is emitted with `streaming: true` in `inlinePayload`
- **THEN** the runtime MUST classify the event as `PERSISTED`
- **AND** the event MUST be stored in the timeline store

#### Scenario: Non-streaming structured delta remains LIVE_ONLY

- **WHEN** a `TOOL_STRUCTURED_DELTA` event is emitted without a `streaming` field in `inlinePayload`
- **THEN** the runtime MUST classify the event as `LIVE_ONLY` (unchanged)
- **AND** the event MUST NOT be stored in the timeline store

#### Scenario: Workflow NODE_COMPLETED still persisted

- **WHEN** a `TOOL_STRUCTURED_DELTA` event is emitted with `workflowEventType === "NODE_COMPLETED"`
- **THEN** the runtime MUST classify the event as `PERSISTED` (unchanged)

#### Scenario: Workflow NODE_OUTPUT_DELTA fragment still LIVE_ONLY

- **WHEN** a `TOOL_STRUCTURED_DELTA` event is emitted with `workflowEventType === "NODE_OUTPUT_DELTA"`
- **THEN** the runtime MUST classify the event as `LIVE_ONLY` (unchanged)

### Requirement: tool-loop emitResultDelta Structured Payload Unwrap

The `emitResultDelta` callback in `tool-loop.ts` MUST unwrap the nested `structuredPayload` envelope before passing the candidate to `tryEmitWorkflowToolDelta` and `tryEmitStructuredDelta`. The unwrap logic MUST be `structuredPayload?.['structuredPayload'] ?? structuredPayload`, identical to the orchestration layer (`default-agent.ts`). Without this unwrap, the executor bridge layer's additional wrapping causes `tryEmitStructuredDelta` to receive `{ structuredPayload: <actual_payload> }` instead of `<actual_payload>`, preventing structured delta identification for model-driven ApiCall invocations.

#### Scenario: Model tool-call ApiCall streaming chunk identified as structured delta

- **WHEN** the model invokes ApiCall via tool-call and a streaming chunk's data matches the structured event shape
- **THEN** the tool-loop `emitResultDelta` callback MUST unwrap the `structuredPayload` envelope
- **AND** `tryEmitStructuredDelta` MUST receive the actual payload (not the wrapper)
- **AND** a `TOOL_STRUCTURED_DELTA` event MUST be emitted

#### Scenario: Non-structured chunk falls through correctly after unwrap

- **WHEN** the model invokes ApiCall via tool-call and a streaming chunk's data does NOT match the structured event shape
- **THEN** the tool-loop `emitResultDelta` callback MUST fall through to `CAPABILITY_RESULT_DELTA`
- **AND** the `result` field MUST contain the unwrapped payload (not the wrapper)

### Requirement: CAPABILITY_RESULT_DELTA Result Shape Consistency

The `result` field in per-chunk `CAPABILITY_RESULT_DELTA` events emitted from `emitResultDelta` callbacks MUST contain the unwrapped payload (the actual chunk data), not the nested `structuredPayload` wrapper. Both the orchestration layer (`default-agent.ts`) and the tool-loop MUST use the same shape: `result: sdiCandidate` where `sdiCandidate = structuredPayload?.['structuredPayload'] ?? structuredPayload`.

#### Scenario: default-agent.ts per-chunk CAPABILITY_RESULT_DELTA uses unwrapped payload

- **WHEN** a non-agentic streaming ApiCall chunk does not match the structured delta shape
- **THEN** the `CAPABILITY_RESULT_DELTA` event's `result` field MUST contain the parsed chunk data directly (not `{ structuredPayload: <parsed_chunk_data> }`)

## Function 变更汇总

### 处理过程

变更类型：修改
目标内容：流式 ApiCall 的 `TOOL_STRUCTURED_DELTA` 终态抑制、持久化和 tool-loop 解包修复。流式期间逐 chunk 判断结构化格式：匹配的发 `TOOL_STRUCTURED_DELTA`（带 `streaming: true` 标记），不匹配的发 `CAPABILITY_RESULT_DELTA`。流式结束后：全部结构化时跳过 `LLM_CONTENT_DELTA`，混合时只发非结构化残留；跳过终态 `CAPABILITY_RESULT_DELTA`。新增持久化规则将 `streaming: true` 的 `TOOL_STRUCTURED_DELTA` 标记为 `PERSISTED`。tool-loop `emitResultDelta` 回调新增 `structuredPayload` 解包，统一 `result` shape。非流式路径不受影响。
依据 Requirements：Streaming Terminal LLM_CONTENT_DELTA Suppression、Streaming Terminal CAPABILITY_RESULT_DELTA Suppression、Streaming TOOL_STRUCTURED_DELTA Persistence Marker、Streaming TOOL_STRUCTURED_DELTA Persistence、tool-loop emitResultDelta Structured Payload Unwrap、CAPABILITY_RESULT_DELTA Result Shape Consistency
#### Scenario: tool-loop per-chunk CAPABILITY_RESULT_DELTA uses unwrapped payload

- **WHEN** a model-driven ApiCall streaming chunk does not match the structured delta shape
- **THEN** the `CAPABILITY_RESULT_DELTA` event's `result` field MUST contain the parsed chunk data directly (not `{ structuredPayload: <parsed_chunk_data> }`)
