# tool-structured-delta Specification Delta

所属 Function：`FN-5.16 识别和投射结构化工具增量`
Function 变更类型：修改
spec 角色：主规格

## MODIFIED Requirements

### Requirement: Security Constraints

The `TOOL_STRUCTURED_DELTA` content MUST NOT contain credentials, tokens, raw provider errors, or prompt text. The `toolMessageType` validation MUST reject unknown types before emission. The `content` field for ACTION and OPERATOR types MUST be a JSON string whose `data` field is an object string safe to `JSON.parse` on the client side.

For `FILE` `toolMessageType` only, the `content` field MAY carry a complete HOFS object name (a remote object-storage reference used as a download locator handle, e.g. `aicoservice/answer/{sessionId}/{chatId}/result.xlsx`). This is a controlled exception to the general prohibition on file paths in `TOOL_STRUCTURED_DELTA` content: the HOFS object name is NOT a local filesystem path and NOT an execution path; it is an opaque remote object reference consumed solely by the download endpoint to locate the file for proxy download. For all other `toolMessageType` values (PIU, DSL, ACTION, OPERATOR, TEXT), the `content` MUST NOT contain file paths of any kind, including HOFS object names. Credential, token, raw provider error, and prompt text prohibitions apply to all `toolMessageType` values including FILE.

结构化 credential indicator 关键字集合 MUST 包含 `api_key`、`credential`、`password`、`secret` 和 `token`，且 MUST NOT 包含 `authorization`。仅包含 `authorization` 的内容 MUST 保持可进入 structured delta emission；包含该关键字集合中任一关键字的内容 MUST NOT emit `TOOL_STRUCTURED_DELTA`。

**需求类别**：系统质量属性
**质量属性**：安全
**适用范围**：该 Function

#### Scenario: FILE content with HOFS object name accepted

- **WHEN** a CLIP structured event has `toolMessageType: "FILE"` and `content` is a complete HOFS object name string (e.g. `aicoservice/answer/sess1/run1/result.xlsx`)
- **THEN** the tool-loop MUST emit `TOOL_STRUCTURED_DELTA` with the FILE message type and the object name preserved in `content`
- **AND** the event MUST be available for frontend download card rendering

#### Scenario: Non-FILE content with file path rejected

- **WHEN** a CLIP structured event has `toolMessageType` other than `FILE` (e.g. `TEXT`) and `content` contains a file path or HOFS object name
- **THEN** the tool-loop MUST NOT emit `TOOL_STRUCTURED_DELTA` for that event
- **AND** the result MUST fall back to `CAPABILITY_RESULT_DELTA` with the full payload (model still sees it)

#### Scenario: FILE content with credentials rejected

- **WHEN** a CLIP structured event has `toolMessageType: "FILE"` and `content` contains `api_key`, `credential`, `password`, `secret`, or `token` patterns
- **THEN** the tool-loop MUST NOT emit `TOOL_STRUCTURED_DELTA` for that event
- **AND** the result MUST fall back to `CAPABILITY_RESULT_DELTA` with the full payload (model still sees it)

#### Scenario: Content with credentials rejected

- **WHEN** a CLIP structured event content contains `api_key`, `credential`, `password`, `secret`, or `token` patterns
- **THEN** the tool-loop MUST NOT emit `TOOL_STRUCTURED_DELTA` for that event
- **AND** the result MUST fall back to `CAPABILITY_RESULT_DELTA` with the full payload (model still sees it)

#### Scenario: 仅包含 authorization 的内容保持结构化投影

- **WHEN** CLIP structured event 的 `content` 包含 `authorization`，但不包含 `api_key`、`credential`、`password`、`secret` 或 `token`
- **THEN** tool-loop MUST 为该事件 emit `TOOL_STRUCTURED_DELTA`

### Requirement: TOOL_STRUCTURED_DELTA Does Not Replace CAPABILITY_RESULT_DELTA

