# tool-structured-delta Specification Delta

## MODIFIED Requirements

### Requirement: 非 CLIP 结果绝不发出 TOOL_STRUCTURED_DELTA

系统 MUST NOT 为结构化 delta whitelist 之外的 tool 发出 `TOOL_STRUCTURED_DELTA`。whitelist 由以下组成：CLIP custom capability provider（`providerType === "clip_server"`，legacy 路径保留但生产未使用）、Bash capability（`capabilityId === "Bash"`）和 ApiCall capability（`capabilityId === "ApiCall"`）。所有其他 tool（Read、Write、Skill、Agent 等）不论 payload 形状如何都 MUST NOT 发出 `TOOL_STRUCTURED_DELTA`。所有非 whitelist tool 的既有 `CAPABILITY_RESULT_DELTA` 流程 MUST 保持不变。

#### Scenario: 非 whitelist tool 绝不发出 TOOL_STRUCTURED_DELTA

- **WHEN** whitelist 之外的某个 tool（Read、Write、Skill、Agent 等）返回结果
- **THEN** 系统不论 payload 形状如何都 MUST NOT 发出任何 `TOOL_STRUCTURED_DELTA` 事件
- **AND** 既有 `CAPABILITY_RESULT_DELTA` 流程 MUST 保持不变

#### Scenario: Bash 非结构化 stdout 不发出 TOOL_STRUCTURED_DELTA

- **WHEN** 某个 Bash tool 返回的结果 stdout 既不匹配直接结构化事件形态，也不匹配结构化事件信封
- **THEN** 系统 MUST NOT 发出任何 `TOOL_STRUCTURED_DELTA` 事件
- **AND** 既有 `CAPABILITY_RESULT_DELTA` 流程 MUST 保持不变

#### Scenario: ApiCall 非结构化 response 不发出 TOOL_STRUCTURED_DELTA

- **WHEN** 某个 ApiCall tool 返回非流式结果，其 `structuredPayload` 既不匹配直接结构化事件形态，也不匹配结构化事件信封
- **THEN** 系统 MUST NOT 发出任何 `TOOL_STRUCTURED_DELTA` 事件
- **AND** 既有 `CAPABILITY_RESULT_DELTA` 流程 MUST 保持不变

### Requirement: CLIP Provider 识别

系统 MUST 尝试对以下对象做结构化 delta 识别：CLIP custom capability provider（`providerKind === "CUSTOM"` 且 `providerType === "clip_server"`，legacy 路径保留但生产未使用）、Bash capability（`capabilityId === "Bash"`，在 tool-loop 中识别）和 ApiCall capability（`capabilityId === "ApiCall"`，在 orchestration 层识别）。所有其他 provider/capability 组合 MUST 完全跳过结构化 delta 识别。

#### Scenario: CLIP provider 触发结构化识别（legacy）

- **WHEN** 解析出的 capability descriptor 具有 `provider.providerKind === "CUSTOM"` 且 `provider.providerType === "clip_server"`
- **THEN** tool-loop MUST 对结果 payload 尝试结构化 delta 识别
- **NOTE**：该路径是 legacy 路径，生产未使用。代码保留但不会被主动执行。

#### Scenario: Bash capability 触发结构化识别

- **WHEN** 解析出的 capability descriptor 具有 `capabilityId === "Bash"`
- **THEN** tool-loop MUST 对结果 payload 尝试结构化 delta 识别

#### Scenario: ApiCall capability 触发结构化识别

- **WHEN** orchestration 层通过 `capabilityInvocation.invoke()` 调用 ApiCall capability
- **THEN** orchestration 层 MUST 对结果尝试结构化 delta 识别

#### Scenario: 非 whitelist capability 跳过结构化识别

- **WHEN** 解析出的 capability descriptor 既不是 CLIP provider，也不是 Bash 和 ApiCall
- **THEN** 系统 MUST NOT 尝试结构化 delta 识别
- **AND** MUST NOT 发出任何 `TOOL_STRUCTURED_DELTA` 事件

### Requirement: 结构化事件形状校验

