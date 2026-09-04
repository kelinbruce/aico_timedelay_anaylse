# tool-structured-delta Specification Delta

所属 Function：tool-structured-delta
Function 变更类型：修改
spec 角色：主规格

## MODIFIED Requirements

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

## ADDED Requirements

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

## Function 变更汇总

### 处理过程

变更类型：修改
目标内容：`TOOL_STRUCTURED_DELTA` 的 emit 时机从"仅 capability 执行完成后一次性识别"扩展为"Bash 流式执行期间可通过 `emitResultDelta` 回调逐帧 emit + 完成后去重兜底"。`emitResultDelta` 回调在 `tryEmitWorkflowToolDelta` 之后新增 `tryEmitStructuredDelta` 桥接；完成后 `tryEmitToolStructuredDelta` 受 `structuredDeltaEmittedDuringExecution` 标志保护，流式期间已 emit 时不重复。
依据 Requirements：TOOL_STRUCTURED_DELTA Does Not Replace CAPABILITY_RESULT_DELTA、Bash Streaming Structured Delta Emission