`TOOL_STRUCTURED_DELTA` MUST NOT 替换普通 Capability 的 terminal 语义。对于完成后一次性识别的结构化结果（CLIP provider、Bash 非流式、ApiCall 非流式），`CAPABILITY_RESULT_DELTA` 和 `TOOL_STRUCTURED_DELTA` 都 MUST 被 emit，且 MUST 调用 `appendCapabilityResultMessage`。

对于 Bash 流式执行，每个匹配结构化形状的帧 MUST emit `TOOL_STRUCTURED_DELTA`，并跳过该帧的 `CAPABILITY_RESULT_DELTA`；每个不匹配的帧 MUST 走该帧的 `CAPABILITY_RESULT_DELTA`。执行期间已经 emit 过任何 result delta 时，成功完成后 MUST NOT 再 emit terminal `CAPABILITY_RESULT_DELTA`。`CAPABILITY_COMPLETED` 和 `appendCapabilityResultMessage` 的 terminal 语义 MUST 保持不变。

当 Bash 流式执行期间已经 emit 过至少一条 `TOOL_STRUCTURED_DELTA` 时，完成后 MUST 跳过 `tryEmitToolStructuredDelta`，避免对同一 stdout 内容重复 emit `TOOL_STRUCTURED_DELTA`。当流式执行期间没有 emit 任何 `TOOL_STRUCTURED_DELTA` 时，完成后的识别行为 MUST 与 Bash 非流式一致。

**需求类别**：功能性需求

#### Scenario: 流式结构化帧后不重复 terminal 结果增量

- **WHEN** Bash 以 `stream_format: "sse"` 执行，执行期间已 emit `TOOL_STRUCTURED_DELTA`
- **THEN** 执行完成后 MUST NOT emit terminal `CAPABILITY_RESULT_DELTA`
- **AND** MUST 仍 emit `CAPABILITY_COMPLETED`
- **AND** MUST 仍调用 `appendCapabilityResultMessage` 存储 terminal 结果

#### Scenario: 流式非结构化帧后不重复 terminal 结果增量

- **WHEN** Bash 以 `stream_format: "ndjson"` 执行，执行期间已 emit 一条或多条 per-frame `CAPABILITY_RESULT_DELTA`
- **THEN** 执行完成后 MUST NOT 再 emit terminal `CAPABILITY_RESULT_DELTA`
- **AND** MUST 仍 emit `CAPABILITY_COMPLETED`
- **AND** MUST 仍调用 `appendCapabilityResultMessage`

#### Scenario: 无流式 result delta 时保持 terminal 结果增量

- **WHEN** Bash 未使用流式执行路径，或流式执行期间没有调用 result delta callback
- **THEN** 成功完成后 MUST 保持既有 terminal `CAPABILITY_RESULT_DELTA` 行为

#### Scenario: 流式 emit 后完成后不重复 emit TOOL_STRUCTURED_DELTA

- **WHEN** Bash 流式执行期间已 emit 至少一条 `TOOL_STRUCTURED_DELTA`
- **THEN** 执行完成后 MUST NOT 再次 emit `TOOL_STRUCTURED_DELTA`

#### Scenario: 流式执行期间无匹配帧时完成后正常识别

- **WHEN** Bash 工具以 `stream_format: "sse"` 执行，但所有 SSE 帧均不匹配结构化事件形状
- **THEN** 执行期间 MUST NOT emit 任何 `TOOL_STRUCTURED_DELTA`
- **AND** 完成后 `tryEmitToolStructuredDelta` MUST 正常执行
- **AND** 成功完成后 MUST NOT 再 emit terminal `CAPABILITY_RESULT_DELTA`

#### Scenario: 非流式 Bash 仍同时 emit 两个事件

- **WHEN** Bash 未设置 `stream_format`，执行完成后 stdout 匹配结构化事件形状
- **THEN** tool-loop MUST emit `TOOL_STRUCTURED_DELTA`
- **AND** MUST 也 emit `CAPABILITY_RESULT_DELTA`
- **AND** MUST 调用 `appendCapabilityResultMessage`

### Requirement: Streaming TOOL_STRUCTURED_DELTA Persistence