系统 MUST 在发出 `TOOL_STRUCTURED_DELTA` 之前校验结构化事件形状。`toolEventType` 字段（由 `eventType` 映射而来）MUST 是 `TITLE`、`DETAIL`、`ANSWER`、`SUB_TITLE`、`SUB_DETAIL`、`SUB_CONCLUSION`、`EXPAND_PANEL` 之一。`toolMessageType` 字段（由 `messageType` 映射而来）MUST 是 `PIU`、`DSL`、`ACTION`、`OPERATOR`、`FILE`、`TEXT` 之一。`content` 字段 MUST 存在。若校验失败，结果 MUST 回退到既有的 `CAPABILITY_RESULT_DELTA` channel。

系统 MUST 支持两种识别形态：

1. **直接形态**：候选 JSON 对象本身就是结构化事件，匹配 `{eventType, messageType, content}`。
2. **信封形态**：候选 JSON 对象是 `{"status":"ok","data":{"raw":"<json-string>"}}`，其中 `raw` 字段是一个 JSON 字符串，解析后得到 `{eventType, messageType, content}`。

两种形态 MUST 使用相同的 `TOOL_EVENT_TYPES` 和 `TOOL_MESSAGE_TYPES` enum 校验。两种形态 MUST 使用相同的 `hasSensitiveStructuredContent` 安全检查。

#### Scenario: 直接形态被接受

- **WHEN** 某个候选 JSON 对象具有有效的 `eventType`、`messageType` 和 `content` 字段
- **THEN** 系统 MUST 发出携带解析后事件数据的 `TOOL_STRUCTURED_DELTA`

#### Scenario: 信封形态被接受

- **WHEN** 某个候选 JSON 对象是 `{"status":"ok","data":{"raw":"{\"eventType\":\"ANSWER\",\"messageType\":\"TEXT\",\"content\":\"recovery\"}"}}`
- **THEN** 系统 MUST 把 `data.raw` 解析为 JSON
- **AND** MUST 把解析后的对象校验为结构化事件
- **AND** MUST 发出 `TOOL_STRUCTURED_DELTA`，其中 `toolEventType: "ANSWER"`、`toolMessageType: "TEXT"`、`content: "recovery"`

#### Scenario: status 非 ok 的信封回退

- **WHEN** 某个候选 JSON 对象是 `{"status":"error","data":{"raw":"..."}}`
- **THEN** 系统 MUST NOT 发出 `TOOL_STRUCTURED_DELTA`
- **AND** 结果 MUST 回退到 `CAPABILITY_RESULT_DELTA`

#### Scenario: raw 畸形的信封回退

- **WHEN** 某个候选 JSON 对象是 `{"status":"ok","data":{"raw":"not valid json"}}`
- **THEN** 系统 MUST NOT 发出 `TOOL_STRUCTURED_DELTA`
- **AND** 结果 MUST 回退到 `CAPABILITY_RESULT_DELTA`

#### Scenario: 非法 eventType 被拒绝

- **WHEN** 某个结构化事件的 `eventType` 为 "UNKNOWN"、`messageType` 为 "TEXT"
- **THEN** 系统 MUST NOT 发出 `TOOL_STRUCTURED_DELTA`
- **AND** 结果 MUST 回退到 `CAPABILITY_RESULT_DELTA`

#### Scenario: 非法 messageType 被拒绝

- **WHEN** 某个结构化事件的 `eventType` 为 "ANSWER"、`messageType` 为 "UNKNOWN"
- **THEN** 系统 MUST NOT 发出 `TOOL_STRUCTURED_DELTA`
- **AND** 结果 MUST 回退到 `CAPABILITY_RESULT_DELTA`

## ADDED Requirements

### Requirement: Bash 结构化 delta 识别

当解析出的 capability descriptor 具有 `capabilityId === "Bash"` 时，tool-loop MUST 尝试结构化 delta 识别。tool-loop MUST 先校验 `exitCode === 0` 和 `stdoutTruncated !== true`，再检查 `stdout` 是以 `{` 开头的字符串。这些前置条件通过后，tool-loop MUST 把 `stdout` 解析为 JSON 以获得候选对象，然后用共享检测逻辑尝试直接形态和信封形态两种识别。任一形态匹配时，tool-loop MUST 发出携带解析后事件数据的 `TOOL_STRUCTURED_DELTA` 事件。任何解析或校验步骤失败时，结果 MUST 回退到既有的 `CAPABILITY_RESULT_DELTA` channel。

发出的 `TOOL_STRUCTURED_DELTA` 事件 MUST 是 LIVE_ONLY（不持久化到 timeline store），因为该事件 inlinePayload 不包含 `workflowEventType`。本变更不支持从已存储 `CAPABILITY_RESULT` 消息重建 Bash 的历史（延期）。

