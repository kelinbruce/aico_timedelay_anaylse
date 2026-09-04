## ADDED Requirements

### Requirement: Tool invocation 支持同轮并行调用

Tool execution framework SHALL support multiple independent Tool capability invocations from the same Agent round running concurrently through the existing capability invocation boundary. This MUST NOT introduce Tool-specific public invocation contracts, bypass provider-aware executable lookup, bypass input/output schema validation, or weaken safe error mapping.

Tool implementations MUST treat each invocation as an independent execution. A Tool implementation or controlled dependency that owns mutable state or side effects MUST protect its own consistency and MUST NOT rely on Agent core serializing same-round invocations. Agent core SHALL preserve result association by tool call id and original model order rather than by completion order.

#### Scenario: 多个 Tool invocation 可重叠执行

- **WHEN** Agent core invokes multiple Tool capabilities from the same model round
- **THEN** Tool execution framework MUST allow those invocations to overlap in time
- **AND** each invocation MUST still validate input before execution and output after execution
- **AND** each invocation MUST return its own `CapabilityInvocationResult`

#### Scenario: Tool invocation 仍保持调用隔离

- **WHEN** multiple Tool invocations overlap
- **THEN** each invocation MUST receive only its own validated input and trusted execution options
- **AND** one invocation MUST NOT receive another invocation's arguments, result payload, safe error, or mutable execution context
- **AND** shared controlled dependencies MUST preserve their own consistency under overlapping calls

#### Scenario: 并行调用不新增公共 Tool 协议

- **WHEN** same-round Tool invocations run concurrently
- **THEN** Agent core MUST continue to call `CapabilityInvocationPort`
- **AND** the Tool framework MUST NOT expose public `ToolInvocationRequest`, `ToolInvocationResult`, or Tool-specific execution protocols