runtime persistence policy MUST 继续把 `inlinePayload.streaming === true` 的 `TOOL_STRUCTURED_DELTA` 分类为 `PERSISTED`，并把无 `streaming` 字段的非 Workflow 事件分类为 `LIVE_ONLY`。对于两种分类结果，runtime-owned 聚合层 MUST 在 live 投影后接管所有经过可信识别的非 Workflow structured presentation `TOOL_STRUCTURED_DELTA`，按既有聚合规则提交到 timeline store；因此非流式 presentation 也 MUST 可从 durable history 读取。该 timeline body MUST 只作为 Channel/UI presentation，MUST NOT 取代 `CAPABILITY_RESULT` Message 的 ordinary Capability 语义结果，也 MUST NOT 进入模型上下文。

Workflow `TOOL_STRUCTURED_DELTA` MUST 保持既有分类：`NODE_COMPLETED` product 为 `PERSISTED`，`NODE_OUTPUT_DELTA` fragment 为 `LIVE_ONLY`；匹配 Workflow product 规则的事件 MUST NOT 进入非 Workflow 聚合层。Workflow `NODE_COMPLETED` product 超过持久化容量时，系统 MUST 继续形成携带显式截断事实的 durable bounded product，而不是改为仅实时事件；settled live 与 cold history MUST 使用该同一 product 替换先前 fragment。

同一条非 Workflow `TOOL_STRUCTURED_DELTA` 事实 MUST 只分配一个 runtime event identity，并在实时 stream envelope 与持久化 run event history 投影中保持一致：两个投影的 `eventId` MUST 相同，且 `timelineEventRef` MUST 指向同一 runtime event。浏览器合并 live stream 与 run event history 时，MUST 依据该 identity 将两者识别为同一事实并只呈现一次。

**需求类别**：功能性需求

#### Scenario: 流式结构化增量聚合后持久化

- **WHEN** 同一 Tool 调用发出多条携带 `streaming=true` 的非 Workflow 结构化增量
- **THEN** live subscriber MUST 按接收顺序收到每条实时增量
- **AND** timeline history MUST 在 flush 后包含按既有规则形成的聚合记录

#### Scenario: 非流式结构化增量也可从历史读取

- **WHEN** 非流式结构化增量被 persistence policy 分类为 `LIVE_ONLY`
- **THEN** live subscriber MUST 仍收到该实时事件
- **AND** 聚合层 MUST 在 flush 后把其结果写入 timeline history

#### Scenario: live 与 history 使用同一 event identity

- **WHEN** 一条非 Workflow `TOOL_STRUCTURED_DELTA` 先被实时投递，随后作为 run event history 被浏览器加载
- **THEN** 两个投影 MUST 使用相同 event identity
- **AND** 浏览器 MUST 只保留并呈现一份该事实

#### Scenario: Pending Input 超时后不重复渲染结构化帧

- **GIVEN** Bash 流式执行已向浏览器投递两条 `TOOL_STRUCTURED_DELTA`
- **WHEN** 后续 Pending Input 超时导致运行进入可加载历史状态，浏览器加载 run event history
- **THEN** 已实时投递的两条结构化增量 MUST NOT 被历史投影再次渲染

#### Scenario: 容量内Workflow product保持既有持久化路径

- **WHEN** 容量内 `TOOL_STRUCTURED_DELTA` 匹配既有 Workflow `NODE_COMPLETED` product 规则
- **THEN** 该事件 MUST 按既有 Workflow classification 与 append 路径处理
- **AND** 非 Workflow 聚合层 MUST NOT 再次暂存或提交该事件

#### Scenario: 超长Workflow completed product形成可恢复的有界历史

