## Function

- **所属 Function**：`FN-5.16 识别和投射结构化工具增量`
- **Function 变更类型**：`ADDED`
- **spec 角色**：主规格

## MODIFIED Requirements

### Requirement: Structured Event Shape Validation

The system MUST validate the structured event shape before emitting `TOOL_STRUCTURED_DELTA`. The `toolEventType` field (mapped from `eventType`) MUST be one of `TITLE`, `DETAIL`, `ANSWER`, `SUB_TITLE`, `SUB_DETAIL`, `SUB_CONCLUSION`, `EXPAND_PANEL`. The `toolMessageType` field (mapped from `messageType`) MUST be one of `PIU`, `DSL`, `ACTION`, `OPERATOR`, `FILE`, `TEXT`. The `content` field MUST be present. If validation fails, the result MUST fall back to the existing `CAPABILITY_RESULT_DELTA` channel.

The system MUST support three identification shapes:

1. **Direct shape**: the candidate JSON object is the structured event itself, matching `{eventType, messageType, content}`.
2. **Status envelope shape**: the candidate JSON object is `{"status":"ok","data":{"raw":"<json-string>"}}` where the `raw` field is a JSON string that, when parsed, yields `{eventType, messageType, content}`.
3. **Code envelope shape**: the candidate JSON object is `{"code":200,"msg":"success","data":"<json-string>"}` where the `data` field is a JSON string that, when parsed, yields `{eventType, messageType, content}`.

All three shapes MUST use the same `TOOL_EVENT_TYPES` and `TOOL_MESSAGE_TYPES` enum validation. All three shapes MUST use the same `hasSensitiveStructuredContent` security check. The system MUST attempt shapes in order: direct shape first, then envelope unwrapping (status envelope, then code envelope).

**需求类别**：功能性需求

#### Scenario: 直接形状识别成功

- **WHEN** 候选 JSON 对象包含有效的 `eventType`、`messageType` 和 `content` 字段
- **THEN** 系统 MUST emit `TOOL_STRUCTURED_DELTA` 并携带解析后的事件数据

#### Scenario: status 信封形状识别成功

- **WHEN** 候选 JSON 对象为 `{"status":"ok","data":{"raw":"{\"eventType\":\"ANSWER\",\"messageType\":\"TEXT\",\"content\":\"recovery\"}"}}`
- **THEN** 系统 MUST 解析 `data.raw` 为 JSON
- **AND** MUST 校验解析后的对象为结构化事件
- **AND** MUST emit `TOOL_STRUCTURED_DELTA`，携带 `toolEventType: "ANSWER"`、`toolMessageType: "TEXT"` 和 `content: "recovery"`

#### Scenario: code 信封形状识别成功

- **WHEN** 候选 JSON 对象为 `{"code":200,"msg":"success","data":"{\"eventType\":\"ANSWER\",\"messageType\":\"TEXT\",\"content\":\"recovery\"}"}`
- **THEN** 系统 MUST 解析 `data` 为 JSON
- **AND** MUST 校验解析后的对象为结构化事件
- **AND** MUST emit `TOOL_STRUCTURED_DELTA`，携带 `toolEventType: "ANSWER"`、`toolMessageType: "TEXT"` 和 `content: "recovery"`

#### Scenario: status 信封 status 非 ok 时回退

- **WHEN** 候选 JSON 对象为 `{"status":"error","data":{"raw":"..."}}`
- **THEN** 系统 MUST NOT emit `TOOL_STRUCTURED_DELTA`
- **AND** 结果 MUST 回退到 `CAPABILITY_RESULT_DELTA`

#### Scenario: code 信封 code 非 200 时回退

- **WHEN** 候选 JSON 对象为 `{"code":500,"msg":"error","data":"..."}`
- **THEN** 系统 MUST NOT emit `TOOL_STRUCTURED_DELTA`
- **AND** 结果 MUST 回退到 `CAPABILITY_RESULT_DELTA`

#### Scenario: status 信封 raw 格式错误时回退

- **WHEN** 候选 JSON 对象为 `{"status":"ok","data":{"raw":"not valid json"}}`
- **THEN** 系统 MUST NOT emit `TOOL_STRUCTURED_DELTA`
- **AND** 结果 MUST 回退到 `CAPABILITY_RESULT_DELTA`

#### Scenario: code 信封 data 格式错误时回退

- **WHEN** 候选 JSON 对象为 `{"code":200,"msg":"success","data":"not valid json"}`
- **THEN** 系统 MUST NOT emit `TOOL_STRUCTURED_DELTA`
- **AND** 结果 MUST 回退到 `CAPABILITY_RESULT_DELTA`

#### Scenario: 无效 eventType 被拒绝

- **WHEN** 结构化事件的 `eventType` 为 `"UNKNOWN"` 且 `messageType` 为 `"TEXT"`
- **THEN** 系统 MUST NOT emit `TOOL_STRUCTURED_DELTA`
- **AND** 结果 MUST 回退到 `CAPABILITY_RESULT_DELTA`

#### Scenario: 无效 messageType 被拒绝

- **WHEN** 结构化事件的 `eventType` 为 `"ANSWER"` 且 `messageType` 为 `"UNKNOWN"`
- **THEN** 系统 MUST NOT emit `TOOL_STRUCTURED_DELTA`
- **AND** 结果 MUST 回退到 `CAPABILITY_RESULT_DELTA`

## Function 变更汇总

### 描述

- **变更类型**：新增
- **目标内容**：系统识别工具结果中的结构化事件并投射为 `TOOL_STRUCTURED_DELTA`，支持直接三段式、status 信封和 code 信封三种识别形状，共享枚举校验和安全检查。
- **依据 Requirements**：`Structured Event Shape Validation`

### 处理过程

- **变更类型**：修改
- **目标内容**：系统依次尝试直接形状、status 信封解包和 code 信封解包；code 信封以 `code === 200` 为成功标识，`data` 字段为直接的 JSON 字符串。三种形状共享 `TOOL_EVENT_TYPES`、`TOOL_MESSAGE_TYPES` 枚举校验和 `hasSensitiveStructuredContent` 安全检查。
- **依据 Requirements**：`Structured Event Shape Validation`

### 规格

- **规格项**：支持的信封形状
- **变更类型**：修改
- **原规格值**：直接三段式 + status 信封（`{"status":"ok","data":{"raw":"<json-string>"}}`）
- **目标规格值**：直接三段式 + status 信封 + code 信封（`{"code":200,"msg":"success","data":"<json-string>"}`）
- **依据 Requirements**：`Structured Event Shape Validation`

- **规格项**：code 信封成功标识
- **变更类型**：新增
- **原规格值**：不适用（新增）
- **目标规格值**：`code === 200`（精确匹配，不做范围匹配）
- **依据 Requirements**：`Structured Event Shape Validation`

### 主规格

- **变更类型**：新增
- **目标内容**：`tool-structured-delta`
- **依据 Requirements**：`Structured Event Shape Validation`