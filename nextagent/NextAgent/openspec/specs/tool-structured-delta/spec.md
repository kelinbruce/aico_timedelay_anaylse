# tool-structured-delta Specification

## Purpose

Define structured tool timeline deltas emitted for whitelisted capabilities (CLIP custom capability provider as a retained legacy path, Bash, and ApiCall), their identification shapes, stream projection, storage/reconstruction and safety requirements, without replacing the ordinary capability result path.

## Function

- **所属 Function**：`FN-5.16 识别和投射结构化工具增量`
- **Function 变更类型**：`ADDED`
- **spec 角色**：主规格
## Requirements
### Requirement: TOOL_STRUCTURED_DELTA Timeline Event Type

The system MUST add `"TOOL_STRUCTURED_DELTA"` to `TimelineEventType` in `agent-common`. The event MUST carry `capabilityId`, `toolCallId`, `toolEventType`, `toolMessageType`, and `content` in its `inlinePayload`. The `toolEventType` field MUST be one of `TITLE`, `DETAIL`, `ANSWER`, `SUB_TITLE`, `SUB_DETAIL`, `SUB_CONCLUSION`, `EXPAND_PANEL`. The `toolMessageType` field MUST be one of `PIU`, `DSL`, `ACTION`, `OPERATOR`, `FILE`, `TEXT`.

#### Scenario: Structured event emitted for CLIP API result

- **WHEN** a CLIP-backed tool returns a `structuredPayload` matching `{eventType, content, messageType}` shape
- **THEN** the tool-loop MUST emit a `TOOL_STRUCTURED_DELTA` timeline event with the original `eventType` mapped to `toolEventType`, `messageType` mapped to `toolMessageType`, and the original `content` preserved
- **AND** the event MUST include `capabilityId` and `toolCallId` for correlation with `CAPABILITY_STARTED` and `CAPABILITY_COMPLETED`

#### Scenario: EXPAND_PANEL event emitted for CLIP API result

- **WHEN** a CLIP-backed tool returns a `structuredPayload` with `eventType: "EXPAND_PANEL"`
- **THEN** the tool-loop MUST emit a `TOOL_STRUCTURED_DELTA` event with `toolEventType: "EXPAND_PANEL"`, the original `messageType` mapped to `toolMessageType`, and the original `content` preserved
- **AND** the event MUST include `capabilityId` and `toolCallId`

#### Scenario: Pure string result emitted as ANSWER TEXT（DEFERRED）

- **WHEN** a CLIP-backed tool returns a `structuredPayload` that is a `string`
- **THEN** the tool-loop MUST emit a `TOOL_STRUCTURED_DELTA` event with `toolEventType: "ANSWER"`, `toolMessageType: "TEXT"`, and `content` set to the string value
- **NOTE**: This scenario is deferred because `CapabilityInvocationResult.structuredPayload` is typed as `JsonObject`, not `string`. Enabling it requires either relaxing `assertCapabilityResultSafe` for CLIP sources, or wrapping the string as `{eventType:"ANSWER", messageType:"TEXT", content: string}` in the CLIP runner layer. See design.md §7 (Not in scope).

#### Scenario: Plain JSON result does not emit TOOL_STRUCTURED_DELTA

- **WHEN** a CLIP-backed tool returns a `structuredPayload` that is a JSON object but does NOT match the structured event shape
- **THEN** the tool-loop MUST NOT emit any `TOOL_STRUCTURED_DELTA` event
- **AND** the result MUST fall through to the existing `CAPABILITY_RESULT_DELTA` channel

### Requirement: Non-CLIP results never emit TOOL_STRUCTURED_DELTA

The system MUST NOT emit `TOOL_STRUCTURED_DELTA` for tools outside the structured delta whitelist. The whitelist consists of: CLIP custom capability provider (`providerType === "clip_server"`, legacy path retained but not used in production), Bash capability (`capabilityId === "Bash"`), and ApiCall capability (`capabilityId === "ApiCall"`). All other tools (Read, Write, Skill, Agent, etc.) MUST NOT emit `TOOL_STRUCTURED_DELTA` regardless of payload shape. The existing `CAPABILITY_RESULT_DELTA` flow MUST remain unchanged for all non-whitelisted tools.

**需求类别**：功能性需求

#### Scenario: Non-whitelisted tool never emits TOOL_STRUCTURED_DELTA

- **WHEN** a tool outside the whitelist (Read, Write, Skill, Agent, etc.) returns a result
- **THEN** the system MUST NOT emit any `TOOL_STRUCTURED_DELTA` event regardless of payload shape
- **AND** the existing `CAPABILITY_RESULT_DELTA` flow MUST remain unchanged

#### Scenario: Bash non-structured stdout does not emit TOOL_STRUCTURED_DELTA

- **WHEN** a Bash tool returns a result whose stdout does not match the direct structured event shape or the structured event envelope
- **THEN** the system MUST NOT emit any `TOOL_STRUCTURED_DELTA` event
- **AND** the existing `CAPABILITY_RESULT_DELTA` flow MUST remain unchanged

#### Scenario: ApiCall non-structured response does not emit TOOL_STRUCTURED_DELTA

- **WHEN** an ApiCall tool returns a non-streaming result whose `structuredPayload` does not match the direct structured event shape or the structured event envelope
- **THEN** the system MUST NOT emit any `TOOL_STRUCTURED_DELTA` event
- **AND** the existing `CAPABILITY_RESULT_DELTA` flow MUST remain unchanged

### Requirement: CLIP Provider Identification

The system MUST attempt structured delta identification for CLIP custom capability provider (`providerKind === "CUSTOM"` and `providerType === "clip_server"`, legacy path retained but not used in production), Bash capability (`capabilityId === "Bash"`, identified in the tool-loop), and ApiCall capability (`capabilityId === "ApiCall"`, identified in the orchestration layer). All other provider/capability combinations MUST skip structured delta identification entirely.

**需求类别**：功能性需求

#### Scenario: CLIP provider triggers structured identification (legacy)

- **WHEN** the resolved capability descriptor has `provider.providerKind === "CUSTOM"` and `provider.providerType === "clip_server"`
- **THEN** the tool-loop MUST attempt structured delta identification on the result payload
- **NOTE**: This path is legacy and not used in production. The code is retained but not actively exercised.

