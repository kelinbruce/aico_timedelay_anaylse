# workflow-output-parser-contract Specification

## Purpose

定义 Workflow 节点输出控制配置与业务输出的分离：`outputs.output_parser` 只控制投影和展示，不能泄漏给下游变量；输出序列化以业务值而非 JSON 对象键为用户可见内容。
## Requirements
### Requirement: Workflow output parser control configuration

Workflow execution MUST treat `node.outputs.output_parser` as control configuration rather than business output data.

`projectNodeOutputs` MUST resolve `node.outputParser` templates against handler runtime bindings and include the resolved `output_parser` in the projected output (`WorkflowNodeResult.output` and `WorkflowExecutionEvent.output`), so the projector can read it. Downstream variable merge MUST strip `output_parser` so downstream nodes MUST NOT access it.

The resolved output parser MUST provide the source for display visibility (`show_title`/`show_content`), display type (`type`), display data (`data`), message level (`message_level`), AIGC label (`show_aigc`), and output schema fields.

#### Scenario: Output parser is not projected

- **GIVEN** a workflow node declares business output fields and `outputs.output_parser`
- **WHEN** the node output is projected
- **THEN** the projected business output MUST contain the declared business fields
- **AND** it MUST NOT contain `output_parser`
- **AND** downstream variable references MUST NOT be able to read `output_parser`

### Requirement: Workflow output parser source precedence

Workflow output presentation MUST resolve parser configuration in this order:

1. `node.presentation.outputParser`
2. `node.outputParser`
3. `node.outputs.output_parser`

The first source whose value is an object MUST be used. A non-object `node.outputs.output_parser` value MUST be ignored.

The resolved parser MUST provide the source for display type, display level, and workflow output schema fields, including `schema` and `outputSchema`.

#### Scenario: Explicit node parser takes precedence

- **GIVEN** a node declares both `node.outputParser` and `node.outputs.output_parser`
- **WHEN** workflow output presentation is resolved
- **THEN** the system MUST use `node.outputParser`
- **AND** it MUST NOT merge or override it with `node.outputs.output_parser`

#### Scenario: Outputs parser controls presentation

- **GIVEN** neither higher-priority parser source is present
- **AND** `node.outputs.output_parser` is an object containing display or schema settings
- **WHEN** workflow output presentation is resolved
- **THEN** the system MUST use those settings for display type, display level, and output schema projection

#### Scenario: Invalid outputs parser is ignored

- **GIVEN** `node.outputs.output_parser` is not an object
- **WHEN** workflow output presentation is resolved
- **THEN** the system MUST ignore that value
- **AND** normal business output projection MUST continue without exposing `output_parser`

### Requirement: Workflow output serialization

Workflow output presentation MUST serialize output values without exposing their field names:

- zero fields MUST produce an empty string;
- one field MUST produce that field's formatted value;
- multiple fields MUST produce formatted values joined by `\n` in declaration order.

String values MUST remain unchanged. Number and boolean values MUST use `String(value)`. Other JSON values MUST use `JSON.stringify(value)`.

#### Scenario: Single output value

- **GIVEN** workflow output `{ "answer": "诊断完成" }`
- **WHEN** the output is serialized for presentation
- **THEN** the result MUST be `诊断完成`
- **AND** the result MUST NOT include the field name `answer`

#### Scenario: Multiple output values

- **GIVEN** workflow output `{ "name": "Cell-3", "status": "告警活跃" }`
- **WHEN** the output is serialized for presentation
- **THEN** the result MUST be `Cell-3\n告警活跃`

#### Scenario: Empty output

- **GIVEN** workflow output has no fields
- **WHEN** the output is serialized for presentation
- **THEN** the result MUST be an empty string

### Requirement: Workflow output parser display type resolution

When the resolved output parser contains a `type` field (string), the projector MUST validate it against the display-type set defined in the product spec: `TEXT`, `CHART`, `CHART_PRO`, `HTML`, `TABLE`, `PIU`, `DSL`.

The projector MUST map the display type to a `ToolMessageType`:
- `PIU` MUST map to `"PIU"`.
- `DSL` MUST map to `"DSL"`.
- All other valid types MUST map to `"TEXT"`.

The raw display-type string MUST be passed as `displayType` metadata in the structured delta payload so the frontend can select the appropriate rendering.

When `type` is absent or not a string, the projector MUST use the default `"TEXT"` and MUST NOT include `displayType` in the payload.

#### Scenario: PIU type maps to PIU message type

- **GIVEN** a node's output parser has `type: "PIU"`
- **WHEN** the projector builds a structured delta for node completion, triggered by `type`, `data`, or `message_level`
- **THEN** the `toolMessageType` MUST be `"PIU"`
- **AND** the payload MUST include `displayType: "PIU"`

#### Scenario: TABLE type maps to TEXT message type with metadata

- **GIVEN** a node's output parser has `type: "TABLE"`
- **WHEN** the projector builds a structured delta for node completion, triggered by `type`, `data`, or `message_level`
- **THEN** the `toolMessageType` MUST be `"TEXT"`
- **AND** the payload MUST include `displayType: "TABLE"`

#### Scenario: Absent type defaults to TEXT

- **GIVEN** a node's output parser does not contain `type`
- **WHEN** the projector builds a structured delta for node completion
- **THEN** the `toolMessageType` MUST be `"TEXT"`
- **AND** the payload MUST NOT include `displayType`

#### Scenario: Type alone without data or message_level does not trigger output_parser path