#### Scenario: Bash 直接结构化事件发出 TOOL_STRUCTURED_DELTA

- **WHEN** 某个 Bash tool 返回 `exitCode: 0`，且 `stdout` 是匹配 `{"eventType":"ANSWER","messageType":"TEXT","content":"recovery steps"}` 的 JSON 字符串
- **THEN** tool-loop MUST 发出一个 `TOOL_STRUCTURED_DELTA` 事件，其中 `toolEventType: "ANSWER"`、`toolMessageType: "TEXT"`、`content: "recovery steps"`
- **AND** 该事件 MUST 包含 `capabilityId` 和 `toolCallId`
- **AND** 该事件 MUST 是 LIVE_ONLY（不持久化）

#### Scenario: Bash 信封结构化事件发出 TOOL_STRUCTURED_DELTA

- **WHEN** 某个 Bash tool 返回 `exitCode: 0`，且 `stdout` 是匹配 `{"status":"ok","data":{"raw":"{\"eventType\":\"ANSWER\",\"messageType\":\"TEXT\",\"content\":\"recovery steps\"}"}}` 的 JSON 字符串
- **THEN** tool-loop MUST 发出一个 `TOOL_STRUCTURED_DELTA` 事件，其中 `toolEventType: "ANSWER"`、`toolMessageType: "TEXT"`、`content: "recovery steps"`
- **AND** 该事件 MUST 包含 `capabilityId` 和 `toolCallId`
- **AND** 该事件 MUST 是 LIVE_ONLY（不持久化）

#### Scenario: Bash 非 JSON stdout 不触发结构化识别

- **WHEN** 某个 Bash tool 返回 `exitCode: 0` 且 `stdout` 为 `"hello world"`（不以 `{` 开头）
- **THEN** tool-loop MUST NOT 尝试结构化 delta 识别
- **AND** 既有 `CAPABILITY_RESULT_DELTA` 流程 MUST 保持不变

#### Scenario: Bash 非零 exit code 跳过结构化识别

- **WHEN** 某个 Bash tool 返回 `exitCode !== 0`
- **THEN** tool-loop MUST NOT 尝试结构化 delta 识别
- **AND** 结果 MUST 走既有的 degraded result 路径

#### Scenario: Bash 截断的 stdout 跳过结构化识别

- **WHEN** 某个 Bash tool 返回 `stdoutTruncated: true`
- **THEN** tool-loop MUST NOT 尝试结构化 delta 识别
- **AND** 结果 MUST 走既有结果路径

#### Scenario: Bash 结构化 delta 不干扰 CAPABILITY_RESULT_DELTA

- **WHEN** 某个 Bash 结构化事件被成功作为 `TOOL_STRUCTURED_DELTA` 发出
- **THEN** tool-loop MUST 仍发出 `CAPABILITY_RESULT_DELTA` 和 `CAPABILITY_COMPLETED` 事件
- **AND** tool-loop MUST 仍通过 `appendCapabilityResultMessage` 持久化结果

### Requirement: ApiCall 结构化 delta 识别

orchestration 层（`agent-core` 路由）在调用 ApiCall capability 时 MUST 尝试结构化 delta 识别。ApiCall 是由 orchestration 层通过 `capabilityInvocation.invoke()` 以编程方式调用的非模型可见 tool，而不是通过模型驱动的 tool-loop。因此，ApiCall 的结构化 delta 检测 MUST 发生在 orchestration 层，而不是 `tryEmitToolStructuredDelta` 中。

对于非流式结果，orchestration 层 MUST 在 `capabilityInvocation.invoke()` 返回后对 `apiResult.structuredPayload` 尝试识别。对于流式结果，orchestration 层 MUST 传入 `runtimeContext.emitResultDelta` callback；每个 SSE `chunk.data` 字符串 MUST 被解析为 JSON 以获得候选对象，然后经过共享检测逻辑（直接形态和信封形态）。任一形态匹配时，MUST 发出一个 `TOOL_STRUCTURED_DELTA` 事件。没有形态匹配或 JSON 解析失败时，该 chunk MUST 落入既有的 `CAPABILITY_RESULT_DELTA` channel。