#### Scenario: Bash capability triggers structured identification

- **WHEN** the resolved capability descriptor has `capabilityId === "Bash"`
- **THEN** the tool-loop MUST attempt structured delta identification on the result payload

#### Scenario: ApiCall capability triggers structured identification

- **WHEN** the orchestration layer invokes the ApiCall capability via `capabilityInvocation.invoke()`
- **THEN** the orchestration layer MUST attempt structured delta identification on the result

#### Scenario: Non-whitelisted capability skips structured identification

- **WHEN** the resolved capability descriptor is not CLIP provider, not Bash, and not ApiCall
- **THEN** the system MUST NOT attempt structured delta identification
- **AND** no `TOOL_STRUCTURED_DELTA` event MUST be emitted

### Requirement: Structured Event Shape Validation

The system MUST validate the structured event shape before emitting `TOOL_STRUCTURED_DELTA`. The `toolEventType` field (mapped from `eventType`) MUST be one of `TITLE`, `DETAIL`, `ANSWER`, `SUB_TITLE`, `SUB_DETAIL`, `SUB_CONCLUSION`, `EXPAND_PANEL`. The `toolMessageType` field (mapped from `messageType`) MUST be one of `PIU`, `DSL`, `STREAM_DSL`, `ACTION`, `OPERATOR`, `FILE`, `TEXT`. The `content` field MUST be present. If validation fails, the result MUST fall back to the existing `CAPABILITY_RESULT_DELTA` channel.

The system MUST support two identification shapes:

1. **Direct shape**: the candidate JSON object is the structured event itself, matching `{eventType, messageType, content}`.
2. **Envelope shape**: the candidate JSON object is `{"status":"ok","data":{"raw":"<json-string>"}}` where the `raw` field is a JSON string that, when parsed, yields `{eventType, messageType, content}`.

Both shapes MUST use the same `TOOL_EVENT_TYPES` and `TOOL_MESSAGE_TYPES` enum validation. Both shapes MUST use the same `hasSensitiveStructuredContent` security check.

The system MUST NOT inspect or validate the internal structure of `STREAM_DSL` content fragments. The `content` field for `STREAM_DSL` is a JSON object with a `type` field (`"dataModel"`, `"dsl"`, or `"done"`); the backend identification layer treats it as an opaque `JsonValue` and only validates that `content` is present and non-null.

#### Scenario: Direct shape accepted

- **WHEN** a candidate JSON object has valid `eventType`, `messageType`, and `content` fields
- **THEN** the system MUST emit `TOOL_STRUCTURED_DELTA` with the parsed event data

#### Scenario: Envelope shape accepted

- **WHEN** a candidate JSON object is `{"status":"ok","data":{"raw":"{\"eventType\":\"ANSWER\",\"messageType\":\"TEXT\",\"content\":\"recovery\"}"}}`
- **THEN** the system MUST parse `data.raw` as JSON
- **AND** MUST validate the parsed object as a structured event
- **AND** MUST emit `TOOL_STRUCTURED_DELTA` with `toolEventType: "ANSWER"`, `toolMessageType: "TEXT"`, and `content: "recovery"`

#### Scenario: Envelope with status not ok falls back

- **WHEN** a candidate JSON object is `{"status":"error","data":{"raw":"..."}}`
- **THEN** the system MUST NOT emit `TOOL_STRUCTURED_DELTA`
- **AND** the result MUST fall back to `CAPABILITY_RESULT_DELTA`

#### Scenario: Envelope with malformed raw falls back

- **WHEN** a candidate JSON object is `{"status":"ok","data":{"raw":"not valid json"}}`
- **THEN** the system MUST NOT emit `TOOL_STRUCTURED_DELTA`
- **AND** the result MUST fall back to `CAPABILITY_RESULT_DELTA`

#### Scenario: Invalid eventType rejected

- **WHEN** a structured event has `eventType: "UNKNOWN"` and `messageType: "TEXT"`
- **THEN** the system MUST NOT emit `TOOL_STRUCTURED_DELTA`
- **AND** the result MUST fall back to `CAPABILITY_RESULT_DELTA`

#### Scenario: Invalid messageType rejected

- **WHEN** a structured event has `eventType: "ANSWER"` and `messageType: "UNKNOWN"`
- **THEN** the system MUST NOT emit `TOOL_STRUCTURED_DELTA`
- **AND** the result MUST fall back to `CAPABILITY_RESULT_DELTA`

#### Scenario: STREAM_DSL messageType accepted

- **WHEN** a structured event has `eventType: "ANSWER"`, `messageType: "STREAM_DSL"`, and `content: {"type":"dataModel","content":{"fields":[...]}}`
- **THEN** the system MUST emit `TOOL_STRUCTURED_DELTA` with `toolEventType: "ANSWER"`, `toolMessageType: "STREAM_DSL"`, and the content preserved as-is
- **AND** the system MUST NOT inspect the internal `type` or `content` fields of the STREAM_DSL fragment

#### Scenario: STREAM_DSL with any content type accepted

- **WHEN** a structured event has `messageType: "STREAM_DSL"` and `content` is any non-null JSON value (object, string, number)
- **THEN** the system MUST emit `TOOL_STRUCTURED_DELTA` as long as `content` is present and non-null
- **AND** the system MUST NOT reject based on the internal structure of `content`

### Requirement: Bash Structured Delta Identification

The tool-loop MUST attempt structured delta identification when the resolved capability descriptor has `capabilityId === "Bash"`. The tool-loop MUST first verify `exitCode === 0` and `stdoutTruncated !== true`, then check that `stdout` is a string starting with `{`. When these preconditions pass, the tool-loop MUST parse `stdout` as JSON to obtain a candidate object, then attempt both direct shape and envelope shape identification using the shared detection logic. If either shape matches, the tool-loop MUST emit a `TOOL_STRUCTURED_DELTA` event with the parsed event data. If any parsing or validation step fails, the result MUST fall back to the existing `CAPABILITY_RESULT_DELTA` channel.