- **GIVEN** Workflow `NODE_OUTPUT_DELTA` fragment 已按既有规则实时投影
- **AND** 对应 `NODE_COMPLETED` `TOOL_STRUCTURED_DELTA.inlinePayload` 超过 49,000 UTF-8 bytes
- **WHEN** 系统提交该 completed product
- **THEN** durable history MUST 包含满足持久化容量契约的 product
- **AND** product MUST 携带 `truncated=true`
- **AND** MUST 保留 `capabilityId`、`toolCallId`、`toolEventType`、`toolMessageType`、`accumulated`、`workflowEventType`、`nodeId` 与 `nodeType`
- **AND** settled live 与 cold history MUST 使用同一有界 `content` 和 `truncated` 事实替换 fragment
- **AND** 系统 MUST NOT 再发布一份完整的 `LIVE_ONLY` completed product

### Requirement: Bash Streaming Structured Delta Emission

当 Bash 工具收到 `stream_format` 为 `'sse'` 或 `'ndjson'` 且 sandbox 执行端口支持 `runShellStreaming` 时，Bash 工具 MUST 使用流式执行路径：通过 `runShellStreaming` 的 `onStdoutChunk` 回调逐块接收 stdout 数据，使用帧分割逻辑将 chunk 分割为独立帧，每帧提取结构化 payload 后通过 `emitResultDelta` 回调传递给 tool-loop。

tool-loop 的 `emitResultDelta` 回调 MUST 在 `tryEmitWorkflowToolDelta` 之后、`CAPABILITY_RESULT_DELTA` 之前调用 `tryEmitStructuredDelta`。当 `structuredPayload` 匹配 `{eventType, messageType, content}` 结构化形状（直接形状或信封形状）时，MUST emit `TOOL_STRUCTURED_DELTA` 并跳过该帧的 `CAPABILITY_RESULT_DELTA` emit。当不匹配时，MUST 走该帧的 `CAPABILITY_RESULT_DELTA` 路径。

tool-loop MUST 维护执行期间 result delta 已发生的标志。Bash 成功完成后，该标志为 true 时 MUST 跳过 terminal `CAPABILITY_RESULT_DELTA`。当流式执行期间 emit 了任何 `TOOL_STRUCTURED_DELTA` 时，完成后 `tryEmitToolStructuredDelta` MUST 被跳过。

当 `stream_format` 未设置、或 sandbox 不支持 `runShellStreaming` 时，Bash 工具 MUST 走现有非流式执行路径（`runShell`/`runShellBackgroundable`/`runPython`），完成后 `tryEmitToolStructuredDelta` 与 terminal `CAPABILITY_RESULT_DELTA` 的行为 MUST 不变。

**需求类别**：功能性需求

#### Scenario: SSE 流式逐帧 emit TOOL_STRUCTURED_DELTA

- **WHEN** Bash 工具以 `stream_format: "sse"` 执行 `curl`，stdout 返回多个 SSE 帧且每帧 `data:` 字段 JSON.parse 后匹配 `{eventType, messageType, content}`
- **THEN** 每收到一个完整 SSE 帧 MUST emit 一条 `TOOL_STRUCTURED_DELTA` 事件
- **AND** 每条事件 MUST 包含 `capabilityId` 和 `toolCallId`
- **AND** 成功完成后 MUST NOT emit terminal `CAPABILITY_RESULT_DELTA`

#### Scenario: NDJSON 流式逐帧 emit TOOL_STRUCTURED_DELTA

- **WHEN** Bash 工具以 `stream_format: "ndjson"` 执行命令，stdout 返回多行 JSON 且每行匹配 `{eventType, messageType, content}`
- **THEN** 每收到一个完整 JSON 行 MUST emit 一条 `TOOL_STRUCTURED_DELTA` 事件
- **AND** 成功完成后 MUST NOT emit terminal `CAPABILITY_RESULT_DELTA`

#### Scenario: SSE data 字段非 JSON 时走 CAPABILITY_RESULT_DELTA

- **WHEN** Bash 流式执行期间一个 SSE 帧的 `data:` 字段不是有效 JSON 或 JSON.parse 后不匹配结构化形状
- **THEN** 该帧 MUST NOT emit `TOOL_STRUCTURED_DELTA`
- **AND** 该帧 MUST 走 `CAPABILITY_RESULT_DELTA` 路径
- **AND** 成功完成后 MUST NOT 再 emit terminal `CAPABILITY_RESULT_DELTA`