对于流式结果，orchestration 层 MUST 对每个 chunk 独立尝试识别。每个匹配的 chunk MUST 发出自己的 `TOOL_STRUCTURED_DELTA` 事件。流式终止时的 `structuredPayload`（空对象 `{}`）MUST NOT 触发重复的 `TOOL_STRUCTURED_DELTA` 发出。

ApiCall 发出的所有 `TOOL_STRUCTURED_DELTA` 事件 MUST 是 LIVE_ONLY。

#### Scenario: ApiCall 非流式直接形态发出 TOOL_STRUCTURED_DELTA

- **WHEN** orchestration 层调用 ApiCall，结果 `structuredPayload` 为 `{"eventType":"TITLE","messageType":"PIU","content":{"label":"alarm"}}`
- **THEN** orchestration 层 MUST 发出一个 `TOOL_STRUCTURED_DELTA` 事件，其中 `toolEventType: "TITLE"`、`toolMessageType: "PIU"`，content 原样保留
- **AND** 该事件 MUST 包含 `capabilityId` 和 `toolCallId`

#### Scenario: ApiCall 非流式信封形态发出 TOOL_STRUCTURED_DELTA

- **WHEN** orchestration 层调用 ApiCall，结果 `structuredPayload` 为 `{"status":"ok","data":{"raw":"{\"eventType\":\"DETAIL\",\"messageType\":\"DSL\",\"content\":\"diag\"}"}}`
- **THEN** orchestration 层 MUST 解析 `data.raw` 并发出 `TOOL_STRUCTURED_DELTA`，其中 `toolEventType: "DETAIL"`、`toolMessageType: "DSL"`、`content: "diag"`

#### Scenario: ApiCall 流式 chunk 为直接形态时发出 TOOL_STRUCTURED_DELTA

- **WHEN** orchestration 层以流式 `emitResultDelta` callback 调用 ApiCall，且某个 chunk 的 `data` 是匹配 `{"eventType":"ANSWER","messageType":"TEXT","content":"result"}` 的 JSON 字符串
- **THEN** orchestration 层 MUST 为该 chunk 发出一个 `TOOL_STRUCTURED_DELTA` 事件
- **AND** 该事件 MUST 包含 `capabilityId` 和 `toolCallId`

#### Scenario: ApiCall 流式 chunk 为信封形态时发出 TOOL_STRUCTURED_DELTA

- **WHEN** orchestration 层以流式 `emitResultDelta` callback 调用 ApiCall，且某个 chunk 的 `data` 是匹配 `{"status":"ok","data":{"raw":"{\"eventType\":\"ANSWER\",\"messageType\":\"TEXT\",\"content\":\"result\"}"}}` 的 JSON 字符串
- **THEN** orchestration 层 MUST 解析 `data.raw` 并为该 chunk 发出 `TOOL_STRUCTURED_DELTA`

#### Scenario: ApiCall 流式 chunk 无结构化形态时回退

- **WHEN** orchestration 层以流式 `emitResultDelta` callback 调用 ApiCall，且某个 chunk 的 `data` 是不匹配任一形态的 JSON 字符串
- **THEN** orchestration 层 MUST NOT 为该 chunk 发出 `TOOL_STRUCTURED_DELTA`
- **AND** 该 chunk MUST 落入 `CAPABILITY_RESULT_DELTA`

#### Scenario: ApiCall 流式 chunk 数据不可解析时回退

- **WHEN** orchestration 层以流式 `emitResultDelta` callback 调用 ApiCall，且某个 chunk 的 `data` 不是有效 JSON
- **THEN** orchestration 层 MUST NOT 为该 chunk 发出 `TOOL_STRUCTURED_DELTA`
- **AND** 该 chunk MUST 落入 `CAPABILITY_RESULT_DELTA`

#### Scenario: ApiCall 流式终止空 payload 不发出

- **WHEN** 某个 ApiCall 流式结果以 `structuredPayload: {}` 完成
- **THEN** orchestration 层 MUST NOT 从终止 payload 发出重复的 `TOOL_STRUCTURED_DELTA`
- **AND** 只有流式期间匹配的 chunk 发出过 `TOOL_STRUCTURED_DELTA`

#### Scenario: ApiCall 非流式非结构化 response 回退

- **WHEN** orchestration 层调用 ApiCall，结果 `structuredPayload` 不匹配任一形态
- **THEN** orchestration 层 MUST NOT 发出 `TOOL_STRUCTURED_DELTA`
- **AND** 结果 MUST 落入 `CAPABILITY_RESULT_DELTA`
