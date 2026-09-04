## ADDED Requirements

### Requirement: Guard-forward relay may project a terminal OUTPUT_GUARD_BLOCKED event

作为 "projection service MUST NOT 发明 transport-private stream event names" 的受控例外，guard-forward relay 路径下的共享 projection service MAY 投影 terminal `OUTPUT_GUARD_BLOCKED` 事件（由 guard 层经 `GuardrailGatewayPort` 注入，见 `ts-core-contracts` "Guard-forward relay output-guard terminal event"）。该例外仅限 `OUTPUT_GUARD_BLOCKED` 一个事件；其他事件仍 MUST 来自 canonical timeline 或 runtime status，projection service MUST NOT 发明其他 transport-private stream event 名称。

`OUTPUT_GUARD_BLOCKED` 投影后 MUST 以 terminal 语义结束本次请求流，其后 MUST NOT 投影 `LLM_CONTENT_DELTA` 或 `TOOL_STRUCTURED_DELTA`，且 MUST NOT 继续推送已缓冲的模型输出原文。SSE 与 WebSocket transport 对 `OUTPUT_GUARD_BLOCKED` MUST 表现等价。

#### Scenario: Projection service projects OUTPUT_GUARD_BLOCKED on guard-forward relay

- **WHEN** guard-forward relay 路径上 guard 层注入 `OUTPUT_GUARD_BLOCKED`
- **THEN** 共享 projection service MAY 投影该 terminal 事件
- **AND** 该事件之后 MUST NOT 投影增量内容事件
- **AND** MUST NOT 推送已缓冲的模型输出原文

#### Scenario: Projection service does not invent other transport-private events

- **WHEN** guard-forward relay 路径投影事件
- **THEN** 除 `OUTPUT_GUARD_BLOCKED` 外，projection service MUST NOT 发明 transport-private stream event 名称
- **AND** 其他事件 MUST 来自 canonical timeline 或 runtime status