The emitted `TOOL_STRUCTURED_DELTA` event MUST be LIVE_ONLY (not persisted to the timeline store), because the event inlinePayload does not contain `workflowEventType`. History reconstruction from stored `CAPABILITY_RESULT` messages is NOT supported for Bash (deferred).

**需求类别**：功能性需求

#### Scenario: Bash direct structured event emits TOOL_STRUCTURED_DELTA

- **WHEN** a Bash tool returns `exitCode: 0` and `stdout` is a JSON string matching `{"eventType":"ANSWER","messageType":"TEXT","content":"recovery steps"}`
- **THEN** the tool-loop MUST emit a `TOOL_STRUCTURED_DELTA` event with `toolEventType: "ANSWER"`, `toolMessageType: "TEXT"`, and `content: "recovery steps"`
- **AND** the event MUST include `capabilityId` and `toolCallId`
- **AND** the event MUST be LIVE_ONLY (not persisted)

#### Scenario: Bash envelope structured event emits TOOL_STRUCTURED_DELTA

- **WHEN** a Bash tool returns `exitCode: 0` and `stdout` is a JSON string matching `{"status":"ok","data":{"raw":"{\"eventType\":\"ANSWER\",\"messageType\":\"TEXT\",\"content\":\"recovery steps\"}"}}`
- **THEN** the tool-loop MUST emit a `TOOL_STRUCTURED_DELTA` event with `toolEventType: "ANSWER"`, `toolMessageType: "TEXT"`, and `content: "recovery steps"`
- **AND** the event MUST include `capabilityId` and `toolCallId`
- **AND** the event MUST be LIVE_ONLY (not persisted)

#### Scenario: Bash non-JSON stdout does not trigger structured identification

- **WHEN** a Bash tool returns `exitCode: 0` and `stdout` is `"hello world"` (does not start with `{`)
- **THEN** the tool-loop MUST NOT attempt structured delta identification
- **AND** the existing `CAPABILITY_RESULT_DELTA` flow MUST remain unchanged

#### Scenario: Bash with non-zero exit code skips structured identification

- **WHEN** a Bash tool returns `exitCode !== 0`
- **THEN** the tool-loop MUST NOT attempt structured delta identification
- **AND** the result MUST follow the existing degraded result path

#### Scenario: Bash with truncated stdout skips structured identification

- **WHEN** a Bash tool returns `stdoutTruncated: true`
- **THEN** the tool-loop MUST NOT attempt structured delta identification
- **AND** the result MUST follow the existing result path

#### Scenario: Bash structured delta does not interfere with CAPABILITY_RESULT_DELTA

- **WHEN** a Bash structured event is successfully emitted as `TOOL_STRUCTURED_DELTA`
- **THEN** the tool-loop MUST still emit `CAPABILITY_RESULT_DELTA` and `CAPABILITY_COMPLETED` events
- **AND** the tool-loop MUST still persist the result via `appendCapabilityResultMessage`

### Requirement: ApiCall Structured Delta Identification

The orchestration layer (`agent-core` routing) MUST attempt structured delta identification when it invokes the ApiCall capability. ApiCall is a non-model-visible tool invoked programmatically by the orchestration layer through `capabilityInvocation.invoke()`, not through the model-driven tool-loop. Therefore, structured delta detection for ApiCall MUST happen in the orchestration layer, not in `tryEmitToolStructuredDelta`.

For non-streaming results, the orchestration layer MUST attempt identification on `apiResult.structuredPayload` after `capabilityInvocation.invoke()` returns. For streaming results, the orchestration layer MUST pass a `runtimeContext.emitResultDelta` callback; each SSE `chunk.data` string MUST be parsed as JSON to obtain a candidate object, then passed through the shared detection logic (direct shape and envelope shape). If either shape matches, a `TOOL_STRUCTURED_DELTA` event MUST be emitted. If no shape matches or JSON parsing fails, the chunk MUST fall through to the existing `CAPABILITY_RESULT_DELTA` channel.

For streaming results, the orchestration layer MUST attempt identification on each chunk independently. Each chunk that matches MUST emit its own `TOOL_STRUCTURED_DELTA` event. The streaming terminal `structuredPayload` (empty object `{}`) MUST NOT trigger a duplicate `TOOL_STRUCTURED_DELTA` emission.

All emitted `TOOL_STRUCTURED_DELTA` events for ApiCall MUST be LIVE_ONLY.

**需求类别**：功能性需求

#### Scenario: ApiCall non-streaming direct shape emits TOOL_STRUCTURED_DELTA

- **WHEN** the orchestration layer invokes ApiCall and the result `structuredPayload` is `{"eventType":"TITLE","messageType":"PIU","content":{"label":"alarm"}}`
- **THEN** the orchestration layer MUST emit a `TOOL_STRUCTURED_DELTA` event with `toolEventType: "TITLE"`, `toolMessageType: "PIU"`, and the content preserved
- **AND** the event MUST include `capabilityId` and `toolCallId`

#### Scenario: ApiCall non-streaming envelope shape emits TOOL_STRUCTURED_DELTA

- **WHEN** the orchestration layer invokes ApiCall and the result `structuredPayload` is `{"status":"ok","data":{"raw":"{\"eventType\":\"DETAIL\",\"messageType\":\"DSL\",\"content\":\"diag\"}"}}`
- **THEN** the orchestration layer MUST parse `data.raw` and emit `TOOL_STRUCTURED_DELTA` with `toolEventType: "DETAIL"`, `toolMessageType: "DSL"`, and `content: "diag"`

#### Scenario: ApiCall streaming chunk with direct shape emits TOOL_STRUCTURED_DELTA

- **WHEN** the orchestration layer invokes ApiCall with a streaming `emitResultDelta` callback and a chunk's `data` is a JSON string matching `{"eventType":"ANSWER","messageType":"TEXT","content":"result"}`
- **THEN** the orchestration layer MUST emit a `TOOL_STRUCTURED_DELTA` event for that chunk
- **AND** the event MUST include `capabilityId` and `toolCallId`

#### Scenario: ApiCall streaming chunk with envelope shape emits TOOL_STRUCTURED_DELTA

