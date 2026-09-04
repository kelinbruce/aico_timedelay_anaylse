# tool-structured-delta Specification Delta

所属 Function：FN-5.16 识别和投射结构化工具增量
Function 变更类型：修改
spec 角色：主规格

## MODIFIED Requirements

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