#### Scenario: 非结构化 stdout 不触发流式 TOOL_STRUCTURED_DELTA

- **WHEN** Bash 工具设置了 `stream_format: "sse"` 但 stdout 内容不包含任何匹配结构化形状的帧
- **THEN** 执行期间 MUST NOT emit 任何 `TOOL_STRUCTURED_DELTA`
- **AND** 执行期间产生的 per-frame `CAPABILITY_RESULT_DELTA` MUST 保持
- **AND** 成功完成后 MUST NOT 再 emit terminal `CAPABILITY_RESULT_DELTA`

#### Scenario: 流式期间 terminal 语义不变

- **WHEN** Bash 流式执行期间 emit 了多条 `TOOL_STRUCTURED_DELTA`
- **THEN** tool-loop MUST 仍只 emit 恰好一条 `CAPABILITY_COMPLETED`
- **AND** MUST 只 append 至多一条 terminal `CAPABILITY_RESULT` Message
- **AND** `CAPABILITY_STARTED` 必须在执行前已 emit

#### Scenario: 敏感内容不 emit 流式 TOOL_STRUCTURED_DELTA

- **WHEN** Bash 流式执行期间一个帧的 `content` 包含 `api_key`、`credential`、`password`、`secret` 或 `token` 模式
- **THEN** 该帧 MUST NOT emit `TOOL_STRUCTURED_DELTA`
- **AND** 该帧 MUST 走 `CAPABILITY_RESULT_DELTA` 路径

## Function 变更汇总

### 描述

- **变更类型**：修改
- **目标内容**：Bash 流式结构化增量的 per-frame 投影、terminal 去重和 live/history identity 保持一致；`authorization` 不再单独触发安全拒绝，其他 credential indicator 和 terminal Capability 语义保持不变。
- **依据 Requirements**：`TOOL_STRUCTURED_DELTA Does Not Replace CAPABILITY_RESULT_DELTA`、`Streaming TOOL_STRUCTURED_DELTA Persistence`、`Bash Streaming Structured Delta Emission`、`Security Constraints`

### 规格

- **规格项**：Bash 流式 terminal 结果增量
- **变更类型**：修改
- **原规格值**：Bash 流式完成后仍 emit terminal `CAPABILITY_RESULT_DELTA`
- **目标规格值**：执行期间已 emit result delta 时，成功完成后不再 emit terminal `CAPABILITY_RESULT_DELTA`；`CAPABILITY_COMPLETED` 与 `CAPABILITY_RESULT` Message 保持
- **依据 Requirements**：`TOOL_STRUCTURED_DELTA Does Not Replace CAPABILITY_RESULT_DELTA`、`Bash Streaming Structured Delta Emission`

- **规格项**：结构化增量 live/history identity
- **变更类型**：修改
- **原规格值**：同一事实的实时投影与持久化投影可能使用不同 event identity
- **目标规格值**：同一非 Workflow 结构化增量事实在实时与历史投影中使用相同 event identity，浏览器只呈现一次
- **依据 Requirements**：`Streaming TOOL_STRUCTURED_DELTA Persistence`

- **规格项**：结构化增量 credential indicator 关键字
- **变更类型**：修改
- **原规格值**：`authorization` 与其他 credential indicator 一样触发结构化增量拒绝
- **目标规格值**：仅包含 `authorization` 的内容可投射结构化增量；`api_key`、`credential`、`password`、`secret` 或 `token` 仍触发拒绝
- **依据 Requirements**：`Security Constraints`

### 主规格

- **变更类型**：修改
- **目标内容**：`tool-structured-delta`
- **依据 Requirements**：`TOOL_STRUCTURED_DELTA Does Not Replace CAPABILITY_RESULT_DELTA`、`Streaming TOOL_STRUCTURED_DELTA Persistence`、`Bash Streaming Structured Delta Emission`、`Security Constraints`