- **WHEN** the orchestration layer invokes ApiCall with a streaming `emitResultDelta` callback and a chunk's `data` is a JSON string matching `{"status":"ok","data":{"raw":"{\"eventType\":\"ANSWER\",\"messageType\":\"TEXT\",\"content\":\"result\"}"}}`
- **THEN** the orchestration layer MUST parse `data.raw` and emit `TOOL_STRUCTURED_DELTA` for that chunk

#### Scenario: ApiCall streaming chunk without structured shape falls back

- **WHEN** the orchestration layer invokes ApiCall with a streaming `emitResultDelta` callback and a chunk's `data` is a JSON string that does not match either shape
- **THEN** the orchestration layer MUST NOT emit `TOOL_STRUCTURED_DELTA` for that chunk
- **AND** the chunk MUST fall through to `CAPABILITY_RESULT_DELTA`

#### Scenario: ApiCall streaming chunk with unparseable data falls back

- **WHEN** the orchestration layer invokes ApiCall with a streaming `emitResultDelta` callback and a chunk's `data` is not valid JSON
- **THEN** the orchestration layer MUST NOT emit `TOOL_STRUCTURED_DELTA` for that chunk
- **AND** the chunk MUST fall through to `CAPABILITY_RESULT_DELTA`

#### Scenario: ApiCall streaming terminal empty payload does not emit

- **WHEN** an ApiCall streaming result completes with `structuredPayload: {}`
- **THEN** the orchestration layer MUST NOT emit a duplicate `TOOL_STRUCTURED_DELTA` from the terminal payload
- **AND** only chunks that matched during streaming have emitted `TOOL_STRUCTURED_DELTA`

#### Scenario: ApiCall non-streaming non-structured response falls back

- **WHEN** the orchestration layer invokes ApiCall and the result `structuredPayload` does not match either shape
- **THEN** the orchestration layer MUST NOT emit `TOOL_STRUCTURED_DELTA`
- **AND** the result MUST fall through to `CAPABILITY_RESULT_DELTA`

### Requirement: TOOL_STRUCTURED_DELTA Does Not Replace CAPABILITY_RESULT_DELTA

`TOOL_STRUCTURED_DELTA` 事件 MUST NOT 替换现有的 `CAPABILITY_RESULT_DELTA` emit 或 `appendCapabilityResultMessage` 调用。对于完成后一次性识别的结构化结果（CLIP provider、Bash 非流式、ApiCall 非流式），`CAPABILITY_RESULT_DELTA` 和 `TOOL_STRUCTURED_DELTA` 都 MUST 被 emit。对于 Bash 流式执行期间逐帧 emit 的 `TOOL_STRUCTURED_DELTA`，每帧 emit 后 MUST NOT 产生额外的 `CAPABILITY_RESULT_DELTA`；执行完成后的 `CAPABILITY_RESULT_DELTA`、`CAPABILITY_COMPLETED` 和 `appendCapabilityResultMessage` 的 terminal 语义 MUST 保持不变。

当 Bash 流式执行期间已经 emit 过至少一条 `TOOL_STRUCTURED_DELTA` 时，完成后 `tryEmitToolStructuredDelta` MUST 被 跳过，避免对同一 stdout 内容重复 emit `TOOL_STRUCTURED_DELTA`。当流式执行期间未 emit 任何 `TOOL_STRUCTURED_DELTA` 时（所有帧均不匹配结构化形状），完成后 `tryEmitToolStructuredDelta` MUST 正常执行，与非流式行为一致。

#### Scenario: 流式 emit 后完成后不重复 emit TOOL_STRUCTURED_DELTA

- **WHEN** Bash 工具以 `stream_format: "sse"` 执行 `curl`，执行期间逐帧 emit 了 `TOOL_STRUCTURED_DELTA` 事件
- **THEN** 执行完成后 MUST NOT 再次 emit `TOOL_STRUCTURED_DELTA`
- **AND** MUST 仍 emit `CAPABILITY_RESULT_DELTA` 和 `CAPABILITY_COMPLETED`
- **AND** MUST 仍调用 `appendCapabilityResultMessage` 存储 terminal 结果

#### Scenario: 流式执行期间无匹配帧时完成后正常识别

- **WHEN** Bash 工具以 `stream_format: "sse"` 执行，但所有 SSE 帧的 `data:` 字段均不匹配 `{eventType, messageType, content}` 结构化形状
- **THEN** 执行期间 MUST NOT emit 任何 `TOOL_STRUCTURED_DELTA`
- **AND** 执行完成后 `tryEmitToolStructuredDelta` MUST 正常执行
- **AND** 完成后的识别行为与非流式 Bash 一致

#### Scenario: 非流式 Bash 仍同时 emit 两个事件

- **WHEN** Bash 工具未设置 `stream_format`，执行完成后 stdout 匹配结构化事件形状
- **THEN** tool-loop MUST emit `TOOL_STRUCTURED_DELTA`（由完成后 `tryEmitToolStructuredDelta` 产生）
- **AND** MUST 也 emit `CAPABILITY_RESULT_DELTA`
- **AND** MUST 调用 `appendCapabilityResultMessage`

### Requirement: Stream Envelope Projection

系统 MUST 将 `TOOL_STRUCTURED_DELTA` 包含在统一的 stream-visible timeline event 集合中。SSE、WebSocket 和 history 使用的同一投影 MUST 把 `toolEventType`、`toolMessageType`、`content`、`capabilityId` 和 `toolCallId` 写入 envelope payload；来源 `inlinePayload.truncated` 为 `true` 时还 MUST 写入顶层 `truncated=true`，字段缺省时 MUST NOT 推断截断。该投影 MUST NOT 从 `truncated` 生成 degradation、新的 request-level terminal fact 或 annotation、或 terminal status。

**需求类别**：功能性需求

#### Scenario: 完整结构化增量投影保持既有字段

- **WHEN** 一个未截断的 `TOOL_STRUCTURED_DELTA` 被投影到 stream 或 history
- **THEN** payload MUST 包含原有 `toolEventType`、`toolMessageType`、`content`、`capabilityId` 和 `toolCallId`
- **AND** payload MUST NOT 自行增加 `truncated=true`

#### Scenario: 截断的历史记录公开截断事实

- **WHEN** 一个持久化 `TOOL_STRUCTURED_DELTA` 携带 `inlinePayload.truncated=true`
- **THEN** SSE、WebSocket 和 history 的统一投影 payload MUST 携带 `truncated=true`
- **AND** `content` MUST 继续按其结构化 JSON shape 投影

