# tool-structured-delta Specification

## MODIFIED Requirements

### Requirement: TOOL_STRUCTURED_DELTA Timeline 事件类型

系统 MUST 在 `agent-common` 的 `TimelineEventType` 中新增 `"TOOL_STRUCTURED_DELTA"`。该事件 MUST 在其 `inlinePayload` 中携带 `capabilityId`、`toolCallId`、`toolEventType`、`toolMessageType` 和 `content`。`toolEventType` 字段 MUST 是 `TITLE`、`DETAIL`、`ANSWER`、`SUB_TITLE`、`SUB_DETAIL`、`SUB_CONCLUSION`、`EXPAND_PANEL` 之一。`toolMessageType` 字段 MUST 是 `PIU`、`DSL`、`ACTION`、`OPERATOR`、`FILE`、`TEXT` 之一。

#### Scenario: CLIP API 结果触发结构化事件

- **WHEN** 一个 CLIP 支撑的 tool 返回一个匹配 `{eventType, content, messageType}` 形态的 `structuredPayload`
- **THEN** tool-loop MUST 发出一个 `TOOL_STRUCTURED_DELTA` timeline 事件，其中原始 `eventType` 映射为 `toolEventType`、`messageType` 映射为 `toolMessageType`，并保留原始 `content`
- **AND** 该事件 MUST 包含 `capabilityId` 和 `toolCallId`，以便与 `CAPABILITY_STARTED` 和 `CAPABILITY_COMPLETED` 关联

#### Scenario: CLIP API 结果触发 EXPAND_PANEL 事件

- **WHEN** 一个 CLIP 支撑的 tool 返回一个带 `eventType: "EXPAND_PANEL"` 的 `structuredPayload`
- **THEN** tool-loop MUST 发出一个带 `toolEventType: "EXPAND_PANEL"` 的 `TOOL_STRUCTURED_DELTA` 事件，其中原始 `messageType` 映射为 `toolMessageType`，并保留原始 `content`
- **AND** 该事件 MUST 包含 `capabilityId` 和 `toolCallId`

#### Scenario: 纯字符串结果作为 ANSWER TEXT 发出（DEFERRED）

- **WHEN** 一个 CLIP 支撑的 tool 返回一个 `string` 类型的 `structuredPayload`
- **THEN** tool-loop MUST 发出一个 `toolEventType: "ANSWER"`、`toolMessageType: "TEXT"` 且 `content` 为该字符串值的 `TOOL_STRUCTURED_DELTA` 事件
- **NOTE**：本 scenario 被延期，因为 `CapabilityInvocationResult.structuredPayload` 的类型是 `JsonObject` 而非 `string`。启用它要么需要为 CLIP source 放宽 `assertCapabilityResultSafe`，要么需要在 CLIP runner 层把该字符串包装为 `{eventType:"ANSWER", messageType:"TEXT", content: string}`。参见 design.md §7（Not in scope）。

#### Scenario: 普通 JSON 结果不发出 TOOL_STRUCTURED_DELTA

- **WHEN** 一个 CLIP 支撑的 tool 返回一个 JSON object 形态但 NOT 匹配结构化事件形态的 `structuredPayload`
- **THEN** tool-loop MUST NOT 发出任何 `TOOL_STRUCTURED_DELTA` 事件
- **AND** 该结果 MUST 落回既有 `CAPABILITY_RESULT_DELTA` 通道

#### Scenario: 非 CLIP 结果永不发出 TOOL_STRUCTURED_DELTA

- **WHEN** 一个非 CLIP tool（Bash、Read、Write、Skill、Agent 等）返回一个结果
- **THEN** 无论 payload 形态如何，tool-loop MUST NOT 发出任何 `TOOL_STRUCTURED_DELTA` 事件
- **AND** 既有 `CAPABILITY_RESULT_DELTA` 流程 MUST 保持不变

### Requirement: 结构化事件形态校验

tool-loop MUST 在发出 `TOOL_STRUCTURED_DELTA` 之前校验结构化事件形态。`toolEventType` 字段（由 `eventType` 映射）MUST 是 `TITLE`、`DETAIL`、`ANSWER`、`SUB_TITLE`、`SUB_DETAIL`、`SUB_CONCLUSION`、`EXPAND_PANEL` 之一。`toolMessageType` 字段（由 `messageType` 映射）MUST 是 `PIU`、`DSL`、`ACTION`、`OPERATOR`、`FILE`、`TEXT` 之一。`content` 字段 MUST 存在。如果校验失败，该结果 MUST fallback 到既有 `CAPABILITY_RESULT_DELTA` 通道。

#### Scenario: 非法 eventType 被拒绝

- **WHEN** 一个 CLIP 结果带有 `eventType: "UNKNOWN"` 和 `messageType: "TEXT"`
- **THEN** tool-loop MUST NOT 发出 `TOOL_STRUCTURED_DELTA`
- **AND** 该结果 MUST fallback 到 `CAPABILITY_RESULT_DELTA`

#### Scenario: 非法 messageType 被拒绝

- **WHEN** 一个 CLIP 结果带有 `eventType: "ANSWER"` 和 `messageType: "UNKNOWN"`
- **THEN** tool-loop MUST NOT 发出 `TOOL_STRUCTURED_DELTA`
- **AND** 该结果 MUST fallback 到 `CAPABILITY_RESULT_DELTA`

#### Scenario: 带合法 messageType 的 EXPAND_PANEL 被接受

- **WHEN** 一个 CLIP 结果带有 `eventType: "EXPAND_PANEL"` 和 `messageType: "PIU"`
- **THEN** tool-loop MUST 发出带 `toolEventType: "EXPAND_PANEL"` 和 `toolMessageType: "PIU"` 的 `TOOL_STRUCTURED_DELTA`
