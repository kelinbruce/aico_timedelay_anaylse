## ADDED Requirements

### Requirement: Workflow output parser control configuration

Workflow execution MUST treat `node.outputs.output_parser` as control configuration rather than business output data.

`projectNodeOutputs` MUST omit the `output_parser` key regardless of its value. The projected variables, `WorkflowNodeResult.output`, and `WorkflowExecutionEvent.output` MUST NOT expose that key to downstream nodes.

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