#### Scenario: 截断不推导请求完成限制

- **WHEN** `TOOL_STRUCTURED_DELTA.truncated=true` 被投影
- **THEN** 投影 MUST NOT 产生 `DEGRADATION_NOTICE`
- **AND** MUST NOT 新增 request-level completion annotation
- **AND** MUST NOT 改变 request terminal status

### Requirement: StreamEventType Contract Update

`StreamEventType` in `agent-contracts/channel` and `STREAM_EVENT_TYPES` in `agent-web/src/state/contracts.ts` MUST include `"TOOL_STRUCTURED_DELTA"`.

#### Scenario: StreamEventType includes new event

- **WHEN** checking `StreamEventType` in channel contracts
- **THEN** it MUST include `"TOOL_STRUCTURED_DELTA"`

### Requirement: Security Constraints

The `TOOL_STRUCTURED_DELTA` content MUST NOT contain credentials, tokens, raw provider errors, or prompt text. The `toolMessageType` validation MUST reject unknown types before emission. The `content` field for ACTION and OPERATOR types MUST be a JSON string whose `data` field is an object string safe to `JSON.parse` on the client side.

For `FILE` `toolMessageType` only, the `content` field MAY carry a complete HOFS object name (a remote object-storage reference used as a download locator handle, e.g. `aicoservice/answer/{sessionId}/{chatId}/result.xlsx`). This is a controlled exception to the general prohibition on file paths in `TOOL_STRUCTURED_DELTA` content: the HOFS object name is NOT a local filesystem path and NOT an execution path; it is an opaque remote object reference consumed solely by the download endpoint to locate the file for proxy download. For all other `toolMessageType` values (PIU, DSL, ACTION, OPERATOR, TEXT), the `content` MUST NOT contain file paths of any kind, including HOFS object names. Credential, token, raw provider error, and prompt text prohibitions apply to all `toolMessageType` values including FILE.

#### Scenario: FILE content with HOFS object name accepted

- **WHEN** a CLIP structured event has `toolMessageType: "FILE"` and `content` is a complete HOFS object name string (e.g. `aicoservice/answer/sess1/run1/result.xlsx`)
- **THEN** the tool-loop MUST emit `TOOL_STRUCTURED_DELTA` with the FILE message type and the object name preserved in `content`
- **AND** the event MUST be available for frontend download card rendering

#### Scenario: Non-FILE content with file path rejected

- **WHEN** a CLIP structured event has `toolMessageType` other than `FILE` (e.g. `TEXT`) and `content` contains a file path or HOFS object name
- **THEN** the tool-loop MUST NOT emit `TOOL_STRUCTURED_DELTA` for that event
- **AND** the result MUST fall back to `CAPABILITY_RESULT_DELTA` with the full payload (model still sees it)

#### Scenario: FILE content with credentials rejected

- **WHEN** a CLIP structured event has `toolMessageType: "FILE"` and `content` contains `api_key`, `authorization`, `credential`, `password`, `secret`, or `token` patterns
- **THEN** the tool-loop MUST NOT emit `TOOL_STRUCTURED_DELTA` for that event
- **AND** the result MUST fall back to `CAPABILITY_RESULT_DELTA` with the full payload

#### Scenario: Content with credentials rejected

- **WHEN** a CLIP structured event content contains `api_key`, `authorization`, `credential`, `password`, `secret`, or `token` patterns
- **THEN** the tool-loop MUST NOT emit `TOOL_STRUCTURED_DELTA` for that event
- **AND** the result MUST fall back to `CAPABILITY_RESULT_DELTA` with the full payload (model still sees it)

### Requirement: Streaming Terminal LLM_CONTENT_DELTA Suppression

For non-agentic streaming ApiCall results, the orchestration layer MUST track whether each streaming chunk was identified as a structured delta. After streaming completes, the orchestration layer MUST conditionally suppress the terminal `LLM_CONTENT_DELTA { final: true }` event:

- If ANY streaming chunk was identified as a structured delta (at least one chunk emitted `TOOL_STRUCTURED_DELTA`), the orchestration layer MUST NOT emit `LLM_CONTENT_DELTA { final: true }`.
- If NO streaming chunks were identified as structured deltas, the orchestration layer MUST emit `LLM_CONTENT_DELTA { final: true }` with content containing the aggregation of non-structured chunk data (or the full terminal content when no streaming chunks were emitted at all).

The `terminalContent` used for `assertTerminalContentReady` and terminal commit MUST retain its original value regardless of the suppression decision. The suppression MUST only affect the `LLM_CONTENT_DELTA` emit.

This requirement applies to both non-agentic ApiCall paths in the orchestration layer (the pre-round path and the post-tool-call path). The model-driven tool-loop path is not affected because it does not emit `LLM_CONTENT_DELTA` from ApiCall results.

需求类别：功能性需求

#### Scenario: All chunks structured suppresses terminal LLM_CONTENT_DELTA

- **WHEN** a streaming ApiCall has 3 chunks, all matching the structured delta shape
- **THEN** the orchestration layer MUST emit 3 `TOOL_STRUCTURED_DELTA` events during streaming
- **AND** the orchestration layer MUST NOT emit `LLM_CONTENT_DELTA { final: true }` after streaming completes
- **AND** `CAPABILITY_COMPLETED` MUST still be emitted

#### Scenario: Mixed chunks suppresses terminal LLM_CONTENT_DELTA when any structured data exists

- **WHEN** a streaming ApiCall has 3 chunks where chunk 1 and 3 match structured delta shape but chunk 2 does not
- **THEN** the orchestration layer MUST emit 2 `TOOL_STRUCTURED_DELTA` events (for chunk 1 and 3)
- **AND** the orchestration layer MUST emit 1 `CAPABILITY_RESULT_DELTA` for chunk 2 during streaming
- **AND** the orchestration layer MUST NOT emit `LLM_CONTENT_DELTA { final: true }` after streaming completes, because at least one structured delta was emitted

#### Scenario: No streaming chunks does not suppress