- **GIVEN** a node's output parser has `type: "PIU"` but no `data` or `message_level`
- **WHEN** the projector builds a structured delta for node completion
- **THEN** the output_parser-driven path MUST NOT be entered
- **AND** the `toolMessageType` MUST follow the default or output-driven path
- **AND** the payload MUST NOT include `displayType`

### Requirement: Workflow output parser data content override

When the resolved output parser contains a `data` field that is a non-empty object, the projector MUST use `data` as the `content` of the structured delta instead of serializing the node output.

When `data` is absent, `null`, or not an object, the projector MUST fall back to output serialization.

`output_parser.data` MUST take precedence over output-driven content (i.e., `output["content"]` read by `tryOutputDrivenDelta`).

#### Scenario: Data present overrides output serialization

- **GIVEN** a node's output parser has `data: { piuName: "reportViewer", piuVersion: "1.0.0" }`
- **AND** the node output contains business fields
- **WHEN** the projector builds a structured delta for node completion
- **THEN** the `content` MUST be the `data` object
- **AND** the `content` MUST NOT be the serialized output string

#### Scenario: Data absent falls back to serialization

- **GIVEN** a node's output parser does not contain `data`
- **AND** the node output contains `{ answer: "done" }`
- **WHEN** the projector builds a structured delta for node completion
- **THEN** the `content` MUST be `"done"` (serialized output)

#### Scenario: Data is not an object is ignored

- **GIVEN** a node's output parser has `data: "some string"`
- **WHEN** the projector builds a structured delta for node completion
- **THEN** the `content` MUST be the serialized output (data ignored)

### Requirement: Workflow output parser message level override

When the resolved output parser contains a `message_level` or `messageLevel` field (string), the projector MUST validate it against `ToolEventType` values: `TITLE`, `DETAIL`, `ANSWER`, `EXPAND_PANEL`.

When valid, the projector MUST use it as the `toolEventType` for the structured delta, after applying sub-workflow scope mapping (e.g., `TITLE` -> `SUB_TITLE` in sub-workflow scope).

When absent or invalid, the projector MUST fall back to the existing answer-node-derived level (ANSWER for answer node, DETAIL otherwise).

`output_parser.message_level` MUST take precedence over output-driven level (i.e., `output["level"]` read by `tryOutputDrivenDelta`).

#### Scenario: message_level overrides answer-node derivation

- **GIVEN** a non-answer node's output parser has `message_level: "ANSWER"`
- **WHEN** the projector builds a structured delta for node completion
- **THEN** the `toolEventType` MUST be `"ANSWER"` (not the default `DETAIL`)

#### Scenario: Invalid message_level is ignored

- **GIVEN** a node's output parser has `message_level: "INVALID"`
- **WHEN** the projector builds a structured delta for node completion
- **THEN** the `toolEventType` MUST follow the default answer-node derivation

#### Scenario: Absent message_level uses default derivation

- **GIVEN** a node's output parser does not contain `message_level`
- **WHEN** the projector builds a structured delta for node completion
- **THEN** the `toolEventType` MUST follow the default answer-node derivation

### Requirement: Workflow output parser AIGC label passthrough

When the resolved output parser has `show_aigc` or `showAigc` set to `true` AND the output_parser-driven path is triggered (by `data` or `message_level`), the projector MUST include `aigc: true` in the structured delta payload.

When `show_aigc` is `false` or absent, the projector MUST omit the `aigc` field from the payload.

#### Scenario: show_aigc true includes aigc field

- **GIVEN** a node's output parser has `show_aigc: true` and `data: { content: "x" }`
- **WHEN** the projector builds a structured delta
- **THEN** the payload MUST include `aigc: true`

#### Scenario: show_aigc false omits aigc field

- **GIVEN** a node's output parser has `show_aigc: false` and `data: { content: "x" }`
- **WHEN** the projector builds a structured delta
- **THEN** the payload MUST NOT include the `aigc` field

#### Scenario: show_aigc alone without data or message_level does not emit aigc

- **GIVEN** a node's output parser has `show_aigc: true` but no `data` or `message_level`
- **WHEN** the projector builds a structured delta
- **THEN** the output_parser-driven path MUST NOT be entered
- **AND** the payload MUST NOT include the `aigc` field

#### Scenario: Absent show_aigc omits aigc field

- **GIVEN** a node's output parser does not contain `show_aigc`
- **WHEN** the projector builds a structured delta
- **THEN** the payload MUST NOT include the `aigc` field

### Requirement: Workflow output parser storage model deviation

The TS runtime MUST use a unified `TOOL_STRUCTURED_DELTA` timeline event model for all workflow output display. PIU data (including `piuName`, `piuVersion`, `data`, `method`) MUST be carried inline as the `content` field of the structured delta.

The legacy HOFS/ZENITH dual-storage routing MUST NOT apply to the TS runtime. This deviation from the legacy product spec is an explicit design decision documented in the OpenSpec design.

#### Scenario: PIU data carried inline in structured delta

- **GIVEN** a node's output parser has `type: "PIU"` and `data: { piuName: "reportViewer", piuVersion: "1.0.0" }`
- **WHEN** the projector builds a structured delta for node completion
- **THEN** the `content` MUST be the `data` object with PIU fields inline
- **AND** no separate HOFS storage call MUST occur

#### Scenario: Non-PIU data carried inline in structured delta

- **GIVEN** a node's output parser has `type: "TABLE"` and no `data` field
- **WHEN** the projector builds a structured delta for node completion
- **THEN** the `content` MUST be the serialized output string
- **AND** no separate ZENITH storage call MUST occur
