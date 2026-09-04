# tool-structured-delta Specification Delta

## MODIFIED Requirements

### Requirement: 结构化事件形状校验

系统 MUST 在发出 `TOOL_STRUCTURED_DELTA` 之前校验结构化事件形状。`toolEventType` 字段（由 `eventType` 映射而来）MUST 是 `TITLE`、`DETAIL`、`ANSWER`、`SUB_TITLE`、`SUB_DETAIL`、`SUB_CONCLUSION`、`EXPAND_PANEL` 之一。`toolMessageType` 字段（由 `messageType` 映射而来）MUST 是 `PIU`、`DSL`、`STREAM_DSL`、`ACTION`、`OPERATOR`、`FILE`、`TEXT` 之一。`content` 字段 MUST 存在。若校验失败，结果 MUST 回退到既有的 `CAPABILITY_RESULT_DELTA` channel。

系统 MUST 支持两种识别形态：

1. **直接形态**：候选 JSON 对象本身就是结构化事件，匹配 `{eventType, messageType, content}`。
2. **信封形态**：候选 JSON 对象是 `{"status":"ok","data":{"raw":"<json-string>"}}`，其中 `raw` 字段是一个 JSON 字符串，解析后得到 `{eventType, messageType, content}`。

两种形态 MUST 使用相同的 `TOOL_EVENT_TYPES` 和 `TOOL_MESSAGE_TYPES` enum 校验。两种形态 MUST 使用相同的 `hasSensitiveStructuredContent` 安全检查。

系统 MUST NOT 检查或校验 `STREAM_DSL` content fragment 的内部结构。`STREAM_DSL` 的 `content` 字段是一个带 `type` 字段（`"dataModel"`、`"dsl"` 或 `"done"`）的 JSON 对象；后端识别层把它当作不透明的 `JsonValue`，只校验 `content` 存在且非 null。

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

#### Scenario: STREAM_DSL messageType 被接受

- **WHEN** 某个结构化事件的 `eventType` 为 "ANSWER"、`messageType` 为 "STREAM_DSL"、content 为 `{"type":"dataModel","content":{"fields":[...]}}`
- **THEN** 系统 MUST 发出 `TOOL_STRUCTURED_DELTA`，其中 `toolEventType: "ANSWER"`、`toolMessageType: "STREAM_DSL"`，content 原样保留
- **AND** 系统 MUST NOT 检查 STREAM_DSL fragment 的内部 `type` 或 `content` 字段

#### Scenario: 任意 content 类型的 STREAM_DSL 被接受

- **WHEN** 某个结构化事件的 `messageType` 为 "STREAM_DSL" 且 `content` 是任意非 null 的 JSON 值（对象、字符串、数字）
- **THEN** 只要 `content` 存在且非 null，系统 MUST 发出 `TOOL_STRUCTURED_DELTA`
- **AND** 系统 MUST NOT 基于 `content` 的内部结构拒绝