- **WHEN** a non-streaming ApiCall returns a result (no streaming chunks)
- **THEN** the orchestration layer MUST emit `LLM_CONTENT_DELTA { final: true }` with the full terminal content
- **AND** the suppression logic MUST NOT trigger (streamDeltaTotal is 0)

#### Scenario: All non-structured chunks emits terminal LLM_CONTENT_DELTA

- **WHEN** a streaming ApiCall has 3 chunks, none matching the structured delta shape
- **THEN** the orchestration layer MUST NOT emit any `TOOL_STRUCTURED_DELTA` events during streaming
- **AND** the orchestration layer MUST emit `LLM_CONTENT_DELTA { final: true }` with content containing the aggregation of all 3 chunks' data

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

runtime persistence policy MUST 继续把 `inlinePayload.streaming === true` 的 `TOOL_STRUCTURED_DELTA` 分类为 `PERSISTED`，并把无 `streaming` 字段的非 Workflow 事件分类为 `LIVE_ONLY`。对于两种分类结果，runtime-owned 聚合层 MUST 在 live 投影后接管所有经过可信识别的非 Workflow structured presentation `TOOL_STRUCTURED_DELTA`，按本 change 的聚合规则提交到 timeline store；因此非流式 presentation 也 MUST 可从 durable history 读取。该 timeline body MUST 只作为 Channel/UI presentation，MUST NOT 取代 `CAPABILITY_RESULT` Message 的 ordinary Capability 语义结果，也 MUST NOT 进入模型上下文。

Workflow `TOOL_STRUCTURED_DELTA` MUST 保持既有分类：`NODE_COMPLETED` product 为 `PERSISTED`，`NODE_OUTPUT_DELTA` fragment 为 `LIVE_ONLY`；匹配 Workflow product 规则的事件 MUST NOT 进入非 Workflow 聚合层。Workflow `NODE_COMPLETED` product 超过持久化容量时，系统 MUST 继续形成携带显式截断事实的 durable bounded product，而不是改为仅实时事件；settled live 与 cold history MUST 使用该同一 product 替换先前 fragment。

**需求类别**：功能性需求

#### Scenario: 流式结构化增量聚合后持久化

- **WHEN** 同一 Tool 调用发出多条携带 `streaming=true` 的非 Workflow 结构化增量
- **THEN** live subscriber MUST 按接收顺序收到每条实时增量
- **AND** timeline history MUST 在 flush 后包含按本 change 规则形成的聚合记录

#### Scenario: 非流式结构化增量也可从历史读取

- **WHEN** 非流式结构化增量被 persistence policy 分类为 `LIVE_ONLY`
- **THEN** live subscriber MUST 仍收到该实时事件
- **AND** 聚合层 MUST 在 flush 后把其结果写入 timeline history

#### Scenario: 容量内Workflow product保持既有持久化路径

- **WHEN** 容量内 `TOOL_STRUCTURED_DELTA` 匹配既有 Workflow `NODE_COMPLETED` product 规则
- **THEN** 该事件 MUST 按既有 Workflow classification 与 append 路径处理
- **AND** 本聚合层 MUST NOT 再次暂存或提交该事件

#### Scenario: 超长Workflow completed product形成可恢复的有界历史

- **GIVEN** Workflow `NODE_OUTPUT_DELTA` fragment 已按既有规则实时投影
- **AND** 对应 `NODE_COMPLETED` `TOOL_STRUCTURED_DELTA.inlinePayload` 超过 49,000 UTF-8 bytes
- **WHEN** 系统提交该 completed product
- **THEN** durable history MUST 包含满足持久化容量契约的 product
- **AND** product MUST 携带 `truncated=true`
- **AND** MUST 保留 `capabilityId`、`toolCallId`、`toolEventType`、`toolMessageType`、`accumulated`、`workflowEventType`、`nodeId` 与 `nodeType`
- **AND** settled live 与 cold history MUST 使用同一有界 `content` 和 `truncated` 事实替换 fragment
- **AND** 系统 MUST NOT 再发布一份完整的 `LIVE_ONLY` completed product

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

### Requirement: Bash Streaming Structured Delta Emission

当 Bash 工具收到 `stream_format` 为 `'sse'` 或 `'ndjson'` 且 sandbox 执行端口支持 `runShellStreaming` 时，Bash 工具 MUST 使用流式执行路径：通过 `runShellStreaming` 的 `onStdoutChunk` 回调逐块接收 stdout 数据，使用帧分割逻辑（复用 `drainClipOutputFrames`）将 chunk 分割为独立帧，每帧提取结构化 payload 后通过 `emitResultDelta` 回调传递给 tool-loop。

需求类别：功能性需求

tool-loop 的 `emitResultDelta` 回调 MUST 在 `tryEmitWorkflowToolDelta` 之后、`CAPABILITY_RESULT_DELTA` 之前调用 `tryEmitStructuredDelta`。当 `structuredPayload` 匹配 `{eventType, messageType, content}` 结构化形状（直接形状或信封形状）时，MUST emit `TOOL_STRUCTURED_DELTA` 并跳过该帧的 `CAPABILITY_RESULT_DELTA` emit。当不匹配时，MUST 走现有 `CAPABILITY_RESULT_DELTA` 路径。

tool-loop MUST 维护 `structuredDeltaEmittedDuringExecution` 标志。当流式执行期间 emit 了任何 `TOOL_STRUCTURED_DELTA` 时，该标志 MUST 被设为 `true`。完成后 `tryEmitToolStructuredDelta` MUST 在该标志为 `true` 时被跳过。

当 `stream_format` 未设置、或 sandbox 不支持 `runShellStreaming` 时，Bash 工具 MUST 走现有非流式执行路径（`runShell`/`runShellBackgroundable`/`runPython`），完成后 `tryEmitToolStructuredDelta` 的行为 MUST 不变。

所有流式 emit 的 `TOOL_STRUCTURED_DELTA` 事件 MUST 为 LIVE_ONLY（不持久化到 timeline store），因为事件 inlinePayload 不包含 `workflowEventType`。

#### Scenario: SSE 流式逐帧 emit TOOL_STRUCTURED_DELTA

- **WHEN** Bash 工具以 `stream_format: "sse"` 执行 `curl`，stdout 返回多个 SSE 帧且每帧 `data:` 字段 JSON.parse 后匹配 `{eventType, messageType, content}`
- **THEN** 每收到一个完整 SSE 帧 MUST emit 一条 `TOOL_STRUCTURED_DELTA` 事件
- **AND** 每条事件 MUST 包含 `capabilityId` 和 `toolCallId`
- **AND** 每条事件 MUST 为 LIVE_ONLY

#### Scenario: NDJSON 流式逐帧 emit TOOL_STRUCTURED_DELTA

- **WHEN** Bash 工具以 `stream_format: "ndjson"` 执行命令，stdout 返回多行 JSON 且每行匹配 `{eventType, messageType, content}`
- **THEN** 每收到一个完整 JSON 行 MUST emit 一条 `TOOL_STRUCTURED_DELTA` 事件

#### Scenario: SSE data 字段非 JSON 时走 CAPABILITY_RESULT_DELTA

- **WHEN** Bash 流式执行期间一个 SSE 帧的 `data:` 字段不是有效 JSON 或 JSON.parse 后不匹配结构化形状
- **THEN** 该帧 MUST NOT emit `TOOL_STRUCTURED_DELTA`
- **AND** 该帧 MUST 走 `CAPABILITY_RESULT_DELTA` 路径

#### Scenario: 非结构化 stdout 不触发流式 TOOL_STRUCTURED_DELTA

- **WHEN** Bash 工具设置了 `stream_format: "sse"` 但 stdout 内容不包含任何匹配结构化形状的帧
- **THEN** 执行期间 MUST NOT emit 任何 `TOOL_STRUCTURED_DELTA`
- **AND** 完成后 `tryEmitToolStructuredDelta` MUST 正常执行

#### Scenario: 流式期间 terminal 语义不变

- **WHEN** Bash 流式执行期间 emit 了多条 `TOOL_STRUCTURED_DELTA`
- **THEN** tool-loop MUST 仍只 emit 恰好一条 `CAPABILITY_COMPLETED`
- **AND** MUST 只 append 至多一条 terminal `CAPABILITY_RESULT` 消息
- **AND** `CAPABILITY_STARTED` 必须在执行前已 emit

#### Scenario: 敏感内容不 emit 流式 TOOL_STRUCTURED_DELTA

- **WHEN** Bash 流式执行期间一个帧的 `content` 包含 `api_key`、`authorization`、`credential`、`password`、`secret` 或 `token` 模式
- **THEN** 该帧 MUST NOT emit `TOOL_STRUCTURED_DELTA`
- **AND** 该帧 MUST 走 `CAPABILITY_RESULT_DELTA` 路径

### Requirement: 结构化增量按run与Tool调用隔离聚合

系统 MUST 将每个非 Workflow `TOOL_STRUCTURED_DELTA` 的聚合身份定义为 `(runId, toolCallId)`。不同 run 即使使用相同 `toolCallId`，接收、聚合、显式 flush、run 终止兜底 flush 和状态清理也 MUST 互不读取、互不删除、互不写入对方数据。历史 record 的 Agent Scope、Owner Scope、session、request 和 run 坐标 MUST 来自该 record 所属 run 的可信上下文。

**需求类别**：系统质量属性

**质量属性**：可靠性/恢复、安全

**适用范围**：该 Function

#### Scenario: 并发run使用相同toolCallId仍独立flush

- **GIVEN** run A 与 run B 并发发出相同 `toolCallId` 的 PIU 增量且内容不同
- **WHEN** 系统先 flush run A
- **THEN** 只 MUST 提交 run A 的聚合内容和坐标
- **AND** run B 的待处理内容 MUST 保持可独立 flush

#### Scenario: 一个run终止不清除另一个run

- **GIVEN** run A 与 run B 均有相同 `toolCallId` 的未提交增量
- **WHEN** run A 执行终止兜底 flush 或状态清理
- **THEN** run B 的 group MUST 保持不变
- **AND** run B 后续 flush MUST 只产生 run B 的内容

### Requirement: PIU累积uuid合并持久化

同一 `(runId, toolCallId)` 内，系统收到 `toolMessageType=PIU` 且 `content.uuid` 为非空字符串时，MUST 按 `uuid` 将每条 `content.data` 作为一个完整数组项顺序累积。输出 MUST 保留第一条 PIU content 的其他字段，并把 `data` 设为累积数组。无 `uuid` 的 PIU MUST 按接收顺序逐条持久化。

单条持久化记录需要容量截断时，PIU `content` MUST 保持对象、`data` MUST 保持数组，并且只保留能完整放入记录预算的前缀项；MUST NOT 把对象或数组 JSON 化为字符串。

**需求类别**：功能性需求

#### Scenario: 同uuid的PIU按顺序合并

- **GIVEN** 同一聚合身份下依次收到 `uuid=abc` 且 data 为 `{x:1}`、`{x:2}`、`{x:3}` 的三条 PIU
- **WHEN** 系统 flush 该聚合身份
- **THEN** 输出 PIU 的 `content.data` MUST 为 `[{x:1},{x:2},{x:3}]`
- **AND** `content.uuid` MUST 为 `abc`

#### Scenario: 超限PIU只保留完整数组项

- **GIVEN** 聚合 PIU 的 data 数组不能完整放入单记录预算
- **WHEN** 系统形成有界历史记录
- **THEN** `content` MUST 仍为对象且 `content.data` MUST 仍为数组
- **AND** retained data MUST 是原数组的完整前缀项
- **AND** record MUST 携带 `truncated=true`

### Requirement: STREAM_DSL按content.type聚合持久化

同一 `(runId, toolCallId)` 内，系统 MUST 顺序拼接 `toolMessageType=STREAM_DSL` 且 `content.type=dsl` 的内层 `content.content` 字符串。`dataModel`、`done` 或 `error` 到达时，系统 MUST 先关闭并排入当前 dsl 结果，再按接收顺序排入该事件；flush 时未关闭的 dsl buffer MUST 作为最后一个 dsl 结果输出。

单条 dsl 记录需要容量截断时，`content` MUST 保持对象、`content.type` MUST 保持 `dsl`、内层 `content.content` MUST 保持字符串并在 UTF-8 code point 边界保留前缀。

**需求类别**：功能性需求

#### Scenario: dataModel到done顺序保持

- **GIVEN** 系统依次收到 `dataModel`、dsl `a`、dsl `b`、`done`
- **WHEN** 系统 flush
- **THEN** history MUST 依次得到 `dataModel`、dsl `ab`、`done`

#### Scenario: 超限dsl保持可解析shape

- **GIVEN** 拼接后的 dsl 字符串包含中文或 emoji 且超过单记录预算
- **WHEN** 系统形成有界历史记录
- **THEN** `content` MUST 保持 `{type:"dsl", content:string}` shape
- **AND** 字符串 MUST NOT 以破坏 UTF-8 code point 的位置结束
- **AND** record MUST 携带 `truncated=true`

### Requirement: 其他结构化增量按接收顺序持久化

对于 PIU 无 `uuid`、STREAM_DSL 的非 dsl 事件以及 `TEXT`、`DSL`、`ACTION`、`OPERATOR`、`FILE`，系统 MUST 按接收顺序逐条持久化。容量内的 `content` MUST 原样保留；超限时字符串、数组或对象 MUST 保持各自 JSON 类型并保留能够完整放入预算的前缀内容，同时设置 `truncated=true`。

**需求类别**：功能性需求

#### Scenario: 容量内TEXT逐条保持

- **GIVEN** 同一 Tool 调用依次发出 TEXT `hello` 与 `world`
- **WHEN** 系统 flush
- **THEN** history MUST 按顺序包含两条记录
- **AND** 两条 `content` MUST 分别为 `hello` 与 `world`

#### Scenario: 超限对象不变成字符串

- **GIVEN** 一个对象 content 超过单记录预算
- **WHEN** 系统形成有界历史记录
- **THEN** 该 `content` MUST 仍为 JSON object
- **AND** MUST NOT 变成 JSON 字符串
- **AND** record MUST 携带 `truncated=true`

### Requirement: 结构化增量聚合状态有界

系统 MUST 使用固定的内部容量预算限制每个 active run 最多 64 个待处理 Tool 调用 group、每个 group 最多 256 个待处理源事件以及 49,000 UTF-8 bytes 的待处理源 `inlinePayload`。达到任一 group 上限前，系统 MUST 先将已完成聚合批次通过既有 timeline 路径提交，再接收下一批；run group 数达到上限时 MUST 先提交最早待处理 group。单个源事件本身超过 byte 上限时 MUST 不进入驻留 accumulator，而是立即走同一有界 record 写入路径。

到界分批 MUST NOT 丢弃未超出单记录内容预算的完整源事件，MUST NOT 再通知一次 live subscriber，也 MUST NOT 改变 request terminal status。系统 MUST NOT 从 client payload、Tool payload 或 provider 配置覆盖这些上限。

**需求类别**：系统质量属性

**质量属性**：性能/容量、可靠性/恢复

**适用范围**：该 Function

#### Scenario: 第257个源事件触发分批但不无界驻留

- **GIVEN** 一个 group 已驻留 256 个源事件
- **WHEN** 第 257 个源事件到达
- **THEN** 系统 MUST 先提交前一批聚合结果
- **AND** 第 257 个事件 MUST 进入新的有界批次
- **AND** live subscriber MUST NOT 因分批收到重复事件

#### Scenario: 第65个group触发最早group提交

- **GIVEN** 一个 run 已有 64 个待处理 Tool 调用 group
- **WHEN** 新的 `toolCallId` 创建第 65 个 group
- **THEN** 系统 MUST 先提交最早待处理 group
- **AND** 驻留 group 数 MUST 不超过 64

#### Scenario: 单个超大事件不进入accumulator

- **GIVEN** 一个源 `inlinePayload` 已超过 49,000 UTF-8 bytes
- **WHEN** 聚合层接收该事件
- **THEN** 该事件 MUST 立即进入有界 record 写入路径
- **AND** accumulator MUST NOT 保留该超大 payload

### Requirement: 结构化增量显式flush与run终止兜底flush

Tool 执行完成后，系统 MUST 先成功追加普通 `CAPABILITY_RESULT` Message，再由 Runtime 私有地 flush 指定 `(runId, toolCallId)`；Message 写入失败时 MUST NOT 留下新的 durable presentation snapshot。run 终止时 MUST 兜底处理该 run 的全部未提交 group，但没有对应成功 result Message 的 partial snapshot MUST 只表示该 run 的不完整 UI presentation，MUST NOT 被视为 completed Capability result、模型上下文或 terminal answer。flush 写入聚合记录时 MUST NOT 触发 `onTimelineAppend` 或等价的第二次 subscriber 通知。显式与兜底 flush MUST 使用同一聚合和容量规则；空 flush MUST 不写入记录。该 flush MUST 是 Runtime 私有机制，MUST NOT 作为 `AgentRunStatePort` 公共方法暴露给 Core。

**需求类别**：功能性需求

#### Scenario: 显式flush只清空指定聚合身份

- **GIVEN** 同一 run 的两个 `toolCallId` 均有待处理内容
- **WHEN** 系统显式 flush 其中一个 `toolCallId`
- **THEN** 只 MUST 提交并清空指定 group
- **AND** 另一个 group MUST 保持待处理

#### Scenario: Message写入失败不留下过渡snapshot

- **GIVEN** 一个 ordinary Capability 已产生待提交的 structured presentation group
- **WHEN** 对应 `CAPABILITY_RESULT` Message 写入失败
- **THEN** 系统 MUST NOT flush 或持久化该 group 为新的 completed presentation snapshot
- **AND** 失败 MUST 进入既有显式安全失败路径

#### Scenario: run终止提交剩余group且不重复通知

- **GIVEN** run 终止时有两个未提交 group
- **WHEN** 系统执行兜底 flush
- **THEN** 两个 group MUST 各自按规则提交
- **AND** subscriber MUST NOT 收到 flush 产生的重复实时事件

#### Scenario: timeline append失败不被吞掉

- **GIVEN** flush 形成了容量合规的 record
- **AND** timeline gateway 拒绝该写入
- **WHEN** 系统等待 flush
- **THEN** 失败 MUST 向上传播
- **AND** 系统 MUST NOT 把该 group 报告为已可靠持久化
